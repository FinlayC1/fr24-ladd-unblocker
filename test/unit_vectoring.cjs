// Vectored for an airport (the BUILT userscript in jsdom, its own engine and learned tables): N99GY, a Gulfstream IV-SP
// from Wilmington, NC to Dublin on 14 Oct 2026, taken round the east of Dublin for its runway 28. Its arrival is
// rebuilt from the user's screenshot (the map calibrated on Dublin Airport, Skerries and Amlwch), the Atlantic part on the
// great circle. The panel showed "also possible: Anglesey" over the Irish Sea: an airport the engine gave a hundredth of a
// percent, multiplied a thousandfold when the shown odds for Dublin were capped at 98%. Checked, moment by moment from the
// Irish coast to the runway, with the track known from take-off and with it known only from the coast:
//   - Dublin on top, and shown at 90% or more once it has been descending into it at 90% (the dip on the downwind leg,
//     levelling at 7,000 ft heading away from Dublin - 64% by the engine alone - held);
//   - no alternative offered that the engine gives under 2%, Anglesey never;
//   - the old scaling would have offered such an airport (the bug, shown to exist on this flight).
// And a real diversion is not held: climbing away, or gone beyond 80 km.
// usage: node test/unit_vectoring.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2], DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const RWY = JSON.parse(fs.readFileSync(path.join(DATA, 'runways.json'), 'utf8')), RWL = JSON.parse(fs.readFileSync(path.join(DATA, 'runway_len.json'), 'utf8'));

function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53.40,-6.20/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  const answer = url => /flightradar24\.com\/mobile\/airports\/format/.test(url) ? [200, AIRPORTS] : [404, ''];
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.postMessage = () => {}; win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  L.engine.setRunways(RWY); L.engine.setRunwayLengths(RWL);
  const t2 = await L.loadT2().catch(() => false), ap = await Promise.resolve(L.loadApprTable()).catch(() => false);
  const E = L.engine, ilm = E.byIcao('KILM'), dub = E.byIcao('EIDW'), vly = E.byIcao('EGOV');
  check('the engine as the browser runs it: airports, the population tables, the arrival paths', E.airports.length > 5000 && !!t2 && !!ilm && !!dub && !!vly, { t2: !!t2, appr: !!ap });

  // ---- N99GY's flight
  const t0 = Date.parse('2026-10-14T13:53:00Z') / 1000, pts = [];
  function seg(to, altTo, gs, step) {
    const a = pts[pts.length - 1], km = E.dist(a.lat, a.lon, to[0], to[1]), secs = km / (gs * 1.852) * 3600, n = Math.max(1, Math.round(secs / (step || 20)));
    for (let k = 1; k <= n; k++) { const f = k / n, lat = a.lat + (to[0] - a.lat) * f, lon = a.lon + (to[1] - a.lon) * f, prev = pts[pts.length - 1]; pts.push({ t: Math.round(a.t + secs * f), lat, lon, alt: Math.round(a.alt + (altTo - a.alt) * f), gs, trk: E.brg(prev.lat, prev.lon, lat, lon), gnd: false, vr: (altTo - a.alt) / (secs / 60) }); }
  }
  function gc(to, altTo, gs) {
    const a = pts[pts.length - 1], r = Math.PI / 180, p1 = [a.lat * r, a.lon * r], p2 = [to[0] * r, to[1] * r];
    const d = 2 * Math.asin(Math.sqrt(Math.sin((p2[0] - p1[0]) / 2) ** 2 + Math.cos(p1[0]) * Math.cos(p2[0]) * Math.sin((p2[1] - p1[1]) / 2) ** 2));
    for (let i = 1; i <= 40; i++) {
      const f = i / 40, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(p1[0]) * Math.cos(p1[1]) + B * Math.cos(p2[0]) * Math.cos(p2[1]), y = A * Math.cos(p1[0]) * Math.sin(p1[1]) + B * Math.cos(p2[0]) * Math.sin(p2[1]), z = A * Math.sin(p1[0]) + B * Math.sin(p2[0]);
      seg([Math.atan2(z, Math.sqrt(x * x + y * y)) / r, Math.atan2(y, x) / r], a.alt + (altTo - a.alt) * f, gs, 60);
    }
  }
  pts.push({ t: t0, lat: ilm.lat, lon: ilm.lon, alt: 0, gs: 140, trk: 60, gnd: true });
  seg([34.6, -77.2], 15000, 300); seg([35.6, -75.5], 41000, 430); gc([53.55, -10.4], 41000, 470);
  seg([53.65, -8.9], 30000, 440); seg([53.70, -7.5], 16000, 380); seg([53.70, -6.567], 9000, 290);
  const coast = pts.length - 1;
  // (round the east of Dublin: out over the Irish Sea heading east-south-east, levelling at 7,000 ft, south, west for 28)
  for (const [la, lo, al, gs] of [[53.689, -6.474, 8500, 260], [53.67, -6.303, 7300, 250], [53.652, -6.146, 7000, 240], [53.638, -5.974, 7000, 230], [53.631, -5.881, 6000, 220], [53.603, -5.817, 5000, 210], [53.566, -5.781, 4000, 210], [53.537, -5.763, 4000, 200], [53.52, -5.774, 3800, 190], [53.496, -5.831, 3500, 180], [53.45, -5.946, 3000, 170], [53.415, -6.046, 2500, 160], [53.418, -6.146, 1800, 150], [53.42, -6.21, 900, 140]]) seg([la, lo], al, gs, 10);
  const ac = { hex: 'add0f7', type: 'GLF4', reg: 'N99GY', mil: false, country: 'United States', cat: 'A3' }, cls = E.classify(ac), hs = E.histStats([], t0);

  function replay(label, from, origin, id) {
    const out = { tops: [], minShown: 100, minShownDescending: 100, badAlts: [], oldBad: [], vly: 0 };
    let sinceSure = false;
    for (let i = coast; i < pts.length - 1; i += 3) {
      const p = pts[i], trail = []; for (const q of pts.slice(from, i + 1)) if (!trail.length || q.t - trail[trail.length - 1].t >= 20) trail.push(q);
      const pred = E.predict({ ac, pos: p, trail, hs, now: p.t, origin }); if (!pred) continue;
      const cands = L.holdTerminal(id, p, pred, { heli: false, cls, planned: false }), top = cands[0];
      const destP = Math.min(99, Math.round(Math.min(0.99, E.calibrated(top.p, cls)) * 100));
      const alts = L.altsOf(cands, top.airport.id, top.p, destP, top.p < 0.999);
      out.tops.push(top.airport.code);
      if (sinceSure) out.minShownDescending = Math.min(out.minShownDescending, top.airport.id === dub.id ? destP : 0);
      if (top.airport.id === dub.id && pred.phase === 'descent' && top.p >= 0.9) sinceSure = true;
      if (process.env.DEBUG) console.log(label, new Date(p.t * 1000).toISOString().slice(11, 19), p.alt, Math.round(p.trk), pred.phase, (pred.cands[0].p * 100).toFixed(1), pred.cands[0].airport.code, '->', top.airport.code, (top.p * 100).toFixed(1), destP, sinceSure);
      out.minShown = Math.min(out.minShown, top.airport.id === dub.id ? destP : 0);
      for (const a of alts) { const c = cands.find(x => [x.airport.code, x.airport.iata, x.airport.icao].includes(a.iata)); if (!c || c.p < 0.02) out.badAlts.push(a.iata); if (a.iata === 'VLY') out.vly++; }
      // (the old scaling, on the engine's own odds: what it would have offered)
      const raw = pred.cands, oTop = raw[0], oShown = Math.min(99, Math.round(Math.min(0.99, E.calibrated(oTop.p, cls)) * 100)), oK = oTop.p < 0.999 ? Math.max(0, (1 - oShown / 100) / (1 - oTop.p)) : 1;
      for (const c of raw.slice(1, 4)) if (c.p * oK >= 0.04 && c.p < 0.02) out.oldBad.push(`${c.airport.code} ${(c.p * 100).toFixed(2)}% -> ${Math.round(c.p * oK * 100)}%`);
    }
    return out;
  }
  const a = replay('known from take-off', 0, { airport: ilm, conf: 'ground', departedAt: t0 }, 9001), b = replay('known from the coast', coast, null, 9002);
  for (const [name, r] of [['track known from take-off', a], ['track known only from the Irish coast', b]]) {
    check(`N99GY, ${name}: Dublin on top all the way from the coast to the runway`, r.tops.every(c => c === 'DUB'), [...new Set(r.tops)]);
    check(`... shown at 90% or more once it has been descending into it at 90% - through the downwind leg and its level-off`, r.minShownDescending >= 90, r.minShownDescending);
    check('... no alternative offered that the engine gives under 2% - Anglesey never', r.badAlts.length === 0 && r.vly === 0, { bad: r.badAlts.slice(0, 5), vly: r.vly });
  }
  // (the old scaling against the new, where it bit: Dublin at 99.97% by the engine, shown as 85% because this browser's
  // own record of hits and misses says so, the others sharing the 15% left in proportion - five hundredfold)
  { const tiny = [{ airport: dub, p: 0.9997, dist: 40 }, { airport: vly, p: 0.0002, dist: 90 }, { airport: E.byIcao('EGNS'), p: 0.0001, dist: 120 }], oldK = (1 - 0.85) / (1 - 0.9997);
    const nowAlts = L.altsOf(tiny, dub.id, 0.9997, 85, true);
    check('the old scaling: Dublin at 99.97% shown as 85% made Anglesey (0.02%) "also possible" at ' + Math.round(0.0002 * oldK * 100) + '%; now it is not offered', 0.0002 * oldK >= 0.04 && nowAlts.length === 0, nowAlts); }
  { const fair = [{ airport: dub, p: 0.62, dist: 40 }, { airport: vly, p: 0.3, dist: 90 }, { airport: E.byIcao('EGNS'), p: 0.05, dist: 120 }];
    const alts = L.altsOf(fair, dub.id, 0.62, 55, true);
    check('... a real contender still is (Anglesey 30% against Dublin 62% shown as 55%): offered, under the airport shown', alts.length === 2 && alts[0].p >= 30 && alts[0].p < 55 && alts[1].p >= 4, alts); }
  // ---- not held when it really goes elsewhere
  { const id = 9100, base = pts.findIndex(p => p.lat < 53.55 && p.lon > -5.8);
    const p0 = pts[base], mk = (o, d) => Object.assign({}, p0, o, { t: p0.t + d });
    const sure = { phase: 'descent', cands: [{ airport: dub, p: 0.99, dist: E.dist(p0.lat, p0.lon, dub.lat, dub.lon) }, { airport: vly, p: 0.01, dist: 90 }] };
    L.holdTerminal(id, mk({}, 0), sure, { heli: false, cls });
    const doubt = { phase: 'level', cands: [{ airport: vly, p: 0.6, dist: 90 }, { airport: dub, p: 0.4, dist: 40 }] };
    const held = L.holdTerminal(id, mk({ vr: 0 }, 120), doubt, { heli: false, cls });
    check('held: two minutes after descending into Dublin at 99%, a level moment that doubts it - Dublin kept on top', held[0].airport.id === dub.id && held[0].p > 0.9, held.map(c => [c.airport.code, +c.p.toFixed(3)]));
    const climb = L.holdTerminal(id, mk({ vr: 1500 }, 180), doubt, { heli: false, cls });
    check('... climbing away (a go-around, a diversion): let go', climb[0].airport.id === vly.id, climb.map(c => [c.airport.code, +c.p.toFixed(3)]));
    L.holdTerminal(id + 1, mk({}, 0), sure, { heli: false, cls });
    const late = L.holdTerminal(id + 1, mk({}, 16 * 60), doubt, { heli: false, cls });
    check('... more than 15 minutes on: let go', late[0].airport.id === vly.id);
    L.holdTerminal(id + 2, mk({}, 0), sure, { heli: false, cls });
    const planned = L.holdTerminal(id + 2, mk({}, 60), doubt, { heli: false, cls, planned: true });
    check('... a filed flight plan, or a helicopter: never held', planned[0].airport.id === vly.id && L.holdTerminal(id + 3, mk({}, 60), doubt, { heli: true, cls })[0].airport.id === vly.id); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
