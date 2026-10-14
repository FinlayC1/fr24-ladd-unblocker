// 22.19 - the BUILT userscript in jsdom with a shared monitor (made up here, offline): only the shared monitor is asked
// once one is set (never this computer's 127.0.0.1); its live list (/live) is the LADD / military list - no adsb.lol or
// adsb.fi list request of the browser's own while it is fresh, the browser's own when it is stale; a blocked FR24 flight
// identified from it; flight logs taken from the monitor's rebuilt days (/hist) without asking adsb.lol for those days -
// the SAME flights the browser makes of adsb.lol's traces itself; several aircraft in one request; a /hist of another log
// version, or a day whose flights did not all come, not used.
// usage: node test/unit_monlive.cjs <node_modules dir> <data dir>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const FXL = path.join(__dirname, 'fixtures', 'legs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8'), OA = fs.existsSync(path.join(DATA, 'oa_airports.csv')) ? fs.readFileSync(path.join(DATA, 'oa_airports.csv'), 'utf8') : '';
const RWY = JSON.parse(fs.readFileSync(path.join(DATA, 'runways.json'), 'utf8')), RWL = fs.existsSync(path.join(DATA, 'runway_len.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'runway_len.json'), 'utf8')) : null;
const fxTrace = (hex, d) => { const f = path.join(FXL, hex, d + '_lol.json.gz'); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : null; };

// ---- the monitor's /hist for M-ARNZ, built by the real monitor code from the same fixtures (6 and 7 Oct), plus a day
// watched with no flights (5 Oct)
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monlive-'));
const M = require('../monitor/monitor.cjs');
M.loadEngine();
global.fetch = async url => { const m = /globe_history\/(\d{4})\/(\d\d)\/(\d\d)\/traces\/..\/trace_full_([0-9a-f]{6})\.json/.exec(url), t = m && /adsb\.lol/.test(url) && fxTrace(m[4], `${m[1]}-${m[2]}-${m[3]}`); return t ? { status: 200, text: async () => t } : { status: 404, text: async () => '' }; };

// ---- what each window's network answers (nothing leaves this process)
function makeNet(mon) {
  const asked = [];
  const answer = (url, headers) => {
    asked.push({ url, headers: headers || {} });
    let m;
    if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return { status: 200, text: AIRPORTS };
    if (/ourairports-data\/main\/airports\.csv/.test(url)) return { status: OA ? 200 : 404, text: OA };
    if (/^https:\/\/mon\.test\//.test(url)) return mon(url, headers || {});
    if (/127\.0\.0\.1:47524/.test(url)) return { status: 0, error: true };
    if (/opendata\.adsb\.fi\/api\/v3\/lat\//.test(url)) return makeNet.fiV3 ? { status: 200, text: JSON.stringify({ aircraft: [{ hex: '400fff', r: 'G-FIV3', t: 'C172', lat: 53, lon: -2, alt_baro: 2000, gs: 90, track: 10, seen_pos: 1 }] }) } : { status: 404, text: '' };
    if (/opendata\.adsb\.fi\/api\/v2\/lat\//.test(url)) return { status: 200, text: JSON.stringify({ aircraft: [{ hex: '400ff2', r: 'G-FIV2', t: 'C172', lat: 53, lon: -2, alt_baro: 2000, gs: 90, track: 10, seen_pos: 1 }] }) };
    if (/api\.adsb\.lol\/v2\/ladd$/.test(url)) return { status: 200, text: JSON.stringify({ now: Date.now(), ac: [{ hex: 'a0b0c0', r: 'N900OWN', t: 'GLF6', dbFlags: 8, lat: 10, lon: 10, alt_baro: 41000, gs: 480, track: 90, seen_pos: 1 }] }) };
    if (/api\.adsb\.lol\/v2\/mil$|opendata\.adsb\.fi\/api\/v2\/mil$/.test(url)) return { status: 200, text: JSON.stringify({ now: Date.now(), ac: [{ hex: 'ae1111', r: 'OWN-MIL', t: 'C17', dbFlags: 1, lat: 11, lon: 11, alt_baro: 30000, gs: 420, track: 0, seen_pos: 1 }] }) };
    if ((m = /adsb\.lol\/globe_history\/(\d{4})\/(\d\d)\/(\d\d)\/traces\/..\/trace_full_([0-9a-f]{6})\.json/.exec(url))) { const t = fxTrace(m[4], `${m[1]}-${m[2]}-${m[3]}`); return t ? { status: 200, text: t } : { status: 404, text: '' }; }
    return { status: 404, text: '' };
  };
  return { asked, answer };
}
function makeWin(net, idb) {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53.40,-2.60/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = idb || new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const a = net.answer(u, init && init.headers); return Promise.resolve(new Response(a.text || '', { status: a.status || 404 })); };
  win.GM_xmlhttpRequest = o => {
    const a = net.answer(o.url, o.headers);
    setTimeout(() => { if (a.error) o.onerror && o.onerror({ error: 'refused' }); else o.onload && o.onload({ status: a.status, responseText: a.text, response: a.text }); }, 2);
    return { abort() {} };
  };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = () => {};
  win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}
const sameDayFlights = l => `${l.from ? l.from.code : '?'}-${l.to ? l.to.code : '?'}@${Math.round(l.tStart)}/${Math.round(l.tEnd)}/${l.how}`;
(async () => {
  for (const d of ['2026-10-06', '2026-10-07']) await M.histDay('424c60', d, JSON.parse(fxTrace('424c60', d)));
  const H = M.histRead('424c60');
  // (one more aircraft with only a day of no flights, for the batch)
  const histOf = hex => hex === '424c60' ? { hex, days: Object.assign({ '2026/10/05': 0 }, H.days), legs: H.legs } : { hex, days: { '2026/10/05': 0 }, legs: [] };
  let live = null, hv = 5, histReq = [];
  const now0 = Date.now();
  const mon = (url, headers) => {
    if (headers['X-Monitor-Token'] !== 'tok') return { status: 401, text: '' };
    const u = new URL(url);
    if (u.pathname === '/status') return { status: 200, text: JSON.stringify({ v: 3 }) };
    if (u.pathname === '/live') return { status: 200, text: JSON.stringify(live) };
    if (u.pathname === '/hist') { const hs = u.searchParams.get('hex').split(','); histReq.push(hs); return { status: 200, text: JSON.stringify({ hv, list: hs.map(histOf) }) }; }
    if (u.pathname === '/ladd') return { status: 200, text: JSON.stringify({ at: 0, ac: [] }) };
    return { status: 200, text: '{}' };
  };
  const net = makeNet(mon), w = makeWin(net), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  check('airports loaded (from the data folder - offline)', L.engine.airports.length > 5000, L.engine.airports.length);
  L.engine.setRunways(RWY); if (RWL) L.engine.setRunwayLengths(RWL);
  await L.store.kvReady;
  // ---- the shared monitor only --------------------------------------------------------------------------------------
  L.store.kvSet('monRemote', { url: 'https://mon.test', token: 'tok' });
  net.asked.length = 0;
  await L.monCheck(true).catch(() => {});
  check('a shared monitor set and answering: used, asked with its secret', L.monUp() && net.asked.some(a => a.url === 'https://mon.test/status' && a.headers['X-Monitor-Token'] === 'tok'));
  check('... this computer\'s monitor (127.0.0.1) never asked', !net.asked.some(a => /127\.0\.0\.1/.test(a.url)), net.asked.map(a => a.url));
  // ---- /live as the list ---------------------------------------------------------------------------------------------
  const ts = Date.now();
  live = { v: 1, now: ts, age: { ladd: 12, mil: 30, pia: 60, hex: 20 }, ac: [
    { hex: '424c60', r: 'M-ARNZ', t: 'PC24', dbFlags: 0, lat: 53.75, lon: -3.05, alt_baro: 9000, gs: 250, track: 180, seen_pos: 3, flight: 'VSB92' },
    { hex: 'a1b2c3', r: 'N1848T', t: 'C68A', dbFlags: 8, lat: 46.5, lon: -110.2, alt_baro: 43000, gs: 517, track: 95, seen_pos: 2 },
    { hex: 'ae2222', r: '05-5140', t: 'C17', dbFlags: 1, lat: 52.0, lon: -1.0, alt_baro: 28000, gs: 430, track: 270, seen_pos: 4, _from: [1, 'ground'], _off: 1 }] };
  await until(() => !L.globalList.loading, 30000); await L.refreshLists(true).catch(() => {});   // (the load the page began at start, before the monitor was set)
  net.asked.length = 0;
  await L.refreshLists(true);
  const own = net.asked.filter(a => /api\.adsb\.lol\/v2\/(ladd|mil)|adsb\.fi\/api\/v2\/mil/.test(a.url));
  check('the monitor\'s live list fresh: it is the LADD / military list (all three aircraft, source "monitor")', L.globalList.src === 'monitor' && ['424c60', 'a1b2c3', 'ae2222'].every(h => L.globalList.byHex.has(h)), [...L.globalList.byHex.keys()]);
  check('... and the browser asks adsb.lol / adsb.fi for no list itself', own.length === 0, own.map(a => a.url));
  const c = L.globalList.byHex.get('a1b2c3');
  check('... its rows read as adsb.lol\'s (LADD flag, type, position, age)', c.ladd === true && c.type === 'C68A' && c.reg === 'N1848T' && c.ageS === 2 && Math.abs(c.receivedAt - Date.now()) < 5000, { ladd: c.ladd, type: c.type, ageS: c.ageS });
  // a blocked FR24 flight right where the list has N1848T: identified from it, without any request
  { const id = 0x7a5a5a10, f = { id, lat: 46.5, lon: -110.19, alt: 43000, spd: 517, trk: 95, type: 'C68A', reg: '', cs: '', receivedAt: Date.now(), ts: Date.now() / 1000, serverTime: Date.now() };
    L.pending.set(id, f); net.asked.length = 0;
    await L.sweep();
    const r = L.live.get(id);
    check('a blocked FR24 flight identified from the monitor\'s live list', !!r && r.hex === 'a1b2c3' && r.reg === 'N1848T', r && { hex: r.hex, reg: r.reg, sources: r.sources });
    L.pending.delete(id); }
  // LADD list stale on the monitor: the browser's own LADD (and military) list
  live = Object.assign({}, live, { age: { ladd: 200, mil: 30 } });
  net.asked.length = 0; await L.refreshLists(true);
  check('the monitor\'s LADD list stale (200 s): the browser asks for its own lists', net.asked.some(a => /api\.adsb\.lol\/v2\/ladd$/.test(a.url)) && L.globalList.byHex.has('a0b0c0') && L.globalList.src !== 'monitor', net.asked.map(a => a.url).filter(u => /v2/.test(u)));
  // only its military list stale: the browser's own military list, not the LADD list
  live = Object.assign({}, live, { age: { ladd: 10, mil: 900 } });
  net.asked.length = 0; await L.refreshLists(true);
  const urls = net.asked.map(a => a.url);
  check('only the monitor\'s military list stale: the browser\'s own military list, not its LADD list', urls.some(u => /api\.adsb\.lol\/v2\/mil$/.test(u)) && !urls.some(u => /v2\/ladd$/.test(u)) && L.globalList.byHex.has('ae1111') && L.globalList.byHex.has('a1b2c3'), urls.filter(u => /v2/.test(u)));
  // (the 20-s round in between: a newer position replaces the older; the list counts as fresh, so no round of the browser's own)
  { live = Object.assign({}, live, { now: Date.now(), age: { ladd: 5, mil: 20 }, ac: live.ac.map(a => a.hex === 'a1b2c3' ? Object.assign({}, a, { lon: -109.9, seen_pos: 0 }) : a) });
    const at0 = L.globalList.at; net.asked.length = 0;
    const moved = await until(() => { const x = L.globalList.byHex.get('a1b2c3'); return x && x.lon === -109.9; }, 30000);
    check('every 20 s the monitor\'s live list again: the newer position taken, the list fresh, no list request of the browser\'s own', !!moved && L.globalList.at > at0 && !net.asked.some(a => /v2\/(ladd|mil)$/.test(a.url)), net.asked.map(a => a.url)); }
  { const fi = L.liveSources().find(x => x.name === 'adsb.fi');
    makeNet.fiV3 = true; net.asked.length = 0; const a = await fi.area(53, -2, 50);
    const u1 = net.asked.map(x => x.url).filter(u => /adsb\.fi/.test(u));
    makeNet.fiV3 = false; net.asked.length = 0; const b = await fi.area(53, -2, 50);
    const u2 = net.asked.map(x => x.url).filter(u => /adsb\.fi/.test(u));
    check('adsb.fi areas: its v3 query first; v2 (deprecated) only when v3 is not found', a[0].reg === 'G-FIV3' && u1.length === 1 && /\/v3\/lat\//.test(u1[0]) && b[0].reg === 'G-FIV2' && u2.length === 2 && /\/v2\/lat\//.test(u2[1]), { u1, u2 }); }
  check('the sources pop-over figures: the live list\'s size and freshness', L.monLive.n === 3 && L.monLive.ok === true && Date.now() - L.monLive.at < 10000, L.monLive);
  // ---- flight logs from the monitor --------------------------------------------------------------------------------
  // (back as far as the fixture days - 5 Oct 2026 - and two more; adsb.lol keeps 40 days, the browser asks airplanes.live
  // beyond: past that the log checks cannot run as they are)
  const N = Math.max(12, Math.ceil((now0 - Date.parse('2026-10-05T00:00:00Z')) / 864e5) + 2);
  const days = (now => { const o = []; for (let b = 1; b <= N; b++) o.push(new Date(now - b * 864e5).toISOString().slice(0, 10).replace(/-/g, '/')); return o; })(now0);
  if (N > 40) { console.log('(skipped the flight-log checks: the fixture days are more than 40 days back now)'); console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0); }
  // (the monitor keeps the days of blocked aircraft only: an ordinary aircraft's log is not asked of it)
  histReq = []; await L.loadHistory('400aaa', 3, null, {});
  check('an ordinary aircraft\'s log: the monitor not asked', histReq.length === 0, histReq);
  for (const h of ['424c60', 'b0b0b0', 'c0c0c0', 'd0d0d0']) L.store.mergeHex(h, { hex: h, ladd: true });
  net.asked.length = 0; histReq = [];
  await Promise.all([L.loadHistory('424c60', N, null, { front: true }), L.loadHistory('b0b0b0', N, null, {}), L.loadHistory('c0c0c0', N, null, {})]);
  const traceAsk = d => net.asked.some(a => new RegExp('adsb\\.lol/globe_history/' + d.replace(/\//g, '\\/') + '/traces/60/trace_full_424c60').test(a.url));
  check('three aircraft\'s logs asked for in one /hist request', histReq.length === 1 && histReq[0].length === 3, histReq);
  check('the days the monitor has: no request to adsb.lol for them (5, 6, 7 Oct)', !traceAsk('2026/10/05') && !traceAsk('2026/10/06') && !traceAsk('2026/10/07'), net.asked.filter(a => /424c60/.test(a.url)).map(a => a.url.slice(30, 52)));
  check('... the days it has not: asked for as before', days.filter(d => !['2026/10/05', '2026/10/06', '2026/10/07'].includes(d)).every(traceAsk));
  check('... the aircraft with only a day of no flights: that day not asked for, the rest asked for', !net.asked.some(a => /2026\/10\/05\/traces\/b0\/trace_full_b0b0b0/.test(a.url)) && net.asked.some(a => /trace_full_b0b0b0/.test(a.url)));
  const hm = await L.store.getHist('424c60');
  // the same aircraft, the same days, in a browser with no monitor: its own log from adsb.lol's traces
  const net2 = makeNet(() => ({ status: 500, text: '' })), w2 = makeWin(net2), L2 = w2.__tweeksLadd;
  await until(() => L2 && L2.engine.airports.length > 5000, 60000);
  L2.engine.setRunways(RWY); if (RWL) L2.engine.setRunwayLengths(RWL);
  await L2.store.kvReady; await L2.loadHistory('424c60', N, null, { front: true });
  const hb = await L2.store.getHist('424c60');
  for (const d of ['2026/10/06', '2026/10/07']) {
    const a = hm.legs.filter(l => l.day === d).sort((x, y) => x.tStart - y.tStart).map(sameDayFlights), b = hb.legs.filter(l => l.day === d).sort((x, y) => x.tStart - y.tStart).map(sameDayFlights);
    check(`M-ARNZ ${d}: the log from the monitor = the log the browser builds from adsb.lol itself`, a.length === 4 && a.join() === b.join(), { monitor: a, browser: b });
  }
  const one = hm.legs.find(l => l.day === '2026/10/07'), oneB = hb.legs.find(l => l.day === '2026/10/07' && Math.round(l.tStart) === Math.round(one.tStart));
  const keys = o => Object.keys(o).filter(k => k !== 'lx').sort().join();
  check('... the same fields (path, take-off and landing times...), no monitor-only field left in the log', !!oneB && keys(one) === keys(oneB) && !('lx' in one) && JSON.stringify(one.path) === JSON.stringify(oneB.path) && one.tOn === oneB.tOn && one.tOff === oneB.tOff, { m: keys(one), b: oneB && keys(oneB) });
  check('... and the days marked done, so not asked for again', hm.days['2026/10/06'] && hm.days['2026/10/07'] && hm.days['2026/10/05']);
  // ---- not used: another log version; a day whose flights did not all come -------------------------------------------
  hv = 4; net.asked.length = 0;
  await L.loadHistory('d0d0d0', N, null, {});
  check('a /hist of another log version: not used (adsb.lol asked for every day)', days.every(d => net.asked.some(a => a.url.includes(d + '/traces/d0/trace_full_d0d0d0'))));
  hv = 5;
  const keep = H.legs; H.legs = H.legs.filter(l => !(l.day === '2026/10/06' && l.tStart === Math.min(...H.legs.filter(x => x.day === '2026/10/06').map(x => x.tStart))));
  net.asked.length = 0;
  const hx = 'e0e0e0', histOf0 = histOf;
  void histOf0;
  // (as 424c60's answer, under another address: 6 Oct says 4 flights, 3 came)
  const mon2 = (url, headers) => { const u = new URL(url); if (u.pathname === '/hist') return { status: 200, text: JSON.stringify({ hv: 5, list: [{ hex: hx, days: H.days, legs: H.legs }] }) }; return mon(url, headers); };
  const net3 = makeNet(mon2), w3 = makeWin(net3), L3 = w3.__tweeksLadd;
  await until(() => L3 && L3.engine.airports.length > 5000, 60000);
  await L3.store.kvReady; L3.store.kvSet('monRemote', { url: 'https://mon.test', token: 'tok' }); L3.store.mergeHex(hx, { hex: hx, ladd: true }); await L3.monCheck(true).catch(() => {});
  await L3.loadHistory(hx, N, null, {});
  check('a day whose flights did not all come from the monitor: asked from adsb.lol (the complete day from the monitor not)', net3.asked.some(a => a.url.includes('2026/10/06/traces/e0/trace_full_' + hx)) && !net3.asked.some(a => a.url.includes('2026/10/07/traces/e0/trace_full_' + hx)));
  H.legs = keep;
  // ---- a page just opened (the setting kept from before): its first log load waits for the monitor's check ----------
  { const idb5 = new FIDB.IDBFactory(), n0 = makeNet(mon), w0 = makeWin(n0, idb5), P0 = w0.__tweeksLadd;
    await P0.store.kvReady; P0.store.kvSet('monRemote', { url: 'https://mon.test', token: 'tok' }); P0.store.mergeHex('424c60', { hex: '424c60', ladd: true }); P0.store.flushNow(); await sleep(500);
    const n5 = makeNet(mon), w5 = makeWin(n5, idb5), P5 = w5.__tweeksLadd;
    await until(() => P5 && P5.engine.airports.length > 5000, 60000); histReq = [];
    await P5.loadHistory('424c60', N, null, { front: true });
    check('a page just opened: the first log load uses the monitor (its check awaited), not adsb.lol, for the days it has', histReq.length === 1 && !n5.asked.some(a => /2026\/10\/07\/traces\/60\/trace_full_424c60/.test(a.url)), { hist: histReq, lol: n5.asked.filter(a => /trace_full_424c60/.test(a.url)).length }); }
  // ---- the shared monitor down: still never this computer's ----------------------------------------------------------
  // (the setting saved in one page, then a page opened afresh - as after a reload)
  const idb = new FIDB.IDBFactory(), net0 = makeNet(() => ({ status: 502, text: '' })), w0 = makeWin(net0, idb), L0 = w0.__tweeksLadd;
  await L0.store.kvReady; L0.store.kvSet('monRemote', { url: 'https://mon.test', token: 'tok' }); L0.store.flushNow(); await sleep(500);
  const net4 = makeNet(() => ({ status: 502, text: '' })), w4 = makeWin(net4, idb), L4 = w4.__tweeksLadd;
  await L4.store.kvReady; await sleep(3000);
  await L4.monCheck(true).catch(() => {});
  check('the shared monitor not answering: not used - and this computer\'s 127.0.0.1 still not asked', !L4.monUp() && net4.asked.some(a => /mon\.test\/status/.test(a.url)) && !net4.asked.some(a => /127\.0\.0\.1/.test(a.url)), net4.asked.map(a => a.url));
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
