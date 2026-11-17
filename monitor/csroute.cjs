'use strict';
// (1.3.8) The route usually flown under a callsign - for a flight in the air that FR24 shows no route for and no datalink
// message has named one for: an airline's scheduled, cargo or charter flight FR24 has not matched to its schedule. Two
// open callsign-route databases, built from what aircraft have flown under each callsign (the VRS standing data and its
// users' reports): adsbdb.com, else hexdb.io. Asked only for a callsign of an airline's form (three letters, a number -
// "BAW123", "DHK45A") on an airliner or an aircraft of no known type - never a registration, never a business jet's or a
// light aircraft's (their charter callsigns fly anywhere). What they give is what the callsign usually flies, not this
// flight's plan - the same route as the flight's own messages named for 103 of 209 airline flights (17 Nov): the route
// code takes it only as likely, and only from the airport the flight took off from, on the way to the other and heading
// for it - 98 in 100 right so (04-routes datalinkPlan, kind 'csdb'). Never where a message of its own names a route.
//   GET https://api.adsbdb.com/v0/callsign/<cs>  -> { response: { flightroute: { origin: { icao_code }, midpoint?, destination } } }
//   GET https://hexdb.io/api/v1/route/icao/<cs>  -> { route: "EGLL-OTHH" | "A-B-C" }
// Each callsign asked once a day (what it does not know as well); one request every 3 s at most; a refusal waited out.
const UA = { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)', Accept: 'application/json' };
const CS_RE = /^[A-Z]{3}\d{1,4}[A-Z]{0,2}$/;
// (its legs: "A-B" one, "A-B-C" two - each a leg it may be flying)
function legsOf(codes) {
  const c = (codes || []).map(x => String(x || '').trim().toUpperCase()).filter(x => /^[A-Z0-9]{4}$/.test(x));
  const out = []; for (let i = 0; i + 1 < c.length; i++) if (c[i] !== c[i + 1]) out.push([c[i], c[i + 1]]);
  return out;
}
function createCsRoute(env) {
  const fetchFn = env.fetch, now = env.now || (() => Date.now()), gapMs = env.gapMs == null ? 3000 : env.gapMs, perDay = +env.perDay || 3000;
  const cache = new Map();   // callsign -> { at, legs: [[o, d]] }
  const stats = { asked: 0, found: 0, none: 0, fails: 0, lastErr: '', today: '', used: 0, pausedTo: 0, noted: 0 };
  let lastAt = 0;
  async function getJson(url) {
    const r = await fetchFn(url, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (r.status === 429 || r.status === 403) { stats.pausedTo = now() + 3600000; throw new Error('HTTP ' + r.status); }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  // a callsign's legs, from the cache or asked -> [[o, d]] (none: []); null when it cannot be asked now
  async function lookup(cs) {
    cs = String(cs || '').trim().toUpperCase(); if (!CS_RE.test(cs)) return [];
    const c = cache.get(cs), ms = now(); if (c && ms - c.at < 864e5) return c.legs;
    const day = new Date(ms).toISOString().slice(0, 10); if (stats.today !== day) { stats.today = day; stats.used = 0; }
    if (ms < stats.pausedTo || stats.used >= perDay || ms - lastAt < gapMs) return null;
    lastAt = ms; stats.used++; stats.asked++;
    let legs = [];
    try {
      const j = await getJson('https://api.adsbdb.com/v0/callsign/' + encodeURIComponent(cs));
      const f = j && j.response && j.response.flightroute;
      if (f && f.origin && f.destination) legs = legsOf([f.origin.icao_code, f.midpoint && f.midpoint.icao_code, f.destination.icao_code]);
    } catch (e) { stats.fails++; stats.lastErr = 'adsbdb: ' + String(e && e.message || e).slice(0, 100); }
    if (!legs.length && now() >= stats.pausedTo) {
      try { const j = await getJson('https://hexdb.io/api/v1/route/icao/' + encodeURIComponent(cs)); if (j && typeof j.route === 'string') legs = legsOf(j.route.split('-')); }
      catch (e) { stats.fails++; stats.lastErr = 'hexdb: ' + String(e && e.message || e).slice(0, 100); }
    }
    if (legs.length) stats.found++; else stats.none++;
    cache.set(cs, { at: ms, legs }); if (cache.size > 20000) cache.delete(cache.keys().next().value);
    return legs;
  }
  // a round: the first flight due that the cache cannot answer is asked (one request); every flight the cache can answer
  // is noted. flights: [{ reg, hex, cs }] -> how many were noted. note(flight, o, d) puts a leg where the route code reads it
  async function round(flights, note) {
    let n = 0, asked = false;
    for (const f of flights || []) {
      const cs = String(f && f.cs || '').trim().toUpperCase(); if (!CS_RE.test(cs)) continue;
      const c = cache.get(cs);
      let legs = c && now() - c.at < 864e5 ? c.legs : null;
      if (!legs && !asked) { asked = true; legs = await lookup(cs); }
      if (!legs || !legs.length) continue;
      for (const [o, d] of legs) { if (note(f, o, d)) { n++; stats.noted++; } }
    }
    return n;
  }
  return { lookup, round, stats, cache };
}
module.exports = { createCsRoute, legsOf, CS_RE };
