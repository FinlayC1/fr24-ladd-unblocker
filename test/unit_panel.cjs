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
// (a flight of today, the airport's time: an hour ago - or, in the airport's first hour after midnight, just after it, so
// it never falls on yesterday)
const ukOff = Date.parse(new Date(nowS * 1000).toLocaleString('sv-SE', { timeZone: 'Europe/London' }).replace(' ', 'T') + 'Z') / 1000 - nowS;
const tToday = Math.min(nowS - 1, Math.max(nowS - 3600, Date.parse(tday(nowS) + 'T00:00:00Z') / 1000 - ukOff + 30));
M.legs.set('43c0de', new Map([[1, legAt('43c0de', yLand - 1800, { reg: 'G-LADD', type: 'C25A', ladd: true, startedOnGround: true, tOn: yLand, tEnd: yLand + 60, from: { id: E.byIcao('EGNS').id, code: 'IOM', conf: 'ground' }, to: { id: qkc.id, code: 'QKC', conf: 'ground' }, rwyOn: '07' })]]));

// ---- FR24's own answers: its airport list, an airport's runways, its schedule (one page each way)
const sch = mode => { const k = mode === 'arrivals' ? 'arrival' : 'departure', fl = [];
  for (let i = 0; i < (mode === 'arrivals' ? 5 : 4); i++) fl.push({ flight: { identification: { id: mode[0] + i }, time: { scheduled: { [k]: yest - 3 * 86400 + i }, real: { [k]: yest + i * 60 } } } });
  fl.push({ flight: { identification: { id: mode[0] + 'x' }, time: { scheduled: { [k]: tToday }, real: { [k]: tToday } } } });
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
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
