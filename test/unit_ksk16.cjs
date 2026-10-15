// KSK16, 15 Oct 2026 (the BUILT userscript in jsdom): a Challenger 605 (4BF295) out of Ankara (Etimesgut, LTAD, 2,642 ft)
// for Nairobi. FR24's trail runs from the runway west and south-west of Ankara, climbing, and stops there; public ADS-B
// hears it again an hour on over the Mediterranean at FL368. The panel said "departure unknown, first seen at FL368".
// FR24 leaves out a height it does not have, so a trail point without one reads 0 ft: one such point after the climb was
// taken for the aircraft down low, the hour's hole after it for a landing, and everything before it - the take-off -
// was cut off as another leg. Checked: the take-off stays (one point without a height, or several), and what such a
// point must still mean is unchanged (0 ft on the runway taking off or landing, at a field 2,600 ft up).
// usage: node test/unit_ksk16.cjs <node_modules dir> <data dir>
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

function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/39.90,32.40/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  const answer = url => /flightradar24\.com\/mobile\/airports\/format/.test(url) ? [200, AIRPORTS] : [404, ''];
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  const E = L.engine, ank = E.byIcao('LTAD');
  check('the engine as the browser runs it, with Ankara (Etimesgut) at 2,600 ft', !!ank && ank.alt > 2500, ank && { code: ank.code, alt: ank.alt });
  const hex = '4bf295';
  let nextId = 7100;
  // FR24's trail: the take-off roll on runway 29 at 0 ft, a climb west then south-west, lost 75 km out at FL180; then
  // `noHeight` points with no height (read 0 ft) further on. Public ADS-B: heard again an hour later 660 km south at FL368.
  function flight(o) {
    o = o || {};
    const T0 = Math.floor(Date.now() / 1000) - 3 * 3600, fr = [];
    let t = T0, p = [ank.lat, ank.lon], alt = 0, trk = 290;
    for (let i = 0; i < 300; i++) {
      const gs = Math.min(320, 120 + i * 8);
      fr.push({ t, lat: p[0], lon: p[1], alt: Math.round(alt), gs, trk });
      trk = i < 20 ? 285 : 235; p = E.destPoint(p[0], p[1], trk, gs * 1.852 * 15 / 3600); t += 15;
      alt = i < 2 ? 0 : Math.min(18000, Math.max(2700, alt) + 450);
      if (E.dist(ank.lat, ank.lon, p[0], p[1]) > 75) break;
    }
    for (let k = 0; k < (o.noHeight || 0); k++) { const q = fr[fr.length - 1], n = E.destPoint(q.lat, q.lon, 160, 8); fr.push({ t: q.t + 60, lat: n[0], lon: n[1], alt: 0, gs: 480, trk: 160 }); }
    const lol = []; let q = E.destPoint(ank.lat, ank.lon, 170, 660), tt = fr[fr.length - 1].t + 70 * 60;
    for (let i = 0; i < 150; i++) { lol.push({ t: tt, lat: q[0], lon: q[1], alt: i < 10 ? 36800 : 37000, gs: 508, trk: 148, gnd: false }); q = E.destPoint(q[0], q[1], 148, 508 * 1.852 * 30 / 3600); tt += 30; }
    return { fr, lol };
  }
  async function route(f, o) {
    o = o || {};
    const id = nextId++;
    if (!o.noFr24) w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { __tweeksLadd: 'trail', id, first: f.fr[0], n: f.fr.length, maxAlt: 37000, pts: f.fr } }));
    L.todayCache.set(hex, { at: Date.now(), pts: f.lol, lastPt: f.lol[f.lol.length - 1], legs: E.legsFromPoints(f.lol, { cls: 'jet', type: 'CL60' }), sums: [] });
    await sleep(20);
    const pos = Object.assign({}, f.lol[f.lol.length - 1], { t: Math.floor(Date.now() / 1000) });
    const trail = L.trailFor(id, hex, pos), r = L.composeRoute(id, hex, { pos });
    return { trail, r, o: r && { from: r.originIata || '', note: r.originNote, conf: r.originConf } };
  }

  // ---- the bug: one point without a height after the climb
  { const x = await route(flight({ noHeight: 1 }));
    check('KSK16: FR24 lost it climbing out of Ankara, one trail point after that without a height -> departed ANK (was "unknown, first seen at FL368")', x.o && x.o.from === 'ANK', x.o);
    check('... the take-off is still the start of its track (not cut off as another leg)', x.trail.length > 0 && x.trail[0].alt === 0 && E.dist(x.trail[0].lat, x.trail[0].lon, ank.lat, ank.lon) < 3 && !x.trail.cut, { first: x.trail[0] && x.trail[0].alt, cut: !!x.trail.cut });
    check('... and that point has no height, not 0 ft', x.trail.some(p => p.alt == null && p.gs === 480)); }
  { const x = await route(flight({ noHeight: 4 }));
    check('... four such points: departed ANK', x.o && x.o.from === 'ANK', x.o); }
  // ---- unchanged
  { const x = await route(flight());
    check('the same flight with every height there: departed ANK, seen climbing out of it', x.o && x.o.from === 'ANK' && x.o.conf === 'low', x.o); }
  { const x = await route(flight({ noHeight: 1 }), { noFr24: true });
    check('no FR24 trail at all, only public ADS-B from FL368: no airport made up ("first seen at FL368")', x.o && !x.o.from && /FL368/.test(x.o.note), x.o); }
  // (0 ft at speed on the runway of a field 2,600 ft up: taking off, and landing after being low over it, stays 0 ft)
  { const f = flight();
    const id = nextId++, t = f.fr[f.fr.length - 1].t + 3600, rwy = E.destPoint(ank.lat, ank.lon, 110, 0.6);
    const land = f.fr.concat([{ t, lat: E.destPoint(ank.lat, ank.lon, 290, 4)[0], lon: E.destPoint(ank.lat, ank.lon, 290, 4)[1], alt: 3500, gs: 140, trk: 110 }, { t: t + 60, lat: rwy[0], lon: rwy[1], alt: 0, gs: 115, trk: 110 }, { t: t + 75, lat: ank.lat, lon: ank.lon, alt: 0, gs: 40, trk: 110 }]);
    w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { __tweeksLadd: 'trail', id, first: land[0], n: land.length, maxAlt: 18000, pts: land } }));
    L.todayCache.delete(hex); await sleep(20);
    const tr = L.trailFor(id, '', Object.assign({}, land[land.length - 1], { gnd: true }));
    const roll = tr.find(p => p.t === t + 60);
    check('a landing roll at Ankara at 115 kt, 0 ft a minute after 3,500 ft: still 0 ft on the runway', !!roll && roll.alt === 0, roll && { alt: roll.alt, gnd: roll.gnd }); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
