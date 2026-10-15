// 22.25: the monitor keeps working on the flights it has no name for until one aircraft fits - FR24's playback flights a
// browser asked about, its own live callsign-less flights - laying their paths against every blocked aircraft's track,
// carried across the holes in those tracks by dead reckoning (tracks.cjs estimate, waiting.cjs); and what one browser
// works out reaches every other through it: the routes of flights named here (ident crowdRoute, /fr24ids columns 24-25)
// and the flights it learned from (learn-crowd, /learned). All offline.
// usage: node test/unit_waiting.cjs <dataDir>
const fs = require('fs'), path = require('path'), os = require('os');
process.env.MON_DATA = process.argv[2];
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monwait-'));
global.fetch = async () => ({ status: 404, text: async () => '' });
const M = require('../monitor/monitor.cjs');
const { createTracks } = require('../monitor/tracks.cjs');
const { createWaiting } = require('../monitor/waiting.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const nowS = Math.floor(Date.now() / 1000), day0 = Math.floor(nowS / 86400) * 86400 - 86400;   // (yesterday 00:00 UTC)
// (a great circle from a place on a bearing at a speed: where it is at t)
const course = (lat, lon, brg, kt, t0) => t => E.destPoint(lat, lon, brg, kt * 1.852 * (t - t0) / 3600);
const heard = (pos, from, to, alt, step) => { const out = []; for (let t = from; t <= to; t += step || 20) { const [la, lo] = pos(t); out.push([t, la, lo, alt]); } return out; };
const off = (p, km, brg) => E.destPoint(p[0], p[1], brg == null ? 0 : brg, km);

(async () => {
  // ---- tracks.cjs: dead reckoning on its own -------------------------------------------------------------------------
  {
    const T = createTracks({ store: fs.mkdtempSync(path.join(os.tmpdir(), 'trk-')) });
    const t0 = day0 + 8 * 3600, west = course(51, -15, 265, 480, t0);
    // (heard for half an hour, out of hearing two hours over the ocean, heard again)
    T.put('d00001', heard(west, t0, t0 + 1800, 41000).concat(heard(west, t0 + 9000, t0 + 10800, 41000)));
    const mid = t0 + 5400, e = T.estimate('d00001', mid), truth = west(mid);
    check('in the middle of a two-hour hole: on the great circle between its ends, carried', !!e && e.how === 'reckon' && E.dist(e.lat, e.lon, truth[0], truth[1]) < 3 && e.tol > 50 && e.tol <= 120 && e.alt === 41000, e && { how: e.how, km: E.dist(e.lat, e.lon, truth[0], truth[1]), tol: e.tol, alt: e.alt });
    const e2 = T.estimate('d00001', t0 + 1890), tr2 = west(t0 + 1890);
    check('a minute and a half after its last point: moved on along its last stretch', !!e2 && e2.how === 'track' && E.dist(e2.lat, e2.lon, tr2[0], tr2[1]) < 2, e2 && E.dist(e2.lat, e2.lon, tr2[0], tr2[1]));
    const end = t0 + 10800, e3 = T.estimate('d00001', end + 3600, { remote: () => true }), tr3 = west(end + 3600);
    check('an hour past its last point over open ocean: carried on, its own speed and track', !!e3 && e3.how === 'reckon' && E.dist(e3.lat, e3.lon, tr3[0], tr3[1]) < 15 && e3.tol > 50, e3 && { km: E.dist(e3.lat, e3.lon, tr3[0], tr3[1]), tol: e3.tol });
    check('... but not over land, where airways turn (a quarter of an hour at most)', !T.estimate('d00001', end + 3600) && !!T.estimate('d00001', end + 600));
    check('an hour before its first point, back along its track the same way', !!T.estimate('d00001', t0 - 3600, { remote: () => true }) && !T.estimate('d00001', t0 - 3600));
    // (slow across a hole: it stopped somewhere - no guess; on the ground at one spot either side: there all along)
    const t1 = day0 + 14 * 3600;
    T.put('d00002', [[t1, 40, -100, 300], [t1 + 60, 40.05, -100, 300], [t1 + 7200, 40.3, -100, 300], [t1 + 7260, 40.35, -100, 300]]);
    check('slow across a two-hour hole (stopped or went round somewhere): no guess', !T.estimate('d00002', t1 + 3600));
    T.put('d00003', [[t1, 41, -90, 'ground'], [t1 + 300, 41.0001, -90, 'ground'], [t1 + 9000, 41.0003, -90, 'ground']]);
    const p = T.estimate('d00003', t1 + 5000);
    check('on the ground at one spot either side of a hole: parked there all along', !!p && p.how === 'parked' && p.gnd && E.dist(p.lat, p.lon, 41, -90) < 0.1, p);
    check('every kept aircraft at a moment, with how far off each may be', T.atAll(mid).some(x => x[0] === 'd00001' && x[6] === 'reckon' && x[5] > 50));
  }

  // ---- a playback moment: carried across a hole, named at once -------------------------------------------------------
  const blocked = (hex, reg, type) => M.markBlocked(hex, { reg, type }, nowS);
  const tA = day0 + 10 * 3600, A = course(51, -15, 265, 480, tA);
  blocked('c00001', 'N801GA', 'GLF6');
  M.tracks.put('c00001', heard(A, tA, tA + 1800, 41000).concat(heard(A, tA + 9000, tA + 10800, 41000)));
  const T1 = tA + 5400, f1 = off(A(T1), 3);
  // (two jets of one type on parallel tracks 30 km apart over the Pacific, both out of hearing)
  const tB = day0 + 10 * 3600, B1 = course(30, -150, 90, 470, tB), B2 = course(30.27, -150, 90, 470, tB);
  blocked('c00002', 'N802GA', 'GLF6'); blocked('c00003', 'N803GA', 'GLF6');
  M.tracks.put('c00002', heard(B1, tB, tB + 1800, 43000).concat(heard(B1, tB + 9000, tB + 10800, 43000)));
  M.tracks.put('c00003', heard(B2, tB, tB + 1800, 41000).concat(heard(B2, tB + 9000, tB + 10800, 41000)));
  const mB = B1(T1), mB2 = B2(T1), fB = [(mB[0] + mB2[0]) / 2, (mB[1] + mB2[1]) / 2];
  const r1 = M.pbMatch(T1, [[7001, f1[0], f1[1], 41000, 'GLF6', 0], [7002, fB[0], fB[1], 42000, 'GLF6', 0]]);
  const by1 = Object.fromEntries(r1.map(r => [r[0], r]));
  check('a playback flight in the middle of a jet\'s two-hour hole over the Atlantic: named, reckoned', by1[7001] && by1[7001][1] === 'c00001' && by1[7001][6] === 'reckon' && by1[7001][2] === 'N801GA', by1[7001]);
  check('two jets of its type carried to about the same place: neither', !by1[7002], by1[7002]);
  check('... that one kept waiting, to be tried again', M.waiting.W.has(7002) && !M.waiting.W.has(7001));
  check('the one named is kept with the names for playback, as worked out', (M.names.peek(7001, T1) || [])[7] === 'reckon', M.names.peek(7001, T1));
  // (one aircraft, one flight: another FR24 flight there at the same time is not that jet too)
  const r1b = M.pbMatch(T1 + 60, [[7005, f1[0], f1[1], 41000, 'GLF6', 0]]);
  check('another flight at the same place and time: not given the aircraft already named', !r1b.some(r => r[1] === 'c00001'), r1b);

  // ---- not placed yet: kept, and named once the aircraft's day is rebuilt ---------------------------------------------
  const tC = day0 + 14 * 3600, C = course(38, -98, 90, 420, tC);
  blocked('c00004', 'N804CJ', 'C68A');
  M.tracks.put('c00004', heard(C, tC, tC + 1200, 33000));
  const T3 = tC + 2400, f3 = off(C(T3), 2);
  const r3 = M.pbMatch(T3, [[7003, f3[0], f3[1], 33000, 'C68A', 0]]);
  check('forty minutes past its last point, over land: not named yet', !r3.some(r => r[0] === 7003), r3);
  check('... kept waiting', M.waiting.W.has(7003));
  // (the day rebuilt from adsb.lol's trace a day later: its whole flight)
  M.tracks.put('c00004', heard(C, tC + 1200, tC + 5400, 33000));
  const n3 = M.waitRound(Date.now(), 5000);
  const nm3 = M.names.peek(7003, T3);
  check('the aircraft\'s day rebuilt: the waiting flight named in the background', n3 >= 1 && !!nm3 && nm3[1] === 'c00004', { n3, nm3 });
  const r3b = M.pbMatch(T3, [[7003, f3[0], f3[1], 33000, 'C68A', 0]]);
  check('... and the browser\'s next ask has it at once, as worked out later', r3b.length === 1 && r3b[0][1] === 'c00004' && r3b[0][6] === 'track' && r3b[0][2] === 'N804CJ', r3b);
  check('... no longer waiting', !M.waiting.W.has(7003));

  // ---- two moments of a playback: a path, where one moment alone was not enough -----------------------------------------
  {
    const tD = day0 + 9 * 3600, D = course(45, -35, 270, 450, tD);
    blocked('c00005', 'N805GA', 'GLF5');
    M.tracks.put('c00005', heard(D, tD, tD + 1800, 39000).concat(heard(D, tD + 9000, tD + 10800, 39000)));
    // (FR24 has it 70 km north of the great circle - a track across the ocean that is not the shortest way)
    const T4 = tD + 5400, g1 = off(D(T4), 70, 0), g2 = off(D(T4 + 300), 70, 0);
    const a = M.pbMatch(T4, [[7004, g1[0], g1[1], 39000, 'GLF5', 0]]);
    check('70 km off the great circle at one moment: not enough alone', !a.some(r => r[0] === 7004), a);
    const b = M.pbMatch(T4 + 300, [[7004, g2[0], g2[1], 39000, 'GLF5', 0]]);
    check('... the same flight five minutes on, the path agreeing: named', b.some(r => r[0] === 7004 && r[1] === 'c00005' && r[6] === 'reckon'), b);
  }

  // ---- the monitor's own live flights: kept trying ----------------------------------------------------------------------
  const now = Date.now(), L = course(50, -30, 260, 470, nowS - 900);
  blocked('c00006', 'N806GA', 'GLF6');
  M.tracks.put('c00006', heard(L, nowS - 900, nowS - 30, 41000));
  const obs = (id, k) => { const t = nowS - 480 + k * 120, [la, lo] = L(t); return { id, lat: la + 0.01, lon: lo, alt: 41000, trk: 262, spd: 470, ts: t, gnd: false, src: 0, type: 'GLF6', reg: '', cs: '', icon: 0 }; };
  for (let k = 0; k <= 4; k++) M.ident.observe([obs(8001, k)], now - (4 - k) * 120000, 'scan');
  check('a callsign-less flight FR24 draws, no aircraft heard where it is now: not named live', !M.ident.ids.has(8001));
  M.waitRound(Date.now(), 5000);
  const R8 = M.ident.ids.get(8001);
  check('its path so far against the tracks: named, live', !!R8 && R8.hex === 'c00006' && R8.how === 'path', R8 && { hex: R8.hex, how: R8.how });
  for (let k = 0; k <= 4; k++) M.ident.observe([obs(8002, k)], now - (4 - k) * 120000, 'scan');
  M.waitRound(Date.now(), 5000);
  check('one aircraft, one flight: another flight at the same place not given it too', !M.ident.ids.has(8002));
  {
    // (two playback flights at once where one aircraft was: which is which cannot be told - neither)
    const T5 = tC + 4000, q = C(T5), r5 = M.pbMatch(T5, [[7008, q[0], q[1], 33000, 'C68A', 0], [7009, q[0] + 0.02, q[1], 33000, 'C68A', 0]]);
    check('two playback flights at once where one aircraft was: neither', r5.length === 0 && M.waiting.W.has(7008) && M.waiting.W.has(7009), r5);
    M.waitRound(Date.now() + 120000, 5000);
    check('... nor later in the background', !M.names.peek(7008, T5) && !M.names.peek(7009, T5));
  }
  const live8 = 8001;
  const row8 = M.ident.table(0).rows.find(r => r[0] === live8);
  check('every browser has it from /fr24ids', !!row8 && row8[1] === 'c00006' && row8[6] === 'path' && row8[24] === 0, row8);

  // ---- a browser's route for a flight named here, to every other browser -------------------------------------------
  {
    const teb = E.byIcao('KTEB'), ggw = E.byIcao('EGGW'), lbg = E.byIcao('LFPB'), bed = E.byIcao('KBED');
    const anyone = { admin: false, ip: '203.0.113.9' }, owner = { admin: true, ip: '127.0.0.1' };
    let rep = M.report({ routes: [[live8, 'c00006', ggw.id, 'ground', teb.id, 72, 'likely', nowS + 4 * 3600, nowS - 3 * 3600]] }, Date.now(), anyone);
    let r = M.ident.table(0).rows.find(x => x[0] === live8);
    check('a route worked out in one browser: taken', rep.routes === 1 && r[8] === ggw.id && r[10] === teb.id && r[11] === 72 && r[24] === 1 && r[25] === 'likely' && r[18] === nowS + 4 * 3600, { rep, r: r.slice(8, 13).concat(r.slice(24)) });
    rep = M.report({ routes: [[live8, 'c00006', ggw.id, 'ground', lbg.id, 80, 'likely', 0, 0]] }, Date.now(), anyone);
    r = M.ident.table(0).rows.find(x => x[0] === live8);
    check('a destination behind the flight (Paris, for a jet heading west mid-Atlantic): refused', rep.routes === 0 && r[10] === teb.id, { rep, d: r[10] });
    rep = M.report({ routes: [[live8, 'c00099', ggw.id, 'ground', teb.id, 72, 'likely', 0, 0]] }, Date.now(), anyone);
    check('a route for another aircraft than the one named: refused', rep.routes === 0);
    M.report({ routes: [[live8, 'c00006', ggw.id, 'ground', bed.id, 66, 'probable', 0, 0]] }, Date.now(), owner);
    M.report({ routes: [[live8, 'c00006', ggw.id, 'ground', teb.id, 90, 'likely', 0, 0]] }, Date.now(), anyone);
    r = M.ident.table(0).rows.find(x => x[0] === live8);
    check('the owner\'s browser\'s route stands over anyone else\'s for a while', r[10] === bed.id, r[10]);
    { const c = M.ident.ids.get(live8).crowd; c.ot -= 1300; c.dt -= 1300; }
    M.report({ routes: [[live8, 'c00006', ggw.id, 'ground', teb.id, 100, 'confirmed', 0, 0]] }, Date.now(), anyone);
    r = M.ident.table(0).rows.find(x => x[0] === live8);
    check('a destination confirmed in a browser: marked so', r[10] === teb.id && r[24] === 2 && r[25] === 'confirmed', r.slice(24));
    const since = Date.now() - 1;
    M.report({ routes: [[live8, 'c00006', ggw.id, 'ground', teb.id, 100, 'confirmed', nowS + 3600, 0]] }, Date.now() + 5, anyone);
    check('... and handed out again to the browsers that had the name already', M.ident.table(since).rows.some(x => x[0] === live8));
    // (a browser's route with only an origin: the monitor's own rough destination kept with it, marked as its own)
    const id9 = 8009, nowMs9 = Date.now();
    M.ident.observe([{ id: id9, lat: 47, lon: -40, alt: 39000, trk: 255, spd: 460, ts: nowS, gnd: false, src: 0, type: 'GLF5', reg: '', cs: '', icon: 0 }], nowMs9, 'scan');
    M.ident.assign(M.ident.flights.get(id9), 'c00009', { reg: 'N809GA', type: 'GLF5', ladd: true }, 'list', nowMs9);
    M.ident.ids.get(id9).dest = { id: bed.id, p: 0.55, at: nowS, eta: nowS + 5000 };
    rep = M.report({ routes: [[id9, 'c00009', ggw.id, 'ground', 0, 0, '', 0, nowS - 7200]] }, Date.now(), anyone);
    r = M.ident.table(0).rows.find(x => x[0] === id9);
    check('a browser\'s route with only an origin: taken, the monitor\'s own destination kept with it (marked its own)', rep.routes === 1 && r[8] === ggw.id && r[9] === 'ground' && r[19] === nowS - 7200 && r[10] === bed.id && r[11] === 55 && r[18] === nowS + 5000 && r[24] === 1 && r[25] === '' && r[26] === 1, r.slice(8, 20).concat(r.slice(24)));
    rep = M.report({ routes: [[id9, 'c00009', 0, '', teb.id, 66, '', 0, 0]] }, Date.now(), { admin: false, ip: '198.51.100.7' });
    r = M.ident.table(0).rows.find(x => x[0] === id9);
    check('... then one with only a destination, from another browser: the destination worded (predicted when it came without a word), the first one\'s origin kept', rep.routes === 1 && r[10] === teb.id && r[11] === 66 && r[25] === 'predicted' && r[8] === ggw.id && r[19] === nowS - 7200 && r[26] === 1, r.slice(8, 20).concat(r.slice(24)));
    rep = M.report({ routes: [[id9, 'c00009', 0, '', bed.id, 50, 'probable', 0, 0]] }, Date.now(), anyone);
    r = M.ident.table(0).rows.find(x => x[0] === id9);
    check('... another airport far less sure, soon after: not taken', rep.routes === 0 && r[10] === teb.id && r[11] === 66, { rep: rep.routes, d: r[10], p: r[11] });
    // (an hour on, the jet no nearer Teterboro: that destination dropped, the monitor's own handed out again - to the
    // browsers that had the row too; the origin stays)
    const since9 = Date.now() - 1;
    M.ident.ids.get(id9).crowd.kmAt -= 3700; M.ident.prune(Date.now() + 5);
    r = M.ident.table(0).rows.find(x => x[0] === id9);
    check('a browser\'s destination the flight comes no nearer to in an hour: dropped, the monitor\'s own back, the origin kept', r[10] === bed.id && r[11] === 55 && r[24] === 1 && r[25] === '' && r[8] === ggw.id && r[26] === 1 && M.ident.table(since9).rows.some(x => x[0] === id9), r.slice(8, 13).concat(r.slice(24)));
    // (sent again; an hour on, 120 km nearer: kept)
    M.report({ routes: [[id9, 'c00009', 0, '', teb.id, 70, 'probable', 0, 0]] }, Date.now(), anyone);
    { const F = M.ident.flights.get(id9); F.lon -= 1.6; M.ident.ids.get(id9).crowd.kmAt -= 3700; M.ident.prune(Date.now()); }
    r = M.ident.table(0).rows.find(x => x[0] === id9);
    check('... one it is nearer to: kept, its own flight checked again an hour on', r[10] === teb.id && r[25] === 'probable' && Date.now() / 1000 - M.ident.ids.get(id9).crowd.kmAt < 5, r.slice(8, 13).concat(r.slice(24)));
    M.ident.ids.get(live8).crowd.kmAt -= 3700; M.ident.prune(Date.now());
    r = M.ident.table(0).rows.find(x => x[0] === live8);
    check('... a confirmed one: kept however it goes', r[10] === teb.id && r[24] === 2, r.slice(24));
  }

  // ---- the flights a browser learned, learned by every other ---------------------------------------------------------
  {
    const ggw = E.byIcao('EGGW'), lbg = E.byIcao('LFPB'), teb = E.byIcao('KTEB'), t0 = day0 - 86400 + 12 * 3600;
    const row = (hex, t, a, b, dur, cls, ty) => [hex + '|' + t, a, b, t + dur, '', '', cls || 'bizjet', 0, t, 'ABC12', ty || 'C68A', ''];
    M.CFG.learnPerHour = 4;
    M.legs.set('c0d0d0', new Map([[1, { hex: 'c0d0d0', tStart: t0 - 300, tEnd: t0 + 3000, tOff: t0, tOn: t0 + 2700, from: { id: ggw.id }, to: { id: lbg.id } }]]));
    const rep = M.report({ learn: [row('c0abcd', t0, ggw.id, lbg.id, 3600), row('c0abce', t0, 99999999, lbg.id, 3600), row('c0abcf', t0, ggw.id, teb.id, 3600), ['nope'], row('c0d0d0', t0 + 20, ggw.id, lbg.id, 2700), row('c0abd0', t0 + 7200, lbg.id, ggw.id, 3000)] }, Date.now(), { admin: false, ip: '198.51.100.7' });
    check('a browser\'s flights: the real ones taken', rep.learned === 2, rep);
    check('... an unknown airport, faster than a jet, a broken row refused; one the monitor has itself left out', M.LC.refused === 3 && M.LC.dup === 1, M.LC);
    const many = []; for (let k = 0; k < 6; k++) many.push(row('c0e00' + k, t0 + k * 600, ggw.id, lbg.id, 3600));
    const rep2 = M.report({ learn: many }, Date.now(), { admin: false, ip: '198.51.100.7' });
    check('from anyone\'s browser, so many an hour at most', rep2.learned === 2, rep2);
    const rep3 = M.report({ learn: many }, Date.now(), { admin: true, ip: '127.0.0.1' });
    check('the owner\'s browser: all of them', rep3.learned === 6, rep3);
    M.crowdLearnSave();
    const f = path.join(process.env.MON_STORE, 'learn-crowd', dayOf(t0) + '.json');
    check('kept on disk with the day of the flight', fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).length === 8, fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).length);
    // (the monitor's own rows of that day: one is c0abcd's flight seen here too - learned once)
    const own = path.join(process.env.MON_STORE, 'learn'); fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, dayOf(t0) + '.json'), JSON.stringify([row('c0abcd', t0 + 40, ggw.id, lbg.id, 3550), row('c0f00f', t0, lbg.id, ggw.id, 3600)]));
    const o = await M.learnedBuild(nowS);
    check('learned with the monitor\'s own flights, each flight once', !!o && o.flights === 2 + 7 && o.crowd === 7, o && { flights: o.flights, crowd: o.crowd });
    check('/status counts them', (() => { const st = M.answer(new URL('http://x/status'), nowS, { admin: true }); return st.learned.fromBrowsers === 7 && st.shared.learnRows.taken === 10 && st.shared.routes >= 3 && st.shared.destsDropped === 1 && st.waiting && st.waiting.flights >= 1; })(), (() => { const st = M.answer(new URL('http://x/status'), nowS, { admin: true }); return { learned: st.learned, shared: st.shared, waiting: st.waiting }; })());
    check('... with the number of the last browser report it has (each report\'s flights kept with theirs)', o.builtSeq >= rep3.learnSeq && rep3.learnSeq > rep2.learnSeq && rep2.learnSeq > rep.learnSeq && JSON.parse(fs.readFileSync(f, 'utf8')).every(r => r.length === 13 && r[12] >= rep.learnSeq), { builtSeq: o.builtSeq, seqs: [rep.learnSeq, rep2.learnSeq, rep3.learnSeq] });
    check('... and the places in the list of those not taken, for the browser to learn on itself', JSON.stringify(rep.learnNot) === '[1,2,3]' && JSON.stringify(rep2.learnNot) === '[2,3,4,5]' && !rep3.learnNot, [rep.learnNot, rep2.learnNot, rep3.learnNot]);
    // (one taken after a build began - numbered after it: in the next build, not that one)
    { const all = JSON.parse(fs.readFileSync(f, 'utf8')); all.push(row('c0f1f1', t0 + 9000, lbg.id, ggw.id, 3600).concat([o.builtSeq + 1e9])); fs.writeFileSync(f, JSON.stringify(all));
      const o2 = await M.learnedBuild(nowS);
      check('a flight taken while a build was on its way: left for the next one', !!o2 && o2.crowd === 7, o2 && o2.crowd); }
    // (the same flight sent again by another browser: kept once, with the first number)
    { const again = M.report({ learn: [row('c0abcd', t0, ggw.id, lbg.id, 3600)] }, Date.now() + 10, { admin: true, ip: '127.0.0.1' }); M.crowdLearnSave();
      const k = JSON.parse(fs.readFileSync(f, 'utf8')).filter(r => r[0] === 'c0abcd|' + t0);
      check('the same flight from a second browser: kept once, as the first sent it', again.learned === 1 && k.length === 1 && k[0][12] === rep.learnSeq, k.map(r => r[12])); }
  }

  // ---- kept across a restart -----------------------------------------------------------------------------------------
  {
    M.saveWaiting();
    const W2 = createWaiting({ tracks: M.tracks });
    const n = W2.restore(JSON.parse(fs.readFileSync(path.join(process.env.MON_STORE, 'waiting.json'), 'utf8')), Date.now());
    check('the flights still being worked on, kept for the next start', n === M.waiting.size && n >= 1 && W2.W.get(7002).pts.length === 1, { n, size: M.waiting.size });
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
