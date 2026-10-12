// OurAirports landing sites (heliports, airstrips, seaplane bases) - loader shared by the helicopter tests and the
// build: parses airports.csv into compact rows [lat, lon, kind, name, ident, municipality, elevFt, iso].
const fs = require('fs');
function parseCsvLine(s) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
const KIND = { heliport: 'H', small_airport: 'S', seaplane_base: 'W', medium_airport: 'M', large_airport: 'L', balloonport: 'B' };
function loadSites(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/), head = parseCsvLine(lines[0]);
  const ix = k => head.indexOf(k), out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = parseCsvLine(lines[i]), kind = KIND[r[ix('type')]]; if (!kind) continue;
    const lat = +r[ix('latitude_deg')], lon = +r[ix('longitude_deg')]; if (!isFinite(lat) || !isFinite(lon)) continue;
    out.push([Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, kind, r[ix('name')], r[ix('icao_code')] || r[ix('gps_code')] || r[ix('ident')], r[ix('municipality')], +r[ix('elevation_ft')] || 0, r[ix('iso_country')]]);
  }
  return out;
}
function siteGrid(rows) {
  const g = new Map();
  for (const r of rows) { const k = Math.floor(r[0] * 20) * 10000 + Math.floor(r[1] * 20); let c = g.get(k); if (!c) g.set(k, c = []); c.push(r); }
  const R = 6371, rad = Math.PI / 180;
  const dist = (a, b, c, d) => { const x = Math.sin((c - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  return {
    near(lat, lon, km, kinds) {
      let best = null, bd = km; const la = Math.floor(lat * 20), lo = Math.floor(lon * 20), n = Math.ceil(km / 5) + 1;
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const c = g.get((la + i) * 10000 + lo + j); if (!c) continue; for (const r of c) { if (kinds && !kinds.includes(r[2])) continue; const d = dist(lat, lon, r[0], r[1]); if (d < bd) { bd = d; best = r; } } }
      return best ? { site: best, dist: bd } : null;
    }, dist
  };
}
module.exports = { loadSites, siteGrid, parseCsvLine };
