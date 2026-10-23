// Which aircraft each callsign-less FR24 flight is - for the whole world, all the time. The flights come from the monitor's
// own scans of FR24's feed (fr24.cjs) and from the browsers connected to it; the aircraft from public ADS-B (the monitor's
// live lists, its address lookups, targeted area lookups). An identification, once made, is kept for the life of the FR24
// flight: a jet named over land keeps its name over the ocean, where only FR24's satellite positions reach it.
//
// How a flight is named (the same rules as the userscript's resolver, src/main/02-resolver.js):
//  1. live ADS-B: every aircraft heard in the last two minutes, carried to the moment of FR24's position on its own speed and
//     track, scored on distance, height, track, speed and type; the best only when clearly the best, one aircraft per flight
//  2. no candidate where FR24 has it, but within public coverage: the area around it asked of adsb.fi (targeted lookups)
//  3. out of coverage (FR24's satellite / estimated positions, or no airport within 150 km): a jet last heard cruising,
//     carried forward on its track - over open ocean or empty desert only, tightly, alone
//  4. FR24's own trail of the flight since take-off (one background request) laid against the track the monitor recorded
//     of each aircraft that could be it: three minutes and more of agreement, within 3 km, one aircraft only
//  5. on the ground: the only aircraft of its type whose last flight ended at this airport and has not been heard since
//  6. a browser's own identification (it has more ways: adsb.lol's heatmaps, ADS-B Exchange with the user's key)
// Every identification keeps being checked against fresh ADS-B; one far off again and again for three minutes is withdrawn.
const NM_KM = 1.852;
const fin = v => typeof v === 'number' && isFinite(v);
const FLAG = { ladd: 1, mil: 2, pia: 4 };

function createIdent(env) {
  const { E, cfg } = env;
  const C = Object.assign({ maxCandAge: 120, keepFlightH: 6, trailEvery: 20, lookupsPerRound: 20, lookupTries: 3 }, cfg || {});
  const flights = new Map();   // FR24 id -> { id, lat, lon, alt, trk, spd, ts, gnd, src, type, reg, icon, seen (ms), via, pts, tries, triedAt, trail, trailAt }
  const ids = new Map();       // FR24 id -> { hex, reg, type, cs, how, at, ver, flags, strikes, chg, dest, origin }
  const byHex = new Map();     // hex -> FR24 id it is assigned to
  const cache = new Map();     // hex -> candidate from a targeted lookup (5 minutes)
  const gone = [];             // { id, at } withdrawn or expired (for the browsers' "since" updates)
  const trailQ = [];           // FR24 ids waiting for their trail
  const stats = { observed: 0, matched: { list: 0, lookup: 0, reckon: 0, trail: 0, parked: 0, client: 0 }, revoked: 0, lookups: 0, trails: 0 };

  // ---- FR24's flights ------------------------------------------------------------------------------------------------
  // (the ones that need naming: FR24 has neither callsign nor registration for them; not its ground vehicles)
  const wanted = f => f && f.id && !f.cs && !f.reg && fin(f.lat) && fin(f.lon) && (f.lat || f.lon) && f.type !== 'GRND' && f.icon !== 25;
  function observe(list, nowMs, via) {
    let n = 0;
    for (const f of list || []) {
      if (!wanted(f)) continue;
      const ts = f.ts > 1e9 ? f.ts : Math.round(nowMs / 1000);
      let F = flights.get(f.id);
      if (!F) { F = { id: f.id, pts: [], tries: 0, triedAt: 0, first: nowMs }; flights.set(f.id, F); }
      else if (ts < F.ts) continue;                                   // (an older report than the one kept)
      Object.assign(F, { lat: f.lat, lon: f.lon, alt: fin(f.alt) ? f.alt : F.alt, trk: f.trk, spd: f.spd, ts, gnd: !!f.gnd, src: f.src | 0, type: String(f.type || F.type || '').toUpperCase(), reg: '', icon: f.icon | 0, seen: nowMs, via });
      const last = F.pts[F.pts.length - 1];
      // (its positions, one every 2 minutes, the last 13 hours: its track over the ocean for the rough destination - small
      // enough for thousands of flights on a 1 GB server)
      if (!last || ts - last.t >= 120) { F.pts.push({ t: ts, lat: f.lat, lon: f.lon, alt: f.gnd ? 0 : f.alt, gs: f.spd, trk: f.trk, gnd: !!f.gnd }); if (F.pts.length > 400) F.pts.splice(0, F.pts.length - 400); }
      const R = ids.get(f.id); if (R && ts > (R.ts || 0)) { R.lat = f.lat; R.lon = f.lon; R.alt = f.alt; R.gnd = !!f.gnd; R.ts = ts; R.pchg = nowMs; }
      // (a named flight down on the ground after being seen in the air: FR24's whole trail of it, for its log - taken while
      // FR24 still draws it, a few minutes)
      if (R && f.gnd && !F.logTrail && F.pts.some(p => !p.gnd)) { F.logTrail = 1; trailQ.unshift(f.id); }
      n++;
    }
    stats.observed += n;
    return n;
  }

  // ---- the candidates: every aircraft heard lately, newest report per address -----------------------------------------
  // (one aircraft as a candidate, from what this side heard of it: live list, kept positions, the area lookups)
  const fromLive = (hex, l) => { const a = l.a, fl = a.dbFlags | 0; return { hex, lat: a.lat, lon: a.lon, alt: a.alt_baro === 'ground' ? 0 : a.alt_baro, gnd: a.alt_baro === 'ground', gs: a.gs, trk: a.track, t: l.t, reg: String(a.r || '').toUpperCase(), type: String(a.t || '').toUpperCase(), ladd: !!(fl & 8) || !!(env.blocked.get(hex) || {}).faa, pia: !!(fl & 4), mil: !!(fl & 1), nonIcao: String(a.hex || '').startsWith('~'), cs: String(a.flight || '').trim() }; };
  const fromKept = (hex, x) => { const p = x.meta && x.meta.lastPos; return p ? { hex, lat: p.lat, lon: p.lon, alt: p.alt === 'ground' ? 0 : p.alt, gnd: p.alt === 'ground', gs: p.gs, trk: p.trk, t: p.t, reg: String(x.meta.reg || '').toUpperCase(), type: String(x.meta.type || '').toUpperCase(), ladd: !!(env.blocked.get(hex) || {}).faa, pia: !!x.meta.pia, mil: !!x.meta.mil, cs: x.meta.cs || '' } : null; };
  const usable = (c, nowS) => !!c && fin(c.lat) && fin(c.lon) && c.t > 0 && nowS - c.t <= 600;
  function candidates(nowS) {
    const out = new Map();
    const put = c => { if (!usable(c, nowS)) return; const p = out.get(c.hex); if (!p || c.t > p.t) out.set(c.hex, c); };
    for (const [hex, l] of env.live) put(fromLive(hex, l));
    for (const [hex, x] of env.ac) put(fromKept(hex, x));
    for (const [hex, c] of cache) { if (nowS - c.t > 300) cache.delete(hex); else put(c); }
    return out;
  }
  // (the newest of them for one address - what a browser's name is checked against, as heard this very moment)
  function candOf(hex, nowS) {
    let best = null;
    for (const c of [env.live.has(hex) ? fromLive(hex, env.live.get(hex)) : null, env.ac.has(hex) ? fromKept(hex, env.ac.get(hex)) : null, cache.get(hex)]) if (usable(c, nowS) && (!best || c.t > best.t)) best = c;
    return best;
  }
  // (a 1-degree grid of them, for the flights' neighbourhoods)
  function grid(cands) { const g = new Map(); for (const c of cands.values()) { const k = Math.floor(c.lat) * 1000 + Math.floor(c.lon); (g.get(k) || g.set(k, []).get(k)).push(c); } return g; }
  function near(g, lat, lon) { const out = [], la = Math.floor(lat), lo = Math.floor(lon); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { let L = lo + j; if (L < -180) L += 360; if (L >= 180) L -= 360; const c = g.get((la + i) * 1000 + L); if (c) out.push(...c); } return out; }

  // ---- scoring (the userscript's scoreCandidate / matchFlight) -----------------------------------------------------
  const typeFamily = t => E.typeFamily ? E.typeFamily(t) : String(t || '').toUpperCase().slice(0, 3);   // (a maker's line: GA7C and GLF6 alike)
  function typeRelation(a, b) { a = String(a || '').toUpperCase(); b = String(b || '').toUpperCase(); if (!a || !b) return 'unknown'; if (a === b) return 'same'; return typeFamily(a) === typeFamily(b) ? 'family' : 'different'; }
  function project(lat, lon, gsKt, trk, seconds) {
    if (!seconds || !(gsKt > 0) || !fin(trk)) return [lat, lon];
    const back = seconds < 0, d = gsKt * NM_KM * Math.abs(seconds) / 3600;
    return E.destPoint(lat, lon, back ? (trk + 180) % 360 : trk, d);
  }
  function score(F, c) {
    const dt = F.ts - c.t; if (Math.abs(dt) > C.maxCandAge) return null;
    const rel = typeRelation(F.type, c.type); if (rel === 'different') return null;
    if (F.gnd && F.type && rel === 'unknown' && !(c.ladd || c.pia)) return null;
    const [clat, clon] = project(c.lat, c.lon, c.gs, c.trk, dt), d = E.dist(F.lat, F.lon, clat, clon);
    if (d > 15) return null;
    let s = d;
    if (fin(F.alt) && fin(c.alt) && !F.gnd && !c.gnd) { const da = Math.abs(F.alt - c.alt); if (da > 3000) return null; s += da / 400; }
    if (!!F.gnd !== !!c.gnd && F.alt > 1500) return null;
    if (!F.gnd && fin(F.trk) && fin(c.trk) && F.spd > 60 && c.gs > 60) { const dtk = E.angDiff(F.trk, c.trk); if (dtk > 50) return null; s += dtk / 8; }
    if (fin(F.spd) && fin(c.gs) && F.spd > 60) { const ds = Math.abs(F.spd - c.gs); if (ds > 140) return null; s += ds / 25; }
    if (rel === 'same') s -= 2; else if (rel === 'family') s += 1; else if (F.type && !c.type) s += 0.5;
    if (c.ladd || c.pia) s -= 0.75;
    if (c.nonIcao) s += 2;
    return { c, d, s, rel };
  }
  // (an aircraft already given to another flight FR24 still draws - seen in the last three minutes - is not this one)
  function taken(hex, id, nowMs) { const o = byHex.get(hex); if (o == null || o === id) return false; const F = flights.get(o); return !!F && nowMs - F.seen < 180000; }
  function best(F, cands, nowMs) {
    const sc = []; for (const c of cands) { if (taken(c.hex, F.id, nowMs)) continue; const r = score(F, c); if (r) sc.push(r); }
    sc.sort((a, b) => a.s - b.s);
    const b = sc[0]; if (!b) return null;
    if (b.d > (F.gnd ? 0.6 : 5 + Math.max(0, (F.spd || 0) - 250) / 60)) return null;
    const s2 = sc[1]; if (s2 && s2.s - b.s < 2.5 && s2.d < 8) return null;
    return b;
  }

  // ---- naming, withdrawing -------------------------------------------------------------------------------------------
  function assign(F, hex, info, how, nowMs) {
    const old = ids.get(F.id); if (old && old.hex === hex) return old;
    if (old) unassign(F.id, nowMs, 'replaced');
    const prev = byHex.get(hex); if (prev != null && prev !== F.id) { const pf = flights.get(prev); if (!pf || nowMs - pf.seen >= 180000) unassign(prev, nowMs, 'renumbered'); }
    const R = { hex, reg: info.reg || '', type: info.type || F.type || '', cs: info.cs || '', how, at: Math.round(nowMs / 1000), ver: Math.round(nowMs / 1000), flags: (info.ladd ? FLAG.ladd : 0) | (info.mil ? FLAG.mil : 0) | (info.pia ? FLAG.pia : 0), strikes: null, chg: nowMs, lat: F.lat, lon: F.lon, alt: F.alt, gnd: F.gnd, ts: F.ts, dest: null, origin: null };
    ids.set(F.id, R); byHex.set(hex, F.id);
    stats.matched[how.replace(/^client.*/, 'client')] = (stats.matched[how.replace(/^client.*/, 'client')] || 0) + 1;
    // (FR24 hides it - no callsign, no registration - and public ADS-B names it: a blocked aircraft, followed from now on)
    if (env.onIdentified) env.onIdentified(hex, info, F);
    return R;
  }
  function unassign(id, nowMs, why) {
    const R = ids.get(id); if (!R) return;
    ids.delete(id); if (byHex.get(R.hex) === id) byHex.delete(R.hex);
    if (env.onUnassign) env.onUnassign(id, R, why);
    gone.push({ id, at: nowMs, why }); if (gone.length > 5000) gone.splice(0, gone.length - 5000);
    if (why === 'diverged') stats.revoked++;
  }
  // (one fresh ADS-B report of the aircraft far from where FR24 has the flight - 25 km+, or 8,000 ft apart - four times
  // over three minutes and more with no agreeing one in between: withdrawn. Nearby: confirmed again)
  function verify(F, R, c, nowMs) {
    if (F.src === 4 || F.src === 5 || Math.abs(F.ts - c.t) > 60) return;
    const [clat, clon] = project(c.lat, c.lon, c.gs, c.trk, F.ts - c.t), d = E.dist(F.lat, F.lon, clat, clon);
    const bad = d > (F.gnd ? 5 : 25) || (!F.gnd && fin(F.alt) && fin(c.alt) && Math.abs(F.alt - c.alt) > 8000);
    if (!bad) { if (d <= (F.gnd ? 2 : 8)) { R.ver = Math.round(nowMs / 1000); R.strikes = null; } return; }
    const s = R.strikes || (R.strikes = { n: 0, first: nowMs }); s.n++;
    if (s.n >= 4 && nowMs - s.first >= 180000) unassign(F.id, nowMs, 'diverged');
  }

  // ---- out of coverage --------------------------------------------------------------------------------------------
  const remoteAt = (lat, lon) => { let hit = false; E.nearby(lat, lon, 150, () => { hit = true; }); return !hit; };
  const outOfCoverage = F => F.src === 4 || F.src === 5 || remoteAt(F.lat, F.lon);
  // (carried forward from where it was last heard cruising: the userscript's reckonFit / matchReckoned)
  function reckon(F, nowMs) {
    if (F.gnd || !(F.alt > 15000) || !fin(F.trk)) return null;
    const fits = [], f = { lat: F.lat, lon: F.lon, trk: F.trk, spd: F.spd };
    for (const [hex, x] of env.ac) {
      const p = x.meta && x.meta.lastPos; if (!p || p.alt === 'ground' || !(p.alt > 15000) || !(p.gs > 200) || !fin(p.trk)) continue;
      const age = F.ts - p.t; if (age < 150 || age > 5 * 3600 || taken(hex, F.id, nowMs)) continue;
      const rel = typeRelation(x.meta.type, F.type); if (rel === 'different' || (!F.type && x.meta.type)) continue;
      if (fin(F.alt) && Math.abs(p.alt - F.alt) > 3000) continue;
      if (E.angDiff(F.trk, p.trk) > 30) continue;
      const c = { lat: p.lat, lon: p.lon, gs: p.gs > 200 ? p.gs : F.spd, trk: p.trk, alt: p.alt };
      if (!E.remotePath(c, age, f.trk, f.spd)) continue;
      const [rl, ro, trk] = E.reckon(c, age, f.trk, f.spd), e = E.trackErr(rl, ro, f.lat, f.lon, trk), km = c.gs * NM_KM * age / 3600;
      const s = Math.max(Math.abs(e.along) / (15 + 0.04 * km), Math.abs(e.cross) / (10 + 0.02 * km));
      if (s <= 1) fits.push({ hex, x, s, age });
    }
    if (!fits.length) return null;
    fits.sort((a, b) => a.s - b.s);
    if (fits[1] && fits[1].s < fits[0].s * 3) return null;
    return fits[0];
  }
  // (FR24's trail of the flight against the track recorded here of each aircraft that could be it - heard before, not now)
  function trailMatch(F, nowMs) {
    const trk = F.trail; if (!trk || trk.length < 10) return null;
    const fits = [], nowS = nowMs / 1000;
    for (const [hex, x] of env.ac) {
      if (!x.rows || x.rows.length < 10 || taken(hex, F.id, nowMs)) continue;
      const lastT = x.rows[x.rows.length - 1][0]; if (nowS - lastT < 150) continue;          // (heard just now: the live match is for that)
      if (lastT < trk[0].t || x.rows[0][0] > trk[trk.length - 1].t) continue;               // (no time in common)
      const rel = typeRelation(x.meta.type, F.type); if (rel === 'different') continue;
      const pts = []; for (const r of x.rows) if (fin(r[1]) && fin(r[2])) pts.push({ t: r[0], lat: r[1], lon: r[2] });
      const a = E.trackAgree(trk, pts);
      if (a.n >= 6 && a.span >= 180 && a.bad <= Math.max(1, a.n * 0.05)) fits.push({ hex, x, s: a.medKm, span: a.span });
    }
    if (!fits.length) return null;
    fits.sort((a, b) => a.s - b.s);
    if (fits[1] && fits[1].s < Math.max(0.05, fits[0].s) * 3) return null;
    return fits[0];
  }
  // (on the ground where no public receiver hears it: the only aircraft of its type whose last flight ended here, not
  // heard since - the monitor's own flights)
  function parked(F, nowMs) {
    if (!F.gnd || !F.type) return null;
    const here = E.placeAt(F.lat, F.lon, 7, 2), ap = here && here.airport; if (!ap || ap.id >= 1e7) return null;
    const nowS = nowMs / 1000, found = [];
    for (const [hex, m] of env.legs) {
      if (taken(hex, F.id, nowMs)) continue;
      let last = null; for (const l of m.values()) if (!last || (l.tOff || l.tStart) > (last.tOff || last.tStart)) last = l;
      if (!last || last.open || !last.ended || !last.to || last.to.id !== ap.id || nowS - (last.tEnd || 0) > 14 * 86400) continue;
      if (typeRelation(last.type, F.type) !== 'same') continue;
      const x = env.ac.get(hex), p = x && x.meta && x.meta.lastPos, b = env.blocked.get(hex);
      if (p && p.t > (last.tEnd || 0) + 300 && p.alt !== 'ground' && p.alt > 1500) continue;   // (heard flying since)
      if (b && b.heard > (last.tEnd || 0) + 1800 && !(p && p.alt === 'ground')) continue;
      found.push({ hex, last });
    }
    return found.length === 1 ? found[0] : null;
  }
  const infoOf = (hex, x, c) => { const m = (x && x.meta) || {}, b = env.blocked.get(hex) || {}; return { reg: (c && c.reg) || String(m.reg || b.reg || '').toUpperCase(), type: (c && c.type) || String(m.type || b.type || '').toUpperCase(), cs: (c && c.cs) || m.cs || '', ladd: (c && c.ladd) || !!b.faa, mil: (c && c.mil) || !!m.mil, pia: (c && c.pia) || !!m.pia }; };

  // ---- one round over every flight ---------------------------------------------------------------------------------
  // returns the flights still unnamed within public coverage (for targeted lookups)
  function match(nowMs) {
    const nowS = nowMs / 1000, cands = candidates(nowS), g = grid(cands), unmatched = [];
    for (const F of flights.values()) {
      if (nowMs - F.seen > 10 * 60000) continue;
      const R = ids.get(F.id);
      if (R) {
        const c = cands.get(R.hex); if (c) verify(F, R, c, nowMs); if (!ids.has(F.id)) { unmatched.push(F); } else {
          // (what the aircraft is, learned later - the LADD flag from a list it turned up on: added to its name, never taken off)
          const b = env.blocked.get(R.hex) || {}, fl = R.flags | (c && c.ladd || b.faa ? FLAG.ladd : 0) | (c && c.mil ? FLAG.mil : 0) | (c && c.pia ? FLAG.pia : 0);
          if (fl !== R.flags) { R.flags = fl; R.chg = nowMs; }
          continue;
        }
      }
      if (F.src === 4) continue;                                              // (FR24's estimated positions: not to be matched on)
      const b = best(F, near(g, F.lat, F.lon), nowMs);
      if (b) { assign(F, b.c.hex, infoOf(b.c.hex, env.ac.get(b.c.hex), b.c), cache.has(b.c.hex) ? 'lookup' : 'list', nowMs); continue; }
      if (outOfCoverage(F) && F.alt > 10000) {
        const r = reckon(F, nowMs); if (r) { assign(F, r.hex, infoOf(r.hex, r.x), 'reckon', nowMs); continue; }
        const t = trailMatch(F, nowMs); if (t) { assign(F, t.hex, infoOf(t.hex, t.x), 'trail', nowMs); continue; }
        if (!F.trail && !trailQ.includes(F.id)) trailQ.push(F.id);
        continue;
      }
      if (F.gnd) { const p = parked(F, nowMs); if (p) { assign(F, p.hex, infoOf(p.hex, env.ac.get(p.hex), { reg: p.last.reg, type: p.last.type }), 'parked', nowMs); continue; } }
      unmatched.push(F);
      // (three lookups and still nobody, in the air: its trail too)
      if (F.tries >= C.lookupTries && F.alt > 10000 && !F.trail && !trailQ.includes(F.id)) trailQ.push(F.id);
    }
    return unmatched;
  }
  // The areas to look up: unnamed flights within coverage, grouped (one lookup covers 220 nm), those tried least and longest
  // ago first; each flight at most lookupTries times, then again after ten minutes
  function lookupAreas(unmatched, nowMs) {
    const list = unmatched.filter(F => !F.gnd || F.type).filter(F => F.tries < C.lookupTries || nowMs - F.triedAt > 10 * 60000)
      .sort((a, b) => a.tries - b.tries || a.triedAt - b.triedAt), areas = [];
    for (const F of list) {
      if (areas.length >= C.lookupsPerRound) break;
      const a = areas.find(x => E.dist(x.lat, x.lon, F.lat, F.lon) < 300); if (a) { a.ids.push(F.id); continue; }
      areas.push({ lat: F.lat, lon: F.lon, ids: [F.id] });
    }
    for (const a of areas) for (const id of a.ids) { const F = flights.get(id); if (F) { if (nowMs - F.triedAt > 10 * 60000 && F.tries >= C.lookupTries) F.tries = 0; F.tries++; F.triedAt = nowMs; } }
    return areas;
  }
  // a targeted lookup's aircraft: candidates for five minutes (not kept as traffic)
  function addLookup(list, nowS) {
    let n = 0;
    for (const a of list || []) {
      if (!a || !a.hex || !fin(+a.lat) || !fin(+a.lon)) continue;
      const hex = String(a.hex).toLowerCase().replace(/^~/, ''), fl = a.dbFlags | 0, t = Math.round(nowS - (a.seen_pos != null ? a.seen_pos : a.seen || 0));
      const p = cache.get(hex); if (p && p.t >= t) continue;
      cache.set(hex, { hex, lat: +a.lat, lon: +a.lon, alt: a.alt_baro === 'ground' ? 0 : a.alt_baro, gnd: a.alt_baro === 'ground', gs: a.gs, trk: a.track, t, reg: String(a.r || '').toUpperCase(), type: String(a.t || '').toUpperCase(), ladd: !!(fl & 8), pia: !!(fl & 4), mil: !!(fl & 1), nonIcao: String(a.hex).startsWith('~'), cs: String(a.flight || '').trim() });
      n++;
    }
    stats.lookups++;
    if (cache.size > 30000) { const cut = nowS - 300; for (const [h, c] of cache) if (c.t < cut) cache.delete(h); }
    return n;
  }
  function nextTrail() { while (trailQ.length) { const id = trailQ.shift(), F = flights.get(id); if (F && ((!ids.has(id) && !F.trail) || F.logTrail === 1)) return F; } return null; }
  function setTrail(id, pts, nowMs) {
    const F = flights.get(id); if (!F) return;
    // (a landing's trail that did not come: the one kept, if any, stays)
    if (F.logTrail === 1) { F.logTrail = 2; if (!(pts && pts.length)) return; }
    F.trail = pts && pts.length ? pts : []; F.trailAt = nowMs; stats.trails++;
  }
  // a browser's own identification of a flight (only where this side has none and the aircraft is not another flight's)
  // From anyone's browser (a public monitor: reporter = the browser's address), a name is taken only when this side can
  // check it - the aircraft heard here lately, where FR24 has the flight - or when `need` different browsers gave the
  // same one and none gave another as often; a name this side's own positions contradict is refused.
  const claims = new Map();       // FR24 id -> { at, by: Map(hex -> Set(reporter)) }
  function clientId(id, hex, how, nowMs, reporter, need) {
    hex = String(hex || '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex) || ids.has(id) || taken(hex, id, nowMs)) return false;
    const F = flights.get(id); if (!F) return false;
    if (reporter && (need || 2) > 1) {
      const c = candOf(hex, nowMs / 1000);
      if (c && Math.abs((F.ts || 0) - c.t) < 300) {
        // (checkable: where this side last heard it, carried to FR24's moment - within 15 km and 3,000 ft, or refused)
        const [la, lo] = project(c.lat, c.lon, c.gs, c.trk, (F.ts || 0) - c.t), d = E.dist(F.lat, F.lon, la, lo);
        if (d > 15 || (!F.gnd && fin(F.alt) && fin(c.alt) && Math.abs(F.alt - c.alt) > 3000)) { stats.crowdRefused = (stats.crowdRefused || 0) + 1; return false; }
      } else {
        let k = claims.get(id); if (!k) { k = { at: nowMs, by: new Map() }; claims.set(id, k); if (claims.size > 20000) claims.delete(claims.keys().next().value); }
        k.at = nowMs; let set = k.by.get(hex); if (!set) k.by.set(hex, set = new Set()); set.add(String(reporter));
        const best = Math.max(...[...k.by.entries()].filter(([h]) => h !== hex).map(([, x]) => x.size), 0);
        if (set.size < (need || 2) || best >= set.size) { stats.crowdPending = claims.size; return false; }
        claims.delete(id);
      }
    }
    assign(F, hex, infoOf(hex, env.ac.get(hex)), 'client' + (how ? ':' + String(how).slice(0, 20) : ''), nowMs);
    return true;
  }
  // ---- (22.25) a route a browser worked out for a flight named here --------------------------------------------------
  // With its own engine and the aircraft's whole log - or the user's own word ("confirm"): handed out with the name, so
  // every other browser shows it the moment the flight is opened or searched. Taken when it makes sense where FR24 has
  // the flight now (both ends real airports, the destination not behind it). Each end on its own: a route with an origin
  // only leaves the destination another browser sent as it was, and the other way round. An end the owner's browser sent
  // stands over anyone else's for 20 minutes; a confirmed destination over one worked out; and for 20 minutes, one worked
  // out over another airport more than 10 points less sure. r: { o, oc, d, p, dc, eta, atd }; by: '' the owner, else the
  // browser's address (only whether it is the owner's is kept). Returns whether it was taken.
  const away = (F, a) => !!F && !F.gnd && fin(F.trk) && F.spd > 100 && fin(F.lat) && E.dist(F.lat, F.lon, a.lat, a.lon) > 150 && E.angDiff(F.trk, E.brg(F.lat, F.lon, a.lat, a.lon)) > 100;
  const kmTo = (F, a) => F && fin(F.lat) && fin(F.lon) ? Math.round(E.dist(F.lat, F.lon, a.lat, a.lon)) : -1;
  // (a destination the flight says is wrong now, where FR24 has it - as the browsers check one they are handed: its ETA a
  // quarter of an hour gone with the aircraft still airborne 60 km and more from it, or - a jet or turboprop, flying
  // steadily on - far off its track or behind it and no nearer (the engine's rule, E.offTrack, on its positions of the
  // last minutes). Not on a position more than 5 minutes old)
  const contradicted = (R, F, a, eta, nowMs, sure, atd0) => {
    if (!F || F.gnd || !a || !fin(F.lat) || !fin(F.lon) || !(F.ts > 0) || nowMs - (F.seen || 0) > 300000) return false;
    const km = E.dist(F.lat, F.lon, a.lat, a.lon);
    // (the ETA: a quarter of an hour gone, or a sixth of the flight's time where that is longer; never a confirmed one's)
    if (eta > 0 && !sure && F.ts > eta + Math.max(900, atd0 > 0 && eta > atd0 ? (eta - atd0) / 6 : 0) && km > 60) return true;
    const mil = !!(R && R.flags & 2), cls = E.classify({ type: (R && R.type) || F.type || '', mil });
    if (!fin(F.trk) || /^(heli|piston|fighter|milheavy)$/.test(cls) || (mil && !/^(bizjet|heavybiz)$/.test(cls))) return false;
    const c = R && R.crowd, oid = (c && c.o) || (R && R.origin && R.origin.id) || 0, atd = (c && c.o && c.atd) || (R && R.origin && R.origin.t) || 0;
    const pos = { t: F.ts, lat: F.lat, lon: F.lon, alt: fin(F.alt) ? F.alt : null, trk: F.trk, gs: F.spd, gnd: false };
    // (more than half: one position alone - a flight just seen, or the monitor just restarted - never rules it out)
    return E.offTrack(pos, (F.pts || []).filter(p => p.t < F.ts), a, { origin: oid ? E.byId(oid) : null, elapsedMin: atd > 0 ? (F.ts - atd) / 60 : null }) > 0.5;
  };
  const SHOWN = ['o', 'oc', 'atd', 'd', 'p', 'dc', 'eta'];
  function crowdRoute(id, hex, r, by, nowMs) {
    const R = ids.get(id), F = flights.get(id); if (!R || R.hex !== String(hex || '').toLowerCase() || !r) return false;
    const o = r.o > 0 && E.byId(r.o) ? r.o : 0, da = r.d > 0 ? E.byId(r.d) : null, d = da ? r.d : 0;
    if (!o && !d) return false;
    if (da && (away(F, da) || contradicted(R, F, da, r.eta > 1e9 ? r.eta : 0, nowMs, String(r.dc || '') === 'confirmed', r.atd > 1e9 ? r.atd : (R.crowd && R.crowd.atd) || 0))) { stats.routeRefused = (stats.routeRefused || 0) + 1; return false; }
    const conf = s => /^[a-z]{3,12}$/.test(String(s || '')) ? String(s) : '', nowS = Math.round(nowMs / 1000), mine = by ? 0 : 1, cur = R.crowd || null;
    const c = Object.assign({ o: 0, oc: '', atd: 0, ot: 0, oOwn: 0, d: 0, p: 0, dc: '', eta: 0, dt: 0, dOwn: 0, km: -1, kmAt: 0 }, cur);
    const held = (own, t) => own && !mine && nowS - t < 1200;   // (the owner's, lately)
    let took = false;
    if (o && !held(c.oOwn, c.ot)) { Object.assign(c, { o, oc: conf(r.oc), atd: r.atd > 1e9 ? Math.round(r.atd) : 0, ot: nowS, oOwn: mine }); took = true; }
    const dc = conf(r.dc) || 'predicted', p = Math.max(0, Math.min(100, Math.round(+r.p || 0)));
    if (d && !held(c.dOwn, c.dt) && !(c.d && c.dc === 'confirmed' && dc !== 'confirmed') && !(c.d && c.d !== d && dc !== 'confirmed' && p + 10 < c.p && nowS - c.dt < 1200)) {
      Object.assign(c, { d, p, dc, eta: r.eta > 1e9 ? Math.round(r.eta) : 0, dt: nowS, dOwn: mine, km: kmTo(F, da), kmAt: nowS }); took = true;
    }
    if (!took) return false;
    c.at = nowS;
    const same = !!cur && SHOWN.every(k => cur[k] === c[k]);
    R.crowd = c; if (!same) { R.chg = nowMs; stats.routes = (stats.routes || 0) + 1; }
    return true;
  }
  // (flights FR24 no longer draws: gone after keepFlightH hours, their names with them)
  function prune(nowMs) {
    for (const [id, F] of flights) if (nowMs - F.seen > C.keepFlightH * 3600e3) { flights.delete(id); unassign(id, nowMs, 'expired'); }
    for (let i = trailQ.length - 1; i >= 0; i--) if (!flights.has(trailQ[i])) trailQ.splice(i, 1);
    for (const [id, k] of claims) if (nowMs - k.at > 30 * 60000 || ids.has(id)) claims.delete(id);
    // (a browser's destination worked out, not confirmed, that the flight has come no nearer to in an hour - another way
    // after all, or round and round somewhere: dropped, the monitor's own handed out again; a browser's origin stays)
    // (and one the flight says is wrong now - at once, a confirmed one too when it is far off the track: every browser that has it is told with the next
    // pull, and its own route stands)
    const nowS = Math.round(nowMs / 1000);
    for (const [id, R] of ids) {
      const c = R.crowd; if (!c || !c.d) continue;
      const a0 = E.byId(c.d);
      if (a0 && contradicted(R, flights.get(id), a0, c.eta, nowMs, c.dc === 'confirmed', c.atd || 0)) {
        Object.assign(c, { d: 0, p: 0, dc: '', eta: 0, dt: 0, dOwn: 0, km: -1, kmAt: 0 }); if (!c.o) R.crowd = null;
        R.chg = nowMs; stats.routeContra = (stats.routeContra || 0) + 1; continue;
      }
      if (c.dc === 'confirmed' || nowS - (c.kmAt || 0) < 3600) continue;
      const a = E.byId(c.d), km = a ? kmTo(flights.get(id), a) : -1;
      if (a && (km < 0 || c.km < 0 || km < 30 || km < c.km - 50)) { c.km = km; c.kmAt = nowS; continue; }
      Object.assign(c, { d: 0, p: 0, dc: '', eta: 0, dt: 0, dOwn: 0, km: -1, kmAt: 0 }); if (!c.o) R.crowd = null;
      R.chg = nowMs; stats.routeAged = (stats.routeAged || 0) + 1;
    }
  }

  // ---- what the browsers get ---------------------------------------------------------------------------------------
  // rows: [FR24 id, hex, reg, type, callsign, flags (1 LADD, 2 military, 4 PIA), how, named at, origin airport id, how
  //        sure, destination airport id, its chance (%), worked out at, lat, lon, alt, on ground, FR24 position time,
  //        estimated arrival, departure time, owner, operator name, FR24 operator id, operator ICAO, (22.25) whose route:
  //        0 this side's rough destination, 1 a browser's, 2 confirmed in a browser; the destination's word when the
  //        destination is a browser's (confirmed, likely, ...); 1 when the origin is] - a browser's route (crowdRoute) in
  //        the route's places: its origin for as long as the flight is named, its destination until prune drops it
  // pos (with since): [id, lat, lon, alt, on ground, FR24 position time] of the named flights that only moved
  const r4 = v => fin(v) ? Math.round(v * 1e4) / 1e4 : null;
  const ownerCols = hex => { const o = env.ownerOf ? env.ownerOf(hex) : null; return o ? [o.owner || '', o.opName || '', o.opId || 0, o.opIcao || ''] : ['', '', 0, '']; };
  // (an aircraft's owner newly known: its name goes to the browsers again)
  function touch(hex) { const id = byHex.get(hex), R = id != null ? ids.get(id) : null; if (R) { R.chg = Date.now(); return true; } return false; }
  function table(since) {
    const rows = [], pos = [];
    for (const [id, R] of ids) {
      if (since && R.chg <= since) { if (R.pchg > since) pos.push([id, r4(R.lat), r4(R.lon), fin(R.alt) ? R.alt : null, R.gnd ? 1 : 0, R.ts || 0]); continue; }
      const c = R.crowd && (R.crowd.o || R.crowd.d) ? R.crowd : null;
      // (the part a browser's route leaves out - an origin only - this side's own)
      if (c) { rows.push([id, R.hex, R.reg, R.type, R.cs, R.flags, R.how, R.at, c.o || (R.origin ? R.origin.id : 0), c.o ? c.oc : R.origin ? R.origin.conf : '', c.d || (R.dest ? R.dest.id : 0), c.d ? c.p : R.dest ? Math.round(R.dest.p * 100) : 0, c.at, r4(R.lat), r4(R.lon), fin(R.alt) ? R.alt : null, R.gnd ? 1 : 0, R.ts || 0, c.d ? c.eta : (R.dest && R.dest.eta) || 0, (c.o && c.atd) || (R.origin && R.origin.t) || 0].concat(ownerCols(R.hex), [c.d && c.dc === 'confirmed' ? 2 : 1, c.d ? c.dc : '', c.o ? 1 : 0])); continue; }
      rows.push([id, R.hex, R.reg, R.type, R.cs, R.flags, R.how, R.at, R.origin ? R.origin.id : 0, R.origin ? R.origin.conf : '', R.dest ? R.dest.id : 0, R.dest ? Math.round(R.dest.p * 100) : 0, R.dest ? R.dest.at : 0,
        r4(R.lat), r4(R.lon), fin(R.alt) ? R.alt : null, R.gnd ? 1 : 0, R.ts || 0, R.dest && R.dest.eta || 0, R.origin && R.origin.t || 0].concat(ownerCols(R.hex), [0, '', 0]));
    }
    return { rows, pos, gone: since ? gone.filter(g => g.at > since).map(g => g.id) : [] };
  }
  // ---- kept on disk ---------------------------------------------------------------------------------------------------
  function dump() { return { v: 1, ids: [...ids].map(([id, R]) => [id, R.hex, R.reg, R.type, R.cs, R.how, R.at, R.ver, R.flags, R.lat, R.lon, R.alt, R.gnd ? 1 : 0, R.ts, R.origin, R.dest, R.crowd || null]), flights: [...flights.values()].filter(F => ids.has(F.id)).map(F => [F.id, F.lat, F.lon, F.alt, F.trk, F.spd, F.ts, F.gnd ? 1 : 0, F.src, F.type, F.seen, F.first]) }; }
  function restore(d, nowMs) {
    if (!d || d.v !== 1) return 0;
    for (const f of d.flights || []) { const [id, lat, lon, alt, trk, spd, ts, gnd, src, type, seen, first] = f; if (nowMs - seen > C.keepFlightH * 3600e3) continue; flights.set(id, { id, lat, lon, alt, trk, spd, ts, gnd: !!gnd, src, type: type || '', reg: '', icon: 0, seen, first: first || seen, via: 'disk', pts: [{ t: ts, lat, lon, alt: gnd ? 0 : alt, gs: spd, trk, gnd: !!gnd }], tries: 0, triedAt: 0 }); }
    let n = 0;
    for (const r of d.ids || []) { const [id, hex, reg, type, cs, how, at, ver, flags, lat, lon, alt, gnd, ts, origin, dest, crowd] = r; if (!flights.has(id)) continue; ids.set(id, { hex, reg, type, cs, how, at, ver, flags, strikes: null, chg: nowMs, lat, lon, alt, gnd: !!gnd, ts, origin: origin || null, dest: dest || null, crowd: crowd || null }); byHex.set(hex, id); n++; }
    return n;
  }
  return { flights, ids, byHex, cache, gone, trailQ, stats, touch, observe, match, lookupAreas, addLookup, nextTrail, setTrail, clientId, crowdRoute, prune, table, dump, restore, score, best, reckon, trailMatch, parked, typeRelation, assign, unassign, candidates, candOf };
}
module.exports = { createIdent, FLAG };
