// 1.3.9 - an OurAirports airport's window on FR24's map, whatever version FR24's airport API is at:
//   - FR24's mid-November build asks /api/v2/airports/<id> for an airport's own answer (v1 before): answered here for an
//     OurAirports airport - "airportsApi.airport request is not ok", its window shut, before - and at any version
//     (v3 ...), by its id or by its code; its pictures, weather, delays and boards at any version too; never one of FR24's
//   - FR24's own answer for one of its airports read for its shape only (its keys, never its values): an OurAirports
//     airport's answer made in it - a section or field FR24 adds is there, empty of its kind; ours over it
//   - a part of the API never seen: answered in the shape FR24's own answer for it had (1.3.11: asked of FR24 for the
//     airport its pages are made from, where none has been seen), else empty - and counted; FR24's
//     "not found" for any request about an OurAirports airport counted with its address: both named by the health check
//   - the route engine: a run of "ground" reports at flying speed away from every field, well up either side - G-LFSA's
//     and G-RVNA's ADS-B units over Cheshire on 17 Nov, their real positions - is flight; a real landing is not touched
//   - the route engine: a helicopter lost hovering low - G-NHVT over the Liverpool Bay platforms - came down there, not at a
//     strip 32 km off (Rhedyn Coch Farm); one lost by a heliport, at it
//   - the monitor: a flight first heard in the air after a restart, joined to its take-off - G-RVNA's real positions - one
//     flight as it goes on, from Liverpool, down at Liverpool, and the next one; no copy left open
//   - the route engine: a landing in a hole in coverage ahead of the aircraft going down into it, not behind - 9H-LEL lost
//     descending 70 km short of Liberia, its real positions: Liberia, not Managua 117 km behind it
//   - the route code (the browser): a plan whose flight ended in the hole the present track began after is the flight
//     before's (9H-LEL's Toronto - Liberia); an ordinary flight's departure as FR24's own map gives it, where its schedule
//     has none (N89P out of San Jose, "from Bluefields" before)
//   - the monitor: every flight its FR24 scans see kept (fr24scan) in the column form - each report once, FR24's estimated
//     positions not - read with the rest at /fr24raw; the airliners at cruise asked for (none after a pushback); the oldest
//     day let go first
// usage: node test/unit_139.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon139-'));
global.fetch = async () => ({ status: 404, ok: false, text: async () => '', json: async () => null });
// (real positions of 17 Nov from the monitor: [s after 1794930000 (15:40 UTC), lat, lon, ft | 'G' (ground), kt, track,
// ft/min, n: ADS-B from a non-transponder unit, a: ADS-B, m: multilateration, GPS ft])
const RVNA = [[726,53.028771,-2.613098,3575,88.4,5.19,293,"n",2675],[950,53.038827,-2.575588,3275,89.4,10.3,-58,"n",2375],[955,53.040782,-2.575823,3300,82.7,352.36,69,"n",2375],[958,53.042175,-2.576141,3275,82.6,353.05,116,"n",2375],[966,53.045065,-2.575823,3300,94.9,23.59,42,"n",2375],[1070,53.042496,-2.584763,2975,68.5,293.2,-131,"n",2075],[1075,53.044506,-2.585475,2950,98.2,8.79,-9,"n",2050],[1082,53.046753,-2.5811,2900,124.7,74.18,-132,"n",2050],[1096,53.041992,-2.575902,2850,85,233.13,-291,"n",2050],[1192,53.040527,-2.607956,3075,52.1,266.7,91,"n",1975],[1198,53.040527,-2.610474,3075,62,268.15,318,"n",1975],[1202,53.040503,-2.612627,3075,65.3,264.73,406,"n",1950],[1210,53.040363,-2.616237,3225,50,270,638,"n",2000],[1313,53.02919,-2.635071,3050,59,280.74,625,"n",2300],[1315,53.02933,-2.636012,3000,59,280.74,457,"n",2275],[1321,53.031285,-2.637817,2950,95.9,11.43,151,"n",2200],[1434,53.060567,-2.585946,2825,92.1,93.11,952,"n",2100],[1435,53.060486,-2.584839,2825,93.7,101.07,872,"n",2100],[1456,53.06488,-2.572327,2650,99.9,41.35,-696,"n",1850],[1556,53.070063,-2.546474,2825,105.6,65.38,-2,"n",1950],[1566,53.073555,-2.541844,2800,89.3,4.5,-172,"n",1900],[1583,53.080307,-2.543793,2775,74.9,325.89,-128,"n",1875],[1680,53.103516,-2.584769,"G",68.3,309.05,447,"n",1400],[1683,53.104233,-2.586149,"G",73.2,308.9,414,"n",1400],[1688,53.105209,-2.588222,"G",75.4,308.54,299,"n",1400],[1794,53.130798,-2.635542,2325,75.7,313.39,76,"n",1425],[1798,53.131605,-2.637042,2300,74.4,311.19,25,"n",1400],[1802,53.132536,-2.638819,2300,76.5,311.82,7,"n",1425],[1913,53.166473,-2.67404,2350,83.5,353.81,75,"n",1425],[1920,53.168976,-2.674543,2350,84.7,352.54,145,"n",1450],[1924,53.170624,-2.674935,2350,84.7,352.54,96,"n",1450],[2036,53.21434,-2.690159,2300,84.8,342.85,-75,"n",1400],[2037,53.214934,-2.690519,2300,86,342.41,-25,"n",1400],[2042,53.216675,-2.691493,2300,85.7,340.93,-11,"n",1400],[2147,53.253013,-2.717904,2325,80.5,327.69,52,"n",1425],[2160,53.257296,-2.722347,2325,83,328.8,7,"n",1425],[2162,53.257855,-2.722994,2325,82.2,328.44,2,"n",1425],[2278,53.304337,-2.743051,2300,86.6,319.69,-135,"n",1400],[2279,53.304826,-2.743755,2300,86.6,319.69,-83,"n",1400],[2283,53.30599,-2.745451,2275,87.1,318.26,-138,"n",1375],[2389,53.332809,-2.794373,1775,64.4,302.95,-750,"n",1000],[2398,53.334366,-2.798218,1675,64.4,302.95,-752,"n",900],[2403,53.335098,-2.800415,1600,66.9,291.96,-766,"n",825]];
const LFSA = [[2281,52.921096,-2.85417,3975,75,222.84,-151,"n",2975],[2394,52.899781,-2.892755,"G",63,234,-833,"m",2000],[2399,52.898817,-2.894349,"G",62,231,-812,"m",2000],[2401,52.89839,-2.896404,"G",62,231,-788,"m",2000],[2513,52.875562,-2.93821,1700,69,229,-289,"m",null],[2519,52.873611,-2.939844,1700,70,226,-289,"m",null],[2641,52.888834,-2.894368,2350,70,52,544,"m",null],[2646,52.8901,-2.891874,2400,70,49,472,"m",null],[2650,52.891209,-2.890224,2450,71,49,488,"m",null],[2752,52.911621,-2.897797,3100,71.5,313.3,-18,"n",2175],[2768,52.915842,-2.904951,3075,75,312.84,62,"m",2125],[2880,52.958059,-2.912554,2100,85,351.2,-882,"n",1150],[3123,53.030365,-2.811127,3300,109.6,63.43,268,"n",2350],[3125,53.030823,-2.809525,3300,105.2,65.87,293,"n",2375],[3128,53.031285,-2.807713,3300,101.8,67.47,303,"n",2400],[3131,53.031921,-2.805099,3250,101.6,69.25,262,"n",2350]];
const NHVT = [[726,53.773727,-3.041957,1100,17.5,300.96,-128,"a",225],[1794,53.776866,-3.035943,"G",9.8,null,null,"a",null],[1798,53.776691,-3.035856,"G",9.8,null,null,"a",null],[1799,53.776611,-3.035817,"G",9.8,null,null,"a",null],[1914,53.772079,-3.03874,1100,42.1,274.09,384,"a",225],[1920,53.772171,-3.041094,1175,52.2,275.49,832,"a",300],[1924,53.772304,-3.04289,1225,57.3,276.01,896,"a",350],[2036,53.747771,-3.109373,1825,100.8,233.47,768,"a",950],[2038,53.747314,-3.110465,1850,100.8,233.47,768,"a",975],[2042,53.746188,-3.113008,1900,100,233.13,832,"a",1025],[2156,53.711197,-3.191764,2050,116.4,233.03,-64,"a",1175],[2160,53.709877,-3.19476,2050,116.4,233.03,0,"a",1175],[2162,53.709225,-3.196214,2050,116.4,233.03,-64,"a",1175],[2278,53.672195,-3.27934,2050,113.6,233.23,64,"a",1175],[2280,53.671555,-3.280753,2050,113.6,233.23,64,"a",1175],[2284,53.670364,-3.283421,2050,114.2,232.83,-64,"a",1200],[2398,53.634463,-3.363674,2050,115,233.13,0,"a",1175],[2400,53.633857,-3.365128,2050,115,233.13,0,"a",1200],[2404,53.632507,-3.368016,2050,115,233.13,0,"a",1175]];

let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let JSDOM = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); } catch (e) { console.log('(skipped: no jsdom)'); }
  const DIST = path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js');
  if (JSDOM && fs.existsSync(DIST)) {
    const SRC = fs.readFileSync(DIST, 'utf8'), PI = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0];
    // (FR24's server, as the page's own fetch: its answer for its airport 530 - with a section and fields FR24 has added
    // since 1.3.1 - a "not found" for anything else)
    const asked = [];
    const FR24_530 = { data: { info: { id: 530, name: 'Barrow Walney Island', iata: 'BWF', icao: 'EGNL', latitude: 54.13, longitude: -3.26, elevation: 173, timezone: 'Europe/London', countryId: 235, faaLidCode: null, state: null, timezoneDisplay: 'GMT', sunrise: 1, sunset: 2, satelliteImage: 'https://x/sat.jpg', videoStream: null, newInfoField: 'FR24 VALUE' },
      details: { website: 'https://walney.example', phone: '+44 1229 000000', capacity: 12 }, stats: { summary: { totalFlights: 12 }, flights: [{ a: 1 }], busiestRoutes: [{ from: 1, to: 2, total: 3 }], newCount: 7 },
      runways: [{ name: '17', length: 1000, surface: 'ASPH', stats: { total: 5, takeoffs: 2, landings: 3, perDay: [] } }], images: [{ src: 'x' }], weather: { temperature: 9 }, futureSection: { rank: 3, list: [1, 2], flag: true, label: 'FR24' } }, meta: { version: 2 } };
    const FR24_530_RADIO = { data: { frequencies: [{ name: 'TWR', mhz: 123.2 }], updated: 1 } };
    const fr24 = (u) => {
      asked.push(u);
      if (/\/api\/v2\/airports\/530(?:[?#]|$)/.test(u)) return [200, FR24_530];
      if (/\/api\/v2\/airports\/530\/radio(?:[?#]|$)/.test(u)) return [200, FR24_530_RADIO];
      return [404, { message: 'Not Found' }];
    };
    const page = (url) => {
      const w = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window; let H = null; const posts = [];
      w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob;
      w.fetch = (u) => { const [st, j] = fr24(String(u && u.url || u)); return Promise.resolve(new Response(JSON.stringify(j), { status: st, headers: { 'content-type': 'application/json' } })); };
      w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
      w.eval('(' + PI + ')()');
      return { w, H: () => H, posts };
    };
    const P = page('https://www.flightradar24.com/54.15,-3.20/10'), H = P.H();
    H.acceptOa({ rows: [[17000001, 'EGXX', 'EGXX', 'Walney Strip', 'Barrow-in-Furness', 530, 54.2, -3.2, 50, 'S'], [17000002, 'GB-0999', 'GB-0999', 'Some Heliport', 'Ulverston', 530, 54.19, -3.09, 30, 'H']], sig: '3.9.1' });
    const ref = { id: 530, iata: 'BWF', icao: 'EGNL', name: 'Barrow', city: 'Barrow', country: 'United Kingdom', countryId: 235, lat: 54.13, lon: -3.26, size: 3000, timezone: { abbr: 'GMT', abbrName: null, isDst: false, name: 'Europe/London', offset: 0, offsetHours: '0:00' } };
    H.patchList('airports', { rows: [ref].concat(Array.from({ length: 120 }, (_, i) => ({ id: 1000 + i, iata: 'A' + i, icao: '', name: 'X', lat: 0, lon: 0, timezone: ref.timezone }))) });
    const get = async u => { const r = await P.w.fetch(u); return { status: r.status, j: await r.json().catch(() => null) }; };

    // ---- 1. the airport's own answer at FR24's new address, and at any version --------------------------------------
    const n0 = asked.length;
    const v2 = await get('https://www.flightradar24.com/api/v2/airports/17000002');
    check('(FR24\'s current build) /api/v2/airports/<id> for an OurAirports airport: answered here, its id in data.info - so FR24 opens its window ("airportsApi.airport request is not ok" before); FR24\'s server not asked', v2.status === 200 && v2.j.data.info.id === 17000002 && v2.j.data.info.name === 'Some Heliport' && v2.j.data.info.latitude === 54.19 && asked.length === n0, v2.j);
    const v3 = await get('https://www.flightradar24.com/api/v3/airports/17000002?x=1'), byCode = await get('https://www.flightradar24.com/api/v2/airports/gb-0999');
    check('... at any version of the API (v3 ...), and by its code', v3.j.data.info.id === 17000002 && byCode.j.data.info.id === 17000002 && asked.length === n0, { v3: v3.j.data.info.id, code: byCode.j.data.info.id });
    const parts = await Promise.all(['https://www.flightradar24.com/api/v2/airports/17000002/images', 'https://www.flightradar24.com/api/v4/airports/17000002/disruptions', 'https://www.flightradar24.com/api/v2/airports/17000002/arrivals?page=1&limit=100'].map(get));
    check('... its pictures, delays and boards at any version too: answered here, empty, as before', Array.isArray(parts[0].j.data) && parts[0].j.data.length === 0 && parts[1].j.data && Object.keys(parts[1].j.data).length === 0 && Array.isArray(parts[2].j.data) && asked.length === n0, parts.map(x => x.j));
    const own = await get('https://www.flightradar24.com/api/v2/airports/530'), bwf = await get('https://www.flightradar24.com/api/v2/airports/bwf');
    check('... never one of FR24\'s own airports (by id or code): FR24\'s answer, as it came', own.j.data.info.name === 'Barrow Walney Island' && bwf.status === 404 && asked.some(u => /airports\/530$/.test(u)) && asked.some(u => /airports\/bwf$/.test(u)));

    // ---- 2. in the shape of FR24's own latest answer ----------------------------------------------------------------
    await sleep(30);
    const m2 = await get('https://www.flightradar24.com/api/v2/airports/17000002'), d = m2.j.data, txt = JSON.stringify(m2.j);
    check('FR24\'s own answer read for its shape: an OurAirports airport\'s answer has every section and field FR24\'s has - those FR24 has added since (futureSection, details, info.newInfoField, stats.newCount, meta) - empty of their kind', d.futureSection && d.futureSection.rank === 0 && Array.isArray(d.futureSection.list) && d.futureSection.list.length === 0 && d.futureSection.flag === false && d.futureSection.label === '' && d.details && d.details.website === '' && d.info.newInfoField === '' && d.stats.newCount === 0 && m2.j.meta && m2.j.meta.version === 0, m2.j);
    check('... ours over it: its own details, its lists empty - and nothing of FR24\'s airport in it (no value of Walney\'s)', d.info.id === 17000002 && d.info.name === 'Some Heliport' && d.info.timezone === 'Europe/London' && Array.isArray(d.runways) && d.runways.length === 0 && d.stats.busiestRoutes.length === 0 && !/Walney Island|walney\.example|FR24 VALUE|sat\.jpg|\+44/.test(txt), d);
    const kept = JSON.parse(P.w.localStorage.getItem('tl.apShape1') || '{}');
    check('... the shape kept for the next page (no value of FR24\'s in it)', kept[''] && kept[''].data && kept[''].data.futureSection && !/Walney Island|walney\.example|FR24 VALUE/.test(JSON.stringify(kept)));

    // ---- 3. a part never seen; a request FR24's server answers "not found" ------------------------------------------
    // (1.3.11: a part never seen is first asked of FR24 for the FR24 airport the OurAirports one's pages are made from -
    // Walney, 530 - and answered in that answer's shape; only a part FR24 has no answer for either is answered blind and
    // counted. 1.3.9 counted every one: "new to this script" on every panel - unit_1311.cjs)
    const s0 = H.stats.oaApiNew || 0, rad0 = await get('https://www.flightradar24.com/api/v2/airports/17000002/radio');
    check('a part of the API never seen (/radio): FR24\'s own answer for Walney (530) at the same address asked, the answer in its shape, empty - not counted as new', rad0.status === 200 && Array.isArray(rad0.j.data.frequencies) && rad0.j.data.frequencies.length === 0 && rad0.j.data.updated === 0 && asked.includes('https://www.flightradar24.com/api/v2/airports/530/radio') && (H.stats.oaApiNew || 0) === s0, { j: rad0.j, n: H.stats.oaApiNew });
    const nw = await get('https://www.flightradar24.com/api/v2/airports/17000002/nowhere');
    check('... one FR24 has no answer for either (/nowhere): answered here, empty - and counted, named', nw.status === 200 && nw.j.data && Object.keys(nw.j.data).length === 0 && H.stats.oaApiNew === s0 + 1 && H.stats.oaApiNewPart === '/nowhere', { j: nw.j, n: H.stats.oaApiNew, part: H.stats.oaApiNewPart });
    await get('https://www.flightradar24.com/api/v2/airports/530/radio'); await sleep(30);
    const rad1 = await get('https://www.flightradar24.com/api/v2/airports/17000002/radio');
    check('... once FR24\'s own answer for it has been seen: in its shape (frequencies, an empty list)', Array.isArray(rad1.j.data.frequencies) && rad1.j.data.frequencies.length === 0 && rad1.j.data.updated === 0, rad1.j);
    const miss = await get('https://www.flightradar24.com/api/v9/airport-things/17000002/stuff'); await sleep(30);
    check('a request about an OurAirports airport at an address of FR24\'s not answered here, "not found" from FR24: counted with its address (the id taken out)', miss.status === 404 && H.stats.oaMiss === 1 && H.stats.oaMissPath === '/api/v9/airport-things/:id/stuff', { n: H.stats.oaMiss, path: H.stats.oaMissPath });
    // (and the health check names both: the userscript's words for them)
    const tools = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '06-tools.js'), 'utf8');
    check('... the health check names them (FR24 asking about an OurAirports airport where this script does not answer; a part answered empty)', /S\.oaMiss > 0/.test(tools) && /S\.oaApiNew > 0/.test(tools));
    P.w.close();
  }

  // ---- 4. the route engine: "on the ground" at flying speed, nowhere near a field ---------------------------------------
  const T0 = 1794930000, { createRouteEngine } = require('../src/engine.js'), ds = require('./dataset.cjs');
  const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows); E.setFields(ds.loadFields(DATA)); E.setHeliports(ds.loadHeliports(DATA));
  const LPL = E.byIcao('EGGP'), BLK = E.byIcao('EGNH');
  const SRC = { n: 'adsb_icao_nt', a: 'adsb_icao', m: 'mlat' };
  const toTrace = rows => rows.map(r => [T0 + r[0], r[1], r[2], r[3] === 'G' ? 'ground' : r[3], r[4], r[5], 0, r[6], null, SRC[r[7]] || r[7], r[8]]);
  const run = (trace, cls, type) => { const ls = E.legsFromPoints(E.parseTrace({ timestamp: 0, trace }), { heli: cls === 'heli', cls, type }); return { ls, s: ls.map(l => E.summarizeLeg(l, { cls, type, grp: E.groupOf(cls) })) }; };
  { const pts = E.parseTrace({ timestamp: 0, trace: toTrace(LFSA) }), ls = E.legsFromPoints(pts, { cls: 'piston', type: 'PA38' });
    const three = pts.filter(p => p.t >= T0 + 2394 && p.t <= T0 + 2401);
    check('G-LFSA\'s real positions, 17 Nov 16:18-16:32: its three "on the ground" reports at 62-63 kt over Shropshire (GPS 2,000 ft, 3,975 ft before, 1,700 after, the nearest strip 6 km off) - flight, at heights between; one flight, not one "taking off" at 16:20', three.length === 3 && three.every(p => !p.gnd && !p.gnd0 && p.alt < 3975 && p.alt > 1700) && ls.length === 1 && !ls[0].startGnd, { n: ls.length, three: three.map(p => [p.gnd, p.alt]) });
    // (the same flight from its take-off at Liverpool: before, "Liverpool -> ?" ended there and "? -> ?" after - the board's
    // Liverpool -> Manchester, the log's Private Site)
    // (off Liverpool at 15:54 as the monitor had it; its positions to 16:18 as it would have heard them)
    const off = [[800, LPL.lat, LPL.lon, 'G', 5, null, null, 'n', null], [874, LPL.lat, LPL.lon - 0.006, 'G', 60, 270, null, 'n', null], [934, 53.33, -2.89, 800, 75, 220, 700, 'n', null], [1200, 53.25, -2.88, 2400, 85, 190, 500, 'n', null], [1600, 53.13, -2.86, 3600, 88, 185, 100, 'n', null], [2000, 53.01, -2.85, 3900, 86, 182, 0, 'n', null], [2200, 52.945, -2.845, 3950, 80, 200, 0, 'n', null]];
    const w = run(toTrace(off.concat(LFSA)), 'piston', 'PA38');
    check('... and from its take-off at Liverpool: one flight, from Liverpool - not "Liverpool -> ?" and "? -> ?" (the board\'s Liverpool -> Manchester)', w.s.length === 1 && w.s[0].from && w.s[0].from.code === 'LPL' && w.s[0].startedOnGround, w.s.map(x => [x.from && x.from.code, x.to && x.to.code]));
    const pR = E.parseTrace({ timestamp: 0, trace: toTrace(RVNA) }); E.legsFromPoints(pR, { cls: 'piston', type: 'PA38' });
    check('G-RVNA\'s real positions, 16:08: its three "on the ground" at 68-75 kt (GPS 1,400 ft) - flight too', pR.filter(p => p.t >= T0 + 1680 && p.t <= T0 + 1688).every(p => !p.gnd && p.alt > 2325 && p.alt < 2775));
    // (what stays a landing: on a field; a slow report in the run; an average between the two sides well short of the speed)
    // (a: 2,000 ft 120 s before the run, b: 1,500 ft 120 s after; ab: how far apart the two, km)
    const mk = (lat, lon, gsRun, ab) => { const a = [0, lat + ab / 222, lon, 2000, 80, 180, -900, 'a', null], r1 = [120, lat, lon, 'G', gsRun[0], 180, null, 'a', null], r2 = [180, lat - 0.002, lon, 'G', gsRun[1], 180, null, 'a', null], b = [300, lat - ab / 222, lon, 1500, 80, 180, 700, 'a', null];
      return E.parseTrace({ timestamp: 0, trace: toTrace([a, r1, r2, b]) }); };
    const atLpl = mk(LPL.lat, LPL.lon, [55, 45], 8), slow = mk(52.95, -2.70, [55, 25], 8), still = mk(52.95, -2.70, [45, 42], 1), flying = mk(52.95, -2.70, [45, 42], 8);
    [atLpl, slow, still, flying].forEach(p => E.legsFromPoints(p, { cls: 'piston', type: 'PA38' }));
    check('... and what stays a landing: such a run on Liverpool\'s runway; one with a report at 25 kt in it; one whose two sides are 1 km apart in five minutes (it stopped) - the same 8 km apart, flight', atLpl[1].gnd && atLpl[2].gnd && slow[1].gnd && slow[2].gnd && still[1].gnd && still[2].gnd && !flying[1].gnd && !flying[2].gnd, [atLpl, slow, still, flying].map(p => [p[1].gnd, p[2].gnd]));
  }

  // ---- 5. the route engine: a helicopter lost hovering low -------------------------------------------------------------
  { // (G-NHVT, 17 Nov: off Blackpool at 14:54, lost at 15:11 hovering at 1,150 ft and 1 kt over the Liverpool Bay platforms,
    // heard again climbing away from them at 15:35, then coming into Blackpool at 15:52 - its real positions from then on)
    const out = [[-2719, BLK.lat, BLK.lon - 0.012, 'G', 8, null, null, 'a', null], [-2659, 53.77, -3.07, 600, 60, 233, 900, 'a', null], [-2400, 53.70, -3.22, 2050, 120, 233, 0, 'a', null], [-2000, 53.60, -3.44, 2050, 118, 233, 0, 'a', null],
      [-1700, 53.545, -3.565, 1500, 40, 240, -600, 'a', null], [-1500, 53.538895, -3.576207, 1175, 1, 301, -100, 'a', null], [-1496, 53.538891, -3.576211, 1150, 1, 301, 0, 'a', null],
      [-280, 53.555, -3.545, 1200, 60, 50, 800, 'a', null], [-220, 53.565, -3.525, 1700, 90, 50, 700, 'a', null], [0, 53.64, -3.37, 2050, 115, 53, 0, 'a', null], [400, 53.73, -3.15, 1800, 110, 60, -400, 'a', null]];
    const h = run(toTrace(out.concat(NHVT)), 'heli', 'A169'), farm = E.fieldId('GB-0479');
    check('G-NHVT lost at 1,150 ft and 1 kt over the sea, 32 km from the nearest strip: down there - a place no list has - not "at Rhedyn Coch Farm"; its flight back "from" there too, down at Blackpool', h.s.length >= 2 && h.s[0].from && h.s[0].from.code === 'BLK' && !h.s[0].to && !h.s[1].from && h.s[1].to && h.s[1].to.code === 'BLK' && !h.s.some(x => (x.to && x.to.id === farm) || (x.from && x.from.id === farm)), h.s.map(x => [x.from && x.from.code, x.to && x.to.code, x.how]));
    // (one lost hovering by a heliport: at it)
    const AX = { lat: 53.465098, lon: -2.895401 }, byPad = [[-2719, BLK.lat, BLK.lon - 0.012, 'G', 8, null, null, 'a', null], [-2659, 53.77, -3.03, 600, 60, 160, 900, 'a', null], [-2300, 53.62, -2.96, 1500, 110, 160, 0, 'a', null],
      [-1800, AX.lat + 0.03, AX.lon + 0.01, 900, 60, 180, -500, 'a', null], [-1600, AX.lat + 0.003, AX.lon, 400, 6, 180, -300, 'a', null], [-1596, AX.lat + 0.003, AX.lon, 380, 5, 180, -300, 'a', null], [-380, AX.lat + 0.02, AX.lon + 0.01, 900, 70, 20, 800, 'a', null], [-320, AX.lat + 0.05, AX.lon + 0.02, 1300, 90, 20, 700, 'a', null], [720, 53.55, -2.92, 1500, 110, 340, 0, 'a', null], [1200, 53.70, -3.00, 1200, 100, 340, -300, 'a', null], [1500, BLK.lat, BLK.lon, 'G', 5, null, null, 'a', null]];
    const hp = run(toTrace(byPad), 'heli', 'A169');
    check('... one lost hovering 330 m from Axis Business Park\'s helipad: down at it, off from it again', hp.s.length >= 2 && hp.s[0].to && hp.s[0].to.code === 'GB-1368' && hp.s[1].from && hp.s[1].from.code === 'GB-1368', hp.s.map(x => [x.from && x.from.code, x.to && x.to.code, x.how]));
  }

  // ---- 5b. the route engine: a landing in a hole ahead of the aircraft, not behind it ----------------------------------
  { // (9H-LEL, a Global 5500, 17 Nov - its real positions as the monitor kept them, from 16:00Z: off Toronto at 16:16Z, at FL450
    // over Nicaragua, lost descending through 13,800 ft on 170 degrees at 20:41Z, 70 km short of Liberia; heard again at FL430
    // heading north-east at 22:32Z: [s after 1794960000, lat, lon, ft | 'G', kt, track, ft/min])
    const LEL = [[-28293,43.675,-79.6266,"G",null,null,null],[-27941,43.6894,-79.6335,"G",null,null,null],[-27822,43.6921,-79.638,"G",null,null,null],[-27813,43.6895,-79.6418,0,null,null,null],[-27701,43.6273,-79.7125,4500,null,null,null],[-27576,43.4723,-79.734,10000,null,null,null],[-27510,43.3671,-79.7487,12100,null,null,null],[-26716,41.6738,-79.9391,34000,null,null,null],[-25890,39.6991,-80.0186,43000,null,null,null],[-25170,38.0137,-80.2117,43000,null,null,null],[-24450,36.3554,-80.4296,43000,null,null,null],[-23782,34.8159,-80.7177,43000,null,null,null],[-23125,33.3507,-81.0107,43000,null,null,null],[-22410,31.7782,-81.2141,43000,null,null,null],[-21748,30.3157,-81.0928,43000,null,null,null],[-21085,28.8635,-80.9431,43000,null,null,null],[-20348,27.2985,-80.5606,43000,null,null,null],[-19520,25.5193,-80.7683,43000,null,null,null],[-18675,23.7448,-80.9127,43000,null,null,null],[-17960,22.3055,-81.256,44800,null,null,null],[-16902,20.3713,-82.2551,45000,null,null,null],[-15822,18.3703,-83.272,45000,null,null,null],[-14622,16.264,-84.2887,45000,null,null,null],[-13477,14.1685,-85.2792,45000,null,null,null],[-12823,12.9404,-85.8428,45000,null,null,null],[-12703,12.709,-85.9389,43800,null,null,null],[-12582,12.4778,-86.0347,38800,null,null,null],[-12578,12.472182,-86.037019,38675,449,202.11,-2528],[-11896,11.128326,-85.878091,13800,380.3,170.46,-1568],[-5225,13.109024,-84.52663,42975,508.6,28.03,-192],[-3807,16.072906,-82.893147,43000,506.1,28.44,32],[-3796,16.096436,-82.879992,43000,506.1,28.44,-64]];
    const D = 1794960000, tr = LEL.map(r => [D + r[0], r[1], r[2], r[3] === 'G' ? 'ground' : r[3], r[4], r[5], 0, r[6]]);
    const w = run(tr, 'heavybiz', 'GL5T'), LIR = E.byIcao('MRLB'), MGA = E.byIcao('MNMG'), YYZ = E.byIcao('CYYZ');
    check('9H-LEL lost going down 70 km short of Liberia on 170 degrees, heard again climbing away north-east: "Toronto -> Liberia", then off from Liberia - not Managua, 117 km behind it', w.s.length === 2 && w.s[0].from && w.s[0].from.id === YYZ.id && w.s[0].to && w.s[0].to.id === LIR.id && w.s[1].from && w.s[1].from.id === LIR.id, w.s.map(x => [x.from && x.from.code, x.to && x.to.code]));
    const pts = E.parseTrace({ timestamp: 0, trace: tr }), a = pts.find(p => p.t === D - 11896), b = pts.find(p => p.t === D - 5225);
    const g1 = E.landingInGap(a, b, { cls: 'heavybiz', type: 'GL5T', aDesc: false, bClimb: false });
    check('... the departure after the hole (the route code\'s "took off from ..., out of ADS-B coverage"): Liberia - its own descent rate saying it was going down, its last point before eleven minutes earlier', !!g1 && g1.airport.id === LIR.id, g1 && g1.airport.code);
    const g0 = E.landingInGap(Object.assign({}, a, { vr: null }), b, { cls: 'heavybiz', type: 'GL5T', aDesc: false, bClimb: false });
    check('... with no sign at all that it was going down, as before (where it went is not known from its heading then)', !!g0 && g0.airport.id === MGA.id, g0 && g0.airport.code);
  }

  // ---- 6. the monitor: a flight first heard in the air after a restart --------------------------------------------------
  const M = require('../monitor/monitor.cjs'); M.loadEngine();
  { const ML = M.E.byIcao('EGGP'), hex = '402195', key = l => Math.round((l.tOff || l.tStart) / 600);
    // (as the monitor kept it before its restart at 15:51:36: off Liverpool's runway 27 at 15:34:46, still flying)
    const before = { hex, reg: 'G-RVNA', type: 'PA38', cs: 'GRVNA', ladd: false, from: { id: ML.id, code: 'LPL', conf: 'ground' }, to: null, tStart: 1794929686, tEnd: 1794930690, tOff: 1794929686, tOn: null, ended: false, open: true, startedOnGround: true, startLat: 53.33424, startLon: -2.83669, startAlt: null, startGs: 62, endLat: 53.02, endLon: -2.62, endAlt: 3500, endGs: 88, maxAlt: 3575, pathKm: 40, how: 'open', endRules: 2, rwyV: 2, rwyOff: '27' };
    M.legs.set(hex, new Map([[key(before), before]]));
    const feed = rows => { for (const r of rows) M.ingest({ hex, r: 'G-RVNA', t: 'PA38', flight: 'GRVNA', lat: r[1], lon: r[2], alt_baro: r[3] === 'G' ? 'ground' : r[3], gs: r[4], track: r[5], baro_rate: r[6], alt_geom: r[8], type: SRC[r[7]] || r[7], seen_pos: 0 }, T0 + r[0]); };
    const flights = () => [...M.legs.get(hex).values()].filter(l => l.tStart >= 1794929000).sort((a, b) => a.tStart - b.tStart);
    const states = [];
    for (const upTo of [966, 1096, 1203, 1438, 2403]) { feed(RVNA.filter(r => r[0] <= upTo && r[0] > (states.length ? states[states.length - 1].upTo : -1e9))); M.buildLegs(hex, T0 + Math.min(upTo, 1203) + 5); states.push({ upTo, f: flights().map(l => [l.from && l.from.code, l.to && l.to.code, l.open, l.tStart]) }); }
    check('G-RVNA\'s real positions after the restart, built again as they come (15:56, 15:58, 16:20): one flight, from Liverpool, open - no "? -> ?" beside it, no copy left open', states.every(x => x.f.length === 1 && x.f[0][0] === 'LPL' && x.f[0][2] === true && x.f[0][3] === 1794929686), states);
    // (down at Liverpool at 16:21, off again at 16:40 - M-ARNZ's and G-NHVT's turn-rounds: the one before closed)
    feed([[2479, 53.333885, -2.844694, 'G', 10, 90, null, 'n', null], [2540, 53.3339, -2.8440, 'G', 0, null, null, 'n', null]]); M.buildLegs(hex, T0 + 2600);
    const down = flights();
    feed([[3600, 53.3339, -2.8440, 'G', 3, null, null, 'n', null], [3660, ML.lat, ML.lon + 0.01, 'G', 60, 270, null, 'n', null], [3720, 53.33, -2.89, 900, 75, 270, 700, 'n', null], [3840, 53.31, -2.98, 2000, 80, 260, 500, 'n', null]]); M.buildLegs(hex, T0 + 3845);
    const next = flights();
    check('... down at Liverpool, then off again: "Liverpool -> Liverpool", closed, and the next flight from Liverpool - nothing else open', down.length === 1 && down[0].to && down[0].to.code === 'LPL' && next.length === 2 && next[0].from.code === 'LPL' && next[0].to.code === 'LPL' && next[0].open === false && next[1].from && next[1].from.code === 'LPL' && next[1].open === true, { down: down.map(l => [l.from && l.from.code, l.to && l.to.code, l.open]), next: next.map(l => [l.from && l.from.code, l.to && l.to.code, l.open]) });
  }

  // ---- 7. the monitor: every flight its scans see, kept -----------------------------------------------------------------
  { const T = Math.floor(Date.now() / 1000) - 600, f32 = Math.fround, id = 0x3d00a1b2;
    const fl = (o) => Object.assign({ id, hex: '402195', reg: 'G-RVNA', cs: 'GRVNA', type: 'PA38', lat: f32(53.1035), lon: f32(-2.5848), alt: 2300, spd: 85, trk: 312, ts: T, gnd: false, src: 0 }, o);
    const n1 = M.scanPut([fl({}), fl({ id: id + 1, hex: '4ca123', reg: 'EI-ABC', cs: 'RYR1', type: 'B738', alt: 0, gnd: true, spd: 12 })], Date.now());
    const n2 = M.scanPut([fl({}), fl({ ts: T + 60, lat: f32(53.11), alt: 2325, src: 1 }), fl({ id: id + 2, ts: T + 30, src: 4 })], Date.now());
    check('a scan\'s flights kept, every one - an airliner on the ground too; the same report from the next scan once; FR24\'s estimated position not kept, counted', n1 === 2 && n2 === 1 && M.fr24scan.pending === 3 && M.SCN.estimated === 1, { n1, n2, pending: M.fr24scan.pending, est: M.SCN.estimated });
    // (its trail as fr24raw keeps it - the same second with more figures - read together)
    M.fr24raw.put(id, { hex: '402195', reg: 'G-RVNA' }, [{ t: T, lat: f32(53.1035), lon: f32(-2.5848), alt: 2300, gs: 85, trk: 312, vr: 447 }, { t: T - 60, lat: f32(53.09), lon: f32(-2.58), alt: 2250, gs: 84, trk: 310 }]);
    const C = M.fr24scan.COLS, ci = k => C.indexOf(k), j0 = M.answer(new URL('http://x/fr24raw?f=' + id.toString(16)), T);
    check('/fr24raw: the flight from every store, each second once - the report with more figures, those it lacks from the other (the trail\'s climb rate, the scan\'s source)', j0.p.length === 3 && j0.p[1][ci('vr')] === 447 && j0.p[1][ci('src')] === 0 && j0.p[2][ci('src')] === 1 && j0.p[2][ci('alt')] === 2325 && j0.m.cs === 'GRVNA' && C.includes('src'), j0.p);
    M.fr24scan.flush(T + 120); M.fr24raw.flush(T + 120);
    const dir = path.join(process.env.MON_STORE, 'fr24scan'), day = new Date((T + 120) * 1000).toISOString().slice(0, 10);
    const gz = fs.readFileSync(path.join(dir, day + '.gzl')), member = JSON.parse(zlib.gunzipSync(gz).toString('utf8')), m0 = member[id.toString(16)];
    const j1 = M.answer(new URL('http://x/fr24raw?f=' + id.toString(16)), T);
    check('... written in the column form - read back the same, every figure exactly as it came (FR24\'s single-precision positions)', m0 && m0.z && !m0.p && JSON.stringify(j1.p) === JSON.stringify(j0.p) && j1.p[2][1] === f32(53.11), { m0, p: j1.p });
    const st = M.answer(new URL('http://x/status'), T).fr24.fr24Scan;
    check('/status: the scans\' store - days kept, the disk kept free, the cruise scan\'s every', st && st.keepDays === 365 && st.minFreeGb === 30 && st.estimated === 1 && st.cruise && st.cruise.every === 180 && st.members >= 1, st);
  }
  { // (the airliners at cruise: the services the world scan leaves out, the kept positions only; none after FR24 pushed back)
    const cl = M.fr24Client(), asked = [], was = cl.liveFeed;
    cl.liveFeed = async q => { asked.push(q); return { flights: [{ id: 0x3d00c001, lat: Math.fround(51.5), lon: Math.fround(-0.5), alt: 37000, spd: 450, trk: 90, ts: Math.floor(Date.now() / 1000), gnd: false, src: 0, hex: '400abc', reg: 'G-EUUA', cs: 'BAW1', type: 'A320' }], serverTime: 0 }; };
    const pu = cl.st.pauseUntil; cl.st.pauseUntil = 0;
    const n = await M.cruiseRound();
    check('the cruise scan: passenger, cargo, balloons, gliders, drones - in the air, every region asked; its flights kept', n === 1 && asked.length === 7 && asked.every(q => JSON.stringify(q.services) === '[0,1,6,7,8]' && q.traffic === 2) && M.SCN.cruise.flights === 1, { n, asked: asked.length, s: asked[0] && asked[0].services });
    // (FR24 answering every request full - 1,490 flights and more: split no further than its cap, 60 requests)
    asked.length = 0; const full = Array.from({ length: 1495 }, (_, k) => ({ id: 0x3e000000 + k, lat: Math.fround(50 + k / 1000), lon: Math.fround(k / 1000), alt: 35000, spd: 440, trk: 90, ts: Math.floor(Date.now() / 1000), gnd: false, src: 0 }));
    cl.liveFeed = async q => { asked.push(q); return { flights: full, serverTime: 0 }; };
    await M.cruiseRound();
    check('... FR24 answering every request full: a round asks 60 times at most (its busiest corners left split no further)', asked.length === 60 && M.SCN.cruise.capped === true && M.SCN.cruise.requests === 60, { asked: asked.length, c: M.SCN.cruise });
    asked.length = 0; cl.st.pauseUntil = Date.now() - 3600e3;
    const n2 = await M.cruiseRound();
    check('... FR24 having pushed back within the last day: not asked', n2 === 0 && asked.length === 0 && /pushed back/.test(M.SCN.cruise.off), M.SCN.cruise.off);
    cl.liveFeed = was; cl.st.pauseUntil = pu;
  }
  { // (the disk short of room: the store's oldest day let go first - never the day before or today)
    const dir = path.join(process.env.MON_STORE, 'fr24scan');
    for (const d of ['2026-01-02', '2026-01-03']) { fs.writeFileSync(path.join(dir, d + '.gzl'), 'x'); fs.writeFileSync(path.join(dir, d + '.idx'), ''); }
    const a = M.fr24scan.pruneOldest('2026-01-03'), b = M.fr24scan.pruneOldest('2026-01-03');
    check('the disk short of room: the scans\' oldest day removed, one at a time - none on or after the day given', a === '2026-01-02' && b === '' && !fs.existsSync(path.join(dir, '2026-01-02.gzl')) && fs.existsSync(path.join(dir, '2026-01-03.gzl')), { a, b });
  }
  // ---- 9. the route code, in the browser: a plan spent in a hole; FR24's own departure for an N/A flight --------------
  { let JSDOM = null, FIDB = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); FIDB = require(path.join(NM, 'fake-indexeddb')); } catch (e) { console.log('(skipped the browser: no jsdom)'); }
    const DIST = path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js');
    if (JSDOM && fs.existsSync(DIST)) {
      const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8'), SRC = fs.readFileSync(DIST, 'utf8');
      const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/13.1,-84.5/7', runScripts: 'dangerously', pretendToBeVisual: true }).window;
      win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController; win.Blob = Blob;
      win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
      win.caches = { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => false }) };
      const answer = u => /flightradar24\.com\/mobile\/airports\/format/.test(u) ? [200, AIRPORTS] : [404, ''];
      win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const a = answer(u); return Promise.resolve(new Response(a[1] || '', { status: a[0] })); };
      win.GM_xmlhttpRequest = o => { const a = answer(o.url); setTimeout(() => o.onload && o.onload({ status: a[0], responseText: a[1], response: a[1] }), 2); return { abort() {} }; };
      win.unsafeWindow = win; win.GM_notification = () => {}; win.console.log = () => {}; win.console.debug = () => {};
      win.eval(SRC);
      const L = win.__tweeksLadd; for (let i = 0; i < 3000 && !(L && L.engine.airports.length > 5000); i++) await sleep(20);
      const ap = c => L.engine.byIcao(c), LIR = ap('MRLB'), YYZ = ap('CYYZ'), SJO = ap('MROC');
      // (where 9H-LEL was last seen before the hole its present track began after: 20:41:44Z, 13,800 ft)
      const gapFrom = { t: 1794948104, lat: 11.128326, lon: -85.878091, alt: 13800, gs: 380, trk: 170 };
      check('a plan whose flight ended in the hole the present track began after - its destination within reach of where it was going down: the flight before\'s (9H-LEL\'s Toronto -> Liberia, FR24\'s board row for the one id it kept)', L.planSpent({ originId: YYZ.id, destId: LIR.id, fr24: true }, gapFrom) === true);
      check('... not this flight\'s own plan from there, nor a local flight\'s, nor any with no hole before the track, nor one for a field out of reach', L.planSpent({ originId: LIR.id, destId: YYZ.id }, gapFrom) === false && L.planSpent({ originId: LIR.id, destId: LIR.id }, gapFrom) === false && L.planSpent({ originId: YYZ.id, destId: LIR.id }, null) === false && L.planSpent({ originId: LIR.id, destId: SJO.id }, Object.assign({}, gapFrom, { alt: 0, lat: 13.5, lon: -84.0 })) === false);
      // (N89P, a Falcon 2000 out of San Jose on 17 Nov, no schedule: FR24's map gives its departure in its LiveFeed record)
      const id = 0x3d22aa01;
      L.noteNa([{ id, lat: 12.9, lon: -84.8, alt: 37675, spd: 431, trk: 9, ts: Math.floor(Date.now() / 1000), gnd: false, cs: 'N89P', reg: 'N89P', type: 'F2TH', hex: 0xac4440, from: 'SJO' }], Date.now());
      const sp = L.schedPlan(id);
      check('an ordinary flight FR24 shows from San Jose with no destination and no schedule (N89P): its departure from FR24\'s own map - a plan from FR24, so above any guess of the route code\'s (it was "from Bluefields, out of ADS-B coverage")', !!sp && sp.originId === SJO.id && sp.fr24 === true && !sp.destId, sp);
      L.noteNa([{ id: id + 1, lat: 12.9, lon: -84.8, alt: 37675, spd: 431, trk: 9, ts: Math.floor(Date.now() / 1000), gnd: false, cs: 'N89Q', reg: 'N89Q', type: 'F2TH', hex: 0xac4441, from: '' }], Date.now());
      check('... one FR24 gives no departure for: none from here (the route code works it out, as before)', L.schedPlan(id + 1) === null);
      win.close();
    }
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
