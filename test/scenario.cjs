// A reported flight at a moment adsb.lol's trace does not reach: its trace (and earlier days, as case2.cjs) plus waypoints
// flown on to where the screenshot shows it, through the engine - top candidates with their evidence.
// usage: node test/scenario.cjs <dataDir> <todayTrace.json> <type> "<lat,lon,alt,gs,minutesAfterTraceEnd;...>" [explain codes]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, todayFile, type, wps, explain] = process.argv.slice(2);
const root = path.join(__dirname, '..');
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
if (fs.existsSync(path.join(dataDir, 'runways.json'))) E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8')));
if (fs.existsSync(path.join(dataDir, 'runway_len.json'))) E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(process.env.TABLES || path.join(root, 'src', 'tables.json'), 'utf8')));
E.setLogit(JSON.parse(fs.readFileSync(process.env.LOGIT || path.join(root, 'src', 'logit.json'), 'utf8')));
const today = JSON.parse(fs.readFileSync(todayFile, 'utf8')), hex = today.icao;
const cache = path.join(dataDir, '..', 'casecache'); fs.mkdirSync(cache, { recursive: true });
const get = url => { const f = path.join(cache, url.replace(/[^a-z0-9]/gi, '_')); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); let t = ''; try { t = execFileSync('curl', ['-s', '--compressed', '-A', 'Mozilla/5.0', url], { maxBuffer: 64e6 }).toString(); } catch (e) { t = ''; } fs.writeFileSync(f, t); return t; };
const day = s => new Date(s * 1000).toISOString().slice(0, 10).replace(/-/g, '/');
const pts = [];
for (let back = Number(process.env.DAYS || 20); back >= 1; back--) { const txt = get(`https://adsb.lol/globe_history/${day(today.timestamp - back * 86400)}/traces/${hex.slice(-2)}/trace_full_${hex}.json`); try { for (const p of E.parseTrace(JSON.parse(txt))) pts.push(p); } catch (e) { /* none */ } }
for (const p of E.parseTrace(today)) pts.push(p);
pts.sort((a, b) => a.t - b.t);
const uniq = []; for (const p of pts) if (!uniq.length || p.t > uniq[uniq.length - 1].t) uniq.push(p);
const legs = E.legsFromPoints(uniq, {}), sums = legs.map(l => E.summarizeLeg(l, null));
const li = legs.length - 1, leg = legs[li], s = sums[li];
const hist = E.chainLegs(E.stitchLegs(sums.slice(0, li).map(x => Object.assign({}, x))));
const all = [leg.start].concat(leg.pts);
// fly on through the waypoints (straight lines, a point every 30 s)
let last = all[all.length - 1];
const brg = (a, b, c, d) => { const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r); return (Math.atan2(y, x) / r + 360) % 360; };
for (const w of (wps || '').split(';').filter(Boolean)) {
  const [lat, lon, alt, gs, mins] = w.split(',').map(Number);
  const t1 = s.tEnd + mins * 60, n = Math.max(1, Math.round((t1 - last.t) / 30)), a0 = last;
  for (let k = 1; k <= n; k++) { const f = k / n; const p = { t: Math.round(a0.t + (t1 - a0.t) * f), lat: a0.lat + (lat - a0.lat) * f, lon: a0.lon + (lon - a0.lon) * f, alt: Math.round(a0.alt + (alt - a0.alt) * f), gs, trk: brg(a0.lat, a0.lon, lat, lon), gnd: alt <= 0 && gs < 40 }; all.push(p); }
  last = all[all.length - 1];
}
const pos = Object.assign({}, last), thin = []; for (const p of all) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
{ const back = all.filter(p => pos.t - p.t >= 60).pop(); if (back && pos.alt != null && back.alt != null) pos.vr = (pos.alt - back.alt) / ((pos.t - back.t) / 60); }
const ac = { hex, type, reg: today.r || '', mil: !!process.env.MIL, country: process.env.CTRY || '' };
console.log(ac.reg, type, 'from', s.from && s.from.code, new Date(s.tStart * 1000).toISOString().slice(0, 16), 'history', hist.length, 'legs:', hist.slice(-8).map(h => `${h.from ? h.from.code : '?'}>${h.to ? h.to.code : '?'}`).join(' '));
console.log('at', pos.lat.toFixed(2), pos.lon.toFixed(2), pos.alt + 'ft', 'trk', pos.trk && pos.trk.toFixed(0), 'gs', pos.gs, 'vr', pos.vr && pos.vr.toFixed(0));
const hs = E.histStats(hist.filter(h => h.tEnd < s.tStart - 60), s.tStart);
const ids = (explain || '').split(',').filter(Boolean).map(k => (E.airports.find(a => a.iata === k || a.icao === k) || {}).id);
const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, explain: true, explainIds: ids });
const fmt = tm => Object.entries(tm || {}).map(([k, v]) => k + ' ' + v.toFixed(2)).join(' ');
console.log('phase', r.phase);
for (const c of r.cands.slice(0, 8)) console.log(`  ${c.airport.code.padEnd(4)} ${(c.p * 100).toFixed(1).padStart(5)}%  d ${c.dist.toFixed(0).padStart(5)}  ${c.airport.name}  [${(c.why || []).join(', ')}]\n        ${fmt(c.terms)}`);
for (const T of r.explained || []) console.log(`  explain ${T.airport.code} rank ${T.rank} s ${T.score.toFixed(2)}: ${fmt(T.terms)}`);
