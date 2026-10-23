// Pass 3: training moments for the weights (test/fit2.cjs), in parallel over the 256 hex shards.
// Flights of the last 22 days of the archive's unbroken run (so each has 3+ weeks of its aircraft's own history before
// it), both ends known; up to 3 moments per flight on the clock (as a click on the map would land), each with the
// engine's evidence for every candidate (sampled softmax: the top ones, the origin, the aircraft's own airports and the
// truth always, a uniform sample of the rest standing in for all of them).
// Every aircraft's own share of the population tables is taken out while its flights are scored (test/contrib.cjs) -
// no flight is evidence for itself. Aircraft of the evaluation fold (hash % 10 == 0) are never used.
// usage: node test/pipe_examples.cjs <dataDir> <p1Dir> <tablesPrefix> <logit.json> <outDir> [workers] [shards]
//   env: ENGINE_SRC, MOMENTS (3), DAYS (22), AIRLINER (1 flight per airliner), PER_AC (6), TOP (40), TAIL (30)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const A = require('./arch.cjs');
const { contrib } = require('./contrib.cjs');
const hexHash = hex => (parseInt(hex, 16) * 2654435761 >>> 0) % 1000003;
// (SURGE=<daily.json> from test/mksurge.cjs: the event-surge evidence each moment's day would have had - engine.surgeOf)
function surgeAt(W, E, t) {
  if (!process.env.SURGE || !E.surgeOf) return null;
  if (!W.SG) W.SG = { daily: JSON.parse(fs.readFileSync(process.env.SURGE, 'utf8')), by: new Map() };
  const d = new Date(t * 1000).toISOString().slice(0, 10); let m = W.SG.by.get(d);
  if (!m) { m = E.surgeOf(W.SG.daily, d); W.SG.by.set(d, m); }
  return m;
}
const CLS = ['bizjet', 'heavybiz', 'airliner', 'turboprop', 'piston', 'heli', 'fighter', 'milheavy', 'unknown'];

// where an aircraft's fleet-mates (same owner) went in the 60 days before t0: airport id -> visits
function fleetMapOf(F, E, hex, ownOp, t0) { if (!F) return null; const k = E.ownerKey(ownOp), mates = k && F.owners[k]; if (!mates) return null; const m = new Map(); for (const h of mates) if (h !== hex) for (const [f, t, te] of F.legs[h] || []) if (te < t0 && t0 - te < 60 * 86400) { m.set(f, (m.get(f) || 0) + 1); m.set(t, (m.get(t) || 0) + 1); } return m.size ? m : null; }
// take one aircraft's contributions out of (sign -1) or back into (+1) the tables as the engine holds them
function looApply(E, TB, T2, c, sign) {
  const a6 = (o, k, i) => { const v = o && o[k]; if (v) v[i] += sign; };
  for (const [k, g] of c.od2) a6(T2.od2, k, g);
  for (const [k, i] of c.odt) a6(T2.odt, k, i);
  for (const [k, i] of c.apd) a6(T2.apd, k, i);
  for (const [k] of c.seq) if (T2.seq[k] != null) T2.seq[k] += sign;
  for (const [cs, k] of c.csr) { const l = T2.csr[cs]; if (!l) continue; const [o, d] = k.split('>'); for (let i = 0; i + 2 < l.length; i += 3) if (l[i] === o && l[i + 1] === d) l[i + 2] += sign; }
  for (const [k, i] of c.aph) { const v = T2.aph[k]; const g = Math.floor(i / 6); if (v && v[g]) v[g][i % 6] += sign; }
  for (const [pg, x] of c.pgu) { const m = T2.pgu[pg]; if (m && m[x] != null) m[x] += sign; }
  for (const [kind, x, w] of c.usage) E.addUsage(x, sign * w, kind);
  for (const [k, w] of c.od) { const [x, y] = k.split('|'); E.odAdd(x, y, sign * w); }
  for (const [k, b] of c.sq) a6(TB.sq, k, b); for (const [k, b] of c.sqBase) a6(TB.sqBase, k, b);
  for (const [k, b] of c.fms) a6(TB.fms, k, b); for (const [k, b] of c.fmsBase) a6(TB.fmsBase, k, b);
  for (const [k, x, w] of c.flow) { const v = T2.flow[k]; if (!v) continue; v[w] += sign; for (let i = 2; i + 2 < v.length; i += 3) if (v[i] === x) { v[i + 1 + w] += sign; break; } }
  if (c.flow.length) T2.flowC.clear();
}
// growable binary writer
class Buf { constructor() { this.b = Buffer.alloc(1 << 20); this.n = 0; } need(k) { if (this.n + k > this.b.length) { const nb = Buffer.alloc(Math.max(this.b.length * 2, this.n + k)); this.b.copy(nb, 0, 0, this.n); this.b = nb; } } u8(v) { this.need(1); this.b.writeUInt8(v, this.n); this.n += 1; } u16(v) { this.need(2); this.b.writeUInt16LE(v, this.n); this.n += 2; } i16(v) { this.need(2); this.b.writeInt16LE(v, this.n); this.n += 2; } f32(v) { this.need(4); this.b.writeFloatLE(v, this.n); this.n += 4; } }

function doShard(shard, W) {
  const { createRouteEngine } = require(process.env.ENGINE_SRC || '../src/engine.js');
  const E = W.E || (W.E = (() => {
    const e = createRouteEngine();
    e.setAirports(JSON.parse(fs.readFileSync(path.join(W.dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(e, W.dataDir);
    e.setRunways(JSON.parse(fs.readFileSync(path.join(W.dataDir, 'runways.json'), 'utf8'))); e.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(W.dataDir, 'runway_len.json'), 'utf8')));
    W.TB = JSON.parse(fs.readFileSync(W.tables + '_tb.json', 'utf8')); W.T2 = JSON.parse(fs.readFileSync(W.tables + '_t2.json', 'utf8'));
    e.setTables(W.TB); e.setTables2(W.T2); e.setLogit(JSON.parse(fs.readFileSync(W.logit, 'utf8')));
    W.FLEET = fs.existsSync(W.tables + '_fleet.json') ? JSON.parse(fs.readFileSync(W.tables + '_fleet.json', 'utf8')) : null;
    return e;
  })());
  const FEAT = E.FEAT, FIX = new Map(FEAT.map((k, i) => [k, i]));
  const TOP = +(process.env.TOP || 40), TAILK = +(process.env.TAIL || 30), MOM = +(process.env.MOMENTS || 3), PER_AC = +(process.env.PER_AC || 6), AIRL = +(process.env.AIRLINER || 1), DAYS = +(process.env.DAYS || 22);
  const archDir = path.join(W.dataDir, 'arch'), plan = A.dayPlan(archDir), runDays = plan.run;
  const tFrom = Date.parse(runDays[runDays.length - 1] + 'T00:00:00Z') / 1000 - (DAYS - 1) * 86400;
  const p1 = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(W.p1Dir, 'legs', shard + '.json.gz'))).toString('utf8'));
  const out = new Buf(), meta = [];
  let nAc = 0, nFl = 0, nEx = 0;
  for (let part = 0; part < 4; part++) {
    for (const { ac, pts } of A.shardAircraft(archDir, shard, runDays, E, { parts: 4, part })) {
      if (hexHash(ac.hex) % 10 === 0 || !p1.legs[ac.hex]) continue;            // the evaluation fold
      const cls = E.classify(ac);
      const legs = E.legsFromPoints(pts, { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy' }), sums = legs.map(l => E.summarizeLeg(l, null));
      // its latest flights first, both ends known, 8 minutes or more, in the window
      const picks = [];
      for (let li = legs.length - 1; li >= 0 && picks.length < (cls === 'airliner' ? AIRL : PER_AC); li--) {
        const s = sums[li];
        if (s.tStart < tFrom || !s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 480) continue;
        picks.push(li);
      }
      if (!picks.length) continue;
      nAc++;
      // (NOLOO=1: tables built from other days - the shipped ones - hold nothing of this aircraft's flights to take out)
      const c = process.env.NOLOO ? null : contrib(E, p1.ac[ac.hex], p1.legs[ac.hex], (p1.flow || {})[ac.hex]);
      if (c) looApply(E, W.TB, W.T2, c, -1);
      try {
        const chained = E.chainLegs(E.stitchLegs(sums.map(x => Object.assign({}, x))));
        let seed = parseInt(ac.hex, 16) || 1; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
        for (const li of picks) {
          const leg = legs[li], s = sums[li], D = E.byId(s.to.id), O = E.byId(s.from.id);
          const hs = E.histStats(chained.filter(h => h.tEnd < s.tStart - 60), s.tStart), all = [leg.start].concat(leg.pts);
          const times = []; const off = rnd() * 720; for (let tt = s.tStart + 180 + off; tt < s.tEnd - 120; tt += 720) times.push(tt);
          while (times.length > MOM) times.splice(Math.floor(rnd() * times.length), 1);
          nFl++;
          for (const tt of times) {
            let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
            if (idx < 1 || all[idx].gnd) continue;
            const pos = all[idx], thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
            const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, surge: surgeAt(W, E, pos.t), features: true, fleet: fleetMapOf(W.FLEET, E, ac.hex, ac.ownOp, s.tStart) });
            if (!r || !r.all || !r.all.length) continue;
            let yi = r.all.findIndex(x => x.id === D.id || (E.byId(x.id) && E.dist(E.byId(x.id).lat, E.byId(x.id).lon, D.lat, D.lon) < 4));
            const oid = r.origin && r.origin.airport ? r.origin.airport.id : 0, fixed = new Set(), tail = [];
            r.all.forEach((x, i) => { if (i < TOP || x.id === oid || hs.visits.has(x.id) || i === yi) fixed.add(i); else tail.push(i); });
            const K = Math.min(TAILK, tail.length), offL = K ? Math.log(tail.length / K) : 0, sampled = new Set();
            for (let j = tail.length - 1; j >= tail.length - K; j--) { const k = Math.floor(rnd() * (j + 1)); [tail[j], tail[k]] = [tail[k], tail[j]]; sampled.add(tail[j]); }
            const idxs = [...fixed, ...sampled].sort((u, w) => u - w);
            yi = yi >= 0 ? idxs.indexOf(yi) : -1;
            // record: u16 n, i16 y; per candidate: u8 ctx, u8 ctx2, u8 cfr*255, f32 offset, u8 nnz, (u8 feature, f32 value) x nnz
            out.u16(idxs.length); out.i16(yi);
            for (const i of idxs) {
              const x = r.all[i], fv = Object.entries(x.fv).filter(([k, v]) => FIX.has(k) && v);
              out.u8(x.ctx); out.u8(x.ctx2 == null ? x.ctx : x.ctx2); out.u8(Math.round((x.cfr || 0) * 255)); out.f32(sampled.has(i) ? offL : 0); out.u8(fv.length);
              for (const [k, v] of fv) { out.u8(FIX.get(k)); out.f32(v); }
            }
            const tripKm = E.dist(O.lat, O.lon, D.lat, D.lon);
            meta.push([ac.hex, CLS.indexOf(cls), Math.round((pos.t - s.tStart) / 60), Math.round((s.tEnd - tt) / 60), Math.round(tripKm), D.id >= 1e7 ? 1 : 0, hs.n, ac.type]);
            nEx++;
          }
        }
      } finally { if (c) looApply(E, W.TB, W.T2, c, 1); }
    }
  }
  fs.writeFileSync(path.join(W.outDir, shard + '.bin'), out.b.subarray(0, out.n));
  fs.writeFileSync(path.join(W.outDir, shard + '.meta.json'), JSON.stringify({ feat: FEAT, meta }));
  return { nAc, nFl, nEx, bytes: out.n };
}

if (isMainThread) {
  const [dataDir, p1Dir, tables, logit, outDir, nw = '10', shardArg = 'all'] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const todo = (shardArg === 'all' ? A.SHARDS : shardArg.split(',')).filter(s => process.env.REDO || !fs.existsSync(path.join(outDir, s + '.meta.json')));
  const t0 = Date.now(); let done = 0, ac = 0, fl = 0, ex = 0, by = 0;
  const run = () => new Promise(res => {
    const w = new Worker(__filename, { workerData: { dataDir, p1Dir, tables, logit, outDir }, resourceLimits: { maxOldGenerationSizeMb: 3500 } });
    const next = () => { const s = todo.shift(); if (!s) { w.terminate(); return res(); } w.postMessage(s); };
    w.on('message', m => { done++; ac += m.nAc; fl += m.nFl; ex += m.nEx; by += m.bytes; if (done % 8 === 0 || !todo.length) console.log(new Date().toISOString().slice(11, 19), 'shards', done, 'aircraft', ac, 'flights', fl, 'moments', ex, (by / 1e6).toFixed(0) + ' MB', Math.round((Date.now() - t0) / 1000) + ' s'); next(); });
    w.on('error', e => { console.log('worker error', e); res(); });
    next();
  });
  Promise.all(Array.from({ length: Math.min(+nw, os.cpus().length) }, run)).then(() => console.log('done', done, 'shards', ac, 'aircraft', fl, 'flights', ex, 'moments'));
} else {
  const W = Object.assign({}, workerData);
  parentPort.on('message', s => { try { parentPort.postMessage(doShard(s, W)); } catch (e) { console.log('shard', s, e.stack); parentPort.postMessage({ nAc: 0, nFl: 0, nEx: 0, bytes: 0 }); } });
}
