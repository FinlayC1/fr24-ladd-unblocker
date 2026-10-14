// 22.15: the BUILT userscript in jsdom - FR24's map playback (its real Playback / PlaybackFlight answers of 9 Oct 12:35Z
// with M-ARNZ's blocked PC-24 off Blackpool, adsb.lol's heatmap slice and M-ARNZ's track of that day as fixtures), FR24's
// airline / airport lists (BAE logo, learned landing places), categories, operators by name, the boards' guessed ends,
// learned landing places on boards, and the airport routes page. FR24's airport list and OurAirports come from the network.
// usage: node test/unit_v2215.cjs <node_modules dir>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const NM = process.argv[2];
const { JSDOM } = require(path.join(NM, 'jsdom'));
const { indexedDB, IDBKeyRange } = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const FX = path.join(__dirname, 'fixtures');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { execFile } = require('child_process');
const curlFetch = url => new Promise((res, rej) => execFile('curl', ['-s', '-g', '--compressed', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64e6, encoding: 'buffer' }, (err, out) => { if (err) return rej(err); const s2 = out.toString('utf8'); const i = s2.lastIndexOf('\n'); res(new Response(s2.slice(0, i), { status: Number(s2.slice(i + 1)) || 0, headers: { 'content-type': 'application/json' } })); }));
async function netFetch(url, init) {
  if (/flightradar24\.com/.test(url)) return curlFetch(url);
  return fetch(url, { headers: Object.assign({ 'User-Agent': UA }, (init && init.headers) || {}), method: (init && init.method) || 'GET', body: init && init.body });
}
const pbFx = JSON.parse(fs.readFileSync(path.join(FX, 'playback_1235.json'), 'utf8'));
const heatBuf = zlib.gunzipSync(fs.readFileSync(path.join(FX, 'heat_20261009_25_slice.bin.gz')));
let L = null, H = null;
const ids = {};
// (the monitor, as the routes page asks it: M-ARNZ's two flights of 9 Oct at Barrow)
function monStub(url) {
  if (/\/board\?ap=/.test(url) && ids.bwf && ids.fab) return { aircraft: [{ hex: '424c60', reg: 'M-ARNZ', type: 'PC24', ladd: true, legs: [
    { from: { id: ids.bwf, code: 'BWF', conf: 'ground' }, to: { id: ids.fab, code: 'FAB', conf: 'ground' }, tStart: ids.t - 9000, tOff: ids.t - 8900, tEnd: ids.t - 6200, tOn: ids.t - 6300, ended: true, startedOnGround: true, startLat: 54.13, startLon: -3.26, endLat: 51.28, endLon: -0.77 },
    { from: { id: ids.fab, code: 'FAB', conf: 'ground' }, to: { id: ids.bwf, code: 'BWF', conf: 'ground' }, tStart: ids.t - 3600, tOff: ids.t - 3500, tEnd: ids.t - 300, tOn: ids.t - 400, ended: true, startedOnGround: true, startLat: 51.28, startLon: -0.77, endLat: 54.13, endLon: -3.26 }] }] };
  if (/\/flights\?cs=VSB96/i.test(url) && ids.bwf && ids.fab) return { list: [
    { hex: '424c60', reg: 'M-ARNZ', type: 'PC24', cs: 'VSB96', ladd: true, from: { id: ids.fab, code: 'FAB', conf: 'ground' }, to: { id: ids.bwf, code: 'BWF', conf: 'ground' }, tStart: ids.t - 3600, tOff: ids.t - 3500, tEnd: ids.t - 300, tOn: ids.t - 400, ended: true, startedOnGround: true },
    { hex: '424c60', reg: 'M-ARNZ', type: 'PC24', cs: 'VSB96', ladd: true, from: { id: ids.bwf, code: 'BWF', conf: 'ground' }, to: { id: ids.fab, code: 'FAB', conf: 'ground' }, tStart: ids.t - 9000, tOff: ids.t - 8900, tEnd: ids.t - 6200, tOn: ids.t - 6300, ended: true, startedOnGround: true }] };
  return /\/status/.test(url) ? { v: 2 } : {};
}
// (OpenStreetMap's answers around three landing places of Merseyside, saved: Greenbank Helipad, Aintree Racecourse's
// pad, Axis Business Park's pad - the last from the mirror, which has no "lies in")
const OSM_FX = { greenbank: [53.5238, -2.9572], aintree: [53.4772, -2.9425], axis: [53.4660, -2.8960] };
function osmStub(url) {
  const q = decodeURIComponent(String(url).split('data=')[1] || ''), m = /around:\d+,(-?[\d.]+),(-?[\d.]+)/.exec(q);
  const k = m && Object.keys(OSM_FX).find(n => Math.abs(OSM_FX[n][0] - m[1]) < 0.002 && Math.abs(OSM_FX[n][1] - m[2]) < 0.002);
  return k ? fs.readFileSync(path.join(FX, 'osm', 'osm_' + k + '.json'), 'utf8') : JSON.stringify({ elements: [] });
}
// (FR24's airport schedule as free accounts page it: a flight every half hour each way, the 100 before "now" per page back)
function schedStub(url) {
  const u = decodeURIComponent(url), mode = /mode\]=(arrivals|departures)/.exec(u)[1], page = Number(/[?&]page=(-?\d+)/.exec(u)[1]), now = Number(/timestamp\]=(\d+)/.exec(u)[1]);
  const k = mode === 'arrivals' ? 'arrival' : 'departure', step = 1800, off = mode === 'arrivals' ? 0 : 900;
  const ts = page < 0 ? Array.from({ length: 100 }, (_, i) => now - off - ((-page - 1) * 100 + i + 1) * step) : Array.from({ length: 100 }, (_, i) => now + (i + 1) * step);
  const data = ts.map(t => ({ flight: { identification: { id: mode + t }, time: { scheduled: { [k]: t }, real: { [k]: t < now - 300 ? t + 300 : null } } } }));
  return JSON.stringify({ result: { response: { airport: { pluginData: { schedule: { [mode]: { page: { current: Math.abs(page), total: 3 }, data } } } } } } });
}
function gmLocal(url) {
  let m;
  if (/overpass/.test(url)) return { status: 200, text: osmStub(url) };
  if (/common\/v1\/airport\.json/.test(url) && /schedule/.test(decodeURIComponent(url))) return { status: 200, text: schedStub(url) };
  if ((m = /adsb\.lol\/globe_history\/(\d{4})\/(\d\d)\/(\d\d)\/traces\/..\/trace_full_([0-9a-f]{6})\.json/.exec(url))) { const f = path.join(FX, 'legs', m[4], `${m[1]}-${m[2]}-${m[3]}_lol.json.gz`); return fs.existsSync(f) ? { status: 200, text: zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') } : { status: 404, text: '' }; }
  if (/globe\.airplanes\.live\/globe_history|adsb\.lol\/data\/traces/.test(url)) return { status: 404, text: '' };
  if (/adsb\.lol\/globe_history\/2026\/10\/09\/heatmap\/25\.bin\.ttf/.test(url)) return { status: 200, bin: heatBuf };
  if (/adsb\.lol\/globe_history\/.*\/heatmap\//.test(url)) return { status: 404, text: '' };
  if (/^https:\/\/mon\.test\//.test(url)) return { status: 200, text: JSON.stringify(monStub(url)) };
  if (/api\.adsb\.lol|opendata\.adsb\.fi|hexdb|adsbdb|planespotters|jetphotos|ginfoapi|faa\.gov|opensky|aviationweather/.test(url)) return { status: 404, text: '' };
  return null;
}
// one FR24 tab: its own window, the shared IndexedDB and tabs' channel (as a browser's tabs of one site)
function makeWin(url, html, onHook) {
  const win = new JSDOM(html || '<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = indexedDB; win.IDBKeyRange = IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = BroadcastChannel;
  win.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const loc = gmLocal(u); if (loc) return Promise.resolve(new Response(loc.text || '', { status: loc.status })); return netFetch(u, init); };
  win.GM_xmlhttpRequest = o => {
    const loc = gmLocal(o.url);
    if (loc) { setTimeout(() => { if (o.responseType === 'arraybuffer') o.onload && o.onload({ status: loc.status, response: loc.bin ? loc.bin.buffer.slice(loc.bin.byteOffset, loc.bin.byteOffset + loc.bin.byteLength) : null }); else o.onload && o.onload({ status: loc.status, responseText: loc.text, response: loc.text }); }, 1); return { abort() {} }; }
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), o.timeout || 20000);
    netFetch(o.url, { headers: o.headers, method: o.method, body: o.data }).then(r => r.text().then(t => { clearTimeout(tm); o.onload && o.onload({ status: r.status, responseText: t, response: t }); })).catch(e => { clearTimeout(tm); o.onerror && o.onerror({ error: String(e) }); });
    return { abort() { ctl.abort(); } };
  };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.__posted = [];
  win.postMessage = data => { win.__posted.push(data); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.__logs = []; win.console.debug = (...a) => win.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); win.console.error = (...a) => win.__logs.push('ERROR ' + a.join(' '));
  win.__tlTestHook = onHook || (() => {});
  return win;
}
const w = makeWin('https://www.flightradar24.com/2026-10-09/12:35/1x/53.40,-2.60/9', null, h => { H = h; });
const posted = w.__posted;
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const b64 = s => new Uint8Array(Buffer.from(s, 'base64'));
const body = fr => { const len = ((fr[1] << 24) | (fr[2] << 16) | (fr[3] << 8) | fr[4]) >>> 0; return fr.subarray(5, 5 + len); };
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await sleep(100); } return f(); };
(async () => {
  w.eval(SRC);
  L = w.__tweeksLadd;
  await until(() => L.engine.airports.length > 5000, 60000);
  check('airports loaded', L.engine.airports.length > 5000, L.engine.airports.length);
  // (the monitor on a server - made up here: kept in the shared store, so the later pages have it too)
  await L.store.kvReady; L.store.kvSet('monRemote', { url: 'https://mon.test', token: 'tok' }); L.store.flushNow(); await L.monCheck(true).catch(() => {});
  ids.bwf = L.engine.byIcao('EGNL').id; ids.fab = L.engine.byIcao('EGLF').id; ids.lpl = L.engine.byIcao('EGGP').id; ids.man = L.engine.byIcao('EGCC').id; ids.t = Math.floor(Date.now() / 1000);

  // ---- FR24's airline list: BAE Systems' airlines get their logo; one FR24 has stays as it is
  const filler = n => Array.from({ length: n }, (_, i) => ({ id: 100000 + i, name: 'Filler ' + i, icao: '', iata: '' }));
  { const j = { version: 1, rows: [{ id: 583, icao: 'BAE', name: 'BAe Systems', metadata: null }, { id: 1418, icao: 'RVR', name: 'Ravenair', metadata: { images: { logotypes: { default: { file: { source: 'https://x/1418.png' } } } } } }].concat(filler(120)) };
    H.patchList('airlines', j);
    const bae = j.rows.find(r => r.id === 583), rv = j.rows.find(r => r.id === 1418);
    check('BAE Systems: a logo in FR24\'s own airline list (boards, search draw it from there)', /BAE_Systems_logo/.test(bae.metadata.images.logotypes.default.file.source) && rv.metadata.images.logotypes.default.file.source === 'https://x/1418.png' && /BAE_Systems_logo/.test(H.logoOf(3046)), bae.metadata); }
  // ---- categories (HZ-AR27's 787-10 was a "Business jet")
  { const c = t => L.fr24Cat({ type: t }); const got = { B78X: c('B78X'), A320: c('A320'), H160: c('H160'), PC24: c('PC24'), P28A: c('P28A'), DH8D: c('DH8D'), BE20: c('BE20'), C17: L.fr24Cat({ type: 'C17', mil: true }) };
    check('FR24 category ids from the type: airliners passenger, H160 helicopter, PC-24 business jet, PA-28 GA, Dash 8 passenger, King Air other (as on FR24\'s own card), C-17 military', got.B78X === 0 && got.A320 === 0 && got.H160 === 5 && got.PC24 === 3 && got.P28A === 4 && got.DH8D === 0 && got.BE20 === 10 && got.C17 === 2, got);
    check('... and the page uses it on its cards', H.categoryOf({ type: 'B78X', fcat: 0 }) === 0 && H.categoryOf({ type: 'H160' }) === 5); }
  // ---- operators by name: Ravenair's logo for G-RVRN, BAE's for its shuttles
  { L.fr24.airlines = new Map([[1418, { id: 1418, name: 'Ravenair' }], [583, { id: 583, name: 'BAe Systems' }]]); L.fr24.byName.set('ravenair', 1418); L.fr24.byName.set('baesystems', 583); L.fr24.byIcao.set('BAE', 583);
    const a = L.airlineIdByName('RAVENAIR AVIATION LIMITED'), b = L.airlineIdByName('BAE SYSTEMS (OPERATIONS) LIMITED'), c = L.operatorIdOf({ owner: 'Some Private Person' }, 'BAE12'), d = L.airlineIdByName('Air Ltd');
    check('operator id by name (Ravenair Aviation -> Ravenair), by callsign (BAE12 -> BAE Systems); a short name is no match', a === 1418 && b === 583 && c === 583 && !d, { a, b, c, d }); }
  // ---- boards: an end only guessed from far away is no board row (HZ-AR27 first heard at FL170 80 km out)
  { const t = ids.t - 7200, mk = (lat, lon) => ({ tStart: t, tEnd: t + 3000, tOff: t - 600, from: { id: ids.lpl, code: 'LPL', conf: 'near' }, to: { id: ids.man, code: 'MAN', conf: 'ground' }, ended: true, startedOnGround: false, startLat: lat, startLon: lon, endLat: 53.35, endLon: -2.27 });
    L.boardNoteLegs('7105ae', [mk(52.815, -1.954)], { reg: 'HZ-AR27', type: 'B78X' });
    L.boardNoteLegs('7105af', [mk(53.30, -2.75)], { reg: 'G-TEST', type: 'B738' });
    await L.boardDrain();
    const dep = Object.values((L.boardMem.get(ids.lpl) || { dep: {} }).dep);
    check('a departure guessed 80 km out is not on that airport\'s board; one first heard 7 km out is', !dep.some(r => r.hex === '7105ae') && dep.some(r => r.hex === '7105af'), dep.map(r => r.hex));
    check('... and a row kept of it by an older build is dropped', dep.some(r => /^h7105ae:/.test(r.k) && r.drop), dep.filter(r => /^h7105ae:/.test(r.k))); }
  // ---- landing places learned
  { await L.loadSites();
    const s1 = L.learnSite(53.6012, -2.5823, { heli: false }), s2 = L.learnSite(53.6020, -2.5830, { heli: false }), a = L.apById ? null : null;
    const bk = L.siteBk(), row = bk && bk.list.find(s => s.id === s1);
    check('a landing place away from FR24\'s airports: a lasting id and a name, the same for the same spot', s1 > 9e6 && s1 === s2 && L.siteIdAt(53.6015, -2.5825) === s1 && !!row && /\S/.test(row.name), row && { id: row.id, name: row.name, city: row.city, code: row.code });
    // a light aircraft from Liverpool down there: Liverpool's departure row names the place, not "N/A"
    const t = ids.t - 5400;
    L.boardNoteLegs('aaa001', [{ tStart: t, tEnd: t + 1500, tOff: t + 60, from: { id: ids.lpl, code: 'LPL', conf: 'ground' }, to: null, how: 'ground', ended: true, startedOnGround: true, startLat: 53.333, startLon: -2.85, endLat: 53.6013, endLon: -2.5822 }], { reg: 'G-RVRN', type: 'P28A' });
    await L.boardDrain();
    const r = Object.values(L.boardMem.get(ids.lpl).dep).find(x => x.hex === 'aaa001');
    check('... on the board: the departure to it has it as the other end', !!r && r.ap === s1, r && { ap: r.ap });
    const sent = await until(() => posted.slice().reverse().find(p => p && p.__tweeksLadd === 'sites'), 6000);
    check('... and goes to the page for FR24\'s airport list', !!sent && sent.list.some(x => x.id === s1 && x.iata && x.timezone && x.countryId), sent && sent.list.slice(0, 2));
    H.acceptSites([]); const sig0 = H.listSig('airports'); H.acceptSites(sent.list);
    const j = { version: 1, rows: filler(150) }; H.patchList('airports', j);
    check('... added to every full airport list FR24 gets (its own copy refreshed when that changes)', j.rows.some(x => x.id === s1) && H.listSig('airports') !== sig0, H.listSig('airports'));
    // ... but never drawn on the map: FR24's 'airports' store array (its map layer) without it, its by-id lookups with it
    const acts = [], st = { airports: [], airportsById: new Map(), $onAction(f) { acts.push(f); },
      setAirports(q) { const af = []; acts.forEach(f => f({ name: 'setAirports', after: cb => af.push(cb) })); this.airports = q; this.airportsById = new Map(q.map(a => [a.id, a])); af.forEach(cb => cb()); } };
    w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['airports', st]]) } } } };
    await until(() => acts.length, 3000);
    st.setAirports([{ id: 1942, iata: 'LHR' }, { id: s1, iata: 'PVT' }]);
    check('... and kept off FR24\'s map (its airport layer\'s list), still found by id for its panel', st.airports.map(a => a.id).join() === '1942' && st.airportsById.has(s1), { layer: st.airports.map(a => a.id), hooked: acts.length }); }
  // ---- the airport routes page: Barrow's blocked flights in FR24's own lists
  { const pg = { component: 'Data/AirportRoutes', props: { airport: { id: ids.bwf }, direction: 'from', busiestRoutes: [], longestRoutes: [], routes: { current_page: 1, data: [], total: 0, to: 0 }, mapRoutes: [] } };
    w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $page: pg } } };
    const n0 = posted.length; await L.onNeedRoutes({ apId: ids.bwf });
    const ra = posted.slice(n0).find(p => p && p.__tweeksLadd === 'routesAdd');
    const bf = ra && ra.list.find(x => x.from.id === ids.bwf && x.to.id === ids.fab);
    check('routes counted for Barrow from the monitor\'s blocked flights (BWF-FAB, FAB-BWF)', !!bf && bf.n === 1 && ra.list.some(x => x.from.id === ids.fab && x.to.id === ids.bwf), ra && ra.list.map(x => [x.from.iata, x.to.iata, x.n, x.km, x.min]));
    H.routesAdd.set(ids.bwf, ra.list); H.applyRoutes(pg); H.applyRoutes(pg);
    const p = pg.props;
    check('... in FR24\'s busiest, longest, all-routes and map lists (once, however often applied)', p.busiestRoutes.length === 1 && p.busiestRoutes[0].id === 'BWF-FAB' && p.busiestRoutes[0].flights === 1 && p.longestRoutes.length === 1 && p.routes.data.length === 1 && p.routes.total === 1 && p.mapRoutes.length === 2, { busiest: p.busiestRoutes.map(x => x.id + ':' + x.flights), routes: p.routes.total, map: p.mapRoutes.map(x => x.id) });
    const merged = H.mergeRoutes([{ id: 'BWF-FAB', flights: 5 }], [{ id: 'BWF-FAB', flights: 2 }, { id: 'BWF-GLA', flights: 1 }], 'flights', 6);
    check('... a route FR24 counts too: its count raised, not listed twice', merged.length === 2 && merged[0].flights === 7 && merged[0].__tlBase === 5, merged); }
  // ---- FR24's map playback, 9 Oct 12:35Z
  { const req = H.patchPlaybackRequest(b64(pbFx.feedReq)), rp = H.parse(req.subarray(5)), lf = H.parse(rp.find(f => f.fn === 1).val), mask = lf.find(f => f.fn === 10);
    check('playback request: one field asked for (the type)', !!mask && Buffer.from(mask.val).toString('latin1').includes('type'));
    const fid = pbFx.id, n0 = posted.length;
    H.patchPlayback(body(b64(pbFx.feed)), pbFx.ts);
    const fe = posted.slice(n0).find(p => p && p.__tweeksLadd === 'pbFeed');
    check('the moment\'s unnamed flights reported as playback (not as live ones)', !!fe && fe.ts === pbFx.ts && fe.flights.some(f => f.id === fid) && !posted.slice(n0).some(p => p && p.__tweeksLadd === 'feed'), fe && fe.flights.length);
    const named = await until(() => L.pb.named.get(fid), 20000);
    check('named from the heatmap of that half hour: 424c60, M-ARNZ, LADD', !!named && named.hex === '424c60' && named.reg === 'M-ARNZ' && named.ladd, named && { hex: named.hex, reg: named.reg, cs: named.cs, ladd: named.ladd });
    const rt = await until(() => L.pb.routes.get(fid), 20000);
    const hm = t => t ? new Date(t * 1000).toISOString().slice(11, 16) : '-';
    check('its flight as flown: Barrow -> Farnborough, take-off and landing times', !!rt && rt.originIata === 'BWF' && rt.destIata === 'FAB' && rt.atd > 0 && rt.ata > rt.atd && rt.destConf === 'playback', rt && { o: rt.originIata, d: rt.destIata, atd: hm(rt.atd), ata: hm(rt.ata) });
    await until(() => H.pbRoutes.get(fid), 3000);
    const out = H.patchPlayback(body(b64(pbFx.feed)), pbFx.ts), recs = H.parse(H.parse(out).find(f => f.fn === 1).val).filter(f => f.fn === 1).map(f => H.parse(f.val)), me = recs.find(fs => fs.find(f => f.fn === 1).val === fid);
    const ex = me && me.find(f => f.fn === 13), exf = ex ? H.parse(ex.val) : [], r3 = exf.find(f => f.fn === 3), rr = r3 ? H.parse(r3.val) : [];
    const str = (fs, n) => { const f = fs.find(x => x.fn === n); return f ? Buffer.from(f.val).toString('utf8') : ''; };
    check('drawn on FR24\'s playback map as FR24 would: label, registration, route', !!me && !!str(me, 11) && str(exf, 2) === 'M-ARNZ' && str(rr, 1) === 'BWF' && str(rr, 2) === 'FAB', me && { label: str(me, 11), reg: str(exf, 2), route: str(rr, 1) + '-' + str(rr, 2) });
    // the panel of that flight in playback: its figures from the track, its airports
    w.postMessage({ __tweeksLadd: 'pbFollow', id: fid, ts: pbFx.ts }, '*');
    const tl = await until(() => H.pbTelAt(fid, pbFx.ts), 8000);
    check('the open flight\'s padlocked figures at that moment, from its track (vertical speed, GPS altitude)', !!tl && Number.isFinite(tl.vr) && Number.isFinite(tl.agps) && Math.abs(tl.agps - 25000) < 2500, tl);
    const po = H.patchFlightMsg(body(b64(pbFx.flight)), { id: fid, ts: pbFx.ts, pb: true }, H.PLAYBACK), pf = H.parse(po);
    const sc = pf.find(f => f.fn === 2), scf = sc ? H.parse(sc.val) : [], ef = H.parse(pf.find(f => f.fn === 3).val), num = (fs, n) => { const f = fs.find(x => x.fn === n); return f ? f.val : undefined; };
    check('... the playback panel: Barrow -> Farnborough, callsign, vertical speed with no padlock', num(scf, 4) === ids.bwf && num(scf, 5) === ids.fab && !!str(ef, 10) && ef.some(f => f.fn === 17) && !ef.some(f => f.fn === 16), { o: num(scf, 4), d: num(scf, 5), cs: str(ef, 10), vs: ef.some(f => f.fn === 17), lock: ef.some(f => f.fn === 16) });
    // the strip: who it was and its flight as flown, tagged "Playback"
    w.document.body.insertAdjacentHTML('beforeend', '<aside data-testid="aircraft-panel"><main><div class="first"></div><div class="grid"></div></main></aside>');
    L.syncPanel();
    const sp = await until(() => { const e = w.document.querySelector('.tl-strip'); return e && /Playback/.test(e.textContent) ? e : null; }, 4000);
    check('the strip: identified, "Playback" in red, landed at Farnborough', !!sp && !!sp.querySelector('.tl-tag-pb') && /FAB/.test(sp.textContent) && /424C60/.test(sp.textContent) && !/Predicted|Confirmed/.test(sp.textContent), sp && sp.textContent.replace(/\s+/g, ' ').trim().slice(0, 200)); }
  // ---- 22.16 -------------------------------------------------------------------------------------------------------------
  { const po = H.patchFlightMsg(body(b64(pbFx.flight)), { id: pbFx.id, ts: pbFx.ts, pb: true }, H.PLAYBACK), ef = H.parse(H.parse(po).find(f => f.fn === 3).val);
    const tl = H.pbTelAt(pbFx.id, pbFx.ts), fir = L.firAt && L.firAt(53.607, -3.128, 25000);
    check('playback panel: squawk given with no padlock flag; its airspace (FIR) at that moment', ef.some(f => f.fn === 15) && !ef.some(f => f.fn === 14) && (!fir || (!!tl && !!tl.air)), { sq: ef.some(f => f.fn === 15), lock: ef.some(f => f.fn === 14), air: tl && tl.air, fir: fir && fir.id }); }
  { const id = 0x7a5a5a07, t0 = Date.now() - 20000; H.noteTelem(id, { at: t0, vr: 0, agps: 1000, sq: 1234 }); H.noteTelem(id, { at: t0 + 4000, vr: 400, agps: 1200, sq: 1234 });
    const a = H.telAt(id, (t0 + 2000) / 1000), b = H.telAt(id, (t0 + 9000) / 1000);
    check('the public figures for the moment of FR24\'s own frame: between two reports in proportion, the latest beyond them', Math.abs(a.vr - 200) < 1 && Math.abs(a.agps - 1100) < 1 && b.vr === 400, { a: a.vr, b: b.vr }); }
  { const rw = await L.runwaysOf(L.engine.byIcao('EIDW'));
    check('Dublin\'s runways from OurAirports: each end with length, elevation and surface as FR24 codes them', rw.length >= 4 && rw.every(r => r.name && r.lengthFt > 5000 && Number.isFinite(r.elevationFt) && /^[A-Z]{3,4}$/.test(r.surface)), rw.map(r => r.name + ':' + r.lengthFt + ':' + r.surface)); }
  // a flight the map tab follows into Dublin shows on Dublin's own arrivals page in another tab - asked of the map tab
  { const dub = L.engine.byIcao('EIDW').id, ltn = L.engine.byIcao('EGGW').id, now = Math.floor(Date.now() / 1000), fid = 0x7a5a5a10;
    L.store.mergeHex('7a5a5a', { reg: 'N600JM', type: 'F900', ladd: true });
    L.live.set(fid, { id: fid, hex: '7a5a5a', reg: 'N600JM', type: 'F900', cs: 'N600JM', route: { originId: ltn, destId: dub, eta: now + 600, departedAt: now - 3000, atd: now - 3000, destConf: 'confirmed', landed: false } });
    // (seen just now, kept out of the resolver's queue - a made-up flight it would set about routing afresh)
    L.live.get(fid).lastPos = { at: Date.now(), lat: 53.5, lon: -6.3 };
    check('this tab\'s flights as board rows for an airport (N600JM, an arrival at Dublin)', L.liveBoardRows(dub).some(r => r.kind === 'arrivals' && r.reg === 'N600JM' && r.ap === ltn));
    const w3 = makeWin('https://www.flightradar24.com/data/airports/dub/arrivals');
    const pg3 = { component: 'Data/AirportBoard', version: 'x', props: { board: 'arrivals', airport: { id: dub, iata: 'DUB', icao: 'EIDW', timezone: 'Europe/Dublin' }, meta: { currentPage: 1, date: now - 1800, hoursRange: 12 }, statistics: { today: { total: 100 } },
      flights: [{ id: '1', scheduledTime: now - 900, estimatedTime: now - 900, flightNumber: 'EI1', callsign: 'EIN1', flightId: 'aaaa1', status: { name: 'landed', color: 'green' }, endpoint: { iata: 'LHR' }, aircraft: { type: 'A320', registration: 'EI-AAA' } }, { id: '2', scheduledTime: now + 3600, estimatedTime: now + 3600, flightNumber: 'EI2', callsign: 'EIN2', flightId: 'aaaa2', status: { name: 'estimated', color: 'green' }, endpoint: { iata: 'LHR' }, aircraft: { type: 'A320', registration: 'EI-AAB' } }] } };
    w3.eval(SRC);
    w3.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $page: pg3 } } };
    const got = await until(() => pg3.props.flights.find(x => x.callsign === 'N600JM' && x.endpoint && pg3.props.statistics.today.total === 101), 15000) || pg3.props.flights.find(x => x.callsign === 'N600JM');
    check('... on Dublin\'s own arrivals page (another tab), in FR24\'s format and time order, counted in today\'s arrivals', !!got && got.endpoint && got.endpoint.iata === 'LTN' && got.aircraft.registration === 'N600JM' && !!got.airline && typeof got.airline === 'object' && got.flightNumber === null && pg3.props.flights.indexOf(got) === 1 && pg3.props.statistics.today.total === 101, got && { ep: got.endpoint && got.endpoint.iata, item: got, at: pg3.props.flights.indexOf(got), total: pg3.props.statistics.today.total, logs: w3.__logs.filter(l => /airport|board/i.test(l)).slice(-6), rows: L.liveBoardRows(dub), ltn, ap3: (w3.__tweeksLadd.engine.byId(ltn) || {}).iata });
    // Dublin's on-ground page (board "on-ground", latest landed first, counts { onGround, movementsToday })
    { const og = { id: 'tl-og', scheduledTime: now - 7200, estimatedTime: null, callsign: 'VSB96', flightNumber: 'VSB96', airline: { id: null, name: null }, aircraft: { type: 'PC24', registration: 'M-ARNZ' }, __tl: true };
      H.apData.set(99902, { board: { onGround: [og] } });
      const pgG = { props: { board: 'on-ground', airport: { id: 99902, timezone: 'Europe/Dublin' }, meta: { currentPage: 1, hoursRange: 1 }, statistics: { onGround: 67, movementsToday: 725 }, flights: [{ id: 'a', scheduledTime: now - 60, callsign: 'RYR1' }, { id: 'b', scheduledTime: now - 600, callsign: 'RYR2' }] } };
      H.applyBoardPage(pgG); H.applyBoardPage(pgG);
      check('... and on its on-ground page: an aircraft that landed two hours ago, last in FR24\'s latest-first list, counted once', pgG.props.flights.map(x => x.id).join() === 'a,b,tl-og' && pgG.props.statistics.onGround === 68, { ids: pgG.props.flights.map(x => x.id), og: pgG.props.statistics.onGround }); }
    // the statistics page of Barrow: the week's blocked movements counted in, the runways in place of the locked table
    const bwf = L.engine.byIcao('EGNL');
    const pg4 = { component: 'Data/AirportStatistics', version: 'x', props: { airport: { id: bwf.id, iata: 'BWF', icao: 'EGNL' }, summary: { airportsServed: 0, countriesServed: 0, totalFlights: 0, landingCount: 0, takeoffCount: 0 }, movements: [], runways: [], locked: { movements: true, runways: true } } };
    w3.document.getElementById('app').__vue_app__.config.globalProperties.$page = pg4;
    const s4 = await until(() => pg4.props.summary.takeoffCount > 0 && !pg4.props.locked.runways ? pg4.props.summary : null, 20000);
    check('Barrow\'s statistics: the week\'s blocked take-offs and landings counted, its runways shown (no lock)', !!s4 && s4.takeoffCount === 1 && s4.landingCount === 1 && s4.totalFlights === 2 && pg4.props.runways.length >= 2, s4 && { s: s4, rw: pg4.props.runways.map(r => r.name) }); }
  // the flight-number page of a blocked aircraft's callsign: FR24 has none - built in its markup
  { const w2 = makeWin('https://www.flightradar24.com/data/flights/vsb96', '<!doctype html><html><head><title>Flight history for BAE Systems Marine flight VSB96</title><style>#cnt-data-content #tbl-datatable.is-user tbody{visibility:hidden}</style></head><body><section id="cnt-data-content"><div class="row section-header"><div id="cnt-subpage-info" class="col-xs-12 h-60"><h1>Flight history for VSB96 </h1></div></div><div class="row p-t-10 text-center" style="padding:10px 0;font-weight:700">There is currently no data available for your request <footer class="pb-4"><p>2026 Flightradar24 AB</p></footer></div></section></body></html>');
    w2.eval(SRC);
    const rows = await until(() => { const r = w2.document.querySelectorAll('#tbl-datatable tbody tr.data-row'); return r.length >= 2 ? r : null; }, 25000);
    const txt = rows ? [...rows].map(r => r.textContent.replace(/\s+/g, ' ')).join(' | ') : '';
    check('flight-number page VSB96: FR24\'s flight table with the PC-24\'s flights (from, to, aircraft, times, playback)', !!rows && /Barrow/.test(txt) && /Farnborough/.test(txt) && /M-ARNZ/.test(txt) && !!w2.document.querySelector('#tbl-datatable a.tl-play[href*="airplanes.live"]') && /BAE Systems Marine/.test(w2.document.querySelector('h1').textContent) && !/no data available/.test(w2.document.body.textContent) && w2.getComputedStyle(w2.document.querySelector('#tbl-datatable tbody')).visibility !== 'hidden', txt.slice(0, 300)); }
  // ---- 22.17 ---------------------------------------------------------------------------------------------------------------
  // landing places named as OpenStreetMap has them
  { const j = k => JSON.parse(fs.readFileSync(path.join(FX, 'osm', 'osm_' + k + '.json'), 'utf8')).elements;
    const got = Object.keys(OSM_FX).map(k => (L.osmPick(j(k), OSM_FX[k][0], OSM_FX[k][1]) || {}).name);
    check('landing places named from OpenStreetMap: a pad by its name, a pad by the place it lies in, by the place beside it', got.join('|') === 'Greenbank Helipad|Aintree Racecourse|Axis Business Park', got);
    const sid = L.learnSite(53.4772, -2.9425, { heli: true });
    const named = await until(() => { const s = L.siteBk().list.find(x => x.id === sid); return s && s.name === 'Aintree Racecourse' ? s : null; }, 8000);
    check('... learned as such: a helicopter down at Aintree is at "Aintree Racecourse", not "Private site near ..."', !!named, L.siteBk().list.find(x => x.id === sid)); }
  // the search box: blocked aircraft and the callsigns they flew under, FR24's style; BAE's logo
  { L.store.mergeHex('424c60', { reg: 'M-ARNZ', type: 'PC24', ladd: true, recent: [[ids.t - 9000, ids.t - 6200, ids.bwf, ids.fab, 'ground', 'ground', 'VSB96', 25000, 1]] });
    const q = async s => (await (await w.fetch('/v1/search/web/find?query=' + encodeURIComponent(s) + '&limit=50')).json()).results || [];
    const r1 = await q('VSB9'), r2 = await q('M-ARN'), r3 = await q('VSB');
    const sch = r1.find(r => r.type === 'schedule' && r.id === 'VSB96'), ac = r2.find(r => r.type === 'aircraft' && r.id === 'M-ARNZ'), op = r3.find(r => r.type === 'operator' && r.detail && r.detail.operator_id === 582);
    check('search "VSB9": the flight number VSB96 (to its flight page), with BAE Systems Marine\'s logo', !!sch && /BAE_Systems_logo/.test(sch.detail.logo || ''), sch || r1.map(r => r.type + ':' + r.id));
    check('search "M-ARN": the aircraft M-ARNZ (to its log)', !!ac, r2.map(r => r.type + ':' + r.id));
    check('search "VSB": BAE Systems Marine with a logo', !!op && /BAE_Systems_logo/.test(op.detail.logo || ''), op || r3.map(r => r.type + ':' + r.id)); }
  // the map's airport panel: FR24's own runways, the airport open now - not the first one opened
  { const rj = (iata, icao, rw) => ({ result: { response: { airport: { pluginData: { details: { code: { iata, icao } }, runways: rw.map(([n, ft, s]) => ({ name: n, length: { ft, m: Math.round(ft * 0.3048) }, surface: { code: s.slice(0, 4).toUpperCase(), name: s } })) } } } } });
    const back = w.location.pathname;
    w.document.body.insertAdjacentHTML('beforeend', '<div data-testid="airport-panel"><section><div class="relative flex"><button><picture data-testid="airport-panel__promo-runway_details"></picture></button></div></section></div>');
    w.history.pushState({}, '', '/airport/lpl'); H.noteAirportJson(rj('LPL', 'EGGP', [['09', 7500, 'Asphalt'], ['27', 7500, 'Asphalt']])); H.rwyPanel();
    const t1 = (w.document.querySelector('.tl-rwy') || {}).textContent || '';
    w.history.pushState({}, '', '/airport/dub'); H.noteAirportJson(rj('DUB', 'EIDW', [['10L', 10203, 'Concrete'], ['28R', 10203, 'Concrete']])); H.rwyPanel();
    const t2 = (w.document.querySelector('.tl-rwy') || {}).textContent || '', n = w.document.querySelectorAll('.tl-rwy').length, hid = w.document.querySelector('[data-testid="airport-panel__promo-runway_details"]').closest('button').style.display;
    check('airport panel: Liverpool\'s runways (09/27 2,286 m), then Dublin\'s when Dublin is opened - one table, the picture hidden', /09/.test(t1) && /2,286\/7,500/.test(t1) && /10L/.test(t2) && /Concrete/.test(t2) && !/09/.test(t2) && n === 1 && hid === 'none', { t1, t2, n, hid });
    w.document.querySelector('[data-testid="airport-panel"]').remove(); w.history.pushState({}, '', back); }
  // the statistics page: runways and the airport movements by day, unlocked
  { let H5 = null; const w5 = makeWin('https://www.flightradar24.com/data/airports/lpl/statistics', null, h => { H5 = h; }); w5.eval(SRC);
    const pg5 = { component: 'Data/AirportStatistics', version: 'x', props: { airport: { id: ids.lpl, iata: 'LPL', icao: 'EGGP', timezone: 'Europe/London', elevationFt: 80 }, summary: { airportsServed: 50, countriesServed: 10, totalFlights: 900, landingCount: 450, takeoffCount: 450 }, movements: [], runways: [], locked: { movements: true, runways: true } } };
    w5.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $page: pg5 } } };
    // (FR24's own runways arrive a moment after the OurAirports ones the userscript keeps)
    const ok5 = await until(() => !pg5.props.locked.movements && !pg5.props.locked.runways && pg5.props.runways.length && pg5.props.runways[0].lengthFt === 7500, 25000);
    const day = t => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }), mv = pg5.props.movements, whole = mv.slice(1);
    check('statistics: airport movements unlocked - today so far, then each day seen whole (48 landings, 48 take-offs), newest first; none half-counted', !!ok5 && mv.length >= 2 && mv.length <= 3 && day(mv[0].timestamp) === day(Date.now() / 1000) && whole.every(x => x.landings === 48 && x.takeoffs === 48 && x.total === 96) && day(whole[0].timestamp) === day(Date.now() / 1000 - 86400), { mv, locked: pg5.props.locked });
    check('... and the runway table from FR24\'s own runways (Liverpool 09/27)', pg5.props.runways.map(r => r.name).join() === '09,27' && pg5.props.runways[0].lengthFt === 7500, { rw: pg5.props.runways, fr: H5 && H5.rwyOf('LPL'), err: H5 && H5.stats.lastError }); }
  // FR24's playback: the panel's padlocked figures follow its clock
  { const pbS = { active: true, timestamp: pbFx.ts * 1000, selectedFlightId: pbFx.id }, fi = { flightId: pbFx.id, vspeed: 0, emsInfo: {} }, acS = { selected: { flightInfo: fi } };
    w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['playback', pbS], ['aircraft', acS]]) } } } };
    H.pbPanelTick(); const a = { vs: fi.vspeed, alt: fi.emsInfo.agps };
    pbS.timestamp += 90000; H.pbPanelTick(); const b = { vs: fi.vspeed, alt: fi.emsInfo.agps }, want = H.pbTelAt(pbFx.id, pbFx.ts + 90);
    check('playback: the open flight\'s GPS altitude / vertical speed set at the moment shown, and moved on with FR24\'s clock', Number.isFinite(a.alt) && Number.isFinite(b.alt) && (a.alt !== b.alt || a.vs !== b.vs) && !!want && Math.abs(b.alt - Math.round(want.agps)) <= 1, { a, b, want: want && { agps: want.agps, vr: want.vr } }); }
  const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
  check('no script errors', !errs.length, errs.slice(0, 5));
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed', e && e.stack); process.exit(1); });
