/* Masques : grille de points sur chaque segment de façade, profil d'horizon de chaque point.

   Les obstacles sont des prismes (voisins, et le bâtiment étudié lui-même pour l'auto-ombrage
   des cours et des retours). Pour chaque point, on lance un rayon horizontal par degré d'azimut
   dans le demi-espace devant le mur ; l'élévation d'obstruction vaut atan((h − z) / d) pour
   chaque arête de prisme rencontrée à la distance d. Le profil obtenu (360 valeurs) est exact
   au degré près pour des volumes extrudés à toit plat ; il sert ensuite :
   - au direct et au circumsolaire : soleil visible si sa hauteur dépasse l'horizon dans sa direction ;
   - au diffus isotrope : facteur de vue du ciel du point, rapporté à celui d'un mur dégagé (½) ;
   - à la bande d'horizon de Perez : part (pondérée par cos) des directions dégagées sous 6° ;
   - à la lumière naturelle (VSC, étape 5). */
(function (FS) {
  'use strict';
  const RAD = Math.PI / 180;
  const NB = 360;          // pas d'azimut : 1°
  const OFFSET = 0.1;      // m : points décollés du mur
  const MAX_POINTS = 4000; // au-delà, les mailles s'agrandissent

  /* Taille de maille commune aux calculs et à la 3D : ~2 m en largeur, ~3 m en hauteur (un étage). */
  function cellSize(D) {
    let n = 0;
    for (const f of D.model.facades) for (const s of f.segs) n += Math.max(1, s.len / 2) * Math.max(1, (D.H - s.zMin) / 3);
    const k = n > MAX_POINTS ? Math.sqrt(n / MAX_POINTS) : 1;
    return { dx: 2 * k, dz: 3 * k };
  }
  function grid(seg, H, cs) {
    const h = H - seg.zMin;
    const nc = Math.max(1, Math.round(seg.len / cs.dx)), nr = Math.max(1, Math.round(h / cs.dz));
    return { nc, nr, h };
  }
  // Points (centres de mailles) d'un segment : ligne par ligne, du bas vers le haut
  function points(seg, H, cs) {
    const g = grid(seg, H, cs), pts = [];
    for (let j = 0; j < g.nr; j++) {
      const z = seg.zMin + (j + 0.5) * g.h / g.nr;
      for (let i = 0; i < g.nc; i++) {
        const u = (i + 0.5) / g.nc;
        pts.push([seg.p0[0] + (seg.p1[0] - seg.p0[0]) * u + seg.n[0] * OFFSET, seg.p0[1] + (seg.p1[1] - seg.p0[1]) * u + seg.n[1] * OFFSET, z]);
      }
    }
    return { g, pts };
  }

  /* Obstacles : liste d'arêtes { ax, ay, bx, by, h, self, edge } avec boîte englobante. */
  function obstacles(D) {
    const E = [];
    const add = (xy, h, self) => {
      for (let i = 0; i < xy.length; i++) {
        const a = xy[i], b = xy[(i + 1) % xy.length];
        E.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], h, self, edge: i });
      }
    };
    add(D.xy, D.H, true);
    for (const nb of D.nbs) if (nb.height > 0) add(nb.xy, nb.height, false);
    return E;
  }

  /* Profil d'horizon du point p = [x, y, z] devant un mur de normale n ; skipEdge : arête du
     bâtiment étudié portant le point. → Float32Array(360) d'élévations (rad), −1 derrière le mur. */
  function horizon(p, n, E, skipEdge) {
    const hz = new Float32Array(NB);
    for (let k = 0; k < NB; k++) {
      const a = (k + 0.5) * RAD;
      hz[k] = Math.sin(a) * n[0] + Math.cos(a) * n[1] > 0 ? 0 : -1;
    }
    const px = p[0], py = p[1], z = p[2];
    for (const e of E) {
      if (e.h <= z + 0.01) continue;
      if (e.self && e.edge === skipEdge) continue;
      let ax = e.ax - px, ay = e.ay - py, bx = e.bx - px, by = e.by - py;
      let da = ax * n[0] + ay * n[1], db = bx * n[0] + by * n[1];
      if (da <= 0 && db <= 0) continue;
      // découpe par le plan du mur
      if (da < 0 || db < 0) {
        const t = da / (da - db);
        const cx = ax + (bx - ax) * t + n[0] * 1e-3, cy = ay + (by - ay) * t + n[1] * 1e-3;
        if (da < 0) { ax = cx; ay = cy; da = 1e-3; } else { bx = cx; by = cy; db = 1e-3; }
      }
      const ex = bx - ax, ey = by - ay;
      let azA = Math.atan2(ax, ay) / RAD, azB = Math.atan2(bx, by) / RAD;
      azA = (azA + 360) % 360; azB = (azB + 360) % 360;
      let span = azB - azA;
      if (span > 180) span -= 360; else if (span < -180) span += 360;
      const start = span >= 0 ? azA : azB, len = Math.abs(span);
      const k0 = Math.floor(start), k1 = Math.floor(start + len);
      const dh = e.h - z;
      for (let kk = k0; kk <= k1; kk++) {
        const k = ((kk % NB) + NB) % NB;
        if (hz[k] < 0) continue;
        const ang = (k + 0.5) * RAD, dx = Math.sin(ang), dy = Math.cos(ang);
        const den = dx * ey - dy * ex;
        let s;
        if (Math.abs(den) < 1e-12) s = 0;
        else s = (ax * dy - ay * dx) / den;
        if (s < 0) s = 0; else if (s > 1) s = 1; // arête plus courte qu'un degré : extrémité la plus proche
        const qx = ax + ex * s, qy = ay + ey * s;
        const d = Math.max(0.05, Math.hypot(qx, qy));
        const el = Math.atan(dh / d);
        if (el > hz[k]) hz[k] = el;
      }
    }
    return hz;
  }

  /* Grandeurs du ciel vu d'un point de mur (normale n) :
     svf : facteur de vue du ciel rapporté au mur dégagé (1 = dégagé) ;
     hb  : part dégagée de la bande d'horizon (élévation < 6°), pondérée par cos. */
  function skyFactors(hz, n) {
    let F = 0, hbn = 0, hbd = 0;
    const dphi = RAD;
    for (let k = 0; k < NB; k++) {
      if (hz[k] < 0) continue;
      const a = (k + 0.5) * RAD;
      const c = Math.sin(a) * n[0] + Math.cos(a) * n[1];
      if (c <= 0) continue;
      const al = hz[k];
      F += c * dphi * (Math.PI / 4 - (al / 2 + Math.sin(2 * al) / 4));
      hbd += c; if (al < 6 * RAD) hbn += c;
    }
    F /= Math.PI;
    return { svf: Math.min(1, F / 0.5), hb: hbd ? hbn / hbd : 1, F };
  }

  /* Calcul complet pour le projet : pour chaque segment, ses points, leurs horizons et facteurs.
     → { cs, facades: [{ id, segs: [{ g, pts: [{ p, hz, svf, hb, buried }] }] }], ms, nPts } */
  function compute(D) {
    const t0 = performance.now();
    const cs = cellSize(D);
    const E = obstacles(D);
    let nPts = 0;
    const facades = D.model.facades.map((f) => ({
      id: f.id,
      segs: f.segs.map((s) => {
        const { g, pts } = points(s, D.H, cs);
        return {
          g, pts: pts.map((p) => {
            nPts++;
            // point pris dans un voisin plus haut (recouvrement d'emprises OSM) : écarté
            const buried = D.nbs.some((nb) => nb.height > p[2] && p[0] >= nb.bbox[0] && p[0] <= nb.bbox[2] && p[1] >= nb.bbox[1] && p[1] <= nb.bbox[3] && FS.geo.inside(p, nb.xy));
            if (buried) return { p, buried: true, svf: 0, hb: 0, hz: null };
            const hz = horizon(p, s.n, E, s.edge);
            const sf = skyFactors(hz, s.n);
            return { p, hz, svf: sf.svf, hb: sf.hb, buried: false };
          })
        };
      })
    }));
    return { cs, facades, nPts, ms: performance.now() - t0 };
  }

  // Élévation de l'horizon (rad) dans la direction az (°)
  const at = (hz, az) => hz[Math.floor(((az % 360) + 360) % 360)];

  FS.masks = { cellSize, grid, points, obstacles, horizon, skyFactors, compute, at, NB };
})(window.FS);
