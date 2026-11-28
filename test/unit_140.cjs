// 1.4.0, the page-world part (the BUILT userscript's, in jsdom):
//   - FR24's icon for each type and aircraft, learnt from its own feed (by type: the one most of a type are drawn with);
//     FR24's player of a flight of this script's told the aircraft and its icon (PlaybackFlightResponse 1 AircraftInfo) -
//     it drew every one as a Boeing 737 - a stand-in for every flight with an aircraft known, figures or none
//   - its tag (LADD) beside the callsign in FR24's player's header, for a flight of this script's only
//   - the runways on FR24's own player's flight times card: never the padlock, filled from the monitor's log
//   - FR24's padlocks over the figures of each moment lifted on FR24's own player page too (EIN6KR)
//   - an airport board's card of a blocked flight (a row of this script's): its runway by the aircraft's address
//   - FR24's flights page given a flight to play: covered while it is made ready, uncovered when FR24's player is in, or
//     when nothing came of it
//   - in the app on a phone: a log page with a flight in its address goes to FR24's own player (which flights do)
// usage: node test/unit_140.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2];
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
// (protobuf, as FR24's answers are read: field number -> value(s))
function pb(b) {
  const out = []; let p = 0;
  const rv = () => { let r = 0, mul = 1, x; do { x = b[p++]; r += (x & 0x7f) * mul; mul *= 128; } while (x & 0x80); return r; };
  while (p < b.length) { const tag = rv(), fn = Math.floor(tag / 8), wt = tag & 7; if (wt === 0) out.push({ fn, v: rv() }); else if (wt === 2) { const n = rv(); out.push({ fn, b: b.subarray(p, p + n) }); p += n; } else if (wt === 5) { out.push({ fn, b: b.subarray(p, p + 4) }); p += 4; } else break; }
  return out;
}
const str = f => f && f.b ? Buffer.from(f.b).toString() : '';

(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/data/playback/3d4fa2c1', runScripts: 'dangerously' });
  const w = dom.window, doc = w.document;
  let H = null; w.__tlTestHook = h => { H = h; };
  const posted = []; w.postMessage = d => posted.push(d);
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.indexedDB = undefined; w.Response = Response; w.Headers = Headers;
  // (FR24's own on-ground list of Liverpool: its last hour - G-DRTC; everything else offline)
  const nowS0 = Math.floor(Date.now() / 1000);
  const FR24_OG = { data: [{ id: 123456, flight: { id: '3d4fa2c1', number: 'LS3256', callsign: 'EXS53CE' }, landedTime: nowS0 - 120, airlineId: 5, runway: null, aircraft: { category: 1, name: 'Boeing 737-808', registeredOwners: 'Jet2', registration: 'G-DRTC', type: 'B738' }, originId: 1, activeDay: '2026-11-18' }], meta: { currentPage: 1 } };
  w.fetch = (input) => { const u = typeof input === 'string' ? input : input.url; return /\/api\/v2\/airports\/2002\/on-grounds/.test(u) ? Promise.resolve(new Response(JSON.stringify(FR24_OG), { status: 200, headers: { 'content-type': 'application/json' } })) : Promise.reject(new Error('offline')); };
  // (jsdom lays nothing out: the boxes of what has words in it, as a browser draws them)
  w.HTMLElement.prototype.getBoundingClientRect = function () { const t = (this.textContent || '').trim(); return t ? { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 } : { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; };
  const SHARED = { errors: {}, name: 'Flightradar24', host: 'www.flightradar24.com', locale: 'en' };
  const gp = { $pinia: { _s: new Map() }, $page: { component: 'MapPage', url: '/', props: Object.assign({}, SHARED) }, $inertia: { push: () => {}, replace: () => {} } };
  doc.getElementById('app').__vue_app__ = { config: { globalProperties: gp } };
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) { console.log('FAIL  pageInterceptor not found in the build'); process.exit(1); }
  w.eval('(' + m[0] + ')()');
  check('page-world test hook', !!(H && H.iconNote && H.mxPbFlightMsg && H.mxPbTag && H.mxPbRunways));
  const B = w.__tweeksLaddBridge, nowS = Math.floor(Date.now() / 1000), T = nowS - 3600;

  // ---- FR24's icons, learnt from its feed
  for (let i = 0; i < 3; i++) H.iconNote('C68A', 0, 9, 0);
  H.iconNote('C68A', 0, 41, 0);                       // (one in an airline's livery)
  H.iconNote('B738', 0x4ca7b1, 12, 0);
  check('the icon of a type: the one most of its flights are drawn with - not one airline\'s livery', H.iconFor('', 'C68A') === 9, H.iconFor('', 'C68A'));
  check('... an aircraft\'s own, by its address', H.iconFor('4ca7b1', '') === 12 && H.iconFor('4CA7B1', 'C68A') === 12);
  check('... none known: none (FR24\'s own default)', H.iconFor('', 'ZZZZ') === 0);
  // (a blocked flight - no address in FR24's feed: its record's, once named here)
  B.resolved.set(777, { cs: 'MPORT', reg: 'M-PORT', hex: '43edb1', type: 'C68A' });
  H.iconNote('C68A', 0, 9, 777);
  check('... a blocked one named here: by its record\'s address', H.iconFor('43edb1', '') === 9);

  // ---- FR24's player of a flight of this script's: its aircraft and icon, figures or none
  const SID = 'ff43edb1' + (T).toString(16).padStart(8, '0');
  const sid = H.mxPbStandIn({ id: SID, hex: '43edb1', reg: 'M-PORT', type: 'C68A', model: 'Cessna 680A Citation Latitude', pts: [{ t: T, lat: 50, lon: -2, alt: 1000 }] });
  check('a flight of this script\'s with no figures from its aircraft: a stand-in all the same (its icon)', sid >= 0xF0000000, sid);
  const msg = pb(H.mxPbFlightMsg(sid, T + 60)), ai = msg.find(f => f.fn === 1), aif = ai ? pb(ai.b) : [];
  const g = n => aif.find(f => f.fn === n);
  check('FR24\'s player asking of the moment: the aircraft (1 AircraftInfo) - address, registration, type, icon, full name', !!ai && g(1).v === 0x43edb1 && str(g(2)) === 'M-PORT' && str(g(4)) === 'C68A' && g(5).v === 9 && str(g(6)) === 'Cessna 680A Citation Latitude', aif.map(f => [f.fn, f.v != null ? f.v : str(f)]));
  const sid2 = H.mxPbStandIn({ id: SID + 'x', hex: '43edb1', type: 'C68A', pts: [{ t: T, lat: 50, lon: -2, alt: 1000, ag: 1200, ias: 140, tas: 150, sq: '7000' }] });
  const msg2 = pb(H.mxPbFlightMsg(sid2, T)), efi = msg2.find(f => f.fn === 3);
  check('... with figures: the aircraft and the moment\'s figures (3 ExtendedFlightInfo) both', !!msg2.find(f => f.fn === 1) && !!efi && pb(efi.b).some(f => f.fn === 13), msg2.map(f => f.fn));

  // ---- its tag in the player's header
  doc.getElementById('app').insertAdjacentHTML('beforeend', '<div class="hdr"><div class="row"><span class="cs" style="font-size:40px">MPORT</span></div><p>About MPORT</p></div>');
  H.mxPbBadges.set(SID, 'LADD');
  const props = { trailSource: 'tl', callsign: 'MPORT', flightNumber: null, download: { flightId: SID } };
  H.mxPbTag(props);
  const tag = doc.querySelector('.tl-pb-tag');
  check('a blocked flight\'s player: "LADD" beside its callsign in the header', !!tag && tag.textContent === 'LADD' && tag.previousElementSibling && tag.previousElementSibling.classList.contains('cs'), tag && tag.outerHTML);
  H.mxPbTag(props); check('... once', doc.querySelectorAll('.tl-pb-tag').length === 1);
  H.mxPbTag(Object.assign({}, props, { trailSource: 'radar' }));
  check('... FR24\'s own flight\'s player: none', !doc.querySelector('.tl-pb-tag'));

  // ---- the runways on FR24's own player
  const ft = { origin: { name: 'Paphos', runway: null, runwayLocked: true }, destination: { name: 'Liverpool', runway: null, runwayLocked: true }, actualDeparture: T, actualArrival: 0 };
  posted.length = 0;
  H.mxPbRunways({ props: { flightTimes: ft, origin: { code: 'PFO' }, destination: { code: 'LPL' } } });
  check('FR24\'s own flight (LS3256): no padlock over either runway', ft.origin.runwayLocked === false && ft.destination.runwayLocked === false);
  const want = posted.find(p => p && p.__tweeksLadd === 'rwyWant');
  check('... its take-off\'s asked for by the flight\'s id and the airport\'s code; its landing, not yet made, not', !!want && want.iata === 'PFO' && want.items.length === 1 && want.items[0].fid === '3d4fa2c1' && want.items[0].landing === false, want);
  H.mxRwy.set('3d4fa2c1:0', '29');
  H.mxPbRunways({ props: { flightTimes: ft, origin: { code: 'PFO' }, destination: { code: 'LPL' } } });
  check('... the monitor\'s answer in: the runway on the card', ft.origin.runway === '29' && ft.destination.runway === null, ft.origin);

  // ---- FR24's padlocks over the figures, on FR24's own player page
  const table = { 'map.layer.weather.wind': ['business'], 'map.layer.atc': ['gold', 'business'], 'map.info.flight.ems.alt.gps': ['silver', 'gold', 'business'], 'map.info.flight.ems.tas': ['gold'], 'map.info.flight.ems.ias': ['gold'], 'map.info.flight.vertical-speed': ['silver'] };
  H.mxPatchCore({ ch: table });
  gp.$page = { component: 'Data/NewFlightPlayback', url: '/data/playback/3d4fa2c1', props: Object.assign({}, SHARED, { trailSource: 'radar', callsign: 'EIN6KR', flightNumber: 'EI637', flightTimes: { origin: { runwayLocked: false }, destination: { runwayLocked: false } }, download: { flightId: '3d4fa2c1' } }) };
  H.mxDataTick();
  check('FR24\'s own flight\'s player page (EIN6KR): GPS altitude, airspeeds and vertical speed allowed - the figures from its ADS-B track', ['map.info.flight.ems.alt.gps', 'map.info.flight.ems.tas', 'map.info.flight.ems.ias', 'map.info.flight.vertical-speed'].every(k => table[k].includes('basic') && table[k].includes('Basic')), table);
  gp.$page = { component: 'MapPage', url: '/', props: Object.assign({}, SHARED) };
  H.mxDataTick();
  check('... another page: back as FR24 has them', !table['map.info.flight.ems.alt.gps'].includes('basic') && table['map.info.flight.ems.alt.gps'].length === 3);

  // ---- a board's card of a blocked flight: its runway by the aircraft's address
  const pid = 0x41cd0a3d, row = 9000000000 + pid;
  B.resolved.set(pid, { cs: 'MPORT', reg: 'M-PORT', hex: '43edb1', hexNum: 0x43edb1 });
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'rwyApGot', ap: 2002, f: {}, h: [['43edb1', 1, '27', T + 3000], ['43edb1', 1, '09', T - 86400]] }, source: w }));
  await sleep(10);
  H.noteCard(row, 2002, 'arrivals', { flight: { id: pid.toString(16) }, schedule: { ata: T + 3010 }, destinationId: 2002, aircraft: { registration: 'M-PORT' } });
  doc.body.insertAdjacentHTML('beforeend', `<div id="airport_schedule_${row}"><dl><dt>Arrival runway</dt><dd>N/A</dd></dl></div>`);
  H.cardRwyFill();
  check('an arrivals board\'s card of a blocked flight (a row of this script\'s): its landing runway by its address, as the monitor logged it from its ADS-B track', doc.querySelector(`#airport_schedule_${row} dd`).textContent === '27', doc.querySelector(`#airport_schedule_${row} dd`).textContent);
  check('... with no time known: its latest there within six hours', H.mxRwyByHex(2002, '43edb1', 1, 0) === '27' && H.mxRwyByHex(2002, '43edb1', 0, 0) === '');

  // ---- FR24's flights page given a flight to play: covered while it is made ready
  w.history.pushState({}, '', '/data/flights?tl-pb=' + SID);
  posted.length = 0;
  H.mxPbAway(SID);
  check('FR24\'s flights page given a flight to play: covered - not its search form - while the flight is made ready', !!doc.getElementById('tl-pb-veil') && /Loading playback/.test(doc.getElementById('tl-pb-veil').textContent));
  const q = posted.filter(p => p && p.__tweeksLadd === 'pbPage').pop();
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'pbPageGot', rid: q && q.rid, ok: false }, source: w }));
  await sleep(20);
  // (1.4.3: said so, with the way back - FR24's search form left in its place looked as if the playback had sent the user
  // there; "Search for flights" uncovers it)
  const vf = doc.getElementById('tl-pb-veil'), vb = vf ? [...vf.querySelectorAll('button')] : [];
  check('... nothing came of it: said so over FR24\'s page, with the way back - and FR24\'s search form a tap away', !!vf && /No track of this flight could be found/.test(vf.textContent) && vb.map(b => b.textContent).join() === 'Back,Search for flights', vf && vf.textContent);
  if (vb[1]) vb[1].click();
  check('... "Search for flights": FR24\'s page shown', !doc.getElementById('tl-pb-veil'));
  H.mxPbVeilOn(); gp.$page = { component: 'Data/NewFlightPlayback', url: '/data/playback/' + SID, props: Object.assign({}, SHARED, { trailSource: 'tl', callsign: 'MPORT', download: { flightId: SID } }) };
  H.mxDataTick();
  check('... FR24\'s player in: uncovered', !doc.getElementById('tl-pb-veil'));

  // ---- (the on-ground list) FR24's own of Liverpool and the monitor's: every aircraft there, FR24's list's own first
  posted.length = 0;
  const ogP = w.fetch('https://www.flightradar24.com/api/v2/airports/2002/on-grounds?page=1');
  await sleep(30);
  const ow = posted.find(p => p && p.__tweeksLadd === 'ogWant');
  check('an airport\'s on-ground list asked of FR24: the monitor\'s of it asked for alongside', !!ow && ow.ap === 2002, ow);
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'ogGot', rid: ow && ow.rid, ap: 2002, list: [
    { fid: '3d4fa2c1', reg: 'G-DRTC', ty: 'B738', t: nowS0 - 120 },
    { fid: '3d4f0001', hex: '400abc', reg: 'G-CEGP', ty: 'BE20', name: 'Beech B200 Super King Air', cs: 'MDI28F', alId: 0, t: nowS0 - 2340 },
    { fid: '', hex: '43edb1', reg: 'M-PORT', ty: 'C68A', name: 'Cessna 680A Citation Latitude', cs: 'MPORT', t: nowS0 - 3 * 86400, badge: 'LADD' }] }, source: w }));
  const og = await (await ogP).json();
  const regs = og.data.map(e => e.aircraft.registration);
  check('... the monitor\'s aircraft FR24\'s hour has not got added - G-CEGP, and M-PORT landed three days ago; G-DRTC (FR24\'s own) once', JSON.stringify(regs) === JSON.stringify(['G-DRTC', 'G-CEGP', 'M-PORT']), regs);
  const cegp = og.data[1], mport = og.data[2];
  check('... in FR24\'s own row form: its flight, landing time, aircraft (name, type, registration), its day', cegp.id === 40000000000 + 0x3d4f0001 && cegp.flight.callsign === 'MDI28F' && cegp.landedTime === nowS0 - 2340 && cegp.aircraft.name === 'Beech B200 Super King Air' && cegp.aircraft.type === 'BE20' && /^\d{4}-\d\d-\d\d$/.test(cegp.activeDay), cegp);
  check('... one with no flight id of FR24\'s: by its address, its callsign its registration\'s if none', mport.id === 40000000000 + 0x43edb1 && mport.flight.callsign === 'MPORT' && mport.flight.id === null, mport);
  const im = await (await w.fetch('https://www.flightradar24.com/api/v2/airports/2002/on-grounds/' + cegp.id + '/aircraft-images')).json();
  check('... its card\'s pictures: answered here (FR24 has no such row), none', Array.isArray(im.data.images) && im.data.images.length === 0, im);

  // ---- the app's routing: which addresses are a flight's playback
  check('an aircraft\'s or flight number\'s log page with a flight in its address: that flight - FR24\'s id, or one of this script\'s', H.mxPbLogId('/data/aircraft/g-drtc', '#3d4fa2c1') === '3d4fa2c1' && H.mxPbLogId('/data/flights/ls3256', '#' + SID) === SID && H.mxPbLogId('/data/aircraft/G-DRTC/', '#3D4FA2C1') === '3d4fa2c1');
  check('... none: a log page with nothing in its address, another page, words in it', H.mxPbLogId('/data/aircraft/g-drtc', '') === '' && H.mxPbLogId('/data/airports/lpl', '#3d4fa2c1') === '' && H.mxPbLogId('/data/aircraft/g-drtc', '#about') === '' && H.mxPbLogId('/data/aircraft/b738/g-drtc', '#3d4fa2c1') === '');

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
