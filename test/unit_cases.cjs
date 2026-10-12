// The flights reported on 30 Sep 2026, replayed through the shipped engine and tables (src/tables.json, logit.json and
// the packed population tables src/tables2.json, unpacked by the userscript's own unpackT2) with their real ADS-B
// history (test/fixtures/live0930: 220 days, adsb.lol for the last 40 and airplanes.live before).
// usage: node test/unit_cases.cjs <dataDir>
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const dataDir = process.argv[2], root = path.join(__dirname, '..');
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(path.join(root, 'src', 'tables.json'), 'utf8')));
E.setLogit(JSON.parse(fs.readFileSync(path.join(root, 'src', 'logit.json'), 'utf8')));
{
  const src = fs.readFileSync(path.join(root, 'src', 'main', '03-data.js'), 'utf8'), m = src.match(/\/\* ==UNPACKT2== \*\/([\s\S]*?)\/\* ==\/UNPACKT2== \*\//);
  const unpackT2 = new Function(m[1] + '; return unpackT2;')();
  if (fs.existsSync(path.join(root, 'src', 'tables2.json'))) E.setTables2(unpackT2(JSON.parse(fs.readFileSync(path.join(root, 'src', 'tables2.json'), 'utf8'))));
}
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const FX = path.join(__dirname, 'fixtures', 'live0930');
// the leg flying at hh:mm on 30 Sep, predicted at that moment with `days` of history before it
function at(hex, hhmm, days = 220) {
  const d0 = Date.parse('2026-09-30T00:00:00Z') / 1000, [h, mi] = hhmm.split(':').map(Number), t = d0 + h * 3600 + mi * 60;
  const pts = []; let meta = null;
  const files = fs.readdirSync(path.join(FX, hex)).filter(f => /\.json$/.test(f) && Date.parse(f.slice(0, 10) + 'T00:00:00Z') / 1000 >= d0 - days * 86400).map(f => path.join(FX, hex, f)).concat([path.join(FX, hex + '.today.json')]);
  for (const f of files) { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!meta || !meta.t) meta = j; for (const p of E.parseTrace(j)) pts.push(p); } catch (e) { /* none */ } }
  pts.sort((a, b) => a.t - b.t); const u = pts.filter((p, i) => !i || p.t > pts[i - 1].t);
  const ac = { hex, type: meta.t || '', reg: meta.r || '', ladd: !!(meta.dbFlags & 8), mil: !!(meta.dbFlags & 1) }, cls = E.classify(ac);
  const legs = E.legsFromPoints(u, { heli: cls === 'heli' }), sums = legs.map(l => E.summarizeLeg(l, null));
  const li = sums.findIndex(s => s.tStart <= t && t <= s.tEnd + 60), leg = legs[li], s = sums[li];
  const hs = E.histStats(E.chainLegs(E.stitchLegs(sums.slice(0, li).map(x => Object.assign({}, x)))), s.tStart);
  const all = [leg.start].concat(leg.pts); let idx = 0; for (let i = 0; i < all.length; i++) if (all[i].t <= t) idx = i;
  const pos = all[idx], thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
  const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t });
  const p = code => { const c = r.cands.find(x => x.airport.code === code); return c ? Math.round(c.p * 100) : 0; };
  at.last = { pos, r, ac, cls };
  return { r, p, top: r.cands[0] ? r.cands[0].airport.code : '-', show: r.cands.slice(0, 4).map(c => c.airport.code + ' ' + Math.round(c.p * 100)) };
}
// AOJ73M (OE-HIM, Challenger 350, Farnborough -> east, 30 Sep): over north-west Romania at FL450 heading 100-105 and
// shown "Bucharest 52%". Its home is Iasi (7 months of its log say so; six weeks did not) - not Bucharest, 44 degrees off.
for (const hm of ['15:03', '15:13']) { const x = at('440366', hm); check(`AOJ73M ${hm} at FL450 heading east over Romania: not Bucharest (under 25%), not the top`, x.p('BBU') < 25 && x.top !== 'BBU', x.show); }
// I-ADVD (SIO512, G550, Ancona -> Le Bourget, 30 Sep): "Milan 70%" just after take-off; levelled at FL380, too high for
// the 350 km hop to Milan it usually flies - Le Bourget, its other regular, from then on
{ const x = at('3004c7', '15:36'); check('I-ADVD level at FL380 out of Ancona: Le Bourget, not Milan', x.top === 'LBG' && x.p('LIN') < 30, x.show); }
{ const x = at('3004c7', '15:44'); check('I-ADVD 15:44: Le Bourget 60%+', x.p('LBG') >= 60, x.show); }
// N97NH (PC-24, Manchester NH -> Islip, 30 Sep): "Teterboro 23%" at 15:41 heading 161 at 14,800 ft - away from
// Teterboro; Islip once lined up with its runway
{ const x = at('ad8280', '15:42'); check('N97NH 15:42 heading 161 over Long Island Sound: Teterboro not the answer (under 15%)', x.p('TEB') < 15 && x.top !== 'TEB', x.show); }
// (at 16:06 it was still turning in, 16 km out, level at 1,825 ft: Islip in contention with its base Republic; a minute
// later lined up on Islip's final approach course - the engine's top, and the runway check the panel confirms it with)
{ const x = at('ad8280', '16:06'); check('N97NH 16:06 turning in to Islip: Islip a contender (30%+)', x.p('ISP') >= 30, x.show); }
{ const x = at('ad8280', '16:07'), f = E.finalTo(at.last.pos, { cls: at.last.cls, type: at.last.ac.type }); check('N97NH 16:07 lined up on final at Islip: Islip, and the runway check confirms it', x.top === 'ISP' && !!f && f.airport.code === 'ISP', { show: x.show, final: f && f.airport.code }); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;
