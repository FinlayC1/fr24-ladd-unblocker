// "Playback" of a flight FR24 blocks opens FR24's OWN player (1.2.4: its playback page, Data/NewFlightPlayback, handed to
// FR24's own router with the flight's track - no longer airplanes.live), and every other Playback is FR24's (the BUILT
// userscript in jsdom: the page-world part on its own, then the userscript's half).
//   - FR24's bottom bar Playback (its playback window), with a blocked flight open in the panel: never taken
//   - the panel's own Playback (FR24's flight-actions button, and the aircraft__playback one) of a blocked flight: FR24's
//     player with its track; of an ordinary flight: FR24's
//   - airport board cards (Aircraft info / Bookmark aircraft / Playback): a flight followed here, kept rows of this
//     script's own (N600EB's departure from LaGuardia two days before) and FR24's own of a blocked aircraft, an arrival
//     (its other end's take-off), FR24's today's row of a blocked flight, of an aircraft named blocked in a search;
//     FR24's own rows of ordinary flights untouched
//   - search results: a live blocked flight, its aircraft, a blocked aircraft not flying now (the userscript finds its
//     flight), an ordinary aircraft untouched; no flight known anywhere: FR24's own after all
//   - a rebuilt log row: its leg; a middle / Ctrl click: the page in a new tab
//   - the page's address: FR24's id of the flight, or "ff" + address + take-off; opened by its address (a new tab, a
//     reload): FR24's own page of a flight it locks or has no page for given the track, its own words kept
//   - the userscript's answer (pbWhere): the aircraft's leg nearest the row's time, its latest, by registration or
//     callsign, and where the leg ended
// usage: node test/unit_pbbuttons.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
// (the id of a flight known only here: "ff" + address + take-off, hex)
const syn = (hex, t) => 'ff' + hex + ('00000000' + Math.round(t).toString(16)).slice(-8);

(async () => {
  // ---- 1. the page-world part
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/40.70,-73.90/9', runScripts: 'dangerously' });
  const w = dom.window, doc = w.document;
  let H = null; w.__tlTestHook = h => { H = h; };
  const posted = []; w.postMessage = d => posted.push(d);
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.fetch = () => Promise.reject(new Error('offline')); w.indexedDB = undefined;
  // (FR24's own state stores, as its Vue app holds them: its airports, its playback; its Inertia router and page)
  const AP = new Map([[3901, { id: 3901, iata: 'LGA', lat: 40.7772, lon: -73.8726 }], [3500, { id: 3500, iata: 'FLL', lat: 26.0726, lon: -80.1527 }]]);
  const stores = new Map([['airports', { airports: [], airportsById: AP }], ['playback', { active: false, timestamp: 0, selectedFlightId: null }], ['aircraft', { selected: null }]]);
  const visits = [], SHARED = { errors: {}, name: 'Flightradar24', route: { name: 'web.map', params: {}, query: [] }, host: 'www.flightradar24.com', locale: 'en', dispatcher: { features: { x: 1 } }, features: { y: 1 } };
  const gp = { $pinia: { _s: stores }, $page: { component: 'MapPage', url: '/40.70,-73.90/9', props: Object.assign({}, SHARED) }, $inertia: { push: v => visits.push(['push', v]), replace: v => visits.push(['replace', v]) } };
  doc.getElementById('app').__vue_app__ = { config: { globalProperties: gp } };
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) { console.log('FAIL  pageInterceptor not found in the build'); process.exit(1); }
  w.eval('(' + m[0] + ')()');
  check('page-world test hook', !!(H && H.pbFind && H.mxPbOpen && H.mxPbProps));
  const B = w.__tweeksLaddBridge;
  const opened = []; w.open = u => { opened.push(u); return null; };
  const nowS = Math.floor(Date.now() / 1000);
  // what FR24 does with a Playback it is left: its own handler (here: counted)
  const fr24 = []; doc.addEventListener('click', ev => { const a = ev.target.closest && ev.target.closest('[data-fr24]'); if (a) fr24.push(a.getAttribute('data-fr24')); });
  const clk = (el, o) => { const ev = new w.MouseEvent((o && o.type) || 'click', Object.assign({ bubbles: true, cancelable: true }, o || {})); el.dispatchEvent(ev); return ev.defaultPrevented; };
  const reset = () => { opened.length = 0; fr24.length = 0; posted.length = 0; visits.length = 0; };
  // (the userscript's answer to the page's ask: the flight - or none)
  const ask = () => posted.filter(p => p && p.__tweeksLadd === 'pbPage').pop() || null;
  const reply = async (q, d) => { w.dispatchEvent(new w.MessageEvent('message', { data: Object.assign({ __tweeksLadd: 'pbPageGot', rid: q && q.rid }, d), source: w })); await sleep(15); };
  const T = nowS - 1800;
  const flight = (id, o) => Object.assign({ ok: true, id, hex: '424c60', reg: 'M-ARNZ', cs: 'VSB82', model: 'Pilatus PC-24', type: 'PC24', operator: 'Some Operator', msn: '123',
    origin: { code: 'FLL', name: 'Fort Lauderdale International Airport', city: 'Fort Lauderdale', lat: 26.0726, lon: -80.1527, tz: 'America/New_York' }, destination: null, dep: T, arr: 0,
    pts: [{ t: T - 60, lat: 26.07, lon: -80.15, alt: 0, gnd: true, gs: 12, trk: 90 }, { t: T, lat: 26.08, lon: -80.14, alt: 0, gnd: true, gs: 140, trk: 92 }, { t: T + 60, lat: 26.1, lon: -80.1, alt: 2400, gs: 180, trk: 95, vr: 2500, sq: '4523' }, { t: T + 120, lat: 26.15, lon: -80.05, alt: 5200, gs: 220, trk: 96, vr: 2700, sq: '4523' }],
    photos: [{ url: 'https://cdn.jetphotos.com/full/1.jpg', link: 'https://www.jetphotos.com/photo/1', copyright: 'A Photographer' }] }, o || {});
  // (FR24's page asked for: its own player's page, the flight's track in its own shapes)
  const isPage = (v, id) => !!v && v[1].url === '/data/playback/' + id && v[1].component === 'Data/NewFlightPlayback' && v[1].props.trailSource === 'tl' && v[1].props.playbackLock === null && v[1].props.download.flightId === id;

  // the blocked flight followed in the panel: M-ARNZ as VSB82, off Fort Lauderdale half an hour ago
  const pid = 0x41cd0a3d, PID = pid.toString(16);
  B.resolved.set(pid, { cs: 'VSB82', reg: 'M-ARNZ', hex: '424c60', hexNum: 0x424c60, type: 'PC24', photos: [] });
  B.routes.set(pid, { originId: 3500, originIata: 'FLL', atd: T, destId: 3901 });
  B.lastPos.set(pid, { lat: 33.1, lon: -78.2, alt: 41000, at: Date.now() });
  H.setCurFollow(pid);
  const btn = (who, label) => `<button type="button" data-fr24="${who}"><svg></svg><span>${label || 'Playback'}</span></button>`;
  doc.body.insertAdjacentHTML('beforeend', `
    <div data-testid="aircraft-panel" id="panel"><div data-testid="aircraft-panel__header__callsign">VSB82</div>
      <div class="actions"><a data-testid="flight-actions__action-route" href="#r">Route</a><a data-testid="flight-actions__action-playback" data-fr24="panel-actions" href="/data/flights/vsb82">Playback</a></div>
      <div data-testid="aircraft__playback" data-fr24="panel-menu"><span>Playback</span></div>
      <ul class="recent"><li><span data-testid="aircraft-panel__recent-flights__callsign">VSB81</span><a data-testid="flight-actions__action-playback" data-fr24="log0" href="#">Playback</a></li>
        <li><span data-testid="aircraft-panel__recent-flights__callsign">VSB80</span><a data-testid="flight-actions__action-playback" data-fr24="log1" href="#">Playback</a></li></ul>
      <a data-testid="aircraft-panel__recent-flights__more-flights-button" href="https://www.flightradar24.com/data/aircraft/m-arnz">More M-ARNZ flights</a></div>
    <div class="bar-wrap"><nav class="bar">${['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'].map(l => btn('bar-' + l, l)).join('')}<button class="tl-ub-btn"><span>LADD Unblock</span></button></nav></div>`);

  // ---- the bar's Playback: FR24's playback window, whatever flight is open
  reset();
  const barTaken = clk(doc.querySelector('[data-fr24="bar-Playback"] span'));
  check('FR24\'s bottom bar Playback with a LADD flight open in the panel: not taken - FR24 opens its playback window', !barTaken && !opened.length && !ask() && fr24.join() === 'bar-Playback', { opened, fr24 });
  check('... the bar found as the bar', H.inBar(doc.querySelector('[data-fr24="bar-Playback"]')) && !H.inBar(doc.querySelector('[data-fr24="panel-actions"]')));
  reset();
  clk(doc.querySelector('[data-fr24="bar-Playback"]'), { type: 'auxclick', button: 1 });
  check('... nor a middle click on it', !opened.length && !ask());

  // ---- the panel's own Playback
  reset();
  const pTaken = clk(doc.querySelector('[data-fr24="panel-actions"]')), q1 = ask();
  check('the panel\'s Playback (FR24\'s flight-actions) of a blocked flight: taken, the flight asked for by its FR24 id - nothing opened elsewhere', pTaken && !!q1 && q1.id === PID && q1.hex === '424c60' && q1.dep === T && !opened.length && !fr24.length, q1);
  await reply(q1, flight(PID));
  const v1 = visits[0], pr = v1 && v1[1].props;
  check('... FR24\'s own playback page pushed to its own router: its address, its component, the track as FR24\'s page has its own', visits.length === 1 && v1[0] === 'push' && isPage(v1, PID), v1 && { url: v1[1].url, comp: v1[1].component });
  check('... the trail (altitude, speed, vertical speed), the route (position, track) and the tracklog in FR24\'s shapes', pr && pr.trail.length === 4 && pr.trail[2].barometricAltitude === 2400 && pr.trail[2].groundSpeed === 180 && pr.trail[2].verticalSpeed === 2500 && pr.trailRoute[3].lat === 26.15 && pr.trailRoute[3].long === -80.05 && pr.trailRoute[3].altitude === 5200 && pr.tracklog[2].squawk === 0x4523 && pr.tracklog.length === 4, pr && { trail: pr.trail[2], route: pr.trailRoute[3], log: pr.tracklog[2] });
  check('... its words: callsign, aircraft, airports, times, facts, photos; KML/CSV of its id from its take-off', pr && pr.callsign === 'VSB82' && pr.aircraft.name === 'Pilatus PC-24' && pr.aircraft.registration === 'M-ARNZ' && pr.origin.code === 'FLL' && pr.destination.code === 'N/A' && pr.flightTimes.actualDeparture === T && pr.flightTimes.origin.timezone === 'America/New_York' && pr.facts.some(f => f.key === 'registration' && f.value === 'M-ARNZ') && pr.photos[0].url === 'https://cdn.jetphotos.com/full/1.jpg' && pr.download.history === T && pr.metrics.length === 5 && pr.metrics.every(r => r.length === 2), pr && { o: pr.origin, ft: pr.flightTimes.actualDeparture, facts: pr.facts });
  check('... FR24\'s shared props kept (its account, features, host), the route named', pr && pr.dispatcher === SHARED.dispatcher && pr.features === SHARED.features && pr.host === SHARED.host && pr.route.name === 'web.data.playback' && pr.route.params.id === PID);
  reset(); clk(doc.querySelector('[data-fr24="panel-menu"] span')); const q2 = ask();
  check('... the aircraft__playback button the same', !!q2 && q2.id === PID, q2);
  // (a panel showing another aircraft, with the blocked flight followed earlier still the last one followed)
  doc.querySelector('#panel [data-testid="aircraft-panel__header__callsign"]').textContent = 'BAW123'; reset();
  const pOther = clk(doc.querySelector('[data-fr24="panel-actions"]'));
  check('the panel\'s Playback with the panel showing another aircraft (BAW123): FR24\'s own, not the blocked flight followed earlier', !pOther && !ask() && fr24.join() === 'panel-actions');
  doc.querySelector('#panel [data-testid="aircraft-panel__header__callsign"]').textContent = 'VSB82';
  H.setCurFollow(0x41000001); reset();
  const pOrd = clk(doc.querySelector('[data-fr24="panel-actions"]'));
  check('the panel\'s Playback of an ordinary flight: FR24\'s own', !pOrd && !ask() && fr24.join() === 'panel-actions');
  H.setCurFollow(pid);

  // ---- a rebuilt log's rows (row i is entry i + 1: FR24 leaves out the first, the flight on screen)
  const T4 = nowS - 3 * 86400;
  B.hist.set('M-ARNZ', { data: [{}, { aircraft: { hex: '424C60', registration: 'M-ARNZ' }, __tlPb: { t: T4, lat: 51.47, lon: -0.45, z: 10 }, time: { real: { departure: T4, arrival: T4 + 3600 } } }, { aircraft: { registration: 'M-ARNZ' } }], at: Date.now() });
  reset();
  clk(doc.querySelector('[data-fr24="log0"]')); const q3 = ask();
  check('a rebuilt log row\'s Playback: that leg - known here only, its id the aircraft and its take-off', !!q3 && q3.id === syn('424c60', T4) && q3.dep === T4 && !opened.length && !fr24.length, q3);
  reset(); const lOwn = clk(doc.querySelector('[data-fr24="log1"]'));
  check('... a row of FR24\'s own: FR24\'s', !lOwn && !ask() && fr24.join() === 'log1');

  // ---- airport boards (LaGuardia, 3901)
  const apId = 3901, t0 = nowS - 2 * 86400;
  H.acceptBoardArch({ apId, arr: [{ k: 'n600eb-14', t: t0 + 9000, t2: t0 + 5400, hex: 'a80b2e', reg: 'N600EB', cs: 'N600EB', src: 'log', blk: 1, ap: 3500 }], dep: [
    { k: 'n600eb-13', t: t0, t2: t0 + 3600, hex: 'a80b2e', reg: 'N600EB', cs: 'N600EB', src: 'log', blk: 1, ap: 3500 },
    { k: 'fr898-13', t: t0 + 600, hex: '4ca7b5', reg: 'EI-DAC', cs: 'RYR898', num: 'FR898', src: 'fr24', id: 5869000001, fid: '3c000001', ap: 3501 },
    { k: 'eja123-13', t: t0 + 1200, hex: 'a1b2c3', reg: 'N123QS', cs: 'EJA123', src: 'fr24', id: 5869000002, fid: '3c000002', blk: 1, ap: 3502 }] });
  const jd = { data: [] }; H.addArch(jd, apId, 'departures'); const ja = { data: [] }; H.addArch(ja, apId, 'arrivals');
  const ids = jd.data.map(e => e.id), aid = ja.data.map(e => e.id)[0];
  // (a card as FR24 draws one opened: the aircraft, bookmarking it, its playback)
  const card = (id, reg, pb) => `<li id="airport_schedule_${id}"><div data-testid="airport-panel__schedules__flight__${id}"><span>${reg}</span></div><div class="x">${reg ? `<span data-testid="airport-flight-details__registration">${reg}</span>` : ''}<a href="/data/aircraft/${reg.toLowerCase()}">Aircraft info</a><a href="#b">Bookmark aircraft</a><a href="/data/flights/x" data-fr24="row-${id}"><svg></svg>${pb || 'Playback'}</a></div></li>`;
  const todayRow = 5869989311, pbRow = 5869989312, plainRow = 5869989313, T2 = nowS - 5400;
  doc.body.insertAdjacentHTML('beforeend', `<div data-testid="airport-panel"><ul>${card(9000000000 + pid, 'M-ARNZ')}${card(ids[0], 'N600EB')}${card(ids[1], 'EI-DAC')}${card(ids[2], 'N123QS')}${card(aid, 'N600EB')}${card(todayRow, '', 'Playback - VSB82')}${card(pbRow, 'N777XX')}${card(plainRow, 'G-EZBX')}</ul></div>`);
  const row = id => doc.querySelector(`[data-fr24="row-${id}"]`);
  reset(); clk(row(9000000000 + pid)); let q = ask();
  check('a board row of a blocked flight followed here: the flight, by its FR24 id', !!q && q.id === PID && !fr24.length, q);
  reset(); const kTaken = clk(row(ids[0])); q = ask();
  check('a kept row of this script\'s own (N600EB off LaGuardia two days back): that flight - the aircraft and its take-off', ids[0] >= 20000000000 && kTaken && !!q && q.id === syn('a80b2e', t0) && q.hex === 'a80b2e' && q.dep === t0 && !fr24.length, q);
  // (its card opened first: the card answered here names the flight by the id made up for it - not FR24's)
  { const ar0 = H.archById.get(ids[0]); H.cardInfo.set(ids[0], { fid: ar0.fid, apId, kind: 'departures' }); H.boardRowsSeen.set(ids[0], { fid: ar0.fid, t: t0, apId, kind: 'departures' });
    reset(); clk(row(ids[0])); const qc = ask(); H.cardInfo.delete(ids[0]); H.boardRowsSeen.delete(ids[0]);
    check('... its card opened first (the id made up for the row in the card): still the aircraft and its take-off', !!qc && qc.id === syn('a80b2e', t0), qc); }
  reset(); const kOrd = clk(row(ids[1]));
  check('... FR24\'s own kept row of an ordinary flight: FR24\'s Playback, untouched', !kOrd && !ask() && fr24.join() === 'row-' + ids[1]);
  reset(); clk(row(ids[2])); q = ask();
  check('... FR24\'s own kept row of a blocked aircraft: by FR24\'s id of the flight', !!q && q.id === '3c000002' && q.hex === 'a1b2c3', q);
  reset(); clk(row(aid)); q = ask();
  check('a kept arrival: the flight from its take-off at the other end', !!q && q.id === syn('a80b2e', t0 + 5400) && q.dep === t0 + 5400, q);
  // (FR24's own row of today, of the flight followed here: its card's flight id; the action's words with the aircraft)
  H.cardInfo.set(todayRow, { fid: PID, apId, kind: 'arrivals' });
  reset(); clk(row(todayRow).querySelector('svg')); q = ask();
  check('FR24\'s own row of today of a blocked flight ("Playback - VSB82", clicked on its icon): that flight', !!q && q.id === PID, q);
  // (an aircraft the userscript named blocked in a search, not flying now: the row's own departure time)
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'searchAdd', rid: 'none', rows: [{ type: 'aircraft', id: 'N777XX', detail: { hex: 'A9F0E1' } }, { type: 'schedule', id: 'EJA777', detail: {} }, { type: 'aircraft', id: 'N600EB', detail: { hex: 'A80B2E' } }] }, source: w }));
  H.boardRowsSeen.set(pbRow, { fid: '3c0000ff', t: T2, st: 'departed', ap: 3500, apId, kind: 'departures' });
  reset(); clk(row(pbRow)); q = ask();
  check('FR24\'s own row of an aircraft named blocked: its flight by FR24\'s id, from its departure here', !!q && q.id === '3c0000ff' && q.hex === 'a9f0e1' && q.dep === T2, q);
  reset(); const plain = clk(row(plainRow));
  check('FR24\'s own row of an ordinary aircraft: FR24\'s', !plain && !ask() && fr24.join() === 'row-' + plainRow);
  // middle and Ctrl clicks: the page in a new tab, by its own address
  reset(); clk(row(ids[0]), { type: 'auxclick', button: 1 });
  check('a middle click: the flight in a new tab - known only here, so by FR24\'s flights page (FR24 has no page of it), which hands it to FR24\'s player', opened.length === 1 && opened[0] === '/data/flights?tl-pb=' + syn('a80b2e', t0) && !ask(), opened);
  reset(); clk(row(ids[0]), { ctrlKey: true });
  check('a Ctrl click: a new tab too', opened.length === 1 && opened[0] === '/data/flights?tl-pb=' + syn('a80b2e', t0));
  reset(); clk(row(ids[2]), { ctrlKey: true });
  check('... one of FR24\'s own flights: its FR24 id', opened[0] === '/data/playback/3c000002', opened);
  reset(); clk(row(ids[0]), { type: 'auxclick', button: 2 });
  check('a right click: nothing', !opened.length && !ask());

  // ---- search results
  doc.body.insertAdjacentHTML('beforeend', `<div data-testid="search__results">${[['live:' + PID, 'VSB82'], ['aircraft:m-arnz', 'M-ARNZ'], ['aircraft:n600eb', 'N600EB'], ['schedule:EJA777', 'EJA777'], ['aircraft:g-ezbx', 'G-EZBX']].map(([k, l], i) => `<div data-testid="search__result-row"><a data-search-result="${k}">${l}</a>${btn('sr' + i)}</div>`).join('')}</div>`);
  const sr = i => doc.querySelector(`[data-fr24="sr${i}"] span`);
  reset(); clk(sr(0)); const s0 = ask();
  reset(); clk(sr(1)); const s1 = ask();
  check('a search result of a live blocked flight, and of its aircraft: that flight', !!s0 && !!s1 && s0.id === PID && s1.id === PID, [s0 && s0.id, s1 && s1.id]);
  // (a Playback in the results box but in no row: not taken for the first row)
  doc.querySelector('[data-testid="search__results"]').insertAdjacentHTML('beforeend', btn('srbox'));
  reset(); const boxTaken = clk(doc.querySelector('[data-fr24="srbox"] span'));
  check('a Playback in the search results but outside any row: FR24\'s, not the first row\'s flight', !boxTaken && !ask() && fr24.join() === 'srbox');
  reset();
  const sTaken = clk(sr(2)), s2 = ask();
  check('a blocked aircraft not flying now (N600EB): taken, its flight asked of the userscript by the aircraft alone', sTaken && !!s2 && s2.id === '' && s2.reg === 'N600EB' && s2.hex === 'a80b2e' && !opened.length, s2);
  const T3 = nowS - 30 * 3600;
  await reply(s2, flight(syn('a80b2e', T3), { hex: 'a80b2e', reg: 'N600EB', cs: 'N600EB', dep: T3, arr: T3 + 9000 }));
  check('... its latest flight in FR24\'s player, under the id the userscript gave it', visits.length === 1 && isPage(visits[0], syn('a80b2e', T3)) && visits[0][1].props.flightTimes.actualArrival === T3 + 9000 && !fr24.length, visits[0] && visits[0][1].url);
  reset();
  clk(sr(3)); const s3 = ask();
  await reply(s3, { ok: false });
  check('a callsign of a blocked aircraft with no flight known anywhere: FR24\'s own Playback after all', !!s3 && s3.cs === 'EJA777' && !visits.length && !opened.length && fr24.join() === 'sr3', { fr24, visits: visits.length });
  reset(); const sOrd = clk(sr(4));
  check('a search result of an ordinary aircraft: FR24\'s', !sOrd && !ask() && fr24.join() === 'sr4');

  // ---- a playback page opened by its address (a new tab, a reload)
  // FR24's own page of a flight it locks (older than its week): its words kept, the track given, the lock gone
  const LOCKED = { component: 'Data/NewFlightPlayback', url: '/data/playback/3c000002', props: Object.assign({}, SHARED, { route: { name: 'data.playback', params: { id: '3c000002' }, query: [] }, flightNumber: 'EJ123', callsign: 'EJA123', airline: { name: 'NetJets', logoUrl: 'https://x/logo.png' },
    origin: { code: 'LGA', city: 'New York', lat: 40.77, long: -73.87 }, destination: { code: 'PBI', city: 'West Palm Beach', lat: 26.68, long: -80.09 }, aircraft: { name: 'Cessna Citation X', registration: 'N123QS' }, playbackLock: { rung: 'free' }, trail: [], tracklog: [], trailRoute: [], trailSource: 'mock',
    flightTimes: { origin: { name: 'LaGuardia', timezone: 'America/New_York' }, destination: { name: 'Palm Beach', timezone: 'America/New_York' }, scheduledDeparture: t0 + 1100, actualDeparture: t0 + 1200, scheduledArrival: t0 + 9000, actualArrival: t0 + 9100 },
    facts: [{ key: 'registration', value: 'N123QS' }], about: { departure: { time: t0 + 1200 } }, relatedFlights: [], photos: [], metrics: [], download: null, content: null, canonicalUrl: 'https://www.flightradar24.com/data/playback/3c000002' }) };
  gp.$page = LOCKED; w.history.pushState({}, '', '/data/playback/3c000002'); reset();
  H.mxDataTick(); const qL = ask();
  check('FR24\'s own page of a flight it locks: the flight asked for once - by its id, aircraft, callsign and times from FR24\'s page', !!qL && qL.id === '3c000002' && qL.reg === 'N123QS' && qL.cs === 'EJA123' && qL.flightNumber === 'EJ123' && qL.dep === t0 + 1200 && qL.arr === t0 + 9100, qL);
  H.mxDataTick(); check('... once', posted.filter(p => p && p.__tweeksLadd === 'pbPage').length === 1);
  await reply(qL, flight('3c000002', { hex: 'a1b2c3', reg: 'N123QS', cs: 'EJA123', dep: t0 + 1200, arr: t0 + 9100 }));
  const vL = visits[0], pL = vL && vL[1].props;
  check('... the page replaced (not a new one in the history): FR24\'s words kept - flight number, airline, airports, times, its route', !!vL && vL[0] === 'replace' && pL.flightNumber === 'EJ123' && pL.airline.name === 'NetJets' && pL.origin.code === 'LGA' && pL.destination.code === 'PBI' && pL.flightTimes.scheduledDeparture === t0 + 1100 && pL.route.name === 'data.playback' && pL.about.departure.time === t0 + 1200, pL && { fn: pL.flightNumber, o: pL.origin, route: pL.route });
  check('... the track given and the lock gone', isPage(vL, '3c000002') && pL.trail.length === 4 && pL.trailSource === 'tl' && !('lockedFeature' in pL.aircraft) && pL.aircraft.name === 'Cessna Citation X', pL && { lock: pL.playbackLock, src: pL.trailSource });
  // FR24's own page of a flight it plays back itself: left alone
  gp.$page = { component: 'Data/NewFlightPlayback', url: '/data/playback/3c000003', props: Object.assign({}, SHARED, { callsign: 'BAW123', flightNumber: 'BA123', aircraft: { name: 'Airbus A320', registration: 'G-EUUA' }, trail: [{ timestamp: 1, barometricAltitude: 0, groundSpeed: 0 }], trailRoute: [{ timestamp: 1, lat: 1, long: 1 }], tracklog: [], playbackLock: null, trailSource: 'grpc' }) };
  w.history.pushState({}, '', '/data/playback/3c000003'); reset(); H.mxDataTick();
  check('FR24\'s own page of a flight it plays back itself: left alone, nothing asked', !ask() && !visits.length);
  // FR24's own page of a blocked flight: its track, but none of who it was - the flight asked for (its identity given)
  gp.$page = { component: 'Data/NewFlightPlayback', url: '/data/playback/3c000004', props: Object.assign({}, SHARED, { callsign: null, flightNumber: null, aircraft: { name: 'N/A', registration: null }, facts: [], trail: [{ timestamp: 1, barometricAltitude: 0, groundSpeed: 0 }], trailRoute: [{ timestamp: 1, lat: 1, long: 1 }], tracklog: [], playbackLock: null, trailSource: 'grpc' }) };
  w.history.pushState({}, '', '/data/playback/3c000004'); reset(); H.mxDataTick(); const qB = ask();
  check('FR24\'s own page of a blocked flight (its track shown, nobody named): the flight asked for, to name it', !!qB && qB.id === '3c000004', qB);
  // a flight known only here, opened by its address: FR24 has no page of it - the page is all of the track's
  const SID = syn('a80b2e', t0);
  gp.$page = { component: 'Error', url: '/data/playback/' + SID, props: Object.assign({}, SHARED, { status: 404 }) };
  w.history.pushState({}, '', '/data/playback/' + SID); reset(); H.mxDataTick(); const qS = ask();
  check('a flight known only here opened by its address (FR24\'s page of it an error): asked for by its id', !!qS && qS.id === SID, qS);
  await reply(qS, flight(SID, { hex: 'a80b2e', reg: 'N600EB', cs: 'N600EB', dep: t0 }));
  check('... FR24\'s player in its place, FR24\'s error page\'s own props not carried over', visits.length === 1 && visits[0][0] === 'replace' && isPage(visits[0], SID) && !('status' in visits[0][1].props) && visits[0][1].props.route.name === 'web.data.playback', visits[0] && Object.keys(visits[0][1].props).length);
  // FR24's flights page opened in the place of one FR24 has no page of, marked: the playback given to its router there
  gp.$page = { component: 'Data/Flights', url: '/data/flights?tl-pb=' + SID, props: Object.assign({}, SHARED, { flights: [] }) };
  delete gp.$page.props.trailSource; w.history.pushState({}, '', '/data/flights?tl-pb=' + SID);
  const SIDF = syn('a80b2e', t0 + 60); gp.$page.url = '/data/flights?tl-pb=' + SIDF; w.history.pushState({}, '', '/data/flights?tl-pb=' + SIDF); reset();
  check('... the mark read as the page opens', H.mxPbParam() === SIDF);
  // (FR24's app writing its own address over it as it starts: the mark read at the start is the one taken)
  H.setPbWanted(SIDF); w.history.replaceState({}, '', '/data/flights'); H.mxDataTick(); const qF = ask();
  check('FR24\'s flights page marked with a playback (opened in place of one FR24 has no page of): the flight asked for', !!qF && qF.id === SIDF, qF);
  await reply(qF, flight(SIDF, { hex: 'a80b2e', reg: 'N600EB', dep: t0 + 60 }));
  check('... FR24\'s player in its place, under the playback\'s own address; the flights page\'s own props not carried over', visits.length === 1 && visits[0][0] === 'replace' && isPage(visits[0], SIDF) && !('flights' in visits[0][1].props), visits[0] && visits[0][1].url);
  // (the page moved on before the answer came: nothing replaced)
  const SID2 = syn('a80b2e', t0 + 5400); gp.$page = { component: 'Error', url: '/data/playback/' + SID2, props: Object.assign({}, SHARED) };
  w.history.pushState({}, '', '/data/playback/' + SID2); reset(); H.mxDataTick(); const qM = ask();
  gp.$page = { component: 'MapPage', url: '/40.70,-73.90/9', props: Object.assign({}, SHARED) }; w.history.pushState({}, '', '/40.70,-73.90/9'); await reply(qM, flight(SID2));
  check('... the page left before the track came: nothing replaced', !!qM && !visits.length);

  // ---- 2. the userscript's half: the flight of an aircraft the page asks about
  {
    const FIDB = require(path.join(NM, 'fake-indexeddb'));
    const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8'), OA = fs.readFileSync(path.join(DATA, 'oa_airports.csv'), 'utf8');
    const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/40.70,-73.90/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
    win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    // (adsb.lol's record of N600EB's day of its LaGuardia - Fort Lauderdale flight: the stand, the climb out, the cruise,
    // the landing; airplanes.live has nothing more)
    const D1 = nowS - 2 * 86400, DAY = new Date(D1 * 1000).toISOString().slice(0, 10).replace(/-/g, '/'), DAY0 = Date.parse(DAY.replace(/\//g, '-') + 'T00:00:00Z') / 1000;
    const TRACE = { icao: 'a80b2e', timestamp: DAY0, trace: [] };
    for (let s = D1 - 900; s <= D1 + 9300; s += 30) {
      const k = (s - D1) / 9000, gnd = s < D1 || s > D1 + 9000, lat = 40.7772 + (26.0726 - 40.7772) * Math.min(1, Math.max(0, k)), lon = -73.8726 + (-80.1527 + 73.8726) * Math.min(1, Math.max(0, k));
      const alt = gnd ? 'ground' : Math.round(Math.min(41000, 41000 * Math.min(k, 1 - k) * 8)), gs = gnd ? 8 : 300 + Math.round(150 * Math.min(1, Math.min(k, 1 - k) * 8));
      TRACE.trace.push([s - DAY0, lat, lon, alt, gs, 200, 0, gnd ? null : 1200, s === D1 ? { flight: 'N600EB  ', squawk: '2214' } : null, 'adsb_icao']);
    }
    // (and today's record of an aircraft this browser knows nothing of: two flights out of Biggin Hill, three hours apart)
    const TD0 = Math.floor(nowS / 86400) * 86400, TWO = { icao: 'a00001', timestamp: TD0, trace: [] }, F1 = nowS - 5 * 3600, F2 = nowS - 2 * 3600;
    for (let s = F1 - 600; s <= nowS - 1800; s += 30) {
      const k1 = (s - F1) / 3600, k2 = (s - F2) / 3600, up1 = k1 >= 0 && k1 <= 1, up2 = k2 >= 0 && k2 <= 1, k = up1 ? k1 : up2 ? k2 : 0;
      const gnd = !up1 && !up2, alt = gnd ? 'ground' : Math.round(9000 * Math.min(1, Math.min(k, 1 - k) * 6));
      TWO.trace.push([s - TD0, 51.33 + (up1 || up2 ? 0.3 * Math.sin(Math.PI * k) : 0), 0.03 + (up1 || up2 ? 0.4 * Math.sin(Math.PI * k) : 0), alt, gnd ? 5 : 150, 90, 0, null, null, 'adsb_icao']);
    }
    const answer = u => /flightradar24\.com\/mobile\/airports\/format/.test(u) ? [200, AIRPORTS] : /adsb\.lol\/data\/traces\/01\/trace_full_a00001\.json/.test(u) ? [200, JSON.stringify(TWO)] : /ourairports-data\/main\/airports\.csv/.test(u) ? [200, OA] : /adsb\.lol\/globe_history\/.*trace_full_a80b2e\.json/.test(u) && u.indexOf(DAY) > 0 ? [200, JSON.stringify(TRACE)] : [404, ''];
    win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
    win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
    win.unsafeWindow = win; win.GM_notification = () => {}; win.postMessage = () => {}; win.console.debug = () => {}; win.console.log = () => {};
    win.eval(SRC);
    const L = win.__tweeksLadd;
    for (let i = 0; i < 600 && !(L && L.engine.airports.length > 5000); i++) await sleep(100);
    await L.store.ready;
    const lga = L.engine.byIcao('KLGA'), fll = L.engine.byIcao('KFLL');
    check('the userscript running, with its airports', !!(L && L.pbWhere && lga && fll));
    const hex = 'a80b2e', d1 = nowS - 2 * 86400, d2 = nowS - 30 * 3600;
    L.store.mergeHex(hex, { reg: 'N600EB', type: 'GLF5', ladd: true, recent: [[d1, d1 + 9000, lga.id, fll.id, 'ground', 'ground', 'N600EB', 41000, 1], [d2, d2 + 9000, fll.id, lga.id, 'ground', 'ground', 'EJA600', 41000, 1]] });
    const near = await L.pbWhere({ reg: 'N600EB', dep: d1 + 120, depAp: lga.id, kind: 'departures', apId: lga.id });
    check('by its registration, at a row\'s time: the leg nearest it, its take-off over the field it left', near.hex === hex && near.dep === d1 && near.depLL && Math.abs(near.depLL[0] - lga.lat) < 1e-6 && near.z === 10 && near.ll[lga.id] && Math.abs(near.ll[lga.id][1] - lga.lon) < 1e-6, near);
    check('... and where its leg ended', near.end === d1 + 9000, near.end);
    const arr = await L.pbWhere({ hex, at: d2 + 9000, atAp: lga.id, kind: 'arrivals', apId: lga.id });
    check('an arrival at its landing time: that leg\'s take-off at its other end', arr.dep === d2 && Math.abs(arr.depLL[0] - fll.lat) < 1e-6, arr);
    const last = await L.pbWhere({ reg: 'N600EB' });
    check('no time given: its latest flight', last.dep === d2, last);
    const byCs = await L.pbWhere({ cs: 'EJA600' });
    check('by a callsign it flew under', byCs.hex === hex && byCs.dep === d2, byCs);
    const none = await L.pbWhere({ reg: 'N600EB', at: nowS - 6 * 86400 });
    check('no flight of it near the time: none made up', !none.dep && none.hex === hex, none);
    const unk = await L.pbWhere({ reg: 'G-NONE', depAp: fll.id });
    check('an aircraft not known: only the airports\' places', !unk.hex && !!unk.ll[fll.id], unk);
    // ---- (1.2.4) the flight for FR24's player: a leg of a rebuilt log, by its id (the aircraft and its take-off)
    const sid = L.pbSynId(hex, d1), fl = await L.pbFlight({ id: sid });
    check('FR24\'s player\'s flight of a leg known only here: its id, aircraft, airports and times', fl.ok && fl.id === sid && fl.hex === hex && fl.reg === 'N600EB' && fl.origin && fl.origin.code === 'LGA' && fl.destination && fl.destination.code === 'FLL' && fl.dep === d1 && fl.arr === d1 + 9000 && fl.origin.tz === 'America/New_York', fl && { id: fl.id, o: fl.origin, d: fl.destination, dep: fl.dep - d1, arr: fl.arr - d1 });
    const pts = (fl && fl.pts) || [], air = pts.filter(p => !p.gnd);
    check('... its track from the day\'s record: from its stand to its landing, nothing of the day outside the flight\'s time', pts.length > 100 && pts[0].t >= d1 - 120 && pts[pts.length - 1].t <= d1 + 9000 + 120 && air.length > 80 && air.some(p => p.alt >= 40000) && pts.every((p, i) => !i || p.t > pts[i - 1].t), { n: pts.length, first: pts[0] && pts[0].t - d1, last: pts.length && pts[pts.length - 1].t - d1 });
    check('... each point as FR24\'s player takes it: position, altitude (0 on the ground), speed, track, climb, squawk', pts.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.gs) && (p.gnd ? p.alt === 0 : Number.isFinite(p.alt))) && air.some(p => p.vr === 1200) && pts.some(p => p.sq === '2214'), air[3]);
    const latest = await L.pbFlight({ id: L.pbSynId(hex, 0) });
    check('... the id of the aircraft alone ("its latest flight"): its latest - here with no record of its day: none, nothing of another flight made up', !latest.ok || latest.dep === d2, { ok: latest.ok, dep: latest.dep && latest.dep - d2 });
    check('... an aircraft nobody knows: none', !(await L.pbFlight({ id: L.pbSynId('abcdef', d1) })).ok);
    // (no leg of the aircraft known here: the flight cut out of the day's record - not the day's other flight)
    const f1 = await L.pbFlight({ id: L.pbSynId('a00001', F1) }), p1 = (f1 && f1.pts) || [];
    check('a flight of an aircraft with no log here: just that flight out of the day\'s record (two that day) - its stand, its hour up, its taxi in', f1.ok && p1[0].t >= F1 - 600 && p1[p1.length - 1].t <= F1 + 3600 + 660 && !p1.some(p => p.t > F2 - 3600) && p1.some(p => !p.gnd) && f1.origin && f1.origin.code === 'BQH', { ok: f1.ok, first: p1[0] && p1[0].t - F1, last: p1.length && p1[p1.length - 1].t - F1, o: f1.origin });
    const fl2 = await L.pbFlight({ id: L.pbSynId('a00001', 0) }), p2 = (fl2 && fl2.pts) || [];
    check('... its latest flight asked for (nothing known of when): the second of the day, from the record', fl2.ok && Math.abs(fl2.dep - F2) <= 60 && p2[0].t >= F2 - 600 && !p2.some(p => p.t < F1 + 3600), { ok: fl2.ok, dep: fl2.dep && fl2.dep - F2 });
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
