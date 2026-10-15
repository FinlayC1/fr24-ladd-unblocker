// Place names without their county: OurAirports' municipality for Wentworth Private Airstrip is "Rotherham, South
// Yorkshire", and G-FRGP's landing place near it read "Private site near Rotherham, South Yorkshire" (a board row:
// "Rotherham, S..."). Now a place is the part before its first comma, everywhere - unless that would make two different
// places in one list read the same. Checked on the built userscript and its page half:
//   - the cut itself (ENGINE.placeShort), and the page's copy of it agree on a table of names
//   - ENGINE.placeLabels keeps the whole name of places that would read the same
//   - a landing place learned beside Wentworth: "Private site near Rotherham" on the route and in its row for the page
//   - landing places kept by an older version (their long names) are cut when shown
//   - two different towns that cut the same ("Newport, Wales", "Newport, Isle of Wight") keep both names
//   - the airfields the route engine knows are named by their place, without the county
// usage: node test/unit_places.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const OA = fs.readFileSync(path.join(DATA, 'oa_airports.csv'), 'utf8');

function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53.33,-2.85/10', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  const answer = url => /flightradar24\.com\/mobile\/airports\/format/.test(url) ? [200, AIRPORTS] : /ourairports-data\/main\/airports\.csv/.test(url) ? [200, OA] : [404, ''];
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = () => {}; win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  const E = L.engine;

  // ---- the cut
  const table = [['Rotherham, South Yorkshire', 'Rotherham'], ['Rotherham', 'Rotherham'], ['Baker,', 'Baker'], ['Pirrinuan, QLD 4405', 'Pirrinuan'], ['Washington, D.C.', 'Washington'],
    ['  Newcastle   upon Tyne ', 'Newcastle upon Tyne'], [', Ormskirk', 'Ormskirk'], ['Private site near Rotherham, South Yorkshire', 'Private site near Rotherham'], ['', ''], [null, ''], [undefined, ''], [',', '']];
  const bad = table.filter(([a, b]) => E.placeShort(a) !== b).map(([a, b]) => [a, b, E.placeShort(a)]);
  check('placeShort: the part before the first comma', !bad.length, bad);
  // the page's copy of it
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.flightradar24.com/', runScripts: 'dangerously' });
  const pw = dom.window; let H = null; pw.__tlTestHook = h => { H = h; };
  pw.postMessage = () => {}; pw.unsafeWindow = pw; pw.GM_xmlhttpRequest = () => {}; pw.fetch = () => Promise.reject(new Error('offline')); pw.indexedDB = undefined;
  pw.localStorage.setItem('tl.sites', JSON.stringify([{ id: 9000001, name: 'Private site near Rotherham, South Yorkshire', city: 'Rotherham, South Yorkshire', iata: 'PVT' }]));
  pw.eval('(' + SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0] + ')()');
  check('the page\'s copy agrees with the engine on every name', !!H.placeShort && table.every(([a]) => H.placeShort(a) === E.placeShort(a)));
  const lsRows = (() => { const j = { rows: new Array(120).fill(0).map((_, i) => ({ id: i + 1 })) }; H.patchList('airports', j); return j.rows.filter(r => r.id >= 9e6); })();
  check('landing places the page kept from an older version: cut when added to FR24\'s list', lsRows.length === 1 && lsRows[0].city === 'Rotherham' && lsRows[0].name === 'Private site near Rotherham', lsRows[0]);

  // ---- places in one list
  const lab = E.placeLabels(['Newport, Wales', 'Newport, Isle of Wight', 'Rotherham, South Yorkshire', 'Rotherham, South Yorkshire', 'Ormskirk']);
  check('two different places that cut the same keep their whole names; the same place twice and the rest are cut', lab.get('Newport, Wales') === 'Newport, Wales' && lab.get('Newport, Isle of Wight') === 'Newport, Isle of Wight' && lab.get('Rotherham, South Yorkshire') === 'Rotherham' && lab.get('Ormskirk') === 'Ormskirk', [...lab]);

  // ---- a landing place learned beside Wentworth Private Airstrip (OurAirports' municipality: Rotherham, South Yorkshire)
  await L.loadSites();
  await until(() => L.engine.airports.length > 5000, 1000);
  const lat = 53.4, lon = -1.4;     // (a few km from the strip, in open country)
  const p = L.privatePlace(lat, lon, {});
  check('a spot near Rotherham: "Private site near Rotherham" - the county is not in the name', /^Private site near [A-Z]/.test(p.name) && !/,/.test(p.name), p.name);
  check('... the whole name kept for telling places apart', p.full === p.name || /, /.test(p.full), p.full);
  // the same from an older version's book: its names have the county
  const bk = L.siteBk();
  bk.list.push({ id: 9000001, lat, lon, name: 'Private site near Rotherham, South Yorkshire', city: 'Rotherham, South Yorkshire', code: 'PVT', apId: E.byIcao('EGGP').id, alt: 0, n: 1, first: 1, last: 1, named: false });
  const row = L.siteRow(bk.list[bk.list.length - 1]);
  check('a landing place kept by an older version: shown as Rotherham', row.city === 'Rotherham' && row.name === 'Private site near Rotherham', [row.city, row.name]);
  bk.list.push({ id: 9000002, lat: lat + 0.5, lon, name: 'Private site near Newport, Wales', city: 'Newport, Wales', code: 'PVT', apId: E.byIcao('EGGP').id, alt: 0, n: 1, first: 1, last: 1, named: false });
  bk.list.push({ id: 9000003, lat: lat - 0.5, lon, name: 'Private site near Newport, Isle of Wight', city: 'Newport, Isle of Wight', code: 'PVT', apId: E.byIcao('EGGP').id, alt: 0, n: 1, first: 1, last: 1, named: false });
  // (the labels are worked out when first needed and again after a change)
  L.learnSite(lat + 1, lon + 1, {});
  await sleep(50);
  const n1 = L.siteRow(bk.list.find(x => x.id === 9000002)), n2 = L.siteRow(bk.list.find(x => x.id === 9000003));
  check('"Newport, Wales" and "Newport, Isle of Wight" kept apart', n1.city === 'Newport, Wales' && n2.city === 'Newport, Isle of Wight', [n1.city, n2.city]);
  // ---- the airfields the engine knows
  const wf = E.byIcao('GB-0592');
  check('airfields: Wentworth Private Airstrip (Rotherham, South Yorkshire) is Wentworth, its town Rotherham', !!wf && wf.city === 'Wentworth' && wf.town === 'Rotherham' && wf.townFull === 'Rotherham, South Yorkshire', wf && [wf.city, wf.town, wf.townFull]);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
