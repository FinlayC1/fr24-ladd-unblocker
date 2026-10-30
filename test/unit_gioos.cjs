// G-IOOS, 15 Oct 2026 (the BUILT userscript in jsdom): Castle Air's Agusta A109S (408097), FR24's own trail (MLAT) from
// near Leominster south-west to Swansea Bay at 1,100 ft. The panel said "took off from MAN, 08:09Z" - eleven minutes into
// the flight FR24 was already showing, 150 km from Manchester. A few public ADS-B reports under its address put it on the
// ground at Manchester in the middle of that flight are dropped from its track already (checked). Wherever the take-off at
// Manchester came from - a departure worked out earlier for the same flight id is kept for it and stands over weaker ones -
// it is one the aircraft cannot have made: 230 km to where it is in 24 minutes, at 137 kt. Such a departure is now neither
// kept nor shown, while a real one (from Manchester, an hour before, a track that fits) still is.
// usage: node test/unit_gioos.cjs <node_modules dir> <data dir>
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
  // (1.1.0: the route code the monitor runs, with the tables as the monitor has them - here on what this browser has)
  await require('./monfake.cjs').tablesInto(L.engine);
  const E = L.engine, man = E.byIcao('EGCC');
  check('the engine as the browser runs it, with Manchester', !!man);
  const hex = '408097';
  let nextId = 7300;
  // FR24's trail (MLAT): from near Leominster at 1,100 ft, south-west at 137 kt to Swansea Bay, the last 35 minutes.
  // Public ADS-B under the same address: the same track, and - when `ghost` - a few reports at Manchester on the ground
  // in the middle of it, 150 km away, as though a second transponder there answered with the same address.
  function flight(o) {
    o = o || {};
    const now = Math.floor(Date.now() / 1000), T0 = now - 35 * 60, fr = [];
    let p = [52.30, -2.55];
    for (let t = T0; t <= now; t += 20) { fr.push({ t, lat: p[0], lon: p[1], alt: 1100, gs: 137, trk: 233 }); p = E.destPoint(p[0], p[1], 233, 137 * 1.852 * 20 / 3600); }
    const lol = fr.filter((q, i) => i % 2 === 0 && q.t > T0 + 120).map(q => Object.assign({}, q, { lat: q.lat + 0.002, gnd: false }));
    if (o.ghost) {
      const tg = T0 + 11 * 60, at = lol.findIndex(q => q.t > tg);
      const g = [0, 1, 2].map(k => ({ t: tg - 60 + k * 20, lat: man.lat + 0.003, lon: man.lon - 0.004, alt: null, gs: 0, trk: 0, gnd: true }));
      lol.splice(at, 0, ...g);
    }
    return { fr, lol };
  }
  async function route(f, kept) {
    const id = nextId++;
    L.pubRecs.set(id, { id, hex, reg: 'G-IOOS', type: 'A109', cs: 'GIOOS', public: true, origin: kept || undefined });
    w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { __tweeksLadd: 'trail', id, first: f.fr[0], n: f.fr.length, maxAlt: 1100, pts: f.fr } }));
    L.todayCache.set(hex, { at: Date.now(), pts: f.lol, lastPt: f.lol[f.lol.length - 1], legs: E.legsFromPoints(f.lol, { cls: 'heli', heli: true, type: 'A109' }), sums: [] });
    await sleep(20);
    const pos = Object.assign({}, f.fr[f.fr.length - 1]);
    const trail = L.trailFor(id, hex, pos), r = L.composeRoute0(id, hex, { pos });
    return { trail, r, o: r && { from: r.originIata || '', note: r.originNote, conf: r.originConf } };
  }
  { const x = await route(flight({ ghost: true }));
    check('G-IOOS: reports at Manchester under its address while FR24 has it over the Welsh border -> not "took off from MAN"', x.o && x.o.from !== 'MAN', x.o);
    check('... nothing at Manchester left in its track', !x.trail.some(p => E.dist(p.lat, p.lon, man.lat, man.lon) < 20), { n: x.trail.length, first: x.trail[0] && [+x.trail[0].lat.toFixed(3), +x.trail[0].lon.toFixed(3)] });
    check('... the track starts where FR24 first had it', x.trail.length && E.dist(x.trail[0].lat, x.trail[0].lon, 52.30, -2.55) < 2); }
  const now = Math.floor(Date.now() / 1000);
  { const x = await route(flight(), { id: man.id, conf: 'ground', note: 'took off from MAN', departedAt: now - 24 * 60 });
    check('G-IOOS: "took off from MAN" 24 minutes ago kept for this flight, 230 km off at 137 kt -> not shown (was "took off from MAN, 08:09Z")', x.o && x.o.from !== 'MAN', x.o);
    check('... and not kept for it either', !(L.pubRecs.get(nextId - 1).origin && L.pubRecs.get(nextId - 1).origin.id === man.id)); }
  { const f = flight(), t0 = f.fr[0].t;
    // (from Manchester for real: down the Marches at 137 kt, FR24's trail from the take-off)
    const pre = []; let p = [man.lat, man.lon]; for (let t = t0 - 60 * 50; t < t0; t += 20) { pre.push({ t, lat: p[0], lon: p[1], alt: t === t0 - 3000 ? 0 : 1100, gs: t === t0 - 3000 ? 0 : 137, trk: 200 }); p = E.destPoint(p[0], p[1], E.brg(p[0], p[1], 52.30, -2.55), 137 * 1.852 * 20 / 3600); }
    f.fr = pre.concat(f.fr); f.lol = [];
    const x = await route(f, { id: man.id, conf: 'ground', note: 'took off from MAN', departedAt: t0 - 3000 });
    check('a real take-off from Manchester 85 minutes ago, a track that fits: still "took off from MAN"', x.o && x.o.from === 'MAN', x.o); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
