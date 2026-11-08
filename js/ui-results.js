/* Onglet Résultats (irradiation par façade) et coloration de la maquette 3D. */
(function (FS) {
  'use strict';
  const el = FS.el;
  let ui = {}, R = null, sel = null, climateMsg = '', climateErr = false, loading = false, lastKey = null;

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

  function compute() {
    const D = FS.project.derived(), c = FS.climate.get();
    const P0 = FS.project.get(), T0 = P0.thermal, v0 = T0.variants[Math.min(T0.ref, T0.variants.length - 1)];
    // les apports vitrés de l'exposition utilisent le g de la variante de référence (onglet Thermique)
    R = (D.ok && c) ? FS.results.compute(D, c, Object.assign({}, P0.solar, { g: v0 ? v0.g : 0.6 })) : null;
    if (R && (sel == null || !R.facades.some((f) => f.id === sel))) {
      sel = R.facades.length ? R.facades.reduce((a, f) => (f.annual > a.annual ? f : a)).id : null;
    }
    return R;
  }

  // ---------- Onglet ----------
  function build(app) {
    const P = FS.project.get();
    const page = el('section', { class: 'page', id: 'page-resultats', hidden: true });
    page.append(FS.blockHead('04', 'Exposition solaire',
      'Irradiation reçue par chaque façade sur une année type : rayonnement direct, diffus du ciel et réfléchi par le sol, avec les masques des bâtiments voisins et du bâtiment lui-même.'));

    ui.main = el('div', {});
    // panneau latéral
    ui.climate = el('div', { class: 'panel' });
    const chipsModel = el('div', { class: 'chips' },
      ['perez', 'isotrope'].map((m) => el('button', { class: 'chip', 'data-m': m, onclick: () => { P.solar.model = m; FS.app.update('solar'); } }, m === 'perez' ? 'Perez (anisotrope)' : 'Isotrope')));
    ui.chipsModel = chipsModel;
    const chipsSplit = el('div', { class: 'chips' },
      [['erbs', 'Erbs (recalculé)'], ['era5', 'ERA5 brut']].map(([m, lab]) => el('button', { class: 'chip', 'data-m': m, onclick: () => { P.solar.split = m; FS.app.update('solar'); } }, lab)));
    ui.chipsSplit = chipsSplit;
    const chipsMask = el('div', { class: 'chips' },
      [[true, 'Avec masques'], [false, 'Sans masques']].map(([m, lab]) => el('button', { class: 'chip', 'data-m': String(m), onclick: () => { P.solar.masks = m; FS.app.update('solar'); } }, lab)));
    ui.chipsMask = chipsMask;
    const alb = el('input', { type: 'number', min: 0, max: 0.9, step: 0.05, value: P.solar.albedo });
    alb.addEventListener('change', () => { P.solar.albedo = FS.clamp(FS.num(alb.value, 0.2), 0, 0.9); FS.app.update('solar'); });
    const g = el('div', { class: 'status' });

    ui.alb = alb; ui.g = g;
    const side = el('aside', { class: 'side' },
      ui.climate,
      el('div', { class: 'panel' }, el('h3', {}, 'Hypothèses'),
        el('label', { class: 'field' }, 'Masques (voisins et bâtiment)', chipsMask),
        el('label', { class: 'field' }, 'Partage direct / diffus', chipsSplit),
        el('label', { class: 'field' }, 'Modèle du diffus sur les façades', chipsModel),
        el('div', { class: 'grid2' },
          el('label', { class: 'field' }, el('span', {}, 'Albédo du sol'), alb),
          el('label', { class: 'field' }, el('span', {}, 'Facteur solaire g'), g)),
        el('small', {}, 'Les vitrages et protections solaires se règlent dans l\'onglet Thermique.')));
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
    { const T = P.thermal, v = T.variants[Math.min(T.ref, T.variants.length - 1)]; ui.g.textContent = FS.fmtFixed(v ? v.g : 0.6, 2) + ' : ' + (v ? v.name : '—') + ' (variante de référence, onglet Thermique)'; }
    if (D.ok && !loading) compute(); else if (!D.ok) R = null;
    renderClimate();
    apply3d();
    ui.main.innerHTML = '';
    if (!D.ok) { ui.main.append(el('p', { class: 'muted' }, 'Sélectionnez un bâtiment dans l\'onglet Site.')); return; }
    if (!R) { ui.main.append(el('p', { class: 'status' }, loading ? 'Calcul en attente du climat…' : 'Climat non chargé.')); return; }

    const fs = R.facades;
    if (!fs.length) { ui.main.append(el('p', { class: 'muted' }, 'Aucune façade exposée.')); return; }
    const top = fs.reduce((a, f) => (f.annual > a.annual ? f : a));
    const topS = fs.reduce((a, f) => (f.gainsSummer > a.gainsSummer ? f : a));
    const pk = fs.reduce((a, f) => (f.peak > a.peak ? f : a));
    const loss = R.totals.incident0 ? 1 - R.totals.incident / R.totals.incident0 : 0;
    ui.main.append(el('div', { class: 'kpis' },
      kpi(FS.fmt(R.totals.incident / 1000, 0) + ' MWh', 'reçus par an par les ' + FS.fmt(R.totals.area, 0) + ' m² de façades exposées' +
        (R.masks ? ', soit ' + FS.pct(loss) + ' de moins qu\'en site dégagé' : ' (sans masques)')),
      kpi(FS.fmt(top.annual, 0) + ' kWh/m²', 'façade ' + top.id + ' (' + FS.orientName[top.label] + '), la plus exposée sur l\'année'),
      kpi(FS.pct(topS.shareSummer), 'des apports d\'été par les vitrages passent par la façade ' + topS.id + ' (' + FS.orientName[topS.label] + ')'),
      kpi(FS.fmt(pk.peak, 0) + ' W/m²', 'pic horaire d\'été, façade ' + pk.id + ' (' + FS.results.hourLabel(pk.peakH, P.tz) + ')')));

    // tableau de synthèse
    const tb = el('tbody');
    for (const f of fs) {
      tb.append(el('tr', { class: f.id === sel ? 'sel' : '', style: { cursor: 'pointer' }, onclick: () => { sel = f.id; FS.scene3d.select(f.id); refresh(); } },
        el('td', {}, el('b', {}, f.id)),
        el('td', { style: { whiteSpace: 'nowrap' } }, el('span', { class: 'swatch', style: { background: FS.charts.colorFor(P.solar.color === 'none' ? 'annual' : P.solar.color, f) } }), f.label),
        el('td', { class: 'num' }, Math.round(f.az) + '°'),
        el('td', { class: 'num' }, FS.fmt(f.area, 0)),
        el('td', { class: 'num' }, FS.fmt(f.glazed, 0)),
        el('td', { class: 'num hl' }, FS.fmt(f.annual, 0)),
        el('td', { class: 'num' }, FS.fmt(f.annual0, 0)),
        el('td', { class: 'num' }, R.masks ? '−' + FS.pct(f.maskLoss) : '—'),
        el('td', { class: 'num' }, FS.pct(f.svf)),
        el('td', { class: 'num' }, FS.fmt(f.winter, 0)),
        el('td', { class: 'num' }, FS.fmt(f.summer, 0)),
        el('td', { class: 'num' }, FS.fmt(f.peak, 0)),
        el('td', { class: 'num' }, FS.fmt(f.sunHours, 0)),
        el('td', { class: 'num' }, FS.fmt(f.gainsSummer / 1000, 1)),
        el('td', { class: 'num' }, FS.pct(f.shareSummer)),
        el('td', { class: 'num' }, FS.fmt(f.peakGain / 1000, 1))));
    }
    const T = R.totals;
    ui.main.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'N°'), el('th', {}, 'Or.'), el('th', { class: 'num' }, 'Azimut'), el('th', { class: 'num' }, 'Façade m²'), el('th', { class: 'num' }, 'Vitrage m²'),
          el('th', { class: 'num' }, 'Annuel'), el('th', { class: 'num' }, 'Dégagé'), el('th', { class: 'num' }, 'Masques'), el('th', { class: 'num' }, 'Ciel vu'),
          el('th', { class: 'num' }, 'Hiver'), el('th', { class: 'num' }, 'Été'),
          el('th', { class: 'num' }, 'Pic été'), el('th', { class: 'num' }, 'Soleil direct'),
          el('th', { class: 'num' }, 'Apports été'), el('th', { class: 'num' }, 'Part été'), el('th', { class: 'num' }, 'Pic apports')),
        el('tr', { class: 'units' },
          el('th', {}), el('th', {}), el('th', {}), el('th', {}), el('th', {}),
          el('th', { class: 'num' }, el('small', {}, 'kWh/m²·an')), el('th', { class: 'num' }, el('small', {}, 'sans masque')), el('th', {}), el('th', { class: 'num' }, el('small', {}, 'vs mur dégagé')),
          el('th', { class: 'num' }, el('small', {}, 'oct.–avr.')), el('th', { class: 'num' }, el('small', {}, 'mai–sept.')),
          el('th', { class: 'num' }, el('small', {}, 'W/m²')), el('th', { class: 'num' }, el('small', {}, 'h/an')),
          el('th', { class: 'num' }, el('small', {}, 'MWh')), el('th', {}), el('th', { class: 'num' }, el('small', {}, 'kW')))),
      tb,
      el('tfoot', {}, el('tr', {},
        el('td', { colspan: 3 }, el('b', {}, 'Total')), el('td', { class: 'num' }, FS.fmt(T.area, 0)), el('td', { class: 'num' }, FS.fmt(T.glazed, 0)),
        el('td', { class: 'num' }, FS.fmt(T.incident / T.area, 0)), el('td', { class: 'num' }, FS.fmt(T.incident0 / T.area, 0)),
        el('td', { class: 'num' }, R.masks ? '−' + FS.pct(loss) : '—'), el('td', {}),
        el('td', {}), el('td', {}), el('td', {}), el('td', {}),
        el('td', { class: 'num' }, el('b', {}, FS.fmt(T.gainsSummer / 1000, 1))), el('td', { class: 'num' }, '100 %'), el('td', {}))))));
    ui.main.append(el('p', { class: 'status', style: { marginTop: '6px' } },
      'Annuel, hiver, été : irradiation moyenne de la façade' + (R.masks ? ', masques compris' : '') + '. Dégagé : même façade sans aucun obstacle. ' +
      'Ciel vu : facteur de vue du ciel rapporté à un mur dégagé. Soleil direct : heures où au moins la moitié de la façade est au soleil, avec un direct > 120 W/m² (seuil OMM). ' +
      'Apports : irradiation × surface vitrée × g = ' + FS.fmtFixed(R.opts.g, 2) + ' (variante de référence), sans protection solaire ni menuiserie. ' +
      FS.fmt(R.nPts, 0) + ' points de calcul, horizons en ' + FS.fmt(R.msMasks, 0) + ' ms, calcul horaire en ' + FS.fmt(R.ms, 0) + ' ms.'));

    // graphiques
    const f = fs.find((x) => x.id === sel) || top;
    let ref = new Array(12).fill(0), refName = 'Moyenne des façades';
    if (R.masks) { ref = f.monthly0; refName = 'Même façade, sans masques'; }
    else for (const x of fs) x.monthly.forEach((v, i) => { ref[i] += v * x.area / T.area; });
    const modeR = P.solar.color === 'none' ? 'annual' : P.solar.color;
    ui.main.append(el('div', { class: 'charts2' },
      el('div', {},
        el('div', { class: 'chart-head' }, el('h3', {}, 'Rose des orientations'), el('small', {}, FS.charts.MODES[modeR].label + ', ' + FS.charts.MODES[modeR].unit)),
        FS.charts.rose(R, modeR, sel, (id) => { sel = id; FS.scene3d.select(id); refresh(); })),
      el('div', {},
        el('div', { class: 'chart-head' }, el('h3', {}, 'Façade ' + f.id + ' · ' + FS.orientName[f.label] + ' (' + Math.round(f.az) + '°) : irradiation mensuelle'), el('small', {}, 'kWh/m²')),
        FS.charts.monthly(f.monthly, ref, { name: 'Façade ' + f.id, unit: 'kWh/m²', refName }))));

    // diagramme de masque d'un point de la façade : colonne centrale du plus long segment
    const fi = fs.indexOf(f);
    const MF = R.M.facades[fi];
    let si = 0;
    D.model.facades[fi].segs.forEach((s, i) => { if (s.len > D.model.facades[fi].segs[si].len) si = i; });
    const MS = MF.segs[si];
    const col = Math.floor(MS.g.nc / 2);
    const rows = MS.g.nr;
    const levels = [['bas', 0], ['milieu', Math.floor((rows - 1) / 2)], ['haut', rows - 1]].filter((x, i, a) => a.findIndex((y) => y[1] === x[1]) === i);
    if (maskLevel >= levels.length) maskLevel = 0;
    const row = levels[maskLevel][1];
    const pt = MS.pts[row * MS.g.nc + col];
    const head = el('div', { class: 'chart-head' },
      el('h3', {}, 'Masque solaire, façade ' + f.id + ', point ' + levels[maskLevel][0] + ' (à ' + FS.fmt(pt.p[2], 1) + ' m)'),
      el('div', { class: 'chips' }, levels.map((l, i) => el('button', { class: 'chip' + (i === maskLevel ? ' on' : ''), onclick: () => { maskLevel = i; refresh(); } }, l[0]))));
    const box = el('div', { class: 'charts-full' }, head);
    if (pt.buried || !pt.hz) box.append(el('p', { class: 'muted' }, 'Point recouvert par un volume voisin.'));
    else {
      box.append(FS.charts.maskDiagram(pt.hz, f.az, { lat: D.lat, lon: D.lon, tz: P.tz }));
      box.append(el('p', { class: 'status' }, 'Silhouette grise : obstacles vus depuis le point (voisins et bâtiment). Courses du soleil le 21 juin, aux équinoxes et le 21 décembre ; ' +
        'point plein : soleil visible à l\'heure pleine, point creux : masqué. Ciel vu depuis ce point : ' + FS.pct(pt.svf) + ' de celui d\'un mur dégagé.'));
    }
    ui.main.append(box);
  }
  let maskLevel = 1;

  function renderClimate() {
    const box = ui.climate; box.innerHTML = '';
    const c = FS.climate.get();
    box.append(el('h3', {}, 'Climat', el('button', { class: 'btn sm ghost', onclick: () => ensureClimate(true), disabled: loading }, 'Recharger')));
    if (climateMsg) box.append(el('p', { class: 'note ' + (climateErr ? 'warn' : '') }, climateMsg));
    if (!c) { box.append(el('p', { class: 'status' }, 'Aucun climat chargé.')); return; }
    box.append(el('div', { class: 'status' }, c.label + '. Maille ERA5 ' + FS.fmtFixed(c.gridLat, 2) + '° N, ' + FS.fmtFixed(c.gridLon, 2) + '° E.'));
    const m = c.monthly, M = FS.climate.MONTHS;
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    const tb = el('tbody');
    for (let i = 0; i < 12; i++) {
      tb.append(el('tr', {}, el('td', {}, M[i]), el('td', { class: 'num' }, c.chosen[i]),
        el('td', { class: 'num' }, FS.fmt(m.ghiTMY[i], 0)), el('td', { class: 'num' }, FS.fmt(m.ghiLT[i], 0)), el('td', { class: 'num' }, FS.fmtFixed(m.tTMY[i], 1))));
    }
    box.append(el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Mois'), el('th', { class: 'num' }, 'Année'), el('th', { class: 'num' }, 'GHI type'), el('th', { class: 'num' }, 'GHI moy.'), el('th', { class: 'num' }, 'T °C'))),
      tb,
      el('tfoot', {}, el('tr', {}, el('td', {}, el('b', {}, 'An')), el('td', {}),
        el('td', { class: 'num' }, el('b', {}, FS.fmt(sum(m.ghiTMY), 0))), el('td', { class: 'num' }, FS.fmt(sum(m.ghiLT), 0)),
        el('td', { class: 'num' }, FS.fmtFixed(sum(m.tTMY) / 12, 1))))));
    box.append(el('small', {}, 'GHI : rayonnement global horizontal, kWh/m². Année type : mois réels les plus représentatifs de ' + c.years.join('–') + ' ; « moy. » : moyenne de toutes les années.'));
  }

  // ---------- 3D : coloration ----------
  function attach3d(viewport, sideHost) {
    ui.legend3d = el('div', {});
    viewport.append(ui.legend3d);
    ui.chips3d = el('div', { class: 'chips' });
    const modes = [['none', 'Neutre']].concat(Object.keys(FS.charts.MODES).map((k) => [k, FS.charts.MODES[k].label]));
    for (const [k, lab] of modes) {
      ui.chips3d.append(el('button', { class: 'chip', 'data-m': k, onclick: () => { FS.project.get().solar.color = k; FS.project.save(); refresh(); } }, lab));
    }
    sideHost.append(el('div', { class: 'panel' }, el('h3', {}, 'Coloration des façades'), ui.chips3d, ui.status3d = el('small', {})));
  }

  function apply3d() {
    if (!ui.chips3d) return;
    const P = FS.project.get(), mode = P.solar.color;
    ui.chips3d.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.m === mode));
    ui.legend3d.innerHTML = '';
    if (mode === 'none' || !R) {
      FS.scene3d.setColors(null);
      ui.status3d.textContent = mode !== 'none' && !R ? (loading ? 'Chargement du climat…' : 'Résultats indisponibles.') : '';
      return;
    }
    // une couleur par maille (point de calcul)
    const bySeg = {};
    for (const f of R.facades) { bySeg[f.id] = {}; for (const c of f.cells) bySeg[f.id][c.si] = c; }
    FS.scene3d.setColors((id, si, k) => {
      const c = bySeg[id] && bySeg[id][si];
      const v = c && c.v[k];
      return v ? FS.charts.colorFor(mode, v) : null;
    });
    ui.legend3d.append(FS.charts.legend(mode));
    ui.status3d.textContent = (R.masks ? 'Avec les masques des voisins et du bâtiment lui-même' : 'Sans masques') +
      ' : une maille par point de calcul (≈ ' + FS.fmt(R.M.cs.dx, 1) + ' m × ' + FS.fmt(R.M.cs.dz, 1) + ' m). Survolez une façade pour ses valeurs.';
  }

  function tipFor(id) {
    if (!R) return '';
    const f = R.facades.find((x) => x.id === id);
    if (!f) return '';
    return '\n' + FS.fmt(f.annual, 0) + ' kWh/m²·an (hiver ' + FS.fmt(f.winter, 0) + ', été ' + FS.fmt(f.summer, 0) + ')' +
      (R.masks ? '\nMasques : −' + FS.pct(f.maskLoss) + ' (' + FS.fmt(f.annual0, 0) + ' sans masque)' : '') +
      '\nPic d\'été ' + FS.fmt(f.peak, 0) + ' W/m²';
  }

  FS.uiResults = { build, refresh, ensureClimate, attach3d, tipFor, get: () => R, select: (id) => { sel = id; } };
})(window.FS);
