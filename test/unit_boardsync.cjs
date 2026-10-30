// (1.1.0) Boards and the airport panel from the monitor (the BUILT userscript in jsdom, the real monitor code in-process):
//   - a board opened: every FR24 row the monitor keeps of it - seven days back and seven ahead - on the board at once, and
//     FR24's own schedule of the airport not read here (the monitor's is fresh);
//   - FR24's own rows this browser reads (its map board's) sent on to the monitor for every other browser - rows that came
//     from the monitor not sent back;
//   - opened again: only what changed on the monitor asked for (since);
//   - the airport panel asked for while the monitor's check has not answered yet (an airport opened as the page loads):
//     it waits for it - the monitor's runways and each day's movements, never "the monitor is not connected".
// usage: node test/unit_boardsync.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), os = require('os');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');

process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monsync-'));
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E, ltn = E.byIcao('EGGW'), lpl = E.byIcao('EGGP'), nowS = Math.floor(Date.now() / 1000);
// (FR24's rows of Luton's departures the monitor keeps: five days ago, today, three days ahead; and an arrival)
const row = (fid, t, st, ap) => ({ k: 'f' + fid, src: 'sched', fid, cs: 'EZY' + fid.slice(-3).toUpperCase(), num: 'U2' + fid.slice(-3), t, sch: t, st, ap, al: 'easyJet', alIcao: 'EZY', nat: { id: parseInt(fid, 16) % 100000, flight: { id: fid, number: 'U2' + fid.slice(-3), callsign: null }, status: { name: st, color: st === 'scheduled' ? 'gray' : 'green' }, scheduledTime: t, estimatedTime: t, airportId: ap, airlineId: null, airline: 'easyJet', aircraftType: 'A320' } });
M.BD.put(ltn.id, 'departures', [row('3d0a001', nowS - 5 * 86400, 'departed', lpl.id), row('3d0a002', nowS - 3600, 'departed', lpl.id), row('3d0a003', nowS + 3 * 86400, 'scheduled', lpl.id)], 'crowd');
M.BD.put(ltn.id, 'arrivals', [row('3d0b001', nowS - 7200, 'landed', lpl.id)], 'crowd');
const asked = [], posted = []; let statusDelay = 0;
function answer(url, o) {
  asked.push(url);
  if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
  if (/^https:\/\/mon\.test\//.test(url)) {
    const u = new URL(url);
    if (u.pathname === '/status') return [200, JSON.stringify({ v: 3, ver: '1.1.0' }), statusDelay];
    if (u.pathname === '/boardrows') { const d = JSON.parse(o.data || '{}'); posted.push(d); return [200, JSON.stringify(M.boardRows(d, { ip: '198.51.100.9' }))]; }
    return [200, JSON.stringify(M.answer(u, Date.now() / 1000) || {})];
  }
  if (/api\.flightradar24\.com\/common\/v1\/airport\.json/.test(url)) return [200, JSON.stringify({ result: { response: { airport: { pluginData: { schedule: { arrivals: { data: [], page: { current: 1, total: 1 } }, departures: { data: [], page: { current: 1, total: 1 } } }, details: {}, runways: [] } } } } })];
  return [404, ''];
}
function makeWin(url) {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u, init || {}); return Promise.resolve(new Response(text || '', { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, text, wait] = answer(o.url, o); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2 + (wait || 0)); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.__posted = []; win.postMessage = data => { win.__posted.push(data); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.console.debug = () => {}; win.console.log = () => {};
  win.__tlTestHook = h => { win.__H = h; };
  win.eval(SRC);
  return win;
}
const fromPage = (w, type, d) => w.dispatchEvent(new w.MessageEvent('message', { data: Object.assign({ __tweeksLadd: type }, d), origin: 'https://www.flightradar24.com', source: w }));
const lastOf = (w, type, pred) => w.__posted.filter(x => x && x.__tweeksLadd === type && (!pred || pred(x))).pop();

(async () => {
  // ---- the airport panel asked for before the monitor's check has answered (it takes 2.5 s here)
  { statusDelay = 2500;
    const w = makeWin('https://www.flightradar24.com/51.87,-0.37/10'), L = w.__tweeksLadd;
    await until(() => L && L.store, 20000); await L.store.kvReady;
    L.store.kvSet('monRemote', { url: 'https://mon.test' }); L.monCheck(true).catch(() => {});
    await until(() => L.engine.airports.length > 5000, 60000);
    fromPage(w, 'needAirportPanel', { code: 'LTN' });
    const p = await until(() => lastOf(w, 'airportPanel', x => x.code === 'LTN'), 15000);
    check('the airport panel asked for as the page loads, the monitor\'s check not answered yet: it waits for it - the monitor\'s answer, each day\'s movements (never "not connected")', !!p && p.monitor === true && Array.isArray(p.daily) && p.daily.length >= 1 && asked.some(u => /mon\.test\/airport\?ap=/.test(u)), p && { monitor: p.monitor, daily: p.daily });
    statusDelay = 0; w.close(); }
  // ---- a board opened
  { const w = makeWin('https://www.flightradar24.com/51.87,-0.37/10'), L = w.__tweeksLadd;
    await until(() => L && L.store, 20000); await L.store.kvReady;
    L.store.kvSet('monRemote', { url: 'https://mon.test' }); await L.monCheck(true).catch(() => {});
    await until(() => L.engine.airports.length > 5000 && L.monUp(), 60000);
    asked.length = 0;
    fromPage(w, 'needBoard', { apId: ltn.id });
    const a = await until(() => { const x = lastOf(w, 'boardArch', m => m.apId === ltn.id); return x && x.dep.length >= 3 ? x : null; }, 10000);
    const fids = a ? a.dep.map(r => r.fid).sort() : [];
    check('a board opened: every FR24 row the monitor keeps of it on the board at once - five days back, today, three days ahead', !!a && ['3d0a001', '3d0a002', '3d0a003'].every(f => fids.includes(f)) && a.arr.some(r => r.fid === '3d0b001'), { dep: fids, arr: a && a.arr.map(r => r.fid) });
    await sleep(1500);
    check('... asked of the monitor with the window of fifteen days, and FR24\'s own schedule of the airport not read here (the monitor\'s is fresh)', asked.some(u => /mon\.test\/board\?ap=\d+&from=\d+&to=\d+&rows=1/.test(u)) && !asked.some(u => /airport\.json\?code=ltn&plugin\[\]=schedule/.test(u)), asked.filter(u => /board|schedule/.test(u)));
    // (FR24's own rows of its map board, as the page hands them over: sent on to the monitor)
    const fr = (id, t) => ({ id, flight: { id, number: 'BA' + id.slice(-3), callsign: 'BAW' + id.slice(-3) }, status: { name: 'departed', color: 'green' }, scheduledTime: t, estimatedTime: t, airportId: lpl.id, airline: 'British Airways', airlineId: 0, aircraftType: 'A320' });
    fromPage(w, 'boardRows', { apId: ltn.id, kind: 'departures', rows: [fr('3e0c001', nowS - 900), fr('3e0c002', nowS - 600)] });
    const sent = await until(() => posted.find(d => d.list.some(x => x.ap === ltn.id && x.rows.some(r => r.fid === '3e0c001'))), 15000);
    const kept = M.BD.rows(ltn.id, nowS - 86400, nowS + 86400).departures.filter(r => r.src === 'fr24').map(r => r.fid).sort();
    check('FR24\'s own rows this browser reads: sent on to the monitor - kept there for everyone; the monitor\'s own rows not sent back', !!sent && kept.join() === '3e0c001,3e0c002' && !posted.some(d => d.list.some(x => x.rows.some(r => /^3d0a/.test(r.fid || '')))), { kept, posts: posted.length });
    // ---- opened again: what changed since
    M.BD.put(ltn.id, 'departures', [row('3d0a004', nowS + 86400, 'scheduled', lpl.id)], 'crowd', nowS + 30);
    await sleep(2000); asked.length = 0;
    fromPage(w, 'needBoard', { apId: ltn.id });
    const a2 = await until(() => { const x = lastOf(w, 'boardArch', m => m.apId === ltn.id && m.dep.some(r => r.fid === '3d0a004')); return x; }, 10000);
    check('... opened again: only what changed on the monitor asked for (since) - the new row on the board, the others still there', !!a2 && asked.some(u => /mon\.test\/board\?.*rows=1&since=\d+/.test(u)) && ['3d0a001', '3d0a002', '3d0a003', '3d0a004'].every(f => a2.dep.some(r => r.fid === f)), asked.filter(u => /board/.test(u)));
    w.close(); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
