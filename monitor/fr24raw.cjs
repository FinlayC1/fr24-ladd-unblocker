// (1.2.4) Every position the monitor gets from FR24, exactly as it came - kept 730 days. tracks.cjs keeps every blocked
// aircraft's path thinned (a point a minute, altitudes to the hundred feet, no speed or heading: what naming a playback
// needs); this keeps FR24's own: each point of a flight's FR24 trail and of the monitor's FR24 scans, and of the trails
// the browsers send (central.cjs), with every figure it came with - by FR24's id of the flight.
//   STORE/fr24raw/YYYY-MM-DD.gzl  gzip members one after another, each time the points gathered are written a member
//                                 for every 64 flights (a member: { "<fid hex>": { m: { hex, reg, cs, type, fn }, p: [[...], ...] }, ... })
//   STORE/fr24raw/YYYY-MM-DD.idx  a line for each flight in each member: "<fid hex> <offset> <length>"
// A point is a list in the order of COLS (a figure not given null; those at the end left off). Points are gathered as
// they come and written every quarter of an hour (and on stop), each second of a flight once; a member goes in the file
// of the day it is written. Held in memory: the points not written yet, the times written of the flights of the last day
// and a half (none after a start: a flight's points sent again then are in two members - read once), and the index of
// the few days last read.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const fin = v => typeof v === 'number' && isFinite(v);
const COLS = ['t', 'lat', 'lon', 'alt', 'gs', 'trk', 'vr', 'sq', 'gnd', 'altGeom', 'ias', 'tas', 'hdg', 'mcp', 'fms', 'ws', 'wd'];
const GROUP = 64;

function createFr24Raw(env) {
  const dir = path.join(env.store, 'fr24raw'), keepDays = env.keepDays || 730, holdS = env.holdS || 36 * 3600;
  const stats = { put: 0, points: 0, written: 0, members: 0, flights: 0, read: 0, pruned: 0, err: '' };
  const pend = new Map();     // fid -> { m: meta, p: Map(t -> point) }
  const done = new Map();     // fid -> { ts: the times written, in order (numbers: a third of a Set's memory), at: when last written }
  const idxs = new Map();     // day -> { spans: [[offset, length]], by: Map(fid -> [span number]), used }
  const fileOf = (d, ext) => path.join(dir, d + ext);
  const fidOf = id => typeof id === 'number' && id > 0 ? id.toString(16) : /^[0-9a-f]{1,12}$/i.test(String(id || '')) ? String(id).toLowerCase() : '';
  // (a point as kept: the figures FR24 gave, as given - the time to the second)
  function row(p) {
    if (!p || typeof p !== 'object' || !fin(p.t) || !fin(p.lat) || !fin(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
    const r = COLS.map(k => k === 't' ? Math.round(p.t) : k === 'gnd' ? (typeof p.gnd === 'boolean' ? (p.gnd ? 1 : 0) : null) : k === 'sq' ? (typeof p.sq === 'string' && /^[0-7]{4}$/.test(p.sq) ? p.sq : null) : fin(p[k]) ? p[k] : null);
    while (r.length > 3 && r[r.length - 1] === null) r.pop();
    return r;
  }
  const filled = r => r.reduce((n, v) => n + (v === null ? 0 : 1), 0);
  // (in a list of times in order: there? - and two such lists made one, each time once)
  const has = (ts, t) => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; } return lo < ts.length && ts[lo] === t; };
  function merge(a, b) { const out = []; let i = 0, j = 0; while (i < a.length || j < b.length) { const v = j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++]; if (out[out.length - 1] !== v) out.push(v); } return out; }
  function cleanMeta(m) { const o = {}; for (const k of ['hex', 'reg', 'cs', 'type', 'fn']) if (m && typeof m[k] === 'string' && m[k]) o[k] = m[k].slice(0, 16); return o; }
  // a flight's points (any order, any number) and what it is - added to those to be written
  function put(id, meta, pts) {
    const fid = fidOf(id); if (!fid || !Array.isArray(pts) || !pts.length) return 0;
    const dn = done.get(fid); let e = pend.get(fid), n = 0;
    for (const p of pts) {
      const r = row(p); if (!r || (dn && has(dn.ts, r[0]))) continue;
      if (!e) { e = { m: {}, p: new Map() }; pend.set(fid, e); }
      // (two reports of the same second: the one with more figures)
      const o = e.p.get(r[0]); if (o && filled(o) >= filled(r)) continue;
      if (!o) n++; e.p.set(r[0], r);
    }
    if (e) Object.assign(e.m, cleanMeta(meta));
    stats.put++; stats.points += n;
    return n;
  }
  // (a day's index: read once, kept for the last few days asked)
  function idxOf(d) {
    let x = idxs.get(d);
    if (!x) {
      x = { spans: [], by: new Map(), used: 0 }; const at = new Map();
      let txt = ''; try { txt = fs.readFileSync(fileOf(d, '.idx'), 'utf8'); } catch (e) { txt = ''; }
      for (const ln of txt.split('\n')) {
        const a = ln.split(' '); if (a.length !== 3 || !a[0]) continue;
        const k = a[1] + ' ' + a[2]; let i = at.get(k); if (i === undefined) { i = x.spans.length; x.spans.push([+a[1], +a[2]]); at.set(k, i); }
        (x.by.get(a[0]) || x.by.set(a[0], []).get(a[0])).push(i);
      }
      idxs.set(d, x);
      if (idxs.size > 4) { const old = [...idxs].sort((p, q) => p[1].used - q[1].used)[0]; if (old && old[0] !== d) idxs.delete(old[0]); }
    }
    x.used = Date.now();
    return x;
  }
  // every flight's points gathered: written - a member for every 64 flights (by id), so a flight is read back from a small
  // piece of the file, while the points of many flights together still pack small
  function flush(nowS) {
    nowS = nowS || Date.now() / 1000;
    const out = {}, fids = []; let n = 0;
    for (const [fid, e] of pend) {
      if (!e.p.size) continue;
      const p = [...e.p.values()].sort((a, b) => a[0] - b[0]); out[fid] = { m: e.m, p }; fids.push(fid); n += p.length;
    }
    pend.clear();
    for (const [fid, x] of done) if (nowS - x.at > holdS) done.delete(fid);
    if (!fids.length) return 0;
    fids.sort();
    const d = dayOf(nowS), bufs = [], lines = [];
    let off = 0; try { off = fs.statSync(fileOf(d, '.gzl')).size; } catch (e) { off = 0; }
    const start = off, spans = [];
    for (let i = 0; i < fids.length; i += GROUP) {
      const part = fids.slice(i, i + GROUP), o = {}; for (const f of part) o[f] = out[f];
      const buf = zlib.gzipSync(JSON.stringify(o), { level: 6 }); bufs.push(buf);
      for (const f of part) lines.push(f + ' ' + off + ' ' + buf.length);
      spans.push([off, buf.length, part]); off += buf.length;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(fileOf(d, '.gzl'), Buffer.concat(bufs));
      fs.appendFileSync(fileOf(d, '.idx'), lines.join('\n') + '\n');
      const x = idxs.get(d); if (x) for (const [o, l, part] of spans) { const i = x.spans.length; x.spans.push([o, l]); for (const f of part) (x.by.get(f) || x.by.set(f, []).get(f)).push(i); }
      for (const f of fids) { const dn = done.get(f); done.set(f, { ts: merge(dn ? dn.ts : [], out[f].p.map(r => r[0])), at: nowS }); }
      stats.members += spans.length; stats.flights += fids.length; stats.written += n; stats.bytes = (stats.bytes || 0) + (off - start);
    } catch (e) { stats.err = String(e && e.message || e).slice(0, 160); if (env.log) env.log('fr24raw', d, stats.err); return 0; }
    return fids.length;
  }
  // (one day's points of one flight: every member it is in, read - the last few members read kept)
  const memo = new Map();
  function readDay(d, fid) {
    const res = { m: {}, p: [] }, x = idxOf(d), nums = x.by.get(fid); if (!nums) return res;
    let fd = null;
    try {
      fd = fs.openSync(fileOf(d, '.gzl'), 'r');
      for (const i of nums) {
        const [off, len] = x.spans[i], key = d + ' ' + off; let o = memo.get(key);
        if (!o) {
          try { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); o = JSON.parse(zlib.gunzipSync(b).toString('utf8')); stats.read++; } catch (e) { o = {}; }
          memo.set(key, o); if (memo.size > 12) memo.delete(memo.keys().next().value);
        }
        const f = o[fid]; if (!f) continue;
        Object.assign(res.m, f.m || {}); for (const r of f.p || []) if (Array.isArray(r) && fin(r[0])) res.p.push(r);
      }
    } catch (e) { /* the day's file unreadable: none */ } finally { if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* closed */ } }
    return res;
  }
  // A flight's FR24 points around moment t (the files of the day before to two days after, and the points not written
  // yet) - { fid, m: what it is, cols: COLS, p: the points in time order, each second once (the one with more figures) }
  function of(id, t) {
    const fid = fidOf(id); if (!fid) return null;
    t = fin(t) && t > 0 ? t : Date.now() / 1000;
    const m = {}, by = new Map(), add = r => { const o = by.get(r[0]); if (!o || filled(r) > filled(o)) by.set(r[0], r); };
    for (const d of [...new Set([dayOf(t - 86400), dayOf(t), dayOf(t + 86400), dayOf(t + 2 * 86400)])]) { const r = readDay(d, fid); Object.assign(m, r.m); r.p.forEach(add); }
    const e = pend.get(fid); if (e) { Object.assign(m, e.m); for (const r of e.p.values()) add(r); }
    if (!by.size) return null;
    return { fid, m, cols: COLS, p: [...by.values()].sort((a, b) => a[0] - b[0]) };
  }
  // (the days older than those kept: removed)
  function prune(nowS) {
    const cut = dayOf((nowS || Date.now() / 1000) - keepDays * 86400);
    let names = []; try { names = fs.readdirSync(dir); } catch (e) { return 0; }
    let n = 0;
    for (const f of names) { const mt = /^(\d{4}-\d\d-\d\d)\.(gzl|idx)$/.exec(f); if (mt && mt[1] < cut) { try { fs.unlinkSync(path.join(dir, f)); idxs.delete(mt[1]); n++; } catch (e) { /* gone */ } } }
    stats.pruned += n;
    return n;
  }
  // (the disk short of room: the points gathered let go, counted - nothing written is touched)
  function drop() { let n = 0; for (const e of pend.values()) n += e.p.size; pend.clear(); stats.skipped = (stats.skipped || 0) + n; return n; }
  return { put, flush, drop, of, prune, stats, COLS, get pending() { let n = 0; for (const e of pend.values()) n += e.p.size; return n; }, get held() { return done.size; } };
}
module.exports = { createFr24Raw, COLS };
