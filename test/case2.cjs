// Replays a reported flight (today's trace file + the aircraft's earlier days from adsb.lol) at points along its
// current leg, through one or more engine configurations, printing the top candidates at each point.
// usage: node test/case2.cjs <dataDir> <todayTrace.json> <type> <leg index or -1> <cfg>...   cfg = tables.json[@logit.json]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, todayFile, type, legArg, ...cfgs] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows;
const engines = cfgs.map(c => { const [t, l] = c.split('@'); const E = createRouteEngine(); E.setAirports(rows); if (process.env.RWY) E.setRunways(JSON.parse(fs.readFileSync(process.env.RWY, 'utf8'))); if (process.env.RWLEN) E.setRunwayLengths(JSON.parse(fs.readFileSync(process.env.RWLEN, 'utf8'))); E.setTables(JSON.parse(fs.readFileSync(t, 'utf8'))); if (l) E.setLogit(JSON.parse(fs.readFileSync(l, 'utf8'))); return { E, name: path.basename(t) + (l ? '+' + path.basename(l) : '') }; });
const E0 = engines[0].E;
const today = JSON.parse(fs.readFileSync(todayFile, 'utf8')), hex = today.icao;
const cache = path.join(dataDir, '..', 'casecache'); fs.mkdirSync(cache, { recursive: true });
const get = url => { const f = path.join(cache, url.replace(/[^a-z0-9]/gi, '_')); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); let t = ''; try { t = execFileSync('curl', ['-s', '--compressed', '-A', 'Mozilla/5.0', url], { maxBuffer: 64e6 }).toString(); } catch (e) { t = ''; } fs.writeFileSync(f, t); return t; };
const day = s => new Date(s * 1000).toISOString().slice(0, 10).replace(/-/g, '/');
const pts = [];
for (let back = 20; back >= 1; back--) { const txt = get(`https://adsb.lol/globe_history/${day(today.timestamp - back * 86400)}/traces/${hex.slice(-2)}/trace_full_${hex}.json`); try { for (const p of E0.parseTrace(JSON.parse(txt))) pts.push(p); } catch (e) { /* none */ } }
for (const p of E0.parseTrace(today)) pts.push(p);
pts.sort((a, b) => a.t - b.t);
const uniq = []; for (const p of pts) if (!uniq.length || p.t > uniq[uniq.length - 1].t) uniq.push(p);
const ac = { hex, type, reg: today.r || '', mil: !!process.env.MIL, country: process.env.CTRY || '' };
const legs = E0.legsFromPoints(uniq, {}), sums = legs.map(l => E0.summarizeLeg(l, null));
const li = Number(legArg) >= 0 ? Number(legArg) : legs.length - 1;
const leg = legs[li], s = sums[li];
console.log(ac.reg, type, 'leg', li, s.from && s.from.code, '>', s.to && s.to.code, new Date(s.tStart * 1000).toISOString().slice(0, 16), (s.tEnd - s.tStart) / 60 | 0, 'min');
const hist = E0.chainLegs(E0.stitchLegs(sums.slice(0, li).map(x => Object.assign({}, x))));
console.log('history', hist.length, 'legs:', hist.slice(-10).map(h => `${h.from ? h.from.code : '?'}>${h.to ? h.to.code : '?'}`).join(' '));
const all = [leg.start].concat(leg.pts);
for (const f of (process.env.FRACS ? process.env.FRACS.split(',').map(Number) : [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92, 0.97])) {
  const tt = s.tStart + f * (s.tEnd - s.tStart);
  let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
  const pos = all[idx]; if (!pos || pos.gnd) continue;
  const thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
  const line = [`${(f * 100 | 0).toString().padStart(2)}% ${pos.lat.toFixed(1)},${pos.lon.toFixed(1)} ${String(pos.alt).padStart(5)}ft`];
  for (const { E, name } of engines) {
    const hs = E.histStats(hist.filter(h => h.tEnd < s.tStart - 60), s.tStart);
    const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, explain: !!process.env.EXPLAIN, explainIds: process.env.EXPLAIN_CODES ? process.env.EXPLAIN_CODES.split(',').map(k => (E.airports.find(a => a.iata === k || a.icao === k) || {}).id) : s.to ? [s.to.id] : [] });
    line.push(r.cands.slice(0, 3).map(c => `${c.airport.code} ${(c.p * 100).toFixed(0)}`).join(' / ').padEnd(30));
    if (process.env.EXPLAIN) { const Ts = r.explained || [], T = Ts[0], fmt = tm => Object.entries(tm || {}).map(([k, v]) => k + ' ' + v.toFixed(2)).join(' '); line.push('\n     truth ' + (T ? `${T.airport.code} rank ${T.rank} s ${T.score.toFixed(2)}: ${fmt(T.terms)}` : 'not a candidate') + '\n     top   ' + r.cands[0].airport.code + ` s ${r.cands[0].score.toFixed(2)} d ${r.cands[0].dist.toFixed(0)}: ` + fmt(r.cands[0].terms) + ' | trk ' + pos.trk + ' vr ' + pos.vr); }
  }
  console.log(line.join(' | '));
}
