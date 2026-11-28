'use strict';
// (1.4.1) Every flight of FR24's map by its flight number - for a flight number's log page beyond the week FR24 shows a
// free account (U2414's flights of a month ago), and the flight number of a callsign for the playback of a flight FR24
// no longer has (LOG8NP). From the monitor's scans of FR24's map (every flight FR24 draws, its flight number asked for
// with the rest - fr24.cjs MASKS 'flight'):
//   - a flight with a flight number is followed while the scans see it - its FR24 id, flight number, callsign, aircraft
//     (address, registration, type), FR24's route (from, to: IATA codes) and when it was first and last seen - and,
//     45 minutes after the last time, written down by its flight number
//   - each callsign's flight number as FR24 last showed it (EZY327L -> U2414): kept a year from when last seen
// Written as a line of tab-separated fields - "FN fid cs hex reg type from to t0 t1" - to STORE/fr24fn/<YYYY-MM>/<b>.txt,
// <b> two hex digits of the flight number's hash (256 files a month; a flight number's flights of a month in one of
// them), so a flight number's flights of the last months are a few files' lines. Months older than keepDays go whole.
// The callsigns' table and the flights being followed: STORE/fr24fn/state.json.gz, every quarter of an hour and on stop.
//   query(fn, from, to) -> [{ fid, fn, cs, hex, reg, type, from, to, t0, t1 }] newest first
//   csFn([cs...]) -> { cs: fn }
//   noteCs(cs, fn, t, weak) (1.4.2) a callsign's flight number seen elsewhere: on FR24's airport schedules (the boards'
//     rows, every airport a browser or the monitor reads - boards.cjs), or on FR24's own rows a browser's page showed
//     (weak: never over one seen in the last three days). Rebuilt log rows of flights before the monitor's scans asked
//     FR24 for flight numbers were mostly callsigns still - only those the scans had seen since
//   noteSched(row, apId, kind) (1.4.3) FR24's scheduled time of a flight from a board's row (boards.cjs: FR24's map boards,
//     its schedules, the rows of FR24's own log pages browsers showed - FR24's id, the flight number, the scheduled time
//     marked as FR24's, sx): its departure's from a departures row, its arrival's from an arrivals row. Kept a year, by
//     FR24's id, as "FN fid cs std sta from to" (airport ids) in STORE/fr24fn/<YYYY-MM>/S<b>.txt once the flight is over
//     (twelve hours after), so a log row older than FR24's week has FR24's STD and STA as its newer ones have
//   sched([fn...], from, to) -> [{ fn, fid, cs, std, sta, from, to }]; schedFor(list, from, to) the same matched to
//     flights - by FR24's id, else by flight number and time (within three hours) and airports
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const fin = v => typeof v === 'number' && isFinite(v);
const FN_RE = /^[A-Z0-9]{2}\d{1,5}[A-Z]?$|^[A-Z]{3}\d{1,5}[A-Z]?$/;
const CS_RE = /^[A-Z]{3}\d[A-Z0-9]{0,4}$/;
const IATA_RE = /^[A-Z0-9]{3}$/;
const ST_V = 1;
// (the flight number as FR24 writes it: letters and figures only, upper case)
const normFn = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// (a flight number's file of a month: FNV-1a of it, its last byte)
function bucketOf(fn) { let h = 0x811c9dc5; for (let i = 0; i < fn.length; i++) { h ^= fn.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0' + (h & 255).toString(16)).slice(-2); }
const monthOf = t => new Date(t * 1000).toISOString().slice(0, 7);
const tidy = (s, n) => String(s || '').replace(/[\t\r\n]/g, ' ').trim().slice(0, n);

function createFnIndex(env) {
  const log = env.log || (() => {});
  const dir = env.store ? path.join(env.store, env.dir || 'fr24fn') : '';
  const keepDays = env.keepDays || 365, closeS = env.closeS || 45 * 60, csKeepS = 365 * 86400;
  const open = new Map();     // fid -> { fid, fn, cs, hex, reg, type, from, to, t0, t1 }
  const done = [];            // finished, not written yet
  const cs = new Map();       // callsign -> { fn, at }
  const stats = { seen: 0, flights: 0, written: 0, lines: 0, queries: 0, csAsked: 0, pruned: 0, err: '', sched: 0, schedWritten: 0, schedAsked: 0 };
  const sch = new Map();      // fid -> { fn, fid, cs, std, sta, from, to } of flights not over yet (twelve hours after)
  const schWrote = new Map(); // fid -> what was written of it, the last nine days (one seen again unchanged: not again)
  function observe(list, nowS) {
    nowS = fin(nowS) ? nowS : Date.now() / 1000;
    for (const f of list || []) {
      if (!f || !(f.id > 0)) continue;
      const fn = normFn(f.fn), c = String(f.cs || '').toUpperCase().trim();
      // (a callsign's flight number: an airline's callsign, its flight number not the callsign itself)
      if (fn && FN_RE.test(fn) && CS_RE.test(c) && fn !== c) { const o = cs.get(c); if (!o || o.fn !== fn || nowS - o.at > 3600) cs.set(c, { fn, at: nowS }); }
      if (!fn || !FN_RE.test(fn)) continue;
      stats.seen++;
      const t = fin(f.ts) && f.ts > 1e9 ? Math.min(f.ts, nowS + 60) : nowS, fid = Number(f.id).toString(16);
      let x = open.get(fid);
      if (!x) { x = { fid, fn, cs: '', hex: '', reg: '', type: '', from: '', to: '', t0: 0, t1: 0, seen: t }; open.set(fid, x); stats.flights++; }
      // (its times: when it was seen in the air - first and last - not taxiing: the scans of busy airports see it on
      // the ground too)
      x.fn = fn; if (t > x.seen) x.seen = t;
      if (!f.gnd) { if (!x.t0 || t < x.t0) x.t0 = t; if (t > x.t1) x.t1 = t; }
      if (c) x.cs = tidy(c, 10);
      if (/^[0-9a-f]{6}$/i.test(f.hex || '')) x.hex = f.hex.toLowerCase();
      if (f.reg) x.reg = tidy(f.reg, 12); if (f.type) x.type = tidy(f.type, 6);
      const fr = String(f.from || '').toUpperCase(), to = String(f.to || '').toUpperCase();
      if (IATA_RE.test(fr)) x.from = fr; if (IATA_RE.test(to)) x.to = to;
    }
    // (not seen for 45 minutes: over - to be written)
    for (const [fid, x] of open) if (nowS - (x.seen || x.t1) > closeS) { open.delete(fid); if (x.t0 > 0 && x.t1 - x.t0 >= 120) done.push(x); }
  }
  const lineOf = x => [x.fn, x.fid, x.cs, x.hex, x.reg, x.type, x.from, x.to, Math.round(x.t0), Math.round(x.t1)].join('\t');
  // (a flight being followed, as kept over a restart: when it was last seen at all as well)
  const openLine = x => lineOf(x) + '\t' + Math.round(x.seen || x.t1);
  function rowOf(l) {
    const p = l.split('\t'); if (p.length < 10) return null;
    const t0 = +p[8], t1 = +p[9]; if (!fin(t0) || !fin(t1)) return null;
    return { fn: p[0], fid: p[1], cs: p[2], hex: p[3], reg: p[4], type: p[5], from: p[6], to: p[7], t0, t1, seen: +p[10] || t1 };
  }
  // (the finished flights written, each to its month's file of its flight number)
  function flush() {
    if (!dir || !done.length) return 0;
    const by = new Map();
    for (const x of done.splice(0)) { const k = path.join(monthOf(x.t0), bucketOf(x.fn) + '.txt'); let a = by.get(k); if (!a) by.set(k, a = []); a.push(lineOf(x)); }
    let n = 0;
    for (const [k, lines] of by) {
      try { const f = path.join(dir, k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, lines.join('\n') + '\n'); n += lines.length; }
      catch (e) { stats.err = String(e && e.message || e).slice(0, 160); log(stats.err); }
    }
    stats.written += n; return n;
  }
  // A flight number's flights from `from` to `to` (seconds): the months' files, the ones not written yet and those still
  // being followed - each FR24 id once, newest first, 1000 at most (a year of a number flown twice a day; 1.4.3)
  async function query(fnIn, from, to) {
    const fn = normFn(fnIn); stats.queries++; if (!fn || !FN_RE.test(fn)) return [];
    const nowS = Date.now() / 1000; to = fin(to) && to > 0 ? Math.min(to, nowS + 86400) : nowS; from = fin(from) && from > 0 ? from : to - keepDays * 86400;
    from = Math.max(from, to - (keepDays + 31) * 86400); if (!(to > from)) return [];
    const by = new Map(), take = x => { if (x && x.fn === fn && x.t0 > 0 && x.t1 >= from && x.t0 <= to) { const o = by.get(x.fid); if (!o || x.t1 > o.t1) by.set(x.fid, Object.assign({}, x)); } };
    if (dir) {
      const months = []; for (let t = Math.floor(from / 86400) * 86400; t <= to + 86400; t += 86400) { const m = monthOf(t); if (!months.includes(m)) months.push(m); }
      // (a flight that began late the month before)
      const before = monthOf(from - 86400); if (!months.includes(before)) months.unshift(before);
      const b = bucketOf(fn);
      for (const m of months) {
        let txt = ''; try { txt = await fs.promises.readFile(path.join(dir, m, b + '.txt'), 'utf8'); } catch (e) { continue; }
        for (const l of txt.split('\n')) { if (!l.startsWith(fn + '\t')) continue; take(rowOf(l)); }
      }
    }
    for (const x of done) take(x);
    for (const x of open.values()) take(x);
    return [...by.values()].sort((a, b) => b.t0 - a.t0).slice(0, 1000);
  }
  function noteCs(c0, fn0, t, weak) {
    const fn = normFn(fn0), c = String(c0 || '').toUpperCase().trim(), nowS = Date.now() / 1000;
    if (!fn || !FN_RE.test(fn) || !CS_RE.test(c) || fn === c) return false;
    const at = fin(t) && t > 1e9 ? Math.min(t, nowS) : nowS, o = cs.get(c);
    if (o && (o.at > at || (weak && o.fn !== fn && at - o.at < 3 * 86400))) return false;
    if (o && o.fn === fn && at - o.at < 3600) return false;
    cs.set(c, { fn, at }); stats.csNoted = (stats.csNoted || 0) + 1; return true;
  }
  // ---- (1.4.3) FR24's scheduled times, by FR24's id -----------------------------------------------------------------
  const schLine = x => [x.fn, x.fid, x.cs, Math.round(x.std || 0), Math.round(x.sta || 0), x.from || 0, x.to || 0].join('\t');
  function schRow(l) {
    const p = l.split('\t'); if (p.length < 7 || !/^[0-9a-f]{1,12}$/.test(p[1])) return null;
    const std = +p[3] || 0, sta = +p[4] || 0; if (!(std > 1e9 || sta > 1e9)) return null;
    return { fn: p[0], fid: p[1], cs: p[2], std, sta, from: +p[5] || 0, to: +p[6] || 0 };
  }
  // (a board's row - cleaned, boards.cjs cleanRow - at airport apId, 'departures' or 'arrivals': only FR24's own
  // scheduled time (sx), of a flight with FR24's id and a flight number)
  function noteSched(r, apId, kind) {
    if (!r || r.sx !== 1 || !/^[0-9a-f]{1,12}$/.test(String(r.fid || '')) || !(apId > 0) || !fin(r.sch) || r.sch < 1e9) return false;
    const fn = normFn(r.num); if (!fn || !FN_RE.test(fn)) return false;
    const dep = kind === 'departures'; if (!dep && kind !== 'arrivals') return false;
    let x = sch.get(r.fid);
    if (!x) { x = { fn, fid: r.fid, cs: '', std: 0, sta: 0, from: 0, to: 0 }; const w = schWrote.get(r.fid); if (w) { const o = schRow(w); if (o) Object.assign(x, o); } }
    const was = schLine(x);
    x.fn = fn; if (CS_RE.test(String(r.cs || '').toUpperCase())) x.cs = String(r.cs).toUpperCase();
    if (dep) { x.std = Math.round(r.sch); x.from = apId; if (r.ap > 0) x.to = r.ap; } else { x.sta = Math.round(r.sch); x.to = apId; if (r.ap > 0) x.from = r.ap; }
    // (nothing new of it - held, or written as it is: left so)
    if (schLine(x) === was) return false;
    sch.set(r.fid, x); stats.sched++;
    if (sch.size > 200000) schFlush(Infinity);
    return true;
  }
  // (those over - twelve hours after their scheduled arrival, else departure - written, each to its month's file)
  function schFlush(nowS) {
    if (!dir || !sch.size) return 0;
    const all = nowS === Infinity; nowS = fin(nowS) ? nowS : Date.now() / 1000;
    const by = new Map();
    for (const [fid, x] of sch) {
      const t = x.sta || x.std; if (!(all || t < nowS - 12 * 3600)) continue;
      sch.delete(fid);
      const k = path.join(monthOf(x.std || x.sta), 'S' + bucketOf(x.fn) + '.txt'), l = schLine(x); let a = by.get(k); if (!a) by.set(k, a = []); a.push(l);
      schWrote.set(fid, l);
    }
    let n = 0;
    for (const [k, lines] of by) {
      try { const f = path.join(dir, k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, lines.join('\n') + '\n'); n += lines.length; }
      catch (e) { stats.err = String(e && e.message || e).slice(0, 160); log(stats.err); }
    }
    // (what was written, nine days: the boards keep eight)
    if (schWrote.size > 60000) for (const [fid, l] of schWrote) { const o = schRow(l); if (!o || (o.sta || o.std) < nowS - 9 * 86400) schWrote.delete(fid); }
    stats.schedWritten += n; return n;
  }
  // FR24's scheduled times of flight numbers' flights from `from` to `to` (s), by FR24's id (the last written wins)
  async function sched(fns, from, to) {
    const want = new Set((fns || []).map(normFn).filter(f => f && FN_RE.test(f))); stats.schedAsked++;
    if (!want.size) return [];
    const nowS = Date.now() / 1000; to = fin(to) && to > 0 ? Math.min(to, nowS + 86400) : nowS; from = fin(from) && from > 0 ? from : to - keepDays * 86400;
    from = Math.max(from, to - (keepDays + 31) * 86400); if (!(to > from)) return [];
    const by = new Map(), take = x => { if (x && want.has(x.fn) && (x.std || x.sta) >= from - 86400 && (x.std || x.sta) <= to + 86400) by.set(x.fid, Object.assign({}, x)); };
    if (dir) {
      const months = []; for (let t = Math.floor(from / 86400) * 86400 - 86400; t <= to + 86400; t += 86400) { const m = monthOf(t); if (!months.includes(m)) months.push(m); }
      const bs = [...new Set([...want].map(bucketOf))];
      for (const m of months) for (const b of bs) {
        let txt = ''; try { txt = await fs.promises.readFile(path.join(dir, m, 'S' + b + '.txt'), 'utf8'); } catch (e) { continue; }
        for (const l of txt.split('\n')) if (l) take(schRow(l));
      }
    }
    for (const x of sch.values()) take(x);
    return [...by.values()].sort((a, b) => (b.std || b.sta) - (a.std || a.sta)).slice(0, 5000);
  }
  // (flights - { fid, fn, t0, t1, fromId, toId } - each given FR24's std and sta where kept: by FR24's id, else the
  // number's scheduled flight nearest its time (three hours at most) whose airports are not other than the flight's)
  function schedMatch(list, kept) {
    const byFid = new Map(kept.map(x => [x.fid, x])), used = new Set();
    for (const f of list || []) {
      let s = f.fid ? byFid.get(String(f.fid)) : null;
      if (!s) {
        let best = null, bd = 3 * 3600 + 1;
        for (const x of kept) {
          if (x.fn !== normFn(f.fn) || used.has(x.fid)) continue;
          if ((x.from && f.fromId && x.from !== f.fromId) || (x.to && f.toId && x.to !== f.toId)) continue;
          const d = x.std && f.t0 ? Math.abs(x.std - f.t0) : x.sta && f.t1 ? Math.abs(x.sta - f.t1) : Infinity;
          if (d < bd) { bd = d; best = x; }
        }
        s = best;
      }
      if (s) { used.add(s.fid); if (s.std) f.std = s.std; if (s.sta) f.sta = s.sta; }
    }
    return list;
  }
  async function schedFor(list, from, to) { const fns = [...new Set((list || []).map(f => normFn(f && f.fn)).filter(Boolean))]; if (!fns.length) return list; return schedMatch(list, await sched(fns, from, to)); }
  // (1.4.2) the callsigns FR24 has shown for a flight number - its flights before this index began are found by them in
  // the world log (monitor.cjs fnWorldRows)
  function csOf(fnIn) { const fn = normFn(fnIn), out = []; if (!fn) return out; for (const [c, o] of cs) if (o.fn === fn) out.push(c); return out; }
  function csFn(list) {
    const out = {}; stats.csAsked++;
    for (const c0 of list || []) { const c = String(c0 || '').toUpperCase().trim(), o = cs.get(c); if (o) out[c] = o.fn; }
    return out;
  }
  // (months older than keepDays: gone whole; callsigns not seen for a year: forgotten)
  function prune(nowS) {
    nowS = fin(nowS) ? nowS : Date.now() / 1000;
    for (const [c, o] of cs) if (nowS - o.at > csKeepS) cs.delete(c);
    if (!dir) return 0;
    let n = 0, ms = []; try { ms = fs.readdirSync(dir).filter(m => /^\d{4}-\d\d$/.test(m)); } catch (e) { return 0; }
    for (const m of ms) {
      const [y, mo] = m.split('-').map(Number), end = Date.UTC(y, mo, 1) / 1000;
      if (end < nowS - keepDays * 86400) { try { fs.rmSync(path.join(dir, m), { recursive: true, force: true }); n++; } catch (e) { stats.err = String(e && e.message || e).slice(0, 160); } }
    }
    stats.pruned += n; return n;
  }
  function save(nowS) {
    if (!dir) return false;
    try {
      flush(); schFlush(nowS);
      const j = { v: ST_V, at: Math.round(fin(nowS) ? nowS : Date.now() / 1000), cs: [...cs].map(([c, o]) => [c, o.fn, Math.round(o.at)]), open: [...open.values()].map(openLine), sch: [...sch.values()].map(schLine), wrote: [...schWrote.values()] };
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, 'state.json.gz'), tmp = f + '.tmp';
      fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(j)))); fs.renameSync(tmp, f);
      return true;
    } catch (e) { stats.err = String(e && e.message || e).slice(0, 160); log(stats.err); return false; }
  }
  function load(nowS) {
    if (!dir) return 0;
    const f = path.join(dir, 'state.json.gz'); if (!fs.existsSync(f)) return 0;
    try {
      const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
      if (!j || j.v !== ST_V) return 0;
      nowS = fin(nowS) ? nowS : Date.now() / 1000;
      for (const r of Array.isArray(j.cs) ? j.cs : []) if (Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string' && fin(r[2]) && nowS - r[2] <= csKeepS) cs.set(r[0], { fn: r[1], at: r[2] });
      for (const l of Array.isArray(j.open) ? j.open : []) { const x = typeof l === 'string' ? rowOf(l) : null; if (x && /^[0-9a-f]{1,12}$/.test(x.fid)) open.set(x.fid, x); }
      for (const l of Array.isArray(j.sch) ? j.sch : []) { const x = typeof l === 'string' ? schRow(l) : null; if (x) sch.set(x.fid, x); }
      for (const l of Array.isArray(j.wrote) ? j.wrote : []) { const x = typeof l === 'string' ? schRow(l) : null; if (x) schWrote.set(x.fid, l); }
      // (those over while the monitor was off: written as they were)
      observe([], nowS);
      return cs.size + open.size + sch.size;
    } catch (e) { stats.err = String(e && e.message || e).slice(0, 160); log(stats.err); return 0; }
  }
  return { observe, flush, query, csFn, csOf, noteCs, noteSched, schFlush, sched, schedMatch, schedFor, prune, save, load, stats, get open() { return open.size; }, get callsigns() { return cs.size; }, get scheduled() { return sch.size; } };
}

module.exports = { createFnIndex, bucketOf, normFn };
