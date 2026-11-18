// 1.3.11 - the Android app (android/app): FR24's own site in the app's WebView, the script put into each of its pages at
// document start - in Chromium (Android's WebView is Chromium), the app's Java side stood in for (TLNative, as androidx.webkit
// gives a page it: postMessage out, message events back):
//   - dist/app/app.js put in at document start, as the app does it (addDocumentStartJavaScript): the page part in place
//     before FR24's own first script runs; the bridge taken out of the page's globals, and nothing of the script left there
//   - FR24's site's own LiveFeed request, as it makes it (XHR, gRPC-web): type and registration asked for; the LADD list
//     asked for through the bridge and answered: an unnamed flight in FR24's answer named - callsign, registration, type
//   - FR24's frames other than the top one: nothing put in (the userscript's @noframes)
//   - the preamble alone (src/app/shim.js): a request answered, as bytes, failed, timed out, aborted; a notification and
//     its tap; a monitor host asked for; a file the page saves (a blob link, clicked by script or by hand) handed to the
//     app; ids of this page's own, not a page's before it
//   - (1.3.12) the phone's location asked of the app (navigator.geolocation, navigator.permissions); TL_APP.update();
//     FR24's "open in app" pill and app banner not shown
//   - (1.3.12) a log page on a phone in the app: laid out as a phone app lays it out (bar, pictures, details, flights by
//     year, a flight opened, its Play - FR24's player and the way back), following the page as it changes; FR24's "flight
//     was not found" for a flight of ours taken away; wider than a phone, FR24's own page
//   - no error in the page
// usage: node test/unit_app.cjs   (needs Playwright's Chromium)
const fs = require('fs'), path = require('path');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..'), APP = path.join(ROOT, 'dist', 'app', 'app.js'), SHIM = path.join(ROOT, 'src', 'app', 'shim.js');

// ---- protobuf and gRPC-web, as FR24's messages are written ---------------------------------------------------------
const varint = n => { const o = []; n = Math.max(0, Math.floor(n)); do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 0x80; o.push(x); } while (n); return o; };
const fVar = (fn, v) => Buffer.from([...varint(fn * 8), ...varint(v)]);
const fLen = (fn, b) => Buffer.concat([Buffer.from([...varint(fn * 8 + 2), ...varint(b.length)]), b]);
const fFlt = (fn, v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return Buffer.concat([Buffer.from(varint(fn * 8 + 5)), b]); };
const frame = (flag, b) => { const h = Buffer.alloc(5); h[0] = flag; h.writeUInt32BE(b.length, 1); return Buffer.concat([h, b]); };
function unframe(b) { for (let p = 0; p + 5 <= b.length;) { const flag = b[p], len = b.readUInt32BE(p + 1); if (flag === 0) return b.subarray(p + 5, p + 5 + len); p += 5 + len; } return null; }
function parse(b) {
  const out = []; let p = 0;
  const rv = () => { let r = 0, mul = 1, x; do { x = b[p++]; r += (x & 0x7f) * mul; mul *= 128; } while (x & 0x80); return r; };
  while (p < b.length) {
    const tag = rv(), fn = Math.floor(tag / 8), wt = tag & 7;
    if (wt === 0) out.push({ fn, wt, val: rv() });
    else if (wt === 2) { const len = rv(); out.push({ fn, wt, val: b.subarray(p, p + len) }); p += len; }
    else if (wt === 5) { out.push({ fn, wt, val: b.subarray(p, p + 4) }); p += 4; }
    else if (wt === 1) { out.push({ fn, wt, val: b.subarray(p, p + 8) }); p += 8; }
    else throw new Error('wire type ' + wt);
  }
  return out;
}
const find = (l, fn) => l.find(f => f.fn === fn);
const str = (l, fn) => { const f = find(l, fn); return f && f.wt === 2 ? Buffer.from(f.val).toString('utf8') : ''; };

// (the app's side of the bridge, as androidx.webkit gives it to a page: put in before the app's script, as the WebView does)
const BRIDGE = () => {
  const listeners = [];
  window.TLNative = { postMessage: s => window.__tlHost(String(s)), addEventListener: (t, f) => { if (t === 'message') listeners.push(f); } };
  Object.defineProperty(window, '__tlDeliver', { value: s => { for (const f of listeners.slice()) f({ data: s }); } });
};

(async () => {
  let chromium = null;
  for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
  if (!chromium) { console.log('(skipped: Playwright not found - PLAYWRIGHT_PATH=<its module dir>)'); process.exit(0); }
  if (!fs.existsSync(APP)) { check('dist/app/app.js built (node build.mjs)', false); process.exit(1); }
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    // ======== 1. FR24's site with the app's script ========================================================================
    {
      const FID = 0x3d1f6a2b, LAT = 53.3335, LON = -2.85, ALT = 3500, GS = 110, TRK = 270;
      const LADD = () => ({ now: Date.now(), total: 1, ctime: Date.now(), ptime: 1, ac: [{ hex: 'a7c5d1', type: 'adsb_icao', flight: 'N601XY  ', r: 'N601XY', t: 'C68A', desc: 'CESSNA 680A Citation Latitude', alt_baro: ALT, alt_geom: ALT + 150, gs: GS, track: TRK, baro_rate: 0, squawk: '7000', category: 'A2', lat: LAT, lon: LON, nic: 8, seen_pos: 0.5, seen: 0.2, messages: 5000, rssi: -20, dbFlags: 8 }] });
      const asked = [], feedReqs = [], frames = [];
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }), page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      // (the app's Java side: the script's requests, answered as the app's AppNet would make them)
      await ctx.exposeBinding('__tlHost', async (src, s) => {
        const m = JSON.parse(s); frames.push({ t: m.t, main: src.frame === page.mainFrame() });
        if (m.t !== 'req') return;
        asked.push(m.url);
        const ans = /^https:\/\/api\.adsb\.lol\/v2\/ladd$/.test(m.url) ? { status: 200, text: JSON.stringify(LADD()) } : { status: 404, text: '{"error":"not here"}' };
        setTimeout(() => src.frame.evaluate(x => window.__tlDeliver(x), JSON.stringify({ t: 'res', id: m.id, status: ans.status, statusText: '', url: m.url, headers: 'content-type: application/json\r\n', text: ans.text })).catch(() => {}), 5);
      });
      await ctx.addInitScript(BRIDGE);
      await ctx.addInitScript({ content: fs.readFileSync(APP, 'utf8') });
      const flight = () => Buffer.concat([fVar(1, FID), fFlt(2, LAT), fFlt(3, LON), fVar(4, TRK), fVar(5, ALT), fVar(6, GS), fVar(7, 13), fVar(9, Math.floor(Date.now() / 1000)), fVar(12, 0)]);
      const feed = () => Buffer.concat([fLen(1, flight()), fVar(4, Math.floor(Date.now() / 1000))]);
      const CORS = { 'access-control-allow-origin': 'https://www.flightradar24.com', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': 'grpc-status, grpc-message' };
      await page.route('**/*', route => {
        const r = route.request(), u = r.url();
        if (u === 'https://www.flightradar24.com/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><script>window.__first = { bridge: !!window.__tweeksLaddBridge, xhr: !/\\[native code\\]/.test(XMLHttpRequest.prototype.send.toString()), fetch: !/\\[native code\\]/.test(window.fetch.toString()), tlnative: typeof window.TLNative, gm: typeof window.GM_xmlhttpRequest, app: typeof window.TL_APP };</script></head><body><div id="app"></div><iframe src="https://www.flightradar24.com/frame.html"></iframe></body></html>' });
        if (u === 'https://www.flightradar24.com/frame.html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><script>window.__inFrame = { bridge: !!window.__tweeksLaddBridge, xhr: !/\\[native code\\]/.test(XMLHttpRequest.prototype.send.toString()) };</script>' });
        if (/fr24\.feed\.api\.v1\.Feed\/LiveFeed$/.test(u)) {
          if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
          feedReqs.push(r.postDataBuffer() || Buffer.alloc(0));
          return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/grpc-web+proto', 'grpc-status': '0' }, CORS), body: Buffer.concat([frame(0, feed()), frame(0x80, Buffer.from('grpc-status:0\r\n'))]) });
        }
        return route.fulfill({ status: 404, body: '' });
      });
      await page.goto('https://www.flightradar24.com/');
      const first = await page.evaluate(() => window.__first);
      check('the app\'s script put in at document start: the page part in place before FR24\'s own first script runs (its requests watched - XHR and fetch)', first.bridge && first.xhr && first.fetch, first);
      check('... the bridge taken out of the page\'s globals (nothing FR24 or anything else in its page loads can reach it), and nothing of the script left there (GM_xmlhttpRequest, TL_APP)', first.tlnative === 'undefined' && first.gm === 'undefined' && first.app === 'undefined', first);
      await sleep(300);
      const inFrame = await page.frames()[1].evaluate(() => window.__inFrame).catch(() => null);
      check('FR24\'s frames other than the top one: nothing put in (@noframes) - nothing asked of the app from them', !!inFrame && !inFrame.bridge && !inFrame.xhr && frames.every(f => f.main), { inFrame, fromFrames: frames.filter(f => !f.main).length });

      // (FR24's site's own request for its map, as it makes it)
      const reqBody = frame(0, Buffer.concat([fLen(1, Buffer.concat([fFlt(1, 54), fFlt(2, 53), fFlt(3, -3.5), fFlt(4, -2)])), fLen(2, Buffer.concat([fVar(3, 3)])), fVar(7, 1500)]));
      const xhr = b64 => page.evaluate(b => new Promise(res => {
        const x = new XMLHttpRequest(); x.open('POST', 'https://data-feed.flightradar24.com/fr24.feed.api.v1.Feed/LiveFeed'); x.responseType = 'arraybuffer';
        x.setRequestHeader('content-type', 'application/grpc-web+proto'); x.setRequestHeader('fr24-device-id', 'web-test');
        x.onload = () => { const u = new Uint8Array(x.response); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); res(btoa(s)); };
        x.onerror = () => res(null); x.send(Uint8Array.from(atob(b), c => c.charCodeAt(0)));
      }), b64);
      let named = null, tries = 0;
      for (; tries < 60 && !named; tries++) {
        const r = await xhr(reqBody.toString('base64')), msg = r ? unframe(Buffer.from(r, 'base64')) : null;
        const fl = msg && find(parse(msg), 1) ? parse(find(parse(msg), 1).val) : null;
        if (fl && str(fl, 11)) named = { cs: str(fl, 11), ex: find(fl, 13) ? parse(find(fl, 13).val) : [], fl };
        if (!named) await sleep(500);
      }
      check('the LADD list asked for through the app\'s bridge (GM_xmlhttpRequest - the app makes it), answered', asked.some(u => u === 'https://api.adsb.lol/v2/ladd'), asked.slice(0, 10));
      check('FR24\'s site\'s LiveFeed answer, an unnamed flight in it: named in the very bytes FR24\'s page reads - its callsign, registration, type', !!named && named.cs === 'N601XY' && str(named.ex, 2) === 'N601XY' && str(named.ex, 4) === 'C68A', named ? { cs: named.cs, reg: str(named.ex, 2), type: str(named.ex, 4), tries } : { tries, asked: asked.slice(0, 8) });
      const sentMask = feedReqs.length ? parse(unframe(feedReqs[feedReqs.length - 1])).filter(f => f.fn === 10).flatMap(f => parse(f.val).filter(x => x.fn === 1).map(x => Buffer.from(x.val).toString())) : [];
      check('... and FR24\'s request asking for type and registration (field mask), as on the website', sentMask.includes('type') && sentMask.includes('reg'), sentMask);
      check('no error in the page', errors.length === 0, errors.slice(0, 5));
      await ctx.close();
    }

    // ======== 2. the preamble alone: what a userscript manager gives the script, from the app ============================
    {
      const ctx = await browser.newContext(), page = await ctx.newPage(), errors = [], got = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      await ctx.exposeBinding('__tlHost', async (src, s) => {
        const m = JSON.parse(s); got.push(m);
        const back = o => setTimeout(() => src.frame.evaluate(x => window.__tlDeliver(x), JSON.stringify(o)).catch(() => {}), 5);
        if (m.t === 'req') {
          if (/\/ok$/.test(m.url)) back({ t: 'res', id: m.id, status: 200, statusText: 'OK', url: m.url, headers: 'content-type: text/plain\r\n', text: 'fine' });
          else if (/\/bin$/.test(m.url)) back({ t: 'res', id: m.id, status: 200, url: m.url, headers: '', b64: Buffer.from([0, 1, 254, 255]).toString('base64') });
          else if (/\/fail$/.test(m.url)) back({ t: 'res', id: m.id, error: 'not a host the script may reach: x', timeout: false });
          else if (/\/slow$/.test(m.url)) back({ t: 'res', id: m.id, error: 'timeout', timeout: true });
        } else if (m.t === 'grant') back({ t: 'granted', id: m.id, ok: m.origin === 'https://mon.example.org' });
        // (first a tap for another page's notification of the same count - not this page's; this one's after it)
        else if (m.t === 'notify') { back({ t: 'click', id: 'otherpage.' + m.id.split('.')[1] }); setTimeout(() => back({ t: 'click', id: m.id }), 800); }
      });
      await ctx.addInitScript(BRIDGE);
      // (Playwright runs an init script in a function of its own: what the preamble makes, handed to the page for the test)
      await ctx.addInitScript({ content: fs.readFileSync(SHIM, 'utf8') + '\n;Object.assign(window, { GM_xmlhttpRequest, GM_notification, TL_HOST_ACCESS });' });
      await page.route('**/*', route => route.request().url() === 'https://www.flightradar24.com/t' ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body><a id="dl" download="G-ABCD-flights.csv">csv</a></body>' }) : route.fulfill({ status: 404, body: '' }));
      await page.goto('https://www.flightradar24.com/t');
      const r = await page.evaluate(() => new Promise(done => {
        const out = {}, n = { left: 5 }, end = () => { if (--n.left === 0) done(out); };
        const gm = (u, o) => GM_xmlhttpRequest(Object.assign({ url: u, onload: x => { out[u.split('/').pop()] = { status: x.status, text: x.responseText, bytes: x.response instanceof ArrayBuffer ? Array.from(new Uint8Array(x.response)) : null }; end(); }, onerror: e => { out[u.split('/').pop()] = { error: e.error }; end(); }, ontimeout: () => { out[u.split('/').pop()] = { timeout: true }; end(); } }, o || {}));
        gm('https://adsb.lol/ok'); gm('https://adsb.lol/bin', { responseType: 'arraybuffer' }); gm('https://adsb.lol/fail'); gm('https://adsb.lol/slow');
        const h = GM_xmlhttpRequest({ url: 'https://adsb.lol/hold', onload: () => { out.hold = 'answered'; }, onabort: () => { out.hold = 'aborted'; end(); } }); h.abort();
      }));
      check('a request answered (status, text), as bytes (an ArrayBuffer), failed (onerror, the app\'s reason), timed out (ontimeout)', r.ok && r.ok.status === 200 && r.ok.text === 'fine' && r.bin && JSON.stringify(r.bin.bytes) === '[0,1,254,255]' && r.fail && /not a host/.test(r.fail.error) && r.slow && r.slow.timeout === true, r);
      check('... one aborted: onabort, and the app told to stop it', r.hold === 'aborted' && got.some(m => m.t === 'abort'), { hold: r.hold, aborts: got.filter(m => m.t === 'abort').length });
      const reqIds = got.filter(m => m.t === 'req').map(m => m.id), prefix = reqIds.length ? reqIds[0].split('.')[0] : '';
      check('ids of this page\'s own: one page id and a count (no answer of a page before a reload is taken for this one\'s)', reqIds.length === 5 && reqIds.every(id => /^[a-z0-9]{1,8}\.\d+$/.test(id) && id.split('.')[0] === prefix), reqIds);
      const n = await page.evaluate(() => new Promise(done => { const t0 = Date.now(); GM_notification({ title: 'G-ABCD', text: 'has taken off from Liverpool', onclick: () => done(Date.now() - t0 >= 700 ? 'tapped' : 'tapped by another page\'s tap') }); setTimeout(() => done('not tapped'), 3000); }));
      const note = got.find(m => m.t === 'notify');
      check('a notification handed to the app (title, text); its tap back: the page\'s own onclick - one from another page\'s id not taken', n === 'tapped' && note && note.title === 'G-ABCD' && note.text === 'has taken off from Liverpool', { n, note });
      const g = await page.evaluate(async () => [await TL_HOST_ACCESS('https://mon.example.org'), await TL_HOST_ACCESS('https://other.example.org')]);
      check('a monitor host asked of the app (TL_HOST_ACCESS): its answer, yes or no', JSON.stringify(g) === '[true,false]' && got.filter(m => m.t === 'grant').length === 2, g);
      // (a file the page saves: the script's CSV - a blob link with a download name, clicked by script, not in the page)
      await page.evaluate(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['date_utc,callsign\r\n2026-11-18,GABCD'], { type: 'text/csv' })); a.download = 'G-ABCD-flights.csv'; a.click(); });
      for (let i = 0; i < 30 && !got.some(m => m.t === 'save'); i++) await sleep(100);
      const sv = got.find(m => m.t === 'save');
      check('a file the page saves (a blob link with a download name, a.click() - the script\'s CSV): handed to the app, its name, type and bytes', !!sv && sv.name === 'G-ABCD-flights.csv' && /^text\/csv/.test(sv.mime) && Buffer.from(sv.b64, 'base64').toString() === 'date_utc,callsign\r\n2026-11-18,GABCD', sv && { name: sv.name, mime: sv.mime });
      // (... and tapped by hand: the page stays where it is)
      await page.evaluate(() => { document.getElementById('dl').href = URL.createObjectURL(new Blob(['x,y'], { type: 'text/csv' })); });
      const before = got.filter(m => m.t === 'save').length;
      await page.click('#dl');
      for (let i = 0; i < 30 && got.filter(m => m.t === 'save').length === before; i++) await sleep(100);
      check('... a link like it tapped by hand: handed to the app too, the page not left', got.filter(m => m.t === 'save').length === before + 1 && page.url() === 'https://www.flightradar24.com/t');
      // (a new page: a new page id)
      await page.reload(); await page.evaluate(() => GM_xmlhttpRequest({ url: 'https://adsb.lol/ok', onload: () => {} })); await sleep(200);
      const ids2 = got.filter(m => m.t === 'req').map(m => m.id), last = ids2[ids2.length - 1];
      check('... a page loaded again: ids of its own (another page id)', !!last && last.split('.')[0] !== prefix, { before: prefix, after: last });
      check('no error in the page', errors.length === 0, errors.slice(0, 5));
      await ctx.close();
    }
    // ======== 3. (1.3.12) the preamble: the phone's location, the app's update, FR24's "open in app" pill ==================
    {
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }), page = await ctx.newPage(), errors = [], got = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      let geoMode = 'fix';
      await ctx.exposeBinding('__tlHost', async (src, s) => {
        const m = JSON.parse(s); got.push(m);
        const back = o => setTimeout(() => src.frame.evaluate(x => window.__tlDeliver(x), JSON.stringify(o)).catch(() => {}), 5);
        if (m.t === 'geo') back(geoMode === 'fix' ? { t: 'geo', id: m.id, ok: true, lat: 53.3336, lon: -2.8497, acc: 12.5, alt: 30, ts: 1795000000000 } : { t: 'geo', id: m.id, ok: false, code: 1, message: 'not allowed' });
        else if (m.t === 'geoState') back({ t: 'geoState', id: m.id, state: 'granted' });
      });
      await ctx.addInitScript(BRIDGE);
      await ctx.addInitScript({ content: fs.readFileSync(SHIM, 'utf8') + '\n;Object.assign(window, { TL_APP });' });
      const PILL = '<div class="pointer-events-auto absolute bottom-24 flex items-center rounded-full bg-yellow-500 px-4" id="pill"><button class="whitespace-nowrap py-2">Open in app</button><div class="mx-2 h-6 w-px bg-white"></div><button>x</button></div>';
      const OTHER = '<div class="rounded-full bg-yellow-500" id="other"><button>Upgrade</button></div>';
      await page.route('**/*', route => route.request().url() === 'https://www.flightradar24.com/m' ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body><div id="open-in-app-banner">Get the best flight tracking experience using our app</div>' + PILL + OTHER + '</body></html>' }) : route.fulfill({ status: 404, body: '' }));
      await page.goto('https://www.flightradar24.com/m');
      const pos = await page.evaluate(() => new Promise(done => navigator.geolocation.getCurrentPosition(p => done({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, ts: p.timestamp, json: JSON.stringify(p) }), e => done({ err: e.code }), { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 })));
      const ask = got.find(m => m.t === 'geo');
      check('the page\'s location (navigator.geolocation, FR24\'s "my location"): asked of the app with the page\'s options, its answer the page\'s position', pos.lat === 53.3336 && pos.lon === -2.8497 && pos.acc === 12.5 && pos.alt === 30 && pos.ts === 1795000000000 && /"latitude":53.3336/.test(pos.json) && ask && ask.high === true && ask.timeout === 9000 && ask.maxAge === 60000, { pos, ask });
      geoMode = 'denied';
      const den = await page.evaluate(() => new Promise(done => navigator.geolocation.getCurrentPosition(() => done({ ok: true }), e => done({ code: e.code, denied: e.code === e.PERMISSION_DENIED }))));
      check('... refused by the user: the page\'s error callback, PERMISSION_DENIED', den.code === 1 && den.denied === true, den);
      geoMode = 'fix';
      const w = await page.evaluate(() => new Promise(done => { let n = 0; const id = navigator.geolocation.watchPosition(() => { if (++n === 1) { navigator.geolocation.clearWatch(id); setTimeout(() => done(n), 6500); } }); }));
      check('... watched: answered, and cleared - asked no more', w === 1, w);
      const st = await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state);
      check('... whether it may (navigator.permissions): the app\'s answer', st === 'granted', st);
      const up = await page.evaluate(() => TL_APP.update());
      await sleep(100);
      check('TL_APP.update(): the app asked to look for its update', up === true && got.some(m => m.t === 'update'), up);
      const shown = await page.evaluate(() => ['open-in-app-banner', 'pill', 'other'].map(id => getComputedStyle(document.getElementById(id)).display));
      check('FR24\'s "Open in app" pill and app banner not shown; another yellow pill of FR24\'s left as it is', shown[0] === 'none' && shown[1] === 'none' && shown[2] !== 'none', shown);
      check('no error in the page', errors.length === 0, errors.slice(0, 5));
      await ctx.close();
    }

    // ======== 4. (1.3.12) a log page on a phone, in the app: laid out as a phone app lays it out ========================
    {
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }), page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      await ctx.exposeBinding('__tlHost', async (src, s) => {
        const m = JSON.parse(s); if (m.t !== 'req') return;
        setTimeout(() => src.frame.evaluate(x => window.__tlDeliver(x), JSON.stringify({ t: 'res', id: m.id, status: 404, statusText: '', url: m.url, headers: '', text: '{}' })).catch(() => {}), 5);
      });
      await ctx.addInitScript(BRIDGE);
      await ctx.addInitScript({ content: fs.readFileSync(APP, 'utf8') });
      // (a page in the markup of FR24's own log pages - its header's labels and values, its pictures, its rows: the phone
      // block and the desktop cells - made up here, nothing of FR24's)
      const td = (ts) => `data-timestamp="${ts}" data-offset="0"`;
      const row = (ts, date, from, to, fl, dur, atd, color, status, btns) => `<tr class=" data-row" data-timestamp="${ts}"><td class="visible-xs visible-sm"><div class="row table-row-responsive">phone</div></td><td class="w40 hidden-xs hidden-sm">&nbsp;</td><td class="hidden-xs hidden-sm">${date}</td><td class="text-center-sm hidden-xs hidden-sm">${from}</td><td class="text-center-sm hidden-xs hidden-sm">${to}</td><td class="hidden-xs hidden-sm">${fl}</td><td class="hidden-xs hidden-sm">${dur}</td><td class="hidden-xs hidden-sm"> — </td><td class="hidden-xs hidden-sm" ${td(atd)}>${atd ? '10:29' : ' — '}</td><td class="hidden-xs hidden-sm"> — </td><td class="hidden-xs hidden-sm"><div class="state-block ${color}"></div></td><td class="hidden-xs hidden-sm">${status}</td><td class="text-right hidden-xs hidden-sm">${btns}</td><td class="w40 hidden-xs hidden-sm">&nbsp;</td></tr>`;
      const play = id => `<a class="btn btn-sm btn-white fs-10 tl-export" href="#" data-tl-export="KML"> KML </a> <a class="btn btn-sm btn-playback bkg-blue fs-10" href="#${id}" id="btn-playback-${id}" onclick="window.__played=(window.__played||[]).concat('${id}');return false"><i class="fa fa-play"></i> &nbsp;Play </a>`;
      const BODY = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><div id="open-in-app-banner">Get the app</div><header id="hdr">FR24's header</header>
<div class="section-header"><div><div id="cnt-subpage-info"><h1>G-TEST</h1></div><div id="cnt-aircraft-info"><div class="row"><label>AIRCRAFT</label><span class="details">Piper Seneca V</span></div><div class="row"><label>TYPE CODE</label><span class="details">PA34</span></div><div class="row"><label>SERIAL NUMBER (MSN)</label><span class="details">3449108</span></div></div></div><div><div class="row"><div class="col-xs-6 cnt-picture"><span class="label">© A. Spotter | Jetphotos</span><a href="#"><img src="https://cdn.example.org/p1.jpg"></a></div></div></div></div>
<div id="cnt-playback" class="hidden">the player</div>
<table id="tbl-datatable"><tbody>${row(1795400000, '17 Nov 2026', ' Liverpool <a href="/data/airports/lpl">(LPL)</a>', ' Liverpool <a href="/data/airports/lpl">(LPL)</a>', ' — ', '1:36', 1795400000, 'green', 'Landed 12:05', play('abc123'))}${row(1767100000, '30 Dec 2025', ' Chester <a href="/data/airports/ceg">(CEG)</a>', ' — ', ' (RVR12) ', '1:02', 1767100000, 'gray', 'Unknown', play('abc124'))}<tr class="tl-foot"><td colspan="20">2 earlier flights rebuilt from public ADS-B data</td></tr></tbody></table>
<div id="toast-container"></div></body></html>`;
      await page.route('**/*', route => route.request().url().split('#')[0] === 'https://www.flightradar24.com/data/aircraft/g-test' ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: BODY }) : route.fulfill({ status: 404, body: '' }));
      await page.goto('https://www.flightradar24.com/data/aircraft/g-test#ff4073ee6911e300');
      // (FR24's notice for a flight of ours named in the address: shown as FR24 shows it)
      await page.evaluate(() => { document.getElementById('toast-container').innerHTML = '<div class="toast toast-warning"><div class="toast-message">Sorry, but flight was not found on this page. Please try load more flights</div></div><div class="toast"><div class="toast-message">Something else</div></div>'; });
      await page.waitForSelector('#tl-pv .tl-pv-row', { timeout: 20000 }).catch(() => null);
      await sleep(600);
      const v = await page.evaluate(() => {
        const pv = document.getElementById('tl-pv'), txt = e => (e && e.textContent || '').replace(/\s+/g, ' ').trim();
        return { on: !!pv && getComputedStyle(pv).display !== 'none', hdr: getComputedStyle(document.getElementById('hdr')).display, table: getComputedStyle(document.getElementById('tbl-datatable')).display,
          kind: txt(pv && pv.querySelector('.tl-pv-k')), name: txt(pv && pv.querySelector('.tl-pv-n')), pics: pv ? pv.querySelectorAll('.tl-pv-pic img').length : 0,
          fields: pv ? [...pv.querySelectorAll('.tl-pv-f')].map(f => txt(f.querySelector('b')) + ' ' + txt(f.querySelector('div'))) : [], years: pv ? [...pv.querySelectorAll('.tl-pv-year')].map(txt) : [],
          rows: pv ? [...pv.querySelectorAll('.tl-pv-row')].map(r => ({ date: txt(r.querySelector('.tl-pv-date')), fl: txt(r.querySelector('.tl-pv-fl')), aps: [...r.querySelectorAll('.tl-pv-ap')].map(txt), link: !!r.querySelector('.tl-pv-ap a[href="/data/airports/lpl"]'), dot: r.querySelector('.tl-pv-dot').className })) : [],
          note: txt(pv && pv.querySelector('.tl-pv-note')), toasts: [...document.querySelectorAll('#toast-container .toast')].map(txt) };
      });
      check('a log page in the app on a phone: shown as an app shows it - FR24\'s page under it not shown', v.on && v.hdr === 'none' && v.table === 'none', v);
      check('... its bar (AIRCRAFT, the registration), its picture, its details', v.kind === 'AIRCRAFT' && v.name === 'G-TEST' && v.pics === 1 && v.fields.join('|') === 'AIRCRAFT Piper Seneca V|TYPE CODE PA34|SERIAL NUMBER (MSN) 3449108', v);
      check('... its flights by year, a line each: the day, the flight, from and to (the page\'s own links), the state', JSON.stringify(v.years) === '["YEAR 2026","YEAR 2025"]' && v.rows.length === 2 && v.rows[0].date === 'Nov 17' && v.rows[0].fl === '—' && v.rows[0].aps[0] === 'Liverpool (LPL)' && v.rows[0].link && /green/.test(v.rows[0].dot) && v.rows[1].date === 'Dec 30' && v.rows[1].fl === '(RVR12)' && v.rows[1].aps[1] === '—' && v.note === '2 earlier flights rebuilt from public ADS-B data', v);
      check('FR24\'s "flight was not found" for a flight of ours in the address: taken away; its other notices left', v.toasts.length === 1 && v.toasts[0] === 'Something else', v.toasts);
      await page.click('#tl-pv .tl-pv-row .tl-pv-date');
      const ex = await page.evaluate(() => { const r = document.querySelector('#tl-pv .tl-pv-row'); return { open: r.classList.contains('open'), grid: [...r.querySelectorAll('.tl-pv-grid > div')].map(d => d.textContent.replace(/\s+/g, ' ').trim()), btns: [...r.querySelectorAll('.tl-pv-btns button')].map(b => b.textContent.trim()) }; });
      check('... a flight tapped: its times, status and duration, and its own buttons', ex.open && ex.grid.includes('ATD10:29') && ex.grid.includes('STATUSLanded 12:05') && ex.grid.includes('FLIGHT TIME1:36') && JSON.stringify(ex.btns) === '["KML","Play"]', ex);
      await page.click('#tl-pv .tl-pv-row.open .tl-pv-play');
      await page.evaluate(() => { document.getElementById('cnt-playback').classList.remove('hidden'); });
      await sleep(400);
      const pl = await page.evaluate(() => ({ played: window.__played || [], play: document.documentElement.classList.contains('tl-pv-play'), player: getComputedStyle(document.getElementById('cnt-playback')).display, pill: getComputedStyle(document.querySelector('#tl-pv .tl-pv-backpill')).display, open: document.querySelector('#tl-pv .tl-pv-row').classList.contains('open') }));
      check('... its Play: the page\'s own Play pressed; FR24\'s player shown as its page shows it, with the way back to the list', JSON.stringify(pl.played) === '["abc123"]' && pl.play && pl.player !== 'none' && pl.pill !== 'none', pl);
      await page.click('#tl-pv .tl-pv-backpill');
      const bk = await page.evaluate(() => ({ play: document.documentElement.classList.contains('tl-pv-play'), list: getComputedStyle(document.getElementById('tl-pv')).display }));
      check('... "Flights": the list again', !bk.play && bk.list !== 'none', bk);
      // (the page changes - a row filled in by the script: the list follows it, the open flight left open)
      await page.evaluate(() => { const td = document.querySelector('#tbl-datatable tbody tr:nth-child(2) td:nth-child(5)'); td.innerHTML = ' Liverpool <a href="/data/airports/lpl">(LPL)</a>'; });
      await sleep(700);
      const up2 = await page.evaluate(() => ({ to: document.querySelectorAll('#tl-pv .tl-pv-row')[1].querySelectorAll('.tl-pv-ap')[1].textContent.replace(/\s+/g, ' ').trim(), open: document.querySelector('#tl-pv .tl-pv-row').classList.contains('open') }));
      check('... the page\'s rows changed: the list follows them', up2.to === 'Liverpool (LPL)' && up2.open, up2);
      // (wider than a phone: FR24's page as it is)
      await page.setViewportSize({ width: 1280, height: 900 });
      const wide = await page.evaluate(() => ({ pv: getComputedStyle(document.getElementById('tl-pv')).display, table: getComputedStyle(document.getElementById('tbl-datatable')).display }));
      check('... wider than a phone: FR24\'s own page', wide.pv === 'none' && wide.table !== 'none', wide);
      check('no error in the page', errors.length === 0, errors.slice(0, 5));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
