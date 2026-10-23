'use strict';
// adsb.lol's day archives (github.com/adsblol/globe_history_<year>, ODbL): every aircraft adsb.lol heard in a day, its
// whole day's trace - the same trace_full_<hex>.json its site serves - in one tar, cut into parts of ~1.9 GB
// (v2026.10.21-planes-readsb-prod-0.tar.aa, .ab, ...), published a few hours after the day ends. Read here as it
// downloads - never written to disk - and only the traces asked for kept: the blocked aircraft's (the monitor's own, and
// any the file itself flags LADD or PIA). adsb.lol's site now shows a server a verification page in front of its trace
// files; its archives are where it publishes them for bulk use.
// 21 Oct 2026: 3.8 GB, 79,986 traces, 3 minutes here.
const zlib = require('zlib');
const fs = require('fs');

const repoOf = day => `adsblol/globe_history_${day.slice(0, 4)}`;
const tagOf = (day, n) => `v${day.replace(/-/g, '.')}-planes-readsb-prod-${n}`;
const partName = i => '.tar.' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
const urlOf = (day, n, i) => `https://github.com/${repoOf(day)}/releases/download/${tagOf(day, n)}/${tagOf(day, n)}${partName(i)}`;

// A day's parts, in order: [] - not published (yet). Asked with a one-byte range request each (no API, no key).
async function partsOf(day, get) {
  for (let n = 0; n < 3; n++) {
    const out = [];
    for (let i = 0; i < 26; i++) {
      const u = urlOf(day, n, i), st = await get(u);
      if (st === 404) break;
      if (!(st >= 200 && st < 300)) throw new Error('archive ' + tagOf(day, n) + partName(i) + ': HTTP ' + st);
      out.push(u);
    }
    if (out.length) return out;
  }
  return [];
}

// The traces in a tar read as it comes in (chunks of any size, an entry across the parts' boundary): take(name, size)
// says whether an entry is wanted; each one wanted is handed whole to onEntry(name, buf) - awaited, so the download waits.
// onHeader(name, size, at) (optional): every file's name, size and where its bytes begin in the whole tar - the day's index.
function tarReader(take, onEntry, onHeader) {
  let head = Buffer.alloc(0), left = 0, pad = 0, cur = null, zeros = 0, entries = 0, base = 0;
  async function push(chunk) {
    let off = 0;
    try { await read(); } finally { base += chunk.length; }
    async function read() {
      while (off < chunk.length) {
        if (left > 0) {
          const n = Math.min(left, chunk.length - off);
          if (cur) cur.parts.push(chunk.subarray(off, off + n));
          off += n; left -= n;
          if (left === 0) { if (cur) { const c = cur; cur = null; await onEntry(c.name, Buffer.concat(c.parts)); } }
          continue;
        }
        if (pad > 0) { const n = Math.min(pad, chunk.length - off); off += n; pad -= n; continue; }
        const need = 512 - head.length, n = Math.min(need, chunk.length - off);
        head = Buffer.concat([head, chunk.subarray(off, off + n)]); off += n;
        if (head.length < 512) continue;
        const h = head; head = Buffer.alloc(0);
        if (h.every(b => b === 0)) { zeros++; continue; }
        zeros = 0;
        const str = (a, b) => h.subarray(a, b).toString('latin1').replace(/\0[\s\S]*$/, '');
        let name = str(0, 100); const prefix = h.subarray(257, 262).toString('latin1') === 'ustar' ? str(345, 500) : '';
        if (prefix) name = prefix + '/' + name;
        const size = parseInt(str(124, 136).trim() || '0', 8) || 0, type = String.fromCharCode(h[156] || 48);
        entries++;
        left = size; pad = (512 - (size % 512)) % 512;
        const file = type === '0' || type === '\0';
        if (file && onHeader) onHeader(name, size, base + off);
        cur = file && size > 0 && take(name, size) ? { name, parts: [] } : null;
        if (size === 0 && cur) { const c = cur; cur = null; await onEntry(c.name, Buffer.alloc(0)); }
      }
    }
  }
  return { push, get entries() { return entries; }, get done() { return zeros >= 2; }, get bytes() { return base; } };
}

// (a trace file's own fields - icao, r, t, dbFlags - from its first few kilobytes: they come before the trace)
function headOf(buf) {
  let txt;
  try { txt = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf.subarray(0, 6144), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8') : buf.subarray(0, 4096).toString('utf8'); } catch (e) { return null; }
  const m = (re, f) => { const x = re.exec(txt); return x ? f(x[1]) : undefined; };
  return { flags: m(/"dbFlags"\s*:\s*(\d+)/, Number) || 0, reg: m(/"r"\s*:\s*"([^"]*)"/, String) || '', type: m(/"t"\s*:\s*"([^"]*)"/, String) || '' };
}
function parseTrace(buf) {
  const txt = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  const j = JSON.parse(txt);
  if (!j || !Array.isArray(j.trace)) throw new Error('not a trace');
  return j;
}

// One day: every trace in the archive whose aircraft want(hex, head) takes, to onTrace(hex, json) - in the archive's
// order. opts.get(url) -> HTTP status of a one-byte request; opts.open(url) -> an async iterable of the part's bytes;
// opts.pace() (optional) - awaited every 200 traces, the ones not taken too: the download waits while it does.
// opts.index: the day's index made as it is read - where every aircraft's file is (st.index: { parts: [{ url, size }],
// list: [[hex as a number, where its bytes begin in the whole tar, size]] }), so one aircraft's file can later be fetched
// alone (a range of the part it is in); opts.indexOnly: the index and nothing else (no file read, none taken).
// -> { published: false } or { published: true, parts, entries, traces, taken, bad, ms, index? }
const TRACE_RE = /(?:^|\/)traces\/[0-9a-f]{2}\/trace_full_([0-9a-f]{6})\.json$/;
async function importDay(day, want, onTrace, opts) {
  const t0 = Date.now(), parts = await partsOf(day, opts.get);
  if (!parts.length) return { published: false };
  const st = { published: true, parts: parts.length, entries: 0, traces: 0, taken: 0, bad: 0, ms: 0 };
  const list = opts.index || opts.indexOnly ? [] : null;
  const onHeader = list ? (name, size, at) => { const m = TRACE_RE.exec(name); if (m) list.push([parseInt(m[1], 16), at, size]); } : null;
  let seen = 0;
  const rd = tarReader(name => !opts.indexOnly && TRACE_RE.test(name), async (name, buf) => {
    const hex = TRACE_RE.exec(name)[1]; st.traces++;
    if (opts.pace && st.traces % 200 === 0) await opts.pace();
    const hd = headOf(buf); if (!hd) { st.bad++; return; }
    if (!want(hex, hd)) return;
    let j; try { j = parseTrace(buf); } catch (e) { st.bad++; return; }
    st.taken++;
    await onTrace(hex, j);
  }, onHeader ? (name, size, at) => { onHeader(name, size, at); seen++; } : null);
  const sizes = [];
  for (const u of parts) {
    const b0 = rd.bytes;
    for await (const chunk of await opts.open(u)) {
      await rd.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      // (the index alone: paced as the files go by, none of them read)
      if (opts.indexOnly && opts.pace && seen >= 2000) { seen = 0; await opts.pace(); }
    }
    sizes.push(rd.bytes - b0);
  }
  st.entries = rd.entries; st.ms = Date.now() - t0;
  if (list) { st.traces = st.traces || list.length; list.sort((a, b) => a[0] - b[0]); st.index = { parts: parts.map((url, i) => ({ url, size: sizes[i] })), list }; }
  if (!rd.done && !st.traces) throw new Error('archive ' + day + ': no traces read');
  return st;
}

// ---- a day's index on disk: [4 bytes: header length][header JSON: { v, day, parts, n }][n records of 16 bytes, by
// address: uint32 address, float64 where its bytes begin, uint32 size] - looked up by binary search, a record at a time
// (never the whole index in memory: 80,000 aircraft a day)
const REC = 16;
function indexBuffer(day, index) {
  const head = Buffer.from(JSON.stringify({ v: 1, day, parts: index.parts, n: index.list.length }), 'utf8'), out = Buffer.alloc(4 + head.length + index.list.length * REC);
  out.writeUInt32LE(head.length, 0); head.copy(out, 4);
  let o = 4 + head.length;
  for (const [hex, at, size] of index.list) { out.writeUInt32LE(hex, o); out.writeDoubleLE(at, o + 4); out.writeUInt32LE(size, o + 12); o += REC; }
  return out;
}
// (one address in a day's index file: { at, size } or null; head: the file's header, read once by the caller)
function indexFind(fd, head, hexNum) {
  const base = 4 + head.len, b = Buffer.alloc(REC);
  let lo = 0, hi = head.n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1; fs.readSync(fd, b, 0, REC, base + mid * REC);
    const h = b.readUInt32LE(0);
    if (h === hexNum) return { at: b.readDoubleLE(4), size: b.readUInt32LE(12) };
    if (h < hexNum) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}
function indexHead(fd) {
  const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); const len = b.readUInt32LE(0);
  if (!(len > 0 && len < 1e6)) throw new Error('not an index');
  const h = Buffer.alloc(len); fs.readSync(fd, h, 0, len, 4);
  return Object.assign(JSON.parse(h.toString('utf8')), { len });
}
// (the parts - and where in each - a range of the whole tar is in: [{ url, from, to }] (to inclusive))
function rangesOf(parts, at, size) {
  const out = []; let p0 = 0;
  for (const p of parts) {
    const p1 = p0 + p.size, a = Math.max(at, p0), b = Math.min(at + size, p1);
    if (a < b) out.push({ url: p.url, from: a - p0, to: b - p0 - 1 });
    p0 = p1;
  }
  return out;
}

// (the real network: Node's fetch)
const UA = { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)' };
const netGet = async url => { const r = await fetch(url, { headers: Object.assign({ Range: 'bytes=0-0' }, UA), redirect: 'follow', signal: AbortSignal.timeout(60000) }); try { await r.arrayBuffer(); } catch (e) { /* small */ } return r.status; };
const netOpen = async url => { const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(3 * 3600e3) }); if (!r.ok) throw new Error('archive part: HTTP ' + r.status); return r.body; };
// One range of a part (bytes from..to, inclusive). GitHub's download address answers with a redirect to a signed one,
// good for minutes, that serves ranges: followed here (the range asked of each), and the signed one kept four minutes.
// The range is asked of the first address too - an answer of the whole part (1.9 GB) is never taken.
const signed = new Map();
const drain = async r => { try { await r.arrayBuffer(); } catch (e) { /* nothing to read */ } };
async function netRange(url, from, to) {
  const H = Object.assign({ Range: `bytes=${from}-${to}` }, UA), get = u => fetch(u, { headers: H, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const c = signed.get(url);
  let r = c && Date.now() - c.at < 240000 ? await get(c.u) : null;
  if (r && r.status !== 206) { await drain(r); r = null; signed.delete(url); }        // (its signature run out: anew)
  if (!r) {
    r = await get(url);
    for (let hop = 0; hop < 3 && r.status >= 300 && r.status < 400; hop++) {
      const l = r.headers.get('location'); await drain(r); if (!l) break;
      const u = new URL(l, url).href; signed.set(url, { u, at: Date.now() }); if (signed.size > 64) signed.delete(signed.keys().next().value);
      r = await get(u);
    }
  }
  if (r.status !== 206) { await drain(r); throw new Error('archive range: HTTP ' + r.status); }
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length !== to - from + 1) throw new Error('archive range: ' + b.length + ' bytes of ' + (to - from + 1));
  return b;
}

module.exports = { importDay, tarReader, headOf, partsOf, urlOf, tagOf, netGet, netOpen, netRange, indexBuffer, indexFind, indexHead, rangesOf, TRACE_RE };
