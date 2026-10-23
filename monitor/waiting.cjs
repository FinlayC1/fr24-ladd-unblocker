// (22.25) The flights not named yet, tried again and again until one aircraft fits - FR24's playback flights the monitor
// had no name for when a browser asked (every moment a browser asks about adds where FR24 drew the flight then), and the
// callsign-less flights of the monitor's own FR24 scans it could not name live. Each is laid against every blocked
// aircraft's track as that grows (live ADS-B, the day rebuilds that come a day later, FR24's own trails), carried across
// the holes in it by dead reckoning (tracks.cjs estimate): named when one aircraft fits it everywhere it can be placed,
// of its type, at its height, and no other comes close. Tried again a minute on, then less and less often (ten minutes
// at most while it is recent, an hour after that; six hours when no followed aircraft was ever near it), at once when it
// has a new position, and when a track of one of its days grows. Kept three days after its last position (a day's rebuild comes up to a day and a half after it).
const fin = v => typeof v === 'number' && isFinite(v);
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const BACKOFF = [1, 2, 5, 10, 20, 30, 60];   // (minutes)

function createWaiting(env) {
  const { tracks } = env;
  const C = Object.assign({ keepDays: 3, max: 10000, maxPts: 60, sample: 10, recentH: 6 }, env.cfg || {});
  const W = new Map();   // FR24 id -> { id, type, src: 'pb' | 'live', pts: [[t, lat, lon, alt ft | null, on the ground]], tries, next, first, kicked }
  const stats = { noted: 0, tries: 0, named: { track: 0, reckon: 0 }, expired: 0 };
  const fam = env.typeFamily || (t => String(t || '').toUpperCase().slice(0, 3));   // (the engine's: a maker's line - GA7C and GLF6 alike)
  const typeFits = (a, b) => { a = String(a || '').toUpperCase(); b = String(b || '').toUpperCase(); return !a || !b || a === b || fam(a) === fam(b); };
  const R = p => p[4] ? 2 : 12;                     // (FR24's position and the track's at one moment: this far apart at most)

  // ---- what is kept ----------------------------------------------------------------------------------------------------
  // a position of a flight not named: [t, lat, lon, alt ft, on the ground]; info: { type, src }
  function note(id, p, info, nowMs) {
    id = Number(id); if (!(id > 0 && id < 2 ** 40) || !p || !fin(p[0]) || !fin(+p[1]) || !fin(+p[2]) || Math.abs(p[1]) > 90 || Math.abs(p[2]) > 180) return null;
    info = info || {};
    let w = W.get(id);
    if (!w) {
      // (full: the tenth seen longest ago goes in one go - not a search of all of them for every new one)
      if (W.size >= C.max) { const by = [...W.values()].sort((a, b) => last(a) - last(b)); for (const x of by.slice(0, Math.max(1, Math.ceil(C.max / 10)))) W.delete(x.id); }
      w = { id, type: '', src: info.src || 'pb', pts: [], tries: 0, next: nowMs, first: nowMs, kicked: 0 }; W.set(id, w); stats.noted++;
    }
    if (info.type && !w.type) w.type = String(info.type).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const t = Math.round(p[0]);
    if (w.pts.some(q => Math.abs(q[0] - t) < 30)) return w;           // (one position a half minute)
    w.pts.push([t, Math.round(p[1] * 1e4) / 1e4, Math.round(p[2] * 1e4) / 1e4, fin(+p[3]) && +p[3] > 0 ? Math.round(+p[3]) : p[4] ? 0 : null, p[4] ? 1 : 0]);
    w.pts.sort((a, b) => a[0] - b[0]);
    // (too many: the one closest to both its neighbours goes - the path's spread kept)
    while (w.pts.length > C.maxPts) { let k = 1, g = Infinity; for (let i = 1; i < w.pts.length - 1; i++) { const d = w.pts[i + 1][0] - w.pts[i - 1][0]; if (d < g) { g = d; k = i; } } w.pts.splice(k, 1); }
    w.next = nowMs;                                                    // (something new: tried again at once)
    return w;
  }
  const last = w => w.pts.length ? w.pts[w.pts.length - 1][0] : 0;
  function forget(id) { return W.delete(Number(id)); }
  // the tracks of these days grew (a day rebuilt, FR24's trail of a flight): the flights of those days tried again now -
  // each at most every two minutes
  function kick(days, nowMs) {
    if (!days || !days.size) return 0; let n = 0;
    for (const w of W.values()) if (nowMs - w.kicked > 120000 && w.pts.some(p => days.has(dayOf(p[0])))) { w.next = Math.min(w.next, nowMs); w.kicked = nowMs; n++; }
    return n;
  }

  // ---- one try --------------------------------------------------------------------------------------------------------
  // (every kept aircraft's estimate at a moment, by 2-degree cell - one per minute of the moments tried in one go)
  function gridAt(cache, t) {
    const k = Math.round(t / 60); let g = cache.get(k);
    if (!g) {
      g = new Map();
      for (const e of tracks.atAll(k * 60, env.est)) { const c = Math.floor(e[1] / 2) * 1000 + Math.floor(e[2] / 2); (g.get(c) || g.set(c, []).get(c)).push(e); }
      cache.set(k, g);
    }
    return g;
  }
  function candAt(cache, p) {
    const g = gridAt(cache, p[0]), out = [], la = Math.floor(p[1] / 2), lo = Math.floor(p[2] / 2);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      let L = lo + j; if (L < -90) L += 180; if (L >= 90) L -= 180;
      // (estimated at the whole minute: up to half a minute of flying apart from the moment itself)
      for (const e of g.get((la + i) * 1000 + L) || []) if (tracks.gcDist(p[1], p[2], e[1], e[2]) <= R(p) + e[5] + 8) out.push(e[0]);
    }
    return out;
  }
  // (spread over its path: the first, the last, and evenly between - this many at most)
  function sample(w) {
    const n = w.pts.length; if (n <= C.sample) return w.pts.slice();
    const out = []; for (let i = 0; i < C.sample; i++) out.push(w.pts[Math.round(i * (n - 1) / (C.sample - 1))]);
    return out;
  }
  // The aircraft that fits it: placed at each of its positions it can be (heard there then, or carried across a hole),
  // near enough at four in five of them and nowhere far off (one slip in six or more), of its type; at its height in the
  // air, on the ground where it is. Only carried, never heard: at two positions two minutes apart, or one very close of
  // its very type. No other aircraft fitting nearly as well.
  function tryOne(w, nowMs, cache) {
    stats.tries++; cache = cache || new Map();
    const pts = sample(w), cands = new Set();
    const anchors = [pts[pts.length >> 1], pts[pts.length - 1], pts[0]].filter((p, i, a) => a.indexOf(p) === i);
    for (const a of anchors) for (const h of candAt(cache, a)) cands.add(h);
    w.none = cands.size ? 0 : (w.none || 0) + 1;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0], fits = [];
    for (const hex of cands) {
      if (!typeFits(w.type, env.typeOf ? env.typeOf(hex, t0) : '')) continue;
      if (env.taken && env.taken(hex, w.id, t0, t1)) continue;
      let nE = 0, nF = 0, bad = 0, sum = 0, direct = 0, tF0 = 0, tF1 = 0, best = 9;
      for (const p of pts) {
        const e = tracks.estimate(hex, p[0], env.est); if (!e) continue;
        nE++;
        let x = tracks.gcDist(p[1], p[2], e.lat, e.lon) / (R(p) + e.tol);
        if (!p[4] && !e.gnd && fin(p[3]) && p[3] > 1500 && e.alt != null && Math.abs(p[3] - e.alt) > (e.how === 'track' ? 3000 : 4000)) x = Math.max(x, 9);
        if (!!p[4] !== !!e.gnd && !(p[4] && e.alt != null && e.alt < 1500) && !(e.gnd && fin(p[3]) && p[3] < 1500)) x = Math.max(x, 9);
        if (x <= 1) { nF++; sum += x; if (e.how === 'track') direct++; if (!tF0) tF0 = p[0]; tF1 = p[0]; best = Math.min(best, x); }
        else if (x > 2.5) bad++;
      }
      if (!nE || nF < Math.max(1, Math.ceil(nE * 0.8)) || bad > (nE >= 6 ? 1 : 0)) continue;
      // (carried only: two positions two minutes apart, or one very close of its own type)
      if (!direct && !(nF >= 2 && tF1 - tF0 >= 120) && !(best <= 0.6 && w.type && String(env.typeOf ? env.typeOf(hex, t0) : '').toUpperCase() === w.type)) continue;
      fits.push({ hex, nE, nF, s: sum / nF, direct, t: tF0 });
    }
    if (!fits.length) return null;
    fits.sort((a, b) => b.nF - a.nF || a.s - b.s);
    const b = fits[0], c = fits[1];
    if (c && !(c.nF < b.nF * 0.6 || c.s >= Math.max(2.5 * b.s, b.s + 0.3))) return null;
    if (rival(w, b.hex)) return null;
    return { hex: b.hex, how: b.direct === b.nF ? 'track' : 'reckon', t: b.t, n: b.nF, of: b.nE };
  }
  // (one aircraft, one flight: another flight waiting at the same time where that aircraft could be - which of the two it
  // is cannot be told: neither, for now)
  function rival(w, hex) {
    const t0 = w.pts[0][0] - 600, t1 = last(w) + 600;
    for (const w2 of W.values()) {
      if (w2 === w || !w2.pts.length || last(w2) < t0 || w2.pts[0][0] > t1) continue;
      for (const p of sample(w2)) {
        if (p[0] < t0 || p[0] > t1) continue;
        const e = tracks.estimate(hex, p[0], env.est);
        if (e && tracks.gcDist(p[1], p[2], e.lat, e.lon) <= R(p) + e.tol) return true;
      }
    }
    return false;
  }
  // The flights due, the longest waiting first, for at most maxMs; onMatch(w, m) names one (false: not taken after all)
  function round(nowMs, maxMs, onMatch) {
    const t0 = Date.now(), nowS = nowMs / 1000, due = [], cache = new Map();
    for (const w of W.values()) {
      if (!w.pts.length || nowS - last(w) > C.keepDays * 86400) { W.delete(w.id); stats.expired++; continue; }
      if (w.next <= nowMs) due.push(w);
    }
    due.sort((a, b) => a.next - b.next);
    let n = 0;
    for (const w of due) {
      if (Date.now() - t0 > maxMs) break;
      if (env.named && env.named(w.id, w.pts[0][0])) { W.delete(w.id); continue; }
      const m = tryOne(w, nowMs, cache);
      if (m && onMatch && onMatch(w, m) !== false) { W.delete(w.id); stats.named[m.how]++; n++; continue; }
      w.tries++;
      // (no kept aircraft anywhere near it, three times running - an aircraft nobody follows: every six hours, unless it
      // moves on or a track of its day grows)
      const mins = w.none >= 3 ? 360 : Math.min(nowS - last(w) < C.recentH * 3600 ? 10 : 60, BACKOFF[Math.min(w.tries, BACKOFF.length) - 1]);
      w.next = nowMs + mins * 60000;
    }
    return n;
  }
  // ---- kept on disk -----------------------------------------------------------------------------------------------------
  function dump() { return { v: 1, list: [...W.values()].map(w => [w.id, w.type, w.src, w.first, w.tries, w.pts]) }; }
  function restore(d, nowMs) {
    if (!d || d.v !== 1 || !Array.isArray(d.list)) return 0;
    for (const r of d.list) { if (!Array.isArray(r) || !Array.isArray(r[5]) || !r[5].length) continue; W.set(r[0], { id: r[0], type: r[1] || '', src: r[2] || 'pb', first: r[3] || nowMs, tries: r[4] || 0, pts: r[5], next: nowMs, kicked: 0 }); }
    return W.size;
  }
  const count = src => { let n = 0; for (const w of W.values()) if (!src || w.src === src) n++; return n; };
  return { W, note, forget, kick, tryOne, round, dump, restore, stats, count, get size() { return W.size; } };
}
module.exports = { createWaiting };
