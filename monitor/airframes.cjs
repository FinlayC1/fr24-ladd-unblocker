'use strict';
// (1.3.1) Airframes.io - the community's receivers of aircraft datalink (VHF ACARS, VDL2, HFDL, and the satellite links
// adsb.lol's files do not carry: Inmarsat Aero, Iridium) - as a second source of the routes aircraft send and are sent
// (datalink.cjs reads them: the same forms, the same rules). adsb.lol's files come an hour behind and hold what its own
// feeders heard; Airframes answers live, per aircraft - so an aircraft out over an ocean, or one whose plan was uplinked
// minutes ago, has its route at once.
// Asked per aircraft, only for aircraft that need it - a flight in the air with no destination from FR24 (a blocked one,
// or one FR24 shows none for), those a browser is looking at first:
//   GET /v1/airframes/tail/<registration>         -> { id, tail, icao, updatedAt } (a few hundred bytes; updatedAt: its
//       last message's time). A registration is kept by Airframes as it was heard: "9H-VCB" and "9HVCB" are two
//       airframes - both asked for. One whose 24-bit address is not this aircraft's: not this aircraft.
//   GET /v1/messages?airframe_ids=<id>,<id>&limit=<n>   -> its latest messages, only when it has sent one since last read
// Airframes allows 60 requests a minute without a key; a fifth of that is used at most (CFG.airframesPerMin, 12), its
// own "remaining" count is kept to, and a refusal (429) is waited out.
// Its stations sometimes send in old messages as new (N520QS, 11 Nov 2026: a report of 13:42 the day before stamped
// 09:06) - so: a message that says its own time of day must agree with the time Airframes gives it (else it is dropped,
// and its station's messages that say no time are not taken for a day); the same text for the same aircraft seen again
// more than half an hour later is not taken a second time; and the route code's own checks (where the aircraft is,
// where it took off) stand as for any message.
const API = 'https://api.airframes.io/v1';
const UA = { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)', Accept: 'application/json' };
const H = 3600000;
// (a short key of a text: two 32-bit hashes)
function keyOf(s) { let a = 2166136261, b = 5381; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b, 33) + c) | 0; } return (a >>> 0).toString(36) + (b >>> 0).toString(36); }

function createAirframes(env) {
  const fetchFn = env.fetch, now = env.now || (() => Date.now()), take = env.take;
  const perMin = Math.max(1, Math.min(40, +env.perMin || 12)), perDay = +env.perDay || 12000, LIMIT = +env.limit || 30, FIRST = +env.first || 100;
  const tails = new Map();      // registration -> { ids: [[id, updated ms]], at, upd, msgT, readAt, next, n }
  const stations = new Map();   // a station that sent an old message as new -> until when (ms) its untimed messages are left
  const texts = new Map();      // registration | text key -> when first heard (s)
  const sent = [];
  const stats = { on: true, asked: 0, lookups: 0, reads: 0, msgs: 0, routes: 0, known: 0, unknown: 0, stale: 0, replays: 0, fails: 0, limited: 0, lastErr: '', lastAt: 0, today: '', used: 0, pausedTo: 0 };
  function room(ms) {
    const day = new Date(ms).toISOString().slice(0, 10); if (stats.today !== day) { stats.today = day; stats.used = 0; }
    while (sent.length && ms - sent[0] > 60000) sent.shift();
    return ms < stats.pausedTo || stats.used >= perDay ? 0 : perMin - sent.length;
  }
  async function get(pathQ) {
    const ms = now(); sent.push(ms); stats.used++; stats.asked++;
    const r = await fetchFn(API + pathQ, { headers: UA, signal: AbortSignal.timeout(20000) });
    const hd = k => (r.headers && typeof r.headers.get === 'function' ? r.headers.get(k) : null), left = +hd('x-ratelimit-remaining'), reset = +hd('x-ratelimit-reset');
    if (r.status === 429) { stats.limited++; const ra = +hd('retry-after'); stats.pausedTo = ms + Math.max(60, Math.min(3600, ra > 0 ? ra : 120)) * 1000; throw new Error('HTTP 429'); }
    // (its own count of what is left this minute: never run down - others may share this address)
    if (hd('x-ratelimit-remaining') !== null && left < 20) stats.pausedTo = Math.max(stats.pausedTo, reset > ms / 1000 && reset < ms / 1000 + 3600 ? reset * 1000 : ms + 60000);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const text = await r.text(); if (!text || !text.trim()) return null;
    return JSON.parse(text);
  }
  const formsOf = reg => reg.includes('-') ? [reg, reg.replace(/-/g, '')] : [reg];
  // one aircraft: looked up; its new messages read when it has any. -> how many routes were new
  async function step(tg, ms) {
    const reg = tg.reg, hex = String(tg.hex || '').replace(/^~/, '').toUpperCase();
    let rec = tails.get(reg); if (!rec) { tails.set(reg, rec = { ids: [], at: 0, upd: 0, msgT: 0, readAt: 0, next: 0, n: 0 }); if (tails.size > 20000) tails.delete(tails.keys().next().value); }
    const ids = [];
    for (const f of formsOf(reg)) {
      stats.lookups++;
      const a = await get('/airframes/tail/' + encodeURIComponent(f));
      if (!a || !Number.isInteger(a.id)) continue;
      const icao = String(a.icao || '').toUpperCase(); if (icao && /^[0-9A-F]{6}$/.test(hex) && icao !== hex) continue;      // (another aircraft's)
      const upd = Date.parse(a.updatedAt || '') || 0; ids.push([a.id, upd]);
    }
    const known = rec.ids.length > 0; rec.ids = ids; rec.at = ms;
    if (!ids.length) { if (!rec.n) stats.unknown++; rec.n++; rec.next = ms + 6 * H; return 0; }       // (Airframes has never heard it)
    if (!known) stats.known++;
    rec.n++;
    const upd = Math.max(...ids.map(x => x[1]));
    // (nothing since last read - its messages read all the same every twenty minutes while it has no route: the time
    // Airframes gives an airframe does not move on with every message; or nothing in a day and a half - no flight of
    // now is in it)
    if (ms - upd > 36 * H || (upd <= rec.upd && !(tg.need && ms - rec.readAt >= 20 * 60000))) { rec.upd = Math.max(rec.upd, upd); rec.next = ms + (ms - upd > 6 * H ? 30 : tg.need ? 4 : 15) * 60000; return 0; }
    stats.reads++; rec.readAt = ms;
    const list = await get('/messages?airframe_ids=' + ids.map(x => x[0]).join(',') + '&limit=' + (rec.msgT ? LIMIT : FIRST));
    const msgs = (Array.isArray(list) ? list : []).map(m => ({ t: Date.parse(m && m.timestamp || '') / 1000, m })).filter(x => x.t > 0 && x.m && typeof x.m.text === 'string' && x.m.text).sort((a, b) => a.t - b.t);
    let got = 0, newest = rec.msgT;
    for (const { t, m } of msgs) {
      if (t <= rec.msgT) continue; if (t > newest) newest = t;
      stats.msgs++;
      const st = String(m.station && m.station.ident || ''), k = reg + '|' + keyOf(m.text), first = texts.get(k);
      // (the same text again, later: an old message sent in as new - not taken twice)
      if (first !== undefined && t - first > 1800) { stats.replays++; continue; }
      if (first === undefined) { texts.set(k, t); if (texts.size > 40000) texts.delete(texts.keys().next().value); }
      const flagged = st && stations.get(st) > ms;
      const r = take({ reg, t, label: String(m.label || ''), text: m.text, flight: String(m.flightNumber || (m.flight && m.flight.flight) || '').trim() }, ms / 1000, !!flagged);
      if (r < 0) { stats.stale++; if (st) { stations.set(st, ms + 24 * H); if (stations.size > 2000) stations.delete(stations.keys().next().value); } }
      else if (r > 0) got++;
    }
    rec.upd = upd; rec.msgT = newest; rec.next = ms + (tg.need && !got ? 4 : 15) * 60000;
    if (got) { stats.routes += got; stats.lastAt = ms; if (env.onRoute) { try { env.onRoute(reg); } catch (e) { /* (the caller's) */ } } }
    return got;
  }
  // a round: the aircraft due, those wanted most first (pri), then those waiting longest - as many as `max` requests and
  // the minute's allowance cover. targets: [{ reg, hex, pri, need (no route of this flight yet) }]
  async function round(targets, max) {
    const ms = now(), due = [];
    for (const tg of targets || []) {
      if (!tg || !/^[A-Z0-9-]{2,10}$/.test(tg.reg || '')) continue;
      const rec = tails.get(tg.reg), next = rec ? rec.next : 0; if (next > ms) continue;
      due.push([tg, next]);
    }
    due.sort((a, b) => (b[0].pri || 0) - (a[0].pri || 0) || a[1] - b[1]);
    let left = Math.min(max || 3, room(ms)), n = 0;
    for (const [tg] of due) {
      const cost = formsOf(tg.reg).length + 1; if (left < cost || room(now()) < cost) break;
      const before = stats.asked;
      try { n += await step(tg, now()); }
      catch (e) { stats.fails++; stats.lastErr = String(e && e.message || e).slice(0, 120); const rec = tails.get(tg.reg); if (rec) rec.next = now() + 5 * 60000; if (now() < stats.pausedTo) break; }
      left -= Math.max(1, stats.asked - before);
    }
    return n;
  }
  function prune(nowS) {
    for (const [k, t] of texts) if (t < nowS - 40 * 3600) texts.delete(k);
    const ms = nowS * 1000; for (const [k, t] of stations) if (t < ms) stations.delete(k);
    for (const [k, r] of tails) if (ms - r.at > 48 * H) tails.delete(k);
  }
  return { round, step, prune, stats, tails, stations, room };
}
module.exports = { createAirframes, keyOf };
