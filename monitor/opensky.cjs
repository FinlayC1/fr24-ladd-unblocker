'use strict';
// (1.3.8) The OpenSky Network's API as a registered user: its OAuth2 client (client credentials) - the client's id and secret
// from the monitor's environment (MON_OPENSKY_CLIENT_ID, MON_OPENSKY_CLIENT_SECRET: the server's secrets file, never the
// repository), a token asked for when there is none or it is about to run out (they last 30 minutes) and again once on a
// 401. Neither the secret nor a token is ever logged, kept on disk, sent anywhere but OpenSky's token address, or put in an
// address. Each kind of request (states, flights, tracks) has its own daily allowance of credits (4,000 for a registered
// user): what is left is read off every answer (X-Rate-Limit-Remaining), and a kind that has run out (429) is left alone
// for as long as OpenSky says.
//   POST https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token
//        grant_type=client_credentials&client_id=…&client_secret=…   -> { access_token, expires_in }
//   GET  https://opensky-network.org/api/…   Authorization: Bearer <token>
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const API = 'https://opensky-network.org/api';
const UA = 'fr24-ladd-unblocker-monitor (personal use)';
const bucketOf = p => /^\/flights\//.test(p) ? 'flights' : /^\/tracks\//.test(p) ? 'tracks' : 'states';

function createOpenSky(env) {
  const fetchFn = env.fetch, now = env.now || (() => Date.now());
  const id = String(env.clientId || '').trim(), secret = String(env.clientSecret || '').trim();
  const on = !!(id && secret);
  let token = '', tokenTo = 0, tokenWait = null;
  const stats = { on, tokens: 0, tokenFails: 0, asked: 0, ok: 0, fails: 0, lastErr: '', left: { states: null, flights: null, tracks: null }, pausedTo: { states: 0, flights: 0, tracks: 0 } };
  // (an error's words, never a credential: OpenSky's own message cut short, the id and secret taken out should it quote them)
  const safe = s => { s = String(s || '').slice(0, 160); for (const x of [secret, id, token]) if (x) s = s.split(x).join('…'); return s; };
  async function newToken() {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString();
    const r = await fetchFn(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' }, body, signal: AbortSignal.timeout(20000) });
    if (r.status !== 200) { stats.tokenFails++; throw new Error('OpenSky token: HTTP ' + r.status); }
    const j = await r.json(), t = j && typeof j.access_token === 'string' ? j.access_token : '';
    if (!t) { stats.tokenFails++; throw new Error('OpenSky token: none in the answer'); }
    token = t; tokenTo = now() + Math.max(60, Math.min(3600, +j.expires_in || 1800)) * 1000 - 60000; stats.tokens++;
    return token;
  }
  // (one request for a token at a time, however many ask)
  function tokenNow(fresh) {
    if (!fresh && token && now() < tokenTo) return Promise.resolve(token);
    if (!tokenWait) tokenWait = newToken().finally(() => { tokenWait = null; });
    return tokenWait;
  }
  // a request: the path from /api on (/states/all?…, /flights/aircraft?…) -> { status, json } - 404 (nothing: OpenSky's word
  // for no flights) as { status: 404, json: null }; anything else not 200 thrown. null when this kind is paused or the
  // client is not set up
  async function get(path) {
    if (!on) return null;
    const b = bucketOf(path); if (now() < stats.pausedTo[b]) return null;
    stats.asked++;
    try {
      let r = null;
      for (let k = 0; k < 2; k++) {
        const t = await tokenNow(k > 0);
        r = await fetchFn(API + path, { headers: { Authorization: 'Bearer ' + t, 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
        if (r.status !== 401) break;
        token = ''; tokenTo = 0;                                            // (run out early: a new one, once)
      }
      const hd = k => (r.headers && typeof r.headers.get === 'function' ? r.headers.get(k) : null);
      const rem = hd('x-rate-limit-remaining'); if (rem !== null && isFinite(+rem)) stats.left[b] = +rem;
      if (r.status === 429) { const s = +hd('x-rate-limit-retry-after-seconds'); stats.pausedTo[b] = now() + Math.max(300, Math.min(86400, s > 0 ? s : 3600)) * 1000; throw new Error('OpenSky ' + b + ': out of credits (429)'); }
      if (r.status === 404) { stats.ok++; return { status: 404, json: null }; }
      if (r.status !== 200) throw new Error('OpenSky ' + b + ': HTTP ' + r.status);
      const text = await r.text(); stats.ok++;
      return { status: 200, json: text ? JSON.parse(text) : null };
    } catch (e) { stats.fails++; stats.lastErr = safe(e && e.message || e); throw new Error(stats.lastErr); }
  }
  // (credits left of a kind, as OpenSky last said - null: not known yet)
  const left = b => stats.left[b];
  return { on, get, left, stats, tokenNow, bucketOf };
}
// ---- (1.3.8) The ends a blocked aircraft's flights were not heard at, from OpenSky's flights of that day ---------------
// OpenSky works out each flight its receivers heard - when first and last heard, and the airport nearest each end
// (estDepartureAirport, estArrivalAirport) with how far from it the first and last positions in the air were - once a
// night, for the day before (GET /flights/aircraft?icao24=&begin=&end=, 30 credits a day asked: about 130 a day). Asked
// for a blocked aircraft's day whose flights, as heard here, have an end missing or only guessed - and taken only where
// OpenSky heard it there: its first (or last) position in the air within 3 km of the airport and 450 m above it; never over
// an end heard here, and only for the same flight (OpenSky's covering where this one's begins or ends, half its time at least).
//   [day 'YYYY-MM-DD'] -> [[firstSeen, lastSeen, dep, arr, depH, depV, arrH, arrV, callsign]]
const NEAR_H = 3000, NEAR_V = 450;
function createOskyEnds(env) {
  const OS = env.os, now = env.now || (() => Date.now()), byIcao = env.byIcao, perDay = +env.perDay || 120;
  const days = new Map();     // hex -> Map(day -> flights | [] (none) )
  const asked = new Map();    // hex|day -> when asked (ms) - not again
  let q = [];
  const stats = { asked: 0, flights: 0, filled: 0, none: 0, fails: 0, lastErr: '', today: '', used: 0, queued: 0 };
  const dayStart = d => Date.parse(d + 'T00:00:00Z') / 1000;
  // (a day OpenSky has done: its night's work after it - from 06:00 UTC the day after)
  const ready = (d, ms) => ms / 1000 >= dayStart(d) + 86400 + 6 * 3600;
  // the days to ask for: [{ hex, day, n (ends missing or guessed) }] - those with most to fill first
  function want(list) {
    for (const w of list || []) {
      const hex = String(w && w.hex || '').toLowerCase(), day = String(w && w.day || '');
      if (!/^[0-9a-f]{6}$/.test(hex) || !/^\d{4}-\d\d-\d\d$/.test(day) || asked.has(hex + '|' + day) || q.some(x => x.hex === hex && x.day === day)) continue;
      q.push({ hex, day, n: +w.n || 1 });
    }
    q.sort((a, b) => b.n - a.n || (a.day < b.day ? 1 : -1)); if (q.length > 3000) q = q.slice(0, 3000);
    stats.queued = q.length;
  }
  // one request at most: the first due day of the queue -> true when one was asked
  async function round() {
    if (!OS || !OS.on) return false;
    const ms = now(), d0 = new Date(ms).toISOString().slice(0, 10); if (stats.today !== d0) { stats.today = d0; stats.used = 0; }
    const left = OS.left('flights');
    if (stats.used >= perDay || (left !== null && left < 60)) return false;
    const i = q.findIndex(x => ready(x.day, ms)); if (i < 0) return false;
    const { hex, day } = q.splice(i, 1)[0]; stats.queued = q.length;
    const b = dayStart(day), e = b + 30 * 3600;                            // (the day and the night after: two days' credits, 30)
    asked.set(hex + '|' + day, ms); if (asked.size > 50000) asked.delete(asked.keys().next().value);
    stats.used++; stats.asked++;
    let a; try { a = await OS.get(`/flights/aircraft?icao24=${hex}&begin=${b}&end=${e}`); } catch (err) { stats.fails++; stats.lastErr = String(err && err.message || err).slice(0, 120); asked.delete(hex + '|' + day); return true; }
    if (!a) { asked.delete(hex + '|' + day); return false; }             // (paused: asked again later)
    const fl = a.status === 200 && Array.isArray(a.json) ? a.json : [];
    const rows = fl.filter(f => f && +f.firstSeen > 0 && +f.lastSeen > +f.firstSeen).map(f => [Math.round(+f.firstSeen), Math.round(+f.lastSeen), String(f.estDepartureAirport || '').toUpperCase(), String(f.estArrivalAirport || '').toUpperCase(),
      num(f.estDepartureAirportHorizDistance), num(f.estDepartureAirportVertDistance), num(f.estArrivalAirportHorizDistance), num(f.estArrivalAirportVertDistance), String(f.callsign || '').trim()]);
    let m = days.get(hex); if (!m) days.set(hex, m = new Map());
    m.set(day, rows); if (rows.length) stats.flights += rows.length; else stats.none++;
    return true;
  }
  function num(v) { return v == null || v === '' || !isFinite(+v) ? null : Math.round(+v); }
  // (an end OpenSky heard it at: the airport, known to the engine, its first / last position in the air close to it)
  const near = (code, h, v) => /^[A-Z0-9]{4}$/.test(code) && h != null && v != null && h <= NEAR_H && Math.abs(v) <= NEAR_V ? byIcao(code) : null;
  const weak = e => !e || e.conf === 'near' || e.conf === 'chain';
  // An aircraft's flights with what OpenSky heard put in: a new list (the legs given are not changed) - an end missing or
  // guessed, OpenSky's flight the same flight, its airport where it heard it -> { id, code, conf: 'low', src: 'osky' }
  function fill(hex, legs) {
    const m = days.get(String(hex || '').toLowerCase()); if (!m || !m.size || !Array.isArray(legs)) return legs;
    const all = [].concat(...m.values()); if (!all.length) return legs;
    return legs.map(l => {
      if (!l || !(l.tEnd > l.tStart) || !(weak(l.from) || weak(l.to))) return l;
      let best = null, bo = 0;
      for (const f of all) { const o = Math.min(f[1], l.tEnd) - Math.max(f[0], l.tStart); if (o > bo && o >= 0.5 * Math.min(f[1] - f[0], l.tEnd - l.tStart)) { bo = o; best = f; } }
      if (!best) return l;
      let out = null;
      // (its take-off: OpenSky heard it first no later than five minutes after this flight was first heard here)
      if (weak(l.from) && !l.startedOnGround && best[0] <= l.tStart + 300) {
        const a = near(best[2], best[4], best[5]);
        if (a && !(l.to && l.to.id === a.id && l.to.conf !== 'near' && l.to.conf !== 'chain')) { out = Object.assign({}, l, { from: { id: a.id, code: a.code, conf: 'low', src: 'osky' } }); if (!(l.tOff > 0) || l.tOffEst) { out.tOff = best[0]; out.tOffEst = true; } }
      }
      // (its landing: heard last no earlier than five minutes before this flight was last heard here)
      if (weak(l.to) && best[1] >= l.tEnd - 300) {
        const a = near(best[3], best[6], best[7]), from = (out || l).from;
        if (a && !(from && from.id === a.id && from.conf !== 'near' && from.conf !== 'chain')) { out = Object.assign(out || Object.assign({}, l), { to: { id: a.id, code: a.code, conf: 'low', src: 'osky' } }); if (!(l.tOn > 0) || l.tOnEst) { out.tOn = best[1]; out.tOnEst = true; } }
      }
      if (out) stats.filled++;
      return out || l;
    });
  }
  // (kept: a day's answer, two hundred days; asked ones let go with them)
  function prune(nowS) {
    const cut = new Date((nowS - 200 * 86400) * 1000).toISOString().slice(0, 10);
    for (const [hex, m] of days) { for (const d of m.keys()) if (d < cut) m.delete(d); if (!m.size) days.delete(hex); }
    for (const k of asked.keys()) if (k.split('|')[1] < cut) asked.delete(k);
    q = q.filter(x => x.day >= cut);
  }
  const toJSON = () => ({ v: 1, days: [...days].map(([h, m]) => [h, [...m]]), asked: [...asked] });
  function fromJSON(j) {
    if (!j || j.v !== 1) return 0;
    for (const [h, list] of Array.isArray(j.days) ? j.days : []) if (/^[0-9a-f]{6}$/.test(h) && Array.isArray(list)) days.set(h, new Map(list.filter(x => Array.isArray(x) && Array.isArray(x[1])).map(x => [x[0], x[1]])));
    for (const [k, t] of Array.isArray(j.asked) ? j.asked : []) asked.set(k, t);
    return days.size;
  }
  return { want, round, fill, prune, toJSON, fromJSON, stats, days, asked, get queue() { return q; } };
}
module.exports = { createOpenSky, createOskyEnds, TOKEN_URL, API, bucketOf, NEAR_H, NEAR_V };
