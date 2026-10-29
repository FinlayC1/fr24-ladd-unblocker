// The two networks' trace files read for what each answer is (22.31.9; the BUILT userscript in jsdom). N73VR (Falcon 7X,
// LADD): its log page had the flight on screen but not the night's crossing New Haven - Luton before it, and gaps; adsb.lol
// now puts a proof-of-work verification page ("Verifying connection") in front of browsers and servers that ask too much,
// Cloudflare one in front of airplanes.live's - each was a failed request at best. Here N73VR's real day of 21 Oct (from
// adsb.lol's archive: Seattle - Cincinnati - Morristown, Morristown - New Haven), moved to two days ago, and today's
// crossing to Luton and its departure from there - airplanes.live having them, adsb.lol showing its verification page:
//   - each kind of answer told apart: the file, no file, a verification page (adsb.lol's, Cloudflare's; 403 or 200), a
//     refusal to slow down, a file cut short, another aircraft's file, a server error
//   - a refusal to slow down waited out; a verification page not asked again for ten minutes (no hammering), and said - in
//     the sources pop-over and on the log page, with the site to open
//   - a day adsb.lol walls and airplanes.live has: its flights in the log, marked part of it (read again), the reason kept;
//     a day neither answers about: never a day without flights; both "no file": a day without flights
//   - in the background (adsb.lol alone): airplanes.live never asked; nothing taken for a day without flights
//   - today's files: both networks' for the aircraft looked at - the crossing to Luton in today's flights
//   - "Recent N73VR flights": New Haven - Luton (today) and Morristown - New Haven (two days ago) both listed
// usage: node test/unit_netfetch.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const dayStr = t => { const d = new Date(t); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };
const HEX = 'a9ca9d', REG = 'N73VR';
const dd0 = k => dayStr(Date.now() - k * 864e5);

// ---- the answers --------------------------------------------------------------------------------------------------
// (adsb.lol's verification page, as it looks: a proof-of-work challenge; Cloudflare's "Just a moment")
const POW = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8"><title>Verification</title><style>body{}</style></head><body><div class="card"><h1>Verifying connection</h1><p id="status">Solving security challenge</p></div><script>function sha256(d){return d}/* proof of work */</script></body></html>';
const CF = '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body><noscript>Enable JavaScript and cookies to continue</noscript><script>(function(){window._cf_chl_opt={}})();</script></body></html>';
const D2 = dayStr(Date.now() - 2 * 864e5), D2S = Date.parse(D2.replace(/\//g, '-') + 'T00:00:00Z') / 1000;
const REAL = Object.assign(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/traces/a9ca9d-2026-10-21.json.gz'))).toString()), { timestamp: D2S });
// today's (airplanes.live's live file - its last 24 hours): on the ground at New Haven, across to Luton, on the ground there,
// and off again westbound - at cruise now
function todayTrace(ap) {
  const now = Math.floor(Date.now() / 1000), base = now - 10 * 3600, rows = [];
  const hvn = ap('KHVN'), ltn = ap('EGGW');
  const at = (t, lat, lon, alt, gs, trk, vr, cs) => rows.push([t - base, lat, lon, alt, gs, trk, 0, vr, cs ? { flight: cs + '   ', squawk: '5160' } : null, 'adsb_icao', alt === 'ground' ? null : alt + 500, null, null, null]);
  let t = now - 9.5 * 3600;
  for (let i = 0; i < 12; i++, t += 120) at(t, hvn.lat + 0.001 * i, hvn.lon, 'ground', i < 8 ? 0 : 12, 20, null, i === 0 ? 'N73VR' : '');
  const legT = 6.3 * 3600, t1 = t;
  for (; t <= t1 + legT; t += 60) {
    const f = (t - t1) / legT, lat = hvn.lat + (ltn.lat - hvn.lat) * f + 9 * Math.sin(Math.PI * f), lon = hvn.lon + (ltn.lon - hvn.lon) * f;
    const alt = f < 0.06 ? Math.round(41000 * f / 0.06) : f > 0.92 ? Math.max(0, Math.round(41000 * (1 - f) / 0.08)) : 41000;
    if (alt < 300 && f > 0.5) break;
    at(t, lat, lon, alt, alt < 10000 ? 180 + alt / 100 : 480, 60, f < 0.06 ? 2500 : f > 0.92 ? -1800 : 0);
  }
  for (let i = 0; i < 20; i++, t += 120) at(t, ltn.lat, ltn.lon - 0.002 * i, 'ground', i < 4 ? 30 - 7 * i : 0, 260, null);
  for (let i = 0; i < 6; i++, t += 120) at(t, ltn.lat, ltn.lon - 0.01, 'ground', i < 5 ? 0 : 15, 260, null);
  const t2 = t;
  for (; t < now - 60; t += 60) { const k = (t - t2) / 3600; at(t, ltn.lat + 1.5 * k, ltn.lon - 5 * k, Math.min(40000, Math.round(1000 + 2500 * (t - t2) / 60)), 460, 293, 2000); }
  return { icao: HEX, r: REG, t: 'FA7X', dbFlags: 8, timestamp: base, trace: rows };
}
let TODAY = null;
const asked = [];
// per network: what it answers - { ['<hex>|<day or today>' or day or 'today']: [status, body] }, else the default
const NET = { lol: { def: [404, ''] }, apl: { def: [404, ''] }, tat: { def: [404, ''] } };
let TATWORLD = null;   // (TheAirTraffic's whole-world file, when it answers one)
const MON = 'https://143-47-224-210.sslip.io';
// (the monitor, when on: /status, /hist - MONH.hist(hex) -> its answer for the aircraft - and /trace - MONH.trace(hex))
const MONH = { on: false, hist: null, trace: null, slow: false, arc: null, idx: null, world: 0 };
function answer(url) {
  if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
  if (url.startsWith(MON)) {
    if (!MONH.on) return [404, ''];
    if (url.startsWith(MON + '/status')) return [200, JSON.stringify({ v: 3, since: Date.now() - 3600e3, public: true, ver: '22.31.11', archive: Object.assign({ on: 220, have: 39, days: 39, running: '' }, MONH.idx != null ? { idx: MONH.idx } : {}, MONH.world ? { world: { on: 366, v: 1, days: MONH.world } } : {}) })];
    let mm = url.match(/\/hist\?hex=([0-9a-f,]+)(?:&since=([0-9-]+))?/); if (mm) { asked.push(['mon', 'hist', mm[1], mm[2] || '']); return [200, JSON.stringify({ hv: Number((SRC.match(/const HIST_V = (\d+);/) || [])[1]), list: mm[1].split(',').map(h => Object.assign({ hex: h }, MONH.hist ? MONH.hist(h) : { days: {}, legs: [] })) })]; }
    mm = url.match(/\/trace\?hex=([0-9a-f]{6})/); if (mm) { asked.push(['mon', 'trace', mm[1]]); const t = MONH.trace && MONH.trace(mm[1]); return t ? [200, JSON.stringify(t)] : [404, '']; }
    // (adsb.lol's archive through the monitor: MONH.arc(hex, 'YYYY-MM-DD') -> [status, body]; no index of any day without it)
    mm = url.match(/\/atrace\?hex=([0-9a-f]{6})&day=(\d{4}-\d\d-\d\d)$/); if (mm) { asked.push(['mon', 'atrace', mm[1], mm[2]]); return MONH.arc ? MONH.arc(mm[1], mm[2]) : [409, '{"noindex":1}']; }
    return [404, ''];
  }
  if (url === 'https://globe.theairtraffic.com/data/aircraft.json') { asked.push(['tat', 'world']); return TATWORLD ? [200, JSON.stringify(TATWORLD)] : [404, '']; }
  const m = url.match(/^https:\/\/(adsb\.lol|globe\.airplanes\.live|globe\.theairtraffic\.com)\/(?:globe_history\/([\d/]+)|data)\/traces\/(\w\w)\/trace_full_(\w{6})\.json$/);
  if (m) {
    const net = m[1] === 'adsb.lol' ? 'lol' : m[1] === 'globe.airplanes.live' ? 'apl' : 'tat', day = m[2] || 'today';
    asked.push([net, day, m[4]]);
    if (m[3] !== m[4].slice(-2)) return [500, 'wrong folder'];
    const a = NET[net][m[4] + '|' + day] || NET[net][day] || NET[net].def;
    return typeof a === 'function' ? a() : a;
  }
  return [404, ''];
}
const posted = [];
function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/51.8,-0.4/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
  // (the monitor busy - MONH.slow: no answer in time, as GM's own timeout says)
  win.GM_xmlhttpRequest = o => { if (MONH.slow && o.url.startsWith(MON)) { setTimeout(() => o.ontimeout && o.ontimeout(), 2); return { abort() {} }; } const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = d => posted.push(d); win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  await L.monCheck(true).catch(() => null);
  check('(airports loaded; the trace reader in the build)', L.engine.airports.length > 5000 && typeof L.readTrace === 'function' && typeof L.classifyTrace === 'function');
  const ap = icao => L.engine.byIcao(icao);
  TODAY = todayTrace(ap);
  const json = j => JSON.stringify(j);

  // ---- 1. each kind of answer told apart -------------------------------------------------------------------------
  const C = (st, body, hex) => L.classifyTrace(hex || HEX, st, body);
  // (pages that say "verify" or "challenge" but are no verification page: a refusal, said as one)
  const notWall = [C(403, '<html><head><title>403 Forbidden</title></head><body>Please verify the address</body></html>'), C(200, '<!doctype html><html><head><title>airplanes.live</title></head><body>challenge coins for sale</body></html>')];
  check('a refusal or a site\'s own page that mentions "verify" or "challenge": not taken for a verification page', notWall.every(r => r.state === 'err') && /refused \(HTTP 403, "403 Forbidden"\)/.test(notWall[0].err), notWall);
  const kinds = {
    file: C(200, json(REAL)).state, none: C(404, '').state, powWall: C(403, POW).state, cfWall: C(403, CF).state, wall200: C(200, POW).state,
    rate: C(429, '').state, cut: C(200, json(REAL).slice(0, 5000)).state, other: C(200, json(Object.assign({}, REAL, { icao: 'abcdef' }))).state,
    server: C(502, '<html><title>Bad gateway</title></html>').state, refused: C(403, '').state, notTrace: C(200, '{"ac":[]}').state, empty: C(200, '').state
  };
  check('answers told apart: the file; no file; a verification page (adsb.lol\'s, Cloudflare\'s - 403 or 200); a refusal to slow down; failures', kinds.file === 'ok' && kinds.none === 'none' && kinds.powWall === 'wall' && kinds.cfWall === 'wall' && kinds.wall200 === 'wall' && kinds.rate === 'rate' && ['cut', 'other', 'server', 'refused', 'notTrace', 'empty'].every(k => kinds[k] === 'err'), kinds);
  check('... and why, for a failure (a file cut short, another aircraft\'s)', /cut short/.test(C(200, json(REAL).slice(0, 5000)).err) && /another aircraft/.test(C(200, json(Object.assign({}, REAL, { icao: 'abcdef' }))).err));

  // ---- 2. a refusal to slow down: waited out; then the file ---------------------------------------------------------
  { let n = 0; NET.lol['2026/01/02'] = () => (++n < 2 ? [429, ''] : [200, json(Object.assign({}, REAL, { timestamp: 1767312000 }))]);
    const t0 = Date.now(), r = await L.readTrace('lol', HEX, '2026/01/02', { priority: true });
    check('a refusal to slow down (429): waited out, asked again - the file', r.state === 'ok' && r.pts.length > 1000 && n === 2 && Date.now() - t0 >= 3500, { state: r.state, n, ms: Date.now() - t0 });
    delete NET.lol['2026/01/02']; }

  // ---- 3. a verification page: said, not asked again for ten minutes ------------------------------------------------
  NET.lol.def = [403, POW];
  asked.length = 0;
  { const a = await L.readTrace('lol', HEX, '2026/01/03', {}), b = await L.readTrace('lol', HEX, '2026/01/04', {});
    const lolAsked = asked.filter(x => x[0] === 'lol').length;
    check('adsb.lol\'s verification page: read as one - said with its status and title', a.state === 'wall' && a.err === 'verification page (HTTP 403, "Verification")', a.err);
    const diag = posted.filter(d => d && d.__tweeksLadd === 'netDiag').pop();
    check('... what this browser was sent handed to the page for the console (status, title, its first words; no request made again)', !!diag && diag.net.lol.bad.status === 403 && diag.net.lol.bad.title === 'Verification' && /Verifying connection/.test(diag.net.lol.bad.text) && /adsb\.lol\/globe_history\/2026\/01\/03\//.test(diag.net.lol.bad.url), diag && diag.net.lol.bad);
    check('... and not asked again for ten minutes: the next day answered from that, no request', b.state === 'wall' && lolAsked === 1 && L.netState.lol.wallUntil > Date.now() + 9 * 60000, { lolAsked, until: L.netState.lol.wallUntil - Date.now() });
    const src = L.sourcesHtml();
    check('... said in the sources pop-over: "verification page", with the site to open', /adsb\.lol \(flight logs[^<]*<\/span> <span style="color:#e05252">verification page<\/span>/.test(src) && /href="https:\/\/adsb\.lol\/"/.test(src), (src.match(/adsb\.lol \(flight logs.{0,300}/) || [])[0]); }

  // ---- 4. the log, looked at: adsb.lol walling, airplanes.live answering ----------------------------------------------
  // two days ago: airplanes.live has N73VR's real day; yesterday: airplanes.live has no file (adsb.lol walls: not known);
  // three days ago: airplanes.live fails (502): not known
  const D1 = dayStr(Date.now() - 864e5), D3 = dayStr(Date.now() - 3 * 864e5);
  NET.apl[HEX + '|' + D2] = [200, json(REAL)]; NET.apl[HEX + '|' + D3] = [502, ''];
  NET.apl[HEX + '|today'] = [200, json(TODAY)];
  L.store.mergeHex(HEX, { reg: REG, type: 'FA7X', ladd: true });
  asked.length = 0;
  const h = await L.loadHistory(HEX, 5, null, { front: true });
  const on = d => (h.legs || []).filter(l => l.day === d), code = a => a ? a.code : '?';
  const d2 = on(D2).map(l => code(l.from) + '-' + code(l.to));
  check('two days ago - adsb.lol walling, airplanes.live with its file: the day\'s flights in the log (Morristown - New Haven among them)', d2.includes('MMU-HVN') && d2.some(x => /LUK-MMU|CVG-MMU/.test(x)), d2);
  check('... marked part of it (adsb.lol did not answer: read again later), the reason kept', h.days[D2] === 'p' && /adsb\.lol: .*verification page/.test(h.err[D2] || ''), { mark: h.days[D2], err: h.err[D2] });
  check('yesterday - adsb.lol walling, no file at airplanes.live: not known - never a day without flights; asked again later', !h.days[D1] && !!h.miss[D1] && /verification page/.test(h.err[D1] || ''), { mark: h.days[D1], miss: !!h.miss[D1] });
  check('three days ago - neither answering (wall, 502): not known either', !h.days[D3] && !!h.miss[D3] && /airplanes\.live: server error \(HTTP 502\)/.test(h.err[D3] || ''), h.err[D3]);
  check('... adsb.lol asked at most once in all of it (its verification page remembered)', asked.filter(x => x[0] === 'lol').length <= 1, asked.filter(x => x[0] === 'lol'));
  const gaps = L.logGaps(HEX);
  check('the log page says it: adsb.lol showing this browser a verification page, with the site to open; the days not fully read', /adsb\.lol is showing this browser a verification page/.test(gaps) && /href="https:\/\/adsb\.lol\/"/.test(gaps) && /days? not read yet/.test(gaps), gaps);
  check('... on a line of its own under the summary (a block that wraps - the footer no longer widens FR24\'s table)', /^<div class="tl-foot-note">[\s\S]*<\/div>$/.test(gaps) && /tr\.tl-foot td\{[^}]*white-space:normal!important/.test(SRC), gaps.slice(0, 80));

  // ---- 5. both networks answering "no file": a day without flights ----------------------------------------------------
  { const hx = 'a9ca9e'; NET.lol.def = [404, '']; L.netState.lol.wallUntil = 0;
    L.store.mergeHex(hx, { reg: 'N73VS', type: 'FA7X', ladd: true });
    const h2 = await L.loadHistory(hx, 3, null, { front: true });
    check('both networks with no file of a day: a day without flights (each marked "both")', [1, 2, 3].every(k => h2.days[dayStr(Date.now() - k * 864e5)] === 'b') && !(h2.legs || []).length, h2.days); }

  // ---- 6. the background: adsb.lol alone; nothing taken for a day without flights -----------------------------------
  { const hx = 'a9ca9f'; NET.lol.def = [403, CF]; L.netState.lol.wallUntil = 0; asked.length = 0;
    L.store.mergeHex(hx, { reg: 'N73VT', type: 'FA7X', ladd: true });
    const h3 = await L.loadHistory(hx, 6, null, { bg: true });
    check('the background, adsb.lol walling: airplanes.live never asked; no day taken for one without flights; adsb.lol asked once', !asked.some(x => x[0] === 'apl') && !Object.keys(h3.days).length && Object.keys(h3.miss).length === 6 && asked.filter(x => x[0] === 'lol').length === 1, { asked: asked.length, days: h3.days }); }

  // ---- 7. today: both networks' files for the aircraft looked at ------------------------------------------------------
  NET.lol.def = [403, POW]; L.netState.lol.wallUntil = 0; asked.length = 0;
  const td = await L.loadToday(HEX, 60000, { priority: true });
  const tsum = (td.sums || []).map(l => code(l.from) + '-' + code(l.to) + (l.ended ? '' : ' (under way)'));
  check('today, adsb.lol walling: airplanes.live\'s file read - the night\'s crossing New Haven - Luton, landed; the flight off Luton under way', tsum.includes('HVN-LTN') && tsum.some(x => /^LTN-.* \(under way\)$/.test(x)), tsum);
  check('... both networks asked (the aircraft looked at), what each said kept', asked.some(x => x[0] === 'lol' && x[1] === 'today') && asked.some(x => x[0] === 'apl' && x[1] === 'today') && td.nets.some(s => /adsb\.lol: .*verification/.test(s)) && td.nets.includes('airplanes.live: ok'), td.nets);
  { asked.length = 0; await L.loadToday(HEX, 60000, { priority: true });
    check('... read again within the minute: from memory, no request', asked.length === 0, asked); }
  { L.todayCache.delete('a9caa0'); NET.lol.def = [404, '']; L.netState.lol.wallUntil = 0; asked.length = 0;
    await L.loadToday('a9caa0', 60000, { bg: true }).catch(() => null);
    check('today in the background: adsb.lol alone', asked.length === 1 && asked[0][0] === 'lol', asked); }

  // ---- 8. "Recent N73VR flights": today's crossing and the days before ----------------------------------------------
  NET.lol.def = [403, POW]; L.netState.lol.wallUntil = 0;
  L.todayCache.delete(HEX);
  posted.length = 0;
  w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'needHist', reg: REG }, source: w }));
  const iata = a => a && a.code && a.code.iata;
  const rowsOf = p => p.data.map(e => (iata(e.airport.origin) || 'N/A') + '-' + (iata(e.airport.destination) || 'N/A'));
  const got = await until(() => { const p = posted.filter(d => d && d.__tweeksLadd === 'hist' && d.reg === REG && Array.isArray(d.data)).pop(); return p && rowsOf(p).includes('HVN-LTN') && rowsOf(p).includes('MMU-HVN') ? p : null; }, 15000);
  const last = posted.filter(d => d && d.__tweeksLadd === 'hist' && d.reg === REG && Array.isArray(d.data)).pop();
  check('"Recent N73VR flights": New Haven - Luton (today, before the flight on screen) and Morristown - New Haven (two days ago) both listed', !!got, last && rowsOf(last));
  // ---- 9. walled from both sites, as the user's browser is (N613BH): the monitor's days - from adsb.lol's archives - are the
  // log, the days without flights included; today's flights from the monitor's own positions
  { const HX = 'a7fa04', REG2 = 'N613BH', n = 12, dd = k => dayStr(Date.now() - k * 864e5);
    NET.lol.def = [403, POW]; NET.apl.def = [403, CF]; L.netState.lol.wallUntil = 0; L.netState.apl.wallUntil = 0;
    // (each site has shown this browser its page once already, as the user's had)
    await L.readTrace('lol', 'abcdef', dd(30), {}); await L.readTrace('apl', 'abcdef', dd(30), {});
    const wpi = L.engine.byIcao('KHPN'), sju = L.engine.byIcao('TJSJ'), D5 = dd(5), t5 = Date.parse(D5.replace(/\//g, '-') + 'T14:00:00Z') / 1000;
    const leg5 = [{ day: D5, tStart: t5, tEnd: t5 + 13000, from: { id: wpi.id, code: 'HPN', conf: 'ground' }, to: { id: sju.id, code: 'SJU', conf: 'ground' }, ended: true, startedOnGround: true, cs: 'TWY318', maxAlt: 41000 }];
    MONH.hist = () => ({ days: Object.fromEntries(Array.from({ length: n }, (_, i) => [dd(i + 1), dd(i + 1) === D5 ? 1 : 0])), legs: leg5, part: [], lo: Array.from({ length: n }, (_, i) => dd(i + 1)) });
    MONH.trace = hex => hex === HX ? Object.assign({}, TODAY, { icao: HX, r: REG2, t: 'F900', src: 'monitor' }) : null;
    MONH.on = true; await L.monCheck(true); await sleep(50);
    L.store.mergeHex(HX, { reg: REG2, type: 'F900', ladd: true });
    asked.length = 0;
    const h9 = await L.loadHistory(HX, n, null, { front: true });
    const marks = Array.from({ length: n }, (_, i) => h9.days[dd(i + 1)]);
    check('walled from both sites: the monitor\'s days are the log - its flight (White Plains - San Juan) and its days without flights, every day marked', marks.every(m => m === 'l') && (h9.legs || []).filter(l => l.day === D5).length === 1, marks);
    check('... nothing asked of the walled sites for them (airplanes.live walled within the hour: not read again now)', !asked.some(a => a[0] === 'lol' || a[0] === 'apl') && asked.some(a => a[0] === 'mon' && a[1] === 'hist'), asked);
    const g9 = L.logGaps(HX);
    // (1.0.1: and no verification page to act on either - it costs this log nothing, the monitor gave every day)
    check('... the log page no longer says hundreds of days not read: no "not read yet" for days the monitor gave, no verification page to act on', !/not read yet/.test(g9) && !/verification page/.test(g9) && /the monitor has 39 of the last 220 days/.test(g9), g9);
    L.todayCache.delete(HX); asked.length = 0;
    const td9 = await L.loadToday(HX, 60000, { priority: true });
    const s9 = (td9.sums || []).map(l => (l.from ? l.from.code : '?') + '-' + (l.to ? l.to.code : '?'));
    check('today, walled from both sites: the monitor\'s positions read - the night\'s crossing in today\'s flights', s9.includes('HVN-LTN') && asked.some(a => a[0] === 'mon' && a[1] === 'trace') && td9.nets.some(x => /the monitor: ok/.test(x)), { s9, nets: td9.nets });
    // (a military aircraft: the monitor asked for its log too)
    L.store.mergeHex('ae0cf1', { reg: '10-0001', type: 'C17', mil: true }); asked.length = 0;
    await L.loadHistory('ae0cf1', 3, null, { front: true });
    check('a military aircraft: its log asked of the monitor too', asked.some(a => a[0] === 'mon' && a[1] === 'hist' && a[2].includes('ae0cf1')), asked);
    // (an aircraft not blocked, the monitor's answer for it not asked in the background: adsb.lol's file failing is all)
    L.todayCache.delete('4ca9e9'); L.store.mergeHex('4ca9e9', { reg: 'EI-PLN' }); asked.length = 0; L.netState.lol.wallUntil = 0;
    await L.loadToday('4ca9e9', 60000, { bg: true }).catch(() => null);
    check('an ordinary aircraft in the background: the monitor not asked for its positions', !asked.some(a => a[0] === 'mon'), asked);
    MONH.on = false; }
  // ---- 11. an ordinary aircraft's log, both sites walling this browser (23 Oct: an FR24 aircraft page had 82 days of its
  // log "not read yet"): every past day from adsb.lol's archive through the monitor - any age, a day older than adsb.lol's
  // site keeps too; its site only for a day the monitor has no index of
  { const HX3 = 'c0a1b2', n = 50, dd = k => dayStr(Date.now() - k * 864e5), dk = k => dd(k).replace(/\//g, '-');
    NET.lol.def = [403, POW]; NET.apl.def = [403, CF];
    await L.readTrace('lol', 'abcdef', dd(31), {}); await L.readTrace('apl', 'abcdef', dd(31), {});
    const dayS = k => Date.parse(dk(k) + 'T00:00:00Z') / 1000;
    const file = k => JSON.stringify(Object.assign({}, REAL, { icao: HX3, r: 'G-ORDN', t: 'FA7X', dbFlags: 0, timestamp: dayS(k) }));
    MONH.on = true; MONH.slow = false; await L.monCheck(true); await sleep(20);
    // (a monitor from before 1.0 - no days indexed in its /status: its archive copy not asked)
    MONH.idx = null; await L.monCheck(true); await sleep(20); asked.length = 0;
    L.store.mergeHex('c0a1b3', { reg: 'G-OLDM', type: 'FA7X' }); await L.loadHistory('c0a1b3', 3, null, { front: true });
    check('a monitor from before 1.0 (no days indexed in its /status): its archive copy not asked - the sites as before', !asked.some(a => a[1] === 'atrace'), asked);
    MONH.idx = 49; await L.monCheck(true); await sleep(20);
    const NONE = [404, '{"none":1}'];
    MONH.arc = (hex, day) => { const k = Array.from({ length: n }, (_, i) => i + 1).find(i => dk(i) === day); return hex !== HX3 || !k ? NONE : k === 10 ? [409, '{"noindex":1}'] : k === 2 || k === 45 ? [200, file(k)] : NONE; };
    L.store.mergeHex(HX3, { reg: 'G-ORDN', type: 'FA7X' });
    asked.length = 0;
    const h11 = await L.loadHistory(HX3, n, null, { front: true });
    const marks = Array.from({ length: n }, (_, i) => h11.days[dd(i + 1)]), withFlights = [2, 45].map(k => (h11.legs || []).filter(l => l.day === dd(k)).length);
    check('an ordinary aircraft, both sites walling: every past day from adsb.lol\'s archive through the monitor - the days it flew with their flights (one older than adsb.lol\'s site keeps), the rest without', marks.every((m, i) => i + 1 === 10 ? !m : m === 'l') && withFlights.every(x => x > 0), { marks, withFlights });
    // (this aircraft's requests: other aircraft's background loads may still be running)
    const arcAsks = asked.filter(a => a[0] === 'mon' && a[1] === 'atrace' && a[2] === HX3), lolAsks = asked.filter(a => a[0] === 'lol' && a[2] === HX3), aplAsks = asked.filter(a => a[0] === 'apl' && a[2] === HX3);
    check('... each day asked of the monitor once; adsb.lol\'s site only for the day the monitor has no index of (walled: not even that); airplanes.live, walling, not asked', arcAsks.length === n && new Set(arcAsks.map(a => a[3])).size === n && lolAsks.every(a => a[1] === dd(10)) && aplAsks.length === 0, { arc: arcAsks.length, lol: lolAsks, apl: aplAsks.length });
    const g11 = L.logGaps(HX3);
    // (1.0.1: said as what it is - the monitor's copy still to come - not a verification page to act on)
    check('... the log page: one day not read yet (the one without an index, adsb.lol walling) - not fifty; the monitor\'s copy still to come, no verification page to act on', /\b1 day not read yet \(the monitor(&#39;|')s copy of this day is not ready yet\)/.test(g11) && !/verification page/.test(g11), g11);
    // (the day's index made at the monitor: read next time, from the archive)
    MONH.arc = (hex, day) => hex === HX3 && day === dk(10) ? [200, file(10)] : NONE;
    asked.length = 0; const h11b = await L.loadHistory(HX3, n, null, { front: true });
    check('... once the monitor has its index: that day read from the archive too, nothing else asked again', h11b.days[dd(10)] === 'l' && (h11b.legs || []).some(l => l.day === dd(10)) && asked.filter(a => a[1] === 'atrace').length === 1 && !/not read yet/.test(L.logGaps(HX3)), { mark: h11b.days[dd(10)], asked });
    // (1.0.1: a day adsb.lol never published - 6 May, its outage: the monitor says so; the log says it as what it is, no
    // verification page to act on, nothing left "not read")
    { const HX4 = 'c0a1b6'; L.store.mergeHex(HX4, { reg: 'G-ORDP', type: 'FA7X' });
      MONH.arc = (hex, day) => day === dk(12) ? [404, '{"none":1,"unpub":1}'] : NONE;
      asked.length = 0; const h12 = await L.loadHistory(HX4, 20, null, { front: true }), g12 = L.logGaps(HX4);
      check('a day adsb.lol never published: noted as that - "in no public archive" - no day left not read, no verification page to act on, the sites not asked', h12.nopub && h12.nopub[dd(12)] === 1 && /in no public archive \(adsb\.lol published none\)/.test(g12) && !/not read yet/.test(g12) && !/verification page/.test(g12) && !asked.some(a => a[0] === 'lol' || a[0] === 'apl'), { g12, nopub: h12.nopub, asked: asked.filter(a => a[0] !== 'mon').length }); }
    // (a single past file - playback, the panel's take-off: from the archive too)
    asked.length = 0; MONH.arc = (hex, day) => hex === HX3 && day === dk(3) ? [200, file(3)] : NONE;
    const one = await L.fetchTrace(HX3, dd(3), { back: 3 }).catch(e => String(e.message || e));
    check('a single past day\'s file (playback, the take-off): from the archive through the monitor, the sites not asked', one && one.icao === HX3 && asked.every(a => a[0] === 'mon'), { one: one && one.icao, asked });
    // (a plain 404 - the path unknown to a monitor from before 1.0 that still counts days: never "no flights")
    MONH.arc = () => [404, '']; L.store.mergeHex('c0a1b4', { reg: 'G-PLNF', type: 'FA7X' });
    asked.length = 0; const h11c = await L.loadHistory('c0a1b4', 5, null, { front: true });
    check('... a 404 that does not say "none" (a path the monitor does not know): never a day without flights - no day marked, adsb.lol\'s site its source', asked.filter(a => a[1] === 'atrace').length === 5 && Object.keys(h11c.days || {}).length === 0 && Object.keys(h11c.err || {}).length === 5, { days: h11c.days, err: Object.values(h11c.err || {})[0] });
    MONH.arc = null; MONH.idx = null; MONH.on = false; }
  // ---- 11c. (1.0.1) a monitor with the world log - every aircraft's flights of every day of adsb.lol's archive: an
  // ordinary aircraft's days from it in one request, from the oldest day wanted; nothing asked day by day
  { const HX5 = 'c0a1b7', HX6 = 'c0a1b8', n = 20, dd = k => dayStr(Date.now() - k * 864e5);
    const bwf = L.engine.byIcao('EGNL'), lpl = L.engine.byIcao('EGGP'), D3 = dd(3), t3 = Date.parse(D3.replace(/\//g, '-') + 'T10:00:00Z') / 1000;
    const leg3 = { day: D3, tStart: t3, tEnd: t3 + 1800, from: { id: bwf.id, code: 'BWF', conf: 'ground' }, to: { id: lpl.id, code: 'LPL', conf: 'ground' }, ended: true, startedOnGround: true, cs: 'BAE1', maxAlt: 9000, src: 'world', lx: ['', '', ''] };
    MONH.hist = h => h === HX5 ? { days: Object.fromEntries(Array.from({ length: n }, (_, i) => [dd(i + 1), dd(i + 1) === D3 ? 1 : 0])), legs: [leg3], part: [], lo: Array.from({ length: n }, (_, i) => dd(i + 1)) } : { days: {}, legs: [] };
    MONH.arc = () => [404, '{"none":1}']; MONH.idx = 49; MONH.on = true; MONH.slow = false; MONH.world = 0; await L.monCheck(true); await sleep(20);
    L.store.mergeHex(HX6, { reg: 'G-ORDQ', type: 'FA7X' }); asked.length = 0;
    await L.loadHistory(HX6, 3, null, { front: true });
    check('a monitor without the world log: an ordinary aircraft\'s log not asked of it (its days one by one from the archive, as before)', !asked.some(a => a[1] === 'hist') && asked.some(a => a[1] === 'atrace' && a[2] === HX6), asked);
    MONH.world = 300; await L.monCheck(true); await sleep(20);
    L.store.mergeHex(HX5, { reg: 'G-ORDR', type: 'FA7X' }); asked.length = 0;
    const h5 = await L.loadHistory(HX5, n, null, { front: true });
    const marks = Array.from({ length: n }, (_, i) => h5.days[dd(i + 1)]), l3 = (h5.legs || []).filter(l => l.day === D3), hq = asked.filter(a => a[1] === 'hist' && a[2].includes(HX5));
    check('a monitor with the world log: an ordinary aircraft\'s days from it in one request, from the oldest day wanted - every day marked, its flight there', hq.length === 1 && hq[0][3] === dd(n).replace(/\//g, '-') && marks.every(m => m === 'l') && l3.length === 1 && l3[0].to.code === 'LPL', { hq, marks, l3: l3.length });
    check('... nothing asked day by day (the archive, the sites)', !asked.some(a => (a[1] === 'atrace' && a[2] === HX5) || ((a[0] === 'lol' || a[0] === 'apl') && a[2] === HX5)), asked.filter(a => a[2] === HX5));
    check('... its flight kept as the day\'s read has it: not marked the monitor\'s own (kept over a read of the day here), no field of the monitor\'s left', l3.length === 1 && !l3[0].mon && !('src' in l3[0]) && !('lx' in l3[0]), l3[0]);
    MONH.world = 0; MONH.arc = null; MONH.idx = null; MONH.hist = null; MONH.on = false; }
  // ---- 11d. (1.0.2) M-PORT: FR24 lists none of its flights, the sites wall this browser (its six-day proof cannot be had):
  // the monitor's word - it holds the aircraft as blocked (blk) - tags it; one it does not hold, without a flight of the
  // last six days anywhere: not tagged. And N162GB: a day the monitor built with FR24's track of the flight (fr) replaces
  // the browser's own read of it, when looked at again
  { const HXP = 'c0a1c1', HXQ = 'c0a1c2', HXR = 'c0a1c3';
    NET.lol.def = [403, POW]; NET.apl.def = [403, CF];
    MONH.hist = h => h === HXP ? { days: {}, legs: [], blk: 2 } : { days: {}, legs: [], blk: 0 };
    MONH.on = true; MONH.slow = false; MONH.world = 0; await L.monCheck(true); await sleep(20);
    L.store.mergeHex(HXP, { reg: 'M-PORT', type: 'GLF6' }); L.store.mergeHex(HXQ, { reg: 'M-QQQQ', type: 'GLF6' });
    await L.noteFr24Blocked(HXP, 'M-PORT'); await L.noteFr24Blocked(HXQ, 'M-QQQQ');
    const p1 = L.store.getHex(HXP) || {}, q1 = L.store.getHex(HXQ) || {};
    check('M-PORT: FR24 lists none of its flights, the sites walling - the monitor holds it as blocked: tagged LADD (search, log page)', p1.ladd === true && p1.fr24Blocked === true, p1);
    check('... one the monitor does not hold, no flight of it in the last six days anywhere: not tagged', !q1.ladd && !q1.fr24Blocked, q1);
    // (N162GB) a day read here from adsb.lol alone, then the monitor's build of it with FR24's track: taken over
    const los = L.engine.byIcao('DNMM'), fab = L.engine.byIcao('EGLF'), dd = k => dayStr(Date.now() - k * 864e5), D2 = dd(2), t2 = Date.parse(D2.replace(/\//g, '-') + 'T10:56:00Z') / 1000;
    const adsbOnly = { day: D2, tStart: t2 + 4 * 3600 + 1400, tEnd: t2 + 7 * 3600 + 2280, from: null, to: { id: fab.id, code: 'FAB', conf: 'ground' }, ended: true, startedOnGround: false, cs: '', maxAlt: 40000, src: 'world', lx: ['', '', ''] };
    const withFr24 = Object.assign({}, adsbOnly, { tStart: t2 - 300, tOff: t2, from: { id: los.id, code: 'LOS', conf: 'ground' }, startedOnGround: true, src: undefined, lx: ['', '', ''] });
    // (the day read here before - adsb.lol alone, "- Farnborough" - as this browser keeps it)
    const HV = Number((SRC.match(/const HIST_V = (\d+);/) || [])[1]), own = Object.assign({}, adsbOnly); delete own.src; delete own.lx;
    await L.store.setHist(HXR, { v: HV, legs: [own], days: { [D2]: 'l' }, rd: { [D2]: Date.now() }, miss: {}, err: {}, savedAt: Date.now() });
    MONH.world = 300; MONH.hist = h => h === HXR ? { days: { [D2]: 1 }, legs: [withFr24], part: [], lo: [D2], fr: { [D2]: Math.round(Date.now() / 1000) } } : { days: {}, legs: [] };
    await L.monCheck(true); await sleep(20);
    L.store.mergeHex(HXR, { reg: 'N162GB', type: 'GALX' }); asked.length = 0;
    const l1 = [own];
    await L.loadHistory(HXR, 3, null, { front: true });
    const r2 = ((await L.store.getHist(HXR)) || {}), l2 = (r2.legs || []).filter(l => l.day === D2);
    check('N162GB: a day read before from adsb.lol alone ("- Farnborough"), the monitor\'s build of it with FR24\'s track (fr): taken over, the monitor\'s mark - Lagos - Farnborough', l1.length === 1 && !l1[0].from && l2.length === 1 && l2[0].from && l2[0].from.code === 'LOS' && r2.days[D2] === 'm', { before: l1.map(l => l.from && l.from.code), after: l2.map(l => l.from && l.from.code), mark: r2.days[D2] });
    check('... in one request to the monitor', asked.filter(a => a[1] === 'hist' && a[2].includes(HXR)).length === 1, asked.filter(a => a[2] === HXR));
    MONH.world = 0; MONH.hist = null; MONH.on = false; }
  // ---- 10. the monitor busy (reading adsb.lol's archives on the 1 GB VM): a late answer is not the monitor gone. One
  // slow answer took it for gone at once, for everything - logs, live figures, today's track (23 Oct)
  { MONH.on = true; MONH.slow = false; await L.monCheck(true); await sleep(20);
    check('(the monitor answering: in use)', L.monUp());
    MONH.slow = true;
    const r1 = await L.monGet('/tel?hex=a7fa04').then(() => 'answered', e => String(e.message || e));
    await L.monCheck(true).catch(() => null);
    const r2 = await L.monGet('/near?lat=51&lon=0&r=50').then(() => 'answered', e => String(e.message || e));
    check('a busy monitor (no answer in time, three times): still in use - it answered within two minutes', L.monUp() && /timeout/.test(r1) && /timeout/.test(r2), { up: L.monUp(), r1, r2 });
    // (two minutes on without an answer: gone - then the sites alone, as before)
    const realNow = w.Date.now, at = realNow.call(w.Date); w.Date.now = () => at + 3 * 60000;
    await L.monGet('/tel?hex=a7fa04').catch(() => null);
    check('... no answer for over two minutes, three no-answers in a row: taken for gone', !L.monUp());
    const g10 = L.logGaps('a7fa04');
    check('... and the log page says so (not silent: its days are what a walled browser\'s log is made of)', /the monitor isn't answering this browser<\/b> \(no answer for over two minutes\)/.test(g10), g10);
    MONH.slow = false; w.Date.now = realNow; await L.monCheck(true).catch(() => null); await sleep(20);
    check('... it answers again: in use again', L.monUp());
    // (a refusal is an answer: the monitor is there)
    MONH.on = false; const r3 = await L.monGet('/tel?hex=a7fa04').then(() => 'answered', e => String(e.message || e));
    check('... a refusal (HTTP 404) is an answer: still in use', L.monUp() && /HTTP 404/.test(r3), r3);
    MONH.on = false; }
  // ---- 12. (1.0.1) TheAirTraffic: another network's files, and its whole-world file as a fallback live source ----------
  { const HX5 = 'a0b0c5', D1 = dayStr(Date.now() - 864e5), D9 = dayStr(Date.now() - 9 * 864e5);
    NET.lol.def = [403, POW]; NET.apl.def = [403, CF]; L.netState.lol.wallUntil = 0; L.netState.apl.wallUntil = 0; L.netState.tat.wallUntil = 0;
    await L.readTrace('lol', 'abcdef', dd0(30), {}); await L.readTrace('apl', 'abcdef', dd0(30), {});
    L.store.mergeHex(HX5, { reg: 'N5TAT', type: 'FA7X' });
    // (today, the aircraft looked at, both sites walling: TheAirTraffic's file is its day)
    NET.tat[HX5 + '|today'] = [200, JSON.stringify(Object.assign({}, TODAY, { icao: HX5 }))];
    L.todayCache.delete(HX5); asked.length = 0;
    const td = await L.loadToday(HX5, 60000, { priority: true });
    const sums = (td.sums || []).map(l => (l.from ? l.from.code : '?') + '-' + (l.to ? l.to.code : '?'));
    check('TheAirTraffic: today\'s file of the aircraft looked at, both sites walling - its flights from it (New Haven - Luton)', sums.includes('HVN-LTN') && asked.some(a => a[0] === 'tat' && a[1] === 'today' && a[2] === HX5) && td.nets.some(x => /TheAirTraffic: ok/.test(x)), { sums, nets: td.nets });
    // (the background, adsb.lol walling, TheAirTraffic without the aircraft: no answer - never "no flights today")
    const HX6 = 'a0b0c6'; L.store.mergeHex(HX6, { reg: 'N6TAT', type: 'FA7X' }); L.todayCache.delete(HX6); L.netState.lol.wallUntil = 0;
    const bg = await L.loadToday(HX6, 60000, { bg: true }).then(() => 'answered', e => String(e.message || e));
    check('... the background, adsb.lol walling, TheAirTraffic with no file of it: not taken for a day without flights', bg !== 'answered' && /TheAirTraffic: none/.test(bg), bg);
    // (a recent day: its file merged in for the aircraft looked at - the day's mark as the others make it; an older day:
    // not asked, TheAirTraffic keeping five days)
    const D1S = Date.parse(D1.replace(/\//g, '-') + 'T00:00:00Z') / 1000;
    NET.tat[HX5 + '|' + D1] = [200, JSON.stringify(Object.assign({}, REAL, { icao: HX5, timestamp: D1S }))];
    // (its file of today flagged it LADD: its days asked of the monitor first - which has none of it here)
    MONH.on = true; MONH.idx = 49; MONH.hist = null; await L.monCheck(true); await sleep(20);
    MONH.arc = () => [404, '{"none":1}']; asked.length = 0;
    const h = await L.loadHistory(HX5, 10, null, { front: true });
    check('... a recent day: TheAirTraffic\'s file merged in where adsb.lol\'s archive has none - its flights in the log', (h.legs || []).some(l => l.day === D1) && asked.some(a => a[0] === 'tat' && a[1] === D1), { d1: (h.legs || []).filter(l => l.day === D1).length, asked: asked.filter(a => a[0] === 'tat').map(a => a[1]) });
    check('... a day older than it keeps (9 days): not asked of it', !asked.some(a => a[0] === 'tat' && a[1] === D9));
    // (a single file - playback: TheAirTraffic's when adsb.lol's does not come)
    MONH.arc = () => [409, '{"noindex":1}']; asked.length = 0;
    const one = await L.fetchTrace(HX5, D1, { back: 1 }).catch(e => String(e.message || e));
    check('... a single past file (playback): TheAirTraffic\'s when adsb.lol\'s site walls', one && one.icao === HX5 && asked.some(a => a[0] === 'tat'), { one: one && one.icao });
    MONH.arc = null; MONH.on = false;
    // (the whole-world file as a live source: around a point, by address; read once for both)
    const now0 = Date.now() / 1000;
    TATWORLD = { now: now0, aircraft: [{ hex: '4bb421', r: 'TC-MAA', t: 'GLF6', flight: 'TCMAA   ', lat: 42.148, lon: 25.641, alt_baro: 37250, gs: 545, track: 111.5, seen_pos: 1 }, { hex: '400001', r: 'G-FARA', t: 'A320', lat: 51.5, lon: -0.1, alt_baro: 9000, gs: 300, track: 90, seen_pos: 1 }] };
    asked.length = 0;
    const near = await L.tatSource.area(42.15, 25.64, 50), byHex = await L.tatSource.hex('4bb421');
    check('TheAirTraffic\'s whole-world file as a fallback live source: the aircraft around a point (TC-MAA over Bulgaria, not London\'s), and by address - the file read once', near.length === 1 && near[0].reg === 'TC-MAA' && byHex && byHex.type === 'GLF6' && asked.filter(a => a[0] === 'tat' && a[1] === 'world').length === 1 && L.tatSource.fallback === true, { near: near.map(c => c.reg), asked });
    NET.lol.def = [404, '']; NET.apl.def = [404, '']; }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
