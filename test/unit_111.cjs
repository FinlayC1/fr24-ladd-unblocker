// (1.1.1) The panel's numbers:
//   - the odds the confirm list offers are the ones the panel shows: the destination's as shown, the others' as "also
//     possible" has them, the rest sharing what is left - never the engine's own figures (ISL 28% in the panel, 38% in the
//     list) - the destination first (N1868M over the Atlantic, the monitor's route code);
//   - the flight opened in a browser worked out at once on the monitor, whatever its minute's allowance: one not opened
//     waits for the allowance;
//   - a LADD flight with no answer of central calculation yet (the monitor busy): the route of the monitor's table of names
//     in the panel with its progress bar and time of arrival from where the aircraft is now - not "N/A" and no bar (the
//     BUILT userscript in jsdom);
//   - no tooltip on the destination.
// usage: node test/unit_111.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA;
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon111-'));
const M = require('../monitor/monitor.cjs'), C = require('../monitor/central.cjs');
M.loadEngine();
const E = M.E, ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src'), MAIN = path.join(SRC, 'main');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 600) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 50; i++) { const v = await f(); if (v) return v; await sleep(50); } return f(); };
const J = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/a15a72/2026-10-19_lol.json.gz'))).toString());
const CUT = J.timestamp + 22.5 * 3600, SHIFT = Math.floor(Date.now() / 1000) - CUT;
const NOWJ = Object.assign({}, J, { timestamp: J.timestamp + SHIFT, trace: J.trace.filter(p => J.timestamp + p[0] <= CUT) });
const HEX = 'a15a72';

(async () => {
  const pts = E.parseTrace(NOWJ), leg = E.legsFromPoints(pts, { cls: 'bizjet', type: 'GLF6' }).pop(), tr = []; for (const p of [leg.start].concat(leg.pts)) if (!tr.length || p.t - tr[tr.length - 1].t >= 15) tr.push(p);
  const out = p => JSON.parse(JSON.stringify(p, (k, v) => typeof v === 'number' && !isFinite(v) ? undefined : v));
  const ev = o => Object.assign({ id: 9001, hex: HEX, kind: 'live', ac: { reg: 'N1868M', type: 'GLF6', ladd: true, country: 'United States' }, pos: out(tr[tr.length - 1]), trail: { full: true, pts: out(tr) } }, o);

  // ---- the confirm list's odds: the panel's ----------------------------------------------------------------------------
  { const cen = C.createCentral({ E, logOf: () => [], cfg: { msPerMin: 1e9, every: 0 } }); await cen.start({ free: 4e9, srcDir: SRC, mainDir: MAIN });
    cen.take(ev()); const r = cen.compute(cen.flights.get(9001));
    const code = id => (E.byId(id) || {}).iata || (E.byId(id) || {}).icao;
    const byCode = new Map((r && r.cands || []).map(c => [code(c[0]), c[1]]));
    const altsSame = (r.alternatives || []).every(a => byCode.get(a.iata) === a.p);
    const rest = (r.cands || []).slice(1), below = rest.every(c => c[1] <= Math.max(1, r.destP - 1)), sorted = rest.every((c, i) => !i || rest[i - 1][1] >= c[1]);
    check('the confirm list: the destination first at the odds the panel shows, "also possible" at theirs, the rest below it, likeliest first', !!r && !!r.destId && r.cands[0][0] === r.destId && r.cands[0][1] === r.destP && altsSame && below && sorted,
      { dest: [r.destIata, r.destP], alts: (r.alternatives || []).map(a => a.iata + ' ' + a.p), list: (r.cands || []).map(c => code(c[0]) + ' ' + c[1]) });
    // (the others' share is what the destination's shown odds leave - nowhere near over 100 together)
    const sum = (r.cands || []).reduce((s, c) => s + c[1], 0);
    check('... together no more than what there is to share (100%, give or take rounding)', sum <= 100 + (r.cands || []).length, sum); }

  // ---- the flight opened: worked out at once ----------------------------------------------------------------------------
  { const cen = C.createCentral({ E, logOf: () => [], cfg: { msPerMin: 1, every: 0 } }); await cen.start({ free: 4e9, srcDir: SRC, mainDir: MAIN });
    const a1 = cen.answer({ flights: [ev({ id: 9101 })] });
    const a2 = cen.answer({ flights: [ev({ id: 9102 })] });
    const a3 = cen.answer({ flights: [ev({ id: 9103 })], sel: 9103 });
    check('the minute\'s allowance spent: a flight not opened waits; the one opened in a browser is worked out at once', !!a1.routes[9101] && !a2.routes[9102] && !!a3.routes[9103] && cen.stats.overBudget >= 1, { a1: !!a1.routes[9101], a2: !!a2.routes[9102], a3: !!a3.routes[9103], over: cen.stats.overBudget }); }

  // ---- no answer yet: the table's route, with its progress bar and time of arrival ----------------------------------------
  { const { JSDOM } = require(path.join(NM, 'jsdom')), FIDB = require(path.join(NM, 'fake-indexeddb'));
    const BUNDLE = fs.readFileSync(path.join(ROOT, 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8'), AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
    const MON = 'https://mon.test';
    const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/45.00,-40.00/5', runScripts: 'dangerously', pretendToBeVisual: true }).window;
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
    win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    const answer = url => {
      if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
      if (url.startsWith(MON + '/status')) return [200, JSON.stringify({ v: 3, since: Date.now() - 3600e3, public: true, ver: '1.1.1', central: { on: true } })];
      if (url.startsWith(MON + '/calc')) return [200, JSON.stringify({ v: 1, on: true, routes: {}, full: [] })];   // (busy: no answer yet)
      return [404, ''];
    };
    win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
    win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
    win.unsafeWindow = win; win.GM_notification = () => {}; win.console.debug = () => {}; win.console.log = () => {};
    win.eval(BUNDLE);
    const L = win.__tweeksLadd;
    await until(() => L && L.engine.airports.length > 5000, 60000);
    await L.store.kvReady; L.store.kvSet('monRemote', { url: MON, token: '' }); await L.monCheck(true).catch(() => {});
    const ID = 0x7c000001, lp = pts[pts.length - 1], lpi = L.engine.byIcao('ESSL'), bos = L.engine.byIcao('KBOS');
    L.store.mergeHex(HEX, { reg: 'N1868M', type: 'GLF6', ladd: true });
    L.live.set(ID, { id: ID, hex: HEX, reg: 'N1868M', type: 'GLF6', cs: 'N1868M', ladd: true });
    L.todayCache.set(HEX, { at: Date.now(), pts, lastPt: lp, legs: E.legsFromPoints(pts, { cls: 'bizjet', type: 'GLF6' }), sums: [] });
    // (the monitor's table: Boston -> Linkoping, its rough destination, no time of arrival)
    const row = [ID, HEX, 'N1868M', 'GLF6', '', 1, 'list', Math.round(Date.now() / 1000) - 600, bos.id, 'ground', lpi.id, 22, Math.round(Date.now() / 1000) - 60, lp.lat, lp.lon, lp.alt, 0, Math.round(lp.t), 0, Math.round(lp.t) - 3 * 3600, '', '', 0, '', 0, '', 0];
    L.srvIds.rows.set(ID, row);
    const r = L.composeRoute(ID, HEX);
    check('(the monitor answering, central calculation on, no answer for the flight yet)', L.monUp() && !L.calcGot.has(ID));
    check('no answer of central calculation yet: the monitor\'s table\'s route in the panel (Boston -> Linkoping) with its progress bar and time of arrival from where the aircraft is now', !!r && r.destId === lpi.id && r.originId === bos.id && r.eta > Date.now() / 1000 && !!r.progress && r.progress.remaining > 0 && r.progress.eta === r.eta && r.progress.remainingTime > 0,
      r && { d: r.destIata, o: r.originIata, eta: r.eta, progress: r.progress });
    // (the panel's destination: no tooltip - its strip built without one)
    const fn = BUNDLE.slice(BUNDLE.indexOf('function routeCells('), BUNDLE.indexOf('function renderStrip('));
    check('the destination in the panel: no tooltip (no title on it, nothing that builds one)', fn.length > 200 && !/title=/.test(fn) && !/tipTxt|etaTxt|wxTxt/.test(BUNDLE), fn.length);
    win.close(); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed', e && e.stack || e); process.exit(1); });
