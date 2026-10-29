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
  function load(dir) {
    const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } };
    info = rd('runway_info.json') || {}; freqs = rd('freqs.json') || {};
    return Object.keys(info).length;
  }
  // the ends of an airport's open runways: { id, lat, lon, hdg (true, the way an aircraft using it goes) }
  const endsMemo = new Map();
  function endsOf(icao) {
    icao = String(icao || '').toUpperCase(); if (endsMemo.has(icao)) return endsMemo.get(icao);
    const out = [];
    for (const r of info[icao] || []) {
      if (r[7]) continue;                                                  // (closed)
      const a = { id: r[0], lat: r[11], lon: r[12], hdg: r[9] }, b = { id: r[1], lat: r[16], lon: r[17], hdg: r[14] };
      if (fin(a.lat) && fin(b.lat)) { a.hdg = E.brg(a.lat, a.lon, b.lat, b.lon); b.hdg = E.brg(b.lat, b.lon, a.lat, a.lon); }
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
    const tA = pts[iAir].t, near = pts.filter(p => landing ? p.t >= tA - 420 && p.t <= tA + 180 : p.t >= tA - 180 && p.t <= tA + 150);
    const score = new Map();
    const kx = 111.32 * Math.cos(ap.lat * Math.PI / 180), ky = 110.57;
    for (const p of near) {
      if (!fin(p.lat) || !fin(p.lon) || !fin(p.trk)) continue;
      const d = E.dist(p.lat, p.lon, ap.lat, ap.lon); if (d > 25) continue;
      const agl = p.gnd || p.alt == null ? 0 : p.alt - elev; if (agl > 5000) continue;
      if (p.gnd && !(p.gs > 30)) continue;                                 // (taxiing: its heading says nothing)
      for (const e of ends) {
        const dh = E.angDiff(p.trk, e.hdg); if (dh > 25) continue;
        let w;
        if (fin(e.lat)) {
          const ux = Math.sin(e.hdg * Math.PI / 180), uy = Math.cos(e.hdg * Math.PI / 180);
          const px = (p.lon - e.lon) * kx, py = (p.lat - e.lat) * ky, s = px * ux + py * uy, xt = px * uy - py * ux;
          // (landing: up to 18 km short of the threshold, or rolling out along the runway; taking off: from the threshold on)
          if (landing ? (s < -15 || s > 4) : (s < -0.5 || s > 10)) continue;
          w = Math.exp(-0.5 * (xt / (0.2 + 0.045 * Math.abs(s))) ** 2) * (1 - dh / 25);
        } else {
          if (d > 10 || agl > 3000) continue;
          w = 0.5 * (1 - dh / 25);
        }
        if (w > 0.05) score.set(e.id, (score.get(e.id) || 0) + w);
      }
    }
    const best = [...score].sort((a, b) => b[1] - a[1]);
    if (!best.length || best[0][1] < 0.6) return null;
    if (best[1] && best[1][1] > best[0][1] * 0.7) return null;              // (two runways alike: no answer)
    return best[0][0];
  }
  // /airport: its runways and frequencies; which runways the flights tracked there used, the last `days` days
  // (1.0.2) With the day counts kept (apstats.cjs: st): the window's days counted there - every aircraft adsb.lol heard -
  // from them, the rest (today, a day not built yet) from the flights tracked here; runway use likewise, from a day's
  // counts where its runways were worked out. And each of the last `hist` days' take-offs and landings (daily, UTC days:
  // [day, take-offs, landings, 'all' every aircraft heard | 'live' the flights tracked here]).
  const utcDay = t => new Date(t * 1000).toISOString().slice(0, 10);
  function answer(apId, legs, nowS, days, st, hist) {
    const a = E.byId(apId); if (!a) return { ap: apId, known: false };
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
    for (const m of legs.values()) for (const l of m.values()) {
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
      else if (live.has(d)) daily.push([d, live.get(d)[0], live.get(d)[1], 'live']);
    }
    return { ap: apId, icao, known: true, days, runways: info[icao] || [], freqs: freqs[icao] || [], usage: [...use].map(([r, u]) => [r, u[0], u[1]]).sort((x, y) => (y[1] + y[2]) - (x[1] + x[2]) || x[0].localeCompare(y[0])), moves, withRunway: withRwy, daily, allDays: counted.size };
  }
  return { load, endsOf, runwayOf, answer, get size() { return Object.keys(info).length; } };
}
module.exports = { createAirportInfo };
