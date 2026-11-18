// FR24's map playback, offline (15 Oct): CAPTR33, a Hawk (ZB139, 43C968) out of Leeming that FR24 names but has no
// destination for, heard only by multilateration and lost out over the Irish Sea - its playback panel showed "QKG -> N/A"
// with its serial number and squawk padlocked. Its destination now comes from FR24's own track of the flight (down at
// Anglesey / Valley) when the public one has no landing: in FR24's panel answer, and written into the panel's boxes when
// it comes after FR24 drew them - also when the page never said which aircraft it is (the address on the panel). And a
// blocked aircraft named in playback: its pictures asked for the moment it is opened, at the front of the queue, not after
// the registers. The BUILT userscript in jsdom, FR24's airport list from monitor/data.
// usage: node test/unit_pbends.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 20; i++) { const v = f(); if (v) return v; await sleep(20); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };

// the moment played: yesterday 13:21:54Z (a day long over, whatever day the test runs)
const D0 = new Date(); D0.setUTCDate(D0.getUTCDate() - 1); D0.setUTCHours(0, 0, 0, 0);
const DAY0 = Math.round(D0.getTime() / 1000), TS = DAY0 + 13 * 3600 + 21 * 60 + 54;
const ymd = D0.toISOString().slice(0, 10), hm = '13:21';
const PB_URL = `https://www.flightradar24.com/${ymd}/${hm}/1x/54.30,-3.50/8`;
const HEX = '43c968', FID = 0x3c4d5e6f;
// Its public track: on the ground at Leeming, off at 12:35, west across the Pennines and the Lakes, then circling out
// over the Irish Sea at 8-9,000 ft - multilateration only, the last report 13:40 (lost there)
function hawkTrace() {
  const tr = [], t0 = DAY0 + 12 * 3600 + 30 * 60, LEE = [54.2925, -1.5353];
  for (let i = 0; i <= 15; i++) tr.push([i * 20, LEE[0], LEE[1] - i * 0.0002, 'ground', i < 13 ? 5 : 60, 270, 0, null, i === 0 ? { flight: 'CAPTR33 ', squawk: '7001', type: 'mlat' } : null, 'mlat']);
  let t = 320, lat = LEE[0], lon = LEE[1] - 0.004, alt = 300;
  for (; t < 1800; t += 20) { lon -= 0.035; lat += 0.0008; alt = Math.min(8900, alt + 300); tr.push([t, lat, lon, alt, 330, 280, 0, 1500, t % 200 === 0 ? { squawk: '7001', type: 'mlat' } : null, 'mlat']); }
  for (let k = 0; t <= 4200; t += 20, k++) { const a = k / 18; tr.push([t, 54.35 + 0.15 * Math.sin(a), -4.2 + 0.25 * Math.cos(a), 8900, 300, (a * 57) % 360, 0, 0, t % 200 === 0 ? { squawk: '7001', type: 'mlat' } : null, 'mlat']); }
  return JSON.stringify({ icao: HEX, r: 'ZB139', t: 'HAWK', desc: 'BAE Hawk', dbFlags: 1, timestamp: t0, trace: tr });
}
// FR24's own track of the flight: from the runway at Leeming to the ground at Valley, 14:05
function fr24Playback() {
  const p = (t, lat, lon, ft, kts) => ({ latitude: lat, longitude: lon, altitude: { feet: ft, meters: Math.round(ft * 0.3048) }, speed: { kts, kmh: 0, mph: 0 }, heading: 270, squawk: '7001', timestamp: t });
  const t0 = DAY0 + 12 * 3600 + 35 * 60;
  return JSON.stringify({ result: { response: { data: { flight: { identification: { id: FID.toString(16), callsign: 'CAPTR33' }, aircraft: { identification: { modes: HEX.toUpperCase(), registration: 'ZB139' } },
    track: [p(t0, 54.2925, -1.5390, 0, 120), p(t0 + 60, 54.30, -1.60, 1500, 250), p(t0 + 3600, 54.35, -4.2, 8900, 300), p(DAY0 + 14 * 3600 + 3 * 60, 53.26, -4.50, 600, 140), p(DAY0 + 14 * 3600 + 5 * 60, 53.2505, -4.536, 0, 40)] } } } } });
}
function makeWin(url, asked, opts) {
  opts = opts || {};
  const win = new JSDOM(opts.html || '<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.caches = { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => false }) };
  const answer = u => {
    asked.push({ url: u, at: Date.now() });
    if (opts.answer) { const r = opts.answer(u); if (r) return r; }
    if (/flightradar24\.com\/mobile\/airports\/format/.test(u)) return [0, 200, AIRPORTS];
    if (/trace_full_43c968\.json/.test(u)) return [150, 200, hawkTrace()];
    if (/common\/v1\/flight-playback\.json/.test(u) && /flightId=3c4d5e6f/.test(u)) return [200, 200, fr24Playback()];
    // FR24's own pictures of a registration (its JetPhotos list): a few hundred ms
    if (/common\/v1\/flight\/list\.json\?query=N123AB/.test(u)) return [300, 200, JSON.stringify({ result: { response: { aircraftInfo: null, aircraftImages: [{ registration: 'N123AB', images: { thumbnails: [{ src: 'https://cdn.jetphotos.com/200/5/1111_1.jpg', link: 'https://www.jetphotos.com/photo/1111', copyright: 'A Photographer', source: 'JetPhotos.com' }], medium: [{ src: 'https://cdn.jetphotos.com/400/5/1111_1.jpg' }], large: [{ src: 'https://cdn.jetphotos.com/640/5/1111_1.jpg' }] } }] } } })];
    // everything else - the registers among them - slow and empty
    return [opts.slow || 0, 404, ''];
  };
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const a = answer(u); return new Promise(r => setTimeout(() => r(new Response(a[2] || '', { status: a[1] })), a[0])); };
  win.GM_xmlhttpRequest = o => {
    const a = answer(o.url);
    setTimeout(() => { o.onload && o.onload({ status: a[1], responseText: a[2], response: a[2] }); }, a[0] || 1);
    return { abort() {} };
  };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.__posted = []; win.postMessage = data => { win.__posted.push({ d: data, at: Date.now() }); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.__logs = []; win.console.debug = (...a) => win.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); win.console.log = () => {}; win.console.error = (...a) => win.__logs.push('ERROR ' + a.join(' '));
  win.__tlTestHook = h => { win.__H = h; };
  win.eval(SRC);
  return win;
}
async function ready(w) {
  const L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000 && w.__H, 60000);
  await L.store.kvReady;
  return L;
}
const send = (w, d) => w.postMessage(Object.assign({}, d), '*');
// FR24's playback panel of the flight, as its markup has it: QKG -> N/A, its address on show, serial number and squawk
// padlocked, its age "N/A"
const lock = label => `<div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">${label}</p><div class="inline-flex items-center flex-row cursor-pointer"><svg class="fill-current size-3"><path></path></svg></div></div>`;
const na = label => `<div class="col-span-1 text-sm leading-tight"><p class="text-xs leading-tight text-gray-900">${label}</p><p class="text-md leading-tight text-gray-1300">N/A</p></div>`;
const PANEL = `<aside data-testid="aircraft-panel"><main><div class="first"><span data-testid="aircraft-panel__header__callsign">CAPTR33</span></div>
  <div class="grid grid-cols-2"><div class="col-span-1"><p data-testid="aircraft-panel__airport-departure-iata">QKG</p><div data-testid="aircraft-panel__airport-departure-city">Leeming</div></div>
  <div class="col-span-1"><p data-testid="aircraft-panel__airport-arrival-iata">N/A</p><div data-testid="aircraft-panel__airport-arrival-city">Not available</div></div></div>
  <div class="grid grid-cols-2"><div class="col-span-1"><p>REGISTRATION</p><p data-testid="aircraft-panel__registration">ZB139</p></div>${lock('SERIAL NUMBER (MSN)')}${na('AGE')}
  <div class="col-span-1"><p>ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">43C968</p></div>${lock('SQUAWK')}</div></main></aside>`;
const txt = (w, sel) => { const e = w.document.querySelector(sel); return e ? e.textContent.trim() : null; };
const filled = w => Object.fromEntries([...w.document.querySelectorAll('[data-testid="aircraft-panel"] .tl-filled')].map(e => [e.dataset.k, e.textContent]));
const ageCell = w => { const c = [...w.document.querySelectorAll('[data-testid="aircraft-panel"] [class*="col-span"]')].find(x => /^AGE$/.test(x.firstElementChild.textContent.trim())); return c ? c.children[1].textContent.trim() : null; };

(async () => {
  // ---- the flight opened: the page has its aircraft from the feed (not yet whether FR24 has its destination)
  {
    const asked = [], w = makeWin(PB_URL, asked), L = await ready(w), H = w.__H;
    check('ready: playback page, airports', L.engine.airports.length > 5000 && /^\/\d{4}-/.test(w.location.pathname));
    L.store.mergeHex(HEX, { reg: 'ZB139', type: 'HAWK', mil: true, msn: 'RT001', year: 2010 });
    const t0 = Date.now();
    send(w, { __tweeksLadd: 'pbFollow', id: FID, ts: TS });
    send(w, { __tweeksLadd: 'pbHex', id: FID, ts: TS, hex: HEX, reg: 'ZB139', type: 'HAWK', o: 0, d: 1, sel: true });
    const rt = await until(() => { const r = L.pb.routes.get(FID); return r && r.destIata ? r : null; }, 6000);
    check('its public track has no landing: where FR24\'s own track of it ended - down at Valley (VLY) - its destination, Leeming its origin', !!rt && rt.destIata === 'VLY' && rt.originIata === 'QKG' && rt.ata > TS, rt && { o: rt.originIata, d: rt.destIata, ata: rt.ata, ms: Date.now() - t0 });
    check('... FR24\'s track asked for at once, beside the public one (not after it)', (() => { const a = asked.find(x => /flight-playback/.test(x.url)), b = asked.find(x => /trace_full_43c968/.test(x.url)); return !!a && !!b && Math.abs(a.at - b.at) < 400; })());
    const pr = await until(() => H.pbRoutes.get(FID), 2000);
    check('... and the page given it, for FR24\'s panel answer', !!pr && pr.destIata === 'VLY');
    // FR24's answer of the panel: its schedule with Leeming and no destination - the route's end put in
    const ai = H.concat([H.fVar(1, parseInt(HEX, 16)), H.fStr(2, 'ZB139'), H.fStr(4, 'HAWK')]);
    const sc = H.concat([H.fStr(1, 'CAPTR33'), H.fVar(4, 8620)]);
    const efi = H.concat([H.fVar(1, FID), H.fStr(10, 'CAPTR33'), H.fVar(14, 1)]);
    const msg = H.concat([H.fLen(1, ai), H.fLen(2, sc), H.fLen(3, efi)]);
    const out = H.parse(H.patchFlightMsg(msg, { id: FID, ts: TS, pb: true }, H.PLAYBACK)), so = H.parse(out.find(f => f.fn === 2).val);
    const num = (fs, n) => { const f = fs.find(x => x.fn === n); return f ? f.val : 0; };
    check('FR24\'s panel answer: the destination given (Valley), its own origin left as it is', num(so, 5) === 3775 && num(so, 4) === 8620, { o: num(so, 4), d: num(so, 5) });
    // the panel FR24 drew before the route was in: its boxes written now
    w.document.body.insertAdjacentHTML('beforeend', PANEL);
    L.syncPanel(); await sleep(1700); L.syncPanel();
    const arr = await until(() => { L.syncPanel(); return txt(w, '[data-testid="aircraft-panel__airport-arrival-iata"]') === 'VLY' ? 1 : 0; }, 3000);
    check('the panel drawn without it: "N/A" in its arrival box replaced by VLY, Anglesey under it', !!arr && txt(w, '[data-testid="aircraft-panel__airport-arrival-city"]') === 'Anglesey', { iata: txt(w, '[data-testid="aircraft-panel__airport-arrival-iata"]'), city: txt(w, '[data-testid="aircraft-panel__airport-arrival-city"]') });
    check('... FR24\'s own origin left alone', txt(w, '[data-testid="aircraft-panel__airport-departure-iata"]') === 'QKG' && txt(w, '[data-testid="aircraft-panel__airport-departure-city"]') === 'Leeming');
    const f1 = await until(() => filled(w).msn && filled(w).sq ? filled(w) : null, 3000);
    check('... its padlocked serial number and squawk written in (RT001, 7001 from its track)', !!f1 && f1.msn === 'RT001' && f1.sq === '7001', filled(w));
    check('... its age in place of FR24\'s "N/A"', /year/.test(ageCell(w) || ''), ageCell(w));
    check('... the route strip shown (FR24 has no destination for it)', !!w.document.querySelector('[data-testid="aircraft-panel"] .tl-strip') && /VLY/.test(w.document.querySelector('[data-testid="aircraft-panel"] .tl-strip').textContent));
    // another flight opened, one FR24 has a destination for: ours taken out again
    w.document.querySelector('[data-testid="aircraft-panel__hex"]').textContent = '4CA123';
    w.document.querySelector('[data-testid="aircraft-panel__airport-arrival-city"]').firstChild.data = 'Dublin';
    send(w, { __tweeksLadd: 'pbFollow', id: FID + 1, ts: TS }); await sleep(50);
    send(w, { __tweeksLadd: 'pbHex', id: FID + 1, ts: TS, hex: '4ca123', reg: 'EI-ABC', type: 'B738', o: 1, d: 2 }); await sleep(50);
    L.syncPanel(); await sleep(50); L.syncPanel();
    check('another flight opened: VLY and our cells taken out again, no strip', txt(w, '[data-testid="aircraft-panel__airport-arrival-iata"]') === 'N/A' && !Object.keys(filled(w)).length && ageCell(w) === 'N/A' && !w.document.querySelector('[data-testid="aircraft-panel"] .tl-strip'), { iata: txt(w, '[data-testid="aircraft-panel__airport-arrival-iata"]'), filled: filled(w), age: ageCell(w) });
    const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
    check('no script errors', !errs.length, errs.slice(0, 5));
    w.close();
  }
  // ---- the gap: the page never said which aircraft it is - the panel's own address taken
  {
    const asked = [], w = makeWin(PB_URL, asked), L = await ready(w);
    send(w, { __tweeksLadd: 'pbFollow', id: FID, ts: TS }); await sleep(30);
    w.document.body.insertAdjacentHTML('beforeend', PANEL);
    L.syncPanel();
    const arr = await until(() => { L.syncPanel(); return txt(w, '[data-testid="aircraft-panel__airport-arrival-iata"]') === 'VLY' ? 1 : 0; }, 8000);
    check('no word from the page of its aircraft: the address on the panel used - its route, VLY in the box', !!arr && L.pb.hexOf.get(FID) === HEX, { iata: txt(w, '[data-testid="aircraft-panel__airport-arrival-iata"]'), hex: L.pb.hexOf.get(FID) });
    const sq = await until(() => filled(w).sq, 3000);
    check('... its squawk from its track too', sq === '7001', filled(w));
    w.close();
  }
  // ---- a blocked aircraft named in playback: its pictures asked for at once - not after the registers (slow here)
  {
    const asked = [], w = makeWin(PB_URL, asked, { slow: 4000 }), L = await ready(w);
    const id = FID + 7, hex = 'a0b1c2';
    L.store.setId(id, { id, hex, reg: 'N123AB', type: 'C25B', ladd: true, src: 'adsb.lol (playback)', matchedAt: Date.now() });
    const t0 = Date.now();
    send(w, { __tweeksLadd: 'pbFollow', id, ts: TS });
    const got = await until(() => w.__posted.find(p => p.d && p.d.__tweeksLadd === 'photosDone' && p.d.hex === hex && (p.d.photos || []).length), 3500);
    check('a LADD aircraft opened in playback: its pictures in within a second, the registers still unanswered', !!got && got.at - t0 < 1500, got && { ms: got.at - t0, n: got.d.photos.length });
    const ask = asked.find(a => /flight\/list\.json\?query=N123AB/.test(a.url));
    check('... asked for the moment it was opened', !!ask && ask.at - t0 < 600, ask && ask.at - t0);
    w.close();
  }
  // ---- an aircraft's page (G-FRGP, 15 Oct): its row Liverpool -> Private Site, FR24's playback panel of that flight
  // "To: -" - the panel is built when Play is pressed, after the page's observers were set up, and filled by FR24 later
  {
    const T = DAY0 + 13 * 3600;
    const html = `<!doctype html><html><head><title>G-FRGP</title></head><body><div id="cnt-aircraft-info"><div class="row"><label>MODE S</label> <span class="details" id="txt-mode-s">40762A</span></div></div>
      <table id="tbl-datatable"><tbody><tr class="data-row" data-timestamp="${T}"><td></td><td></td><td data-timestamp="${T}">15 Oct</td><td>Liverpool <a href="/data/airports/lpl">(LPL)</a></td><td class="tl-filled" title="Away from any listed airfield"> Private Site</td><td>(GFRGP)</td><td>—</td><td>—</td><td data-timestamp="${T + 240}">14:04</td><td>—</td><td><div class="state-block gray"></div></td><td>Scheduled</td><td><a class="btn btn-sm btn-playback" data-flight="42223bcf">Play</a></td></tr></tbody></table></body></html>`;
    const asked = [], w = makeWin('https://www.flightradar24.com/data/aircraft/g-frgp', asked, { html }), L = await ready(w);
    await sleep(800);
    w.location.hash = '#42223bcf';
    await sleep(500);
    w.document.body.insertAdjacentHTML('beforeend', '<div class="playback-player"><span id="txt-airport-origin">Liverpool <small>(LPL)</small></span><span id="txt-airport-dest"></span></div>');
    await sleep(200);
    w.document.getElementById('txt-airport-dest').textContent = '-';
    const to = await until(() => /Private Site/.test(w.document.getElementById('txt-airport-dest').textContent), 3000);
    check('an aircraft\'s page: FR24\'s playback of the row Liverpool -> Private Site says "Private Site" for To, not "-"', !!to, w.document.getElementById('txt-airport-dest').textContent);
    check('... FR24\'s own From left as it is', /Liverpool/.test(w.document.getElementById('txt-airport-origin').textContent));
    w.close();
  }
  // ---- (1.3.13) G-LFSA (a Tomahawk out of Liverpool), FR24 keeping no landing for its flights: rows "Scheduled", one with
  // FR24's own "Liverpool" for TO and its player's TO "-", one with "—" (no ADS-B flight of it known here at all), one in
  // the air now, one over a week old, one that never took off
  {
    const NOW = Math.round(Date.now() / 1000), LPL = [53.3336, -2.8497];
    const A = DAY0 + 9 * 3600 + 53 * 60, B = DAY0 - 86400 + 15 * 3600 + 53 * 60, C = NOW - 40 * 60, Dd = NOW - 9 * 86400, E = DAY0 + 14 * 3600;
    const pb = (fid, t0, end) => { const p = (t, lat, lon, ft, kts) => ({ latitude: lat, longitude: lon, altitude: { feet: ft, meters: 0 }, speed: { kts, kmh: 0, mph: 0 }, heading: 0, squawk: '7000', timestamp: t });
      return JSON.stringify({ result: { response: { data: { flight: { identification: { id: fid }, track: [p(t0, LPL[0], LPL[1], 0, 10), p(t0 + 120, 53.30, -2.85, 1200, 80), end(p)] } } } } }); };
    const tracks = {
      aa000001: pb('aa000001', A, p => p(A + 57 * 60, LPL[0], LPL[1], 0, 15)),
      aa000002: pb('aa000002', B, p => p(B + 52 * 60, LPL[0] + 0.004, LPL[1] + 0.006, 50, 40)),
      aa000003: pb('aa000003', C, p => p(NOW - 60, 53.178, -2.978, 2000, 95)),
      aa000004: pb('aa000004', Dd, p => p(Dd + 3000, LPL[0], LPL[1], 0, 10)),
      aa000005: pb('aa000005', E, p => p(E + 3000, LPL[0], LPL[1], 0, 10))
    };
    const answer = u => { const m = /common\/v1\/flight-playback\.json\?flightId=([0-9a-f]+)/.exec(u); return m && tracks[m[1]] ? [150, 200, tracks[m[1]]] : null; };
    const own = '<td>Liverpool <a href="/data/airports/lpl">(LPL)</a></td>', dashTd = '<td>—</td>';
    const row = (fid, t, atd, to, status) => `<tr class="data-row" data-timestamp="${t}"><td></td><td></td><td data-timestamp="${t}">day</td>${own}${to}<td>(GLFSA)</td><td>—</td><td>—</td><td${atd ? ` data-timestamp="${atd}"` : ''}>${atd ? 'hh:mm' : '—'}</td><td>—</td><td><div class="state-block gray"></div></td><td>${status}</td><td><a class="btn btn-sm btn-playback" data-flight="${fid}">Play</a></td></tr>`;
    const html = `<!doctype html><html><head><title>G-LFSA</title></head><body><div id="cnt-aircraft-info"><div class="row"><label>TYPE CODE</label> <span class="details">PA38</span></div><div class="row"><label>MODE S</label> <span class="details" id="txt-mode-s">406A1B</span></div></div>
      <table id="tbl-datatable"><tbody>${row('aa000003', C, C, dashTd, 'Scheduled')}${row('aa000005', E, 0, dashTd, 'Scheduled')}${row('aa000001', A, A, own, 'Scheduled')}${row('aa000002', B, B, dashTd, 'Scheduled')}${row('aa000004', Dd, Dd, dashTd, 'Scheduled')}</tbody></table></body></html>`;
    const asked = [], w = makeWin('https://www.flightradar24.com/data/aircraft/g-lfsa', asked, { html, answer }); await ready(w);
    const tr = fid => w.document.querySelector(`[data-flight="${fid}"]`).closest('tr'), cellTxt = (fid, i) => tr(fid).children[i].textContent.replace(/\s+/g, ' ').trim();
    await until(() => /Landed ~/.test(cellTxt('aa000002', 11)) && /Landed ~/.test(cellTxt('aa000001', 11)), 10000);
    await sleep(600);
    check('G-LFSA: a "Scheduled" row with "—" for TO and no ADS-B flight of it known: FR24\'s own track of it, down at Liverpool, ends it - "Liverpool (LPL)", "Landed ~", its time "~"', /Liverpool/.test(cellTxt('aa000002', 4)) && /LPL/.test(cellTxt('aa000002', 4)) && /^Landed ~\d/.test(cellTxt('aa000002', 11)) && /^~/.test(cellTxt('aa000002', 6)) && tr('aa000002').querySelector('.state-block.green'), [cellTxt('aa000002', 4), cellTxt('aa000002', 11), cellTxt('aa000002', 6)]);
    check('... one with FR24\'s own "Liverpool" for TO: "Landed ~" too, FR24\'s TO left as it is', /^Landed ~\d/.test(cellTxt('aa000001', 11)) && cellTxt('aa000001', 4) === 'Liverpool (LPL)' && !tr('aa000001').children[4].classList.contains('tl-filled'), [cellTxt('aa000001', 4), cellTxt('aa000001', 11)]);
    check('... one in the air now (FR24\'s track ending a minute ago at 2,000 ft by Hawarden): still "Scheduled", its TO still "—" - not the field it is passing', cellTxt('aa000003', 11) === 'Scheduled' && cellTxt('aa000003', 4) === '—', [cellTxt('aa000003', 4), cellTxt('aa000003', 11)]);
    const pbAsked = id => asked.filter(x => new RegExp('flight-playback\\.json\\?flightId=' + id + '&').test(x.url)).length;
    check('... FR24 asked once for each of those three; not for one over a week old (beyond a free account\'s playback), nor for one that never took off', pbAsked('aa000001') === 1 && pbAsked('aa000002') === 1 && pbAsked('aa000003') === 1 && pbAsked('aa000004') === 0 && pbAsked('aa000005') === 0 && cellTxt('aa000004', 11) === 'Scheduled', [1, 2, 3, 4, 5].map(i => pbAsked('aa00000' + i)));
    // FR24's player of the 18 Nov flight: its TO "-" while its row says Liverpool
    w.location.hash = '#aa000001';
    await sleep(300);
    w.document.body.insertAdjacentHTML('beforeend', '<div class="playback-player"><span id="txt-airport-origin">Liverpool <small>(LPL)</small></span><span id="txt-airport-dest"></span></div>');
    await sleep(100);
    w.document.getElementById('txt-airport-dest').textContent = '-';
    const to = await until(() => /Liverpool/.test(w.document.getElementById('txt-airport-dest').textContent), 3000);
    check('... its player\'s TO "-": the row\'s Liverpool (LPL), as the row has it', !!to && w.document.getElementById('txt-airport-dest').innerHTML === 'Liverpool <small>(LPL)</small>', w.document.getElementById('txt-airport-dest').innerHTML);
    const errs = w.__logs.filter(x => /^ERROR/.test(x));
    check('... no script errors', !errs.length, errs.slice(0, 3));
    w.close();
  }
  // ---- (1.4.0) the "On ground" of an airport from the monitor: the userscript's rows of it (type's name, its tag), and
  // FR24's box under its own list ("To get more than 1 hour...") taken away - the list and FR24's disclaimer left
  {
    const MON = 'https://143-47-224-210.sslip.io';
    const answer = u => {
      if (u.startsWith(MON + '/status')) return [5, 200, JSON.stringify({ v: 3, ver: 'test' })];
      if (u.startsWith(MON + '/actypes')) return [5, 200, JSON.stringify({ v: 1, at: 1, families: [{ code: 'BEECH', name: 'Beechcraft', types: [{ code: 'BE20', name: 'Beech B200' }] }] })];
      if (u.startsWith(MON + '/onground?ap=2002')) return [5, 200, JSON.stringify({ v: 1, ap: 2002, list: [{ fid: '3d4f0001', hex: '400abc', reg: 'G-CEGP', type: 'BE20', cs: 'MDI28F', from: '', land: DAY0, since: DAY0, last: DAY0, gnd: false, est: false }, { fid: '', hex: '', reg: '', type: '', cs: '' }] })];
      return null;
    };
    const asked = [], w = makeWin('https://www.flightradar24.com/53.40,-2.95/9', asked, { answer }); await ready(w);
    await until(() => asked.some(x => x.url.startsWith(MON + '/status')), 8000); await sleep(400);
    send(w, { __tweeksLadd: 'ogWant', rid: 'og-t', ap: 2002 });
    const got = await until(() => (w.__posted.find(p => p.d && p.d.__tweeksLadd === 'ogGot' && p.d.rid === 'og-t') || {}).d, 8000);
    const r0 = got && got.list && got.list[0];
    check('the monitor\'s "On ground" of an airport as the userscript gives it: each aircraft with its type\'s name, its landing; none with nothing to show', !!r0 && got.list.length === 1 && r0.reg === 'G-CEGP' && r0.ty === 'BE20' && /King Air|Beech/i.test(r0.name || '') && r0.t === DAY0 && r0.fid === '3d4f0001', got && got.list);
    w.document.body.insertAdjacentHTML('beforeend', '<div data-testid="airport-panel"><ul><li class="og-row">G-DRTC</li></ul><div class="og-box"><div><span>To get more than 1 hour of aircraft on ground history, please create a free account (2 hours) or upgrade to a Silver (7 days), Gold (30) or Business (90) plan.</span></div><button>7 days free trial | Learn more</button></div><p class="og-disc">Disclaimer: An aircraft will remain on the list until we can confirm that it has departed from the airport.</p></div>');
    const hid = await until(() => w.document.querySelector('.og-box').style.display === 'none', 6000);
    check('FR24\'s box under its "On ground" list (its hour, a trial): taken away - its list and disclaimer left', !!hid && w.document.querySelector('.og-row').style.display !== 'none' && w.document.querySelector('.og-disc').style.display !== 'none', w.document.querySelector('.og-box').getAttribute('style'));
    w.close();
  }
  // ---- (1.2.4) a flight's KML and CSV for FR24's own download buttons: made from FR24's track of it, in FR24's CSV columns
  {
    const asked = [], w = makeWin(PB_URL, asked); await ready(w);
    const got = rid => until(() => (w.__posted.find(p => p.d && p.d.__tweeksLadd === 'trackFileGot' && p.d.rid === rid) || {}).d, 8000);
    send(w, { __tweeksLadd: 'trackFile', rid: 'f1', fid: FID.toString(16), file: 'csv', ts: TS });
    const c = await got('f1'), lines = c && c.ok ? c.text.trim().split('\n') : [];
    check('KML/CSV: the CSV - FR24\'s columns, a line a point of FR24\'s track, its callsign, position, altitude, speed, heading', c && c.ok && /text\/csv/.test(c.type) && lines[0] === 'Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction' && lines.length === 6 && /^\d+,\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ,CAPTR33,"54\.292500,-1\.539000",0,120,270$/.test(lines[1]), lines.slice(0, 3));
    send(w, { __tweeksLadd: 'trackFile', rid: 'f2', fid: FID.toString(16), file: 'kml', ts: TS });
    const k = await got('f2');
    check('... the KML: its trail, altitudes in metres, said to be FR24\'s', k && k.ok && /google-earth\.kml/.test(k.type) && /<kml xmlns="http:\/\/www\.opengis\.net\/kml\/2\.2">/.test(k.text) && /Track from Flightradar24\./.test(k.text) && /-1\.600000,54\.300000,457/.test(k.text), k && k.text.slice(0, 300));
    send(w, { __tweeksLadd: 'trackFile', rid: 'f3', fid: 'abcdef12', file: 'csv', ts: TS });
    const n = await got('f3');
    check('... a flight with no track anywhere (FR24 none, the monitor none): not available', n && n.ok === false, n);
    w.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
