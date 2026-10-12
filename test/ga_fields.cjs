// Where do light aircraft land? At an airport in FR24's list, or at an airfield it does not list (OurAirports small /
// medium airports, strips, seaplane bases) - which the engine cannot name as a destination.
// usage: node test/ga_fields.cjs <dataDir> <set> [cls=piston]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const [dataDir, set, clsArg] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); if (process.env.W) E.setWeights(JSON.parse(process.env.W)); if (process.env.EFIELDS) require('./dataset.cjs').withFields(E, dataDir);
// OurAirports: kind, lat, lon, ident, name
const csv = fs.readFileSync(path.join(dataDir, 'oa_airports.csv'), 'utf8').split(/\r?\n/);
const head = csv[0].split(',').map(s => s.replace(/"/g, ''));
const ix = k => head.indexOf(k);
const parse = line => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
const grid = new Map();
for (const line of csv.slice(1)) {
  if (!line) continue; const r = parse(line), type = r[ix('type')];
  if (!/small_airport|medium_airport|large_airport|seaplane_base/.test(type)) continue;
  const lat = +r[ix('latitude_deg')], lon = +r[ix('longitude_deg')]; if (!Number.isFinite(lat)) continue;
  const k = Math.floor(lat * 10) * 10000 + Math.floor(lon * 10); if (!grid.has(k)) grid.set(k, []); grid.get(k).push({ lat, lon, type, ident: r[ix('ident')], name: r[ix('name')], ctry: r[ix('iso_country')] });
}
const fieldNear = (lat, lon, km) => { let best = null, bd = km; const la = Math.floor(lat * 10), lo = Math.floor(lon * 10); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const f of grid.get((la + i) * 10000 + lo + j) || []) { const d = E.dist(lat, lon, f.lat, f.lon); if (d < bd) { bd = d; best = Object.assign({ d }, f); } } return best; };
const st = { legs: 0, fr24: 0, field: 0, neither: 0 }, byType = {}, ex = [];
for (const { ac, pts } of aircraft(dataDir, E, { set })) {
  const cls = E.classify(ac); if (!(clsArg || 'piston').split(',').includes(cls)) continue;
  for (const leg of E.legsFromPoints(pts, {})) {
    if (!leg.ended || leg.how !== 'ground' || leg.end.t - leg.start.t < 600) continue;
    st.legs++;
    const p = leg.end, a = E.airportAt(p.lat, p.lon, 3);
    if (a) { st.fr24++; continue; }
    const f = fieldNear(p.lat, p.lon, 2);
    if (f) { st.field++; byType[f.type] = (byType[f.type] || 0) + 1; if (ex.length < 30 && st.field % 7 === 1) ex.push(`${ac.reg} ${ac.type} landed at ${f.ident} ${f.name} (${f.ctry}, ${f.type}); nearest FR24 airport ${(E.airportAt(p.lat, p.lon, 60) || { airport: { code: '-' }, dist: 0 }).airport.code} ${(E.airportAt(p.lat, p.lon, 60) || { dist: 0 }).dist.toFixed(0)} km`); }
    else { st.neither++; if (process.env.NEITHER && st.neither % 25 === 1) { const f2 = fieldNear(p.lat, p.lon, 15), a2 = E.airportAt(p.lat, p.lon, 60); const prev = leg.pts[leg.pts.length - 1]; console.log('  neither:', ac.reg, ac.type, p.lat.toFixed(4), p.lon.toFixed(4), 'end alt', p.alt, 'gs', p.gs, 'prev', prev && prev.alt, prev && prev.gs, prev && new Date(prev.t*1000).toISOString().slice(11,19), new Date(p.t*1000).toISOString().slice(0,19), 'field', f2 ? f2.ident + ' ' + f2.d.toFixed(1) + 'km' : '-', 'fr24', a2 ? a2.airport.code + ' ' + a2.dist.toFixed(1) : '-'); } }
  }
}
const pc = v => (100 * v / st.legs).toFixed(1) + '%';
console.log(`${set} ${clsArg || 'piston'}: ${st.legs} landings - at an FR24-listed airport ${pc(st.fr24)}, at an airfield FR24 does not list ${pc(st.field)} ${JSON.stringify(byType)}, neither ${pc(st.neither)}`);
for (const e of ex) console.log('  ', e);
