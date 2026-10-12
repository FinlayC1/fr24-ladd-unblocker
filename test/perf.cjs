// Main-thread cost of the BUILT userscript while the map is simply open (jsdom, real network): a busy view (the UK and
// near Europe), FR24's LiveFeed every 8 s with its N/A flights, the view poll, history warming - everything the script
// does on its own. Reports every stall of the event loop (what dragging the map would feel) and, with --cpu-prof, the
// profile. usage: node [--cpu-prof --cpu-prof-dir=DIR] test/perf.cjs <node_modules dir> [seconds=150]
const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay, performance } = require('perf_hooks');
const NM = process.argv[2], SECS = +(process.argv[3] || 150);
const { JSDOM } = require(path.join(NM, 'jsdom'));
const { indexedDB, IDBKeyRange } = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(process.env.E2E_SRC || path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(1);
const { execFile } = require('child_process');
const hosts = {};
function curlFetch(url) {
  return new Promise((res, rej) => execFile('curl', ['-s', '--compressed', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64e6, encoding: 'buffer' }, (err, out) => {
    if (err) return rej(err);
    const s2 = out.toString('utf8'); const i = s2.lastIndexOf('\n'); const status = Number(s2.slice(i + 1)) || 0;
    res(new Response(s2.slice(0, i), { status, headers: { 'content-type': 'application/json' } }));
  }));
}
async function netFetch(url, init) {
  const h = (url.match(/^https?:\/\/([^/]+)/) || [])[1] || '?'; hosts[h] = (hosts[h] || 0) + 1;
  if (/flightradar24\.com|globe\.airplanes\.live/.test(url)) return curlFetch(url);
  const headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json, text/html;q=0.9, */*;q=0.8' }, (init && init.headers) || {});
  return fetch(url, { headers, redirect: 'follow', method: (init && init.method) || 'GET', body: init && init.body });
}
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/52.5,-1.5/7', runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window;
w.indexedDB = indexedDB; w.IDBKeyRange = IDBKeyRange; w.DecompressionStream = DecompressionStream; w.Blob = Blob;
w.Response = Response; w.Headers = Headers; w.AbortController = AbortController;
w.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; return netFetch(u, init); };
w.GM_xmlhttpRequest = o => {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), o.timeout || 20000);
  netFetch(o.url, { headers: o.headers, method: o.method, body: o.data }).then(r => r.text().then(t => { clearTimeout(timer); o.onload && o.onload({ status: r.status, responseText: t, response: t }); }))
    .catch(e => { clearTimeout(timer); (e.name === 'AbortError' ? o.ontimeout : o.onerror) && (e.name === 'AbortError' ? o.ontimeout() : o.onerror({ error: String(e) })); });
  return { abort() { ctl.abort(); } };
};
w.unsafeWindow = w; w.GM_notification = () => {};
w.URL.createObjectURL = () => 'blob:test/1'; w.URL.revokeObjectURL = () => {};
w.postMessage = data => { setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: w })), 0); };
w.console.debug = () => {}; w.console.log = () => {};
const errs = []; w.console.error = (...a) => errs.push(a.join(' '));
const post = (type, payload) => w.postMessage(Object.assign({ __tweeksLadd: type }, payload), 'https://www.flightradar24.com');

// stalls: a 10 ms ticker; any tick more than 50 ms late is a stall (the map would not move during it)
const stalls = []; let last = performance.now(), phase = 'boot';
const tick = setInterval(() => { const n = performance.now(), late = n - last - 10; if (late > 50) stalls.push({ at: +T(), ms: Math.round(late), phase }); last = n; }, 10);
const eld = monitorEventLoopDelay({ resolution: 10 }); eld.enable();

(async () => {
  w.eval(SRC);
  const L = () => w.__tweeksLadd;
  for (let i = 0; i < 60 && !(L() && L().globalList.items.length && L().engine.airports.length); i++) await sleep(500);
  console.log(`booted @${T()}s: ${L().engine.airports.length} airports, ${L().globalList.items.length} listed aircraft`);
  // the busy view: what the aggregators see over England and the near continent
  const area = await (await netFetch('https://opendata.adsb.fi/api/v2/lat/52.5/lon/-1.5/dist/250')).json();
  const acs = (area.aircraft || area.ac || []).filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon));
  const isLadd = new Set(L().globalList.items.filter(c => c.ladd).map(c => c.hex));
  let idn = 0x3a000000; const idOf = new Map(); const id = hex => idOf.get(hex) || idOf.set(hex, ++idn).get(hex);
  const airline = cs => /^[A-Z]{3}\d/.test(cs) && !/^(RRR|NPT|SHF|ASY|RCH|CFC|IAM|GAF|BAF|NAF|FAF|MMF|SVF|DUKE|HKY)/.test(cs);
  const ladd = acs.filter(a => isLadd.has(a.hex)), na = acs.filter(a => !isLadd.has(a.hex) && (a.flight || '').trim() && (process.env.ALL_NA || !airline((a.flight || '').trim())));
  console.log(`view: ${acs.length} aircraft, ${ladd.length} LADD (no callsign in FR24), ${na.length} N/A (callsign, no destination)`);
  post('view', { n: 56, s: 49, w: -7, e: 4 });
  const drift = (a, dt) => { const k = (a.gs || 0) * dt / 3600 / 60; return { lat: a.lat + k * Math.cos((a.track || 0) * Math.PI / 180), lon: a.lon + k * Math.sin((a.track || 0) * Math.PI / 180) / Math.cos(a.lat * Math.PI / 180) }; };
  const alt = a => a.alt_baro === 'ground' ? 0 : a.alt_baro || 0;
  const feed = () => {
    const dt = (Date.now() - t0) / 1000, at = Date.now();
    const flights = ladd.map(a => { const p = drift(a, dt); return { id: id(a.hex), lat: p.lat, lon: p.lon, trk: Math.round(a.track || 0), alt: alt(a), spd: Math.round(a.gs || 0), icon: 0, ts: Math.floor(at / 1000), gnd: a.alt_baro === 'ground', src: 0, type: a.t || '', reg: '', sel: false }; });
    const nas = na.map(a => { const p = drift(a, dt); return { id: id(a.hex), lat: p.lat, lon: p.lon, trk: Math.round(a.track || 0), alt: alt(a), spd: Math.round(a.gs || 0), ts: Math.floor(at / 1000), gnd: a.alt_baro === 'ground', cs: (a.flight || '').trim(), reg: a.r || '', type: a.t || '', hex: parseInt(a.hex, 16), from: '' }; });
    post('feed', { flights, na: nas, serverTime: at, total: acs.length, at, bg: false });
  };
  // FR24's background world scan (what the page interceptor reads from its own LiveFeed queries): every LADD and
  // military aircraft airborne, callsign-less - each identified and routed by the script like the ones in view
  const world = L().globalList.items.filter(c => !c.gnd && Number.isFinite(c.lat));
  const scan = () => { const at = Date.now(); post('feed', { flights: world.map(c => ({ id: id(c.hex), lat: c.lat, lon: c.lon, trk: Math.round(c.trk || 0), alt: Math.round(c.alt || 0), spd: Math.round(c.gs || 0), icon: 0, ts: Math.floor(at / 1000), gnd: false, src: 0, type: c.type || '', reg: '', sel: false })), na: [], serverTime: at, total: world.length, at, bg: true }); };
  console.log(`world scan: ${world.length} aircraft`);
  phase = 'map'; const tMap = Date.now(); stalls.length = 0; eld.reset();
  if (!process.env.NO_WORLD) { scan(); setInterval(scan, 60000); }
  feed(); const feedT = setInterval(feed, 8000);
  while (Date.now() - tMap < SECS * 1000) await sleep(1000);
  clearInterval(feedT); clearInterval(tick); eld.disable();
  const sum = stalls.reduce((s, x) => s + x.ms, 0), big = stalls.filter(s => s.ms > 200);
  console.log(`\nmap open ${SECS}s: ${stalls.length} stalls over 50 ms (${big.length} over 200 ms), ${Math.round(sum)} ms stalled in all (${(sum / SECS / 10).toFixed(1)}% of the time)`);
  console.log(`event loop delay: p50 ${(eld.percentile(50) / 1e6).toFixed(0)} ms, p99 ${(eld.percentile(99) / 1e6).toFixed(0)} ms, max ${(eld.max / 1e6).toFixed(0)} ms`);
  console.log('worst:', stalls.slice().sort((a, b) => b.ms - a.ms).slice(0, 15).map(s => `${s.ms}ms@${s.at}s`).join(' '));
  console.log('hosts:', JSON.stringify(hosts));
  if (errs.length) console.log('errors:', errs.slice(0, 5));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
