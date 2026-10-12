// The permanent monitor (monitor/monitor.cjs): a real day's track fed to it as the LADD list would give it - one
// report every 30 s - makes the same flights as the engine on the whole track, and an airport's board query finds them.
// usage: node test/unit_monitor.cjs <dataDir>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
process.env.MON_DATA = process.argv[2];
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const code = id => { const a = E.byId(id); return a ? a.iata || a.icao : id; };
for (const [hex, day, type] of [['3cdf15', '2026-10-02', 'E55P'], ['424c35', null, null]]) {
  const dir = path.join(__dirname, 'fixtures/legs', hex); if (!fs.existsSync(dir)) continue;
  const f = fs.readdirSync(dir).filter(x => x.endsWith('_lol.json.gz') && (!day || x.startsWith(day)))[0]; if (!f) continue;
  const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString());
  const ty = j.t || type, cls = E.classify({ hex, type: ty });
  // (the engine on the whole track, as the monitor runs it; the flight still going when the file ends left out)
  const whole = E.legsFromPoints(E.parseTrace(j), { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', cls, type: ty, rangeKm: E.typeRangeKm({ hex, type: ty }) }).map(l => E.summarizeLeg(l, { cls, type: ty, grp: E.groupOf(cls) })).filter(s => s.ended);
  // (a report every 30 s, as the LADD list is polled; positions only)
  let next = 0;
  for (const p of j.trace) {
    const t = j.timestamp + p[0]; if (t < next) continue; next = t + 30;
    M.ingest({ hex, r: j.r, t: j.t || type, dbFlags: 8, flight: p[8] && p[8].flight, lat: p[1], lon: p[2], alt_baro: p[3], gs: p[4], track: p[5], baro_rate: p[7], seen_pos: 0 }, t);
  }
  const end = j.timestamp + j.trace[j.trace.length - 1][0];
  M.buildLegs(hex, end + 3 * 3600);
  const got = [...(M.legs.get(hex) || new Map()).values()].filter(l => l.ended).sort((a, b) => a.tStart - b.tStart);
  const pair = l => `${l.from ? code(l.from.id) : '?'}-${l.to ? code(l.to.id) : '?'}`;
  check(`${j.r || hex}: flights from 30 s reports match the whole track`, got.map(pair).join(',') === whole.map(pair).join(','), { monitor: got.map(pair), engine: whole.map(pair) });
  const lastTo = got.filter(l => l.to).pop();
  if (lastTo) { const b = M.boardLegs(lastTo.to.id, lastTo.tStart - 3600, lastTo.tEnd + 3600); check(`... the board of ${code(lastTo.to.id)} has it`, b.some(x => x.hex === hex), b.map(x => x.hex)); }
}
// A blocked aircraft the monitor never heard - M-ARNZ, parked at Barrow when it started - learned of from the userscript:
// its days read back from adsb.lol's traces (the fixtures here): its shuttles on Barrow's board, the evening one from
// Farnborough (not "Woking"), flagged as blocked
(async () => {
  const hex = '424c60';
  if (fs.existsSync(path.join(__dirname, 'fixtures/legs', hex))) {
    global.fetch = async url => {
      const m = /globe_history\/(\d{4})\/(\d\d)\/(\d\d)\/traces\/..\/trace_full_([0-9a-f]{6})\.json/.exec(url), fx = m && path.join(__dirname, 'fixtures/legs', m[4], `${m[1]}-${m[2]}-${m[3]}_lol.json.gz`);
      if (!fx || !fs.existsSync(fx)) return { status: 404, text: async () => '' };
      return { status: 200, text: async () => zlib.gunzipSync(fs.readFileSync(fx)).toString() };
    };
    const t0 = Date.parse('2026-10-08T12:00:00Z') / 1000;
    check('seed: an aircraft never heard is taken as blocked and queued', M.seed([hex], true, t0) === 1 && M.blocked.has(hex) && M.backQ[0].hex === hex);
    M.backQ.length = 0;
    await M.backfillOne({ hex, days: ['2026-10-06', '2026-10-07'] });
    const bwf = E.byIcao('EGNL'), b = M.boardLegs(bwf.id, Date.parse('2026-10-07T16:00:00Z') / 1000, Date.parse('2026-10-07T18:00:00Z') / 1000);
    const x = b.find(y => y.hex === hex), l = x && x.legs.find(y => y.to && y.to.id === bwf.id && y.tOff > Date.parse('2026-10-07T16:00:00Z') / 1000);
    check('... its evening flight into Barrow is on the board, from Farnborough, blocked', !!l && !!l.from && code(l.from.id) === 'FAB' && x.ladd === true, l && { from: l.from && code(l.from.id), ladd: x.ladd });
    const two = M.boardLegs(bwf.id, Date.parse('2026-10-06T00:00:00Z') / 1000, Date.parse('2026-10-08T00:00:00Z') / 1000).find(y => y.hex === hex);
    check('... and the rest of its two days (8 flights at Barrow)', !!two && two.legs.length === 8, two && two.legs.map(y => `${y.from ? code(y.from.id) : '?'}-${y.to ? code(y.to.id) : '?'}`));
    // G-BOIL, 8 Oct: Blackpool -> Barton, lost from view at -125 ft, 49 kt beside the strip - 30 minutes on, landed there
    {
      const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/402ab6/2026-10-08_lol.json.gz'))).toString());
      let next = 0;
      for (const p of j.trace) { const t = j.timestamp + p[0]; if (t < next) continue; next = t + 30; M.ingest({ hex: '402ab6', r: j.r, t: j.t, flight: p[8] && p[8].flight, lat: p[1], lon: p[2], alt_baro: p[3], gs: p[4], track: p[5], baro_rate: p[7], seen_pos: 0 }, t); }
      const end = j.timestamp + j.trace[j.trace.length - 1][0]; M.buildLegs('402ab6', end + 1800);
      const l = [...(M.legs.get('402ab6') || new Map()).values()].sort((a, b) => a.tStart - b.tStart).pop();
      check('a light aircraft lost low by a strip, quiet 30 min: landed there (G-BOIL into Barton, not "open" for 14 h)', !!l && !!l.to && code(l.to.id) === 'QGC' && l.ended && !l.open, l && { to: l.to && code(l.to.id), ended: l.ended, open: l.open });
    }
    // OK-FLN, 9 Oct: down at Luton at 15:26, transponder off at 15:27 - nothing more heard. 20 minutes on, the quiet
    // aircraft is looked at again and its flight closed as landed (before: open until the 14-hour prune)
    {
      const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/49d44f/2026-10-09_lol.json.gz'))).toString());
      let next = 0;
      for (const p of j.trace) { const t = j.timestamp + p[0]; if (t < next) continue; next = t + 30; M.ingest({ hex: '49d44f', r: j.r, t: j.t, dbFlags: 8, flight: p[8] && p[8].flight, lat: p[1], lon: p[2], alt_baro: p[3], gs: p[4], track: p[5], baro_rate: p[7], seen_pos: 0 }, t); }
      const end = j.timestamp + j.trace[j.trace.length - 1][0];
      M.buildLegs('49d44f', end + 60);
      const before = [...M.legs.get('49d44f').values()].pop().open;
      M.wakeQuiet(end + 1500); M.buildLegs('49d44f', end + 1500);
      const l = [...M.legs.get('49d44f').values()].sort((a, b) => a.tStart - b.tStart).pop();
      check('a jet down and silent at the stand: its flight closed 20 min on, landed (OK-FLN into Luton)', before === true && !l.open && l.ended && !!l.to && code(l.to.id) === 'LTN', { before, open: l.open, to: l.to && code(l.to.id) });
      const ltn = E.byIcao('EGGW'), pk = M.parkedAt(ltn.id, 'FA7X', end + 1600);
      check('... and listed as parked at Luton (its type asked for), not under another type', pk.some(x => x.hex === '49d44f') && !M.parkedAt(ltn.id, 'GL7T', end + 1600).some(x => x.hex === '49d44f'), pk.map(x => x.hex));
    }
    // (a flight number's flights - FR24 has no history of a blocked aircraft's callsign)
    { const cs0 = ([...(M.legs.get(hex) || new Map()).values()].find(l => l.cs) || {}).cs, fl = cs0 ? M.flightsOfCs(cs0.toLowerCase()) : [];
      check('flights under a callsign: every kept flight of it, newest first', !!cs0 && fl.length >= 1 && fl.every(l => l.hex && l.cs === cs0) && fl.every((l, i) => !i || fl[i - 1].tStart >= l.tStart), { cs: cs0, n: fl.length }); }
    // (a place the userscript looks at becomes an area; one next to it does not)
    check('area: a new place is polled, one beside it is not', M.addArea(40.6, -73.8, t0) === true && M.addArea(40.9, -73.5, t0) === false && M.userAreas.length === 1);
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exitCode = fails ? 1 : 0;
})();
