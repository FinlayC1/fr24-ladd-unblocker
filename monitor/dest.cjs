// A rough destination for every flight the monitor has named, worked out on the server so a browser shows one the moment it
// connects - wherever the flight is. The same engine and learned weights as the userscript (src/engine.js predict, with
// src/tables.json + src/logit.json), on the same evidence the userscript's watch list uses (06-tools predictForHex):
//   the flight so far   - the positions the monitor recorded of it (public ADS-B), then FR24's own where nobody else hears
//                         it (its trail since take-off, its scanned positions over the ocean)
//   where it took off   - the monitor's flight record, else worked out from that track
//   its history         - every earlier flight the monitor kept of it (90 days)
// Not the population tables (src/tables2.json: ~200 MB in memory, too much for a 1 GB server) - so "rough": the browser
// works the full prediction out for whatever is on screen, with all of it, as before.
const fin = v => typeof v === 'number' && isFinite(v);

function createDest(env) {
  const { E } = env;
  const C = Object.assign({ every: 300, perRound: 250, budgetMs: 1500 }, env.cfg || {});
  const stats = { done: 0, failed: 0, ms: 0, lastRound: 0 };

  // the flight's track: recorded ADS-B of its current flight, FR24's trail before it, FR24's positions after it; one point
  // every 20 s at most - cut back to where this flight began (FR24's trail can hold the flight before it: one id through a
  // stop out of coverage, N6012C's Baku flight under its Hanoi flight's id), with where it was last heard before the hole
  // that cut it in gapFrom / gapInfo (as the userscript's trailFor)
  function trackOf(hex, F) {
    let pts = [], gapFrom = null, gapInfo = null;
    const x = env.ac.get(hex), meta = (x && x.meta) || {}, cls0 = E.classify({ hex, type: meta.type || (F && F.type) || '', reg: meta.reg || '', mil: !!meta.mil, cat: meta.cat || '' });
    if (x && x.rows && x.rows.length >= 2) {
      const info = { hex, type: meta.type || '', reg: meta.reg || '', mil: !!meta.mil, cat: meta.cat || '' }, cls = E.classify(info);
      try {
        const ls = E.legsFromPoints(E.parseTrace({ timestamp: 0, trace: x.rows }), { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', cls, type: info.type, rangeKm: E.typeRangeKm(info) });
        const leg = ls[ls.length - 1];
        // (only a flight still going - and the one FR24 is drawing: heard within the last 3 hours of FR24's position)
        if (leg && !leg.ended && (!F || F.ts - leg.end.t < 3 * 3600)) {
          pts = [leg.start].concat(leg.pts).filter((p, i, a) => !i || p.t > a[i - 1].t);
          // (this flight began after a hole it came down in: where it was last heard before)
          const pl = ls[ls.length - 2]; if (pl && pl.how === 'gap-land') { gapFrom = pl.end; gapInfo = pl.gapInfo || null; }
        }
      } catch (e) { pts = []; }
    }
    if (F && F.trail && F.trail.length) {
      const t0 = pts.length ? pts[0].t : Infinity;
      const before = F.trail.filter(p => p.t < t0 - 20).map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt > 0 ? p.alt : null, gs: p.gs, trk: p.trk, gnd: !(p.alt > 0) && !(p.gs > 50) }));
      pts = before.concat(pts);
    }
    if (F && F.pts && F.pts.length) {
      const t1 = pts.length ? pts[pts.length - 1].t : -Infinity;
      for (const p of F.pts) if (p.t > t1 + 20) pts.push({ t: p.t, lat: p.lat, lon: p.lon, alt: p.gnd ? null : p.alt, gs: p.gs, trk: p.trk, gnd: !!p.gnd });
    }
    let out = []; for (const p of pts) if (fin(p.lat) && fin(p.lon) && (!out.length || p.t - out[out.length - 1].t >= 20)) out.push(p);
    const cl = out.length > 1 ? E.currentLeg(out, { heli: cls0 === 'heli', patrol: cls0 === 'fighter' || cls0 === 'milheavy' }) : null;
    if (cl && cl.cut) { out = cl.pts; gapFrom = cl.gapFrom; gapInfo = cl.gapInfo; }
    out.cut = !!(cl && cl.cut) || !!gapFrom;
    if (gapFrom && out.length && !out[0].gnd && gapFrom.t < out[0].t) { out.gapFrom = gapFrom; out.gapInfo = Object.assign({}, gapInfo, { bClimb: E.gapEnds([gapFrom].concat(out), 1).bClimb, gap: out[0].t - gapFrom.t }); }
    return out;
  }
  // The destination of one named flight: { dest: {id, p, at}, origin: {id, conf} } (null: nothing to say - on the ground,
  // or no airports loaded)
  function predictFor(R, F, nowS) {
    if (!F || F.gnd || E.airports.length < 1000) return null;
    const trail = trackOf(R.hex, F); if (trail.length < 2) return null;
    const last = trail[trail.length - 1], pos = Object.assign({}, last, { gnd: false });
    if (!fin(pos.trk) && trail.length > 1) { const q = trail[trail.length - 2]; pos.trk = E.brg(q.lat, q.lon, pos.lat, pos.lon); }
    const x = env.ac.get(R.hex), meta = (x && x.meta) || {};
    const ac = { hex: R.hex, type: R.type || meta.type || '', reg: R.reg || meta.reg || '', cs: R.cs || meta.cs || '', mil: !!meta.mil || !!(R.flags & 2), cat: meta.cat || '', ladd: !!(R.flags & 1) };
    // (its earlier flights - before this one began)
    const m = env.legs.get(R.hex), t0 = trail[0].t;
    const hist = m ? E.chainLegs(E.stitchLegs([...m.values()].filter(l => !l.open && (l.tEnd || l.tStart) < t0 - 60).map(l => Object.assign({}, l)))) : [];
    const hs = E.histStats(hist, pos.t);
    // (where it took off: the monitor's record of this flight, when it began with this track)
    let origin;
    const open = m ? [...m.values()].filter(l => l.open && l.from && Math.abs((l.tStart || 0) - t0) < 1800).sort((a, b) => b.tStart - a.tStart)[0] : null;
    if (open && E.byId(open.from.id)) origin = { airport: E.byId(open.from.id), conf: open.from.conf || 'ground', departedAt: open.tOff || open.tStart };
    else origin = E.inferOrigin({ ac, pos, trail, hs, now: pos.t });
    // (no departure seen - it came down in a hole in coverage and climbed out of it: the field that fits both ends, as the userscript)
    if ((!origin || !origin.airport || origin.conf === 'history') && trail.gapFrom) {
      const g = E.landingInGap(trail.gapFrom, trail[0], Object.assign({ cls: E.classify(ac), type: ac.type }, trail.gapInfo));
      if (g) origin = { airport: g.airport, conf: 'low', note: `took off from ${g.airport.code}, out of ADS-B coverage`, departedAt: Math.round(trail[0].t - g.db / 500 * 3600 - 120) };
    }
    const res = E.predict({ ac, pos, trail, hs, now: pos.t, origin });
    const top = res && res.cands && res.cands[0];
    const o = res && res.origin && res.origin.airport ? { id: res.origin.airport.id, conf: res.origin.conf || '', t: Math.round(res.origin.departedAt || trail[0].t) } : null;
    // (when it was last heard before the hole this flight began after: a departure kept from before that is the flight before's)
    const lostAt = trail.gapFrom ? trail.gapFrom.t : 0;
    if (!top || !top.airport) return { dest: null, origin: o, lostAt };
    // (when it will be there, roughly: the distance left at its present ground speed, a little longer for the way in)
    const A = top.airport, km = E.dist(pos.lat, pos.lon, A.lat, A.lon), gs = pos.gs > 80 ? pos.gs : 300;
    const eta = Math.round(pos.t + km / (gs * 1.852) * 3600 * 1.06 + (km > 30 ? 420 : 120));
    return { dest: { id: A.id, p: Math.min(0.99, E.calibrated(top.p, res.cls)), at: Math.round(nowS), eta, why: (top.reasons || []).slice(0, 2).join('; ') }, origin: o, lostAt };
  }
  // A round: the named airborne flights whose destination is oldest (or none yet), each again after `every` seconds, within
  // a time budget (the server is small); a changed answer is marked so the browsers get it
  function round(ident, nowMs) {
    const nowS = nowMs / 1000, due = [];
    for (const [id, R] of ident.ids) { const F = ident.flights.get(id); if (!F || F.gnd || nowMs - F.seen > 10 * 60000) continue; const at = R.destTried || 0; if (nowS - at >= C.every) due.push([id, R, F, at]); }
    due.sort((a, b) => a[3] - b[3]);
    const t0 = Date.now(); let n = 0;
    for (const [, R, F] of due) {
      if (n >= C.perRound || Date.now() - t0 > C.budgetMs) break;
      n++; R.destTried = nowS;
      let r = null; try { r = predictFor(R, F, nowS); stats.done++; } catch (e) { stats.failed++; continue; }
      if (!r) continue;
      const before = JSON.stringify([R.dest && R.dest.id, R.dest && Math.round(R.dest.p * 20), R.origin && R.origin.id]);
      R.dest = r.dest; if (r.origin) R.origin = r.origin;
      // (no departure now, and the one kept is from before the aircraft was last heard ahead of the hole this flight began
      // after - a stop out of coverage in between: not kept)
      else if (R.origin && r.lostAt && R.origin.t > 0 && R.origin.t < r.lostAt - 300) R.origin = null;
      // (and a browser's departure for it from that earlier flight, the same: the one served is this side's own then)
      const cr = R.crowd; if (cr && cr.o && cr.atd > 0 && r.lostAt && cr.atd < r.lostAt - 300) { Object.assign(cr, { o: 0, oc: '', atd: 0, ot: 0, oOwn: 0 }); if (!cr.d) R.crowd = null; R.chg = nowMs; }
      if (JSON.stringify([R.dest && R.dest.id, R.dest && Math.round(R.dest.p * 20), R.origin && R.origin.id]) !== before) R.chg = nowMs;
    }
    stats.ms = Date.now() - t0; stats.lastRound = nowMs;
    return n;
  }
  return { predictFor, trackOf, round, stats };
}
module.exports = { createDest };
