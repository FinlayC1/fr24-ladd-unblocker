// 1.3 - LADD Unblock switched off in its window: FR24 exactly as it is, and only what FR24 itself shows this page sent to
// the monitor (as every browser's is) - nothing taken from it:
//   - the page's part: FR24's XMLHttpRequest and fetch wrapped, never changed - its LiveFeed answer the very object FR24
//     was sent, its board answer the same; the flights on the map with no callsign and FR24's rows of a board read on
//     their way past, posted to the userscript; FR24's feed headers without its authorization; nothing else installed
//   - the userscript: those flights to the monitor's /report and FR24's board rows to /boardrows; nothing asked of the
//     monitor but where it is (/status) - no names, routes, live figures, boards or last-seen lists; nothing posted to
//     the page but its greeting (N500EU's panel was filled with it switched off)
// and, switched on:
//   - an airport with no METAR (Barrow/Walney, BWF): the monitor's live weather at the airport and a METAR made from it
//     (apwx.cjs: AUTO ... RMK MODEL - never another airport's report) in FR24's own tiles and "More weather & METAR", on
//     its data page and the current-weather layer, its wind for the runway in use; FR24's own weather wins the moment
//     it has any
//   - the statistics page: runway usage [{ name, total, takeoffs, landings }] (never the runway details' table) and the
//     movements of each day, from the monitor; its /airport usage from the runway log of FR24's own tracks
//   - the aircraft panel's vertical speed: never FR24's padlock - "N/A" before the browser paints, a figure when there is one
// usage: node test/unit_13.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules'), D = process.argv[3] || path.join(__dirname, '../monitor/data');
const os = require('os');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const MON = 'https://143-47-224-210.sslip.io';
const OFF = JSON.stringify({ on: false });

// ---- protobuf, as FR24's LiveFeed answers: Flight { 1 id, 2 lat, 3 lon, 4 track, 5 alt, 6 speed, 7 icon, 9 ts, 10 onGround,
// 11 callsign, 12 source, 13 extra { 2 reg, 4 type } }, the answer { 1 flights, 4 serverTime }, in grpc-web frames
const vint = n => { const o = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 0x80; o.push(x); } while (n); return o; };
const fVar = (fn, n) => Buffer.from(vint(fn * 8).concat(vint(n)));
const fLen = (fn, b) => Buffer.concat([Buffer.from(vint(fn * 8 + 2).concat(vint(b.length))), b]);
const fStr = (fn, s) => fLen(fn, Buffer.from(s));
const fF32 = (fn, v) => { const b = Buffer.alloc(5); b[0] = fn * 8 + 5; b.writeFloatLE(v, 1); return b; };
const flight = o => Buffer.concat([fVar(1, o.id), fF32(2, o.lat), fF32(3, o.lon), fVar(4, o.trk), fVar(5, o.alt), fVar(6, o.spd), fVar(7, 2), fVar(9, o.ts), fVar(10, 0),
  ...(o.cs ? [fStr(11, o.cs)] : []), fVar(12, 1), fLen(13, Buffer.concat([...(o.reg ? [fStr(2, o.reg)] : []), fStr(4, o.type)]))]);
const frame = b => Buffer.concat([Buffer.from([0, (b.length >>> 24) & 255, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255]), b]);
const TS = Math.floor(Date.now() / 1000);
const FEED = frame(Buffer.concat([
  fLen(1, flight({ id: 0x3c4a5b6d, lat: 54.13, lon: -3.26, trk: 170, alt: 3500, spd: 160, ts: TS, type: 'C25B' })),                 // (blocked: no callsign, no registration)
  fLen(1, flight({ id: 0x3c4a5b70, lat: 53.35, lon: -2.27, trk: 230, alt: 6000, spd: 250, ts: TS, cs: 'EZY12AB', reg: 'G-EZWZ', type: 'A320' })),
  fVar(4, TS * 1000)]));
const BOARD = { data: [{ id: 1, flight: { id: '3c4a5b70', callsign: 'EZY12AB', number: 'U21234' }, scheduledTime: TS + 600, estimatedTime: TS + 660, status: { name: 'Estimated', color: 'green' }, airportId: 2, airline: 'easyJet', airlineId: 3, aircraftType: 'A320' }], meta: { currentPage: 1 } };

(async () => {
  // ================= the page's part on its own =================
  {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/54.10,-3.20/9', runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window, posted = [];
    w.localStorage.setItem('tweeks.fr24.ladd.opts1', OFF);
    w.postMessage = d => posted.push(d);
    // (FR24's XMLHttpRequest as a stand-in: what FR24 sends, and its answer handed back as it came)
    const sent = [];
    function FakeXHR() { this.readyState = 0; this.status = 0; this.responseType = ''; this._l = []; this._h = {}; }
    FakeXHR.prototype.open = function (m, u) { this._u = u; this.readyState = 1; };
    FakeXHR.prototype.setRequestHeader = function (k, v) { this._h[k] = v; };
    FakeXHR.prototype.addEventListener = function (t, f) { if (t === 'load') this._l.push(f); };
    FakeXHR.prototype.send = function (body) {
      sent.push({ u: this._u, h: Object.assign({}, this._h), body });
      const ab = new w.ArrayBuffer(FEED.length); new w.Uint8Array(ab).set(FEED);
      this.status = 200; this.readyState = 4; this.response = ab; this._ab = ab;
      for (const f of this._l) f.call(this);
    };
    w.XMLHttpRequest = FakeXHR;
    const fetched = [];
    w.fetch = (u) => { fetched.push(String(u)); return Promise.resolve(new Response(JSON.stringify(/\/departures(\?|$)/.test(String(u)) ? BOARD : { other: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } })); };
    const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
    w.eval('(' + m[0] + ')()');
    const br = w.__tweeksLaddBridge;
    check('switched off: the page part only as the reader of FR24\'s answers (no names, routes, statistics kept)', !!br && br.observe === true && !br.resolved && !br.routes && !br.stats);
    check('... it greets the userscript ("ready", nothing known)', posted.some(p => p.__tweeksLadd === 'ready' && p.observe === true));
    // (FR24's LiveFeed, as FR24 sends it)
    const x = new w.XMLHttpRequest(); x.responseType = 'arraybuffer';
    x.open('POST', 'https://data-feed.flightradar24.com/fr24.feed.api.v1.Feed/LiveFeed');
    x.setRequestHeader('fr24-device-id', 'web-abc'); x.setRequestHeader('fr24-platform', 'web'); x.setRequestHeader('authorization', 'Bearer SECRET'); x.setRequestHeader('content-type', 'application/grpc-web+proto');
    const reqBody = new Uint8Array([10, 2, 1, 2]);
    x.send(reqBody);
    check('FR24\'s LiveFeed request sent exactly as FR24 made it (its body, its headers)', sent.length === 1 && sent[0].body === reqBody && sent[0].h.authorization === 'Bearer SECRET', sent[0] && sent[0].h);
    check('... its answer the very object FR24 was sent - nothing patched, no getter put over it', x.response === x._ab && !Object.getOwnPropertyDescriptor(x, 'response').get && Buffer.compare(Buffer.from(new Uint8Array(x.response)), FEED) === 0);
    const fr = posted.find(p => p.__tweeksLadd === 'feedReady'), fd = posted.find(p => p.__tweeksLadd === 'feed');
    check('FR24\'s feed headers for the monitor - never its authorization', !!fr && fr.hdr['fr24-device-id'] === 'web-abc' && fr.hdr['fr24-platform'] === 'web' && !('authorization' in fr.hdr), fr && fr.hdr);
    check('the flights FR24 shows with no callsign: posted (the blocked Citation over Barrow), FR24\'s named easyJet not', !!fd && fd.flights.length === 1 && fd.flights[0].id === 0x3c4a5b6d && Math.abs(fd.flights[0].lat - 54.13) < 1e-4 && fd.flights[0].alt === 3500 && fd.flights[0].type === 'C25B' && fd.total === 2 && fd.serverTime === TS * 1000, fd);
    // (FR24's board, by fetch)
    const r1 = await w.fetch('https://www.flightradar24.com/api/v1/airports/2/departures?page=1&limit=100');
    const j1 = await r1.json(); await sleep(20);
    const bd = posted.find(p => p.__tweeksLadd === 'boardRows');
    check('FR24\'s board: its own answer, untouched', JSON.stringify(j1) === JSON.stringify(BOARD));
    check('... its rows posted for the monitor', !!bd && bd.apId === 2 && bd.kind === 'departures' && bd.rows.length === 1 && bd.rows[0].flight.id === '3c4a5b70', bd);
    const n0 = posted.length;
    const r2 = await w.fetch('https://www.flightradar24.com/api/v1/airports/2/departures/77'); const j2 = await r2.json();
    const r3 = await w.fetch('https://www.flightradar24.com/api/v1/airports/2/departures?page=2'); await r3.json();
    const r4 = await w.fetch('https://www.flightradar24.com/api/v1/weather/auth'); const j4 = await r4.json(); await sleep(20);
    check('a board\'s card, its second page, the weather\'s authorization: FR24\'s own answers, nothing read, nothing answered here', j2.other === 1 && j4.other === 1 && posted.length === n0 && fetched.length === 4, posted.slice(n0).map(p => p.__tweeksLadd));
    // (the userscript's greeting: answered)
    const n1 = posted.length;
    w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'hello' }, source: w }));
    check('the userscript\'s hello answered with "ready"', posted.length === n1 + 1 && posted[n1].__tweeksLadd === 'ready');
    w.close();
  }

  // ================= the userscript, switched off =================
  {
    const dom = new JSDOM('<!doctype html><html><head></head><body><div id="map"></div></body></html>', { url: 'https://www.flightradar24.com/54.10,-3.20/9', runScripts: 'dangerously', pretendToBeVisual: true });
    const win = dom.window, reqs = [], toPage = [];
    win.localStorage.setItem('tweeks.fr24.ladd.opts1', OFF);
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
    win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    win.fetch = () => Promise.resolve(new Response('', { status: 404 }));
    win.GM_xmlhttpRequest = r => {
      reqs.push({ url: r.url, method: r.method || 'GET', data: r.data });
      let st = 404, body = '';
      if (r.url.startsWith(MON + '/status')) { st = 200; body = JSON.stringify({ v: 3, since: Date.now() }); }
      else if (r.url.startsWith(MON + '/report') || r.url.startsWith(MON + '/boardrows')) { st = 200; body = JSON.stringify({ ok: 1 }); }
      setTimeout(() => r.onload && r.onload({ status: st, responseText: body, response: body }), 2);
      return { abort() {} };
    };
    win.GM_info = { scriptHandler: 'Tampermonkey', version: '5.3', script: { version: '1' } };
    win.unsafeWindow = win; win.GM_notification = () => {}; win.open = () => null;
    win.postMessage = data => { toPage.push(data); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
    win.console.debug = () => {}; win.console.log = () => {};
    win.eval(SRC);
    const T = () => win.__tweeksLadd;
    await until(() => T() && toPage.some(p => p.__tweeksLadd === 'ready'), 5000);
    check('the page part injected switched off too - as the reader only', !!win.__tweeksLaddBridge && win.__tweeksLaddBridge.observe === true);
    // (what the page part read of FR24's feed and board)
    const page = d => win.postMessage(d);
    page({ __tweeksLadd: 'feedReady', hdr: { 'fr24-device-id': 'web-abc' } });
    page({ __tweeksLadd: 'feed', flights: [{ id: 0x3c4a5b6d, lat: 54.13, lon: -3.26, trk: 170, alt: 3500, spd: 160, icon: 2, ts: TS, gnd: false, src: 1, type: 'C25B', reg: '', sel: false }], na: [], named: [], serverTime: TS * 1000, total: 2, at: Date.now(), bg: false, observe: true });
    page({ __tweeksLadd: 'boardRows', apId: 2, kind: 'departures', rows: BOARD.data });
    // (and what an older page part might still send: asked of nothing)
    page({ __tweeksLadd: 'needAirportPanel', ap: 'BWF', rid: 1 }); page({ __tweeksLadd: 'follow', id: 0x3c4a5b6d }); page({ __tweeksLadd: 'rwyUse', ap: 2, rid: 2 }); page({ __tweeksLadd: 'needRoutes', rid: 3 });
    await sleep(300);
    check('the flight FR24 shows kept for the report', T().pending.has(0x3c4a5b6d));
    await T().monCheck(true).catch(() => {});
    await T().reportToMonitor();
    const rep = reqs.find(r => r.url === MON + '/report' && r.method === 'POST');
    let body = null; try { body = JSON.parse(rep.data); } catch (e) { /* none */ }
    check('to the monitor\'s /report: FR24\'s flight with no callsign (where FR24 shows it), nothing of this browser\'s own naming', !!body && body.flights.length === 1 && body.flights[0][0] === 0x3c4a5b6d && body.flights[0][1] === 54.13 && body.ids.length === 0, body);
    await until(() => reqs.some(r => r.url === MON + '/boardrows'), 12000);
    const br = reqs.find(r => r.url === MON + '/boardrows'); let bb = null; try { bb = JSON.parse(br.data); } catch (e) { /* none */ }
    check('FR24\'s board rows to the monitor\'s /boardrows', !!bb && bb.list.length === 1 && bb.list[0].ap === 2 && bb.list[0].kind === 'departures' && bb.list[0].rows[0].fid === '3c4a5b70', bb);
    // (the one thing asked elsewhere: GitHub's version number - the window offers an update switched off too)
    const GH = /^https:\/\/raw\.githubusercontent\.com\/FinlayC1\/fr24-ladd-unblocker\/main\/package\.json/;
    const pulled = reqs.filter(r => r.method === 'GET' && !r.url.startsWith(MON + '/status') && !GH.test(r.url));
    check('nothing taken from the monitor or anywhere else - only where the monitor is (/status) and GitHub\'s version for the window', pulled.length === 0 && reqs.every(r => r.url.startsWith(MON) || GH.test(r.url)), pulled.map(r => r.url.slice(0, 80)));
    const own = toPage.filter(p => !/^(hello|ready|feed|feedReady|boardRows|needAirportPanel|follow|rwyUse|needRoutes)$/.test(p.__tweeksLadd));
    check('nothing put on the page - no names, routes, panels, runways (N500EU)', own.length === 0, own.map(p => p.__tweeksLadd));
    check('no ads stylesheet, no LADD tags', !win.document.getElementById('tl-noads') && !win.document.querySelector('.tl-ladd'));
    win.close();
  }
  // ================= the monitor: an airport's weather where there is no METAR =================
  { const { createApWx } = require('../monitor/apwx.cjs');
    const ap = { id: 530, icao: 'EGNL', iata: 'BWF', name: 'Barrow-in-Furness Walney Island Airport', lat: 54.131161, lon: -3.26366 };
    const t = Date.UTC(2026, 10, 7, 1, 15) / 1000, asked = [];
    let refuse = true;
    const cur = { time: t, temperature_2m: 9.6, relative_humidity_2m: 86, dew_point_2m: 7.4, weather_code: 3, cloud_cover: 100, cloud_cover_low: 40, cloud_cover_mid: 95, cloud_cover_high: 20, pressure_msl: 1012.8, wind_speed_10m: 12.4, wind_direction_10m: 243, wind_gusts_10m: 25.1, visibility: 24140 };
    const fetchFn = async u => { asked.push(u); if (refuse && /visibility/.test(u)) return { status: 400, text: async () => '{"error":true}' }; const c = Object.assign({}, cur); if (!/visibility/.test(u)) for (const k of ['visibility', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high']) delete c[k]; return { status: 200, text: async () => JSON.stringify({ current: c }) }; };
    let ms = t * 1000;
    const A = createApWx({ E: { byId: id => (id === 530 ? ap : null) }, fetch: fetchFn, now: () => ms });
    const w = A.made(ap, cur, t * 1000);
    check('a METAR made from the live weather at the airport: its own code and time, AUTO, wind and gust, visibility, cloud, temperature/dew point, QNH rounded down, RMK MODEL', w.metar === 'EGNL 070115Z AUTO 24012G25KT 9999 SCT009 OVC080 10/07 Q1012 RMK MODEL', w.metar);
    check('... the figures beside it in FR24\'s words: overcast, 9.6 °C, wind 243° 12 kt gusting 25, 1013 hPa', w.cond === 'overcast' && w.tempC === 9.6 && w.wdir === 243 && w.wkts === 12 && w.gust === 25 && w.hpa === 1013 && w.rh === 86 && w.src === 'model', w);
    const fog = A.made(ap, { time: t, temperature_2m: -1.6, dew_point_2m: -2.1, weather_code: 45, cloud_cover: 100, cloud_cover_low: 100, pressure_msl: 1030.2, wind_speed_10m: 0.4, wind_direction_10m: 10, wind_gusts_10m: 3, visibility: 300 }, t * 1000);
    const clear = A.made(ap, { time: t, temperature_2m: 14, dew_point_2m: 3, weather_code: 0, cloud_cover: 2, cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 2, pressure_msl: 1021, wind_speed_10m: 6, wind_direction_10m: 2, wind_gusts_10m: 9, visibility: 40000 }, t * 1000);
    check('... fog (calm, 300 m, below freezing): 00000KT 0300 FG OVC002 M02/M02; a clear day: wind from the north as 360, CAVOK', fog.metar === 'EGNL 070115Z AUTO 00000KT 0300 FG OVC002 M02/M02 Q1030 RMK MODEL' && fog.cond === 'fog' && clear.metar === 'EGNL 070115Z AUTO 36006KT CAVOK 14/03 Q1021 RMK MODEL' && clear.cond === 'clear', [fog.metar, clear.metar]);
    const a1 = await A.answer(530);
    check('the answer: asked of Open-Meteo for the airport itself; refused the full list, the basic one at once (no visibility: ////)', !!a1 && asked.length === 2 && /latitude=54\.1312&longitude=-3\.2637/.test(asked[0]) && / \/\/\/\/ /.test(a1.metar) && a1.icao === 'EGNL' && a1.lat === ap.lat, { asked: asked.length, m: a1 && a1.metar });
    ms += 600e3; const a2 = await A.answer(530);
    check('... kept 15 minutes: asked once', a2 === a1 && asked.length === 2);
    ms += 400e3; refuse = false; await A.answer(530);
    check('... asked again after 15 minutes - the basic list from then on', asked.length === 3 && !/visibility/.test(asked[2]));
    check('... an airport not known: nothing', (await A.answer(999)) === null); }

  // ================= the monitor: runway usage from the runway log =================
  { process.env.MON_DATA = D; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon13-')); process.env.MON_PORT = String(42000 + Math.floor(Math.random() * 6000));
    global.fetch = async () => ({ status: 404, text: async () => '' });
    const M = require('../monitor/monitor.cjs'); M.loadEngine();
    const bwf = M.E.byIcao('EGNL'), nowS = Math.floor(Date.now() / 1000);
    M.RL.put('4011aa01', 0, '23', bwf.id, nowS - 7200, 'trail'); M.RL.put('4011aa02', 0, '23', bwf.id, nowS - 5400, 'live'); M.RL.put('4011aa02', 1, '17', bwf.id, nowS - 3600, 'live');
    const j = M.answer(new URL(`http://x/airport?ap=${bwf.id}&days=7&hist=14`), nowS);
    const u23 = j && j.usage.find(u => u[0] === '23'), u17 = j && j.usage.find(u => u[0] === '17');
    check('/airport: runway usage from the runway log of FR24\'s own tracks - 23 two take-offs, 17 one landing', !!u23 && u23[1] === 2 && u23[2] === 0 && !!u17 && u17[2] === 1 && j.rwyLog === 3, j && j.usage); }

  // ================= the page: weather, statistics, vertical speed =================
  { const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/airport/530/bwf', runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window, posts = []; let H = null;
    w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob; w.DecompressionStream = DecompressionStream;
    w.fetch = () => Promise.reject(new Error('offline')); w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
    const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/); w.eval('(' + m[0] + ')()');
    const send = data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' }));
    const doc = w.document, now = Math.floor(Date.now() / 1000);
    const tileFr = (id, label, dd) => `<div class="rounded border" data-testid="airport-panel__weather__${id}"><div><div><dt><span><span>${label}</span></span></dt><dd class="h-full">${dd}</dd></div></div></div>`;
    const panel = doc.createElement('div'); panel.setAttribute('data-testid', 'airport-panel');
    panel.innerHTML = '<section class="m-1 space-y-1"><dl class="grid grid-cols-3 gap-1 text-center fr24wx">' + tileFr('conditions', 'Conditions', 'N/A') + tileFr('temperature', 'Temperature', 'N/A') + tileFr('wind', 'Wind', 'N/A') + '</dl></section>';
    doc.body.appendChild(panel);
    H.rwyUsePanel(panel, 530);
    const ask = posts.filter(p => p.__tweeksLadd === 'needApWx');
    check('BWF\'s panel, FR24\'s weather all "N/A": the monitor asked for the airport\'s weather, once', ask.length === 1 && ask[0].ap === 530);
    const wx = { v: 1, ap: 530, icao: 'EGNL', name: 'Barrow-in-Furness Walney Island Airport', lat: 54.131161, lon: -3.26366, src: 'model', t: now - 300, cond: 'overcast', tempC: 9.6, dewC: 7.4, rh: 86, wdir: 240, wkts: 12, gust: 25, hpa: 1013, visM: 24140, clouds: [['OVC', 8000]], metar: 'EGNL 070115Z AUTO 24012G25KT 9999 SCT009 OVC080 10/07 Q1012 RMK MODEL' };
    send({ __tweeksLadd: 'apWxGot', ap: 530, wx }); await sleep(20);
    H.rwyUsePanel(panel, 530);
    const sec = panel.querySelector('section'), box = sec.querySelector(':scope > .tl-wx'), frDl = sec.querySelector('.fr24wx');
    const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    check('... in FR24\'s own tiles: Overcast, 10 °C, 240° 12G25 kts - FR24\'s "N/A" put away', !!box && /Conditions\s*Overcast/.test(txt(box.querySelector('[data-tl-wx="conditions"]'))) && /10 °C/.test(txt(box.querySelector('[data-tl-wx="temperature"]'))) && /240°\s*12G25\s*kts/.test(txt(box.querySelector('[data-tl-wx="wind"]'))) && frDl.style.getPropertyValue('display') === 'none', txt(box));
    check('... "More weather & METAR": pressure, dew point, humidity and the METAR made for it, said to be made', /Air pressure\s*1,013 hPa/.test(txt(box)) && /Dew point\s*7 °C/.test(txt(box)) && /Humidity\s*86%/.test(txt(box)) && txt(box).includes(wx.metar) && /not an official report/.test(txt(box)), txt(box));
    // (the runway in use with its wind - asked with the airport's runways)
    const askU = posts.find(p => p.__tweeksLadd === 'rwyAp' && p.ap === 530);
    send({ __tweeksLadd: 'rwyApGot', rid: askU && askU.rid, ap: 530, ok: true, f: {}, h: [], use: { ends: [['05', 49], ['23', 229], ['17', 166], ['35', 346]], runways: [['05', '23', 3438, 0], ['17', '35', 3318, 0], ['12', '30', 1326, 1]], mv: [], at: now } });
    await sleep(20); H.rwyUsePanel(panel, 530);
    const tiles = [...sec.querySelectorAll('.tl-rwyuse > div')].map(txt);
    check('... the runway in use by its wind (240° 12 kt): 23 both ways, under the weather put in', tiles.length === 2 && /runway\s*23\s*Predicted/i.test(tiles[0]) && /runway\s*23\s*Predicted/i.test(tiles[1]) && box.nextElementSibling === sec.querySelector('.tl-rwyuse'), tiles);
    // (FR24 with weather of its own after all: its own back, ours gone)
    frDl.querySelector('[data-testid="airport-panel__weather__temperature"] dd').textContent = '8 °C';
    H.rwyUsePanel(panel, 530);
    check('FR24 with weather of its own: its tiles back, the monitor\'s gone', !sec.querySelector('.tl-wx') && frDl.style.getPropertyValue('display') === '');
    // (the data page: FR24's weather empty - the monitor's in its form; FR24's own never touched)
    const p0 = { airport: { id: 530 }, weather: null };
    H.apWxData(p0, 530);
    check('data page, no weather from FR24: the monitor\'s in FR24\'s form', !!p0.weather && p0.weather.condition === 'overcast' && p0.weather.temperatureC === 10 && p0.weather.windDirection === 240 && p0.weather.windSpeedKts === 12 && p0.weather.timestamp === wx.t, p0.weather);
    const own = { condition: 'clear', temperatureC: 4, windDirection: 90, windSpeedKts: 3, timestamp: now }, p1 = { airport: { id: 530 }, weather: own };
    H.apWxData(p1, 530);
    check('... FR24\'s own weather left as it is', p1.weather === own);
    // (the current-weather layer: the airport among FR24's stations, its METAR as the raw report)
    const stR = new Response(JSON.stringify([{ id: 'EGNS', lat: '54.08', lon: '-4.62' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    const outR = await H.mxApWxAdd(stR, 'https://www.flightradar24.com/weather/stations?bbox=-6,56,-1,52,8'), st = await outR.json();
    const b = st.find(x => x.id === 'EGNL');
    check('current-weather layer: BWF added beside FR24\'s stations, its made METAR as its report', st.length === 2 && !!b && b.raw_text === wx.metar && b.temperature_value === '10' && /^tlcloud/.test(b.weather_code), b);
    const outR2 = await H.mxApWxAdd(new Response('[]', { status: 200 }), 'https://www.flightradar24.com/weather/stations?bbox=10,50,12,48,8');
    check('... out of view: not added', (await outR2.json()).length === 0);
    // (the statistics page)
    const ad = H.apDataOf(530); ad.stats = { usage: [['23', 5, 4], ['05', 1, 0], ['35', 0, 2]], daily: [['2026-11-06', 6, 5, 'all'], ['2026-11-05', 2, 3, 'all']] };
    const ps = { airport: { id: 530, iata: 'BWF', icao: 'EGNL', timezone: 'Europe/London' }, runways: [], movements: [], locked: { runways: true, movements: true } };
    H.statsUsage(ps, 530);
    check('statistics page: runway usage in FR24\'s form, busiest first - its padlock off', JSON.stringify(ps.runways.map(r => [r.name, r.total, r.takeoffs, r.landings])) === '[["23",9,5,4],["35",2,0,2],["05",1,1,0]]' && ps.locked.runways === false, ps.runways);
    const mv = H.statsMoves(ps, 530, [{ timestamp: Date.parse('2026-11-06T09:00:00Z') / 1000, total: 4, takeoffs: 3, landings: 1 }]);
    check('... movements: FR24\'s schedule\'s day and the monitor\'s side by side - the larger of each; newest first', mv.length === 2 && mv[0].takeoffs === 6 && mv[0].landings === 5 && mv[0].total === 11 && mv[1].total === 5, mv);
    // (the aircraft panel's vertical speed)
    const ac = doc.createElement('div'); ac.setAttribute('data-testid', 'aircraft-panel');
    ac.innerHTML = '<div class="grid"><div title="How quickly an aircraft is ascending or descending" class="col-span-1"><p class="text-xs uppercase">Vertical speed</p><div class="inline-flex items-center flex-row cursor-pointer"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></div></div></div>';
    doc.body.appendChild(ac);
    H.vsNoLock(ac);
    const cell = ac.querySelector('[title^="How quickly"]'), lock = cell.querySelector('div');
    check('vertical speed with no figure: FR24\'s padlock never shown - "N/A" in its place', lock.style.getPropertyValue('display') === 'none' && txt(cell.querySelector('.tl-vsna')) === 'N/A');
    lock.remove(); cell.insertAdjacentHTML('beforeend', '<p class="text-md">-1,280 fpm</p>'); H.vsNoLock(ac);
    check('... a figure in the cell: "N/A" gone', !cell.querySelector('.tl-vsna') && /-1,280 fpm/.test(txt(cell)));
    // (and before the browser paints: put in by FR24, swapped the same moment)
    const ac2 = doc.createElement('div'); ac2.setAttribute('data-testid', 'aircraft-panel');
    ac.remove(); doc.body.appendChild(ac2);
    ac2.innerHTML = '<div class="grid"><div title="How quickly an aircraft is ascending or descending" class="col-span-1"><p class="text-xs uppercase">Vertical speed</p><div class="inline-flex"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></div></div></div>';
    await Promise.resolve(); await sleep(0);
    check('... drawn by FR24: swapped by the page\'s own watch, before it is painted', txt(ac2.querySelector('.tl-vsna')) === 'N/A');
    w.close(); }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
