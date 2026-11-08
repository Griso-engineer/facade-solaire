/* Graphiques SVG : échelle de couleurs séquentielle, rose des orientations, barres mensuelles.
   Couleur = magnitude sur une seule teinte (orange, du clair au foncé) ; texte en encre. */
(function (FS) {
  'use strict';
  const S = FS.svg, el = FS.el;

  // ---------- Échelle séquentielle (une teinte, clair → foncé) ----------
  const RAMP = ['#fdebdc', '#fbd0b0', '#f6ab7c', '#ef844c', '#e0622a', '#bd4a1c', '#923712', '#66260c'];
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  const RGB = RAMP.map(hexToRgb);
  function colorAt(t) {
    t = Math.max(0, Math.min(1, t)) * (RGB.length - 1);
    const i = Math.min(RGB.length - 2, Math.floor(t)), f = t - i;
    const c = RGB[i].map((v, k) => Math.round(v + (RGB[i + 1][k] - v) * f));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  // Modes de coloration des façades : bornes fixes pour comparer les projets entre eux
  const MODES = {
    annual: { label: 'Annuel', unit: 'kWh/m²·an', max: 1000, get: (f) => f.annual },
    winter: { label: 'Hiver (oct.–avr.)', unit: 'kWh/m²', max: 500, get: (f) => f.winter },
    summer: { label: 'Été (mai–sept.)', unit: 'kWh/m²', max: 600, get: (f) => f.summer },
    peak: { label: 'Pic d\'été', unit: 'W/m²', max: 800, get: (f) => f.peak }
  };
  const colorFor = (mode, f) => colorAt(MODES[mode].get(f) / MODES[mode].max);

  function legend(mode) {
    const m = MODES[mode];
    const stops = RAMP.map((c, i) => c + ' ' + Math.round(i / (RAMP.length - 1) * 100) + '%').join(',');
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => el('span', { style: { left: t * 100 + '%' } }, FS.fmt(t * m.max, 0)));
    return el('div', { class: 'scale-legend' },
      el('div', { class: 'scale-title' }, m.label + ' · ' + m.unit),
      el('div', { class: 'scale-bar', style: { background: 'linear-gradient(90deg,' + stops + ')' } }),
      el('div', { class: 'scale-ticks' }, ticks));
  }

  // ---------- Rose des orientations ----------
  /* R : résultats ; mode : clé de MODES ; sel : n° sélectionné ; onPick(id) */
  function rose(R, mode, sel, onPick) {
    const m = MODES[mode];
    const W = 340, c = W / 2, r0 = 18, r1 = c - 34;
    const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + W, class: 'chart rose', role: 'img', 'aria-label': 'Rose des orientations : ' + m.label });
    const rad = (v) => r0 + (r1 - r0) * Math.min(1, v / m.max);
    // grille
    for (let k = 1; k <= 4; k++) {
      const v = m.max * k / 4;
      svg.append(S('circle', { cx: c, cy: c, r: rad(v), class: 'grid' }));
      // graduations le long de la diagonale nord-est, à l'écart des points cardinaux
      svg.append(S('text', { x: c + rad(v) * Math.SQRT1_2 + 2, y: c - rad(v) * Math.SQRT1_2 - 2, class: 'tick' }, FS.fmt(v, 0)));
    }
    for (const [lab, a] of [['N', 0], ['E', 90], ['S', 180], ['O', 270]]) {
      const x = c + (r1 + 16) * Math.sin(a * Math.PI / 180), y = c - (r1 + 16) * Math.cos(a * Math.PI / 180);
      svg.append(S('text', { x, y: y + 4, class: 'card', 'text-anchor': 'middle' }, lab));
      svg.append(S('line', { x1: c, y1: c, x2: c + r1 * Math.sin(a * Math.PI / 180), y2: c - r1 * Math.cos(a * Math.PI / 180), class: 'grid' }));
    }
    // un secteur par façade (± 9°), triés pour dessiner les petits devant
    const fs = R.facades.slice().sort((a, b) => m.get(b) - m.get(a));
    for (const f of fs) {
      const v = m.get(f), rr = rad(v);
      const a0 = (f.az - 9) * Math.PI / 180, a1 = (f.az + 9) * Math.PI / 180;
      const p = (a, r) => (c + r * Math.sin(a)).toFixed(1) + ',' + (c - r * Math.cos(a)).toFixed(1);
      const d = 'M' + p(a0, r0) + 'L' + p(a0, rr) + 'A' + rr + ',' + rr + ' 0 0 1 ' + p(a1, rr) + 'L' + p(a1, r0) + 'A' + r0 + ',' + r0 + ' 0 0 0 ' + p(a0, r0) + 'Z';
      const path = S('path', { d, fill: colorAt(v / m.max), class: 'wedge' + (f.id === sel ? ' sel' : '') });
      const tip = 'Façade ' + f.id + ' · ' + FS.orientName[f.label] + ' (' + Math.round(f.az) + '°)\n' + m.label + ' : ' + FS.fmt(v, 0) + ' ' + m.unit;
      path.addEventListener('mousemove', (e) => FS.showTip(tip, e.clientX, e.clientY));
      path.addEventListener('mouseleave', FS.hideTip);
      if (onPick) path.addEventListener('click', () => onPick(f.id));
      svg.append(path);
    }
    // étiquettes : façades d'orientation voisine (± 8°) regroupées (« 3 · 5 · 7 »)
    const byAz = R.facades.slice().sort((a, b) => a.az - b.az);
    const groups = [];
    for (const f of byAz) {
      const g = groups[groups.length - 1];
      if (g && f.az - g.az1 <= 8) { g.ids.push(f.id); g.az1 = f.az; g.v = Math.max(g.v, m.get(f)); g.sx += Math.sin(f.az * Math.PI / 180); g.sy += Math.cos(f.az * Math.PI / 180); }
      else groups.push({ ids: [f.id], az1: f.az, v: m.get(f), sx: Math.sin(f.az * Math.PI / 180), sy: Math.cos(f.az * Math.PI / 180) });
    }
    if (groups.length > 1) { // raccord 359° / 1°
      const a = groups[0], z = groups[groups.length - 1];
      if (a.az1 - 0 + (360 - z.az1) <= 8 && a !== z) { z.ids = z.ids.concat(a.ids); z.v = Math.max(z.v, a.v); z.sx += a.sx; z.sy += a.sy; groups.shift(); }
    }
    for (const g of groups) {
      const lr = Math.max(rad(g.v) + 12, r0 + 16);
      const la = Math.atan2(g.sx, g.sy);
      svg.append(S('text', { x: c + lr * Math.sin(la), y: c - lr * Math.cos(la) + 4, class: 'lab', 'text-anchor': 'middle' },
        g.ids.sort((a, b) => a - b).join(' · ')));
    }
    return svg;
  }

  // ---------- Barres mensuelles ----------
  /* values[12] (façade sélectionnée), ref[12] (moyenne des façades, ligne grise) */
  function monthly(values, ref, opts = {}) {
    const W = 560, H = 230, ml = 40, mr = 8, mt = 14, mb = 26;
    const iw = W - ml - mr, ih = H - mt - mb;
    const vmax = Math.max(10, ...values, ...(ref || []));
    const step = niceStep(vmax / 4);
    const top = Math.ceil(vmax / step) * step;
    const y = (v) => mt + ih - ih * v / top;
    const bw = iw / 12;
    const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart bars', role: 'img', 'aria-label': opts.title || 'Irradiation mensuelle' });
    // saisons : fond très léger pour l'été (mai–sept.)
    svg.append(S('rect', { x: ml + 4 * bw, y: mt, width: 5 * bw, height: ih, class: 'season' }));
    svg.append(S('text', { x: ml + 6.5 * bw, y: mt + 10, class: 'tick', 'text-anchor': 'middle' }, 'été'));
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.append(S('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
      svg.append(S('text', { x: ml - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, FS.fmt(v, 0)));
    }
    values.forEach((v, i) => {
      const x = ml + i * bw + bw * 0.18, w = bw * 0.64, h = Math.max(0, y(0) - y(v));
      const r = Math.min(4, w / 2, h);
      // barre à extrémité arrondie, ancrée sur l'axe
      const d = 'M' + x + ',' + y(0) + 'V' + (y(v) + r) + 'Q' + x + ',' + y(v) + ' ' + (x + r) + ',' + y(v) +
        'H' + (x + w - r) + 'Q' + (x + w) + ',' + y(v) + ' ' + (x + w) + ',' + (y(v) + r) + 'V' + y(0) + 'Z';
      svg.append(S('path', { d, class: 'bar', fill: opts.color || 'var(--accent)' }));
      svg.append(S('text', { x: ml + i * bw + bw / 2, y: H - 8, class: 'tick', 'text-anchor': 'middle' }, FS.climate.MONTHS[i].replace('.', '')));
      const hit = S('rect', { x: ml + i * bw, y: mt, width: bw, height: ih, class: 'hit' });
      const tip = FS.climate.MONTHS[i] + '\n' + (opts.name || 'Façade') + ' : ' + FS.fmt(v, 1) + ' ' + (opts.unit || 'kWh/m²') +
        (ref ? '\nMoyenne des façades : ' + FS.fmt(ref[i], 1) : '');
      hit.addEventListener('mousemove', (e) => FS.showTip(tip, e.clientX, e.clientY));
      hit.addEventListener('mouseleave', FS.hideTip);
      svg.append(hit);
    });
    if (ref) {
      const pts = ref.map((v, i) => (ml + i * bw + bw / 2).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
      svg.append(S('polyline', { points: pts, class: 'refline' }));
      ref.forEach((v, i) => svg.append(S('circle', { cx: ml + i * bw + bw / 2, cy: y(v), r: 3, class: 'refdot' })));
    }
    const wrap = el('div', { class: 'chart-wrap' });
    if (ref) wrap.append(el('div', { class: 'legend-inline' },
      el('span', { style: { '--sw': opts.color || 'var(--accent)' } }, opts.name || 'Façade'),
      el('span', { class: 'line', style: { '--sw': 'var(--muted)' } }, 'Moyenne des façades')));
    wrap.append(svg);
    return wrap;
  }

  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x))), r = x / p;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
  }

  FS.charts = { colorAt, colorFor, legend, rose, monthly, MODES, RAMP };
})(window.FS);
