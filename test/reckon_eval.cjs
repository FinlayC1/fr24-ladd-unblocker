// Dead reckoning out of coverage, judged on real cruise: a jet heard at A (cruising) and again at B 30 min - 5 h later,
// still cruising - where would it be at B carried forward from A? Old: a great circle on A's track at A's speed. New
// (engine.reckon): a constant track, the mean of A's and B's tracks (FR24 shows the flight's track now), at the mean of
// their speeds. Errors along and across the track, and how many fall inside the tolerances the resolver uses.
// usage: node test/reckon_eval.cjs <dataDir> [days=3] [shards=05,45,85,c5]
const fs = require('fs');
const path = require('path');
const A = require('./arch.cjs');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, nDays = '3', shardArg = '05,45,85,c5'] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
const days = A.dayPlan(path.join(dataDir, 'arch')).run.slice(-(+nDays));
const D2R = Math.PI / 180, R = [], old = [];
for (const sh of shardArg.split(',')) for (const { ac, pts } of A.shardAircraft(path.join(dataDir, 'arch'), sh, days, E)) {
  if (!/airliner|bizjet|heavybiz/.test(E.classify(ac))) continue;
  const cr = pts.filter(p => !p.gnd && p.alt > 25000 && p.gs > 300 && Number.isFinite(p.trk));
  for (let i = 0; i < cr.length; i += 400) {
    const a = cr[i];
    for (const dt of [1800, 3600, 7200, 10800]) {
      const b = cr.find(p => p.t >= a.t + dt && p.t <= a.t + dt + 120); if (!b) continue;
      // (cruise all the way: no point between them below 20,000 ft)
      if (pts.some(p => p.t > a.t && p.t < b.t && (p.gnd || p.alt < 20000))) continue;
      if (process.env.REMOTE && !E.remotePath(a, b.t - a.t, b.trk, b.gs)) continue;
      if (process.env.STRAIGHT && Math.abs(((b.trk - a.trk + 540) % 360) - 180) > +process.env.STRAIGHT) continue;
      const km = (a.gs + b.gs) / 2 * 1.852 * (b.t - a.t) / 3600;
      const r = E.reckon(a, b.t - a.t, b.trk, b.gs), e = E.trackErr(r[0], r[1], b.lat, b.lon, r[2]);
      const g = E.destPoint(a.lat, a.lon, a.trk, a.gs * 1.852 * (b.t - a.t) / 3600), eo = E.dist(g[0], g[1], b.lat, b.lon);
      R.push({ dt, km, along: Math.abs(e.along), cross: Math.abs(e.cross), inTol: Math.abs(e.along) <= 30 + 0.08 * km && Math.abs(e.cross) <= 25 + 0.035 * km });
      old.push({ dt, off: eo, inTol: eo <= 25 + 0.08 * km });
    }
  }
}
const q = (xs, p) => { const s = xs.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
for (const dt of [1800, 3600, 7200, 10800]) {
  const n = R.filter(r => r.dt === dt), o = old.filter(r => r.dt === dt);
  console.log(`${dt / 60} min: ${n.length} pairs | new: along p50 ${q(n.map(r => r.along), 0.5).toFixed(0)} p95 ${q(n.map(r => r.along), 0.95).toFixed(0)} km, across p50 ${q(n.map(r => r.cross), 0.5).toFixed(0)} p95 ${q(n.map(r => r.cross), 0.95).toFixed(0)} km, in tolerance ${(100 * n.filter(r => r.inTol).length / Math.max(1, n.length)).toFixed(1)}% | old: off p50 ${q(o.map(r => r.off), 0.5).toFixed(0)} p95 ${q(o.map(r => r.off), 0.95).toFixed(0)} km, in tolerance ${(100 * o.filter(r => r.inTol).length / Math.max(1, o.length)).toFixed(1)}%`);
}
