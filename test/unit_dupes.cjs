// Liverpool's departures, 15 Oct: Cranwell FTU's CWL52 (a Phenom 100, E50P, a military flying school) to Glasgow shown twice -
// FR24's own row at 15:30 (estimated 15:40) with an empty card (airline N/A, aircraft N/A), and the schedule's at 16:15
// (16:25) with a Ryanair logo and the card filled. The two were exactly 45 minutes apart, and the rule for "one flight"
// was "less than 45 minutes". Checked, on the built userscript and its page half:
//   - the same callsign to the same airport with its time moved is one row (FR24's own), the card filled from the other
//   - the logo is the airline the row names - never an id that contradicts it
//   - two flights already flown 45 minutes apart (circuits, shuttles) stay two rows
//   - CWL54 at 16:00 to Glasgow, another callsign, stays its own row
// usage: node test/unit_dupes.cjs <node_modules dir> <data dir>
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
const RWY = JSON.parse(fs.readFileSync(path.join(DATA, 'runways.json'), 'utf8')), RWL = JSON.parse(fs.readFileSync(path.join(DATA, 'runway_len.json'), 'utf8'));
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
  L.engine.setRunways(RWY); L.engine.setRunwayLengths(RWL);
  const E = L.engine, lpl = E.byIcao('EGGP'), gla = E.byIcao('EGPF'), ryr = 9999002;
  L.fr24.byIcao.set('RYR', ryr); L.fr24.airlines = L.fr24.airlines || new Map(); L.fr24.airlines.set(ryr, { id: ryr, name: 'Ryanair', icao: 'RYR', iata: 'FR' });
  const T = Math.floor(Date.now() / 3600e3) * 3600 + 1800;     // "15:30"

  // FR24's own board row of CWL52 as FR24 serves it: no flight number, no airline, no aircraft registration
  const nat = (id, fid, cs, sch, est, o) => Object.assign({ id, flight: { id: fid, number: null, callsign: cs }, status: { name: 'estimated', color: 'green', isAmbiguous: false, live: false }, scheduledTime: sch, estimatedTime: est, airportId: gla.id, divertedToId: null, airlineId: null, airline: null, aircraftType: 'E50P', runway: null }, o || {});
  const fr24Row = (k, fid, cs, sch, est, o) => ({ k: 'f' + fid, src: 'fr24', id: k, fid, cs, num: '', t: est, sch, est, st: 'estimated', col: 'green', ap: gla.id, al: '', alId: 0, ty: 'E50P', nat: nat(k, fid, cs, sch, est) });
  // ... and the schedule's own row of it (FR24's older airport API): its airline "Cranwell FTU", and an airline id that is
  // Ryanair's - as the screenshot's logo was
  const schedRow = (k, fid, cs, sch, est, o) => Object.assign({ k: 'f' + fid, src: 'sched', id: k, fid, cs, num: '', t: est, sch, est, st: 'scheduled', col: 'gray', ap: gla.id, al: 'Cranwell FTU', alId: ryr, alIcao: '', ty: 'E50P', reg: '', hex: '',
    nat: nat(k, fid, cs, sch, est, { status: { name: 'scheduled', color: 'gray', isAmbiguous: false, live: false }, airlineId: ryr, airline: 'Ryanair' }) }, o || {});

  const dep = {
    own: fr24Row(5001, '3c2001', 'CWL52', T, T + 600),
    sch: schedRow(5002, '3c2002', 'CWL52', T + 2700, T + 3300),
    n54: fr24Row(5003, '3c2003', 'CWL54', T + 1800, T + 1800)
  };
  const list = L.boardList(dep, new Map());
  const c52 = list.filter(r => r.cs === 'CWL52'), c54 = list.filter(r => r.cs === 'CWL54');
  check('CWL52 at 15:30 and 16:15, 45 minutes apart: one row', c52.length === 1, list.map(r => [r.cs, r.t - T]));
  check('... FR24\'s own (15:30, estimated 15:40)', c52[0] && c52[0].src === 'fr24' && c52[0].est === T + 600, c52[0] && [c52[0].src, c52[0].est - T]);
  check('... with the operator the schedule names, and not Ryanair\'s logo', c52[0] && c52[0].al === 'Cranwell FTU' && c52[0].alId !== ryr && !(c52[0].nat && c52[0].nat.airlineId === ryr), c52[0] && [c52[0].al, c52[0].alId, c52[0].nat && c52[0].nat.airlineId]);
  check('CWL54 (another callsign) stays its own row', c54.length === 1 && list.length === 2, list.length);
  // the schedule's row alone: its Ryanair id contradicts the name it carries
  const alone = L.boardList({ sch: schedRow(5002, '3c2002', 'CWL52', T + 2700, T + 3300) }, new Map())[0];
  check('the schedule\'s row on its own: no Ryanair id on Cranwell FTU\'s flight', alone && alone.alId !== ryr && alone.nat.airlineId !== ryr, alone && [alone.alId, alone.nat.airlineId]);
  // and an airline whose id does agree keeps its logo (FR24's own list, a schedule row)
  const ok = L.boardList({ x: schedRow(5004, '3c2004', 'RYR4KP', T, T, { al: 'Ryanair', num: 'FR4KP' }) }, new Map())[0];
  check('a Ryanair flight named Ryanair keeps Ryanair\'s id', ok && ok.alId === ryr, ok && ok.alId);
  // two flights already flown, 45 minutes apart, the same callsign to the same airport: two flights
  const flown = (k, t) => ({ k, src: 'log', hex: '4ca9d1', reg: 'G-DEMO', cs: 'GDEMO', ty: 'C172', ap: gla.id, t, sch: t, est: t, st: 'departed', col: 'green' });
  check('two flights already flown 45 minutes apart: two rows', L.boardList({ a: flown('ha:1', T), b: flown('ha:2', T + 2700) }, new Map()).length === 2);
  check('... and 20 minutes apart (one flight seen twice): one', L.boardList({ a: flown('ha:1', T), b: flown('ha:2', T + 1200) }, new Map()).length === 1);
  // another airport: not the same flight
  check('the same callsign to another airport: two rows', L.boardList({ own: fr24Row(5001, '3c2001', 'CWL52', T, T + 600), sch: schedRow(5002, '3c2002', 'CWL52', T + 2700, T + 3300, { ap: lpl.id, nat: Object.assign(nat(5002, '3c2002', 'CWL52', T + 2700, T + 3300), { airportId: lpl.id }) }) }, new Map()).length === 2);

  // ---- the page half: FR24's own board answer with the kept rows
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.flightradar24.com/', runScripts: 'dangerously' });
  const pw = dom.window; let H = null; pw.__tlTestHook = h => { H = h; };
  pw.postMessage = () => {}; pw.unsafeWindow = pw; pw.GM_xmlhttpRequest = () => {}; pw.fetch = () => Promise.reject(new Error('offline')); pw.indexedDB = undefined;
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  pw.eval('(' + m[0] + ')()');
  check('page-world hook', !!(H && H.addArch && H.fillNativeCard && H.acceptBoardArch));
  H.acceptBoardArch({ apId: lpl.id, arr: [], dep: [schedRow(5002, '3c2002', 'CWL52', T + 2700, T + 3300)] });
  const j = { data: [nat(5001, '3c2001', 'CWL52', T, T + 600), nat(5003, '3c2003', 'CWL54', T + 1800, T + 1800)] };
  const added = H.addArch(j, lpl.id, 'departures');
  check('FR24\'s own CWL52 beside the kept 16:15 row: not added twice', added === 0 && j.data.length === 2, [added, j.data.length]);
  const d = { flight: { callsign: 'CWL52' }, aircraft: {}, images: [], airline: null };
  await H.fillNativeCard(d, 5001, 'departures');
  check('... and its card filled from it: airline Cranwell FTU, aircraft E50P', d.airline === 'Cranwell FTU' && d.aircraft.type === 'E50P', [d.airline, d.aircraft]);
  // two flown flights 45 minutes apart stay two
  const j2 = { data: [Object.assign(nat(6001, '3c3001', 'GDEMO', T, T), { status: { name: 'departed', color: 'green' } })] };
  H.acceptBoardArch({ apId: lpl.id + 1, arr: [], dep: [flown('ha:2', T + 2700)] });
  check('a flown flight 45 minutes after another of the callsign: kept', H.addArch(j2, lpl.id + 1, 'departures') === 1);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
