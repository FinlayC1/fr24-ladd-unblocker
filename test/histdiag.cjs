// How an aircraft's flight log comes out (the userscript's way: each day summarized with what is known so far), and
// what the engine then takes as its home base and habits. usage: node test/histdiag.cjs <dataDir> <hex> <type> [days]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, hex, type, daysArg] = process.argv.slice(2);
const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
if (process.env.RWY) E.setRunways(JSON.parse(fs.readFileSync(process.env.RWY, 'utf8')));
if (process.env.W) E.setWeights(JSON.parse(process.env.W));
const cache = path.join(dataDir, '..', 'casecache'); fs.mkdirSync(cache, { recursive: true });
const get = url => { const f = path.join(cache, url.replace(/[^a-z0-9]/gi, '_')); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); let t = ''; try { t = execFileSync('curl', ['-s', '--compressed', '-A', 'Mozilla/5.0', url], { maxBuffer: 64e6 }).toString(); } catch (e) { t = ''; } fs.writeFileSync(f, t); return t; };
const day = s => new Date(s * 1000).toISOString().slice(0, 10).replace(/-/g, '/');
const now = Math.floor(Date.now() / 1000), days = +(daysArg || 60);
const ac = { hex, type, mil: !!process.env.MIL }, cls = E.classify(ac), grp = E.groupOf(cls);
let hist = [];
const counts = {};
for (let back = days; back >= 1; back--) {
  const txt = get(`https://adsb.lol/globe_history/${day(now - back * 86400)}/traces/${hex.slice(-2)}/trace_full_${hex}.json`);
  let j; try { j = JSON.parse(txt); } catch (e) { continue; }
  const legs = E.legsFromPoints(E.parseTrace(j), { heli: cls === 'heli' });
  const hs0 = E.histStats(hist, now), ctx = { visits: hs0.visits, base: hs0.base, mil: ac.mil, grp };
  for (const l of legs) { const s = E.summarizeLeg(l, ctx); hist.push(s); const k = `${s.from ? s.from.code + '(' + s.from.conf + ')' : '?'} > ${s.to ? s.to.code + '(' + s.to.conf + ')' : '?'} ${s.how}`; counts[k] = (counts[k] || 0) + 1; }
}
hist = E.chainLegs(E.stitchLegs(hist));
const hs = E.histStats(hist, now);
console.log(hex, type, cls, 'legs', hist.length, 'base', hs.base && (E.byId(hs.base) || {}).code, 'visits', [...hs.visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, v]) => `${(E.byId(id) || {}).code}:${v.toFixed ? v.toFixed(1) : v}`).join(' '));
console.log('nights', [...(hs.nights || new Map()).entries()].slice(0, 6).map(([id, v]) => `${(E.byId(id) || {}).code}:${typeof v === 'number' ? v.toFixed(1) : JSON.stringify(v)}`).join(' '));
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(v).padStart(4), k);
