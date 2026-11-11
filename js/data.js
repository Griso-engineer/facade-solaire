/* Bâtiments : emprises et hauteurs.

   En France, source principale : BD TOPO de l'IGN (Géoplateforme, service WFS ouvert, CORS),
   qui donne l'emprise cadastrale recalée et la hauteur mesurée de presque tous les bâtiments
   (« hauteur », sinon altitude du toit − altitude du sol, sinon nombre d'étages).
   Ailleurs, ou si l'IGN ne répond pas : OpenStreetMap (Overpass).

   Format commun : { id, ll: [[lat, lon]…] (contour extérieur), holes: [[[lat, lon]…]…] (cours),
                     props (IGN) | tags (OSM), source: 'ign' | 'osm' } */
(function (FS) {
  'use strict';
  const WFS = 'https://data.geopf.fr/wfs/ows';
  const IGN_PROPS = ['geometrie', 'hauteur', 'nombre_d_etages', 'altitude_minimale_sol', 'altitude_maximale_toit', 'altitude_minimale_toit',
    'usage_1', 'construction_legere', 'etat_de_l_objet'];

  // France métropolitaine et Corse (les DROM ne sont pas visés)
  function inFrance(lat, lon) { return lat > 41.2 && lat < 51.2 && lon > -5.3 && lon < 9.7; }

  // bbox : [sud, ouest, nord, est] en degrés
  async function ign(b) {
    const url = WFS + '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&OUTPUTFORMAT=application/json' +
      '&SRSNAME=EPSG:4326&COUNT=5000&PROPERTYNAME=' + IGN_PROPS.join(',') +
      '&BBOX=' + b.map((v) => v.toFixed(6)).join(',') + ',urn:ogc:def:crs:EPSG::4326';
    const r = await fetch(url);
    if (!r.ok) throw new Error('IGN : erreur ' + r.status);
    const js = await r.json();
    const out = [];
    for (const f of js.features || []) {
      const p = f.properties || {};
      if (p.construction_legere || (p.etat_de_l_objet && p.etat_de_l_objet !== 'En service')) continue;
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
      if (!polys.length) continue;
      // partie principale (plus grande aire) ; ses anneaux suivants sont des cours
      const toLL = (ring) => ring.map((c) => [c[1], c[0]]);
      const ar = (ring) => Math.abs(FS.geo.area(ring.map((c) => [c[0], c[1]])));
      polys.sort((a, c) => ar(c[0]) - ar(a[0]));
      const main = polys[0];
      if (!main[0] || main[0].length < 4) continue;
      out.push({
        id: 'ign:' + (f.id || '').replace(/^batiment\./, ''), ll: toLL(main[0]), holes: main.slice(1).filter((h) => h.length >= 4).map(toLL),
        props: { hauteur: p.hauteur, etages: p.nombre_d_etages, sol: p.altitude_minimale_sol, toit: p.altitude_maximale_toit || p.altitude_minimale_toit, usage: p.usage_1 },
        source: 'ign'
      });
    }
    return out;
  }

  /* Bâtiments d'une emprise. source : 'auto' (IGN en France, sinon OSM), 'ign', 'osm'.
     → { list, source } ; en cas d'échec de l'IGN, bascule sur OSM. */
  async function inBBox(b, source) {
    const lat = (b[0] + b[2]) / 2, lon = (b[1] + b[3]) / 2;
    const useIgn = source === 'ign' || (source !== 'osm' && inFrance(lat, lon));
    if (useIgn) {
      try { return { list: await ign(b), source: 'ign' }; } catch (e) { /* repli OSM */ }
    }
    return { list: await FS.osm.buildingsInBBox(b), source: 'osm' };
  }
  function around(lat, lon, radius, source) {
    const dLat = radius / 111195, dLon = radius / (111195 * Math.cos(lat * Math.PI / 180));
    return inBBox([lat - dLat, lon - dLon, lat + dLat, lon + dLon], source);
  }

  /* Hauteur d'un bâtiment. defaults : { floorH, defaultH }.
     src : 'ign' | 'ign-toit' | 'ign-etages' | 'height' | 'levels' | 'default' (| 'user', saisi ensuite) */
  function height(b, defaults) {
    if (b.source === 'ign') {
      const p = b.props || {};
      if (p.hauteur > 0) return { height: p.hauteur, src: 'ign', levels: p.etages || null };
      if (p.toit > -500 && p.sol > -500 && p.toit - p.sol > 1) return { height: p.toit - p.sol, src: 'ign-toit', levels: p.etages || null };
      if (p.etages > 0) return { height: p.etages * defaults.floorH, src: 'ign-etages', levels: p.etages };
      return { height: defaults.defaultH, src: 'default', levels: null };
    }
    return FS.osm.heightFromTags(b.tags || {}, defaults);
  }

  const SRC_LABEL = {
    ign: 'hauteur IGN (BD TOPO)', 'ign-toit': 'IGN : altitude du toit − sol', 'ign-etages': 'nombre d\'étages IGN',
    height: 'hauteur OSM', levels: 'niveaux OSM', default: 'hypothèse par défaut', user: 'saisie'
  };
  const isHyp = (src) => src === 'default';

  FS.data = { inFrance, inBBox, around, height, ign, SRC_LABEL, isHyp };
})(window.FS);
