/* Climat horaire : Open-Meteo (réanalyse ERA5, 0,25°), 2015–2024, puis année type.

   Année type (méthode TMY simplifiée, d'après Sandia / ISO 15927-4) : pour chaque mois
   calendaire, on retient le mois réel dont les distributions journalières (rayonnement global,
   température moyenne, maximale, minimale) sont les plus proches des distributions sur toutes
   les années (statistique de Finkelstein-Schafer, poids 0,5 / 0,25 / 0,125 / 0,125).
   On garde ainsi la variabilité réelle (passages nuageux, journées claires), qu'une moyenne
   heure par heure effacerait.

   Convention Open-Meteo : la valeur horaire datée T est la moyenne sur [T − 1 h, T].
   Le rayonnement direct normal est recalculé à partir de GHI et DHI avec la hauteur du soleil
   au milieu de l'heure, pour que GHI = DNI·sin h + DHI exactement. */
(function (FS) {
  'use strict';
  const YEARS = [2015, 2024];
  const REF_YEAR = 2026; // année non bissextile servant de calendrier à l'année type
  const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MSTART = MDAYS.reduce((a, d, i) => (a.push(a[i] + d * 24), a), [0]); // heure de début de chaque mois
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  // ---------- Encodage compact (cache et jeu de secours) ----------
  const enc = (arr, k) => Array.from(arr, (v) => Math.round(v * k)).join(',');
  const dec = (s, k) => Float32Array.from(s.split(','), (v) => +v / k);

  function pack(c) {
    return {
      v: 1, source: c.source, label: c.label, lat: c.lat, lon: c.lon, gridLat: c.gridLat, gridLon: c.gridLon,
      elevation: c.elevation, years: c.years, chosen: c.chosen, monthly: c.monthly,
      ghi: enc(c.ghi, 1), dhi: enc(c.dhi, 1), temp: enc(c.temp, 10)
    };
  }
  function unpack(o) {
    return Object.assign({}, o, { ghi: dec(o.ghi, 1), dhi: dec(o.dhi, 1), temp: dec(o.temp, 10) });
  }

  // ---------- Téléchargement ----------
  async function fetchOpenMeteo(lat, lon) {
    const url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&start_date=' + YEARS[0] + '-01-01&end_date=' + (YEARS[1] + 1) + '-01-01' + // + 1 jour : dernière heure de décembre

      '&hourly=temperature_2m,shortwave_radiation,diffuse_radiation&models=era5&timezone=GMT&timeformat=unixtime';
    const r = await fetch(url);
    if (!r.ok) throw new Error('Open-Meteo : erreur ' + r.status);
    const js = await r.json();
    if (!js.hourly || !js.hourly.time) throw new Error('Open-Meteo : réponse inattendue');
    return js;
  }

  // ---------- Année type ----------
  function cdfDistance(sample, pool) {
    // pool trié ; FS = moyenne |F_candidat(x) − F_long_terme(x)| aux points du candidat
    const s = sample.slice().sort((a, b) => a - b);
    const n = s.length, N = pool.length;
    let fs = 0, j = 0;
    for (let i = 0; i < n; i++) {
      while (j < N && pool[j] <= s[i]) j++;
      fs += Math.abs((i + 1) / n - j / N);
    }
    return fs / n;
  }

  /* hourly : { time: [s UTC], shortwave_radiation, diffuse_radiation, temperature_2m } */
  function buildTMY(hourly) {
    const T = hourly.time, G = hourly.shortwave_radiation, D = hourly.diffuse_radiation, TA = hourly.temperature_2m;
    // série par (année, mois) : heures [UTC], jours
    const byYM = {};
    for (let i = 0; i < T.length; i++) {
      // la valeur datée T couvre l'heure précédente : on la range à T − 30 min
      const d = new Date(T[i] * 1000 - 1800e3);
      const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
      if (y < YEARS[0] || y > YEARS[1]) continue;
      if (m === 1 && day === 29) continue;
      const k = y * 12 + m;
      const ym = byYM[k] || (byYM[k] = { y, m, idx: [], days: {} });
      ym.idx.push(i);
      const dd = ym.days[day] || (ym.days[day] = { g: 0, t: 0, tmax: -99, tmin: 99, n: 0 });
      const g = G[i] == null ? 0 : G[i], ta = TA[i] == null ? NaN : TA[i];
      dd.g += g; dd.t += ta; dd.n++;
      dd.tmax = Math.max(dd.tmax, ta); dd.tmin = Math.min(dd.tmin, ta);
    }
    const chosen = [], ghi = new Float32Array(8760), dhi = new Float32Array(8760), temp = new Float32Array(8760);
    const monthly = { ghiLT: [], tLT: [], ghiTMY: [], tTMY: [] };
    for (let m = 0; m < 12; m++) {
      const cands = [];
      for (let y = YEARS[0]; y <= YEARS[1]; y++) {
        const ym = byYM[y * 12 + m];
        if (!ym || ym.idx.length < MDAYS[m] * 24) continue; // mois incomplet
        const days = Object.values(ym.days);
        cands.push({
          y, ym,
          g: days.map((d) => d.g / 1000), t: days.map((d) => d.t / d.n),
          tx: days.map((d) => d.tmax), tn: days.map((d) => d.tmin)
        });
      }
      if (!cands.length) throw new Error('Données climatiques incomplètes (mois ' + (m + 1) + ')');
      const pool = (key) => cands.flatMap((c) => c[key]).sort((a, b) => a - b);
      const P = { g: pool('g'), t: pool('t'), tx: pool('tx'), tn: pool('tn') };
      for (const c of cands) {
        c.ws = 0.5 * cdfDistance(c.g, P.g) + 0.25 * cdfDistance(c.t, P.t) + 0.125 * cdfDistance(c.tx, P.tx) + 0.125 * cdfDistance(c.tn, P.tn);
        c.gSum = c.g.reduce((a, v) => a + v, 0);
      }
      // parmi les 4 mois les plus représentatifs, celui dont le cumul de rayonnement est le plus
      // proche de la moyenne (seconde étape de la méthode Sandia)
      const gMean = cands.reduce((a, c) => a + c.gSum, 0) / cands.length;
      const best = cands.slice().sort((a, b) => a.ws - b.ws).slice(0, 4)
        .sort((a, b) => Math.abs(a.gSum - gMean) - Math.abs(b.gSum - gMean))[0];
      chosen.push(best.y);
      const idx = best.ym.idx;
      for (let h = 0; h < MDAYS[m] * 24; h++) {
        const i = idx[h];
        const g = Math.max(0, G[i] || 0);
        ghi[MSTART[m] + h] = g;
        dhi[MSTART[m] + h] = Math.min(g, Math.max(0, D[i] || 0));
        temp[MSTART[m] + h] = TA[i] == null ? (TA[idx[Math.max(0, h - 1)]] || 0) : TA[i];
      }
      const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      monthly.ghiLT.push(cands.reduce((s, c) => s + c.g.reduce((a, v) => a + v, 0), 0) / cands.length);
      monthly.tLT.push(mean(P.t));
      monthly.ghiTMY.push(best.g.reduce((a, v) => a + v, 0));
      monthly.tTMY.push(mean(best.t));
    }
    const r1 = (a) => a.map((v) => Math.round(v * 10) / 10);
    for (const k in monthly) monthly[k] = r1(monthly[k]);
    return { ghi, dhi, temp, chosen, monthly };
  }

  // ---------- Chargement (cache, Open-Meteo, secours) ----------
  const key = (lat, lon) => 'climate:' + (Math.round(lat * 4) / 4).toFixed(2) + ',' + (Math.round(lon * 4) / 4).toFixed(2);
  let current = null;

  async function load(lat, lon, opts = {}) {
    const k = key(lat, lon);
    if (!opts.force) {
      if (current && current.cacheKey === k) return current;
      const cached = FS.store.get(k, null);
      if (cached && cached.v === 1) { current = Object.assign(unpack(cached), { cacheKey: k, cached: true }); return current; }
    }
    const js = await fetchOpenMeteo(lat, lon);
    const t = buildTMY(js.hourly);
    const c = {
      source: 'open-meteo', label: 'ERA5 ' + YEARS[0] + '–' + YEARS[1] + ' (Open-Meteo), année type',
      lat, lon, gridLat: js.latitude, gridLon: js.longitude, elevation: js.elevation, years: YEARS.slice(),
      chosen: t.chosen, monthly: t.monthly, ghi: t.ghi, dhi: t.dhi, temp: t.temp
    };
    FS.store.set(k, pack(c));
    current = Object.assign(c, { cacheKey: k });
    return current;
  }

  function fallback() {
    if (!FS.CLIMATE_PARIS) throw new Error('Jeu de secours absent');
    current = Object.assign(unpack(FS.CLIMATE_PARIS), { cacheKey: 'paris', fallback: true });
    return current;
  }

  const get = () => current;

  // Instant UTC (ms) de l'heure h de l'année type (valeur moyenne sur [t − 1 h, t] : milieu à t − 30 min)
  const hourMid = (h) => Date.UTC(REF_YEAR, 0, 1, 0, 0, 0) + h * 3600e3 + 1800e3;
  const monthOfHour = (h) => { let m = 0; while (m < 11 && h >= MSTART[m + 1]) m++; return m; };

  FS.climate = { load, fallback, get, buildTMY, pack, unpack, fetchOpenMeteo, hourMid, monthOfHour, MONTHS, MDAYS, MSTART, YEARS, REF_YEAR };
})(window.FS);
