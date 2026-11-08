/* Utilitaires communs : DOM/SVG, formatage, stockage, géométrie locale.
   Espace de noms global FS (scripts classiques, pas de modules : index.html
   s'ouvre aussi par double-clic). */
window.FS = window.FS || {};
(function (FS) {
  'use strict';

  function append(parent, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      parent.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
  }

  // el('div', {class: 'x', onclick: fn}, enfants...)
  FS.el = function (tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const p in v) { if (p.startsWith('--')) e.style.setProperty(p, v[p]); else e.style[p] = v[p]; }
      }
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked') e.checked = !!v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    append(e, children);
    return e;
  };

  const NS = 'http://www.w3.org/2000/svg';
  FS.svg = function (tag, attrs, ...children) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    append(e, children);
    return e;
  };

  FS.$ = (sel, root) => (root || document).querySelector(sel);

  // Format numérique français
  FS.fmt = function (v, d = 1) {
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d });
  };
  FS.fmtFixed = function (v, d = 1) {
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  FS.pct = (v, d = 0) => (v == null || !isFinite(v)) ? '—' : FS.fmtFixed(v * 100, d) + ' %';
  FS.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  FS.num = function (v, def) { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : def; };

  FS.store = {
    get(k, def) {
      try { const v = localStorage.getItem('facade:' + k); return v == null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set(k, v) {
      try { localStorage.setItem('facade:' + k, JSON.stringify(v)); } catch (e) { /* stockage plein ou indisponible */ }
    }
  };

  const tip = () => document.getElementById('tooltip');
  FS.showTip = function (text, x, y) {
    const t = tip(); if (!t) return;
    t.textContent = text; t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    t.style.left = left + 'px'; t.style.top = top + 'px';
  };
  FS.hideTip = function () { const t = tip(); if (t) t.hidden = true; };

  FS.download = function (filename, text, type = 'application/json') {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  FS.blockHead = function (num, title, text, tag = 'h1') {
    return FS.el('div', { class: 'block-head' },
      FS.el('span', { class: 'num' }, num), FS.el(tag, {}, title), FS.el('p', {}, text));
  };

  FS.debounce = function (fn, ms) {
    let t = 0;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  };

  // ---------- Géométrie ----------
  const R_EARTH = 6371008.8;
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  FS.RAD = RAD; FS.DEG = DEG;

  /* Projection locale équirectangulaire autour d'une origine (lat0, lon0) :
     x vers l'est, y vers le nord, en mètres. Erreur < 1 cm à 500 m. */
  FS.geo = {
    projector(lat0, lon0) {
      const kx = R_EARTH * RAD * Math.cos(lat0 * RAD), ky = R_EARTH * RAD;
      return {
        lat0, lon0,
        toXY: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
        toLL: (x, y) => [lat0 + y / ky, lon0 + x / kx]
      };
    },
    area(ring) { // aire signée (positive si sens trigonométrique)
      let a = 0;
      for (let i = 0, n = ring.length; i < n; i++) {
        const p = ring[i], q = ring[(i + 1) % n];
        a += p[0] * q[1] - q[0] * p[1];
      }
      return a / 2;
    },
    centroid(ring) {
      let a = 0, cx = 0, cy = 0;
      for (let i = 0, n = ring.length; i < n; i++) {
        const p = ring[i], q = ring[(i + 1) % n];
        const f = p[0] * q[1] - q[0] * p[1];
        a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
      }
      if (Math.abs(a) < 1e-9) return ring[0].slice();
      return [cx / (3 * a), cy / (3 * a)];
    },
    inside(pt, ring) {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
          pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      }
      return c;
    },
    distSeg(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy;
      let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
      return Math.sqrt(x * x + y * y);
    },
    distRing(p, ring) {
      let d = Infinity;
      for (let i = 0, n = ring.length; i < n; i++) d = Math.min(d, FS.geo.distSeg(p, ring[i], ring[(i + 1) % n]));
      return d;
    },
    // Nettoyage d'un anneau : sans point de fermeture, sans doublons, sens trigonométrique.
    clean(ring) {
      const r = [];
      for (const p of ring) {
        const q = r[r.length - 1];
        if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) r.push([p[0], p[1]]);
      }
      while (r.length > 2 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) <= 0.05) r.pop();
      if (FS.geo.area(r) < 0) r.reverse();
      return r;
    }
  };

  // Azimut (°, depuis le nord, sens horaire) → libellé à 8 secteurs
  const SECT = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  FS.orientLabel = (az) => SECT[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  FS.orientName = {
    N: 'nord', NE: 'nord-est', E: 'est', SE: 'sud-est', S: 'sud', SO: 'sud-ouest', O: 'ouest', NO: 'nord-ouest'
  };
})(window.FS);
