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
  const keepDays = env.keepDays || 100, closeS = env.closeS || 45 * 60, csKeepS = 365 * 86400;
  const open = new Map();     // fid -> { fid, fn, cs, hex, reg, type, from, to, t0, t1 }
  const done = [];            // finished, not written yet
  const cs = new Map();       // callsign -> { fn, at }
  const stats = { seen: 0, flights: 0, written: 0, lines: 0, queries: 0, csAsked: 0, pruned: 0, err: '' };
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
  // being followed - each FR24 id once, newest first, 400 at most
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
    return [...by.values()].sort((a, b) => b.t0 - a.t0).slice(0, 400);
  }
  function noteCs(c0, fn0, t, weak) {
    const fn = normFn(fn0), c = String(c0 || '').toUpperCase().trim(), nowS = Date.now() / 1000;
    if (!fn || !FN_RE.test(fn) || !CS_RE.test(c) || fn === c) return false;
    const at = fin(t) && t > 1e9 ? Math.min(t, nowS) : nowS, o = cs.get(c);
    if (o && (o.at > at || (weak && o.fn !== fn && at - o.at < 3 * 86400))) return false;
    if (o && o.fn === fn && at - o.at < 3600) return false;
    cs.set(c, { fn, at }); stats.csNoted = (stats.csNoted || 0) + 1; return true;
  }
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
      flush();
      const j = { v: ST_V, at: Math.round(fin(nowS) ? nowS : Date.now() / 1000), cs: [...cs].map(([c, o]) => [c, o.fn, Math.round(o.at)]), open: [...open.values()].map(openLine) };
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
      // (those over while the monitor was off: written as they were)
      observe([], nowS);
      return cs.size + open.size;
    } catch (e) { stats.err = String(e && e.message || e).slice(0, 160); log(stats.err); return 0; }
  }
  return { observe, flush, query, csFn, csOf, noteCs, prune, save, load, stats, get open() { return open.size; }, get callsigns() { return cs.size; } };
}

module.exports = { createFnIndex, bucketOf, normFn };
