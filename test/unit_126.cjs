// 1.2.6 (the BUILT userscript's page part in jsdom, and the monitor's naming):
//   - a board card's departure and arrival runways: from the flights' own tracks as known, FR24's padlock never kept -
//     "N/A" where none is known; asked for only once flown, at each end's own airport; done as soon as they are in
//   - FR24's own board rows with no other airport ("N/A"): that end asked for once, put in at once from then on
//   - a kept board row under this script's own flight id ("ff" + address + take-off), the aircraft not blocked and no
//     registration on the card: this script's Playback, never FR24's (which opens its list of aircraft types)
//   - the log page's player pictures: FR24's side view (a type it may have no file of) only when it has a real photo -
//     else the aircraft's own pictures; a real photo shown over a side view
//   - an aircraft on the ground named at once by the parked rule (here and on the monitor), provisionally: in the air, the aircraft heard where FR24 has it confirms it, or another
//     takes its place
//   - (the userscript's half of it needs its airports and a monitor: answered here, nothing over the network)
// usage: node test/unit_126.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), D = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const { createRouteEngine } = require('../src/engine.js');
const { createIdent } = require('../monitor/ident.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };

// the page part alone, its posts to the userscript caught; FR24's fetch answered by fetchImpl
function open(fetchImpl, url) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: url || 'https://www.flightradar24.com/51.47,-0.45/8', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, posts = []; let H = null;
  w.__tlTestHook = h => { H = h; };
  w.Response = Response; w.Headers = Headers; w.Blob = Blob; w.DecompressionStream = DecompressionStream;
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.indexedDB = undefined; w.fetch = fetchImpl || (() => Promise.reject(new Error('offline')));
  w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) throw new Error('pageInterceptor not found in the build');
  w.eval('(' + m[0] + ')()');
  const send = data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' }));
  return { w, H: () => H, posts, send };
}
const card = (fid, rw, sc, x) => new Response(JSON.stringify({ data: Object.assign({ flight: { id: fid, callsign: 'EZY12' }, runways: rw, schedule: sc, originId: 100, destinationId: 200 }, x || {}) }), { status: 200, headers: { 'content-type': 'application/json' } });
const LOCKED = () => ({ arrival: { name: null, upsell: true }, departure: { name: null, upsell: true } });

(async () => {
  const now = Math.floor(Date.now() / 1000);
  // ================= a board card's runways =================
  { const P = open(); await sleep(200); const H = P.H();
    H.mxRwy.set('3d1f0009:0', '27R'); H.mxRwy.set('3d1f0009:1', '09');
    const j1 = await (await H.cardRwy(card('3d1f0009', LOCKED(), { atd: now - 5000, ata: now - 1000 }), 200, 'arrivals', false)).json();
    check('card: both runways known - put in, FR24\'s padlock off; nothing asked', j1.data.runways.departure.name === '27R' && j1.data.runways.arrival.name === '09' && j1.data.runways.departure.upsell === false && j1.data.runways.arrival.upsell === false && !P.posts.some(p => p.__tweeksLadd === 'rwyWant'), j1.data.runways);
    // (not known: asked for at each end's own airport - the take-off at the origin, the landing here - and done as soon as the
    // monitor's answer has them, not at the 2.5 s limit)
    P.posts.length = 0;
    const t0 = Date.now(), pr = H.cardRwy(card('3d1f000a', LOCKED(), { atd: now - 5000, ata: now - 1000 }), 200, 'arrivals', false);
    await sleep(50);
    const asks = P.posts.filter(p => p.__tweeksLadd === 'rwyWant');
    asks.forEach(a => P.send({ __tweeksLadd: 'rwyGot', rid: a.rid, list: a.items.map(x => ({ k: x.fid + ':' + (x.landing ? 1 : 0), rwy: x.landing ? '27' : '05' })), done: false }));
    const j2 = await (await pr).json(), ms = Date.now() - t0;
    check('... not known: the take-off asked at the origin, the landing at this airport; put in the moment they come', asks.length === 2 && asks.some(a => a.ap === 100 && a.items[0].landing === false) && asks.some(a => a.ap === 200 && a.items[0].landing === true) && j2.data.runways.departure.name === '05' && j2.data.runways.arrival.name === '27' && ms < 1500, { ap: asks.map(a => [a.ap, a.items]), rw: j2.data.runways, ms });
    P.posts.length = 0;
    const j3 = await (await H.cardRwy(card('3d1f000b', LOCKED(), { atd: null, ata: null }), 200, 'arrivals', false)).json();
    check('... a flight not flown yet: nothing asked, no padlock - "N/A"', j3.data.runways.departure.name === null && j3.data.runways.departure.upsell === false && j3.data.runways.arrival.upsell === false && !P.posts.some(p => p.__tweeksLadd === 'rwyWant'), j3.data.runways);
    const j4 = await (await H.cardRwy(card('c1a2b3c4', LOCKED(), { atd: now - 5000, ata: now - 1000 }), 200, 'arrivals', true)).json();
    check('... a card under an id made up here: nothing asked, no padlock', j4.data.runways.arrival.upsell === false && !P.posts.some(p => p.__tweeksLadd === 'rwyWant'), j4.data.runways);
    const j5 = await (await H.cardRwy(card('3d1f000c', { arrival: { name: '23L', upsell: false }, departure: { name: null, upsell: true } }, {}), 200, 'arrivals', false)).json();
    check('... FR24\'s own runway (a subscriber\'s) kept as it gave it', j5.data.runways.arrival.name === '23L' && j5.data.runways.departure.upsell === false, j5.data.runways);
    // board rows: never a padlock - "N/A" until known
    const rows = [{ flight: { id: '3d1f0010' }, status: { name: 'scheduled' }, scheduledTime: now + 3600, runway: null, locked: { runway: true } }];
    H.mxBoardRwy(rows, 'arrivals', 200);
    check('board row not flown yet: no padlock ("N/A")', rows[0].locked.runway === false && rows[0].runway === null, rows[0]);
    P.w.close(); }

  // ================= FR24's own board rows with no other airport =================
  { const P = open(); await sleep(200); const H = P.H();
    const rows = [
      { id: 1, flight: { id: '3d2a0001', callsign: 'GLFST' }, status: { name: 'landed' }, estimatedTime: now - 3600, airportId: null },
      { id: 2, flight: { id: '3d2a0002', callsign: 'GRVNX' }, status: { name: 'scheduled' }, scheduledTime: now + 3600, airportId: null },
      { id: 3, flight: { id: '3d2a0003', callsign: 'LOG51MW' }, status: { name: 'landed' }, estimatedTime: now - 1800, airportId: 55 }];
    const n0 = H.naEndsFill(rows, 'arrivals', 975), ask = P.posts.filter(p => p.__tweeksLadd === 'needEnds');
    check('board: FR24\'s landed row with no origin asked for (its origin: end 0); one not flown and one FR24 names, not', n0 === 0 && ask.length === 1 && ask[0].list.length === 1 && ask[0].list[0].fid === '3d2a0001' && ask[0].list[0].end === 0, ask.map(a => a.list));
    P.send({ __tweeksLadd: 'endsGot', list: [{ k: '3d2a0001:0', ap: 1234, fin: 1 }] }); await sleep(20);
    const n1 = H.naEndsFill(rows, 'arrivals', 975);
    check('... its origin, once found, in the row - at once every time after, not asked again', n1 === 1 && rows[0].airportId === 1234 && rows[2].airportId === 55 && P.posts.filter(p => p.__tweeksLadd === 'needEnds').length === 1, rows.map(r => r.airportId));
    const dep = [{ id: 4, flight: { id: '3d2a0004' }, status: { name: 'departed' }, estimatedTime: now - 600, airportId: null }];
    H.naEndsFill(dep, 'departures', 975);
    check('... a departure 10 minutes off: its destination not asked yet (it has not landed)', P.posts.filter(p => p.__tweeksLadd === 'needEnds').length === 1);
    P.w.close(); }

  // ================= Playback of a kept row under this script's own flight id =================
  { const P = open(); await sleep(200); const H = P.H();
    const t0 = now - 3 * 3600, syn = 'ff403169' + ('00000000' + t0.toString(16)).slice(-8);
    H.acceptBoardArch({ apId: 3901, arr: [], dep: [{ k: 'gbsgd-1', t: t0, hex: '403169', reg: '', cs: 'GLFST', src: 'live', fid: syn, ap: 3501 }] });
    const j = { data: [] }; H.addArch(j, 3901, 'departures');
    const el = P.w.document.createElement('li'); el.id = 'airport_schedule_' + j.data[0].id; P.w.document.body.appendChild(el);
    const w = H.boardWant(el);
    check('Playback: a kept row under an id made up here - an aircraft not blocked, no registration on its card - is this script\'s, not FR24\'s (its list of aircraft types)', !!w && w.hex === '403169' && w.dep === t0, w);
    P.w.close(); }

  // ================= the log page's player pictures =================
  { const sv = 'https://www.flightradar24.com/static/images/sideviews/thumbnails/GL5T.jpg';
    let fr24 = { sideview: sv };
    const P = open(() => Promise.resolve(new Response(JSON.stringify(fr24), { status: 200, headers: { 'content-type': 'application/json' } })), 'https://www.flightradar24.com/data/aircraft/m-port');
    await sleep(200); const H = P.H(), u = 'https://www.flightradar24.com/aircraft/images/?aircraft=424B68';
    const pr = H.mxLegacyImages(u, u, {});
    await sleep(50);
    const ask = P.posts.find(p => p.__tweeksLadd === 'needPhotos');
    P.send({ __tweeksLadd: 'photosDone', hex: '424b68', photos: [{ large: 'https://cdn.jetphotos.com/full/6/1.jpg', link: 'https://www.jetphotos.com/photo/1', credit: 'A. Spotter', source: 'JetPhotos' }] });
    const a = await (await pr).json();
    check('log page player: FR24 with a side view only - the aircraft\'s own picture, its registration asked with it', !!ask && ask.reg === 'M-PORT' && !a.sideview && a.medium && a.medium[0].src === 'https://cdn.jetphotos.com/full/6/1.jpg' && a.medium[0].copyright === 'A. Spotter', { ask, a });
    fr24 = { sideview: sv, medium: [{ src: 'https://cdn.jetphotos.com/400/6/2.jpg', link: 'x', copyright: 'B' }] };
    const b = await (await H.mxLegacyImages(u, u, {})).json();
    check('... FR24 with a real photo and a side view: the photo (FR24\'s player would show the side view first)', !b.sideview && b.medium[0].src === 'https://cdn.jetphotos.com/400/6/2.jpg', b);
    fr24 = { medium: [{ src: 'https://cdn.jetphotos.com/400/6/3.jpg', link: 'y', copyright: 'C' }] };
    const c = await (await H.mxLegacyImages(u, u, {})).json();
    check('... FR24 with its own photo: FR24\'s answer as it is', c.medium[0].src === 'https://cdn.jetphotos.com/400/6/3.jpg', c);
    P.w.close(); }

  // ================= the monitor's parked rule: provisional =================
  { const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(D, 'airports.json'), 'utf8')).rows);
    const bwe = E.byIcao('EDVE'), igs = E.byIcao('EDMO') || E.byIcao('ETSI'), T = 1792000000, MS = T * 1000;
    const leg = { from: { id: (igs || bwe).id, conf: 'ground' }, to: { id: bwe.id, conf: 'ground' }, ended: true, open: false, tStart: T - 3 * 86400, tOff: T - 3 * 86400 + 300, tEnd: T - 3 * 86400 + 3600, type: 'PC24', reg: 'D-CVAB' };
    const fl = (id, o) => Object.assign({ id, lat: bwe.lat + 0.002, lon: bwe.lon + 0.002, alt: 0, trk: 260, spd: 0, ts: T, gnd: true, src: 0, type: 'PC24', reg: '', cs: '', icon: 3 }, o);
    const run = heard => {
      const env = { E, live: new Map(), ac: new Map(), blocked: new Map(), legs: new Map([['3c4a8e', new Map([['k1', leg]])]]) };
      const I = createIdent(env); I.observe([fl(7)], MS, 'scan'); I.match(MS);
      const R0 = I.ids.get(7) && Object.assign({}, I.ids.get(7));
      // three minutes on, off the runway and climbing: heard by ADS-B where FR24 has it
      const t2 = T + 180, [la, lo] = E.destPoint(bwe.lat, bwe.lon, 260, 6);
      env.live.set(heard, { a: { hex: heard, lat: la, lon: lo, alt_baro: 3000, gs: 160, track: 260, dbFlags: 8, r: heard === '3c4a8e' ? 'D-CVAB' : 'D-CXXX', t: 'PC24' }, t: t2 });
      I.observe([fl(7, { lat: la, lon: lo, alt: 3000, spd: 160, gnd: false, ts: t2 })], t2 * 1000, 'scan'); I.match(t2 * 1000);
      return { R0, R1: I.ids.get(7) };
    };
    const a = run('3c4a8e');
    check('monitor: on the ground, silent - the only PC-24 to have landed at Braunschweig and not left, named (the parked rule)', !!a.R0 && a.R0.hex === '3c4a8e' && a.R0.how === 'parked', a.R0);
    check('... in the air, heard where FR24 has it: confirmed', !!a.R1 && a.R1.hex === '3c4a8e' && a.R1.air === 1, a.R1);
    const b = run('3c4bbb');
    check('... another PC-24 heard there instead: that one named in its place', !!b.R1 && b.R1.hex === '3c4bbb' && b.R1.how !== 'parked', b.R1);
  }

  // ================= the userscript: named on the ground at once, provisionally; confirmed or replaced once heard ==========
  { const FIDB = require(path.join(NM, 'fake-indexeddb'));
    const AIRPORTS = fs.readFileSync(path.join(D, 'airports.json'), 'utf8'), MON = 'https://143-47-224-210.sslip.io';
    const E = createRouteEngine(); E.setAirports(JSON.parse(AIRPORTS).rows);
    const bwe = E.byIcao('EDVE'), tEnd = now - 3 * 86400;
    let parkedAsked = 0;
    const answer = url => {
      if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
      if (url.startsWith(MON + '/status')) return [200, JSON.stringify({ v: 1, public: true })];
      if (url.startsWith(MON + '/parked')) { parkedAsked++; return [200, JSON.stringify({ list: [{ hex: '3c4a8e', reg: 'D-CVAB', type: 'PC24', ladd: true, last: { from: { id: bwe.id + 1 }, to: { id: bwe.id }, ended: true, open: false, tStart: tEnd - 3600, tEnd, type: 'PC24', reg: 'D-CVAB' } }] })]; }
      if (url.startsWith(MON)) return [200, '{}'];
      return [404, ''];
    };
    const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/52.32,10.55/12', runScripts: 'dangerously', pretendToBeVisual: true }).window;
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
    win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
    win.GM_xmlhttpRequest = o => { const [st, text] = answer(String(o.url)); setTimeout(() => { if (o.onload) o.onload({ status: st, responseText: text, response: text, responseHeaders: '' }); }, 5); return { abort() {} }; };
    win.unsafeWindow = win; win.GM_notification = () => {};
    win.postMessage = () => {}; win.console.debug = () => {}; win.console.log = () => {};
    win.eval(SRC);
    const L = win.__tweeksLadd, until = async (f, ms) => { for (let i = 0; i < ms / 50; i++) { const v = await f(); if (v) return v; await sleep(50); } return f(); };
    const send = data => win.dispatchEvent(new win.MessageEvent('message', { data, source: win, origin: 'https://www.flightradar24.com' }));
    await until(() => L && L.engine.airports.length > 5000, 60000);
    await L.monCheck(true).catch(() => null);
    const fid = 0x3e5a0001, f = o => Object.assign({ id: fid, lat: bwe.lat + 0.002, lon: bwe.lon + 0.002, alt: 0, spd: 0, trk: 260, gnd: true, type: 'PC24', src: 0, ts: Math.floor(Date.now() / 1000) }, o);
    send({ __tweeksLadd: 'feed', flights: [f()], serverTime: Date.now(), total: 1, at: Date.now() }); await sleep(100);
    const t0 = Date.now(), ok = await L.matchParked(L.pending.get(fid)), rec = L.live.get(fid), took = Date.now() - t0;
    check('userscript: an unnamed PC-24 on the ground at Braunschweig - the only one known to have landed there and not left - named at once, provisionally', ok === true && !!rec && rec.hex === '3c4a8e' && rec.prov === 'parked' && L.isProv(fid) && parkedAsked === 1 && took < 3000, rec && { hex: rec.hex, prov: rec.prov, took, src: (rec.sources || []).join(' ') });
    // (off and climbing: another PC-24 heard exactly where FR24 has it - that one in its place)
    const [la, lo] = E.destPoint(bwe.lat, bwe.lon, 260, 6), ts = Math.floor(Date.now() / 1000);
    send({ __tweeksLadd: 'feed', flights: [f({ lat: la, lon: lo, alt: 3000, spd: 160, gnd: false, ts })], serverTime: Date.now(), total: 1, at: Date.now() }); await sleep(100);
    const heard = hex => ({ hex, nonIcao: false, cs: '', reg: hex === '3c4a8e' ? 'D-CVAB' : 'D-CXXX', type: 'PC24', desc: '', owner: '', year: 0, lat: la, lon: lo, alt: 3000, gnd: false, gs: 160, trk: 260, ageS: 0, receivedAt: Date.now(), dbFlags: 8, ladd: true, pia: false, mil: false, src: 'adsb.lol' });
    L.globalList.items = [heard('3c4bbb')]; L.globalList.byHex = new Map([['3c4bbb', L.globalList.items[0]]]); L.globalList.at = Date.now();
    L.matchAgainstList(L.pending.get(fid));
    const rec2 = L.live.get(fid);
    check('... in the air, another PC-24 heard where FR24 has it: that one named in its place', !!rec2 && rec2.hex === '3c4bbb' && !rec2.prov, rec2 && { hex: rec2.hex, prov: rec2.prov });
    // (and the same aircraft heard there: confirmed, no longer provisional)
    L.live.delete(fid); L.globalList.items = []; L.globalList.byHex = new Map();
    send({ __tweeksLadd: 'feed', flights: [f()], serverTime: Date.now(), total: 1, at: Date.now() }); await sleep(100);
    const pk = L.pending.get(fid); L.live.delete(fid);
    const r3 = L.recordFromMatch(pk, { c: Object.assign(heard('3c4a8e'), { lat: pk.lat, lon: pk.lon, alt: 0, gnd: true, gs: 0 }), rel: 'same', d: 0, s: 0 }, ['parked here']); r3.prov = 'parked'; L.adopt(r3);
    send({ __tweeksLadd: 'feed', flights: [f({ lat: la, lon: lo, alt: 3000, spd: 160, gnd: false, ts })], serverTime: Date.now(), total: 1, at: Date.now() }); await sleep(100);
    L.verifyAll([heard('3c4a8e')], Date.now());
    const rec3 = L.live.get(fid);
    check('... the same aircraft heard there: confirmed - no longer provisional', !!rec3 && rec3.hex === '3c4a8e' && !rec3.prov && !L.isProv(fid), rec3 && { hex: rec3.hex, prov: rec3.prov, src: (rec3.sources || []).slice(-1) });
    // ================= the log page's header: age as the map's panel works it out; no padlock =================
    { let ageQ = '';
      // (the monitor's /age: one answer per key asked, in order - only the PC-24 dated here)
      const ageAns = u => JSON.stringify({ list: decodeURIComponent(String(u).split('q=')[1] || '').split(';').map(k => /^GL5T~9868~/.test(k) ? [2009, 0, 'its serial number'] : null) });
      const answer0 = answer;
      win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith(MON + '/age')) { ageQ = u; return Promise.resolve(new Response(ageAns(u), { status: 200 })); } const [st, text] = answer0(u); return Promise.resolve(new Response(text, { status: st })); };
      const ga = win.GM_xmlhttpRequest; win.GM_xmlhttpRequest = o => { if (String(o.url).startsWith(MON + '/age')) { ageQ = String(o.url); setTimeout(() => o.onload && o.onload({ status: 200, responseText: ageAns(o.url), responseHeaders: '' }), 5); return { abort() {} }; } return ga(o); };
      const box = win.document.createElement('div'); box.id = 'cnt-aircraft-info';
      box.innerHTML = '<div class="row"><label>TYPE CODE</label> <span class="details">GL5T</span></div><div class="row"><label>SERIAL NUMBER (MSN)</label> <span class="details">9868</span></div>'
        + '<div class="row"><label>AGE</label> <span class="details"><a class="disabled premium-content"><svg class="icon-fr24-lock"></svg></a></span></div>';
      win.document.body.appendChild(box);
      L.fillAircraftHeader({ hex: '424b68', reg: 'M-PORT' }, 'M-PORT');
      const ageSp = () => box.querySelectorAll('span.details')[2];
      check('log page: FR24\'s padlocked age - "N/A" at once, never the padlock', !ageSp().querySelector('.icon-fr24-lock') && ageSp().textContent.trim() === 'N/A', ageSp().textContent);
      const got = await until(() => /17 years/.test(ageSp().textContent), 5000);
      check('... then the age, worked out as on the map: by the type and serial number FR24\'s header shows, asked of the monitor - the page drawn again when it answers', !!got && /GL5T~9868/.test(decodeURIComponent(ageQ)), { age: ageSp().textContent, ageQ });
      check('... the serial number FR24 shows left as it is', box.querySelectorAll('span.details')[1].textContent.trim() === '9868');
      box.remove(); }
    // ================= any aircraft's serial number and year: for the monitor, and so every other browser =================
    L.identityToMonitor({ hex: '406a1b', reg: 'G-BSGD', type: 'P28A', msn: '28-7505123', year: 1975 });
    L.identityToMonitor({ hex: '406a1c', reg: 'G-ABCD', type: 'C172', year: 1981, yearEst: true });
    const o1 = L.ownersOut.get('406a1b'), o2 = L.ownersOut.get('406a1c');
    check('an ordinary aircraft\'s serial number and register year found here go to the monitor (not only a blocked one\'s); a year the monitor estimated is not sent back as one', !!o1 && o1.msn === '28-7505123' && o1.year === 1975 && o1.reg === 'G-BSGD' && !o2, { o1, o2 });
    win.close(); }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
