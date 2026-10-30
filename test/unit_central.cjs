// (1.0.1) Central calculation (monitor/central.cjs): the userscript's own route code run on the monitor, one answer for
// every browser.
//   - every name the route code uses from outside its marked blocks is one the monitor gives it (found by ESLint's
//     no-undef over the blocks as they are now - a name added to the route code later and not given here fails this)
//   - started: the tables as the userscript has them; not started with too little memory, or turned off - said why
//   - what browsers send: a whole track, then what is new; a part sent without the whole asked for whole; a new leg
//     after the one held; nothing kept that is not a flight's; a point's fields only
//   - what the browser sends is all the route code reads: the monitor's answer from it is the one the same code gives with
//     everything the browser has (N1868M over the Atlantic, the userscript built, in jsdom); the userscript carries no
//     tables (1.1.0)
//   - end to end: the browser sends the flight, the monitor works it out, the browser shows the monitor's answer - none
//     before it; a second browser that sent nothing gets the very same; the user's own confirmation stands; the monitor
//     off: its last answer ten minutes at most, then none
//   - within the minute's allowance: the last answer past it; a flight the monitor named itself worked out from its own
//     track
// usage: node test/unit_central.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA;
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'moncentral-'));
const M = require('../monitor/monitor.cjs'), C = require('../monitor/central.cjs');
M.loadEngine();
const E = M.E, ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src'), MAIN = path.join(SRC, 'main');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 600) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 50; i++) { const v = await f(); if (v) return v; await sleep(50); } return f(); };

// ---- N1868M (G650ER), 19 Oct: Teterboro, east over the Atlantic - moved so that it is over the ocean now ---------------
const J = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/a15a72/2026-10-19_lol.json.gz'))).toString());
const CUT = J.timestamp + 22.5 * 3600, SHIFT = Math.floor(Date.now() / 1000) - CUT;
const NOWJ = Object.assign({}, J, { timestamp: J.timestamp + SHIFT, trace: J.trace.filter(p => J.timestamp + p[0] <= CUT) });
const HEX = 'a15a72';

(async () => {
  // ---- the names the route code uses from outside ------------------------------------------------------------------
  { const { Linter } = require(path.join(NM, 'eslint')), lint = new Linter(), free = new Set();
    for (const [f, m] of C.BLOCKS) for (const msg of lint.verify(C.blockOf(MAIN, f, m), { parserOptions: { ecmaVersion: 2022 }, env: { es2020: true }, rules: { 'no-undef': 2 } })) { const x = /'([^']+)' is not defined/.exec(msg.message); if (x) free.add(x[1]); }
    // (and the blocks' own names, used by each other: found by the context itself)
    const c0 = C.createCentral({ E }); await c0.start({ srcDir: SRC, mainDir: MAIN });
    const box = c0.ctx, missing = [...free].filter(n => { try { return require('vm').runInContext('typeof ' + n, box) === 'undefined'; } catch (e) { return true; } });
    check(`every name the route code uses from outside its blocks given on the monitor (${free.size} of them)`, free.size >= 40 && !missing.length, { missing, n: free.size }); }

  // ---- started, or not ---------------------------------------------------------------------------------------------------
  { const off = C.createCentral({ E }), s1 = await off.start({ off: true });
    const low = C.createCentral({ E }), s2 = await low.start({ free: 120 * 1048576, needMb: 300, srcDir: SRC, mainDir: MAIN });
    check('turned off, or too little memory at start: not on, and said why', !s1.on && /turned off/.test(s1.why) && !s2.on && /120 MB free at start, 300 MB wanted/.test(s2.why), { s1: s1.why, s2: s2.why });
    const low2 = C.createCentral({ E }), s3 = await low2.start({ free: 900 * 1048576, freeNow: () => 100 * 1048576, srcDir: SRC, mainDir: MAIN, sitesCsv: path.join(DATA, 'oa_airports.csv') });
    check('... room for the tables, not for the landing sites after them: on, the sites left out and said so', s3.on && !s3.sites && /landing sites not loaded/.test(s3.sitesWhy || ''), { on: s3.on, sites: s3.sites, why: s3.sitesWhy });
    const r = M.answer(new URL('http://x/status'), Date.now() / 1000);
    check('/status: central calculation\'s state', r.central && typeof r.central.on === 'boolean' && 'why' in r.central, r.central); }
  const cen = C.createCentral({ E, now: () => Date.now(), logOf: () => [] });
  let last = Date.now(), stall = 0; const tick = setInterval(() => { stall = Math.max(stall, Date.now() - last); last = Date.now(); }, 5);
  const st = await cen.start({ free: 4e9, srcDir: SRC, mainDir: MAIN, sitesCsv: path.join(DATA, 'oa_airports.csv') });
  clearInterval(tick);
  check(`... loaded a slice at a time: the server answers meanwhile (longest wait ${stall} ms, the population tables' parse)`, stall < 1500, stall);
  check('started: the userscript\'s tables, the population tables, the arrival paths, the landing sites', st.on && st.sites > 50000 && !!E.T2 && !!cen.ctx, { on: st.on, mb: st.mb, sites: st.sites, why: st.why });
  // (1.1.0: the tables are the monitor's alone - the built userscript carries none of them)
  { const b = fs.readFileSync(path.join(ROOT, 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8'), names = ['ROUTE_TABLES', 'ROUTE_LOGIT', 'ROUTE_T2_GZ', 'APPR_TABLE_GZ'].filter(n => b.includes('const ' + n));
    check('the built userscript carries no route tables (every route is the monitor\'s): ' + Math.round(b.length / 1e5) / 10 + ' MB', !names.length && b.length < 4e6, { names, mb: b.length / 1e6 }); }

  // ---- what browsers send ----------------------------------------------------------------------------------------------
  const pts = E.parseTrace(NOWJ), leg = E.legsFromPoints(pts, { cls: 'bizjet', type: 'GLF6' }).pop(), tr = []; for (const p of [leg.start].concat(leg.pts)) if (!tr.length || p.t - tr[tr.length - 1].t >= 15) tr.push(p);
  const out = p => JSON.parse(JSON.stringify(p, (k, v) => typeof v === 'number' && !isFinite(v) ? undefined : v));
  const ev = (o) => Object.assign({ id: 9001, hex: HEX, kind: 'live', ac: { reg: 'N1868M', type: 'GLF6', ladd: true, country: 'United States' }, pos: out(tr[tr.length - 1]) }, o);
  { const half = tr.slice(0, Math.floor(tr.length / 2));
    cen.take(ev({ trail: { full: true, pts: out(half) }, pos: out(half[half.length - 1]) }));
    const F = cen.flights.get(9001), n1 = F.trail.length;
    const need = cen.take(ev({ trail: { full: false, pts: out(tr.slice(Math.floor(tr.length / 2))) } }));
    check('a whole track, then what is new: the track held is the whole flight so far', n1 === half.length && F.trail.length === tr.length && need === '' && F.trail[0].t === tr[0].t, { n1, n: F.trail.length, of: tr.length });
    const need2 = cen.take(ev({ id: 9002, trail: { full: false, pts: out(tr.slice(-5)) } }));
    check('... the new part of a track not held here: the whole asked for', need2 === 'full');
    // (another browser with less of it - FR24's trail from mid-ocean only: the whole kept)
    cen.take(ev({ trail: { full: true, pts: out(tr.slice(-30)) } }));
    check('... another browser\'s whole track that starts later on the same flight: the longer one kept, its new points added', F.trail[0].t === tr[0].t && F.trail.length === tr.length, F.trail.length);
    // (a new leg: after a landing, a track that starts after the one held ended)
    const later = tr.slice(-3).map(p => Object.assign({}, p, { t: p.t + 4 * 3600 }));
    cen.take(ev({ trail: { full: true, cut: true, pts: out(later) }, pos: out(later[later.length - 1]) }));
    check('... a new leg - a track begun after the one held ended: it replaces it', F.trail.length === 3 && F.meta.cut === true);
    cen.take(ev({ trail: { full: true, pts: out(tr) }, pos: out(tr[tr.length - 1]) }));
    // (only what is a flight's: no address, a broken one, fields not the engine's)
    const before = cen.flights.size;
    cen.take({ id: 'x', hex: 'zz' }); cen.take({ id: 5, hex: '123' }); cen.take(ev({ id: 9003, pos: { t: 1, lat: 999, lon: 0 }, trail: { full: true, pts: [{ t: 1, lat: 50, lon: 1, evil: 'x', alt: 'high', gs: 300 }] } }));
    const F3 = cen.flights.get(9003);
    check('... nothing kept that is not a flight\'s; a point\'s own fields only, of the engine\'s types', cen.flights.size === before + 1 && !F3.pos && F3.trail.length === 1 && !('evil' in F3.trail[0]) && !('alt' in F3.trail[0]) && F3.trail[0].gs === 300, { size: cen.flights.size, before, p: F3.trail[0] });
    cen.flights.delete(9003); cen.flights.delete(9002); }

  // ---- what is held: within bounds ---------------------------------------------------------------------------------------
  { const mon = C.createCentral({ E, cfg: { allPts: 5000 } }); await mon.start({ free: 4e9, srcDir: SRC, mainDir: MAIN });
    const long = []; for (let i = 0; i < 4000; i++) long.push({ t: 1e9 + i * 15, lat: 50 + i * 0.001, lon: 1, alt: 30000, gs: 450, trk: 0 });
    mon.take(ev({ id: 9501, trail: { full: true, pts: long }, pos: long[3999] }));
    const T = mon.flights.get(9501).trail;
    check('a track over 3,000 points: its first kept, its last 1,500 as they are, the ones between thinned', T.length <= 3000 && T[0].t === long[0].t && T[T.length - 1].t === long[3999].t && T[T.length - 1500].t === long[2500].t, { n: T.length });
    for (let k = 0; k < 4; k++) { mon.take(ev({ id: 9510 + k, trail: { full: true, pts: long.slice(0, 1500) }, pos: long[1499] })); await sleep(2); }
    let n = 0; for (const F of mon.flights.values()) n += F.trail.length;
    check('... all the tracks held kept within their bound - the flights sent nothing longest let go first', n <= 5000 && mon.flights.has(9513) && !mon.flights.has(9501), { n, ids: [...mon.flights.keys()] });
    mon.take(ev({ id: 9520, wx: { EGLL: { at: Date.now(), raw: 'x'.repeat(10000) }, EGKK: { at: Date.now(), cat: 'VFR' } }, closed: { EGLL: [{ text: 'y'.repeat(9000) }] } }));
    check('... a browser\'s weather or closure too big for what it is: not kept; one of its size kept', !mon.wxMap.has('EGLL') && mon.wxMap.has('EGKK') && !mon.closedMap.has('EGLL')); }

  // ---- the browser's own answer, the monitor's, on the same flight -------------------------------------------------------
  const { JSDOM } = require(path.join(NM, 'jsdom')), FIDB = require(path.join(NM, 'fake-indexeddb'));
  const BUNDLE = fs.readFileSync(path.join(ROOT, 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8'), AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
  const MON = 'https://mon.test', posts = [];
  let monOn = true, monitorCentral = null;
  function makeWin() {
    const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/45.00,-40.00/5', runScripts: 'dangerously', pretendToBeVisual: true }).window;
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
    win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    const answer = (url, o) => {
      if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
      if (url.startsWith(MON + '/status')) return [200, JSON.stringify({ v: 3, since: Date.now() - 3600e3, public: true, ver: '1.0.1', central: { on: monOn } })];
      if (url.startsWith(MON + '/calc')) { const b = JSON.parse(o.data || o.body || '{}'); posts.push(b); return [200, JSON.stringify(monitorCentral.answer(b))]; }
      return [404, ''];
    };
    win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u, {}); return Promise.resolve(new Response(text, { status: st })); };
    win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url, o); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
    win.unsafeWindow = win; win.GM_notification = () => {}; win.console.debug = () => {}; win.console.log = () => {};
    win.eval(BUNDLE);
    return win;
  }
  async function browser() {
    const w = makeWin(), L = w.__tweeksLadd;
    await until(() => L && L.engine.airports.length > 5000, 60000);
    return { w, L };
  }
  function flightIn(L, id) {
    const raw = E.legsFromPoints(pts, { cls: 'bizjet', type: 'GLF6' });
    L.store.mergeHex(HEX, { reg: 'N1868M', type: 'GLF6', ladd: true });
    L.todayCache.set(HEX, { at: Date.now(), pts, lastPt: pts[pts.length - 1], legs: raw, sums: [] });
    L.live.set(id, { id, hex: HEX, reg: 'N1868M', type: 'GLF6', cs: 'N1868M', ladd: true });
  }
  const sig = r => r && { o: r.originIata, oc: r.originConf, d: r.destIata || '', dc: r.destConf, p: r.destP || 0, why: r.destReason, alts: (r.alternatives || []).map(a => a.iata + ':' + a.p).join(','), phase: r.phase, legs: r.legCount };
  const same = (a, b) => !!a && !!b && a.o === b.o && a.oc === b.oc && a.d === b.d && a.dc === b.dc && Math.abs(a.p - b.p) <= 1 && a.phase === b.phase && a.legs === b.legs && a.alts.split(',').map(x => x.split(':')[0]).join() === b.alts.split(',').map(x => x.split(':')[0]).join();
  // (1.1.0: the script has no tables and works nothing out - the route code run here with the tables put into its engine,
  // everything this browser has of the flight: what it sends the monitor is all that code reads)
  { const { L } = await browser(); monitorCentral = cen;
    flightIn(L, 9101);
    check('(the script itself: no route of its own without the monitor - no tables in it)', L.composeRoute(9101, HEX) === null && !L.engine.T2);
    await require('./monfake.cjs').tablesInto(L.engine);   // (a few seconds: the flight put in again after)
    flightIn(L, 9101);
    const local = L.composeRoute0(9101, HEX), e = L.calcEvidence(9101);
    const mon = C.createCentral({ E, logOf: () => [] }); await mon.start({ free: 4e9, srcDir: SRC, mainDir: MAIN });
    mon.take(e.x); const F = mon.flights.get(9101), r = mon.compute(F);
    check('N1868M over the Atlantic: the monitor\'s answer from what the browser sent is the one the same route code gives with everything the browser has (origin, destination and odds, the others, the phase)', !!local && same(sig(local), sig(r)), { browser: sig(local), monitor: sig(r) });
    check('... the browser sent its whole track, the aircraft, where it is', e.x.trail.full && e.x.trail.pts.length === F.trail.length && e.x.trail.pts.length > 100 && e.x.ac.reg === 'N1868M' && e.x.kind === 'live' && Math.abs(e.x.pos.t - pts[pts.length - 1].t) < 60, { n: e.x.trail.pts.length, kept: F.trail.length, pos: e.x.pos && e.x.pos.t }); }

  // ---- end to end: two browsers, one answer --------------------------------------------------------------------------------
  { const mon = C.createCentral({ E, logOf: () => [] }); await mon.start({ free: 4e9, srcDir: SRC, mainDir: MAIN }); monitorCentral = mon; posts.length = 0;
    const A = await browser(), B = await browser();
    for (const X of [A, B]) { X.L.store.kvSet('monRemote', { url: MON, token: 'tok' }); X.L.store.flushNow(); await X.L.monCheck(true).catch(() => {}); }
    flightIn(A.L, 9201);
    const first = A.L.composeRoute(9201, HEX);
    check('(the monitor answering, its central calculation on) - nothing shown before its answer', A.L.monUp() && first === null && /working it out/.test(A.L.calcWhy()), { up: A.L.monUp(), first, why: A.L.calcWhy() });
    await until(() => A.L.calcGot.has(9201), 8000);
    const a = A.L.composeRoute(9201, HEX), sent = posts.find(p => p.flights && p.flights.some(f => f.id === 9201)), m = mon.routeOf(9201);
    check('browser A: the flight sent (its whole track), the monitor\'s answer shown', !!sent && sent.flights.find(f => f.id === 9201).trail.full && !!a && !!a.central && !!m && same(sig(a), sig(m.r)) && a.originIata === 'TEB', { a: sig(a), mon: m && sig(m.r) });
    check('... its progress bar from where the aircraft is now', !!a.progress && a.progress.remaining > 0 && a.progress.eta === a.eta, a.progress);
    // (browser B shows the flight, has nothing of its track: it gets the monitor's answer all the same)
    B.L.live.set(9201, { id: 9201, hex: HEX, reg: 'N1868M', type: 'GLF6', cs: 'N1868M', ladd: true });
    B.L.store.mergeHex(HEX, { reg: 'N1868M', type: 'GLF6', ladd: true });
    B.L.todayCache.set(HEX, { at: Date.now(), pts: pts.slice(-3), lastPt: pts[pts.length - 1], legs: E.legsFromPoints(pts.slice(-3), { cls: 'bizjet', type: 'GLF6' }), sums: [] });
    const bOwn = B.L.composeRoute(9201, HEX);
    await until(() => B.L.calcGot.has(9201), 8000);
    const b = B.L.composeRoute(9201, HEX);
    check('browser B, which has only the last minute of its track: the very same answer as browser A', bOwn === null && !!b && !!b.central && JSON.stringify(sig(b)) === JSON.stringify(sig(a)) && b.originIata === 'TEB', { b: sig(b), a: sig(a) });
    // (sent again: only what is new)
    const n0 = posts.length; A.L.calcSent.get(9201).at = 0; A.L.calcAsk.add(9201); await A.L.calcFlush();
    const again = posts.slice(n0).map(p => (p.flights || []).find(f => f.id === 9201)).find(Boolean);
    check('... sent again: only what is new of its track', !!again && !again.trail.full && again.trail.pts.length < 5, again && { full: again.trail.full, n: again.trail.pts.length });
    // (the user's own confirmation stands; the monitor off: its last answer for ten minutes, then none - and why)
    const bgr = A.L.engine.byIcao('LEBL');
    A.L.userConfirm(9201, A.L.live.get(9201), bgr.id);
    const u = A.L.composeRoute(9201, HEX);
    check('the user\'s own confirmation of a destination: it stands over the monitor\'s answer, the rest of it the monitor\'s', !!u && u.userConfirmed && u.destIata === 'BCN' && u.destP === 100 && u.originIata === 'TEB', u && { user: u.userConfirmed, d: u.destIata, o: u.originIata });
    A.L.userConfirm(9201, A.L.live.get(9201), 0);
    check('... taken back: the monitor\'s own again', A.L.composeRoute(9201, HEX).destIata === a.destIata);
    monOn = false; await B.L.monCheck(true).catch(() => {});
    const o = B.L.centralOf(9201, HEX);
    B.L.calcGot.get(9201).until = Date.now() - 1;
    const o2 = B.L.centralOf(9201, HEX);
    check('the monitor\'s central calculation off: its last answer (ten minutes at most), then none - nothing worked out here - and why', !!o && !!o.central && o2 === null && /isn't working routes out/.test(B.L.calcWhy()), { before: !!o, after: o2, why: B.L.calcWhy() });
    monOn = true; }

  // ---- the minute's allowance; a flight the monitor named itself --------------------------------------------------------
  { const mon = C.createCentral({ E, logOf: () => [], cfg: { msPerMin: 1, every: 0 } }); await mon.start({ free: 4e9, srcDir: SRC, mainDir: MAIN });
    mon.take(ev({ id: 9301, trail: { full: true, pts: out(tr) } })); const r1 = mon.routeOf(9301);
    mon.take(ev({ id: 9301, pos: out(Object.assign({}, tr[tr.length - 1], { t: tr[tr.length - 1].t + 30 })) })); const r2 = mon.routeOf(9301);
    check('past the minute\'s allowance: the last answer given, not worked out again', !!r1 && !!r2 && r2.at === r1.at && mon.stats.overBudget >= 1, { r1: !!r1, r2: !!r2, over: mon.stats.overBudget }); }
  { const self = id => id === 9401 ? ev({ id: 9401, trail: { full: true, pts: out(tr) } }) : null;
    const mon = C.createCentral({ E, logOf: () => [], selfEvidence: self }); await mon.start({ free: 4e9, srcDir: SRC, mainDir: MAIN });
    const a = mon.answer({ ids: [9401, 9402] });
    check('a flight no browser sent, that the monitor named itself: worked out from its own track; one it knows nothing of: nothing', a.routes[9401] && a.routes[9401].r.originIata === 'TEB' && !a.routes[9402], Object.keys(a.routes)); }

  // ---- the table every browser gets as FR24 opens: central's answer for a flight it has -----------------------------------
  { const { createDest } = require('../monitor/dest.cjs');
    const cr = { dest: { id: E.byIcao('LEBL').id, p: 0.8, at: 1, eta: 2, why: 'central' }, origin: { id: E.byIcao('KTEB').id, conf: 'ground', t: 3 }, lostAt: 0 };
    const d = createDest({ E, ac: new Map(), legs: new Map(), fromCentral: id => id === 1 ? cr : null });
    const ident = { ids: new Map([[1, { hex: HEX }], [2, { hex: 'abcdef' }]]), flights: new Map([[1, { lat: 45, lon: -40, alt: 41000, gnd: false, seen: Date.now() }], [2, { lat: 45, lon: -40, alt: 41000, gnd: false, seen: Date.now() }]]) };
    d.round(ident, Date.now());
    check('the table of named flights browsers get as FR24 opens: central\'s answer for a flight it has worked out', ident.ids.get(1).dest === cr.dest && ident.ids.get(1).origin === cr.origin && ident.ids.get(2).dest !== cr.dest, { one: ident.ids.get(1).dest, two: ident.ids.get(2).dest }); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed', e && e.stack || e); process.exit(1); });
