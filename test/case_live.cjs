// A reported LADD flight through the BUILT userscript in jsdom, with real network (its adsb.lol history and today's
// trace): the aircraft is put where the user's screenshot shows it (today's trace flown on through waypoints, as FR24's
// trail), and the route the script computes is printed with the engine's evidence for the top picks.
// usage: node test/case_live.cjs <node_modules> <hex> <type> <reg> "<lat,lon,alt,gs,minutesAfterTraceEnd;...>" [explain codes]
const fs = require('fs');
const path = require('path');
const [NM, HEX, TYPE, REG, WPS, EXPL] = process.argv.slice(2);
const { JSDOM } = require(path.join(NM, 'jsdom'));
const { indexedDB, IDBKeyRange } = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { execFile } = require('child_process');
const curlFetch = url => new Promise((res, rej) => execFile('curl', ['-s', '--compressed', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64e6, encoding: 'buffer' }, (err, out) => { if (err) return rej(err); const s2 = out.toString('utf8'); const i = s2.lastIndexOf('\n'); res(new Response(s2.slice(0, i), { status: Number(s2.slice(i + 1)) || 0, headers: { 'content-type': 'application/json' } })); }));
const netFetch = (url, init) => /flightradar24\.com|adsb\.lol/.test(url) ? curlFetch(url) : fetch(url, { headers: Object.assign({ 'User-Agent': UA }, (init && init.headers) || {}) });
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/', runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window;
w.indexedDB = indexedDB; w.IDBKeyRange = IDBKeyRange; w.Response = Response; w.Headers = Headers; w.AbortController = AbortController;
w.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; return netFetch(u, init); };
w.GM_xmlhttpRequest = o => { netFetch(o.url, { headers: o.headers }).then(r => r.text().then(t => o.onload && o.onload({ status: r.status, responseText: t, response: t }))).catch(e => o.onerror && o.onerror({ error: String(e) })); return { abort() {} }; };
w.unsafeWindow = w; w.GM_notification = () => {};
w.postMessage = data => setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: w })), 0);
w.__logs = []; w.console.debug = (...a) => w.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '));
(async () => {
  w.eval(SRC);
  const L = w.__tweeksLadd, E = L.engine;
  for (let i = 0; i < 60 && !E.airports.length; i++) await sleep(500);
  const td = await L.loadToday(HEX, 0, { priority: true });
  console.log('today legs:', td.legs.map(l => l.how).join(','), td.sums.map(s => `${s.from ? s.from.code : '?'}>${s.to ? s.to.code : '?'}`).join(' '));
  await L.loadHistory(HEX, 60, null);
  const legs = L.knownLegs(HEX);
  console.log('log:', legs.length, 'legs, last:', legs.slice(-8).map(s => `${s.from ? s.from.code : '?'}>${s.to ? s.to.code : '?'}`).join(' '));
  // FR24's trail: today's trace, then on through the waypoints
  const all = td.pts.slice(); let last = all[all.length - 1];
  const brg = E.brg;
  for (const wp of (WPS || '').split(';').filter(Boolean)) {
    const [lat, lon, alt, gs, mins] = wp.split(',').map(Number), t1 = td.lastPt.t + mins * 60, n = Math.max(1, Math.round((t1 - last.t) / 60)), a0 = last;
    for (let k = 1; k <= n; k++) { const f = k / n; all.push({ t: Math.round(a0.t + (t1 - a0.t) * f), lat: a0.lat + (lat - a0.lat) * f, lon: a0.lon + (lon - a0.lon) * f, alt: Math.round(a0.alt + (alt - a0.alt) * f), gs, trk: brg(a0.lat, a0.lon, lat, lon) }); }
    last = all[all.length - 1];
  }
  // shifted so that "now" is the last point
  const shift = Math.floor(Date.now() / 1000) - last.t;
  const pts = all.map(p => Object.assign({}, p, { t: p.t + shift }));
  L.todayCache.set(HEX, Object.assign({}, td, { pts: td.pts.map(p => Object.assign({}, p, { t: p.t + shift })), legs: E.legsFromPoints(td.pts.map(p => Object.assign({}, p, { t: p.t + shift })), {}), at: Date.now() }));
  const id = 0x41d5eeee, lp = pts[pts.length - 1];
  L.live.set(id, { id, hex: HEX, reg: REG, type: TYPE, cs: REG.replace('-', ''), ladd: true });
  L.pending.set(id, { id, lat: lp.lat, lon: lp.lon, alt: lp.alt, spd: lp.gs, trk: lp.trk, receivedAt: Date.now(), gnd: false });
  w.postMessage({ __tweeksLadd: 'trail', id, first: pts[0], n: pts.length, maxAlt: 41000, pts: pts.filter((p, k) => k % 3 === 0), at: Date.now() });
  await sleep(300);
  const r = L.composeRoute(id, HEX);
  console.log('route:', r && JSON.stringify({ from: r.originIata, note: r.originNote, to: r.destIata, p: r.destP, conf: r.destConf, why: r.destReason, alts: r.alternatives, phase: r.phase }));
  // the engine's view of the same moment
  const trail = L.todayCache.get(HEX) && null;
  const ids = (EXPL || '').split(',').filter(Boolean).map(k => (E.airports.find(a => a.iata === k || a.icao === k) || {}).id);
  const hs = E.histStats(L.knownLegs(HEX, { excludeOpen: true }).filter(l => l.tEnd < pts[0].t - 60), lp.t);
  const res = E.predict({ ac: { hex: HEX, type: TYPE, reg: REG }, pos: lp, trail: pts.filter((p, k) => k % 5 === 0), hs, now: lp.t, origin: { airport: E.byId(r.originId), conf: 'ground', departedAt: r.departedAt }, explain: true, explainIds: ids });
  const fmt = tm => Object.entries(tm || {}).map(([k, v]) => k + ' ' + v.toFixed(2)).join(' ');
  for (const c of res.cands.slice(0, 5)) console.log(`  ${c.airport.code} ${(c.p * 100).toFixed(1)}% d ${c.dist.toFixed(0)} [${(c.why || []).join(', ')}] ${fmt(c.terms)}`);
  for (const T of res.explained || []) console.log(`  explain ${T.airport.code} rank ${T.rank}: ${fmt(T.terms)}`);
  console.log('hist base', hs.base && E.byId(hs.base) && E.byId(hs.base).code, 'n', hs.n);
  process.exit(0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
