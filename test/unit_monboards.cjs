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
    const y = nowS - 86400, row = (k, t, st, src, fid) => ({ k, src: src || 'sched', fid, t, sch: t, st });
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
    const cek = E.byIcao('EGCK'), y = nowS - 86400;
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

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
