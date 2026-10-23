// The flight log's legs from reported aircraft (real traces of both networks in test/fixtures/legs/<hex>/<day>_<lol|apl>):
// where each flight landed and took off, and when - as the userscript rebuilds a day (one network, the other merged in).
// usage: node test/unit_legs.cjs <dataDir>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createRouteEngine } = require('../src/engine.js');
const dataDir = process.argv[2];
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(dataDir, 'runway_len.json'), 'utf8')));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const hm = t => t ? new Date(t * 1000).toISOString().slice(11, 16) : '-';
function day(hex, type, d, src) {
  const rd = s => { const f = path.join(__dirname, 'fixtures', 'legs', hex, `${d}_${s}.json.gz`); if (!fs.existsSync(f)) return []; const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); return j ? E.parseTrace(j) : []; };
  const pts = src === 'merged' ? E.mergePoints(rd('lol'), rd('apl')) : rd(src);
  const ac = { hex, type }, cls = E.classify(ac);
  const legs = E.legsFromPoints(pts, { cls, type, rangeKm: E.typeRangeKm(ac), dataEnd: Date.parse(d + 'T00:00:00Z') / 1000 + 86400 });
  return legs.map(l => E.summarizeLeg(l, { cls, type, grp: E.groupOf(cls) }));
}
const sig = s => `${s.from ? s.from.code : '?'}>${s.to ? s.to.code : '?'}${s.to ? '[' + s.to.conf + ']' : ''} off ${hm(s.tOff)} on ${hm(s.tOn)}${s.tOnEst ? '~' : ''}`;
const near = (t, hhmm, tol) => { const [h, m] = hhmm.split(':').map(Number), x = new Date(t * 1000); return Math.abs(x.getUTCHours() * 60 + x.getUTCMinutes() - (h * 60 + m)) <= tol; };

// N758CC (Challenger 604, 27 Sep): Indianapolis -> Palermo is beyond its range; it stopped at Gander (lost at FL370,
// found climbing out of Gander two hours later)
{
  const L = day('aa37f6', 'CL60', '2026-09-27', 'lol');
  const a = L.find(s => s.from && s.from.code === 'TYQ'), b = L.find(s => s.from && s.from.code === 'YQX');
  check('N758CC: Indianapolis -> Gander, not Palermo (adsb.lol alone)', !!a && !!a.to && a.to.code === 'YQX' && a.ended, L.map(sig));
  check('N758CC: then Gander -> Palermo', !!b && !!b.to && b.to.code === 'PMO', L.map(sig));
  check('N758CC: Gander touchdown reckoned ~14:5x, marked estimated', !!a && !!a.tOn && a.tOnEst && near(a.tOn, '14:55', 15), a && hm(a.tOn));
  const M = day('aa37f6', 'CL60', '2026-09-27', 'merged'), c = M.find(s => s.from && s.from.code === 'YQX');
  check('N758CC merged: Palermo landing heard on final (~22:18)', !!c && c.ended && c.to && c.to.code === 'PMO' && c.to.conf !== 'near' && near(c.tOn, '22:18', 3) && !c.tOnEst, c && sig(c));
}
// D-CRUX (Phenom 300): flights last heard on final - a landing, with its time, no question mark
{
  const cases = [['2026-08-27', 'lol', 'NCE', '09:24'], ['2026-08-28', 'lol', 'PMI', '09:42'], ['2026-08-25', 'lol', 'MXP', '08:50'], ['2026-09-01', 'lol', 'LTN', '18:42'], ['2026-09-05', 'lol', 'DUS', '15:01'], ['2026-08-28', 'merged', 'PMI', '09:42']];
  for (const [d, src, code, t] of cases) {
    const L = day('3cef03', 'E55P', d, src), s = L.find(x => x.to && x.to.code === code);
    check(`D-CRUX ${d} (${src}): landed ${code} ~${t}, not "time unknown", no "?"`, !!s && s.ended && s.to.conf !== 'near' && !!s.tOn && near(s.tOn, t, 2), L.map(sig));
  }
  const O = day('3cef03', 'E55P', '2026-08-30', 'merged'), o = O.find(x => x.to && x.to.code === 'LIN');
  check('D-CRUX 30 Aug merged: Olbia -> Linate (a "ground" report at take-off speed past the runway end)', !!o && !!o.from && o.from.code === 'OLB', O.map(sig));
  const C = day('3cef03', 'E55P', '2026-08-29', 'merged'), cq = C.find(x => x.from && x.from.code === 'LBA');
  check('D-CRUX 29 Aug: Leeds -> Cannes, last heard low near it - a landing with a reckoned time', !!cq && cq.ended && cq.to && cq.to.code === 'CEQ' && !!cq.tOn, C.map(sig));
}
// HLE81 (AW169 air ambulance, 1 Oct): today's file ended where it passed 0.3 km from Gloucester at 1,175 ft - it was
// still flying (adsb.lol rewrites today's file now and then); with no end of day to go by, no landing is made up
{
  const zlib2 = require('zlib'), pts = E.parseTrace(JSON.parse(zlib2.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'legs', '407dfd', '2026-10-01_lol.json.gz'))).toString('utf8')));
  const cut = pts.filter(p => p.t <= Date.parse('2026-10-01T17:40:21Z') / 1000);
  const L = E.legsFromPoints(cut, { heli: true, cls: 'heli', type: 'A169' }), s = E.summarizeLeg(L[L.length - 1], { cls: 'heli', type: 'A169', grp: 'heli' });
  check('HLE81: a lagging day file ending over Gloucester is not a landing there', !s.ended && !(s.to && s.to.code === 'GLO'), sig(s));
}
// SRD899 (HM Coastguard AW189, 1 Oct): out of Prestwick, then hovering over the Firth of Clyde at -50 ft pressure altitude
// (high pressure), still or at 10 kt - its transponder says airborne. Not a string of minute-long flights from private sites.
{
  const t0 = Date.parse('2026-10-01T18:00:00Z') / 1000, pts = [];
  for (let i = 0; i < 10; i++) pts.push({ t: t0 + i * 30, lat: 55.505 - i * 0.003, lon: -4.59 - i * 0.01, alt: i ? 300 + i * 50 : null, gnd0: i === 0, gs: i ? 120 : 0, trk: 200 });
  let t = t0 + 300, la = 55.30; const lo = -4.95;
  for (let k = 0; k < 6; k++) for (let i = 0; i < 5; i++) { pts.push({ t, lat: la, lon: lo, alt: -50, gnd0: false, gs: k % 2 ? 10 : 1, trk: 180 }); t += 30; if (k % 2) la -= 0.0015; }
  const L = E.legsFromPoints(pts, { heli: true, cls: 'heli', type: 'A189' });
  check('SRD899: a helicopter hovering low over the sea is one flight out of Prestwick, no landings', L.length === 1 && !L[0].ended, L.map(l => l.how));
}
// VH-PHZ (Bell 412, Bankstown): hover-taxiing 300 m across the field and a hover check - no "Bankstown -> Bankstown 0:03"
{
  const t0 = Date.parse('2026-09-24T02:30:00Z') / 1000, pts = [];
  const at = (dt, lat, lon, alt, gs, g) => pts.push({ t: t0 + dt, lat, lon, alt, gs, gnd0: !!g, trk: 0 });
  for (let i = 0; i < 10; i++) at(i * 30, -33.9179, 150.9857, -375, 0, true);
  for (let i = 0; i < 12; i++) at(420 + i * 9, -33.9182 + i * 0.00025, 150.9855 - i * 0.0001, -375 + (i % 3) * 25, 11);
  for (let i = 0; i < 20; i++) at(540 + i * 9, -33.9156, 150.9847, -325 + Math.min(i, 20 - i) * 30, 1);
  for (let i = 0; i < 10; i++) at(760 + i * 30, -33.9154, 150.9845, -325, 0, true);
  const L = E.legsFromPoints(pts, { heli: true, cls: 'heli', type: 'B412' });
  check('VH-PHZ: a hover-taxi and hover check on the field is not a flight', L.length === 0, L.map(l => l.how));
}
// nothing invented: a flight still flying at the end of the data stays open
{
  const L = day('aa37f6', 'CL60', '2026-09-27', 'lol'), last = L[L.length - 1];
  check('N758CC adsb.lol alone: Palermo end (lost at 9,850 ft, 77 km out) is not called a landing on its own', !!last && !last.ended, last && sig(last));
}
// 2 Oct reports: one flight shown as two in the log where coverage was missing at one end of it
{
  const L = day('50043e', 'GLF5', '2026-10-01', 'lol'), a = L.find(s => s.from && s.from.code === 'DWC');
  check('T7-AFP adsb.lol alone: Dubai -> Athens is one flight (lost at FL428, found descending 9 km out)', !!a && !!a.to && a.to.code === 'ATH' && a.ended && !L.some(s => !s.from && s.to && s.to.code === 'ATH'), L.map(sig));
  const M = day('424c62', 'GLF6', '2026-10-01', 'lol');
  check('M-BIZZ adsb.lol alone: Bermuda, lost climbing through 7,800 ft, found at FL410 mid-Atlantic - one flight, still going', M.length === 1 && M[0].from && M[0].from.code === 'BDA' && !M[0].ended, M.map(sig));
  // (and a log stored before the fix: its two halves joined when the log is read)
  const split = [{ tStart: 1790863620, tEnd: 1790873400, from: { id: 1, code: 'DWC', conf: 'low' }, to: null, ended: true, how: 'gap', endAlt: 42875, endGs: null, endLat: 30, endLon: 46, startedOnGround: false, startAlt: 350 },
    { tStart: 1790880300, tEnd: 1790880660, from: null, to: { id: 2, code: 'ATH', conf: 'low' }, ended: true, how: 'final', startAlt: 5825, startGs: 195, startLat: 37.85, startLon: 23.9, endAlt: 1450, startedOnGround: false }];
  split[0].endLat = 37.85 - 1389 / 111 * 0.6; split[0].endLon = 23.9 + 1389 / 111 * 0.8 / Math.cos(33 * Math.PI / 180);
  const S = E.stitchLegs(split);
  check('a stored log split that way is joined when read: DWC -> ATH', S.length === 1 && S[0].from && S[0].from.code === 'DWC' && S[0].to && S[0].to.code === 'ATH', S.map(sig));
}
// the same flight twice - the day file's copy stops open at midnight, today's trace has it to the landing: one row
{
  const t = 1790883600, bda = { id: 11, code: 'BDA', conf: 'ground' }, dub = { id: 12, code: 'DUB', conf: 'ground' };
  const S = E.stitchLegs([{ tStart: t, tEnd: t + 16000, from: bda, to: null, ended: false, how: 'open', cs: 'MBIZZ', endAlt: 41000, startedOnGround: true },
    { tStart: t + 20, tEnd: t + 23000, from: bda, to: dub, ended: true, how: 'ground', cs: 'MBIZZ', startedOnGround: true },
    { tStart: t + 16200, tEnd: t + 23000, from: null, to: dub, ended: true, how: 'ground', startAlt: 41000, startedOnGround: false }]);
  check('M-BIZZ: a day file\'s open copy and today\'s full one of the same flight are one row, Bermuda -> Dublin', S.length === 1 && S[0].from && S[0].from.code === 'BDA' && S[0].to && S[0].to.code === 'DUB' && S[0].ended, S.map(sig));
}
// G-DGFD (R44, 1 Oct): lost at 350 ft and 45 kt by Enstone, an airstrip FR24 does not list - it landed there
{
  const L = day('406381', 'R44', '2026-10-01', 'lol'), s = L[L.length - 1];
  check('G-DGFD: Chester -> Enstone (lost low and slow 2.8 km from it)', !!s && s.ended && s.from && s.from.code === 'CEG' && s.to && /EGTN/.test(s.to.code || ''), L.map(sig));
}
// G-CLHI (Eurofox, 2 Oct): 103 minutes unheard at 1,350 ft by Lewes - it landed at a strip there, not at Gatwick 30 km off
{
  const a = { lat: 50.8996, lon: -0.0207, alt: 1350, t: 0 }, b = { lat: 50.9152, lon: 0.0012, alt: 2325, t: 103 * 60 };
  const g = E.landingInGap(a, b, { cls: 'piston', type: 'EFOX' }), j = E.landingInGap(a, b, { cls: 'bizjet', type: 'C56X' });
  check('G-CLHI: a light aircraft\'s landing in a hole by Lewes is at a strip nearby, not Gatwick', !!g && g.airport.icao !== 'EGKK' && g.da < 10 && g.db < 10, g && [g.airport.icao, g.airport.name]);
  check('... a business jet in the same hole still Gatwick', !!j && j.airport.icao === 'EGKK', j && j.airport.icao);
}
// G-GDFR (B738), 11 Jul: descending towards Dubrovnik over the sea, lost at 1,000 ft some 15 km out - Dubrovnik, inferred
// ("?"), never "a private site"
{
  const DBV = E.byIcao('LDDU'), t0 = 1783764000, pts = [];
  for (let i = 0; i <= 40; i++) { const km = 15 + (40 - i) * 4.5, p = E.destPoint(DBV.lat, DBV.lon, 285, km); pts.push({ t: t0 + i * 30, lat: p[0], lon: p[1], alt: Math.round(1000 + (40 - i) * 600), gs: 250, trk: 105, vr: -1200 }); }
  const ls = E.legsFromPoints(pts, { cls: 'airliner', type: 'B738' }), s = ls.length ? E.summarizeLeg(ls[ls.length - 1], { cls: 'airliner', type: 'B738', grp: E.groupOf('airliner') }) : null;
  check('airliner lost low over the sea heading for Dubrovnik: to DBV (inferred)', !!s && !!s.to && s.to.id === DBV.id && s.to.conf === 'near', s && s.to);
}
// easyJets climbing out of Gatwick past Biggin Hill, Ryanairs out of Manchester towards Liverpool or turning back over
// the field (Oct): lost climbing, out of the receivers' hearing - not landed at the field below or ahead of them
{
  const mv = (lat, lon, trk, km) => [lat + km * Math.cos(trk * Math.PI / 180) / 110.57, lon + km * Math.sin(trk * Math.PI / 180) / (111.32 * Math.cos(lat * Math.PI / 180))];
  const climbOut = (lat, lon, rwyTrk, turnTo, step, lostAlt, vr) => {
    const rows = []; let t = 0, alt = 300, gs = 160, trk = rwyTrk;
    for (; t < 600; t += step) rows.push([t, lat, lon, 'ground', 5, rwyTrk, 0, 0, null]);
    while (alt < lostAlt) { rows.push([t, lat, lon, Math.round(alt), gs, Math.round(trk), 0, vr ? 2200 : null, null]); t += step; [lat, lon] = mv(lat, lon, trk, gs * 1.852 * step / 3600); alt += 2200 * step / 60; gs = Math.min(280, gs + step * 0.6); if (t > 780) trk = turnTo; }
    rows.push([t, lat, lon, Math.round(alt), gs, Math.round(trk), 0, vr ? 2200 : null, null]);
    let t2 = t + 4 * 3600; for (let k = 0; k < 20; k++) { rows.push([t2, 52.0, -1.0, 35000, 450, 140, 0, 0, null]); t2 += 60; }
    return E.parseTrace({ timestamp: 1791868500, trace: rows });
  };
  const runs = [];
  for (const step of [5, 60]) for (const alt of [3500, 5000, 7500]) for (const vr of [true, false]) {
    runs.push(['EZY A320 out of Gatwick, NE', 'A320', climbOut(51.1530, -0.1720, 78, 45, step, alt, vr), step, alt, vr]);
    runs.push(['RYR B738 out of Manchester 23R, west', 'B738', climbOut(53.3655, -2.2620, 232, 268, step, alt, vr), step, alt, vr]);
    runs.push(['RYR B738 out of Manchester 23R, turning back', 'B738', climbOut(53.3655, -2.2620, 232, 52, step, alt, vr), step, alt, vr]);
  }
  const bad = [];
  for (const [name, type, pts, step, alt, vr] of runs) for (const dataEnd of [undefined, pts[pts.length - 1].t + 86400]) {
    const S = E.legsFromPoints(pts, { cls: 'airliner', type, dataEnd }).map(l => E.summarizeLeg(l, { cls: 'airliner', type, grp: E.groupOf('airliner') }));
    const o = S.find(x => x.startedOnGround);
    if (o && o.to) bad.push(`${name} ${step}s ${alt}ft vr:${vr}${dataEnd ? ' day' : ''}: ${sig(o)}`);
  }
  check('jets lost climbing out of Gatwick and Manchester: no landing at Biggin Hill, Southend, Liverpool or Manchester', !bad.length, bad.slice(0, 4));
  // (one heard climbing out, then on final 25 minutes later - a real short hop - still lands)
  const rows = []; let t = 0, lat = 53.3655, lon = -2.2620;
  for (; t < 300; t += 10) rows.push([t, lat, lon, 'ground', 5, 232, 0, 0, null]);
  for (let alt = 300; alt < 6000; alt += 400) { rows.push([t, lat, lon, alt, 220, 270, 0, 2400, null]); t += 10; [lat, lon] = mv(lat, lon, 270, 220 * 1.852 * 10 / 3600); }
  const LPL = E.byIcao('EGGP'), out = []; for (let i = 0; i <= 30; i++) { const p = E.destPoint(LPL.lat, LPL.lon, 85, 3 + (30 - i) * 0.6); out.push([t + 900 + i * 10, p[0], p[1], Math.round(300 + (30 - i) * 100), 150, 265, 0, -700, null]); }
  for (let i = 0; i < 6; i++) out.push([t + 1210 + i * 10, LPL.lat, LPL.lon + 0.004, 'ground', 40, 265, 0, 0, null]);
  const H = E.legsFromPoints(E.parseTrace({ timestamp: 1791868500, trace: rows.concat(out) }), { cls: 'airliner', type: 'B738' }).map(l => E.summarizeLeg(l, { cls: 'airliner', type: 'B738', grp: E.groupOf('airliner') }));
  check('... a jet heard on final at Liverpool after the climb-out still landed there', H.some(x => x.to && x.to.code === 'LPL'), H.map(sig));
}
// The same, in flights kept before: a climb-out given a landing is found again and its end let go - but not a short hop
{
  const t = 1791868500, man = { id: 1, code: 'MAN', conf: 'ground' }, lpl = { id: 2, code: 'LPL', conf: 'near' };
  const kept = { tStart: t, tOff: t + 60, tEnd: t + 232, startedOnGround: true, ended: true, how: 'gap-low', from: man, to: lpl, endAlt: 6300, maxAlt: 6300 };
  const mon = { tStart: t, tOff: t + 60, tEnd: t + 232, startedOnGround: true, ended: true, from: man, to: lpl, maxAlt: 6300 };
  check('a kept log\'s climb-out (lost at its highest, 3 minutes after take-off) is no landing', E.climbedOut(kept, 'airliner'));
  check('... nor the monitor\'s copy of it (no end height kept)', E.climbedOut(mon, 'airliner'));
  check('... but one rebuilt by these rules is left as it is', !E.climbedOut(Object.assign({}, kept, { endRules: 2 }), 'airliner'));
  check('... one seen landing on the ground is left', !E.climbedOut(Object.assign({}, kept, { to: Object.assign({}, lpl, { conf: 'ground' }) }), 'airliner'));
  check('... one whose end came from its next take-off is left', !E.climbedOut(Object.assign({}, mon, { to: Object.assign({}, lpl, { conf: 'chain' }) }), 'airliner'));
  check('... one lost on the way down (1,000 ft below its highest) is left', !E.climbedOut(Object.assign({}, kept, { endAlt: 5300 }), 'airliner'));
  check('... a light aircraft\'s is left', !E.climbedOut(kept, 'piston'));
  check('... a blocked aircraft\'s short hop the monitor keeps for good is left (SF50 Wolverhampton -> Blackpool)', !E.climbedOut(Object.assign({}, mon, { ladd: true, maxAlt: 1550, tEnd: t + 420 }), 'bizjet'));
  check('... and a low hop of any jet the monitor kept is left', !E.climbedOut(Object.assign({}, mon, { maxAlt: 1550 }), 'bizjet'));
}
// (1.0.1) Flights cut by a day's end and a hole in coverage, joined - as the browser's log and the monitor's days have them
// (each day's file built alone, then stitched and chained). N1868M (G650ER), 19 Oct: Teterboro at 21:07, lost off
// Newfoundland at FL410 at 23:15 doing 566 kt, heard again west of Spain at 01:55 - 2,774 km in 2 h 40 min, 1,044 km/h - and
// down at Barcelona: "Teterboro -> ?" and "? -> Barcelona" in its log and its panel's recent flights
{
  const a = day('a15a72', 'GLF6', '2026-10-19', 'lol'), b = day('a15a72', 'GLF6', '2026-10-20', 'lol');
  const joined = E.chainLegs(E.stitchLegs(a.concat(b).map(x => Object.assign({}, x))));
  const x = joined.find(l => l.from && l.from.code === 'TEB');
  check('N1868M: Teterboro -> Barcelona across midnight and the Atlantic hole (at the speed it was doing) - one flight, not two', !!x && x.to && x.to.code === 'BCN' && x.ended && joined.filter(l => l.tStart < (x.tEnd || 0) && l !== x && l.tEnd > x.tStart).length === 0, joined.map(sig));
  // (the same hole, the aircraft heard again too far for its speed: two flights still)
  const far = b.map(l => Object.assign({}, l, l.from ? null : { startLat: 30.0, startLon: 31.0 }));
  check('... a hole crossed faster than 1,300 km/h: not joined', E.chainLegs(E.stitchLegs(a.concat(far).map(x2 => Object.assign({}, x2)))).filter(l => l.tStart >= a[0].tStart).length >= 2);
}
// N811MK (G650ER), 7 Oct: Vienna, lost descending through 13,900 ft over Spain at 07:23; 8 Oct, first heard climbing through
// 22,000 ft 85 km away at 05:44, then Trenton - neither end known, a night between. No field is guessed for it: a landing read
// into such a night (landingInGap, as a hole within a day is read) was right 25% of the time on 3,143 real stops, and this
// one's guess (Valladolid) was wrong - the next guess of its destination counted it as a visit
{
  const a = day('ab0e30', 'GLF6', '2026-10-07', 'lol'), b = day('ab0e30', 'GLF6', '2026-10-08', 'lol');
  check('N811MK: each day alone has "Vienna -> ?" and "? -> Trenton"', a.length === 1 && a[0].from && a[0].from.code === 'VIE' && !a[0].to && b[0] && !b[0].from && b[0].to && b[0].to.code === 'TTN', a.concat(b).map(sig));
  const j = E.chainLegs(E.stitchLegs(a.concat(b).map(x => Object.assign({}, x))));
  check('... chained: still two flights, the ends between them unknown (no field guessed across the night)', j.length === 2 && j[0].from && j[0].from.code === 'VIE' && !j[0].to && !j[1].from && j[1].to && j[1].to.code === 'TTN', j.map(sig));
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
