// An airport board keeps its place while it fills (1.0.1) - the page-world part of the BUILT userscript in jsdom, the
// board's layout made up (rows 40 px tall, one under another, the list scrolled by its <main>):
//   - opened: the present brought up (the first row from a quarter of an hour ago, 36 px below the top)
//   - re-read with days of kept flights come in above: the row at the top of the view stays where it was - it went "two
//     days behind" without a touch
//   - a row gone from the new list: the one nearest its time held instead
//   - moved by the user (wheel, touch, a key, a click): left where they put it
//   - the board's kept flights waited for the first time it opens (two seconds at most), so it is drawn whole - its
//     blocked aircraft's rows were "N/A" until a re-read; a copy kept from before used at once
// usage: node test/unit_boardplace.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2];
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><main id="m"><div data-testid="list-wrapper"><ul id="list"></ul></div></main></body></html>', { url: 'https://www.flightradar24.com/airport/egll', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  let H = null; w.__tlTestHook = h => { H = h; };
  const posted = []; w.postMessage = d => posted.push(d);
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.fetch = () => Promise.reject(new Error('offline')); w.indexedDB = undefined;
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) { console.log('FAIL  pageInterceptor not found in the build'); process.exit(1); }
  w.eval('(' + m[0] + ')()');
  check('page-world test hook: the board\'s place', !!(H && H.placeBoard && H.stopBoardHold && H.needBoardArch));
  // (the layout: <main> at 100 px, 400 px tall; each row 40 px under the one before, moved up by the scroll)
  const main = doc.getElementById('m'), list = doc.getElementById('list'), ROW = 40, TOP = 100;
  let st = 0; Object.defineProperty(main, 'scrollTop', { get: () => st, set: v => { st = Math.max(0, v); } });
  main.getBoundingClientRect = () => ({ top: TOP, bottom: TOP + 400, left: 0, right: 300, height: 400, width: 300 });
  const rowsNow = () => [...list.querySelectorAll('[data-testid^="airport-panel__schedules__flight__"]')];
  const layout = () => rowsNow().forEach((el, i) => { el.getBoundingClientRect = () => ({ top: TOP + i * ROW - st, bottom: TOP + (i + 1) * ROW - st, left: 0, right: 300, height: ROW, width: 300 }); });
  // (FR24 drawing its list again: every row new)
  const draw = data => { list.innerHTML = data.map(e => `<li><div data-testid="airport-panel__schedules__flight__${e.id}">${e.id}</div></li>`).join(''); layout(); };
  const offOf = id => { const el = doc.querySelector(`[data-testid="airport-panel__schedules__flight__${id}"]`); return el ? el.getBoundingClientRect().top - TOP : null; };
  const nowS = Math.floor(Date.now() / 1000);
  const rows = (from, to) => { const out = []; for (let t = from; t <= to; t += 1800) out.push({ id: 5000000000 + Math.round(t / 60), scheduledTime: t }); return out; };
  const settle = async () => { for (let i = 0; i < 6; i++) { layout(); await sleep(60); } };
  const firstOf = data => data.filter(e => e.scheduledTime >= nowS - 900)[0];

  // ---- opened: the present at the top
  let data = rows(nowS - 86400, nowS + 86400); draw(data);
  H.placeBoard(firstOf(data), '507/arrivals', data); await settle();
  check('opened: the present brought up - the first row from a quarter of an hour ago 36 px below the top', Math.abs(offOf(firstOf(data).id) - 36) <= 1, { off: offOf(firstOf(data).id), st });
  // ---- re-read: two more days of kept flights in above - the row at the top stays where it is
  const top0 = rowsNow().find(el => el.getBoundingClientRect().bottom > TOP + 1), topId = top0.getAttribute('data-testid').slice(34), off0 = top0.getBoundingClientRect().top - TOP;
  data = rows(nowS - 3 * 86400, nowS + 86400);
  H.placeBoard(firstOf(data), '507/arrivals', data); draw(data); await settle();
  check('re-read with two days of rows come in above: the row at the top of the view where it was (not two days behind)', Math.abs(offOf(topId) - off0) <= 1, { before: off0, after: offOf(topId), st });
  // ---- a later re-read where that row is gone (shown under another id now): the nearest by time held
  const gone = Number(topId), t0 = data.find(e => e.id === gone).scheduledTime;
  data = data.map(e => e.id === gone ? { id: 7000000000 + 1, scheduledTime: e.scheduledTime } : e).concat(rows(nowS - 4 * 86400, nowS - 3 * 86400 - 1800)).sort((a, b) => a.scheduledTime - b.scheduledTime);
  H.placeBoard(firstOf(data), '507/arrivals', data); draw(data); await settle();
  const newTop = rowsNow().find(el => el.getBoundingClientRect().bottom > TOP + 1);
  check('... a row gone from the new list (another id now): the one at its time held instead', Math.abs(Number(newTop.getAttribute('data-testid').slice(34)) - 7000000001) === 0 || Math.abs(data.find(e => String(e.id) === newTop.getAttribute('data-testid').slice(34)).scheduledTime - t0) <= 1800, { top: newTop.getAttribute('data-testid').slice(34) });
  // ---- the user moves the list: left there through the next re-read's drawing
  H.placeBoard(firstOf(data), '507/arrivals', data);
  main.dispatchEvent(new w.WheelEvent('wheel', { bubbles: true, deltaY: 120 })); st += 480; layout();
  const userSt = st; draw(data.concat(rows(nowS + 86400 + 1800, nowS + 2 * 86400))); await settle();
  check('moved by the user (wheel): left where they put it', st === userSt, { st, userSt });
  // ---- another board: the present again
  data = rows(nowS - 86400, nowS + 86400);
  H.placeBoard(firstOf(data), '507/departures', data); draw(data); await settle();
  check('another board opened (departures): the present brought up again', Math.abs(offOf(firstOf(data).id) - 36) <= 1, offOf(firstOf(data).id));

  // ---- the kept flights waited for the first time a board opens - two seconds at most; a copy kept used at once
  const tA = Date.now(); const pA = H.needBoardArch(608);
  setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'boardArch', apId: 608, arr: [{ k: 'x', t: nowS }], dep: [] }, origin: 'https://www.flightradar24.com', source: w })), 300);
  const a1 = await pA, dtA = Date.now() - tA;
  check('a board opened the first time: its kept flights waited for (they came in 0.3 s) - drawn whole, not "N/A" until a re-read', !!a1 && a1.arr.length === 1 && dtA >= 250 && dtA < 1500, { got: !!a1, dtA });
  const tB = Date.now(), a2 = await H.needBoardArch(609), dtB = Date.now() - tB;
  check('... none coming: FR24\'s board goes on after two seconds', a2 === null && dtB >= 1900 && dtB < 3000, { dtB });
  check('... the board asked of the userscript', posted.some(d => d && d.__tweeksLadd === 'needBoard' && d.apId === 608));
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
