'use strict';
// (1.3) An airport's weather now, for an airport FR24 has none for - one that sends no METAR (Barrow/Walney: FR24's panel
// "N/A" under Conditions, Temperature and Wind): the live weather at the airport itself, and a METAR made from it.
//   - the weather: Open-Meteo's current conditions at the airport (its best model for the place - ECMWF / UKMO / ICON /
//     GFS, updated every 15 minutes; free, non-commercial, CC BY 4.0), kept 15 minutes an airport, at most 20 asked a
//     minute and 1,500 a day (well inside Open-Meteo's free limits beside wx.cjs's own use)
//   - the report: written as a METAR is - the airport's code, the time, AUTO, wind, visibility, weather, cloud,
//     temperature / dew point, QNH - with RMK MODEL: never a station's own report, never another airport's
// The answer: { v, ap, icao, name, lat, lon (the airport's), src: 'model', t (the weather's time), cond (FR24's word:
// clear, cloudy, overcast, fog, drizzle, rain, snow, thunderstorm), tempC, dewC, rh, wdir (from, deg), wkts, gust, hpa,
// visM, clouds [[FEW|SCT|BKN|OVC, base ft]], metar (the report made here) }
const fin = v => typeof v === 'number' && isFinite(v);

// FR24's words for the weather (its sky_condition list), from the WMO weather code and the cloud cover
function condOfCode(code, cover) {
  if (code >= 95) return 'thunderstorm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3 || (fin(cover) && cover >= 88)) return 'overcast';
  if (code === 1 || code === 2 || (fin(cover) && cover >= 25)) return 'cloudy';
  return 'clear';
}
// the METAR's weather group from the WMO code (and mist where the visibility is down with nothing falling)
const WX_OF_CODE = { 45: 'FG', 48: 'FZFG', 51: '-DZ', 53: 'DZ', 55: '+DZ', 56: '-FZDZ', 57: 'FZDZ', 61: '-RA', 63: 'RA', 65: '+RA', 66: '-FZRA', 67: 'FZRA', 71: '-SN', 73: 'SN', 75: '+SN', 77: 'SG',
  80: '-SHRA', 81: 'SHRA', 82: '+SHRA', 85: '-SHSN', 86: '+SHSN', 95: 'TSRA', 96: 'TSGR', 99: '+TSGR' };
// relative humidity (%) from temperature and dew point (Magnus)
const rhOf = (t, d) => fin(t) && fin(d) ? Math.max(0, Math.min(100, Math.round(100 * Math.exp((17.625 * d) / (243.04 + d)) / Math.exp((17.625 * t) / (243.04 + t))))) : null;
// cloud amount (%) as a METAR gives it: FEW 1-2 eighths, SCT 3-4, BKN 5-7, OVC 8
const okta = p => !fin(p) || p < 7 ? '' : p < 32 ? 'FEW' : p < 57 ? 'SCT' : p < 94 ? 'BKN' : 'OVC';
// the cloud layers: the model's low, middle and high cloud, each at a base - the low one where rising air would cloud over
// (about 400 ft for each degree between temperature and dew point, 200 ft at least), the middle one at 8,000 ft, the high
// one at 25,000 ft; a layer no more than the one below it left out
function cloudsOf(c, tC, dC) {
  const out = [], low = fin(tC) && fin(dC) ? Math.max(200, Math.min(6000, Math.round((tC - dC) * 400 / 100) * 100)) : 2000;
  let last = 0;
  for (const [p, base] of [[c.cloud_cover_low, low], [c.cloud_cover_mid, 8000], [c.cloud_cover_high, 25000]]) {
    const a = okta(p); if (!a) continue;
    const rank = ['FEW', 'SCT', 'BKN', 'OVC'].indexOf(a); if (rank < last && out.length) continue;
    out.push([a, base]); last = rank; if (a === 'OVC') break;
  }
  // (no layers given - the basic answer: the total cover, at the low base)
  if (!out.length && !fin(c.cloud_cover_low) && fin(c.cloud_cover) && okta(c.cloud_cover)) out.push([okta(c.cloud_cover), low]);
  return out;
}
const pad = (n, k) => String(Math.max(0, Math.round(n))).padStart(k, '0');
const tempGroup = v => (v < 0 ? 'M' : '') + pad(Math.abs(Math.round(v)), 2);
// visibility in metres as a METAR gives it: 9999 for 10 km or more; 50 m steps below 800 m, 100 m below 5 km, 1 km above
const visGroup = m => !fin(m) ? '' : m >= 9999 ? '9999' : pad(m < 800 ? Math.floor(m / 50) * 50 : m < 5000 ? Math.floor(m / 100) * 100 : Math.floor(m / 1000) * 1000, 4);
// the report, from the weather as kept
function metarOf(code, w) {
  const d = new Date(w.t * 1000), parts = [code, pad(d.getUTCDate(), 2) + pad(d.getUTCHours(), 2) + pad(d.getUTCMinutes(), 2) + 'Z', 'AUTO'];
  if (fin(w.wkts)) {
    const kt = Math.round(w.wkts), dir = kt < 1 ? 0 : (Math.round((w.wdir || 0) / 10) * 10) % 360 || 360;
    parts.push(kt < 1 ? '00000KT' : pad(dir, 3) + pad(kt, 2) + (fin(w.gust) ? 'G' + pad(w.gust, 2) : '') + 'KT');
  }
  const wx = w.wx || '', cavok = (!fin(w.visM) || w.visM >= 9999) && !wx && w.clouds.every(c => c[1] >= 5000 && c[0] !== 'CB');
  if (cavok && fin(w.visM)) parts.push('CAVOK');
  else {
    parts.push(visGroup(w.visM) || '////');
    if (wx) parts.push(wx);
    if (w.clouds.length) for (const c of w.clouds) parts.push(c[0] + pad(Math.min(999, Math.round(c[1] / 100)), 3));
    else parts.push('NCD');
  }
  if (fin(w.tempC) && fin(w.dewC)) parts.push(tempGroup(w.tempC) + '/' + tempGroup(Math.min(w.dewC, w.tempC)));
  if (fin(w.qnh)) parts.push('Q' + pad(Math.floor(w.qnh), 4));
  parts.push('RMK MODEL');
  return parts.join(' ');
}

function createApWx(env) {
  const { E } = env, fetchFn = env.fetch, now = env.now || (() => Date.now());
  const ttlS = env.ttlS || 900, perMin = env.perMin || 20, perDay = env.perDay || 1500;
  const stats = { asked: 0, made: 0, held: 0, fails: 0, lastErr: '', today: '', used: 0, basic: false };
  const kept = new Map(), busy = new Map(), sent = [];
  // (the full list; should Open-Meteo refuse any of it, the basic list from then on - visibility and the cloud layers
  // left out of the report)
  const FULL = 'temperature_2m,relative_humidity_2m,dew_point_2m,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility';
  const BASIC = 'temperature_2m,relative_humidity_2m,dew_point_2m,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
  function mayAsk(ms) {
    const day = new Date(ms).toISOString().slice(0, 10); if (stats.today !== day) { stats.today = day; stats.used = 0; }
    while (sent.length && ms - sent[0] > 60000) sent.shift();
    return sent.length < perMin && stats.used < perDay;
  }
  async function ask(ap, vars, ms) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${ap.lat.toFixed(4)}&longitude=${ap.lon.toFixed(4)}&current=${vars}&wind_speed_unit=kn&timeformat=unixtime&timezone=GMT`;
    sent.push(ms); stats.used++;
    const r = await fetchFn(url, { headers: { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    return { status: r.status, j: r.status === 200 ? JSON.parse(await r.text()) : null };
  }
  async function model(ap, ms) {
    let a = await ask(ap, stats.basic ? BASIC : FULL, ms);
    if (a.status === 400 && !stats.basic) { stats.basic = true; a = await ask(ap, BASIC, ms); }
    if (a.status !== 200) throw new Error('HTTP ' + a.status);
    const c = a.j && a.j.current; if (!c || !fin(c.temperature_2m)) throw new Error('no current weather');
    return made(ap, c, ms);
  }
  // (the weather as answered, put in the answer's form and its report written)
  function made(ap, c, ms) {
    const kts = fin(c.wind_speed_10m) ? Math.round(c.wind_speed_10m) : null, tempC = Math.round(c.temperature_2m * 10) / 10, dewC = fin(c.dew_point_2m) ? Math.round(c.dew_point_2m * 10) / 10 : null;
    const code = fin(c.weather_code) ? c.weather_code : 0;
    let visM = fin(c.visibility) ? Math.round(c.visibility) : null;
    if ((code === 45 || code === 48) && !(visM < 1000)) visM = fin(visM) ? 800 : null;   // (fog: under a kilometre, whatever the model's figure)
    let wx = WX_OF_CODE[code] || '';
    if (!wx && fin(visM) && visM < 5000 && visM >= 1000) wx = 'BR';
    const w = { v: 1, ap: ap.id, icao: ap.icao || '', name: ap.name || '', lat: ap.lat, lon: ap.lon, src: 'model', t: fin(c.time) ? c.time : Math.round(ms / 1000),
      cond: condOfCode(code, c.cloud_cover), tempC, dewC, rh: fin(c.relative_humidity_2m) ? Math.round(c.relative_humidity_2m) : rhOf(tempC, dewC),
      wdir: kts === 0 ? 0 : fin(c.wind_direction_10m) ? Math.round(c.wind_direction_10m) % 360 : null, wkts: kts,
      gust: fin(c.wind_gusts_10m) && kts !== null && c.wind_gusts_10m >= kts + 10 ? Math.round(c.wind_gusts_10m) : null,
      hpa: fin(c.pressure_msl) ? Math.round(c.pressure_msl) : null, visM, wx, clouds: cloudsOf(c, tempC, dewC) };
    // (QNH as a METAR gives it: whole hectopascals, rounded down)
    Object.defineProperty(w, 'qnh', { value: fin(c.pressure_msl) ? c.pressure_msl : null, enumerable: false });
    w.metar = metarOf(String(ap.icao || ap.iata || ap.code || 'ZZZZ').toUpperCase(), w);
    return w;
  }
  // the airport's weather now (a promise; null: nothing to give)
  function answer(apId) {
    const ap = E.byId(apId); if (!ap || !fin(ap.lat) || !fin(ap.lon)) return Promise.resolve(null);
    const ms = now(), nowS = ms / 1000; stats.asked++;
    const k = kept.get(apId); if (k && nowS - k.at < ttlS) return Promise.resolve(k.v);
    if (busy.has(apId)) return busy.get(apId);
    if (typeof fetchFn !== 'function' || !mayAsk(ms)) { stats.held++; return Promise.resolve(k ? k.v : null); }
    const p = model(ap, ms).then(v => { stats.made++; kept.set(apId, { at: nowS, v }); if (kept.size > 5000) kept.delete(kept.keys().next().value); return v; },
      e => { stats.fails++; stats.lastErr = String(e && e.message || e).slice(0, 120); return k ? k.v : null; }).finally(() => busy.delete(apId));
    busy.set(apId, p); return p;
  }
  return { answer, stats, made, _kept: kept };
}
module.exports = { createApWx, condOfCode, rhOf, metarOf, cloudsOf };
