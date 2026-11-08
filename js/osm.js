/* Accès aux données OpenStreetMap : recherche d'adresse (Nominatim) et
   bâtiments (Overpass). Les deux services acceptent les requêtes CORS. */
(function (FS) {
  'use strict';

  const OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ];

  async function search(q) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=fr&q=' + encodeURIComponent(q);
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Nominatim : erreur ' + r.status);
    const js = await r.json();
    return js.map((x) => ({ label: x.display_name, lat: +x.lat, lon: +x.lon }));
  }

  async function overpass(query) {
    let lastErr = null;
    for (const ep of OVERPASS) {
      try {
        const r = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: 'data=' + encodeURIComponent(query)
        });
        if (!r.ok) { lastErr = new Error('Overpass : erreur ' + r.status); continue; }
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Overpass indisponible');
  }

  // Lecture d'une hauteur OSM : « 12 », « 12 m », « 12,5 »
  function parseLen(s) {
    if (s == null) return null;
    const m = String(s).replace(',', '.').match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*(m|metres?|mètres?)?\s*$/i);
    return m ? parseFloat(m[1]) : null;
  }

  /* Hauteur d'un bâtiment à partir de ses tags. src : 'height' | 'levels' | 'default'.
     defaults : { floorH, defaultH } */
  function heightFromTags(tags, defaults) {
    const h = parseLen(tags.height);
    if (h && h > 0) return { height: h, src: 'height', levels: parseLen(tags['building:levels']) };
    const lv = parseLen(tags['building:levels']);
    if (lv && lv > 0) {
      const roof = parseLen(tags['roof:levels']) || 0;
      return { height: (lv + 0.5 * roof) * defaults.floorH, src: 'levels', levels: lv };
    }
    return { height: defaults.defaultH, src: 'default', levels: null };
  }

  // Assemble des chemins (listes de [lat, lon]) en anneaux fermés.
  function joinWays(ways) {
    const segs = ways.filter((w) => w.length > 1).map((w) => w.slice());
    const rings = [];
    const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    while (segs.length) {
      let ring = segs.shift();
      let guard = 0;
      while (!same(ring[0], ring[ring.length - 1]) && guard++ < 1000) {
        const end = ring[ring.length - 1];
        const i = segs.findIndex((s) => same(s[0], end) || same(s[s.length - 1], end));
        if (i < 0) break;
        let s = segs.splice(i, 1)[0];
        if (!same(s[0], end)) s = s.reverse();
        ring = ring.concat(s.slice(1));
      }
      if (ring.length >= 4) rings.push(ring);
    }
    return rings;
  }

  const SKIP = { roof: 1, no: 1, carport: 1 };

  /* Bâtiments autour d'un point. Renvoie [{ id, ll: [[lat, lon]...], tags }].
     Pour les multipolygones, seul l'anneau extérieur le plus grand est gardé. */
  async function buildingsAround(lat, lon, radius) {
    const q = '[out:json][timeout:30];(way["building"](around:' + Math.round(radius) + ',' + lat.toFixed(7) + ',' + lon.toFixed(7) +
      ');relation["building"](around:' + Math.round(radius) + ',' + lat.toFixed(7) + ',' + lon.toFixed(7) + '););out tags geom qt;';
    const js = await overpass(q);
    const out = [];
    for (const e of js.elements || []) {
      const tags = e.tags || {};
      if (SKIP[tags.building]) continue;
      let ll = null;
      if (e.type === 'way' && e.geometry) {
        ll = e.geometry.map((g) => [g.lat, g.lon]);
      } else if (e.type === 'relation' && e.members) {
        const outer = e.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry)
          .map((m) => m.geometry.map((g) => [g.lat, g.lon]));
        const rings = joinWays(outer);
        if (rings.length) {
          // anneau de plus grande étendue
          const ar = (r) => Math.abs(FS.geo.area(r));
          rings.sort((a, b) => ar(b) - ar(a));
          ll = rings[0];
        }
      }
      if (!ll || ll.length < 4) continue;
      out.push({ id: e.type[0] + e.id, ll, tags });
    }
    return out;
  }

  FS.osm = { search, buildingsAround, heightFromTags, parseLen };
})(window.FS);
