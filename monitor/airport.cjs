// What the monitor tells about an airport (/airport): every runway in full and its radio frequencies (data/runway_info.json,
// data/freqs.json - OurAirports, built by mkdata.cjs), and which runways the flights it tracked there used.
//
// Which runway: the end whose extended centreline the flight was on, going its way - coming down the final approach to it
// (a landing), or climbing out along it from its threshold (a take-off) - each position near the field weighed by how close
// to the centreline it was and how well its track agreed; one clear answer or none. A runway whose ends' positions are not
// known: by the track alone, close to the field and low. Parallel runways are told apart by the centreline.
const fs = require('fs'), path = require('path');
const fin = v => typeof v === 'number' && isFinite(v);

function createAirportInfo(env) {
  const { E } = env;
  let info = {}, freqs = {};
  const endsMemo = new Map();
  // (1.3.2: an airport the engine does not know - an OurAirports heliport, a seaplane base - by the monitor's list)
  const apOf = id => E.byId(id) || (typeof env.apOf === 'function' ? env.apOf(id) : null);
  function load(dir) {
    const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } };
    info = rd('runway_info.json') || {}; freqs = rd('freqs.json') || {};
    endsMemo.clear();
    return Object.keys(info).length;
  }
  // (1.3.2) every airport's, as OurAirports has them now (oarwy.cjs) - in place of the checkout's own
  function set(i, f) { if (i && typeof i === 'object') info = i; if (f && typeof f === 'object') freqs = f; endsMemo.clear(); return Object.keys(info).length; }
  // the ends of an airport's open runways: { id, lat, lon, hdg (true, the way an aircraft using it goes) }
  function endsOf(icao) {
    icao = String(icao || '').toUpperCase(); if (endsMemo.has(icao)) return endsMemo.get(icao);
    const out = [];
    for (const r of info[icao] || []) {
      if (r[7]) continue;                                                  // (closed)
      const a = { id: r[0], lat: r[11], lon: r[12], hdg: r[9], len: fin(r[2]) ? r[2] : 0 }, b = { id: r[1], lat: r[16], lon: r[17], hdg: r[14], len: fin(r[2]) ? r[2] : 0 };
      if (fin(a.lat) && fin(b.lat)) { a.hdg = E.brg(a.lat, a.lon, b.lat, b.lon); b.hdg = E.brg(b.lat, b.lon, a.lat, a.lon); a.L = b.L = E.dist(a.lat, a.lon, b.lat, b.lon); }
      else {
        a.lat = a.lon = b.lat = b.lon = null;
        const n = s => { const m = /^(\d\d)/.exec(s || ''); return m ? +m[1] * 10 : null; };
        if (!fin(a.hdg)) a.hdg = fin(b.hdg) ? (b.hdg + 180) % 360 : n(a.id);
        if (!fin(b.hdg) && fin(a.hdg)) b.hdg = (a.hdg + 180) % 360;
      }
      for (const e of [a, b]) if (e.id && fin(e.hdg)) out.push(e);
    }
    endsMemo.set(icao, out); if (endsMemo.size > 3000) endsMemo.delete(endsMemo.keys().next().value);
    return out;
  }
  // The runway a flight used at airport ap: landing (its last positions) or taking off (its first). pts: the flight's
  // positions in time order { t, lat, lon, alt (null on the ground), gnd, trk }.
  function runwayOf(ap, pts, landing) {
    if (!ap || !ap.icao || !Array.isArray(pts) || !pts.length) return null;
    const ends = endsOf(ap.icao); if (!ends.length) return null;
    const elev = fin(ap.alt) ? ap.alt : 0;
    // (the positions near the field: within 25 km, below 5,000 ft over it, from seven minutes before the last position in
    // the air to the roll-out - or from the take-off roll to two and a half minutes after the first position in the air:
    // the climb-out before the first turn; later, a track can line up with another runway by chance)
    let iAir = -1;
    if (landing) { for (let i = pts.length - 1; i >= 0; i--) if (!pts[i].gnd) { iAir = i; break; } }
    else { for (let i = 0; i < pts.length; i++) if (!pts[i].gnd) { iAir = i; break; } }
    if (iAir < 0) return null;
    const tA = pts[iAir].t, around = pts.filter(p => landing ? p.t >= tA - 420 && p.t <= tA + 180 : p.t >= tA - 180 && p.t <= tA + 150);
    // (1.2.10: the straight part only - from the first position in the air on, while the track stays within 30 degrees
    // of its own, with the roll before it; for a landing, back from the last one in the air, with the roll-out after it.
    // A circuit's downwind, a straight-in turned away from, a turn after take-off - never counted for a runway they
    // happened to point at: a Cessna's straight-in towards Daytona's 34, turned off to land on 25, read as 34)
    const ref = pts[iAir].trk, near = fin(ref) ? straight(around, around.indexOf(pts[iAir]), ref, landing) : around;
    const score = new Map(), close = new Set();
    const kx = 111.32 * Math.cos(ap.lat * Math.PI / 180), ky = 110.57;
    for (const p of near) {
      if (!fin(p.lat) || !fin(p.lon) || !fin(p.trk)) continue;
      const d = E.dist(p.lat, p.lon, ap.lat, ap.lon); if (d > 25) continue;
      const agl = p.gnd || p.alt == null ? 0 : p.alt - elev; if (agl > 5000) continue;
      const slow = p.gnd && !(p.gs > 30);                                 // (taxiing: its heading says nothing...)
      for (const e of ends) {
        const dh = E.angDiff(p.trk, e.hdg); if (dh > 25) continue;
        let w, off = 0;
        if (fin(e.lat)) {
          const g = along(e, p, kx, ky), L = runLen(e);
          // (landing: up to 15 km short of the threshold, or rolling out along the runway; taking off: from the threshold
          // to 10 km past the runway's far end)
          if (landing ? (g.s < -15 || g.s > L + 0.3) : (g.s < -0.5 || g.s > L + 10)) continue;
          // (...unless lined up on the runway itself - on its centreline within 40 m, at its start, its way: about to roll)
          if (slow && (Math.abs(g.xt) > 0.04 || dh > 15 || g.s < -0.3 || g.s > 1.5)) continue;
          // (1.2.10: how far off the runway, along it - short of the threshold on the final, past the far end on the climb.
          // The centreline held to 150 m at the runway, the margin growing 40 m a km out: parallels 380 m apart (Paris
          // CDG) are not both fitted by the same positions)
          off = landing ? Math.max(0, -g.s) : Math.max(0, g.s - L);
          w = Math.exp(-0.5 * (g.xt / (0.15 + 0.04 * off)) ** 2) * (1 - dh / 25) * (slow ? 0.7 : 1);
        } else {
          if (slow || d > 10 || agl > 3000) continue;
          w = 0.5 * (1 - dh / 25);
        }
        if (w > 0.05) {
          score.set(e.id, (score.get(e.id) || 0) + w);
          // (1.2.9: seen close to it - the roll, the climb within 4 km of the runway's end, the final within 10 km - not
          // only far out, where a track turning away, or another runway's approach, can line up with it by chance:
          // Amsterdam's take-off from 04, sampled every 30 s, read as 09 from points after its turn)
          // (1.2.10: a take-off's measured from the far end of its runway, not its start: Paris CDG's 26R, 4.2 km long and
          // its start 600 m before 26L's, was never "close" - its first position in the air already 4.4 km from its start -
          // so every take-off from it was given to 26L, 380 m off to the side)
          // (a landing: on the final within 10 km and no higher than an approach is there - 350 ft a km and 500 ft more)
          if (!fin(e.lat) || p.gnd || (landing ? off <= 10 && agl <= 500 + 350 * off : off <= 4)) close.add(e.id);
        }
      }
    }
    const best = [...score].filter(x => close.has(x[0])).sort((a, b) => b[1] - a[1]);
    if (!best.length || best[0][1] < 0.6) return null;
    const endOf = id => ends.find(e => e.id === id), par = (a, b) => E.angDiff(endOf(a).hdg, endOf(b).hdg) <= 10;
    // (a parallel close behind: the two told apart over the same positions)
    let win = best[0][0];
    // (any parallel fitting the same positions - close to it or not: two thresholds 600 m apart are not both within the
    // same 10 km of a final)
    const rival = [...score].sort((a, b) => b[1] - a[1]).find(x => x[0] !== win && par(win, x[0]) && x[1] > best[0][1] * 0.25);
    if (rival) { win = parallels(ends, win, rival[0], near, landing, elev, kx, ky); if (!win) return null; }
    // (another runway, not a parallel, fitting nearly as well: no answer)
    if (best.some(x => !par(win, x[0]) && x[1] > best[0][1] * 0.7)) return null;
    return win;
  }
  // (the positions of one straight run through position i, going the way `ref` says: ahead of it for a take-off, back
  // from it for a landing - stopping at the first in the air that turned more than 30 degrees off it; on the ground,
  // the roll the other way along it, taxiing (no heading worth the name) passed over)
  function straight(win, i, ref, landing) {
    if (i < 0) return win;
    const ok = p => p && fin(p.trk) && E.angDiff(p.trk, ref) <= 30, out = [win[i]];
    for (let k = landing ? i - 1 : i + 1; k >= 0 && k < win.length; k += landing ? -1 : 1) { const p = win[k]; if (p.gnd && !(p.gs > 30)) continue; if (!ok(p)) break; out.push(p); }
    for (let k = landing ? i + 1 : i - 1; k >= 0 && k < win.length; k += landing ? 1 : -1) { const p = win[k]; if (!p.gnd) break; if (p.gs > 30 && !ok(p)) break; out.push(p); }
    return out.sort((a, b) => a.t - b.t);
  }
  // (a position along a runway end's centreline: s km past its threshold, its way; xt km to the side)
  function along(e, p, kx, ky) {
    const ux = Math.sin(e.hdg * Math.PI / 180), uy = Math.cos(e.hdg * Math.PI / 180), px = (p.lon - e.lon) * kx, py = (p.lat - e.lat) * ky;
    return { s: px * ux + py * uy, xt: px * uy - py * ux };
  }
  const runLen = e => fin(e.L) ? e.L : (e.len || 0) * 0.0003048;
  // (1.2.9) Two runways alike - parallels side by side, the whole approach or climb-out fitting both (Gatwick's 08R/08L,
  // 200 m apart; Manchester's 05L/05R, 390 m; Paris CDG's 26L/26R, 380 m): told apart by how far off each centreline the
  // same positions were - the roll, the final within 8 km, the climb to 6 km past the runway's end, below 3,000 ft and
  // going its way. (1.2.10: each position counted for both, its margin growing with the distance out - 100 m at the
  // runway, 30 m more a km - and none counting for more than three margins off, so one stray position settles nothing.
  // 1.2.9 took each runway's own first 3 km from its own start, and the two starts are 600 m apart at CDG: a position
  // counted for one and not the other.) One clearly nearer: it. Otherwise no answer.
  function parallels(ends, idA, idB, near, landing, elev, kx, ky) {
    const A = ends.find(e => e.id === idA), B = ends.find(e => e.id === idB);
    if (!A || !B || !fin(A.lat) || !fin(B.lat) || E.angDiff(A.hdg, B.hdg) > 10) return null;
    const LA = runLen(A), LB = runLen(B), reach = (g, L) => landing ? g.s >= -8 && g.s <= L + 0.3 : g.s >= -0.5 && g.s <= L + 6;
    const offOf = (g, L) => landing ? Math.max(0, -g.s) : Math.max(0, g.s - L), z2 = (g, L) => Math.min(9, (g.xt / (0.1 + 0.03 * offOf(g, L))) ** 2);
    let llA = 0, llB = 0, n = 0;
    for (const p of near) {
      if (!fin(p.lat) || !fin(p.lon) || !fin(p.trk)) continue;
      const agl = p.gnd || p.alt == null ? 0 : p.alt - elev; if (agl > 3000) continue;
      if (p.gnd && !(p.gs > 30)) continue;
      if (E.angDiff(p.trk, A.hdg) > 15) continue;
      const a = along(A, p, kx, ky), b = along(B, p, kx, ky);
      if (!reach(a, LA) && !reach(b, LB)) continue;
      llA -= 0.5 * z2(a, LA); llB -= 0.5 * z2(b, LB); n++;
    }
    if (n && llA - llB >= 2) return idA;
    if (n && llB - llA >= 2) return idB;
    // (1.2.10: still alike - no answer, until positions nearer the runway tell them apart. 1.2.9 took the longer of two
    // under 300 m apart as the one in use: right for Gatwick's 08R beside its stand-by 08L, wrong for Los Angeles, whose
    // landings are on 24R, the shorter, 210 m from 24L - and for Atlanta's 26L/26R, both in use at once)
    return null;
  }
  // /airport: its runways and frequencies; which runways the flights tracked there used, the last `days` days
  // (1.0.2) With the day counts kept (apstats.cjs: st): the window's days counted there - every aircraft adsb.lol heard -
  // from them, the rest (today, a day not built yet) from the flights tracked here; runway use likewise, from a day's
  // counts where its runways were worked out. And each of the last `hist` days' take-offs and landings (daily, UTC days:
  // [day, take-offs, landings, 'all' every aircraft heard | 'live' the flights tracked here]).
  const utcDay = t => new Date(t * 1000).toISOString().slice(0, 10);
  function answer(apId, legs, nowS, days, st, hist) {
    const a = apOf(apId); if (!a) return { ap: apId, known: false };
    const icao = String(a.icao || '').toUpperCase(), from = nowS - days * 86400, use = new Map(), key = String(apId);
    let moves = 0, withRwy = 0;
    const add = (r, k, n) => { let u = use.get(r); if (!u) use.set(r, u = [0, 0]); u[k] += n || 1; withRwy += n || 1; };
    const win = new Set(); for (let k = 0; k < days; k++) win.add(utcDay(nowS - k * 86400));
    const dayStat = d => (st && st.has(d) ? st.read(d) : null);
    const counted = new Set(), rwCounted = new Set();
    for (const d of win) {
      const o = dayStat(d); if (!o) continue;
      counted.add(d); if (o.rw) rwCounted.add(d);
      const x = o.ap[key]; if (!x) continue;
      moves += (x[0] || 0) + (x[1] || 0);
      if (o.rw && x[2]) for (const [r, u] of Object.entries(x[2])) { if (u[0]) add(r, 0, u[0]); if (u[1]) add(r, 1, u[1]); }
    }
    const live = new Map();   // day -> [take-offs, landings] of the flights tracked here
    const lv = d => live.get(d) || live.set(d, [0, 0]).get(d);
    const hFrom = hist > 0 ? nowS - hist * 86400 : from;
    // (legs: every aircraft's flights - a Map of Maps - or this airport's alone, a list)
    let each = legs; if (!Array.isArray(legs)) { each = []; for (const m of legs.values()) for (const l of m.values()) each.push(l); }
    for (const l of each) {
      const tO = l.tOff || l.tStart, tL = l.tOn || l.tEnd;
      if (l.from && l.from.id === apId && tO >= Math.min(from, hFrom) && tO <= nowS) {
        const d = utcDay(tO); lv(d)[0]++;
        if (tO >= from && win.has(d)) { if (!counted.has(d)) moves++; if (l.rwyOff && !rwCounted.has(d)) add(l.rwyOff, 0); }
      }
      if (l.to && l.to.id === apId && !l.open && tL >= Math.min(from, hFrom) && tL <= nowS) {
        const d = utcDay(tL); lv(d)[1]++;
        if (tL >= from && win.has(d)) { if (!counted.has(d)) moves++; if (l.rwyOn && !rwCounted.has(d)) add(l.rwyOn, 1); }
      }
    }
    const daily = [];
    for (let k = 0; k < (hist || 0); k++) {
      const d = utcDay(nowS - k * 86400), o = dayStat(d), x = o && o.ap[key];
      if (o) daily.push([d, x ? x[0] || 0 : 0, x ? x[1] || 0 : 0, 'all']);
      else if (live.has(d) || k === 0) daily.push([d, live.has(d) ? live.get(d)[0] : 0, live.has(d) ? live.get(d)[1] : 0, 'live']);   // (today always: so far)
    }
    return { ap: apId, icao, known: true, days, runways: info[icao] || [], freqs: freqs[icao] || [], usage: [...use].map(([r, u]) => [r, u[0], u[1]]).sort((x, y) => (y[1] + y[2]) - (x[1] + x[2]) || x[0].localeCompare(y[0])), moves, withRunway: withRwy, daily, allDays: counted.size };
  }
  // (an airport's runways as kept: [end, end, length ft, width ft, surface, lighted, ..., closed (7), ...] - its rows)
  const runwaysOf = icao => info[String(icao || '').toUpperCase()] || [];
  return { load, set, endsOf, runwayOf, answer, runwaysOf, get size() { return Object.keys(info).length; } };
}
module.exports = { createAirportInfo };
