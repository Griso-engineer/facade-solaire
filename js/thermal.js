/* Bilan énergétique simplifié de l'enveloppe, méthode mensuelle quasi-stationnaire
   (NF EN ISO 13790:2008, reprise dans l'EN ISO 52016-1:2017, méthode mensuelle).

   Chaque façade est associée à une « zone de façade » : la bande de plancher de profondeur p
   (5 m par défaut) derrière elle, sur toute sa hauteur. Pour chaque mois :
     Q_ht  = H · (θi − θe) · t                         déperditions (transmission [+ ventilation])
     Q_gn  = Q_sol + Q_int                              apports
     chauffage : Q_H = Q_ht,H − η_gn · Q_gn            η_gn = (1 − γ^a)/(1 − γ^(a+1)), γ = Q_gn/Q_ht,H
     froid     : Q_C = Q_gn − η_ls · Q_ht,C            η_ls = (1 − γ^−a)/(1 − γ^−(a+1)), γ = Q_gn/Q_ht,C
     a = 1 + τ/15 h, τ = C_m / H, C_m = κ_m · A_plancher
   Apports solaires par les vitrages, heure par heure (irradiation masquée de la façade) :
     I · A_baie · (1 − F_F) · F_w · g     (F_w = 0,9 : incidence non normale, ISO 13790 § 11.4.2)
   avec la protection solaire activée quand I > seuil (300 W/m² par défaut) : g → g_tot ou F_c·g.
   Apports par les parois opaques : α · R_se · U_p · A_opaque · I (α = 0,6, R_se = 0,04 m²K/W). */
(function (FS) {
  'use strict';
  const F_W = 0.9, ALPHA = 0.6, RSE = 0.04;
  const INERTIA = { legere: 110e3, moyenne: 165e3, lourde: 260e3 }; // κ_m, J/(m²·K) de plancher (ISO 13790 tab. 12)
  const INERTIA_LABEL = { legere: 'Légère', moyenne: 'Moyenne', lourde: 'Lourde' };

  const PRESETS = [
    { key: 'double-ancien', name: 'Double vitrage ancien', Uw: 2.9, g: 0.75, TL: 0.80, note: '4/12/4 air, menuiserie bois ou alu sans rupture' },
    { key: 'double-fe', name: 'Double faible émissivité', Uw: 1.4, g: 0.60, TL: 0.78, note: '4/16/4 argon, couche peu émissive' },
    { key: 'double-cs', name: 'Double contrôle solaire', Uw: 1.3, g: 0.35, TL: 0.65, note: 'couche sélective, rapport TL/g ≈ 1,9' },
    { key: 'triple', name: 'Triple faible émissivité', Uw: 0.9, g: 0.50, TL: 0.70, note: '4/12/4/12/4 argon, deux couches peu émissives' }
  ];

  function defaults() {
    return {
      depth: 5, tH: 20, tC: 26, qInt: 5, inertia: 'moyenne', ach: 0.5, Up: 0.3, frame: 0.25,
      protection: { mode: 'none', fc: 0.25, gtot: 0.10, threshold: 300 },
      variants: [PRESETS[0], PRESETS[1], PRESETS[2]].map((p) => ({ name: p.name, Uw: p.Uw, g: p.g, TL: p.TL, preset: p.key })),
      ref: 1, view: 1
    };
  }

  // ---------- Bilan d'un mois (fonction pure, testée à la main) ----------
  /* { H (W/K), Cm (J/K), thetaE, thetaH, thetaC (°C), hours, Qsol, Qint (kWh) } */
  function balanceMonth(o) {
    const tau = o.H > 0 ? o.Cm / o.H / 3600 : 1e9; // h
    const a = 1 + tau / 15;
    const QhtH = o.H * (o.thetaH - o.thetaE) * o.hours / 1000;
    const QhtC = o.H * (o.thetaC - o.thetaE) * o.hours / 1000;
    const Qgn = o.Qsol + o.Qint;
    // chauffage
    let etaH = 1, QH = 0;
    if (QhtH > 0) {
      const g = Qgn / QhtH;
      etaH = g <= 0 ? 1 : Math.abs(g - 1) < 1e-9 ? a / (a + 1) : (1 - Math.pow(g, a)) / (1 - Math.pow(g, a + 1));
      QH = Math.max(0, QhtH - etaH * Qgn);
    }
    // froid
    let etaC = 1, QC = 0;
    if (Qgn > 0) {
      if (QhtC <= 0) etaC = 1; // extérieur plus chaud que la consigne : les « déperditions » sont des apports
      else {
        const g = Qgn / QhtC;
        etaC = Math.abs(g - 1) < 1e-9 ? a / (a + 1) : (1 - Math.pow(g, -a)) / (1 - Math.pow(g, -(a + 1)));
      }
      QC = Math.max(0, Qgn - etaC * QhtC);
    }
    return { tau, a, QhtH, QhtC, Qgn, etaH, etaC, QH, QC };
  }

  /* Bilan annuel par façade et par variante.
     D : projet dérivé, R : résultats solaires (irradiation horaire masquée), climate, T : hypothèses thermiques. */
  function compute(D, R, climate, T, floorH) {
    const S = R.sky, n = S.n;
    const MDAYS = FS.climate.MDAYS;
    const tE = climate.monthly.tTMY;
    const prot = T.protection || { mode: 'none' };
    const out = T.variants.map((v) => ({ variant: v, facades: [], totals: null, monthly: { QH: new Array(12).fill(0), QC: new Array(12).fill(0) } }));
    R.facades.forEach((f, fi) => {
      const Df = D.model.facades[fi];
      const A = f.area, Aw = f.glazed, Ao = A - Aw;
      const Af = A / floorH * T.depth;            // plancher de la zone de façade
      const V = Af * floorH;                      // volume
      const Cm = (INERTIA[T.inertia] || INERTIA.moyenne) * Af;
      const Hve = 0.34 * (T.ach || 0) * V;        // W/K (ρc ≈ 0,34 Wh/m³K)
      // irradiation horaire : sommes mensuelles avec et sans protection, pic
      // irradiation sur la façade (opaque, activation des protections) et sur les vitrages
      // (vitrage en tableau, masques compris ; à défaut, celle de la façade)
      const Imon = new Array(12).fill(0), IshMon = new Array(12).fill(0), IopMon = new Array(12).fill(0);
      let peakFree = 0;
      for (let h = 0; h < n; h++) {
        const I = f.hourly[h], Ig = f.glassHourly ? f.glassHourly[h] : I;
        if (I <= 0 && Ig <= 0) continue;
        const m = S.month[h];
        IopMon[m] += I / 1000;
        Imon[m] += Ig / 1000;
        const on = prot.mode !== 'none' && I > prot.threshold;
        if (on) IshMon[m] += Ig / 1000;
        if (m >= 5 && m <= 7) { if (Ig > peakFree) peakFree = Ig; }
      }
      out.forEach((o) => {
        const v = o.variant;
        const gSh = prot.mode === 'gtot' ? prot.gtot : prot.mode === 'fc' ? prot.fc * v.g : v.g;
        const kw = Aw * (1 - T.frame) * F_W;     // m² équivalents de vitrage
        const Htr = v.Uw * Aw + T.Up * Ao;
        const H = Htr + Hve;
        const months = [];
        let QH = 0, QC = 0, Qsol = 0, QhtW = 0, peakGain = 0;
        for (let m = 0; m < 12; m++) {
          const hours = MDAYS[m] * 24;
          // vitrages : part sans protection au g nominal, part protégée au g réduit
          const QsolW = kw * ((Imon[m] - IshMon[m]) * v.g + IshMon[m] * gSh);
          const QsolO = ALPHA * RSE * T.Up * Ao * IopMon[m];
          const Qint = T.qInt * Af * hours / 1000;
          const b = balanceMonth({ H, Cm, thetaE: tE[m], thetaH: T.tH, thetaC: T.tC, hours, Qsol: QsolW + QsolO, Qint });
          months.push(Object.assign({ QsolW, QsolO, Qint }, b));
          QH += b.QH; QC += b.QC; Qsol += QsolW;
          QhtW += v.Uw * Aw * (T.tH - tE[m]) * hours / 1000 * (T.tH > tE[m] ? 1 : 0);
          o.monthly.QH[m] += b.QH; o.monthly.QC[m] += b.QC;
        }
        // pic d'apports solaires par les vitrages (été), protection comprise si elle s'active
        const gPeak = prot.mode !== 'none' && peakFree > prot.threshold ? gSh : v.g;
        peakGain = peakFree * kw * gPeak;
        o.facades.push({
          id: f.id, label: f.label, az: f.az, area: A, glazed: Aw, floor: Af,
          QH, QC, Qsol, QhtW, H, Htr, Hve, tau: months[0].tau,
          peakGain, peakGainFloor: Af ? peakGain / Af : 0, months
        });
      });
    });
    for (const o of out) {
      const s = (k) => o.facades.reduce((a, f) => a + f[k], 0);
      const area = s('area'), floor = s('floor');
      o.totals = { QH: s('QH'), QC: s('QC'), Qsol: s('Qsol'), QhtW: s('QhtW'), area, floor, peakGain: s('peakGain') };
      o.totals.peakGainFloor = floor ? Math.max(...o.facades.map((f) => f.peakGainFloor)) : 0;
    }
    return out;
  }

  // Niveau de risque d'inconfort d'été, d'après le pic d'apports solaires par m² de plancher de la zone
  function riskLevel(wPerM2) {
    if (wPerM2 < 25) return { key: 'faible', label: 'faible' };
    if (wPerM2 < 50) return { key: 'modere', label: 'modéré' };
    return { key: 'eleve', label: 'élevé' };
  }

  FS.thermal = { defaults, balanceMonth, compute, riskLevel, PRESETS, INERTIA, INERTIA_LABEL, F_W, ALPHA, RSE };
})(window.FS);
