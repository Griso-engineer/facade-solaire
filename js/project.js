/* État du projet (sérialisable en JSON), valeurs par défaut, grandeurs dérivées. */
(function (FS) {
  'use strict';
  const G = FS.geo;

  function defaults() {
    return {
      app: 'insolatio', version: 2,
      name: '', address: '',
      tz: 'Europe/Paris',
      dataSource: 'auto',      // 'auto' (IGN en France, sinon OSM) | 'ign' | 'osm'
      target: null,            // { ll: [[lat, lon]…], holes: [[[lat, lon]…]…], id, source: 'ign' | 'osm' | 'dessin', props | tags }
      heightMode: 'levels',    // 'levels' | 'total'
      levels: 5, floorH: 3, totalH: 15,
      heightSrc: 'default',    // voir FS.data.SRC_LABEL
      wwr: 0.4, wwrOver: {},   // fraction vitrée des étages courants, surcharges par n° de façade
      wwrGround: null, wwrTop: null, // fraction vitrée du RDC et du dernier étage (null : comme les étages courants)
      reveal: 0.2,             // profondeur de tableau : retrait du vitrage par rapport au nu de la façade (m)
      ignored: [],             // n° des façades exclues des analyses (murs mitoyens…)
      nbMode: 'auto',          // 'auto' : voisins lus dans un rayon (+ dessinés) ; 'manual' : voisins dessinés seulement
      radius: 150,
      nbDefaults: { floorH: 3, defaultH: 15 },
      neighbors: [],           // voisins lus : [{ id, ll, height, src, source, props | tags }]
      drawn: [],               // voisins dessinés : [{ id, ll, height, src: 'user', source: 'dessin' }]
      removed: [],             // identifiants des voisins retirés à la main (démolis…)
      steps: {},               // validation des étapes de l'onglet Site : { loc, target, nb, glazing } → 'ok' | 'changed'
      showWindows: true,
      view3d: { mode: 'annual' }, // coloration des façades dans la maquette 3D (voir FS.view3d)
      view: { doy: FS.solar.doyOf(2026, 6, 21), hour: 15 },
      solar: { model: 'perez', split: 'erbs', albedo: 0.2, g: 0.6, color: 'annual', masks: true },
      climateInfo: null,       // source du climat utilisé (pour mémoire)
      thermal: FS.thermal.defaults(),
      daylight: FS.daylight.defaults(),
      mapView: null
    };
  }

  let P = defaults();
  let D = null; // dérivé

  const get = () => P;
  const derived = () => D || (D = derive(P));
  const invalidate = () => { D = null; };

  function height(p) { return p.heightMode === 'total' ? p.totalH : p.levels * p.floorH; }
  function effectiveNeighbors(p) { p = p || P; return p.nbMode === 'manual' ? p.drawn : p.neighbors.concat(p.drawn); }

  // Point (x, y) dans l'emprise : dans le contour extérieur et hors des cours
  function insideRings(pt, outer, holes) {
    return G.inside(pt, outer) && !(holes || []).some((h) => G.inside(pt, h));
  }

  function derive(p) {
    if (!p.target) return { ok: false };
    const ll = p.target.ll;
    const lat0 = ll.reduce((a, q) => a + q[0], 0) / ll.length;
    const lon0 = ll.reduce((a, q) => a + q[1], 0) / ll.length;
    const proj = G.projector(lat0, lon0);
    const toXY = (ring) => ring.map((q) => proj.toXY(q[0], q[1]));
    const txy = G.clean(toXY(ll));
    // cours : anneaux en sens horaire (la normale « extérieure » pointe vers la cour)
    const holes = (p.target.holes || []).map((h) => G.clean(toXY(h)).reverse()).filter((h) => h.length >= 3);
    const H = height(p);
    const nbs = effectiveNeighbors(p).map((nb) => {
      const xy = G.clean(toXY(nb.ll));
      return { id: nb.id, xy, height: nb.height, src: nb.src, bbox: FS.building.bbox(xy) };
    }).filter((nb) => nb.xy.length >= 3);
    const model = FS.building.facades({ xy: txy, holes, height: H }, nbs);
    model.facades.forEach((f) => {
      const o = p.wwrOver[f.id];
      // fraction vitrée des étages courants, puis RDC et dernier étage (réglages globaux) ;
      // une façade aveugle (héberge, ou valeur propre nulle) le reste à tous les niveaux
      const mid = o != null ? o : (f.pignon ? 0 : p.wwr);
      const blind = f.pignon || mid === 0;
      f.wwrSet = {
        mid,
        ground: blind ? 0 : (p.wwrGround != null ? p.wwrGround : mid),
        top: blind ? 0 : (p.wwrTop != null ? p.wwrTop : mid)
      };
      f.wwrOverridden = o != null;
      f.ignored = (p.ignored || []).indexOf(f.id) >= 0;
      let g = 0;
      for (const s of f.segs) for (const l of FS.building.levels(H, p.floorH, s.zMin, f.wwrSet)) g += s.len * (l.z1 - l.z0) * l.wwr;
      f.glazed = g;
      f.wwr = f.area ? g / f.area : 0;
      f.opaque = f.area - f.glazed;
    });
    return { ok: true, proj, lat: lat0, lon: lon0, xy: txy, holes, rings: [txy].concat(holes), H, floorH: p.floorH, nbs, model };
  }

  // Hauteurs des voisins lus selon les réglages par défaut (sauf saisies manuelles)
  function refreshNeighborHeights() {
    for (const nb of P.neighbors) {
      if (nb.src === 'user') continue;
      const h = FS.data.height(nb, P.nbDefaults);
      nb.height = h.height; nb.src = h.src;
    }
    invalidate();
  }

  // Bâtiment étudié (bâtiment de la carte, ou polygone dessiné)
  function setTarget(b) {
    P.target = { ll: b.ll, holes: b.holes || [], id: b.id || null, source: b.source || 'dessin', props: b.props, tags: pickTags(b.tags) };
    P.wwrOver = {};
    P.ignored = []; // numérotation des façades nouvelle
    P.removed = [];
    if (b.source === 'dessin') {
      P.heightSrc = 'user';
    } else {
      const h = FS.data.height(b, { floorH: P.floorH, defaultH: P.nbDefaults.defaultH });
      if (h.src === 'default') {
        P.heightMode = 'levels';
        P.levels = Math.max(1, Math.round(P.nbDefaults.defaultH / P.floorH));
        P.totalH = P.levels * P.floorH;
      } else if (h.src === 'ign-etages' || h.src === 'levels') {
        P.heightMode = 'levels'; P.levels = h.levels; P.totalH = Math.round(h.height * 10) / 10;
      } else {
        P.heightMode = 'total'; P.totalH = Math.round(h.height * 10) / 10;
        P.levels = h.levels || Math.max(1, Math.round(h.height / P.floorH));
      }
      P.heightSrc = h.src;
    }
    invalidate();
  }

  // Voisins lus : on écarte le bâtiment étudié et ce qui le recouvre (doublons, parties)
  function setNeighbors(list) {
    const ll = P.target ? P.target.ll : null;
    let keep = list;
    if (ll) {
      const proj = G.projector(ll[0][0], ll[0][1]);
      const toXY = (ring) => ring.map((q) => proj.toXY(q[0], q[1]));
      const txy = G.clean(toXY(ll));
      const holes = (P.target.holes || []).map((h) => toXY(h));
      const tc = G.centroid(txy);
      keep = list.filter((b) => {
        if (P.target.id && b.id === P.target.id) return false;
        if (P.removed && P.removed.indexOf(b.id) >= 0) return false;
        const xy = G.clean(toXY(b.ll));
        if (xy.length < 3) return false;
        const c = G.centroid(xy);
        // dans l'emprise (hors cours) ou contenant l'emprise : doublon
        if (insideRings(c, txy, holes) || G.inside(tc, xy)) return false;
        // recouvert en majorité par l'emprise (bâtiment existant remplacé par un projet dessiné)
        if (xy.filter((q) => insideRings(q, txy, holes)).length >= xy.length / 2) return false;
        const d = G.inside(c, txy) ? 0 : G.distRing(c, txy);
        return d <= P.radius;
      });
    }
    P.neighbors = keep.map((b) => {
      const h = FS.data.height(b, P.nbDefaults);
      return { id: b.id, ll: b.ll.map((q) => [+q[0].toFixed(7), +q[1].toFixed(7)]), height: h.height, src: h.src, source: b.source, props: b.props, tags: pickTags(b.tags) };
    });
    invalidate();
  }

  function pickTags(t) {
    if (!t) return undefined;
    const o = {};
    for (const k of ['building', 'height', 'building:levels', 'roof:levels', 'name', 'addr:housenumber', 'addr:street']) if (t[k] != null) o[k] = t[k];
    return o;
  }

  // ---------- Validation des étapes de l'onglet Site ----------
  const step = (k) => P.steps[k];
  function validate(k) { P.steps[k] = 'ok'; save(); }
  // une modification après validation remet l'étape « à revalider »
  function touch(...ks) { for (const k of ks) if (P.steps[k] === 'ok') P.steps[k] = 'changed'; }

  // fusion avec les valeurs par défaut (projets enregistrés par une version antérieure)
  function merge(s) {
    const d = defaults();
    const p = Object.assign(d, s);
    p.solar = Object.assign(defaults().solar, s.solar || {});
    p.nbDefaults = Object.assign(defaults().nbDefaults, s.nbDefaults || {});
    p.thermal = Object.assign(FS.thermal.defaults(), s.thermal || {});
    p.daylight = Object.assign(FS.daylight.defaults(), s.daylight || {});
    p.thermal.protection = Object.assign(FS.thermal.defaults().protection, (s.thermal && s.thermal.protection) || {});
    p.steps = Object.assign({}, s.steps || {});
    p.drawn = s.drawn || [];
    // ancienne coloration (P.solar.color) → onglet Maquette 3D
    if (!s.view3d) p.view3d = { mode: s.solar && s.solar.color ? s.solar.color : 'annual' };
    // version 1 : cible OSM sans cours, voisins OSM
    if (p.target) {
      p.target.holes = p.target.holes || [];
      if (p.target.osmId && !p.target.id) p.target.id = p.target.osmId;
      if (p.target.source === 'osm' && !p.target.tags) p.target.tags = {};
    }
    for (const nb of p.neighbors) if (!nb.source) nb.source = 'osm';
    return p;
  }

  function save() { FS.store.set('project', P); }
  function load() {
    const s = FS.store.get('project', null);
    if (s && (s.app === 'insolatio' || s.app === 'facade-solaire')) { P = merge(s); P.app = 'insolatio'; } // projets enregistrés sous l'ancien nom compris
    invalidate();
  }
  function reset() { P = defaults(); invalidate(); }
  function exportJSON() { return JSON.stringify(P, null, 1); }
  function importJSON(text) {
    const s = JSON.parse(text);
    if (!s || (s.app !== 'insolatio' && s.app !== 'facade-solaire')) throw new Error('Ce fichier n\'est pas un projet Insolatio.');
    P = merge(s);
    P.app = 'insolatio';
    invalidate();
  }

  FS.project = {
    get, derived, invalidate, height, setTarget, setNeighbors, refreshNeighborHeights, effectiveNeighbors, insideRings,
    step, validate, touch, save, load, reset, exportJSON, importJSON, defaults
  };
})(window.FS);
