// FR24 LADD unblocker - the permanent monitor. Runs on its own (node monitor.cjs), whether FR24 is open or not:
//  - every 30 s adsb.lol's LADD list (every aircraft whose owner asked the FAA to keep it off public sites, worldwide)
//  - every 60 s its military list, every 2 minutes its PIA list (privacy addresses) - adsb.fi's military list while
//    adsb.lol rate-limits - so the userscript needs none of these lists itself while the monitor answers (/live)
//  - every 60 s, by their addresses, every other blocked aircraft known (FR24 hides more than the FAA list: the
//    Isle of Man BAE shuttles, Guernsey and San Marino jets...) - wherever in the world they fly
//  - every 60 s every aircraft around the areas of monitor.json (default: the UK and Ireland) and the places the
//    userscript has been looking at (its boards and map, anywhere in the world)
// Each aircraft's positions become flights with the userscript's own engine (take-off, landing, airports), kept for
// 90 days (blocked aircraft) or 4 days (the rest). What it missed while it was off - or before it knew of an aircraft -
// it reads back from adsb.lol's day traces (three days back). And every finished day of every blocked aircraft that
// flew is rebuilt from adsb.lol's full day trace, exactly as the userscript builds its flight logs (/hist): the browser
// then reads those days here instead of fetching them from adsb.lol itself.
// The userscript asks it (data: adsb.lol, ODbL):
//  /status                       what it has
//  /live                         every LADD / military / PIA / blocked aircraft heard in the last 5 minutes (readsb rows)
//  /board?ap=<FR24 airport id>   flights at an airport, three days back to now (both ends, as rebuilt logs)
//  /legs?hex=<icao>[,<icao>..]   aircraft's flights (90 days)
//  /hist?hex=<icao>[,<icao>..]   blocked aircraft's finished days in the userscript's flight-log format (and days with none)
//  /ladd                         the LADD list as last polled (fresh, no rate limit for the userscript)
//  /last                         where each blocked jet was last heard in the last 14 h (to recognise it over an ocean)
//  /seed?hex=a,b[&front=1]       blocked aircraft the userscript knows: tracked from now on, their last days rebuilt
//  /parked?ap=&type=             aircraft of a type whose last flight ended at that airport (14 days): parked there since
//  /area?lat=&lon=               a place the userscript is looking at: its traffic polled too, for three days
const fs = require('fs');
const path = require('path');
const http = require('http');
const DIR = __dirname, DATA = process.env.MON_DATA || path.join(DIR, 'data'), STORE = process.env.MON_STORE || path.join(DIR, 'store');
const PORT = +(process.env.PORT || process.env.MON_PORT || 47524), HOST = process.env.MON_HOST || '127.0.0.1';
// (shared on a server: MON_TOKEN makes every request carry the secret - header X-Monitor-Token - and MON_RATE caps requests per minute
// per address; both off by default, so the monitor on one's own computer is as before)
const TOKEN = process.env.MON_TOKEN || '', RATE = +(process.env.MON_RATE || 0), hits = new Map();
const limited = ip => { if (!RATE) return false; const t = Math.floor(Date.now() / 60000), h = hits.get(ip); if (!h || h.t !== t) { hits.set(ip, { t, n: 1 }); if (hits.size > 5000) hits.clear(); return false; } return ++h.n > RATE; };
// laddEvery/milEvery/piaEvery/areaEvery/hexEvery: seconds between polls; apiPerMin: adsb.lol API requests a minute at most
// (all of them together); liveMaxAge: seconds an aircraft stays in /live after its last position; closeDelayH: hours after
// a day ends before its flights are rebuilt from adsb.lol's day traces (published with some delay); fullGap: the longest
// silence (s) of the lists in a day for it to count as watched throughout
const CFG = Object.assign({ areas: [[53.8, -2.6, 250]], laddEvery: 30, milEvery: 60, piaEvery: 120, areaEvery: 60, hexEvery: 60, hexBatch: 100, backWorkers: 3, userAreas: 3, apiPerMin: 20, liveMaxAge: 300, closeDelayH: 3, fullGap: 200, apiWindowMs: 60000, openskyEvery: 900, adsbxDaily: 150, adsbxKey: process.env.MON_ADSBX_KEY || '' }, (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'monitor.json'), 'utf8')); } catch (e) { return {}; } })());
const { createRouteEngine } = require(fs.existsSync(path.join(DIR, 'engine.js')) ? path.join(DIR, 'engine.js') : '../src/engine.js');
const E = createRouteEngine();
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);

function loadEngine() {
  E.setAirports(JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows);
  const rd = f => { const p = path.join(DATA, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  const rw = rd('runways.json'); if (rw) E.setRunways(rw);
  const rl = rd('runway_len.json'); if (rl) E.setRunwayLengths(rl);
  const oa = path.join(DATA, 'oa_airports.csv');
  if (fs.existsSync(oa)) { const fields = require(fs.existsSync(path.join(DIR, 'dataset.cjs')) ? path.join(DIR, 'dataset.cjs') : '../test/dataset.cjs').loadFields(DATA); E.setFields(fields); }
}

const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const dayStart = d => Date.parse(d + 'T00:00:00Z') / 1000;
const slashDay = d => d.replace(/-/g, '/');           // (the userscript's day keys: 'YYYY/MM/DD')
// (the days from the one of time a to the one of time b, both included)
const daysBetween = (a, b) => { const out = []; for (let d = dayOf(a), z = dayOf(b); d <= z; d = dayOf(dayStart(d) + 86400)) out.push(d); return out; };

// ---- the blocked aircraft (kept on disk: the FAA list's and every one the userscript has identified) ----------------
const blocked = new Map();   // hex -> { reg, type, at: known since, heard: last heard, faa: on the LADD list, lad: last seen with the LADD flag }
let laddNow = new Set();     // hexes in the LADD list as last polled (those need no asking by address)
const userAreas = [];        // [lat, lon, radius nm, last asked]
let lastRun = 0, stateDirty = false;
const isBlocked = hex => blocked.has(hex);
function markBlocked(hex, m, nowS) {
  let b = blocked.get(hex);
  if (!b) { blocked.set(hex, b = { reg: '', type: '', at: Math.round(nowS), heard: 0 }); stateDirty = true; wantBackfill(hex, nowS); }
  if (m && m.reg && b.reg !== m.reg) { b.reg = m.reg; stateDirty = true; }
  if (m && m.type && b.type !== m.type) { b.type = m.type; stateDirty = true; }
  return b;
}

// ---- which days the lists were watched without a gap: a blocked aircraft not heard in the air on such a day did not fly
// (as far as adsb.lol knows) - the userscript need not ask adsb.lol for that day at all. 'ladd': the LADD list (the FAA's
// aircraft), 'hex': a whole round of the others by address. Per day [first, last, longest gap] of the polls touching it.
const watch = {};            // 'YYYY-MM-DD' -> { ladd: [a, z, gap], hex: [a, z, gap] }
const lastW = {};            // kind -> time of its last good round (kept across restarts: the time off counts as a gap)
function noteWatch(kind, t) {
  const p = lastW[kind]; lastW[kind] = t;
  if (!p || t <= p) return;
  for (const d of daysBetween(p, t)) { const w = watch[d] || (watch[d] = {}), x = w[kind]; if (!x) w[kind] = [p, t, t - p]; else { x[0] = Math.min(x[0], p); x[1] = Math.max(x[1], t); x[2] = Math.max(x[2], t - p); } }
}
const watchedAll = (d, kind) => { const x = watch[d] && watch[d][kind], s = dayStart(d); return !!x && x[0] <= s && x[1] >= s + 86400 && x[2] <= CFG.fullGap; };
// blocked aircraft heard in the air, by day - until that day's flights are rebuilt from adsb.lol's day trace
const flew = new Map();      // 'YYYY-MM-DD' -> Set(hex)
let closed = '';             // the last day whose flights were sent to be rebuilt
const flewAdd = (hex, d) => { let s = flew.get(d); if (!s) flew.set(d, s = new Set()); if (!s.has(hex)) { s.add(hex); stateDirty = true; } };

function saveState() {
  fs.mkdirSync(STORE, { recursive: true });
  const f = path.join(STORE, 'state.json'), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ v: 2, lastRun, blocked: Object.fromEntries([...blocked].map(([h, b]) => [h, [b.reg, b.type, b.at, b.heard, b.faa ? 1 : 0, b.lad || 0]])), areas: userAreas,
    watch, lastW, closed, flew: Object.fromEntries([...flew].map(([d, s]) => [d, [...s]])), histQ: histQ.map(j => [j.hex, j.day, j.tries, j.at]) }));
  fs.renameSync(tmp, f); stateDirty = false;
}
function loadState() {
  let s = null; try { s = JSON.parse(fs.readFileSync(path.join(STORE, 'state.json'), 'utf8')); } catch (e) { return null; }
  for (const [h, b] of Object.entries(s.blocked || {})) blocked.set(h, { reg: b[0] || '', type: b[1] || '', at: b[2] || 0, heard: b[3] || 0, faa: !!b[4], lad: b[5] || 0 });
  for (const a of s.areas || []) if (Array.isArray(a) && a.length === 4) userAreas.push(a);
  Object.assign(watch, s.watch || {}); Object.assign(lastW, s.lastW || {}); closed = s.closed || '';
  for (const [d, l] of Object.entries(s.flew || {})) for (const h of l) flewAdd(h, d);
  for (const [hex, day, tries, at] of s.histQ || []) queueHist(hex, day, tries, at);
  return s;
}

// ---- positions -> flights ----------------------------------------------------------------------------------------
const ac = new Map();        // hex -> { meta: {reg,type,cs,mil,cat}, rows: [readsb trace rows], last, first, dirty }
const legs = new Map();      // hex -> Map(key -> leg)
const dirtyDays = new Set();
let lastLadd = { at: 0, ac: [] };
const legKey = l => Math.round((l.tOff || l.tStart) / 600);
// Every LADD / military / PIA / blocked aircraft heard lately, as its newest report (what the userscript matches FR24's
// blocked flights against - only the fields it reads)
const LIVE_KEYS = ['hex', 'flight', 'r', 't', 'desc', 'ownOp', 'year', 'lat', 'lon', 'alt_baro', 'alt_geom', 'gs', 'track', 'dbFlags', 'squawk', 'category', 'emergency', 'baro_rate', 'geom_rate', 'ias', 'tas', 'mach', 'oat', 'wd', 'ws', 'nav_altitude_mcp', 'nav_altitude_fms', 'nav_heading', 'nav_qnh'];
const live = new Map();      // hex -> { a: report, t: time of its position (s) }
const lastOk = {};           // list -> when it last answered (ms): ladd, mil, pia, hex, area

// one aircraft's report (adsb.lol /v2 format) at poll time nowS
function ingest(a, nowS) {
  if (!a || !a.hex || a.lat == null || a.lon == null) return;
  const hex = String(a.hex).toLowerCase().replace(/^~/, ''), t = Math.round(nowS - (a.seen_pos != null ? a.seen_pos : a.seen || 0));
  if (a.dbFlags & 8) { const b0 = markBlocked(hex, { reg: a.r, type: a.t }, nowS); if (!b0.faa) { b0.faa = true; stateDirty = true; } if (t > (b0.lad || 0)) b0.lad = t; }
  // (heard without the flag - its owner has left the LADD programme: no longer on that list, so asked for by address)
  else if (a.dbFlags != null && blocked.has(hex) && blocked.get(hex).faa) { blocked.get(hex).faa = false; stateDirty = true; }
  if ((a.dbFlags & 13) || blocked.has(hex)) { const p = live.get(hex); if (!p || t >= p.t) { const o = {}; for (const k of LIVE_KEYS) if (a[k] != null) o[k] = a[k]; live.set(hex, { a: o, t }); } }
  if (blocked.has(hex) && a.alt_baro !== 'ground' && a.alt_baro != null) flewAdd(hex, dayOf(t));
  let x = ac.get(hex); if (!x) ac.set(hex, x = { meta: {}, rows: [], last: 0, first: t, dirty: false });
  const m = x.meta, cs = String(a.flight || '').trim();
  if (a.r) m.reg = a.r; if (a.t) m.type = a.t; if (a.desc) m.desc = a.desc; if (a.ownOp) m.ownOp = a.ownOp; if (a.category) m.cat = a.category;
  if (a.dbFlags & 1) m.mil = true; if (a.dbFlags & 4) m.pia = true;
  const b = blocked.get(hex); if (b && t > b.heard) { b.heard = t; if (!b.reg && a.r) b.reg = a.r; }
  if (t <= x.last) return;
  const csNew = cs && cs !== m.cs; if (cs) m.cs = cs;
  x.rows.push([t, a.lat, a.lon, a.alt_baro === 'ground' ? 'ground' : a.alt_baro, a.gs, a.track, 0, a.baro_rate != null ? a.baro_rate : a.geom_rate, csNew ? { flight: cs } : null, a.type || null, a.alt_geom]);
  x.last = t; x.dirty = true;
  m.lastPos = { t, lat: a.lat, lon: a.lon, alt: a.alt_baro, gs: a.gs, trk: a.track };
}
// The flights in an aircraft's kept positions; finished ones stored, their positions let go
function buildLegs(hex, nowS) {
  const x = ac.get(hex); if (!x || !x.dirty || x.rows.length < 2) return;
  x.dirty = false;
  const bl = blocked.get(hex);
  const info = { hex, type: x.meta.type || (bl && bl.type) || '', reg: x.meta.reg || (bl && bl.reg) || '', cs: x.meta.cs || '', mil: !!x.meta.mil, cat: x.meta.cat || '' };
  const cls = E.classify(info);
  let ls; try { ls = E.legsFromPoints(E.parseTrace({ timestamp: 0, trace: x.rows }), { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', cls, type: info.type, rangeKm: E.typeRangeKm(info) }); } catch (e) { return; }
  let keepFrom = 0;
  ls.forEach((l, i) => {
    let s; try { s = E.summarizeLeg(l, { cls, type: info.type, grp: E.groupOf(cls), mil: info.mil }); } catch (e) { return; }
    const last = i === ls.length - 1;
    if (!l.pts.some(p => !p.gnd)) return;                                  // (never off the ground: taxiing)
    // (first heard already in the air and not climbing - on final, say: where it came from was not heard, not the
    // field it is about to land at)
    const f = l.pts[0], g = l.pts.find(p => p.t - f.t >= 60), climbing = !!(g && f.alt != null && g.alt != null && g.alt - f.alt > 200);
    if (f.t <= x.first + 60 && !s.startedOnGround && !climbing) s.from = null;
    // (done: landed and the next flight begun, or quiet on the ground/low for 20 minutes; an open one is kept as it goes.
    // Lost from view on the ground or low beside a field and silent 20 minutes: landed there - G-BOIL at -125 ft, 49 kt by
    // its strip stayed "open", no destination, for the 14 hours before)
    const lostLow = last && !s.ended && nowS - x.last > 1200 && !!s.to && /^(ground|low)$/.test(s.to.conf || '');
    const done = !last || (s.ended && nowS - x.last > 1200) || lostLow || nowS - x.last > 14 * 3600;
    const leg = { hex, reg: info.reg, type: info.type, cs: s.cs || info.cs, ladd: !!bl, from: s.from, to: done || s.ended ? s.to : null, tStart: s.tStart, tEnd: s.tEnd, tOff: s.tOff, tOn: s.tOn, ended: !!s.ended || lostLow, open: !done, startedOnGround: s.startedOnGround, startLat: s.startLat, startLon: s.startLon, endLat: s.endLat, endLon: s.endLon };
    let m = legs.get(hex); if (!m) legs.set(hex, m = new Map());
    // (a flight already under way when the monitor last stopped: its take-off as kept then)
    if (!leg.from && !leg.startedOnGround) for (const [k, o] of m) if (o.open && o.tStart < leg.tStart && leg.tStart - o.tEnd < 3 * 3600) { Object.assign(leg, { from: o.from, tStart: o.tStart, tOff: o.tOff, startedOnGround: o.startedOnGround, startLat: o.startLat, startLon: o.startLon }); m.delete(k); break; }
    m.set(legKey(leg), leg); dirtyDays.add(dayOf(leg.tOff || leg.tStart));
    if (done) keepFrom = l.end.t;
  });
  // (positions of finished flights are no longer needed; the last of them stays, for the next take-off)
  if (keepFrom) { const i = x.rows.findIndex(r => r[0] >= keepFrom); x.rows = i < 0 ? x.rows.slice(-1) : x.rows.slice(Math.max(0, i - 1)); }
  if (nowS - x.last > 14 * 3600) ac.delete(hex);
}

// ---- a blocked aircraft's flight log, day by day, as the userscript builds its own (03-data.js loadHistory): adsb.lol's
// full day trace through the same engine - legsFromPoints to the end of the day, summarizeLeg with what its earlier
// flights say of its home - and, for a day with a flight whose take-off or landing was not heard, airplanes.live's trace
// of that day merged in. One file per aircraft (90 days); read when asked, never all held in memory.
const HIST_V = 5;            // (the userscript's HIST_V: the same leg reconstruction, or its days are not used)
const HIST_DIR = path.join(STORE, 'hist');
const histFile = hex => path.join(HIST_DIR, hex + '.json');
const histStats = { built: 0, empty: 0, merged: 0, inc: 0, fails: 0 };
function histRead(hex) { try { const h = JSON.parse(fs.readFileSync(histFile(hex), 'utf8')); if (h && h.hv === HIST_V && h.days && Array.isArray(h.legs)) return h; } catch (e) { /* none yet */ } return { hv: HIST_V, days: {}, legs: [] }; }
function histWrite(hex, h) {
  fs.mkdirSync(HIST_DIR, { recursive: true });
  const cut = slashDay(dayOf(Date.now() / 1000 - KEEP_LADD));
  for (const d of Object.keys(h.days)) if (d < cut) delete h.days[d];
  h.legs = h.legs.filter(l => l.day >= cut).sort((a, b) => a.tStart - b.tStart);
  const f = histFile(hex), tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(h)); fs.renameSync(tmp, f);
}
// (a flight whose landing or take-off was not heard - lost low, ended in a hole, only a guess at the field - away from
// the day's ends: the userscript's rule for asking the other network)
const incomplete = (sums, day) => { const e = Math.min(Date.now() / 1000, dayStart(day) + 86400), b = e - 86400; return sums.some(x => (e - x.tEnd >= 1200 && (!x.ended || !x.to || x.to.conf === 'near' || x.how === 'gap' || x.how === 'gap-low')) || (x.tStart - b >= 600 && !x.startedOnGround && (!x.from || x.from.conf === 'near'))); };
// (what the userscript learns from a flight - squawk blocks, FMS altitudes, where it flew - needs the positions, which the
// summary does not keep: worked out here, alongside it)
function learnOf(raw, s) {
  if (!s.from || !s.to) return null;
  const sq = new Set(), fm = new Set();
  for (const p of raw.pts) { if (p.alt > 1500 && p.sq && /^[0-7]{4}$/.test(p.sq) && !E.SQ_NOINFO.test(p.sq)) sq.add(p.sq.slice(0, 2)); if (p.fms > 5000 && !(p.vr < -500)) fm.add(Math.round(p.fms / 2000)); }
  return [[...sq].join(','), [...fm].join(','), E.flowKeysOf(raw.pts, E.byId(s.to.id)).slice(0, 16).join('|')];
}
let apliveLast = 0;          // (airplanes.live's history files: one at a time, two seconds apart)
async function apliveTrace(hex, day) {
  const host = 'globe.airplanes.live';
  if (Date.now() < (pause[host] || 0)) throw new Error('paused');
  const wait = apliveLast + 2000 - Date.now(); apliveLast = Math.max(Date.now(), apliveLast + 2000); if (wait > 0) await sleep(wait);
  const r = await fetch(`https://${host}/globe_history/${slashDay(day)}/traces/${hex.slice(-2)}/trace_full_${hex}.json`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return null;
  // (refused - it asks scripts to keep to its globe now and then: left alone six hours; the userscript reads those days itself)
  if (r.status === 403 || r.status === 429) { pause[host] = Date.now() + 6 * 3600e3; throw new Error('HTTP ' + r.status); }
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  return JSON.parse(await r.text());
}
// (a day that could not be rebuilt - its file never came, or would not read: marked so - never taken for a day without
// flights; the userscript reads it itself)
function histUnknown(hex, day) {
  const h = histRead(hex), hd = slashDay(day);
  if (!(h.days[hd] >= 0)) { h.days[hd] = -1; histWrite(hex, h); }
  histStats.fails++;
}
// One day of one aircraft, from adsb.lol's trace of it (null: adsb.lol has none - no flights that day)
async function histDay(hex, day, j) {
  if (E.airports.length < 1000) throw new Error('airports not loaded');   // (never a log with no airports in it)
  const b = blocked.get(hex), x = ac.get(hex), meta = (x && x.meta) || {}, hd = slashDay(day);
  let pts = j ? E.parseTrace(j) : [];
  const info = { hex, type: String((j && j.t) || meta.type || (b && b.type) || '').toUpperCase(), reg: String((j && j.r) || meta.reg || (b && b.reg) || '').toUpperCase(), mil: !!((j && j.dbFlags & 1) || meta.mil), cat: meta.cat || ((pts.find(p => p.cat) || {}).cat) || '' };
  const cls = E.classify(info), opt = { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', cls, type: info.type, rangeKm: E.typeRangeKm(info), dataEnd: Math.min(Date.now() / 1000, dayStart(day) + 86400) };
  const h = histRead(hex);
  // (its home and usual fields, from its flights before that day - as the userscript's summary has them from its log)
  const before = E.chainLegs(E.stitchLegs(h.legs.filter(l => l.day < hd).map(l => Object.assign({}, l)))).slice(-60);
  const hs = E.histStats(before, Date.now() / 1000), ctx = { visits: hs.visits, base: hs.base, mil: info.mil, grp: E.groupOf(cls), cls, type: info.type };
  let raws = E.legsFromPoints(pts, opt), sums = raws.map(l => E.summarizeLeg(l, ctx)), inc = false;
  if (pts.length && incomplete(sums, day)) {
    try { const both = E.mergePoints(pts, E.parseTrace(await apliveTrace(hex, day))); if (both.length > pts.length) { pts = both; raws = E.legsFromPoints(pts, opt); sums = raws.map(l => E.summarizeLeg(l, ctx)); histStats.merged++; } }
    catch (e) { inc = true; histStats.inc++; }    // (the userscript reads that day itself, both networks)
  }
  const h2 = histRead(hex);   // (read again: another worker may have written a day meanwhile)
  h2.legs = h2.legs.filter(l => l.day !== hd).concat(sums.map((s, i) => Object.assign(s, { day: hd, lx: learnOf(raws[i], s) })));
  h2.days[hd] = inc ? -1 : sums.length;
  histWrite(hex, h2);
  if (sums.length) histStats.built++; else histStats.empty++;
  return sums.length;
}
// The days still to rebuild - one blocked aircraft's day each - after the day ends; persisted, retried a while when adsb.lol
// has not published the day's file yet
const histQ = [], histPend = new Set();
function queueHist(hex, day, tries, at) { const k = hex + '|' + day; if (histPend.has(k)) return; histPend.add(k); histQ.push({ hex, day, tries: tries || 0, at: at || 0 }); }
// (a day ended - and some hours more, for adsb.lol to publish it: each blocked aircraft heard in the air that day rebuilt)
function closeDays(nowS) {
  const ready = d => dayStart(d) + 86400 + CFG.closeDelayH * 3600 <= nowS;
  for (const d of [...flew.keys()].sort()) { if (!ready(d)) continue; for (const hex of flew.get(d)) queueHist(hex, d); flew.delete(d); stateDirty = true; }
  const c = dayOf(nowS - 86400 - CFG.closeDelayH * 3600); if (c > closed) { closed = c; stateDirty = true; }
}
async function histOne(job) {
  const { hex, day } = job, url = `https://adsb.lol/globe_history/${slashDay(day)}/traces/${hex.slice(-2)}/trace_full_${hex}.json`;
  const again = (ms, count) => { job.at = Date.now() + ms; if (count) job.tries++; histQ.push(job); };
  let j = null;
  try { j = await getJson(url); }
  catch (e) {
    const s = String(e && e.message || e);
    if (/429|paused/.test(s)) return again(120000, false);
    // (heard flying, no file: not published yet - asked again every two hours for a day and a half, then left to the
    // userscript, which reads that day itself)
    if (/HTTP 404/.test(s)) { if (Date.now() / 1000 < dayStart(day) + 86400 + 36 * 3600) return again(2 * 3600e3, true); }
    else if (job.tries < 6) return again(10 * 60000, true);
    histPend.delete(hex + '|' + day); histUnknown(hex, day); return;
  }
  histPend.delete(hex + '|' + day);
  if (j && Array.isArray(j.trace)) await histDay(hex, day, j); else histUnknown(hex, day);
}
const nextHist = () => { const n = Date.now(), i = histQ.findIndex(j => j.at <= n); return i < 0 ? null : histQ.splice(i, 1)[0]; };
// What the userscript gets for an aircraft: the days rebuilt here, and the days it was watched throughout and not heard
// in the air (no flights - nothing to fetch); a day still to be rebuilt, or that could not be, is not among them. An
// aircraft of the FAA's list counts as watched by that list only while it is seen on it (with the flag) - within two weeks
// of the day: one whose owner has left the programme is on no list, and its days are not claimed)
const LAD_SPAN = 14 * 86400
function histOf(hex) {
  const b = blocked.get(hex), h = fs.existsSync(histFile(hex)) ? histRead(hex) : { days: {}, legs: [] }, days = {};
  for (const [d, n] of Object.entries(h.days)) if (n >= 0) days[d] = n;
  if (b) for (const d of Object.keys(watch)) {
    const hd = slashDay(d); if (hd in h.days || d > closed || dayStart(d) < b.at) continue;
    if (histPend.has(hex + '|' + d) || (flew.get(d) && flew.get(d).has(hex))) continue;
    if (b.faa ? (b.lad || 0) >= dayStart(d) - LAD_SPAN && watchedAll(d, 'ladd') : watchedAll(d, 'hex')) days[hd] = 0;
  }
  return { hex, days, legs: h.legs.filter(l => days[l.day] > 0) };
}

// ---- what a blocked aircraft flew while the monitor did not hear it: adsb.lol's traces of those days - today's for a
// flight under way when first heard (its take-off), the three days before for one it has just learned of (M-ARNZ's
// Barrow shuttles of the week, T7-MUSIC into Toulouse), and every day the monitor was off. Three files at a time.
const backQ = [], backDone = new Set();
function wantBackfill(hex, nowS) {
  if (backDone.has(hex)) return; backDone.add(hex);
  const m = legs.get(hex), have = m && [...m.values()].some(l => nowS - l.tEnd < 3 * 86400);
  backQ.push({ hex, days: have ? [dayOf(nowS)] : [3, 2, 1, 0].map(k => dayOf(nowS - k * 86400)) });
}
// (aircraft the userscript has identified - parked now, transponder off, so never heard here: known from now on)
function seed(hexes, front, nowS) {
  let n = 0;
  for (const h of hexes) {
    const hex = String(h).toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) continue;
    const had = backDone.has(hex); markBlocked(hex, null, nowS);
    if (had) continue;
    wantBackfill(hex, nowS); n++;
    if (front) backQ.unshift(backQ.pop());
  }
  return n;
}
// (after a time off - the monitor stopped overnight - every blocked aircraft's days since, the most recently heard
// first)
function gapFill(from, nowS) {
  const days = []; for (let t = Math.max(from, nowS - 3 * 86400); dayOf(t) <= dayOf(nowS); t += 86400) days.push(dayOf(t));
  if (!days.includes(dayOf(nowS))) days.push(dayOf(nowS));
  const list = [...blocked].sort((a, b) => b[1].heard - a[1].heard);
  for (const [hex] of list) { if (backDone.has(hex)) continue; backDone.add(hex); backQ.push({ hex, days: days.slice() }); }
  log('time off since', new Date(from * 1000).toISOString().slice(0, 16), '-', list.length, 'blocked aircraft,', days.length, 'days each');
}
async function backfillOne({ hex, days }) {
  const rows = [], today = dayOf(Date.now() / 1000);
  for (const d of days) {
    const url = `https://adsb.lol/${d === today ? 'data' : 'globe_history/' + slashDay(d)}/traces/${hex.slice(-2)}/trace_full_${hex}.json`;
    let j = null, none = false;
    try { j = await getJson(url); } catch (e) { if (/429|paused/.test(String(e))) { backQ.unshift({ hex, days: days.slice(days.indexOf(d)) }); await sleep(60000); return; } none = /HTTP 404/.test(String(e)); }
    if (j && Array.isArray(j.trace)) {
      for (const p of j.trace) rows.push([j.timestamp + p[0]].concat(p.slice(1, 11)));
      if (j.dbFlags & 8 || isBlocked(hex)) markBlocked(hex, { reg: j.r, type: j.t }, Date.now() / 1000);
      if (j.r || j.t) { const x0 = ac.get(hex) || ac.set(hex, { meta: {}, rows: [], last: 0, first: Date.now() / 1000, dirty: false }).get(hex); if (j.r && !x0.meta.reg) x0.meta.reg = j.r; if (j.t && !x0.meta.type) x0.meta.type = j.t; if (j.dbFlags & 1) x0.meta.mil = true; }
    }
    // (a past day: its flight log as the userscript would build it, from this same file - and a day adsb.lol has no file
    // for, well after it ended, a day without flights; today: in the air today, so rebuilt once the day is over)
    if (isBlocked(hex)) {
      if (d !== today && ((j && Array.isArray(j.trace)) || (none && Date.now() / 1000 > dayStart(d) + 86400 + 6 * 3600))) { try { await histDay(hex, d, j); } catch (e) { log('history day', hex, d, String(e)); } }
      else if (d === today && j && Array.isArray(j.trace) && j.trace.some(p => p[3] !== 'ground' && p[3] != null)) flewAdd(hex, d);
    }
    await sleep(1000);
  }
  let x = ac.get(hex);
  if (!rows.length) { if (x && !x.rows.length) ac.delete(hex); return; }
  if (!x) ac.set(hex, x = { meta: {}, rows: [], last: 0, first: Date.now() / 1000, dirty: false });
  rows.sort((a, b) => a[0] - b[0]);
  const before = rows.filter(r => r[0] < x.first - 5);
  if (!before.length) return;
  // (the flights kept of those hours give way to the ones rebuilt from the whole of them)
  const lo = before[0][0], hi = before[before.length - 1][0], m = legs.get(hex);
  if (m) for (const [k, l] of m) if ((l.tOff || l.tStart) >= lo && (l.tEnd || l.tStart) <= hi + 600 && !l.open) { m.delete(k); dirtyDays.add(dayOf(l.tOff || l.tStart)); }
  // (no position heard live: the trace's last one is its last heard - a flight still under way stays open)
  if (!x.rows.length) x.last = Math.max(x.last, hi);
  x.rows = before.concat(x.rows); x.first = before[0][0]; x.dirty = true;
  buildLegs(hex, Date.now() / 1000);
}
// (the workers: aircraft to catch up on first, then the finished days to rebuild)
async function backfillLoop() {
  for (;;) {
    const job = backQ.shift();
    if (job) { await backfillOne(job).catch(e => log('backfill', job.hex, String(e))); continue; }
    const hj = nextHist();
    if (hj) { await histOne(hj).catch(e => { histPend.delete(hj.hex + '|' + hj.day); try { histUnknown(hj.hex, hj.day); } catch (e2) { /* disk */ } log('history', hj.hex, hj.day, String(e)); }); await sleep(1000); }
    else await sleep(5000);
  }
}

// ---- storage: a file per day of flights ---------------------------------------------------------------------------
const KEEP_LADD = 90 * 86400, KEEP_OTHER = 4 * 86400;
function save() {
  fs.mkdirSync(STORE, { recursive: true });
  for (const d of dirtyDays) {
    const out = [];
    for (const m of legs.values()) for (const l of m.values()) if (dayOf(l.tOff || l.tStart) === d) out.push(l);
    const f = path.join(STORE, 'legs-' + d + '.json'), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, f);
  }
  dirtyDays.clear();
}
function loadStore(nowS) {
  if (!fs.existsSync(STORE)) return;
  for (const f of fs.readdirSync(STORE)) {
    const m = f.match(/^legs-(\d{4}-\d\d-\d\d)\.json$/); if (!m) continue;
    const age = nowS - Date.parse(m[1]) / 1000;
    if (age > KEEP_LADD + 86400) { fs.unlinkSync(path.join(STORE, f)); continue; }
    let list; try { list = JSON.parse(fs.readFileSync(path.join(STORE, f), 'utf8')); } catch (e) { continue; }
    for (const l of list) { if (!l.ladd && !isBlocked(l.hex) && age > KEEP_OTHER) continue; let mm = legs.get(l.hex); if (!mm) legs.set(l.hex, mm = new Map()); mm.set(legKey(l), l); }
  }
}
function prune(nowS) {
  for (const [hex, m] of legs) {
    const bl = isBlocked(hex);
    for (const [k, l] of m) {
      if (bl && !l.ladd) { l.ladd = true; dirtyDays.add(dayOf(l.tOff || l.tStart)); }
      if (nowS - (l.tEnd || l.tStart) > (l.ladd ? KEEP_LADD : KEEP_OTHER)) m.delete(k);
      else if (l.open && !ac.has(hex) && nowS - l.tEnd > 14 * 3600) { l.open = false; dirtyDays.add(dayOf(l.tOff || l.tStart)); }   // (never heard again)
    }
    if (!m.size) legs.delete(hex);
  }
  for (let i = userAreas.length - 1; i >= 0; i--) if (nowS - userAreas[i][3] > 3 * 86400) { userAreas.splice(i, 1); stateDirty = true; }
  // (aircraft not heard for 14 hours let go - their flights are kept; only a changed one was looked at before)
  for (const [hex, x] of ac) if (nowS - x.last > 14 * 3600 && !x.dirty) ac.delete(hex);
  for (const [hex, l] of live) if (nowS - l.t > CFG.liveMaxAge) live.delete(hex);
  const cut = dayOf(nowS - KEEP_LADD - 86400); for (const d of Object.keys(watch)) if (d < cut) delete watch[d];
}

// ---- polling (one request at a time, gently) -----------------------------------------------------------------------
const UA = { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)', Accept: 'application/json' };
const pause = {};      // host -> until (answered 429: left alone a while - the API and the history files apart)
const hostOf = url => url.split('/')[2];
// (its requests to adsb.lol's API in one queue, 2 s apart - and never more than apiPerMin in any minute)
const gate = { q: [], busy: false, last: 0, sent: [] };
function apiGet(url) { return new Promise((res, rej) => { gate.q.push({ url, res, rej }); pumpGate(); }); }
async function pumpGate() {
  if (gate.busy) return; gate.busy = true;
  while (gate.q.length) {
    const j = gate.q.shift(); let wait = gate.last + 2000 - Date.now();
    while (gate.sent.length && Date.now() - gate.sent[0] > CFG.apiWindowMs) gate.sent.shift();
    if (gate.sent.length >= CFG.apiPerMin) wait = Math.max(wait, gate.sent[0] + CFG.apiWindowMs - Date.now() + 50);
    if (wait > 0) await sleep(wait);
    gate.last = Date.now(); gate.sent.push(gate.last);
    try { const r = await fetch(j.url, { headers: UA, signal: AbortSignal.timeout(20000) }); if (r.status === 429) pause[hostOf(j.url)] = Date.now() + 120000; j.res({ status: r.status, text: await r.text() }); } catch (e) { j.rej(e); }
  }
  gate.busy = false;
}
async function getJson(url, headers) {
  if (Date.now() < (pause[hostOf(url)] || 0)) throw new Error('paused');
  const api = /^https:\/\/api\.adsb\.lol\//.test(url);
  const r = api ? await apiGet(url) : await fetch(url, { headers: Object.assign({}, UA, headers || {}), signal: AbortSignal.timeout(20000) }).then(async x => ({ status: x.status, text: await x.text() }));
  if (r.status === 429) { pause[hostOf(url)] = Date.now() + 120000; throw new Error('HTTP 429'); }
  if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
  return JSON.parse(r.text);
}
const stats = { since: Date.now(), polls: 0, fails: 0, lastErr: '', hexPolls: 0, backfilled: 0, listPolls: { ladd: 0, mil: 0, pia: 0, fi: 0, fiArea: 0, adsbx: 0, osky: 0 } };
// (readsb answers: adsb.lol's "ac" and "now" in ms; adsb.fi's "aircraft", its "now" in ms or s)
const acOf = j => Array.isArray(j && j.ac) ? j.ac : Array.isArray(j && j.aircraft) ? j.aircraft : [];
const nowMsOf = j => { const n = +(j && j.now); return n > 1e12 ? n : n > 1e9 ? n * 1000 : Date.now(); };
async function pollOnce(url, kind, headers) {
  try {
    const j = await getJson(url, headers), nowS = nowMsOf(j) / 1000, list = acOf(j);
    for (const a of list) ingest(a, nowS);
    if (kind === 'ladd') { lastLadd = { at: Date.now(), ac: list }; laddNow = new Set(list.map(a => String(a.hex || '').toLowerCase().replace(/^~/, ''))); noteWatch('ladd', Date.now() / 1000); }
    lastOk[kind] = Date.now();
    if (kind === 'hex') stats.hexPolls++; else stats.polls++;
    if (stats.listPolls[kind] != null) stats.listPolls[kind]++;
    return true;
  } catch (e) { if (!/paused/.test(String(e))) { stats.fails++; stats.lastErr = String(e.message || e); } return false; }
}
// ---- the backups, while adsb.lol rate-limits or fails ------------------------------------------------------------------
// adsb.fi (opendata, no key, 1 request a second): its military list and its area query. ADS-B Exchange (its official API
// on RapidAPI - only with the user's own key, MON_ADSBX_KEY; a paid quota, so at most adsbxDaily requests a day): the
// same two, when adsb.fi fails too. OpenSky Network (anonymous: about 100 world-wide snapshots a day): every aircraft it
// hears, of which the blocked ones known here are kept - only while adsb.lol's LADD list has not answered for 3 minutes,
// at most every openskyEvery seconds. (airplanes.live's API needs its approval; ADSB One is gone; ADSBHub and TheAirTraffic
// take feeds but answer no queries: none of them used.)
const ADSBX_HOST = 'adsbexchange-com1.p.rapidapi.com';
let fiLast = 0; const adsbxUse = { day: '', n: 0 };
async function fiPoll(url, kind) { const w = fiLast + 1100 - Date.now(); if (w > 0) await sleep(w); fiLast = Date.now(); return pollOnce(url, kind); }
async function adsbxPoll(path) {
  const d = dayOf(Date.now() / 1000); if (adsbxUse.day !== d) { adsbxUse.day = d; adsbxUse.n = 0; }
  if (!CFG.adsbxKey || adsbxUse.n >= CFG.adsbxDaily) return false;
  adsbxUse.n++;
  return pollOnce(`https://${ADSBX_HOST}${path}`, 'adsbx', { 'X-RapidAPI-Key': CFG.adsbxKey, 'X-RapidAPI-Host': ADSBX_HOST });
}
async function pollOpenSky() {
  const host = 'opensky-network.org';
  if (Date.now() < (pause[host] || 0)) return false;
  try {
    const r = await fetch(`https://${host}/api/states/all`, { headers: UA, signal: AbortSignal.timeout(30000) });
    // (refused or out of credits: left alone six hours)
    if (r.status === 401 || r.status === 403 || r.status === 429) { pause[host] = Date.now() + 6 * 3600e3; throw new Error('OpenSky HTTP ' + r.status); }
    if (r.status !== 200) throw new Error('OpenSky HTTP ' + r.status);
    const j = JSON.parse(await r.text()), nowS = +j.time || Date.now() / 1000;
    // (its state vectors: [icao24, callsign, country, time_position, last_contact, lon, lat, baro m, on_ground, velocity m/s,
    // track, vertical rate m/s, sensors, geo m, squawk, spi, source] - as readsb's units; the LADD flag is not OpenSky's to
    // give: an aircraft of the FAA list is marked so in the live list only, never as "seen with the flag")
    for (const v of Array.isArray(j.states) ? j.states : []) {
      const hex = String(v[0] || '').trim().toLowerCase(), b = blocked.get(hex);
      if (!b || v[5] == null || v[6] == null) continue;
      const fin = x => x != null && isFinite(x);
      ingest({ hex, flight: v[1] || '', r: b.reg || undefined, t: b.type || undefined, lat: v[6], lon: v[5], alt_baro: v[8] ? 'ground' : fin(v[7]) ? Math.round(v[7] * 3.28084) : undefined, alt_geom: fin(v[13]) ? Math.round(v[13] * 3.28084) : undefined, gs: fin(v[9]) ? Math.round(v[9] * 1.94384) : undefined, track: fin(v[10]) ? v[10] : undefined, baro_rate: fin(v[11]) ? Math.round(v[11] * 196.85) : undefined, squawk: v[14] || undefined, seen_pos: Math.max(0, nowS - (v[3] || nowS)) }, nowS);
      const l = live.get(hex); if (l && b.faa && l.a.dbFlags == null) l.a.dbFlags = 8;
    }
    lastOk.osky = Date.now(); stats.listPolls.osky++; stats.polls++;
    return true;
  } catch (e) { stats.fails++; stats.lastErr = String(e.message || e); return false; }
}
// One request at a time: the LADD list when due, then the military and PIA lists, else the next area, else the next
// hundred blocked aircraft not on the LADD list (asked for by address - the FAA's own come with the list whenever they
// fly), the most recently heard first
const piaState = { miss: 0, off: false };
const P = { tL: 0, tM: 0, tP: 0, tA: 0, tH: 0, tO: 0, areaQ: [], hexQ: [], hexRoundOk: true };
// (one request - or none due: false)
async function step() {
  const n = Date.now(), lolPaused = n < (pause['api.adsb.lol'] || 0);
  if (n - P.tA >= CFG.areaEvery * 1000) { P.tA = n; P.areaQ = CFG.areas.concat(userAreas).slice(); }
  if (n - P.tH >= CFG.hexEvery * 1000 && !P.hexQ.length) {
    P.tH = n; P.hexQ = [...blocked].filter(([h, b]) => !b.faa && !laddNow.has(h)).sort((a, b) => b[1].heard - a[1].heard).map(([h]) => h); P.hexRoundOk = true;
    if (!P.hexQ.length) noteWatch('hex', n / 1000);
  }
  if (n - P.tL >= CFG.laddEvery * 1000) { P.tL = n; await pollOnce('https://api.adsb.lol/v2/ladd', 'ladd'); }
  else if (n - P.tM >= CFG.milEvery * 1000) {
    // (adsb.lol rate-limiting or failing: adsb.fi's military list instead - and that failing too, ADS-B Exchange's)
    P.tM = n; if (lolPaused || !(await pollOnce('https://api.adsb.lol/v2/mil', 'mil'))) { if (!(await fiPoll('https://opendata.adsb.fi/api/v2/mil', 'fi'))) await adsbxPoll('/v2/mil/'); }
  }
  else if (n - P.tP >= (piaState.off ? 3600 : CFG.piaEvery) * 1000) {
    P.tP = n;
    // (an endpoint adsb.lol no longer has: asked once an hour, not every two minutes)
    if (await pollOnce('https://api.adsb.lol/v2/pia', 'pia')) { piaState.miss = 0; piaState.off = false; }
    else if (/HTTP 404/.test(stats.lastErr) && ++piaState.miss >= 3 && !piaState.off) { piaState.off = true; log('PIA list: no such endpoint, asked hourly'); }
  }
  // (adsb.lol's LADD list silent 3 minutes - rate-limited, down: OpenSky's view of the world, the blocked aircraft in it)
  else if (n - stats.since > 180000 && (!lastOk.ladd || n - lastOk.ladd > 180000) && n - P.tO >= CFG.openskyEvery * 1000) { P.tO = n; await pollOpenSky(); }
  else if (P.areaQ.length) {
    const [la, lo, r] = P.areaQ.shift();
    if (lolPaused || !(await pollOnce(`https://api.adsb.lol/v2/point/${la}/${lo}/${r}`, 'area'))) { if (!(await fiPoll(`https://opendata.adsb.fi/api/v3/lat/${la}/lon/${lo}/dist/${r}`, 'fiArea'))) await adsbxPoll(`/v2/lat/${la}/lon/${lo}/dist/${r}/`); }
  }
  else if (P.hexQ.length) {
    if (!(await pollOnce('https://api.adsb.lol/v2/hex/' + P.hexQ.splice(0, CFG.hexBatch).join(','), 'hex'))) P.hexRoundOk = false;
    if (!P.hexQ.length && P.hexRoundOk) noteWatch('hex', Date.now() / 1000);
  }
  else return false;
  return true;
}
async function loop() { for (;;) if (!(await step())) await sleep(1000); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// (an aircraft gone quiet - landed, transponder off at the stand - sends nothing that would make it looked at again: its
// open flight looked at once more 20 minutes on, and closed as landed. OK-FLN, down at Luton at 15:26, was still open)
function wakeQuiet(nowS) { for (const x of ac.values()) if (!x.dirty && x.rows.length >= 2 && nowS - x.last > 1200 && x.quietDone !== x.last) { x.dirty = true; x.quietDone = x.last; } }
function work() {
  const nowS = Date.now() / 1000;
  wakeQuiet(nowS);
  for (const hex of ac.keys()) buildLegs(hex, nowS);
  prune(nowS); save(); closeDays(nowS);
  lastRun = Math.round(nowS); saveState();
}
// (a place the userscript is looking at, to the nearest degree: the most recent few polled with the default areas)
function addArea(lat, lon, nowS) {
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85) return false;
  const la = Math.round(lat), lo = Math.round(lon);
  if (CFG.areas.concat(userAreas).some(a => E.dist(a[0], a[1], la, lo) < 150)) { const u = userAreas.find(a => E.dist(a[0], a[1], la, lo) < 150); if (u) u[3] = Math.round(nowS); return false; }
  userAreas.push([la, lo, 250, Math.round(nowS)]); userAreas.sort((a, b) => b[3] - a[3]); userAreas.splice(CFG.userAreas);
  stateDirty = true; return true;
}

// ---- answers -------------------------------------------------------------------------------------------------------
// (an aircraft's flights as its log shows them: a part-copy dropped, a missing end taken from the next take-off - the
// same post-pass as the userscript's logs; on copies, the kept flights stay as seen)
const chained = m => E.chainLegs(E.stitchLegs([...m.values()].map(l => Object.assign({}, l))));
function boardLegs(apId, lo, hi) {
  const out = [];
  for (const [hex, m] of legs) {
    // (a missing end is only ever taken from a neighbouring flight's: an aircraft none of whose flights touch the airport has
    // none there after the post-pass either)
    if (![...m.values()].some(l => (l.from && l.from.id === apId) || (l.to && l.to.id === apId))) continue;
    const hit = chained(m).filter(l => ((l.from && l.from.id === apId) || (l.to && l.to.id === apId)) && (l.tEnd || l.tStart) >= lo && (l.tOff || l.tStart) <= hi);
    if (hit.length) out.push({ hex, reg: hit[0].reg, type: hit[0].type, ladd: isBlocked(hex) || !!hit[0].ladd, legs: hit });
  }
  return out;
}
// (the aircraft of a type whose last flight - the latest of all kept - ended at an airport in the last 14 days: parked
// there since, as far as anyone heard. For a blocked aircraft on an apron the public networks do not hear)
function parkedAt(apId, type, nowS) {
  const out = [];
  for (const [hex, m] of legs) {
    let last = null; for (const l of m.values()) if (!last || (l.tOff || l.tStart) > (last.tOff || last.tStart)) last = l;
    if (!last || last.open || !last.ended || !last.to || last.to.id !== apId || nowS - (last.tEnd || 0) > 14 * 86400) continue;
    if (type && last.type !== type) continue;
    out.push({ hex, reg: last.reg || '', type: last.type || '', ladd: isBlocked(hex) || !!last.ladd, last });
  }
  return out;
}
// (the blocked jets - and every other business jet, or jet of a type no database names yet, last heard cruising: a
// brand-new airframe has no LADD flag anywhere yet - N88RZ, a 2026 G500, left Ireland for the Atlantic unknown)
function lastHeard(nowS) {
  const out = [];
  for (const [hex, x] of ac) {
    const p = x.meta.lastPos; if (!p || nowS - p.t > 14 * 3600 || p.alt === 'ground') continue;
    const bl = isBlocked(hex), cruising = p.alt > 15000 && p.gs > 200 && nowS - p.t < 6 * 3600;
    if (!bl && !(cruising && (!x.meta.type || /bizjet|heavybiz/.test(E.classify({ hex, type: x.meta.type, reg: x.meta.reg || '', cs: x.meta.cs || '' }))))) continue;
    out.push({ hex, reg: x.meta.reg || '', type: x.meta.type || '', cs: x.meta.cs || '', ladd: bl, t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs, trk: p.trk });
  }
  return out;
}
// The live list: every LADD / military / PIA / blocked aircraft with a position in the last few minutes, each as its
// newest report with seen_pos counted to now - plus, where a flight is under way, where it took off (_from: [FR24
// airport id, how sure], _off: take-off time). age: seconds since each list last answered (null: never)
function liveList(nowMs) {
  const nowS = nowMs / 1000, out = [];
  for (const [hex, l] of live) {
    if (nowS - l.t > CFG.liveMaxAge) continue;
    const o = Object.assign({}, l.a, { seen_pos: Math.max(0, Math.round((nowS - l.t) * 10) / 10) });
    const m = legs.get(hex); let open = null; if (m) for (const g of m.values()) if (g.open && (!open || g.tStart > open.tStart)) open = g;
    if (open && open.from) o._from = [open.from.id, open.from.conf]; if (open && open.tOff) o._off = open.tOff;
    out.push(o);
  }
  const age = k => lastOk[k] ? Math.round((nowMs - lastOk[k]) / 1000) : null;
  const mil = [age('mil'), age('fi'), age('adsbx')].filter(x => x != null);
  return { v: 1, now: nowMs, age: { ladd: age('ladd'), mil: mil.length ? Math.min(...mil) : null, pia: age('pia'), hex: age('hex') }, ac: out };
}
// Every flight kept under a callsign - a flight number's page on FR24 that has no history of it (VSB96, BAE Systems' PC-24
// shuttle Barrow - Farnborough): newest first, 200 at most
function flightsOfCs(cs) {
  cs = String(cs || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const out = []; if (!cs) return out;
  const same = l => String(l.cs || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === cs;
  for (const [hex, m] of legs) { if (![...m.values()].some(same)) continue; for (const l of chained(m)) if (same(l)) out.push(Object.assign({}, l, { hex, ladd: isBlocked(hex) || !!l.ladd })); }
  return out.sort((a, b) => b.tStart - a.tStart).slice(0, 200);
}
const hexList = (s, max) => String(s || '').toLowerCase().split(',').map(h => h.trim()).filter(h => /^[0-9a-f]{6}$/.test(h)).slice(0, max);
// ---- who asked for what: the dashboard (/dash, a page; /stats, its numbers - behind the secret like the rest) ----------
const reqs = [], byPath = {}, byClient = new Map();
const reqTotals = { total: 0, unauthorized: 0, limited: 0, errors: 0 };
function noteReq(ip, path, status, ms) {
  const t = Date.now(), p = path.split('?')[0];
  reqs.push({ t, ip, path: path.slice(0, 120), status, ms }); if (reqs.length > 2000) reqs.splice(0, reqs.length - 2000);
  reqTotals.total++; if (status === 401) reqTotals.unauthorized++; else if (status === 429) reqTotals.limited++; else if (status >= 500) reqTotals.errors++;
  const e = byPath[p] || (byPath[p] = { n: 0, ms: 0, errors: 0 }); e.n++; e.ms += ms; if (status >= 400) e.errors++;
  let c = byClient.get(ip); if (!c) { c = { n: 0, first: t, last: t, paths: {}, denied: [0, 0] }; byClient.set(ip, c); if (byClient.size > 2000) byClient.delete(byClient.keys().next().value); }
  c.n++; c.last = t; c.paths[p] = (c.paths[p] || 0) + 1; if (status === 401) c.denied[0]++; else if (status === 429) c.denied[1]++;
}
function monStatus() {
  const now = Date.now(), age = k => lastOk[k] ? Math.round((now - lastOk[k]) / 1000) : null;
  return { polls: stats.polls, hexPolls: stats.hexPolls, fails: stats.fails, lastErr: stats.lastErr, laddAt: lastLadd.at, aircraft: ac.size, blocked: blocked.size, withLegs: legs.size, legs: [...legs.values()].reduce((n, m) => n + m.size, 0), backfillQueue: backQ.length,
    live: live.size, listAge: { ladd: age('ladd'), mil: age('mil'), fi: age('fi'), pia: age('pia'), hex: age('hex'), area: age('area'), fiArea: age('fiArea'), adsbx: age('adsbx'), osky: age('osky') }, listPolls: stats.listPolls, adsbx: { key: !!CFG.adsbxKey, today: adsbxUse.n, cap: CFG.adsbxDaily }, apiLastMin: gate.sent.filter(t => now - t < 60000).length,
    hist: Object.assign({ queue: histQ.length, closed }, histStats), areas: CFG.areas.concat(userAreas).map(a => a.slice(0, 2)), paused: Object.fromEntries(Object.entries(pause).filter(([, t]) => t > now).map(([h, t]) => [h, Math.round((t - now) / 1000)])) };
}
function dashStats() {
  const now = Date.now(), minAgo = now - 60000, os = require('os'), mem = process.memoryUsage(), recent = reqs.filter(r => r.t > minAgo);
  const lastMin = (key, v) => recent.filter(r => r[key] === v).length;
  return {
    uptimeS: process.uptime(),
    mon: monStatus(),
    srv: { rss: mem.rss, heap: mem.heapUsed, totalMem: os.totalmem(), freeMem: os.freemem(), load: os.loadavg(), cpus: os.cpus().length },
    req: { total: reqTotals.total, lastMin: recent.length, clients: byClient.size, unauthorized: reqTotals.unauthorized, limited: reqTotals.limited, errors: reqTotals.errors },
    endpoints: Object.entries(byPath).map(([path, e]) => ({ path, n: e.n, lastMin: lastMin('path', path) + recent.filter(r => r.path.startsWith(path + '?')).length, avgMs: Math.round(e.ms / e.n), errors: e.errors })).sort((a, b) => b.n - a.n),
    clients: [...byClient].map(([ip, c]) => ({ ip, n: c.n, lastMin: lastMin('ip', ip), first: c.first, last: c.last, top: Object.entries(c.paths).sort((a, b) => b[1] - a[1])[0][0], denied: c.denied[0] + ' / ' + c.denied[1] })).sort((a, b) => b.last - a.last).slice(0, 100),
    recent: reqs.slice(-80).reverse()
  };
}
// One request's answer (null: no such path)
function answer(u, nowS) {
  const p = u.pathname, q = k => u.searchParams.get(k);
  if (p === '/stats') return dashStats();
  if (p === '/status') return Object.assign({ v: 3, data: 'adsb.lol (ODbL)', since: stats.since }, monStatus());
  if (p === '/live') return liveList(Date.now());
  if (p === '/board') return { aircraft: boardLegs(+q('ap'), +(q('from') || nowS - 3 * 86400), +(q('to') || nowS)) };
  if (p === '/flights') return { list: flightsOfCs(q('cs')) };
  if (p === '/legs') {
    const hs = hexList(q('hex'), 50), one = h => { const m = legs.get(h); return { hex: h, legs: m ? chained(m) : [] }; };
    return hs.length > 1 ? { list: hs.map(one) } : one(hs[0] || String(q('hex') || '').toLowerCase());
  }
  if (p === '/hist') return { hv: HIST_V, list: hexList(q('hex'), 20).map(histOf) };
  if (p === '/ladd') return { at: lastLadd.at, ac: lastLadd.ac };
  if (p === '/last') return { list: lastHeard(nowS) };
  if (p === '/parked') return { list: parkedAt(+q('ap'), String(q('type') || '').toUpperCase(), nowS) };
  if (p === '/seed') return { queued: seed(String(q('hex') || '').split(',').slice(0, 500), q('front') === '1', nowS), backfillQueue: backQ.length };
  if (p === '/area') return { added: addArea(+q('lat'), +q('lon'), nowS), areas: CFG.areas.concat(userAreas).map(a => a.slice(0, 2)) };
  return null;
}
function serve() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), nowS = Date.now() / 1000, t0 = Date.now();
    let body = null;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    res.on('finish', () => { if (u.pathname !== '/dash' && !(u.pathname === '/stats' && res.statusCode === 200)) noteReq(ip, u.pathname + u.search, res.statusCode, Date.now() - t0); });
    // (the page itself holds no data - it asks for the numbers with the secret the visitor types in)
    if (u.pathname === '/dash') { try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(path.join(DIR, 'dash.html'))); } catch (e) { res.writeHead(404); res.end(); } return; }
    if (TOKEN && req.headers['x-monitor-token'] !== TOKEN) { res.writeHead(401); res.end(); return; }
    if (limited(ip)) { res.writeHead(429, { 'Retry-After': '30' }); res.end(); return; }
    try { body = answer(u, nowS); } catch (e) { res.writeHead(500); res.end(String(e)); return; }
    if (!body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://www.flightradar24.com' });
    res.end(JSON.stringify(body));
  }).listen(PORT, HOST, () => log('listening on ' + HOST + ':' + PORT));
}

if (require.main === module) {
  const nowS = Date.now() / 1000;
  loadEngine();
  const st = loadState();
  loadStore(nowS); serve();
  // (blocked aircraft of flights kept before this version kept a state file: from the flights)
  for (const m of legs.values()) for (const l of m.values()) if (l.ladd && !blocked.has(l.hex)) blocked.set(l.hex, { reg: l.reg || '', type: l.type || '', at: Math.round(l.tStart), heard: Math.round(l.tEnd || 0) });
  lastRun = (st && st.lastRun) || 0;
  // (first run of this version: every blocked aircraft's last three days, once)
  if (!st) gapFill(nowS - 3 * 86400, nowS); else if (lastRun && nowS - lastRun > 600) gapFill(lastRun, nowS);
  setInterval(() => { try { work(); } catch (e) { log('work', e); } }, 120000);
  setInterval(() => log('status', JSON.stringify({ polls: stats.polls, hexPolls: stats.hexPolls, fails: stats.fails, aircraft: ac.size, live: live.size, blocked: blocked.size, legs: [...legs.values()].reduce((n, m) => n + m.size, 0), backfill: backQ.length, hist: histQ.length, rss: Math.round(process.memoryUsage().rss / 1048576), err: stats.lastErr })), 600000);
  // (stopped - Ctrl+C here, systemd's stop or restart on a server: what it has is saved first)
  const stop = () => { try { work(); } catch (e) { log('save on stop', e); } process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  // (an error anywhere is logged and the monitor goes on; another copy already running is the one exception)
  process.on('uncaughtException', e => { log('error', e && e.stack || e); if (e && e.code === 'EADDRINUSE') process.exit(1); });
  process.on('unhandledRejection', e => log('error', e && e.stack || e));
  loop();
  for (let i = 0; i < CFG.backWorkers; i++) backfillLoop();
}
module.exports = { E, CFG, loadEngine, ingest, buildLegs, wakeQuiet, parkedAt, boardLegs, flightsOfCs, lastHeard, legs, ac, backfillOne, backQ, blocked, markBlocked, seed, gapFill, addArea, userAreas,
  histUnknown, pollOpenSky, adsbxUse, live, liveList, answer, step, P, piaState, apiGet, gate, stats, lastOk, noteWatch, watch, watchedAll, flew, closeDays, histQ, histPend, histOne, histDay, histOf, histRead, nextHist, saveState, loadState, lastW, get closed() { return closed; }, set closed(v) { closed = v; }, pause };
