// Every blocked aircraft's track, kept 90 days (22.23) - so a flight in FR24's playback is named the moment it is shown,
// from where the monitor heard each blocked aircraft at that moment, and the engine's learning has the flights' whole
// paths. One file per day: STORE/tracks/YYYY-MM-DD.json.gz - { hex: [t, lat, lon, alt, t, lat, lon, alt, ...] }, a flat
// list per aircraft (numbers only: a quarter of the memory of a list of points), thinned to a point a minute in the air
// and one every five minutes on the ground; alt in hundreds of feet, -1 on the ground, -2 unknown. Today and yesterday are
// held in memory as they grow; an older day is read when a playback of it asks (the last few kept).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const dayStart = d => Date.parse(d + 'T00:00:00Z') / 1000;
const fin = v => typeof v === 'number' && isFinite(v);

function createTracks(env) {
  const dir = path.join(env.store, 'tracks'), keepDays = env.keepDays || 90, step = env.step || 60, gndStep = env.gndStep || 300, cacheDays = env.cacheDays || 10;
  const days = new Map();       // 'YYYY-MM-DD' -> { m: Map(hex -> flat list), dirty, used }
  const stats = { put: 0, points: 0, saved: 0, read: 0, pruned: 0 };
  const file = d => path.join(dir, d + '.json.gz');
  function read(d) {
    const m = new Map();
    try { const o = JSON.parse(zlib.gunzipSync(fs.readFileSync(file(d))).toString('utf8')); for (const [hex, a] of Object.entries(o)) if (Array.isArray(a) && a.length % 4 === 0) m.set(hex, a); stats.read++; }
    catch (e) { if (e.code !== 'ENOENT' && env.log) env.log('tracks', d, String(e.message || e)); }
    return m;
  }
  function dayMap(d) {
    let x = days.get(d);
    if (!x) { x = { m: read(d), dirty: false, used: 0 }; days.set(d, x); evict(); }
    x.used = Date.now();
    return x;
  }
  // (the days least recently used let go - never one with points not yet written)
  function evict() {
    if (days.size <= cacheDays) return;
    const keep = new Set([dayOf(Date.now() / 1000), dayOf(Date.now() / 1000 - 86400)]);
    for (const [d, x] of [...days].sort((a, b) => a[1].used - b[1].used)) { if (days.size <= cacheDays) break; if (!x.dirty && !keep.has(d)) days.delete(d); }
  }
  // (one point: a readsb trace row [t, lat, lon, alt | 'ground', ...] or the engine's {t, lat, lon, alt, gnd0 | gnd})
  function norm(p) {
    if (Array.isArray(p)) { const g = p[3] === 'ground'; return fin(p[0]) && fin(p[1]) && fin(p[2]) ? [Math.round(p[0]), p[1], p[2], g ? -1 : fin(p[3]) ? Math.max(0, Math.round(p[3] / 100)) : -2] : null; }
    if (!p || !fin(p.t) || !fin(p.lat) || !fin(p.lon)) return null;
    const g = !!(p.gnd0 || p.gnd);
    return [Math.round(p.t), p.lat, p.lon, g ? -1 : fin(p.alt) ? Math.max(0, Math.round(p.alt / 100)) : -2];
  }
  // (thinned: the first and last point, then one a minute in the air and one every five minutes on the ground, and both
  // points of every change between the two - the moment of a take-off or landing kept as heard)
  function thin(pts) {
    const out = []; let last = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], end = i === pts.length - 1;
      if (last && p[0] <= last[0]) continue;
      const g = p[3] === -1, lg = last && last[3] === -1, next = pts[i + 1], turn = !!next && (next[3] === -1) !== g;
      if (!last || end || turn || g !== lg || p[0] - last[0] >= (g ? gndStep : step)) { out.push(p); last = p; }
    }
    return out;
  }
  // an aircraft's points (any order, any days) added to what is kept
  function put(hex, pts) {
    hex = String(hex || '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex) || !pts || !pts.length) return 0;
    const byDay = new Map();
    for (const p of pts) { const q = norm(p); if (!q) continue; q[1] = Math.round(q[1] * 1e4) / 1e4; q[2] = Math.round(q[2] * 1e4) / 1e4; const d = dayOf(q[0]); (byDay.get(d) || byDay.set(d, []).get(d)).push(q); }
    let n = 0; const changed = [];
    for (const [d, list] of byDay) {
      if (dayStart(d) < Date.now() / 1000 - keepDays * 86400) continue;
      const x = dayMap(d), had = x.m.get(hex) || [], old = [];
      for (let i = 0; i < had.length; i += 4) old.push([had[i], had[i + 1], had[i + 2], had[i + 3]]);
      const all = thin(old.concat(list).sort((a, b) => a[0] - b[0] || b[3] - a[3]));
      const flat = []; for (const p of all) flat.push(p[0], p[1], p[2], p[3]);
      if (flat.length !== had.length || flat.some((v, i) => v !== had[i])) { x.m.set(hex, flat); x.dirty = true; n += all.length - old.length; changed.push(d); }
    }
    stats.put++; stats.points += Math.max(0, n);
    // (the days that have more of it now: the flights not named yet on those days, tried again - api.onChange)
    if (changed.length && api.onChange) try { api.onChange(hex, changed); } catch (e) { if (env.log) env.log('tracks', String(e)); }
    return n;
  }
  // the days with points not yet written, to disk (whole files, written beside and moved in)
  function save() {
    fs.mkdirSync(dir, { recursive: true });
    for (const [d, x] of days) {
      if (!x.dirty) continue;
      const f = file(d), tmp = f + '.tmp';
      fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(Object.fromEntries(x.m)), { level: 6 })); fs.renameSync(tmp, f);
      x.dirty = false; stats.saved++;
    }
    evict();
  }
  // (files older than the days kept: removed)
  function prune(nowS) {
    const cut = dayOf(nowS - keepDays * 86400);
    let names = []; try { names = fs.readdirSync(dir); } catch (e) { return 0; }
    let n = 0;
    for (const f of names) { const m = /^(\d{4}-\d\d-\d\d)\.json\.gz$/.exec(f); if (m && m[1] < cut) { try { fs.unlinkSync(path.join(dir, f)); days.delete(m[1]); n++; } catch (e) { /* gone */ } } }
    stats.pruned += n;
    return n;
  }
  // Where each kept aircraft was at moment t: [hex, lat, lon, alt (ft, null unknown), on the ground] - between two kept
  // points no more than maxGap apart (straight between them), or within two minutes of its first or last point
  function at(t, maxGap) {
    maxGap = maxGap || 900;
    const out = [], seen = new Set(), ds = [dayOf(t)];
    if (t - dayStart(ds[0]) < maxGap) ds.push(dayOf(t - 86400));
    if (dayStart(ds[0]) + 86400 - t < maxGap) ds.push(dayOf(t + 86400));
    const lists = new Map();
    for (const d of ds) for (const [hex, a] of dayMap(d).m) (lists.get(hex) || lists.set(hex, []).get(hex)).push(a);
    for (const [hex, parts] of lists) {
      let a = parts[0];
      if (parts.length > 1) { const pts = []; for (const q of parts) for (let i = 0; i < q.length; i += 4) pts.push(q.slice(i, i + 4)); pts.sort((x, y) => x[0] - y[0]); a = [].concat(...pts); }
      const n = a.length / 4; if (!n || a[0] > t + 120 || a[(n - 1) * 4] < t - 120) continue;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid * 4] <= t) lo = mid; else hi = mid; }
      const i = a[lo * 4] <= t ? lo : -1, j = a[hi * 4] >= t ? hi : -1;
      const P = k => [a[k * 4], a[k * 4 + 1], a[k * 4 + 2], a[k * 4 + 3]];
      let p = null;
      if (i >= 0 && j >= 0 && i !== j && a[j * 4] - a[i * 4] <= maxGap) {
        const A = P(i), B = P(j), f = (t - A[0]) / (B[0] - A[0]), N = f < 0.5 ? A : B;
        // (between the ground and the air: as the nearer of the two)
        const alt = A[3] >= 0 && B[3] >= 0 ? (A[3] + (B[3] - A[3]) * f) * 100 : N[3] === -1 ? 0 : N[3] >= 0 ? N[3] * 100 : null;
        p = [A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f, alt, A[3] === -1 && B[3] === -1 ? true : A[3] !== -1 && B[3] !== -1 ? false : N[3] === -1];
      } else {
        const k = i >= 0 && t - a[i * 4] <= 120 ? i : j >= 0 && a[j * 4] - t <= 120 ? j : -1;
        if (k >= 0) { const A = P(k); p = [A[1], A[2], A[3] >= 0 ? A[3] * 100 : A[3] === -1 ? 0 : null, A[3] === -1]; }
      }
      if (p && !seen.has(hex)) { seen.add(hex); out.push([hex, p[0], p[1], p[2], p[3]]); }
    }
    return out;
  }
  // ---- (22.25) where a kept aircraft was at moment t, carried across the holes in its track --------------------------
  // Between two kept points up to four hours apart, in the air at both ends (out of hearing over an ocean, a desert, a
  // gap in coverage): along the great circle between them at the speed the two imply - off by at most a tenth of the
  // way flown since the nearer end (8 km at least, 120 at most); slower than 120 kt across the hole, it stopped or went
  // round somewhere: no guess. Before its first point or after its last, in the air above 10,000 ft and fast: carried
  // back or on along its own track and speed - three hours at most over open ocean or empty desert (o.remote says
  // where), a quarter of an hour elsewhere (airways turn). Two points on the ground at one spot either side: there all
  // along. Returns { lat, lon, alt (ft, null unknown), gnd, tol (km it may be off by), how: 'track' (heard there then) |
  // 'reckon' | 'parked', dt (s from the nearer point heard) } or null.
  const D2R = Math.PI / 180;
  const gcDist = (a1, o1, a2, o2) => { const x = Math.sin((a2 - a1) * D2R / 2), y = Math.sin((o2 - o1) * D2R / 2), h = x * x + Math.cos(a1 * D2R) * Math.cos(a2 * D2R) * y * y; return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))); };
  const gcBrg = (a1, o1, a2, o2) => { const p1 = a1 * D2R, p2 = a2 * D2R, dl = (o2 - o1) * D2R; return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D2R + 360) % 360; };
  const gcDest = (a, o, b, km) => { const d = km / 6371, p1 = a * D2R, t = b * D2R, p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t)); return [p2 / D2R, ((o * D2R + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))) / D2R + 540) % 360 - 180]; };
  function gcAt(a1, o1, a2, o2, f) {
    const d = gcDist(a1, o1, a2, o2) / 6371; if (d < 1e-9) return [a1, o1];
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d), p1 = a1 * D2R, l1 = o1 * D2R, p2 = a2 * D2R, l2 = o2 * D2R;
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2), y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2), z = A * Math.sin(p1) + B * Math.sin(p2);
    return [Math.atan2(z, Math.sqrt(x * x + y * y)) / D2R, Math.atan2(y, x) / D2R];
  }
  const P = (a, k) => [a[k * 4], a[k * 4 + 1], a[k * 4 + 2], a[k * 4 + 3]];
  // (the days a moment's window touches - and the one either side, for a neighbouring point - as their maps)
  const dayNames = new Map();
  function windowMaps(t, span) {
    const nowS = Date.now() / 1000, out = [];
    for (let s0 = Math.floor((t - span) / 86400) * 86400 - 86400; s0 <= t + span + 86400; s0 += 86400) {
      if (s0 > nowS + 86400 || s0 < nowS - (keepDays + 1) * 86400) continue;
      let d = dayNames.get(s0); if (!d) { d = dayOf(s0); dayNames.set(s0, d); if (dayNames.size > 400) dayNames.clear(); }
      out.push(dayMap(d).m);
    }
    return out;
  }
  const segsOf = (maps, hex) => { const out = []; for (const m of maps) { const a = m.get(hex); if (a && a.length) out.push(a); } return out; };
  const altOf = p => p[3] >= 0 ? p[3] * 100 : p[3] === -1 ? 0 : null;
  // (segs: the aircraft's points of the days around t, a day each, in order)
  function est(segs, t, o) {
    const maxGap = o.maxGap || 900, span = o.reckonGap || 4 * 3600;
    if (!segs.length || segs[0][0] > t + span || segs[segs.length - 1][segs[segs.length - 1].length - 4] < t - span) return null;
    // (the last point at or before t and the one before it, the first at or after t and the one after it - across midnight)
    let ai = -1, ak = -1, bi = -1, bk = -1;
    for (let i = segs.length - 1; i >= 0; i--) {
      const a = segs[i]; if (a[0] > t) continue;
      let lo = 0, hi = a.length / 4 - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m * 4] <= t) lo = m; else hi = m - 1; }
      ai = i; ak = lo; break;
    }
    for (let i = 0; i < segs.length; i++) {
      const a = segs[i]; if (a[a.length - 4] < t) continue;
      let lo = 0, hi = a.length / 4 - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m * 4] >= t) hi = m; else lo = m + 1; }
      bi = i; bk = lo; break;
    }
    const A = ai >= 0 && t - segs[ai][ak * 4] <= span ? P(segs[ai], ak) : null, B = bi >= 0 && segs[bi][bk * 4] - t <= span ? P(segs[bi], bk) : null;
    if (!A && !B) return null;
    const A0 = A ? (ak > 0 ? P(segs[ai], ak - 1) : ai > 0 ? P(segs[ai - 1], segs[ai - 1].length / 4 - 1) : null) : null;
    const B1 = B ? (bk < segs[bi].length / 4 - 1 ? P(segs[bi], bk + 1) : bi < segs.length - 1 ? P(segs[bi + 1], 0) : null) : null;
    const air = p => p[3] !== -1, pt = (p, how) => ({ lat: p[1], lon: p[2], alt: altOf(p), gnd: p[3] === -1, tol: 0, how, dt: Math.abs(t - p[0]) });
    // (heard there then: straight between two points close together - the nearer one's ground or air between the two)
    if (A && B && B[0] - A[0] <= maxGap) {
      const f = B[0] > A[0] ? (t - A[0]) / (B[0] - A[0]) : 0, N = f < 0.5 ? A : B;
      const alt = A[3] >= 0 && B[3] >= 0 ? (A[3] + (B[3] - A[3]) * f) * 100 : altOf(N);
      return { lat: A[1] + (B[1] - A[1]) * f, lon: A[2] + (B[2] - A[2]) * f, alt, gnd: A[3] === -1 && B[3] === -1 ? true : air(A) && air(B) ? false : N[3] === -1, tol: 0, how: 'track', dt: Math.min(t - A[0], B[0] - t) };
    }
    // (within two minutes of an end: there, moved on along its last stretch in the air)
    const edge = (P1, P0) => {
      const e = pt(P1, 'track'); if (!P0 || !air(P1) || !air(P0)) return e;
      const dt0 = Math.abs(P1[0] - P0[0]); if (dt0 < 20 || dt0 > 900) return e;
      const v = gcDist(P0[1], P0[2], P1[1], P1[2]) / dt0, [lat, lon] = gcDest(P1[1], P1[2], (gcBrg(P1[1], P1[2], P0[1], P0[2]) + 180) % 360, v * e.dt);
      return Object.assign(e, { lat, lon, tol: 0.05 * v * e.dt });
    };
    if (A && t - A[0] <= 120) return edge(A, A0);
    if (B && B[0] - t <= 120) return edge(B, B1);
    if (A && B) {
      const gap = B[0] - A[0], km = gcDist(A[1], A[2], B[1], B[2]), near = Math.min(t - A[0], B[0] - t);
      if (!air(A) && !air(B)) return km <= 2 ? { lat: A[1], lon: A[2], alt: 0, gnd: true, tol: 0.5 + km, how: 'parked', dt: near } : null;
      if (air(A) && air(B)) {
        const v = km / gap;                                   // (km a second)
        if (v * 1943.8 < 120) return null;
        const f = (t - A[0]) / gap, [lat, lon] = gcAt(A[1], A[2], B[1], B[2], f);
        const alt = A[3] >= 0 && B[3] >= 0 && Math.abs(A[3] - B[3]) <= 40 ? (A[3] + (B[3] - A[3]) * f) * 100 : null;
        return { lat, lon, alt, gnd: false, tol: Math.min(120, 8 + 0.1 * v * near), how: 'reckon', dt: near };
      }
    }
    // (on from its last point, or back from its first: the direction between it and its neighbour, that speed)
    const side = (P1, P0) => {
      if (!P1 || !P0 || !air(P1) || !air(P0) || !(P1[3] >= 100)) return null;
      const dt0 = Math.abs(P1[0] - P0[0]); if (dt0 < 30 || dt0 > 900) return null;
      const v = gcDist(P0[1], P0[2], P1[1], P1[2]) / dt0; if (v * 1943.8 < 150) return null;
      const hd = (gcBrg(P1[1], P1[2], P0[1], P0[2]) + 180) % 360, dt = Math.abs(t - P1[0]);
      const remote = !!o.remote && o.remote(P1[1], P1[2], hd, v * 1943.8, dt);
      if (dt > (remote ? o.aheadRemote || 3 * 3600 : o.ahead || 900)) return null;
      const [lat, lon] = gcDest(P1[1], P1[2], hd, v * dt);
      return { lat, lon, alt: P1[3] >= 150 ? P1[3] * 100 : null, gnd: false, tol: Math.min(remote ? 150 : 60, 5 + 0.12 * v * dt), how: 'reckon', dt };
    };
    if (A && air(A) && !(B && air(B))) return side(A, A0);
    if (B && air(B) && !(A && air(A))) return side(B, B1);
    return null;
  }
  function estimate(hex, t, o) { o = o || {}; return est(segsOf(windowMaps(t, o.reckonGap || 4 * 3600), String(hex).toLowerCase()), t, o); }
  // every kept aircraft's estimate at moment t: [hex, lat, lon, alt, on the ground, tol km, how, dt]
  function atAll(t, o) {
    o = o || {}; const maps = windowMaps(t, o.reckonGap || 4 * 3600), hexes = new Set(), out = [];
    for (const m of maps) for (const h of m.keys()) hexes.add(h);
    for (const hex of hexes) { const e = est(segsOf(maps, hex), t, o); if (e) out.push([hex, e.lat, e.lon, e.alt, e.gnd, e.tol, e.how, e.dt]); }
    return out;
  }
  // (those within km of a place at t, allowing for how far off each estimate may be)
  function around(t, lat, lon, km, o) { return atAll(t, o).filter(p => gcDist(lat, lon, p[1], p[2]) <= km + p[5]); }
  // one aircraft's points of a day, as [t, lat, lon, alt ft | null, on the ground]
  function of(hex, d) {
    const a = dayMap(d).m.get(String(hex).toLowerCase()) || [], out = [];
    for (let i = 0; i < a.length; i += 4) out.push([a[i], a[i + 1], a[i + 2], a[i + 3] >= 0 ? a[i + 3] * 100 : a[i + 3] === -1 ? 0 : null, a[i + 3] === -1]);
    return out;
  }
  const api = { put, save, prune, at, of, estimate, atAll, around, gcDist, stats, onChange: null, get days() { return days.size; }, dirty: () => [...days.values()].some(x => x.dirty) };
  return api;
}
module.exports = { createTracks };
