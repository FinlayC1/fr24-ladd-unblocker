'use strict';
// (1.4.3) FR24's own whole track of every flight it can get, kept with the rest of FR24's positions (fr24raw) - so a
// flight played after FR24's week (or one FR24 hides) is drawn from FR24's track, as FR24's own player draws it, not
// rebuilt from public ADS-B. The scans keep a position of each flight every minute or three; FR24's track has every
// point. Three ways in:
//   - as a flight comes down (the scans see it low after it was up): FR24's trail of it (FollowFlight - what FR24's site
//     reads for a flight it follows), asked once it is down, while FR24 still has it live. As many as FR24 allows: a few
//     a minute (CFG.fr24Keep.perMin), the flights browsers asked about first, then light aircraft, helicopters and those
//     in the monitor's areas, then the rest; FR24 pushing back pauses it with the scans
//   - a flight that has ended, asked about by a browser while its kept positions are few: FR24's playback of it (its
//     week), a few a minute at most (pbPerMin), paused an hour when FR24 refuses
//   - a browser that read FR24's track of a flight (its playback, FR24's week) sends it (POST /fr24track): kept only when
//     it agrees with the monitor's own positions of that flight - at least two of them, four in five within 3 km of the
//     track at their time - so nobody can put a made-up track in its place. 120 an hour from one address at most
// Every way puts the points in fr24raw, each second once (the one with more figures kept).
const fin = v => typeof v === 'number' && isFinite(v);

function createFr24Keep(env) {
  const C = Object.assign({ perMin: 10, pbPerMin: 3, queueMax: 6000, pbQueueMax: 3000, crowdPerHour: 120, dueS: 150, pbDays: 7 }, env.cfg || {});
  const now = () => (env.now ? env.now() : Date.now());
  const log = env.log || (() => {});
  const S = { followed: 0, followEmpty: 0, followFail: 0, kept: 0, points: 0, pb: 0, pbFail: 0, pbKept: 0, crowd: 0, crowdBad: 0, crowdNoOwn: 0, crowdLimited: 0, queued: 0, dropped: 0, pausedUntil: 0, pbPausedUntil: 0, err: '' };
  const seen = new Map();                 // FR24 id -> { air, at, queued, meta, prio }
  const q = [];                           // { id, due, prio, meta }
  const pbq = new Map();                  // fid hex -> { t, at }
  const wanted = new Map();               // fid hex -> when a browser asked (first in the queues for a day)
  const crowdIp = new Map();              // address -> [times]
  const doneIds = new Map();              // FR24 id -> when its whole track was kept (not asked again for a day)

  // ---- as flights come down ----------------------------------------------------------------------------------------
  // (every flight a scan sees: up - over 1,500 ft, faster than 120 kt, or a helicopter's 700 ft at 50 kt - then coming down
  // below 800 ft, or on the ground: its trail asked C.dueS seconds later, down by then)
  function watch(list, nowMs) {
    nowMs = nowMs || now();
    for (const f of list || []) {
      if (!f || !(f.id > 0) || f.src === 4) continue;
      let s = seen.get(f.id);
      if (!s) { if (seen.size > 120000) continue; s = { air: false, at: nowMs, queued: false }; seen.set(f.id, s); }
      s.at = nowMs;
      const prev = s.alt; s.alt = f.gnd ? 0 : fin(f.alt) ? f.alt : prev;
      if (!f.gnd && ((fin(f.alt) && f.alt > 1500) || (fin(f.spd) && f.spd > 120) || (fin(f.alt) && f.alt > 700 && fin(f.spd) && f.spd > 50))) s.air = true;
      if (!s.air || s.queued || doneIds.has(f.id)) continue;
      const low = !!f.gnd || (fin(f.alt) && f.alt <= 300 && (!fin(f.spd) || f.spd < 60)) || (fin(f.alt) && f.alt <= 800 && fin(prev) && f.alt < prev - 50 && (!fin(f.spd) || f.spd < 220));
      if (!low) continue;
      s.queued = true;
      add({ id: f.id, due: nowMs + C.dueS * 1000, prio: env.prio ? env.prio(f) : 2, meta: env.meta ? env.meta(f) : {} });
    }
    if (nowMs - (watch.pruned || 0) > 600000) { watch.pruned = nowMs; for (const [id, s] of seen) if (nowMs - s.at > 45 * 60000) seen.delete(id); for (const [id, t] of doneIds) if (nowMs - t > 86400e3) doneIds.delete(id); for (const [k, t] of wanted) if (nowMs - t > 86400e3) wanted.delete(k); }
  }
  function add(x) {
    const hx = x.id.toString(16); if (wanted.has(hx)) x.prio = 0;
    q.push(x); S.queued++;
    if (q.length > C.queueMax) {
      // (the least wanted, the oldest of them, goes)
      let w = 0; for (let i = 1; i < q.length; i++) if (q[i].prio > q[w].prio || (q[i].prio === q[w].prio && q[i].due < q[w].due)) w = i;
      q.splice(w, 1); S.dropped++;
    }
  }
  function nextDue(nowMs) {
    let b = -1; for (let i = 0; i < q.length; i++) { const x = q[i]; if (x.due > nowMs) continue; if (b < 0 || x.prio < q[b].prio || (x.prio === q[b].prio && x.due > q[b].due)) b = i; }
    return b < 0 ? null : q.splice(b, 1)[0];
  }
  // (one flight's trail: FR24's whole track of it so far - kept when it has more than the scans did)
  async function followOne(nowMs) {
    nowMs = nowMs || now();
    if (nowMs < S.pausedUntil || !env.follow) return 0;
    const x = nextDue(nowMs); if (!x) return 0;
    let pts = [];
    try { pts = await env.follow(x.id); } catch (e) {
      if (/paused/.test(String(e))) { x.due = nowMs + 60000; q.push(x); S.pausedUntil = nowMs + 60000; return 0; }
      S.followFail++; S.err = String(e && e.message || e).slice(0, 160); return 0;
    }
    S.followed++;
    const good = (pts || []).filter(p => p && fin(p.t) && fin(p.lat) && fin(p.lon));
    if (good.length < 2) { S.followEmpty++; return 0; }
    env.put(x.id, x.meta || {}, good.map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt: fin(p.alt) ? p.alt : null, gs: fin(p.gs) ? p.gs : null, trk: fin(p.trk) ? p.trk : null, gnd: !(p.alt > 0) && !(p.gs > 50) })));
    doneIds.set(x.id, nowMs); S.kept++; S.points += good.length;
    return good.length;
  }

  // ---- a flight that has ended, asked about by a browser -----------------------------------------------------------
  // (its kept positions few - fewer than 30, or over a minute apart halfway through - and within FR24's week: FR24's
  // playback of it asked for)
  function sparse(r) {
    const p = r && Array.isArray(r.p) ? r.p : []; if (p.length < 30) return true;
    const gaps = []; for (let i = 1; i < p.length; i++) gaps.push(p[i][0] - p[i - 1][0]);
    gaps.sort((a, b) => a - b); return gaps[Math.floor(gaps.length / 2)] > 60;
  }
  function want(fid, t, r) {
    fid = String(fid || '').toLowerCase(); if (!/^[0-9a-f]{1,12}$/.test(fid)) return;
    const nowMs = now(); if (!wanted.has(fid)) wanted.set(fid, nowMs);
    const id = parseInt(fid, 16);
    for (const x of q) if (x.id === id) x.prio = 0;
    if (doneIds.has(id) || !sparse(r)) return;
    const last = r && r.p && r.p.length ? r.p[r.p.length - 1][0] : fin(t) ? t : 0;
    // (in the air still, or ended over FR24's week ago: not FR24's playback's)
    if (!(last > 0) || nowMs / 1000 - last < 1200 || nowMs / 1000 - last > C.pbDays * 86400) return;
    if (pbq.has(fid)) return;
    pbq.set(fid, { t: fin(t) && t > 1e9 ? t : last, at: nowMs });
    if (pbq.size > C.pbQueueMax) pbq.delete(pbq.keys().next().value);
  }
  async function playbackOne(nowMs) {
    nowMs = nowMs || now();
    if (nowMs < S.pbPausedUntil || !env.playback || !pbq.size) return 0;
    // (the latest asked first)
    const fid = [...pbq.keys()].pop(), x = pbq.get(fid); pbq.delete(fid);
    let r = null;
    try { r = await env.playback(fid, x.t); } catch (e) {
      S.pbFail++; S.err = String(e && e.message || e).slice(0, 160);
      if (e && e.refused) { S.pbPausedUntil = nowMs + 3600e3; log('FR24 refused its playback: paused an hour', S.err); }
      return 0;
    }
    S.pb++;
    if (!r || !Array.isArray(r.pts) || r.pts.length < 2) return 0;
    const id = parseInt(fid, 16); env.put(id, r.m || {}, r.pts); doneIds.set(id, nowMs); S.pbKept++; S.points += r.pts.length;
    return r.pts.length;
  }

  // ---- a browser's copy of FR24's track ----------------------------------------------------------------------------
  // d: { v: 1, fid, m: { hex, reg, cs, type, fn, from, to }, p: [[t, lat, lon, alt, gs, trk, gnd], ...] }
  const dist = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return R * Math.sqrt(x * x + y * y); };
  function crowd(d, ip) {
    const nowMs = now(), nowS = nowMs / 1000;
    if (!d || d.v !== 1) return { ok: false, why: 'form' };
    const fid = String(d.fid || '').toLowerCase(); if (!/^[0-9a-f]{1,12}$/.test(fid)) return { ok: false, why: 'id' };
    const L = crowdIp.get(ip) || []; while (L.length && nowMs - L[0] > 3600e3) L.shift();
    if (L.length >= C.crowdPerHour) { S.crowdLimited++; return { ok: false, why: 'limit' }; }
    L.push(nowMs); crowdIp.set(ip, L); if (crowdIp.size > 5000) crowdIp.delete(crowdIp.keys().next().value);
    const rows = Array.isArray(d.p) ? d.p.slice(0, 20000) : [], pts = [];
    let lastT = 0;
    for (const r of rows) {
      if (!Array.isArray(r) || !fin(r[0]) || !fin(r[1]) || !fin(r[2]) || Math.abs(r[1]) > 90 || Math.abs(r[2]) > 180 || r[0] <= lastT) continue;
      if (r[0] < nowS - 40 * 86400 || r[0] > nowS + 600) continue;
      lastT = r[0];
      const alt = fin(r[3]) && r[3] >= -2000 && r[3] < 70000 ? Math.round(r[3]) : null, gs = fin(r[4]) && r[4] >= 0 && r[4] < 1500 ? Math.round(r[4]) : null, trk = fin(r[5]) && r[5] >= 0 && r[5] <= 360 ? Math.round(r[5]) : null;
      pts.push({ t: Math.round(r[0]), lat: Math.round(r[1] * 1e5) / 1e5, lon: Math.round(r[2] * 1e5) / 1e5, alt, gs, trk, gnd: r[6] === 1 || (alt === 0 && !(gs > 50)) });
    }
    if (pts.length < 2) { S.crowdBad++; return { ok: false, why: 'points' }; }
    // (the monitor's own positions of the flight, from its scans: the track must pass by them)
    const own = env.own ? env.own(fid, pts[0].t) : null, op = own && Array.isArray(own.p) ? own.p.filter(r => r[0] >= pts[0].t - 60 && r[0] <= pts[pts.length - 1].t + 60) : [];
    if (op.length < 2) { S.crowdNoOwn++; return { ok: false, why: 'unknown' }; }
    let near = 0, i = 0;
    for (const r of op) {
      while (i + 1 < pts.length && pts[i + 1].t < r[0]) i++;
      const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)], f = b.t > a.t ? Math.min(1, Math.max(0, (r[0] - a.t) / (b.t - a.t))) : 0;
      const lat = a.lat + (b.lat - a.lat) * f, lon = a.lon + (b.lon - a.lon) * f;
      if (dist(lat, lon, r[1], r[2]) <= 3) near++;
    }
    if (near < op.length * 0.8) { S.crowdBad++; return { ok: false, why: 'disagrees' }; }
    const m = {}; for (const k of ['hex', 'reg', 'cs', 'type', 'fn', 'from', 'to']) if (d.m && typeof d.m[k] === 'string' && /^[A-Za-z0-9-]{1,16}$/.test(d.m[k])) m[k] = d.m[k];
    const id = parseInt(fid, 16); env.put(id, m, pts); doneIds.set(id, nowMs); pbq.delete(fid);
    S.crowd++; S.points += pts.length;
    return { ok: true, n: pts.length };
  }
  const stats = () => Object.assign({}, S, { waiting: q.length, pbWaiting: pbq.size, watching: seen.size });
  return { watch, followOne, want, playbackOne, crowd, sparse, stats, S, get queue() { return q; }, get pbQueue() { return pbq; } };
}

// FR24's playback answer (common/v1/flight-playback.json) as points and what it says of the flight
function playbackPts(j) {
  const fl = j && j.result && j.result.response && j.result.response.data && j.result.response.data.flight, tr = fl && fl.track;
  if (!Array.isArray(tr)) return null;
  const pts = [];
  for (const p of tr) {
    if (!p || !fin(p.latitude) || !fin(p.longitude) || !fin(p.timestamp)) continue;
    const alt = p.altitude && fin(p.altitude.feet) ? p.altitude.feet : null, gs = p.speed && fin(p.speed.kts) ? p.speed.kts : null;
    pts.push({ t: p.timestamp, lat: p.latitude, lon: p.longitude, alt, gs, trk: fin(p.heading) ? p.heading : null, vr: p.verticalSpeed && fin(p.verticalSpeed.fpm) ? p.verticalSpeed.fpm : null, sq: typeof p.squawk === 'string' && /^[0-7]{4}$/.test(p.squawk) ? p.squawk : null, gnd: alt === 0 && !(gs > 50) });
  }
  pts.sort((a, b) => a.t - b.t);
  const idn = (fl && fl.identification) || {}, ac = (fl && fl.aircraft) || {}, ap = (fl && fl.airport) || {}, code = x => (x && x.code && (x.code.iata || x.code.icao)) || '';
  const m = { cs: idn.callsign || '', fn: (idn.number && idn.number.default) || '', reg: (ac.identification && ac.identification.registration) || '', hex: String((ac.identification && ac.identification.modes) || '').toLowerCase(), type: (ac.model && ac.model.code) || '', from: code(ap.origin), to: code(ap.destination) };
  return { pts, m };
}
module.exports = { createFr24Keep, playbackPts };
