// FR24 LADD unblocker - the permanent monitor. Runs on its own (node monitor.cjs), whether FR24 is open or not:
//  - every 10 s adsb.lol's LADD list (every aircraft whose owner asked the FAA to keep it off public sites, worldwide)
//  - every 30 s its military list, every 2 minutes its PIA list (privacy addresses) - adsb.fi's military list while
//    adsb.lol rate-limits - so the userscript needs none of these lists itself while the monitor answers (/live)
//  - every 30 s, by their addresses, every other blocked aircraft heard in the last 45 minutes (the rest every 10 minutes) (FR24 hides more than the FAA list: the
//    Isle of Man BAE shuttles, Guernsey and San Marino jets...) - wherever in the world they fly
//  - every 2 minutes every aircraft around the areas of monitor.json (default: the UK and Ireland) and the places the
//    userscript has been looking at (its boards and map, anywhere in the world)
// And FR24 itself: its whole map scanned every two minutes (fr24.cjs), every flight it draws without callsign or registration
// named from public ADS-B (ident.cjs) and given a rough destination (dest.cjs), kept for the life of the flight - so a
// browser opening FR24 anywhere, over an ocean included, has every name at once.
// Each aircraft's positions become flights with the userscript's own engine (take-off, landing, airports), kept for
// 90 days in memory and for good on disk (blocked aircraft), or 4 days (the rest). What it missed while it was off - or before it knew of an aircraft -
// it reads back from adsb.lol's day traces (three days back). And every finished day of every blocked aircraft that
// flew is rebuilt from adsb.lol's full day trace, exactly as the userscript builds its flight logs (/hist): the browser
// then reads those days here instead of fetching them from adsb.lol itself.
// The userscript asks it (data: adsb.lol, ODbL):
//  /status                       what it has
//  /fr24ids[?since=<ms>]         every callsign-less FR24 flight named here: FR24 flight id -> aircraft, origin, rough destination
//  POST /report                  a browser's FR24 feed headers, the callsign-less flights it sees, the ones it named itself,
//                                the owners and operators it found
//  /owners?hex=a,b,c             the owner and operator of aircraft (looked up here once - owners.cjs - and kept for good)
//  /airport?ap=<FR24 id>[&days=] its runways in full, radio frequencies, the runways the flights tracked there used (airport.cjs)
//  /live                         every LADD / military / PIA / blocked aircraft heard in the last 5 minutes (readsb rows)
//  /board?ap=<FR24 airport id>   flights at an airport, three days back to now (both ends, as rebuilt logs)
//  /legs?hex=<icao>[,<icao>..]   aircraft's flights (90 days)
//  /hist?hex=<icao>[,<icao>..]   blocked aircraft's finished days in the userscript's flight-log format (and days with none);
//                                 the last 40 days of the first five asked for built here if they are not yet (fillHist)
//  /photos?hex=<icao>[,<icao>..]  the pictures of blocked aircraft the browsers found (photos.cjs; sent with /report)
//  /learn?from=YYYY-MM-DD        every blocked aircraft's completed flights of the days after it (two weeks at most), for learning
//  /ladd                         the LADD list as last polled (fresh, no rate limit for the userscript)
//  /last                         where each blocked jet was last heard in the last 14 h (to recognise it over an ocean)
//  /seed?hex=a,b[&front=1]       blocked aircraft the userscript knows: tracked from now on, their last days rebuilt
//  /parked?ap=&type=             aircraft of a type whose last flight ended at that airport (14 days): parked there since
//  /area?lat=&lon=               a place the userscript is looking at: its traffic polled too, for three days
//  POST /hello                   an install saying it is there - counted anonymously (installs.cjs); the newest version,
//                                the owner's notice and minimum version back. /badge: the people counted, for shields.io
// And the owner (the secret): /dash - the admin panel - with /stats, /admin/installs, /admin/options, /admin/log,
// /admin/update, /admin/restart
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const DIR = __dirname, DATA = process.env.MON_DATA || path.join(DIR, 'data'), STORE = process.env.MON_STORE || path.join(DIR, 'store');
const PORT = +(process.env.PORT || process.env.MON_PORT || 47524), HOST = process.env.MON_HOST || '127.0.0.1';
// (on a server: MON_TOKEN is the owner's secret - header X-Monitor-Token. A public monitor (monitor.json "public", the
// default) answers every copy of the script without it, the dashboard's numbers and the full answers only with it; each
// address is held to MON_RATE requests a minute (300 by default when public). Not public: every request needs the secret)
const TOKEN = process.env.MON_TOKEN || '', hits = new Map();
// (the secret as sent, against TOKEN: in constant time, both hashed first so not even its length shows - every comparison
// goes through here; no secret set: never)
const TOKEN_H = crypto.createHash('sha256').update(TOKEN).digest();
const tokenOk = t => !!TOKEN && typeof t === 'string' && crypto.timingSafeEqual(crypto.createHash('sha256').update(t).digest(), TOKEN_H);
const limited = ip => { if (!RATE) return false; const t = Math.floor(Date.now() / 60000), h = hits.get(ip); if (!h || h.t !== t) { hits.set(ip, { t, n: 1 }); if (hits.size > 5000) hits.clear(); return false; } return ++h.n > RATE; };
// laddEvery/milEvery/piaEvery/areaEvery/hexEvery: seconds between polls; apiPerMin: adsb.lol API requests a minute at most
// (all of them together); liveMaxAge: seconds an aircraft stays in /live after its last position; closeDelayH: hours after
// a day ends before its flights are rebuilt from adsb.lol's day traces (published with some delay); fullGap: the longest
// silence (s) of the lists in a day for it to count as watched throughout
const CFG = Object.assign({ areas: [[53.8, -2.6, 250]], laddEvery: 10, milEvery: 30, piaEvery: 120, areaEvery: 120, hexEvery: 30, coldEvery: 600, hotWindow: 2700, hexBatch: 100, backWorkers: 3, userAreas: 8, apiPerMin: 20, liveMaxAge: 300, closeDelayH: 3, fullGap: 200, apiWindowMs: 60000, openskyEvery: 900, adsbxDaily: 150, adsbxKey: process.env.MON_ADSBX_KEY || '', fr24Scan: true, fr24Every: 120, fr24Gap: 400, lookupRadius: 220, ident: {}, dest: {}, public: true, rate: 300, crowdNeed: 2, nearPerMin: 30, telMax: 30000, trackDays: 90, learnDays: 90, lolKeepDays: 40, archiveDays: 220, archiveJobs: 1 }, (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'monitor.json'), 'utf8')); } catch (e) { return {}; } })());
// (PUBLIC0 / RATE_ENV: as started; PUBLIC / RATE: as now - the owner's options (/admin/options, applyOptions) may change
// both while it runs, and every use reads them as they are at the time)
const PUBLIC0 = process.env.MON_PUBLIC ? process.env.MON_PUBLIC !== '0' : CFG.public !== false, RATE_ENV = +(process.env.MON_RATE || 0) || 0;
const rateFor = pub => RATE_ENV || (pub ? +CFG.rate || 0 : 0);
let PUBLIC = PUBLIC0, RATE = rateFor(PUBLIC0);
const { createRouteEngine } = require(fs.existsSync(path.join(DIR, 'engine.js')) ? path.join(DIR, 'engine.js') : '../src/engine.js');
const E = createRouteEngine();
const FR = require('./fr24.cjs'), { createIdent } = require('./ident.cjs'), { createDest } = require('./dest.cjs'), { createOwners } = require('./owners.cjs');
const { createAirportInfo } = require('./airport.cjs'), APT = createAirportInfo({ E });
const { createNames } = require('./names.cjs');
const { createTel } = require('./tel.cjs');
const { createTracks } = require('./tracks.cjs');
const ARCH = require('./archive.cjs');
const { createWaiting } = require('./waiting.cjs');
const { createPhotos } = require('./photos.cjs'), photos = createPhotos();
// (the newest report of every aircraft heard - for the figures FR24 padlocks, any aircraft: tel.cjs)
const tel = createTel({ max: CFG.telMax });
// (every blocked aircraft's track, 90 days: playback named from it - tracks.cjs)
const tracks = createTracks({ store: STORE, keepDays: CFG.trackDays, log: (...a) => log('tracks', ...a) });
// (what public ADS-B lacks where no radar asks for it - airspeeds, Mach, wind, temperature - from a weather model: wx.cjs)
const { createWx } = require('./wx.cjs');
const wx = createWx(Object.assign({ fetch: (u, o) => global.fetch(u, o) }, CFG.wx || {}));
const { createRegistry } = require(fs.existsSync(path.join(DIR, 'registry.js')) ? path.join(DIR, 'registry.js') : '../src/registry.js');
// (the last 300 lines are also kept in memory for the owner's LADD Unblock window - /admin/log - never the secret)
const logRing = [];
const scrub = s => TOKEN ? String(s).split(TOKEN).join('[secret]') : String(s);
const log = (...a) => {
  const t = new Date().toISOString().slice(0, 19);
  console.log(t, ...a);
  try { logRing.push(scrub(t + ' ' + a.map(x => x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : JSON.stringify(x)).join(' ')).slice(0, 2000)); if (logRing.length > 300) logRing.splice(0, logRing.length - 300); } catch (e) { /* not kept */ }
};

function loadEngine() {
  E.setAirports(JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows);
  const rd = f => { const p = path.join(DATA, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  const rw = rd('runways.json'); if (rw) E.setRunways(rw);
  const rl = rd('runway_len.json'); if (rl) E.setRunwayLengths(rl);
  APT.load(DATA);
  const oa = path.join(DATA, 'oa_airports.csv');
  if (fs.existsSync(oa)) { const fields = require(fs.existsSync(path.join(DIR, 'dataset.cjs')) ? path.join(DIR, 'dataset.cjs') : '../test/dataset.cjs').loadFields(DATA); E.setFields(fields); }
  // (the learned tables and weights the userscript is built with: airports' usage by kind of aircraft, routes, the model -
  // for the rough destinations, and so a flight's guessed end is weighed as the browser weighs it)
  const src = f => [path.join(DIR, f), path.join(DIR, '..', 'src', f)].find(x => fs.existsSync(x));
  const tb = src('tables.json'), lg = src('logit.json');
  if (tb) E.setTables(JSON.parse(fs.readFileSync(tb, 'utf8')));
  if (lg) E.setLogit(JSON.parse(fs.readFileSync(lg, 'utf8')));
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
  if (!b) { blocked.set(hex, b = { reg: '', type: '', at: Math.round(nowS), heard: 0 }); stateDirty = true; wantBackfill(hex, nowS); owners.want(hex, m && m.reg); }
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
    watch, lastW, closed, flew: Object.fromEntries([...flew].map(([d, s]) => [d, [...s]])), histQ: histQ.map(j => [j.hex, j.day, j.tries, j.at, j.fill ? 1 : 0]),
    fr24: { dev: fr24.st.deviceId, hdr: fr24.st.hdr, ua: fr24.st.ua, hdrAt: fr24.st.hdrAt } }));
  fs.renameSync(tmp, f); stateDirty = false;
}
function loadState() {
  let s = null; try { s = JSON.parse(fs.readFileSync(path.join(STORE, 'state.json'), 'utf8')); } catch (e) { return null; }
  for (const [h, b] of Object.entries(s.blocked || {})) blocked.set(h, { reg: b[0] || '', type: b[1] || '', at: b[2] || 0, heard: b[3] || 0, faa: !!b[4], lad: b[5] || 0 });
  for (const a of s.areas || []) if (Array.isArray(a) && a.length === 4) userAreas.push(a);
  Object.assign(watch, s.watch || {}); Object.assign(lastW, s.lastW || {}); closed = s.closed || '';
  for (const [d, l] of Object.entries(s.flew || {})) for (const h of l) flewAdd(h, d);
  for (const [hex, day, tries, at, fill] of s.histQ || []) queueHist(hex, day, tries, at, !!fill);
  if (s.fr24) { if (s.fr24.dev) fr24.st.deviceId = s.fr24.dev; if (s.fr24.hdr) { fr24.st.hdr = s.fr24.hdr; fr24.st.ua = s.fr24.ua || ''; fr24.st.hdrAt = s.fr24.hdrAt || 0; } }
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
  if ((a.dbFlags & 13) || blocked.has(hex)) { const p = live.get(hex); if (!p || t > p.t) { const o = {}; for (const k of LIVE_KEYS) if (a[k] != null) o[k] = a[k]; live.set(hex, { a: o, t, upd: Date.now() }); } }
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
// (the runways a flight used, where it took off and landed at an airport - airport.cjs)
function legRunways(leg, l) {
  const sure = e => !!e && /^(ground|low)$/.test(e.conf || '');
  if (sure(leg.from)) { const r = APT.runwayOf(E.byId(leg.from.id), l.pts, false); if (r) leg.rwyOff = r; }
  if (leg.to && !leg.open && sure(leg.to)) { const r = APT.runwayOf(E.byId(leg.to.id), l.pts, true); if (r) leg.rwyOn = r; }
}
// The flights in an aircraft's kept positions; finished ones stored, their positions let go
function buildLegs(hex, nowS) {
  const x = ac.get(hex); if (!x || !x.dirty || x.rows.length < 2) return;
  x.dirty = false;
  const bl = blocked.get(hex);
  // (a blocked aircraft's positions heard since the last time: into its track)
  if (bl) { const from = x.trkAt || 0, nw = x.rows.filter(r => r[0] > from); if (nw.length) { tracks.put(hex, nw); x.trkAt = nw[nw.length - 1][0]; } }
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
    const leg = { hex, reg: info.reg, type: info.type, cs: s.cs || info.cs, ladd: !!bl, from: s.from, to: done || s.ended ? s.to : null, tStart: s.tStart, tEnd: s.tEnd, tOff: s.tOff, tOn: s.tOn, ended: !!s.ended || lostLow, open: !done, startedOnGround: s.startedOnGround, startLat: s.startLat, startLon: s.startLon, endLat: s.endLat, endLon: s.endLon, maxAlt: s.maxAlt || 0, pathKm: s.pathKm || 0, endAlt: s.endAlt, how: s.how, endRules: s.endRules };
    legRunways(leg, l);
    let m = legs.get(hex); if (!m) legs.set(hex, m = new Map());
    // (a flight already under way when the monitor last stopped: its take-off as kept then)
    if (!leg.from && !leg.startedOnGround) for (const [k, o] of m) if (o.open && o.tStart < leg.tStart && leg.tStart - o.tEnd < 3 * 3600) { Object.assign(leg, { from: o.from, tStart: o.tStart, tOff: o.tOff, startedOnGround: o.startedOnGround, startLat: o.startLat, startLon: o.startLon }); if (o.rwyOff) leg.rwyOff = o.rwyOff; m.delete(k); break; }
    // (the same flight logged from FR24's positions before ADS-B had it: ADS-B's record replaces it - the ends it missed taken over)
    for (const [k, o] of m) if (o.via === 'fr24' && o.tStart < leg.tEnd + 600 && o.tEnd > leg.tStart - 600) { if (!leg.from && o.from) { leg.from = o.from; leg.tOff = leg.tOff || o.tOff; if (o.rwyOff) leg.rwyOff = o.rwyOff; } if (done && !leg.to && o.to) { leg.to = o.to; leg.tOn = leg.tOn || o.tOn; if (o.rwyOn) leg.rwyOn = o.rwyOn; } m.delete(k); dirtyDays.add(dayOf(o.tOff || o.tStart)); }
    m.set(legKey(leg), leg); dirtyDays.add(dayOf(leg.tOff || leg.tStart));
    if (done) keepFrom = l.end.t;
  });
  // (positions of finished flights are no longer needed; the last of them stays, for the next take-off)
  if (keepFrom) { const i = x.rows.findIndex(r => r[0] >= keepFrom); x.rows = i < 0 ? x.rows.slice(-1) : x.rows.slice(Math.max(0, i - 1)); }
  if (nowS - x.last > 14 * 3600) ac.delete(hex);
}

// ---- a blocked aircraft's flight log, day by day, as the userscript builds its own (03-data.js loadHistory): each day
// from both networks, merged - adsb.lol's full day trace (the last 40 days: what it keeps) and airplanes.live's (every day;
// the only one older than that) - through the same engine: legsFromPoints to the end of the day, summarizeLeg with what its
// earlier flights say of its home. Each hears what the other's receivers miss - a whole flight one of them never heard
// (TC-ACN's London - Istanbul of 13 Sep, on airplanes.live only). One file per aircraft, kept for good; read when asked,
// never all held in memory.
const HIST_V = 7;            // (the userscript's HIST_V: the same leg reconstruction, or its days are not used - 7: the networks' answers read anew, adsb.lol's days from its archives; every log kept before is rebuilt)
const HIST_DIR = path.join(STORE, 'hist');
const histFile = hex => path.join(HIST_DIR, hex + '.json');
const histStats = { built: 0, empty: 0, merged: 0, part: 0, fails: 0, fromArchive: 0 };
// (a log kept by an older build: none - it is built again from both networks. part: the days built with one network only,
// the other refusing - a browser looking at the aircraft reads them again, both networks; lo: the days built from adsb.lol's
// archive alone - airplanes.live not asked for them here (thousands of aircraft a day): a browser looking adds it)
function histRead(hex) {
  try {
    const h = JSON.parse(fs.readFileSync(histFile(hex), 'utf8'));
    if (h && h.hv === HIST_V && h.days && Array.isArray(h.legs)) { h.part = h.part && typeof h.part === 'object' ? h.part : {}; h.lo = h.lo && typeof h.lo === 'object' ? h.lo : {}; return h; }
  } catch (e) { /* none yet */ }
  return { hv: HIST_V, days: {}, legs: [], part: {}, lo: {} };
}
// Every saved flight log deleted, once, the first time a monitor with this reset id starts (and when the owner asks): the
// files of STORE/hist - nothing else; what the monitor learned (learn/, learn-crowd/), its tracks and its names are kept.
// They are built again from both networks as aircraft are looked at.
const HIST_RESET = '22.31.9';
const histResetMark = path.join(STORE, 'hist-reset.txt');
function resetHistLogs() {
  let n = 0;
  try { for (const f of fs.readdirSync(HIST_DIR)) { try { fs.unlinkSync(path.join(HIST_DIR, f)); n++; } catch (e) { /* gone */ } } } catch (e) { /* none yet */ }
  try { fs.mkdirSync(STORE, { recursive: true }); fs.writeFileSync(histResetMark, HIST_RESET); } catch (e) { /* the next start does it again */ }
  return n;
}
let histResetN = -1;
try { if (fs.readFileSync(histResetMark, 'utf8').trim() !== HIST_RESET) throw new Error('older'); } catch (e) { histResetN = resetHistLogs(); log('flight logs: every saved log deleted (reset ' + HIST_RESET + '):', histResetN, 'files - built again from both networks as aircraft are looked at'); }
// (kept for good: a blocked aircraft's whole history - a few kilobytes a month)
function histWrite(hex, h) {
  fs.mkdirSync(HIST_DIR, { recursive: true });
  h.legs.sort((a, b) => a.tStart - b.tStart);
  const f = histFile(hex), tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(h)); fs.renameSync(tmp, f);
}
// (what the userscript learns from a flight - squawk blocks, FMS altitudes, where it flew - needs the positions, which the
// summary does not keep: worked out here, alongside it)
function learnOf(raw, s) {
  if (!s.from || !s.to) return null;
  const sq = new Set(), fm = new Set();
  for (const p of raw.pts) { if (p.alt > 1500 && p.sq && /^[0-7]{4}$/.test(p.sq) && !E.SQ_NOINFO.test(p.sq)) sq.add(p.sq.slice(0, 2)); if (p.fms > 5000 && !(p.vr < -500)) fm.add(Math.round(p.fms / 2000)); }
  return [[...sq].join(','), [...fm].join(','), E.flowKeysOf(raw.pts, E.byId(s.to.id)).slice(0, 16).join('|')];
}
// ---- the networks' trace files, read for what each answer is (as the userscript reads them: 03-data classifyTrace) - the
// file, no file (404: a day the network heard nothing of the aircraft), a verification page (adsb.lol's proof-of-work
// "Verifying connection", Cloudflare's "Just a moment": shown to servers now - the host is left alone an hour; adsb.lol's
// days come from its archives), a refusal to slow down (two minutes), a failure. Only the file and no file are answers.
const WALL_RE = /<title>\s*(?:verification|just a moment|attention required)|verifying connection|solving security challenge|proof[- ]of[- ]work|cf[-_]chl|challenge-platform|cf-browser-verification/i;
const netSt = {};      // host -> { ok, none, wall, rate, err, last, lastAt, wallAt }
const pauseWhy = {};   // host -> 'wall' | 'rate'
function classifyTrace(hex, status, text) {
  const body = String(text || ''), head = body.slice(0, 4000).replace(/^\uFEFF/, '').trimStart();
  if (status === 404) return { state: 'none' };
  if (status >= 200 && status < 300) {
    if (head[0] === '{') {
      let j; try { j = JSON.parse(body); } catch (e) { return { state: 'err', err: 'file cut short' }; }
      if (!j || !Array.isArray(j.trace)) return { state: 'err', err: 'not a trace file' };
      const ic = String(j.icao || '').toLowerCase().replace(/^~/, '');
      if (hex && ic && ic !== hex) return { state: 'err', err: 'another aircraft\'s file' };
      return { state: 'ok', j };
    }
    if (head[0] === '<' && WALL_RE.test(body.slice(0, 30000))) return { state: 'wall', err: 'verification page' };
    return { state: 'err', err: head ? 'not a trace file' : 'empty answer' };
  }
  if (status === 429) return { state: 'rate', err: 'HTTP 429' };
  if (status >= 400 && WALL_RE.test(body.slice(0, 30000))) return { state: 'wall', err: 'verification page (HTTP ' + status + ')' };
  return { state: 'err', err: status ? 'HTTP ' + status : 'no answer' };
}
// -> { state: 'ok' (j) | 'none' | 'wall' | 'rate' | 'paused' (the host left alone: why in pauseWhy) | 'err', err }
async function traceGet(url, hex) {
  const host = hostOf(url), S = netSt[host] || (netSt[host] = { ok: 0, none: 0, wall: 0, rate: 0, err: 0, last: '', lastAt: 0, wallAt: 0 });
  if (Date.now() < (pause[host] || 0)) return { state: 'paused', why: pauseWhy[host] || 'rate', err: (pauseWhy[host] === 'wall' ? 'verification page' : 'rate-limited') + ' - paused' };
  let c;
  try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); c = classifyTrace(hex, r.status, await r.text()); }
  catch (e) { c = { state: 'err', err: String(e && e.message || e).slice(0, 60) }; }
  S[c.state]++; S.last = c.state === 'err' ? c.err : c.state; S.lastAt = Date.now();
  if (c.state === 'wall') { if (!(pause[host] > Date.now())) log(host + ': verification page in front of its trace files - left alone an hour' + (host === 'adsb.lol' ? ' (its days come from its archives)' : '')); pause[host] = Date.now() + 3600e3; pauseWhy[host] = 'wall'; S.wallAt = Date.now(); }
  if (c.state === 'rate') { pause[host] = Date.now() + 120000; pauseWhy[host] = 'rate'; }
  return c;
}
let apliveLast = 0;          // (airplanes.live's history files: one at a time, two seconds apart)
// (-> { state: 'ok', j } | 'none' | 'err' - a refusal or a verification page leaves it alone a while; the userscript reads
// those days itself)
async function apliveTrace(hex, day) {
  const host = 'globe.airplanes.live';
  if (Date.now() < (pause[host] || 0)) return { state: 'err' };
  const wait = apliveLast + 2000 - Date.now(); apliveLast = Math.max(Date.now(), apliveLast + 2000); if (wait > 0) await sleep(wait);
  const r = await traceGet(`https://${host}/globe_history/${slashDay(day)}/traces/${hex.slice(-2)}/trace_full_${hex}.json`, hex);
  // (refused - it asks scripts to keep to its globe now and then: left alone six hours)
  if (r.state === 'err' && /HTTP 403/.test(r.err)) { pause[host] = Date.now() + 6 * 3600e3; pauseWhy[host] = 'rate'; }
  return r.state === 'ok' ? { state: 'ok', j: r.j } : r.state === 'none' ? { state: 'none' } : { state: 'err' };
}
// (a day that could not be rebuilt - its file never came, or would not read: marked so - never taken for a day without
// flights; the userscript reads it itself)
function histUnknown(hex, day) {
  const h = histRead(hex), hd = slashDay(day);
  if (!(h.days[hd] >= 0)) { h.days[hd] = -1; histWrite(hex, h); }
  histStats.fails++;
}
// One day of one aircraft from what each network answered of it - { state: 'ok', j } its file, 'none' no file (a day it
// heard nothing of the aircraft), 'skip' not asked (adsb.lol, older than it keeps), 'err' refused or failed. The day's
// flights from all the files had, merged. A day with no file anywhere is one without flights only when every network asked
// answered; with one refusing, the day is not known (-1) - unless the other had flights: kept, marked part of it.
async function histDay(hex, day, lol, apl, batch) {
  if (E.airports.length < 1000) throw new Error('airports not loaded');   // (never a log with no airports in it)
  const ptsL = lol.state === 'ok' ? E.parseTrace(lol.j) : [], ptsA = apl.state === 'ok' ? E.parseTrace(apl.j) : [];
  const pts = ptsL.length && ptsA.length ? E.mergePoints(ptsL, ptsA) : ptsL.length ? ptsL : ptsA;
  if (ptsL.length && ptsA.length && pts.length > ptsL.length) histStats.merged++;
  const complete = lol.state !== 'err' && apl.state !== 'err';
  if (!pts.length && !complete) { histUnknown(hex, day); return 0; }
  const j = (lol.state === 'ok' && lol.j) || (apl.state === 'ok' && apl.j) || null;
  const b = blocked.get(hex), x = ac.get(hex), meta = (x && x.meta) || {}, hd = slashDay(day);
  const info = { hex, type: String((j && j.t) || meta.type || (b && b.type) || '').toUpperCase(), reg: String((j && j.r) || meta.reg || (b && b.reg) || '').toUpperCase(), mil: !!((j && j.dbFlags & 1) || meta.mil), cat: meta.cat || ((pts.find(p => p.cat) || {}).cat) || '' };
  const cls = E.classify(info), opt = { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', cls, type: info.type, rangeKm: E.typeRangeKm(info), dataEnd: Math.min(Date.now() / 1000, dayStart(day) + 86400) };
  const h = histRead(hex);
  // (its home and usual fields, from its flights before that day - as the userscript's summary has them from its log)
  const before = E.chainLegs(E.stitchLegs(h.legs.filter(l => l.day < hd).map(l => Object.assign({}, l)))).slice(-60);
  const hs = E.histStats(before, Date.now() / 1000), ctx = { visits: hs.visits, base: hs.base, mil: info.mil, grp: E.groupOf(cls), cls, type: info.type };
  const raws = E.legsFromPoints(pts, opt), sums = raws.map(l => E.summarizeLeg(l, ctx));
  if (pts.length) tracks.put(hex, pts);   // (the whole day, both networks: its track filled in)
  const h2 = histRead(hex);   // (read again: another worker may have written a day meanwhile)
  // (read again with one network refusing, and fewer flights than kept: the day stays as it was)
  if (!complete && h2.legs.filter(l => l.day === hd).length > sums.length) return sums.length;
  h2.legs = h2.legs.filter(l => l.day !== hd).concat(sums.map((s, i) => Object.assign(s, { day: hd, lx: learnOf(raws[i], s) })));
  h2.days[hd] = sums.length;
  if (complete) delete h2.part[hd]; else { h2.part[hd] = 1; histStats.part++; }
  if (apl.state === 'later') h2.lo[hd] = 1; else delete h2.lo[hd];
  histWrite(hex, h2);
  const lrows = sums.map(s => learnRow(hex, s, h2.legs.find(l => l.day === hd && l.tStart === s.tStart), cls, info)).filter(Boolean);
  // (a whole day's archive: its rows written once at the end - one file rewritten per aircraft would be thousands)
  if (batch) batch.push(...lrows); else learnWrite(hd, lrows);
  if (sums.length) histStats.built++; else histStats.empty++;
  return sums.length;
}
// ---- every blocked aircraft's completed flights, for the userscript's own learning (03-data learnFromLeg): the same row,
// [hex|take-off, from, to, landed, squawk blocks, FMS levels, class, military, take-off, callsign, type, flow cells] - one
// file per day, kept for good; /learn hands out the days a browser has not had (two weeks at most at a time)
const LEARN_DIR = path.join(STORE, 'learn');
function learnRow(hex, s, kept, cls, info) {
  if (!s || !s.from || !s.to || s.from.id === s.to.id || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 480) return null;
  const lx = (kept && kept.lx) || ['', '', ''];
  return [hex + '|' + Math.round(s.tStart), s.from.id, s.to.id, Math.round(s.tEnd), lx[0] || '', lx[1] || '', cls, info.mil ? 1 : 0, Math.round(s.tStart), s.cs || '', info.type || '', lx[2] || ''];
}
function learnWrite(hd, rows) {
  const f = path.join(LEARN_DIR, hd.replace(/\//g, '-') + '.json'); let all = [];
  try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { all = []; }
  if (!rows.length && !all.length) return;
  const keys = new Set(rows.map(r => r[0])), out = all.filter(r => !keys.has(r[0])).concat(rows);
  fs.mkdirSync(LEARN_DIR, { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(out)); fs.renameSync(f + '.tmp', f);
}
function learnSince(from, nowS) {
  nowS = nowS || Date.now() / 1000;
  const days = fs.existsSync(LEARN_DIR) ? fs.readdirSync(LEARN_DIR).map(f => (/^(\d{4}-\d\d-\d\d)\.json$/.exec(f) || [])[1]).filter(Boolean).sort() : [];
  const today = dayOf(nowS), floor = dayOf(nowS - 14 * 86400), want = days.filter(d => d > (from || '') && d >= floor && d < today).slice(0, 14);
  let rows = []; for (const d of want) { try { rows = rows.concat(JSON.parse(fs.readFileSync(path.join(LEARN_DIR, d + '.json'), 'utf8'))); } catch (e) { /* a file being written */ } }
  return { days: want, rows };
}
// ---- (22.25) what the browsers learned: the flights each one rebuilt from an aircraft's track with its own engine
// (adsb.lol's traces, ADS-B Exchange with the user's key, the heatmaps - aircraft the monitor does not follow too), in
// the same row as the monitor's own (learnRow). Kept apart (STORE/learn-crowd/YYYY-MM-DD.json) and learned with them
// (learnedBuild): every browser's engine has them with its next /learned. A row is taken when it reads as a real flight
// (two airports, eight minutes and more, no faster than a jet, within the days learned), not when the monitor has that
// aircraft's flight of the time itself (its own is the better one); from anyone else's browser CFG.learnPerHour an hour
const LEARN_CROWD_DIR = path.join(STORE, 'learn-crowd');
const crowdLearn = new Map();   // day -> Map(key -> row): taken, to be written (work)
const LC = { got: 0, taken: 0, refused: 0, dup: 0 };
// (each report's flights taken get a number that only grows - kept with them, [12]; /learned says the last one it has:
// a browser leaves its own copy of a flight out of its tables exactly when the monitor's learning has it - no clocks)
let learnSeq = Date.now();   // (from the clock at start: above every number kept from before)
function learnCheck(r, nowS) {
  if (!Array.isArray(r) || r.length < 12) return null;
  const m = /^([0-9a-f]{6})\|(\d{9,10})$/.exec(String(r[0] || '')); if (!m) return null;
  const from = E.byId(+r[1]), to = E.byId(+r[2]), t0 = +r[8], t1 = +r[3];
  if (!from || !to || from.id === to.id || !(t0 > 0) || Math.abs(t0 - +m[2]) > 60 || !(t1 - t0 >= 480 && t1 - t0 <= 20 * 3600)) return null;
  if (t0 < nowS - CFG.learnDays * 86400 || t1 > nowS + 600) return null;
  if (E.dist(from.lat, from.lon, to.lat, to.lon) / ((t1 - t0) / 3600) > 1100) return null;
  const str = (v, re, n) => { v = String(v == null ? '' : v); return v.length <= n && re.test(v) ? v : null; };
  const sq = str(r[4], /^(\d\d(,\d\d)*)?$/, 60), fm = str(r[5], /^(\d{1,2}(,\d{1,2})*)?$/, 80), cls = str(r[6], /^[a-z]{2,12}$/, 12), cs = str(r[9], /^[A-Z0-9]{0,8}$/, 8), ty = str(r[10], /^[A-Z0-9]{0,5}$/, 5), fl = str(r[11], /^[0-9,|]*$/, 400);
  if ([sq, fm, cls, cs, ty, fl].some(v => v == null)) return null;
  return [m[1] + '|' + m[2], from.id, to.id, Math.round(t1), sq, fm, cls, r[7] ? 1 : 0, Math.round(t0), cs, ty, fl];
}
// (-> how many were taken, the place in the list of each one not - refused, or past the hour's share: the browser goes
// on learning those itself, the monitor's learning never covering them - and the report's number)
function learnFromCrowd(rows, who, nowMs) {
  const nowS = nowMs / 1000, ok = who ? allowance('learn', who, +CFG.learnPerHour || 600) : null, not = [], seq = learnSeq = Math.max(learnSeq + 1, Math.floor(nowMs)); let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i >= 1000) { not.push(i); continue; }
    LC.got++;
    const r = learnCheck(rows[i], nowS); if (!r) { LC.refused++; not.push(i); continue; }
    const m = legs.get(r[0].slice(0, 6));
    if (m && [...m.values()].some(l => (l.tOff || l.tStart) < r[3] + 600 && (l.tOn || l.tEnd || l.tStart) > r[8] - 600)) { LC.dup++; continue; }
    if (ok && !ok()) { LC.refused++; not.push(i); continue; }
    const d = dayOf(r[8]); let x = crowdLearn.get(d); if (!x) crowdLearn.set(d, x = new Map());
    if (!x.has(r[0])) x.set(r[0], r.concat([seq])); n++; LC.taken++;
  }
  return { n, not, seq };
}
// (a flight already kept - another browser sent it first - stays as it was, with its number)
function crowdLearnSave() {
  for (const [d, x] of crowdLearn) {
    const f = path.join(LEARN_CROWD_DIR, d + '.json'); let all = [];
    try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { all = []; }
    all = all.filter(r => Array.isArray(r)); const have = new Set(all.map(r => r[0]));
    const out = all.concat([...x.values()].filter(r => !have.has(r[0])));
    fs.mkdirSync(LEARN_CROWD_DIR, { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(out)); fs.renameSync(f + '.tmp', f);
  }
  crowdLearn.clear();
}
// (a day's rows from the browsers, less the flights the monitor's own rows of that day have - and each flight once;
// upTo: those taken by then only - one taken while a build is on its way waits for the next)
function crowdRows(d, own, upTo) {
  let rows = []; try { rows = JSON.parse(fs.readFileSync(path.join(LEARN_CROWD_DIR, d + '.json'), 'utf8')); } catch (e) { return []; }
  const by = new Map(), add = r => { const h = String(r[0]).slice(0, 6); (by.get(h) || by.set(h, []).get(h)).push([r[8], r[3]]); };
  for (const r of own) if (Array.isArray(r)) add(r);
  const out = [];
  for (const r of rows) { if (!Array.isArray(r) || r[12] > upTo) continue; if ((by.get(String(r[0]).slice(0, 6)) || []).some(([a, b]) => a < r[3] + 600 && b > r[8] - 600)) continue; out.push(r); add(r); }
  return out;
}
// The days still to rebuild - one blocked aircraft's day each - after the day ends; persisted, retried a while when adsb.lol
// has not published the day's file yet
const histQ = [], histPend = new Set();
function queueHist(hex, day, tries, at, fill) { const k = hex + '|' + day; if (histPend.has(k)) return; histPend.add(k); histQ.push({ hex, day, tries: tries || 0, at: at || 0, fill: !!fill }); }
// A blocked aircraft's log built here when someone looks at it: the finished days of the last 40 (adsb.lol keeps 40,
// airplanes.live is asked for any it has no file of) it has no answer of yet - then every browser has them at once, the
// panel's "Recent flights" and the log page with no wait. Once every 12 hours for an aircraft, 4000 days waiting at most
// (one worker, a second apart: in the background of the day's own)
const FILL_DAYS = 220, fillAsked = new Map();
function fillHist(hex, nowS) {
  const b = blocked.get(hex); if (!b || histQ.length > 4000 || nowS - (fillAsked.get(hex) || 0) < 12 * 3600) return 0;
  fillAsked.set(hex, nowS); if (fillAsked.size > 20000) fillAsked.delete(fillAsked.keys().next().value);
  const h = fs.existsSync(histFile(hex)) ? histRead(hex) : { days: {}, part: {} }, served = histOf(hex).days;
  let n = 0;
  for (let k = 1; k <= FILL_DAYS; k++) {
    const d = dayOf(nowS - k * 86400), hd = slashDay(d);
    // (a day served as one without flights only because it was watched and not heard is built too: adsb.lol can have missed
    // what airplanes.live heard - TC-ACN's 13 and 26 Sep)
    if (d > closed || (served[hd] > 0 && !(h.part && h.part[hd])) || (hd in h.days && h.days[hd] >= 0 && !(h.part && h.part[hd]))) continue;
    // (a day adsb.lol's archives cover - read, or to be read: every aircraft of it at once, nothing asked of the sites)
    if (archiveState(d, nowS) !== 'off') continue;
    queueHist(hex, d, 0, 0, true); n++;
  }
  return n;
}
// (a day ended - and some hours more, for adsb.lol to publish it: each blocked aircraft heard in the air that day rebuilt)
function closeDays(nowS) {
  const ready = d => dayStart(d) + 86400 + CFG.closeDelayH * 3600 <= nowS;
  for (const d of [...flew.keys()].sort()) { if (!ready(d)) continue; for (const hex of flew.get(d)) queueHist(hex, d); flew.delete(d); stateDirty = true; }
  const c = dayOf(nowS - 86400 - CFG.closeDelayH * 3600); if (c > closed) { closed = c; stateDirty = true; }
}
async function histOne(job) {
  const { hex, day } = job, key = hex + '|' + day, hd = slashDay(day), nowS = Date.now() / 1000, endS = dayStart(day) + 86400;
  const again = (ms, count) => { job.at = Date.now() + ms; if (count) job.tries++; histQ.push(job); };
  // adsb.lol's side of the day: from its archive when the day is one the archives cover (every blocked aircraft of the day
  // at once - archiveLoop); a day whose archive is not out yet waits for it, a day and a half at most. Else its file.
  let lol = { state: 'skip' };
  const arch = archiveState(day, nowS);
  if (arch === 'done') {
    const h = histRead(hex);
    if (hd in h.days && h.days[hd] >= 0 && !h.part[hd]) { histPend.delete(key); return; }   // (built from it)
    lol = { state: 'none' };   // (not in it: adsb.lol heard nothing of the aircraft that day)
  } else if (arch === 'wait') return again(3600e3, false);
  else if (dayStart(day) >= nowS - (+CFG.lolKeepDays || 40) * 86400) {   // (adsb.lol's globe history: the last 40 days)
    const r = await traceGet(`https://adsb.lol/globe_history/${hd}/traces/${hex.slice(-2)}/trace_full_${hex}.json`, hex);
    if (r.state === 'rate' || (r.state === 'paused' && r.why === 'rate')) return again(120000, false);
    if (r.state === 'ok') lol = { state: 'ok', j: r.j };
    else if (r.state === 'none') {
      // (heard flying, no file: not published yet - asked again every two hours for a day and a half; a day asked for
      // to fill a log, or still none then: adsb.lol has none of it)
      if (!job.fill && nowS < endS + 36 * 3600) return again(2 * 3600e3, true);
      lol = { state: 'none' };
    } else if (r.state === 'err' && job.tries < 6) return again(10 * 60000, true);
    else lol = { state: 'err' };   // (a verification page, or failing still: not known from adsb.lol)
  }
  histPend.delete(key);
  // and airplanes.live's, every day (one at a time, two seconds apart; left alone a while when it refuses)
  const apl = await apliveTrace(hex, day);
  // (a day it was heard flying with no file of it anywhere: not known - never a day without flights, it flew; the
  // browsers read it themselves)
  if (!job.fill && lol.state !== 'ok' && apl.state !== 'ok') { histUnknown(hex, day); return; }
  await histDay(hex, day, lol, apl);
}
// ---- adsb.lol's day archives (archive.cjs): each finished day of the last CFG.archiveDays, newest first, one at a time -
// every blocked aircraft's whole day (and every aircraft the archive flags LADD) built from it. A day not published yet is
// asked again an hour later. Kept: STORE/archive/<day>.json, what was read.
const ARCH_DIR = path.join(STORE, 'archive');
const archMark = d => path.join(ARCH_DIR, d + '.json');
const archTried = new Map();   // day -> when it was last found not published
const archRunning = new Set(); // days being read now
const AR = { running: '', days: 0, taken: 0, last: null, err: '', errAt: 0 };
const archRead = d => { try { return JSON.parse(fs.readFileSync(archMark(d), 'utf8')); } catch (e) { return null; } };
// (the days read - true - or given up as never published - false: from the notes on disk, once, then kept up to date)
const archDays = new Map();
try { for (const f of fs.readdirSync(ARCH_DIR)) { const m = /^(\d{4}-\d\d-\d\d)\.json$/.exec(f); if (m) { const r = archRead(m[1]); if (r) archDays.set(m[1], r.published !== false); } } } catch (e) { /* none yet */ }
function archNote(d, o) { fs.mkdirSync(ARCH_DIR, { recursive: true }); fs.writeFileSync(archMark(d), JSON.stringify(o)); archDays.set(d, o.published !== false); }
// (how many of the days the archives cover are read - /status, and the log page under each aircraft's flights)
function archHave(nowS) {
  const n = +CFG.archiveDays || 0; nowS = nowS || Date.now() / 1000; let k = 0;
  for (let i = 1; i <= n; i++) if (archDays.get(dayOf(nowS - i * 86400)) === true) k++;
  return k;
}
// 'off' (not covered: older than the days read, or never published), 'done', 'wait' (to come: the loop gets to every day
// it covers, newest first)
function archiveState(day, nowS) {
  const n = +CFG.archiveDays || 0;
  if (!n || dayStart(day) < nowS - (n + 1) * 86400) return 'off';
  if (archDays.has(day)) return archDays.get(day) ? 'done' : 'off';
  return 'wait';
}
function archiveNext(nowS) {
  const n = +CFG.archiveDays || 0;
  for (let k = 1; k <= n; k++) {
    const d = dayOf(nowS - k * 86400);
    if (dayStart(d) + 86400 + 1800 > nowS || archDays.has(d) || archRunning.has(d) || Date.now() - (archTried.get(d) || 0) < 3600e3) continue;
    return d;
  }
  return null;
}
// The server first. Reading a day's archive is hours of work on a small machine (3.8 GB, tens of thousands of traces);
// two at a time on the 1 GB VM ran it into swap, and /status took longer than browsers wait - they took the monitor for
// gone (no logs, no live figures). The archive waits while the server is slow to answer (its event loop late) or the
// machine is short of memory - a minute at most at a time.
let loopLag = 0, loopAt = Date.now(), memAt = 0, memFree = Infinity;
setInterval(() => { const t = Date.now(); loopLag = Math.max(0, t - loopAt - 500); loopAt = t; }, 500).unref();
// (memory the machine can still give: Linux's MemAvailable - os.freemem() leaves out the page cache under Node 18, and
// on the 1 GB VM that is nearly always "short")
function memAvail() {
  if (Date.now() - memAt < 1000) return memFree; memAt = Date.now();
  try { const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); memFree = m ? +m[1] * 1024 : require('os').freemem(); } catch (e) { memFree = require('os').freemem(); }
  return memFree;
}
async function archBreath(wait, st) {
  wait = wait || sleep; st = st || {};
  for (let i = 0; i < 120; i++) {
    const lag = 'lag' in st ? st.lag : loopLag, free = 'free' in st ? st.free : memAvail();
    if (lag < 200 && free > (+CFG.archiveFreeMb || 120) * 1048576) return i;
    AR.waits = (AR.waits || 0) + 1; await wait(500);
  }
  return 120;
}
// One day's archive: every blocked aircraft in it, every aircraft it flags LADD (blocked from now on) and every military
// one (its log kept here; not followed live)
async function archiveDay(d, io) {
  archRunning.add(d); AR.running = [...archRunning].join(', '); const nowS = Date.now() / 1000, rows = [];
  try {
    const st = await ARCH.importDay(d, (hex, hd) => blocked.has(hex) || (hd.flags & 9) !== 0, async (hex, j) => {
      // (an aircraft the archive flags LADD that the monitor did not know: blocked from now on - its days come from here)
      if (blocked.has(hex) || (j.dbFlags & 8)) { if (!blocked.has(hex)) backDone.add(hex); markBlocked(hex, { reg: j.r || '', type: j.t || '' }, nowS); }
      try { await histDay(hex, d, { state: 'ok', j }, { state: 'later' }, rows); histStats.fromArchive++; AR.taken++; } catch (e) { log('archive day', hex, d, String(e)); }
      // (the server answers meanwhile; a test's own network: its own pace)
      await (!io ? archBreath() : io.breath ? io.breath() : new Promise(r => setImmediate(r)));
    }, io || { get: ARCH.netGet, open: ARCH.netOpen, pace: () => archBreath() });
    // (not out a week after the day: none of it will be - noted, and the day read the old way)
    if (!st.published) { archTried.set(d, Date.now()); if (nowS > dayStart(d) + 8 * 86400) archNote(d, { at: Date.now(), published: false }); return st; }
    if (rows.length) learnWrite(slashDay(d), rows);
    // (its tracks written and let go - the days read one after another would otherwise sit in memory ten at a time)
    try { tracks.save(); tracks.release(d); } catch (e) { log('archive tracks', d, String(e)); }
    archNote(d, Object.assign({ at: Date.now() }, st));
    AR.days++; AR.last = Object.assign({ day: d }, st);
    log('archive', d, '-', st.taken, 'aircraft of', st.traces, 'traces,', Math.round(st.ms / 1000), 's');
    return st;
  } finally { archRunning.delete(d); AR.running = [...archRunning].join(', '); }
}
// (archiveJobs days read at once - one: on the 1 GB VM two ran it into swap)
async function archiveLoop() {
  for (;;) {
    const d = archiveNext(Date.now() / 1000);
    if (d) { try { await archiveDay(d); } catch (e) { AR.err = String(e && e.message || e).slice(0, 120); AR.errAt = Date.now(); archTried.set(d, Date.now()); log('archive', d, AR.err); } }
    await sleep(d ? 2000 : 10 * 60000);
  }
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
  // (a day adsb.lol's archive has been read for, the aircraft not in it: adsb.lol heard nothing of it that day - no flights,
  // as adsb.lol knows it; served as that - lo, adsb.lol alone - like the days built from the archive: a browser that can
  // read airplanes.live adds it)
  const lo = new Set(Object.keys(h.lo || {})), nA = +CFG.archiveDays || 0, nowS = Date.now() / 1000;
  if (nA) for (const [d, ok] of archDays) { if (!ok || dayStart(d) < nowS - (nA + 1) * 86400) continue; const hd = slashDay(d); if (!(h.days[hd] >= 0)) { days[hd] = 0; lo.add(hd); } }
  return { hex, days, legs: h.legs.filter(l => days[l.day] > 0), part: Object.keys(h.part || {}).filter(d => days[d] > 0), lo: [...lo].filter(d => d in days && !(h.part && h.part[d])) };
}

// An aircraft's positions heard here over the last 26 hours - its track as kept (a point a minute in the air, the moments
// it took off and landed) and the flight now in full - in adsb.lol's trace format: today's flights for a browser that the
// networks' own files are walled from (null: nothing heard)
function traceOf(hex, nowS) {
  const from = nowS - 26 * 3600, x = ac.get(hex), live0 = x && x.rows.length ? x.rows[0][0] : Infinity, out = [];
  for (const d of [dayOf(nowS - 86400), dayOf(nowS)]) for (const p of tracks.of(hex, d)) if (p[0] >= from && p[0] < live0) out.push([p[0], p[1], p[2], p[4] ? 'ground' : p[3], null, null, 0, null, null, null, null]);
  out.sort((a, b) => a[0] - b[0]);
  if (x) for (const r of x.rows) if (r[0] >= from) out.push(r);
  if (!out.length) return null;
  const m = (x && x.meta) || {}, b = blocked.get(hex) || {};
  return { icao: hex, r: m.reg || b.reg || '', t: m.type || b.type || '', dbFlags: (b.faa ? 8 : 0) | (m.mil ? 1 : 0), timestamp: 0, trace: out, src: 'monitor' };
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
// (allow: how many aircraft not yet followed may be added - a stranger's browser on a public monitor is held to a budget)
function seed(hexes, front, nowS, allow) {
  let n = 0;
  for (const h of hexes) {
    const hex = String(h).toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) continue;
    if (!blocked.has(hex) && allow && !allow()) continue;
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
    // (a verification page: nothing of adsb.lol's for now - its finished days come from the archives)
    const r = await traceGet(url, hex);
    if (r.state === 'rate' || (r.state === 'paused' && r.why === 'rate')) { backQ.unshift({ hex, days: days.slice(days.indexOf(d)) }); await sleep(60000); return; }
    const j = r.state === 'ok' ? r.j : null, none = r.state === 'none';
    if (j && Array.isArray(j.trace)) {
      for (const p of j.trace) rows.push([j.timestamp + p[0]].concat(p.slice(1, 11)));
      if (j.dbFlags & 8 || isBlocked(hex)) markBlocked(hex, { reg: j.r, type: j.t }, Date.now() / 1000);
      if (j.r || j.t) { const x0 = ac.get(hex) || ac.set(hex, { meta: {}, rows: [], last: 0, first: Date.now() / 1000, dirty: false }).get(hex); if (j.r && !x0.meta.reg) x0.meta.reg = j.r; if (j.t && !x0.meta.type) x0.meta.type = j.t; if (j.dbFlags & 1) x0.meta.mil = true; }
    }
    // (a past day: its flight log as the userscript would build it, from this same file and airplanes.live's - and a day
    // neither has a file for, well after it ended, a day without flights; today: in the air today, so rebuilt once the
    // day is over)
    if (isBlocked(hex)) {
      if (d !== today && ((j && Array.isArray(j.trace)) || (none && Date.now() / 1000 > dayStart(d) + 86400 + 6 * 3600))) {
        const apl = await apliveTrace(hex, d);
        try { await histDay(hex, d, j && Array.isArray(j.trace) ? { state: 'ok', j } : { state: 'none' }, apl); } catch (e) { log('history day', hex, d, String(e)); }
      }
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
  if (isBlocked(hex)) tracks.put(hex, before);
  x.rows = before.concat(x.rows); x.first = before[0][0]; x.dirty = true;
  buildLegs(hex, Date.now() / 1000);
}
// (the live lists come first: while adsb.lol is pausing the monitor, or the LADD list is more than three rounds behind,
// the workers wait - after a restart thousands of day files are to be read, and adsb.lol seems to limit an address's
// history files and API requests together. Never more than ten minutes on end: an API down for hours does not hold up
// the day logs, which come from the history files)
const backWaits = { n: 0, since: 0 };
const liveBusy = () => { const n = Date.now(); return n < (pause['api.adsb.lol'] || 0) || n < (pause['adsb.lol'] || 0) || (!!lastOk.ladd && n - lastOk.ladd > 3 * CFG.laddEvery * 1000 + 5000); };
// (the workers: aircraft to catch up on first, then the finished days to rebuild)
async function backfillLoop() {
  for (;;) {
    if (liveBusy() && !(backWaits.since && Date.now() - backWaits.since > 600000)) { if (!backWaits.since) backWaits.since = Date.now(); backWaits.n++; await sleep(5000); continue; }
    backWaits.since = 0;
    const job = backQ.shift();
    if (job) { await backfillOne(job).catch(e => log('backfill', job.hex, String(e))); continue; }
    const hj = nextHist();
    if (hj) { await histOne(hj).catch(e => { histPend.delete(hj.hex + '|' + hj.day); try { histUnknown(hj.hex, hj.day); } catch (e2) { /* disk */ } log('history', hj.hex, hj.day, String(e)); }); await sleep(1000); }
    else await sleep(5000);
  }
}

// ---- storage: a file per day of flights ---------------------------------------------------------------------------
const KEEP_LADD = 90 * 86400, KEEP_OTHER = 4 * 86400;
// (a day all of whose flights are held in memory is written from memory; an older one - partly let go from memory - has
// its file's blocked flights kept and those in memory put over them: the store on disk only ever grows)
function save() {
  fs.mkdirSync(STORE, { recursive: true });
  const memFrom = Date.now() / 1000 - KEEP_LADD;
  for (const d of dirtyDays) {
    const out = [];
    for (const m of legs.values()) for (const l of m.values()) if (dayOf(l.tOff || l.tStart) === d) out.push(l);
    const f = path.join(STORE, 'legs-' + d + '.json'), tmp = f + '.tmp';
    if (dayStart(d) < memFrom + 86400) {
      const have = new Set(out.map(l => l.hex + '|' + legKey(l)));
      let old = []; try { old = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { old = []; }
      for (const l of old) if (l && l.ladd && !have.has(l.hex + '|' + legKey(l))) out.push(l);
    }
    fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, f);
    diskDays.delete(d);
  }
  dirtyDays.clear();
}
function loadStore(nowS) {
  if (!fs.existsSync(STORE)) return;
  for (const f of fs.readdirSync(STORE)) {
    const m = f.match(/^legs-(\d{4}-\d\d-\d\d)\.json$/); if (!m) continue;
    const age = nowS - Date.parse(m[1]) / 1000;
    if (age > KEEP_LADD + 86400) continue;            // (older days stay on disk for good - read when asked for: boardLegs)
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
    tel.add(list, nowS);
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
async function fiWait() { const w = fiLast + 1100 - Date.now(); fiLast = Math.max(Date.now(), fiLast + 1100); if (w > 0) await sleep(w); }
async function fiPoll(url, kind) { await fiWait(); return pollOnce(url, kind); }
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
const P = { tL: 0, tM: 0, tP: 0, tA: 0, tH: 0, tC: 0, tO: 0, coldQ: [], areaQ: [], hexQ: [], hexRoundOk: true };
// (one request - or none due: false)
async function step() {
  const n = Date.now(), lolPaused = n < (pause['api.adsb.lol'] || 0);
  if (n - P.tA >= CFG.areaEvery * 1000) { P.tA = n; P.areaQ = CFG.areas.concat(userAreas).slice(); }
  // (by address, the blocked aircraft not on the LADD list: those heard in the last 45 minutes - flying, about to - every
  // 30 s; the parked rest every 10 minutes. The day watch counts the slow round: a day is no longer "watched throughout"
  // for them, and the userscript reads their days itself - the price of their being followed as fast as the LADD list)
  const byAddr = hot => [...blocked].filter(([h, b]) => !b.faa && !laddNow.has(h) && (n / 1000 - (b.heard || 0) < CFG.hotWindow) === hot).sort((a, b) => b[1].heard - a[1].heard).map(([h]) => h);
  if (n - P.tH >= CFG.hexEvery * 1000 && !P.hexQ.length) { P.tH = n; P.hexQ = byAddr(true); }
  if (n - P.tC >= CFG.coldEvery * 1000 && !P.coldQ.length) { P.tC = n; P.coldQ = byAddr(false); P.hexRoundOk = true; if (!P.coldQ.length) noteWatch('hex', n / 1000); }
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
  else if (P.hexQ.length) await pollOnce('https://api.adsb.lol/v2/hex/' + P.hexQ.splice(0, CFG.hexBatch).join(','), 'hex');
  else if (P.areaQ.length) {
    // (every other area from adsb.fi first: each network asked half as often - the other the fallback)
    const [la, lo, r] = P.areaQ.shift(), lol = () => !lolPaused && pollOnce(`https://api.adsb.lol/v2/point/${la}/${lo}/${r}`, 'area'), fi = () => fiPoll(`https://opendata.adsb.fi/api/v3/lat/${la}/lon/${lo}/dist/${r}`, 'fiArea');
    const fiFirst = (P.areaN = (P.areaN || 0) + 1) % 2 === 0;
    if (!(await (fiFirst ? fi() : lol())) && !(await (fiFirst ? lol() : fi()))) await adsbxPoll(`/v2/lat/${la}/lon/${lo}/dist/${r}/`);
  }
  else if (P.coldQ.length) {
    if (!(await pollOnce('https://api.adsb.lol/v2/hex/' + P.coldQ.splice(0, CFG.hexBatch).join(','), 'hex'))) P.hexRoundOk = false;
    if (!P.coldQ.length && P.hexRoundOk) noteWatch('hex', Date.now() / 1000);
  }
  else return false;
  return true;
}
async function loop() { for (;;) if (!(await step())) await sleep(1000); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// ---- FR24: every flight it draws without callsign or registration, worldwide, named -------------------------------------
const fr24 = FR.createClient();
// (named from public ADS-B and hidden by FR24: a blocked aircraft - followed from now on, its days rebuilt. Not military or
// privacy addresses: those come with their lists, and a PIA address changes)
// Every name given, kept for good (names.cjs): FR24's playback names a flight as it was named live
const names = createNames({ store: STORE, log: (...a) => log('names', ...a) });
const flagsOfInfo = info => (info.ladd ? 1 : 0) | (info.mil ? 2 : 0) | (info.pia ? 4 : 0);
const ident = createIdent({ E, cfg: CFG.ident, live, ac, blocked, legs, ownerOf: hex => owners.short(hex),
  onIdentified: (hex, info, F) => { if (!info.mil && !info.pia) markBlocked(hex, { reg: info.reg, type: info.type }, Date.now() / 1000); owners.want(hex, info.reg, true); if (F) names.add(F.id, { hex, reg: info.reg, type: info.type, cs: info.cs, flags: flagsOfInfo(info) }, Date.now() / 1000); },
  // (a name withdrawn - the aircraft turned out elsewhere, or another took its place: not served to a playback; a flight
  // that simply ended keeps its name)
  onUnassign: (id, R, why) => { if (why !== 'expired') names.drop(id, Date.now() / 1000); } });
// The owners and operators of the blocked aircraft (owners.cjs): looked up once, kept for good; a name in the names table
// whose owner is newly known goes to the browsers again
const owners = createOwners({ createRegistry, cfg: CFG.owners, fetch: (u, o) => global.fetch(u, o), log: (...a) => log('owners', ...a), onChange: hex => ident.touch(hex) });
async function ownersLoop() { for (;;) { await sleep(owners.C.every); try { await owners.pumpOne(); } catch (e) { log('owners', String(e && e.stack || e)); } } }
const dest = createDest({ E, cfg: CFG.dest, ac, legs });
// (22.25) The flights not named yet - FR24's playback ones a browser asked about, the monitor's own live ones - tried
// again and again against the tracks until one aircraft fits (waiting.cjs); the days whose tracks grew (a day rebuilt,
// FR24's trail of a flight) bring theirs forward
const waitDays = new Set(), waitClaims = new Map();   // hex -> [{ id, t0, t1, at }] named from the waiting list
tracks.onChange = (hex, ds) => { const today = dayOf(Date.now() / 1000); for (const d of ds) if (d < today) waitDays.add(d); };
const typeAt = (hex, t) => { const l = legAt(hex, t), b = blocked.get(hex), x = ac.get(hex); return (l && l.type) || (b && b.type) || (x && x.meta && x.meta.type) || ''; };
const waiting = createWaiting({ tracks, cfg: CFG.waiting, typeOf: typeAt,
  // (carried on from a track's end over open ocean or empty desert only - the engine's rule for the live reckoning)
  est: { remote: (lat, lon, trk, kt, secs) => E.airports.length > 1000 && E.remotePath({ lat, lon, gs: kt, trk }, secs, trk, kt) },
  named: (id, t) => ident.ids.has(id) || !!names.peek(id, t),
  // (one aircraft, one flight: not one FR24 draws as another flight at the time, nor one already given to another here)
  taken: (hex, id, t0, t1) => {
    const o = ident.byHex.get(hex), F = o != null && o !== id ? ident.flights.get(o) : null;
    if (F && F.seen / 1000 >= t0 - 600 && (F.first || F.seen) / 1000 <= t1 + 600) return true;
    return (waitClaims.get(hex) || []).some(c => c.id !== id && c.t0 <= t1 + 600 && c.t1 >= t0 - 600);
  } });
// A flight from the waiting list named: still drawn by FR24 and unnamed, named live (every browser has it with the next
// /fr24ids); otherwise kept with the names for playback, with the day of its flight
function waitNamed(w, m, nowMs) {
  const hex = m.hex, l = legAt(hex, m.t), b = blocked.get(hex), x = ac.get(hex), meta = (x && x.meta) || {};
  const info = { reg: (l && l.reg) || (b && b.reg) || meta.reg || '', type: (l && l.type) || (b && b.type) || meta.type || '', cs: (l && l.cs) || '', ladd: !!b, mil: !!meta.mil, pia: !!meta.pia };
  const F = ident.flights.get(w.id);
  if (F && !ident.ids.has(w.id) && nowMs - F.seen < 10 * 60000) ident.assign(F, hex, info, 'path', nowMs);
  else names.add(w.id, { hex, reg: info.reg, type: info.type, cs: info.cs, flags: flagsOfInfo(info), how: m.how }, m.t);
  const c = waitClaims.get(hex) || []; c.push({ id: w.id, t0: w.pts[0][0], t1: w.pts[w.pts.length - 1][0], at: nowMs }); waitClaims.set(hex, c.filter(x2 => nowMs - x2.at < 4 * 86400e3).slice(-20));
  if (waitClaims.size > 50000) waitClaims.delete(waitClaims.keys().next().value);
  return true;
}
// (the monitor's own callsign-less flights it has had five minutes and more without a name: their positions so far)
function waitLive(nowMs) {
  let n = 0;
  for (const F of ident.flights.values()) {
    if (ident.ids.has(F.id) || F.src === 4 || nowMs - F.seen > 10 * 60000 || nowMs - (F.first || nowMs) < 5 * 60000 || !F.pts || F.pts.length < 2) continue;
    const w = waiting.W.get(F.id), lastT = w && w.pts.length ? w.pts[w.pts.length - 1][0] : 0;
    for (const p of F.pts) if (p.t > lastT + 20) { waiting.note(F.id, [p.t, p.lat, p.lon, p.gnd ? 0 : p.alt, p.gnd], { type: F.type, src: 'live' }, nowMs); n++; }
  }
  return n;
}
const WAIT = { rounds: 0, named: 0, lastMs: 0 };
function waitRound(nowMs, maxMs) {
  const t0 = Date.now();
  waitLive(nowMs);
  if (waitDays.size) { waiting.kick(waitDays, nowMs); waitDays.clear(); }
  const n = waiting.round(nowMs, maxMs, (w, m) => waitNamed(w, m, nowMs));
  WAIT.rounds++; WAIT.named += n; WAIT.lastMs = Date.now() - t0;
  return n;
}
async function waitLoop() { for (;;) { await sleep(15000); try { waitRound(Date.now(), +CFG.waitMs || 400); } catch (e) { log('waiting', String(e && e.stack || e)); } } }
function saveWaiting() { fs.mkdirSync(STORE, { recursive: true }); const f = path.join(STORE, 'waiting.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(waiting.dump())); fs.renameSync(f + '.tmp', f); }
function loadWaiting(nowMs) { try { return waiting.restore(JSON.parse(fs.readFileSync(path.join(STORE, 'waiting.json'), 'utf8')), nowMs); } catch (e) { return 0; } }
const F24 = { scans: 0, last: null, rounds: 0, busy: false, logged: 0 };
// One round: the flights still unnamed within public coverage looked up around them (adsb.fi, one area per 220 nm), then
// matched again; the names kept tidy; the rough destinations of the oldest
async function identRound() {
  if (F24.busy) return; F24.busy = true;
  try {
    const unmatched = ident.match(Date.now()), areas = ident.lookupAreas(unmatched, Date.now());
    for (const a of areas) {
      let j = null;
      try { await fiWait(); j = await getJson(`https://opendata.adsb.fi/api/v3/lat/${a.lat.toFixed(3)}/lon/${a.lon.toFixed(3)}/dist/${CFG.lookupRadius}`); }
      catch (e) { if (/paused|429/.test(String(e))) break; continue; }
      const nowS = nowMsOf(j) / 1000, list = acOf(j);
      ident.addLookup(list, nowS); tel.add(list, nowS);
      // (blocked and flagged aircraft among them: kept as traffic like the lists' - their flights, their live rows)
      for (const x of list) if ((x.dbFlags & 13) || blocked.has(String(x.hex || '').toLowerCase().replace(/^~/, ''))) ingest(x, nowS);
    }
    if (areas.length) ident.match(Date.now());
    fr24Legs(Date.now());
    ident.prune(Date.now());
    dest.round(ident, Date.now());
    F24.rounds++;
  } finally { F24.busy = false; }
}
// ---- blocked flights only FR24 sees ----------------------------------------------------------------------------------
// A blocked flight FR24 draws that no public ADS-B receiver hears (FR24's own receivers, satellites, multilateration) is
// logged too, departure and arrival, for the airports' boards and the learning rows: once FR24 has stopped drawing it for
// 15 minutes (landed - FR24 drops a flight a few minutes after), or has had it on the ground 15 minutes, its track as FR24
// had it - the whole trail asked for as it came down, the positions of every scan - read by the same engine as an ADS-B
// trace. Kept only when it reads as a
// landing at an airport, and only where ADS-B has nothing of that flight (its own record is the better one: it replaces
// this one when it comes; a finished ADS-B record missing an end gets it from here).
function fr24Legs(nowMs) {
  const nowS = nowMs / 1000; let n = 0;
  for (const [id, R] of ident.ids) {
    const F = ident.flights.get(id); if (!F || !F.pts) continue;
    let la = 0; for (let i = F.pts.length - 1; i >= 0; i--) if (!F.pts[i].gnd) { la = F.pts[i].t; break; }
    if (!la || F.loggedAir === la) continue;
    if (!(nowMs - F.seen >= 15 * 60000 || (F.gnd && nowS - la >= 900 && F.logTrail !== 1))) continue;
    F.loggedAir = la;
    const leg = fr24Leg(R, F, nowS); if (!leg) continue;
    let m = legs.get(R.hex); if (!m) legs.set(R.hex, m = new Map());
    const over = o => o.tStart < leg.tEnd + 600 && (o.tEnd || o.tStart) > leg.tStart - 600;
    const adsb = [...m.values()].find(o => o.via !== 'fr24' && over(o));
    if (adsb) {
      if (adsb.open) continue;
      let fill = false;
      if (!adsb.from && leg.from) { adsb.from = leg.from; adsb.tOff = adsb.tOff || leg.tOff; fill = true; }
      if (!adsb.to && leg.to) { adsb.to = leg.to; adsb.tOn = adsb.tOn || leg.tOn; fill = true; }
      if (fill) { adsb.fr24Fill = true; dirtyDays.add(dayOf(adsb.tOff || adsb.tStart)); n++; }
      continue;
    }
    for (const [k, o] of m) if (o.via === 'fr24' && over(o)) { m.delete(k); dirtyDays.add(dayOf(o.tOff || o.tStart)); }
    m.set(legKey(leg), leg); dirtyDays.add(dayOf(leg.tOff || leg.tStart)); n++;
    // (and, from airport to airport both seen, a learning row of that day - the browsers' destination engine learns it)
    const lr = learnRow(R.hex, leg, null, leg.cls, { mil: !!(R.flags & 2), type: leg.type });
    if (lr) { try { learnWrite(dayOf(leg.tStart), [lr]); } catch (e) { log('learn', String(e)); } }
    delete leg.cls;
  }
  F24.logged += n;
  return n;
}
// (one flight's track from FR24 - its trail, then the scans' positions - as a trace; its flight read from it)
function fr24Leg(R, F, nowS) {
  const fin = v => typeof v === 'number' && isFinite(v), rows = [];
  const add = (t, lat, lon, alt, gs, trk, gnd) => { if (fin(t) && fin(lat) && fin(lon)) rows.push([t, lat, lon, gnd ? 'ground' : fin(alt) && alt > 0 ? alt : null, fin(gs) ? gs : null, fin(trk) ? trk : null, 0, null, null, null, null]); };
  const tr = F.trail || [], t0 = tr.length ? tr[0].t : Infinity, t1 = tr.length ? tr[tr.length - 1].t : -Infinity;
  for (const p of tr) add(p.t, p.lat, p.lon, p.alt, p.gs, p.trk, !(p.alt > 0) && !(p.gs > 50));
  for (const p of F.pts || []) if (p.t < t0 - 5 || p.t > t1 + 5) add(p.t, p.lat, p.lon, p.alt, p.gs, p.trk, !!p.gnd);
  rows.sort((a, b) => a[0] - b[0]);
  if (rows.length < 3) return null;
  const x = ac.get(R.hex), meta = (x && x.meta) || {};
  const info = { hex: R.hex, type: R.type || meta.type || F.type || '', reg: R.reg || meta.reg || '', cs: R.cs || meta.cs || '', mil: !!(R.flags & 2) || !!meta.mil, cat: meta.cat || '' }, cls = E.classify(info);
  let ls; try { ls = E.legsFromPoints(E.parseTrace({ timestamp: 0, trace: rows }), { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', cls, type: info.type, rangeKm: E.typeRangeKm(info) }); } catch (e) { return null; }
  // (its last flight - the one FR24 drew - airborne, and down at an airport)
  const l = [...ls].reverse().find(q => q.pts.some(p => !p.gnd)); if (!l) return null;
  let s; try { s = E.summarizeLeg(l, { cls, type: info.type, grp: E.groupOf(cls), mil: info.mil }); } catch (e) { return null; }
  if (!s.to || !/^(ground|low)$/.test(s.to.conf || '') || s.tEnd - s.tStart < 300) return null;
  // (down where it took off without a real flight - a taxi with the transponder saying "airborne": none)
  if (E.localFlew && !E.localFlew(s, cls)) return null;
  // (first seen already up and not climbing: where it came from is the one worked out for its rough destination, if sure)
  const f = l.pts[0], g = l.pts.find(p => p.t - f.t >= 60), climbing = !!(g && f.alt != null && g.alt != null && g.alt - f.alt > 200);
  if (!s.startedOnGround && !climbing) s.from = null;
  if (!s.from && R.origin && /^(ground|low)$/.test(R.origin.conf || '')) { const a = E.byId(R.origin.id); if (a && a.id !== s.to.id) s.from = { id: a.id, code: a.code, conf: R.origin.conf }; if (a && !s.tOff && R.origin.t) s.tOff = R.origin.t; }
  const leg = { hex: R.hex, reg: info.reg, type: info.type, cs: s.cs || info.cs, ladd: true, from: s.from, to: s.to, tStart: s.tStart, tEnd: s.tEnd, tOff: s.tOff, tOn: s.tOn, ended: true, open: false, startedOnGround: s.startedOnGround, startLat: s.startLat, startLon: s.startLon, endLat: s.endLat, endLon: s.endLon, maxAlt: s.maxAlt || 0, pathKm: s.pathKm || 0, via: 'fr24', cls };
  legRunways(leg, l);
  tracks.put(R.hex, rows);   // (its track: FR24's positions, until an ADS-B record of the day fills it in)
  return leg;
}
async function fr24Round() {
  if (CFG.fr24Scan && Date.now() >= fr24.st.pauseUntil) {
    const res = await FR.scanWorld(fr24, { gapMs: CFG.fr24Gap });
    F24.scans++; F24.last = { at: Date.now(), requests: res.requests, failed: res.failed, err: res.err, flights: res.flights.length };
    ident.observe(res.flights, Date.now(), 'scan');
  }
  await identRound();
}
async function fr24Loop() { for (;;) { const t0 = Date.now(); try { await fr24Round(); } catch (e) { log('fr24', String(e && e.stack || e)); } await sleep(Math.max(5000, CFG.fr24Every * 1000 - (Date.now() - t0))); } }
// (between scans: the browsers' reports matched as they come, every 30 s)
async function identLoop() { for (;;) { await sleep(30000); try { await identRound(); } catch (e) { log('ident', String(e && e.stack || e)); } } }
// (FR24's trail of an unnamed flight out of coverage: one every 20 s at most)
async function trailLoop() {
  for (;;) {
    await sleep((CFG.ident.trailEvery || 20) * 1000);
    const F = ident.nextTrail(); if (!F) continue;
    try { ident.setTrail(F.id, await fr24.followTrail(F.id), Date.now()); ident.match(Date.now()); }
    catch (e) { if (/paused/.test(String(e))) ident.trailQ.unshift(F.id); else ident.setTrail(F.id, [], Date.now()); }
  }
}
// A browser's report: FR24's feed headers as its page sends them (never an authorization), the callsign-less flights it
// sees (rows [id, lat, lon, alt, track, speed, ts, ground, source, type, reg, icon]), the ones it named itself ([id, hex, how])
// (ctx: who sent it - the owner (with the secret, or no secret set), or anyone's browser on a public monitor, by address.
// From anyone: FR24's headers only while this side's own scan is not working, never a flight's position over the scan's,
// a name only when it can be checked or two browsers agree, owners only when two agree)
function report(d, nowMs, ctx) {
  const crowd = !!(ctx && !ctx.admin && PUBLIC), who = crowd ? String(ctx.ip || '?') : '';
  let hdr = false, n = 0, named = 0;
  if (d && d.hdr && typeof d.hdr === 'object' && !Array.isArray(d.hdr)) {
    const working = !!fr24.st.lastOkAt && nowMs - fr24.st.lastOkAt < 300000;
    const sane = Object.fromEntries(Object.entries(d.hdr).filter(([k, v]) => typeof v === 'string' && v.length <= 200 && /^[\x20-\x7e]*$/.test(v) && /^[\w-]{1,40}$/.test(k)));
    if (!crowd || !working || !fr24.st.hdr) { hdr = fr24.setHeaders(sane, typeof d.ua === 'string' && d.ua.length <= 300 ? d.ua : ''); if (hdr) { stateDirty = true; if (fr24.st.lastErr && /HTTP 40[13]/.test(fr24.st.lastErr)) fr24.st.pauseUntil = 0; } }
  }
  if (d && Array.isArray(d.flights)) {
    let rows = d.flights.slice(0, 20000).filter(Array.isArray).map(r => ({ id: +r[0], lat: +r[1], lon: +r[2], alt: +r[3], trk: +r[4], spd: +r[5], ts: +r[6], gnd: !!r[7], src: +r[8] || 0, type: String(r[9] || '').slice(0, 8), reg: String(r[10] || '').slice(0, 12), icon: +r[11] || 0, cs: '' }));
    if (crowd) rows = rows.filter(f => { const F = ident.flights.get(f.id); return !(F && F.via === 'scan' && nowMs - F.seen < 300000) && Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180; });
    n = ident.observe(rows, nowMs, 'client');
  }
  if (d && Array.isArray(d.ids)) for (const r of d.ids.slice(0, 5000)) if (Array.isArray(r) && ident.clientId(+r[0], r[1], r[2], nowMs, who, CFG.crowdNeed)) named++;
  const own = d && Array.isArray(d.owners) ? owners.fromClient(d.owners, who, CFG.crowdNeed) : 0;
  // (what the browser's own polls of the networks found: every other browser's at once - tel.cjs checks it)
  const tl = d && Array.isArray(d.tel) ? tel.addCrowd(d.tel, nowMs / 1000) : 0;
  const pbn = d && Array.isArray(d.pbIds) ? pbNames(d.pbIds, who, nowMs) : 0;
  // (22.25) the routes it worked out for flights named here - [id, hex, origin id, its word, destination id, its chance,
  // its word, ETA, departed] - every other browser has them with the names; and the flights it learned from
  let rt = 0;
  if (d && Array.isArray(d.routes)) {
    const ok = crowd ? allowance('route', who, +CFG.routesPerHour || 600) : null;
    for (const r of d.routes.slice(0, 500)) if (Array.isArray(r) && (!ok || ok()) && ident.crowdRoute(+r[0], r[1], { o: +r[2], oc: r[3], d: +r[4], p: +r[5], dc: r[6], eta: +r[7], atd: +r[8] }, who, nowMs)) rt++;
  }
  const lr = d && Array.isArray(d.learn) ? learnFromCrowd(d.learn, who, nowMs) : null;
  // (the pictures of blocked aircraft it found: every other browser's panel has them at once - photos.cjs)
  const ph = d && Array.isArray(d.photos) ? photos.put(d.photos, nowMs, crowd ? allowance('photo', who, +CFG.photosPerHour || 300) : null) : 0;
  return { ok: true, hdr, flights: n, named, owners: own, tel: tl, pbNamed: pbn, routes: rt, learned: lr ? lr.n : 0, learnNot: lr && lr.not.length ? lr.not : undefined, learnSeq: lr ? lr.seq : undefined, photos: ph };
}
// Names a browser found in FR24's playback (its unnamed flights matched against adsb.lol's heatmap of that half hour),
// kept for good with the day of the flight - any later playback of it named at once, for everyone. Taken from one browser
// when this side's own log has that aircraft in the air then; otherwise when a second browser finds the same (and no
// other aircraft for that flight has as many). The owner's own browser: taken as it comes.
const pbClaims = new Map();   // FR24 flight id -> { at, by: Map(hex -> Set(reporter)) }
function pbNames(list, who, nowMs) {
  let n = 0;
  for (const r of list.slice(0, 2000)) {
    if (!Array.isArray(r)) continue;
    const id = +r[0], hex = String(r[1] || '').toLowerCase(), ts = +r[6];
    if (!(id > 0 && id < 2 ** 40) || !/^[0-9a-f]{6}$/.test(hex) || !(ts > 1e9 && ts < nowMs / 1000 + 600)) continue;
    const rec = { hex, reg: String(r[2] || '').toUpperCase().slice(0, 12), type: String(r[3] || '').toUpperCase().slice(0, 6), cs: String(r[4] || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8), flags: (+r[5] || 0) & 7 };
    // (a flight already named otherwise - by this side, live, or by browsers before: left as it is; the owner's word goes)
    { const cur = names.peek(id, ts); if (cur && cur[1] !== hex && who) continue; }
    let ok = !who;
    if (!ok) { const m = legs.get(hex); ok = !!m && [...m.values()].some(l => (l.tOff || l.tStart) - 900 <= ts && ts <= (l.tOn || l.tEnd || l.tStart) + 900); }
    if (!ok) {
      let k = pbClaims.get(id); if (!k) { k = { at: nowMs, by: new Map() }; pbClaims.set(id, k); if (pbClaims.size > 20000) pbClaims.delete(pbClaims.keys().next().value); }
      k.at = nowMs; let set = k.by.get(hex); if (!set) k.by.set(hex, set = new Set()); set.add(who);
      const best = Math.max(0, ...[...k.by.entries()].filter(([h]) => h !== hex).map(([, x]) => x.size));
      ok = set.size >= CFG.crowdNeed && best < set.size;
      if (ok) pbClaims.delete(id);
    }
    if (ok && names.add(id, rec, ts)) n++;
  }
  for (const [id, k] of pbClaims) if (nowMs - k.at > 6 * 3600e3) pbClaims.delete(id);
  return n;
}
// /near: every aircraft heard within r km of a point in the last two minutes - every report of every list, area poll
// and lookup (tel.cjs: with the figures FR24 padlocks), and the blocked aircraft's positions kept - for a browser
// naming a flight there and for the view it shows (polled from here every other time: the browsers' own requests to
// adsb.lol and adsb.fi halved). Nothing heard there lately: one adsb.fi lookup of the area first (each 1-degree cell
// once a minute, CFG.nearPerMin for all browsers together)
const nearCells = new Map(); let nearBudget = { min: 0, n: 0 }, nearMemo = { at: 0, m: null };
async function nearLookup(lat, lon, rKm) {
  const t = Date.now(), cell = Math.round(lat) + ':' + Math.round(lon), m = Math.floor(t / 60000);
  if (nearBudget.min !== m) nearBudget = { min: m, n: 0 };
  if (!(t - (nearCells.get(cell) || 0) > 60000 && nearBudget.n < CFG.nearPerMin)) return false;
  nearCells.set(cell, t); nearBudget.n++; if (nearCells.size > 5000) nearCells.clear();
  try {
    await fiWait();
    const j = await getJson(`https://opendata.adsb.fi/api/v3/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${Math.round(Math.min(250, rKm / 1.852))}`);
    const ns = nowMsOf(j) / 1000, list = acOf(j); ident.addLookup(list, ns); tel.add(list, ns); nearMemo.at = 0;
    for (const x of list) if ((x.dbFlags & 13) || blocked.has(String(x.hex || '').toLowerCase().replace(/^~/, ''))) ingest(x, ns);
    return true;
  } catch (e) { return false; }   // (refused or paused: what is here already)
}
async function nearAnswer(lat, lon, rKm) {
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return { ac: [] };
  rKm = Math.min(470, Math.max(10, isFinite(rKm) && rKm > 0 ? rKm : 120));
  const t0 = Date.now(), have = tel.near(lat, lon, rKm, t0 / 1000, 2000);
  // (a place this side has heard little of lately - not one of its areas: looked up first)
  const looked = have.length < 5 || !have.some(r => r.seen_pos < 30) ? await nearLookup(lat, lon, rKm) : false;
  const t = Date.now(), nowS = t / 1000, out = looked ? tel.near(lat, lon, rKm, nowS, 2000) : have, seen = new Set(out.map(r => String(r.hex).replace(/^~/, '')));
  if (t - nearMemo.at > 5000) nearMemo = { at: t, m: ident.candidates(nowS) };
  for (const c of nearMemo.m.values()) {
    if (seen.has(c.hex) || nowS - c.t > 120 || E.dist(lat, lon, c.lat, c.lon) > rKm) continue;
    out.push({ hex: c.nonIcao ? '~' + c.hex : c.hex, r: c.reg || undefined, t: c.type || undefined, flight: c.cs || undefined, lat: c.lat, lon: c.lon, alt_baro: c.gnd ? 'ground' : c.alt, gs: c.gs, track: c.trk, seen_pos: Math.max(0, Math.round(nowS - c.t)), dbFlags: (c.ladd ? 8 : 0) | (c.pia ? 4 : 0) | (c.mil ? 1 : 0) });
    if (out.length >= 2000) break;
  }
  return { v: 1, now: t, looked, ac: out.map(r => wx.fill(r, nowS)) };
}
// /tel: the newest report of these addresses (a panel just opened); one this side has nothing fresh of, with where FR24
// draws it: looked up there first (the same budget)
async function telAnswer(hexes, lat, lon) {
  let nowS = Date.now() / 1000;
  if (hexes.some(h => !tel.has(h, nowS)) && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) { await nearLookup(lat, lon, 120); nowS = Date.now() / 1000; }
  return { v: 1, now: Math.round(nowS * 1000), ac: tel.get(hexes, nowS).map(r => wx.fill(r, nowS)) };
}
function saveIdent() { fs.mkdirSync(STORE, { recursive: true }); const f = path.join(STORE, 'ident.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(ident.dump())); fs.renameSync(f + '.tmp', f); }
function loadIdent(nowMs) { try { return ident.restore(JSON.parse(fs.readFileSync(path.join(STORE, 'ident.json'), 'utf8')), nowMs); } catch (e) { return 0; } }
// (an aircraft gone quiet - landed, transponder off at the stand - sends nothing that would make it looked at again: its
// open flight looked at once more 20 minutes on, and closed as landed. OK-FLN, down at Luton at 15:26, was still open)
function wakeQuiet(nowS) { for (const x of ac.values()) if (!x.dirty && x.rows.length >= 2 && nowS - x.last > 1200 && x.quietDone !== x.last) { x.dirty = true; x.quietDone = x.last; } }
let tracksSaved = 0, tracksPruned = '';
function work(final) {
  const nowS = Date.now() / 1000;
  wakeQuiet(nowS);
  for (const hex of ac.keys()) buildLegs(hex, nowS);
  prune(nowS); save(); closeDays(nowS);
  lastRun = Math.round(nowS); saveState(); saveIdent(); saveWaiting(); crowdLearnSave(); owners.save(STORE); photos.save(STORE); names.prune(nowS); tel.prune(nowS);
  // (each address's hourly counts: gone with their hour)
  for (const [k, a] of adds) if (a.t !== Math.floor(nowS / 3600)) adds.delete(k);
  // (the tracks: written every ten minutes - a day's file is a few MB - and on stop; the old days removed once a day)
  if (final || nowS - tracksSaved >= 600) { tracksSaved = nowS; tracks.save(); }
  if (tracksPruned !== dayOf(nowS)) { tracksPruned = dayOf(nowS); tracks.prune(nowS); }
  // (the installs counted: written at most once a minute when changed - its own timer too - and on stop)
  try { installs.save(final); } catch (e) { log('installs', String(e && e.message || e)); }
  if (!final) learnedDue(nowS);
}
// (a place the userscript is looking at, to the nearest degree: the most recent few polled with the default areas)
function addArea(lat, lon, nowS, allow) {
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85) return false;
  const la = Math.round(lat), lo = Math.round(lon);
  if (CFG.areas.concat(userAreas).some(a => E.dist(a[0], a[1], la, lo) < 150)) { const u = userAreas.find(a => E.dist(a[0], a[1], la, lo) < 150); if (u) u[3] = Math.round(nowS); return false; }
  if (allow && !allow()) return false;
  userAreas.push([la, lo, 250, Math.round(nowS)]); userAreas.sort((a, b) => b[3] - a[3]); userAreas.splice(CFG.userAreas);
  stateDirty = true; return true;
}

// What one address that is not the owner's may add to the monitor's own work on a public monitor, an hour at a time:
// places to poll (/area - one browser looks at a few) and aircraft to follow (/seed - those it has not followed yet);
// beyond it the request is answered, nothing added. (CFG.areaPerHour, CFG.seedPerHour)
const adds = new Map();   // 'kind ip' -> { t: hour, n }
function allowance(kind, ip, cap) {
  return () => {
    const t = Math.floor(Date.now() / 3600e3), k = kind + ' ' + ip, a = adds.get(k);
    if (!a || a.t !== t) { if (adds.size > 20000) adds.clear(); adds.set(k, { t, n: 1 }); return cap >= 1; }
    return ++a.n <= cap;
  };
}

// ---- (22.23) a moment of FR24's playback, named at once: POST /pbmatch {t, f: [[FR24 id, lat, lon, alt ft, type, on the
// ground], ...]} - the flights FR24 shows there without a name. Each is named as the monitor named it live (names.cjs),
// else from the blocked aircraft's tracks: the one kept aircraft where FR24 draws the flight at that moment, at its height,
// of its type, with no other near it, and no other flight of the moment claiming it. With the flight as the monitor logged
// it (take-off and landing), so the browser needs neither adsb.lol's heatmap nor the aircraft's day trace.
const PB = { asked: 0, flights: 0, live: 0, track: 0, reckon: 0, later: 0, waiting: 0 };
const typeFits = (a, b) => { a = String(a || '').toUpperCase(); b = String(b || '').toUpperCase(); return !a || !b || a === b || a.slice(0, 3) === b.slice(0, 3); };
function legAt(hex, t) {
  const m = legs.get(hex); if (!m) return null;
  const ls = [...m.values()].sort((a, b) => a.tStart - b.tStart);
  return ls.find(l => t >= l.tStart - 300 && t <= (l.tEnd || l.tStart) + 300) || ls.find(l => l.tStart > t && l.tStart - t < 3 * 3600) || null;
}
const legOut = l => l ? { from: l.from ? { id: l.from.id, code: l.from.code || '', conf: l.from.conf || '' } : null, to: l.to ? { id: l.to.id, code: l.to.code || '', conf: l.to.conf || '' } : null, tStart: l.tStart, tEnd: l.tEnd, tOff: l.tOff || 0, tOn: l.tOn || 0, ended: !!l.ended, open: !!l.open, startedOnGround: !!l.startedOnGround, startLat: l.startLat, startLon: l.startLon, endLat: l.endLat, endLon: l.endLon } : null;
function pbMatch(t, list) {
  PB.asked++;
  const fl = (Array.isArray(list) ? list : []).filter(f => Array.isArray(f) && Number(f[0]) > 0 && isFinite(f[1]) && isFinite(f[2]) && Math.abs(f[1]) <= 90 && Math.abs(f[2]) <= 180).slice(0, 2000);
  PB.flights += fl.length;
  if (!(t > 1e9) || !fl.length) return [];
  const out = [], done = new Set();
  const row = (id, hex, how) => {
    const b = blocked.get(hex), l = legAt(hex, t), x = ac.get(hex), meta = (x && x.meta) || {};
    const reg = (l && l.reg) || (b && b.reg) || meta.reg || '', type = (l && l.type) || (b && b.type) || meta.type || '', cs = (l && l.cs) || '';
    return [id, hex, reg, type, cs, b ? 1 : meta.mil ? 2 : meta.pia ? 4 : 0, how, legOut(l)];
  };
  // (named live: as it was then - or worked out since, from its path against the tracks)
  for (const r of names.get(fl.map(f => f[0]), t)) { const l = legAt(r[1], t); out.push([r[0], r[1], r[2], r[3], r[4], r[5], r[7] || 'live', legOut(l)]); done.add(Number(r[0])); if (r[7]) PB.later++; else PB.live++; }
  const rest = fl.filter(f => !done.has(Number(f[0])));
  if (!rest.length) return out;
  // (where every kept aircraft was at that moment, by whole degree)
  const grid = new Map();
  for (const p of tracks.at(t)) { const k = Math.floor(p[1]) + ',' + Math.floor(p[2]); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
  const near = (lat, lon) => { const out2 = []; for (let a = -1; a <= 1; a++) for (let o = -1; o <= 1; o++) { const g = grid.get((Math.floor(lat) + a) + ',' + (((Math.floor(lon) + o + 180) % 360 + 360) % 360 - 180)); if (g) out2.push(...g); } return out2; };
  const pick = new Map();   // FR24 id -> hex
  for (const f of rest) {
    const [id, lat, lon, alt, type, gnd] = f;
    const R = gnd ? 3 : 15;
    const c = near(lat, lon).map(p => ({ p, d: E.dist(lat, lon, p[1], p[2]) })).filter(({ p, d }) => {
      if (d > R * 2.5) return false;
      if (!!gnd !== !!p[4] && !(gnd && p[3] != null && p[3] < 1500) && !(p[4] && alt < 1500)) return false;
      if (!gnd && !p[4] && isFinite(alt) && alt > 0 && p[3] != null && Math.abs(alt - p[3]) > 3000) return false;
      const b = blocked.get(p[0]), x = ac.get(p[0]), l = legAt(p[0], t), ty = (l && l.type) || (b && b.type) || (x && x.meta.type) || '';
      return typeFits(type, ty);
    }).sort((a, b) => a.d - b.d);
    if (!c.length || c[0].d > R) continue;
    // (another kept aircraft about as near: not told apart here - left to the browser's own ways)
    if (c[1] && c[1].d < Math.max(2 * c[0].d, c[0].d + 5)) continue;
    pick.set(Number(id), c[0].p[0]);
  }
  // (one aircraft, one flight)
  const n = new Map(); for (const h of pick.values()) n.set(h, (n.get(h) || 0) + 1);
  for (const [id, hex] of pick) if (n.get(hex) === 1 && !out.some(r => r[1] === hex)) { out.push(row(id, hex, 'track')); done.add(Number(id)); PB.track++; }
  // (22.25) The rest: kept waiting - each moment asked about adds where FR24 drew it then - and tried now, its path so
  // far against the tracks carried across their holes (dead reckoning); then again and again in the background
  // (waitLoop) until one aircraft fits. A name found then is in the names: the browser's next ask has it.
  // (all of the moment's noted first: two of them where one aircraft could be - neither, waiting.cjs rival)
  const nowMs = Date.now(), t0 = Date.now(), cache = new Map(), ws = [];
  for (const f of rest) {
    if (done.has(Number(f[0]))) continue;
    const w = waiting.note(f[0], [t, f[1], f[2], f[3], f[5]], { type: f[4], src: 'pb' }, nowMs); if (w) { ws.push(w); PB.waiting++; }
  }
  // (every browser's asks together: a fifth of the monitor's time at most - what is not tried now is in the background's next round)
  if (nowMs - pbSpend.at > 5000) { pbSpend.at = nowMs; pbSpend.ms = 0; }
  const budget = Math.min(+CFG.pbReckonMs || 400, 1000 - pbSpend.ms);
  for (const w of ws) {
    if (Date.now() - t0 > budget) break;
    const m = waiting.tryOne(w, nowMs, cache);
    if (m && !out.some(r => r[1] === m.hex) && waitNamed(w, m, nowMs)) { waiting.forget(w.id); out.push(row(w.id, m.hex, m.how)); PB[m.how === 'track' ? 'track' : 'reckon']++; }
    else { w.tries++; w.next = nowMs + 60000; }
  }
  pbSpend.ms += Date.now() - t0;
  return out;
}
const pbSpend = { at: 0, ms: 0 };

// ---- (22.23) what the engine learns from the last 90 days of every blocked aircraft's flights (the /learn rows), learned
// here into one list of increments to its tables, a few times a day - and handed to the browsers whole (GET /learned):
// each adds it to the tables it was shipped with as the page opens, instead of replaying two weeks of flights itself
const LEARNED_FILE = path.join(STORE, 'learned.json');
let learnedOut = null, learnedBusy = false;   // { ver, asOf, from, days, flights, ops: n, json }
function learnedLoad() {
  try { const j = fs.readFileSync(LEARNED_FILE, 'utf8'), o = JSON.parse(j); if (o && o.ver && Array.isArray(o.ops)) learnedOut = { ver: o.ver, asOf: o.asOf, from: o.from, days: o.days, flights: o.flights, crowd: o.crowd || 0, ops: o.ops.length, builtAt: o.builtAt || 0, builtSeq: o.builtSeq || 0, json: j }; }
  catch (e) { /* none yet */ }
}
async function learnedBuild(nowS) {
  if (learnedBusy) return null; learnedBusy = true;
  try {
    const today = dayOf(nowS), floor = dayOf(nowS - CFG.learnDays * 86400);
    // (the browsers' flights taken so far written first: every one numbered up to now is in this build)
    crowdLearnSave(); const upTo = learnSeq;
    const dayList = dir => fs.existsSync(dir) ? fs.readdirSync(dir).map(f => (/^(\d{4}-\d\d-\d\d)\.json$/.exec(f) || [])[1]).filter(d => d && d >= floor && d < today) : [];
    const days = [...new Set(dayList(LEARN_DIR).concat(dayList(LEARN_CROWD_DIR)))].sort();
    if (!days.length) return null;
    const col = E.learnCollector(), t0 = Date.now(); let crowd = 0;
    // (a day at a time, in slices: the monitor answers the browsers meanwhile; the browsers' flights of the day with it)
    for (const d of days) {
      let rows = []; try { rows = JSON.parse(fs.readFileSync(path.join(LEARN_DIR, d + '.json'), 'utf8')); } catch (e) { rows = []; }
      const more = crowdRows(d, rows, upTo); crowd += more.length; rows = rows.concat(more);
      for (let i = 0; i < rows.length; i += 2000) { col.add(rows.slice(i, i + 2000)); await new Promise(r => setImmediate(r)); }
    }
    const ops = col.ops(), o = { v: 1, ver: days[days.length - 1] + '.' + Math.round(nowS), asOf: days[days.length - 1], from: days[0], days: days.length, flights: col.flights, crowd, builtAt: Math.round(nowS), builtSeq: upTo, ops };
    const json = JSON.stringify(o);
    fs.mkdirSync(STORE, { recursive: true }); fs.writeFileSync(LEARNED_FILE + '.tmp', json); fs.renameSync(LEARNED_FILE + '.tmp', LEARNED_FILE);
    learnedOut = { ver: o.ver, asOf: o.asOf, from: o.from, days: o.days, flights: o.flights, crowd, ops: ops.length, builtAt: o.builtAt, builtSeq: upTo, json };
    log('learned', o.flights, 'flights of', o.days, 'days into', ops.length, 'increments,', Math.round(json.length / 1e5) / 10, 'MB in', Date.now() - t0, 'ms');
    return learnedOut;
  } finally { learnedBusy = false; }
}
// (built again every six hours - and after midnight's rebuilds have gone through: no day left to rebuild)
function learnedDue(nowS) {
  if (learnedBusy) return;
  const stale = !learnedOut || nowS - (learnedOut.builtAt || 0) >= 6 * 3600 || (learnedOut.asOf < dayOf(nowS - 86400) && !histQ.length && nowS - (learnedOut.builtAt || 0) >= 1800);
  if (stale) learnedBuild(nowS).catch(e => log('learned', String(e && e.stack || e)));
}

// ---- answers -------------------------------------------------------------------------------------------------------
// (an aircraft's flights as its log shows them: a part-copy dropped, a missing end taken from the next take-off - the
// same post-pass as the userscript's logs; on copies, the kept flights stay as seen)
const chained = m => E.chainLegs(E.stitchLegs([...m.values()].map(l => Object.assign({}, l))));
// (the days older than those held in memory: from their files on disk, the last few read kept)
const diskDays = new Map();
function diskLegs(day) {
  if (diskDays.has(day)) return diskDays.get(day);
  let list = []; try { list = JSON.parse(fs.readFileSync(path.join(STORE, 'legs-' + day + '.json'), 'utf8')); } catch (e) { list = []; }
  diskDays.set(day, list); if (diskDays.size > 20) diskDays.delete(diskDays.keys().next().value);
  return list;
}
// (back down where it took off without having flown - a taxi with the transponder saying "airborne", a take-off seen in
// two pieces: not a flight on any board)
const flewOk = l => !E.localFlew || E.localFlew(l, E.classify({ hex: l.hex || '', type: l.type || '', reg: l.reg || '', cs: l.cs || '' }));
function boardLegs(apId, lo, hi) {
  const out = [], memFrom = Date.now() / 1000 - KEEP_LADD;
  if (lo < memFrom) {
    const byHex = new Map();
    for (const d of daysBetween(Math.max(lo - 86400, Date.parse('2020-01-01') / 1000), Math.min(hi, memFrom))) for (const l of diskLegs(d)) if (l && l.hex && l.ladd) (byHex.get(l.hex) || byHex.set(l.hex, []).get(l.hex)).push(l);
    for (const [hex, list] of byHex) {
      const hit = E.chainLegs(E.stitchLegs(list.map(l => Object.assign({}, l)))).filter(l => ((l.from && l.from.id === apId) || (l.to && l.to.id === apId)) && (l.tEnd || l.tStart) >= lo && (l.tOff || l.tStart) <= Math.min(hi, memFrom) && flewOk(Object.assign({ hex }, l)));
      if (hit.length) out.push({ hex, reg: hit[0].reg, type: hit[0].type, ladd: true, legs: hit });
    }
    if (hi < memFrom) return out;
  }
  for (const [hex, m] of legs) {
    // (a missing end is only ever taken from a neighbouring flight's: an aircraft none of whose flights touch the airport has
    // none there after the post-pass either)
    if (![...m.values()].some(l => (l.from && l.from.id === apId) || (l.to && l.to.id === apId))) continue;
    const hit = chained(m).filter(l => ((l.from && l.from.id === apId) || (l.to && l.to.id === apId)) && (l.tEnd || l.tStart) >= lo && (l.tOff || l.tStart) <= hi && flewOk(Object.assign({ hex }, l)));
    if (hit.length) { const o = out.find(x => x.hex === hex); if (o) o.legs = o.legs.concat(hit.filter(l => !o.legs.some(k => Math.abs(k.tStart - l.tStart) < 60))); else out.push({ hex, reg: hit[0].reg, type: hit[0].type, ladd: isBlocked(hex) || !!hit[0].ladd, legs: hit }); }
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
function liveList(nowMs, since) {
  const nowS = nowMs / 1000, out = [];
  for (const [hex, l] of live) {
    if (nowS - l.t > CFG.liveMaxAge || (since && !(l.upd > since))) continue;
    const o = Object.assign({}, l.a, { seen_pos: Math.max(0, Math.round((nowS - l.t) * 10) / 10) });
    const m = legs.get(hex); let open = null; if (m) for (const g of m.values()) if (g.open && (!open || g.tStart > open.tStart)) open = g;
    if (open && open.from) o._from = [open.from.id, open.from.conf]; if (open && open.tOff) o._off = open.tOff;
    out.push(o);
  }
  const age = k => lastOk[k] ? Math.round((nowMs - lastOk[k]) / 1000) : null;
  const mil = [age('mil'), age('fi'), age('adsbx')].filter(x => x != null);
  return { v: 1, now: nowMs, full: !since, age: { ladd: age('ladd'), mil: mil.length ? Math.min(...mil) : null, pia: age('pia'), hex: age('hex') }, ac: out };
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
  // (a public monitor keeps no query: where a browser's map is, which aircraft it opened, are not kept against its address)
  reqs.push({ t, ip, path: (PUBLIC ? p : path).slice(0, 120), status, ms }); if (reqs.length > 2000) reqs.splice(0, reqs.length - 2000);
  reqTotals.total++; if (status === 401) reqTotals.unauthorized++; else if (status === 429) reqTotals.limited++; else if (status >= 500) reqTotals.errors++;
  const e = byPath[p] || (byPath[p] = { n: 0, ms: 0, errors: 0 }); e.n++; e.ms += ms; if (status >= 400) e.errors++;
  let c = byClient.get(ip); if (!c) { c = { n: 0, first: t, last: t, paths: {}, denied: [0, 0] }; byClient.set(ip, c); if (byClient.size > 2000) byClient.delete(byClient.keys().next().value); }
  c.n++; c.last = t; c.paths[p] = (c.paths[p] || 0) + 1; if (status === 401) c.denied[0]++; else if (status === 429) c.denied[1]++;
}
function monStatus() {
  const now = Date.now(), age = k => lastOk[k] ? Math.round((now - lastOk[k]) / 1000) : null;
  return { polls: stats.polls, hexPolls: stats.hexPolls, fails: stats.fails, lastErr: stats.lastErr, laddAt: lastLadd.at, aircraft: ac.size, blocked: blocked.size, withLegs: legs.size, legs: [...legs.values()].reduce((n, m) => n + m.size, 0), backfillQueue: backQ.length,
    live: live.size, listAge: { ladd: age('ladd'), mil: age('mil'), fi: age('fi'), pia: age('pia'), hex: age('hex'), area: age('area'), fiArea: age('fiArea'), adsbx: age('adsbx'), osky: age('osky') }, listPolls: stats.listPolls, adsbx: { key: !!CFG.adsbxKey, today: adsbxUse.n, cap: CFG.adsbxDaily }, apiLastMin: gate.sent.filter(t => now - t < 60000).length,
    hist: Object.assign({ queue: histQ.length, closed }, histStats),
    nets: netSt, archive: Object.assign({ on: +CFG.archiveDays || 0, have: archHave() }, AR),
    tracks: Object.assign({ days: tracks.days }, tracks.stats), playback: PB,
    waiting: { flights: waiting.size, playback: waiting.count('pb'), live: waiting.count('live'), named: waiting.stats.named, tries: waiting.stats.tries, expired: waiting.stats.expired, rounds: WAIT.rounds, lastMs: WAIT.lastMs },
    learned: learnedOut ? { ver: learnedOut.ver, from: learnedOut.from, asOf: learnedOut.asOf, days: learnedOut.days, flights: learnedOut.flights, fromBrowsers: learnedOut.crowd || 0, ops: learnedOut.ops, mb: Math.round(learnedOut.json.length / 1e5) / 10 } : null, backfillWaits: backWaits.n,
    shared: { routes: ident.stats.routes || 0, routesRefused: ident.stats.routeRefused || 0, routesShown: [...ident.ids.values()].filter(R => R.crowd).length, destsDropped: (ident.stats.routeAged || 0) + (ident.stats.routeContra || 0), learnRows: LC },
    fr24: { scanning: !!CFG.fr24Scan, headersFrom: fr24.st.hdr ? 'browser' : 'default', ok: fr24.st.ok, fails: fr24.st.fails, lastErr: fr24.st.lastErr, lastOkAgo: fr24.st.lastOkAt ? Math.round((now - fr24.st.lastOkAt) / 1000) : null, paused: fr24.st.pauseUntil > now ? Math.round((fr24.st.pauseUntil - now) / 1000) : 0, scans: F24.scans, last: F24.last,
      flights: ident.flights.size, named: ident.ids.size, unnamed: [...ident.flights.values()].filter(F => !ident.ids.has(F.id) && now - F.seen < 600000).length, matched: ident.stats.matched, revoked: ident.stats.revoked, lookups: ident.stats.lookups, trails: ident.stats.trails, trailQueue: ident.trailQ.length, dest: dest.stats, logged: F24.logged,
      archive: { names: names.size, added: names.stats.added, withdrawn: names.stats.dropped, servedToPlayback: names.stats.served }, crowd: { public: PUBLIC, refused: ident.stats.crowdRefused || 0, waiting: ident.stats.crowdPending || 0 } },
    wx: { cells: wx.stats.cells, requests: wx.stats.requests, today: wx.stats.used, fails: wx.stats.fails, lastErr: wx.stats.lastErr, estimated: wx.stats.estimated, waiting: wx.want.size },
    tel: { aircraft: tel.size, added: tel.stats.added, fromBrowsers: tel.stats.crowd || 0, refused: tel.stats.crowdBad || 0, served: tel.stats.served, asked: tel.stats.asked, missed: tel.stats.missed },
    owners: owners.status(),
    areas: CFG.areas.concat(userAreas).map(a => a.slice(0, 2)), paused: Object.fromEntries(Object.entries(pause).filter(([, t]) => t > now).map(([h, t]) => [h, Math.round((t - now) / 1000)])) };
}
function dashStats() {
  const now = Date.now(), minAgo = now - 60000, os = require('os'), mem = process.memoryUsage(), recent = reqs.filter(r => r.t > minAgo);
  const lastMin = (key, v) => recent.filter(r => r[key] === v).length;
  return {
    uptimeS: process.uptime(), ver: MON_VER, commit: MON_COMMIT, controls: TOKEN ? controls() : null,
    // (the installs counted, in short - /admin/installs has the rest; the versions; the store on disk)
    installs: (s => ({ people: s.people, installs: s.installs, active: s.active, outdated: s.outdated, counting: opts.counting }))(instSummary()),
    versions: verInfo(), disk: diskNow(), options: { public: PUBLIC, rate: RATE, counting: opts.counting, notice: !!opts.notice, minVer: opts.minVer },
    mon: monStatus(),
    srv: { rss: mem.rss, heap: mem.heapUsed, totalMem: os.totalmem(), freeMem: os.freemem(), load: os.loadavg(), cpus: os.cpus().length },
    req: { total: reqTotals.total, lastMin: recent.length, clients: byClient.size, unauthorized: reqTotals.unauthorized, limited: reqTotals.limited, errors: reqTotals.errors },
    endpoints: Object.entries(byPath).map(([path, e]) => ({ path, n: e.n, lastMin: lastMin('path', path) + recent.filter(r => r.path.startsWith(path + '?')).length, avgMs: Math.round(e.ms / e.n), errors: e.errors })).sort((a, b) => b.n - a.n),
    clients: [...byClient].map(([ip, c]) => ({ ip, n: c.n, lastMin: lastMin('ip', ip), first: c.first, last: c.last, top: Object.entries(c.paths).sort((a, b) => b[1] - a[1])[0][0], denied: c.denied[0] + ' / ' + c.denied[1] })).sort((a, b) => b.last - a.last).slice(0, 100),
    recent: reqs.slice(-80).reverse()
  };
}
// ---- the owner's controls: what the LADD Unblock window does in place of a terminal on the server -------------------
// Only with the secret (never on a monitor with none set). /admin/update runs deploy.sh - the newest commit of the branch,
// checked, restarted, rolled back if it does not answer - as a unit of its own (systemd-run), so restarting this service
// does not stop it half way; its output is kept in the store (deploy-last.log). /admin/restart saves and exits, and systemd
// starts it again. Neither is offered where they cannot work: not under systemd, not a git checkout.
const MON_VER = (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, '..', 'package.json'), 'utf8')).version || ''; } catch (e) { return ''; } })();
const MON_COMMIT = (() => { try { return require('child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: DIR, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; } })();
const UNDER_SYSTEMD = !!process.env.INVOCATION_ID;
const CAN_DEPLOY = process.platform === 'linux' && UNDER_SYSTEMD && fs.existsSync(path.join(DIR, 'deploy.sh')) && fs.existsSync(path.join(DIR, '..', '.git'));
const DEPLOY_LOG = path.join(STORE, 'deploy-last.log');
const ctl = { deployAt: 0, restartAt: 0, stop: null };
const controls = () => ({ update: CAN_DEPLOY, restart: UNDER_SYSTEMD, reset: true });
function deployLogTail() {
  try { const st = fs.statSync(DEPLOY_LOG); const txt = fs.readFileSync(DEPLOY_LOG, 'utf8'); return { at: st.mtimeMs, text: scrub(txt.split('\n').slice(-40).join('\n')).slice(-6000) }; } catch (e) { return null; }
}
// ---- installs counted (POST /hello - installs.cjs), the owner's options, the newest version, the store's size ---------
const INST = require('./installs.cjs');
const installs = INST.createInstalls({ store: STORE });
// The owner's options (GET / POST /admin/options), kept in STORE/admin-options.json: notice - a word to every copy of the
// script (500 characters at most); minVer - the oldest version it should still run ('' none); counting - installs counted
// (off: /hello still answers, nothing is kept); public / rate - over MON_PUBLIC / MON_RATE / monitor.json while set (null:
// back to those)
const OPT_FILE = path.join(STORE, 'admin-options.json');
const opts = { notice: '', minVer: '', counting: true };
function applyOptions() { PUBLIC = typeof opts.public === 'boolean' ? opts.public : PUBLIC0; RATE = Number.isInteger(opts.rate) ? opts.rate : rateFor(PUBLIC); }
const optionsOut = () => ({ notice: opts.notice, minVer: opts.minVer, counting: opts.counting, public: PUBLIC, rate: RATE, startup: { public: PUBLIC0, rate: rateFor(PUBLIC0) }, overridden: { public: 'public' in opts, rate: 'rate' in opts } });
// (a change: checked whole before any of it is taken - a string: why it was refused)
function optionsSet(b, save) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'a JSON object of options';
  const o = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'notice') { if (typeof v !== 'string' || v.length > 500) return 'notice: text of 500 characters at most'; o.notice = v.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').trim(); }
    else if (k === 'minVer') { if (typeof v !== 'string' || (v && !/^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(v))) return 'minVer: empty or a version x.y.z'; o.minVer = v; }
    else if (k === 'counting') { if (typeof v !== 'boolean') return 'counting: true or false'; o.counting = v; }
    else if (k === 'public') { if (v !== null && typeof v !== 'boolean') return 'public: true, false or null'; o.public = v; }
    else if (k === 'rate') { if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 10000)) return 'rate: a whole number from 0 to 10000, or null'; o.rate = v; }
    else return 'no option ' + String(k).slice(0, 40);
  }
  for (const [k, v] of Object.entries(o)) if (v === null) delete opts[k]; else opts[k] = v;
  applyOptions();
  if (save !== false) { fs.mkdirSync(STORE, { recursive: true }); fs.writeFileSync(OPT_FILE + '.tmp', JSON.stringify(opts, null, 1)); fs.renameSync(OPT_FILE + '.tmp', OPT_FILE); }
  return null;
}
function optionsLoad() {
  let o; try { o = JSON.parse(fs.readFileSync(OPT_FILE, 'utf8')); } catch (e) { return false; }
  const err = optionsSet(o, false); if (err) log('admin-options.json not taken:', err);
  return !err;
}
// (the newest version: the repository's package.json on GitHub, at start and hourly; while it cannot be read, the last one
// read - or this monitor's own)
const VER_URL = 'https://raw.githubusercontent.com/FinlayC1/fr24-ladd-unblocker/main/package.json';
const latest = { ver: '', at: 0, err: '' };
const latestVer = () => latest.ver || MON_VER;
async function latestCheck() {
  try {
    const r = await global.fetch(VER_URL, { headers: { 'User-Agent': 'fr24-ladd-unblocker-monitor' }, signal: AbortSignal.timeout(15000) });
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const v = String(JSON.parse(await r.text()).version || '');
    if (!/^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(v)) throw new Error('no version in it');
    Object.assign(latest, { ver: v, at: Date.now(), err: '' });
  } catch (e) { latest.err = String(e && e.message || e).slice(0, 200); }
  instCache = null;
  return latestVer();
}
const verInfo = () => ({ monitor: MON_VER, latest: latestVer(), fromGitHub: latest.at || null, err: latest.err, monitorBehind: !!MON_VER && INST.cmpVer(MON_VER, latestVer()) < 0 });
// (what the store takes on disk - walked at most every 10 minutes, in the background - and the disk's free space)
const disk = { at: 0, bytes: 0, files: 0, free: null, total: null, busy: false };
async function diskScan() {
  if (disk.busy) return; disk.busy = true;
  let bytes = 0, files = 0;
  const walk = async d => { let es; try { es = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.isFile()) { try { bytes += (await fs.promises.stat(p)).size; files++; } catch (e2) { /* gone */ } } } };
  try {
    await walk(STORE);
    if (fs.promises.statfs) { try { const s = await fs.promises.statfs(fs.existsSync(STORE) ? STORE : DIR); disk.free = s.bavail * s.bsize; disk.total = s.blocks * s.bsize; } catch (e) { /* not here */ } }
    Object.assign(disk, { at: Date.now(), bytes, files });
  } finally { disk.busy = false; }
}
const diskNow = () => { if (Date.now() - disk.at > 600000) diskScan().catch(() => {}); return disk.at ? { bytes: disk.bytes, files: disk.files, free: disk.free, total: disk.total, at: disk.at } : null; };
// (the counts, worked out at most every 15 s - the dashboard asks every 5 - and again after a hello or a new `latest`)
let instCache = null;
const instSummary = () => { const now = Date.now(); if (!instCache || now - instCache.at > 15000) instCache = { at: now, s: installs.summary(now, latestVer()) }; return instCache.s; };
// GET /badge: shields.io's endpoint format - the people counted, worked out every 10 minutes
let badgeOut = null;
function badge() {
  if (!badgeOut || Date.now() - badgeOut.at > 600000) badgeOut = { at: Date.now(), body: JSON.stringify({ schemaVersion: 1, label: 'users', message: String(new Set(installs.groups().values()).size), color: '1f6feb' }) };
  return badgeOut.body;
}
// POST /hello: one install saying it is there (installs.cjs) - kept unless counting is off; the answer: the newest version,
// the owner's notice and the oldest version it should run. null: refused. (Never logged: neither the hello nor the address)
function helloAnswer(d, ip) {
  const h = INST.valid(d); if (!h) return null;
  if (opts.counting) { try { installs.hello(h, ip, Date.now()); instCache = null; } catch (e) { log('installs', String(e && e.message || e)); } }
  return { ok: 1, latest: latestVer(), notice: opts.notice, minVer: opts.minVer };
}
// (body: what a POST sent, as text - read for /admin/options only)
function adminAnswer(p, method, q, body) {
  if (p === '/admin/log') return { lines: logRing.slice(-Math.min(300, Math.max(1, +q('n') || 80))), deploy: deployLogTail(), controls: controls() };
  // (the installs counted: the counts, and the 500 most recently seen - ids cut short, no address, no network)
  if (p === '/admin/installs' && method === 'GET') return Object.assign({}, instSummary(), { counting: opts.counting, versions: verInfo(), disk: diskNow(), recent: installs.recent(500) });
  if (p === '/admin/options') {
    if (method === 'GET') return optionsOut();
    if (method !== 'POST') return null;
    let b; try { b = JSON.parse(body || ''); } catch (e) { return { _http: 400, ok: false, err: 'not JSON' }; }
    const err = optionsSet(b); if (err) return { _http: 400, ok: false, err };
    log('options changed from the dashboard:', Object.keys(b).join(', '));
    instCache = null;
    return Object.assign({ ok: true }, optionsOut());
  }
  if (method !== 'POST') return null;
  if (p === '/admin/restart') {
    if (!UNDER_SYSTEMD) return { ok: false, err: 'not run by systemd here: stopping it would leave it stopped' };
    if (Date.now() - ctl.restartAt < 60000) return { ok: false, err: 'already restarting' };
    ctl.restartAt = Date.now(); log('restart asked for from the LADD Unblock window');
    setTimeout(() => { if (ctl.stop) ctl.stop(); else process.exit(0); }, 500);
    return { ok: true };
  }
  if (p === '/admin/reset-logs') {
    const n = resetHistLogs(); fillAsked.clear();
    for (let i = histQ.length - 1; i >= 0; i--) if (histQ[i].fill) { histPend.delete(histQ[i].hex + '|' + histQ[i].day); histQ.splice(i, 1); }
    log('every saved flight log deleted from the LADD Unblock window:', n, 'files');
    return { ok: true, deleted: n };
  }
  if (p === '/admin/update') {
    if (!CAN_DEPLOY) return { ok: false, err: 'not a git checkout run by systemd: update it on the server' };
    if (Date.now() - ctl.deployAt < 5 * 60000) return { ok: false, err: 'an update is already running' };
    ctl.deployAt = Date.now(); log('update asked for from the LADD Unblock window');
    const uid = process.getuid ? String(process.getuid()) : '';
    const args = ['-n', 'systemd-run', '--unit', 'fr24-deploy-' + Date.now(), '--collect', '--quiet', ...(uid ? ['--uid', uid] : []), '--property', 'WorkingDirectory=' + path.join(DIR, '..'),
      '--property', 'StandardOutput=truncate:' + DEPLOY_LOG, '--property', 'StandardError=inherit', '/bin/bash', path.join(DIR, 'deploy.sh')];
    return new Promise(res => {
      require('child_process').execFile('sudo', args, { timeout: 20000 }, (e, out, err) => {
        if (e) { ctl.deployAt = 0; const why = scrub(String(err || e.message || e)).trim().slice(0, 300); log('update could not start', why); return res({ ok: false, err: why || 'could not start' }); }
        res({ ok: true });
      });
    });
  }
  return null;
}
// One request's answer (null: no such path)
// (ctx.admin: the owner - the full answers; anyone else on a public monitor: no places browsers looked at, no private
// person's name)
function answer(u, nowS, ctx) {
  const p = u.pathname, q = k => u.searchParams.get(k), admin = !ctx || !!ctx.admin;
  if (p === '/stats') return admin ? dashStats() : null;
  if (p === '/status') { const st = Object.assign({ v: 3, data: 'adsb.lol (ODbL)', since: stats.since, public: PUBLIC, ver: MON_VER, commit: MON_COMMIT }, monStatus()); if (!admin) delete st.areas; else if (TOKEN) st.controls = controls(); return st; }
  if (p === '/near') return nearAnswer(+q('lat'), +q('lon'), +q('r'));
  if (p === '/tel') return telAnswer(hexList(q('hex'), 100), +(q('lat') || NaN), +(q('lon') || NaN));
  if (p === '/names') return { list: names.get(String(q('ids') || '').split(',').slice(0, 2000), +q('t') || 0) };
  // (the flights of a day, as kept: derived from adsb.lol's data, offered under the same licence - the ODbL)
  if (p === '/export/legs') { const d = String(q('day') || ''); if (!/^\d{4}-\d\d-\d\d$/.test(d)) return null; let list = []; try { list = JSON.parse(fs.readFileSync(path.join(STORE, 'legs-' + d + '.json'), 'utf8')); } catch (e) { list = []; } return { day: d, licence: 'ODbL-1.0 - derived from adsb.lol data (https://opendatacommons.org/licenses/odbl/1-0/)', legs: list }; }
  // (with since - the "now" of the last answer: only the aircraft heard again since; a minute or older: everything)
  if (p === '/live') { const now = Date.now(), since = +(q('since') || 0); return liveList(now, since > 0 && now - since < 60000 ? since : 0); }
  // (every name, or - with since, the time of the last answer - what changed since; a very old "since" gets everything)
  if (p === '/fr24ids') { const now = Date.now(), since = +(q('since') || 0), full = !(since > 0) || now - since > 6 * 3600e3; return Object.assign({ v: 1, now, full, scanOk: !!fr24.st.lastOkAt && now - fr24.st.lastOkAt < 300000 }, ident.table(full ? 0 : since)); }
  if (p === '/board') return { aircraft: boardLegs(+q('ap'), +(q('from') || nowS - 3 * 86400), +(q('to') || nowS)) };
  if (p === '/flights') return { list: flightsOfCs(q('cs')) };
  if (p === '/legs') {
    const hs = hexList(q('hex'), 50), one = h => { const m = legs.get(h); return { hex: h, legs: m ? chained(m) : [] }; };
    return hs.length > 1 ? { list: hs.map(one) } : one(hs[0] || String(q('hex') || '').toLowerCase());
  }
  if (p === '/airport') return APT.answer(+q('ap'), legs, nowS, Math.min(14, Math.max(1, +(q('days') || 7))));
  if (p === '/owners') return { list: owners.rows(hexList(q('hex'), 500), { public: !admin && PUBLIC }) };
  if (p === '/learn') return Object.assign({ v: 1 }, learnSince(String(q('from') || '')));
  // (the same increments the browser already has: only that it has them)
  if (p === '/learned') { if (!learnedOut) return { v: 1, ver: '', none: true }; return q('have') === learnedOut.ver ? { v: 1, ver: learnedOut.ver, same: true } : { raw: learnedOut.json }; }
  if (p === '/hist') { const hs = hexList(q('hex'), 20); for (const h of hs.slice(0, 5)) fillHist(h, nowS); return { hv: HIST_V, list: hs.map(histOf) }; }
  if (p === '/trace') { const hex = hexList(q('hex'), 1)[0]; return hex ? traceOf(hex, nowS) : null; }
  if (p === '/ladd') return { at: lastLadd.at, ac: lastLadd.ac };
  if (p === '/photos') return { list: photos.get(hexList(q('hex'), 50), Date.now()) };
  if (p === '/last') return { list: lastHeard(nowS) };
  if (p === '/parked') return { list: parkedAt(+q('ap'), String(q('type') || '').toUpperCase(), nowS) };
  const ip = (ctx && ctx.ip) || '';
  if (p === '/seed') return { queued: seed(String(q('hex') || '').split(',').slice(0, 500), q('front') === '1', nowS, admin ? null : allowance('seed', ip, +CFG.seedPerHour || 300)), backfillQueue: backQ.length };
  if (p === '/area') { const added = addArea(+q('lat'), +q('lon'), nowS, admin ? null : allowance('area', ip, +CFG.areaPerHour || 4)); return admin ? { added, areas: CFG.areas.concat(userAreas).map(a => a.slice(0, 2)) } : { added }; }
  return null;
}
function serve() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), nowS = Date.now() / 1000, t0 = Date.now();
    let body = null;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    // (the owner's panel asking for its own pages is not traffic)
    res.on('finish', () => { if (u.pathname !== '/dash' && !((u.pathname === '/stats' || (u.pathname.startsWith('/admin/') && req.method === 'GET')) && res.statusCode === 200)) noteReq(ip, u.pathname + u.search, res.statusCode, Date.now() - t0); });
    // (the page itself holds no data - it asks for the numbers with the secret the visitor types in)
    if (u.pathname === '/dash') { try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(path.join(DIR, 'dash.html'))); } catch (e) { res.writeHead(404); res.end(); } return; }
    // (the owner: the secret, or no secret set; anyone else only on a public monitor, and not the dashboard's numbers)
    const admin = !TOKEN || tokenOk(req.headers['x-monitor-token']), ctx = { admin, ip };
    // (the users badge - shields.io's endpoint format, for a README: open to anyone, any site, even on a private monitor)
    if (u.pathname === '/badge' && req.method === 'GET') {
      if (!admin && limited(ip)) { res.writeHead(429, { 'Retry-After': '30' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*' }); res.end(badge()); return;
    }
    if (!admin && (!PUBLIC || u.pathname === '/stats')) { res.writeHead(401); res.end(); return; }
    if (!admin && limited(ip)) { res.writeHead(429, { 'Retry-After': '30' }); res.end(); return; }
    // (the owner's controls: only with the secret - a monitor with none set offers none)
    if (u.pathname.startsWith('/admin/')) {
      if (!tokenOk(req.headers['x-monitor-token'])) { res.writeHead(401); res.end(); return; }
      const send = b => { if (res.headersSent) return; if (!b) { res.writeHead(404); res.end(); return; } const code = b._http || 200; delete b._http; res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(b)); };
      const go = body => { try { Promise.resolve(adminAnswer(u.pathname, req.method, k => u.searchParams.get(k), body)).then(send, e => { if (!res.headersSent) { res.writeHead(500); res.end(); } log('admin', e); }); } catch (e) { res.writeHead(500); res.end(); } };
      if (req.method !== 'POST') { req.resume(); go(null); return; }
      // (a POST's body: read - the options - up to 64 KB)
      const parts = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > 65536) { if (!res.headersSent) { res.writeHead(413); res.end(); } req.destroy(); } else parts.push(c); });
      req.on('end', () => { if (!res.headersSent) go(Buffer.concat(parts).toString('utf8')); });
      return;
    }
    if (req.method === 'POST') {
      if (u.pathname !== '/report' && u.pathname !== '/pbmatch' && u.pathname !== '/hello') { res.writeHead(404); res.end(); return; }
      const parts = [], cap = u.pathname === '/hello' ? 4096 : 4e6; let size = 0;
      req.on('data', c => { size += c.length; if (size > cap) { if (!res.headersSent) { res.writeHead(413); res.end(); } req.destroy(); } else parts.push(c); });
      req.on('end', () => {
        if (res.headersSent) return;
        if (u.pathname === '/hello') {
          let h = null; try { h = helloAnswer(JSON.parse(Buffer.concat(parts).toString('utf8')), ip); } catch (e) { h = null; }
          if (!h) { res.writeHead(400); res.end(); return; }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(h)); return;
        }
        let out; try { const d = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); out = u.pathname === '/pbmatch' ? { v: 1, t: +d.t || 0, list: pbMatch(+d.t || 0, d.f) } : report(d, Date.now(), ctx); } catch (e) { res.writeHead(400); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
      });
      return;
    }
    // (an answer may wait for a lookup - /near)
    try { body = answer(u, nowS, ctx); } catch (e) { res.writeHead(500); res.end(String(e)); return; }
    Promise.resolve(body).then(b => {
      if (res.headersSent) return;
      if (!b) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://www.flightradar24.com' });
      res.end(typeof b.raw === 'string' ? b.raw : JSON.stringify(b));
    }, e => { if (!res.headersSent) { res.writeHead(500); res.end(String(e)); } });
  }).listen(PORT, HOST, () => log('listening on ' + HOST + ':' + PORT));
}

if (require.main === module) {
  const nowS = Date.now() / 1000;
  loadEngine();
  const st = loadState();
  loadStore(nowS);
  const named = loadIdent(Date.now()); if (named) log('kept names of', named, 'FR24 flights');
  const waits = loadWaiting(Date.now()); if (waits) log(waits, 'flights not named yet, still being worked on');
  const ownersKnown = owners.load(STORE); if (ownersKnown) log('kept owners of', ownersKnown, 'aircraft');
  const photosKept = photos.load(STORE, Date.now()); if (photosKept) log('kept pictures of', photosKept, 'aircraft');
  learnedLoad();
  const namesKept = names.load(nowS); if (namesKept) log('names of', namesKept, 'FR24 flights of the last two weeks, for playback');
  for (const [id, R] of ident.ids) names.add(id, { hex: R.hex, reg: R.reg, type: R.type, cs: R.cs, flags: R.flags }, R.at || nowS);
  // (the owner's options over the startup settings; the installs counted; the newest version, now and hourly)
  if (optionsLoad()) log('options', JSON.stringify({ public: PUBLIC, rate: RATE, counting: opts.counting, minVer: opts.minVer, notice: !!opts.notice }));
  const counted = installs.load(); if (counted) log('installs counted:', counted);
  latestCheck().then(v => log('newest version', v + (latest.err ? ' (GitHub not read: ' + latest.err + ')' : '')));
  setInterval(latestCheck, 3600e3);
  setInterval(() => { try { installs.save(); } catch (e) { log('installs', String(e && e.message || e)); } }, 60000);
  serve();
  // (blocked aircraft of flights kept before this version kept a state file: from the flights)
  for (const m of legs.values()) for (const l of m.values()) if (l.ladd && !blocked.has(l.hex)) blocked.set(l.hex, { reg: l.reg || '', type: l.type || '', at: Math.round(l.tStart), heard: Math.round(l.tEnd || 0) });
  lastRun = (st && st.lastRun) || 0;
  // (first run of this version: every blocked aircraft's last three days, once)
  if (!st) gapFill(nowS - 3 * 86400, nowS); else if (lastRun && nowS - lastRun > 600) gapFill(lastRun, nowS);
  setInterval(() => { try { work(); } catch (e) { log('work', e); } }, 120000);
  setInterval(() => log('status', JSON.stringify({ polls: stats.polls, hexPolls: stats.hexPolls, fails: stats.fails, aircraft: ac.size, live: live.size, blocked: blocked.size, legs: [...legs.values()].reduce((n, m) => n + m.size, 0), backfill: backQ.length, hist: histQ.length, rss: Math.round(process.memoryUsage().rss / 1048576), err: stats.lastErr })), 600000);
  // (stopped - Ctrl+C here, systemd's stop or restart on a server: what it has is saved first)
  const stop = () => { try { work(true); } catch (e) { log('save on stop', e); } process.exit(0); };
  ctl.stop = stop;
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  // (an error anywhere is logged and the monitor goes on; another copy already running is the one exception)
  process.on('uncaughtException', e => { log('error', e && e.stack || e); if (e && e.code === 'EADDRINUSE') process.exit(1); });
  process.on('unhandledRejection', e => log('error', e && e.stack || e));
  loop();
  for (let i = 0; i < CFG.backWorkers; i++) backfillLoop();
  if (+CFG.archiveDays > 0) for (let i = 0; i < Math.max(1, Math.min(4, +CFG.archiveJobs || 1)); i++) setTimeout(archiveLoop, i * 3000);
  fr24Loop(); identLoop(); trailLoop(); waitLoop();
  // (every blocked aircraft's owner not known yet: looked up, fifteen a minute at most, those flying now first)
  for (const [hex, b] of blocked) owners.want(hex, b.reg);
  ownersLoop();
  setInterval(() => { wx.pump().catch(e => log('wx', String(e))); }, 2000);
}
module.exports = { archBreath, memAvail, classifyTrace, traceGet, netSt, archiveDay, archiveState, archiveNext, archMark, archTried, archDays, archRunning, traceOf, AR, apliveTrace, HIST_V, HIST_RESET, resetHistLogs, histResetMark, get histResetN() { return histResetN; }, adminAnswer, ctl, logRing, log, MON_VER, learnCheck, learnFromCrowd, crowdLearnSave, crowdRows, LC, tracks, waiting, waitRound, waitLive, waitNamed, waitClaims, WAIT, saveWaiting, loadWaiting, pbMatch, learnedBuild, learnedDue, learnedLoad, learnedRef: () => learnedOut, liveBusy, backWaits, E, CFG, loadEngine, ingest, buildLegs, fr24Legs, fr24Leg, F24ref: () => F24, owners, ownersLoop, APT, legRunways, names, nearAnswer, telAnswer, tel, wx, pbNames, get PUBLIC() { return PUBLIC; }, get RATE() { return RATE; }, limited, tokenOk, installs, opts, optionsSet, optionsLoad, latestCheck, latestVer, helloAnswer, badge, wakeQuiet, parkedAt, boardLegs, flightsOfCs, lastHeard, legs, ac, backfillOne, backQ, blocked, markBlocked, seed, gapFill, addArea, userAreas,
  serve, fr24, ident, dest, F24, report, identRound, fr24Round, saveIdent, loadIdent, histUnknown, learnSince, learnWrite, diskLegs, KEEP_LADD, save, loadStore, dirtyDays, pollOpenSky, adsbxUse, live, liveList, answer, step, P, piaState, apiGet, gate, stats, lastOk, noteWatch, watch, watchedAll, flew, closeDays, histQ, histPend, histOne, histDay, histOf, histRead, histWrite, histFile, fillHist, fillAsked, queueHist, photos, nextHist, saveState, loadState, lastW, get closed() { return closed; }, set closed(v) { closed = v; }, pause };
