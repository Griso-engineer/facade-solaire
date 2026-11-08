/* Graphiques SVG : échelle de couleurs séquentielle, rose des orientations, barres mensuelles.
   Couleur = magnitude sur une seule teinte (orange, du clair au foncé) ; texte en encre. */
(function (FS) {
  'use strict';
  const S = FS.svg, el = FS.el;

  // ---------- Échelle séquentielle (une teinte, clair → foncé) ----------
  const RAMP = ['#fdebdc', '#fbd0b0', '#f6ab7c', '#ef844c', '#e0622a', '#bd4a1c', '#923712', '#66260c'];
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  // Lumière : seconde échelle séquentielle, en bleu (rampe de référence), pour ne pas la confondre avec le soleil
  const RAMP_SKY = ['#e6f0fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
  const RGBS = { sun: RAMP.map(hexToRgb), sky: RAMP_SKY.map(hexToRgb) };
  function colorAt(t, ramp) {
    const RGB = RGBS[ramp || 'sun'];
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
    peak: { label: 'Pic d\'été', unit: 'W/m²', max: 800, get: (f) => f.peak },
    vsc: { label: 'Ciel visible (VSC)', unit: '%', max: 40, get: (f) => f.vsc * 100, ramp: 'sky' }
  };
  const colorFor = (mode, f) => colorAt(MODES[mode].get(f) / MODES[mode].max, MODES[mode].ramp);

  function legend(mode) {
    const m = MODES[mode];
    const stops = (m.ramp === 'sky' ? RAMP_SKY : RAMP).map((c, i, a) => c + ' ' + Math.round(i / (a.length - 1) * 100) + '%').join(',');
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
      const path = S('path', { d, fill: colorAt(v / m.max, m.ramp), class: 'wedge' + (f.id === sel ? ' sel' : '') });
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
        (ref ? '\n' + (opts.refName || 'Moyenne des façades') + ' : ' + FS.fmt(ref[i], 1) : '');
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
      el('span', { class: 'line', style: { '--sw': 'var(--muted)' } }, opts.refName || 'Moyenne des façades')));
    wrap.append(svg);
    return wrap;
  }

  // ---------- Diagramme de masque solaire (projection cylindrique) ----------
  /* hz : profil d'horizon du point (rad, 360 cases) ; az : azimut de la façade (°) ;
     opts : { lat, lon, tz }. Abscisse : azimut de az − 90° à az + 90° ; ordonnée : hauteur 0–75°. */
  function maskDiagram(hz, az, opts) {
    const W = 560, H = 250, ml = 34, mr = 10, mt = 12, mb = 30;
    const iw = W - ml - mr, ih = H - mt - mb, AMAX = 75;
    const rel = (a) => { let d = ((a - az + 540) % 360) - 180; return d; }; // −180..180
    const x = (a) => ml + (rel(a) + 90) / 180 * iw;
    const y = (alt) => mt + ih - ih * Math.min(alt, AMAX) / AMAX;
    const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart maskd', role: 'img', 'aria-label': 'Diagramme de masque solaire' });
    for (let alt = 0; alt <= AMAX; alt += 15) {
      svg.append(S('line', { x1: ml, x2: W - mr, y1: y(alt), y2: y(alt), class: alt ? 'grid' : 'axis' }));
      svg.append(S('text', { x: ml - 5, y: y(alt) + 4, class: 'tick', 'text-anchor': 'end' }, alt + '°'));
    }
    for (let d = -90; d <= 90; d += 30) {
      const a = (az + d + 360) % 360;
      svg.append(S('line', { x1: x(a), x2: x(a), y1: mt, y2: mt + ih, class: 'grid' }));
      const lab = Math.round(a) + '° ' + FS.orientLabel(a);
      svg.append(S('text', { x: x(a), y: H - 10, class: d === 0 ? 'card' : 'tick', 'text-anchor': 'middle' }, d === 0 ? 'normale · ' + lab : lab));
    }
    // masque : silhouette des obstacles
    let d = 'M' + ml + ',' + y(0);
    for (let k = -90; k <= 90; k++) {
      const a = (az + k + 360) % 360;
      const e = Math.max(0, FS.masks.at(hz, a)) / Math.PI * 180;
      d += 'L' + (ml + (k + 90) / 180 * iw).toFixed(1) + ',' + y(e).toFixed(1);
    }
    d += 'L' + (W - mr) + ',' + y(0) + 'Z';
    svg.append(S('path', { d, class: 'maskfill' }));
    // courses du soleil
    const days = [['21 juin', 6, 21], ['équinoxes', 3, 20], ['21 déc.', 12, 21]];
    for (const [lab, m, dd] of days) {
      const doy = FS.solar.doyOf(2026, m, dd);
      let path = '', last = null, pen = false;
      for (let t = 4; t <= 22; t += 1 / 6) {
        const p = FS.solar.position(FS.solar.localToUTC(2026, doy, t, opts.tz), opts.lat, opts.lon);
        const r = rel(p.azimuth);
        if (p.altitude <= 0 || Math.abs(r) > 90) { pen = false; continue; }
        path += (pen ? 'L' : 'M') + x(p.azimuth).toFixed(1) + ',' + y(p.altitude).toFixed(1);
        pen = true; last = p;
        // heures pleines
        if (Math.abs(t - Math.round(t)) < 0.01) {
          const vis = p.altitude * Math.PI / 180 > FS.masks.at(hz, p.azimuth);
          svg.append(S('circle', { cx: x(p.azimuth), cy: y(p.altitude), r: 3.2, class: vis ? 'sundot' : 'sundot off' }));
          if (m === 6) svg.append(S('text', { x: x(p.azimuth), y: y(p.altitude) - 7, class: 'tick', 'text-anchor': 'middle' }, Math.round(t) + ' h'));
        }
      }
      svg.insertBefore(S('path', { d: path, class: 'sunpath' }), svg.querySelector('.sundot'));
      if (last) {
        // étiquette directe en bout de course
        let best = null;
        for (let t = 4; t <= 22; t += 0.25) {
          const p = FS.solar.position(FS.solar.localToUTC(2026, doy, t, opts.tz), opts.lat, opts.lon);
          if (p.altitude > 0 && Math.abs(rel(p.azimuth)) <= 90 && (!best || p.altitude > best.altitude)) best = p;
        }
        if (best) svg.append(S('text', { x: x(best.azimuth), y: y(best.altitude) - (m === 6 ? 18 : 8), class: 'lab', 'text-anchor': 'middle' }, lab));
      }
    }
    return svg;
  }

  // ---------- Barres groupées (ex. chauffage / froid par variante ou par mois) ----------
  /* cats : libellés ; series : [{ name, color, values }] ; opts : { unit, labels (valeurs sur les barres), title } */
  function groupBars(cats, series, opts = {}) {
    const W = 560, H = opts.height || 240, ml = 44, mr = opts.refLines ? 62 : 8, mt = 18, mb = opts.wrapLabels ? 40 : 26;
    const iw = W - ml - mr, ih = H - mt - mb;
    const vmax = Math.max(1e-6, ...series.flatMap((s) => s.values), ...(opts.refLines || []).map((r) => r.v));
    const step = niceStep(vmax / 4), top = Math.ceil(vmax / step) * step;
    const y = (v) => mt + ih - ih * v / top;
    const cw = iw / cats.length, gap = 2, bw = Math.min(42, (cw * 0.7 - gap * (series.length - 1)) / series.length);
    const svg = S('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart bars', role: 'img', 'aria-label': opts.title || '' });
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.append(S('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
      svg.append(S('text', { x: ml - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, FS.fmt(v, step < 1 ? 1 : 0)));
    }
    // seuils de lecture (traits tiretés)
    for (const r of opts.refLines || []) {
      svg.append(S('line', { x1: ml, x2: W - mr, y1: y(r.v), y2: y(r.v), class: 'refth' }));
      svg.append(S('text', { x: W - mr + 4, y: y(r.v) + 4, class: 'tick', 'text-anchor': 'start' }, r.label));
    }
    cats.forEach((c, i) => {
      const x0 = ml + i * cw + (cw - (bw * series.length + gap * (series.length - 1))) / 2;
      series.forEach((s, k) => {
        const v = s.values[i], x = x0 + k * (bw + gap), h = Math.max(0, y(0) - y(v));
        const r = Math.min(4, bw / 2, h);
        const d = 'M' + x + ',' + y(0) + 'V' + (y(v) + r) + 'Q' + x + ',' + y(v) + ' ' + (x + r) + ',' + y(v) +
          'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y(v) + ' ' + (x + bw) + ',' + (y(v) + r) + 'V' + y(0) + 'Z';
        if (h > 0) svg.append(S('path', { d, fill: s.color, class: 'bar' }));
        if (opts.labels) svg.append(S('text', { x: x + bw / 2, y: y(v) - 4, class: 'tick val', 'text-anchor': 'middle' }, FS.fmt(v, v < 10 ? 1 : 0)));
      });
      const lab = String(c);
      if (opts.wrapLabels && lab.length > 14) {
        const words = lab.split(' '), half = Math.ceil(words.length / 2);
        svg.append(S('text', { x: ml + i * cw + cw / 2, y: H - 22, class: 'tick', 'text-anchor': 'middle' }, words.slice(0, half).join(' ')));
        svg.append(S('text', { x: ml + i * cw + cw / 2, y: H - 9, class: 'tick', 'text-anchor': 'middle' }, words.slice(half).join(' ')));
      } else svg.append(S('text', { x: ml + i * cw + cw / 2, y: H - 9, class: 'tick', 'text-anchor': 'middle' }, lab));
      const hit = S('rect', { x: ml + i * cw, y: mt, width: cw, height: ih, class: 'hit' });
      const tip = lab + series.map((s) => '\n' + s.name + ' : ' + FS.fmt(s.values[i], 1) + ' ' + (opts.unit || '')).join('');
      hit.addEventListener('mousemove', (e) => FS.showTip(tip, e.clientX, e.clientY));
      hit.addEventListener('mouseleave', FS.hideTip);
      svg.append(hit);
    });
    const wrap = el('div', { class: 'chart-wrap' });
    wrap.append(el('div', { class: 'legend-inline' }, series.map((s) => el('span', { style: { '--sw': s.color } }, s.name))));
    wrap.append(svg);
    return wrap;
  }
  // Couleurs des deux séries thermiques (palette catégorielle validée, emplacements 2 et 1)
  const HEAT = '#eb6834', COOL = '#2a78d6';

  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x))), r = x / p;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
  }

  FS.charts = { colorAt, colorFor, legend, rose, monthly, maskDiagram, groupBars, HEAT, COOL, MODES, RAMP };
})(window.FS);
