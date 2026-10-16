// East Midlands' arrivals, Thursday 15 Oct: "9:11 Landed, Dusseldorf DUS, N358V GLF6 LADD" - a Gulfstream G650ER of US
// Bank NA's, a private flight with no airline and no flight number - drawn with Jet2's logo between the real Jet2 and
// Ryanair rows. FR24's own schedule of the airport (its older airport API, read for the days beyond its free one) was
// read as if it were one flight number's list: the airline (and the type) of its first airline flight was taken as the
// airline of every flight on it with none of its own - and East Midlands' first is a Jet2. Checked, on the built
// userscript and its page half:
//   - FR24's schedule of the airport read: N358V's row has no airline, no logo, its own type and times
//   - the Jet2 and Ryanair rows keep their own airlines
//   - a row an older build kept with Jet2's id: no logo on the private flight; a numbered row given the wrong airline
//     has the airline its number's prefix has on the board
//   - a Jet2 jet seen landing from Dusseldorf five minutes later is its own row: N358V's never takes its times or type
//   - the page's board: N358V's kept row with no airline id, its own schedule
//   - a flight number's own list still gives its airline to the flights of it that lack one
// usage: node test/unit_logos.cjs <node_modules dir> <data dir>
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
const OA = fs.readFileSync(path.join(DATA, 'oa_airports.csv'), 'utf8');

function makeWin() {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/52.83,-1.33/10', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  const answer = url => /flightradar24\.com\/mobile\/airports\/format/.test(url) ? [200, AIRPORTS] : /ourairports-data\/main\/airports\.csv/.test(url) ? [200, OA] : [404, ''];
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
  const E = L.engine, ema = E.byIcao('EGNX'), dus = E.byIcao('EDDL'), pmi = E.byIcao('LEPA'), dub = E.byIcao('EIDW');
  check('the airports: East Midlands, Dusseldorf, Palma, Dublin', !!(ema && dus && pmi && dub));
  // FR24's airline list (its ids for Jet2 and Ryanair, as the logos are drawn from)
  const JET2 = 9999101, RYR = 9999102;
  L.fr24.airlines = L.fr24.airlines || new Map();
  for (const [id, name, icao, iata] of [[JET2, 'Jet2', 'EXS', 'LS'], [RYR, 'Ryanair', 'RYR', 'FR']]) { L.fr24.airlines.set(id, { id, name, icao, iata }); L.fr24.byIcao.set(icao, id); }
  // yesterday morning: "9:11" at East Midlands (08:11 UTC)
  const T = Math.floor(Date.now() / 86400e3) * 86400 - 86400 + 8 * 3600 + 11 * 60;
  // FR24's schedule of the airport (airport.json, pluginData.schedule.arrivals.data[].flight), Jet2 first as at East Midlands
  const sched = (id, row, num, cs, al, model, reg, from, sch, real, schDep, realDep) => ({
    identification: { id, row, number: { default: num, alternative: null }, callsign: cs },
    status: { live: false, generic: { status: { text: 'landed', type: 'arrival' }, eventTime: { utc: real } } },
    aircraft: { model: model ? { code: model, text: '' } : null, registration: reg, hex: '' },
    airline: al ? { name: al[0], short: al[0], code: { iata: al[2], icao: al[1] } } : null,
    airport: { origin: { code: { iata: from.iata, icao: from.icao } }, destination: { code: { iata: 'EMA', icao: 'EGNX' } } },
    time: { scheduled: { departure: schDep, arrival: sch }, real: { departure: realDep, arrival: real }, estimated: { departure: null, arrival: null } }
  });
  const data = [
    sched('3c7a0001', 5640000001, 'LS898', 'EXS898', ['Jet2', 'EXS', 'LS'], 'B738', 'G-JZHA', pmi, T - 1500, T - 1620, T - 9000, T - 9100),
    // N358V: the flight plan FR24 has of it (09:00 Dusseldorf -> 09:11 East Midlands, local), no airline, no number
    sched('3c7a0002', 5640000002, null, 'N358V', null, 'GLF6', 'N358V', dus, T, T - 120, T - 4260, T - 3540),
    sched('3c7a0003', 5640000003, 'FR552', 'RYR552', ['Ryanair', 'RYR', 'FR'], 'B38M', 'EI-IFA', dub, T + 900, T + 840, T - 3600, T - 3500)
  ];
  L.fnRows(data, null, ema.id, 'arrivals');
  await L.boardDrain();
  const b = await L.boardLoad(ema.id);
  const kept = Object.values(b.arr), kN = kept.find(r => r.cs === 'N358V');
  check('FR24\'s schedule of East Midlands read: three arrivals kept', kept.length === 3, kept.map(r => r.cs));
  check('... N358V\'s with no airline of its own (no id, no ICAO code) - never the first airline on the schedule', !!kN && !kN.alId && !kN.alIcao && !(kN.nat && kN.nat.airlineId) && !/jet2/i.test((kN.nat && kN.nat.airline) || ''), kN && [kN.alId, kN.alIcao, kN.nat && kN.nat.airlineId, kN.nat && kN.nat.airline]);
  const pre = new Map([['LS', JET2], ['FR', RYR]]);
  let list = L.boardList(b.arr, pre);
  const row = cs => list.find(r => r.cs === cs);
  const n = row('N358V'), ls = row('EXS898'), fr = row('RYR552');
  check('the board: N358V\'s row has no logo (no airline id), as FR24 draws a business jet with no airline', !!n && !n.nat.airlineId && !n.alId, n && [n.alId, n.nat.airlineId, n.nat.airline]);
  check('... its own type (GLF6) and its own times: scheduled 09:11, landed 09:09', n && n.nat.aircraftType === 'GLF6' && n.nat.scheduledTime === T && n.nat.estimatedTime === T - 120 && n.nat.airportId === dus.id, n && [n.nat.aircraftType, n.nat.scheduledTime - T, n.nat.estimatedTime - T]);
  check('... Jet2\'s LS898 and Ryanair\'s FR552 keep their own airlines', ls && ls.nat.airlineId === JET2 && fr && fr.nat.airlineId === RYR, [ls && ls.nat.airlineId, fr && fr.nat.airlineId]);

  // ---- rows an older build kept: the first airline's id, code and type given to flights that had none
  const old = (k, num, cs, ty, natTy, from, t) => ({ k, src: 'sched', fid: k.slice(1), id: 5640000100 + list.length, cs, num, al: '', alId: 0, alIcao: 'EXS', ty, reg: '', hex: '', t, sch: t, est: t, st: 'landed', col: 'green', ap: from.id,
    nat: { id: 5640000100, flight: { id: k.slice(1), number: num || null, callsign: cs }, status: { name: 'landed', color: 'green', isAmbiguous: false, live: false }, scheduledTime: t, estimatedTime: t, airportId: from.id, divertedToId: null, airlineId: JET2, airline: 'Jet2', aircraftType: natTy, runway: null } });
  const olds = { a: old('f3c7a0010', '', 'N358V', 'GLF6', 'GLF6', dus, T), b: old('f3c7a0011', '', 'N888TY', '', 'B738', dus, T + 3600), c: old('f3c7a0012', 'FR1234', 'RYR1234', '', 'B738', dub, T + 1800) };
  list = L.boardList(olds, pre);
  const oa = list.find(r => r.cs === 'N358V'), ob = list.find(r => r.cs === 'N888TY'), oc = list.find(r => r.cs === 'RYR1234');
  check('an older build\'s row of N358V with Jet2\'s id: no logo', oa && !oa.nat.airlineId && !oa.alId && !/jet2/i.test(oa.nat.airline || ''), oa && [oa.alId, oa.nat.airlineId, oa.nat.airline]);
  check('... a private flight given the first flight\'s type (B738) with no type of its own: none', ob && !ob.nat.airlineId && !ob.nat.aircraftType, ob && [ob.nat.airlineId, ob.nat.aircraftType]);
  check('... a numbered flight (FR1234) given Jet2\'s id: its number\'s airline on the board, Ryanair', oc && oc.nat.airlineId === RYR, oc && oc.nat.airlineId);

  // ---- a Jet2 jet seen landing from Dusseldorf five minutes after N358V (a rebuilt flight, no flight number): its own row
  const logRow = { k: 'h406dab:1', src: 'log', hex: '406dab', reg: 'G-JZHB', cs: 'EXS21K', ty: 'B738', ap: dus.id, t: T + 180, sch: T + 180, est: T + 180, st: 'landed', col: 'green', oc: 'ground', dc: 'ground' };
  list = L.boardList({ n: olds.a, l: logRow }, pre);
  const ln = list.find(r => r.cs === 'N358V'), lj = list.find(r => r.cs === 'EXS21K');
  check('a Jet2 flight from Dusseldorf landing 5 minutes later: its own row, beside N358V\'s', list.length === 2 && !!ln && !!lj, list.map(r => [r.cs, r.t - T]));
  check('... N358V\'s keeps its own type and time (nothing of the Jet2 flight taken)', ln && ln.nat.aircraftType === 'GLF6' && ln.nat.estimatedTime === T && !ln.reg && ln.ty === 'GLF6', ln && [ln.nat.aircraftType, ln.nat.estimatedTime - T, ln.reg, ln.ty]);

  // ---- a flight number's own list (FR24's flight list of LS898): its airline for a flight of it listed without one
  const before = Object.keys(b.arr).length;
  L.fnRows([sched('3c7a0020', 5640000020, 'LS898', 'EXS898', ['Jet2', 'EXS', 'LS'], 'B738', 'G-JZHA', pmi, T - 86400 - 1500, T - 86400 - 1600, T - 86400 - 9000, T - 86400 - 9100),
    sched('3c7a0021', 5640000021, 'LS898', 'EXS898', null, '', '', pmi, T + 86400 - 1500, null, T + 86400 - 9000, null)], {});
  await L.boardDrain();
  const nx = Object.values((await L.boardLoad(ema.id)).arr).find(r => r.fid === '3c7a0021');
  check('a flight number\'s own list: tomorrow\'s LS898, listed with no airline, Jet2\'s (as before)', Object.keys(b.arr).length === before + 2 && !!nx && nx.nat.airlineId === JET2 && nx.alId === JET2, nx && [nx.nat.airlineId, nx.alId]);

  // ---- the page half: FR24's own board answer (today's rows only), the kept rows added
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.flightradar24.com/', runScripts: 'dangerously' });
  const pw = dom.window; let H = null; pw.__tlTestHook = h => { H = h; };
  pw.postMessage = () => {}; pw.unsafeWindow = pw; pw.GM_xmlhttpRequest = () => {}; pw.fetch = () => Promise.reject(new Error('offline')); pw.indexedDB = undefined;
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  pw.eval('(' + m[0] + ')()');
  check('page-world hook', !!(H && H.addArch && H.acceptBoardArch));
  list = L.boardList((await L.boardLoad(ema.id)).arr, pre);
  H.acceptBoardArch({ apId: ema.id, arr: JSON.parse(JSON.stringify(list)), dep: [] });
  const j = { data: [] };
  H.addArch(j, ema.id, 'arrivals');
  const pn = j.data.find(e => e.flight && e.flight.callsign === 'N358V'), pj = j.data.find(e => e.flight && e.flight.callsign === 'EXS898' && e.scheduledTime === T - 1500);
  check('the board FR24 draws: N358V\'s row with no airline id (no logo), GLF6', !!pn && !pn.airlineId && pn.aircraftType === 'GLF6', pn && [pn.airlineId, pn.airline, pn.aircraftType]);
  check('... its own schedule: 09:11, landed 09:09 - not the Jet2 row\'s', pn && pn.scheduledTime === T && pn.estimatedTime === T - 120, pn && [pn.scheduledTime - T, pn.estimatedTime - T]);
  check('... the Jet2 row beside it with Jet2\'s', !!pj && pj.airlineId === JET2, pj && pj.airlineId);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
