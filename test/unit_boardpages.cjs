// (1.1.5) An airport's board as FR24's own pages - the page part of the BUILT userscript in jsdom, FR24's board API made
// up (100 rows a page, as its server pages). FR24 drawing a fortnight's thousand rows at once held the page (1.6 s by
// itself on FR24's own front-end in Chromium, two minutes with the script's watchers before 1.1.5): now
//   - page 1 is the present - at most 200 rows, from 40 before it - with "earlier" and "later" there is more of
//   - every other page answered from the list kept here, at once - FR24's server never asked
//   - every flight of the board on exactly one page, in time order, walking them all both ways; paging back ends
// usage: node test/unit_boardpages.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '../node_modules');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); };
const T = Math.floor(Date.now() / 1000);
// (FR24's own rows: page 1 from half an hour ago, page -1 the 100 before - six minutes apart)
const nat = (from, n) => Array.from({ length: n }, (_, i) => { const t = from + i * 360; return { id: 700000000 + Math.round(t / 60), flight: { id: (0x3c000000 + Math.round(t / 60) % 0xffffff).toString(16), number: 'FR' + i, callsign: 'RYR' + Math.round(t / 60) }, scheduledTime: t, estimatedTime: t, status: { name: t < T ? 'landed' : 'scheduled', color: 'gray', isAmbiguous: false, live: false }, airportId: 1600, divertedToId: null, airlineId: 7, airline: 'Ryanair', aircraftType: 'B738', runway: null }; });
// (the kept fortnight the userscript hands over: a row every 21 minutes, seven days each way)
const arch = Array.from({ length: 960 }, (_, i) => { const t = T - 7 * 86400 + i * 1260; return { k: 'fk' + i, src: 'sched', fid: (0x5a000000 + i).toString(16), cs: 'EZY' + i, num: 'U2' + i, t, sch: t, est: t, st: t < T ? 'landed' : 'scheduled', col: 'gray', ap: 1600, al: 'easyJet', ty: 'A320', reg: 'G-EZ' + i }; });

(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/airport/2002/lpl/arrivals', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window; w.Response = Response; w.Headers = Headers;
  const net = [];
  w.fetch = (url) => { const u = String(url); net.push(u); const pg = +((u.match(/[?&]page=(-?\d+)/) || [])[1] || 1); const j = { data: pg === -1 ? nat(T - 1800 - 100 * 360, 100) : pg === 1 ? nat(T - 1800, 100) : [], meta: { currentPage: pg, previousPage: pg === 1 ? -1 : null, nextPage: pg === 1 ? 2 : null, hasMorePreviousData: true, hasMoreNextData: true, date: new Date(T * 1000).toISOString().slice(0, 10) } }; return Promise.resolve(new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } })); };
  // (the userscript's side: asked for the board, it hands over the kept rows)
  w.postMessage = d => { if (d && d.__tweeksLadd === 'needBoard') setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'boardArch', apId: d.apId, arr: arch, dep: [] }, source: w, origin: 'https://www.flightradar24.com' })), 50); };
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.indexedDB = undefined;
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) { console.log('FAIL  pageInterceptor not found in the build'); process.exit(1); }
  w.eval('(' + m[0] + ')()');
  const ask = async pg => (await (await w.fetch(`https://www.flightradar24.com/api/v1/airports/2002/arrivals?page=${pg}&limit=100&date=${new Date(T * 1000).toISOString().slice(0, 10)}`)).json());
  const p1 = await ask(1), n0 = net.length;
  const t1 = p1.data.map(e => e.scheduledTime), before = t1.filter(t => t < T - 900).length;
  check('page 1: the present - at most 200 rows, 40 of them before it - and FR24 told there is more earlier and later', p1.data.length === 200 && before === 40 && p1.meta.previousPage === -1 && p1.meta.nextPage === 2 && p1.meta.hasMorePreviousData && p1.meta.hasMoreNextData, { n: p1.data.length, before, meta: p1.meta });
  // ---- every page, both ways
  const seen = new Map(), pages = [[1, p1]]; let dup = 0;
  for (let pg = p1.meta.nextPage, k = 0; pg != null && k < 60; k++) { const r = await ask(pg); pages.push([pg, r]); pg = r.meta.nextPage; }
  for (let pg = p1.meta.previousPage, k = 0; pg != null && k < 60; k++) { const r = await ask(pg); pages.unshift([pg, r]); pg = r.meta.previousPage; }
  check('... every other page answered here, at once - FR24\'s server never asked for one', net.length === n0, net.slice(n0, n0 + 3));
  const order = []; for (const [, r] of pages) for (const e of r.data) { if (seen.has(e.id)) dup++; seen.set(e.id, e); order.push(rowT(e)); }
  function rowT(e) { return e.scheduledTime || e.estimatedTime || e.landedTime || 0; }
  const want = new Set(nat(T - 1800, 100).concat(nat(T - 1800 - 100 * 360, 100)).map(e => e.id)), ours = [...seen.values()].filter(e => e.__tl || e.__tlArch || !want.has(e.id)).length;
  check('... walking them all: every flight of the board on exactly one page - FR24\'s 200 and the kept 960 - in time order', dup === 0 && [...want].every(id => seen.has(id)) && ours >= 900 && order.every((t, i) => !i || order[i - 1] <= t), { pages: pages.length, rows: seen.size, dup, ours, sorted: order.every((t, i) => !i || order[i - 1] <= t) });
  check('... other pages FR24\'s own size (100 rows), the first page back reaching to the start, the last forward to the end', pages.slice(1, -1).filter(([pg]) => pg !== 1).every(([, r]) => r.data.length <= 101) && pages[0][1].meta.previousPage === null && pages[pages.length - 1][1].meta.nextPage === null, pages.map(([pg, r]) => pg + ':' + r.data.length).join(' '));
  // ---- a page further back than there is: empty, leading nowhere
  const beyond = await ask(pages[0][0] - 1);
  check('... a page further back than there is: empty, and no "earlier" again', beyond.data.length === 0 && beyond.meta.previousPage === null && beyond.meta.nextPage === null, beyond.meta);
  // ---- FR24 asking again for page 1 (its refresh): the same pages, none twice
  const again = await ask(1), p2 = await ask(2);
  check('FR24 asking again (its refresh): page 1 the same rows; page 2 still from here, none of page 1\'s in it', JSON.stringify(again.data.map(e => e.id)) === JSON.stringify(p1.data.map(e => e.id)) && !p2.data.some(e => again.data.some(x => x.id === e.id)), { p1: again.data.length, p2: p2.data.length });
  // ---- coming back to the tab 25 minutes later: FR24 asks again for every page it has, all at once (its reload) - each
  // still the same rows, from here; none twice
  const real = w.Date.now.bind(w.Date); let skew = 25 * 60000; w.Date.now = () => real() + skew;
  const n1 = net.length, [b1, b2, b3] = await Promise.all([ask(-1), ask(1), ask(2)]);
  const ids = [...b1.data, ...b2.data, ...b3.data].map(e => e.id);
  check('back to the tab after 25 minutes, FR24 asking again for pages -1, 1 and 2 at once: the same rows each, none twice, only page 1 (and the earlier page it is joined with) asked of FR24', JSON.stringify(b2.data.map(e => e.id)) === JSON.stringify(p1.data.map(e => e.id)) && JSON.stringify(b3.data.map(e => e.id)) === JSON.stringify(p2.data.map(e => e.id)) && ids.length === new Set(ids).size && net.slice(n1).length === 2, { p1: b2.data.length, p2: b3.data.length, pm1: b1.data.length, asked: net.slice(n1).map(u => (u.match(/page=-?\d+/) || [''])[0]) });
  // ---- FR24 opening the board afresh three hours on (its first ask names no page): page 1 at the present again
  skew = 3 * 3600000;
  const fresh = await (await w.fetch(`https://www.flightradar24.com/api/v1/airports/2002/arrivals?limit=100`)).json(), T3 = (real() + skew) / 1000;
  const before3 = fresh.data.filter(e => rowT(e) < T3 - 900).length;
  check('opened afresh three hours on (no page named): page 1 at the present again - 40 rows before it', before3 === 40 && fresh.data.length === 200, { n: fresh.data.length, before3 });
  w.Date.now = real;
  dom.window.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
