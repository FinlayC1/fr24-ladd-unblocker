// No padlocks (the BUILT userscript in jsdom): the figures FR24 shows a free account only behind a padlock come from the
// monitor and this browser's own sources in turn, and at once for an aircraft clicked. Checked:
//   - the view poll goes to the monitor every other time (the browser's own requests to the networks halved), and to the
//     other at once when one is refused
//   - an ordinary aircraft clicked: the monitor and the browser's own source asked together, the first answer drawn
//   - the padlocked KML / CSV buttons of FR24's own log rows: working files of the flight's public track (a subscriber's
//     working buttons left alone); the files in FR24's CSV columns and as a KML trail
// usage: node test/unit_padlocks.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 50; i++) { const v = await f(); if (v) return v; await sleep(50); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const MON = 'https://143-47-224-210.sslip.io', STANDBY = 'https://standby.example';
const hits = { near: 0, tel: 0, lolArea: 0, fiArea: 0, lolHex: 0, fiHex: 0 }, refuse = { fi: false, mon: false };
const nowJ = extra => JSON.stringify(Object.assign({ now: Date.now() }, extra));
const row = (hex, o) => Object.assign({ hex, flight: 'RYR1AB  ', r: 'EI-DEM', t: 'B738', lat: 53.4, lon: -2.9, alt_baro: 24000, gs: 420, track: 90, seen_pos: 1 }, o);
function answer(url) {
  if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS, 0];
  if (url.startsWith(MON + '/status')) return refuse.mon ? [503, '', 0] : [200, JSON.stringify({ v: 1, public: true }), 0];
  if (url.startsWith(STANDBY + '/status')) return [200, JSON.stringify({ v: 1, public: true }), 0];
  if (url.startsWith(MON + '/near')) { hits.near++; return [200, nowJ({ ac: [row('4ca0a1', { baro_rate: 1216, ias: 290, squawk: '2341' })] }), 0]; }
  if (url.startsWith(MON + '/tel')) { hits.tel++; return [200, nowJ({ ac: [row('4ca123', { baro_rate: -832, ias: 251, tas: 380, squawk: '7031', alt_geom: 24350 })] }), 60]; }
  if (url.startsWith(MON + '/report')) return [200, JSON.stringify({ ok: true }), 0];
  if (url.startsWith(MON + '/pbmatch')) { hits.pbmatch = (hits.pbmatch || 0) + 1; return refuse.pbmatch ? [404, '', 0] : [200, JSON.stringify({ v: 1, list: [[0x3c00cc01, '4ca9ab', 'EI-NAM', 'C68A', 'NAM1', 1, 'track', null]] }), 0]; }
  if (url.startsWith(MON + '/names')) { hits.names = (hits.names || 0) + 1; return [200, JSON.stringify({ list: [[0x3c00cc01, '4ca9ab', 'EI-NAM', 'C68A', 'NAM1', 1, 1790000000]] }), 0]; }
  if (url.startsWith(MON)) return [200, '{}', 0];
  if (/api\.adsb\.lol\/v2\/point\//.test(url)) { hits.lolArea++; return [200, nowJ({ ac: [row('4ca0a2')] }), 0]; }
  if (/opendata\.adsb\.fi\/api\/v[23]\/lat\//.test(url)) { hits.fiArea++; return refuse.fi ? [429, '', 0] : [200, nowJ({ aircraft: [row('4ca0a3')] }), 0]; }
  if (/api\.adsb\.lol\/v2\/hex\//.test(url)) { hits.lolHex++; return [200, nowJ({ ac: [row('4ca123', { baro_rate: -800, ias: 250 })] }), 1500]; }
  if (/opendata\.adsb\.fi\/api\/v2\/hex\//.test(url)) { hits.fiHex++; return [200, nowJ({ aircraft: [] }), 1500]; }
  return [404, '', 0];
}
const posted = [], reports = [], pbBodies = [];
function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53.40,-2.85/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text, wait] = answer(u); return sleep(wait).then(() => new Response(text, { status: st })); };
  win.GM_xmlhttpRequest = o => { if (String(o.url).startsWith(MON + '/pbmatch') && o.data) { try { pbBodies.push(JSON.parse(o.data)); } catch (e) { /* not json */ } } if (String(o.url).startsWith(MON + '/report') && o.data) { try { reports.push(JSON.parse(o.data)); } catch (e) { /* not json */ } } const [st, text, wait] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text, finalUrl: o.url }), 2 + wait); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = d => { posted.push(d); }; win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}
const send = (w, data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' }));

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  await L.monCheck(true).catch(() => null);
  check('the monitor answers (the default every copy connects to)', L.monUp());
  send(w, { __tweeksLadd: 'ready', v: 99, stats: {}, feedReady: false });
  send(w, { __tweeksLadd: 'view', n: 53.9, s: 52.9, w: -3.6, e: -2.1 });
  await sleep(300);

  // ---- the view poll: the monitor every other time
  for (const k of Object.keys(hits)) hits[k] = 0;
  for (let i = 0; i < 6; i++) { await until(async () => { await L.pollView(); return true; }, 3000); await sleep(30); }
  const own = hits.fiArea + hits.lolArea;
  check('the view polled six times: three from the monitor, three from this browser\'s own sources', hits.near === 3 && own === 3, hits);
  check('... the monitor\'s answer carries the padlocked figures (vertical speed, IAS, squawk) to the page', posted.some(p => p && p.__tweeksLadd === 'pubTel' && p.rows.some(r => r[2] === '4ca0a1' && r[6] === 1216 && r[7] === '2341' && r[9] === 290)));
  // (this browser's own source refusing: the monitor at once, the same poll)
  for (const k of Object.keys(hits)) hits[k] = 0; refuse.fi = true;
  for (let i = 0; i < 2; i++) await L.pollView();
  check('... a refusal moves on to the next at once (each poll still answered)', hits.near >= 1 && hits.near + hits.lolArea === 2, hits);
  refuse.fi = false;

  // ---- what this browser's own polls found: to the monitor (for every other browser), never what came from it
  reports.length = 0;
  await L.reportTel();
  const telRows = reports.filter(r => Array.isArray(r.tel)).flatMap(r => r.tel);
  check('this browser\'s own polls, reported to the monitor (its share for every other browser); the monitor\'s own rows not sent back', telRows.some(r => r[0] === '4ca0a3' || r[0] === '4ca0a2') && !telRows.some(r => r[0] === '4ca0a1') && telRows.every(r => r.length === 20), telRows.slice(0, 2));
  check('... sent once (the next report brings only what is new)', L.telOut.size === 0);
  // (a name found in a playback: to the monitor, kept there with that day; dropped here once it has it)
  send(w, { __tweeksLadd: 'feedReady', hdr: { 'fr24-device-id': 'web-thisbrowser', 'fr24-platform': 'web-1' } }); await sleep(50);
  reports.length = 0; const pbRow = [0x3c00bb01, '4ca777', 'EI-PBK', 'B738', 'RYR77', 0, Math.round(Date.now() / 1000) - 86400];
  L.pbOut.set(pbRow[0], pbRow);
  await L.reportToMonitor();
  check('the shared monitor is never given FR24\'s device id of this browser (only a monitor of the user\'s own, with its secret)', reports.length > 0 && !reports.some(r => r.hdr || r.ua), reports.map(r => Object.keys(r)));
  check('a name found in a playback: reported to the monitor, then let go here', reports.some(r => Array.isArray(r.pbIds) && r.pbIds.some(x => x[0] === pbRow[0] && x[1] === '4ca777')) && !L.pbOut.has(pbRow[0]), reports.map(r => Object.keys(r)));

  // ---- the monitor's airspeeds (worked out from the weather model over the US) kept when this browser's own poll of
  // adsb.lol, a few seconds newer, has none - not blanked every other poll
  { const t = Date.now(), m = L.normalizeReadsb({ hex: '407c02', flight: 'JCO55', lat: 44.04, lon: -98.04, alt_baro: 41000, gs: 595, track: 57, tas: 514, ias: 269, mach: 0.897, oat: -56, wd: 270, ws: 100, seen_pos: 3, wx: 1 }, 'monitor', t);
    const own = L.normalizeReadsb({ hex: '407c02', flight: 'JCO55', lat: 44.05, lon: -98.02, alt_baro: 41000, gs: 596, track: 57, seen_pos: 0 }, 'adsb.lol', t);
    L.noteCands([m]); L.noteCands([own]);
    const c = L.areaCache.get('407c02');
    check('the monitor\'s airspeeds, Mach, wind and temperature kept through this browser\'s own newer poll that has none', c === own && c.tas === 514 && c.ias === 269 && c.mach === 0.897 && c.oat === -56 && c.wd === 270 && c.ws === 100 && c.gs === 596, { tas: c.tas, gs: c.gs });
    check('... still marked as the weather model\'s estimate (shown with "≈"), here and in what the panel reads', c.wx === true && L.telemOf(c).wx === true);
    L.telOut.clear(); L.noteTelOut([own]); const back = L.telOut.get('407c02');
    check('... and never reported back to the monitor as this browser\'s own figures', !!back && back.slice(9, 15).every(v => v == null) && back[4] === 596, back);
    const eu = L.normalizeReadsb({ hex: '4ca0e5', lat: 53.4, lon: -6.2, alt_baro: 37000, gs: 450, track: 90, tas: 455, ias: 260, mach: 0.79, oat: -50, wd: 250, ws: 40, seen_pos: 0 }, 'adsb.lol', t);
    L.noteCands([eu]); L.noteTelOut([eu]);
    check('... an aircraft\'s own figures: not marked, and reported', eu.wx === false && L.telOut.get('4ca0e5')[10] === 455);
    const later = L.normalizeReadsb({ hex: '407c02', lat: 44.3, lon: -97.5, alt_baro: 41000, gs: 596, track: 57, seen_pos: 0 }, 'adsb.lol', t + 180000);
    L.noteCands([later]);
    check('... for two minutes at most (never figures gone stale)', !Number.isFinite(L.areaCache.get('407c02').tas)); }
  // ---- an ordinary aircraft clicked: both asked, the first answer drawn
  for (const k of Object.keys(hits)) hits[k] = 0; posted.length = 0;
  const id = 0x3c00aa01, t0 = Date.now();
  send(w, { __tweeksLadd: 'follow', id });
  send(w, { __tweeksLadd: 'aircraftInfo', id, hex: '4ca123', reg: 'EI-DEM', type: 'B738', cs: 'RYR1AB' });
  const tel = await until(() => posted.find(p => p && p.__tweeksLadd === 'telem' && p.id === id), 3000);
  const dt = Date.now() - t0;
  check('a click: the monitor and this browser\'s source asked together, the faster answer drawn (well before the slower one)', !!tel && tel.t.vr === -832 && tel.t.ias === 251 && hits.tel >= 1 && dt < 1200, { dt, hits, t: tel && tel.t });
  check('... this browser\'s own lookup sent too (behind adsb.lol\'s two-second gate)', await until(() => hits.lolHex >= 1, 5000), hits);

  // ---- KML / CSV
  const d = w.document, T = Math.round(Date.now() / 1000) - 86400;
  d.body.insertAdjacentHTML('beforeend', `<table id="tbl-datatable"><tbody>
    <tr class="data-row" data-timestamp="${T}"><td></td><td></td><td></td><td></td><td></td><td>RYR8SF</td><td></td><td data-timestamp="${T + 1500}"></td><td data-timestamp="${T + 2220}"></td><td data-timestamp="${T + 5400}"></td><td></td><td data-timestamp="${T + 9180}">Landed 23:33</td><td><a class="btn btn-sm btn-table-action premium-content" href="/premium/"><i class="icon-fr24-lock"></i> KML</a> <a class="btn btn-sm btn-table-action"><i class="fa fa-lock"></i> CSV</a> <a class="btn btn-sm btn-playback" data-flight="421ba88c">Play</a></td></tr>
    <tr class="data-row" data-timestamp="${T}"><td></td><td></td><td></td><td></td><td></td><td>RYR9XX</td><td></td><td></td><td></td><td></td><td></td><td></td><td><a class="btn btn-sm" href="/download/kml/1">KML</a> <a class="btn btn-sm" href="/download/csv/1">CSV</a></td></tr>
  </tbody></table>`);
  const tb = d.querySelector('#tbl-datatable tbody'), n = L.unlockExports(tb), rows = tb.querySelectorAll('tr');
  check('FR24\'s padlocked KML / CSV of a row: working buttons, the padlock gone', n === 2 && rows[0].querySelectorAll('a.tl-export').length === 2 && !rows[0].querySelector('[class*="lock"]') && !/premium/.test(rows[0].innerHTML), rows[0].innerHTML.slice(0, 300));
  check('... a subscriber\'s working buttons left alone', !rows[1].querySelector('a.tl-export') && rows[1].querySelectorAll('a[href^="/download/"]').length === 2);
  check('... and a second look changes nothing', L.unlockExports(tb) === 0);
  const win = L.rowWindow(rows[0]);
  check('the flight\'s time from its row: take-off (ATD) to landing', win.off === T + 2220 && win.on === T + 9180, win);
  const pts = [{ t: T + 2230, lat: 53.43, lon: 14.9, alt: 'ground', gnd: true, gs: 140, trk: 268 }, { t: T + 2300, lat: 53.44, lon: 14.8, alt: 2500, gs: 180, trk: 270 }, { t: T + 9100, lat: 53.33, lon: -2.84, alt: 300, gs: 135, trk: 266 }];
  const csv = L.exportFile('CSV', pts, 'RYR8SF', '421ba88c'), lines = csv.text.trim().split('\n');
  check('CSV: FR24\'s columns, one line a report, the position quoted, on the ground 0 ft', csv.name === 'RYR8SF_421ba88c.csv' && lines[0] === 'Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction' && lines.length === 4 && lines[1].startsWith(`${T + 2230},`) && lines[1].includes(',RYR8SF,"53.430000,14.900000",0,140,268') && lines[2].includes(',2500,180,270'), lines.slice(0, 3));
  const kml = L.exportFile('KML', pts, 'RYR8SF', '421ba88c'), doc = new w.DOMParser().parseFromString(kml.text, 'application/xml');
  const coords = (doc.getElementsByTagName('coordinates')[0] || {}).textContent || '';
  check('KML: well-formed, the trail in metres above sea level, the data\'s licence named', !doc.getElementsByTagName('parsererror').length && coords.split(' ').length === 3 && coords.split(' ')[1] === '14.800000,53.440000,762' && /Open Database License/.test(kml.text) && kml.name.endsWith('.kml'), coords);

  // ---- FR24's playback: its unnamed flights named from the monitor's archive in one request
  { const ts = Math.round(Date.now() / 1000) - 3 * 86400, pid = 0x3c00cc01;
    L.pb.flights.set(pid, { id: pid, ts, lat: 53.3, lon: -2.8, alt: 9000, spd: 300, trk: 90, gnd: false, type: 'C68A' });
    L.pb.flights.set(pid + 1, { id: pid + 1, ts, lat: 53.4, lon: -2.9, alt: 9000, spd: 300, trk: 90, gnd: false, type: 'B738' });
    const n = await L.pbFromMonitor(ts), rec = L.pb.named.get(pid), body = pbBodies[0] || {};
    check('playback: unnamed flights named by the monitor at once (one request with the moment and their positions and types, unknown ones left)', n === 1 && !!rec && rec.hex === '4ca9ab' && rec.reg === 'EI-NAM' && rec.ladd === true && rec.src === 'monitor (its track)' && !L.pb.named.has(pid + 1) && hits.pbmatch === 1 && !hits.names && body.t === ts && Array.isArray(body.f) && body.f.length === 2 && body.f.some(f => f[0] === pid && f[1] === 53.3 && f[2] === -2.8 && f[3] === 9000 && f[4] === 'C68A' && f[5] === 0), { n, rec, body, hits: { pbmatch: hits.pbmatch, names: hits.names } });
    const again = await L.pbFromMonitor(ts);
    check('... not asked again for the same flights', again === 0 && hits.pbmatch === 1);
    // (an older monitor without /pbmatch: its archive of names asked instead)
    L.pb.named.delete(pid); L.pb.monAsked.clear(); refuse.pbmatch = true;
    const n2 = await L.pbFromMonitor(ts);
    check('... a monitor without /pbmatch: the names it gave asked instead, and from then on', n2 === 1 && hits.pbmatch === 2 && hits.names === 1 && L.pb.monOld === true, { n2, hits: { pbmatch: hits.pbmatch, names: hits.names } });
    refuse.pbmatch = false; L.pb.monOld = false; }
  // ---- the shared monitor gone: the next one in the list (a standby server), and back to the first when it answers
  L.MON_DEFAULTS.push(STANDBY); refuse.mon = true;
  await L.monCheck(true).catch(() => null);
  check('the shared monitor not answering: the standby in its place', L.monUp() && L.monBase === STANDBY, L.monBase);
  refuse.mon = false; await L.monCheck(true).catch(() => null);
  check('... kept while it answers (the one in use asked first)', L.monUp() && L.monBase === STANDBY, L.monBase);
  refuse.mon = false; L.MON_DEFAULTS.pop(); await L.monCheck(true).catch(() => null);
  check('... and the first again when the list has only it', L.monUp() && L.monBase === MON, L.monBase);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  harness error ' + (e && e.stack || e)); process.exit(1); });
