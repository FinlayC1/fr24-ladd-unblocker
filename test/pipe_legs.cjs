// Pass 1 over the archives: every aircraft's flights, and what the whole population does - in parallel over the 256
// hex shards. Writes <out>/legs/<xx>.json.gz (per aircraft: identity + every flight, compact) and <out>/agg/<xx>.json
// (per-type performance samples and the flow field: where aircraft at a place, heading and height end up).
// usage: node test/pipe_legs.cjs <dataDir> <outDir> [workers=8] [shards=all|00,01,..]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const A = require('./arch.cjs');
const TA = require('./tblacc.cjs');

// ---- per aircraft ----------------------------------------------------------------------------------------------------
// A flight, compact: [tStart, tEnd, fromId, toId, fromConf, toConf, maxAlt, pathKm, cs, how, laps, ended, stats,
//   squawk code blocks seen (first two digits, informative codes only), FMS-selected levels (/2000 ft)]
// stats (flights with both ends known on the ground or low): { cz: cruise level, tas, gs (at cruise), clb (ft/min over
// the first 10 min airborne), tod (km to go when the descent from cruise began), des (ft/min in the descent), dur }
const CONF = { ground: 1, low: 2, near: 3, chain: 4 };
function flightStats(E, leg, s) {
  const pts = leg.pts; if (!pts.length) return null;
  const O = s.from && E.byId(s.from.id), D = s.to && E.byId(s.to.id);
  const maxAlt = s.maxAlt || 0, cz = maxAlt;
  const cruise = pts.filter(p => p.alt != null && p.alt >= maxAlt - 1000 && maxAlt > 3000);
  const med = a => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  const tas = med(cruise.map(p => p.tas).filter(v => v > 40)), gs = med(cruise.map(p => p.gs).filter(v => v > 40));
  const ws = med(cruise.map(p => p.ws).filter(v => v >= 0));
  let clb = null; { const a = pts[0], b = pts.find(p => p.t - a.t >= 600); if (a && b && a.alt != null && b.alt != null) clb = Math.round((b.alt - a.alt) / ((b.t - a.t) / 60)); }
  let tod = null, des = null;
  if (D && cruise.length && maxAlt > 8000) {
    const lastCruise = cruise[cruise.length - 1], end = pts[pts.length - 1];
    tod = Math.round(E.dist(lastCruise.lat, lastCruise.lon, D.lat, D.lon));
    if (end.alt != null || end.gnd) { const dt = (end.t - lastCruise.t) / 60; if (dt > 2) des = Math.round(((end.alt || D.alt || 0) - lastCruise.alt) / dt); }
  }
  return { cz, tas, gs, ws, clb, tod, des, dur: Math.round((s.tEnd - s.tStart) / 60), km: O && D ? Math.round(E.dist(O.lat, O.lon, D.lat, D.lon)) : null };
}
// The flow field: along each flight with a known destination, a sample every 5 minutes at 8,000 ft or more -
// [1-degree cell, heading octant, height band (below / above FL200)] -> destination
// (every 10 minutes; airline flights one in four - two months of all traffic would otherwise be hundreds of millions of
// samples, and airliners' flow is used for airliners only)
function flowSamples(E, leg, s, out, cls) {
  if (!s.to || !['ground', 'low'].includes(s.to.conf) || !s.from || s.from.id === s.to.id) return;
  if (cls === 'airliner' && Math.floor(s.tStart / 60) % 4 !== 0) return;
  let last = -1e9;
  for (const p of leg.pts) {
    if (p.alt == null || p.alt < 8000 || p.trk == null || p.t - last < 600) continue;
    last = p.t;
    const D = E.byId(s.to.id); if (!D) return;
    if (E.dist(p.lat, p.lon, D.lat, D.lon) < 40) continue;          // (close in: the approach, not the flow)
    const k = (Math.floor(p.lat) + 90) * 360 + (Math.floor(p.lon) + 180) + ',' + (Math.floor(((p.trk + 22.5) % 360) / 45)) + ',' + (p.alt >= 20000 ? 1 : 0);
    out.push([k, s.to.id]);
  }
}
function doShard(shard, dataDir, outDir) {
  const { createRouteEngine } = require(process.env.ENGINE_SRC || '../src/engine.js');
  const E = createRouteEngine();
  E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
  require('./dataset.cjs').withFields(E, dataDir);
  if (fs.existsSync(path.join(dataDir, 'runways.json'))) E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8')));
  const archDir = path.join(dataDir, 'arch'), days = A.listDays(archDir);
  const acs = {}, legsOut = {}, flowOut = {}, perf = {}, tacc = TA.newAcc(), rnd = TA.mulberry(parseInt(shard, 16) + 1);
  let nAc = 0, nLegs = 0;
  for (let part = 0; part < 4; part++) {
    for (const { ac, pts, nDays } of A.shardAircraft(archDir, shard, days, E, { parts: 4, part })) {
      const cls = E.classify(ac);
      const legs = E.legsFromPoints(pts, { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy' });
      const recs = [];
      const fl = [], sums = legs.map(l => E.summarizeLeg(l, null));
      TA.accumulate(E, tacc, ac, legs, sums, rnd);
      for (let li = 0; li < legs.length; li++) {
        const leg = legs[li], s = sums[li];
        const both = s.from && s.to && ['ground', 'low'].includes(s.from.conf) && ['ground', 'low'].includes(s.to.conf);
        const st = both ? flightStats(E, leg, s) : null;
        if (both) flowSamples(E, leg, s, fl, cls);
        const sqs = new Set(), fmss = new Set();
        if (both) for (const p of leg.pts) { if (p.alt > 1500 && p.sq && /^[0-7]{4}$/.test(p.sq) && !E.SQ_NOINFO.test(p.sq)) sqs.add(p.sq.slice(0, 2)); if (p.fms > 5000 && !(p.vr < -500)) fmss.add(Math.round(p.fms / 2000)); }
        recs.push([s.tStart, s.tEnd, s.from ? s.from.id : 0, s.to ? s.to.id : 0, s.from ? CONF[s.from.conf] || 0 : 0, s.to ? CONF[s.to.conf] || 0 : 0, s.maxAlt || 0, s.pathKm || 0, s.cs || '', s.how || '', s.laps || 0, s.ended ? 1 : 0, st, [...sqs], [...fmss]]);
        if (st && ac.type && s.from.id !== s.to.id) {
          const P = perf[ac.type] = perf[ac.type] || { n: 0, cz: [], tas: [], gs: [], clb: [], tod: [], des: [], dur: [], km: [] };
          P.n++;
          if (P.cz.length < 400) { P.cz.push([st.km, st.cz]); if (st.tas) P.tas.push([st.cz, st.tas]); if (st.gs) P.gs.push([st.cz, st.gs, st.ws || 0]); if (st.clb != null) P.clb.push(st.clb); if (st.tod != null) P.tod.push([st.cz, st.tod]); if (st.des != null) P.des.push(st.des); P.dur.push([st.km, st.dur]); }
        }
      }
      if (fl.length) flowOut[ac.hex] = fl;
      acs[ac.hex] = [ac.reg, ac.type, (ac.mil ? 1 : 0) | (ac.ladd ? 8 : 0) | (ac.pia ? 4 : 0), ac.cat, ac.country, ac.year, ac.ownOp, nDays, cls];
      legsOut[ac.hex] = recs; nAc++; nLegs += recs.length;
    }
  }
  fs.writeFileSync(path.join(outDir, 'legs', shard + '.json.gz'), zlib.gzipSync(JSON.stringify({ ac: acs, legs: legsOut, flow: flowOut })));
  fs.writeFileSync(path.join(outDir, 'agg', shard + '.json'), JSON.stringify({ perf, tacc }));
  return { nAc, nLegs };
}

if (isMainThread) {
  const [dataDir, outDir, nw = '8', shardArg = 'all'] = process.argv.slice(2);
  fs.mkdirSync(path.join(outDir, 'legs'), { recursive: true }); fs.mkdirSync(path.join(outDir, 'agg'), { recursive: true });
  const todo = (shardArg === 'all' ? A.SHARDS : shardArg.split(',')).filter(s => process.env.REDO || !fs.existsSync(path.join(outDir, 'agg', s + '.json')));
  const t0 = Date.now(); let done = 0, ac = 0, legs = 0;
  const run = () => new Promise(res => {
    const w = new Worker(__filename, { workerData: { dataDir, outDir }, resourceLimits: { maxOldGenerationSizeMb: 3000 } });
    const next = () => { const s = todo.shift(); if (!s) { w.terminate(); return res(); } w.postMessage(s); };
    w.on('message', m => { done++; ac += m.nAc; legs += m.nLegs; if (done % 16 === 0 || !todo.length) console.log(new Date().toISOString().slice(11, 19), 'shards', done, 'aircraft', ac, 'flights', legs, Math.round((Date.now() - t0) / 1000) + ' s'); next(); });
    w.on('error', e => { console.log('worker error', e); res(); });
    next();
  });
  Promise.all(Array.from({ length: Math.min(+nw, os.cpus().length) }, run)).then(() => console.log('done', done, 'shards', ac, 'aircraft', legs, 'flights'));
} else {
  parentPort.on('message', s => { const r = doShard(s, workerData.dataDir, workerData.outDir); parentPort.postMessage(r); });
}
