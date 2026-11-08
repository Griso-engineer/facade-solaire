/* Lumière naturelle, en ordre de grandeur seulement.

   VSC (Vertical Sky Component, BRE 209 « Site layout planning for daylight and sunlight ») :
   part de l'éclairement d'un ciel couvert CIE reçue sur le plan de la façade, rapportée à
   l'éclairement horizontal d'un site totalement dégagé. Mur dégagé : 39,6 %. Calculée en chaque
   point de façade à partir du profil d'horizon (FS.masks.skyFactors).
   Repères BRE : ≥ 27 % bon ; 15–27 % des baies plus grandes sont nécessaires ; 5–15 % difficile ;
   < 5 % très difficile.

   FLJm (facteur de lumière du jour moyen, formule BRE simplifiée, Littlefair ; BS 8206-2) :
     FLJm = TL · A_w · θ · M / (A · (1 − R²))
   TL : transmission lumineuse du vitrage ; A_w : surface vitrée nette de la pièce ; θ : angle de
   ciel visible depuis le centre de la baie (°), 90° − élévation moyenne des obstacles ;
   M : facteur d'encrassement ; A : surface totale des parois de la pièce ; R : réflexion moyenne. */
(function (FS) {
  'use strict';

  function defaults() { return { roomW: 4, ceilingH: 2.7, R: 0.5, M: 0.9, variant: null }; }

  // FLJm (%) d'une pièce type
  function adf(o) {
    // o : { TL, Aw, theta (°), M, W, d, h, R }
    const A = 2 * (o.W * o.d + o.W * o.h + o.d * o.h);
    // avec θ en degrés, la formule donne directement un pourcentage
    return o.TL * o.Aw * o.theta * o.M / (A * (1 - o.R * o.R));
  }

  function vscClass(v) {
    if (v >= 0.27) return { key: 'bon', label: 'bon' };
    if (v >= 0.15) return { key: 'moyen', label: 'baies à agrandir' };
    if (v >= 0.05) return { key: 'faible', label: 'difficile' };
    return { key: 'tres-faible', label: 'très difficile' };
  }
  function adfClass(v) {
    if (v >= 5) return { key: 'bon', label: 'très lumineux' };
    if (v >= 2) return { key: 'bon', label: 'bien éclairé' };
    if (v >= 1) return { key: 'moyen', label: 'moyen' };
    return { key: 'faible', label: 'sombre' };
  }

  /* Par façade : VSC et FLJm moyens, en bas et en haut.
     D : projet dérivé ; M : masques (R.M) ; L : réglages lumière ; TL ; frame : part de menuiserie ; depth ; floorH */
  function compute(D, M, L, TL, frame, depth, floorH) {
    const h = Math.min(L.ceilingH, floorH);
    return D.model.facades.map((f, fi) => {
      const MF = M.facades[fi];
      // rangées de points par niveau (indice de ligne j), pondérées par la longueur des segments
      const rows = [];
      MF.segs.forEach((ms, si) => {
        const s = f.segs[si], g = ms.g;
        for (let j = 0; j < g.nr; j++) {
          for (let i = 0; i < g.nc; i++) {
            const p = ms.pts[j * g.nc + i];
            if (p.buried) continue;
            const w = s.len / g.nc;
            const r = rows[j] || (rows[j] = { z: 0, w: 0, vsc: 0, elev: 0 });
            r.z += p.p[2] * w; r.w += w; r.vsc += p.vsc * w; r.elev += p.elev * w;
          }
        }
      });
      const R = rows.filter(Boolean).map((r) => {
        const vsc = r.vsc / r.w, elev = r.elev / r.w, theta = Math.max(0, 90 - elev);
        const Aw = f.wwr * L.roomW * floorH * (1 - frame);
        return { z: r.z / r.w, w: r.w, vsc, elev, theta, adf: adf({ TL, Aw, theta, M: L.M, W: L.roomW, d: depth, h, R: L.R }) };
      });
      const W = R.reduce((a, r) => a + r.w, 0) || 1;
      const mean = (k) => R.reduce((a, r) => a + r[k] * r.w, 0) / W;
      return {
        id: f.id, label: f.label, az: f.az, wwr: f.wwr, pignon: f.pignon, rows: R,
        vsc: mean('vsc'), adf: mean('adf'), theta: mean('theta'),
        low: R[0] || null, high: R[R.length - 1] || null
      };
    });
  }

  FS.daylight = { defaults, adf, compute, vscClass, adfClass, VSC_MAX: 0.396 };
})(window.FS);
