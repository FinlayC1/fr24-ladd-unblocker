// Airport boards without false flights (the BUILT userscript in jsdom). Liverpool's arrivals were full of "Liverpool ->
// Liverpool, landed" airliners - EI-EVN as RYR8SF at 17:33, an hour before it flew to Szczecin: FR24's own flights with
// an origin but no destination yet, taxiing with the transponder saying "airborne", taken for an approach to the field
// they were on and "landed" at the next report on the ground - kept because their take-off time was unknown (0) and
// "landed 0 seconds after 0" passed the same-field check. Checked:
//   - a taxi at Liverpool (FR24: "airborne", 5-30 kt, field height): never routed, never on a board
//   - the same jet taking off and climbing away east: never "to Liverpool"
//   - a real VFR arrival from Blackpool: routed to Liverpool and landed there (on its arrivals, from Blackpool)
//   - a Tomahawk's circuits at Liverpool after a seen take-off: Liverpool -> Liverpool kept
//   - boardNoteFlight: a same-field landing without a take-off seen goes; a jet's real return after an hour stays
//   - rows an older build kept of such "flights": gone when the board is read; FR24's own and real circuits stay
//   - the engine's rule (localFlew) on its own
// usage: node test/unit_boards.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const OA = fs.readFileSync(path.join(DATA, 'oa_airports.csv'), 'utf8');
const RWY = JSON.parse(fs.readFileSync(path.join(DATA, 'runways.json'), 'utf8')), RWL = JSON.parse(fs.readFileSync(path.join(DATA, 'runway_len.json'), 'utf8'));

function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53.33,-2.85/10', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  const answer = url => /flightradar24\.com\/mobile\/airports\/format/.test(url) ? [200, AIRPORTS] : /ourairports-data\/main\/airports\.csv/.test(url) ? [200, OA] : [404, ''];
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = () => {}; win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  L.engine.setRunways(RWY); L.engine.setRunwayLengths(RWL);
  await L.loadT2().catch(() => false); await Promise.resolve(L.loadApprTable()).catch(() => false);
  const E = L.engine, lpl = E.byIcao('EGGP'), blk = E.byIcao('EGNH');
  check('the engine as the browser runs it: Liverpool and Blackpool', !!lpl && !!blk && E.airports.length > 5000);
  const nowS = Math.round(Date.now() / 1000);

  // FR24's report of a flight it shows without a destination (page.js's "na" rows), fed as the page feeds them
  let nid = 0x3a000000;
  function flight(o) {
    const id = ++nid, pts = [];
    return {
      id,
      at(t, lat, lon, alt, spd, trk, gnd) { pts.push({ id, lat, lon, alt, spd, trk, ts: t, gnd: !!gnd, cs: o.cs, reg: o.reg, type: o.type, hex: parseInt(o.hex, 16), from: o.from || '' }); },
      // each report given to the script as the page does, and the route worked out after each (as the 45 s rounds do)
      run() { const out = []; for (const p of pts) { L.noteNa([p], p.ts * 1000); const e = L.naFeed.get(id); const r = L.naRouteOf(e); e.pub = r; out.push(r); } return out; },
      pts
    };
  }
  const along = (a, brgDeg, km) => E.destPoint(a[0], a[1], brgDeg, km);

  // ---- 1. EI-EVN taxiing at Liverpool as RYR8SF, FR24 "airborne" all the way, then on the ground at the stand
  { const f = flight({ cs: 'RYR8SF', reg: 'EI-EVN', type: 'B738', hex: '4ca7b1', from: 'LPL' });
    let t = nowS - 3600, p = [lpl.lat + 0.004, lpl.lon - 0.012];
    f.at(t, p[0], p[1], 0, 0, 0, true); t += 40;
    for (let i = 0; i < 18; i++) { p = along(p, i < 9 ? 90 : 270, 0.12); f.at(t, p[0], p[1], 75 + (i % 3) * 25, 5 + (i * 7) % 26, i < 9 ? 90 : 270, false); t += 25; }
    f.at(t, p[0], p[1], 0, 0, 270, true); t += 30; f.at(t, p[0], p[1], 0, 0, 270, true);
    const rs = f.run();
    check('a taxi at Liverpool with the transponder saying "airborne": never routed, never landed', rs.every(r => !r), rs.filter(Boolean).map(r => [r.destIata, r.landed]));
  }
  // ---- 2. the same jet taking off on runway 27 and climbing away east (FR24: from LPL, no destination yet)
  { const f = flight({ cs: 'RYR8SF', reg: 'EI-EVN', type: 'B738', hex: '4ca7b1', from: 'LPL' });
    let t = nowS - 2400, p = [lpl.lat - 0.002, lpl.lon + 0.03];
    f.at(t, p[0], p[1], 0, 12, 266, true); t += 30; f.at(t, p[0], p[1], 0, 20, 266, true); t += 25;
    // (the roll and the lift-off, FR24 "airborne" from 100 kt; then the climb, turning east over the Mersey)
    p = along(p, 266, 1.2); f.at(t, p[0], p[1], 80, 110, 266, false); t += 20;
    p = along(p, 266, 1.6); f.at(t, p[0], p[1], 400, 150, 266, false); t += 20;
    p = along(p, 266, 2.2); f.at(t, p[0], p[1], 1300, 165, 266, false); t += 20;
    for (let i = 0; i < 25; i++) { const h = i < 4 ? 266 - i * 40 : 95; p = along(p, (h + 360) % 360, 3.5); f.at(t, p[0], p[1], Math.min(24000, 2000 + i * 1100), Math.min(420, 190 + i * 10), (h + 360) % 360, false); t += 20; }
    const rs = f.run(), bad = rs.filter(r => r && r.destId === lpl.id);
    check('the same jet taking off and climbing away: never "to Liverpool"', !bad.length, bad.map(r => [r.destIata, r.phase, r.landed]));
  }
  // ---- 2b. the way the real rows came about: a long taxi (17 minutes, on the ground), then the roll - FR24 "airborne" at
  // 110 and 140 kt, then "on the ground" again at 150 kt (its ground flag flickering), then the climb. The old take-off time
  // was the second report of the taxi, so "17 minutes since take-off" let the roll pass for an approach to Liverpool, and
  // the flicker for a landing there
  const roll = (from, opts) => {
    const f = flight({ cs: opts.cs, reg: opts.reg, type: 'B738', hex: opts.hex, from });
    let t = nowS - 5400, p = [lpl.lat + 0.004, lpl.lon - 0.012];
    if (opts.taxi) for (let i = 0; i < 52; i++) { p = along(p, i % 2 ? 100 : 80, 0.03); f.at(t, p[0], p[1], 0, 12, 90, true); t += 20; }
    p = [lpl.lat - 0.002, lpl.lon + 0.028];
    f.at(t, p[0], p[1], 75, 110, 266, false); t += 10;
    p = along(p, 266, 0.7); f.at(t, p[0], p[1], 75, 140, 266, false); t += 10;
    p = along(p, 266, 0.8); f.at(t, p[0], p[1], 0, 150, 266, true); t += 10;
    for (let i = 0; i < 12; i++) { p = along(p, 266, 1.8); f.at(t, p[0], p[1], 600 + i * 500, 170, 266, false); t += 20; }
    return f.run();
  };
  { const rs = roll('LPL', { cs: 'EXS863R', reg: 'G-DEMA', hex: '400f10', taxi: true }), bad = rs.filter(r => r && r.destId === lpl.id);
    check('a long taxi, then the take-off roll with FR24\'s ground flag flickering: never "to Liverpool", never landed there', !bad.length, bad.map(r => [r.originIata, r.destIata, r.landed, r.destConf])); }
  { const rs = roll('', { cs: 'EZY23QM', reg: 'G-DEMB', hex: '400f11', taxi: false }), bad = rs.filter(r => r && r.destId === lpl.id);
    check('... first seen on the roll, FR24 giving no origin: no arrival at Liverpool either', !bad.length, bad.map(r => [r.originIata, r.destIata, r.landed, r.destConf])); }
  // ---- 2c. a Ryanair out of Manchester (FR24: from MAN, no destination), climbing out west and coming down on a line for
  // Liverpool's 27 - an airline's jet flying its number is never routed to a field 45 km from the one it left; the same
  // flight by a private jet is
  { const man = E.byIcao('EGCC'), out = (cs, reg, hex) => {
      const f = flight({ cs, reg, type: 'B738', hex, from: 'MAN' });
      let t = nowS - 1800, p = [man.lat + 0.005, man.lon - 0.005];
      f.at(t, p[0], p[1], 0, 15, 232, true); t += 30; f.at(t, p[0], p[1], 0, 20, 232, true); t += 20;
      for (let i = 0; i < 6; i++) { p = along(p, 232, 2.2); f.at(t, p[0], p[1], 600 + i * 600, 170, 232, false); t += 20; }
      const gate = along([lpl.lat, lpl.lon], 86, 9);
      for (let i = 0; i < 30; i++) { const d = E.dist(p[0], p[1], gate[0], gate[1]); if (d < 1) break; const b = E.brg(p[0], p[1], gate[0], gate[1]); p = along(p, b, Math.min(2.4, d)); f.at(t, p[0], p[1], 4000, 220, b, false); t += 20; }
      for (let i = 0; i < 8; i++) { p = along(p, 266, 0.9); f.at(t, p[0], p[1], Math.max(300, 2600 - i * 300), 150, 266, false); t += 20; }
      return f.run();
    };
    const rs = out('RYR60SF', 'EI-DEP', '4ca7c1'), bad = rs.filter(r => r && E.dist(man.lat, man.lon, E.byId(r.destId).lat, E.byId(r.destId).lon) <= 80);
    check('a Ryanair out of Manchester, coming down towards Liverpool: never "to Liverpool" or "to Manchester"', !bad.length, bad.map(r => [r.destIata, r.destConf]));
    const pv = out('GDEMP', 'G-DEMP', '400f12').filter(Boolean).pop();
    check('... a private jet flying the same: to Liverpool', !!pv && pv.destId === lpl.id, pv && [pv.destIata, pv.destConf]);
  }
  // ---- 3. a real VFR arrival from Blackpool: down the coast, final for 27, landed
  let arrival = null;
  { const f = flight({ cs: 'GDEMO', reg: 'G-DEMO', type: 'C172', hex: '400f01', from: 'BLK' });
    let t = nowS - 3000, p = along([blk.lat, blk.lon], 180, 8);
    for (let i = 0; i < 26; i++) { const tgt = along([lpl.lat, lpl.lon], 86, 9), b = E.brg(p[0], p[1], tgt[0], tgt[1]); p = along(p, b, Math.min(2.2, E.dist(p[0], p[1], tgt[0], tgt[1]))); f.at(t, p[0], p[1], 2000, 100, b, false); t += 60; }
    // (final for 27: 9 km out, down to the runway)
    for (let i = 0; i < 10; i++) { p = along(p, 266, 0.9); f.at(t, p[0], p[1], Math.max(80, 1500 - i * 150), 80, 266, false); t += 30; }
    f.at(t, p[0], p[1], 0, 25, 266, true); t += 30; f.at(t, p[0], p[1], 0, 10, 266, true);
    const rs = f.run(), last = rs[rs.length - 1]; arrival = last;
    check('a real VFR arrival from Blackpool: to Liverpool and landed there, from Blackpool', !!last && last.destId === lpl.id && last.landed && last.originId === blk.id && last.ata > 0, last && [last.originIata, last.destIata, last.landed]);
  }
  // ---- 4. a Tomahawk's circuits at Liverpool, take-off seen
  { const f = flight({ cs: 'GDEMT', reg: 'G-DEMT', type: 'PA38', hex: '400f02', from: '' });
    let t = nowS - 4000, p = [lpl.lat - 0.002, lpl.lon + 0.03];
    f.at(t, p[0], p[1], 0, 10, 266, true); t += 30; f.at(t, p[0], p[1], 0, 15, 266, true); t += 20;
    const lap = () => { for (const [h, km, alt] of [[266, 2.4, 300], [266, 2, 900], [176, 2.5, 1100], [86, 3, 1100], [86, 3, 1100], [356, 2.5, 1000], [266, 2.2, 700], [266, 2.4, 250]]) { p = along(p, h, km); f.at(t, p[0], p[1], alt, 75, h, false); t += 40; } };
    for (let i = 0; i < 4; i++) lap();
    const rs = f.run(), got = rs.filter(r => r && r.destId === lpl.id);
    check('a Tomahawk flying circuits at Liverpool after a seen take-off: Liverpool -> Liverpool kept (a real local flight)', got.length > 0 && got.some(r => r.phase === 'circuits' && r.atd > 0), got.slice(-1).map(r => [r.originIata, r.destIata, r.phase, !!r.atd]));
  }

  // ---- boardNoteFlight
  const bl = await L.boardLoad(lpl.id);
  const rowsOf = async () => { await L.boardDrain(); const b = L.boardMem.get(lpl.id); return { arr: Object.values(b.arr).filter(r => !r.drop), dep: Object.values(b.dep).filter(r => !r.drop) }; };
  { const jet = { hex: '4ca7b1', reg: 'EI-EVN', type: 'B738', cs: 'RYR8SF' };
    L.boardNoteFlight(0x3b000001, jet, { landed: true, originId: lpl.id, destId: lpl.id, atd: 0, ata: nowS - 3600, destConf: 'confirmed' });
    L.boardNoteFlight(0x3b000002, jet, { landed: true, originId: lpl.id, destId: lpl.id, atd: nowS - 3700, ata: nowS - 3500, destConf: 'confirmed' });
    L.boardNoteFlight(0x3b000003, { hex: '4ca7b2', reg: 'G-DEMJ', type: 'B738', cs: 'GDEMJ' }, { landed: true, originId: lpl.id, destId: lpl.id, atd: nowS - 7200, ata: nowS - 3600, destConf: 'confirmed' });
    L.boardNoteFlight(0x3b000005, { hex: '4ca7b3', reg: 'EI-DEM', type: 'B738', cs: 'RYR9XX' }, { landed: true, originId: lpl.id, destId: lpl.id, atd: nowS - 7200, ata: nowS - 3600, destConf: 'confirmed' });
    if (arrival) L.boardNoteFlight(0x3b000004, { hex: '400f01', reg: 'G-DEMO', type: 'C172', cs: 'GDEMO' }, arrival);
    const r = await rowsOf(), fids = r.arr.map(x => x.fid);
    check('a same-field "landing" with no take-off seen: not on the board', !fids.includes((0x3b000001).toString(16)), fids);
    check('... nor one up for under a quarter of an hour (a jet)', !fids.includes((0x3b000002).toString(16)));
    check('a jet back where it left after an hour (a real return): on the arrivals', fids.includes((0x3b000003).toString(16)));
    check('... but never an airline\'s jet flying its number (FR24 shows that flight itself; ours was a climb-out)', !fids.includes((0x3b000005).toString(16)));
    check('the VFR arrival from Blackpool: on the arrivals, from Blackpool', r.arr.some(x => x.fid === (0x3b000004).toString(16) && x.ap === blk.id), r.arr.map(x => [x.fid, x.ap])); }

  // ---- rows an older build kept
  { const b = { arr: {}, dep: {}, dirty: false }, t = nowS - 7200;
    b.arr.fbad = { k: 'fbad', src: 'live', fid: 'bad', cs: 'EXS863R', ty: 'B738', t, ap: lpl.id, st: 'landed' };
    b.arr.flocal = { k: 'flocal', src: 'live', fid: 'local', cs: 'GDEMT', ty: 'PA38', t, ap: lpl.id, st: 'landed' }; b.dep.flocal = { k: 'flocal', src: 'live', fid: 'local', cs: 'GDEMT', ty: 'PA38', t: t - 2400, ap: lpl.id, st: 'departed' };
    b.arr.fquick = { k: 'fquick', src: 'live', fid: 'quick', cs: 'EZY23QM', ty: 'A320', t, ap: lpl.id }; b.dep.fquick = { k: 'fquick', src: 'live', fid: 'quick', cs: 'EZY23QM', ty: 'A320', t: t - 120, ap: lpl.id };
    b.arr.fown = { k: 'fown', src: 'fr24', fid: 'own', cs: 'RYR8SF', ty: 'B738', t, ap: lpl.id };
    b.arr.fother = { k: 'fother', src: 'live', fid: 'other', cs: 'GDEMO', ty: 'C172', t, ap: blk.id };
    b.arr.hlog = { k: 'hlog', src: 'log', cs: 'GDEMU', ty: 'C152', t, ap: lpl.id };
    const n = L.boardScrub(lpl.id, b);
    check('kept rows of "flights" that never flew: gone (no take-off seen; a jet up two minutes)', !b.arr.fbad && !b.arr.fquick && !b.dep.fquick && n >= 2, n);
    check('... a real local flight, FR24\'s own rows, an arrival from elsewhere and a rebuilt log\'s row: kept', !!b.arr.flocal && !!b.dep.flocal && !!b.arr.fown && !!b.arr.fother && !!b.arr.hlog); }

  // ---- easyJets "landed at Biggin Hill" climbing out of Gatwick, Ryanairs "Manchester -> Liverpool" and "Manchester ->
  // Manchester" climbing out of Manchester: rows an older build (or the monitor) kept of climb-outs given a landing
  { const bqh = E.byIcao('EGKB'), lgw = E.byIcao('EGKK'), man = E.byIcao('EGCC'), t = nowS - 3 * 3600, off = t + 60, kk = h => 'h' + h + ':' + Math.round(off / 600);
    const ezy = (h, o) => Object.assign({ k: kk(h), src: 'log', hex: h, cs: 'EZY52LD', ty: 'A320', reg: 'G-EZWZ', t: off + 900, st: 'landed' }, o);
    L.store.mergeHex('400aa9', { hex: '400aa9', ladd: true, type: 'C56X' });
    const b = { arr: {}, dep: {}, dirty: false };
    b.arr.a = ezy('4ca9e1', { ap: lgw.id });
    b.arr.b = ezy('4ca9e3', { ap: lgw.id, gc: 1, og: 1 });
    b.arr.c = ezy('4ca9e4', { ap: man.id, t: off + 3 * 3600, og: 1, gc: 1 });
    b.arr.d = ezy('4ca9e5', { ap: 0 }); b.dep.d = ezy('4ca9e5', { ap: 0, st: 'departed', t: off });
    b.arr.e = { k: kk('400aa9'), src: 'log', hex: '400aa9', cs: 'NJE45K', ty: 'C56X', t: off + 600, ap: 0 };
    b.arr.f = { k: kk('400aa8'), src: 'log', hex: '400aa8', cs: 'GDEMU', ty: 'C152', t: off + 600, ap: 0 };
    b.arr.g = { k: 'fown2', src: 'fr24', fid: 'own2', cs: 'EZY52LD', ty: 'A320', t: off + 900, ap: lgw.id };
    const n = L.boardScrub(bqh.id, b);
    check('an airline\'s jet "landed" at Biggin Hill 15 minutes after leaving Gatwick, not seen on the ground: gone', !b.arr.a, n);
    check('... and an airline\'s jet with an unknown end on either board (FR24 shows that flight itself): gone', !b.arr.d && !b.dep.d);
    check('... seen off the ground at Gatwick and down on it there, from a far field it was seen leaving, a business jet, a light aircraft, FR24\'s own: kept', !!b.arr.b && !!b.arr.c && !!b.arr.e && !!b.arr.f && !!b.arr.g, Object.keys(b.arr));
    const lpl2 = E.byIcao('EGGP'), bm = { arr: {}, dep: {} }; bm.arr.r = ezy('4d22aa', { cs: 'RYR97MQ', ty: 'B738', ap: man.id, t: off + 400 });
    bm.arr.s = Object.assign(ezy('4d22ab', { cs: 'RYR4KP', ty: 'B738', ap: man.id }), { k: 'f3c0001', src: 'live', gc: 1 });
    L.boardScrub(lpl2.id, bm);
    check('a Ryanair "Manchester -> Liverpool" seven minutes after the take-off, on Liverpool\'s arrivals: gone', !bm.arr.r);
    check('... one followed live and seen down on the ground at Liverpool: kept', !!bm.arr.s);
    // (Manchester's departures: RYR97MQ and QTR52N "to Manchester", a Ryanair "to Liverpool" - rebuilt or followed live)
    const md = { arr: {}, dep: {} }, dp = (h, o) => Object.assign(ezy(h, { st: 'departed', t: off }), o);
    md.dep.a = dp('4d22ac', { cs: 'RYR97MQ', ty: 'B738', ap: man.id });
    md.dep.b = dp('06a1f2', { cs: 'QTR52N', ty: 'B789', ap: man.id, k: 'f3c0002', src: 'live' });
    md.dep.c = dp('4d22ad', { cs: 'RYR60SF', ty: 'B738', ap: lpl2.id, k: 'f3c0003', src: 'live' });
    md.dep.d = dp('4d22ae', { cs: 'RYR1FW', ty: 'B738', ap: lpl2.id });
    md.dep.e = dp('4d22af', { cs: 'RYR3TV', ty: 'B738', ap: E.byIcao('LEPA').id, gc: 1, og: 1 });
    md.dep.h = dp('4d22b1', { cs: 'RYR3TW', ty: 'B738', ap: E.byIcao('LEPA').id });
    md.dep.f = dp('400aa9', { cs: 'NJE45K', ty: 'C56X', ap: man.id });
    md.dep.g = dp('4d22b0', { cs: 'RYR9AA', ty: 'B738', ap: 0, k: 'f3c0004', src: 'live' });
    L.boardScrub(man.id, md);
    check('Manchester\'s departures: airline jets "to Manchester" and "to Liverpool" (rebuilt or followed live): gone', !md.dep.a && !md.dep.b && !md.dep.c && !md.dep.d, Object.keys(md.dep));
    check('... one seen leaving Manchester and landing at Palma, a blocked business jet: kept', !!md.dep.e && !!md.dep.f, Object.keys(md.dep));
    check('... one followed live with no destination yet (FR24\'s own row of it says as much): gone', !md.dep.g);
    check('... one "to Palma" whose landing nobody saw (a guess; FR24 shows that flight itself): gone', !md.dep.h);
    // (Luton's arrivals, 13 Oct: easyJets and Wizz jets "from Stansted" and a Ryanair "from Liverpool", seen landing at
    // Luton - their take-off never seen: first heard low near Stansted, in the hold the two airports share)
    const ltn = E.byIcao('EGGW'), stn = E.byIcao('EGSS'), la = { arr: {}, dep: {} }, ar = (h, o) => ezy(h, Object.assign({ gc: 1 }, o));
    la.arr.a = ar('4ca9f1', { cs: 'EZY84FD', ty: 'A20N', ap: stn.id });
    la.arr.b = ar('4ca9f2', { cs: 'WUK494', ty: 'A21N', ap: stn.id });
    la.arr.c = ar('4ca9f3', { cs: 'RYR42TA', ty: 'B738', ap: lpl2.id });
    la.arr.d = ar('4ca9f4', { cs: 'EZY29WP', ty: 'A319', ap: stn.id, og: 1 });
    la.arr.e = ar('4ca9f5', { cs: 'RYR9DJ', ty: 'B738', ap: E.byIcao('EIDW').id, src: 'live', k: 'f3c0005' });
    L.boardScrub(ltn.id, la);
    check('Luton\'s arrivals: airline jets "from Stansted" and "from Liverpool", their take-off never seen: gone', !la.arr.a && !la.arr.b && !la.arr.c, Object.keys(la.arr));
    check('... one seen taking off at Stansted, one followed live from FR24\'s own origin: kept', !!la.arr.d && !!la.arr.e, Object.keys(la.arr));
    // (and as the monitor's legs make them: first heard at 3,000 ft by Stansted, down on the ground at Luton - and one
    // seen rolling at Stansted)
    await L.boardLoad(ltn.id);
    const leg = (h, cs, sog) => L.boardNoteLegs(h, [{ hex: h, endRules: 2, cs, tStart: off, tOff: off, tEnd: off + 900, tOn: off + 900, startedOnGround: sog, ended: true, how: 'ground', from: { id: stn.id, code: 'STN', conf: sog ? 'ground' : 'near' }, to: { id: ltn.id, code: 'LTN', conf: 'ground' }, maxAlt: sog ? 6000 : 3000, startAlt: sog ? 0 : 3000, startLat: stn.lat + 0.05, startLon: stn.lon, endLat: ltn.lat, endLon: ltn.lon }], { reg: 'G-UZHA', type: 'A20N' });
    leg('4ca9f6', 'EZY16EG', false); leg('4ca9f7', 'EZY77AB', true);
    await L.boardDrain();
    const lm = L.boardMem.get(ltn.id).arr, rk = h => 'h' + h + ':' + Math.round(off / 600);
    check('... rebuilt from a leg first heard in the air near Stansted: not on Luton\'s arrivals', !lm[rk('4ca9f6')] || lm[rk('4ca9f6')].drop, lm[rk('4ca9f6')]);
    check('... one seen taking off at Stansted: on them, from Stansted', !!lm[rk('4ca9f7')] && lm[rk('4ca9f7')].ap === stn.id && lm[rk('4ca9f7')].oc === 'ground', lm[rk('4ca9f7')]);
    // (Biggin Hill's departures, 13 Oct: easyJets, a China Southern 787, a Norwegian, an Iberia Express and BA
    // Cityflyers "departed Biggin Hill -> Gatwick" - Gatwick's arrivals, first heard at 3,500 ft over Biggin Hill on the
    // way in, landing at Gatwick. And the other way: Gatwick departures last heard climbing over it)
    await L.boardLoad(lgw.id);
    const bleg = (h, cs, ty, o) => L.boardNoteLegs(h, [Object.assign({ hex: h, endRules: 2, cs, tStart: off, tOff: off, tEnd: off + 900, tOn: off + 900, startedOnGround: false, ended: true, how: 'ground', from: { id: bqh.id, code: 'BQH', conf: 'near' }, to: { id: lgw.id, code: 'LGW', conf: 'ground' }, maxAlt: 3500, startAlt: 3500, startLat: bqh.lat + 0.02, startLon: bqh.lon, endLat: lgw.lat, endLon: lgw.lon }, o)], { reg: '', type: ty });
    bleg('4ca9e8', 'EZY83ZL', 'A319'); bleg('780a11', 'CSN654', 'B789'); bleg('4ca9e9', 'IBS1861', 'A320', { from: { id: bqh.id, code: 'BQH', conf: 'low' }, startAlt: 1700 });
    bleg('4ca9ea', 'EZY92EP', 'A319', { startedOnGround: true, from: { id: lgw.id, code: 'LGW', conf: 'ground' }, to: { id: bqh.id, code: 'BQH', conf: 'near' }, how: 'gap', startLat: lgw.lat, startLon: lgw.lon, endLat: bqh.lat, endLon: bqh.lon, endAlt: 4000 });
    // (a NetJets jet really leaving Biggin Hill - heard at 900 ft beside it - for Nice; one "from Biggin Hill" only by a
    // landing guessed in a hole; and a Wizz departure with no type and no destination)
    const nce = E.byIcao('LFMN');
    bleg('4ca9eb', 'NJE061Y', 'C68A', { from: { id: bqh.id, code: 'BQH', conf: 'low' }, startAlt: 900, startLat: bqh.lat + 0.01, to: { id: nce.id, code: 'NCE', conf: 'ground' }, endLat: nce.lat, endLon: nce.lon, maxAlt: 41000 });
    bleg('4ca9ec', 'NJE062Y', 'C68A', { from: { id: bqh.id, code: 'BQH', conf: 'low' }, startAlt: 9000, startLat: bqh.lat + 0.6, to: { id: nce.id, code: 'NCE', conf: 'ground' }, endLat: nce.lat, endLon: nce.lon, maxAlt: 41000 });
    bleg('4ca9ed', 'WZZ620U', '', { startedOnGround: true, from: { id: bqh.id, code: 'BQH', conf: 'ground' }, to: null, ended: false, how: 'gap' });
    await L.boardDrain();
    const bd = L.boardMem.get(bqh.id).dep, gone = h => !bd[rk(h)] || bd[rk(h)].drop, ba2 = L.boardMem.get(bqh.id).arr, la2 = L.boardMem.get(lgw.id);
    check('Biggin Hill\'s departures: Gatwick\'s arrivals first heard over it (easyJet, China Southern 787, Iberia Express): gone', gone('4ca9e8') && gone('780a11') && gone('4ca9e9'), Object.keys(bd));
    check('... their rows on Gatwick\'s arrivals "from Biggin Hill": gone too', ['4ca9e8', '780a11', '4ca9e9'].every(h => !la2.arr[rk(h)] || la2.arr[rk(h)].drop));
    check('... a Gatwick departure last heard climbing over it: not landed at Biggin Hill, nor "to Biggin Hill" on Gatwick\'s', (!ba2[rk('4ca9ea')] || ba2[rk('4ca9ea')].drop) && (!la2.dep[rk('4ca9ea')] || la2.dep[rk('4ca9ea')].drop || la2.dep[rk('4ca9ea')].ap !== bqh.id));
    check('... a NetJets jet heard leaving it at 900 ft for Nice: kept', !gone('4ca9eb') && bd[rk('4ca9eb')].ap === nce.id, bd[rk('4ca9eb')]);
    check('... one "from Biggin Hill" by a landing guessed in a hole, a Wizz departure with no destination: gone', gone('4ca9ec') && gone('4ca9ed'));
    // (Luton's departures, 13 Oct: callsign-only rows "-> N/A" beside FR24's own - NetJets, VistaJet, Wizz, Wizz Malta, a
    // registration-only Global - and business jets "to Stansted", "to Biggin Hill" from a leg first heard over Luton)
    const lleg = (h, cs, ty, o) => L.boardNoteLegs(h, [Object.assign({ hex: h, endRules: 2, cs, tStart: off, tOff: off, tEnd: off + 2400, tOn: off + 2400, startedOnGround: true, ended: false, how: 'gap', from: { id: ltn.id, code: 'LTN', conf: 'ground' }, to: null, maxAlt: 35000, startAlt: 0, startLat: ltn.lat, startLon: ltn.lon, endLat: 49, endLon: 1, endAlt: 35000 }, o)], { reg: '', type: ty });
    lleg('4ca9c1', 'NJE369M', 'CL60'); lleg('4ca9c2', 'VJT449', 'CL35'); lleg('4ca9c3', 'WZZ620U', ''); lleg('4ca9c4', 'WMT6767', 'H25B'); lleg('4ca9c5', 'N142QS', 'GLEX'); lleg('4ca9c6', 'UAG37A', 'E35L');
    lleg('4ca9c7', 'IFA6673', 'GLEX', { startedOnGround: false, from: { id: ltn.id, code: 'LTN', conf: 'near' }, startAlt: 4000, startLat: ltn.lat + 0.05, to: { id: bqh.id, code: 'BQH', conf: 'ground' }, ended: true, how: 'ground', endLat: bqh.lat, endLon: bqh.lon });
    // (and the real ones: a NetJets Phenom seen rolling at Luton and landing at Stansted, a Global seen on the ground at
    // Luton and heard at 1,200 ft beside Le Bourget, an easyJet seen on the ground at both ends, a light aircraft
    // with no destination)
    const lbg = E.byIcao('LFPB'), edi = E.byIcao('EGPH');
    lleg('4ca9c8', 'NJU957Y', 'E55P', { to: { id: stn.id, code: 'STN', conf: 'ground' }, ended: true, how: 'ground', endLat: stn.lat, endLon: stn.lon, endAlt: 0 });
    lleg('4ca9c9', 'N988GG', 'GLEX', { to: { id: lbg.id, code: 'LBG', conf: 'low' }, ended: true, how: 'gap-low', endLat: lbg.lat + 0.03, endLon: lbg.lon, endAlt: 1200 });
    lleg('4ca9ca', 'EZY926P', 'A320', { to: { id: edi.id, code: 'EDI', conf: 'ground' }, ended: true, how: 'ground', endLat: edi.lat, endLon: edi.lon, endAlt: 0 });
    lleg('4ca9cb', 'GBOIL', 'C152');
    await L.boardDrain();
    const ld2 = L.boardMem.get(ltn.id).dep, lg = h => !ld2[rk(h)] || ld2[rk(h)].drop;
    check('Luton\'s departures: NetJets, VistaJet, Wizz, Wizz Malta, a registration-only Global and an Embraer "-> N/A": gone', ['4ca9c1', '4ca9c2', '4ca9c3', '4ca9c4', '4ca9c5', '4ca9c6'].every(lg), Object.keys(ld2));
    check('... a Global "from Luton to Biggin Hill", first heard at 4,000 ft over Luton: gone', lg('4ca9c7'));
    check('... a NetJets jet to Stansted, a Global to Le Bourget, an easyJet to Edinburgh (both ends seen), a Cessna "-> N/A": kept', !lg('4ca9c8') && !lg('4ca9c9') && !lg('4ca9ca') && !lg('4ca9cb'), Object.keys(ld2));
    // (and a business jet's climb-out out of Gatwick, kept by the monitor before - no end height - as landed at Biggin Hill;
    // the strips and towns list in, so a landing place would be named if one were made up)
    await L.boardLoad(bqh.id); await L.boardLoad(lgw.id);
    check('the list of strips and towns in (landing places can be learned)', await L.loadSites() && L.learnSite(51.2, -0.05, {}) > 9e6);
    const hx = '400aab', k = kk(hx);
    L.boardMem.get(bqh.id).arr[k] = { k, src: 'log', hex: hx, cs: 'GXJET', ty: 'C56X', reg: 'G-XJET', t: off + 230, ap: lgw.id, st: 'landed' };
    L.boardNoteLegs(hx, [{ hex: hx, tStart: t, tOff: off, tEnd: off + 230, tOn: off + 230, startedOnGround: true, ended: true, from: { id: lgw.id, code: 'LGW', conf: 'ground' }, to: { id: bqh.id, code: 'BQH', conf: 'near' }, maxAlt: 6300, startLat: lgw.lat, startLon: lgw.lon, endLat: bqh.lat - 0.15, endLon: bqh.lon - 0.05 }], { reg: 'G-XJET', type: 'C56X' });
    // (and one the rules now make: lost climbing, no landing - nor a "private site" where it was lost)
    const hy = '400aac', ky = 'h' + hy + ':' + Math.round(off / 600);
    L.boardNoteLegs(hy, [{ hex: hy, endRules: 2, tStart: t, tOff: off, tEnd: off + 230, startedOnGround: true, ended: true, how: 'gap-low', from: { id: lgw.id, code: 'LGW', conf: 'ground' }, to: null, maxAlt: 6300, endAlt: 6300, startLat: lgw.lat, startLon: lgw.lon, endLat: bqh.lat - 0.15, endLon: bqh.lon - 0.05 }], { reg: 'G-YJET', type: 'C56X' });
    await L.boardDrain();
    const ba = L.boardMem.get(bqh.id).arr, ld = L.boardMem.get(lgw.id).dep;
    check('... its row on Biggin Hill\'s arrivals: gone', !ba[k] || ba[k].drop, ba[k]);
    check('... on Gatwick\'s departures, no destination made up for either (and with none, no row beside FR24\'s own)', [k, ky].every(x => !ld[x] || ld[x].drop || !ld[x].ap), [ld[k], ld[ky]]);
  }

  // ---- Liverpool's board, 13-14 Oct: U281 "Scheduled 14:40, A320" beside EZY89VK (the A319 G-EZBX) landed from Belfast
  // at 14:42; G-NBCA, a PC-12 flying as GNBCA, with easyJet's logo; G-RDGE, a glider out of Chester, "departed Liverpool"
  // as a business jet
  { const bfs = E.byIcao('EGAA'), qga = E.byIcao('EGAD'), t0 = nowS - 40 * 3600, ezy = 9999001;
    L.fr24.byIcao.set('EZY', ezy); if (L.fr24.airlines) L.fr24.airlines.set(ezy, { id: ezy, name: 'easyJet', icao: 'EZY', iata: 'U2' });
    L.store.mergeHex('4ca9d1', { hex: '4ca9d1', reg: 'G-EZBX', type: 'A319' });
    L.store.mergeHex('4ca9d2', { hex: '4ca9d2', reg: 'G-NBCA', type: 'PC12', owner: 'Narm Aviation Ltd', cs: 'EZY12AB' });
    L.store.mergeHex('4083e2', { hex: '4083e2', reg: 'G-RDGE', type: '', desc: 'DG Flugzeugbau DG-1000S', ladd: true });
    const arr = {
      u281: { k: 'f3c1001', src: 'sched', fid: '3c1001', num: 'U281', cs: '', alId: ezy, ap: bfs.id, t: t0, sch: t0, est: t0, st: 'scheduled', col: 'gray',
        nat: { id: 77001, flight: { id: '3c1001', number: 'U281', callsign: null }, status: { name: 'scheduled', color: 'gray', isAmbiguous: false, live: false }, scheduledTime: t0, estimatedTime: t0, airportId: bfs.id, airlineId: ezy, airline: 'easyJet', aircraftType: 'A320' } },
      vk: { k: 'h4ca9d1:1', src: 'log', hex: '4ca9d1', reg: 'G-EZBX', cs: 'EZY89VK', ty: 'A319', ap: bfs.id, t: t0 + 120, sch: t0 + 120, est: t0 + 120, st: 'landed', col: 'green', gc: 1, oc: 'ground', dc: 'ground' },
      nb: { k: 'h4ca9d2:1', src: 'log', hex: '4ca9d2', reg: 'G-NBCA', cs: 'GNBCA', ty: 'PC12', ap: qga.id, t: t0 - 6 * 3600, st: 'landed', gc: 1, oc: 'low', dc: 'ground' } };
    const list = L.boardList(arr, new Map([['U2', ezy]]));
    const u = list.find(r => r.num === 'U281'), n = list.find(r => r.cs === 'GNBCA');
    check('U281 and EZY89VK: one row, FR24\'s own', list.filter(r => r.num === 'U281' || r.cs === 'EZY89VK').length === 1 && !!u, list.map(r => r.num || r.cs));
    check('... landed at 14:42, flown by an A319 (not "Scheduled", not the A320 planned), callsign EZY89VK', u && u.nat.status.name === 'landed' && u.nat.estimatedTime === t0 + 120 && u.nat.aircraftType === 'A319' && u.nat.flight.callsign === 'EZY89VK' && u.reg === 'G-EZBX', u && u.nat);
    check('G-NBCA as GNBCA: not easyJet\'s logo (its record\'s last callsign was an easyJet\'s)', n && n.alId !== ezy, n && [n.alId, n.al]);
    const dep = { g1: { k: 'h4083e2:1', src: 'log', hex: '4083e2', reg: 'G-RDGE', cs: 'GRDGE', ty: '', dsc: 'DG Flugzeugbau DG-1000S', ap: 0, t: t0, st: 'departed', oc: 'near', dc: '' },
      g2: { k: 'h4083e2:2', src: 'log', hex: '4083e2', reg: 'G-RDGE', cs: 'GRDGE', ty: '', dsc: 'DG Flugzeugbau DG-1000S', ap: 0, t: t0 + 7200, st: 'departed', oc: 'low', dc: '' } };
    L.boardScrub(lpl.id, { arr: {}, dep });
    check('G-RDGE "departed Liverpool", first heard away from it: gone; one heard low beside it: kept', !dep.g1 && !!dep.g2, Object.keys(dep));
    const g = L.boardList(dep, new Map())[0];
    check('... a glider: type GLID, FR24\'s glider category (7), not "Business jet"', g && g.ty === 'GLID' && g.fc === 7, g && [g.ty, g.fc]);
  }

  // ---- the engine's rule
  { const lf = (o, cls) => E.localFlew(Object.assign({ from: { id: lpl.id }, to: { id: lpl.id } }, o), cls);
    check('localFlew: another field - always a flight', E.localFlew({ from: { id: lpl.id }, to: { id: blk.id }, tOff: 0, tOn: 10 }, 'airliner'));
    check('... a jet two minutes up, a jet without height, a jet that went nowhere: no', !lf({ tOff: 0, tOn: 120 }, 'airliner') && !lf({ tOff: 0, tOn: 3600, maxAlt: 500 }, 'airliner') && !lf({ tOff: 0, tOn: 3600, maxAlt: 9000, pathKm: 6 }, 'airliner'));
    check('... a jet an hour up, high and far: yes', lf({ tOff: 0, tOn: 3600, maxAlt: 9000, pathKm: 300 }, 'airliner'));
    check('... a light aircraft\'s 10-minute circuits at 1,000 ft: yes; a hover check: no', lf({ tOff: 0, tOn: 600, maxAlt: 1100, pathKm: 12 }, 'piston') && !lf({ tOff: 0, tOn: 120, maxAlt: 150, pathKm: 0.5 }, 'heli')); }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  harness error ' + (e && e.stack || e)); process.exit(1); });
