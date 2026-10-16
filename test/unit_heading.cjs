// (22.30) Where it is going has to fit the way it is flying: an airport far off to one side of the track or behind it,
// the aircraft flying steadily on and getting no nearer, is not its destination - whatever its log says (engine
// trackState / offTrack). The rule's numbers from every real moment in the fixtures; the two flights it was made for,
// rebuilt (no network here); the cases it must leave alone; and the replay of 220 days of three jets with and without it.
// usage: node test/unit_heading.cjs <dataDir>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createRouteEngine } = require('../src/engine.js');
const dataDir = process.argv[2], root = path.join(__dirname, '..');
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(path.join(root, 'src', 'tables.json'), 'utf8')));
E.setLogit(JSON.parse(fs.readFileSync(path.join(root, 'src', 'logit.json'), 'utf8')));
{
  const src = fs.readFileSync(path.join(root, 'src', 'main', '03-data.js'), 'utf8'), m = src.match(/\/\* ==UNPACKT2== \*\/([\s\S]*?)\/\* ==\/UNPACKT2== \*\//);
  const unpackT2 = new Function(m[1] + '; return unpackT2;')();
  if (fs.existsSync(path.join(root, 'src', 'tables2.json'))) E.setTables2(unpackT2(JSON.parse(fs.readFileSync(path.join(root, 'src', 'tables2.json'), 'utf8'))));
}
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const A = c => E.byIcao(c);
const W0 = E.W.offTrk;
// a track through waypoints [minute, lat, lon, alt], a point every 20 s, with its track, speed and climb
function track(wp, t0) {
  const out = [], end = wp[wp.length - 1][0];
  for (let s = 0; s <= end * 60; s += 20) {
    const m = s / 60; let i = 0; while (i < wp.length - 2 && wp[i + 1][0] < m) i++;
    const a = wp[i], b = wp[i + 1], f = (m - a[0]) / (b[0] - a[0]);
    out.push({ t: t0 + s, lat: a[1] + (b[1] - a[1]) * f, lon: a[2] + (b[2] - a[2]) * f, alt: Math.round(a[3] + (b[3] - a[3]) * f), gnd: s === 0 });
  }
  for (let i = 1; i < out.length; i++) { const p = out[i], q = out[i - 1]; p.trk = E.brg(q.lat, q.lon, p.lat, p.lon); p.gs = E.dist(q.lat, q.lon, p.lat, p.lon) / 1.852 / 20 * 3600; p.vr = (p.alt - q.alt) * 3; }
  out[0].trk = out[1].trk; out[0].gs = 0;
  return out;
}
const leg = (f, t, ts, dur) => ({ from: { id: A(f).id, code: A(f).iata, conf: 'ground' }, to: { id: A(t).id, code: A(t).iata, conf: 'ground' }, tStart: ts, tOff: ts, tEnd: ts + dur, maxAlt: 25000 });
const rankOf = (inp, codes) => { const r = E.predict(Object.assign({}, inp, { explain: true, explainIds: codes.map(c => A(c).id) })); const o = {}; for (const x of r.explained || []) o[x.airport.iata] = x.rank; for (const c of codes) if (o[A(c).iata] == null) o[A(c).iata] = 9999; return { r, rank: o }; };
const pOf = (r, code) => { const c = r.cands.find(x => x.airport.iata === code); return c ? Math.round(c.p * 1000) / 10 : 0; };

// ---- the rule's numbers, from the real flights in the fixtures --------------------------------------------------------
{
  const sets = [];
  const FX = path.join(__dirname, 'fixtures', 'live0930'), LG = path.join(__dirname, 'fixtures', 'legs');
  for (const hex of fs.readdirSync(FX).filter(f => /^[0-9a-f]{6}$/.test(f))) { const pts = []; let meta = null; for (const f of fs.readdirSync(path.join(FX, hex)).filter(f => /\.json$/.test(f)).map(f => path.join(FX, hex, f)).concat([path.join(FX, hex + '.today.json')])) { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!meta || !meta.t) meta = j; for (const p of E.parseTrace(j)) pts.push(p); } catch (e) { /* none */ } } sets.push({ hex, meta, pts, long: true }); }
  for (const hex of fs.readdirSync(LG)) { const pts = []; let meta = null; for (const f of fs.readdirSync(path.join(LG, hex)).filter(f => /_lol\.json\.gz$/.test(f))) { try { const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(LG, hex, f))).toString('utf8')); if (!meta || !meta.t) meta = j; for (const p of E.parseTrace(j)) pts.push(p); } catch (e) { /* none */ } } if (pts.length) sets.push({ hex, meta: meta || {}, pts }); }
  const n = { far: 0, farOff: 0, farRule: 0, near: 0, nearOff: 0, climb: 0, climbOff: 0 };
  for (const s of sets) {
    s.pts.sort((a, b) => a.t - b.t); s.u = s.pts.filter((p, i) => !i || p.t > s.pts[i - 1].t);
    const ac = { hex: s.hex, type: s.meta.t || '' }, cls = E.classify(ac); s.ac = ac; s.cls = cls;
    s.legs = E.legsFromPoints(s.u, { heli: cls === 'heli', cls, type: ac.type, rangeKm: E.typeRangeKm(ac) });
    if (E.groupOf(cls) !== 'jet') continue;
    for (const lg of s.legs) {
      const S = E.summarizeLeg(lg, { cls, type: ac.type, grp: 'jet' }); if (!S.to || !S.ended || S.to.conf === 'near') continue;
      const D = E.byId(S.to.id), O = S.from ? E.byId(S.from.id) : null; if (!D) continue;
      const all = [lg.start].concat(lg.pts).filter(p => !p.gnd && Number.isFinite(p.lat)), tOff = S.tOff || S.tStart;
      let lastT = 0;
      for (let i = 0; i < all.length; i++) {
        const p = all[i]; if (p.t - lastT < 60) continue; lastT = p.t;
        let q = null; for (let j = i - 1; j >= 0; j--) if (p.t - all[j].t >= 240) { q = all[j]; break; } if (!q || p.t - q.t > 400) continue;
        if (E.dist(q.lat, q.lon, p.lat, p.lon) < 5) continue;
        const trk = E.brg(q.lat, q.lon, p.lat, p.lon), d = E.dist(p.lat, p.lon, D.lat, D.lon), off = E.angDiff(trk, E.brg(p.lat, p.lon, D.lat, D.lon));
        const nearO = O && E.dist(p.lat, p.lon, O.lat, O.lon) < 60, climb = (p.alt - q.alt) / (p.t - q.t) * 60 > 300 && p.alt < 20000;
        if (nearO || climb) { if (d > 150) { n.climb++; if (off > 90) n.climbOff++; } continue; }
        if (d >= 150) { n.far++; if (off > 90) n.farOff++; const pos = Object.assign({}, p, { trk }); if (E.offTrack(pos, all.slice(0, i), D, { origin: O, elapsedMin: (p.t - tOff) / 60 }) >= 0.5) n.farRule++; }
        else if (d < 80) { n.near++; if (off > 90) n.nearOff++; }
      }
    }
  }
  const pc = (a, b) => Math.round(1000 * a / Math.max(1, b)) / 10;
  check(`real jets 150 km+ from where they landed, clear of the climb-out: that field 90+ degrees off the track 0.1% of the time (${n.farOff} of ${n.far})`, n.far > 5000 && pc(n.farOff, n.far) <= 0.2, n);
  check('... and the rule sure it was not going there at none of those moments but a turn back (under 0.1%)', pc(n.farRule, n.far) < 0.1, { farRule: n.farRule });
  check('within 80 km - downwind, base, vectors, holds - it is a fifth of the time: the rule says nothing there', n.near > 1000 && pc(n.nearOff, n.near) > 10, { pct: pc(n.nearOff, n.near) });
  check('climbing out (within 60 km of the field it left, or below 20,000 ft still climbing): 4-28% - nothing there either', n.climb > 100 && pc(n.climbOff, n.climb) > 3, { pct: pc(n.climbOff, n.climb) });

  // ---- the replay: every leg of three jets over 220 days, every 12 minutes in the air, with and without the rule -------
  const run = () => {
    let k = 0, top1 = 0, ll = 0;
    for (const s of sets.filter(x => x.long)) {
      const sums = s.legs.map(l => E.summarizeLeg(l, { cls: s.cls, type: s.ac.type, grp: E.groupOf(s.cls) }));
      for (let li = 0; li < s.legs.length; li++) {
        const S = sums[li]; if (!S.to || !S.from || S.to.conf === 'near' || !S.ended) continue;
        const hs = E.histStats(E.chainLegs(E.stitchLegs(sums.slice(Math.max(0, li - 400), li).map(x => Object.assign({}, x)))), S.tStart);
        const thin = []; for (const p of [s.legs[li].start].concat(s.legs[li].pts)) if (p.t >= S.tStart && (!thin.length || p.t - thin[thin.length - 1].t >= 20)) thin.push(p);
        for (let t = (S.tOff || S.tStart) + 240; t < (S.tOn || S.tEnd) - 60; t += 720) {
          let idx = -1; for (let i = 0; i < thin.length; i++) if (thin[i].t <= t) idx = i; else break;
          if (idx < 3 || thin[idx].gnd || t - thin[idx].t > 120) continue;
          const r = E.predict({ ac: s.ac, pos: thin[idx], trail: thin.slice(0, idx + 1), hs, now: thin[idx].t }); if (!r || !r.cands.length) continue;
          const c = r.cands.find(x => x.airport.id === S.to.id); k++; if (r.cands[0].airport.id === S.to.id) top1++; ll -= Math.log(c ? Math.max(c.p, 1e-4) : 1e-4);
        }
      }
    }
    return { k, top1: Math.round(1000 * top1 / k) / 10, ll: Math.round(1e4 * ll / k) / 1e4 };
  };
  E.setWeights({ offTrk: 0 }); const before = run(); E.setWeights({ offTrk: W0 }); const after = run();
  check(`the replay (${after.k} moments of 3 jets over 220 days): right as often or more, the true airport's odds no worse`, after.k === before.k && after.top1 >= before.top1 && after.ll <= before.ll, { before, after });
}

// ---- SE-RLZ (GFM7Z, Hawker 900XP, 16 Oct): out of Bromma 13:33Z, at FL410 over the Baltic on 157 for Poland -------------
// "Angelholm 35%" - 250 km behind its right wing - on its log alone; Warsaw 16%, Bucharest 11%, Vienna 6%
const T1 = Date.parse('2026-10-16T13:33:00Z') / 1000, BMA = A('ESSB');
const se = track([[0, BMA.lat, BMA.lon, 0], [1, 59.33, 17.99, 1500], [4, 59.20, 18.05, 9000], [10, 58.75, 17.85, 24000], [18, 57.95, 17.45, 37000], [22, 57.55, 17.25, 41000], [28, 56.80, 16.95, 41000], [31, 56.40, 16.70, 41000], [36, 55.75, 17.06, 41000]], T1);
const sePos = se[se.length - 1], seAc = { hex: '4ac99a', type: 'H25B', reg: 'SE-RLZ', country: 'Sweden' };
// (its log: kept at Angelholm, in and out of Bromma every other day, now and then Warsaw or Vienna; back from Angelholm yesterday)
const seLog = (() => { const L = []; let t = T1 - 132 * 86400; for (let i = 0; i < 60; i++) { const d = i % 7 === 3 ? 'EPWA' : i % 11 === 5 ? 'LOWW' : 'ESSB'; L.push(leg('ESTA', d, t + 8 * 3600, 3000), leg(d, 'ESTA', t + 12 * 3600, 3000)); t += 2.2 * 86400; } L.push(leg('ESSB', 'ESTA', T1 - 2 * 86400, 3000), leg('ESTA', 'ESSB', T1 - 86400, 3000)); return L; })();
const seHs = E.histStats(seLog, T1);
check('(rebuilt: FL410 on 157 over the Baltic, Angelholm 250 km off to the north-west)', Math.abs(E.angDiff(sePos.trk, 160)) < 8 && sePos.alt === 41000 && E.angDiff(sePos.trk, E.brg(sePos.lat, sePos.lon, A('ESTA').lat, A('ESTA').lon)) > 110, { trk: Math.round(sePos.trk) });
{
  E.setWeights({ offTrk: 0 }); const r0 = E.predict({ ac: seAc, pos: sePos, trail: se, hs: seHs, now: sePos.t }); E.setWeights({ offTrk: W0 });
  check('without the rule: Angelholm in the top three at 10%+ on its log (the bug)', r0.cands.slice(0, 3).some(c => c.airport.iata === 'AGH') && pOf(r0, 'AGH') >= 10, r0.cands.slice(0, 4).map(c => c.airport.iata + ' ' + Math.round(c.p * 100)));
  const { r, rank } = rankOf({ ac: seAc, pos: sePos, trail: se, hs: seHs, now: sePos.t }, ['ESTA', 'EPWA', 'LROP', 'LOWW']);
  check('SE-RLZ: not Angelholm (under 1%), and Warsaw, Bucharest and Vienna - the way it is flying - all above it', r.cands[0].airport.iata !== 'AGH' && pOf(r, 'AGH') < 1 && rank.WAW < rank.AGH && rank.OTP < rank.AGH && rank.VIE < rank.AGH, { top: r.cands.slice(0, 4).map(c => c.airport.iata + ' ' + Math.round(c.p * 100)), rank });
  check('... the top answer ahead of it (within 45 degrees of its track)', E.angDiff(sePos.trk, E.brg(sePos.lat, sePos.lon, r.cands[0].airport.lat, r.cands[0].airport.lon)) < 45, r.cands[0].airport.iata);
  check('... and why, in words', (r.cands.find(c => c.airport.iata === 'AGH') || { why: ['behind it, off its track'] }).why.includes('behind it, off its track'));
  // (first heard only a few minutes ago, take-off unseen: Bromma, its other home, 400 km behind it, is not where it is going either)
  const r2 = E.predict({ ac: seAc, pos: sePos, trail: se.slice(-15), hs: seHs, now: sePos.t, origin: null });
  check('... first heard minutes ago, its take-off unseen: Bromma, 400 km behind it, not offered (under 1%)', pOf(r2, 'BMA') < 1 && pOf(r2, 'AGH') < 1, r2.cands.slice(0, 4).map(c => c.airport.iata + ' ' + Math.round(c.p * 100)));
}

// ---- TC-AKB (GLF4, 15 Oct): out of Farnborough 20:08Z, past Paris, descending on 137 past Chambery for Turin ----------
const T2 = Date.parse('2026-10-15T20:08:00Z') / 1000, FAB = A('EGLF'), LBG = A('LFPB');
const tc = track([[0, FAB.lat, FAB.lon, 0], [3, 51.20, -0.60, 6000], [25, 49.30, 2.00, 41000], [70, 47.30, 4.00, 41000], [100, 46.40, 5.15, 41000], [113, 46.05, 5.55, 30000], [128, 45.55, 6.18, 24325]], T2);
const tcPos = Object.assign({}, tc[tc.length - 1], { vr: -864 }), tcAc = { hex: '4b8562', type: 'GLF4', reg: 'TC-AKB', country: 'Turkey' };
{
  const o = { origin: FAB, elapsedMin: 128 };
  check('TC-AKB: Le Bourget, 450 km behind it, ruled out by the way it is flying', E.offTrack(tcPos, tc, LBG, o) >= 0.99, E.offTrack(tcPos, tc, LBG, o));
  check('... Turin, Milan, Nice ahead of it: not', ['LIMF', 'LIML', 'LIMC', 'LFMN'].every(c => E.offTrack(tcPos, tc, A(c), o) === 0));
  // (a log that flies it to Le Bourget all the time)
  const L = []; let t = T2 - 60 * 86400; for (let i = 0; i < 30; i++) { L.push(leg('LTAC', 'LFPB', t, 4 * 3600), leg('LFPB', 'EGLF', t + 86400, 3600), leg('EGLF', 'LFPB', t + 2 * 86400, 3600), leg('LFPB', 'LTAC', t + 3 * 86400, 4 * 3600)); t += 2 * 86400; }
  const r = E.predict({ ac: tcAc, pos: tcPos, trail: tc, hs: E.histStats(L, T2), now: tcPos.t });
  check('... its own engine, a log full of Le Bourget: not Le Bourget (under 1%), an airport ahead of it', pOf(r, 'LBG') < 1 && E.angDiff(tcPos.trk, E.brg(tcPos.lat, tcPos.lon, r.cands[0].airport.lat, r.cands[0].airport.lon)) < 60, r.cands.slice(0, 4).map(c => c.airport.iata + ' ' + Math.round(c.p * 100)));
}

// ---- what it must leave alone --------------------------------------------------------------------------------------
{
  const t0 = T1, FRG = A('KFRG'), IAD = A('KIAD');
  // a departure route out over the sea, 17 minutes and 70 km out, still climbing through 15,000 ft, its destination
  // behind it (N97NH-style, Farmingdale for Washington: out over the Atlantic first, then west)
  const dep = track([[0, FRG.lat, FRG.lon, 0], [2, 40.70, -73.40, 3000], [17, 40.10, -73.30, 15000]], t0);
  check('climbing out on a departure route, its destination behind it: nothing', E.trackState(dep[dep.length - 1], dep, { origin: FRG, elapsedMin: 17 }) === null && E.offTrack(dep[dep.length - 1], dep, IAD, { origin: FRG, elapsedMin: 17 }) === 0);
  // level at FL250 on the downwind leg 40 km from the field: closer than 80 km, nothing
  const MXP = A('LIMC'), dw = track([[0, 45.90, 8.20, 12000], [6, 46.05, 8.95, 11000]], t0);
  check('downwind 40 km from the field (bearing 130+ degrees off): nothing', E.offTrack(dw[dw.length - 1], dw, MXP, {}) === 0, E.angDiff(dw[dw.length - 1].trk, E.brg(dw[dw.length - 1].lat, dw[dw.length - 1].lon, MXP.lat, MXP.lon)));
  // a hold 150 km out, at FL200, in the outbound turn
  const c = [55.5, 15.0], hold = []; for (let s = 0; s <= 480; s += 20) { const ang = s / 240 * 180, p = E.destPoint(c[0], c[1], 90 + ang, 8); hold.push({ t: t0 + s, lat: p[0], lon: p[1], alt: 20000, trk: (180 + ang) % 360, gs: 230 }); }
  check('in a hold (turning): nothing', E.trackState(hold[hold.length - 1], hold, {}) === null);
  // a turn back: rolled out on the reciprocal three minutes ago - home is behind no longer, and while it turned nothing
  const tb = track([[0, 56.0, 17.0, 37000], [5, 55.6, 17.2, 37000], [7, 55.6, 17.3, 37000], [12, 56.0, 17.1, 37000]], t0);
  check('turned back for home: home ahead, nothing; mid-turn: nothing', E.offTrack(tb[tb.length - 1], tb, BMA, {}) === 0 && E.trackState(tb[tb.findIndex(p => p.t >= t0 + 7 * 60)], tb.slice(0, tb.findIndex(p => p.t >= t0 + 7 * 60)), {}) === null);
  // an emergency code
  check('squawking 7700: nothing', E.trackState(Object.assign({}, sePos, { sq: '7700' }), se, {}) === null);
  // helicopters and light aircraft: the rule is for jets and turboprops only (they patrol, train, orbit)
  const heli = { hex: '400001', type: 'EC35', reg: 'G-XXXX' }, pist = { hex: '400002', type: 'C172', reg: 'G-YYYY' };
  for (const ac of [heli, pist]) {
    const p = Object.assign({}, sePos, { alt: 3000, gs: 120 }), tr = se.slice(-20).map(q => Object.assign({}, q, { alt: 3000, gs: 120 })), hs = E.histStats(seLog, T1);
    E.setWeights({ offTrk: 0 }); const a0 = E.predict({ ac, pos: p, trail: tr, hs, now: p.t }); E.setWeights({ offTrk: W0 });
    const a1 = E.predict({ ac, pos: p, trail: tr, hs, now: p.t });
    check(`${ac.type}: the rule leaves it alone`, JSON.stringify(a0.cands.map(c => [c.airport.id, c.score])) === JSON.stringify(a1.cands.map(c => [c.airport.id, c.score])));
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;
