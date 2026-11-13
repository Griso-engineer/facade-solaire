/* Onglet Maquette 3D : coloration des façades et repères graphiques.

   Trois familles (boutons), chacune avec ses seuls paramètres :
     Données instantanées : pic d'été (W/m², année type) ; à la date et l'heure choisies (W/m², ciel
       clair) ; heures au-dessus de 300 W/m² sur une journée (ciel clair).
     Rayonnement moyen par période : printemps, été, automne, hiver (kWh/m²·jour, année type, nuits comprises).
     Autres : ciel visible (VSC), neutre.
   Les repères (ordres de grandeur, seuils) sont dessinés en haut à droite de la vue 3D, dans le
   même code couleur que la légende en bas à gauche. */
(function (FS) {
  'use strict';
  const el = FS.el, S = FS.svg;
  let ui = {}, field = null, fieldKey = null;
  const CATS = {
    inst: { label: 'Données instantanées', modes: [['peak', 'Pic d\'été'], ['instant', 'Date et heure'], ['hours', 'Heures > 300 W/m² sur un jour']] },
    period: { label: 'Rayonnement moyen par période', modes: [['printemps', 'Printemps'], ['ete', 'Été'], ['automne', 'Automne'], ['hiver', 'Hiver']] },
    other: { label: 'Autres données', modes: [['vsc', 'Ciel visible'], ['none', 'Neutre']] }
  };
  const PERIOD_TXT = { printemps: 'printemps (mars–mai)', ete: 'été (juin–août)', automne: 'automne (sept.–nov.)', hiver: 'hiver (déc.–févr.)' };
  const OLD = { annual: 'ete', summer: 'ete', winter: 'hiver' };

  const P = () => FS.project.get();
  function mode() {
    const m = (P().view3d && P().view3d.mode) || 'ete';
    return OLD[m] || m;
  }
  const catOf = (m) => Object.keys(CATS).find((c) => CATS[c].modes.some((x) => x[0] === m)) || 'period';

  // Échelles (bornes fixes, pour comparer les projets entre eux)
  function scale(m) {
    const v = P().view;
    const date = FS.solar.dateOfDoy(2026, v.doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    if (PERIOD_TXT[m]) return { label: 'Moyenne par jour, ' + PERIOD_TXT[m], unit: 'kWh/m²·jour', max: 4, digits: 1, get: (x) => (x.d || x.daily)[m] };
    switch (m) {
      case 'instant': return { label: 'Éclairement le ' + date + ' à ' + FS.solar.fmtHour(v.hour) + ', ciel clair', unit: 'W/m²', max: 900 };
      case 'hours': return { label: 'Heures > 300 W/m² le ' + date + ', ciel clair', unit: 'h', max: 5, digits: 1 };
      case 'peak': return { label: 'Pic horaire d\'été (juin–août, année type)', unit: 'W/m²', max: 900, get: (x) => x.peak };
      case 'vsc': return { label: 'Ciel visible (VSC)', unit: '%', max: 40, ramp: 'sky', get: (x) => x.vsc * 100 };
      default: return null;
    }
  }

  // ---------- Panneau ----------
  function build(viewport) {
    ui.legend3d = el('div', {});
    ui.ref = el('div', { class: 'ref3d', hidden: true });
    viewport.append(ui.legend3d, ui.ref);
    ui.cats = el('div', { class: 'seg3' }, Object.keys(CATS).map((c) =>
      el('button', { class: 'seg', 'data-c': c, onclick: () => setMode(CATS[c].modes[0][0]) }, CATS[c].label)));
    ui.modes = el('div', { class: 'chips' });
    // date et heure : sous-option des modes « date et heure » et « heures > 300 W/m² »
    const v = P().view;
    ui.doy = el('input', { type: 'range', min: 1, max: 365, step: 1, value: v.doy });
    ui.hour = el('input', { type: 'range', min: 4, max: 22, step: 0.25, value: v.hour });
    ui.doyLabel = el('b'); ui.hourLabel = el('b');
    const onView = () => { P().view.doy = +ui.doy.value; P().view.hour = +ui.hour.value; FS.project.save(); FS.scene3d.updateSun(); refreshSoon(); };
    ui.doy.addEventListener('input', onView); ui.hour.addEventListener('input', onView);
    const quick = el('div', { class: 'chips' });
    for (const [lab, m, d] of [['21 déc.', 12, 21], ['21 mars', 3, 21], ['21 juin', 6, 21], ['15 juil.', 7, 15], ['21 sept.', 9, 21]]) {
      quick.append(el('button', { class: 'chip', onclick: () => { ui.doy.value = FS.solar.doyOf(2026, m, d); onView(); } }, lab));
    }
    ui.hourRow = el('div', { class: 'time-row' }, el('span', {}, 'Heure légale'), ui.hour, ui.hourLabel);
    ui.when = el('div', { class: 'subpanel' }, el('div', { class: 'time-row' }, el('span', {}, 'Date'), ui.doy, ui.doyLabel), ui.hourRow, quick);
    ui.summary = el('div', {});
    return el('div', { class: 'panel color-panel' },
      el('h3', {}, 'Coloration des façades', el('button', { class: 'btn sm ghost', onclick: () => FS.scene3d.frame() }, 'Recadrer')),
      ui.cats, ui.modes, ui.when, ui.summary);
  }

  function setMode(m) {
    P().view3d = Object.assign({}, P().view3d, { mode: m });
    FS.project.save();
    refresh();
    if (FS.uiReport) FS.uiReport.refresh();
  }

  let pending = 0;
  function refreshSoon() { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; refresh(); }); }

  // ---------- Valeurs instantanées (ciel clair) ----------
  function computeField(m) {
    const D = FS.project.derived();
    if (!D.ok) return null;
    const p = P(), M = FS.results.masksFor(D);
    const opts = { doy: p.view.doy, hour: p.view.hour, tz: p.tz, albedo: p.solar.albedo, model: p.solar.model, masks: p.solar.masks !== false };
    const key = m + '|' + (m === 'instant' ? p.view.doy + '|' + p.view.hour : p.view.doy) + '|' + opts.albedo + opts.model + opts.masks + '|' + M.nPts + '|' + D.H;
    if (key === fieldKey && field && field.D === D) return field;
    const t0 = performance.now();
    const r = m === 'instant' ? FS.instant.instant(D, M, opts) : FS.instant.hoursAbove(D, M, Object.assign({ threshold: 300 }, opts));
    field = { D, M, values: r.values, extra: r, ms: performance.now() - t0 };
    fieldKey = key;
    return field;
  }

  function refresh() {
    if (!ui.cats) return;
    const p = P(), m = mode(), cat = catOf(m);
    ui.cats.querySelectorAll('.seg').forEach((b) => b.classList.toggle('on', b.dataset.c === cat));
    ui.modes.innerHTML = '';
    for (const [k, lab] of CATS[cat].modes) ui.modes.append(el('button', { class: 'chip' + (k === m ? ' on' : ''), onclick: () => setMode(k) }, lab));
    const v = p.view;
    ui.when.hidden = !(m === 'instant' || m === 'hours');
    ui.hourRow.hidden = m !== 'instant';
    ui.doyLabel.textContent = FS.solar.dateOfDoy(2026, v.doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    ui.hourLabel.textContent = FS.solar.fmtHour(v.hour);
    if (document.activeElement !== ui.doy) ui.doy.value = v.doy;
    if (document.activeElement !== ui.hour) ui.hour.value = v.hour;
    ui.legend3d.innerHTML = ''; ui.summary.innerHTML = ''; ui.ref.innerHTML = '';
    const sc = scale(m), D = FS.project.derived();
    ui.ref.hidden = !sc || !D.ok;
    if (!sc || !D.ok) { FS.scene3d.setColors(null); return; }
    const color = (x) => FS.charts.colorAt(x / sc.max, sc.ramp);
    const R = FS.uiResults && FS.uiResults.get();

    if (m === 'instant' || m === 'hours') {
      const f = computeField(m);
      FS.scene3d.setColors((id, si, k) => {
        const fi = D.model.facades.findIndex((x) => x.id === id);
        if (fi < 0 || D.model.facades[fi].ignored) return null;
        const val = f.values[fi][si] ? f.values[fi][si][k] : null;
        return val == null ? null : color(val);
      });
      const rows = D.model.facades.map((fa, fi) => ({ id: fa.id, label: fa.label, ignored: fa.ignored, v: FS.instant.facadeMean(D, f.values, fi) })).filter((r) => !r.ignored);
      ui.summary.append(summaryTable(rows, sc, m === 'hours' ? 1 : 0),
        el('small', {}, m === 'instant' ? (f.extra.sky.up ? 'Soleil à ' + FS.fmt(f.extra.sky.alt / FS.RAD, 0) + '° de hauteur ; ombres portées à cet instant.' : 'Soleil sous l\'horizon : aucun rayonnement.')
          : 'Durée du jour : ' + FS.fmtFixed(f.extra.dayLength, 1) + ' h. Ciel clair, pas de 10 min, masques compris.'));
    } else {
      if (!R) { FS.scene3d.setColors(null); ui.summary.append(el('small', {}, 'Calcul en attente du climat…')); return; }
      const bySeg = {};
      for (const fa of R.facades) { bySeg[fa.id] = {}; for (const c of fa.cells) bySeg[fa.id][c.si] = c; }
      FS.scene3d.setColors((id, si, k) => {
        const c = bySeg[id] && bySeg[id][si], val = c && c.v[k];
        return val ? color(sc.get(val)) : null;
      });
      ui.summary.append(summaryTable(R.facades.map((fa) => ({ id: fa.id, label: fa.label, v: sc.get(fa) })), sc, sc.digits || 0));
    }
    ui.legend3d.append(FS.charts.legendScale(sc));
    drawReference(m, sc, D, R);
  }

  function summaryTable(rows, sc, digits) {
    return el('table', { class: 'tbl compact' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Façade'), el('th', { class: 'num' }, sc.unit))),
      el('tbody', {}, rows.map((r) => el('tr', {},
        el('td', {}, el('span', { class: 'swatch', style: { background: FS.charts.colorAt(r.v / sc.max, sc.ramp) } }), r.id + ' · ' + r.label),
        el('td', { class: 'num' }, FS.fmtFixed(r.v, digits))))));
  }

  // ---------- Repères graphiques (en haut à droite de la vue) ----------
  function refsFor(D) {
    const c = FS.climate.get();
    if (!c || !FS.uiResults || !FS.uiResults.solarOpts) return null;
    return FS.results.references(c, D.lat, D.lon, Object.assign(FS.uiResults.solarOpts(P()), { model: P().solar.model }));
  }

  function drawReference(m, sc, D, R) {
    const box = ui.ref;
    const col = (x) => FS.charts.colorAt(x / sc.max, sc.ramp);
    if (m === 'peak' || m === 'instant') {
      const refs = refsFor(D);
      if (!refs) { box.hidden = true; return; }
      box.append(el('div', { class: 'ref-title' }, 'Repères : façade parisienne dégagée, été'), roseRef(refs, col, sc.max),
        el('div', { class: 'ref-key' }, el('span', { class: 'k-out' }, 'contour : pic d\'été'), el('span', { class: 'k-in' }, 'plein : moyenne des heures de jour')));
      return;
    }
    if (m === 'hours') {
      const zones = [[0, 1.5, 'exposition brève'], [1.5, 2.5, 'exposition prolongée'], [2.5, 5, 'forte exposition']];
      const W = 250, H = 92, x = (h) => 8 + (W - 16) * h / 5;
      const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart refsvg' });
      zones.forEach(([a, b, lab], i) => {
        svg.append(S('rect', { x: x(a), y: 18, width: x(b) - x(a) - 2, height: 18, fill: col((a + b) / 2) }));
        svg.append(S('text', { x: (x(a) + x(b)) / 2, y: 52 + (i % 2) * 12, class: 'tick', 'text-anchor': 'middle' }, lab));
      });
      for (const h of [0, 1.5, 2.5, 5]) svg.append(S('text', { x: x(h), y: 13, class: 'tick', 'text-anchor': h === 0 ? 'start' : h === 5 ? 'end' : 'middle' }, h === 5 ? '5 h et +' : FS.fmt(h, 1).replace(',5', ' h 30').replace(/^(\d)$/, '$1 h')));
      box.append(el('div', { class: 'ref-title' }, 'Repères : heures > 300 W/m² par jour'), svg);
      return;
    }
    if (PERIOD_TXT[m]) {
      const refs = refsFor(D);
      if (!refs) { box.hidden = true; return; }
      const vig = m === 'ete' ? { v: 2.5, lab: 'vigilance été' } : m === 'hiver' ? { v: 1.5, lab: 'apports utiles' } : { v: 3, lab: 'vigilance mi-saison' };
      box.append(el('div', { class: 'ref-title' }, 'Repères : façade dégagée, ' + PERIOD_TXT[m]), barsRef(refs, m, col, vig, R),
        el('div', { class: 'ref-key' }, el('span', { class: 'k-line' }, vig.lab + ' : ' + FS.fmtFixed(vig.v, 1) + ' kWh/m²·j'), el('span', { class: 'k-dot' }, 'vos façades (masques compris)')));
      return;
    }
    if (m === 'vsc') {
      const W = 250, H = 78, x = (v) => 8 + (W - 16) * v / 40;
      const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart refsvg' });
      [[0, 15, 'difficile'], [15, 27, 'moyen'], [27, 40, 'bon']].forEach(([a, b, lab]) => {
        svg.append(S('rect', { x: x(a), y: 18, width: x(b) - x(a) - 2, height: 18, fill: col((a + b) / 2) }));
        svg.append(S('text', { x: (x(a) + x(b)) / 2, y: 52, class: 'tick', 'text-anchor': 'middle' }, lab));
      });
      for (const v of [0, 15, 27, 40]) svg.append(S('text', { x: x(v), y: 13, class: 'tick', 'text-anchor': v === 0 ? 'start' : v === 40 ? 'end' : 'middle' }, v + ' %'));
      svg.append(S('line', { x1: x(39.6), x2: x(39.6), y1: 16, y2: 40, class: 'refmark' }));
      svg.append(S('text', { x: x(39.6), y: 68, class: 'tick', 'text-anchor': 'end' }, 'mur dégagé 39,6 %'));
      box.append(el('div', { class: 'ref-title' }, 'Repères BRE : ciel visible'), svg);
      return;
    }
    box.hidden = true;
  }

  // Rose de référence : pic d'été (contour) et moyenne des heures de jour en été (plein), 8 orientations
  function roseRef(refs, col, max) {
    const W = 230, c = W / 2, r0 = 10, r1 = c - 24;
    const rad = (v) => r0 + (r1 - r0) * Math.min(1, v / max);
    const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + W, class: 'chart refsvg rose' });
    for (const v of [300, 600, 900]) {
      svg.append(S('circle', { cx: c, cy: c, r: rad(v), class: 'grid' }));
      if (v < 900) svg.append(S('text', { x: c + rad(v) * Math.SQRT1_2 + 2, y: c - rad(v) * Math.SQRT1_2 - 2, class: 'tick' }, v));
    }
    const wedge = (a0, a1, rr) => {
      const p = (a, r) => (c + r * Math.sin(a)).toFixed(1) + ',' + (c - r * Math.cos(a)).toFixed(1);
      return 'M' + p(a0, r0) + 'L' + p(a0, rr) + 'A' + rr + ',' + rr + ' 0 0 1 ' + p(a1, rr) + 'L' + p(a1, r0) + 'A' + r0 + ',' + r0 + ' 0 0 0 ' + p(a0, r0) + 'Z';
    };
    for (const r of refs) {
      const a0 = (r.az - 17) * Math.PI / 180, a1 = (r.az + 17) * Math.PI / 180;
      svg.append(S('path', { d: wedge(a0, a1, rad(r.peak)), fill: 'none', stroke: col(r.peak), 'stroke-width': 2.2 }));
      svg.append(S('path', { d: wedge(a0, a1, rad(r.meanSummer)), fill: col(r.meanSummer), class: 'wedge' }));
      const lr = r1 + 12, la = r.az * Math.PI / 180;
      svg.append(S('text', { x: c + lr * Math.sin(la), y: c - lr * Math.cos(la) + 4, class: r.az % 90 ? 'tick' : 'card', 'text-anchor': 'middle' }, r.label));
    }
    return svg;
  }

  // Barres de référence par orientation (kWh/m²·jour), seuil de vigilance, et façades du projet
  function barsRef(refs, season, col, vig, R) {
    const W = 260, H = 150, ml = 22, mr = 6, mt = 8, mb = 20, iw = W - ml - mr, ih = H - mt - mb, top = 4;
    const y = (v) => mt + ih - ih * Math.min(v, top) / top, bw = iw / refs.length;
    const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart refsvg' });
    for (let v = 0; v <= top; v++) {
      svg.append(S('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), class: v ? 'grid' : 'axis' }));
      svg.append(S('text', { x: ml - 4, y: y(v) + 3, class: 'tick', 'text-anchor': 'end' }, v));
    }
    refs.forEach((r, i) => {
      const v = r.daily[season], x = ml + i * bw + bw * 0.16, w = bw * 0.68;
      svg.append(S('rect', { x, y: y(v), width: w, height: y(0) - y(v), rx: 2, fill: col(v) }));
      svg.append(S('text', { x: ml + i * bw + bw / 2, y: H - 6, class: 'tick', 'text-anchor': 'middle' }, r.label));
    });
    svg.append(S('line', { x1: ml, x2: W - mr, y1: y(vig.v), y2: y(vig.v), class: 'refth' }));

    if (R) {
      const idx = (az) => Math.round(((az % 360) + 360) % 360 / 45) % 8;
      const count = {};
      for (const f of R.facades) {
        const i = idx(f.az), k = (count[i] = (count[i] || 0) + 1) - 1;
        const cx = ml + i * bw + bw / 2 + (k % 3 - 1) * 5;
        svg.append(S('circle', { cx, cy: y(f.daily[season]), r: 3.4, class: 'projdot' }));
      }
    }
    return svg;
  }

  // Info-bulle d'une façade survolée
  function tipFor(id) {
    const m = mode(), sc = scale(m), D = FS.project.derived();
    if (!sc || !D.ok) return '';
    if (m === 'instant' || m === 'hours') {
      const f = computeField(m), fi = D.model.facades.findIndex((x) => x.id === id);
      return fi < 0 ? '' : '\n' + sc.label + ' : ' + FS.fmtFixed(FS.instant.facadeMean(D, f.values, fi), m === 'hours' ? 1 : 0) + ' ' + sc.unit + ' (moyenne de la façade)';
    }
    const R = FS.uiResults && FS.uiResults.get();
    const fa = R && R.facades.find((x) => x.id === id);
    return fa ? '\n' + sc.label + ' : ' + FS.fmtFixed(sc.get(fa), sc.digits || 0) + ' ' + sc.unit +
      (R.masks ? '\nMasques : −' + FS.pct(fa.maskLoss) + ' sur l\'année' : '') : '';
  }

  // Pour la fiche offre et l'onglet Exposition
  const legendNow = () => { const sc = scale(mode()); return sc ? FS.charts.legendScale(sc) : null; };
  const caption = () => { const sc = scale(mode()); return sc ? sc.label + ' (' + sc.unit + ')' : 'façades neutres'; };
  const roseMode = () => 'jour';

  FS.view3d = { build, refresh, setMode, tipFor, legendNow, caption, roseMode, mode, scale };
})(window.FS);
