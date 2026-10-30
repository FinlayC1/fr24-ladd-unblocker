// Every airport's board, kept on the monitor (1.1.0): FR24's own rows of its arrivals and departures - its airport
// schedule, the lists of its flight numbers, its map boards - seven days back and seven ahead, as the browsers read them
// from FR24 and send them on, and as the monitor reads FR24's schedule itself where FR24 lets it. A browser opening a
// board gets them all in one answer (with the monitor's own flights there): the board is whole the moment it opens, the
// same for everyone, and what a browser reads from FR24 itself comes back here for the next one.
//
// A row is the userscript's board row (06-boards.js boardPut) of FR24's data only - src 'fr24' (its map board's rows,
// with FR24's own row in nat) or 'sched' (its schedule and flight-number lists): { k, src, fid, id, cs, num, t, sch, est,
// st, col, ap, al, alId, alIcao, ty, reg, hex, nat, u (when it last changed here) }. Kept per airport: in memory while
// asked for, on disk (STORE/boards/<airport id>.json.gz) for good within the window.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const fin = v => typeof v === 'number' && isFinite(v);
const WIN = 8 * 86400;                   // (rows kept: eight days either side of now - the boards show seven)
const SRC_OK = new Set(['fr24', 'sched']);
const ST_RANK = { scheduled: 0, '': 0, estimated: 1, delayed: 1, departed: 2, landed: 2, canceled: 2, diverted: 2 };
const rank = r => ST_RANK[String((r && r.st) || '')] || 0;
// (FR24's own row, as it came: plain values only - strings, numbers, true / false, null; objects and short lists of them,
// three deep - no key of the script's own (__tl...); 4 KB at most)
function plain(v, depth) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return fin(v) ? v : null;
  if (typeof v === 'string') return v.length <= 300 ? v : v.slice(0, 300);
  if (depth >= 3 || typeof v !== 'object') return undefined;
  if (Array.isArray(v)) return v.slice(0, 20).map(x => plain(x, depth + 1)).filter(x => x !== undefined);
  const o = {}; let n = 0;
  for (const [k, x] of Object.entries(v)) { if (n++ >= 40 || /^__/.test(k) || !/^[A-Za-z0-9_]{1,40}$/.test(k)) continue; const p = plain(x, depth + 1); if (p !== undefined) o[k] = p; }
  return o;
}
const str = (v, re, max) => { const s = String(v == null ? '' : v).trim().slice(0, max || 60); return !s || (re && !re.test(s)) ? '' : s; };
const num = v => fin(+v) && +v > 0 ? Math.round(+v) : 0;
// One row as a browser (or the monitor's own read of FR24) gave it: kept only in this form
function cleanRow(r, nowS) {
  if (!r || typeof r !== 'object' || !SRC_OK.has(r.src)) return null;
  const t = num(r.t); if (!t || Math.abs(t - nowS) > WIN) return null;
  const k = str(r.k, /^[fn][A-Za-z0-9:._-]{1,60}$/, 70); if (!k) return null;
  const o = { k, src: r.src, t, sch: num(r.sch) || t, est: num(r.est) || t,
    fid: str(r.fid, /^[0-9a-f]{1,12}$/i, 12).toLowerCase(), id: num(r.id), cs: str(r.cs, /^[A-Z0-9-]{1,10}$/i, 10).toUpperCase(), num: str(r.num, /^[A-Z0-9-]{1,10}$/i, 10).toUpperCase(),
    st: str(r.st, /^[a-z]{1,12}$/, 12), col: str(r.col, /^[a-z]{1,8}$/, 8), ap: num(r.ap), al: str(r.al, null, 60), alId: num(r.alId), alIcao: str(r.alIcao, /^[A-Z0-9]{2,4}$/i, 4).toUpperCase(),
    ty: str(r.ty, /^[A-Z0-9-]{1,8}$/i, 8).toUpperCase(), reg: str(r.reg, /^[A-Z0-9-]{1,10}$/i, 10).toUpperCase(), hex: str(r.hex, /^[0-9a-f]{6}$/i, 6).toLowerCase() };
  for (const f of Object.keys(o)) if (o[f] === '' || o[f] === 0) delete o[f];
  if (r.nat && typeof r.nat === 'object') { const n = plain(r.nat, 0); if (n && JSON.stringify(n).length <= 4096) o.nat = n; }
  return o;
}
// (two copies of one row: the one further on - departed over scheduled - stands, what it lacks taken from the other; of
// two alike, the newer. FR24's own row merged the same way)
function mergeRow(old, nw) {
  const fill = (a, b) => { const o = Object.assign({}, a); for (const [k, v] of Object.entries(b)) if (o[k] == null || o[k] === '') o[k] = v; return o; };
  const ahead = rank(nw) >= rank(old), top = ahead ? nw : old, other = ahead ? old : nw;
  const out = fill(top, other);
  if (old.nat && nw.nat) out.nat = fill(top.nat || {}, other.nat || {});
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);

// ---- FR24's schedule of an airport, as the userscript reads it (06-boards.js natRowOf / fnRows - the airport's own list) ----
const delayCol = (a, s) => !(a && s) || a - s <= 960 ? 'green' : a - s <= 2700 ? 'yellow' : 'red';
const clean = s => String(s == null ? '' : s).trim();
const iataMaps = new WeakMap();
const byIata = (E, c) => { let m = iataMaps.get(E); if (!m || m.size < 100) { m = new Map(); for (const a of E.airports || []) if (a.iata && a.id < 1e7) m.set(String(a.iata).toUpperCase(), a); iataMaps.set(E, m); } return m.get(String(c || '').toUpperCase()) || null; };
function schedRows(E, data, apId, kind) {
  const apOf = c => { c = c && c.code; const a = c && ((c.icao && E.byIcao(c.icao)) || (c.iata && byIata(E, c.iata))); return a && a.id < 1e7 ? a.id : 0; };
  const natOf = (x, k) => {
    const idn = x.identification || {}, tm = x.time || {}, sc = tm.scheduled || {}, re = tm.real || {}, es = tm.estimated || {};
    const gen = (x.status && x.status.generic) || {}, gs = gen.status || {}, ev = gen.eventTime || {}, arr = k === 'arrivals';
    const sch = arr ? sc.arrival : sc.departure; if (!sch) return null;
    let name, color, est;
    if (/cancel/.test(gs.text || '')) { name = 'canceled'; color = 'red'; est = sch; }
    else if (arr && /divert/.test(gs.text || '')) { name = 'diverted'; color = 'red'; est = ev.utc || sch; }
    else if (arr) { const dd = sc.departure && re.departure ? re.departure - sc.departure : 0, r = re.arrival, e = r || es.arrival || (gs.type === 'arrival' ? ev.utc : 0) || (dd > 0 ? sch + dd : 0); est = e || sch; name = r ? 'landed' : !e ? 'scheduled' : delayCol(e, sch) === 'green' ? 'estimated' : 'delayed'; color = name === 'scheduled' ? 'gray' : delayCol(e, sch); }
    else { const r = re.departure, e = r || es.departure; est = e || sch; name = r ? 'departed' : e ? 'estimated' : 'scheduled'; color = name === 'scheduled' ? 'gray' : delayCol(e, sch); }
    const ty = clean(x.aircraft && x.aircraft.model && x.aircraft.model.code).toUpperCase();
    return { id: Number(idn.row) || 0, flight: { id: idn.id || null, number: (idn.number && idn.number.default) || null, callsign: idn.callsign || null }, status: { name, color, isAmbiguous: false, live: !!(x.status && x.status.live) },
      scheduledTime: sch, estimatedTime: est, airportId: apOf(x.airport && (arr ? x.airport.origin : x.airport.destination)) || null, divertedToId: null,
      airlineId: null, airline: (x.airline && (x.airline.short || x.airline.name)) || null, aircraftType: ty || null, runway: null };
  };
  const out = [];
  for (const x of data || []) {
    if (!x) continue;
    const idn = x.identification || {}, tm = x.time || {}, sc = tm.scheduled || {}, re = tm.real || {}, es = tm.estimated || {};
    const o = apOf(x.airport && x.airport.origin) || (kind === 'departures' ? apId : 0), d = apOf(x.airport && x.airport.destination) || (kind === 'arrivals' ? apId : 0);
    const fid = idn.id ? String(idn.id) : '', nm = clean(idn.number && idn.number.default).toUpperCase(), cs = clean(idn.callsign).toUpperCase();
    const k = fid ? 'f' + fid : 'n' + nm + ':' + (sc.departure || sc.arrival || 0);
    const stx = clean(((x.status || {}).generic || {}).status && x.status.generic.status.text).toLowerCase(), cx = /cancel/.test(stx), dv = /divert/.test(stx);
    const icao = clean(x.airline && x.airline.code && x.airline.code.icao).toUpperCase();
    const base = { src: 'sched', fid, id: Number(idn.row) || 0, cs, num: nm, al: clean(x.airline && x.airline.name), alIcao: icao, ty: clean(x.aircraft && x.aircraft.model && x.aircraft.model.code), reg: clean(x.aircraft && x.aircraft.registration), hex: clean(x.aircraft && x.aircraft.hex).toLowerCase() };
    const dep = re.departure || es.departure || sc.departure, arr = re.arrival || es.arrival || sc.arrival;
    if (kind === 'departures' && o === apId && dep) out.push(Object.assign({ nat: natOf(x, 'departures'), k, t: dep, sch: sc.departure || dep, est: dep, st: cx ? 'canceled' : re.departure ? 'departed' : 'scheduled', col: cx ? 'red' : re.departure ? 'green' : 'gray', ap: d }, base));
    if (kind === 'arrivals' && d === apId && arr) out.push(Object.assign({ nat: natOf(x, 'arrivals'), k, t: arr, sch: sc.arrival || arr, est: arr, st: cx ? 'canceled' : dv ? 'diverted' : re.arrival ? 'landed' : es.arrival ? 'estimated' : 'scheduled', col: cx || dv ? 'red' : re.arrival || es.arrival ? 'green' : 'gray', ap: o }, base));
  }
  return out;
}

function createBoards(env) {
  const dir = path.join(env.store, 'boards'), log = env.log || (() => {}), E = env.E;
  const C = Object.assign({ keepMem: 400, fetch: true, every: 20, pace: 5, wantH: 24, pauseH: 3, pages: 6 }, env.cfg || {});
  const mem = new Map();        // apId -> { arr: Map, dep: Map, at, fr24At, ownAt, dirty, used }
  const wanted = new Map();     // apId -> when a browser last asked for its board or panel
  const S = { airports: 0, rows: 0, puts: 0, taken: 0, refused: 0, saved: 0, read: 0, own: { ok: 0, fails: 0, rows: 0, lastErr: '', lastOkAt: 0, pausedUntil: 0, airports: 0 } };
  const file = apId => path.join(dir, apId + '.json.gz');
  function blank() { return { arr: new Map(), dep: new Map(), at: 0, fr24At: 0, ownAt: 0, dirty: false, used: Date.now() }; }
  function load(apId) {
    let b = mem.get(apId);
    if (b) { b.used = Date.now(); return b; }
    b = blank();
    try {
      const o = JSON.parse(zlib.gunzipSync(fs.readFileSync(file(apId))).toString('utf8'));
      if (o && o.v === 1) { for (const r of o.arr || []) b.arr.set(r.src + '|' + r.k, r); for (const r of o.dep || []) b.dep.set(r.src + '|' + r.k, r); b.at = o.at || 0; b.fr24At = o.fr24At || 0; b.ownAt = o.ownAt || 0; S.read++; }
    } catch (e) { if (e.code !== 'ENOENT') log('boards', apId, String(e.message || e)); }
    mem.set(apId, b); evict();
    return b;
  }
  function evict() {
    if (mem.size <= C.keepMem) return;
    for (const [id, b] of [...mem].sort((x, y) => x[1].used - y[1].used)) { if (mem.size <= C.keepMem * 0.9) break; if (!b.dirty) mem.delete(id); }
  }
  function prune(b, nowS) { for (const m of [b.arr, b.dep]) for (const [key, r] of m) if (Math.abs(r.t - nowS) > WIN) { m.delete(key); b.dirty = true; } }
  // Rows of an airport's board (kind 'arrivals' / 'departures') - from a browser (via 'crowd' / 'owner') or the monitor's own
  // read of FR24 ('own'). Returns how many were new or changed.
  function put(apId, kind, rows, via, nowS) {
    apId = num(apId); nowS = nowS || Date.now() / 1000;
    if (!apId || apId >= 1e7 || !(kind === 'arrivals' || kind === 'departures') || !Array.isArray(rows)) return 0;
    if (E && E.byId && !E.byId(apId)) return 0;
    const b = load(apId), m = kind === 'arrivals' ? b.arr : b.dep; let n = 0;
    for (const r0 of rows.slice(0, 2000)) {
      const r = cleanRow(r0, nowS); if (!r) { S.refused++; continue; }
      const key = r.src + '|' + r.k, cur = m.get(key), nx = cur ? mergeRow(cur, r) : r;
      if (cur) { const a = Object.assign({}, cur), z = Object.assign({}, nx); delete a.u; delete z.u; if (same(a, z)) continue; }
      nx.u = Math.round(nowS); m.set(key, nx); n++;
    }
    S.puts++; S.taken += n;
    if (n) { b.at = Math.round(nowS); b.dirty = true; }
    if (via === 'own') b.ownAt = Math.round(nowS); else b.fr24At = Math.round(nowS);
    return n;
  }
  // An airport's rows between from and to (by their time), those changed since `since` only when given
  function rows(apId, from, to, since) {
    const b = load(num(apId)), out = { arrivals: [], departures: [] };
    for (const [kind, m] of [['arrivals', b.arr], ['departures', b.dep]]) for (const r of m.values()) if (r.t >= from && r.t <= to && (!since || (r.u || 0) > since)) out[kind].push(r);
    return Object.assign(out, { at: b.at, fr24At: Math.max(b.fr24At, b.ownAt) });
  }
  // (an airport asked for by a browser: its schedule read here too - FR24 letting the monitor - while it is wanted)
  function want(apId, nowMs) { apId = num(apId); if (apId && apId < 1e7) { wanted.set(apId, nowMs || Date.now()); if (wanted.size > 5000) wanted.delete(wanted.keys().next().value); } }
  // Each UTC day's take-offs and landings at an airport by FR24's own rows - those that say it went (departed / landed),
  // one per flight (its schedule's row and its map board's alike): Map day -> [take-offs, landings]
  function counts(apId) {
    const b = load(num(apId)), out = new Map();
    const went = r => /^(departed|landed)$/.test(r.st || (r.nat && r.nat.status && r.nat.status.name) || '');
    for (const [i, m] of [[0, b.dep], [1, b.arr]]) {
      const seen = new Set();
      for (const r of m.values()) {
        if (!went(r)) continue;
        const id = r.fid ? 'f' + r.fid : r.k; if (seen.has(id)) continue; seen.add(id);
        const d = dayOf(r.t), c = out.get(d) || out.set(d, [0, 0]).get(d); c[i]++;
      }
    }
    return out;
  }
  function save(nowS) {
    nowS = nowS || Date.now() / 1000; let n = 0;
    fs.mkdirSync(dir, { recursive: true });
    for (const [apId, b] of mem) {
      prune(b, nowS); if (!b.dirty) continue;
      const tmp = file(apId) + '.tmp';
      fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify({ v: 1, at: b.at, fr24At: b.fr24At, ownAt: b.ownAt, arr: [...b.arr.values()], dep: [...b.dep.values()] }), { level: 6 }));
      fs.renameSync(tmp, file(apId)); b.dirty = false; n++; S.saved++;
    }
    evict();
    let rowsN = 0; for (const b of mem.values()) rowsN += b.arr.size + b.dep.size;
    S.rows = rowsN; S.airports = (() => { try { return fs.readdirSync(dir).filter(f => /\.json\.gz$/.test(f)).length; } catch (e) { return mem.size; } })();
    return n;
  }
  // ---- the monitor's own read of FR24's schedule: the airports browsers asked for in the last day, each again after
  // `every` minutes, a request every `pace` seconds at most; FR24 refusing (a challenge page, 403, 429): left alone `pauseH`
  // hours. Its rows go in as a browser's would.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let busy = false;
  async function fetchJson(url) {
    const r = await env.fetch(url, { headers: Object.assign({ accept: 'application/json', 'accept-language': 'en-GB,en;q=0.9', origin: 'https://www.flightradar24.com', referer: 'https://www.flightradar24.com/' }, env.ua ? { 'user-agent': env.ua() } : {}) });
    const txt = await r.text();
    if (r.status !== 200 || !/^\s*[{[]/.test(txt)) { const e = new Error('HTTP ' + r.status + (/^\s*</.test(txt) ? ' (a page, not data)' : '')); e.refused = r.status === 403 || r.status === 429 || r.status === 401 || /^\s*</.test(txt); throw e; }
    return JSON.parse(txt);
  }
  async function readAirport(apId) {
    const a = E.byId(apId), code = a && (a.iata || a.icao); if (!code) return 0;
    let n = 0;
    for (const kind of ['arrivals', 'departures']) for (const dirn of [1, -1]) for (let page = dirn; Math.abs(page) <= C.pages; page += dirn) {
      const j = await fetchJson(`https://api.flightradar24.com/common/v1/airport.json?code=${encodeURIComponent(String(code).toLowerCase())}&plugin[]=schedule&plugin-setting[schedule][mode]=${kind}&page=${page}&limit=100`);
      const s = j && j.result && j.result.response && j.result.response.airport && j.result.response.airport.pluginData && j.result.response.airport.pluginData.schedule && j.result.response.airport.pluginData.schedule[kind];
      const got = schedRows(E, ((s && s.data) || []).map(x => x && x.flight), apId, kind);
      n += put(apId, kind, got, 'own'); S.own.rows += got.length;
      await sleep(C.pace * 1000);
      if (!s || !s.page || Math.abs(page) >= s.page.total) break;
    }
    return n;
  }
  async function pump(nowMs) {
    nowMs = nowMs || Date.now();
    if (!C.fetch || !env.fetch || busy || nowMs < S.own.pausedUntil) return 0;
    const due = [...wanted].filter(([id, at]) => nowMs - at < C.wantH * 3600e3 && nowMs / 1000 - load(id).ownAt > C.every * 60).sort((x, y) => load(x[0]).ownAt - load(y[0]).ownAt);
    if (!due.length) return 0;
    busy = true;
    try {
      const n = await readAirport(due[0][0]);
      S.own.ok++; S.own.lastOkAt = Date.now(); S.own.lastErr = ''; S.own.airports = new Set([...mem].filter(([, b]) => b.ownAt).map(([id]) => id)).size;
      return n;
    } catch (e) {
      S.own.fails++; S.own.lastErr = String(e && e.message || e).slice(0, 120);
      load(due[0][0]).ownAt = Math.round(nowMs / 1000);   // (not straight back to the same one)
      if (e && e.refused) S.own.pausedUntil = Date.now() + C.pauseH * 3600e3;
      return 0;
    } finally { busy = false; }
  }
  return { put, rows, want, counts, save, pump, load, stats: S, wanted, C };
}

module.exports = { createBoards, cleanRow, mergeRow, schedRows, WIN };
