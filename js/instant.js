/* Éclairement des façades à un instant donné, et nombre d'heures au-dessus d'un seuil sur une
   journée, point par point (grille FS.masks), masques compris.

   Ciel clair : modèle ASHRAE (DNI = A·exp(−B/sin h), DHI = C·DNI, coefficients mensuels
   interpolés), comme dans Soleil Paris. C'est l'enveloppe haute d'une journée sans nuages ;
   un instant tiré de l'année type pourrait tomber sur un passage nuageux et ne rien dire.
   Composantes sur le mur : direct, diffus de Perez (ou isotrope) réduit par le ciel vu,
   bande d'horizon, réfléchi par le sol (albédo). */
(function (FS) {
  'use strict';
  const RAD = Math.PI / 180;

  // Coefficients ASHRAE (ciel clair) au 21 de chaque mois : A [W/m²], B [-], C [-]
  const ASHRAE = [
    [1230, 0.142, 0.058], [1215, 0.144, 0.060], [1186, 0.156, 0.071],
    [1136, 0.180, 0.097], [1104, 0.196, 0.121], [1088, 0.205, 0.134],
    [1085, 0.207, 0.136], [1107, 0.201, 0.122], [1151, 0.177, 0.092],
    [1192, 0.160, 0.073], [1221, 0.149, 0.063], [1233, 0.142, 0.057]
  ];
  const ASHRAE_DOY = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355];
  function ashraeCoefs(doy) {
    let i = ASHRAE_DOY.findIndex((d) => d > doy);
    if (i === -1) i = 12;
    const i0 = (i - 1 + 12) % 12, i1 = i % 12;
    let d0 = ASHRAE_DOY[i0], d1 = ASHRAE_DOY[i1];
    if (i === 0) d0 -= 365;
    if (i === 12) d1 += 365;
    const t = (doy - d0) / (d1 - d0);
    return ASHRAE[i0].map((v, k) => v + (ASHRAE[i1][k] - v) * t);
  }
  function clearSky(altDeg, doy) {
    if (altDeg <= 0) return { dni: 0, dhi: 0, ghi: 0 };
    const [A, B, C] = ashraeCoefs(doy);
    const s = Math.sin(altDeg * RAD);
    const dni = A * Math.exp(-B / Math.max(s, 0.02)), dhi = C * dni;
    return { dni, dhi, ghi: dni * s + dhi };
  }

  // Ciel à un instant : position du soleil et composantes
  function skyAt(utc, lat, lon, doy, opts) {
    const p = FS.solar.position(utc, lat, lon);
    const cs = clearSky(p.altitude, doy);
    const iso = opts.model === 'isotrope';
    const Z = Math.min(p.zenith, 89.5) * RAD;
    const f = iso || cs.dhi <= 0 ? [0, 0] : FS.irradiance.perezF(cs.dhi, cs.dni, Z, doy);
    const v = FS.solar.vector(p);
    return {
      up: p.altitude > 0, alt: p.altitude * RAD, azBin: Math.floor(((p.azimuth % 360) + 360) % 360),
      sx: v[0], sy: v[1], dni: cs.dni, dhi: cs.dhi, ghi: cs.ghi, F1: f[0], F2: f[1], b: Math.max(Math.cos(85 * RAD), Math.cos(Z))
    };
  }

  // Éclairement d'un point (W/m²)
  function pointI(sk, n, pt, rho, useMasks) {
    if (!sk.up || sk.ghi <= 0 || pt.buried) return 0;
    const cosT = sk.sx * n[0] + sk.sy * n[1];
    const a = cosT > 0 ? cosT : 0;
    const v = !useMasks || !pt.hz || sk.alt > pt.hz[sk.azBin] ? 1 : 0;
    const svf = useMasks ? pt.svf : 1, hb = useMasks ? pt.hb : 1;
    const d = sk.dhi * (1 - sk.F1) * 0.5 * svf + sk.dhi * sk.F1 * a / sk.b * v + sk.dhi * sk.F2 * hb;
    return sk.dni * a * v + (d > 0 ? d : 0) + sk.ghi * rho * 0.5;
  }

  /* Éclairement de chaque point à la date (jour de l'année) et à l'heure légale données.
     → { values: [facade][segment][point], sun: { altitude, azimuth } } */
  function instant(D, M, opts) {
    const utc = FS.solar.localToUTC(2026, opts.doy, opts.hour, opts.tz);
    const sk = skyAt(utc, D.lat, D.lon, opts.doy, opts);
    const rho = opts.albedo == null ? 0.2 : opts.albedo;
    const values = D.model.facades.map((f, fi) => f.segs.map((s, si) =>
      M.facades[fi].segs[si].pts.map((pt) => (pt.buried ? null : pointI(sk, s.n, pt, rho, opts.masks !== false)))));
    return { values, sky: sk };
  }

  /* Nombre d'heures où chaque point reçoit plus que le seuil (W/m²) sur la journée, par ciel clair,
     au pas de 10 min. → { values: [facade][segment][point] (h), dayLength (h) } */
  function hoursAbove(D, M, opts) {
    const thr = opts.threshold || 300, step = 1 / 6;
    const rho = opts.albedo == null ? 0.2 : opts.albedo, useMasks = opts.masks !== false;
    const values = D.model.facades.map((f, fi) => f.segs.map((s, si) => M.facades[fi].segs[si].pts.map((pt) => (pt.buried ? null : 0))));
    let dayLength = 0;
    for (let h = step / 2; h < 24; h += step) {
      const sk = skyAt(FS.solar.localToUTC(2026, opts.doy, h, opts.tz), D.lat, D.lon, opts.doy, opts);
      if (!sk.up) continue;
      dayLength += step;
      D.model.facades.forEach((f, fi) => f.segs.forEach((s, si) => {
        const pts = M.facades[fi].segs[si].pts, out = values[fi][si];
        for (let k = 0; k < pts.length; k++) if (out[k] != null && pointI(sk, s.n, pts[k], rho, useMasks) > thr) out[k] += step;
      }));
    }
    return { values, dayLength };
  }

  // Moyenne d'une façade (pondérée par la longueur des segments, points non recouverts)
  function facadeMean(D, values, fi) {
    let s = 0, w = 0;
    D.model.facades[fi].segs.forEach((seg, si) => {
      const v = values[fi][si].filter((x) => x != null);
      if (!v.length) return;
      s += seg.len * (H(D, seg)) * v.reduce((a, b) => a + b, 0) / v.length;
      w += seg.len * H(D, seg);
    });
    return w ? s / w : 0;
  }
  const H = (D, seg) => D.H - seg.zMin;

  FS.instant = { clearSky, skyAt, pointI, instant, hoursAbove, facadeMean };
})(window.FS);
