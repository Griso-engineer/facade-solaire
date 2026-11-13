/* Onglet Exposition : rayonnement reçu par les façades, moyennes par jour et par saison,
   positionnement du bâtiment par rapport à des repères connus, masques. */
(function (FS) {
  'use strict';
  const el = FS.el;
  let ui = {}, R = null, sel = null, climateMsg = '', climateErr = false, loading = false, lastKey = null, maskLevel = 1;
  const SEASONS = ['annee', 'printemps', 'ete', 'automne', 'hiver'];

  // ---------- Climat ----------
  async function ensureClimate(force) {
    const D = FS.project.derived();
    if (!D.ok) return;
    const k = (Math.round(D.lat * 4) / 4).toFixed(2) + ',' + (Math.round(D.lon * 4) / 4).toFixed(2);
    if (!force && lastKey === k && FS.climate.get()) return;
    lastKey = k;
    loading = true; climateMsg = 'Chargement du climat (ERA5 via Open-Meteo)…'; climateErr = false; refresh();
    try {
      await FS.climate.load(D.lat, D.lon, { force });
      climateMsg = '';
    } catch (e) {
      FS.climate.fallback();
      const dkm = distKm(D.lat, D.lon, 48.8566, 2.3522);
      climateErr = true;
      climateMsg = 'Open-Meteo indisponible (' + e.message + ') : climat de secours de Paris utilisé' +
        (dkm > 50 ? ', à ' + FS.fmt(dkm, 0) + ' km du site. Résultats à prendre avec prudence.' : '.');
    }
    loading = false;
    const c = FS.climate.get();
    FS.project.get().climateInfo = { label: c.label, gridLat: c.gridLat, gridLon: c.gridLon, chosen: c.chosen, fallback: !!c.fallback };
    FS.project.save();
    refresh();
  }
  function distKm(a, b, c, d) {
    const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
    return Math.hypot(x, y) * 6371;
  }

  const refVariant = (P) => { const T = P.thermal; return T.variants[Math.min(T.ref, T.variants.length - 1)]; };
  // g effectif des baies : g du vitrage × (1 − part de menuiserie) × F_w (0,9), comme dans le bilan thermique
  function solarOpts(P) { const v = refVariant(P); return Object.assign({}, P.solar, { g: (v ? v.g : 0.6) * (1 - P.thermal.frame) * FS.thermal.F_W, gGlass: v ? v.g : 0.6, reveal: P.reveal || 0 }); }

  function compute() {
    const D = FS.project.derived(), c = FS.climate.get(), P0 = FS.project.get();
    // les apports vitrés de l'exposition utilisent le g de la variante de référence (onglet Thermique)
    R = (D.ok && c) ? FS.results.compute(D, c, solarOpts(P0)) : null;
    if (R && (sel == null || !R.facades.some((f) => f.id === sel))) {
      sel = R.facades.length ? R.facades.reduce((a, f) => (f.annual > a.annual ? f : a)).id : null;
    }
    return R;
  }

  // ---------- Onglet ----------
  function build() {
    const P = FS.project.get();
    const page = el('section', { class: 'page', id: 'page-resultats', hidden: true });
    page.append(FS.blockHead('04', 'Exposition solaire',
      'Rayonnement reçu par chaque façade sur une année type, masques compris, et ce qu\'il représente pour le bâtiment : apports par les vitrages comparés à des repères connus.'));
    ui.climateLine = el('div', { class: 'climate-line' });
    page.append(ui.climateLine);
    ui.main = el('div', {});
    const chipsModel = el('div', { class: 'chips' },
      ['perez', 'isotrope'].map((m) => el('button', { class: 'chip', 'data-m': m, onclick: () => { P.solar.model = m; FS.app.update('solar'); } }, m === 'perez' ? 'Perez (anisotrope)' : 'Isotrope')));
    const chipsSplit = el('div', { class: 'chips' },
      [['erbs', 'Erbs (recalculé)'], ['era5', 'ERA5 brut']].map(([m, lab]) => el('button', { class: 'chip', 'data-m': m, onclick: () => { P.solar.split = m; FS.app.update('solar'); } }, lab)));
    const chipsMask = el('div', { class: 'chips' },
      [[true, 'Avec masques'], [false, 'Sans masques']].map(([m, lab]) => el('button', { class: 'chip', 'data-m': String(m), onclick: () => { P.solar.masks = m; FS.app.update('solar'); } }, lab)));
    const alb = el('input', { type: 'number', min: 0, max: 0.9, step: 0.05, value: P.solar.albedo });
    alb.addEventListener('change', () => { P.solar.albedo = FS.clamp(FS.num(alb.value, 0.2), 0, 0.9); FS.app.update('solar'); });
    Object.assign(ui, { chipsModel, chipsSplit, chipsMask, alb, g: el('div', { class: 'status' }) });
    const side = el('aside', { class: 'side' },
      el('div', { class: 'panel' }, el('h3', {}, 'Hypothèses'),
        el('label', { class: 'field' }, 'Masques (voisins et bâtiment)', chipsMask),
        el('label', { class: 'field' }, 'Partage direct / diffus', chipsSplit),
        el('label', { class: 'field' }, 'Modèle du diffus sur les façades', chipsModel),
        el('div', { class: 'grid2' },
          el('label', { class: 'field' }, el('span', {}, 'Albédo du sol'), alb),
          el('label', { class: 'field' }, el('span', {}, 'Facteur solaire g'), ui.g)),
        el('small', {}, 'Les vitrages et protections solaires se règlent dans l\'onglet Thermique ; fraction vitrée et profondeur de tableau, dans l\'onglet Site.')));
    page.append(el('div', { class: 'work' }, ui.main, side));
    document.getElementById('app').append(page);
    return page;
  }

  function kpi(value, label) { return el('div', { class: 'kpi' }, el('b', {}, value), el('span', {}, label)); }

  function refresh() {
    refreshMain();
    if (FS.uiThermal) FS.uiThermal.refresh();
    if (FS.uiDaylight) FS.uiDaylight.refresh();
    if (FS.uiReport) FS.uiReport.refresh();
  }

  function refreshMain() {
    if (!ui.main) return;
    const P = FS.project.get(), D = FS.project.derived();
    ui.chipsModel.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.m === P.solar.model));
    ui.chipsSplit.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.m === (P.solar.split || 'erbs')));
    ui.chipsMask.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.m === String(P.solar.masks !== false)));
    if (document.activeElement !== ui.alb) ui.alb.value = P.solar.albedo;
    { const v = refVariant(P); ui.g.textContent = FS.fmtFixed(v ? v.g : 0.6, 2) + ' : ' + (v ? v.name : '—') + ' (variante de référence)'; }
    if (D.ok && !loading) compute(); else if (!D.ok) R = null;
    renderClimateLine();
    if (FS.view3d) FS.view3d.refresh();
    ui.main.innerHTML = '';
    if (!D.ok) { ui.main.append(el('p', { class: 'muted' }, 'Sélectionnez un bâtiment dans l\'onglet Site.')); return; }
    if (!R) { ui.main.append(el('p', { class: 'status' }, loading ? 'Calcul en attente du climat…' : 'Climat non chargé.')); return; }
    const fs = R.facades;
    if (!fs.length) { ui.main.append(el('p', { class: 'muted' }, 'Aucune façade analysée (toutes ignorées ?).')); return; }

    renderPositioning(P, D, fs);
    renderTable(P, D, fs);
    renderCharts(P, D, fs);
  }

  function renderClimateLine() {
    const c = FS.climate.get();
    ui.climateLine.innerHTML = '';
    if (climateMsg) ui.climateLine.append(el('p', { class: 'note ' + (climateErr ? 'warn' : '') }, climateMsg));
    if (c) ui.climateLine.append('Climat : ' + c.label + ', maille ERA5 ' + FS.fmtFixed(c.gridLat, 2) + '° N, ' + FS.fmtFixed(c.gridLon, 2) + '° E. ',
      el('button', { class: 'btn sm ghost', onclick: () => ensureClimate(true), disabled: loading }, 'Recharger'));
  }

  // ---------- Positionnement : est-ce beaucoup ? ----------
  function renderPositioning(P, D, fs) {
    const T = P.thermal, fh = P.floorH, depth = T.depth, g = R.opts.g;
    const floorOf = (f) => f.area / fh * depth;
    const glazedF = fs.filter((f) => f.glazed > 0);
    if (!glazedF.length) return;
    const wpm2 = (f) => f.peakGain / floorOf(f);
    const worst = glazedF.reduce((a, f) => (wpm2(f) > wpm2(a) ? f : a));
    const avg = glazedF.reduce((a, f) => a + f.peakGain, 0) / glazedF.reduce((a, f) => a + floorOf(f), 0);
    // références : murs dégagés, 40 % vitrés, même vitrage, sur le climat du site
    const refs = FS.results.references(FS.climate.get(), D.lat, D.lon, solarOpts(P));
    const byLab = (l) => refs.find((r) => r.label === l);
    const refW = (l, k) => byLab(l).peak * 0.4 * g / (depth / fh) * (k || 1);
    const refList = [{ v: refW('N'), label: 'nord' }, { v: refW('E'), label: 'est' }, { v: refW('S'), label: 'sud' }, { v: refW('O'), label: 'ouest' },
      { v: refW('O', 0.25), label: 'ouest + store ext.' }];
    const max = Math.max(100, Math.ceil(Math.max(wpm2(worst), ...refList.map((r) => r.v)) * 1.1 / 25) * 25);
    // repères proches (moins de 4 % de l'échelle) regroupés sous une seule étiquette
    const merged = [];
    for (const r of refList.slice().sort((a, b) => a.v - b.v)) {
      const last = merged[merged.length - 1];
      if (last && r.v - last.v < 0.04 * max) { last.label += ', ' + r.label; last.v = (last.v + r.v) / 2; } else merged.push(Object.assign({}, r));
    }
    merged.forEach((r) => { if (r.label.indexOf('store') < 0) r.label += ' 40 %'; });
    const zones = [
      { to: 25, label: 'faible', color: FS.charts.colorAt(0.32) },
      { to: 50, label: 'modéré', color: FS.charts.colorAt(0.5) },
      { to: max, label: 'élevé : protection solaire nécessaire', color: FS.charts.colorAt(0.92) }
    ];
    const head = el('div', { class: 'section-title' }, el('h3', {}, 'Ce que représente le soleil sur ce bâtiment'),
      el('small', {}, 'Pic d\'apports solaires d\'été par les vitrages, par m² de plancher derrière la façade (g effectif des baies ' + FS.fmtFixed(g, 2) + ' : vitrage × menuiserie × incidence ; masques et tableau compris)'));
    const gauge = FS.charts.gauge(max, zones, merged,
      [{ v: wpm2(worst), label: 'façade ' + worst.id + ' (' + FS.orientName[worst.label] + ') : ' + FS.fmt(wpm2(worst), 0) + ' W/m²', strong: true },
        { v: avg, label: 'moyenne du bâtiment : ' + FS.fmt(avg, 0) + ' W/m²' }], 'W/m²');
    // équivalences
    const room = wpm2(worst) * 20;
    const sumDay = R.totals.gainsSummer / 92, winDay = R.totals.gainsWinter / 90;
    let winShare = null;
    try {
      const o = FS.thermal.compute(D, R, FS.climate.get(), Object.assign({}, T, { variants: [refVariant(P)], ref: 0 }), fh)[0];
      let sol = 0, loss = 0;
      for (const f of o.facades) for (const m of [11, 0, 1]) { sol += f.months[m].QsolW; loss += f.months[m].QhtH; }
      winShare = loss > 0 ? sol / loss : null;
    } catch (e) { winShare = null; }
    const card = (big, title, text, pict) => el('div', {}, el('span', {}, title), el('b', { class: 'big' }, big), pict || null, el('span', {}, text));
    ui.main.append(head, gauge,
      el('p', { class: 'status' }, 'Repères : murs dégagés de même vitrage, 40 % vitrés, sur le climat du site. En dessous de 25 W/m², les apports solaires restent du même ordre que les apports internes d\'un bureau (personnes, ordinateurs, éclairage : 10 à 25 W/m²) ; au-delà de 50 W/m², ils dominent et la pièce surchauffe sans protection.'),
      el('div', { class: 'bench' },
        card(FS.fmt(room, 0) + ' W', 'Dans un bureau de 20 m² derrière la façade ' + worst.id + ', au pic d\'été',
          '≈ ' + FS.fmt(Math.round(room / 500) / 2, 1) + ' radiateur(s) électrique(s) de 1 000 W allumé(s) en plein été.', FS.charts.radiators(room / 1000)),
        card(FS.fmt(sumDay, 0) + ' kWh/jour', 'Apports solaires d\'été par les vitrages (bâtiment, juin–août)',
          '≈ ' + FS.fmt(sumDay / 24, 1) + ' radiateurs de 1 kW allumés 24 h sur 24, à évacuer par la ventilation ou la climatisation.', FS.charts.radiators(sumDay / 24)),
        card(FS.fmt(winDay, 0) + ' kWh/jour', 'Apports solaires d\'hiver par les vitrages (déc.–févr.)',
          (winShare != null ? 'Soit ≈ ' + FS.pct(winShare) + ' des déperditions des zones de façade en hiver (' + refVariant(P).name.toLowerCase() + ') : ' : '') +
          'des apports gratuits, à préserver par des protections mobiles plutôt que fixes.')));
    // indicateurs principaux
    const top = fs.reduce((a, f) => (f.daily.annee > a.daily.annee ? f : a));
    const topS = fs.reduce((a, f) => (f.gainsSummer > a.gainsSummer ? f : a));
    const loss = R.totals.incident0 ? 1 - R.totals.incident / R.totals.incident0 : 0;
    ui.main.append(el('div', { class: 'kpis' },
      kpi(FS.fmtFixed(R.totals.incident / R.totals.area / 365, 1) + ' kWh/m²·j', 'reçus en moyenne par les façades analysées' + (R.masks ? ', ' + FS.pct(loss) + ' de moins qu\'en site dégagé' : '')),
      kpi(FS.fmtFixed(top.daily.annee, 1) + ' kWh/m²·j', 'façade ' + top.id + ' (' + FS.orientName[top.label] + '), la plus exposée'),
      kpi(FS.pct(topS.shareSummer), 'des apports d\'été par les vitrages passent par la façade ' + topS.id + ' (' + FS.orientName[topS.label] + ')'),
      kpi(FS.fmt(fs.reduce((a, f) => Math.max(a, f.peak), 0), 0) + ' W/m²', 'pic horaire d\'été sur une façade (juin–août)')));
  }

  // ---------- Tableau ----------
  function renderTable(P, D, fs) {
    const tb = el('tbody'), T = R.totals;
    const sw = (v) => el('span', { class: 'swatch', style: { background: FS.charts.colorAt(v / 4) } });
    for (const f of fs) {
      tb.append(el('tr', { class: f.id === sel ? 'sel' : '' },
        el('td', {}, el('b', {}, f.id)),
        el('td', { style: { whiteSpace: 'nowrap' } }, f.label + (f.cour ? ' (cour)' : '')),
        el('td', { class: 'num' }, Math.round(f.az) + '°'),
        el('td', { class: 'num' }, FS.fmt(f.area, 0)),
        el('td', { class: 'num' }, FS.fmt(f.glazed, 0) + ' (' + FS.pct(f.wwr) + ')'),
        el('td', { class: 'num' }, R.masks ? '−' + FS.pct(Math.max(0, f.maskLoss)) : '—'),
        SEASONS.map((s) => el('td', { class: 'num' + (s === 'annee' ? ' hl' : '') }, s === 'annee' ? sw(f.daily[s]) : null, FS.fmtFixed(f.daily[s], 1))),
        el('td', { class: 'num' }, FS.fmt(f.peak, 0)),
        el('td', { class: 'num' }, FS.fmt(f.gainsSummer / 1000, 1)),
        el('td', { class: 'num' }, FS.pct(f.shareSummer)),
        el('td', { class: 'num' }, FS.fmt(f.peakGain / 1000, 1))));
    }
    const mean = (s) => fs.reduce((a, f) => a + f.daily[s] * f.area, 0) / T.area;
    const loss = T.incident0 ? 1 - T.incident / T.incident0 : 0;
    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Rayonnement reçu par façade'), el('small', {}, 'moyenne par jour, nuits comprises')));
    ui.main.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'N°'), el('th', {}, 'Or.'), el('th', { class: 'num' }, 'Azimut'), el('th', { class: 'num' }, 'Façade'), el('th', { class: 'num' }, 'Vitrage'),
          el('th', { class: 'num' }, 'Masques'), SEASONS.map((s) => el('th', { class: 'num' }, FS.results.SEASON_LABEL[s])),
          el('th', { class: 'num' }, 'Pic été'), el('th', { class: 'num' }, 'Apports été'), el('th', { class: 'num' }, 'Part été'), el('th', { class: 'num' }, 'Pic apports')),
        el('tr', { class: 'units' },
          el('th', {}), el('th', {}), el('th', {}), el('th', { class: 'num' }, el('small', {}, 'm²')), el('th', { class: 'num' }, el('small', {}, 'm²')), el('th', {}),
          el('th', { class: 'num', colspan: 5 }, el('small', {}, 'kWh/m²·jour : année · printemps (mars–mai) · été (juin–août) · automne (sept.–nov.) · hiver (déc.–févr.)')),
          el('th', { class: 'num' }, el('small', {}, 'W/m²')), el('th', { class: 'num' }, el('small', {}, 'MWh')), el('th', {}), el('th', { class: 'num' }, el('small', {}, 'kW')))),
      tb,
      el('tfoot', {}, el('tr', {},
        el('td', { colspan: 3 }, el('b', {}, 'Ensemble')), el('td', { class: 'num' }, FS.fmt(T.area, 0)), el('td', { class: 'num' }, FS.fmt(T.glazed, 0)),
        el('td', { class: 'num' }, R.masks ? '−' + FS.pct(Math.max(0, loss)) : '—'),
        SEASONS.map((s) => el('td', { class: 'num' }, el('b', {}, FS.fmtFixed(mean(s), 1)))),
        el('td', {}), el('td', { class: 'num' }, el('b', {}, FS.fmt(T.gainsSummer / 1000, 1))), el('td', { class: 'num' }, '100 %'), el('td', {}))))));
    // choix de la façade détaillée
    ui.main.append(el('div', { class: 'chips fac-chips' }, el('span', { class: 'status', style: { alignSelf: 'center', marginRight: '8px' } }, 'Façade détaillée :'),
      fs.map((f) => el('button', { class: 'chip' + (f.id === sel ? ' on' : ''), onclick: () => { sel = f.id; FS.scene3d.select(f.id); refreshMain(); } }, f.id + ' · ' + f.label))));
    const ign = D.model.facades.filter((f) => f.ignored).map((f) => f.id);
    ui.main.append(el('p', { class: 'status' },
      'Moyenne par jour : énergie reçue sur la période divisée par son nombre de jours. Pic été : irradiance horaire maximale de juin à août. ' +
      'Apports : rayonnement sur les vitrages (tableau de ' + FS.fmt((R.reveal || 0) * 100, 0) + ' cm compris) × surface de baie × g effectif ' + FS.fmtFixed(R.opts.g, 2) + ' (g du vitrage ' + FS.fmtFixed(R.opts.gGlass, 2) + ' × (1 − part de menuiserie) × 0,9 pour l\'incidence), sans protection solaire. ' +
      (ign.length ? 'Façades ignorées : ' + ign.join(', ') + '. ' : '') +
      FS.fmt(R.nPts, 0) + ' points de calcul, calcul en ' + FS.fmt(R.ms, 0) + ' ms.'));
  }

  // ---------- Graphiques ----------
  function renderCharts(P, D, fs) {
    const f = fs.find((x) => x.id === sel) || fs[0];
    const T = R.totals;
    let ref = new Array(12).fill(0), refName = 'Moyenne des façades';
    if (R.masks) { ref = f.monthlyDaily0; refName = 'Même façade, sans masques'; }
    else for (const x of fs) x.monthlyDaily.forEach((v, i) => { ref[i] += v * x.area / T.area; });
    ui.main.append(el('div', { class: 'charts2' },
      el('div', {},
        el('div', { class: 'chart-head' }, el('h3', {}, 'Rose des orientations'), el('small', {}, 'moyenne par jour sur l\'année, kWh/m²·jour')),
        FS.charts.rose(R, 'jour', sel, (id) => { sel = id; FS.scene3d.select(id); refreshMain(); })),
      el('div', {},
        el('div', { class: 'chart-head' }, el('h3', {}, 'Façade ' + f.id + ' · ' + FS.orientName[f.label] + ' : moyenne par jour, mois par mois'), el('small', {}, 'kWh/m²·jour')),
        FS.charts.monthly(f.monthlyDaily, ref, {
          name: 'Façade ' + f.id, unit: 'kWh/m²·jour', refName, step: 1, minTop: 4,
          hLines: [{ v: 2.5, label: 'été : 2,5', from: 5, to: 7 }, { v: 3, label: 'mi-saison : 3' }]
        }),
        el('p', { class: 'status' }, 'Repères : sol horizontal à Paris ≈ 1 kWh/m²·jour en hiver, ≈ 5 en été ; façade sud dégagée ≈ 2,7 sur l\'année. ' +
          'Au-dessus de 2,5 kWh/m²·jour en été (3 en mi-saison), une façade vitrée demande une protection solaire.'))));

    // diagramme de masque sur 360° d'un point de la façade : colonne centrale du plus long segment
    const fi = D.model.facades.findIndex((x) => x.id === f.id);
    const MF = R.M.facades[fi];
    let si = 0;
    D.model.facades[fi].segs.forEach((s, i) => { if (s.len > D.model.facades[fi].segs[si].len) si = i; });
    const MS = MF.segs[si];
    const col = Math.floor(MS.g.nc / 2), rows = MS.g.nr;
    const levels = [['bas', 0], ['milieu', Math.floor((rows - 1) / 2)], ['haut', rows - 1]].filter((x, i, a) => a.findIndex((y) => y[1] === x[1]) === i);
    if (maskLevel >= levels.length) maskLevel = 0;
    const pt = MS.pts[levels[maskLevel][1] * MS.g.nc + col];
    const head = el('div', { class: 'chart-head' },
      el('h3', {}, 'Masque solaire, façade ' + f.id + ', point ' + levels[maskLevel][0] + ' (à ' + FS.fmt(pt.p[2], 1) + ' m)'),
      el('div', { class: 'chips' }, levels.map((l, i) => el('button', { class: 'chip' + (i === maskLevel ? ' on' : ''), onclick: () => { maskLevel = i; refreshMain(); } }, l[0]))));
    const box = el('div', { class: 'charts-full' }, head);
    if (pt.buried || !pt.hz) box.append(el('p', { class: 'muted' }, 'Point recouvert par un volume voisin.'));
    else {
      const hzAll = FS.masks.horizonAll(pt.p, FS.masks.obstacles(D));
      box.append(FS.charts.maskDiagram360(pt.hz, hzAll, f.az, { lat: D.lat, lon: D.lon, tz: P.tz }));
      box.append(el('p', { class: 'status' }, 'Tous les azimuts, du nord (0°) au nord (360°). Entre les deux traits verticaux : la moitié du ciel vue par la façade ; ' +
        'hors de cette plage (hachures), le soleil est derrière le mur. Silhouette grise : obstacles vus depuis le point. Courses du soleil le 21 juin, aux équinoxes et le 21 décembre ; ' +
        'point plein : soleil sur la façade à l\'heure pleine ; creux : masqué ; gris : derrière la façade. Ciel vu depuis ce point : ' + FS.pct(pt.svf) + ' de celui d\'un mur dégagé.'));
    }
    ui.main.append(box);
  }

  FS.uiResults = { build, refresh, ensureClimate, get: () => R, select: (id) => { sel = id; }, solarOpts };
})(window.FS);
