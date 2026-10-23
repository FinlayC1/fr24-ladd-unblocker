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
const NET = { lol: { def: [404, ''] }, apl: { def: [404, ''] } };
const MON = 'https://143-47-224-210.sslip.io';
// (the monitor, when on: /status, /hist - MONH.hist(hex) -> its answer for the aircraft - and /trace - MONH.trace(hex))
const MONH = { on: false, hist: null, trace: null };
function answer(url) {
  if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
  if (url.startsWith(MON)) {
    if (!MONH.on) return [404, ''];
    if (url.startsWith(MON + '/status')) return [200, JSON.stringify({ v: 3, since: Date.now() - 3600e3, public: true, ver: '22.31.11', archive: { on: 220, have: 39, days: 39, running: '' } })];
    let mm = url.match(/\/hist\?hex=([0-9a-f,]+)/); if (mm) { asked.push(['mon', 'hist', mm[1]]); return [200, JSON.stringify({ hv: Number((SRC.match(/const HIST_V = (\d+);/) || [])[1]), list: mm[1].split(',').map(h => Object.assign({ hex: h }, MONH.hist ? MONH.hist(h) : { days: {}, legs: [] })) })]; }
    mm = url.match(/\/trace\?hex=([0-9a-f]{6})/); if (mm) { asked.push(['mon', 'trace', mm[1]]); const t = MONH.trace && MONH.trace(mm[1]); return t ? [200, JSON.stringify(t)] : [404, '']; }
    return [404, ''];
  }
  const m = url.match(/^https:\/\/(adsb\.lol|globe\.airplanes\.live)\/(?:globe_history\/([\d/]+)|data)\/traces\/(\w\w)\/trace_full_(\w{6})\.json$/);
  if (m) {
    const net = m[1] === 'adsb.lol' ? 'lol' : 'apl', day = m[2] || 'today';
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
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
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
    check('... the log page no longer says hundreds of days not read: no "not read yet" for days the monitor gave', !/not read yet/.test(g9) && /verification page/.test(g9) && /the monitor has 39 of the last 220 days/.test(g9), g9);
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
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
