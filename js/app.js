/* Interface : onglets, panneaux de saisie, tableau des façades, enchaînement. */
(function (FS) {
  'use strict';
  const el = FS.el;
  const pages = {};
  let ui = {};

  // ---------- Thème ----------
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: 'auto', light: 'clair', dark: 'sombre' };
  function applyTheme(t) {
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    FS.$('#btn-theme').textContent = 'Thème : ' + THEME_LABEL[t];
    FS.store.set('theme', t);
  }
  function cycleTheme() {
    const t = FS.store.get('theme', 'auto');
    applyTheme(THEMES[(THEMES.indexOf(t) + 1) % 3]);
    FS.map.render(); FS.scene3d.build();
  }

  // ---------- Mise à jour générale ----------
  function update(kind) {
    FS.project.invalidate();
    FS.project.save();
    FS.map.render();
    FS.uiSite.refresh();
    refresh3dSide();
    if (kind !== 'view' && kind !== 'mode' && kind !== 'thermal') FS.scene3d.build();
    if (kind === 'target') FS.scene3d.frame();
    if (FS.uiWind) FS.uiWind.refresh();
    if (FS.uiResults) { FS.uiResults.refresh(); if (kind === 'target' || kind === 'geom') FS.uiResults.ensureClimate(); }
  }

  // ---------- Onglet 3D ----------
  function build3d() {
    const P = FS.project.get();
    const page = el('section', { class: 'page', id: 'page-3d', hidden: true });
    page.append(FS.blockHead('03', 'Maquette 3D',
      'Façades colorées selon le rayonnement reçu : à un instant choisi (W/m²), en heures au-dessus de 300 W/m² sur une journée, ou en moyenne journalière sur l\'année type. Voisins en gris (teinte orangée : hauteur supposée).'));
    const sceneBox = el('div', { id: 'scene' });
    const viewport = el('div', { class: 'viewport' }, sceneBox);

    ui.fac3d = el('div', { class: 'tbl-wrap' });
    const side = el('aside', { class: 'side' },
      FS.view3d.build(viewport),
      el('div', { class: 'panel' }, el('h3', {}, 'Façades'), ui.fac3d,
        el('small', {}, 'Cliquez une façade (ou une ligne) pour la sélectionner.')));
    page.append(el('div', { class: 'work' }, viewport, side));
    pages['3d'] = page;
    FS.$('#app').append(page);
    FS.scene3d.init(sceneBox, { onPick: (id) => { FS.scene3d.select(id); FS.uiResults.select(id); refresh3dSide(id); FS.uiResults.refresh(); } });
    FS.scene3d.build();
    FS.scene3d.frame();
  }

  let sel3d = null;
  function refresh3dSide(selId) {
    if (!ui.fac3d) return;
    if (selId !== undefined) sel3d = selId;
    const P = FS.project.get(), D = FS.project.derived();
    ui.fac3d.innerHTML = '';
    if (!D.ok) { ui.fac3d.append(el('p', { class: 'muted' }, 'Sélectionnez un bâtiment dans l\'onglet Site.')); return; }
    const tb = el('tbody');
    for (const f of D.model.facades) {
      const tr = el('tr', { class: f.id === sel3d ? 'sel' : '', style: { cursor: 'pointer' }, onclick: () => { FS.scene3d.select(f.id); refresh3dSide(f.id); } },
        el('td', {}, el('b', {}, f.id)), el('td', {}, f.label), el('td', { class: 'num' }, Math.round(f.az) + '°'),
        el('td', { class: 'num' }, FS.fmt(f.area, 0) + ' m²'), el('td', { class: 'num' }, FS.pct(f.wwr)));
      tb.append(tr);
    }
    ui.fac3d.append(el('table', { class: 'tbl' }, el('thead', {}, el('tr', {},
      el('th', {}, 'N°'), el('th', {}, 'Or.'), el('th', { class: 'num' }, 'Azimut'), el('th', { class: 'num' }, 'Surface'), el('th', { class: 'num' }, 'Vitré'))), tb));
  }

  // ---------- Onglets à venir ----------
  function buildSoon(route, num, title, text, step) {
    const page = el('section', { class: 'page', id: 'page-' + route, hidden: true },
      FS.blockHead(num, title, text),
      el('p', { class: 'note' }, 'Prévu à l\'étape ' + step + ' du développement.'));
    pages[route] = page;
    FS.$('#app').append(page);
  }


  // ---------- Routage ----------
  function route() {
    const r = (location.hash.replace(/^#\/?/, '') || 'site');
    const key = pages[r] ? r : 'site';
    for (const k in pages) pages[k].hidden = k !== key;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
    if (key === 'site') FS.map.invalidateSize();
    if (key === '3d') FS.scene3d.redraw();
    if (key === 'fiche') FS.uiReport.onShow();
    if (key === 'vent') FS.uiWind.onShow();
  }

  // ---------- Projet : nouveau, import, export ----------
  function wireProject() {
    FS.$('#btn-theme').addEventListener('click', cycleTheme);
    FS.$('#btn-new').addEventListener('click', () => {
      if (!confirm('Démarrer un nouveau projet ? Le projet en cours sera effacé de ce navigateur (exportez-le d\'abord si besoin).')) return;
      FS.project.reset(); update('target'); FS.uiSite.setStatus('Nouveau projet. Cherchez une adresse.');
    });
    FS.$('#btn-export').addEventListener('click', () => {
      const P = FS.project.get();
      const nm = (P.name || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      FS.download('insolatio-' + (nm || 'projet') + '.json', FS.project.exportJSON());
    });
    const file = FS.$('#file-import');
    FS.$('#btn-import').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        FS.project.importJSON(await f.text());
        update('target'); FS.map.fit(); FS.uiSite.setStatus('Projet « ' + (FS.project.get().name || f.name) + ' » importé.');
      } catch (e) { alert('Import impossible : ' + e.message); }
      file.value = '';
    });
  }

  function start() {
    FS.project.load();
    applyTheme(FS.store.get('theme', 'auto'));
    if (!window.L) FS.$('#app').append(el('p', { class: 'note err', style: { margin: '20px var(--pad)' } }, 'Leaflet n\'a pas pu être chargé : vérifiez la connexion internet.'));
    pages.site = FS.uiSite.build();
    build3d();
    pages.resultats = FS.uiResults.build();
    pages.thermique = FS.uiThermal.build();
    pages.vent = FS.uiWind.build();
    pages.fiche = FS.uiReport.build();
    wireProject();
    window.addEventListener('hashchange', route);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { FS.map.render(); FS.scene3d.build(); });
    route();
    FS.uiSite.refresh(); refresh3dSide();
    FS.uiResults.refresh();
    // Lien direct vers un bâtiment : ?lat=48.8358&lon=2.3745[&r=150][&nom=…] → nouveau projet sur ce bâtiment
    const q = new URLSearchParams(location.search);
    const qlat = parseFloat(q.get('lat')), qlon = parseFloat(q.get('lon'));
    if (isFinite(qlat) && isFinite(qlon)) {
      FS.project.reset();
      const P = FS.project.get();
      if (q.get('r')) P.radius = FS.clamp(parseInt(q.get('r'), 10) || 150, 20, 500);
      if (q.get('nom')) P.name = q.get('nom');
      FS.map.flyTo(qlat, qlon);
      FS.uiSite.activate(2);
      FS.map.selectAt(qlat, qlon);
      return;
    }
    if (FS.project.get().target) FS.uiResults.ensureClimate();
    if (FS.project.get().target) FS.map.fit();
  }

  FS.app = { update };
  document.addEventListener('DOMContentLoaded', start);
})(window.FS);
