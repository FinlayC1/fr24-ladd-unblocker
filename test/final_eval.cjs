// engine.longFinal over real flights of the archive: when it says "established on final to X", how often X is where the
// flight landed (precision), and how far out it first says so. Every 20 s of the last 45 minutes of each landed leg.
// usage: node test/final_eval.cjs <dataDir> [shards=05,45,85,c5] [days=7]
const fs = require('fs');
const path = require('path');
const A = require('./arch.cjs');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, shardArg = '05,45,85,c5', nDays = '7'] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'tables.json'), 'utf8'))); E.setLogit(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'logit.json'), 'utf8')));
// (AGREE=1: as the live script uses it - only where the prediction already has that field on top)
const AGREE = !!process.env.AGREE;
const run = A.dayPlan(path.join(dataDir, 'arch')).run.slice(-(+nDays));
let legs = 0, fired = 0, right = 0, wrongEx = [], firstOut = [];
const byCls = {};
for (const sh of shardArg.split(',')) for (const { ac, pts } of A.shardAircraft(path.join(dataDir, 'arch'), sh, run, E)) {
  const cls = E.classify(ac); if (cls === 'heli') continue;
  const ls = E.legsFromPoints(pts.map(p => Object.assign({}, p)), { cls, type: ac.type, patrol: cls === 'fighter' || cls === 'milheavy' });
  for (const l of ls) {
    const s = E.summarizeLeg(l, { cls, type: ac.type, grp: E.groupOf(cls) });
    if (!s.ended || !s.to || s.to.conf !== 'ground' || !s.to.id) continue;
    legs++;
    const lp = l.pts, tEnd = l.end.t; let first = null, wrong = null;
    for (let i = 0; i < lp.length; i++) {
      const p = lp[i]; if (p.t < tEnd - 45 * 60 || (i > 0 && p.t - lp[i - 1].t < 20 && i !== lp.length - 1)) continue;
      const tr = lp.slice(Math.max(0, i - 30), i + 1), r = cls === 'piston' ? null : E.longFinal(p, tr, { rwyOk: a => !E.rwyImpossible(a, cls, ac.type) });
      if (!r) continue;
      if (AGREE) { const pr = E.predict({ ac, pos: p, trail: lp.slice(0, i + 1), hs: E.histStats([], p.t), now: p.t }); if (!pr || !pr.cands.length || pr.cands[0].airport.id !== r.airport.id) continue; }
      if (r.airport.id === s.to.id) { if (!first) first = r; } else { wrong = { got: r.airport.code || r.airport.icao, real: s.to.code, out: Math.round(r.out), alt: p.alt, reg: ac.reg || ac.hex }; break; }
    }
    const b = byCls[cls] = byCls[cls] || { legs: 0, fired: 0, right: 0 }; b.legs++;
    if (wrong) { fired++; b.fired++; if (wrongEx.length < 25) wrongEx.push(wrong); }
    else if (first) { fired++; right++; b.fired++; b.right++; firstOut.push(first.out); }
  }
}
firstOut.sort((a, b) => a - b);
console.log(`landed legs ${legs}: long final said for ${fired} (${(100 * fired / legs).toFixed(1)}%), right ${right} = ${(100 * right / Math.max(1, fired)).toFixed(2)}% precision; first said a median ${firstOut.length ? firstOut[firstOut.length >> 1].toFixed(1) : '-'} km out (90th pct ${firstOut.length ? firstOut[Math.floor(firstOut.length * 0.9)].toFixed(1) : '-'} km)`);
for (const [c, b] of Object.entries(byCls)) console.log(`  ${c.padEnd(10)} legs ${b.legs}, said ${b.fired}, right ${(100 * b.right / Math.max(1, b.fired)).toFixed(1)}%`);
console.log('wrong:', wrongEx.map(w => `${w.reg} ${w.got}≠${w.real} ${w.out}km ${w.alt}ft`).join(' | '));
