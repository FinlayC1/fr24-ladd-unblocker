// A flight log never has a hole where adsb.lol had no file (the BUILT userscript in jsdom). N527P's log was empty from
// 11 Sep to 20 Oct - its last 40 days, the ones read from adsb.lol - though airplanes.live has its flights: every day
// adsb.lol answered "no file" for was kept as a day without flights, and never read again, and "Recent N527P flights"
// (21 days) had nothing to list. Here adsb.lol has no file for any day and airplanes.live has M-ARNZ's flights of one:
//   - looked at (the log page, the panel's list): airplanes.live asked for every such day - that day's flights in the log,
//     the others days without flights (both networks have none)
//   - in the background (adsb.lol only): no day taken for a day without flights - asked again later, not at once
//   - a log kept by an older build with those days empty: read again
// usage: node test/unit_histgap.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const HIST_V = Number((SRC.match(/const HIST_V = (\d+);/) || [])[1]);
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };

// M-ARNZ's 7 Oct (Barrow - Bristol - Barrow - Farnborough - Barrow), moved to a day five days ago
const dayStr = t => { const d = new Date(t); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };
const TARGET = dayStr(Date.now() - 5 * 864e5), T0 = Date.parse(TARGET.replace(/\//g, '-') + 'T00:00:00Z') / 1000;
const TRACE = Object.assign(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/424c60/2026-10-07_lol.json.gz'))).toString()), { timestamp: T0 });
const asked = [], MON = 'https://143-47-224-210.sslip.io', MONH = { on: false, days: {}, legs: [] };
function answer(url) {
  if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
  if (url.startsWith(MON)) {
    if (!MONH.on) return [404, ''];
    if (url.startsWith(MON + '/status')) return [200, JSON.stringify({ v: 3, since: Date.now() - 3600e3, public: true })];
    const hm = url.match(/\/hist\?hex=([0-9a-f,]+)/); if (hm) { asked.push(['mon', hm[1]]); return [200, JSON.stringify({ hv: HIST_V, list: hm[1].split(',').map(hex => ({ hex, days: MONH.days, legs: MONH.legs })) })]; }
    return [404, ''];
  }
  let m = url.match(/^https:\/\/adsb\.lol\/(?:globe_history\/[\d/]+|data)\/traces\/\w\w\/trace_full_(\w{6})\.json/);
  if (m) { asked.push(['lol', m[1], url]); return [404, '']; }
  m = url.match(/^https:\/\/globe\.airplanes\.live\/globe_history\/([\d/]+)\/traces\/\w\w\/trace_full_(\w{6})\.json/);
  if (m) { asked.push(['apl', m[2], m[1]]); return m[1] === TARGET ? [200, JSON.stringify(Object.assign({}, TRACE, { icao: m[2] }))] : [404, '']; }
  return [404, ''];
}
function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/53.33,-2.85/10', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
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
  check('(airports loaded; the log format version read from the build)', L.engine.airports.length > 5000 && HIST_V > 0, [L.engine.airports.length, HIST_V]);
  const days = n => Array.from({ length: n }, (_, i) => dayStr(Date.now() - (i + 1) * 864e5));
  const flightsOn = (h, d) => (h.legs || []).filter(l => l.day === d);

  // ---- looked at: both networks for each day adsb.lol has no file of
  L.store.mergeHex('424c60', { reg: 'M-ARNZ', type: 'PC24', ladd: true });
  asked.length = 0;
  await L.loadHistory('424c60', 10, null, { front: true });
  let h = await L.store.getHist('424c60');
  const fl = flightsOn(h, TARGET);
  check('looked at, adsb.lol with no file for any day: airplanes.live asked for each of them', days(10).every(d => asked.some(a => a[0] === 'apl' && a[2] === d)), asked.filter(a => a[0] === 'apl').length);
  check('... its flights of that day in the log (Barrow - Bristol - Barrow - Farnborough - Barrow), not a day without flights', fl.length >= 3, fl.map(l => [l.from && l.from.code, l.to && l.to.code]));
  check('... the other days, which neither network has, are days without flights - done, not asked again', days(10).every(d => h.days[d]) && !Object.keys(h.miss || {}).length, Object.keys(h.miss || {}));
  asked.length = 0; await L.loadHistory('424c60', 10, null, { front: true });
  check('... and not asked again next time', asked.length === 0, asked.length);

  // ---- in the background: adsb.lol only - nothing taken for a day without flights
  L.store.mergeHex('4ca001', { reg: 'EI-TST', type: 'PC24', ladd: true });
  asked.length = 0;
  await L.loadHistory('4ca001', 10, null, { bg: true });
  h = (await L.store.getHist('4ca001')) || { days: {}, legs: [] };
  check('in the background, adsb.lol with no file: airplanes.live not asked (the background never asks it)', !asked.some(a => a[0] === 'apl') && asked.filter(a => a[0] === 'lol').length === 10, asked.map(a => a[0]));
  check('... no day taken for a day without flights - each noted to be asked again', days(10).every(d => !h.days[d] && h.miss && h.miss[d] > 0), { days: Object.keys(h.days || {}).length, miss: Object.keys(h.miss || {}).length });
  asked.length = 0; await L.loadHistory('4ca001', 10, null, { bg: true });
  check('... and not asked again at once (a day later for the last three days, a week for older ones)', asked.length === 0, asked.length);
  asked.length = 0; await L.loadHistory('4ca001', 10, null, { front: true });
  h = await L.store.getHist('4ca001');
  check('... looked at afterwards: read at once, both networks - the day with flights has them', flightsOn(h, TARGET).length >= 3 && asked.some(a => a[0] === 'apl'), flightsOn(h, TARGET).length);

  // ---- a log kept by an older build: those days empty, taken as days without flights
  L.store.mergeHex('4ca002', { reg: 'EI-OLD', type: 'PC24', ladd: true });
  L.store.setHist('4ca002', { v: HIST_V - 1, vm: 1, days: Object.fromEntries(days(10).map(d => [d, true])), legs: [], savedAt: Date.now() });
  asked.length = 0;
  await L.loadHistory('4ca002', 10, null, { front: true });
  h = await L.store.getHist('4ca002');
  check('a log kept by an older build, with its days empty: not used - rebuilt from scratch, both networks; the flights are there', flightsOn(h, TARGET).length >= 3 && asked.filter(a => a[0] === 'lol').length === 10 && asked.filter(a => a[0] === 'apl').length === 10 && h.v === HIST_V, flightsOn(h, TARGET).length);

  // ---- a log kept by 22.31.0 (its days without flights taken back from the monitor): read again too
  L.store.mergeHex('4ca003', { reg: 'EI-VM2', type: 'PC24', ladd: true });
  L.store.setHist('4ca003', { v: HIST_V, days: Object.fromEntries(days(10).map(d => [d, 'l'])), legs: [], savedAt: Date.now() });
  await L.loadHistory('4ca003', 10, null, { front: true });
  check('a day read from adsb.lol alone (the background): read again with both networks once looked at - the flights are there', flightsOn(await L.store.getHist('4ca003'), TARGET).length >= 3);

  // ---- the monitor giving days as without flights (it watched and did not hear it; adsb.lol had no file): not taken -
  // TC-ACN's London - Istanbul of 13 Sep and Larnaca - Istanbul of 26 Sep, on airplanes.live, were lost so
  { MONH.on = true; await L.monCheck(true); await sleep(50);
    const D2 = dayStr(Date.now() - 3 * 864e5), lpl = L.engine.byIcao('EGGP'), blk = L.engine.byIcao('EGNH'), t2 = Date.parse(D2.replace(/\//g, '-') + 'T10:00:00Z') / 1000;
    MONH.days = Object.fromEntries(days(10).map(d => [d, d === D2 ? 1 : 0]));
    MONH.legs = [{ day: D2, tStart: t2, tEnd: t2 + 3000, from: { id: blk.id, code: 'BLK', conf: 'ground' }, to: { id: lpl.id, code: 'LPL', conf: 'ground' }, ended: true, startedOnGround: true, cs: 'TCACN' }];
    L.store.mergeHex('4b846e', { reg: 'TC-ACN', type: 'GLEX', ladd: true });
    asked.length = 0;
    await L.loadHistory('4b846e', 10, null, { front: true });
    const h2 = await L.store.getHist('4b846e');
    check('(the monitor answers, and was asked for the aircraft\'s days)', L.monUp() && asked.some(a => a[0] === 'mon'), asked.filter(a => a[0] === 'mon'));
    check('the monitor\'s day with a flight taken as it is - nothing asked of the networks for it', flightsOn(h2, D2).length === 1 && !asked.some(a => (a[0] === 'apl' && a[2] === D2) || (a[0] === 'lol' && a[2].includes(D2))), flightsOn(h2, D2).length);
    check('its days "without flights" not taken: read here, both networks - airplanes.live\'s flights of that day in the log', flightsOn(h2, TARGET).length >= 3 && asked.some(a => a[0] === 'apl' && a[2] === TARGET), flightsOn(h2, TARGET).length);
    MONH.on = false; await L.monCheck(true).catch(() => null); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
