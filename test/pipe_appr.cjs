// Arrival paths, learned: for every ~5 km cell of the sky below 10,000 ft (1,000 ft bands, 16 track directions), how
// many aircraft passed through it and where those that landed within the next 45 minutes landed. Standard arrival
// routes, radar vectors, base turns and descent profiles - and the busy airspace between neighbouring airports - are in
// the data: a cell where 98% of the traffic lands at one airport is that airport's arrival path. Over the archive days,
// all 256 hex shards in parallel (each worker sends back its shard as packed numbers; the merge is a typed hash table -
// tens of millions of cells), the merged table keeping the cells with one clearly dominant airport.
// usage: node test/pipe_appr.cjs <dataDir> <out.json> [days=21] [workers=8]
//   FOLD=n: the aircraft of that tenth left out (test/appr_eval.cjs judges the table on them); SHARDS=a,b: some shards only
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const A = require('./arch.cjs');

// (v3: descent state, 2,000 ft bands above 10,000 ft to FL240, light aircraft - the cell numbering is the engine's apprKey)
const BIN = { lat: 0.05, top: +(process.env.APPR_TOP || 24000), v: 3 };
const ARR_KM = +(process.env.ARR_KM || 250);
// the cell of a point as one number: latitude / longitude steps of ~5.5 km, 1,000 ft bands, 16 track sectors, and the
// aircraft group (the engine's apprGroup: 0 airliners, 1 business jets and turboprops)
const { createRouteEngine: CRE } = require(process.env.ENGINE_SRC || '../src/engine.js'), KE = CRE();
const apprGroup = KE.apprGroup;
// (q: a fix 10 s or more before p, for its descent rate when it reported none)
const binOf = (p, g, q) => KE.apprKey(p, g, BIN, q);
function doShard(shard, dataDir, days) {
  const { createRouteEngine } = require(process.env.ENGINE_SRC || '../src/engine.js');
  const E = createRouteEngine();
  E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
  require('./dataset.cjs').withFields(E, dataDir);
  if (fs.existsSync(path.join(dataDir, 'runways.json'))) E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8')));
  const tot = new Map(), arr = new Map();   // cell -> flights; cell * 1e5-ish pair key -> arrivals (dest, cell)
  const fold = process.env.FOLD != null ? +process.env.FOLD : -1, hexHash = h => (parseInt(h, 16) * 2654435761 >>> 0) % 1000003;
  for (const { ac, pts } of A.shardAircraft(path.join(dataDir, 'arch'), shard, days, E)) {
    if (fold >= 0 && hexHash(ac.hex) % 10 === fold) continue;
    const cls = E.classify(ac), g = apprGroup(cls);
    if (g < 0) continue;
    let legs; try { legs = E.legsFromPoints(pts.map(p => Object.assign({}, p)), { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', cls, type: ac.type, rangeKm: E.typeRangeKm(ac) }); } catch (e) { continue; }
    for (const l of legs) {
      let s; try { s = E.summarizeLeg(l, { cls, type: ac.type, grp: E.groupOf(cls), mil: ac.mil }); } catch (e) { continue; }
      // (a landing seen - on the ground or low at an airport or a field - or the flight seen going on for 45 minutes and
      // more: counted; lost from view within 45 minutes without a landing seen - most often landing below coverage -
      // unknown, left out of the count either way)
      const landed = s.ended && s.to && ['ground', 'low'].includes(s.to.conf);
      const D = landed && s.to.id < 1e7 ? E.byId(s.to.id) : null;
      const tEnd = l.end.t, seen = new Set(), seenArr = new Set();
      let qi = 0;
      for (let pi = 0; pi < l.pts.length; pi++) {
        const p = l.pts[pi];
        while (qi + 1 < pi && p.t - l.pts[qi + 1].t >= 10) qi++;
        if (p.gnd || p.alt == null || p.alt < 0 || p.alt >= BIN.top || p.trk == null || !isFinite(p.lat)) continue;
        if (!landed && tEnd - p.t <= 2700) continue;
        const q = qi < pi && p.t - l.pts[qi].t >= 10 && p.t - l.pts[qi].t <= 120 ? l.pts[qi] : null;
        const k = binOf(p, g, q); if (k == null) continue;
        if (!seen.has(k)) { seen.add(k); tot.set(k, (tot.get(k) || 0) + 1); }
        if (D && tEnd - p.t <= 2700 && !seenArr.has(k) && E.dist(p.lat, p.lon, D.lat, D.lon) <= ARR_KM) {
          seenArr.add(k); let m = arr.get(k); if (!m) arr.set(k, m = new Map()); m.set(D.id, (m.get(D.id) || 0) + 1);
        }
      }
    }
  }
  // packed: [cell, flights] pairs and [cell, airport, arrivals] triples
  const T = new Float64Array(tot.size * 2); let i = 0; for (const [k, n] of tot) { T[i++] = k; T[i++] = n; }
  let na = 0; for (const m of arr.values()) na += m.size;
  const R = new Float64Array(na * 3); i = 0; for (const [k, m] of arr) for (const [d, n] of m) { R[i++] = k; R[i++] = d; R[i++] = n; }
  return { T, R };
}
// open-addressing table: cell -> flights, and the three airports with most arrivals in it (a fourth one takes from all
// three - the counts of a cell whose traffic is split four ways no longer matter here)
function makeTable(bits) {
  const N = 1 << bits, mask = N - 1, keys = new Float64Array(N).fill(-1), tot = new Uint32Array(N), d = new Uint32Array(N * 3), c = new Uint32Array(N * 3);
  let used = 0;
  const slot = k => { let h = (Math.imul((k % 2147483647) | 0, 2654435761) ^ Math.floor(k / 2147483647)) & mask; while (keys[h] !== -1 && keys[h] !== k) h = (h + 1) & mask; if (keys[h] === -1) { keys[h] = k; used++; if (used > N * 0.85) throw new Error('table full'); } return h; };
  return {
    N, keys, tot, d, c, get used() { return used; },
    addTot(k, n) { tot[slot(k)] += n; },
    addArr(k, ap, n) {
      const h = slot(k), b = h * 3;
      for (let j = 0; j < 3; j++) if (d[b + j] === ap) { c[b + j] += n; return; }
      for (let j = 0; j < 3; j++) if (!c[b + j]) { d[b + j] = ap; c[b + j] = n; return; }
      let m = Math.min(c[b], c[b + 1], c[b + 2], n);
      for (let j = 0; j < 3; j++) c[b + j] -= m;
      if (n > m) for (let j = 0; j < 3; j++) if (!c[b + j]) { d[b + j] = ap; c[b + j] = n - m; return; }
    }
  };
}
if (!isMainThread) {
  const { shards, dataDir, days } = workerData;
  for (const sh of shards) { const r = doShard(sh, dataDir, days); parentPort.postMessage({ sh, T: r.T, R: r.R }, [r.T.buffer, r.R.buffer]); }
} else if (require.main === module) {
  const [dataDir, outFile, nDays = '21', nW = '8'] = process.argv.slice(2);
  const days = A.dayPlan(path.join(dataDir, 'arch')).run.slice(-(+nDays));
  console.log('days', days[0], '..', days[days.length - 1], days.length);
  const shards = process.env.SHARDS ? process.env.SHARDS.split(',') : A.SHARDS;
  const W = +nW, groups = Array.from({ length: W }, (_, i) => shards.filter((_, k) => k % W === i));
  const tb = makeTable(+(process.env.TABLE_BITS || 25)); let done = 0; const t0 = Date.now();
  Promise.all(groups.map(g => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { shards: g, dataDir, days } });
    w.on('message', ({ T, R }) => {
      for (let i = 0; i < T.length; i += 2) tb.addTot(T[i], T[i + 1]);
      for (let i = 0; i < R.length; i += 3) tb.addArr(R[i], R[i + 1], R[i + 2]);
      if (++done % 16 === 0) console.log(`${done}/${shards.length} shards, ${tb.used} cells, ${Math.round((Date.now() - t0) / 1000)} s`);
    });
    w.on('error', rej); w.on('exit', res);
  }))).then(() => {
    // kept: cells passed by 12 flights and more with one airport taking 90% and more of them
    const out = {}; let kept = 0, strong = 0;
    for (let h = 0; h < tb.N; h++) {
      if (tb.keys[h] === -1) continue;
      const n = tb.tot[h]; if (n < 12) continue;
      const b = h * 3; let j = 0; if (tb.c[b + 1] > tb.c[b + j]) j = 1; if (tb.c[b + 2] > tb.c[b + j]) j = 2;
      const bd = tb.c[b + j]; if (!bd || bd / n < 0.9) continue;
      out[tb.keys[h]] = [tb.d[b + j], bd, n]; kept++; if (bd / n >= 0.98) strong++;
    }
    fs.writeFileSync(outFile, JSON.stringify({ v: 2, bin: BIN, days: days.length, from: days[0], to: days[days.length - 1], cells: out }));
    console.log(`cells ${tb.used}, kept ${kept} (98%+: ${strong}) -> ${outFile}, ${Math.round(fs.statSync(outFile).size / 1024)} KB, ${Math.round((Date.now() - t0) / 1000)} s`);
  }).catch(e => { console.error(e); process.exit(1); });
}
module.exports = { binOf, BIN, apprGroup };
