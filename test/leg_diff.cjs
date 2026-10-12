// Old vs new leg building over archive aircraft: how often each new rule fires, what it changes, examples to look at.
// usage: node test/leg_diff.cjs <dataDir> <old engine.js> [shards] [days]
const fs = require('fs');
const path = require('path');
const A = require('./arch.cjs');
const [dataDir, oldFile, shardArg = '05,45,85,c5', nDays = '7'] = process.argv.slice(2);
const mk = file => { const { createRouteEngine } = require(path.resolve(file)); const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir); E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8'))); return E; };
const EN = mk(path.join(__dirname, '..', 'src', 'engine.js')), EO = mk(oldFile);
const run = A.dayPlan(path.join(dataDir, 'arch')).run.slice(-(+nDays));
const dataEnd = Date.parse(run[run.length - 1] + 'T00:00:00Z') / 1000 + 86400;
const st = { ac: 0, oldLegs: 0, newLegs: 0, how: {}, oldTo: { ground: 0, low: 0, near: 0, none: 0 }, newTo: { ground: 0, low: 0, near: 0, none: 0 }, tOn: 0, tOnEst: 0, ended: [0, 0] };
const ex = { 'gap-land': [], final: [], 'lost-low': [], split: [] };
const hm = t => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
for (const sh of shardArg.split(',')) for (const { ac, pts } of A.shardAircraft(path.join(dataDir, 'arch'), sh, run, EN)) {
  st.ac++;
  const cls = EN.classify(ac), o = { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy' };
  const ctx = { cls, type: ac.type, grp: EN.groupOf(cls), mil: ac.mil };
  const lo = EO.legsFromPoints(pts.map(p => Object.assign({}, p)), o).map(l => EO.summarizeLeg(l, ctx));
  const ln = EN.legsFromPoints(pts.map(p => Object.assign({}, p)), Object.assign({ cls, type: ac.type, rangeKm: EN.typeRangeKm(ac), dataEnd }, o));
  const sn = ln.map(l => EN.summarizeLeg(l, ctx));
  st.oldLegs += lo.length; st.newLegs += sn.length;
  for (const s of lo) { st.oldTo[s.to ? s.to.conf === 'chain' ? 'near' : s.to.conf : 'none'] = (st.oldTo[s.to ? s.to.conf : 'none'] || 0) + 1; if (s.ended) st.ended[0]++; }
  for (let i = 0; i < sn.length; i++) {
    const s = sn[i], l = ln[i]; st.how[s.how] = (st.how[s.how] || 0) + 1; st.newTo[s.to ? s.to.conf : 'none'] = (st.newTo[s.to ? s.to.conf : 'none'] || 0) + 1; if (s.ended) st.ended[1]++;
    if (s.tOn) { st.tOn++; if (s.tOnEst) st.tOnEst++; }
    const line = `${ac.reg || ac.hex} ${ac.type} ${cls} ${hm(s.tStart)} ${s.from ? s.from.code : '?'} -> ${s.to ? s.to.code + '[' + s.to.conf + ']' : '?'} ${hm(s.tEnd)} end ${l.end.alt}ft gs${Math.round(l.end.gs || 0)}${l.gapInfo ? ' hole ' + Math.round(l.gapInfo.gap / 60) + 'min ' + (l.gapNext ? Math.round(EN.dist(l.end.lat, l.end.lon, l.gapNext.lat, l.gapNext.lon)) + 'km next ' + l.gapNext.alt + 'ft' : '') + (l.gapInfo.aDesc ? ' desc' : '') + (l.gapInfo.bClimb ? ' climb' : '') : ''}`;
    if (ex[s.how] && ex[s.how].length < 400) ex[s.how].push(line);
  }
  if (sn.length > lo.length + 0 && ex.split.length < 200) { const longOld = lo.filter(s => s.from && s.to && EN.dist(EN.byId(s.from.id).lat, EN.byId(s.from.id).lon, EN.byId(s.to.id).lat, EN.byId(s.to.id).lon) > (EN.typeRangeKm(ac) || 1e9) * 1.25); for (const s of longOld) ex.split.push(`${ac.reg || ac.hex} ${ac.type} old ${s.from.code}->${s.to.code} ${hm(s.tStart)}`); }
}
console.log(JSON.stringify(st, null, 1));
for (const [k, v] of Object.entries(ex)) { console.log(`\n== ${k}: ${v.length} (examples)`); for (const x of v.filter((_, i) => i % Math.max(1, Math.floor(v.length / 25)) === 0).slice(0, 25)) console.log('  ' + x); }
