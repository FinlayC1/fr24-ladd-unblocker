// Departure airport: the cases that slipped through before v22.7.
// usage: node test/unit_origin.cjs <airports.json>
const fs = require('fs');
const { createRouteEngine } = require('../src/engine.js');
const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).rows);
let fails = 0;
const check = (name, ok, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); if (!ok) fails++; };
const WDH = E.byIcao('FYWH'), GVA = E.byIcao('LSGG');
const ac = { hex: '4d2018', type: 'FA6X', reg: '9H-DINA' };
const now = 1790330000;
// 1. FR24's own trail, 6 h long, starting on the ground at Windhoek
{
  const trail = [{ t: now - 6 * 3600, lat: WDH.lat, lon: WDH.lon, alt: 0, gs: 10, gnd: true }];
  for (let i = 1; i < 200; i++) { const p = E.destPoint(WDH.lat, WDH.lon, 355, i * 28); trail.push({ t: now - 6 * 3600 + i * 108, lat: p[0], lon: p[1], alt: Math.min(43000, i * 3000), gs: 450, trk: 355 }); }
  const pos = trail[trail.length - 1];
  const o = E.inferOrigin({ ac, pos, trail, hs: E.histStats([], now), now: pos.t });
  check('trail from the ground at Windhoek -> took off from WDH', o && o.airport && o.airport.id === WDH.id, o && { airport: o.airport && o.airport.code, conf: o.conf, note: o.note });
}
// 2. first seen at FL400 far north of Windhoek, heading away from it, after five days parked there
{
  const p = E.destPoint(WDH.lat, WDH.lon, 355, 2500), pos = { t: now, lat: p[0], lon: p[1], alt: 40000, gs: 450, trk: 355 };
  const hist = [{ tStart: now - 6 * 86400, tEnd: now - 5 * 86400, from: { id: GVA.id, conf: 'ground' }, to: { id: WDH.id, conf: 'ground' }, ended: true }];
  const o = E.inferOrigin({ ac, pos, trail: [pos], hs: E.histStats(hist, now), now });
  check('first seen at FL400 after 5 days parked at Windhoek, heading away -> from WDH', o && o.airport && o.airport.id === WDH.id, o && { airport: o.airport && o.airport.code, conf: o.conf, note: o.note });
  // ...but not when it is flying towards Windhoek (that would be a different story: it cannot have come from there)
  const pos2 = Object.assign({}, pos, { trk: 175 });
  const o2 = E.inferOrigin({ ac, pos: pos2, trail: [pos2], hs: E.histStats(hist, now), now });
  check('  (not when it is heading back towards Windhoek)', !(o2 && o2.airport && o2.airport.id === WDH.id), o2 && { airport: o2.airport && o2.airport.code, note: o2.note });
}
// 3. a flight begun before midnight UTC: yesterday's stored log ends with its unfinished first part
{
  const midnight = Math.floor(now / 86400) * 86400;
  const p = E.destPoint(WDH.lat, WDH.lon, 355, 900), pos = { t: midnight + 60, lat: p[0], lon: p[1], alt: 41000, gs: 450, trk: 355 };
  const hist = [{ tStart: midnight - 7200, tEnd: midnight - 30, from: { id: WDH.id, conf: 'ground' }, to: null, ended: false }];
  const o = E.inferOrigin({ ac, pos, trail: [pos], hs: E.histStats(hist, pos.t), now: pos.t });
  check('flight continuing across midnight UTC -> took off from WDH (yesterday\'s track)', o && o.airport && o.airport.id === WDH.id && o.departedAt === midnight - 7200, o && { airport: o.airport && o.airport.code, conf: o.conf, departedAt: o.departedAt });
}
// M-ARNZ, 7 Oct: down at Farnborough 16:14, off again 17:36 - first heard climbing through 1,500 ft over Fairoaks (QKF,
// 16 km on): from Farnborough, where it last landed, not "Woking"
{
  const FAB = E.byIcao('EGLF'), QKF = E.byIcao('EGTF'), t = 1791427000, ac2 = { hex: '424c60', type: 'PC24', reg: 'M-ARNZ' };
  const f = { t, lat: QKF.lat + 0.01, lon: QKF.lon, alt: 1500, gs: 160, trk: 20, vr: 2000 }, g = { t: t + 120, lat: QKF.lat + 0.08, lon: QKF.lon + 0.03, alt: 5000, gs: 220, trk: 20 };
  const hist = [{ tStart: t - 2 * 3600, tEnd: t - 82 * 60, from: { id: E.byIcao('EGNL').id, conf: 'ground' }, to: { id: FAB.id, conf: 'ground' }, ended: true }];
  const o = E.inferOrigin({ ac: ac2, pos: g, trail: [f, g], hs: E.histStats(hist, t + 120), now: t + 120 });
  check('first heard low over Fairoaks 82 min after landing at Farnborough -> from Farnborough', o && o.airport && o.airport.id === FAB.id, o && { airport: o.airport && o.airport.code, conf: o.conf, note: o.note });
  const o2 = E.inferOrigin({ ac: ac2, pos: g, trail: [f, g], hs: E.histStats([], t + 120), now: t + 120 });
  check('  (no landing known: the field it climbs out over, as before)', o2 && o2.airport && o2.airport.id === QKF.id, o2 && { airport: o2.airport && o2.airport.code });
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
