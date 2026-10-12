// FIR / UIR lookups through the BUILT userscript (real network: the EUROCONTROL atlas), position and height.
// usage: node test/fir_check.cjs <node_modules>
const fs = require('fs');
const path = require('path');
const NM = process.argv[2];
const { JSDOM } = require(path.join(NM, 'jsdom'));
const { indexedDB, IDBKeyRange } = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const { execFile } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const curl = url => new Promise((res, rej) => execFile('curl', ['-s', '--compressed', '-L', '-w', '\n%{http_code}', url], { maxBuffer: 64e6 }, (err, out) => { if (err) return rej(err); const i = out.lastIndexOf('\n'); res(new Response(out.slice(0, i), { status: Number(out.slice(i + 1)) || 0 })); }));
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/', runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window;
w.indexedDB = indexedDB; w.IDBKeyRange = IDBKeyRange; w.Response = Response; w.Headers = Headers; w.AbortController = AbortController;
w.fetch = u => curl(typeof u === 'string' ? u : u.url);
w.GM_xmlhttpRequest = o => { curl(o.url).then(r => r.text().then(t => o.onload && o.onload({ status: r.status, responseText: t, response: t }))).catch(e => o.onerror && o.onerror({ error: String(e) })); return { abort() {} }; };
w.unsafeWindow = w; w.GM_notification = () => {};
w.postMessage = () => {};
w.console.debug = () => {};
(async () => {
  w.eval(SRC);
  const L = w.__tweeksLadd;
  await L.loadFir();
  for (let i = 0; i < 120 && !L.firAt(51.47, -0.45); i++) await sleep(250);
  const cases = [
    ['EJU958Q near Beauvais FL260', 49.291, 2.029, 25950, /France UIR/],
    ['same place 9,000 ft', 49.291, 2.029, 9000, /Paris FIR/],
    ['Lille 4,000 ft', 50.56, 3.09, 4000, /Paris FIR/],
    ['Paris height unknown', 48.85, 2.35, NaN, /Paris FIR/],
    ['Brest FL100', 48.45, -4.42, 10000, /Brest FIR/],
    ['Frankfurt 12,000 ft', 50.03, 8.57, 12000, /Langen FIR/],
    ['Frankfurt FL360', 50.03, 8.57, 36000, /Rhein UIR/],
    ['Hamburg FL360', 53.63, 9.99, 36000, /UIR/],
    ['Heathrow FL100', 51.47, -0.45, 10000, /London FIR/],
    ['Heathrow FL350', 51.47, -0.45, 35000, /London UIR/],
    ['Shanwick FL370', 55, -20, 37000, /Shanwick|EGGX/i],
    ['Lodz 1,500 ft', 51.72, 19.39, 1500, /Warszawa/i],
    ['Moscow FL350', 55.6, 37.3, 35000, /Moscow|Moskva|UUWV/i],
    ['New York 30,000 ft', 40.64, -73.78, 30000, /New York/i],
    ['Anchorage FL300', 61.17, -150.0, 30000, /Anchorage|Alaska|PAZA/i],
    ['Fiji 3,000 ft', -17.75, 177.44, 3000, /Nadi|NFFF/i],
    ['Tokyo', 35.55, 139.78, 20000, /^Fukuoka FIR$/],
    ['Chicago FL350', 41.97, -87.9, 35000, /^Chicago Center$/],
    ['Toronto 8,000 ft', 43.68, -79.63, 8000, /^Toronto FIR$/],
    ['Sydney', -33.95, 151.18, 20000, /Brisbane|Melbourne|Y/i]
  ];
  let bad = 0;
  for (const [nm, la, lo, alt, re] of cases) {
    const f = L.firAt(la, lo, alt), s = f ? `${f.name} [${f.id}] FL${f.lo}-${f.hi}` : '-';
    const ok = !!f && (re.test(f.name) || re.test(f.id)); if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${nm}: ${s}`);
  }
  const t0 = Date.now(); for (let i = 0; i < 2000; i++) L.firAt(40 + (i % 30), -10 + (i % 50), 30000); console.log('2000 lookups', Date.now() - t0, 'ms');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('HARNESS', e); process.exit(2); });
