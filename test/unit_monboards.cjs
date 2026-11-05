// (1.1.0) Every airport's board kept on the monitor (monitor/boards.cjs) - FR24's own rows, seven days either side:
//   - a row as a browser sends it: only FR24's (its schedule's, its map board's), every field checked - a row of the
//     script's own, one weeks off, a key that is not one, refused; FR24's own row kept as it came, the script's marks and
//     anything big left out;
//   - two copies of one row: the one further on stands (departed over scheduled), what it lacks taken from the other;
//   - an airport's rows: all of them, or those changed since a time; after a restart, read back from disk;
//   - each day's take-offs and landings by FR24's rows that say the flight went - one a flight, both lists of it alike;
//   - the monitor's own read of FR24's airport schedule (made up here): its rows as the browser's; FR24 refusing - left
//     alone three hours, an airport not wanted not read;
//   - over real HTTP: POST /boardrows taken, /board?rows=1 gives them (gzipped when big), and since; /airport's days the
//     more of public ADS-B's and FR24's count with the blocked flights it does not show.
// usage: node test/unit_monboards.cjs [dataDir]
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), zlib = require('zlib');
process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monboards-'));
process.env.MON_PORT = String(42000 + Math.floor(Math.random() * 6000));
global.fetch = async () => ({ status: 404, text: async () => '' });
const B = require('../monitor/boards.cjs');
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowS = Math.floor(Date.now() / 1000), dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const ltn = E.byIcao('EGGW'), lpl = E.byIcao('EGGP');

(async () => {
  // ---- a row as a browser sends it
  { const ok = B.cleanRow({ k: 'f3c12ab4', src: 'sched', fid: '3C12AB4', cs: 'ezy23', num: 'u223', t: nowS, st: 'departed', col: 'green', ap: lpl.id, al: 'easyJet', alIcao: 'ezy', ty: 'a320', reg: 'g-ezbx', hex: '40636B', nat: { id: 7, flight: { id: '3c12ab4' }, status: { name: 'departed' }, __tlAdded: true, big: 'x'.repeat(5000) }, extra: 'no' }, nowS);
    check('a row of FR24\'s schedule: kept in its own form - codes upper-cased, the address lower, FR24\'s row as it came without the script\'s marks, anything else left out', ok && ok.cs === 'EZY23' && ok.num === 'U223' && ok.alIcao === 'EZY' && ok.reg === 'G-EZBX' && ok.hex === '40636b' && ok.fid === '3c12ab4' && ok.nat && !('__tlAdded' in ok.nat) && ok.nat.big.length === 300 && !('extra' in ok), ok);
    const bad = [{ k: 'f1', src: 'log', t: nowS }, { k: 'f1', src: 'sched', t: nowS + 9 * 86400 }, { k: 'x<script>', src: 'fr24', t: nowS }, { k: 'f1', src: 'sched' }, null, 'row'].map(r => B.cleanRow(r, nowS));
    check('... a row of the script\'s own (a rebuilt log\'s), one nine days off, a key that is not one, no time: refused', bad.every(x => x === null), bad); }
  // ---- two copies of one row
  { const a = { k: 'f1', src: 'sched', t: nowS, st: 'scheduled', ap: lpl.id, nat: { status: { name: 'scheduled' }, airportId: lpl.id } };
    const b = { k: 'f1', src: 'sched', t: nowS + 300, st: 'departed', reg: 'G-ABCD', nat: { status: { name: 'departed' } } };
    const m1 = B.mergeRow(a, b), m2 = B.mergeRow(b, a);
    check('two copies of a row: the one further on stands - departed over scheduled, whichever came last - what it lacks from the other', m1.st === 'departed' && m2.st === 'departed' && m1.t === nowS + 300 && m2.t === nowS + 300 && m1.ap === lpl.id && m2.reg === 'G-ABCD' && m1.nat.status.name === 'departed' && m1.nat.airportId === lpl.id, { m1, m2 }); }
  // ---- an airport's rows, counts, since, on disk
  { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-')), BD = B.createBoards({ store: dir, E });
    // (yesterday from 01:00 UTC - from 24 hours ago, a row ten minutes on was today's just before midnight)
    const y = Math.floor(nowS / 86400) * 86400 - 86400 + 3600, row = (k, t, st, src, fid) => ({ k, src: src || 'sched', fid, t, sch: t, st });
    const n1 = BD.put(ltn.id, 'departures', [row('fa1', y, 'departed', 'sched', 'a1'), row('fa1', y, 'departed', 'fr24', 'a1'), row('fa2', y + 600, 'departed', 'sched', 'a2'), row('fa3', nowS + 3 * 86400, 'scheduled', 'sched', 'a3')], 'crowd', nowS);
    const n2 = BD.put(ltn.id, 'arrivals', [row('fb1', y + 60, 'landed', 'sched', 'b1')], 'crowd', nowS);
    const r = BD.rows(ltn.id, nowS - 7 * 86400, nowS + 7 * 86400);
    check('an airport\'s rows: both lists of FR24\'s (its schedule\'s and its board\'s copy of one flight kept apart), seven days each way', n1 === 4 && n2 === 1 && r.departures.length === 4 && r.arrivals.length === 1 && r.fr24At > 0, { n1, n2, dep: r.departures.length });
    const c = BD.counts(ltn.id).get(dayOf(y));
    check('... yesterday\'s take-offs and landings by FR24\'s rows that say it went: one a flight - its two copies one (2 take-offs, 1 landing); one still to fly, none', c && c[0] === 2 && c[1] === 1, c);
    const n3 = BD.put(ltn.id, 'departures', [row('fa1', y, 'departed', 'sched', 'a1')], 'crowd', nowS + 10);
    BD.put(ltn.id, 'departures', [Object.assign(row('fa3', nowS + 3 * 86400, 'scheduled', 'sched', 'a3'), { reg: 'G-NEWW' })], 'crowd', nowS + 20);
    const since = BD.rows(ltn.id, nowS - 7 * 86400, nowS + 7 * 86400, nowS + 15);
    check('... the same row again changes nothing; one with more to it changed - asked for what changed since, that one alone', n3 === 0 && since.departures.length === 1 && since.departures[0].reg === 'G-NEWW' && since.arrivals.length === 0, { n3, since: since.departures.map(x => x.k) });
    BD.save(nowS);
    const BD2 = B.createBoards({ store: dir, E }), r2 = BD2.rows(ltn.id, nowS - 7 * 86400, nowS + 7 * 86400);
    check('... kept on disk: read back after a restart, all of them', r2.departures.length === 4 && r2.arrivals.length === 1 && r2.departures.some(x => x.reg === 'G-NEWW'));
    // ---- the monitor's own read of FR24's schedule
    const asked = []; let mode = 'ok';
    const sched = kind => ({ result: { response: { airport: { pluginData: { schedule: { [kind]: { page: { current: 1, total: 1 }, data: [
      { flight: { identification: { id: '3c99aa1', row: 555, number: { default: 'U2223' }, callsign: 'EZY23AB' }, status: { live: false, generic: { status: { text: 'landed' } } }, aircraft: { model: { code: 'A320' }, registration: 'G-EZBX', hex: '40636b' }, airline: { name: 'easyJet', short: 'easyJet', code: { icao: 'EZY' } },
        airport: kind === 'arrivals' ? { origin: { code: { iata: 'LPL', icao: 'EGGP' } } } : { destination: { code: { iata: 'LPL', icao: 'EGGP' } } }, time: { scheduled: { departure: nowS - 7200, arrival: nowS - 3600 }, real: { departure: nowS - 7000, arrival: nowS - 3500 }, estimated: {} } } }] } } } } } } });
    const BD3 = B.createBoards({ store: fs.mkdtempSync(path.join(os.tmpdir(), 'bd3-')), E, cfg: { pace: 0, pages: 1 }, fetch: async url => { asked.push(url); if (mode === 'wall') return { status: 403, text: async () => '<html>Just a moment...</html>' }; const kind = /mode\]=arrivals/.test(url) ? 'arrivals' : 'departures'; return { status: 200, text: async () => JSON.stringify(sched(kind)) }; } });
    await BD3.pump();
    check('the monitor\'s own read: nothing read for an airport no browser asked for', asked.length === 0);
    BD3.want(ltn.id); await BD3.pump();
    const r3 = BD3.rows(ltn.id, nowS - 86400, nowS + 86400), a3 = r3.arrivals[0], d3 = r3.departures[0];
    check('... asked for: FR24\'s airport schedule read, both lists, its rows as a browser\'s would be - from Liverpool landed, to Liverpool departed, its FR24 row with them', asked.length >= 2 && asked.every(u => /api\.flightradar24\.com\/common\/v1\/airport\.json\?code=ltn&plugin\[\]=schedule/.test(u)) && a3 && a3.st === 'landed' && a3.ap === lpl.id && a3.nat && a3.nat.status.name === 'landed' && a3.nat.airportId === lpl.id && d3 && d3.st === 'departed' && d3.ap === lpl.id && a3.alIcao === 'EZY' && a3.reg === 'G-EZBX', { a3, n: asked.length });
    const nAsked = asked.length; await BD3.pump();
    check('... read again only after a while (twenty minutes)', asked.length === nAsked);
    const lhr = E.byIcao('EGLL'); mode = 'wall'; BD3.want(lhr.id); await BD3.pump();
    const pausedFor = (BD3.stats.own.pausedUntil - Date.now()) / 3600e3;
    BD3.want(E.byIcao('EGCC').id); const nWall = asked.length; await BD3.pump();
    check('... FR24 refusing (a challenge page): left alone three hours - nothing asked meanwhile', pausedFor > 2.9 && pausedFor <= 3 && asked.length === nWall && /page, not data/.test(BD3.stats.own.lastErr), { pausedFor, err: BD3.stats.own.lastErr }); }

  // ---- over real HTTP
  { const srv = M.serve(); await sleep(200);
    const port = +process.env.MON_PORT;
    const req = (method, p, body, hdr) => new Promise((res, rej) => {
      const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.7' }, hdr || {}) }, x => { const parts = []; x.on('data', c => parts.push(c)); x.on('end', () => { let buf = Buffer.concat(parts); const gz = x.headers['content-encoding'] === 'gzip'; if (gz) buf = zlib.gunzipSync(buf); let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch (e) { j = null; } res({ status: x.statusCode, body: j, gz, size: Buffer.concat(parts).length }); }); });
      r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
    });
    // (yesterday from 01:00 UTC: its 300 rows a minute apart all yesterday's - from 24 hours ago, after 19:00 UTC the last
    // ones were today's, and yesterday had 297)
    const cek = E.byIcao('EGCK'), y = Math.floor(nowS / 86400) * 86400 - 86400 + 3600;
    const rows = Array.from({ length: 300 }, (_, i) => ({ k: 'f' + (0x500000 + i).toString(16), src: 'sched', fid: (0x500000 + i).toString(16), t: y + i * 60, sch: y + i * 60, st: 'departed', ap: lpl.id, al: 'Some Airline With A Long Name', nat: { id: 1000 + i, flight: { id: (0x500000 + i).toString(16), number: 'XY' + i, callsign: 'XYZ' + i }, status: { name: 'departed', color: 'green' }, scheduledTime: y + i * 60, estimatedTime: y + i * 60, airportId: lpl.id } }));
    const p1 = await req('POST', '/boardrows', { list: [{ ap: cek.id, kind: 'departures', rows }, { ap: cek.id, kind: 'arrivals', rows: [{ k: 'fbad', src: 'log', t: y }] }] });
    check('POST /boardrows: a browser\'s rows of FR24\'s board taken (the script\'s own refused)', p1.status === 200 && p1.body && p1.body.taken === 300, p1.body);
    const g1 = await req('GET', `/board?ap=${cek.id}&from=${nowS - 7 * 86400}&to=${nowS + 7 * 86400}&rows=1`, null, { 'Accept-Encoding': 'gzip' });
    check('/board?rows=1: every row of the board kept here, gzipped (big), with when FR24\'s data of it came in and the time of the answer', g1.status === 200 && g1.gz && g1.body.rows.departures.length === 300 && g1.body.fr24At > 0 && g1.body.now >= nowS && Array.isArray(g1.body.aircraft), { gz: g1.gz, n: g1.body && g1.body.rows && g1.body.rows.departures.length });
    const g2 = await req('GET', `/board?ap=${cek.id}&from=${nowS - 7 * 86400}&to=${nowS + 7 * 86400}&rows=1&since=${g1.body.now + 5}`);
    check('... asked again for what changed since: nothing - a small answer, not gzipped', g2.status === 200 && !g2.gz && g2.body.rows.departures.length === 0);
    const g3 = await req('GET', `/board?ap=${cek.id}`);
    check('... asked as an older script asks (no rows=1): the monitor\'s flights alone, as before', g3.status === 200 && Array.isArray(g3.body.aircraft) && !('rows' in g3.body));
    // (a blocked jet's landing there yesterday, FR24 not showing it - on top of FR24's count)
    M.legs.set('43c0dd', new Map([[1, { hex: '43c0dd', reg: 'G-LADX', type: 'C25A', ladd: true, from: { id: lpl.id, code: 'LPL', conf: 'ground' }, to: { id: cek.id, code: 'QKC', conf: 'ground' }, tStart: y + 5000, tEnd: y + 7000, tOff: y + 5100, tOn: y + 6900, ended: true, open: false }]]));
    const a1 = await req('GET', `/airport?ap=${cek.id}&days=7&hist=14`), yd = (a1.body.daily || []).find(x => x[0] === dayOf(y));
    check('/airport: yesterday the more of public ADS-B\'s count and FR24\'s - its 300 take-offs, and the blocked jet\'s landing it does not show (marked as FR24\'s); today there too', a1.status === 200 && yd && yd[1] === 300 && yd[2] === 1 && yd[4] === 1 && a1.body.daily.some(x => x[0] === dayOf(nowS)), { yd, daily: (a1.body.daily || []).slice(0, 3) });
    srv.close(); }

  // ---- (1.2.4) a blocked flight's filed plan from FR24's own boards kept here: FR24 lists it on its origin's departures - N/A,
  // its flight id and both airports (N300CR White Plains -> East Midlands); found by the flight's id, the airport wanted
  { const hpn = E.byIcao('KHPN'), ema = E.byIcao('EGNX'), t = nowS - 3600, fid = 0x3c4b5a6d;
    M.BD.put(hpn.id, 'departures', [{ k: 'f' + fid.toString(16), src: 'sched', fid: fid.toString(16), t, sch: t - 600, est: t, st: 'departed', ap: ema.id }], 'own', nowS);
    const p = M.boardPlan(fid, hpn.id, 0), none = M.boardPlan(fid + 1, hpn.id, 0);
    check('boards: a blocked flight\'s filed plan by its FR24 id on its origin\'s departures - White Plains -> East Midlands; another flight none', p && p.originId === hpn.id && p.destId === ema.id && p.std === t - 600 && none === null && M.BD.wanted.has(hpn.id), p);
    M.BD.put(ema.id, 'arrivals', [{ k: 'f' + (fid + 2).toString(16), src: 'sched', fid: (fid + 2).toString(16), t: nowS + 3600, sch: nowS + 3600, st: 'estimated', ap: hpn.id }], 'own', nowS);
    const q = M.boardPlan(fid + 2, 0, ema.id);
    check('... or on its likely destination\'s arrivals, with no origin known', q && q.originId === hpn.id && q.destId === ema.id, q); }
  // ---- (1.2.4) the runway of an FR24 flight's landing from its own track (FR24's airport history padlocks it): named and
  // kept by the flight's id for every browser
  { const a = E.byIcao('EGNX'), pts = [];
    for (let i = 0; i < 40; i++) { const d = 10 - i * 0.3, [la, lo] = E.destPoint(a.lat, a.lon, 93, Math.max(-1.5, d)); pts.push({ t: 1e9 + i * 8, lat: la, lon: lo, alt: d > 0.3 ? a.alt + d * 320 : null, gnd: d <= 0.3, trk: 273, gs: d > 0.3 ? 130 : 60 }); }
    const r = M.rwyFit({ ap: a.id, fid: '3c1a2b4f', landing: true, pts }), bad = M.rwyFit({ ap: 999999999, fid: '1', landing: true, pts }), g = M.answer(new URL('http://x/rwy?f=3c1a2b4f:1,3c1a2b4f:0,zz'), Date.now() / 1000);
    check('runways: a landing at East Midlands from the east named 27, kept for others by its FR24 id; an unknown airport none', r.rwy === '27' && bad.rwy === '' && g.list['3c1a2b4f:1'] === '27' && !('3c1a2b4f:0' in g.list), { r, g });
    // (1.2.4) a flight no browser has worked out - older than FR24's week of tracks: from the FR24 positions the monitor kept
    // of it (fr24raw), when the airport is given; kept across a restart (STORE/runways-known.json)
    const t0 = nowS - 20 * 86400, kept = pts.map((p, i) => Object.assign({}, p, { t: t0 + i * 8, alt: p.gnd ? 0 : p.alt }));
    M.fr24raw.put(0x3c1a2b50, { cs: 'N300CR' }, kept); M.fr24raw.flush(t0 + 400);
    const old = M.answer(new URL(`http://x/rwy?f=3c1a2b50:1,3c1a2b51:1&ap=${a.id}&ts=${t0 + 300},${t0}`), Date.now() / 1000), noAp = M.answer(new URL('http://x/rwy?f=3c1a2b52:1'), Date.now() / 1000);
    check('... a flight of 20 days ago from the FR24 positions kept: 27; one not kept none; without the airport only those known', old.list['3c1a2b50:1'] === '27' && !('3c1a2b51:1' in old.list) && Object.keys(noAp.list).length === 0, { old, noAp });
    M.rwySave(); const saved = JSON.parse(fs.readFileSync(path.join(process.env.MON_STORE, 'runways-known.json'), 'utf8'));
    check('... the runways known written for a restart', saved['3c1a2b4f:1'] === '27' && saved['3c1a2b50:1'] === '27', saved); }
  // ---- (1.2.4) every FR24 position the monitor gets kept as it came: an unnamed flight's scan positions and its trail (with
  // its name once known), and the positions of FR24's flights shown without a route
  { const id = 0x3c1a2c00, F = { id, pts: [{ t: nowS - 240, lat: 53, lon: -1, alt: 9000, gs: 250, trk: 90, gnd: false }, { t: nowS - 120, lat: 53, lon: -0.9, alt: 9500, gs: 252, trk: 91, gnd: false }], tries: 0, triedAt: 0, first: Date.now(), type: 'FA7X',
      trail: [{ t: nowS - 900, lat: 52.8, lon: -1.3, alt: 0, gs: 10, trk: 270 }, { t: nowS - 600, lat: 52.9, lon: -1.2, alt: 5000, gs: 200, trk: 60 }], trailAt: Date.now() };
    M.ident.flights.set(id, F); M.fr24RawRound(); M.fr24RawRound();
    const before = M.fr24raw.of(id, nowS);
    check('FR24 positions: an unnamed flight\'s trail and scans kept, each once', before && before.p.length === 4 && before.p[0][4] === 10 && before.m.type === 'FA7X', before);
    F.pts.push({ t: nowS - 60, lat: 53, lon: -0.8, alt: 9800, gs: 255, trk: 92, gnd: false }); M.fr24RawRound();
    check('... a new scan position only added', M.fr24raw.of(id, nowS).p.length === 5 && M.fr24raw.pending >= 1);
    M.ident.flights.delete(id);
    // (a browser's track of an FR24 flight - FR24's trail and public ADS-B's, every figure; not one of public ADS-B's own)
    const lid = 0x3c1a2d00, lp = [{ t: nowS - 300, lat: 52, lon: -1, alt: 30000, gs: 420, trk: 80, tas: 455, ias: 280, ws: 40, wd: 270, sq: '6171' }, { t: nowS - 290, lat: 52.01, lon: -0.98, alt: 30000, gs: 421, trk: 80 }];
    M.central.take({ id: lid, hex: 'a31f94', kind: 'live', ac: { reg: 'N300CR', type: 'FA7X' }, trail: { full: true, pts: lp } });
    M.central.take({ id: 2000000123, hex: 'a31f95', kind: 'pub', ac: {}, trail: { full: true, pts: lp } });
    const lv = M.fr24raw.of(lid, nowS), C = lv && lv.cols;
    check('... a browser\'s track of an FR24 flight kept with every figure (airspeeds, wind, squawk); a public ADS-B flight\'s not', lv && lv.p.length === 2 && lv.p[0][C.indexOf('tas')] === 455 && lv.p[0][C.indexOf('wd')] === 270 && lv.p[0][C.indexOf('sq')] === '6171' && lv.m.reg === 'N300CR' && M.fr24raw.of(2000000123, nowS) === null, lv); }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
