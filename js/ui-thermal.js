/* Onglet Thermique : hypothèses, variantes de vitrage, protection solaire, comparaison. */
(function (FS) {
  'use strict';
  const el = FS.el;
  let ui = {}, TR = null;

  const T = () => FS.project.get().thermal;
  function changed() { FS.project.save(); FS.app.update('thermal'); }

  function num(label, get, set, opt = {}) {
    const inp = el('input', { type: 'number', step: opt.step || 'any', min: opt.min, max: opt.max, value: get() });
    inp.addEventListener('change', () => { set(FS.clamp(FS.num(inp.value, get()), opt.min != null ? opt.min : -1e9, opt.max != null ? opt.max : 1e9)); changed(); });
    const f = el('label', { class: 'field' }, el('span', {}, label, opt.unit ? el('small', {}, ' (' + opt.unit + ')') : null), inp);
    f.sync = () => { if (document.activeElement !== inp) inp.value = Math.round(get() * 1000) / 1000; };
    return f;
  }

  function build() {
    const page = el('section', { class: 'page', id: 'page-thermique', hidden: true });
    page.append(FS.blockHead('05', 'Bilan thermique',
      'Ordres de grandeur des besoins de chauffage et de froid liés à l\'enveloppe, façade par façade, et comparaison de variantes de vitrage.'));
    page.append(el('p', { class: 'note warn' },
      el('b', {}, 'Ordres de grandeur, pas une STD ni un calcul réglementaire. '),
      'Méthode mensuelle quasi-stationnaire (logique NF EN ISO 13790 / 52016-1) sur une « zone de façade » derrière chaque façade. ' +
      'Utile pour comparer des variantes et hiérarchiser les façades ; les valeurs absolues dépendent fortement des hypothèses ci-contre.'));
    ui.main = el('div', {});

    const t = T();
    ui.fields = [
      num('Consigne de chauffage', () => T().tH, (v) => { T().tH = v; }, { unit: '°C', step: 0.5, min: 10, max: 26 }),
      num('Consigne de refroidissement', () => T().tC, (v) => { T().tC = v; }, { unit: '°C', step: 0.5, min: 20, max: 30 }),
      num('Profondeur de la zone de façade', () => T().depth, (v) => { T().depth = v; }, { unit: 'm', step: 0.5, min: 1, max: 15 }),
      num('Apports internes', () => T().qInt, (v) => { T().qInt = v; }, { unit: 'W/m² de plancher', step: 1, min: 0, max: 50 }),
      num('Renouvellement d\'air', () => T().ach, (v) => { T().ach = v; }, { unit: 'vol/h, 0 = hors bilan', step: 0.1, min: 0, max: 5 }),
      num('U des parois opaques', () => T().Up, (v) => { T().Up = v; }, { unit: 'W/m²·K', step: 0.05, min: 0.05, max: 4 }),
      num('Part de menuiserie dans la baie', () => T().frame * 100, (v) => { T().frame = v / 100; }, { unit: '%', step: 5, min: 0, max: 60 })
    ];
    ui.inertia = el('div', { class: 'chips' }, Object.keys(FS.thermal.INERTIA).map((k) =>
      el('button', { class: 'chip', 'data-k': k, onclick: () => { T().inertia = k; changed(); } }, FS.thermal.INERTIA_LABEL[k])));
    // protection solaire
    ui.prot = el('div', { class: 'chips' }, [['none', 'Aucune'], ['fc', 'Facteur Fc'], ['gtot', 'g total']].map(([k, lab]) =>
      el('button', { class: 'chip', 'data-k': k, onclick: () => { T().protection.mode = k; changed(); } }, lab)));
    ui.fFc = num('Facteur de réduction Fc', () => T().protection.fc, (v) => { T().protection.fc = v; }, { step: 0.05, min: 0.05, max: 1 });
    ui.fGt = num('g total avec protection', () => T().protection.gtot, (v) => { T().protection.gtot = v; }, { step: 0.01, min: 0.01, max: 0.9 });
    ui.fTh = num('Seuil d\'activation', () => T().protection.threshold, (v) => { T().protection.threshold = v; }, { unit: 'W/m² sur la façade', step: 50, min: 0, max: 1000 });
    ui.fields.push(ui.fFc, ui.fGt, ui.fTh);

    const side = el('aside', { class: 'side' },
      el('div', { class: 'panel' }, el('h3', {}, 'Hypothèses'),
        el('div', { class: 'grid2' }, ui.fields[0], ui.fields[1]),
        el('div', { class: 'grid2' }, ui.fields[2], ui.fields[3]),
        el('label', { class: 'field' }, 'Inertie', ui.inertia),
        el('div', { class: 'grid2' }, ui.fields[5], ui.fields[6]),
        ui.fields[4],
        ui.floorInfo = el('small', {})),
      el('div', { class: 'panel' }, el('h3', {}, 'Protection solaire'),
        ui.prot, el('div', { class: 'grid2' }, ui.fFc, ui.fGt), ui.fTh,
        el('small', {}, 'Protection mobile, fermée quand l\'irradiation sur la façade dépasse le seuil (300 W/m², règle de l\'ISO 13790). ' +
          'Fc types : store extérieur 0,10 à 0,25, BSO 0,10 à 0,20, store intérieur clair 0,50 à 0,65.')));
    page.append(el('div', { class: 'work' }, ui.main, side));
    document.getElementById('app').append(page);
    return page;
  }

  // ---------- Éditeur de variantes ----------
  function variantsEditor() {
    const t = T();
    const head = el('tr', {}, el('th', {}, ''));
    const rows = { name: el('tr', {}, el('th', {}, 'Nom')), preset: el('tr', {}, el('th', {}, 'Préréglage')),
      Uw: el('tr', {}, el('th', {}, 'Uw (W/m²·K)')), g: el('tr', {}, el('th', {}, 'g')), TL: el('tr', {}, el('th', {}, 'TL')),
      sel: el('tr', {}, el('th', {}, 'Sélectivité TL/g')), ref: el('tr', {}, el('th', {}, 'Référence')), act: el('tr', {}, el('th', {}, '')) };
    t.variants.forEach((v, i) => {
      head.append(el('th', {}, 'Variante ' + (i + 1)));
      const name = el('input', { type: 'text', value: v.name });
      name.addEventListener('change', () => { v.name = name.value || ('Variante ' + (i + 1)); changed(); });
      rows.name.append(el('td', {}, name));
      const sel = el('select', {}, el('option', { value: '' }, '—'), FS.thermal.PRESETS.map((p) => el('option', { value: p.key, selected: v.preset === p.key }, p.name)));
      sel.addEventListener('change', () => {
        const p = FS.thermal.PRESETS.find((x) => x.key === sel.value);
        if (p) Object.assign(v, { name: p.name, Uw: p.Uw, g: p.g, TL: p.TL, preset: p.key });
        changed();
      });
      rows.preset.append(el('td', {}, sel));
      for (const [k, step, mn, mx] of [['Uw', 0.1, 0.4, 6], ['g', 0.01, 0.05, 0.9], ['TL', 0.01, 0.05, 0.95]]) {
        const inp = el('input', { type: 'number', step, min: mn, max: mx, value: v[k] });
        inp.addEventListener('change', () => { v[k] = FS.clamp(FS.num(inp.value, v[k]), mn, mx); v.preset = ''; changed(); });
        rows[k].append(el('td', {}, inp));
      }
      rows.sel.append(el('td', { class: 'num' }, FS.fmtFixed(v.TL / v.g, 2)));
      rows.ref.append(el('td', {}, el('label', { class: 'check' },
        el('input', { type: 'radio', name: 'refvar', checked: t.ref === i, onchange: () => { t.ref = i; changed(); } }), t.ref === i ? 'référence' : '')));
      rows.act.append(el('td', {}, t.variants.length > 2 ? el('button', {
        class: 'btn sm ghost', onclick: () => {
          t.variants.splice(i, 1);
          if (t.ref >= t.variants.length) t.ref = 0;
          if (t.view >= t.variants.length) t.view = 0;
          changed();
        }
      }, 'Retirer') : ''));
    });
    const add = t.variants.length < 4 ? el('button', {
      class: 'btn sm', onclick: () => {
        const p = FS.thermal.PRESETS.find((x) => !t.variants.some((v) => v.preset === x.key)) || FS.thermal.PRESETS[3];
        t.variants.push({ name: p.name, Uw: p.Uw, g: p.g, TL: p.TL, preset: p.key });
        changed();
      }
    }, 'Ajouter une variante') : null;
    return el('div', {},
      el('div', { class: 'section-title' }, el('h3', {}, 'Variantes de vitrage'), add),
      el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl variants' }, el('thead', {}, head),
        el('tbody', {}, Object.values(rows)))),
      el('small', {}, 'Valeurs types modifiables. Uw : baie complète (vitrage + menuiserie). g, TL : vitrage seul, à incidence normale. ' +
        'La variante de référence fixe le g utilisé dans l\'onglet Exposition.'));
  }

  // ---------- Rendu ----------
  function refresh() {
    if (!ui.main) return;
    const P = FS.project.get(), t = P.thermal, D = FS.project.derived();
    ui.fields.forEach((f) => f.sync());
    ui.inertia.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.k === t.inertia));
    ui.prot.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.k === t.protection.mode));
    ui.fFc.hidden = t.protection.mode !== 'fc';
    ui.fGt.hidden = t.protection.mode !== 'gtot';
    ui.fTh.hidden = t.protection.mode === 'none';
    ui.floorInfo.textContent = 'Zone de façade : profondeur ' + FS.fmt(t.depth, 1) + ' m, hauteur d\'étage ' + FS.fmt(P.floorH, 2) +
      ' m (onglet Site), soit ' + FS.fmt(t.depth / P.floorH, 2) + ' m² de plancher par m² de façade.';

    ui.main.innerHTML = '';
    ui.main.append(variantsEditor());
    const R = FS.uiResults.get(), c = FS.climate.get();
    if (!D.ok) { ui.main.append(el('p', { class: 'muted' }, 'Sélectionnez un bâtiment dans l\'onglet Site.')); return; }
    if (!R || !c) { ui.main.append(el('p', { class: 'status' }, 'En attente du climat et de l\'exposition solaire…')); return; }
    const t0 = performance.now();
    TR = FS.thermal.compute(D, R, c, t, P.floorH);
    const ms = performance.now() - t0;
    if (!TR.length || !TR[0].facades.length) { ui.main.append(el('p', { class: 'muted' }, 'Aucune façade exposée.')); return; }

    // comparaison des variantes
    const A = TR[0].totals.area, Fl = TR[0].totals.floor;
    const lines = [
      ['Chauffage', (o) => o.totals.QH / 1000, 'MWh/an', 1, true],
      ['Chauffage par m² de façade', (o) => o.totals.QH / A, 'kWh/m²·an', 0, true],
      ['Froid', (o) => o.totals.QC / 1000, 'MWh/an', 1, true],
      ['Froid par m² de façade', (o) => o.totals.QC / A, 'kWh/m²·an', 0, true],
      ['Chauffage + froid par m² de plancher de zone', (o) => (o.totals.QH + o.totals.QC) / Fl, 'kWh/m²·an', 0, true],
      ['Apports solaires par les vitrages', (o) => o.totals.Qsol / 1000, 'MWh/an', 1, false],
      ['Déperditions par les vitrages (saison de chauffe)', (o) => o.totals.QhtW / 1000, 'MWh/an', 1, false],
      ['Pic d\'apports solaires, façade la plus exposée', (o) => o.totals.peakGainFloor, 'W/m² de plancher', 0, false],
      ['Transmission lumineuse TL', (o) => o.variant.TL * 100, '%', 0, false]
    ];
    const head = el('tr', {}, el('th', {}, ''), el('th', {}, ''), TR.map((o, i) => el('th', { class: 'num' }, o.variant.name + (i === t.ref ? ' (réf.)' : ''))));
    const tb = el('tbody');
    for (const [lab, fn, unit, d, lower] of lines) {
      const vals = TR.map(fn);
      const best = lower ? Math.min(...vals) : null;
      tb.append(el('tr', {}, el('td', {}, lab), el('td', {}, el('small', {}, unit)),
        vals.map((v) => el('td', { class: 'num' + (lower && Math.abs(v - best) < 1e-9 && TR.length > 1 ? ' best' : '') },
          FS.fmt(v, d), lab.startsWith('Pic') ? [' ', riskTag(v)] : null))));
    }
    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Comparaison des variantes'),
      el('small', {}, 'Bâtiment entier : ' + FS.fmt(A, 0) + ' m² de façades exposées, ' + FS.fmt(Fl, 0) + ' m² de plancher en zone de façade' +
        (t.protection.mode !== 'none' ? ', avec protection solaire' : ', sans protection solaire'))));
    ui.main.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl compare' }, el('thead', {}, head), tb)));
    ui.main.append(el('p', { class: 'status' }, 'En gras : variante la plus sobre. Risque d\'inconfort d\'été selon le pic d\'apports solaires par m² de plancher de la zone : ' +
      'faible < 25 W/m², modéré 25–50, élevé > 50 (repère indicatif, hors apports internes et inertie).'));
    ui.main.append(FS.charts.groupBars(TR.map((o) => o.variant.name), [
      { name: 'Chauffage', color: FS.charts.HEAT, values: TR.map((o) => o.totals.QH / A) },
      { name: 'Froid', color: FS.charts.COOL, values: TR.map((o) => o.totals.QC / A) }
    ], { unit: 'kWh/m² de façade·an', labels: true, wrapLabels: true, title: 'Besoins par variante' }));

    // détail par façade
    const vi = Math.min(t.view, TR.length - 1), o = TR[vi];
    const chips = el('div', { class: 'chips' }, TR.map((x, i) => el('button', { class: 'chip' + (i === vi ? ' on' : ''), onclick: () => { t.view = i; FS.project.save(); refresh(); } }, x.variant.name)));
    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Détail par façade'), chips));
    const fb = el('tbody');
    for (const f of o.facades) {
      fb.append(el('tr', {},
        el('td', {}, el('b', {}, f.id)), el('td', {}, f.label), el('td', { class: 'num' }, FS.fmt(f.glazed, 0)), el('td', { class: 'num' }, FS.fmt(f.floor, 0)),
        el('td', { class: 'num' }, FS.fmt(f.QhtW / 1000, 1)), el('td', { class: 'num' }, FS.fmt(f.Qsol / 1000, 1)),
        el('td', { class: 'num' }, FS.fmt(f.QH / 1000, 1)), el('td', { class: 'num hl' }, FS.fmt(f.area ? f.QH / f.area : 0, 0)),
        el('td', { class: 'num' }, FS.fmt(f.QC / 1000, 1)), el('td', { class: 'num hl' }, FS.fmt(f.area ? f.QC / f.area : 0, 0)),
        el('td', { class: 'num' }, FS.fmt(f.peakGainFloor, 0), ' ', riskTag(f.peakGainFloor))));
    }
    ui.main.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {},
        el('tr', {}, el('th', {}, 'N°'), el('th', {}, 'Or.'), el('th', { class: 'num' }, 'Vitrage'), el('th', { class: 'num' }, 'Plancher'),
          el('th', { class: 'num' }, 'Déperd. vitrées'), el('th', { class: 'num' }, 'Apports sol.'),
          el('th', { class: 'num' }, 'Chauffage'), el('th', { class: 'num' }, 'Chauffage'), el('th', { class: 'num' }, 'Froid'), el('th', { class: 'num' }, 'Froid'),
          el('th', { class: 'num' }, 'Pic apports')),
        el('tr', {}, el('th', {}), el('th', {}), el('th', { class: 'num' }, el('small', {}, 'm²')), el('th', { class: 'num' }, el('small', {}, 'm²')),
          el('th', { class: 'num' }, el('small', {}, 'MWh/an')), el('th', { class: 'num' }, el('small', {}, 'MWh/an')),
          el('th', { class: 'num' }, el('small', {}, 'MWh/an')), el('th', { class: 'num' }, el('small', {}, 'kWh/m² fac.')),
          el('th', { class: 'num' }, el('small', {}, 'MWh/an')), el('th', { class: 'num' }, el('small', {}, 'kWh/m² fac.')),
          el('th', { class: 'num' }, el('small', {}, 'W/m² plancher')))),
      fb)));

    // profil mensuel de la variante affichée
    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Besoins mensuels : ' + o.variant.name), el('small', {}, 'MWh, bâtiment entier')));
    ui.main.append(FS.charts.groupBars(FS.climate.MONTHS.map((m) => m.replace('.', '')), [
      { name: 'Chauffage', color: FS.charts.HEAT, values: o.monthly.QH.map((v) => v / 1000) },
      { name: 'Froid', color: FS.charts.COOL, values: o.monthly.QC.map((v) => v / 1000) }
    ], { unit: 'MWh', title: 'Besoins mensuels' }));
    ui.main.append(el('p', { class: 'status' }, 'Températures extérieures mensuelles de l\'année type ; apports solaires heure par heure, masques compris' +
      (R.masks ? '' : ' (masques désactivés dans l\'onglet Exposition)') + '. Calcul en ' + FS.fmt(ms, 0) + ' ms.'));
  }

  function riskTag(w) { const r = FS.thermal.riskLevel(w); return el('span', { class: 'risk ' + r.key }, r.label); }

  FS.uiThermal = { build, refresh, get: () => TR };
})(window.FS);
