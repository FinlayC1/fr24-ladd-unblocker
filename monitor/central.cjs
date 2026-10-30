'use strict';
// Central calculation (1.0.1): a flight's route - where it took off, where it is going, the odds, the reasons, its ETA -
// worked out here, once, and handed to every browser that shows the flight, so all of them show the same.
//
// The work is the userscript's own: its route code (src/main/04-routes.js and 03-data.js, the blocks marked
// ==ROUTE-...==) is run here as it is, in a context of its own, with the same engine and the same tables - the population
// tables, the arrival paths and the monitor's learning as a browser loads them. What a browser has of its own, this side
// gives instead: the flight's track and FR24's plan as the browsers that show it send them (POST /calc), the aircraft's
// history from the monitor's logs (its own, the world log), the weather and closures any browser has sent for the
// airports in question. What only one browser can know - its user's own confirmation of a destination - each browser
// still adds itself.
//
// Memory: the population tables and the arrival paths are some 110 MB more. They are loaded only when the machine has
// room (CFG.centralFreeMb free after start, 300 MB by default); otherwise there is no central calculation, and (1.1.0: the
// userscript has no tables) no routes - /status says why. CPU, without workers: CFG.centralMsPerMin of work a minute at
// most (12 s); past it, the last answer is given, or none yet.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const fin = v => typeof v === 'number' && isFinite(v);
// (a browser's object kept only when it is small: weather, closures, what was seen of a hole in coverage)
const small = (v, n) => { try { const j = JSON.stringify(v); return j && j.length <= (n || 2000) ? JSON.parse(j) : null; } catch (e) { return null; } };
const BLOCKS = [['02-resolver.js', 'ROUTE-CROWD'], ['03-data.js', 'ROUTE-SITES'], ['03-data.js', 'ROUTE-PLACE'], ['04-routes.js', 'ROUTE-NOTE'], ['04-routes.js', 'ROUTE-DL'], ['04-routes.js', 'ROUTE-CORE']];
function blockOf(dir, file, mark) {
  const s = fs.readFileSync(path.join(dir, file), 'utf8'), a = s.indexOf('// ==' + mark + '=='), b = s.indexOf('// ==/' + mark + '==');
  if (a < 0 || b < a) throw new Error(file + ': ' + mark + ' marks missing');
  return s.slice(a, b);
}
// (the population tables as the build packs them, unpacked by the userscript's own code: test/t2_load.cjs checks the two
// give the same tables)
function unpackT2Of(dir) {
  const s = fs.readFileSync(path.join(dir, '03-data.js'), 'utf8'), i0 = s.indexOf('/* ==UNPACKT2== */'), i1 = s.indexOf('/* ==/UNPACKT2== */');
  if (i0 < 0 || i1 < i0) throw new Error('03-data.js: UNPACKT2 marks missing');
  return new Function(s.slice(i0 + 18, i1) + '; return { unpackT2, unpackT2Steps };')();
}
// (a generator run a few milliseconds at a time, the server answering in between - as the userscript loads them)
async function sliced(it) { for (;;) { const t0 = Date.now(); while (Date.now() - t0 < 15) if (it.next().done) return; await new Promise(r => setImmediate(r)); } }
// (the route tables as build.mjs compacts them for the userscript: 3 decimals, no sample counts, airport pairs packed)
function compactTables(tables) {
  const t = JSON.parse(JSON.stringify(tables)), round = v => typeof v === 'number' ? +v.toFixed(3) : v;
  for (const key of ['hdg', 'xt', 'desc', 'lvl', 'clm', 'stp', 'rall', 'cruise', 'trip', 'tripc', 'loc', 'clb', 'cls']) for (const g of Object.values(t[key] || {})) for (const b of Object.values(g)) { b.q = b.q.map(round); delete b.n; }
  delete t.qs; delete t.n;
  if (t.od) { const g = {}; for (const [k, v] of Object.entries(t.od)) { const [a, b] = k.split('|'); (g[a] = g[a] || []).push(b + ':' + (+(+v).toFixed(1))); } t.odG = Object.fromEntries(Object.entries(g).map(([a, l]) => [a, l.join(',')])); delete t.od; }
  return t;
}

// The arrival paths as the userscript holds them: sorted typed arrays, looked up by halving (a Map of them is ~25 MB) -
// get(cell) -> [airport id, traffic that landed there, all traffic through the cell], as its loadApprTable gives
// (the lookup made apart from the file's parse: a closure beside one that reads it would keep all of it alive)
function packApproach(t) {
  const keys = Object.keys(t.cells).map(Number).sort((a, b) => a - b), N = keys.length;
  const K = new Float64Array(N), A = new Uint32Array(N), T = new Uint32Array(N), L = new Uint32Array(N);
  for (let i = 0; i < N; i++) { const c = t.cells[keys[i]]; K[i] = keys[i]; A[i] = c[0]; L[i] = c[1]; T[i] = c[2]; }
  return { bin: t.bin, thr: t.thr, minN: t.minN, cells: apprCells(K, A, L, T) };
}
function apprCells(K, A, L, T) {
  const N = K.length;
  return { size: N, get: k => { let lo = 0, hi = N - 1; while (lo <= hi) { const mid = (lo + hi) >> 1, v = K[mid]; if (v === k) return [A[mid], L[mid], T[mid]]; if (v < k) lo = mid + 1; else hi = mid - 1; } return undefined; } };
}
// Loads into the engine what a browser's has beyond the monitor's own: the route tables as the userscript has them, the
// population tables, the arrival paths. -> MB of heap they took
async function loadTables(E, srcDir, mainDir) {
  const h0 = process.memoryUsage().heapUsed, rd = f => JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8')), breath = () => new Promise(r => setImmediate(r));
  if (fs.existsSync(path.join(srcDir, 'tables.json'))) E.setTables(compactTables(rd('tables.json')));
  if (fs.existsSync(path.join(srcDir, 'logit.json'))) E.setLogit(rd('logit.json'));
  await breath();
  let t2 = rd('tables2.json'); await breath();
  if (t2 && t2.pk === 2) { const t = {}; await sliced(unpackT2Of(mainDir).unpackT2Steps(t2, t)); t2 = t; }
  E.setTables2(t2); await breath();
  if (fs.existsSync(path.join(srcDir, 'approach.json'))) E.setApproach(packApproach(rd('approach.json')));
  return Math.round((process.memoryUsage().heapUsed - h0) / 1e6);
}

// A point of a flight's track as a browser sends it (a trail point of its own, numbers that are not numbers left out) -
// only the fields the engine reads, of the types it expects
const PT_NUM = ['t', 'lat', 'lon', 'alt', 'altGeom', 'ias', 'gs', 'trk', 'vr', 'mcp', 'fms', 'tas', 'ws', 'wd', 'hdg'], PT_BOOL = ['gnd', 'gnd0', 'stale', 'newLeg', 'own'], PT_STR = ['cs', 'sq', 'cat'];
function cleanPt(p) {
  if (!p || typeof p !== 'object' || !fin(p.t) || !fin(p.lat) || !fin(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
  const o = {};
  for (const k of PT_NUM) if (p[k] === null) o[k] = null; else if (fin(p[k])) o[k] = p[k];
  for (const k of PT_BOOL) if (typeof p[k] === 'boolean') o[k] = p[k];
  for (const k of PT_STR) if (typeof p[k] === 'string') o[k] = p[k].slice(0, 16);
  return o;
}
const cleanStr = (v, n) => typeof v === 'string' ? v.slice(0, n || 40) : '';
function cleanAc(a, hex) {
  a = a && typeof a === 'object' ? a : {};
  return { hex, reg: cleanStr(a.reg, 12), cs: cleanStr(a.cs, 12), ladd: !!a.ladd, pia: !!a.pia, type: cleanStr(a.type, 8), cat: cleanStr(a.cat, 4), mil: !!a.mil, country: cleanStr(a.country, 60) };
}
function cleanPlan(p, E) {
  if (!p || typeof p !== 'object') return null;
  const ap = id => fin(id) && E.byId(id) ? id : 0, n = v => fin(v) ? v : 0, o = { originId: ap(p.originId), destId: ap(p.destId) };
  if (p.divertedToId) o.divertedToId = ap(p.divertedToId);
  for (const k of ['std', 'sta', 'etd', 'eta', 'atd', 'at']) if (p[k]) o[k] = n(p[k]);
  for (const k of ['fr24', 'list', 'datalink']) if (p[k]) o[k] = true;
  if (p.num) o.num = cleanStr(p.num, 12);
  if (p.status) o.status = cleanStr(p.status, 30);
  if (Array.isArray(p.kinds)) o.kinds = p.kinds.filter(k => typeof k === 'string').slice(0, 6).map(k => k.slice(0, 10));
  return o.originId || o.destId || o.std ? o : null;
}
function cleanLeg(l, E) {
  if (!l || typeof l !== 'object' || !fin(l.tStart) || !fin(l.tEnd)) return null;
  const ap = a => a && fin(a.id) && E.byId(a.id) ? { id: a.id, code: cleanStr(a.code, 8), conf: cleanStr(a.conf, 12) } : null;
  return { tStart: l.tStart, tEnd: l.tEnd, from: ap(l.from), to: ap(l.to), ended: !!l.ended, cs: cleanStr(l.cs, 12), maxAlt: fin(l.maxAlt) ? l.maxAlt : 0, how: cleanStr(l.how, 12) || undefined, tOn: fin(l.tOn) ? l.tOn : null, tOff: fin(l.tOff) ? l.tOff : null, startedOnGround: !!l.startedOnGround };
}

// ---- one calculator (1.1.0): an engine and the userscript's route code in a context of its own. The monitor's main thread
// has one where there are no worker threads; each worker thread its own (central-worker.cjs). o: { E, now, datalink(reg),
// surge() } - where the main thread's own stores are at hand; a worker has what each job brings, and the surges sent to it
function createCalc(o) {
  const E = o.E, now = o.now || (() => Date.now());
  const wxMap = new Map(), closedMap = new Map();   // ICAO -> the weather / closures browsers sent (as theirs)
  let ctx = null, cur = null, surgeMap = null;
  // ---- the userscript's route code, in a context of its own -----------------------------------------------------------
  // (every name it uses from outside its blocks, given here; cur: the flight being worked out)
  function build(mainDir) {
    const box = {
      ENGINE: E, ENGINE_HIST_DAYS: 220, NM_KM: 1.852, fin, dist: E.dist, log: () => {}, now: () => now(), nowS: () => now() / 1000,
      sleep: ms => new Promise(r => setTimeout(r, ms)), SITES_URL: '', gmRequest: () => Promise.reject(new Error('not on the monitor')),
      store: { getHex: () => ({}), getHist: () => Promise.resolve(null), setHist() {}, kvGet: () => null },
      osmPlaceAt: () => null, wantOsmPlace() {}, scheduleReplan() {}, wantWx() {}, wantNotams() {}, onScreen: () => false,
      datalinkRoutes: reg => (o.datalink ? o.datalink(reg) : cur && cur.dl) || null,
      acOf: rec => (rec && rec.ac) || cleanAc(null, rec && rec.hex), airportsReady: () => E.airports.length > 1000,
      apById: id => (id && E.byId(id)) || null, apCode: a => a ? (a.iata || a.icao || String(a.id)) : '',
      calibP: p => p, wxMap, closedMap, srvIds: { rows: new Map() },
      currentPos: () => null, trailFor: () => [], fleetVisits: () => (cur && cur.fleet) || null, knownLegs: () => (cur && cur.hist) || [],
      live: new Map(), pubRecs: new Map(), planState: new Map(), routeState: new Map(), todayCache: new Map(),
      schedPlan: () => null, restedAfter: () => !!(cur && cur.rested), surgeNow: () => (o.surge ? o.surge() : surgeMap),
      userDestOf: () => null, platformsAhead: () => null, centralOf: (id, hex, r) => r
    };
    const c = vm.createContext(box);
    for (const [f, m] of BLOCKS) vm.runInContext(blockOf(mainDir, f, m), c, { filename: f + ' (' + m + ')' });
    return c;
  }
  // The landing sites the browsers load (OurAirports) - from the monitor's copy of the same file
  async function loadSites(csvFile) {
    if (!ctx || !fs.existsSync(csvFile)) return 0;
    // (its parser builds each name a character at a time - strings of that kind take ~30 bytes a character until flattened:
    // 80 MB for the list, 15 once copied flat)
    const rows = JSON.parse(JSON.stringify(await vm.runInContext('parseSitesCsv', ctx)(fs.readFileSync(csvFile, 'utf8'))));
    // (buildSites gives the engine these as its airfields too: the monitor's engine has them already, from the same file)
    const sf = E.setFields; E.setFields = () => {};
    try { vm.runInContext('buildSites', ctx)(rows); } finally { E.setFields = sf; }
    return rows.length;
  }
  // The tables loaded and the code read; the landing sites with room left for them (p.freeNow); the monitor's learning
  async function load(p) {
    const out = { mb: await loadTables(E, p.srcDir, p.mainDir), sites: 0, sitesWhy: '', learned: 0 };
    ctx = build(p.mainDir);
    // (the landing sites - 60 MB more - only with room left: without them a pad or strip is named less closely)
    const left = p.freeNow ? p.freeNow() : Infinity;
    if (p.sitesCsv && !(left < (p.sitesMb || 250) * 1048576)) out.sites = await loadSites(p.sitesCsv);
    else if (p.sitesCsv) out.sitesWhy = `${Math.round(left / 1048576)} MB free after the tables - landing sites not loaded`;
    if (p.learnedOps) for (const op of p.learnedOps) if (E.addLearnedOp(op)) out.learned++;
    return out;
  }
  const get = name => vm.runInContext(name, ctx);
  // A flight's route from what is known of it. job: { id, hex, kind, rec, pos, trail, meta: { cut, gapFrom, gapInfo }, st:
  // { maxAlt, landedAt }, plan, lastLeg, hist, fleet: [[airport id, n]], rested, dl, confirmed: { d, p, eta, at } } ->
  // { r, origin, maxAlt } - origin:
  // the departure the route code remembers with the flight (rememberOrigin), handed back to be sent with the next job
  function run(job) {
    if (!ctx) throw new Error('not loaded');
    const live = get('live'), pubRecs = get('pubRecs'), routeState = get('routeState'), planState = get('planState'), todayCache = get('todayCache');
    live.clear(); pubRecs.clear(); routeState.clear(); planState.clear(); todayCache.clear();
    const rec = Object.assign({}, job.rec, { origin: job.origin || null });
    (job.kind === 'live' ? live : pubRecs).set(job.id, rec);
    let maxAlt = (job.st && job.st.maxAlt) || 0; for (const p of job.trail) if ((p.alt || 0) > maxAlt) maxAlt = p.alt;
    routeState.set(job.id, { maxAlt, landedAt: (job.st && job.st.landedAt) || 0 }); if (job.plan) planState.set(job.id, { plan: job.plan });
    if (job.lastLeg) todayCache.set(job.hex, { sums: [job.lastLeg] });
    // (a destination confirmed in a browser: as the browsers have it in the monitor's table of named flights - a row of it)
    const rows = get('srvIds').rows; rows.clear();
    if (job.confirmed && fin(job.confirmed.d)) { const c = job.confirmed, row = []; row[1] = job.hex; row[10] = c.d; row[11] = fin(c.p) ? c.p : 100; row[12] = c.at || 0; row[18] = c.eta || 0; row[24] = 2; row[25] = 'confirmed'; row[26] = 0; rows.set(job.id, row); }
    const trail = job.trail.map(p => Object.assign({}, p)), m = job.meta || {}; trail.cut = !!m.cut; trail.gapFrom = m.gapFrom || null; trail.gapInfo = m.gapInfo || null;
    cur = { hist: job.hist || [], fleet: job.fleet ? new Map(job.fleet) : null, rested: !!job.rested, dl: job.dl || null };
    try {
      const r = get('composeRoute0')(job.id, job.hex, { pos: Object.assign({}, job.pos), trail });
      return { r: r ? JSON.parse(JSON.stringify(r)) : null, origin: rec.origin ? JSON.parse(JSON.stringify(rec.origin)) : null, maxAlt };
    } finally { cur = null; live.clear(); pubRecs.clear(); }
  }
  return { load, run, wxMap, closedMap, setSurge: m => { surgeMap = m; }, get ctx() { return ctx; } };
}

// ---- worker threads (1.1.0): each with an engine, the tables and the route code of its own; a flight always worked out by
// the same one (the route code keeps a little of a flight between its answers: a destination it was vectored for) ------
function createPool(n, workerData, log) {
  const { Worker } = require('worker_threads');
  const ws = [], pending = new Map(); let jid = 0;
  const one = i => new Promise(resolve => {
    const w = new Worker(path.join(__dirname, 'central-worker.cjs'), { workerData });
    const x = { w, i, ready: false, busy: 0, st: null, err: '' }; ws[i] = x;
    w.on('message', m => {
      if (m && m.ready !== undefined) { x.ready = !!m.ready; x.st = m.st || null; x.err = m.err || ''; resolve(x); return; }
      const p = m && pending.get(m.jid); if (!p) return;
      pending.delete(m.jid); x.busy--; p.resolve(m);
    });
    // (a worker gone: what it had in hand answered with nothing; a new one started in its place)
    const gone = e => {
      if (x.dead) return; x.dead = true; x.ready = false; if (log) log('central worker', i, String(e && e.message || e || 'exited'));
      for (const [k, p] of pending) if (p.w === x) { pending.delete(k); p.resolve({ jid: k, r: null, err: 'worker gone', ms: 0 }); }
      x.busy = 0; if (!pool.closed) setTimeout(() => one(i), 5000);
    };
    w.on('error', gone); w.on('exit', code => gone(new Error('exited ' + code)));
  });
  const pool = {
    closed: false, workers: ws,
    start: () => Promise.all(Array.from({ length: n }, (_, i) => one(i))),
    // (the flight's own worker, by its id)
    run(job) {
      const x = ws[Math.abs(job.id | 0) % n];
      if (!x || !x.ready) return Promise.resolve({ r: null, err: 'worker not ready', ms: 0 });
      const k = ++jid; x.busy++;
      return new Promise(resolve => { pending.set(k, { resolve, w: x }); x.w.postMessage({ jid: k, job }); });
    },
    send(msg) { for (const x of ws) if (x && x.ready) x.w.postMessage(msg); },
    busy: () => ws.reduce((s, x) => s + (x ? x.busy : 0), 0),
    close() { pool.closed = true; for (const x of ws) if (x) x.w.terminate(); }
  };
  return pool;
}

function createCentral(env) {
  const E = env.E, now = env.now || (() => Date.now()), C = Object.assign({ every: 15, keepMin: 30, msPerMin: 12000, maxFlights: 1500, maxPts: 3000, allPts: 400000, histMin: 15, perWorker: 3 }, env.cfg || {});
  const S = { on: false, why: 'not loaded', mb: 0, flights: 0, evidence: 0, computed: 0, served: 0, cached: 0, overBudget: 0, failed: 0, lastErr: '', ms: 0, msMax: 0, at: 0, workers: 0 };
  const flights = new Map();        // FR24 flight id -> what is known of it (below)
  const histCache = new Map();      // hex -> { at, legs }
  // (the main thread's calculator: the one that works routes out where there are no workers; its weather and closures are
  // the ones browsers sent - sent on to the workers too)
  const calc = createCalc({ E, now, datalink: env.datalink, surge: env.surge });
  const wxMap = calc.wxMap, closedMap = calc.closedMap;
  let spent = [], pool = null;
  // Starts it: the tables loaded and the code read - or not, with why (/status). o.workers: how many worker threads (0:
  // the main thread works routes out, within its minute's allowance)
  async function start(o) {
    o = o || {};
    if (fin(o.free)) S.freeMb = Math.round(o.free / 1048576);
    if (o.off) { S.why = 'turned off (monitor.json "central": false)'; return S; }
    if (fin(o.free) && o.free < (o.needMb || 300) * 1048576) { S.why = `${Math.round(o.free / 1048576)} MB free at start, ${o.needMb || 300} MB wanted - no routes until it has room`; return S; }
    try {
      const st = await calc.load(o);
      S.mb = st.mb; if (st.sites) S.sites = st.sites; if (st.sitesWhy) S.sitesWhy = st.sitesWhy; if (o.learnedOps) S.learned = st.learned;
      S.popDays = (E.T2 && E.T2.days) || 0;   // (the days the population tables were learned from: said in the browsers' panels)
      const nw = Math.max(0, Math.floor(+o.workers || 0));
      if (nw) {
        const p = createPool(nw, { engine: o.engineFile, dataDir: o.dataDir, datasetFile: o.datasetFile, srcDir: o.srcDir, mainDir: o.mainDir, sitesCsv: S.sites ? o.sitesCsv : '', learnedOps: o.learnedOps || null }, env.log);
        const got = await p.start();
        if (got.every(x => x.ready)) { pool = p; S.workers = nw; }
        else { S.workersWhy = (got.find(x => !x.ready) || {}).err || 'a worker did not start'; p.close(); }
      }
      S.on = true; S.why = ''; S.at = now(); if (o.freeNow) { const f = o.freeNow(); if (fin(f)) S.freeAfterMb = Math.round(f / 1048576); }
    } catch (e) { S.on = false; S.why = 'failed: ' + String(e && e.message || e).slice(0, 120); }
    return S;
  }
  // (the surges, the learning - as they change on the main thread - to the workers too)
  function surgeChanged(map) { if (pool) pool.send({ surge: map ? [...map] : null }); }
  function learnedOps(ops) { if (!Array.isArray(ops)) return 0; let n = 0; for (const op of ops) if (E.addLearnedOp(op)) n++; if (pool) pool.send({ ops }); return n; }

  // ---- what browsers send of a flight ---------------------------------------------------------------------------------
  // x: { id, hex, kind: 'live' (a blocked flight) | 'pub' (an ordinary one), ac, pos, trail: { full, pts, cut, gapFrom,
  // gapInfo }, plan, st: { maxAlt, landedAt }, lastLeg, rested, fleet: [[airport id, n]], today: [legs], wx: { ICAO: entry },
  // closed: { ICAO: [...] } } -> 'full' when the track it added to was not the one held here (send it whole), else ''
  function take(x) {
    // (1.1.0: an ordinary flight may come without its address - FR24's N/A flights of its Most tracked list: worked out
    // without the aircraft's history; an address that comes later is kept, not a new flight)
    const id = +x.id, hex = String(x.hex || '').toLowerCase(); if (!(id > 0) || !(/^[0-9a-f]{6}$/.test(hex) || (!hex && x.kind !== 'live'))) return '';
    let F = flights.get(id);
    if (F && !F.hex && hex) { F.hex = hex; F.rec.hex = hex; histCache.delete(hex); }
    if (!F || (hex && F.hex !== hex)) {
      if (!F && flights.size >= C.maxFlights) return '';
      F = { id, hex, rec: { id, hex }, kind: 'pub', pos: null, trail: [], meta: {}, plan: null, st: { maxAlt: 0, landedAt: 0 }, lastLeg: null, rested: false, fleet: null, today: [], at: 0, route: null, routeAt: 0, dirty: true, origin: null };
      flights.set(id, F);
    }
    S.evidence++; F.at = now(); F.kind = x.kind === 'live' ? 'live' : 'pub';
    const ac = cleanAc(x.ac, F.hex); F.rec.ac = ac; for (const k of ['reg', 'type', 'cs', 'cat', 'mil', 'ladd', 'pia']) F.rec[k] = ac[k];
    for (const k of ['operatorName', 'owner', 'airline']) if (x.rec && typeof x.rec[k] === 'string') F.rec[k] = x.rec[k].slice(0, 60);
    const p = cleanPt(x.pos); if (p && (!F.pos || p.t >= F.pos.t)) { F.pos = p; F.dirty = true; }
    let need = '';
    const tr = x.trail && typeof x.trail === 'object' ? x.trail : null, pts = tr && Array.isArray(tr.pts) ? tr.pts.slice(0, 20000).map(cleanPt).filter(Boolean).sort((a, b) => a.t - b.t) : [];
    if (tr && tr.full && pts.length) {
      // (a whole track: kept unless the one held starts earlier on the same flight - another browser saw more of it - or
      // this one is a new leg, begun after the one held ended)
      const t0 = pts[0].t, h0 = F.trail.length ? F.trail[0].t : Infinity, hEnd = F.trail.length ? F.trail[F.trail.length - 1].t : 0;
      if (!F.trail.length || t0 <= h0 + 60 || (tr.cut && t0 > hEnd - 60) || t0 > hEnd + 1800) {
        F.trail = pts; F.meta = { cut: !!tr.cut, gapFrom: cleanPt(tr.gapFrom), gapInfo: tr.gapInfo && typeof tr.gapInfo === 'object' ? small(tr.gapInfo) : null }; F.dirty = true;
      } else { const last = hEnd; for (const q of pts) if (q.t > last + 5) F.trail.push(q); F.dirty = true; }
    } else if (pts.length) {
      // (the rest of a track held here: only after its last point; a browser whose track this is not sends it whole)
      const hEnd = F.trail.length ? F.trail[F.trail.length - 1].t : 0;
      if (!F.trail.length || pts[0].t < (F.trail[0].t) - 60 || pts[0].t > hEnd + 1800) need = 'full';
      else { for (const q of pts) if (q.t > F.trail[F.trail.length - 1].t + 5) F.trail.push(q); F.dirty = true; }
    }
    // (a long track: its last 1,500 points as they are, the ones before every other one - its first always kept)
    while (F.trail.length > C.maxPts) { const k = F.trail.length - 1500; F.trail = [F.trail[0]].concat(F.trail.slice(1, k).filter((q, i) => i % 2 === 1), F.trail.slice(k)); }
    if (x.plan !== undefined) { const pl = cleanPlan(x.plan, E); if (JSON.stringify(pl) !== JSON.stringify(F.plan)) { F.plan = pl; F.dirty = true; } }
    if (x.st && typeof x.st === 'object') { if (fin(x.st.maxAlt) && x.st.maxAlt > F.st.maxAlt) F.st.maxAlt = x.st.maxAlt; if (fin(x.st.landedAt) && x.st.landedAt > 0) F.st.landedAt = x.st.landedAt; }
    if (x.lastLeg !== undefined) F.lastLeg = cleanLeg(x.lastLeg, E);
    if (typeof x.rested === 'boolean') F.rested = x.rested;
    if (Array.isArray(x.fleet)) F.fleet = new Map(x.fleet.filter(e => Array.isArray(e) && fin(e[0]) && fin(e[1])).slice(0, 200).map(e => [e[0], e[1]]));
    if (Array.isArray(x.today)) { F.today = x.today.slice(0, 40).map(l => cleanLeg(l, E)).filter(Boolean); histCache.delete(hex); }
    const t = now(), wxOut = [], clOut = [];
    if (x.wx && typeof x.wx === 'object') for (const [k, v] of Object.entries(x.wx).slice(0, 12)) { const w = /^[A-Z0-9]{4}$/.test(k) && v && typeof v === 'object' && fin(v.at) && t - v.at < 90 * 60000 ? small(v, 4000) : null; if (w) { wxMap.set(k, w); wxOut.push([k, w]); } }
    if (x.closed && typeof x.closed === 'object') for (const [k, v] of Object.entries(x.closed).slice(0, 12)) { const c = /^[A-Z0-9]{4}$/.test(k) && Array.isArray(v) ? small(v.slice(0, 10), 4000) : null; if (c) { closedMap.set(k, c); clOut.push([k, c]); } }
    if (wxMap.size > 3000) wxMap.delete(wxMap.keys().next().value);
    if (closedMap.size > 3000) closedMap.delete(closedMap.keys().next().value);
    if (pool && (wxOut.length || clOut.length)) pool.send({ wx: wxOut, closed: clOut });
    room();
    return need;
  }
  // (all the tracks held: 400,000 points at most - ~60 MB; past it, the flights sent nothing longest are let go)
  function room() {
    let n = 0; for (const F of flights.values()) n += F.trail.length;
    if (n <= C.allPts) return;
    for (const F of [...flights.values()].sort((a, b) => a.at - b.at)) { if (n <= C.allPts * 0.9) break; n -= F.trail.length; flights.delete(F.id); }
    S.flights = flights.size;
  }
  // The aircraft's history: the monitor's logs of it (its days, the world log's, its live log), the flights a browser saw
  // today, joined - as the userscript's knownLegs gives them. Kept a quarter of an hour
  function histOf(F) {
    if (!F.hex) return [];
    const c = histCache.get(F.hex); if (c && now() - c.at < C.histMin * 60000) return c.legs;
    let legs = [];
    try { legs = (env.logOf ? env.logOf(F.hex) : []) || []; } catch (e) { legs = []; }
    const extra = F.today.filter(l => !legs.some(m => m.tStart < l.tEnd && m.tEnd > l.tStart));
    legs = extra.length ? E.chainLegs(E.stitchLegs(legs.concat(extra).sort((a, b) => a.tStart - b.tStart).map(l => Object.assign({}, l)))) : legs;
    histCache.set(F.hex, { at: now(), legs }); if (histCache.size > 2000) histCache.delete(histCache.keys().next().value);
    return legs;
  }
  // ---- working one out --------------------------------------------------------------------------------------------------
  // (the main thread's allowance: CFG.centralMsPerMin of work a minute; workers have their own threads)
  const busy = () => { const t = now(); spent = spent.filter(x => t - x[0] < 60000); return spent.reduce((n, x) => n + x[1], 0) >= C.msPerMin; };
  function jobOf(F) {
    return { id: F.id, hex: F.hex, kind: F.kind, rec: F.rec, pos: F.pos, trail: F.trail, meta: F.meta, st: F.st, plan: F.plan, lastLeg: F.lastLeg, hist: histOf(F),
      // (1.1.0: the fleet's habits the monitor's own - its owners, its logs - so the answer does not hang on which browser sent
      // the flight; a browser's where the monitor knows no fleet of it)
      fleet: (() => { const m = env.fleetOf ? env.fleetOf(F.hex) : null; return m ? [...m] : F.fleet ? [...F.fleet] : null; })(), rested: F.rested, origin: F.origin, dl: env.datalink ? env.datalink(F.rec.reg) || null : null,
      confirmed: env.confirmedOf && F.hex ? env.confirmedOf(F.id, F.hex) : null };
  }
  // (t0: when the job was taken - a mark to work it out again set since stays for the next round)
  function done(F, out, ms, t0) {
    S.ms += ms; S.msMax = Math.max(S.msMax, ms); F.routeAt = now(); F.dirty = false; F.computing = false; if (!(F.soon > (t0 || 0))) F.soon = 0;
    if (!out || out.err) { S.failed++; S.lastErr = String((out && out.err) || 'no answer').slice(0, 160); return null; }
    S.computed++; F.route = out.r; F.origin = out.origin; if (fin(out.maxAlt)) F.st.maxAlt = Math.max(F.st.maxAlt, out.maxAlt);
    // (1.1.0: every answer noted - its score once the flight is down: scores.cjs)
    if (env.onAnswer && F.route) { try { env.onAnswer(F, F.route); } catch (e) { S.lastErr = 'onAnswer: ' + String(e && e.message || e).slice(0, 120); } }
    return F.route;
  }
  // On the main thread, now (no workers): the answer
  function compute(F) {
    if (!calc.ctx || !F.pos) return null;
    const t0 = Date.now(), at = now(); let out;
    try { out = calc.run(jobOf(F)); } catch (e) { out = { err: String(e && e.message || e) }; }
    const ms = Date.now() - t0; spent.push([now(), ms]);
    return done(F, out, ms, at);
  }
  // On the flight's worker: when it is in
  function computeAsync(F) {
    if (!F.pos) return Promise.resolve(null);
    if (!pool) return Promise.resolve(compute(F));
    if (F.computing) return F.computing;
    const at = now(), p = pool.run(jobOf(F)).then(m => done(F, m, (m && m.ms) || 0, at), e => done(F, { err: String(e && e.message || e) }, 0, at));
    F.computing = p;
    return p;
  }
  // (a flight no browser has sent anything of lately: what the monitor has of it itself - a flight it named, its track
  // from the networks it polls and FR24's trail)
  function self(id) {
    let F = flights.get(+id);
    if (S.on && env.selfEvidence && (!F || now() - F.at > 120000)) { const x = env.selfEvidence(+id); if (x) { if (F && F.trail.length) x.trail.full = false; take(x); F = flights.get(+id); if (F) F.self = true; } }
    return F;
  }
  // (worked out again when there is more to go on and its last answer is over `every` seconds old)
  const due = F => !!F && !!F.pos && !F.computing && (!F.routeAt || F.soon || (F.dirty && now() - F.routeAt >= C.every * 1000));
  // (what the monitor knows of a flight besides its track has changed - a destination confirmed in a browser: worked out
  // again the next time it is asked for, whenever it last was)
  function again(id) { const F = flights.get(+id); if (!F) return false; F.soon = now() + 1; return true; }
  // A flight's answer: worked out again when due - here within the minute's allowance, or on its worker (in a moment) -
  // the last one otherwise. null: none.
  function routeOf(id) {
    const F = self(id);
    if (!F) return null;
    if (S.on && due(F)) {
      if (pool) { if (pool.busy() < S.workers * C.perWorker) computeAsync(F); else S.overBudget++; }
      else if (!busy() && !(env.busy && env.busy())) compute(F); else S.overBudget++;
    }
    if (!F.route) return null;
    S.served++; return { at: F.routeAt, age: Math.max(0, now() - F.routeAt), r: F.route };
  }
  // POST /calc: { flights: [evidence] } -> { v, on, routes: { id: { at, r } }, full: [ids whose whole track is wanted] }
  // (with workers: the flights sent worked out at once and waited for - a second at most)
  function answer(body) {
    const out = { v: 1, on: S.on, routes: {}, full: [] };
    if (!S.on) { out.why = S.why; return out; }
    const list = body && Array.isArray(body.flights) ? body.flights.slice(0, 60) : [];
    for (const x of list) { if (!x || typeof x !== 'object') continue; if (take(x) === 'full') out.full.push(+x.id); }
    const more = body && Array.isArray(body.ids) ? body.ids.slice(0, 200) : [];
    const fill = () => { for (const x of list) { const r = x && routeOf(x.id); if (r) out.routes[x.id] = r; } for (const id of more) { const r = routeOf(id); if (r) out.routes[id] = r; } S.flights = flights.size; return out; };
    if (!pool) return fill();
    const waits = []; for (const x of list) { const F = x && flights.get(+x.id); if (F && due(F)) waits.push(computeAsync(F)); }
    if (!waits.length) return fill();
    return Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 1000))]).then(fill);
  }
  function prune() {
    const t = now();
    for (const [id, F] of flights) if (t - F.at > C.keepMin * 60000) flights.delete(id);
    for (const [k, v] of wxMap) if (!(t - v.at < 90 * 60000)) wxMap.delete(k);
    if (closedMap.size > 500) closedMap.clear();
    S.flights = flights.size;
  }
  function close() { if (pool) pool.close(); pool = null; S.workers = 0; }
  return { start, take, compute, computeAsync, routeOf, answer, again, prune, close, self, due, flights, stats: S, overBudget: () => pool ? pool.busy() >= S.workers * C.perWorker : busy() || !!(env.busy && env.busy()),
    get ctx() { return calc.ctx; }, get pool() { return pool; }, wxMap, closedMap, histOf, surgeChanged, learnedOps };
}

module.exports = { createCentral, createCalc, compactTables, loadTables, packApproach, blockOf, BLOCKS, cleanPt };
