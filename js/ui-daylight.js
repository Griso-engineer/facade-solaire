/* Onglet Lumière : ciel visible (VSC) et facteur de lumière du jour moyen, en ordre de grandeur. */
(function (FS) {
  'use strict';
  const el = FS.el;
  let ui = {}, DL = null;

  const L = () => FS.project.get().daylight;
  function changed() { FS.project.save(); refresh(); }

  function num(label, get, set, opt = {}) {
    const inp = el('input', { type: 'number', step: opt.step || 'any', min: opt.min, max: opt.max, value: get() });
    inp.addEventListener('change', () => { set(FS.clamp(FS.num(inp.value, get()), opt.min, opt.max)); changed(); });
    const f = el('label', { class: 'field' }, el('span', {}, label, opt.unit ? el('small', {}, ' (' + opt.unit + ')') : null), inp);
    f.sync = () => { if (document.activeElement !== inp) inp.value = Math.round(get() * 100) / 100; };
    return f;
  }

  function build() {
    const page = el('section', { class: 'page', id: 'page-lumiere', hidden: true });
    page.append(FS.blockHead('06', 'Lumière naturelle',
      'Ciel visible depuis chaque façade (VSC, méthode BRE) et facteur de lumière du jour moyen d\'une pièce type, par la formule BRE simplifiée.'));
    page.append(el('p', { class: 'note warn' },
      el('b', {}, 'Ordre de grandeur seulement. '),
      'Le VSC qualifie l\'accès au ciel de la façade ; le facteur de lumière du jour est estimé pour une pièce type rectangulaire, ' +
      'avec une formule empirique (Littlefair, BRE). Ni l\'un ni l\'autre ne remplace une simulation d\'éclairement (NF EN 17037) ' +
      'ni une étude de droit au jour.'));
    ui.main = el('div', {});
    ui.fields = [
      num('Largeur de la pièce type', () => L().roomW, (v) => { L().roomW = v; }, { unit: 'm', step: 0.5, min: 2, max: 20 }),
      num('Hauteur sous plafond', () => L().ceilingH, (v) => { L().ceilingH = v; }, { unit: 'm', step: 0.1, min: 2.2, max: 6 }),
      num('Réflexion moyenne des parois R', () => L().R, (v) => { L().R = v; }, { step: 0.05, min: 0.1, max: 0.8 }),
      num('Facteur d\'encrassement M', () => L().M, (v) => { L().M = v; }, { step: 0.05, min: 0.5, max: 1 })
    ];
    ui.variants = el('div', { class: 'chips' });
    ui.roomInfo = el('small', {});
    const side = el('aside', { class: 'side' },
      el('div', { class: 'panel' }, el('h3', {}, 'Vitrage'), ui.variants,
        el('small', {}, 'La transmission lumineuse TL vient des variantes de l\'onglet Thermique.')),
      el('div', { class: 'panel' }, el('h3', {}, 'Pièce type'),
        el('div', { class: 'grid2' }, ui.fields[0], ui.fields[1]), el('div', { class: 'grid2' }, ui.fields[2], ui.fields[3]), ui.roomInfo),
      el('div', { class: 'panel' }, el('h3', {}, 'Repères'),
        el('small', {}, 'VSC (BRE 209) : ≥ 27 % bon ; 15 à 27 % baies à agrandir ; 5 à 15 % difficile ; < 5 % très difficile. Mur dégagé : 39,6 %.'),
        el('small', {}, 'FLJm (BS 8206-2) : ≥ 2 % pièce bien éclairée, ≥ 5 % très lumineuse ; en logement, 1 % chambre, 1,5 % séjour, 2 % cuisine.')));
    page.append(el('div', { class: 'work' }, ui.main, side));
    document.getElementById('app').append(page);
    return page;
  }

  function tag(c) { return el('span', { class: 'risk ' + (c.key === 'bon' ? 'faible' : c.key === 'moyen' ? 'modere' : 'eleve') }, c.label); }

  function refresh() {
    if (!ui.main) return;
    const P = FS.project.get(), D = FS.project.derived(), T = P.thermal, Ls = L();
    ui.fields.forEach((f) => f.sync());
    const vi = Ls.variant != null && Ls.variant < T.variants.length ? Ls.variant : Math.min(T.ref, T.variants.length - 1);
    ui.variants.innerHTML = '';
    T.variants.forEach((v, i) => ui.variants.append(el('button', { class: 'chip' + (i === vi ? ' on' : ''), onclick: () => { Ls.variant = i; changed(); } },
      v.name + ' · TL ' + FS.fmt(v.TL * 100, 0) + ' %')));
    ui.roomInfo.textContent = 'Pièce de ' + FS.fmt(Ls.roomW, 1) + ' m × ' + FS.fmt(T.depth, 1) + ' m (profondeur de la zone de façade, onglet Thermique), ' +
      'baie = fraction vitrée × largeur × hauteur d\'étage, moins ' + FS.fmt(T.frame * 100, 0) + ' % de menuiserie.';
    ui.main.innerHTML = '';
    const R = FS.uiResults.get();
    if (!D.ok) { ui.main.append(el('p', { class: 'muted' }, 'Sélectionnez un bâtiment dans l\'onglet Site.')); return; }
    if (!R) { ui.main.append(el('p', { class: 'status' }, 'En attente des masques…')); return; }
    const v = T.variants[vi];
    DL = FS.daylight.compute(D, R.M, Ls, v.TL, T.frame, T.depth, P.floorH);
    const fs = DL.filter((f) => !f.pignon);
    if (!fs.length) { ui.main.append(el('p', { class: 'muted' }, 'Aucune façade vitrée.')); return; }

    // indicateurs
    const worst = fs.reduce((a, f) => ((f.low ? f.low.vsc : 1) < (a.low ? a.low.vsc : 1) ? f : a));
    const area = (f) => (R.facades.find((x) => x.id === f.id) || { area: 0 }).area;
    const Atot = fs.reduce((a, f) => a + area(f), 0) || 1;
    const vscMean = fs.reduce((a, f) => a + f.vsc * area(f), 0) / Atot;
    const adfMean = fs.reduce((a, f) => a + f.adf * area(f), 0) / Atot;
    const under = fs.filter((f) => f.low && f.low.adf < 2).length;
    ui.main.append(el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('b', {}, FS.pct(vscMean)), el('span', {}, 'VSC moyen des façades vitrées (39,6 % pour un mur dégagé)')),
      el('div', { class: 'kpi' }, el('b', {}, FS.pct(worst.low.vsc)), el('span', {}, 'VSC le plus faible : bas de la façade ' + worst.id + ' (' + FS.orientName[worst.label] + ')')),
      el('div', { class: 'kpi' }, el('b', {}, FS.fmtFixed(adfMean, 1) + ' %'), el('span', {}, 'FLJm moyen estimé, ' + v.name)),
      el('div', { class: 'kpi' }, el('b', {}, under + ' / ' + fs.length), el('span', {}, 'façades dont le niveau bas reste sous 2 % de FLJm'))));

    // tableau
    const tb = el('tbody');
    for (const f of fs) {
      tb.append(el('tr', {},
        el('td', {}, el('b', {}, f.id)), el('td', {}, f.label), el('td', { class: 'num' }, FS.pct(f.wwr)),
        el('td', { class: 'num hl' }, FS.pct(f.vsc)),
        el('td', { class: 'num' }, FS.pct(f.low.vsc), ' ', tag(FS.daylight.vscClass(f.low.vsc))),
        el('td', { class: 'num' }, FS.pct(f.high.vsc)),
        el('td', { class: 'num' }, FS.fmt(f.theta, 0) + '°'),
        el('td', { class: 'num' }, FS.fmtFixed(f.low.adf, 1) + ' %', ' ', tag(FS.daylight.adfClass(f.low.adf))),
        el('td', { class: 'num' }, FS.fmtFixed(f.high.adf, 1) + ' %'),
        el('td', { class: 'num hl' }, FS.fmtFixed(f.adf, 1) + ' %')));
    }
    ui.main.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {},
        el('tr', {}, el('th', {}, 'N°'), el('th', {}, 'Or.'), el('th', { class: 'num' }, 'Vitrée'),
          el('th', { class: 'num' }, 'VSC moyen'), el('th', { class: 'num' }, 'VSC bas'), el('th', { class: 'num' }, 'VSC haut'),
          el('th', { class: 'num' }, 'θ moyen'), el('th', { class: 'num' }, 'FLJm bas'), el('th', { class: 'num' }, 'FLJm haut'), el('th', { class: 'num' }, 'FLJm moyen'))),
      tb)));
    ui.main.append(el('p', { class: 'status' }, 'Bas, haut : premier et dernier niveau de la façade. θ : angle de ciel visible depuis le centre de la baie, ' +
      '90° moins l\'élévation moyenne des obstacles. Les héberges (aveugles) ne sont pas listées.'));

    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Ciel visible par façade'), el('small', {}, 'VSC, %')));
    ui.main.append(FS.charts.groupBars(fs.map((f) => f.id + ' · ' + f.label), [
      { name: 'Niveau bas', color: '#2a78d6', values: fs.map((f) => f.low.vsc * 100) },
      { name: 'Niveau haut', color: '#1baf7a', values: fs.map((f) => f.high.vsc * 100) }
    ], { unit: '%', labels: true, refLines: [{ v: 27, label: '27 % bon' }, { v: 15, label: '15 %' }], title: 'VSC par façade' }));

    // effet de la TL des variantes
    const tbv = el('tbody');
    T.variants.forEach((w) => {
      const d = FS.daylight.compute(D, R.M, Ls, w.TL, T.frame, T.depth, P.floorH).filter((f) => !f.pignon);
      const m = d.reduce((a, f) => a + f.adf * area(f), 0) / Atot;
      const lowMin = Math.min(...d.map((f) => f.low.adf));
      tbv.append(el('tr', {}, el('td', {}, w.name), el('td', { class: 'num' }, FS.fmt(w.TL * 100, 0) + ' %'),
        el('td', { class: 'num' }, FS.fmtFixed(m, 1) + ' %'), el('td', { class: 'num' }, FS.fmtFixed(lowMin, 1) + ' %')));
    });
    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Effet du vitrage sur la lumière'), el('small', {}, 'FLJm proportionnel à TL')));
    ui.main.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Variante'), el('th', { class: 'num' }, 'TL'), el('th', { class: 'num' }, 'FLJm moyen'), el('th', { class: 'num' }, 'FLJm le plus faible (bas)'))),
      tbv)));
  }

  FS.uiDaylight = { build, refresh, get: () => DL };
})(window.FS);
