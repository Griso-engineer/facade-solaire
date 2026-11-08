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
    refreshSite();
    refresh3dSide();
    if (kind !== 'view' && kind !== 'mode') FS.scene3d.build();
    if (kind === 'target') FS.scene3d.frame();
    if (FS.uiResults) { FS.uiResults.refresh(); if (kind === 'target' || kind === 'geom') FS.uiResults.ensureClimate(); }
  }

  function setStatus(msg, err) {
    ui.status.textContent = msg || '';
    ui.status.classList.toggle('err', !!err);
  }

  // ---------- Champs ----------
  function numField(label, get, set, opt = {}) {
    const inp = el('input', { type: 'number', step: opt.step || 'any', min: opt.min, max: opt.max, value: get() });
    inp.addEventListener('change', () => { set(FS.num(inp.value, get())); update(opt.kind || 'geom'); });
    const f = el('label', { class: 'field' }, el('span', {}, label, opt.unit ? el('small', {}, ' (' + opt.unit + ')') : null), inp);
    f.sync = () => { if (document.activeElement !== inp) inp.value = round(get()); };
    return f;
  }
  const round = (v) => Math.round(v * 100) / 100;

  // ---------- Onglet Site ----------
  function buildSite() {
    const P = FS.project.get();
    const page = el('section', { class: 'page', id: 'page-site' });
    page.append(FS.blockHead('01', 'Site et bâtiment',
      'Cherchez l\'adresse, cliquez sur le bâtiment : son emprise et ses voisins sont lus dans OpenStreetMap. Sinon, dessinez l\'emprise à la main.'));

    // Recherche
    const q = el('input', { type: 'search', placeholder: 'Adresse, lieu…', value: P.address || '' });
    const res = el('div', { class: 'search-results', hidden: true });
    const go = async () => {
      if (!q.value.trim()) return;
      res.hidden = false; res.textContent = 'Recherche…';
      try {
        const list = await FS.osm.search(q.value.trim());
        res.textContent = '';
        if (!list.length) res.append(el('div', { class: 'status', style: { padding: '7px 9px' } }, 'Aucun résultat.'));
        for (const r of list) {
          res.append(el('button', {
            type: 'button', onclick: () => {
              res.hidden = true; q.value = r.label; P.address = r.label; FS.project.save();
              FS.map.flyTo(r.lat, r.lon);
              setStatus('Cliquez sur le bâtiment à étudier.');
            }
          }, r.label));
        }
      } catch (e) {
        res.textContent = '';
        res.append(el('div', { class: 'status err', style: { padding: '7px 9px' } }, 'Recherche indisponible : ' + e.message + (location.protocol === 'file:' ? ' (en local, lancez serve.ps1)' : '')));
      }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } if (e.key === 'Escape') res.hidden = true; });
    const search = el('div', { class: 'search' }, q, el('button', { class: 'btn', onclick: go }, 'Chercher'), res);

    // Carte
    const mapBox = el('div', { id: 'map' });
    const hint = el('div', { class: 'map-hint' });
    const viewport = el('div', { class: 'viewport' }, mapBox, hint);
    ui.hint = hint;

    // Panneau
    ui.status = el('div', { class: 'status', role: 'status' });
    const btnSel = el('button', { class: 'btn sm', onclick: () => FS.map.setMode('select') }, 'Cliquer un bâtiment');
    const btnDraw = el('button', { class: 'btn sm', onclick: () => { FS.map.setMode('draw'); setStatus('Cliquez les sommets de l\'emprise sur la carte.'); } }, 'Dessiner l\'emprise');
    const btnFit = el('button', { class: 'btn sm ghost', onclick: () => FS.map.fit() }, 'Recentrer');
    ui.btnSel = btnSel; ui.btnDraw = btnDraw;

    const name = el('input', { type: 'text', placeholder: 'Nom du projet', value: P.name || '' });
    name.addEventListener('change', () => { P.name = name.value; FS.project.save(); });
    ui.name = name;

    // Hauteur
    const chipsH = el('div', { class: 'chips' });
    const mkChip = (m, label) => el('button', { class: 'chip', 'data-m': m, onclick: () => { P.heightMode = m; P.heightSrc = 'user'; update('geom'); } }, label);
    chipsH.append(mkChip('levels', 'Niveaux × hauteur d\'étage'), mkChip('total', 'Hauteur totale'));
    const fLv = numField('Niveaux', () => P.levels, (v) => { P.levels = Math.max(1, Math.round(v)); P.heightSrc = 'user'; }, { min: 1, step: 1 });
    const fFh = numField('Hauteur d\'étage', () => P.floorH, (v) => { P.floorH = FS.clamp(v, 2, 8); P.heightSrc = 'user'; }, { min: 2, step: 0.1, unit: 'm' });
    const fTot = numField('Hauteur totale', () => P.totalH, (v) => { P.totalH = FS.clamp(v, 2, 400); P.heightSrc = 'user'; }, { min: 2, step: 0.5, unit: 'm' });
    ui.hSrc = el('div', { class: 'status' });
    const fWwr = numField('Fraction vitrée globale', () => P.wwr * 100, (v) => { P.wwr = FS.clamp(v, 0, 100) / 100; }, { min: 0, max: 100, step: 5, unit: '%' });

    // Voisins
    const fR = numField('Rayon des masques', () => P.radius, (v) => { P.radius = FS.clamp(Math.round(v), 20, 500); }, { min: 20, max: 500, step: 10, unit: 'm', kind: 'radius' });
    fR.querySelector('input').addEventListener('change', () => FS.map.reloadNeighbors());
    const fNfh = numField('Hauteur par niveau (voisins)', () => P.nbDefaults.floorH, (v) => { P.nbDefaults.floorH = FS.clamp(v, 2, 6); FS.project.refreshNeighborHeights(); }, { step: 0.1, unit: 'm' });
    const fNdh = numField('Hauteur par défaut (voisins)', () => P.nbDefaults.defaultH, (v) => { P.nbDefaults.defaultH = FS.clamp(v, 0, 200); FS.project.refreshNeighborHeights(); }, { step: 1, unit: 'm' });
    ui.nbInfo = el('div', {});

    ui.fields = [fLv, fFh, fTot, fWwr, fR, fNfh, fNdh];
    ui.chipsH = chipsH; ui.fLv = fLv; ui.fFh = fFh; ui.fTot = fTot;

    const side = el('aside', { class: 'side' },
      el('div', { class: 'panel' }, el('h3', {}, 'Adresse'), search,
        location.protocol === 'file:' ? el('p', { class: 'note warn' }, 'Ouvert en local (file://) : le fond de carte et la recherche d\'adresse peuvent être refusés par OpenStreetMap. Le site publié, ou serve.ps1, n\'a pas cette limite.') : null),
      el('div', { class: 'panel' }, el('h3', {}, 'Bâtiment étudié'), name,
        el('div', { class: 'row-actions', style: { marginTop: 0 } }, btnSel, btnDraw, btnFit), ui.status),
      el('div', { class: 'panel' }, el('h3', {}, 'Hauteur'), chipsH, el('div', { class: 'grid2' }, fLv, fFh), fTot, ui.hSrc),
      el('div', { class: 'panel' }, el('h3', {}, 'Vitrage'), fWwr,
        el('small', {}, 'Surcharge par façade dans le tableau ci-dessous. Les héberges (murs au-dessus d\'un mitoyen) sont supposées aveugles.')),
      el('div', { class: 'panel' }, el('h3', {}, 'Voisins (masques)'), fR, el('div', { class: 'grid2' }, fNfh, fNdh), ui.nbInfo,
        el('div', { class: 'legend-inline' },
          el('span', { style: { '--sw': 'rgba(110,109,105,.25)', '--bw': 'var(--muted)' } }, 'hauteur OSM'),
          el('span', { style: { '--sw': 'rgba(110,109,105,.25)', '--bw': 'var(--c-orange)' } }, 'hypothèse'),
          el('span', { style: { '--sw': 'var(--accent-soft)', '--bw': 'var(--accent)' } }, 'bâtiment étudié')),
        el('small', {}, 'Cliquez un voisin sur la carte pour corriger sa hauteur.'))
    );

    ui.facTable = el('div', { class: 'tbl-wrap' });
    page.append(el('div', { class: 'work' }, viewport, side));
    page.append(el('div', { style: { marginTop: '32px' } },
      FS.blockHead('02', 'Façades', 'Numérotées dans le sens horaire depuis le nord. Azimut de la normale extérieure : 0° = nord, 90° = est, 180° = sud.', 'h2'),
      ui.facTable));
    pages.site = page;
    FS.$('#app').append(page);

    FS.map.init(mapBox, { onChange: (k) => (k === 'mode' ? refreshSite() : update(k)), setStatus });
    if (!P.target) setStatus('Cherchez une adresse puis cliquez sur le bâtiment.');
  }

  const SRC = { height: 'hauteur lue dans OSM (tag height)', levels: 'nombre de niveaux lu dans OSM', default: 'aucune donnée OSM : hypothèse par défaut', user: 'saisie manuelle' };

  function refreshSite() {
    if (!ui.status) return;
    const P = FS.project.get(), D = FS.project.derived();
    const mode = FS.map.getMode();
    ui.btnSel.classList.toggle('on', mode === 'select');
    ui.btnDraw.classList.toggle('on', mode === 'draw');
    ui.hint.textContent = mode === 'draw' ? 'Dessin : cliquez les sommets, fermez sur le premier point ou par double-clic. Échap pour annuler.'
      : (P.target ? 'Cliquez un autre bâtiment pour changer, ou un voisin pour corriger sa hauteur.' : 'Cliquez sur le bâtiment à étudier.');
    ui.chipsH.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.m === P.heightMode));
    ui.fLv.hidden = ui.fFh.hidden = P.heightMode !== 'levels';
    ui.fTot.hidden = P.heightMode !== 'total';
    ui.fields.forEach((f) => f.sync());
    if (document.activeElement !== ui.name) ui.name.value = P.name || '';
    const H = FS.project.height(P);
    ui.hSrc.innerHTML = '';
    ui.hSrc.append('H = ' + FS.fmt(H, 1) + ' m · ', P.heightSrc === 'default' ? el('span', { class: 'hyp' }, SRC.default) : SRC[P.heightSrc] || '');

    // voisins
    const c = { height: 0, levels: 0, default: 0, user: 0 };
    for (const nb of P.neighbors) c[nb.src]++;
    ui.nbInfo.innerHTML = '';
    ui.nbInfo.append(el('div', { class: 'status' },
      P.neighbors.length + ' voisins : ' + c.height + ' avec hauteur OSM, ' + c.levels + ' avec niveaux, ' + c.user + ' saisis, ',
      el('span', { class: c.default ? 'hyp' : '' }, c.default + ' en hypothèse (' + FS.fmt(P.nbDefaults.defaultH, 1) + ' m)')));

    // tableau des façades
    ui.facTable.innerHTML = '';
    if (!D.ok) { ui.facTable.append(el('p', { class: 'muted' }, 'Aucun bâtiment sélectionné.')); return; }
    const m = D.model;
    const tb = el('tbody');
    let sA = 0, sG = 0;
    for (const f of m.facades) {
      const inp = el('input', { type: 'number', min: 0, max: 100, step: 5, placeholder: Math.round((f.pignon ? 0 : P.wwr) * 100), value: f.wwrOverridden ? Math.round(f.wwr * 100) : '' });
      inp.addEventListener('change', () => {
        if (inp.value === '') delete P.wwrOver[f.id]; else P.wwrOver[f.id] = FS.clamp(FS.num(inp.value, 0), 0, 100) / 100;
        update('geom');
      });
      sA += f.area; sG += f.glazed;
      tb.append(el('tr', {},
        el('td', {}, el('b', {}, f.id)),
        el('td', {}, f.label, el('span', { class: 'muted' }, ' · ' + FS.orientName[f.label])),
        el('td', { class: 'num' }, Math.round(f.az) + '°'),
        el('td', { class: 'num' }, FS.fmtFixed(f.length, 1)),
        el('td', { class: 'num' }, FS.fmtFixed(D.H - f.zMin, 1)),
        el('td', { class: 'num' }, FS.fmt(f.area, 0)),
        el('td', { class: 'num' }, inp, ' %'),
        el('td', { class: 'num' }, FS.fmt(f.glazed, 0)),
        el('td', { style: { whiteSpace: 'nowrap' } }, f.pignon
          ? el('span', { class: 'mito', title: 'Mur au-dessus d\'un mitoyen de ' + FS.fmt(f.zMin, 1) + ' m, supposé aveugle' }, 'héberge (mitoyen ' + FS.fmt(f.zMin, 0) + ' m)')
          : 'façade')));
    }
    ui.facTable.append(el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'N°'), el('th', {}, 'Orientation'), el('th', { class: 'num' }, 'Azimut'), el('th', { class: 'num' }, 'Longueur (m)'),
        el('th', { class: 'num' }, 'Hauteur exposée (m)'), el('th', { class: 'num' }, 'Surface (m²)'), el('th', { class: 'num' }, 'Fraction vitrée'),
        el('th', { class: 'num' }, 'Vitrage (m²)'), el('th', {}, 'Type'))),
      tb,
      el('tfoot', {}, el('tr', {},
        el('td', { colspan: 5 }, el('b', {}, 'Total façades exposées')), el('td', { class: 'num' }, el('b', {}, FS.fmt(sA, 0))),
        el('td', { class: 'num' }, FS.pct(sA ? sG / sA : 0)), el('td', { class: 'num' }, el('b', {}, FS.fmt(sG, 0))), el('td', {})))));
    const hidden = m.perimeter - m.facades.reduce((a, f) => a + f.length, 0);
    ui.facTable.append(el('p', { class: 'status', style: { marginTop: '8px' } },
      'Emprise ' + FS.fmt(m.footprintArea, 0) + ' m², périmètre ' + FS.fmt(m.perimeter, 0) + ' m' +
      (hidden > 0.5 ? ', dont ' + FS.fmt(hidden, 0) + ' m de murs entièrement mitoyens (non exposés)' : '') +
      ' · ' + P.neighbors.length + ' bâtiments voisins.'));
  }

  // ---------- Onglet 3D ----------
  function build3d() {
    const P = FS.project.get();
    const page = el('section', { class: 'page', id: 'page-3d', hidden: true });
    page.append(FS.blockHead('03', 'Maquette 3D',
      'Bâtiment étudié en couleur, voisins en gris (teinte orangée : hauteur supposée). Réglez la date et l\'heure pour voir les ombres portées.'));
    const sceneBox = el('div', { id: 'scene' });
    const viewport = el('div', { class: 'viewport' }, sceneBox);

    const doy = el('input', { type: 'range', min: 1, max: 365, step: 1, value: P.view.doy });
    const hour = el('input', { type: 'range', min: 0, max: 24, step: 0.25, value: P.view.hour });
    ui.doyLabel = el('b'); ui.hourLabel = el('b');
    ui.doy = doy; ui.hour = hour;
    const onView = () => { P.view.doy = +doy.value; P.view.hour = +hour.value; FS.project.save(); FS.scene3d.updateSun(); refresh3dSide(); };
    doy.addEventListener('input', onView); hour.addEventListener('input', onView);
    const quick = el('div', { class: 'chips' });
    for (const [lab, m, d] of [['21 déc.', 12, 21], ['21 mars', 3, 21], ['21 juin', 6, 21], ['21 sept.', 9, 21], ['15 juil.', 7, 15]]) {
      quick.append(el('button', { class: 'chip', onclick: () => { doy.value = FS.solar.doyOf(2026, m, d); onView(); } }, lab));
    }
    let anim = 0;
    const play = el('button', {
      class: 'btn sm', onclick: () => {
        if (anim) { cancelAnimationFrame(anim); anim = 0; play.textContent = 'Animer la journée'; return; }
        play.textContent = 'Arrêter';
        const step = () => { let h = +hour.value + 0.05; if (h > 22) h = 4; hour.value = h; onView(); anim = requestAnimationFrame(step); };
        anim = requestAnimationFrame(step);
      }
    }, 'Animer la journée');

    ui.fac3d = el('div', { class: 'tbl-wrap' });
    const side = el('aside', { class: 'side' },
      el('div', { class: 'panel' }, el('h3', {}, 'Date et heure'),
        el('div', { class: 'time-row' }, el('span', {}, 'Date'), doy, ui.doyLabel),
        el('div', { class: 'time-row' }, el('span', {}, 'Heure légale'), hour, ui.hourLabel),
        quick, el('div', { class: 'row-actions', style: { marginTop: 0 } }, play,
          el('button', { class: 'btn sm ghost', onclick: () => FS.scene3d.frame() }, 'Recadrer'))),
      el('div', { class: 'panel' }, el('h3', {}, 'Façades'), ui.fac3d,
        el('small', {}, 'Cliquez une façade (ou une ligne) pour la sélectionner.')));
    page.append(el('div', { class: 'work' }, viewport, side));
    pages['3d'] = page;
    FS.$('#app').append(page);
    FS.uiResults.attach3d(viewport, side);
    FS.scene3d.init(sceneBox, { onPick: (id) => { FS.scene3d.select(id); FS.uiResults.select(id); refresh3dSide(id); FS.uiResults.refresh(); } });
    FS.scene3d.build();
    FS.scene3d.frame();
  }

  let sel3d = null;
  function refresh3dSide(selId) {
    if (!ui.fac3d) return;
    if (selId !== undefined) sel3d = selId;
    const P = FS.project.get(), D = FS.project.derived();
    const date = FS.solar.dateOfDoy(2026, P.view.doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    ui.doyLabel.textContent = date; ui.hourLabel.textContent = FS.solar.fmtHour(P.view.hour);
    if (document.activeElement !== ui.doy) ui.doy.value = P.view.doy;
    if (document.activeElement !== ui.hour) ui.hour.value = P.view.hour;
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

  // ---------- Méthode ----------
  function buildMethod() {
    const page = el('section', { class: 'page', id: 'page-methode', hidden: true });
    page.append(FS.blockHead('—', 'Méthode', 'Hypothèses, modèles et limites. Cet outil donne des ordres de grandeur pour la phase offre.'));
    page.append(el('div', { class: 'prose', html: METHOD_HTML }));
    pages.methode = page;
    FS.$('#app').append(page);
  }

  const METHOD_HTML = `
    <p class="note warn"><b>Ce n'est ni une simulation thermique dynamique (STD) ni un calcul réglementaire.</b>
    Les résultats sont des ordres de grandeur destinés à cadrer les enjeux d'une façade en phase offre.
    Ils ne remplacent ni une étude thermique, ni une étude d'éclairement, ni un calcul RE2020 ou RT existant.</p>
    <h3>Géométrie</h3>
    <ul>
      <li>Emprises lues dans OpenStreetMap (API Overpass), ou dessinées à la main. Pour un multipolygone,
        seul l'anneau extérieur principal est pris : les cours intérieures ne sont pas encore traitées.</li>
      <li>Hauteurs : tag <code>height</code>, sinon <code>building:levels</code> × hauteur par niveau (3 m par défaut,
        plus une demi-hauteur par niveau de comble), sinon 15 m. Ces deux dernières valeurs sont des hypothèses
        signalées en orange et modifiables, globalement ou voisin par voisin.</li>
      <li>Les bâtiments sont des prismes à toiture plate : pas de toitures en pente, de saillies, de balcons
        ni de végétation.</li>
      <li>Projection locale équirectangulaire autour du bâtiment (x vers l'est, y vers le nord), précise au
        centimètre à l'échelle d'un îlot.</li>
    </ul>
    <h3>Façades</h3>
    <ul>
      <li>Chaque côté de l'emprise est découpé en tronçons d'environ 1 m. Un tronçon est mitoyen lorsqu'un
        voisin touche le mur (à moins de 0,6 m sur la normale extérieure) ; la limite est ensuite localisée
        au centimètre. Seule la partie au-dessus du voisin (héberge) reste exposée, supposée aveugle par défaut ;
        un mur couvert sur toute sa hauteur n'est pas une façade.</li>
      <li>Les tronçons consécutifs orientés à ± 10° près forment une façade ; les retours de moins de 3 m sont
        rattachés à la façade voisine, mais chaque segment garde sa propre orientation pour les calculs.
        L'orientation affichée est la moyenne des segments principaux, pondérée par la longueur.</li>
      <li>Un voisin recouvert en majorité par l'emprise étudiée est écarté (cas d'un projet qui remplace
        l'existant) ; un voisin peut aussi être retiré à la main depuis la carte.</li>
      <li>Numérotation dans le sens horaire, à partir de la façade la plus proche du nord. Azimut de la
        normale extérieure : 0° nord, 90° est, 180° sud, 270° ouest.</li>
    </ul>
    <h3>Soleil</h3>
    <ul>
      <li>Position du soleil par l'algorithme du NOAA (formulation de Meeus), réfraction de Bennett.
        Précision de l'ordre de 0,01° entre 1800 et 2100.</li>
      <li>Heures légales du fuseau Europe/Paris (changement d'heure compris).</li>
      <li>Vérifiée contre l'exemple de référence du SPA du NREL (écart &lt; 0,01°) et les éphémérides de Paris (± 1 min).</li>
    </ul>
    <h3>Climat</h3>
    <ul>
      <li>Données horaires de la réanalyse ERA5 (maille de 0,25°, soit environ 28 × 18 km à Paris), 2015 à 2024,
        servies par l'API Open-Meteo : rayonnement global horizontal et température. Mises en cache dans le navigateur.</li>
      <li><b>Année type</b> : pour chaque mois, le mois réel le plus représentatif des dix ans (statistique de
        Finkelstein-Schafer sur les distributions journalières de rayonnement et de température, puis, parmi les quatre
        meilleurs, celui dont le cumul de rayonnement est le plus proche de la moyenne ; démarche de l'ISO 15927-4).
        On garde ainsi la variabilité réelle des journées, qu'une moyenne heure par heure effacerait.
        À Paris, l'année type est à 0,5 % de la moyenne décennale.</li>
      <li>Les jonctions entre mois ne sont pas lissées. Une année type n'est pas une année chaude : les pics
        estivaux d'une canicule peuvent être plus élevés.</li>
      <li>En cas d'indisponibilité d'Open-Meteo, un jeu de secours (année type de Paris, même méthode) est utilisé et
        signalé.</li>
    </ul>
    <h3>Rayonnement sur les façades</h3>
    <ul>
      <li><b>Partage direct / diffus</b> : le diffus est recalculé à partir du global par le modèle d'Erbs, Klein et
        Duffie (1982). Le diffus brut d'ERA5 paraît sous-estimé (39 % du global à Paris, contre 52 % avec Erbs) :
        avec lui, les façades est et ouest dépassent PVGIS de 8 à 12 %, contre 1 à 3 % avec Erbs. Il reste disponible en option.</li>
      <li>Direct normal déduit du global et du diffus, avec la hauteur du soleil au milieu de chaque heure
        (les valeurs horaires sont des moyennes sur l'heure écoulée).</li>
      <li><b>Diffus du ciel</b> : modèle de Perez (1990), qui distingue le ciel uniforme, l'auréole autour du soleil et
        la bande lumineuse de l'horizon. Option : ciel isotrope.</li>
      <li><b>Réfléchi</b> : sol uniforme, albédo 0,2 par défaut (enrobé, pavés ; 0,3 à 0,4 pour un sol clair).</li>
      <li><b>Validation</b> : façades verticales non masquées à Paris, contre PVGIS 5.3 (base satellite SARAH3,
        2005–2023) : sud −4 %, est +1 %, ouest −3 %, nord +25 % (la façade nord ne reçoit que du diffus, où les modèles
        de ciel divergent le plus ; PVGIS utilise le modèle de Muneer). Détail dans <code>tests.html</code>.</li>
    </ul>
    <h3>Masques</h3>
    <ul>
      <li>Chaque segment de façade porte une grille de points de calcul, d'environ 2 m de large sur 3 m de haut
        (un par étage), un peu plus lâche au-delà de 4 000 points. Les couleurs de la maquette 3D suivent cette grille.</li>
      <li>Pour chaque point, on calcule le <b>profil d'horizon</b> : pour chaque degré d'azimut devant le mur, l'élévation
        du plus haut obstacle, atan((h − z)/d), d'après les arêtes des volumes voisins et du bâtiment étudié lui-même
        (angles rentrants, cours). Les volumes étant des prismes à toit plat, ce lancer de rayons est exact au degré près.</li>
      <li>Heure par heure, le <b>direct</b> et le <b>circumsolaire</b> ne comptent que si le soleil est au-dessus de l'horizon
        du point. Le <b>diffus isotrope</b> est multiplié par le ciel vu du point, rapporté à un mur dégagé
        (facteur de vue intégré sur le profil d'horizon). La <b>bande d'horizon</b> de Perez est réduite à la part des
        directions dégagées sous 6°.</li>
      <li>Le <b>réfléchi par le sol</b> est conservé tel quel. On ne compte ni la réflexion des façades voisines (qui
        compense en partie), ni l'ombre portée sur le sol vu par la façade.</li>
      <li>Un point qui tombe dans un volume voisin plus haut (chevauchement d'emprises OSM) est écarté.</li>
      <li>Les arbres, le relief lointain, les balcons et les débords de toiture ne sont pas pris en compte.</li>
      <li><b>Validation</b> : élévation devant un vis-à-vis infini, à ± 0,05°, dans l'axe et de biais ; ciel vu face à une
        obstruction infinie d'angle β égal à 1 − sin β (solution analytique), à ± 0,01 ; auto-masque d'un bâtiment en L ;
        300 voisins traités en environ 0,2 s.</li>
    </ul>
    <h3>Diagramme de masque</h3>
    <p>Pour la façade sélectionnée, le diagramme montre en projection cylindrique la silhouette des obstacles vus d'un point
    (bas, milieu ou haut de la façade) et les courses du soleil des 21 juin, 21 décembre et des équinoxes. Les points pleins
    signalent les heures où le soleil est visible, les points creux celles où il est masqué.</p>
    <h3>Indicateurs</h3>
    <ul>
      <li>Irradiation annuelle, d'hiver (octobre à avril) et d'été (mai à septembre), en kWh/m² de façade : moyenne des
        segments de la façade pondérée par leur surface exposée.</li>
      <li>Pic d'été : irradiance horaire maximale (W/m²) de mai à septembre sur l'année type.</li>
      <li>Soleil direct : nombre d'heures où au moins la moitié de la façade est au soleil, avec un rayonnement direct
        supérieur à 120 W/m² (seuil de l'OMM pour la durée d'insolation).</li>
      <li>Masques : perte d'irradiation annuelle par rapport à la même façade sans aucun obstacle. Ciel vu : facteur de vue
        du ciel moyen de la façade, rapporté à un mur dégagé.</li>
      <li>Apports par les vitrages : irradiation × surface vitrée × facteur solaire g, sans protection solaire ni
        masque ; le pic d'apports est le maximum horaire en été (kW).</li>
      <li>Les échelles de couleur ont des bornes fixes (1 000 kWh/m²·an, 800 W/m²…) pour comparer les projets entre eux.</li>
    </ul>
    <h3>À venir</h3>
    <ul>
      <li>Étape 4 : bilan thermique mensuel et variantes de vitrage.</li>
      <li>Étape 5 : lumière naturelle (VSC, facteur de lumière du jour moyen).</li>
      <li>Étape 6 : fiche offre imprimable.</li>
    </ul>
    <h3>Sources des données</h3>
    <p>Fond de carte, emprises et hauteurs : © contributeurs OpenStreetMap, licence ODbL.
    Recherche d'adresse : Nominatim. Climat : réanalyse ERA5 (Copernicus Climate Change Service) via Open-Meteo,
    licence CC BY 4.0.</p>`;

  // ---------- Routage ----------
  function route() {
    const r = (location.hash.replace(/^#\/?/, '') || 'site');
    const key = pages[r] ? r : 'site';
    for (const k in pages) pages[k].hidden = k !== key;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
    if (key === 'site') FS.map.invalidateSize();
    if (key === '3d') FS.scene3d.redraw();
  }

  // ---------- Projet : nouveau, import, export ----------
  function wireProject() {
    FS.$('#btn-theme').addEventListener('click', cycleTheme);
    FS.$('#btn-new').addEventListener('click', () => {
      if (!confirm('Démarrer un nouveau projet ? Le projet en cours sera effacé de ce navigateur (exportez-le d\'abord si besoin).')) return;
      FS.project.reset(); update('target'); setStatus('Nouveau projet. Cherchez une adresse.');
    });
    FS.$('#btn-export').addEventListener('click', () => {
      const P = FS.project.get();
      const nm = (P.name || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      FS.download('facade-solaire-' + (nm || 'projet') + '.json', FS.project.exportJSON());
    });
    const file = FS.$('#file-import');
    FS.$('#btn-import').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        FS.project.importJSON(await f.text());
        update('target'); FS.map.fit(); setStatus('Projet « ' + (FS.project.get().name || f.name) + ' » importé.');
      } catch (e) { alert('Import impossible : ' + e.message); }
      file.value = '';
    });
  }

  function start() {
    FS.project.load();
    applyTheme(FS.store.get('theme', 'auto'));
    if (!window.L) FS.$('#app').append(el('p', { class: 'note err', style: { margin: '20px var(--pad)' } }, 'Leaflet n\'a pas pu être chargé : vérifiez la connexion internet.'));
    buildSite();
    build3d();
    pages.resultats = FS.uiResults.build();
    buildSoon('thermique', '05', 'Thermique', 'Bilan mensuel simplifié et comparaison de variantes de vitrage.', 4);
    buildSoon('lumiere', '06', 'Lumière', 'Ciel visible (VSC) et facteur de lumière du jour moyen, en ordre de grandeur.', 5);
    buildSoon('fiche', '07', 'Fiche offre', 'Synthèse imprimable A4 paysage.', 6);
    buildMethod();
    wireProject();
    window.addEventListener('hashchange', route);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { FS.map.render(); FS.scene3d.build(); });
    route();
    refreshSite(); refresh3dSide();
    FS.uiResults.refresh();
    if (FS.project.get().target) FS.uiResults.ensureClimate();
    if (FS.project.get().target) FS.map.fit();
  }

  FS.app = { update };
  document.addEventListener('DOMContentLoaded', start);
})(window.FS);
