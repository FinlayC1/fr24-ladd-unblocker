// The figures public ADS-B lacks where no radar asks the aircraft for them (Mode S EHS - true and indicated airspeed,
// Mach, wind, temperature: over most of the US, the oceans, much of the world), worked out from a weather model and the
// aircraft's own ground speed, track and height. The model: NOAA's GFS through Open-Meteo (free, non-commercial, CC BY
// 4.0) - wind and temperature on nine pressure levels, for 5-degree cells, asked for only where such aircraft fly, every
// 12 hours (two days of hourly values a time), a few dozen cells a request, gently. Estimates (typically within ten
// knots and two degrees): an aircraft's own figures always win.
const LEVELS = [850, 700, 600, 500, 400, 300, 250, 200, 150];     // hPa: about FL050 to FL450
const fin = v => typeof v === 'number' && isFinite(v);
const toRad = Math.PI / 180;

// pressure (hPa) at a pressure altitude (ft), the ICAO standard atmosphere
function pressureAt(ft) {
  return ft <= 36089 ? 1013.25 * Math.pow(1 - 6.8756e-6 * ft, 5.2559) : 226.32 * Math.exp(-(ft - 36089) / 20806);
}
// calibrated (indicated) airspeed (kt) from true airspeed (kt), pressure (hPa) and temperature (K) - compressible flow
function casOf(tas, p, tk) {
  const m = tas / (38.967854 * Math.sqrt(tk)), qc = p * (Math.pow(1 + 0.2 * m * m, 3.5) - 1);
  return 661.4786 * Math.sqrt(5 * (Math.pow(qc / 1013.25 + 1, 2 / 7) - 1));
}

function createWx(env) {
  env = env || {};
  const cellDeg = env.cellDeg || 5, everyS = env.everyS || 12 * 3600, gapMs = env.gapMs || 6000, batch = env.batch || 40, dayCap = env.dayCap || 7000;
  const cells = new Map();          // 'lat:lon' -> { at, t: [unix s], lv: [{ p, T: [], u: [], v: [] }] }
  const want = new Map();           // 'lat:lon' -> when asked for
  const stats = { requests: 0, cells: 0, fails: 0, lastErr: '', estimated: 0, missing: 0, today: '', used: 0 };
  let lastAt = 0, busy = false, pausedUntil = 0;
  const keyOf = (lat, lon) => { const a = Math.max(-85, Math.min(85, Math.round(lat / cellDeg) * cellDeg)), o = ((Math.round(lon / cellDeg) * cellDeg + 540) % 360) - 180; return a + ':' + o; };
  const vars = LEVELS.flatMap(p => [`temperature_${p}hPa`, `wind_speed_${p}hPa`, `wind_direction_${p}hPa`]);
  // (Open-Meteo counts a request by its locations and its variables - ten variables one call)
  const weight = n => n * Math.ceil(vars.length / 10);
  function urlOf(keys) {
    const la = keys.map(k => k.split(':')[0]).join(','), lo = keys.map(k => k.split(':')[1]).join(',');
    return `https://api.open-meteo.com/v1/gfs?latitude=${la}&longitude=${lo}&hourly=${vars.join(',')}&wind_speed_unit=kn&forecast_days=2&timeformat=unixtime`;
  }
  // one answer (one location) as kept: per level its temperature and the wind's east / north components (toward)
  function keep(key, j, nowS) {
    const h = j && j.hourly; if (!h || !Array.isArray(h.time) || !h.time.length) return false;
    const lv = [];
    for (const p of LEVELS) {
      const T = h[`temperature_${p}hPa`], S = h[`wind_speed_${p}hPa`], D = h[`wind_direction_${p}hPa`];
      if (!Array.isArray(T) || !Array.isArray(S) || !Array.isArray(D)) continue;
      lv.push({ p, T, u: S.map((s, i) => fin(s) && fin(D[i]) ? -s * Math.sin(D[i] * toRad) : null), v: S.map((s, i) => fin(s) && fin(D[i]) ? -s * Math.cos(D[i] * toRad) : null) });
    }
    if (lv.length < 3) return false;
    cells.set(key, { at: nowS, t: h.time, lv }); want.delete(key);
    return true;
  }
  // the cells asked for, a batch at a time (at most dayCap weighted calls a day; a refusal pauses an hour)
  async function pump(nowMs) {
    nowMs = nowMs || Date.now();
    if (busy || nowMs < pausedUntil || nowMs - lastAt < gapMs || !want.size || typeof env.fetch !== 'function') return 0;
    const day = new Date(nowMs).toISOString().slice(0, 10); if (stats.today !== day) { stats.today = day; stats.used = 0; }
    const keys = [...want.keys()].filter(k => { const c = cells.get(k); return !c || nowMs / 1000 - c.at > everyS; }).slice(0, batch);
    if (!keys.length) { want.clear(); return 0; }
    if (stats.used + weight(keys.length) > dayCap) return 0;
    busy = true; lastAt = nowMs;
    try {
      const r = await env.fetch(urlOf(keys), { headers: { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)', Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      stats.requests++; stats.used += weight(keys.length);
      if (r.status === 429 || r.status === 403) { pausedUntil = nowMs + 3600e3; throw new Error('HTTP ' + r.status); }
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const j = JSON.parse(await r.text()), list = Array.isArray(j) ? j : [j];
      let n = 0; keys.forEach((k, i) => { if (keep(k, list[i], nowMs / 1000)) n++; });
      stats.cells = cells.size;
      return n;
    } catch (e) { stats.fails++; stats.lastErr = String(e.message || e).slice(0, 120); return 0; }
    finally { busy = false; }
  }
  // wind (from, kt) and temperature (C) at a place, a pressure and a moment: the cell's nearest hour, between the two
  // levels around it (in log pressure; the wind as its components). Null when the cell is not in yet - asked for.
  function at(lat, lon, p, nowS) {
    const key = keyOf(lat, lon), c = cells.get(key);
    if (!c || nowS - c.at > everyS) { if (!want.has(key)) want.set(key, nowS); if (want.size > 3000) want.delete(want.keys().next().value); }
    if (!c) return null;
    let i = 0, best = Infinity; for (let k = 0; k < c.t.length; k++) { const d = Math.abs(c.t[k] - nowS); if (d < best) { best = d; i = k; } }
    if (best > 3 * 3600) return null;
    const lv = c.lv.filter(l => fin(l.T[i]) && fin(l.u[i]) && fin(l.v[i])); if (lv.length < 2) return null;
    let a = lv[0], b = lv[0];
    if (p >= lv[0].p) a = b = lv[0];
    else if (p <= lv[lv.length - 1].p) a = b = lv[lv.length - 1];
    else for (let k = 0; k < lv.length - 1; k++) if (p <= lv[k].p && p >= lv[k + 1].p) { a = lv[k]; b = lv[k + 1]; break; }
    const f = a === b ? 0 : (Math.log(a.p) - Math.log(p)) / (Math.log(a.p) - Math.log(b.p)), mix = k => a[k][i] + (b[k][i] - a[k][i]) * f;
    const u = mix('u'), v = mix('v'), T = mix('T');
    return { T, ws: Math.hypot(u, v), wd: (Math.atan2(-u, -v) / toRad + 360) % 360, u, v };
  }
  // a report (readsb row) with what it lacks estimated: only an aircraft in the air, at FL050 and above, at speed,
  // whose own airspeed is not in it. The row as it was when nothing is known (yet).
  function fill(a, nowS) {
    if (!a || fin(a.tas) || fin(a.ias) || fin(a.mach) || !fin(a.alt_baro) || a.alt_baro < 5000 || !fin(a.gs) || a.gs < 100 || !fin(a.track) || !fin(a.lat) || !fin(a.lon)) return a;
    const p = pressureAt(a.alt_baro), w = at(a.lat, a.lon, p, nowS); if (!w) { stats.missing++; return a; }
    const gu = a.gs * Math.sin(a.track * toRad), gv = a.gs * Math.cos(a.track * toRad), tas = Math.hypot(gu - w.u, gv - w.v), tk = w.T + 273.15;
    if (!(tas > 60 && tas < 700) || !(tk > 180 && tk < 330)) return a;
    const mach = tas / (38.967854 * Math.sqrt(tk)), ias = casOf(tas, p, tk);
    stats.estimated++;
    return Object.assign({}, a, { tas: Math.round(tas), ias: Math.round(ias), mach: Math.round(mach * 1000) / 1000, oat: Math.round(w.T), wd: Math.round(w.wd) % 360, ws: Math.round(w.ws), wx: 1 });
  }
  return { fill, at, pump, keyOf, cells, want, stats, pressureAt, casOf, LEVELS };
}
module.exports = { createWx, pressureAt, casOf, LEVELS };
