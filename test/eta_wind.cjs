// Is the wind-triangle ETA better than today's ground speed? Real flights (archive, evaluation fold), moments with the
// transponder's true airspeed and wind, the true destination: the userscript's ETA (src/main/04-routes.js estimateEta)
// with ground speed / with the ground speed along the course from TAS and wind; the learned correction, pure physics, and
// the blend the userscript uses (the correction, giving way to physics from 3 h out - the correction was learned on
// business jets and runs early on long legs). Errors in minutes against the real landing time, by time to go.
// usage: node test/eta_wind.cjs <dataDir> [shards]
const fs = require('fs');
const path = require('path');
const A = require('./arch.cjs');
const { createRouteEngine } = require('../src/engine.js');
const dataDir = process.argv[2];
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
const NM = 1.852, hexHash = hex => (parseInt(hex, 16) * 2654435761 >>> 0) % 1000003;
const ETA_VC = { jet: 430, tprop: 270, piston: 140 };
const ETA_W = { jet: [0.2336, 0.6075, 0.2763, 0.0185, -0.0044, 0.0997, -0.0046], piston: [0.3514, 1.1339, -0.1605, 0.6831, -0.2675, -0.0657, -0.2145], tprop: [-0.0668, 0.7706, 0.1469, -0.0696, -0.0664, 0.133, -0.0003] };
// mode: 'learned' | 'physics' | 'blend'
function eta(pos, dest, cls, gs0, mode) {
  const dKm = E.dist(pos.lat, pos.lon, dest.lat, dest.lon), gs = gs0 > 60 ? gs0 : 300;
  const descKm = Math.max(0, ((pos.alt || 0) - dest.alt) / 300 * NM), cruiseKm = Math.max(0, dKm - descKm), descentKm = dKm - cruiseKm;
  const h = cruiseKm / (gs * NM) + descentKm / (Math.max(140, gs * 0.72) * NM) + (cls === 'heli' ? 1 : 4) / 60, phys = h * 60;
  const g = E.groupOf(cls), wv = ETA_W[g];
  if (mode === 'physics' || !wv || phys < 45) return phys;
  const vr = pos.vr || 0, climb = vr > 500 ? 1 : 0, desc = vr < -500 ? 1 : 0;
  const x = [1, Math.log(phys + 1), Math.log(dKm / NM / ETA_VC[g] * 60 + 1), climb, desc, Math.log(1 + Math.max(0, (pos.alt || 0) - dest.alt) / 1000), climb * Math.log(phys + 1)];
  const m = Math.exp(x.reduce((s, v, i) => s + v * wv[i], 0)) - 1; if (!(m > 0)) return phys;
  if (mode === 'blend') { const w = Math.min(1, Math.max(0, (phys - 180) / 120)); return (1 - w) * m + w * phys; }
  return m;
}
const run = A.dayPlan(path.join(dataDir, 'arch')).run.slice(-6);
const COLS = ['gs learned', 'wind learned', 'wind physics', 'wind blend'];
const st = {}; const add = (k, errs) => { const s = st[k] = st[k] || { n: 0, abs: COLS.map(() => 0), bias: COLS.map(() => 0) }; s.n++; errs.forEach((e, i) => { s.abs[i] += Math.abs(e); s.bias[i] += e; }); };
const shards = process.argv[3] ? process.argv[3].split(',') : A.SHARDS.filter((_, i) => i % 8 === 0);
for (const sh of shards) for (const { ac, pts } of A.shardAircraft(path.join(dataDir, 'arch'), sh, run, E)) {
  if (hexHash(ac.hex) % 10 !== 0) continue;
  const cls = E.classify(ac), legs = E.legsFromPoints(pts, { heli: cls === 'heli' });
  for (const leg of legs) {
    const s = E.summarizeLeg(leg, null); if (!s.to || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 1800) continue;
    const D = E.byId(s.to.id);
    for (let i = 0; i < leg.pts.length; i += 40) {
      const p = leg.pts[i]; if (!(p.tas > 60) || !Number.isFinite(p.ws) || !Number.isFinite(p.wd) || p.alt == null || p.alt < 10000) continue;
      const togo = (s.tEnd - p.t) / 60; if (togo < 15) continue;
      const gsW = E.gsAlong(E.brg(p.lat, p.lon, D.lat, D.lon), p.tas, p.ws, p.wd), gw = Number.isFinite(gsW) ? gsW : p.gs;
      const errs = [eta(p, D, cls, p.gs, 'learned'), eta(p, D, cls, gw, 'learned'), eta(p, D, cls, gw, 'physics'), eta(p, D, cls, gw, 'blend')].map(v => v - togo);
      const k = togo < 45 ? 'a 15-45 min' : togo < 120 ? 'b 45-120 min' : togo < 300 ? 'c 2-5 h' : 'd 5 h+';
      add(k, errs); add('ALL', errs); if (p.ws >= 50) add('wind 50 kt+', errs);
    }
  }
}
console.log('time to go        moments  mean absolute error, min (bias):  ' + COLS.join(' | '));
for (const k of Object.keys(st).sort()) { const s = st[k]; console.log(k.padEnd(16), String(s.n).padStart(8), '  ', COLS.map((_, i) => `${(s.abs[i] / s.n).toFixed(1).padStart(5)} (${(s.bias[i] / s.n).toFixed(1).padStart(6)})`).join('  ')); }
