/* Vent : climat, pluie battante, ventilation naturelle, points de vigilance pour le confort piéton.
   Outil d'enjeux pour la phase offre, sans CFD ni soufflerie.

   Données : réanalyse ERA5 (Open-Meteo), 2015–2024, horaires : vitesse et direction du vent à
   10 m et 100 m, précipitations, température. ERA5 donne des moyennes horaires sur une maille de
   ≈ 30 km : il lisse les rafales et ignore les effets locaux (rues, tours, relief fin).

   Profil vertical (NF EN 1991-1-4 et annexe nationale) : v(z) = v10 · c_r(z) / c_r,II(10 m), avec
   c_r(z) = k_r·ln(max(z, z_min)/z0), k_r = 0,19·(z0/0,05)^0,07 ; la vitesse ERA5 à 10 m est
   prise comme référence en terrain de catégorie II (rase campagne). */
(function (FS) {
  'use strict';
  const RAD = Math.PI / 180;
  const YEARS = [2015, 2024];

  // Catégories de terrain (NF EN 1991-1-4/NA)
  const TERRAIN = {
    '0': { z0: 0.005, zmin: 1, label: '0 · mer, lac' },
    II: { z0: 0.05, zmin: 2, label: 'II · rase campagne' },
    IIIa: { z0: 0.2, zmin: 5, label: 'IIIa · bocage, campagne bâtie' },
    IIIb: { z0: 0.5, zmin: 9, label: 'IIIb · zone industrielle, villages' },
    IV: { z0: 1.0, zmin: 15, label: 'IV · zone urbaine dense' }
  };
  const kr = (z0) => 0.19 * Math.pow(z0 / 0.05, 0.07);
  function cr(z, cat) { const t = TERRAIN[cat] || TERRAIN.IV; return kr(t.z0) * Math.log(Math.max(z, t.zmin) / t.z0); }
  // facteur de passage de la vitesse ERA5 à 10 m (référence catégorie II) à la hauteur z sur le site
  const heightFactor = (z, cat) => cr(z, cat) / cr(10, 'II');

  // ---------- Données ----------
  let cache = { key: null, data: null };
  async function load(lat, lon) {
    const k = (Math.round(lat * 4) / 4).toFixed(2) + ',' + (Math.round(lon * 4) / 4).toFixed(2);
    if (cache.key === k) return cache.data;
    const url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&start_date=' + YEARS[0] + '-01-01&end_date=' + (YEARS[1] + 1) + '-01-01' +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_speed_100m,wind_direction_100m,precipitation,temperature_2m' +
      '&models=era5&timezone=GMT&wind_speed_unit=ms&timeformat=unixtime';
    const r = await fetch(url);
    if (!r.ok) throw new Error('Open-Meteo : erreur ' + r.status);
    const js = await r.json();
    cache = { key: k, data: prepare(js) };
    return cache.data;
  }

  /* Mise en forme : on garde les heures complètes des années 2015–2024 (valeur datée T = moyenne
     sur l'heure précédente, rangée à T − 30 min). */
  function prepare(js) {
    const h = js.hourly, T = h.time;
    const keep = [];
    for (let i = 0; i < T.length; i++) {
      const y = new Date(T[i] * 1000 - 1800e3).getUTCFullYear();
      if (y >= YEARS[0] && y <= YEARS[1] && h.wind_speed_10m[i] != null) keep.push(i);
    }
    const n = keep.length;
    const d = {
      n, years: YEARS[1] - YEARS[0] + 1, gridLat: js.latitude, gridLon: js.longitude,
      v10: new Float32Array(n), d10: new Float32Array(n), v100: new Float32Array(n), d100: new Float32Array(n),
      rain: new Float32Array(n), temp: new Float32Array(n), month: new Uint8Array(n), utc: new Float64Array(n)
    };
    keep.forEach((i, j) => {
      d.v10[j] = h.wind_speed_10m[i]; d.d10[j] = h.wind_direction_10m[i];
      d.v100[j] = h.wind_speed_100m[i] || 0; d.d100[j] = h.wind_direction_100m[i] || 0;
      d.rain[j] = h.precipitation[i] || 0; d.temp[j] = h.temperature_2m[i] == null ? NaN : h.temperature_2m[i];
      const t = T[i] * 1000 - 1800e3;
      d.utc[j] = t; d.month[j] = new Date(t).getUTCMonth();
    });
    return d;
  }

  const SEASONS = { annee: null, hiver: [11, 0, 1], printemps: [2, 3, 4], ete: [5, 6, 7], automne: [8, 9, 10] };
  const inSeason = (m, s) => !SEASONS[s] || SEASONS[s].indexOf(m) >= 0;

  // ---------- Rose des vents ----------
  const CLASSES = [0, 2, 4, 6, 8, 10];             // m/s : 0–2, 2–4, 4–6, 6–8, 8–10, > 10
  /* Rose à la hauteur z (facteur f appliqué à v10), 16 secteurs. → { sectors: [{ dir, freq, cls: [...] }], mean, calm, n } */
  function rose(d, f, season, nSec = 16) {
    const w = 360 / nSec;
    const sectors = Array.from({ length: nSec }, (_, i) => ({ dir: i * w, freq: 0, cls: new Array(CLASSES.length).fill(0), vsum: 0 }));
    let n = 0, sum = 0, calm = 0;
    for (let i = 0; i < d.n; i++) {
      if (!inSeason(d.month[i], season)) continue;
      const v = d.v10[i] * f;
      n++; sum += v;
      if (v < 0.5) { calm++; continue; }
      const s = sectors[Math.floor(((d.d10[i] + w / 2) % 360) / w) % nSec];
      let c = 0; while (c < CLASSES.length - 1 && v >= CLASSES[c + 1]) c++;
      s.cls[c]++; s.freq++; s.vsum += v;
    }
    for (const s of sectors) { s.meanV = s.freq ? s.vsum / s.freq : 0; s.freq /= n || 1; s.cls = s.cls.map((x) => x / (n || 1)); }
    return { sectors, mean: n ? sum / n : 0, calm: calm / (n || 1), n };
  }
  // Fréquence des heures par classe de vitesse et dépassements
  function speedStats(d, f, season) {
    const cls = new Array(CLASSES.length).fill(0);
    let n = 0, over5 = 0, over8 = 0, max = 0;
    for (let i = 0; i < d.n; i++) {
      if (!inSeason(d.month[i], season)) continue;
      const v = d.v10[i] * f;
      n++;
      let c = 0; while (c < CLASSES.length - 1 && v >= CLASSES[c + 1]) c++;
      cls[c]++;
      if (v > 5) over5++;
      if (v > 8) over8++;
      if (v > max) max = v;
    }
    return { cls: cls.map((x) => x / (n || 1)), over5: over5 / (n || 1), over8: over8 / (n || 1), max, n };
  }
  // Secteurs dominants des vents forts (v10 > seuil) : ceux qui portent au moins 10 % des heures fortes
  function dominant(d, threshold = 5, nSec = 16) {
    const w = 360 / nSec, cnt = new Array(nSec).fill(0);
    let tot = 0;
    for (let i = 0; i < d.n; i++) if (d.v10[i] > threshold) { cnt[Math.floor(((d.d10[i] + w / 2) % 360) / w) % nSec]++; tot++; }
    return cnt.map((c, i) => ({ dir: i * w, share: tot ? c / tot : 0 })).filter((s) => s.share >= 0.1).sort((a, b) => b.share - a.share);
  }

  // ---------- Pluie battante (NF EN ISO 15927-3, méthode des indices annuels) ----------
  /* Indice annuel « aéroport » : I_A = (2/9)·Σ v·r^(8/9) / N (L/m²·an), v (m/s) et r (mm/h) horaires,
     N années. Indice directionnel pour un mur de normale θ : I_WA = (2/9)·Σ v·r^(8/9)·cos(D − θ) / N,
     sur les heures où cos(D − θ) > 0 (D : direction d'où vient le vent). */
  function rainIndex(d) {
    let s = 0;
    for (let i = 0; i < d.n; i++) if (d.rain[i] > 0) s += d.v10[i] * Math.pow(d.rain[i], 8 / 9);
    return (2 / 9) * s / d.years;
  }
  function wallRainIndex(d, az) {
    let s = 0;
    for (let i = 0; i < d.n; i++) {
      if (d.rain[i] <= 0) continue;
      const c = Math.cos((d.d10[i] - az) * RAD);
      if (c > 0) s += d.v10[i] * Math.pow(d.rain[i], 8 / 9) * c;
    }
    return (2 / 9) * s / d.years;
  }
  // Rose de la pluie battante : part de Σ v·r^(8/9) par secteur
  function rainRose(d, nSec = 16) {
    const w = 360 / nSec, s = new Array(nSec).fill(0);
    let tot = 0;
    for (let i = 0; i < d.n; i++) {
      if (d.rain[i] <= 0) continue;
      const x = d.v10[i] * Math.pow(d.rain[i], 8 / 9);
      s[Math.floor(((d.d10[i] + w / 2) % 360) / w) % nSec] += x; tot += x;
    }
    return s.map((x, i) => ({ dir: i * w, share: tot ? x / tot : 0, index: (2 / 9) * x / d.years }));
  }
  // Coefficient d'obstacle O (ISO 15927-3, tableau 3) selon la distance du premier obstacle au moins aussi haut que le mur
  function obstructionFactor(dist) {
    if (dist == null || !isFinite(dist)) return 1;
    // bornes supérieures des classes de distance (m) et coefficient correspondant
    const t = [[8, 0.2], [15, 0.3], [25, 0.4], [40, 0.5], [60, 0.6], [80, 0.7], [100, 0.8], [120, 0.9]];
    for (const [lim, o] of t) if (dist < lim) return o;
    return 1;
  }
  // Coefficient de mur W (ISO 15927-3, tableau 4)
  const WALL = { haut: 0.5, courant: 0.2, bas: 0.4 };
  // Catégories d'exposition (BS 8104) sur l'indice annuel de façade, L/m²·an
  function rainClass(i) {
    if (i < 33) return { key: 'abrite', label: 'abritée', level: 0 };
    if (i < 56.5) return { key: 'moderee', label: 'modérée', level: 1 };
    if (i < 100) return { key: 'severe', label: 'sévère', level: 2 };
    return { key: 'tres', label: 'très sévère', level: 3 };
  }

  // ---------- Coefficients de pression (ventilation naturelle) ----------
  /* Swami & Chandra (1988), bâtiments bas : Cp(θ)/Cp(0) = ln[1,248 − 0,703 sin(θ/2) − 1,175 sin²θ
     + 0,131 sin³(2θG) + 0,769 cos(θ/2) + 0,07 G² sin²(θ/2) + 0,717 cos²(θ/2)], G = ln(L/l) (rapport de la
     largeur du mur à celle du mur adjacent), θ : angle entre le vent et la normale du mur.
     Cp(0) selon l'exposition (tables AIVC, Liddament 1986, bâtiment bas) : exposé 0,7 ; semi-abrité 0,4 ; abrité 0,2. */
  const EXPO = { expose: { cp0: 0.7, label: 'exposé' }, semi: { cp0: 0.4, label: 'semi-abrité' }, abrite: { cp0: 0.2, label: 'abrité' } };
  function scNorm(thetaDeg, G) {
    const t = Math.abs(((thetaDeg + 540) % 360) - 180) * RAD; // 0..π
    const s2 = Math.sin(t / 2), c2 = Math.cos(t / 2);
    const x = 1.248 - 0.703 * s2 - 1.175 * Math.pow(Math.sin(t), 2) + 0.131 * Math.pow(Math.sin(2 * t * G), 3) +
      0.769 * c2 + 0.07 * G * G * s2 * s2 + 0.717 * c2 * c2;
    return Math.log(Math.max(x, 1e-3));
  }
  const cp = (thetaDeg, G, expo) => (EXPO[expo] || EXPO.semi).cp0 * scNorm(thetaDeg, G);

  // ---------- Heures d'ouverture possibles ----------
  /* Heures où la température extérieure et la vitesse du vent (à la hauteur des ouvertures) sont dans
     les plages réglées ; option : heures de bureau (8 h–19 h, lundi–vendredi, heure légale).
     Par façade : heures où, en plus, la façade est au vent (Cp > 0,1). */
  function ventHours(d, f, opt, facades, G, expo, tz) {
    const res = { total: 0, bySeason: { hiver: 0, printemps: 0, ete: 0, automne: 0 }, occ: 0, facades: facades.map(() => 0) };
    const seasonOf = (m) => (m === 11 || m <= 1 ? 'hiver' : m <= 4 ? 'printemps' : m <= 7 ? 'ete' : 'automne');
    let offDay = -1, off = 1;
    for (let i = 0; i < d.n; i++) {
      const t = d.utc[i];
      const day = Math.floor(t / 86400e3);
      if (day !== offDay) { offDay = day; off = FS.solar.tzOffsetHours(day * 86400e3 + 12 * 3600e3, tz); }
      const loc = new Date(t + off * 3600e3), hour = loc.getUTCHours(), wd = loc.getUTCDay();
      if (opt.occ && (wd === 0 || wd === 6 || hour < 8 || hour >= 19)) continue;
      res.occ++;
      const T = d.temp[i], v = d.v10[i] * f;
      if (!(T >= opt.tmin && T <= opt.tmax && v >= opt.vmin && v <= opt.vmax)) continue;
      res.total++; res.bySeason[seasonOf(d.month[i])]++;
      facades.forEach((fa, k) => { if (cp(d.d10[i] - fa.az, G[k], expo[k]) > 0.1) res.facades[k]++; });
    }
    const yrs = d.years;
    res.total /= yrs; res.occ /= yrs; res.facades = res.facades.map((x) => x / yrs);
    for (const k in res.bySeason) res.bySeason[k] /= yrs;
    return res;
  }

  FS.wind = {
    TERRAIN, EXPO, CLASSES, SEASONS, WALL, YEARS, kr, cr, heightFactor, load, prepare, rose, speedStats, dominant,
    rainIndex, wallRainIndex, rainRose, obstructionFactor, rainClass, scNorm, cp, ventHours
  };
})(window.FS);
