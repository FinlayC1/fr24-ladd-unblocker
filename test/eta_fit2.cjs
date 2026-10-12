// The ETA correction (src/main/04-routes.js ETA_W) refitted on the archive: log(minutes to go + 1) as a linear function
// of the physics estimate (cruise at the wind-triangle ground speed along the course - or today's ground speed when the
// transponder sends no airspeed - then the descent), the trip at the class's usual speed, climbing / descending, height,
// by group (jet, turboprop, piston). Fitted on the training aircraft, scored on the evaluation fold.
// usage: node test/eta_fit2.cjs <dataDir>
const fs = require('fs');
const path = require('path');
const A = require('./arch.cjs');
const { createRouteEngine } = require('../src/engine.js');
const dataDir = process.argv[2];
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
const NM = 1.852, hexHash = hex => (parseInt(hex, 16) * 2654435761 >>> 0) % 1000003;
const VC = { jet: 430, tprop: 270, piston: 140 };
const OLD = { jet: [0.2336, 0.6075, 0.2763, 0.0185, -0.0044, 0.0997, -0.0046], piston: [0.3514, 1.1339, -0.1605, 0.6831, -0.2675, -0.0657, -0.2145], tprop: [-0.0668, 0.7706, 0.1469, -0.0696, -0.0664, 0.133, -0.0003] };
function physics(p, D, cls, gs0) { const dKm = E.dist(p.lat, p.lon, D.lat, D.lon), gs = gs0 > 60 ? gs0 : 300, descKm = Math.max(0, ((p.alt || 0) - D.alt) / 300 * NM), cruiseKm = Math.max(0, dKm - descKm), descentKm = dKm - cruiseKm; return { dKm, m: (cruiseKm / (gs * NM) + descentKm / (Math.max(140, gs * 0.72) * NM) + (cls === 'heli' ? 1 : 4) / 60) * 60 }; }
const feats = (p, D, g, base, dKm) => { const vr = p.vr || 0, climb = vr > 500 ? 1 : 0, desc = vr < -500 ? 1 : 0; return [1, Math.log(base + 1), Math.log(dKm / NM / VC[g] * 60 + 1), climb, desc, Math.log(1 + Math.max(0, (p.alt || 0) - D.alt) / 1000), climb * Math.log(base + 1)]; };
const data = { jet: { tr: [], te: [] }, tprop: { tr: [], te: [] }, piston: { tr: [], te: [] } };
const run = A.dayPlan(path.join(dataDir, 'arch')).run.slice(-6);
for (const sh of A.SHARDS.filter((_, i) => i % 4 === 0)) for (const { ac, pts } of A.shardAircraft(path.join(dataDir, 'arch'), sh, run, E)) {
  const cls = E.classify(ac), g = E.groupOf(cls); if (!data[g]) continue;
  const test = hexHash(ac.hex) % 10 === 0;
  if (cls === 'airliner' && !test && Math.random() > 0.2) continue;
  for (const leg of E.legsFromPoints(pts, { heli: cls === 'heli' })) {
    const s = E.summarizeLeg(leg, null); if (!s.to || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 1200) continue;
    const D = E.byId(s.to.id);
    for (let i = 0; i < leg.pts.length; i += 30) {
      const p = leg.pts[i]; if (p.alt == null || p.gnd) continue;
      const togo = (s.tEnd - p.t) / 60; if (togo < 45) continue;      // (the correction applies from 45 minutes out)
      const gsW = p.tas > 60 && Number.isFinite(p.ws) && Number.isFinite(p.wd) ? E.gsAlong(E.brg(p.lat, p.lon, D.lat, D.lon), p.tas, p.ws, p.wd) : NaN;
      const ph = physics(p, D, cls, Number.isFinite(gsW) ? gsW : p.gs), x = feats(p, D, g, ph.m, ph.dKm);
      const phOld = physics(p, D, cls, p.gs), xOld = feats(p, D, g, phOld.m, phOld.dKm);
      (test ? data[g].te : data[g].tr).push({ x, xOld, y: Math.log(togo + 1), togo, phys: ph.m });
    }
  }
}
// least squares (ridge 1e-3) in log space
function solve(rows) {
  const n = rows[0].x.length, M = Array.from({ length: n }, () => new Float64Array(n)), v = new Float64Array(n);
  for (const r of rows) for (let i = 0; i < n; i++) { v[i] += r.x[i] * r.y; for (let j = 0; j < n; j++) M[i][j] += r.x[i] * r.x[j]; }
  for (let i = 0; i < n; i++) M[i][i] += 1e-3 * rows.length;
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; [v[c], v[p]] = [v[p], v[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < n; k++) M[r][k] -= f * M[c][k]; v[r] -= f * v[c]; } }
  return Array.from({ length: n }, (_, i) => +(v[i] / M[i][i]).toFixed(4));
}
const pred = (w, x) => Math.exp(x.reduce((s, v, i) => s + v * w[i], 0)) - 1;
const out = {};
for (const [g, d] of Object.entries(data)) {
  if (d.tr.length < 200) continue;
  const w = solve(d.tr); out[g] = w;
  const err = (f) => { const b = {}; for (const r of d.te) { const k = r.togo < 120 ? 'a 45-120 min' : r.togo < 300 ? 'b 2-5 h' : 'c 5 h+'; const e = f(r) - r.togo; const s = b[k] = b[k] || [0, 0, 0]; s[0]++; s[1] += Math.abs(e); s[2] += e; } return b; };
  const eOld = err(r => pred(OLD[g], r.xOld)), eNew = err(r => pred(w, r.x)), ePhys = err(r => r.phys);
  console.log(g, 'train', d.tr.length, 'test', d.te.length, 'weights', JSON.stringify(w));
  for (const k of Object.keys(eNew).sort()) { const f = s => s ? `${(s[1] / s[0]).toFixed(1)} (bias ${(s[2] / s[0]).toFixed(1)})` : '-'; console.log('   ', k.padEnd(14), String(eNew[k][0]).padStart(6), ' old', f(eOld[k]).padEnd(22), ' physics+wind', f(ePhys[k]).padEnd(22), ' refit', f(eNew[k])); }
}
console.log(JSON.stringify(out));
