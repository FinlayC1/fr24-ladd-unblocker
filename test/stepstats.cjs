// How far from their destination are jets right after a step climb, compared with jets simply level at the same height?
// usage: node test/stepstats.cjs <dataDir>
const fs = require('fs');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const dataDir = process.argv[2];
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(dataDir + '/airports.json', 'utf8')).rows);
const NM = 1.852;
const out = { stepped: {}, level: {}, climb: {} };
const aB = a => a < 20000 ? 'lo' : a < 33000 ? 'mid' : 'high';
for (const { ac, pts } of aircraft(dataDir, E, { wide: true })) {
  const cls = E.classify(ac); if (!['bizjet', 'heavybiz', 'airliner'].includes(cls)) continue;
  for (const leg of E.legsFromPoints(pts, {})) {
    const s = E.summarizeLeg(leg, null);
    if (!s.from || !s.to || s.from.id === s.to.id || !['ground', 'low'].includes(s.to.conf)) continue;
    const D = E.byId(s.to.id);
    for (let i = 0; i < leg.pts.length; i += 5) {
      const p = leg.pts[i]; if (p.alt == null || p.vr == null || p.alt < 15000) continue;
      let lo = p.alt, t0 = null; for (let k = i - 1; k >= 0 && p.t - leg.pts[k].t <= 480; k--) { if (leg.pts[k].alt != null && leg.pts[k].alt < lo) lo = leg.pts[k].alt; t0 = leg.pts[k].t; }
      // a step: level now, was at least 1,000 ft lower within 8 min, AND had already been level up there before (not top of climb)
      let wasLevelBefore = false; for (let k = i - 1; k >= 0 && p.t - leg.pts[k].t <= 1800; k--) { const q = leg.pts[k]; if (p.t - q.t > 600 && q.alt != null && Math.abs(q.vr || 0) < 200 && q.alt >= 15000 && p.alt - q.alt >= 1000) { wasLevelBefore = true; break; } }
      const kind = p.vr > 500 ? 'climb' : (Math.abs(p.vr) < 250 && p.alt - lo >= 1000 && wasLevelBefore) ? 'stepped' : Math.abs(p.vr) < 250 ? 'level' : null;
      if (!kind) continue;
      const dNm = E.dist(p.lat, p.lon, D.lat, D.lon) / NM;
      (out[kind][aB(p.alt)] = out[kind][aB(p.alt)] || []).push(dNm);
    }
  }
}
const q = a => { const s = a.slice().sort((x, y) => x - y); return [0.1, 0.25, 0.5, 0.75, 0.9].map(f => Math.round(s[Math.floor(f * (s.length - 1))])); };
for (const k of Object.keys(out)) for (const b of ['lo', 'mid', 'high']) if (out[k][b]) console.log(k.padEnd(8), b.padEnd(5), 'n', String(out[k][b].length).padStart(6), ' distance to go (nm) p10/p25/p50/p75/p90', q(out[k][b]).join(' / '), ' share < 200 nm', (100 * out[k][b].filter(d => d < 200).length / out[k][b].length).toFixed(1) + '%');
