'use strict';
// (1.4.0) Every aircraft on the ground at every airport in the world - FR24's own airports and OurAirports' - as the
// monitor's scans of FR24's map see them, for the boards' "On ground": FR24 gives a free account the last hour of its
// own list (an upsell under it), and none at all for an airport it does not list.
// FR24's own rule: an aircraft is on the list from its landing until it is known to have left. Here:
//   - seen on the ground (the scans of the airports being looked at ask for ground traffic) within 4 km of a field: on
//     the ground there (its landing the approach seen just before it, where there was one)
//   - its last report in the air an approach to a field - within 12 km of it, below 2,000 ft over it, coming down (or,
//     its first report, going there by FR24's route) - and no report in the air since, four minutes on: landed there
//     (the world's scans ask for flights in the air only: an aircraft that has landed is one they stop seeing low)
//   - any report of it in the air after that, anywhere, not an approach to the same field: it has left
// Kept a week from its last report (an aircraft parked longer is FR24's Silver plan's limit too), and written to the
// store every quarter of an hour and on stop, so a restart keeps the list. By the aircraft's address where FR24 gives
// it, else by FR24's id of its flight.
//   list(apId) -> [{ fid, hex, reg, type, cs, from, land, since, last, gnd, est }], latest landed first
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const fin = v => typeof v === 'number' && isFinite(v);
const OG_V = 1;

function createOnGround(env) {
  const { E } = env, log = env.log || (() => {});
  const keepS = env.keepS || 7 * 86400, file = env.store ? path.join(env.store, 'onground.json.gz') : '';
  const ac = new Map();      // key -> { k, ap, gnd, land, since, last, appr: { ap, t } | null, air (last report in the air), alt, fid, hex, reg, type, cs, from }
  const onAp = new Map();    // apId -> Set(key): seen on the ground there
  const apprAp = new Map();  // apId -> Set(key): last seen coming in to it
  const stats = { seen: 0, ground: 0, landed: 0, left: 0, pruned: 0, saved: 0, loaded: 0, err: '' };
  const add = (m, ap, k) => { if (!ap) return; let s = m.get(ap); if (!s) m.set(ap, s = new Set()); s.add(k); };
  const del = (m, ap, k) => { if (!ap) return; const s = m.get(ap); if (s) { s.delete(k); if (!s.size) m.delete(ap); } };
  function setGround(r, ap) { if (r.ap === ap) return; del(onAp, r.ap, r.k); r.ap = ap; add(onAp, ap, r.k); }
  function setAppr(r, a) { const was = r.appr ? r.appr.ap : 0, now = a ? a.ap : 0; if (was !== now) { del(apprAp, was, r.k); add(apprAp, now, r.k); } r.appr = a; }
  function drop(r) { setGround(r, 0); setAppr(r, null); ac.delete(r.k); }
  // (the nearest field: FR24's airports and the fields the engine knows - OurAirports' among them)
  function nearest(lat, lon, km, pick) {
    let best = null; const cb = (a, d) => { if (a && a.id > 0 && d <= km && (!pick || pick(a)) && (!best || d < best.d)) best = { a, d }; };
    E.nearby(lat, lon, km, cb); if (typeof E.nearbyFields === 'function') E.nearbyFields(lat, lon, km, cb);
    return best;
  }
  const iataOf = a => String((a && (a.iata || a.code)) || '').toUpperCase();
  function ident(r, f) {
    if (f.id > 0) r.fid = Number(f.id).toString(16);
    for (const k of ['hex', 'reg', 'type', 'cs']) if (typeof f[k] === 'string' && f[k]) r[k] = f[k].slice(0, 16);
    if (typeof f.from === 'string' && f.from) r.from = f.from.slice(0, 4).toUpperCase();
  }
  function observe(list, nowS) {
    nowS = fin(nowS) ? nowS : Date.now() / 1000;
    let n = 0;
    for (const f of list || []) {
      if (!f || !(f.id > 0) || !fin(f.lat) || !fin(f.lon) || (f.lat === 0 && f.lon === 0)) continue;
      // (a ground vehicle, FR24's own markers: none of these)
      if (f.type === 'GRND' || f.icon === 25 || f.src === 4) continue;
      const hex = /^[0-9a-f]{6}$/i.test(f.hex || '') ? f.hex.toLowerCase() : '', fk = 'f' + Number(f.id).toString(16), k = hex || fk;
      const ts = f.ts > 1e9 ? Math.min(f.ts, nowS + 60) : nowS;
      let r = ac.get(k);
      // (the same flight first seen without its address: one record of it)
      if (!r && hex && ac.has(fk)) { r = ac.get(fk); setGround(r, 0); const ap = r.appr; setAppr(r, null); ac.delete(fk); r.k = k; ac.set(k, r); if (ap) setAppr(r, ap); }
      if (r && ts < r.last) continue;   // (an older report than one already read)
      if (!r) { r = { k, ap: 0, gnd: false, land: 0, since: 0, last: 0, appr: null, air: 0, alt: null }; ac.set(k, r); }
      stats.seen++;
      ident(r, f);
      if (f.gnd) {
        const near = nearest(f.lat, f.lon, 4);
        if (near) {
          if (r.ap !== near.a.id) {
            // (its landing: the approach to this field just before, else none known - first seen here on the ground)
            const cameIn = r.appr && r.appr.ap === near.a.id && ts - r.appr.t < 3600;
            r.land = cameIn ? r.appr.t : 0; r.since = cameIn ? r.appr.t : ts; r.est = !cameIn;
            setGround(r, near.a.id); stats.ground++; n++;
          }
          setAppr(r, null); r.gnd = true;
        }
        r.last = ts; continue;
      }
      // in the air: no longer on the ground anywhere - unless it is coming in again to the field it was at
      const agl = a => (fin(f.alt) ? f.alt - (fin(a.alt) ? a.alt : 0) : Infinity);
      let near = null;
      if (fin(f.alt)) {
        // (FR24's route says where it is going: that field when it is within reach; else the nearest)
        const to = typeof f.to === 'string' ? f.to.toUpperCase() : '';
        if (to) near = nearest(f.lat, f.lon, 12, a => iataOf(a) === to);
        if (!near) near = nearest(f.lat, f.lon, 12);
      }
      const low = near && agl(near.a) < 2000;
      const coming = low && (fin(r.alt) && r.last > 0 && ts - r.last <= 900 ? f.alt <= r.alt + 50 : (typeof f.to === 'string' && f.to && f.to.toUpperCase() === iataOf(near.a)));
      if (r.ap) { setGround(r, 0); r.gnd = false; stats.left++; }
      if (coming) setAppr(r, { ap: near.a.id, t: ts }); else if (r.appr) setAppr(r, null);
      r.air = ts; r.alt = f.alt; r.last = ts; r.gnd = false;
    }
    return n;
  }
  // (an aircraft last seen coming in, four minutes on with no report in the air since: landed there)
  function settle(nowS) {
    for (const [ap, set] of apprAp) for (const k of [...set]) {
      const r = ac.get(k); if (!r || !r.appr) { set.delete(k); continue; }
      if (nowS - r.appr.t < 240 || r.air > r.appr.t) continue;
      r.land = r.appr.t; r.since = r.appr.t; r.est = false; setAppr(r, null); setGround(r, ap); r.gnd = false; stats.landed++;
    }
  }
  function list(apId, nowS) {
    nowS = fin(nowS) ? nowS : Date.now() / 1000; settle(nowS);
    const out = [];
    for (const k of onAp.get(Number(apId)) || []) {
      const r = ac.get(k); if (!r || nowS - r.last > keepS) continue;
      out.push({ fid: r.fid || '', hex: r.hex || '', reg: r.reg || '', type: r.type || '', cs: r.cs || '', from: r.from || '', land: r.land || 0, since: r.since || 0, last: r.last || 0, gnd: !!r.gnd, est: !!r.est });
    }
    return out.sort((a, b) => (b.land || b.since) - (a.land || a.since));
  }
  function prune(nowS) {
    nowS = fin(nowS) ? nowS : Date.now() / 1000; settle(nowS);
    for (const r of [...ac.values()]) {
      // (gone from the scans in the air - not on the ground anywhere: forgotten after an hour; on the ground: a week)
      const limit = r.ap ? keepS : r.appr ? 3600 : 1800;
      if (nowS - r.last > limit) { drop(r); stats.pruned++; }
    }
  }
  function save(nowS) {
    if (!file) return false;
    try {
      prune(nowS);
      const rows = []; for (const r of ac.values()) if (r.ap || r.appr) rows.push([r.k, r.ap, r.gnd ? 1 : 0, r.land, r.since, r.last, r.appr ? r.appr.ap : 0, r.appr ? r.appr.t : 0, r.air, r.alt, r.fid || '', r.hex || '', r.reg || '', r.type || '', r.cs || '', r.from || '', r.est ? 1 : 0]);
      const tmp = file + '.tmp'; fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify({ v: OG_V, at: Math.round(nowS || Date.now() / 1000), rows }))));
      fs.renameSync(tmp, file); stats.saved = rows.length; return true;
    } catch (e) { stats.err = String(e && e.message || e).slice(0, 160); log(stats.err); return false; }
  }
  function load(nowS) {
    if (!file || !fs.existsSync(file)) return 0;
    try {
      const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
      if (!j || j.v !== OG_V || !Array.isArray(j.rows)) return 0;
      nowS = fin(nowS) ? nowS : Date.now() / 1000;
      for (const x of j.rows) {
        if (!Array.isArray(x) || typeof x[0] !== 'string' || !(x[5] > 0) || nowS - x[5] > keepS) continue;
        const r = { k: x[0], ap: 0, gnd: !!x[2], land: x[3] || 0, since: x[4] || 0, last: x[5], appr: null, air: x[8] || 0, alt: fin(x[9]) ? x[9] : null, fid: x[10], hex: x[11], reg: x[12], type: x[13], cs: x[14], from: x[15], est: !!x[16] };
        ac.set(r.k, r);
        if (x[1] > 0) setGround(r, x[1]); else if (x[6] > 0) setAppr(r, { ap: x[6], t: x[7] });
      }
      stats.loaded = ac.size; return ac.size;
    } catch (e) { stats.err = String(e && e.message || e).slice(0, 160); log(stats.err); return 0; }
  }
  return { observe, settle, list, prune, save, load, stats, get size() { return ac.size; }, get airports() { return onAp.size; } };
}

module.exports = { createOnGround };
