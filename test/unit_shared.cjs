// What one browser sees reaches every other, through the shared monitor: the BUILT userscript in jsdom, two browsers (two
// windows, two addresses) with the real monitor code between them, offline.
//   - (1.1.0) a flight the monitor names: its route worked out on the monitor (central calculation) from what the
//     browsers send - each shows that one answer, the very same, and sends none of it back;
//   - a destination confirmed in one browser: to the monitor, and in its answer to every other - "confirmed in another
//     browser", 100%; a guess sent by a browser of an older version does not take its place; checked against the flight
//     on the monitor as the browsers once did (TC-AKB: one it has flown away from is not shown); a destination a browser
//     worked out itself (an older version) never in the monitor's answer;
//   - the flights a browser learns from: to the monitor, learned there - no browser fetches any learning;
//   - a playback flight the monitor has no name for yet: asked about again, named once the monitor has worked it out.
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
    if (u.pathname === '/calc') return { status: 200, text: JSON.stringify(await M.central.answer(d)) };
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
  // (central calculation on the monitor, on this thread)
  M.CFG.centralWorkers = 0; await M.centralStart();
  check('(the monitor\'s central calculation on)', M.central.stats.on, M.central.stats.why);
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
  const sig = r => r ? [r.originIata, r.destIata, r.destConf, r.destP, r.destReason].join('|') : 'none';
  // ---- A shows it: the monitor's answer - worked out there from what A sent ------------------------------------------
  const ETA = nowS + 4 * 3600;
  check('... nothing of A\'s own to send for it', !LA.routesOut.has(ID), LA.routesOut.get(ID));
  await until(() => (LA.composeRoute(ID, HEX), LA.calcGot.has(ID)), 8000);
  const rA = LA.composeRoute(ID, HEX), mA = M.central.routeOf(ID);
  check('A: the monitor\'s answer for it, worked out from what A sent of the flight', !!rA && !!rA.central && !!mA && sig(rA) === sig(mA.r), { a: sig(rA), mon: mA && sig(mA.r) });
  LA.publishRoute(ID, rA);
  check('... not sent back to the monitor (it is the monitor\'s)', !LA.routesOut.has(ID), LA.routesOut.get(ID));
  // (a moment with nothing - its track and log not to be had, the sites walling the browser and the monitor slow: an
  // empty route - the page keeps the one it has: taken away, FR24's panel lost the airports, their time zones and the
  // progress bar, 23 Oct)
  A.__posted.length = 0;
  LA.publishRoute(ID, { computedAt: Date.now(), quick: false, onGround: false });
  check('a route that comes out empty for a moment, in the air: the page keeps the one it has (no "no route" sent)', !posted(A, 'route').some(m => m.id === ID), posted(A, 'route'));
  LA.publishRoute(ID, rA);
  check('... the route again: the page has it', posted(A, 'route').some(m => m.id === ID && m.route && (m.route.destIata || '') === (rA.destIata || '')));

  // ---- B opens it: the very same answer --------------------------------------------------------------------------------
  B.__posted.length = 0; feed(B, [fl]);
  await until(() => LB.live.has(ID), 3000);
  await until(() => (LB.composeRoute(ID, HEX), LB.calcGot.has(ID)), 8000);
  const rB = LB.composeRoute(ID, HEX);
  check('B opens the flight: the very same answer as A - the monitor\'s, nothing worked out in either browser', !!rB && !!rB.central && sig(rB) === sig(rA), { b: sig(rB), a: sig(rA) });

  // ---- a destination confirmed in A: in the monitor's answer to every browser --------------------------------------
  const n0 = reports.length;
  LA.userConfirm(ID, LA.live.get(ID), BED.id);
  const uA = LA.composeRoute(ID, HEX);
  check('A\'s user confirms Bedford: A shows it, 100%, confirmed by you', !!uA && uA.destIata === 'BED' && uA.userConfirmed && uA.destP === 100 && /^confirmed by you/.test(uA.destReason), uA && sig(uA));
  LA.publishRoute(ID, uA);
  check('... kept for the monitor: the destination alone (the origin is the monitor\'s own already)', JSON.stringify((LA.routesOut.get(ID) || []).slice(2, 7)) === JSON.stringify([0, '', BED.id, 100, 'confirmed']) || reports.slice(n0).some(x => x.ip === IPA && x.rep.routes === 1), LA.routesOut.get(ID));
  await LA.reportToMonitor();
  check('... sent with A\'s next report, taken: confirmed in a browser at the monitor', reports.slice(n0).some(x => x.ip === IPA && x.rep.routes === 1) && (M.ident.table(0).rows.find(r => r[0] === ID) || [])[24] === 2);
  B.__posted.length = 0;
  const rC = await until(() => { const r = LB.composeRoute(ID, HEX); return r && r.destIata === 'BED' ? r : null; }, 8000) || LB.composeRoute(ID, HEX) || {};
  check('B: Bedford, confirmed in another browser - 100% - in the monitor\'s answer (worked out again at once)', rC.destId === BED.id && rC.destConf === 'confirmed' && rC.destP === 100 && rC.destReason === 'confirmed in another browser' && !rC.userConfirmed && !!rC.central, sig(rC));
  const pgC = await until(() => posted(B, 'route').find(m => m.id === ID && m.route && m.route.destIata === 'BED'), 3000);
  check('... and on B\'s map', !!pgC && pgC.route.confirmed === true && pgC.route.destReason === 'confirmed in another browser', pgC && pgC.route);
  LB.publishRoute(ID, rC);
  check('... never sent back from B', !LB.routesOut.has(ID), LB.routesOut.get(ID));
  await until(() => LA.calcGot.has(ID) && LA.calcGot.get(ID).r.destIata === 'BED', 8000);
  const uA2 = LA.composeRoute(ID, HEX);
  check('... A, the monitor\'s answer Bedford too: still "confirmed by you" there', !!uA2 && uA2.destIata === 'BED' && uA2.userConfirmed && /^confirmed by you/.test(uA2.destReason), uA2 && sig(uA2));
  // (a browser of an older version - its own engine - later guesses Boston: not over a destination confirmed in a browser)
  { const r5 = M.report({ routes: [[ID, HEX, 0, '', BOS.id, 75, 'likely', ETA, 0]] }, Date.now(), { ip: '198.51.100.9' }), tb = M.ident.table(0).rows.find(r => r[0] === ID);
    check('... a guess from a browser of an older version does not take its place', r5.routes === 0 && tb[10] === BED.id && tb[24] === 2, { taken: r5.routes, d: tb[10] }); }
  // (a landing seen in A: where the aircraft is - the monitor sees that itself)
  LA.publishRoute(ID, Object.assign({}, rA, { destConf: 'landed', destP: 0, destReason: 'landed at TEB', landed: true, userConfirmed: false, computedAt: Date.now() }));
  check('a landing seen in A: nothing for the monitor', !LA.routesOut.has(ID), LA.routesOut.get(ID));
  // (A's user takes it back: taken back at the monitor, for every browser)
  LA.userConfirm(ID, LA.live.get(ID), 0);
  check('A\'s user takes Bedford back: that goes to the monitor too', JSON.stringify((LA.routesOut.get(ID) || []).slice(2, 7)) === JSON.stringify([0, '', BED.id, 0, 'withdrawn']), LA.routesOut.get(ID));
  await LA.reportToMonitor();
  check('... taken back there: confirmed for no one', !LA.routesOut.has(ID) && !(M.ident.ids.get(ID).crowd && M.ident.ids.get(ID).crowd.d) && (M.ident.table(0).rows.find(r => r[0] === ID) || [])[24] === 0, M.ident.ids.get(ID).crowd);
  const rW = await until(() => { const r = LB.composeRoute(ID, HEX); return r && r.destReason !== 'confirmed in another browser' ? r : null; }, 8000) || {};
  check('... B: the monitor\'s answer worked out again without it', !!rW.central && rW.destReason !== 'confirmed in another browser' && !rW.userConfirmed, sig(rW));
  // ---- a destination a browser of an older version worked out itself: the monitor's table, never its answer ----------
  { M.ident.ids.get(ID).crowd = null;
    M.report({ routes: [[ID, HEX, 0, '', TEB.id, 97, 'likely', ETA, 0]] }, Date.now(), { ip: '198.51.100.9' });
    await sleep(5); await LB.pullSrvIds();
    const row = LB.srvIds.rows.get(ID) || [];
    check('a destination a browser of an older version worked out (no origin with it): in the monitor\'s table of names, while central calculation has given it none', row[24] === 1 && row[10] === TEB.id && row[26] === 0, row.slice(8, 13).concat(row.slice(24)));
    const r7 = LB.composeRoute(ID, HEX) || {};
    check('... B, which shows the flight: the monitor\'s answer, not that browser\'s', !!r7.central && r7.destReason !== 'worked out by another browser', sig(r7));
    M.ident.ids.get(ID).central = true;
    const t7 = M.ident.table(0).rows.find(r => r[0] === ID) || [];
    check('... central calculation\'s route the table\'s: that browser\'s left out of it too', t7[24] === 0 && t7[10] !== TEB.id, t7.slice(8, 13).concat(t7.slice(24)));
    M.ident.ids.get(ID).central = false;
    M.ident.ids.get(ID).crowd.kmAt -= 3700; M.ident.prune(Date.now());
    await sleep(5); await LB.pullSrvIds();
    check('... the flight no nearer it an hour on: dropped at the monitor, and from B\'s table', !M.ident.ids.get(ID).crowd && (LB.srvIds.rows.get(ID) || [])[24] === 0); }

  // ---- (22.30) another browser's destination the flight has since left behind: checked again here, every time ---------
  // TC-AKB (GLF4, Farnborough 20:08Z, 15 Oct) descending through 24,300 ft on 137 past Chambery for Turin at 22:16Z was
  // "Le Bourget 74%, ETA 22:09Z - worked out by another browser": kept frozen over this browser's own Linate / Malpensa /
  // Turin, 450 km past Paris
  { const ID2 = 0x7b000002, HEX2 = '4b8562', FAB = ap('EGLF'), LBG = ap('LFPB'), TRN = ap('LIMF');
    const t0 = nowS - 128 * 60, wp = [[0, FAB.lat, FAB.lon, 0], [3, 51.20, -0.60, 6000], [25, 49.30, 2.00, 41000], [70, 47.30, 4.00, 41000], [100, 46.40, 5.15, 41000], [113, 46.05, 5.55, 30000], [128, 45.55, 6.18, 24325]];
    const trail2 = []; for (let s = 0; s <= 128 * 60; s += 20) { const m = s / 60; let i = 0; while (i < wp.length - 2 && wp[i + 1][0] < m) i++; const a = wp[i], b = wp[i + 1], f = (m - a[0]) / (b[0] - a[0]); trail2.push({ t: t0 + s, lat: a[1] + (b[1] - a[1]) * f, lon: a[2] + (b[2] - a[2]) * f, alt: Math.round(a[3] + (b[3] - a[3]) * f), gnd: s === 0 }); }
    for (let i = 1; i < trail2.length; i++) { const p = trail2[i], q = trail2[i - 1]; p.trk = E.brg(q.lat, q.lon, p.lat, p.lon); p.gs = E.dist(q.lat, q.lon, p.lat, p.lon) / 1.852 / 20 * 3600; }
    const pos2 = Object.assign({}, trail2[trail2.length - 1], { vr: -864 });
    M.markBlocked(HEX2, { reg: 'TC-AKB', type: 'GLF4' }, nowS);
    // (FR24's positions of it at the monitor: the last ten minutes, a minute apart)
    for (const p of trail2.filter(q => q.t >= nowS - 600 && (q.t - t0) % 60 === 0)) M.ident.observe([{ id: ID2, lat: p.lat, lon: p.lon, alt: p.alt, trk: Math.round(p.trk), spd: Math.round(p.gs), ts: p.t, gnd: false, src: 0, type: 'GLF4', reg: '', cs: '', icon: 0 }], Date.now(), 'scan');
    M.ident.assign(M.ident.flights.get(ID2), HEX2, { reg: 'TC-AKB', type: 'GLF4', ladd: true }, 'list', Date.now());
    const R2 = M.ident.ids.get(ID2);
    check('the monitor refuses another browser\'s Le Bourget for it now (450 km behind it, flying on away)', !M.ident.crowdRoute(ID2, HEX2, { o: FAB.id, oc: 'ground', d: LBG.id, p: 74, dc: 'likely', eta: nowS - 420, atd: t0 }, '', Date.now()) && !(R2.crowd && R2.crowd.d), R2.crowd);
    check('... takes Turin, ahead of it', M.ident.crowdRoute(ID2, HEX2, { o: FAB.id, oc: 'ground', d: TRN.id, p: 60, dc: 'likely', eta: nowS + 1200, atd: t0 }, '', Date.now()) && R2.crowd.d === TRN.id);
    // (Le Bourget taken when it still fitted - over Picardy - and handed out since: dropped the moment the flight says otherwise)
    Object.assign(R2.crowd, { d: LBG.id, p: 74, dc: 'likely', eta: nowS - 420, dt: nowS - 5400, km: 300, kmAt: nowS - 60 });
    M.ident.prune(Date.now());
    check('... and drops a Le Bourget it had kept from earlier at once - not an hour later (the origin stays)', !!R2.crowd && !R2.crowd.d && R2.crowd.o === FAB.id, R2.crowd);
    Object.assign(R2.crowd, { d: TRN.id, p: 60, dc: 'likely', eta: nowS + 1200, dt: nowS - 60, km: 120, kmAt: nowS - 60 }); M.ident.prune(Date.now());
    check('... Turin, ahead of it, kept', R2.crowd && R2.crowd.d === TRN.id, R2.crowd);
    // (its ETA long gone - a stale one sent with it, or a hold - 60 km and more out: a guess dropped, a confirmed one kept)
    Object.assign(R2.crowd, { d: TRN.id, p: 100, dc: 'confirmed', eta: nowS - 3000, dt: nowS - 60, km: 120, kmAt: nowS - 60 }); M.ident.prune(Date.now());
    check('... Turin confirmed, its ETA 50 minutes gone, still ahead of it: kept', R2.crowd && R2.crowd.d === TRN.id, R2.crowd);
    Object.assign(R2.crowd, { d: TRN.id, p: 60, dc: 'likely', eta: nowS - 3000, dt: nowS - 60, km: 120, kmAt: nowS - 60 }); M.ident.prune(Date.now());
    check('... Turin worked out, its ETA 50 minutes gone, the aircraft still far from it: dropped', R2.crowd && !R2.crowd.d, R2.crowd);
    Object.assign(R2.crowd, { d: TRN.id, p: 60, dc: 'likely', eta: nowS + 1200, dt: nowS - 60, km: 120, kmAt: nowS - 60 });
    R2.crowd = null;
    // (1.1.0) The route code on the monitor - every browser's answer: TC-AKB as the browsers send it, its whole track
    M.central.take({ id: ID2, hex: HEX2, kind: 'live', ac: { reg: 'TC-AKB', type: 'GLF4', ladd: true }, pos: pos2, trail: { full: true, pts: trail2 } });
    const F2 = M.central.flights.get(ID2), run = c => { R2.crowd = c; return M.central.compute(F2) || {}; };
    const offOf = r => { const a = r.destId ? E.byId(r.destId) : null; return a ? Math.round(E.angDiff(pos2.trk, E.brg(pos2.lat, pos2.lon, a.lat, a.lon))) : null; };
    const rN = run(null);
    check('the monitor\'s answer for TC-AKB descending on 137 past Chambery: ahead of it, from Farnborough, no ETA already gone', !!rN.destId && offOf(rN) < 75 && rN.originId === FAB.id && (!rN.eta || rN.eta > nowS), { dest: rN.destIata, p: rN.destP, off: offOf(rN), o: rN.originIata, eta: rN.eta });
    const cr = o => Object.assign({ o: 0, oc: '', atd: 0, ot: 0, oOwn: 0, p: 100, dc: 'confirmed', dt: nowS - 60, dOwn: 1, km: 120, kmAt: nowS - 60, at: nowS - 60 }, o);
    const rT = run(cr({ d: TRN.id, eta: nowS + 1200 }));
    check('... Turin confirmed in a browser, ahead of it: in the monitor\'s answer, 100%', rT.destIata === 'TRN' && rT.destReason === 'confirmed in another browser' && rT.destP === 100, { dest: rT.destIata, why: rT.destReason });
    const rC2 = run(cr({ d: LBG.id, eta: nowS - 420 }));
    check('... Le Bourget confirmed in a browser, 450 km behind it: not in it', rC2.destIata !== 'LBG' && !rC2.crowdD, { dest: rC2.destIata, why: rC2.destReason });
    const rL = run(cr({ d: LBG.id, p: 74, dc: 'likely', eta: nowS - 420 }));
    check('... a destination a browser worked out (not confirmed): never in it - the monitor\'s own stands', rL.destIata === rN.destIata && !rL.crowdD, { dest: rL.destIata, own: rN.destIata });
    R2.crowd = null; M.central.flights.delete(ID2);
    for (const L of [LB]) { await until(() => !L.srvIds.busy, 5000); L.srvIds.since = 0; await L.pullSrvIds(); }
    // (B's row for it as it was: another browser's Le Bourget at 74%, its ETA seven minutes gone)
    const row0 = LB.srvIds.rows.get(ID2) || [], rowL = row0.slice(); rowL[8] = FAB.id; rowL[9] = 'ground'; rowL[10] = LBG.id; rowL[11] = 74; rowL[12] = nowS - 5400; rowL[13] = pos2.lat; rowL[14] = pos2.lon; rowL[15] = pos2.alt; rowL[16] = 0; rowL[17] = nowS; rowL[18] = nowS - 420; rowL[19] = t0; rowL[24] = 1; rowL[25] = 'likely'; rowL[26] = 1;
    const rowT = rowL.slice(); rowT[10] = TRN.id; rowT[11] = 100; rowT[18] = nowS + 1200; rowT[24] = 2; rowT[25] = 'confirmed';
    // (before the flight is opened - the name and the route the monitor handed out: no destination whose ETA is long gone)
    // (no track in the row: its ETA a quarter of an hour gone and more, the aircraft still airborne and far away)
    const rowS = rowL.slice(); rowS[18] = nowS - 1500;
    check('the route handed out with the name: a destination 25 minutes past its ETA, the aircraft 450 km from it, left out (7 minutes: kept)', !LB.srvRoute(rowS).destId && LB.srvRoute(rowS).originId === FAB.id && LB.srvRoute(rowL).destId === LBG.id && LB.srvRoute(rowT).destId === TRN.id, { stale: LB.srvRoute(rowS).destIata, late7: LB.srvRoute(rowL).destIata, ahead: LB.srvRoute(rowT).destIata });
    LB.srvIds.rows.set(ID2, row0); }

  // ---- the flights a browser learns from: to the monitor, learned there --------------------------------------------------
  const day0 = Math.floor(nowS / 86400) * 86400 - 86400, t1 = day0 + 10 * 3600, t2 = day0 + 15 * 3600;
  const leg = (from, to, t, dur) => ({ from: { id: from.id, code: from.iata, conf: 'ground' }, to: { id: to.id, code: to.iata, conf: 'ground' }, tStart: t, tOff: t, tEnd: t + dur, cs: 'NJE7Q' });
  const l0 = LA.learnOutN;
  LA.learnFromLeg('400d01', { pts: [] }, leg(BWF, CMF, t1, 9000), 'bizjet', false);
  LA.learnFromLeg('400d02', { pts: [] }, leg(WIC, MAH, t2, 13000), 'bizjet', false);
  LA.learnFromLeg('400d03', { pts: [] }, leg(LTN, CMF, t2, 6000), 'bizjet', false, ['', '', '']);
  check('A rebuilds two flights itself: both for the monitor (one the monitor rebuilt and sent here: not back)', LA.learnOutN === l0 + 2, { was: l0, now: LA.learnOutN });
  // (anyone's browser: so many flights an hour)
  M.CFG.learnPerHour = 1;
  await LA.reportToMonitor();
  const rep = lastReport(IPA);
  const sent = (rep.d.learn || []);
  check('... sent with the next report, the monitor\'s own rows exactly (12 columns)', sent.length === 2 && sent.every(x => x.length === 12) && sent[0][0] === '400d01|' + t1 && sent[0][1] === BWF.id && sent[0][2] === CMF.id && sent[0][3] === t1 + 9000, sent);
  check('... one taken, the other past this browser\'s share for the hour', rep.rep.learned === 1 && JSON.stringify(rep.rep.learnNot) === '[1]', rep.rep);
  const mine = k => LA.learnedStore().find(x => x[0] === k) || [];
  check('... A marks the one taken with the number the monitor gave the report, not the other', rep.rep.learnSeq > 0 && mine('400d01|' + t1)[12] === rep.rep.learnSeq && !mine('400d02|' + t2)[12], [rep.rep.learnSeq, mine('400d01|' + t1)[12], mine('400d02|' + t2)[12]]);
  // (the monitor's learning rebuilt: the browsers' flights with its own)
  M.crowdLearnSave();
  const built = await M.learnedBuild(nowS);
  check('the monitor learns the flight with its own (a day\'s flights from the browsers kept apart)', !!built && built.crowd === 1 && built.flights >= 1, built && { crowd: built.crowd, flights: built.flights });
  check('... no browser fetches a learning, nor learns into an engine of its own (1.1.0: the tables are the monitor\'s alone)', ![...netA.asked, ...netB.asked].some(a => /\/learned/.test(a.url)) && typeof LA.syncSrvLearn === 'undefined' && !LA.engine.T2);
  // (an older monitor - no word of what it learned: nothing marked sent; a monitor not answering: kept for the next report)
  M.CFG.learnPerHour = 600;
  mode.old = true; LA.learnFromLeg('400d04', { pts: [] }, leg(BWF, MAH, t1, 12000), 'bizjet', false); await LA.reportToMonitor(); mode.old = false;
  check('a monitor from before 22.25: nothing marked sent (it learns none of them)', !mine('400d04|' + t1)[12] && LA.learnOutN === 0, mine('400d04|' + t1)[12]);
  mode.down = true; LA.learnFromLeg('400d05', { pts: [] }, leg(WIC, CMF, t1, 9000), 'bizjet', false); await LA.reportToMonitor(); mode.down = false;
  check('the monitor not answering: the flight kept for the next report', LA.learnOutN === 1 && !mine('400d05|' + t1)[12]);
  await LA.reportToMonitor();
  check('... sent then', LA.learnOutN === 0 && mine('400d05|' + t1)[12] > 0 && (lastReport(IPA).d.learn || []).some(x => x[0] === '400d05|' + t1));

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
