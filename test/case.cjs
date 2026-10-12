// Replays one real aircraft at a chosen moment through the engine, with its own history (adsb.lol globe_history), and
// shows the candidates and the terms behind them - for checking cases reported from the live page.
// usage: node test/case.cjs <dataDir> <tables.json> <hex> <ISO time> [historyDays=20] [weights json] [type]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, tablesFile, hex, iso, daysArg, wArg, typeArg] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
E.setTables(JSON.parse(fs.readFileSync(tablesFile, 'utf8')));
if (wArg && wArg !== '-') E.setWeights(JSON.parse(wArg));
const cache = path.join(dataDir, '..', 'casecache'); fs.mkdirSync(cache, { recursive: true });
const get = url => { const f = path.join(cache, url.replace(/[^a-z0-9]/gi, '_')); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); let t = ''; try { t = execFileSync('curl', ['-s', '--compressed', '-A', 'Mozilla/5.0', url], { maxBuffer: 64e6 }).toString(); } catch (e) { t = ''; } fs.writeFileSync(f, t); return t; };
const at = Date.parse(iso) / 1000, day = s => new Date(s * 1000).toISOString().slice(0, 10).replace(/-/g, '/');
const pts = [];
for (let back = Number(daysArg || 20); back >= 0; back--) {
  const d = day(at - back * 86400);
  const txt = get(`https://adsb.lol/globe_history/${d}/traces/${hex.slice(-2)}/trace_full_${hex}.json`);
  try { const j = JSON.parse(txt); for (const p of E.parseTrace(j)) pts.push(p); } catch (e) { /* no flight that day */ }
}
pts.sort((a, b) => a.t - b.t);
const uniq = []; for (const p of pts) if (!uniq.length || p.t > uniq[uniq.length - 1].t) uniq.push(p);
const ac = { hex, type: typeArg || 'GLF6', reg: '', mil: false, country: '' };
const legs = E.legsFromPoints(uniq.filter(p => p.t <= at), {});
const sums = legs.map(l => E.summarizeLeg(l, null));
const cur = legs[legs.length - 1];
const hist = E.chainLegs(E.stitchLegs(sums.slice(0, -1)));
const hs = E.histStats(hist, at);
const trail = [cur.start].concat(cur.pts).filter(p => p.t <= at);
const thin = []; for (const p of trail) if (!thin.length || p.t - thin[thin.length - 1].t >= 15) thin.push(p);
const pos = trail[trail.length - 1];
console.log('history legs', hist.length, hist.slice(-8).map(l => `${l.from ? l.from.code : '?'}>${l.to ? l.to.code : '?'}`).join(' '), '| base', hs.base ? E.byId(hs.base).code : '-');
console.log('position', new Date(pos.t * 1000).toISOString().slice(11, 19), pos.lat.toFixed(2), pos.lon.toFixed(2), 'alt', pos.alt, 'trk', pos.trk, 'gs', pos.gs, 'vr', pos.vr, '| step climb:', E.isStepClimb(thin, pos));
const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, explain: true, explainIds: [] });
console.log('phase', r.phase, 'origin', r.origin && r.origin.airport ? r.origin.airport.code + ' (' + r.origin.conf + ')' : '?');
for (const c of r.cands.slice(0, 8)) console.log(' ', c.airport.code.padEnd(5), (c.p * 100).toFixed(1).padStart(5) + '%', String(Math.round(c.dist)).padStart(5), 'km', (c.why || []).join(', ').padEnd(28), Object.entries(c.terms || {}).map(([k, v]) => k + ' ' + v.toFixed(2)).join('  '));
