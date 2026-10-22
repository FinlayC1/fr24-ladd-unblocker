// A blocked aircraft's pictures where FR24's registration lookup holds them back (the BUILT userscript in jsdom). HB-IGO
// (4B15CA, a Falcon 2000LXS, LADD): four pictures on JetPhotos, two on FR24's own aircraft page, none in FR24's lookup -
// its panel said "Aircraft photo not available": the lookup's empty answer was taken for "JetPhotos has none", and
// JetPhotos itself was asked only when FR24's lookup failed outright. Checked:
//   - FR24's lookup with no pictures: FR24's own page of the aircraft read - its JetPhotos pictures, their photo pages and
//     credits, the large size; JetPhotos itself not asked
//   - FR24's page with none either: JetPhotos itself asked, its pictures used
//   - FR24's lookup with pictures: those, and nothing else asked
//   - the page's pictures read from its markup: each picture with its own photo page and credit
// usage: node test/unit_photopage.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 500) : ''}`); };

// (FR24's aircraft page: its header's two JetPhotos pictures, as the page shows them - the rest of the page around them)
const PAGE = `<!doctype html><html><body><div id="cnt-aircraft-info">Flight history for aircraft - HB-IGO</div>
<div class="row" id="cnt-aircraft-photo">
 <div class="col-xs-6"><a href="https://www.jetphotos.com/photo/11834521" target="_blank" rel="noopener"><img src="https://cdn.jetphotos.com/400/6/11834521_1736791234.jpg" alt="HB-IGO"></a><div class="photo-credit">&copy; Hanjo Schrenk | JetPhotos</div></div>
 <div class="col-xs-6"><a href="https://www.jetphotos.com/photo/11790002" target="_blank" rel="noopener"><img src="//cdn.jetphotos.com/400/5/11790002_1730000000.jpg" alt="HB-IGO"></a><div class="photo-credit">© Gilda Thode | JetPhotos</div></div>
</div><footer><a href="https://www.jetphotos.com/">Upload your photos</a></footer></body></html>`;
const JP_HTML = `<div class="result" data-photo="900001"><img src="//cdn.jetphotos.com/400/6/900001_1.jpg"><span class="result__infoListText--photographer"><a href="#">Andre Bonn</a></span>Aircraft: <a href="#">Dassault Falcon 2000LX</a> Serial #: <a href="#">347</a> Photo date: <a href="#">2024-01-16</a></div>`;
const listAnswer = images => JSON.stringify({ result: { response: { item: { current: 0 }, data: null, aircraftInfo: { model: { text: 'Dassault Falcon 2000LXS EASy II' }, airline: { name: 'Cat Aviation' } }, aircraftImages: images } } });
const FR24_IMAGES = [{ registration: 'HB-IGO', images: { thumbnails: [{ src: 'https://cdn.jetphotos.com/200/6/700001_1.jpg', link: 'https://www.jetphotos.com/photo/700001', copyright: 'FR24 own' }], medium: [{ src: 'https://cdn.jetphotos.com/400/6/700001_1.jpg' }], large: [{ src: 'https://cdn.jetphotos.com/640/6/700001_1.jpg' }] } }];

function makeWin(o) {
  const asked = [];
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/52.2,0.1/8', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = (input) => {
    const u = String(typeof input === 'string' ? input : input.url); asked.push(u);
    if (/\/data\/aircraft\/hb-igo$/.test(u)) return Promise.resolve(new Response(o.page || '<html><body>no pictures</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    return Promise.resolve(new Response('', { status: 404 }));
  };
  win.GM_xmlhttpRequest = r => {
    asked.push(r.url);
    let st = 404, body = '';
    if (/api\.flightradar24\.com\/common\/v1\/flight\/list\.json/.test(r.url)) { st = 200; body = listAnswer(o.images || []); }
    else if (/jetphotos\.com\/(showphotos|registration)/.test(r.url)) { st = 200; body = o.jp || '<p>No photos found</p>'; }
    setTimeout(() => r.onload && r.onload({ status: st, responseText: body, response: body }), 2);
    return { abort() {} };
  };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = data => setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0);
  win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return { win, asked };
}
const rec = () => ({ id: 0x3d000001, hex: '4b15ca', reg: 'HB-IGO', type: 'F2TH', desc: 'Dassault Falcon 2000LXS', ladd: true, photos: [], photoLevel: 0 });

(async () => {
  // ---- FR24's lookup holding the pictures back: FR24's own page of the aircraft
  { const { win, asked } = makeWin({ page: PAGE }), L = await until(() => win.__tweeksLadd, 10000);
    const r = rec(), ph = await L.photoJob(r, true);
    check('HB-IGO, FR24\'s lookup holding its pictures back: FR24\'s own aircraft page read', asked.some(u => /\/data\/aircraft\/hb-igo$/.test(u)), asked.filter(u => !/\.json/.test(u)));
    check('... its two JetPhotos pictures, each with its own photo page and credit', ph.length === 2 && ph[0].link === 'https://www.jetphotos.com/photo/11834521' && ph[0].credit === 'Hanjo Schrenk' && ph[1].link === 'https://www.jetphotos.com/photo/11790002' && ph[1].credit === 'Gilda Thode', ph.map(p => [p.link, p.credit]));
    check('... at the large size, the page\'s own as the small one', ph[0].large === 'https://cdn.jetphotos.com/640/6/11834521_1736791234.jpg' && ph[1].thumb === 'https://cdn.jetphotos.com/400/5/11790002_1730000000.jpg', ph.map(p => [p.large, p.thumb]));
    check('... kept on the aircraft as JetPhotos pictures; JetPhotos itself not asked', r.photos.length === 2 && r.photos.every(p => p.source === 'JetPhotos') && !asked.some(u => /jetphotos\.com\/(showphotos|registration)/.test(u)), asked.filter(u => /jetphotos/.test(u)));
    win.close(); }
  // ---- FR24's page with none either: JetPhotos itself
  { const { win, asked } = makeWin({ jp: JP_HTML }), L = await until(() => win.__tweeksLadd, 10000);
    const r = rec(), ph = await L.photoJob(r, true);
    check('FR24\'s lookup and its page with no pictures: JetPhotos itself asked, its pictures used', asked.some(u => /jetphotos\.com\/(showphotos|registration)/.test(u)) && ph.length === 1 && ph[0].link === 'https://www.jetphotos.com/photo/900001', { ph: ph.map(p => p.link), asked: asked.filter(u => /jetphotos|data\/aircraft/.test(u)) });
    win.close(); }
  // ---- FR24's lookup with pictures: those, nothing else asked
  { const { win, asked } = makeWin({ images: FR24_IMAGES, page: PAGE }), L = await until(() => win.__tweeksLadd, 10000);
    const r = rec(), ph = await L.photoJob(r, true);
    check('FR24\'s lookup with pictures: those, its page and JetPhotos not asked', ph.length >= 1 && ph[0].link === 'https://www.jetphotos.com/photo/700001' && !asked.some(u => /\/data\/aircraft\/|jetphotos\.com\/(showphotos|registration)/.test(u)), { ph: ph.map(p => p.link), asked: asked.filter(u => /jetphotos|data\/aircraft/.test(u)) });
    win.close(); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
