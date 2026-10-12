// Replay bench: scores origin/destination inference against real flights reconstructed from adsb.lol traces.
// usage: node test/replay.cjs <dataDir> [--wide | --sets=wide,biz] [--tables=<prefix>] [--logit=<prefix>] [--runways=f] [--maxlegs=N] [--only=hex,..] [--dump=f.json]
//        [--weights=json] [--noold] [--summary] [--every=N]
// --tables=<prefix>: loads <prefix>_f0.json / <prefix>_f1.json; aircraft of fold k are scored with the tables learned
// WITHOUT them (2-fold cross-validation by airframe), so nothing is tested on data it was learned from.
// For every completed leg with a confidently known origin and destination (seen on/near the ground at both ends),
// the flight is "paused" at several points and the engine sees only what existed at that moment: the track so far,
// the aircraft's history before the leg, and the aircraft identity.
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const makeV21 = require('./baseline_v21.cjs');
const args = process.argv.slice(2);
const dataDir = args.find(a => !a.startsWith('--'));
const opt = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const flag = k => args.includes('--' + k);
const only = opt('only') ? opt('only').split(',') : null;
const maxLegs = Number(opt('maxlegs') || 40), every = Number(opt('every') || 1);
const rows = JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows;
const engines = [0, 1].map(k => {
  const E = createRouteEngine(); E.setAirports(rows);
  if (opt('tables')) E.setTables(JSON.parse(fs.readFileSync(`${opt('tables')}_f${k}.json`, 'utf8')));
  if (opt('weights')) E.setWeights(JSON.parse(opt('weights')));
  if (opt('logit')) E.setLogit(JSON.parse(fs.readFileSync(`${opt('logit')}_f${k}.json`, 'utf8')));
  if (opt('runways')) E.setRunways(JSON.parse(fs.readFileSync(opt('runways'), 'utf8')));
  return E;
});
const E0 = engines[0];
const V21 = flag('noold') ? null : makeV21(rows);
const FRACS = [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92, 0.97];
const same = (a, b) => a && b && (a.id === b.id || E0.dist(a.lat, a.lon, b.lat, b.lon) < 4);
const stats = {};
const bump = (k, f, v) => { const s = stats[k] = stats[k] || {}; const b = s[f] = s[f] || { n: 0, top1: 0, top3: 0, ll: 0, old1: 0, old3: 0, orig: 0, origOld: 0, origKnown: 0, conf: 0, confOk: 0 }; for (const [kk, vv] of Object.entries(v)) b[kk] += vv; };
const fails = [];
let legsUsed = 0, aircraftUsed = 0, msTotal = 0, calls = 0, legCounter = 0;
const sets = opt('sets') ? opt('sets').split(',') : [flag('wide') ? 'wide' : 'narrow'];
for (const set of sets) for (const { ac, pts } of aircraft(dataDir, E0, { set, filter: a => !only || only.includes(a.hex) })) {
  const fold = parseInt(ac.hex, 16) % 2, E = engines[fold];
  const cls = E.classify(ac);
  const legs = E.legsFromPoints(pts, { heli: cls === 'heli' });
  const sums = legs.map(l => E.summarizeLeg(l, null));
  const hist = E.chainLegs(E.stitchLegs(sums.map(s => Object.assign({}, s))));
  let usedHere = 0;
  for (let li = 0; li < legs.length; li++) {
    const leg = legs[li], s = sums[li];
    if (!s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf)) continue;
    if (s.tEnd - s.tStart < 480) continue;
    if (usedHere >= maxLegs) break;
    if ((legCounter++ % every) !== 0) continue;
    const O = E.byId(s.from.id), D = E.byId(s.to.id);
    const histBefore = hist.filter(h => h.tEnd < s.tStart - 60);
    const oldLegs = V21 ? histBefore.map(h => ({ tStart: h.tStart, tEnd: h.tEnd, from: h.from ? E.byId(h.from.id) : null, to: h.to ? E.byId(h.to.id) : null })) : null;
    const all = [leg.start].concat(leg.pts);
    usedHere++; legsUsed++;
    const hs = E.histStats(histBefore, s.tStart);
    for (const f of FRACS) {
      const tt = s.tStart + f * (s.tEnd - s.tStart);
      let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
      if (idx < 1) continue;
      const pos = Object.assign({}, all[idx]); if (pos.gnd) continue;
      for (const variant of ['full', 'late']) {
        let trail = all.slice(0, idx + 1);
        if (variant === 'late') { if (pos.t - s.tStart < 40 * 60) continue; trail = trail.filter(p => p.t >= pos.t - 20 * 60); }
        const thin = []; for (const p of trail) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
        const t1 = Date.now();
        const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, explain: !!opt('dump'), explainIds: [D.id] });
        msTotal += Date.now() - t1; calls++;
        const tops = r && r.cands ? r.cands.map(c => c.airport) : [];
        const hit = tops.findIndex(a => same(a, D));
        const pTruth = hit >= 0 ? r.cands[hit].p : 0;
        const old = V21 ? V21.run({ pos, trail: thin, legs: oldLegs, type: ac.type, nowS: pos.t }) : null;
        const oldTop = old ? old.tops.map(id => E.byId(id)).filter(Boolean) : [];
        const conf = r && r.cands[0] && r.cands[0].p >= 0.6 ? 1 : 0;
        const v = { n: 1, top1: hit === 0 ? 1 : 0, top3: hit >= 0 && hit < 3 ? 1 : 0, ll: Math.log(Math.max(0.005, pTruth)), old1: old && same(old.dest && E.byId(old.dest.id), D) ? 1 : 0, old3: oldTop.slice(0, 3).some(a => same(a, D)) ? 1 : 0, orig: r && r.origin && same(r.origin.airport, O) ? 1 : 0, origOld: old && old.origin && same(E.byId(old.origin.id), O) ? 1 : 0, origKnown: r && r.origin && r.origin.airport ? 1 : 0, conf, confOk: conf && hit === 0 ? 1 : 0 };
        const key = variant + (ac.mil ? '/mil' : '/civ');
        bump(key, String(f), v); bump(variant + '/all', 'ALL', v); bump(key, 'ALL', v); bump('set/' + variant, set + ' ALL', v); bump('set/' + variant, set + ' ' + f, v);
        if (variant === 'full') bump('class', cls, v);
        // situations worth watching on their own: just stepped up to a higher level (long way to go), climbing, descending
        { const stepped = r && r.phase === 'level' && E.isStepClimb(thin, pos); bump('situation', stepped ? 'stepped' : (r && r.phase) || 'none', v); }
        if (hit !== 0 && opt('dump')) {
          const ex = r && r.explained && r.explained[0];
          fails.push({ set, hex: ac.hex, reg: ac.reg, type: ac.type, cls, mil: ac.mil, variant, f, at: new Date(pos.t * 1000).toISOString().slice(0, 16), pos: { lat: +pos.lat.toFixed(3), lon: +pos.lon.toFixed(3), alt: pos.alt, trk: pos.trk, gs: pos.gs, vr: pos.vr, mcp: pos.mcp }, truth: O.code + '>' + D.code, origin: r && r.origin && r.origin.airport ? r.origin.airport.code + '(' + r.origin.conf + ')' : '?', phase: r && r.phase, retP: r && +r.retP.toFixed(2), got: tops.slice(0, 4).map((a, i) => a.code + ':' + (r.cands[i].p * 100).toFixed(0) + '%'), top: r && r.cands[0] ? { code: r.cands[0].airport.code, s: +r.cands[0].score.toFixed(2), t: r.cands[0].terms } : null, truthEx: ex ? { rank: ex.rank, s: +ex.score.toFixed(2), t: ex.terms } : null, dTruth: Math.round(E.dist(pos.lat, pos.lon, D.lat, D.lon)), rankTruth: hit, old: old && old.dest ? (old.dest.iata || old.dest.icao) : '-' });
        }
      }
    }
  }
  if (usedHere) aircraftUsed++;
}
const pct = (a, n) => n ? (100 * a / n).toFixed(1).padStart(5) + '%' : '   - ';
console.log(`aircraft ${aircraftUsed}, legs ${legsUsed}, predictions ${calls}, avg ${(msTotal / Math.max(1, calls)).toFixed(2)} ms/prediction`);
const line = (label, b) => `  ${label.padEnd(9)} ${String(b.n).padStart(5)}  ${pct(b.top1, b.n)} ${pct(b.top3, b.n)} ${(b.ll / b.n).toFixed(2).padStart(6)} | ${pct(b.old1, b.n)} ${pct(b.old3, b.n)} | ${pct(b.orig, b.n)} ${pct(b.origOld, b.n)} ${pct(b.origKnown, b.n)} | ${pct(b.conf, b.n)} ${pct(b.confOk, b.conf)}`;
const hdr = '  bucket        n    NEW top1  top3  logP  | OLD top1  top3  | origin NEW  OLD  known | >=60%  right';
for (const k of Object.keys(stats).sort()) {
  if (flag('summary') && !/all$|^class$/.test(k)) continue;
  console.log('\n== ' + k); console.log(hdr);
  for (const f of Object.keys(stats[k]).sort()) console.log(line(f, stats[k][f]));
}
if (opt('dump')) { fs.writeFileSync(opt('dump'), JSON.stringify(fails, null, 1)); console.log('\nfailures dumped', fails.length); }
