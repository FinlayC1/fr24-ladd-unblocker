// "Playback" of a flight FR24 blocks opens FR24's own map playback at its take-off, in the same tab - and every other
// Playback is FR24's (the BUILT userscript in jsdom: the page-world part on its own, then the userscript's half).
//   - FR24's bottom bar Playback (its playback window), with a blocked flight open in the panel: never taken
//   - the panel's own Playback (FR24's flight-actions button, and the aircraft__playback one) of a blocked flight: its
//     take-off, over the field it left; of an ordinary flight: FR24's
//   - airport board cards (Aircraft info / Bookmark aircraft / Playback): a flight followed here, kept rows of this
//     script's own (N600EB's departure from LaGuardia two days before) and FR24's own of a blocked aircraft, an arrival
//     (its other end's take-off), FR24's today's row of a blocked flight, of an aircraft named blocked in a search;
//     FR24's own rows of ordinary flights untouched
//   - search results: a live blocked flight, its aircraft, a blocked aircraft not flying now (the userscript finds its
//     flight), an ordinary aircraft untouched; nothing known of when it flew: FR24's own after all
//   - a middle / Ctrl click: the same playback in a new tab; a rebuilt log row: its leg's take-off
//   - the flight selected in FR24's playback once it is on the map, by FR24's id or by its aircraft; never over the
//     user's own choice
//   - the userscript's answer (pbWhere): the aircraft's leg nearest the row's time, its latest, by registration or
//     callsign, and the airports' places
// usage: node test/unit_pbbuttons.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const ymd = t => new Date(t * 1000).toISOString().slice(0, 10), hm = t => new Date(t * 1000).toISOString().slice(11, 16);
const url = (t, lat, lon, z) => `/${ymd(t)}/${hm(t)}/1x/${lat.toFixed(2)},${lon.toFixed(2)}/${z}`;

(async () => {
  // ---- 1. the page-world part
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/40.70,-73.90/9', runScripts: 'dangerously' });
  const w = dom.window, doc = w.document;
  let H = null; w.__tlTestHook = h => { H = h; };
  const posted = []; w.postMessage = d => posted.push(d);
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.fetch = () => Promise.reject(new Error('offline')); w.indexedDB = undefined;
  // (FR24's own state stores, as its Vue app holds them: its airports, its playback)
  const AP = new Map([[3901, { id: 3901, iata: 'LGA', lat: 40.7772, lon: -73.8726 }], [3500, { id: 3500, iata: 'FLL', lat: 26.0726, lon: -80.1527 }]]);
  const stores = new Map([['airports', { airports: [], airportsById: AP }], ['playback', { active: false, timestamp: 0, selectedFlightId: null }], ['aircraft', { selected: null }]]);
  doc.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: stores } } } };
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) { console.log('FAIL  pageInterceptor not found in the build'); process.exit(1); }
  w.eval('(' + m[0] + ')()');
  check('page-world test hook', !!(H && H.pbFind && H.pbPlan));
  const B = w.__tweeksLaddBridge;
  const navs = [], opened = []; H.setPbNav(u => navs.push(u)); w.open = u => { opened.push(u); return null; };
  const nowS = Math.floor(Date.now() / 1000);
  // what FR24 does with a Playback it is left: its own handler (here: counted)
  const fr24 = []; doc.addEventListener('click', ev => { const a = ev.target.closest && ev.target.closest('[data-fr24]'); if (a) fr24.push(a.getAttribute('data-fr24')); });
  const clk = (el, o) => { const ev = new w.MouseEvent((o && o.type) || 'click', Object.assign({ bubbles: true, cancelable: true }, o || {})); el.dispatchEvent(ev); return ev.defaultPrevented; };
  const reset = () => { navs.length = 0; opened.length = 0; fr24.length = 0; };
  const pbSel = () => { try { return JSON.parse(w.localStorage.getItem('tl.pbSel')); } catch (e) { return null; } };

  // the blocked flight followed in the panel: M-ARNZ as VSB82, off Fort Lauderdale half an hour ago
  const pid = 0x41cd0a3d, T = nowS - 1800;
  B.resolved.set(pid, { cs: 'VSB82', reg: 'M-ARNZ', hex: '424c60', hexNum: 0x424c60, type: 'PC24', photos: [] });
  B.routes.set(pid, { originId: 3500, originIata: 'FLL', atd: T, destId: 3901 });
  B.lastPos.set(pid, { lat: 33.1, lon: -78.2, alt: 41000, at: Date.now() });
  H.setCurFollow(pid);
  const U_PID = url(T - 180, 26.0726, -80.1527, 10);
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
  check('FR24\'s bottom bar Playback with a LADD flight open in the panel: not taken - FR24 opens its playback window', !barTaken && !navs.length && !opened.length && fr24.join() === 'bar-Playback', { navs, opened, fr24 });
  check('... the bar found as the bar', H.inBar(doc.querySelector('[data-fr24="bar-Playback"]')) && !H.inBar(doc.querySelector('[data-fr24="panel-actions"]')));
  reset();
  clk(doc.querySelector('[data-fr24="bar-Playback"]'), { type: 'auxclick', button: 1 });
  check('... nor a middle click on it', !navs.length && !opened.length);

  // ---- the panel's own Playback
  reset();
  const pTaken = clk(doc.querySelector('[data-fr24="panel-actions"]'));
  check('the panel\'s Playback (FR24\'s flight-actions) of a blocked flight: FR24\'s map playback, three minutes before its take-off, over the field it left, in this tab', pTaken && navs.length === 1 && navs[0] === U_PID && !fr24.length && !opened.length, { navs, U_PID });
  check('... the flight to select there kept for that page (FR24\'s id, its aircraft)', (pbSel() || {}).u === U_PID && pbSel().id === pid && pbSel().hex === '424c60', pbSel());
  reset(); clk(doc.querySelector('[data-fr24="panel-menu"] span'));
  check('... the aircraft__playback button the same', navs[0] === U_PID, navs);
  // (a panel showing another aircraft, with the blocked flight followed earlier still the last one followed)
  doc.querySelector('#panel [data-testid="aircraft-panel__header__callsign"]').textContent = 'BAW123'; reset();
  const pOther = clk(doc.querySelector('[data-fr24="panel-actions"]'));
  check('the panel\'s Playback with the panel showing another aircraft (BAW123): FR24\'s own, not the blocked flight followed earlier', !pOther && !navs.length && fr24.join() === 'panel-actions', navs);
  doc.querySelector('#panel [data-testid="aircraft-panel__header__callsign"]').textContent = 'VSB82';
  H.setCurFollow(0x41000001); reset();
  const pOrd = clk(doc.querySelector('[data-fr24="panel-actions"]'));
  check('the panel\'s Playback of an ordinary flight: FR24\'s own', !pOrd && !navs.length && fr24.join() === 'panel-actions');
  H.setCurFollow(pid);

  // ---- a rebuilt log's rows (row i is entry i + 1: FR24 leaves out the first, the flight on screen)
  const T4 = nowS - 3 * 86400;
  B.hist.set('M-ARNZ', { data: [{}, { aircraft: { hex: '424C60', registration: 'M-ARNZ' }, __tlPb: { t: T4, lat: 51.47, lon: -0.45, z: 10 }, __tlTrace: 'x' }, { aircraft: { registration: 'M-ARNZ' } }], at: Date.now() });
  reset();
  clk(doc.querySelector('[data-fr24="log0"]'));
  check('a rebuilt log row\'s Playback: FR24\'s map playback of that leg (its take-off and field)', navs[0] === url(T4 - 180, 51.47, -0.45, 10), navs);
  reset(); const lOwn = clk(doc.querySelector('[data-fr24="log1"]'));
  check('... a row of FR24\'s own: FR24\'s', !lOwn && !navs.length && fr24.join() === 'log1');

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
  reset(); clk(row(9000000000 + pid));
  check('a board row of a blocked flight followed here: its take-off, over the field it left', navs[0] === U_PID, navs);
  reset(); const kTaken = clk(row(ids[0]));
  check('a kept row of this script\'s own (N600EB off LaGuardia two days back): three minutes before its take-off, over LaGuardia', ids[0] >= 20000000000 && kTaken && navs[0] === url(t0 - 180, 40.7772, -73.8726, 10) && !fr24.length, { ids, navs });
  reset(); const kOrd = clk(row(ids[1]));
  check('... FR24\'s own kept row of an ordinary flight: FR24\'s Playback, untouched', !kOrd && !navs.length && fr24.join() === 'row-' + ids[1]);
  reset(); clk(row(ids[2]));
  check('... FR24\'s own kept row of a blocked aircraft: its take-off', navs[0] === url(t0 + 1200 - 180, 40.7772, -73.8726, 10), navs);
  reset(); clk(row(aid));
  check('a kept arrival: the take-off at its other end (Fort Lauderdale), not the landing', navs[0] === url(t0 + 5400 - 180, 26.0726, -80.1527, 10), navs);
  // (FR24's own row of today, of the flight followed here: its card's flight id; the action's words with the aircraft)
  H.cardInfo.set(todayRow, { fid: pid.toString(16), apId, kind: 'arrivals' });
  reset(); clk(row(todayRow).querySelector('svg'));
  check('FR24\'s own row of today of a blocked flight ("Playback - VSB82", clicked on its icon): the flight\'s take-off', navs[0] === U_PID, navs);
  // (an aircraft the userscript named blocked in a search, not flying now: the row's own departure time)
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'searchAdd', rid: 'none', rows: [{ type: 'aircraft', id: 'N777XX', detail: { hex: 'A9F0E1' } }, { type: 'schedule', id: 'EJA777', detail: {} }, { type: 'aircraft', id: 'N600EB', detail: { hex: 'A80B2E' } }] }, source: w }));
  H.boardRowsSeen.set(pbRow, { fid: '3c0000ff', t: T2, st: 'departed', ap: 3500, apId, kind: 'departures' });
  reset(); clk(row(pbRow));
  check('FR24\'s own row of an aircraft named blocked: its departure at this airport', navs[0] === url(T2 - 180, 40.7772, -73.8726, 10) && (pbSel() || {}).hex === 'a9f0e1', { navs, sel: pbSel() });
  reset(); const plain = clk(row(plainRow));
  check('FR24\'s own row of an ordinary aircraft: FR24\'s', !plain && !navs.length && fr24.join() === 'row-' + plainRow);
  // middle and Ctrl clicks: a new tab
  reset(); clk(row(ids[0]), { type: 'auxclick', button: 1 });
  check('a middle click: the same playback in a new tab', opened[0] === 'https://www.flightradar24.com' + url(t0 - 180, 40.7772, -73.8726, 10) && !navs.length, opened);
  reset(); clk(row(ids[0]), { ctrlKey: true });
  check('a Ctrl click: a new tab too', opened.length === 1 && !navs.length);
  reset(); clk(row(ids[0]), { type: 'auxclick', button: 2 });
  check('a right click: nothing', !opened.length && !navs.length);

  // ---- search results
  doc.body.insertAdjacentHTML('beforeend', `<div data-testid="search__results">${[['live:' + pid.toString(16), 'VSB82'], ['aircraft:m-arnz', 'M-ARNZ'], ['aircraft:n600eb', 'N600EB'], ['schedule:EJA777', 'EJA777'], ['aircraft:g-ezbx', 'G-EZBX']].map(([k, l], i) => `<div data-testid="search__result-row"><a data-search-result="${k}">${l}</a>${btn('sr' + i)}</div>`).join('')}</div>`);
  const sr = i => doc.querySelector(`[data-fr24="sr${i}"] span`);
  reset(); clk(sr(0)); const n0 = navs[0];
  reset(); clk(sr(1));
  check('a search result of a live blocked flight, and of its aircraft: the flight\'s take-off', n0 === U_PID && navs[0] === U_PID, [n0, navs[0]]);
  // (a Playback in the results box but in no row: not taken for the first row)
  doc.querySelector('[data-testid="search__results"]').insertAdjacentHTML('beforeend', btn('srbox'));
  reset(); const boxTaken = clk(doc.querySelector('[data-fr24="srbox"] span'));
  check('a Playback in the search results but outside any row: FR24\'s, not the first row\'s flight', !boxTaken && !navs.length && fr24.join() === 'srbox', navs);
  reset(); posted.length = 0;
  const sTaken = clk(sr(2));
  const ask = posted.find(p => p && p.__tweeksLadd === 'pbWhere');
  check('a blocked aircraft not flying now (N600EB): taken, and its flight asked of the userscript', sTaken && !!ask && ask.reg === 'N600EB' && ask.hex === 'a80b2e' && !navs.length, ask);
  const T3 = nowS - 30 * 3600;
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'pbWhereRes', rid: ask && ask.rid, hex: 'a80b2e', dep: T3, depLL: [40.7772, -73.8726], z: 10, ll: {} }, source: w }));
  await sleep(20);
  check('... its latest flight played back from its take-off', navs[0] === url(T3 - 180, 40.7772, -73.8726, 10) && !fr24.length, navs);
  reset(); posted.length = 0;
  clk(sr(3));
  const ask2 = posted.find(p => p && p.__tweeksLadd === 'pbWhere');
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'pbWhereRes', rid: ask2 && ask2.rid }, source: w }));
  await sleep(20);
  check('a callsign of a blocked aircraft with no flight known anywhere: FR24\'s own Playback after all', !!ask2 && ask2.cs === 'EJA777' && !navs.length && fr24.join() === 'sr3', { fr24, navs });
  reset(); const sOrd = clk(sr(4));
  check('a search result of an ordinary aircraft: FR24\'s', !sOrd && !navs.length && fr24.join() === 'sr4');
  reset(); posted.length = 0; clk(sr(2));
  await sleep(1100);
  check('... the userscript silent: FR24\'s own after a moment', !navs.length && fr24.join() === 'sr2', fr24);

  // ---- when and where
  { const n = Math.floor(Date.now() / 1000), p = H.pbPlan({ dep: n + 3600, depLL: [1, 2] });
    check('a take-off still to come: no later than two minutes ago', p && Math.abs(p.t - (n - 120)) <= 1, p); }
  { const n = Math.floor(Date.now() / 1000), p = H.pbPlan({ posLL: [33.1, -78.2] });
    check('no take-off known: five minutes ago, where it is, further out', p && Math.abs(p.t - (n - 300)) <= 1 && p.z === 8 && p.lat === 33.1, p); }
  { const p = H.pbPlan({ at: nowS - 7200, atLL: [40.7772, -73.8726], kind: 'arrivals' });
    check('an arrival without its take-off: ten minutes before the landing, over the airport', p && p.t === nowS - 7800 && p.z === 9, p); }
  check('nothing known: no plan', H.pbPlan({}) === null);
  check('the address FR24\'s map playback has', H.pbUrl({ t: Date.UTC(2026, 9, 9, 12, 35) / 1000, lat: 53.4, lon: -2.6, z: 9 }) === '/2026-10-09/12:35/1x/53.40,-2.60/9');

  // ---- the flight selected once it is on FR24's playback map
  { const calls = [], st = stores.get('playback'); st.active = true; st.selectedFlightId = null; st.selectFlight = v => { calls.push(v); };
    H.setPbPend({ u: '/x', id: pid, hex: '424c60', exp: Date.now() + 60000 });
    H.pbSelTick();
    check('not on the map yet: nothing selected', !calls.length);
    H.pbPos.set(pid, { lat: 26.1, lon: -80.1, at: Date.now() });
    H.pbSelTick();
    check('on the map: selected as a click on it would (FR24\'s playback state, its id)', calls.length === 1 && calls[0] === pid, calls);
    stores.get('aircraft').selected = {}; st.selectedFlightId = pid; H.pbSelTick();
    check('... and done once its panel is open', H.pbPend() === null);
    stores.get('aircraft').selected = null; st.selectedFlightId = null;
    // (no answer the first time: the id as FR24's hex string the second)
    calls.length = 0; H.setPbPend({ u: '/x', id: pid, hex: '', exp: Date.now() + 60000 }); H.pbSelTick(); H.pbPend().at -= 4000; H.pbSelTick();
    check('... no panel after three seconds: tried once more, as the hex string', calls.length === 2 && calls[1] === pid.toString(16), calls);
    // (by its aircraft: a flight the userscript named in the playback)
    calls.length = 0; const fid2 = 0x3d000002; B.resolved.set(fid2, { cs: 'N600EB', reg: 'N600EB', hex: 'a80b2e' }); H.pbPos.set(fid2, { lat: 40.8, lon: -73.9, at: Date.now() });
    H.setPbPend({ u: '/x', id: 0, hex: 'a80b2e', exp: Date.now() + 60000 }); H.pbSelTick();
    check('by its aircraft, as named in the playback', calls[0] === fid2, calls);
    calls.length = 0; st.selectedFlightId = 0x3e000001; H.setPbPend({ u: '/x', id: fid2, hex: 'a80b2e', exp: Date.now() + 60000 }); H.pbSelTick();
    check('never over a flight the user opened', !calls.length && H.pbPend() === null);
    delete st.selectFlight; st.selectedFlightId = null; const patched = []; st.$patch = o => patched.push(o);
    H.setPbPend({ u: '/x', id: fid2, hex: '', exp: Date.now() + 60000 }); H.pbSelTick();
    check('... a store without that action: its state given the id', patched.length === 1 && patched[0].selectedFlightId === fid2, patched);
    st.active = false; }

  // ---- 2. the userscript's half: the flight of an aircraft the page asks about
  {
    const FIDB = require(path.join(NM, 'fake-indexeddb'));
    const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8'), OA = fs.readFileSync(path.join(DATA, 'oa_airports.csv'), 'utf8');
    const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/40.70,-73.90/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
    win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    const answer = u => /flightradar24\.com\/mobile\/airports\/format/.test(u) ? [200, AIRPORTS] : /ourairports-data\/main\/airports\.csv/.test(u) ? [200, OA] : [404, ''];
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
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
