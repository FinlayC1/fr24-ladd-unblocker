// 22.23: every blocked aircraft's track kept 90 days (monitor/tracks.cjs), a playback moment named from it in one request
// (POST /pbmatch), the engine's learning done on the monitor and added to a browser's tables (learnCollector /
// addLearnedOp, GET /learned) - the same tables as replaying the flights one by one - and the day rebuilds waiting while
// the live LADD list is behind. All offline.
// usage: node test/unit_tracks.cjs <dataDir>
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), zlib = require('zlib');
process.env.MON_DATA = process.argv[2];
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'montracks-'));
process.env.MON_PORT = String(43000 + Math.floor(Math.random() * 6000));
global.fetch = async () => ({ status: 404, text: async () => '' });
const M = require('../monitor/monitor.cjs');
const { createTracks } = require('../monitor/tracks.cjs');
const { createRouteEngine } = require('../src/engine.js');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);

(async () => {
  // ---- tracks.cjs on its own ----------------------------------------------------------------------------------------
  {
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-'));
    const T = createTracks({ store });
    const t0 = Math.floor(Date.now() / 1000 / 86400) * 86400 - 86400 + 10 * 3600;   // (yesterday 10:00 UTC)
    // (a flight north at 0.0025 degrees a second - about 1,000 km/h - reported every 5 s, ground before and after)
    const pts = [];
    for (let t = t0 - 600; t < t0; t += 5) pts.push([t, 51, -1, 'ground']);
    for (let t = t0; t <= t0 + 3600; t += 5) pts.push([t, 51 + (t - t0) * 0.0025, -1, 30000]);
    for (let t = t0 + 3605; t <= t0 + 4200; t += 5) pts.push([t, 60, -1, 'ground']);
    T.put('a00001', pts);
    const kept = T.of('a00001', dayOf(t0));
    const air = kept.filter(p => !p[4]), gnd = kept.filter(p => p[4]);
    check('thinned: a point a minute in the air, one every five minutes on the ground', air.length >= 60 && air.length <= 63 && gnd.length >= 4 && gnd.length <= 8, { air: air.length, gnd: gnd.length });
    const at = T.at(t0 + 1234).find(p => p[0] === 'a00001');
    check('position at a moment: between two kept points, straight', !!at && Math.abs(at[1] - (51 + 1234 * 0.0025)) < 0.01 && Math.abs(at[3] - 30000) < 1 && !at[4], at);
    const g = T.at(t0 - 300).find(p => p[0] === 'a00001');
    check('on the ground before take-off: on the ground', !!g && g[4] === true && g[3] === 0, g);
    check('nothing long after its last point', !T.at(t0 + 4200 + 600).some(p => p[0] === 'a00001'));
    // (the same points again: nothing added; points in between: merged, still thinned)
    check('the same points again change nothing', T.put('a00001', pts) === 0);
    T.save();
    const f = path.join(store, 'tracks', dayOf(t0) + '.json.gz');
    check('a day is written to its file', fs.existsSync(f));
    const T2 = createTracks({ store });
    const at2 = T2.at(t0 + 1234).find(p => p[0] === 'a00001');
    check('read back from the file: the same position', !!at2 && Math.abs(at2[1] - at[1]) < 1e-9, at2);
    // (across midnight: the day before's last points and the day's first both counted)
    const mid = Math.floor(Date.now() / 1000 / 86400) * 86400 - 86400;
    T2.put('a00002', [[mid - 50, 40, 10, 20000], [mid + 10, 40.1, 10, 20000]]);
    const am = T2.at(mid - 20).find(p => p[0] === 'a00002');
    check('a flight across midnight: its position from both days', !!am && Math.abs(am[1] - 40.05) < 0.001, am);
    // (older than 90 days: removed, and never written again)
    fs.writeFileSync(path.join(store, 'tracks', '2020-01-01.json.gz'), zlib.gzipSync('{}'));
    check('days older than 90 removed', T2.prune(Date.now() / 1000) === 1 && !fs.existsSync(path.join(store, 'tracks', '2020-01-01.json.gz')));
    check('points older than 90 days not kept', T2.put('a00003', [[Date.now() / 1000 - 100 * 86400, 1, 1, 100]]) === 0);
  }

  // ---- the monitor: tracks from what it hears, a playback moment named ------------------------------------------------
  const nowS = Math.floor(Date.now() / 1000);
  const lbg = E.byIcao('KTEB');
  check('airports loaded (KTEB)', !!lbg);
  // (two LADD jets out of Teterboro, heard every 20 s - one climbing out three minutes later on the same path, so the
  // two are 50 km apart; a third over Ohio, a Citation)
  const fly = (hex, t1, lat0, lon0, dlat, dlon, type) => {
    for (let t = t1 - 300; t < t1; t += 20) M.ingest({ hex, lat: lat0, lon: lon0, alt_baro: 'ground', gs: 10, track: 0, seen_pos: 0, dbFlags: 8, r: 'N' + hex.slice(-3), t: type, flight: 'N' + hex.slice(-3) }, t);
    for (let t = t1; t <= nowS - 60; t += 20) { const k = (t - t1) / 3600; M.ingest({ hex, lat: lat0 + dlat * k, lon: lon0 + dlon * k, alt_baro: Math.min(41000, 500 + (t - t1) * 20), gs: 450, track: 200, seen_pos: 0, dbFlags: 8, r: 'N' + hex.slice(-3), t: type, flight: 'N' + hex.slice(-3) }, t); }
  };
  const t1 = nowS - 2 * 3600;
  fly('a11111', t1, lbg.lat, lbg.lon, -4.5, -1.5, 'GLF6');
  fly('a22222', t1 + 180, lbg.lat, lbg.lon, -4.5, -1.5, 'GLF6');
  fly('a33333', t1, 40, -83, 0.5, 2, 'C68A');
  for (const h of ['a11111', 'a22222', 'a33333']) M.buildLegs(h, nowS);
  const tk = M.tracks.of('a11111', dayOf(t1 + 1800));
  check('a blocked aircraft heard live: its track kept', tk.length > 50, tk.length);
  M.ingest({ hex: '400aaa', lat: 52, lon: 0, alt_baro: 20000, gs: 400, track: 0, seen_pos: 0, r: 'G-PLAIN', t: 'A320' }, nowS - 100);
  M.buildLegs('400aaa', nowS);
  check('an aircraft not blocked: no track', M.tracks.of('400aaa', dayOf(nowS - 100)).length === 0);
  const T = nowS - 3600, kk = (T - t1) / 3600;
  const posA = [lbg.lat - 4.5 * kk, lbg.lon - 1.5 * kk], kB = (T - t1 - 180) / 3600, posB = [lbg.lat - 4.5 * kB, lbg.lon - 1.5 * kB];
  const res = M.pbMatch(T, [
    [1001, posA[0] + 0.02, posA[1] + 0.02, 41000, 'GLF6', 0],      // A, FR24's position 3 km off
    [1002, posB[0], posB[1], 41000, 'GLF6', 0],                    // B
    [1003, 40 + 0.5 * kk, -83 + 2 * kk, 41000, 'B738', 0],         // over the Citation, but FR24 says a 737
    [1004, 10, 10, 30000, 'GLF6', 0]                               // nothing there
  ]);
  const by = Object.fromEntries(res.map(r => [r[0], r]));
  check('named from the tracks: the jet where FR24 draws the flight', by[1001] && by[1001][1] === 'a11111' && by[1001][6] === 'track', by[1001]);
  check('and the one three minutes behind it, 50 km back', by[1002] && by[1002][1] === 'a22222', by[1002]);
  check('a different type at the same place: not named', !by[1003], by[1003]);
  check('nobody there: not named', !by[1004]);
  check('named with its registration, type and the LADD flag', by[1001] && by[1001][2] === 'N111' && by[1001][3] === 'GLF6' && (by[1001][5] & 1) === 1, by[1001]);
  const leg = by[1001] && by[1001][7];
  check('with its flight as logged: from Teterboro, taken off then', !!leg && leg.from && leg.from.id === lbg.id && Math.abs(leg.tOff - t1) < 120, leg);
  // (two aircraft about as near: neither)
  {
    fly('a44444', t1, 35, -100, 0.01, 0.01, 'GLF6'); fly('a55555', t1, 35.03, -100, 0.01, 0.01, 'GLF6');
    for (const h of ['a44444', 'a55555']) M.buildLegs(h, nowS);
    const r2 = M.pbMatch(T, [[2001, 35.015 + 0.01 * kk, -100 + 0.01 * kk, 41000, 'GLF6', 0]]);
    check('two kept aircraft about as near: not named', r2.length === 0, r2);
  }
  // (one aircraft, one flight: two FR24 flights at the same place - neither)
  {
    const r3 = M.pbMatch(T, [[3001, posA[0], posA[1], 41000, 'GLF6', 0], [3002, posA[0] + 0.01, posA[1], 41000, 'GLF6', 0]]);
    check('two FR24 flights claiming one aircraft: neither named', r3.length === 0, r3);
  }
  // (the name given live comes first)
  {
    M.names.add(4001, { hex: 'a33333', reg: 'N333', type: 'C68A', cs: 'N333', flags: 1 }, T - 600);
    const r4 = M.pbMatch(T, [[4001, 0, 0, 0, '', 0]]);
    check('a flight named live: that name, whatever the tracks say', r4.length === 1 && r4[0][1] === 'a33333' && r4[0][6] === 'live', r4);
  }
  // ---- over HTTP ----------------------------------------------------------------------------------------------------
  M.serve(); await sleep(200);
  const req = (method, p, body) => new Promise((res2, rej) => { const r = http.request({ host: '127.0.0.1', port: +process.env.MON_PORT, path: p, method, headers: { 'Content-Type': 'application/json', 'X-Monitor-Client': 'test' } }, x => { let s = ''; x.on('data', c => { s += c; }); x.on('end', () => res2({ status: x.statusCode, body: s })); }); r.on('error', rej); if (body) r.write(body); r.end(); });
  {
    const r = await req('POST', '/pbmatch', JSON.stringify({ t: T, f: [[1001, posA[0], posA[1], 41000, 'GLF6', 0]] }));
    const j = JSON.parse(r.body || '{}');
    check('POST /pbmatch answers a public browser', r.status === 200 && j.list && j.list[0] && j.list[0][1] === 'a11111', { status: r.status, body: r.body.slice(0, 200) });
    const bad = await req('POST', '/pbmatch', '{nope');
    check('a body that does not read: 400', bad.status === 400, bad.status);
    const st = JSON.parse((await req('GET', '/status')).body);
    check('/status counts the playback answers and the tracks', st.playback && st.playback.track >= 3 && st.tracks && st.tracks.put > 0, { pb: st.playback, tracks: st.tracks });
  }

  // ---- learning on the monitor: the same tables as replaying the flights ---------------------------------------------
  {
    const dataDir = process.argv[2];
    const air = JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows;
    const tb = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'tables.json'), 'utf8'));
    const t2 = () => ({ flow: {}, aphAll: [0, 1, 2, 3].map(() => [1, 1, 1, 1, 1, 1]), od2: { 'KTEB>KOPF': [5, 0, 0, 0, 0, 0] }, csr: { EJA123: ['KTEB', 'KOPF', 2] } });
    const mk = () => { const e = createRouteEngine(); e.setAirports(air); e.setTables(tb()); return e; };
    const A = mk(), B = mk(), C = mk();
    A.setTables2(t2());
    const icaos = ['KTEB', 'KOPF', 'KVNY', 'KLAS', 'KBED', 'KAPA', 'KSDL', 'KHPN', 'KOPF', 'EGGW', 'LFPB', 'EGLF', 'KMDW', 'KDAL', 'KSJC'].map(c => A.byIcao(c)).filter(Boolean);
    const cls = ['bizjet', 'heavybiz', 'turboprop', 'piston', 'heli', 'airliner'];
    let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const rows = [];
    for (let i = 0; i < 600; i++) {
      const a = icaos[rnd(icaos.length)], b = icaos[rnd(icaos.length)]; if (a === b) continue;
      const ts = nowS - 5 * 86400 + rnd(4 * 86400), c = cls[rnd(cls.length)];
      rows.push(['a' + String(10000 + i) + '|' + ts, a.id, b.id, ts + 3600 + rnd(7200), rnd(3) ? '42,13' : '', rnd(2) ? '20,22' : '', c, rnd(9) === 0 ? 1 : 0, ts, rnd(2) ? 'EJA' + rnd(50) : '', ['GLF6', 'C68A', 'PC12', 'C172', 'B407', 'B738'][cls.indexOf(c)], rnd(2) ? [12345 + rnd(20), '5' + rnd(8) + ',' + rnd(2)].map(String).join('|') : '']);
    }
    for (const x of rows) A.learnRow(x);
    // (C collects; its own tables untouched)
    const before = JSON.stringify({ sq: C.T2, od: C.odWeight('KTEB', 'KOPF'), use: C.byIcao('KTEB').use });
    const col = C.learnCollector(); col.add(rows.slice(0, 250)); col.add(rows.slice(250));
    check('the collector learned every flight', col.flights === rows.length, col.flights);
    check('the collector leaves its engine\'s own tables as they were', JSON.stringify({ sq: C.T2, od: C.odWeight('KTEB', 'KOPF'), use: C.byIcao('KTEB').use }) === before);
    const ops = JSON.parse(JSON.stringify(col.ops()));
    // (B: the increments first - the population tables come later, their share waits for them)
    let ok = 0; for (const o of ops) if (B.addLearnedOp(o)) ok++;
    B.setTables2(t2());
    check('every increment taken', ok === ops.length, { ok, ops: ops.length });
    const sortCsr = t => Object.fromEntries(Object.entries(t || {}).map(([k, l]) => { const tr = []; for (let i = 0; i + 2 < l.length; i += 3) tr.push(l.slice(i, i + 3).join(',')); return [k, tr.sort()]; }));
    const pick = e => ({ od2: e.T2.od2, odt: e.T2.odt, apd: e.T2.apd, seq: e.T2.seq, aph: e.T2.aph, aphAll: e.T2.aphAll, pgu: e.T2.pgu, csr: sortCsr(e.T2.csr), flow: e.T2.flow });
    const a = pick(A), b = pick(B);
    for (const k of Object.keys(a)) check('population tables the same: ' + k, JSON.stringify(a[k]) === JSON.stringify(b[k]), String(JSON.stringify(a[k])).length + ' / ' + String(JSON.stringify(b[k])).length);
    let odSame = true, useSame = true;
    for (const x of icaos) for (const y of icaos) if (x !== y && Math.abs((A.odWeight(x.icao, y.icao) || 0) - (B.odWeight(x.icao, y.icao) || 0)) > 1e-9) odSame = false;
    for (const x of icaos) for (const k of ['use', 'useGA', 'useMil', 'useHB', 'useLJ']) if (Math.abs((x[k] || 0) - (B.byIcao(x.icao)[k] || 0)) > 1e-9) useSame = false;
    check('airport pairs the same', odSame);
    check('airport use by kind the same', useSame);
    const q = A.learnCollector(); // (an empty one)
    check('nothing learned: no increments', q.ops().length === 0);
  }
  // ---- /learned: 90 days of the monitor's rows, built in slices, handed out whole or "same" --------------------------
  {
    const dir = path.join(process.env.MON_STORE, 'learn'); fs.mkdirSync(dir, { recursive: true });
    const tb = E.byIcao('KTEB'), pb = E.byIcao('KOPF');
    for (let k = 1; k <= 3; k++) { const d = dayOf(nowS - k * 86400), ts = nowS - k * 86400; fs.writeFileSync(path.join(dir, d + '.json'), JSON.stringify([['a11111|' + ts, tb.id, pb.id, ts + 9000, '', '', 'heavybiz', 0, ts, 'N111', 'GLF6', ''], ['a22222|' + ts, pb.id, tb.id, ts + 9000, '', '', 'heavybiz', 0, ts, '', 'GLF6', '']])); }
    fs.writeFileSync(path.join(dir, dayOf(nowS) + '.json'), JSON.stringify([['a33333|' + nowS, tb.id, pb.id, nowS, '', '', 'bizjet', 0, nowS, '', 'C68A', '']]));
    const o = await M.learnedBuild(nowS);
    check('learned on the monitor: the finished days, not today', !!o && o.flights === 6 && o.days === 3 && o.asOf === dayOf(nowS - 86400), o && { flights: o.flights, days: o.days, asOf: o.asOf });
    const r = await req('GET', '/learned'), j = JSON.parse(r.body);
    check('GET /learned: the increments', r.status === 200 && Array.isArray(j.ops) && j.ops.length > 0 && j.ver === o.ver, { status: r.status, ver: j.ver });
    const r2 = JSON.parse((await req('GET', '/learned?have=' + encodeURIComponent(o.ver))).body);
    check('GET /learned with the copy already had: only "same"', r2.same === true && !r2.ops, r2);
    check('kept on disk for the next start', fs.existsSync(path.join(process.env.MON_STORE, 'learned.json')));
  }
  // ---- the day rebuilds wait while the live LADD list is behind ------------------------------------------------------
  {
    M.lastOk.ladd = Date.now(); delete M.pause['api.adsb.lol']; delete M.pause['adsb.lol'];
    check('LADD list fresh: the workers go on', !M.liveBusy());
    M.pause['api.adsb.lol'] = Date.now() + 60000;
    check('adsb.lol\'s API pausing the monitor: the workers wait', M.liveBusy());
    delete M.pause['api.adsb.lol']; M.lastOk.ladd = Date.now() - 4 * M.CFG.laddEvery * 1000 - 6000;
    check('the LADD list three rounds behind: the workers wait', M.liveBusy());
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
