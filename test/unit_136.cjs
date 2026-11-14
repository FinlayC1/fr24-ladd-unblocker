// 1.3.6 - FR24's lists built with the page, the OurAirports airports tied in further, the route engine's heliports:
//   - the page part and the userscript never take their own answers for asks (1.3.4-1.3.5: oaDir, acDir and acPage both
//     ways - each answer asked again, without end)
//   - FR24's aircraft directory and its airport lists: theirs put in as the page loads, from what was kept the last time,
//     marked so nothing is added twice; the page held hidden until it is built (a page made from another FR24 airport's
//     never shows that airport first)
//   - an airport code tag with no code not drawn; an OurAirports airport with an ICAO code keeps FR24's IATA field ("N/A")
//   - bookmarks: their weather from the monitor, their code line as in their window
//   - the route engine: their heliports, for helicopters only - M-SKTO down on Axis Business Park's helipad landed there
// usage: node test/unit_136.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch (e) { /* not yet */ } await sleep(20); } return false; };

(async () => {
  // ---- 1. no message both an ask and an answer -------------------------------------------------------------------------
  { const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'page.js'), 'utf8'), main = fs.readdirSync(path.join(__dirname, '..', 'src', 'main')).map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', f), 'utf8')).join('\n');
    const pageIn = new Set([...page.matchAll(/__tweeksLadd === '([A-Za-z]+)'/g)].map(m => m[1])), pageOut = new Set([...page.matchAll(/\bpost\('([A-Za-z]+)'/g)].map(m => m[1]));
    const usIn = new Set([...main.matchAll(/case '([A-Za-z]+)':/g)].map(m => m[1])), usOut = new Set([...main.matchAll(/postToPage\('([A-Za-z]+)'/g)].map(m => m[1]));
    const both1 = [...pageIn].filter(k => usIn.has(k)), both2 = [...pageOut].filter(k => pageIn.has(k)), both3 = [...usOut].filter(k => usIn.has(k));
    check('no message the page part handles is one the userscript handles too, nor one either side sends and handles itself (each hears its own: 1.3.4-1.3.5\'s oaDir, acDir and acPage were answered again without end)', !both1.length && !both2.length && !both3.length, { both1, both2, both3 });
  }

  // ---- 2. the route engine's heliports ------------------------------------------------------------------------------------
  { const { createRouteEngine } = require('../src/engine.js'), ds = require('./dataset.cjs');
    const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows); E.setFields(ds.loadFields(DATA));
    const hl = ds.loadHeliports(DATA), n = E.setHeliports(hl), ax = hl.find(h => h.ident === 'GB-1368');
    const at = ax && E.heliAirportAt(ax.lat + 0.001, ax.lon + 0.001), fw = ax && E.placeAt(ax.lat, ax.lon, 7, 2);
    check('the route engine\'s heliports: a helicopter down 130 m from Axis Business Park\'s helipad landed there - by the id OurAirports\' list gives it (M-SKTO\'s landings were "-")', n > 10000 && !!at && at.airport.id === E.fieldId('GB-1368') && at.airport.code === 'GB-1368' && at.airport.city === 'Axis Business Park', at && { id: at.airport.id, city: at.airport.city, n });
    check('... for helicopters only: never a place a fixed-wing flight is at or goes to, nor one of the engine\'s airports or fields', !fw && !E.byId(at.airport.id) && !!E.heliById(at.airport.id) && !E.heliAirportAt(ax.lat + 0.01, ax.lon), fw && fw.airport.name);
    const lpl = E.heliAirportAt(53.3336, -2.8497);
    check('... an airport FR24 lists still first (a helicopter at Liverpool is at Liverpool)', lpl && lpl.airport.iata === 'LPL');
    check('their names as FR24 names places: "Axis Business Park Helipad" is Axis Business Park, "Knowsley HLS" Knowsley; a pad named only "Helipad" keeps its name', E.fieldShortName('Axis Business Park Helipad') === 'Axis Business Park' && E.fieldShortName('Knowsley HLS') === 'Knowsley' && E.fieldShortName('Helipad') === 'Helipad');
  }

  // ---- 2b. a departure across midnight UTC (N915ML, 13 Nov: off from Sumter at 23:21Z - shown "took off from CUB") ----------
  { process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mon136-')); process.env.MON_PORT = '0';
    global.fetch = async () => ({ status: 404, ok: false, headers: { get: () => null }, text: async () => '', json: async () => null });
    const M = require('../monitor/monitor.cjs'); M.loadEngine(); const E = M.E;
    // (its track from adsb.lol's file - the first 31 points: [t, lat, lon, alt, gs, trk, vr] - and its log's last leg, cut off by
    // the 12th's end at 23:59:50 at 8,725 ft west of Columbia SC and closed "near CUB": it had flown on to Sumter and landed)
    const P = [[1794612075,33.964783,-80.465381,2575,133.5,253.47,704],[1794612169,33.948669,-80.533204,3700,137.1,254.34,704],[1794612209,33.941666,-80.562688,4150,138.3,254.05,640],[1794612343,33.916564,-80.670605,4700,167.9,254.8,-128],[1794612356,33.91391,-80.68222,4675,170.1,254.66,-128],[1794612366,33.911728,-80.691833,4625,170.1,254.66,-192],[1794612376,33.909622,-80.700914,4625,169.4,254.24,0],[1794612385,33.9077,-80.708986,4625,167.4,254.05,-64],[1794612504,33.882162,-80.813828,4625,165.8,253.53,-64],[1794612520,33.878717,-80.827789,4625,166.1,253.2,64],[1794612532,33.876114,-80.838299,4625,165.8,253.53,0],[1794612540,33.874237,-80.845922,4625,165.8,253.53,-64],[1794612551,33.87192,-80.855198,4625,165.8,253.53,0],[1794612567,33.868429,-80.86956,4625,165.8,253.53,0],[1794612575,33.866613,-80.876999,4625,165.8,253.53,0],[1794612586,33.864239,-80.886726,4625,166.5,253.96,0],[1794612717,33.835796,-81.003914,4625,169,253.5,0],[1794612727,33.833633,-81.012623,4625,169,253.5,0],[1794612748,33.829056,-81.031289,4625,169,253.5,0],[1794612759,33.826532,-81.041508,4625,169,253.5,0],[1794612889,33.797716,-81.158352,4625,169,253.5,0],[1794612896,33.796234,-81.16419,4625,169,253.5,0],[1794612899,33.795502,-81.167272,4625,169,253.5,-64],[1794612909,33.793294,-81.176205,4625,169,253.5,0],[1794612927,33.789413,-81.192048,4625,168.7,253.82,-64],[1794612934,33.787857,-81.198326,4625,169,253.5,64],[1794613030,33.766434,-81.285263,4625,169.9,253.59,0],[1794613067,33.758194,-81.318727,4625,170.9,253.69,-64],[1794613077,33.755997,-81.327583,4625,169.9,253.59,0],[1794613090,33.752975,-81.339803,4600,171.2,253.36,-128],[1794613099,33.751024,-81.347694,4600,171.2,253.36,64]].map(p => ({ t: p[0], lat: p[1], lon: p[2], alt: p[3], gs: p[4], trk: p[5], vr: p[6] }));
    const LEG = {"tStart":1794520234,"tEnd":1794527990.3,"startLat":31.2911,"startLon":-89.8246,"endLat":33.732822,"endLon":-81.290188,"endAlt":8725,"endTrk":71.8,"endGs":231,"ended":false,"how":"open","from":{"id":35784620,"code":"K0R0","conf":"low"},"to":{"id":5731,"code":"CUB","conf":"near"},"maxAlt":11250}, ac = { type: 'COL4', reg: 'N915ML', hex: 'acaa5c', ladd: true }, hs = E.histStats([LEG], P[0].t);
    const o1 = E.inferOrigin({ ac, pos: P[30], trail: P, hs, now: P[30].t });
    check('a flight first seen climbing out - through 2,600 ft, 10 km from Sumter: from Sumter (SUM), not where its log\'s last leg - cut off at midnight - was closed (CUB)', o1 && o1.airport && o1.airport.iata === 'SUM', o1 && { ap: o1.airport && o1.airport.iata, note: o1.note });
    const mid = P.slice(20), o2 = E.inferOrigin({ ac, pos: mid[mid.length - 1], trail: mid, hs, now: mid[mid.length - 1].t });
    check('... its track only from later on, level (the day turned: its climb in the day before\'s file): no departure claimed from that cut-off leg\'s guess', !(o2 && o2.airport && o2.airport.iata === 'CUB'), o2 && { ap: o2.airport && o2.airport.iata, note: o2.note });
    const fine = Object.assign({}, LEG, { tEnd: LEG.tEnd - 3600, ended: true, to: { id: LEG.to.id, code: 'CUB', conf: 'ground' } }), o3 = E.inferOrigin({ ac, pos: mid[mid.length - 1], trail: mid, hs: E.histStats([fine], mid[0].t), now: mid[mid.length - 1].t });
    check('... a last leg seen to land stands as before (landed at CUB an hour before midnight: last landed at CUB)', o3 && o3.airport && o3.airport.iata === 'CUB', o3 && o3.note);
  }

  // ---- 2c. ... its evening before, from the day before's file: that flight alone, asked once a day ----------------------
  { const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '03-data.js'), 'utf8');
    const src = (main.match(/\n {2}const eveCache = new Map\(\);[^\n]*\n {2}async function eveningBefore[\s\S]*?\n {2}\}\n/) || [''])[0];
    const E = require('../src/engine.js').createRouteEngine(), d0 = 1794614400, asks = [];
    let T = (d0 + 600) * 1000, fail = false;
    // (the day before: a flight 18:00-19:00, on the ground at Sumter 23:15-23:20, then off and flying at midnight)
    const Y = [];
    for (let t = d0 - 6 * 3600; t <= d0 - 5 * 3600; t += 60) Y.push({ t, lat: 33, lon: -80, alt: 5000, gs: 150 });
    for (let t = d0 - 2700; t <= d0 - 2400; t += 60) Y.push({ t, lat: 33.97, lon: -80.47, alt: 0, gs: 0, gnd: true });
    for (let t = d0 - 2340; t < d0; t += 30) Y.push({ t, lat: 33.9, lon: -80.6, alt: 4600, gs: 165 });
    const env = { now: () => T, dayStr: t => new Date(t).toISOString().slice(0, 10).replace(/-/g, '/'), ENGINE: E,
      readTrace: async (id, hex, day) => { asks.push(id + ' ' + day); return fail ? { state: 'err', pts: [] } : { state: 'ok', pts: Y.slice() }; },
      mergeNets: res => { let pts = []; for (const r of res) if (r.pts.length) pts = pts.length ? E.mergePoints(pts, r.pts) : r.pts; return pts; } };
    const eve = src && new Function(...Object.keys(env), src + '\nreturn eveningBefore;')(...Object.values(env));
    const a1 = eve ? await eve('acaa5c', d0, {}) : [], n1 = asks.slice();
    check('a flight in the air at midnight UTC: its evening before from the day before\'s file - that flight alone, from where it last stood on the ground (Sumter, 23:20Z); the evening\'s flight before it left out', a1.length && a1[0].t === d0 - 2400 && a1[0].gnd && a1[a1.length - 1].t < d0 && n1.length === 1 && n1[0] === 'lol 2026/11/13', { n: a1.length, first: a1[0], asks: n1 });
    T += 60e3; await eve('acaa5c', d0, {}); T += 60e3; await eve('acaa5c', d0, {});
    const n2 = asks.length; await eve('acaa5c', d0, { priority: true }); const n3 = asks.length; T += 60e3; await eve('acaa5c', d0, { priority: true });
    check('... the day before\'s file asked once a day for each aircraft, not at each of today\'s re-reads (adsb.lol asked as little as can be); for the aircraft looked at, both networks\' once', n2 === 1 && n3 === 3 && asks.length === 3 && asks.slice(1).sort().join() === 'apl 2026/11/13,lol 2026/11/13', asks);
    fail = true; const b0 = asks.length; await eve('n1', d0, {}); T += 5 * 60e3; await eve('n1', d0, {}); const b1 = asks.length; T += 6 * 60e3; fail = false; const b2 = await eve('n1', d0, {});
    check('... no answer: asked again only 10 minutes on', b1 - b0 === 1 && asks.length - b0 === 2 && b2.length > 0, asks.slice(b0));
    const c0 = asks.length, c1 = await eve('acaa5c', d0 + 86400, {});
    check('... the next day, the day before that is asked for anew; a flight not in the air at midnight none of it', asks.length - c0 === 1 && asks[asks.length - 1] === 'lol 2026/11/14' && c1.length === 0, asks.slice(c0));
  }

  let JSDOM = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); } catch (e) { console.log('(skipped the browser: no jsdom)'); }
  if (!JSDOM) { console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0); }
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
  const PI = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0];
  const esc = o => JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const page = (url, html, before) => {
    const w = new JSDOM(html || '<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window; let H = null; const posts = [];
    w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob;
    w.fetch = () => Promise.reject(new Error('offline')); w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
    if (before) before(w);
    w.eval('(' + PI + ')()');
    return { w, H: () => H, posts, send: data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' })) };
  };
  const vue = (P, component, props) => { const gp = { $page: { component, props }, $inertia: {} }; P.w.document.getElementById('app').__vue_app__ = { config: { globalProperties: gp } }; return gp; };
  const veiled = P => !!P.w.document.querySelector('style[id^="tl-veil-"]');

  // ---- 3. FR24's aircraft directory, built as it loads ----------------------------------------------------------------------
  const FR24 = [{ code: 'A320', name: 'Airbus A320 family', slug: 'airbus-a320', count: 11000, types: [{ code: 'A320', name: 'Airbus A320', slug: 'a320', count: 5000 }] }, { code: 'CITATION', name: 'Cessna Citation', slug: 'cessna-citation', count: 900, types: [{ code: 'C25A', name: 'Citation CJ2', slug: 'c25a', count: 900 }] }];
  const OURS = [{ code: 'GLOBAL', name: 'Bombardier Global', slug: 'bombardier-global', count: 1819, types: [{ code: 'GLEX', name: 'Global 6000', slug: 'glex', count: 1110 }, { code: 'GL5T', name: 'Global 5000', slug: 'gl5t', count: 709 }] }, { code: 'GULFSTREAM', name: 'Gulfstream', slug: 'gulfstream', count: 740, types: [{ code: 'GLF6', name: 'Gulfstream G650', slug: 'glf6', count: 740 }] }, { code: 'CITATION', name: 'Cessna Citation', slug: 'cessna-citation', count: 1192, types: [{ code: 'C56X', name: 'Citation XLS', slug: 'c56x', count: 1192 }] }];
  let addKept = null;
  { const P = page('https://www.flightradar24.com/data/aircraft'), H = P.H();
    const props = { families: FR24.map(f => Object.assign({}, f)) }; vue(P, 'Data/Aircraft', props);
    H.acTick(); const ask = P.posts.filter(p => p.__tweeksLadd === 'acDir');
    P.send({ __tweeksLadd: 'acDirGot', key: 'idx', families: OURS, at: 1 });
    const n1 = props.families.length, sig = H.acSig(props.families); H.acTick(); H.acTick();
    P.send({ __tweeksLadd: 'acDirGot', key: 'idx', families: OURS, at: 1 }); H.acTick();
    check('the directory: theirs in once - the same answer again changes nothing, nothing added twice; asked once (its own ask never taken for an answer)', ask.length === 1 && n1 === 4 && props.families.length === 4 && H.acSig(props.families) === sig && props.families.find(f => f.code === 'CITATION').count === 900 + 1192, props.families.map(f => f.code + ':' + f.count));
    check('... FR24\'s own list always had back from it (what was added marked)', JSON.stringify(H.acStrip(props.families)) === JSON.stringify(FR24));
    addKept = P.w.localStorage.getItem('tl.ac.add'); P.w.close();
  }
  { const pg = { component: 'Data/Aircraft', props: { families: FR24 }, url: '/data/aircraft', version: 'v1' };
    const P = page('https://www.flightradar24.com/data/aircraft', '<!doctype html><html><head></head><body><div id="app" data-page="' + esc(pg) + '"></div></body></html>', w => { w.localStorage.setItem('tl.ac.add', addKept); });
    const got = JSON.parse(P.w.document.getElementById('app').getAttribute('data-page'));
    check('... the page as it loads: theirs put in before FR24\'s app reads it - the additions kept the last time; the page hidden until FR24\'s app has it', got.props.families.map(f => f.code).join() === 'A320,CITATION,GLOBAL,GULFSTREAM' && veiled(P), got.props.families.map(f => f.code));
    const H = P.H(), gp = vue(P, 'Data/Aircraft', got.props); await until(() => !veiled(P), 2000);
    H.acTick();
    check('... shown once FR24\'s app has it; the newer answer from the monitor the same - not put in again', !veiled(P) && P.posts.filter(p => p.__tweeksLadd === 'acDir').length === 1 && gp.$page.props.families.length === 4);
    P.w.close();
  }

  // ---- 4. FR24's airport lists, built as they load ------------------------------------------------------------------------
  { const UK = { component: 'Data/AirportsByCountry', props: { country: { id: 235, name: 'United Kingdom', slug: 'united-kingdom' }, airports: [{ id: 530, name: 'Barrow', iata: 'BWF', icao: 'EGNL', total: 67 }] }, url: '/data/airports/united-kingdom', version: 'v1' };
    const P = page('https://www.flightradar24.com/data/airports/united-kingdom', '<!doctype html><html><head></head><body><div id="app" data-page="' + esc(UK) + '"></div></body></html>');
    check('a country\'s list never seen before: the page held hidden for theirs (5 s at most)', veiled(P));
    const H = P.H(), props = JSON.parse(P.w.document.getElementById('app').getAttribute('data-page')).props; vue(P, 'Data/AirportsByCountry', props);
    H.dirTick(); const ask = P.posts.find(p => p.__tweeksLadd === 'oaDir');
    const rows = Array.from({ length: 40 }, (_, i) => [17000001 + i, 'GB-' + (100 + i), 'GB-' + (100 + i), 'Strip ' + i, '', 530, 54, -3, 0, 'S', 0, 'GB-ENG']);
    P.send({ __tweeksLadd: 'oaDirGot', key: ask.key, airports: rows.map(r => ({ id: r[0], name: r[3], iata: r[1], icao: '', total: 0 })), rows, refs: { 530: 'bwf' }, nears: {} });
    await until(() => !veiled(P), 1500);
    const ones = Object.keys(P.w.localStorage).filter(k => /^tl\.oa\.one\./.test(k)).length;
    check('... theirs in when they come, and the page shown; their rows known for their links, not each written to the browser\'s storage (1.3.4 wrote every one - 1,500 for the UK - and held the list back seconds)', props.airports.length === 41 && !veiled(P) && !!H.oaPageReq('/data/airports/gb-100') && ones === 0, { n: props.airports.length, ones });
    H.dirTick(); H.dirTick();
    check('... and in once - again and again nothing added twice', props.airports.length === 41 && props.airports.filter(a => a.tl).length === 40);
    P.w.close();
    const P2 = page('https://www.flightradar24.com/data/airports/united-kingdom', '<!doctype html><html><head></head><body><div id="app" data-page="' + esc(UK) + '"></div></body></html>', w => { w.localStorage.setItem('tl.oa.dirs', P.w.localStorage.getItem('tl.oa.dirs')); });
    const g2 = JSON.parse(P2.w.document.getElementById('app').getAttribute('data-page'));
    check('... the next time: theirs in the page as it loads (kept the last time) - built with the page', g2.props.airports.length === 41 && g2.props.airports[1].tl === 1, g2.props.airports.length);
    const H2 = P2.H(), p2 = vue(P2, 'Data/AirportsByCountry', g2.props).$page.props; H2.dirTick();
    check('... FR24\'s app reading it: nothing added again', p2.airports.length === 41);
    check('the empty code tag FR24 draws for one with no ICAO code: not drawn (a style for FR24\'s tag with an empty code)', !!P2.w.document.getElementById('tl-empty-tag') && /span\.uppercase > span:empty/.test(P2.w.document.getElementById('tl-empty-tag').textContent));
    P2.w.close();
  }
  { const ROOT = { component: 'Data/Airports', props: { airportsByCountry: [{ id: 235, name: 'United Kingdom', total: 120 }, { id: 76, name: 'France', total: 90 }] }, url: '/data/airports', version: 'v1' };
    const P = page('https://www.flightradar24.com/data/airports', '<!doctype html><html><head></head><body><div id="app" data-page="' + esc(ROOT) + '"></div></body></html>', w => { w.localStorage.setItem('tl.oa.counts', JSON.stringify({ at: Date.now(), counts: { 235: 1500 } })); });
    const g = JSON.parse(P.w.document.getElementById('app').getAttribute('data-page')), atLoad = g.props.airportsByCountry[0].total, H = P.H(), props = vue(P, 'Data/Airports', g.props).$page.props;
    H.dirTick(); H.dirTick();
    const ask = P.posts.find(p => p.__tweeksLadd === 'oaDir'); P.send({ __tweeksLadd: 'oaDirGot', key: ask.key, counts: { 235: 1600 } }); H.dirTick();
    check('the countries\' counts in as the page loads (kept), never added twice; a newer count put in place of the kept one', atLoad === 1620 && props.airportsByCountry[0].total === 1720 && props.airportsByCountry[1].total === 90, [atLoad, props.airportsByCountry[0].total]);
    P.w.close();
  }

  // ---- 5. an OurAirports airport's page made from another's: that one never shown ----------------------------------------------
  { const ROW = [17000123, 'EGOW', 'EGOW', 'RAF Woodvale', 'Southport', 2002, 53.58, -3.05, 37, 'M', 1, 'GB-ENG'];
    const lpl = { component: 'Data/Airport', props: { airport: { id: 2002, name: 'Liverpool', iata: 'LPL', icao: 'EGGP', country: { name: 'United Kingdom' } } }, url: '/data/airports/lpl', version: 'v1' };
    const P = page('https://www.flightradar24.com/data/airports/lpl?tl-oa=egow', '<!doctype html><html><head></head><body><div id="app" data-page="' + esc(lpl) + '"></div></body></html>', w => { w.localStorage.setItem('tl.oa.one.egow', JSON.stringify({ row: ROW, ref: 'lpl', near: null, at: Date.now() })); });
    const g = JSON.parse(P.w.document.getElementById('app').getAttribute('data-page'));
    check('an OurAirports airport\'s page made from Liverpool\'s as it loads: Woodvale\'s - and the page held hidden until FR24\'s app has it (what FR24\'s server drew of Liverpool never seen)', g.props.airport.name === 'RAF Woodvale' && veiled(P), g.props.airport.name);
    vue(P, 'Data/Airport', g.props); await until(() => !veiled(P), 2000);
    check('... shown once FR24\'s app has it', !veiled(P));
    P.w.close();
  }

  // ---- 6. their codes, their bookmarks ------------------------------------------------------------------------------------------
  { const P = page('https://www.flightradar24.com/53.4,-2.9/10'), H = P.H();
    const rows = [[28284889, 'GB-1368', 'GB-1368', 'Axis Business Park Helipad', 'Knowsley', 2002, 53.4651, -2.8954, 0, 'H', 0, 'GB-ENG'], [17000123, 'EGOW', 'EGOW', 'RAF Woodvale', 'Southport', 2002, 53.58, -3.05, 37, 'M', 1, 'GB-ENG'], [17000124, 'WSX', 'EGWS', 'Far Field', '', 2002, 54, -3, 0, 'S', 1, 'GB-ENG']];
    H.acceptOa({ rows, sig: 'x', refs: { 2002: 'lpl' } });
    check('the window\'s IATA field: FR24\'s as it is where there is a real IATA code; "N/A" where there is an ICAO code and no IATA code; "OurAirports code" where there is neither', H.oaIataMode(rows[2]) === 'fr24' && H.oaIataMode(rows[1]) === 'na' && H.oaIataMode(rows[0]) === 'oa');
    const doc = P.w.document, item = doc.createElement('div'); item.innerHTML = '<div data-testid="bookmarks__item-airport__iata_icao"><span>GB-1368 / GB-1368</span></div><div data-testid="bookmarks__item-airport__iata_icao"><span>EGOW / EGOW</span></div><div data-testid="bookmarks__item-airport__iata_icao"><span>LPL / EGGP</span></div>'; doc.body.appendChild(item);
    H.bmCodesTick();
    const lines = [...doc.querySelectorAll('[data-testid="bookmarks__item-airport__iata_icao"]')].map(e => e.textContent);
    check('bookmarks: their code line as in their window - "GB-1368", "EGOW" - FR24\'s own airports as FR24 writes them', JSON.stringify(lines) === '["GB-1368","EGOW","LPL / EGGP"]', lines);
    const list = { data: { airports: [{ code: { iata: 'GB-1368', icao: 'GB-1368' }, name: 'Axis Business Park Helipad', timezone: { abbr: 'GMT' }, weather: null }, { code: { iata: 'LPL', icao: 'EGGP' }, weather: { sky: { condition: { text: 'Clear' } } } }] } };
    const wx = H.mxBmOaWx(list);
    await until(() => P.posts.some(p => p.__tweeksLadd === 'needApWx'), 1500);
    const need = P.posts.find(p => p.__tweeksLadd === 'needApWx');
    P.send({ __tweeksLadd: 'apWxGot', ap: need && need.ap, wx: { src: 'model', cond: 'overcast', tempC: 7.4, wkts: 9, wdir: 250, lat: 53.4651, lon: -2.8954, t: Date.now() } });
    const out = await wx, w0 = out.data.airports[0].weather;
    check('... their weather ("Weather is currently not available" before): the monitor\'s, live at the airport, in FR24\'s form - FR24\'s own airports\' left as FR24 gave them', need && need.ap === 28284889 && w0 && w0.sky.condition.text === 'Cloudy' && w0.temp.celsius === 7 && w0.wind.speed.kts === 9 && w0.wind.speed.text === '9 kt' && w0.wind.direction.degree === 250 && out.data.airports[1].weather.sky.condition.text === 'Clear', w0);
    P.w.close();
  }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
