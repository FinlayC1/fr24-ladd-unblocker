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

function open(opts, answer, fetchImpl) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/51.47,-0.45/8', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window; let H = null;
  w.__tlTestHook = h => { H = h; };
  if (opts) w.localStorage.setItem('tweeks.fr24.ladd.opts1', JSON.stringify(opts));
  w.Response = Response; w.Headers = Headers; w.Blob = Blob; w.DecompressionStream = DecompressionStream;
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.indexedDB = undefined; w.fetch = fetchImpl || (() => Promise.reject(new Error('offline')));
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
  check('... nothing else: 3D view stays premium; a flight\'s KML and CSV (1.2.4: made here) a Basic account\'s too', !table['map.view.3d'].includes('basic') && table['history.flight.kml'].basic === 60 && table['history.flight.kml'].silver === 10, table['history.flight.kml']);
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
  const t0 = Date.now(); H().mxNatParse('<pre>A ' + '/'.repeat(40) + '!\n</pre>');
  check('a long line of slashes in the NAT message is read at once, not stuck backtracking', Date.now() - t0 < 200, Date.now() - t0);
  // ---- (1.2.1) the FAA's NAT list (its new NMS feed: a message a part, each with its own validity)
  const nl = H().mxNatList([{ location_code: 'EGGX', start_datetime: 'x', part_no: 1, condition_message: 'NAT-1/1 TRACKS\r\nOCT 31/1130Z TO OCT 31/1900Z\r\nA ETIKI 58/20 59/30 59/40 58/50 PRAWN\r\nEAST LVLS NIL' },
    { location_code: 'CZQX', start_datetime: 'y', part_no: 1, condition_message: 'NAT-1/1 TRACKS\r\nOCT 31/0100Z TO OCT 31/0800Z\r\nU ALLRY 51/50 53/40 54/30 55/20 RESNO\r\nEAST LVLS 340 350' }]);
  check('the FAA\'s NAT list read: Shanwick\'s westbound A and Gander\'s eastbound U, each its own times', nl.A && nl.A.d === 'WEST' && /1130Z/.test(nl.A.from) && nl.U && nl.U.d === 'EAST' && /0100Z/.test(nl.U.from), nl);
  check('FR24\'s own tracks answer taken only when it has tracks ({} or an error message: ours instead)', H().mxTrackOk(nl) && !H().mxTrackOk({}) && !H().mxTrackOk({ message: 'Unauthorized' }));
  // ---- (1.2.1) a blocked flight's panel and search card: asked without the "restriction mode" FR24 refuses a free account
  const rq = new P.w.Uint8Array([0, 0, 0, 0, 7, 0x0d, 1, 2, 3, 4, 0x10, 0x01]).buffer, rs = new Uint8Array(H().stripRestriction(rq));
  check('FlightDetails / FollowFlight: field 2 (restriction mode 1) taken out, the flight id kept, the frame length right', rs.length === 10 && rs[4] === 5 && rs[5] === 0x0d && rs[9] === 4, Array.from(rs));
  const rq0 = new P.w.Uint8Array([0, 0, 0, 0, 5, 0x0d, 1, 2, 3, 4]).buffer;
  check('... a request without it left exactly as it was', H().stripRestriction(rq0) === rq0);
  // ---- (1.2.1) bookmarks: one kept here when FR24's server keeps no more, listed with FR24's own, each once
  P.w.localStorage.setItem('tl.mx.bookmarks', JSON.stringify({ aircraft: [H().mxBmItem({ type: 'aircraft', identifier: 'sp-ceo' })] }));
  const bm = H().mxBmMerge({ data: { aircraft: [{ registration: 'G-ABCD' }], flights: [], airports: [], locations: [] } });
  check('bookmarks: FR24\'s one and the one kept here, together', bm.data.aircraft.length === 2 && bm.data.aircraft[1].registration === 'SP-CEO', bm.data.aircraft);
  const bm2 = H().mxBmMerge({ data: { aircraft: [{ registration: 'SP-CEO' }], flights: [], airports: [], locations: [] } });
  check('... not twice when FR24 has it too', bm2.data.aircraft.length === 1);
  // (1.2.4) FR24's types are plural for flights, airports and places: each kept past the limit, in the form FR24's widget reads
  { const f = H().mxBmItem({ type: 'flights', identifier: 'u23210' }), a = H().mxBmItem({ type: 'airports', identifier: 'ema' }), l = H().mxBmItem({ type: 'locations', location: { name: 'Peak District', lat: 53.35, lon: -1.8, zoom: 9 } });
    check('bookmarks: a flight, an airport and a place kept as FR24 lists them (its plural types), a place with an id FR24 removes it by', f && f.flight_number === 'U23210' && a && a.code.iata === 'EMA' && l && l.id === 'tl-53350_-1800' && l.name === 'Peak District' && l.lat === 53.35 && H().mxBmItem({ type: 'locations', location: {} }) === null, { f, a, l });
    P.w.localStorage.setItem('tl.mx.bookmarks', JSON.stringify({ flights: [f], airports: [a], locations: [l] }));
    const m = H().mxBmMerge({ data: { aircraft: [], flights: [{ flight_number: 'BA1' }], airports: [], locations: [{ id: 99, name: 'Home' }] } }).data;
    check('... and listed with FR24\'s own', m.flights.length === 2 && m.airports.length === 1 && m.locations.length === 2, m); }
  // ---- (1.2.1) the category: SP-CEO's H25B (a Hawker 750) is no helicopter, whatever its transponder says
  check('category: H25B a business jet, its transponder\'s "rotorcraft" not believed; an H60 still a helicopter', H().categoryOf({ type: 'H25B', cat: 'A7' }) === 3 && H().categoryOf({ type: 'H60' }) === 5 && H().categoryOf({ type: 'EC35' }) === 5);
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
  // ---- (1.2.3) cloud from the monitor: one picture per valid time; a tile the monitor did not give is not drawn from
  // EUMETSAT beside the monitor's (squares of two pictures); the source only with no monitor layer at all
  { let ver = 'cA', tileOk = true; const got = [];
    const R = open(null, url => {
      got.push(url);
      if (url === 'mon:/wx/meta') return JSON.stringify({ v: 1, cloud: { ver, maxZ: 5 }, precip: { ver: 'p1', maxZ: 4 } });
      if (/^mon:\/wx\/t\/cloud\//.test(url)) return tileOk ? new Uint8Array([137, 80, 78, 71]).buffer : null;
      return null;
    }); await sleep(200);
    const RH = R.H();
    check('cloud: the version pinned to the valid time it was first drawn with; another time the newest; no time - the newest', RH.mxPinVer('cloud', 1000, 'cA') === 'cA' && RH.mxPinVer('cloud', 1000, 'cB') === 'cA' && RH.mxPinVer('cloud', 2000, 'cB') === 'cB' && RH.mxPinVer('cloud', 0, 'cB') === 'cB');
    const t1 = await RH.mxMonTile('cloud', 5, 16, 10, false, 3000);
    check('... a tile of its zoom: the monitor\'s own bytes, at the pinned picture', !!(t1 && t1.bytes) && got.includes('mon:/wx/t/cloud/cA/5/16/10.png'), got.slice(-3));
    await sleep(500);
    check('... the tiles round it and the world\'s at zooms 0-2 fetched ahead', got.includes('mon:/wx/t/cloud/cA/5/17/10.png') && got.includes('mon:/wx/t/cloud/cA/0/0/0.png'), got.length);
    tileOk = false; let direct = 0;
    const t2 = await RH.mxMonOr('cloud', 5, 3, 3, () => { direct++; return null; }, 3000);
    check('... the monitor failing a tile (twice): nothing from EUMETSAT drawn in its place', t2 === null && direct === 0 && got.filter(u => u === 'mon:/wx/t/cloud/cA/5/3/3.png').length === 2, { direct, t2 });
    R.w.close(); }
  // ---- (1.2.3) Last clicked flights: kept here, given to FR24's widget in its server's form
  { const R = open(null, () => null); await sleep(200); const RH = R.H();
    const store = { selected: null, selectedFlightOriginAirport: { code: { iata: 'LIN', icao: 'LIML' }, city: 'Milan' }, selectedFlightDestinationAirport: null }, lcs = { list: [], setList(l) { this.list = l; } };
    R.w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['aircraft', store], ['lastClickedFlights', lcs], ['playback', { active: false }]]) } } } };
    const open1 = (id, cs, reg) => { store.selected = { flightInfo: { flightId: id, callsign: cs }, aircraftInfo: { reg, type: 'GLF6' }, scheduleInfo: { flightNumber: '' } }; RH.mxLcTick(); };
    open1(1009392385, 'TWY677', 'N999YX'); open1(1009392386, 'RYR6LY', 'EI-DLB'); open1(1009392385, 'TWY677', 'N999YX');
    const j = await (await RH.mxLastClicked('https://www.flightradar24.com/restapi/v1/widgets/last-clicked-flights', {})).json();
    const items = j.last_clicked_flights.items;
    check('last clicked: each flight opened, newest first, once each - in the form FR24\'s widget reads', items.length === 2 && items[0].id === 1009392385 && items[0].callsign === 'TWY677' && items[0].airport.origin.code.iata === 'LIN' && items[0].airport.origin.city === 'Milan' && items[1].registration === 'EI-DLB' && lcs.list.length === 2, items);
    // (1.2.6) a blocked flight: FR24's panel "N/A" as it opens it - then nothing of it once it has landed. Kept named,
    // its aircraft and route from what is known of it here; never written over with "N/A" again
    RH.resolved.set(1009392390, { cs: 'BTX7P', reg: 'D-CVAB', hex: '3c4a8e', type: 'PC24' });
    RH.routes.set(1009392390, { originId: 1, originIata: 'IGS', originCity: 'Ingolstadt', destId: 2, destIata: 'BWE', destCity: 'Braunschweig', landed: true });
    store.selectedFlightOriginAirport = null;
    store.selected = { flightInfo: { flightId: 1009392390, callsign: '' }, aircraftInfo: { reg: '', type: null }, scheduleInfo: { flightNumber: null } }; RH.mxLcTick();
    const b0 = RH.mxLcList()[0];
    check('last clicked: a blocked flight opened while FR24 shows "N/A" - kept with its name, aircraft and route', b0.id === 1009392390 && b0.callsign === 'BTX7P' && b0.registration === 'D-CVAB' && b0.type === 'PC24' && b0.airport.origin.code.iata === 'IGS' && b0.airport.origin.city === 'Ingolstadt' && b0.airport.destination.code.iata === 'BWE', b0);
    RH.resolved.delete(1009392390); RH.routes.delete(1009392390);
    store.selected = { flightInfo: { flightId: 1009392390, callsign: 'N/A' }, aircraftInfo: { reg: 'N/A', type: null }, scheduleInfo: { flightNumber: null } }; RH.mxLcTick();
    const j2 = await (await RH.mxLastClicked('https://www.flightradar24.com/restapi/v1/widgets/last-clicked-flights', {})).json(), b1 = j2.last_clicked_flights.items.find(x => x.id === 1009392390);
    check('... FR24\'s panel and this page knowing nothing of it any more: still named - no "N/A N/A-N/A"', !!b1 && b1.callsign === 'BTX7P' && b1.registration === 'D-CVAB' && b1.airport.origin.code.iata === 'IGS' && b1.airport.destination.code.iata === 'BWE', b1);
    // (clicked: one landed - its aircraft's log page in a new tab, FR24's own handler not run; one in the air - FR24's)
    { const doc = R.w.document, wrap = doc.createElement('div'); let opened = null, fr24 = 0; R.w.open = u => { opened = u; return null; };
      lcs.list = j2.last_clicked_flights.items;
      const pos = lcs.list.findIndex(x => x.id === 1009392390);
      wrap.innerHTML = lcs.list.map((x, i) => `<div class="cursor-pointer" id="lc${i}"><div data-testid="last-clicked__callsign">${x.callsign}</div>${i === pos ? '' : '<span data-testid="last-clicked__live"></span>'}</div>`).join('');
      doc.body.appendChild(wrap); [...wrap.children].forEach(el => el.addEventListener('click', () => { fr24++; }));
      doc.getElementById('lc' + pos).firstChild.dispatchEvent(new R.w.MouseEvent('click', { bubbles: true, cancelable: true }));
      check('... clicked once it has landed: its aircraft\'s log page, FR24\'s own (nothing for a blocked flight) not run', opened === '/data/aircraft/d-cvab' && fr24 === 0, { opened, fr24 });
      opened = null; const other = pos === 0 ? 1 : 0;
      doc.getElementById('lc' + other).firstChild.dispatchEvent(new R.w.MouseEvent('click', { bubbles: true, cancelable: true }));
      check('... clicked while it is in the air (FR24\'s live mark on it): FR24\'s own - back to the flight on the map', opened === null && fr24 === 1, { opened, fr24 });
      wrap.remove(); }
    await RH.mxLastClicked('https://www.flightradar24.com/restapi/v1/widgets/last-clicked-flights', { method: 'PUT', body: JSON.stringify({ last_clicked_flights: [] }) });
    check('... FR24\'s "Clear list": none kept', RH.mxLcList().length === 0);
    check('... FR24\'s request for it answered here', !!RH.mxFetch('https://www.flightradar24.com/restapi/v1/widgets/last-clicked-flights', 'https://www.flightradar24.com/restapi/v1/widgets/last-clicked-flights', {}));
    // ---- (1.2.3) bookmarks: the limit raised in FR24's own stores, and its reading of it answered 1000
    const feats = { 'map.widgets.bookmarks.max': 1 }, us = { features: feats, feature(k) { return this.features[k]; } }, ds = { dispatcher: { features: { 'map.widgets.bookmarks.max': 1 } } };
    R.w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['user', us], ['dispatcher', ds]]) } } } };
    RH.mxBmMax();
    check('bookmarks: FR24\'s user store reads a limit of 1000 - its copy, the dispatcher\'s, and a fresh copy set later', us.feature('map.widgets.bookmarks.max') === 1000 && ds.dispatcher.features['map.widgets.bookmarks.max'] === 1000 && (us.features = { 'map.widgets.bookmarks.max': 1 }, us.feature('map.widgets.bookmarks.max') === 1000));
    // ---- (1.2.3) settings as left: what FR24's windows set kept; given back into FR24's own settings, only where it has them
    const sst = { settings: { misc: { showTrailTooltip: true, hideAircraftAirportPhoto: false }, map: { labels: 'flag' } } };
    RH.mxSetNote(sst, 'misc', ['showTrailTooltip']); RH.mxSetNote(sst, 'map', ['labels']);
    const fresh = { misc: { showTrailTooltip: false, hideAircraftAirportPhoto: false }, map: { labels: 'default' }, units: { speed: 'kts' } }, kept = RH.mxSetKept();
    const n = RH.mxSetApply(fresh, Object.assign({}, kept, { units: { nothere: 1 }, nosection: { x: 1 } }));
    check('settings: a setting changed is kept, and given back to FR24\'s settings as left - only those changed, only where FR24 has them', n === 2 && fresh.misc.showTrailTooltip === true && fresh.map.labels === 'flag' && fresh.misc.hideAircraftAirportPhoto === false && !('nothere' in fresh.units) && !fresh.nosection && !('hideAircraftAirportPhoto' in kept.misc), { fresh, kept });
    sst.settings.misc.showTrailTooltip = false; RH.mxSetNote(sst, 'misc', ['showTrailTooltip']);
    check('... switched off again: kept off', RH.mxSetKept().misc.showTrailTooltip === false);
    R.w.close(); }
  // ---- (1.2.4) FR24's airport flight history: each landing's and take-off's runway (Business only on FR24) - asked of the
  // userscript, put in FR24's own answer with the padlock off; one not found left as FR24 sent it
  { const hist = { data: [{ type: 'landed', flightId: 0x3c1a2b4f, time: 1793830000, callsign: 'EZY12', runway: null, available: [] }, { type: 'takeoff', flightId: 0x3c1a2b50, time: 1793830100, callsign: 'RYR1', runway: null, available: ['callsign'] }, { type: 'landed', flightId: 0x3c1a2b51, time: 1793830200, runway: '09', available: ['runway'] }] };
    const R = open(null, () => null, url => Promise.resolve(new Response(JSON.stringify(hist), { status: 200, headers: { 'content-type': 'application/json' } }))); await sleep(200);
    const asks = []; R.w.postMessage = d => { if (d && d.__tweeksLadd === 'rwyWant') { asks.push(d); setTimeout(() => R.w.dispatchEvent(new R.w.MessageEvent('message', { data: { __tweeksLadd: 'rwyGot', rid: d.rid, list: [{ k: '3c1a2b4f:1', rwy: '27' }], done: true }, source: R.w, origin: 'https://www.flightradar24.com' })), 20); } };
    const res = await R.H().mxFetch('https://www.flightradar24.com/api/airport-history/975/recent?limit=4', 'https://www.flightradar24.com/api/airport-history/975/recent?limit=4', {});
    const j = await res.json(), it = j.data;
    check('airport flight history: the runway of a landing worked out put in FR24\'s answer, its padlock off; one not found as FR24 sent it; one FR24 gave left alone', asks.length === 1 && asks[0].ap === 975 && asks[0].items.length === 2 && it[0].runway === '27' && it[0].available.includes('runway') && it[1].runway === null && !it[1].available.includes('runway') && it[2].runway === '09', { asks: asks.map(a => a.items), it });
    R.w.close(); }
  // ---- (1.2.4) a flight's KML and CSV - FR24's own buttons beside its playback's play button and in its flight history: its
  // quota answered here, the file made by the userscript (FR24's track, else the monitor's), FR24's "not available" else
  { const R = open(null, () => null, () => Promise.reject(new Error('FR24 not asked'))); await sleep(200);
    const asks = []; R.w.postMessage = d => { if (d && d.__tweeksLadd === 'trackFile') { asks.push(d); setTimeout(() => R.w.dispatchEvent(new R.w.MessageEvent('message', { data: d.fid === '3d1f6a2b' ? { __tweeksLadd: 'trackFileGot', rid: d.rid, ok: true, text: 'Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction\n', type: 'text/csv' } : { __tweeksLadd: 'trackFileGot', rid: d.rid, ok: false }, source: R.w, origin: 'https://www.flightradar24.com' })), 20); } };
    const q = await (await R.w.fetch('https://www.flightradar24.com/download/check-quota?flight=3d1f6a2b', { credentials: 'include', headers: { 'X-Fetch': 'true' } })).json();
    check('KML/CSV: FR24\'s quota check answered here - files left, FR24\'s server not asked', typeof q.quotaLeft === 'number' && q.quotaLeft > 0, q);
    const f = await R.w.fetch('https://www.flightradar24.com/download/?flight=3d1f6a2b&file=csv&trailLimit=0&history=1793830000', { credentials: 'include' }), txt = await f.text();
    check('... the file: asked of the userscript by the flight\'s id and departure, given to FR24\'s download as a CSV', f.ok && /text\/csv/.test(f.headers.get('content-type')) && /^Timestamp,UTC,Callsign/.test(txt) && asks[0].fid === '3d1f6a2b' && asks[0].file === 'csv' && asks[0].ts === 1793830000, asks);
    const g = await R.w.fetch('https://www.flightradar24.com/download/?flight=1025468972&file=kml&trailLimit=0&history=1793830000');
    check('... an id written in decimal read as such; no track anywhere: FR24\'s own "not available" (an empty answer)', !g.ok && asks[1].fid === (1025468972).toString(16) && asks[1].file === 'kml', asks[1]);
    // (FR24's flight page: its history's download menu unlocked; its live flight card's runways from the flight's track)
    const app = R.w.document.getElementById('app'), page = { component: 'Data/FlightHistory', props: { canDownload: false, liveFlight: { flightId: '3d1f6a2b', origin: { iata: 'HPN', scheduled: 1793830000, actual: 1793830300, runway: null, locked: { runway: true } }, destination: { iata: 'EMA', scheduled: 1793855000, actual: null, runway: null, locked: { runway: true } } } } };
    app.__vue_app__ = { config: { globalProperties: { $page: page } } };
    const rw = []; R.w.postMessage = d => { if (d && d.__tweeksLadd === 'rwyWant') { rw.push(d); setTimeout(() => R.w.dispatchEvent(new R.w.MessageEvent('message', { data: { __tweeksLadd: 'rwyGot', rid: d.rid, list: [{ k: '3d1f6a2b:0', rwy: '34' }], done: true }, source: R.w, origin: 'https://www.flightradar24.com' })), 20); } };
    R.H().mxDataTick(); await sleep(150); R.H().mxDataTick();
    const lf = page.props.liveFlight;
    check('flight page: its history\'s KML/CSV menu unlocked; the take-off runway asked by the airport\'s code, put in its card, the padlock off; the arrival (not landed) left empty', page.props.canDownload === true && rw.length === 1 && rw[0].iata === 'HPN' && rw[0].items[0].landing === false && lf.origin.runway === '34' && lf.origin.locked.runway === false && lf.destination.locked.runway === false && !lf.destination.runway, { rw: rw.map(x => [x.iata, x.items]), lf });
    R.H().mxDataTick(); check('... nothing asked again, the card not set again', rw.length === 1 && page.props.liveFlight === lf);
    page.component = 'Data/Airport'; page.props = { canDownload: false }; R.H().mxDataTick();
    check('... another page left alone', page.props.canDownload === false);
    R.w.close(); }
  // ---- (1.2.4) FR24's player on a page of ours: its GPS altitude, true and indicated airspeed and squawk of each moment,
  // asked of FR24's server by the page's live id - a stand-in id of ours, answered here from the track, nothing sent
  { const sent = []; const R = open(null, () => null); await sleep(200); const H = R.H();
    const pts = [{ t: 1000, lat: 52, lon: -1, alt: 0, gnd: true, sq: '7000' }, { t: 1100, lat: 52.1, lon: -1, alt: 2000, ag: 2400, ias: 100, tas: 104, sq: '4550' }, { t: 1160, lat: 52.2, lon: -1, alt: 2600, ag: 3000, ias: 120, tas: 126, sq: '4550' }, { t: 1500, lat: 52.3, lon: -1, alt: 3000, ag: 3500, ias: 130, tas: 136 }];
    const sid = H.mxPbStandIn({ id: 'ff4078a36a8a1f56', pts });
    check('stand-in id: 0xF0000000 and up (FR24\'s ids far below); the same page the same id; one with no figures none', sid >= 0xF0000000 && H.mxPbStandIn({ id: 'ff4078a36a8a1f56', pts }) === sid && H.mxPbStandIn({ id: 'x', pts: [{ t: 1, lat: 1, lon: 1 }] }) === null, sid);
    const R0 = H.mxPbStand.get(sid).R, a = H.mxPbReadAt(R0, 1130), b = H.mxPbReadAt(R0, 1300), c = H.mxPbReadAt(R0, 1010);
    check('a moment\'s figures: in proportion between reports two minutes apart at most; nearer within a minute else none; the squawk last set', a.ag === 2700 && a.ias === 110 && a.tas === 115 && a.sq === '4550' && b.ag === null && b.ias === null && b.sq === '4550' && c.ag === null && c.sq === '7000', { a, b, c });
    // (FR24's own XHR: its request as its gRPC-web client sends it - base64 text, the flight id fixed32, the moment varint)
    const ask = (svc, id, ts) => new Promise(res => {
      const x = new R.w.XMLHttpRequest(), msg = [0x0d, id & 255, (id >>> 8) & 255, (id >>> 16) & 255, (id >>> 24) & 255, 0x10].concat((n => { const o = []; do { let v = n % 128; n = Math.floor(n / 128); if (n) v |= 128; o.push(v); } while (n); return o; })(ts));
      const body = Buffer.from([0, 0, 0, 0, msg.length].concat(msg)).toString('base64'), seen = [];
      x.open('POST', 'https://data-feed.flightradar24.com/fr24.feed.api.v1.Feed/' + svc); x.setRequestHeader('Content-Type', 'application/grpc-web-text');
      x.onreadystatechange = () => { seen.push(x.readyState); if (x.readyState === 4) res({ x, seen, text: x.responseText, ct: x.getResponseHeader('content-type'), st: x.status, gs: x.getResponseHeader('grpc-status') }); };
      x.send(body);
      setTimeout(() => res({ x, seen, timeout: true }), 1500);
    });
    R.w.fetch = u => { sent.push(String(u)); return Promise.reject(new Error('offline')); };
    const g = await ask('PlaybackFlight', sid, 1130);
    const raw = Buffer.concat(((g.text || '').match(/.{4}/g) || []).map(q => Buffer.from(q, 'base64'))), len0 = raw.readUInt32BE(1), m0 = raw.subarray(5, 5 + len0), tr = raw.subarray(5 + len0);
    const efi = H.parse(m0), f3 = efi.find(f => f.fn === 3), inner = f3 ? H.parse(f3.val) : [], ems = inner.find(f => f.fn === 13), emsF = ems ? H.parse(ems.val) : [], v = n => (emsF.find(f => f.fn === n) || {}).val, sq = (inner.find(f => f.fn === 15) || {}).val;
    check('PlaybackFlight by the stand-in id: answered here as FR24\'s server would (200, its content type, readyState 2-3-4), its figures of that moment, then the trailer "grpc-status:0"', !g.timeout && g.st === 200 && g.ct === 'application/grpc-web-text' && g.seen.join() === '2,3,4' && v(8) === 2700 && v(5) === 110 && v(6) === 115 && sq === 0x4550 && tr[0] === 0x80 && /grpc-status:0/.test(tr.subarray(5).toString()), { seen: g.seen, ems: emsF.map(f => [f.fn, f.val]), sq, tr: tr.subarray(5).toString() });
    const nf = await ask('FollowFlight', sid, 0), ht = await ask('HistoricTrail', sid, 0);
    check('... its live stream and stored trail: "not found" (grpc-status 5), as FR24\'s of a flight it has no more; nothing sent anywhere', nf.gs === '5' && ht.gs === '5' && !sent.length && H.mx.pbReads >= 1, { nf: nf.gs, ht: ht.gs, sent });
    R.w.close(); }
  // ---- (1.2.4) FR24's airport boards: each flown row's runway (Business only on FR24) - the known put in at once, the
  // padlock off; the rest asked of the userscript (the latest first) and put in as they come; rows not flown not asked
  // (1.2.6: and never a padlock - "N/A" until the runway is known)
  { const R = open(null, () => null); await sleep(200); const H = R.H(), now = Math.floor(Date.now() / 1000);
    const asks = []; R.w.postMessage = d => { if (d && d.__tweeksLadd === 'rwyWant') { asks.push(d); setTimeout(() => R.w.dispatchEvent(new R.w.MessageEvent('message', { data: { __tweeksLadd: 'rwyGot', rid: d.rid, list: d.items.map(x => ({ k: x.fid + ':' + (x.landing ? 1 : 0), rwy: { '3d1f0001:0': '27R', '3d1f0003:1': '09L' }[x.fid + ':' + (x.landing ? 1 : 0)] })).filter(x => x.rwy), done: true }, source: R.w, origin: 'https://www.flightradar24.com' })), 20); } };
    const app = R.w.document.getElementById('app'), row = (fid, st, t, x) => Object.assign({ id: fid, flightId: fid, scheduledTime: t, estimatedTime: t, status: { type: st, label: st }, runway: null, locked: { runway: true } }, x || {});
    const page = { component: 'Data/AirportBoard', props: { board: 'departures', airport: { id: 975, iata: 'LHR' }, flights: [row('3d1f0001', 'departed', now - 1200), row('3d1f0002', 'scheduled', now + 3600), row('c1a2b3', 'departed', now - 600, { __tlArch: true })] } };
    app.__vue_app__ = { config: { globalProperties: { $page: page } } };
    H.mxDataTick(); await sleep(150); H.mxDataTick();
    const fl = page.props.flights;
    check('departures page: the take-off runway asked by the airport\'s id, put in its row, the padlock off; one not yet flown, and a row of ours with a made-up id, not asked - and no padlock on either ("N/A", 1.2.6)', asks.length === 1 && asks[0].ap === 975 && asks[0].items.length === 1 && asks[0].items[0].fid === '3d1f0001' && asks[0].items[0].landing === false && fl[0].runway === '27R' && fl[0].locked.runway === false && fl[1].runway === null && fl[1].locked.runway === false && fl[2].locked.runway === false, { asks: asks.map(a => a.items), fl: fl.map(f => [f.flightId, f.runway, f.locked.runway]) });
    H.mxDataTick(); check('... not asked again', asks.length === 1);
    // (the map's airport panel: FR24's /api/v1 answer - its rows by flight.id; the landing's runway, a known one at once)
    const n = H.mxBoardRwy([{ flight: { id: '3d1f0003' }, status: { name: 'landed' }, runway: null }], 'arrivals', 975);
    await sleep(150);
    const rows2 = [{ flight: { id: '3d1f0003' }, status: { name: 'landed' }, runway: null }, { flight: { id: '3d1f0004' }, status: { name: 'estimated' }, runway: null }], n2 = H.mxBoardRwy(rows2, 'arrivals', 975);
    check('map panel rows: the landing\'s runway asked, then put in from what came back; one still in the air left alone', n === 0 && asks.length === 2 && asks[1].items[0].landing === true && n2 === 1 && rows2[0].runway === '09L' && rows2[1].runway === null, { n, n2, rows2 });
    R.w.close(); }
  // ---- the switch off
  const Q = open({ mapx: false }, answer); await sleep(200);
  const t2 = { 'map.layer.weather.wind': ['business'], 'map.layer.atc': ['gold'] };
  check('switched off in the LADD Unblock window: FR24\'s requests left to FR24, nothing answered here', Q.H().mxFetch('https://www.flightradar24.com/api/v1/weather/auth?platform=web') === null && Q.H().mx.on === false, Q.H().mx);
  check('... and FR24\'s tables untouched (its core module not looked for)', Q.H().mx.opts === 0 && !t2['map.layer.atc'].includes('basic'));
  Q.w.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
