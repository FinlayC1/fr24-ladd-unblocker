// Every saved flight log deleted, once (the BUILT userscript in jsdom, a real IndexedDB - fake-indexeddb - holding what an
// older build saved). Checked:
//   - first run of this version: the full logs (key: the address) and today's tracks (t:<address>) deleted from disk, and
//     every aircraft record's compact recent flights emptied - the rest of those records kept
//   - what was learned (x:...), airport boards (b:...) and everything else kept
//   - the reset noted, so the next start deletes nothing: a log built since is kept
//   - the window's "Rebuild flight logs" button: deletes them again, on a second click within five seconds; one click only asks
// usage: node test/unit_logreset.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : ''}`); };

const idb = new FIDB.IDBFactory();
const open = () => new Promise((res, rej) => { const r = idb.open('tweeks-ladd', 2); r.onupgradeneeded = () => { for (const s of ['id', 'hex', 'kv', 'hist']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const put = (db, store, key, val) => new Promise(res => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(val, key); tx.oncomplete = res; });
const keys = (db, store) => new Promise(res => { const out = []; const r = db.transaction(store, 'readonly').objectStore(store).openCursor(); r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); }; });
const LS = new Map();   // (one browser's localStorage across the windows)

function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/47.4,8.5/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = idb; win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  for (const [k, v] of LS) win.localStorage.setItem(k, v);
  win.fetch = () => Promise.resolve(new Response('', { status: 404 }));
  win.GM_xmlhttpRequest = o => { setTimeout(() => o.onload && o.onload({ status: 404, responseText: '', response: '' }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = () => {}; win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}
const lsSave = win => { for (let i = 0; i < win.localStorage.length; i++) { const k = win.localStorage.key(i); LS.set(k, win.localStorage.getItem(k)); } };

(async () => {
  // what an older build saved
  let db = await open();
  await put(db, 'hist', '4b15ca', { v: 5, days: { '2026/10/01': true }, legs: [{ day: '2026/10/01', tStart: 1, tEnd: 2 }], savedAt: 1 });
  await put(db, 'hist', '3c7b00', { v: 6, days: {}, legs: [], savedAt: 1 });
  await put(db, 'hist', 't:4b15ca', { at: Date.now(), sums: [{ tStart: 1 }], legs: [] });
  await put(db, 'hist', 'x:learn', { rows: [1, 2, 3] });
  await put(db, 'hist', 'b:123', { rows: ['board'] });
  await put(db, 'hist', 'b:sites1', { at: 1, rows: [] });
  await put(db, 'hex', '4b15ca', { hex: '4b15ca', reg: 'HB-IGO', type: 'F2TH', ladd: true, recent: [[1, 2, 10, 11, 'ground', 'ground', 'HUE222', 41000, 1]], savedAt: Date.now() });
  db.close();

  // ---- first run: deleted
  let w = makeWin(), L = await until(() => w.__tweeksLadd, 10000);
  await until(() => LS.size || w.localStorage.getItem('tweeks.fr24.ladd.logreset'), 15000);
  await sleep(1500); lsSave(w);
  db = await open();
  const hist = (await keys(db, 'hist')).map(x => x[0]).sort(), hexes = await keys(db, 'hex');
  check('first run of this version: the saved logs and today\'s tracks deleted from disk', !hist.includes('4b15ca') && !hist.includes('3c7b00') && !hist.includes('t:4b15ca'), hist);
  check('... what was learned (x:) and the boards (b:) kept', hist.includes('x:learn') && hist.includes('b:123') && hist.includes('b:sites1'), hist);
  const rec = (hexes.find(x => x[0] === '4b15ca') || [])[1] || {};
  check('... the aircraft\'s compact recent flights emptied, the rest of its record kept', Array.isArray(rec.recent) && rec.recent.length === 0 && rec.reg === 'HB-IGO' && rec.ladd === true, rec);
  check('... the reset noted so it is not done again', LS.get('tweeks.fr24.ladd.logreset') === '22.31.7', LS.get('tweeks.fr24.ladd.logreset'));
  check('... and nothing of the old log in memory either', !L.store.peekHist('4b15ca') && !((L.store.getHex('4b15ca') || {}).recent || []).length);
  db.close(); w.close();

  // ---- next start: a log built since is kept
  db = await open(); await put(db, 'hist', '4b15ca', { v: 6, days: { '2026/10/02': 'b' }, legs: [{ day: '2026/10/02', tStart: 5, tEnd: 6 }], savedAt: 2 }); db.close();
  w = makeWin(); L = await until(() => w.__tweeksLadd, 10000); await L.store.ready; await sleep(1500);
  db = await open(); const again = (await keys(db, 'hist')).map(x => x[0]); db.close();
  check('the next start: the log built since is kept', again.includes('4b15ca'), again);

  // ---- the window's button: one click asks, a second within five seconds deletes
  L.openUnblockWindow(); await sleep(800);
  const btn = () => w.document.querySelector('[data-ub-act="logReset"]');
  const press = () => btn() && btn().dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const present = !!(await until(() => btn(), 5000));
  press(); await sleep(300);
  db = await open(); const afterOne = (await keys(db, 'hist')).map(x => x[0]); db.close();
  check('the button "Rebuild flight logs": there; one click only asks - nothing deleted, "Click again to delete" shown', present && afterOne.includes('4b15ca') && /Click again to delete/.test((btn() || {}).textContent || ''), { present, afterOne, text: (btn() || {}).textContent });
  press(); await sleep(1500);
  db = await open(); const afterTwo = (await keys(db, 'hist')).map(x => x[0]); db.close();
  check('... a second click: every saved log deleted, what was learned kept, the result said', !afterTwo.includes('4b15ca') && afterTwo.includes('x:learn') && /Deleted \d+ saved logs/.test((w.document.querySelector('.tl-ub-c') || {}).textContent || ''), afterTwo);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
