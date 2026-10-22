'use strict';
// adsb.lol's day archives (github.com/adsblol/globe_history_<year>, ODbL): every aircraft adsb.lol heard in a day, its
// whole day's trace - the same trace_full_<hex>.json its site serves - in one tar, cut into parts of ~1.9 GB
// (v2026.10.21-planes-readsb-prod-0.tar.aa, .ab, ...), published a few hours after the day ends. Read here as it
// downloads - never written to disk - and only the traces asked for kept: the blocked aircraft's (the monitor's own, and
// any the file itself flags LADD or PIA). adsb.lol's site now shows a server a verification page in front of its trace
// files; its archives are where it publishes them for bulk use.
// 21 Oct 2026: 3.8 GB, 79,986 traces, 3 minutes here.
const zlib = require('zlib');

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
function tarReader(take, onEntry) {
  let head = Buffer.alloc(0), left = 0, pad = 0, cur = null, zeros = 0, entries = 0;
  async function push(chunk) {
    let off = 0;
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
      cur = (type === '0' || type === '\0') && size > 0 && take(name, size) ? { name, parts: [] } : null;
      if (size === 0 && cur) { const c = cur; cur = null; await onEntry(c.name, Buffer.alloc(0)); }
    }
  }
  return { push, get entries() { return entries; }, get done() { return zeros >= 2; } };
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
// order. opts.get(url) -> HTTP status of a one-byte request; opts.open(url) -> an async iterable of the part's bytes.
// -> { published: false } or { published: true, parts, entries, traces, taken, bad, ms }
async function importDay(day, want, onTrace, opts) {
  const t0 = Date.now(), parts = await partsOf(day, opts.get);
  if (!parts.length) return { published: false };
  const st = { published: true, parts: parts.length, entries: 0, traces: 0, taken: 0, bad: 0, ms: 0 };
  const RE = /(?:^|\/)traces\/[0-9a-f]{2}\/trace_full_([0-9a-f]{6})\.json$/;
  const rd = tarReader((name) => RE.test(name), async (name, buf) => {
    const hex = RE.exec(name)[1]; st.traces++;
    const hd = headOf(buf); if (!hd) { st.bad++; return; }
    if (!want(hex, hd)) return;
    let j; try { j = parseTrace(buf); } catch (e) { st.bad++; return; }
    st.taken++;
    await onTrace(hex, j);
  });
  for (const u of parts) for await (const chunk of await opts.open(u)) await rd.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  st.entries = rd.entries; st.ms = Date.now() - t0;
  if (!rd.done && !st.traces) throw new Error('archive ' + day + ': no traces read');
  return st;
}

// (the real network: Node's fetch)
const UA = { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)' };
const netGet = async url => { const r = await fetch(url, { headers: Object.assign({ Range: 'bytes=0-0' }, UA), redirect: 'follow', signal: AbortSignal.timeout(60000) }); try { await r.arrayBuffer(); } catch (e) { /* small */ } return r.status; };
const netOpen = async url => { const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(3 * 3600e3) }); if (!r.ok) throw new Error('archive part: HTTP ' + r.status); return r.body; };

module.exports = { importDay, tarReader, headOf, partsOf, urlOf, tagOf, netGet, netOpen };
