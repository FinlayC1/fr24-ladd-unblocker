// FR24's map playback, offline: the BUILT userscript in jsdom with FR24's real Playback / PlaybackFlight answers of 9 Oct
// 12:35Z (M-ARNZ's blocked PC-24 off Blackpool), adsb.lol's heatmap slice of that half hour and M-ARNZ's track of that day
// as fixtures, FR24's airport list from monitor/data. The heatmap is read the moment the playback shows its first frame,
// side by side with the monitor - which here never answers - so the flight is named at once: before its track is in, when
// the aircraft is known here; from its track when it is not. The file is kept on disk (the browser's cache storage) and a
// page opened afterwards reads it from there. The panel of that flight: Mach and the temperature from its track (none
// "N/A"), its padlocked country of registration, serial number and age written in as they come.
// usage: node test/unit_playback.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const FX = path.join(__dirname, 'fixtures');
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const pbFx = JSON.parse(fs.readFileSync(path.join(FX, 'playback_1235.json'), 'utf8'));
const heatBuf = zlib.gunzipSync(fs.readFileSync(path.join(FX, 'heat_20261009_25_slice.bin.gz')));
const traceTxt = zlib.gunzipSync(fs.readFileSync(path.join(FX, 'legs', '424c60', '2026-10-09_lol.json.gz'))).toString('utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 20; i++) { const v = f(); if (v) return v; await sleep(20); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const b64 = s => new Uint8Array(Buffer.from(s, 'base64'));
const body = fr => { const len = ((fr[1] << 24) | (fr[2] << 16) | (fr[3] << 8) | fr[4]) >>> 0; return fr.subarray(5, 5 + len); };

// (the browser's cache storage, shared by the pages of one profile - as the real one is)
const disk = new Map();
const caches = { open: async () => ({
  match: async u => { const b = disk.get(String(u)); return b ? new Response(b.slice(0)) : undefined; },
  put: async (u, r) => { const b = await r.arrayBuffer(); disk.delete(String(u)); disk.set(String(u), b); },
  keys: async () => [...disk.keys()].map(u => ({ url: u })),
  delete: async k => disk.delete(typeof k === 'string' ? k : k.url)
}) };

const TRACE_MS = 2500;   // (adsb.lol's day trace answers slowly here: a name must not wait for it)
function makeWin(url, asked) {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.caches = caches;
  const answer = (u, o) => {
    asked.push({ url: u, at: Date.now() });
    if (/flightradar24\.com\/mobile\/airports\/format/.test(u)) return [0, 200, AIRPORTS];
    if (/^https:\/\/mon\.test\//.test(u)) {
      if (/\/status/.test(u)) return [0, 200, JSON.stringify({ v: 3 })];
      if (/\/pbmatch|\/names/.test(u)) return null;                     // (the monitor never answers the playback's question)
      return [0, 200, '{}'];
    }
    if (/adsb\.lol\/globe_history\/2026\/10\/09\/heatmap\/25\.bin\.ttf/.test(u)) return [300, 200, null, heatBuf];
    if (/adsb\.lol\/globe_history\/2026\/10\/09\/traces\/60\/trace_full_424c60\.json/.test(u)) return [TRACE_MS, 200, traceTxt];
    return [0, 404, ''];
  };
  win.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const a = answer(u, init || {}); return a ? new Promise(r => setTimeout(() => r(new Response(a[2] || '', { status: a[1] })), a[0])) : new Promise(() => {}); };
  win.GM_xmlhttpRequest = o => {
    const a = answer(o.url, o); if (!a) return { abort() {} };
    setTimeout(() => { if (o.responseType === 'arraybuffer') o.onload && o.onload({ status: a[1], response: a[3] ? a[3].buffer.slice(a[3].byteOffset, a[3].byteOffset + a[3].byteLength) : null }); else o.onload && o.onload({ status: a[1], responseText: a[2], response: a[2] }); }, a[0] || 1);
    return { abort() {} };
  };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.__posted = []; win.postMessage = data => { win.__posted.push(data); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.__logs = []; win.console.debug = (...a) => win.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); win.console.log = () => {}; win.console.error = (...a) => win.__logs.push('ERROR ' + a.join(' '));
  win.__tlTestHook = h => { win.__H = h; };
  win.eval(SRC);
  return win;
}
const PB_URL = 'https://www.flightradar24.com/2026-10-09/12:35/1x/53.40,-2.60/9';
async function ready(w) {
  const L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000 && w.__H, 60000);
  await L.store.kvReady;
  L.store.kvSet('monRemote', { url: 'https://mon.test', token: 'tok' }); await L.monCheck(true).catch(() => {});
  return L;
}
const fid = pbFx.id;

(async () => {
  // ---- a playback of an aircraft this browser knows (its registration and type kept from earlier)
  const asked = [], w = makeWin(PB_URL, asked), L = await ready(w), H = w.__H;
  check('ready: airports, the monitor', L.engine.airports.length > 5000 && L.monUp());
  L.store.mergeHex('424c60', { reg: 'M-ARNZ', type: 'PC24', ladd: true });
  const t0 = Date.now(), n0 = asked.length;
  H.patchPlayback(body(b64(pbFx.feed)), pbFx.ts);
  const heatAsk = await until(() => asked.slice(n0).find(a => /heatmap\/25\.bin\.ttf/.test(a.url)), 3000);
  const monAsk = asked.slice(n0).find(a => /mon\.test\/(pbmatch|names)/.test(a.url));
  check('the heatmap of that half hour asked for as soon as the playback\'s first frame is in - not after the monitor', !!heatAsk && heatAsk.at - t0 < 500, heatAsk && { ms: heatAsk.at - t0, monitorAsked: !!monAsk });
  const named = await until(() => L.pb.named.get(fid), 5000), tNamed = Date.now() - t0;
  const traceDone = asked.find(a => /trace_full_424c60/.test(a.url)), traceIn = traceDone && traceDone.at + TRACE_MS <= Date.now() - 50;
  check('named at once from the heatmap while the monitor has not answered: 424c60, M-ARNZ, LADD', !!named && named.hex === '424c60' && named.reg === 'M-ARNZ' && named.ladd, named && { hex: named.hex, reg: named.reg, ms: tNamed });
  check('... without waiting for its track of the day (known here already)', !!named && tNamed < TRACE_MS && !traceIn, { ms: tNamed, traceAskedAt: traceDone && traceDone.at - t0 });
  const str = (fs, n) => { const f = fs && fs.find(x => x.fn === n); return f ? Buffer.from(f.val).toString('utf8') : ''; };
  // (the name reaches FR24's world as a message - delivered after this turn: the next frame FR24 asks for is the one labelled)
  const frame = () => { const out = H.patchPlayback(body(b64(pbFx.feed)), pbFx.ts), recs = H.parse(H.parse(out).find(f => f.fn === 1).val).filter(f => f.fn === 1).map(f => H.parse(f.val)); return recs.find(fs => fs.find(f => f.fn === 1).val === fid); };
  const me = await until(() => { const m = frame(); return m && str(m, 11) ? m : null; }, 250) || frame();
  check('... labelled on FR24\'s playback map at once - no "N/A" flight', !!me && !!str(me, 11), me && str(me, 11));
  const withCs = await until(() => { const r = L.pb.named.get(fid); return r && r.cs ? r : null; }, TRACE_MS + 3000);
  check('... its callsign of that moment once its track is in (VSB96)', !!withCs && withCs.cs === 'VSB96', withCs && withCs.cs);
  const rt = await until(() => L.pb.routes.get(fid), 5000);
  check('... and its flight as flown: Barrow -> Farnborough', !!rt && rt.originIata === 'BWF' && rt.destIata === 'FAB', rt && [rt.originIata, rt.destIata]);
  check('the heatmap kept on disk (the half hour is long over)', disk.has('https://adsb.lol/globe_history/2026/10/09/heatmap/25.bin.ttf'), [...disk.keys()]);

  // ---- the panel: Mach and temperature from the track, none "N/A"
  w.postMessage({ __tweeksLadd: 'pbFollow', id: fid, ts: pbFx.ts }, '*');
  const tl = await until(() => { const x = H.pbTelAt(fid, pbFx.ts); return x && x.mach > 0 ? x : null; }, 6000);
  check('the open flight\'s Mach and outside air temperature at that moment, from its track', !!tl && tl.mach > 0.3 && tl.mach < 0.8 && Number.isFinite(tl.oat) && tl.oat > -60 && tl.oat < 20, tl && { mach: tl.mach, oat: tl.oat, tas: tl.tas, ias: tl.ias, agps: tl.agps });
  const po = H.patchFlightMsg(body(b64(pbFx.flight)), { id: fid, ts: pbFx.ts, pb: true }, H.PLAYBACK), ef = H.parse(H.parse(po).find(f => f.fn === 3).val), emsF = ef.find(f => f.fn === 13), ems = emsF ? H.parse(emsF.val) : [];
  check('... in FR24\'s playback panel answer: Mach (thousandths) and temperature given, airspeeds too, no padlock flag', ems.some(f => f.fn === 7 && f.val > 300) && ems.some(f => f.fn === 4) && ems.some(f => f.fn === 5) && ems.some(f => f.fn === 6) && !ef.some(f => f.fn === 12), ems.map(f => f.fn + ':' + f.val));
  { const pbS = { active: true, timestamp: pbFx.ts * 1000, selectedFlightId: fid }, fi = { flightId: fid, vspeed: 0, emsInfo: {} }, acS = { selected: { flightInfo: fi } };
    w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['playback', pbS], ['aircraft', acS]]) } } } };
    H.pbPanelTick(); const a = Object.assign({}, fi.emsInfo);
    pbS.timestamp += 60000; H.pbPanelTick(); const b = Object.assign({}, fi.emsInfo);
    check('... and moved on with FR24\'s clock in the panel\'s own state (Mach as the wire\'s thousandths)', a.mach > 300 && a.mach < 800 && Number.isFinite(a.oat) && b.mach > 300 && Number.isFinite(b.oat), { a: { mach: a.mach, oat: a.oat }, b: { mach: b.mach, oat: b.oat } });
    fi.emsInfo = { mach: 0.5 }; pbS.timestamp += 30000; H.pbPanelTick();
    check('... a state holding Mach as the number itself kept so', fi.emsInfo.mach > 0.3 && fi.emsInfo.mach < 0.8, fi.emsInfo.mach); }

  // ---- the panel's padlocked country, serial number and age, written in as the registers answer
  const lock = label => `<div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">${label}</p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3"><path></path></svg></div></div>`;
  w.document.body.insertAdjacentHTML('beforeend', `<aside data-testid="aircraft-panel"><main><div class="first"></div><div class="grid grid-cols-2"><div class="col-span-1"><p>ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">424C60</p></div>${lock('COUNTRY OF REG.')}${lock('SERIAL NUMBER (MSN)')}${lock('AGE')}${lock('MACH')}</div></main></aside>`);
  L.syncPanel();
  const filled = () => Object.fromEntries([...w.document.querySelectorAll('[data-testid="aircraft-panel"] .tl-filled')].map(e => [e.dataset.k, e.textContent]));
  const f1 = await until(() => filled().country ? filled() : null, 3000);
  check('playback panel: its padlocked country of registration written in at once (M-: Isle of Man)', !!f1 && f1.country === 'Isle of Man', filled());
  L.store.mergeHex('424c60', { msn: '1234', year: 2021 }); L.syncPanel();
  const f2 = await until(() => filled().msn && filled().age ? filled() : null, 3000);
  check('... its serial number and age as the register answers (FR24 asked once, before)', !!f2 && f2.msn === '1234' && /year/.test(f2.age), filled());
  check('... and nothing of the live figures written into its cells (Mach comes with the panel\'s own state)', !filled().mach);
  w.document.querySelector('[data-testid="aircraft-panel__hex"]').textContent = '4CA123'; L.syncPanel();
  await until(() => !filled().country, 3000);
  check('... the panel redrawn for another aircraft: ours taken out again', !Object.keys(filled()).length, filled());

  // ---- an aircraft never seen here: named from its track, the one request; the heatmap from disk
  const asked2 = [], w2 = makeWin(PB_URL, asked2), L2 = await ready(w2), H2 = w2.__H;
  const t2 = Date.now();
  H2.patchPlayback(body(b64(pbFx.feed)), pbFx.ts);
  const named2 = await until(() => L2.pb.named.get(fid), TRACE_MS + 5000);
  check('a page opened later: the heatmap read from disk, not asked for again', !asked2.some(a => /heatmap/.test(a.url)) && asked.filter(a => /heatmap/.test(a.url)).length === 1, asked2.filter(a => /heatmap/.test(a.url)).map(a => a.url));
  check('an aircraft not known here: named once its track gives who it is (M-ARNZ, PC-24, LADD, VSB96)', !!named2 && named2.reg === 'M-ARNZ' && named2.type === 'PC24' && named2.ladd && named2.cs === 'VSB96', named2 && { reg: named2.reg, type: named2.type, ladd: named2.ladd, cs: named2.cs, ms: Date.now() - t2 });

  // ---- FR24's type disagreeing: no name
  { const asked3 = [], w3 = makeWin(PB_URL, asked3), L3 = await ready(w3), H3 = w3.__H;
    L3.store.mergeHex('424c60', { reg: 'M-ARNZ', type: 'A388' });
    H3.patchPlayback(body(b64(pbFx.feed)), pbFx.ts);
    await until(() => L3.pb.tried.size > 0, 5000); await sleep(300);
    check('the type kept here not the one FR24 gives (A380 against its PC-24): not named', !L3.pb.named.get(fid) && w3.__logs.some(l => /types differ/.test(l)), L3.pb.named.get(fid)); }

  const errs = [w, w2].flatMap(x => x.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l)));
  check('no script errors', !errs.length, errs.slice(0, 5));
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
