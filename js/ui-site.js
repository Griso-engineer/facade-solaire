/* Onglet Site : quatre étapes numérotées, chacune avec son bouton de validation.
     1 Localiser   2 Bâtiment étudié   3 Masques (voisins)   4 Vitrage
   L'étape active fixe ce que fait un clic sur la carte. Une étape validée passe au vert ; toute
   modification ultérieure la remet « à revalider » (orange). */
(function (FS) {
  'use strict';
  const el = FS.el;
  let ui = {}, active = 2;
  const STEP_MODE = { 1: 'none', 2: 'pick', 3: 'nb', 4: 'none' };
  const STEP_KEY = { 1: 'loc', 2: 'target', 3: 'nb', 4: 'glazing' };
  const STEP_TITLE = { 1: 'Localiser', 2: 'Bâtiment étudié', 3: 'Masques : bâtiments voisins', 4: 'Vitrage' };

  const P = () => FS.project.get();
  function update(kind) { FS.app.update(kind); }
  function setStatus(msg, err) { if (!ui.status) return; ui.status.textContent = msg || ''; ui.status.classList.toggle('err', !!err); }

  function numField(label, get, set, opt = {}) {
    const inp = el('input', { type: 'number', step: opt.step || 'any', min: opt.min, max: opt.max, value: get() });
    inp.addEventListener('change', () => { set(FS.num(inp.value, get())); if (opt.touch) FS.project.touch(...opt.touch); update(opt.kind || 'geom'); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    const f = el('label', { class: 'field' }, el('span', {}, label, opt.unit ? el('small', {}, ' (' + opt.unit + ')') : null), inp);
    f.sync = () => { if (document.activeElement !== inp) inp.value = Math.round(get() * 100) / 100; };
    f.input = inp;
    return f;
  }

  // ---------- Panneau d'étape ----------
  function stepPanel(n, body) {
    const key = STEP_KEY[n];
    const badge = el('span', { class: 'step-badge' });
    const btn = el('button', { class: 'btn step-ok', onclick: (e) => { e.stopPropagation(); validateStep(n); } });
    const head = el('button', { class: 'step-head', onclick: () => activate(n) },
      el('span', { class: 'step-num' }, n), el('span', { class: 'step-title' }, STEP_TITLE[n]), badge);
    const box = el('section', { class: 'step', 'data-n': n }, head, el('div', { class: 'step-body' }, body, el('div', { class: 'step-foot' }, btn)));
    box.sync = () => {
      const s = FS.project.step(key);
      box.classList.toggle('active', active === n);
      box.classList.toggle('done', s === 'ok');
      badge.className = 'step-badge ' + (s === 'ok' ? 'ok' : s === 'changed' ? 'changed' : 'todo');
      badge.textContent = s === 'ok' ? '✓ validé' : s === 'changed' ? 'modifié · à revalider' : 'à faire';
      btn.className = 'btn step-ok' + (s === 'ok' ? ' ok' : '');
      btn.textContent = s === 'ok' ? '✓ Étape ' + n + ' validée' : s === 'changed' ? "Revalider l'étape " + n : "Valider l'étape " + n;
      btn.disabled = !canValidate(n);
    };
    return box;
  }

  function canValidate(n) {
    const p = P();
    if (n === 1) return true;
    if (n === 2) return !!p.target;
    if (n === 3) return !!p.target;
    if (n === 4) return !!p.target;
    return true;
  }

  function validateStep(n) {
    // valeur globale saisie mais pas encore appliquée : on l'applique avant de valider
    if (n === 4 && Math.abs(FS.num(ui.wwr.value, P().wwr * 100) / 100 - P().wwr) > 1e-6) applyGlobalWwr();
    FS.project.validate(STEP_KEY[n]);
    const next = n < 4 ? n + 1 : 4;
    setStatus('Étape ' + n + ' validée' + (n < 4 ? ' : passez à l\'étape ' + next + '.' : '. Les onglets suivants utilisent ces données.'));
    if (n < 4) activate(next); else refresh();
    FS.map.render();
  }

  function activate(n) {
    active = n;
    let m = STEP_MODE[n];
    if (n === 2 && !P().target) m = ui.drawPreferred ? 'draw' : 'pick';
    FS.map.setMode(m);
    refresh();
  }

  // ---------- Construction ----------
  function build() {
    const page = el('section', { class: 'page', id: 'page-site' });
    page.append(FS.blockHead('01', 'Site et bâtiment',
      'Quatre étapes : localiser, choisir ou dessiner le bâtiment étudié (cours comprises), vérifier les bâtiments voisins qui font masque, régler le vitrage. Validez chaque étape.'));

    const mapBox = el('div', { id: 'map' });
    const viewport = el('div', { class: 'viewport' }, mapBox);
    ui.status = el('div', { class: 'status site-status', role: 'status' });
    ui.progress = el('div', { class: 'steps-progress' });

    // 1. Localiser
    const q = el('input', { type: 'search', placeholder: 'Adresse, lieu…', value: P().address || '' });
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
              res.hidden = true; q.value = r.label; P().address = r.label;
              FS.project.touch('loc'); FS.project.save();
              FS.map.flyTo(r.lat, r.lon);
              setStatus('Adresse trouvée. Validez, puis cliquez le bâtiment à étudier.');
              refresh();
            }
          }, r.label));
        }
      } catch (e) {
        res.textContent = '';
        res.append(el('div', { class: 'status err', style: { padding: '7px 9px' } }, 'Recherche indisponible : ' + e.message + (location.protocol === 'file:' ? ' (en local, lancez serve.ps1)' : '')));
      }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } if (e.key === 'Escape') res.hidden = true; });
    ui.addr = q;
    const s1 = stepPanel(1, el('div', { class: 'grid-gap' },
      el('div', { class: 'search' }, q, el('button', { class: 'btn', onclick: go }, 'Chercher'), res),
      location.protocol === 'file:' ? el('p', { class: 'note warn' }, 'Ouvert en local (file://) : le fond de carte et la recherche d\'adresse peuvent être refusés. Le site publié, ou serve.ps1, n\'a pas cette limite.') : null));

    // 2. Bâtiment étudié
    ui.how = el('div', { class: 'chips' },
      el('button', { class: 'chip', 'data-k': 'pick', onclick: () => { ui.drawPreferred = false; FS.map.setMode('pick'); refresh(); } }, 'Choisir sur la carte'),
      el('button', { class: 'chip', 'data-k': 'draw', onclick: () => { ui.drawPreferred = true; FS.map.setMode('draw'); refresh(); } }, 'Dessiner l\'emprise'));
    ui.targetInfo = el('div', { class: 'status' });
    ui.holeBtns = el('div', { class: 'row-actions', style: { marginTop: 0 } },
      el('button', { class: 'btn sm', onclick: () => { activeTo(2); FS.map.setMode('hole'); refresh(); } }, '+ Ajouter une cour intérieure'),
      ui.clearHoles = el('button', { class: 'btn sm ghost', onclick: () => { P().target.holes = []; P().wwrOver = {}; P().ignored = []; FS.project.touch('target', 'glazing'); update('geom'); } }, 'Retirer les cours'),
      el('button', { class: 'btn sm ghost', onclick: () => FS.map.fit() }, 'Recentrer'));
    const name = el('input', { type: 'text', placeholder: 'Nom du projet', value: P().name || '' });
    name.addEventListener('change', () => { P().name = name.value; FS.project.save(); });
    ui.name = name;
    const chipsH = el('div', { class: 'chips' });
    const mkChip = (m, label) => el('button', { class: 'chip', 'data-m': m, onclick: () => { P().heightMode = m; P().heightSrc = 'user'; FS.project.touch('target'); update('geom'); } }, label);
    chipsH.append(mkChip('levels', 'Niveaux × hauteur d\'étage'), mkChip('total', 'Hauteur totale'));
    ui.chipsH = chipsH;
    ui.fLv = numField('Niveaux (RDC compris)', () => P().levels, (v) => { P().levels = Math.max(1, Math.round(v)); P().heightSrc = 'user'; }, { min: 1, step: 1, touch: ['target'] });
    ui.fFh = numField('Hauteur d\'étage', () => P().floorH, (v) => { P().floorH = FS.clamp(v, 2, 8); P().heightSrc = 'user'; }, { min: 2, step: 0.1, unit: 'm', touch: ['target'] });
    ui.fTot = numField('Hauteur totale', () => P().totalH, (v) => { P().totalH = FS.clamp(v, 2, 400); P().heightSrc = 'user'; }, { min: 2, step: 0.5, unit: 'm', touch: ['target'] });
    ui.hSrc = el('div', { class: 'status' });
    const s2 = stepPanel(2, el('div', { class: 'grid-gap' },
      ui.how, ui.targetInfo, ui.holeBtns, name,
      el('h4', { style: { margin: '6px 0 0' } }, 'Hauteur'), chipsH, el('div', { class: 'grid2' }, ui.fLv, ui.fFh), ui.fTot, ui.hSrc));

    // 3. Masques
    ui.nbMode = el('div', { class: 'chips' },
      el('button', { class: 'chip', 'data-k': 'auto', onclick: () => setNbMode('auto') }, 'Automatique (rayon)'),
      el('button', { class: 'chip', 'data-k': 'manual', onclick: () => setNbMode('manual') }, 'Voisins dessinés'));
    ui.src = el('select', {}, el('option', { value: 'auto' }, 'Auto : IGN en France, sinon OSM'), el('option', { value: 'ign' }, 'BD TOPO IGN'), el('option', { value: 'osm' }, 'OpenStreetMap'));
    ui.src.addEventListener('change', () => { P().dataSource = ui.src.value; FS.project.touch('nb'); FS.project.save(); FS.map.refreshFootprints(); FS.map.reloadNeighbors(); });
    ui.fR = numField('Rayon des masques', () => P().radius, (v) => { P().radius = FS.clamp(Math.round(v), 20, 500); }, { min: 20, max: 500, step: 10, unit: 'm', kind: 'radius', touch: ['nb'] });
    ui.fR.input.addEventListener('change', () => FS.map.reloadNeighbors());
    ui.fNfh = numField('Hauteur par étage (voisins)', () => P().nbDefaults.floorH, (v) => { P().nbDefaults.floorH = FS.clamp(v, 2, 6); FS.project.refreshNeighborHeights(); }, { step: 0.1, unit: 'm', touch: ['nb'] });
    ui.fNdh = numField('Hauteur si inconnue', () => P().nbDefaults.defaultH, (v) => { P().nbDefaults.defaultH = FS.clamp(v, 0, 200); FS.project.refreshNeighborHeights(); }, { step: 1, unit: 'm', touch: ['nb'] });
    ui.autoBox = el('div', { class: 'grid-gap' },
      el('label', { class: 'field' }, 'Source des bâtiments', ui.src),
      el('div', { class: 'grid2' }, ui.fR, el('div', { style: { alignSelf: 'end' } }, el('button', { class: 'btn sm', onclick: () => FS.map.reloadNeighbors() }, 'Recharger'))),
      el('div', { class: 'grid2' }, ui.fNfh, ui.fNdh));
    ui.nbInfo = el('div', {});
    ui.nbList = el('div', {});
    const s3 = stepPanel(3, el('div', { class: 'grid-gap' },
      ui.nbMode, ui.autoBox, ui.nbInfo,
      el('div', { class: 'row-actions', style: { marginTop: 0 } },
        el('button', { class: 'btn sm', onclick: () => { activeTo(3); FS.map.setMode('draw-nb'); refresh(); } }, '+ Dessiner un voisin')),
      ui.nbList,
      el('div', { class: 'legend-inline' },
        el('span', { style: { '--sw': 'rgba(110,109,105,.32)', '--bw': 'var(--ink)' } }, 'hauteur connue'),
        el('span', { style: { '--sw': 'rgba(110,109,105,.32)', '--bw': 'var(--c-orange)' } }, 'hauteur supposée'),
        el('span', { style: { '--sw': 'var(--accent-soft)', '--bw': 'var(--accent)' } }, 'bâtiment étudié'))));

    // 4. Vitrage
    const wwr = el('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(P().wwr * 100) });
    wwr.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyGlobalWwr(); });
    ui.wwr = wwr;
    // RDC et dernier étage : vide = comme les étages courants
    const optPct = (label, key) => {
      const inp = el('input', { type: 'number', min: 0, max: 100, step: 5, placeholder: 'comme les étages' });
      inp.addEventListener('change', () => {
        P()[key] = inp.value === '' ? null : FS.clamp(FS.num(inp.value, 0), 0, 100) / 100;
        FS.project.touch('glazing'); update('glazing');
      });
      const f = el('label', { class: 'field' }, el('span', {}, label, el('small', {}, ' (%)')), inp);
      f.sync = () => { if (document.activeElement !== inp) inp.value = P()[key] == null ? '' : Math.round(P()[key] * 100); };
      return f;
    };
    ui.fG = optPct('Rez-de-chaussée', 'wwrGround');
    ui.fT = optPct('Dernier étage', 'wwrTop');
    ui.fRev = numField('Profondeur de tableau', () => P().reveal * 100, (v) => { P().reveal = FS.clamp(v, 0, 80) / 100; },
      { min: 0, max: 80, step: 5, unit: 'cm, retrait du vitrage', kind: 'glazing', touch: ['glazing'] });
    const s4 = stepPanel(4, el('div', { class: 'grid-gap' },
      el('label', { class: 'field' }, el('span', {}, 'Fraction vitrée des étages courants', el('small', {}, ' (% de la surface de façade)')),
        el('div', { class: 'search' }, wwr, el('button', { class: 'btn primary', onclick: applyGlobalWwr }, 'OK : appliquer à toutes les façades'))),
      ui.wwrInfo = el('small', {}),
      el('div', { class: 'grid2' }, ui.fG, ui.fT),
      el('small', {}, 'Laisser vide pour reprendre la valeur des étages courants. Les façades aveugles (héberges, valeur nulle) le restent.'),
      ui.fRev,
      el('small', {}, 'Retrait du vitrage par rapport au nu de la façade : le tableau et le linteau ombrent le vitrage (apports solaires réduits). Haussmannien : 20 à 30 cm ; façade légère : 5 à 15 cm.'),
      el('label', { class: 'check' }, ui.showWin = el('input', {
        type: 'checkbox', checked: P().showWindows !== false,
        onchange: () => { P().showWindows = ui.showWin.checked; FS.project.save(); FS.scene3d.build(); }
      }), 'Dessiner les fenêtres en 3D (rythme parisien théorique)')));

    ui.steps = [s1, s2, s3, s4];
    const side = el('aside', { class: 'side' }, ui.progress, ui.status, s1, s2, s3, s4);
    ui.facTable = el('div', { class: 'tbl-wrap' });
    page.append(el('div', { class: 'work' }, viewport, side));
    page.append(el('div', { style: { marginTop: '32px' } },
      FS.blockHead('02', 'Façades', 'Numérotées dans le sens horaire depuis le nord, contour puis cours. Azimut de la normale extérieure : 0° = nord, 90° = est, 180° = sud.', 'h2'),
      ui.facTable));
    document.getElementById('app').append(page);

    FS.map.init(mapBox, { onChange: onMapChange, setStatus });
    active = !P().address && !P().target ? 1 : !P().target ? 2 : 2;
    activate(active);
    if (!P().target) setStatus('Cherchez une adresse, puis cliquez sur le bâtiment à étudier (zoomez si les contours n\'apparaissent pas).');
    return page;
  }

  function activeTo(n) { if (active !== n) { active = n; } }

  function onMapChange(kind) {
    if (kind === 'target') FS.project.touch('target', 'nb', 'glazing');
    else if (kind === 'neighbors') FS.project.touch('nb');
    else if (kind === 'geom') FS.project.touch('target', 'glazing');
    update(kind === 'mode' ? 'mode' : kind);
  }

  function setNbMode(m) {
    P().nbMode = m;
    FS.project.touch('nb');
    FS.project.invalidate();
    activate(3);
    update('neighbors');
    if (m === 'auto' && !P().neighbors.length) FS.map.reloadNeighbors();
  }

  function applyGlobalWwr() {
    const v = FS.clamp(FS.num(ui.wwr.value, P().wwr * 100), 0, 100) / 100;
    const had = Object.keys(P().wwrOver).length;
    P().wwr = v; P().wwrOver = {};
    FS.project.touch('glazing');
    update('glazing');
    setStatus('Fraction vitrée de ' + FS.pct(v) + ' appliquée à toutes les façades' + (had ? ' (les ' + had + ' valeurs par façade ont été remplacées)' : '') + '. Héberges aveugles inchangées.');
  }

  // ---------- Rafraîchissement ----------
  function refresh() {
    if (!ui.steps) return;
    const p = P(), D = FS.project.derived();
    ui.steps.forEach((s) => s.sync());
    const nOk = ['loc', 'target', 'nb', 'glazing'].filter((k) => FS.project.step(k) === 'ok').length;
    ui.progress.innerHTML = '';
    ui.progress.append(el('b', {}, nOk + ' / 4 étapes validées'),
      el('span', { class: 'dots' }, [1, 2, 3, 4].map((n) => el('i', { class: FS.project.step(STEP_KEY[n]) || 'todo', title: STEP_TITLE[n] }))));
    if (document.activeElement !== ui.addr && p.address) ui.addr.value = p.address;
    if (document.activeElement !== ui.name) ui.name.value = p.name || '';
    const mode = FS.map.getMode();
    ui.how.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.k === (mode === 'draw' || mode === 'hole' ? 'draw' : 'pick') && active === 2));
    // étape 2
    ui.targetInfo.innerHTML = '';
    if (p.target && D.ok) {
      const src = { ign: 'BD TOPO IGN', osm: 'OpenStreetMap', dessin: 'emprise dessinée' }[p.target.source] || p.target.source;
      ui.targetInfo.append('Emprise ' + FS.fmt(D.model.footprintArea, 0) + ' m² (' + src + ')' +
        (D.holes.length ? ', ' + D.holes.length + ' cour' + (D.holes.length > 1 ? 's' : '') + ' intérieure' + (D.holes.length > 1 ? 's' : '') : ', sans cour') + '.');
    } else ui.targetInfo.append(mode === 'draw' ? 'Dessinez l\'emprise sur la carte.' : 'Aucun bâtiment : cliquez un contour sur la carte, ou dessinez l\'emprise.');
    ui.holeBtns.hidden = !p.target;
    ui.clearHoles.hidden = !(p.target && p.target.holes && p.target.holes.length);
    ui.chipsH.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.m === p.heightMode));
    ui.fLv.hidden = ui.fFh.hidden = p.heightMode !== 'levels';
    ui.fTot.hidden = p.heightMode !== 'total';
    [ui.fLv, ui.fFh, ui.fTot, ui.fR, ui.fNfh, ui.fNdh, ui.fG, ui.fT, ui.fRev].forEach((f) => f.sync());
    ui.hSrc.innerHTML = '';
    ui.hSrc.append('H = ' + FS.fmt(FS.project.height(p), 1) + ' m · ',
      FS.data.isHyp(p.heightSrc) ? el('span', { class: 'hyp' }, 'aucune donnée : hypothèse à vérifier') : (FS.data.SRC_LABEL[p.heightSrc] || ''));
    // étape 3
    ui.nbMode.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.k === p.nbMode));
    ui.autoBox.hidden = p.nbMode !== 'auto';
    ui.src.value = p.dataSource || 'auto';
    renderNb();
    // étape 4
    if (document.activeElement !== ui.wwr) ui.wwr.value = Math.round(p.wwr * 100);
    const nOver = Object.keys(p.wwrOver).length;
    ui.wwrInfo.textContent = nOver ? nOver + ' façade(s) ont une valeur propre (tableau ci-dessous) ; « OK » les remet toutes à la valeur globale.'
      : 'Toutes les façades sont à la valeur globale ; ajustez façade par façade dans le tableau ci-dessous.';
    renderTable();
  }

  function renderNb() {
    const p = P();
    const all = FS.project.effectiveNeighbors(p);
    const c = {};
    for (const nb of p.neighbors) c[nb.src] = (c[nb.src] || 0) + 1;
    const hyp = c.default || 0;
    ui.nbInfo.innerHTML = '';
    if (p.nbMode === 'auto') {
      ui.nbInfo.append(el('div', { class: 'status' },
        p.neighbors.length + ' bâtiments lus dans ' + p.radius + ' m' + (p.neighbors.length ? ' : ' + Object.keys(c).filter((k) => k !== 'default').map((k) => c[k] + ' ' + FS.data.SRC_LABEL[k]).join(', ') : '') +
        (hyp ? ', ' : '.'), hyp ? el('span', { class: 'hyp' }, hyp + ' sans hauteur (hypothèse ' + FS.fmt(p.nbDefaults.defaultH, 0) + ' m)') : null,
        p.drawn.length ? ' + ' + p.drawn.length + ' ajouté(s) à la main.' : ''));
      if (!p.neighbors.length && p.target) ui.nbInfo.append(el('p', { class: 'note warn' }, 'Aucun voisin détecté : agrandissez le rayon, changez de source, ou dessinez les voisins.'));
    } else {
      ui.nbInfo.append(el('div', { class: 'status' }, p.drawn.length ? p.drawn.length + ' voisin(s) dessiné(s) ou ajouté(s).' : 'Aucun voisin : dessinez-les, ou cliquez des bâtiments de la carte pour les ajouter.'));
    }
    // liste éditable : voisins dessinés ou ajoutés, puis voisins dont la hauteur est supposée
    ui.nbList.innerHTML = '';
    const rows = p.drawn.concat(p.nbMode === 'auto' ? p.neighbors.filter((n) => FS.data.isHyp(n.src) || n.src === 'user') : []);
    if (!rows.length) return;
    const tb = el('tbody');
    rows.slice(0, 40).forEach((nb) => {
      const inp = el('input', { type: 'number', min: 0, step: 0.5, value: Math.round(nb.height * 10) / 10 });
      inp.addEventListener('change', () => { nb.height = Math.max(0, FS.num(inp.value, nb.height)); nb.src = 'user'; FS.project.touch('nb'); FS.project.invalidate(); update('neighbors'); });
      const what = nb.source === 'dessin' ? 'dessiné' : nb.added ? 'ajouté' : FS.data.isHyp(nb.src) ? 'hauteur supposée' : 'corrigé';
      tb.append(el('tr', {},
        el('td', {}, el('span', { class: FS.data.isHyp(nb.src) ? 'hyp' : '' }, what)),
        el('td', { class: 'num' }, inp, ' m'),
        el('td', {}, el('button', {
          class: 'btn sm ghost', title: 'Retirer des masques', onclick: () => {
            const i = p.drawn.indexOf(nb);
            if (i >= 0) p.drawn.splice(i, 1); else { p.removed = (p.removed || []).concat(nb.id); p.neighbors.splice(p.neighbors.indexOf(nb), 1); }
            FS.project.touch('nb'); FS.project.invalidate(); update('neighbors');
          }
        }, '×'))));
    });
    ui.nbList.append(el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', {}, 'Voisin'), el('th', { class: 'num' }, 'Hauteur'), el('th', {}))), tb));
    if (rows.length > 40) ui.nbList.append(el('small', {}, '… et ' + (rows.length - 40) + ' autres : cliquez-les sur la carte.'));
  }

  function renderTable() {
    const p = P(), D = FS.project.derived();
    ui.facTable.innerHTML = '';
    if (!D.ok) { ui.facTable.append(el('p', { class: 'muted' }, 'Aucun bâtiment sélectionné.')); return; }
    const m = D.model, tb = el('tbody');
    let sA = 0, sG = 0;
    for (const f of m.facades) {
      // valeur des étages courants (le RDC et le dernier étage suivent les réglages globaux)
      const inp = el('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(f.wwrSet.mid * 100) });
      inp.addEventListener('change', () => {
        const v = FS.clamp(FS.num(inp.value, f.wwrSet.mid * 100), 0, 100) / 100;
        if (Math.abs(v - (f.pignon ? 0 : p.wwr)) < 1e-6) delete p.wwrOver[f.id]; else p.wwrOver[f.id] = v;
        FS.project.touch('glazing'); update('glazing');
      });
      const ign = el('input', {
        type: 'checkbox', checked: f.ignored, title: 'Exclure cette façade des analyses (mur mitoyen, façade sans intérêt…)',
        onchange: () => {
          p.ignored = (p.ignored || []).filter((x) => x !== f.id);
          if (ign.checked) p.ignored.push(f.id);
          FS.project.touch('glazing'); update('glazing');
        }
      });
      if (!f.ignored) { sA += f.area; sG += f.glazed; }
      tb.append(el('tr', { class: f.ignored ? 'ignored' : '' },
        el('td', {}, el('b', {}, f.id)),
        el('td', {}, f.label, el('span', { class: 'muted' }, ' · ' + FS.orientName[f.label]), f.cour ? el('span', { class: 'badge' }, ' cour ' + f.cour) : null),
        el('td', { class: 'num' }, Math.round(f.az) + '°'),
        el('td', { class: 'num' }, FS.fmtFixed(f.length, 1)),
        el('td', { class: 'num' }, FS.fmtFixed(D.H - f.zMin, 1)),
        el('td', { class: 'num' }, FS.fmt(f.area, 0)),
        el('td', { class: 'num' }, inp, ' %', f.wwrOverridden ? el('button', {
          class: 'btn sm ghost', title: 'Revenir à la valeur globale', onclick: () => { delete p.wwrOver[f.id]; FS.project.touch('glazing'); update('glazing'); }
        }, '↺') : null),
        el('td', { class: 'num' }, FS.fmt(f.glazed, 0) + ' (' + FS.pct(f.wwr) + ')'),
        el('td', { style: { whiteSpace: 'nowrap' } }, f.pignon
          ? el('span', { class: 'mito', title: 'Mur au-dessus d\'un mitoyen de ' + FS.fmt(f.zMin, 1) + ' m, supposé aveugle' }, 'héberge (mitoyen ' + FS.fmt(f.zMin, 0) + ' m)')
          : f.wwrOverridden ? el('span', { class: 'badge' }, 'valeur propre') : 'façade'),
        el('td', { class: 'num' }, el('label', { class: 'check', style: { justifyContent: 'flex-end' } }, ign))));
    }
    ui.facTable.append(el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'N°'), el('th', {}, 'Orientation'), el('th', { class: 'num' }, 'Azimut'), el('th', { class: 'num' }, 'Longueur (m)'),
        el('th', { class: 'num' }, 'Hauteur exposée (m)'), el('th', { class: 'num' }, 'Surface (m²)'), el('th', { class: 'num' }, 'Fraction vitrée étages'),
        el('th', { class: 'num' }, 'Vitrage (m², moyenne)'), el('th', {}, 'Type'), el('th', { class: 'num' }, 'Ignorer'))),
      tb,
      el('tfoot', {}, el('tr', {},
        el('td', { colspan: 5 }, el('b', {}, 'Total façades analysées')), el('td', { class: 'num' }, el('b', {}, FS.fmt(sA, 0))),
        el('td', {}), el('td', { class: 'num' }, el('b', {}, FS.fmt(sG, 0) + ' (' + FS.pct(sA ? sG / sA : 0) + ')')), el('td', {}), el('td', {})))));
    ui.facTable.append(el('p', { class: 'status' }, 'Fraction vitrée des étages courants, par façade ; le RDC et le dernier étage suivent les réglages de l\'étape 4. ' +
      'Une façade ignorée reste un obstacle pour les autres mais sort des analyses (exposition, thermique, fiche).'));
    const hidden = m.perimeter - m.facades.reduce((a, f) => a + f.length, 0);
    ui.facTable.append(el('p', { class: 'status', style: { marginTop: '8px' } },
      'Emprise ' + FS.fmt(m.footprintArea, 0) + ' m², périmètre ' + FS.fmt(m.perimeter, 0) + ' m' + (m.courts ? ' (cours comprises)' : '') +
      (hidden > 0.5 ? ', dont ' + FS.fmt(hidden, 0) + ' m de murs entièrement mitoyens (non exposés)' : '') +
      ' · ' + FS.project.effectiveNeighbors(p).length + ' bâtiments voisins pris en compte.'));
  }

  FS.uiSite = { build, refresh, setStatus, activate };
})(window.FS);
