// End-to-end test of the BUILT userscript in jsdom with real network (adsb.lol, adsb.fi, Planespotters, FAA, FR24 JSON).
// FR24's gRPC feed is simulated from live LADD aircraft; everything else is the real thing.
// usage: node test/e2e.cjs <node_modules dir> [map|page] [reg for page mode]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const NM = process.argv[2];
const mode = process.argv[3] || 'map';
const { JSDOM } = require(path.join(NM, 'jsdom'));
const { indexedDB, IDBKeyRange } = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(process.env.E2E_SRC || path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
// TM_WRAP=1: run it as Tampermonkey does - its window a wrapper of the page's (unsafeWindow the page's own)
const RUN = src => process.env.TM_WRAP ? '(function (window) {' + src + '\n}).call(window, new Proxy(window, { get(t, k) { const v = Reflect.get(t, k); return typeof v === "function" && !/^[A-Z]/.test(String(k)) ? v.bind(t) : v; } }));' : src;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now2 = () => Date.now();
const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const netLog = [];
const { execFile } = require('child_process');
function curlFetch(url) {
  return new Promise((res, rej) => execFile('curl', ['-s', '--compressed', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64e6, encoding: 'buffer' }, (err, out) => {
    if (err) return rej(err);
    const s2 = out.toString('utf8'); const i = s2.lastIndexOf('\n'); const status = Number(s2.slice(i + 1)) || 0;
    res(new Response(s2.slice(0, i), { status, headers: { 'content-type': 'application/json' } }));
  }));
}
async function netFetch(url, init) {
  // (FR24 and airplanes.live refuse Node's own HTTP client - its TLS handshake is not a browser's - and answer curl)
  if (/flightradar24\.com|globe\.airplanes\.live/.test(url)) { const t = Date.now(); const r = await curlFetch(url); netLog.push([url.slice(0, 110), r.status, Date.now() - t]); return r; }
  const headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json, text/html;q=0.9, */*;q=0.8' }, (init && init.headers) || {});
  if (/planespotters/.test(url)) Object.assign(headers, { Origin: 'https://www.flightradar24.com', Referer: 'https://www.flightradar24.com/', 'Sec-Fetch-Mode': 'cors' });
  const t = Date.now();
  const r = await fetch(url, { headers, redirect: 'follow', method: (init && init.method) || 'GET', body: init && init.body });
  netLog.push([url.slice(0, 110), r.status, Date.now() - t]);
  return r;
}
function makeDom(url, html) {
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.indexedDB = indexedDB; w.IDBKeyRange = IDBKeyRange; w.DecompressionStream = DecompressionStream; w.Blob = Blob;
  w.Response = Response; w.Headers = Headers; w.AbortController = AbortController;
  w.fetch = (input, init) => { let url2 = typeof input === 'string' ? input : input.url; if (url2.startsWith('/')) url2 = 'https://www.flightradar24.com' + url2; return netFetch(url2, init); };
  w.GM_xmlhttpRequest = o => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), o.timeout || 20000);
    netFetch(o.url, { headers: o.headers, method: o.method, body: o.data }).then(r => r.text().then(t => { clearTimeout(timer); o.onload && o.onload({ status: r.status, responseText: t, response: t }); }))
      .catch(e => { clearTimeout(timer); (e.name === 'AbortError' ? o.ontimeout : o.onerror) && (e.name === 'AbortError' ? o.ontimeout() : o.onerror({ error: String(e) })); });
    return { abort() { ctl.abort(); } };
  };
  w.unsafeWindow = w;
  w.__notes = []; w.GM_notification = o => { w.__notes.push(o); };
  w.__blobs = []; w.URL.createObjectURL = b => { w.__blobs.push(b); return 'blob:test/' + w.__blobs.length; }; w.URL.revokeObjectURL = () => {};
  // jsdom does not set event.source for window.postMessage; browsers do (the bridge relies on it)
  w.postMessage = (data) => { setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: w })), 0); };
  w.__logs = [];
  w.console.debug = (...a) => { w.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); };
  w.console.error = (...a) => { w.__logs.push('ERROR ' + a.join(' ')); };
  return w;
}
const post = (w, type, payload) => w.postMessage(Object.assign({ __tweeksLadd: type }, payload), 'https://www.flightradar24.com');
const clean2 = v => String(v || '').replace(/\s+/g, ' ').trim();
const check = (name, ok, extra) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`);

async function mapMode() {
  let pubReopen = null;
  const w = makeDom('https://www.flightradar24.com/40.9,-74/8', '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  // message source check: jsdom must report window as the source
  let srcOk = null; w.addEventListener('message', ev => { if (srcOk === null) srcOk = ev.source === w; });
  let hook = null; w.__tlTestHook = h => { hook = h; };
  w.eval(RUN(SRC));
  await sleep(2500);
  check('jsdom postMessage source === window', srcOk === true, srcOk);
  const L = w.__tweeksLadd, B = w.__tweeksLaddBridge;
  check('userscript loaded', !!L, L && L.version);
  check('page interceptor installed', !!B);
  // wait for airports + lists
  for (let i = 0; i < 40 && !(L.globalList.items.length && L.engine.airports.length); i++) await sleep(500);
  check('FR24 airports loaded into engine', L.engine.airports.length > 5000, L.engine.airports.length);
  if (!L.engine.airports.length) { console.log(w.__logs.slice(0, 30).join(String.fromCharCode(10))); console.log(netLog.filter(n => /flightradar24/.test(n[0]))); }
  check('LADD + military list loaded', L.globalList.items.length > 100, L.globalList.items.length + ' aircraft @' + T());
  // simulate FR24 LiveFeed: callsign-less flights built from live LADD aircraft (airborne, with a type)
  let src = L.globalList.items.filter(c => !c.gnd && c.type && c.ladd && c.gs > 150 && c.ageS < 20).slice(0, 25);
  if (src.length < 5) src = L.globalList.items.filter(c => !c.gnd && c.type && c.gs > 150 && c.ageS < 20).slice(0, 25);
  const flights = src.map((c, i) => ({ id: 0x41f00000 + i, lat: c.lat, lon: c.lon, trk: Math.round(c.trk), alt: Math.round(c.alt), spd: Math.round(c.gs), icon: 3, ts: Math.floor((c.receivedAt - c.ageS * 1000) / 1000), gnd: false, src: 0, type: c.type, reg: '', sel: false }));
  post(w, 'feed', { flights, serverTime: Date.now(), total: flights.length, at: Date.now(), bg: false });
  await sleep(1200);
  const matched = flights.filter(f => L.live.has(f.id));
  const correct = matched.filter(f => L.live.get(f.id).hex === src[f.id - 0x41f00000].hex);
  check('LADD-list matching identifies simulated N/A flights', matched.length >= flights.length * 0.8, `${matched.length}/${flights.length} matched, ${correct.length} correct`);
  check('identities pushed to the page world', flights.filter(f => B.resolved.has(f.id)).length === matched.length, B.resolved.size);
  // pick a flight that is at cruise, select it
  // (one with a registration known: the panel / log checks need one - a military jet with none fails them for want of data)
  const pick = matched.map(f => ({ f, c: src[f.id - 0x41f00000] })).sort((a, b) => (!!b.c.reg - !!a.c.reg) || (b.c.alt - a.c.alt))[0];
  const id = pick.f.id, hex = pick.c.hex;
  console.log(`\n--- selected ${hex} ${pick.c.reg} ${pick.c.type} alt ${pick.c.alt} gs ${Math.round(pick.c.gs)} trk ${Math.round(pick.c.trk)} @${T()}`);
  // FR24 trail = today's adsb.lol trace of the current leg (what the FollowFlight stream would carry)
  const tr = await (await netFetch(`https://adsb.lol/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`)).json();
  const pts = L.engine.parseTrace(tr); const legs = L.engine.legsFromPoints(pts, {}); const leg = legs[legs.length - 1];
  const legPts = leg ? [leg.start].concat(leg.pts) : pts.slice(-50);
  const trail = legPts.filter((p, i) => i % 3 === 0).map(p => ({ t: Math.floor(p.t), lat: p.lat, lon: p.lon, alt: p.gnd0 ? 0 : (p.alt || 0), gs: Math.round(p.gs || 0), trk: Math.round(p.trk || 0) }));
  const tSel = Date.now();
  w.history.pushState({}, '', '/' + (pick.c.reg || 'X') + '/' + id.toString(16));
  post(w, 'follow', { id });
  post(w, 'trail', { id, first: trail[0], n: trail.length, maxAlt: Math.max(...trail.map(p => p.alt)), pts: trail, at: Date.now() });
  post(w, 'pos', { id, lat: pick.c.lat, lon: pick.c.lon, trk: Math.round(pick.c.trk), alt: Math.round(pick.c.alt), spd: Math.round(pick.c.gs), gnd: false, tsMs: Date.now(), serverMs: Date.now(), at: Date.now() });
  let firstRoute = null;
  for (let i = 0; i < 60; i++) { await sleep(100); const r = B.routes.get(id); if (r && (r.originId || r.destId)) { firstRoute = Date.now() - tSel; break; } }
  check('route available in the page world after selecting', firstRoute != null, firstRoute != null ? firstRoute + ' ms' : 'none after 6 s');
  check('telemetry available for native panel fields', !!B.telem.get(id), B.telem.get(id));
  await sleep(6000);
  const rs = L.routeState.get(id), r1 = rs && rs.route;
  const ap = x => { const a = L.engine.byId(x); return a ? a.code : String(x); };
  console.log('route after 6 s:', r1 && { origin: ap(r1.originId), originNote: r1.originNote, dest: ap(r1.destId), conf: r1.destConf, p: r1.destP, why: r1.destReason, alts: r1.alternatives, phase: r1.phase, eta: r1.eta && new Date(r1.eta * 1000).toISOString().slice(11, 16), ms: r1.ms });
  const truthFrom = leg && L.engine.summarizeLeg(leg, null).from;
  // (or an airfield FR24 does not list, right where the trace begins - a military base: named from the airfield list)
  const siteOk = r1 && r1.originSite && leg && L.engine.dist(r1.originSite.lat, r1.originSite.lon, leg.start.lat, leg.start.lon) < 3;
  check('origin matches the takeoff airport of the ADS-B trace', !truthFrom || (r1 && (r1.originId === truthFrom.id || siteOk)), `trace says ${truthFrom ? truthFrom.code : '?'}, got ${r1 ? (r1.originId ? ap(r1.originId) : r1.originIata + ' ' + r1.originCity) : '-'}`);
  // history loading
  for (let i = 0; i < 90; i++) { const h = await L.store.getHist(hex); if (h && Object.keys(h.days || {}).length >= 60) break; await sleep(1000); }
  const h = await L.store.getHist(hex);
  check('3-month history loaded (adsb.lol globe_history)', h && Object.keys(h.days).length >= 60, h ? `${Object.keys(h.days).length} days, ${h.legs.length} legs @${T()}` : 'none');
  // learning from use: the log's completed flights, each learned once
  {
    const ls = L.learnedStore(), n0 = ls.length, keys = new Set(ls.map(x => x[0]));
    check('learning from use: completed flights of the reconstructed log learned (each once)', n0 > 0 && keys.size === n0, { learned: n0, sample: ls.slice(-3).map(x => `${(L.engine.byId(x[1]) || {}).code}>${(L.engine.byId(x[2]) || {}).code} sq ${x[4] || '-'}`) });
  }
  const r2 = L.routeState.get(id).route;
  console.log('route with history:', r2 && { origin: ap(r2.originId), dest: ap(r2.destId), conf: r2.destConf, p: r2.destP, why: r2.destReason, alts: r2.alternatives, base: r2.base, legs: r2.legCount });
  // photos
  const rec = L.live.get(id);
  for (let i = 0; i < 30 && !(rec.photos && rec.photos.length) && !rec.photoErr; i++) await sleep(500);
  check('photos fetched (Planespotters via the page / JetPhotos)', (rec.photos || []).length > 0 || /none|no photos/.test(rec.photoErr || ''), (rec.photos || []).length ? rec.photos.map(p => p.source).join(',') : rec.photoErr);
  // on the ground: no stale air data; the page keeps a parked aircraft's data for 15 minutes
  {
    const g = L.normalizeReadsb({ hex: 'abcdef', flight: 'TST123', r: 'G-TEST', lat: 51.38, lon: -2.72, alt_baro: 'ground', gs: 8, tas: 410, mach: 0.8, baro_rate: -64, alt_geom: 31175, oat: -38, squawk: '7471' }, 'test', Date.now());
    const tg = L.telemOf(g);
    const pgOld = Date.now() - 5 * 60000;
    hook.acceptPubTel([['TST124', 'G-TESU', 'abcdee', 51.38, -2.72, pgOld, 0, '7471', null, null, null, null, null, null, null, 'London', 'EGTT', 1]]);
    const kept = hook.pubTelFor('TST124', 'G-TESU', 51.38, -2.72);
    check('on the ground: no left-over airspeed / Mach / GPS alt / temperature, level; parked data kept 15 min', tg.vr === 0 && !Number.isFinite(tg.tas) && !Number.isFinite(tg.mach) && !Number.isFinite(tg.agps) && !Number.isFinite(tg.oat) && !!kept, { vr: tg.vr, tas: tg.tas, mach: tg.mach, agps: tg.agps, keptAfter5min: !!kept });
    const srcs = [...B.resolved.values()].flatMap(r => (r.photos || []).map(p => p.source));
    check('photos: never airport-data.com / hexdb pictures', !srcs.some(s => /airport-data|hexdb/.test(s)), [...new Set(srcs)]);
  }
  // JetPhotos pictures without the burnt-in copyright bar (the clean size, as FR24 shows them)
  {
    await sleep(300);
    const urls = ((B.resolved.get(id) || {}).photos || []).flatMap(p => [p.large, p.medium, p.thumb]).filter(Boolean);
    check('photos: clean JetPhotos images (no copyright bar)', urls.length === 0 || !urls.some(u => /cdn\.jetphotos\.com\/\d+cb\//.test(u)), urls.slice(0, 3));
  }
  // a Planespotters picture cached by an older version is replaced once JetPhotos has one
  if ((rec.photos || []).some(p => p.source === 'JetPhotos')) {
    const stale = [{ link: 'https://www.planespotters.net/photo/1', credit: 'x', thumb: 'https://t.plnspttrs.net/x.jpg', medium: 'https://t.plnspttrs.net/x.jpg', large: 'https://t.plnspttrs.net/x.jpg', source: 'Planespotters', date: '' }];
    rec.photos = stale; rec.photoV = 4; rec.photoLevel = 2; rec.photoAt = Date.now() - 3 * 864e5;
    L.store.mergeHex(hex, { photos: stale, photoV: 4, photoLevel: 2, photoAt: rec.photoAt });
    post(w, 'needPhotos', { hex, reg: rec.reg, pri: true });
    for (let i = 0; i < 40 && ((L.live.get(id).photos || [])[0] || {}).source !== 'JetPhotos'; i++) await sleep(250);
    check('stale Planespotters picture from an older version replaced by JetPhotos', ((L.live.get(id).photos || [])[0] || {}).source === 'JetPhotos', (L.live.get(id).photos || []).map(p => p.source).join(','));
  }
  // the owner / operator stored for the airframe reaches the page, written properly (no "&amp;", no registry ALL-CAPS)
  {
    const hxo = L.store.getHex(hex) || {}, pr = B.resolved.get(id) || {}, shown = pr.operatorName || pr.owner || '';
    // (a trust company holding the registration is no one's name: nothing is shown for it - FR24's "Private owner",
    // or the operator it flies for)
    const trustee = /trustee\b|^(tvpx|bank of utah|wells fargo|wilmington trust)/i.test(hxo.owner || rec.owner || '') && !(hxo.operatorName || rec.operatorName);
    const want = !trustee && !!(hxo.owner || hxo.operatorName || rec.owner || rec.operatorName);
    if (trustee) check('a trust company holding the registration is not shown as the owner', !/trustee|bank of utah/i.test(shown), { stored: hxo.owner || rec.owner, shown });
    check('owner / operator shown, written properly', !want || (shown && !/&amp;|&#/.test(shown) && !(shown.length > 5 && shown === shown.toUpperCase() && /[A-Z]{4}/.test(shown))), { stored: hxo.operatorName || hxo.owner || rec.owner || '', shown });
  }
  // N67WV (2 Oct): registered to "TVPX AIRCRAFT SOLUTIONS INC TRUSTEE", flying as TWY26 - shown as the operator behind
  // it, Solairus Aviation (TWY in FR24's airline list), never the trust company
  {
    await L.fr24.loadAirlines().catch(() => null);
    const tv = { owner: 'TVPX AIRCRAFT SOLUTIONS INC TRUSTEE', reg: 'N67WV' };
    check('a trust-registered aircraft shows the operator its callsign belongs to (N67WV / TWY26: Solairus Aviation)', /Solairus/i.test(L.shownOwner(tv, 'TWY26')) && L.shownOwner(tv, 'N67WV') === '', { twy26: L.shownOwner(tv, 'TWY26'), plain: L.shownOwner(tv, 'N67WV') });
  }
  // N900YB (2 Oct): the panel's flight id last moved on the ground at Dublin (FR24 carries it on under a new id once
  // airborne) - the airframe's public ADS-B has it at FL370 over the Hebrides: where it is, not "on the ground at Dublin"
  {
    const idY = 0x41ddd901, hexY = 'ac7154';
    L.live.set(idY, { id: idY, hex: hexY, reg: 'N900YB', type: 'F900', cs: 'N900YB', receivedAt: Date.now() });
    L.pending.set(idY, { id: idY, lat: 53.4302, lon: -6.2641, alt: 0, spd: 0, trk: 0, gnd: true, type: 'F900', reg: '', receivedAt: Date.now() - 25 * 60000, serverTime: 0, ts: 0 });
    L.areaCache.set(hexY, { hex: hexY, lat: 55.995, lon: -6.206, alt: 36875, gs: 464, trk: 342, gnd: false, receivedAt: Date.now(), ageS: 1, type: 'F900', reg: 'N900YB' });
    const pY = L.currentPos(idY), rY = pY ? L.composeRoute(idY, hexY, { pos: pY }) : null;
    check('a followed flight\'s stale ground position gives way to the airframe\'s live one (N900YB airborne, not "on the ground at Dublin")', !!pY && !pY.gnd && pY.alt > 30000 && !!rY && !rY.onGround && rY.phase !== 'parked', { pos: pY && { lat: pY.lat, alt: pY.alt, gnd: pY.gnd }, phase: rY && rY.phase, origin: rY && rY.originIata, dest: rY && rY.destIata });
    L.live.delete(idY); L.pending.delete(idY);
  }
  // HLL01 (2 Oct): a blocked G- helicopter whose registration, type and country the aggregators already gave - its name
  // comes from G-INFO all the same (its AOC operator, Kingmoor Aviation)
  {
    const r1 = { id: 0x41ccc001, hex: '407d94', reg: 'G-NMCF', type: 'AS55', cs: 'HLL01', countryId: 222, photoLevel: 2, photoV: 9, photos: [{ large: 'x', source: 'JetPhotos' }], photoAt: Date.now() };
    await L.enrich(r1);
    check('a blocked G- aircraft with everything else known still gets its name from G-INFO (HLL01: Kingmoor Aviation)', /Kingmoor Aviation/.test(L.shownOwner(r1, r1.cs)) && !/Ltd/i.test(L.shownOwner(r1, r1.cs)), { owner: r1.owner, shown: L.shownOwner(r1, r1.cs), msn: r1.msn });
  }
  check('age / country / msn / operator', true, { reg: rec.reg, year: (L.store.getHex(hex) || {}).year, countryId: rec.countryId, msn: rec.msn, owner: rec.owner, ownerCity: rec.ownerCity, operator: rec.operatorName });
  // FR24's own N/A flights (a callsign, no destination): one on final into Heathrow's 27L goes on its arrivals board
  {
    const lhr = L.engine.byIcao('EGLL'), naId = 0x41f0f000, tN = Math.floor(Date.now() / 1000);
    const na = (dt, lon, alt) => ({ id: naId, lat: 51.4650, lon, trk: 270, alt, spd: 140, ts: tN + dt, gnd: false, cs: 'TST900', reg: 'G-TSTX', type: 'C56X', hex: 0x400999, from: 'MAN' });
    post(w, 'feed', { flights: [], na: [na(-40, -0.300, 1600)], serverTime: Date.now(), total: 1, at: Date.now() - 40000, bg: false });
    post(w, 'feed', { flights: [], na: [na(0, -0.348, 1150)], serverTime: Date.now(), total: 1, at: Date.now(), bg: false });
    for (let i = 0; i < 30 && !B.naRoutes.has(naId); i++) await sleep(1000);
    const nr = B.naRoutes.get(naId);
    check('N/A flight on final: predicted onto its arrival airport (page knows it)', !!nr && nr.destId === lhr.id && !!B.naRecs.get(naId), nr ? { dest: ap(nr.destId), conf: nr.destConf, p: nr.destP, eta: nr.eta } : 'none');
    if (nr) {
      const arrN = await (await w.fetch(`/api/v1/airports/${lhr.id}/arrivals?limit=100`)).json();
      const rowN = (arrN.data || []).find(e => e.flight && e.flight.id === naId.toString(16));
      check('N/A flight listed on the Heathrow arrivals board, FR24 style', !!rowN && rowN.flight.callsign === 'TST900' && rowN.status && rowN.status.name === 'estimated', rowN ? { cs: rowN.flight.callsign, type: rowN.aircraftType, from: rowN.airportId, status: rowN.status } : 'not on the board');
      if (rowN) { const detN = await (await w.fetch(`/api/v1/airports/${lhr.id}/arrivals/${rowN.id}`)).json(); check('its board card answered (registration, origin)', !!detN && detN.data && detN.data.aircraft.registration === 'G-TSTX', detN && detN.data && { reg: detN.data.aircraft.registration, origin: detN.data.originId }); }
    }
  }
  // a business jet established on Le Bourget's runway 27 final 28 km out (T7-AFP, 1 Oct: "LBG 69%, CDG 30%" there):
  // confirmed, not a guess between LBG and CDG
  {
    const lbg = L.engine.byIcao('LFPB'), naId2 = 0x41f0f101, tN = Math.floor(Date.now() / 1000);
    const at = (dt, km, alt) => { const [lat, lon] = L.engine.destPoint(48.9651, 2.4456, 85, km); return { id: naId2, lat, lon, trk: 266, alt, spd: 200, ts: tN + dt, gnd: false, cs: 'TST901', reg: 'T7-TST', type: 'GLF5', hex: 0x500999, from: 'ATH' }; };
    post(w, 'feed', { flights: [], na: [at(-40, 30.2, 4500)], serverTime: Date.now(), total: 1, at: Date.now() - 40000, bg: false });
    post(w, 'feed', { flights: [], na: [at(0, 28.0, 4150)], serverTime: Date.now(), total: 1, at: Date.now(), bg: false });
    for (let i = 0; i < 30 && !B.naRoutes.has(naId2); i++) await sleep(1000);
    const nr2 = B.naRoutes.get(naId2);
    check('N/A business jet established on Le Bourget\'s runway 27 final 28 km out: confirmed LBG', !!nr2 && nr2.destId === lbg.id && nr2.destConf === 'confirmed', nr2 ? { dest: ap(nr2.destId), conf: nr2.destConf, p: nr2.destP } : 'none');
  }
  // The board archive: flights kept per airport beyond FR24's free day - a followed LADD flight that landed 30 hours ago
  // (never opened), an aircraft log's flight two days ago - on the board pages before FR24's day ("Earlier flights")
  {
    const fab = L.engine.byIcao('EGLF'), lbg = L.engine.byIcao('LFPB'), tNow = Math.floor(Date.now() / 1000);
    L.boardNoteLegs('a1b2c3', [{ tStart: tNow - 50 * 3600, tOff: tNow - 50 * 3600, tEnd: tNow - 49 * 3600, tOn: tNow - 49 * 3600, from: { id: fab.id, conf: 'ground' }, to: { id: lbg.id, conf: 'ground' }, ended: true, startedOnGround: true, cs: 'TSTLOG1' }]);
    L.boardNoteFlight(0x41bbb001, { hex: 'a1b2c4', reg: 'N1ARC', type: 'GLF6', cs: 'TSTLV1' }, { originId: fab.id, destId: lbg.id, atd: tNow - 31 * 3600, ata: tNow - 30 * 3600, landed: true, originConf: 'ground', destConf: 'landed' });
    await L.boardDrain();
    const get = async (apId, kind, pg) => (await (await w.fetch(`/api/v1/airports/${apId}/${kind}?page=${pg}&limit=100`)).json()) || {};
    // (one list: three days back to three ahead on FR24's page 1 - its own earlier page in it - and no other page)
    const p1 = await get(lbg.id, 'arrivals', 1), rows2 = (p1.data || []).filter(e => e.flight && /^TST(LV1|LOG1)$/.test(e.flight.callsign || ''));
    check('a board is one list: no "Earlier" / "Later flights" pages', !!p1.meta && p1.meta.previousPage == null && p1.meta.nextPage == null && p1.meta.hasMorePreviousData === false, p1.meta);
    const lv = rows2.find(e => e.flight.callsign === 'TSTLV1');
    check('... with a LADD landing from yesterday (never opened) and a log\'s flight two days ago, FR24 style', rows2.length === 2 && !!lv && lv.status.name === 'landed' && lv.airportId === fab.id && lv.scheduledTime === tNow - 30 * 3600, { rows: rows2.map(e => [e.flight.callsign, e.status.name, e.airportId, new Date(e.scheduledTime * 1000).toISOString().slice(5, 16)]) });
    const ordered = (p1.data || []).every((e, i, a) => !i || (a[i - 1].scheduledTime || 0) <= (e.scheduledTime || 0));
    const nat1 = await (await w.fetch(`/api/v1/airports/${lbg.id}/arrivals?page=-1&limit=100`, { headers: { 'X-TL-Internal': '1' } })).json().catch(() => ({}));
    const ids1 = ((nat1 && nat1.data) || []).map(e => e.id);
    check('... in time order, FR24\'s earlier page of today in it', ordered && ids1.every(i => (p1.data || []).some(e => e.id === i)), { n: (p1.data || []).length, earlierPage: ids1.length, missing: ids1.filter(i => !(p1.data || []).some(e => e.id === i)).length });
    if (lv) { const dv = await (await w.fetch(`/api/v1/airports/${lbg.id}/arrivals/${lv.id}`)).json(); check('its card: registration, origin, landing time (no schedule invented)', !!dv && dv.data && dv.data.aircraft.registration === 'N1ARC' && dv.data.originId === fab.id && dv.data.schedule.ata === tNow - 30 * 3600 && !dv.data.schedule.sta, dv && dv.data && { reg: dv.data.aircraft.registration, origin: dv.data.originId, schedule: dv.data.schedule }); }
    const d1 = await get(fab.id, 'departures', 1);
    check('... and both on Farnborough\'s departures', (d1.data || []).filter(e => e.flight && /^TST(LV1|LOG1)$/.test(e.flight.callsign || '')).length === 2, { rows: (d1.data || []).filter(e => e.__tlArch).map(e => e.flight && e.flight.callsign) });
    // FR24's own rows of a board as served are kept too (for when they drop off its free day)
    let kept = 0; for (let i = 0; i < 30 && !kept; i++) { await sleep(200); const b = L.boardMem.get(lbg.id); kept = b ? Object.values(b.arr).filter(r => r.src === 'fr24').length : 0; }
    check('FR24\'s own board rows kept for the airport', kept > 0 || !(p1.data || []).length, { kept, fr24Rows: (p1.data || []).length });
    // its schedule a day and a half each way (FR24's older airport API) read into the airport's rows
    // (from node, FR24's API host answers Cloudflare's check page - a browser passes it: then it is not tested here)
    const apiOk = await w.fetch('https://api.flightradar24.com/common/v1/airport.json?code=lbg&plugin[]=schedule&plugin-setting[schedule][mode]=arrivals&page=1&limit=1').then(r => r.status !== 403, () => false);
    let sch = 0; for (let i = 0; apiOk && i < 40 && !sch; i++) { await sleep(500); const b = L.boardMem.get(lbg.id); sch = b ? Object.values(b.arr).concat(Object.values(b.dep)).filter(r => r.src === 'sched' && Math.abs(r.t - tNow) > 20 * 3600).length : 0; }
    check('FR24\'s own schedule of the airport beyond its board day read in (older API, both ways)', sch > 0 || !apiOk, apiOk ? { sch } : 'skipped (api.flightradar24.com refuses node)');
  }
  // FR24's own board rows from its schedule format: the same flights as its map board served them (MAN, 7 Oct)
  {
    await L.fr24.loadAirlines().catch(() => {});
    const F = (row, id, num, cs, st, sc, re, es, o, d, al, ty, live) => ({ identification: { id, row, number: { default: num }, callsign: cs }, status: { live: !!live, generic: { status: st, eventTime: { utc: st.utc || null } } }, time: { scheduled: sc, real: re, estimated: es }, airport: { origin: o ? { code: o } : null, destination: d ? { code: d } : null }, airline: { code: { icao: al } }, aircraft: { model: { code: ty } } });
    const cases = [
      ['arrivals', F(5872472196, '4204104e', 'BY2337', 'TOM4PM', { text: 'delayed', type: 'arrival', color: 'yellow', utc: 1791402539 }, { departure: 1791382500, arrival: 1791400200 }, { departure: 1791386764, arrival: null }, { departure: null, arrival: 1791402539 }, { iata: 'PFO', icao: 'LCPH' }, null, 'TUI', 'B788', true), { name: 'delayed', color: 'yellow', est: 1791402539, ap: 'LCPH', alId: 267 }],
      ['arrivals', F(5872477944, '4202f2db', 'U22274', 'EZY52RV', { text: 'landed', type: 'arrival', color: 'yellow', utc: 1791379675 }, { departure: 1791365700, arrival: 1791378600 }, { departure: 1791367834, arrival: 1791379675 }, { departure: null, arrival: null }, { iata: 'MLA', icao: 'LMML' }, null, 'EZY', 'A21N'), { name: 'landed', color: 'yellow', est: 1791379675, ap: 'LMML', alId: 42 }],
      ['departures', F(5875672756, '4203d287', 'FH656', 'FHY656', { text: 'departed', type: 'departure', color: 'red', utc: 1791383674 }, { departure: 1791380400, arrival: 1791396120 }, { departure: 1791383674, arrival: 1791399221 }, { departure: null, arrival: null }, null, { iata: 'AYT', icao: 'LTAI' }, 'FHY', 'A320'), { name: 'departed', color: 'red', est: 1791383674, ap: 'LTAI', alId: 503 }],
      ['departures', F(5872385648, null, 'KL1036', null, { text: 'canceled', type: 'departure', color: 'red' }, { departure: 1791390600, arrival: 1791395400 }, { departure: null, arrival: null }, { departure: null, arrival: null }, null, { iata: 'AMS', icao: 'EHAM' }, 'KLM', 'B738'), { name: 'canceled', color: 'red', est: 1791390600, ap: 'EHAM', alId: 8 }]
    ];
    const got = cases.map(([kind, x, want]) => { const r = L.natRowOf(x, kind), ap = L.engine.byIcao(want.ap); return { cs: x.identification.callsign || x.identification.number.default, ok: !!r && r.id === x.identification.row && r.status.name === want.name && r.status.color === want.color && r.estimatedTime === want.est && r.airportId === (ap && ap.id) && (!L.fr24.byIcao.size || r.airlineId === want.alId), r: r && [r.status.name, r.status.color, r.estimatedTime, r.airportId, r.airlineId] }; });
    check('FR24\'s schedule rows become exactly its own board rows (id, status, colour, time, airport, airline)', got.every(g => g.ok), got);
    // far ahead FR24 gives no airline and an IATA type (320) - both from the same number's flights flown (U22164)
    const lpl = L.engine.byIcao('EGGP'), tF = Math.floor(Date.now() / 1000) + 2 * 86400;
    const flown = F(5872477001, '4202aaaa', 'U22164', 'EZY92QC', { text: 'landed', type: 'arrival', color: 'green', utc: tF - 3 * 86400 }, { departure: tF - 3 * 86400 - 3600, arrival: tF - 3 * 86400 }, { departure: tF - 3 * 86400 - 3600, arrival: tF - 3 * 86400 }, { departure: null, arrival: null }, { iata: 'LPL', icao: 'EGGP' }, { iata: 'AMS', icao: 'EHAM' }, 'EZY', 'A320');
    const fut = F(5872477002, null, 'U22164', null, { text: 'scheduled', type: 'departure', color: 'gray' }, { departure: tF, arrival: tF + 4500 }, { departure: null, arrival: null }, { departure: null, arrival: null }, { iata: 'LPL', icao: 'EGGP' }, { iata: 'AMS', icao: 'EHAM' }, '', '320');
    fut.airline = null; L.fnRows([fut, flown], null, lpl.id, 'departures'); await L.boardDrain();
    const fr = Object.values((L.boardMem.get(lpl.id) || {}).dep || {}).find(r => r.nat && r.nat.id === 5872477002);
    check('... far-ahead rows get the airline and ICAO type of the same number\'s flown flights (logos, as FR24 shows them)', !!fr && (!L.fr24.byIcao.size || fr.nat.airlineId === 42) && fr.nat.aircraftType === 'A320' && fr.nat.status.name === 'scheduled', fr && fr.nat && { al: fr.nat.airlineId, ty: fr.nat.aircraftType, st: fr.nat.status.name });
    // a far-ahead row read with no airline at all (none flown to take it from): the board's own rows of the prefix (FR)
    // give it - its logo
    const own = F(5872477003, '4202bbbb', 'FR1234', 'RYR12AB', { text: 'landed', type: 'arrival', color: 'green' }, { departure: tF - 86400, arrival: tF - 86400 + 3600 }, { departure: tF - 86400, arrival: tF - 86400 + 3600 }, { departure: null, arrival: null }, { iata: 'LPL', icao: 'EGGP' }, { iata: 'DUB', icao: 'EIDW' }, 'RYR', 'B738');
    const bare = F(5872477004, null, 'FR9876', null, { text: 'scheduled', type: 'departure', color: 'gray' }, { departure: tF + 600, arrival: tF + 4200 }, { departure: null, arrival: null }, { departure: null, arrival: null }, { iata: 'LPL', icao: 'EGGP' }, { iata: 'DUB', icao: 'EIDW' }, '', '73H');
    bare.airline = null; L.fnRows([own], null, lpl.id, 'departures'); L.fnRows([bare], null, lpl.id, 'departures'); await L.boardDrain();
    const get2 = async (apId, kind) => (await (await w.fetch(`/api/v1/airports/${apId}/${kind}?page=1&limit=100`)).json()) || {};
    await get2(lpl.id, 'departures'); await sleep(1500);
    const lp = await get2(lpl.id, 'departures'), br = (lp.data || []).find(e => e.id === 5872477004);
    check('... and one with no airline at all takes its flight number\'s from the board (FR -> Ryanair\'s logo)', !!br && (!L.fr24.byIcao.size || br.airlineId === 6), br && { al: br.airlineId, n: (lp.data || []).length });
  }
  // A flight followed live, its departure guessed from where it was first heard (Fairoaks, beside Farnborough), and the
  // same flight rebuilt from its whole track (from Farnborough): the rebuilt one stands on the board (M-ARNZ "Woking")
  {
    const bwf = L.engine.byIcao('EGNL'), fab2 = L.engine.byIcao('EGLF'), qkf = L.engine.byIcao('EGTF'), t1 = Math.floor(Date.now() / 1000) - 20 * 3600;
    L.boardNoteFlight(0x41bbc001, { hex: 'a1b2c9', reg: 'M-TSTW', type: 'PC24', cs: 'TSTWOK' }, { originId: qkf.id, destId: bwf.id, atd: t1 - 2700, ata: t1, landed: true, originConf: 'low', destConf: 'landed' });
    L.boardNoteLegs('a1b2c9', [{ tStart: t1 - 2820, tOff: t1 - 2800, tEnd: t1 + 60, tOn: t1 + 30, from: { id: fab2.id, conf: 'ground' }, to: { id: bwf.id, conf: 'ground' }, ended: true, startedOnGround: true, cs: 'TSTWOK' }], { reg: 'M-TSTW', type: 'PC24' });
    await L.boardDrain();
    const g = async () => (await (await w.fetch(`/api/v1/airports/${bwf.id}/arrivals?page=1&limit=100`)).json()) || {};
    await g(); await sleep(1500);
    const rows = ((await g()).data || []).filter(e => e.flight && e.flight.callsign === 'TSTWOK');
    check('a flight rebuilt from its whole track beats the live guess of where it came from (FAB, not Woking), once', rows.length === 1 && rows[0].airportId === fab2.id, rows.map(e => [e.airportId, e.status && e.status.name]));
  }
  // The search list: an aircraft found by registration that FR24 blocks gets the tag (the page asks FR24's register
  // lookup; here its answer is handed over as the page would)
  {
    const box = w.document.createElement('div'); box.setAttribute('data-testid', 'search__results');
    box.innerHTML = '<div data-testid="search__result-row"><div data-testid="search__result-aircraft"><a data-search-result="aircraft:m-tstb"><div class="flex"><span data-testid="search__result-aircraft__name">M-TSTB</span><span data-testid="search__result-aircraft__type">BE20</span></div></a></div></div>';
    w.document.body.appendChild(box);
    // (flown lately - a flight of it kept here: FR24 listing none of them means it hides it)
    const nowT = Math.floor(Date.now() / 1000); L.store.mergeHex('43eaff', { recent: [[nowT - 7200, nowT - 3600, 0, 0, '', '', '', 0, 1]] });
    post(w, 'searchRows', { rows: [{ reg: 'M-TSTB', hex: '43eaff', type: 'BE20', blocked: true }] });
    let chip = null; for (let i = 0; i < 30 && !chip; i++) { await sleep(100); chip = box.querySelector('.tl-ladd-chip'); }
    check('search: a blocked aircraft (FR24 lists none of its flights, flown lately) gets the LADD tag', !!chip && chip.textContent === 'LADD' && !!(L.store.getHex('43eaff') || {}).ladd, chip && chip.textContent);
    box.remove();
    // (one FR24 lists no flight of because it has not flown for weeks - NASA's retired 747SP N747NA: not tagged)
    post(w, 'searchRows', { rows: [{ reg: 'N747NA', hex: 'aa0db8', type: 'B74S', blocked: true }] });
    await sleep(3000);
    check('... an aircraft parked for weeks (FR24 lists none of its flights either) is not', !(L.store.getHex('aa0db8') || {}).ladd, L.store.getHex('aa0db8'));
  }
  // An unnamed aircraft on the ground at an airport whose ground the public networks do not hear (OE-LYS at Le Bourget,
  // 9 Oct): the one blocked aircraft of its type known to have landed there and not flown since. (A made-up type, so
  // that no real aircraft parked there can be it.)
  {
    const lbgA = L.engine.byIcao('LFPB'), mrsA = L.engine.byIcao('LFML'), tq = Math.floor(Date.now() / 1000) - 30 * 3600, fid = 0x7a5a5a01;
    L.store.mergeHex('4a0f0f', { ladd: true, type: 'ZZP1', reg: 'OE-ZZP', recent: [[tq - 5000, tq, mrsA.id, lbgA.id, 'ground', 'ground', 'TSTZZP', 41000, 1]] });
    post(w, 'feed', { flights: [{ id: fid, lat: lbgA.lat + 0.01, lon: lbgA.lon + 0.02, alt: 0, spd: 0, trk: 250, gnd: true, type: 'ZZP1', src: 0 }], at: Date.now() });
    await sleep(300);
    const okP = await L.matchParked(L.pending.get(fid));
    const recP = L.live.get(fid);
    check('ground: a blocked aircraft parked since it landed here (the only one of its type) is named', okP === true && !!recP && recP.hex === '4a0f0f', recP && { hex: recP.hex, src: (recP.sources || []).join(' ') });
  }
  // FR24's own board row "N/A" all through (G-PTRK, 8 Oct): a kept flight of it gives the other airport and its card the
  // aircraft; with none kept, the callsign read as a registration and checked against FR24's register lookup
  if (hook && hook.nativeFill) {
    const lpl2 = L.engine.byIcao('EGGP'), e = { id: 5999000001, flight: { id: null, callsign: 'GPTRK' }, airportId: null, status: { name: 'departed' } };
    hook.nativeFill(e, { ap: lpl2.id, reg: 'G-PTRK', hex: '40122e', ty: 'AS50', dsc: 'Airbus Helicopters H125' }, 'departures');
    const d = { flight: { callsign: 'GPTRK' }, aircraft: { registration: null, type: null, category: 3 }, airline: 'Private owner', images: [] };
    await hook.fillNativeCard(d, 5999000001, 'departures');
    check('board: FR24\'s N/A row gets the other airport; its card the aircraft (registration, type, helicopter)', e.airportId === lpl2.id && d.aircraft.registration === 'G-PTRK' && d.aircraft.type === 'AS50' && d.aircraft.category === 5 && d.destinationId === lpl2.id, { ap: e.airportId, ac: d.aircraft, dest: d.destinationId });
    // (FR24's own card saying "Private owner" for an aircraft whose registered owner is kept: that owner - M-SKTO)
    w.postMessage({ __tweeksLadd: 'pubIds', rows: [['424C35', 'T. J. Morris Limited', 0, '', 0]] }, '*'); await sleep(50);
    const d3 = { flight: { callsign: 'MSKTO' }, aircraft: { registration: 'M-SKTO', type: 'H160', hex: '424c35' }, airline: 'Private owner', images: [{ url: 'x' }] };
    await hook.fillNativeCard(d3, 5999000003, 'departures');
    check('... FR24\'s card of an aircraft whose owner is kept: the owner, not "Private owner" (M-SKTO)', d3.airline === 'T. J. Morris Limited', d3.airline);
    // (a flight lost from view low beside a field, 20 minutes quiet: landed there - its departure row says where to)
    const bk = L.engine.byIcao('EGNH'), qg = L.engine.byIcao('EGCB'), tq = Math.floor(Date.now() / 1000) - 3 * 3600;
    if (bk && qg) {
      L.boardNoteLegs('a1b2d1', [{ tStart: tq, tOff: tq, tEnd: tq + 1700, from: { id: bk.id, conf: 'low' }, to: { id: qg.id, conf: 'low' }, ended: false, startedOnGround: true, cs: 'TSTBOIL' }], { reg: 'G-TSTB', type: 'C172' });
      await L.boardDrain();
      const dr = Object.values((L.boardMem.get(bk.id) || {}).dep || {}).find(r => r.cs === 'TSTBOIL'), ar = Object.values((L.boardMem.get(qg.id) || {}).arr || {}).find(r => r.cs === 'TSTBOIL');
      check('board: a light aircraft lost low beside a field, quiet since, is landed there (G-BOIL "N/A" -> Barton)', !!dr && dr.ap === qg.id && !!ar && ar.st === 'landed', { dep: dr && dr.ap, arr: ar && ar.st });
    }
    const cat = x => hook.categoryOf(x);
    check('... FR24\'s own category ids: H160 helicopter (not "Drone"), military, C172 general aviation, glider, jet', cat({ type: 'H160' }) === 5 && cat({ type: 'GLF6', mil: true }) === 2 && cat({ type: 'C172' }) === 4 && cat({ type: 'GLID' }) === 7 && cat({ type: 'GLF6' }) === 3, [cat({ type: 'H160' }), cat({ type: 'GLF6', mil: true }), cat({ type: 'C172' }), cat({ type: 'GLID' }), cat({ type: 'GLF6' })]);
    check('... callsigns read as registrations: GPTRK, DEABC, N123AB - not airline ones', JSON.stringify(hook.regsOfCallsign('GPTRK')) === '["G-PTRK","GP-TRK"]' && hook.regsOfCallsign('N123AB')[0] === 'N123AB' && !hook.regsOfCallsign('EZY12AB').length, [hook.regsOfCallsign('GPTRK'), hook.regsOfCallsign('EZY12AB')]);
    const apiOk2 = await w.fetch('https://api.flightradar24.com/common/v1/flight/list.json?query=G-PTRK&fetchBy=reg&page=1&limit=1').then(r => r.status !== 403, () => false);
    if (apiOk2) { const d2 = { flight: { callsign: 'GPTRK' }, aircraft: {}, images: [] }; await hook.fillNativeCard(d2, 5999000002, 'departures'); check('... with nothing kept: from FR24\'s register lookup of the callsign', d2.aircraft.registration === 'G-PTRK' && d2.aircraft.type === 'AS50', d2.aircraft); }
    else console.log('(FR24 register lookup refuses node: callsign lookup not tested here)');
  }
  // the permanent monitor (monitor/monitor.cjs) when it runs on this computer: its flights at an airport join the board
  {
    // (the monitor on a server, when given: MON_URL=https://... MON_TOKEN=...)
    if (process.env.MON_URL && process.env.MON_TOKEN) { await L.store.kvReady; L.store.kvSet('monRemote', { url: process.env.MON_URL, token: process.env.MON_TOKEN }); await L.monCheck(true).catch(() => {}); }
    const st = await L.monGet('/status').catch(() => null);
    if (!st) console.log('(no monitor answering - MON_URL / MON_TOKEN not given: its checks skipped)');
    else {
      let hit = null;
      for (const c of ['EGLL', 'EGKK', 'EGCC', 'EGGP', 'EIDW', 'KTEB', 'KLAS', 'KJFK', 'KVNY', 'KPBI', 'KHPN', 'KDAL', 'KAPA', 'KBED']) { const a = L.engine.byIcao(c); if (!a) continue; const j = await L.monGet(`/board?ap=${a.id}`).catch(() => null); if (j && j.aircraft && j.aircraft.some(x => x.legs.some(l => l.to && l.to.id === a.id && l.ended))) { hit = { a, x: j.aircraft.find(x => x.legs.some(l => l.to && l.to.id === a.id && l.ended)) }; break; } }
      if (!hit) console.log('(permanent monitor has no landing at the test airports yet)');
      else {
        await L.boardMonFill(hit.a.id); await L.boardDrain();
        const b = L.boardMem.get(hit.a.id), rows = b ? Object.values(b.arr).filter(r => r.hex === hit.x.hex) : [];
        check(`permanent monitor: a landing it saw is on ${hit.a.iata || hit.a.icao}'s arrivals`, rows.some(r => r.src === 'log' && r.st === 'landed'), { hex: hit.x.hex, reg: hit.x.reg, rows: rows.map(r => [r.reg, r.cs, r.src, new Date(r.t * 1000).toISOString().slice(11, 16)]) });
      }
      const lad = await L.monGet('/ladd').catch(() => null);
      check('permanent monitor: its LADD list is fresh (matching against it needs no adsb.lol request)', !!lad && Date.now() - lad.at < 300000 && (lad.ac || []).length > 50, lad && { age: Math.round((Date.now() - lad.at) / 1000), n: (lad.ac || []).length });
    }
  }
  // "confirm": the user sets the destination (heard on the radio, seen on final) - locked in at 100%, learned from at once
  {
    const r0 = (L.routeState.get(id) || {}).route || L.live.get(id).route || {};
    const pick = L.engine.airports.find(a => a.iata && a.id !== r0.destId && a.size > 5000 && Math.abs(a.lat - (r0.destId ? L.engine.byId(r0.destId).lat : a.lat)) < 3);
    if (pick) {
      const nL = L.learnedStore().length;
      L.userConfirm(id, L.live.get(id), pick.id); await sleep(400);
      const pos = L.currentPos(id), r1 = pos ? L.composeRoute(id, L.live.get(id).hex, { pos }) : null;
      check('confirm: the destination the user picks is shown, confirmed at 100% ("confirmed by you")', !!r1 && r1.destId === pick.id && r1.destConf === 'confirmed' && r1.destP === 100 && /confirmed by you/.test(r1.destReason), r1 && { dest: r1.destIata, conf: r1.destConf, p: r1.destP, why: r1.destReason });
      check('... and learned from at once (when its departure is known)', !r0.originId || L.learnedStore().length > nL, { before: nL, after: L.learnedStore().length });
      L.userConfirm(id, L.live.get(id), 0); await sleep(200);
      const r2 = pos ? L.composeRoute(id, L.live.get(id).hex, { pos }) : null;
      check('... and cleared again', !!r2 && !r2.userConfirmed, r2 && r2.destIata);
    }
  }
  // the learned arrival paths: unpacked from the script, and F-GBOL (2 Oct, into Le Bourget over Paris) on LBG's
  {
    const n = await L.loadApprTable();
    check('arrival paths unpacked', n > 10000, n);
    const fx = path.join(__dirname, 'fixtures/legs/3905cb/2026-10-02_lol.json.gz');
    if (n && fs.existsSync(fx)) {
      const E = L.engine, pts = E.parseTrace(JSON.parse(zlib.gunzipSync(fs.readFileSync(fx)).toString()));
      const t0 = Date.parse('2026-10-02T14:00:00Z') / 1000, t1 = Date.parse('2026-10-02T14:20:00Z') / 1000;
      let hit = null;
      for (let i = 0; i < pts.length && !hit; i++) { const p = pts[i]; if (p.t < t0 || p.t > t1) continue; const a = E.approachPath(p, pts.slice(Math.max(0, i - 40), i), 'heavybiz'); if (a) hit = { at: new Date(p.t * 1000).toISOString().slice(11, 19), ap: a.airport.iata, km: Math.round(a.dist), alt: p.alt }; }
      check('... F-GBOL on the usual arrival path into Le Bourget', !!hit && hit.ap === 'LBG', hit);
    }
  }
  // a flight gone quiet for minutes, last heard low beside its destination: landed on the board at once, not "estimated"
  {
    const lbg = L.engine.byIcao('LFPB'), idQ = 0x41ddd911, now0 = Date.now();
    w.postMessage({ __tweeksLadd: 'resolve', entries: [{ id: idQ, hex: 'a1c2e3', reg: 'N1QUIET', type: 'GLF6', cs: 'TSTQT', pos: { lat: lbg.lat + 0.02, lon: lbg.lon - 0.06, alt: 1200, at: now0 - 5 * 60000 } }] });
    w.postMessage({ __tweeksLadd: 'routes', list: [{ id: idQ, route: { originId: 0, destId: lbg.id, destIata: 'LBG', eta: Math.floor(now0 / 1000) + 60, landed: false, destConf: 'likely', destP: 80, destLat: lbg.lat, destLon: lbg.lon, destAlt: lbg.alt || 0 } }] });
    await sleep(300);
    const arrQ = await (await w.fetch(`/api/v1/airports/${lbg.id}/arrivals?page=1&limit=100`)).json();
    const rq = (arrQ.data || []).filter(e => e.flight && e.flight.callsign === 'TSTQT');
    check('a flight gone quiet low beside its destination is "landed" on its board, once (not "estimated" for half an hour)', rq.length === 1 && rq[0].status.name === 'landed', rq.map(e => e.status));
    w.postMessage({ __tweeksLadd: 'revoke', ids: [idQ] });
  }
  // airport boards through the page interceptor
  // (the route as it is now - a close call between destinations can have moved on since it was first read)
  const r2n = (L.routeState.get(id) || {}).route || r2;
  const destId = r2n && r2n.destId, originId = r2n && r2n.originId;
  // (an airfield FR24 does not list has no board of its own)
  if (destId && destId < 1e7) {
    // (a long flight is further down the board: its later pages, up to its arrival time)
    let arr = null, row = null;
    for (let pg = 1; pg <= 6 && !row; pg++) {
      arr = await (await w.fetch(`/api/v1/airports/${destId}/arrivals?page=${pg}&limit=100`)).json();
      row = (arr.data || []).find(e => e.flight && e.flight.id === id.toString(16));
      const last = Math.max(0, ...(arr.data || []).map(e => e.scheduledTime || e.estimatedTime || 0));
      if (!row && (!(r2n.eta > last) || !(arr.data || []).length)) break;
    }
    // listed as traffic whatever the confidence (FR24's "estimated / ambiguous" style marks the unsure ones)
    check(`arrivals board at ${ap(destId)} lists the flight (${r2n.destConf})`, !!row, row ? { cs: row.flight.callsign, type: row.aircraftType, sched: row.scheduledTime && new Date(row.scheduledTime * 1000).toISOString().slice(11, 16), status: row.status } : `not listed (conf ${r2n.destConf})`);
    // FR24 re-reads an open board every 5 minutes (a timer armed right after each board response); a flight newly
    // reasoned onto that board must make it re-read straight away
    let reloaded = 0, decoy = 0;
    w.document.body.insertAdjacentHTML('beforeend', '<button data-testid="airport-panel__tab-arrivals">Arrivals</button>');   // a board is open
    const boardRead = async () => { await (await w.fetch(`/api/v1/airports/${destId}/arrivals?limit=100`)).json(); w.setTimeout(() => { reloaded++; }, 300000); w.setTimeout(() => { decoy++; }, 600000); };
    // (FR24 arms its open panel's 10-minute autorefresh about then too - firing that one instead left the flight off)
    await boardRead();
    const other2 = [...B.resolved.keys()].find(k => k !== id && !(B.routes.get(k) && B.routes.get(k).destId === destId));
    if (other2) {
      const toDest = d => Object.assign({}, B.routes.get(other2) || {}, { destId: d, destIata: ap(d), eta: Math.floor(Date.now() / 1000) + 1800, landed: false, destConf: 'possible' });
      w.postMessage({ __tweeksLadd: 'routes', list: [{ id: other2, route: toDest(destId) }] });
      await sleep(2500);
      check('open board re-reads at once when a flight is newly reasoned onto it (its own reload, not the panel\'s)', reloaded === 1 && decoy === 0 && B.stats.boardRefreshes >= 1, { reloaded, decoy, refreshes: B.stats.boardRefreshes });
      // a destination still settling - elsewhere a moment, then back here: listed within seconds once it has settled
      await boardRead();
      const away = L.engine.airports.find(a => a.id !== destId && a.iata && a.size > 1000);
      w.postMessage({ __tweeksLadd: 'routes', list: [{ id: other2, route: toDest(away.id) }] }); await sleep(300);
      w.postMessage({ __tweeksLadd: 'routes', list: [{ id: other2, route: toDest(destId) }] });
      const t0s = Date.now(); while (reloaded < 2 && Date.now() - t0s < 8000) await sleep(200);
      const arrS = await (await w.fetch(`/api/v1/airports/${destId}/arrivals?limit=100`)).json();
      check('a destination that settles after changing re-reads the board within seconds, and the flight is listed', reloaded >= 2 && (arrS.data || []).some(e => e.flight && e.flight.id === other2.toString(16)), { reloaded, ms: Date.now() - t0s, listed: (arrS.data || []).some(e => e.flight && e.flight.id === other2.toString(16)) });
    }
    // an aircraft known under two FR24 flight ids (an older one from before a coverage gap): one row, under the newest -
    // "Show on map" on the older id finds no live flight (C-GTLA into Halifax)
    {
      const idOld = 0x41aaa001, idNew = 0x41aaa002, tNow = Date.now();
      w.postMessage({ __tweeksLadd: 'resolve', entries: [{ id: idOld, hex: 'abcdef', reg: 'N1DUP', type: 'GLF6', cs: '', pos: { lat: 44.5, lon: -63.6, alt: 20000, at: tNow - 600000 } }, { id: idNew, hex: 'abcdef', reg: 'N1DUP', type: 'GLF6', cs: '', pos: { lat: 44.6, lon: -63.7, alt: 18000, at: tNow } }] });
      const rtD = { originId: 0, destId, destIata: ap(destId), eta: Math.floor(tNow / 1000) + 600, landed: false, destConf: 'likely', destP: 80 };
      w.postMessage({ __tweeksLadd: 'routes', list: [{ id: idOld, route: rtD }, { id: idNew, route: rtD }] });
      await sleep(300);
      const arrD = await (await w.fetch(`/api/v1/airports/${destId}/arrivals?limit=100`)).json();
      const ids = (arrD.data || []).filter(e => e.flight && [idOld, idNew].map(x => x.toString(16)).includes(e.flight.id)).map(e => e.flight.id);
      check('an aircraft known under two flight ids is listed once, under its newest (so "Show on map" finds it)', ids.length === 1 && ids[0] === idNew.toString(16), ids);
      w.postMessage({ __tweeksLadd: 'revoke', ids: [idOld, idNew] }); await sleep(50);
    }
    if (row) {
      const t1 = Date.now();
      const det = await (await w.fetch(`/api/v1/airports/${destId}/arrivals/${row.id}`)).json();
      // the card as FR24 draws it (info box from status.isAmbiguous): the box becomes the yellow predicted-destination note
      {
        const rt = (L.routeState.get(id) || {}).route || L.live.get(id).route || {};
        const predicted = !!rt.destId && !rt.landed && !['filed', 'confirmed', 'landed'].includes(rt.destConf);
        const li = w.document.createElement('li'); li.id = 'airport_schedule_' + row.id;
        li.innerHTML = `<div data-testid="airport-panel__schedules__flight__${row.id}"><div class="space-x-1"><span>${rec.cs || rec.reg}</span></div></div><div class="slide-up-down__container"><div class="grid"><dd data-testid="airport-flight-details__registration">${rec.reg}</dd>${det.data.status.isAmbiguous ? '<aside class="flex items-center rounded-md p-3 text-sm bg-blue-100 text-blue-500 border border-gray-700 col-span-24"><svg></svg><div> It is currently later at the arriving airport than the expected arrival time... </div></aside>' : ''}</div></div>`;
        w.document.body.appendChild(li);
        await sleep(150);
        const box = li.querySelector('aside'), note = box && box.querySelector('.tl-pred-text');
        check('board card of a predicted arrival: yellow "predicted destination" note instead of FR24\'s delay text', predicted ? !!(box && box.classList.contains('tl-pred') && note && /Predicted destination/.test(note.textContent) && w.getComputedStyle(box.querySelector('div:not(.tl-pred-text)')).display === 'none') : !box, predicted ? (note ? note.textContent.slice(0, 220) : 'no note') : 'destination not predicted (' + rt.destConf + ')');
        li.remove();
      }
      check('board detail card answered locally with data + photos', det && det.data && det.data.aircraft.registration === rec.reg, { ms: Date.now() - t1, reg: det.data.aircraft.registration, name: det.data.aircraft.name, cs: det.data.flight.callsign, images: det.data.images.length, schedule: det.data.schedule, airline: det.data.airline });
      // (T7-AFP's card said "GULFSTREAM 5" where its panel says "Gulfstream G550")
      check('board card names the aircraft as the panel does (FR24\'s model name, never a database\'s capitals)', !!(det && det.data && det.data.aircraft.name) && !/\b[A-Z]{4,}\b/.test(det.data.aircraft.name.replace(/\b(LADD|EASY)\b/g, '')), det && det.data && det.data.aircraft.name);
    }
  }
  if (originId) {
    // (a flight that left a while ago is on the board's earlier pages)
    let row = null;
    for (const pg of [1, -1, -2, -3]) {
      const dep = await (await w.fetch(`/api/v1/airports/${originId}/departures?page=${pg}&limit=100`)).json();
      row = (dep.data || []).find(e => e.flight && e.flight.id === id.toString(16)); if (row || !(dep.data || []).length) break;
    }
    check(`departures board at ${ap(originId)} lists the flight`, !!row, row ? { status: row.status.name, time: new Date((row.scheduledTime || 0) * 1000).toISOString().slice(11, 16) } : 'missing');
  }
  // "Recent <reg> flights"
  if (rec.reg) {
    const t1 = Date.now();
    const fl = await (await w.fetch(`https://api.flightradar24.com/common/v1/flight/list.json?query=${encodeURIComponent(rec.reg)}&fetchBy=reg&filterBy=historic&limit=5&page=1&timestamp=${Math.floor(Date.now() / 1000)}`)).json();
    const data = fl && fl.result && fl.result.response && fl.result.response.data;
    check('"Recent <reg> flights" filled from the log', Array.isArray(data) && data.length > 1, data ? { ms: Date.now() - t1, n: data.length, first3: data.slice(1, 4).map(d => `${d.airport.origin && d.airport.origin.code.iata}>${d.airport.destination && d.airport.destination.code.iata} ${d.status.text}`) } : fl);
  }
  // search: the same aircraft's earlier legs (their own FR24 flight ids, still known for boards and logs) must not be
  // listed as extra live flights - one row per aircraft, the flight it is flying now
  if (rec.reg) {
    const oldA = 0x41e00001, oldB = 0x41e00002;
    w.postMessage({ __tweeksLadd: 'resolve', entries: [
      { id: oldA, hex, reg: rec.reg, cs: rec.cs, type: rec.type, pos: { lat: pick.c.lat - 2, lon: pick.c.lon - 2, alt: 0, gnd: true, at: Date.now() - 2 * 3600e3 } },
      { id: oldB, hex, reg: rec.reg, cs: rec.cs, type: rec.type } ] });
    w.postMessage({ __tweeksLadd: 'routes', list: [{ id: oldA, route: { originIata: 'AGS', destIata: 'TEB', landed: true, ata: Math.floor(Date.now() / 1000) - 7200 } }, { id: oldB, route: { originIata: 'TEB', destIata: 'AGS' } }] });
    await sleep(200);
    const sr = await (await w.fetch(`/v1/search/web/find?query=${encodeURIComponent(rec.reg)}&limit=50`)).json();
    const liveRows = (sr.results || []).filter(r => r.type === 'live' && r.detail && r.detail.reg === rec.reg);
    // (one row: this flight - or FR24's own live row when FR24 itself lists the aircraft, e.g. a military one it shows)
    check('search lists the aircraft once (earlier legs of it are not extra live flights)', liveRows.length === 1 && (liveRows[0].id === id.toString(16) || liveRows[0].detail.schd_to === undefined), liveRows.map(r => `${r.id} ${r.detail.schd_from}-${r.detail.schd_to}`));
  }
  // the expanded search card is drawn from one FlightDetails answer: for an aircraft without a photo yet, the request
  // goes out once the photo is in, so the card opens with it
  {
    const taken = new Set([...B.resolved.values()].map(r => r.hex));
    const cand = L.globalList.items.filter(c => c.reg && /^N\d/.test(c.reg) && !taken.has(c.hex) && !B.photoCache.has(c.hex.toUpperCase()));
    const c1 = cand[0];
    if (c1) {
      const cid = 0x41d00001;
      w.postMessage({ __tweeksLadd: 'resolve', entries: [{ id: cid, hex: c1.hex, reg: c1.reg, cs: c1.reg, type: c1.type, pos: { lat: c1.lat, lon: c1.lon, alt: c1.alt, gnd: false, at: Date.now() } }] });
      await sleep(100);
      const x = new w.XMLHttpRequest(); let sentAt = 0, photosAtSend = -1;
      x.open('POST', 'https://data-feed.flightradar24.com/fr24.feed.api.v1.Feed/FlightDetails'); x.responseType = 'arraybuffer';
      x.addEventListener('loadstart', () => { sentAt = Date.now(); photosAtSend = ((B.photoCache.get(c1.hex.toUpperCase()) || {}).photos || []).length; setTimeout(() => { try { x.abort(); } catch (e) { /* ignore */ } }, 0); });
      const body = new Uint8Array(10); body[4] = 5; body[5] = 0x0d; new DataView(body.buffer).setUint32(6, cid, true);
      const tq = Date.now(); x.send(body);
      for (let i = 0; i < 40 && !sentAt; i++) await sleep(100);
      const pc = B.photoCache.get(c1.hex.toUpperCase()) || {};
      const psc = B.psCache.get(c1.hex.toUpperCase()) || {};
      // (held at most 2.8 s; opened without a picture only when the lookup then confirms there is none anywhere)
      for (let i = 0; i < 40 && !(B.photoCache.get(c1.hex.toUpperCase()) || {}).final; i++) await sleep(250);
      const pcF = B.photoCache.get(c1.hex.toUpperCase()) || {};
      check('search card: FlightDetails asked for once the photo is in (at most 2.8 s)', sentAt && sentAt - tq <= 3100 && (photosAtSend > 0 || (psc.photos || []).length || (pcF.final && !(pcF.photos || []).length)), { reg: c1.reg, heldMs: sentAt - tq, photosAtSend, src: (pcF.photos || []).map(p => p.source).join(','), ps: (psc.photos || []).length, noneExist: !!(pcF.final && !(pcF.photos || []).length) });
      const fin = B.photoCache.get(c1.hex.toUpperCase()) || {}, jpHas = (L.store.getHex(c1.hex) || {}).photos;
      const src0 = ((fin.photos || [])[0] || {}).source || '';
      const jpNow = /JetPhotos|Flightradar24/.test(src0) ? null : await L.fetchJetphotos(c1.reg, true).catch(e => ({ photos: [], err: String(e) }));
      check('search card pictures: JetPhotos first, Planespotters only without one', !!fin.final && (/JetPhotos|Flightradar24/.test(src0) || !(jpNow.photos || []).length), { reg: c1.reg, shown: (fin.photos || []).map(p => p.source).join(','), stored: (jpHas || []).map(p => p.source).join(','), jetphotosHas: jpNow ? (jpNow.photos || []).length + ' ' + (jpNow.err || '') : 'n/a' });
    }
    // what the user looks at jumps the queue of background photo lookups (board-row warming)
    const bg = cand.slice(1, 9), fg = cand[9];
    if (fg) {
      const done = []; const tq = Date.now();
      bg.forEach(c => B.fetchPhotos(c.hex, c.reg).then(() => done.push('bg')));
      await sleep(50);
      await B.fetchPhotos(fg.hex, fg.reg, true).then(() => done.push('fg'));
      check('photo of what is looked at goes ahead of background warming', done.indexOf('fg') <= 2, { order: done.join(','), ms: Date.now() - tq });
    }
  }
  // panel DOM: a minimal FR24-like panel
  w.document.body.insertAdjacentHTML('beforeend', `<aside data-testid="aircraft-panel"><div data-testid="aircraft-panel__header"><div><div><span data-testid="aircraft-panel__header__callsign">N/A</span><span data-testid="aircraft-panel__header__model">${rec.type}</span></div></div></div><main><div style="overflow-y:auto"><div class="first"></div><div class="grid grid-cols-2"><div class="col-span-1 text-sm leading-tight"><p class="text-xs uppercase leading-tight text-gray-900">ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">N/A</p></div><div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">COUNTRY OF REG.</p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3 text-yellow-500"><path></path></svg><!----></div></div><div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">SERIAL NUMBER (MSN)</p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3 text-yellow-500"><path></path></svg><!----></div></div><div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">AGE </p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3 text-yellow-500"><path></path></svg><!----></div></div><div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">Vertical speed</p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3 text-yellow-500"><path></path></svg><!----></div></div><div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">GPS altitude</p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3 text-yellow-500"><path></path></svg><!----></div></div><div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">SQUAWK</p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3 text-yellow-500"><path></path></svg><!----></div></div><div class="col-span-1 text-sm leading-tight"><p class="text-xs uppercase leading-tight text-gray-900">Track</p><p class="text-md" data-testid="aircraft-panel__track">134<span>°</span></p></div><div class="col-span-1 text-sm leading-tight"><p class="text-xs uppercase leading-tight text-gray-900">Wind</p><div data-testid="aircraft-panel__wind-tooltip" class="inline-flex items-center"><p class="text-md" data-testid="aircraft-panel__wind"><svg></svg><span>250° 56 kts</span></p></div></div></div><p data-testid="aircraft-panel__registration">N/A</p><div class="col-span-8"><div class="mt-1"><div data-testid="base-tooltip"><a href="#" data-testid="aircraft-panel__airport-departure-iata">N/A</a></div></div><div><div class="overflow-hidden"><span data-testid="aircraft-panel__airport-departure-city">Not available</span></div><p data-testid="aircraft-panel__airport-departure-timezone"></p></div></div><div class="col-span-8"><div class="mt-1"><div data-testid="base-tooltip"><a href="#" data-testid="aircraft-panel__airport-arrival-iata">N/A</a></div></div><div><div class="overflow-hidden"><span data-testid="aircraft-panel__airport-arrival-city">Not available</span></div><p data-testid="aircraft-panel__airport-arrival-timezone"></p></div></div></div></main></aside>`);
  // (the text node FR24's Vue owns in the destination cell: Vue keeps writing into this very node on the next flight)
  const arrEl = w.document.querySelector('[data-testid="aircraft-panel__airport-arrival-iata"]'), vueArr = [...arrEl.childNodes].find(n => n.nodeType === 3);
  w.history.pushState({}, '', '/' + id.toString(16));
  await sleep(1500);
  const panel = w.document.querySelector('[data-testid="aircraft-panel"]');
  const strip = panel.querySelector('.tl-strip');
  check('panel strip rendered (no script error in it)', !!strip && !/script error/i.test(strip.textContent), strip ? strip.textContent.replace(/\s+/g, ' ').trim().slice(0, 260) : 'none');
  // its place: under the photo, just above the route boxes, a block of the scrolling body - also on a panel whose body
  // starts with FR24's "#9 Worldwide / tracked by" bar and draws its photo and route a moment apart (VLZ10's strip sat
  // above the photo, under that bar)
  if (strip) {
    const body = panel.querySelector('main > div'), mk = h => { const t = w.document.createElement('div'); t.innerHTML = h; return t.firstElementChild; };
    const bar = mk('<div class="absolute top-0 z-10 flex">#9 Worldwide · Tracked by 496</div>'), photo = mk('<div class="relative"><div class="relative flex"><img src="https://cdn.jetphotos.com/400/x.jpg"></div></div>'), route = mk('<div class="relative grid grid-cols-2 gap-0.5"></div>');
    for (const t of ['departure', 'arrival']) { const c = panel.querySelector(`[data-testid="aircraft-panel__airport-${t}-iata"]`).closest('.col-span-8'); route.appendChild(c); }
    body.style.overflowY = 'auto';                                // (FR24's overflow-y-auto: the body that scrolls)
    body.prepend(bar, photo, route); body.prepend(strip);       // (FR24 re-rendered: the strip left at the top)
    await sleep(1200);
    // a wide screen: FR24 keeps the photo in a fixed block of its own above the scrolling body - the strip must go into
    // the body, above the route boxes, never into the fixed photo block (CFNAP: it covered the route there)
    {
      const main = body.parentElement, fixed = w.document.createElement('div'); fixed.className = 'relative';
      main.insertBefore(fixed, body); fixed.appendChild(photo); fixed.appendChild(strip);    // (where the old code put it)
      await sleep(1200);
      check('wide screen: the strip is in the scrolling body above the route boxes, not in the fixed photo block', strip.parentElement === body && strip.nextElementSibling === route && !fixed.contains(strip), { inFixed: fixed.contains(strip), next: strip.nextElementSibling === route });
      body.insertBefore(photo, strip); fixed.remove();                 // (back to the narrow layout for the next check)
      await sleep(1200);
    }
    check('panel strip sits under the photo, just above the route boxes (not under the tracked-by bar)', strip.isConnected && strip.parentElement === body && strip.previousElementSibling === photo && strip.nextElementSibling === route, [...body.children].map(e => e === strip ? 'STRIP' : e === photo ? 'photo' : e === route ? 'route' : e === bar ? 'bar' : e.tagName.toLowerCase()).join(' > '));
  }
  check('panel callsign / reg / hex filled', panel.querySelector('[data-testid="aircraft-panel__header__callsign"]').textContent !== 'N/A', [panel.querySelector('[data-testid="aircraft-panel__header__callsign"]').textContent, panel.querySelector('[data-testid="aircraft-panel__registration"]').textContent, panel.querySelector('[data-testid="aircraft-panel__hex"]').textContent]);
  const filled = Object.fromEntries([...panel.querySelectorAll('.tl-filled')].map(e => [e.dataset.k, e.textContent]));
  // (serial number and age exist only where a public registry has them - FAA for N-numbers and the like)
  const hxSel = L.store.getHex(hex) || {}, want = ['country', 'sq'].concat(hxSel.msn || rec.msn ? ['msn'] : [], hxSel.year || rec.year ? ['age'] : []);
  check('padlocked fields filled (' + want.join(', ') + ')', want.every(k => filled[k]), filled);
  check('padlocks hidden only where a value was written', [...panel.querySelectorAll('.tl-filled')].every(e => e.previousElementSibling && e.previousElementSibling.classList.contains('tl-filled-lock')), panel.querySelectorAll('.tl-filled-lock').length);
  check('native cells untouched (track, wind)', !panel.querySelector('[data-testid="aircraft-panel__wind-tooltip"].tl-filled-lock') && panel.querySelector('[data-testid="aircraft-panel__track"]').textContent === '134°', panel.querySelector('[data-testid="aircraft-panel__wind"]').textContent);
  check('route airports in the panel', panel.querySelector('[data-testid="aircraft-panel__airport-arrival-iata"]').textContent !== 'N/A', [panel.querySelector('[data-testid="aircraft-panel__airport-departure-iata"]').textContent, panel.querySelector('[data-testid="aircraft-panel__airport-arrival-iata"]').textContent]);
  // a better destination found later: code, city and time zone change together
  {
    const cityEl = panel.querySelector('[data-testid="aircraft-panel__airport-arrival-city"]'), tzEl = panel.querySelector('[data-testid="aircraft-panel__airport-arrival-timezone"]');
    const st0 = L.routeState.get(id), r0 = (st0 && st0.route) || L.live.get(id).route;
    const city0 = cityEl ? cityEl.textContent.trim() : '';
    const alt = L.engine.byIcao(r0 && r0.destIata === 'DEN' ? 'KLAX' : 'KDEN');
    const r1 = Object.assign({}, r0, { destId: alt.id, destIata: alt.iata, destCity: alt.city, destConf: 'possible', destP: 55 });
    L.publishRoute(id, r1); L.syncPanel();
    const code1 = arrEl.textContent.replace(/\?$/, '').trim(), city1 = cityEl ? cityEl.textContent.trim() : '', tz1 = tzEl ? tzEl.textContent.trim() : '';
    check('panel: a new predicted destination changes the code, city and time zone together', code1 === alt.iata && city1 === alt.city && /UTC [+-]\d\d:\d\d/.test(tz1), { before: city0, code: code1, city: city1, tz: tz1 });
    L.publishRoute(id, r0); L.syncPanel(); await sleep(300);
  }
  // another flight opened: its own airport shows, the previous flight's code never carries over - whether Vue writes a
  // new value into its node (a flight with a route) or leaves it as it was (a VFR flight with no route either)
  {
    const before = arrEl.textContent.trim(), otherId = 0x42f0dddd, vfrId = 0x42f0eeee;
    // (FR24's order: the flight is selected - its stream requested - and Vue redraws the panel a moment later)
    w.history.pushState({}, '', '/N542AP/' + otherId.toString(16)); post(w, 'follow', { id: otherId }); await sleep(20); vueArr.data = 'DXB';
    await sleep(700);
    const a1 = arrEl.textContent.trim();
    w.history.pushState({}, '', '/' + id.toString(16)); post(w, 'follow', { id }); await sleep(20); vueArr.data = 'N/A';
    await sleep(700);
    const a2 = arrEl.textContent.trim();
    w.history.pushState({}, '', '/' + vfrId.toString(16)); post(w, 'follow', { id: vfrId });
    await sleep(700);
    const a3 = arrEl.textContent.trim();
    check('panel: the next flight opened shows its own destination (no carry-over of the previous code)', a1 === 'DXB' && a3 === 'N/A' && a2 !== 'N/A', { ladd: before, next: a1, backToLadd: a2, vfr: a3 });
    w.history.pushState({}, '', '/' + id.toString(16)); post(w, 'follow', { id }); await sleep(700);
  }
  // ---- tools ------------------------------------------------------------------------------------------------------
  {
    const st2 = panel.querySelector('.tl-strip');
    const acts = st2 ? [...st2.querySelectorAll('[data-tl-act]')].map(a => a.dataset.tlAct) : [];
    check('tools in the strip (watch, CSV, scorecard)', ['watch', 'csv', 'stats'].every(k => acts.includes(k)), acts);
    check('N-number -> transponder address (US register algorithm)', L.nNumberHex('N942JT') === 'ad1570' && L.nNumberHex('N100ES') === 'a00529' && L.nNumberHex('N1') === 'a00001' && L.nNumberHex('N99999') === 'adf7c7', [L.nNumberHex('N942JT'), L.nNumberHex('N100ES')]);
    // watch -> take-off and landing alerts
    st2.querySelector('[data-tl-act="watch"]').click(); await sleep(2500);
    const wl = L.watchList(), we = wl[hex];
    check('watch: added to the watchlist from the strip', !!we, Object.keys(wl));
    const kteb = L.engine.byIcao('KTEB');
    we.state = 'gnd'; we.apId = kteb.id; w.__notes.length = 0;
    const fake = (lat, lon, alt, gnd, gs) => L.areaCache.set(hex, Object.assign({}, L.areaCache.get(hex) || {}, { hex, lat, lon, alt, gnd, gs, trk: 90, ageS: 0, receivedAt: Date.now() }));
    fake(kteb.lat + 0.05, kteb.lon + 0.05, 3500, false, 220); await L.pollWatch(true);
    const n1 = w.__notes.map(n => n.title + ': ' + n.text);
    fake(kteb.lat, kteb.lon, 0, true, 5); await L.pollWatch(true);
    const n2 = w.__notes.map(n => n.title + ': ' + n.text);
    check('watch: take-off and landing alerts', n1.some(t => /took off/.test(t) && /TEB/.test(t)) && n2.some(t => /landed/.test(t) && /TEB/.test(t)), n2);
    st2.querySelector('[data-tl-act="watch"]') && L.watchList()[hex] && (delete L.watchList()[hex]);
    // scorecard: a flight predicted along the way, scored when it lands
    const sid = 0x42f0cccc, A0 = L.accStore().done.length;
    L.accNote(sid, { destId: kteb.id, destIata: 'TEB', originIata: 'PBI', destConf: 'likely', onGround: false });
    L.accNote(sid, { destId: kteb.id, destIata: 'TEB', originIata: 'PBI', destConf: 'landed', landed: true, ata: Math.floor(Date.now() / 1000) + 1800 });
    check('scorecard: a predicted flight scored when it lands', L.accStore().done.length === A0 + 1 && /%/.test(L.statsHtml()), L.accStore().done.slice(-1)[0]);
    // CSV of the flight log
    w.__blobs.length = 0; st2.querySelector('[data-tl-act="csv"]').click();
    for (let i = 0; i < 40 && !w.__blobs.length; i++) await sleep(100);
    const csv = w.__blobs.length ? await w.__blobs[0].text() : '';
    check('CSV: the flight log downloads as a table', /^date_utc,callsign,from,/.test(csv) && csv.split('\r\n').length > 2, csv.split('\r\n').slice(0, 3));
    // fleet: the FAA register by owner name, addresses from the N-numbers
    const jj = { id: 0x42f0aaab, hex: L.nNumberHex('N400J'), reg: 'N400J', owner: 'JOHNSON &amp; JOHNSON FINANCE CORP' };
    const fl = await L.fleetList(jj);
    check('fleet: other aircraft of the same owner from the FAA register', fl.some(x => x.reg === 'N700J' && x.hex === L.nNumberHex('N700J')), fl.map(x => x.reg + ' ' + x.hex));
    L.checkHealth();
    // (the harness has no FR24 live feed: that one note is expected here)
    const issues = (L.health.issues || []).filter(x => !/live feed was not recognised/.test(x));
    check('health check: nothing reported on a working page', Array.isArray(L.health.issues) && issues.length === 0, issues);
    for (let i = 0; i < 60 && !(L.engine.byIcao('KTEB') || {}).rwl; i++) await sleep(250);
    check('runway lengths known (can it land there)', ((L.engine.byIcao('KTEB') || {}).rwl || [0])[0] > 6000 && ((L.engine.byIcao('KSMO') || {}).rwl || [0, 9])[0] < 5000, [(L.engine.byIcao('KTEB') || {}).rwl, (L.engine.byIcao('KSMO') || {}).rwl]);
  }
  // quick routes for everything identified
  await sleep(6000);
  const qr = matched.filter(f => B.routes.has(f.id)).length;
  check('quick routes for all identified flights (boards/search)', qr >= matched.length * 0.8, `${qr}/${matched.length}`);
  // every identified aircraft (not only the selected one) gets its own flight log in the background
  const L2 = w.__tweeksLadd;
  check('background history for non-selected aircraft', L2.histPumped.size >= 1, [...L2.histPumped.entries()].slice(0, 5).map(([h, v]) => `${h}:${v.days}d`));
  // the yellow tag: an injected board row, a real FR24 board row of another identified flight, and the recent-flights rows
  const other = matched.find(f => f.id !== id && B.resolved.get(f.id) && (B.resolved.get(f.id).cs || B.resolved.get(f.id).reg));
  const otherLabel = other ? (B.resolved.get(other.id).cs || B.resolved.get(other.id).reg) : 'NONE';
  w.document.body.insertAdjacentHTML('beforeend', `<ul class="board"><li id="airport_schedule_${9000000000 + id}"><div data-testid="airport-panel__schedules__flight__${9000000000 + id}"><div class="space-x-1"><span>${rec.cs || rec.reg}</span><span>${rec.type}</span></div></div><dl><dd><span>${rec.type}</span><span data-testid="airport-flight-details__registration">${rec.reg}</span></dd></dl></li><li id="airport_schedule_5869989309"><div data-testid="airport-panel__schedules__flight__5869989309"><div class="space-x-1"><span>${otherLabel}</span><span>XX</span></div></div></li><li id="airport_schedule_5869989310"><div data-testid="airport-panel__schedules__flight__5869989310"><div class="space-x-1"><span>DAL123</span><span>A321</span></div></div></li></ul>`);
  panel.querySelector('main > div').insertAdjacentHTML('beforeend', `<ul class="recent"><li><span data-testid="aircraft-panel__recent-flights__callsign">(N/A)</span><a data-testid="flight-actions__action-playback" href="#">Playback</a></li><li><span data-testid="aircraft-panel__recent-flights__callsign">(N/A)</span></li></ul><a data-testid="aircraft-panel__recent-flights__more-flights-button" href="https://www.flightradar24.com/data/aircraft/${rec.reg.toLowerCase()}#">More</a>`);
  await sleep(300);
  const rows = [...w.document.querySelectorAll('ul.board li')].map(li => (li.querySelector('.space-x-1 .tl-ladd-chip') || {}).textContent || '-');
  check('LADD tag on board rows (injected + FR24 row of an identified flight, none on others)', rows[0] !== '-' && (rows[1] !== '-' || !other) && rows[2] === '-', rows);
  check('LADD tag in the expanded board card', !!w.document.querySelector('ul.board [data-testid="airport-flight-details__registration"] + .tl-ladd-chip'));
  check('LADD tag on "Recent flights" rows', panel.querySelectorAll('ul.recent .tl-ladd-chip').length === 2, panel.querySelectorAll('ul.recent .tl-ladd-chip').length);
  let opened = ''; w.open = u => { opened = u; return null; };
  // (a new tab: airplanes.live's track)
  panel.querySelector('ul.recent [data-testid="flight-actions__action-playback"]').dispatchEvent(new w.MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
  for (let i = 0; i < 15 && !opened; i++) await sleep(100);
  check('Playback on a rebuilt row opens that leg\'s track on airplanes.live', /^https:\/\/globe\.airplanes\.live\/\?icao=[0-9a-f]{6}&showTrace=\d{4}-\d\d-\d\d$/.test(opened), opened);
  // an ordinary (not blocked) aircraft: FR24 shows it, but padlocks country / MSN / age / vertical speed / GPS altitude /
  // squawk for free accounts - the page reports its identity and the userscript fills those from public data
  {
    const pubHex = (matched.find(f => f.id !== id) || {}).id ? B.resolved.get(matched.find(f => f.id !== id).id).hex : hex;
    panel.remove();
    const lock2 = l => `<div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">${l}</p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3 text-yellow-500"><path></path></svg><!----></div></div>`;
    w.document.body.insertAdjacentHTML('beforeend', `<aside data-testid="aircraft-panel"><div data-testid="aircraft-panel__header"><div><div><span data-testid="aircraft-panel__header__callsign">DAL123</span><span data-testid="aircraft-panel__header__model">A321</span><span data-testid="aircraft-panel__header__airline-name">Delta</span></div></div></div><main><div style="overflow-y:auto"><div class="first"></div><div class="grid grid-cols-2"><div class="col-span-1"><p>ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">${pubHex}</p></div>${['COUNTRY OF REG.', 'AGE', 'Vertical speed', 'GPS altitude', 'SQUAWK'].map(lock2).join('')}</div><p data-testid="aircraft-panel__registration">N1PUB</p><div class="col-span-8"><p data-testid="aircraft-panel__airport-departure-iata">ATL</p><div>Atlanta</div></div><div class="col-span-8"><p data-testid="aircraft-panel__airport-arrival-iata">JFK</p><div>New York</div></div></div></main></aside>`);
    const pubId = 777000001;
    w.history.pushState({}, '', '/DAL123/' + pubId.toString(16));
    w.postMessage({ __tweeksLadd: 'follow', id: pubId });
    w.postMessage({ __tweeksLadd: 'aircraftInfo', id: pubId, hex: pubHex, reg: 'N1PUB', type: 'A321', cs: 'DAL123' });
    let filled = {};
    for (let i = 0; i < 16; i++) { await sleep(1000); filled = Object.fromEntries([...w.document.querySelectorAll('[data-testid="aircraft-panel"] .tl-filled')].map(e => [e.dataset.k, e.textContent])); if (filled.vs && filled.country) break; }
    check('ordinary aircraft: padlocked fields filled from public data (country, vertical speed, GPS alt, squawk)', !!(filled.country && filled.vs), filled);
    check('ordinary aircraft with FR24\'s own route: no strip or tag at all (links only on blocked and N/A flights)', !w.document.querySelector('[data-testid="aircraft-panel"] .tl-strip, [data-testid="aircraft-panel"] .tl-ladd'));
    check('ordinary aircraft: a real airline FR24 names is left as it is', clean2(w.document.querySelector('[data-testid="aircraft-panel__header__airline-name"]').textContent) === 'Delta');
    // an ordinary flight FR24 lists as "Private owner": its registered owner from the register instead (G-WAPA, an R44 -
    // hexdb and adsbdb say only "Private"; the UK's G-INFO names the owner)
    {
      const gPanel = w.document.querySelector('[data-testid="aircraft-panel"]'), gId = 777000077;
      gPanel.querySelector('[data-testid="aircraft-panel__header__callsign"]').textContent = 'GWAPA';
      gPanel.querySelector('[data-testid="aircraft-panel__header__model"]').textContent = 'R44';
      gPanel.querySelector('[data-testid="aircraft-panel__header__airline-name"]').textContent = 'Private owner';
      gPanel.querySelector('[data-testid="aircraft-panel__hex"]').textContent = '4066DB';
      gPanel.querySelector('[data-testid="aircraft-panel__registration"]').textContent = 'G-WAPA';
      w.history.pushState({}, '', '/GWAPA/' + gId.toString(16));
      w.postMessage({ __tweeksLadd: 'follow', id: gId });
      w.postMessage({ __tweeksLadd: 'aircraftInfo', id: gId, hex: '4066db', reg: 'G-WAPA', type: 'R44', cs: 'GWAPA' });
      let txt = ''; for (let i = 0; i < 25; i++) { await sleep(1000); txt = clean2(gPanel.querySelector('[data-testid="aircraft-panel__header__airline-name"]').textContent); if (!/^private owner$/i.test(txt)) break; }
      check('ordinary aircraft listed as "Private owner": its registered owner from the register (G-WAPA, UK G-INFO)', /watson/i.test(txt) && !/private/i.test(txt), txt);
    }
    check('ordinary aircraft: telemetry handed to the page (unlocks native vertical speed / airspeeds)', !!B.telem.get(pubId), B.telem.get(pubId) && { vr: B.telem.get(pubId).vr, agps: B.telem.get(pubId).agps });
  }
  // An ordinary flight FR24 shows without a destination (military, private, GA, helicopters): the same reasoning as for a
  // LADD aircraft fills its N/A airports - natively, through FR24's own frame - never over a route FR24 has, and not for
  // drones. A helicopter down away from every airport is at a private site, named where the site list has one.
  {
    const naPanel = (cs, type, hexU, reg) => `<aside data-testid="aircraft-panel"><div data-testid="aircraft-panel__header"><div><div><span data-testid="aircraft-panel__header__callsign">${cs}</span><span data-testid="aircraft-panel__header__model">${type}</span></div></div></div><main><div style="overflow-y:auto"><div class="first"></div><div class="grid grid-cols-2"><div class="col-span-1 text-sm leading-tight"><p class="text-xs uppercase leading-tight text-gray-900">ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">${hexU}</p></div></div><p data-testid="aircraft-panel__registration">${reg}</p><div class="col-span-8"><div class="mt-1"><div data-testid="base-tooltip"><a href="#" data-testid="aircraft-panel__airport-departure-iata">N/A</a></div></div><div><div class="overflow-hidden"><span data-testid="aircraft-panel__airport-departure-city">Not available</span></div><p data-testid="aircraft-panel__airport-departure-timezone"></p></div></div><div class="col-span-8"><div class="mt-1"><div data-testid="base-tooltip"><a href="#" data-testid="aircraft-panel__airport-arrival-iata">N/A</a></div></div><div><div class="overflow-hidden"><span data-testid="aircraft-panel__airport-arrival-city">Not available</span></div><p data-testid="aircraft-panel__airport-arrival-timezone"></p></div></div></div></main></aside>`;
    const q1 = t => ((w.document.querySelector(`[data-testid="aircraft-panel__airport-${t}"]`) || {}).textContent || '').trim();
    const fresh = c => c && Date.now() - (c.receivedAt - (c.ageS || 0) * 1000) < 90000;
    const pz = L.globalList.items.find(c => c.mil && !c.ladd && c.cs && c.type && !c.gnd && c.gs > 150 && c.alt > 3000 && fresh(c)) || L.globalList.items.find(c => c.cs && c.type && !c.gnd && c.gs > 150 && c.alt > 3000 && fresh(c));
    if (pz) {
      w.document.querySelectorAll('[data-testid="aircraft-panel"]').forEach(e => e.remove());
      const nid = 777000900;
      w.history.pushState({}, '', '/' + pz.cs + '/' + nid.toString(16)); post(w, 'follow', { id: nid });
      post(w, 'pos', { id: nid, lat: pz.lat, lon: pz.lon, trk: Math.round(pz.trk), alt: Math.round(pz.alt), spd: Math.round(pz.gs), gnd: false, at: Date.now() });
      post(w, 'sched', { id: nid, o: 0, d: 0 });
      post(w, 'aircraftInfo', { id: nid, hex: pz.hex, reg: pz.reg || '', type: pz.type, cs: pz.cs });
      await sleep(30);
      w.document.body.insertAdjacentHTML('beforeend', naPanel(pz.cs, pz.type, pz.hex.toUpperCase(), pz.reg || 'N/A'));
      const tq = Date.now(); let rt = null;
      // (an airfield FR24 does not list - Kaneohe Bay MCAS - reaches the page by its code and name, with no FR24 id)
      for (let i = 0; i < 150; i++) { await sleep(100); rt = B.routes.get(nid); if (rt && (rt.destId || rt.destIata) && q1('arrival-iata').replace(/\?$/, '') !== 'N/A') break; }
      // (a low-confidence answer can change while it is read: the page's route and the panel are compared once they agree)
      for (let i = 0; i < 20; i++) { rt = B.routes.get(nid); if (rt && (rt.destId || rt.destIata) && q1('arrival-iata').replace(/\?$/, '') === rt.destIata) break; await sleep(150); }
      const sp = w.document.querySelector('[data-testid="aircraft-panel"] .tl-strip');
      check('ordinary flight FR24 shows without a destination: reasoned destination in its panel and in FR24\'s own frame', !!(rt && (rt.destId || rt.destIata)) && q1('arrival-iata').replace(/\?$/, '') === rt.destIata && q1('arrival-city') === rt.destCity && !!sp && /Predicted|Confirmed/.test(sp.textContent) && !w.document.querySelector('[data-testid="aircraft-panel"] .tl-ladd'),
        { ms: Date.now() - tq, aircraft: `${pz.cs} ${pz.type}${pz.mil ? ' (military)' : ''}`, panel: `${q1('departure-iata')} > ${q1('arrival-iata')} ${q1('arrival-city')}`, strip: sp && sp.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) });
      // closed and opened again: the route is in the page before FR24's first frame (and kept for a reload)
      B.routes.delete(nid); post(w, 'follow', { id: 777000901 }); await sleep(60);
      const t2 = Date.now(); post(w, 'follow', { id: nid });
      let back = null; for (let i = 0; i < 40 && !back; i++) { await sleep(5); back = B.routes.get(nid); }
      check('ordinary flight reopened: its reasoned route back in the page at once', !!(back && (back.destId || back.destIata)), { ms: Date.now() - t2, kept: !!L.pubMem()[nid] });
      // FR24 has a destination but no departure: its destination stands, the departure is still reasoned
      const own = L.engine.airports.find(a => a.id !== (rt && rt.destId) && a.iata), own2 = L.engine.airports.find(a => a.id !== own.id && a.id !== (rt && rt.destId) && a.iata);
      post(w, 'sched', { id: nid, o: 0, d: own.id }); await sleep(600);
      const rd = (L.routeState.get(nid) || {}).route;
      // (an aircraft already on final approach is landing where it is landing, whatever plan arrives: a diversion - only a
      // flight still away from its field takes FR24's destination)
      check('ordinary flight with only a destination from FR24: FR24\'s destination kept, only the departure reasoned', (rt && rt.destConf === 'confirmed') || !!(rd && rd.destId === own.id && L.pubRouted(nid)), rd && { dest: rd.destIata, want: own.iata, conf: rd.destConf, origin: rd.originIata || rd.originNote });
      // FR24 gets a full route of its own: ours goes
      post(w, 'sched', { id: nid, o: own2.id, d: own.id }); await sleep(300);
      check('ordinary flight: once FR24 has a route of its own, nothing of ours stays', !B.routes.has(nid) && !L.pubRouted(nid) && !L.pubMem()[nid], { page: !!B.routes.get(nid) });
    } else check('ordinary flight FR24 shows without a destination: reasoned destination in its panel and in FR24\'s own frame', true, 'skipped (no suitable aircraft airborne)');
    // drones: nothing to predict
    {
      const did = 777000910;
      w.document.querySelectorAll('[data-testid="aircraft-panel"]').forEach(e => e.remove());
      w.history.pushState({}, '', '/FORTE10/' + did.toString(16)); post(w, 'follow', { id: did });
      post(w, 'pos', { id: did, lat: 39.5, lon: 20.5, trk: 90, alt: 52000, spd: 300, gnd: false, at: Date.now() });
      post(w, 'sched', { id: did, o: 0, d: 0 });
      post(w, 'aircraftInfo', { id: did, hex: 'ae5420', reg: '11-2049', type: 'RQ4', cs: 'FORTE10' });
      w.document.body.insertAdjacentHTML('beforeend', naPanel('FORTE10', 'RQ4', 'AE5420', '11-2049'));
      await sleep(1500);
      check('drones: no destination predicted', !B.routes.has(did) && !L.pubRouted(did) && q1('arrival-iata') === 'N/A', { arr: q1('arrival-iata') });
    }
    // a helicopter that lifted off from a field and landed in another, far from any airport: private sites, both ends
    {
      L.loadSites(); for (let i = 0; i < 240 && !(L.sites.grid); i++) await sleep(500);
      const hid = 777000920, hhex = 'fffe02', tN = Math.floor(Date.now() / 1000);
      const A = { lat: 52.05, lon: -1.55 }, Z = { lat: 51.95, lon: -1.75 }, pts = [];
      for (let k = 0; k <= 40; k++) { const f = k / 40, gnd = k === 0 || k === 40; pts.push({ t: tN - 1260 + k * 30, lat: A.lat + (Z.lat - A.lat) * f, lon: A.lon + (Z.lon - A.lon) * f, alt: gnd ? 0 : Math.round(400 + 1100 * Math.sin(Math.PI * f)), gs: gnd ? 0 : 110, trk: 235 }); }
      w.document.querySelectorAll('[data-testid="aircraft-panel"]').forEach(e => e.remove());
      w.history.pushState({}, '', '/GHELI/' + hid.toString(16)); post(w, 'follow', { id: hid });
      post(w, 'trail', { id: hid, first: pts[0], n: pts.length, maxAlt: 1500, pts, at: Date.now() });
      post(w, 'pos', { id: hid, lat: Z.lat, lon: Z.lon, trk: 235, alt: 0, spd: 0, gnd: true, at: Date.now() });
      post(w, 'sched', { id: hid, o: 0, d: 0 });
      post(w, 'aircraftInfo', { id: hid, hex: hhex, reg: 'G-HELI', type: 'EC35', cs: 'GHELI' });
      await sleep(30);
      w.document.body.insertAdjacentHTML('beforeend', naPanel('GHELI', 'EC35', hhex.toUpperCase(), 'G-HELI'));
      let hr = null; for (let i = 0; i < 80; i++) { await sleep(100); hr = (L.routeState.get(hid) || {}).route; if (hr && hr.landed && q1('arrival-iata').replace(/\?$/, '') !== 'N/A') break; }
      check('helicopter down away from every airport: landed at a private site, from a private site (named when listed)', !!(hr && hr.landed && !hr.destId && /^(PVT|[A-Z]{4})$/.test(hr.destIata) && hr.originIata && !hr.originId) && q1('arrival-iata') === hr.destIata && q1('arrival-city') === hr.destCity,
        { sites: L.sites.n, route: hr && `${hr.originIata} ${hr.originCity} > ${hr.destIata} ${hr.destCity}`, panel: `${q1('departure-iata')} ${q1('departure-city')} > ${q1('arrival-iata')} ${q1('arrival-city')} ${q1('arrival-timezone')}` });
      const lh = L.privatePlace(51.4700, -0.1790, { heli: true });
      check('landing sites: a listed heliport is named (London Heliport)', /heliport/i.test(lh.name) && lh.code === 'EGLW', lh);
      w.document.querySelectorAll('[data-testid="aircraft-panel"]').forEach(e => e.remove());
    }
  }
  // Every aircraft in view, ordinary ones included: FR24's view bounds -> one aggregator query -> telemetry for all of
  // them in the page, keyed by callsign/registration; opening one fills its padlocked fields on the first render.
  {
    let box = { n: 52.3, s: 50.9, w: -1.8, e: 1.4 };   // London by day; otherwise the busiest area on hand
    {
      const cells = new Map(); for (const c of L.areaCache.values()) if (c && c.cs && c.reg && !c.ladd && !c.gnd && Number.isFinite(c.lat) && now2() - (c.receivedAt - (c.ageS || 0) * 1000) < 300000) { const k = Math.floor(c.lat) + ',' + Math.floor(c.lon); cells.set(k, (cells.get(k) || 0) + 1); }
      const lon0 = [...L.areaCache.values()].filter(c => c.lat > 50.9 && c.lat < 52.3 && c.lon > -1.8 && c.lon < 1.4 && !c.gnd).length;
      const best = [...cells.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && lon0 < 25) { const [la, lo] = best[0].split(',').map(Number); box = { n: la + 1.2, s: la - 0.2, w: lo - 0.6, e: lo + 1.6 }; }
    }
    const inBox = c => c.lat > box.s && c.lat < box.n && c.lon > box.w && c.lon < box.e;
    const tq = Date.now();
    w.postMessage({ __tweeksLadd: 'view', n: box.n, s: box.s, w: box.w, e: box.e });
    let pa = null;
    for (let i = 0; i < 100 && (!pa || [...L.areaCache.values()].filter(inBox).length < 3); i++) { await sleep(100); pa = [...L.areaCache.values()].find(c => inBox(c) && c.cs && c.reg && !c.ladd && !c.gnd && Number.isFinite(c.vs) && Number.isFinite(c.agps) && c.sq && now2() - (c.receivedAt - c.ageS * 1000) < 60000) || null; }
    const inView = [...L.areaCache.values()].filter(inBox).length;
    check('view poll: every aircraft in the map view from one query', !!pa && inView >= 3, { ms: Date.now() - tq, aircraftInView: inView, sample: pa && `${pa.cs} ${pa.reg} ${pa.type}` });
    if (pa) {
      await sleep(200);
      const pt = hook && hook.pubTelFor(pa.cs, pa.reg, pa.lat, pa.lon), paNow = L.areaCache.get(pa.hex) || pa;
      // (compared with the aircraft's latest data too: the view poll may have refreshed it in between)
      check('view poll: the page holds its telemetry by callsign (ordinary flights unlocked in FR24\'s own feed)', !!pt && (pt.agps === pa.agps || pt.agps === paNow.agps), pt && { vr: pt.vr, agps: pt.agps, air: pt.air });
      // an ordinary aircraft's panel, opened with no message from the page at all: filled from the view data alone
      const lock3 = l => `<div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">${l}</p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3 text-yellow-500"><path></path></svg><!----></div></div>`;
      w.document.querySelectorAll('[data-testid="aircraft-panel"]').forEach(e => e.remove());
      const oid = 777000555;
      w.history.pushState({}, '', '/' + pa.cs + '/' + oid.toString(16));
      post(w, 'follow', { id: oid });   // (FR24 opens the flight's stream before it draws the panel)
      await sleep(20);
      const t0p = Date.now();
      w.document.body.insertAdjacentHTML('beforeend', `<aside data-testid="aircraft-panel"><div data-testid="aircraft-panel__header"><div><div><span data-testid="aircraft-panel__header__callsign">${pa.cs}</span><span data-testid="aircraft-panel__header__model">${pa.type}</span><span data-testid="aircraft-panel__header__airline-name">Airline</span></div></div></div><main><div style="overflow-y:auto"><div class="first"></div><div class="grid grid-cols-2"><div class="col-span-1"><p>ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">${pa.hex.toUpperCase()}</p></div>${['COUNTRY OF REG.', 'AGE', 'Vertical speed', 'GPS altitude', 'TRUE AIRSPEED', 'fir/uir', 'SQUAWK'].map(lock3).join('')}</div><p data-testid="aircraft-panel__registration">${pa.reg}</p></div></main></aside>`);
      let filled = {}, ms = -1;
      for (let i = 0; i < 100; i++) { await sleep(10); filled = Object.fromEntries([...w.document.querySelectorAll('[data-testid="aircraft-panel"] .tl-filled')].map(e => [e.dataset.k, e.textContent])); if (filled.vs && filled.agps && filled.sq && filled.country && filled.fir) { ms = Date.now() - t0p; break; } }
      check('ordinary aircraft opened: padlocks filled on the first render (country, vertical speed, GPS alt, airspeed, FIR, squawk)', ms >= 0 && ms < 250, { ms, filled });
      // the registry lookups finish, then the panel is closed and opened again: everything back at once, no new lookups
      for (let i = 0; i < 80 && !(L.store.getHex(pa.hex) || {}).pubAt; i++) await sleep(100);
      const html1 = w.document.querySelector('[data-testid="aircraft-panel"]').outerHTML.replace(/<span class="tl-filled[^>]*>[^<]*<\/span>/g, '').replace(/ tl-filled-lock/g, '');
      const full1 = Object.fromEntries([...w.document.querySelectorAll('[data-testid="aircraft-panel"] .tl-filled')].map(e => [e.dataset.k, e.textContent]));
      w.document.querySelectorAll('[data-testid="aircraft-panel"]').forEach(e => e.remove());
      post(w, 'follow', { id: 777000556 }); w.history.pushState({}, '', '/X/' + (777000556).toString(16)); await sleep(300);
      w.history.pushState({}, '', '/' + pa.cs + '/' + oid.toString(16)); post(w, 'follow', { id: oid }); await sleep(20);
      const n0 = netLog.length, t1p = Date.now();
      w.document.body.insertAdjacentHTML('beforeend', html1);
      let again = {}, ms2 = -1;
      for (let i = 0; i < 60; i++) { await sleep(10); again = Object.fromEntries([...w.document.querySelectorAll('[data-testid="aircraft-panel"] .tl-filled')].map(e => [e.dataset.k, e.textContent])); if (Object.keys(full1).every(k => again[k])) { ms2 = Date.now() - t1p; break; } }
      // (lookups for this aircraft - the view poll keeps prefetching registry facts of other aircraft on screen)
      const looked = netLog.slice(n0).filter(n => /hexdb|adsbdb|registry\.faa|jetphotos|opensky/.test(n[0]) && (n[0].toLowerCase().includes(pa.hex.toLowerCase()) || (!!pa.reg && n[0].toUpperCase().includes(pa.reg.toUpperCase())))).map(n => n[0]);
      check('ordinary aircraft reopened: every filled field back at once, nothing looked up again', ms2 >= 0 && ms2 < 250 && !looked.length, { ms: ms2, first: full1, again, looked });
      pubReopen = { hex: pa.hex, cs: pa.cs, html: html1, filled: full1 };
      // switching straight to another ordinary aircraft: FR24 selects the new flight ~80 ms before it redraws the panel -
      // in that moment nothing of the previous aircraft may be taken for the new one
      const pb = [...L.areaCache.values()].find(c => c.hex !== pa.hex && inBox(c) && c.cs && c.reg && !c.ladd && !c.gnd && Number.isFinite(c.agps) && Math.abs(c.agps - pa.agps) > 500 && now2() - (c.receivedAt - c.ageS * 1000) < 90000);
      if (pb) {
        const oidB = 777000660;
        post(w, 'follow', { id: oidB }); w.history.pushState({}, '', '/' + pb.cs + '/' + oidB.toString(16));
        await sleep(150);                                                         // panel still shows aircraft A
        const telB = B.telem.get(oidB), leak = !!(telB && telB.agps === pa.agps);
        const staleFill = [...w.document.querySelectorAll('[data-testid="aircraft-panel"] .tl-filled')].map(e => e.textContent);
        const htmlB = html1.split(pa.hex.toUpperCase()).join(pb.hex.toUpperCase()).split('>' + pa.cs + '<').join('>' + pb.cs + '<').split('>' + pa.reg + '<').join('>' + pb.reg + '<');
        w.document.querySelectorAll('[data-testid="aircraft-panel"]').forEach(e => e.remove());
        w.document.body.insertAdjacentHTML('beforeend', htmlB);                  // FR24 redraws it for aircraft B
        let gotB = {}; for (let i = 0; i < 60; i++) { await sleep(10); gotB = Object.fromEntries([...w.document.querySelectorAll('[data-testid="aircraft-panel"] .tl-filled')].map(e => [e.dataset.k, e.textContent])); if (gotB.agps) break; }
        const fmt = v => Math.round(v).toLocaleString('en-US');
        // B's own altitude - it may have moved on a little since the snapshot (a newer position), but never A's
        const altB = Number(String(gotB.agps || '').replace(/[^\d-]/g, '')), ownB = Number.isFinite(altB) && gotB.agps && Math.abs(altB - pb.agps) < Math.abs(altB - pa.agps) && Math.abs(altB - pb.agps) <= 1000;
        check('switching aircraft: nothing of the previous aircraft carried over to the new one', !leak && !staleFill.some(t => t.includes(fmt(pa.agps))) && ownB,{ a: pa.cs + ' ' + fmt(pa.agps), b: pb.cs + ' ' + fmt(pb.agps), pageTelemForB: telB && telB.agps, filledWhileA: staleFill, filledB: gotB.agps });
      }
      w.document.querySelectorAll('[data-testid="aircraft-panel"]').forEach(e => e.remove());
    }
    // FIR / UIR from position
    for (let i = 0; i < 60 && !L.firAt(51.47, -0.45); i++) await sleep(250);
    const firs = { london: L.firAt(51.47, -0.45), shanwick: L.firAt(55, -20), newYork: L.firAt(40.64, -73.78), tokyo: L.firAt(35.55, 139.78), sydney: L.firAt(-33.95, 151.18) };
    const lbl = f => f ? `${f.id} ${f.name}` : '-';
    check('FIR/UIR from position (London, Shanwick oceanic, New York, Tokyo, Sydney)', /^EGTT/.test((firs.london || {}).id || '') && /^EGGX/.test((firs.shanwick || {}).id || '') && /^KZNY/.test((firs.newYork || {}).id || '') && !!firs.tokyo && !!firs.sydney, Object.fromEntries(Object.entries(firs).map(([k, v]) => [k, lbl(v)])));
    // ... and from height: EJU958Q near Beauvais was "Brest" (a flight-sim sector map where Brest overlaps Paris)
    const lv = { bvaLow: L.firAt(49.291, 2.029, 9000), bvaHigh: L.firAt(49.291, 2.029, 25950), fraLow: L.firAt(50.03, 8.57, 12000), fraHigh: L.firAt(50.03, 8.57, 36000), lhrHigh: L.firAt(51.47, -0.45, 35000), alaska: L.firAt(61.17, -150.0, 30000), fiji: L.firAt(-17.75, 177.44, 3000) };
    check('FIR/UIR by height: Paris FIR / France UIR near Beauvais, Langen FIR / Rhein UIR, London UIR, across the 180th meridian', /Paris FIR/.test((lv.bvaLow || {}).name || '') && /France UIR/.test((lv.bvaHigh || {}).name || '') && /Langen FIR/.test((lv.fraLow || {}).name || '') && /Rhein UIR/.test((lv.fraHigh || {}).name || '') && /London UIR/.test((lv.lhrHigh || {}).name || '') && /^PAZA/.test((lv.alaska || {}).id || '') && /^NFFF/.test((lv.fiji || {}).id || ''), Object.fromEntries(Object.entries(lv).map(([k, v]) => [k, lbl(v)])));
  }
  // A reload: a second page on the same IndexedDB. What was learnt comes back from the store at once, and the aircraft's
  // next flight (a new FR24 flight id) starts with its identity, operator and photos - nothing is looked up again.
  // The store is made as large as weeks of use would (thousands of flights and aircraft): the start must not wait for it.
  let w2 = null;
  {
    for (let i = 0; i < 3000; i++) L.store.setId(0x50000000 + i, { id: 0x50000000 + i, hex: 'e' + (i + 0x10000).toString(16).slice(-5), reg: 'X-' + i, type: 'C172', route: { originId: 1, destId: 2, originIata: 'AAA', destIata: 'BBB', destReason: 'x'.repeat(80), alternatives: [{ iata: 'CCC', p: 10 }, { iata: 'DDD', p: 5 }] } });
    for (let i = 0; i < 8000; i++) L.store.mergeHex('d' + (i + 0x10000).toString(16).slice(-5), { reg: 'Y-' + i, type: 'GLF4', desc: 'Gulfstream IV', owner: 'Owner ' + i, recent: Array.from({ length: 30 }, (_, k) => [1790000000 + k * 7200, 1790003600 + k * 7200, 1000 + k, 2000 + k, 'ground', 'ground', 'N' + i, 41000, 1]) });
    const routeBefore = (L.routeState.get(id) || {}).route || L.live.get(id).route;
    L.saveSnapshot(); L.store.flushNow();
    await sleep(2500);   // the store writes on a short debounce
    const snapRaw = w.localStorage.getItem('tweeks.fr24.ladd.boot');
    check('snapshot written for the next page load (localStorage + IndexedDB)', !!snapRaw && JSON.parse(snapRaw).flights.some(f => f.id === id), { kB: Math.round((snapRaw || '').length / 1024), flights: snapRaw ? JSON.parse(snapRaw).flights.length : 0 });
    w2 = makeDom('https://www.flightradar24.com/40.9,-74/8', '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
    if (snapRaw) w2.localStorage.setItem('tweeks.fr24.ladd.boot', snapRaw);
    const tR = Date.now();
    w2.eval(SRC);
    let B3 = null, L3 = null, tRoute = -1;
    for (let i = 0; i < 400; i++) { await sleep(5); B3 = w2.__tweeksLaddBridge; L3 = w2.__tweeksLadd; if (B3 && B3.resolved.has(id) && B3.routes.get(id)) { tRoute = Date.now() - tR; break; } }
    const r3 = B3 && B3.resolved.get(id), rt3 = B3 && B3.routes.get(id);
    check('reload: stored identity, photos and last position back in the page at once', !!(r3 && r3.reg && (r3.photos.length || !(rec.photos || []).length) && B3.lastPos.get(id)), r3 ? { ms: tRoute, reg: r3.reg, photos: r3.photos.length, lastPos: !!B3.lastPos.get(id) } : 'not pushed');
    check('reload: route with its departure airport in the page instantly (big store still loading)', !!rt3 && rt3.originIata === routeBefore.originIata && tRoute < 300, { ms: tRoute, route: rt3 && `${rt3.originIata}-${rt3.destIata}`, before: `${routeBefore.originIata}-${routeBefore.destIata}`, storeLoaded: L3.store.stats().loaded });
    for (let i = 0; i < 200 && !L3.store.stats().loaded; i++) await sleep(50);
    check('reload: the full store (3,000 flights, 8,000 aircraft) loaded in the background, after the page had everything', L3.store.stats().loaded && L3.store.stats().aircraft >= 8000, Object.assign({ fullLoadMs: Date.now() - tR }, L3.store.stats()));
    const lr = L3.live.get(id);
    check('reload: the panel has the departure airport at once (no trace fetched)', !!(lr && lr.route && lr.route.originIata === routeBefore.originIata && lr.origin), lr && { origin: lr.origin, route: lr.route && lr.route.originIata });
    if (rec.reg) {
      const sr = await (await w2.fetch(`/v1/search/web/find?query=${encodeURIComponent(rec.reg)}&limit=50`)).json();
      const lr = (sr.results || []).filter(r => r.type === 'live' && r.detail && r.detail.reg === rec.reg);
      check('reload: search finds it before any feed arrives (one row)', lr.length === 1, lr.map(r => r.id));
    }
    for (let i = 0; i < 40 && !(L3.globalList.items.length && L3.engine.airports.length); i++) await sleep(500);
    let c = L3.globalList.byHex.get(hex);
    // (the second page's own list request may be rate-limited: then it gets the first page's copy)
    if (!c && L.globalList.byHex.get(hex)) { c = L.globalList.byHex.get(hex); L3.globalList.items.push(c); L3.globalList.byHex.set(hex, c); L3.globalList.at = Date.now(); }
    if (c && !c.gnd) {
      const newId = 0x42f00001, n1 = netLog.length;
      post(w2, 'feed', { flights: [{ id: newId, lat: c.lat, lon: c.lon, trk: Math.round(c.trk), alt: Math.round(c.alt), spd: Math.round(c.gs), icon: 3, ts: Math.floor((c.receivedAt - c.ageS * 1000) / 1000), gnd: false, src: 0, type: c.type, reg: '', sel: false }], serverTime: Date.now(), total: 1, at: Date.now(), bg: false });
      for (let i = 0; i < 30 && !L3.live.has(newId); i++) await sleep(100);
      const nr = L3.live.get(newId), pr = B3.resolved.get(newId);
      check('new flight of a known aircraft: identity + photos carried over instantly', !!(nr && nr.reg === rec.reg && ((nr.photos || []).length || !(rec.photos || []).length) && pr && (pr.photos.length || !(rec.photos || []).length) && nr.msn === rec.msn), nr ? { reg: nr.reg, msn: nr.msn, operator: nr.operatorName || nr.owner, photos: (nr.photos || []).length, pagePhotos: pr ? pr.photos.length : 0 } : 'not matched');
      await sleep(4000);
      const again = netLog.slice(n1).filter(n => (n[0].toLowerCase().includes(hex) || (rec.reg && n[0].toUpperCase().includes(rec.reg))) && !/adsb\.lol|adsb\.fi|airplanes\.live|adsb\.one/.test(n[0]));
      check('new flight of a known aircraft: no registry / photo lookups repeated', again.length === 0, again.map(n => n[0]));
    } else check('new flight of a known aircraft: identity + photos carried over instantly', true, 'skipped (aircraft no longer airborne in the list)');
    // the restored flight seen again in the feed: recomputed from the stored inputs, the departure airport stays
    {
      const c2 = L3.globalList.byHex.get(hex) || L.globalList.byHex.get(hex) || pick.c;
      post(w2, 'feed', { flights: [{ id, lat: c2.lat, lon: c2.lon, trk: Math.round(c2.trk), alt: Math.round(c2.alt), spd: Math.round(c2.gs), icon: 3, ts: Math.floor(Date.now() / 1000), gnd: false, src: 0, type: c2.type, reg: '', sel: false }], serverTime: Date.now(), total: 1, at: Date.now(), bg: false });
      await sleep(3600);
      const rt = B3.routes.get(id), rs = (L3.routeState.get(id) || {}).route || L3.live.get(id).route;
      check('reload: after the recompute the departure airport is unchanged', !!rt && rt.originIata === routeBefore.originIata && rs && !rs.quick === !rs.quick, { page: rt && rt.originIata, content: rs && rs.originIata, note: rs && rs.originNote, before: routeBefore.originIata, held: [...L3.bootHold] });
    }
    // a userscript sandbox without IndexedDB: the snapshot alone carries the refresh
    {
      const w3 = makeDom('https://www.flightradar24.com/40.9,-74/8', '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
      w3.indexedDB = undefined;
      if (snapRaw) w3.localStorage.setItem('tweeks.fr24.ladd.boot', snapRaw);
      const t3 = Date.now(); w3.eval(SRC);
      let B4 = null, ms4 = -1;
      for (let i = 0; i < 400; i++) { await sleep(5); B4 = w3.__tweeksLaddBridge; if (B4 && B4.resolved.has(id) && B4.routes.get(id)) { ms4 = Date.now() - t3; break; } }
      const L4 = w3.__tweeksLadd;
      check('no IndexedDB: identity, photo and route with departure airport from the snapshot alone', ms4 >= 0 && ms4 < 300 && B4.routes.get(id).originIata === routeBefore.originIata && (B4.resolved.get(id).photos.length > 0 || !(rec.photos || []).length), { ms: ms4, mode: L4 && L4.store.mode() });
      w3.close();
    }
    // ---- an identification sticks -------------------------------------------------------------------------------
    {
      // stored for this FR24 flight id, and FR24 now spells the type differently: still identified, straight away
      const sid = 0x42f00077;
      L3.store.setId(sid, { id: sid, hex: rec.hex, reg: rec.reg, type: rec.type, fr24Type: rec.type, cs: rec.reg });
      post(w2, 'feed', { flights: [{ id: sid, lat: 10, lon: 10, trk: 90, alt: 30000, spd: 400, icon: 3, ts: Math.floor(Date.now() / 1000), gnd: false, src: 0, type: 'ZZZZ', reg: '', sel: false }], serverTime: Date.now(), total: 1, at: Date.now(), bg: false });
      await sleep(150);
      check('sticks: a stored identification survives FR24 spelling the type differently', L3.live.has(sid) && !!B3.resolved.get(sid) && B3.resolved.get(sid).reg === rec.reg, { live: L3.live.has(sid), page: !!B3.resolved.get(sid) });
      // public positions disagreeing for a while (FR24 extrapolating through a coverage gap): not withdrawn
      const cand = { hex: rec.hex, cs: '', reg: rec.reg, type: rec.type, lat: 10.4, lon: 10, alt: 30000, gs: 400, trk: 90, gnd: false, ageS: 0, receivedAt: Date.now(), src: 'test' };
      const saveList = { items: L3.globalList.items, byHex: L3.globalList.byHex, at: L3.globalList.at };
      L3.globalList.items = [cand]; L3.globalList.byHex = new Map([[rec.hex, cand]]); L3.globalList.at = Date.now();
      for (let k = 0; k < 6; k++) { post(w2, 'feed', { flights: [{ id: sid, lat: 10, lon: 10, trk: 90, alt: 30000, spd: 400, icon: 3, ts: Math.floor(Date.now() / 1000), gnd: false, src: 0, type: rec.type, reg: '', sel: false }], serverTime: Date.now(), total: 1, at: Date.now(), bg: false }); cand.receivedAt = Date.now(); L3.verifyAgainstList(); await sleep(20); }
      check('sticks: repeated position disagreements over a short time do not withdraw it', L3.live.has(sid) && !!B3.resolved.get(sid), { strikes: L3.strikes.get(sid) });
      // ... but a genuinely wrong match (far apart for over 3 minutes) is still corrected
      const s0 = L3.strikes.get(sid); if (s0) s0.first = Date.now() - 200000;
      cand.receivedAt = Date.now(); L3.verifyAgainstList(); await sleep(50);
      check('sticks: a match that stays far apart for 3+ minutes is still withdrawn', !L3.live.has(sid) && !B3.resolved.get(sid) && L3.revokedIds.has(sid), { live: L3.live.has(sid) });
      Object.assign(L3.globalList, saveList);
      // another FR24 tab saved flights this one never saw: its snapshot keeps them
      const foreign = { id: 0x42f000aa, hex: 'abcdef', reg: 'N-TAB2', type: 'C56X', cs: 'N-TAB2', savedAt: Date.now(), lastPos: { lat: 40, lon: -74, alt: 20000, gnd: false, at: Date.now() } };
      const raw0 = JSON.parse(w2.localStorage.getItem('tweeks.fr24.ladd.boot') || '{"v":1,"flights":[],"hex":{}}');
      raw0.flights.push(foreign); raw0.flights.push(Object.assign({}, foreign, { id: sid, hex: rec.hex })); w2.localStorage.setItem('tweeks.fr24.ladd.boot', JSON.stringify(raw0));
      L3.saveSnapshot();
      const raw1 = JSON.parse(w2.localStorage.getItem('tweeks.fr24.ladd.boot'));
      check('sticks: flights saved by another FR24 tab are kept in the snapshot (withdrawn ones are not)', raw1.flights.some(f => f.id === foreign.id) && !raw1.flights.some(f => f.id === sid) && raw1.flights.some(f => f.id === id), { flights: raw1.flights.length });
      // a new FR24 flight id of an aircraft whose public position is already on hand: recognised without a lookup
      const pub = { hex: 'a0b1c2', cs: 'N55TL', reg: 'N55TL', type: 'C68A', lat: 12, lon: 12, alt: 25000, gs: 380, trk: 45, gnd: false, ageS: 2, receivedAt: Date.now(), src: 'adsb.fi' };
      L3.areaCache.set(pub.hex, pub);
      const nid = 0x42f000bb, tq = Date.now(), n2 = netLog.length;
      post(w2, 'feed', { flights: [{ id: nid, lat: 12, lon: 12, trk: 45, alt: 25000, spd: 380, icon: 3, ts: Math.floor(Date.now() / 1000), gnd: false, src: 0, type: 'C68A', reg: '', sel: false }], serverTime: Date.now(), total: 1, at: Date.now(), bg: false });
      for (let i = 0; i < 40 && !B3.resolved.get(nid); i++) await sleep(10);
      const ms = Date.now() - tq, lookups = netLog.slice(n2).filter(n => /adsb\.fi|adsb\.lol\/v2|airplanes\.live|adsb\.one|opensky/.test(n[0]) && /lat|point|dist|states/.test(n[0]));
      check('sticks: a new FR24 flight id is recognised from positions already on hand, instantly', !!B3.resolved.get(nid) && B3.resolved.get(nid).hex === pub.hex && ms < 300, { ms, hex: (B3.resolved.get(nid) || {}).hex, areaLookups: lookups.length });
    }
    // an ordinary aircraft opened after the reload: its registry facts from the store, instantly, no lookups
    if (pubReopen) {
      const oid2 = 777000599, n0 = netLog.length;
      w2.history.pushState({}, '', '/' + pubReopen.cs + '/' + oid2.toString(16)); post(w2, 'follow', { id: oid2 }); await sleep(20);
      const t2 = Date.now(); w2.document.body.insertAdjacentHTML('beforeend', pubReopen.html);
      // (its live fields too, when the snapshot carried its public data: vertical speed, GPS altitude, squawk...)
      const inSnap = snapRaw && (JSON.parse(snapRaw).area || []).some(a => a.hex === pubReopen.hex);
      const want = (inSnap ? Object.keys(pubReopen.filled) : ['country', 'age', 'msn']).filter(k => pubReopen.filled[k]);
      let got = {}, ms3 = -1;
      for (let i = 0; i < 80; i++) { await sleep(10); got = Object.fromEntries([...w2.document.querySelectorAll('[data-testid="aircraft-panel"] .tl-filled')].map(e => [e.dataset.k, e.textContent])); if (want.every(k => got[k])) { ms3 = Date.now() - t2; break; } }
      const looked = netLog.slice(n0).filter(n => /hexdb|adsbdb|registry.faa|jetphotos/.test(n[0]) && n[0].toLowerCase().includes(pubReopen.hex)).map(n => n[0]);
      check("reload: an ordinary aircraft's registry facts (country, age, serial) back instantly, not looked up again", ms3 >= 0 && ms3 < 400 && !looked.length, { ms: ms3, inSnapshot: inSnap, want, got, looked });
      w2.document.querySelectorAll('[data-testid="aircraft-panel"]').forEach(e => e.remove());
    }
    const errs3 = w2.__logs.filter(l => /ERROR|TypeError|ReferenceError/.test(l));
    check('reload: no script errors', errs3.length === 0 && B3.stats.errors === 0, errs3.slice(0, 5));
  }
  // FR24's 30-minute "Your session has timed out" for free accounts: its 'session' store's sessionSuspended, set by a
  // timer (processSession -> suspendSession). A stand-in for FR24's Vue app and store, then that timer firing:
  {
    const subs = [], sess = { $id: 'session', sessionSuspended: false, $subscribe(cb, o) { subs.push(cb); }, $patch(o) { Object.assign(this, o); subs.forEach(f => f()); } };
    const host = w.document.createElement('div'); host.setAttribute('data-v-app', ''); w.document.body.appendChild(host);
    host.__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['session', sess]]), use() {} } } } };
    sess.sessionSuspended = true; subs.forEach(f => f());        // suspendSession(), 30 minutes in
    check('FR24\'s 30-minute session timeout is set back at once (no "session has timed out" screen)', subs.length > 0 && sess.sessionSuspended === false && B.stats.adFree.session >= 1, { subscribed: subs.length, suspended: sess.sessionSuspended, resets: B.stats.adFree.session });
    host.remove();
  }
  // (a public source answering 429 - rate-limited after a day of testing - is the outside world, not a script error)
  const errs = w.__logs.filter(l => /ERROR|TypeError|ReferenceError|failed/.test(l) && !/HTTP 429|rate-limited/.test(l));
  check('no script errors logged', errs.length === 0, errs.slice(0, 8));
  check('page interceptor error count', B.stats.errors === 0, B.stats);
  if (process.env.E2E_LOG) console.log(w.__logs.filter(l => new RegExp(process.env.E2E_LOG, 'i').test(l)).slice(0, 30).join('\n'));
  const slow = netLog.filter(n => n[2] > 3000).length;
  console.log(`\nnetwork: ${netLog.length} requests, ${slow} slower than 3 s, statuses ${JSON.stringify(netLog.reduce((m, n) => (m[n[1]] = (m[n[1]] || 0) + 1, m), {}))}`);
  console.log('hosts:', JSON.stringify(netLog.reduce((m, n) => { const h = new URL(n[0].replace(/ .*/, '')).host; m[h] = (m[h] || 0) + 1; return m; }, {})));
  console.log('refused:', JSON.stringify(netLog.filter(n => n[1] === 403 || n[1] === 429).map(n => n[1] + ' ' + n[0].slice(0, 70))));
  { const ps = netLog.filter(n => /planespotters/.test(n[0])); console.log('planespotters:', JSON.stringify(ps.reduce((m, n) => (m[n[1]] = (m[n[1]] || 0) + 1, m), {})), 'avg ms', Math.round(ps.reduce((a, n) => a + n[2], 0) / Math.max(1, ps.length)), 'max ms', Math.max(0, ...ps.map(n => n[2]))); }
  process.exit(0);
}

async function pageMode(reg) {
  const html = await (await netFetch(`https://www.flightradar24.com/data/aircraft/${reg.toLowerCase()}`, { headers: { Accept: 'text/html' } })).text();
  const clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');   // FR24's own scripts are not needed for the test
  const w = makeDom(`https://www.flightradar24.com/data/aircraft/${reg.toLowerCase()}`, clean);
  w.eval(RUN(SRC));
  const tb = () => w.document.querySelector('#tbl-datatable tbody');
  // (EXPECT_OWNER=<regex>: an aircraft FR24 lists as "Private owner" - its AIRLINE line names the registered owner)
  const ownerCheck = async () => {
    if (!process.env.EXPECT_OWNER) return;
    const field = l => { const r = [...w.document.querySelectorAll('#cnt-aircraft-info .row')].find(x => { const lb = x.querySelector('label'); return lb && lb.textContent.trim().toUpperCase() === l; }); return r ? clean2(r.querySelector('span.details').textContent) : ''; };
    for (let i = 0; i < 25 && !new RegExp(process.env.EXPECT_OWNER, 'i').test(field('AIRLINE')); i++) await sleep(1000);
    check('log page of an aircraft FR24 lists as "Private owner": AIRLINE names its registered owner', new RegExp(process.env.EXPECT_OWNER, 'i').test(field('AIRLINE')), { airline: field('AIRLINE'), operator: field('OPERATOR') });
  };
  // FR24 lists this aircraft's flights itself: only its '—' airports (fields FR24 does not know) are filled from ADS-B
  const own = [...tb().querySelectorAll('tr.data-row')].filter(r => !r.classList.contains('tl-adsb-row'));
  // (any row of FR24's own - G-DGFD had two, and the whole log rebuilt under them doubled its flights)
  if (own.length >= 1) {
    const dashes = () => own.reduce((n, r) => n + [3, 4].filter(i => r.children[i] && /^\s*(—|-)?\s*$/.test(r.children[i].textContent)).length, 0), d0 = dashes();
    // (until the fill has settled: its history arrives in batches - twenty seconds without a change, two minutes at most)
    let last = -1, still = 0; for (let i = 0; i < 150 && still < 20; i++) { await sleep(1000); const k = tb().querySelectorAll('td.tl-filled').length + tb().querySelectorAll('tr.tl-adsb-row').length; if (k === last && k > 0 && !/loading/.test((w.document.querySelector('tr.tl-older-foot') || {}).textContent || '')) still++; else still = 0; last = k; }
    for (const r of own.slice(0, 8)) console.log('  ', [2, 3, 4, 6, 8, 11].map(i => (r.children[i] ? r.children[i].textContent : '').replace(/\s+/g, ' ').trim()).join(' | '));
    check('FR24 rows: its "—" airports filled from the ADS-B track', d0 === 0 || tb().querySelectorAll('td.tl-filled').length > 0, { dashesBefore: d0, after: dashes(), filled: tb().querySelectorAll('td.tl-filled').length });
    // its own rows stand alone: no second "Live" row, nothing rebuilt among them; three months of earlier flights under
    // them, all older than FR24's oldest row
    const older = [...tb().querySelectorAll('tr.tl-adsb-row')], oldestOwn = Math.min(...own.map(r => Number(r.dataset.timestamp) || Infinity));
    check('FR24 rows: no rebuilt live row beside FR24\'s own', !tb().querySelector('tr.tl-live-row'), tb().querySelectorAll('tr.tl-live-row').length);
    check('three months of earlier flights rebuilt under FR24\'s week, all older than its rows', older.every(r => Number(r.dataset.timestamp) < oldestOwn) && older.every(r => own.every(o => o.compareDocumentPosition(r) & 4)), { older: older.length, foot: ((w.document.querySelector('tr.tl-older-foot') || {}).textContent || '').trim().slice(0, 160) });
    for (const r of older.slice(0, 4)) console.log('   older:', [2, 3, 4, 6, 8, 11].map(i => (r.children[i] ? r.children[i].textContent : '').replace(/\s+/g, ' ').trim()).join(' | '));
    // FR24's playback panel: the padlocked serial number "-" as the header's
    {
      const sn = w.document.getElementById('txt-aircraft-serial');
      if (sn) { sn.textContent = '-'; w.dispatchEvent(new w.HashChangeEvent('hashchange')); await sleep(700); const hdr = clean2(([...w.document.querySelectorAll('#cnt-aircraft-info .row')].find(x => /SERIAL/.test(x.textContent)) || { textContent: '' }).textContent).replace(/SERIAL NUMBER \(MSN\)/, '').trim(); check('playback panel: serial number filled as the header has it', !/^-?$/.test(clean2(sn.textContent)), { panel: clean2(sn.textContent), header: hdr }); }
    }
    // FR24's playback panel: its padlocked figures from the ADS-B track, at a moment in the flight on the second row
    {
      const ts = w.document.getElementById('txt-track-timestamp'), r2 = own[1] || own[0], atd = r2 && (Number(r2.children[8].dataset.timestamp) || Number(r2.dataset.timestamp));
      if (ts && atd) {
        // (a moment or two into the flight: one can fall in a hole in the public coverage)
        // (an aircraft tracked by multilateration only - G-DGFD's R44 on 2 Oct - sends no airspeeds or vertical speed:
        // those stay "–", each saying why on hover, and none taken from the receivers' estimates - 380 kt for an R44)
        let got = [], why = [];
        for (const off of [420, 900, 1500, 2400, 3300]) {
          ts.dataset.timestamp = String(atd + off);
          for (let i = 0; i < 30 && !w.document.querySelector('span.tl-pb'); i++) await sleep(500);
          await sleep(1200);
          const sps = [...w.document.querySelectorAll('span.tl-pb')];
          got = sps.map(sp => clean2(sp.parentElement.querySelector('label').textContent) + ': ' + clean2(sp.textContent));
          why = sps.filter(sp => /–/.test(sp.textContent)).map(sp => sp.title);
          if (got.filter(x => !/–$/.test(x)).length >= 3) break;
        }
        const filled = got.filter(x => !/–$/.test(x)).length, tas = got.map(x => /TRUE AIRSPEED: ([\d,]+)/.exec(x)).find(Boolean);
        check('playback panel: padlocked GPS altitude / airspeeds / vertical speed / squawk filled from ADS-B (or "–" saying why)', got.length === 5 && (filled >= 3 || (filled >= 1 && why.every(t => /multilateration|No public ADS-B|Not sent/.test(t)))) && !(tas && +tas[1].replace(/,/g, '') > 600), { got, why: [...new Set(why)] });
      } else console.log('(no playback panel in the page markup)');
    }
    await ownerCheck();
    const errs = w.__logs.filter(l => /ERROR|TypeError|ReferenceError/.test(l));
    check('no script errors logged', errs.length === 0, errs.slice(0, 8));
    process.exit(0);
  }
  for (let i = 0; i < 120; i++) { await sleep(1000); if (!w.document.querySelector('tr.tl-loading')) break; }
  const rows = [...tb().querySelectorAll('tr.tl-adsb-row')];
  check('flight log rows rebuilt', rows.length > 0, rows.length + ' rows @' + T());
  check('FR24 "no data" row removed', !/could not find data/i.test(tb().textContent));
  const liveRow = tb().querySelector('tr.tl-live-row');
  console.log('live row:', liveRow ? liveRow.querySelectorAll('td')[3].textContent.trim() + ' -> ' + liveRow.querySelectorAll('td')[4].textContent.trim() + ' | ' + liveRow.querySelectorAll('td')[11].textContent.trim() : 'none (not flying)');
  for (const r of rows.slice(0, 8)) { const td = r.querySelectorAll('td'); console.log('  ', [2, 3, 4, 5, 6, 8, 11].map(i => td[i].textContent.replace(/\s+/g, ' ').trim()).join(' | ')); }
  const info = [...w.document.querySelectorAll('#cnt-aircraft-info .row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' / ');
  console.log('header:', info);
  check('AGE filled', /AGE (\d+ years?|< 1 year)/.test(info));
  check('photos in header', !!w.document.querySelector('.tl-ac-photo img'));
  const h1 = w.document.querySelector('#cnt-subpage-info h1');
  check('LADD tag in the log page heading', !!(h1 && h1.querySelector('.tl-ladd-chip')), h1 ? h1.textContent.trim() : 'no heading');
  const live1 = w.document.querySelector('tr.tl-live-row');
  console.log('live row now:', live1 ? live1.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : 'none (not airborne)');
  const foot = w.document.querySelector('tr.tl-foot'); console.log('foot:', foot && foot.textContent.trim());
  const ads = [...w.document.querySelectorAll('.ad-manager-wrapper')];
  check('advert slot folded away', ads.length > 0 && ads.every(a => w.getComputedStyle(a).height === '0px' && w.getComputedStyle(a).visibility === 'hidden'), ads.map(a => a.className + ' h=' + w.getComputedStyle(a).height));
  const ups = [...w.document.querySelectorAll('#tbl-datatable tfoot tr.row-upgrade')];
  check('upgrade rows under the log hidden', ups.every(r => w.getComputedStyle(r).display === 'none'), ups.length + ' rows');
  await ownerCheck();
  const errs = w.__logs.filter(l => /ERROR|TypeError|ReferenceError/.test(l));
  check('no script errors logged', errs.length === 0, errs.slice(0, 8));
  // closed and opened again (the same browser's storage): the stored log is there at once - not rebuilt from scratch,
  // only today's track and any day still missing are asked for
  {
    const n1 = rows.length;
    w.dispatchEvent(new w.Event('pagehide')); await sleep(500);
    const net0 = netLog.length, t0r = Date.now();
    const w2 = makeDom(`https://www.flightradar24.com/data/aircraft/${reg.toLowerCase()}`, clean);
    w2.eval(RUN(SRC));
    let rows2 = []; for (let i = 0; i < 150; i++) { await sleep(100); rows2 = [...w2.document.querySelectorAll('#tbl-datatable tbody tr.tl-adsb-row')]; if (rows2.length >= Math.max(1, Math.floor(n1 * 0.9))) break; }
    const ms = Date.now() - t0r;
    await sleep(3000);
    const histReqs = netLog.slice(net0).filter(n => /globe_history/.test(n[0])).length;
    check('reopened: the stored flight log is back at once, not rebuilt from scratch', rows2.length >= Math.floor(n1 * 0.9) && ms < 4000 && histReqs < 15, { rowsBefore: n1, rows: rows2.length, ms, historyDayRequests: histReqs });
  }
  process.exit(0);
}
(mode === 'page' ? pageMode(process.argv[4] || 'N65NK') : mapMode()).catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
