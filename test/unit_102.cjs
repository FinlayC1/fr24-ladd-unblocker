// (1.0.2) What the owner found wrong on 25-28 Oct, each from its real data, and what was built for it:
//   - G-LOBY (GL5T), 25 Oct: Bedford MA to Samedan, lost at 10,550 ft coming down the Engadin and heard again an hour later
//     climbing out of the same valley, on to Luton - read as landing at Sondrio (a 3,445 ft strip) and taking off from
//     Mollis. No field with a runway too short for the aircraft for a guessed end; a stop neither end of which was seen is
//     one stop (the landing's field the take-off's when it explains the climb); a guessed landing before a take-off seen
//     from a field it could have been coming down to: that field
//   - N162GB (GALX, a G200), 25 Oct: Lagos to Farnborough, heard by ADS-B from Algeria on - "Lagos 95%" over France (no
//     range figure for its type: a light jet's, every field ahead "beyond its range", the origin left alone), and its log
//     "- Farnborough": FR24's positions of the flight kept in its track, its day built from them (Lagos - Farnborough), the
//     day marked so browsers keep it as built
//   - M-PORT: no LADD tag - the monitor says which aircraft it holds as blocked (/hist blk)
//   - every airport's movements and runway use, each day of the world log, served at once (/airport daily, usage)
//   - a flight FR24 numbers afresh after a hole in its coverage: named again from where the named one would be (handover)
//   - every flight named here worked out by central calculation continuously (centralRound)
// usage: node test/unit_102.cjs <dataDir>
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const D = process.argv[2] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = D;
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon102-'));
const { createRouteEngine } = require('../src/engine.js');
const W = require('../monitor/world.cjs');
const { createApStats } = require('../monitor/apstats.cjs');
const { createAirportInfo } = require('../monitor/airport.cjs');
const { createTracks } = require('../monitor/tracks.cjs');
const { createIdent } = require('../monitor/ident.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 600) : '')); };
const fx = (hex, day) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs', hex, day + '_lol.json.gz'))).toString('utf8'));
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10), dayS = d => Date.parse(d + 'T00:00:00Z') / 1000;
const hm = t => new Date(t * 1000).toISOString().slice(11, 16);

// ---- the engine as the logs have it (airports, unlisted fields, runways) ------------------------------------------------
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(D, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, D);
E.setRunways(JSON.parse(fs.readFileSync(path.join(D, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(D, 'runway_len.json'), 'utf8')));
const code = e => e ? (E.byId(e.id) || {}).code : '-';
function dayLegs(hex, type, day, j) {
  const ac = { hex, type }, cls = E.classify(ac), ctx = { cls, type, grp: E.groupOf(cls) };
  const pts = E.parseTrace(j || fx(hex, day)), legs = E.legsFromPoints(pts, { heli: false, patrol: false, cls, type, rangeKm: E.typeRangeKm(ac), dataEnd: dayS(day) + 86400 });
  return { raws: legs, sums: legs.map(l => E.summarizeLeg(l, ctx)), ctx, pts };
}

(async () => {
  // ================= G-LOBY =================
  { const { sums, ctx } = dayLegs('4080a5', 'GL5T', '2026-10-25');
    const ch = E.chainLegs(E.stitchLegs(sums.map(x => Object.assign({}, x))), ctx), s = ch.map(l => code(l.from) + '-' + code(l.to));
    check('G-LOBY 25 Oct: Bedford - Samedan (lost coming down the Engadin), Samedan - Luton (heard climbing out of it an hour later), Luton - Liverpool - Luton', s.join(' ') === 'BED-SMV SMV-LTN LTN-LPL LPL-LTN', s);
    check('... the landing at Samedan before the take-off, ten minutes and more between them', ch[0].tOn && ch[1].tOff && ch[0].tOn + 600 <= ch[1].tOff && ch[0].tOn > ch[0].tEnd, { on: hm(ch[0].tOn), off: hm(ch[1].tOff) });
    check('... the climb\'s first point keeps its track (startTrk) for the take-off guess', Math.abs(sums[1].startTrk - 220) < 5, sums[1].startTrk);
    const lost = { lat: sums[0].endLat, lon: sums[0].endLon, alt: sums[0].endAlt, trk: sums[0].endTrk };
    const a = E.arrivalFromDescent(lost, ctx), aNo = E.arrivalFromDescent(lost, null);
    check('... a heavy business jet\'s guessed landing never on a runway too short for it: Samedan, not Sondrio\'s 3,445 ft (without the class, Sondrio)', a && a.airport.code === 'SMV' && aNo && aNo.airport.code === 'QIS', { withCls: a && a.airport.code, without: aNo && aNo.airport.code });
    // (unless it has been there before: the data can be wrong)
    const sondrio = E.airports.find(x => x.code === 'QIS'), aV = E.arrivalFromDescent(lost, Object.assign({ visits: new Map([[sondrio.id, 3]]) }, ctx));
    check('... unless it has used the strip before', aV && aV.airport.code === 'QIS', aV && aV.airport.code);
    // a guessed landing before a take-off seen on the ground from a field it could have been coming down to: that field
    const smv = E.airports.find(x => x.code === 'SMV'), zrh = E.byIcao('LSZH');
    const mk = (to, fromAp, startLat, startLon) => [Object.assign({}, sums[0], { to: { id: sondrio.id, code: 'QIS', conf: 'near' }, tOn: null }), { tStart: sums[0].tEnd + 3600, tEnd: sums[0].tEnd + 7200, from: { id: fromAp.id, code: fromAp.code, conf: 'ground' }, to: null, startedOnGround: true, startLat, startLon, startAlt: null, endLat: 51.5, endLon: 0, endAlt: 30000, ended: false }];
    const w1 = E.chainLegs(mk(null, smv, smv.lat, smv.lon), ctx), w2 = E.chainLegs(mk(null, zrh, zrh.lat, zrh.lon), ctx);
    check('... a landing guessed at Sondrio, the next take-off seen on Samedan\'s runway an hour later: Samedan (chain); seen at Zurich, 150 km off its descent: left as guessed', w1[0].to.id === smv.id && w1[0].to.conf === 'chain' && w2[0].to.id === sondrio.id && w2[0].to.conf === 'near', { smv: code(w1[0].to), zrh: code(w2[0].to) });
    // the stored form keeps the start track
    const back = W.decodeLeg(JSON.parse(JSON.stringify(W.encodeLeg(sums[1]))));
    check('... the world log keeps it in its row (startTrk), and an older row without it reads as none', back.startTrk === sums[1].startTrk && W.decodeLeg(W.encodeLeg(sums[1]).slice(0, 22)).startTrk === null, back.startTrk);
  }

  // ================= N162GB: range =================
  { const ac = { hex: 'a0f9b4', type: 'GALX', reg: 'N162GB' }, LOS = E.byIcao('DNMM'), pts = E.parseTrace(fx('a0f9b4', '2026-10-25'));
    check('N162GB: a G200 (GALX) has its own range now - 3,400 nm, not a light jet\'s 2,200', Math.round(E.typeRangeKm(ac) / 1.852) === 3400 && Math.round(E.rangeKm(ac, E.classify(ac)) / 1.852) === 3400);
    const at = hhmm => { const t = dayS('2026-10-25') + (+hhmm.slice(0, 2)) * 3600 + (+hhmm.slice(3)) * 60, trail = pts.filter(p => p.t <= t), pos = trail[trail.length - 1]; return E.predict({ ac, pos, trail, hs: E.histStats([], t), now: t, origin: { airport: LOS, conf: 'ground' } }); };
    const rs = ['17:30', '18:00', '18:15'].map(at), tops = rs.map(r => r.cands[0] && r.cands[0].airport.code), losIn = rs.map(r => r.cands.some(c => c.airport.id === LOS.id));
    check('... over northern France and coming down into London after 6,000 km out of Lagos: never "back to Lagos" (it could not reach it) - fields ahead of it, London\'s first once it turns for them', !losIn.some(Boolean) && rs[0].cands[0] && rs[0].cands[0].airport.lat > 48.5 && rs.slice(1).every(r => r.cands[0] && r.cands[0].airport.lat > 50.5 && r.cands[0].airport.lat < 52.5 && Math.abs(r.cands[0].airport.lon) < 1.5), { tops, losIn });
    // a range from the type's table the flight itself has gone beyond is not believed: a type without a figure, flown far
    const r2 = (() => { const a2 = { hex: 'a0f9b4', type: 'ZZZZ', reg: 'N162GB' }, t = dayS('2026-10-25') + 18 * 3600, trail = pts.filter(p => p.t <= t), pos = trail[trail.length - 1]; return E.predict({ ac: Object.assign(a2, { cat: 'A2' }), pos, trail, hs: E.histStats([], t), now: t, origin: { airport: LOS, conf: 'ground' } }); })();
    check('... and a type with no figure at all, the same flight: fields ahead of it, not its origin', r2.cands.length > 0 && !r2.cands.some(c => c.airport.id === LOS.id), r2.cands.slice(0, 3).map(c => c.airport.code));
  }

  // ================= tracks: points taken out again =================
  { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trk102-')), T = createTracks({ store: dir }), t0 = Math.round(Date.now() / 1000) - 7200, hex = 'abc123';
    T.put(hex, [0, 1, 2, 3, 4].map(k => ({ t: t0 + k * 120, lat: 50 + k * 0.1, lon: 0, alt: 30000 })));
    const n = T.drop(hex, [t0 + 120, t0 + 360, t0 + 99999]), left = T.of(hex, dayOf(t0)).map(p => p[0] - t0);
    check('tracks.drop: the points at exactly those moments taken out, the rest kept', n === 2 && left.join() === '0,240,480', { n, left }); }

  // ================= airport counts (apstats.cjs) and /airport =================
  { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as102-')), AS = createApStats({ store: dir });
    const ltn = E.byIcao('EGGW'), lpl = E.byIcao('EGGP'), nowS = Date.now() / 1000, d1 = dayOf(nowS - 86400), d2 = dayOf(nowS - 2 * 86400);
    const a = AS.acc(), g = id => ({ id, code: '', conf: 'ground' }), nr = id => ({ id, code: '', conf: 'near' });
    a.add({ from: g(ltn.id), to: g(lpl.id) }, '26', '27'); a.add({ from: g(ltn.id), to: nr(lpl.id) }, '26', null); a.add({ from: g(lpl.id), to: g(ltn.id) }, '27', '26');
    AS.write(d1, a, true);
    const b = AS.acc(); b.add({ from: g(ltn.id), to: g(lpl.id) }, null, null); AS.write(d2, b, false);
    const AS2 = createApStats({ store: dir }), o = AS2.read(d1);
    check('apstats: a day\'s take-offs and landings at each airport - only ends seen (ground, low) - and the runway each used; read back after a restart', o && o.rw === 1 && o.ap[ltn.id][0] === 2 && o.ap[ltn.id][1] === 1 && o.ap[ltn.id][2]['26'].join() === '2,1' && o.ap[lpl.id][0] === 1 && o.ap[lpl.id][1] === 1 && AS2.has(d2), o && o.ap[ltn.id]);
    const APT = createAirportInfo({ E }); APT.load(D);
    // today's flights from the monitor's own log (a landing at Luton on runway 08), and one of a counted day (left to the counts)
    // (today's landing within today whatever the hour - just after midnight too)
    const tOnT = nowS - Math.min(700, Math.floor((nowS - dayS(dayOf(nowS))) / 2));
    const legs = new Map([['aaaaaa', new Map([['k1', { from: g(lpl.id), to: g(ltn.id), tStart: tOnT - 2900, tEnd: tOnT + 100, tOff: tOnT - 2800, tOn: tOnT, rwyOn: '08' }], ['k2', { from: g(ltn.id), to: g(lpl.id), tStart: dayS(d1) + 3600, tEnd: dayS(d1) + 6000, tOff: dayS(d1) + 3700, tOn: dayS(d1) + 5900, rwyOff: '08' }]])]]);
    const r = APT.answer(ltn.id, legs, nowS, 7, AS2, 14), today = dayOf(nowS);
    const dl = Object.fromEntries(r.daily.map(x => [x[0], x.slice(1)]));
    check('/airport: each day\'s take-offs and landings - a counted day from its counts (every aircraft ADS-B heard), today from the flights tracked here', dl[d1] && dl[d1].join() === '2,1,all' && dl[d2] && dl[d2].join() === '1,0,all' && dl[today] && dl[today].join() === '0,1,live', r.daily);
    const u = Object.fromEntries(r.usage.map(x => [x[0], [x[1], x[2]]]));
    check('... runway use: a day\'s counts where its runways were worked out, today\'s from the tracked flights - a counted day\'s tracked flight not counted twice', u['26'] && u['26'].join() === '2,1' && u['08'] && u['08'].join() === '0,1' && r.moves === 3 + 1 + 1 && r.allDays === 2, { usage: r.usage, moves: r.moves, allDays: r.allDays });
  }

  // ================= ident: picked up again after a hole =================
  { const env = () => ({ E, live: new Map(), ac: new Map(), blocked: new Map(), legs: new Map() });
    const T = 1792000000, MS = T * 1000, fl = (id, o) => Object.assign({ id, lat: 50, lon: 0, alt: 37000, trk: 90, spd: 450, ts: T, gnd: false, src: 0, type: 'GLF6', reg: '', cs: '', icon: 3 }, o);
    const run = (second, others) => {
      const e = env(); e.live.set('a00001', { a: { hex: 'a00001', lat: 50, lon: 0, alt_baro: 37000, gs: 450, track: 90, dbFlags: 8, r: 'N1', t: 'GLF6' }, t: T });
      const I = createIdent(e); I.observe([fl(1)], MS, 'scan'); I.match(MS);
      e.live.clear();
      for (const o of others || []) { I.observe([o], MS, 'scan'); I.assign(I.flights.get(o.id), o._hex, { reg: 'N2', type: 'GLF6' }, 'list', MS); }
      // ten minutes on, FR24 draws it under a new number - 450 kt east for 600 s is 139 km; nobody hears it on ADS-B
      const later = MS + 600e3; I.observe([second], later, 'scan'); I.match(later);
      return I.ids.get(second.id);
    };
    const [la, lo] = E.destPoint(50, 0, 90, 450 * 1.852 * 600 / 3600);
    const R1 = run(fl(2, { lat: la, lon: lo + 0.05, ts: T + 600 }));
    check('ident (handover): a flight FR24 draws afresh ten minutes after the named one stopped, where that one would be now: the same aircraft', R1 && R1.hex === 'a00001' && R1.how === 'handover', R1);
    const R2 = run(fl(3, { lat: la + 1.5, lon: lo, ts: T + 600 }));
    check('... 170 km off where it would be: not named', !R2, R2);
    const R3 = run(fl(4, { lat: la, lon: lo, ts: T + 600 }), [fl(9, { lat: 50.05, lon: 0, ts: T, _hex: 'a00002' })]);
    check('... two named flights it could be: neither (one alone, or nobody)', !R3, R3);
    const R4 = run(fl(5, { lat: la, lon: lo, ts: T + 600, type: 'C172' }));
    check('... of another type: not named', !R4, R4);
  }

  // ================= the monitor: FR24's track first, the day built from it; /hist blk, fr =================
  { const M = require('../monitor/monitor.cjs'); M.loadEngine();
    // (the fixture day moved to yesterday - the track store keeps 90 days)
    const j = fx('a0f9b4', '2026-10-25'), shift = Math.round((dayS(dayOf(Date.now() / 1000 - 86400)) - dayS('2026-10-25')));
    j.timestamp += shift; const day = dayOf(j.timestamp), LOS = M.E.byIcao('DNMM');
    const first = M.E.parseTrace(j)[0];
    // FR24's positions of the flight: on the ground at Lagos, then every two minutes along the way to where ADS-B first heard it
    const tOff = dayS(day) + 10 * 3600 + 56 * 60, rows = [];
    for (let k = 0; k < 4; k++) rows.push({ t: tOff - 600 + k * 150, lat: LOS.lat, lon: LOS.lon, alt: 0, gnd: true, spd: 0, trk: 0 });
    const km = M.E.dist(LOS.lat, LOS.lon, first.lat, first.lon), brg = M.E.brg(LOS.lat, LOS.lon, first.lat, first.lon), dur = first.t - tOff - 120;
    for (let t = tOff + 60; t < first.t - 120; t += 120) { const f = (t - tOff) / dur, [la, lo] = M.E.destPoint(LOS.lat, LOS.lon, brg, km * Math.min(1, f)); rows.push({ t, lat: la, lon: lo, alt: Math.min(40000, 1500 + (t - tOff) * 40), gnd: false, spd: 450, trk: brg }); }
    const nowMs = Date.now(), mid = tOff + 2 * 3600;
    // (the scans saw it from two hours after its take-off on; FR24's whole trail of it comes later)
    for (const p of rows.filter(q => q.t >= mid)) M.ident.observe([{ id: 4242, lat: p.lat, lon: p.lon, alt: p.alt, trk: p.trk, spd: p.spd, ts: p.t, gnd: p.gnd, src: 5, type: 'GALX', reg: '', cs: '', icon: 3 }], nowMs, 'scan');
    M.ident.clientId(4242, 'a0f9b4', 'test', nowMs);
    check('monitor: N162GB named on FR24 (its flight from Lagos) - held as blocked, FR24 seen hiding it (fr)', M.ident.ids.get(4242) && M.blocked.get('a0f9b4') && M.blocked.get('a0f9b4').fr > 0);
    M.fr24Track(nowMs + 60e3);
    check('... FR24\'s positions not put into its track before the name has been held a quarter of an hour', M.tracks.of('a0f9b4', day).length === 0);
    M.fr24Track(nowMs + 16 * 60e3);
    const part = M.tracks.of('a0f9b4', day);
    check('... then put: the scans\' positions of it', part.length >= 10 && part[0][0] >= mid, { n: part.length });
    M.ident.setTrail(4242, rows.map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.spd, trk: p.trk })), nowMs + 17 * 60e3);
    M.fr24Track(nowMs + 17 * 60e3);
    const kept = M.tracks.of('a0f9b4', day);
    check('... and FR24\'s trail, when it comes, whole - back to the take-off from Lagos, before the scans\' positions', kept.length > part.length + 20 && M.E.dist(kept[0][1], kept[0][2], LOS.lat, LOS.lon) < 3 && kept[0][4] === true, { n: kept.length, first: kept[0] });
    await M.histDay('a0f9b4', day, { state: 'ok', j }, { state: 'later' });
    const h = M.histOf('a0f9b4'), ls = h.legs.filter(l => l.day === day.replace(/-/g, '/'));
    check('... its day built from FR24\'s track and ADS-B together: Lagos - Farnborough, not "- Farnborough"', ls.length === 1 && code(ls[0].from) === 'LOS' && code(ls[0].to) === 'FAB' && ls[0].from.conf === 'ground', ls.map(l => code(l.from) + '-' + code(l.to) + ' ' + hm(l.tOff || l.tStart)));
    check('... the day marked as built with what was heard here (fr) - browsers keep it as built - and the aircraft as blocked, hidden by FR24 (blk 2)', h.fr && h.fr[day.replace(/-/g, '/')] > 0 && h.blk === 2, { fr: h.fr, blk: h.blk });
    // a name found wrong: its FR24 positions taken out of that aircraft's track again
    const fr24Only = () => M.tracks.of('a0f9b4', day).filter(p => p[0] < first.t - 130).length, had = fr24Only();
    M.ident.unassign(4242, nowMs + 20 * 60e3, 'diverged');
    check('... a name withdrawn as wrong (diverged): FR24\'s positions of that flight taken out of the aircraft\'s track (ADS-B\'s kept)', had >= 20 && fr24Only() === 0 && M.tracks.of('a0f9b4', day).length > 100, { had, left: fr24Only(), all: M.tracks.of('a0f9b4', day).length });
    const plain = M.histOf('fedcba');
    check('... /hist of an aircraft not held as blocked: blk 0', plain.blk === 0);
    // central calculation, continuously: off here (no tables loaded) - the round does nothing and says so
    const n = await M.centralRound(Date.now());
    check('... the continuous central round: nothing worked out while central calculation is off', n === 0 && M.CR.rounds === 0);
  }

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
