// (1.2.0) FR24's locked map options, worked natively - the page part of the BUILT userscript in jsdom (the drawing of
// tiles needs a browser's canvas: that is checked on FR24's own front-end in Chromium, not here):
//   - FR24's table of plans per option: "basic" added to the options this script supplies, nothing else; the custom
//     filters a Basic account may keep raised to Business's 60; an export that throws when looked into left alone
//   - FR24's weather "authorization" answered: every product, this script as the tile server, forecast times
//   - the WAFS levels FR24's sliders map to; winds' pressure levels round an altitude
//   - AIRMETs/SIGMETs from aviationweather.gov in FR24's own form; current weather from the METAR file, thinned by zoom
//   - lightning: the strikes kept, those in FR24's bounds and time sent
//   - the FAA's NAT message read into FR24's oceanic tracks
//   - aircraft categories unticked in FR24's filters window taken out of its live feed's request
//   - the switch off: none of it
// usage: node test/unit_mapx.cjs <node_modules dir>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const NM = process.argv[2] || path.join(__dirname, '../node_modules');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const F = require('../monitor/fr24.cjs');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); };

function open(opts, answer) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/51.47,-0.45/8', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window; let H = null;
  w.__tlTestHook = h => { H = h; };
  if (opts) w.localStorage.setItem('tweeks.fr24.ladd.opts1', JSON.stringify(opts));
  w.Response = Response; w.Headers = Headers; w.Blob = Blob; w.DecompressionStream = DecompressionStream;
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.indexedDB = undefined; w.fetch = () => Promise.reject(new Error('offline'));
  const asked = [];
  // (the userscript's side: what the page part asks it to fetch, answered from here)
  w.postMessage = d => {
    if (!d || d.__tweeksLadd !== 'mxGet') return;
    asked.push(d.url);
    Promise.resolve(answer(d.url, d.bin)).then(a => w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'mxGot', rid: d.rid, status: a ? 200 : 404, body: a || null }, source: w, origin: 'https://www.flightradar24.com' })));
  };
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) throw new Error('pageInterceptor not found in the build');
  w.eval('(' + m[0] + ')()');
  return { w, H: () => H, asked };
}

(async () => {
  const now = Date.now();
  const sigmets = [{ icaoId: 'LIIB', firId: 'LIMM', firName: 'LIMM MILANO', validTimeFrom: now / 1000 - 600, validTimeTo: now / 1000 + 7200, hazard: 'TURB', qualifier: 'SEV', base: 20000, top: 34000, geom: 'AREA', coords: [{ lat: 45, lon: 8 }, { lat: 46, lon: 9 }, { lat: 45, lon: 10 }], dir: 'E', spd: 20, rawSigmet: 'LIMM SIGMET 3 VALID ... SEV TURB' },
    { icaoId: 'EGRR', firId: 'EGTT', firName: 'EGTT LONDON', validTimeFrom: now / 1000, validTimeTo: now / 1000 + 3600, hazard: 'TS', qualifier: 'EMBD', top: 38000, geom: 'AREA', coords: [{ lat: 51, lon: -1 }, { lat: 52, lon: 0 }, { lat: 51, lon: 1 }, { lat: 51, lon: -1 }], rawSigmet: 'EGTT SIGMET 1 EMBD TS' }];
  const usSig = [{ icaoId: 'KKCI', seriesId: '66W', airSigmetType: 'SIGMET', hazard: 'CONVECTIVE', severity: 5, altitudeHi1: 28000, movementDir: 180, movementSpd: 20, rawAirSigmet: 'CONVECTIVE SIGMET 66W', validTimeFrom: now / 1000, validTimeTo: now / 1000 + 7200, coords: [{ lat: 37, lon: -116 }, { lat: 37.4, lon: -115 }, { lat: 36.8, lon: -114.8 }] }];
  const csv = 'raw_text,station_id,observation_time,latitude,longitude,temp_c,dewpoint_c,wind_dir_degrees,wind_speed_kt,wind_gust_kt,visibility_statute_mi,altim_in_hg,sea_level_pressure_mb,corrected,auto,auto_station,maintenance_indicator_on,no_signal,lightning_sensor_off,freezing_rain_sensor_off,present_weather_sensor_off,wx_string,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,flight_category\n' +
    [['EGLL', 51.477, -0.461, 10, '-RA', 'BKN', 1300], ['EGKK', 51.148, -0.190, 9, '', 'FEW', 2000], ['EGSS', 51.885, 0.235, 8, 'FG', 'OVC', 200], ['LFPG', 49.01, 2.55, 12, 'TSRA', 'BKN', 3000]]
      .map(([id, la, lo, t, wx, sc, b]) => `"METAR ${id} ...",${id},${new Date(now - 600000).toISOString()},${la},${lo},${t},5,90,5,,6+,30.4,,,,,,,,,,${wx},${sc},${b},,,,,,,VFR`).join('\n');
  const csvGz = zlib.gzipSync(Buffer.from(csv));
  const answer = (url) => {
    if (/airsigmet\?/.test(url)) return JSON.stringify(usSig);
    if (/isigmet\?/.test(url)) return JSON.stringify(sigmets);
    if (/metars\.cache\.csv\.gz/.test(url)) return csvGz.buffer.slice(csvGz.byteOffset, csvGz.byteOffset + csvGz.length);
    return null;
  };
  const P = open(null, answer); await sleep(300);
  const H = P.H;
  check('page-world hook: the map options', !!(H() && H().mxPatchCore && H().mxAuth));
  // ---- FR24's plan table and filter limits
  const plans = ['silver', 'gold', 'business', 'contributor'];
  const table = { 'map.layer.weather.wind': ['business', 'contributor'], 'map.layer.atc': ['gold', 'business', 'contributor'], 'map.layer.tracks.oceanic': plans.slice(1), 'map.view.3d': plans.slice(), 'history.flight.kml': { silver: 10, gold: 25 }, 'map.layer.weather.lightning': ['business', 'contributor'] };
  const limits = { silver: 10, gold: 25, business: 60, contributor: 60 };
  const ns = { ch: table, k2: limits, ii: new Proxy({}, { get() { throw new Error('Cannot use the map wrapper before initialization!'); } }), x: 5, y: [1, 2] };
  H().mxPatchCore(ns);
  check('the options supplied here: "basic" (as FR24\'s page writes it too, "Basic") added to their plans', table['map.layer.weather.wind'].includes('basic') && table['map.layer.weather.wind'].includes('Basic') && table['map.layer.atc'].includes('basic') && table['map.layer.weather.lightning'].includes('basic'), table['map.layer.atc']);
  check('... nothing else: 3D view and KML stay premium', !table['map.view.3d'].includes('basic') && !('basic' in table['history.flight.kml']), table['map.view.3d']);
  check('custom filters a Basic account may keep: 60, as Business', limits.basic === 60 && limits.Basic === 60 && limits.silver === 10, limits);
  check('an export that throws when looked into (FR24\'s map wrapper before the map is made): left alone, no error', H().mx.fails === 0, H().mx);
  // ---- weather authorization
  const auth = await H().mxAuth(), md = auth.data.metadates;
  check('FR24\'s weather authorization answered: this script the tile server, a key and signature, every product', auth.data.endpoints[0] === 'tl-wx.invalid' && auth.data.signature && md['C09-0x0316-0'] && md['gfs-halfdeg-windvector-1kft-msl'] && md['wafs-hires-icing-fl060'] && md.lightning, Object.keys(md).length);
  check('... winds: forecast times every 3 hours for a day; icing/turbulence every 3 hours to 36 h after the run', md['gfs-halfdeg-windvector-1kft-msl'].validTimes.length === 9 && md['wafs-hires-turbulence-fl100'].validTimes.length >= 2 && md['wafs-hires-turbulence-fl100'].validTimes.every(t => !isNaN(Date.parse(t))), { w: md['gfs-halfdeg-windvector-1kft-msl'].validTimes.slice(0, 2), t: md['wafs-hires-turbulence-fl100'].validTimes.slice(0, 2) });
  const r = await (await P.w.fetch('https://www.flightradar24.com/api/v1/weather/auth?platform=web')).json();
  check('... through FR24\'s own request (its fetch): answered here, FR24\'s server never asked', r.data && r.data.key === 'tl');
  // ---- levels
  check('icing at FL100 -> the 697 hPa forecast; turbulence at FL390 -> 197 hPa', H().mxNearest(H().MX_ICE, 100) === 697 && H().mxNearest(H().MX_TURB, 390) === 197);
  const lv = H().mxLevels(37), lv34 = H().mxLevels(34);
  check('winds at 37,000 ft: between the 250 and 200 hPa levels, nearer 200; at 34,000 ft the 250 hPa level itself', lv.a === 250 && lv.b === 200 && lv.w > 0.5 && lv.w < 1 && lv34.a === 250 && lv34.w < 0.01, [lv, lv34]);
  // ---- AIRMETs / SIGMETs
  const as = await H().mxAirsigList();
  const it = as.find(x => /LIMM/.test(x.region_id)), em = as.find(x => /EGTT/.test(x.region_id)), us = as.find(x => x.region_name === 'United States');
  check('AIRMETs/SIGMETs in FR24\'s form: Milan\'s severe turbulence "SEV TURB", FL200-340, its text and times', !!it && it.hazard_type === 'SEV TURB' && it.hazard_severity === 'SEV' && it.altitude_min_value === '20000' && it.altitude_max_value === '34000' && /SEV TURB/.test(it.raw_text) && /UTC$/.test(it.valid_end), it);
  check('... London\'s embedded thunderstorms "EMBD TS"; its outline a closed polygon FR24 can draw', !!em && em.hazard_type === 'EMBD TS' && JSON.parse(em.geometry).type === 'Polygon' && JSON.parse(em.geometry).coordinates[0].length === 4, em && em.geometry);
  check('... the US convective SIGMET, severity 5 -> "SEV", moving 180° at 20 kt', !!us && us.hazard_type === 'CONVECTIVE' && us.hazard_severity === 'SEV' && us.movement_direction_value === '180' && us.movement_speed_value === '20', us);
  // ---- current weather
  const st = await H().mxStations('https://www.flightradar24.com/weather/stations?bbox=-2,53,3,48,9');
  const ll = st.find(x => x.id === 'EGLL'), ss = st.find(x => x.id === 'EGSS'), cg = st.find(x => x.id === 'LFPG');
  check('current weather from the METAR file: Heathrow light rain 10 °C, its symbol drawn here', !!ll && ll.temperature_value === '10' && ll.weather_code === 'tlrain' && /light rain/i.test(ll.weather_text) && typeof ll.daylight === 'boolean', ll);
  check('... Stansted fog, Paris thunderstorm', !!ss && ss.weather_code === 'tlfog' && !!cg && cg.weather_code === 'tlts', [ss && ss.weather_code, cg && cg.weather_code]);
  const st4 = await H().mxStations('https://www.flightradar24.com/weather/stations?bbox=-2,53,3,48,4');
  check('... zoomed out: one station per few degrees - London\'s three airports down to one each side of the meridian', st4.filter(x => /^EG/.test(x.id)).length <= 2 && st.filter(x => /^EG/.test(x.id)).length === 3, st4.map(x => x.id));
  // ---- lightning
  const L = H().mxLx; L.strikes.length = 0; L.strikes.push([now - 3600e3, 51, 0], [now - 60e3, 51.5, -0.5], [now - 30e3, 40, 10]); L.ws = {}; // (no connection here)
  const lj = await (await H().mxLightning(`//adn.velocityweather.com/v1/tl/reports/lightning/region.json?tl=1&n_lat=55&s_lat=48&w_lon=-5&e_lon=5&time_start=${encodeURIComponent(new Date(now - 1680000).toISOString())}`)).json();
  check('lightning: the strikes in FR24\'s bounds since its start time (an hour-old one and one in Italy left out)', lj.lightning.data.length === 1 && lj.lightning.data[0].coordinates[0] === -0.5, lj.lightning.data);
  // ---- NAT tracks
  const nat = H().mxNatParse('<pre>(NAT-1/2 TRACKS FLS 310/390 INCLUSIVE\nOCT 31/1130Z TO OCT 31/1900Z\nPART ONE OF TWO PARTS-\nA PIKIL 57/20 58/30 58/40 57/50 HOIST\nEAST LVLS NIL\nWEST LVLS 310 320 330\nB RESNO 5630/20 5730/30 5730/40 5630/50 NIFTY\nEAST LVLS NIL\nWEST LVLS 340 350\nW 4730/50 4830/40 4930/30 5030/20 SOMAX\nEAST LVLS 320 330 340\nWEST LVLS NIL\n</pre>');
  check('the NAT message read: tracks A, B (west) and W (east), each\'s points in latitude/longitude', nat.A && nat.A.d === 'WEST' && Object.keys(nat.A.p).length === 4 && nat.A.p[0].lat === 57 && nat.A.p[0].lon === -20 && nat.B.p[0].lat === 56.5 && nat.W && nat.W.d === 'EAST' && /OCT 31/.test(nat.A.from), nat);
  // ---- categories in the live feed's request
  const settings = { filters: { deselectedCategories: [0, 1] } }, fake = { _s: new Map([['settings', settings], ['user', { isPremiumUser: false }], ['filters', { deselectedCategories: [] }]]) };
  P.w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: fake } } };
  const req = F.frame(F.liveFeedRequest({ n: 56, s: 50, w: -6, e: 2, limit: 1500 }));
  const out = H().patchLiveFeedRequest(new P.w.Uint8Array(req).buffer);
  const sv = b => { for (const m2 of F.frames(Buffer.from(new Uint8Array(b))).msgs) for (const f of F.parse(m2)) if (f.fn === 2 && f.wt === 2) for (const g of F.parse(f.val)) if (g.fn === 2 && g.wt === 2) return Array.from(g.val); return null; };
  check('Passenger and Cargo unticked in FR24\'s filters window: its live feed asks for the other ten categories', JSON.stringify(sv(out)) === JSON.stringify([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), sv(out));
  settings.filters.deselectedCategories = [];
  const out2 = H().patchLiveFeedRequest(new P.w.Uint8Array(req).buffer);
  check('... none unticked: all twelve, as FR24 asks', JSON.stringify(sv(out2)) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), sv(out2));
  P.w.close();
  // ---- the switch off
  const Q = open({ mapx: false }, answer); await sleep(200);
  const t2 = { 'map.layer.weather.wind': ['business'], 'map.layer.atc': ['gold'] };
  check('switched off in the LADD Unblock window: FR24\'s requests left to FR24, nothing answered here', Q.H().mxFetch('https://www.flightradar24.com/api/v1/weather/auth?platform=web') === null && Q.H().mx.on === false, Q.H().mx);
  check('... and FR24\'s tables untouched (its core module not looked for)', Q.H().mx.opts === 0 && !t2['map.layer.atc'].includes('basic'));
  Q.w.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
