// Runs the BUILT userscript (jsdom, real network) on flights captured from the live FR24 page, and exports exactly what
// its page-world bridge would hold (identities, routes, telemetry, logs) so they can be replayed into the real page.
// usage: node test/sim.cjs <node_modules dir> <captured feed json> <out json> [selectId]
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const [NM, feedFile, outFile, selArg] = process.argv.slice(2);
const { JSDOM } = require(path.join(NM, 'jsdom'));
const { indexedDB, IDBKeyRange } = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function curlFetch(url) {
  return new Promise((res, rej) => execFile('curl', ['-s', '--compressed', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64e6, encoding: 'buffer' }, (err, out) => {
    if (err) return rej(err);
    const s2 = out.toString('utf8'); const i = s2.lastIndexOf('\n');
    res(new Response(s2.slice(0, i), { status: Number(s2.slice(i + 1)) || 0, headers: { 'content-type': 'application/json' } }));
  }));
}
async function netFetch(url, init) {
  if (/flightradar24\.com/.test(url)) return curlFetch(url);
  const headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json, text/html;q=0.9, */*;q=0.8' }, (init && init.headers) || {});
  if (/planespotters/.test(url)) Object.assign(headers, { Origin: 'https://www.flightradar24.com', Referer: 'https://www.flightradar24.com/', 'Sec-Fetch-Mode': 'cors' });
  return fetch(url, { headers, redirect: 'follow' });
}
(async () => {
  const cap = JSON.parse(fs.readFileSync(feedFile, 'utf8'));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/40.9,-74/8', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  Object.assign(w, { indexedDB, IDBKeyRange, Response, Headers, AbortController, unsafeWindow: w });
  w.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; return netFetch(u, init); };
  w.GM_xmlhttpRequest = o => { netFetch(o.url, { headers: o.headers }).then(r => r.text().then(t => o.onload && o.onload({ status: r.status, responseText: t }))).catch(e => o.onerror && o.onerror({ error: String(e) })); };
  w.postMessage = data => setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: w })), 0);
  w.__logs = []; w.console.debug = (...a) => w.__logs.push(a.join(' '));
  w.eval(SRC);
  const L = w.__tweeksLadd, B = w.__tweeksLaddBridge;
  for (let i = 0; i < 60 && !(L.globalList.items.length && L.engine.airports.length); i++) await sleep(500);
  const flights = cap.f.map(a => ({ id: a[0], lat: a[1], lon: a[2], alt: a[3], spd: a[4], trk: a[5], gnd: !!a[6], type: a[7], reg: a[8], ts: a[9], src: a[10], icon: a[11], sel: false }));
  w.postMessage({ __tweeksLadd: 'feed', flights, serverTime: cap.at, total: flights.length, at: cap.at, bg: false });
  await sleep(2500);
  // unmatched ones get the regular area sweep (adsb.lol / adsb.fi)
  await L.sweep(); await sleep(3000); await L.sweep(); await sleep(2000);
  const matched = flights.filter(f => L.live.has(f.id));
  console.log('matched', matched.length, '/', flights.length, matched.map(f => `${f.id.toString(16)}=${L.live.get(f.id).reg || L.live.get(f.id).hex}(${f.type})`).join(' '));
  // routes for everything (light: today's trace + filed plan), then the full treatment for the selected one
  for (const f of matched) { try { await Promise.race([L.routeFor(L.live.get(f.id), true), sleep(15000)]); } catch (e) { console.log('routeFor', f.id.toString(16), e && e.stack || e); } }
  const errs = w.__logs.filter(l => /fail|error|TypeError|ReferenceError/i.test(l)); if (errs.length) console.log('script log errors:', errs.slice(0, 8).join('\n'));
  const want = selArg ? selArg.split(',').map(s => parseInt(s, 16)).find(id => L.live.has(id)) : null;
  const sel = want || (matched.filter(f => !f.gnd && f.alt > 10000).sort((a, b) => b.alt - a.alt)[0] || matched[0] || {}).id;
  if (sel) {
    const rec = L.live.get(sel);
    w.history.pushState({}, '', '/' + (rec.reg || 'X') + '/' + sel.toString(16));
    w.postMessage({ __tweeksLadd: 'follow', id: sel });
    for (let i = 0; i < 40; i++) { await sleep(1000); const h = await L.store.getHist(rec.hex); if (h && Object.keys(h.days).length >= 80) break; }
    await sleep(1500);
    if (rec.reg) { w.postMessage({ __tweeksLadd: 'needHist', reg: rec.reg }); await sleep(2500); }
  }
  for (let i = 0; i < 20; i++) { await sleep(1000); if (matched.every(f => { const r = L.live.get(f.id); return r.photoAt || (r.photos && r.photos.length); })) break; }
  L.quickRouteAll(); await sleep(500);
  const ap = id => { const a = L.engine.byId(id); return a ? a.code : '-'; };
  for (const f of matched) { const r = (L.routeState.get(f.id) || {}).route || L.live.get(f.id).route; const rec = L.live.get(f.id); console.log(f.id.toString(16), (rec.reg || '').padEnd(7), f.type.padEnd(5), String(f.alt).padStart(6), r ? `${ap(r.originId)}(${r.originConf || ''}) -> ${ap(r.destId)} ${r.destConf} ${r.destP || ''}% ${r.landed ? 'LANDED' : ''}${r.phase === 'parked' ? 'PARKED' : ''} alts ${(r.alternatives || []).map(a => a.iata + ':' + a.p).join(',')}` : 'no route', 'photos', (rec.photos || []).length); }
  const out = {
    selected: sel || 0,
    entries: [...B.resolved.entries()].map(([id, r]) => Object.assign({ id }, r, { photos: (r.photos || []).slice(0, 3) })),
    routes: [...B.routes.entries()].map(([id, route]) => ({ id, route })),
    telem: [...B.telem.entries()].map(([id, t]) => ({ id, t })),
    hist: [...B.hist.entries()].map(([reg, h]) => ({ reg, data: h.data.slice(0, 8) }))
  };
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log('exported', out.entries.length, 'identities,', out.routes.length, 'routes,', out.telem.length, 'telemetry,', out.hist.length, 'logs; selected', (sel || 0).toString(16), '- bytes', JSON.stringify(out).length);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
