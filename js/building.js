/* Modèle géométrique : emprise du bâtiment étudié → façades numérotées.
   Repère local : x est, y nord, z haut (m), origine au centre de l'emprise.

   Règles :
   - chaque arête est découpée en tronçons de ~1 m ; un tronçon est « mitoyen » quand un
     voisin touche l'arête (à moins de 0,6 m). Seule la partie du mur au-dessus du voisin
     (héberge) reste exposée ; un mur entièrement couvert disparaît ;
   - les tronçons consécutifs de même orientation (± 10°) et de même pied exposé forment
     une façade ; les tronçons de moins de 1 m sont absorbés par la façade voisine ;
   - numérotation dans le sens horaire, en partant de la façade la plus proche du nord. */
(function (FS) {
  'use strict';
  const G = FS.geo, DEG = FS.DEG, RAD = FS.RAD;

  const ADJ_DIST = 0.6;   // m
  const ANG_TOL = 10;     // °
  const MIN_LEN = 1.0;    // m : tronçon absorbé sans condition d'angle
  const MIN_FACADE = 3.0; // m : retour rattaché à la façade voisine

  const azOf = (n) => ((Math.atan2(n[0], n[1]) * DEG) + 360) % 360;
  const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  // Hauteur du voisin accolé au point p (0 si aucun). Pour tester « accolé », on regarde
  // un point décalé de 0,3 m vers l'extérieur et la distance au contour du voisin.
  // On regarde deux points pris sur la normale extérieure, à 0,3 m et à ADJ_DIST : si l'un tombe
  // dans un voisin, le mur lui est accolé (le second tolère un petit jour dû à l'imprécision du
  // cadastre). Un voisin situé seulement dans le prolongement du mur n'est pas compté.
  function adjacentHeight(p, n, neighbors) {
    const q1 = [p[0] + n[0] * 0.3, p[1] + n[1] * 0.3];
    const q2 = [p[0] + n[0] * ADJ_DIST, p[1] + n[1] * ADJ_DIST];
    let h = 0;
    for (const nb of neighbors) {
      const bb = nb.bbox;
      if (q2[0] < bb[0] - 1 || q2[0] > bb[2] + 1 || q2[1] < bb[1] - 1 || q2[1] > bb[3] + 1) continue;
      if (nb.height > h && (G.inside(q1, nb.xy) || G.inside(q2, nb.xy))) h = nb.height;
    }
    return h;
  }

  function bbox(xy) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of xy) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }
    return b;
  }

  /* target : { xy (contour extérieur, sens trigonométrique), holes (cours, sens horaire), height },
     neighbors : [{ xy, height }] → { facades: [...], perimeter, footprintArea }
     Les façades du contour sont numérotées d'abord, puis celles de chaque cour (f.cour = 1, 2…).
     Les arêtes sont indexées globalement (contour puis cours) : s.edge sert à l'auto-masque. */
  function facades(target, neighbors) {
    const H = target.height;
    const nbs = neighbors.map((n) => ({ xy: n.xy, height: n.height, bbox: n.bbox || bbox(n.xy) }));
    const holes = target.holes || [];
    let off = 0, perimeter = 0, id = 0;
    const all = [];
    [target.xy].concat(holes).forEach((ring, ri) => {
      const r = ringFacades(ring, off, H, nbs, ri > 0);
      off += ring.length; perimeter += r.perimeter;
      r.fac.forEach((f) => { f.id = ++id; f.cour = ri > 0 ? ri : 0; all.push(f); });
    });
    const area = Math.abs(G.area(target.xy)) - holes.reduce((a, h) => a + Math.abs(G.area(h)), 0);
    return { facades: all, perimeter, footprintArea: area, height: H, courts: holes.length };
  }

  function ringFacades(ring, edgeOffset, H, nbs, isHole) {
    const n = ring.length;

    // 1. Sous-segments homogènes (même hauteur de voisin accolé)
    const subs = [];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy);
      if (L < 0.05) continue;
      const nrm = [dy / L, -dx / L];
      const k = Math.max(1, Math.round(L / 1.0));
      const zAt = (t) => Math.min(H, adjacentHeight([a[0] + dx * t, a[1] + dy * t], nrm, nbs));
      let cur = null, tPrev = 0;
      for (let j = 0; j < k; j++) {
        const tm = (j + 0.5) / k;
        const zMin = zAt(tm);
        if (cur && Math.abs(cur.zMin - zMin) < 0.5) { tPrev = tm; continue; }
        if (cur) {
          // limite précise entre deux états, par dichotomie (à ~1 cm près)
          let lo = tPrev, hi = tm;
          for (let it = 0; it < 12 && (hi - lo) * L > 0.01; it++) {
            const mid = (lo + hi) / 2;
            if (Math.abs(zAt(mid) - cur.zMin) < 0.5) lo = mid; else hi = mid;
          }
          cur.t1 = (lo + hi) / 2;
        }
        cur = { edge: edgeOffset + i, t0: cur ? cur.t1 : 0, t1: 1, zMin, n: nrm, az: azOf(nrm), a, dx, dy };
        subs.push(cur);
        tPrev = tm;
      }
    }
    for (const s of subs) {
      s.p0 = [s.a[0] + s.dx * s.t0, s.a[1] + s.dy * s.t0];
      s.p1 = [s.a[0] + s.dx * s.t1, s.a[1] + s.dy * s.t1];
      s.len = Math.hypot(s.p1[0] - s.p0[0], s.p1[1] - s.p0[1]);
      s.exposed = H - s.zMin > 0.1;
    }

    // 2. Regroupement en façades
    const groups = [];
    const meanAz = (g) => {
      let sx = 0, sy = 0;
      for (const s of g.segs) { sx += s.len * Math.sin(s.az * RAD); sy += s.len * Math.cos(s.az * RAD); }
      return ((Math.atan2(sx, sy) * DEG) + 360) % 360;
    };
    const compatible = (g, s) => g.exposed === s.exposed && Math.abs(g.zMin - s.zMin) < 0.5 &&
      (angDiff(meanAz(g), s.az) <= ANG_TOL || s.len < MIN_LEN);
    for (const s of subs) {
      const g = groups[groups.length - 1];
      if (g && compatible(g, s)) g.segs.push(s);
      else groups.push({ segs: [s], zMin: s.zMin, exposed: s.exposed });
    }
    // fermeture de l'anneau
    if (groups.length > 1) {
      const f = groups[0], l = groups[groups.length - 1];
      if (f.exposed === l.exposed && Math.abs(f.zMin - l.zMin) < 0.5 && angDiff(meanAz(f), meanAz(l)) <= ANG_TOL) {
        f.segs = l.segs.concat(f.segs); groups.pop();
      }
    }
    // un groupe très court (< 1 m) en tête de liste, absorbé par le précédent
    for (let i = groups.length - 1; i >= 0 && groups.length > 1; i--) {
      const g = groups[i];
      const L = g.segs.reduce((a, s) => a + s.len, 0);
      if (L < MIN_LEN) {
        const prev = groups[(i - 1 + groups.length) % groups.length];
        if (prev.exposed === g.exposed) { prev.segs = prev.segs.concat(g.segs); groups.splice(i, 1); }
      }
    }

    // retours courts (< 3 m) rattachés à la plus longue façade voisine de même nature ;
    // chaque segment garde sa propre normale pour les calculs.
    const glen = (g) => g.segs.reduce((a, s) => a + s.len, 0);
    for (;;) {
      if (groups.length < 2) break;
      let iMin = -1, lMin = MIN_FACADE;
      groups.forEach((g, i) => { const L = glen(g); if (!g.keep && L < lMin) { lMin = L; iMin = i; } });
      if (iMin < 0) break;
      const g = groups[iMin], N = groups.length;
      const prev = groups[(iMin - 1 + N) % N], next = groups[(iMin + 1) % N];
      const ok = (h) => h !== g && h.exposed === g.exposed && Math.abs(h.zMin - g.zMin) < 0.5;
      let host = null;
      if (ok(prev) && ok(next)) host = glen(prev) >= glen(next) ? prev : next;
      else host = ok(prev) ? prev : ok(next) ? next : null;
      if (!host) { g.keep = true; continue; } // isolé entre deux natures différentes : on le garde
      if (host === prev) prev.segs = prev.segs.concat(g.segs);
      else next.segs = g.segs.concat(next.segs);
      groups.splice(iMin, 1);
    }

    // après rattachement des retours, deux façades voisines de même orientation n'en font qu'une
    const mainAz = (g) => {
      const lg = g.segs.reduce((a, s) => (s.len > a.len ? s : a), g.segs[0]);
      return meanAz({ segs: g.segs.filter((s) => angDiff(s.az, lg.az) <= ANG_TOL) });
    };
    for (let i = 0; groups.length > 1 && i < groups.length;) {
      const g = groups[i], h = groups[(i + 1) % groups.length];
      if (g.exposed === h.exposed && Math.abs(g.zMin - h.zMin) < 0.5 && angDiff(mainAz(g), mainAz(h)) <= ANG_TOL) {
        g.segs = g.segs.concat(h.segs);
        groups.splice((i + 1) % groups.length, 1);
        if (i >= groups.length) i = 0;
      } else i++;
    }

    // 3. Façades exposées, numérotation horaire depuis le nord
    let fac = groups.filter((g) => g.exposed).map((g) => {
      // orientation : moyenne des segments alignés sur le plus long (les retours rattachés n'y comptent pas)
      const lg = g.segs.reduce((a, s) => (s.len > a.len ? s : a), g.segs[0]);
      const az = meanAz({ segs: g.segs.filter((s) => angDiff(s.az, lg.az) <= ANG_TOL) });
      const length = g.segs.reduce((a, s) => a + s.len, 0);
      const area = g.segs.reduce((a, s) => a + s.len * (H - s.zMin), 0);
      const zMin = g.zMin;
      // milieu (pour les étiquettes) : milieu du plus long segment
      const longest = g.segs.reduce((a, s) => (s.len > a.len ? s : a), g.segs[0]);
      const mid = [(longest.p0[0] + longest.p1[0]) / 2, (longest.p0[1] + longest.p1[1]) / 2];
      return {
        az, label: FS.orientLabel(az), length, area, zMin, pignon: zMin > 0.1,
        mid, n: [Math.sin(az * RAD), Math.cos(az * RAD)],
        segs: g.segs.map((s) => ({ p0: s.p0, p1: s.p1, n: s.n, len: s.len, zMin: s.zMin, edge: s.edge }))
      };
    });
    if (fac.length) {
      // contour : anneau trigonométrique → sens horaire ; cour : anneau déjà parcouru en sens horaire
      if (!isHole) fac.reverse();
      let k = 0, best = Infinity;
      fac.forEach((f, i) => { const d = angDiff(f.az, 0) - f.length * 1e-4; if (d < best) { best = d; k = i; } });
      fac = fac.slice(k).concat(fac.slice(0, k));
    }
    const perimeter = subs.reduce((a, s) => a + s.len, 0);
    return { fac, perimeter };
  }

  /* Fenêtres théoriques d'un segment de façade, au rythme parisien : une travée tous les ~2,7 m,
     des portes-fenêtres plus hautes que larges, une rangée par étage, centrées dans la travée.
     La surface vitrée dessinée vaut la fraction vitrée demandée (sauf plafonnement : vitrage ≤ 92 %
     de la travée et de l'étage). → [{ u0, u1, z0, z1 }] (u : abscisse relative sur le segment). */
  function windows(len, hTot, zMin, floorH, wwr) {
    if (!(wwr > 0.005) || len < 1.2 || hTot < 1.5) return [];
    const rows = Math.max(1, Math.round(hTot / floorH)), fh = hTot / rows;
    let nb = Math.max(1, Math.round(len / 2.7)), ww = 0, hw = 0;
    for (;;) {
      const bay = len / nb, A = wwr * bay * fh;
      hw = Math.min(0.72 * fh, 2.4); ww = A / hw;
      if (ww > 0.8 * bay) { hw = Math.min(0.92 * fh, A / (0.8 * bay)); ww = Math.min(A / hw, 0.92 * bay); }
      if (ww < 0.6 && nb > 1) { nb--; continue; }
      break;
    }
    const out = [];
    for (let r = 0; r < rows; r++) {
      const z0 = zMin + r * fh + (fh - hw) * 0.6, z1 = Math.min(z0 + hw, zMin + (r + 1) * fh - 0.02);
      for (let b = 0; b < nb; b++) {
        const c = (b + 0.5) / nb, d = ww / 2 / len;
        out.push({ u0: c - d, u1: c + d, z0, z1 });
      }
    }
    return out;
  }

  FS.building = { facades, bbox, azOf, angDiff, windows };
})(window.FS);
