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
// room (CFG.centralFreeMb free after start, 300 MB by default); otherwise there is no central calculation and every
// browser works routes out itself, as before. CPU: CFG.centralMsPerMin of work a minute at most (12 s); past it, the last
// answer is given, or none - the browser's own then stands.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const fin = v => typeof v === 'number' && isFinite(v);
// (a browser's object kept only when it is small: weather, closures, what was seen of a hole in coverage)
const small = (v, n) => { try { const j = JSON.stringify(v); return j && j.length <= (n || 2000) ? JSON.parse(j) : null; } catch (e) { return null; } };
const BLOCKS = [['03-data.js', 'ROUTE-SITES'], ['03-data.js', 'ROUTE-PLACE'], ['04-routes.js', 'ROUTE-NOTE'], ['04-routes.js', 'ROUTE-DL'], ['04-routes.js', 'ROUTE-CORE']];
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

function createCentral(env) {
  const E = env.E, now = env.now || (() => Date.now()), C = Object.assign({ every: 15, keepMin: 30, msPerMin: 12000, maxFlights: 1500, maxPts: 3000, allPts: 400000, histMin: 15 }, env.cfg || {});
  const S = { on: false, why: 'not loaded', mb: 0, flights: 0, evidence: 0, computed: 0, served: 0, cached: 0, overBudget: 0, failed: 0, lastErr: '', ms: 0, msMax: 0, at: 0 };
  const flights = new Map();        // FR24 flight id -> what is known of it (below)
  const wxMap = new Map(), closedMap = new Map();   // ICAO -> the weather / closures browsers sent (as theirs)
  const histCache = new Map();      // hex -> { at, legs }
  let spent = [], ctx = null, cur = null;
  // ---- the userscript's route code, in a context of its own -----------------------------------------------------------
  // (every name it uses from outside its blocks, given here; cur: the flight being worked out)
  function build(mainDir) {
    const box = {
      ENGINE: E, ENGINE_HIST_DAYS: 220, NM_KM: 1.852, fin, dist: E.dist, log: () => {}, now: () => now(), nowS: () => now() / 1000,
      sleep: ms => new Promise(r => setTimeout(r, ms)), SITES_URL: '', gmRequest: () => Promise.reject(new Error('not on the monitor')),
      store: { getHex: () => ({}), getHist: () => Promise.resolve(null), setHist() {}, kvGet: () => null },
      osmPlaceAt: () => null, wantOsmPlace() {}, scheduleReplan() {}, wantWx() {}, wantNotams() {}, onScreen: () => false,
      datalinkRoutes: reg => (env.datalink ? env.datalink(reg) : null) || null,
      acOf: rec => (rec && rec.ac) || cleanAc(null, rec && rec.hex), airportsReady: () => E.airports.length > 1000,
      apById: id => (id && E.byId(id)) || null, apCode: a => a ? (a.iata || a.icao || String(a.id)) : '',
      calibP: p => p, wxMap, closedMap, srvIds: { rows: new Map() }, crowdOf: () => null, crowdContradicted: () => true,
      currentPos: () => null, trailFor: () => [], fleetVisits: () => (cur && cur.fleet) || null, knownLegs: () => (cur && cur.hist) || [],
      live: new Map(), pubRecs: new Map(), planState: new Map(), routeState: new Map(), todayCache: new Map(),
      schedPlan: () => null, restedAfter: () => !!(cur && cur.rested), surgeNow: () => (env.surge ? env.surge() : null),
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
  // Starts it: the tables loaded and the code read - or not, with why (/status)
  async function start(o) {
    o = o || {};
    if (fin(o.free)) S.freeMb = Math.round(o.free / 1048576);
    if (o.off) { S.why = 'turned off (monitor.json "central": false)'; return S; }
    if (fin(o.free) && o.free < (o.needMb || 300) * 1048576) { S.why = `${Math.round(o.free / 1048576)} MB free at start, ${o.needMb || 300} MB wanted - every browser works routes out itself`; return S; }
    try {
      S.mb = await loadTables(E, o.srcDir, o.mainDir);
      ctx = build(o.mainDir);
      // (the landing sites - 60 MB more - only with room left: without them a pad or strip is named less closely)
      const left = o.freeNow ? o.freeNow() : Infinity;
      if (o.sitesCsv && !(left < (o.sitesMb || 250) * 1048576)) S.sites = await loadSites(o.sitesCsv);
      else if (o.sitesCsv) S.sitesWhy = `${Math.round(left / 1048576)} MB free after the tables - landing sites not loaded`;
      if (o.learnedOps) { let n = 0; for (const op of o.learnedOps) if (E.addLearnedOp(op)) n++; S.learned = n; }
      S.on = true; S.why = ''; S.at = now(); if (o.freeNow) { const f = o.freeNow(); if (fin(f)) S.freeAfterMb = Math.round(f / 1048576); }
    } catch (e) { S.on = false; S.why = 'failed: ' + String(e && e.message || e).slice(0, 120); ctx = null; }
    return S;
  }
  const get = name => vm.runInContext(name, ctx);

  // ---- what browsers send of a flight ---------------------------------------------------------------------------------
  // x: { id, hex, kind: 'live' (a blocked flight) | 'pub' (an ordinary one), ac, pos, trail: { full, pts, cut, gapFrom,
  // gapInfo }, plan, st: { maxAlt, landedAt }, lastLeg, rested, fleet: [[airport id, n]], today: [legs], wx: { ICAO: entry },
  // closed: { ICAO: [...] } } -> 'full' when the track it added to was not the one held here (send it whole), else ''
  function take(x) {
    const id = +x.id, hex = String(x.hex || '').toLowerCase(); if (!(id > 0) || !/^[0-9a-f]{6}$/.test(hex)) return '';
    let F = flights.get(id);
    if (!F || F.hex !== hex) {
      if (!F && flights.size >= C.maxFlights) return '';
      F = { id, hex, rec: { id, hex }, kind: 'pub', pos: null, trail: [], meta: {}, plan: null, st: { maxAlt: 0, landedAt: 0 }, lastLeg: null, rested: false, fleet: null, today: [], at: 0, route: null, routeAt: 0, dirty: true };
      flights.set(id, F);
    }
    S.evidence++; F.at = now(); F.kind = x.kind === 'live' ? 'live' : 'pub';
    const ac = cleanAc(x.ac, hex); F.rec.ac = ac; for (const k of ['reg', 'type', 'cs', 'cat', 'mil', 'ladd', 'pia']) F.rec[k] = ac[k];
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
    const t = now();
    if (x.wx && typeof x.wx === 'object') for (const [k, v] of Object.entries(x.wx).slice(0, 12)) { const w = /^[A-Z0-9]{4}$/.test(k) && v && typeof v === 'object' && fin(v.at) && t - v.at < 90 * 60000 ? small(v, 4000) : null; if (w) wxMap.set(k, w); }
    if (x.closed && typeof x.closed === 'object') for (const [k, v] of Object.entries(x.closed).slice(0, 12)) { const c = /^[A-Z0-9]{4}$/.test(k) && Array.isArray(v) ? small(v.slice(0, 10), 4000) : null; if (c) closedMap.set(k, c); }
    if (wxMap.size > 3000) wxMap.delete(wxMap.keys().next().value);
    if (closedMap.size > 3000) closedMap.delete(closedMap.keys().next().value);
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
    const c = histCache.get(F.hex); if (c && now() - c.at < C.histMin * 60000) return c.legs;
    let legs = [];
    try { legs = (env.logOf ? env.logOf(F.hex) : []) || []; } catch (e) { legs = []; }
    const extra = F.today.filter(l => !legs.some(m => m.tStart < l.tEnd && m.tEnd > l.tStart));
    legs = extra.length ? E.chainLegs(E.stitchLegs(legs.concat(extra).sort((a, b) => a.tStart - b.tStart).map(l => Object.assign({}, l)))) : legs;
    histCache.set(F.hex, { at: now(), legs }); if (histCache.size > 2000) histCache.delete(histCache.keys().next().value);
    return legs;
  }
  // ---- working one out --------------------------------------------------------------------------------------------------
  const busy = () => { const t = now(); spent = spent.filter(x => t - x[0] < 60000); return spent.reduce((n, x) => n + x[1], 0) >= C.msPerMin; };
  function compute(F) {
    if (!ctx || !F.pos) return null;
    const live = get('live'), pubRecs = get('pubRecs'), routeState = get('routeState'), planState = get('planState'), todayCache = get('todayCache');
    live.clear(); pubRecs.clear(); routeState.clear(); planState.clear(); todayCache.clear();
    (F.kind === 'live' ? live : pubRecs).set(F.id, F.rec);
    F.st.maxAlt = Math.max(F.st.maxAlt, ...F.trail.map(p => p.alt || 0));
    routeState.set(F.id, F.st); if (F.plan) planState.set(F.id, { plan: F.plan });
    if (F.lastLeg) todayCache.set(F.hex, { sums: [F.lastLeg] });
    const trail = F.trail.map(p => Object.assign({}, p)); trail.cut = !!F.meta.cut; trail.gapFrom = F.meta.gapFrom || null; trail.gapInfo = F.meta.gapInfo || null;
    cur = { hist: histOf(F), fleet: F.fleet, rested: F.rested };
    const t0 = Date.now();
    try {
      const r = get('composeRoute0')(F.id, F.hex, { pos: Object.assign({}, F.pos), trail });
      S.computed++; F.route = r ? JSON.parse(JSON.stringify(r)) : null; F.routeAt = now(); F.dirty = false;
      return F.route;
    } catch (e) { S.failed++; S.lastErr = String(e && e.message || e).slice(0, 160); F.routeAt = now(); F.dirty = false; return null; }
    finally { const ms = Date.now() - t0; spent.push([now(), ms]); S.ms += ms; S.msMax = Math.max(S.msMax, ms); cur = null; live.clear(); pubRecs.clear(); }
  }
  // A flight's answer: worked out again when there is more to go on and its last is over `every` seconds old - within the
  // minute's allowance; the last one otherwise. null: none.
  function routeOf(id) {
    let F = flights.get(+id);
    // (a flight no browser has sent anything of lately: what the monitor has of it itself - a flight it named, its track
    // from the networks it polls and FR24's trail)
    if (S.on && env.selfEvidence && (!F || now() - F.at > 120000)) { const x = env.selfEvidence(+id); if (x) { if (F && F.trail.length) x.trail.full = false; take(x); F = flights.get(+id); if (F) F.self = true; } }
    if (!F) return null;
    const age = now() - F.routeAt;
    if (S.on && (!F.routeAt || (F.dirty && age >= C.every * 1000))) { if (!busy() && !(env.busy && env.busy())) compute(F); else S.overBudget++; }
    if (!F.route) return null;
    S.served++; return { at: F.routeAt, age: Math.max(0, now() - F.routeAt), r: F.route };
  }
  // POST /calc: { flights: [evidence] } -> { v, on, routes: { id: { at, r } }, full: [ids whose whole track is wanted] }
  function answer(body) {
    const out = { v: 1, on: S.on, routes: {}, full: [] };
    if (!S.on) { out.why = S.why; return out; }
    const list = body && Array.isArray(body.flights) ? body.flights.slice(0, 60) : [];
    for (const x of list) { if (!x || typeof x !== 'object') continue; if (take(x) === 'full') out.full.push(+x.id); }
    for (const x of list) { const r = x && routeOf(x.id); if (r) out.routes[x.id] = r; }
    const more = body && Array.isArray(body.ids) ? body.ids.slice(0, 200) : [];
    for (const id of more) { const r = routeOf(id); if (r) out.routes[id] = r; }
    S.flights = flights.size;
    return out;
  }
  function prune() {
    const t = now();
    for (const [id, F] of flights) if (t - F.at > C.keepMin * 60000) flights.delete(id);
    for (const [k, v] of wxMap) if (!(t - v.at < 90 * 60000)) wxMap.delete(k);
    if (closedMap.size > 500) closedMap.clear();
    S.flights = flights.size;
  }
  return { start, take, compute, routeOf, answer, prune, flights, stats: S, get ctx() { return ctx; }, wxMap, closedMap, histOf };
}

module.exports = { createCentral, compactTables, loadTables, packApproach, blockOf, BLOCKS, cleanPt };
