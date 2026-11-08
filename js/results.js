/* Résultats solaires par façade : irradiation annuelle, mensuelle, hiver / été, pic estival,
   apports à travers le vitrage, avec ou sans masques.

   Chaque segment de façade porte une grille de points (FS.masks). En chaque point, heure par heure :
     I = direct·v + max(0, isotrope·svf + circumsolaire·v + horizon·hb) + réfléchi
   v : soleil visible (1/0) d'après le profil d'horizon ; svf, hb : facteurs de ciel du point.
   La façade est la moyenne de ses points, pondérée par la surface des segments. */
(function (FS) {
  'use strict';
  const WINTER = [9, 10, 11, 0, 1, 2, 3]; // octobre → avril
  const SUMMER = [4, 5, 6, 7, 8];          // mai → septembre
  const isSummer = (m) => m >= 4 && m <= 8;

  let skyCache = { key: null, S: null };
  let maskCache = { key: null, M: null };
  let resCache = { key: null, R: null };

  function skyFor(climate, lat, lon, split) {
    const k = climate.cacheKey + '|' + lat.toFixed(4) + '|' + lon.toFixed(4) + '|' + split;
    if (skyCache.key !== k) {
      const S = FS.irradiance.sky(climate, lat, lon, split);
      // direction du soleil : case d'azimut (1°) et hauteur, pour la lecture des horizons
      S.azBin = new Uint16Array(S.n); S.alt = new Float32Array(S.n);
      for (let h = 0; h < S.n; h++) {
        S.azBin[h] = Math.floor(((Math.atan2(S.sx[h], S.sy[h]) / Math.PI * 180) + 360) % 360) % 360;
        S.alt[h] = Math.asin(Math.max(-1, Math.min(1, S.sz[h])));
      }
      skyCache = { key: k, S };
    }
    return skyCache.S;
  }

  function geomKey(D) {
    return JSON.stringify([D.H, D.model.facades.map((f) => f.segs.map((s) => [s.p0, s.p1, s.zMin])), D.nbs.map((n) => [n.id, n.height])]);
  }
  function masksFor(D) {
    const k = geomKey(D);
    if (maskCache.key !== k) maskCache = { key: k, M: FS.masks.compute(D) };
    return maskCache.M;
  }

  /* D : projet dérivé ; climate ; opts : { model, split, albedo, g, masks } */
  function compute(D, climate, opts) {
    const useMasks = opts.masks !== false;
    const gk = geomKey(D);
    const k = [climate.cacheKey, D.lat.toFixed(5), D.lon.toFixed(5), opts.model, opts.split, opts.albedo, opts.g, useMasks,
      JSON.stringify(D.model.facades.map((f) => f.wwr)), gk].join('|');
    if (resCache.key === k) return resCache.R;
    const t0 = performance.now();
    const S = skyFor(climate, D.lat, D.lon, opts.split);
    const M = masksFor(D); // utile aussi sans masques : grille de points pour la 3D et le VSC
    const tMask = M.ms;
    const n = S.n, rho = opts.albedo == null ? 0.2 : opts.albedo, iso = opts.model === 'isotrope';
    const beam = new Float32Array(n), circ = new Float32Array(n), dIso = new Float32Array(n), dHor = new Float32Array(n), refl = new Float32Array(n);
    const out = [];

    D.model.facades.forEach((f, fi) => {
      const MF = M.facades[fi];
      const sum = new Float32Array(n), sum0 = new Float32Array(n); // Σ I·A (W), avec et sans masques
      let A = 0;
      const cells = [];
      f.segs.forEach((s, si) => {
        const a = s.len * (D.H - s.zMin);
        if (a <= 0) return;
        // composantes du ciel sur le plan du segment
        for (let h = 0; h < n; h++) {
          const ghi = S.ghi[h];
          if (ghi <= 0) { beam[h] = circ[h] = dIso[h] = dHor[h] = refl[h] = 0; continue; }
          const cosT = S.sx[h] * s.n[0] + S.sy[h] * s.n[1];
          const c = cosT > 0 && S.up[h] ? cosT : 0;
          const F1 = iso ? 0 : S.F1[h], F2 = iso ? 0 : S.F2[h];
          beam[h] = S.dni[h] * c;
          circ[h] = S.dhi[h] * F1 * c / S.b[h];
          dIso[h] = S.dhi[h] * (1 - F1) * 0.5;
          dHor[h] = S.dhi[h] * F2;
          refl[h] = ghi * rho * 0.5;
        }
        const MS = MF.segs[si];
        const valid = MS.pts.filter((p) => !p.buried);
        const segHour = new Float32Array(n);
        const pv = MS.pts.map(() => ({ m: new Array(12).fill(0), peak: 0 }));
        MS.pts.forEach((pt, pi) => {
          if (pt.buried) { pv[pi] = null; return; }
          const hz = useMasks ? pt.hz : null;
          const svf = useMasks ? pt.svf : 1, hb = useMasks ? pt.hb : 1;
          const acc = pv[pi];
          for (let h = 0; h < n; h++) {
            if (S.ghi[h] <= 0) continue;
            const v = (!hz || S.alt[h] > hz[S.azBin[h]]) ? 1 : 0;
            const d = dIso[h] * svf + circ[h] * v + dHor[h] * hb;
            const I = beam[h] * v + (d > 0 ? d : 0) + refl[h];
            segHour[h] += I;
            acc.m[S.month[h]] += I / 1000;
            if (I > acc.peak && isSummer(S.month[h])) acc.peak = I;
          }
        });
        const nv = valid.length || 1;
        for (let h = 0; h < n; h++) {
          sum[h] += segHour[h] / nv * a;
          const d0 = dIso[h] + circ[h] + dHor[h];
          sum0[h] += (beam[h] + (d0 > 0 ? d0 : 0) + refl[h]) * a;
        }
        A += a;
        // valeurs par maille (pour la 3D)
        cells.push({
          g: MS.g, si,
          v: pv.map((acc) => acc ? {
            annual: acc.m.reduce((x, y) => x + y, 0),
            winter: WINTER.reduce((x, m) => x + acc.m[m], 0),
            summer: SUMMER.reduce((x, m) => x + acc.m[m], 0),
            peak: acc.peak
          } : null)
        });
      });

      const monthly = new Array(12).fill(0), monthly0 = new Array(12).fill(0);
      let peak = 0, peakH = -1, peakGain = 0, sunH = 0, peak0 = 0;
      const Ag = A * f.wwr;
      for (let h = 0; h < n; h++) {
        const I = A ? sum[h] / A : 0, I0 = A ? sum0[h] / A : 0;
        monthly[S.month[h]] += I / 1000;
        monthly0[S.month[h]] += I0 / 1000;
        if (isSummer(S.month[h])) {
          if (I > peak) { peak = I; peakH = h; }
          if (I0 > peak0) peak0 = I0;
          const gW = I * Ag * opts.g;
          if (gW > peakGain) peakGain = gW;
        }
      }
      // heures de soleil direct : au moins la moitié des points de la façade au soleil, direct > 120 W/m²
      for (let h = 0; h < n; h++) {
        if (!S.up[h] || S.dni[h] <= 120) continue;
        let lit = 0, tot = 0;
        f.segs.forEach((s, si) => {
          if (S.sx[h] * s.n[0] + S.sy[h] * s.n[1] <= 0) { tot += MF.segs[si].pts.length; return; }
          for (const pt of MF.segs[si].pts) {
            if (pt.buried) continue;
            tot++;
            if (!useMasks || S.alt[h] > pt.hz[S.azBin[h]]) lit++;
          }
        });
        if (tot && lit / tot >= 0.5) sunH++;
      }
      const annual = monthly.reduce((a, v) => a + v, 0);
      const annual0 = monthly0.reduce((a, v) => a + v, 0);
      const winter = WINTER.reduce((a, m) => a + monthly[m], 0);
      const summer = SUMMER.reduce((a, m) => a + monthly[m], 0);
      const summer0 = SUMMER.reduce((a, m) => a + monthly0[m], 0);
      // facteurs de ciel moyens de la façade
      let svf = 0, np = 0;
      for (const ms of MF.segs) for (const p of ms.pts) if (!p.buried) { svf += p.svf; np++; }
      out.push({
        id: f.id, az: f.az, label: f.label, pignon: f.pignon, area: A, glazed: Ag, wwr: f.wwr,
        monthly, monthly0, annual, annual0, winter, summer, summer0, peak, peak0, peakH, sunHours: sunH,
        maskLoss: annual0 ? 1 - annual / annual0 : 0, svf: np ? svf / np : 0,
        incident: annual * A,
        gainsAnnual: annual * Ag * opts.g,
        gainsSummer: summer * Ag * opts.g,
        gainsWinter: winter * Ag * opts.g,
        gainsMonthly: monthly.map((v) => v * Ag * opts.g),
        peakGain,
        cells,
        hourly: sum.map((v) => (A ? v / A : 0))
      });
    });
    const tot = (k2) => out.reduce((a, f) => a + f[k2], 0);
    const R = {
      facades: out, masks: useMasks, M,
      totals: {
        area: tot('area'), glazed: tot('glazed'), incident: tot('incident'),
        incident0: out.reduce((a, f) => a + f.annual0 * f.area, 0),
        gainsAnnual: tot('gainsAnnual'), gainsSummer: tot('gainsSummer'), gainsWinter: tot('gainsWinter')
      },
      sky: S, opts: Object.assign({}, opts), ms: performance.now() - t0, msMasks: tMask, nPts: M.nPts
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

  FS.results = { compute, hourLabel, masksFor, skyFor, WINTER, SUMMER };
})(window.FS);
