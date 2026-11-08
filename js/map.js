/* Carte Leaflet : recherche, sélection du bâtiment (Overpass), dessin d'une emprise,
   affichage des voisins et des façades numérotées. */
(function (FS) {
  'use strict';
  let map = null, layers = null, mode = 'select', draw = null, onChange = () => {}, setStatus = () => {};

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function init(el, opts) {
    onChange = opts.onChange || onChange;
    setStatus = opts.setStatus || setStatus;
    const P = FS.project.get();
    const mv = P.mapView || { lat: 48.8566, lon: 2.3522, z: 16 };
    map = L.map(el, { zoomControl: true, attributionControl: true }).setView([mv.lat, mv.lon], mv.z);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20, maxNativeZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>'
    }).addTo(map);
    layers = L.layerGroup().addTo(map);
    map.on('click', onMapClick);
    map.on('dblclick', (e) => { if (mode === 'draw') { L.DomEvent.stop(e); finishDraw(); } });
    map.on('moveend', () => {
      const c = map.getCenter();
      FS.project.get().mapView = { lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6), z: map.getZoom() };
      FS.project.save();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mode === 'draw') { cancelDraw(); } });
    render();
  }

  function setMode(m) {
    mode = m;
    if (m === 'draw') { draw = { pts: [], line: null }; map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair'; }
    else { cancelDraw(true); }
    onChange('mode');
  }
  const getMode = () => mode;

  function cancelDraw(silent) {
    if (draw && draw.line) draw.line.remove();
    if (draw && draw.marks) draw.marks.forEach((m) => m.remove());
    draw = null; mode = 'select';
    if (map) { map.doubleClickZoom.enable(); map.getContainer().style.cursor = ''; }
    if (!silent) onChange('mode');
  }

  async function onMapClick(e) {
    if (mode === 'draw') return addDrawPoint(e);
    const P = FS.project.get();
    const { lat, lng } = e.latlng;
    setStatus('Recherche des bâtiments autour du point…');
    try {
      const all = await FS.osm.buildingsAround(lat, lng, P.radius + 80);
      const proj = FS.geo.projector(lat, lng);
      const hit = all.find((b) => FS.geo.inside([0, 0], b.ll.map((q) => proj.toXY(q[0], q[1]))));
      if (!hit) { setStatus('Aucun bâtiment OSM à cet endroit : cliquez sur une emprise, ou dessinez-la.', true); return; }
      FS.project.setTarget({ ll: hit.ll, osmId: hit.id, tags: hit.tags, source: 'osm' });
      FS.project.setNeighbors(all);
      const nm = hit.tags.name || [hit.tags['addr:housenumber'], hit.tags['addr:street']].filter(Boolean).join(' ');
      if (nm && !P.name) P.name = nm;
      setStatus(all.length - 1 + ' bâtiments chargés. Bâtiment ' + hit.id + ' sélectionné.');
      onChange('target');
      fit();
    } catch (err) {
      setStatus('Overpass indisponible (' + err.message + '). Réessayez, ou dessinez l\'emprise.', true);
    }
  }

  function addDrawPoint(e) {
    const p = e.latlng;
    if (draw.pts.length >= 3) {
      const a = map.latLngToContainerPoint(draw.pts[0]), b = map.latLngToContainerPoint(p);
      if (a.distanceTo(b) < 12) return finishDraw();
    }
    // les deux clics d'un double-clic : ignorer le doublon
    const last = draw.pts[draw.pts.length - 1];
    if (last && map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(p)) < 3) return;
    draw.pts.push(p);
    draw.marks = draw.marks || [];
    draw.marks.push(L.circleMarker(p, { radius: 4, color: css('--accent'), weight: 2, fillOpacity: 1 }).addTo(map));
    if (draw.line) draw.line.setLatLngs(draw.pts);
    else draw.line = L.polyline(draw.pts, { color: css('--accent'), weight: 2, dashArray: '4 4' }).addTo(map);
    setStatus(draw.pts.length + ' sommets. Cliquez sur le premier point ou double-cliquez pour fermer, Échap pour annuler.');
  }

  async function finishDraw() {
    if (!draw || draw.pts.length < 3) { setStatus('Il faut au moins trois sommets.', true); return; }
    const ll = draw.pts.map((p) => [+p.lat.toFixed(7), +p.lng.toFixed(7)]);
    cancelDraw(true);
    FS.project.setTarget({ ll, osmId: null, tags: {}, source: 'dessin' });
    FS.project.get().heightSrc = 'user';
    onChange('target');
    await reloadNeighbors();
  }

  // Voisins autour du bâtiment étudié (au changement de rayon, ou après un dessin)
  async function reloadNeighbors() {
    const P = FS.project.get();
    if (!P.target) return;
    const D = FS.project.derived();
    let ext = 0;
    for (const p of D.xy) ext = Math.max(ext, Math.hypot(p[0], p[1]));
    setStatus('Chargement des voisins (rayon ' + P.radius + ' m)…');
    try {
      const all = await FS.osm.buildingsAround(D.lat, D.lon, P.radius + ext);
      const users = {};
      for (const nb of P.neighbors) if (nb.src === 'user') users[nb.id] = nb.height;
      FS.project.setNeighbors(all);
      for (const nb of P.neighbors) if (users[nb.id] != null) { nb.height = users[nb.id]; nb.src = 'user'; }
      FS.project.invalidate();
      setStatus(P.neighbors.length + ' bâtiments voisins dans un rayon de ' + P.radius + ' m.');
      onChange('neighbors');
    } catch (err) {
      setStatus('Overpass indisponible (' + err.message + ') : voisins non chargés.', true);
    }
  }

  function fit() {
    const P = FS.project.get();
    if (!P.target || !map) return;
    map.fitBounds(L.latLngBounds(P.target.ll), { maxZoom: 18, padding: [60, 60] });
  }

  function flyTo(lat, lon) { map.setView([lat, lon], 18); }

  function render() {
    if (!map) return;
    layers.clearLayers();
    const P = FS.project.get();
    const accent = css('--accent'), ink = css('--ink'), muted = css('--muted'), orange = css('--c-orange');
    // voisins
    P.neighbors.forEach((nb, i) => {
      const hyp = nb.src === 'default';
      const poly = L.polygon(nb.ll, {
        color: hyp ? orange : ink, weight: hyp ? 1.4 : 0.8, opacity: hyp ? 0.9 : 0.6, dashArray: hyp ? '3 3' : null,
        fillColor: muted, fillOpacity: 0.35
      }).addTo(layers);
      poly.on('click', (e) => { L.DomEvent.stop(e); if (mode !== 'draw') neighborPopup(nb, i, e.latlng); });
      poly.bindTooltip(heightText(nb), { sticky: true, direction: 'top' });
    });
    if (!P.target) return;
    const D = FS.project.derived();
    L.polygon(P.target.ll, { color: accent, weight: 2.5, fillColor: accent, fillOpacity: 0.3, interactive: false }).addTo(layers);
    if (D.ok) {
      L.circle([D.lat, D.lon], { radius: P.radius, color: ink, weight: 1, dashArray: '2 6', fill: false, interactive: false }).addTo(layers);
      // façades : trait épais + numéro
      for (const f of D.model.facades) {
        for (const s of f.segs) {
          const a = D.proj.toLL(s.p0[0], s.p0[1]), b = D.proj.toLL(s.p1[0], s.p1[1]);
          L.polyline([a, b], { color: f.pignon ? muted : ink, weight: 4, interactive: false }).addTo(layers);
        }
        const off = 2.5 + 0.3 * Math.sqrt(f.length);
        const m = D.proj.toLL(f.mid[0] + f.n[0] * off, f.mid[1] + f.n[1] * off);
        L.marker(m, {
          interactive: false,
          icon: L.divIcon({ className: 'fac-label' + (f.pignon ? ' mito' : ''), html: String(f.id), iconSize: [20, 18] })
        }).addTo(layers);
      }
    }
  }

  function heightText(nb) {
    const src = { height: 'hauteur OSM', levels: 'niveaux OSM', default: 'hypothèse par défaut', user: 'saisie' }[nb.src];
    return FS.fmt(nb.height, 1) + ' m (' + src + ')';
  }

  function neighborPopup(nb, i, at) {
    const inp = FS.el('input', { type: 'number', min: 0, step: 0.5, value: nb.height });
    const box = FS.el('div', { style: { display: 'grid', gap: '6px', minWidth: '180px' } },
      FS.el('b', {}, 'Voisin ' + nb.id),
      FS.el('span', { class: 'muted' }, heightText(nb)),
      FS.el('label', { class: 'field' }, 'Hauteur (m)', inp),
      FS.el('button', {
        class: 'btn sm primary', onclick: () => {
          const v = FS.num(inp.value, nb.height);
          nb.height = Math.max(0, v); nb.src = 'user';
          FS.project.invalidate(); map.closePopup(); onChange('neighbors');
        }
      }, 'Appliquer'),
      FS.el('button', {
        class: 'btn sm ghost', onclick: () => {
          const P = FS.project.get();
          P.removed = (P.removed || []).concat(nb.id);
          P.neighbors.splice(P.neighbors.indexOf(nb), 1);
          FS.project.invalidate(); map.closePopup(); onChange('neighbors');
        }
      }, 'Retirer ce voisin (démoli, hors sujet)'));
    L.popup().setLatLng(at).setContent(box).openOn(map);
    setTimeout(() => inp.focus(), 50);
  }

  function invalidateSize() { if (map) setTimeout(() => map.invalidateSize(), 30); }

  FS.map = { init, render, setMode, getMode, fit, flyTo, reloadNeighbors, invalidateSize, leaflet: () => map, selectAt: (lat, lon) => onMapClick({ latlng: { lat, lng: lon } }) };
})(window.FS);
