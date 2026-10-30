// Engine checks from reported flights (real ADS-B tracks in test/fixtures) and the aircraft-type table.
// usage: node test/unit_engine.cjs <airports.json> <runways.json> <runway_len.json> [tables.json] [logit.json]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const [apFile, rwFile, rwlFile, tblFile, lgFile] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(apFile, 'utf8')).rows);
E.setRunways(JSON.parse(fs.readFileSync(rwFile, 'utf8'))); E.setRunwayLengths(JSON.parse(fs.readFileSync(rwlFile, 'utf8')));
E.setTables(JSON.parse(fs.readFileSync(tblFile || path.join(__dirname, '..', 'src', 'tables.json'), 'utf8')));
E.setLogit(JSON.parse(fs.readFileSync(lgFile || path.join(__dirname, '..', 'src', 'logit.json'), 'utf8')));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const fx = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));

// 1) aircraft types: the helicopter pattern used to take a Hawker 800 (H25B), a BAe 146 (B461) and a Cirrus SR22T (S22T)
//    for helicopters; types no list names come from the ICAO type table (GA8 Airvan: single piston)
const want = { H25B: 'bizjet', H25A: 'bizjet', B461: 'airliner', S22T: 'piston', GA8: 'piston', EC35: 'heli', AS50: 'heli', B407: 'heli', GA5C: 'heavybiz', EUFI: 'fighter', C25A: 'bizjet', F100: 'airliner', DA42: 'piston' };
const got = Object.fromEntries(Object.keys(want).map(t => [t, E.classify({ type: t })]));
check('aircraft classes (ICAO type table; no business jet or airliner taken for a helicopter)', Object.keys(want).every(t => got[t] === want[t]), got);
check('a PC-12 reporting ADS-B category A1 ("light") is a turboprop, not a piston', E.classify({ type: 'PC12', cat: 'A1' }) === 'turboprop');

// 2) runways: a G500 cannot land on Dublin Weston (3,038 ft); Dublin (10,203 ft) is fine; a light jet not on grass
const qiw = E.byIcao('EIWT'), dub = E.byIcao('EIDW');
check('runway rule: Dublin Weston impossible for a G500, Dublin fine; fine for a piston single', E.rwyImpossible(qiw, 'heavybiz', 'GA5C') && !E.rwyImpossible(dub, 'heavybiz', 'GA5C') && !E.rwyImpossible(qiw, 'piston', 'GA8'), { qiw: qiw && qiw.rwl, dub: dub && dub.rwl });

// 3) TC-GAP (Turkish Government G500, 25 Sep 2026, Ankara -> Dublin): 209 km out at FL338 descending over the Irish
//    Sea it was shown going to Dublin Weston (QIW, 38%)
{
  const j = fx('tcgap_2026-09-25.json'), pts = E.parseTrace(j);
  const ac = { hex: j.icao, type: 'GA5C', reg: 'TC-GAP', mil: true, country: 'Turkey' };
  const legs = E.legsFromPoints(pts, {}), leg = legs[legs.length - 1], all = [leg.start].concat(leg.pts);
  const res = [];
  for (const lonT of [-2.2, -3.0, -4.0, -5.0, -5.8]) {
    const i = all.findIndex(p => p.lon <= lonT); if (i < 1) continue;
    const pos = all[i], trail = all.slice(0, i + 1).filter((p, k) => k % 3 === 0);
    const r = E.predict({ ac, pos, trail, hs: E.histStats([], pos.t), now: pos.t });
    res.push({ at: `${pos.lat.toFixed(2)},${pos.lon.toFixed(2)} ${pos.alt}ft`, top: r.cands.slice(0, 3).map(c => c.airport.code + ' ' + Math.round(c.p * 100)).join(' / '), qiw: Math.round(100 * ((r.cands.find(c => c.airport.code === 'QIW') || {}).p || 0)) });
  }
  check('TC-GAP G500 descending towards Dublin: Dublin Weston (3,038 ft runway) never above 1%', res.length >= 4 && res.every(x => x.qiw <= 1), res);
  check('TC-GAP: Dublin the top answer from 200 km out', res.filter(x => /^DUB/.test(x.top)).length >= res.length - 1, res.map(x => x.top));
}

// 4) G-VANX (GA8 Airvan, parachute drops from Sleap, 24 Sep 2026): a jump run into the wind at 12,000 ft is slower
//    than 40 kt - it used to count as a landing and split every lift in two; each lift is Sleap -> Sleap
{
  const j = fx('gvanx_2026-09-24.json'), pts = E.parseTrace(j);
  const ac = { hex: j.icao, type: 'GA8', reg: 'G-VANX', country: 'United Kingdom' };
  const legs = E.legsFromPoints(pts, {}), sums = legs.map(l => E.summarizeLeg(l, null));
  const midAir = sums.filter(s => s.how === 'ground' && s.endAlt != null && s.endAlt > 4000).length;
  const lifts = sums.filter(s => s.maxAlt > 8000);
  check('skydiving lifts are not split at the jump run (no "landing" high in the air)', midAir === 0 && lifts.length >= 3, { legs: sums.length, midAirLandings: midAir, lifts: lifts.length, sample: sums.slice(0, 6).map(s => `${s.from ? s.from.code : '?'}>${s.to ? s.to.code : '?'} ${s.how} max ${s.maxAlt}`) });
  // on the way down from a drop, with the day's earlier lifts as its log: back to Sleap, not RAF Shawbury 7 km away
  const hist = E.chainLegs(E.stitchLegs(sums.slice(0, -1).map(s => Object.assign({}, s))));
  const leg = legs[legs.length - 1], all = [leg.start].concat(leg.pts), peak = all.reduce((m, p, i) => (p.alt || 0) > (all[m].alt || 0) ? i : m, 0);
  const down = all.slice(peak).find(p => p.alt != null && p.alt < 3000 && !p.gnd) || all[all.length - 2];
  const r = E.predict({ ac, pos: down, trail: all.slice(0, all.indexOf(down) + 1), hs: E.histStats(hist, down.t), now: down.t });
  check('G-VANX coming down after a drop: Sleap (its base), not RAF Shawbury', r.cands[0] && r.cands[0].airport.code === 'QKV', { at: `${down.alt}ft`, top: r.cands.slice(0, 3).map(c => c.airport.code + ' ' + Math.round(c.p * 100)) });
}
// 5) G-FRAU (Draken Falcon 20, 25 Sep, Teesside -> Prestwick): the panel froze at "Glasgow 49%" 37 km out. Lined up
//    close in and low it is Prestwick - found from 10 km out on final; never another airfield; not yet 37 km out
{
  const j = fx('gfrau_2026-09-25.json'), pts = E.parseTrace(j), legs = E.legsFromPoints(pts, {}), leg = legs[legs.length - 1], all = [leg.start].concat(leg.pts);
  const withVr = p => { const b = all.filter(q => p.t - q.t >= 40).pop(); return Object.assign({}, p, { vr: b ? (p.alt - b.alt) / ((p.t - b.t) / 60) : null }); };
  const air = all.filter(p => !p.gnd), pik = E.byIcao('EGPK');
  const hits = air.map(p => ({ p, a: E.approachTo(withVr(p), {}) })).filter(x => x.a);
  const first = hits[0], far = air.find(p => E.dist(p.lat, p.lon, pik.lat, pik.lon) < 38 && E.dist(p.lat, p.lon, pik.lat, pik.lon) > 30);
  check('G-FRAU on final into Prestwick: the airfield ahead is Prestwick (from ~10 km out, never another; not 37 km out)', hits.length > 20 && hits.every(x => x.a.airport.code === 'PIK') && first.a.dist < 11 && !(far && E.approachTo(withVr(far), {})), { hits: hits.length, first: first && `${first.a.dist.toFixed(1)} km ${first.p.alt} ft` });
}
// 6) F-BOZO (DR221, 25 Sep): 3.5 km out at 500 ft, lined up with Dinard's runway 35 - that is where it lands; a jet
//    held at 2,000 ft on its departure out of Biggin Hill, or a light aircraft crossing an airfield level at 2,500 ft, is not
{
  const f = E.approachTo({ lat: 48.557, lon: -2.0715, alt: 500, trk: 351, gs: 70, vr: -400 }, {});
  const bqh = E.byIcao('EGKB');
  const dep = E.approachTo({ lat: bqh.lat - 0.04, lon: bqh.lon + 0.01, alt: 2000, trk: 25, gs: 220, vr: 0 }, { origin: bqh, elapsedMin: 4 });
  const cross = E.approachTo({ lat: bqh.lat - 0.05, lon: bqh.lon, alt: 3100, trk: 0, gs: 110, vr: 0 }, {});
  check('F-BOZO on short final: Dinard; a departure held low and a transit overhead are not arrivals', !!f && f.airport.code === 'DNR' && !dep && !cross, { fbozo: f && f.airport.code, dep: dep && dep.airport.code, cross: cross && cross.airport.code });
}
// 7) P4-BTR (G450, 25 Sep): out of Le Bourget, 1,800 km south over Algeria at FL410 heading 174 - shown going to Dubai
//    ("used before"; that way the trip would be 6,700 km for 5,250). Also not "back to Paris".
{
  const j = fx('p4btr_2026-09-25.json'), pts = E.parseTrace(j), legs = E.legsFromPoints(pts, {}), leg = legs[legs.length - 1], all = [leg.start].concat(leg.pts);
  let last = all[all.length - 1]; const t1 = last.t + 1800;
  for (let k = 1; k <= 60; k++) { const f = k / 60; all.push({ t: Math.round(last.t + (t1 - last.t) * f), lat: last.lat + (32.4 - last.lat) * f, lon: last.lon + (4.5 - last.lon) * f, alt: 41000, gs: 482, trk: 174 }); }
  const pos = all[all.length - 1], trail = all.filter((p, k) => k % 10 === 0);
  const dwc = E.byIcao('OMDW'), lbg = E.byIcao('LFPB');
  const hist = [{ from: { id: lbg.id, code: 'LBG' }, to: { id: dwc.id, code: 'DWC' }, tStart: pos.t - 5 * 86400, tEnd: pos.t - 5 * 86400 + 23000, ended: true, how: 'ground' }, { from: { id: dwc.id, code: 'DWC' }, to: { id: lbg.id, code: 'LBG' }, tStart: pos.t - 3 * 86400, tEnd: pos.t - 3 * 86400 + 25000, ended: true, how: 'ground' }];
  const r = E.predict({ ac: { hex: j.icao, type: 'GLF4', reg: 'P4-BTR' }, pos, trail, hs: E.histStats(hist, pos.t), now: pos.t });
  const pOf = c => Math.round(100 * ((r.cands.find(x => x.airport.code === c) || {}).p || 0));
  check('P4-BTR heading south over the Sahara: not Dubai, not back to Paris (a detour of a third is not a route)', pOf('DWC') <= 3 && pOf('LBG') <= 3 && r.cands[0].airport.code !== 'DWC', { top: r.cands.slice(0, 4).map(c => c.airport.code + ' ' + Math.round(c.p * 100)), dwc: pOf('DWC'), lbg: pOf('LBG') });
}
// 8) TC-TSS (Global 5000, 25 Sep): lost descending through FL214 towards Misrata at 20:30, seen climbing through FL252
//    48 km away at 21:39 - one leg "Paris -> Malta" in the log (and "from Paris" live). Two legs, via Misrata; a fighter's
//    or patrol aircraft's hole like it is left alone.
{
  const pts = E.parseTrace(fx('tctss_2026-09-25b.json')), legs = E.legsFromPoints(pts, {}), sums = legs.map(l => E.summarizeLeg(l, { cls: 'heavybiz', type: 'GL5T' }));
  const got = sums.map(s => `${s.from ? s.from.code : '?'}>${s.to ? s.to.code : '?'}`);
  const legsP = E.legsFromPoints(E.parseTrace(fx('tctss_2026-09-25b.json')), { patrol: true });
  check('TC-TSS landing at Misrata out of coverage: two legs, LBG>MRA and MRA>MLA (not LBG>MLA); left alone for a patrol aircraft', got.join(' ') === 'LBG>MRA MRA>MLA' && legs[0].how === 'gap-land' && legsP.length === 1, { legs: got, how: legs.map(l => l.how), patrol: legsP.length });
}
// 9) AOJ1A (Global 6500 OE-LAD, Vienna-based, 25 Sep): out of Budapest, 2,660 km south over Niger at FL410 heading
//    168 - shown "Budapest -> Vienna 84%". Its real trace flown on to there, Vienna as its base and 500 fleet-mate
//    visits: neither Vienna nor Budapest.
{
  const j = fx('aoj1a_2026-09-25.json'), legs = E.legsFromPoints(E.parseTrace(j), {}), leg = legs[legs.length - 1], all = [leg.start].concat(leg.pts);
  const last = all[all.length - 1], t1 = last.t + 85 * 60;
  for (let k = 1; k <= 85; k++) { const f = k / 85; all.push({ t: Math.round(last.t + (t1 - last.t) * f), lat: last.lat + (17.8 - last.lat) * f, lon: last.lon + (8.4 - last.lon) * f, alt: 41000, gs: 491, trk: 172 }); }
  const pos = all[all.length - 1], vie = E.byIcao('LOWW'), bud = E.byIcao('LHBP');
  const hist = []; for (let k = 0; k < 12; k++) { const t = pos.t - (40 - 3 * k) * 86400; hist.push({ from: { id: vie.id, code: 'VIE' }, to: { id: E.byIcao('LFPB').id, code: 'LBG' }, tStart: t, tEnd: t + 6000, ended: true, how: 'ground' }, { from: { id: E.byIcao('LFPB').id, code: 'LBG' }, to: { id: vie.id, code: 'VIE' }, tStart: t + 40000, tEnd: t + 46000, ended: true, how: 'ground' }); }
  const r = E.predict({ ac: { hex: j.icao, type: 'GLEX', reg: 'OE-LAD' }, pos, trail: all.filter((p, k) => k % 10 === 0), hs: E.histStats(hist, pos.t), now: pos.t, origin: { airport: bud, conf: 'ground', departedAt: leg.start.t }, fleet: new Map([[vie.id, 500]]) });
  const pOf = c => Math.round(100 * ((r.cands.find(x => x.airport.code === c) || {}).p || 0));
  check('AOJ1A heading south over Niger: not "back" to its base Vienna, nor Budapest (whatever its log and fleet say)', pOf('VIE') <= 1 && pOf('BUD') <= 1, { top: r.cands.slice(0, 4).map(c => c.airport.code + ' ' + Math.round(c.p * 100)), vie: pOf('VIE'), bud: pOf('BUD') });
}
// 10) SP-TCU (Tecnam P2008, BNI6RM, 27 Sep): an hour of circuits at Lodz - touch-and-goes, stop-and-goes, low
//     approaches. One flight in its log (not one per lap), and "flying circuits at LCJ" from the second pass on.
{
  const j = fx('sptcu_2026-09-27.json'), pts = E.parseTrace(j), lcj = E.byIcao('EPLL');
  const legs = E.legsFromPoints(pts.map(p => Object.assign({}, p)), {}), sums = legs.map(l => E.summarizeLeg(l, null));
  const main = legs.find(l => l.pts.length > 500), ms = main ? E.summarizeLeg(main, null) : null;
  check('SP-TCU circuits at Lodz: one flight in the log, laps counted (was six LCJ -> LCJ flights)', !!main && main.laps >= 5 && ms.from && ms.to && ms.from.id === lcj.id && ms.to.id === lcj.id && legs.filter(l => l.pts.length > 50).length === 1, sums.map(s => `${s.from ? s.from.code : '?'}>${s.to ? s.to.code : '?'}`).concat(main ? ['laps ' + main.laps] : []));
  const all = main ? [main.start].concat(main.pts) : [], at = hhmm => { const d0 = Math.floor(all[0].t / 86400) * 86400, [h, m] = hhmm.split(':').map(Number); let i = all.findIndex(p => p.t >= d0 + h * 3600 + m * 60); return i < 1 ? null : i; };
  const probe = hhmm => { const i = at(hhmm); if (!i) return null; const trail = all.slice(0, i + 1).filter((p, k) => k % 3 === 0); const c = E.circuits(trail, all[i], {}); return c ? c.airport.code + ' laps ' + c.laps : '-'; };
  const r = { climbOut: probe('17:16'), downwind2: probe('17:32'), final5: probe('17:53'), downwind8: probe('18:15') };
  check('SP-TCU: "flying circuits at LCJ" on the downwind and final - not just after take-off', r.climbOut === '-' && /^LCJ/.test(r.downwind2 || '') && /^LCJ/.test(r.final5 || '') && /^LCJ laps [6-9]/.test(r.downwind8 || ''), r);
}
// 11) LX-FBC (PC-24, Antwerp-based, 27 Sep): in at Nice that morning, first seen at 10,300 ft climbing north of it in
//     the evening. The climb alone fitted La Mole (LTT) best; where it last landed decides - and with Nice, its
//     Nice -> Antwerp habit and the return leg put Antwerp far ahead.
{
  const j = fx('lxfbc_2026-09-27.json'), pts = E.parseTrace(j), nce = E.byIcao('LFMN'), anr = E.byIcao('EBAW');
  const f = pts[0], day = 86400, mk = (a, b, t0, t1) => ({ from: { id: a.id, conf: 'ground' }, to: { id: b.id, conf: 'ground' }, tStart: t0, tEnd: t1, ended: true, how: 'ground' });
  const hist = [mk(anr, nce, f.t - 9 * day - 30000, f.t - 9 * day - 25000), mk(nce, anr, f.t - 7 * day - 30000, f.t - 7 * day - 25000), mk(anr, nce, f.t - 5 * day - 30000, f.t - 5 * day - 25000), mk(nce, anr, f.t - 4 * day - 30000, f.t - 4 * day - 25000), mk(anr, nce, f.t - 30000, f.t - 25000)];
  const hs = E.histStats(hist, f.t), ac = { hex: '4d024a', type: 'PC24', reg: 'LX-FBC' };
  const trail = pts.slice(0, 20), pos = trail[trail.length - 1];
  const o = E.inferOrigin({ ac, pos, trail, hs, now: pos.t });
  const r = E.predict({ ac, pos, trail, hs, now: pos.t, origin: o });
  check('LX-FBC first seen climbing north of Nice, where it landed that morning: from Nice, going home to Antwerp (top, 70%+)', o && o.airport && o.airport.id === nce.id && r.cands[0].airport.id === anr.id && r.cands[0].p >= 0.7, { origin: o && o.airport && o.airport.code, note: o && o.note, top: r.cands.slice(0, 3).map(c => c.airport.code + ' ' + Math.round(c.p * 100)), why: r.cands[0].why.concat(r.cands[0].reasons) });
}
// 12) G-BORL (PA-28, 24 Sep): a local flight out of Breighton into a strong wind - 2,100 ft at 39 kt over the ground.
//     Under 40 kt used to count as "on the ground" up to 2,500 ft above the nearest field: the flight became three,
//     two of them from nowhere (58% of the "landings" of European light aircraft that autumn were like that).
{
  const j = fx('gborl_2026-09-24.json'), legs = E.legsFromPoints(E.parseTrace(j), {}), sums = legs.map(l => E.summarizeLeg(l, null));
  const aft = sums.filter(s => s.tStart >= Math.floor(s.tStart / 86400) * 86400 + 14 * 3600 && s.tStart < Math.floor(s.tStart / 86400) * 86400 + 15.5 * 3600);
  check('G-BORL flying slowly into the wind at 2,100 ft: one local flight, not three (no landing in mid-air)', aft.length === 1 && aft[0].from && aft[0].from.code === 'QKM', sums.map(s => `${new Date(s.tStart * 1000).toISOString().slice(11, 16)} ${s.from ? s.from.code : '?'}>${s.to ? s.to.code : '?'}`));
}
// 13) 22.10: conditions at the field. LX-FBC climbing out of Nice towards Antwerp (as in 11): Antwerp closed by NOTAM at
//     the arrival time takes it out; a 40 kt crosswind there (gusting 45) beyond a light jet's limit counts against it;
//     its METAR wind decides which runway ends the approach geometry uses (a tailwind runway is not being landed on).
{
  const j = fx('lxfbc_2026-09-27.json'), pts = E.parseTrace(j), nce = E.byIcao('LFMN'), anr = E.byIcao('EBAW');
  const f = pts[0], day = 86400, mk = (a, b, t0, t1) => ({ from: { id: a.id, conf: 'ground' }, to: { id: b.id, conf: 'ground' }, tStart: t0, tEnd: t1, ended: true, how: 'ground' });
  const hist = [mk(anr, nce, f.t - 9 * day - 30000, f.t - 9 * day - 25000), mk(nce, anr, f.t - 7 * day - 30000, f.t - 7 * day - 25000), mk(anr, nce, f.t - 5 * day - 30000, f.t - 5 * day - 25000), mk(nce, anr, f.t - 4 * day - 30000, f.t - 4 * day - 25000), mk(anr, nce, f.t - 30000, f.t - 25000)];
  const hs = E.histStats(hist, f.t), ac = { hex: '4d024a', type: 'PC24', reg: 'LX-FBC' }, trail = pts.slice(0, 20), pos = trail[trail.length - 1];
  const o = E.inferOrigin({ ac, pos, trail, hs, now: pos.t });
  const pOf = (r, code) => { const c = r.cands.find(x => x.airport.id === anr.id); return c ? Math.round(c.p * 100) : 0; };
  const base = E.predict({ ac, pos, trail, hs, now: pos.t, origin: o });
  const closed = E.predict({ ac, pos, trail, hs, now: pos.t, origin: o, closed: new Map([['EBAW', [{ from: pos.t - 3600, to: pos.t + 12 * 3600 }]]]) });
  const rw = anr.rw && anr.rw[0] ? anr.rw[0][2] : 110, xw = E.predict({ ac, pos, trail, hs, now: pos.t, origin: o, wx: new Map([['EBAW', { cat: 'VFR', ws: 40, wd: (rw + 90) % 360, gust: 45 }]]) });
  check('Antwerp closed by NOTAM at the arrival time: no longer the answer (was ' + pOf(base) + '%)', pOf(closed) < 5 && closed.cands[0].airport.id !== anr.id, { before: pOf(base), closed: pOf(closed), top: closed.cands.slice(0, 3).map(c => c.airport.code + ' ' + Math.round(c.p * 100)) });
  // more than an hour out: the TAF period covering the arrival, not the METAR now (calm now, a gale forecast for then)
  const tafAt = E.predict({ ac, pos, trail, hs, now: pos.t, origin: o, wx: new Map([['EBAW', { cat: 'VFR', ws: 3, wd: 0, taf: [{ from: pos.t - 3600, to: pos.t + 3000, cat: 'VFR', ws: 4, wd: 0 }, { from: pos.t + 3000, to: pos.t + 9 * 3600, cat: 'VFR', ws: 40, wd: (rw + 90) % 360, gust: 45 }] }]]) });
  check('arriving in over an hour: the forecast for then (a crosswind gale) counts, not the calm METAR now', pOf(tafAt) < pOf(base), { before: pOf(base), forecast: pOf(tafAt) });
  check('a 40 kt crosswind across all its runways at Antwerp counts against it, and says so', pOf(xw) < pOf(base) && closed.cands.length && (xw.cands.find(c => c.airport.id === anr.id) || { why: [] }).why.some(w => /crosswind/.test(w)), { before: pOf(base), crosswind: pOf(xw) });
  // runway in use: a point 8 km out on the extended centreline of one runway end, heading down it - lined up; with 20 kt
  // blowing from behind on that runway, that end is not in use (the fit falls back to the others)
  const e = (anr.rw || []).find(x => x[0] != null);
  if (e) {
    const [la, lo] = E.destPoint(e[0], e[1], (e[2] + 180) % 360, 8), p2 = { lat: la, lon: lo, trk: e[2], alt: 2500 };
    const calm = E.runwayFit(anr, p2)[0], tail = E.runwayFit(anr, p2, { ws: 20, wd: (e[2] + 180) % 360 })[0];
    check('runway in use from the wind: lined up with a runway end that has a 20 kt tailwind is not a fit', calm > 0.8 && tail < calm, { calm: +calm.toFixed(2), tailwind: +tail.toFixed(2) });
  }
}
// 1.1.1) OK-NLV (G700, 49D6A5), 30 Oct: first heard over Labrador at FL470 by satellite, 252° at 482 kt - its log SAV -> SNN
//     -> PRG, down at Prague 27 Oct 11:36Z. Its departure was "unknown, first seen at FL470": the heading was compared with
//     the course it would have set off from Prague on (310°), not the great circle's course where it is (245°). Heading
//     the other way - back towards Prague - Prague is not where it came from.
{
  const sav = E.byIcao('KSAV'), snn = E.byIcao('EINN'), prg = E.byIcao('LKPR'), t = Date.UTC(2026, 9, 30, 15, 0) / 1000, at = (d, h, m) => Date.UTC(2026, 9, d, h, m) / 1000;
  const mk = (a, b, t0, t1) => ({ from: { id: a.id, conf: 'ground' }, to: { id: b.id, conf: 'ground' }, tStart: t0, tEnd: t1, ended: true, how: 'ground' });
  const hs = E.histStats([mk(sav, snn, at(27, 1, 34), at(27, 7, 45)), mk(snn, prg, at(27, 9, 40), at(27, 11, 36))], t), ac = { hex: '49d6a5', type: 'GA7C', reg: 'OK-NLV' };
  const fly = trk => { const p = { t, lat: 57.0, lon: -61.5, alt: 47000, gs: 482, trk, gnd: false }; return E.inferOrigin({ ac, pos: p, trail: [p], hs, now: t }); };
  const west = fly(252), east = fly(70);
  check('OK-NLV first heard over Labrador at FL470 heading 252°, last down at Prague three days before: from Prague (its log)', !!(west && west.airport && west.airport.id === prg.id), west && { a: west.airport && west.airport.icao, note: west.note });
  check('... heading 070° (towards Prague): not from Prague', !(east && east.airport && east.airport.id === prg.id), east && { a: east.airport && east.airport.icao, note: east.note });
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;
