// The engine's shape tables (quantiles: heading vs bearing, cross-track, descent / level / climb profiles, cruise level by
// trip length, trip length, local-sortie radius, climb-out, closing rate, return-to-origin rate) accumulated flight by
// flight - the statistics test/mktables.cjs learns, in a form a parallel pass can merge (reservoir samples per bin).
// Airliner flights are sampled at 15%: the tables describe the flights the engine reasons about (private, business,
// military, GA), which airline traffic would otherwise swamp.
const NM = 1.852;
const CAP = 3000;
const group = cls => ['bizjet', 'heavybiz', 'airliner', 'milheavy', 'unknown'].includes(cls) ? 'jet' : cls === 'turboprop' ? 'tprop' : cls;
const dBin = d => d < 15 ? 0 : d < 30 ? 1 : d < 60 ? 2 : d < 120 ? 3 : d < 250 ? 4 : d < 500 ? 5 : d < 1000 ? 6 : 7;
const rBin = d => d < 150 ? 0 : d < 400 ? 1 : d < 1000 ? 2 : 3;
const tBin = nm => nm < 60 ? 0 : nm < 120 ? 1 : nm < 200 ? 2 : nm < 300 ? 3 : nm < 450 ? 4 : nm < 700 ? 5 : nm < 1100 ? 6 : nm < 1800 ? 7 : 8;
const aBin = alt => alt < 6000 ? 0 : alt < 10000 ? 1 : alt < 15000 ? 2 : alt < 20000 ? 3 : alt < 26000 ? 4 : alt < 33000 ? 5 : 6;
function newAcc() { return { hdg: {}, xt: {}, desc: {}, lvl: {}, clm: {}, stp: {}, rall: {}, cruise: {}, trip: {}, tripc: {}, loc: {}, clb: {}, cls: {}, ret: {}, n: {}, arrHour: new Array(24).fill(0), seen: {} }; }
// reservoir sample: every value has the same chance to be kept, whatever the order
function push(acc, tbl, a, b, v, rnd) {
  const T = acc[tbl], G = T[a] = T[a] || {}; let r = G[b]; if (!r) r = G[b] = [];
  const key = tbl + '|' + a + '|' + b, n = acc.seen[key] = (acc.seen[key] || 0) + 1;
  if (r.length < CAP) r.push(+v.toFixed(4)); else { const j = Math.floor(rnd() * n); if (j < CAP) r[j] = +v.toFixed(4); }
}
// one aircraft's flights: legs (raw, from legsFromPoints) and their summaries
function accumulate(E, acc, ac, legs, sums, rnd) {
  const cls = E.classify(ac), grp = group(cls), mil = !!ac.mil && cls !== 'heavybiz' && cls !== 'bizjet';
  for (let li = 0; li < legs.length; li++) {
    const leg = legs[li], s = sums[li];
    if (!s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 480) continue;
    if (cls === 'airliner' && rnd() > 0.15) continue;
    const O = E.byId(s.from.id), D = E.byId(s.to.id); if (!O || !D) continue;
    const dOD = E.dist(O.lat, O.lon, D.lat, D.lon);
    if (O.id !== D.id && D.tz != null && !mil && cls !== 'heli' && cls !== 'piston') acc.arrHour[Math.floor((((s.tEnd + D.tz) / 3600) % 24 + 24) % 24)]++;
    acc.n[grp] = (acc.n[grp] || 0) + 1;
    for (const k of [cls, 'G' + grp]) { acc.ret[k] = acc.ret[k] || [0, 0]; acc.ret[k][0]++; if (O.id === D.id) acc.ret[k][1]++; }
    if (O.id !== D.id) { push(acc, 'trip', grp, 0, Math.log(dOD + 5), rnd); push(acc, 'tripc', cls, 0, Math.log(dOD + 5), rnd); }
    if (O.id !== D.id && dOD > 20) push(acc, 'cruise', grp, tBin(dOD / NM), s.maxAlt, rnd);
    if (O.id === D.id) push(acc, 'cruise', grp + 'L', 0, s.maxAlt, rnd);
    const pts = leg.pts;
    for (let i = 0; i < pts.length; i += 5) {
      const p = pts[i]; if (p.alt == null) continue;
      const d = E.dist(p.lat, p.lon, D.lat, D.lon), L = O.id === D.id ? 'L' : '';
      if (p.trk != null && d > 5 && (p.gs == null || p.gs > 50)) push(acc, 'hdg', grp + L, dBin(d), E.angDiff(p.trk, E.brg(p.lat, p.lon, D.lat, D.lon)), rnd);
      const dOP = E.dist(O.lat, O.lon, p.lat, p.lon);
      { let q = null; for (let k = i - 1; k >= 0; k--) { const dt = p.t - pts[k].t; if (dt >= 90) { if (dt <= 240) q = pts[k]; break; } } if (q && d > 2) { const moved = E.dist(q.lat, q.lon, p.lat, p.lon); if (moved > 0.8) push(acc, 'cls', grp + L, dBin(d), Math.max(-1, Math.min(1, (E.dist(q.lat, q.lon, D.lat, D.lon) - d) / moved)), rnd); } }
      if (O.id === D.id) push(acc, 'loc', grp, 0, Math.log(dOP + 1), rnd);
      if (p.vr != null && p.vr > 400 && dOP < 250 && p.alt - O.alt > 300 && !(O.id === D.id && dOP > 60)) push(acc, 'clb', grp, 0, Math.log((dOP / NM + 1) / ((p.alt - O.alt) / 300 + 1)), rnd);
      if (O.id !== D.id && dOD > 40 && dOP > 25 && d > 25) { const [x] = E.xtat(O.lat, O.lon, D.lat, D.lon, p.lat, p.lon); push(acc, 'xt', grp, rBin(dOD), Math.abs(x) / dOD, rnd); }
      const agl = p.alt - D.alt;
      if (agl > 800 && p.vr != null) {
        const r = Math.log(Math.max(0.02, (d / NM + 1) / (agl / 300 + 1))), g2 = grp + L;
        push(acc, 'rall', g2, aBin(p.alt), r, rnd);
        if (p.vr > 500) push(acc, 'clm', g2, aBin(p.alt), r, rnd);
        else if (p.vr < -500) push(acc, 'desc', g2, p.alt < 10000 ? 0 : 1, r, rnd);
        else if (Math.abs(p.vr) < 250 && E.isStepClimb(pts.slice(Math.max(0, i - 200), i + 1), p)) push(acc, 'stp', g2, aBin(p.alt), r, rnd);
        else if (Math.abs(p.vr) < 250 && d > 3) push(acc, 'lvl', g2, aBin(p.alt), r, rnd);
      }
    }
  }
}
// merge shard accumulators (reservoirs: concatenated, then thinned to the cap)
function merge(into, a, rnd) {
  for (const t of ['hdg', 'xt', 'desc', 'lvl', 'clm', 'stp', 'rall', 'cruise', 'trip', 'tripc', 'loc', 'clb', 'cls']) for (const [g, bins] of Object.entries(a[t] || {})) for (const [b, arr] of Object.entries(bins)) {
    const G = into[t][g] = into[t][g] || {}; const r = G[b] = (G[b] || []).concat(arr);
    if (r.length > CAP * 20) { for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } r.length = CAP * 20; }
  }
  for (const [k, v] of Object.entries(a.ret || {})) { into.ret[k] = into.ret[k] || [0, 0]; into.ret[k][0] += v[0]; into.ret[k][1] += v[1]; }
  for (const [k, v] of Object.entries(a.n || {})) into.n[k] = (into.n[k] || 0) + v;
  for (let i = 0; i < 24; i++) into.arrHour[i] += (a.arrHour || [])[i] || 0;
}
const QS = Array.from({ length: 19 }, (_, i) => (i + 1) * 0.05);
const quant = arr => { const s = arr.slice().sort((a, b) => a - b); return QS.map(p => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(4)); };
function finish(acc) {
  const out = { qs: QS, n: acc.n, ret: {}, arrHour: acc.arrHour };
  for (const [k, [n, r]] of Object.entries(acc.ret)) out.ret[k] = [n, +(r / n).toFixed(3)];
  for (const key of ['hdg', 'xt', 'desc', 'lvl', 'clm', 'stp', 'rall', 'cruise', 'trip', 'tripc', 'loc', 'clb', 'cls']) {
    out[key] = {};
    for (const [g, bins] of Object.entries(acc[key])) { out[key][g] = {}; for (const [b, arr] of Object.entries(bins)) if (arr.length >= 25) out[key][g][b] = { n: arr.length, q: quant(arr) }; }
  }
  return out;
}
const mulberry = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
module.exports = { newAcc, accumulate, merge, finish, mulberry, group };
