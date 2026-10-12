// Coordinate-descent tuner for the engine weights. Loads the replay cases once (pos, trail, history, truth) and
// re-scores them for each weight set. Objective = mean log-probability of the true destination (a proper scoring
// rule: rewards being right AND being honest about uncertainty), reported with top-1/top-3.
// usage: node test/tune.cjs <dataDir> <tablesPrefix> [--wide] [--maxlegs=N] [--rounds=2] [--start=json] [--keys=a,b]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const args = process.argv.slice(2);
const [dataDir, prefix] = args.filter(a => !a.startsWith('--'));
const opt = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const rows = JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows;
const engines = [0, 1].map(k => { const E = createRouteEngine(); E.setAirports(rows); E.setTables(JSON.parse(fs.readFileSync(`${prefix}_f${k}.json`, 'utf8'))); return E; });
const FRACS = [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92];
const maxLegs = Number(opt('maxlegs') || 12);
const cases = [];
const t0 = Date.now();
for (const src of (args.includes('--wide') ? [false, true] : [false])) {
  for (const { ac, pts } of aircraft(dataDir, engines[0], { wide: src })) {
    const fold = parseInt(ac.hex, 16) % 2, E = engines[fold];
    const cls = E.classify(ac);
    const legs = E.legsFromPoints(pts, { heli: cls === 'heli' });
    const sums = legs.map(l => E.summarizeLeg(l, null));
    const hist = E.chainLegs(E.stitchLegs(sums.map(s => Object.assign({}, s))));
    let used = 0;
    for (let li = 0; li < legs.length && used < maxLegs; li++) {
      const leg = legs[li], s = sums[li];
      if (!s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 480) continue;
      used++;
      const D = E.byId(s.to.id), histBefore = hist.filter(h => h.tEnd < s.tStart - 60), hs = E.histStats(histBefore, s.tStart);
      const all = [leg.start].concat(leg.pts);
      for (const f of FRACS) {
        const tt = s.tStart + f * (s.tEnd - s.tStart);
        let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
        if (idx < 1 || all[idx].gnd) continue;
        const thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
        const pos = Object.assign({}, all[idx]);
        const origin = E.inferOrigin({ ac, pos, trail: thin, hs, now: pos.t });
        cases.push({ fold, E, ac, cls, pos, trail: thin, hs, origin, D, wide: src });
      }
    }
  }
}
console.log('cases', cases.length, 'loaded in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
function evaluate(w, subset) {
  const r = { n: 0, ll: 0, top1: 0, top3: 0, byCls: {} };
  for (const e of engines) e.setWeights(w);
  for (const c of subset) {
    const p = c.E.predict({ ac: c.ac, pos: c.pos, trail: c.trail, hs: c.hs, now: c.pos.t, origin: c.origin });
    const tops = p && p.cands ? p.cands : [];
    const hit = tops.findIndex(x => x.airport.id === c.D.id || c.E.dist(x.airport.lat, x.airport.lon, c.D.lat, c.D.lon) < 4);
    const ll = Math.log(Math.max(0.005, hit >= 0 ? tops[hit].p : 0));
    r.n++; r.ll += ll; if (hit === 0) r.top1++; if (hit >= 0 && hit < 3) r.top3++;
    const b = r.byCls[c.cls] = r.byCls[c.cls] || { n: 0, top1: 0, ll: 0 }; b.n++; b.ll += ll; if (hit === 0) b.top1++;
  }
  // class-balanced objective so the numerous trainers do not drown out the bizjets
  const cl = Object.values(r.byCls);
  r.obj = cl.reduce((s, b) => s + b.ll / b.n, 0) / cl.length;
  r.bal1 = cl.reduce((s, b) => s + b.top1 / b.n, 0) / cl.length;
  return r;
}
const fmt = r => `obj ${r.obj.toFixed(4)} bal-top1 ${(100 * r.bal1).toFixed(1)}% top1 ${(100 * r.top1 / r.n).toFixed(1)}% top3 ${(100 * r.top3 / r.n).toFixed(1)}% ll ${(r.ll / r.n).toFixed(3)}`;
const train = cases.filter(c => c.fold === 0), valid = cases.filter(c => c.fold === 1);
let W = Object.assign({}, engines[0].W, opt('start') ? JSON.parse(opt('start')) : {});
const keys = opt('keys') ? opt('keys').split(',') : Object.keys(W);
let best = evaluate(W, train);
console.log('start  train', fmt(best), '\n       valid', fmt(evaluate(W, valid)));
const rounds = Number(opt('rounds') || 2);
for (let round = 0; round < rounds; round++) {
  for (const k of keys) {
    const cur = W[k];
    const trials = cur === 0 ? [0.25, 0.5] : [cur * 0.5, cur * 0.75, cur * 1.33, cur * 2];
    let improved = false;
    for (const v of trials) {
      const w2 = Object.assign({}, W, { [k]: +v.toFixed(4) });
      const r = evaluate(w2, train);
      if (r.obj > best.obj + 0.0015) { best = r; W = w2; improved = true; }
    }
    console.log(`round ${round} ${k.padEnd(8)} = ${String(W[k]).padEnd(7)} ${improved ? '*' : ' '} train ${fmt(best)}`);
  }
}
const v = evaluate(W, valid);
console.log('\nbest weights', JSON.stringify(W));
console.log('train', fmt(best)); console.log('valid', fmt(v));
for (const [c, b] of Object.entries(v.byCls)) console.log('  valid', c.padEnd(10), String(b.n).padStart(5), (100 * b.top1 / b.n).toFixed(1) + '%', (b.ll / b.n).toFixed(3));
