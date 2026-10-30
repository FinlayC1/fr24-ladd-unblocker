// N6012C (A7CD97), Gulfstream G600, 16-17 Oct 2026. Hanoi -> Baku on the 16th, last heard over central Asia at cruise at 21:38Z;
// off from Baku at 00:03Z, heard again by ADS-B only at 02:19Z, over the Black Sea at FL430. The panel said "took off from
// Hanoi" (8,000 km flown, "worked out by another browser"), and could not say where it was going - every airport on the US
// East Coast at 4-5%.
// What was wrong:
//  - a hole in coverage the aircraft cannot have flown straight through (4 h 40 min for ground that took 3 h 28 min at 450 kt)
//    was not taken for a stop unless it was 45 minutes short of that at four fifths of its speed: one leg, "Hanoi -> ...";
//    found climbing from 28,000 ft below where it was lost was not taken for one either
//  - FR24's trail of the flight begins after the take-off when its first point is above 3,000 ft or far from the field: no
//    "took off here" to cut the track at - and with the flight id kept through the stop, the Hanoi flight was in it
//  - another browser's route took the place of this browser's own whatever its evidence, and the origin it carried was the
//    Hanoi one; what this browser worked out was sent to the monitor only where the other's had not taken its place
// Checked here: the rules (engine, 315,000 real trace points keep their legs), the logs' joins, the track of the flight in
// progress (userscript and monitor), the BUILT userscript in jsdom on the flight as it was (FR24's first point on the ground,
// climbing at 5,500 ft, at 26,400 ft, none; one flight id from Hanoi; today's trace only), and the shared routes.
// usage: node test/unit_n6012c.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const { createRouteEngine } = require('../src/engine.js');
const { createDest } = require('../monitor/dest.cjs');
const { createIdent } = require('../monitor/ident.cjs');
const DIST = process.env.DIST || path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');

const E = createRouteEngine();
E.setAirports(JSON.parse(AIRPORTS).rows); require('./dataset.cjs').withFields(E, DATA);
E.setRunways(JSON.parse(fs.readFileSync(path.join(DATA, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(DATA, 'runway_len.json'), 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'tables.json'), 'utf8'))); E.setLogit(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'logit.json'), 'utf8')));

// ---- the flight ------------------------------------------------------------------------------------------------------
const T = (d, h, m, s) => Date.UTC(2026, 9, d, h, m, s || 0) / 1000;
const iso = t => new Date(t * 1000).toISOString().slice(5, 16) + 'Z';
const T_NOW = T(17, 3, 33);
const HAN = [21.2212, 105.8072], GYD = [40.4675, 50.0467];
const LEG1 = [HAN, [22.5, 92.0], [28.5, 77.0], [35.0, 69.0], [39.865, 61.801]];                                                  // Hanoi -> central Asia
const LEG2 = [GYD, [41.12, 49.95], [41.12, 46.0], [41.8, 41.5], [43.0, 34.0], [44.2, 28.6], [45.7, 25.0], [47.3, 21.8], [49.35, 18.167]];   // Baku -> Slovakia
// points along a polyline, uniform in time from t0 to t1, climbing 55 ft/s to cruise
function along(way, t0, t1, o) {
  o = o || {}; const step = o.step || 20, n = Math.max(2, Math.round((t1 - t0) / step)), segs = []; let tot = 0;
  for (let i = 1; i < way.length; i++) { const d = E.dist(way[i - 1][0], way[i - 1][1], way[i][0], way[i][1]); segs.push({ a: way[i - 1], b: way[i], d, s0: tot }); tot += d; }
  const out = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n, s = f * tot, g = segs.find(x => s <= x.s0 + x.d) || segs[segs.length - 1], ff = Math.min(1, Math.max(0, (s - g.s0) / g.d));
    const br = E.brg(g.a[0], g.a[1], g.b[0], g.b[1]), p = E.destPoint(g.a[0], g.a[1], br, g.d * ff), el = (t1 - t0) * f;
    out.push({ t: Math.round(t0 + (t1 - t0) * f), lat: p[0], lon: p[1], alt: Math.round(Math.min(o.cruise || 43000, (o.startAlt || 0) + el * 55) / 100) * 100, gs: Math.round(o.gs || 470), trk: Math.round(br), gnd: false });
  }
  return out;
}
const traceJson = (pts, base) => ({ timestamp: base, r: 'N6012C', t: 'GA6C', desc: 'GULFSTREAM G600', dbFlags: 8, trace: pts.map(p => [Math.round((p.t - base) * 10) / 10, p.lat, p.lon, p.gnd ? 'ground' : p.alt, p.gs, p.trk, 0, null, null, 'adsb_icao']) });
const parse = pts => E.parseTrace(traceJson(pts, 0));
const T1 = T(16, 15, 32), T1end = T(16, 21, 38, 17), Tto = T(17, 0, 3), tR = T(17, 2, 19);
function flights() {
  const gndHAN = []; for (let k = 6; k >= 1; k--) gndHAN.push({ t: T1 - k * 40, lat: HAN[0], lon: HAN[1], alt: null, gs: k < 3 ? 12 : 4, trk: 190, gnd: true });
  gndHAN.push({ t: T1 - 15, lat: HAN[0] + 0.004, lon: HAN[1] + 0.004, alt: null, gs: 90, trk: 190, gnd: true });
  const leg1 = gndHAN.concat(along(LEG1, T1, T1end, { gs: 467 }).map((p, i) => i === 0 ? Object.assign(p, { alt: 200 }) : p)); leg1.forEach(p => { if (p.gs > 440 && p.alt < 40000 && !p.gnd) p.gs = 450; });
  // (the tail over central Asia heard only now and then: one point every six minutes after the first three hours)
  const leg1s = leg1.filter((p, i) => i < 600 || (i % 18 === 0) || i === leg1.length - 1);
  const fr = along(LEG2, Tto, T_NOW, { gs: 470, step: 10 }), gndGYD = [];
  for (let k = 3; k >= 1; k--) gndGYD.push({ t: Tto - k * 30, lat: GYD[0], lon: GYD[1], alt: 0, gs: k > 1 ? 2 : 60, trk: 350 });
  const all = gndGYD.concat(fr).map(p => Object.assign({}, p, { alt: p.alt != null ? p.alt : 0 }));
  // FR24's trail as the page thins it: 15 s for the first half hour and the last hour, 90 s between
  const thin = []; { const t0 = all[0].t, tN = all[all.length - 1].t; for (let k = 0; k < all.length; k++) { const st = all[k].t - t0 < 1800 || tN - all[k].t < 3600 ? 15 : 90; if (!thin.length || all[k].t - thin[thin.length - 1].t >= st || k === all.length - 1) thin.push(all[k]); } }
  const adsb17 = fr.filter(p => p.t >= tR).map(p => Object.assign({}, p, { gnd: false }));
  return { leg1s, thin, adsb17 };
}
const F = flights();
// a flight over the sea at 450 kt for 8 hours along one great circle (the speed it reports is the speed it flies)
const SEA = [[45, -10], E.destPoint(45, -10, 270, 450 * 1.852 * 8)];
const sea = (t0) => along(SEA, t0, t0 + 8 * 3600, { gs: 450, step: 30 });
// FR24's points as the page reads them: on the ground when at 0 ft and slow
const asFr24 = pts => pts.map(p => Object.assign({}, p, { alt: p.alt != null ? p.alt : 0, gnd: !!p.gnd || (!(p.alt > 0) && p.gs < 50) }));
// FR24's trail of the flight by how it begins
const frTrail = how => how === 'ground' ? F.thin : how === 'low' ? F.thin.filter(p => p.t >= Tto + 90) : how === 'high' ? F.thin.filter(p => p.t >= Tto + 480)
  : how === 'hanoiHigh' ? F.leg1s.map(p => Object.assign({}, p, { alt: p.alt != null ? p.alt : 0 })).concat(F.thin.filter(p => p.t >= Tto + 480)) : null;

(async () => {
  // =======================================================================================================================
  // 1. the rules
  // =======================================================================================================================
  const holeKm = E.dist(39.865, 61.801, F.adsb17[0].lat, F.adsb17[0].lon), holeS = tR - T1end;
  const need450 = holeKm / (450 * 1.852) * 3600;
  check('the hole: 4 h 40 min across ' + Math.round(holeKm) + ' km - ' + Math.round((holeS - need450) / 60) + ' minutes more than the ground needs at 450 kt', holeS - need450 > 4000 && holeS / need450 > 1.25, { holeS, need450: Math.round(need450), holeKm: Math.round(holeKm) });
  check('... a stop (idleHole)', E.idleHole(holeS, holeKm, 450, 480) === true);
  check('... the same ground in 3 h 30 min (what it needs, ten minutes over): flown straight through', E.idleHole(3.5 * 3600, holeKm, 450, 480) === false);
  check('... a long hole flown a fifth slower than its speeds either side (12 h across 10.2 h of ground): still one flight', E.idleHole(12 * 3600, 10.2 * 450 * 1.852, 450, 450) === false);
  check('... half an hour, no speed heard, or a standstill: not judged', !E.idleHole(1700, 5, 450, 450) && !E.idleHole(holeS, holeKm, 0, 480) && !E.idleHole(holeS, holeKm, 450, null) && !E.idleHole(holeS, holeKm, 50, 480));
  // found climbing from far below where it was lost; lost going down to far below where it is found
  const mk = (t, lat, lon, alt, gs) => ({ t, lat, lon, alt, gs, trk: 90, gnd: false });
  { const cruise = [mk(-60, 50, -0.5, 43000, 460), mk(0, 50, 0, 43000, 460)];
    const found = alt => [mk(5400, 50, 9.5, alt, 330), mk(5460, 50, 9.8, alt + 1000, 330), mk(5520, 50, 10.1, alt + 2000, 330)];
    check('lost at FL430, found climbing through 15,000 ft 680 km on, 90 minutes later: it came down (28,000 ft below where it was lost)', !!E.slowGap(cruise.concat(found(15000)), 2));
    check('... found climbing through FL410: a step climb, not a landing', E.slowGap(cruise.concat(found(41000)), 2) === null);
    check('... found level at 15,000 ft (not climbing): not by that rule', E.slowGap(cruise.concat([mk(5400, 50, 9.5, 15000, 330), mk(5460, 50, 9.8, 15000, 330), mk(5520, 50, 10.1, 15000, 330)]), 2) === null);
    const down = [mk(-60, 50, -0.5, 16000, 330), mk(0, 50, 0, 15000, 330)];
    const back = alt => [mk(5400, 50, 9.5, alt, 460), mk(5460, 50, 9.8, alt, 460), mk(5520, 50, 10.1, alt, 460)];
    check('lost going down through 15,000 ft, found at FL430 90 minutes later: it came down and climbed back', !!E.slowGap(down.concat(back(43000)), 2));
    check('... found at 19,000 ft: not by that rule', E.slowGap(down.concat(back(19000)), 2) === null); }

  // a flight cut by a hole, the stop in it or not: one straight track across the sea, the middle of it unheard
  { const track = sea(T(20, 0, 0)), cutAt = (a, b) => track.filter(p => p.t < T(20, a, 0) || p.t >= T(20, b, 0));
    const stopped = track.filter(p => p.t < T(20, 3, 0)).concat(track.filter(p => p.t >= T(20, 6, 30)).map(p => Object.assign({}, p, { t: p.t + 5400 })));   // an hour and a half on the ground in the hole
    const legsOf = pts => E.legsFromPoints(parse(pts).map(p => Object.assign({}, p)), { cls: 'heavybiz', type: 'GA6C', rangeKm: E.typeRangeKm({ type: 'GA6C' }) });
    const through = legsOf(cutAt(3, 6.5)), stop = legsOf(stopped);
    check('a Gulf stream over the sea, 3 h 30 min unheard in the middle of its track: one flight', through.length === 1 && through[0].how === 'open', through.map(l => l.how));
    check('... the same track with an hour and a half more in the hole: two - the first ends in a hole it came down in, the second begins after it', stop.length === 2 && stop[0].how === 'gap-land' && !!stop[1].gapPrev && stop[1].gapPrev.t === stop[0].end.t, stop.map(l => l.how)); }

  // N6012C's own two flights, as adsb.lol had them: one trace, the stop in the hole
  const both = parse(F.leg1s.concat(F.adsb17));
  const legsBoth = E.legsFromPoints(both.map(p => Object.assign({}, p)), { cls: 'heavybiz', type: 'GA6C', rangeKm: E.typeRangeKm({ type: 'GA6C' }) });
  check('N6012C\'s trace: two flights - Hanoi\'s ends in the hole (21:38Z) and the next begins after it (02:19Z)', legsBoth.length === 2 && legsBoth[0].how === 'gap-land' && Math.abs(legsBoth[0].end.t - T1end) < 20 && Math.abs(legsBoth[1].start.t - tR) < 20 && !!legsBoth[1].gapPrev, legsBoth.map(l => [l.how, iso(l.start.t), iso(l.end.t)]));
  const gctx = { cls: 'heavybiz', type: 'GA6C', grp: E.groupOf('heavybiz') };
  const sums = legsBoth.map(l => E.summarizeLeg(l, gctx));
  check('... its log has two flights, "Hanoi -> ?" and one begun in the hole - not one of 8,000 km', E.stitchLegs(sums).length === 2 && E.chainLegs(E.stitchLegs(sums)).length === 2);

  // the log's join of a day's open end and the next day's beginning
  { const day16 = E.legsFromPoints(parse(F.leg1s).map(p => Object.assign({}, p)), { cls: 'heavybiz', type: 'GA6C', dataEnd: T(17, 0, 0) });
    const day17 = E.legsFromPoints(parse(F.adsb17).map(p => Object.assign({}, p)), { cls: 'heavybiz', type: 'GA6C', dataEnd: T(18, 0, 0) });
    const s16 = day16.map(l => E.summarizeLeg(l, gctx)), s17 = day17.map(l => E.summarizeLeg(l, gctx));
    check('the days as the log keeps them: the 16th\'s last flight open at the end, the 17th\'s begun in the air', s16.length === 1 && !s16[0].ended && s17.length === 1 && !s17[0].startedOnGround, { s16: s16.map(s => s.how), s17: s17.map(s => s.startedOnGround) });
    check('... joined across the hole they are not (it was a stop: 4 h 40 min for ground that took 3 h 28 min)', E.stitchLegs(s16.concat(s17)).length === 2);
    // (a flight crossing midnight with a coverage hole in the middle of its track: joined, as before)
    const cont = sea(T(19, 21, 0)).filter(p => p.t < T(19, 23, 0) || p.t >= T(20, 1, 30));
    const c1 = E.legsFromPoints(parse(cont.filter(p => p.t < T(20, 0, 0))).map(p => Object.assign({}, p)), { cls: 'heavybiz', type: 'GA6C', dataEnd: T(20, 0, 0) }), c2 = E.legsFromPoints(parse(cont.filter(p => p.t >= T(20, 0, 0))).map(p => Object.assign({}, p)), { cls: 'heavybiz', type: 'GA6C', dataEnd: T(21, 0, 0) });
    const cs = c1.map(l => E.summarizeLeg(l, gctx)).concat(c2.map(l => E.summarizeLeg(l, gctx)));
    check('... and one flight with a hole across midnight, 2 h 30 min of ground it covered: one flight still', cs.length === 2 && E.stitchLegs(cs).length === 1, cs.map(s => [s.how, iso(s.tStart), iso(s.tEnd)])); }

  // the track of the flight in progress, cut back to where it began
  { const han = asFr24(F.leg1s);
    const baku = t => asFr24(F.thin.filter(p => p.t >= t));
    const h = 'N6012C';
    const c1 = E.currentLeg(han.concat(baku(Tto + 480)).map(p => Object.assign({}, p)), {});
    check(h + ': FR24\'s trail from Hanoi, the Baku part first heard at 26,400 ft climbing: cut at the hole (4 h less 8 min), whatever Hanoi came before', c1.cut && c1.pts[0].t === Tto + 480 && !!c1.gapFrom && Math.abs(c1.gapFrom.t - T1end) < 20 && c1.gapInfo.bClimb === true && c1.gapInfo.aDesc === false, { cut: c1.cut, first: c1.pts[0] && iso(c1.pts[0].t), from: c1.gapFrom && iso(c1.gapFrom.t), info: c1.gapInfo });
    const c2 = E.currentLeg(han.concat(baku(Tto - 100)).map(p => Object.assign({}, p)), {});
    check('... its first point on the ground at Baku: cut there, at the take-off', c2.cut && c2.pts[0].gnd && c2.pts[0].t >= Tto - 100 && !c2.gapFrom, { first: c2.pts[0] && [iso(c2.pts[0].t), c2.pts[0].gnd], from: c2.gapFrom });
    const flat = sea(T(20, 0, 0)).filter(p => p.t < T(20, 3, 0) || p.t >= T(20, 6, 30));
    const c3 = E.currentLeg(flat.map(p => Object.assign({}, p)), {});
    check('... a flight over the sea with 3 h 30 min unheard: not cut', !c3.cut && c3.pts.length === flat.length);
    const c4 = E.currentLeg(han.concat(baku(Tto + 480)).map(p => Object.assign({}, p)), { patrol: true });
    check('... a patrol aircraft or a fighter loiters out of sight: none of the hole rules (cut where it was on the ground at Hanoi, not before)', !c4.cut || c4.pts[0].t !== Tto + 480); }

  // 315,000 real trace points: the holes at cruise that were flown through stay flown through
  { const files = [], root = path.join(__dirname, 'fixtures', 'legs'), lroot = path.join(__dirname, 'fixtures', 'live0930');
    for (const hex of fs.existsSync(root) ? fs.readdirSync(root) : []) for (const f of fs.readdirSync(path.join(root, hex))) if (f.endsWith('.json.gz')) files.push({ hex, p: path.join(root, hex, f), gz: true });
    for (const hex of fs.existsSync(lroot) ? fs.readdirSync(lroot) : []) { const d = path.join(lroot, hex); if (fs.statSync(d).isDirectory()) for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) files.push({ hex, p: path.join(d, f), gz: false }); }
    let npts = 0, joined = 0, split = 0, worst = -1e9, ratio = 0, bad = [];
    for (const f of files) {
      let j; try { let buf = fs.readFileSync(f.p); if (f.gz) buf = zlib.gunzipSync(buf); j = JSON.parse(buf.toString('utf8')); } catch (e) { continue; }
      const pts = E.parseTrace(j); if (pts.length < 3) continue; npts += pts.length;
      const ac = { hex: f.hex, type: (j && j.t) || '' }, cls = E.classify(ac);
      const legs = E.legsFromPoints(pts.map(p => Object.assign({}, p)), { cls, type: ac.type, heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy', rangeKm: E.typeRangeKm(ac) });
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], gap = b.t - a.t; if (gap < 1800 || a.gnd0 || b.gnd0 || !(a.alt >= 15000) || !(b.alt >= 15000)) continue;
        if (legs.some(l => Math.abs(l.end.t - a.t) < 2 && l.ended)) { split++; continue; }
        joined++;
        const g = Math.min(a.gs || 0, b.gs || 0); if (!(g > 75)) continue;
        const need = E.dist(a.lat, a.lon, b.lat, b.lon) / (g * 1.852) * 3600;
        worst = Math.max(worst, gap - need); ratio = Math.max(ratio, gap / need);
        if (E.idleHole(gap, E.dist(a.lat, a.lon, b.lat, b.lon), a.gs, b.gs)) bad.push(f.hex + ' ' + iso(a.t));
      }
    }
    check('real traces (' + files.length + ' day files, ' + npts + ' points): no hole at cruise that the engine kept as one flight is a stop by the new rule', joined >= 10 && split >= 3 && !bad.length, { npts, joined, split, bad });
    check('... and the margin: the most any of those holes took over what the ground needs at the slower of its two speeds is under 15 minutes (the rule asks 45), its ratio under 1.25', worst < 15 * 60 && ratio < 1.25, { worstMin: Math.round(worst / 60), ratio: +ratio.toFixed(2) }); }

  // =======================================================================================================================
  // 2. the monitor: a rough destination from the track it recorded and FR24's trail
  // =======================================================================================================================
  { const hex = 'a7cd97', nowS = T_NOW;
    const rowsOf = pts => traceJson(pts, 0).trace;
    const dest = (rows, trail, pts, EE) => { const ac = new Map([[hex, { meta: { type: 'GA6C', reg: 'N6012C' }, rows }]]); const D = createDest({ E: EE || E, ac, legs: new Map() });
      const last = F.adsb17[F.adsb17.length - 1], Fl = { gnd: false, ts: nowS, seen: nowS * 1000, lat: last.lat, lon: last.lon, alt: 43000, trk: 304, spd: 498, trail: trail || [], pts: pts || [] };
      return { D, F: Fl, R: { hex, type: 'GA6C', reg: 'N6012C', cs: '', flags: 1 } }; };
    const frp = a => a.map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs, trk: p.trk }));   // (FR24's trail as the monitor keeps it: no flag, 0 ft on the ground)
    const id = o => o && o.origin ? E.byId(o.origin.id).code : null;
    { const m = dest(rowsOf(F.leg1s.concat(F.adsb17)), frp(F.thin.filter(p => p.t >= Tto + 480))), r = m.D.predictFor(m.R, m.F, nowS);
      check('monitor: it recorded both flights\' ADS-B (the hole between), FR24\'s trail begins at 26,400 ft out of Baku: off from Baku', id(r) === 'GYD', r && r.origin); }
    { const m = dest([], frp(asFr24(F.leg1s).concat(asFr24(F.thin.filter(p => p.t >= Tto + 480)))), frp(F.adsb17)), r = m.D.predictFor(m.R, m.F, nowS);
      check('... nothing recorded, FR24 holding the Hanoi flight and the Baku one under one id: off from Baku, not Hanoi', id(r) === 'GYD', r && r.origin); }
    { const m = dest([], frp(asFr24(F.thin)), frp(F.adsb17)), r = m.D.predictFor(m.R, m.F, nowS);
      check('... FR24\'s trail from the take-off on the ground at Baku: off from Baku', id(r) === 'GYD', r && r.origin); }
    { const m = dest(rowsOf(F.leg1s.concat(F.adsb17)), null, null), r = m.D.predictFor(m.R, m.F, nowS);
      check('... no FR24 trail at all: not Hanoi (a field in the hole, or none)', !!r && id(r) !== 'HAN', r && r.origin); }
    // (the departure the monitor kept for the flight id while it flew from Hanoi, when the next round finds the flight begun after a hole)
    { const han = E.byIcao('VVNB'), gyd = E.byIcao('UBBB'), E2 = Object.create(E); E2.landingInGap = () => null;
      const round = (EE, kept, crowd) => { const m = dest(rowsOf(F.leg1s.concat(F.adsb17)), null, null, EE), R = Object.assign(m.R, { origin: kept, dest: null, crowd: crowd || null });
        const n = m.D.round({ ids: new Map([[ID0, R]]), flights: new Map([[ID0, m.F]]) }, nowS * 1000); return { n, R }; };
      const ID0 = 0x422846be;
      let g = round(E, { id: han.id, conf: 'ground', t: T1 });
      check('monitor round: Hanoi (15:32Z) kept for the id, the track now begins after the hole (last heard 21:38Z): replaced by the field that fits the hole', g.n === 1 && !!g.R.origin && g.R.origin.id !== han.id, g.R.origin);
      g = round(E2, { id: han.id, conf: 'ground', t: T1 });
      check('... and where no field fits it: dropped, not kept', g.n === 1 && g.R.origin === null, g.R.origin);
      g = round(E2, { id: gyd.id, conf: 'ground', t: Tto });
      check('... Baku (00:03Z, seen on the ground, in the hole) is not dropped', g.n === 1 && !!g.R.origin && g.R.origin.id === gyd.id, g.R.origin);
      // (and the row the browsers are served: a browser's Hanoi is the origin of that row for as long as the flight is named)
      const ber = E.byIcao('EDDB'), cw = (o, atd, d) => ({ o, oc: o ? 'ground' : '', atd: o ? atd : 0, ot: nowS - 60, oOwn: 0, d: d || 0, p: d ? 60 : 0, dc: d ? 'likely' : '', eta: d ? nowS + 7200 : 0, dt: nowS - 60, dOwn: 0, km: -1, kmAt: 0, at: nowS - 60 });
      g = round(E, null, cw(han.id, T1, ber.id));
      check('monitor round: a browser\'s Hanoi (15:32Z) in the route it hands out, the flight begun after the hole: gone from it, the destination it came with stays', g.R.crowd && g.R.crowd.o === 0 && g.R.crowd.atd === 0 && g.R.crowd.d === ber.id && g.R.chg > 0, g.R.crowd);
      g = round(E, null, cw(han.id, T1, 0));
      check('... a route that was only its Hanoi: nothing left of it', g.R.crowd === null, g.R.crowd);
      g = round(E, null, cw(gyd.id, Tto, ber.id));
      check('... a browser\'s Baku (00:03Z, in the hole): kept', g.R.crowd && g.R.crowd.o === gyd.id && g.R.crowd.atd === Tto, g.R.crowd);
      g = round(E, null, cw(han.id, 0, ber.id));
      check('... a Hanoi with no departure time: not judged, kept', g.R.crowd && g.R.crowd.o === han.id, g.R.crowd); } }

  // =======================================================================================================================
  // 3. the monitor's shared route: a wrong departure replaced by the owner's, a confident wrong destination within 20 minutes
  // =======================================================================================================================
  { const I = createIdent({ E, live: new Map(), ac: new Map(), blocked: new Map(), legs: new Map() });
    const ID = 0x422846be, HEX = 'a7cd97', MS = T_NOW * 1000, han = E.byIcao('VVNB'), gyd = E.byIcao('UBBB'), ber = E.byIcao('EDDB'), teb = E.byIcao('KTEB');
    I.observe([{ id: ID, lat: 49.35, lon: 18.167, alt: 43000, trk: 304, spd: 498, ts: T_NOW, gnd: false, src: 0, type: 'GA6C', reg: '', cs: '', icon: 0 }], MS, 'scan');
    I.assign(I.flights.get(ID), HEX, { reg: 'N6012C', type: 'GA6C', ladd: true }, 'list', MS);
    const R = I.ids.get(ID);
    const took = I.crowdRoute(ID, HEX, { o: han.id, oc: 'ground', atd: T1, d: ber.id, p: 60, dc: 'likely', eta: T_NOW + 7200 }, '198.51.100.2', MS);
    check('the monitor: another browser\'s wrong answer (Hanoi 15:32Z, Berlin 60%) kept', took && R.crowd.o === han.id && R.crowd.d === ber.id);
    I.crowdRoute(ID, HEX, { o: gyd.id, oc: 'ground', atd: Tto, d: teb.id, p: 5, dc: 'possible', eta: T_NOW + 20000 }, '', MS + 60000);
    check('... the owner\'s browser\'s own: its departure (Baku) takes the place of Hanoi at once', R.crowd.o === gyd.id && R.crowd.oOwn === 1 && R.crowd.atd === Tto, R.crowd);
    check('... its flat 5% does not take a 60% one\'s place inside 20 minutes (a less sure answer over another airport)', R.crowd.d === ber.id);
    I.crowdRoute(ID, HEX, { o: gyd.id, oc: 'ground', atd: Tto, d: teb.id, p: 5, dc: 'possible', eta: T_NOW + 20000 }, '', MS + 1400 * 1000);
    check('... and after 20 minutes it does', R.crowd.d === teb.id && R.crowd.dOwn === 1, R.crowd); }

  // =======================================================================================================================
  // 4. the BUILT userscript in jsdom on the flight as it was
  // =======================================================================================================================
  const SRC = fs.readFileSync(DIST, 'utf8');
  function makeWin(traces) {
    const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/49.35,18.17/7', runScripts: 'dangerously', pretendToBeVisual: true }).window;
    const REAL = win.Date, OFF = T_NOW * 1000 - REAL.now();
    win.Date = class extends REAL { constructor(...a) { if (a.length) super(...a); else super(REAL.now() + OFF); } static now() { return REAL.now() + OFF; } };
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
    win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    const hex = 'a7cd97';
    const answer = url => {
      if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
      const m = /adsb\.lol\/globe_history\/(\d{4})\/(\d\d)\/(\d\d)\/traces\/\w\w\/trace_full_(\w+)\.json/.exec(url);
      if (m && m[4] === hex) { const j = traces.days[m[1] + '-' + m[2] + '-' + m[3]]; return j ? [200, JSON.stringify(j)] : [404, '']; }
      if (/adsb\.lol\/data\/traces\/\w\w\/trace_full_(\w+)\.json/.test(url) && url.includes(hex)) return traces.live ? [200, JSON.stringify(traces.live)] : [404, ''];
      return [404, ''];
    };
    win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
    win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
    win.unsafeWindow = win; win.GM_notification = () => {};
    win.console.debug = () => {}; win.console.log = () => {};
    win.eval(SRC);
    return win;
  }
  const HEX = 'a7cd97', ID = 0x422846be;
  // how: FR24's trail by how it begins; live: adsb.lol's live trace holds the last 24 hours ('24h'), the new day only ('today'),
  // none; hist: the 16th's file (the flight to the hole) in the log
  async function open(o) {
    const traces = { days: o.hist === false ? {} : { '2026-10-16': traceJson(F.leg1s, T(16, 0, 0)) }, live: o.live === '24h' ? traceJson(F.leg1s.concat(F.adsb17), T(16, 3, 33)) : o.live === 'today' ? traceJson(F.adsb17, T(17, 0, 0)) : null };
    const w = makeWin(traces), L = w.__tweeksLadd;
    await until(() => L && L.engine.airports.length > 5000, 60000);
    L.store.mergeHex(HEX, { type: 'GA6C', reg: 'N6012C', ladd: true });
    L.pubRecs.set(ID, { id: ID, hex: HEX, reg: 'N6012C', type: 'GA6C', cs: '', public: true, ladd: true });
    const tr = frTrail(o.fr);
    if (tr) w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { __tweeksLadd: 'trail', id: ID, first: tr[0], n: tr.length, maxAlt: 43000, pts: tr } }));
    // (1.1.0: the route code the monitor runs, with the tables as the monitor has them - here on what this browser has)
    await require('./monfake.cjs').tablesInto(L.engine);
    if (o.hist !== false) await L.loadHistory(HEX, 3, null, { front: true }).catch(() => {});
    await L.loadToday(HEX, 0, { priority: true }).catch(() => {});
    await sleep(50);
    const pos = { t: T_NOW, lat: 49.35, lon: 18.167, alt: 43000, trk: 304, gs: 498, gnd: false, vr: 0 };
    return { w, L, pos, route: () => L.composeRoute0(ID, HEX, { pos }), trail: () => L.trailFor(ID, HEX, pos) };
  }
  // another browser's route for it, in the monitor's row: [id, hex, reg, type, cs, flags, how, named at, origin, its word, destination, chance, at, lat, lon, alt, ground, FR24 time, ETA, departed, owner, operator, operator id, ICAO, whose, word, origin's]
  const crowdRow = (L, o) => { const ap = c => L.engine.byIcao(c).id; return [ID, HEX, 'N6012C', 'GA6C', '', 1, 'list', T_NOW - 3600, ap('VVNB'), 'ground', ap(o.dest || 'EDDB'), o.p || 60, T_NOW - 60, 49.35, 18.167, 43000, 0, T_NOW, T_NOW + 7200, T1, '', '', 0, '', o.by || 1, 'likely', 1]; };
  const show = r => r && { o: r.originIata, note: (r.originNote || '').slice(0, 50), conf: r.originConf, d: r.destIata, p: r.destP, why: (r.destReason || '').slice(0, 40) };

  const okFirst = async (name, o, want) => {
    const s = await open(o), r = s.route(), t = s.trail();
    check(name + ': it took off from ' + want + (o.fr ? '' : ', the hole between'), !!r && r.originIata === want, show(r));
    check('... the track begins after the stop (' + iso(t[0].t) + '), cut at it', t.cut === true && t[0].t >= Tto - 100, { first: iso(t[0].t), cut: t.cut, from: t.gapFrom && iso(t.gapFrom.t) });
    check('... flown from Baku, not 8,000 km from Hanoi', !!r && !!r.progress && r.progress.traversed < 4e6, r && r.progress && r.progress.traversed);
    return s;
  };
  { const s = await okFirst('FR24\'s first point of the flight on the ground at Baku', { fr: 'ground', live: '24h' }, 'GYD');
    const r = s.route();
    check('... "took off from GYD", seen on the ground', r.originConf === 'ground' && /took off from GYD/.test(r.originNote), show(r));
    check('... the log: two flights, not one from Hanoi (the 16th ends open at 21:38Z, the 17th begins in the air)', s.L.knownLegs(HEX).length === 2 && s.L.knownLegs(HEX)[0].tEnd < T(16, 22, 0) && s.L.knownLegs(HEX)[1].tStart >= tR - 30, s.L.knownLegs(HEX).map(l => [iso(l.tStart), iso(l.tEnd), l.from && l.from.code, l.to && l.to.code]));
    // (the shared answer: Hanoi 15:32Z, Berlin 60% - from another browser, sure and wrong)
    s.L.srvIds.rows.set(ID, crowdRow(s.L, {}));
    const c = s.route();
    check('another browser\'s Berlin at 60% over this browser\'s own 5%: its own stands - it has the aircraft\'s log and saw the take-off (it did not before)', c.destIata === r.destIata && c.destP === r.destP && c.destReason !== 'worked out by another browser' && !c.crowdD && c.originIata === 'GYD' && !c.crowdO, show(c));
    check('... and sends none of it to the monitor (1.1.0: the monitor works the flight out itself, from what this browser sends of it)', (() => { s.L.live.set(ID, { id: ID, hex: HEX, reg: 'N6012C', type: 'GA6C', ladd: true }); s.L.routesOut.delete(ID); s.L.noteRouteOut(ID, c); const row = s.L.routesOut.get(ID); s.L.live.delete(ID); return !row; })());
    s.L.srvIds.rows.set(ID, crowdRow(s.L, { dest: 'EDDB', p: 100, by: 2 }));
    const k = s.route();
    check('a destination confirmed in another browser still stands over its own guess', k.destIata === 'BER' && k.destConf === 'confirmed' && k.destReason === 'confirmed in another browser' && k.crowdD, show(k));
    s.w.close(); }
  { const s = await okFirst('FR24\'s first point climbing through 5,500 ft, 23 km out', { fr: 'low', live: '24h' }, 'GYD'); s.w.close(); }
  { const s = await okFirst('FR24\'s first point at 26,400 ft, 63 km out (nothing of the take-off)', { fr: 'high', live: '24h' }, 'GYD'); s.w.close(); }
  { const s = await okFirst('FR24\'s trail from Hanoi under one flight id, the Baku part first heard at 26,400 ft', { fr: 'hanoiHigh', live: '24h' }, 'GYD'); s.w.close(); }
  { const s = await okFirst('... the same, adsb.lol\'s live trace only the new day', { fr: 'hanoiHigh', live: 'today' }, 'GYD');
    check('... the log: the 16th\'s flight and the new one, not joined', s.L.knownLegs(HEX).length === 2, s.L.knownLegs(HEX).map(l => [iso(l.tStart), iso(l.tEnd)])); s.w.close(); }
  { const s = await open({ fr: 'none', live: '24h' }), r = s.route(), t = s.trail();
    check('no FR24 trail, adsb.lol the whole 24 hours: not Hanoi - a field in the hole, said to be out of coverage', !!r && r.originIata !== 'HAN' && /out of ADS-B coverage/.test(r.originNote) && r.originConf === 'low' && t.cut && !!t.gapFrom, show(r));
    s.w.close(); }
  { const s = await open({ fr: 'none', live: 'today' }), r = s.route();
    check('no FR24 trail, today\'s trace only: not Hanoi - first seen at FL430, no departure named', !!r && !r.originIata && /first seen at FL430/.test(r.originNote) && !r.originId, show(r));
    // (another browser's Hanoi, hours old, left by a flight whose leg in this log ended hours before this track began)
    s.L.srvIds.rows.set(ID, crowdRow(s.L, {}));
    const c = s.route();
    check('... another browser\'s Hanoi (15:32Z, a flight this log ended at 21:38Z) not taken as the departure of this one', !c.crowdO && !c.originIata, show(c));
    // (and the Hanoi take-off a 22.30.1 browser kept for the flight id: its log's flight of the 16th began then)
    const rec = s.L.pubRecs.get(ID), ap = code => s.L.engine.byIcao(code).id;
    rec.origin = { id: ap('VVNB'), conf: 'ground', note: 'took off from HAN', departedAt: T1 };
    const k = s.route();
    check('... nor the Hanoi take-off kept for the flight id from before (15:32Z, seen on the ground): dropped from the record, not shown', !k.originIata && /first seen at FL430/.test(k.originNote) && !rec.origin, show(k));
    rec.origin = { id: ap('UBBB'), conf: 'ground', note: 'took off from GYD', departedAt: Tto };
    const b = s.route();
    check('... Baku (00:03Z, after that flight ended) kept: it is this flight\'s', b.originIata === 'GYD' && b.originConf === 'ground' && !!rec.origin && rec.origin.id === ap('UBBB'), show(b));
    s.w.close(); }
  { const s = await open({ fr: 'none', live: 'today', hist: false }), r0 = s.route();
    s.L.srvIds.rows.set(ID, crowdRow(s.L, {}));
    const c = s.route();
    check('a browser with no log of the aircraft and no departure seen: another browser\'s answer fills the panel as before (its route and the departure it came with)', !!c && c.destIata === 'BER' && c.destReason === 'worked out by another browser' && c.crowdD && c.originIata === 'HAN' && c.crowdO, { own: show(r0), got: show(c) });
    s.w.close(); }

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  harness crashed', e && e.stack || e); process.exit(1); });
