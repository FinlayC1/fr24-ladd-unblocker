// Learns how much each piece of destination evidence counts, per situation (height band x distance band of the
// candidate): a conditional logit fitted by maximum likelihood over real flights, 2-fold cross-validated by airframe.
// usage: node test/fitlogit.cjs <dataDir> --tables=<prefix> [--sets=wide,biz] [--maxlegs=N] [--every=N] [--out=<prefix>]
//        [--lambda=0.02] [--iters=500] [--top=60]
// Writes <out>_f0.json / <out>_f1.json (each learned WITHOUT that fold's aircraft - for the replay bench) and
// <out>_all.json (everything - the table that ships).
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const args = process.argv.slice(2);
const dataDir = args.find(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const sets = opt('sets', 'wide').split(','), maxLegs = +opt('maxlegs', 6), every = +opt('every', 1), TOP = +opt('top', 60), TAILK = +opt('tail', 60);
const LAMBDA = +opt('lambda', 0.02), ITERS = +opt('iters', 500), outPrefix = opt('out', path.join(dataDir, '..', 'logit'));
const rows = JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows;
const engines = [0, 1].map(k => { const E = createRouteEngine(); E.setAirports(rows); require('./dataset.cjs').withFields(E, dataDir); E.setTables(JSON.parse(fs.readFileSync(`${opt('tables')}_f${k}.json`, 'utf8'))); if (opt('runways')) E.setRunways(JSON.parse(fs.readFileSync(opt('runways'), 'utf8'))); if (opt('rwlen')) E.setRunwayLengths(JSON.parse(fs.readFileSync(opt('rwlen'), 'utf8'))); return E; });
const { buildFleetIndex, fleetMap } = require('./fleet.cjs');
const FLEET = args.includes('--fleet') ? buildFleetIndex(dataDir, engines[0], sets) : null;
if (FLEET) console.log('fleets', FLEET.byOwner.size, 'aircraft in them', [...FLEET.byOwner.values()].reduce((a, b) => a + b.length, 0));
const FEAT = engines[0].FEAT, NF = FEAT.length, NC = +opt('ctx', 36);
const FRACS = [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92, 0.97], STEP = +opt('step', 0);
// examples: { fold, frac, variant, set, cands: [{ x: Float32Array, c: ctx }], y: index of truth or -1 }
const ex = [];
let legCounter = 0; const seenAc = new Set();
for (const set of sets) {
  for (const { ac, pts } of aircraft(dataDir, engines[0], { set })) {
    if (seenAc.has(ac.hex)) continue; seenAc.add(ac.hex);
    const fold = parseInt(ac.hex, 16) % 2, E = engines[fold];
    const cls = E.classify(ac);
    const legs = E.legsFromPoints(pts, { heli: cls === 'heli' });
    const sums = legs.map(l => E.summarizeLeg(l, null));
    const hist = E.chainLegs(E.stitchLegs(sums.map(s => Object.assign({}, s))));
    let used = 0;
    for (let li = legs.length - 1; li >= 0 && used < maxLegs; li--) {   // its latest flights: the ones with the most history before them, as in real use
      const leg = legs[li], s = sums[li];
      if (!s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf)) continue;
      if (s.tEnd - s.tStart < 480) continue;
      if ((legCounter++ % every) !== 0) continue;
      used++;
      const D = E.byId(s.to.id);
      const hs = E.histStats(hist.filter(h => h.tEnd < s.tStart - 60), s.tStart);
      const all = [leg.start].concat(leg.pts);
      // --step=N: the flight observed every N minutes of clock time (as clicking a random aircraft on the map would),
      // otherwise at fixed fractions of each flight
      const dur = s.tEnd - s.tStart, times = [];
      if (STEP) { const off = (parseInt(ac.hex, 16) % 97) / 97 * STEP * 60; for (let tt = s.tStart + 180 + off; tt < s.tEnd - 120; tt += STEP * 60) times.push(tt); }
      else for (const f of FRACS) times.push(s.tStart + f * dur);
      for (const tt of times) {
        const f = STEP ? Math.round((tt - s.tStart) / dur * 100) / 100 : FRACS[times.indexOf(tt)];
        const el = (tt - s.tStart) / 60, togo = (s.tEnd - tt) / 60;
        let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
        if (idx < 1) continue;
        const pos = Object.assign({}, all[idx]); if (pos.gnd) continue;
        for (const variant of ['full', 'late']) {
          let trail = all.slice(0, idx + 1);
          if (variant === 'late') { if (pos.t - s.tStart < 40 * 60 || (STEP && times.indexOf(tt) % 2)) continue; trail = trail.filter(p => p.t >= pos.t - 20 * 60); }
          const thin = []; for (const p of trail) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
          const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, features: true, fleet: FLEET ? fleetMap(FLEET, ac.hex, s.tStart) : null });
          if (!r || !r.all || !r.all.length) continue;
          let yi = r.all.findIndex(c => c.id === D.id || (E.byId(c.id) && E.dist(E.byId(c.id).lat, E.byId(c.id).lon, D.lat, D.lon) < 4));
          // the candidates learned from: the engine's top ones, and always the origin and every airport of the aircraft's
          // own history, plus a random sample of the rest - so no kind of candidate is left for the new weights to
          // misjudge because the old weights never ranked it high
          // Sampled softmax: the engine's top candidates, the origin, the aircraft's own airports and the truth always;
          // the rest (hundreds) by a uniform sample whose members stand in for all of them (score offset log(1/q)) -
          // so what is learned holds when the live engine weighs every candidate, not just the ones sampled.
          const oid = r.origin && r.origin.airport ? r.origin.airport.id : 0, fixed = new Set(), tail = [];
          r.all.forEach((c, i) => { if (i < TOP || c.id === oid || hs.visits.has(c.id) || i === yi) fixed.add(i); else tail.push(i); });
          let seed = (parseInt(ac.hex, 16) + Math.round(tt)) % 2147483647 || 1; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
          const K = Math.min(TAILK, tail.length), off = K ? Math.log(tail.length / K) : 0, sampled = new Set();
          for (let j = tail.length - 1; j >= tail.length - K; j--) { const k = Math.floor(rnd() * (j + 1)); [tail[j], tail[k]] = [tail[k], tail[j]]; sampled.add(tail[j]); }
          const idxs = [...fixed, ...sampled].sort((u, w) => u - w), keep = idxs.map(i => r.all[i]), offs = idxs.map(i => sampled.has(i) ? off : 0); yi = yi >= 0 ? idxs.indexOf(yi) : -1;
          const cands = keep.map((c, ci) => { const x = new Float32Array(NF); for (const k in c.fv) { const i = FEAT.indexOf(k); if (i >= 0) x[i] = c.fv[k]; } const m = k => NC >= 108 ? k : NC >= 36 ? k % 36 : k % 12; return { x, o: offs[ci], c: m(c.ctx), c2: m(c.ctx2 == null ? c.ctx : c.ctx2), f: c.cfr || 0 }; });
          ex.push({ fold, frac: f, el, togo, variant, set, cls, cands, y: yi });
        }
      }
    }
  }
  console.log('set', set, 'examples so far', ex.length);
}
console.log('examples', ex.length, 'truth among candidates', (100 * ex.filter(e => e.y >= 0).length / ex.length).toFixed(1) + '%');
// the hand-tuned weights, as the starting point and the regularisation anchor
const w0 = new Float64Array(NC * NF);
{ const E = createRouteEngine(); for (let c = 0; c < NC; c++) { const alt = [1000, 5000, 15000, 30000][Math.floor((c % 12) / 3)]; for (let i = 0; i < NF; i++) { E.setLogit(null); const d = { prior: E.W.prior, orig: 0, habit: 1, pos: E.W.xt, posL: E.W.loc, hdg: E.W.hdg, close: E.W.prog, vdesc: alt < 10000 ? E.W.vert * E.W.vlo : E.W.vert, vlvl: alt < 10000 ? E.W.vert * E.W.vlo : E.W.vert, vstep: E.W.vstep * (alt < 10000 ? E.W.vert * E.W.vlo : E.W.vert), phys: E.W.phys, appr: 1.5, low: E.W.low, cruise: E.W.cruise, cruiseL: E.W.lcr, climbf: E.W.cruise, range: 2, emerg: 4 }[FEAT[i]] || 0; w0[c * NF + i] = d / E.W.temp; } } }
// --init=<prefix>: start from (and regularise towards) an earlier learned table - the fold's own for each fold, _all
// for the shipped fit - repeated across the finer situations
const initFor = suffix => {
  if (!opt('init')) return w0;
  const t = JSON.parse(fs.readFileSync(`${opt('init')}_${suffix}.json`, 'utf8')), ix = new Map(t.feat.map((k, i) => [k, i])), n = t.w.length;
  const w = Float64Array.from(w0);
  for (let c = 0; c < NC; c++) for (let i = 0; i < NF; i++) { const j = ix.get(FEAT[i]) != null ? ix.get(FEAT[i]) : FEAT[i] === 'plen' ? ix.get('pos') : null; if (j != null) w[c * NF + i] = t.w[c % n][j]; }
  return w;
};
// --shared=a,b,..: these kinds of evidence get one weight per elapsed-time band (36 situations each) instead of one per
// situation - rare evidence (a return leg, a squawk block) then has enough examples to be learned at all
const SHARED = new Set(opt('shared', '').split(',').filter(Boolean)), SH = FEAT.map(k => SHARED.has(k));
const row = (c, i) => SH[i] ? Math.floor(c / 36) * 36 : c;
// (a candidate near a distance-band edge is scored with a blend of the two bands' weights - as the engine does)
function score(w, cd) { let s = 0; for (let i = 0; i < NF; i++) if (cd.x[i]) { const a = w[row(cd.c, i) * NF + i]; s += (cd.f ? (1 - cd.f) * a + cd.f * w[row(cd.c2, i) * NF + i] : a) * cd.x[i]; } return s; }
const scoreT = (w, cd) => score(w, cd) + (cd.o || 0);
function fit(train, anchor) {
  anchor = anchor || w0;
  const w = Float64Array.from(anchor), m = new Float64Array(w.length), v = new Float64Array(w.length);
  const b1 = 0.9, b2 = 0.999, lr = 0.03, n = train.length;
  for (let it = 1; it <= ITERS; it++) {
    const g = new Float64Array(w.length); let nll = 0;
    for (const e of train) {
      const sc = e.cands.map(cd => scoreT(w, cd)); const mx = Math.max(...sc);
      let z = 0; const p = sc.map(s => { const q = Math.exp(s - mx); z += q; return q; });
      nll -= sc[e.y] - mx - Math.log(z);
      for (let j = 0; j < e.cands.length; j++) {
        const cd = e.cands[j], coef = p[j] / z - (j === e.y ? 1 : 0); if (!coef) continue;
        for (let i = 0; i < NF; i++) if (cd.x[i]) { g[row(cd.c, i) * NF + i] += coef * cd.x[i] * (1 - cd.f); if (cd.f) g[row(cd.c2, i) * NF + i] += coef * cd.x[i] * cd.f; }
      }
    }
    for (let k = 0; k < w.length; k++) {
      const gk = g[k] / n + LAMBDA * (w[k] - anchor[k]);
      m[k] = b1 * m[k] + (1 - b1) * gk; v[k] = b2 * v[k] + (1 - b2) * gk * gk;
      w[k] -= lr * (m[k] / (1 - Math.pow(b1, it))) / (Math.sqrt(v[k] / (1 - Math.pow(b2, it))) + 1e-8);
    }
    if (it % 100 === 0 || it === 1) console.log('  iter', it, 'nll', (nll / n).toFixed(4));
  }
  return w;
}
function evaluate(w, test, label) {
  const st = {};
  const add = (k, hit1, hit3) => { const s = st[k] = st[k] || { n: 0, t1: 0, t3: 0 }; s.n++; s.t1 += hit1; s.t3 += hit3; };
  for (const e of test) {
    let h1 = 0, h3 = 0;
    if (e.y >= 0) { const sc = e.cands.map(cd => score(w, cd)); const ty = sc[e.y]; let rank = 0; for (let j = 0; j < sc.length; j++) if (j !== e.y && sc[j] > ty) rank++; h1 = rank === 0 ? 1 : 0; h3 = rank < 3 ? 1 : 0; }
    add(e.variant + ' ALL', h1, h3); add('set ' + e.set, h1, h3);
    if (e.variant === 'full') {
      add('cls ' + e.cls, h1, h3);
      if (STEP) { const eb = e.el < 15 ? 'a <15' : e.el < 45 ? 'b 15-45' : e.el < 90 ? 'c 45-90' : e.el < 180 ? 'd 90-180' : 'e 180+'; add('min since takeoff ' + eb, h1, h3); const tb = e.togo < 10 ? 'a <10' : e.togo < 30 ? 'b 10-30' : e.togo < 60 ? 'c 30-60' : e.togo < 120 ? 'd 60-120' : 'e 120+'; add('min to landing ' + tb, h1, h3); add('flight % ' + (e.frac < 0.25 ? 'a <25' : e.frac < 0.5 ? 'b 25-50' : e.frac < 0.75 ? 'c 50-75' : e.frac < 0.9 ? 'd 75-90' : 'e 90+'), h1, h3); }
      else add(e.variant + ' ' + e.frac, h1, h3);
    }
  }
  console.log('\n== ' + label);
  for (const k of Object.keys(st).sort()) { const s = st[k]; console.log('  ' + k.padEnd(18) + String(s.n).padStart(6) + '  top1 ' + (100 * s.t1 / s.n).toFixed(1).padStart(5) + '%  top3 ' + (100 * s.t3 / s.n).toFixed(1).padStart(5) + '%'); }
}
const trainable = e => e.y >= 0;
const save = (w, file) => { const out = []; for (let c = 0; c < NC; c++) out.push(FEAT.map((_, i) => +w[row(c, i) * NF + i].toFixed(4))); fs.writeFileSync(file, JSON.stringify({ feat: FEAT, w: out })); };
evaluate(w0, ex, 'hand-tuned weights (all data)');
const models = [];
for (const k of [0, 1]) {
  console.log('\nfitting without fold', k);
  if (opt('init')) evaluate(initFor('f' + k), ex.filter(e => e.fold === k), `starting table, held-out fold ${k}`);
  const w = fit(ex.filter(e => e.fold !== k && trainable(e)), initFor('f' + k));
  models[k] = w; save(w, `${outPrefix}_f${k}.json`);
}
// cross-validated: each fold scored by the model that never saw it
const cv = []; for (const e of ex) cv.push(e);
{
  const st = {};
  for (const k of [0, 1]) evaluate(models[k], ex.filter(e => e.fold === k), `held-out fold ${k}`);
}
console.log('\nfitting on everything (the shipped table)');
save(fit(ex.filter(trainable), initFor('all')), `${outPrefix}_all.json`);
console.log('written', outPrefix + '_{f0,f1,all}.json');
