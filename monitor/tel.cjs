// The newest report of every aircraft the monitor hears - any list, any area poll, any lookup - with the figures FR24
// shows a free account only behind a padlock (vertical speed, GPS altitude, airspeeds, Mach, wind, temperature, squawk,
// the autopilot's selected altitude). Served to every browser by address (/tel) and by place (/near): the panel of any
// aircraft clicked has them at once, and the browsers' own requests to the public networks are halved (the view is
// polled from here every other time). Memory only: a report is of no use two minutes on (a parked aircraft's, fifteen).
// (only what the browsers read of a report - the answers of /near stay small: a big area holds a thousand aircraft)
const KEYS = ['hex', 'flight', 'r', 't', 'desc', 'ownOp', 'year', 'lat', 'lon', 'alt_baro', 'alt_geom', 'gs', 'track', 'baro_rate', 'geom_rate', 'squawk', 'ias', 'tas', 'mach', 'oat', 'wd', 'ws', 'nav_qnh', 'nav_altitude_mcp', 'nav_altitude_fms', 'nav_heading', 'dbFlags', 'category', 'emergency'];
const fin = v => typeof v === 'number' && isFinite(v);
const toRad = Math.PI / 180;
function distKm(a1, o1, a2, o2) { const x = (o2 - o1) * toRad * Math.cos((a1 + a2) / 2 * toRad), y = (a2 - a1) * toRad; return Math.sqrt(x * x + y * y) * 6371; }

function createTel(env) {
  env = env || {};
  const max = env.max || 30000, maxAge = env.maxAge || 120, gndAge = env.gndAge || 900;
  const m = new Map();          // hex -> { a: the report (KEYS only), t: its position's time (s), gnd }
  const stats = { added: 0, served: 0, asked: 0, missed: 0 };
  // a list as the readsb APIs answer it (adsb.lol's "ac", adsb.fi's "aircraft"), at the list's own time
  function add(list, nowS) {
    for (const a of list || []) {
      if (!a || !a.hex || !fin(a.lat) || !fin(a.lon) || Math.abs(a.lat) > 90 || Math.abs(a.lon) > 180) continue;
      const raw = String(a.hex).toLowerCase(), hex = raw.replace(/^~/, ''); if (!/^[0-9a-f]{6}$/.test(hex)) continue;
      const t = nowS - (fin(a.seen_pos) ? a.seen_pos : fin(a.seen) ? a.seen : 0), p = m.get(hex);
      if (p && p.t >= t) continue;
      const o = {}; for (const k of KEYS) if (a[k] != null && a[k] !== '') o[k] = a[k];
      o.hex = raw.startsWith('~') ? '~' + hex : hex;
      // (what an older report had that this one lacks - the type, the registration, the squawk a minute ago - kept: the
      // networks send the slow-changing figures only now and then)
      if (p) for (const k of ['r', 't', 'desc', 'category', 'dbFlags', 'squawk', 'oat', 'wd', 'ws', 'nav_qnh']) if (o[k] == null && p.a[k] != null && t - p.t < 300) o[k] = p.a[k];
      m.delete(hex); m.set(hex, { a: o, t, gnd: a.alt_baro === 'ground', own: true });
      stats.added++;
    }
    while (m.size > max) m.delete(m.keys().next().value);
  }
  // What the browsers' own polls of adsb.lol / adsb.fi found (compact rows: [hex, lat, lon, alt ft or "g" on the ground,
  // ground speed kt, track, vertical rate fpm, squawk, GPS alt ft, IAS, TAS, Mach, OAT, wind dir, wind kt, position time
  // s, registration, type, callsign, flags]) - every browser's share served to all the others. Only physical values,
  // only fresh, never over this side's own report of the last minute, and never far from where this side last heard it.
  const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : undefined;
  function addCrowd(rows, nowS) {
    let n = 0;
    for (const r of (Array.isArray(rows) ? rows : []).slice(0, 2000)) {
      if (!Array.isArray(r)) continue;
      const hex = String(r[0] || '').toLowerCase(), lat = num(r[1], -90, 90), lon = num(r[2], -180, 180), t = num(r[15], nowS - 120, nowS + 5);
      if (!/^[0-9a-f]{6}$/.test(hex) || lat === undefined || lon === undefined || t === undefined) { stats.crowdBad = (stats.crowdBad || 0) + 1; continue; }
      const p = m.get(hex);
      if (p && (p.t >= t || (p.own && nowS - p.t < 60))) continue;
      if (p && p.own) { const km = distKm(p.a.lat, p.a.lon, lat, lon), most = (num(p.a.gs, 0, 800) || 600) * 1.852 * (t - p.t) / 3600 + 20; if (km > most) { stats.crowdBad = (stats.crowdBad || 0) + 1; continue; } }
      const sq = /^[0-7]{4}$/.test(String(r[7] || '')) ? String(r[7]) : undefined;
      const a = { hex, lat, lon, alt_baro: r[3] === 'g' ? 'ground' : num(r[3], -2000, 60000), gs: num(r[4], 0, 800), track: num(r[5], 0, 360), baro_rate: num(r[6], -12000, 12000), squawk: sq, alt_geom: num(r[8], -2000, 62000), ias: num(r[9], 0, 600), tas: num(r[10], 0, 700), mach: num(r[11], 0, 1.2), oat: num(r[12], -90, 60), wd: num(r[13], 0, 360), ws: num(r[14], 0, 300),
        r: typeof r[16] === 'string' && r[16].length <= 12 ? r[16] : undefined, t: typeof r[17] === 'string' && r[17].length <= 6 ? r[17] : undefined, flight: typeof r[18] === 'string' && r[18].length <= 8 ? r[18] : undefined, dbFlags: num(r[19], 0, 255) };
      const o = { hex }; for (const k of KEYS) if (a[k] != null && a[k] !== '') o[k] = a[k];
      m.delete(hex); m.set(hex, { a: o, t, gnd: a.alt_baro === 'ground', own: false }); n++;
    }
    while (m.size > max) m.delete(m.keys().next().value);
    stats.crowd = (stats.crowd || 0) + n;
    return n;
  }
  const fresh = (x, nowS) => !!x && nowS - x.t <= (x.gnd ? gndAge : maxAge);
  const out = (x, nowS) => Object.assign({}, x.a, { seen_pos: Math.max(0, Math.round((nowS - x.t) * 10) / 10) });
  // the newest report of each of these addresses, fresh ones only
  function get(hexes, nowS) {
    const rows = [];
    for (const h0 of hexes || []) { stats.asked++; const x = m.get(String(h0).toLowerCase().replace(/^~/, '')); if (fresh(x, nowS)) rows.push(out(x, nowS)); else stats.missed++; }
    stats.served += rows.length;
    return rows;
  }
  // every aircraft within r km of a point, fresh ones only (at most max of them, the nearest first)
  function near(lat, lon, rKm, nowS, limit) {
    const dLat = rKm / 111, dLon = rKm / (111 * Math.max(0.05, Math.cos(lat * toRad))), rows = [];
    for (const x of m.values()) {
      const a = x.a; if (Math.abs(a.lat - lat) > dLat) continue;
      let dl = Math.abs(a.lon - lon); if (dl > 180) dl = 360 - dl; if (dl > dLon) continue;
      if (!fresh(x, nowS)) continue;
      const d = distKm(lat, lon, a.lat, a.lon); if (d <= rKm) rows.push([d, x]);
    }
    rows.sort((p, q) => p[0] - q[0]);
    const res = rows.slice(0, limit || 2000).map(([, x]) => out(x, nowS));
    stats.served += res.length;
    return res;
  }
  function has(hex, nowS) { return fresh(m.get(String(hex).toLowerCase().replace(/^~/, '')), nowS); }
  function prune(nowS) { for (const [h, x] of m) if (nowS - x.t > gndAge) m.delete(h); }
  return { add, addCrowd, get, near, has, prune, stats, get size() { return m.size; } };
}
module.exports = { createTel, KEYS };
