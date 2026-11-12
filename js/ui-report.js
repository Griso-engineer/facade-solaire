/* Onglet Fiche offre : deux pages A4 paysage, imprimables en PDF par le navigateur.
   Page 1 : vue 3D, carte, messages clés, tableau de synthèse, hypothèses et avertissement.
   Page 2 : comparaison des variantes, rose des orientations, lumière, méthode résumée. */
(function (FS) {
  'use strict';
  const el = FS.el;
  let ui = {}, map = null, mapLayers = null, dirty = true, snap = null;

  function build() {
    const page = el('section', { class: 'page', id: 'page-fiche', hidden: true });
    page.append(el('div', { class: 'no-print' },
      FS.blockHead('07', 'Fiche offre', 'Synthèse sur deux pages A4 paysage, à imprimer en PDF. La vue 3D reprend le cadrage, la date, l\'heure et la coloration de l\'onglet Maquette 3D.'),
      el('div', { class: 'row-actions', style: { marginBottom: '16px' } },
        el('button', { class: 'btn primary', onclick: print }, 'Imprimer / enregistrer en PDF'),
        el('button', { class: 'btn', onclick: () => { snap = null; dirty = true; refresh(true); } }, 'Reprendre la vue 3D'),
        el('span', { class: 'status' }, 'Dans la boîte d\'impression : destination « Enregistrer au format PDF », orientation paysage, marges « aucune », graphiques d\'arrière-plan activés.'))));
    ui.sheets = el('div', { class: 'sheets' });
    page.append(ui.sheets);
    document.getElementById('app').append(page);
    return page;
  }

  let mapReady = Promise.resolve();
  async function print() {
    refresh(true);
    // attendre les tuiles de la carte (3 s au plus)
    try { await Promise.race([mapReady.then((p) => p), new Promise((r) => setTimeout(r, 3000))]); } catch (e) { /* carte indisponible */ }
    window.print();
  }
  // impression lancée depuis le menu du navigateur : recaler la carte sur le format papier
  window.addEventListener('beforeprint', () => { if (map) { map.invalidateSize(); if (lastBounds) map.fitBounds(lastBounds, { padding: [28, 28], maxZoom: 18 }); } });
  let lastBounds = null;

  function shown() { const p = document.getElementById('page-fiche'); return p && !p.hidden; }

  function refresh(force) {
    dirty = true; snap = null;
    if (!ui.sheets || (!shown() && !force)) return;
    render();
  }

  function render() {
    dirty = false;
    const P = FS.project.get(), D = FS.project.derived();
    ui.sheets.innerHTML = '';
    if (map) { map.remove(); map = null; }
    const R = FS.uiResults.get(), TR = FS.uiThermal.get(), DL = FS.uiDaylight.get(), c = FS.climate.get();
    if (!D.ok || !R) { ui.sheets.append(el('p', { class: 'muted' }, 'Sélectionnez un bâtiment et attendez le calcul.')); return; }
    const T = P.thermal, ref = TR ? TR[Math.min(T.ref, TR.length - 1)] : null;
    const msgs = FS.messages.generate({ P, D, R, TR, DL, climate: c });
    const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const title = P.name || 'Bâtiment étudié';
    const head = (sub) => el('header', { class: 'sh-head' },
      el('div', { class: 'sh-logo' }, 'tracés', el('i', {}, '.')),
      el('div', { class: 'sh-title' }, el('b', {}, 'Enjeux solaires et thermiques des façades'), el('span', {}, sub)),
      el('div', { class: 'sh-meta' }, el('b', {}, title), el('span', {}, shortAddr(P.address)), el('span', {}, date)));
    const foot = (n) => el('footer', { class: 'sh-foot' },
      el('span', {}, 'Ordres de grandeur pour la phase offre : ni simulation thermique dynamique, ni calcul réglementaire, ni étude d\'éclairement.'),
      el('span', {}, 'TRACÉS · bureau d\'études structures et façades · ' + n + '/2'));

    // ----- page 1 -----
    const mode = P.solar.color === 'none' ? 'annual' : P.solar.color;
    if (!snap) snap = FS.scene3d.snapshot(1200, 760);
    const view = P.view;
    const viewTxt = 'Vue 3D : ' + FS.charts.MODES[mode].label.toLowerCase() + ', ombres du ' +
      FS.solar.dateOfDoy(2026, view.doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }) + ' à ' + FS.solar.fmtHour(view.hour) + '.';
    const mapBox = el('div', { class: 'sh-map' });
    const tbl = synthesisTable(R, ref, DL);
    const sheet1 = el('section', { class: 'sheet' },
      head('Fiche d\'analyse : exposition, masques, apports, besoins, lumière'),
      el('div', { class: 'sh-body' },
        el('div', { class: 'sh-left' },
          el('figure', { class: 'sh-3d' }, snap ? el('img', { src: snap, alt: 'Maquette 3D' }) : el('div', { class: 'muted' }, '3D indisponible'),
            el('div', { class: 'sh-legend' }, FS.charts.legend(mode)), el('figcaption', {}, viewTxt)),
          el('figure', { class: 'sh-mapfig' }, mapBox, el('figcaption', {}, 'Bâtiment étudié (corail), façades numérotées, voisins pris en compte dans un rayon de ' + P.radius + ' m.'))),
        el('div', { class: 'sh-right' },
          el('div', { class: 'sh-msgs' }, el('h3', {}, 'Messages clés'), el('ol', {}, msgs.map((m) => el('li', {}, m.text)))),
          el('div', { class: 'sh-table' }, el('h3', {}, 'Synthèse par façade'), tbl),
          el('div', { class: 'sh-hyp' }, el('h3', {}, 'Hypothèses principales'), el('p', {}, hypText(P, D, R, c, ref))))),
      foot(1));
    ui.sheets.append(sheet1);

    // ----- page 2 -----
    const sheet2 = el('section', { class: 'sheet' }, head('Annexe : variantes de vitrage, orientations, lumière, méthode'));
    const body2 = el('div', { class: 'sh-body two' });
    const colL = el('div', {}), colR = el('div', {});
    if (TR) {
      const A = TR[0].totals.area;
      colL.append(el('h3', {}, 'Variantes de vitrage, bâtiment entier'),
        el('table', { class: 'tbl sh-tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, ''), TR.map((o, i) => el('th', { class: 'num' }, o.variant.name + (i === T.ref ? ' (réf.)' : ''))))),
          el('tbody', {},
            row('Uw / g / TL', TR.map((o) => FS.fmtFixed(o.variant.Uw, 1) + ' / ' + FS.fmtFixed(o.variant.g, 2) + ' / ' + FS.fmtFixed(o.variant.TL, 2))),
            row('Chauffage, kWh/m² de façade·an', TR.map((o) => FS.fmt(o.totals.QH / A, 0))),
            row('Froid, kWh/m² de façade·an', TR.map((o) => FS.fmt(o.totals.QC / A, 0))),
            row('Apports solaires vitrés, MWh/an', TR.map((o) => FS.fmt(o.totals.Qsol / 1000, 1))),
            row('Pic d\'apports, W/m² de plancher', TR.map((o) => FS.fmt(o.totals.peakGainFloor, 0) + ' (' + FS.thermal.riskLevel(o.totals.peakGainFloor).label + ')')))),
        FS.charts.groupBars(TR.map((o) => o.variant.name), [
          { name: 'Chauffage', color: FS.charts.HEAT, values: TR.map((o) => o.totals.QH / A) },
          { name: 'Froid', color: FS.charts.COOL, values: TR.map((o) => o.totals.QC / A) }
        ], { unit: 'kWh/m² de façade·an', labels: true, wrapLabels: true, height: 170 }),
        el('p', { class: 'sh-note' }, 'Protection solaire : ' + protText(T) + '. Consignes ' + T.tH + ' / ' + T.tC + ' °C, zone de façade de ' + FS.fmt(T.depth, 1) +
          ' m, renouvellement d\'air ' + FS.fmt(T.ach, 1) + ' vol/h, apports internes ' + FS.fmt(T.qInt, 0) + ' W/m², inertie ' + FS.thermal.INERTIA_LABEL[T.inertia].toLowerCase() + '.'));
    }
    colR.append(el('h3', {}, 'Rose des orientations'), el('div', { class: 'sh-rose' }, FS.charts.rose(R, 'annual', null)),
      el('p', { class: 'sh-note' }, 'Irradiation annuelle par façade (kWh/m²·an), masques compris.'));
    if (DL) {
      const fs = DL.filter((f) => !f.pignon && f.low);
      colR.append(el('h3', {}, 'Lumière naturelle (ordre de grandeur)'),
        el('table', { class: 'tbl sh-tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Façade'), el('th', { class: 'num' }, 'VSC bas / haut'), el('th', { class: 'num' }, 'FLJm bas / haut'))),
          el('tbody', {}, fs.map((f) => el('tr', {}, el('td', {}, f.id + ' · ' + f.label),
            el('td', { class: 'num' }, FS.pct(f.low.vsc) + ' / ' + FS.pct(f.high.vsc)),
            el('td', { class: 'num' }, FS.fmtFixed(f.low.adf, 1) + ' / ' + FS.fmtFixed(f.high.adf, 1) + ' %'))))),
        el('p', { class: 'sh-note' }, 'VSC : ciel visible (BRE), 39,6 % pour un mur dégagé, 27 % repère favorable. FLJm : pièce type de ' + FS.fmt(P.daylight.roomW, 1) + ' m × ' +
          FS.fmt(T.depth, 1) + ' m, formule BRE simplifiée ; ≥ 2 % pièce bien éclairée.'));
    }
    body2.append(colL, colR);
    sheet2.append(body2, el('div', { class: 'sh-method' }, el('h3', {}, 'Méthode, en bref'), el('p', {}, methodText(c))), foot(2));
    ui.sheets.append(sheet2);

    // carte (après insertion dans le document)
    // la carte a besoin d'un conteneur dimensionné : on la crée juste après l'insertion
    // (setTimeout plutôt que requestAnimationFrame, qui ne se déclenche pas dans un onglet en arrière-plan)
    mapReady = new Promise((resolve) => setTimeout(() => resolve(drawMap(mapBox, D, P)), 0));
  }

  function row(label, vals) { return el('tr', {}, el('td', {}, label), vals.map((v) => el('td', { class: 'num' }, v))); }

  function synthesisTable(R, ref, DL) {
    const tb = el('tbody');
    for (const f of R.facades) {
      const t = ref && ref.facades.find((x) => x.id === f.id);
      const d = DL && DL.find((x) => x.id === f.id);
      tb.append(el('tr', {},
        el('td', {}, el('b', {}, f.id)), el('td', {}, f.label + ' ' + Math.round(f.az) + '°'),
        el('td', { class: 'num' }, FS.fmt(f.area, 0) + ' / ' + FS.fmt(f.glazed, 0)),
        el('td', { class: 'num' }, el('span', { class: 'swatch', style: { background: FS.charts.colorFor('annual', f) } }), FS.fmt(f.annual, 0)),
        el('td', { class: 'num' }, R.masks ? '−' + FS.pct(f.maskLoss) : '—'),
        el('td', { class: 'num' }, FS.pct(f.shareSummer)),
        el('td', { class: 'num' }, FS.fmt(f.peak, 0)),
        el('td', { class: 'num' }, d && !d.pignon && d.low ? FS.pct(d.low.vsc) : '—'),
        el('td', { class: 'num' }, t ? FS.fmt(t.area ? t.QH / t.area : 0, 0) : '—'),
        el('td', { class: 'num' }, t ? FS.fmt(t.area ? t.QC / t.area : 0, 0) : '—')));
    }
    return el('table', { class: 'tbl sh-tbl' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'N°'), el('th', {}, 'Orient.'), el('th', { class: 'num' }, 'Façade /', el('br'), 'vitrage m²'),
        el('th', { class: 'num' }, 'Irradiation', el('br'), 'kWh/m²·an'), el('th', { class: 'num' }, 'Masques'),
        el('th', { class: 'num' }, 'Part des', el('br'), 'apports été'), el('th', { class: 'num' }, 'Pic été', el('br'), 'W/m²'), el('th', { class: 'num' }, 'VSC', el('br'), 'bas'),
        el('th', { class: 'num' }, 'Chauffage', el('br'), 'kWh/m²·an'), el('th', { class: 'num' }, 'Froid', el('br'), 'kWh/m²·an'))),
      tb);
  }

  function protText(T) {
    const p = T.protection;
    return p.mode === 'none' ? 'aucune' : p.mode === 'fc' ? 'mobile, Fc = ' + FS.fmtFixed(p.fc, 2) + ' au-delà de ' + p.threshold + ' W/m²' : 'mobile, g total = ' + FS.fmtFixed(p.gtot, 2) + ' au-delà de ' + p.threshold + ' W/m²';
  }

  function hypText(P, D, R, c, ref) {
    const nb = FS.project.effectiveNeighbors(P), hyp = nb.filter((n) => n.src === 'default').length;
    const H = 'Hauteur ' + FS.fmt(D.H, 1) + ' m (' + (FS.data.SRC_LABEL[P.heightSrc] || '') + '), ';
    return H + 'fraction vitrée ' + FS.pct(P.wwr) + (Object.keys(P.wwrOver).length ? ' (surchargée sur certaines façades)' : '') + '. ' +
      nb.length + ' bâtiments voisins dans ' + P.radius + ' m' + (hyp ? ', dont ' + hyp + ' de hauteur supposée (' + FS.fmt(P.nbDefaults.defaultH, 0) + ' m)' : '') + '. ' +
      'Climat : ' + (c ? c.label + (c.fallback ? ' (secours)' : '') : '—') + '. Masques ' + (R.masks ? 'compris' : 'non compris') + ', albédo ' + FS.fmtFixed(P.solar.albedo, 2) + '. ' +
      (ref ? 'Besoins pour « ' + ref.variant.name + ' » (Uw ' + FS.fmtFixed(ref.variant.Uw, 1) + ', g ' + FS.fmtFixed(ref.variant.g, 2) + '), protection solaire ' + protText(P.thermal) + '.' : '');
  }

  function methodText(c) {
    return 'Emprises et hauteurs : BD TOPO de l\'IGN (OpenStreetMap hors de France), cours intérieures comprises ; volumes à toit plat ; fenêtres théoriques au rythme parisien. Soleil : algorithme NOAA. Climat : année type construite sur la réanalyse ERA5 ' +
      (c ? c.years.join('–') : '') + ' (Open-Meteo), méthode de l\'ISO 15927-4. Rayonnement sur les façades : décomposition d\'Erbs, modèle de ciel de Perez, ' +
      'réfléchi par le sol ; écart à PVGIS inférieur à 4 % sur des façades sud, est et ouest dégagées à Paris. Masques : profil d\'horizon au degré près en chaque point ' +
      'de façade (≈ 2 m × 3 m), voisins et bâtiment lui-même. Besoins : méthode mensuelle quasi-stationnaire (NF EN ISO 13790) sur une zone de façade, ' +
      'sans systèmes, ponts thermiques, planchers ni toiture. Lumière : VSC sous ciel couvert CIE (BRE 209), FLJm par la formule BRE simplifiée. ' +
      'Détail et validation : onglet Méthode et tests de l\'outil.';
  }

  function shortAddr(a) { return a ? a.split(',').slice(0, 3).join(',') : ''; }

  function drawMap(box, D, P) {
    if (!window.L) return;
    map = L.map(box, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
    lastBounds = L.latLngBounds(P.target.ll);
    map.fitBounds(lastBounds, { padding: [28, 28], maxZoom: 18 });
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
    const loaded = new Promise((resolve) => { tiles.once('load', resolve); tiles.once('tileerror', resolve); });
    tiles.addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    for (const nb of FS.project.effectiveNeighbors(P)) L.polygon(nb.ll, { color: '#6e6d69', weight: 0.8, fillColor: '#6e6d69', fillOpacity: 0.3, interactive: false }).addTo(map);
    L.polygon([P.target.ll].concat(P.target.holes || []), { color: '#fb635f', weight: 2, fillColor: '#fb635f', fillOpacity: 0.45, interactive: false }).addTo(map);
    for (const f of D.model.facades) {
      const off = 3 + 0.3 * Math.sqrt(f.length);
      const m = D.proj.toLL(f.mid[0] + f.n[0] * off, f.mid[1] + f.n[1] * off);
      L.marker(m, { interactive: false, icon: L.divIcon({ className: 'fac-label' + (f.pignon ? ' mito' : ''), html: String(f.id), iconSize: [18, 16] }) }).addTo(map);
    }
    // flèche du nord
    const north = L.control({ position: 'topright' });
    north.onAdd = () => el('div', { class: 'north' }, el('span', {}, 'N'), el('i', {}));
    north.addTo(map);
    return loaded;
  }

  FS.uiReport = { build, refresh, onShow: () => { if (dirty) render(); else if (map) map.invalidateSize(); } };
})(window.FS);
