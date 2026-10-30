// Replays FollowFlight frames captured from the live FR24 site (test/fixtures/*_follow.json) through the BUILT userscript
// in jsdom (real network for everything else), with FR24's real panel markup for a flight shown as "<origin> -> N/A".
// usage: node test/replay_live.cjs <node_modules dir> [fixture=tiger68_follow.json] [callsign] [type] [origin code]
const fs = require('fs');
const path = require('path');
const NM = process.argv[2];
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', process.argv[3] || 'tiger68_follow.json'), 'utf8'));
const CS = process.argv[4] || 'TIGER68', TYPE = process.argv[5] || 'EH10', ORIG = process.argv[6] || 'PIK';
const { JSDOM } = require(path.join(NM, 'jsdom'));
const { indexedDB, IDBKeyRange } = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(process.env.REPLAY_SRC || path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');   // (REPLAY_SRC: another build, e.g. the installed one)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { execFile } = require('child_process');
const curlFetch = url => new Promise((res, rej) => execFile('curl', ['-s', '--compressed', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64e6, encoding: 'buffer' }, (err, out) => { if (err) return rej(err); const s2 = out.toString('utf8'); const i = s2.lastIndexOf('\n'); res(new Response(s2.slice(0, i), { status: Number(s2.slice(i + 1)) || 0, headers: { 'content-type': 'application/json' } })); }));
// (1.1.0: every route is worked out on the monitor - a monitor of the test's own, its central calculation: test/monfake.cjs)
let fake = null;
async function netFetch(url, init) {
  if (fake && url.startsWith('https://mon.test/')) { const a = fake.answer(url, { data: init && init.body }); return new Response(a[1], { status: a[0] }); }
  // (FR24 and airplanes.live refuse Node's own HTTP client - its TLS handshake is not a browser's - and answer curl)
  if (/flightradar24\.com|globe\.airplanes\.live/.test(url)) return curlFetch(url);
  const headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json, text/html;q=0.9, */*;q=0.8' }, (init && init.headers) || {});
  if (/planespotters/.test(url)) Object.assign(headers, { Origin: 'https://www.flightradar24.com', Referer: 'https://www.flightradar24.com/', 'Sec-Fetch-Mode': 'cors' });
  return fetch(url, { headers, redirect: 'follow', method: (init && init.method) || 'GET', body: init && init.body });
}
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/' + CS + '/' + fx.id.toString(16), runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window;
w.indexedDB = indexedDB; w.IDBKeyRange = IDBKeyRange; w.Response = Response; w.Headers = Headers; w.AbortController = AbortController;
w.DecompressionStream = DecompressionStream; w.Blob = Blob;   // (a browser has them; the packed population tables need them)
w.fetch = (input, init) => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; return netFetch(u, init); };
w.GM_xmlhttpRequest = o => { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), o.timeout || 20000); netFetch(o.url, { headers: o.headers, method: o.method, body: o.data }).then(r => r.text().then(t => { clearTimeout(tm); o.onload && o.onload({ status: r.status, responseText: t, response: t }); })).catch(e => { clearTimeout(tm); o.onerror && o.onerror({ error: String(e) }); }); return { abort() { ctl.abort(); } }; };
w.unsafeWindow = w; w.GM_notification = () => {};
const posted = [];
w.postMessage = data => { posted.push(data); setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: w })), 0); };
w.__logs = []; w.console.debug = (...a) => w.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); w.console.error = (...a) => w.__logs.push('ERROR ' + a.join(' '));
let H = null; w.__tlTestHook = h => { H = h; };
const check = (name, ok, extra) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
const b = s => new Uint8Array(Buffer.from(s, 'base64'));
(async () => {
  fake = await require('./monfake.cjs').createFakeMonitor({ data: path.join(__dirname, '..', 'monitor', 'data') });
  w.eval(SRC);
  const L = w.__tweeksLadd;
  for (let i = 0; i < 60 && !L.engine.airports.length; i++) await sleep(500);
  check('airports loaded', L.engine.airports.length > 5000, L.engine.airports.length);
  await L.store.kvReady; L.store.kvSet('monRemote', { url: 'https://mon.test', token: '' }); await L.monCheck(true).catch(() => {});
  check('(the monitor answering, its central calculation on)', L.monUp(), L.calcWhy());
  // (the route code the monitor runs, given what this browser has: the cases below that look at it on its own)
  await require('./monfake.cjs').tablesInto(L.engine);
  // (FR24's schedule lookup would find this recorded flight - days old - already landed: the reasoning is what is tested)
  L.fr24.schedules.set('ZH847', { at: Date.now() + 864e5, rows: [] });
  const id = fx.id, st = { id };
  // what FR24 does: open the stream (the page reports it), then the first frame, then redraw the panel
  w.postMessage({ __tweeksLadd: 'follow', id }, '*');
  await sleep(5);
  const out1 = H.patchFlightMsg(b(fx.first), st, H.FOLLOW);
  const kinds = posted.map(p => p && p.__tweeksLadd).filter(Boolean);
  check('page reported the flight (follow, pos, trail, sched, aircraftInfo)', ['follow', 'pos', 'trail', 'sched', 'aircraftInfo'].every(k => kinds.includes(k)), kinds);
  const sch = posted.find(p => p && p.__tweeksLadd === 'sched');
  console.log('  sched', JSON.stringify(sch), ' origin', (L.engine.byId(sch && sch.o) || {}).code);
  // (FR24 can move a flight to a new id mid-stream - TIGER68 did: the extended info's id is the one that counts)
  const rid = sch ? sch.id : id;
  // FR24's real panel markup for "<origin> -> N/A" (captured from the live site)
  const hexU = (posted.find(p => p && p.__tweeksLadd === 'aircraftInfo') || {}).hex || '';
  w.document.body.insertAdjacentHTML('beforeend', `<aside data-testid="aircraft-panel"><div data-testid="aircraft-panel__header"><div><div><span data-testid="aircraft-panel__header__callsign">${CS}</span><span data-testid="aircraft-panel__header__model">${TYPE}</span></div></div></div><main><div><div class="first"></div><div class="relative grid grid-cols-2 gap-0.5 border-white bg-white"><div class="col-span-1 bg-gray-400 text-center leading-4"><div class="mt-1 font-alt-regular text-4xl font-medium text-gray-1300"><div data-testid="base-tooltip"><a href="#" data-testid="aircraft-panel__airport-departure-iata">${ORIG}</a></div></div><div><div class="overflow-hidden"><span data-testid="aircraft-panel__airport-departure-city">Origin</span></div><p data-testid="aircraft-panel__airport-departure-timezone">BST (UTC +01:00)</p></div></div><div class="col-span-1 bg-gray-400 text-center leading-4"><div class="mt-1 font-alt-regular text-4xl font-medium text-gray-1300 text-gray-1300"><p data-testid="aircraft-panel__airport-arrival-iata">N/A</p></div><div class="mb-4.5 text-sm font-semibold uppercase leading-relaxed">Not available</div></div></div><div class="grid grid-cols-2"><div class="col-span-1"><p>ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">${hexU}</p></div></div></div></main></aside>`);
  const q = t => ((w.document.querySelector(`[data-testid="aircraft-panel__airport-${t}"]`) || {}).textContent || '').trim();
  const arrCell = () => { const a = w.document.querySelector('[data-testid="aircraft-panel__airport-arrival-iata"]'); const c = a && a.closest('[class*="col-span"]'); return c ? c.textContent.replace(/\s+/g, ' ').trim() : ''; };
  let r = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    // the later frames of the stream, as FR24 sends them every few seconds
    if (i % 4 === 3) { const o = H.patchFlightMsg(b(i % 8 === 3 ? fx.next : fx.last), st, H.FOLLOW); const sc = H.parse(o).find(f => f.fn === 3); r = r || null; if (sc) { const d = H.parse(sc.val).find(f => f.fn === 5); if (d) console.log('  later frame carries destination id', d.val, (L.engine.byId(d.val) || {}).code); } }
    const rs = L.routeState.get(rid); r = rs && rs.route;
    if (r && q('arrival-iata').replace(/\?$/, '') !== 'N/A' && w.document.querySelector('.tl-strip')) break;
  }
  const p = L.pubRecs.get(rid);
  console.log('  pubRec', p && JSON.stringify({ hex: p.hex, type: p.type, naDest: p.naDest, started: p.routeStarted }), ' pubRouted', !!L.pubRouted(rid), ' fr24Sched', JSON.stringify(L.fr24Sched.get(rid)));
  console.log('  route', r && JSON.stringify({ o: r.originIata, d: r.destIata, city: r.destCity, conf: r.destConf, p: r.destP, why: r.destReason, alts: r.alternatives }));
  const sp = w.document.querySelector('.tl-strip');
  // (DUMP_STRIP=<file>: the rendered strip and the stylesheet, to look at on the live site)
  if (process.env.DUMP_STRIP) fs.writeFileSync(process.env.DUMP_STRIP, JSON.stringify({ html: sp ? sp.outerHTML : '', css: (w.document.getElementById('tl-style') || {}).textContent || '' }));
  // (its reasons and the flight log it was worked out from - the same engine as a blocked aircraft's, in words - are the
  // destination's tooltip: the panel itself carries no paragraph about it)
  const spTxt = sp ? sp.textContent.replace(/\s+/g, ' ') : '';
  const tip = sp ? [...sp.querySelectorAll('[title]')].map(e => e.getAttribute('title')).find(x => /from its track|schedule/.test(x)) || '' : '';
  check('reasoned destination shown in FR24\'s panel; reasons and the flight log used in its tooltip, not as extra lines', !!r && !!r.destIata && q('arrival-iata').replace(/\?$/, '') === r.destIata && !!r.destReason && /earlier flight|no earlier flights of its own|schedule/.test(tip) && !/FR24 has no|worked out from|there now/.test(spTxt), { arrival: arrCell(), strip: spTxt.trim().slice(0, 220), tip: tip.slice(0, 200) });
  // M-ARNZ (25 Sep): FR24 kept one flight id through a turnaround at Barrow - its trail held the Farnborough -> Barrow leg
  // too, and the panel still said "Farnborough -> Barrow, 100%" after it took off again from Barrow
  {
    const mid = 0x41d4aaaa, fab = L.engine.byIcao('EGLF'), bwf = L.engine.byIcao('EGNL'), tN = Math.floor(Date.now() / 1000), pts = [];
    const add = (t, a, b, f, alt, gs) => pts.push({ t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, alt, gs, trk: 340 });
    add(tN - 7200, fab, fab, 0, 0, 0);
    for (let k = 1; k <= 20; k++) add(tN - 7200 + k * 240, fab, bwf, k / 20, k === 20 ? 0 : 20000, k === 20 ? 30 : 380);
    add(tN - 1500, bwf, bwf, 0, 0, 0); add(tN - 900, bwf, bwf, 0, 0, 5);
    for (let k = 1; k <= 8; k++) pts.push({ t: tN - 900 + k * 60, lat: bwf.lat - k * 0.03, lon: bwf.lon + 0.01 * k, alt: 800 * k, gs: 220, trk: 172 });
    L.live.set(mid, { id: mid, hex: '424c60', reg: 'M-ARNZ', type: 'PC24', cs: 'VSB82' });
    w.postMessage({ __tweeksLadd: 'trail', id: mid, first: pts[0], n: pts.length, maxAlt: 20000, pts, at: Date.now() }, '*');
    const lp = pts[pts.length - 1];
    w.postMessage({ __tweeksLadd: 'pos', id: mid, lat: lp.lat, lon: lp.lon, trk: 172, alt: lp.alt, spd: 220, gnd: false, at: Date.now() }, '*');
    await sleep(300);
    const rr = L.composeRoute0(mid, '424c60');
    check('a new take-off under the same flight id: this leg only (from Barrow - not the earlier Farnborough -> Barrow)', !!rr && rr.originIata === 'BWF' && rr.destIata !== 'BWF', rr && { from: rr.originIata, note: rr.originNote, to: rr.destIata, p: rr.destP });
    L.live.delete(mid);
  }
  // a US Army UC-35 first seen at 100 ft climbing out of Los Alamitos Army Air Field (not in FR24's airport list): that
  // is its departure - not Long Beach 10 km away (an OurAirports field: its id is the script's own, 1e7+, never sent to FR24)
  {
    L.loadSites(); for (let i = 0; i < 240 && !L.sites.grid; i++) await sleep(500);
    const sid = 0x41d4bbbb, t0 = Math.floor(Date.now() / 1000) - 400, pts = [];
    for (let k = 0; k < 12; k++) pts.push({ t: t0 + k * 20, lat: 33.7896 - k * 0.004, lon: -118.0503 - k * 0.006, alt: 100 + k * 300, gs: 150 + k * 10, trk: 235 });
    L.live.set(sid, { id: sid, hex: '080010', reg: '98-00010', type: 'C560', mil: true, cs: 'R10' });
    w.postMessage({ __tweeksLadd: 'trail', id: sid, first: pts[0], n: pts.length, maxAlt: 3400, pts, at: Date.now() }, '*');
    const lp = pts[pts.length - 1];
    w.postMessage({ __tweeksLadd: 'pos', id: sid, lat: lp.lat, lon: lp.lon, trk: 235, alt: lp.alt, spd: lp.gs, gnd: false, at: Date.now() }, '*');
    await sleep(300);
    const rr = L.composeRoute0(sid, '080010');
    check('first seen climbing out of an airfield FR24 does not list: named as the departure (Los Alamitos AAF, not Long Beach)', !!rr && (!rr.originId || rr.originId >= 1e7) && /Los Alamitos/i.test(rr.originCity || ''), rr && { from: rr.originIata, city: rr.originCity, note: rr.originNote, sites: L.sites.n });
    L.live.delete(sid);
  }
  // TC-TSS (25 Sep): adsb.lol lost it at FL214 descending into Misrata after a flight from Paris; it took off again from
  // Misrata under a new FR24 flight - and was shown "from Paris (18:11Z)". adsb.lol's real Paris leg (shifted to now),
  // FR24's trail from Misrata, Paris already remembered as the origin of this flight id.
  {
    const tj = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tctss_2026-09-25.json'), 'utf8'));
    const E = L.engine, raw = E.parseTrace(tj), tN = Math.floor(Date.now() / 1000), shift = tN - 3900 - raw[raw.length - 1].t;
    const pts = raw.map(p => Object.assign({}, p, { t: p.t + shift }));
    const legs = E.legsFromPoints(pts, {});
    const mra = E.byIcao('HLMS'), tid = 0x41d4cccc, fr = [];
    fr.push({ t: tN - 720, lat: mra.lat, lon: mra.lon, alt: 0, gs: 5, trk: 350 });
    for (let k = 1; k <= 24; k++) fr.push({ t: tN - 720 + k * 30, lat: mra.lat + k * 0.037, lon: mra.lon - k * 0.006, alt: Math.min(28000, 1200 * k), gs: Math.min(450, 150 + 15 * k), trk: 350 });
    L.live.set(tid, { id: tid, hex: '4bd273', reg: 'TC-TSS', type: 'GL5T', cs: 'TCTSS', origin: { id: E.byIcao('LFPB').id, conf: 'low', note: 'seen climbing out of LBG', departedAt: pts[0].t } });
    L.todayCache.set('4bd273', { at: Date.now(), pts, lastPt: pts[pts.length - 1], legs, sums: legs.map(l => E.summarizeLeg(l, null)) });
    w.postMessage({ __tweeksLadd: 'trail', id: tid, first: fr[0], n: fr.length, maxAlt: 28000, pts: fr, at: Date.now() }, '*');
    const lp = fr[fr.length - 1];
    w.postMessage({ __tweeksLadd: 'pos', id: tid, lat: lp.lat, lon: lp.lon, trk: 350, alt: lp.alt, spd: lp.gs, gnd: false, at: Date.now() }, '*');
    await sleep(300);
    const rr = L.composeRoute0(tid, '4bd273');
    check('a new take-off after adsb.lol lost the aircraft landing: this leg from Misrata, not the earlier Paris one', !!rr && rr.originIata === 'MRA' && rr.departedAt > tN - 900, rr && { from: rr.originIata, note: rr.originNote, dep: rr.departedAt && new Date(rr.departedAt * 1000).toISOString().slice(11, 16), to: rr.destIata, p: rr.destP });
    L.live.delete(tid); L.todayCache.delete('4bd273');
  }
  // ... and later that evening, with adsb.lol seeing it again after Misrata (its real trace: lost descending through
  // FL214 at 20:30, seen climbing through FL252 48 km away at 21:39, on to Malta) - still "from Paris" in 22.8.5. With
  // FR24's trail from the Misrata runway, and with one that only starts once airborne.
  for (const variant of ['FR24 trail from the Misrata runway', 'FR24 trail starting airborne']) {
    const tj = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tctss_2026-09-25b.json'), 'utf8'));
    const E = L.engine, raw = E.parseTrace(tj), tN = Math.floor(Date.now() / 1000), shift = tN - raw[raw.length - 1].t;
    const pts = raw.map(p => Object.assign({}, p, { t: p.t + shift }));
    const legs = E.legsFromPoints(pts.map(p => Object.assign({}, p)), {});
    const gi = pts.findIndex((p, k) => k > 0 && p.t - pts[k - 1].t > 3000), after = pts.slice(gi);
    const mra = E.byIcao('HLMS'), tid = variant.includes('runway') ? 0x41d4cccd : 0x41d4ccce, a0 = after[0];
    let fr = after.filter((p, k) => k % 3 === 0).map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs, trk: p.trk }));
    if (variant.includes('runway')) { const g = { t: a0.t - 840, lat: mra.lat, lon: mra.lon, alt: 0, gs: 4, trk: 350 }, climb = []; for (let k = 1; k <= 6; k++) climb.push({ t: g.t + 120 * k, lat: mra.lat + (a0.lat - mra.lat) * k / 7, lon: mra.lon + (a0.lon - mra.lon) * k / 7, alt: Math.round(a0.alt * k / 7), gs: 250, trk: 355 }); fr = [g].concat(climb, fr); }
    L.live.set(tid, { id: tid, hex: '4bd273', reg: 'TC-TSS', type: 'GL5T', cs: 'TCTSS', origin: { id: E.byIcao('LFPB').id, conf: 'low', note: 'seen climbing out of LBG', departedAt: pts[0].t } });
    L.todayCache.set('4bd273', { at: Date.now(), pts, lastPt: pts[pts.length - 1], legs, sums: legs.map(l => E.summarizeLeg(l, null)) });
    w.postMessage({ __tweeksLadd: 'trail', id: tid, first: fr[0], n: fr.length, maxAlt: 28000, pts: fr, at: Date.now() }, '*');
    const lp = pts[pts.length - 1];
    w.postMessage({ __tweeksLadd: 'pos', id: tid, lat: lp.lat, lon: lp.lon, trk: lp.trk, alt: lp.alt, spd: lp.gs, gnd: false, at: Date.now() }, '*');
    await sleep(300);
    const rr = L.composeRoute0(tid, '4bd273');
    const ok = !!rr && rr.originIata !== 'LBG' && (variant.includes('runway') ? rr.originIata === 'MRA' : true) && rr.departedAt > a0.t - 3600;
    check(`TC-TSS seen again after landing at Misrata out of coverage (${variant}): not "from Paris"`, ok && legs.length >= 2, rr && { legs: legs.map(l => l.how).join(','), from: rr.originIata, note: rr.originNote, dep: rr.departedAt && new Date((rr.departedAt - shift) * 1000).toISOString().slice(11, 16), to: rr.destIata, conf: rr.destConf });
    L.live.delete(tid); L.todayCache.delete('4bd273'); L.routeState.delete(tid);
  }
  // F-BOZO (DR221, 25 Sep): on short final into Dinard, and the strip sat at "waiting for its position" - no position
  // from FR24's stream had reached the script for that flight. FR24's own panel shows it: that is enough, at once.
  {
    const fb = 0x41d5aaab, dnr = L.engine.byIcao('LFRD');
    w.document.querySelectorAll('aside[data-testid="aircraft-panel"]').forEach(e => e.remove());
    w.history.pushState({}, '', '/FBOZO/' + fb.toString(16));
    w.postMessage({ __tweeksLadd: 'follow', id: fb }, '*');
    w.document.body.insertAdjacentHTML('beforeend', `<aside data-testid="aircraft-panel"><div data-testid="aircraft-panel__header"><div><div><span data-testid="aircraft-panel__header__callsign">FBOZO</span><span data-testid="aircraft-panel__header__model">DR22</span></div></div></div><main><div><div class="first"></div><div class="relative grid grid-cols-2 gap-0.5 border-white bg-white"><div class="col-span-1 bg-gray-400 text-center leading-4"><div class="mt-1 font-alt-regular text-4xl font-medium text-gray-1300"><div data-testid="base-tooltip"><a href="#" data-testid="aircraft-panel__airport-departure-iata">DNR</a></div></div><div><div class="overflow-hidden"><span data-testid="aircraft-panel__airport-departure-city">Dinard</span></div><p data-testid="aircraft-panel__airport-departure-timezone">CEST (UTC +02:00)</p></div></div><div class="col-span-1 bg-gray-400 text-center leading-4"><div class="mt-1 font-alt-regular text-4xl font-medium text-gray-1300 text-gray-1300"><p data-testid="aircraft-panel__airport-arrival-iata">N/A</p></div><div class="mb-4.5 text-sm font-semibold uppercase leading-relaxed">Not available</div></div></div><div class="grid grid-cols-2"><div class="col-span-1"><p>Barometric alt.</p><p data-testid="aircraft-panel__calibrated-altitude">500 ft</p></div><div class="col-span-1"><p>Track</p><p data-testid="aircraft-panel__track">351<span>°</span></p></div><div class="col-span-1"><p>Ground speed</p><p data-testid="aircraft-panel__ground-speed">70 kts</p></div><div class="col-span-1"><p>ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">383B2E</p></div><div class="col-span-1"><p>Latitude</p><p data-testid="aircraft-panel__lat">48.557</p></div><div class="col-span-1"><p>Longitude</p><p data-testid="aircraft-panel__lng">-2.07146</p></div></div></div></main></aside>`);
    w.postMessage({ __tweeksLadd: 'aircraftInfo', id: fb, hex: '383b2e', reg: 'F-BOZO', type: 'DR22', cs: 'FBOZO' }, '*');
    w.postMessage({ __tweeksLadd: 'sched', id: fb, o: dnr.id, d: 0 }, '*');
    const t0 = Date.now(); let rr = null;
    for (let i = 0; i < 40; i++) { await sleep(100); const s = L.routeState.get(fb); rr = (s && s.route) || (L.pubRecs.get(fb) || {}).route; if (rr && rr.destIata) break; }
    const tRoute = Date.now() - t0; await sleep(250);   // (the panel redraws 40 ms after a route is published)
    const spF = w.document.querySelector('.tl-strip'), txt = spF ? spF.textContent.replace(/\s+/g, ' ').trim() : '';
    check('no position from FR24\'s stream (F-BOZO on short final): FR24\'s own panel position used - Dinard, confirmed, within 2 s', !!rr && rr.destIata === 'DNR' && rr.destConf === 'confirmed' && /Confirmed/.test(txt) && tRoute < 2000, { ms: tRoute, dest: rr && rr.destIata, conf: rr && rr.destConf, why: rr && rr.destReason, strip: txt.slice(0, 160) });
  }
  // UGD111 (Uganda Airlines A330, LGW -> EBB, 25 Sep): FR24 had the route, yet the panel said "predicted Yaounde" - an
  // older record of the same aircraft (its earlier flight, flagged "no destination") was taken for it. (a) the selection
  // is stale and an older record exists; (b) FR24's own frame never reached the script, but its panel shows the route.
  for (const variant of ['stale selection + older record', 'no FR24 frame, route on the panel']) {
    const lgw = L.engine.byIcao('EGKK'), ebb = L.engine.byIcao('HUEN'), hx = '06809b';
    const oldId = variant.startsWith('stale') ? 0x41d50001 : 0x41d50003, newId = variant.startsWith('stale') ? 0x41d50002 : 0x41d50004;
    w.document.querySelectorAll('aside[data-testid="aircraft-panel"]').forEach(e => e.remove());
    L.pubRecs.set(oldId, { id: oldId, hex: hx, reg: '5X-NIL', type: 'A338', cs: 'UGD110', public: true, naDest: true, routeStarted: true, route: { destIata: 'NSI', destId: L.engine.byIcao('FKYS').id, originIata: 'EBB', originId: ebb.id, destConf: 'possible', destP: 15 } });
    L.idHex.set(oldId, hx);
    w.postMessage({ __tweeksLadd: 'follow', id: oldId }, '*');   // the stale selection
    await sleep(50);
    w.history.pushState({}, '', '/UGD111/' + newId.toString(16));
    w.document.body.insertAdjacentHTML('beforeend', `<aside data-testid="aircraft-panel"><div data-testid="aircraft-panel__header"><div><div><span data-testid="aircraft-panel__header__callsign">UGD111</span><span data-testid="aircraft-panel__header__model">A338</span></div></div></div><main><div><div class="first"></div><div class="relative grid grid-cols-2 gap-0.5 border-white bg-white"><div class="col-span-1 bg-gray-400 text-center leading-4"><div><a href="#" data-testid="aircraft-panel__airport-departure-iata">LGW</a></div><div><span data-testid="aircraft-panel__airport-departure-city">London</span></div></div><div class="col-span-1 bg-gray-400 text-center leading-4"><div><a href="#" data-testid="aircraft-panel__airport-arrival-iata">EBB</a></div><div><span data-testid="aircraft-panel__airport-arrival-city">Entebbe</span></div></div></div><div class="grid grid-cols-2"><div class="col-span-1"><p>Barometric alt.</p><p data-testid="aircraft-panel__calibrated-altitude">39,000 ft</p></div><div class="col-span-1"><p>Track</p><p data-testid="aircraft-panel__track">172<span>°</span></p></div><div class="col-span-1"><p>Ground speed</p><p data-testid="aircraft-panel__ground-speed">480 kts</p></div><div class="col-span-1"><p>ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">06809B</p></div><div class="col-span-1"><p>Latitude</p><p data-testid="aircraft-panel__lat">27.9</p></div><div class="col-span-1"><p>Longitude</p><p data-testid="aircraft-panel__lng">7.0</p></div></div></div></main></aside>`);
    if (variant.startsWith('stale')) { w.postMessage({ __tweeksLadd: 'aircraftInfo', id: newId, hex: hx, reg: '5X-NIL', type: 'A338', cs: 'UGD111' }, '*'); w.postMessage({ __tweeksLadd: 'sched', id: newId, o: lgw.id, d: ebb.id }, '*'); }
    await sleep(1500);
    const spU = w.document.querySelector('[data-testid="aircraft-panel"] .tl-strip'), arrU = (w.document.querySelector('[data-testid="aircraft-panel__airport-arrival-iata"]') || {}).textContent;
    check(`FR24 has the route (UGD111 LGW -> EBB, ${variant}): no prediction over it, EBB stays`, arrU === 'EBB' && !(spU && /Predicted|Confirmed/.test(spU.textContent)) && (!variant.startsWith('stale') || L.shownId === newId), { arrival: arrU, strip: spU && spU.textContent.replace(/\s+/g, ' ').trim().slice(0, 100), shown: L.shownId && L.shownId.toString(16) });
    L.pubRecs.delete(oldId); L.pubRecs.delete(newId);
  }
  // RYR86GY (Ryanair EDI -> DUB, 26 Sep): FR24 draws a newly opened panel with the address on screen and both airports
  // "N/A", and fills them in ~10 ms later (recorded live). Taken in that moment for a flight without a destination, it
  // was "predicted" over FR24's own route. With FR24's frame reaching the script late, and not at all.
  for (const variant of ['FR24 frame 300 ms late', 'FR24 frame never seen']) {
    const edi = L.engine.byIcao('EGPH'), dub = L.engine.byIcao('EIDW'), rid = variant.includes('late') ? 0x41d63640 : 0x41d63641, hx = variant.includes('late') ? '4ca9f1' : '4ca9f2';
    w.document.querySelectorAll('aside[data-testid="aircraft-panel"]').forEach(e => e.remove());
    w.history.pushState({}, '', '/RYR86GY/' + rid.toString(16));
    w.postMessage({ __tweeksLadd: 'follow', id: rid }, '*');
    await sleep(30);
    w.document.body.insertAdjacentHTML('beforeend', `<aside data-testid="aircraft-panel"><div data-testid="aircraft-panel__header"><div><div><span data-testid="aircraft-panel__header__callsign">RYR86GY</span><span data-testid="aircraft-panel__header__model">B38M</span></div></div></div><main><div><div class="first"></div><div class="relative grid grid-cols-2 gap-0.5 border-white bg-white"><div class="col-span-1 bg-gray-400 text-center leading-4"><div><a href="#" data-testid="aircraft-panel__airport-departure-iata">N/A</a></div></div><div class="col-span-1 bg-gray-400 text-center leading-4"><div><p data-testid="aircraft-panel__airport-arrival-iata">N/A</p></div><div class="mb-4.5 text-sm font-semibold uppercase leading-relaxed">Not available</div></div></div><div class="grid grid-cols-2"><div class="col-span-1"><p>ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">${hx.toUpperCase()}</p></div><div class="col-span-1"><p>Latitude</p><p data-testid="aircraft-panel__lat">53.9</p></div><div class="col-span-1"><p>Longitude</p><p data-testid="aircraft-panel__lng">-4.9</p></div></div></div></main></aside>`);
    L.syncPanel();   // (the script looks right in that moment)
    await sleep(10);
    const depEl = w.document.querySelector('[data-testid="aircraft-panel__airport-departure-iata"]'), arrEl2 = w.document.querySelector('[data-testid="aircraft-panel__airport-arrival-iata"]');
    depEl.firstChild.data = 'EDI'; arrEl2.firstChild.data = 'DUB'; arrEl2.parentElement.parentElement.children[1].textContent = 'Dublin';
    if (variant.includes('late')) { await sleep(300); w.postMessage({ __tweeksLadd: 'aircraftInfo', id: rid, hex: hx, reg: '9H-VUX', type: 'B38M', cs: 'RYR86GY' }, '*'); w.postMessage({ __tweeksLadd: 'sched', id: rid, o: edi.id, d: dub.id }, '*'); }
    await sleep(2500);
    const spR = w.document.querySelector('[data-testid="aircraft-panel"] .tl-strip'), p = L.pubRecs.get(rid);
    check(`a flight FR24 has a route for, caught while FR24 was still drawing its panel (${variant}): never "predicted"`, !(spR && /Predicted|Confirmed/.test(spR.textContent)) && !(p && p.naDest) && arrEl2.textContent === 'DUB', { strip: spR && spR.textContent.replace(/\s+/g, ' ').trim().slice(0, 80), naDest: p && p.naDest, arrival: arrEl2.textContent });
    L.pubRecs.delete(rid);
  }
  // RYR32AE (EI-DPR, 27 Sep): in at Liverpool from Dublin as RYR23VD / FR446, the crew already on the next callsign at
  // the gate. FR24's panel: no airports, no flight number - only the next flight's scheduled times (FR449 LPL -> DUB,
  // 18:40). It was shown "landed at LPL from DUB" under those times. FR24's own schedule has FR449 LPL -> DUB.
  for (const variant of ['FR449 in FR24\'s schedule', 'nothing in FR24\'s schedule']) {
    const E = L.engine, dub = E.byIcao('EIDW'), lpl = E.byIcao('EGGP'), hx = variant.includes('FR449 in') ? '4ca7b1' : '4ca7b2', reg = variant.includes('FR449 in') ? 'EI-DPR' : 'EI-DPS';
    const rid = variant.includes('FR449 in') ? 0x41dd23bb : 0x41dd23bc, tN = Math.floor(Date.now() / 1000);
    // adsb.lol's trace today: Dublin -> Liverpool, down 3 minutes ago, now at the gate
    const pts = [], dep = tN - 2200, arr = tN - 180;
    for (let k = 0; k < 4; k++) pts.push({ t: dep - 600 + k * 150, lat: dub.lat, lon: dub.lon, alt: null, gs: k ? 12 : 0, trk: 100, gnd: true });
    for (let k = 1; k < 40; k++) { const f = k / 40, alt = Math.round(Math.min(1, Math.min(f, 1 - f) * 4) * 23000); pts.push({ t: Math.round(dep + (arr - dep) * f), lat: dub.lat + (lpl.lat - dub.lat) * f, lon: dub.lon + (lpl.lon - dub.lon) * f, alt, gs: 380, trk: 95 }); }
    for (let k = 0; k < 4; k++) pts.push({ t: arr + k * 40, lat: lpl.lat, lon: lpl.lon, alt: null, gs: k < 2 ? 40 - k * 20 : 0, trk: 90, gnd: true });
    const legs = E.legsFromPoints(pts.map(p => Object.assign({}, p)), {});
    L.todayCache.set(hx, { at: Date.now(), pts, lastPt: pts[pts.length - 1], legs, sums: legs.map(l => E.summarizeLeg(l, null)) });
    // FR24's schedule for the registration (what its registration lookup returns)
    L.fr24.schedules.set(reg, { at: Date.now(), rows: variant.includes('FR449 in') ? [{ id: 0, cs: 'RYR32AE', num: 'FR449', o: lpl.id, d: dub.id, std: tN + 3600, sta: tN + 6900, atd: 0, ata: 0, eta: 0 }, { id: 0x41dcd6a5, cs: 'RYR23VD', num: 'FR446', o: dub.id, d: lpl.id, std: tN - 2700, sta: tN - 600, atd: dep, ata: arr, eta: 0 }] : [] });
    w.document.querySelectorAll('aside[data-testid="aircraft-panel"]').forEach(e => e.remove());
    w.history.pushState({}, '', '/RYR32AE/' + rid.toString(16));
    w.postMessage({ __tweeksLadd: 'follow', id: rid }, '*');
    w.document.body.insertAdjacentHTML('beforeend', `<aside data-testid="aircraft-panel"><div data-testid="aircraft-panel__header"><div><div><span data-testid="aircraft-panel__header__callsign">RYR32AE</span><span data-testid="aircraft-panel__header__model">B738</span></div></div></div><main><div><div class="first"></div><div class="relative grid grid-cols-2 gap-0.5 border-white bg-white"><div class="col-span-1 bg-gray-400 text-center leading-4"><div><a href="#" data-testid="aircraft-panel__airport-departure-iata">N/A</a></div><div class="mb-4.5 text-sm font-semibold uppercase leading-relaxed">Not available</div></div><div class="col-span-1 bg-gray-400 text-center leading-4"><div><p data-testid="aircraft-panel__airport-arrival-iata">N/A</p></div><div class="mb-4.5 text-sm font-semibold uppercase leading-relaxed">Not available</div></div></div><div class="grid grid-cols-2"><div class="col-span-1"><p>ICAO 24-BIT ADDRESS</p><p data-testid="aircraft-panel__hex">${hx.toUpperCase()}</p></div><div class="col-span-1"><p>Latitude</p><p data-testid="aircraft-panel__lat">${lpl.lat}</p></div><div class="col-span-1"><p>Longitude</p><p data-testid="aircraft-panel__lng">${lpl.lon}</p></div></div></div></main></aside>`);
    w.postMessage({ __tweeksLadd: 'aircraftInfo', id: rid, hex: hx, reg, type: 'B738', cs: 'RYR32AE' }, '*');
    w.postMessage({ __tweeksLadd: 'sched', id: rid, o: 0, d: 0, std: tN + 3600, sta: tN + 6900, atd: 0, ata: 0, num: '' }, '*');
    w.postMessage({ __tweeksLadd: 'pos', id: rid, lat: lpl.lat, lon: lpl.lon, trk: 90, alt: 0, spd: 0, gnd: true, at: Date.now() }, '*');
    let rr = null; for (let i = 0; i < 40; i++) { await sleep(100); const s = L.routeState.get(rid); rr = (s && s.route) || (L.pubRecs.get(rid) || {}).route; if (rr && (variant.includes('FR449 in') ? rr.destIata : rr.originIata) && i > 15) break; }
    await sleep(250);
    const spS = w.document.querySelector('[data-testid="aircraft-panel"] .tl-strip'), txt = spS ? spS.textContent.replace(/\s+/g, ' ').trim() : '';
    const dep2 = (w.document.querySelector('[data-testid="aircraft-panel__airport-departure-iata"]') || {}).textContent, arr2 = (w.document.querySelector('[data-testid="aircraft-panel__airport-arrival-iata"]') || {}).textContent;
    const ok = !!rr && !rr.landed && !/Landed/i.test(txt) && rr.originIata === 'LPL' && (variant.includes('FR449 in') ? rr.destIata === 'DUB' && rr.destConf === 'filed' && /FR449/.test(rr.destReason) && /DUB/.test(arr2 || '') : rr.destIata !== 'LPL');
    check(`at the gate on the next flight's callsign (RYR32AE, ${variant}): the flight about to depart from LPL - not "landed at LPL from DUB"`, ok, rr && { from: rr.originIata, to: rr.destIata, conf: rr.destConf, why: rr.destReason, phase: rr.phase, landed: rr.landed, panel: dep2 + ' -> ' + arr2, strip: txt.slice(0, 180) });

    L.pubRecs.delete(rid); L.todayCache.delete(hx);
  }
  // Isle of Man / Guernsey / Bermuda... aircraft take their transponder address from the UK's block: the registration
  // prefix says where they are registered (M-ARNZ, 424C60, was "United Kingdom")
  {
    // (every nationality mark since 22.11: T7-AFP wears 50043E, just past San Marino's block)
    const got = ['M-ARNZ', 'M-CDJC', '2-FLYY', 'VP-BLK', 'VP-CAL', 'G-SOON', 'N85M', 'T7-AFP'].map(r => [r, (L.regCountry(r) || {}).name || '-']);
    check('country of registration from the registration\'s nationality mark (Isle of Man, Guernsey, Bermuda, Cayman, San Marino...)', got.map(x => x[1]).join(',') === 'Isle of Man,Isle of Man,Guernsey,Bermuda,Cayman Islands,United Kingdom,United States,San Marino', got);
  }
  // I-ADVD (30 Sep): matched from adsb.fi with no callsign and shown as "I-ADVD" for the whole flight while adsb.lol had
  // SIO512 - the callsign reported after the match takes over; with none known, the registration without its hyphen
  {
    const cid = 0x41d4dddd;
    L.live.set(cid, { id: cid, hex: '3004c7', reg: 'I-ADVD', type: 'GLF5', cs: '' });
    L.noteCands([{ hex: '3004c7', cs: 'SIO512', reg: 'I-ADVD', type: 'GLF5', ageS: 2, receivedAt: Date.now(), lat: 44.1, lon: 12.9, alt: 24000, gs: 420, trk: 291 }]);
    await sleep(50);
    const sent = posted.filter(p => p && p.__tweeksLadd === 'resolve').flatMap(p => p.entries || []).filter(e => Number(e.id) === cid).pop();
    check('a callsign reported after the match replaces the registration (I-ADVD -> SIO512), page told', L.live.get(cid).cs === 'SIO512' && !!sent && sent.cs === 'SIO512', { rec: L.live.get(cid).cs, sent: sent && sent.cs });
    L.noteCands([{ hex: '3004c7', cs: 'IADVD', reg: 'I-ADVD', ageS: 400, receivedAt: Date.now() - 400000, lat: 44.1, lon: 12.9 }]);
    check('an older report does not undo it', L.live.get(cid).cs === 'SIO512', L.live.get(cid).cs);
    L.live.delete(cid);
    const both = [L.csOfRec({ reg: 'I-ADVD', cs: '' }), L.csOfRec({ reg: 'N870AR' }), L.csOfRec({ reg: 'G-FRAU', cs: 'GFRAU' }), H.csOf({ reg: 'OE-HIM' }), H.csOf({ reg: 'OE-HIM', cs: 'AOJ73M' })];
    check('no callsign known: the registration as a transponder sends it, no hyphen (script and page)', both.join(',') === 'IADVD,N870AR,GFRAU,OEHIM,AOJ73M', both);
  }
  // M-BIZZ (GLF6, 1 Oct): mid-Atlantic, FR24 tracking it by satellite, no public network hearing it - last heard leaving
  // Bermuda 70 minutes before, north-east at FL410. Carried forward to now, it is where FR24 draws the flight.
  {
    const hexB = '43ffe1', t0b = Date.now() - 70 * 60000, idB = 0x41ed4ac6;
    L.noteCands([{ hex: hexB, cs: 'MZZQX', reg: 'M-ZZQX', type: 'GLF6', ladd: true, ageS: 0, receivedAt: t0b, lat: 33.2, lon: -63.9, alt: 41000, gs: 480, trk: 47, gnd: false, src: 'adsb.lol' },
      // (another G650 that went quiet elsewhere - must not be taken for it)
      { hex: 'a1b2c3', cs: 'N650XX', reg: 'N650XX', type: 'GLF6', ageS: 0, receivedAt: t0b, lat: 40.6, lon: -73.0, alt: 43000, gs: 470, trk: 80, gnd: false, src: 'adsb.lol' }]);
    const [la, lo] = L.engine.destPoint(33.2, -63.9, 47, 480 * 1.852 * 70 / 60);
    L.pending.set(idB, { id: idB, lat: la + 0.15, lon: lo - 0.2, alt: 41000, spd: 480, trk: 50, gnd: false, type: 'GLF6', reg: '', receivedAt: Date.now(), serverTime: 0, ts: 0 });
    await L.resolveTargeted(idB, 'test');
    const rb = L.live.get(idB);
    check('out of coverage over an ocean: identified from where it was last heard, carried forward (M-BIZZ)', !!rb && rb.hex === hexB, rb ? { hex: rb.hex, sources: rb.sources } : 'not identified');
    L.live.delete(idB); L.pending.delete(idB);
  }
  // "Recent <reg> flights": the list of the aircraft on screen is handed to the page before anyone opens the dropdown
  {
    // (only when something is known of its flights: an aircraft with no trace today and no log yet has nothing to hand over
    // but the flight on screen - one row, which FR24's list skips - judged once its loads have settled, or a trace still on
    // its way reads as nothing known)
    const hexF = (posted.find(p => p && p.__tweeksLadd === 'aircraftInfo') || {}).hex;
    for (let i = 0; i < 40 && hexF && ((L.todayCache.get(String(hexF).toLowerCase()) || {}).loading || [...L.routeState.values()].some(v => v.hex === String(hexF).toLowerCase() && v.working)); i++) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 600));
    // (its own list only: the other aircraft on screen are warmed too, each judged by what is known of it)
    const regF = (posted.find(p => p && p.__tweeksLadd === 'aircraftInfo') || {}).reg;
    const warm = posted.filter(p => p && p.__tweeksLadd === 'hist' && p.reg === regF);
    if (process.env.DEBUG_HIST) console.log(JSON.stringify({ hexF, pub: [...L.pubRecs.values()].map(r => [r.id, r.hex, r.reg]), shown: L.shownId, sel: L.selectedId, rs: [...L.routeState.entries()].map(([k, v]) => [k, !!v.working, !!v.route]), today: [...L.todayCache.entries()].map(([k, v]) => [k, (v.sums || []).length, !!v.failAt]), hist: !!hexF && !!L.store.peekHist(String(hexF).toLowerCase()) }));
    const known =!!hexF && (!!((L.todayCache.get(String(hexF).toLowerCase()) || {}).sums || []).length || !!L.store.peekHist(String(hexF).toLowerCase()));
    check('"Recent flights" list handed to the page ahead of the click (answered at once when opened)', known ? warm.length > 0 && H.hist.has(regF) : warm.every(p => !p.data || p.data.length <= 1), { known, posts: warm.length, lens: warm.map(p => p.data ? p.data.length : null), partial: warm.map(p => !!p.partial), regs: [...H.hist.keys()] });
  }
  // 22.10: the population tables unpack at start; METARs come in for the fields asked; the wind changes the ETA; every
  // reconstructed flight is learned with its take-off time, callsign, type and flow cells
  {
    const T2 = L.engine.T2;
    check('population tables: the monitor\'s alone - none in the script (1.1.0); the monitor\'s own as it loads them (directional pairs, flow field, type performance)', typeof L.loadT2 === 'undefined' && !/ROUTE_T2_GZ|APPR_TABLE_GZ|ROUTE_TABLES/.test(SRC) && !!T2 && Object.keys(T2.od2 || {}).length > 1000 && Object.keys(T2.flow || {}).length > 1000 && Object.keys(T2.tperf || {}).length > 50, T2 && { od2: Object.keys(T2.od2 || {}).length, flow: Object.keys(T2.flow || {}).length, types: Object.keys(T2.tperf || {}).length });
    let got = false; L.wantWx(['EGLL', 'LFPG', 'KTEB'], () => { got = true; });
    for (let i = 0; i < 40 && !got; i++) await sleep(250);
    const e = L.wxMap.get('EGLL');
    check('METARs for the fields asked (aviationweather.gov): category, wind', got && !!e && /^(VFR|MVFR|IFR|LIFR)$/.test(e.cat) && Number.isFinite(e.ws), e && { cat: e.cat, wd: e.wd, ws: e.ws, raw: e.raw.slice(0, 60) });
    const dest = L.engine.byIcao('LFPB'), p0 = { lat: 50.5, lon: 1.0, alt: 30000, gs: 450, trk: 150, t: Math.floor(Date.now() / 1000) };
    const calm = L.estimateEta(Object.assign({}, p0, { tas: 450, ws: 0, wd: 0 }), dest, 'bizjet'), head = L.estimateEta(Object.assign({}, p0, { tas: 450, ws: 80, wd: 160 }), dest, 'bizjet');
    check('ETA from the wind triangle: an 80 kt headwind on the course to it makes it later', head > calm + 60, { calm: new Date(calm * 1000).toISOString().slice(11, 16), headwind: new Date(head * 1000).toISOString().slice(11, 16) });
    const l2 = L.store.kvGet('learn2') || [];
    check('flights learned with take-off time, callsign, type and flow cells (learn2)', !l2.length || (l2[l2.length - 1].length >= 12), l2.length ? l2[l2.length - 1].slice(1, 11) : 'none learned in this run');
  }
  const errs = w.__logs.filter(l => /ERROR|route failed|TypeError|ReferenceError/.test(l));
  check('no script errors', !errs.length, errs.slice(0, 5));
  console.log(w.__logs.filter(l => /route|public|sched/i.test(l)).slice(0, 10).join('\n'));
  process.exit(0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
