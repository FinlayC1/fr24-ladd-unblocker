// Where do helicopters (and light aircraft) actually land? FR24 airport / a known heliport or strip (OurAirports) /
// a private spot of their own - and how often they come back to the same spot.
// usage: node test/heli.cjs <dataDir> [sets=big,wide] [class=heli]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const { loadSites, siteGrid } = require('./sites.cjs');
const [dataDir, setsArg, clsArg] = process.argv.slice(2);
const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
const G = siteGrid(loadSites(path.join(dataDir, 'oa_airports.csv')));
const want = (clsArg || 'heli').split(',');
const st = {}, add = (k, n) => { st[k] = (st[k] || 0) + (n === undefined ? 1 : n); };
const seen = new Set(); let nAc = 0;
for (const set of (setsArg || 'big,wide').split(',')) for (const { ac, pts } of aircraft(dataDir, E, { set })) {
  if (seen.has(ac.hex)) continue; seen.add(ac.hex);
  const cls = E.classify(ac); if (!want.includes(cls)) continue; nAc++;
  const legs = E.legsFromPoints(pts, { heli: cls === 'heli' }), sums = legs.map(l => E.summarizeLeg(l, null));
  const spots = [];
  for (const s of sums) {
    if (!s.ended) continue;
    const landed = s.how === 'ground' || s.how === 'touch' || (s.how === 'gap-low' && s.endAlt != null && s.endAlt < 1500);
    if (!landed) { add('end ' + s.how + ' (not a landing)'); continue; }
    add('landings');
    const ap = E.airportAt(s.endLat, s.endLon, 2.5);
    let kind;
    if (ap && ap.dist < 2.5) kind = 'airport';
    else { const n = G.near(s.endLat, s.endLon, 0.35); kind = n ? 'site ' + n.site[2] : 'private'; }
    add('at ' + kind);
    if (kind !== 'airport') {
      const again = spots.find(p => G.dist(p.lat, p.lon, s.endLat, s.endLon) < 0.4);
      add(kind === 'private' ? 'private: revisit' : 'site: revisit', again ? 1 : 0);
      if (again) again.n++; else spots.push({ lat: s.endLat, lon: s.endLon, n: 1 });
      // how far the nearest FR24 airport is
      const far = E.airportAt(s.endLat, s.endLon, 60); const d = far ? far.dist : 99;
      add('offap nearest FR24 airport ' + (d < 5 ? 'a <5km' : d < 15 ? 'b 5-15' : d < 40 ? 'c 15-40' : 'd 40+'));
      // did it start from the same place (a local flight)?
      if (G.dist(s.startLat, s.startLon, s.endLat, s.endLon) < 1) add('offap: back where it took off');
    }
  }
}
console.log('aircraft', nAc);
for (const [k, v] of Object.entries(st).sort()) console.log(k.padEnd(44), v);
