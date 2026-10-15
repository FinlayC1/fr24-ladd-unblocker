// The first pictures of an aircraft (the BUILT userscript in jsdom): never JetPhotos' "cb" size, which has the
// photographer's credit bar burnt into the bottom. 4BCE8E's slideshow opened on a short picture with "© Boltushkina
// Anastasia - Kazakhstan Spotting Club - JetPhotos" in it, under FR24's own credit: FR24's own pictures of the blocked
// airframe (sent by the page when the panel first opens, large = 640cb) were taken for the Planespotters answer the
// photo lookup was waiting for, and put on screen uncleaned as its "early" pictures while JetPhotos was still slow.
// Checked:
//   - FR24's own pictures arriving while Planespotters is asked: not taken for its answer, nothing sent with a "cb" size
//   - Planespotters' answer then: the early pictures, clean
//   - FR24's own pictures kept for the airframe: the clean size
// usage: node test/unit_photos.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2];
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };

function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/43.2,76.9/8', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = () => Promise.resolve(new Response('', { status: 404 }));
  // (FR24's registration lookup - the JetPhotos pictures - slow: no answer; everything else not found)
  win.GM_xmlhttpRequest = o => { if (!/api\.flightradar24\.com/.test(o.url)) setTimeout(() => o.onload && o.onload({ status: 404, responseText: '', response: '' }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.__posted = []; win.postMessage = data => { win.__posted.push(data); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => !!L, 10000);
  const hex = '4bce8e', reg = 'UP-CS001', bar = /cdn\.jetphotos\.com\/\d+cb\//i;
  const urls = m => (m.photos || []).flatMap(p => [p.large, p.medium, p.thumb]).filter(Boolean);
  // the page bridge answering, then the page asking for the aircraft's pictures (the panel opened)
  w.postMessage({ __tweeksLadd: 'ready', v: L.version });
  await sleep(50);
  w.postMessage({ __tweeksLadd: 'needPhotos', hex, reg, pri: true });
  const ask = await until(() => w.__posted.find(m => m && m.__tweeksLadd === 'photoReq' && m.hex === hex), 6000);
  check('JetPhotos slow to answer: Planespotters asked of the page meanwhile', !!ask);
  // FR24's own pictures of the airframe, as the page sends them when its panel first opens (large: 640cb)
  w.postMessage({ __tweeksLadd: 'photos', hex, reg, err: '', photos: [{ link: 'https://www.jetphotos.com/photo/11590001', credit: 'Boltushkina Anastasia - Kazakhstan Spotting Club', thumb: 'https://cdn.jetphotos.com/200/6/123456_1790000000_tb.jpg', medium: 'https://cdn.jetphotos.com/400/6/123456_1790000000.jpg', large: 'https://cdn.jetphotos.com/640cb/6/123456_1790000000.jpg', source: 'Flightradar24' }] });
  await sleep(600);
  const done1 = w.__posted.filter(m => m && m.__tweeksLadd === 'photosDone' && m.hex === hex);
  check('FR24\'s own pictures arriving meanwhile: not taken for Planespotters\' answer (no early pictures from them)', !done1.length, done1.map(urls));
  check('... nothing sent to the page with JetPhotos\' credit-bar size', !w.__posted.some(m => m && m.__tweeksLadd === 'photosDone' && urls(m).some(u => bar.test(u))));
  const kept = (L.store.getHex(hex) || {}).photos || [];
  check('... and kept for the airframe in the clean size (640, no "cb")', kept.length === 1 && kept[0].large === 'https://cdn.jetphotos.com/640/6/123456_1790000000.jpg', kept.map(p => p.large));
  // Planespotters' answer: the early pictures
  w.postMessage({ __tweeksLadd: 'photos', hex, reg, err: '', photos: [{ link: 'https://www.planespotters.net/photo/1', credit: 'PS', thumb: 'https://t.plnspttrs.net/1/1_t.jpg', medium: 'https://t.plnspttrs.net/1/1_280.jpg', large: 'https://t.plnspttrs.net/1/1_280.jpg', source: 'Planespotters' }] });
  const early = await until(() => w.__posted.find(m => m && m.__tweeksLadd === 'photosDone' && m.hex === hex && m.early), 4000);
  check('Planespotters\' answer: shown early, while JetPhotos is still being asked', !!early && urls(early).some(u => /plnspttrs/.test(u)) && !urls(early).some(u => bar.test(u)), early && urls(early));
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  harness ' + (e && e.stack || e)); process.exit(1); });
