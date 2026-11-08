/* Résultats solaires par façade : irradiation annuelle, mensuelle, hiver / été, pic estival,
   apports à travers le vitrage. Chaque façade est la somme de ses segments (chacun avec sa
   propre orientation), pondérée par leur surface exposée. */
(function (FS) {
  'use strict';
  const WINTER = [9, 10, 11, 0, 1, 2, 3]; // octobre → avril
  const SUMMER = [4, 5, 6, 7, 8];          // mai → septembre
  const isSummer = (m) => m >= 4 && m <= 8;

  let skyCache = { key: null, S: null };
  let resCache = { key: null, R: null };

  function skyFor(climate, lat, lon, split) {
    const k = climate.cacheKey + '|' + lat.toFixed(4) + '|' + lon.toFixed(4) + '|' + split;
    if (skyCache.key !== k) skyCache = { key: k, S: FS.irradiance.sky(climate, lat, lon, split) };
    return skyCache.S;
  }

  /* D : projet dérivé ; climate ; opts : { model, albedo, g } */
  function compute(D, climate, opts) {
    const geomKey = JSON.stringify(D.model.facades.map((f) => [f.segs.map((s) => [s.p0, s.p1, s.zMin]), f.wwr])) + D.H;
    const k = climate.cacheKey + '|' + D.lat.toFixed(5) + D.lon.toFixed(5) + '|' + opts.model + '|' + opts.split + '|' + opts.albedo + '|' + opts.g + '|' + geomKey;
    if (resCache.key === k) return resCache.R;
    const t0 = performance.now();
    const S = skyFor(climate, D.lat, D.lon, opts.split);
    const n = S.n;
    const out = [];
    for (const f of D.model.facades) {
      const sum = new Float32Array(n);   // Σ I·A (W)
      const glz = new Float32Array(n);   // Σ I·A_vitrée (W)
      let A = 0, Ag = 0;
      for (const s of f.segs) {
        const a = s.len * (D.H - s.zMin);
        if (a <= 0) continue;
        const I = FS.irradiance.plane(S, s.n[0], s.n[1], opts);
        const ag = a * f.wwr;
        for (let h = 0; h < n; h++) { sum[h] += I[h] * a; glz[h] += I[h] * ag; }
        A += a; Ag += ag;
      }
      const monthly = new Array(12).fill(0);
      let peak = 0, peakH = -1, peakGain = 0, sunH = 0;
      const nx = f.n[0], ny = f.n[1];
      for (let h = 0; h < n; h++) {
        const I = A ? sum[h] / A : 0;
        monthly[S.month[h]] += I / 1000;
        if (isSummer(S.month[h])) {
          if (I > peak) { peak = I; peakH = h; }
          const gW = glz[h] * opts.g;
          if (gW > peakGain) peakGain = gW;
        }
        if (S.up[h] && S.dni[h] > 120 && S.sx[h] * nx + S.sy[h] * ny > 0) sunH++;
      }
      const annual = monthly.reduce((a, v) => a + v, 0);
      const winter = WINTER.reduce((a, m) => a + monthly[m], 0);
      const summer = SUMMER.reduce((a, m) => a + monthly[m], 0);
      out.push({
        id: f.id, az: f.az, label: f.label, pignon: f.pignon, area: A, glazed: Ag, wwr: f.wwr,
        monthly, annual, winter, summer, peak, peakH, sunHours: sunH,
        incident: annual * A,                       // kWh/an sur la façade
        gainsAnnual: annual * Ag * opts.g,          // kWh/an à travers le vitrage
        gainsSummer: summer * Ag * opts.g,
        gainsWinter: winter * Ag * opts.g,
        gainsMonthly: monthly.map((v) => v * Ag * opts.g),
        peakGain,                                   // W, pic horaire d'été à travers le vitrage
        hourly: sum.map((v) => (A ? v / A : 0))     // W/m², moyenne de la façade
      });
    }
    const tot = (k2) => out.reduce((a, f) => a + f[k2], 0);
    const R = {
      facades: out,
      totals: {
        area: tot('area'), glazed: tot('glazed'), incident: tot('incident'),
        gainsAnnual: tot('gainsAnnual'), gainsSummer: tot('gainsSummer'), gainsWinter: tot('gainsWinter')
      },
      sky: S, opts: Object.assign({}, opts), ms: performance.now() - t0
    };
    for (const f of out) {
      f.shareSummer = R.totals.gainsSummer ? f.gainsSummer / R.totals.gainsSummer : 0;
      f.shareWinter = R.totals.gainsWinter ? f.gainsWinter / R.totals.gainsWinter : 0;
    }
    resCache = { key: k, R };
    return R;
  }

  // Date et heure légale d'une heure de l'année type
  function hourLabel(h, tz) {
    if (h < 0) return '—';
    const t = FS.climate.hourMid(h) - 1800e3; // début de l'heure (UTC)
    const off = FS.solar.tzOffsetHours(t, tz);
    const loc = new Date(t + off * 3600e3);
    const beg = loc.getUTCHours();
    return loc.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }) + ', ' + beg + '–' + (beg + 1) + ' h';
  }

  FS.results = { compute, hourLabel, WINTER, SUMMER };
})(window.FS);
