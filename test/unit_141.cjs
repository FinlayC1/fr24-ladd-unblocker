// 1.4.1, the playback (the BUILT userscript in jsdom, FR24's airport list from monitor/data; the monitor and the public
// tracks answered here):
//   - a page opened just to play a flight (FR24's flights page on a phone) - nothing of the aircraft read yet:
//       JDI01, a blocked jet, Cincinnati to Manchester with three hours over the Atlantic no receiver heard - the whole
//       flight, its airports and its owner from the monitor's flights and owners; no flight of it anywhere: the flight
//       made of its track, the ocean's hole inside it
//       LOG8NP, a Loganair flight older than FR24's week: Isle of Man to Aberdeen from its track; its airline (Loganair,
//       with FR24's logo by its id) and its flight number (FR24's, learnt by the monitor)
//       a runway from its own track where the monitor logged none (/rwyfit)
//   - a callsign's flight number: FR24's as the monitor learnt it; else an airline's numbered callsign (UAL972: UA972);
//     else none (EZY327L, GWAPA)
//   - FR24's own flight on FR24's player (G-WAPA): "Private owner" and its "N/A" ends - the registers' operator, and where
//     FR24's own track began and ended, down at a field
//   - a flight number's log page: its flights before FR24's week, as the monitor's scans of FR24's map kept them, under
//     FR24's own rows - each one's Play by FR24's id
// usage: node test/unit_141.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8'), APS = JSON.parse(AIRPORTS).rows, AP = c => APS.find(a => a.iata === c);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 20; i++) { const v = f(); if (v) return v; await sleep(20); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 700) : ''}`); };
const MON = 'https://143-47-224-210.sslip.io';
// (yesterday, a day long over whatever day the test runs)
const D0 = new Date(); D0.setUTCDate(D0.getUTCDate() - 1); D0.setUTCHours(0, 0, 0, 0);
const DAY0 = Math.round(D0.getTime() / 1000);
// ---- a readsb day trace: legs of [seconds, lat, lon, ft | 'ground', kts] joined, a point each `step` s
function trace(hex, reg, type, cs, parts, t0) {
  const tr = [];
  for (const p of parts) tr.push([p[0] - t0, p[1], p[2], p[3], p[4], p[5] || 0, 0, p[6] || 0, tr.length === 0 ? { flight: cs.padEnd(8), squawk: '1000', type: 'adsb_icao' } : null, 'adsb_icao']);
  return JSON.stringify({ icao: hex, r: reg, t: type, timestamp: t0, trace: tr });
}
const lerp = (a, b, f) => a + (b - a) * f;
function path2(t0, from, to, secs, step, alt0, alt1, gs) { const out = []; for (let s = 0; s <= secs; s += step) { const f = s / secs; out.push([t0 + s, lerp(from[0], to[0], f), lerp(from[1], to[1], f), Math.round(lerp(alt0, alt1, f)), gs]); } return out; }
const CVG = AP('CVG'), MAN = AP('MAN'), IOM = AP('IOM'), ABZ = AP('ABZ'), LPL = AP('LPL'), CEG = AP('CEG');
// JDI01 (a1b2c3, N601JD): off Cincinnati 02:05Z, heard to 48N 53W, three hours over the Atlantic unheard, heard again at
// 54N 15W, down at Manchester 10:05Z
const JT0 = DAY0 + 2 * 3600;
function jdiTrace() {
  const g = (t, ap, n) => { const o = []; for (let i = 0; i < n; i++) o.push([t + i * 20, ap.lat + i * 0.0001, ap.lon, 'ground', 8]); return o; };
  const parts = [].concat(g(JT0, CVG, 15), path2(JT0 + 300, [CVG.lat + 0.01, CVG.lon + 0.01], [40.5, -82.0], 1200, 30, 500, 41000, 300),
    path2(JT0 + 1530, [40.5, -82.0], [48.0, -53.0], 3 * 3600, 60, 41000, 41000, 480),
    path2(JT0 + 1530 + 3 * 3600 + 3 * 3600, [54.0, -15.0], [53.40, -2.40], 5400, 60, 41000, 2000, 450),
    path2(JT0 + 1530 + 6 * 3600 + 5400 + 30, [53.38, -2.33], [MAN.lat, MAN.lon - 0.01], 240, 20, 1500, 300, 140), g(JT0 + 1530 + 6 * 3600 + 5400 + 300, MAN, 15));
  return trace('a1b2c3', 'N601JD', 'GLF6', 'JDI01', parts, JT0);
}
const JDI_LAND = JT0 + 1530 + 6 * 3600 + 5400 + 290;
// LOG8NP (4007f1, G-SAJC): Isle of Man 09:30Z to Aberdeen 10:35Z - on the ground at both ends
const LT0 = DAY0 + 9.5 * 3600;
function logTrace() {
  const g = (t, ap, n) => { const o = []; for (let i = 0; i < n; i++) o.push([t + i * 20, ap.lat, ap.lon + i * 0.0001, 'ground', 8]); return o; };
  const parts = [].concat(g(LT0, IOM, 10), path2(LT0 + 220, [IOM.lat + 0.01, IOM.lon + 0.01], [55.5, -3.6], 1200, 30, 400, 24000, 300), path2(LT0 + 1450, [55.5, -3.6], [57.15, -2.25], 1800, 30, 24000, 600, 260), g(LT0 + 3300, ABZ, 10));
  return trace('4007f1', 'G-SAJC', 'E145', 'LOG8NP', parts, LT0);
}
function makeWin(url, asked, answerX, html) {
  const win = new JSDOM(html || '<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.caches = { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => false }) };
  const answer = (u, body) => {
    asked.push({ url: u, body, at: Date.now() });
    if (answerX) { const r = answerX(u, body); if (r) return r; }
    if (/flightradar24\.com\/mobile\/airports\/format/.test(u)) return [0, 200, AIRPORTS];
    if (/flightradar24\.com\/mobile\/airlines/.test(u)) return [0, 200, JSON.stringify({ version: 1, rows: [{ id: 123, name: 'Loganair', icao: 'LOG', iata: 'LM' }, { id: 77, name: 'United Airlines', icao: 'UAL', iata: 'UA' }, { id: 5, name: 'easyJet', icao: 'EZY', iata: 'U2' }] })];
    if (u.startsWith(MON + '/status')) return [5, 200, JSON.stringify({ v: 3, ver: 'test' })];
    return [0, 404, ''];
  };
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const a = answer(u); return new Promise(r => setTimeout(() => r(new Response(a[2] || '', { status: a[1] })), a[0])); };
  win.GM_xmlhttpRequest = o => { const a = answer(o.url, o.data); setTimeout(() => { o.onload && o.onload({ status: a[1], responseText: a[2], response: a[2] }); }, a[0] || 1); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.__posted = []; win.postMessage = data => { win.__posted.push({ d: data, at: Date.now() }); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.__logs = []; win.console.debug = (...a) => win.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); win.console.log = () => {}; win.console.error = (...a) => win.__logs.push('ERROR ' + a.join(' '));
  win.__tlTestHook = h => { win.__H = h; };
  win.eval(SRC);
  return win;
}
async function ready(w, asked) {
  const L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000 && w.__H, 60000);
  await L.store.kvReady;
  await until(() => asked.some(x => x.url.startsWith(MON + '/status')), 8000); await sleep(300);
  return L;
}
const owners = (hex, reg, type, owner) => JSON.stringify({ list: [[hex, reg, type, '', owner, '', 'United States', 'US', '', 0, 0, '', '', 1, 1, 0]] });

(async () => {
  // ======== a page opened just to play a flight: FR24's flights page, nothing of the aircraft read here ==================
  const legsAsked = [], rwyAsked = [];
  const answerX = (u, body) => {
    if (/trace_full_a1b2c3\.json/.test(u)) return [20, 200, jdiTrace()];
    if (/trace_full_4007f1\.json/.test(u)) return [20, 200, logTrace()];
    if (u.startsWith(MON + '/legs?hex=a1b2c3')) { legsAsked.push(u); return [5, 200, JSON.stringify({ hex: 'a1b2c3', legs: [{ from: { id: CVG.id, code: 'CVG', conf: 'ground' }, to: { id: MAN.id, code: 'MAN', conf: 'ground' }, tStart: JT0, tEnd: JDI_LAND + 300, tOff: JT0 + 300, tOn: JDI_LAND, ended: true, cs: 'JDI01' }] })]; }
    if (u.startsWith(MON + '/legs?hex=')) { legsAsked.push(u); return [5, 200, JSON.stringify({ legs: [] })]; }
    if (u.startsWith(MON + '/owners?hex=')) { const h = /hex=([0-9a-f,]+)/.exec(u)[1]; return [5, 200, h.includes('a1b2c3') ? owners('a1b2c3', 'N601JD', 'GLF6', 'JD Jets LLC') : h.includes('406a1b') ? owners('406a1b', 'G-WAPA', 'EC35', 'Sloane Helicopters Ltd') : JSON.stringify({ list: [] })]; }
    if (u.startsWith(MON + '/csfn?cs=LOG8NP')) return [5, 200, JSON.stringify({ v: 1, list: { LOG8NP: 'LM437' } })];
    if (u.startsWith(MON + '/csfn')) return [5, 200, JSON.stringify({ v: 1, list: {} })];
    // (the monitor's runways of a flight, both ends in one answer - by FR24's id, else the aircraft and its times)
    if (u.startsWith(MON + '/rwyof?')) { rwyAsked.push(u); const hx = /hex=([0-9a-f]{6})/.exec(u), fid = /fid=([0-9a-f]+)/.exec(u); return [5, 200, JSON.stringify(hx && hx[1] === 'a1b2c3' ? { v: 1, off: '27', on: '23R' } : fid && fid[1] === '3d5a0001' ? { v: 1, off: '09', on: '' } : { v: 1, off: '', on: '' })]; }
    if (u.startsWith(MON + '/rwy?f=3d5a0001:0')) { rwyAsked.push(u); return [5, 200, JSON.stringify({ v: 1, list: { '3d5a0001:0': '27' } })]; }
    if (u.startsWith(MON + '/fr24raw?f=3d5a0001')) return [5, 200, JSON.stringify({ v: 1, m: { hex: '406a1b', reg: 'G-WAPA', cs: 'GWAPA', type: 'EC35' }, cols: ['t', 'lat', 'lon', 'alt', 'gs', 'trk', 'vr', 'sq', 'gnd'], p: [[DAY0 + 54000, LPL.lat, LPL.lon, 0, 0, 0, 0, null, 1], [DAY0 + 54600, 53.25, -2.9, 1500, 110, 200, 0, null, 0], [DAY0 + 55800, CEG.lat, CEG.lon, 0, 0, 0, 0, null, 1]] })];
    if (u.startsWith(MON + '/fr24fn?fn=U2414')) return [5, 200, JSON.stringify({ v: 1, fn: 'U2414', keep: 100, list: [{ fid: '3d6e1f2a', fn: 'U2414', cs: 'EZY327L', hex: '4ca9d3', reg: 'G-EZFT', type: 'A319', from: 'STN', to: 'GLA', t0: DAY0 - 20 * 86400 + 67440, t1: DAY0 - 20 * 86400 + 70740 }, { fid: '3d6e1f2b', fn: 'U2414', cs: 'EZY327L', hex: '406b11', reg: 'G-EZOA', type: 'A319', from: 'STN', to: 'GLA', t0: DAY0 - 21 * 86400 + 67440, t1: DAY0 - 21 * 86400 + 70800 }, { fid: '3d999999', fn: 'U2414', cs: 'EZY327L', hex: '406b12', reg: 'G-EZOB', type: 'A319', from: 'STN', to: 'GLA', t0: DAY0 - 2 * 86400, t1: DAY0 - 2 * 86400 + 3300 }] })];
    return null;
  };
  {
    const asked = [], w = makeWin('https://www.flightradar24.com/data/flights?tl-pb=ffa1b2c3' + (JT0 + 300).toString(16), asked, answerX), L = await ready(w, asked), P = L.pb141;
    check('ready: a playback page, airports, the 1.4.1 parts', L.engine.airports.length > 5000 && !!P && typeof P.pbFlight === 'function');
    // ---- JDI01: the monitor's flight of it
    const SID = 'ffa1b2c3' + (JT0 + 300).toString(16).padStart(8, '0');
    const d = await P.pbFlight({ id: SID });
    const last = d && d.pts && d.pts[d.pts.length - 1];
    check('JDI01 on a page that has read nothing of it: its flight found - the monitor\'s - Cincinnati to Manchester', !!d && d.ok && d.origin && d.origin.code === 'CVG' && d.destination && d.destination.code === 'MAN' && legsAsked.some(u => /a1b2c3/.test(u)), d && { ok: d.ok, o: d.origin, de: d.destination });
    check('... the whole of it: both sides of the Atlantic\'s three hours unheard - to the ground at Manchester, not cut at Newfoundland', !!last && last.lat > 53 && last.lon > -3 && d.pts.some(p => p.lon < -52) && d.pts.some(p => p.lon > -16 && p.lon < -14), last);
    check('... its owner as the registers name it (its company form left off, as everywhere), over its callsign (LADD: no airline of "JDI")', d && d.operator === 'JD Jets' && !d.alId && d.cs === 'JDI01' && !d.flightNumber, d && { op: d.operator, al: d.alId, cs: d.cs, fn: d.flightNumber });
    check('... its take-off and landing: the times of the flight, both its runways the monitor\'s', d && Math.abs(d.dep - (JT0 + 300)) <= 60 && Math.abs(d.arr - JDI_LAND) <= 60 && d.rwyOff === '27' && d.rwyOn === '23R', d && { dep: d.dep, arr: d.arr, off: d.rwyOff, on: d.rwyOn });
    const ra = rwyAsked.find(u => /hex=a1b2c3/.test(u));
    // (the page plays it itself as it opens, and here it is asked for again: each time one ask for both ends)
    check('... asked of the monitor in one ask for both ends - by the aircraft, each end\'s airport and time; nothing worked out here', !!ra && rwyAsked.filter(u => /hex=a1b2c3/.test(u)).every(u => u === ra) && new RegExp('off=' + CVG.id + ',\\d+').test(ra) && new RegExp('on=' + MAN.id + ',\\d+').test(ra) && !asked.some(x => /\/rwyfit/.test(x.url)), { ra, all: rwyAsked });
    // ---- the same with no flight of it anywhere: the flight made of its track
    L.store.mergeHex('a1b2c3', { reg: 'N601JD', type: 'GLF6', ladd: true });
    const leg = P.pbLegOfPts('a1b2c3', JSON.parse(jdiTrace()).trace.map(r => ({ t: JT0 + r[0], lat: r[1], lon: r[2], alt: r[3] === 'ground' ? 0 : r[3], gnd: r[3] === 'ground', gs: r[4], trk: null, vr: null })), JT0 + 300);
    check('no flight of it known anywhere: the flight made of its track - its ends Cincinnati and Manchester, the ocean\'s hole inside it', !!leg && leg.from && leg.from.id === CVG.id && leg.to && leg.to.id === MAN.id && leg.tEnd >= JDI_LAND - 600, leg && { from: leg.from, to: leg.to, tStart: leg.tStart, tEnd: leg.tEnd });
    // ---- LOG8NP: older than FR24's week, an airline's flight
    const LSID = 'ff4007f1' + (LT0 + 220).toString(16).padStart(8, '0');
    const g = await P.pbFlight({ id: LSID });
    check('LOG8NP: from its track - Isle of Man to Aberdeen (no flight of it in any log)', !!g && g.ok && g.origin && g.origin.code === 'IOM' && g.destination && g.destination.code === 'ABZ', g && { o: g.origin, d: g.destination });
    check('... its airline - Loganair, FR24\'s id for its logo - and its flight number (FR24\'s, learnt by the monitor) beside its callsign', g && g.operator === 'Loganair' && g.alId === 123 && g.flightNumber === 'LM437' && g.cs === 'LOG8NP', g && { op: g.operator, al: g.alId, fn: g.flightNumber, cs: g.cs });
    // ---- callsigns' flight numbers
    check('a callsign\'s flight number: FR24\'s as learnt; an airline\'s numbered callsign its IATA code and number; none for EZY327L, GWAPA', await P.csFlightNumber('LOG8NP') === 'LM437' && await P.csFlightNumber('UAL972') === 'UA972' && await P.csFlightNumber('EZY327L') === '' && await P.csFlightNumber('GWAPA') === '');
    // ---- FR24's own flight (G-WAPA) on FR24's player: "Private owner", N/A at both ends
    const inf = await P.pbInfo({ fid: '3d5a0001', reg: 'G-WAPA', cs: 'GWAPA', dep: DAY0 + 54000, arr: DAY0 + 55800, ends: [], wantOwner: true, wantFrom: true, wantTo: true, wantFn: true });
    check('FR24\'s own flight on its player (G-WAPA): the registers\' operator for "Private owner"; its ends where FR24\'s own track began and ended - down at Liverpool and Hawarden', inf && inf.ok && inf.operator === 'Sloane Helicopters' && inf.origin && inf.origin.code === 'LPL' && inf.destination && inf.destination.code === 'CEG' && !inf.flightNumber, inf);
    const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
    check('no script errors', !errs.length, errs.slice(0, 5));
    w.close();
  }
  // ======== a flight number's log page: its flights before FR24's week, under FR24's own =================================
  {
    const T = DAY0 - 3 * 86400;
    const fr24Row = `<tr class=" data-row" data-timestamp="${T}"><td class="visible-xs visible-sm">phone</td><td class="w40 hidden-xs hidden-sm">&nbsp;</td><td class="hidden-xs hidden-sm">16 Nov 2026</td><td>London (STN)</td><td>Glasgow (GLA)</td><td>A319 (G-EZFT)</td><td>0:55</td><td>18:50</td><td>18:44</td><td>20:10</td><td><div class="state-block green"></div></td><td>Landed 19:39</td><td class="text-right"><a class="btn btn-sm btn-playback" data-flight-hex="3d999999" href="#3d999999" id="btn-playback-3d999999">Play</a></td><td class="w40">&nbsp;</td></tr>`;
    const html = `<!doctype html><html><head></head><body><section id="cnt-data-content"><div id="cnt-subpage-info"><h1>U2414</h1></div><div class="row"><table id="tbl-datatable"><tbody>${fr24Row}</tbody></table></div></section></body></html>`;
    const asked = [], w = makeWin('https://www.flightradar24.com/data/flights/u2414', asked, answerX, html), L = await ready(w, asked);
    const tb = w.document.querySelector('#tbl-datatable tbody');
    const rows = await until(() => tb.querySelectorAll('tr.tl-fn-old').length ? [...tb.querySelectorAll('tr.tl-fn-old')] : null, 15000);
    const n = rows ? rows.length : await L.pb141.fnOlderRows(tb, 'U2414');
    const all = [...tb.querySelectorAll('tr.tl-fn-old')], cells = r => [...r.children].map(c => c.textContent.replace(/\s+/g, ' ').trim());
    check('a flight number\'s page FR24 lists itself (its week): its flights before that from the monitor - under FR24\'s own row, newest first, one FR24 has itself left out', all.length === 2 && tb.querySelector('tr.data-row:not(.tl-fn-old)') === tb.rows[0] && /G-EZFT/.test(all[0].textContent) && /G-EZOA/.test(all[1].textContent) && !/G-EZOB/.test(tb.textContent), { n, rows: all.map(cells) });
    const c0 = all[0] ? cells(all[0]) : [];
    check('... in FR24\'s own markup: from STN, to GLA, the aircraft, landed, "~" times (as the scans saw them)', /STN/.test(c0[3] || '') && /GLA/.test(c0[4] || '') && /A319.*G-EZFT/.test(c0[5] || '') && /Landed ~/.test(c0[11] || '') && /^~/.test(c0[8] || ''), c0);
    const play = all[0] && all[0].querySelector('a.btn-playback');
    check('... its Play: FR24\'s own player of the flight by FR24\'s id', !!play && play.dataset.flightHex === '3d6e1f2a' && /#3d6e1f2a$/.test(play.getAttribute('href')), play && play.outerHTML.slice(0, 300));
    check('... and a line saying where they are from', /2 earlier flights of U2414/.test((tb.querySelector('tr.tl-fn-foot') || {}).textContent || ''));
    const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
    check('no script errors', !errs.length, errs.slice(0, 5));
    w.close();
  }
  // ======== FR24's own player of one of its own flights (G-WAPA): filled in through the page's part and the userscript ======
  {
    const asked = [], w = makeWin('https://www.flightradar24.com/data/playback/3d5a0001', asked, answerX), L = await ready(w, asked), H = w.__H;
    const T = DAY0 + 54000;
    const props = { errors: {}, trailSource: 'radar', callsign: 'GWAPA', flightNumber: null, airline: { name: 'Private owner', logoUrl: null, logoDimensions: null },
      origin: { code: 'N/A', city: 'Not available', lat: null, long: null }, destination: { code: 'N/A', city: 'Not available', lat: null, long: null }, aircraft: { name: 'Airbus Helicopters H135', registration: 'G-WAPA' },
      flightTimes: { origin: { name: 'Not available', timezone: null, terminal: null, gate: null, runway: null, runwayLocked: true }, destination: { name: 'Not available', timezone: null, terminal: null, gate: null, runway: null, runwayLocked: true }, scheduledDeparture: null, actualDeparture: new Date(T * 1000).toISOString(), scheduledArrival: null, actualArrival: T + 1800 },
      trailRoute: [], trail: [], facts: [], download: { flightId: '3d5a0001', history: T } };
    // (its track: off the ground at Liverpool westward, ten minutes, a point every 20 s)
    for (let i = 0; i <= 30; i++) { const t = T + i * 20, lon = LPL.lon - i * 0.004; props.trailRoute.push({ timestamp: t, lat: LPL.lat, long: lon, track: 270, altitude: i < 5 ? 0 : (i - 4) * 150, estimated: false }); props.trail.push({ timestamp: t, barometricAltitude: i < 5 ? 0 : (i - 4) * 150, groundSpeed: i < 5 ? 10 : 90 }); }
    w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map() }, $page: { component: 'Data/NewFlightPlayback', url: '/data/playback/3d5a0001', props }, $inertia: { push: () => {}, replace: () => {} } } } };
    const got = await until(() => props.airline.name !== 'Private owner' && props.origin.code !== 'N/A' ? 1 : 0, 20000);
    const ask = w.__posted.map(p => p.d).find(d => d && d.__tweeksLadd === 'pbInfo');
    check('FR24\'s own player (G-WAPA, "Private owner", N/A at both ends): asked of the userscript once, with what FR24 leaves out and its track\'s ends', !!ask && ask.fid === '3d5a0001' && ask.reg === 'G-WAPA' && ask.wantOwner && ask.wantFrom && ask.wantTo && ask.ends.length === 2 && ask.dep === T, ask && { fid: ask.fid, reg: ask.reg, w: [ask.wantOwner, ask.wantFrom, ask.wantTo, ask.wantFn], ends: ask.ends, dep: ask.dep });
    check('... written into FR24\'s page data: the operator over the callsign, Liverpool and Hawarden at its ends, their names on its times card', !!got && props.airline.name === 'Sloane Helicopters' && props.origin.code === 'LPL' && props.destination.code === 'CEG' && props.flightTimes.origin.name === LPL.name && props.flightTimes.destination.name === CEG.name, { al: props.airline, o: props.origin, d: props.destination, ft: props.flightTimes });
    // ---- its runway: the monitor's, asked for by FR24's id at once (FR24's time written out - a date - read too)
    const rwy = await until(() => props.flightTimes.origin.runway, 20000);
    check('... its take-off\'s runway: the monitor\'s, by FR24\'s id - FR24\'s time written out (a date) read too - never the padlock; nothing worked out in the page', rwy === '27' && props.flightTimes.origin.runwayLocked === false && asked.some(x => /\/rwy\?f=3d5a0001:0&ap=2002&ts=\d+/.test(x.url)) && !asked.some(x => /\/rwyfit|flight-playback\.json/.test(x.url)), { rwy });
    // ---- its back button: "Flights", back to the aircraft's log page
    w.document.getElementById('app').insertAdjacentHTML('beforeend', '<a class="crumb" href="/data/playback"><svg></svg> Playback</a>');
    H.mxPbBackLabel();
    check('its back button (FR24\'s "Playback", its search for flights to play): "Flights", its arrow kept', w.document.querySelector('a.crumb').textContent.trim() === 'Flights' && !!w.document.querySelector('a.crumb svg'));
    check('... and where it goes: the aircraft\'s log page', H.mxPbBackTo() === '/data/aircraft/g-wapa', H.mxPbBackTo());
    check('a time of FR24\'s page data as seconds: seconds, milliseconds, a date written out', H.mxSec(T) === T && H.mxSec(T * 1000) === T && H.mxSec(new Date(T * 1000).toISOString()) === T && H.mxSec('') === 0 && H.mxSec(null) === 0);
    // ---- the line over a flight of this script's: its airline with FR24's logo by its id; an owner by name alone
    const pp = H.mxPbProps({ id: 'ff4007f1' + LT0.toString(16), cs: 'LOG8NP', flightNumber: 'LM437', operator: 'Loganair', alId: 123, pts: [{ t: LT0, lat: 54, lon: -4, alt: 1000, gs: 200 }, { t: LT0 + 60, lat: 54.1, lon: -4, alt: 2000, gs: 220 }] });
    const po = H.mxPbProps({ id: 'ffa1b2c3' + JT0.toString(16), cs: 'JDI01', operator: 'JD Jets', alId: 0, pts: [{ t: JT0, lat: 39, lon: -84, alt: 1000, gs: 200 }, { t: JT0 + 60, lat: 39.1, lon: -84, alt: 2000, gs: 220 }] });
    check('our player\'s header: the airline with FR24\'s logo of it, the flight number beside the callsign; an owner by name, no logo', pp.airline.name === 'Loganair' && /\/123\.png$/.test(pp.airline.logoUrl || '') && pp.flightNumber === 'LM437' && pp.callsign === 'LOG8NP' && po.airline.name === 'JD Jets' && po.airline.logoUrl === null && po.flightNumber === null, { pp: pp.airline, po: po.airline });
    const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
    check('no script errors', !errs.length, errs.slice(0, 5));
    w.close();
  }
  // ======== M-SKTO, 19 Nov: FR24's "Blackpool -> Liverpool", its own track down in Gillmoss at Axis Business Park's helipad ==
  {
    const BLK = AP('BLK'), AXIS = [53.465098, -2.895401], T1 = DAY0 + 10 * 3600, L1 = T1 + 1500, T2 = L1 + 3600, L2 = T2 + 1200, T0 = DAY0 + 5 * 3600, T3 = DAY0 + 7 * 3600, T4 = DAY0 + 3 * 3600;
    // (OurAirports' list as the monitor serves it: its heliport at Gillmoss - and enough others to be the list)
    const oaRows = [[17001368, 'GB-1368', 'GB-1368', 'Axis Business Park Helipad', 'Liverpool', LPL.id, AXIS[0], AXIS[1], 60, 'H']];
    for (let i = 0; i < 10050; i++) oaRows.push([18000000 + i, 'ZZ' + i, 'ZZ-' + i, 'Filler ' + i, '', 0, -85 + (i % 100) * 0.01, -170 + Math.floor(i / 100) * 0.01, 0, 'S']);
    const ends = { '3e1a0001': { s: [T1, BLK.lat, BLK.lon, 0, 0, 1], e: [L1, AXIS[0], AXIS[1] + 0.0002, -375, 0, 0] },
      '3e1a0000': { s: [T0, LPL.lat, LPL.lon, 0, 0, 1], e: [T0 + 1500, BLK.lat, BLK.lon, 0, 0, 1] },
      // (lost at 2,500 ft over Gillmoss, still flying: FR24's Liverpool kept)
      '3e1a0003': { s: [T3, BLK.lat, BLK.lon, 0, 0, 1], e: [T3 + 1200, AXIS[0], AXIS[1], 2500, 90, 0] },
      // (the monitor's scans last had it at 900 ft a kilometre out - FR24's whole track, asked for to be sure, has it down
      // on the pad)
      '3e1a0004': { s: [T4, BLK.lat, BLK.lon, 0, 0, 1], e: [T4 + 1400, AXIS[0] + 0.008, AXIS[1], 900, 70, 0] } };
    const fpb = (lat, lon, ft, kts, t) => ({ latitude: lat, longitude: lon, altitude: { feet: ft }, speed: { kts }, timestamp: t, heading: 0 });
    const endsAsked = [];
    const answerS = u => {
      if (u.startsWith(MON + '/oaap')) return [5, 200, JSON.stringify({ rows: oaRows, n: oaRows.length, at: Date.now() })];
      if (/flight-playback\.json\?flightId=3e1a0004/.test(u)) return [5, 200, JSON.stringify({ result: { response: { data: { flight: { track: [fpb(BLK.lat, BLK.lon, 0, 0, T4), fpb(53.6, -2.95, 1500, 110, T4 + 600), fpb(AXIS[0] + 0.008, AXIS[1], 900, 70, T4 + 1400), fpb(AXIS[0], AXIS[1] + 0.0001, 0, 0, T4 + 1500)] } } } } })];
      if (u.startsWith(MON + '/fr24ends?f=')) { endsAsked.push(u); const out = {}; for (const x of decodeURIComponent(u.split('f=')[1]).split(',')) { const f = x.split(':')[0]; if (ends[f]) out[f] = ends[f]; } return [5, 200, JSON.stringify({ v: 1, list: out })]; }
      return null;
    };
    const row = (t, from, to, land, fid) => `<tr class="data-row" data-timestamp="${t}"><td></td><td></td><td data-timestamp="${t}">19 Nov</td><td>${from}</td><td>${to}</td><td><a href="/data/flights/mskto">MSKTO</a></td><td>0:25</td><td>—</td><td data-timestamp="${t}">10:00</td><td>—</td><td><div class="state-block green"></div></td><td data-timestamp="${land}" data-prefix="Landed ">Landed 10:25</td><td><a class="btn btn-sm btn-playback" data-flight="${fid}">Play</a></td></tr>`;
    const ap = (name, c) => `${name} <a href="/data/airports/${c.toLowerCase()}">(${c})</a>`;
    const html = `<!doctype html><html><head><title>M-SKTO</title></head><body><div id="cnt-aircraft-info"><div class="row"><label>TYPE CODE</label> <span class="details">A109</span></div><div class="row"><label>MODE S</label> <span class="details" id="txt-mode-s">43EB1F</span></div></div>
      <table id="tbl-datatable"><tbody>${row(T2, '—', '—', L2, '3e1a0002')}${row(T1, ap('Blackpool', 'BLK'), ap('Liverpool', 'LPL'), L1, '3e1a0001')}${row(T3, ap('Blackpool', 'BLK'), ap('Liverpool', 'LPL'), T3 + 1500, '3e1a0003')}${row(T0, ap('Liverpool', 'LPL'), ap('Blackpool', 'BLK'), T0 + 1500, '3e1a0000')}${row(T4, ap('Blackpool', 'BLK'), ap('Liverpool', 'LPL'), T4 + 1500, '3e1a0004')}</tbody></table></body></html>`;
    const asked = [], w = makeWin('https://www.flightradar24.com/data/aircraft/m-skto', asked, u => answerS(u) || answerX(u), html), L = await ready(w, asked);
    L.store.mergeHex('43eb1f', { reg: 'M-SKTO', type: 'A109' });
    // (a flight of its log days before: the log's own chaining of rows on)
    L.store.setHist('43eb1f', { v: 8, savedAt: Date.now(), days: {}, legs: [{ day: '2026/11/10', tStart: T0 - 9 * 86400, tEnd: T0 - 9 * 86400 + 1500, tOff: T0 - 9 * 86400, tOn: T0 - 9 * 86400 + 1500, startedOnGround: true, ended: true, how: 'ground', from: { id: LPL.id, code: 'LPL', conf: 'ground' }, to: { id: BLK.id, code: 'BLK', conf: 'ground' }, cs: 'MSKTO' }] });
    const cell = (fid, i) => w.document.querySelector(`[data-flight="${fid}"]`).closest('tr').children[i];
    const to1 = await until(() => /Axis/.test(cell('3e1a0001', 4).textContent) ? cell('3e1a0001', 4) : null, 20000);
    check('M-SKTO\'s log, FR24\'s "Blackpool -> Liverpool": its own track down in Gillmoss on Axis Business Park\'s helipad (OurAirports), 11 km from Liverpool\'s airport - the helipad over FR24\'s Liverpool, why in its title', !!to1 && to1.classList.contains('tl-over') && /Liverpool/.test(to1.title) && /never came near/.test(to1.title) && /Blackpool/.test(cell('3e1a0001', 3).textContent), to1 && { to: to1.textContent, title: to1.title });
    check('... every row\'s ends asked of the monitor in one ask - nothing of FR24\'s playback asked for them', endsAsked.length === 1 && ['3e1a0000', '3e1a0001', '3e1a0002', '3e1a0003', '3e1a0004'].every(f => endsAsked[0].includes(f)) && !asked.some(x => /flight-playback\.json\?flightId=3e1a000[013]/.test(x.url)), endsAsked);
    const to4 = await until(() => /Axis/.test(cell('3e1a0004', 4).textContent) ? cell('3e1a0004', 4) : null, 8000);
    check('... one the monitor last had low a kilometre out, far from FR24\'s Liverpool: FR24\'s whole track asked for - down on the pad: the helipad', !!to4 && to4.classList.contains('tl-over') && asked.filter(x => /flight-playback\.json\?flightId=3e1a0004/.test(x.url)).length === 1, cell('3e1a0004', 4).textContent);
    const from2 = await until(() => /Axis/.test(cell('3e1a0002', 3).textContent) ? cell('3e1a0002', 3).textContent : null, 5000);
    check('... its next flight\'s FROM, copied from that end: the helipad (inferred), not "Liverpool?"', !!from2 && /\?/.test(from2) && !/Liverpool/.test(from2), cell('3e1a0002', 3).textContent);
    check('... FR24\'s own kept where its track went there - down at Blackpool - and where it was lost in the air, 2,500 ft over Gillmoss', /Blackpool/.test(cell('3e1a0000', 4).textContent) && !cell('3e1a0000', 4).classList.contains('tl-filled') && /Liverpool/.test(cell('3e1a0003', 4).textContent) && !cell('3e1a0003', 4).classList.contains('tl-filled'), [cell('3e1a0000', 4).textContent, cell('3e1a0003', 4).textContent]);
    // ---- FR24's player of the flight: its "Liverpool" the same
    const inf = await L.pb141.pbInfo({ fid: '3e1a0001', reg: 'M-SKTO', cs: 'MSKTO', type: 'A109', dep: T1, ends: [{ t: T1, lat: BLK.lat, lon: BLK.lon, alt: 0, gs: 0 }, { t: L1, lat: AXIS[0], lon: AXIS[1] + 0.0002, alt: -375, gs: 0 }], wantCheck: true, fr24From: 'BLK', fr24To: 'LPL' });
    check('FR24\'s player of it, FR24\'s "BLK -> LPL": its destination the helipad its own track came down on; Blackpool kept', !!inf && inf.ok && inf.destOver === true && inf.destination && inf.destination.code === 'GB-1368' && !inf.originOver && !inf.origin, inf);
    const inf2 = await L.pb141.pbInfo({ fid: '3e1a0003', reg: 'M-SKTO', cs: 'MSKTO', type: 'A109', dep: T3, ends: [{ t: T3, lat: BLK.lat, lon: BLK.lon, alt: 0, gs: 0 }, { t: T3 + 1200, lat: AXIS[0], lon: AXIS[1], alt: 2500, gs: 90 }], wantCheck: true, fr24From: 'BLK', fr24To: 'LPL' });
    check('... one lost in the air: FR24\'s kept', !!inf2 && inf2.ok && !inf2.destOver && !inf2.destination, inf2);
    const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
    check('... no script errors', !errs.length, errs.slice(0, 5));
    w.close();
    // ---- FR24's player page itself: the page's part asks, and writes the helipad into FR24's page data
    const asked2 = [], w2 = makeWin('https://www.flightradar24.com/data/playback/3e1a0001', asked2, u => answerS(u) || answerX(u)); await ready(w2, asked2);
    const props = { errors: {}, trailSource: 'radar', callsign: 'MSKTO', flightNumber: null, airline: { name: 'Sloane', logoUrl: null, logoDimensions: null },
      origin: { code: 'BLK', city: 'Blackpool', lat: BLK.lat, long: BLK.lon }, destination: { code: 'LPL', city: 'Liverpool', lat: LPL.lat, long: LPL.lon }, aircraft: { name: 'AgustaWestland AW109', registration: 'M-SKTO' },
      flightTimes: { origin: { name: BLK.name, timezone: 'Europe/London' }, destination: { name: LPL.name, timezone: 'Europe/London' }, scheduledDeparture: null, actualDeparture: T1, scheduledArrival: null, actualArrival: L1 },
      trailRoute: [{ timestamp: T1, lat: BLK.lat, long: BLK.lon, altitude: 0 }, { timestamp: T1 + 600, lat: 53.6, long: -2.95, altitude: 1500 }, { timestamp: L1, lat: AXIS[0], long: AXIS[1] + 0.0002, altitude: -375 }],
      trail: [{ timestamp: T1, barometricAltitude: 0, groundSpeed: 0 }, { timestamp: T1 + 600, barometricAltitude: 1500, groundSpeed: 120 }, { timestamp: L1, barometricAltitude: -375, groundSpeed: 0 }], facts: [{ key: 'type_code', value: 'A109' }], download: { flightId: '3e1a0001', history: T1 } };
    w2.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map() }, $page: { component: 'Data/NewFlightPlayback', url: '/data/playback/3e1a0001', props }, $inertia: { push: () => {}, replace: () => {} } } } };
    const t0 = Date.now(), got = await until(() => props.destination.code === 'GB-1368' ? 1 : 0, 20000);
    const ask = w2.__posted.map(p => p.d).find(d => d && d.__tweeksLadd === 'pbInfo');
    check('FR24\'s player page of it: asked once with FR24\'s own codes and its track\'s ends; the helipad written into FR24\'s page data, its name on the times card, Blackpool kept', !!got && !!ask && ask.wantCheck && ask.fr24To === 'LPL' && ask.type === 'A109' && props.origin.code === 'BLK' && /Axis/.test(props.flightTimes.destination.name), { ms: Date.now() - t0, d: props.destination, ft: props.flightTimes.destination, ask: ask && { chk: ask.wantCheck, to: ask.fr24To, type: ask.type } });
    const errs2 = w2.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
    check('... no script errors', !errs2.length, errs2.slice(0, 5));
    w2.close();
  }
  // ======== a blocked aircraft's log page (M-PORT, FR24: "could not find data"): there at once, the slow lists not waited for
  {
    const DAYF = t => { const d = new Date(t * 1000); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };
    const FAB = AP('FAB') || AP('LTN'), T = DAY0 + 9 * 3600;
    const histLeg = { day: DAYF(T), tStart: T, tEnd: T + 2400, tOff: T + 60, tOn: T + 2340, startedOnGround: true, ended: true, how: 'ground', from: { id: MAN.id, code: 'MAN', conf: 'ground' }, to: { id: FAB.id, code: FAB.iata, conf: 'ground' }, cs: 'MPORT', maxAlt: 31000 };
    const asked = [], t0 = Date.now(), slow = [];
    const answerP = u => {
      if (u.startsWith(MON + '/oaap')) { slow.push('oa'); return [6000, 200, JSON.stringify({ rows: [] })]; }
      if (/hexdb\.io\/reg-hex/.test(u)) { slow.push('hexdb'); return [5000, 200, '424B68']; }
      if (/raw\.githubusercontent\.com\/davidmegginson\/ourairports-data/.test(u)) { slow.push('sites'); return [9000, 404, '']; }
      if (u.startsWith(MON + '/hist?hex=424b68')) return [5, 200, JSON.stringify({ hv: 8, list: [{ hex: '424b68', blk: 1, days: { [DAYF(T)]: 1 }, legs: [histLeg] }] })];
      if (u.startsWith(MON + '/owners?hex=') && /424b68/.test(u)) return [5, 200, JSON.stringify({ list: [['424b68', 'M-PORT', 'GL5T', 'Bombardier Global 5000', 'Portman Aviation Ltd', 'Douglas', 'Isle of Man', 'IM', '9868', 2008, 0, '', '', 1, 1, 0]] })];
      return null;
    };
    const html = `<!doctype html><html><head><title>M-PORT - Bombardier Global 5000 - Flightradar24</title></head><body><div id="cnt-subpage-info"><h1>M-PORT</h1></div>
      <div id="cnt-aircraft-info">
        <div class="row"><label>AIRCRAFT</label> <span class="details">Bombardier Global 5000</span></div>
        <div class="row"><label>AIRLINE</label> <span class="details">Private owner</span></div>
        <div class="row"><label>OPERATOR</label> <span class="details">-</span></div>
        <div class="row"><label>TYPE CODE</label> <span class="details">GL5T</span></div>
        <div class="row"><label>MODE S</label> <span class="details" id="txt-mode-s">424B68</span></div>
        <div class="row"><label>SERIAL NUMBER (MSN)</label> <span class="details"><i class="icon-fr24-lock"></i></span></div>
        <div class="row"><label>AGE</label> <span class="details"><i class="icon-fr24-lock"></i></span></div>
      </div>
      <table id="tbl-datatable"><tbody><tr><td colspan="12">Sorry, but we could not find data for specified flight</td></tr></tbody></table></body></html>`;
    const w = makeWin('https://www.flightradar24.com/data/aircraft/m-port', asked, u => answerP(u) || answerX(u), html), L = await ready(w, asked);
    const tR = Date.now();
    const row = await until(() => w.document.querySelector('tr.tl-adsb-row'), 8000), ms = Date.now() - tR;
    check('M-PORT\'s log page (FR24 has none of its flights): its flights the monitor rebuilt, there at once - not after the slow lists (OurAirports\' 6 s, hexdb\'s 5 s, the strips\' 9 s here)', !!row && ms < 2500 && /Manchester|MAN/.test(row.textContent) && !w.document.querySelector('#tbl-datatable tbody tr td[colspan="12"]'), { ms, row: row && row.textContent.replace(/\s+/g, ' ').slice(0, 120), slow, sinceOpen: Date.now() - t0 });
    const span = lb => [...w.document.querySelectorAll('#cnt-aircraft-info .row')].find(r => r.querySelector('label').textContent === lb).querySelector('span.details');
    const own = await until(() => /Portman/.test(span('AIRLINE').textContent) ? 1 : 0, 3000), ms2 = Date.now() - tR;
    check('... its header from the monitor in the same moment: its owner over "Private owner", its serial number and age - no padlock', !!own && ms2 < 3500 && /9868/.test(span('SERIAL NUMBER (MSN)').textContent) && /\d+ year/.test(span('AGE').textContent) && /Portman/.test(span('OPERATOR').textContent), { ms2, al: span('AIRLINE').textContent, msn: span('SERIAL NUMBER (MSN)').textContent, age: span('AGE').textContent });
    const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
    check('... no script errors', !errs.length, errs.slice(0, 5));
    w.close();
  }
  // ======== a phone's small panel at the foot of the map (its full panel not pulled up): M-SKTO's "Private owner" =========
  {
    const asked = [], w = makeWin('https://www.flightradar24.com/53.47,-2.90/12', asked, answerX), L = await ready(w, asked);
    L.store.mergeHex('43eb1f', { reg: 'M-SKTO', type: 'A109', owner: 'Sloane Helicopters Ltd', ownerAskedAt: Date.now(), monOwnAt: Date.now(), pubAt: Date.now(), pubFull: true, msn: '22001', year: 2008 });
    w.document.body.insertAdjacentHTML('beforeend', '<div class="small"><div><span data-testid="aircraft-panel__header__callsign">MSKTO</span></div><p data-testid="aircraft-small-panel__airline-name">Private owner</p><span data-testid="aircraft-small-panel__registration">M-SKTO</span><span data-testid="aircraft-small-panel__departure-iata">N/A</span><span data-testid="aircraft-small-panel__arrival-iata">BLK</span></div>');
    const al = () => w.document.querySelector('[data-testid="aircraft-small-panel__airline-name"]');
    L.syncPanel();
    const got = await until(() => /Sloane/.test(al().textContent) ? al().textContent : null, 3000);
    check('a phone\'s small panel (the full one not drawn): FR24\'s "Private owner" - its registered owner, as the full panel gives it', !!got && /^Sloane Helicopters$/.test(got.trim()), al().textContent);
    // (FR24 drawing it anew, again its own words: the owner written once more, never back and forth)
    let writes = 0; new w.MutationObserver(r => { writes += r.length; }).observe(al(), { childList: true, characterData: true, subtree: true });
    L.syncPanel(); await sleep(400); L.syncPanel(); await sleep(400);
    check('... written once: no writing back and forth as the panel is gone over again', writes === 0 && /Sloane/.test(al().textContent), { writes, t: al().textContent });
    al().dataset.tlOrig = 'Loganair'; delete al().dataset.tlVal; al().firstChild.nodeValue = 'Loganair'; L.syncPanel(); await sleep(300);
    check('... an airline FR24 names itself: left alone', al().textContent.trim() === 'Loganair', al().textContent);
    const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
    check('... no script errors', !errs.length, errs.slice(0, 5));
    w.close();
  }
  // ======== the airport search of FR24's flights page: an OurAirports field (EGOW) - the list waited for ===================
  {
    const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/data/flights', runScripts: 'dangerously' });
    const w = dom.window, posted = [];
    w.postMessage = d => posted.push(d); w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.indexedDB = undefined; w.Response = Response; w.Headers = Headers;
    w.fetch = input => { const u = typeof input === 'string' ? input : input.url; return /\/api\/v1\/airports\/search\?query=EGOW/.test(u) ? Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })) : Promise.reject(new Error('offline')); };
    w.__tlTestHook = () => {};
    const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
    w.eval('(' + m[0] + ')()');
    const t0 = Date.now();
    const resP = w.fetch('https://www.flightradar24.com/api/v1/airports/search?query=EGOW').then(r => r.json());
    const ask = await until(() => posted.find(p => p && p.__tweeksLadd === 'oaFind'), 2000);
    // (the userscript's list read as the page opens: its answer a second and a half on - longer than the half second before)
    await sleep(1500);
    const row = [17000002, 'EGOW', 'EGOW', 'RAF Woodvale', 'Formby', 0, 53.5816, -3.0555, 37, 'M'];
    w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'oaFound', key: ask && ask.key, list: [{ row, ref: null, near: null }] }, source: w }));
    const res = await resP;
    check('FR24\'s flights page, its airport search for EGOW (an OurAirports field): the userscript\'s list waited for while the page has none - found', !!ask && ask.q === 'EGOW' && Array.isArray(res.data) && res.data.some(a => a.id === 17000002 && a.iata === 'EGOW' && /Woodvale/.test(a.name)) && Date.now() - t0 >= 1400, { res, ms: Date.now() - t0 });
    w.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
