// 1.4.1, FR24's log pages as they were (06-classic; the BUILT userscript in jsdom, FR24's new pages' own page data):
//   - an aircraft's page (Data/AircraftRegistration): the old page drawn from FR24's page data - FR24's header kept, its
//     old stylesheets before FR24's own, the breadcrumbs, the title bar, the aircraft's facts and pictures, padlocks where
//     FR24 withholds; each flight a row of the old table, in the old markup: date, airports (city and blue code), the
//     flight number blue and linked, times local to each airport, the status as the old pages wrote it, KML / CSV / Play
//     - Live for one in the air, Share for one not flown yet
//   - a row's Play: the old panel over the map - FR24's own track of the flight, its median time and delay, the figures
//     of each moment, the map 600 px high and the page's content over its foot; played; closed again
//   - a flight number's page (Data/FlightHistory): its airline in the heading, the aircraft column; one FR24 has no flight
//     of: the old page's words, with its footer
//   - switched off ("Old-style log pages"): FR24's new page left as it is; a page without FR24's page data (FR24's own old
//     page) left to the old pages' own work, at once
// usage: node test/unit_classic.cjs <node_modules dir> [data dir]
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
function makeWin(url, page, answerX, opts) {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="https://www.flightradar24.com/build/assets/app-Ca_3eB3-.css"></head><body class="antialiased">${page ? `<div id="app" data-page="${attr(JSON.stringify(page))}"></div>` : '<div id="app"></div>'}</body></html>`;
  const win = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.caches = { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => false }) };
  const asked = [];
  const answer = (u, body) => {
    asked.push(u);
    if (answerX) { const r = answerX(u, body); if (r) return r; }
    if (/flightradar24\.com\/mobile\/airports\/format/.test(u)) return [0, 200, AIRPORTS];
    if (u.startsWith(MON + '/status')) return [5, 200, JSON.stringify({ v: 3, ver: 'test' })];
    return [0, 404, ''];
  };
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const a = answer(u); return new Promise(r => setTimeout(() => r(new Response(a[2] || '', { status: a[1] })), a[0])); };
  win.GM_xmlhttpRequest = o => { const a = answer(o.url, o.data); setTimeout(() => { o.onload && o.onload({ status: a[1], responseText: a[2], response: a[2] }); }, a[0] || 1); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = data => { setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.__logs = []; win.console.debug = (...a) => win.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); win.console.log = () => {}; win.console.error = (...a) => win.__logs.push('ERROR ' + a.join(' '));
  if (opts && opts.opts) win.localStorage.setItem('tweeks.fr24.ladd.opts1', JSON.stringify(opts.opts));
  win.eval(SRC);
  win.__asked = asked;
  return win;
}
const ORK = AP('ORK'), EDI = AP('EDI');
// FR24's page data of EI-DCY, as its new page carries it (19 Nov 2026)
const T = 1795101300; // 15:15Z
const apOf = (a, tz) => ({ name: a.name, city: a.city, iata: a.iata, icao: a.icao, countryId: 1, countryName: a.country, timezone: tz });
const FLIGHTS = [
  // (not flown yet, its departure put back: "Estimated departure", yellow; Share)
  { id: '5889300111', flightId: null, callsign: null, flightNumber: 'FR905', activeDay: '2026-11-19', scheduledDeparture: T + 5 * 3600, actualDeparture: null, scheduledArrival: T + 7 * 3600, estimatedDeparture: T + 5 * 3600 + 1620, estimatedArrival: null, flightTimeSeconds: null, status: { name: 'estimated', color: 'yellow', board: 'departures' }, origin: apOf(AP('STN'), 'Europe/London'), destination: apOf(ORK, 'Europe/Dublin'), divertedTo: null, aircraft: { type: 'B738', registration: 'EI-DCY', typeUrl: 'b738' }, live: false },
  // (in the air: "Estimated" its landing, green; Live)
  { id: '5889300222', flightId: '42a4f001', callsign: 'RYR70QX', flightNumber: 'FR3733', activeDay: '2026-11-19', scheduledDeparture: T + 2 * 3600, actualDeparture: T + 2 * 3600 + 300, scheduledArrival: T + 3 * 3600, estimatedDeparture: T + 2 * 3600 + 300, estimatedArrival: T + 3 * 3600 - 120, flightTimeSeconds: null, status: { name: 'estimated', color: 'green', board: 'arrivals' }, origin: apOf(ORK, 'Europe/Dublin'), destination: apOf(EDI, 'Europe/London'), divertedTo: null, aircraft: { type: 'B738', registration: 'EI-DCY', typeUrl: 'b738' }, live: true },
  // (landed: "Landed 16:25", green; KML / CSV / Play)
  { id: '5889300099', flightId: '42a444ba', callsign: 'RYR70PX', flightNumber: 'FR3731', activeDay: '2026-11-19', scheduledDeparture: T, actualDeparture: T + 447, scheduledArrival: T + 4800, estimatedDeparture: T + 447, estimatedArrival: T + 4223, flightTimeSeconds: 3776, status: { name: 'landed', color: 'green', board: 'arrivals' }, origin: apOf(ORK, 'Europe/Dublin'), destination: apOf(EDI, 'Europe/London'), divertedTo: null, aircraft: { type: 'B738', registration: 'EI-DCY', typeUrl: 'b738' }, live: false },
  // (an airport an hour ahead: its own local times)
  { id: '5889300044', flightId: '42a30001', callsign: 'RYR4MA', flightNumber: 'FR4416', activeDay: '2026-11-18', scheduledDeparture: T - 86400, actualDeparture: T - 86400 + 600, scheduledArrival: T - 86400 + 9000, estimatedDeparture: null, estimatedArrival: T - 86400 + 8700, flightTimeSeconds: 8100, status: { name: 'landed', color: 'green', board: 'arrivals' }, origin: apOf(ORK, 'Europe/Dublin'), destination: apOf(AP('AGP'), 'Europe/Madrid'), divertedTo: null, aircraft: { type: 'B738', registration: 'EI-DCY', typeUrl: 'b738' }, live: false }
];
const AC_PAGE = { component: 'Data/AircraftRegistration', props: { aircraft: { registration: 'EI-DCY', model: 'Boeing 737-8AS', typeCode: 'B738', modeS: '4CA24D', msn: null, manufactured: null, age: null, testFlight: false, owner: 'Ryanair' }, withheld: { msn: true, age: true }, airline: { name: 'Ryanair', iata: 'FR', icao: 'RYR', url: '/data/airlines/fr-ryr' }, operator: { name: 'Ryanair', iata: 'FR', icao: 'RYR', url: '/data/airlines/fr-ryr' }, photos: [{ url: 'https://cdn.jetphotos.com/640/6/665431_1789543490.jpg', link: 'https://www.jetphotos.com/photo/12233061', copyright: 'De Guidi Oscar' }, { url: 'https://cdn.jetphotos.com/640/6/807536_1769787543.jpg', link: 'https://www.jetphotos.com/photo/12000998', copyright: 'Szymon Gregorowicz' }], flights: FLIGHTS, meta: { hiddenByPlan: true, historyDays: 7 }, historyAvailable: true } };
// (FR24's own track of FR3731, as its old panel asked for it: Cork to Edinburgh, a point a minute)
function playback() {
  const track = []; for (let i = 0; i <= 60; i++) { const f = i / 60; track.push({ latitude: ORK.lat + (EDI.lat - ORK.lat) * f, longitude: ORK.lon + (EDI.lon - ORK.lon) * f, altitude: { feet: Math.round(Math.sin(Math.PI * f) * 30000), meters: 0 }, speed: { kts: i ? 420 : 0, kmh: 0, mph: 0 }, verticalSpeed: { fpm: 0, ms: 0 }, heading: 45, squawk: '0', timestamp: T + 447 + i * 60, ems: null }); }
  const ap = a => ({ name: a.name, code: { iata: a.iata, icao: a.icao }, position: { latitude: a.lat, longitude: a.lon, region: { city: a.city } } });
  return JSON.stringify({ result: { response: { data: { flight: { identification: { id: '42a444ba', number: { default: 'FR3731' }, callsign: 'RYR70PX' }, aircraft: { model: { code: 'B738', text: 'Boeing 737-8AS' }, identification: { modes: '4CA24D', registration: 'EI-DCY', serialNo: null } }, airport: { origin: ap(ORK), destination: ap(EDI) }, median: { time: 3450, delay: 241 }, track, aircraftImages: {} } } } } });
}

(async () => {
  // ======== an aircraft's page ==========================================================================================
  {
    const w = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', AC_PAGE, u => /flight-playback\.json\?flightId=42a444ba/.test(u) ? [10, 200, playback()] : null);
    const d = w.document;
    await until(() => d.querySelector('#content[data-tl-classic] #tbl-datatable tbody tr'), 20000);
    const root = d.querySelector('#content[data-tl-classic]');
    check('the old page drawn: #content.bootstrap.data-aircraft, after FR24\'s page (kept, its header alone shown)', !!root && root.classList.contains('bootstrap') && root.classList.contains('data-aircraft') && d.getElementById('app') && d.getElementById('app').nextElementSibling && d.getElementById('app').nextElementSibling.id === 'tl-cl-spacer', root && root.className);
    check('... the body as the old pages had it (id "data", their classes)', d.body.id === 'data' && ['fr-ui', 'desktop', 'staticPage', 'dataHasSettings', 'fr24-top-navigation'].every(c => d.body.classList.contains(c)), d.body.className);
    const st = d.getElementById('tl-classic-style');
    check('... FR24\'s new page all but its header hidden; nothing of it hidden before the old page is there (no hiding left)', !!st && /#app main\{display:none!important\}/.test(st.textContent) && /height:3\.25rem/.test(st.textContent) && !d.getElementById('tl-classic-hide'));
    const links = [...d.querySelectorAll('link[data-tl-classic]')].map(l => l.href), app = d.querySelector('link[href*="build/assets/app-"]');
    check('... the old pages\' stylesheets, from FR24\'s server, in their order - bootstrap 3.3.7, screen_new, ..., the aircraft page\'s, main', links.length === 14 && /twitter-bootstrap\/3\.3\.7/.test(links[3]) && /screen_new\.css$/.test(links[4]) && /pages\/data\/aircraft\.aircraft\.css$/.test(links[12]) && /bundle\/main\.[0-9a-f]+\.css$/.test(links[13]) && links.every(h => /^https:\/\/(www\.flightradar24\.com|cdnjs\.cloudflare\.com)\//.test(h)), links);
    check('... before FR24\'s own (its header\'s come after them, as on its old pages)', [...d.querySelectorAll('link[data-tl-classic]')].every(l => l.compareDocumentPosition(app) & w.Node.DOCUMENT_POSITION_FOLLOWING));
    check('... the breadcrumbs: Flight tracker map > Aviation data > Aircraft > EI-DCY', [...d.querySelectorAll('nav.breadcrumbs li')].map(l => l.textContent.trim()).join(' > ') === 'Flight tracker map > Aviation data > Aircraft > EI-DCY');
    check('... the title bar', (d.querySelector('#cnt-subpage-info h1') || {}).textContent === 'Flight history for aircraft - EI-DCY');
    const info = [...d.querySelectorAll('#cnt-aircraft-info .row.p-l-20')].map(r => r.querySelector('label').textContent + '=' + r.querySelector('span.details').textContent.trim());
    check('... the aircraft\'s facts, as the old header had them (the airline linked, its codes; the Mode S its own id)', info.slice(0, 6).join('|') === 'AIRCRAFT=Boeing 737-8AS|AIRLINE=Ryanair|OPERATOR=Ryanair|TYPE CODE=B738|Code=FR / RYR|Code=FR / RYR' && d.getElementById('txt-mode-s').textContent === '4CA24D' && /\/data\/airlines\/fr-ryr$/.test(d.querySelector('#cnt-aircraft-info a').href), info);
    const locks = [...d.querySelectorAll('#cnt-aircraft-info a.premium-content svg.icon-fr24-lock use')];
    check('... the serial number and age FR24 withholds: padlocks, as the free pages had them (this script\'s own work then fills them)', locks.length === 2 && locks.every(u => u.getAttribute('xlink:href') === '#icon-fr24-lock') && !!d.querySelector('#tl-cl-sprite symbol#icon-fr24-lock'));
    const pics = [...d.querySelectorAll('.section-header .cnt-picture')];
    check('... its two pictures, their credits', pics.length === 2 && pics[0].querySelector('span.label').textContent === '© De Guidi Oscar | Jetphotos' && /665431/.test(pics[0].querySelector('img').src) && pics[0].querySelector('a').href === 'https://www.jetphotos.com/photo/12233061');
    const rows = [...d.querySelectorAll('#tbl-datatable tbody tr.data-row:not(.tl-adsb-row)')], cells = tr => [...tr.children].map(c => c.textContent.replace(/\s+/g, ' ').trim());
    check('... a row each of FR24\'s flights, in the old table (14 cells, the head as it was)', rows.length === 4 && rows.every(r => r.children.length === 14) && [...d.querySelectorAll('#tbl-datatable thead th')].map(t => t.textContent.trim()).slice(2, 12).join(',') === 'DATE,FROM,TO,FLIGHT,FLIGHT TIME,STD,ATD,STA,,STATUS', rows.length);
    const r3 = rows[2], c3 = cells(r3);
    check('a landed flight: its date, its airports (city, blue code linked), its flight number blue and linked, flight time, STD / ATD / STA, "Landed 16:25"', c3[2] === '19 Nov 2026' && c3[3] === 'Cork (ORK)' && c3[4] === 'Edinburgh (EDI)' && c3[5] === 'FR3731' && c3[6] === '1:02' && c3[7] === '15:15' && c3[8] === '15:22' && c3[9] === '16:35' && c3[11] === 'Landed 16:25' && r3.children[3].querySelector('a.fs-10.fbold').getAttribute('href') === 'https://www.flightradar24.com/data/airports/ork' && r3.children[5].querySelector('a.fbold').getAttribute('href') === 'https://www.flightradar24.com/data/flights/fr3731', c3);
    check('... its status cell as the old ones: prefix, time, offset; a green state block', r3.children[11].dataset.prefix === 'Landed ' && r3.children[11].dataset.timestamp === String(T + 4223) && r3.children[11].dataset.offset === '0' && !!r3.children[10].querySelector('.state-block.green'));
    const play = r3.querySelector('a.btn-playback'), exp = [...r3.querySelectorAll('a.tl-export')];
    check('... KML and CSV (by its FR24 id) and Play, in the old markup', exp.map(a => a.dataset.tlExport).join() === 'KML,CSV' && exp.every(a => a.dataset.flight === '42a444ba') && !!play && play.id === 'btn-playback-42a444ba' && play.dataset.flightHex === '42a444ba' && play.dataset.live === 'false' && /Play/.test(play.textContent) && !!play.querySelector('i.fa-play'));
    const c4 = cells(rows[3]);
    check('an airport an hour ahead (Malaga): its own local times - STA and the landing an hour on, its offset 3600', c4[9] === new Date((T - 86400 + 9000 + 3600) * 1000).toISOString().slice(11, 16) && c4[11] === 'Landed ' + new Date((T - 86400 + 8700 + 3600) * 1000).toISOString().slice(11, 16) && rows[3].children[9].dataset.offset === '3600', c4);
    const r2 = rows[1], c2 = cells(r2);
    check('a flight in the air: the row "live", "Estimated" its landing, green, its button Live', r2.classList.contains('live') && c2[11] === 'Estimated ' + new Date((T + 3 * 3600 - 120) * 1000).toISOString().slice(11, 16) && !!r2.querySelector('.state-block.green') && /Live/.test(r2.querySelector('a.btn-playback').textContent) && r2.querySelector('a.btn-playback').dataset.live === 'true', c2);
    const r1 = rows[0], c1 = cells(r1);
    check('a flight not flown yet, put back: "Estimated departure", yellow; Share, no Play', /^Estimated departure +\d\d:\d\d$/.test(c1[11]) && !!r1.querySelector('.state-block.yellow') && !!r1.querySelector('a.btn-share-schedule[data-schedule-id="5889300111"]') && !r1.querySelector('a.btn-playback'), c1);
    check('the footer under the table', /Flightradar24 AB/.test((d.querySelector('#cnt-data-content footer') || {}).textContent || ''));
    check('the playback panel there, hidden; no map yet', d.getElementById('cnt-playback').classList.contains('hidden') && d.getElementById('cnt-data-map').style.display === 'none');
    // ---- a row's Play: the old panel over the map
    play.click();
    await until(() => /RYR70PX/.test(d.getElementById('txt-playback-header').textContent), 15000);
    const tx = id => d.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
    check('Play: the panel shown, the title bar hidden, the map 600 px high and the page\'s content over its foot (as the old page script laid it)', !d.getElementById('cnt-playback').classList.contains('hidden') && d.querySelector('.section-header').classList.contains('hidden') && d.getElementById('cnt-data-map').style.height === '600px' && d.getElementById('cnt-data-content').style.marginTop === '548px' && d.getElementById('cnt-data-content').classList.contains('map-init'));
    check('... the row and its button marked playing, the address naming the flight', r3.classList.contains('active') && play.classList.contains('active') && w.location.hash === '#42a444ba');
    check('... "Playback of flight FR3731 / RYR70PX"; Cork (ORK) to Edinburgh (EDI); the aircraft', tx('txt-playback-header') === 'Playback of flight FR3731 / RYR70PX' && tx('txt-airport-origin') === 'Cork (ORK)' && tx('txt-airport-dest') === 'Edinburgh (EDI)' && tx('txt-aircraft-model') === 'Boeing 737-8AS' && tx('txt-aircraft-reg') === 'EI-DCY', [tx('txt-playback-header'), tx('txt-airport-origin'), tx('txt-airport-dest')]);
    const km = Math.round(w.__tweeksLadd.engine.dist(ORK.lat, ORK.lon, EDI.lat, EDI.lon));
    check('... the great circle distance, FR24\'s median flight time and arrival delay, the actual flight time', tx('txt-great-circle-distance') === km.toLocaleString('en-GB') + ' KM' && tx('txt-flight-time-average') === '0:57' && tx('txt-flight-delay-average') === '0:04' && tx('txt-flight-time-actual') === '1:02', [tx('txt-great-circle-distance'), km, tx('txt-flight-time-average'), tx('txt-flight-delay-average')]);
    check('... its first moment: 15:22 UTC, on the ground, its track 45°; its picture', tx('txt-track-timestamp') === '15:22 UTC' && tx('txt-altitude') === '0 FT' && tx('txt-track-heading') === '45°' && /665431/.test(d.getElementById('img-aircraft-img').src), [tx('txt-track-timestamp'), tx('txt-altitude')]);
    const tiles = [...d.querySelectorAll('#cnt-data-map .tl-cl-tiles img')].map(i => i.src);
    check('... the map: the satellite picture, its roads and places ("Hybrid", as the old pages\' map), the flight drawn on it with both airports\' pins', tiles.some(s => /World_Imagery/.test(s)) && tiles.some(s => /World_Transportation/.test(s)) && tiles.some(s => /World_Boundaries_and_Places/.test(s)) && d.querySelectorAll('#cnt-data-map .tl-cl-over line').length > 20 && d.querySelectorAll('#cnt-data-map .tl-cl-over image[href*="airport_pin_40_blue"]').length === 2, tiles.length);
    check('... GPS altitude, airspeeds, vertical speed, squawk no longer padlocked (from public ADS-B as each moment plays)', d.querySelectorAll('#cnt-playback a.premium-content').length === 0 && d.querySelectorAll('#cnt-playback span.tl-pb').length === 5);
    d.getElementById('btn-control-playback').click();
    const t0 = Number(d.getElementById('txt-track-timestamp').dataset.timestamp);
    await sleep(700);
    const t1 = Number(d.getElementById('txt-track-timestamp').dataset.timestamp);
    check('Play pressed: the flight moves on (the slider\'s thumb and progress with it), the button showing pause', t1 > t0 && d.getElementById('btn-control-playback').classList.contains('active') && parseInt(d.querySelector('#cnt-fight-progress-slider .thumb').style.left, 10) >= 0, [t0, t1]);
    d.getElementById('btn-control-playback').click();
    d.getElementById('btn-playback-control-close').click();
    check('closed: the panel hidden, the title bar back, the map away, the address as it was', d.getElementById('cnt-playback').classList.contains('hidden') && !d.querySelector('.section-header').classList.contains('hidden') && d.getElementById('cnt-data-map').style.display === 'none' && !w.location.hash && !r3.classList.contains('active'));
    const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError|classic page/.test(l));
    check('no script errors', !errs.length, errs.slice(0, 5));
    w.close();
  }
  // ======== a flight number's page =======================================================================================
  {
    const page = { component: 'Data/FlightHistory', props: { flightNumber: 'FR3731', callsign: null, airline: { id: 6, name: 'Ryanair', iata: 'FR', icao: 'RYR', url: 'fr-ryr' }, flights: FLIGHTS.slice(2, 3), about: [{ averageFlightTimeMinutes: 58, averageArrivalDelayMinutes: 4 }], meta: { hiddenByPlan: true, historyDays: 7 } } };
    const w = makeWin('https://www.flightradar24.com/data/flights/fr3731', page), d = w.document;
    await until(() => d.querySelector('#content[data-tl-classic] #tbl-datatable tbody tr'), 20000);
    const root = d.querySelector('#content[data-tl-classic]'), tr = d.querySelector('#tbl-datatable tbody tr.data-row');
    check('a flight number\'s page: #content.data-flights, the flights page\'s stylesheet, its heading naming its airline (as the old ones)', !!root && root.classList.contains('data-flights') && [...d.querySelectorAll('link[data-tl-classic]')].some(l => /flights\.flight\.css$/.test(l.href)) && (d.querySelector('#cnt-subpage-info.h-60 h1') || {}).textContent === 'Flight history for Ryanair flight FR3731');
    check('... its rows\' aircraft column: the type, the registration blue and linked; head AIRCRAFT', !!tr && tr.children[5].textContent.replace(/\s+/g, ' ').trim() === 'B738 (EI-DCY)' && /\/data\/aircraft\/ei-dcy$/.test(tr.children[5].querySelector('a').href) && [...d.querySelectorAll('#tbl-datatable thead th')][5].textContent === 'AIRCRAFT');
    check('... the breadcrumbs end Flights > FR3731', [...d.querySelectorAll('nav.breadcrumbs li')].map(l => l.textContent.trim()).slice(-2).join(' > ') === 'Flights > FR3731');
    w.close();
  }
  {
    const page = { component: 'Data/FlightHistory', props: { flightNumber: 'VSB96', callsign: null, airline: { id: 582, name: 'BAE Systems Marine', iata: null, icao: 'VSB', url: 'vsb' }, flights: [], about: [], meta: { hiddenByPlan: false, historyDays: 7 } } };
    const w = makeWin('https://www.flightradar24.com/data/flights/vsb96', page), d = w.document;
    await until(() => d.querySelector('#content[data-tl-classic]'), 20000);
    const note = [...d.querySelectorAll('#cnt-data-content div.row')].find(x => /There is currently no data available for your request/.test(x.textContent));
    check('a flight number FR24 has no flight of: the old page\'s words, its footer in them (the flight page\'s own table then built there)', !!note && !!note.querySelector('footer') && (d.querySelector('#cnt-subpage-info h1') || {}).textContent === 'Flight history for BAE Systems Marine flight VSB96');
    w.close();
  }
  // ======== switched off; a page with no page data ======================================================================
  {
    const w = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', AC_PAGE, null, { opts: { classic: false } }), d = w.document;
    await until(() => w.__tweeksLadd && w.__tweeksLadd.engine.airports.length > 5000, 30000); await sleep(1500);
    check('"Old-style log pages" off: FR24\'s new page left as it is - nothing drawn, nothing hidden', !d.querySelector('#content[data-tl-classic]') && !d.getElementById('tl-classic-hide') && !d.querySelector('link[data-tl-classic]'));
    w.close();
  }
  {
    const w = makeWin('https://www.flightradar24.com/data/aircraft/ei-dcy', null), d = w.document;
    await until(() => w.__tweeksLadd && w.__tweeksLadd.engine.airports.length > 5000, 30000); await sleep(1500);
    check('a page without FR24\'s page data (FR24\'s own old page): left to the old pages\' own work, at once - nothing hidden, nothing drawn', !d.querySelector('#content[data-tl-classic]') && !d.getElementById('tl-classic-hide'));
    w.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed', e && e.stack); process.exit(1); });
