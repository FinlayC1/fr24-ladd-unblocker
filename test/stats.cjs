// Empirical distributions from real legs, used to shape the engine's likelihood terms.
// usage: node test/stats.cjs <dataDir>
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const dataDir = process.argv[2];
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
const sample = JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8'));
const NM = 1.852;
const q = (arr, p) => { if (!arr.length) return NaN; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const off = {}, xt = {}, desc = {}, cruise = {}, trip = {}, lowLevel = {};
const push = (o, k, v) => (o[k] = o[k] || []).push(v);
const dBin = d => d < 15 ? '0005-15' : d < 30 ? '0015-30' : d < 60 ? '0030-60' : d < 120 ? '0060-120' : d < 250 ? '0120-250' : d < 500 ? '0250-500' : d < 1000 ? '0500-1000' : '1000+';
for (const ac0 of sample) {
  const dir = path.join(dataDir, 'traces', ac0.hex); if (!fs.existsSync(dir)) continue;
  let pts = [], meta = null;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); meta = meta || j; pts = pts.concat(E.parseTrace(j)); }
  if (!meta) continue;
  pts.sort((a, b) => a.t - b.t); pts = pts.filter((p, i) => !i || p.t > pts[i - 1].t);
  const ac = { type: meta.t, mil: !!(meta.dbFlags & 1), cat: (pts.find(p => p.cat) || {}).cat };
  const cls = E.classify(ac);
  const grp = ['bizjet', 'heavybiz', 'airliner', 'milheavy'].includes(cls) ? 'jet' : cls;
  const legs = E.legsFromPoints(pts, { heli: cls === 'heli' });
  for (const leg of legs) {
    const s = E.summarizeLeg(leg, null);
    if (!s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf)) continue;
    const O = E.byId(s.from.id), D = E.byId(s.to.id);
    const dOD = E.dist(O.lat, O.lon, D.lat, D.lon);
    if (s.tEnd - s.tStart < 480) continue;
    push(trip, grp, dOD);
    if (dOD > 30) push(cruise, grp + '|' + (dOD / NM < 100 ? '000-100' : dOD / NM < 200 ? '100-200' : dOD / NM < 400 ? '200-400' : dOD / NM < 800 ? '400-800' : dOD / NM < 1600 ? '800-1600' : '1600+'), s.maxAlt);
    const all = leg.pts;
    for (let i = 5; i < all.length; i += 7) {
      const p = all[i]; if (p.alt == null) continue;
      const d = E.dist(p.lat, p.lon, D.lat, D.lon);
      if (p.trk != null && d > 5) push(off, grp + '|' + dBin(d), E.angDiff(p.trk, E.brg(p.lat, p.lon, D.lat, D.lon)));
      const dOP = E.dist(O.lat, O.lon, p.lat, p.lon);
      if (dOD > 60 && dOP > 25 && d > 25) { const [x] = E.xtat(O.lat, O.lon, D.lat, D.lon, p.lat, p.lon); push(xt, grp + '|' + (dOD < 300 ? 'short' : dOD < 1000 ? 'med' : 'long'), Math.abs(x) / dOD); }
      const vr = p.vr;
      if (vr != null && vr < -500 && p.alt > 2000) { const agl = p.alt - D.alt; push(desc, grp + '|' + (p.alt < 10000 ? 'low' : 'high'), (d / NM) / (agl / 300)); }
      if (vr != null && Math.abs(vr) < 200 && p.alt > 3000 && p.alt < 18000 && grp === 'jet') push(lowLevel, (Math.round(p.alt / 4000) * 4) + 'k', d / NM);
    }
  }
}
const show = (name, o, qs, fmt = v => v.toFixed(1)) => { console.log('\n## ' + name); for (const k of Object.keys(o).sort()) console.log(k.padEnd(22), String(o[k].length).padStart(6), qs.map(p => `p${Math.round(p * 100)}=${fmt(q(o[k], p))}`).join(' ')); };
show('heading offset (deg) by class|distance-to-go (km)', off, [0.5, 0.75, 0.9, 0.95]);
show('cross-track / route length', xt, [0.5, 0.75, 0.9, 0.95], v => v.toFixed(3));
show('descent: distance-to-go / (AGL/300 ft per nm)', desc, [0.05, 0.25, 0.5, 0.75, 0.95], v => v.toFixed(2));
show('cruise (max) altitude by class|trip nm', cruise, [0.1, 0.25, 0.5, 0.75, 0.9], v => String(Math.round(v / 100)));
show('trip great-circle km by class', trip, [0.1, 0.25, 0.5, 0.75, 0.9], v => String(Math.round(v)));
show('jets level at altitude: remaining nm', lowLevel, [0.25, 0.5, 0.75, 0.9], v => String(Math.round(v)));
