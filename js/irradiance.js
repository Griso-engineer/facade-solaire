/* Rayonnement sur plan vertical, heure par heure sur l'année type.

   G = direct + diffus du ciel + réfléchi par le sol
   - direct     : DNI · max(0, cos θ)
   - diffus     : modèle de Perez (1990, coefficients « allsitescomposite1990 ») :
                  DHI · [ (1 − F1)·(1 + cos β)/2 + F1·a/b + F2·sin β ], β = 90°
                  soit, pour un mur : isotrope DHI(1 − F1)/2, circumsolaire DHI·F1·a/b,
                  bande d'horizon DHI·F2. Option : ciel isotrope (F1 = F2 = 0).
   - réfléchi   : GHI · ρ · (1 − cos β)/2 = GHI · ρ / 2 (albédo ρ, 0,2 par défaut).

   Les grandeurs qui ne dépendent que du ciel (position du soleil, DNI, F1, F2) sont calculées
   une fois par heure ; chaque plan n'ajoute qu'un produit scalaire. Les composantes sont gardées
   séparément pour appliquer ensuite les masques (direct et circumsolaire : visibilité du soleil ;
   isotrope : part de ciel visible ; horizon : bande basse). */
(function (FS) {
  'use strict';
  const RAD = Math.PI / 180;

  // Bornes des classes de clarté ε et coefficients de Perez et al. (1990)
  const EPS = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2];
  const F11 = [-0.0083117, 0.1299457, 0.3296958, 0.5682053, 0.873028, 1.1326077, 1.0601591, 0.677747];
  const F12 = [0.5877285, 0.6825954, 0.4868735, 0.1874525, -0.3920403, -1.2367284, -1.5999137, -0.3272588];
  const F13 = [-0.0620636, -0.1513725, -0.2210958, -0.295129, -0.3616149, -0.4118494, -0.3589221, -0.2504286];
  const F21 = [-0.0596012, -0.0189325, 0.055414, 0.1088631, 0.2255647, 0.2877813, 0.2642124, 0.1561313];
  const F22 = [0.0721249, 0.065965, -0.0639588, -0.1519229, -0.4620442, -0.8230357, -1.127234, -1.3765031];
  const F23 = [-0.0220216, -0.0288748, -0.0260542, -0.0139754, 0.0012448, 0.0558651, 0.1310694, 0.2506212];

  // Coefficients F1, F2 pour un ciel donné (Z : angle zénithal en radians)
  function perezF(dhi, dni, Z, doy) {
    if (dhi <= 0) return [0, 0];
    const k = 1.041;
    const eps = ((dhi + dni) / dhi + k * Z * Z * Z) / (1 + k * Z * Z * Z);
    const Zd = Z / RAD;
    const am = 1 / (Math.cos(Z) + 0.50572 * Math.pow(Math.max(96.07995 - Zd, 0.01), -1.6364)); // Kasten & Young
    const E0 = 1367 * (1 + 0.033 * Math.cos(2 * Math.PI * doy / 365));
    const delta = dhi * am / E0;
    let i = 0;
    while (i < 7 && eps >= EPS[i]) i++;
    const F1 = Math.max(0, F11[i] + F12[i] * delta + F13[i] * Z);
    const F2 = F21[i] + F22[i] * delta + F23[i] * Z;
    return [F1, F2];
  }

  /* Ciel heure par heure. climate : { ghi, dhi } (8760), lieu : lat, lon.
     → { n, sx, sy, sz (vecteur soleil), dni, dhi, ghi, F1, F2, b, up } */
  // Décomposition d'Erbs, Klein et Duffie (1982) : fraction diffuse horaire kd selon l'indice de clarté kt
  function erbsKd(kt) {
    if (kt <= 0.22) return 1 - 0.09 * kt;
    if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt * kt - 16.638 * kt * kt * kt + 12.336 * kt * kt * kt * kt;
    return 0.165;
  }

  /* split : 'erbs' (défaut) — diffus recalculé à partir du global par le modèle d'Erbs ;
             'era5' — diffus fourni par la réanalyse (connu pour être sous-estimé). */
  function sky(climate, lat, lon, split) {
    split = split || 'erbs';
    const n = climate.ghi.length;
    const o = {
      n, sx: new Float32Array(n), sy: new Float32Array(n), sz: new Float32Array(n),
      dni: new Float32Array(n), dhi: new Float32Array(n), ghi: new Float32Array(n),
      F1: new Float32Array(n), F2: new Float32Array(n), b: new Float32Array(n), up: new Uint8Array(n),
      temp: climate.temp, month: new Uint8Array(n)
    };
    const cos85 = Math.cos(85 * RAD);
    for (let h = 0; h < n; h++) {
      const t = FS.climate.hourMid(h);
      const p = FS.solar.position(t, lat, lon);
      const v = FS.solar.vector(p);
      o.sx[h] = v[0]; o.sy[h] = v[1]; o.sz[h] = v[2];
      o.month[h] = FS.climate.monthOfHour(h);
      const ghi = climate.ghi[h];
      let dhi = Math.min(climate.dhi[h], ghi), dni = 0;
      const doy = Math.floor(h / 24) + 1;
      if (p.altitude > 0.5 && ghi > 0) {
        const sinh = Math.max(Math.sin(p.altitude * RAD), 0.05);
        if (split !== 'era5') {
          const E0 = 1367 * (1 + 0.033 * Math.cos(2 * Math.PI * doy / 365));
          const kt = Math.min(1, ghi / (E0 * sinh));
          dhi = ghi * erbsKd(kt);
        }
        dni = (ghi - dhi) / sinh;
        const cap = 1100;
        if (dni > cap) { dhi = ghi - cap * sinh; dni = cap; }
        o.up[h] = 1;
      } else {
        dhi = ghi; // soleil sous l'horizon au milieu de l'heure : tout en diffus
      }
      o.ghi[h] = ghi; o.dhi[h] = dhi; o.dni[h] = dni;
      const Z = Math.min(p.zenith, 89.5) * RAD;
      const f = perezF(dhi, dni, Z, doy);
      o.F1[h] = f[0]; o.F2[h] = f[1];
      o.b[h] = Math.max(cos85, Math.cos(Z));
    }
    return o;
  }

  /* Irradiance horaire (W/m²) sur un plan vertical de normale horizontale (nx, ny),
     sans masque. opts : { model: 'perez' | 'isotrope', albedo }.
     → Float32Array des totaux, plus les composantes si opts.components. */
  function plane(S, nx, ny, opts) {
    const n = S.n, rho = opts.albedo == null ? 0.2 : opts.albedo, iso = opts.model === 'isotrope';
    const tot = new Float32Array(n);
    const comp = opts.components ? { beam: new Float32Array(n), circ: new Float32Array(n), iso: new Float32Array(n), hor: new Float32Array(n), refl: new Float32Array(n) } : null;
    for (let h = 0; h < n; h++) {
      const ghi = S.ghi[h];
      if (ghi <= 0) continue;
      const cosT = S.sx[h] * nx + S.sy[h] * ny;
      const a = cosT > 0 && S.up[h] ? cosT : 0;
      const F1 = iso ? 0 : S.F1[h], F2 = iso ? 0 : S.F2[h];
      const beam = S.dni[h] * a;
      const dIso = S.dhi[h] * (1 - F1) * 0.5;
      const dCirc = S.dhi[h] * F1 * a / S.b[h];
      const dHor = S.dhi[h] * F2;
      const refl = ghi * rho * 0.5;
      // le diffus total de Perez reste positif
      const diff = Math.max(0, dIso + dCirc + dHor);
      tot[h] = beam + diff + refl;
      if (comp) { comp.beam[h] = beam; comp.circ[h] = dCirc; comp.iso[h] = dIso; comp.hor[h] = diff - dIso - dCirc; comp.refl[h] = refl; }
    }
    if (comp) tot.comp = comp;
    return tot;
  }

  // Une heure isolée (pour les tests) : soleil (alt, az en °), DNI, DHI, GHI, normale du mur (azimut °)
  function single(altDeg, azDeg, dni, dhi, ghi, wallAz, opts) {
    const p = { altitude: altDeg, azimuth: azDeg };
    const v = FS.solar.vector(p);
    const Z = (90 - altDeg) * RAD;
    const f = opts.model === 'isotrope' ? [0, 0] : perezF(dhi, dni, Z, opts.doy || 172);
    const S = {
      n: 1, sx: [v[0]], sy: [v[1]], sz: [v[2]], dni: [dni], dhi: [dhi], ghi: [ghi], F1: [f[0]], F2: [f[1]],
      b: [Math.max(Math.cos(85 * RAD), Math.cos(Z))], up: [altDeg > 0 ? 1 : 0]
    };
    const n = [Math.sin(wallAz * RAD), Math.cos(wallAz * RAD)];
    return plane(S, n[0], n[1], Object.assign({ components: true }, opts));
  }

  FS.irradiance = { sky, plane, perezF, single, erbsKd };
})(window.FS);
