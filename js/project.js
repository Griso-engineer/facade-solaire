/* État du projet (sérialisable en JSON), valeurs par défaut, grandeurs dérivées. */
(function (FS) {
  'use strict';
  const G = FS.geo;

  function defaults() {
    return {
      app: 'facade-solaire', version: 1,
      name: '', address: '',
      tz: 'Europe/Paris',
      target: null,            // { ll: [[lat, lon]...], osmId, tags, source: 'osm' | 'dessin' }
      heightMode: 'levels',    // 'levels' | 'total'
      levels: 5, floorH: 3, totalH: 15,
      heightSrc: 'default',    // 'height' | 'levels' | 'default' | 'user'
      wwr: 0.4, wwrOver: {},   // fraction vitrée globale, surcharges par n° de façade
      radius: 150,
      nbDefaults: { floorH: 3, defaultH: 15 },
      neighbors: [],           // [{ id, ll, tags, height, src }]
      removed: [],             // identifiants OSM des voisins retirés à la main (démolis…)
      view: { doy: FS.solar.doyOf(2026, 6, 21), hour: 15 },
      solar: { model: 'perez', split: 'erbs', albedo: 0.2, g: 0.6, color: 'annual', masks: true },
      climateInfo: null,       // source du climat utilisé (pour mémoire)
      thermal: FS.thermal.defaults(),
      mapView: null
    };
  }

  let P = defaults();
  let D = null; // dérivé

  const get = () => P;
  const derived = () => D || (D = derive(P));
  const invalidate = () => { D = null; };

  function height(p) { return p.heightMode === 'total' ? p.totalH : p.levels * p.floorH; }

  function derive(p) {
    if (!p.target) return { ok: false };
    const ll = p.target.ll;
    const lat0 = ll.reduce((a, q) => a + q[0], 0) / ll.length;
    const lon0 = ll.reduce((a, q) => a + q[1], 0) / ll.length;
    const proj = G.projector(lat0, lon0);
    const txy = G.clean(ll.map((q) => proj.toXY(q[0], q[1])));
    const H = height(p);
    const nbs = p.neighbors.map((nb) => {
      const xy = G.clean(nb.ll.map((q) => proj.toXY(q[0], q[1])));
      return { id: nb.id, xy, height: nb.height, src: nb.src, bbox: FS.building.bbox(xy) };
    }).filter((nb) => nb.xy.length >= 3);
    const model = FS.building.facades({ xy: txy, height: H }, nbs);
    model.facades.forEach((f) => {
      const o = p.wwrOver[f.id];
      f.wwr = o != null ? o : (f.pignon ? 0 : p.wwr);
      f.wwrOverridden = o != null;
      f.glazed = f.area * f.wwr;
      f.opaque = f.area - f.glazed;
    });
    return { ok: true, proj, lat: lat0, lon: lon0, xy: txy, H, nbs, model };
  }

  // Hauteurs des voisins selon les réglages par défaut (sauf saisies manuelles)
  function refreshNeighborHeights() {
    for (const nb of P.neighbors) {
      if (nb.src === 'user') continue;
      const h = FS.osm.heightFromTags(nb.tags || {}, P.nbDefaults);
      nb.height = h.height; nb.src = h.src;
    }
    invalidate();
  }

  // Bâtiment étudié à partir d'un élément OSM (ou d'un polygone dessiné)
  function setTarget(t) {
    P.target = t;
    P.wwrOver = {};
    P.removed = [];
    const tags = t.tags || {};
    const h = FS.osm.heightFromTags(tags, { floorH: P.floorH, defaultH: P.nbDefaults.defaultH });
    if (h.src === 'height') {
      P.heightMode = 'total'; P.totalH = Math.round(h.height * 10) / 10;
      if (h.levels) P.levels = h.levels;
    } else if (h.src === 'levels') {
      P.heightMode = 'levels'; P.levels = h.levels;
      P.totalH = Math.round(h.height * 10) / 10;
    } else {
      P.heightMode = 'levels';
      P.levels = Math.max(1, Math.round(P.nbDefaults.defaultH / P.floorH));
      P.totalH = P.levels * P.floorH;
    }
    P.heightSrc = h.src;
    invalidate();
  }

  // Voisins : on écarte le bâtiment étudié et ce qui le recouvre (doublons, parties)
  function setNeighbors(list) {
    const ll = P.target ? P.target.ll : null;
    let keep = list;
    if (ll) {
      const lat0 = ll[0][0], lon0 = ll[0][1];
      const proj = G.projector(lat0, lon0);
      const txy = G.clean(ll.map((q) => proj.toXY(q[0], q[1])));
      const tc = G.centroid(txy);
      keep = list.filter((b) => {
        if (P.target.osmId && b.id === P.target.osmId) return false;
        const xy = G.clean(b.ll.map((q) => proj.toXY(q[0], q[1])));
        if (xy.length < 3) return false;
        const c = G.centroid(xy);
        if (G.inside(c, txy) || G.inside(tc, xy)) return false;
        // recouvert en majorité par l'emprise (bâtiment existant remplacé par un projet dessiné)
        if (xy.filter((p) => G.inside(p, txy)).length >= xy.length / 2) return false;
        if (P.removed && P.removed.indexOf(b.id) >= 0) return false;
        const d = G.inside(c, txy) ? 0 : G.distRing(c, txy);
        return d <= P.radius;
      });
    }
    P.neighbors = keep.map((b) => {
      const h = FS.osm.heightFromTags(b.tags || {}, P.nbDefaults);
      return { id: b.id, ll: b.ll.map((q) => [+q[0].toFixed(7), +q[1].toFixed(7)]), tags: pickTags(b.tags), height: h.height, src: h.src };
    });
    invalidate();
  }

  function pickTags(t) {
    const o = {};
    for (const k of ['building', 'height', 'building:levels', 'roof:levels', 'name', 'addr:housenumber', 'addr:street']) if (t && t[k] != null) o[k] = t[k];
    return o;
  }

  // fusion avec les valeurs par défaut (projets enregistrés par une version antérieure)
  function merge(s) {
    const d = defaults();
    const p = Object.assign(d, s);
    p.solar = Object.assign(defaults().solar, s.solar || {});
    p.nbDefaults = Object.assign(defaults().nbDefaults, s.nbDefaults || {});
    p.thermal = Object.assign(FS.thermal.defaults(), s.thermal || {});
    p.thermal.protection = Object.assign(FS.thermal.defaults().protection, (s.thermal && s.thermal.protection) || {});
    return p;
  }

  function save() { FS.store.set('project', P); }
  function load() {
    const s = FS.store.get('project', null);
    if (s && s.app === 'facade-solaire') P = merge(s);
    invalidate();
  }
  function reset() { P = defaults(); invalidate(); }
  function exportJSON() { return JSON.stringify(P, null, 1); }
  function importJSON(text) {
    const s = JSON.parse(text);
    if (!s || s.app !== 'facade-solaire') throw new Error('Ce fichier n\'est pas un projet Façade solaire.');
    P = merge(s);
    invalidate();
  }

  FS.project = { get, derived, invalidate, height, setTarget, setNeighbors, refreshNeighborHeights, save, load, reset, exportJSON, importJSON, defaults };
})(window.FS);
