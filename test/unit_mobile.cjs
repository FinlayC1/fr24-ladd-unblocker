// 1.3.10 - FR24's Android app: the script the module (android/) runs inside FR24's app, as it runs there - dist/mobile/runtime.js
// in a page of its own at FR24's address, in Chromium (Android's WebView is Chromium), with the module's Java side stood in
// for (TLNative: its settings, its requests, its calls for each of FR24's gRPC messages):
//   - the page part is put in, and says so (TLNative.ready)
//   - FR24's LiveFeed request on its way out: type and registration asked for, as on the website
//   - an unnamed flight in FR24's LiveFeed answer, the LADD list holding the aircraft there: named in FR24's next answer
//     (its callsign, registration, type) - the very bytes FR24's app reads
//   - FR24's FollowFlight answer for it (the app's flight panel): its address, registration and full type name put in
//   - a message the module cannot make sense of, or one for a method not patched: given back as it came
//   - no error in the page
// usage: node test/unit_mobile.cjs   (needs Playwright's Chromium)
const fs = require('fs'), path = require('path');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..'), RT = path.join(ROOT, 'dist', 'mobile', 'runtime.js'), HOST = path.join(ROOT, 'dist', 'mobile', 'host.html');

// ---- protobuf, as FR24's messages are written ---------------------------------------------------------------------
const varint = n => { const o = []; n = Math.max(0, Math.floor(n)); do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 0x80; o.push(x); } while (n); return o; };
const fVar = (fn, v) => Buffer.from([...varint(fn * 8), ...varint(v)]);
const fLen = (fn, b) => Buffer.concat([Buffer.from([...varint(fn * 8 + 2), ...varint(b.length)]), b]);
const fStr = (fn, s) => fLen(fn, Buffer.from(s, 'utf8'));
const fFlt = (fn, v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return Buffer.concat([Buffer.from(varint(fn * 8 + 5)), b]); };
const fFix = (fn, v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return Buffer.concat([Buffer.from(varint(fn * 8 + 5)), b]); };
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
const find = (fs, fn) => fs.find(f => f.fn === fn);
const str = (fs, fn) => { const f = find(fs, fn); return f && f.wt === 2 ? Buffer.from(f.val).toString('utf8') : ''; };

(async () => {
  // (Playwright where CI puts it - PLAYWRIGHT_PATH, its Chromium CHROMIUM - else the one installed here)
  let chromium = null;
  for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
  if (!chromium) { console.log('(skipped: Playwright not found - PLAYWRIGHT_PATH=<its module dir>)'); process.exit(0); }
  if (!fs.existsSync(RT)) { check('dist/mobile/runtime.js built (node build.mjs)', false); process.exit(1); }
  const now = Math.floor(Date.now() / 1000), FID = 0x3d1f6a2b, LAT = 53.3335, LON = -2.85, ALT = 3500, GS = 110, TRK = 270;
  // (the LADD list: the aircraft where FR24 draws the unnamed flight, heard a moment ago)
  const LADD = { now: Date.now(), total: 1, ctime: Date.now(), ptime: 1, ac: [{ hex: 'a7c5d1', type: 'adsb_icao', flight: 'N601XY  ', r: 'N601XY', t: 'C68A', desc: 'CESSNA 680A Citation Latitude', alt_baro: ALT, alt_geom: ALT + 150, gs: GS, track: TRK, baro_rate: 0, squawk: '7000', category: 'A2', lat: LAT, lon: LON, nic: 8, seen_pos: 0.5, seen: 0.2, messages: 5000, rssi: -20, dbFlags: 8 }] };
  const asked = [];
  const answer = u => {
    asked.push(u);
    if (/^https:\/\/api\.adsb\.lol\/v2\/ladd$/.test(u)) return { status: 200, text: JSON.stringify(Object.assign({}, LADD, { now: Date.now() })) };
    return { status: 404, text: '{"error":"not here"}' };
  };
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    const ctx = await browser.newContext(), page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    // (the module answers its page and its script itself; nothing else goes to FR24 from here - a request the page part makes
    // of FR24's own servers in the app goes out as it would, here it is answered "not found")
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u === 'https://www.flightradar24.com/__fr24ladd/') return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(HOST) });
      if (u === 'https://www.flightradar24.com/__fr24ladd/runtime.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(RT) });
      return route.fulfill({ status: 404, body: '' });
    });
    // (the module's Java side: TLNative - requests answered by this test, as the app's process would make them)
    await page.exposeBinding('__nodeNet', async (src, id, json) => {
      const o = JSON.parse(json), a = answer(o.url);
      setTimeout(() => page.evaluate(([i, ans]) => { window.TLNative._res[i] = ans; window.__tlNet(i); }, [id, JSON.stringify({ status: a.status, statusText: '', url: o.url, headers: 'content-type: application/json\r\n', text: a.text })]).catch(() => {}), 5);
    });
    await page.addInitScript(() => {
      const res = {}, inp = {}, out = {};
      window.TLNative = {
        config: () => JSON.stringify({ v: 1, module: '1.3.10', app: '11.14.0', mon: { off: true } }),
        request: (id, json) => { window.__nodeNet(id, json); },
        abort: () => {},
        result: id => { const r = res[id]; delete res[id]; return r == null ? null : r; },
        take: id => (inp[id] == null ? null : inp[id]),
        done: (id, b64) => { out[id] = b64; },
        ready: v => { window.__tlReadyV = v; },
        _res: res, _inp: inp, _out: out
      };
      // (one of FR24's messages through the module's own call - TLNative.take / __tlAppRun / TLNative.done)
      let seq = 0;
      window.__call = (d, m, b64) => { const id = ++seq; inp[id] = JSON.stringify({ d, m, b: b64 }); window.__tlAppRun(id); const r = out[id]; delete inp[id]; delete out[id]; return r; };
    });
    await page.goto('https://www.flightradar24.com/__fr24ladd/');
    let ready = false; for (let i = 0; i < 100 && !ready; i++) { ready = await page.evaluate(() => !!window.__tlReadyV); if (!ready) await sleep(100); }
    check('the page part put in, the module told (TLNative.ready)', ready && await page.evaluate(() => typeof window.__tlApp === 'object' && typeof window.__tlApp.resp === 'function'));
    // (TL_DUMP=<dir>: each message in and out written there - for a check of them by FR24's own code, test/fr24check)
    const dump = process.env.TL_DUMP ? path.resolve(process.env.TL_DUMP) : '';
    if (dump) fs.mkdirSync(dump, { recursive: true });
    const call = async (d, m, buf, tag) => {
      const r = await page.evaluate(([dd, mm, b]) => window.__call(dd, mm, b), [d, m, buf.toString('base64')]), out = r ? Buffer.from(r, 'base64') : null;
      if (dump && tag) { fs.writeFileSync(path.join(dump, tag + '.in'), buf); fs.writeFileSync(path.join(dump, tag + '.out'), out || buf); }
      return out;
    };

    // ---- FR24's LiveFeed request: type and registration asked for ---------------------------------------------------
    const reqIn = Buffer.concat([fLen(1, Buffer.concat([fFlt(1, 54), fFlt(2, 53), fFlt(3, -3.5), fFlt(4, -2)])), fLen(2, Buffer.concat([fVar(3, 3)])), fVar(7, 1500)]);
    const reqOut = await call('req', 'LiveFeed', reqIn, 'LiveFeed.req');
    const mask = reqOut ? parse(reqOut).filter(f => f.fn === 10).flatMap(f => parse(f.val).filter(x => x.fn === 1).map(x => Buffer.from(x.val).toString())) : [];
    check('FR24\'s LiveFeed request on its way out: type and registration asked for (field mask 10), the rest as it came', mask.includes('type') && mask.includes('reg') && reqOut.subarray(0, reqIn.length - 0).length > 0 && Buffer.compare(reqOut.subarray(0, reqIn.length), reqIn) === 0, mask);

    // ---- an unnamed flight in FR24's LiveFeed answer --------------------------------------------------------------
    const flight = () => Buffer.concat([fVar(1, FID), fFlt(2, LAT), fFlt(3, LON), fVar(4, TRK), fVar(5, ALT), fVar(6, GS), fVar(7, 13), fVar(9, Math.floor(Date.now() / 1000)), fVar(12, 0)]);
    const feed = () => Buffer.concat([fLen(1, flight()), fVar(4, Math.floor(Date.now() / 1000))]);
    let named = null, tries = 0;
    for (; tries < 60 && !named; tries++) {
      const out = await call('resp', 'LiveFeed', feed(), 'LiveFeed.resp');
      const fsOut = out ? parse(out) : null, fl = fsOut && find(fsOut, 1) ? parse(find(fsOut, 1).val) : null;
      if (fl && str(fl, 11)) named = { cs: str(fl, 11), ex: find(fl, 13) ? parse(find(fl, 13).val) : [], fl };
      if (!named) await sleep(500);
    }
    check('an unnamed flight in FR24\'s LiveFeed answer, the LADD list holding the aircraft there: named in FR24\'s next answers - its callsign, registration and type in the very bytes FR24\'s app reads', !!named && named.cs === 'N601XY' && str(named.ex, 2) === 'N601XY' && str(named.ex, 4) === 'C68A', named ? { cs: named.cs, reg: str(named.ex, 2), type: str(named.ex, 4), tries } : { tries, asked: asked.slice(0, 8) });
    check('... its position and everything else FR24 sent as it came (id, lat, lon, altitude, speed)', !!named && find(named.fl, 1).val === FID && find(named.fl, 5).val === ALT && find(named.fl, 6).val === GS && Math.abs(Buffer.from(find(named.fl, 2).val).readFloatLE() - LAT) < 1e-4);

    // ---- FR24's FollowFlight answer for it (the app's flight panel) ------------------------------------------------
    const followReq = fFix(1, FID);
    await call('req', 'FollowFlight', followReq, 'FollowFlight.req');
    const efi = Buffer.concat([fVar(1, FID), fFlt(2, LAT), fFlt(3, LON), fVar(4, TRK), fVar(5, ALT), fVar(6, GS), fVar(8, Date.now()), fVar(9, 0)]);
    const followIn = Buffer.concat([fLen(1, Buffer.alloc(0)), fLen(5, efi)]);
    const followOut = await call('resp', 'FollowFlight', followIn, 'FollowFlight.resp');
    const fo = followOut ? parse(followOut) : [], ai = find(fo, 1) ? parse(find(fo, 1).val) : [];
    const aiHex = find(ai, 1) ? find(ai, 1).val : 0;
    check('FR24\'s FollowFlight answer (the app\'s flight panel): the aircraft put in as on the website - its address, registration, full type name', aiHex === 0xa7c5d1 && str(ai, 2) === 'N601XY' && /^cessna 680a citation latitude$/i.test(str(ai, 6)), { hex: aiHex.toString(16), reg: str(ai, 2), desc: str(ai, 6), fields: ai.map(f => f.fn) });

    // ---- what is left alone ---------------------------------------------------------------------------------------
    const junk = Buffer.from([0xff, 0xff, 0xff, 0x07]);
    const j1 = await call('resp', 'LiveFeed', junk), j2 = await call('resp', 'Echo', feed()), j3 = await call('req', 'NearestFlights', reqIn);
    check('a message that cannot be read, a method not patched (Echo, NearestFlights): given back as they came', !j1 && !j2 && !j3, { j1: !!j1, j2: !!j2, j3: !!j3 });
    const st = await page.evaluate(() => window.__tlApp.stats());
    check('... counted: LiveFeed answers read, flights named, requests', st.liveFeed > 0 && st.patched > 0 && st.mobileReq >= 1, { liveFeed: st.liveFeed, patched: st.patched, mobileReq: st.mobileReq, errors: st.errors, lastError: st.lastError });
    check('no error in the page', errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  } finally { await browser.close(); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
