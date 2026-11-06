'use strict';
// (1.2.7) The runway of every take-off and landing FR24 draws, worldwide - logged as it happens, kept, and given out a
// whole airport at a time, so every board opens with its runways in.
//
// From FR24's own tracks, as the monitor keeps them:
//   - its scans of the whole map (every two minutes): each flight's positions near an airport and low - climbing out,
//     on final, rolling on a runway: within 15 km, below 4,000 ft - are kept (fr24apt, 14 days: FR24's own track of
//     every flight where it meets an airport; a parked aircraft's are not), and the flight's runway worked out from them at once: a take-off's the
//     moment it is seen climbing out along a runway, a landing's the moment it is seen on the final approach to one
//     (and again lower down, the nearer the threshold the surer)
//   - FR24's whole trail of a flight, where the monitor has it (a blocked flight's once it has landed; the trails the
//     browsers send): both ends worked out from it, over the scans' guess
//   - the runways worked out for a browser's asking (POST /rwyfit, GET /rwy)
// Which runway: airport.cjs runwayOf - the end whose extended centreline the flight was on, going its way.
//
// Kept per UTC day and airport: STORE/rwylog/YYYY-MM-DD.json.gz { v, day, ap: { "<airport id>": { "<fid hex>:<0 take-off
// | 1 landing>": [runway, time, how] } } }, the last two days in memory (with an index by flight), older ones read when
// asked for. GET /rwyap gives an airport's of a window (its boards: seven days back) in one answer.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const fin = v => typeof v === 'number' && isFinite(v);
const RL_V = 1;

function createRwyLog(env) {
  const { E, APT } = env;
  const dir = path.join(env.store, 'rwylog'), keepDays = env.keepDays || 30, memDays = env.memDays || 2;
  const log = env.log || (() => {});
  const stats = { logged: 0, live: { dep: 0, arr: 0 }, trail: 0, fit: 0, read: 0, written: 0, pruned: 0, flights: 0, err: '' };
  const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
  const file = d => path.join(dir, d + '.json.gz');
  const days = new Map();     // day -> { ap: Map(apId -> Map(key -> [rwy, t, how])), dirty, used }
  const idx = new Map();      // "<fid>:<end>" -> [rwy, apId, t] (the days in memory, and any day read)
  const legacy = env.legacy || new Map();   // (1.2.4's runways-known.json: "<fid>:<end>" -> runway)
  const memFrom = nowS => dayOf(nowS - (memDays - 1) * 86400);
  // (the UTC days a window touches, each once)
  const daysOf = (from, to) => { const out = []; for (let t = from; ; t += 86400) { const d = dayOf(Math.min(t, to)); if (out[out.length - 1] !== d) out.push(d); if (t >= to) break; } return out; };
  function bucket(day, create) {
    let b = days.get(day);
    if (b) { b.used = Date.now(); return b; }
    let ap = new Map();
    try {
      const o = JSON.parse(zlib.gunzipSync(fs.readFileSync(file(day))).toString('utf8'));
      if (o && o.v === RL_V && o.ap) for (const [id, m] of Object.entries(o.ap)) { const mm = new Map(); for (const [k, v] of Object.entries(m || {})) if (Array.isArray(v) && typeof v[0] === 'string') mm.set(k, v); ap.set(+id, mm); }
      stats.read++;
    } catch (e) { if (!create) return null; ap = new Map(); }
    b = { ap, dirty: false, used: Date.now() };
    days.set(day, b);
    for (const [id, m] of ap) for (const [k, v] of m) if (!idx.has(k)) idx.set(k, [v[0], id, v[1]]);
    return b;
  }
  // (one runway: kept by the flight's id and which end; a later one of the same flight's end over it - surer)
  function put(fid, end, rwy, apId, t, how) {
    fid = String(fid || '').toLowerCase(); rwy = String(rwy || '').slice(0, 8);
    if (!/^[0-9a-f]{1,12}$/.test(fid) || (end !== 0 && end !== 1) || !rwy || !(apId > 0) || !(t > 1e9)) return false;
    const k = fid + ':' + end, b = bucket(dayOf(t), true);
    let m = b.ap.get(apId); if (!m) b.ap.set(apId, m = new Map());
    const cur = m.get(k);
    if (cur && cur[0] === rwy && cur[2] === how) return false;
    m.set(k, [rwy, Math.round(t), how || '']); b.dirty = true;
    idx.set(k, [rwy, apId, Math.round(t)]);
    stats.logged++;
    return true;
  }
  // "<fid>:<end>" -> its runway ('' none); t: the flight's time, to read its day when it is not in memory
  function get(k, t) {
    const x = idx.get(k); if (x) return x[0];
    if (t > 1e9) for (const d of [dayOf(t), dayOf(t - 86400), dayOf(t + 86400)]) { const b = bucket(d, false); if (b) { const y = idx.get(k); if (y) return y[0]; } }
    return legacy.get(k) || '';
  }
  // an airport's runways of a window: { "<fid>:<end>": runway }
  function airport(apId, from, to) {
    const out = {}; if (!(apId > 0)) return out;
    from = Math.max(from, to - 9 * 86400);
    for (const d of daysOf(from, to)) {
      const b = bucket(d, false), m = b && b.ap.get(apId); if (!m) continue;
      for (const [k, v] of m) if (v[1] >= from - 3600 && v[1] <= to + 3600) out[k] = v[0];
    }
    return out;
  }
  // an airport's take-offs and landings with their runways since `from`: [[runway, 0 take-off | 1 landing, time], ...]
  function movements(apId, from, to) {
    const out = []; if (!(apId > 0) || !(to >= from)) return out;
    for (const d of daysOf(Math.max(from, to - 9 * 86400), to)) {
      const b = bucket(d, false), m = b && b.ap.get(apId); if (!m) continue;
      for (const [k, v] of m) if (v[1] >= from && v[1] <= to) out.push([v[0], +k.slice(-1), v[1]]);
    }
    return out.sort((a, b) => a[2] - b[2]);
  }

  // ---- from a whole track: FR24's trail of a flight, the positions kept of it --------------------------------------
  // pts: { t, lat, lon, alt (ft, 0 on the ground), gs, trk, gnd } in time order. Each end where the track has it: begun on
  // the ground or low over an airport (its take-off), ended on the ground or low over one (its landing)
  const onGround = p => p.gnd === true || (p.alt === 0 && !(p.gs > 60));
  function airportAt(lat, lon, km) { let best = null; E.nearby(lat, lon, km, (a, d) => { if (a.icao && APT.endsOf(a.icao).length && (!best || d < best.d)) best = { a, d }; }); return best ? best.a : null; }
  function fromTrack(fid, pts, how) {
    if (!Array.isArray(pts) || pts.length < 2) return 0;
    const P = pts.filter(p => p && fin(p.t) && fin(p.lat) && fin(p.lon)).map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt: onGround(p) ? null : (fin(p.alt) ? p.alt : null), gnd: onGround(p), gs: p.gs, trk: p.trk })).sort((a, b) => a.t - b.t);
    if (P.length < 2) return 0;
    let n = 0;
    const iA = P.findIndex(p => !p.gnd), iZ = P.length - 1 - [...P].reverse().findIndex(p => !p.gnd);
    if (iA < 0) return 0;
    const low = (p, a) => p.gnd || (fin(p.alt) && p.alt - (a.alt || 0) < 3000);
    // (its take-off: on the ground there first, or first seen low near it)
    { const p0 = P[iA > 0 ? iA - 1 : iA], a = airportAt(p0.lat, p0.lon, iA > 0 ? 5 : 10);
      if (a && low(P[iA], a)) { const r = APT.runwayOf(a, P.slice(0, Math.min(P.length, iA + 40)), false); if (r && put(fid, 0, r, a.id, P[iA].t, how)) n++; } }
    // (its landing: on the ground there after, or last seen low near it - a flight still in the air is not landed)
    { const pz = P[iZ < P.length - 1 ? iZ + 1 : iZ], a = airportAt(pz.lat, pz.lon, iZ < P.length - 1 ? 5 : 10);
      if (a && low(P[iZ], a) && (iZ < P.length - 1 || P[iZ].alt - (a.alt || 0) < 1500)) { const r = APT.runwayOf(a, P.slice(Math.max(0, iZ - 60)), true); if (r && put(fid, 1, r, a.id, P[iZ].t, how)) n++; } }
    if (n) stats.trail += n;
    return n;
  }

  // ---- live, from each scan of the whole map --------------------------------------------------------------------------
  // Each flight's positions near an airport, low, of the last quarter of an hour (and where it was last on the ground):
  // its runway the moment those show it climbing out along one, or on the final approach to one
  const fl = new Map();       // FR24 id -> { pts: [...], gAp, gT, dep, arrAgl, seen }
  // (what a runway needs: within 15 km and below 4,000 ft over the field, or rolling on the ground - not a parked aircraft)
  const keepPt = (f, a, d) => d <= 15 && (f.gnd ? f.spd > 30 : fin(f.alt) && f.alt - (a.alt || 0) < 4000);
  function near(lat, lon, km) { const out = []; E.nearby(lat, lon, km, (a, d) => { if (a.icao && APT.endsOf(a.icao).length) out.push({ a, d }); }); return out.sort((x, y) => x.d - y.d); }
  // (the way it is going relative to the field: away from it, towards it)
  const away = (f, a) => { if (!fin(f.trk)) return null; const b = E.brg(a.lat, a.lon, f.lat, f.lon); return E.angDiff(b, f.trk) < 60; };
  const toward = (f, a) => { if (!fin(f.trk)) return null; const b = E.brg(f.lat, f.lon, a.lat, a.lon); return E.angDiff(b, f.trk) < 45; };
  function observe(list, nowS, keep) {
    let n = 0;
    for (const f of list || []) {
      if (!f || !(f.id > 0) || !fin(f.lat) || !fin(f.lon)) continue;
      const ts = f.ts > 1e9 ? f.ts : nowS, fid = Number(f.id).toString(16);
      // (the airports within 25 km - and only the one it says it left or is going to, where it says)
      const aps = near(f.lat, f.lon, f.gnd ? 4 : 25); if (!aps.length) { const s0 = fl.get(f.id); if (s0) s0.seen = nowS; continue; }
      let st = fl.get(f.id); if (!st) { st = { pts: [], gAp: 0, gT: 0, dep: false, arrAgl: Infinity, seen: nowS }; fl.set(f.id, st); }
      st.seen = nowS;
      // (where it was a scan before - kept or not: climbing or not)
      const prev = st.last && ts - st.last.t <= 600 ? st.last : null; st.last = { t: ts, alt: f.gnd ? null : f.alt, gnd: !!f.gnd };
      const p = { t: ts, lat: f.lat, lon: f.lon, alt: f.gnd ? null : f.alt, gnd: !!f.gnd, gs: f.spd, trk: f.trk };
      if (f.gnd) { st.gAp = aps[0].a.id; st.gT = ts; st.gLat = f.lat; st.gLon = f.lon; st.gTrk = fin(f.trk) ? f.trk : null; }
      // (FR24's own positions of it there - kept, the track of every flight where it meets an airport)
      if (keepPt(f, aps[0].a, aps[0].d)) { if (!st.pts.length || st.pts[st.pts.length - 1].t < ts) { st.pts.push(p); if (keep) keep(f, p); } }
      st.pts = st.pts.filter(q => ts - q.t <= 900);
      if (f.gnd) continue;
      for (const { a } of aps.slice(0, 4)) {
        const agl = fin(f.alt) ? f.alt - (a.alt || 0) : Infinity; if (agl > 5000) continue;
        const iata = String(a.iata || '').toUpperCase(), fromHere = !f.from || String(f.from).toUpperCase() === iata, toHere = !f.to || String(f.to).toUpperCase() === iata;
        // a take-off: off the ground here a moment ago, or climbing out along a runway of the field it says it left
        const leftHere = st.gAp === a.id && ts - st.gT < 900;
        if (!st.dep && (leftHere || (f.from && fromHere)) && away(f, a) !== false) {
          // (1.2.8: its roll as kept - on the ground and moving fast, along the runway - with its climb: the roll is where
          // the runway shows, a stand-in at rest at its last ground position said nothing)
          const roll = st.pts.filter(q => q.gnd && q.gs > 30 && q.t >= st.gT - 300);
          const pts = leftHere ? (roll.length ? roll : [{ t: st.gT, lat: st.gLat, lon: st.gLon, alt: null, gnd: true, gs: 0, trk: st.gTrk != null ? st.gTrk : f.trk }]).concat(st.pts.filter(q => q.t > st.gT && !q.gnd)) : st.pts.filter(q => !q.gnd);
          const r = APT.runwayOf(a, pts.length ? pts : [p], false);
          if (r) { if (put(fid, 0, r, a.id, (pts.find(q => !q.gnd) || p).t, 'live')) { stats.live.dep++; n++; } st.dep = true; st.depAp = a.id; st.depT = ts; break; }
        }
        // a landing: on the final approach to a runway of the field it is going to (not climbing out of it - with no
        // route of FR24's to say where it goes, not higher than it was a scan before)
        const climbing = !f.to && !!prev && !prev.gnd && fin(prev.alt) && fin(f.alt) && f.alt > prev.alt + 100;
        if (toHere && !climbing && toward(f, a) !== false && !(st.depAp === a.id && ts - st.depT < 900) && agl < 4000 && agl < st.arrAgl - 150) {
          const r = APT.runwayOf(a, [p], true);
          if (r) { if (put(fid, 1, r, a.id, ts, 'live')) { stats.live.arr++; n++; } st.arrAgl = agl; break; }
        }
      }
    }
    for (const [id, st] of fl) if (nowS - st.seen > 1800) fl.delete(id);
    stats.flights = fl.size;
    return n;
  }

  // ---- kept on disk -----------------------------------------------------------------------------------------------
  function save(nowS) {
    nowS = nowS || Date.now() / 1000;
    const keepMem = memFrom(nowS);
    for (const [d, b] of days) {
      if (b.dirty) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          const ap = {}; for (const [id, m] of b.ap) ap[id] = Object.fromEntries(m);
          const tmp = file(d) + '.tmp'; fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify({ v: RL_V, day: d, ap }), { level: 6 })); fs.renameSync(tmp, file(d));
          b.dirty = false; stats.written++;
        } catch (e) { stats.err = String(e && e.message || e).slice(0, 120); log(stats.err); }
      }
      // (an older day read for an answer: let go after ten minutes; the days in memory kept)
      if (!b.dirty && d < keepMem && Date.now() - b.used > 600000) { for (const m of b.ap.values()) for (const k of m.keys()) { const x = idx.get(k); if (x && dayOf(x[2]) === d) idx.delete(k); } days.delete(d); }
    }
    prune(nowS);
  }
  function prune(nowS) {
    const cut = dayOf(nowS - keepDays * 86400); let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return 0; }
    let n = 0;
    for (const f of names) { const m = /^(\d{4}-\d\d-\d\d)\.json\.gz$/.exec(f); if (m && m[1] < cut) { try { fs.unlinkSync(path.join(dir, f)); n++; } catch (e) { /* gone */ } } }
    stats.pruned += n;
    return n;
  }
  // (the days in memory read back after a restart)
  function load(nowS) { nowS = nowS || Date.now() / 1000; for (let k = memDays - 1; k >= 0; k--) bucket(dayOf(nowS - k * 86400), false); return idx.size; }
  return { put, get, airport, movements, fromTrack, observe, save, load, prune, stats, get size() { return idx.size; }, _fl: fl };
}
module.exports = { createRwyLog };
