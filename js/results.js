/* Résultats solaires par façade : irradiation par saison (moyenne par jour), mensuelle, pic d'été,
   apports à travers le vitrage, avec ou sans masques.

   Chaque segment de façade porte une grille de points (FS.masks). En chaque point, heure par heure :
     I = direct·v + max(0, isotrope·svf + circumsolaire·v + horizon·hb) + réfléchi
   v : soleil visible (1/0) d'après le profil d'horizon ; svf, hb : facteurs de ciel du point.
   La façade est la moyenne de ses points, pondérée par la surface des segments.

   Sur le vitrage, en retrait de d dans son tableau :
     I_v = direct·v·f_s + max(0, isotrope·svf·F_d + circumsolaire·v·f_s + horizon·hb·F_d) + réfléchi·F_d
   f_s : part ensoleillée du vitrage (linteau, tableau latéral) ; F_d : part du diffus qui l'atteint.
   La fraction vitrée de chaque maille dépend de son niveau (RDC, étages courants, dernier étage).

   Saisons météorologiques : printemps (mars–mai, 92 j), été (juin–août, 92 j), automne
   (sept.–nov., 91 j), hiver (déc.–févr., 90 j). Les moyennes par jour comptent les nuits. */
(function (FS) {
  'use strict';
  const SEASONS = { printemps: [2, 3, 4], ete: [5, 6, 7], automne: [8, 9, 10], hiver: [11, 0, 1] };
  const DAYS = { annee: 365, printemps: 92, ete: 92, automne: 91, hiver: 90 };
  const SEASON_LABEL = { annee: 'Année', printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' };
  const WINTER = SEASONS.hiver, SUMMER = SEASONS.ete;
  const isSummer = (m) => m >= 5 && m <= 7;

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

  // Moyennes par jour (kWh/m²·jour) à partir des cumuls mensuels (kWh/m²)
  function daily(monthly) {
    const o = { annee: monthly.reduce((a, v) => a + v, 0) / DAYS.annee };
    for (const k in SEASONS) o[k] = SEASONS[k].reduce((a, m) => a + monthly[m], 0) / DAYS[k];
    return o;
  }

  /* D : projet dérivé ; climate ; opts : { model, split, albedo, g, masks, reveal } */
  function compute(D, climate, opts) {
    const useMasks = opts.masks !== false;
    const gk = geomKey(D);
    const k = [climate.cacheKey, D.lat.toFixed(5), D.lon.toFixed(5), opts.model, opts.split, opts.albedo, opts.g, useMasks, opts.reveal, D.floorH,
      JSON.stringify(D.model.facades.map((f) => [f.wwrSet, f.ignored])), gk].join('|');
    if (resCache.key === k) return resCache.R;
    const t0 = performance.now();
    const S = skyFor(climate, D.lat, D.lon, opts.split);
    const M = masksFor(D); // utile aussi sans masques : grille de points pour la 3D et le VSC
    const tMask = M.ms;
    const n = S.n, rho = opts.albedo == null ? 0.2 : opts.albedo, iso = opts.model === 'isotrope';
    const dRev = opts.reveal || 0;
    const beam = new Float32Array(n), circ = new Float32Array(n), dIso = new Float32Array(n), dHor = new Float32Array(n), refl = new Float32Array(n);
    const fsun = new Float32Array(n);
    const out = [];

    D.model.facades.forEach((f, fi) => {
      if (f.ignored) return;
      const MF = M.facades[fi];
      const sum = new Float32Array(n), sum0 = new Float32Array(n); // Σ I·A (W), avec et sans masques
      const glass = new Float32Array(n);                            // Σ I_v·A_vitrée (W)
      let A = 0, Agc = 0;
      const cells = [];
      f.segs.forEach((s, si) => {
        const a = s.len * (D.H - s.zMin);
        if (a <= 0) return;
        // fenêtres du segment : taille moyenne (pour l'effet du tableau) et fraction vitrée par niveau
        const lv = FS.building.levels(D.H, D.floorH, s.zMin, f.wwrSet);
        const wins = FS.building.windowsRows(s.len, lv);
        let wa = 0, ww = 0, hw = 0;
        for (const r of wins) { const ar = r.ww * r.hw; wa += ar; ww += r.ww * ar; hw += r.hw * ar; }
        ww = wa ? ww / wa : 1; hw = wa ? hw / wa : 1;
        const Fd = wa ? FS.building.revealDiffuse(dRev, ww, hw) : 1;
        const wwrAt = (z) => { for (const l of lv) if (z >= l.z0 - 1e-6 && z <= l.z1 + 1e-6) return l.wwr; return 0; };
        // composantes du ciel sur le plan du segment
        for (let h = 0; h < n; h++) {
          const ghi = S.ghi[h];
          if (ghi <= 0) { beam[h] = circ[h] = dIso[h] = dHor[h] = refl[h] = fsun[h] = 0; continue; }
          const cosT = S.sx[h] * s.n[0] + S.sy[h] * s.n[1];
          const c = cosT > 0 && S.up[h] ? cosT : 0;
          const F1 = iso ? 0 : S.F1[h], F2 = iso ? 0 : S.F2[h];
          beam[h] = S.dni[h] * c;
          circ[h] = S.dhi[h] * F1 * c / S.b[h];
          dIso[h] = S.dhi[h] * (1 - F1) * 0.5;
          dHor[h] = S.dhi[h] * F2;
          refl[h] = ghi * rho * 0.5;
          fsun[h] = c > 0 ? FS.building.revealSun(dRev, ww, hw, S.sx[h], S.sy[h], S.sz[h], s.n[0], s.n[1]) : 0;
        }
        const MS = MF.segs[si];
        const valid = MS.pts.filter((p) => !p.buried);
        const cellA = s.len / MS.g.nc * (MS.g.h / MS.g.nr);
        const segHour = new Float32Array(n);
        const pv = MS.pts.map(() => ({ m: new Array(12).fill(0), peak: 0 }));
        MS.pts.forEach((pt, pi) => {
          if (pt.buried) { pv[pi] = null; return; }
          const hz = useMasks ? pt.hz : null;
          const svf = useMasks ? pt.svf : 1, hb = useMasks ? pt.hb : 1;
          const ag = wwrAt(pt.p[2]) * cellA;
          Agc += ag;
          const acc = pv[pi];
          for (let h = 0; h < n; h++) {
            if (S.ghi[h] <= 0) continue;
            const v = (!hz || S.alt[h] > hz[S.azBin[h]]) ? 1 : 0;
            const d = dIso[h] * svf + circ[h] * v + dHor[h] * hb;
            const I = beam[h] * v + (d > 0 ? d : 0) + refl[h];
            segHour[h] += I;
            acc.m[S.month[h]] += I / 1000;
            if (I > acc.peak && isSummer(S.month[h])) acc.peak = I;
            if (ag > 0) {
              const dv = dIso[h] * svf * Fd + circ[h] * v * fsun[h] + dHor[h] * hb * Fd;
              glass[h] += (beam[h] * v * fsun[h] + (dv > 0 ? dv : 0) + refl[h] * Fd) * ag;
            }
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
          v: pv.map((acc, pi) => acc ? Object.assign({
            annual: acc.m.reduce((x, y) => x + y, 0),
            winter: WINTER.reduce((x, m) => x + acc.m[m], 0),
            summer: SUMMER.reduce((x, m) => x + acc.m[m], 0),
            peak: acc.peak,
            vsc: MS.pts[pi].vsc
          }, { d: daily(acc.m) }) : null)
        });
      });

      // les mailles approchent la surface vitrée : on recale sur la surface exacte des niveaux
      const Ag = f.glazed, kg = Agc > 0 ? Ag / Agc : 0;
      const monthly = new Array(12).fill(0), monthly0 = new Array(12).fill(0), monthlyG = new Array(12).fill(0);
      let peak = 0, peakH = -1, peakGain = 0, sunH = 0, peak0 = 0;
      const glassHourly = new Float32Array(n);
      for (let h = 0; h < n; h++) {
        const I = A ? sum[h] / A : 0, I0 = A ? sum0[h] / A : 0;
        const G = glass[h] * kg;                         // W à travers les baies (avant g)
        glassHourly[h] = Ag > 0 ? G / Ag : 0;
        monthly[S.month[h]] += I / 1000;
        monthly0[S.month[h]] += I0 / 1000;
        monthlyG[S.month[h]] += G / 1000;
        if (isSummer(S.month[h])) {
          if (I > peak) { peak = I; peakH = h; }
          if (I0 > peak0) peak0 = I0;
          const gW = G * opts.g;
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
      const sum12 = (a, ix) => ix.reduce((s2, m) => s2 + a[m], 0);
      // facteurs de ciel moyens de la façade
      let svf = 0, vsc = 0, np = 0;
      for (const ms of MF.segs) for (const p of ms.pts) if (!p.buried) { svf += p.svf; vsc += p.vsc; np++; }
      out.push({
        id: f.id, az: f.az, label: f.label, pignon: f.pignon, cour: f.cour, area: A, glazed: Ag, wwr: f.wwr,
        monthly, monthly0, annual, annual0, winter, summer, summer0, peak, peak0, peakH, sunHours: sunH,
        daily: daily(monthly), daily0: daily(monthly0),
        monthlyDaily: monthly.map((v, m) => v / FS.climate.MDAYS[m]), monthlyDaily0: monthly0.map((v, m) => v / FS.climate.MDAYS[m]),
        maskLoss: annual0 ? 1 - annual / annual0 : 0, svf: np ? svf / np : 0, vsc: np ? vsc / np : 0,
        incident: annual * A,
        // apports par les vitrages (g appliqué) ; le tableau et les masques sont compris
        gainsAnnual: monthlyG.reduce((a, v) => a + v, 0) * opts.g,
        gainsSummer: sum12(monthlyG, SUMMER) * opts.g,
        gainsWinter: sum12(monthlyG, WINTER) * opts.g,
        gainsMonthly: monthlyG.map((v) => v * opts.g),
        revealLoss: 0,
        peakGain,
        cells,
        hourly: sum.map((v) => (A ? v / A : 0)),
        glassHourly
      });
    });
    const tot = (k2) => out.reduce((a, f) => a + f[k2], 0);
    const R = {
      facades: out, masks: useMasks, M, reveal: dRev,
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

  /* Façades de référence : murs verticaux dégagés de 8 orientations, sur le climat chargé.
     → [{ az, label, daily (kWh/m²·jour par saison), peak (W/m², été), meanSummer (W/m², moyenne
          des heures de jour en été), monthlyDaily }] */
  let refCache = { key: null, v: null };
  function references(climate, lat, lon, opts) {
    const k = climate.cacheKey + '|' + lat.toFixed(2) + lon.toFixed(2) + '|' + opts.split + opts.model + opts.albedo;
    if (refCache.key === k) return refCache.v;
    const S = skyFor(climate, lat, lon, opts.split);
    const v = [0, 45, 90, 135, 180, 225, 270, 315].map((az) => {
      const I = FS.irradiance.plane(S, Math.sin(az * Math.PI / 180), Math.cos(az * Math.PI / 180), opts);
      const monthly = new Array(12).fill(0);
      let peak = 0, sumDay = 0, nDay = 0;
      for (let h = 0; h < S.n; h++) {
        monthly[S.month[h]] += I[h] / 1000;
        if (isSummer(S.month[h])) {
          if (I[h] > peak) peak = I[h];
          if (S.up[h]) { sumDay += I[h]; nDay++; }
        }
      }
      return { az, label: FS.orientLabel(az), daily: daily(monthly), peak, meanSummer: nDay ? sumDay / nDay : 0, monthlyDaily: monthly.map((x, m) => x / FS.climate.MDAYS[m]) };
    });
    refCache = { key: k, v };
    return v;
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

  FS.results = { compute, hourLabel, masksFor, skyFor, references, daily, WINTER, SUMMER, SEASONS, DAYS, SEASON_LABEL };
})(window.FS);
