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
  } finally { await browser.close(); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
