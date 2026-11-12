/* Onglet Maquette 3D : coloration des façades (élément principal du panneau) et légendes.

   Modes :
     instant  éclairement (W/m²) à la date et à l'heure choisies, ciel clair, masques compris ;
     hours    nombre d'heures au-dessus de 300 W/m² sur la journée choisie, ciel clair ;
     annual / winter / summer
              énergie reçue en moyenne par jour (kWh/m²·jour), année type : énergie de la période
              divisée par son nombre de jours, nuits comprises ;
     peak     pic horaire d'été (W/m²), année type ;
     vsc      ciel visible (VSC, lumière naturelle) ;
     none     façades neutres.
   La date et l'heure (et donc les ombres portées) sont une sous-option des deux premiers modes. */
(function (FS) {
  'use strict';
  const el = FS.el;
  let ui = {}, field = null, fieldKey = null;
  const DAYS = { annual: 365, winter: 212, summer: 153 }; // oct.–avr. : 212 j ; mai–sept. : 153 j

  const P = () => FS.project.get();
  const mode = () => (P().view3d && P().view3d.mode) || 'annual';

  // Échelles (bornes fixes, pour comparer les projets entre eux)
  function scale(m) {
    const v = P().view;
    const date = FS.solar.dateOfDoy(2026, v.doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    switch (m) {
      case 'instant': return { label: 'Éclairement le ' + date + ' à ' + FS.solar.fmtHour(v.hour), unit: 'W/m²', max: 900 };
      case 'hours': return { label: 'Heures > 300 W/m² le ' + date, unit: 'h', max: 10 };
      case 'annual': return { label: 'Moyenne journalière sur l\'année', unit: 'kWh/m²·jour', max: 4, digits: 1, get: (x) => x.annual / DAYS.annual };
      case 'winter': return { label: 'Moyenne journalière d\'oct. à avr.', unit: 'kWh/m²·jour', max: 4, digits: 1, get: (x) => x.winter / DAYS.winter };
      case 'summer': return { label: 'Moyenne journalière de mai à sept.', unit: 'kWh/m²·jour', max: 4, digits: 1, get: (x) => x.summer / DAYS.summer };
      case 'peak': return { label: 'Pic horaire d\'été (année type)', unit: 'W/m²', max: 900, get: (x) => x.peak };
      case 'vsc': return { label: 'Ciel visible (VSC)', unit: '%', max: 40, ramp: 'sky', get: (x) => x.vsc * 100 };
      default: return null;
    }
  }

  // Texte explicatif sous la légende : ce que représente la valeur, ordres de grandeur, seuils usuels
  function note(m) {
    const c = FS.climate.get();
    let ghi = null;
    if (c) {
      const g = c.monthly.ghiTMY, sum = (ix) => ix.reduce((a, i) => a + g[i], 0);
      ghi = { annual: sum([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) / 365, winter: sum([9, 10, 11, 0, 1, 2, 3]) / 212, summer: sum([4, 5, 6, 7, 8]) / 153 };
    }
    switch (m) {
      case 'instant': return [
        'Rayonnement reçu à cet instant par ciel clair (modèle ASHRAE), ombres des voisins comprises. Changez la date et l\'heure ci-dessous : les ombres portées suivent.',
        'Repères : façade dans l\'ombre (diffus seul) 50 à 150 W/m² ; au-delà de 300 W/m², seuil usuel de fermeture d\'une protection solaire mobile (NF EN ISO 13790) ; façade face au soleil 600 à 850 W/m².'];
      case 'hours': return [
        'Nombre d\'heures de la journée où chaque zone de façade reçoit plus de 300 W/m² (ciel clair, pas de 10 min, masques compris).',
        'Repères indicatifs : moins de 2 h, exposition brève ; 2 à 4 h, matinée ou après-midi au soleil ; plus de 5 h, exposition prolongée où une protection solaire mobile se justifie en général.'];
      case 'annual': case 'winter': case 'summer': return [
        'Énergie reçue sur la période divisée par le nombre de jours (nuits comprises) : c\'est une moyenne par jour, comparable d\'une saison à l\'autre. Année type, masques compris.',
        'Repères' + (ghi ? ' sur ce site : sol horizontal dégagé ' + FS.fmtFixed(ghi[m], 1) + ' kWh/m²·jour' : '') + ' ; à Paris, façade sud dégagée ≈ 2,7 sur l\'année (≈ 3 l\'été, ≈ 2,5 l\'hiver), est ou ouest ≈ 2, nord ≈ 1. ' +
        'Il n\'y a pas de seuil normatif : l\'été, au-delà de ≈ 3 kWh/m²·jour sur une façade très vitrée, les apports deviennent importants ; l\'hiver, ce sont des apports gratuits.'];
      case 'peak': return [
        'Irradiance horaire la plus forte de mai à septembre sur l\'année type (moyenne sur une heure).',
        'Repères : au-delà de 300 W/m², seuil usuel de fermeture d\'une protection mobile ; 600 W/m² et plus, soleil direct franc sur la façade.'];
      case 'vsc': return [
        'Part du ciel couvert visible depuis la façade (méthode BRE). Mur dégagé : 39,6 %.',
        'Repères BRE : ≥ 27 % bon ; 15 à 27 % baies à agrandir ; < 15 % lumière naturelle difficile.'];
      default: return ['Façades en couleur neutre, fenêtres dessinées.'];
    }
  }

  // ---------- Panneau ----------
  const GROUPS = [
    ['À un instant (ciel clair)', [['instant', 'À la date et l\'heure (W/m²)'], ['hours', 'Heures > 300 W/m² sur un jour']]],
    ['Année type (climat du site)', [['annual', 'Moyenne / jour : année'], ['winter', 'hiver'], ['summer', 'été'], ['peak', 'Pic d\'été (W/m²)']]],
    ['Autres', [['vsc', 'Ciel visible (lumière)'], ['none', 'Neutre']]]
  ];

  function build(viewport) {
    ui.legend3d = el('div', {});
    viewport.append(ui.legend3d);
    ui.groups = el('div', { class: 'col-groups' }, GROUPS.map(([title, items]) => el('div', { class: 'col-group' },
      el('div', { class: 'col-title' }, title),
      el('div', { class: 'chips' }, items.map(([k, lab]) => el('button', { class: 'chip', 'data-m': k, onclick: () => setMode(k) }, lab))))));
    // date et heure : sous-option des modes « instant » et « heures »
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
    ui.when = el('div', { class: 'subpanel' },
      el('div', { class: 'time-row' }, el('span', {}, 'Date'), ui.doy, ui.doyLabel), ui.hourRow, quick);
    ui.note = el('div', { class: 'legend-note' });
    ui.summary = el('div', {});
    return el('div', { class: 'panel color-panel' },
      el('h3', {}, 'Coloration des façades', el('button', { class: 'btn sm ghost', onclick: () => FS.scene3d.frame() }, 'Recadrer')),
      ui.groups, ui.when, ui.note, ui.summary);
  }

  function setMode(m) {
    P().view3d = Object.assign({}, P().view3d, { mode: m });
    FS.project.save();
    refresh();
    if (FS.uiReport) FS.uiReport.refresh();
  }

  // le calcul « instant » suit les curseurs : on regroupe les rafraîchissements
  let pending = 0;
  function refreshSoon() { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; refresh(); }); }

  // ---------- Valeurs et coloration ----------
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
    if (!ui.groups) return;
    const p = P(), m = mode();
    ui.groups.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.m === m));
    const v = p.view;
    ui.when.hidden = !(m === 'instant' || m === 'hours');
    ui.hourRow.hidden = m !== 'instant';
    ui.doyLabel.textContent = FS.solar.dateOfDoy(2026, v.doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    ui.hourLabel.textContent = FS.solar.fmtHour(v.hour);
    if (document.activeElement !== ui.doy) ui.doy.value = v.doy;
    if (document.activeElement !== ui.hour) ui.hour.value = v.hour;
    ui.note.innerHTML = '';
    for (const t of note(m)) ui.note.append(el('p', {}, t));
    ui.legend3d.innerHTML = '';
    ui.summary.innerHTML = '';
    const sc = scale(m), D = FS.project.derived();
    if (!sc || !D.ok) { FS.scene3d.setColors(null); return; }
    const color = (x) => FS.charts.colorAt(x / sc.max, sc.ramp);

    if (m === 'instant' || m === 'hours') {
      const f = computeField(m);
      FS.scene3d.setColors((id, si, k) => {
        const fi = D.model.facades.findIndex((x) => x.id === id);
        const val = fi >= 0 && f.values[fi][si] ? f.values[fi][si][k] : null;
        return val == null ? null : color(val);
      });
      ui.legend3d.append(FS.charts.legendScale(sc));
      // moyennes par façade
      const rows = D.model.facades.map((fa, fi) => ({ id: fa.id, label: fa.label, v: FS.instant.facadeMean(D, f.values, fi) }));
      ui.summary.append(summaryTable(rows, sc, m === 'hours' ? 1 : 0),
        el('small', {}, m === 'instant' ? (f.extra.sky.up ? 'Soleil à ' + FS.fmt(f.extra.sky.alt / FS.RAD, 0) + '° de hauteur.' : 'Soleil sous l\'horizon : aucun rayonnement.')
          : 'Durée du jour : ' + FS.fmtFixed(f.extra.dayLength, 1) + ' h. Calcul en ' + FS.fmt(f.ms, 0) + ' ms.'));
      return;
    }
    // modes « année type » : besoin des résultats solaires
    const R = FS.uiResults && FS.uiResults.get();
    if (!R) { FS.scene3d.setColors(null); ui.summary.append(el('small', {}, 'Calcul en attente du climat…')); return; }
    const bySeg = {};
    for (const fa of R.facades) { bySeg[fa.id] = {}; for (const c of fa.cells) bySeg[fa.id][c.si] = c; }
    FS.scene3d.setColors((id, si, k) => {
      const c = bySeg[id] && bySeg[id][si], val = c && c.v[k];
      return val ? color(sc.get(val)) : null;
    });
    ui.legend3d.append(FS.charts.legendScale(sc));
    ui.summary.append(summaryTable(R.facades.map((fa) => ({ id: fa.id, label: fa.label, v: sc.get(fa) })), sc, sc.digits || 0));
  }

  function summaryTable(rows, sc, digits) {
    return el('table', { class: 'tbl compact' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Façade'), el('th', { class: 'num' }, sc.unit))),
      el('tbody', {}, rows.map((r) => el('tr', {},
        el('td', {}, el('span', { class: 'swatch', style: { background: FS.charts.colorAt(r.v / sc.max, sc.ramp) } }), r.id + ' · ' + r.label),
        el('td', { class: 'num' }, FS.fmtFixed(r.v, digits))))));
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
  const roseMode = () => (FS.charts.MODES[mode()] ? mode() : 'annual');

  FS.view3d = { build, refresh, setMode, tipFor, legendNow, caption, roseMode, mode, scale };
})(window.FS);
