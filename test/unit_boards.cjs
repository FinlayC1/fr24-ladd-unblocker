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
const RWY = JSON.parse(fs.readFileSync(path.join(DATA, 'runways.json'), 'utf8')), RWL = JSON.parse(fs.readFileSync(path.join(DATA, 'runway_len.json'), 'utf8'));

function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53.33,-2.85/10', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  const answer = url => /flightradar24\.com\/mobile\/airports\/format/.test(url) ? [200, AIRPORTS] : [404, ''];
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
    L.boardNoteFlight(0x3b000003, { hex: '4ca7b2', reg: 'EI-DEM', type: 'B738', cs: 'RYR9XX' }, { landed: true, originId: lpl.id, destId: lpl.id, atd: nowS - 7200, ata: nowS - 3600, destConf: 'confirmed' });
    if (arrival) L.boardNoteFlight(0x3b000004, { hex: '400f01', reg: 'G-DEMO', type: 'C172', cs: 'GDEMO' }, arrival);
    const r = await rowsOf(), fids = r.arr.map(x => x.fid);
    check('a same-field "landing" with no take-off seen: not on the board', !fids.includes((0x3b000001).toString(16)), fids);
    check('... nor one up for under a quarter of an hour (a jet)', !fids.includes((0x3b000002).toString(16)));
    check('a jet back where it left after an hour (a real return): on the arrivals', fids.includes((0x3b000003).toString(16)));
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
    check('kept rows of "flights" that never flew: gone (no take-off seen; a jet up two minutes)', !b.arr.fbad && !b.arr.fquick && !b.dep.fquick && n === 2, n);
    check('... a real local flight, FR24\'s own rows, an arrival from elsewhere and a rebuilt log\'s row: kept', !!b.arr.flocal && !!b.dep.flocal && !!b.arr.fown && !!b.arr.fother && !!b.arr.hlog); }

  // ---- the engine's rule
  { const lf = (o, cls) => E.localFlew(Object.assign({ from: { id: lpl.id }, to: { id: lpl.id } }, o), cls);
    check('localFlew: another field - always a flight', E.localFlew({ from: { id: lpl.id }, to: { id: blk.id }, tOff: 0, tOn: 10 }, 'airliner'));
    check('... a jet two minutes up, a jet without height, a jet that went nowhere: no', !lf({ tOff: 0, tOn: 120 }, 'airliner') && !lf({ tOff: 0, tOn: 3600, maxAlt: 500 }, 'airliner') && !lf({ tOff: 0, tOn: 3600, maxAlt: 9000, pathKm: 6 }, 'airliner'));
    check('... a jet an hour up, high and far: yes', lf({ tOff: 0, tOn: 3600, maxAlt: 9000, pathKm: 300 }, 'airliner'));
    check('... a light aircraft\'s 10-minute circuits at 1,000 ft: yes; a hover check: no', lf({ tOff: 0, tOn: 600, maxAlt: 1100, pathKm: 12 }, 'piston') && !lf({ tOff: 0, tOn: 120, maxAlt: 150, pathKm: 0.5 }, 'heli')); }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  harness error ' + (e && e.stack || e)); process.exit(1); });
