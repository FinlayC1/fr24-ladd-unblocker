// A reported panel, replayed through the BUILT userscript (jsdom): FR24's own track of that flight up to the moment of
// the screenshot (its playback API) as the stream's trail, adsb.lol's real trace of the day, and the route the panel
// would show - departure (and why), destination. usage: node test/case_panel.cjs <node_modules> <cases.json>
//   cases.json: [{ name, hex, reg, type, cs, fid (FR24 flight id), at: 'YYYY-MM-DDTHH:MM:SSZ', expect: { from, to } }]
const fs = require('fs');
const path = require('path');
const NM = process.argv[2], cases = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { JSDOM } = require(path.join(NM, 'jsdom'));
const { indexedDB, IDBKeyRange } = require(path.join(NM, 'fake-indexeddb'));
const { execFile } = require('child_process');
const SRC = fs.readFileSync(process.env.E2E_SRC || path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const curl = url => new Promise((res, rej) => execFile('curl', ['-s', '--compressed', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64e6, encoding: 'buffer' }, (err, out) => { if (err) return rej(err); const s = out.toString('utf8'), i = s.lastIndexOf('\n'); res(new Response(s.slice(0, i), { status: Number(s.slice(i + 1)) || 0, headers: { 'content-type': 'application/json' } })); }));
// (Overpass answers a browser, not Node or curl: its answers recorded from a browser, by a piece of the query)
const OSM_FX = fs.existsSync(path.join(__dirname, 'fixtures', 'panels', 'overpass.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'panels', 'overpass.json'), 'utf8')) : {};
const osmAnswer = url => { const q = decodeURIComponent(String(url).split('data=')[1] || ''); for (const [k, v] of Object.entries(OSM_FX)) if (q.includes(k)) return new Response(JSON.stringify(v), { status: 200 }); return new Response(JSON.stringify({ elements: [] }), { status: 200 }); };
// (a blocked flight FR24 has no playback for: a recorded adsb.lol trace of the day - case.trace - is both its stream's
// trail, from case.trailFrom, and the day's trace the script reads)
const TRACE_FX = {};
for (const c of cases) if (c.trace) TRACE_FX[c.hex.toLowerCase()] = require('zlib').gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'panels', c.trace))).toString('utf8');
const traceFx = url => { const m = String(url).match(/trace_full_([0-9a-f]{6})\.json/); return m && TRACE_FX[m[1]] ? new Response(TRACE_FX[m[1]], { status: 200, headers: { 'content-type': 'application/json' } }) : null; };
const netFetch = (url, init) => traceFx(url) ? Promise.resolve(traceFx(url)) : /overpass-api\.de/.test(url) ? Promise.resolve(osmAnswer(url)) : /flightradar24\.com|globe\.airplanes\.live|adsb\.lol/.test(url) ? curl(url) : fetch(url, { headers: Object.assign({ 'User-Agent': UA }, (init && init.headers) || {}) });
function makeDom() {
  const w = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53,-3/8', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  w.indexedDB = indexedDB; w.IDBKeyRange = IDBKeyRange; w.DecompressionStream = DecompressionStream; w.Blob = Blob; w.Response = Response; w.Headers = Headers; w.AbortController = AbortController;
  w.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; return netFetch(u, init); };
  w.GM_xmlhttpRequest = o => { netFetch(o.url, { headers: o.headers }).then(r => r.text().then(t => o.onload && o.onload({ status: r.status, responseText: t, response: t }))).catch(e => o.onerror && o.onerror({ error: String(e) })); return { abort() {} }; };
  w.unsafeWindow = w; w.GM_notification = () => {}; w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  w.postMessage = data => { setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: w })), 0); };
  w.__logs = []; w.console.debug = (...a) => w.__logs.push(a.join(' ')); w.console.error = (...a) => w.__logs.push('ERROR ' + a.join(' '));
  return w;
}
(async () => {
  const w = makeDom(); w.eval(SRC);
  const L = () => w.__tweeksLadd;
  for (let i = 0; i < 60 && !(L() && L().engine.airports.length > 5000); i++) await sleep(500);
  // (1.1.0: the route code the monitor runs, with the tables as the monitor has them - here on what this browser has)
  if (L() && L().engine.airports.length > 5000) await require('./monfake.cjs').tablesInto(L().engine);
  let fails = 0;
  for (const c of cases) {
    const t = Date.parse(c.at) / 1000, id = parseInt(c.fid, 16), hex = c.hex.toLowerCase();
    const pb = await (await curl(`https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${c.fid}&timestamp=${Math.floor(t - 3600)}`)).json().catch(() => null);
    const tr = (((((pb || {}).result || {}).response || {}).data || {}).flight || {}).track || [];
    let pts = tr.map(p => ({ t: p.timestamp, lat: p.latitude, lon: p.longitude, alt: p.altitude.feet, gs: p.speed.kts, trk: p.heading })).filter(p => p.t <= t);
    if (c.trace && !c.fr24Track) { const j = JSON.parse(TRACE_FX[hex]), t0 = Date.parse(c.trailFrom) / 1000; pts = j.trace.map(p => ({ t: j.timestamp + p[0], lat: p[1], lon: p[2], alt: p[3] === 'ground' ? 0 : p[3], gs: p[4], trk: p[5] })).filter(p => p.t >= t0 && p.t <= t && typeof p.alt === 'number'); }
    if (!pts.length) { console.log(`?     ${c.name}: no FR24 track before ${c.at}`); continue; }
    const pos = Object.assign({}, pts[pts.length - 1]);
    L().live.set(id, { id, hex, reg: c.reg, type: c.type, cs: c.cs || '', receivedAt: Date.now() });
    // (case.noTrail: FR24's track of the flight not in yet - the panel just opened - only where it is now)
    if (!c.noTrail) w.postMessage({ __tweeksLadd: 'trail', id, first: pts[0], n: pts.length, maxAlt: Math.max(...pts.map(p => p.alt)), pts, at: Date.now() });
    await L().loadToday(hex, 0, { priority: true }).catch(e => console.log('today', String(e)));
    await sleep(400);
    const P = Object.assign({ gnd: pos.alt <= 0 && pos.gs < 40 }, pos);
    L().composeRoute0(id, hex, { pos: P });
    await sleep(+(process.env.SETTLE || 8000));   // (what it asks for in the background - place names, platforms ahead - comes in)
    const r = L().composeRoute0(id, hex, { pos: P });
    const from = r ? (r.originIata || '-') : '-', to = r ? (r.destIata || '-') : '-', fromName = r ? r.originCity || '' : '', toName = r ? r.destCity || '' : '';
    const ok = (!c.expect.from || c.expect.from === from) && (!c.expect.to || c.expect.to === to) && (!c.expect.fromName || c.expect.fromName === fromName) && (!c.expect.toNot || c.expect.toNot !== to) && (!c.expect.toName || new RegExp(c.expect.toName, 'i').test(toName));
    if (!ok) fails++;
    if (r) console.log("   circuits:", r.circuits, "phase", r.phase, "originConf", r.originConf, "alternatives", JSON.stringify(r.alternatives || []));
    if (process.env.TRAIL) { const tr = L().trailFor(id, hex, P), hm = t => new Date(t * 1000).toISOString().slice(11, 19); console.log("   trail", tr.length, "pts from", hm(tr[0].t), tr[0].gnd ? "GND" : tr[0].alt + "ft", "cut", tr.cut, "gapFrom", tr.gapFrom && hm(tr.gapFrom.t)); const td = L().todayCache.get(hex); console.log("   today legs", td && td.legs && td.legs.slice(-3).map(l => hm(l.start.t) + (l.startGnd ? "G" : "") + "-" + hm(l.end.t) + " " + l.how).join(" | ")); }
    if (!r) console.log("   route error:", (L().live.get(id) || {}).routeErr);
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} @${c.at.slice(11, 16)}Z: ${from} ${fromName} -> ${to} ${toName} ${r && r.destP ? r.destP + '%' : ''}  | dep: ${r && (r.originNote || r.originConf)} | dest: ${r && r.destReason}  | expected ${c.expect.from || '?'} -> ${c.expect.to || '?'}  (FR24 track ${pts.length} pts from ${new Date(pts[0].t * 1000).toISOString().slice(11, 16)}Z)`);
    L().live.delete(id);
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
