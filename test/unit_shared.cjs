// 22.25 - what one browser works out reaches every other, through the shared monitor: the BUILT userscript in jsdom, two
// browsers (two windows, two addresses) with the real monitor code between them, offline. The route a browser works out
// for a flight the monitor names - in the other browser at once, the flight on the map or opened, marked as another
// browser's; a destination confirmed in one confirmed in all, and standing; never sent back. The flights a browser
// learns from - to the monitor, into every browser's engine with the next /learned, counted once; one the monitor did
// not take learned on in that browser. And a playback flight the monitor has no name for yet - asked about again,
// named once the monitor has worked it out.
// usage: node test/unit_shared.cjs <node_modules dir> <data dir>
const fs = require('fs');
const path = require('path');
const os = require('os');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 50; i++) { const v = await f(); if (v) return v; await sleep(50); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8'), OA = fs.existsSync(path.join(DATA, 'oa_airports.csv')) ? fs.readFileSync(path.join(DATA, 'oa_airports.csv'), 'utf8') : '';
const RWY = JSON.parse(fs.readFileSync(path.join(DATA, 'runways.json'), 'utf8')), RWL = fs.existsSync(path.join(DATA, 'runway_len.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'runway_len.json'), 'utf8')) : null;

// ---- the monitor: the real code, its own requests unanswered
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monshared-'));
global.fetch = async () => ({ status: 404, text: async () => '' });
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
const reports = [], pbAsks = [];
const mode = { old: false, down: false };   // (a monitor from before 22.25: no word of the flights it learned; one not answering)
async function monitor(url, headers, o, ip) {
  const u = new URL(url), ctx = { admin: headers['X-Monitor-Token'] === 'tok', ip };
  if (o && o.method === 'POST') {
    let d; try { d = JSON.parse(o.data || '{}'); } catch (e) { return { status: 400, text: '' }; }
    if (u.pathname === '/report') {
      if (mode.down) return { status: 503, text: '' };
      const rep = M.report(d, Date.now(), ctx); reports.push({ ip, d, rep });
      if (mode.old) { delete rep.learned; delete rep.learnNot; delete rep.routes; }
      return { status: 200, text: JSON.stringify(rep) };
    }
    if (u.pathname === '/pbmatch') { pbAsks.push({ ip, d }); return { status: 200, text: JSON.stringify({ v: 1, t: +d.t || 0, list: M.pbMatch(+d.t || 0, d.f) }) }; }
    return { status: 404, text: '' };
  }
  const b = await M.answer(u, Date.now() / 1000, ctx);
  return b ? { status: 200, text: typeof b.raw === 'string' ? b.raw : JSON.stringify(b) } : { status: 404, text: '' };
}
// ---- each browser's network (nothing leaves this process)
function makeNet(ip) {
  const asked = [];
  const answer = (url, headers, o) => {
    asked.push({ url, headers: headers || {} });
    if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return { status: 200, text: AIRPORTS };
    if (/ourairports-data\/main\/airports\.csv/.test(url)) return { status: OA ? 200 : 404, text: OA };
    if (/^https:\/\/mon\.test\//.test(url)) return monitor(url, headers || {}, o, ip);
    if (/127\.0\.0\.1:47524/.test(url)) return { status: 0, error: true };
    return { status: 404, text: '' };
  };
  return { ip, asked, answer };
}
function makeWin(net, idb) {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/50.00,-30.00/6', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = idb; win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; return Promise.resolve(net.answer(u, init && init.headers)).then(a => new Response(a.text || '', { status: a.status || 404 })); };
  win.GM_xmlhttpRequest = o => {
    Promise.resolve(net.answer(o.url, o.headers, o)).then(a => setTimeout(() => { if (a.error) o.onerror && o.onerror({ error: 'refused' }); else o.onload && o.onload({ status: a.status, responseText: a.text, response: a.text }); }, 2), e => o.onerror && o.onerror({ error: String(e) }));
    return { abort() {} };
  };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.__posted = []; win.postMessage = data => { win.__posted.push(data); };
  win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}
async function boot(net, idb) {
  const w = makeWin(net, idb);
  await until(() => w.__tweeksLadd && w.__tweeksLadd.engine.airports.length > 5000, 60000);
  const L = w.__tweeksLadd;
  L.engine.setRunways(RWY); if (RWL) L.engine.setRunwayLengths(RWL);
  await L.store.kvReady;
  L.store.kvSet('monRemote', { url: 'https://mon.test', token: '' });
  await L.monCheck(true).catch(() => {});
  return { w, L };
}
const feed = (w, flights) => w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'feed', flights, na: [], at: Date.now(), bg: false }, origin: 'https://www.flightradar24.com', source: w }));
const posted = (w, kind) => w.__posted.filter(m => m && m.__tweeksLadd === kind);
const lastReport = ip => { for (let i = reports.length - 1; i >= 0; i--) if (reports[i].ip === ip) return reports[i]; return null; };

(async () => {
  const IPA = '198.51.100.1', IPB = '198.51.100.2';
  const netA = makeNet(IPA), netB = makeNet(IPB), idbA = new FIDB.IDBFactory(), idbB = new FIDB.IDBFactory();
  const { w: A, L: LA } = await boot(netA, idbA), { w: B, L: LB } = await boot(netB, idbB);
  check('two browsers, each with the shared monitor (no secret: anyone\'s browser)', LA.monUp() && LB.monUp() && netA.asked.some(a => a.url === 'https://mon.test/status' && a.headers['X-Monitor-Client']), { a: LA.monUp(), b: LB.monUp() });
  const ap = c => { const a = LA.engine.byIcao(c); return a && E.byIcao(c) && E.byIcao(c).id === a.id ? a : null; };
  const LTN = ap('EGGW'), TEB = ap('KTEB'), BED = ap('KBED'), BOS = ap('KBOS'), BWF = ap('EGNL'), CMF = ap('LFLB'), WIC = ap('EGPC'), MAH = ap('LEMH');
  check('(the browsers\' airports and the monitor\'s are one list)', [LTN, TEB, BED, BOS, BWF, CMF, WIC, MAH].every(Boolean));

  // ---- a flight the monitor names, mid-Atlantic, westbound --------------------------------------------------------
  const nowS = Math.floor(Date.now() / 1000), ID = 0x7b000001, HEX = 'c20001';
  M.markBlocked(HEX, { reg: 'N910GA', type: 'GLF6' }, nowS);
  M.ident.observe([{ id: ID, lat: 50, lon: -30, alt: 41000, trk: 262, spd: 470, ts: nowS, gnd: false, src: 0, type: 'GLF6', reg: '', cs: '', icon: 0 }], Date.now(), 'scan');
  M.ident.assign(M.ident.flights.get(ID), HEX, { reg: 'N910GA', type: 'GLF6', ladd: true }, 'list', Date.now());
  for (const L of [LA, LB]) { L.srvIds.since = 0; await until(() => !L.srvIds.busy, 5000); await L.pullSrvIds(); }
  check('both browsers have the monitor\'s name for it, no browser\'s route yet', (LA.srvIds.rows.get(ID) || [])[1] === HEX && (LB.srvIds.rows.get(ID) || [])[24] === 0, LB.srvIds.rows.get(ID));
  const fl = { id: ID, lat: 50, lon: -30, alt: 41000, spd: 470, trk: 262, ts: nowS, gnd: false, src: 5, type: 'GLF6', reg: '' };
  feed(A, [fl]);
  await until(() => LA.live.has(ID), 3000);
  await until(() => !(LA.routeState.get(ID) || {}).working, 5000); await sleep(300);
  check('A has it on its map: identified from the monitor\'s name', (LA.live.get(ID) || {}).hex === HEX);
  check('... its own guess, made without the aircraft\'s log or its take-off, not sent (the monitor\'s rough one is as good)', !LA.routesOut.has(ID), LA.routesOut.get(ID));

  // ---- A opens it: its route, worked out with the aircraft's log, to the monitor -----------------------------------
  const ETA = nowS + 4 * 3600, ATD = nowS - 3 * 3600;
  const routeA = { computedAt: Date.now(), quick: false, originId: LTN.id, originIata: 'LTN', originConf: 'ground', originNote: 'departed LTN', destId: TEB.id, destIata: 'TEB', destConf: 'likely', destP: 85, destReason: 'its own log', eta: ETA, atd: ATD, departedAt: ATD, legCount: 14 };
  LA.publishRoute(ID, routeA);
  check('A\'s route (its engine with the aircraft\'s log): kept for the monitor - origin, destination, chance, word, ETA, departure', JSON.stringify(LA.routesOut.get(ID)) === JSON.stringify([ID, HEX, LTN.id, 'ground', TEB.id, 85, 'likely', ETA, ATD]), LA.routesOut.get(ID));
  await LA.reportToMonitor();
  let rep = lastReport(IPA);
  check('... sent with A\'s next report, taken by the monitor', !!rep && (rep.d.routes || []).length === 1 && rep.rep.routes === 1 && !LA.routesOut.has(ID), rep && { routes: rep.d.routes, taken: rep.rep.routes });
  LA.publishRoute(ID, Object.assign({}, routeA, { computedAt: Date.now() }));
  check('... and not again while it stays the same', !LA.routesOut.has(ID));

  // ---- B: the flight not on its map - the name and A's route together ----------------------------------------------
  await sleep(5); B.__posted.length = 0; await LB.pullSrvIds();
  const rB = (posted(B, 'routes').flatMap(m => m.list || []).find(x => x.id === ID) || {}).route;
  check('B: the name arrives with A\'s route, marked as another browser\'s (origin, destination, chance, ETA, departure)', !!rB && rB.originIata === 'LTN' && rB.destIata === 'TEB' && rB.destConf === 'likely' && rB.destP === 85 && rB.destReason === 'worked out by another browser' && rB.eta === ETA && rB.atd === ATD, rB);
  check('... the origin too', LB.srvRoute(LB.srvIds.rows.get(ID)).originNote === 'worked out by another browser');
  // (B's own engine on its own, for comparison: the same moment without A's route)
  const pos = { t: nowS, lat: 50, lon: -30, alt: 41000, trk: 262, gs: 470, gnd: false };
  const rowB = LB.srvIds.rows.get(ID), bare = rowB.slice(); bare[24] = 0; bare[25] = ''; bare[26] = 0; bare[8] = 0; bare[10] = 0;
  LB.srvIds.rows.set(ID, bare); const own = LB.composeRoute(ID, HEX, { pos }) || {}; LB.srvIds.rows.set(ID, rowB);
  // ---- B opens it: A's route in its panel ---------------------------------------------------------------------------
  B.__posted.length = 0; feed(B, [fl]);
  await until(() => LB.live.has(ID), 3000);
  const rB2 = LB.composeRoute(ID, HEX, { pos }) || {};
  check('B opens the flight before its own log of the aircraft is in: A\'s route in the panel (B\'s own guess was weaker)', rB2.destId === TEB.id && rB2.destReason === 'worked out by another browser' && rB2.destP === 85 && rB2.originId === LTN.id && rB2.originNote === 'worked out by another browser' && rB2.departedAt === ATD, { own: { dest: own.destIata, p: own.destP }, got: { dest: rB2.destIata, p: rB2.destP, why: rB2.destReason, o: rB2.originIata } });
  const pg = await until(() => posted(B, 'route').find(m => m.id === ID && m.route && m.route.destIata === 'TEB'), 3000);
  check('... and on its map at once, as identified', !!pg && pg.route.destReason === 'worked out by another browser', pg && pg.route);
  LB.publishRoute(ID, rB2);
  check('... never sent back from B (the parts that came from another browser left out: nothing of its own)', !LB.routesOut.has(ID), LB.routesOut.get(ID));
  // (A's origin, seen on the ground there, with a guess of B's own for the destination: the guess not sent either)
  { const x = Object.assign({}, rB2, { destId: BOS.id, destIata: 'BOS', destConf: 'possible', destP: 30, crowdD: false, computedAt: Date.now() });
    LB.publishRoute(ID, x);
    check('... nor a guess of B\'s own made without the log, though the origin it came with was seen', !LB.routesOut.has(ID), LB.routesOut.get(ID)); }
  // (an origin of B's own, worked out with the log, A's destination kept in B's panel: only the origin goes - and A's
  // destination stays with it at the monitor, for every other browser)
  { const x = Object.assign({}, rB2, { originId: WIC.id, originIata: 'WIC', originConf: 'likely', originNote: 'its own log', crowdO: false, legCount: 5, computedAt: Date.now() });
    LB.publishRoute(ID, x);
    check('an origin of B\'s own with the log, the destination A\'s: only the origin for the monitor', JSON.stringify((LB.routesOut.get(ID) || []).slice(2, 7)) === JSON.stringify([WIC.id, 'likely', 0, 0, '']), LB.routesOut.get(ID));
    await LB.reportToMonitor();
    const t = M.ident.table(0).rows.find(r => r[0] === ID) || [];
    check('... taken there, A\'s destination kept with it', (lastReport(IPB).rep || {}).routes === 1 && t[8] === WIC.id && t[26] === 1 && t[10] === TEB.id && t[11] === 85 && t[25] === 'likely', t.slice(8, 13).concat(t.slice(24))); }
  // (a route of B's own as good: kept - another browser's only where it is better by ten points)
  { const r = LB.srvIds.rows.get(ID).slice(); r[10] = BOS.id; r[11] = 5; r[25] = 'possible'; r[26] = 0;
    LB.srvIds.rows.set(ID, bare); const mine = LB.composeRoute(ID, HEX, { pos }) || {};
    LB.srvIds.rows.set(ID, r); const x = LB.composeRoute(ID, HEX, { pos }) || {};
    check('another browser\'s destination not as good as B\'s own: B\'s own stands', mine.destId ? x.destId === mine.destId && x.destReason === mine.destReason : x.destId === BOS.id, { own: mine.destIata, got: x.destIata, why: x.destReason });
    LB.srvIds.rows.set(ID, rowB); }

  // ---- a destination confirmed in A: confirmed everywhere, and standing ---------------------------------------------
  const routeC = Object.assign({}, routeA, { destId: BED.id, destIata: 'BED', destConf: 'confirmed', destP: 100, destReason: 'confirmed by you', userConfirmed: true, eta: ETA - 600, computedAt: Date.now() });
  LA.publishRoute(ID, routeC); await LA.reportToMonitor();
  check('A\'s user confirms Bedford: sent again, taken', (lastReport(IPA).rep || {}).routes === 1 && (M.ident.table(0).rows.find(r => r[0] === ID) || [])[24] === 2);
  // (B's own work on the flight done - its route not worked out again for minutes of itself)
  await until(() => LB.todayCache.get(HEX) && !(LB.routeState.get(ID) || {}).working, 8000); await sleep(100);
  B.__posted.length = 0; await LB.pullSrvIds();
  const pgC = await until(() => posted(B, 'route').find(m => m.id === ID && m.route && m.route.destIata === 'BED'), 1000);
  check('B\'s map told at once (the flight is identified there: its route worked out again when another browser\'s word for it arrives)', !!pgC && pgC.route.confirmed === true && pgC.route.destReason === 'confirmed in another browser', pgC && pgC.route);
  const rC = LB.composeRoute(ID, HEX, { pos }) || {};
  check('B: Bedford, confirmed in another browser - 100%, over any guess of its own', rC.destId === BED.id && rC.destConf === 'confirmed' && rC.destP === 100 && rC.destReason === 'confirmed in another browser', { dest: rC.destIata, conf: rC.destConf, p: rC.destP, why: rC.destReason });
  // (B's engine later guesses Boston with the aircraft's log: not over a destination confirmed in a browser)
  LB.publishRoute(ID, { computedAt: Date.now(), quick: false, originId: 0, destId: BOS.id, destIata: 'BOS', destConf: 'likely', destP: 75, destReason: 'its own log', eta: ETA, legCount: 3 });
  check('B\'s own route with the log goes to the monitor too', JSON.stringify((LB.routesOut.get(ID) || []).slice(2, 7)) === JSON.stringify([0, '', BOS.id, 75, 'likely']), LB.routesOut.get(ID));
  await LB.reportToMonitor();
  const tb = M.ident.table(0).rows.find(r => r[0] === ID);
  check('... a guess does not take the place of a destination confirmed in a browser', (lastReport(IPB).rep || {}).routes === 0 && tb[10] === BED.id && tb[24] === 2, { taken: (lastReport(IPB).rep || {}).routes, d: tb[10] });
  // (a landing: where the aircraft is - every browser sees that itself, and FR24 keeps the id while it taxis out again)
  LA.publishRoute(ID, Object.assign({}, routeA, { destConf: 'landed', destP: 0, destReason: 'landed at TEB', landed: true, computedAt: Date.now() }));
  check('a landing seen in A: only its origin for the monitor', JSON.stringify((LA.routesOut.get(ID) || []).slice(2, 7)) === JSON.stringify([LTN.id, 'ground', 0, 0, '']), LA.routesOut.get(ID));
  LA.routesOut.delete(ID);
  // ---- a destination worked out in A that the flight comes no nearer to in an hour: dropped, B's map told ----------
  { M.ident.ids.get(ID).crowd = null;
    LA.publishRoute(ID, Object.assign({}, routeA, { originId: 0, originIata: '', originConf: '', originNote: '', destP: 97, computedAt: Date.now() }));
    await LA.reportToMonitor();
    await sleep(5); B.__posted.length = 0; await LB.pullSrvIds();
    const row = LB.srvIds.rows.get(ID) || [], p1 = await until(() => posted(B, 'route').find(m => m.id === ID && m.route && m.route.destReason === 'worked out by another browser'), 1000);
    check('A\'s destination alone (no origin with it): B has it with the name, on its map', row[24] === 1 && row[10] === TEB.id && row[26] === 0 && !!p1 && p1.route.destIata === 'TEB', { row: row.slice(8, 13).concat(row.slice(24)), map: p1 && p1.route });
    M.ident.ids.get(ID).crowd.kmAt -= 3700; M.ident.prune(Date.now());
    await sleep(5); B.__posted.length = 0; await LB.pullSrvIds();
    const p2 = await until(() => posted(B, 'route').find(m => m.id === ID), 1000);
    check('... the flight no nearer it an hour on: dropped at the monitor, and B\'s map told at once', !M.ident.ids.get(ID).crowd && (LB.srvIds.rows.get(ID) || [])[24] === 0 && !!p2 && (!p2.route || p2.route.destReason !== 'worked out by another browser'), p2 && p2.route); }

  // ---- the flights a browser learns from, learned by every browser ---------------------------------------------------
  const base = (L, a, b) => L.engine.odWeight(a, b);
  const b0 = [base(LB, 'EGNL', 'LFLB'), base(LB, 'EGPC', 'LEMH')], a0 = [base(LA, 'EGNL', 'LFLB'), base(LA, 'EGPC', 'LEMH')];
  const day0 = Math.floor(nowS / 86400) * 86400 - 86400, t1 = day0 + 10 * 3600, t2 = day0 + 15 * 3600;
  const leg = (from, to, t, dur) => ({ from: { id: from.id, code: from.iata, conf: 'ground' }, to: { id: to.id, code: to.iata, conf: 'ground' }, tStart: t, tOff: t, tEnd: t + dur, cs: 'NJE7Q' });
  const n0 = LA.learnOutN;
  LA.learnFromLeg('400d01', { pts: [] }, leg(BWF, CMF, t1, 9000), 'bizjet', false);
  LA.learnFromLeg('400d02', { pts: [] }, leg(WIC, MAH, t2, 13000), 'bizjet', false);
  LA.learnFromLeg('400d03', { pts: [] }, leg(LTN, CMF, t2, 6000), 'bizjet', false, ['', '', '']);
  check('A learns from two flights it rebuilt itself: both for the monitor (one the monitor rebuilt and sent here: not back)', LA.learnOutN === n0 + 2, { was: n0, now: LA.learnOutN });
  // (anyone's browser: so many flights an hour)
  M.CFG.learnPerHour = 1;
  await LA.reportToMonitor();
  rep = lastReport(IPA);
  const sent = (rep.d.learn || []);
  check('... sent with the next report, the monitor\'s own rows exactly (12 columns)', sent.length === 2 && sent.every(x => x.length === 12) && sent[0][0] === '400d01|' + t1 && sent[0][1] === BWF.id && sent[0][2] === CMF.id && sent[0][3] === t1 + 9000, sent);
  check('... one taken, the other past this browser\'s share for the hour', rep.rep.learned === 1 && JSON.stringify(rep.rep.learnNot) === '[1]', rep.rep);
  const mine = k => LA.learnedStore().find(x => x[0] === k) || [];
  check('... A marks the one taken with the number the monitor gave the report (its learning will say it has it), not the other', rep.rep.learnSeq > 0 && mine('400d01|' + t1)[12] === rep.rep.learnSeq && !mine('400d02|' + t2)[12], [rep.rep.learnSeq, mine('400d01|' + t1)[12], mine('400d02|' + t2)[12]]);
  await until(async () => ((await LA.store.getBlob('learn3:0')) || []).some(x => x[0] === '400d01|' + t1 && x[12] > 0), 5000);
  // (the monitor's learning rebuilt: the browsers' flights with its own)
  M.crowdLearnSave();
  const built = await M.learnedBuild(nowS);
  check('the monitor learns the flight with its own (a day\'s flights from the browsers kept apart)', !!built && built.crowd === 1 && built.flights >= 1, built && { crowd: built.crowd, flights: built.flights });
  await LA.syncSrvLearn(); await LB.syncSrvLearn();
  const keptB = await LB.store.getBlob('srvLearned');
  check('... both browsers fetch it for their next page load', !!keptB && keptB.ver === built.ver && keptB.crowd === 1 && ((await LA.store.getBlob('srvLearned')) || {}).ver === built.ver);
  check('... with the number of the last report it has', built.builtSeq >= rep.rep.learnSeq && JSON.parse(M.learnedRef().json).builtSeq === built.builtSeq, { builtSeq: built.builtSeq, seq: rep.rep.learnSeq });
  // (the next page load of each - leaving a page writes everything: the monitor's learning in its engine)
  LA.store.flushNow(); LB.store.flushNow(); await sleep(200);
  const { L: LB2 } = await boot(netB, idbB), { L: LA2 } = await boot(netA, idbA);
  await until(() => LB2.srvLearned && base(LB2, 'EGNL', 'LFLB') > b0[0], 15000);
  await until(() => LA2.srvLearned && base(LA2, 'EGPC', 'LEMH') > a0[1], 15000); await sleep(300);
  const d = (L, a, b, z) => Math.round((base(L, a, b) - z) * 100) / 100;
  check('B\'s next page: its engine has the flight A learned from (Barrow to Chambery)', d(LB2, 'EGNL', 'LFLB', b0[0]) === 1, d(LB2, 'EGNL', 'LFLB', b0[0]));
  check('... and not the one the monitor did not take', d(LB2, 'EGPC', 'LEMH', b0[1]) === 0, d(LB2, 'EGPC', 'LEMH', b0[1]));
  check('A\'s next page: the flight it sent counted once (from the monitor; its own copy left out)', d(LA2, 'EGNL', 'LFLB', a0[0]) === 1, d(LA2, 'EGNL', 'LFLB', a0[0]));
  check('... the one not taken still learned there, from its own copy', d(LA2, 'EGPC', 'LEMH', a0[1]) === 1, d(LA2, 'EGPC', 'LEMH', a0[1]));
  // (an older monitor - no word of what it learned: nothing marked sent; a monitor not answering: kept for the next report)
  M.CFG.learnPerHour = 600;
  mode.old = true; LA.learnFromLeg('400d04', { pts: [] }, leg(BWF, MAH, t1, 12000), 'bizjet', false); await LA.reportToMonitor(); mode.old = false;
  check('a monitor from before this version: nothing marked sent (it learns none of them)', !mine('400d04|' + t1)[12] && LA.learnOutN === 0, mine('400d04|' + t1)[12]);
  mode.down = true; LA.learnFromLeg('400d05', { pts: [] }, leg(WIC, CMF, t1, 9000), 'bizjet', false); await LA.reportToMonitor(); mode.down = false;
  check('the monitor not answering: the flight kept for the next report', LA.learnOutN === 1 && !mine('400d05|' + t1)[12]);
  await LA.reportToMonitor();
  check('... sent then', LA.learnOutN === 0 && mine('400d05|' + t1)[12] > 0 && (lastReport(IPA).d.learn || []).some(x => x[0] === '400d05|' + t1));
  { const k5 = mine('400d05|' + t1), sl = LA.srvLearned;
    LA.srvLearned = { ver: 'x', from: built.from, asOf: built.asOf, builtSeq: k5[12] - 1 }; const before = LA.srvCovers(k5);
    LA.srvLearned = { ver: 'y', from: built.from, asOf: built.asOf, builtSeq: k5[12] }; const after = LA.srvCovers(k5);
    LA.srvLearned = sl;
    check('a flight the monitor took after its learning was built: still learned here, until a learning that has it', !before && after, { before, after }); }

  // ---- a playback flight the monitor cannot name yet: asked about again, named once it has worked it out --------------
  { const PID = 0x7b100001, HX = 'c30001', tA = day0 + 9 * 3600, T1 = tA + 5400;
    M.markBlocked(HX, { reg: 'N930GA', type: 'GLF6' }, nowS);
    const course = t => E.destPoint(51, -15, 265, 480 * 1.852 * (t - tA) / 3600), at = course(T1), f = E.destPoint(at[0], at[1], 0, 3);
    LB.pb.flights.set(PID, { id: PID, ts: T1, lat: f[0], lon: f[1], alt: 41000, spd: 480, trk: 265, gnd: false, type: 'GLF6' });
    pbAsks.length = 0;
    const n1 = await LB.pbFromMonitor(T1);
    check('a playback flight mid-Atlantic the monitor has nothing on yet: not named, the monitor keeps it', n1 === 0 && pbAsks.length === 1 && M.waiting.W.has(PID) && !LB.pb.named.has(PID), { n1, asks: pbAsks.length });
    // (the jet's day rebuilt on the monitor: heard to mid-ocean, out of hearing two hours, heard again - carried across)
    const pts = []; for (let t = tA; t <= tA + 1800; t += 20) { const p = course(t); pts.push([t, p[0], p[1], 41000]); }
    for (let t = tA + 9000; t <= tA + 10800; t += 20) { const p = course(t); pts.push([t, p[0], p[1], 41000]); }
    M.tracks.put(HX, pts);
    M.waitRound(Date.now(), 5000);
    check('the monitor works it out in the background, across the hole in the jet\'s track', (M.names.peek(PID, T1) || [])[1] === HX && (M.names.peek(PID, T1) || [])[7] === 'reckon', M.names.peek(PID, T1));
    const n2 = await LB.pbFromMonitor(T1);
    check('B\'s playback: not asked again within 45 seconds', n2 === 0 && pbAsks.length === 1);
    LB.pb.monAsked.set(PID, Date.now() - 46000);
    const n3 = await LB.pbFromMonitor(T1), rec = LB.pb.named.get(PID) || {};
    check('... asked again after that: named, carried across the gap', n3 === 1 && pbAsks.length === 2 && rec.hex === HX && rec.reg === 'N930GA' && rec.src === 'monitor (its track, carried across a gap)', { n3, rec: { hex: rec.hex, reg: rec.reg, src: rec.src } });
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  HARNESS ' + (e && e.stack || e)); process.exit(1); });
