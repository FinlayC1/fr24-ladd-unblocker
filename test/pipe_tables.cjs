// Pass 2: the whole population's habits, from pass 1's flight logs (test/pipe_legs.cjs). Writes two files:
//   <out>_tb.json   the engine's classic tables (setTables): shape quantiles, return rate, airport usage by class,
//                   business-aviation pairs, squawk / FMS trip tables, arrival hour - now from the archive
//   <out>_t2.json   the 22.10 tables (setTables2):
//     od2   directional airport pairs, flights per group [biz, air, tp, ga, heli, mil]        ("EGLF>LEMG": [..])
//     odt   when a pair is flown (non-airliners): weekday (local, at the origin) x7, departure hour band (4 h) x6
//     apd   the same for all flights out of each airport (the baseline the pair is compared with)
//     seq   three-airport sequences X>O>D (the flight before, this one); airliners' own ("a:")
//     csr   callsign -> [origin, destination, flights, ...] (repeated charter / military flight numbers)
//     aph   arrival hour at each airport (local, 4 h bands) by group [biz/tp, air, ga/heli, mil]: curfews and hours
//     aps   seasonal swing of each airport's traffic by group: [cos, sin] of the month (fitted Feb-Sep, smooth year)
//     pgu   which airports each performance group (class : wake+engines, e.g. bizjet:M2J) uses
//     tperf per type, pperf per performance group: cruise level quantiles by trip length, cruise TAS / ground speed,
//           top-of-descent km per 1,000 ft, climb and descent rates, the shortest runway it lands on (3rd percentile)
//     flow  [1-degree cell, heading octant, above FL200] -> where flights there ended: [non-airline n, airline n,
//           (ICAO, non-airline, airline) x top 16]
// usage: node test/pipe_tables.cjs <dataDir> <p1Dir> <outPrefix> [--fold=k/n]  (k/n: hexes in that fold left out)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createRouteEngine } = require(process.env.ENGINE_SRC || '../src/engine.js');
const { contrib } = require('./contrib.cjs');
const TA = require('./tblacc.cjs');
const args = process.argv.slice(2);
const [dataDir, p1Dir, outPrefix] = args.filter(a => !a.startsWith('--'));
const opt = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
const fold = opt('fold') ? opt('fold').split('/').map(Number) : null;
const hexHash = hex => (parseInt(hex, 16) * 2654435761 >>> 0) % 1000003;
const heldOut = hex => !!fold && hexHash(hex) % fold[1] === fold[0];
const QS = [0.1, 0.25, 0.5, 0.75, 0.9];
const quant = (arr, qs = QS) => { const s = arr.slice().sort((a, b) => a - b); return qs.map(p => s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
const arr = (o, k, n) => o[k] || (o[k] = new Array(n).fill(0));
const C = { od2: {}, odt: {}, apd: {}, seq: {}, aph: {}, apmon: {}, pgu: {}, csr: {}, usage: { use: {}, useGA: {}, useMil: {}, useHB: {}, useLJ: {} }, od: {}, sq: {}, sqBase: {}, fms: {}, fmsBase: {}, flow: {}, rwy: {} };
// one aircraft's contributions, added (sign +1) - test/pipe_examples.cjs takes them out again with the same code
function apply(T, c, sign) {
  for (const [k, g] of c.od2) arr(T.od2, k, 6)[g] += sign;
  for (const [k, i] of c.odt) arr(T.odt, k, 13)[i] += sign;
  for (const [k, i] of c.apd) arr(T.apd, k, 13)[i] += sign;
  for (const [k] of c.seq) T.seq[k] = (T.seq[k] || 0) + sign;
  for (const [k, i] of c.aph) arr(T.aph, k, 24)[i] += sign;
  for (const [k, i] of c.apmon) arr(T.apmon, k, 48)[i] += sign;
  for (const [pg, x] of c.pgu) { const m = T.pgu[pg] || (T.pgu[pg] = {}); m[x] = (m[x] || 0) + sign; }
  for (const [cs, k] of c.csr) { const m = T.csr[cs] || (T.csr[cs] = {}); m[k] = (m[k] || 0) + sign; }
  for (const [kind, x, w] of c.usage) T.usage[kind][x] = (T.usage[kind][x] || 0) + sign * w;
  for (const [k, w] of c.od) T.od[k] = (T.od[k] || 0) + sign * w;
  for (const [k, b] of c.sq) arr(T.sq, k, 8)[b] += sign; for (const [k, b] of c.sqBase) arr(T.sqBase, k, 8)[b] += sign;
  for (const [k, b] of c.fms) arr(T.fms, k, 8)[b] += sign; for (const [k, b] of c.fmsBase) arr(T.fmsBase, k, 8)[b] += sign;
  for (const [k, x, w] of c.flow) { const m = T.flow[k] || (T.flow[k] = {}); const e = m[x] || (m[x] = [0, 0]); e[w] += sign; }
  for (const [t, len, wid] of c.rwy) (T.rwy[t] || (T.rwy[t] = [])).push([len, wid || 0]);
}
const tacc = TA.newAcc(), rnd = TA.mulberry(7), perfT = new Map();
const archDays = require('./arch.cjs').listDays(path.join(dataDir, 'arch'));
const dayMonth = new Array(12).fill(0); for (const d of archDays) dayMonth[+d.slice(5, 7) - 1]++;
let nAc = 0, nLegs = 0;
// fleets: aircraft of one owner (2 to 15 of them - more is a lessor or a programme) and their flights, for 'fleet'
const owners = new Map(), fleetLegs = {};
const files = fs.readdirSync(path.join(p1Dir, 'legs')).filter(f => f.endsWith('.json.gz')).sort();
for (const f of files) {
  const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(p1Dir, 'legs', f))).toString('utf8'));
  for (const [hex, recs] of Object.entries(j.legs)) {
    if (heldOut(hex)) continue;
    nAc++; nLegs += recs.length;
    { const k = E.ownerKey(j.ac[hex][6]); if (k) { (owners.get(k) || owners.set(k, []).get(k)).push(hex); fleetLegs[hex] = recs.filter(l => l[2] && l[3] && l[4] <= 2 && l[5] <= 2 && l[2] !== l[3]).map(l => [l[2], l[3], Math.round(l[1])]); } }
    apply(C, contrib(E, j.ac[hex], recs, (j.flow || {})[hex]), 1);
  }
  const ag = JSON.parse(fs.readFileSync(path.join(p1Dir, 'agg', f.replace('.json.gz', '.json')), 'utf8'));
  for (const [type, P] of Object.entries(ag.perf)) {
    const T = perfT.get(type) || perfT.set(type, { n: 0, cz: [], tas: [], gs: [], clb: [], tod: [], des: [], dur: [] }).get(type);
    T.n += P.n; for (const k of ['cz', 'tas', 'gs', 'clb', 'tod', 'des', 'dur']) if (T[k].length < 3000) T[k].push(...P[k]);
  }
  if (ag.tacc) TA.merge(tacc, ag.tacc, rnd);
  if (files.indexOf(f) % 16 === 15) process.stdout.write('.');
}
console.log('\naircraft', nAc, 'flights', nLegs, fold ? '(fold ' + fold.join('/') + ' left out)' : '');

// ---- classic tables ------------------------------------------------------------------------------------------------------
const tb = TA.finish(tacc);
const top = (o, n) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, +v.toFixed(2)]));
tb.usage = top(C.usage.use, 6000); tb.usageMil = top(C.usage.useMil, 1500); tb.usageGA = top(C.usage.useGA, 12000); tb.usageHB = top(C.usage.useHB, 4000); tb.usageLJ = top(C.usage.useLJ, 4000);
tb.od = top(C.od, 60000);
const nz = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v.some(x => x > 0)));
tb.sq = nz(C.sq); tb.sqBase = nz(C.sqBase); tb.fms = nz(C.fms); tb.fmsBase = nz(C.fmsBase);
fs.writeFileSync(outPrefix + '_tb.json', JSON.stringify(tb));
{ const fo = {}, fl = {}; for (const [k, hs] of owners) if (hs.length >= 2 && hs.length <= 15) { fo[k] = hs; for (const h of hs) fl[h] = fleetLegs[h]; } fs.writeFileSync(outPrefix + '_fleet.json', JSON.stringify({ owners: fo, legs: fl })); console.log('fleets', Object.keys(fo).length, 'aircraft', Object.keys(fl).length); }

// ---- 22.10 tables ---------------------------------------------------------------------------------------------------------
const out = { v: 1, built: new Date().toISOString(), days: archDays.length, from: archDays[0], to: archDays[archDays.length - 1], grp: ['biz', 'air', 'tp', 'ga', 'heli', 'mil'] };
const sum = (a, i = 0, j = a.length) => { let t = 0; for (let k = i; k < j; k++) t += a[k]; return t; };
// pairs: everything but airliners from 2 flights, airliners from 6 (their schedules are FR24's anyway)
// (the same trimming as the script ships - test/pack_t2.cjs - so the weights are learned on the evidence it will have)
out.od2 = {}; for (const [k, v] of Object.entries(C.od2)) { const nonAir = v[0] + v[2] + v[3] + v[4] + v[5]; if (nonAir >= 2 || v[1] >= 10) out.od2[k] = v; }
out.odt = {}; for (const [k, v] of Object.entries(C.odt)) if (sum(v, 0, 7) >= 6) out.odt[k] = v;
out.apd = {}; for (const [k, v] of Object.entries(C.apd)) if (sum(v, 0, 7) >= 10) out.apd[k] = v;
out.seq = {}; for (const [k, n] of Object.entries(C.seq)) if (n >= (k.startsWith('a:') ? 6 : 2)) out.seq[k] = n;
out.csr = {}; for (const [cs, m] of Object.entries(C.csr)) { const l = []; for (const [k, n] of Object.entries(m)) if (n >= 3) { const [o, d] = k.split('>'); l.push(o, d, n); } if (l.length) out.csr[cs] = l; }
out.aph = {}; const aphAll = new Array(24).fill(0);
for (const [ap, v] of Object.entries(C.aph)) { for (let i = 0; i < 24; i++) aphAll[i] += v[i]; const keep = []; let any = false; for (let gg = 0; gg < 4; gg++) { const s = v.slice(gg * 6, gg * 6 + 6), n = sum(s); keep.push(n >= 20 ? s : 0); if (n >= 20) any = true; } if (any) out.aph[ap] = keep; }
out.aphAll = [0, 1, 2, 3].map(gg => aphAll.slice(gg * 6, gg * 6 + 6));
// seasons: flights per day of data by month, one yearly wave fitted (ridge) - [cos, sin] of the log rate
out.aps = {};
for (const [ap, v] of Object.entries(C.apmon)) {
  const res = []; let any = false;
  for (let gg = 0; gg < 4; gg++) {
    const ms = [], ys = []; let tot = 0;
    for (let m = 0; m < 12; m++) { const nd = dayMonth[m]; if (!nd) continue; const c = v[gg * 12 + m]; tot += c; ms.push(m); ys.push(Math.log((c + 0.5) / nd)); }
    if (tot < 40 || ms.length < 4) { res.push(0); continue; }
    const mean = sum(ys) / ys.length;
    let scc = 2, sss = 2, scs = 0, syc = 0, sys = 0;
    ms.forEach((m, i) => { const c = Math.cos(2 * Math.PI * m / 12), s = Math.sin(2 * Math.PI * m / 12), y = ys[i] - mean; scc += c * c; sss += s * s; scs += c * s; syc += y * c; sys += y * s; });
    const det = scc * sss - scs * scs, b = (syc * sss - sys * scs) / det, c = (sys * scc - syc * scs) / det;
    res.push([+b.toFixed(3), +c.toFixed(3)]); any = true;
  }
  if (any) out.aps[ap] = res;
}
out.pgu = {}; for (const [pg, m] of Object.entries(C.pgu)) { const o = {}; for (const [x, n] of Object.entries(m)) if (n >= 3) o[x] = n; if (Object.keys(o).length) out.pgu[pg] = o; }
const perfOf = T => {
  if (T.cz.length < 25) return null;
  const cz = {}; const byBin = new Map(); for (const [km, alt] of T.cz) if (km > 20) { const b = E.tripBin(km); (byBin.get(b) || byBin.set(b, []).get(b)).push(alt); }
  for (const [b, a] of byBin) if (a.length >= 8) cz[b] = quant(a);
  const tas = T.tas.filter(x => x[0] > 15000).map(x => x[1]), gs = T.gs.filter(x => x[0] > 15000).map(x => x[1]);
  const tod = T.tod.filter(x => x[0] > 8000 && x[1] > 5).map(x => x[1] / (x[0] / 1000));
  return { n: T.n, cz, tas: tas.length >= 10 ? quant(tas, [0.25, 0.5, 0.75]).map(Math.round) : null, gs: gs.length >= 10 ? quant(gs, [0.25, 0.5, 0.75]).map(Math.round) : null, tod: tod.length >= 10 ? quant(tod, [0.1, 0.5, 0.9]).map(v => +v.toFixed(2)) : null, clb: T.clb.length >= 10 ? quant(T.clb, [0.5])[0] : null, des: T.des.length >= 10 ? quant(T.des, [0.5])[0] : null };
};
out.tperf = {}; const byPg = new Map();
for (const [type, T] of perfT) {
  const p = perfOf(T); if (p) out.tperf[type] = p;
  const pg = E.pgrpOf(E.classify({ type }), type);
  const G = byPg.get(pg) || byPg.set(pg, { n: 0, cz: [], tas: [], gs: [], clb: [], tod: [], des: [], dur: [] }).get(pg);
  G.n += T.n; for (const k of ['cz', 'tas', 'gs', 'clb', 'tod', 'des', 'dur']) G[k].push(...T[k].slice(0, 600));
}
out.pperf = {}; for (const [pg, G] of byPg) { const p = perfOf(G); if (p) out.pperf[pg] = p; }
for (const [type, l] of Object.entries(C.rwy)) if (l.length >= 15) { const P = out.tperf[type] = out.tperf[type] || { n: 0 }; P.rwy = quant(l.map(x => x[0]), [0.03])[0]; const w = l.map(x => x[1]).filter(x => x > 0); if (w.length >= 15) P.rwyW = quant(w, [0.03])[0]; }
out.flow = {}; let fk = 0;
for (const [k, m] of Object.entries(C.flow)) {
  let totN = 0, totA = 0; const l = [];
  for (const [x, [nN, nA]] of Object.entries(m)) { totN += nN; totA += nA; l.push([x, nN, nA]); }
  if (totN + totA < 40) continue;
  l.sort((p, q) => (q[1] * 20 + q[2]) - (p[1] * 20 + p[2]));
  out.flow[k] = [totN, totA, ...l.slice(0, 8).flat()]; fk++;
}
fs.writeFileSync(outPrefix + '_t2.json', JSON.stringify(out));
const sz = k => (JSON.stringify(out[k]).length / 1e6).toFixed(2) + ' MB';
console.log('pairs', Object.keys(out.od2).length, sz('od2'), '| pair times', Object.keys(out.odt).length, sz('odt'), '| origins', Object.keys(out.apd).length, '| sequences', Object.keys(out.seq).length, sz('seq'), '| callsigns', Object.keys(out.csr).length, sz('csr'), '| arrival hours', Object.keys(out.aph).length, sz('aph'), '| seasons', Object.keys(out.aps).length, '| perf groups', Object.keys(out.pgu).length, sz('pgu'), '| types', Object.keys(out.tperf).length, sz('tperf'), '| flow keys', fk, sz('flow'));
console.log('classic: usage', Object.keys(tb.usage).length, 'GA', Object.keys(tb.usageGA).length, 'mil', Object.keys(tb.usageMil).length, 'od', Object.keys(tb.od).length, 'sq', Object.keys(tb.sq).length, (JSON.stringify(tb).length / 1e6).toFixed(2) + ' MB');
module.exports = { apply };
