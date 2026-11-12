/* Carte Leaflet de l'onglet Site.

   Les emprises de tous les bâtiments de la vue sont affichées (BD TOPO IGN, sinon OSM) : ce qui
   est visible est cliquable. L'effet d'un clic dépend du mode, piloté par l'étape active :
     'pick'       étape « Bâtiment étudié » : choisir le bâtiment ;
     'draw'       dessiner l'emprise du bâtiment étudié ;
     'hole'       dessiner une cour intérieure dans l'emprise ;
     'nb'         étape « Masques » : cliquer un voisin pour corriger sa hauteur ou le retirer,
                  cliquer un autre bâtiment pour l'ajouter aux masques ;
     'draw-nb'    dessiner un bâtiment voisin, puis saisir sa hauteur ;
     'none'       consultation. */
(function (FS) {
  'use strict';
  let map = null, fpLayer = null, layers = null, banner = null;
  let mode = 'none', draw = null, onChange = () => {}, setStatus = () => {};
  const fp = new Map(); // emprises chargées, par identifiant
  let fpSource = null, loadingFp = false;

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const MODE_TEXT = {
    pick: 'Cliquez sur le bâtiment à étudier (contours fins : bâtiments disponibles).',
    draw: 'Dessin de l\'emprise : cliquez les sommets, fermez sur le premier point ou par double-clic. Échap : annuler.',
    hole: 'Cour intérieure : cliquez ses sommets à l\'intérieur de l\'emprise, fermez sur le premier point. Échap : annuler.',
    nb: 'Masques : cliquez un voisin (gris) pour corriger sa hauteur ou le retirer ; cliquez un autre bâtiment pour l\'ajouter.',
    'draw-nb': 'Voisin : cliquez ses sommets, fermez sur le premier point ; sa hauteur vous sera demandée. Échap : annuler.',
    none: ''
  };

  function init(el, opts) {
    onChange = opts.onChange || onChange;
    setStatus = opts.setStatus || setStatus;
    const P = FS.project.get();
    const mv = P.mapView || { lat: 48.8566, lon: 2.3522, z: 16 };
    map = L.map(el, { zoomControl: true }).setView([mv.lat, mv.lon], mv.z);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20, maxNativeZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a> · bâtiments © IGN BD TOPO'
    }).addTo(map);
    fpLayer = L.layerGroup().addTo(map);
    layers = L.layerGroup().addTo(map);
    banner = L.control({ position: 'topright' });
    banner.onAdd = () => { const d = FS.el('div', { class: 'map-banner', hidden: true }); L.DomEvent.disableClickPropagation(d); return d; };
    banner.addTo(map);
    map.on('click', onMapClick);
    map.on('dblclick', (e) => { if (draw) { L.DomEvent.stop(e); finishDraw(); } });
    map.on('moveend', FS.debounce(() => {
      const c = map.getCenter();
      FS.project.get().mapView = { lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6), z: map.getZoom() };
      FS.project.save();
      loadFootprints();
      render();
    }, 250));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && draw) cancelDraw(); });
    loadFootprints();
    render();
  }

  // ---------- Emprises de la vue ----------
  async function loadFootprints() {
    if (!map || map.getZoom() < 16 || loadingFp) { renderFootprints(); return; }
    const b = map.getBounds();
    const bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
    loadingFp = true;
    try {
      const r = await FS.data.inBBox(bb, FS.project.get().dataSource);
      fpSource = r.source;
      for (const x of r.list) if (!fp.has(x.id)) fp.set(x.id, x);
      if (fp.size > 6000) { // mémoire : on ne garde que la vue courante
        const keep = new Set(r.list.map((x) => x.id));
        for (const k of fp.keys()) if (!keep.has(k)) fp.delete(k);
      }
    } catch (e) {
      setStatus('Bâtiments indisponibles (' + e.message + '). Vous pouvez dessiner l\'emprise.', true);
    }
    loadingFp = false;
    renderFootprints();
  }

  function renderFootprints() {
    fpLayer.clearLayers();
    if (!map || map.getZoom() < 16) return;
    const P = FS.project.get();
    const used = new Set(FS.project.effectiveNeighbors(P).map((n) => n.id));
    if (P.target && P.target.id) used.add(P.target.id);
    const vb = map.getBounds().pad(0.2);
    const clickable = mode === 'pick' || mode === 'nb';
    for (const b of fp.values()) {
      if (used.has(b.id)) continue;
      if (!vb.contains(b.ll[0])) continue;
      const poly = L.polygon([b.ll].concat(b.holes || []), {
        color: clickable ? css('--accent') : css('--ink'), weight: clickable ? 1.1 : 0.6, opacity: clickable ? 0.85 : 0.25, fillColor: css('--accent'), fillOpacity: clickable ? 0.07 : 0, interactive: clickable,
        className: clickable ? 'fp-clickable' : ''
      }).addTo(fpLayer);
      if (clickable) {
        poly.on('mouseover', () => poly.setStyle({ fillColor: css('--accent'), fillOpacity: 0.25, weight: 1.5, color: css('--accent') }));
        poly.on('mouseout', () => poly.setStyle({ fillOpacity: 0.07, weight: 1.1, color: css('--accent') }));
        poly.on('click', (e) => { L.DomEvent.stop(e); onFootprint(b, e.latlng); });
        const h = FS.data.height(b, P.nbDefaults);
        poly.bindTooltip(FS.fmt(h.height, 1) + ' m · ' + FS.data.SRC_LABEL[h.src], { sticky: true, direction: 'top' });
      }
    }
  }

  async function onFootprint(b, at) {
    if (mode === 'pick') return selectBuilding(b);
    if (mode === 'nb') {
      // ajout manuel d'un bâtiment aux masques (hors rayon, ou en mode « voisins dessinés »)
      const P = FS.project.get();
      const h = FS.data.height(b, P.nbDefaults);
      P.drawn.push({ id: b.id, ll: b.ll, height: Math.round(h.height * 10) / 10, src: h.src === 'default' ? 'default' : 'user', source: b.source, added: true });
      P.removed = (P.removed || []).filter((x) => x !== b.id);
      FS.project.invalidate();
      setStatus('Bâtiment ajouté aux masques (' + FS.fmt(h.height, 1) + ' m, ' + FS.data.SRC_LABEL[h.src] + ').');
      onChange('neighbors');
    }
  }

  // ---------- Bâtiment étudié ----------
  async function selectBuilding(b) {
    FS.project.setTarget(b);
    const P = FS.project.get();
    const nm = (b.tags && (b.tags.name || [b.tags['addr:housenumber'], b.tags['addr:street']].filter(Boolean).join(' '))) || '';
    if (nm && !P.name) P.name = nm;
    setStatus('Bâtiment sélectionné (' + (b.source === 'ign' ? 'BD TOPO IGN' : 'OpenStreetMap') + '), ' + (b.holes && b.holes.length ? b.holes.length + ' cour(s) intérieure(s), ' : '') +
      'hauteur ' + FS.fmt(FS.project.height(P), 1) + ' m. Chargement des voisins…');
    onChange('target');
    await reloadNeighbors();
  }

  // Sélection par un point (lien direct ?lat=&lon=) : bâtiment contenant le point
  async function selectAt(lat, lon) {
    setStatus('Recherche du bâtiment…');
    try {
      const r = await FS.data.around(lat, lon, 60, FS.project.get().dataSource);
      for (const x of r.list) if (!fp.has(x.id)) fp.set(x.id, x);
      const proj = FS.geo.projector(lat, lon);
      const hit = r.list.find((b) => FS.geo.inside([0, 0], b.ll.map((q) => proj.toXY(q[0], q[1]))));
      if (!hit) { setStatus('Aucun bâtiment à ce point : cliquez une emprise ou dessinez-la.', true); return; }
      await selectBuilding(hit);
      fit();
    } catch (e) { setStatus('Bâtiments indisponibles (' + e.message + ').', true); }
  }

  // Voisins lus dans le rayon autour du bâtiment étudié
  async function reloadNeighbors() {
    const P = FS.project.get();
    if (!P.target) return;
    const D = FS.project.derived();
    let ext = 0;
    for (const p of D.xy) ext = Math.max(ext, Math.hypot(p[0], p[1]));
    setStatus('Chargement des voisins (rayon ' + P.radius + ' m)…');
    try {
      const r = await FS.data.around(D.lat, D.lon, P.radius + ext, P.dataSource);
      for (const x of r.list) if (!fp.has(x.id)) fp.set(x.id, x);
      const users = {};
      for (const nb of P.neighbors) if (nb.src === 'user') users[nb.id] = nb.height;
      FS.project.setNeighbors(r.list);
      for (const nb of P.neighbors) if (users[nb.id] != null) { nb.height = users[nb.id]; nb.src = 'user'; }
      FS.project.invalidate();
      const hyp = P.neighbors.filter((n) => n.src === 'default').length;
      setStatus(P.neighbors.length + ' voisins dans ' + P.radius + ' m (' + (r.source === 'ign' ? 'BD TOPO IGN' : 'OpenStreetMap') + ')' +
        (hyp ? ', dont ' + hyp + ' sans hauteur connue (hypothèse ' + FS.fmt(P.nbDefaults.defaultH, 0) + ' m)' : ', tous avec une hauteur connue') + '.');
      onChange('neighbors');
    } catch (err) {
      setStatus('Voisins non chargés (' + err.message + ') : passez en « voisins dessinés ».', true);
    }
  }

  // ---------- Modes et dessin ----------
  function setMode(m) {
    if (draw) cancelDraw(true);
    mode = m;
    if (m === 'draw' || m === 'hole' || m === 'draw-nb') {
      draw = { kind: m, pts: [], marks: [], line: null };
      map.doubleClickZoom.disable();
      map.getContainer().style.cursor = 'crosshair';
    }
    renderFootprints();
    renderBanner();
  }
  const getMode = () => mode;

  function renderBanner() {
    const d = banner && banner.getContainer();
    if (!d) return;
    d.textContent = mode === 'pick' && FS.project.get().target ? 'Bâtiment choisi (corail). Cliquez un autre contour pour changer, ou dessinez l\'emprise.' : (MODE_TEXT[mode] || '');
    d.hidden = !MODE_TEXT[mode];
    d.classList.toggle('drawing', !!draw);
  }

  function cancelDraw(silent) {
    if (draw) { if (draw.line) draw.line.remove(); draw.marks.forEach((m) => m.remove()); }
    draw = null;
    if (map) { map.doubleClickZoom.enable(); map.getContainer().style.cursor = ''; }
    if (!silent) { mode = mode === 'draw-nb' ? 'nb' : mode === 'draw' || mode === 'hole' ? 'pick' : mode; renderFootprints(); renderBanner(); onChange('mode'); }
  }

  function onMapClick(e) {
    if (draw) return addDrawPoint(e.latlng);
  }

  function addDrawPoint(p) {
    if (draw.pts.length >= 3) {
      const a = map.latLngToContainerPoint(draw.pts[0]), b = map.latLngToContainerPoint(p);
      if (a.distanceTo(b) < 12) return finishDraw();
    }
    const last = draw.pts[draw.pts.length - 1];
    if (last && map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(p)) < 3) return;
    draw.pts.push(p);
    const col = draw.kind === 'draw-nb' ? css('--muted') : css('--accent');
    draw.marks.push(L.circleMarker(p, { radius: 4, color: col, weight: 2, fillOpacity: 1 }).addTo(map));
    if (draw.line) draw.line.setLatLngs(draw.pts);
    else draw.line = L.polyline(draw.pts, { color: col, weight: 2, dashArray: '4 4' }).addTo(map);
  }

  async function finishDraw() {
    if (!draw || draw.pts.length < 3) { setStatus('Il faut au moins trois sommets.', true); return; }
    const kind = draw.kind;
    const ll = draw.pts.map((p) => [+p.lat.toFixed(7), +p.lng.toFixed(7)]);
    const P = FS.project.get();
    cancelDraw(true);
    if (kind === 'draw') {
      FS.project.setTarget({ ll, holes: [], source: 'dessin' });
      mode = 'pick';
      setStatus('Emprise dessinée. Ajoutez des cours si besoin, puis réglez la hauteur.');
      renderBanner();
      onChange('target');
      if (P.nbMode === 'auto') await reloadNeighbors();
    } else if (kind === 'hole') {
      const proj = FS.geo.projector(ll[0][0], ll[0][1]);
      const outer = P.target.ll.map((q) => proj.toXY(q[0], q[1]));
      const c = FS.geo.centroid(ll.map((q) => proj.toXY(q[0], q[1])));
      if (!FS.geo.inside(c, outer)) { setStatus('La cour doit être dessinée à l\'intérieur de l\'emprise.', true); mode = 'pick'; renderBanner(); return; }
      P.target.holes = (P.target.holes || []).concat([ll]);
      P.wwrOver = {};
      FS.project.invalidate();
      mode = 'pick';
      renderBanner();
      setStatus('Cour intérieure ajoutée (' + P.target.holes.length + ' au total) : ses façades sont numérotées après celles du contour.');
      onChange('geom');
    } else if (kind === 'draw-nb') {
      mode = 'nb';
      renderBanner();
      askHeight(ll);
    }
  }

  // Hauteur d'un voisin dessiné : petite fenêtre sur la carte
  function askHeight(ll) {
    const P = FS.project.get();
    const c = ll.reduce((a, q) => [a[0] + q[0] / ll.length, a[1] + q[1] / ll.length], [0, 0]);
    const inp = FS.el('input', { type: 'number', min: 0, step: 0.5, value: P.nbDefaults.defaultH });
    const preview = L.polygon(ll, { color: css('--muted'), weight: 1.5, dashArray: '4 3', fillOpacity: 0.2 }).addTo(map);
    const ok = () => {
      const h = Math.max(0, FS.num(inp.value, P.nbDefaults.defaultH));
      P.drawn.push({ id: 'd' + Date.now().toString(36), ll, height: h, src: 'user', source: 'dessin' });
      FS.project.invalidate();
      map.closePopup();
      setStatus('Voisin dessiné ajouté (' + FS.fmt(h, 1) + ' m).');
      onChange('neighbors');
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const box = FS.el('div', { class: 'pop' },
      FS.el('b', {}, 'Nouveau voisin'),
      FS.el('label', { class: 'field' }, 'Hauteur (m)', inp),
      FS.el('div', { class: 'row-actions' }, FS.el('button', { class: 'btn sm primary', onclick: ok }, 'Ajouter'),
        FS.el('button', { class: 'btn sm ghost', onclick: () => map.closePopup() }, 'Annuler')));
    L.popup({ closeOnClick: false }).setLatLng(c).setContent(box).openOn(map);
    map.once('popupclose', () => preview.remove());
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }

  function fit() {
    const P = FS.project.get();
    if (!P.target || !map) return;
    map.fitBounds(L.latLngBounds(P.target.ll), { maxZoom: 18, padding: [60, 60] });
  }
  function flyTo(lat, lon) { map.setView([lat, lon], 18); }

  // ---------- Rendu ----------
  function render() {
    if (!map) return;
    layers.clearLayers();
    renderBanner();
    renderFootprints();
    const P = FS.project.get();
    const accent = css('--accent'), ink = css('--ink'), muted = css('--muted'), orange = css('--c-orange');
    const showLabels = map.getZoom() >= 17;
    for (const nb of FS.project.effectiveNeighbors(P)) {
      const hyp = FS.data.isHyp(nb.src), drawn = nb.source === 'dessin' || nb.added;
      const poly = L.polygon(nb.ll, {
        color: hyp ? orange : drawn ? ink : ink, weight: hyp ? 1.4 : drawn ? 1.4 : 0.8, opacity: hyp ? 0.9 : 0.7,
        dashArray: hyp ? '3 3' : null, fillColor: muted, fillOpacity: drawn ? 0.45 : 0.32, interactive: mode === 'nb' || mode === 'none'
      }).addTo(layers);
      poly.on('click', (e) => { L.DomEvent.stop(e); if (!draw) neighborPopup(nb, e.latlng); });
      poly.bindTooltip(heightText(nb), { sticky: true, direction: 'top' });
      if (showLabels) {
        const c = nb.ll.reduce((a, q) => [a[0] + q[0] / nb.ll.length, a[1] + q[1] / nb.ll.length], [0, 0]);
        L.marker(c, { interactive: false, icon: L.divIcon({ className: 'nb-h' + (hyp ? ' hyp' : ''), html: FS.fmt(nb.height, 0), iconSize: [30, 14] }) }).addTo(layers);
      }
    }
    if (!P.target) return;
    const D = FS.project.derived();
    L.polygon([P.target.ll].concat(P.target.holes || []), { color: accent, weight: 2.5, fillColor: accent, fillOpacity: 0.3, interactive: false }).addTo(layers);
    if (D.ok) {
      if (P.nbMode === 'auto') L.circle([D.lat, D.lon], { radius: P.radius, color: ink, weight: 1, dashArray: '2 6', fill: false, interactive: false }).addTo(layers);
      for (const f of D.model.facades) {
        for (const s of f.segs) {
          const a = D.proj.toLL(s.p0[0], s.p0[1]), b = D.proj.toLL(s.p1[0], s.p1[1]);
          L.polyline([a, b], { color: f.pignon ? muted : ink, weight: 4, interactive: false }).addTo(layers);
        }
        const off = 2.5 + 0.3 * Math.sqrt(f.length);
        const m = D.proj.toLL(f.mid[0] + f.n[0] * off, f.mid[1] + f.n[1] * off);
        L.marker(m, { interactive: false, icon: L.divIcon({ className: 'fac-label' + (f.pignon ? ' mito' : ''), html: String(f.id), iconSize: [20, 18] }) }).addTo(layers);
      }
      // hauteur du bâtiment étudié, en évidence sur la carte
      const H = D.H, lv = P.heightMode === 'levels' ? P.levels : Math.max(1, Math.round(H / P.floorH));
      const ok = FS.project.step('target') === 'ok';
      const html = '<b>' + FS.fmt(H, 1) + ' m</b><span>R+' + Math.max(0, lv - 1) + ' · ' + FS.fmt(D.model.footprintArea, 0) + ' m²' +
        (D.holes.length ? ' · ' + D.holes.length + ' cour' + (D.holes.length > 1 ? 's' : '') : '') + '</span>' + (ok ? '<i>✓</i>' : '');
      // étiquette posée au-dessus de l'emprise (point le plus au nord), pour ne pas la masquer
      const top = D.xy.reduce((a, q) => (q[1] > a[1] ? q : a), D.xy[0]);
      const c = D.proj.toLL(FS.geo.centroid(D.xy)[0], top[1] + 4);
      L.marker(c, { interactive: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'h-chip' + (ok ? ' ok' : ''), html, iconSize: null }) }).addTo(layers);
    }
  }

  function heightText(nb) {
    return FS.fmt(nb.height, 1) + ' m (' + (nb.source === 'dessin' ? 'voisin dessiné' : FS.data.SRC_LABEL[nb.src] || nb.src) + ')';
  }

  function neighborPopup(nb, at) {
    const P = FS.project.get();
    const inp = FS.el('input', { type: 'number', min: 0, step: 0.5, value: nb.height });
    const apply = () => {
      nb.height = Math.max(0, FS.num(inp.value, nb.height)); nb.src = 'user';
      FS.project.invalidate(); map.closePopup(); onChange('neighbors');
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    const box = FS.el('div', { class: 'pop' },
      FS.el('b', {}, 'Bâtiment voisin'),
      FS.el('span', { class: 'muted' }, heightText(nb)),
      FS.el('label', { class: 'field' }, 'Hauteur (m)', inp),
      FS.el('div', { class: 'row-actions' },
        FS.el('button', { class: 'btn sm primary', onclick: apply }, 'Appliquer'),
        FS.el('button', {
          class: 'btn sm ghost', onclick: () => {
            const i = P.drawn.indexOf(nb);
            if (i >= 0) P.drawn.splice(i, 1);
            else { P.removed = (P.removed || []).concat(nb.id); P.neighbors.splice(P.neighbors.indexOf(nb), 1); }
            FS.project.invalidate(); map.closePopup(); onChange('neighbors');
          }
        }, 'Retirer des masques')));
    L.popup().setLatLng(at).setContent(box).openOn(map);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }

  function invalidateSize() { if (map) setTimeout(() => map.invalidateSize(), 30); }
  function refreshFootprints() { fp.clear(); loadFootprints(); }

  FS.map = {
    init, render, setMode, getMode, fit, flyTo, reloadNeighbors, invalidateSize, selectAt, refreshFootprints,
    leaflet: () => map, source: () => fpSource
  };
})(window.FS);
