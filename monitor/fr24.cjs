// FR24's own feed, read from the server: the same requests the userscript's world scan makes from the page (src/page.js
// liveFeedQuery / bgFollowTrail), so the monitor knows every flight FR24 draws without a callsign - anywhere, all the time,
// whether a browser is open or not.
//   LiveFeed (gRPC-web, protobuf):  LiveFeedRequest  1 bounds{1 n,2 s,3 w,4 e: float}  2 settings{1 sources,2 services,3 traffic}
//                                                    6 1  7 limit  8 max age  9 0  10 field mask{1 'type',1 'reg'}
//                                   LiveFeedResponse 1/3 Flight  4 server time
//                                   Flight           1 id 2 lat 3 lon 4 track 5 alt 6 speed 7 icon 9 ts 10 on ground
//                                                    11 callsign 12 source (0 ADS-B, 1 MLAT, 4 estimated, 5 satellite ADS-C)
//                                                    13 extra{2 reg, 3 route{1 from, 2 to}, 4 type, 14 icao address}
//   FollowFlight:                   request 1 flight id (fixed32); response 6 trail point{1 t, 2 lat, 3 lon, 4 alt, 5 speed, 6 track}
// Requests carry the headers FR24's page sends (its device id, platform, grpc-web markers): the userscript hands over the
// ones it saw FR24 use (never an authorization or cookie), and until then a plain set of the same kind is used.
const crypto = require('crypto');
const FEED = 'https://data-feed.flightradar24.com/fr24.feed.api.v1.Feed/';

// ---- protobuf wire ------------------------------------------------------------------------------------------------
function readVarint(b, p) { let r = 0, mul = 1, x; do { if (p >= b.length) throw new Error('truncated'); x = b[p++]; r += (x & 0x7f) * mul; mul *= 128; } while (x & 0x80); return [r, p]; }
function varint(n) { const o = []; n = Math.max(0, Math.floor(n)); do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 0x80; o.push(x); } while (n); return o; }
function parse(b) {
  const out = []; let p = 0;
  while (p < b.length) {
    const kv = readVarint(b, p), key = kv[0], fn = Math.floor(key / 8), wt = key & 7; let q = kv[1], end, val;
    if (wt === 0) { const v = readVarint(b, q); val = v[0]; end = v[1]; }
    else if (wt === 1) { end = q + 8; val = b.subarray(q, end); }
    else if (wt === 5) { end = q + 4; val = b.subarray(q, end); }
    else if (wt === 2) { const l = readVarint(b, q); q = l[1]; end = q + l[0]; val = b.subarray(q, end); }
    else throw new Error('wire type ' + wt);
    if (end > b.length) throw new Error('truncated');
    out.push({ fn, wt, val }); p = end;
  }
  return out;
}
const cat = parts => { const n = parts.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of parts) { o.set(x, p); p += x.length; } return o; };
const fLen = (fn, bytes) => cat([Uint8Array.from(varint(fn * 8 + 2)), Uint8Array.from(varint(bytes.length)), bytes]);
const fStr = (fn, s) => fLen(fn, new TextEncoder().encode(String(s)));
const fVar = (fn, n) => Uint8Array.from(varint(fn * 8).concat(varint(n)));
const fF32 = (fn, v) => { const b = new Uint8Array(5); b[0] = fn * 8 + 5; new DataView(b.buffer).setFloat32(1, v, true); return b; };
const find = (fs, fn) => fs.find(f => f.fn === fn) || null;
const num = (fs, fn) => { const f = find(fs, fn); return f && f.wt === 0 ? f.val : 0; };
const flt = (fs, fn) => { const f = find(fs, fn); return f && f.wt === 5 ? new DataView(f.val.buffer, f.val.byteOffset, 4).getFloat32(0, true) : NaN; };
const str = (fs, fn) => { const f = find(fs, fn); return f && f.wt === 2 && f.val.length ? new TextDecoder().decode(f.val) : ''; };
const sub = (fs, fn) => { const f = find(fs, fn); return f && f.wt === 2 ? parse(f.val) : []; };
// (an int32 sent negative arrives as a 10-byte varint: 2^64 + n)
const int32 = v => v > 2147483647 ? v - 18446744073709551616 : v;

// gRPC-web frames: [flag][length 4 bytes][message]; flag 0x80 = trailers ("grpc-status:0\r\ngrpc-message:...")
function frames(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), msgs = []; let p = 0, trailers = '';
  while (p + 5 <= b.length) {
    const flag = b[p], len = ((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]) >>> 0;
    if (p + 5 + len > b.length) break;
    const body = b.subarray(p + 5, p + 5 + len);
    if (flag & 0x80) trailers += new TextDecoder().decode(body); else msgs.push(body);
    p += 5 + len;
  }
  const st = /grpc-status:\s*(\d+)/i.exec(trailers), mg = /grpc-message:\s*([^\r\n]*)/i.exec(trailers);
  return { msgs, status: st ? +st[1] : null, message: mg ? decodeURIComponent(mg[1]) : '' };
}
const frame = msg => cat([Uint8Array.of(0, (msg.length >>> 24) & 255, (msg.length >>> 16) & 255, (msg.length >>> 8) & 255, msg.length & 255), msg]);

// The request the world scan sends (page.js liveFeedQuery): FR24's sources 0-10, the services asked for, traffic kind,
// at most `limit` flights, positions up to `maxage` s old, type and registration in every record
function liveFeedRequest(q) {
  const bounds = cat([fF32(1, q.n), fF32(2, q.s), fF32(3, q.w), fF32(4, q.e)]);
  const settings = cat([fLen(1, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), fLen(2, Uint8Array.from(q.services || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])), fVar(3, q.traffic || 3)]);
  return cat([fLen(1, bounds), fLen(2, settings), fVar(6, 1), fVar(7, q.limit || 1500), fVar(8, q.maxage || 14400), fVar(9, 0), fLen(10, cat([fStr(1, 'type'), fStr(1, 'reg')]))]);
}
// One Flight record as the userscript's page.js reads it (patchFlight)
function flightOf(fb) {
  const fs = parse(fb), id = num(fs, 1); if (!id) return null;
  const ex = sub(fs, 13), rt = sub(ex, 3), hex = num(ex, 14);
  return { id, lat: flt(fs, 2), lon: flt(fs, 3), trk: num(fs, 4), alt: int32(num(fs, 5)), spd: num(fs, 6), icon: num(fs, 7), ts: num(fs, 9), gnd: !!num(fs, 10),
    cs: str(fs, 11), src: num(fs, 12), reg: str(ex, 2), type: str(ex, 4), hex: hex ? ('000000' + hex.toString(16)).slice(-6) : '', from: str(rt, 1), to: str(rt, 2) };
}
// LiveFeedResponse -> its flights (1 and 3), FR24's server time
function decodeLiveFeed(msg) {
  const fs = parse(msg), flights = []; let serverTime = 0;
  for (const f of fs) { if (f.wt === 2 && (f.fn === 1 || f.fn === 3)) { const x = flightOf(f.val); if (x) flights.push(x); } else if (f.fn === 4 && f.wt === 0) serverTime = f.val; }
  return { flights, serverTime };
}
// FollowFlightResponse -> the trail since take-off (field 6), oldest first
function decodeTrail(msg) {
  const pts = [];
  for (const f of parse(msg)) {
    if (f.fn !== 6 || f.wt !== 2) continue;
    const tp = parse(f.val), alt = int32(num(tp, 4));
    pts.push({ t: num(tp, 1), lat: flt(tp, 2), lon: flt(tp, 3), alt: alt < 0 ? 0 : alt, gs: num(tp, 5), trk: num(tp, 6) });
  }
  return pts.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.t > 0).sort((a, b) => a.t - b.t);
}

// ---- the client: headers, requests, pushback --------------------------------------------------------------------------
// (headers a browser may hand over: only these, never authorization / cookies / anything else)
const HDR_OK = /^(fr24-[a-z0-9-]+|x-grpc-web|x-user-agent|content-type|accept|accept-language)$/i;
function cleanHeaders(h) { const o = {}; for (const [k, v] of Object.entries(h || {})) if (HDR_OK.test(k) && typeof v === 'string' && v.length < 300 && !/[\r\n]/.test(v)) o[k.toLowerCase()] = v; return o; }
function createClient(opts) {
  opts = opts || {};
  const doFetch = opts.fetch || ((...a) => fetch(...a));
  const st = { hdr: null, hdrAt: 0, ua: '', deviceId: opts.deviceId || 'web-' + crypto.randomBytes(16).toString('hex'), pauseUntil: 0, backoff: 0, ok: 0, fails: 0, lastErr: '', lastOkAt: 0, requests: 0 };
  // (a set of the kind FR24's page sends, until a browser has shown the real one)
  const baseHeaders = () => Object.assign({ 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1', 'x-user-agent': 'grpc-web-javascript/0.1', 'fr24-device-id': st.deviceId, 'fr24-platform': 'web-26.0.0', accept: '*/*' }, st.hdr || {},
    { origin: 'https://www.flightradar24.com', referer: 'https://www.flightradar24.com/' }, st.ua ? { 'user-agent': st.ua } : {});
  function setHeaders(h, ua) {
    const c = cleanHeaders(h); if (!c['fr24-device-id']) return false;
    st.hdr = c; st.hdrAt = Date.now(); if (typeof ua === 'string' && ua.length < 400 && /Mozilla\//.test(ua) && !/[\r\n]/.test(ua)) st.ua = ua;
    return true;
  }
  // FR24 pushing back (HTTP 429, gRPC 8 resource exhausted, 14 unavailable, 7/16 refused): left alone, 10 min doubling to 2 h
  function pushback(why) { st.backoff = Math.min(st.backoff ? st.backoff * 2 : 600e3, 2 * 3600e3); st.pauseUntil = Date.now() + st.backoff; st.lastErr = why; }
  async function call(method, msg, timeoutMs, firstFrameOnly) {
    if (Date.now() < st.pauseUntil) throw new Error('paused');
    st.requests++;
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), timeoutMs || 20000);
    try {
      const r = await doFetch(FEED + method, { method: 'POST', headers: baseHeaders(), body: frame(msg), signal: ctl.signal });
      const hs = r.headers && r.headers.get ? r.headers.get('grpc-status') : null;
      if (r.status === 429) { pushback('HTTP 429'); throw new Error('HTTP 429'); }
      if (r.status === 401 || r.status === 403) { pushback('HTTP ' + r.status); throw new Error('HTTP ' + r.status); }
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      if (hs && hs !== '0') { const c = +hs; if ([7, 8, 14, 16].includes(c)) pushback('grpc ' + c); throw new Error('grpc ' + hs + ' ' + (r.headers.get('grpc-message') || '')); }
      let buf;
      if (firstFrameOnly && r.body && r.body.getReader) {
        // (a stream: its first frame, then closed)
        const rd = r.body.getReader(), parts = []; let have = 0, need = -1;
        for (;;) {
          const { value, done } = await rd.read(); if (done) break;
          parts.push(value); have += value.length;
          const b = cat(parts); if (need < 0 && b.length >= 5) need = 5 + (((b[1] << 24) | (b[2] << 16) | (b[3] << 8) | b[4]) >>> 0);
          if (need > 0 && have >= need) break;
        }
        try { ctl.abort(); } catch (e) { /* closed */ }
        buf = cat(parts);
      } else buf = new Uint8Array(await r.arrayBuffer());
      const fr = frames(buf);
      if (fr.status != null && fr.status !== 0) { if ([7, 8, 14, 16].includes(fr.status)) pushback('grpc ' + fr.status); throw new Error('grpc ' + fr.status + ' ' + fr.message); }
      st.ok++; st.lastOkAt = Date.now(); st.backoff = 0;
      return fr.msgs;
    } catch (e) { st.fails++; if (!/paused/.test(String(e))) st.lastErr = String(e && e.message || e).slice(0, 160); throw e; }
    finally { clearTimeout(tm); }
  }
  async function liveFeed(q) { const msgs = await call('LiveFeed', liveFeedRequest(q), 20000); const out = { flights: [], serverTime: 0 }; for (const m of msgs) { const d = decodeLiveFeed(m); out.flights.push(...d.flights); out.serverTime = d.serverTime || out.serverTime; } return out; }
  async function followTrail(id) { const msgs = await call('FollowFlight', Uint8Array.of(0x0d, id & 255, (id >>> 8) & 255, (id >>> 16) & 255, (id >>> 24) & 255), 15000, true); return msgs.length ? decodeTrail(msgs[0]) : []; }
  return { st, setHeaders, liveFeed, followTrail, headers: baseHeaders };
}

// ---- the world scan: every longitude from 60 S to 72 N (as the userscript's SCAN_REGIONS), the services blocked aircraft
// are in (military, business, general aviation, helicopters, other, none). A full answer (FR24 sends at most 1500) is split
// in four and each quarter asked again (twice at most), so a busy region loses nobody. FR24 pushing back ends the round.
const SCAN_REGIONS = [
  { n: 72, s: 24, w: -170, e: -100 }, { n: 72, s: 24, w: -100, e: -50 }, { n: 72, s: 24, w: -50, e: -30 }, { n: 24, s: -60, w: -170, e: -30 },
  { n: 72, s: -60, w: -30, e: 60 }, { n: 72, s: -10, w: 60, e: 180 }, { n: -10, s: -60, w: 60, e: 180 }
];
const quarters = r => { const mLat = (r.n + r.s) / 2, mLon = (r.w + r.e) / 2; return [{ n: r.n, s: mLat, w: r.w, e: mLon }, { n: r.n, s: mLat, w: mLon, e: r.e }, { n: mLat, s: r.s, w: r.w, e: mLon }, { n: mLat, s: r.s, w: mLon, e: r.e }]; };
async function scanWorld(client, opts) {
  opts = Object.assign({ services: [2, 3, 4, 5, 10, 11], traffic: 2, limit: 1500, gapMs: 400, regions: SCAN_REGIONS }, opts || {});
  const byId = new Map(), work = opts.regions.map(r => ({ r, depth: 0 })), res = { requests: 0, failed: 0, err: '', serverTime: 0 };
  while (work.length) {
    const it = work.shift();
    try {
      const a = await client.liveFeed(Object.assign({}, opts, it.r)); res.requests++;
      for (const f of a.flights) byId.set(f.id, f);
      res.serverTime = a.serverTime || res.serverTime;
      if (a.flights.length >= opts.limit - 10 && it.depth < 2) for (const q of quarters(it.r)) work.push({ r: q, depth: it.depth + 1 });
    } catch (e) { res.failed++; res.err = String(e && e.message || e); if (/paused|429|grpc (7|8|14|16)\b|HTTP 40[13]/.test(res.err)) break; }
    if (work.length && opts.gapMs) await new Promise(r => setTimeout(r, opts.gapMs));
  }
  res.flights = [...byId.values()];
  return res;
}

module.exports = { parse, frames, frame, liveFeedRequest, decodeLiveFeed, decodeTrail, flightOf, createClient, scanWorld, cleanHeaders, SCAN_REGIONS, quarters };
