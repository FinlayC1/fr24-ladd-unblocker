// FR24 LADD unblocker - the permanent monitor. Runs on its own (node monitor.cjs), whether FR24 is open or not:
//  - every 30 s adsb.lol's LADD list (every aircraft whose owner asked the FAA to keep it off public sites, worldwide)
//  - every 2 minutes, by their addresses, every other blocked aircraft known (FR24 hides more than the FAA list: the
//    Isle of Man BAE shuttles, Guernsey and San Marino jets...) - wherever in the world they fly
//  - every 60 s every aircraft around the areas of monitor.json (default: the UK and Ireland) and the places the
//    userscript has been looking at (its boards and map, anywhere in the world)
// Each aircraft's positions become flights with the userscript's own engine (take-off, landing, airports), kept for
// 90 days (blocked aircraft) or 4 days (the rest). What it missed while the computer was off - or before it knew of an
// aircraft - it reads back from adsb.lol's day traces (three days back). The userscript asks it, on
// http://127.0.0.1:47524 (data: adsb.lol, ODbL):
//  /status                       what it has
//  /board?ap=<FR24 airport id>   flights at an airport, three days back to now (both ends, as rebuilt logs)
//  /legs?hex=<icao>              one aircraft's flights (90 days)
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
const CFG = Object.assign({ areas: [[53.8, -2.6, 250]], laddEvery: 30, areaEvery: 60, hexEvery: 120, hexBatch: 100, backWorkers: 3, userAreas: 3 }, (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'monitor.json'), 'utf8')); } catch (e) { return {}; } })());
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

// ---- the blocked aircraft (kept on disk: the FAA list's and every one the userscript has identified) ----------------
const blocked = new Map();   // hex -> { reg, type, at: known since, heard: last heard, faa: on the LADD list }
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
function saveState() {
  fs.mkdirSync(STORE, { recursive: true });
  const f = path.join(STORE, 'state.json'), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, lastRun, blocked: Object.fromEntries([...blocked].map(([h, b]) => [h, [b.reg, b.type, b.at, b.heard, b.faa ? 1 : 0]])), areas: userAreas }));
  fs.renameSync(tmp, f); stateDirty = false;
}
function loadState() {
  let s = null; try { s = JSON.parse(fs.readFileSync(path.join(STORE, 'state.json'), 'utf8')); } catch (e) { return null; }
  for (const [h, b] of Object.entries(s.blocked || {})) blocked.set(h, { reg: b[0] || '', type: b[1] || '', at: b[2] || 0, heard: b[3] || 0, faa: !!b[4] });
  for (const a of s.areas || []) if (Array.isArray(a) && a.length === 4) userAreas.push(a);
  return s;
}

// ---- positions -> flights ----------------------------------------------------------------------------------------
const ac = new Map();        // hex -> { meta: {reg,type,cs,mil,cat}, rows: [readsb trace rows], last, first, dirty }
const legs = new Map();      // hex -> Map(key -> leg)
const dirtyDays = new Set();
let lastLadd = { at: 0, ac: [] };
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const legKey = l => Math.round((l.tOff || l.tStart) / 600);

// one aircraft's report (adsb.lol /v2 format) at poll time nowS
function ingest(a, nowS) {
  if (!a || !a.hex || a.lat == null || a.lon == null) return;
  const hex = String(a.hex).toLowerCase().replace(/^~/, ''), t = Math.round(nowS - (a.seen_pos != null ? a.seen_pos : a.seen || 0));
  if (a.dbFlags & 8) { const b0 = markBlocked(hex, { reg: a.r, type: a.t }, nowS); if (!b0.faa) { b0.faa = true; stateDirty = true; } }
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

// ---- what a blocked aircraft flew while the monitor did not hear it: adsb.lol's traces of those days - today's for a
// flight under way when first heard (its take-off), the three days before for one it has just learned of (M-ARNZ's
// Barrow shuttles of the week, T7-MUSIC into Toulouse), and every day the computer was off. Three files at a time.
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
// (after a time off - the computer shut down overnight - every blocked aircraft's days since, the most recently heard
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
    const url = `https://adsb.lol/${d === today ? 'data' : 'globe_history/' + d.replace(/-/g, '/')}/traces/${hex.slice(-2)}/trace_full_${hex}.json`;
    let j = null; try { j = await getJson(url); } catch (e) { if (/429|paused/.test(String(e))) { backQ.unshift({ hex, days: days.slice(days.indexOf(d)) }); await sleep(60000); return; } }
    if (j && Array.isArray(j.trace)) {
      for (const p of j.trace) rows.push([j.timestamp + p[0]].concat(p.slice(1, 11)));
      if (j.dbFlags & 8 || isBlocked(hex)) markBlocked(hex, { reg: j.r, type: j.t }, Date.now() / 1000);
      if (j.r || j.t) { const x0 = ac.get(hex) || ac.set(hex, { meta: {}, rows: [], last: 0, first: Date.now() / 1000, dirty: false }).get(hex); if (j.r && !x0.meta.reg) x0.meta.reg = j.r; if (j.t && !x0.meta.type) x0.meta.type = j.t; if (j.dbFlags & 1) x0.meta.mil = true; }
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
async function backfillLoop() { for (;;) { const job = backQ.shift(); if (job) await backfillOne(job).catch(e => log('backfill', job.hex, String(e))); else await sleep(5000); } }

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
}

// ---- polling (one request at a time, gently) -----------------------------------------------------------------------
const UA = { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)', Accept: 'application/json' };
const pause = {};      // host -> until (answered 429: left alone a while - the API and the history files apart)
const hostOf = url => url.split('/')[2];
// (its requests to adsb.lol's API in one queue, 2 s apart)
const gate = { q: [], busy: false, last: 0 };
function apiGet(url) { return new Promise((res, rej) => { gate.q.push({ url, res, rej }); pumpGate(); }); }
async function pumpGate() {
  if (gate.busy) return; gate.busy = true;
  while (gate.q.length) {
    const j = gate.q.shift(), wait = gate.last + 2000 - Date.now(); if (wait > 0) await sleep(wait);
    gate.last = Date.now();
    try { const r = await fetch(j.url, { headers: UA, signal: AbortSignal.timeout(20000) }); if (r.status === 429) pause[hostOf(j.url)] = Date.now() + 120000; j.res({ status: r.status, text: await r.text() }); } catch (e) { j.rej(e); }
  }
  gate.busy = false;
}
async function getJson(url) {
  if (Date.now() < (pause[hostOf(url)] || 0)) throw new Error('paused');
  const api = /^https:\/\/api\.adsb\.lol\//.test(url);
  const r = api ? await apiGet(url) : await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }).then(async x => ({ status: x.status, text: await x.text() }));
  if (r.status === 429) { pause[hostOf(url)] = Date.now() + 120000; throw new Error('HTTP 429'); }
  if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
  return JSON.parse(r.text);
}
const stats = { since: Date.now(), polls: 0, fails: 0, lastErr: '', hexPolls: 0, backfilled: 0 };
async function pollOnce(url, kind) {
  try {
    const j = await getJson(url), nowS = (j.now || Date.now()) / 1000;
    for (const a of j.ac || []) ingest(a, nowS);
    if (kind === 'ladd') { lastLadd = { at: Date.now(), ac: j.ac || [] }; laddNow = new Set((j.ac || []).map(a => String(a.hex || '').toLowerCase().replace(/^~/, ''))); }
    if (kind === 'hex') stats.hexPolls++; else stats.polls++;
  } catch (e) { if (!/paused/.test(String(e))) { stats.fails++; stats.lastErr = String(e.message || e); } }
}
// One request at a time: the LADD list when due, else the next area, else the next hundred blocked aircraft not on the
// LADD list (asked for by address - the FAA's own come with the list whenever they fly), the most recently heard first
async function loop() {
  let tL = 0, tA = 0, tH = 0, areaQ = [], hexQ = [];
  for (;;) {
    const n = Date.now();
    if (n - tA >= CFG.areaEvery * 1000) { tA = n; areaQ = CFG.areas.concat(userAreas).slice(); }
    if (n - tH >= CFG.hexEvery * 1000 && !hexQ.length) { tH = n; hexQ = [...blocked].filter(([h, b]) => !b.faa && !laddNow.has(h)).sort((a, b) => b[1].heard - a[1].heard).map(([h]) => h); }
    if (n - tL >= CFG.laddEvery * 1000) { tL = n; await pollOnce('https://api.adsb.lol/v2/ladd', 'ladd'); }
    else if (areaQ.length) { const [la, lo, r] = areaQ.shift(); await pollOnce(`https://api.adsb.lol/v2/point/${la}/${lo}/${r}`, 'area'); }
    else if (hexQ.length) await pollOnce('https://api.adsb.lol/v2/hex/' + hexQ.splice(0, CFG.hexBatch).join(','), 'hex');
    else await sleep(1000);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// (an aircraft gone quiet - landed, transponder off at the stand - sends nothing that would make it looked at again: its
// open flight looked at once more 20 minutes on, and closed as landed. OK-FLN, down at Luton at 15:26, was still open)
function wakeQuiet(nowS) { for (const x of ac.values()) if (!x.dirty && x.rows.length >= 2 && nowS - x.last > 1200 && x.quietDone !== x.last) { x.dirty = true; x.quietDone = x.last; } }
function work() {
  const nowS = Date.now() / 1000;
  wakeQuiet(nowS);
  for (const hex of ac.keys()) buildLegs(hex, nowS);
  prune(nowS); save();
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
// (the blocked jets - and every other business jet, or jet of a type no database names yet, last heard cruising: a
// brand-new airframe has no LADD flag anywhere yet - N88RZ, a 2026 G500, left Ireland for the Atlantic unknown)
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
// Every flight kept under a callsign - a flight number's page on FR24 that has no history of it (VSB96, BAE Systems' PC-24
// shuttle Barrow - Farnborough): newest first, 200 at most
function flightsOfCs(cs) {
  cs = String(cs || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const out = []; if (!cs) return out;
  const same = l => String(l.cs || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === cs;
  for (const [hex, m] of legs) { if (![...m.values()].some(same)) continue; for (const l of chained(m)) if (same(l)) out.push(Object.assign({}, l, { hex, ladd: isBlocked(hex) || !!l.ladd })); }
  return out.sort((a, b) => b.tStart - a.tStart).slice(0, 200);
}
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
function dashStats() {
  const now = Date.now(), minAgo = now - 60000, os = require('os'), mem = process.memoryUsage(), recent = reqs.filter(r => r.t > minAgo);
  const lastMin = (key, v) => recent.filter(r => r[key] === v).length;
  return {
    uptimeS: process.uptime(),
    mon: { polls: stats.polls, hexPolls: stats.hexPolls, fails: stats.fails, lastErr: stats.lastErr, laddAt: lastLadd.at, aircraft: ac.size, blocked: blocked.size, withLegs: legs.size, legs: [...legs.values()].reduce((n, m) => n + m.size, 0), backfillQueue: backQ.length, areas: CFG.areas.concat(userAreas).map(a => a.slice(0, 2)), paused: Object.fromEntries(Object.entries(pause).filter(([, t]) => t > now).map(([h, t]) => [h, Math.round((t - now) / 1000)])) },
    srv: { rss: mem.rss, heap: mem.heapUsed, totalMem: os.totalmem(), freeMem: os.freemem(), load: os.loadavg(), cpus: os.cpus().length },
    req: { total: reqTotals.total, lastMin: recent.length, clients: byClient.size, unauthorized: reqTotals.unauthorized, limited: reqTotals.limited, errors: reqTotals.errors },
    endpoints: Object.entries(byPath).map(([path, e]) => ({ path, n: e.n, lastMin: lastMin('path', path) + recent.filter(r => r.path.startsWith(path + '?')).length, avgMs: Math.round(e.ms / e.n), errors: e.errors })).sort((a, b) => b.n - a.n),
    clients: [...byClient].map(([ip, c]) => ({ ip, n: c.n, lastMin: lastMin('ip', ip), first: c.first, last: c.last, top: Object.entries(c.paths).sort((a, b) => b[1] - a[1])[0][0], denied: c.denied[0] + ' / ' + c.denied[1] })).sort((a, b) => b.last - a.last).slice(0, 100),
    recent: reqs.slice(-80).reverse()
  };
}
function serve() {
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), nowS = Date.now() / 1000, t0 = Date.now();
    let body = null;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    res.on('finish', () => { if (u.pathname !== '/dash' && !(u.pathname === '/stats' && res.statusCode === 200)) noteReq(ip, u.pathname + u.search, res.statusCode, Date.now() - t0); });
    // (the page itself holds no data - it asks for the numbers with the secret the visitor types in)
    if (u.pathname === '/dash') { try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(path.join(DIR, 'dash.html'))); } catch (e) { res.writeHead(404); res.end(); } return; }
    if (TOKEN && req.headers['x-monitor-token'] !== TOKEN) { res.writeHead(401); res.end(); return; }
    if (limited(ip)) { res.writeHead(429, { 'Retry-After': '30' }); res.end(); return; }
    try {
      if (u.pathname === '/stats') body = dashStats(); else
      if (u.pathname === '/status') body = { v: 2, data: 'adsb.lol (ODbL)', since: stats.since, polls: stats.polls, hexPolls: stats.hexPolls, fails: stats.fails, lastErr: stats.lastErr, aircraft: ac.size, blocked: blocked.size, withLegs: legs.size, legs: [...legs.values()].reduce((n, m) => n + m.size, 0), laddAt: lastLadd.at, backfillQueue: backQ.length, areas: CFG.areas.concat(userAreas).map(a => a.slice(0, 2)), paused: Object.fromEntries(Object.entries(pause).filter(([, t]) => t > Date.now()).map(([h, t]) => [h, Math.round((t - Date.now()) / 1000)])) };
      else if (u.pathname === '/board') body = { aircraft: boardLegs(+u.searchParams.get('ap'), +(u.searchParams.get('from') || nowS - 3 * 86400), +(u.searchParams.get('to') || nowS)) };
      else if (u.pathname === '/flights') body = { list: flightsOfCs(u.searchParams.get('cs')) };
      else if (u.pathname === '/legs') { const hex = String(u.searchParams.get('hex') || '').toLowerCase(), m = legs.get(hex); body = { hex, legs: m ? chained(m) : [] }; }
      else if (u.pathname === '/ladd') body = { at: lastLadd.at, ac: lastLadd.ac };
      else if (u.pathname === '/last') body = { list: lastHeard(nowS) };
      else if (u.pathname === '/parked') body = { list: parkedAt(+u.searchParams.get('ap'), String(u.searchParams.get('type') || '').toUpperCase(), nowS) };
      else if (u.pathname === '/seed') body = { queued: seed(String(u.searchParams.get('hex') || '').split(',').slice(0, 500), u.searchParams.get('front') === '1', nowS), backfillQueue: backQ.length };
      else if (u.pathname === '/area') body = { added: addArea(+u.searchParams.get('lat'), +u.searchParams.get('lon'), nowS), areas: CFG.areas.concat(userAreas).map(a => a.slice(0, 2)) };
    } catch (e) { res.writeHead(500); res.end(String(e)); return; }
    if (!body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://www.flightradar24.com' });
    res.end(JSON.stringify(body));
  }).listen(PORT, HOST, () => log('listening on ' + HOST + ':' + PORT));
}

if (require.main === module) {
  const nowS = Date.now() / 1000, st = loadState();
  loadEngine(); loadStore(nowS); serve();
  // (blocked aircraft of flights kept before this version kept a state file: from the flights)
  for (const m of legs.values()) for (const l of m.values()) if (l.ladd && !blocked.has(l.hex)) blocked.set(l.hex, { reg: l.reg || '', type: l.type || '', at: Math.round(l.tStart), heard: Math.round(l.tEnd || 0) });
  lastRun = (st && st.lastRun) || 0;
  // (first run of this version: every blocked aircraft's last three days, once)
  if (!st) gapFill(nowS - 3 * 86400, nowS); else if (lastRun && nowS - lastRun > 600) gapFill(lastRun, nowS);
  setInterval(() => { try { work(); } catch (e) { log('work', e); } }, 120000);
  setInterval(() => log('status', JSON.stringify({ polls: stats.polls, hexPolls: stats.hexPolls, fails: stats.fails, aircraft: ac.size, blocked: blocked.size, legs: [...legs.values()].reduce((n, m) => n + m.size, 0), backfill: backQ.length, err: stats.lastErr })), 600000);
  process.on('SIGINT', () => { try { work(); } catch (e) { /* ignore */ } process.exit(0); });
  // (an error anywhere is logged and the monitor goes on; another copy already running is the one exception)
  process.on('uncaughtException', e => { log('error', e && e.stack || e); if (e && e.code === 'EADDRINUSE') process.exit(1); });
  process.on('unhandledRejection', e => log('error', e && e.stack || e));
  loop();
  for (let i = 0; i < CFG.backWorkers; i++) backfillLoop();
}
module.exports = { E, loadEngine, ingest, buildLegs, wakeQuiet, parkedAt, boardLegs, flightsOfCs, lastHeard, legs, ac, backfillOne, backQ, blocked, markBlocked, seed, gapFill, addArea, userAreas };
