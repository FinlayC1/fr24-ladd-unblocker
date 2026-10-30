// (1.1.5) An airport's board of a fortnight drawn by FR24 - the BUILT userscript and its page part in jsdom. Reproduced on
// FR24's own front-end in Chromium: opening Liverpool's arrivals or departures held the page for two minutes (123.6 s,
// 105 s). The script's watchers of every change to the page read far too much for each empty text node Vue puts in:
//   - the Bookmarks upgrade box's watcher (1.1.2) read the text of the node's grandparent - the whole board - for each
//   - the page part's watcher of the airport panel, for one put in outside the panel, looked the whole panel through
//     three times when the node's parent held it - and one put in inside, the whole list it was put in
// Here: a board of 1,800 rows in the panel, and FR24 putting in 3,000 empty text nodes - between the rows, and in the
// boxes above the panel - and some with words: done in moments, not minutes; what those watchers are for still done (the
// coverage request hidden, an empty box FR24 fills shown again).
// usage: node test/unit_boardfreeze.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(process.env.SRCF || path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); };

(async () => {
  const row = i => `<li id="airport_schedule_${7000000 + i}"><div data-testid="airport-panel__schedules__flight__${7000000 + i}" class="flex"><div class="space-x-1"><span>RYR${1000 + i}</span><span>B738</span></div><span>12:${String(i % 60).padStart(2, '0')}</span><span>Krakow</span><span>KRK</span><span>Landed</span></div></li>`;
  const html = `<!doctype html><html><head></head><body><div id="app" data-v-app=""><div id="shell"><div id="layer"><article data-testid="airport-panel"><header>Liverpool John Lennon Airport</header>
<div class="parts"><div id="beg"><p>Help us improve coverage at this airport</p></div><div id="part1"><button>Disruptions</button></div><div id="part2"><button>Airport statistics</button></div><div id="emptybox" style="height:4px"></div></div>
<main><div data-testid="list-wrapper"><ul id="list">${Array.from({ length: 1800 }, (_, i) => row(i)).join('')}</ul></div></main></article></div></div></div></body></html>`;
  const win = new JSDOM(html, { url: 'https://www.flightradar24.com/airport/2002/lpl/arrivals', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  const answer = url => /mobile\/airports\/format/.test(url) ? [200, AIRPORTS] : [404, ''];
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, t] = answer(u); return Promise.resolve(new Response(t, { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, t] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: t, response: t }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {}; win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  const L = win.__tweeksLadd;
  for (let i = 0; i < 600 && !(L && L.engine.airports.length > 5000); i++) await sleep(50);
  await sleep(1500);
  const d = win.document, list = d.getElementById('list'), shell = d.getElementById('shell'), layer = d.getElementById('layer');
  check('(the page part in: the coverage request already hidden)', d.getElementById('beg').style.display === 'none' || d.getElementById('beg').hasAttribute('data-tl-hidden'));
  // (counted: every read of the words of the board's list or a box holding it, every walk through one - what each of the
  // two watchers did for every empty text node; jsdom's own lookups make its clock useless for this)
  let big = 0; const holdsList = n => !!n && n.nodeType === 1 && n.contains(list);
  const tcD = Object.getOwnPropertyDescriptor(win.Node.prototype, 'textContent');
  Object.defineProperty(win.Node.prototype, 'textContent', { configurable: true, get() { if (holdsList(this)) big++; return tcD.get.call(this); }, set(v) { tcD.set.call(this, v); } });
  const ctw = d.createTreeWalker.bind(d); d.createTreeWalker = (root, ...a) => { if (holdsList(root)) big++; return ctw(root, ...a); };
  // ---- FR24 drawing: 3,000 empty text nodes - Vue's - put in between the rows, and in the boxes that hold the panel
  const t0 = Date.now();
  for (let b = 0; b < 30; b++) {
    for (let k = 0; k < 50; k++) { list.insertBefore(d.createTextNode(''), list.children[(b * 50 + k) % list.children.length]); shell.appendChild(d.createTextNode('')); layer.appendChild(d.createTextNode(' ')); }
    await sleep(0);
  }
  await sleep(300);
  const ms = Date.now() - t0, reads = big;
  check('3,000 empty text nodes put in (30 lots) around a board of 1,800 rows: the whole board read or walked through a few times a lot, not for each node - 1.1.4: 21,148 times, two minutes held on FR24', reads < 300, { reads, ms });
  // ---- what the watchers are for: still done
  const p = d.createElement('div'); p.id = 'beg2'; d.querySelector('.parts').appendChild(p); p.appendChild(d.createTextNode('Help us improve coverage at this airport'));
  await sleep(300);
  check('... words of the coverage request put in: still hidden', d.getElementById('beg2').style.display === 'none' || !!d.getElementById('beg2').closest('[data-tl-hidden]') || d.getElementById('beg2').hasAttribute('data-tl-hidden'), d.getElementById('beg2').outerHTML.slice(0, 120));
  win.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed', e && e.stack || e); process.exit(1); });
