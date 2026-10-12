// Learns the engine's likelihood tables (quantile form) and the airport usage prior from real legs.
// usage: node test/mktables.cjs <dataDir> <out.json> [--wide] [--narrow] [--fold=0|1 (exclude that fold)] [--usage-only]
const fs = require('fs');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const args = process.argv.slice(2);
const [dataDir, outFile] = args.filter(a => !a.startsWith('--'));
const opt = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const fold = opt('fold');
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(dataDir + '/airports.json', 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
const NM = 1.852;
const QS = Array.from({ length: 19 }, (_, i) => (i + 1) * 0.05);
const quant = arr => { const s = arr.slice().sort((a, b) => a - b); return QS.map(p => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(4)); };
const acc = { hdg: {}, xt: {}, desc: {}, lvl: {}, clm: {}, stp: {}, rall: {}, cruise: {}, trip: {}, tripc: {}, loc: {}, clb: {}, cls: {}, ret: {}, n: {} };
const usage = {}, usageMil = {}, usageGA = {}, usageHB = {}, usageLJ = {}, od = {};
// trip length (8 bins) by what the transponder shows: squawk code block / FMS-selected altitude, per origin country
const sq = {}, sqBase = {}, fms = {}, fmsBase = {}, arrHour = Array(24).fill(0);
const addBin = (o, k, b) => { (o[k] = o[k] || [0, 0, 0, 0, 0, 0, 0, 0])[b]++; };
const push = (o, a, b, v) => { o[a] = o[a] || {}; (o[a][b] = o[a][b] || []).push(v); };
const group = cls => ['bizjet', 'heavybiz', 'airliner', 'milheavy', 'unknown'].includes(cls) ? 'jet' : cls === 'turboprop' ? 'tprop' : cls;
const dBin = d => d < 15 ? 0 : d < 30 ? 1 : d < 60 ? 2 : d < 120 ? 3 : d < 250 ? 4 : d < 500 ? 5 : d < 1000 ? 6 : 7;
const rBin = d => d < 150 ? 0 : d < 400 ? 1 : d < 1000 ? 2 : 3;
const tBin = nm => nm < 60 ? 0 : nm < 120 ? 1 : nm < 200 ? 2 : nm < 300 ? 3 : nm < 450 ? 4 : nm < 700 ? 5 : nm < 1100 ? 6 : nm < 1800 ? 7 : 8;
const aBin = alt => alt < 6000 ? 0 : alt < 10000 ? 1 : alt < 15000 ? 2 : alt < 20000 ? 3 : alt < 26000 ? 4 : alt < 33000 ? 5 : 6;
// --sets=narrow,wide,biz (default narrow+wide, as before)
const sources = (opt('sets') || ((args.includes('--wide') ? '' : 'narrow,') + (args.includes('--narrow') ? '' : 'wide'))).split(',').filter(Boolean).filter(k => fs.existsSync(dataDir + '/' + (k === 'biz' ? 'biz_sample.json' : k === 'wide' ? 'wide_sample.json' : 'sample.json'))).map(set => ({ set, wide: set !== 'narrow' }));
const seenHex = new Set();
for (const src of sources) {
  for (const { ac, pts } of aircraft(dataDir, E, { set: src.set, filter: a => fold == null || (parseInt(a.hex, 16) % 2) !== Number(fold) })) {
    if (seenHex.has(ac.hex)) continue; seenHex.add(ac.hex);   // each aircraft once, from the first set listed (put the richest first)
    const cls = E.classify(ac), grp = group(cls);
    // (government / VIP business jets flagged military fly like business jets: they count as such)
    const mil = !!ac.mil && cls !== 'heavybiz' && cls !== 'bizjet';
    const legs = E.legsFromPoints(pts, { heli: cls === 'heli' });
    const visited = new Map(), pairs = new Map();
    for (const leg of legs) {
      const s = E.summarizeLeg(leg, null);
      for (const e of [s.from, s.to]) if (e && (e.conf === 'ground' || e.conf === 'low')) visited.set(e.id, (visited.get(e.id) || 0) + 1);
      if (!s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 480) continue;
      const O = E.byId(s.from.id), D = E.byId(s.to.id), dOD = E.dist(O.lat, O.lon, D.lat, D.lon);
      if (O.id !== D.id && O.icao && D.icao) { const k = O.icao < D.icao ? O.icao + '|' + D.icao : D.icao + '|' + O.icao; pairs.set(k, (pairs.get(k) || 0) + 1); }
      if (O.id !== D.id && D.tz != null && !mil && cls !== 'heli' && cls !== 'piston') arrHour[Math.floor((((s.tEnd + D.tz) / 3600) % 24 + 24) % 24)]++;
      if (O.id !== D.id && O.country && !mil) {
        const b = E.tripBin(dOD), sqs = new Set(), fmss = new Set();
        for (const p of leg.pts) {
          if (p.alt > 1500 && p.sq && /^[0-7]{4}$/.test(p.sq) && !E.SQ_NOINFO.test(p.sq)) sqs.add(p.sq.slice(0, 2));
          if (p.fms > 5000 && !(p.vr < -500)) fmss.add(Math.round(p.fms / 2000));
        }
        if (sqs.size) addBin(sqBase, O.country, b); for (const k of sqs) addBin(sq, O.country + '|' + k, b);
        if (fmss.size) addBin(fmsBase, O.country, b); for (const k of fmss) addBin(fms, O.country + '|' + k, b);
      }
      acc.n[grp] = (acc.n[grp] || 0) + 1;
      acc.ret[cls] = acc.ret[cls] || [0, 0]; acc.ret[cls][0]++; if (O.id === D.id) acc.ret[cls][1]++;
      acc.ret['G' + grp] = acc.ret['G' + grp] || [0, 0]; acc.ret['G' + grp][0]++; if (O.id === D.id) acc.ret['G' + grp][1]++;
      if (O.id !== D.id) { push(acc.trip, grp, 0, Math.log(dOD + 5)); push(acc.tripc, cls, 0, Math.log(dOD + 5)); }
      if (O.id !== D.id && dOD > 20) push(acc.cruise, grp, tBin(dOD / NM), s.maxAlt);
      if (O.id === D.id) push(acc.cruise, grp + 'L', 0, s.maxAlt);   // how high local sorties go
      let maxSoFar = 0;
      for (let i = 0; i < leg.pts.length; i++) {
        const p = leg.pts[i]; if (p.alt == null) continue;
        if (p.alt > maxSoFar) maxSoFar = p.alt;
        if (i % 5) continue;
        const d = E.dist(p.lat, p.lon, D.lat, D.lon);
        if (p.trk != null && d > 5 && (p.gs == null || p.gs > 50)) push(acc.hdg, grp + (O.id === D.id ? 'L' : ''), dBin(d), E.angDiff(p.trk, E.brg(p.lat, p.lon, D.lat, D.lon)));
        const dOP = E.dist(O.lat, O.lon, p.lat, p.lon);
        { let q = null; for (let k = i - 1; k >= 0; k--) { const dt = p.t - leg.pts[k].t; if (dt >= 90) { if (dt <= 240) q = leg.pts[k]; break; } } if (q && d > 2) { const moved = E.dist(q.lat, q.lon, p.lat, p.lon); if (moved > 0.8) push(acc.cls, grp + (O.id === D.id ? 'L' : ''), dBin(d), Math.max(-1, Math.min(1, (E.dist(q.lat, q.lon, D.lat, D.lon) - d) / moved))); } }
        if (O.id === D.id) push(acc.loc, grp, 0, Math.log(dOP + 1));
        if (p.vr != null && p.vr > 400 && dOP < 250 && p.alt - O.alt > 300 && !(O.id === D.id && dOP > 60)) push(acc.clb, grp, 0, Math.log((dOP / NM + 1) / ((p.alt - O.alt) / 300 + 1)));
        if (O.id !== D.id && dOD > 40 && dOP > 25 && d > 25) { const [x] = E.xtat(O.lat, O.lon, D.lat, D.lon, p.lat, p.lon); push(acc.xt, grp, rBin(dOD), Math.abs(x) / dOD); }
        const agl = p.alt - D.alt;
        if (agl > 800 && p.vr != null) {
          const r = Math.log(Math.max(0.02, (d / NM + 1) / (agl / 300 + 1)));
          const g2 = grp + (O.id === D.id ? 'L' : '');
          // climbing: how far the destination still is at this height; a step climb (cruising lower for a while, then up
          // 1,000 ft+ and level again) has its own table - the same test the engine applies to the live track
          // every point at this height, whatever it is doing: the baseline that turns the per-state tables into ratios
          push(acc.rall, g2, aBin(p.alt), r);
          if (p.vr > 500) push(acc.clm, g2, aBin(p.alt), r);
          else if (p.vr < -500) push(acc.desc, g2, p.alt < 10000 ? 0 : 1, r);
          else if (Math.abs(p.vr) < 250 && E.isStepClimb(leg.pts.slice(Math.max(0, i - 200), i + 1), p)) push(acc.stp, g2, aBin(p.alt), r);
          else if (Math.abs(p.vr) < 250 && d > 3) push(acc.lvl, g2, aBin(p.alt), r);
        }
        // climb: the eventual cruise level given the trip, seen from the max so far is handled via cruise tables
      }
    }
    const uTbl = mil ? usageMil : (cls === 'piston' || cls === 'heli') ? usageGA : usage;
    for (const [id, n] of visited) { const a = E.byId(id); if (!a || !a.icao) continue; uTbl[a.icao] = (uTbl[a.icao] || 0) + Math.log2(1 + n); }
    const cTbl = mil ? null : cls === 'heavybiz' || cls === 'airliner' ? usageHB : cls === 'bizjet' ? usageLJ : null;
    if (cTbl) for (const [id, n] of visited) { const a = E.byId(id); if (a && a.icao) cTbl[a.icao] = (cTbl[a.icao] || 0) + Math.log2(1 + n); }
    if (!mil && cls !== 'piston' && cls !== 'heli') for (const [k, n] of pairs) od[k] = (od[k] || 0) + Math.log2(1 + n);
  }
}
const out = { qs: QS, n: acc.n, ret: {}, hdg: {}, xt: {}, desc: {}, lvl: {}, clm: {}, stp: {}, rall: {}, cruise: {}, trip: {}, tripc: {}, loc: {}, clb: {}, cls: {} };
for (const [k, [n, r]] of Object.entries(acc.ret)) out.ret[k] = [n, +(r / n).toFixed(3)];
for (const key of ['hdg', 'xt', 'desc', 'lvl', 'clm', 'stp', 'rall', 'cruise', 'trip', 'tripc', 'loc', 'clb', 'cls']) {
  for (const [g, bins] of Object.entries(acc[key])) {
    out[key][g] = {};
    for (const [b, arr] of Object.entries(bins)) if (arr.length >= 25) out[key][g][b] = { n: arr.length, q: quant(arr) };
  }
}
const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, +v.toFixed(2)]));
out.usage = top(usage, 2500);
out.usageMil = top(usageMil, 400);
out.usageGA = top(usageGA, 5000);
out.usageHB = top(usageHB, 1500);
out.usageLJ = top(usageLJ, 1500);
out.od = top(od, 30000);
out.sq = sq; out.sqBase = sqBase; out.fms = fms; out.fmsBase = fmsBase; out.arrHour = arrHour;
fs.writeFileSync(outFile, JSON.stringify(out));
console.log('legs by group', acc.n, 'aircraft', seenHex.size, 'usage airports', Object.keys(usage).length, 'mil', Object.keys(usageMil).length);
console.log('return-to-origin', JSON.stringify(out.ret));
