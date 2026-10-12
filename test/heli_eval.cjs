// Helicopters: airport or private landing site? Builds clock-time samples from real helicopter tracks (every 6 min
// of every landed leg), with the engine's airport candidates (held-out folds) and the aircraft's own earlier landing
// spots, then fits / evaluates the private-site layer (2-fold by hex parity).
// usage: node test/heli_eval.cjs <dataDir> <tables prefix> <logit prefix> <runways.json> [dump.json]
//        node test/heli_eval.cjs --fit <dump.json>
const fs = require('fs');
const path = require('path');
if (process.argv[2] === '--fit') { fit(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), process.argv[4]); process.exit(0); }
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const { loadSites, siteGrid } = require('./sites.cjs');
const [dataDir, tbl, lg, rw, dumpFile] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows, RW = JSON.parse(fs.readFileSync(rw, 'utf8'));
const engines = [0, 1].map(k => { const E = createRouteEngine(); E.setAirports(rows); E.setRunways(RW); E.setTables(JSON.parse(fs.readFileSync(`${tbl}_f${k}.json`, 'utf8'))); E.setLogit(JSON.parse(fs.readFileSync(`${lg}_f${k}.json`, 'utf8'))); return E; });
const G = siteGrid(loadSites(path.join(dataDir, 'oa_airports.csv')));
const E0 = engines[0];
const AP_KM = 2.5;
const apAt = (lat, lon) => { const a = E0.airportAt(lat, lon, AP_KM); return a && a.dist < AP_KM ? a.airport : null; };
const out = [];
const seen = new Set(); let nAc = 0;
for (const set of (process.env.SETS || 'big,wide').split(',')) for (const { ac, pts } of aircraft(dataDir, E0, { set })) {
  if (seen.has(ac.hex)) continue; seen.add(ac.hex);
  const E = engines[parseInt(ac.hex, 16) % 2], cls = E.classify(ac); if (cls !== (process.env.CLS || 'heli')) continue; nAc++;
  const legs = E.legsFromPoints(pts, { heli: cls === 'heli' }), sums = legs.map(l => E.summarizeLeg(l, null));
  const hist = E.chainLegs(E.stitchLegs(sums.map(s => Object.assign({}, s))));
  const landedLeg = s => s.ended && (s.how === 'ground' || s.how === 'touch' || (s.how === 'gap-low' && s.endAlt != null && s.endAlt < 1500));
  let used = 0;
  for (let li = 0; li < legs.length; li++) {
    const leg = legs[li], s = sums[li];
    if (!landedLeg(s) || s.tEnd - s.tStart < 300) continue;
    const tAp = apAt(s.endLat, s.endLon);
    // earlier history: landings (off-airport spots with counts) and the engine's summaries
    const prev = sums.slice(0, li).filter(x => x.tEnd < s.tStart - 60);
    const spots = [];
    const note = (lat, lon, t, dep) => { let sp = spots.find(p => G.dist(p.lat, p.lon, lat, lon) < 0.4); if (!sp) spots.push(sp = { lat, lon, n: 0, dep: 0, last: 0 }); if (dep) sp.dep++; else sp.n++; sp.last = Math.max(sp.last, t); };
    let nLand = 0, nOff = 0;
    for (const x of prev) {
      if (landedLeg(x)) { nLand++; if (!apAt(x.endLat, x.endLon)) { nOff++; note(x.endLat, x.endLon, x.tEnd, false); } }
      if (x.startedOnGround && !apAt(x.startLat, x.startLon)) note(x.startLat, x.startLon, x.tStart, true);
    }
    const hs = E.histStats(hist.filter(h => h.tEnd < s.tStart - 60), s.tStart), all = [leg.start].concat(leg.pts);
    const oAp = apAt(s.startLat, s.startLon), oOff = s.startedOnGround && !oAp;
    const truthSpot = tAp ? -1 : spots.findIndex(p => G.dist(p.lat, p.lon, s.endLat, s.endLon) < 1);
    const tSite = tAp ? null : G.near(s.endLat, s.endLon, 0.35);
    for (let tt = s.tStart + 120 + (parseInt(ac.hex, 16) % 61) / 61 * 360; tt < s.tEnd - 45; tt += 360) {
      let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
      if (idx < 1 || all[idx].gnd) continue;
      const pos = all[idx], thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
      const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t });
      const cands = r && r.cands ? r.cands.slice(0, 6).map(c => [c.airport.id, +c.p.toFixed(4), +c.dist.toFixed(2), c.airport.alt || 0]) : [];
      const near = E.airportAt(pos.lat, pos.lon, 60), nearKm = near ? near.dist : 60, nearElev = near ? near.airport.alt || 0 : 0;
      // vertical rate from the trail (last minute)
      let vr = fin(pos.vr) ? pos.vr : NaN; if (!fin(vr)) for (let i = idx - 1; i >= 0; i--) if (pos.t - all[i].t >= 45 && all[i].alt != null && pos.alt != null) { vr = (pos.alt - all[i].alt) / ((pos.t - all[i].t) / 60); break; }
      // OA sites ahead within 6 km (for naming near the end)
      out.push({
        hex: ac.hex, leg: li, t: Math.round(tt), togo: Math.round(s.tEnd - tt), el: Math.round(tt - s.tStart),
        pos: [+pos.lat.toFixed(5), +pos.lon.toFixed(5), pos.alt == null ? null : Math.round(pos.alt), pos.gs == null ? null : Math.round(pos.gs), pos.trk == null ? null : Math.round(pos.trk), fin(vr) ? Math.round(vr) : null],
        start: [+s.startLat.toFixed(5), +s.startLon.toFixed(5)], oOff: oOff ? 1 : 0, oAp: oAp ? oAp.id : 0,
        nLand, nOff, spots: spots.map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5), p.n, p.dep, Math.round((s.tStart - p.last) / 3600)]),
        cands, nearKm: +nearKm.toFixed(2), nearElev,
        truth: tAp ? { ap: tAp.id } : { off: [+s.endLat.toFixed(5), +s.endLon.toFixed(5)], spot: truthSpot, site: tSite ? tSite.site[3] : '' }
      });
    }
    used++;
  }
}
function fin(v) { return typeof v === 'number' && isFinite(v); }
console.error('helicopters', nAc, 'samples', out.length);
fs.writeFileSync(dumpFile || 'heli_dump.json', JSON.stringify(out));
fit(out, dataDir);

// ------------------------------------------------------------------------------------------------------------------
function fit(S, dataDirF) {
  const APC = new Map(); let GS = null;
  if (dataDirF) { for (const a of JSON.parse(fs.readFileSync(path.join(dataDirF, 'airports.json'), 'utf8')).rows) APC.set(a.id, a); const ss = require('./sites.cjs'); GS = ss.siteGrid(ss.loadSites(path.join(dataDirF, 'oa_airports.csv')).filter(r => r[2] === 'H')); }
  const R = 6371, rad = Math.PI / 180;
  const dist = (a, b, c, d) => { const x = Math.sin((c - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const brg = (a, b, c, d) => { const y = Math.sin((d - b) * rad) * Math.cos(c * rad), x = Math.cos(a * rad) * Math.sin(c * rad) - Math.sin(a * rad) * Math.cos(c * rad) * Math.cos((d - b) * rad); return (Math.atan2(y, x) / rad + 360) % 360; };
  const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const logit = p => Math.log(p / (1 - p));
  // P(private) features
  function privFeat(s) {
    const [lat, lon, alt, gs, trk, vr] = s.pos;
    const share = (s.nOff + 0.41 * 3) / (s.nLand + 3);
    const top = s.cands[0] || [0, 0, 60, 0];
    const agl = alt == null ? 1500 : alt - s.nearElev;
    const lowSlow = (gs != null && gs < 50 && agl < 1500) ? 1 : 0;
    const desc = vr != null && vr < -300 && agl < 2500 ? 1 : 0;
    const back = dist(lat, lon, s.start[0], s.start[1]);
    // own spots ahead: closeness x alignment
    let spotBest = 0;
    for (const sp of s.spots) { const d = dist(lat, lon, sp[0], sp[1]); const off = trk == null || d < 2 ? 0 : angDiff(trk, brg(lat, lon, sp[0], sp[1])); const al = Math.max(0, Math.cos(off * rad)); spotBest = Math.max(spotBest, Math.log(1 + sp[2] + sp[3]) * al * Math.exp(-d / 40)); }
    // the top airport: straight ahead, or off to one side
    let topAl = 0; { const a = s.cands[0] && APC.get(s.cands[0][0]); if (a && trk != null && top[2] > 2) topAl = Math.cos(angDiff(trk, brg(lat, lon, a.lat, a.lon)) * rad); else if (a) topAl = 1; }
    // a listed heliport close ahead (hospitals, company pads) while low
    let heliAhead = 0;
    if (GS && agl < 3000) { const n = GS.near(lat, lon, 8); if (n) { const off = trk == null || n.dist < 1 ? 0 : angDiff(trk, brg(lat, lon, n.site[0], n.site[1])); heliAhead = Math.max(0, Math.cos(off * rad)) * Math.exp(-n.dist / 3); } }
    const lowNoAp = agl < 1000 && s.nearKm > 5 ? 1 : 0;
    return [1, logit(share), s.oOff, top[1], Math.log(1 + top[2]), lowSlow, desc, spotBest, Math.log(1 + s.nearKm), Math.log(1 + s.el / 60), s.oOff * Math.exp(-back / 10), Math.log(1 + Math.max(0, agl) / 1000), topAl, topAl * Math.exp(-top[2] / 15), heliAhead, lowNoAp, s.nLand ? 0 : 1, lowSlow * Math.log(1 + s.nearKm), desc * Math.log(1 + s.nearKm), (agl < 800 ? 1 : 0) * Math.log(1 + top[2]), logit(share) * Math.log(1 + s.nLand) / 3];
  }
  const PN = ['bias', 'ownShare', 'fromPrivate', 'topApP', 'topApKm', 'lowSlow', 'descLow', 'spotAhead', 'nearestApKm', 'elapsed', 'nearOwnStart', 'agl', 'topAlign', 'topAlignNear', 'heliportAhead', 'lowNoAirport', 'noHistory', 'lowSlowFar', 'descFar', 'lowTopFar', 'shareConf'];
  // logistic regression by Newton's method (full Hessian, ridge), on the raw features
  function solve(A, b) { const n = b.length, M = A.map((r, i) => r.concat([b[i]])); for (let i = 0; i < n; i++) { let m = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[m][i])) m = k; [M[i], M[m]] = [M[m], M[i]]; const d = M[i][i] || 1e-12; for (let k = i + 1; k < n; k++) { const f = M[k][i] / d; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } } const x = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let v = M[i][n]; for (let j = i + 1; j < n; j++) v -= M[i][j] * x[j]; x[i] = v / (M[i][i] || 1e-12); } return x; }
  function lr(X, y, l2, iters) {
    const k = X[0].length; let w = new Array(k).fill(0);
    const loss = w2 => { let L = 0; for (let i = 0; i < X.length; i++) { const z = X[i].reduce((a, v, j) => a + v * w2[j], 0); L += y[i] ? Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)); } return L + 0.5 * l2 * w2.reduce((a, v) => a + v * v, 0); };
    let L0 = loss(w);
    for (let it = 0; it < (iters || 30); it++) {
      const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
      for (let i = 0; i < X.length; i++) { const x = X[i], z = x.reduce((a, v, j) => a + v * w[j], 0), p = 1 / (1 + Math.exp(-z)), q = p * (1 - p); for (let j = 0; j < k; j++) { g[j] += (p - y[i]) * x[j]; for (let m = j; m < k; m++) H[j][m] += q * x[j] * x[m]; } }
      for (let j = 0; j < k; j++) { g[j] += l2 * w[j]; H[j][j] += l2; for (let m = 0; m < j; m++) H[j][m] = H[m][j]; }
      const d = solve(H, g); let step = 1, nw, L1;
      for (let t = 0; t < 20; t++) { nw = w.map((v, j) => v - step * d[j]); L1 = loss(nw); if (L1 <= L0) break; step /= 2; }
      if (!(L1 <= L0)) break; const done = L0 - L1 < 1e-6 * X.length; w = nw; L0 = L1; if (done) break;
    }
    return w;
  }
  const sig = z => 1 / (1 + Math.exp(-z));
  // which private spot: own spots (count, departed-from, distance/alignment, recency) vs a new one
  function spotFeat(s, sp) {
    const [lat, lon, , , trk] = s.pos; const d = dist(lat, lon, sp[0], sp[1]);
    const off = trk == null || d < 2 ? 0 : angDiff(trk, brg(lat, lon, sp[0], sp[1]));
    const isStart = dist(sp[0], sp[1], s.start[0], s.start[1]) < 1 ? 1 : 0;
    return [Math.log(1 + sp[2]), Math.log(1 + sp[3]), isStart, Math.log(1 + d), Math.cos(off * rad), Math.log(1 + sp[4] / 24)];
  }
  const QN = ['landings', 'departures', 'isStartSpot', 'logKm', 'alignCos', 'ageDays'];
  function fitSpots(Sx, l2) {
    // conditional logit over [spots..., NEW] ; NEW has its own bias (score = w0)
    const k = QN.length; let w = new Array(k).fill(0), w0 = 0;
    for (let it = 0; it < 250; it++) {
      const g = new Array(k).fill(0); let g0 = 0;
      for (const s of Sx) {
        const fs2 = s.spots.map(sp => spotFeat(s, sp)); const z = fs2.map(f => f.reduce((a, v, j) => a + v * w[j], 0)); z.push(w0);
        const m = Math.max(...z), e = z.map(v => Math.exp(v - m)), Z = e.reduce((a, b) => a + b, 0), p = e.map(v => v / Z);
        const ti = s.truth.spot >= 0 ? s.truth.spot : fs2.length;
        for (let i = 0; i < fs2.length; i++) { const c = p[i] - (i === ti ? 1 : 0); for (let j = 0; j < k; j++) g[j] += c * fs2[i][j]; }
        g0 += p[fs2.length] - (ti === fs2.length ? 1 : 0);
      }
      for (let j = 0; j < k; j++) w[j] -= 0.5 * (g[j] + l2 * w[j]) / Sx.length * 4; w0 -= 0.5 * g0 / Sx.length * 4;
    }
    return { w, w0 };
  }
  function spotProbs(s, m) { const fs2 = s.spots.map(sp => spotFeat(s, sp)); const z = fs2.map(f => f.reduce((a, v, j) => a + v * m.w[j], 0)); z.push(m.w0); const mx = Math.max(...z), e = z.map(v => Math.exp(v - mx)), Z = e.reduce((a, b) => a + b, 0); return e.map(v => v / Z); }
  const folds = [0, 1].map(k => S.filter(s => parseInt(s.hex, 16) % 2 === k));
  const KS = (process.env.KS || '1').split(',').map(Number);
  const RES = KS.map(() => ({ n: 0, base: 0, apRight: 0, offGeneric: 0, offExact: 0, apTruth: 0, offTruth: 0, apHit: 0, wrongPriv: 0 })); let res = RES[0];
  const BYT = KS.map(() => ({})); let byTogo = BYT[0];
  const models = [];
  for (const k of [0, 1]) {
    const tr = folds[1 - k], te = folds[k];
    const wP = lr(tr.map(privFeat), tr.map(s => s.truth.off ? 1 : 0), 1, 40);
    const offTr = tr.filter(s => s.truth.off && s.spots.length);
    const mS = fitSpots(offTr, 0.5);
    models.push({ wP, mS });
    for (const s of te) {
      const pp = sig(privFeat(s).reduce((a, v, j) => a + v * wP[j], 0));
      const q = s.spots.length ? spotProbs(s, mS) : [1];
      for (let ki = 0; ki < KS.length; ki++) { const K = KS[ki]; res = RES[ki]; byTogo = BYT[ki];
      // options: airports (p x (1-pp)), own spots (pp x q_i), a new private spot (pp x q_new)
      let best = { kind: 'ap', id: s.cands[0] ? s.cands[0][0] : 0, v: s.cands[0] ? s.cands[0][1] * (1 - pp) : 0 };
      for (let i = 0; i < s.spots.length; i++) if (pp * q[i] > best.v) best = { kind: 'spot', i, v: pp * q[i] };
      if (pp * q[q.length - 1] > best.v) best = { kind: 'new', v: pp * q[q.length - 1] };
      // (a generic "private site" beats a spread-out airport list: compare the private total to the top airport)
      if (best.kind === 'ap' && pp > K * best.v) { const qi = q.indexOf(Math.max(...q)); best = qi < s.spots.length ? { kind: 'spot', i: qi, v: pp * q[qi] } : { kind: 'new', v: pp }; }
      res.n++;
      const tb = s.togo < 300 ? 'a <5' : s.togo < 900 ? 'b 5-15' : s.togo < 1800 ? 'c 15-30' : 'd 30+';
      const B = byTogo[tb] = byTogo[tb] || { n: 0, base: 0, now: 0, exact: 0 };
      B.n++;
      const baseHit = s.truth.ap && s.cands[0] && s.cands[0][0] === s.truth.ap ? 1 : 0; res.base += baseHit; B.base += baseHit;
      if (s.truth.ap) {
        res.apTruth++; const h = best.kind === 'ap' && best.id === s.truth.ap ? 1 : 0; res.apHit += h; B.now += h; B.exact += h;
        if (best.kind !== 'ap') res.wrongPriv++;
      } else {
        res.offTruth++;
        if (best.kind !== 'ap') { res.offGeneric++; B.now++; if (best.kind === 'spot' && best.i === s.truth.spot) { res.offExact++; B.exact++; } }
      }
      }
    }
  }
  const pc = (a, n) => (100 * a / Math.max(1, n)).toFixed(1) + '%';
  for (let ki = 0; ki < KS.length; ki++) { res = RES[ki]; byTogo = BYT[ki]; console.log('==== K', KS[ki]);
  console.log('samples', res.n, ' airport truth', res.apTruth, ' off-airport truth', res.offTruth);
  console.log('engine alone (always an airport):', pc(res.base, res.n));
  console.log('with private sites: right answer (airport exact, or "private site" when it lands off-airport):', pc(res.apHit + res.offGeneric, res.n));
  console.log('   exact (airport, or the very spot):', pc(res.apHit + res.offExact, res.n));
  console.log('   airport truth kept right:', pc(res.apHit, res.apTruth), ' (engine alone', pc(res.base, res.apTruth) + ')', ' said private wrongly:', pc(res.wrongPriv, res.apTruth));
  console.log('   off-airport truth said private:', pc(res.offGeneric, res.offTruth), ' exact spot:', pc(res.offExact, res.offTruth));
  for (const [k, b] of Object.entries(byTogo).sort()) console.log('  togo', k.padEnd(6), String(b.n).padStart(6), 'engine', pc(b.base, b.n), ' now', pc(b.now, b.n), ' exact', pc(b.exact, b.n));
  }
  const avg = (a, b) => a.map((v, i) => +((v + b[i]) / 2).toFixed(4));
  console.log('P(private) weights', JSON.stringify(Object.fromEntries(PN.map((n, i) => [n, avg(models[0].wP, models[1].wP)[i]]))));
  console.log('spot weights', JSON.stringify(Object.fromEntries(QN.map((n, i) => [n, avg(models[0].mS.w, models[1].mS.w)[i]]))), 'new', ((models[0].mS.w0 + models[1].mS.w0) / 2).toFixed(4));
}
