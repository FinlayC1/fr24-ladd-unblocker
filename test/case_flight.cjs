// One real flight, replayed through the engine every few minutes with the aircraft's own history before it (adsb.lol
// globe_history, cached): the top picks with probability, the reasons shown, the home base the history gives.
// usage: node test/case_flight.cjs <dataDir> <hex> <type> <YYYY-MM-DD> <HH:MM leg start (UTC)> [days=60] [stepMin=5]
//   env: MIL=1, CTRY=<registration country>, TABLES / LOGIT (other weights)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, hex, type, date, hm, daysArg, stepArg] = process.argv.slice(2);
const root = path.join(__dirname, '..');
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); require('./dataset.cjs').withFields(E, dataDir);
E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(process.env.TABLES || path.join(root, 'src', 'tables.json'), 'utf8')));
E.setLogit(JSON.parse(fs.readFileSync(process.env.LOGIT || path.join(root, 'src', 'logit.json'), 'utf8')));
const cache = path.join(dataDir, '..', 'casecache'); fs.mkdirSync(cache, { recursive: true });
const get = url => { const f = path.join(cache, url.replace(/[^a-z0-9]/gi, '_')); if (fs.existsSync(f) && fs.statSync(f).size > 0) return fs.readFileSync(f, 'utf8'); let t = ''; try { t = execFileSync('curl', ['-s', '--compressed', '-A', 'Mozilla/5.0', url], { maxBuffer: 64e6 }).toString(); } catch (e) { t = ''; } fs.writeFileSync(f, t); return t; };
const d0 = Date.parse(date + 'T00:00:00Z') / 1000, days = +(daysArg || 60), step = +(stepArg || 5) * 60;
const pts = []; let meta = null;
for (let back = days; back >= 0; back--) {
  const ds = new Date((d0 - back * 86400) * 1000).toISOString().slice(0, 10).replace(/-/g, '/');
  const txt = get(`https://adsb.lol/globe_history/${ds}/traces/${hex.slice(-2)}/trace_full_${hex}.json`);
  try { const j = JSON.parse(txt); meta = meta || j; for (const p of E.parseTrace(j)) pts.push(p); } catch (e) { /* none that day */ }
}
pts.sort((a, b) => a.t - b.t);
const uniq = []; for (const p of pts) if (!uniq.length || p.t > uniq[uniq.length - 1].t) uniq.push(p);
const ac = { hex, type, reg: (meta && meta.r) || '', mil: !!process.env.MIL, country: process.env.CTRY || '' };
const cls = E.classify(ac);
const legs = E.legsFromPoints(uniq, { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy' }), sums = legs.map(l => E.summarizeLeg(l, null));
const [H, M] = hm.split(':').map(Number), tWant = d0 + H * 3600 + M * 60;
let li = 0; for (let i = 0; i < legs.length; i++) if (Math.abs(sums[i].tStart - tWant) < Math.abs(sums[li].tStart - tWant)) li = i;
const leg = legs[li], s = sums[li];
const hh = t => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
const code = x => x ? (E.byId(x.id) || {}).code || '?' : '?';
const hist = E.chainLegs(E.stitchLegs(sums.slice(0, li).map(x => Object.assign({}, x))));
const hs = E.histStats(hist, s.tStart);
console.log(`${ac.reg} ${type} (${cls}) - ${legs.length} legs in ${days} days; this leg ${hh(s.tStart)} ${code(s.from)} -> ${code(s.to)} (${leg.how})`);
console.log(`history: ${hs.n} legs, base ${hs.base ? E.byId(hs.base).code : '-'}, away ${hs.awayDays} days; top visits: ${[...hs.visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => E.byId(id).code + ' ' + n).join(', ')}; nights: ${[...(hs.nights || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => E.byId(id).code + ' ' + n).join(', ')}`);
console.log('last legs:', sums.slice(Math.max(0, li - 12), li).map(x => `${hh(x.tStart).slice(6)} ${code(x.from)}>${code(x.to)}`).join(' | '));
const all = [leg.start].concat(leg.pts), O = process.env.ORIG ? E.byIcao(process.env.ORIG) : s.from ? E.byId(s.from.id) : null;
for (let tt = s.tStart + 120; tt <= s.tEnd; tt += step) {
  let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
  if (idx < 1 || all[idx].gnd) continue;
  const pos = Object.assign({}, all[idx]), thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
  const inf = process.env.INFER ? E.inferOrigin({ ac, pos, trail: thin, hs, now: pos.t }) : null;
  const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, origin: inf || (O ? { airport: O, conf: process.env.ORIG ? 'history' : s.from.conf, departedAt: s.tStart } : undefined), explain: !!process.env.TERMS });
  if (inf && tt === s.tStart + 120) console.log('   origin inferred:', inf.airport ? inf.airport.code : '-', inf.conf, inf.note);
  const c = r.cands, circ = E.circuits(thin, pos, { heli: cls === 'heli' });
  console.log(`${hh(pos.t).slice(6)} ${String(pos.alt).padStart(6)} ft ${String(Math.round(pos.gs || 0)).padStart(3)} kt trk ${String(Math.round(pos.trk || 0)).padStart(3)} ${r.phase.padEnd(7)} | ` + c.slice(0, 3).map(x => `${x.airport.code} ${(x.p * 100).toFixed(0)}%`).join('  ') + ` | ${[...new Set((c[0].why || []).concat(c[0].reasons || []))].join(', ')}${circ ? ' | CIRCUITS ' + circ.airport.code : ''}`);
  if (process.env.TERMS) for (const x of c.slice(0, 2)) console.log('     ', x.airport.code, Object.entries(x.terms || {}).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 10).map(([k, v]) => k + ' ' + v.toFixed(2)).join(' '));
}
