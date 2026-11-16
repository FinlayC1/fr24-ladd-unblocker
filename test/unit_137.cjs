// 1.3.7 - FR24's build of mid-November, its server's own data pages, and the logs' heliports:
//   - "Recent <reg> flights": FR24 asks www.flightradar24.com/api/v2/flights now - filled from the log there too, its rows'
//     airports in its new form ({ id, type, code }); an answer of FR24's in a shape not known left as it is
//   - FR24's pins open an airport by its id now: an OurAirports one found by its id (it was "Cannot load the airport data")
//   - FR24's list of airports at /api/v2/airports: theirs added there too, never one FR24 lists itself by its code
//   - the directory of FR24's app: each family added given its maker (FR24's page grouped them by it and stopped drawing)
//   - the directory and production lists FR24's server makes (its own pages, not its app's): the families and types added
//     in its own rows; theirs' pages made from one of its type pages; its padlocked first flights filled
//   - the Pacific tracks: from the FAA's own messages through the browser when the monitor has none
//   - the route engine: a helicopter's ends at a heliport - M-SKTO on Axis Business Park's helipad, G-WAPA by Greenbank
//     Helipad - in the logs kept from before too; the monitor's makers named as they name themselves
// usage: node test/unit_137.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path'), os = require('os');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch (e) { /* not yet */ } await sleep(20); } return false; };

(async () => {
  // ---- 1. the route engine: a helicopter's ends at a heliport ----------------------------------------------------------
  { const { createRouteEngine } = require('../src/engine.js'), ds = require('./dataset.cjs');
    const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows); E.setFields(ds.loadFields(DATA)); E.setHeliports(ds.loadHeliports(DATA));
    const AXIS = E.fieldId('GB-1368'), GREEN = E.fieldId('GB-1369'), heli = { cls: 'heli', type: 'A169' };
    // (M-SKTO's legs of 5 Nov as its log kept them: lost at -375 ft on the helipad, its next take-off from it - both "-")
    const SK = [{ tStart: 1793868334.98, tEnd: 1793868901.82, startLat: 53.7715, startLon: -3.0263, startAlt: -325, startGs: 50, startTrk: 93, endLat: 53.4653, endLon: -2.8954, endAlt: -375, endGs: 11, endTrk: 214, startedOnGround: false, ended: true, how: 'gap-low', maxAlt: 975, from: { id: 409, code: 'BLK', conf: 'low' }, to: null, path: [[5, 53.605, -2.941, 10]] },
      { tStart: 1793870130.54, tEnd: 1793871973.89, startLat: 53.4651, startLon: -2.8957, startAlt: -300, startGs: 4, startTrk: null, endLat: 52.5182, endLon: -2.2839, endAlt: 250, endGs: 57, endTrk: 96, startedOnGround: true, ended: true, how: 'final', maxAlt: 2000, from: null, to: { id: 8024, code: 'QKH', conf: 'low' }, path: [[5, 53.319, -2.858, 14], [10, 53.158, -2.736, 14], [15, 52.98, -2.602, 18], [20, 52.819, -2.482, 20], [30, 52.519, -2.304, 6]] }];
    const sk = E.chainLegs(E.stitchLegs(SK.map(l => Object.assign({}, l))), heli);
    check('a helicopter\'s log kept from before: M-SKTO lost at -375 ft on Axis Business Park\'s helipad - landed there; its next take-off from there (both "-" in its log)', sk[0].to && sk[0].to.id === AXIS && sk[0].to.code === 'GB-1368' && sk[1].from && sk[1].from.id === AXIS, sk.map(l => [l.from && l.from.code, l.to && l.to.code]));
    check('... its other ends as they were (from Blackpool, to Halfpenny Green)', sk[0].from.code === 'BLK' && sk[1].to.code === 'QKH' && !SK[0].to, sk.map(l => [l.from && l.from.code, l.to && l.to.code]));
    // (G-WAPA, home at Greenbank Helipad: last heard at 300 ft 1.9 km short of it, its path coming its way)
    const GW = [{ tStart: 1793892641.98, tEnd: 1793893794.06, startLat: 53.1139, startLon: -2.7737, startAlt: 900, startGs: 116, startTrk: null, endLat: 53.5064, endLon: -2.9593, endAlt: 300, endGs: 57, endTrk: null, startedOnGround: false, ended: false, how: 'open', maxAlt: 1200, from: null, to: null, path: [[5, 53.208, -2.687, 8], [10, 53.323, -2.694, 10], [15, 53.433, -2.817, 11]] },
      { tStart: 1794396029.68, tEnd: 1794398641.46, startLat: 53.5614, startLon: -2.8744, startAlt: 1400, startGs: 90, startTrk: null, endLat: 54.0593, endLon: -1.2753, endAlt: 400, endGs: 59, endTrk: null, startedOnGround: false, ended: true, how: 'gap-low', maxAlt: 2500, from: null, to: null, path: [[5, 53.618, -2.692, 15], [10, 53.684, -2.52, 22], [15, 53.745, -2.339, 22], [20, 53.809, -2.165, 23], [30, 53.974, -1.86, 19], [40, 54.05, -1.433, 10]] },
      { tStart: 1794484490.89, tEnd: 1794487730.38, startLat: 54.0358, startLon: -0.9025, startAlt: 1500, startGs: 195, startTrk: null, endLat: 53.5003, endLon: -2.9399, endAlt: 800, endGs: 78, endTrk: null, startedOnGround: false, ended: false, how: 'open', maxAlt: 3100, from: null, to: null, path: [[5, 53.933, -1.023, 14], [10, 53.892, -1.196, 17], [15, 53.811, -1.373, 23], [20, 53.733, -1.54, 22], [30, 53.676, -1.942, 28], [40, 53.618, -2.404, 22], [50, 53.544, -2.824, 12]] }];
    const gw = E.chainLegs(E.stitchLegs(GW.map(l => Object.assign({}, l))), { cls: 'heli', type: 'EC35' });
    check('G-WAPA last heard at 300 ft 1.9 km short of Greenbank Helipad, heading for it: to Greenbank Helipad - a guess (near)', gw[0].to && gw[0].to.id === GREEN && gw[0].to.conf === 'near', gw.map(l => l.to));
    check('... never where it was only passing: lost at 800 ft 2.9 km off it heading away - none; its first heard 2.6 km off going away at 1,400 ft, 6.9 km - none', !gw[2].to && !gw[1].from, gw.map(l => [l.from, l.to]));
    const fw = E.chainLegs(E.stitchLegs(SK.map(l => Object.assign({}, l))), { cls: 'piston', type: 'C172' });
    check('... a helicopter\'s only: an aeroplane lost by the helipad is not put down on it', !(fw[0].to && fw[0].to.id === AXIS), fw[0].to);
    // (a new leg: a helicopter's track down to the helipad, lost low on it - landed there as the leg is made)
    const t0 = 1794000000, P = []; for (let i = 0; i <= 12; i++) P.push({ t: t0 + i * 20, lat: 53.43 + i * (53.4652 - 53.43) / 12, lon: -2.85 + i * (-2.8955 + 2.85) / 12, alt: 1500 - i * 150, gs: 90 - i * 6, trk: 320, vr: -450 });
    const legs = E.legsFromPoints(P, { heli: true, cls: 'heli', dataEnd: t0 + 4000 }), sum = legs.map(l => E.summarizeLeg(l, { cls: 'heli', type: 'A169', grp: E.groupOf('heli') }));
    check('... a leg made now: lost low on the helipad - to Axis Business Park\'s helipad', sum.length === 1 && sum[0].to && sum[0].to.id === AXIS, sum.map(s => [s.how, s.to]));
  }

  // ---- 2. the monitor: makers named as they name themselves; a page of a type by registrations --------------------------
  { const { makerOf, createAcTypes } = require('../monitor/actypes.cjs');
    const got = ['The De Havilland Aircraft Of Canada, Limited DHC-2', 'BOEING-VERTOL CH-47 Chinook', 'MD-88', 'KR-2', 'B & F Funk FK-14 Polaris', 'B&F Technik FK-9', 'Atr Atr 72-600', 'C.e.a. Jodel DR.221', 'BRITTEN-NORMAN BN-2 Islander', 'Dg Flugzeugbau DG-800B', 'Md Helicopters MD-520', 'Bombardier Inc BD-700', 'Air Tractor AT-802'].map(makerOf);
    check('the monitor\'s makers: "The De Havilland..." De Havilland, BOEING-VERTOL Boeing Vertol, a model ("MD-88", "KR-2") none, B & F and B&F one, ATR, CEA, Britten-Norman, DG Flugzeugbau, MD Helicopters', JSON.stringify(got) === JSON.stringify(['De Havilland', 'Boeing Vertol', '', '', 'B&F', 'B&F', 'ATR', 'CEA', 'Britten-Norman', 'DG Flugzeugbau', 'MD Helicopters', 'Bombardier', 'Air Tractor']), got);
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'act137-'));
    const ac = [['N1', 'A319', 'AIRBUS A319-115', '0572', 1996], ['N2', 'A319', 'AIRBUS A319-115', '0609', 1996], ['N3', 'A319', 'AIRBUS A319-115', '1001', 1999], ['N4', 'AT72', 'ATR-72-202', '100', 1990], ['N5', 'AT72', 'Atr Atr 72-212A', '101', 1991], ['N6', 'AT72', 'ATR-72-202', '102', 1992], ['N7', 'MD88', 'MD-88', '1', 1988], ['N8', 'MD88', 'MD-88', '2', 1988], ['N9', 'MD88', 'MD-88', '3', 1989]].map((r, i) => ({ hex: (0x400100 + i).toString(16), reg: r[0], type: r[1], model: r[2], msn: r[3], year: r[4] }));
    const T = createAcTypes({ store, pause: () => Promise.resolve() });
    await T.build(async fn => { ac.forEach(fn); return ac.length; }, 77, null);
    const ix = JSON.parse(require('zlib').gunzipSync(T.indexBody())), fams = ix.families.map(f => f.name + ':' + f.types.map(t => t.code).join('+'));
    check('... a type whose commonest name names no maker under the maker its other names give (AT72: ATR); one whose names never do under "Other" - every type listed', fams.includes('ATR:AT72') && fams.includes('Other:MD88'), fams);
    const pr = T.page({ type: 'A319', regs: 'N3,N1,zz9,N4' });
    check('... a page of a type by registrations - FR24\'s list\'s, its padlocked first flights filled: those of that type the monitor has, at once', pr && pr.rows.map(r => r[0] + ':' + r[2]).sort().join() === 'N1:1996,N3:1999', pr);
  }

  let JSDOM = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); } catch (e) { console.log('(skipped the browser: no jsdom)'); }
  if (!JSDOM) { console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0); }
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
  const PI = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0];
  const page = (url, html, before) => {
    const w = new JSDOM(html || '<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window; let H = null; const posts = [];
    w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob;
    w.fetch = () => Promise.reject(new Error('offline')); w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
    if (before) before(w);
    w.eval('(' + PI + ')()');
    return { w, H: () => H, posts, send: data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' })) };
  };
  const json = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'content-type': 'application/json' } });

  // ---- 3. "Recent <reg> flights" at FR24's new address ---------------------------------------------------------------------
  { const ap = (id, iata, icao, name) => ({ id, name, code: { iata, icao }, position: { latitude: 53, longitude: -3, country: { name: 'UK', code: 'GB', id: 1 }, region: { city: name } }, timezone: { name: 'UTC', offset: 0 }, visible: true });
    const row = (n, a, b) => ({ identification: { id: 'a' + n, row: n, callsign: 'MSKTO' }, status: { live: false }, aircraft: { registration: 'M-SKTO' }, airport: { origin: a, destination: b, real: null }, time: {}, __tl: true });
    const ROWS = [row(1, ap(409, 'BLK', 'EGNH', 'Blackpool'), ap(13368, null, 'GB-1368', 'Axis Business Park')), row(2, ap(13368, null, 'GB-1368', 'Axis Business Park'), ap(8024, 'QKH', 'EGBO', 'Halfpenny Green')), row(3, ap(5731, 'LPL', 'EGGP', 'Liverpool'), ap(409, 'BLK', 'EGNH', 'Blackpool'))];
    const P = page('https://www.flightradar24.com/', null, w => { w.fetch = input => { const u = String(typeof input === 'string' ? input : input.url); if (/query=M-SKTO/.test(u)) return Promise.resolve(json({ result: { request: { query: 'M-SKTO' }, response: { item: { current: 0, limit: 5 }, page: { current: 1, more: false }, data: null, aircraftInfo: null } } })); if (/query=EI-NEW/.test(u)) return Promise.resolve(json({ flights: [{ id: 1 }], meta: { n: 1 } })); return Promise.resolve(json({ result: { response: { data: null } } })); }; });
    P.send({ __tweeksLadd: 'hist', reg: 'M-SKTO', data: ROWS }); await sleep(30);
    const qs = '&fetchBy=reg&filterBy=historic&limit=5&page=1&timestamp=1794000000&token=';
    let r = await P.w.fetch('https://www.flightradar24.com/api/v2/flights?query=M-SKTO' + qs), j = await r.json(), d = j.result.response.data;
    check('"Recent M-SKTO flights" at FR24\'s new address (api/v2/flights - its build of mid-November): the log\'s flights in it', Array.isArray(d) && d.length === 3 && d[0].__tl, d && d.length);
    check('... each airport in FR24\'s new form - { id, type, code }, its build looking it up by its id: Axis Business Park\'s helipad by its id, its code shown where it has none', d && JSON.stringify(d[0].airport.origin) === '{"id":409,"type":"iata","code":"BLK"}' && JSON.stringify(d[0].airport.destination) === '{"id":13368,"type":"icao","code":"GB-1368"}' && d[0].airport.real === null, d && d[0].airport);
    r = await P.w.fetch('/api/v2/flights?query=M-SKTO' + qs); j = await r.json();
    check('... asked with a relative address: filled too', (j.result.response.data || []).length === 3);
    r = await P.w.fetch('https://www.flightradar24.com/common/v2/flight/list.json?query=M-SKTO' + qs); j = await r.json();
    check('... at the old address: the rows as they were (its build reads their airports in full)', j.result.response.data[0].airport.origin.code.iata === 'BLK' && j.result.response.data[0].airport.origin.name === 'Blackpool');
    P.send({ __tweeksLadd: 'hist', reg: 'EI-NEW', data: ROWS }); await sleep(30);
    r = await P.w.fetch('https://www.flightradar24.com/api/v2/flights?query=EI-NEW' + qs); j = await r.json();
    check('... an answer of FR24\'s in a shape not known here: left exactly as FR24 gave it - no aircraft\'s list made worse', JSON.stringify(j) === '{"flights":[{"id":1}],"meta":{"n":1}}' && P.H().stats.lastList.left === true, j);
    r = await P.w.fetch('https://www.flightradar24.com/api/v2/flights/123456?date=x'); j = await r.json();
    check('... a single flight (api/v2/flights/<id>): left alone', !(j.result.response.data || []).length);
    P.w.close();
  }

  // ---- 4. FR24's airport lookup by id; its list of airports at /api/v2/airports -----------------------------------------
  { const FR = []; for (let i = 0; i < 120; i++) FR.push({ id: 100 + i, iata: 'Q' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)), icao: 'K' + String(100 + i), name: 'Field ' + i, lat: 40, lon: -100 + i * 0.1, alt: 0, city: 'X', country: 'US', countryId: 1, size: 100, timezone: { name: 'UTC', offset: 0, abbr: 'UTC', isDst: false } });
    FR.push({ id: 900, iata: null, icao: 'EGOW', name: 'Woodvale', lat: 53.58, lon: -3.05, alt: 37, city: 'Southport', country: 'United Kingdom', countryId: 2, size: 100, timezone: { name: 'Europe/London', offset: 0, abbr: 'GMT', isDst: false } });
    const OA = [[10000001, 'GB-1368', 'GB-1368', 'Axis Business Park Helipad', '', 900, 53.465098, -2.895401, 0, 'H'], [10000002, 'EGOW', 'EGOW', 'RAF Woodvale', 'Southport', 900, 53.58, -3.05, 37, 'M']];
    const P = page('https://www.flightradar24.com/53.4,-2.9/9', null, w => { w.fetch = input => { const u = String(typeof input === 'string' ? input : input.url); if (/\/api\/v2\/airports(\?|$)/.test(u)) return Promise.resolve(json({ version: 7, rows: FR })); return Promise.reject(new Error('offline')); }; });
    const H = P.H(); H.acceptOa({ rows: OA, refs: { 900: 'egow' } });
    const j = await (await P.w.fetch('https://www.flightradar24.com/api/v2/airports')).json(), ids = j.rows.map(r => r.id);
    check('FR24\'s list of airports at its new address (/api/v2/airports): theirs in it - never one FR24 now lists itself by its code (its ICAO-only airports are in its list now: EGOW)', ids.includes(10000001) && !ids.includes(10000002) && ids.includes(900) && j.version === 7, ids.slice(-3));
    // (FR24's lookup, as its build makes it: its methods on an object of its own, the module's a copy of them - its lookup
    // by code or id asks its own object's byId, not the module's)
    const db = FR.map(a => ({ id: a.id, iata: a.iata, icao: a.icao, name: a.name, latitude: a.lat, longitude: a.lon }));
    const t = { async byICAO(c) { return db.find(a => a.icao === c) || null; }, async byId(n) { return db.find(a => a.id === n) || null; }, async byIATA(c) { return db.find(a => a.iata === String(c).toUpperCase()) || null; }, async byCodeOrId(n) { return typeof n === 'number' ? t.byId(n) : n.length === 3 ? t.byIATA(n.toUpperCase()) : n.length === 4 ? t.byICAO(n.toUpperCase()) : null; } };
    const Za = Object.assign({ list() {}, find() {} }, t); H.mxPatchCore({ Za });
    const a1 = await Za.byCodeOrId(10000001), a2 = await Za.byCodeOrId(100), a3 = await Za.byCodeOrId('GB-1368'), a4 = await Za.byCodeOrId(55555);
    check('FR24\'s pins open an airport by its id now (its build of mid-November): an OurAirports pin\'s id found - it was "Cannot load the airport data"', a1 && a1.id === 10000001 && /Axis/.test(a1.name), a1);
    check('... FR24\'s own by id as FR24 has them; by code as before; an id nobody has still none', a2 && a2.id === 100 && a3 && a3.id === 10000001 && a4 === null);
    P.w.close();
  }

  // ---- 5. FR24's app's directory: each family added under its maker ---------------------------------------------------
  { const P = page('https://www.flightradar24.com/data/aircraft'), H = P.H();
    const FR24 = [{ code: 'DHCX', name: 'Bombardier Dash 8 family', slug: 'dhcx', count: 1099, manufacturer: 'Bombardier', types: [{ code: 'DH8D', slug: 'dh8d', count: 590 }] }, { code: 'E17X', name: 'Embraer E170 family', slug: 'e17x', count: 1014, manufacturer: 'Embraer', types: [{ code: 'E170', slug: 'e170', count: 170 }] }];
    const OURS = [{ code: 'GLOBAL', name: 'Bombardier Global', slug: 'bombardier-global', count: 9, types: [{ code: 'GLEX', name: 'G6000', slug: 'glex', count: 9 }] }, { code: 'PHENOM', name: 'Embraer Phenom and Praetor', slug: 'embraer-phenom-and-praetor', count: 5, types: [{ code: 'E55P', name: 'Phenom 300', slug: 'e55p', count: 5 }] }, { code: 'GULFSTREAM', name: 'Gulfstream', slug: 'gulfstream', count: 7, types: [{ code: 'GLF6', name: 'G650', slug: 'glf6', count: 7 }] }, { code: 'AIRBUSHELI', name: 'Airbus Helicopters', slug: 'airbus-helicopters', count: 4, types: [{ code: 'EC35', name: 'EC135', slug: 'ec35', count: 4 }] }];
    const m = H.acMerge(FR24, OURS), by = c => m.families.find(f => f.code === c);
    check('FR24\'s app\'s directory: each family added given a maker - its page groups families by it, and one without stopped it being drawn (the families were in its data, never on the page)', m.families.every(f => typeof f.manufacturer === 'string' && f.manufacturer));
    check('... a maker\'s product line under that maker, as FR24 writes it (Bombardier Global with Bombardier, the Phenom with Embraer); any other family named after its maker', by('GLOBAL').manufacturer === 'Bombardier' && by('PHENOM').manufacturer === 'Embraer' && by('GULFSTREAM').manufacturer === 'Gulfstream' && by('AIRBUSHELI').manufacturer === 'Airbus Helicopters', m.families.map(f => f.code + ':' + f.manufacturer));
    const kept = H.acMergeAdd(FR24, m.add.map(a => { const o = Object.assign({}, a); delete o.manufacturer; return o; }));
    check('... the additions kept by 1.3.6 (no maker) given one as the page loads', kept.filter(f => f.tl).every(f => f.manufacturer) && kept.find(f => f.code === 'GLOBAL').manufacturer === 'Bombardier');
    P.w.close();
  }

  // ---- 6. FR24's server's own directory and production lists ---------------------------------------------------------
  const famRow = (name, code, n, types) => `<tr class="border-top"><td rowspan="${types.length + 1}"><label class="aircraft-family">${name}</label></td><td> <strong><a href="https://www.flightradar24.com/data/aircraft/${code.toLowerCase()}" title="Aircraft family code">${code}</a></strong></td><td class="text-right"><strong><span title="Total number of aircraft for this family" class="cursor-help"> ${n} </span></strong></td></tr>` +
    types.map(t => `<tr><td> <a href="https://www.flightradar24.com/data/aircraft/${code.toLowerCase()}/${t[0].toLowerCase()}"> ${t[0]} </a></td><td class="text-right"><span title="Total number of ${t[0]} aircraft" class="cursor-help"> ${t[1]} </span></td></tr>`).join('') + '<tr><td colspan="3">&nbsp;</td></tr>';
  const DIRHTML = '<!doctype html><html><head></head><body><section id="cnt-data-subpage"><div id="list-aircraft"><table class="table table-condensed data-table"><colgroup><col><col span="2"></colgroup><tbody>' +
    famRow('ATR 42 family', 'ATR42', 292, [['AT43', 107], ['AT46', 185]]) + famRow('Airbus A320 family', 'A32S', 11870, [['A319', 1110], ['A320', 5000]]) + famRow('Bombardier Dash 8 family', 'DHCX', 1099, [['DH8D', 590]]) + famRow('Cessna 408 SkyCourier family', 'C408', 78, [['C408', 78]]) + famRow('Embraer E170 family', 'E17X', 1014, [['E170', 170]]) + famRow('Tecnam P2012 family', 'P212', 99, [['P212', 99]]) +
    '</tbody></table></div></section></body></html>';
  const OURS = [{ code: 'GLOBAL', name: 'Bombardier Global', slug: 'bombardier-global', count: 1314, types: [{ code: 'GLEX', name: 'Bombardier Inc BD-700-1A10', slug: 'glex', count: 1314 }] }, { code: 'GULFSTREAM', name: 'Gulfstream', slug: 'gulfstream', count: 740, types: [{ code: 'GLF6', name: 'G650', slug: 'glf6', count: 740 }] }, { code: 'C408', name: 'Cessna 408 SkyCourier family', slug: 'c408', count: 5, types: [{ code: 'C40X', name: 'Not a type', slug: 'c40x', count: 5 }] }];
  let addKept = null, refKept = null;
  { const P = page('https://www.flightradar24.com/data/aircraft', DIRHTML), H = P.H(), d = P.w.document;
    const fams = () => [...d.querySelectorAll('label.aircraft-family')].map(l => l.textContent.trim());
    H.acLegTick(); const asked = P.posts.filter(p => p.__tweeksLadd === 'acDir').length;
    P.send({ __tweeksLadd: 'acDirGot', key: 'idx', families: OURS, at: 1 }); await sleep(20);
    const f1 = fams(), n1 = d.querySelectorAll('tr[data-tl]').length;
    check('FR24\'s server\'s own directory (/data/aircraft - the page FR24 sends this browser; 1.3.5 and 1.3.6 changed only its app\'s): the families added, among FR24\'s in its own order (by name)', asked === 1 && JSON.stringify(f1) === JSON.stringify(['ATR 42 family', 'Airbus A320 family', 'Bombardier Dash 8 family', 'Bombardier Global', 'Cessna 408 SkyCourier family', 'Embraer E170 family', 'Gulfstream', 'Tecnam P2012 family']), f1);
    const gl = [...d.querySelectorAll('tr[data-tl]')].find(tr => /Bombardier Global/.test(tr.textContent)), td = gl && gl.querySelector('td[rowspan]');
    check('... in FR24\'s own rows: the family\'s label over its rows, its code and total, then its types with theirs, linked to their pages', !!gl && td.getAttribute('rowspan') === '2' && gl.querySelector('a').getAttribute('href') === '/data/aircraft/bombardier-global' && /1314/.test(gl.textContent) && !!d.querySelector('a[href="/data/aircraft/bombardier-global/glex"]'));
    const c408 = [...d.querySelectorAll('label.aircraft-family')].find(l => /408/.test(l.textContent)).closest('td');
    check('... a family FR24 has under the same code given the type it lacks among its own (its label over one more row, its total with it)', c408.getAttribute('rowspan') === '3' && !!d.querySelector('a[href="/data/aircraft/c408/c40x"]') && /83/.test(c408.closest('tr').querySelector('td.text-right').textContent));
    H.acLegTick(); P.send({ __tweeksLadd: 'acDirGot', key: 'idx', families: OURS, at: 1 }); H.acLegTick(); await sleep(20);
    check('... nothing added twice', d.querySelectorAll('tr[data-tl]').length === n1 && fams().length === f1.length && c408.getAttribute('rowspan') === '3');
    refKept = P.w.localStorage.getItem('tl.ac.ref'); addKept = P.w.localStorage.getItem('tl.ac.add');
    check('... FR24\'s own type page to make theirs from learned from it (the family with the most aircraft, its first type)', JSON.parse(refKept).type === 'a319' && JSON.parse(refKept).legacy === 1, refKept);
    P.w.close();
  }
  { const P = page('https://www.flightradar24.com/data/aircraft', DIRHTML, w => { w.localStorage.setItem('tl.ac.add', addKept); w.localStorage.setItem('tl.ac.ref', refKept); });
    await until(() => P.w.document.readyState !== 'loading', 2000); await sleep(20);
    check('... the next time: built as the page loads, from what was kept - before the monitor is asked', P.w.document.querySelectorAll('tr[data-tl]').length > 3 && !!P.w.document.querySelector('a[href="/data/aircraft/gulfstream/glf6"]'));
    P.w.close();
  }
  const TYPEHTML = '<!doctype html><html><head><title>Airbus A319-115 (A319) production list - Flight tracker | Flightradar24</title></head><body><nav><ol><li><a href="/data/aircraft"><div class="breadcrumbs__list-item-name"> Aircraft </div></a></li><span>&gt;</span><li><a itemid="/data/aircraft/a32s" href="https://www.flightradar24.com/data/aircraft/a32s"><div class="breadcrumbs__list-item-name"> Airbus A320 family </div></a></li><span>&gt;</span><li><div><div class="breadcrumbs__list-item-name"> A319 </div></div></li></ol></nav>' +
    '<section id="cnt-data-subpage"><div class="row section-header"><div id="cnt-subpage-title"><h1>Production lists - Airbus A320 family - A319</h1><h3 class="pull-right">Total number of aircraft: 1110</h3></div></div><div id="cnt-list-aircraft"><table class="table table-condensed table-hover data-table"><thead><tr><th>MSN</th> <th>REGISTRATION</th><th>AIRLINE</th><th>FIRST FLIGHT (AGE)</th><th>PHOTO</th></tr></thead><tbody>' +
    '<tr><td> 00572 </td> <td><a class="regLinks" href="https://www.flightradar24.com/data/aircraft/c-fyns"> C-FYNS </a></td><td> Air Canada </td> <td><a class="premium-content"><svg class="premium-lock"></svg></a></td><td></td></tr></tbody></table></div></section></body></html>';
  { const url = 'https://www.flightradar24.com/data/aircraft/a32s/a319?tl-ac=' + encodeURIComponent('/data/aircraft/bombardier-global/glex');
    const P = page(url, TYPEHTML, w => { w.localStorage.setItem('tl.ac.add', addKept); w.localStorage.setItem('tl.ac.ref', refKept); }), d = P.w.document;
    await until(() => P.posts.some(p => p.__tweeksLadd === 'acPage'), 2000);
    const ask = P.posts.find(p => p.__tweeksLadd === 'acPage') || {};
    check('one of theirs (Bombardier Global\'s GLEX), made from FR24\'s server\'s own type page: its address theirs, the monitor asked for its aircraft', !!ask && ask.code === 'GLEX' && ask.kind === 'type' && P.w.location.pathname === '/data/aircraft/bombardier-global/glex', ask);
    P.send({ __tweeksLadd: 'acPageGot', key: ask.key, page: { code: 'GLEX', total: 1314, averageAge: 12, page: 1, lastPage: 27, perPage: 50, rows: [['N288JP', '00034', 2011, 'Jung Phillip E Trustee', 'a1b2c3'], ['C-GLXA', '9001', 0, '', 'c00001']] } }); await sleep(20);
    const rows = [...d.querySelectorAll('#cnt-list-aircraft tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
    check('... its title, total and crumbs theirs; its rows FR24\'s columns - serial number, registration (its page), owner, year built and age, photos - 50 a page, its pages linked', /Production lists - Bombardier Global - GLEX/.test(d.querySelector('h1').textContent) && /1314/.test(d.querySelector('h3').textContent) && [...d.querySelectorAll('.breadcrumbs__list-item-name')].map(x => x.textContent.trim()).join('>') === 'Aircraft>Bombardier Global>GLEX' &&
      rows.length === 2 && rows[0][0] === '00034' && rows[0][1] === 'N288JP' && /^2011 \(\d+ years\)$/.test(rows[0][3]) && rows[1][3] === '' && !!d.querySelector('a[href="/data/aircraft/n288jp"]') && /Page 1 of 27/.test(d.getElementById('tl-ac-pages').textContent) && /GLEX/.test(d.title), rows);
    P.w.close();
  }
  { const P = page('https://www.flightradar24.com/data/aircraft/a32s/a319', TYPEHTML, w => { w.localStorage.setItem('tl.ac.add', addKept); w.localStorage.setItem('tl.ac.ref', refKept); });
    await until(() => P.w.document.readyState !== 'loading', 2000); await sleep(20);
    check('... FR24\'s own type pages left to FR24 (and to the userscript\'s filling of its padlocked first flights)', !P.posts.some(p => p.__tweeksLadd === 'acPage') && /A319/.test(P.w.document.querySelector('h1').textContent) && P.w.document.querySelectorAll('#cnt-list-aircraft tbody tr').length === 1);
    P.w.close();
  }
  // (the userscript's filling of FR24's own list: its column by its heading, a padlocked cell only)
  { const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '03-data.js'), 'utf8');
    const src = (main.match(/\n {2}let prodWait = 0;\n {2}async function prodListTick\(\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
    const w = new JSDOM(TYPEHTML.replace('</tbody>', '<tr><td> 00609 </td> <td><a> D-AILA </a></td><td> Lufthansa </td> <td> 1996 (30 years) </td><td></td></tr><tr data-tl="1"><td> 1 </td><td><a> N9 </a></td><td></td><td></td><td></td></tr></tbody>'), { url: 'https://www.flightradar24.com/data/aircraft/a32s/a319' }).window;
    let asked = null;
    const env = { document: w.document, location: w.location, now: () => Date.now(), opt: { on: true }, clean: s => String(s || '').replace(/\s+/g, ' ').trim(), acAgesOf: async q => { asked = q; return { 'C-FYNS': ['00572', 1996] }; } };
    const tick = src && new Function(...Object.keys(env), src + '\nreturn prodListTick;')(...Object.values(env));
    if (tick) await tick();
    const cells = [...w.document.querySelectorAll('tbody tr')].map(tr => tr.children[3].textContent.trim());
    check('FR24\'s own production list: its padlocked "FIRST FLIGHT (AGE)" cells filled - the year built and age, by the registrations on it, of its type; a filled cell and the page part\'s own rows left as they are', !!asked && JSON.stringify(asked) === '{"A319":["C-FYNS"]}' && /^1996 \(\d+ years\)$/.test(cells[0]) && cells[1] === '1996 (30 years)' && cells[2] === '', { asked, cells });
  }

  // ---- 7. the Pacific tracks: the FAA's own messages through the browser ------------------------------------------------
  { const P = page('https://www.flightradar24.com/'), H = P.H();
    const fmt = t => { const d = new Date(t); return String(d.getUTCFullYear()).slice(2) + [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()].map(n => String(n).padStart(2, '0')).join(''); };
    const TDM = `(TDM TRK A ${fmt(Date.now() - 3600e3)}01\n${fmt(Date.now() - 3600e3)} ${fmt(Date.now() + 10 * 3600e3)}\nJOHNI 34N140W 38N150W 41N160W 43N170W 44N180E 44N170E 43N160E LEPKI\nRTS/KLAX JOHNI\nRMK/0)`;
    const t1 = H.mxPacParse('<pre>' + TDM + '</pre>');
    check('the Pacific tracks\' messages (TDM) read in the page as the monitor reads them: track A westbound, its positions across 180° in one line (170E as -190)', t1['PAC-A'] && t1['PAC-A'].d === 'WEST' && Object.keys(t1['PAC-A'].p).length === 7 && t1['PAC-A'].p[4].lon === -180 && t1['PAC-A'].p[5].lon === -190, t1['PAC-A']);
    const seen = [], done = new Set(), answer = u => /^mon:/.test(u) ? { status: 503, body: 'not ready' } : /pilotweb/.test(u) ? { status: 0 } : /^notams:KZAK:0$/.test(u) ? { status: 200, body: JSON.stringify({ totalNotamCount: 1, notamList: [{ icaoMessage: TDM }] }) } : { status: 200, body: JSON.stringify({ totalNotamCount: 0, notamList: [] }) };
    const iv = setInterval(() => { for (const p of P.posts) if (p.__tweeksLadd === 'mxGet' && !done.has(p.rid)) { done.add(p.rid); seen.push(p.url); const a = answer(p.url); P.send(Object.assign({ __tweeksLadd: 'mxGot', rid: p.rid }, a)); } }, 5);
    const o = await H.mxPacots(); clearInterval(iv);
    check('the monitor with none (the FAA\'s NOTAM Search refuses servers in data centres): FAA PilotWeb\'s page, then NOTAM Search\'s messages of the three oceanic centres asked from this browser - the tracks found', o['PAC-A'] && seen[0] === 'mon:/wx/pacots' && /pilotweb\.nas\.faa\.gov/.test(seen[1]) && seen.slice(2).join() === 'notams:KZAK:0,notams:RJJJ:0,notams:PAZA:0', seen);
    check('... kept half an hour (the messages come out twice a day)', !!JSON.parse(P.w.localStorage.getItem('tl.pac') || 'null'));
    P.w.close();
  }

  // ---- 8. what the build gives --------------------------------------------------------------------------------------
  { const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist', 'extension', 'manifest.json'), 'utf8'));
    const connects = new Set(SRC.split('\n').map(l => l.match(/^\/\/ @connect\s+(\S+)\s*$/)).filter(Boolean).map(m => m[1]));
    check('the extension may see FR24\'s own site - its background never saw FR24\'s server send a typed OurAirports airport\'s address (/data/airports/egow) or an added type\'s on to its list without it', man.host_permissions.includes('https://www.flightradar24.com/*') && man.host_permissions.includes('https://flightradar24.com/*'));
    check('... and the FAA\'s two addresses of the Pacific tracks, as the userscript may', ['pilotweb.nas.faa.gov', 'notams.aim.faa.gov'].every(h => man.host_permissions.includes('https://' + h + '/*') && connects.has(h)), [...connects].filter(c => /faa/.test(c)));
  }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
