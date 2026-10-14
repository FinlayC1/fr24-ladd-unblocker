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
    let n = 0;
    for (const [d, list] of byDay) {
      if (dayStart(d) < Date.now() / 1000 - keepDays * 86400) continue;
      const x = dayMap(d), had = x.m.get(hex) || [], old = [];
      for (let i = 0; i < had.length; i += 4) old.push([had[i], had[i + 1], had[i + 2], had[i + 3]]);
      const all = thin(old.concat(list).sort((a, b) => a[0] - b[0] || b[3] - a[3]));
      const flat = []; for (const p of all) flat.push(p[0], p[1], p[2], p[3]);
      if (flat.length !== had.length || flat.some((v, i) => v !== had[i])) { x.m.set(hex, flat); x.dirty = true; n += all.length - old.length; }
    }
    stats.put++; stats.points += Math.max(0, n);
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
  // one aircraft's points of a day, as [t, lat, lon, alt ft | null, on the ground]
  function of(hex, d) {
    const a = dayMap(d).m.get(String(hex).toLowerCase()) || [], out = [];
    for (let i = 0; i < a.length; i += 4) out.push([a[i], a[i + 1], a[i + 2], a[i + 3] >= 0 ? a[i + 3] * 100 : a[i + 3] === -1 ? 0 : null, a[i + 3] === -1]);
    return out;
  }
  return { put, save, prune, at, of, stats, get days() { return days.size; }, dirty: () => [...days.values()].some(x => x.dirty) };
}
module.exports = { createTracks };
