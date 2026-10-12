// Arrival-time model: learns time-to-landing (given the true destination) from real flights, per aircraft group, as a
// small linear model on physical quantities; compared with the current formula on held-out aircraft.
// usage: node test/eta_fit.cjs <dataDir> [--sets=big] [--every=3] [--out=eta.json]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const args = process.argv.slice(2), dataDir = args.find(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
const NM = 1.852, every = +opt('every', 3), LOG = !args.includes('--linear');
// typical cruise ground speed by group (kt) - a prior the model can lean on while climbing
const VC = { jet: 430, tprop: 270, piston: 140, heli: 115, fighter: 420 };
// the features: the model is t_min = w . x
function feats(g, d, gs, altAbove, phase, base) {
  if (LOG) { const vc = VC[g] || 300; return [1, Math.log(base + 1), Math.log(d / NM / vc * 60 + 1), phase === 'climb' ? 1 : 0, phase === 'descent' ? 1 : 0, Math.log(1 + Math.max(0, altAbove) / 1000), phase === 'climb' ? Math.log(base + 1) : 0]; }
  const v = gs > 60 ? gs : VC[g] * 0.7, vc = VC[g] || 300;
  const hrs = km => km / NM / 60;   // km at 1 kt -> minutes factor: (km/NM)/kt*60 = min
  return [1, hrs(d) * 60 / v, hrs(d) * 60 / vc, Math.max(0, altAbove) / 1000, phase === 'climb' ? hrs(d) * 60 / v : 0, phase === 'descent' ? hrs(d) * 60 / v : 0, phase === 'descent' ? 1 : 0, d < 30 ? 1 : 0];
}
function currentFormula(pos, D, cls) {
  const dKm = E.dist(pos.lat, pos.lon, D.lat, D.lon), gs = pos.gs > 60 ? pos.gs : 300;
  const descKm = Math.max(0, ((pos.alt || 0) - D.alt) / 300 * NM), cruiseKm = Math.max(0, dKm - descKm), descentKm = dKm - cruiseKm;
  return (cruiseKm / (gs * NM) + descentKm / (Math.max(140, gs * 0.72) * NM) + (cls === 'heli' ? 1 : 4) / 60) * 60;
}
const rows = [];
let lc = 0;
for (const set of opt('sets', 'big').split(',')) for (const { ac, pts } of aircraft(dataDir, E, { set })) {
  const cls = E.classify(ac), g = E.groupOf(cls), fold = parseInt(ac.hex, 16) % 2;
  for (const leg of E.legsFromPoints(pts, { heli: cls === 'heli' })) {
    const s = E.summarizeLeg(leg, null);
    if (!s.from || !s.to || s.from.id === s.to.id || s.to.conf !== 'ground' || s.tEnd - s.tStart < 600) continue;
    if ((lc++ % every) !== 0) continue;
    const D = E.byId(s.to.id), all = [leg.start].concat(leg.pts);
    for (let tt = s.tStart + 300; tt < s.tEnd - 60; tt += 600) {
      let i = -1; for (let k = 0; k < all.length; k++) { if (all[k].t <= tt) i = k; else break; }
      const p = all[i]; if (!p || p.gnd || p.alt == null || !(p.gs > 0) || tt - p.t > 120) continue;
      const trail = all.slice(Math.max(0, i - 30), i + 1), phase = E.predict ? null : null;
      let vr = p.vr; if (!Number.isFinite(vr)) { const q = trail.find(x => p.t - x.t >= 60 && x.alt != null); vr = q ? (p.alt - q.alt) / ((p.t - q.t) / 60) : 0; }
      const ph = vr > 500 ? 'climb' : vr < -500 ? 'descent' : 'level';
      const d = E.dist(p.lat, p.lon, D.lat, D.lon), y = (s.tEnd - p.t) / 60;
      if (y > 1000) continue;
      const base = currentFormula(p, D, cls);
      rows.push({ g, fold, x: feats(g, d, p.gs, p.alt - D.alt, ph, base), y: LOG ? Math.log(y + 1) : y, base, yb: y });
    }
  }
}
console.log('samples', rows.length);
// least squares (normal equations with a small ridge), per group, per training fold
function solve(X, Y) {
  const n = X[0].length, A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n);
  for (let r = 0; r < X.length; r++) { const x = X[r]; for (let i = 0; i < n; i++) { b[i] += x[i] * Y[r]; for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j]; } }
  for (let i = 0; i < n; i++) A[i][i] += 1e-3 * X.length;
  // Gaussian elimination
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((row, i) => row[n] / row[i]);
}
const groups = [...new Set(rows.map(r => r.g))], model = {}, st = {};
const band = y => y < 15 ? 'a <15 min' : y < 45 ? 'b 15-45' : y < 120 ? 'c 45-120' : 'd 120+';
const add = (k, e0, e1, y) => { const s = st[k] = st[k] || { n: 0, e0: 0, e1: 0, w0: 0, w1: 0 }; s.n++; s.e0 += Math.abs(e0); s.e1 += Math.abs(e1); const tol = Math.max(5, 0.1 * y); s.w0 += Math.abs(e0) <= tol; s.w1 += Math.abs(e1) <= tol; };
for (const g of groups) {
  for (const k of [0, 1]) {
    const tr = rows.filter(r => r.g === g && r.fold !== k); if (tr.length < 200) continue;
    const w = solve(tr.map(r => r.x), tr.map(r => r.y));
    for (const r of rows) if (r.g === g && r.fold === k) { let p = r.x.reduce((s, v, i) => s + v * w[i], 0); if (LOG) p = Math.exp(p) - 1; add(g + ' ' + band(r.yb), r.base - r.yb, p - r.yb, r.yb); add('ALL', r.base - r.yb, p - r.yb, r.yb); }
  }
  const all = rows.filter(r => r.g === g); if (all.length >= 200) model[g] = solve(all.map(r => r.x), all.map(r => r.y)).map(v => +v.toFixed(4));
}
console.log('held-out: mean abs error (min) and share within max(5 min, 10%) - current formula vs learned');
for (const k of Object.keys(st).sort()) { const s = st[k]; console.log(k.padEnd(18), String(s.n).padStart(6), 'MAE', (s.e0 / s.n).toFixed(1).padStart(6), '->', (s.e1 / s.n).toFixed(1).padStart(6), '  within', (100 * s.w0 / s.n).toFixed(0).padStart(3) + '%', '->', (100 * s.w1 / s.n).toFixed(0).padStart(3) + '%'); }
fs.writeFileSync(opt('out', path.join(dataDir, '..', 'eta_model.json')), JSON.stringify({ vc: VC, log: LOG, w: model }));
console.log('model', JSON.stringify(model));
