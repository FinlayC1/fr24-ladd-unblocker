// "Recent <reg> flights" (the BUILT userscript in jsdom): the flight an aircraft is flying now is the list's first entry,
// which FR24 hides - it is never listed again below it as a flight of the log. N212AP as WWI21 (MAN -> TEB, FR24's own
// route) and VQ-BXF as PEX28F (RTM -> LCY) were listed under their own flight as "Manchester -> N/A, Unknown": with no
// route of the userscript's, they were taken for on the ground. Checked:
//   - an ordinary flight FR24 routes itself (departed, not arrived): its leg of the log not listed; the one before is
//   - the same with nothing from FR24 but its position in the air: the same
//   - asked by the page (needHist) as well as handed over ahead of time
//   - a blocked flight with a route of the userscript's: the same, and an older flight last heard high stays listed
//   - an aircraft on the ground after landing: its last flight still listed first
// usage: node test/unit_recent.cjs <node_modules dir> <data dir>
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
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53.35,-2.27/8', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  const answer = url => /flightradar24\.com\/mobile\/airports\/format/.test(url) ? [200, AIRPORTS] : [404, ''];
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {};
  // (what the userscript hands the page kept; the page's own messages delivered to it as the browser does)
  win.__posted = []; win.postMessage = data => { win.__posted.push(data); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}

(async () => {
  const w = makeWin(), L = w.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  // (the saved logs of an older build are deleted when this version first runs - and the day's tracks in memory with them:
  // this aircraft's logs are set up after that is done)
  await until(() => w.localStorage.getItem('tweeks.fr24.ladd.logreset'), 15000);
  L.engine.setRunways(RWY); L.engine.setRunwayLengths(RWL);
  const E = L.engine, man = E.byIcao('EGCC'), fab = E.byIcao('EGLF'), rtm = E.byIcao('EHRD'), teb = E.byIcao('KTEB'), lcy = E.byIcao('EGLC');
  check('airports: Manchester, Farnborough, Rotterdam, Teterboro, London City', !!man && !!fab && !!rtm && !!teb && !!lcy);
  const tN = Math.floor(Date.now() / 1000);

  // ADS-B points of a flight: on the ground at `a` for 10 minutes, a climb to `alt` and a straight line to `b` (or to
  // where it is after `dur` seconds, still flying), then (landed) 10 minutes on the ground at `b`
  function flight(a, b, t0, dur, alt, landed) {
    const pts = [], gnd = (ap, t) => ({ t, lat: ap.lat, lon: ap.lon, alt: 0, gs: 8, trk: 0, gnd0: true });
    for (let t = t0 - 600; t < t0; t += 30) pts.push(gnd(a, t));
    for (let t = t0; t <= t0 + dur; t += 20) {
      const k = (t - t0) / dur, toEnd = t0 + dur - t;
      const h = landed ? Math.min(alt, (t - t0) * 40, toEnd * 15) : Math.min(alt, (t - t0) * 40);
      pts.push({ t, lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, alt: Math.max(landed && toEnd < 30 ? 50 : 300, Math.round(h)), gs: landed && toEnd < 600 ? 160 : 440, trk: 0 });
    }
    if (landed) for (let t = t0 + dur + 20; t <= t0 + dur + 600; t += 30) pts.push(gnd(b, t));
    return pts;
  }
  // the aircraft's log as the userscript keeps it: each day's track made into legs on its own (a flight last heard high
  // ends that day's file still open), their summaries - kept with today's track
  function today(hex, ...days) {
    const pts = [].concat(...days), legs = [].concat(...days.map(d => E.legsFromPoints(d.map(p => Object.assign({}, p)), {})));
    const sums = legs.map(l => E.summarizeLeg(l, null));
    L.todayCache.set(hex, { at: Date.now(), pts, lastPt: pts[pts.length - 1], legs, sums });
    return sums;
  }
  const histOf = reg => w.__posted.filter(m => m && m.__tweeksLadd === 'hist' && m.reg === reg && m.data);
  const shown = data => data.slice(1);      // (FR24 skips the first entry: the flight on screen)
  const iata = ap => ap && ap.code && ap.code.iata;
  const rowOf = e => `${iata(e.airport.origin) || 'N/A'} -> ${iata(e.airport.destination) || 'N/A'} ${e.status.text} dep ${new Date(e.time.real.departure * 1000).toISOString().slice(11, 16)}`;

  // ---- 1. N212AP as WWI21: in from Farnborough this afternoon, off Manchester two hours ago to Teterboro, FR24's own
  // route (departed, not arrived), at FL410 west of Ireland
  { const id = 0x42200226, hex = 'a1d2e3', reg = 'N212AP';
    const inb = flight(fab, man, tN - 6 * 3600, 45 * 60, 25000, true);
    const out = flight(man, { lat: 55.2, lon: -20 }, tN - 2 * 3600, 2 * 3600 - 60, 41000, false);
    const sums = today(hex, inb.concat(out));
    check('the track: the flight in from Farnborough landed at Manchester, the one out of it still open', sums.length === 2 && sums[0].from && sums[0].from.id === fab.id && sums[0].to && sums[0].to.id === man.id && sums[0].ended && sums[1].from && sums[1].from.id === man.id && !sums[1].ended, sums.map(s => [s.from && s.from.id, s.to && s.to.id, s.ended, s.how]));
    L.pubRecs.set(id, { id, hex, reg, type: 'GLEX', cs: 'WWI21', public: true });
    L.onSched({ id, o: man.id, d: teb.id, std: 0, sta: 0, atd: tN - 2 * 3600 + 120, ata: 0, num: '' });
    L.warmHist({ id, hex, reg, cs: 'WWI21' });
    const h = await until(() => histOf(reg)[0], 5000);
    const rows = h ? shown(h.data) : [];
    check('WWI21 handed over ahead of time: its own flight first (hidden), live', !!h && h.data[0].status.live === true, h && rowOf(h.data[0]));
    check('... and not listed again below it as "Manchester -> N/A, Unknown"', !!h && !rows.some(e => e.time.real.departure >= tN - 2 * 3600 - 900), rows.map(rowOf));
    check('... the flight before it listed first: Farnborough -> Manchester, landed', !!rows[0] && iata(rows[0].airport.origin) === 'FAB' && iata(rows[0].airport.destination) === 'MAN' && /^Landed/.test(rows[0].status.text), rows.map(rowOf));
    // (the page asking, as FR24's dropdown does when it is opened)
    w.__posted.length = 0;
    w.postMessage({ __tweeksLadd: 'needHist', reg });
    const h2 = await until(() => histOf(reg)[0], 8000);
    const rows2 = h2 ? shown(h2.data) : [];
    check('... the same when the page asks for it', !!h2 && !rows2.some(e => e.time.real.departure >= tN - 2 * 3600 - 900) && !!rows2[0] && iata(rows2[0].airport.origin) === 'FAB', rows2.map(rowOf));
    L.pubRecs.delete(id); L.todayCache.delete(hex);
  }

  // ---- 2. VQ-BXF as PEX28F: in to Rotterdam this afternoon, off Rotterdam 20 minutes ago westbound at FL180 - nothing
  // from FR24 but where it is
  { const id = 0x42200301, hex = '424509', reg = 'VQ-BXF';
    const inb = flight(lcy, rtm, tN - 5 * 3600, 50 * 60, 20000, true);
    const out = flight(rtm, { lat: 51.96, lon: 2.0 }, tN - 20 * 60, 20 * 60 - 60, 18000, false);
    const sums = today(hex, inb.concat(out));
    check('the track: in to Rotterdam, then out of it and still flying', sums.length === 2 && sums[1].from && sums[1].from.id === rtm.id && !sums[1].ended, sums.map(s => [s.from && s.from.id, s.to && s.to.id, s.ended]));
    L.pubRecs.set(id, { id, hex, reg, type: 'FA8X', cs: 'PEX28F', public: true });
    L.warmHist({ id, hex, reg, cs: 'PEX28F' });
    const h = await until(() => histOf(reg)[0], 5000);
    const rows = h ? shown(h.data) : [];
    check('PEX28F, in the air by its position alone: not listed below its own flight', !!h && h.data[0].status.live === true && !rows.some(e => e.time.real.departure >= tN - 20 * 60 - 900), h && h.data.map(rowOf));
    check('... London City -> Rotterdam listed first', !!rows[0] && iata(rows[0].airport.origin) === 'LCY' && iata(rows[0].airport.destination) === 'RTM', rows.map(rowOf));
    L.pubRecs.delete(id); L.todayCache.delete(hex);
  }

  // ---- 3. a blocked flight with a route of the userscript's, off Manchester an hour ago; three days ago it was last
  // heard climbing out of Farnborough at FL300 over the Atlantic (an older flight, "-> N/A")
  { const id = 0x42200402, hex = 'a2b3c4', reg = 'N100LD';
    const old = flight(fab, { lat: 51.5, lon: -12 }, tN - 3 * 86400, 50 * 60, 30000, false);
    const inb = flight(fab, man, tN - 6 * 3600, 45 * 60, 25000, true);
    const out = flight(man, { lat: 54.5, lon: -9 }, tN - 3600, 3600 - 60, 39000, false);
    const sums = today(hex, old, inb.concat(out));
    check('the track: an older open flight, the one in to Manchester, the one out of it still open', sums.length === 3 && !sums[0].ended && sums[1].ended && !sums[2].ended, sums.map(s => [s.from && s.from.id, s.to && s.to.id, s.ended, s.how]));
    L.live.set(id, { id, hex, reg, type: 'GLF6', cs: 'N100LD' });
    L.routeState.set(id, { hex, working: false, maxAlt: 39000, landedAt: 0, route: { onGround: false, landed: false, originId: man.id, destId: 0, departedAt: tN - 3600, eta: 0 } });
    L.warmHist({ id, hex, reg, cs: 'N100LD' });
    const h = await until(() => histOf(reg)[0], 5000);
    const rows = h ? shown(h.data) : [];
    check('a blocked flight with its own route: not listed below itself', !!h && !rows.some(e => e.time.real.departure >= tN - 3600 - 900), h && h.data.map(rowOf));
    check('... the older flight last heard high still listed', rows.some(e => Math.abs(e.time.real.departure - (tN - 3 * 86400)) < 900), rows.map(rowOf));
    L.live.delete(id); L.routeState.delete(id); L.todayCache.delete(hex);
  }

  // ---- 4. on the ground after landing: in from Farnborough, down at Manchester 15 minutes ago, at the stand - FR24's
  // plan of it never saying it arrived
  { const id = 0x42200503, hex = 'a3b4c5', reg = 'N200LD';
    const inb = flight(fab, man, tN - 15 * 60 - 45 * 60, 45 * 60, 25000, true);
    const sums = today(hex, inb);
    check('the track: one flight, landed at Manchester', sums.length === 1 && sums[0].ended && sums[0].to && sums[0].to.id === man.id, sums.map(s => [s.from && s.from.id, s.to && s.to.id, s.ended]));
    L.pubRecs.set(id, { id, hex, reg, type: 'GLF6', cs: 'N200LD', public: true });
    L.onSched({ id, o: fab.id, d: man.id, std: 0, sta: 0, atd: tN - 15 * 60 - 45 * 60, ata: 0, num: '' });
    L.warmHist({ id, hex, reg, cs: 'N200LD' });
    const h = await until(() => histOf(reg)[0], 5000);
    const rows = h ? shown(h.data) : [];
    check('on the ground after landing (FR24 not saying it arrived): its last flight still listed first, landed', !!rows[0] && iata(rows[0].airport.origin) === 'FAB' && iata(rows[0].airport.destination) === 'MAN' && /^Landed/.test(rows[0].status.text) && h.data[0].status.live === false, h && h.data.map(rowOf));
    L.pubRecs.delete(id); L.todayCache.delete(hex);
  }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  harness ' + (e && e.stack || e)); process.exit(1); });
