// Established on a long final (engine.longFinal): confirmed up to 35 km out when it is plainly one runway's final.
// usage: node test/unit_final.cjs <dataDir> [T7-AFP trace_full json]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, traceFile] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8')));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const code = r => r ? r.airport.iata || r.airport.icao : null;
// along a runway's extended centreline: the point `km` out from its threshold e = [lat, lon, landing heading]
const outOn = (e, km) => E.destPoint(e[0], e[1], (e[2] + 180) % 360, km);
const lbg27 = [48.9651, 2.4456, 265], cdg27R = [48.9988, 2.6102, 265];
const t0 = 1790897820;   // 1 Oct 23:37 UTC
const run = (e, kms, alt, trk, vr) => kms.map((km, i) => { const [lat, lon] = outOn(e, km); return { t: t0 + i * 15, lat, lon, alt: alt(km), trk, gs: 200, vr }; });
// T7-AFP on Le Bourget's runway 27 final, 30 km out and in, at 4,500 ft and down a 3° path
{
  const pts = run(lbg27, [31, 30.2, 29.4, 28.6, 27.8], km => Math.min(4525, 230 + km * 160), 266, -400);
  const last = pts[pts.length - 1], first = Object.assign({}, pts[0]);
  check('T7-AFP lined up with Le Bourget 27, 28 km out: confirmed Le Bourget (not CDG)', code(E.longFinal(last, pts)) === 'LBG', E.longFinal(last, pts));
  check('...but not on the first moment it is lined up (held half a minute first)', E.longFinal(first, [first]) === null);
  // its real track up to 23:36:49 (still turning onto the final, track 294): not yet
  if (traceFile && fs.existsSync(traceFile)) {
    const tp = E.parseTrace(JSON.parse(fs.readFileSync(traceFile, 'utf8'))), p = tp[tp.length - 1];
    check('real track, still turning in at 34 km (track 294): not yet confirmed', E.longFinal(p, tp) === null, { trk: p.trk, got: code(E.longFinal(p, tp)) });
  }
}
// a jet on CDG's 27R final: CDG (Le Bourget's runway is 3 km away - not a rival on CDG's own final? it is not lined up)
{
  const pts = run(cdg27R, [24, 23.2, 22.4, 21.6, 20.8], km => 300 + km * 165, 265, -500);
  check('on CDG 27R final, 21 km out: CDG', code(E.longFinal(pts[pts.length - 1], pts)) === 'CDG', code(E.longFinal(pts[pts.length - 1], pts)));
}
// crossing Le Bourget's extended centreline at right angles: nothing
{
  const [la, lo] = outOn(lbg27, 25), pts = [0, 1, 2, 3, 4].map(i => ({ t: t0 + i * 15, lat: la - 0.02 + i * 0.01, lon: lo, alt: 4500, trk: 0, gs: 220, vr: 0 }));
  check('crossing the centreline at right angles: not a final', E.longFinal(pts[pts.length - 1], pts) === null);
}
// climbing out down the centreline the other way, or far above the glide path: nothing
{
  const pts = run(lbg27, [20, 19.2, 18.4, 17.6, 16.8], () => 11000, 266, 0);
  check('lined up but 11,000 ft at 17 km (far above any glide path): not a final', E.longFinal(pts[pts.length - 1], pts) === null);
}
// Learned arrival paths (engine.approachPath, table cells as test/pipe_appr.cjs keys them): two fixes on Le Bourget's
// cells for a business jet - confirmed; one fix alone, an airliner (its own cells), a piston: nothing
{
  const { binOf, BIN } = require('./pipe_appr.cjs'), lbg = E.byIcao('LFPB');
  const pts = run(lbg27, [20, 19.2, 18.4, 17.6, 16.8], km => Math.min(4525, 230 + km * 160), 266, -400).map((p, i) => Object.assign(p, { t: t0 + i * 30 }));
  const cells = new Map(); pts.forEach((p, i) => cells.set(binOf(p, 1, pts[i - 1]), [lbg.id, 198, 200]));
  E.setApproach({ bin: BIN, cells });
  const last = pts[pts.length - 1], hit = E.approachPath(last, pts.slice(0, -1), 'heavybiz');
  check('business jet with two fixes on Le Bourget\'s learned arrival cells: Le Bourget', code(hit) === 'LBG' && hit.share === 0.99 && hit.n === 200, hit && { ap: code(hit), share: hit.share, n: hit.n, km: +hit.dist.toFixed(1) });
  check('... one fix alone: not yet', E.approachPath(pts[0], [], 'heavybiz') === null);
  check('... an airliner there (the airliners\' own cells): nothing', E.approachPath(last, pts.slice(0, -1), 'airliner') === null);
  check('... a piston there (light aircraft have their own cells): nothing', E.approachPath(last, pts.slice(0, -1), 'piston') === null);
  E.setApproach(null);
}
// FR24's track of an unnamed flight against an aircraft's ADS-B track of the day (identifying it over an ocean): the
// same aircraft agrees for minutes within a km; one 20 km to the side does not; reports outside FR24's time are ignored
{
  const a = [], same = [], off = [];
  for (let i = 0; i <= 60; i++) { const [la, lo] = E.destPoint(53.4, -2.3, 300, i * 2.3); a.push({ t: t0 + i * 10, lat: la, lon: lo }); }
  for (let i = -30; i <= 120; i++) { const [la, lo] = E.destPoint(53.4, -2.3, 300, i * 0.46 + 0.3); same.push({ t: t0 + i * 2, lat: la, lon: lo }); const [lb, ob] = E.destPoint(la, lo, 30, 20); off.push({ t: t0 + i * 2, lat: lb, lon: ob }); }
  const s = E.trackAgree(a, same), o = E.trackAgree(a, off);
  check('track agreement: the same aircraft (10 min of reports within a km)', s.n >= 15 && s.bad === 0 && s.span >= 180 && s.medKm < 1, s);
  check('... one 20 km to the side: every report off', o.n === s.n && o.bad === o.n, { n: o.n, bad: o.bad });
}
// N88RZ (G500), 8 Oct: adsb.lol last heard it at 18:54:48 west of Ireland, FL430, 431 kt, track 245.5; FR24's satellite
// position at 21:47 43.728,-44.846, 449 kt, track 247 - carried forward it is there (a great circle on the old track
// missed by 478 km)
{
  const p = { t: 0, lat: 52.302836, lon: -15.838832, trk: 245.5, gs: 430.9 }, secs = Date.parse('2026-10-08T21:47:00Z') / 1000 - Date.parse('2026-10-08T18:54:48Z') / 1000;
  const [la, lo, trk] = E.reckon(p, secs, 247, 449), e = E.trackErr(la, lo, 43.72769, -44.84584, trk);
  check('reckoning over an ocean: N88RZ carried forward 2 h 52 min lands within 30 km of FR24\'s position', Math.hypot(e.along, e.cross) < 30, { along: Math.round(e.along), cross: Math.round(e.cross) });
  check('... only where a track does not turn: the open Atlantic yes, London - Paris over land no', E.remotePath(p, secs, 247, 449) && !E.remotePath({ lat: 51.5, lon: -0.5, trk: 150, gs: 450 }, 1800, 150, 450));
}
// adsb.lol's heatmap (who was where, every 20 s): a slice marker, then records - the aircraft at the flight's position
// (and height) found, one 20 km away or 10,000 ft below not. (Real file, 8 Oct 17:30Z: N88RZ found alone, in 9 ms.)
{
  const T = 1791490778, b = Buffer.alloc(16 * 4), w = (i, h, la, lo, alt) => { b.writeUInt32LE(h, i * 16); b.writeInt32LE(Math.round(la * 1e6), i * 16 + 4); b.writeInt32LE(Math.round(lo * 1e6), i * 16 + 8); b.writeInt16LE(Math.round(alt / 25), i * 16 + 12); };
  b.writeUInt32LE(0x0e7f7c9d, 0); b.writeInt32LE(Math.floor(T * 1000 / 4294967296), 4); b.writeUInt32LE((T * 1000) % 4294967296, 8);
  w(1, 0xac1d0b, 55.0, -6.0, 29000); w(2, 0x400001, 55.18, -6.0, 29000); w(3, 0x400002, 55.0, -6.01, 19000);
  const got = E.heatNear(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), T, () => [55.001, -6.0], 29075);
  check('history lookup (heatmap): the aircraft where FR24 had the flight, nobody else', JSON.stringify(got) === '["ac1d0b"]', got);
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
