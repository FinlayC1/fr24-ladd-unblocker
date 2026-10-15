// The map's airport panel, offline: the BUILT userscript in jsdom with a shared monitor (made up here) and FR24's own
// answers made up too, on a panel shaped like FR24's (Caernarfon: "Latest events", statistics, movements with the locked
// "Movements per day" and "Runway usage" pictures, the plea to help its ground coverage, "Airport & runway details"):
// the events and the plea taken out (nothing else); the movements of each day - FR24's own schedule counted, the blocked
// flights the userscript knows on top; the runways the monitor's tracked flights used; every runway in full, each end, the
// radio frequencies; another airport opened - its own; the panel closed - nothing of ours left.
// usage: node test/unit_panel.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), os = require('os');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');

// ---- the monitor: the real code, with flights it tracked at Caernarfon
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monpanel-'));
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E, qkc = E.byIcao('EGCK'), nowS = Math.floor(Date.now() / 1000);
const legAt = (hex, t, o) => Object.assign({ hex, reg: 'G-TEST', type: 'C172', ladd: false, tStart: t, tEnd: t + 1800, tOff: t + 60, tOn: t + 1700, ended: true, open: false }, o);
M.legs.set('400001', new Map([[1, legAt('400001', nowS - 86400, { from: { id: qkc.id, code: 'QKC', conf: 'ground' }, to: { id: E.byIcao('EGNR').id, code: 'HAW', conf: 'ground' }, rwyOff: '25' })],
  [2, legAt('400001', nowS - 40000, { from: { id: E.byIcao('EGNR').id, code: 'HAW', conf: 'ground' }, to: { id: qkc.id, code: 'QKC', conf: 'ground' }, rwyOn: '25' })]]));
M.legs.set('400002', new Map([[1, legAt('400002', nowS - 20000, { from: { id: qkc.id, code: 'QKC', conf: 'ground' }, to: null, ended: false, open: true, rwyOff: '20' })]]));
M.legs.set('400003', new Map([[1, legAt('400003', nowS - 30000, { from: { id: E.byIcao('EGNS').id, code: 'IOM', conf: 'ground' }, to: { id: qkc.id, code: 'QKC', conf: 'low' } })]]));
// (and a blocked jet that landed there yesterday - FR24 shows it nowhere)
const tday = t => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const yest = Date.parse(tday(nowS - 86400) + 'T11:00:00Z') / 1000, yLand = yest + 3600;   // (yesterday around noon, the airport's time)
const tNow = tday(nowS - 3600) === tday(nowS) ? nowS - 3600 : nowS - 30;   // (today's flight: an hour ago, or just now in the airport's first hour of the day)
M.legs.set('43c0de', new Map([[1, legAt('43c0de', yLand - 1800, { reg: 'G-LADD', type: 'C25A', ladd: true, startedOnGround: true, tOn: yLand, tEnd: yLand + 60, from: { id: E.byIcao('EGNS').id, code: 'IOM', conf: 'ground' }, to: { id: qkc.id, code: 'QKC', conf: 'ground' }, rwyOn: '07' })]]));

// ---- FR24's own answers: its airport list, an airport's runways, its schedule (one page each way)
const sch = mode => { const k = mode === 'arrivals' ? 'arrival' : 'departure', fl = [];
  for (let i = 0; i < (mode === 'arrivals' ? 5 : 4); i++) fl.push({ flight: { identification: { id: mode[0] + i }, time: { scheduled: { [k]: yest - 3 * 86400 + i }, real: { [k]: yest + i * 60 } } } });
  fl.push({ flight: { identification: { id: mode[0] + 'x' }, time: { scheduled: { [k]: tNow }, real: { [k]: tNow } } } });
  return fl; };
const asked = [];
function answer(url, o) {
  asked.push(url);
  if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
  if (/^https:\/\/mon\.test\//.test(url)) {
    if ((o.headers || {})['X-Monitor-Token'] !== 'tok') return [401, ''];
    const u = new URL(url);
    if (u.pathname === '/status') return [200, JSON.stringify({ v: 3 })];
    return [200, JSON.stringify(M.answer(u, Date.now() / 1000) || {})];
  }
  const m = /api\.flightradar24\.com\/common\/v1\/airport\.json\?code=([a-z]+)&(.*)$/.exec(url);
  if (m && /runways/.test(m[2])) return [200, JSON.stringify({ result: { response: { airport: { pluginData: { details: { code: { iata: m[1].toUpperCase(), icao: m[1] === 'qkc' ? 'EGCK' : 'EGNR' } }, runways: [{ name: '07/25', length: { ft: 2887, m: 880 }, surface: { code: 'ASPH', name: 'Asphalt' } }] } } } } })];
  if (m && /schedule/.test(m[2])) { const mode = /\[mode\]=(arrivals|departures)/.exec(m[2])[1], pg = +/&page=(-?\d+)/.exec(m[2])[1]; return [200, JSON.stringify({ result: { response: { airport: { pluginData: { schedule: { [mode]: { data: pg === -1 ? sch(mode) : [], page: { current: pg, total: 1 } } } } } } } })]; }
  return [404, ''];
}
function makeWin(url) {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u, init || {}); return Promise.resolve(new Response(text || '', { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url, o); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.__posted = []; win.postMessage = data => { win.__posted.push(data); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.console.debug = () => {}; win.console.log = () => {};
  win.__tlTestHook = h => { win.__H = h; };
  win.eval(SRC);
  return win;
}
const PANEL = `<div data-testid="airport-panel"><div class="head"><h2>Caernarfon Airport</h2><p>QKC / EGCK</p></div>
  <div class="tabs"><button data-testid="airport-panel__tab-arrivals">Arrivals</button><button data-testid="airport-panel__tab-departures">Departures</button></div>
  <div class="scroll">
    <section class="ev"><button><span>Latest events</span><svg></svg></button><div class="list"><p>Runway 07/25 closed for works</p></div></section>
    <section class="st"><h3>Airport statistics</h3><p>Airports served</p><p>14</p><p>Countries served</p><p>4</p><h4>Busiest routes</h4><p>Hawarden</p></section>
    <section class="mv"><h3>Airport movements</h3><p>Total</p><p>92</p>
      <div class="r1"><h4>Movements per day</h4><button class="lock"><picture data-testid="airport-panel__promo-movements_per_day"><img alt="Movements per day"></picture></button></div>
      <div class="r2"><h4>Runway usage</h4><button class="lock"><picture><img src="locked.png"></picture></button></div>
    </section>
    <div class="beg"><div><p>Help us improve ground coverage</p><a href="/apply">Apply for a free receiver</a></div></div>
    <section class="det"><button>Airport &amp; runway details</button><div class="relative flex"><button><picture data-testid="airport-panel__promo-runway_details"></picture></button></div></section>
  </div></div>`;

(async () => {
  const w = makeWin('https://www.flightradar24.com/53.10,-4.34/10'), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000 && w.__H, 60000);
  await L.store.kvReady;
  L.store.kvSet('monRemote', { url: 'https://mon.test', token: 'tok' }); await L.monCheck(true).catch(() => {});
  check('ready: airports, the shared monitor', L.engine.airports.length > 5000 && L.monUp());
  // ---- Caernarfon's panel
  w.history.pushState({}, '', '/airport/qkc'); w.document.body.insertAdjacentHTML('beforeend', PANEL);
  const doc = w.document, q = s => doc.querySelector(s);
  await until(() => q('.tl-panel[data-kind="usage"]') && q('.tl-rwy') && /Radio frequencies/.test(q('.tl-rwy').textContent), 8000);
  check('"Latest events" taken out - its title and its list', q('section.ev').style.display === 'none');
  check('... the plea to help FR24\'s ground coverage too', q('.beg').style.display === 'none' || q('.beg > div').style.display === 'none');
  check('... nothing else: the header, the tabs, the statistics, the movements, the details stay', ['.head', '.tabs', 'section.st', 'section.mv', 'section.det', '.scroll'].every(s => q(s).style.display !== 'none') && q('[data-testid="airport-panel"]').style.display !== 'none');
  const use = q('.tl-panel[data-kind="usage"]'), ut = use ? use.textContent : '';
  check('"Runway usage": the locked picture (found under its title) gives way to the runways the monitor\'s tracked flights used - 25 (a take-off, a landing), 20 (a take-off), 07 (a landing), 02 none; how many it saw said', !!use && q('.r2 .lock').style.display === 'none' && /25\s*1 \/ 1/.test(ut) && /20\s*1 \/ 0/.test(ut) && /07\s*0 \/ 1/.test(ut) && /02\s*0 \/ 0/.test(ut) && /5 movements the monitor tracked here/.test(ut) && /clear from the track for 4/.test(ut), ut);
  const det = q('.tl-rwy'), dt = det ? det.textContent : '';
  check('"Airport & runway details": every runway in full (07/25 880 m, 23 m wide, asphalt, lit; 02/20), each end (heading, elevation, displaced threshold), the radio frequencies', /07\/25/.test(dt) && /880\/2,887/.test(dt) && /23/.test(dt) && /Asphalt/.test(dt) && /Yes/.test(dt) && /02\/20/.test(dt) && /Runway ends/.test(dt) && /25.*251°.*11 ft.*292 ft/.test(dt) && /Radio frequencies/.test(dt) && /122\.225/.test(dt) && q('[data-testid="airport-panel__promo-runway_details"]').closest('button').style.display === 'none', dt);
  // (FR24's own schedule counted once the panel has been open a moment)
  const mv = await until(() => { const x = q('.tl-panel[data-kind="moves"]'); return x && /\d+ \/ \d+/.test(x.textContent) ? x : null; }, 15000);
  const mt = mv ? mv.textContent : '', yd = new Date(tday(yest) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  check('"Movements per day": the locked picture (by its name) gives way to each day\'s take-offs and landings - FR24\'s own schedule counted', !!mv && q('.r1 .lock').style.display === 'none' && mt.includes(yd) && /\(so far\)/.test(mt) && asked.some(u => /plugin\[\]=schedule/.test(u)), mt);
  const mv2 = await until(() => { const x = q('.tl-panel[data-kind="moves"]'); return x && /blocked flight/.test(x.textContent) ? x : null; }, 8000), mt2 = mv2 ? mv2.textContent : mt;
  check('... yesterday: FR24\'s 4 take-offs and 5 landings, and the blocked jet\'s landing it does not show on top: 4 / 6', new RegExp(yd + '\\s*4 / 6').test(mt2) && /with 1 blocked flight it does not show/.test(mt2), mt2);
  // ---- another airport opened: its own
  const panel = q('[data-testid="airport-panel"]'); panel.remove();
  await until(() => !q('.tl-panel'), 3000);
  check('the panel closed: nothing of ours left', !q('.tl-panel') && !q('.tl-rwy'));
  w.history.pushState({}, '', '/airport/ceg'); w.document.body.insertAdjacentHTML('beforeend', PANEL.replace('Caernarfon Airport', 'Hawarden Airport'));
  await until(() => q('.tl-rwy') && /04\/22/.test(q('.tl-rwy').textContent) && q('.tl-panel[data-kind="usage"]') && /2 movements/.test(q('.tl-panel[data-kind="usage"]').textContent), 8000);
  const dt2 = q('.tl-rwy') ? q('.tl-rwy').textContent : '', u2 = q('.tl-panel[data-kind="usage"]'), ut2 = u2 ? u2.textContent : '';
  check('another airport opened (Hawarden, CEG): its own runway (04/22), its own runway use (two movements tracked, neither runway clear from the track)', /04\/22/.test(dt2) && !/02\/20/.test(dt2) && /04\s*0 \/ 0/.test(ut2) && /22\s*0 \/ 0/.test(ut2) && /2 movements/.test(ut2) && /for 0\./.test(ut2) && doc.querySelectorAll('.tl-rwy').length === 1 && doc.querySelectorAll('.tl-panel[data-kind="usage"]').length === 1, { dt2, ut2 });
  // ---- FR24's own layout (Boscombe Down, 14 Oct): its parts are sections in one box - the weather, then the events
  // (an event about the weather in its list), then the plea - and they are gone the moment they are put in, before the
  // browser paints: no flash, and no empty box where the events were
  panel.remove(); doc.querySelectorAll('[data-testid="airport-panel"]').forEach(e => e.remove());
  w.history.pushState({}, '', '/airport/qua');
  const PANEL2 = `<div data-testid="airport-panel"><div class="head"><h2>Amesbury MOD Boscombe Down</h2></div>
    <div class="scroll"><div class="box">
      <section class="p-1 wx"><div><p>Conditions</p><p>Clear</p><p>Temperature</p><p>13 °C</p></div><button>More weather &amp; METAR</button></section>
      <section class="p-1 ev2"><div class="t"><button><span>Latest events</span><svg></svg></button></div><div class="list"><p>Weather warning: strong winds</p></div></section>
      <section class="p-1 st2"><h3>Airport statistics</h3><p>Last 7 days</p></section>
      <div class="beg2"><div class="in"><p>Help us improve ground coverage</p><a href="/apply">Apply for a free receiver</a></div></div>
    </div></div></div>`;
  doc.body.insertAdjacentHTML('beforeend', PANEL2);
  await Promise.resolve(); await Promise.resolve();
  const shown = s => { const e = q(s); return !!e && w.getComputedStyle(e).display !== 'none'; };
  check('FR24\'s layout: the events\' whole section (its box too, not an empty bar) gone as soon as it is put in - before any timer, so never painted', !shown('section.ev2'), q('section.ev2') && q('section.ev2').outerHTML.slice(0, 160));
  check('... the plea too, its box with it', !shown('.beg2'));
  check('... the weather and the statistics stay', shown('section.wx') && shown('section.st2') && shown('.box'));
  // (and drawn again by FR24 - a part put back, its title text set afresh: gone at once again)
  const sec2 = q('section.ev2'), copy = sec2.cloneNode(true); copy.removeAttribute('data-tl-hidden'); copy.removeAttribute('style'); copy.querySelectorAll('[data-tl-hidden]').forEach(e => { e.removeAttribute('data-tl-hidden'); e.removeAttribute('style'); }); copy.className = 'p-1 ev3';
  sec2.after(copy); await Promise.resolve(); await Promise.resolve();
  check('... FR24 drawing the events again: gone again at once', !shown('section.ev3'));
  // ---- FR24's "Remove ads" button in a board's list (Manchester's departures, 15 Oct), where an advert sat: gone the
  // moment it is put in, with the empty slot round it - the rows close up. In the panel, and on a board's own page
  { const box = q('.box');
    box.insertAdjacentHTML('beforeend', `<div class="brd"><div class="row r1"><span>3:15 PM</span><span>Fuerteventura</span><span>LS909</span></div>
      <div class="adw my-6"><div id="pb-slot-fr24-board-1"></div><div class="flex justify-center"><a href="/premium"><svg></svg><span>Remove ads</span></a></div></div>
      <div class="row r2"><span>3:15 PM</span><span>Lanzarote</span><span>LS807</span></div>
      <div class="slot2"><div id="div-gpt-ad-1234-0"></div></div><div class="btw"><button type="button"><svg></svg> REMOVE ADS </button></div>
      <div class="row r3"><span>3:20 PM</span><span>Jersey</span><span>U2729</span></div></div>`);
    await Promise.resolve(); await Promise.resolve();
    check('a board\'s "Remove ads" button and the advert\'s slot round it: gone as soon as they are put in', !shown('.adw') && !shown('.btw') && !shown('.slot2'), [q('.adw') && q('.adw').getAttribute('style'), q('.btw') && q('.btw').getAttribute('style'), q('.slot2') && q('.slot2').getAttribute('style')]);
    check('... the rows round them stay', shown('.r1') && shown('.r2') && shown('.r3') && shown('.brd'));
    // (put in by FR24 a moment later - its text set after the button)
    const late = doc.createElement('div'); late.className = 'late'; late.innerHTML = '<button><span></span></button>'; q('.brd').insertBefore(late, q('.r3'));
    await Promise.resolve(); late.querySelector('span').textContent = 'Remove ads'; await Promise.resolve(); await Promise.resolve();
    check('... one whose words FR24 writes in after the button: gone too', !shown('.late'));
    // (a board's own page, no panel)
    doc.body.insertAdjacentHTML('beforeend', '<main class="page"><ul class="rows"><li class="p1">Palma de Mallorca FR3441</li><li class="pad"><div class="ad-manager-wrapper"></div><p><a href="/premium">Remove ads</a></p></li><li class="p2">Gdansk FR4094</li></ul></main>');
    await Promise.resolve(); await Promise.resolve();
    check('... and on a board\'s own page', !shown('li.pad') && shown('li.p1') && shown('li.p2') && shown('ul.rows'));
  }
  // ---- FR24's dropdowns (Liverpool, 15 Oct): Disruptions, then the events in a bordered box of their own (an empty box
  // beside them in it), then the statistics, the details, Travelers. The events' box goes with them - no thin empty bar left
  // between Disruptions and Airport statistics - and so does any other box in that list with nothing in it to see; one FR24
  // fills comes back
  doc.querySelectorAll('[data-testid="airport-panel"]').forEach(e => e.remove());
  w.history.pushState({}, '', '/airport/lpl');
  const DD = t => `<div class="dd rounded border"><button class="flex"><svg></svg><span>${t}</span><svg class="chev"></svg></button></div>`;
  doc.body.insertAdjacentHTML('beforeend', `<div data-testid="airport-panel"><div class="head"><h2>Liverpool John Lennon Airport</h2></div>
    <div class="scroll"><div class="wxc"><p>Conditions</p><p>Overcast</p><button>More weather &amp; METAR</button></div>
      <div class="dds">${DD('Disruptions')}<div class="evbox rounded border p-1"><section class="ev4"><div class="t"><button><span>Latest events</span><svg></svg></button></div><div class="list"></div></section><div class="mt-1"><!----></div></div>${DD('Airport statistics')}<div class="blank2 rounded border p-1"><div><span> </span><svg></svg></div></div>${DD('Airport &amp; runway details')}${DD('Travelers')}</div>
    </div></div>`);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check('the events\' own bordered box between Disruptions and Airport statistics: gone with them, before the browser paints', !shown('.evbox') && !shown('section.ev4'), q('.evbox') && q('.evbox').outerHTML.slice(0, 200));
  check('... an empty box in the dropdowns\' list (only an empty icon in it): gone too', !shown('.blank2'));
  check('... every dropdown with words in it stays: Disruptions, statistics, details, Travelers, and the weather', [...doc.querySelectorAll('.dds > .dd')].every(e => w.getComputedStyle(e).display !== 'none') && doc.querySelectorAll('.dds > .dd').length === 4 && shown('.wxc') && shown('.dds'));
  q('.blank2 span').textContent = 'Runway 09/27 closed'; await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check('... the empty box FR24 fills later: back the moment it has words in it', shown('.blank2'));
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
