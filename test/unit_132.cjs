// 1.3.2 - the monitor no longer stops for a minute every five, and the OurAirports airports work in FR24's own map:
//   - the scores' five-minute sweep: its log of a flight from what is held in memory (no file, no year of days read), and
//     a slice at a time - the same flights finished as the sweep in one go
//   - a stall says how much of it was work and how much was waiting (prof.cjs)
//   - every airport's runways and frequencies from OurAirports (oarwy.cjs): by its ident and its other codes; a closed
//     airport's kept; helipads not; the files kept in the store, asked for by ETag, never replaced by something else
//   - the airports list's file kept in the store, never written into the checkout (1.3.1 did: the next deploy refused)
//   - an airport answer for an OurAirports airport: its runways; for one the engine does not know (a heliport) too
//   - FR24's map: the pins stay when an aircraft or an airport is opened (FR24's address then says nothing of where the map
//     is); the airport its window is on kept in FR24's own tables; the window's codes, time zone, sunrise and sunset;
//     FR24's newer airport address answered; the runway section never FR24's padlocked picture; "More" pointed at the page
//     these airports' pages are made from, and FR24's server's detour to its airport search undone
// usage: node test/unit_132.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path'), os = require('os');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon132-')); process.env.MON_PORT = '0';
global.fetch = async () => ({ status: 404, ok: false, headers: { get: () => null }, text: async () => '', json: async () => null });
const M = require('../monitor/monitor.cjs'), PR = require('../monitor/prof.cjs'), RW = require('../monitor/oarwy.cjs');
const { createScores } = require('../monitor/scores.cjs'), { createOaAirports } = require('../monitor/oaap.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = n => fs.mkdtempSync(path.join(os.tmpdir(), n));

(async () => {
  // ---- 1. the scores' sweep ------------------------------------------------------------------------------------------------
  { const ltn = E.byIcao('EGGW').id, nce = E.byIcao('LFMN').id, T = Math.floor(Date.now() / 1000) - 6 * 3600;
    const F = (id, hex) => ({ id, hex, kind: 'live', rec: { reg: 'N' + id, type: 'GLF6' }, trail: Array.from({ length: 40 }, (_, i) => ({ t: T + i * 30, lat: 51 - i * 0.02, lon: 0.2 + i * 0.03, alt: 30000 })) });
    const logs = new Map(); let asked = 0;
    const mk = () => createScores({ store: tmp('sc132-'), E, logOf: hex => { asked++; const t = Date.now(); while (Date.now() - t < 1) { /* a log takes a moment to put together */ } return logs.get(hex) || []; } });
    const A = mk(), B = mk();
    // (300 flights followed and not heard of again; every third found in the log, landed at Nice)
    for (let i = 0; i < 300; i++) {
      const f = F(1000 + i, 'a' + String(10000 + i));
      for (const S of [A, B]) for (let m = 0; m <= 20; m += 5) S.note(f, { originId: ltn, destId: nce, destP: 70, destConf: 'probable', phase: 'level' }, T + m * 60);
      if (i % 3 === 0) logs.set(f.hex, [{ tStart: T - 600, tEnd: T + 5000, tOn: T + 4900, from: { id: ltn }, to: { id: nce, conf: 'ground' } }]);
    }
    const before = A.open.size; asked = 0;
    A.sweep(T + 3 * 3600); const askedA = asked; asked = 0;
    let turns = 0; const tick = setInterval(() => { turns++; }, 1);
    const both = [B.sweepSlow(T + 3 * 3600), B.sweepSlow(T + 3 * 3600)], r = await Promise.all(both);
    clearInterval(tick);
    const sum = S => { const s = S.summary(T + 3 * 3600).week; return [S.open.size, s.flights, s.moments, s.rightPct]; };
    check('the scores\' sweep a slice at a time: the same flights finished and scored as in one go, each flight\'s log asked for once; a second sweep while one runs does nothing', before === 300 && JSON.stringify(sum(A)) === JSON.stringify(sum(B)) && sum(A)[1] === 100 && askedA === 300 && asked === 300 && r.filter(x => x === false).length === 1, { a: sum(A), b: sum(B), askedA, asked, r });
    check('... and the server\'s timers turn while it runs (in one go, 300 logs put together held it for the whole of it)', turns >= 5, turns);
    // (the monitor's own: a flight's log from the legs it holds - nothing read from the disk)
    const hex = 'abc132', t0 = T - 3600, legs = M.legs; legs.set(hex, new Map([[String(t0), { hex, tStart: t0, tOff: t0 + 60, tEnd: t0 + 3000, tOn: t0 + 2900, from: { id: ltn, sure: true }, to: { id: nce, sure: true }, pts: [] }]]));
    const rd = fs.readFileSync, rdd = fs.readdirSync; let reads = 0; fs.readFileSync = function () { reads++; return rd.apply(fs, arguments); }; fs.readdirSync = function () { reads++; return rdd.apply(fs, arguments); };
    let log = null; try { log = M.recentLog(hex); } finally { fs.readFileSync = rd; fs.readdirSync = rdd; }
    check('... the log the monitor gives the sweep: the flights it holds of the aircraft, where each ended - no file read for it (the whole log, a year of days of the world\'s, was: the sweep held the server for over a minute)', Array.isArray(log) && log.length === 1 && log[0].to && log[0].to.id === nce && reads === 0 && M.recentLog('nohex1').length === 0, { n: log && log.length, reads });
    legs.delete(hex); }

  // ---- 2. a stall: how much of it was work -------------------------------------------------------------------------------
  { const cf = (functionName, url, lineNumber) => ({ functionName, url: url || '', lineNumber: lineNumber || 0 });
    const profile = { startTime: 0, nodes: [{ id: 1, callFrame: cf('(root)'), children: [2, 3] }, { id: 2, callFrame: cf('(idle)') }, { id: 3, callFrame: cf('sweep', '/x/monitor/monitor.cjs', 99), children: [4] }, { id: 4, callFrame: cf('readFileSync', 'node:fs', 1) }],
      samples: [], timeDeltas: [] };
    // (a second of work in sweep, then four seconds idle, then a second of work: 20 ms samples)
    for (let i = 0; i < 300; i++) { profile.samples.push(i < 50 || i >= 250 ? 4 : 2); profile.timeDeltas.push(20000); }
    const d = PR.digest(profile, 1000000, [[1000000, 1006000]]), s = d.stalls[0];
    check('a stall of six seconds with four of them idle: said so - the work in it and the waiting apart, the job and the function named', !!s && s.ms === 6000 && Math.abs(s.busyMs - 2000) <= 40 && Math.abs(s.idleMs - 4000) <= 40 && /sweep monitor\.cjs:100/.test(s.job) && /readFileSync/.test(s.hot[0][0]), s); }

  // ---- 3. OurAirports' runways and frequencies of every airport ---------------------------------------------------------
  { const acsv = ['"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"',
      '1,"EGOW","small_airport","RAF Woodvale",53.5816,-3.05552,37,"EU","GB","GB-ENG","Southport","no","EGOW",,"EGOW",,,,',
      '2,"US-0009","small_airport","Ski Valley Airpark",44.93,-116.17,5110,"NA","US","US-ID","McCall","no",,,"48ID","48ID",,,',
      '3,"EGBE","closed","Coventry Airport",52.37,-1.48,267,"EU","GB","GB-ENG","Coventry","no","EGBE","CVT","EGBE",,,,',
      '4,"GB-0002","small_airport","Some Strip",51,-1,100,"EU","GB","GB-ENG",,"no",,,,,,,',
      '5,"XX-0001","closed","Old Field",10,10,0,"AF","XX","XX-A",,"no","48ID",,,,,,'].join('\n') + '\n';
    const rcsv = ['"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"',
      '10,1,"EGOW",3505,148,"ASP",0,0,"08",53.577499,-3.06816,34,83,1175,"26",53.579102,-3.05226,30,263,162',
      '11,1,"EGOW",5405,150,"ASP",0,0,"03",53.575298,-3.06383,32,33,,"21",53.5882,-3.05133,35,213,',
      '12,1,"EGOW",100,100,"CON",0,0,"H1",,,,,,,,,,,',
      '13,2,"US-0009",2500,75,"TURF",0,0,"16",,,,,,"34",,,,,',
      '14,3,"EGBE",6588,151,"ASP",1,0,"05",,,,,,"23",,,,,',
      '15,4,"GB-0002",1500,60,"GRS",0,1,"09",,,,,,"27",,,,,',
      '16,5,"XX-0001",900,30,"DIRT",0,0,"01",,,,,,"19",,,,,'].join('\n') + '\n';
    const fcsv = ['"id","airport_ref","airport_ident","type","description","frequency_mhz"', '20,1,"EGOW","APP","APP",121', '21,1,"EGOW","TWR","TWR",119.75', '22,2,"US-0009","CTAF","CTAF",122.9', '23,1,"EGOW","TWR","bad",0'].join('\n') + '\n';
    const d = RW.build(rcsv, fcsv, acsv), w = d.info.EGOW || [];
    check('OurAirports\' runways of every airport: an airport\'s in full, the longest first, each end\'s heading, elevation and threshold; a helipad left out', w.length === 2 && w[0][0] === '03' && w[0][1] === '21' && w[0][2] === 5405 && w[0][4] === 'ASPH' && w[0][9] === 33 && w[1][10] === 1175 && w[1][11] === 53.5775 && d.airports === 5 && d.runways === 6, { w, n: d.airports, r: d.runways });
    check('... found by its other codes too (its GPS code "48ID" for "US-0009") - but a closed airport\'s old codes are not its own (another has them now), while its runways stay under its ident (FR24 still lists Coventry)', d.info['48ID'] === d.info['US-0009'] && d.info['48ID'][0][2] === 2500 && d.info.EGBE.length === 1 && d.info['XX-0001'].length === 1 && d.info['GB-0002'][0][7] === 1, Object.keys(d.info));
    check('... its frequencies: tower before approach, one with no frequency left out; by its other codes as well', JSON.stringify(d.freqs.EGOW) === JSON.stringify([['TWR', 'TWR', 119.75], ['APP', 'APP', 121]]) && d.freqs['48ID'][0][2] === 122.9, d.freqs);
    const slow = await RW.buildSlow(rcsv, fcsv, acsv);
    check('... worked out a slice at a time: the same', JSON.stringify(slow) === JSON.stringify(d));
    // (the real files of the checkout, made with the same code: every airport's)
    const info = JSON.parse(fs.readFileSync(path.join(DATA, 'runway_info.json'), 'utf8'));
    check('the checkout\'s own data: every airport\'s runways - RAF Woodvale\'s three (1.3.1 had FR24\'s own airports only: "No runways known"), Liverpool\'s as before', (info.EGOW || []).length === 3 && (info.EGGP || []).length >= 1 && Object.keys(info).length > 30000, { egow: (info.EGOW || []).length, n: Object.keys(info).length });

    // (the store's files: asked for, kept, asked for again by ETag)
    const dir = tmp('oarw132-'), sent = []; let mode = 'ok';
    const big = (head, n) => head + '\n' + Array.from({ length: n }, (_, i) => `${i},1,"EGOW",1000,50,"ASP",0,0,"0${i % 9}",,,,,,"1${i % 9}",,,,,`).join('\n') + '\n';
    const fetchFn = async (url, o) => {
      sent.push([url.split('/').pop(), o.headers['If-None-Match'] || '']);
      const name = url.split('/').pop(), etag = '"e-' + name + '-' + mode + '"';
      if (o.headers['If-None-Match'] === etag) return { status: 304, headers: { get: () => etag }, text: async () => '' };
      const body = mode === 'bad' ? '<html>not found</html>' : name === 'runways.csv' ? (mode === 'new' ? big(rcsv.split('\n')[0], 12) : rcsv) : fcsv;
      return { status: 200, headers: { get: k => (k === 'etag' ? etag : null) }, text: async () => body };
    };
    const O = RW.createOaRunways({ storeDir: dir });
    check('the monitor\'s own copies: none in its store yet - the checkout\'s data stands', O.have() === false && O.buildSync('') === null);
    const ch1 = await O.refresh(fetchFn, { force: true, min: 3 });
    const b1 = O.buildSync(''), ch2 = await O.refresh(fetchFn, { force: true, min: 3 });
    check('... asked for: both files written into the store, the runways worked out from them; asked again: the server says "the same" (by the ETag kept with them) - nothing written', ch1 === true && O.have() && b1.info.EGOW.length === 2 && ch2 === false && O.stats.fetched === 2 && O.stats.unchanged === 2 && sent[2][1] === '"e-runways.csv-ok"' && sent[3][1] === '"e-airport-frequencies.csv-ok"', { sent, st: O.stats });
    mode = 'bad'; const ch3 = await O.refresh(fetchFn, { force: true, min: 3 });
    check('... something that is not the file (an error page): never put in its place', ch3 === false && O.stats.fails === 2 && fs.readFileSync(O.fileOf('runways'), 'utf8') === rcsv, O.stats);
    mode = 'new'; const O2 = RW.createOaRunways({ storeDir: dir }), ch4 = await O2.refresh(fetchFn, { force: true, min: 3 }), b4 = await O2.build('');
    check('... a monitor started again: asks by the ETag it kept; a new file taken, the runways made again from it', ch4 === true && b4.info.EGOW.length === 12 && O2.stats.fetched === 1, { st: O2.stats, n: b4.info.EGOW.length });
    const gate = await O2.refresh(fetchFn, { min: 3 });
    check('... not asked again within the hour', gate === false);

    // ---- 4. the airports list's file: in the store, never in the checkout ------------------------------------------------
    const dataDir = tmp('oadata132-'), storeDir = tmp('oastore132-'), repo = path.join(dataDir, 'oa_airports.csv');
    const row = (i, ident, name, lat, lon) => `${i},"${ident}","small_airport","${name}",${lat},${lon},10,"EU","GB","GB-ENG","Town","no",,,,,,,`;
    const head = acsv.split('\n')[0], old = head + '\n' + row(1, 'GB-9001', 'Old Strip', 60.5, -30.5) + '\n';
    const fresh = head + '\n' + Array.from({ length: 50010 }, (_, i) => row(i + 1, 'ZZ-' + i, 'Strip ' + i, 60 + (i % 100) / 1000, -30 - Math.floor(i / 100) / 1000)).join('\n') + '\n';
    fs.writeFileSync(repo, old);
    const P = createOaAirports({ E, dataDir, storeDir });
    const n0 = P.rows().length, f0 = P.file;
    let hdr = null; const get = async (u, o) => { hdr = o.headers; return o.headers['If-None-Match'] === '"a1"' ? { status: 304, headers: { get: () => '"a1"' }, text: async () => '' } : { status: 200, headers: { get: k => (k === 'etag' ? '"a1"' : null) }, text: async () => fresh }; };
    const chA = await P.refresh(get, { force: true });
    check('OurAirports\' airports file asked for: the new one kept in the monitor\'s store and read from there - the checkout\'s own copy not touched (1.3.1 wrote over it: "files of the checkout were changed by hand", and the next deploy stopped)', n0 === 1 && f0 === repo && chA === true && fs.readFileSync(repo, 'utf8') === old && P.file === path.join(storeDir, 'oa_airports.csv') && fs.readFileSync(P.file, 'utf8') === fresh && P.rows().length > 40000, { n: P.rows().length, file: path.basename(path.dirname(P.file)) });
    const P2 = createOaAirports({ E, dataDir, storeDir }), chB = await P2.refresh(get, { force: true });
    check('... a monitor started again: the list from the store\'s file, asked for by its ETag - "the same"', P2.file === P.file && P2.rows().length === P.rows().length && chB === false && hdr['If-None-Match'] === '"a1"' && P2.stats.unchanged === 1, { n: P2.rows().length, hdr });
  }

  // ---- 5. an airport answer for an OurAirports airport ----------------------------------------------------------------------
  { const now = Math.floor(Date.now() / 1000), wood = E.byIcao('EGOW');
    const a = wood && wood.id >= 1e7 ? M.airportAnswer(wood.id, now, 7, 14) : null;
    check('RAF Woodvale (an OurAirports airfield): its three runways and its frequencies in the monitor\'s airport answer', !!a && a.known === true && a.runways.length === 3 && a.freqs.length >= 1 && a.runways.some(r => r[0] === '03' && r[1] === '21'), a && { n: a.runways.length, f: a.freqs.length });
    const heli = M.OAAP.rows().find(r => r[9] === 'H' && !E.byId(r[0]));
    const h = heli ? M.airportAnswer(heli[0], now, 7, 14) : null;
    check('... one the route engine does not know (a heliport of the list): known all the same - 1.3.1 said "not known" and its window had nothing', !!heli && !!h && h.known === true && Array.isArray(h.runways) && h.icao === String(heli[2]).toUpperCase(), heli && { id: heli[0], code: heli[1], h });
    M.APT.set({ [String(heli[2]).toUpperCase()]: [['H1X', '', 80, 80, 'CONC', 'CON', 1, 0, 10, 0, null, null, null, null, null, null, null, null]] }, {});
    M.airportAnswer(heli[0], now, 7, 14);
    check('... the runways made again from newer files (APT.set): what the answers give from then on', M.APT.runwaysOf(heli[2]).length === 1 && M.APT.runwaysOf('EGOW').length === 0 && M.APT.endsOf('EGOW').length === 0);
    M.APT.load(DATA); }

  // ---- 6. FR24's map and its airport window (the page's part on its own) ------------------------------------------------
  let JSDOM = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); } catch (e) { console.log('(skipped the page: no jsdom)'); }
  if (JSDOM) {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
    const PI = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0];
    const page = (url, html, before) => {
      const w = new JSDOM(html || '<!doctype html><html><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window; let H = null; const posts = [];
      w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob;
      w.fetch = () => Promise.reject(new Error('offline')); w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
      if (before) before(w);
      w.eval('(' + PI + ')()');
      return { w, H: () => H, posts, send: data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' })) };
    };
    const oaRows = [[17000001, 'EGXX', 'EGXX', 'Walney Strip', 'Barrow-in-Furness', 530, 54.2, -3.2, 50, 'S'], [17000002, 'GB-0999', 'GB-0999', 'Some Heliport', 'Ulverston', 530, 54.19, -3.09, 30, 'H'], [17000003, 'WSX', 'EGWS', 'Far Field', '', 530, 54.1, -3.3, 0, 'S'], [17000004, 'ZZZZ', 'ZZZZ', 'Elsewhere', '', 530, 10.0, 20.0, 0, 'S']];
    const ref = { id: 530, iata: 'BWF', icao: 'EGNL', name: 'Barrow', city: 'Barrow', country: 'United Kingdom', countryId: 235, lat: 54.13, lon: -3.26, size: 3000, timezone: { abbr: 'GMT', abbrName: null, isDst: false, name: 'Europe/London', offset: 0, offsetHours: '0:00' } };
    const fr24Form = a => ({ id: a.id, iata: a.iata, icao: a.icao, name: a.name, latitude: a.lat, longitude: a.lon, altitude: a.alt, city: a.city, country: a.country, countryId: a.countryId, size: a.size, timezoneName: a.timezone.name, timezoneCode: a.timezone.abbr, timezoneDST: a.timezone.isDst, timezoneOffset: a.timezone.offset, timezoneOffsetHours: a.timezone.offsetHours, videoStream: null });
    // (a page with FR24's airports store as FR24 keeps it - its own airports only: the list it holds was fetched before
    // the OurAirports airports came)
    const mapPage = url => {
      const P = page(url), H = P.H();
      H.acceptOa({ rows: oaRows, sig: '4.1.1', refs: { 530: 'bwf' } });
      const list = { rows: [ref].concat(Array.from({ length: 120 }, (_, i) => ({ id: 1000 + i, iata: 'A' + i, icao: '', name: 'X', lat: 0, lon: 0, timezone: ref.timezone }))) };
      const own = list.rows.map(fr24Form);
      H.patchList('airports', list);
      const store = { airports: own.slice(), airportsById: new Map(own.map(a => [a.id, a])), airportsByIata: new Map(own.map(a => [a.iata, a])) };
      P.w.document.getElementById('app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['airports', store]]) } } } };
      H.setOaBase(store.airports.slice());
      return { P, H, store, pins: () => store.airports.filter(a => a.id >= 1e7).map(a => a.iata).sort() };
    };
    { const { P, H, store, pins } = mapPage('https://www.flightradar24.com/54.15,-3.20/10');
      // (FR24's feed asks for the area on screen: at zoom 10, some 2.6 degrees of longitude across)
      const box = { n: 54.9, s: 53.4, w: -4.5, e: -1.9 };
      H.setViewBox(box); H.oaMap(); H.oaMap();
      const at0 = pins();
      check('FR24\'s map zoomed in at Barrow: the OurAirports airports in view pinned, each with its identifier where FR24 keeps an ICAO code (the map\'s labels set to "ICAO" showed nothing)', JSON.stringify(at0) === '["EGXX","GB-0999","WSX"]' && store.airports.find(a => a.iata === 'GB-0999').icao === 'GB-0999' && store.airports.find(a => a.iata === 'WSX').icao === 'EGWS' && store.airports.find(a => a.iata === 'EGXX').icao === 'EGXX', at0);
      // (an aircraft clicked: FR24's address is the flight's)
      P.w.history.pushState({}, '', '/N123AB/3a1b2c3d'); H.oaMap();
      check('an aircraft clicked - FR24\'s address is the flight\'s, not the map\'s: the pins stay (1.3.1 took every one off)', JSON.stringify(pins()) === JSON.stringify(at0), pins());
      // (an FR24 airport's window opened)
      P.w.history.pushState({}, '', '/airport/bwf'); H.oaMap();
      check('... an FR24 airport\'s window opened: they stay', JSON.stringify(pins()) === JSON.stringify(at0), pins());
      // (the map dragged away with the window open: the feed's area says where it is now)
      H.setViewBox({ n: 10.75, s: 9.25, w: 18.7, e: 21.3 }); H.oaMap();
      check('... the map moved with it open: the pins follow the map (the area FR24 asks its feed for)', JSON.stringify(pins()) === '["ZZZZ"]', pins());
      // (zoomed out to the continent: none - as with the address)
      H.setViewBox({ n: 70, s: 30, w: -40, e: 40 }); H.oaMap();
      check('... zoomed out past 8 with it open: none, as on the bare map', pins().length === 0, pins());
      // (one of them opened from there: its own pin, and FR24's tables have it)
      P.w.history.pushState({}, '', '/airport/gb-0999'); H.oaMap();
      check('one of them opened while zoomed out (from search): its own pin there - and in FR24\'s own tables of airports, by id and by code: its window finds the airport it shows there (not found, the Departures, Arrivals and On ground tabs were blank)', JSON.stringify(pins()) === '["GB-0999"]' && store.airportsByIata.get('GB-0999') === store.airports.find(a => a.iata === 'GB-0999') && store.airportsById.get(17000002).latitude === 54.19, pins());
      H.setViewBox(box); P.w.history.pushState({}, '', '/N123AB/3a1b2c3d'); H.oaMap();
      check('... every pin in view kept in those tables', ['EGXX', 'GB-0999', 'WSX'].every(c => store.airportsByIata.has(c)) && store.airportsById.has(17000001) && !store.airportsByIata.has('ZZZZ') === false, [...store.airportsByIata.keys()].filter(k => !/^A\d+$/.test(k)));
      // (no area known, no place in the address: what is shown stays)
      const { H: H2, store: st2, pins: pins2 } = mapPage('https://www.flightradar24.com/54.15,-3.20/10');
      H2.oaMap(); const n2 = pins2().length; P.w.close();
      void st2; check('a page that has not asked its feed yet: by the address, as before', n2 === 3, n2); }
    { const { P, H, store } = mapPage('https://www.flightradar24.com/N123AB/3a1b2c3d');
      H.oaMap();
      check('a page opened on a flight, nothing known of where the map is: nothing put on it, nothing taken off', store.airports.filter(a => a.id >= 1e7).length === 0);
      // (its zoom from the area's width and the window's: 2.6 degrees across 1024 px is zoom 9 and more)
      H.setViewBox({ n: 54.9, s: 53.4, w: -4.5, e: -1.9 }); H.oaMap();
      const v = H.oaView();
      check('... once its feed has asked for an area: the pins of that area, its zoom worked out from how wide the area is', store.airports.filter(a => a.id >= 1e7).length === 3 && v && v.z >= 8 && v.z < 11 && Math.abs(v.la - 54.15) < 0.01 && Math.abs(v.lo + 3.2) < 0.01, v);
      // (the window: FR24's airport API asked by id)
      const get = async u => { const r = await P.w.fetch(u); return r.json(); };
      const a1 = (await get('https://www.flightradar24.com/api/v1/airports/17000001')).data.info, a2 = (await get('https://www.flightradar24.com/api/v1/airports/17000002')).data.info, a3 = (await get('https://www.flightradar24.com/api/v1/airports/17000003')).data.info;
      const now = Date.now() / 1000;
      check('its window\'s details: its ICAO code (1.3.1: "N/A"), none for a field with only OurAirports\' own ident, IATA and ICAO both where it has both', a1.iata === 'EGXX' && a1.icao === 'EGXX' && a2.iata === 'GB-0999' && a2.icao === null && a3.iata === 'WSX' && a3.icao === 'EGWS', [a1.icao, a2.icao, a3.icao]);
      check('... its time zone in words, today\'s sunrise and sunset there (1.3.1: all "N/A")', /^Europe\/London \(UTC[+-]\d\d:\d\d\)$/.test(a1.timezoneDisplay) && a1.timezone === 'Europe/London' && a1.sunrise < a1.sunset && Math.abs(a1.sunrise - now) < 86400 * 1.2 && Math.abs(a1.sunset - now) < 86400 * 1.2 && a1.sunset - a1.sunrise > 6 * 3600 && a1.sunset - a1.sunrise < 18 * 3600, [a1.timezoneDisplay, a1.sunrise, a1.sunset]);
      check('... and the airport in FR24\'s tables the moment its details are asked for', store.airportsByIata.get('EGXX').id === 17000001 && store.airportsById.get(17000003).iata === 'WSX');
      const sun = H.sunTimes(51.5074, -0.1278, Date.UTC(2026, 10, 12, 12)), hm = t => new Date(t * 1000).toISOString().slice(11, 16);
      const jun = H.sunTimes(51.5074, -0.1278, Date.UTC(2026, 5, 21, 12)), syd = H.sunTimes(-33.87, 151.21, Date.UTC(2026, 10, 12, 2)), pol = H.sunTimes(78.2, 15.6, Date.UTC(2026, 11, 21, 12));
      const near = (t, s, tol) => { const m = +hm(t).slice(0, 2) * 60 + +hm(t).slice(3), w = +s.slice(0, 2) * 60 + +s.slice(3); return Math.abs(m - w) <= (tol || 4); };
      check('sunrise and sunset worked out: London on 12 November (07:13, 16:15 UTC) and at midsummer (03:43, 20:21), Sydney (18:47 UTC the day before, 08:33), none in the polar night', near(sun.rise, '07:13') && near(sun.set, '16:15') && near(jun.rise, '03:43') && near(jun.set, '20:21') && near(syd.rise, '18:47', 6) && near(syd.set, '08:33', 6) && pol.rise === null && pol.set === null, [hm(sun.rise), hm(sun.set), hm(jun.rise), hm(jun.set), hm(syd.rise), hm(syd.set), pol]);
      check('a time zone as words: its name and today\'s offset; none without a name', /^America\/New York \(UTC-0[45]:00\)$/.test(H.tzText('America/New_York', 'EST', '-5:00')) && /^Asia\/Kolkata \(UTC\+05:30\)$/.test(H.tzText('Asia/Kolkata')) && H.tzText('') === null, [H.tzText('America/New_York'), H.tzText('Asia/Kolkata')]);
      // (FR24's airport answer by its newer address)
      const v2 = await get('https://www.flightradar24.com/common/v2/airport.json?code=egxx&plugin[]=schedule&plugin-setting[schedule][mode]=departures&limit=100&page=1');
      const v1 = await get('https://api.flightradar24.com/common/v1/airport.json?code=gb-0999&plugin[]=details');
      const pd = v2 && v2.result && v2.result.response.airport.pluginData;
      check('FR24\'s airport answer asked for by its newer address (www.flightradar24.com/common/v2): answered for these as by the older one - its details, an empty board of FR24\'s form', !!pd && pd.details.code.iata === 'EGXX' && pd.details.code.icao === 'EGXX' && Array.isArray(pd.schedule.departures.data) && v1.result.response.airport.pluginData.details.name === 'Some Heliport', pd && pd.details.code);

      // (the window's two code fields, as FR24 draws them)
      const doc = P.w.document, panel = doc.createElement('div'); panel.setAttribute('data-testid', 'airport-panel');
      const field = (label, value) => `<div class="rounded border"><div class="flex"><div class="flex-col"><dt class="text-xs"><span><span>${label}</span></span></dt><dd class="h-full">${value}</dd></div></div></div>`;
      panel.innerHTML = '<dl>' + field('IATA', 'EGXX') + field('ICAO', 'EGXX') + field('Timezone', 'Europe/London') + '</dl>'; doc.body.appendChild(panel);
      const dt = () => [...panel.querySelectorAll('dt')].map(x => x.textContent), dd = () => [...panel.querySelectorAll('dd')].map(x => x.textContent), ddEls = [...panel.querySelectorAll('dd')];
      H.panelCodeFields(panel, 'EGXX');
      check('the window\'s code fields for an airfield with an ICAO code and no IATA code: IATA "N/A", ICAO its code - FR24\'s own elements, only their words changed', JSON.stringify(dd()) === '["N/A","EGXX","Europe/London"]' && JSON.stringify(dt()) === '["IATA","ICAO","Timezone"]' && [...panel.querySelectorAll('dd')][0] === ddEls[0], [dt(), dd()]);
      // (FR24 redraws the field for the next airport)
      ddEls[0].firstChild.data = 'GB-0999'; ddEls[1].firstChild.data = 'N/A'; H.panelCodeFields(panel, 'GB-0999');
      check('... a field with neither ("GB-0999"): shown under what it is - "OurAirports ID"', JSON.stringify(dd().slice(0, 2)) === '["GB-0999","N/A"]' && dt()[0] === 'OurAirports ID', [dt(), dd()]);
      ddEls[0].firstChild.data = 'WSX'; ddEls[1].firstChild.data = 'EGWS'; H.panelCodeFields(panel, 'WSX');
      check('... one with both: both as they are, the field named IATA again', JSON.stringify(dd().slice(0, 2)) === '["WSX","EGWS"]' && dt()[0] === 'IATA', [dt(), dd()]);
      ddEls[0].firstChild.data = 'GB-0999'; H.panelCodeFields(panel, 'GB-0999'); ddEls[0].firstChild.data = 'BWF'; ddEls[1].firstChild.data = 'EGNL'; H.panelCodeFields(panel, 'BWF');
      check('... then one of FR24\'s own airports: its fields as FR24 has them', JSON.stringify(dd().slice(0, 2)) === '["BWF","EGNL"]' && dt()[0] === 'IATA', [dt(), dd()]);
      panel.remove();

      // (the runway section: FR24's padlocked picture never left)
      P.w.history.pushState({}, '', '/airport/egxx');
      const pn = doc.createElement('div'); pn.setAttribute('data-testid', 'airport-panel');
      pn.innerHTML = '<section><h2>Runway details</h2><div><button class="promo"><picture data-testid="airport-panel__promo-runway_details"><img alt="Runway details"></picture></button></div></section>'; doc.body.appendChild(pn);
      const promo = pn.querySelector('button.promo'), mine = () => pn.querySelector('.tl-rwy');
      H.panelTick();
      check('an OurAirports airport\'s runway section before anything is known: "reading" in the picture\'s place - never the padlock', promo.style.display === 'none' && !!mine() && /Reading this airport/.test(mine().textContent), mine() && mine().textContent);
      H.acceptAirportPanel({ code: 'EGXX', apId: 17000001, tz: 'Europe/London', monitor: true, runways: [], freqs: [], usage: [], moves: 0 });
      check('... the monitor knows the airport and no runway of it, nor does OurAirports\' file: that is said (1.3.1 left FR24\'s padlocked picture there, for every one of these)', promo.style.display === 'none' && /No runway details are known/.test(mine().textContent), mine() && mine().textContent);
      H.acceptAirportPanel({ code: 'EGXX', apId: 17000001, tz: 'Europe/London', monitor: true, runways: [], freqs: [], usage: [], moves: 0, ends: [{ name: '03', lengthFt: 5405, elevationFt: 32, surface: 'ASPH' }, { name: '21', lengthFt: 5405, elevationFt: 35, surface: 'ASPH' }] });
      check('... its runway ends from OurAirports\' own file where the monitor has none: listed', promo.style.display === 'none' && /03/.test(mine().textContent) && /5,405/.test(mine().textContent) && !/No runway/.test(mine().textContent), mine() && mine().textContent.slice(0, 120));
      H.acceptAirportPanel({ code: 'EGXX', apId: 17000001, tz: 'Europe/London', monitor: true, runways: [['03', '21', 5405, 150, 'ASPH', 'ASP', 0, 0, 32, 33, null, 53.5753, -3.06383, 35, 213, null, 53.5882, -3.05133]], freqs: [['TWR', 'TWR', 119.75]], usage: [['03', 2, 1]], moves: 3 });
      check('... the monitor\'s runways of it: every runway in full, its ends, its frequencies', /03\/21/.test(mine().textContent) && /Runway ends/i.test(mine().textContent) && /119\.750/.test(mine().textContent), mine() && mine().textContent.slice(0, 160));
      pn.remove();

      // (links to their pages)
      const link = (href, target) => { const a = doc.createElement('a'); a.setAttribute('href', href); if (target) a.setAttribute('target', target); a.innerHTML = '<span>More</span>'; doc.body.appendChild(a); return a; };
      const press = a => a.firstChild.dispatchEvent(new P.w.MouseEvent('mousedown', { bubbles: true }));
      const more = link('https://www.flightradar24.com/data/airports/egxx', '_blank'); press(more);
      const noted = JSON.parse(P.w.localStorage.getItem('tl.oa.goto') || 'null');
      check('"More" in one of their windows (a link that opens its own tab) pressed: pointed at the page theirs are made from - its nearest FR24 airport\'s, marked with this airport\'s code - so FR24\'s server never sends the new tab to its airport search', more.getAttribute('href') === '/data/airports/bwf?tl-oa=egxx' && noted && noted.code === 'egxx' && Date.now() - noted.at < 5000, [more.getAttribute('href'), noted]);
      P.w.localStorage.setItem('tl.oa.goto', '');
      const inApp = link('/data/airports/gb-0999/statistics'); press(inApp);
      const noted2 = JSON.parse(P.w.localStorage.getItem('tl.oa.goto') || 'null');
      check('... a link FR24\'s own router follows: left as it is (its request is answered here), its airport noted for a minute in case the browser opens it in a tab of its own', inApp.getAttribute('href') === '/data/airports/gb-0999/statistics' && noted2 && noted2.code === 'gb-0999' && noted2.sub === '/statistics', noted2);
      P.w.localStorage.setItem('tl.oa.goto', '');
      const own = link('https://www.flightradar24.com/data/airports/bwf', '_blank'); press(own);
      check('... a link to one of FR24\'s own airports: untouched, nothing noted', own.getAttribute('href') === 'https://www.flightradar24.com/data/airports/bwf' && !P.w.localStorage.getItem('tl.oa.goto'));
      P.w.close(); }
    // (FR24's airport search, reached because its server sent the browser on from one of their pages)
    { const nav = (count, type) => w => { w.performance.getEntriesByType = k => (k === 'navigation' ? [{ redirectCount: count, type }] : []); };
      const went = [];
      const A = page('https://www.flightradar24.com/data/airports', null, w => { nav(1, 'navigate')(w); w.localStorage.setItem('tl.oa.goto', JSON.stringify({ code: 'egxx', sub: '/statistics', q: '', at: Date.now() - 3000 })); });
      A.H().setOaNav(u => went.push(u));
      const ready = A.posts.find(p => p.__tweeksLadd === 'ready');
      check('FR24\'s airport search reached by its server\'s sending the browser on, a link to one of their pages pressed seconds before: the userscript asked which airport that is, the search page not shown meanwhile', !!A.H().oaLost() && A.H().oaWantNow() === 'egxx' && ready && ready.oaWant === 'egxx' && !!A.w.document.getElementById('tl-oa-hide') && !A.w.localStorage.getItem('tl.oa.goto'), ready && ready.oaWant);
      A.send({ __tweeksLadd: 'oaIs', row: oaRows[0], ref: 'bwf' });
      check('... the userscript\'s answer: on to the page theirs are made from, marked - the airport\'s own page shows from there', went.length === 1 && went[0] === '/data/airports/bwf/statistics?tl-oa=egxx' && A.H().oaLost() === null, went);
      A.w.close();
      const B = page('https://www.flightradar24.com/data/airports', null, w => { nav(0, 'navigate')(w); w.localStorage.setItem('tl.oa.goto', JSON.stringify({ code: 'egxx', sub: '', q: '', at: Date.now() })); });
      const C = page('https://www.flightradar24.com/data/airports', null, w => { nav(1, 'navigate')(w); w.localStorage.setItem('tl.oa.goto', JSON.stringify({ code: 'egxx', sub: '', q: '', at: Date.now() - 5 * 60000 })); });
      const D = page('https://www.flightradar24.com/data/airports', null, w => { nav(1, 'navigate')(w); w.localStorage.setItem('tl.oa.goto', JSON.stringify({ code: '../x', sub: '', q: '', at: Date.now() })); });
      check('... the search page gone to as itself (not sent on to), a note minutes old, a note that is no airport code: FR24\'s search page as it is', B.H().oaLost() === null && C.H().oaLost() === null && D.H().oaLost() === null && !B.w.document.getElementById('tl-oa-hide') && B.H().oaWantNow() === '');
      B.w.close(); C.w.close(); D.w.close();
      const R = page('https://www.flightradar24.com/data/airports', null, w => { nav(1, 'reload')(w); w.sessionStorage.setItem('tl.oa.tab', JSON.stringify({ last: { code: 'gb-0999', sub: '', q: '' }, keys: {} })); });
      const R2 = page('https://www.flightradar24.com/data/airports', null, w => { nav(1, 'reload')(w); });
      check('one of their pages loaded again (FR24\'s server sends that on too): this tab remembers which airport its page was; a tab that showed none: the search page', R.H().oaLost() && R.H().oaLost().code === 'gb-0999' && R.H().oaWantNow() === 'gb-0999' && R2.H().oaLost() === null, R.H().oaLost());
      R.w.close(); R2.w.close(); }
  }
  await sleep(20);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
