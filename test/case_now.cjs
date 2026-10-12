// One aircraft right now: its archive history (the shard of its address, the archive's consecutive days), the days
// since from adsb.lol, today's trace - and the engine's answer every few minutes of its current flight, with the "on
// approach" test the panel applies.
// usage: node test/case_now.cjs <dataDir> <hex> <type> <today trace.json> [tables prefix] [logit] [t2 packed]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const A = require('./arch.cjs');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, hex, type, todayFile, tbl, lg, t2f] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
const root = path.join(__dirname, '..');
E.setTables(JSON.parse(fs.readFileSync(tbl ? tbl + '_tb.json' : path.join(root, 'src', 'tables.json'), 'utf8')));
E.setLogit(JSON.parse(fs.readFileSync(lg || path.join(root, 'src', 'logit.json'), 'utf8')));
{ let t2 = JSON.parse(fs.readFileSync(t2f || path.join(root, 'src', 'tables2.json'), 'utf8')); if (t2.pk === 2) { const src = fs.readFileSync(path.join(root, 'src', 'main', '03-data.js'), 'utf8'), i0 = src.indexOf('/* ==UNPACKT2== */') + 18, i1 = src.indexOf('/* ==/UNPACKT2== */'); t2 = new Function(src.slice(i0, i1) + '; return unpackT2;')()(t2); } E.setTables2(t2); }
const archDir = path.join(dataDir, 'arch'), run = A.dayPlan(archDir).run;
let pts = [], meta = null;
for (const x of A.shardAircraft(archDir, hex.slice(-2), run, E, { want: new Set([hex]) })) { pts = x.pts; meta = x.ac; }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const dayS = t => new Date(t * 1000).toISOString().slice(0, 10);
for (let t = Date.parse(run[run.length - 1] + 'T12:00:00Z') / 1000 + 86400; dayS(t) < dayS(Date.now() / 1000); t += 86400) {
  try { const j = JSON.parse(execFileSync('curl', ['-s', '-f', '--compressed', '-A', UA, `https://adsb.lol/globe_history/${dayS(t).replace(/-/g, '/')}/traces/${hex.slice(-2)}/trace_full_${hex}.json`]).toString()); pts.push(...E.parseTrace(j)); } catch (e) { /* none */ }
}
const today = JSON.parse(fs.readFileSync(todayFile, 'utf8')); pts.push(...E.parseTrace(today));
pts.sort((a, b) => a.t - b.t); pts = pts.filter((p, i) => !i || p.t > pts[i - 1].t);
const ac = Object.assign({ hex, type, reg: today.r || '' }, meta || {}), cls = E.classify(ac);
const legs = E.legsFromPoints(pts, { cls, type, rangeKm: E.typeRangeKm ? E.typeRangeKm(ac) : 0, dataEnd: Date.now() / 1000 }), sums = legs.map(l => E.summarizeLeg(l, { cls, type, grp: E.groupOf(cls) }));
const hm = t => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
console.log(`${ac.reg} ${type} ${cls}: ${sums.length} legs; last 6:`); for (const s of sums.slice(-6)) console.log(`   ${hm(s.tStart)} ${s.from ? s.from.code : '?'} -> ${s.to ? s.to.code : '?'} ${hm(s.tEnd)} ${s.how}`);
const cur = legs[legs.length - 1], chained = E.chainLegs(E.stitchLegs(sums.slice(0, -1).map(x => Object.assign({}, x)))), hs = E.histStats(chained.filter(h => h.tEnd < cur.start.t - 60), cur.start.t);
const all = [cur.start].concat(cur.pts);
for (let i = 1; i < all.length; i++) {
  const p = all[i]; if (p.gnd || (i < all.length - 1 && Math.floor((p.t - all[0].t) / 120) === Math.floor((all[i - 1].t - all[0].t) / 120))) continue;
  const trail = []; for (const q of all.slice(0, i + 1)) if (!trail.length || q.t - trail[trail.length - 1].t >= 20) trail.push(q);
  const r = E.predict({ ac, pos: p, trail, hs, now: p.t }); if (!r) continue;
  const top = r.cands[0], toward = E.angDiff(p.trk, E.brg(p.lat, p.lon, top.airport.lat, top.airport.lon));
  console.log(`${hm(p.t)} ${p.alt}ft trk${Math.round(p.trk)} vr${p.vr} phase ${r.phase}: ${r.cands.slice(0, 4).map(c => c.airport.code + ' ' + Math.round(c.p * 100) + '% ' + Math.round(c.dist) + 'km').join(', ')} | top bearing off ${Math.round(toward)}°`);
}
