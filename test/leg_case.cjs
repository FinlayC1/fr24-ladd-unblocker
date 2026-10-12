// How the flight log rebuilds one aircraft's days: each network's trace (adsb.lol, airplanes.live) and both merged, its
// legs, how each ends and begins (on the ground / on final / in a hole / lost), the airports and the times shown.
// The traces are kept as fixtures (test/fixtures/legs/<hex>/<day>_<lol|apl>.json.gz) for test/unit_legs.cjs.
// usage: node test/leg_case.cjs <dataDir> <hex> <type> <YYYY-MM-DD> [...]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { createRouteEngine } = require(process.env.ENGINE_SRC ? path.resolve(process.env.ENGINE_SRC) : '../src/engine.js');
const [dataDir, hex, type, ...days] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const dir = path.join(__dirname, 'fixtures', 'legs', hex); fs.mkdirSync(dir, { recursive: true });
function trace(day, src) {
  const f = path.join(dir, `${day}_${src}.json.gz`);
  if (!fs.existsSync(f)) {
    const url = src === 'lol' ? `https://adsb.lol/globe_history/${day.replace(/-/g, '/')}/traces/${hex.slice(-2)}/trace_full_${hex}.json` : `https://globe.airplanes.live/globe_history/${day.replace(/-/g, '/')}/traces/${hex.slice(-2)}/trace_full_${hex}.json`;
    let body = ''; try { body = execFileSync('curl', ['-s', '-m', '30', '--compressed', '-A', UA, '-f', url], { maxBuffer: 64e6 }).toString('utf8'); } catch (e) { body = ''; }
    fs.writeFileSync(f, zlib.gzipSync(body || 'null'));
  }
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
}
const hm = t => new Date(t * 1000).toISOString().slice(11, 16);
const ac = { hex, type, reg: '' }, cls = E.classify(ac), ctx = { cls, type, grp: E.groupOf(cls) };
const opts = { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', rangeKm: E.typeRangeKm ? E.typeRangeKm(ac) : 0, cls, type };
for (const day of days) {
  const per = {};
  for (const src of ['lol', 'apl']) { const j = trace(day, src); per[src] = j ? E.parseTrace(j) : []; }
  const merged = E.mergePoints ? E.mergePoints(per.lol, per.apl) : per.lol.concat(per.apl).sort((a, b) => a.t - b.t).filter((p, i, a) => !i || p.t > a[i - 1].t);
  for (const [name, pts] of [['adsb.lol', per.lol], ['airplanes.live', per.apl], ['merged', merged]]) {
    if (!pts.length) { console.log(day, name.padEnd(14), 'no trace'); continue; }
    const legs = E.legsFromPoints(pts, Object.assign({ dataEnd: Date.parse(day + 'T00:00:00Z') / 1000 + 86400 }, opts));
    console.log(`${day} ${name.padEnd(14)} ${pts.length} points ${hm(pts[0].t)}-${hm(pts[pts.length - 1].t)}`);
    for (const l of legs) {
      const s = E.summarizeLeg(l, ctx), e = l.end, st = l.start;
      const to = s.to && E.byId(s.to.id), dTo = to ? E.dist(e.lat, e.lon, to.lat, to.lon) : NaN;
      console.log(`   ${hm(s.tStart)}${s.tOff ? ' (off ' + hm(s.tOff) + ')' : ''} ${(s.from ? s.from.code + '[' + s.from.conf + ']' : '?').padEnd(12)} -> ${(s.to ? s.to.code + '[' + s.to.conf + ']' : '?').padEnd(12)} ${hm(s.tEnd)}${s.tOn ? ' (on ' + hm(s.tOn) + (s.tOnEst ? ' est' : '') + ')' : ''}  how=${l.how} ended=${l.ended}  start ${st.gnd ? 'GND' : st.alt + 'ft'}  end ${e.gnd ? 'GND' : e.alt + 'ft'} gs${Math.round(e.gs || 0)} vr${e.vr == null ? '?' : Math.round(e.vr)} trk${Math.round(e.trk || 0)}${to ? ' ' + dTo.toFixed(1) + 'km from ' + to.code : ''}`);
    }
  }
}
