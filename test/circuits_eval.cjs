// "Flying circuits" (engine.circuits) against real flights: every minute of every leg, does it fire, and is the field it
// names where the leg really landed? Also how many legs had circuits merged into them (touch-and-goes, laps).
// usage: node test/circuits_eval.cjs <dataDir> <tables.json> <logit.json> <runways.json> [sets=wide,biz]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const [dataDir, tbl, lg, rw, setsArg] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir); E.setRunways(JSON.parse(fs.readFileSync(rw, 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(tbl, 'utf8'))); E.setLogit(JSON.parse(fs.readFileSync(lg, 'utf8')));
const st = { legs: 0, merged: 0, lapsLegs: 0, moments: 0, fired: 0, right: 0, wrongLanded: 0, wrongOpen: 0, legsFired: 0, legsWrong: 0 };
const wrong = [], byCls = {};
for (const set of (setsArg || 'wide,biz').split(',')) for (const { ac, pts } of aircraft(dataDir, E, { set })) {
  const cls = E.classify(ac), heli = cls === 'heli';
  const legs = E.legsFromPoints(pts, { heli });
  for (const leg of legs) {
    const s = E.summarizeLeg(leg, null); st.legs++; if (leg.laps) { st.merged++; st.lapsLegs += leg.laps; }
    const all = [leg.start].concat(leg.pts), thinAll = []; for (const q of all) if (!thinAll.length || q.t - thinAll[thinAll.length - 1].t >= 15) thinAll.push(q);
    let fired = false, bad = false, ti = 0;
    for (let k = 1; k < all.length; k++) {
      const p = all[k]; if (p.gnd || (k > 1 && p.t - all[k - 1].t < 0)) continue;
      if (Math.floor(p.t / 60) === Math.floor(all[k - 1].t / 60)) continue;      // (once a minute)
      while (ti < thinAll.length && thinAll[ti].t <= p.t) ti++;
      const thin = thinAll.slice(0, ti); if (!thin.length || thin[thin.length - 1] !== p) thin.push(p);
      st.moments++;
      const c = E.circuits(thin, p, { heli, strict: cls === 'milheavy' }); if (!c) continue;
      st.fired++; fired = true;
      if (process.env.CMP) { const hs = E.histStats([], p.t); const O = s.from ? E.byId(s.from.id) : null; const r = E.predict({ ac, pos: p, trail: thin, hs, now: p.t, origin: O ? { airport: O, conf: 'ground', departedAt: leg.start.t } : null }); const top = r && r.cands[0]; st.eng = (st.eng || 0) + (top && s.to && top.airport.id === s.to.id ? 1 : 0); const agree = top && top.airport.id === c.airport.id, ok = !!(s.to && s.to.id === c.airport.id), k = cls.padEnd(10) + (agree ? 'agree ' : 'differ') + (s.from && s.from.id === c.airport.id ? ' at-origin' : ' away'); const g = st.grp = st.grp || {}; g[k] = g[k] || [0, 0, 0]; g[k][0]++; if (ok) g[k][1]++; if (top && s.to && top.airport.id === s.to.id) g[k][2]++; }
      const b = byCls[cls] = byCls[cls] || { fired: 0, wrong: 0 }; b.fired++;
      if (s.to && s.to.id === c.airport.id) st.right++;
      else { bad = true; b.wrong++; if (s.to) st.wrongLanded++; else st.wrongOpen++; if (wrong.length < 40) wrong.push(`${ac.reg || ac.hex} ${ac.type} ${cls} ${new Date(p.t * 1000).toISOString().slice(0, 16)} named ${c.airport.code} (passes ${c.passes}, ${c.dist.toFixed(1)} km) - leg ${s.from ? s.from.code : '?'}>${s.to ? s.to.code : '?'} ${leg.how}`); }
    }
    if (fired) st.legsFired++; if (bad) st.legsWrong++;
  }
}
console.log(JSON.stringify(st));
console.log('precision (moments):', (100 * st.right / Math.max(1, st.fired)).toFixed(1) + '%', ' fired on', (100 * st.fired / st.moments).toFixed(2) + '% of moments');
if (st.grp) for (const k of Object.keys(st.grp).sort()) { const g = st.grp[k]; console.log(k.padEnd(18), String(g[0]).padStart(6), 'circuits right', (100 * g[1] / g[0]).toFixed(1) + '%', ' engine right', (100 * g[2] / g[0]).toFixed(1) + '%'); }
console.log('by class:', JSON.stringify(byCls));
for (const w of wrong) console.log('  ', w);
