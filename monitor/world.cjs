'use strict';
// The world log: every aircraft's flights of every day - built from adsb.lol's day archive as it is read (archive.cjs: the
// whole day, every aircraft adsb.lol heard - 68,294 on 21 Oct 2026, 193,182 flights), through the same engine as the
// aircraft logs (legsFromPoints, summarizeLeg), and kept for good: one file a day, STORE/world/<day>.wl, never deleted.
// What it gives: any aircraft's flights of any day kept, at once - its log page, its history for the destination engine -
// without a request to a network that walls browsers.
//
// A day's file: [4 bytes: header length][header JSON: { v, day, n, nb, legs, at }][nb records of 12 bytes: uint32 first
// address of the block, uint32 where the block begins (after the records), uint32 its length][the blocks]: each block 32
// aircraft by address, gzipped lines "<hex>\t<JSON of its flights>\n" - (1.1.0) "...\t<JSON [type, registration, adsb.lol's
// dbFlags, ADS-B category]>" after them in a day built from 1.1.0 on: what kind of aircraft flew them, for learning the
// population tables from every aircraft's flights. One aircraft's day: a binary search of the records
// (a record at a time, from disk - never the whole file in memory), one block read (~10 kB) and unzipped.
// ~17 MB a day; 366 days ~6 GB.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WORLD_V = 1, PER_BLOCK = 32, REC = 12;
const fin = v => typeof v === 'number' && isFinite(v);
const r2 = x => fin(x) ? Math.round(x * 100) / 100 : null;
const r4 = x => fin(x) ? Math.round(x * 1e4) / 1e4 : null;
const ri = x => fin(x) ? Math.round(x) : null;
const apE = a => a ? [a.id, a.code || '', a.conf || ''] : 0;
const apD = a => Array.isArray(a) ? { id: a[0], code: a[1], conf: a[2] } : null;

// A flight (summarizeLeg's) in a row, and back - the fields the logs and the engine read of it
function encodeLeg(s) {
  const fl = (s.startedOnGround ? 1 : 0) | (s.ended ? 2 : 0) | (s.tOnEst ? 4 : 0) | (s.tOffEst ? 8 : 0);
  return [r2(s.tStart), r2(s.tEnd - s.tStart), r4(s.startLat), r4(s.startLon), ri(s.startAlt), r4(s.endLat), r4(s.endLon), ri(s.endAlt), ri(s.endTrk), ri(s.endGs), ri(s.startGs), fl,
    s.how || 0, ri(s.maxAlt) || 0, s.cs || '', ri(s.pathKm) || 0, apE(s.from), apE(s.to), s.laps || 0, s.path || 0, fin(s.tOn) ? r2(s.tOn - s.tEnd) : null, fin(s.tOff) ? r2(s.tOff - s.tStart) : null, ri(s.startTrk)];
}
function decodeLeg(a, day) {
  const tStart = a[0], tEnd = r2(a[0] + a[1]), o = { endRules: 2, tStart, tEnd, startLat: a[2], startLon: a[3], startAlt: a[4], endLat: a[5], endLon: a[6], endAlt: a[7], endTrk: a[8], endGs: a[9], startGs: a[10],
    startedOnGround: !!(a[11] & 1), ended: !!(a[11] & 2) };
  if (a[12]) o.how = a[12];
  Object.assign(o, { maxAlt: a[13], cs: a[14], pathKm: a[15], from: apD(a[16]), to: apD(a[17]), laps: a[18] || 0, path: a[19] || null,
    tOn: fin(a[20]) ? r2(tEnd + a[20]) : null, tOnEst: !!(a[11] & 4), tOff: fin(a[21]) ? r2(tStart + a[21]) : null, tOffEst: !!(a[11] & 8), startTrk: fin(a[22]) ? a[22] : null });
  if (day) o.day = day;
  return o;
}

function createWorld(dir) {
  const fileOf = d => path.join(dir, d + '.wl');
  const days = new Map();   // day -> its header ({ v, day, n, nb, legs, at, len })
  const stats = { days: 0, built: 0, lookups: 0, ms: 0, bytes: 0, last: null, err: '' };
  function readHead(fd) {
    const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); const len = b.readUInt32LE(0);
    if (!(len > 0 && len < 1e6)) throw new Error('not a world day');
    const h = Buffer.alloc(len); fs.readSync(fd, h, 0, len, 4);
    return Object.assign(JSON.parse(h.toString('utf8')), { len });
  }
  function scan() {
    days.clear(); stats.bytes = 0;
    let fl = []; try { fl = fs.readdirSync(dir); } catch (e) { return; }
    for (const f of fl) {
      const m = /^(\d{4}-\d\d-\d\d)\.wl$/.exec(f); if (!m) continue;
      let fd; try { fd = fs.openSync(path.join(dir, f), 'r'); const h = readHead(fd); if (h.day === m[1]) { days.set(m[1], h); stats.bytes += fs.fstatSync(fd).size; } } catch (e) { /* half written: built again */ } finally { if (fd != null) fs.closeSync(fd); }
    }
    stats.days = days.size;
  }
  scan();
  const has = (d, v) => days.has(d) && (days.get(d).v || 0) >= (v || 0);

  // A day being written: each aircraft's row as it comes (the archive's order - by the last two hex digits), to a file
  // beside it; sorted by address and cut into blocks at the end. In memory meanwhile: an address and two numbers per
  // aircraft (the 1 GB VM)
  function writer(day) {
    fs.mkdirSync(dir, { recursive: true });
    const tmpRows = fileOf(day) + '.rows', tmp = fileOf(day) + '.tmp', list = [];
    let fd = fs.openSync(tmpRows, 'w'), pos = 0, legs = 0;
    const close = () => { if (fd != null) { try { fs.closeSync(fd); } catch (e) { /* closed */ } fd = null; } };
    return {
      add(hex, sums, ac) {
        const info = Array.isArray(ac) ? '\t' + JSON.stringify([String(ac[0] || '').slice(0, 8), String(ac[1] || '').slice(0, 12), ac[2] | 0, String(ac[3] || '').slice(0, 4)]) : '';
        const b = Buffer.from(hex + '\t' + JSON.stringify((sums || []).map(encodeLeg)) + info + '\n', 'utf8');
        fs.writeSync(fd, b, 0, b.length, pos); list.push([parseInt(hex, 16), pos, b.length]); pos += b.length; legs += (sums || []).length;
      },
      get n() { return list.length; },
      finish() {
        close(); list.sort((a, b) => a[0] - b[0]);
        const rfd = fs.openSync(tmpRows, 'r'), blocks = [], recs = [];
        let off = 0;
        try {
          for (let i = 0; i < list.length; i += PER_BLOCK) {
            const part = list.slice(i, i + PER_BLOCK), bufs = [];
            for (const [, at, size] of part) { const b = Buffer.alloc(size); fs.readSync(rfd, b, 0, size, at); bufs.push(b); }
            const z = zlib.gzipSync(Buffer.concat(bufs), { level: 6 });
            recs.push([part[0][0], off, z.length]); blocks.push(z); off += z.length;
          }
        } finally { fs.closeSync(rfd); }
        const head = Buffer.from(JSON.stringify({ v: WORLD_V, day, n: list.length, nb: recs.length, legs, at: Date.now() }), 'utf8');
        const pre = Buffer.alloc(4 + head.length + recs.length * REC);
        pre.writeUInt32LE(head.length, 0); head.copy(pre, 4);
        let o = 4 + head.length; for (const [h, a, l] of recs) { pre.writeUInt32LE(h, o); pre.writeUInt32LE(a, o + 4); pre.writeUInt32LE(l, o + 8); o += REC; }
        const wfd = fs.openSync(tmp, 'w');
        try { fs.writeSync(wfd, pre); for (const z of blocks) fs.writeSync(wfd, z); fs.fsyncSync(wfd); } finally { fs.closeSync(wfd); }
        const was = fs.existsSync(fileOf(day)) ? fs.statSync(fileOf(day)).size : 0;
        fs.renameSync(tmp, fileOf(day)); try { fs.unlinkSync(tmpRows); } catch (e) { /* gone */ }
        const h = { v: WORLD_V, day, n: list.length, nb: recs.length, legs, at: Date.now(), len: head.length };
        days.set(day, h); stats.days = days.size; stats.built++; stats.bytes += pre.length + off - was; stats.last = { day, n: list.length, legs, mb: +((pre.length + off) / 1e6).toFixed(1) };
        return h;
      },
      abort() { close(); for (const f of [tmpRows, tmp]) try { fs.unlinkSync(f); } catch (e) { /* none */ } }
    };
  }

  // One aircraft's flights of a day: [] none (heard, did not fly), null not in that day's file (adsb.lol heard nothing of
  // it), undefined no file of that day
  function lookup(day, hex) {
    const h = days.get(day); if (!h) return undefined;
    const t0 = Date.now(), want = parseInt(hex, 16); stats.lookups++;
    let fd; try { fd = fs.openSync(fileOf(day), 'r'); } catch (e) { days.delete(day); stats.days = days.size; return undefined; }
    try {
      const base = 4 + h.len, r = Buffer.alloc(REC);
      let lo = 0, hi = h.nb - 1, at = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; fs.readSync(fd, r, 0, REC, base + mid * REC); if (r.readUInt32LE(0) <= want) { at = mid; lo = mid + 1; } else hi = mid - 1; }
      if (at < 0) return null;
      fs.readSync(fd, r, 0, REC, base + at * REC);
      const off = r.readUInt32LE(4), len = r.readUInt32LE(8), z = Buffer.alloc(len);
      fs.readSync(fd, z, 0, len, base + h.nb * REC + off);
      const txt = zlib.gunzipSync(z).toString('utf8'), key = String(hex).toLowerCase() + '\t';
      const i = txt.startsWith(key) ? 0 : txt.indexOf('\n' + key) + 1;
      if (i <= 0 && !txt.startsWith(key)) return null;
      const line = txt.slice(i + key.length, txt.indexOf('\n', i)), tab = line.indexOf('\t');
      return JSON.parse(tab < 0 ? line : line.slice(0, tab)).map(a => decodeLeg(a, day.replace(/-/g, '/')));
    } finally { fs.closeSync(fd); stats.ms += Date.now() - t0; }
  }
  // (1.0.2) Every aircraft's flights of a day, block by block: cb(hex, legs, ac) for each - ac: { type, reg, flags, cat }
  // in a day built from 1.1.0 on, else null; breath() awaited between blocks
  async function each(day, cb, breath) {
    const h = days.get(day); if (!h) return 0;
    let fd; try { fd = fs.openSync(fileOf(day), 'r'); } catch (e) { days.delete(day); stats.days = days.size; return 0; }
    let n = 0;
    try {
      const base = 4 + h.len, recs = Buffer.alloc(h.nb * REC); fs.readSync(fd, recs, 0, recs.length, base);
      for (let k = 0; k < h.nb; k++) {
        const off = recs.readUInt32LE(k * REC + 4), len = recs.readUInt32LE(k * REC + 8), z = Buffer.alloc(len);
        fs.readSync(fd, z, 0, len, base + h.nb * REC + off);
        for (const line of zlib.gunzipSync(z).toString('utf8').split('\n')) {
          const i = line.indexOf('\t'); if (i < 0) continue;
          const j = line.indexOf('\t', i + 1), x = j < 0 ? null : JSON.parse(line.slice(j + 1));
          cb(line.slice(0, i), JSON.parse(line.slice(i + 1, j < 0 ? undefined : j)).map(a => decodeLeg(a, day.replace(/-/g, '/'))), Array.isArray(x) ? { type: x[0], reg: x[1], flags: x[2], cat: x[3] } : null); n++;
        }
        if (breath) await breath();
      }
    } finally { fs.closeSync(fd); }
    return n;
  }
  return { dir, days, has, writer, lookup, each, scan, stats, fileOf };
}

// Free space where the store is, in bytes (Infinity: not known)
function freeBytes(dir) {
  try { if (fs.statfsSync) { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } } catch (e) { /* below */ }
  try { const out = require('child_process').execFileSync('df', ['-Pk', dir], { encoding: 'utf8', timeout: 5000 }); const f = out.trim().split('\n').pop().split(/\s+/); return +f[3] * 1024; } catch (e) { return Infinity; }
}

module.exports = { createWorld, encodeLeg, decodeLeg, freeBytes, WORLD_V, PER_BLOCK };
