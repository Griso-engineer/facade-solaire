/* Vent et géométrie du site : distance au premier obstacle devant chaque façade, rapport des côtés,
   exposition des façades, et points de vigilance pour le confort piéton.

   Confort piéton : analyse qualitative à partir de règles connues de l'aéraulique urbaine (effet de
   coin, rabattement au pied des façades hautes au vent, effet Venturi dans les passages alignés sur
   les vents dominants, pilotis et passages sous bâtiment). Trois niveaux : faible, modéré, élevé.
   Une quantification (critères de Lawson, NEN 8100) demande des essais en soufflerie ou une CFD. */
(function (FS) {
  'use strict';
  const RAD = Math.PI / 180;
  const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  // Premier obstacle au moins aussi haut que minH, le long de la normale d'une façade (m, ou null)
  function obstacleDistance(D, f, minH) {
    const E = FS.masks.obstacles(D);
    const s = f.segs.reduce((a, x) => (x.len > a.len ? x : a), f.segs[0]);
    const px = (s.p0[0] + s.p1[0]) / 2 + s.n[0] * 0.1, py = (s.p0[1] + s.p1[1]) / 2 + s.n[1] * 0.1;
    const dx = f.n[0], dy = f.n[1];
    let best = null;
    for (const e of E) {
      if (e.h < minH || (e.self && e.edge === s.edge)) continue;
      const ex = e.bx - e.ax, ey = e.by - e.ay, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const ax = e.ax - px, ay = e.ay - py;
      const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
      if (t > 0.05 && u >= 0 && u <= 1 && (best === null || t < best.d)) best = { d: t, h: e.h, self: e.self };
    }
    return best;
  }

  // Rapport des côtés G = ln(longueur de la façade / profondeur du bâtiment dans le sens de la normale)
  function sideRatioG(D, f) {
    let mn = Infinity, mx = -Infinity;
    for (const p of D.xy) { const v = p[0] * f.n[0] + p[1] * f.n[1]; mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const depth = Math.max(1, mx - mn);
    return Math.max(-1.5, Math.min(1.5, Math.log(Math.max(1, f.length) / depth)));
  }

  // Exposition au vent d'une façade d'après l'élévation moyenne des obstacles devant elle (point central)
  function exposure(D, M, fi) {
    const MF = M.facades[fi];
    let s = 0, w = 0;
    for (const ms of MF.segs) for (const p of ms.pts) {
      if (p.buried || !p.hz) continue;
      for (let k = 0; k < 360; k++) if (p.hz[k] >= 0) { s += p.hz[k]; w++; }
    }
    const el = w ? s / w / RAD : 0;
    return { elev: el, key: el < 10 ? 'expose' : el < 25 ? 'semi' : 'abrite' };
  }

  /* Points de vigilance (confort piéton). dom : secteurs dominants des vents forts [{ dir, share }].
     → [{ x, y, level: 0|1|2, kind, text }] en coordonnées locales. */
  function pedestrian(D, dom, opts) {
    const out = [], H = D.H;
    const nbs = D.nbs.filter((n) => n.height > 0);
    // hauteur moyenne des bâtiments dans 100 m
    let sh = 0, sw = 0;
    for (const nb of nbs) {
      const c = FS.geo.centroid(nb.xy);
      if (Math.hypot(c[0], c[1]) <= 100) { const a = Math.abs(FS.geo.area(nb.xy)); sh += nb.height * a; sw += a; }
    }
    const Hm = sw ? sh / sw : 0;
    const ratio = Hm ? H / Hm : 2;
    const base = H >= 25 && ratio >= 2 ? 2 : H >= 30 || ratio >= 1.4 ? 1 : 0;
    const LEV = ['faible', 'modéré', 'élevé'];
    const facing = (az, tol) => dom.some((s) => angDiff(s.dir, az) <= tol); // vent venant de la direction az

    // 1. angles saillants du contour exposés aux vents dominants (effet de coin)
    const ring = D.xy, n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (cross <= 0 || l1 < 4 || l2 < 4) continue; // angle rentrant, ou petit décroché
      const n1 = [(b[1] - a[1]) / l1, -(b[0] - a[0]) / l1], n2 = [(c[1] - b[1]) / l2, -(c[0] - b[0]) / l2];
      const bis = Math.atan2(n1[0] + n2[0], n1[1] + n2[1]) / RAD;
      if (!facing((bis + 360) % 360, 70)) continue;
      const lvl = base;
      out.push({ x: b[0], y: b[1], level: lvl, kind: 'coin',
        text: 'Angle exposé aux vents dominants : accélération en contournement (effet de coin). Niveau ' + LEV[lvl] + ' (H = ' + FS.fmt(H, 0) + ' m, ' + FS.fmtFixed(ratio, 1) + ' fois la hauteur moyenne alentour).' });
    }
    // 2. pied des façades au vent d'un bâtiment plus haut que son voisinage (rabattement)
    if (ratio >= 1.4 && H >= 18) {
      for (const f of D.model.facades) {
        if (f.cour || f.pignon || f.length < 8 || !facing(f.az, 45)) continue;
        const lvl = ratio >= 2 && H >= 25 ? 2 : 1;
        out.push({ x: f.mid[0] + f.n[0] * 4, y: f.mid[1] + f.n[1] * 4, level: lvl, kind: 'rabattement',
          text: 'Façade ' + f.id + ' au vent, plus haute que son voisinage : le vent se rabat vers le sol à son pied. Niveau ' + LEV[lvl] + '.' });
      }
    }
    // 3. passages étroits entre le bâtiment et un voisin, alignés sur un vent dominant (effet Venturi)
    for (const f of D.model.facades) {
      if (f.cour || f.pignon) continue;
      const hit = obstacleDistance(D, f, 6);
      if (!hit || hit.self || hit.d > 20) continue;
      const axis = (f.az + 90) % 360;
      if (!facing(axis, 22.5) && !facing((axis + 180) % 360, 22.5)) continue;
      const hmin = Math.min(H, hit.h);
      const lvl = hit.d < 10 && hmin >= 15 ? 2 : hmin >= 10 ? 1 : 0;
      out.push({ x: f.mid[0] + f.n[0] * hit.d / 2, y: f.mid[1] + f.n[1] * hit.d / 2, level: lvl, kind: 'passage',
        text: 'Passage de ' + FS.fmt(hit.d, 0) + ' m entre la façade ' + f.id + ' et un bâtiment de ' + FS.fmt(hit.h, 0) + ' m, dans l\'axe d\'un vent dominant : effet Venturi. Niveau ' + LEV[lvl] + '.' });
    }
    // 4. pilotis ou passage traversant sous le bâtiment
    if (opts && opts.pilotis) {
      const c = FS.geo.centroid(D.xy);
      out.push({ x: c[0], y: c[1], level: H >= 15 ? 2 : 1, kind: 'pilotis',
        text: 'Pilotis ou passage sous le bâtiment : le vent s\'y engouffre, entre façades au vent et sous le vent. Niveau ' + LEV[H >= 15 ? 2 : 1] + '.' });
    }
    // 5. voisins nettement plus hauts tout proches (leur pied peut être venté)
    for (const nb of nbs) {
      if (nb.height < Math.max(2 * H, 30)) continue;
      const c = FS.geo.centroid(nb.xy);
      const d = Math.hypot(c[0], c[1]);
      if (d > 80) continue;
      out.push({ x: c[0], y: c[1], level: 1, kind: 'voisin',
        text: 'Bâtiment voisin de ' + FS.fmt(nb.height, 0) + ' m à ' + FS.fmt(d, 0) + ' m : rabattement possible vers les abords du projet. Niveau modéré.' });
    }
    return { points: out, Hm, ratio, base };
  }

  FS.windSite = { obstacleDistance, sideRatioG, exposure, pedestrian, angDiff };
})(window.FS);
