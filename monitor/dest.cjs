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
  // every 20 s at most
  function trackOf(hex, F) {
    let pts = [];
    const x = env.ac.get(hex), meta = (x && x.meta) || {};
    if (x && x.rows && x.rows.length >= 2) {
      const info = { hex, type: meta.type || '', reg: meta.reg || '', mil: !!meta.mil, cat: meta.cat || '' }, cls = E.classify(info);
      try {
        const ls = E.legsFromPoints(E.parseTrace({ timestamp: 0, trace: x.rows }), { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', cls, type: info.type, rangeKm: E.typeRangeKm(info) });
        const leg = ls[ls.length - 1];
        // (only a flight still going - and the one FR24 is drawing: heard within the last 3 hours of FR24's position)
        if (leg && !leg.ended && (!F || F.ts - leg.end.t < 3 * 3600)) pts = [leg.start].concat(leg.pts).filter((p, i, a) => !i || p.t > a[i - 1].t);
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
    const out = []; for (const p of pts) if (fin(p.lat) && fin(p.lon) && (!out.length || p.t - out[out.length - 1].t >= 20)) out.push(p);
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
    const res = E.predict({ ac, pos, trail, hs, now: pos.t, origin });
    const top = res && res.cands && res.cands[0];
    const o = res && res.origin && res.origin.airport ? { id: res.origin.airport.id, conf: res.origin.conf || '' } : null;
    if (!top || !top.airport) return { dest: null, origin: o };
    return { dest: { id: top.airport.id, p: Math.min(0.99, E.calibrated(top.p, res.cls)), at: Math.round(nowS), why: (top.reasons || []).slice(0, 2).join('; ') }, origin: o };
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
      if (JSON.stringify([R.dest && R.dest.id, R.dest && Math.round(R.dest.p * 20), R.origin && R.origin.id]) !== before) R.chg = nowMs;
    }
    stats.ms = Date.now() - t0; stats.lastRound = nowMs;
    return n;
  }
  return { predictFor, trackOf, round, stats };
}
module.exports = { createDest };
