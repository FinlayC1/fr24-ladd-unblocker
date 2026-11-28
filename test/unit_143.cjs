// 1.4.3:
//   - the monitor keeps FR24's whole track of flights (monitor/fr24keep.cjs): as each comes down (FR24's trail of it, asked
//     once it is down, the flights wanted first), FR24's playback of a flight asked about whose kept points are the scans'
//     few (FR24's week), and FR24's tracks browsers send - taken only where they agree with the monitor's own positions;
//     /fr24ends says which flights have only the scans' points; /fr24track takes the browsers'
//   - the player draws FR24's own positions, straight from one to the next: public ADS-B only before FR24 had the
//     flight, after it lost it, and in a hole of ten minutes or more
//   - a log's rows (M-SKTO, 27 Nov - its real ends at Truro Aerodrome, an OurAirports field): named again when the fields
//     come in after the rows were filled ("Private Site" for good before), and the monitor asked again when its answer
//     was lost; the hover text plain
//   - FR24's search note ("visit our blog") taken away; the app's aircraft page with FR24's three pictures
//   - the player's related flights: FR24's padlocked Previous opened, ours where FR24 has none
//   - a flight that cannot be played says so - FR24's search form is not left in its place
// usage: node test/unit_143.cjs <node_modules dir> [data dir]
const fs = require('fs'), os = require('os'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { createFr24Keep, playbackPts } = require('../monitor/fr24keep.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ======== the monitor: FR24's whole tracks ============================================================================
  {
    let T = 1795800000e3; const put = [], asked = [];
    const trail = (id, n) => Array.from({ length: n }, (_, i) => ({ t: 1795790000 + i * 10, lat: 50 + i * 0.001, lon: -5 + i * 0.001, alt: i ? 2000 : 0, gs: i ? 150 : 0, trk: 10 }));
    const own = new Map();
    let pbAnswer = null, followErr = null;
    const K = createFr24Keep({
      now: () => T, cfg: {},
      follow: async id => { asked.push(id); if (followErr) { const e = followErr; followErr = null; throw e; } return trail(id, 60); },
      playback: async (fid, t) => { if (pbAnswer instanceof Error) throw pbAnswer; return pbAnswer; },
      put: (id, m, pts) => put.push({ id, m, pts }),
      own: fid => own.get(fid) || null,
      meta: f => ({ cs: f.cs || '' }), prio: f => (f.type === 'H160' ? 1 : 2)
    });
    // (coming down)
    K.watch([{ id: 101, alt: 9000, spd: 300, type: 'A320' }, { id: 102, alt: 3000, spd: 120, type: 'H160' }, { id: 103, alt: 400, spd: 120 }], T);
    T += 60000; K.watch([{ id: 101, alt: 700, spd: 150, type: 'A320' }, { id: 102, alt: 0, gnd: true, spd: 0, type: 'H160' }, { id: 103, alt: 300, spd: 110 }], T);
    check('a flight seen up, then coming down below 800 ft or on the ground: its whole track wanted; one only climbing out (never up yet): not', K.queue.length === 2 && K.queue.every(x => x.id === 101 || x.id === 102), K.queue.map(x => x.id));
    const n0 = await K.followOne(T);
    check('... asked once it is down (two and a half minutes on), not before', n0 === 0 && !asked.length);
    T += 151000;
    await K.followOne(T);
    check('... the light aircraft / helicopter first', asked[0] === 102 && put.length === 1 && put[0].id === 102 && put[0].pts.length === 60, asked);
    K.want((101).toString(16), 0, null);
    K.watch([{ id: 104, alt: 9000, spd: 300 }], T); T += 1000; K.watch([{ id: 104, alt: 500, spd: 140 }], T); T += 151000;
    await K.followOne(T);
    check('... a flight a browser asked about before the rest', asked[1] === 101, asked);
    K.watch([{ id: 101, alt: 0, gnd: true }], T);
    check('... kept once: not asked again', !K.queue.some(x => x.id === 101));
    followErr = new Error('paused (FR24 pushed back)'); await K.followOne(T);
    check('... FR24 pushing back: put back in the queue, asked later', K.queue.some(x => x.id === 104) && K.S.pausedUntil > T);
    // (sparse: the scans' few points)
    const pts = (n, gap) => ({ p: Array.from({ length: n }, (_, i) => [1795700000 + i * gap, 50, -5]) });
    check('a flight\'s kept points: few (under 30) or a minute and more apart halfway through - the scans\' only; FR24\'s whole track: not', K.sparse(pts(10, 5)) && K.sparse(pts(100, 180)) && !K.sparse(pts(100, 10)));
    // (FR24's playback of one asked about)
    const nowS = T / 1000, ended = n => ({ p: Array.from({ length: n }, (_, i) => [nowS - 7200 + i * 180, 50, -5]) });
    K.want('42aa0001', nowS - 9000, ended(20));
    K.want('42aa0002', nowS - 9000, pts(200, 10));
    K.want('42aa0003', nowS - 9 * 86400, { p: [[nowS - 9 * 86400, 50, -5]] });
    K.want('42aa0004', nowS - 600, { p: [[nowS - 300, 50, -5]] });
    check('asked about with only the scans\' points, ended within FR24\'s week: FR24\'s playback of it wanted; whole, older, or still flying: not', [...K.pbQueue.keys()].join() === '42aa0001', [...K.pbQueue.keys()]);
    pbAnswer = playbackPts({ result: { response: { data: { flight: { identification: { callsign: 'RYR1AB', number: { default: 'FR1' } }, aircraft: { identification: { registration: 'EI-ABC', modes: '4CA123' }, model: { code: 'B738' } }, airport: { origin: { code: { iata: 'DUB' } }, destination: { code: { iata: 'LPL' } } },
      track: [{ latitude: 53.4, longitude: -6.2, altitude: { feet: 0 }, speed: { kts: 10 }, heading: 280, timestamp: nowS - 7000, squawk: '7000' }, { latitude: 53.5, longitude: -5, altitude: { feet: 20000 }, speed: { kts: 400 }, heading: 90, timestamp: nowS - 6000, verticalSpeed: { fpm: 0 } }] } } } } });
    check('FR24\'s playback answer read: its points (ground at 0 ft), squawk, and what it says of the flight', pbAnswer.pts.length === 2 && pbAnswer.pts[0].gnd === true && pbAnswer.pts[0].sq === '7000' && pbAnswer.m.cs === 'RYR1AB' && pbAnswer.m.fn === 'FR1' && pbAnswer.m.hex === '4ca123' && pbAnswer.m.from === 'DUB' && pbAnswer.m.to === 'LPL', pbAnswer.m);
    const before = put.length; await K.playbackOne(T);
    check('... kept with its points', put.length === before + 1 && put[put.length - 1].id === 0x42aa0001 && put[put.length - 1].pts.length === 2);
    K.want('42aa0005', nowS - 9000, ended(20)); pbAnswer = Object.assign(new Error('HTTP 403'), { refused: true }); await K.playbackOne(T);
    check('... FR24 refusing: an hour\'s pause', K.S.pbPausedUntil >= T + 3599e3);
    // (a browser's copy)
    const ownPts = Array.from({ length: 8 }, (_, i) => [1795790000 + i * 180, 50 + i * 0.018, -5 + i * 0.018]);
    own.set('42bb0001', { p: ownPts });
    const sent = Array.from({ length: 150 }, (_, i) => [1795790000 + i * 10, 50 + i * 0.001, -5 + i * 0.001, i ? 2000 : 0, i ? 150 : 0, 10, i ? 0 : 1]);
    const r1 = K.crowd({ v: 1, fid: '42bb0001', m: { cs: 'GABCD', reg: 'G-ABCD', bad: 'x' }, p: sent }, '1.2.3.4');
    check('a browser\'s copy of FR24\'s track that passes the monitor\'s own positions of the flight: kept', r1.ok && r1.n === 150 && put[put.length - 1].id === 0x42bb0001 && put[put.length - 1].m.reg === 'G-ABCD' && !('bad' in put[put.length - 1].m), r1);
    own.set('42bb0002', { p: ownPts });
    const r2 = K.crowd({ v: 1, fid: '42bb0002', p: sent.map(r => [r[0], r[1] + 0.2, r[2]].concat(r.slice(3))) }, '1.2.3.4');
    check('... one 20 km off them: refused', !r2.ok && r2.why === 'disagrees', r2);
    const r3 = K.crowd({ v: 1, fid: '42bb0003', p: sent }, '1.2.3.4');
    check('... one the monitor has nothing of to check it with: refused', !r3.ok && r3.why === 'unknown', r3);
    let lim = null; for (let i = 0; i < 130; i++) lim = K.crowd({ v: 1, fid: '42bb0003', p: sent }, '5.6.7.8');
    check('... 120 an hour from one address at most', lim && lim.why === 'limit', lim);
  }
  // ======== the monitor itself: the keeper wired in =====================================================================
  {
    process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon143-'));
    const M = require('../monitor/monitor.cjs');
    const t0 = Math.floor(Date.now() / 1000) - 3 * 3600;
    M.scanPut([{ id: 0x42cc0001, ts: t0, lat: 50.3, lon: -5.1, alt: 3000, spd: 130, trk: 10, hex: '424c35', cs: 'MSKTO' }], Date.now());
    M.scanPut([{ id: 0x42cc0001, ts: t0 + 180, lat: 50.32, lon: -5.12, alt: 600, spd: 60, trk: 10, hex: '424c35', cs: 'MSKTO' }], Date.now() + 1000);
    const e = M.fr24Ends('42cc0001:' + t0)['42cc0001'];
    check('/fr24ends: how many points are kept of each flight, and that they are the scans\' few (sp)', e && e.n === 2 && e.sp === 1, e);
    check('... such a flight of FR24\'s week asked about: FR24\'s playback of it wanted on the monitor', M.KEEP.pbQueue.has('42cc0001'));
    check('... and the scans feed the flights coming down to the keeper', M.KEEP.stats().watching >= 1, M.KEEP.stats());
    const src = fs.readFileSync(path.join(__dirname, '../monitor/monitor.cjs'), 'utf8');
    check('POST /fr24track: the browsers\' copies, checked (KEEP.crowd); the loops started; the status says how it goes', /u\.pathname !== '\/fr24track'/.test(src) && /u\.pathname === '\/fr24track' \? KEEP\.crowd\(d, ip\)/.test(src) && /keepLoop\(\); keepPbLoop\(\);/.test(src) && /fr24Keep: KEEP\.stats\(\)/.test(src));
    check('... kept with the scans\' positions (their disk guard): /fr24raw reads them with the rest', /put: \(id, meta, pts\) => fr24scan\.put\(id, meta, pts\)/.test(src));
  }
  // ======== the userscript ===============================================================================================
  const { JSDOM } = require(path.join(NM, 'jsdom'));
  const FIDB = require(path.join(NM, 'fake-indexeddb'));
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
  const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8'), APS = JSON.parse(AIRPORTS).rows, AP = c => APS.find(a => a.iata === c);
  const MON = 'https://143-47-224-210.sslip.io';
  const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  // (OurAirports' lists as the script needs them - over 10,000 rows: Truro Aerodrome among rows far away)
  const OA = { v: 1, at: Date.now(), n: 10002, rows: [[68369834, 'EGHY', 'EGHY', 'Truro Aerodrome', 'Truro', 8663, 50.2784, -5.14229, 127, 'S', 0, 'GB-ENG']] };
  for (let i = 0; i < 10001; i++) OA.rows.push([20000000 + i, 'ZZ' + i, 'ZZ' + i, 'Far ' + i, 'X', 0, -75 + (i % 100) * 0.05, -170 + Math.floor(i / 100) * 0.5, 0, 'S', 0, 'AQ-U-A']);
  let CSV = 'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code\n1,EGHY,small_airport,Truro Aerodrome,50.2784,-5.14229,127,EU,GB,GB-ENG,Truro,no,EGHY,,EGHY,\n';
  for (let i = 0; i < 10001; i++) CSV += `${10 + i},ZZ${i},small_airport,Far ${i},${-75 + (i % 100) * 0.05},${-170 + Math.floor(i / 100) * 0.5},0,AN,AQ,AQ-U-A,X,no,,,ZZ${i},\n`;
  // (M-SKTO, 27 Nov: FR24's rows - Truro left out, or Perranporth 6.5 km off - and the monitor's ends of them as it had them)
  const ENDS = { v: 1, list: {
    '42c071f0': { s: [1795796848, 53.33725, -2.83928, 0, 0, 1], e: [1795798518, 53.77043, -3.00154, 175, 90, 0], n: 120, sp: 0 },
    '42c02180': { s: [1795789894, 50.27769, -5.14153, 325, 0, 0], e: [1795795571, 53.33723, -2.83928, 0, 0, 1], n: 264, sp: 0 },
    '42bff8f3': { s: [1795786727, 50.44163, -4.99774, 400, 54, 0], e: [1795787209, 50.27768, -5.14153, 300, 1, 0], n: 17, sp: 1 },
    '42bfbcc2': { s: [1795781132, 50.27866, -5.14254, 425, 41, 0], e: [1795781804, 50.43832, -4.98873, 400, 52, 0], n: 29, sp: 1 },
    '42bf76dc': { s: [1795774630, 53.33336, -2.81799, 650, 76, 0], e: [1795781129, 50.27828, -5.14182, 375, 31, 0], n: 249, sp: 0 } } };
  const tz = 'Europe/London', apOf = a => a ? { name: a.name, city: a.city, iata: a.iata, icao: a.icao, countryId: 1, countryName: a.country, timezone: tz } : null;
  const fl = (fid, t0, t1, o, d) => ({ id: String(parseInt(fid, 16)), flightId: fid, callsign: 'MSKTO', flightNumber: null, activeDay: '', scheduledDeparture: null, actualDeparture: t0, scheduledArrival: null, estimatedDeparture: null, estimatedArrival: null, actualArrival: t1, flightTimeSeconds: t1 - t0, status: { name: 'landed', color: 'green', board: 'arrivals', time: t1 }, origin: apOf(o), destination: apOf(d), divertedTo: null, aircraft: { type: 'H160', registration: 'M-SKTO', typeUrl: 'h160' }, live: false });
  const LPL = AP('LPL'), BLK = AP('BLK'), NQY = AP('NQY'), QKA = AP('QKA');
  const flights = [fl('42c071f0', 1795796848, 1795798518, LPL, BLK), fl('42c02180', 1795789894, 1795795571, null, LPL), fl('42bff8f3', 1795786727, 1795787209, NQY, QKA), fl('42bfbcc2', 1795781132, 1795781804, null, NQY), fl('42bf76dc', 1795774630, 1795781129, LPL, null)];
  const photos = [1, 2, 3].map(i => ({ url: `https://cdn.jetphotos.com/full/${i}.jpg`, link: `https://www.jetphotos.com/photo/${i}`, copyright: 'P' + i }));
  const page = { component: 'Data/AircraftRegistration', props: { aircraft: { registration: 'M-SKTO', model: 'Airbus Helicopters H160B', typeCode: 'H160', modeS: '424C35', msn: null, manufactured: null, age: null, testFlight: false, owner: 'T. J. Morris' }, withheld: { msn: true, age: true }, airline: null, operator: null, photos, flights, meta: { hiddenByPlan: true, historyDays: 7 }, historyAvailable: true } };
  function makeWin(url, pg, o) {
    o = o || {};
    const win = new JSDOM(`<!doctype html><html><head></head><body class="antialiased"><div id="app" data-page="${attr(JSON.stringify(pg))}"></div></body></html>`, { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
    win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    win.caches = { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => false }) };
    const asked = [], t0 = Date.now();
    const answer = (u, body) => {
      asked.push({ u, t: Date.now() - t0, body });
      if (o.answer) { const r = o.answer(u, body); if (r) return r; }
      if (/flightradar24\.com\/mobile\/airports\/format/.test(u)) return [0, 200, AIRPORTS];
      if (u.startsWith(MON + '/status')) return [5, 200, JSON.stringify({ v: 3, ver: 'test' })];
      if (u.startsWith(MON + '/oaap')) return [5, 200, JSON.stringify(OA)];
      if (u.startsWith(MON + '/fr24ends')) return [5, 200, JSON.stringify(ENDS)];
      if (/ourairports-data\/main\/airports\.csv/.test(u)) return [o.sitesMs || 5, 200, CSV];
      return [0, 404, ''];
    };
    win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const a = answer(u); return new Promise(r => setTimeout(() => r(new Response(a[2] || '', { status: a[1] })), a[0])); };
    win.GM_xmlhttpRequest = q => { const a = answer(q.url, q.data); setTimeout(() => { q.onload && q.onload({ status: a[1], responseText: a[2], response: a[2] }); }, a[0] || 1); return { abort() {} }; };
    win.unsafeWindow = win; win.GM_notification = () => {};
    win.postMessage = data => { setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
    win.__logs = []; win.console.debug = (...a) => win.__logs.push(a.join(' ')); win.console.log = () => {}; win.console.error = (...a) => win.__logs.push('ERROR ' + a.join(' '));
    win.localStorage.setItem('tl.mon1', JSON.stringify({ u: MON, at: Date.now() - 60000, d: 1 }));
    if (o.app) win.TL_APP = { v: 2, platform: 'android', update: () => false };
    win.eval(SRC); win.__asked = asked; return win;
  }
  const rowsOf = w => [...w.document.querySelectorAll('#tbl-datatable tbody tr.data-row')].map(r => [r.children[3], r.children[4]]);
  const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  // ---- the log's ends
  {
    let lost = 0;
    const w = makeWin('https://www.flightradar24.com/data/aircraft/m-skto', page, { app: true, sitesMs: 11000, answer: u => u.startsWith(MON + '/fr24ends') && !lost++ ? [5, 500, ''] : null });
    await sleep(7000);
    const early = rowsOf(w).map(([a, b]) => txt(a) + ' > ' + txt(b));
    await sleep(9000);
    const late = rowsOf(w), lt = late.map(([a, b]) => txt(a) + ' > ' + txt(b));
    check('M-SKTO 27 Nov: the monitor\'s answer lost (asked again), and the landing sites in only after the rows were filled', lost >= 1 && !early.some(s => /Truro/.test(s)), early);
    check('... named again once they are in: Truro Aerodrome at all four ends, from its own track', /^Truro \(EGHY\) > Liverpool/.test(lt[1]) && /^Truro \(EGHY\) > Newquay/.test(lt[3]) && /^Liverpool \(LPL\) > Truro \(EGHY\)/.test(lt[4]), lt);
    check('... FR24\'s Perranporth (6.5 km off, never came near) set right too', /^Newquay \(NQY\) > Truro \(EGHY\)/.test(lt[2]) && late[2][1].classList.contains('tl-over'), lt[2]);
    check('... its hover text plain - no "&#39;" in it', late[1][0].title.includes("FR24's") && !late[1][0].title.includes('&#'), late[1][0].title);
    // ---- the phone layout's pictures (06-phone): FR24's three
    const cps = w.document.querySelectorAll('.section-header .cnt-picture');
    check('the app\'s aircraft page: FR24\'s three pictures (the old page\'s own two side by side, the third for the phone layout)', cps.length === 3 && cps[2].classList.contains('tl-pic3') && cps[2].style.display === 'none' && /3\.jpg/.test(cps[2].querySelector('img').src));
    // ---- the rows the monitor has only its scans' points of: FR24's whole track asked for, in the background (the rows of
    // 27 Nov are older than a day, within FR24's week: asked)
    await sleep(500);
    const pbAsked = w.__asked.filter(a => /flight-playback\.json\?flightId=42bff8f3|flight-playback\.json\?flightId=42bfbcc2/.test(a.u)).length;
    check('... a row whose flight the monitor has only the scans\' few points of: FR24\'s whole track of it read (to send to the monitor)', Date.now() / 1000 - 1795781132 > 7.5 * 86400 ? pbAsked === 0 : pbAsked >= 1, pbAsked);
    w.close();
  }
  // ---- the player's track: FR24's own, ADS-B only where FR24 has nothing
  {
    const w = makeWin('https://www.flightradar24.com/', { component: 'MapPage', props: {} });
    await sleep(1500);
    const X = w.__tweeksLadd.t143, fr = [], ad = [];
    for (let t = 1000; t <= 3000; t += 180) fr.push({ t, lat: 50, lon: -5, alt: 3000 });
    for (let t = 4200; t <= 5000; t += 180) fr.push({ t, lat: 51, lon: -5, alt: 3000 });
    for (let t = 400; t <= 5600; t += 20) ad.push({ t, lat: 50.5, lon: -5, alt: 3000 });
    const m = X.pbFr24First(fr, ad), adsT = m.filter(p => p.lat === 50.5).map(p => p.t);
    check('the player: FR24\'s own positions three minutes apart drawn as they are - no ADS-B between them', !adsT.some(t => t >= 1000 && t <= 3000) && !adsT.some(t => t >= 4200 && t <= 4920), adsT.filter(t => (t >= 1000 && t <= 3000) || (t >= 4200 && t <= 4920)).slice(0, 5));
    check('... ADS-B only before FR24 had it, after it lost it, and in its hole of 20 minutes', adsT.some(t => t < 970) && adsT.some(t => t > 5030) && adsT.some(t => t > 3060 && t < 4140), [adsT[0], adsT[adsT.length - 1]]);
    // (FR24's playback read as points, and what goes to the monitor)
    const j = { result: { response: { data: { flight: { identification: { callsign: 'EZY68DJ', number: { default: 'U2806' } }, aircraft: { identification: { registration: 'G-EZUR', modes: '40651B' }, model: { code: 'A320' } }, airport: { origin: { code: { iata: 'TFS' } }, destination: { code: { iata: 'LGW' } } }, track: [{ latitude: 28.04, longitude: -16.57, altitude: { feet: 0 }, speed: { kts: 12 }, heading: 70, timestamp: 1795700000 }, { latitude: 29, longitude: -15, altitude: { feet: 30000 }, speed: { kts: 450 }, heading: 30, timestamp: 1795701000 }] } } } } };
    const tr = X.fr24PbParse(j);
    check('FR24\'s playback read here: its points, ground at 0 ft', tr && tr.pts.length === 2 && tr.pts[0].gnd === true && tr.pts[1].alt === 30000);
    let body = null; w.__tweeksLadd.monUp && w.__tweeksLadd.monUp();
    const w2 = makeWin('https://www.flightradar24.com/', { component: 'MapPage', props: {} }, { answer: (u, b) => { if (u === MON + '/fr24track') { body = JSON.parse(b); return [5, 200, '{"ok":true}']; } return null; } });
    await sleep(1500);
    w2.__tweeksLadd.t143.fr24TrackSend('42dd0001', tr); await sleep(300);
    check('... sent to the monitor once the flight has ended: its id, what FR24 says of it, every point [t, lat, lon, alt, gs, trk, gnd]', body && body.v === 1 && body.fid === '42dd0001' && body.m.fn === 'U2806' && body.m.hex === '40651b' && body.p.length === 2 && body.p[0].length === 7 && body.p[0][6] === 1, body && body.m);
    body = null; w2.__tweeksLadd.t143.fr24TrackSend('42dd0001', tr); await sleep(300);
    check('... once per flight', body === null);
    w.close(); w2.close();
  }
  // ---- FR24's search note
  {
    const w = makeWin('https://www.flightradar24.com/data/airports/lpl', { component: 'Data/Airport', props: {} });
    await sleep(1500);
    const d = w.document, box = d.createElement('div');
    box.innerHTML = '<main><div data-testid="search__results"><div data-testid="search__result-row">G-EZUR</div></div><div class="note"><span class="i">i</span><p>You can visit our <a href="https://www.flightradar24.com/blog/inside-flightradar24/how-to-search/">blog</a> for a complete guide to using search.</p></div><footer><a href="https://www.flightradar24.com/blog">Blog</a></footer></main>';
    d.body.appendChild(box); await sleep(600);
    const note = box.querySelector('.note'), foot = box.querySelector('footer');
    check('FR24\'s search note ("visit our blog for a complete guide to using search"): taken away, box and all; FR24\'s other blog links left', note.style.display === 'none' && foot.style.display !== 'none' && foot.querySelector('a').style.display !== 'none', note.outerHTML.slice(0, 120));
    w.close();
  }
  // ======== the page part: related flights, the player that cannot be found, board card items ==========================
  {
    const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/data/flights?tl-pb=ff424c35' + (1795789894).toString(16), runScripts: 'dangerously' });
    const w = dom.window, doc = w.document; let H = null; w.__tlTestHook = h => { H = h; };
    w.postMessage = () => {}; w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.fetch = () => Promise.reject(new Error('offline')); w.Response = Response; w.Headers = Headers;
    const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
    w.eval('(' + m[0] + ')()');
    await sleep(50);
    check('the page part loaded with its test hook', !!H && typeof H.mxPbRelPut === 'function');
    // (FR24's own: its Previous padlocked)
    const p = { relatedFlights: [{ id: 'a', identifier: 'U2806', relation: 'flight_number', previous: { departure: 1795300000, timezone: 'Europe/London', locked: true }, next: { departure: 1795900000, href: '/data/playback/42ee0002' } },
      { id: 'b', identifier: 'G-EZUR', relation: 'aircraft', previous: { departure: 1795600000, flightNumber: 'U23330', locked: true }, next: { departure: 1795905000, href: '/data/playback/42ee0003', flightNumber: 'U28555' } }] };
    H.mxPbRelPut(p, { hex: '40651b', groups: [{ id: 'flight_number:U2806', identifier: 'U2806', relation: 'flight_number', previous: { departure: 1795300600, href: '/data/flights?tl-pb=42ee0001', locked: false }, next: null }] });
    const g0 = p.relatedFlights[0], g1 = p.relatedFlights[1];
    check('FR24\'s player, its own flight: a padlocked Previous opened with the same flight of ours (its take-off within half an hour)', g0.previous.locked === false && g0.previous.href === '/data/flights?tl-pb=42ee0001' && g0.next.href === '/data/playback/42ee0002', g0.previous);
    check('... the aircraft\'s padlocked Previous: its flight at that take-off played here (the aircraft and the time)', g1.previous.locked === false && g1.previous.href === '/data/flights?tl-pb=ff40651b' + (1795600000).toString(16) && g1.previous.flightNumber === 'U23330', g1.previous);
    const q = { relatedFlights: [] };
    H.mxPbRelPut(q, { hex: '424c35', groups: [{ id: 'aircraft:M-SKTO', identifier: 'M-SKTO', relation: 'aircraft', previous: { departure: 1795786727, href: '/data/flights?tl-pb=42bff8f3', locked: false }, next: { departure: 1795796848, href: '/data/playback/42c071f0', locked: false } }] });
    check('... a flight played here, which FR24 gives none: ours', q.relatedFlights.length === 1 && q.relatedFlights[0].relation === 'aircraft' && q.relatedFlights[0].next.href === '/data/playback/42c071f0');
    check('the phone\'s player address: an FR24 flight older than its week by its flights page (FR24\'s own player of it sends a free account to its search)', H.mxPbPhoneUrl('42aa0001', Date.now() / 1000 - 8 * 86400) === '/data/flights?tl-pb=42aa0001' && H.mxPbPhoneUrl('42aa0001', Date.now() / 1000 - 86400) === '/data/playback/42aa0001' && /^\/data\/flights\?tl-pb=ff/.test(H.mxPbPhoneUrl('ff424c3500000001')));
    H.mxPbVeilOn(); H.mxPbVeilFail();
    const v = doc.getElementById('tl-pb-veil');
    check('a flight that cannot be played: said so over FR24\'s search form, with the way back', !!v && /No track of this flight could be found/.test(v.textContent) && [...v.querySelectorAll('button')].map(b => b.textContent).join() === 'Back,Search for flights');
    // (a board card's items, made from its own Playback item)
    const card = doc.createElement('div'); card.setAttribute('data-testid', 'airport-panel__schedules__flight__20000000001');
    card.innerHTML = '<div class="acts"><a href="/data/aircraft/m-skto" class="it"><svg class="size-6"></svg><span>Aircraft info - M-SKTO</span></a><a href="/data/aircraft/m-skto#x" class="it pb"><svg class="size-10"></svg><span>Playback</span></a></div>';
    doc.body.appendChild(card);
    const pb = H.cardPbItem(card), dl = H.cardItem(pb, 'Download CSV/KML', '<svg id="dl"></svg>', 'tl-card-dl');
    check('a board card\'s Download CSV/KML and Share: made from its own Playback item - its look, its own words and icon, no link of FR24\'s', pb && pb.classList.contains('pb') && dl.textContent === 'Download CSV/KML' && dl.classList.contains('tl-card-dl') && !dl.hasAttribute('href') && dl.querySelector('svg#dl') && !dl.querySelector('svg.size-10'), dl.outerHTML);
    w.close();
  }
  // ======== the route engine's fields and heliports in slices: the same as in one go =====================================
  {
    const { createRouteEngine } = require('../src/engine.js');
    const aps = JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows;
    const fields = [], helis = [];
    for (let i = 0; i < 5000; i++) fields.push({ lat: 50 + (i % 70) * 0.11, lon: -6 + Math.floor(i / 70) * 0.13, alt: 100, ident: 'ZF' + i, name: 'Strip ' + i, city: 'Town ' + i });
    for (let i = 0; i < 3000; i++) helis.push({ id: 30000000 + i, ident: 'ZH' + i, code: 'ZH' + i, name: 'Pad ' + i, city: '', lat: 51 + (i % 50) * 0.07, lon: -4 + Math.floor(i / 50) * 0.09, alt: 50 });
    const one = createRouteEngine(), cut = createRouteEngine(); one.setAirports(aps); cut.setAirports(aps);
    one.setFields(fields); one.setHeliports(helis);
    for (let i = 0; i < fields.length; i += 2000) cut.setFields(fields.slice(i, i + 2000), { append: i > 0, later: i + 2000 < fields.length });
    for (let i = 0; i < helis.length; i += 2000) cut.setHeliports(helis.slice(i, i + 2000), { append: i > 0 });
    const probe = (E, la, lo) => { const f = E.fieldAt(la, lo, 3), h = E.heliportAt(la, lo, 3); return (f ? f.airport.icao : '-') + '/' + (h ? h.airport.icao : '-'); };
    const pts = [[50.55, -5.35], [52.1, -2.2], [53.3, -1.1], [51.7, -3.0], [54.9, 0.3]];
    check('the route engine\'s fields and heliports given 2,000 at a time: the same as in one go (a browser\'s page no longer held while they are built)', one.fieldCount() === cut.fieldCount() && one.heliCount() === cut.heliCount() && pts.every(([a, b]) => probe(one, a, b) === probe(cut, a, b)), [one.fieldCount(), cut.fieldCount(), one.heliCount(), cut.heliCount()]);
    const again = createRouteEngine(); again.setAirports(aps); again.setFields(fields.slice(0, 100)); again.setFields(fields.slice(100, 200));
    check('... a list set anew (no append): the one before replaced', again.fieldCount() <= 100);
  }
  // ======== the code: what the tests above do not reach ==================================================================
  {
    const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const page = read('src/page.js'), data = read('src/main/03-data.js'), cls = read('src/main/06-classic.js'), boot = read('src/main/07-boot.js'), pb = read('src/main/06-pbpage.js');
    check('in the app, FR24\'s playback asked through FR24\'s own page (that address alone), else as before', /d\.__tweeksLadd === 'fr24ApiReq'/.test(page) && page.includes('flight-playback\\.json\\?flightId=[0-9a-f]{1,12}&timestamp=\\d{9,11}$/') && /postToPage\('fr24ApiReq'/.test(data) && /case 'fr24ApiRes'/.test(boot));
    check('every FR24 playback asked through the one helper', !/gmRequest\(`https:\/\/api\.flightradar24\.com\/common\/v1\/flight-playback/.test(fs.readdirSync(path.join(__dirname, '../src/main')).map(f => read('src/main/' + f)).join('\n')));
    check('FR24\'s app moving to an aircraft\'s or flight number\'s page without loading it: loaded, drawn as it was', /function clRouteWatch\(\)/.test(cls) && /clRouteWatch\(\)/.test(boot) && /location\.reload\(\)/.test(cls));
    check('board cards: runways filled when a card opens, and both ends asked of the monitor where the board\'s answer has none; Download and Share put in', /function cardRwyMore\(/.test(page) && /post\('cardRwy'/.test(page) && /case 'cardRwy'/.test(boot) && /async function onCardRwy\(/.test(pb) && /cardRwyFill\(\); cardExtras\(\);/.test(page));
    check('the player\'s ends named as the log names them (OurAirports\' fields and heliports, low and slow - not only on the ground at an FR24 airport)', /ENGINE\.placeAt\(p\.lat, p\.lon, p\.gnd \? 4 : 6, 2\)/.test(pb) && /ENGINE\.heliAirportAt\(p\.lat, p\.lon\)/.test(pb));
  }
  // ======== every log a year back ===========================================================================================
  {
    const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const core = read('src/main/01-core.js'), mon = read('monitor/monitor.cjs'), fnSrc = read('monitor/fr24fn.cjs'), ac = read('src/main/06-acpage.js');
    check('a year of every aircraft\'s log: a blocked aircraft\'s and the rows under FR24\'s own week (365 days, were 220 and 90)', /const HISTORY_DAYS = 365;/.test(core) && /const OLDER_DAYS = 365;/.test(core));
    check('... the monitor\'s days of adsb.lol\'s archives a year, and its log filling a year', /archiveDays: 365,/.test(mon) && /const FILL_DAYS = 365,/.test(mon));
    check('a year of every flight number\'s log: kept, asked for and said (365 days, were 100)', /keepDays = env\.keepDays \|\| 365,/.test(fnSrc) && (mon.match(/\+CFG\.fnDays \|\| 365/g) || []).length === 3 && !/fnDays \|\| 100/.test(mon) && /Number\(j\.keep\) \|\| 365/.test(ac));
    const { createFnIndex } = require('../monitor/fr24fn.cjs');
    const os = require('os'), store = fs.mkdtempSync(path.join(os.tmpdir(), 'fn365-'));
    try {
      const IX = createFnIndex({ store }), T = Date.now() / 1000;
      const rec = (id, ts) => ({ id, fn: 'FR4031', cs: 'RYR4031', hex: '4ca24d', reg: 'EI-DCY', type: 'B738', from: 'LPL', to: 'FAO', ts, alt: 30000, gnd: false, spd: 440 });
      // (a flight 300 days ago: kept and asked for; one 400 days ago: not)
      for (const [id, d] of [[0x3d000001, 300], [0x3d000002, 400]]) { const t = T - d * 86400; IX.observe([rec(id, t)], t); IX.observe([rec(id, t + 3600)], t + 3600); IX.observe([], t + 3 * 3600); IX.flush(); }
      // (a number flown twice a day for a year: all of it given)
      for (let k = 0; k < 720; k++) { const t = T - 2 * 86400 - k * 43200; IX.observe([rec(0x3e000000 + k, t)], t); IX.observe([rec(0x3e000000 + k, t + 3600)], t + 3600); IX.observe([], t + 3 * 3600); }
      IX.flush();
      const q = await IX.query('FR4031');
      check('... a flight number\'s flight of 300 days ago kept and given; one of 400 days ago not; a number flown twice a day for a year all of it', q.some(x => x.fid === '3d000001') && !q.some(x => x.fid === '3d000002') && q.filter(x => /^3e/.test(x.fid)).length === 720, [q.length, q.filter(x => /^3e/.test(x.fid)).length]);
    } catch (e) { check('... a flight number\'s flights of a year (fr24fn.cjs)', false, String(e && e.stack || e).slice(0, 300)); }
    finally { fs.rmSync(store, { recursive: true, force: true }); }
  }
  // ======== FR24's scheduled times kept a year (STD and STA of rows older than FR24's week) ================================
  {
    const os = require('os'), { createFnIndex } = require('../monitor/fr24fn.cjs'), { cleanRow, schedOk, createBoards } = require('../monitor/boards.cjs');
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
    try {
      const T = Math.floor(Date.now() / 1000), dep = T - 3 * 86400, arr = dep + 3 * 3600 - 300;
      // (boards' rows: FR24's own scheduled time marked (sx) - read as such, or FR24's own row saying so; a row whose time is
      // the one it flew (no schedule) not marked)
      const marked = cleanRow({ src: 'sched', k: 'f42aa0001', fid: '42aa0001', num: 'FR4031', cs: 'RYR4031', t: dep + 600, sch: dep, sx: 1, ap: 2 }, T);
      const byNat = cleanRow({ src: 'fr24', k: 'f42aa0002', fid: '42aa0002', num: 'FR4031', t: dep + 600, sch: dep, nat: { scheduledTime: dep, estimatedTime: dep + 600 } }, T);
      const flown = cleanRow({ src: 'sched', k: 'f42aa0003', fid: '42aa0003', num: 'FR4031', t: dep + 600, sch: dep + 600 }, T);
      check('boards: a row\'s time marked FR24\'s schedule where it was read as such or FR24\'s own row says so - not one that is the time it flew', marked.sx === 1 && byNat.sx === 1 && !flown.sx && schedOk({ sx: 1 }) && !schedOk({ sch: dep, nat: { scheduledTime: dep + 60 } }));
      const IX = createFnIndex({ store });
      // (Liverpool's departures and Faro's arrivals of FR4031; a light aircraft's row (no flight number) and an unmarked one)
      check('the index: FR24\'s departure time from the departures row, its arrival from the arrivals row', IX.noteSched(marked, 1, 'departures') === true && IX.noteSched(Object.assign({}, marked, { sch: arr, ap: 1 }), 2, 'arrivals') === true);
      check('... a flight without a flight number, or a time not FR24\'s schedule: not kept', IX.noteSched({ fid: '42aa0009', sx: 1, sch: dep, num: '' }, 1, 'departures') === false && IX.noteSched(flown, 1, 'departures') === false);
      check('... the same again: nothing new', IX.noteSched(marked, 1, 'departures') === false);
      // (the flight over: written to its month's file; asked for by its number)
      check('... written once the flight is over (twelve hours after)', IX.schFlush(T) === 1 && IX.scheduled === 0 && fs.readdirSync(path.join(store, 'fr24fn', new Date(dep * 1000).toISOString().slice(0, 7))).some(f => /^S[0-9a-f]{2}\.txt$/.test(f)));
      const got = await IX.sched(['FR4031'], T - 400 * 86400, T);
      check('... asked for by its number: FR24\'s id, STD, STA, Liverpool to Faro', got.length === 1 && got[0].fid === '42aa0001' && got[0].std === dep && got[0].sta === arr && got[0].from === 1 && got[0].to === 2, got);
      check('... seen again unchanged after it was written: not written twice', IX.noteSched(marked, 1, 'departures') === false && IX.scheduled === 0);
      // (matched to flights: by FR24's id; one without it (the world log's) by its number and time and airports)
      const fl = [{ fid: '42aa0001', fn: 'FR4031', t0: dep + 700, t1: arr }, { fid: '', fn: 'FR4031', t0: dep + 900, t1: arr + 600, fromId: 1, toId: 2 }, { fid: '', fn: 'FR4031', t0: dep + 5 * 3600, t1: dep + 8 * 3600 }];
      IX.schedMatch([fl[0]], got); IX.schedMatch([fl[1]], got); IX.schedMatch([fl[2]], got);
      check('... a flight given them by FR24\'s id; one of the world log by its number, time and airports; one five hours off none', fl[0].std === dep && fl[0].sta === arr && fl[1].std === dep && fl[2].std === undefined, fl);
      // (kept over a restart: one not over yet)
      IX.noteSched(Object.assign({}, marked, { fid: '42aa0005', k: 'f42aa0005', sch: T + 3600 }), 1, 'departures'); IX.save(T);
      const IX2 = createFnIndex({ store }); IX2.load(T);
      check('... a flight not over yet kept over a restart', IX2.scheduled === 1 && (await IX2.sched(['FR4031'], T - 86400, T + 86400)).some(x => x.fid === '42aa0005'));
      // (the boards kept on disk, gone through once: their scheduled times noted)
      const BD = createBoards({ store, E: null, cfg: { fetch: false } }), seen = [];
      BD.put(1, 'departures', [{ src: 'fr24', k: 'f42aa0007', fid: '42aa0007', num: 'FR4032', t: dep, sch: dep, nat: { scheduledTime: dep } }], 'crowd', T); BD.save(T);
      await BD.eachRow((r, ap, kind) => seen.push([r.fid, ap, kind, r.sx]));
      check('boards: every row kept gone through, FR24\'s scheduled times marked (the rows of the week before this version)', seen.some(x => x[0] === '42aa0007' && x[1] === 1 && x[2] === 'departures' && x[3] === 1), seen);
    } catch (e) { check('FR24\'s scheduled times (fr24fn.cjs, boards.cjs)', false, String(e && e.stack || e).slice(0, 400)); }
    finally { fs.rmSync(store, { recursive: true, force: true }); }
    const mon = fs.readFileSync(path.join(__dirname, '../monitor/monitor.cjs'), 'utf8'), bds = fs.readFileSync(path.join(__dirname, '../src/main/06-boards.js'), 'utf8');
    check('the monitor: boards\' rows noted (with their airport and kind), those kept gone through once, /fnsched, /fr24fn\'s flights given theirs', /onRow: \(r, ap, kind\) => \{[^}]*FN\.noteSched\(r, ap, kind\)/.test(mon) && /BD\.eachRow\(\(r, ap, kind\) => FN\.noteSched\(r, ap, kind\)\)/.test(mon) && /p === '\/fnsched'/.test(mon) && /FN\.schedFor\(all,/.test(mon));
    check('browsers: their boards\' rows marked where the time is FR24\'s schedule (its map boards, its schedules, its log rows)', (bds.match(/sx: /g) || []).length === 5);
  }
  // ---- a log's rows older than FR24's week: FR24's STD and STA as the monitor kept them
  {
    const dep = Math.floor(Date.now() / 1000) - 20 * 86400, sta = dep + 3 * 3600 - 300, LPLa = AP('LPL'), FAO = AP('FAO');
    const w = makeWin('https://www.flightradar24.com/', { component: 'MapPage', props: {} }, { answer: u => u.startsWith(MON + '/fnsched?fn=FR4031') ? [5, 200, JSON.stringify({ v: 1, list: [['FR4031', '42aa0001', dep, sta, LPLa.id, FAO.id], ['FR4031', '42aa0011', dep + 86400 * 2, sta + 86400 * 2, LPLa.id, FAO.id]] })] : null });
    await sleep(1500);
    const X = w.__tweeksLadd.t143;
    X.csFnMemo.set('RYR4031', { fn: 'FR4031', at: Date.now() });
    // (a row rebuilt from public ADS-B - no FR24 id - its take-off 9 minutes after the scheduled time)
    const leg = { tStart: dep + 540, tEnd: sta - 900, tOff: dep + 540, tOn: sta - 900, ended: true, cs: 'RYR4031', from: { id: LPLa.id }, to: { id: FAO.id } };
    const before = X.legRowHtml(leg, '4ca24d', 'EI-DCY');
    let redrawn = 0; const n = await X.wantScheds([leg], () => redrawn++);
    const html = X.legRowHtml(leg, '4ca24d', 'EI-DCY'), d = w.document.createElement('table'); d.innerHTML = '<tbody>' + html + '</tbody>';
    const cells = [...d.querySelectorAll('tr.data-row > td')].map(td => td.textContent.replace(/\s+/g, ' ').trim()), stdCell = [...d.querySelectorAll('td')].find(td => Number(td.dataset.timestamp) === dep), staCell = [...d.querySelectorAll('td')].find(td => Number(td.dataset.timestamp) === sta);
    check('a row of 20 days ago (FR24 no longer shows it): FR24\'s STD and STA from the monitor, the rows drawn again', n === 2 && redrawn === 1 && !before.includes(`data-timestamp="${dep}"`) && !!stdCell && !!staCell, { n, redrawn, cells: cells.slice(0, 12) });
    check('... asked once: the year at once, not again as the rows are drawn again', (await X.wantScheds([leg], () => redrawn++)) === 0 && w.__asked.filter(a => /\/fnsched/.test(a.u)).length === 1);
    // (its flight number's other flight, two days on, not taken for it; one with no flight number none)
    const other = Object.assign({}, leg, { tStart: dep + 86400, tOff: dep + 86400, tOn: sta + 86400 - 900, tEnd: sta + 86400 - 900 });
    check('... a flight of the number a day on (no scheduled flight within three hours): none; a light aircraft\'s row: none', X.schedOfLeg(other, 'FR4031') === null && X.schedOfLeg(Object.assign({}, leg, { cs: 'GABCD' }), '') === null);
    w.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
