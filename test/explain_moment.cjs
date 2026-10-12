// One evaluation moment explained: the engine's top answers and the truth with every evidence term that went into
// their scores - to see what drove a confident wrong answer.
// usage: node test/explain_moment.cjs <dataDir> <tables prefix> <logit.json> <hex> <unix t>
const fs = require('fs');
const path = require('path');
const A = require('./arch.cjs');
const { createRouteEngine } = require(process.env.ENGINE_SRC || '../src/engine.js');
const [dataDir, tables, logit, hex, tArg] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(tables + '_tb.json', 'utf8'))); E.setTables2(JSON.parse(fs.readFileSync(tables + '_t2.json', 'utf8')));
E.setLogit(JSON.parse(fs.readFileSync(logit, 'utf8')));
const archDir = path.join(dataDir, 'arch'), run = A.dayPlan(archDir).run, t = +tArg;
for (const { ac, pts } of A.shardAircraft(archDir, hex.slice(-2), run, E, { want: new Set([hex]) })) {
  const cls = E.classify(ac), legs = E.legsFromPoints(pts, { heli: cls === 'heli' }), sums = legs.map(l => E.summarizeLeg(l, null));
  const li = sums.findIndex(s => s.tStart <= t && t <= s.tEnd + 60); if (li < 0) { console.log('no leg at', t); break; }
  const leg = legs[li], s = sums[li], D = E.byId(s.to.id), O = E.byId(s.from.id);
  const chained = E.chainLegs(E.stitchLegs(sums.map(x => Object.assign({}, x)))), hs = E.histStats(chained.filter(h => h.tEnd < s.tStart - 60), s.tStart);
  const all = [leg.start].concat(leg.pts); let idx = -1; for (let i = 0; i < all.length; i++) if (all[i].t <= t) idx = i;
  const pos = all[idx], thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
  const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, explain: true, explainIds: [D.id] });
  console.log(`${ac.reg} ${ac.type} (${cls}) ${O.code} -> ${D.code}, cs ${pos.cs}, ${pos.alt} ft trk ${Math.round(pos.trk)} ${r.phase}, ${Math.round((s.tEnd - t) / 60)} min to go; history ${hs.n} legs, base ${hs.base ? E.byId(hs.base).code : '-'}`);
  const show = (code, terms, p, rank) => console.log(`  ${code.padEnd(5)} ${p != null ? (p * 100).toFixed(0).padStart(3) + '%' : '   '} ${rank != null ? '#' + rank : ''}  ` + Object.entries(terms || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 14).map(([k, v]) => k + ' ' + v.toFixed(2)).join('  '));
  for (const c of r.cands.slice(0, 3)) show(c.airport.code, c.terms, c.p);
  for (const x of r.explained || []) show('TRUTH ' + x.airport.code, x.terms, null, x.rank);
}
