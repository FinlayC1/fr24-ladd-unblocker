
  // ---- live state of the tracked flights -------------------------------------------------------------------------------
  const routeState = new Map();   // fr24 id -> { hex, working, route, maxAlt, landedAt }
  const planState = new Map();    // fr24 id -> { plan, at, tried, searchKey }
  const posHistory = new Map();   // fr24 id -> recent FollowFlight positions
  const fr24Trail = new Map();    // fr24 id -> { pts, first, maxAlt, at } from the FollowFlight stream
  function acOf(rec) {
    const hx = rec && rec.hex ? store.getHex(rec.hex) || {} : {};
    const c = rec && rec.hex ? countryOf(rec.hex, rec.reg) : null;
    const tl = rec ? telemetry.get(rec.id) : null;
    return { hex: rec && rec.hex || '', reg: rec && rec.reg || '', cs: rec && rec.cs || '', ladd: !!((rec && rec.ladd) || hx.ladd), pia: !!((rec && rec.pia) || hx.pia), type: (rec && rec.type) || hx.type || '', cat: (rec && rec.cat) || hx.cat || (tl && tl.cat) || '', mil: !!((rec && rec.mil) || hx.mil), country: apCountry(c ? c.name : ((rec && rec.country) || '')) };
  }
  function currentPos(id) {
    let h = posHistory.get(id) || [];
    // (this flight id's positions, or - none for a minute and more - those of another id of the same airframe heard since:
    // FR24 can carry on an aircraft under a new flight id once it is airborne while the panel follows the old one. N900YB,
    // at FL370 over the Hebrides, was "on the ground at Dublin" - its id's last position, at the gate)
    const hx = hexOfId(id);
    if (hx && (!h.length || now() - h[h.length - 1].at > 60000)) for (const [k, v] of posHistory) if (k !== id && v.length && now() - v[v.length - 1].at < 90000 && hexOfId(k) === hx && (!h.length || v[v.length - 1].at > h[h.length - 1].at)) { h = v; break; }
    const last = h[h.length - 1], f = pending.get(id), tl = telemetry.get(id);
    let p = null;
    if (last && (!f || last.at >= (f.receivedAt || 0) - 2000)) p = { t: Math.floor(last.at / 1000), lat: last.lat, lon: last.lon, alt: last.alt, trk: last.trk, gs: last.spd, gnd: last.gnd };
    else if (f) p = { t: Math.floor((f.receivedAt || now()) / 1000), lat: f.lat, lon: f.lon, alt: f.alt, trk: f.trk, gs: f.spd, gnd: f.gnd };
    // (and the airframe's public ADS-B position when that is newer by half a minute and more than anything FR24 gave)
    { const rr = live.get(id) || pubRecs.get(id), c = (rr && rr.hex) || hx ? areaCache.get((rr && rr.hex) || hx) : null; if (c && fin(c.lat) && now() - seenAt(c) < 120000 && (!p || !fin(p.lat) || seenAt(c) > p.t * 1000 + 30000)) p = { t: Math.floor(seenAt(c) / 1000), lat: c.lat, lon: c.lon, alt: c.alt, trk: c.trk, gs: c.gs, gnd: !!c.gnd }; }
    // (and the last report of its ADS-B track of today when that is newer still: a jet that landed and went quiet at the
    // stand - FR24 no longer sending it - is on the ground there, not "estimated" at its last airborne fix: OK-FLN, down at
    // Luton at 15:26, still "Estimated arrival 16:26" 30 minutes later)
    { const hx2 = (live.get(id) || pubRecs.get(id) || {}).hex || hx, td = hx2 ? todayCache.get(hx2) : null, q = td && td.lastPt;
      if (q && fin(q.lat) && (!p || !(q.t <= p.t)) && now() / 1000 - q.t < 6 * 3600) p = { t: q.t, lat: q.lat, lon: q.lon, alt: q.gnd0 ? 0 : q.alt, trk: q.trk, gs: q.gs, gnd: !!(q.gnd || q.gnd0) }; }
    if (!p || !fin(p.lat)) return null;
    // (very low and slow is on the ground for an aeroplane; a helicopter hovers - only its transponder's or FR24's word
    // counts, and not while it moves at more than a walking pace)
    if (isHeliId(id)) p.gnd = !!p.gnd && !(fin(p.gs) && p.gs > 5);
    else if (p.gnd || (fin(p.alt) && p.alt < 50 && p.gs < 45)) p.gnd = true;
    if (tl && now() - (tl.at || 0) < 180000) { p.vr = tl.vr; p.mcp = tl.mcp; p.fms = tl.fms; p.sq = tl.sqs || ''; p.tas = tl.tas; p.ws = tl.ws; p.wd = tl.wd; }
    if (!fin(p.vr)) {
      // vertical rate from our own position history when the transponder did not give one
      const src = h.length > 1 ? h.map(x => ({ t: x.at / 1000, alt: x.alt })) : (feedTrail.get(id) || []);
      for (let i = src.length - 1; i >= 0; i--) { if (p.t - src[i].t >= 40 && fin(src[i].alt) && fin(p.alt)) { p.vr = (p.alt - src[i].alt) / ((p.t - src[i].t) / 60); break; } }
    }
    return p;
  }
  // a helicopter? (from the record of that flight id: its type, category)
  const heliIds = new Map();
  function isHeliId(id) {
    const rr = live.get(id) || pubRecs.get(id); if (!rr) return false;
    const k = (rr.type || '') + '|' + (rr.cat || ''), c = heliIds.get(id); if (c && c.k === k) return c.v;
    const v = ENGINE.classify(acOf(rr)) === 'heli'; heliIds.set(id, { k, v }); if (heliIds.size > 3000) heliIds.delete(heliIds.keys().next().value);
    return v;
  }
  // (what to say of a helicopter's take-off from a site: its name when it has one - London Heliport, Southmead Hospital)
  const siteTakeoffNote = sp => sp.known === 'platform' ? 'took off from an offshore platform' : sp.name && !/^Private site/.test(sp.name) ? 'took off from ' + sp.name : 'took off from a private site';
  // FR24's trail points as the engine reads them. FR24 leaves out a height it does not have, so the point reads 0 ft: on
  // the ground when slow, on the runway when at a field just after being low over it - but at speed away from every
  // airfield, or just after being heard far above the field it is over, it has no height at all. KSK16 (a Challenger 605,
  // 15 Oct) climbed out of Ankara and was lost by FR24 south-west of it; a point of that kind after the climb, at "0 ft",
  // was taken for a landing in a hole in coverage, the take-off was cut off with it, and the panel said "departure
  // unknown, first seen at FL368" (test/unit_ksk16.cjs).
  function fr24Pts(pts, heli, gndKt) {
    let real = null;
    return pts.map(p => {
      const q = { t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs, trk: p.trk, gnd: p.alt <= 0 && p.gs < (gndKt || (heli ? 3 : 50)) };
      if (p.alt > 0) real = p;
      else if (!q.gnd && !heli && fin(p.lat) && fin(p.lon)) {
        const fa = ENGINE.placeAt(p.lat, p.lon, 8, 3);
        if (!fa || (real && p.t - real.t < 180 && real.alt - (fa.airport.alt || 0) > 3000)) q.alt = null;
      }
      return q;
    });
  }
  // The flight's track so far: adsb.lol's trace of the current leg (it usually starts on the runway), then FR24's
  // own trail, then whatever the feed has shown us.
  function trailFor(id, hex, pos) {
    const tr = fr24Trail.get(id), ft = feedTrail.get(id) || [], td = hex ? todayCache.get(hex) : null;
    let out = [], cut = false, gapFrom = null, gapInfo = null;
    if (td && td.legs && td.legs.length && pos) {
      const leg = td.legs.filter(l => l.start.t <= pos.t + 60).pop();
      const legLast = leg ? (leg.pts.length ? leg.pts[leg.pts.length - 1] : leg.start) : null;
      // FR24 began this flight after adsb.lol's leg had gone quiet: it landed out of adsb.lol's sight in between. TC-TSS,
      // lost descending into Misrata and off again under a new FR24 flight, was still "from Paris" on the next leg.
      const newer = !!(tr && tr.first && legLast && tr.first.t > legLast.t + 600);
      if (leg && !newer && (!leg.ended || leg.end.t >= pos.t - 900)) {
        out = [leg.start].concat(leg.pts).filter(p => p.t <= pos.t + 5);
        // (a later leg of the day after a landing seen - on the ground, a touch-and-go, down into a hole in coverage and up
        // out of it: whatever came before is another leg)
        const pl = td.legs[td.legs.indexOf(leg) - 1]; cut = !!pl && ['ground', 'touch', 'gap-land'].includes(pl.how);
        if (pl && pl.how === 'gap-land') { gapFrom = pl.end; gapInfo = pl.gapInfo || null; }
      }
    }
    const lastT = out.length ? out[out.length - 1].t : 0;
    const firstT = out.length ? out[0].t : Infinity;
    const hv = isHeliId(id), fr = tr && tr.pts ? fr24Pts(tr.pts, hv) : [];
    if (fr.length && fr[0].t < firstT - 120) out = fr.filter(p => p.t < firstT).concat(out);
    // (FR24's very first point of this flight - where it began - always leads)
    if (tr && tr.first && fin(tr.first.lat) && (!out.length || tr.first.t < out[0].t - 60)) out.unshift(fr24Pts([tr.first], hv, 50)[0]);
    out = out.concat(fr.filter(p => p.t > lastT + 10));
    // FR24's own points where adsb.lol has a hole (out of its coverage): a landing and take-off there is then seen
    if (fr.length && out.length > 1) {
      const ts = out.map(p => p.t), add = [];
      for (const p of fr) {
        let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < p.t) lo = m + 1; else hi = m; }
        if (lo > 0 && lo < ts.length && ts[lo] - ts[lo - 1] > 300 && p.t - ts[lo - 1] > 30 && ts[lo] - p.t > 30) add.push(p);
      }
      if (add.length) out = out.concat(add).sort((x, y) => x.t - y.t);
    }
    if (!out.length) out = ft.map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs, trk: p.trk, gnd: p.gnd }));
    else out = out.concat(ft.filter(p => p.t > out[out.length - 1].t + 10));
    // (and where it is now, when nothing has been heard of it for ten minutes and more: a leg that went quiet long before
    // - lost low at the field it was landing at, now off again out of sight - is then cut off below like any landing in a
    // hole. G-JDPB, lost by adsb.lol at 900 ft and 58 kt by Sleap at 12:23 and off again at 14:02, FR24's track of the new
    // flight not yet in, was "seen climbing out of Chester, 11:41" - its morning departure)
    if (pos && fin(pos.lat) && fin(pos.t) && out.length && pos.t - out[out.length - 1].t > 600) out.push({ t: pos.t, lat: pos.lat, lon: pos.lon, alt: pos.alt, gs: pos.gs, trk: pos.trk, gnd: !!pos.gnd });
    // (FR24 began this flight low at an airfield - it saw it down there, a touch-and-go or a quick stop - while adsb.lol's
    // leg runs on from before: the flight starts there. SFY5LW, back at Gloucester from a touch-and-go at Cardiff and into
    // the circuit, was "from Cardiff")
    // (or begun climbing out of one: a touch-and-go there, FR24's first point of the new flight already at 1,650 ft, 2 km
    // off the runway)
    if (tr && tr.first && fin(tr.first.lat) && out.length && out[0].t < tr.first.t - 300 && (tr.first.alt == null || tr.first.alt < 4000)) {
      const fa = ENGINE.placeAt(tr.first.lat, tr.first.lon, 8, 3), agl = fa && tr.first.alt != null ? tr.first.alt - (fa.airport.alt || 0) : 0;
      const nxt = tr.pts && tr.pts.find(p => p.t > tr.first.t + 20 && p.t < tr.first.t + 180), climbing = !!nxt && nxt.alt != null && tr.first.alt != null && nxt.alt > tr.first.alt + 100;
      if (fa && (agl < 1000 || (agl < 3000 && climbing && fa.dist < 8))) { out = out.filter(p => p.t >= tr.first.t - 5); cut = true; gapFrom = null; gapInfo = null; }
    }
    // This leg only. FR24 keeps one flight id through a quick turnaround, and its trail - or the older points put in
    // front - can hold the previous leg: M-ARNZ, just airborne out of Barrow, was still "Farnborough -> Barrow, 100%".
    // The track starts again at the last take-off (on the ground, then airborne) or after a gap in which it came down.
    // (or a gap it cannot have flown through: 20 minutes and more at under 150 km/h on average - it was on the ground
    // somewhere in between; helicopters, which hover, only after 40)
    const rr = live.get(id) || pubRecs.get(id), cls1 = rr ? ENGINE.classify(acOf(rr)) : '';
    const cl = ENGINE.currentLeg(out, { heli: cls1 === 'heli', patrol: cls1 === 'fighter' || cls1 === 'milheavy' });
    if (cl.cut) { out = cl.pts; cut = true; gapFrom = cl.gapFrom; gapInfo = cl.gapInfo; }
    const thin = []; for (const p of out) if (!thin.length || p.t - thin[thin.length - 1].t >= 15) thin.push(p);
    thin.cut = cut;   // (the track was cut at a landing: whatever came before is another leg)
    // (gone quiet and heard again at the very spot, low and slow both times: it stood there - its take-off was from there)
    if (thin.length && !thin[0].gnd && gapFrom && fin(gapFrom.lat) && dist(gapFrom.lat, gapFrom.lon, thin[0].lat, thin[0].lon) < 0.5 && fin(thin[0].alt) && thin[0].alt < 600 && !(thin[0].gs > 30) && fin(gapFrom.alt) && gapFrom.alt < 600) { thin[0] = Object.assign({}, thin[0], { gnd: true }); gapFrom = null; }
    thin.gapFrom = thin.length && !thin[0].gnd && gapFrom && gapFrom.t < thin[0].t ? gapFrom : null;   // (... one out of coverage: where it was last seen before - and before this track began, not inside it)
    // (and what was seen either side of that hole: going down into it, climbing out of it - from this track's first points,
    // which are not always the ones the leg was found climbing out in)
    thin.gapInfo = thin.gapFrom && thin.length ? Object.assign({}, gapInfo, { bClimb: ENGINE.gapEnds([thin.gapFrom].concat(thin), 1).bClimb, gap: thin[0].t - thin.gapFrom.t }) : null;
    return thin;
  }
  // ETA from distance, phase and speed: cruise at the current speed, then a slower descent and approach.
  function estimateEta(pos, dest, cls) {
    if (!pos || !dest || pos.gnd) return 0;
    const dKm = dist(pos.lat, pos.lon, dest.lat, dest.lon);
    // (the wind triangle: true airspeed and the wind give the ground speed along the course to it - a turn into a
    // headwind ahead is in the ETA before the aircraft has made it)
    const gsW = fin(pos.tas) && pos.tas > 60 && fin(pos.ws) && fin(pos.wd) ? ENGINE.gsAlong(ENGINE.brg(pos.lat, pos.lon, dest.lat, dest.lon), pos.tas, pos.ws, pos.wd) : NaN;
    const gs = fin(gsW) && gsW > 60 ? gsW : fin(pos.gs) && pos.gs > 60 ? pos.gs : 300;
    const descKm = Math.max(0, ((pos.alt || 0) - dest.alt) / 300 * NM_KM);
    const cruiseKm = Math.max(0, dKm - descKm), descentKm = dKm - cruiseKm;
    const h = cruiseKm / (gs * NM_KM) + descentKm / (Math.max(140, gs * 0.72) * NM_KM) + (cls === 'heli' ? 1 : 4) / 60;
    // 45 minutes out and more, a correction learned from 190,000 real moments of flight (test/eta_fit.cjs): it also
    // weighs the class's usual cruise speed and the phase of flight, where today's ground speed alone misleads (still
    // climbing, headwind at this level only). Held out: jets 2 h+ out 24 -> 19 min average error, 45-120 min 6.8 -> 6.0.
    const g = ENGINE.groupOf(cls), wv = ETA_W[g];
    if (wv && h * 60 >= 45) {
      const base = h * 60, vc = ETA_VC[g], vr = fin(pos.vr) ? pos.vr : 0, climb = vr > 500 ? 1 : 0, desc = vr < -500 ? 1 : 0;
      const x = [1, Math.log(base + 1), Math.log(dKm / NM_KM / vc * 60 + 1), climb, desc, Math.log(1 + Math.max(0, (pos.alt || 0) - dest.alt) / 1000), climb * Math.log(base + 1)];
      const m = Math.exp(x.reduce((s, v, i) => s + v * wv[i], 0)) - 1;
      // (from 3 h out the correction - learned on business jets - gives way to the physics: on 5 h+ legs it ran 85 min early,
      // the wind-triangle physics 10; held out, 22.10: all moments 14.1 -> 12.7 min, 50 kt+ winds 15.1 -> 11.2 - test/eta_wind.cjs)
      const bw = Math.min(1, Math.max(0, (base - 180) / 120));
      if (fin(m) && m > 0) return Math.round(nowS() + ((1 - bw) * m + bw * base) * 60);
    }
    return Math.round(nowS() + h * 3600);
  }
  const ETA_VC = { jet: 430, tprop: 270, piston: 140 };
  const ETA_W = { jet: [0.2336, 0.6075, 0.2763, 0.0185, -0.0044, 0.0997, -0.0046], piston: [0.3514, 1.1339, -0.1605, 0.6831, -0.2675, -0.0657, -0.2145], tprop: [-0.0668, 0.7706, 0.1469, -0.0696, -0.0664, 0.133, -0.0003] };
  function buildProgress(pos, originAp, destAp, departedAt, eta, stage) {
    if (!pos || !destAp) return null;
    const remainingKm = pos.gnd ? 0 : dist(pos.lat, pos.lon, destAp.lat, destAp.lon);
    const gcKm = originAp ? dist(originAp.lat, originAp.lon, destAp.lat, destAp.lon) : 0;
    const traversedKm = originAp ? dist(originAp.lat, originAp.lon, pos.lat, pos.lon) : 0;
    const remainingTime = pos.gnd ? 0 : (eta > nowS() ? Math.round(eta - nowS()) : 0);
    const elapsed = departedAt > 0 ? Math.max(0, nowS() - departedAt) : 0;
    return { traversed: Math.round(traversedKm * 1000), remaining: Math.round(remainingKm * 1000), elapsed, remainingTime, eta: eta || 0, greatCircle: Math.round(gcKm * 1000), stage, pct: gcKm ? Math.max(1, Math.min(99, Math.round(100 * traversedKm / (traversedKm + remainingKm)))) : 0 };
  }
  // what the strip says under a predicted airport: its own record first (home base, the same trip before, the return
  // leg), then the evidence that most sets it apart from the others (heading that way, fits the descent...)
  const whyOf = c => { const w = []; for (const s of (c && c.why || []).concat(c && c.reasons || [])) if (s && !w.includes(s)) w.push(s); return w.slice(0, 4).join(', '); };
  const CONF_OF = p => p >= 0.72 ? 'likely' : p >= 0.42 ? 'probable' : 'possible';
  // A flight's departure airport is worked out once: the best answer found for a flight id is kept with it (and in the
  // snapshot), so neither a refresh nor a moment with less track to go on can lose it. A later take-off under the same
  // id (touch-and-go, a quick turnaround) replaces it.
  const ORIGIN_RANK = { plan: 5, ground: 4, low: 3, climb: 2, history: 1 };
  function rememberOrigin(rec, o, t0, cut) {
    if (!rec || rec.id == null || rec.id < 0) return o;
    // (remembered from an earlier leg flown under the same flight id: this leg's track begins well after that take-off)
    if (rec.origin && rec.origin.departedAt && t0 && (cut || t0.gnd || (fin(t0.alt) && t0.alt < 3000)) && t0.t > rec.origin.departedAt + 1800) rec.origin = null;
    const m = rec.origin, rank = o && o.airport ? (ORIGIN_RANK[o.conf] || 0) : 0;
    const retook = o && o.airport && m && rank >= 3 && o.departedAt > (m.departedAt || 0) + 900;
    if (m && m.id && !retook && (ORIGIN_RANK[m.conf] || 0) > rank) { const a = apById(m.id); if (a) return { airport: a, conf: m.conf, note: m.note, departedAt: m.departedAt || 0 }; }
    if (o && o.airport && rank && (!m || m.id !== o.airport.id || m.conf !== o.conf || retook)) rec.origin = { id: o.airport.id, conf: o.conf, note: o.note, departedAt: o.departedAt || 0 };
    return o;
  }
  // After a refresh, a flight's stored route stands until the records it was computed from (its aircraft's history
  // summary and today's track) are read back from disk - a few ms - so nothing is recomputed from less than before.
  const bootHold = new Set();   // hex
  // One route answer from everything known right now. Pure computation - no requests - so it can run on every update.
  // The alternatives shown with a predicted destination: the next three, each with at least 2% of the engine's own odds
  // and 4% once scaled to what the shown odds leave (scaled: the top airport's odds were shown as they turn out, topP the
  // engine's own, destP the shown %). Never above the airport shown - D-CLUB was "Rotterdam 38%, also Amsterdam 44%".
  function altsOf(cands, destId, topP, destP, scaled) {
    const altK = scaled ? Math.min(3, Math.max(0, (1 - destP / 100) / (1 - topP))) : 1, altCap = destP ? Math.max(1, destP - 1) : 99;
    return cands.filter(c => c.airport.id !== destId).slice(0, 3).filter(c => c.p >= 0.02 && c.p * altK >= 0.04).map(c => ({ iata: apCode(c.airport), city: c.airport.city, p: Math.min(altCap, Math.round(c.p * altK * 100)) }));
  }
  // Vectored for an airport: the destination it was descending into, sure of it, minutes ago is not dropped because the
  // aircraft turned away onto a downwind leg or levelled off to be sequenced. N99GY, vectored round the east of Dublin
  // for runway 28, went from "Dublin 99%" to 74% levelling at 7,000 ft heading out over the Irish Sea, with Manchester
  // ahead. Held for 15 minutes from the last moment it was descending into it at 90% or more - while it stays within
  // 80 km and below 12,000 ft over it and is not climbing away (a go-around or a diversion lets it go).
  const termHold = new Map();      // flight id -> { apId, p, t }
  function holdTerminal(id, pos, pred, o) {
    const cands = pred && Array.isArray(pred.cands) ? pred.cands.slice() : [];
    if (!cands.length || o.heli || o.planned || /^(piston|fighter|milheavy)$/.test(o.cls || '')) return cands;
    const agl = a => fin(pos.alt) && a ? pos.alt - (a.alt || 0) : NaN, top = cands[0];
    if (top.p >= 0.9 && top.dist < 80 && agl(top.airport) < 12000 && pred.phase === 'descent') {
      // (the surest it has been in this spell)
      const h0 = termHold.get(id), same = h0 && h0.apId === top.airport.id && pos.t - h0.t <= 900 && pos.t >= h0.t;
      termHold.set(id, { apId: top.airport.id, p: same ? Math.max(h0.p, top.p) : top.p, t: pos.t });
      if (termHold.size > 3000) termHold.delete(termHold.keys().next().value);
    }
    const h = termHold.get(id); if (!h) return cands;
    if (pos.t - h.t > 900 || pos.t < h.t || (fin(pos.vr) && pos.vr > 500) || pos.gnd) { termHold.delete(id); return cands; }
    const i = cands.findIndex(c => c.airport.id === h.apId), c = cands[i];
    if (!c || c.dist > 80 || !(agl(c.airport) < 12000)) return cands;
    // (as sure as it was, less a little for each minute since)
    const want = Math.min(0.995, h.p - 0.003 * (pos.t - h.t) / 60); if (c.p >= want) return cands;
    const k = (1 - want) / Math.max(1e-9, 1 - c.p);
    return cands.map((x, j) => Object.assign({}, x, { p: j === i ? want : x.p * k })).sort((a, b) => b.p - a.p);
  }
  function composeRoute(id, hex, opts) {
    try { return composeRoute0(id, hex, opts); } catch (e) { const rr = live.get(id) || pubRecs.get(id); if (rr) rr.routeErr = String((e && e.message) || e).slice(0, 160); log('route failed', id, e); return null; }
  }
  function composeRoute0(id, hex, opts) {
    const rec0 = live.get(id) || pubRecs.get(id) || null, rec = rec0 || {};
    if (hex && bootHold.has(hex) && !(opts && opts.pos)) return null;
    const pos = (opts && opts.pos) || currentPos(id); if (!pos || !airportsReady()) return null;
    const ac = acOf(rec), cls = ENGINE.classify(ac), heli = cls === 'heli';
    const trail = (opts && opts.trail) || trailFor(id, hex, pos);
    const legStart = trail.length ? trail[0].t : pos.t;
    const hist = knownLegs(hex, { excludeOpen: true }).filter(l => l.tEnd < legStart - 60 && l.tEnd > legStart - ENGINE_HIST_DAYS * 86400);
    const hs = ENGINE.histStats(hist, pos.t);
    // (an ordinary flight: the departure airport FR24 itself shows, when it has one, stands)
    const plan = (planState.get(id) || {}).plan || schedPlan(id);
    const st = routeState.get(id) || {};
    let o0 = ENGINE.inferOrigin({ ac, pos, trail, hs, now: pos.t, plan });
    if (o0 && o0.conf === 'plan' && plan && plan.fr24) o0.note = plan.list ? `FR24's own schedule${plan.num ? ' (' + plan.num + ')' : ''}` : 'departure shown by FR24';
    // (a helicopter first heard low and slow - on its pad, rotors turning - lifted from right there: TKF1, 2 Oct, down at
    // a site by Cleveleys after leaving Warton, heard again there at 1 kt 18 minutes later - not "from Warton, out of
    // coverage", the field at the other end of the hole)
    const t0 = trail[0], heliSlow0 = heli && !!t0 && !t0.gnd && fin(t0.alt) && t0.alt < 600 && (!fin(t0.gs) || t0.gs < 30);
    // (no departure seen - or only its log's last landing: it came down into a hole in coverage and climbed out of it,
    // so it took off from the field that fits both ends, a few minutes before it was seen again)
    if ((!o0 || !o0.airport || o0.conf === 'history') && trail.gapFrom && trail[0] && !heliSlow0) {
      const g = ENGINE.landingInGap(trail.gapFrom, trail[0], Object.assign({ cls: ENGINE.classify(ac), type: ac.type }, trail.gapInfo));
      if (g) { o0 = { airport: g.airport, conf: 'low', note: `took off from ${apCode(g.airport)}, out of ADS-B coverage`, departedAt: Math.round(trail[0].t - g.db / 500 * 3600 - 120) }; }
    }
    // (a take-off it cannot have made: from there at that time it could not be where it is now, at any speed it has
    // flown. G-IOOS, a helicopter at 137 kt over Swansea Bay at 08:33Z, was "took off from MAN, 08:09Z" - 230 km in 24
    // minutes - while FR24 had been showing it on its way from the Welsh border since before 08:00. Not kept, not shown.)
    const vMax = Math.max(100, fin(pos.gs) ? pos.gs : 0, ...trail.map(p => fin(p.gs) && p.gs < 700 ? p.gs : 0)) * 1.852 * 1.5;
    const couldHave = o => !o || !o.airport || !(o.departedAt > 0) || pos.t <= o.departedAt || ENGINE.dist(o.airport.lat, o.airport.lon, pos.lat, pos.lon) <= 30 + vMax * (pos.t - o.departedAt) / 3600;
    if (rec0 && rec0.origin && rec0.origin.id && !couldHave({ airport: apById(rec0.origin.id), departedAt: rec0.origin.departedAt })) rec0.origin = null;
    // (or one kept from a flight before this one: before the aircraft was last heard ahead of the hole this track began
    // after, or during a flight of its log that was over before the track began - N6012C's Hanoi, kept for the id that went
    // on to fly from Baku)
    const earlier = t => t > 0 && ((trail.gapFrom && t < trail.gapFrom.t - 300) || hist.some(l => t > l.tStart - 600 && t < l.tEnd));
    if (rec0 && rec0.origin && earlier(rec0.origin.departedAt)) rec0.origin = null;
    const f0 = trail[0] || pos, unseen = { airport: null, conf: '', note: fin(f0.alt) ? `first seen at ${f0.alt >= 18000 ? 'FL' + Math.round(f0.alt / 100) : Math.round(f0.alt) + ' ft'}` : 'first seen airborne', departedAt: 0 };
    let origin = rememberOrigin(rec0, couldHave(o0) ? o0 : unseen, trail[0], !!trail.cut);
    if (!couldHave(origin)) origin = unseen;
    const maxAltSeen = Math.max(st.maxAlt || 0, ...trail.map(p => p.alt || 0));
    const r = { computedAt: now(), quick: !!(opts && opts.quick), onGround: !!pos.gnd, landed: false, originId: 0, destId: 0, destConf: '', destReason: '', originNote: '', originConf: '', alternatives: [], phase: '', std: 0, sta: 0, atd: 0, ata: 0, eta: 0, etd: 0, departedAt: 0, groundAirportId: 0, progress: null, legCount: hs.n, base: hs.base ? apCode(apById(hs.base)) : '' };
    const setO = (a, note, conf) => { if (!a) return; r.originId = a.id; r.originIata = apCode(a); r.originCity = a.city || a.name; r.originNote = note || ''; r.originConf = conf || ''; };
    const setD = (a, conf, reason) => { if (!a) return; r.destId = a.id; r.destIata = apCode(a); r.destCity = a.city || a.name; r.destConf = conf; r.destReason = reason || ''; };
    // a place away from every listed airport (helicopter pads, fields, private strips): shown as its code and name
    const setOSite = (s, note, conf) => { r.originId = 0; r.originIata = s.code; r.originCity = ENGINE.placeShort(s.name); r.originSite = s; r.originNote = note || ''; r.originConf = conf || ''; };
    const setDSite = (s, conf, reason) => { r.destId = 0; r.destIata = s.code; r.destCity = ENGINE.placeShort(s.name); r.destSite = s; r.destConf = conf; r.destReason = reason || ''; };
    // a helicopter took off away from any airport: that private site is where it came from
    const t0p = trail[0], heliFromSite = heli && t0p && (t0p.gnd || heliSlow0) && !ENGINE.heliAirportAt(t0p.lat, t0p.lon) && !(origin && origin.conf === 'plan');
    if (pos.gnd) {
      const here = heli ? ENGINE.heliAirportAt(pos.lat, pos.lon) : ENGINE.placeAt(pos.lat, pos.lon, 7, 2, { mil: ac.mil }), ap = here && here.airport;
      r.groundAirportId = ap ? ap.id : 0;
      // Did it just land? This flight id was airborne, or the trace's latest leg ended here in the last hours.
      const td = hex ? todayCache.get(hex) : null, lastLeg = td && td.sums ? td.sums.filter(l => l.ended && l.to).pop() : null;
      // (a trainer in the circuit never goes above 1,000 ft or so: airborne all the same - G-BOIR down on Sleap's runway
      // between laps was "parked there", no destination)
      const airborneThisId = maxAltSeen > 1500 || (heli && trail.some(p => !p.gnd && p.alt > 300)) || trail.some(p => !p.gnd && fin(p.alt) && p.alt > ((ap && ap.alt) || 0) + 400 && (!fin(p.gs) || p.gs > 40));
      // FR24's schedule has this flight still to depart (a departure time, none flown): the landing just made belongs to
      // the flight before - the crew is already on the next callsign at the gate (RYR32AE in at Liverpool from Dublin was
      // "landed at LPL from DUB" under the next flight's 18:40 departure)
      const upcoming = !!(ap && plan && plan.fr24 && plan.std > 0 && !plan.atd && plan.std > nowS() - 4 * 3600 && (!plan.originId || plan.originId === ap.id));
      if (upcoming) {
        setO(ap, 'on the ground at ' + apCode(ap), 'ground');
        const pd = plan.destId ? apById(plan.destId) : null;
        const moving = fin(pos.gs) && pos.gs >= 4;
        if (pd && pd.id !== ap.id) setD(pd, 'filed', plan.list ? `FR24's own schedule${plan.num ? ' (' + plan.num + ')' : ''}` : 'destination shown by FR24');
        else {
          // (no airports anywhere in FR24's data yet: where it usually goes next from here, from its own log)
          const pred = hs.n ? ENGINE.predict({ ac, pos, trail: [], hs, now: pos.t, origin: { airport: ap, conf: 'ground' } }) : null, c = pred && pred.cands && pred.cands[0];
          if (c && c.p >= 0.3 && c.airport.id !== ap.id) { setD(c.airport, CONF_OF(c.p), 'next flight - ' + (whyOf(c) || 'its own log')); r.destP = Math.round(c.p * 100); r.alternatives = pred.cands.slice(1, 4).filter(x => x.p >= 0.04 && x.airport.id !== ap.id).map(x => ({ iata: apCode(x.airport), city: x.airport.city, p: Math.round(x.p * 100) })); }
        }
        if (lastLeg && lastLeg.to && lastLeg.to.id === ap.id) { r.arrivedFrom = lastLeg.from ? apCode(apById(lastLeg.from.id)) : ''; r.arrivedAt = lastLeg.tEnd; }
        r.std = plan.std; r.sta = plan.sta || 0; r.phase = moving ? 'taxi' : 'parked';
        return r;
      }
      // Down here a while - parked - and moving again: the next flight, taxiing out under the same callsign (FR24 keeps
      // the landed flight's id until it is airborne again: GKY504 was in at Liverpool at 12:00 and taxiing out at 14:50,
      // still shown "landed"). Parked: five minutes at a standstill or a quarter of an hour unheard on the ground since
      // the landing, or down for 25 minutes - taxiing in is over long before.
      const ata0 = ap ? (st.landedAt || (lastLeg && lastLeg.to.id === ap.id ? lastLeg.tEnd : 0)) : 0;
      const taxiOut = !!ap && fin(pos.gs) && pos.gs >= 4 && ata0 > 0 && (nowS() - ata0 >= 1500 || restedAfter(hex, ata0));
      if (ap && !taxiOut && (airborneThisId || (lastLeg && lastLeg.to.id === ap.id && nowS() - lastLeg.tEnd < 8 * 3600))) {
        const from = airborneThisId && origin && origin.airport && origin.airport.id !== ap.id ? origin.airport : (lastLeg && lastLeg.from ? apById(lastLeg.from.id) : (origin && origin.airport));
        if (from && from.id !== ap.id) setO(from, 'departed ' + apCode(from), 'ground');
        else if (from) setO(from, 'local flight', 'ground');
        setD(ap, 'landed', 'landed at ' + apCode(ap));
        r.landed = true; r.confirmed = true; r.ata = st.landedAt || (lastLeg && lastLeg.to.id === ap.id ? lastLeg.tEnd : 0) || pos.t;
        r.atd = (lastLeg && lastLeg.to.id === ap.id ? lastLeg.tStart : 0) || (origin && origin.departedAt) || 0; r.departedAt = r.atd;   // no schedule is invented: SCHEDULED stays blank unless FR24 has a filed plan
        r.phase = 'landed';
      } else if (ap) {
        setO(ap, 'on the ground at ' + apCode(ap), 'ground');
        r.phase = 'parked';
        if (lastLeg && lastLeg.to && lastLeg.to.id === ap.id) r.arrivedFrom = lastLeg.from ? apCode(apById(lastLeg.from.id)) : '', r.arrivedAt = lastLeg.tEnd;
        // where it usually goes next - history only; shown as its destination once it is taxiing out (moving on the
        // ground, or FR24 already shows the departure), otherwise as a hint
        const taxi = taxiOut || (fin(pos.gs) && pos.gs >= 4) || !!(plan && plan.fr24 && plan.originId === ap.id);
        if (taxiOut && !r.arrivedFrom && lastLeg && lastLeg.to && lastLeg.to.id === ap.id) { r.arrivedFrom = lastLeg.from ? apCode(apById(lastLeg.from.id)) : ''; r.arrivedAt = lastLeg.tEnd; }
        const pred = hs.n || taxi ? ENGINE.predict({ ac, pos, trail: [], hs, now: pos.t, origin: { airport: ap, conf: 'ground' } }) : null;
        const cs2 = (pred && pred.cands) || [], c = cs2[0];
        if (taxi && c && c.p >= 0.3) {
          setD(c.airport, CONF_OF(c.p), 'taxiing out - ' + (c.airport.id === ap.id ? 'a local flight, back here' + (hs.n ? ' (its log)' : '') : whyOf(c) || 'its log'));
          r.destP = Math.round(c.p * 100); r.phase = 'taxi';
          r.alternatives = cs2.slice(1, 4).filter(x => x.p >= 0.04).map(x => ({ iata: apCode(x.airport), city: x.airport.city, p: Math.round(x.p * 100) }));
        } else if (c && c.p >= 0.35 && c.airport.id !== ap.id) { r.nextIata = apCode(c.airport); r.nextCity = c.airport.city; r.nextP = Math.round(c.p * 100); }
      } else {
        // down away from every listed airport: a helicopter pad, a field, a private strip
        const place = privatePlace(pos.lat, pos.lon, { heli, onNew: () => scheduleReplan(id, 50) });
        if (airborneThisId) {
          if (heliFromSite) { const sp = privatePlace(t0p.lat, t0p.lon, { heli, onNew: () => scheduleReplan(id, 50) }); setOSite(sp, siteTakeoffNote(sp), 'ground'); }
          else if (origin && origin.airport) setO(origin.airport, 'departed ' + apCode(origin.airport), 'ground');
          setDSite(place, 'landed', 'landed at ' + place.name);
          r.landed = true; r.confirmed = true; r.ata = st.landedAt || pos.t; r.atd = (origin && origin.departedAt) || (t0p && t0p.gnd && trail[1] ? trail[1].t : 0); r.departedAt = r.atd; r.phase = 'landed';
        } else { setOSite(place, 'on the ground at ' + place.name, 'ground'); r.phase = 'parked'; }
      }
      return r;
    }
    // First seen just off the ground over an airfield FR24 does not list (a military base, a private strip): that is
    // where it took off - not the listed airport 10 km away it would otherwise be put down to (a US Army UC-35 first
    // seen at 100 ft over Los Alamitos Army Air Field was "from Long Beach")
    let siteOrigin = null;
    if (!heliFromSite && t0p && !t0p.gnd && fin(t0p.alt) && !(origin && origin.conf === 'plan') && (!origin || !origin.airport || origin.conf !== 'ground')) {
      const k = siteNear(t0p.lat, t0p.lon, 2, heli ? 'HMSW' : 'MSW');
      const nxt = trail.find(q => q.t - t0p.t > 45 && fin(q.alt));
      if (k && t0p.alt - (k.row[6] || 0) < 900 && !(nxt && nxt.alt < t0p.alt - 150) && (!origin || !origin.airport || ENGINE.dist(t0p.lat, t0p.lon, origin.airport.lat, origin.airport.lon) > k.dist + 3)) siteOrigin = privatePlace(k.row[0], k.row[1], { heli });
    }
    if (heliFromSite) { const sp = privatePlace(t0p.lat, t0p.lon, { heli, onNew: () => scheduleReplan(id, 50) }); setOSite(sp, siteTakeoffNote(sp), 'ground'); }
    else if (siteOrigin) setOSite(siteOrigin, 'seen climbing out of ' + siteOrigin.name, 'low');
    else if (origin && origin.airport) setO(origin.airport, origin.note, origin.conf);
    else r.originNote = origin && origin.note || 'first seen airborne';
    // (lifted from a pad it was first heard sitting on: when it got moving)
    const liftOff = heliFromSite && heliSlow0 ? ((trail.find(q => fin(q.gs) && q.gs >= 30) || t0p).t - 30) : 0;
    r.departedAt = siteOrigin ? t0p.t - 60 : liftOff || (!heliFromSite && origin && origin.departedAt) || (trail[0] && !trail[0].gnd ? 0 : (trail[1] || {}).t || 0);
    r.atd = r.departedAt; r.std = (plan && plan.std) || 0; r.etd = (plan && plan.etd) || 0;
    if (rec.cs && !pos.cs) pos.cs = rec.cs;
    const pred = ENGINE.predict({ ac, pos, trail, hs, now: pos.t, origin: siteOrigin || heliFromSite ? { airport: null, conf: heliFromSite ? 'ground' : 'low', note: '', departedAt: r.departedAt || t0p.t - 60 } : origin, plan, fleet: fleetVisits(hex, legStart), wx: wxMap, closed: closedMap });
    r.phase = pred ? pred.phase : '';
    const cands = holdTerminal(id, pos, pred, { heli, cls, planned: !!(plan && (plan.destId || plan.divertedToId)) });
    // (the weather and any closure at the likeliest fields of the aircraft being looked at - the route is worked out
    // again when they come in)
    if (onScreen(id) && cands.length && !pos.gnd) { const ics = cands.slice(0, 6).map(c => c.airport.icao).filter(Boolean); wantWx(ics, () => scheduleReplan(id, 50)); wantNotams(ics.slice(0, 3), () => scheduleReplan(id, 50)); }
    const top = cands[0];
    const planDest = plan && (plan.divertedToId || plan.destId) ? apById(plan.divertedToId || plan.destId) : null;
    // on final: within 12 km of a field, below 2,500 ft above it and descending/level
    // "on approach" (shown as certain) only when there is no other airfield it could just as well be landing at, the
    // runway suits the aircraft, and it is close and low: Sleap and RAF Shawbury are 7 km apart
    const rival = top && cands.slice(1).some(c => c.dist < 15 && c.p >= 0.1);
    const elapsedMin = r.departedAt > 0 ? (pos.t - r.departedAt) / 60 : null;
    // (and heading for it, not away from it - and not the field it left minutes ago unless plainly coming back down to
    // it: G-CMJX levelling at 1,200 ft 3 km south of Liverpool, just off its runway and bound south, was "on approach to LPL")
    const toward = !!top && (top.dist < 1.5 || (fin(pos.trk) && ENGINE.angDiff(pos.trk, ENGINE.brg(pos.lat, pos.lon, top.airport.lat, top.airport.lon)) < 50));
    const leftIt = !!top && !!origin && !!origin.airport && origin.airport.id === top.airport.id && elapsedMin != null && elapsedMin < 15 && !(fin(pos.vr) && pos.vr < -300);
    const onFinal = top && toward && !leftIt && fin(pos.alt) && r.phase !== 'climb' && !rival && !ENGINE.rwyImpossible(top.airport, cls, ac.type) && (heli ? top.dist < 3 && pos.alt - top.airport.alt < 700 : top.dist < 8 && pos.alt - top.airport.alt < 2000);
    // Lined up close in and low: the airfield straight ahead, whatever the rest of the evidence said (G-FRAU on a 3 nm
    // final into Prestwick was still "Glasgow 49%"; F-BOZO on short final at Dinard was still being worked out)
    // (further out, established on a runway's final approach course - its extended centreline within 20 km, below a
    // generous glide path - is as good: N97NH lined up 12 km out of Islip's runway was still "Republic 26%" on the rest)
    // (descending or low, and a field the rest of the evidence already has in mind - a transit crossing some runway's
    // centreline is neither)
    const onCourse = () => { const f = ENGINE.finalTo(pos, { heli, cls, type: ac.type }); return f && ((fin(pos.vr) && pos.vr < -200) || f.agl < 2500) && cands.some(c => c.airport.id === f.airport.id && c.p >= 0.1) && !(origin && origin.airport && origin.airport.id === f.airport.id && elapsedMin != null && elapsedMin < 15 && !(fin(pos.vr) && pos.vr < -300)) ? { airport: f.airport, dist: f.km, fit: f.fit } : null; };
    // (and established on a long final, up to 35 km out, to the field already on top - T7-AFP 30 km east of Le Bourget on
    // its runway 27, "69%" until 10 km out: right 99.8% of the time it says so over a week of real landings,
    // test/final_eval.cjs; not for light aircraft or military ones, which fly practice approaches)
    const longFin = () => { if (heli || /^(piston|milheavy|fighter)$/.test(cls) || !top) return null; const lf = ENGINE.longFinal(pos, trail, { origin: origin && origin.airport, elapsedMin, rwyOk: a => !ENGINE.rwyImpossible(a, cls, ac.type) }); return lf && lf.airport.id === top.airport.id ? lf : null; };
    // (or on one airport's usual arrival path: cells of the sky - by height band and direction - where nearly all of three
    // weeks' traffic went on to land there, its standard arrivals, vectors, descents and base turns, so the crowded
    // airspace between neighbours is told apart as the traffic flies it. F-GBOL at 3,000 ft over Paris was "LBG 80%".
    // Only an airport the rest of the evidence has in mind, never against FR24's own plan, and not the field it has
    // just left)
    const pathFin = () => {
      const ap = ENGINE.approachPath(pos, trail, cls); if (!ap) return null;
      if (planDest && planDest.id !== ap.airport.id) return null;
      if (!cands.some(c => c.airport.id === ap.airport.id && c.p >= 0.02) || ENGINE.rwyImpossible(ap.airport, cls, ac.type)) return null;
      if (origin && origin.airport && origin.airport.id === ap.airport.id && elapsedMin != null && elapsedMin < 15 && !(fin(pos.vr) && pos.vr < -300)) return null;
      return Object.assign(ap, { why: `on the usual arrival path into ${apCode(ap.airport)} - ${Math.floor(ap.share * 100)}% of the ${ap.n} aircraft here landed there` });
    };
    const appr = r.phase !== 'climb' ? (ENGINE.approachTo(pos, { heli, origin: origin && origin.airport, elapsedMin, rwyOk: a => !ENGINE.rwyImpossible(a, cls, ac.type) }) || onCourse() || longFin() || pathFin()) : null;
    const finalAp = appr ? appr.airport : onFinal ? top.airport : null;
    const finalWhy = a => appr && appr.airport.id === a.id ? appr.why || `on final approach to ${apCode(a)}, ${Math.max(1, Math.round(appr.dist))} km out` : `on approach to ${apCode(a)}`;
    // Flying circuits - touch-and-goes, low approaches, laps of the field (BNI6RM at Lodz): that field, confirmed, when
    // the rest of the evidence agrees. Over 16,000 real legs (test/circuits_eval.cjs) the two agree 94% of the time and
    // are then right 90% (the misses: a few laps, then off somewhere else); where they disagree the evidence is right
    // twice as often as the circuits, so it stands.
    // Confirmed only where that has held: light aircraft and fighters doing circuits at the field they took off from
    // (94% and 96% of moments); elsewhere - a transport's approach practice at base before its sortie (42%), a
    // helicopter's low passes away from base (35%) - it is said, as one of the reasons, at the odds the evidence gives.
    const circ0 = !planDest ? ENGINE.circuits(trail, pos, { heli, strict: cls === 'milheavy' }) : null;
    const circ = circ0 && top && top.airport.id === circ0.airport.id ? circ0 : null;
    const circTxt = circ ? `flying circuits at ${apCode(circ.airport)} - ${circ.laps} lap${circ.laps === 1 ? '' : 's'} so far` : '';
    const circSure = !!circ && (cls === 'piston' || cls === 'fighter') && !!(origin && origin.airport && origin.airport.id === circ.airport.id);
    if (circ) r.circuits = circ.laps;
    // (circuits at a field it did not take off from - it came in from elsewhere and stayed in the pattern: FR24 starts a
    // new flight there, and so does the panel. SFY5LW, back from a touch-and-go at Cardiff and in the circuit at
    // Gloucester, was "from Cardiff")
    if (circ && !(origin && origin.airport && origin.airport.id === circ.airport.id) && !(plan && plan.fr24 && plan.originId)) {
      const ca = circ.airport, first = trail.find(p => ENGINE.dist(p.lat, p.lon, ca.lat, ca.lon) < 4 && fin(p.alt) && p.alt - (ca.alt || 0) < 1200);
      setO(ca, `in the circuit at ${apCode(ca)}${first ? ' since ' + new Date(first.t * 1000).toISOString().slice(11, 16) + 'Z' : ''}`, 'ground');
      if (first) { r.departedAt = first.t; r.atd = first.t; }
    }
    if (planDest) {
      const contradict = finalAp && finalAp.id !== planDest.id;
      if (contradict) setD(finalAp, 'confirmed', `${finalWhy(finalAp)} - not the filed ${apCode(planDest)}`);
      else setD(planDest, finalAp ? 'confirmed' : 'filed', finalAp ? finalWhy(planDest) : plan.divertedToId ? 'diverted (FR24 flight plan)' : plan.list ? `FR24's own schedule${plan.num ? ' (' + plan.num + ')' : ''}` : plan.fr24 ? 'destination shown by FR24' : 'FR24 flight plan');
    } else if (circSure) {
      setD(circ.airport, 'confirmed', circTxt + (finalAp && finalAp.id === circ.airport.id ? ', on final' : '')); r.destP = 100;
    } else if (finalAp) {
      setD(finalAp, 'confirmed', finalWhy(finalAp)); r.destP = 100;
    } else if (top) {
      // shown as 100% only when it is confirmed - descending into it, close, with nothing else left; otherwise at most 99%
      const sure = top.p >= 0.995 && top.dist < 80 && (r.phase === 'descent' || (fin(pos.alt) && pos.alt - top.airport.alt < 6000));
      // (the odds shown as they turn out: on held-out flights of this class, then this browser's own record of hits and misses)
      const pShown = calibP(ENGINE.calibrated(top.p, cls));
      setD(top.airport, sure ? 'confirmed' : CONF_OF(pShown), sure ? `descending into ${apCode(top.airport)} - no other airport fits` : [circTxt, whyOf(top)].filter(Boolean).join(', '));
      r.destP = sure ? 100 : Math.min(99, Math.round(pShown * 100));
    }
    // (the others share what the shown odds leave - at most three times their own: with the top airport at all but 100%
    // and shown lower, as this browser's own record of hits and misses has it, an airport the engine gave a hundredth of
    // a percent was multiplied hundreds of times - N99GY, vectored round the east of Dublin for its runway 28, showed
    // "also possible: Anglesey". And one the engine itself gives under 2% is never offered)
    // (never above the airport shown: the odds shown for it are those it turns out to have, the others share the rest)
    r.alternatives = altsOf(cands, r.destId, top ? top.p : 0, r.destP, !!top && !planDest && !finalAp && r.destP < 100 && top.p < 0.999);
    // Helicopters: an airport, or a private landing site (a third of their landings)? Its own record decides most.
    if (heli && !planDest && !finalAp && !circ) {
      const ps = ENGINE.privateSite({ pos, legs: hist, cands, legStart, start: t0p ? { lat: t0p.lat, lon: t0p.lon, gnd: !!t0p.gnd } : null, heliport: heliportNear });
      if (ps) {
        const scale = c => ({ iata: apCode(c.airport), city: c.airport.city, p: Math.round(c.p * (1 - ps.pp) * 100) });
        const why = ps.nLand ? `${Math.round(100 * ps.nOff / ps.nLand)}% of its ${ps.nLand} landings were away from airports` : 'helicopters often land away from airports';
        if (ps.choice !== 'ap') {
          // (one of its own spots by name only when that spot alone beats the top airport - otherwise "a private site", all
          // of them together, the likeliest one said: TKF1 heading south past Warton was "its pad near Stroud 26%" over
          // "Warton 34%" - right that it was not landing at Warton, wrong to name the pad as likelier than Warton)
          const apShare = top ? top.p * (1 - ps.pp) : 0;
          const spot = ps.spot && ps.spot.q >= 0.5 && ps.spot.p >= apShare ? ps.spot : null;
          // (a heliport ahead only when low or coming down - 1,500 ft and level at 120 kt is passing it)
          const hp = !spot && ps.heliport && ps.heliport.dist < 4 && (ps.agl < 1000 || (fin(pos.vr) && pos.vr < -300 && ps.agl < 1500)) ? ps.heliport : null;
          const place = spot ? privatePlace(spot.lat, spot.lon, { heli: true, onNew: () => scheduleReplan(id, 50) }) : hp ? privatePlace(hp.lat, hp.lon, { heli: true, onNew: () => scheduleReplan(id, 50) }) : privatePlace(pos.lat, pos.lon, { heli: true, generic: true });
          const p = spot ? spot.p : ps.pp;
          const likely = !spot && !hp && ps.spot && ps.spot.p >= 0.1 ? (s => `, likeliest its own spot ${/^Private site/.test(s.name) ? s.name.replace(/^Private site\s*/, '') : 'at ' + s.name} (${Math.round(ps.spot.p * 100)}%)`)(privatePlace(ps.spot.lat, ps.spot.lon, { heli: true, onNew: () => scheduleReplan(id, 50) })) : '';
          setDSite(place, CONF_OF(p), spot ? `its own landing spot (${spot.n} landing${spot.n === 1 ? '' : 's'} there) - ${why}` : hp ? `low and heading for ${hp.name} - ${why}` : `a private landing site - ${why}${likely}`);
          r.destP = Math.round(p * 100);
          r.alternatives = cands.slice(0, 3).map(scale).filter(a => a.p >= 4);
        } else {
          if (r.destP) r.destP = Math.round(top.p * (1 - ps.pp) * 100);
          r.alternatives = r.alternatives.map(a => Object.assign({}, a, { p: Math.round(a.p * (1 - ps.pp)) })).filter(a => a.p >= 4);
          if (ps.pp >= 0.08) r.alternatives.push({ iata: 'PVT', city: 'Private site', p: Math.round(ps.pp * 100) });
        }
      }
    }
    if (r.destP && r.alternatives && r.alternatives.length) r.alternatives = r.alternatives.map(x => x.p >= r.destP ? Object.assign({}, x, { p: Math.max(1, r.destP - 1) }) : x);
    // An offshore operator's helicopter bound out to sea, nothing it could land at ahead but a platform: that platform
    // (NHZ25, NHV's AW139 out of Blackpool for the Morecambe Bay gas fields, was "back to Blackpool, 53%")
    if (heli && !planDest && !finalAp && !circ && !pos.gnd && fin(pos.trk)) {
      const opName = String(rec.operatorName || rec.owner || rec.airline || ''), csP = String(ac.cs || rec.cs || '').slice(0, 3).toUpperCase();
      if (/offshore|noordzee|\bnhv\b|bristow|\bchc\b|babcock|cougar|\bera helicopters|\bphi\b|heli-?union|weststar|omni/i.test(opName) || /^(NHZ|BHL|SHZ|CHC|BAN|HKS)$/.test(csP)) {
        const pa = platformsAhead(pos, () => scheduleReplan(id, 50)), p1 = pa && pa[0];
        const apAhead = cands.some(c => c.p >= 0.3 && c.dist < (p1 ? p1.d : 0) && ENGINE.angDiff(pos.trk, ENGINE.brg(pos.lat, pos.lon, c.airport.lat, c.airport.lon)) < 40);
        if (p1 && !apAhead) {
          const near0 = ENGINE.airportAt(p1.lat, p1.lon, 300);
          setDSite({ code: 'PVT', name: p1.name, lat: p1.lat, lon: p1.lon, alt: 0, tzId: near0 ? near0.airport.id : 0, known: 'platform' }, 'probable', `an offshore platform straight ahead, ${Math.round(p1.d)} km - an offshore operator, bound out to sea`);
          r.destP = 60; r.alternatives = (r.alternatives || []).slice(0, 2);
        }
      }
    }
    // (the candidates the user can confirm from - the likeliest first)
    r.cands = cands.slice(0, 12).map(c => [c.airport.id, Math.round(c.p * 100)]);
    // A destination the user confirmed ("confirm": heard on the radio, seen on final, known): it stands, at 100%
    const uc = userDestOf(id, hex, r.departedAt);
    if (uc && !planDest) {
      const ua = apById(uc.destId);
      if (ua) { setD(ua, 'confirmed', 'confirmed by you' + (uc.prev && uc.prev !== apCode(ua) ? ` (it was predicting ${uc.prev})` : '')); r.destP = 100; r.destSite = null; r.alternatives = []; r.userConfirmed = true; }
    }
    // (22.25) The route another browser worked out for this flight - its own engine with the aircraft's whole log - or a
    // destination confirmed there: shown where this browser has nothing as good yet (the panel opened before its own log
    // of the aircraft is in). Never over FR24's own plan, a landing or final seen here, or the user's own word
    const sr = !r.userConfirmed && !planDest && r.destConf !== 'confirmed' ? srvIds.rows.get(id) : null, cr = sr && String(sr[1] || '').toLowerCase() === hex ? crowdOf(sr) : null;
    if (cr) {
      // (checked against where the aircraft is now, every time: worked out minutes or an hour ago, perhaps on a stale
      // track, it is not shown once the flight says otherwise - far off its track or behind it, flying steadily on and no
      // nearer to it (the engine's own rule), or its ETA a quarter of an hour gone with the aircraft still airborne 60 km
      // and more from it. TC-AKB, descending on 137 past Chambery for Turin, was "Le Bourget 74%, ETA 22:09Z" at 22:16Z -
      // another browser's, kept over this one's own Linate / Malpensa / Turin)
      const ca0 = cr.d ? apById(cr.d) : null;
      const ca = ca0 && !crowdContradicted(ca0, Object.assign({}, cr, { sure: cr.by === 2 }), pos, trail, origin && origin.airport, elapsedMin, ac.mil && !/^(bizjet|heavybiz)$/.test(cls) ? 'milheavy' : cls) ? ca0 : null;
      // (22.30.2) This browser's own answer stands, whatever odds the other put on its own, when it has what an answer takes
      // - the aircraft's own log, or the take-off seen on the ground: the same as it sends the monitor, so the answers the
      // browsers hand each other are ones worked out with the evidence. N6012C's panel said "worked out by another
      // browser" over its own: wrong, with the departure that came with it. The other's fills what this one has none for,
      // a panel opened before its own log is in, and a destination confirmed there still stands over a guess of its own
      const informed = r.legCount > 0 || r.originConf === 'ground';
      if (ca && (cr.by === 2 || (!r.destId && !r.destSite) || (!informed && (r.destP || 0) + 10 < cr.p))) {
        setD(ca, cr.by === 2 ? 'confirmed' : CONF_OF(cr.p / 100), cr.by === 2 ? 'confirmed in another browser' : 'worked out by another browser');
        r.destP = cr.by === 2 ? 100 : Math.min(99, cr.p); r.destSite = null; r.alternatives = (r.alternatives || []).filter(a => a.iata !== apCode(ca)); r.crowdD = true;
      }
      const co = cr.o ? apById(cr.o) : null;
      // (an origin from before this flight began - the one it flew into the hole it came down in, or a leg of the aircraft's
      // own log that was over by then: the flight before, not this one)
      if (co && !earlier(cr.atd) && !r.originId && !r.originSite) { setO(co, 'worked out by another browser', cr.oc || 'low'); r.crowdO = true; if (!r.departedAt && cr.atd) { r.departedAt = cr.atd; r.atd = r.atd || cr.atd; } }
    }
    const destAp = apById(r.destId) || (r.destSite && fin(r.destSite.lat) ? r.destSite : null);
    r.eta = (plan && plan.eta && plan.eta > nowS() - 600 ? plan.eta : 0) || estimateEta(pos, destAp, cls);
    r.sta = (plan && plan.sta) || 0;
    const stage = r.phase === 'descent' ? 4 : r.phase === 'climb' && (pos.alt || 0) < 15000 ? 2 : 3;
    if (destAp) r.progress = buildProgress(pos, apById(r.originId) || (r.originSite && fin(r.originSite.lat) ? r.originSite : null), destAp, r.departedAt, r.eta, stage);
    r.local = !!(pred && r.destId && r.destId === r.originId);
    r.confirmed = r.destConf === 'confirmed';
    r.ms = pred ? pred.ms : 0;
    return r;
  }
  // (an airfield FR24 does not list goes to the page by its code and name only: FR24's own panel knows only its airports)
  const routeForPage = r => { const da = r.destId ? apById(r.destId) : null, oa = (r.originId && apById(r.originId)) || (r.originSite && fin(r.originSite.lat) ? r.originSite : null); return { originId: fr24Ap(r.originId), destId: fr24Ap(r.destId), originIata: r.originIata, destIata: r.destIata, originCity: r.originCity, destCity: r.destCity, progress: r.progress, std: r.std, sta: r.sta, atd: r.atd, ata: r.ata, eta: r.eta, etd: r.etd, groundAirportId: fr24Ap(r.groundAirportId), landed: r.landed, destConf: r.destConf, destP: r.destP || 0, destReason: r.destReason || '', confirmed: !!(r.confirmed || r.landed || r.destConf === 'confirmed'), quick: !!r.quick,
    // (where the destination is: a flight that goes quiet low beside it has landed, for the boards)
    destLat: da ? da.lat : null, destLon: da ? da.lon : null, destAlt: da ? da.alt || 0 : null,
    // (and where it took off - an airport, or a site of its own: its Playback opens FR24's playback there)
    originLat: oa ? oa.lat : null, originLon: oa ? oa.lon : null }; };
  const boardNoted = new Map();   // flight id -> what was last kept of it for the boards
  // ---- the map's routes, shared with this browser's other FR24 tabs: an aircraft's log page shows the flight in
  // progress as the map has it, the moment it is known - not worked out again from scratch (M-ARNZ's log said "Barrow
  // -> -, Unknown" while the map had it confirmed into Bristol)
  const mapRoutes = new Map();    // hex -> { at, route } (from the map tab)
  const routeAsked = new Map();   // hex -> when a log page asked for it (only those are sent, as they change)
  let mapRouteHook = null, histHook = null;
  const routeChan = typeof BroadcastChannel === 'function' ? new BroadcastChannel('tl-routes') : null;
  // (a newer log of an aircraft kept by another tab: read again, and its route here worked out again from it)
  function onHistElsewhere(hex) {
    if (!store.peekHist(hex) && !(histHook && histHook.hex === hex)) return;     // (one this tab has not read: nothing stale)
    store.reloadHist(hex).then(() => {
      naHs.delete(hex);
      for (const [id, rec] of live) if (rec && rec.hex === hex) scheduleReplan(id, 50);
      for (const [id, p] of pubRecs) if (p && p.hex === hex && pubRouted(id)) scheduleReplan(id, 50);
      if (histHook) histHook(hex);
    }).catch(e => log('log from another tab', e));
  }
  function shareRoute(id, route) {
    const rec = live.get(id) || pubRecs.get(id); if (!routeChan || !rec || !rec.hex || !route || id < 0 || !(now() - (routeAsked.get(rec.hex) || 0) < 30 * 60000)) return;
    try { routeChan.postMessage({ hex: rec.hex, route: JSON.parse(JSON.stringify(Object.assign({}, route, { cs: csOfRec(rec), fr24Id: id }))) }); } catch (e) { /* ignore */ }
  }
  if (routeChan) routeChan.onmessage = ev => {
    const d = ev.data || {};
    if (d.hist) { onHistElsewhere(d.hist); return; }
    if (d.logsReset) { resetLogsNow(true).catch(() => {}); return; }
    if (d.askBoard || d.boardRows) { onBoardChannel(d); return; }
    if (d.ask) { routeAsked.set(d.ask, now()); if (routeAsked.size > 50) routeAsked.delete(routeAsked.keys().next().value); for (const [id, st] of routeState) { const rec = live.get(id) || pubRecs.get(id); if (rec && rec.hex === d.ask && st && st.route) shareRoute(id, st.route); } return; }
    if (d.hex && d.route) { mapRoutes.set(d.hex, { at: now(), route: d.route }); if (mapRoutes.size > 200) mapRoutes.delete(mapRoutes.keys().next().value); if (mapRouteHook) mapRouteHook(d.hex); }
  };
  // (what the page was last given of each blocked flight's route, and when)
  const routeOut = new Map();
  function publishRoute(id, route) {
    if (!route) return;
    if (!live.has(id) && pubRecs.has(id) && !pubRouted(id)) return;   // an ordinary flight FR24 has (by now) a route for
    const has = !!(route.originId || route.destId || route.groundAirportId || route.destIata || route.originIata), was = routeOut.get(id);
    // A blocked flight in the air whose route comes out empty for a moment - its track and log not to be had while the
    // sources wall this browser and the monitor is slow to answer - keeps the one the page has (half an hour at most):
    // taken away, FR24's panel lost the airports, their time zones and the progress bar of HB-IXL over the Atlantic, 23 Oct
    if (!has && was && was.has && live.has(id) && !route.onGround && now() - was.at < 30 * 60000) return;
    routeOut.set(id, { at: now(), has }); if (routeOut.size > 3000) routeOut.delete(routeOut.keys().next().value);
    postToPage('route', { id, route: has ? routeForPage(route) : null });
    shareRoute(id, route);
    noteRouteOut(id, route);
    const rec = live.get(id) || pubRecs.get(id);
    // (an ordinary flight opened in the panel, its destination reasoned: on its airports' boards like FR24's own N/A
    // flights - N77HG, confirmed into the Isle of Man, was on neither its arrivals nor Retford's departures)
    if (!live.has(id) && rec && rec.hex && (route.originId || route.destId) && pubRouted(id)) {
      const c = currentPos(id);
      const m0 = Object.assign({}, store.getHex(rec.hex) || {}, rec);
      postToPage('naBoard', { list: [{ id, rec: { cs: rec.cs || '', reg: rec.reg || '', type: rec.type || '', hex: rec.hex, cat: rec.cat || '', fcat: fr24Cat(m0), mil: !!rec.mil, operatorName: shownOwner(m0, rec.cs), operatorId: operatorIdOf(m0, rec.cs) }, route: routeForPage(route), pos: c ? { lat: c.lat, lon: c.lon, alt: c.alt, gnd: !!c.gnd, at: c.t * 1000 } : null }] });
    }
    const st = routeState.get(id); if (st) st.route = route;
    if (rec) {
      rec.route = route;
      const inj = rec.injected || [];
      for (const v of [route.originIata, route.originCity, route.destIata, route.destCity]) if (v && !inj.includes(v)) inj.push(v);
      rec.injected = inj.slice(-40);
      try { if (live.has(id)) store.setId(id, Object.assign({}, rec, { route: Object.assign({}, route, { progress: null }) })); else if (route.originIata || route.destIata) pubKeep(id, rec, route); } catch (e) { log('route store', e); }
    }
    try { accNote(id, route); } catch (e) { log('scorecard note', e); }
    // (kept for its airports' boards once it is off, and again when it is down - opened or not)
    try { const sig = (route.atd || route.departedAt || 0) + ':' + (route.landed ? route.ata : 0) + ':' + route.originId + ':' + route.destId; if (rec && boardNoted.get(id) !== sig && (route.atd || route.departedAt || route.landed)) { boardNoted.set(id, sig); if (boardNoted.size > 3000) boardNoted.delete(boardNoted.keys().next().value); boardNoteFlight(id, rec, route); } } catch (e) { log('board note', e); }
    syncPanelSoon();
  }

  // ---- ordinary flights FR24 shows without a destination ---------------------------------------------------------------
  // Military, private, GA, helicopter, positioning and cargo flights often have no filed route, so FR24 shows N/A. They
  // get the same reasoning as a LADD aircraft (their own flight log, where they took off, where they are heading) -
  // never over a route FR24 has, and not for drones, balloons or ground vehicles (nothing to predict there).
  const fr24Sched = new Map();   // fr24 id -> { o, d }: FR24's own departure / arrival airport of an ordinary flight
  const NO_DEST_TYPE = /^(?:RQ4|MQ9|MQ9B|Q9|Q4|MQ4|MQ1|MQ1C|MQ25|HRON|HERM|H450|TB2|WK45|UAV|DRON|BALL|GRND|SERV|EMER|TWR|GND|SHIP)$/;
  const noDestCraft = (type, cat) => NO_DEST_TYPE.test(String(type || '').toUpperCase()) || /^(?:B2|B6|B7|C\d)$/.test(String(cat || '').toUpperCase());
  function schedOf(id) {
    const s = fr24Sched.get(id); if (s) return s;
    const hx = hexOfId(id); if (!hx) return null;
    let best = null; for (const [k, v] of fr24Sched) if (k !== id && hexOfId(k) === hx) best = v;
    return best;
  }
  function pubRouted(id) {
    const p = pubRecs.get(id); if (!p || !p.hex) return null;
    const s = schedOf(id);
    if (s ? s.d && s.o : !p.naDest) return null;
    const hx = store.getHex(p.hex) || {};
    return noDestCraft(p.type || hx.type, hx.cat) ? null : p;
  }
  // FR24's own plan of an ordinary flight: the airports its live panel shows, else those of the same flight in FR24's
  // schedule for the registration (callsign and time matched), with the times and flight number
  function schedPlan(id) {
    if (live.has(id)) return null;
    const s = schedOf(id) || {}, p = pubRecs.get(id), m = p && p.fr24List;
    const o = s.o || (m && m.o) || 0, d = s.d || (m && m.d) || 0;
    if (!(apById(o) || apById(d)) && !s.std) return null;
    return { originId: apById(o) ? o : 0, destId: apById(d) ? d : 0, fr24: true, list: !!m && !(s.o && s.d), num: s.num || (m && m.num) || '', std: s.std || (m && m.std) || 0, sta: s.sta || (m && m.sta) || 0, atd: s.atd || (m && m.atd) || 0 };
  }
  // the same flight in FR24's schedule: its own flight id, else its callsign at the very scheduled time the live panel
  // shows. (Callsign alone is not enough: TIGER68, a search-and-rescue helicopter, flies under it every day.)
  function listMatch(p, rows) {
    const s = schedOf(p.id) || {};
    let best = null, bestD = Infinity;
    for (const r of rows) {
      if (!r.o || !r.d) continue;
      if (r.id && r.id === p.id) return r;
      if (!s.std || !p.cs || r.cs !== p.cs || !r.std) continue;
      const dt = Math.abs(r.std - s.std);
      if (dt < bestD) { best = r; bestD = dt; }
    }
    return best && bestD <= 1800 ? best : null;
  }
  function askSchedule(p) {
    const reg = p && (p.reg || (p.hex && (store.getHex(p.hex) || {}).reg));
    // (again when FR24's scheduled time arrives or changes: the list itself is cached for 5 minutes)
    const key = reg + '|' + ((schedOf(p.id) || {}).std || 0);
    if (!reg || (p.listKey === key && now() - p.listAt < 5 * 60000)) return;
    p.listAt = now(); p.listKey = key;
    fr24.flightsOf(reg).then(rows => {
      const m = listMatch(p, rows || []), was = p.fr24List;
      p.fr24List = m || null;
      if (m && (!was || was.o !== m.o || was.d !== m.d)) { log('FR24 schedule', p.cs, m.num, apCode(apById(m.o)), '→', apCode(apById(m.d))); scheduleReplan(p.id, 10); }
    }).catch(e => log('FR24 schedule', String(e.message || e)));
  }
  function startPubRoute(p) {
    if (p && !p.fr24List) askSchedule(p);
    if (!p || p.routeStarted || !airportsReady()) { if (p && !p.routeStarted) loadAirports().then(() => { if (pubRouted(p.id)) startPubRoute(p); }).catch(() => {}); return; }
    p.routeStarted = true; p.routeAt = now();
    routeFor(p).catch(e => { p.routeErr = String((e && e.message) || e).slice(0, 160); log('route failed', e); syncPanelSoon(); });
    for (const ms of [800, 2500, 6000]) setTimeout(() => { if (!p.route && pubRouted(p.id)) { const r = composeRoute(p.id, p.hex); if (r) publishRoute(p.id, r); else syncPanelSoon(); } }, ms);
  }
  function onSched(d) {
    const id = Number(d.id) || 0; if (!id || live.has(id)) return;
    fr24Sched.set(id, { o: Number(d.o) || 0, d: Number(d.d) || 0, std: Number(d.std) || 0, sta: Number(d.sta) || 0, atd: Number(d.atd) || 0, ata: Number(d.ata) || 0, num: clean(d.num).toUpperCase(), at: now() }); if (fr24Sched.size > 400) fr24Sched.delete(fr24Sched.keys().next().value);
    const p = pubRecs.get(id);
    if (Number(d.d) && Number(d.o)) {       // FR24 has (now) a route of its own: nothing of ours stays
      const hx = hexOfId(id);
      for (const q of [p].concat(hx ? [...pubRecs.values()].filter(x => x !== p && x.hex === hx) : [])) {
        if (!q || !q.route) continue;
        q.route = null; q.naDest = false; const st = routeState.get(q.id); if (st) st.route = null; postToPage('route', { id: q.id, route: null }); pubForget(q.id);
      }
      syncPanelSoon();
      return;
    }
    if (p && pubRouted(id)) { if (p.routeStarted) scheduleReplan(id, 50); else startPubRoute(p); }
  }
  let pubMem = {}, pubLoaded = false, pubSaveT = 0;
  store.kvReady.then(() => { pubMem = Object.assign({}, store.kvGet('pubRt2') || {}, pubMem); pubLoaded = true; if (store.kvGet('pubRt1')) store.kvSet('pubRt1', null); }).catch(() => {});
  function pubSave() {
    if (pubSaveT) return;
    pubSaveT = setTimeout(() => {
      pubSaveT = 0; if (!pubLoaded) return pubSave();
      const t = now(), keep = Object.keys(pubMem).filter(k => pubMem[k] && t - pubMem[k].at < 864e5).sort((a, b) => pubMem[b].at - pubMem[a].at).slice(0, 300), o = {};
      for (const k of keep) o[k] = pubMem[k];
      pubMem = o; store.kvSet('pubRt2', o);
    }, 3000);
  }
  function pubKeep(id, p, route) { pubMem[id] = { hex: p.hex, origin: p.origin || null, route: Object.assign({}, route, { progress: null }), at: now() }; pubSave(); }
  function pubForget(id) { if (pubMem[id]) { delete pubMem[id]; pubSave(); } }
  const pubKept = (id, hex) => { const k = pubMem[id]; return k && k.hex === hex && k.route && now() - k.at < 12 * 3600e3 ? k : null; };
  // a flight opened again (or after a refresh): its route goes to the page before FR24's first frame
  function pubPrime(id) {
    const k = pubMem[id]; if (!k || !k.route || now() - k.at > 12 * 3600e3) return;
    const s = fr24Sched.get(id); if (!s || (s.d && s.o)) return;
    if (k.route.originId || k.route.destId) postToPage('route', { id, route: routeForPage(k.route) });
  }
  const pubRoutesForPage = maxAge => Object.entries(pubMem).filter(([, k]) => k && k.route && now() - k.at < maxAge && (k.route.originId || k.route.destId)).map(([id, k]) => ({ id: Number(id), route: routeForPage(k.route) }));

  // ---- FR24's own N/A flights on the airport boards ------------------------------------------------------------------
  // A flight FR24 identifies but has no destination for goes on the boards of the airport it is predicted to land at
  // (and of the one it left) when the prediction is good - on final for it, or 60% and more as the odds turn out - in
  // FR24's own estimated style. Worked out quietly, a few at a time, from what the feed has shown of it and its log if
  // one is kept; dropped again when the prediction weakens or the flight is no longer seen.
  const naFeed = new Map();     // fr24 id -> { f: latest report, trail: [points], at, routedAt, pub }
  const naHs = new Map();       // hex -> { at, hs } (its kept log, as statistics)
  function noteNa(list, at) {
    for (const f of list) {
      if (live.has(f.id)) continue;
      const e = naFeed.get(f.id) || { trail: [], at: 0, routedAt: 0, pub: null };
      const t = (f.ts > 1e9 ? f.ts : Math.floor(at / 1000));
      const p = { t, lat: f.lat, lon: f.lon, alt: f.gnd ? 0 : f.alt, gs: f.spd, trk: f.trk, gnd: !!f.gnd };
      const last = e.trail[e.trail.length - 1]; if (!last || t - last.t >= 20) { e.trail.push(p); if (e.trail.length > 90) e.trail.shift(); }
      e.f = f; e.at = at; naFeed.set(f.id, e);
    }
  }
  function naHistStats(hex, t) {
    if (!hex) return null; const c = naHs.get(hex); if (c && now() - c.at < 600000) return c.hs;
    const h = store.peekHist(hex); let hs = null;
    if (h && h.legs && h.legs.length) { try { hs = ENGINE.histStats(ENGINE.chainLegs(ENGINE.stitchLegs(h.legs.slice())).filter(l => l.tEnd < t - 60), t); } catch (e) { hs = null; } }
    naHs.set(hex, { at: now(), hs }); if (naHs.size > 500) naHs.delete(naHs.keys().next().value);
    return hs;
  }
  // (on the ground as the engine counts it - FR24 says so, or a fixed-wing aircraft under 40 kt: an airliner taxiing with
  // its transponder saying "airborne" - and flying: off the ground at flying speed)
  const naGnd = (p, heli) => !!p.gnd || (!heli && fin(p.gs) && p.gs < 40 && !(fin(p.alt) && p.alt > 12000));
  const naFlying = (p, cls) => !naGnd(p, cls === 'heli') && fin(p.gs) && p.gs >= (cls === 'heli' ? 20 : cls === 'piston' ? 45 : 60);
  function naRouteOf(e) {
    const f = e.f, trail = e.trail.slice(), pos = trail[trail.length - 1]; if (!pos) return null;
    const hex = f.hex ? Number(f.hex).toString(16).padStart(6, '0') : '';
    const ac = { hex, type: f.type || '', reg: f.reg || '', cs: f.cs || '' }, cls = ENGINE.classify(ac), heli = cls === 'heli';
    if (naGnd(pos, heli) && e.pub && e.pub.landed) return e.pub;
    // (only a flight seen flying - two reports at flying speed, off the ground - is routed, or put on a board, at all: EI-EVN
    // taxiing at Liverpool as RYR8SF was "Liverpool -> Liverpool, landed" on its arrivals)
    const fly = trail.filter(p => naFlying(p, cls)); if (fly.length < 2) return null;
    const i0 = trail.indexOf(fly[0]), startGnd = i0 > 0 && trail.slice(0, i0).some(p => naGnd(p, heli));
    // (its take-off: the first report at flying speed after it was seen on the ground)
    const departedAt = startGnd ? fly[0].t : 0;
    const fromAp = f.from ? airports.byIata.get(String(f.from).toUpperCase()) : null;
    const origin = fromAp ? { airport: fromAp, conf: 'fr24', departedAt } : null;
    // (where it began - FR24's origin, else the field it was seen on the ground at - and back there only after a real flight)
    const g0 = startGnd ? trail[i0 - 1] : null, home = fromAp || (g0 ? ((h => h && h.airport)(heli ? ENGINE.heliAirportAt(g0.lat, g0.lon) : ENGINE.placeAt(g0.lat, g0.lon, 7, 2)) || null) : null);
    let pathKm = 0; for (let i = 1; i < fly.length; i++) pathKm += ENGINE.dist(fly[i - 1].lat, fly[i - 1].lon, fly[i].lat, fly[i].lon);
    const backOk = ap => !home || !ap || home.id !== ap.id || ENGINE.localFlew({ from: { id: ap.id }, to: { id: ap.id }, tOff: departedAt || fly[0].t, tOn: pos.t, maxAlt: Math.max(0, ...fly.map(p => fin(p.alt) ? p.alt : 0)), pathKm }, cls);
    // (an arrival comes in from further out: a take-off roll - FR24's ground flag flickering "airborne" at 110 kt, then
    // "on the ground" - is no approach to, and no landing at, the field it is leaving)
    const cameFrom = ap => { const d0 = ENGINE.dist(pos.lat, pos.lon, ap.lat, ap.lon); return fly.some(p => ENGINE.dist(p.lat, p.lon, ap.lat, ap.lon) >= d0 + 3); };
    if (naGnd(pos, heli)) {
      // down: landed where it was going - just down from flying, and not back where it began without having flown
      const prev = e.pub, here = heli ? ENGINE.heliAirportAt(pos.lat, pos.lon) : ENGINE.placeAt(pos.lat, pos.lon, 7, 2);
      if (prev && here && here.airport.id === prev.destId && !prev.landed && pos.t - fly[fly.length - 1].t <= 900 && backOk(here.airport) && cameFrom(here.airport)) return Object.assign({}, prev, { landed: true, ata: pos.t, phase: 'landed' });
      return null;
    }
    const hs = naHistStats(hex, pos.t) || ENGINE.histStats([], pos.t);
    // (flying circuits - a light aircraft in the pattern of a field: that field, as for one opened)
    const circ = /^(piston|fighter|heli)$/.test(cls) ? ENGINE.circuits(trail, pos, { heli }) : null;
    if (circ && circ.airport.id < 1e7) return backOk(circ.airport) ? { originId: fromAp ? fromAp.id : circ.airport.id, originIata: apCode(fromAp || circ.airport), originCity: (fromAp || circ.airport).city, destId: circ.airport.id, destIata: apCode(circ.airport), destCity: circ.airport.city,
      destConf: 'confirmed', destP: 100, eta: 0, atd: departedAt, std: 0, sta: 0, landed: false, phase: 'circuits', circuits: circ.laps } : null;
    const r = ENGINE.predict({ ac, pos, trail, hs, now: pos.t, origin, wx: wxMap, closed: closedMap }); if (!r || !r.cands.length) return null;
    const top = r.cands[0], elapsed = departedAt ? (pos.t - departedAt) / 60 : null;
    const lfOk = !heli && !/^(piston|milheavy|fighter)$/.test(cls), rwyOk = a => !ENGINE.rwyImpossible(a, cls, ac.type);
    const pathOk = ap => !!ap && r.cands.some(c => c.airport.id === ap.airport.id && c.p >= 0.02) && rwyOk(ap.airport) && !(home && home.id === ap.airport.id && elapsed != null && elapsed < 15) ? ap : null;
    const appr = r.phase !== 'climb' ? (a => a && cameFrom(a.airport) ? a : null)(ENGINE.approachTo(pos, { heli, origin: home, elapsedMin: elapsed, rwyOk }) || (lfOk ? (lf => lf && lf.airport.id === top.airport.id ? lf : null)(ENGINE.longFinal(pos, trail, { origin: home, elapsedMin: elapsed, rwyOk })) : null) || pathOk(ENGINE.approachPath(pos, trail, cls))) : null;
    const dest = appr ? appr.airport : top.airport, p = appr ? 1 : calibP(ENGINE.calibrated(top.p, cls));
    if (!appr && p < 0.6) return null;
    // (a field FR24 has no board for; back where it began - guessed, or without a real flight first)
    if (dest.id >= 1e7 || (home && home.id === dest.id && (!appr || !backOk(dest)))) return null;
    // (an airline's jet flying its number is not going back to the field it left, nor to one close by: a climb-out turning
    // over the field, or levelling off on a departure that points at the next airport - Ryanairs out of Manchester "to
    // Manchester" and "to Liverpool" on its boards)
    if (home && cls === 'airliner' && /^[A-Z]{3}\d/.test(String(f.cs || '').toUpperCase()) && ENGINE.dist(home.lat, home.lon, dest.lat, dest.lon) <= 80) return null;
    return { originId: fromAp ? fromAp.id : 0, originIata: fromAp ? apCode(fromAp) : '', originCity: fromAp ? fromAp.city : '', destId: dest.id, destIata: apCode(dest), destCity: dest.city,
      destConf: appr ? 'confirmed' : CONF_OF(p), destP: Math.round(p * 100), eta: estimateEta(pos, dest, cls) || 0, atd: departedAt, std: 0, sta: 0, landed: false, phase: r.phase || '' };
  }
  let naBusy = false;
  async function naTick() {
    if (naBusy || !airportsReady()) return; naBusy = true;
    try {
      const t = now(), list = [], drop = [];
      for (const [id, e] of naFeed) if (t - e.at > 15 * 60000 || live.has(id)) { if (e.pub) drop.push(id); naFeed.delete(id); }
      const due = [...naFeed.entries()].filter(([, e]) => t - e.routedAt > 45000).sort((a, b) => a[1].routedAt - b[1].routedAt).slice(0, 80);
      // (in idle slices, at most 40 ms of them a round: the rest wait for the next)
      await sliced(due, ([id, e]) => {
        e.routedAt = now();
        // (one opened in the panel has its full route, posted with it - left to that, never dropped from here)
        { const pr = pubRecs.get(id); if (pr && pr.route && pubRouted(id)) return; }
        let r = null; try { r = naRouteOf(e); } catch (err) { log('na route', err); }
        if (r) { const f0 = e.f, hx0 = f0.hex ? Number(f0.hex).toString(16).padStart(6, '0') : ''; try { const sig = (r.atd || 0) + ':' + (r.landed ? r.ata : 0) + ':' + r.destId; if (boardNoted.get(id) !== sig && (r.atd || r.landed)) { boardNoted.set(id, sig); boardNoteFlight(id, { hex: hx0, reg: f0.reg || '', type: f0.type || '', cs: f0.cs || '' }, r); } } catch (err) { log('board note', err); } }
        if (r) { e.pub = r; const f = e.f; list.push({ id, rec: { cs: f.cs || '', reg: f.reg || '', type: f.type || '', hex: f.hex ? Number(f.hex).toString(16).padStart(6, '0') : '', cat: '', fcat: fr24Cat({ type: f.type }), mil: false, operatorId: operatorIdOf({}, f.cs) }, route: routeForPage(r), pos: { lat: f.lat, lon: f.lon, alt: f.alt, gnd: !!f.gnd, at: e.at } }); }
        else if (e.pub) { e.pub = null; drop.push(id); }
      }, { maxMs: 40 });
      if (list.length || drop.length) postToPage('naBoard', { list, drop });
    } finally { naBusy = false; }
  }
  setInterval(() => { naTick().catch(e => log('na boards', e)); }, 20000);
  // ---- a flight FR24 lists elsewhere with no destination (its Most tracked widget), anywhere in the world -----------------
  // Asked for by the page; worked out the same way from FR24's own track of the flight, fetched in the background one at a
  // time (the page's FollowFlight, its first frame). The answer goes to the page as the boards' N/A flights' do; FR24's
  // next asking for the list has it. (One opened in the panel, or in view on the map, is worked out there already.)
  const naWanted = new Map();   // fr24 id -> { cs, from, type, at, trailAt }
  function onNeedNaRoutes(d) {
    for (const x of (d && d.list) || []) {
      const id = Number(x && x.id) || 0; if (!id || live.has(id) || pubRouted(id) || (naFeed.get(id) || {}).pub) continue;
      const w = naWanted.get(id) || { trailAt: 0 };
      naWanted.set(id, Object.assign(w, { cs: String(x.cs || ''), from: String(x.from || '').toUpperCase(), type: String(x.type || ''), at: now() }));
    }
    naWantedTick();
  }
  function naWantedTick() {
    if (!naWanted.size || !airportsReady()) return;
    let asked = false;
    for (const [id, w] of naWanted) {
      if (now() - w.at > 10 * 60000) { naWanted.delete(id); continue; }
      const ft = fr24Trail.get(id);
      if (ft && ft.pts && ft.pts.length >= 3 && (ft.at || 0) >= w.at - 60000) { naWanted.delete(id); try { naFromTrail(id, w, ft); } catch (e) { log('na route', e); } continue; }
      if (!asked && now() - w.trailAt > 30000) { w.trailAt = now(); asked = true; postToPage('needTrail', { id }); }
    }
  }
  setInterval(naWantedTick, 10000);
  function naFromTrail(id, w, ft) {
    const trail = [];
    for (const p of ft.pts) { if (!fin(p.lat) || !fin(p.lon) || !fin(p.t)) continue; const last = trail[trail.length - 1]; if (!last || p.t - last.t >= 20) trail.push({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs, trk: p.trk, gnd: false }); }
    const pos = trail[trail.length - 1]; if (!pos || nowS() - pos.t > 15 * 60) return null;
    const f = { id, cs: w.cs, reg: '', type: w.type, hex: 0, from: w.from, lat: pos.lat, lon: pos.lon, alt: pos.alt, spd: pos.gs, trk: pos.trk, gnd: false };
    const r = naRouteOf({ f, trail: trail.slice(-400), pub: null }); if (!r) return null;
    postToPage('naBoard', { list: [{ id, rec: { cs: w.cs, reg: '', type: w.type, hex: '', cat: '', fcat: fr24Cat({ type: w.type }), mil: false, operatorId: operatorIdOf({}, w.cs) }, route: routeForPage(r), pos: { lat: pos.lat, lon: pos.lon, alt: pos.alt, gnd: false, at: pos.t * 1000 } }] });
    return r;
  }
  // ---- zero-network routes for every identified aircraft (airport boards, search, labels) ---------------------------
  // Never-routed aircraft first (just identified; those in view ahead of the world scan's), then the rest in rotation -
  // in view every 20 s, elsewhere every 2 min. All in idle slices: the newly identified in view as fast as idle time
  // allows, the rest at most 40 ms of slices a round (a round every 3 s).
  let quickBusy = false, quickCursor = 0, quickTimer = 0;
  const quickSoon = () => { if (!quickTimer) quickTimer = setTimeout(() => { quickTimer = 0; quickRouteAll(); }, 30); };
  async function quickRouteAll() {
    if (quickBusy || !airportsReady()) return;
    quickBusy = true;
    let batch = [];
    const flush = () => { if (batch.length) { postToPage('routes', { list: batch }); batch = []; } };
    try {
      const t = now(), inView = id => { const f = pending.get(id); return !!f && !f.bg; };
      const all = [...live.keys()], fresh = all.filter(id => !(live.get(id) || {}).route);
      const freshSet = new Set(fresh), freshView = fresh.filter(inView), freshBg = fresh.filter(id => !inView(id));
      const start = all.length ? quickCursor % all.length : 0;
      const rot = all.slice(start).concat(all.slice(0, start)).filter(id => {
        if (freshSet.has(id)) return false;
        const rec = live.get(id); if (!rec || !rec.route || !rec.route.quick) return true;
        return t - rec.route.computedAt >= (inView(id) ? 20000 : 120000);
      });
      const one = id => {
        const rec = live.get(id); if (!rec || !rec.hex) return;
        const st = routeState.get(id);
        if (st && st.route && !st.route.quick && now() - st.route.computedAt < 60000) return;
        if (rec.route && rec.route.quick && now() - rec.route.computedAt < 20000) return;
        const f = pending.get(id); if (!f || now() - f.receivedAt > 20 * 60000) return;
        const r = composeRoute(id, rec.hex, { quick: true });
        if (!r) return;
        rec.route = r;
        batch.push({ id, route: (r.originId || r.destId || r.groundAirportId || r.destIata || r.originIata) ? routeForPage(r) : null });
        if (batch.length >= 25) flush();
      };
      await sliced(freshView, one);
      flush();
      const rest = freshBg.concat(rot);
      const at = new Map(all.map((id, i) => [id, i]));
      const k = await sliced(rest, (id, i) => { if (i >= freshBg.length) quickCursor = (at.get(id) + 1) % Math.max(1, all.length); one(id); }, { maxMs: 40 });
      flush();
      if (k < rest.length && freshBg.length > k) quickSoon();     // (newly identified ones still waiting: another round soon)
    } catch (e) { log('quickRouteAll', e); }
    finally { quickBusy = false; }
  }

  // ---- FR24's filed plan (from its airport boards); refreshed while selected so "landed" shows up ----------------------
  async function refreshPlan(id) {
    const ps = planState.get(id) || { plan: null, at: 0, tried: 0 };
    const st = routeState.get(id), r = st && st.route;
    const originId = fr24Ap(r && !r.landed && r.originId || 0);
    const destIds = r ? [fr24Ap(r.destId), ...(r.alternatives || []).map(a => { const ap = airports.byIata.get(a.iata); return ap ? ap.id : 0; })].filter(Boolean).slice(0, 2) : [];
    const searchKey = originId + '|' + destIds.join(',');
    const wait = ps.plan ? 60000 : (originId || destIds.length ? 15000 : 5000);
    if (searchKey === ps.searchKey && now() - ps.at < wait) return ps.plan;
    if (!originId && !destIds.length) { ps.at = now(); planState.set(id, ps); return ps.plan; }
    ps.searchKey = searchKey; ps.at = now(); ps.tried++; planState.set(id, ps);
    try {
      const plan = await fr24.plan(id, originId, destIds);
      if (plan) { ps.plan = plan; log('flight plan', id.toString(16), apCode(apById(plan.originId)), '→', apCode(apById(plan.destId)), plan.status); }
    } catch (e) { log('plan lookup', String(e.message || e)); }
    return ps.plan;
  }
  // Full route for one aircraft: an instant answer from what is already known, then today's trace (origin from the
  // runway), the filed plan, and - for the selected aircraft - three months of history, refining as each arrives.
  async function routeFor(rec, light, opts) {
    const id = rec.id, hex = rec.hex; if (!hex) return;
    let st = routeState.get(id);
    if (!st) { st = { hex, working: false, maxAlt: 0, landedAt: 0 }; routeState.set(id, st); }
    st.hex = hex;
    if (airportsReady()) publishRoute(id, composeRoute(id, hex));
    if (st.working) { if (!light) st.wantFull = true; return; }
    st.working = true;
    try {
      await loadAirports();
      publishRoute(id, composeRoute(id, hex));
      const selected = () => onScreen(id) || hexOnScreen(hex);
      // (a flight an airport board lists is on screen too: its take-off - the board's departure - straight away)
      const front = selected() || !!(opts && opts.board);
      const todayJob = loadToday(hex, front ? 45000 : 180000, { priority: front, idle: !front }).then(() => { publishRoute(id, composeRoute(id, hex)); if (selected() || hexOnScreen(hex)) warmHist(live.get(id) || pubRouted(id)); }).catch(e => log('trace today', String(e.message || e)));
      const histJob = selected() || !store.peekHist(hex) ? store.getHist(hex).then(() => { publishRoute(id, composeRoute(id, hex)); if (selected() || hexOnScreen(hex)) warmHist(live.get(id) || pubRouted(id)); }) : Promise.resolve();
      await Promise.all([todayJob, histJob]);
      if (bootHold.delete(hex)) publishRoute(id, composeRoute(id, hex));
      if (live.has(id)) { await refreshPlan(id); publishRoute(id, composeRoute(id, hex)); }
      if ((light && !st.wantFull) || !selected()) return;
      st.wantFull = false;
      // (on screen: FR24 can renumber a flight mid-stream, so the id in the URL is not always the one shown)
      await loadHistory(hex, HISTORY_DAYS, () => { if (onScreen(id) || hexOnScreen(hex)) { publishRoute(id, composeRoute(id, hex)); warmHist(live.get(id) || pubRouted(id)); } }, { front: true });
      publishRoute(id, composeRoute(id, hex));
      warmHist(live.get(id) || pubRouted(id));
    } finally { st.working = false; }
  }
  setInterval(() => {
    const id = shownId != null && pubRouted(shownId) ? shownId : currentId(), rec = id != null && (live.get(id) || pubRouted(id));
    if (rec && rec.hex && routeState.get(id) && !routeState.get(id).working) {
      (live.has(id) ? refreshPlan(id) : Promise.resolve()).then(() => publishRoute(id, composeRoute(id, rec.hex))).catch(() => publishRoute(id, composeRoute(id, rec.hex)));
      if (!document.hidden) loadToday(rec.hex, 120000, { priority: true }).then(() => publishRoute(id, composeRoute(id, rec.hex))).catch(() => {});
    }
    // (still loading its log - minutes, for 200 flights: the route worked out again all the same from where it is now, with
    // what is in so far - not left as it was when the panel opened while the aircraft flies on)
    else if (rec && rec.hex && routeState.get(id) && routeState.get(id).working) { const st = routeState.get(id); if (now() - Math.max(st.loadingAt || 0, (st.route && st.route.computedAt) || 0) > 30000) { st.loadingAt = now(); publishRoute(id, composeRoute(id, rec.hex)); } }
  }, 15000);
  // The panel's airports, times and progress bar are fed by the FollowFlight stream's first frame, so routes for what
  // is on screen are prepared ahead of the click.
  let precomputeBusy = false;
  async function precomputeRoutes() {
    if (precomputeBusy || document.hidden || !airportsReady()) return;
    const t = now(), sel = currentId(), c = viewCenter, list = [];
    for (const [id, rec] of live) {
      if (!rec.hex || id === sel) continue;
      const f = pending.get(id); if (!f || f.bg || t - f.receivedAt > PENDING_TTL_MS) continue;
      const td = todayCache.get(rec.hex); if (td && t - td.at < 240000) continue;
      list.push({ id, rec, f });
    }
    if (c) list.sort((a, b) => dist(a.f.lat, a.f.lon, c.lat, c.lon) - dist(b.f.lat, b.f.lon, c.lat, c.lon));
    if (!list.length) return;
    precomputeBusy = true;
    // (one aircraft per idle moment: its route is worked out twice or three times as its track and plan come in)
    try { for (const { id, rec } of list.slice(0, PRECOMPUTE_MAX)) { await idleSlice(); if (currentId() === id) continue; try { await routeFor(rec, true); } catch (e) { log('precompute', String(e.message || e)); } } }
    finally { precomputeBusy = false; }
  }
  // Every identified aircraft gets the same reasoning as the selected one, not just the one clicked: its own flight log
  // (past flights, home base, habits, return legs) is rebuilt in the background - a month first for everything in view
  // or on an airport board, then the rest of the world, then the full three months while idle. One aircraft at a time
  // (adsb.lol is a community service); logs are kept in IndexedDB, so each is fetched once and then only topped up daily.
  const BG_HIST_DAYS = 30;
  const boardSeenAt = new Map();                 // fr24 id -> when an airport board listed it
  const histPumped = new Map();                  // hex -> { days, at }
  let histPumpBusy = false;
  async function historyPump() {
    if (histPumpBusy || document.hidden || !airportsReady() || userBusy()) return;
    const sel = currentId(), selRec = sel != null ? live.get(sel) : null;
    if (selRec && selRec.hex && (historyJobs.get(selRec.hex) || {}).running) return;      // the selected aircraft first
    const t = now(), c = viewCenter, cands = [];
    for (const [id, rec] of live) {
      if (!rec.hex || id === sel) continue;
      const f = pending.get(id), onBoard = t - (boardSeenAt.get(id) || 0) < 15 * 60000;
      if (!onBoard && (!f || t - f.receivedAt > PENDING_TTL_MS)) continue;
      const done = histPumped.get(rec.hex), fresh = done && t - done.at < 6 * 3600e3;
      const want = !fresh || done.days < BG_HIST_DAYS ? BG_HIST_DAYS : done.days < HISTORY_DAYS ? HISTORY_DAYS : 0;
      const near = onBoard || (f && !f.bg);
      if (!want || (want > BG_HIST_DAYS && !near)) continue;             // far-away world-scan finds: one month
      cands.push({ id, rec, want, rank: (want > BG_HIST_DAYS ? 2e6 : 0) + (near ? 0 : 1e6) + (c && f ? dist(f.lat, f.lon, c.lat, c.lon) : 5e5) });
    }
    if (!cands.length) return;
    cands.sort((a, b) => a.rank - b.rank);
    const { id, rec, want } = cands[0];
    histPumpBusy = true;
    try {
      await loadToday(rec.hex, 10 * 60000, { bg: true }).catch(() => {});          // today's track: where this flight took off
      await loadHistory(rec.hex, want, null, { bg: true });
      histPumped.set(rec.hex, { days: want, at: now() });
      if (live.get(id)) publishRoute(id, composeRoute(id, rec.hex));
    } catch (e) { histPumped.set(rec.hex, { days: want, at: now() - 5 * 3600e3 }); log('background history', rec.hex, String(e.message || e)); }
    finally { histPumpBusy = false; }
  }

  const replanTimers = new Map();
  function scheduleReplan(id, delay) {
    if (replanTimers.has(id)) return;
    replanTimers.set(id, setTimeout(() => { replanTimers.delete(id); const rec = live.get(id) || pubRouted(id); if (rec && rec.hex) publishRoute(id, composeRoute(id, rec.hex)); }, delay || 250));
  }

  // ---- "Recent <reg> flights" dropdown: FR24's own flight-list format, built from the reconstructed log ---------------
  function airportObj(a) {
    if (!a) return null;
    const tz = a.timezone || { name: 'UTC', offset: a.tz || 0, abbr: 'UTC', abbrName: null, isDst: false };
    const iso = (() => { const c = HEX_BLOCKS.find(b => b[2] === a.country); return c ? c[3] : ''; })();
    return { name: a.name, code: { iata: a.iata || null, icao: a.icao || null }, position: { latitude: a.lat, longitude: a.lon, country: { name: a.country, code: iso, id: a.countryId || countryIdByName.get(String(a.country).toUpperCase()) || 0 }, region: { city: a.city } }, timezone: tz, visible: true };
  }
  function flightListEntry(l, rec, i) {
    const from = l.from ? apById(l.from.id) : null, to = l.to ? apById(l.to.id) : null;
    const tzTo = to && fin(to.tz) ? to.tz : 0;
    const landed = !!(l.ended && to), liveNow = !!l.live;
    const hm = t => { const d = new Date((t + tzTo) * 1000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
    const status = liveNow ? { live: true, text: 'Estimated- ' + hm(l.eta || l.tEnd), icon: 'green', estimated: null, ambiguous: false, generic: { status: { text: 'estimated', type: 'arrival', color: 'green', diverted: null }, eventTime: { utc: l.eta || null, local: l.eta ? l.eta + tzTo : null } } }
      : landed ? { live: false, text: 'Landed ' + hm(l.tEnd), icon: 'green', estimated: null, ambiguous: false, generic: { status: { text: 'landed', type: 'arrival', color: 'green', diverted: null }, eventTime: { utc: l.tEnd, local: l.tEnd + tzTo } } }
      : to ? { live: false, text: 'Landed', icon: 'gray', estimated: null, ambiguous: true, generic: { status: { text: 'landed', type: 'arrival', color: 'gray', diverted: null }, eventTime: { utc: null, local: null } } }
      : { live: false, text: 'Unknown', icon: 'gray', estimated: null, ambiguous: true, generic: { status: { text: 'unknown', type: 'arrival', color: 'gray', diverted: null }, eventTime: { utc: null, local: null } } };
    const idHex = (0xa0000000 + ((l.tStart >>> 0) % 0x0fffffff)).toString(16);
    return {
      identification: { id: idHex, row: 9100000000 + i, number: { default: null, alternative: null }, callsign: l.cs || csOfRec(rec), codeshare: null },
      status,
      aircraft: { model: { code: rec.type || '', text: rec.desc || rec.type || '' }, registration: rec.reg, country: null, hex: (rec.hex || '').toUpperCase(), restricted: false, serialNo: rec.msn || null, age: { availability: false }, availability: { serialNo: false, age: false } },
      owner: null, airline: { name: shownOwner(rec, rec.cs) || (rec.mil ? 'Military' : 'Private owner'), code: { iata: null, icao: rec.operatorIcao || null }, short: rec.operatorName || rec.owner || 'Private owner' },
      airport: { origin: airportObj(from), destination: airportObj(to), real: null },
      time: { scheduled: { departure: null, arrival: null }, real: { departure: l.tStart, arrival: landed ? l.tEnd : null }, estimated: { departure: null, arrival: liveNow ? (l.eta || null) : null }, other: { eta: liveNow ? l.eta : l.tEnd, updated: l.tEnd, duration: landed ? l.tEnd - l.tStart : null } },
      // (the page's "Playback" opens the leg's track on airplanes.live instead of FR24's flight, which it never recorded)
      __tlPb: l.tStart > 0 ? { t: l.tStart, lat: from && fin(from.lat) ? from.lat : fin(l.startLat) ? l.startLat : null, lon: from && fin(from.lon) ? from.lon : fin(l.startLon) ? l.startLon : null, z: from ? 10 : 9 } : null
    };
  }
  const histReqs = new Map();
  const histShown = new Map();    // reg -> { hex, legs } last list handed to FR24's "Recent flights" (row i = legs[i + 1])
  // The list for an aircraft as known right now: [rec, hex, build, past] (null when the registration is not known)
  function histListOf(reg) {
    // (a blocked aircraft we identified, or an ordinary one FR24 shows - its panel record)
    let rec = [...live.values()].find(r => r.reg && r.reg.toUpperCase() === reg) || [...pubRecs.values()].find(r => r.reg && r.reg.toUpperCase() === reg && r.hex);
    const hx = store.byReg(reg);
    const hex = (rec && rec.hex) || (hx && hx.hex);
    if (!hex) return null;
    rec = Object.assign({}, hx || {}, rec || {}, { reg });
    return { rec, hex };
  }
  // The aircraft's flight now, when it is flying: our route of it says so, else FR24's own plan of it (departed, not
  // arrived), else where it is - in the air within the last 20 minutes. { start, o, d, eta } (what is known), or null.
  // (An ordinary flight FR24 routes itself has no route of ours: N212AP as WWI21, MAN -> TEB, and VQ-BXF as PEX28F,
  // RTM -> LCY, were taken for on the ground, and their own flight was listed under them as "Manchester -> N/A, Unknown")
  function flyingNow(hex, rec) {
    const t = nowS(), aloft = p => !!p && fin(p.lat) && t - p.t < 1200 && !(p.gnd || p.gnd0) && !(fin(p.alt) && p.alt < 50 && fin(p.gs) && p.gs < 45);
    // (the flight the registration was found under, and the one on screen - of this aircraft)
    const ids = [rec.id, currentId()].filter((id, i, a) => id != null && a.indexOf(id) === i && hexOfId(id) === hex);
    for (const id of ids) {
      const st = routeState.get(id), r = (live.get(id) || pubRecs.get(id) || {}).route || (st && st.route);
      if (r) { if (r.onGround) continue; return { start: r.departedAt || 0, o: r.originId || 0, d: r.destId || 0, eta: r.eta || 0 }; }
      const s = fr24Sched.get(id), o = s && apById(s.o) ? s.o : 0, d = s && apById(s.d) ? s.d : 0, atd = s && s.atd && !s.ata && t - s.atd < 20 * 3600 ? s.atd : 0;
      // (where it is decides while that is known - landed, FR24's plan may never say it arrived)
      const p = currentPos(id);
      if (p && fin(p.lat) && t - p.t < 1200) { if (aloft(p)) return { start: atd, o, d, eta: 0 }; continue; }
      if (atd) return { start: atd, o, d, eta: 0 };
    }
    if (ids.length) return null;
    // (none in view: its public ADS-B position, or the last report of its track of today)
    const c = areaCache.get(hex);
    if (c && fin(c.lat) && now() - seenAt(c) < 120000) return aloft({ t: Math.floor(seenAt(c) / 1000), lat: c.lat, alt: c.alt, gs: c.gs, gnd: !!c.gnd }) ? { start: 0, o: 0, d: 0, eta: 0 } : null;
    return aloft((todayCache.get(hex) || {}).lastPt) ? { start: 0, o: 0, d: 0, eta: 0 } : null;
  }
  // "Recent <reg> flights" before anyone opens it: the aircraft being looked at has its list handed to the page as soon
  // as its log is known (and again as it grows), so the dropdown fills the instant it is opened - FR24 asks only then.
  const histWarmAt = new Map();
  const histWarmT = new Map();
  function warmHist(rec) {
    const reg = String(rec && rec.reg || '').toUpperCase(); if (!reg || !rec.hex || !airportsReady()) return;
    // (at most every 4 s - and the latest state always goes, a moment later)
    if (now() - (histWarmAt.get(reg) || 0) < 4000) { if (!histWarmT.has(reg)) histWarmT.set(reg, setTimeout(() => { histWarmT.delete(reg); warmHist(rec); }, 4100 - (now() - histWarmAt.get(reg)))); return; }
    if (!store.peekHist(rec.hex) && !todayCache.get(rec.hex)) return;
    histWarmAt.set(reg, now());
    onNeedHist(reg, true).catch(e => log('warm hist', e));
  }
  async function onNeedHist(reg, warm) {
    reg = String(reg || '').toUpperCase(); if (!reg) return;
    if (!warm && histReqs.has(reg) && now() - histReqs.get(reg) < 3000) return;
    if (!warm) histReqs.set(reg, now());
    const known = histListOf(reg);
    if (!known) { if (!warm) postToPage('hist', { reg, data: null }); return; }
    let { rec } = known; const { hex } = known;
    // (what is already in memory is answered at once; only a log never loaded is waited for, briefly)
    // (today's files are read whatever is kept - both networks', the aircraft being looked at: today's earlier flights, the
    // night's crossing before the flight on screen, are in no day's log yet - N73VR's Luton arrival)
    const todayJob = warm ? null : loadToday(hex, 300000, { priority: true }).catch(() => null);
    if (!warm && !store.peekHist(hex)) { try { await loadAirports(); await Promise.race([Promise.all([todayJob, store.getHist(hex)]), sleep(1600)]); } catch (e) { /* use what we have */ } }
    // current flight first (FR24's list component always skips the first entry, which is the flight on screen)
    const fly = flyingNow(hex, rec);
    const past = () => knownLegs(hex).filter(l => l.from || l.to).sort((a, b) => b.tStart - a.tStart);
    const build = all => {
      let legs = all, head = all.slice(0, 1);
      if (fly) {
        // the trace's leg of that same flight (the newest, still open, heard within 12 hours) is left out of the list
        // below the (hidden) head, and so is any part of it a hole in coverage cut off; an older flight last heard high
        // stays, "-> N/A"
        const open = all[0] && !all[0].ended && nowS() - all[0].tEnd < 12 * 3600 ? all[0] : null;
        const t0 = fly.start || (open && open.tStart) || nowS() - 60, cur = open && open.tEnd >= t0 - 300 ? open : null;
        legs = all.filter(l => l.tEnd < t0 - 300);
        const o = fly.o || (cur && cur.from && cur.from.id) || 0, d = fly.d || (cur && cur.to && cur.to.id) || 0;
        head = [{ tStart: t0, tEnd: fly.eta || nowS(), eta: fly.eta || 0, from: o ? { id: o } : null, to: d ? { id: d } : null, cs: rec.cs, ended: false, live: true }];
      }
      const list = head.concat(legs).slice(0, 30);
      histShown.set(reg, { hex, legs: list });
      return list.map((l, i) => flightListEntry(l, rec, i));
    };
    // what is known now, marked partial while the log is still being fetched; then the full log (the page waits for
    // it when the first answer has nothing to list)
    const more = !store.peekHist(hex) || Object.keys((store.peekHist(hex) || {}).days || {}).length < 14;
    const build0 = build(past());
    postToPage('hist', { reg, data: build0, partial: more });
    // (handed over the moment it has flights to list - the monitor's days come in one request, well before every day is
    // read from the networks: FR24 draws the list once, from its first answer, and that answer waits nine seconds at most;
    // a log read day by day took longer, and N1876T's and HB-IGO's lists said "No flights available")
    let sent = 0;
    const progress = () => { const d = build(past()); if (d.length > 1 && d.length !== sent) { sent = d.length; postToPage('hist', { reg, data: d, partial: true }); } };
    if (more && !warm) loadHistory(hex, 21, progress, { front: true }).then(() => postToPage('hist', { reg, data: build(past()) }), () => postToPage('hist', { reg, data: build(past()) }));
    // (today's files come in after the first answer: handed over again with what they add)
    if (todayJob) todayJob.then(() => { const d = build(past()); if (d.length > 1 && JSON.stringify(d) !== JSON.stringify(build0)) { sent = d.length; postToPage('hist', { reg, data: d, partial: more }); } });
  }
  // A flight still "on its way" whose positions stopped five minutes and more ago (a blocked jet FR24 no longer sends
  // once it is down, its transponder off at the stand): its ADS-B track of today read again - landed there, it says so
  // (OK-FLN, in at Luton at 15:26, was "Estimated arrival 16:26" and live in search half an hour later). One flight per
  // pass, every 2 minutes, each at most every 5 minutes.
  const quietAsked = new Map();
  setInterval(() => {
    const t = now();
    for (const [id, rec] of live) {
      const st = routeState.get(id), r = st && st.route; if (!rec || !rec.hex || !r || r.landed || t - (quietAsked.get(id) || 0) < 5 * 60000) continue;
      const h = posHistory.get(id), last = Math.max(h && h.length ? h[h.length - 1].at : 0, (pending.get(id) || {}).receivedAt || 0);
      if (!last || t - last < 5 * 60000 || t - last > 12 * 3600e3) continue;
      // (last seen low - landing - not quiet at cruise: that is out of coverage, the ocean pass's)
      const lp = currentPos(id); if (!lp || (!lp.gnd && !(fin(lp.alt) && lp.alt < 10000))) continue;
      quietAsked.set(id, t); if (quietAsked.size > 500) quietAsked.delete(quietAsked.keys().next().value);
      loadToday(rec.hex, 60000, { bg: true }).then(() => scheduleReplan(id, 50)).catch(() => {});
      break;
    }
  }, 120000);
