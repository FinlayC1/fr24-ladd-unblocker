// End-to-end check of the engine's helicopter private-site layer (engine.privateSite) on real tracks: same sampling
// as heli_eval.cjs (every 6 min of every landed leg, held-out folds), but the decision is the shipped code's.
// usage: node test/heli_check.cjs <dataDir> <tables prefix> <logit prefix> <runways.json>
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const { loadSites, siteGrid } = require('./sites.cjs');
const [dataDir, tbl, lg, rw] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows, RW = JSON.parse(fs.readFileSync(rw, 'utf8'));
const engines = [0, 1].map(k => { const E = createRouteEngine(); E.setAirports(rows); E.setRunways(RW); E.setTables(JSON.parse(fs.readFileSync(`${tbl}_f${k}.json`, 'utf8'))); E.setLogit(JSON.parse(fs.readFileSync(`${lg}_f${k}.json`, 'utf8'))); if (process.env.W) E.setWeights(JSON.parse(process.env.W)); return E; });
const GH = siteGrid(loadSites(path.join(dataDir, 'oa_airports.csv')).filter(r => r[2] === 'H'));
const heliport = (lat, lon, km) => { const n = GH.near(lat, lon, km); return n ? { lat: n.site[0], lon: n.site[1], dist: n.dist, name: n.site[3] } : null; };
const E0 = engines[0];
const st = { n: 0, base: 0, right: 0, exact: 0, apT: 0, apHit: 0, offT: 0, offPriv: 0, offSpot: 0, wrongPriv: 0, named: 0, namedRight: 0 }, by = {};
const seen = new Set(); let nAc = 0; const every = +(process.env.EVERY || 1); let k = 0;
for (const set of (process.env.SETS || 'big,wide').split(',')) for (const { ac, pts } of aircraft(dataDir, E0, { set })) {
  if (seen.has(ac.hex)) continue; seen.add(ac.hex);
  const E = engines[parseInt(ac.hex, 16) % 2], cls = E.classify(ac); if (cls !== 'heli') continue; nAc++;
  const legs = E.legsFromPoints(pts, { heli: true }), sums = legs.map(l => E.summarizeLeg(l, process.env.CTX ? { grp: 'heli', visits: new Map(), base: 0, mil: !!ac.mil } : null));
  const hist = E.chainLegs(E.stitchLegs(sums.map(s => Object.assign({}, s))));
  for (let li = 0; li < legs.length; li++) {
    const leg = legs[li], s = sums[li];
    if (!E.landedSum(s) || s.tEnd - s.tStart < 300) continue;
    if ((k++ % every) !== 0) continue;
    const tAp = E.heliAirportAt(s.endLat, s.endLon);
    const before = hist.filter(h => h.tEnd < s.tStart - 60), hs = E.histStats(before, s.tStart), all = [leg.start].concat(leg.pts);
    for (let tt = s.tStart + 120 + (parseInt(ac.hex, 16) % 61) / 61 * 360; tt < s.tEnd - 45; tt += 360) {
      let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
      if (idx < 1 || all[idx].gnd) continue;
      const pos = Object.assign({}, all[idx]), thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
      if (!Number.isFinite(pos.vr)) for (let i = idx - 1; i >= 0; i--) if (pos.t - all[i].t >= 45 && all[i].alt != null && pos.alt != null) { pos.vr = (pos.alt - all[i].alt) / ((pos.t - all[i].t) / 60); break; }
      const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t });
      const ps = E.privateSite({ pos, legs: before, cands: r ? r.cands : [], legStart: s.tStart, start: { lat: s.startLat, lon: s.startLon, gnd: s.startedOnGround }, heliport });
      const top = r && r.cands[0];
      st.n++;
      const tb = (s.tEnd - tt) < 300 ? 'a <5' : (s.tEnd - tt) < 900 ? 'b 5-15' : (s.tEnd - tt) < 1800 ? 'c 15-30' : 'd 30+';
      const B = by[tb] = by[tb] || { n: 0, base: 0, right: 0 }; B.n++;
      const priv = ps && ps.choice !== 'ap';
      if (tAp) {
        st.apT++; const b = top && top.airport.id === tAp.airport.id ? 1 : 0; st.base += b; B.base += b;
        if (!priv && b) { st.apHit++; st.right++; st.exact++; B.right++; }
        if (priv) st.wrongPriv++;
      } else {
        st.offT++;
        if (priv) {
          st.offPriv++; st.right++; B.right++;
          if (ps.spot && E.dist(ps.spot.lat, ps.spot.lon, s.endLat, s.endLon) < 1) { st.offSpot++; st.exact++; }
        }
      }
    }
  }
}
const pc = (a, n) => (100 * a / Math.max(1, n)).toFixed(1) + '%';
console.log('helicopters', nAc, 'samples', st.n, 'airport truth', st.apT, 'off-airport truth', st.offT);
console.log('engine alone', pc(st.base, st.n), ' with private sites: right', pc(st.right, st.n), ' exact', pc(st.exact, st.n));
console.log('airport truth kept', pc(st.apHit, st.apT), ' (alone', pc(st.base, st.apT) + ')', ' said private wrongly', pc(st.wrongPriv, st.apT));
console.log('off-airport truth said private', pc(st.offPriv, st.offT), ' exact spot', pc(st.offSpot, st.offT));
for (const [kk, b] of Object.entries(by).sort()) console.log('  togo', kk.padEnd(7), String(b.n).padStart(6), 'engine', pc(b.base, b.n), ' now', pc(b.right, b.n));
