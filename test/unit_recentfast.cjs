// "Recent <reg> flights" answered in time (the BUILT userscript in jsdom). FR24 draws the list once, from its first answer,
// and the page holds that answer nine seconds at most for the log; the log was handed over only once every day of it had
// been read from the networks - longer than that for a blocked aircraft not looked at before (N1876T, HB-IGO: "No flights
// available"). Here the networks take 20 s a file, and the monitor has the aircraft's flights:
//   - the list handed to the page within a few seconds, with the monitor's flights in it (more than the hidden first row)
//   - the full list still follows once the log is read
// usage: node test/unit_recentfast.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const HIST_V = Number((SRC.match(/const HIST_V = (\d+);/) || [])[1]);
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : ''}`); };
const dayStr = t => { const d = new Date(t); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };
const MON = 'https://143-47-224-210.sslip.io', MONH = { days: {}, legs: [] };
let NET_MS = 20000;
function answer(url) {
  if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [0, 200, AIRPORTS];
  if (url.startsWith(MON + '/status')) return [0, 200, JSON.stringify({ v: 3, since: Date.now() - 3600e3, public: true })];
  const hm = url.match(/^https:\/\/143-47-224-210\.sslip\.io\/hist\?hex=([0-9a-f,]+)/); if (hm) return [0, 200, JSON.stringify({ hv: HIST_V, list: hm[1].split(',').map(hex => ({ hex, days: MONH.days, legs: MONH.legs, part: [] })) })];
  if (/adsb\.lol\/(globe_history|data)|globe\.airplanes\.live\/globe_history/.test(url)) return [NET_MS, 404, ''];
  return [0, 404, ''];
}
const posted = [];
function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/47.4,8.5/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [ms, st, text] = answer(u); return new Promise(r => setTimeout(() => r(new Response(text, { status: st })), ms)); };
  win.GM_xmlhttpRequest = o => { const [ms, st, text] = answer(o.url); const t = setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), ms || 2); return { abort() { clearTimeout(t); } }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = d => posted.push({ at: Date.now(), d });
  win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  await L.monCheck(true).catch(() => null); await sleep(50);
  check('(airports loaded; the monitor up)', L.engine.airports.length > 5000 && L.monUp());
  // HB-IGO's flights the monitor has: Geneva - Athens and Athens - Nice, five days ago
  const D = dayStr(Date.now() - 5 * 864e5), t0 = Date.parse(D.replace(/\//g, '-') + 'T09:48:00Z') / 1000;
  const gva = L.engine.byIcao('LSGG'), ath = L.engine.byIcao('LGAV'), nce = L.engine.byIcao('LFMN');
  const leg = (a, b, ts, te) => ({ day: D, tStart: ts, tEnd: te, from: { id: a.id, code: a.iata, conf: 'ground' }, to: { id: b.id, code: b.iata, conf: 'ground' }, ended: true, startedOnGround: true, cs: 'HUE222', maxAlt: 41000 });
  MONH.days = { [D]: 2 }; MONH.legs = [leg(gva, ath, t0, t0 + 8100), leg(ath, nce, t0 + 14700, t0 + 22600)];
  L.store.mergeHex('4b15ca', { reg: 'HB-IGO', type: 'F2TH', ladd: true });
  const t = Date.now();
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'needHist', reg: 'HB-IGO' }, source: w }));
  const first = await until(() => posted.find(p => p.d && p.d.__tweeksLadd === 'hist' && p.d.reg === 'HB-IGO' && Array.isArray(p.d.data) && p.d.data.length > 1), 8000);
  check('HB-IGO\'s list, the networks taking 20 s a file: handed to the page within a few seconds, with the monitor\'s flights', !!first && first.at - t < 5000 && first.d.data.length >= 2, first && { ms: first.at - t, n: first.d.data.length, partial: first.d.partial });
  const routes = first ? first.d.data.map(r => (r.airport && r.airport.origin && r.airport.origin.code && r.airport.origin.code.iata) + '-' + (r.airport && r.airport.destination && r.airport.destination.code && r.airport.destination.code.iata)) : [];
  // (FR24 hides the first row - the flight on screen: an aircraft not flying has its newest flight there, and again below)
  check('... the rows FR24 shows: Athens - Nice and Geneva - Athens, the newest first', routes.slice(1).join() === 'ATH-NCE,GVA-ATH', routes);
  // (its log already being read in the background, slowly, when the list is asked for: the list joins that read, and is
  // handed over the moment the monitor's flights are in)
  L.store.mergeHex('4b15cb', { reg: 'HB-IGP', type: 'F2TH', ladd: true });
  const bgLoad = L.loadHistory('4b15cb', 40, null, { bg: true }).catch(() => null);
  await sleep(20);
  const t2 = Date.now();
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'needHist', reg: 'HB-IGP' }, source: w }));
  const first2 = await until(() => posted.find(p => p.d && p.d.__tweeksLadd === 'hist' && p.d.reg === 'HB-IGP' && Array.isArray(p.d.data) && p.d.data.length > 1), 8000);
  check('... its log already being read in the background: the list joins that read, handed over within a few seconds', !!first2 && first2.at - t2 < 5000, first2 && { ms: first2.at - t2, n: first2.d.data.length });
  NET_MS = 5;
  await bgLoad;
  const last = await until(() => posted.filter(p => p.d && p.d.__tweeksLadd === 'hist' && p.d.reg === 'HB-IGO' && !p.d.partial).pop(), 60000);
  check('... and the full list once the log is read', !!last && Array.isArray(last.d.data) && last.d.data.length >= 2, last && last.d.data && last.d.data.length);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
