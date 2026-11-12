// 1.3.1 - lighter on the monitor's one main thread, and on FR24's page:
//   - the monitor's two-minute round a step at a time (workSlow): the same files as the round in one go (work), the
//     server's timers turning while it runs, never two rounds at once
//   - the day files: the flights held gone through once - the same files as before for every changed day, a day older
//     than what is held merged with its file's blocked flights, a day changed while the round writes written the next time
//   - the datalink files read a slice at a time: the same routes as in one go; a line with no message text not parsed
//   - what the main thread is busy with said by the monitor itself (prof.cjs): a minute's time by function and by job; a
//     stall of a second or more named - the job and the functions it was in; in /status
//   - a big answer packed without holding the server up (the HTTP server, a real request)
//   - FR24's adverts: with "no adverts" on, no advert is asked for (window.tude.refreshAdsViaDivMappings does nothing) -
//     whichever way the library puts itself on the page; switched off, FR24's own call goes through; the rewarded advert
//     of the 3D view untouched
// usage: node test/unit_131.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), zlib = require('zlib');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon131-')); process.env.MON_PORT = '0';
global.fetch = async () => ({ status: 404, ok: false, headers: { get: () => null }, text: async () => '', json: async () => null });
const M = require('../monitor/monitor.cjs'), DL = require('../monitor/datalink.cjs'), PR = require('../monitor/prof.cjs');
M.loadEngine();
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STORE = process.env.MON_STORE, dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const rd = d => { try { return JSON.parse(fs.readFileSync(path.join(STORE, 'legs-' + d + '.json'), 'utf8')); } catch (e) { return null; } };

(async () => {
  // ---- 1. the day files -------------------------------------------------------------------------------------------------
  { const now = Math.floor(Date.now() / 1000), T0 = now - 3 * 86400, legs = M.legs, dirty = M.dirtyDays;
    const leg = (hex, t, extra) => Object.assign({ hex, tStart: t, tOff: t + 60, tEnd: t + 3600, from: 1, to: 2 }, extra || {});
    const put = l => { let m = legs.get(l.hex); if (!m) legs.set(l.hex, m = new Map()); m.set(String(l.tStart), l); dirty.add(dayOf(l.tOff || l.tStart)); };
    for (let i = 0; i < 3000; i++) put(leg('a' + (10000 + i).toString(16), T0 + (i % 3) * 86400 + i));
    const days = [0, 1, 2].map(k => dayOf(T0 + k * 86400 + 60)), per = d => [...legs.values()].flatMap(m => [...m.values()]).filter(l => dayOf(l.tOff || l.tStart) === d);
    M.save();
    const a = days.map(rd);
    check('the changed days written, each with its own flights in the order they are held - the flights gone through once', a.every((l, k) => Array.isArray(l) && JSON.stringify(l) === JSON.stringify(per(days[k]))) && a.reduce((n, l) => n + l.length, 0) === 3000 && dirty.size === 0, a.map(l => l && l.length));
    // (one day changed: only its file written)
    const before = days.map(d => fs.statSync(path.join(STORE, 'legs-' + d + '.json')).mtimeMs); await sleep(30);
    put(leg('abc123', T0 + 86400 + 7777, { ladd: true }));
    let turns = 0; const iv = setInterval(() => turns++, 1);
    await M.saveSlow(); clearInterval(iv);
    const after = days.map(d => fs.statSync(path.join(STORE, 'legs-' + d + '.json')).mtimeMs), b = rd(days[1]);
    check('... a slice at a time (saveSlow): the same file as in one go, only the changed day written', JSON.stringify(b) === JSON.stringify(per(days[1])) && b.length === 1001 && after[0] === before[0] && after[2] === before[2] && after[1] > before[1] && dirty.size === 0, { n: b.length });
    // (a day older than what is held in memory: its file's blocked flights kept, those in memory put over them)
    const old = dayOf(now - 100 * 86400), tOld = Date.parse(old + 'T10:00:00Z') / 1000;
    fs.writeFileSync(path.join(STORE, 'legs-' + old + '.json'), JSON.stringify([leg('0ld001', tOld, { ladd: true }), leg('0ld002', tOld + 5, {}), leg('0ld003', tOld + 9, { ladd: true })]));
    put(leg('0ld003', tOld + 9, { ladd: true, to: 77 })); put(leg('0ld004', tOld + 20, { ladd: true }));
    await M.saveSlow();
    const o = rd(old).map(l => l.hex + ':' + l.to).sort();
    check('... a day older than what is held: the flights held, and its file\'s blocked flights not among them kept (never the others) - as before', o.join() === '0ld001:2,0ld003:77,0ld004:2', o);
    // (a day changed while the round is writing: written again the next time)
    put(leg('abc124', T0 + 5555)); const p = M.saveSlow(); put(leg('abc125', T0 + 6666)); await p;
    const again = dirty.has(days[0]); await M.saveSlow();
    check('... a day changed while it is being written: on the list again, written the next time', again && rd(days[0]).some(l => l.hex === 'abc125') && dirty.size === 0, { again });
    for (const k of [...legs.keys()]) legs.delete(k); }
  // ---- 2. the round ---------------------------------------------------------------------------------------------------
  { let turns = 0; const iv = setInterval(() => turns++, 1);
    const p1 = M.workSlow(), p2 = M.workSlow(), r = await Promise.all([p1, p2]); clearInterval(iv);
    check('the two-minute round a step at a time: done, the server\'s timers turning meanwhile; a second one while it runs not started', r[0] === true && r[1] === false && turns >= 1, { r, turns });
    let threw = ''; try { M.work(); M.work(true); } catch (e) { threw = String(e && e.stack || e); }
    check('... and in one go, as on stop: nothing thrown', threw === '', threw.slice(0, 300));
    check('... state.json written by both', fs.existsSync(path.join(STORE, 'state.json'))); }
  // ---- 3. the datalink files -------------------------------------------------------------------------------------------
  { const now = Date.now() / 1000, t = Math.floor(now) - 600, lines = [];
    for (let i = 0; i < 4000; i++) {
      const k = i % 4;
      lines.push(k === 0 ? JSON.stringify({ timestamp: t + i, tail: 'N' + (100 + (i % 50)) + 'DL', label: 'H1', text: `FPN/RI:DA:KVNY:AA:${i % 8 ? 'KSAC' : 'KLAS'}` })
        : k === 1 ? JSON.stringify({ vdl2: { t: { sec: t + i }, avlc: { src: { addr: 'A1B2C3' }, cr: 'Command', frame_type: 'S' } } })       // (link traffic: no message)
        : k === 2 ? JSON.stringify({ hfdl: { t: { sec: t + i }, lpdu: { hfnpdu: { acars: { reg: '.G-AB' + (i % 30), label: 'H1', msg_text: '00POS02,N49220E002136,102,LFPB,KBGR,' } } } } })
        : 'not json at all');
    }
    const txt = lines.join('\n') + '\n', A = DL.createDatalink({}), B = DL.createDatalink({});
    const n1 = A.ingest(txt, now); let turns = 0; const iv = setInterval(() => turns++, 1); const n2 = await B.ingestSlow(txt, now); clearInterval(iv);
    check('a datalink file read a slice at a time: the same routes as in one go', n1 === 2000 && n2 === n1 && JSON.stringify([...A.byReg]) === JSON.stringify([...B.byReg]) && A.byReg.size === 40 && A.stats.lines === 4000, { n1, n2, regs: A.byReg.size, turns });
    const spy = JSON.parse; let parsed = 0; JSON.parse = function (s) { parsed++; return spy.apply(JSON, arguments); };
    const C = DL.createDatalink({}); C.ingest(txt, now); JSON.parse = spy;
    check('... a line with no message text in it not even parsed (link traffic: half the VDL2 and HFDL feeds)', parsed === 2000, parsed); }
  // ---- 4. what the main thread is busy with ----------------------------------------------------------------------------
  { // (a profile as V8 gives it: root > timer > job > hot | idle; a sample every 20 ms)
    const cf = (name, url, line) => ({ functionName: name, url: url || '', lineNumber: line || 0, columnNumber: 0, scriptId: '1' });
    const nodes = [{ id: 1, callFrame: cf('(root)'), children: [2, 3, 6] }, { id: 2, callFrame: cf('(idle)') }, { id: 3, callFrame: cf('listOnTimeout', 'node:internal/timers', 500), children: [4] },
      { id: 4, callFrame: cf('workRound', 'file:///opt/mon/monitor.cjs', 99), children: [5] }, { id: 5, callFrame: cf('stringify', '', 0) }, { id: 6, callFrame: cf('(garbage collector)') }];
    const samples = [], deltas = []; for (let i = 0; i < 100; i++) { samples.push(i < 40 ? 2 : i < 95 ? 5 : i < 98 ? 6 : 2); deltas.push(20000); }
    const d = PR.digest({ nodes, startTime: 5e9, endTime: 5e9 + 2e6, samples, timeDeltas: deltas }, 1000000, [[1000000 + 820, 1000000 + 1900]]);
    check('a minute\'s profile read: the time by function and by the job that started it (the first function of the monitor\'s own on the stack), idle time left out', d.busyMs === 1160 && d.top[0][0] === 'stringify' && d.top[0][1] === 1100 && d.jobs[0][0] === 'workRound monitor.cjs:100' && d.jobs[0][1] === 1100 && d.jobs[1][0] === '(garbage collector)', d);
    check('... a time the server stood still named: how long, the job, the functions it was in', d.stalls.length === 1 && d.stalls[0].ms === 1080 && d.stalls[0].job === 'workRound monitor.cjs:100' && d.stalls[0].hot[0][0] === 'stringify' && d.stalls[0].at === 1001900, d.stalls);
    const P = PR.createProf({ windowMs: 1e9 }), st = await P.start();
    if (!st.on) console.log('(skipped the live profile: ' + st.err + ')');
    else {
      await sleep(150);
      const blockHere = ms => { const t = Date.now(); let x = 0; while (Date.now() - t < ms) x += Math.sqrt(x + 1); return x; };
      const t0 = Date.now(); blockHere(1200); P.stall(Date.now(), Date.now() - t0); P.stall(Date.now(), 300);
      await sleep(100); await P.turn(); await P.stop();
      const s = P.stats.stalls[0];
      check('the monitor\'s own profile, live: the function that held the main thread for 1.2 s named in the stall and at the top of the minute; a hold under a second not listed', P.stats.stalls.length === 1 && s.ms >= 1200 && s.hot.some(h => /^blockHere /.test(h[0]) && h[1] > 800) && /^blockHere /.test(P.stats.top[0][0]) && P.stats.busyPct > 50, P.stats);
    }
    const j = M.answer(new URL('http://x/status'), Date.now() / 1000);
    check('/status: loop.prof - on or off and why, the busy share, the top functions and jobs, the stalls', j.loop && j.loop.prof && 'on' in j.loop.prof && Array.isArray(j.loop.prof.top) && Array.isArray(j.loop.prof.stalls), j.loop && j.loop.prof); }
  // ---- 5. a big answer over HTTP ---------------------------------------------------------------------------------------
  { const big = []; for (let i = 0; i < 3000; i++) big.push({ hex: (0xa00000 + i).toString(16), r: 'N' + i, alt_baro: 30000, seen_pos: 1, lat: 40 + i / 1000, lon: -75 });
    M.setLadd(big);
    const srv = M.serve(), port = await new Promise(res => { const t = () => { const a = srv && srv.address && srv.address(); if (a && a.port) res(a.port); else setTimeout(t, 20); }; t(); });
    const get = (p, gz) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port, path: p, headers: gz ? { 'Accept-Encoding': 'gzip' } : {} }, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, enc: r.headers['content-encoding'] || '', len: +r.headers['content-length'] || 0, body: Buffer.concat(c) })); }).on('error', rej); });
    const a = await get('/ladd', true), b = await get('/ladd', false), c = await get('/surge', true);
    const ja = JSON.parse(zlib.gunzipSync(a.body).toString('utf8')), jb = JSON.parse(b.body.toString('utf8'));
    check('a big answer over HTTP: packed (gzip) where the asker takes it - the same answer, a fraction of the size; as it is where not; a small one never packed', a.status === 200 && a.enc === 'gzip' && a.len === a.body.length && ja.ac.length === 3000 && jb.ac.length === 3000 && b.enc === '' && a.body.length < b.body.length / 4 && c.status === 200 && c.enc === '', { a: a.body.length, b: b.body.length, c: c.enc });
    M.setLadd([]); srv.close(); }
  // ---- 6. FR24's adverts (the page's part, the built userscript in jsdom) ----------------------------------------------
  let JSDOM = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); } catch (e) { console.log('(skipped the page: no jsdom)'); }
  if (JSDOM) {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
    const open = (opts, pre) => {
      const w = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/51.5,-0.5/8', runScripts: 'dangerously', pretendToBeVisual: true }).window;
      if (opts) w.localStorage.setItem('tweeks.fr24.ladd.opts1', JSON.stringify(opts));
      w.GM_xmlhttpRequest = o => { setTimeout(() => o.onload && o.onload({ status: 404, responseText: '', response: '' }), 2); return { abort() {} }; };
      w.unsafeWindow = w; w.GM_notification = () => {}; w.console.debug = () => {}; w.console.log = () => {};
      w.fetch = () => Promise.resolve(new Response('', { status: 404 }));
      if (pre) pre(w);
      w.eval(SRC); return w;
    };
    // (FR24's own call, as its tudeManager makes it)
    const fr24Refresh = (w, slot) => { const n = w.tude == null || w.tude.cmd == null ? null : w.tude; if (n != null) n.cmd.push(() => { n.refreshAdsViaDivMappings([slot]); }); return n; };
    const run = w => { const q = w.tude.cmd; w.tude.cmd = []; for (const f of q) f(); };
    { const w = open(null), asked = [], rewarded = [];
      check('no advert library on the page yet: FR24\'s call does nothing, as FR24 has it', fr24Refresh(w, 'x') === null && w.tude === undefined);
      // (the library puts itself on the page: its object, then its functions)
      w.tude = w.tude || { cmd: [] }; w.tude.refreshAdsViaDivMappings = l => asked.push(l); w.tude.initRewardedAd = o => rewarded.push(o);
      fr24Refresh(w, { divId: 'fr24_airplane' }); run(w); w.tude.cmd.push(() => w.tude.initRewardedAd({ gamUnit: '/x/fr24_rew' })); run(w);
      check('"no adverts" on: a panel\'s slot asks for no advert - the library\'s auction never starts; the 3D view\'s rewarded advert asked for as ever', asked.length === 0 && rewarded.length === 1 && typeof w.tude.refreshAdsViaDivMappings === 'function', { asked: asked.length, rewarded: rewarded.length });
      // (the library replaced by a new object, its function on its prototype)
      class Tude { constructor() { this.cmd = []; } refreshAdsViaDivMappings(l) { asked.push(l); } }
      w.tude = new Tude(); fr24Refresh(w, { divId: 'fr24_airport' }); run(w);
      check('... the library put there another way - a new object, its function its class\'s: none asked for either', asked.length === 0);
      w.close(); }
    { const asked = [], w = open({ noAds: false }, w0 => { w0.tude = { cmd: [], refreshAdsViaDivMappings: l => asked.push(l) }; });
      fr24Refresh(w, { divId: 'fr24_airplane' }); run(w);
      class Tude { constructor() { this.cmd = []; } refreshAdsViaDivMappings(l) { asked.push(l); } }
      w.tude = new Tude(); fr24Refresh(w, { divId: 'fr24_airport' }); run(w);
      check('"no adverts" switched off: FR24\'s adverts asked for as FR24 does - the library there before the script, or put there after, its function its own or its class\'s', asked.length === 2 && asked[0][0].divId === 'fr24_airplane' && asked[1][0].divId === 'fr24_airport', asked);
      w.close(); }
    { const asked = [], w = open({ on: false }, w0 => { w0.tude = { cmd: [], refreshAdsViaDivMappings: l => asked.push(l) }; });
      const d = Object.getOwnPropertyDescriptor(w, 'tude');
      check('LADD Unblock switched off: FR24\'s advert library not touched at all', !!d && 'value' in d && !Object.getOwnPropertyDescriptor(w.tude, 'refreshAdsViaDivMappings').get);
      w.close(); }
  }
  // ---- 7. the airport pages and the OurAirports airports on FR24's map (the page's part on its own) -------------------
  if (JSDOM) {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
    const PI = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0];
    const T = Math.floor(Date.now() / 1000);
    const locked = { component: 'Data/AirportStatistics', url: '/data/airports/bwf/statistics', version: 'v1', props: { airport: { id: 530, iata: 'BWF', icao: 'EGNL', timezone: 'Europe/London', name: 'Walney' }, summary: { airportsServed: 3, countriesServed: 2, totalFlights: 12, landingCount: 7, takeoffCount: 5 }, movements: [], runways: [], locked: { movements: true, runways: true } } };
    const page = (url, html, before) => {
      const w = new JSDOM(html || '<!doctype html><html><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window; let H = null; const posts = [];
      w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob;
      w.fetch = () => Promise.reject(new Error('offline')); w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
      if (before) before(w);
      w.eval('(' + PI + ')()');
      return { w, H: () => H, posts, send: data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' })) };
    };
    const esc = o => JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    // (the statistics page as FR24's server gives it: the page's data in #app)
    { const P = page('https://www.flightradar24.com/data/airports/bwf/statistics', `<!doctype html><html><head></head><body><div id="app" data-page="${esc(locked)}"></div></body></html>`);
      const pg = JSON.parse(P.w.document.getElementById('app').getAttribute('data-page'));
      check('the statistics page as FR24\'s server gives it: unlocked in the page\'s own data before FR24\'s app reads it - no upgrade box, so no frame that cuts the week to five days', pg.props.locked.movements === false && pg.props.locked.runways === false && Array.isArray(pg.props.movements) && pg.props.tlUnlocked.movements === true && pg.props.summary.totalFlights === 12, pg.props);
      check('... and a frame of a locked table FR24\'s server may have drawn, hidden until FR24\'s app draws the page', /max-h-84[^}]*visibility:hidden/.test((P.w.document.getElementById('tl-stats-frame') || {}).textContent || ''));
      P.w.close(); }
    { const rows = [{ timestamp: T - 86400, total: 9, takeoffs: 4, landings: 5 }];
      const P = page('https://www.flightradar24.com/data/airports/bwf/statistics', `<!doctype html><html><head></head><body><div id="app" data-page="${esc(locked)}"></div></body></html>`, w => { w.localStorage.setItem('tl.apstats.530', JSON.stringify({ at: Date.now(), movements: rows })); });
      const pg = JSON.parse(P.w.document.getElementById('app').getAttribute('data-page'));
      check('... the tables as this browser last saw them for the airport, at once (the monitor\'s then put over them)', pg.props.movements.length === 1 && pg.props.movements[0].total === 9 && pg.props.runways.length === 0, pg.props.movements);
      P.w.close(); }
    { const sub = JSON.parse(JSON.stringify(locked)); sub.props.locked = { movements: false, runways: false }; sub.props.movements = [{ timestamp: T, total: 99, takeoffs: 50, landings: 49 }];
      const P = page('https://www.flightradar24.com/data/airports/bwf/statistics', `<!doctype html><html><head></head><body><div id="app" data-page="${esc(sub)}"></div></body></html>`);
      const pg = JSON.parse(P.w.document.getElementById('app').getAttribute('data-page'));
      check('... a subscriber\'s own tables (not locked): left as they are', pg.props.movements[0].total === 99 && !pg.props.tlUnlocked);
      P.w.close(); }
    { const P = page('https://www.flightradar24.com/data/airports/lpl', null, w => { w.fetch = (u, o) => Promise.resolve(new Response(JSON.stringify(Object.assign({}, locked, { url: '/data/airports/bwf/statistics' })), { status: 200, headers: { 'content-type': 'application/json' } })); });
      const r = await P.w.fetch('https://www.flightradar24.com/data/airports/bwf/statistics', { headers: { 'X-Inertia': 'true', 'X-Inertia-Version': 'v1' } }), j = await r.json();
      const r2 = await P.w.fetch('https://www.flightradar24.com/data/airports/bwf/statistics'), j2 = await r2.json();
      check('a move to the statistics page within FR24 (its router\'s answer): unlocked the same; the page asked for as a page: as it came', j.props.locked.movements === false && j.props.tlUnlocked.runways === true && j2.props.locked.movements === true, { a: j.props.locked, b: j2.props.locked });
      P.w.close(); }
    // (the OurAirports airports: FR24's map, its airport window, its lookups)
    { const P = page('https://www.flightradar24.com/54.15,-3.20/10'), H = P.H();
      const oaRows = [[17000001, 'EGXX', 'EGXX', 'Walney Strip', 'Barrow-in-Furness', 530, 54.2, -3.2, 50, 'S'], [17000002, 'GB-0999', 'GB-0999', 'Some Heliport', 'Ulverston', 530, 54.19, -3.09, 30, 'H'], [17000003, '00AL', '00AL', 'Far Field', '', 530, 54.1, -3.3, 0, 'S']];
      H.acceptOa({ rows: oaRows, sig: '3.1.1' });
      const ref = { id: 530, iata: 'BWF', icao: 'EGNL', name: 'Barrow', city: 'Barrow', country: 'United Kingdom', countryId: 235, lat: 54.13, lon: -3.26, size: 3000, timezone: { abbr: 'GMT', abbrName: null, isDst: false, name: 'Europe/London', offset: 0, offsetHours: '0:00' } };
      const list = { rows: [ref].concat(Array.from({ length: 120 }, (_, i) => ({ id: 1000 + i, iata: 'A' + i, icao: '', name: 'X', lat: 0, lon: 0, timezone: ref.timezone }))) };
      H.patchList('airports', list);
      // (FR24's store as it keeps airports: each list row turned into its own form - latitude / longitude - and an index of
      // them by id; its map draws the airports array)
      const fr24Form = a => ({ id: a.id, iata: a.iata, icao: a.icao, name: a.name, latitude: a.lat, longitude: a.lon, altitude: a.alt, city: a.city, country: a.country, countryId: a.countryId, size: a.size, timezoneName: a.timezone.name, timezoneCode: a.timezone.abbr, timezoneDST: a.timezone.isDst, timezoneOffset: a.timezone.offset, timezoneOffsetHours: a.timezone.offsetHours, videoStream: null });
      const all = list.rows.map(fr24Form), own1 = all.find(a => a.id === 17000001), byId = new Map(all.filter(a => a.id !== 17000002).map(a => [a.id, a]));
      const store = { airports: all.filter(a => a.id < 1e7), airportsById: byId };
      P.w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['airports', store]]) } } } };
      H.setOaBase(store.airports.slice()); H.oaMap();
      const pins = store.airports.filter(a => a.id >= 1e7);
      check('FR24\'s map, zoomed in at Barrow: the OurAirports airports in view as FR24 keeps airports - latitude and longitude (1.3 put lat / lon there: no pin was ever drawn)', pins.length === 3 && pins.every(a => isFinite(a.latitude) && isFinite(a.longitude) && a.timezoneName === 'Europe/London' && typeof a.iata === 'string'), pins.map(a => [a.id, a.latitude, a.longitude]));
      check('... FR24\'s own object of one where its store has it; one it has not made in its form', pins.find(a => a.id === 17000001) === own1 && pins.find(a => a.id === 17000002).latitude === 54.19 && pins.find(a => a.id === 17000002).iata === 'GB-0999');
      // (the window: FR24's airport API asked by id)
      const get = async u => { const r = await P.w.fetch(u); return r.json(); };
      const main = await get('https://www.flightradar24.com/api/v1/airports/17000002'), imgs = await get('https://www.flightradar24.com/api/v1/airports/17000002/images'), dis = await get('https://www.flightradar24.com/api/v1/airports/17000002/disruptions');
      check('its window: FR24\'s airport API answered here in FR24\'s form - its details (an id, so FR24 opens the window), no pictures, no delays', main.data.info.id === 17000002 && main.data.info.name === 'Some Heliport' && main.data.info.latitude === 54.19 && main.data.info.timezone === 'Europe/London' && Array.isArray(main.data.runways) && main.data.stats.summary.totalFlights === 0 && Array.isArray(imgs.data) && imgs.data.length === 0 && dis.data && typeof dis.data === 'object', main.data.info);
      const wxP = get('https://www.flightradar24.com/api/v1/airports/17000002/weather');
      await sleep(30);
      const asked = P.posts.filter(p => p.__tweeksLadd === 'needApWx' && p.ap === 17000002).length;
      P.send({ __tweeksLadd: 'apWxGot', ap: 17000002, wx: { t: T, cond: 'cloudy', tempC: 9.4, dewC: 6, rh: 79, wdir: 250, wkts: 12, hpa: 1013, metar: 'GB-0999 121200Z AUTO 25012KT 9999 BKN020 09/06 Q1013 RMK MODEL' } });
      const wx = await wxP;
      check('... its weather: the monitor\'s, asked for and waited for, in FR24\'s form (conditions, temperature, wind, pressure, the made METAR)', asked === 1 && wx.data.condition === 'cloudy' && wx.data.temperature === 9.4 && wx.data.wind.direction === 250 && wx.data.wind.speed === 12 && /RMK MODEL/.test(wx.data.metar), { asked, wx });
      const wx0 = await (await P.w.fetch('https://www.flightradar24.com/api/v1/airports/17000003/weather')).json().catch(e => ({ err: String(e) }));
      check('... none from the monitor in time: an empty answer - FR24 shows "N/A" (and 1.3\'s weather goes in its place when it comes)', wx0.data && Object.keys(wx0.data).length === 0, wx0);
      // (FR24's lookup of an airport by its code)
      const own = { BWF: fr24Form(ref) }, db = { byIATA: async c => own[c] || null, byICAO: async () => null, byId: async id => byId.get(id) || null };
      db.byCodeOrId = async c => (typeof c === 'number' ? db.byId(c) : c.length === 3 ? db.byIATA(c.toUpperCase()) : c.length === 4 ? db.byICAO(c.toUpperCase()) : null);
      H.mxPatchCore({ zz: db, other: { a: 1 } }); H.mxPatchCore({ zz: db });
      const [l1, l2, l3, l4, l5] = await Promise.all([db.byCodeOrId('GB-0999'), db.byCodeOrId('00AL'), db.byCodeOrId('BWF'), db.byCodeOrId('NOPE1'), db.byCodeOrId('EGXX')]);
      check('FR24\'s lookup of an airport by code: every OurAirports code found (FR24 finds only three letters or four - "GB-0999", "00AL" never), FR24\'s own as FR24 finds them, an unknown one not, patched once', l1 && l1.id === 17000002 && isFinite(l1.latitude) && l2 && l2.id === 17000003 && l3 && l3.id === 530 && l4 === null && l5 === own1 && H.mxStat().oaLookup === 1, [l1 && l1.id, l2 && l2.id, l3 && l3.id, l4, l5 && l5.id]);
      P.w.close(); }
  }
  // ---- 8. the OurAirports list kept up to date (monitor/oaap.cjs) -------------------------------------------------------
  { const { createOaAirports } = require('../monitor/oaap.cjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa131-')), head = '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"';
    const line = (id, ident, type, name, lat, lon, icao) => `${id},"${ident}","${type}","${name}",${lat},${lon},50,"EU","GB","GB-ENG","Somewhere","no",${icao ? '"' + icao + '"' : ''},,,,,,`;
    const fileOf = extra => [head, line(1, 'GB-0002', 'small_airport', 'Fishburn Airfield', 54.686, -1.459), line(2, 'GB-0674', 'closed', 'Hendon Aerodrome', 51.601, -0.245), line(3, 'EGOW', 'small_airport', 'RAF Woodvale', 53.5816, -3.05552, 'EGOW')].concat(extra || []).concat(Array.from({ length: 50000 }, (_, i) => line(1000 + i, 'ZZ-' + i, 'closed', 'Gone ' + i, 10, 10))).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'oa_airports.csv'), fileOf());
    let clock = 1e12; const O = createOaAirports({ E: M.E, dataDir: dir, now: () => clock });
    let turns = 0; const iv = setInterval(() => turns++, 1); const n = await O.rebuild(); clearInterval(iv);
    const codes = O.rows().map(r => r[1]);
    check('the OurAirports list worked out a slice at a time (the server answering in between): a field with no ICAO code by OurAirports\' own code ("GB-0002"); a closed one ("GB-0674", Hendon) left out', n === 2 && codes.includes('GB-0002') && codes.includes('EGOW') && !codes.includes('GB-0674'), { n, codes, turns });
    const at0 = O.at;
    check('... GET /oaap?have=<the list\'s own time>: "the same" - a few bytes, not the list; any other: the list', O.same(at0) === true && O.same(at0 - 1) === false && O.same('') === false);
    // (OurAirports' own file: asked for once a day, only what changed)
    const asks = []; let reply = { status: 200, etag: 'e1', body: fileOf([line(4, 'GB-0999', 'heliport', 'New Heliport', 54.1, -2.9)]) };
    const fetchFn = async (u, o) => { asks.push({ u, inm: (o && o.headers && o.headers['If-None-Match']) || '' }); return { status: reply.status, headers: { get: k => (k === 'etag' ? reply.etag : null) }, text: async () => reply.body }; };
    clock += 1000; const r1 = await O.refresh(fetchFn);
    check('... OurAirports\' own file read: a new airport in it on the list (its id the same function of its code: links to it stay good); the list\'s time moved on', r1 === true && O.rows().some(r => r[1] === 'GB-0999') && O.at > at0 && /ourairports-data\/main\/airports\.csv$/.test(asks[0].u), { r1, asks });
    const r2 = await O.refresh(fetchFn);
    check('... asked again within the day: not asked', r2 === false && asks.length === 1);
    clock += 25 * 3600e3; reply = { status: 304, etag: 'e1', body: '' };
    const r3 = await O.refresh(fetchFn);
    check('... a day on: asked with what it was sent last (If-None-Match) - unchanged, nothing done', r3 === false && asks[1].inm === 'e1' && O.stats.unchanged === 1);
    clock += 25 * 3600e3; reply = { status: 200, etag: 'e2', body: '<html>maintenance</html>' }; const before = fs.readFileSync(path.join(dir, 'oa_airports.csv'), 'utf8').length;
    const r4 = await O.refresh(fetchFn);
    check('... an answer that is not the airports file (a page, a short file): never put in place of the one kept', r4 === false && O.stats.fails === 1 && fs.readFileSync(path.join(dir, 'oa_airports.csv'), 'utf8').length === before && O.rows().some(r => r[1] === 'GB-0999'), O.stats.lastErr); }
  // ---- 9. an OurAirports airport's data pages, made from its nearest FR24 airport's (the page's part on its own) --------
  if (JSDOM) {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8'), PI = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0];
    const w = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/data/airports/lpl', runScripts: 'dangerously', pretendToBeVisual: true }).window; let H = null;
    w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.fetch = () => Promise.reject(new Error('offline')); w.postMessage = () => {};
    w.eval('(' + PI + ')()');
    const send = data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' }));
    check('a code not known as an OurAirports airport: FR24\'s own page, asked of FR24 as it is', H.oaPageReq('/data/airports/gb-0002/statistics') === null && H.oaPageReq('/data/airports/lpl') === null);
    send({ __tweeksLadd: 'oaIs', row: [43611881, 'GB-0002', 'GB-0002', 'Fishburn Airfield', 'Fishburn', 2247, 54.686, -1.459, 377, 'S'], ref: 'MME' });
    const q = H.oaPageReq('https://www.flightradar24.com/data/airports/GB-0002/statistics?x=1&tl-oa=gb-0002');
    check('an OurAirports airport\'s page (one with no ICAO code: "GB-0002"): asked of FR24 as its nearest FR24 airport\'s same page (Teesside\'s), its own marks left off', q && q.refUrl === '/data/airports/mme/statistics?x=1' && q.code === 'gb-0002' && q.sub === '/statistics', q);
    const ref = { component: 'Data/Airport', url: '/data/airports/mme', version: 'v9', encryptHistory: false, deferredProps: { later: ['reviews'] },
      props: { errors: {}, dispatcher: { auth: { isLoggedIn: true } }, route: { name: 'web.data.airports.show', params: { airport: 'mme' }, query: [] },
        airport: { id: 2247, name: 'Teesside International Airport', city: 'Durham', iata: 'MME', icao: 'EGNV', countryName: 'United Kingdom', countryId: 235, timezone: 'Europe/London', elevationFt: 120, latitude: 54.509, longitude: -1.429, website: 'https://teessideairport.com' },
        photos: [{ url: 'p.jpg' }], weather: { temperatureC: 7, condition: 'rain' }, boards: { arrivals: [{ flight: 'LS123' }], departures: [] }, topRoutes: [{ id: 'MME-AMS', flights: 40 }],
        about: { description: 'Teesside International Airport serves Durham', destinations: 12, airlines: 3, hasLounge: true }, reviews: { rating: 4.1, count: 50 }, runways: [], locked: { runways: true, events: false }, canonicalUrl: 'https://www.flightradar24.com/data/airports/mme', image: { url: 'x' } } };
    const pg = H.oaPageOf(JSON.parse(JSON.stringify(ref)), H.oaPageReq('/data/airports/gb-0002'));
    const str = JSON.stringify(pg);
    check('... FR24\'s answer given to its app as this airport\'s: its airport this one (name, code, place, height; the country and zone of the airport it was made from), its address and canonical address this one\'s',
      pg.url === '/data/airports/gb-0002' && pg.component === 'Data/Airport' && pg.props.airport.id === 43611881 && pg.props.airport.name === 'Fishburn Airfield' && pg.props.airport.iata === 'GB-0002' && pg.props.airport.icao === null && pg.props.airport.elevationFt === 377 && pg.props.airport.latitude === 54.686 && pg.props.airport.countryName === 'United Kingdom' && pg.props.airport.timezone === 'Europe/London' && pg.props.route.params.airport === 'gb-0002' && pg.props.canonicalUrl === 'https://www.flightradar24.com/data/airports/gb-0002', pg.props.airport);
    check('... nothing of the other airport left: its name, codes, words, flights, routes, photos, numbers, weather - its lists empty, its figures none (true / false kept); nothing it would fetch after',
      !/Teesside|MME|EGNV|Durham|teessideairport|LS123|MME-AMS|p\.jpg/.test(str) && pg.props.photos.length === 0 && pg.props.boards.arrivals.length === 0 && pg.props.about.destinations === null && pg.props.about.hasLounge === true && pg.props.weather === null && pg.props.reviews.rating === null && Object.keys(pg.deferredProps).length === 0 && pg.props.dispatcher.auth.isLoggedIn === true, str.slice(0, 400));
    H.statsUnlock(pg);
    check('... its runways table unlocked before FR24 draws it (no frame cutting it short, no padlock over FR24\'s made-up runways): filled as FR24\'s own airports\' are', pg.props.locked.runways === false && pg.props.tlUnlocked.runways === true && Array.isArray(pg.props.runways));
    const fr = JSON.parse(JSON.stringify(ref)); fr.props.airport.iata = 'LPL'; fr.props.airport.id = 2002; H.statsUnlock(fr);
    check('FR24\'s own airport page too: its runways table unlocked before it is drawn (an airport of many runways was cut off as the week\'s movements were)', fr.props.locked.runways === false && fr.props.locked.events === false && fr.props.tlUnlocked.runways === true);
    w.close(); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
