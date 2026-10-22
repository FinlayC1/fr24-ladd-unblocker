// Predicted destinations wherever FR24 lists a flight with none (the BUILT userscript in jsdom, its page part and its
// script part talking as in the browser):
//   - FR24's Most tracked widget (Feed/TopFlights, and the JSON list): a flight shown "ADW - N/A" (AF1 out of Andrews)
//     given the destination worked out here (GSP); FR24's own destinations left alone; one not worked out yet asked for
//   - asked for: worked out from FR24's own track of the flight (fetched in the background) and handed to the page
//   - FR24's search: a route asked for ("LPL-EIS", "EGGP-TUPJ") lists the flights worked out on it - M-PORT, blocked -
//     as live flights, with the callsign after (to its flight-number page); with FR24 answering nothing as well; FR24's
//     own live row of a flight it has no destination for gets the one worked out here
// usage: node test/unit_mosttracked.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };

// FR24's answers: its airport list, its search (a live row of AF1 with no destination when asked for AF1; nothing for a
// route - or an error, when told), its Most tracked list as JSON
const S = { searchFails: false };
const AF1 = 0x3a1b2c3d, MPORT = 0x3a1b2c40, NEW = 0x3a1b2c41;
function answer(url) {
  if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
  if (/\/v1\/search\/web\/find\?/.test(url)) {
    if (S.searchFails) return [500, ''];
    const live = /query=AF1/.test(url) ? [{ id: AF1.toString(16), label: 'AF1 / RCH1 / B748', detail: { lat: 38, lon: -80, schd_from: 'ADW', schd_to: '', ac_type: 'B748', route: 'Camp Springs (ADW) ⟶ ?', reg: '', callsign: 'RCH1', flight: 'AF1' }, type: 'live', match: 'begins' }] : [];
    return [200, JSON.stringify({ results: live, stats: { total: { all: live.length, live: live.length }, count: { live: live.length } } })];
  }
  if (/\/flights\/most-tracked/.test(url)) return [200, JSON.stringify({ version: '0.1', data: [
    { flight_id: AF1.toString(16), flight: 'AF1', callsign: 'RCH1', from_iata: 'ADW', from_city: 'Camp Springs', to_iata: null, to_city: null, model: 'B748' },
    { flight_id: '3a1b2c50', flight: 'BA117', callsign: 'BAW117', from_iata: 'LHR', from_city: 'London', to_iata: 'JFK', to_city: 'New York', model: 'B77W' }] })];
  return [404, ''];
}
function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/53.33,-2.85/10', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u;
    if (/Feed\/TopFlights/.test(u) && S.top) return Promise.resolve(new Response(S.top.body, { status: 200, headers: { 'content-type': S.top.ct, 'content-length': String(S.top.body.length) } }));
    const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.__posted = []; win.postMessage = data => { win.__posted.push(data); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.console.debug = () => {}; win.console.log = () => {};
  win.__tlTestHook = h => { win.__H = h; };
  win.eval(SRC);
  return win;
}
const cat = parts => { const n = parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  const H = await until(() => w.__H, 5000), B = w.__tweeksLaddBridge, E = L.engine;
  check('(the page part and the engine are up)', !!H && !!B && E.airports.length > 5000);
  const dec = new TextDecoder(), str = (fs, n) => { const f = fs.find(x => x.fn === n); return f ? dec.decode(f.val) : ''; };
  const lpl = E.byIcao('EGGP'), eis = E.byIcao('TUPJ'), blk = E.byIcao('EGNH'), gsp = E.byIcao('KGSP');
  check('(airports: Liverpool, Beef Island EIS, Blackpool, Greenville-Spartanburg)', !!lpl && !!eis && !!blk && !!gsp);

  // ---- Most tracked (Feed/TopFlights): AF1 "ADW - N/A", BA117 LHR-JFK, a third flight not worked out yet
  const entry = (id, fn, cs, from, fromCity, to, toCity, type) => H.fLen(1, cat([H.fVar(1, id), H.fVar(2, 1200), H.fVar(3, 5000), H.fStr(4, fn), H.fStr(5, cs), from ? H.fStr(7, from) : new Uint8Array(0), fromCity ? H.fStr(8, fromCity) : new Uint8Array(0), to ? H.fStr(9, to) : new Uint8Array(0), toCity ? H.fStr(10, toCity) : new Uint8Array(0), H.fStr(11, type)]));
  const top = cat([entry(AF1, 'AF1', 'RCH1', 'ADW', 'Camp Springs', '', '', 'B748'), entry(0x3a1b2c50, 'BA117', 'BAW117', 'LHR', 'London', 'JFK', 'New York', 'B77W'), entry(NEW, 'RCH359', 'RCH359', 'ADW', 'Camp Springs', '', '', 'C17')]);
  B.naRoutes.set(AF1, { originIata: 'ADW', originCity: 'Camp Springs', destId: gsp.id, destIata: 'GSP', destCity: 'Greenville', destConf: 'probable', destP: 61, landed: false });
  w.__posted.length = 0;
  const out = H.patchTopFlights(top), items = H.parse(out).map(f => H.parse(f.val));
  check('Most tracked: AF1 (ADW - N/A) gets the destination worked out here: GSP, Greenville', str(items[0], 9) === 'GSP' && str(items[0], 10) === 'Greenville' && str(items[0], 7) === 'ADW' && str(items[0], 5) === 'RCH1' && items[0].find(f => f.fn === 1).val === AF1, items[0].map(f => f.fn));
  check('... FR24\'s own destination left as it is (BA117 to JFK), byte for byte', Buffer.compare(Buffer.from(H.parse(out)[1].raw), Buffer.from(H.parse(top)[1].raw)) === 0);
  check('... one not worked out yet left N/A, and asked for (with its callsign, origin and type)', !str(items[2], 9) && w.__posted.some(m => m.__tweeksLadd === 'needNaRoutes' && m.list.some(x => x.id === NEW && x.cs === 'RCH359' && x.from === 'ADW' && x.type === 'C17')), w.__posted.map(m => m.__tweeksLadd));
  check('... and asked for again only after a while', (w.__posted.length = 0, H.patchTopFlights(top), !w.__posted.some(m => m.__tweeksLadd === 'needNaRoutes')));
  check('... the patch is put on FR24\'s TopFlights requests', /Feed\\\/TopFlights/.test(SRC) && /installBinary\(this, patchTopFlights\)/.test(SRC));

  // ---- the same list asked for with fetch (gRPC-web, binary and base64 text)
  { const frame = b => cat([Uint8Array.of(0, (b.length >>> 24) & 255, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255), b]), trailer = Buffer.from('\x80\x00\x00\x00\x0fgrpc-status:0\r\n', 'binary');
    const items = buf => { const u = new Uint8Array(buf), len = ((u[1] << 24) | (u[2] << 16) | (u[3] << 8) | u[4]) >>> 0; return H.parse(u.subarray(5, 5 + len)).map(f => H.parse(f.val)); };
    S.top = { ct: 'application/grpc-web+proto', body: Buffer.concat([Buffer.from(frame(top)), trailer]) };
    let r = await w.fetch('https://data-feed.flightradar24.com/fr24.feed.api.v1.Feed/TopFlights', { method: 'POST' }), buf = await r.arrayBuffer();
    check('Most tracked asked for with fetch (binary): AF1 to GSP, the trailer frame kept', str(items(buf)[0], 9) === 'GSP' && Buffer.from(buf).subarray(-trailer.length).equals(trailer) && !r.headers.get('content-length'), str(items(buf)[0], 9));
    S.top = { ct: 'application/grpc-web-text+proto', body: Buffer.from(Buffer.from(frame(top)).toString('base64') + trailer.toString('base64')) };
    r = await w.fetch('https://data-feed.flightradar24.com/fr24.feed.api.v1.Feed/TopFlights', { method: 'POST' });
    const raw = Buffer.from(await r.text(), 'base64');
    check('... and as base64 text: AF1 to GSP', str(items(raw)[0], 9) === 'GSP', str(items(raw)[0], 9));
    S.top = null; }

  // ---- the same list as JSON
  const mt = await (await w.fetch('https://www.flightradar24.com/flights/most-tracked')).json();
  check('Most tracked (JSON): AF1 to GSP; BA117 still to JFK', mt.data[0].to_iata === 'GSP' && mt.data[0].to_city === 'Greenville' && mt.data[1].to_iata === 'JFK', mt.data.map(d => [d.flight, d.to_iata]));

  // ---- asked for: worked out from FR24's track of it - a Cessna down the coast from Blackpool, on final for Liverpool's 27
  { const nowS = Math.round(Date.now() / 1000), pts = [];
    let t = nowS - 1900, p = E.destPoint(blk.lat, blk.lon, 180, 8);
    for (let i = 0; i < 26; i++) { const tgt = E.destPoint(lpl.lat, lpl.lon, 86, 9), b = E.brg(p[0], p[1], tgt[0], tgt[1]); p = E.destPoint(p[0], p[1], b, Math.min(2.2, E.dist(p[0], p[1], tgt[0], tgt[1]))); pts.push({ t, lat: p[0], lon: p[1], alt: 2000, gs: 100, trk: b }); t += 60; }
    for (let i = 0; i < 6; i++) { p = E.destPoint(p[0], p[1], 266, 0.9); pts.push({ t, lat: p[0], lon: p[1], alt: 1500 - i * 150, gs: 80, trk: 266 }); t += 30; }
    const ID = 0x3a1b2c60;
    w.__posted.length = 0;
    L.onNeedNaRoutes({ list: [{ id: ID, cs: 'GDEMO', from: 'BLK', type: 'C172' }] });
    check('asked for one whose track is not here: FR24\'s track of it asked for in the background', w.__posted.some(m => m.__tweeksLadd === 'needTrail' && m.id === ID) && L.naWanted.has(ID));
    // (the page's answer, as its background FollowFlight gives it)
    w.postMessage({ __tweeksLadd: 'trail', id: ID, first: pts[0], n: pts.length, maxAlt: 2000, pts, at: Date.now(), bg: true });
    await until(() => B.naRoutes.has(ID), 3000);
    const r = B.naRoutes.get(ID);
    check('... its track in: worked out (to Liverpool, from Blackpool) and handed to the page', !!r && r.destIata === 'LPL' && !L.naWanted.has(ID), r && [r.originIata, r.destIata, r.destConf, r.destP]);
    const o2 = H.parse(H.patchTopFlights(entry(ID, 'GDEMO', 'GDEMO', 'BLK', 'Blackpool', '', '', 'C172'))).map(f => H.parse(f.val));
    check('... and Most tracked shows it: BLK - LPL', str(o2[0], 9) === 'LPL', str(o2[0], 9));
  }

  // ---- a route searched for: M-PORT (blocked), worked out Liverpool to EIS, in the air
  L.live.set(MPORT, { id: MPORT, hex: '43eaf1', reg: 'M-PORT', cs: 'MPORT', type: 'GLF6' });
  L.routeState.set(MPORT, { route: { originId: lpl.id, originIata: 'LPL', originCity: 'Liverpool', destId: eis.id, destIata: 'EIS', destCity: 'Beef Island', destConf: 'likely', destP: 74, landed: false, eta: 0 } });
  L.pending.set(MPORT, { id: MPORT, lat: 50.1, lon: -20.3, alt: 41000, spd: 480, trk: 245, gnd: false, receivedAt: Date.now() });
  const search = async q => { const r = await w.fetch(`https://www.flightradar24.com/v1/search/web/find?query=${encodeURIComponent(q)}&limit=50`); return r.json(); };
  for (const q of ['LPL-EIS', 'EGGP-TUPJ', 'lpl - eis']) {
    const j = await search(q), i = j.results.findIndex(r => r.type === 'live' && r.id === MPORT.toString(16)), s = j.results.findIndex(r => r.type === 'schedule' && r.id === 'MPORT');
    const row = j.results[i];
    check(`route search "${q}": M-PORT listed as a live flight, LPL to EIS, with its flight number (MPORT) after it`, i >= 0 && s > i && row.detail.schd_from === 'LPL' && row.detail.schd_to === 'EIS' && /MPORT/.test(row.label) && /Liverpool \(LPL\) ⟶ Beef Island \(EIS\)/.test(row.detail.route) && row.detail.lat === 50.1, j.results.map(r => [r.type, r.id]));
  }
  { const j = await search('LPL-JFK'); check('... not on another route', !j.results.some(r => r.id === MPORT.toString(16))); }
  L.routeState.get(MPORT).route.landed = true;
  { const j = await search('LPL-EIS'); check('... nor once it has landed', !j.results.some(r => r.id === MPORT.toString(16))); }
  L.routeState.get(MPORT).route.landed = false;
  S.searchFails = true;
  { const j = await search('LPL-EIS'); check('... FR24\'s search answering nothing (an error): M-PORT listed on its own, its flight number after it', j.results.length === 2 && j.results[0].id === MPORT.toString(16) && j.results[1].id === 'MPORT' && j.stats.total.all === 2, j.results.map(r => r.id)); }
  S.searchFails = false;
  // ---- FR24's own live row of AF1, no destination
  { const j = await search('AF1'), row = j.results.find(r => r.id === AF1.toString(16));
    check('FR24\'s own search row of AF1 (no destination): GSP, and its route line', !!row && row.detail.schd_to === 'GSP' && row.detail.schd_from === 'ADW' && /⟶ Greenville \(GSP\)/.test(row.detail.route), row && row.detail); }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
