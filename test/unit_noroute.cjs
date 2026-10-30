// (1.1.0) Every flight FR24 draws without a destination, worked out on the monitor too:
//   - the world scan asks FR24 for the route and the aircraft's address in each record; refused, the next step down (route
//     alone, then type and registration as before) - the scan goes on;
//   - routes known only when FR24 sends them (a twentieth of the records at least): asked and not sent, none taken for
//     "no destination";
//   - a flight with a callsign or registration, airborne, no destination, its address known: kept as the scans see it,
//     its position a minute apart at most; one with a destination, on the ground, without an address: not; gone from the
//     scans a quarter of an hour: let go;
//   - its evidence for central calculation: its track, the aircraft, where FR24 says it came from.
// usage: node test/unit_noroute.cjs [dataDir]
const fs = require('fs'), path = require('path'), os = require('os');
process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monnoroute-'));
const FR = require('../monitor/fr24.cjs');
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };

(async () => {
  // ---- the request
  { const q = FR.liveFeedRequest({ n: 60, s: 50, w: -10, e: 5, mask: FR.MASKS[0] }), fs0 = FR.parse(q), mask = FR.parse(fs0.find(f => f.fn === 10).val).map(f => Buffer.from(f.val).toString());
    const q2 = FR.liveFeedRequest({ n: 60, s: 50, w: -10, e: 5 }), mask2 = FR.parse(FR.parse(q2).find(f => f.fn === 10).val).map(f => Buffer.from(f.val).toString());
    check('the world scan asks for the route and the aircraft\'s address in every record; without a mask, type and registration as before', mask.join() === 'type,reg,route,icao_address' && mask2.join() === 'type,reg', { mask, mask2 }); }
  // ---- refused: the next step down
  const F24 = M.F24ref(), CFG = M.CFG, asked = [];
  CFG.fr24Scan = true; CFG.fr24Gap = 0;
  const T = Math.floor(Date.now() / 1000);
  const rec = (id, o) => Object.assign({ id, lat: 51, lon: -1, trk: 90, alt: 20000, spd: 300, icon: 1, ts: T, gnd: false, cs: 'NJE' + id, src: 0, reg: 'CS-D' + id, type: 'C68A', hex: (0x490000 + id).toString(16), from: 'LTN', to: '' }, o);
  let mode = 'refuse';
  M.fr24.liveFeed = async q => {
    asked.push((q.mask || []).join(','));
    if (mode === 'refuse' && (q.mask || []).includes('icao_address')) throw new Error('grpc 3 unknown field');
    if (mode === 'quiet') return { flights: Array.from({ length: 60 }, (_, i) => rec(100 + i, { from: '', to: '', hex: '' })), serverTime: T };
    return { flights: [rec(1), rec(2, { to: 'LHR' }), rec(3, { gnd: true, alt: 0 }), rec(4, { hex: '' }), rec(5, { cs: '', reg: '' })].concat(Array.from({ length: 60 }, (_, i) => rec(200 + i, { to: 'CDG' }))), serverTime: T };
  };
  await M.fr24Round();
  check('FR24 refusing the fields asked for: one request only, then the next step down (the route alone)', asked.length === 1 && F24.mask === 1 && asked[0] === 'type,reg,route,icao_address', { asked, mask: F24.mask });
  asked.length = 0; mode = 'quiet';
  await M.fr24Round();
  check('... asked and no record says where it goes: routes not taken as known - no flight kept as "no destination"', asked[0] === 'type,reg,route' && F24.routeOk === false && M.naF.size === 0, { routeOk: F24.routeOk, n: M.naF.size });
  // (FR24 answering with routes and addresses - the first mask again)
  F24.mask = 0; mode = 'ok'; asked.length = 0;
  await M.fr24Round();
  const ids = [...M.naF.keys()].sort();
  check('FR24 saying where its flights go: the airborne one with no destination, a callsign and an address kept - not one with a destination, on the ground, with no address, or neither callsign nor registration', F24.routeOk && F24.hexOk && ids.join() === '1', { ids, routeOk: F24.routeOk, hexOk: F24.hexOk });
  const ev = M.selfEvidence(1);
  check('... too few positions for a track: no evidence yet', ev === null);
  // (its next position a minute later)
  M.fr24.liveFeed = async () => ({ flights: [rec(1, { ts: T + 60, lon: -0.9 })], serverTime: T + 60 });
  await M.fr24Round();
  const ev2 = M.selfEvidence(1), luton = E.byIcao('EGGW');
  check('... a minute later: its evidence - its track as the scans saw it, the aircraft, where FR24 says it came from (Luton)', !!ev2 && ev2.kind === 'pub' && ev2.hex === '490001' && ev2.ac.reg === 'CS-D1' && ev2.trail.pts.length === 2 && ev2.plan && ev2.plan.originId === luton.id && ev2.pos.lon === -0.9, ev2 && { kind: ev2.kind, hex: ev2.hex, n: ev2.trail.pts.length, plan: ev2.plan });
  // (gone from the scans for a quarter of an hour)
  M.naTrack([], Date.now() + 16 * 60000);
  check('... gone from the scans a quarter of an hour: let go', M.naF.size === 0);
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
