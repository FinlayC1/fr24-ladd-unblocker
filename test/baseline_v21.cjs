// Faithful port of the v21 userscript's destination logic (predictDestination + approachDestination + the choice made
// in composeRoute/quickRoute), so the replay bench can score the old behaviour against the same flights.
// Only the time source and the airport list are injected.
module.exports = function makeV21(airportRows) {
  const NM_KM = 1.852;
  let NOW = 0; const now = () => NOW * 1000;
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  function haversineKm(lat1, lon1, lat2, lon2) { const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2; return 12742 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
  function bearingDeg(lat1, lon1, lat2, lon2) { const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2)); const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1)); return (deg(Math.atan2(y, x)) + 360) % 360; }
  const angDiff = (a, b) => { let d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };
  const airports = { list: airportRows.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon) && a.id).map(a => ({ id: a.id, iata: clean(a.iata), icao: clean(a.icao), name: clean(a.name), city: clean(a.city), country: clean(a.country), lat: a.lat, lon: a.lon, alt: Number(a.alt) || 0, size: Number(a.size) || 0 })), byId: new Map() };
  for (const a of airports.list) airports.byId.set(a.id, a);
  function nearestAirport(lat, lon, maxKm, opts) {
    let best = null, bestScore = Infinity;
    const trk = opts && opts.trk, ahead = opts && opts.ahead, alt = opts && opts.alt, maxAgl = opts && opts.maxAgl, minSize = (opts && opts.minSize) || 0;
    for (const a of airports.list) {
      if (Math.abs(a.lat - lat) > maxKm / 100 + 0.05) continue;
      if (a.size < minSize) continue;
      if (Number.isFinite(alt) && Number.isFinite(maxAgl) && alt - a.alt > maxAgl) continue;
      const d = haversineKm(lat, lon, a.lat, a.lon);
      if (d > maxKm) continue;
      let score = d - Math.min(4, Math.log10(1 + a.size) * 0.5);
      if (ahead && Number.isFinite(trk) && d > 2) { const off = angDiff(trk, bearingDeg(lat, lon, a.lat, a.lon)); if (off > 60) continue; score += off / 10; }
      if (score < bestScore) { bestScore = score; best = { airport: a, dist: Math.round(d * 10) / 10 }; }
    }
    return best;
  }
  const airportKey = a => a ? (a.iata || a.icao || String(a.id)) : '';
  const TYPE_RANGE_NM = { GLF6: 6000, GL7T: 7700, GLF5: 6500, GLF4: 4200, G280: 3600, GL5T: 5200, GLEX: 6000, GLF3: 3600, GA5C: 6000, GA6C: 7000, CL60: 3800, CL64: 4000, CL35: 3200, CL30: 3100, C68A: 1700, C56X: 2000, C25A: 1300, C25B: 1600, C25C: 2000, C750: 3000, C700: 3500, C510: 1000, C525: 1200, C550: 1500, C560: 1700, C650: 2000, C680: 2700, E55P: 2000, E545: 2400, E550: 2900, E35L: 3900, LJ31: 1400, LJ35: 2000, LJ40: 1700, LJ45: 1700, LJ55: 2000, LJ60: 2400, LJ75: 2000, H25B: 2500, HA4T: 2500, F2TH: 3300, FA7X: 5900, FA8X: 6400, F900: 4700, FA50: 3100, FA6X: 5500, FA10: 1500, FA20: 2000, ASTR: 3000, WW24: 2000, PRM1: 1200, BE40: 1500, PC12: 1800, PC24: 2000, TBM7: 1400, TBM8: 1500, TBM9: 1700, B350: 1800, BE20: 1500, BE9L: 1300, BE58: 1400, BE36: 900, C208: 1000, SF50: 1200, C172: 700, C182: 900, C206: 800, C210: 1000, SR22: 1000, SR20: 800, PA46: 1300, P46T: 1300, M600: 1500, DA62: 1200, DA42: 1100, DA40: 900, PA31: 1000, PA32: 800, PA28: 700, B06: 350, EC35: 350, EC30: 300, EC45: 350, A139: 500, A109: 450, S76: 400, B429: 400, B407: 350, B412: 400, R44: 300, R66: 350, AS50: 350, H60: 300, BBJ: 6000, B738: 3000, B737: 2900, A319: 3700, A320: 3300, E190: 2400, CRJ2: 1700, GA8: 700, KODI: 1100 };
  const HEAVY_JETS = new Set(['GLF6', 'GL7T', 'GLF5', 'GLF4', 'G280', 'GL5T', 'GLEX', 'GLF3', 'GA5C', 'GA6C', 'CL60', 'CL64', 'FA7X', 'FA8X', 'F900', 'FA6X', 'BBJ', 'B738', 'B737', 'A319', 'A320', 'E190', 'CRJ2', 'E35L']);
  const HELIS = new Set(['B06', 'EC35', 'EC30', 'EC45', 'A139', 'A109', 'S76', 'B429', 'B407', 'B412', 'R44', 'R66', 'AS50', 'H60', 'B06T', 'EC20', 'H160', 'A169', 'S92', 'B505', 'AS65', 'EC55', 'B430']);
  const PROPS = new Set(['PC12', 'PC24x', 'TBM7', 'TBM8', 'TBM9', 'B350', 'BE20', 'BE9L', 'BE58', 'BE36', 'C208', 'C172', 'C182', 'C206', 'C210', 'SR22', 'SR20', 'PA46', 'P46T', 'M600', 'DA62', 'DA42', 'DA40', 'PA31', 'PA32', 'PA28', 'GA8', 'KODI', 'C150', 'C152', 'C177', 'PA44', 'BE55', 'BE76', 'PA34', 'AC50', 'AC90', 'AC95', 'SW4', 'E120', 'AT72', 'DH8D', 'DHC6', 'C441', 'P180', 'PAY2', 'PAY3', 'C425']);
  function typeClass(t) { t = clean(t).toUpperCase(); if (!t) return 'unknown'; if (HELIS.has(t)) return 'heli'; if (HEAVY_JETS.has(t)) return 'heavy'; if (PROPS.has(t)) return 'prop'; const r = TYPE_RANGE_NM[t]; if (r != null) return r >= 1000 ? 'jet' : 'prop'; return /^(GL|GLF|CL|FA|F9|F2|E5|LJ|C5|C6|C7|H25|HA4|BE4|PRM|ASTR|WW|EA50|SF50|PC24|E35|CRJ|B7|A3)/.test(t) ? 'jet' : 'prop'; }
  const CLASS_MIN_AIRPORT_SIZE = { heavy: 1500, jet: 400, prop: 0, heli: 0, unknown: 0 };
  const typeRangeKm = t => { const r = TYPE_RANGE_NM[clean(t).toUpperCase()]; return r ? r * NM_KM : 0; };
  function endpointAirport(pt, onGround) {
    if (!pt) return null;
    if (pt.gnd || onGround) { const n = nearestAirport(pt.lat, pt.lon, 8); return n ? { airport: n.airport, conf: 'ground', dist: n.dist } : null; }
    if (Number.isFinite(pt.alt)) { const n = nearestAirport(pt.lat, pt.lon, 25, { alt: pt.alt, maxAgl: 6000 }); return n ? { airport: n.airport, conf: n.dist <= 10 && pt.alt - n.airport.alt < 3000 ? 'low' : 'near', dist: n.dist } : null; }
    return null;
  }
  function predictDestination(ctx) {
    const { pos, origin, legs, type, distFlownKm, elapsedMin, departedAt } = ctx;
    const cls = typeClass(type), rangeKm = typeRangeKm(type), minSize = CLASS_MIN_AIRPORT_SIZE[cls] || 0;
    const originKey = origin ? airportKey(origin) : '';
    const visits = new Map(), trans = new Map(), byKey = new Map(), nights = new Map(), lastVisit = new Map(), depDows = new Map(), depHours = new Map();
    for (const l of legs) {
      for (const a of [l.from, l.to]) if (a) { const k = airportKey(a); byKey.set(k, a); visits.set(k, (visits.get(k) || 0) + 1); lastVisit.set(k, Math.max(lastVisit.get(k) || 0, l.tEnd || l.tStart)); }
      if (l.from && l.to) { const k = airportKey(l.from) + '>' + airportKey(l.to); trans.set(k, (trans.get(k) || 0) + 1); const d = new Date(l.tStart * 1000); (depDows.get(k) || depDows.set(k, []).get(k)).push(d.getUTCDay()); (depHours.get(k) || depHours.set(k, []).get(k)).push(d.getUTCHours() + d.getUTCMinutes() / 60); }
    }
    const sorted = legs.filter(l => l.to).sort((a, b) => a.tEnd - b.tEnd);
    for (let i = 0; i < sorted.length; i++) { const next = legs.filter(l => l.tStart > sorted[i].tEnd).sort((a, b) => a.tStart - b.tStart)[0]; if (!next || next.tStart - sorted[i].tEnd > 6 * 3600) { const k = airportKey(sorted[i].to); nights.set(k, (nights.get(k) || 0) + 1); } }
    let base = null, baseScore = 0;
    for (const [k, a] of byKey) { const s = (nights.get(k) || 0) * 2 + (visits.get(k) || 0); if (s > baseScore) { baseScore = s; base = a; } }
    const visited = new Set([...byKey.values()].map(a => a.id));
    const candidates = new Map();
    for (const a of byKey.values()) { const ap = airports.byId.get(a.id); if (ap) candidates.set(ap.id, ap); }
    const airborne = pos && !pos.gnd;
    if (airborne && Number.isFinite(pos.trk) && candidates.size < 12) {
      const maxKm = rangeKm ? Math.max(150, rangeKm - distFlownKm) : 3000, latBand = maxKm / 100 + 0.5;
      const ahead = [];
      for (const a of airports.list) { if (a.size < Math.max(minSize, 800) || Math.abs(a.lat - pos.lat) > latBand) continue; const d = haversineKm(pos.lat, pos.lon, a.lat, a.lon); if (d < 30 || d > maxKm) continue; if (angDiff(pos.trk, bearingDeg(pos.lat, pos.lon, a.lat, a.lon)) > 15) continue; ahead.push(a); }
      ahead.sort((a, b) => b.size - a.size).slice(0, 25).forEach(a => { if (!candidates.has(a.id)) candidates.set(a.id, a); });
    }
    const depDow = departedAt ? new Date(departedAt * 1000).getUTCDay() : -1, depHour = departedAt ? new Date(departedAt * 1000).getUTCHours() + new Date(departedAt * 1000).getUTCMinutes() / 60 : -1;
    const scored = [];
    for (const ap of candidates.values()) {
      if (origin && ap.id === origin.id) continue;
      if (ap.size < minSize && !visited.has(ap.id)) continue;
      const k = airportKey(ap); let s = 0;
      const d = pos ? haversineKm(pos.lat, pos.lon, ap.lat, ap.lon) : 0;
      if (airborne) {
        if (d < 15) continue;
        const off = Number.isFinite(pos.trk) ? angDiff(pos.trk, bearingDeg(pos.lat, pos.lon, ap.lat, ap.lon)) : 0;
        if (off > 40) continue;
        s += 3 * (1 - off / 40);
        if (origin) { const off2 = angDiff(bearingDeg(origin.lat, origin.lon, pos.lat, pos.lon), bearingDeg(origin.lat, origin.lon, ap.lat, ap.lon)); if (off2 > 60 && distFlownKm > 80) continue; if (off2 <= 25) s += 1; }
        if (rangeKm && distFlownKm + d > rangeKm * 0.95) continue;
        const agl = pos.alt - ap.alt;
        if (pos.descending && Number.isFinite(pos.alt)) { const dExp = Math.max(0, agl) / 300 * NM_KM; s += 3 * Math.max(0, 1 - Math.abs(d - dExp) / Math.max(60, dExp)); if (pos.alt < 12000 && d > 200) continue; }
        else if (pos.climbing || (Number.isFinite(pos.alt) && pos.alt < 10000)) { if (d < 80 && cls !== 'heli' && cls !== 'prop') continue; }
        else { if (d < 60) continue; if (Number.isFinite(pos.alt) && pos.alt >= 39000 && d < 150) s -= 1; }
        if (elapsedMin > 90 && Number.isFinite(pos.alt) && pos.alt > 30000 && d < 200) s -= 1.5;
      }
      const nt = trans.get(originKey + '>' + k) || 0, nv = visits.get(k) || 0, nn = nights.get(k) || 0;
      if (nt) s += 3 * Math.min(nt, 3);
      if (nv) s += 0.5 * Math.min(nv, 6);
      if (nn) s += 1.5 * Math.min(nn, 3);
      if (base && base.id === ap.id && origin && base.id !== origin.id) s += 1.5;
      const lv = lastVisit.get(k); if (lv && now() / 1000 - lv < 14 * 86400) s += 1;
      const dows = depDows.get(originKey + '>' + k) || []; if (depDow >= 0 && dows.includes(depDow)) s += 1;
      const hours = depHours.get(originKey + '>' + k) || []; if (depHour >= 0 && hours.some(h => Math.abs(h - depHour) < 1.5)) s += 1;
      s += 0.4 * Math.log10(1 + ap.size);
      scored.push({ airport: ap, score: s, dist: Math.round(d) });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0], second = scored[1];
    let conf = null;
    if (top) conf = top.score >= 6 && (!second || top.score >= 1.4 * second.score) ? 'likely' : top.score >= 3 ? 'possible' : null;
    return { visited, candidate: top && conf ? Object.assign({ conf }, top) : null, tops: scored.slice(0, 4), cls };
  }
  function approachDestination(pos, visited, minSize) {
    if (!pos || !Number.isFinite(pos.alt)) return null;
    const n = nearestAirport(pos.lat, pos.lon, 25, { alt: pos.alt, maxAgl: 3500 });
    if (n) return { airport: n.airport, conf: n.dist <= 10 && pos.alt - n.airport.alt < 1500 ? 'confirmed' : 'probable' };
    if (!pos.descending || pos.alt >= 25000 || !Number.isFinite(pos.trk)) return null;
    let best = null, bestScore = Infinity;
    for (const a of airports.list) {
      const agl = pos.alt - a.alt; if (agl > 15000 || Math.abs(a.lat - pos.lat) > 1.6) continue;
      if (a.size < (minSize || 0) && !(visited && visited.has(a.id))) continue;
      const d = haversineKm(pos.lat, pos.lon, a.lat, a.lon); if (d < 3 || d > 160) continue;
      const off = angDiff(pos.trk, bearingDeg(pos.lat, pos.lon, a.lat, a.lon)); if (off > 45) continue;
      const dExp = agl / 300 * NM_KM;
      const score = Math.abs(d - dExp) / 2 + off / 8 - Math.min(6, Math.log10(1 + a.size) * 0.8) - (visited && visited.has(a.id) ? 6 : 0);
      if (score < bestScore) { bestScore = score; best = { airport: a, dist: Math.round(d) }; }
    }
    if (best && bestScore < 30) return { airport: best.airport, conf: 'probable' };
    return null;
  }
  // inputs mirror what composeRoute had: FR24 trail (for origin + climbing/descending), history legs, type
  function run({ pos, trail, legs, type, nowS }) {
    NOW = nowS;
    const older = (() => { for (let i = trail.length - 1; i >= 0; i--) if (nowS - trail[i].t > 45) return trail[i]; return trail[0]; })();
    const dAlt = older && older.alt != null && pos.alt != null ? pos.alt - older.alt : 0;
    const p = { lat: pos.lat, lon: pos.lon, alt: pos.alt != null ? pos.alt : NaN, trk: pos.trk, spd: pos.gs, gnd: !!pos.gnd, descending: dAlt < -300, climbing: dAlt > 300 };
    const f = trail[0];
    const tro = f ? endpointAirport({ lat: f.lat, lon: f.lon, alt: f.alt != null ? f.alt : 0, gnd: !!f.gnd || f.gs < 50 }, false) : null;
    const origin = tro ? tro.airport : null;
    const cls = typeClass(type);
    const pred = predictDestination({ pos: p, origin, legs, type, distFlownKm: origin ? haversineKm(origin.lat, origin.lon, p.lat, p.lon) : 0, elapsedMin: f ? (nowS - f.t) / 60 : 0, departedAt: f ? f.t : 0 });
    let dest = approachDestination(p, pred.visited, CLASS_MIN_AIRPORT_SIZE[cls] || 0);
    if (!dest) { let cand = pred.candidate; if (cand && p.descending && p.alt < 20000 && cand.dist > 250) cand = null; dest = cand; }
    const tops = pred.tops.map(c => c.airport.id);
    if (dest && !tops.includes(dest.airport.id)) tops.unshift(dest.airport.id);
    else if (dest) { tops.splice(tops.indexOf(dest.airport.id), 1); tops.unshift(dest.airport.id); }
    return { origin, dest: dest ? dest.airport : null, conf: dest ? dest.conf : '', tops };
  }
  return { run };
};
