// (1.0) The routes aircraft send and are sent over their datalinks (ACARS, VDL2, HFDL - adsb.lol's open data, CC0), and
// the event surges, end to end:
//   - monitor/datalink.cjs: a line of each feed read the same; each form of message that names departure and arrival
//     read (flight plan uplinked, position report, flight-planning service, filed plan, alert, departure clearance, ETA,
//     E-jet report) - not two codes side by side in other text, not an unknown airport, not operations messages (half
//     named another leg on 21 Oct); a route sent again merged; at most 12 per aircraft; 36 hours kept; zstd read by Node's
//     own and by the small decoder kept for Node 18; the day's new files listed
//   - (1.3.1) more forms: reports with a position, out / off, the planning service's notices, departure and oceanic
//     clearances, the label-10 position reports, the Q-labels' out / off, descent winds, arrival information (ATIS) -
//     some only under their own label; where a message says its own time of day and that is not when it was heard, it
//     is not kept; a message naming only where the aircraft is going joins the route to there
//   - (1.3.1) Airframes.io (monitor/airframes.cjs): asked per aircraft and only when it has sent something new, both
//     spellings of a registration, never another aircraft's, within its allowance; an old message sent in as new never
//     taken - by its own time, by its text seen before, by its station
//   - the monitor: a round reads the new files (an hour older than 36 hours not even downloaded), /datalink answers by
//     registration, /status counts; /surge - the fields busier these last three days than usual
//   - the browser (the BUILT userscript in jsdom): the routes asked of the monitor together; a route taken for the flight
//     only when it is this flight's - sent in flight, or a plan before take-off - from where it took off, the aircraft on
//     the way; the surges read from the monitor
// usage: node test/unit_datalink.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mondl-'));
global.fetch = async () => ({ status: 404, ok: false, text: async () => '', json: async () => null });
const DL = require('../monitor/datalink.cjs');
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = await f(); if (v) return v; await sleep(100); } return f(); };
const isAp = c => !!E.byIcao(c);
const nowS = () => Date.now() / 1000;
// (three lines, one of each feed, as zstd: made with Node 22's own compressor)
const VEC = 'KLUv/WCxAJUIALLPNSYAq8wDxvV1NZn6Tgsrg7vUQUMTkzeo8jYaQSWpV+owolBVRQAjAoi9994Oq6ixsKGgC2eUcBmQM8YnzslYTHBGy0HF6PxNRAwa14BN8pQZ07i9t1cNiiBRlv7TCjWWvkNrJTBRClsncaSlYMsoHQVf+MoO2OGOcbmyTnuF+syYg1cQ25/b/K0P+WfV9279x6sc0AtovGVf4iVMEAvwFnLGf9Nf6j2kqF7oIdOSeYPHqWtui2TNoUspW8DZodsDKZlJ4dRzBGuHBIo4GYykPpFg3WWSiPZKFwAOYwCY9WN6aMkBjIAWA5GKYXpZgBkxWI9kUCKkbInK3GAx3WPR5tUYFUa2MHpmuCBsNQO7gB0=';
const PLAIN = [
  JSON.stringify({ timestamp: 1792000000.5, tail: '.N711WK', label: 'H1', flight: 'EJA711', text: 'FLIGHT PLAN A0214 (KVNY - KSAC) FOR TAIL N711WK IS AVAILABLE' }),
  JSON.stringify({ vdl2: { t: { sec: 1792000600 }, avlc: { acars: { reg: '.N86HD', label: 'H1', flight: 'N86HD', msg_text: 'FPN/RI:DA:KBFI:AA:KPHX:CR:KBFIKPHX' } } } }),
  JSON.stringify({ hfdl: { t: { sec: 1792001200 }, lpdu: { hfnpdu: { acars: { reg: 'G-LADD', label: 'H1', msg_text: '00POS02,N49220E002136,102,LFPB,KBGR,' } } } } })
].join('\n') + '\n';

(async () => {
  // ---- 1. the messages ------------------------------------------------------------------------------------------------
  { const ls = PLAIN.trim().split('\n').map(l => DL.msgOf(JSON.parse(l)));
    check('a line of each feed read the same (acarsdec, VDL2, HFDL): registration without its dots, time, text', ls[0].reg === 'N711WK' && ls[0].t === 1792000000.5 && ls[0].flight === 'EJA711' && ls[1].reg === 'N86HD' && ls[1].t === 1792000600 && ls[2].reg === 'G-LADD' && /POS02/.test(ls[2].text), ls);
    check('... nothing from a line with no registration, a made-up one, or no text', DL.msgOf({ text: 'x' }) === null && DL.msgOf({ tail: 'N1 2 3!', text: 'x' }) === null && DL.msgOf({ tail: 'N1', text: '' }) === null && DL.msgOf(null) === null); }
  { const r = t => DL.routeOf(t, isAp), k = t => { const x = r(t); return x ? x.kind + ':' + x.o + '-' + x.d : null; };
    const got = {
      fpn: k('FPN/RI:DA:KCMH:AA:KTEB:CR:KCMHKTEB'),
      pos: k('00POS02,N49354W002264,409,KPTK,LFPB,22,1903'),
      fpl: k('FLIGHT PLAN A0214 (KVNY - KSAC) FOR TAIL N711WK IS AVAILABLE'),
      alert: k('YOUR FLIGHT PLAN E5520 KDJT-KUGN HAS BEEN EVALUATED'),
      pdc: k('PDC EJA678)\r\nKDJT-KJWN)\r\nCLRD AS FILED'),
      eta: k('ETA221759,KMEM,KBRO,'),
      rep: k('96,E,29.297,-96.379,20994,*****,KCRP,KIAH,')
    };
    const filed = r('FPL# E9024 KBFI-KPHX FOR N86HD HAS BEEN FILED FOR A 1940Z DEPARTURE ON 22 OCTOBER 2026');
    check('each form that says which is which read: departure and arrival', got.fpn === 'fpn:KCMH-KTEB' && got.pos === 'pos:KPTK-LFPB' && got.fpl === 'fpl:KVNY-KSAC' && got.alert === 'alert:KDJT-KUGN' && got.pdc === 'pdc:KDJT-KJWN' && got.eta === 'eta:KMEM-KBRO' && got.rep === 'rep:KCRP-KIAH', got);
    check('... a filed plan with its departure time', filed && filed.kind === 'filed' && filed.o === 'KBFI' && filed.d === 'KPHX' && filed.std === '1940', filed);
    check('... not operations messages (on 21 Oct half named another leg: N805VL "KHVN/KFLL" flew New Haven - San Juan)', r('3A01 OPSCTL 0321/21 KHVN/KFLL .N805VL') === null);
    check('... not two codes side by side in other text (a weather request), not an unknown code, not the same airport twice', r('REQ WX KTEB KJFK KLGA') === null && r('FPN/RI:DA:KCMH:AA:ZZZZ') === null && r('FPN/RI:DA:KTEB:AA:KTEB') === null);
    check('... and without the airport check, read as written (the list is the caller\'s)', DL.routeOf('FPN/RI:DA:QQQQ:AA:WWWW').o === 'QQQQ'); }
  { // (1.3.1) more forms, each as heard on 10 Nov 2026 (the times moved to 16:30Z)
    const T0 = Date.UTC(2026, 10, 10, 16, 30) / 1000;
    const r = (t, label, at) => DL.routeOf(t, isAp, label || 'H1', at || T0), k = (t, label, at) => { const x = r(t, label, at); return x ? x.kind + ':' + x.o + '-' + x.d : null; };
    const TXT = {
      rpt: '00ETA03,N31148W082322,390,KAPF,KLZU,1110,1625,1740,004.1',
      oooi: 'OFF02,N28261W081196,KMCO,KGGG,1110,1625,1819,014.0',
      fpl: 'FLIGHT PLAN #E5106,\r\nKAUS-KPHX IS NOW\r\nAVAILABLE FOR RECALL',
      pdc: 'PDC AVAILABLE FOR:\r\nKAUS - KMKE\r\nETD: 2000Z',
      pdc2: 'MSG/RX10-NOV-26 1715Z PDC N914MC/RXKLIT-KSOP/RX-ATC CLEARANCE-',
      dcl: '/BHXDCXA.DC1/CLD 1628 261110 EGBB PDC 033\r\nRYR97XJ CLRD TO GCRR OFF 15 VIA ADMEX1M',
      au: 'PDC 100120 JST565 A320 YBBN 0205 CLEARED TO YMML VIA',
      us: 'AAL2013 KDCA\r\nB738/L P0059 /AN N939NN\r\n673 FL400\r\nCLEARED TO KMIA AIRPORT',
      da: 'DA EGNX/DS LEAL/OFF 0627',
      ocl: '/PIKCLYA.OC1/CLA 1629 261110 EGGX CLRNCE 898\r\nQQE247 CLRD TO KIAD VIA VENER',
      dq: '/DQ470,KFTW,',
      atis: '/HDQGLXH.TI2/KLAS ARR ATIS M',
      pos10: '/N30.336/W098.165/10/0.73/008/230/KDAL/1649/0050/00028/DITSY/CHRLY/1635/FRSTI/1640/KSAT/'
    };
    const got = Object.fromEntries(Object.entries(TXT).map(([n, t]) => [n, k(t)]));
    got.q = k('KDCAKTPA1629', 'QQ'); got.qp = k('EGGPEGJB1631', 'QP'); got.b9 = k('/KTEB.TI2/024KTEBA3FBD', 'B9'); got.pos10 = k(TXT.pos10, '10');
    const want = { rpt: 'rpt:KAPF-KLZU', oooi: 'oooi:KMCO-KGGG', fpl: 'fpl:KAUS-KPHX', pdc: 'pdc:KAUS-KMKE', pdc2: 'pdc:KLIT-KSOP', dcl: 'dcl:EGBB-GCRR', au: 'dcl:YBBN-YMML', us: 'dcl:KDCA-KMIA', da: 'rep:EGNX-LEAL', ocl: 'ocl:-KIAD', dq: 'dq:-KFTW',
      atis: 'atis:-KLAS', pos10: 'pos:KSAT-KDAL', q: 'oooi:KDCA-KTPA', qp: 'oooi:EGGP-EGJB', b9: 'atis:-KTEB' };
    check('(1.3.1) more forms read: reports with a position, out / off, the planning service\'s notices, clearances (departure, oceanic, Australia\'s, the US one), the label-10 report, the Q-labels, descent winds, arrival information',
      Object.keys(want).every(n => got[n] === want[n]), Object.fromEntries(Object.keys(want).filter(n => got[n] !== want[n]).map(n => [n, got[n]])));
    check('... the Q-labels\' form only under QP and QQ (out, off - not on, in, or any other label); the arrival information asked for only under B9, and never the departure one',
      k('KDCAKTPA1629', 'QR') === null && k('KDCAKTPA1629', 'QS') === null && k('KDCAKTPA1629', 'H1') === null && k('/KTEB.TI2/024KTEBA3FBD', 'H1') === null && k('/KTEB.TI2/024KTEBD3FBD', 'B9') === null);
    const a = r(TXT.rpt), b = r(TXT.pos10, '10'), c = r('/N30.336/W098.165/10/0.73/008/230/KDAL/1649/0050/00028/DITSY/CHRLY/1635/FRSTI/1640/', '10'), d = r('00POS02,N28212 W086269,430,KFXE,KVNY,1110,1632,0514');
    const near = (p, la, lo) => !!p && Math.abs(p[0] - la) < 0.002 && Math.abs(p[1] - lo) < 0.002;
    check('... where the aircraft said it was, and how far its own time of day is from the time it was heard: a report (31 14.8 N 82 32.2 W, five minutes before)', near(a.at, 31.2467, -82.5367) && a.own === -5, a);
    check('... the label-10 report: where, its estimate, where it came from (when it says), its clock right by the next fix\'s time; the old position report too', near(b.at, 30.336, -98.165) && b.eta === '1649' && b.o === 'KSAT' && b.own === 0 && c && c.o === '' && c.d === 'KDAL' && near(d.at, 28.353, -86.448) && d.own === 2 && d.eta === '0514', { b, c, d });
    check('... a time of day hours off the time heard: said so (an old message sent in as new)', r(TXT.rpt, 'H1', T0 + 5 * 3600).own === -305 && r(TXT.pos10, '10', T0 + 5 * 3600).own === -295 && r(TXT.dcl, 'H1', T0 + 5 * 3600).own === -302 && r('KDCAKTPA1629', 'QQ', T0 - 4 * 3600).own === 239, [r(TXT.pos10, '10', T0 + 5 * 3600).own, r(TXT.dcl, 'H1', T0 + 5 * 3600).own]);
    check('... across midnight: ten past, heard at ten to - twenty minutes on', DL.minsFrom(Date.UTC(2026, 10, 10, 23, 50) / 1000, '0010') === 20 && DL.minsFrom(Date.UTC(2026, 10, 10, 0, 5) / 1000, '2355') === -10);
    check('... positions as these messages write them', near(DL.posIn('N 41.714,W 89.614'), 41.714, -89.614) && near(DL.posIn('S33565E151105'), -33.9417, 151.175) && DL.posIn('KTEB') === null);
    check('... the same airport twice, an unknown one, a code in other text: nothing', k('/DQ470,ZZZZ,') === null && k('OFF02,N28261W081196,KMCO,KMCO,1110,1625') === null && k('ATIS KLAS INFO M') === null && k('CLRD TO KIAD') === null); }
  // ---- 2. the store -------------------------------------------------------------------------------------------------
  { const S = DL.createDatalink({ isAirport: isAp }), t0 = Math.floor(nowS()) - 3600;
    const line = (reg, t, text) => JSON.stringify({ timestamp: t, tail: reg, text });
    const n = S.ingest([line('N711WK', t0, '00POS02,N1,1,KVNY,KSAC,'), line('N711WK', t0 + 600, '00POS02,N1,1,KVNY,KSAC,'), line('N711WK', t0 + 700, 'FPN/RI:DA:KVNY:AA:KSAC'), 'not json', line('N711WK', t0 - 40 * 3600, '00POS02,N1,1,KLAX,KSFO,')].join('\n'), nowS());
    const g = S.get(['n711wk', 'N0NE'])[0];
    check('a route sent again within six hours: one, its time moved on, both ways it came in kept', n === 3 && g && g.routes.length === 1 && g.routes[0].t === t0 + 700 && g.routes[0].first === t0 && g.routes[0].kinds.join() === 'pos,fpn', g);
    check('... a message older than 36 hours not kept; a registration not heard: nothing', S.get(['N0NE']).length === 0 && !g.routes.some(x => x.o === 'KLAX'));
    for (let i = 0; i < 10; i++) S.ingest(line('N711WK', t0 + 1000 + i * 7 * 3600 / 10, i % 2 ? '00POS02,N1,1,KSAC,KVNY,' : '00POS02,N1,1,KVNY,KSAC,'), nowS() + 9 * 3600);
    for (let i = 0; i < 20; i++) S.ingest(line('N1CAP', t0 + 1000 + i * 600, i % 2 ? '00POS02,N1,1,KSAC,KVNY,' : '00POS02,N1,1,KVNY,KSAC,'), nowS() + 9 * 3600);
    { const l = S.get(['N1CAP'])[0].routes; check('... at most 12 routes an aircraft, the newest', l.length === 12 && l[11].t === t0 + 1000 + 19 * 600 && S.get(['N711WK'])[0].routes.length <= 12, l.length); }
    // (1.3.1)
    { const hm = t => new Date(t * 1000).toISOString().slice(11, 16).replace(':', ''), S2 = DL.createDatalink({ isAirport: isAp }), t1 = Math.floor(nowS()) - 1800;
      const pos10 = (d, t, o) => `/N30.336/W098.165/10/0.73/008/230/${d}/${hm(t + 1200)}/0050/00028/DITSY/CHRLY/${hm(t + 300)}/FRSTI/${hm(t + 600)}/${o ? o + '/' : ''}`;
      S2.ingest([JSON.stringify({ timestamp: t1, tail: 'N10DL', label: '10', text: pos10('KDAL', t1) }), JSON.stringify({ timestamp: t1 + 600, tail: 'N10DL', label: '10', text: pos10('KDAL', t1 + 600, 'KSAT') }),
        JSON.stringify({ timestamp: t1 + 700, tail: 'N10DL', label: 'B9', text: '/KDAL.TI2/024KDALA3FBD' }), JSON.stringify({ timestamp: t1 + 800, tail: 'N10DL', label: 'H1', text: '/DQ470,KDAL,' })].join('\n'), nowS());
      const l = S2.get(['N10DL'])[0].routes;
      check('(1.3.1) a message naming only where it is going joins the route to there - its origin learned from a later one; arrival information kept apart (never a plan)', l.length === 3 && l[0].o === 'KSAT' && l[0].d === 'KDAL' && l[0].t === t1 + 600 && l[0].at && l[0].eta === hm(t1 + 1800) && l[1].kinds.join() === 'atis' && l[1].o === '' && l[2].kinds.join() === 'dq', l);
      const n0 = S2.stats.kept;
      S2.ingest(JSON.stringify({ timestamp: t1 + 900, tail: 'N10DL', label: 'H1', text: `00ETA03,N31148W082322,390,KAPF,KLZU,1110,${hm(t1 + 900 - 5 * 3600)},1740` }), nowS());
      check('... a report whose own time of day is five hours from the time it was heard: not kept', S2.stats.kept === n0 && S2.stats.stale === 1 && !S2.get(['N10DL'])[0].routes.some(x => x.d === 'KLZU'));
      // (one message at a time, as Airframes gives them)
      const m = (t, text, label) => ({ reg: 'N20AF', t, label: label || 'H1', text, flight: 'N20AF' });
      const a = S2.take(m(t1, 'FPN/RI:DA:KVNY:AA:KSAC'), nowS()), b = S2.take(m(t1, 'FPN/RI:DA:KVNY:AA:KSAC'), nowS()), c = S2.take(m(t1 + 60, `OFF02,N34126W118294,KVNY,KSAC,1110,${hm(t1 + 60)},1819`), nowS());
      const d = S2.take(m(t1 + 120, `OFF02,N34126W118294,KVNY,KLAS,1110,${hm(t1 - 7200)},1819`), nowS()), e = S2.take(m(t1 + 130, 'FPN/RI:DA:KVNY:AA:KLAS'), nowS(), true), f = S2.take(m(t1 + 140, `KVNYKLAS${hm(t1 + 140)}`, 'QQ'), nowS(), true);
      check('... a message from another source: 1 new or brought up to date, 0 nothing new, -1 its own time not the time given (never kept); from a station not to be trusted only one that says its time',
        a === 1 && b === 0 && c === 1 && d === -1 && e === 0 && f === 1 && S2.get(['N20AF'])[0].routes.map(x => x.d).join() === 'KSAC,KLAS', { a, b, c, d, e, f, l: S2.get(['N20AF'])[0].routes });
      check('... one too old, from the future, or with nothing in it: nothing', S2.take(m(t1 - 40 * 3600, 'FPN/RI:DA:KVNY:AA:KSAC'), nowS()) === 0 && S2.take(m(nowS() + 3600, 'FPN/RI:DA:KVNY:AA:KSAC'), nowS()) === 0 && S2.take(m(t1, 'HELLO'), nowS()) === 0 && S2.take(null, nowS()) === 0); }
    S.prune(nowS() + 48 * 3600);
    check('... and all gone 36 hours after the last', S.get(['N711WK']).length === 0 && S.byReg.size === 0); }
  // ---- 2b. (1.3.1) VDL2's link frames: the destination the aircraft's data radio gives ------------------------------------
  { const t = Math.floor(nowS()) - 900;
    const xid = (hex, d, o) => JSON.stringify({ vdl2: { t: { sec: (o && o.t) || t }, avlc: { src: { addr: hex, status: (o && o.status) || 'Airborne', type: (o && o.type) || 'Aircraft' }, dst: { addr: '1025FA', type: 'Ground station' }, cr: 'Command',
      xid: { type_descr: 'Handoff Initiation', vdl_params: [{ name: 'param_set_id', value: 'V' }, { name: 'dst_airport', value: d }].concat(o && o.loc ? [{ name: 'ac_location', value: { alt: 34000, loc: { lat: o.loc[0], lon: o.loc[1] } } }] : []) } } } });
    const x1 = DL.xidOf(JSON.parse(xid('A1CCC5', 'KPDX', { loc: [43.9, -125.3] })), isAp);
    check('(1.3.1) a VDL2 link frame read: the aircraft\'s 24-bit address, the destination its data radio gives, where it is', x1 && x1.hex === 'A1CCC5' && x1.d === 'KPDX' && x1.t === t && x1.at[0] === 43.9 && x1.at[1] === -125.3, x1);
    const none = [xid('A1CCC5', '....'), xid('A1CCC5', 'LGA.'), xid('A1CCC5', 'ZZZZ'), xid('A1CCC5', 'KPDX', { status: 'On ground' }), xid('1025FA', 'KPDX', { type: 'Ground station' }), xid('NOTHEX', 'KPDX')].map(l => DL.xidOf(JSON.parse(l), isAp));
    check('... not one with no airport in it ("....", "LGA."), an unknown code, an aircraft on the ground, a ground station\'s, a bad address', none.every(x => x === null), none);
    const S = DL.createDatalink({ isAirport: isAp });
    const n = S.ingest([xid('a1ccc5', 'KPDX', { loc: [43.9, -125.3] }), xid('A1CCC5', 'KPDX', { t: t + 300, loc: [44.5, -124.6] }), xid('A1CCC5', '....', { t: t + 400 }), xid('C05EC7', 'CYVR'),
      JSON.stringify({ timestamp: t + 60, tail: 'N20AF', label: 'H1', text: 'FPN/RI:DA:KVNY:AA:KSAC' })].join('\n'), nowS());
    const h = S.byHex.get('A1CCC5');
    check('... kept by the aircraft\'s address, a destination given again joined to the one before (its time and place moved on); messages by registration as ever', n === 4 && S.byHex.size === 2 && h.length === 1 && h[0].d === 'KPDX' && h[0].o === '' && h[0].kinds.join() === 'xid' && h[0].first === t && h[0].t === t + 300 && h[0].at[0] === 44.5 && S.byReg.size === 1 && S.stats.xid === 3, { n, h, st: S.stats });
    S.ingest(JSON.stringify({ timestamp: t + 100, tail: 'N1CC', label: 'H1', text: 'FPN/RI:DA:KSFO:AA:KPDX' }), nowS());
    const both = S.of('n1cc', 'a1ccc5'), onlyHex = S.of('', 'A1CCC5'), onlyReg = S.of('N1CC', ''), nothing = S.of('N0NE', 'FFFFFF');
    check('... everything of one aircraft - its registration\'s messages and its address\'s frames - in time order; by address alone (no registration known); nothing: null', both.length === 2 && both[0].kinds[0] === 'fpn' && both[1].kinds[0] === 'xid' && onlyHex.length === 1 && onlyReg.length === 1 && nothing === null, both);
    const S2 = DL.createDatalink({ isAirport: isAp }); await S2.ingestSlow([xid('A1CCC5', 'KPDX'), xid('C05EC7', 'CYVR')].join('\n'), nowS());
    check('... read the same a slice at a time; gone 36 hours on', S2.byHex.size === 2 && (S2.prune(nowS() + 48 * 3600), S2.byHex.size === 0)); }
  // ---- 3. zstd and the files of a day ----------------------------------------------------------------------------------
  { const buf = Buffer.from(VEC, 'base64'), own = DL.zstd(buf).toString('utf8');
    const f = require('../monitor/vendor/fzstd.cjs'), small = Buffer.from(f.decompress(new Uint8Array(buf))).toString('utf8');
    check('zstd: read by Node\'s own (from 22.15) or the small decoder kept for Node 18 - both the same, the lines whole', own === PLAIN && small === PLAIN, { own: own.length, small: small.length });
    const rel = { assets: [{ name: 'adsblol-adl-acars_20261021-004320_20261021-014321.jsonl.zst', browser_download_url: 'u1', size: 9 }, { name: 'adsblol-adl-vdl2_20261021-004308_20261021-014309.jsonl.zst', browser_download_url: 'u2', size: 9 }, { name: 'README.md', browser_download_url: 'u3' }, { name: 'adsblol-adl-hfdl_20261021-004549_20261021-014555.jsonl.zst', browser_download_url: 'u4' }] };
    let asked = ''; const nf = await DL.newFiles('2026-10-21', new Set(['adsblol-adl-hfdl_20261021-004549_20261021-014555.jsonl.zst']), async u => { asked = u; return rel; });
    check('the day\'s new files: its release asked for by tag, only the feeds\' files, not those read', asked === 'https://api.github.com/repos/adsblol/aircraft-data-links-2026/releases/tags/adsblol-adl-2026-10-21' && nf.map(x => x.url).join() === 'u1,u2', { asked, nf });
    check('... a day not out yet: none', (await DL.newFiles('2026-10-21', new Set(), async () => null)).length === 0); }
  // ---- 4. the monitor --------------------------------------------------------------------------------------------------
  { const d = new Date().toISOString().slice(0, 10).replace(/-/g, ''), hh = String(new Date().getUTCHours()).padStart(2, '0');
    const fresh = `adsblol-adl-acars_${d}-000000_${d}-${hh}0000.jsonl.zst`, old = 'adsblol-adl-acars_20200101-000000_20200101-010000.jsonl.zst';
    // (the vector's times moved to now)
    const t = Math.floor(nowS()) - 600, lines = PLAIN.trim().split('\n').map(l => JSON.parse(l));
    lines[0].timestamp = t; lines[1].vdl2.t.sec = t + 60; lines[2].hfdl.t.sec = t + 120;
    const body = zlib.zstdCompressSync ? zlib.zstdCompressSync(Buffer.from(lines.map(x => JSON.stringify(x)).join('\n') + '\n')) : null;
    const got = []; let listed = 0;
    const io = { list: async (day, seen) => { listed++; return [{ name: fresh, url: 'f1' }, { name: old, url: 'f0' }].filter(x => !seen.has(x.name)); }, json: async () => null, buf: async u => { got.push(u); return body; } };
    if (!body) console.log('(skipped the monitor round: this Node has no zstd compressor to make its file)');
    else {
      const n = await M.datalinkRound(io);
      check('a round: the new file read; an hour that ended more than 36 hours ago not even downloaded', n >= 1 && got.every(u => u === 'f1') && M.dlSeen.has(old) && M.dlSeen.has(fresh), { n, got });
      got.length = 0; await M.datalinkRound(io);
      check('... the next round: nothing read again', got.length === 0 && listed >= 2);
      const a = M.answer(new URL('http://x/datalink?reg=n711wk,G-LADD,bad%20reg,N0NE'), nowS());
      const by = Object.fromEntries((a.list || []).map(x => [x.reg, x.routes]));
      check('/datalink: the routes of the registrations asked for (upper case; a made-up one ignored)', by.N711WK && by.N711WK[0].o === 'KVNY' && by.N711WK[0].d === 'KSAC' && by['G-LADD'] && by['G-LADD'][0].d === 'KBGR' && !by.N0NE, a);
      const st = M.answer(new URL('http://x/status'), nowS());
      check('/status: the datalink\'s files and aircraft counted', st.datalink && st.datalink.files >= 1 && st.datalink.aircraft >= 2 && st.datalink.on === true, st.datalink);
    } }
  { // (the learning rows of 32 days: Teterboro four landings a day, then twelve a day these last three - a surge; Van Nuys
    // the reverse)
    const TEB = E.byIcao('KTEB'), VNY = E.byIcao('KVNY'), dir = path.join(process.env.MON_STORE, 'learn'); fs.mkdirSync(dir, { recursive: true });
    for (let k = 1; k <= 31; k++) {
      const day = new Date(Date.now() - k * 864e5).toISOString().slice(0, 10), t = Date.parse(day + 'T12:00:00Z') / 1000, rows = [];
      const nT = k <= 3 ? 12 : 4, nV = k <= 3 ? 0 : 6;
      for (let i = 0; i < nT; i++) rows.push(['a' + k + i + '|' + t, VNY.id, TEB.id, t + i, '', '', 'bizjet', 0]);
      for (let i = 0; i < nV; i++) rows.push(['b' + k + i + '|' + t, TEB.id, VNY.id, t + i, '', '', 'bizjet', 0]);
      rows.push(['m' + k + '|' + t, TEB.id, VNY.id, t, '', '', 'milheavy', 1]);
      fs.writeFileSync(path.join(dir, day + '.json'), JSON.stringify(rows));
    }
    const s = M.answer(new URL('http://x/surge'), nowS()), m = new Map(s.list);
    check('/surge: a field busier these three days than usual (Teterboro 36 against 12) up; one quieter (Van Nuys, none against 18) down; military left out', s.v === 1 && m.get(TEB.id) > 0.9 && m.get(VNY.id) < -1.5, s.list.slice(0, 4)); }
  // ---- 4b. (1.3.1) Airframes.io ----------------------------------------------------------------------------------------
  { const { createAirframes } = require('../monitor/airframes.cjs');
    const hm = t => new Date(t * 1000).toISOString().slice(11, 16).replace(':', ''), iso = t => new Date(t * 1000).toISOString();
    let clock = Date.now(); const now = () => clock, S = DL.createDatalink({ isAirport: isAp }), asked = [], routed = [];
    const T = Math.floor(clock / 1000);
    // (what Airframes has: airframes by the registration as heard, their messages newest first)
    const frames = { 'M-TEST': { id: 11, tail: 'M-TEST', icao: '424B68', updatedAt: iso(T - 300) }, MTEST: { id: 12, tail: 'MTEST', icao: '', updatedAt: iso(T - 900) }, 'M-OTHR': { id: 13, tail: 'M-OTHR', icao: 'ABCDEF', updatedAt: iso(T - 60) }, N5AF: { id: 21, tail: 'N5AF', icao: 'A00001', updatedAt: iso(T - 40 * 3600) } };
    const msg = (t, text, label, st) => ({ timestamp: iso(t), tail: '', label: label || 'H1', text, flightNumber: '', sourceType: 'aero-acars', station: { ident: st || 'ST-GOOD' } });
    const msgs = { 11: [msg(T - 300, `OFF02,N51530W000220,EGGW,LFMN,1111,${hm(T - 300)},1819`), msg(T - 900, ''), msg(T - 2400, 'FPN/RI:DA:EGGW:AA:LFMN:F:DVR')], 12: [msg(T - 900, '/DQ470,LFMN,')] };
    let headers = {}, status = 200;
    const fetchFn = async url => {
      asked.push(url.replace('https://api.airframes.io/v1', ''));
      const hd = { get: k => (k in headers ? String(headers[k]) : null) };
      if (status !== 200) return { status, headers: hd, text: async () => '' };
      let m = /\/airframes\/tail\/([^?]+)$/.exec(url); if (m) { const a = frames[decodeURIComponent(m[1])]; return { status: 200, headers: hd, text: async () => a ? JSON.stringify(a) : '' }; }
      m = /\/messages\?airframe_ids=([\d,]+)&limit=(\d+)$/.exec(url);
      if (m) { const l = [].concat(...m[1].split(',').map(i => msgs[i] || [])).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, +m[2]); return { status: 200, headers: hd, text: async () => JSON.stringify(l) }; }
      return { status: 404, headers: hd, text: async () => '' };
    };
    const AF = createAirframes({ fetch: fetchFn, now, perMin: 12, take: (m, nowS, sure) => S.take(m, nowS, sure), onRoute: reg => routed.push(reg) });
    const tg = (reg, hex, o) => Object.assign({ reg, hex, pri: 1, need: true }, o);
    const n1 = await AF.round([tg('M-TEST', '424b68')], 6), r1 = (S.get(['M-TEST'])[0] || {}).routes || [];
    check('an aircraft asked for by both spellings of its registration, its latest messages by both airframes in one request (a hundred the first time)', asked.join(' ') === '/airframes/tail/M-TEST /airframes/tail/MTEST /messages?airframe_ids=11,12&limit=100', asked);
    check('... its routes read as any message\'s, kept under its registration: the plan uplinked, then off the ground - one route, and the descent winds to the same airport joined to it; the flight worked out again',
      n1 >= 2 && r1.length === 1 && r1[0].o === 'EGGW' && r1[0].d === 'LFMN' && r1[0].kinds.join() === 'fpn,dq,oooi' && r1[0].t === T - 300 && routed.join() === 'M-TEST', { n1, r1, routed });
    asked.length = 0; await AF.round([tg('M-TEST', '424b68')], 6);
    check('... not asked again before it is due (a quarter of an hour once it has a route)', asked.length === 0 && AF.tails.get('M-TEST').next === clock + 15 * 60000);
    clock += 16 * 60000; await AF.round([tg('M-TEST', '424b68')], 6);
    check('... due, nothing sent since: looked up only, its messages not read', asked.join(' ') === '/airframes/tail/M-TEST /airframes/tail/MTEST', asked);
    { const c0 = clock; clock += 5 * 60000; asked.length = 0; await AF.round([tg('M-TEST', '424b68', { need: true })], 6);
      check('... still with no route of this flight twenty minutes after its messages were last read: read again all the same (the time Airframes gives an airframe does not move on with every message)', asked.length === 3 && /limit=30$/.test(asked[2]), asked); clock = c0; AF.tails.get('M-TEST').next = 0; }
    // (a new message - and with it old ones sent in as new: one says its time, one does not but its text was heard before,
    // one is from the station that sent the old one)
    const T2 = Math.floor(clock / 1000) + 16 * 60; clock += 16 * 60000; asked.length = 0;
    frames['M-TEST'].updatedAt = iso(T2 - 10);
    msgs[11].unshift(msg(T2 - 200, `OFF02,N51530W000220,EGGW,EGPH,1111,${hm(T2 - 20 * 3600 - 1800)},1819`, 'H1', 'ST-REPLAY'), msg(T2 - 150, 'FPN/RI:DA:EGGW:AA:LFMN:F:DVR', 'H1', 'ST-OTHER'), msg(T2 - 100, 'FPN/RI:DA:EGGW:AA:EGPH:F:TNT', 'H1', 'ST-REPLAY'),
      msg(T2 - 50, `/N45.000/E005.000/10/0.80/150/410/LFMN/${hm(T2 + 1500)}/0050/00028/AAAAA/BBBBB/${hm(T2 + 300)}/CCCCC/${hm(T2 + 600)}/`, '10', 'ST-REPLAY'));
    const n2 = await AF.round([tg('M-TEST', '424b68')], 6), r2 = S.get(['M-TEST'])[0].routes;
    check('... a new message: the latest thirty read, only those after the last one read', asked[2] === '/messages?airframe_ids=11,12&limit=30' && AF.stats.msgs === 3 + 4, { asked, msgs: AF.stats.msgs });
    check('... old messages sent in as new never taken: one whose own time is not the time given; the same text heard before; one that says no time from the station that sent the old one - its position report, which says its time, taken',
      n2 === 1 && AF.stats.stale === 1 && AF.stats.replays === 1 && AF.stations.has('ST-REPLAY') && r2.length === 1 && r2[0].d === 'LFMN' && r2[0].t === T2 - 50 && !r2.some(x => x.d === 'EGPH'), { n2, st: AF.stats, r2 });
    // (another aircraft's airframe under this registration; one Airframes has never heard; one silent for days)
    asked.length = 0; await AF.round([tg('M-OTHR', '111111'), tg('N0AF', 'a00002'), tg('N5AF', 'a00001')], 12);
    check('... an airframe with another aircraft\'s address: not this aircraft; a registration never heard: asked again in six hours; one silent a day and a half: its messages not read',
      !asked.some(u => /messages/.test(u)) && asked.length === 4 && AF.tails.get('M-OTHR').ids.length === 0 && AF.tails.get('N0AF').next === clock + 6 * 3600000 && AF.tails.get('N5AF').next === clock + 30 * 60000 && AF.stats.unknown === 2 && S.get(['M-OTHR', 'N0AF', 'N5AF']).length === 0, { asked, st: AF.stats });
    // (the allowance: twelve a minute; those wanted most first, then those waiting longest)
    clock += 2 * 60000; asked.length = 0; const many = []; for (let i = 0; i < 30; i++) many.push(tg('N' + (100 + i) + 'ZZ', '', { pri: i === 20 ? 2 : 1 }));
    await AF.round(many, 40); const first = asked[0];
    await AF.round(many, 40);
    check('... twelve requests a minute at most, however many aircraft wait; the one a browser is showing first', asked.length >= 11 && asked.length <= 12 && first === '/airframes/tail/N120ZZ' && AF.room(clock) <= 1, { n: asked.length, first });
    clock += 61000; asked.length = 0; await AF.round(many, 2);
    check('... a round asks no more than it is given (two here; room kept for an aircraft\'s messages after its look-up)', asked.length >= 1 && asked.length <= 2, asked.length);
    // (its own count of what is left kept to; a refusal waited out)
    clock += 61000; asked.length = 0; headers = { 'x-ratelimit-remaining': 5, 'x-ratelimit-reset': Math.floor(clock / 1000) + 45 };
    await AF.round(many, 40);
    check('... its own count of requests left this minute nearly used (by others at this address): no more asked until it starts again', asked.length === 1 && AF.stats.pausedTo === (Math.floor(clock / 1000) + 45) * 1000 && AF.room(clock) === 0, { n: asked.length, to: AF.stats.pausedTo - clock });
    clock += 46000; asked.length = 0; headers = { 'retry-after': 300 }; status = 429;
    await AF.round(many, 40);
    check('... refused (429): one request, then none for as long as it says; the aircraft not lost - asked again later', asked.length === 1 && AF.stats.limited === 1 && AF.stats.pausedTo === clock + 300000 && AF.stats.fails === 1, { n: asked.length, st: AF.stats });
    status = 200; headers = {}; clock += 301000; asked.length = 0; await AF.round([{ reg: 'bad reg!' }, null, { reg: '' }], 40);
    check('... nothing asked for a registration that is not one', asked.length === 0);
    AF.prune(clock / 1000 + 50 * 3600);
    check('... what it remembers let go in time', AF.tails.size === 0 && AF.stations.size === 0);
    // (the monitor: who is asked for)
    const st = M.answer(new URL('http://x/status'), nowS());
    check('/status: Airframes counted', st.airframes && st.airframes.on === true && st.airframes.asked === 0 && 'pausedTo' in st.airframes, st.airframes);
    const VNY = E.byIcao('KVNY'), tn = Math.floor(nowS()), pt = (o) => Object.assign({ t: tn - 20, lat: 36, lon: -119, alt: 30000, gs: 400, trk: 330 }, o);
    M.central.take({ id: 7001, hex: 'a11111', kind: 'live', ac: { reg: 'N7001A', type: 'GLF6', ladd: true }, pos: pt() });
    M.central.take({ id: 7002, hex: 'a22222', kind: 'pub', ac: { reg: 'N7002A', type: 'B738' }, pos: pt(), plan: { originId: VNY.id, destId: E.byIcao('KSAC').id, fr24: true } });
    M.central.take({ id: 7003, hex: 'a33333', kind: 'pub', ac: { reg: 'N7003A', type: 'C172' }, pos: pt({ gnd: true, alt: 0 }) });
    M.central.take({ id: 7004, hex: 'a44444', kind: 'pub', ac: { reg: 'N7004A', type: 'C56X' }, pos: pt(), plan: { originId: VNY.id, fr24: true } });
    M.setLadd([{ hex: 'a55555', r: 'N7005A', alt_baro: 31000, seen_pos: 3 }, { hex: 'a66666', r: 'N7006A', alt_baro: 'ground', seen_pos: 1 }, { hex: 'a77777', r: '', alt_baro: 1000, seen_pos: 1 }, { hex: 'a11111', r: 'N7001A', alt_baro: 30000, seen_pos: 2 }, { hex: 'a88888', r: 'N7008A', alt_baro: 9000, seen_pos: 900 }]);
    M.datalink.take({ reg: 'N7004A', t: tn - 600, label: 'H1', text: 'FPN/RI:DA:KVNY:AA:KSAC' }, nowS());
    const tgs = M.afTargets(Date.now()), by = Object.fromEntries(tgs.map(x => [x.reg, x]));
    check('who is asked for: flights in the air a browser is showing with no destination from FR24 (first), then the LADD list\'s aircraft flying now - not one on the ground, one FR24 has a destination for, one not heard for minutes; one with a route already, less often',
      tgs.length === 3 && by.N7001A && by.N7001A.pri === 2 && by.N7001A.need === true && by.N7004A && by.N7004A.pri === 2 && by.N7004A.need === false && by.N7005A && by.N7005A.pri === 1 && by.N7005A.hex === 'a55555', tgs);
    for (const id of [7001, 7002, 7003, 7004]) M.central.flights.delete(id); M.setLadd([]); }
  // ---- 5. the browser ------------------------------------------------------------------------------------------------
  let JSDOM = null, FIDB = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); FIDB = require(path.join(NM, 'fake-indexeddb')); } catch (e) { console.log('(skipped the browser: no jsdom - the monitor\'s Node 18 run)'); }
  if (JSDOM) {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8'), AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
    const MON = 'https://143-47-224-210.sslip.io', asked = [], T = Math.floor(nowS());
    const ROUTES = { N711WK: [{ o: 'KVNY', d: 'KSAC', t: T - 1800, first: T - 2400, kinds: ['pos'] }], N86HD: [{ o: 'KBFI', d: 'KPHX', t: T - 5 * 3600, first: T - 5 * 3600, kinds: ['fpn'] }], N5ME: [{ o: 'KBFI', d: 'KPHX', t: T - 5 * 3600, first: T - 5 * 3600, kinds: ['pos'] }],
      // (1.3.1)
      N10DL: [{ o: '', d: 'KSAC', t: T - 600, first: T - 2400, kinds: ['pos'], at: [(E.byIcao('KVNY').lat + E.byIcao('KSAC').lat) / 2, (E.byIcao('KVNY').lon + E.byIcao('KSAC').lon) / 2], eta: '0100' }],
      N11DL: [{ o: '', d: 'KVNY', t: T - 600, first: T - 600, kinds: ['dq'] }],
      N12DL: [{ o: '', d: 'KSAC', t: T - 600, first: T - 600, kinds: ['pos'], at: [45, -100] }],
      N20NT: [{ o: 'KBFI', d: 'KPHX', t: T - 600, first: T - 600, kinds: ['pdc'] }],
      N30AT: [{ o: '', d: 'KSAC', t: T - 600, first: T - 600, kinds: ['atis'] }],
      N31AT: [{ o: '', d: 'KSAC', t: T - 3500, first: T - 3500, kinds: ['atis'] }],
      N40OO: [{ o: 'KVNY', d: 'KSAC', t: T - 5400, first: T - 5400, kinds: ['oooi'] }],
      N50XD: [{ o: '', d: 'KSAC', t: T - 600, first: T - 3000, kinds: ['xid'] }], N51XD: [{ o: '', d: 'KVNY', t: T - 600, first: T - 3000, kinds: ['xid'] }] };
    const answer = url => {
      if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
      if (!url.startsWith(MON)) return [404, ''];
      if (url.startsWith(MON + '/status')) return [200, JSON.stringify({ v: 3, since: Date.now() - 3600e3, public: true, ver: '1.0.0' })];
      let m = url.match(/\/datalink\?reg=([^&]+)/); if (m) { const regs = decodeURIComponent(m[1]).split(','); asked.push(['datalink', regs]); return [200, JSON.stringify({ list: regs.filter(r => ROUTES[r]).map(r => ({ reg: r, routes: ROUTES[r] })) })]; }
      if (/\/surge$/.test(url)) { asked.push(['surge']); return [200, JSON.stringify({ v: 1, day: '', list: [[E.byIcao('KTEB').id, 1.1], ['x', 2]] })]; }
      return [404, ''];
    };
    const win = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.flightradar24.com/51.8,-0.4/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
    win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController; win.Blob = Blob;
    win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
    win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
    win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
    win.unsafeWindow = win; win.GM_notification = () => {}; win.postMessage = () => {}; win.console.debug = () => {}; win.console.log = () => {};
    win.eval(SRC);
    const L = win.__tweeksLadd;
    await until(() => L && L.engine.airports.length > 5000, 60000);
    await L.monCheck(true).catch(() => null);
    check('(the browser: airports loaded, the monitor answering)', L.engine.airports.length > 5000 && L.monUp());
    const B = L.engine.byIcao, VNY = B('KVNY'), SAC = B('KSAC'), BFI = B('KBFI'), PHX = B('KPHX'), LAX = B('KLAX'), LAS = B('KLAS');
    const mid = (a, b, f) => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
    // (the routes asked for together, once; the flight worked out again when they come)
    let replans = 0; asked.length = 0;
    const first = [L.datalinkRoutes('N711WK', () => replans++), L.datalinkRoutes('n86hd', () => replans++), L.datalinkRoutes('N5ME'), L.datalinkRoutes('N0NE')];
    await until(() => asked.some(a => a[0] === 'datalink'), 3000); await sleep(50);
    const dlAsks = asked.filter(a => a[0] === 'datalink');
    check('the routes of four aircraft asked of the monitor in one request; none known before it answers', first.every(x => x === null) && dlAsks.length === 1 && dlAsks[0][1].length === 4, dlAsks);
    check('... the flights worked out again when theirs come (two waiting)', replans === 2, replans);
    const again = L.datalinkRoutes('N711WK');
    check('... asked again within ten minutes: from memory, no request', again && again[0].d === 'KSAC' && asked.filter(a => a[0] === 'datalink').length === 1);
    const plan = (reg, p, legStart, oAp) => L.datalinkPlan(1, { reg }, '', Object.assign({ t: T }, p), legStart, oAp);
    const p1 = plan('N711WK', mid(VNY, SAC, 0.5), T - 3600, VNY);
    check('this flight\'s own position reports (sent in flight, from where it took off, the aircraft on the way): its destination', p1 && p1.destId === SAC.id && p1.originId === VNY.id && p1.datalink && p1.kinds[0] === 'pos', p1);
    check('... from another airport than where it took off (Los Angeles, not Van Nuys): not this flight', plan('N711WK', mid(VNY, SAC, 0.5), T - 3600, LAX) === null);
    check('... nowhere near the way there (over Las Vegas): not taken', plan('N711WK', LAS, T - 3600, VNY) === null);
    check('... sent before this flight took off, and not a plan (a position report of the flight before): not taken', plan('N711WK', mid(VNY, SAC, 0.2), T - 600, VNY) === null);
    const p2 = plan('N86HD', mid(BFI, PHX, 0.3), T - 3600, BFI);
    check('a flight plan uplinked five hours before take-off: taken', p2 && p2.destId === PHX.id && p2.kinds[0] === 'fpn', p2);
    check('... the same five hours before as a position report: an earlier flight\'s, not taken', plan('N5ME', mid(BFI, PHX, 0.3), T - 3600, BFI) === null);
    check('... a plan more than twelve hours before take-off: not taken', plan('N86HD', mid(BFI, PHX, 0.3), T + 8 * 3600, BFI) === null);
    check('... an aircraft with none: nothing', plan('N0NE', mid(BFI, PHX, 0.3), T - 3600, BFI) === null);
    // (1.3.1) messages that name only where the aircraft is going, notices, out reports, arrival information
    for (const reg of ['N10DL', 'N11DL', 'N12DL', 'N20NT', 'N30AT', 'N31AT', 'N40OO']) L.datalinkRoutes(reg);
    await until(() => (L.datalinkRoutes('N40OO') || []).length && (L.datalinkRoutes('N10DL') || []).length, 3000);
    const half = mid(VNY, SAC, 0.5), toSac = L.engine.brg(half.lat, half.lon, SAC.lat, SAC.lon);
    const d1 = plan('N10DL', half, T - 3600, VNY), d2 = plan('N10DL', Object.assign({ trk: toSac }, half), T - 3600, null);
    check('(1.3.1) a position report naming only where it is going, sent in this flight from where the aircraft is: its destination - its origin left to the track', d1 && d1.destId === SAC.id && d1.originId === 0 && d1.datalink && !d1.soft && d2 && d2.destId === SAC.id, { d1, d2 });
    check('... the origin not known and the airport behind it: not taken', plan('N10DL', Object.assign({ trk: (toSac + 180) % 360 }, half), T - 3600, null) === null);
    check('... the airport it took off from named as where it is going: not taken', plan('N11DL', half, T - 3600, VNY) === null);
    check('... a report from somewhere the aircraft is not (1,900 km away, ten minutes ago): another\'s, or an old one - not taken', plan('N12DL', half, T - 3600, VNY) === null);
    check('... sent more than ten minutes before this flight\'s track begins: an earlier flight\'s', plan('N10DL', half, T + 60, VNY) === null && plan('N10DL', half, T - 300, VNY) !== null);
    const n1 = plan('N20NT', mid(BFI, PHX, 0.3), T - 3600, BFI);
    check('... a departure clearance that came in the air, where the flight took off not known: the next flight\'s, not taken; from the airport it took off from: this flight\'s', plan('N20NT', mid(BFI, PHX, 0.3), T - 3600, null) === null && n1 && n1.destId === PHX.id && n1.originId === BFI.id, n1);
    const s1 = plan('N30AT', half, T - 3600, VNY);
    check('... arrival information (ATIS) asked for in flight: where it is going, marked as no plan (shown as likely); asked for in the first minutes after take-off: not taken', s1 && s1.soft === true && s1.destId === SAC.id && plan('N31AT', half, T - 3600, VNY) === null, s1);
    const o1 = plan('N40OO', half, T - 3600, VNY);
    check('... out of the gate half an hour before take-off, from the airport it took off from: this flight\'s', o1 && o1.destId === SAC.id && o1.kinds[0] === 'oooi' && plan('N40OO', half, T - 3600, LAX) === null, o1);
    // (1.3.1) the destination the aircraft's data radio gives (a VDL2 link frame)
    { L.datalinkRoutes('N50XD'); L.datalinkRoutes('N51XD'); await until(() => (L.datalinkRoutes('N50XD') || []).length && (L.datalinkRoutes('N51XD') || []).length, 3000);
      const near = mid(VNY, SAC, 0.95), a = plan('N50XD', half, T - 3600, VNY), b = plan('N51XD', half, T - 3600, VNY);
      check('(1.3.1) the destination the aircraft\'s data radio gives: its plan; the airport it took off from (the flight before\'s, not yet replaced): never', a && a.destId === SAC.id && a.kinds[0] === 'xid' && !a.soft && b === null, { a, b });
      const up = plan('N50XD', Object.assign({ trk: toSac, vr: 1500 }, near), T - 3600, null), level = plan('N50XD', Object.assign({ trk: toSac }, near), T - 3600, null), down = plan('N50XD', Object.assign({ trk: toSac, vr: -800 }, near), T - 3600, null), far = plan('N50XD', Object.assign({ trk: toSac, vr: 1500 }, half), T - 3600, null);
      check('... where it took off from not known and the airport right here: taken only on the way down to it (climbing or level it may be the one it has just left); far from it and heading for it: taken', up === null && level === null && down && down.destId === SAC.id && far && far.destId === SAC.id, { up, level, down: !!down, far: !!far });
      check('... a flight with no registration known: nothing asked of the monitor by the browser (the monitor\'s own calculation has them by address)', L.datalinkPlan(1, {}, 'a1ccc5', Object.assign({ t: T }, half), T - 3600, VNY) === null); }
    // (the surges: read from the monitor, every three hours)
    L.surgeNow(); await until(() => asked.some(a => a[0] === 'surge'), 3000); await sleep(50);
    const sm = L.surgeNow();
    check('the surges read from the monitor (an entry that is not a field id left out)', sm instanceof win.Map ? sm.get(B('KTEB').id) === 1.1 && sm.size === 1 : sm && sm.get && sm.get(B('KTEB').id) === 1.1 && sm.size === 1, sm && [...sm]);
    L.surgeNow(); await sleep(50);
    check('... asked once, not on every call', asked.filter(a => a[0] === 'surge').length === 1); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
