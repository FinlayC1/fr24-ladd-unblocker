// A blocked aircraft's pictures shared through the monitor: found once by any browser, every panel has them at once.
//   - the monitor's store (monitor/photos.cjs): only pictures on JetPhotos' and Planespotters' own addresses, three an
//     aircraft, never FR24's stock picture of a type; a browser held to its budget; kept on disk, written only when new
//   - the browser (the BUILT userscript in jsdom): the monitor's pictures taken at once - nothing looked up; with none
//     there, looked up as before (FR24's lookup - its stock picture dropped) and sent with the next report
// usage: node test/unit_photocache.cjs <node_modules dir>
const fs = require('fs'), os = require('os'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const { createPhotos } = require('../monitor/photos.cjs');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const JP = n => ({ link: `https://www.jetphotos.com/photo/${n}`, credit: 'Dario Duque Gomez', large: `https://cdn.jetphotos.com/640/5/${n}_1.jpg`, medium: `https://cdn.jetphotos.com/400/5/${n}_1.jpg`, thumb: `https://cdn.jetphotos.com/200/5/${n}_1.jpg`, source: 'JetPhotos' });
const STOCK = { link: 'https://www.flightradar24.com/', credit: 'Flightradar24', large: 'https://cdn.flightradar24.com/assets/aircraft/glf5.jpg', source: 'Flightradar24' };

(async () => {
  // ---- the monitor's store
  { const P = createPhotos(), t = Date.now();
    const n = P.put([['a63864', [JP(1), STOCK, JP(2), JP(3), JP(4)]], ['A6386X', [JP(5)]], ['a00001', [{ link: 'https://evil.example/x', credit: 'x', large: 'https://evil.example/x.jpg', source: 'JetPhotos' }]], ['a00002', [STOCK]], ['a00003', [Object.assign(JP(6), { credit: '<img src=x onerror=alert(1)>' })]]], t);
    const got = P.get(['a63864', 'a00001', 'a00002', 'a00003'], t);
    check('monitor: a browser\'s pictures kept - three at most, FR24\'s stock picture dropped', n === 2 && got.length === 2 && got[0].photos.length === 3 && got[0].photos.every(p => /jetphotos/.test(p.large)), got.map(g => [g.hex, g.photos.length]));
    check('... nothing on another site\'s address, nor an aircraft with only the stock picture, nor a malformed address', !got.some(g => g.hex === 'a00001' || g.hex === 'a00002') && P.size() === 2);
    check('... a credit is kept as plain text (no markup)', got[1].hex === 'a00003' && !/[<>]/.test(got[1].photos[0].credit), got[1].photos[0].credit);
    let left = 1; const n2 = P.put([['a00010', [JP(10)]], ['a00011', [JP(11)]]], t, () => left-- > 0);
    check('... a stranger\'s browser held to its budget', n2 === 1 && P.size() === 3, n2);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlph-'));
    P.save(dir); const m1 = fs.statSync(path.join(dir, 'photos.json')).mtimeMs; await sleep(20); P.save(dir);
    check('... kept on disk; written again only when something new came', fs.statSync(path.join(dir, 'photos.json')).mtimeMs === m1);
    const P2 = createPhotos(); P2.load(dir, Date.now());
    check('... and read back after a restart', P2.size() === 3 && P2.get(['a63864'], Date.now())[0].photos.length === 3); }

  // ---- the browser
  const MON = 'https://143-47-224-210.sslip.io', reqs = [], posts = [];
  const answer = o => {
    const u = o.url; reqs.push(u);
    if (u.startsWith(MON + '/status')) return [200, JSON.stringify({ v: 3, since: Date.now() - 3600e3, public: true })];
    if (u.startsWith(MON + '/photos')) return [200, JSON.stringify({ list: /a63864/.test(u) ? [{ hex: 'a63864', photos: [JP(1), JP(2)], at: Date.now() - 864e5 }] : [] })];
    if (u.startsWith(MON + '/report')) { posts.push(JSON.parse(o.data || '{}')); return [200, JSON.stringify({ ok: true, photos: 1 })]; }
    if (/api\.flightradar24\.com\/common\/v1\/flight\/list\.json\?query=N527P/.test(u)) return [200, JSON.stringify({ result: { response: { aircraftInfo: null, aircraftImages: [{ registration: 'N527P', images: { thumbnails: [{ src: STOCK.large, link: STOCK.link, copyright: 'Flightradar24' }, { src: JP(7).thumb, link: JP(7).link, copyright: 'Cary Liao' }], medium: [{ src: STOCK.large, link: STOCK.link, copyright: 'Flightradar24' }, { src: JP(7).medium, link: JP(7).link, copyright: 'Cary Liao' }], large: [{ src: STOCK.large, link: STOCK.link, copyright: 'Flightradar24' }, { src: JP(7).large, link: JP(7).link, copyright: 'Cary Liao' }] } }] } } })];
    return [404, ''];
  };
  const win = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/53.33,-2.85/10', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = () => Promise.resolve(new Response('', { status: 404 }));
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {}; win.postMessage = () => {}; win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  const L = win.__tweeksLadd;
  await L.monCheck(true); await sleep(50);
  check('(the monitor answers)', L.monUp());
  // (an aircraft whose pictures another browser found)
  L.store.mergeHex('a63864', { reg: 'N50JE', type: 'GLF5', ladd: true });
  reqs.length = 0;
  const a = { hex: 'a63864', reg: 'N50JE', id: 1, photos: [] };
  const pa = await L.photoJob(a, true);
  check('browser: a blocked aircraft\'s pictures from the monitor, at once', pa.length === 2 && /jetphotos/.test(pa[0].large) && a.photoLevel === 2, pa.map(p => p.large));
  check('... nothing looked up (no JetPhotos, FR24 or Planespotters request)', !reqs.some(u => /jetphotos\.com|api\.flightradar24\.com|planespotters/.test(u)), reqs.filter(u => !u.startsWith(MON)));
  check('... and not sent back to the monitor', !L.photosOut.has('a63864'));
  // (one the monitor has none of: looked up - FR24's lookup with its stock picture first)
  L.store.mergeHex('a6a434', { reg: 'N527P', type: 'F900', ladd: true });
  const b = { hex: 'a6a434', reg: 'N527P', id: 2, photos: [] };
  const pb = await L.photoJob(b, true);
  check('the monitor with none: looked up as before - FR24\'s stock picture of the type dropped, its JetPhotos one kept', pb.length >= 1 && pb.every(p => !/flightradar24\.com/.test(p.large)) && /jetphotos/.test(pb[0].large), pb.map(p => p.large));
  check('... and sent with the next report, for every other browser', L.photosOut.has('a6a434'));
  await L.reportToMonitor();
  const sent = posts.find(p => Array.isArray(p.photos));
  check('... the report carries them (hex and pictures), then they are not sent again', !!sent && sent.photos.some(r => r[0] === 'a6a434' && r[1].length >= 1) && !L.photosOut.has('a6a434'), sent && sent.photos);
  win.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
