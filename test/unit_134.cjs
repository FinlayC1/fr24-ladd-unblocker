// 1.3.4 - the OurAirports airports as FR24's own, everywhere:
//   - monitor: a heliport's helipads kept apart from runways and answered (oarwy.cjs, airport.cjs), its kind said; the
//     list says which have an ICAO code of their own (oaap.cjs r[10]); the runway log takes an OurAirports field's runways
//     as an FR24 airport's (rwylog.cjs)
//   - userscript: the FR24 airport their pages are made from is a big one of the country (oaPageRef - Blackpool, RAF
//     Woodvale's nearest, has no pages); their names as FR24 names places (Woodvale, not Southport); a helicopter down at
//     one is at that airport (learnSite); FR24's closest airports with those that have an ICAO code
//   - the page: every one of them in FR24's own tables of airports (playback, boards, panels look there); their country
//     and zone from FR24's own table when its list came from its cache; the window's "OurAirports code" and header line;
//     the runway section for heliports and helipads; their data page made from the page FR24's server sends, as it loads;
//     FR24's closest airports merged; the extension's word that FR24's server sent a typed address to its search
//   - extension: FR24's redirect seen (only seen) and told to the tab that asks
// usage: node test/unit_134.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon134-')); process.env.MON_PORT = '0';
global.fetch = async () => ({ status: 404, ok: false, headers: { get: () => null }, text: async () => '', json: async () => null });
const M = require('../monitor/monitor.cjs'), RW = require('../monitor/oarwy.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch (e) { /* not yet */ } await sleep(20); } return false; };

(async () => {
  // ---- 1. the monitor ---------------------------------------------------------------------------------------------------
  { const rcsv = ['"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"',
      '1,1,"EGLW",66,66,"CON",1,0,"H1",51.4697,-0.1795,,,,,,,,,', '2,1,"EGLW",40,40,"ASP",0,1,"H2",,,,,,,,,,,', '3,2,"EGXX",3000,100,"GRS",0,0,"09",,,,,,"27",,,,,', '4,2,"EGXX",50,50,"CON",0,0,"H1",,,,,,,,,,,'].join('\n') + '\n';
    const d = RW.build(rcsv, '', '');
    check('a heliport\'s helipads kept apart from runways - ident, size, surface, lights, closed, where - never a runway (the engine and the runway log never see them)', JSON.stringify(d.pads.EGLW) === JSON.stringify([['H1', 66, 66, 'CONC', 'CON', 1, 0, 51.4697, -0.1795], ['H2', 40, 40, 'ASPH', 'ASP', 0, 1, null, null]]) && !d.info.EGLW && d.info.EGXX.length === 1 && d.pads.EGXX.length === 1, d.pads);
    const pads = JSON.parse(fs.readFileSync(path.join(DATA, 'pads.json'), 'utf8'));
    check('... the checkout\'s data: the helipads of thousands of heliports (pads.json)', Object.keys(pads).length > 5000, Object.keys(pads).length);
    const rows = M.OAAP.rows(), wood = rows.find(r => r[2] === 'EGOW'), gps = rows.find(r => r[2] === '48ID'), axis = rows.find(r => r[2] === 'GB-1368');
    check('the list says which have an ICAO code of their own: RAF Woodvale (EGOW) yes; a field known by its GPS code (48ID) and one by OurAirports\' alone (GB-1368) no', wood && wood[10] === 1 && gps && gps[10] === 0 && axis && axis[10] === 0, [wood && wood[10], gps && gps[10], axis && axis[10]]);
    const heli = rows.find(r => r[9] === 'H' && pads[String(r[2]).toUpperCase()] && !E.byId(r[0]));
    const now = Math.floor(Date.now() / 1000), a = heli ? M.airportAnswer(heli[0], now, 7, 14) : null;
    check('a heliport\'s airport answer: its pads and its kind', !!a && a.known && a.kind === 'H' && Array.isArray(a.pads) && a.pads.length >= 1 && a.pads[0][0].startsWith('H'), heli && { code: heli[1], a: a && { kind: a.kind, pads: a.pads } });
    const w = M.airportAnswer(wood[0], now, 7, 14);
    check('... an airfield\'s: its runways, no pads', w.known && w.runways.length === 3 && Array.isArray(w.pads) && w.pads.length === 0, { r: w.runways.length, p: w.pads });
    // (a landing on RAF Woodvale's runway 21, FR24's track of it: logged as an FR24 airport's runway is)
    const woodAp = E.byIcao('EGOW'), thr = [53.5882, -3.05133], hdg = 213, t0 = now - 3600, pts = [];
    for (let k = 40; k >= 0; k--) { const [la, lo] = E.destPoint(thr[0], thr[1], (hdg + 180) % 360, k * 0.25); pts.push({ t: t0 + (40 - k) * 8, lat: la, lon: lo, alt: Math.round(37 + k * 0.25 * 300 / 1.852 / 1.6), gs: 90, trk: hdg, gnd: false }); }
    for (let k = 1; k <= 6; k++) { const [la, lo] = E.destPoint(thr[0], thr[1], hdg, k * 0.15); pts.push({ t: t0 + 320 + k * 8, lat: la, lon: lo, alt: 0, gs: 60 - k * 8, trk: hdg, gnd: true }); }
    const n = M.RL.fromTrack('a1b2c3', pts, 'trail'), mv = M.RL.movements(woodAp.id, now - 7200, now);
    check('the runway log: a landing at RAF Woodvale (an OurAirports field) logged with its runway, 21 - as at FR24\'s own airports (1.3.2 looked at FR24\'s alone: its runway usage stayed empty)', n === 1 && mv.length === 1 && mv[0][0] === '21' && mv[0][1] === 1, { n, mv });
  }

  // ---- 2. the extension's background: FR24's redirect seen, told to the tab that asks --------------------------------
  { const ls = { redirect: null, msg: [] };
    // (Chrome's API as far as the background script uses it: every other event one that takes listeners and never fires)
    const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'addListener' ? () => {} : any()), apply: () => undefined });
    const fill = o => new Proxy(o, { get: (t, k) => (k in t ? t[k] : any()) });
    const chrome = fill({ runtime: fill({ id: 'ext1', onMessage: { addListener(f) { ls.msg.push(f); } }, getURL: x => x, reload() {}, lastError: null, getManifest: () => ({ version: '1' }) }),
      webRequest: { onBeforeRedirect: { addListener(f, filter) { ls.redirect = f; ls.filter = filter; } } } });
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8'), { chrome, URL, setTimeout, clearTimeout, console, fetch: global.fetch, AbortController, btoa: s => Buffer.from(s, 'binary').toString('base64') });
    const ask = (tab, from) => new Promise(res => { let got = false; for (const f of ls.msg) { const r = f({ tlOaFrom: true }, { id: from || 'ext1', tab: { id: tab } }, v => { got = true; res(v); }); void r; } setTimeout(() => { if (!got) res(undefined); }, 50); });
    ls.redirect({ url: 'https://www.flightradar24.com/data/airports/egow/statistics?x=1', redirectUrl: 'https://www.flightradar24.com/data/airports', tabId: 7, type: 'main_frame' });
    ls.redirect({ url: 'https://www.flightradar24.com/data/airports/lpl', redirectUrl: 'https://www.flightradar24.com/data/airports/lpl/', tabId: 8, type: 'main_frame' });
    const a1 = await ask(7), a2 = await ask(7), a3 = await ask(8), a4 = await ask(7, 'other');
    check('the extension: an airport page\'s address FR24\'s server sent on to its airport search - seen, and told once to that tab that asks; any other redirect not; another extension never told', a1 === '/data/airports/egow/statistics?x=1' && a2 === '' && a3 === '' && a4 === undefined && JSON.stringify(ls.filter.types) === '["main_frame"]', [a1, a2, a3, a4]);
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist', 'extension', 'manifest.json'), 'utf8'));
    check('... its manifest asks for webRequest (to see - never to block or change: no webRequestBlocking, no declarativeNetRequest)', JSON.stringify(man.permissions) === '["webRequest"]', man.permissions);
  }

  let JSDOM = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); } catch (e) { console.log('(skipped the browser: no jsdom)'); }
  if (!JSDOM) { console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0); }
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
  const AIRPORTS = JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows;
  const OAROWS = M.OAAP.rows();

  // ---- 3. the userscript: pages, names, landings, closest airports ----------------------------------------------------
  { const w = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53.5,-3.0/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
    w.GM_xmlhttpRequest = o => { setTimeout(() => o.onload && o.onload({ status: 404, responseText: '', response: '' }), 2); return { abort() {} }; };
    w.unsafeWindow = w; w.GM_notification = () => {}; w.console.debug = () => {}; w.console.log = () => {}; w.fetch = () => Promise.resolve(new Response('', { status: 404 }));
    w.eval(SRC);
    await until(() => w.__tweeksLadd && w.__tweeksLadd.oaTest, 8000);
    const T = w.__tweeksLadd.oaTest;
    T.buildAirports(AIRPORTS); T.oaSet({ rows: OAROWS, n: OAROWS.length, at: 1 });
    const row = c => OAROWS.find(r => r[2] === c || r[1] === c), wood = row('EGOW'), axis = row('GB-1368'), big = id => (AIRPORTS.find(a => a.id === id) || {});
    const ref = T.oaPageRef(wood[5]), refAp = AIRPORTS.find(a => String(a.iata || a.icao).toLowerCase() === ref);
    check('RAF Woodvale\'s pages made from a big FR24 airport of its country - not its nearest, Blackpool, which FR24\'s server has no page of ("More" ended on its airport search)', big(wood[5]).iata === 'BLK' && ref !== 'blk' && refAp && refAp.size >= 10000 && refAp.countryId === big(wood[5]).countryId, { nearest: big(wood[5]).iata, ref, size: refAp && refAp.size });
    check('its place as FR24 names places: Woodvale - not OurAirports\' town for it, Southport', T.oaCity(wood) === 'Woodvale' && T.oaAp(wood[0]).city === 'Woodvale' && T.oaAp(wood[0]).town === 'Southport', [T.oaCity(wood), T.oaAp(wood[0]).town]);
    const id1 = T.oaIdNear(axis[6] + 0.001, axis[7] + 0.001, 0.35), id2 = T.learnSite(axis[6] + 0.0015, axis[7], { heli: true });
    check('a helicopter down at Axis Business Park\'s helipad: at that airport (M-SKTO\'s landings were "-" in playback) - FR24 can be given it', id1 === axis[0] && id2 === axis[0] && T.fr24Ap(axis[0]) === axis[0] && T.apById(axis[0]).name === 'Axis Business Park Helipad', [id1, id2]);
    const lpl = AIRPORTS.find(a => a.iata === 'LPL'), c = T.closestOf(T.apById(lpl.id), 5), oaIn = c.items.filter(x => x.id >= 1e7);
    const anyNoIcao = c.items.some(x => x.id >= 1e7 && !OAROWS.find(r => r[0] === x.id)[10]);
    check('Liverpool\'s closest airports: FR24\'s own and the OurAirports airports with an ICAO code of their own, nearest first, five - none known only by a local or OurAirports code', c.items.length === 5 && !anyNoIcao && c.items.every((x, i) => i === 0 || x.distanceKm >= c.items[i - 1].distanceKm) && c.items.every(x => x.url === '/data/airports/' + String(x.iata || x.icao).toLowerCase()) && c.oa.length === oaIn.length && c.oa.every(o => o.ref && o.near), c.items.map(x => [x.iata, x.distanceKm]));
    const wc = T.closestOf(T.apById(wood[0]), 5);
    check('... RAF Woodvale\'s (an OurAirports airport\'s own page): FR24\'s airports near it and its ICAO neighbours - itself not among them', wc.items.length === 5 && !wc.items.some(x => x.id === wood[0]) && wc.items.some(x => x.iata === 'LPL' || x.iata === 'BLK'), wc.items.map(x => [x.iata, x.distanceKm]));
    w.close(); }

  // ---- 4. the page's part ---------------------------------------------------------------------------------------------------
  const PI = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0];
  const page = (url, html, before) => {
    const w = new JSDOM(html || '<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window; let H = null; const posts = [], fetched = [];
    w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob;
    w.fetch = u => { fetched.push(String(u)); return Promise.reject(new Error('offline')); }; w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
    if (before) before(w);
    w.eval('(' + PI + ')()');
    return { w, H: () => H, posts, fetched, send: data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' })) };
  };
  const ROWS = [[17000001, 'EGXX', 'EGXX', 'RAF Walney', 'Barrow-in-Furness, Cumbria', 530, 54.2, -3.2, 50, 'S', 1], [17000002, 'GB-0999', 'GB-0999', 'Some Helipad', 'Ulverston', 530, 54.19, -3.09, 30, 'H', 0], [17000003, 'GB-0998', 'GB-0998', 'Big Heliport', '', 530, 54.1, -3.3, 0, 'H', 0]];
  const store530 = { id: 530, iata: 'BWF', icao: 'EGNL', name: 'Barrow', city: 'Barrow', latitude: 54.13, longitude: -3.26, altitude: 39, country: 'United Kingdom', countryId: 235, size: 3000, timezoneName: 'Europe/London', timezoneCode: 'GMT', timezoneDST: false, timezoneOffset: 0, timezoneOffsetHours: '0:00', videoStream: null };
  // (FR24's airports store, its tables wrapped as Vue wraps them: a change through the wrapper counted)
  const vueWrap = (m, cnt) => { const p = new Proxy(m, { get(t, k) { if (k === '__v_raw') return t; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; } }); const set = p.set; void set; return new Proxy(p, { get(t, k) { if (k === 'set') return (a, b) => { cnt.n++; return m.set(a, b); }; return Reflect.get(t, k); } }); };
  { const P = page('https://www.flightradar24.com/54.15,-3.20/10'), H = P.H(), cnt = { n: 0 };
    const own = [store530].concat(Array.from({ length: 150 }, (_, i) => Object.assign({}, store530, { id: 1000 + i, iata: 'A' + i }))), old = Object.assign({}, store530, { id: 17000001, iata: 'EGXX', city: 'Barrow-in-Furness' });
    const byId = new Map(own.map(a => [a.id, a]).concat([[17000001, old]])), byIata = new Map(own.map(a => [a.iata, a]));
    const store = { airports: own.slice(), airportsById: vueWrap(byId, cnt), airportsByIata: vueWrap(byIata, cnt) };
    P.w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['airports', store]]) } } } };
    // (FR24's list read from its cache: never past here - the airports' country and zone from FR24's own table)
    H.acceptOa({ rows: ROWS, sig: '3.1', refs: { 530: 'man' } });
    await until(() => byId.has(17000003), 3000); await sleep(30);
    const e1 = byId.get(17000001), e2 = byId.get(17000002);
    check('every one of them in FR24\'s own tables of airports, by id and by code - not only those its map shows (playback, boards and panels look there: "-" otherwise)', byId.has(17000002) && byId.has(17000003) && byIata.get('GB-0999') === e2 && byIata.get('EGXX') === e1 && store.airports.every(a => a.id < 1e7), [...byId.keys()].filter(k => k >= 1e7));
    check('... put in the tables themselves, not through FR24\'s reactive wrapper (63,000 changes would each wake its map); theirs as the list has them now - an older one replaced', cnt.n === 0 && e1 !== old && e1.city === 'Walney', { through: cnt.n, city: e1.city });
    check('... their country and time zone from FR24\'s own table when its list came from its cache (1.3.2: no country - no flag - and UTC)', e2.countryId === 235 && e2.country === 'United Kingdom' && e2.timezoneName === 'Europe/London', { c: e2.countryId, tz: e2.timezoneName });
    // (FR24's airport database, as its aircraft panel and its playback ask it: by id - and by code)
    const db = { byCodeOrId: async () => null, byId: async id => (id === 530 ? store530 : null), byIATA: async () => null, byICAO: async () => null };
    H.mxPatchCore({ zz: db });
    const b1 = await db.byId(17000002), b0 = await db.byId(530), b9 = await db.byId(424242), bc = await db.byICAO('GB-0999'), bi = await db.byIATA('EGXX');
    check('FR24\'s airport database asked by id - its aircraft panel and playback ask so (M-SKTO\'s landings at Axis Business Park\'s helipad were "-"): theirs answered, FR24\'s own its own, nothing made up for an id that is no airport', b1 && b1.id === 17000002 && b1.name === 'Some Helipad' && isFinite(b1.latitude) && b0 === store530 && b9 === null && bc && bc.id === 17000002 && bi && bi.id === 17000001, [b1 && b1.name, b9]);
    // (their code line - the window's line under the name, the pins' labels: ICAO or OurAirports' code, " / " a real IATA only)
    const lines = [H.oaCodeLine(ROWS[0]), H.oaCodeLine(ROWS[1]), H.oaCodeLine([17000009, 'WSX', 'EGWS', 'Far Field', '', 530, 54, -3, 0, 'S', 1])];
    const pin1 = P.w.eval("['EGXX', 'EGXX'].join(' / ')"), pin2 = P.w.eval("['GB-0999', 'GB-0999'].join(' / ')"), pin3 = P.w.eval("['BWF', 'EGNL'].join(' / ')"), other = P.w.eval("[1, 2, 3].join(' / ') + '|' + ['a', 'b'].join('-')");
    check('their code line: their ICAO or OurAirports code alone - "/ IATA" only after a real IATA code (never the code twice, never "/ null"); the pins\' labels the same; FR24\'s own and every other join as they are', JSON.stringify(lines) === '["EGXX","GB-0999","EGWS / WSX"]' && pin1 === 'EGXX' && pin2 === 'GB-0999' && pin3 === 'BWF / EGNL' && other === '1 / 2 / 3|a-b', [lines, pin1, pin2, pin3, other]);
    // (one FR24's own list has now - its list grew since the monitor's copy: left to FR24)
    H.noteFr24Codes([{ id: 3001, iata: 'EGXX', icao: 'EGXX' }]);
    check('one FR24\'s own list has now (London Heliport): left to FR24 - no pin of theirs beside FR24\'s, no answer of theirs', H.oaDupe(ROWS[0]) === true && H.oaDupe(ROWS[1]) === false);
    const eng = require('../src/engine.js').createRouteEngine();
    const names = ['RAF Woodvale', 'Sywell Aerodrome', 'Damyns Hall Airfield', 'Kaneohe Bay MCAS (Marion E. Carl Field) Airport', 'Axis Business Park Helipad', 'London Heliport', 'Old Sarum Airfield (disused)', 'Ince Blundell'];
    check('names as FR24 names places: the page\'s own the same as the route engine\'s, name by name', names.every(n => H.fieldShortName(n) === eng.fieldShortName(n)), names.map(n => [H.fieldShortName(n), eng.fieldShortName(n)]));
    // (its window: FR24's header line, its code field)
    const doc = P.w.document, panel = doc.createElement('article'); panel.setAttribute('data-testid', 'airport-panel');
    panel.innerHTML = '<header><h1>RAF Walney</h1><section><img data-testid="airport-panel__header__flag"><div><span data-testid="airport-panel__header__codes">EGXX / EGXX</span></div></section></header><dl><div><dt><span><span>IATA code</span></span></dt><dd>EGXX</dd></div><div><dt><span>ICAO code</span></dt><dd>EGXX</dd></div></dl>';
    doc.body.appendChild(panel);
    const codes = () => panel.querySelector('[data-testid="airport-panel__header__codes"]').textContent, lab = () => panel.querySelector('dt').textContent;
    H.panelCodeFields(panel, 'EGXX');
    const c1 = [codes(), lab()];
    panel.querySelector('[data-testid="airport-panel__header__codes"]').firstChild.data = 'GB-0999 / null'; H.panelCodeFields(panel, 'GB-0999');
    const c2 = [codes(), lab()];
    panel.querySelector('[data-testid="airport-panel__header__codes"]').firstChild.data = 'BWF / EGNL'; H.panelCodeFields(panel, 'BWF');
    const c3 = [codes(), lab()];
    check('the window: "OurAirports code" over the code of one with no ICAO code (1.3.6: one with an ICAO code keeps FR24\'s "IATA code"); the header\'s line under the name - beside FR24\'s flag - its code (and its ICAO code where that is another); FR24\'s airports as FR24 writes them', JSON.stringify(c1) === '["EGXX","IATA code"]' && JSON.stringify(c2) === '["GB-0999","OurAirports code"]' && JSON.stringify(c3) === '["BWF / EGNL","IATA code"]', [c1, c2, c3]);
    // (which airport the window is open on: FR24's own store says, whatever the address)
    store.airport = { info: { id: 17000002, iata: 'GB-0999' } };
    P.w.history.pushState({}, '', '/N123AB/3a1b2c3d');
    const pnl = doc.createElement('div'); pnl.setAttribute('data-testid', 'airport-panel');
    pnl.innerHTML = '<section><h2>Runway details</h2><div><button class="promo"><picture data-testid="airport-panel__promo-runway_details"><img alt="x"></picture></button></div></section>'; panel.remove(); doc.body.appendChild(pnl);
    const promo = pnl.querySelector('button.promo'), mine = () => (pnl.querySelector('.tl-rwy') || {}).textContent || '';
    H.acceptAirportPanel({ code: 'GB-0999', apId: 17000002, monitor: true, runways: [], freqs: [], usage: [], pads: [], kind: 'H', name: 'Some Helipad' });
    check('the window open on an airport the address does not name: found by FR24\'s own store; a helipad with no pads: said to be a helipad, no runways - never the padlock', /This is a helipad/.test(mine()) && promo.style.display === 'none', mine());
    store.airport = { info: { id: 17000003, iata: 'GB-0998' } };
    H.acceptAirportPanel({ code: 'GB-0998', apId: 17000003, monitor: true, runways: [], freqs: [], usage: [], pads: [['H1', 66, 66, 'CONC', 'CON', 1, 0, 54.1, -3.3], ['H2', 40, 40, 'ASPH', 'ASP', 0, 1, null, null]], kind: 'H', name: 'Big Heliport' });
    check('... a heliport: its helipads listed - each one\'s size, surface, lights', /Helipads/.test(mine()) && /H1/.test(mine()) && /20 × 20/.test(mine()) && /H2 \(closed\)/.test(mine()) && /Concrete/.test(mine()), mine());
    H.acceptAirportPanel({ code: 'GB-0998', apId: 17000003, monitor: true, runways: [], freqs: [], usage: [], pads: [], kind: 'H', name: 'Big Heliport' });
    const t3 = mine();
    store.airport = { info: { id: 17000001, iata: 'EGXX' } };
    H.acceptAirportPanel({ code: 'EGXX', apId: 17000001, monitor: true, runways: [], freqs: [], usage: [], pads: [], kind: 'S', name: 'RAF Walney' });
    check('... a heliport none of whose pads is known: said so; an airfield with no runway known: "Runway details not available."', /This is a heliport/.test(t3) && /Runway details not available\./.test(mine()), [t3, mine()]);
    // (their details asked for, a link to their page pressed: kept here, for their page to be made at once)
    await (await P.w.fetch('https://www.flightradar24.com/api/v1/airports/17000002')).json();
    const kept = H.oaOneGet('gb-0999');
    check('one\'s window opened: kept in this browser - its row, the FR24 airport its pages are made from, its nearest', !!kept && kept.ref === 'man' && kept.row[0] === 17000002 && kept.near && kept.near.id === 530, kept && { ref: kept.ref, near: kept.near && kept.near.id });
    P.w.close(); }

  // (their data page made from the page FR24's server sends for the FR24 airport they are made from - as it loads)
  const lplPage = { component: 'Data/Airport', url: '/data/airports/man', version: 'v1', props: { airport: { id: 2095, name: 'Manchester Airport', city: 'Manchester', iata: 'MAN', icao: 'EGCC', countryId: 235, countryName: 'United Kingdom', timezone: 'Europe/London', elevationFt: 257, latitude: 53.35, longitude: -2.27 }, photos: [{ x: 1 }], weather: { t: 1 }, boards: { departures: { flights: [{ id: 1 }] } }, closestAirports: [{ id: 2002, iata: 'LPL', distanceKm: 38 }], runways: [], locked: { runways: true }, content: { about: 'x' }, dispatcher: { features: {} } } };
  const esc = o => JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  { const one = { row: ROWS[0], ref: 'man', near: { id: 530, iata: 'BWF', country: 'United Kingdom', countryId: 235, timezone: { name: 'Europe/Dublin', offset: 0, offsetHours: '0:00', abbr: 'GMT', isDst: false } }, at: Date.now() };
    const P = page('https://www.flightradar24.com/data/airports/man?tl-oa=egxx', `<!doctype html><html><head></head><body><div id="app" data-page="${esc(lplPage)}"></div></body></html>`, w => { w.localStorage.setItem('tl.oa.one.egxx', JSON.stringify(one)); });
    const pg = JSON.parse(P.w.document.getElementById('app').getAttribute('data-page'));
    check('an OurAirports airport\'s data page, kept here from before: made from the page FR24\'s server sent, before FR24\'s app reads it - its own airport, its own address, nothing of Manchester\'s; no second load, nothing hidden meanwhile (1.3.3: loaded, then asked for again)', pg.props.airport.id === 17000001 && pg.props.airport.name === 'RAF Walney' && pg.url === '/data/airports/egxx' && P.w.location.pathname === '/data/airports/egxx' && !/tl-oa/.test(P.w.location.search) && pg.props.photos.length === 0 && pg.props.boards.departures.flights.length === 0 && pg.props.closestAirports.length === 0 && P.fetched.length === 0 && !P.w.document.getElementById('tl-oa-hide') && P.H().oaFast().code === 'egxx', { ap: pg.props.airport.name, url: pg.url, path: P.w.location.pathname, fetched: P.fetched });
    check('... its time zone its nearest FR24 airport\'s; its country the page\'s (the same country)', pg.props.airport.timezone === 'Europe/Dublin' && pg.props.airport.countryId === 235, pg.props.airport);
    // (FR24's closest airports and ours, in one)
    const p = { airport: { id: 2002 }, closestAirports: [{ id: 608, distanceKm: 19 }, { id: 8723, distanceKm: 34 }, { id: 2095, distanceKm: 38 }, { id: 7364, distanceKm: 46 }, { id: 409, distanceKm: 50 }] };
    P.H().closestMerge(p, { closest: [{ id: 17000001, distanceKm: 30, iata: 'EGXX' }, { id: 608, distanceKm: 19 }, { id: 2002, distanceKm: 0 }] });
    check('FR24\'s closest airports with those of the OurAirports airports with an ICAO code: none twice, never the airport itself, nearest first, as many as FR24 shows', JSON.stringify(p.closestAirports.map(x => x.id)) === '[608,17000001,8723,2095,7364]', p.closestAirports.map(x => [x.id, x.distanceKm]));
    P.w.close(); }
  { // (FR24's airport search, the extension saying FR24's server sent this tab there from one of theirs)
    const went = [], one = { row: ROWS[1], ref: 'man', near: null, at: Date.now() };
    const A = page('https://www.flightradar24.com/data/airports', null, w => { w.localStorage.setItem('tl.oa.one.gb-0999', JSON.stringify(one)); });
    A.H().setOaNav(u => went.push(u));
    A.send({ __tweeksLadd: 'oaFrom', path: '/data/airports/gb-0999/statistics' });
    const B = page('https://www.flightradar24.com/data/airports', null); const went2 = []; B.H().setOaNav(u => went2.push(u));
    B.send({ __tweeksLadd: 'oaFrom', path: '/data/airports/egxx' });
    const hidden = !!B.w.document.getElementById('tl-oa-hide');
    B.send({ __tweeksLadd: 'oaIs', row: ROWS[0], ref: 'man', near: null });
    const C = page('https://www.flightradar24.com/data/airports/lpl', null); const went3 = []; C.H().setOaNav(u => went3.push(u));
    C.send({ __tweeksLadd: 'oaFrom', path: '/data/airports/egxx' });
    check('a typed address FR24\'s server sent to its airport search (the extension saw it): on to the airport\'s page at once when kept here; else hidden until the userscript says what it is, then on; never from any other page', JSON.stringify(went) === '["/data/airports/man/statistics?tl-oa=gb-0999"]' && hidden && JSON.stringify(went2) === '["/data/airports/man?tl-oa=egxx"]' && went3.length === 0, [went, went2, went3]);
    A.w.close(); B.w.close(); C.w.close(); }

  // ---- 5. FR24's searches and its airport lists -------------------------------------------------------------------------------
  { const P = page('https://www.flightradar24.com/data/airports/lpl'), H = P.H();
    // (the matching: the page's and the userscript's the same code)
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '03-data.js'), 'utf8'), pageSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'page.js'), 'utf8');
    const blk = x => ((x.match(/==OA-MATCH==\n([\s\S]*?)\n\s*\/\/ ==\/OA-MATCH==/) || [])[1] || '').replace(/^\s+/gm, '');
    check('the matching of a search: the page\'s and the userscript\'s the same code', blk(src).length > 100 && blk(src) === blk(pageSrc));
    const rows = OAROWS, sz = r => ({ L: 6, M: 5, S: 3, W: 2, H: 1, B: 0 }[r[9]] || 0);
    const m1 = H.oaMatchRows(rows, 'egow', 10, sz), m2 = H.oaMatchRows(rows, 'woodvale', 10, sz), m3 = H.oaMatchRows(rows, 'gb-1368', 10, sz), m4 = H.oaMatchRows(rows, 'axis business', 10, sz), m5 = H.oaMatchRows(rows, 'e', 10, sz);
    check('searching them: by ICAO code (EGOW), by name (Woodvale), by OurAirports\' code (GB-1368), by part of a name; one letter never', m1[0] && m1[0][2] === 'EGOW' && m2.some(r => r[2] === 'EGOW') && m3[0] && m3[0][2] === 'GB-1368' && m4.some(r => r[2] === 'GB-1368') && m5.length === 0, [m1.map(r => r[1]).slice(0, 3), m2.map(r => r[1]).slice(0, 3)]);
    const fr = { results: [{ id: 'LPL', label: 'Liverpool John Lennon Airport (LPL / EGGP)', detail: { size: 25707 }, type: 'airport', match: 'contains', name: 'Liverpool' }, { id: 'abc', type: 'live', label: 'X', detail: {} }], stats: { total: { all: 2, airport: 1, live: 1 }, count: { airport: 1, live: 1 } } };
    const other = m2.filter(r => r[2] !== 'EGOW').slice(0, 1), j = H.searchMerge(JSON.parse(JSON.stringify(fr)), [m1[0]].concat(other), 'egow');
    const nAp = j.results.filter(x => x.type === 'airport').length;
    check('FR24\'s search box: theirs among its airports in its own form - the exact code first, "Name (CODE)" - its counts raised; the flights it found kept', j.results[0].id === 'EGOW' && j.results[0].label === 'RAF Woodvale (EGOW)' && j.results[0].type === 'airport' && j.results[0].match === 'icao' && j.results[1].id === 'LPL' && j.results[j.results.length - 1].type === 'live' && j.stats.total.airport === nAp && j.stats.total.all === nAp + 1, j.results.map(x => x.id + ':' + x.match));
    const a = H.apSearchMerge({ data: [{ id: 2002, iata: 'LPL', icao: 'EGGP', name: 'Liverpool', countryId: 235 }] }, [m1[0]]);
    check('... an airport page\'s own search: theirs too - its code what the link goes by', a.data.length === 2 && a.data[1].iata === 'EGOW' && a.data[1].icao === 'EGOW' && a.data[1].name === 'RAF Woodvale', a.data[1]);
    P.w.close(); }
  { // (FR24's airport lists: a country's count, a country's list, a state's)
    const mk = (component, props) => { const P = page('https://www.flightradar24.com/data/airports'); const gp = { $page: { component, props }, $inertia: {} }; P.w.document.getElementById('app').__vue_app__ = { config: { globalProperties: gp } }; return { P, H: P.H(), props, send: P.send }; };
    const A = mk('Data/Airports', { airportsByCountry: [{ id: 235, name: 'United Kingdom', total: 120 }, { id: 76, name: 'France', total: 90 }] });
    A.H.dirTick(); const askA = A.P.posts.find(p => p.__tweeksLadd === 'oaDir');
    A.send({ __tweeksLadd: 'oaDirGot', key: askA.key, counts: { 235: 1500, 76: 0 } });
    check('FR24\'s airport lists: each country\'s count with theirs', askA.kind === 'counts' && A.props.airportsByCountry[0].total === 1620 && A.props.airportsByCountry[1].total === 90, A.props.airportsByCountry);
    A.P.w.close();
    const B = mk('Data/AirportsByCountry', { country: { id: 235, name: 'United Kingdom', slug: 'united-kingdom' }, airports: [{ id: 2002, name: 'Liverpool', iata: 'LPL', icao: 'EGGP', total: 300 }] });
    B.H.dirTick(); const askB = B.P.posts.find(p => p.__tweeksLadd === 'oaDir');
    B.send({ __tweeksLadd: 'oaDirGot', key: askB.key, airports: [{ id: 17000001, name: 'RAF Walney', iata: 'EGXX', icao: 'EGXX', total: 0 }, { id: 2002, name: 'dup', iata: 'LPL', icao: '', total: 0 }], rows: [ROWS[0]], refs: { 530: 'man' }, nears: {} });
    check('... a country\'s list: theirs among its airports, none twice - and their links known here, to go straight to their pages', askB.kind === 'country' && askB.name === 'United Kingdom' && B.props.airports.length === 2 && B.props.airports[1].iata === 'EGXX' && !!B.H.oaPageReq('/data/airports/egxx'), B.props.airports.map(x => x.iata));
    B.P.w.close();
    const C = mk('Data/AirportsByCountry', { country: { id: 225, name: 'United States', slug: 'united-states' }, states: [{ code: 'ID', name: 'Idaho', total: 40, url: '/data/airports/united-states/idaho' }, { code: 'TX', name: 'Texas', total: 300, url: '/data/airports/united-states/texas' }] });
    C.H.dirTick(); const askC = C.P.posts.find(p => p.__tweeksLadd === 'oaDir');
    C.send({ __tweeksLadd: 'oaDirGot', key: askC.key, states: { ID: 250, TX: 1900 } });
    check('... a country of states: each state\'s count with theirs', askC.hasStates === true && C.props.states[0].total === 290 && C.props.states[1].total === 2200, C.props.states.map(s => s.total));
    const D = mk('Data/AirportsByState', { country: { name: 'United States', slug: 'united-states' }, state: { name: 'Idaho', slug: 'idaho' }, airports: [] });
    D.P.w.localStorage.setItem('tl.oa.states.united-states', C.P.w.localStorage.getItem('tl.oa.states.united-states'));
    D.H.dirTick(); const askD = D.P.posts.find(p => p.__tweeksLadd === 'oaDir');
    check('... a state\'s page asks for that state\'s - by the code its country\'s page gave it', !!askD && askD.kind === 'state' && askD.code === 'ID', askD);
    C.P.w.close(); D.P.w.close(); }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
