/* Onglet Vent : climat de vent, pluie battante, ventilation naturelle, confort piéton. */
(function (FS) {
  'use strict';
  const el = FS.el, S = FS.svg;
  let ui = {}, data = null, loading = false, err = null, W = null, wKey = null, map = null, season = 'annee';

  const P = () => FS.project.get();
  function defaults() { return { terrain: 'IV', exposure: 'auto', tmin: 16, tmax: 26, vmin: 1, vmax: 6, occ: true, pilotis: false }; }
  const Wp = () => { const p = P(); if (!p.wind) p.wind = defaults(); return p.wind; };
  const LEVC = ['#f9c74f', '#f8961e', '#fb635f'], LEV = ['faible', 'modéré', 'élevé'];
  const CLASS_COL = (i, n) => FS.charts.colorAt(0.18 + 0.82 * i / (n - 1), 'sky');
  const SEC = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  const secName = (dir) => SEC[Math.round(dir / 22.5) % 16];

  function changed() { FS.project.save(); wKey = null; refresh(); if (FS.uiReport) FS.uiReport.refresh(); }

  function num(label, get, set, opt = {}) {
    const inp = el('input', { type: 'number', step: opt.step || 'any', min: opt.min, max: opt.max, value: get() });
    inp.addEventListener('change', () => { set(FS.clamp(FS.num(inp.value, get()), opt.min, opt.max)); changed(); });
    const f = el('label', { class: 'field' }, el('span', {}, label, opt.unit ? el('small', {}, ' (' + opt.unit + ')') : null), inp);
    f.sync = () => { if (document.activeElement !== inp) inp.value = get(); };
    return f;
  }

  // ---------- Construction ----------
  function build() {
    const page = el('section', { class: 'page', id: 'page-vent', hidden: true });
    page.append(FS.blockHead('06', 'Vent',
      'Climat de vent du site, pluie battante sur les façades, potentiel de ventilation naturelle et points de vigilance pour le confort piéton.'));
    page.append(el('p', { class: 'note warn' }, el('b', {}, 'Outil d\'enjeux, sans CFD. '),
      'Vent horaire de la réanalyse ERA5 (maille ≈ 30 km) : il lisse les rafales et ignore les effets locaux (rues, tours, relief). ' +
      'Les vitesses sont ramenées à la hauteur du bâtiment par le profil de l\'Eurocode ; la pluie battante suit l\'ISO 15927-3 ; ' +
      'les Cp sont des corrélations pour bâtiments bas ; le confort piéton est une lecture qualitative, qu\'une soufflerie ou une CFD doit quantifier.'));
    ui.main = el('div', {});
    const w = Wp();
    ui.terrain = el('div', { class: 'chips' }, Object.keys(FS.wind.TERRAIN).map((k) =>
      el('button', { class: 'chip', 'data-k': k, title: FS.wind.TERRAIN[k].label, onclick: () => { Wp().terrain = k; changed(); } }, k)));
    ui.terrainLab = el('small', {});
    ui.expo = el('div', { class: 'chips' }, [['auto', 'Auto'], ['expose', 'Exposé'], ['semi', 'Semi-abrité'], ['abrite', 'Abrité']].map(([k, lab]) =>
      el('button', { class: 'chip', 'data-k': k, onclick: () => { Wp().exposure = k; changed(); } }, lab)));
    ui.fields = [
      num('Température min.', () => Wp().tmin, (v) => { Wp().tmin = v; }, { unit: '°C', step: 1, min: -10, max: 30 }),
      num('Température max.', () => Wp().tmax, (v) => { Wp().tmax = v; }, { unit: '°C', step: 1, min: 0, max: 40 }),
      num('Vent min.', () => Wp().vmin, (v) => { Wp().vmin = v; }, { unit: 'm/s', step: 0.5, min: 0, max: 10 }),
      num('Vent max.', () => Wp().vmax, (v) => { Wp().vmax = v; }, { unit: 'm/s', step: 0.5, min: 1, max: 20 })
    ];
    ui.occ = el('input', { type: 'checkbox', checked: w.occ, onchange: () => { Wp().occ = ui.occ.checked; changed(); } });
    ui.pil = el('input', { type: 'checkbox', checked: w.pilotis, onchange: () => { Wp().pilotis = ui.pil.checked; changed(); } });
    const side = el('aside', { class: 'side' },
      el('div', { class: 'panel' }, el('h3', {}, 'Site'),
        el('label', { class: 'field' }, 'Catégorie de terrain (NF EN 1991-1-4)', ui.terrain), ui.terrainLab),
      el('div', { class: 'panel' }, el('h3', {}, 'Ventilation naturelle'),
        el('label', { class: 'field' }, 'Exposition des façades (Cp)', ui.expo),
        el('div', { class: 'grid2' }, ui.fields[0], ui.fields[1]), el('div', { class: 'grid2' }, ui.fields[2], ui.fields[3]),
        el('label', { class: 'check' }, ui.occ, 'Heures de bureau seulement (8 h–19 h, lun.–ven.)'),
        el('small', {}, 'Ouverture possible quand la température extérieure et le vent à mi-hauteur du bâtiment sont dans ces plages.')),
      el('div', { class: 'panel' }, el('h3', {}, 'Confort piéton'),
        el('label', { class: 'check' }, ui.pil, 'Pilotis ou passage sous le bâtiment')));
    page.append(el('div', { class: 'work' }, ui.main, side));
    document.getElementById('app').append(page);
    return page;
  }

  const shown = () => { const p = document.getElementById('page-vent'); return p && !p.hidden; };

  async function ensureData() {
    const D = FS.project.derived();
    if (!D.ok || loading) return;
    const k = (Math.round(D.lat * 4) / 4).toFixed(2) + ',' + (Math.round(D.lon * 4) / 4).toFixed(2);
    if (data && data.key === k) return;
    loading = true; err = null; render();
    try { data = await FS.wind.load(D.lat, D.lon); data.key = k; }
    catch (e) { err = e.message; data = null; }
    loading = false; wKey = null;
    refresh();
    if (FS.uiReport) FS.uiReport.refresh();
  }

  // ---------- Calculs ----------
  function compute() {
    const D = FS.project.derived();
    if (!D.ok || !data) return null;
    const w = Wp(), key = [data.key, D.H, w.terrain, w.exposure, w.tmin, w.tmax, w.vmin, w.vmax, w.occ, w.pilotis,
      JSON.stringify(D.model.facades.map((f) => [f.id, f.az, f.ignored, f.length])), D.nbs.length].join('|');
    if (key === wKey && W) return W;
    const t0 = performance.now();
    const fH = FS.wind.heightFactor(D.H, w.terrain), fMid = FS.wind.heightFactor(Math.max(D.H / 2, 2), w.terrain);
    const M = FS.results.masksFor(D);
    const facs = D.model.facades.map((f, fi) => ({ f, fi })).filter((x) => !x.f.ignored);
    const roses = {};
    for (const s of Object.keys(FS.wind.SEASONS)) roses[s] = FS.wind.rose(data, fH, s);
    const stats = FS.wind.speedStats(data, fH, 'annee');
    const stats10 = FS.wind.speedStats(data, 1, 'annee');
    let v100 = 0; for (let i = 0; i < data.n; i++) v100 += data.v100[i]; v100 /= data.n;
    const dom = FS.wind.dominant(data, 5);
    // pluie battante
    const IA = FS.wind.rainIndex(data);
    const rainR = FS.wind.rainRose(data);
    const rain = facs.map(({ f }) => {
      const IWA = FS.wind.wallRainIndex(data, f.az);
      const hit = FS.windSite.obstacleDistance(D, f, D.H);
      const O = FS.wind.obstructionFactor(hit ? hit.d : null);
      const crTop = FS.wind.cr(D.H, w.terrain), crMid = FS.wind.cr(Math.max(D.H / 2, f.zMin + 1), w.terrain);
      const low = D.H <= 8;
      const top = IWA * crTop * O * (low ? FS.wind.WALL.bas : FS.wind.WALL.haut);
      const cur = IWA * crMid * O * (low ? FS.wind.WALL.bas : FS.wind.WALL.courant);
      return { id: f.id, label: f.label, az: f.az, IWA, dist: hit ? hit.d : null, O, crTop, top, cur, cls: FS.wind.rainClass(top) };
    });
    // coefficients de pression
    const G = facs.map(({ f }) => FS.windSite.sideRatioG(D, f));
    const expo = facs.map(({ fi }) => (w.exposure === 'auto' ? FS.windSite.exposure(D, M, fi).key : w.exposure));
    const cpRows = facs.map(({ f }, k) => {
      let s = 0, n = 0, wind = 0;
      for (let i = 0; i < data.n; i++) {
        if (data.v10[i] * fMid < 1) continue;
        const c = FS.wind.cp(data.d10[i] - f.az, G[k], expo[k]);
        s += c; n++; if (c > 0) wind++;
      }
      return { id: f.id, label: f.label, az: f.az, G: G[k], expo: expo[k], mean: n ? s / n : 0, windward: n ? wind / n : 0, cp0: FS.wind.EXPO[expo[k]].cp0 };
    });
    const vent = FS.wind.ventHours(data, fMid, w, facs.map((x) => x.f), G, expo, P().tz);
    const ped = FS.windSite.pedestrian(D, dom, { pilotis: w.pilotis });
    W = { fH, fMid, roses, stats, stats10, v100, dom, IA, rainR, rain, cpRows, vent, ped, ms: performance.now() - t0, grid: [data.gridLat, data.gridLon] };
    wKey = key;
    return W;
  }

  // ---------- Rendu ----------
  function refresh() {
    if (!ui.main) return;
    const w = Wp();
    ui.terrain.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.k === w.terrain));
    ui.terrainLab.textContent = FS.wind.TERRAIN[w.terrain].label + ' : z0 = ' + FS.fmt(FS.wind.TERRAIN[w.terrain].z0, 3) + ' m, z_min = ' + FS.wind.TERRAIN[w.terrain].zmin + ' m.';
    ui.expo.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.k === w.exposure));
    ui.fields.forEach((f) => f.sync());
    ui.occ.checked = w.occ; ui.pil.checked = w.pilotis;
    if (!shown()) return;
    ensureData();
    render();
  }

  function render() {
    if (!ui.main || !shown()) return;
    ui.main.innerHTML = '';
    if (map) { map.remove(); map = null; }
    const D = FS.project.derived();
    if (!D.ok) { ui.main.append(el('p', { class: 'muted' }, 'Sélectionnez un bâtiment dans l\'onglet Site.')); return; }
    if (loading) { ui.main.append(el('p', { class: 'status' }, 'Chargement du vent et des pluies horaires (ERA5 2015–2024 via Open-Meteo)…')); return; }
    if (err) { ui.main.append(el('p', { class: 'note err' }, 'Données de vent indisponibles (' + err + '). ', el('button', { class: 'btn sm', onclick: () => { data = null; ensureData(); } }, 'Réessayer'))); return; }
    const R = compute();
    if (!R) return;
    renderClimate(D, R);
    renderRain(D, R);
    renderVent(D, R);
    renderPedestrian(D, R);
  }

  function kpi(v, l) { return el('div', { class: 'kpi' }, el('b', {}, v), el('span', {}, l)); }

  // 1. Climat de vent
  function renderClimate(D, R) {
    const w = Wp(), top = R.dom[0];
    ui.main.append(el('div', { class: 'kpis' },
      kpi(FS.fmtFixed(R.stats10.n ? R.roses.annee.mean / R.fH : 0, 1) + ' m/s', 'vent moyen à 10 m (ERA5, maille ' + FS.fmtFixed(R.grid[0], 2) + '° N, ' + FS.fmtFixed(R.grid[1], 2) + '° E)'),
      kpi(FS.fmtFixed(R.roses.annee.mean, 1) + ' m/s', 'à ' + FS.fmt(D.H, 0) + ' m sur le site (terrain ' + w.terrain + ', facteur ' + FS.fmtFixed(R.fH, 2) + ')'),
      kpi(top ? secName(top.dir) : '—', top ? 'direction dominante des vents forts (' + FS.pct(top.share) + ' des heures > 5 m/s à 10 m)' : 'pas de direction dominante'),
      kpi(FS.pct(R.stats.over5), 'des heures au-dessus de 5 m/s à la hauteur du bâtiment')));
    const chips = el('div', { class: 'chips' }, [['annee', 'Année'], ['hiver', 'Hiver'], ['printemps', 'Printemps'], ['ete', 'Été'], ['automne', 'Automne']].map(([k, lab]) =>
      el('button', { class: 'chip' + (k === season ? ' on' : ''), onclick: () => { season = k; render(); } }, lab)));
    const rs = R.roses[season];
    const cls = FS.wind.CLASSES;
    const legend = el('div', { class: 'legend-inline' }, cls.map((c, i) => el('span', { style: { '--sw': CLASS_COL(i, cls.length) } },
      i < cls.length - 1 ? c + '–' + cls[i + 1] + ' m/s' : '> ' + c + ' m/s')));
    const st = FS.wind.speedStats(data, R.fH, season);
    const bars = el('table', { class: 'tbl compact' }, el('thead', {}, el('tr', {}, el('th', {}, 'Vitesse à ' + FS.fmt(D.H, 0) + ' m'), el('th', { class: 'num' }, 'Heures'))),
      el('tbody', {}, st.cls.map((v, i) => el('tr', {},
        el('td', {}, el('span', { class: 'swatch', style: { background: CLASS_COL(i, cls.length) } }), i < cls.length - 1 ? cls[i] + ' à ' + cls[i + 1] + ' m/s' : 'plus de ' + cls[i] + ' m/s'),
        el('td', { class: 'num' }, FS.pct(v, 1))))));
    const prof = el('table', { class: 'tbl compact' }, el('tbody', {},
      el('tr', {}, el('td', {}, '10 m, ERA5 (référence, terrain II)'), el('td', { class: 'num' }, FS.fmtFixed(R.roses.annee.mean / R.fH, 1) + ' m/s')),
      el('tr', {}, el('td', {}, FS.fmt(D.H / 2, 0) + ' m, mi-hauteur sur le site'), el('td', { class: 'num' }, FS.fmtFixed(R.roses.annee.mean / R.fH * R.fMid, 1) + ' m/s')),
      el('tr', {}, el('td', {}, FS.fmt(D.H, 0) + ' m, sommet sur le site'), el('td', { class: 'num' }, FS.fmtFixed(R.roses.annee.mean, 1) + ' m/s')),
      el('tr', {}, el('td', {}, '100 m, ERA5'), el('td', { class: 'num' }, FS.fmtFixed(R.v100, 1) + ' m/s'))));
    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Climat de vent'), chips),
      el('div', { class: 'charts2' },
        el('div', {}, windRose(rs), legend),
        el('div', {}, bars, el('h4', { style: { marginTop: '14px' } }, 'Vitesse moyenne selon la hauteur'), prof,
          el('p', { class: 'status' }, 'Rose : fréquence des heures par direction d\'où vient le vent, à la hauteur du bâtiment. Calme (< 0,5 m/s) : ' + FS.pct(rs.calm, 1) + '. ' +
            'ERA5 donne des moyennes horaires : les rafales, jusqu\'à 1,5 à 2 fois plus fortes, et les accélérations locales ne sont pas représentées.'))));
  }

  // 2. Pluie battante
  function renderRain(D, R) {
    const rows = R.rain.slice().sort((a, b) => b.top - a.top);
    const tb = el('tbody', {}, rows.map((r, i) => el('tr', {},
      el('td', {}, el('b', {}, i + 1)), el('td', {}, r.id + ' · ' + r.label + ' ' + Math.round(r.az) + '°'),
      el('td', { class: 'num' }, FS.fmt(r.IWA, 0)), el('td', { class: 'num' }, r.dist == null ? 'aucun' : FS.fmt(r.dist, 0) + ' m'),
      el('td', { class: 'num' }, FS.fmtFixed(r.O, 1)), el('td', { class: 'num' }, FS.fmtFixed(r.crTop, 2)),
      el('td', { class: 'num hl' }, FS.fmt(r.top, 0)), el('td', { class: 'num' }, FS.fmt(r.cur, 0)),
      el('td', {}, el('span', { class: 'risk ' + ['faible', 'faible', 'modere', 'eleve'][r.cls.level] }, r.cls.label)))));
    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Pluie battante (NF EN ISO 15927-3)'),
      el('small', {}, 'Indice annuel « aéroport » I_A = ' + FS.fmt(R.IA, 0) + ' L/m²·an')),
      el('div', { class: 'charts2' },
        el('div', {}, rainRose(R.rainR, R.rain)),
        el('div', {}, el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Rang'), el('th', {}, 'Façade'), el('th', { class: 'num' }, 'I_WA'), el('th', { class: 'num' }, 'Obstacle'),
            el('th', { class: 'num' }, 'O'), el('th', { class: 'num' }, 'C_R'), el('th', { class: 'num' }, 'I_W haut'), el('th', { class: 'num' }, 'I_W courant'), el('th', {}, 'Exposition'))),
          tb)),
          el('p', { class: 'status' }, 'I_WA : indice annuel de mur (L/m²·an), somme de (2/9)·v·r^(8/9)·cos(D − θ) sur les heures de pluie où le vent vient vers la façade. ' +
            'I_W = I_WA × C_R (rugosité, à la hauteur) × C_T (1, site plat) × O (premier obstacle au moins aussi haut que le mur) × W (mur : ' +
            (D.H <= 8 ? '0,4 pour un bâtiment bas' : '0,5 sur les 2,5 m du haut, 0,2 en partie courante') + '). ' +
            'Exposition selon BS 8104 : abritée < 33, modérée 33–56,5, sévère 56,5–100, très sévère > 100 L/m²·an. ERA5 sous-estime les averses intenses.'))));
  }

  // 3. Ventilation naturelle
  function renderVent(D, R) {
    const w = Wp(), v = R.vent;
    const tb = el('tbody', {}, R.cpRows.map((r, k) => el('tr', {},
      el('td', {}, r.id + ' · ' + r.label), el('td', {}, FS.wind.EXPO[r.expo].label), el('td', { class: 'num' }, FS.fmtFixed(r.G, 2)),
      el('td', { class: 'num' }, FS.fmtFixed(r.cp0, 1)), el('td', { class: 'num hl' }, (r.mean >= 0 ? '+' : '') + FS.fmtFixed(r.mean, 2)),
      el('td', { class: 'num' }, FS.pct(r.windward)), el('td', { class: 'num' }, FS.fmt(v.facades[k], 0) + ' h'))));
    const best = R.cpRows.map((r, k) => ({ r, h: v.facades[k] })).sort((a, b) => b.h - a.h).slice(0, 2);
    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Ventilation naturelle'),
      el('small', {}, 'plages : ' + w.tmin + ' à ' + w.tmax + ' °C, vent ' + FS.fmtFixed(w.vmin, 1) + ' à ' + FS.fmtFixed(w.vmax, 1) + ' m/s à mi-hauteur' + (w.occ ? ', heures de bureau' : ''))),
      el('div', { class: 'kpis' },
        kpi(FS.fmt(v.total, 0) + ' h/an', 'd\'ouverture possible' + (w.occ ? ', sur ' + FS.fmt(v.occ, 0) + ' h de bureau (' + FS.pct(v.occ ? v.total / v.occ : 0) + ')' : '')),
        kpi(FS.fmt(v.bySeason.printemps, 0) + ' h', 'au printemps'),
        kpi(FS.fmt(v.bySeason.ete, 0) + ' h', 'en été'),
        kpi(FS.fmt(v.bySeason.automne, 0) + ' h', 'en automne')),
      el('div', { class: 'charts2' },
        el('div', {}, cpChart(), el('p', { class: 'status' }, 'Cp(θ) de Swami & Chandra (1988) pour un mur carré (G = 0), à trois niveaux d\'exposition (Cp à 0° des tables AIVC).')),
        el('div', {}, el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Façade'), el('th', {}, 'Exposition'), el('th', { class: 'num' }, 'G'), el('th', { class: 'num' }, 'Cp 0°'),
            el('th', { class: 'num' }, 'Cp moyen'), el('th', { class: 'num' }, 'Au vent'), el('th', { class: 'num' }, 'Ouverture au vent'))), tb)),
          el('p', { class: 'status' }, 'Cp moyen : moyenne sur les heures de vent (> 1 m/s). Au vent : part de ces heures où la façade est en surpression. ' +
            'Ouverture au vent : heures d\'ouverture possible où la façade est en surpression (Cp > 0,1). ' +
            (best.length ? 'Façade' + (best.length > 1 ? 's ' : ' ') + best.map((b) => b.r.id).join(' et ') + ' le plus souvent au vent pendant les heures d\'ouverture : la ventilation traversante vers les façades opposées y est la plus motrice. ' : '') +
            'Corrélations établies pour des bâtiments bas et isolés : ordre de grandeur pour un immeuble en ville. Le tirage thermique n\'est pas compté.'))));
  }

  // 4. Confort piéton
  function renderPedestrian(D, R) {
    const pts = R.ped.points.slice().sort((a, b) => b.level - a.level);
    const box = el('div', { class: 'wind-map' });
    const list = el('ol', { class: 'ped-list' }, pts.map((p) => el('li', {}, el('span', { class: 'lvl', style: { background: LEVC[p.level] } }, LEV[p.level]), ' ', p.text)));
    ui.main.append(el('div', { class: 'section-title' }, el('h3', {}, 'Confort piéton : points de vigilance'),
      el('small', {}, 'bâtiment ' + FS.fmt(D.H, 0) + ' m, ' + FS.fmtFixed(R.ped.ratio, 1) + ' fois la hauteur moyenne dans 100 m (' + FS.fmt(R.ped.Hm, 0) + ' m)')),
      el('div', { class: 'charts2 ped' }, box,
        el('div', {}, pts.length ? list : el('p', { class: 'muted' }, 'Aucun point de vigilance relevé par les règles utilisées.'),
          el('div', { class: 'legend-inline' }, LEV.map((l, i) => el('span', { style: { '--sw': LEVC[i] } }, l)), el('span', { class: 'line', style: { '--sw': 'var(--ink)' } }, 'vents forts dominants')),
          el('p', { class: 'note warn' }, el('b', {}, 'Lecture qualitative. '), 'Ces points signalent des configurations connues pour accélérer le vent au sol (angles, pied des façades hautes au vent, passages dans l\'axe des vents dominants, pilotis). ' +
            'Quantifier le confort (critères de Lawson, NEN 8100) demande des essais en soufflerie ou une simulation CFD.'))));
    setTimeout(() => drawMap(box, D, R, pts), 0);
  }

  function drawMap(box, D, R, pts) {
    if (!window.L || !box.isConnected) return;
    const p = P();
    map = L.map(box, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    for (const nb of FS.project.effectiveNeighbors(p)) L.polygon(nb.ll, { color: '#6e6d69', weight: 0.6, fillColor: '#6e6d69', fillOpacity: 0.3, interactive: false }).addTo(map);
    L.polygon([p.target.ll].concat(p.target.holes || []), { color: '#111110', weight: 2, fillColor: '#fb635f', fillOpacity: 0.35, interactive: false }).addTo(map);
    // vents forts dominants : flèches venant de leur direction
    for (const s of R.dom.slice(0, 3)) {
      const a = s.dir * Math.PI / 180, r0 = 110, r1 = 45;
      const A = D.proj.toLL(Math.sin(a) * r0, Math.cos(a) * r0), B = D.proj.toLL(Math.sin(a) * r1, Math.cos(a) * r1);
      L.polyline([A, B], { color: '#111110', weight: 2 + 6 * s.share, opacity: 0.7, interactive: false }).addTo(map);
      L.marker(A, { interactive: false, icon: L.divIcon({ className: 'wind-lab', html: secName(s.dir) + ' ' + FS.pct(s.share), iconSize: null }) }).addTo(map);
    }
    pts.forEach((pt, i) => {
      const ll = D.proj.toLL(pt.x, pt.y);
      L.circleMarker(ll, { radius: 9 + 3 * pt.level, color: '#111110', weight: 1.5, fillColor: LEVC[pt.level], fillOpacity: 0.9 }).addTo(map)
        .bindTooltip(String(i + 1), { permanent: true, direction: 'center', className: 'ped-num' })
        .bindPopup(pt.text);
    });
    const c0 = FS.geo.centroid(D.xy), R0 = 120;
    map.fitBounds(L.latLngBounds([D.proj.toLL(c0[0] - R0, c0[1] - R0), D.proj.toLL(c0[0] + R0, c0[1] + R0)]), { padding: [4, 4], maxZoom: 19 });
  }

  // ---------- Graphiques ----------
  function windRose(rs) {
    const Wd = 320, c = Wd / 2, r0 = 12, r1 = c - 26;
    const maxF = Math.max(0.02, ...rs.sectors.map((s) => s.freq));
    const step = maxF > 0.2 ? 0.1 : maxF > 0.1 ? 0.05 : 0.025, top = Math.ceil(maxF / step) * step;
    const rad = (f) => r0 + (r1 - r0) * f / top;
    const svg = S('svg', { viewBox: '0 0 ' + Wd + ' ' + Wd, class: 'chart rose' });
    for (let f = step; f <= top + 1e-9; f += step) {
      svg.append(S('circle', { cx: c, cy: c, r: rad(f), class: 'grid' }));
      svg.append(S('text', { x: c + rad(f) * Math.SQRT1_2 + 2, y: c - rad(f) * Math.SQRT1_2 - 2, class: 'tick' }, FS.fmt(f * 100, 1) + ' %'));
    }
    for (const [lab, a] of [['N', 0], ['E', 90], ['S', 180], ['O', 270]]) {
      svg.append(S('text', { x: c + (r1 + 14) * Math.sin(a * Math.PI / 180), y: c - (r1 + 14) * Math.cos(a * Math.PI / 180) + 4, class: 'card', 'text-anchor': 'middle' }, lab));
    }
    const n = FS.wind.CLASSES.length;
    for (const s of rs.sectors) {
      let acc = 0;
      const a0 = (s.dir - 9.5) * Math.PI / 180, a1 = (s.dir + 9.5) * Math.PI / 180;
      s.cls.forEach((f, i) => {
        if (f <= 0) return;
        const rin = rad(acc), rout = rad(acc + f);
        acc += f;
        const p = (a, r) => (c + r * Math.sin(a)).toFixed(1) + ',' + (c - r * Math.cos(a)).toFixed(1);
        const d = 'M' + p(a0, rin) + 'L' + p(a0, rout) + 'A' + rout + ',' + rout + ' 0 0 1 ' + p(a1, rout) + 'L' + p(a1, rin) + 'A' + rin + ',' + rin + ' 0 0 0 ' + p(a0, rin) + 'Z';
        const path = S('path', { d, fill: CLASS_COL(i, n), class: 'wedge' });
        const tip = secName(s.dir) + ' : ' + FS.pct(s.freq, 1) + ' des heures, ' + FS.fmtFixed(s.meanV, 1) + ' m/s en moyenne';
        path.addEventListener('mousemove', (e) => FS.showTip(tip, e.clientX, e.clientY));
        path.addEventListener('mouseleave', FS.hideTip);
        svg.append(path);
      });
    }
    return svg;
  }

  function rainRose(rr, facs) {
    const Wd = 320, c = Wd / 2, r0 = 12, r1 = c - 26;
    const max = Math.max(1e-6, ...rr.map((s) => s.index));
    const rad = (v) => r0 + (r1 - r0) * v / max;
    const svg = S('svg', { viewBox: '0 0 ' + Wd + ' ' + Wd, class: 'chart rose' });
    for (const k of [0.5, 1]) svg.append(S('circle', { cx: c, cy: c, r: rad(k * max), class: 'grid' }));
    svg.append(S('text', { x: c + rad(max) * Math.SQRT1_2 + 2, y: c - rad(max) * Math.SQRT1_2 - 2, class: 'tick' }, FS.fmt(max, 0) + ' L/m²·an'));
    for (const [lab, a] of [['N', 0], ['E', 90], ['S', 180], ['O', 270]]) {
      svg.append(S('text', { x: c + (r1 + 14) * Math.sin(a * Math.PI / 180), y: c - (r1 + 14) * Math.cos(a * Math.PI / 180) + 4, class: 'card', 'text-anchor': 'middle' }, lab));
    }
    for (const s of rr) {
      const a0 = (s.dir - 9.5) * Math.PI / 180, a1 = (s.dir + 9.5) * Math.PI / 180, rr2 = rad(s.index);
      const p = (a, r) => (c + r * Math.sin(a)).toFixed(1) + ',' + (c - r * Math.cos(a)).toFixed(1);
      const d = 'M' + p(a0, r0) + 'L' + p(a0, rr2) + 'A' + rr2 + ',' + rr2 + ' 0 0 1 ' + p(a1, rr2) + 'L' + p(a1, r0) + 'A' + r0 + ',' + r0 + ' 0 0 0 ' + p(a0, r0) + 'Z';
      const path = S('path', { d, fill: FS.charts.colorAt(0.25 + 0.75 * s.index / max, 'sky'), class: 'wedge' });
      const tip = 'Pluie poussée par un vent de ' + secName(s.dir) + ' : ' + FS.pct(s.share, 1) + ' de l\'indice (' + FS.fmt(s.index, 1) + ' L/m²·an)';
      path.addEventListener('mousemove', (e) => FS.showTip(tip, e.clientX, e.clientY));
      path.addEventListener('mouseleave', FS.hideTip);
      svg.append(path);
    }
    // façades du projet : flèche vers l'extérieur, numéro
    for (const f of facs) {
      const a = f.az * Math.PI / 180;
      svg.append(S('text', { x: c + (r1 + 2) * Math.sin(a), y: c - (r1 + 2) * Math.cos(a) + 4, class: 'lab', 'text-anchor': 'middle' }, String(f.id)));
    }
    return svg;
  }

  function cpChart() {
    const Wd = 420, H = 210, ml = 36, mr = 10, mt = 10, mb = 26, iw = Wd - ml - mr, ih = H - mt - mb;
    const x = (t) => ml + iw * t / 180, y = (v) => mt + ih * (0.8 - v) / 1.8; // −1,0 … 0,8
    const svg = S('svg', { viewBox: '0 0 ' + Wd + ' ' + H, class: 'chart' });
    for (const v of [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8]) {
      svg.append(S('line', { x1: ml, x2: Wd - mr, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
      svg.append(S('text', { x: ml - 4, y: y(v) + 3, class: 'tick', 'text-anchor': 'end' }, FS.fmtFixed(v, 1)));
    }
    for (let t = 0; t <= 180; t += 45) svg.append(S('text', { x: x(t), y: H - 8, class: 'tick', 'text-anchor': 'middle' }, t + '°'));
    const cols = { expose: '#2a78d6', semi: '#1baf7a', abrite: '#eda100' };
    for (const k of ['expose', 'semi', 'abrite']) {
      let d = '';
      for (let t = 0; t <= 180; t += 3) d += (t ? 'L' : 'M') + x(t).toFixed(1) + ',' + y(FS.wind.cp(t, 0, k)).toFixed(1);
      svg.append(S('path', { d, fill: 'none', stroke: cols[k], 'stroke-width': 2 }));
      svg.append(S('text', { x: x(4), y: y(FS.wind.cp(0, 0, k)) - 4, class: 'tick' }, FS.wind.EXPO[k].label));
    }
    svg.append(S('text', { x: ml + iw / 2, y: mt + 10, class: 'tick', 'text-anchor': 'middle' }, 'Cp selon l\'angle entre le vent et la normale de la façade'));
    return svg;
  }

  function onShow() { refresh(); }

  FS.uiWind = { build, refresh, onShow, ensureData, get: () => W, compute: () => (data ? compute() : null), defaults };
})(window.FS);
