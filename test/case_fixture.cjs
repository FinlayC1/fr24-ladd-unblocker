// A reported flight replayed from saved traces: test/fixtures/<set>/<hex>/<YYYY-MM-DD>.json (history, adsb.lol for the
// last 40 days and airplanes.live before) + <hex>.today.json. Prints the top picks every few minutes of the leg that
// covers <HH:MM>, with the history the engine had (DAYS=n: only the last n days of it).
// usage: node test/case_fixture.cjs <dataDir> <fixtureDir> <hex> <YYYY-MM-DD> <HH:MM> [stepMin=5]
//   env: DAYS (history days, default 220), TABLES / LOGIT / T2 (population tables), TERMS=1, CTRY, MIL=1, ONLY=HH:MM (just that moment)
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require(process.env.ENGINE_SRC || '../src/engine.js');
const [dataDir, fxDir, hex, date, hm, stepArg] = process.argv.slice(2);
const root = path.join(__dirname, '..');
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); require('./dataset.cjs').withFields(E, dataDir);
E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(process.env.TABLES || path.join(root, 'src', 'tables.json'), 'utf8')));
E.setLogit(JSON.parse(fs.readFileSync(process.env.LOGIT || path.join(root, 'src', 'logit.json'), 'utf8')));
if (E.setTables2 && (process.env.T2 || fs.existsSync(path.join(root, 'src', 'tables2.json')))) E.setTables2(JSON.parse(fs.readFileSync(process.env.T2 || path.join(root, 'src', 'tables2.json'), 'utf8')));
if (process.env.W) E.setWeights(JSON.parse(process.env.W));
const d0 = Date.parse(date + 'T00:00:00Z') / 1000, days = +(process.env.DAYS || 220), step = +(stepArg || 5) * 60;
const pts = []; let meta = null;
const files = fs.readdirSync(path.join(fxDir, hex)).filter(f => /\.json$/.test(f) && Date.parse(f.slice(0, 10) + 'T00:00:00Z') / 1000 >= d0 - days * 86400).sort();
for (const f of files.map(f => path.join(fxDir, hex, f)).concat([path.join(fxDir, hex + '.today.json')])) {
  if (!fs.existsSync(f)) continue;
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!meta || !meta.t) meta = j; for (const p of E.parseTrace(j)) pts.push(p); } catch (e) { /* none */ }
}
pts.sort((a, b) => a.t - b.t);
const uniq = []; for (const p of pts) if (!uniq.length || p.t > uniq[uniq.length - 1].t) uniq.push(p);
const ac = { hex, type: (meta && meta.t) || '', reg: (meta && meta.r) || '', mil: !!process.env.MIL || !!((meta && meta.dbFlags) & 1), country: process.env.CTRY || '' };
const cls = E.classify(ac);
const legs = E.legsFromPoints(uniq, { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy' }), sums = legs.map(l => E.summarizeLeg(l, null));
const [H, M] = hm.split(':').map(Number), tWant = d0 + H * 3600 + M * 60;
let li = -1; for (let i = 0; i < legs.length; i++) if (sums[i].tStart <= tWant + 60 && (li < 0 || sums[i].tStart > sums[li].tStart)) li = i;
if (li < 0) { console.log('no leg at', hm); process.exit(1); }
const leg = legs[li], s = sums[li];
const hh = t => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
const code = x => x ? (E.byId(x.id) || {}).code || '?' : '?';
const hist = E.chainLegs(E.stitchLegs(sums.slice(0, li).map(x => Object.assign({}, x))));
const hs = E.histStats(hist, s.tStart);
console.log(`${ac.reg} ${ac.type} (${cls}) - ${legs.length} legs in ${days} days; this leg ${hh(s.tStart)} ${code(s.from)} -> ${code(s.to)} (${leg.how})`);
console.log(`history: ${hs.n} legs, base ${hs.base ? E.byId(hs.base).code : '-'}, away ${hs.awayDays.toFixed(1)} days; top visits: ${[...hs.visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => E.byId(id).code + ' ' + n).join(', ')}`);
console.log('last legs:', sums.slice(Math.max(0, li - 10), li).map(x => `${hh(x.tStart).slice(0, 5)} ${code(x.from)}>${code(x.to)}`).join(' | '));
const all = [leg.start].concat(leg.pts);
const only = process.env.ONLY ? (([h, m]) => d0 + h * 3600 + m * 60)(process.env.ONLY.split(':').map(Number)) : null;
const out = [];
for (let tt = only || s.tStart + 120; tt <= (only || s.tEnd); tt += step) {
  let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
  if (idx < 1 || all[idx].gnd) continue;
  const pos = Object.assign({}, all[idx]), thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
  const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, explain: !!process.env.TERMS });
  const c = r.cands;
  const line = `${hh(pos.t).slice(6)} ${String(pos.alt).padStart(6)} ft ${String(Math.round(pos.gs || 0)).padStart(3)} kt trk ${String(Math.round(pos.trk || 0)).padStart(3)} ${r.phase.padEnd(7)} | ` + c.slice(0, 4).map(x => `${x.airport.code} ${(x.p * 100).toFixed(0)}%`).join('  ') + ` | ${(c[0].reasons || []).join(', ')}`;
  console.log(line); out.push({ t: pos.t, top: c[0] && c[0].airport.code, p: c[0] && c[0].p, truth: code(s.to) });
  if (process.env.TERMS) for (const x of c.slice(0, 3)) console.log('     ', x.airport.code, Object.entries(x.terms || {}).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 12).map(([k, v]) => k + ' ' + v.toFixed(2)).join(' '));
}
if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(out));
