// How far out of their way real flights fly: (distance from the departure airport + distance still to go) / the direct
// distance, for the TRUE destination, at clock-time samples of real legs (>600 km trips, >300 km out). Calibrates the
// engine's detour rule: a destination needing more than real flights ever do is not where the aircraft is going.
// usage: node test/detour_stats.cjs <dataDir> [sets=wide,biz,big] [every=3]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const [dataDir, setsArg, everyArg] = process.argv.slice(2);
const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
const every = +(everyArg || 3); let lc = 0;
const ratios = [], byGrp = {}, offs = [];
for (const set of (setsArg || 'wide,biz,big').split(',')) for (const { ac, pts } of aircraft(dataDir, E, { set })) {
  const cls = E.classify(ac), grp = E.groupOf(cls);
  if (grp === 'heli') continue;
  const legs = E.legsFromPoints(pts, {}), sums = legs.map(l => E.summarizeLeg(l, null));
  for (let li = 0; li < legs.length; li++) {
    const s = sums[li];
    if (!s.from || !s.to || s.from.id === s.to.id || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf)) continue;
    if ((lc++ % every) !== 0) continue;
    const O = E.byId(s.from.id), D = E.byId(s.to.id), dOA = E.dist(O.lat, O.lon, D.lat, D.lon);
    if (dOA < 600) continue;
    const all = [legs[li].start].concat(legs[li].pts);
    for (let tt = s.tStart + 600; tt < s.tEnd - 300; tt += 720) {
      let p = null; for (const q of all) { if (q.t <= tt) p = q; else break; }
      if (!p || p.gnd) continue;
      const dOP = E.dist(O.lat, O.lon, p.lat, p.lon); if (dOP < 300) continue;
      const d = E.dist(p.lat, p.lon, D.lat, D.lon), r = (dOP + d) / dOA;
      ratios.push(r); (byGrp[grp] = byGrp[grp] || []).push(r);
      if (Number.isFinite(p.trk) && d > 300) offs.push({ r, off: E.angDiff(p.trk, E.brg(p.lat, p.lon, D.lat, D.lon)) });
    }
  }
}
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const show = (name, a) => console.log(name.padEnd(10), 'n', String(a.length).padStart(6), ' p50', pct(a, 0.5).toFixed(3), ' p90', pct(a, 0.9).toFixed(3), ' p99', pct(a, 0.99).toFixed(3), ' p99.9', pct(a, 0.999).toFixed(3), ' >1.2', (100 * a.filter(x => x > 1.2).length / a.length).toFixed(2) + '%', ' >1.3', (100 * a.filter(x => x > 1.3).length / a.length).toFixed(2) + '%');
show('all', ratios);
for (const [g, a] of Object.entries(byGrp)) show(g, a);
const far = offs.filter(x => x.off > 60);
console.log('true destination more than 60 deg off the track (300 km+ to go):', (100 * far.length / offs.length).toFixed(2) + '%', 'of', offs.length, '; of those, ratio > 1.2:', far.filter(x => x.r > 1.2).length);
