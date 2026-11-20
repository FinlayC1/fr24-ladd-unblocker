// 1.4.2 (the BUILT userscript in jsdom, FR24's new pages' own page data):
//   - the shared monitor's last good check kept (localStorage, no secret): a page opened within 20 minutes asks it at once,
//     not after its check; none kept - after it, as before; a check that fails takes the note away
//   - the records on disk read by a request made before the database is open (the log pages' first line): never "none kept"
//   - FR24's own track's ends of a flight that has ended, kept: the log page opened again asks FR24's playback for none
//   - each callsign's flight number FR24's own rows show: kept, sent to the monitor with the report
//   - a flight number's page: its flights of the world log (no FR24 id) under FR24's, played from public ADS-B
//   - in the app: the aircraft page laid out for a phone again (06-phone, made from the old page) - once the page is shown,
//     all of it at once; FR24's own player page left to FR24
// usage: node test/unit_142.cjs <node_modules dir> [data dir]
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
const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// (o: idb - an IndexedDB shared with another page; ls - localStorage set before the script; app - FR24's site in the app;
// status - how long the monitor's check takes)
function makeWin(url, page, answerX, o) {
  o = o || {};
  const html = `<!doctype html><html><head><link rel="stylesheet" href="https://www.flightradar24.com/build/assets/app-Ca_3eB3-.css"></head><body class="antialiased">${page ? `<div id="app" data-page="${attr(JSON.stringify(page))}"></div>` : '<div id="app"></div>'}</body></html>`;
  const win = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = o.idb || new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.caches = { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => false }) };
  const asked = [], t0 = Date.now();
  const answer = (u, body) => {
    asked.push({ u, t: Date.now() - t0, body });
    if (answerX) { const r = answerX(u, body); if (r) return r; }
    if (/flightradar24\.com\/mobile\/airports\/format/.test(u)) return [0, 200, AIRPORTS];
    if (u.startsWith(MON + '/status')) return [o.status || 5, 200, JSON.stringify({ v: 3, ver: 'test' })];
    return [0, 404, ''];
  };
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const a = answer(u); return new Promise(r => setTimeout(() => r(new Response(a[2] || '', { status: a[1] })), a[0])); };
  win.GM_xmlhttpRequest = q => { const a = answer(q.url, q.data); setTimeout(() => { q.onload && q.onload({ status: a[1], responseText: a[2], response: a[2] }); }, a[0] || 1); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = data => { setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.__logs = []; win.console.debug = (...a) => win.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); win.console.log = () => {}; win.console.error = (...a) => win.__logs.push('ERROR ' + a.join(' '));
  for (const [k, v] of Object.entries(o.ls || {})) win.localStorage.setItem(k, v);
  if (o.app) win.TL_APP = { v: 2, platform: 'android', update: () => false };
  win.eval(SRC);
  win.__asked = asked;
  return win;
}
const ORK = AP('ORK'), EDI = AP('EDI'), LPL = AP('LPL'), DUB = AP('DUB');
const T = Math.floor(Date.now() / 1000) - 3 * 3600;
const apOf = (a, tz) => ({ name: a.name, city: a.city, iata: a.iata, icao: a.icao, countryId: 1, countryName: a.country, timezone: tz });
const fl = o => Object.assign({ id: '5889300099', flightId: '42a444ba', callsign: 'RYR70PX', flightNumber: 'FR3731', activeDay: '', scheduledDeparture: T, actualDeparture: T + 447, scheduledArrival: T + 4800, estimatedDeparture: T + 447, estimatedArrival: T + 4223, flightTimeSeconds: 3776, status: { name: 'landed', color: 'green', board: 'arrivals' }, origin: apOf(ORK, 'Europe/Dublin'), destination: apOf(EDI, 'Europe/London'), divertedTo: null, aircraft: { type: 'B738', registration: 'EI-DCY', typeUrl: 'b738' }, live: false }, o);
const acPage = flights => ({ component: 'Data/AircraftRegistration', props: { aircraft: { registration: 'EI-DCY', model: 'Boeing 737-8AS', typeCode: 'B738', modeS: '4CA24D', msn: null, manufactured: null, age: null, testFlight: false, owner: 'Ryanair' }, withheld: { msn: true, age: true }, airline: { name: 'Ryanair', iata: 'FR', icao: 'RYR', url: '/data/airlines/fr-ryr' }, operator: { name: 'Ryanair', iata: 'FR', icao: 'RYR', url: '/data/airlines/fr-ryr' }, photos: [], flights, meta: { hiddenByPlan: true, historyDays: 7 }, historyAvailable: true } });
// (FR24's track of a flight - its playback answer)
const track = (id, a, b, t) => { const tr = []; for (let i = 0; i <= 30; i++) { const f = i / 30; tr.push({ latitude: a.lat + (b.lat - a.lat) * f, longitude: a.lon + (b.lon - a.lon) * f, altitude: { feet: i === 0 || i === 30 ? 0 : 20000, meters: 0 }, speed: { kts: i === 0 || i === 30 ? 0 : 400 }, timestamp: t + i * 120, heading: 0 }); } return JSON.stringify({ result: { response: { data: { flight: { identification: { id, number: { default: 'FR9001' }, callsign: 'RYR9001' }, track: tr } } } } }); };

(async () => {
  // ======== the monitor's check: kept a while, asked at once ===========================================================
  {
    const page = acPage([fl()]);
    const w = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', page, null, { status: 2500, ls: { 'tl.mon1': JSON.stringify({ u: MON, at: Date.now() - 5 * 60000, d: 1 }) } });
    await until(() => w.__asked.some(a => a.u.startsWith(MON + '/fr24ends')) && w.__asked.some(a => a.u.startsWith(MON + '/status')), 6000);
    const st = w.__asked.find(a => a.u.startsWith(MON + '/status')), en = w.__asked.find(a => a.u.startsWith(MON + '/fr24ends'));
    check('the shared monitor answered its check 5 minutes ago (kept, no secret): its rows\' ends asked at once - not after the check (2.5 s here), which is made meanwhile', !!en && en.t < 2000 && !!st && st.t < 2000, { ends: en && en.t, status: st && st.t });
    await until(() => { try { return JSON.parse(w.localStorage.getItem('tl.mon1')).at > Date.now() - 3000; } catch (e) { return false; } }, 6000);
    const n = JSON.parse(w.localStorage.getItem('tl.mon1') || 'null');
    check('... its check answered again: the note renewed - the address and when, nothing else', !!n && n.u === MON && n.d === 1 && Object.keys(n).sort().join() === 'at,d,u', n);
    w.close();
  }
  {
    const w = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', acPage([fl()]), null, { status: 1500 });
    await until(() => w.__asked.some(a => a.u.startsWith(MON + '/fr24ends')), 6000);
    const en = w.__asked.find(a => a.u.startsWith(MON + '/fr24ends'));
    check('... none kept (or over 20 minutes old): the check answered first, as before', !!en && en.t >= 1400, en && en.t);
    w.close();
  }
  {
    const w = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', acPage([fl()]), u => u.startsWith(MON + '/status') ? [5, 403, 'no'] : null, { ls: { 'tl.mon1': JSON.stringify({ u: MON, at: Date.now() - 60000, d: 1 }) } });
    await until(() => w.localStorage.getItem('tl.mon1') === null, 6000);
    check('... a check refused: the note taken away (the monitor not used)', w.localStorage.getItem('tl.mon1') === null && !w.__tweeksLadd.monUp());
    w.close();
  }
  // ======== FR24's search asked in the background: paced, paused after a refusal =======================================
  {
    let n = 0;
    const w = makeWin('https://www.flightradar24.com/data/airports', null, u => { if (/\/v1\/search\/web\/find/.test(u)) { n++; return n === 3 ? [5, 403, '<!DOCTYPE html><title>Just a moment...</title>'] : [5, 200, JSON.stringify({ results: [] })]; } return null; });
    await until(() => w.__tweeksLadd && w.__tweeksLadd.fr24, 5000);
    const F = w.__tweeksLadd.fr24, ps = ['N117TP', 'N1013', 'N281MM', 'N114NF', 'N806CH'].map(r => F.aircraftInfo(r, true).then(() => 'ok', e => String(e.message || e)));
    await sleep(500);
    check('FR24\'s search asked in the background (an aircraft\'s operator): one at a time, two seconds apart - not a third of a second', n === 1, n);
    const out = await Promise.all(ps);
    const ts = w.__asked.filter(a => /search\/web\/find/.test(a.u)).map(a => a.t);
    check('... refused by FR24 (its verification page): the rest not asked - paused, the user\'s own search left to work', n === 3 && out[2] === 'HTTP 403' && out[3] === 'FR24 search paused' && out[4] === 'FR24 search paused' && ts[1] - ts[0] >= 1900 && ts[2] - ts[1] >= 1900, { n, out, ts });
    const fg = await F.aircraftInfo('M-SKTO').then(() => 'asked', e => String(e.message || e));
    check('... the page\'s own ask (the aircraft of a log page) not held by it', fg === 'asked' && n === 4, { fg, n });
    w.close();
  }
  // ======== the records on disk, asked for before the database is open =================================================
  {
    const idb = new FIDB.IDBFactory();
    const w1 = makeWin('https://www.flightradar24.com/data/airports', null, null, { idb });
    await until(() => w1.__tweeksLadd && w1.__tweeksLadd.store.mode() === 'idb', 10000);
    w1.__tweeksLadd.store.setHist('b:test142', { rows: [1, 2, 3], at: 7 }); w1.__tweeksLadd.store.flushNow(); await sleep(300);
    w1.close();
    const w2 = makeWin('https://www.flightradar24.com/data/airports', null, null, { idb });
    const v = await w2.__tweeksLadd.store.getHist('b:test142');
    check('a kept list read at the page\'s first line, before the database is open: there (it was "none kept" - the landing sites and OurAirports lists downloaded on every log page)', !!v && JSON.stringify(v.rows) === '[1,2,3]', v);
    w2.close();
  }
  // ======== FR24's track's ends of an ended flight, kept ================================================================
  {
    const idb = new FIDB.IDBFactory();
    // (a flight whose airports FR24 leaves out: its track's ends wanted; the monitor has none of it - FR24's playback asked)
    const page = acPage([fl({ id: '5889301111', flightId: '42a50001', callsign: 'RYR9001', flightNumber: 'FR9001', origin: null, destination: null })]);
    const pbAns = u => /flight-playback\.json\?flightId=42a50001/.test(u) ? [5, 200, track('42a50001', LPL, DUB, T + 447)] : u.startsWith(MON + '/fr24ends') ? [5, 200, JSON.stringify({ v: 1, list: {} })] : null;
    const w1 = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', page, pbAns, { idb });
    await until(() => w1.__asked.some(a => /flight-playback\.json\?flightId=42a50001/.test(a.u)), 15000);
    await until(() => { const r = w1.document.querySelector('#tbl-datatable tbody tr.data-row'); return r && /Dublin/.test(r.children[4].textContent); }, 8000);
    const row = w1.document.querySelector('#tbl-datatable tbody tr.data-row');
    check('a flight FR24 names no airports of, the monitor nothing of: FR24\'s own track\'s ends read - its row Liverpool to Dublin', !!row && /Liverpool/.test(row.children[3].textContent) && /Dublin/.test(row.children[4].textContent), row && [row.children[3].textContent.trim(), row.children[4].textContent.trim()]);
    await sleep(800); w1.dispatchEvent(new w1.Event('pagehide')); await sleep(300); w1.close();
    const w2 = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', page, pbAns, { idb });
    await until(() => { const r = w2.document.querySelector('#tbl-datatable tbody tr.data-row'); return r && /Dublin/.test(r.children[4].textContent); }, 15000);
    await sleep(1000);
    check('... the page opened again: the same ends at once - FR24\'s playback not asked again (its ends kept)', /Dublin/.test(w2.document.querySelector('#tbl-datatable tbody tr.data-row').children[4].textContent) && !w2.__asked.some(a => /flight-playback\.json\?flightId=42a50001/.test(a.u)), w2.__asked.filter(a => /flight-playback/.test(a.u)).map(a => a.u));
    w2.close();
  }
  // ======== callsigns' flight numbers from FR24's rows: kept, sent to the monitor ======================================
  {
    const idb = new FIDB.IDBFactory();
    let rep = null;
    const w = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', acPage([fl(), fl({ id: '5889300044', flightId: '42a30001', callsign: 'RYR4MA', flightNumber: 'FR4416', scheduledDeparture: T - 86400, actualDeparture: T - 86400 + 600 })]), (u, body) => { if (u === MON + '/report') { rep = JSON.parse(body); return [5, 200, '{"ok":true,"csfn":2}']; } return null; }, { idb });
    await until(() => w.document.querySelector('#content[data-tl-classic] #tbl-datatable tbody tr'), 15000);
    await until(() => w.__tweeksLadd.monUp(), 5000);
    await w.__tweeksLadd.reportToMonitor();
    const c = rep && rep.csfn ? rep.csfn.map(r => r[0] + '=' + r[1]).sort().join(',') : '';
    check('a log page\'s rows of FR24 (RYR70PX is FR3731): sent to the monitor with the report - callsign, flight number, when', c === 'RYR4MA=FR4416,RYR70PX=FR3731' && rep.csfn.every(r => r[2] > 1e9), rep && rep.csfn);
    await sleep(2000);
    const kept = w.__tweeksLadd.store.kvGet('csFnSeen1') || {};
    check('... and kept here (60 days) for the rows rebuilt from ADS-B', kept.RYR70PX && kept.RYR70PX[0] === 'FR3731' && kept.RYR4MA && kept.RYR4MA[0] === 'FR4416', kept);
    rep = null; await w.__tweeksLadd.reportToMonitor();
    check('... sent once', !rep || !rep.csfn, rep);
    w.close();
  }
  // ======== a flight number's page: its flights of the world log under FR24's ===========================================
  {
    const page = { component: 'Data/FlightHistory', props: { flightNumber: 'FR3731', callsign: null, airline: { id: 6, name: 'Ryanair', iata: 'FR', icao: 'RYR', url: 'fr-ryr' }, flights: [fl()], about: [], meta: { hiddenByPlan: true, historyDays: 7 } } };
    const old = T - 20 * 86400;
    const fn = u => u.startsWith(MON + '/fr24fn') ? [5, 200, JSON.stringify({ v: 1, fn: 'FR3731', keep: 100, list: [{ fid: '', w: 1, fn: 'FR3731', cs: 'RYR70PX', hex: '4ca24d', reg: 'EI-DCY', type: 'B738', from: 'ORK', to: 'EDI', fromId: ORK.id, toId: EDI.id, t0: old, t1: old + 3700 }, { fid: '42a00077', fn: 'FR3731', cs: 'RYR70PX', hex: '4ca24d', reg: 'EI-DCY', type: 'B738', from: 'ORK', to: 'EDI', t0: T - 10 * 86400, t1: T - 10 * 86400 + 3700 }] })] : null;
    const w = makeWin('https://www.flightradar24.com/data/flights/fr3731', page, fn), d = w.document;
    await until(() => d.querySelectorAll('#tbl-datatable tbody tr.tl-fn-old').length >= 2, 15000);
    const rows = [...d.querySelectorAll('#tbl-datatable tbody tr.tl-fn-old')], last = rows[rows.length - 1], foot = d.querySelector('tr.tl-fn-foot');
    const play = last && last.querySelector('a.btn-playback');
    check('a flight number\'s page: its flights before FR24\'s week - the monitor\'s of FR24\'s map, and the world log\'s by its callsigns', rows.length === 2 && /Cork/.test(last.children[3].textContent) && /Edinburgh/.test(last.children[4].textContent), rows.map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)));
    check('... the world log\'s played from public ADS-B (its own id: the aircraft and its take-off), FR24\'s by FR24\'s id', !!play && new RegExp('#ff4ca24d' + ('00000000' + old.toString(16)).slice(-8) + '$').test(play.getAttribute('href') || '') && /#42a00077$/.test(rows[0].querySelector('a.btn-playback').getAttribute('href') || ''), [play && play.getAttribute('href'), rows[0].querySelector('a.btn-playback') && rows[0].querySelector('a.btn-playback').getAttribute('href')]);
    check('... the footer says which is which', !!foot && /1 as Flightradar24's map showed them/.test(foot.textContent) && /1 from public ADS-B \(adsb\.lol\) by FR3731's callsigns/.test(foot.textContent), foot && foot.textContent);
    w.close();
  }
  // ======== the app: the log page laid out for a phone again ===========================================================
  {
    const w = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', acPage([fl(), fl({ id: '5889300044', flightId: '42a30001', callsign: 'RYR4MA', flightNumber: 'FR4416', scheduledDeparture: T - 86400, actualDeparture: T - 86400 + 600 })]), null, { app: true }), d = w.document;
    await until(() => d.querySelector('#content[data-tl-classic]'), 15000);
    const early = !d.getElementById('tl-pv') || !!d.querySelector('#content.tl-cl-wait') === false;
    await until(() => d.querySelector('#tl-pv .tl-pv-row'), 20000);
    const pv = d.getElementById('tl-pv'), rows = pv ? [...pv.querySelectorAll('.tl-pv-row')] : [];
    check('in the app: FR24\'s new aircraft page turned back into the old one, and that laid out for a phone - its bar, its flights by year', !!pv && /AIRCRAFT/.test(pv.querySelector('.tl-pv-k').textContent) && /EI-DCY/.test(pv.querySelector('.tl-pv-n').textContent) && rows.length === 2 && !!pv.querySelector('.tl-pv-year') && d.documentElement.classList.contains('tl-pv-on'), rows.map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)));
    check('... not before the page is shown (all of it at once)', early && !d.querySelector('#content.tl-cl-wait'));
    check('... a flight\'s Play: FR24\'s own player page for a phone', !!rows[0] && [...rows[0].querySelectorAll('.tl-pv-btns button')].some(b => /Play/.test(b.textContent)));
    w.close();
  }
  {
    const page = { component: 'Data/Playback', props: { flight: { aircraft: { registration: 'EI-DCY' } } } };
    const w = makeWin('https://www.flightradar24.com/data/playback/42a444ba', page, null, { app: true }), d = w.document;
    await until(() => w.__tweeksLadd && w.__tweeksLadd.engine.airports.length > 5000, 30000); await sleep(1500);
    check('... FR24\'s own player page in the app: left to FR24 (made for a phone) - not sent to the aircraft\'s old page', !d.querySelector('#content[data-tl-classic]') && !d.getElementById('tl-classic-hide') && w.location.pathname === '/data/playback/42a444ba');
    w.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed', e && e.stack); process.exit(1); });
