/* Messages clés de la fiche offre, générés à partir des résultats.
   Chaque règle produit au plus un message avec un score d'importance ; on garde les 3 à 5 meilleurs.
   Les messages restent factuels et chiffrés ; les recommandations sont des pistes, pas des prescriptions. */
(function (FS) {
  'use strict';
  const pct = (v) => FS.fmt(Math.round(v * 100), 0) + ' %';
  const name = (lab) => FS.orientName[lab];
  const plural = (ids) => ids.length > 1;

  /* ctx : { P, D, R (exposition), TR (thermique, toutes variantes), DL (lumière), climate } */
  function generate(ctx) {
    const { P, D, R, TR, DL } = ctx;
    const out = [];
    if (!R || !R.facades.length) return out;
    const T = P.thermal, ref = TR ? TR[Math.min(T.ref, TR.length - 1)] : null;

    // A. Concentration des apports d'été, par orientation
    const byOr = {};
    for (const f of R.facades) {
      if (f.glazed <= 0) continue;
      const g = byOr[f.label] || (byOr[f.label] = { label: f.label, ids: [], share: 0 });
      g.ids.push(f.id); g.share += f.shareSummer;
    }
    const groups = Object.values(byOr).sort((a, b) => b.share - a.share);
    if (groups.length && groups[0].share >= 0.3 && groups.length > 1) {
      const g = groups[0];
      const who = plural(g.ids) ? 'Les façades ' + name(g.label) + ' (' + g.ids.join(', ') + ') concentrent'
        : 'La façade ' + g.ids[0] + ' (' + name(g.label) + ') concentre';
      out.push({ score: 50 + 50 * g.share, kind: 'ete',
        text: who + ' ' + pct(g.share) + ' des apports solaires d\'été par les vitrages : priorité aux protections solaires sur cette orientation.' });
    }

    // B. Effet d'une protection solaire extérieure mobile sur le froid
    if (ref && ref.totals.QC > 0 && ctx.climate) {
      const cur = T.protection.mode;
      const alt = Object.assign({}, T, {
        variants: [ref.variant], ref: 0,
        protection: cur === 'none' ? { mode: 'fc', fc: 0.25, gtot: 0.1, threshold: 300 } : { mode: 'none', fc: 0.25, gtot: 0.1, threshold: 300 }
      });
      const o = FS.thermal.compute(D, R, ctx.climate, alt, P.floorH)[0];
      if (cur === 'none') {
        const r = 1 - o.totals.QC / ref.totals.QC;
        if (r >= 0.1) out.push({ score: 40 + 70 * r, kind: 'protection',
          text: 'Une protection solaire extérieure mobile (Fc ≈ 0,25) réduirait d\'environ ' + pct(r) + ' les besoins de froid liés à l\'enveloppe (' + ref.variant.name.toLowerCase() + ').' });
      } else if (o.totals.QC > 0) {
        const r = 1 - ref.totals.QC / o.totals.QC;
        if (r >= 0.05) out.push({ score: 30 + 60 * r, kind: 'protection',
          text: 'La protection solaire retenue réduit d\'environ ' + pct(r) + ' les besoins de froid liés à l\'enveloppe : à conserver dans le projet.' });
      }
    }

    // C. Pic d'apports : risque d'inconfort d'été
    if (ref) {
      const f = ref.facades.reduce((a, x) => (x.peakGainFloor > a.peakGainFloor ? x : a), ref.facades[0]);
      const risk = FS.thermal.riskLevel(f.peakGainFloor);
      if (risk.key !== 'faible') out.push({ score: risk.key === 'eleve' ? 80 : 45, kind: 'confort',
        text: 'Pic d\'apports solaires de ' + FS.fmt(f.peakGainFloor, 0) + ' W/m² de plancher derrière la façade ' + f.id + ' (' + name(f.label) + ') : risque d\'inconfort d\'été ' +
          risk.label + (T.protection.mode === 'none' ? ' sans protection solaire.' : ', protection comprise.') });
    }

    // D. Masques du contexte
    if (R.masks && R.totals.incident0 > 0) {
      const L = 1 - R.totals.incident / R.totals.incident0;
      const fm = R.facades.reduce((a, f) => (f.maskLoss > a.maskLoss ? f : a));
      if (L >= 0.15) out.push({ score: 30 + 60 * L, kind: 'masques',
        text: 'Le bâti environnant retire ' + pct(L) + ' du rayonnement reçu par les façades, jusqu\'à ' + pct(fm.maskLoss) + ' pour la façade ' + fm.id + ' (' + name(fm.label) + ') : ' +
          'l\'orientation seule ne suffit pas à juger l\'exposition.' });
      else if (L < 0.05) out.push({ score: 25, kind: 'masques',
        text: 'Site dégagé : les masques retirent moins de 5 % du rayonnement ; l\'orientation des façades pilote les apports.' });
    }

    // E. Variantes de vitrage : arbitrage hiver / été
    if (TR && TR.length > 1) {
      const A = TR[0].totals.area;
      const tot = (o) => (o.totals.QH + o.totals.QC) / A;
      const bH = TR.reduce((a, o) => (o.totals.QH < a.totals.QH ? o : a)), bC = TR.reduce((a, o) => (o.totals.QC < a.totals.QC ? o : a));
      const bT = TR.reduce((a, o) => (tot(o) < tot(a) ? o : a)), wT = TR.reduce((a, o) => (tot(o) > tot(a) ? o : a));
      const gain = 1 - tot(bT) / tot(wT);
      if (bH !== bC) out.push({ score: 55, kind: 'variantes',
        text: 'Arbitrage hiver / été : « ' + bH.variant.name + ' » minimise le chauffage, « ' + bC.variant.name + ' » le froid ; « ' + bT.variant.name +
          ' » donne le plus faible total (' + FS.fmt(tot(bT), 0) + ' kWh/m² de façade et par an, ' + pct(gain) + ' de moins que « ' + wT.variant.name + ' »).' });
      else if (gain >= 0.1) out.push({ score: 50, kind: 'variantes',
        text: '« ' + bT.variant.name + ' » réduit chauffage et froid de ' + pct(gain) + ' par rapport à « ' + wT.variant.name + ' » (' + FS.fmt(tot(bT), 0) + ' contre ' + FS.fmt(tot(wT), 0) + ' kWh/m² de façade et par an).' });
    }

    // F. Lumière naturelle
    if (DL) {
      const fs = DL.filter((f) => !f.pignon && f.low);
      const low = fs.filter((f) => f.low.vsc < 0.15).sort((a, b) => a.low.vsc - b.low.vsc);
      if (low.length) out.push({ score: 45 + 10 * low.length, kind: 'lumiere',
        text: 'Lumière naturelle contrainte en bas de ' + (low.length > 1 ? 'façades ' + low.map((f) => f.id).join(', ') : 'façade ' + low[0].id) +
          ' (VSC ' + pct(low[0].low.vsc) + ', sous le repère de 15 % du BRE) : y préserver la fraction vitrée et une transmission lumineuse élevée.' });
      else if (fs.length && fs.every((f) => f.low.vsc >= 0.27)) out.push({ score: 20, kind: 'lumiere',
        text: 'Accès au ciel favorable sur toutes les façades vitrées (VSC ≥ 27 % dès le premier niveau).' });
    }

    // G. Apports d'hiver valorisables
    const wd = (f) => (f.daily ? f.daily.hiver : f.winter / 90);
    const fw = R.facades.reduce((a, f) => (wd(f) > wd(a) ? f : a));
    if (wd(fw) >= 1.5) out.push({ score: 30, kind: 'hiver',
      text: 'La façade ' + fw.id + ' (' + name(fw.label) + ') reçoit ' + FS.fmtFixed(wd(fw), 1) + ' kWh/m² par jour en hiver (déc.–févr.) : des apports gratuits à valoriser, plutôt avec une protection mobile qu\'avec un dispositif fixe.' });

    // repli : façade la plus exposée
    if (out.length < 3) {
      const top = R.facades.reduce((a, f) => (f.annual > a.annual ? f : a));
      out.push({ score: 10, kind: 'expo', text: 'La façade ' + top.id + ' (' + name(top.label) + ') est la plus exposée : ' + FS.fmt(top.annual, 0) + ' kWh/m² par an, ' + FS.fmt(top.summer, 0) + ' de mai à septembre.' });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  FS.messages = { generate };
})(window.FS);
