// (1.0) The routes aircraft send and are sent over their datalinks (ACARS, VDL2, HFDL - adsb.lol's open data, CC0), and
// the event surges, end to end:
//   - monitor/datalink.cjs: a line of each feed read the same; each form of message that names departure and arrival
//     read (flight plan uplinked, position report, flight-planning service, filed plan, alert, departure clearance, ETA,
//     E-jet report) - not two codes side by side in other text, not an unknown airport, not operations messages (half
//     named another leg on 21 Oct); a route sent again merged; at most 8 per aircraft; 36 hours kept; zstd read by Node's
//     own and by the small decoder kept for Node 18; the day's new files listed
//   - the monitor: a round reads the new files (an hour older than 36 hours not even downloaded), /datalink answers by
//     registration, /status counts; /surge - the fields busier these last three days than usual
//   - the browser (the BUILT userscript in jsdom): the routes asked of the monitor together; a route taken for the flight
//     only when it is this flight's - sent in flight, or a plan before take-off - from where it took off, the aircraft on
//     the way; the surges read from the monitor
// usage: node test/unit_datalink.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mondl-'));
global.fetch = async () => ({ status: 404, ok: false, text: async () => '', json: async () => null });
const DL = require('../monitor/datalink.cjs');
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
const isAp = c => !!E.byIcao(c);
const nowS = () => Date.now() / 1000;
// (three lines, one of each feed, as zstd: made with Node 22's own compressor)
const VEC = 'KLUv/WCxAJUIALLPNSYAq8wDxvV1NZn6Tgsrg7vUQUMTkzeo8jYaQSWpV+owolBVRQAjAoi9994Oq6ixsKGgC2eUcBmQM8YnzslYTHBGy0HF6PxNRAwa14BN8pQZ07i9t1cNiiBRlv7TCjWWvkNrJTBRClsncaSlYMsoHQVf+MoO2OGOcbmyTnuF+syYg1cQ25/b/K0P+WfV9279x6sc0AtovGVf4iVMEAvwFnLGf9Nf6j2kqF7oIdOSeYPHqWtui2TNoUspW8DZodsDKZlJ4dRzBGuHBIo4GYykPpFg3WWSiPZKFwAOYwCY9WN6aMkBjIAWA5GKYXpZgBkxWI9kUCKkbInK3GAx3WPR5tUYFUa2MHpmuCBsNQO7gB0=';
const PLAIN = [
  JSON.stringify({ timestamp: 1792000000.5, tail: '.N711WK', label: 'H1', flight: 'EJA711', text: 'FLIGHT PLAN A0214 (KVNY - KSAC) FOR TAIL N711WK IS AVAILABLE' }),
  JSON.stringify({ vdl2: { t: { sec: 1792000600 }, avlc: { acars: { reg: '.N86HD', label: 'H1', flight: 'N86HD', msg_text: 'FPN/RI:DA:KBFI:AA:KPHX:CR:KBFIKPHX' } } } }),
  JSON.stringify({ hfdl: { t: { sec: 1792001200 }, lpdu: { hfnpdu: { acars: { reg: 'G-LADD', label: 'H1', msg_text: '00POS02,N49220E002136,102,LFPB,KBGR,' } } } } })
].join('\n') + '\n';

(async () => {
  // ---- 1. the messages ------------------------------------------------------------------------------------------------
  { const ls = PLAIN.trim().split('\n').map(l => DL.msgOf(JSON.parse(l)));
    check('a line of each feed read the same (acarsdec, VDL2, HFDL): registration without its dots, time, text', ls[0].reg === 'N711WK' && ls[0].t === 1792000000.5 && ls[0].flight === 'EJA711' && ls[1].reg === 'N86HD' && ls[1].t === 1792000600 && ls[2].reg === 'G-LADD' && /POS02/.test(ls[2].text), ls);
    check('... nothing from a line with no registration, a made-up one, or no text', DL.msgOf({ text: 'x' }) === null && DL.msgOf({ tail: 'N1 2 3!', text: 'x' }) === null && DL.msgOf({ tail: 'N1', text: '' }) === null && DL.msgOf(null) === null); }
  { const r = t => DL.routeOf(t, isAp), k = t => { const x = r(t); return x ? x.kind + ':' + x.o + '-' + x.d : null; };
    const got = {
      fpn: k('FPN/RI:DA:KCMH:AA:KTEB:CR:KCMHKTEB'),
      pos: k('00POS02,N49354W002264,409,KPTK,LFPB,22,1903'),
      fpl: k('FLIGHT PLAN A0214 (KVNY - KSAC) FOR TAIL N711WK IS AVAILABLE'),
      alert: k('YOUR FLIGHT PLAN E5520 KDJT-KUGN HAS BEEN EVALUATED'),
      pdc: k('PDC EJA678)\r\nKDJT-KJWN)\r\nCLRD AS FILED'),
      eta: k('ETA221759,KMEM,KBRO,'),
      rep: k('96,E,29.297,-96.379,20994,*****,KCRP,KIAH,')
    };
    const filed = r('FPL# E9024 KBFI-KPHX FOR N86HD HAS BEEN FILED FOR A 1940Z DEPARTURE ON 22 OCTOBER 2026');
    check('each form that says which is which read: departure and arrival', got.fpn === 'fpn:KCMH-KTEB' && got.pos === 'pos:KPTK-LFPB' && got.fpl === 'fpl:KVNY-KSAC' && got.alert === 'alert:KDJT-KUGN' && got.pdc === 'pdc:KDJT-KJWN' && got.eta === 'eta:KMEM-KBRO' && got.rep === 'rep:KCRP-KIAH', got);
    check('... a filed plan with its departure time', filed && filed.kind === 'filed' && filed.o === 'KBFI' && filed.d === 'KPHX' && filed.std === '1940', filed);
    check('... not operations messages (on 21 Oct half named another leg: N805VL "KHVN/KFLL" flew New Haven - San Juan)', r('3A01 OPSCTL 0321/21 KHVN/KFLL .N805VL') === null);
    check('... not two codes side by side in other text (a weather request), not an unknown code, not the same airport twice', r('REQ WX KTEB KJFK KLGA') === null && r('FPN/RI:DA:KCMH:AA:ZZZZ') === null && r('FPN/RI:DA:KTEB:AA:KTEB') === null);
    check('... and without the airport check, read as written (the list is the caller\'s)', DL.routeOf('FPN/RI:DA:QQQQ:AA:WWWW').o === 'QQQQ'); }
  // ---- 2. the store -------------------------------------------------------------------------------------------------
  { const S = DL.createDatalink({ isAirport: isAp }), t0 = Math.floor(nowS()) - 3600;
    const line = (reg, t, text) => JSON.stringify({ timestamp: t, tail: reg, text });
    const n = S.ingest([line('N711WK', t0, '00POS02,N1,1,KVNY,KSAC,'), line('N711WK', t0 + 600, '00POS02,N1,1,KVNY,KSAC,'), line('N711WK', t0 + 700, 'FPN/RI:DA:KVNY:AA:KSAC'), 'not json', line('N711WK', t0 - 40 * 3600, '00POS02,N1,1,KLAX,KSFO,')].join('\n'), nowS());
    const g = S.get(['n711wk', 'N0NE'])[0];
    check('a route sent again within six hours: one, its time moved on, both ways it came in kept', n === 3 && g && g.routes.length === 1 && g.routes[0].t === t0 + 700 && g.routes[0].first === t0 && g.routes[0].kinds.join() === 'pos,fpn', g);
    check('... a message older than 36 hours not kept; a registration not heard: nothing', S.get(['N0NE']).length === 0 && !g.routes.some(x => x.o === 'KLAX'));
    for (let i = 0; i < 10; i++) S.ingest(line('N711WK', t0 + 1000 + i * 7 * 3600 / 10, i % 2 ? '00POS02,N1,1,KSAC,KVNY,' : '00POS02,N1,1,KVNY,KSAC,'), nowS() + 9 * 3600);
    check('... at most 8 routes an aircraft, the newest', S.get(['N711WK'])[0].routes.length <= 8);
    S.prune(nowS() + 48 * 3600);
    check('... and all gone 36 hours after the last', S.get(['N711WK']).length === 0 && S.byReg.size === 0); }
  // ---- 3. zstd and the files of a day ----------------------------------------------------------------------------------
  { const buf = Buffer.from(VEC, 'base64'), own = DL.zstd(buf).toString('utf8');
    const f = require('../monitor/vendor/fzstd.cjs'), small = Buffer.from(f.decompress(new Uint8Array(buf))).toString('utf8');
    check('zstd: read by Node\'s own (from 22.15) or the small decoder kept for Node 18 - both the same, the lines whole', own === PLAIN && small === PLAIN, { own: own.length, small: small.length });
    const rel = { assets: [{ name: 'adsblol-adl-acars_20261021-004320_20261021-014321.jsonl.zst', browser_download_url: 'u1', size: 9 }, { name: 'adsblol-adl-vdl2_20261021-004308_20261021-014309.jsonl.zst', browser_download_url: 'u2', size: 9 }, { name: 'README.md', browser_download_url: 'u3' }, { name: 'adsblol-adl-hfdl_20261021-004549_20261021-014555.jsonl.zst', browser_download_url: 'u4' }] };
    let asked = ''; const nf = await DL.newFiles('2026-10-21', new Set(['adsblol-adl-hfdl_20261021-004549_20261021-014555.jsonl.zst']), async u => { asked = u; return rel; });
    check('the day\'s new files: its release asked for by tag, only the feeds\' files, not those read', asked === 'https://api.github.com/repos/adsblol/aircraft-data-links-2026/releases/tags/adsblol-adl-2026-10-21' && nf.map(x => x.url).join() === 'u1,u2', { asked, nf });
    check('... a day not out yet: none', (await DL.newFiles('2026-10-21', new Set(), async () => null)).length === 0); }
  // ---- 4. the monitor --------------------------------------------------------------------------------------------------
  { const d = new Date().toISOString().slice(0, 10).replace(/-/g, ''), hh = String(new Date().getUTCHours()).padStart(2, '0');
    const fresh = `adsblol-adl-acars_${d}-000000_${d}-${hh}0000.jsonl.zst`, old = 'adsblol-adl-acars_20200101-000000_20200101-010000.jsonl.zst';
    // (the vector's times moved to now)
    const t = Math.floor(nowS()) - 600, lines = PLAIN.trim().split('\n').map(l => JSON.parse(l));
    lines[0].timestamp = t; lines[1].vdl2.t.sec = t + 60; lines[2].hfdl.t.sec = t + 120;
    const body = zlib.zstdCompressSync ? zlib.zstdCompressSync(Buffer.from(lines.map(x => JSON.stringify(x)).join('\n') + '\n')) : null;
    const got = []; let listed = 0;
    const io = { list: async (day, seen) => { listed++; return [{ name: fresh, url: 'f1' }, { name: old, url: 'f0' }].filter(x => !seen.has(x.name)); }, json: async () => null, buf: async u => { got.push(u); return body; } };
    if (!body) console.log('(skipped the monitor round: this Node has no zstd compressor to make its file)');
    else {
      const n = await M.datalinkRound(io);
      check('a round: the new file read; an hour that ended more than 36 hours ago not even downloaded', n >= 1 && got.every(u => u === 'f1') && M.dlSeen.has(old) && M.dlSeen.has(fresh), { n, got });
      got.length = 0; await M.datalinkRound(io);
      check('... the next round: nothing read again', got.length === 0 && listed >= 2);
      const a = M.answer(new URL('http://x/datalink?reg=n711wk,G-LADD,bad%20reg,N0NE'), nowS());
      const by = Object.fromEntries((a.list || []).map(x => [x.reg, x.routes]));
      check('/datalink: the routes of the registrations asked for (upper case; a made-up one ignored)', by.N711WK && by.N711WK[0].o === 'KVNY' && by.N711WK[0].d === 'KSAC' && by['G-LADD'] && by['G-LADD'][0].d === 'KBGR' && !by.N0NE, a);
      const st = M.answer(new URL('http://x/status'), nowS());
      check('/status: the datalink\'s files and aircraft counted', st.datalink && st.datalink.files >= 1 && st.datalink.aircraft >= 2 && st.datalink.on === true, st.datalink);
    } }
  { // (the learning rows of 32 days: Teterboro four landings a day, then twelve a day these last three - a surge; Van Nuys
    // the reverse)
    const TEB = E.byIcao('KTEB'), VNY = E.byIcao('KVNY'), dir = path.join(process.env.MON_STORE, 'learn'); fs.mkdirSync(dir, { recursive: true });
    for (let k = 1; k <= 31; k++) {
      const day = new Date(Date.now() - k * 864e5).toISOString().slice(0, 10), t = Date.parse(day + 'T12:00:00Z') / 1000, rows = [];
      const nT = k <= 3 ? 12 : 4, nV = k <= 3 ? 0 : 6;
      for (let i = 0; i < nT; i++) rows.push(['a' + k + i + '|' + t, VNY.id, TEB.id, t + i, '', '', 'bizjet', 0]);
      for (let i = 0; i < nV; i++) rows.push(['b' + k + i + '|' + t, TEB.id, VNY.id, t + i, '', '', 'bizjet', 0]);
      rows.push(['m' + k + '|' + t, TEB.id, VNY.id, t, '', '', 'milheavy', 1]);
      fs.writeFileSync(path.join(dir, day + '.json'), JSON.stringify(rows));
    }
    const s = M.answer(new URL('http://x/surge'), nowS()), m = new Map(s.list);
    check('/surge: a field busier these three days than usual (Teterboro 36 against 12) up; one quieter (Van Nuys, none against 18) down; military left out', s.v === 1 && m.get(TEB.id) > 0.9 && m.get(VNY.id) < -1.5, s.list.slice(0, 4)); }
  // ---- 5. the browser ------------------------------------------------------------------------------------------------
  let JSDOM = null, FIDB = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); FIDB = require(path.join(NM, 'fake-indexeddb')); } catch (e) { console.log('(skipped the browser: no jsdom - the monitor\'s Node 18 run)'); }
  if (JSDOM) {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8'), AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
    const MON = 'https://143-47-224-210.sslip.io', asked = [], T = Math.floor(nowS());
    const ROUTES = { N711WK: [{ o: 'KVNY', d: 'KSAC', t: T - 1800, first: T - 2400, kinds: ['pos'] }], N86HD: [{ o: 'KBFI', d: 'KPHX', t: T - 5 * 3600, first: T - 5 * 3600, kinds: ['fpn'] }], N5ME: [{ o: 'KBFI', d: 'KPHX', t: T - 5 * 3600, first: T - 5 * 3600, kinds: ['pos'] }] };
    const answer = url => {
      if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
      if (!url.startsWith(MON)) return [404, ''];
      if (url.startsWith(MON + '/status')) return [200, JSON.stringify({ v: 3, since: Date.now() - 3600e3, public: true, ver: '1.0.0' })];
      let m = url.match(/\/datalink\?reg=([^&]+)/); if (m) { const regs = decodeURIComponent(m[1]).split(','); asked.push(['datalink', regs]); return [200, JSON.stringify({ list: regs.filter(r => ROUTES[r]).map(r => ({ reg: r, routes: ROUTES[r] })) })]; }
      if (/\/surge$/.test(url)) { asked.push(['surge']); return [200, JSON.stringify({ v: 1, day: '', list: [[E.byIcao('KTEB').id, 1.1], ['x', 2]] })]; }
      return [404, ''];
    };
    const win = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/51.8,-0.4/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController; win.Blob = Blob;
    win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
    win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
    win.unsafeWindow = win; win.GM_notification = () => {}; win.postMessage = () => {}; win.console.debug = () => {}; win.console.log = () => {};
    win.eval(SRC);
    const L = win.__tweeksLadd;
    await until(() => L && L.engine.airports.length > 5000, 60000);
    await L.monCheck(true).catch(() => null);
    check('(the browser: airports loaded, the monitor answering)', L.engine.airports.length > 5000 && L.monUp());
    const B = L.engine.byIcao, VNY = B('KVNY'), SAC = B('KSAC'), BFI = B('KBFI'), PHX = B('KPHX'), LAX = B('KLAX'), LAS = B('KLAS');
    const mid = (a, b, f) => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
    // (the routes asked for together, once; the flight worked out again when they come)
    let replans = 0; asked.length = 0;
    const first = [L.datalinkRoutes('N711WK', () => replans++), L.datalinkRoutes('n86hd', () => replans++), L.datalinkRoutes('N5ME'), L.datalinkRoutes('N0NE')];
    await until(() => asked.some(a => a[0] === 'datalink'), 3000); await sleep(50);
    const dlAsks = asked.filter(a => a[0] === 'datalink');
    check('the routes of four aircraft asked of the monitor in one request; none known before it answers', first.every(x => x === null) && dlAsks.length === 1 && dlAsks[0][1].length === 4, dlAsks);
    check('... the flights worked out again when theirs come (two waiting)', replans === 2, replans);
    const again = L.datalinkRoutes('N711WK');
    check('... asked again within ten minutes: from memory, no request', again && again[0].d === 'KSAC' && asked.filter(a => a[0] === 'datalink').length === 1);
    const plan = (reg, p, legStart, oAp) => L.datalinkPlan(1, { reg }, '', Object.assign({ t: T }, p), legStart, oAp);
    const p1 = plan('N711WK', mid(VNY, SAC, 0.5), T - 3600, VNY);
    check('this flight\'s own position reports (sent in flight, from where it took off, the aircraft on the way): its destination', p1 && p1.destId === SAC.id && p1.originId === VNY.id && p1.datalink && p1.kinds[0] === 'pos', p1);
    check('... from another airport than where it took off (Los Angeles, not Van Nuys): not this flight', plan('N711WK', mid(VNY, SAC, 0.5), T - 3600, LAX) === null);
    check('... nowhere near the way there (over Las Vegas): not taken', plan('N711WK', LAS, T - 3600, VNY) === null);
    check('... sent before this flight took off, and not a plan (a position report of the flight before): not taken', plan('N711WK', mid(VNY, SAC, 0.2), T - 600, VNY) === null);
    const p2 = plan('N86HD', mid(BFI, PHX, 0.3), T - 3600, BFI);
    check('a flight plan uplinked five hours before take-off: taken', p2 && p2.destId === PHX.id && p2.kinds[0] === 'fpn', p2);
    check('... the same five hours before as a position report: an earlier flight\'s, not taken', plan('N5ME', mid(BFI, PHX, 0.3), T - 3600, BFI) === null);
    check('... a plan more than twelve hours before take-off: not taken', plan('N86HD', mid(BFI, PHX, 0.3), T + 8 * 3600, BFI) === null);
    check('... an aircraft with none: nothing', plan('N0NE', mid(BFI, PHX, 0.3), T - 3600, BFI) === null);
    // (the surges: read from the monitor, every three hours)
    L.surgeNow(); await until(() => asked.some(a => a[0] === 'surge'), 3000); await sleep(50);
    const sm = L.surgeNow();
    check('the surges read from the monitor (an entry that is not a field id left out)', sm instanceof win.Map ? sm.get(B('KTEB').id) === 1.1 && sm.size === 1 : sm && sm.get && sm.get(B('KTEB').id) === 1.1 && sm.size === 1, sm && [...sm]);
    L.surgeNow(); await sleep(50);
    check('... asked once, not on every call', asked.filter(a => a[0] === 'surge').length === 1); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
