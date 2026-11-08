/* Position du soleil : algorithme du NOAA (Meeus simplifié), réfraction de Bennett.
   Repris de Soleil Paris, converti en script classique et généralisé à tout lieu.
   Heures légales : fuseau IANA (Europe/Paris par défaut) via Intl. */
(function (FS) {
  'use strict';
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;

  // Décalage (h) du fuseau tz à l'instant UTC donné.
  const fmtCache = {};
  function tzOffsetHours(utcMs, tz) {
    tz = tz || 'Europe/Paris';
    let f = fmtCache[tz];
    if (!f) {
      try {
        f = fmtCache[tz] = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric'
        });
      } catch (e) { return 1; }
    }
    const p = {};
    for (const x of f.formatToParts(new Date(utcMs))) p[x.type] = x.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - Math.floor(utcMs / 1000) * 1000) / 360000) / 10;
  }

  // Jour de l'année (1..366) + heure légale décimale → instant UTC (ms)
  function localToUTC(year, doy, hours, tz) {
    const base = Date.UTC(year, 0, doy, 0, 0, 0) + hours * 3600e3;
    let utc = base - tzOffsetHours(base, tz) * 3600e3;
    utc = base - tzOffsetHours(utc, tz) * 3600e3; // seconde passe autour des changements d'heure
    return utc;
  }

  function doyOf(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400e3); }
  function dateOfDoy(y, doy) { return new Date(Date.UTC(y, 0, doy, 12)); }

  /* Position du soleil à l'instant utcMs.
     altitude : hauteur apparente (°, réfraction comprise) ; altTrue : géométrique ;
     azimuth : depuis le nord, sens horaire (90 = est, 180 = sud). */
  function position(utcMs, lat, lon) {
    const jd = utcMs / 86400e3 + 2440587.5;
    const T = (jd - 2451545) / 36525;
    const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const Mr = M * RAD;
    const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
    const trueLong = L0 + C;
    const nu = M + C;
    const rv = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(nu * RAD)); // distance Terre-Soleil (UA)
    const omega = 125.04 - 1934.136 * T;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
    const y = Math.tan((eps * RAD) / 2) ** 2;
    const L0r = L0 * RAD;
    const eqTime = 4 * DEG * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));

    const utcMin = ((utcMs / 60000) % 1440 + 1440) % 1440;
    const tst = utcMin + eqTime + 4 * lon;
    const ha = (tst / 4 - 180) * RAD;
    const latR = lat * RAD;
    const cosZ = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
    const zenith = Math.acos(Math.min(1, Math.max(-1, cosZ)));
    const altTrue = 90 - zenith * DEG;
    let alt = altTrue;
    if (alt > -1) alt += 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * RAD) / 60;
    const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR)) * DEG + 180 + 360) % 360;
    return { altitude: alt, altTrue, azimuth: az, zenith: 90 - alt, declination: decl * DEG, eqTime, distAU: rv };
  }

  // Vecteur unitaire vers le soleil (x est, y nord, z haut)
  function vector(p) {
    const h = p.altitude * RAD, a = p.azimuth * RAD;
    return [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)];
  }

  // Lever, coucher, midi vrai (heures légales) : bord supérieur du disque à l'horizon.
  function sunTimes(year, doy, lat, lon, tz) {
    const HOR = -0.27;
    let rise = null, set = null, noon = null, maxAlt = -90, prev = null;
    for (let m = 0; m <= 1440; m += 2) {
      const h = m / 60;
      const p = position(localToUTC(year, doy, h, tz), lat, lon);
      if (p.altitude > maxAlt) { maxAlt = p.altitude; noon = h; }
      if (prev !== null) {
        const a0 = prev - HOR, a1 = p.altitude - HOR;
        const cross = h - (2 / 60) * (a1 / (a1 - a0));
        if (a0 < 0 && a1 >= 0) rise = cross;
        if (a0 >= 0 && a1 < 0) set = cross;
      }
      prev = p.altitude;
    }
    return { rise, set, noon, maxAlt };
  }

  function fmtHour(h) {
    if (h == null) return '—';
    let m = Math.round(h * 60);
    m = ((m % 1440) + 1440) % 1440;
    return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  }

  FS.solar = { position, vector, sunTimes, localToUTC, tzOffsetHours, doyOf, dateOfDoy, fmtHour };
})(window.FS);
