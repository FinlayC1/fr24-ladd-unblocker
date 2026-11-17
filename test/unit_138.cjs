// 1.3.8 - more flight plans, from everywhere they are sent:
//   - the datalink forms (monitor/datalink.cjs): the ARINC 620 reports of every kind, the engines', maintenance computers'
//     and performance monitors' reports, the airlines' own, the gate's messages before a flight (load sheet, final weights,
//     delay) - each as real aircraft sent it (Airframes, 17 Nov 2026); what is not read (an operations message before
//     take-off, a flight's summary sent after it landed, the next flight's notice under its own label); an on / in report
//     never a plan for the flight after
//   - the air traffic services' datalink: an ATN logon's and a FANS route clearance's two airports, by address or registration
//   - the route store: a callsign database's route kept apart from the aircraft's own; a callsign with a stop not added
//     again every quarter of a minute
//   - Airframes' whole stream searched (AF.sweep): the searches due most often first, the pages before the newest where
//     more came, each message once, within the minute's allowance
//   - the callsign databases (monitor/csroute.cjs): adsbdb, else hexdb; a callsign of an airline's form only; each once a
//     day; one request at a time; a refusal waited out
//   - the route code (04-routes ROUTE-DL, as the browser and the monitor run it): the avionics' plan before take-off; the
//     gate's messages and out / off only near take-off; a plan flown already (A to B, B to A, then A to C) not taken; a
//     callsign's route only from the airport it took off from, heading there, and never over the aircraft's own
//   - the monitor: who is asked of the callsign databases; /status
//   - a runway from positions that came without a track or a speed (M-ARNZ out of Farnborough, 16 Nov: "N/A" on Walney's
//     board); a landing's runway while the flight is still kept open on the ground; a runway found once kept
//   - (the browser) G-RESH's row of 14 Nov: FR24 lost it over Snowdonia, "Landed 17:31" - its public track on to Caernarfon,
//     down at 18:02 before its next flight: Caernarfon, not "Caernarfon?" from that next flight, and in its playback
//   - (the browser) 407D94, G-NMCF in the aggregators' database, de-registered in 2024 - G-UBET by G-INFO: renamed, and named
//     so from then on wherever the old mark comes in again
// usage: node test/unit_138.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon138-'));
global.fetch = async () => ({ status: 404, ok: false, text: async () => '', json: async () => null });
const DL = require('../monitor/datalink.cjs');
const { createAirframes } = require('../monitor/airframes.cjs');
const { createCsRoute, legsOf, CS_RE } = require('../monitor/csroute.cjs');
const C = require('../monitor/central.cjs');
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const isAp = c => !!E.byIcao(c);
const at = iso => Date.parse(iso) / 1000;
const R = (label, text, iso) => DL.routeOf(text, isAp, label, iso ? at(iso) : 0);
const od = r => r ? r.kind + ':' + r.o + '-' + r.d : null;

(async () => {
  // ---- 1. the forms, as aircraft sent them ----------------------------------------------------------------------------
  { const T = '2026-11-17T07:35:00Z';
    const cases = [
      // [label, text, heard at, expected kind:o-d, own (minutes off; undefined: none said)]
      ['80', '3N01 POSRPT UAE654    /17 OMDB/VCBI .A6-EXI\r\nPOS N234057E0572516/ALT 361/MCH 001/FOB 0272', '2026-11-17T07:35:36Z', 'pos:OMDB-VCBI'],
      ['80', '3N01 POSRPT 0860/17 VVTS/RKSI VN-A542 /POS N213804E1193058/ALT +32965/MCH 745/FOB 11211/ETA 1038', T, 'pos:VVTS-RKSI'],
      ['27', 'SVA3N03 POSRPT 0596/17/17 OERK/OMDB HZ-ASU /POS N23352E055243/ALT 225/MCH 066/FOB 013986', T, 'pos:OERK-OMDB'],
      ['5U', ' 01 WXRQ 041X/17 EGHH/GCTS .G-JZHH /TYP 2/STA EGHH/STA /STA ', T, 'rpt:EGHH-GCTS'],
      ['5U', ' H3 WXRQ 1210/17 EKBI/GCTS .OY-TCD /TYP 1/STA GCTS/STA /STA ', T, 'rpt:EKBI-GCTS'],
      ['80', '3801 MTCRP 0529/17 KLAX/MSLP .N962AV/01F 07:25 TAI529 SOLICITA', T, 'rpt:KLAX-MSLP'],
      ['80', '1101 OFFRP 06LW/17 LGAV/EGKK .SX-NAQ\r\n/OUT 0711/OFF 0734', T, 'oooi:LGAV-EGKK'],
      ['80', '3A01 OPSCTL 0622/17 CYHM/CYHZ .C-FFPA\r\nOUT0650 OFF0709 ETA0858\r\nFOB 30.1', '2026-11-17T07:21:36Z', 'oooi:CYHM-CYHZ'],
      ['H1', 'A320,013577,1,1,TB000000/REP004,00,00,1/CCVH-VFD,NOV17,073550,YBBN,YMAV,0635/C0TIA05JST130000', '2026-11-17T07:36:19Z', 'rpt:YBBN-YMAV', -1],
      ['H1', 'A40/A32140,1,1/C1N579UW,NOV17,072526,KDFW,KSEA,2647/C271,36401,0001,11,0011', '2026-11-17T07:25:51Z', 'rpt:KDFW-KSEA', 0],
      ['H1', 'A320,009561,1,1,TB000000/REP021,00,00,4/CCN386FR,NOV17,KSFO,KLAS,4156/C10057,1,10,11', T, 'rpt:KSFO-KLAS'],
      ['12', 'EGLL,EBBR,17NOV26,0735,080124\r\nN 51.231,E  1.054,21152\r\nEBBR19,SN2104', '2026-11-17T07:35:27Z', 'rpt:EGLL-EBBR', 0],
      ['1L', '000322072LOWW,EDDH,0735,0805,N 52.715,E 11.766,30', T, 'rpt:LOWW-EDDH'],
      ['2D', 'TOD01,ETD596,LLBG,OMAA,17NOV26,0758,OMAA31R,65,', T, 'rpt:LLBG-OMAA'],
      ['2D', 'TOD10,ETD915    ,OMAA,EDDF,17NOV26,0744,EDDF25L ,62,13200,\r\n', T, 'rpt:OMAA-EDDF'],
      ['2D', '\r\nEIN118/17NOV26/EI-LRD/KIAD/EIDW/0106', T, 'rpt:KIAD-EIDW'],
      ['16', 'ORG VHHH,DES ZSQD,UTC070701,N 25.086,E118.799,ALT 35128,GS   487125', '2026-11-17T07:07:04Z', 'pos:VHHH-ZSQD', 0],
      ['14', 'POS UTC 080220,DEP ZGSZ,DES RCTP,N 24030E120121,CAS 248', '2026-11-17T08:02:40Z', 'pos:ZGSZ-RCTP', 0],
      ['10', 'ETA0641,ZSPD,EGKK, 33746', T, 'eta:ZSPD-EGKK'],
      ['H1', 'ABS001DA_        EGSSEFRO 52\r\n 54160   35870724037004-553243068X20GMY0130170000--\r\n', T, 'rpt:EGSS-EFRO'],
      ['H1', 'ABS001DA_S   YG  EPWALFPG335\r\n 51080  143810724037996-59-300092XZ:700++++++0000--\r\n', T, 'rpt:EPWA-LFPG'],
      ['H1', 'SB0122BA_C-FIUV CYYZEGLL653 51599-0049490725 36875-44024405001020;008009', T, 'rpt:CYYZ-EGLL'],
      ['H1', 'EB0032AA_ G-ZBJB VOBLEGLL 77 50614 0055720726 39999-5422630670107GX011019', T, 'rpt:VOBL-EGLL'],
      ['H1', 'ABS026AA_N37318,B737N37-1261117,UA    ,KSFO,KLAX,1795,BCG2E-S200-0009\r\nN3729.4,W12220.7,170723', T, 'rpt:KSFO-KLAX'],
      ['H1', 'EB0116AB_10, 31, N14001,UAL944    ,  96,171126,07:25:20,KORD,EDDF,36526\r\nBSM5B70000022', '2026-11-17T07:25:40Z', 'rpt:KORD-EDDF', 0],
      ['H1', '++86501,N8716B,B7378MAX,261117,WN8517,KPAE,KDEN,1479,SMX34-2502-F320 4 N4730.6,W12153.0', T, 'rpt:KPAE-KDEN'],
      ['H1', 'EFFDE 1 17NOV26 0724 AAN791AN AAL48 KDFW/LFPG 311B-BCG-00W-19 L NCMM MSG 2475511', '2026-11-17T07:26:04Z', 'rpt:KDFW-LFPG', -2],
      ['H1', 'PLF 1 17NOV26 0753 A6-FNB FDB9RQ OTHH/OMDB BCG59-U000-08E7', '2026-11-17T07:53:30Z', 'rpt:OTHH-OMDB', 0],
      ['H1', '/BLVBOCR. A RPT43 PG1 L-HYDRAULIC REAL B .HL7637 17NOV26 0725 KAL012 KLAX/RKSI CMC-802', '2026-11-17T07:25:30Z', 'rpt:KLAX-RKSI', 0],
      ['H1', 'APM    5VN-A862         HVN51   VVTSEGLL171126000424,\r\n,70990054,.845,,,281.7', T, 'rpt:VVTS-EGLL'],
      ['H1', 'B03A APM A6-FQG FDB580 VCBIOMDB171126070033,737789 ,BCG3CL2000004', T, 'rpt:VCBI-OMDB'],
      ['H1', 'CECB-24614389ZHCCEBLG171126010203ER 172381132LHAA181016061239', T, 'rpt:ZHCC-EBLG'],
      ['H1', '009051200201011038184 R09/A33009,1,1 C1,.N438DX,26NOV17,07.25.30,KSEA,EHAM,DAL142 ,4220,380', '2026-11-17T07:26:07Z', 'rpt:KSEA-EHAM', -1],
      ['H1', 'A321,012682,1,1,TB000000/REP231,00,00,1/ FLIGHT START REPORT <231> ACID DATE UTC FROM TO FLT C1 VH-VWU NOV17 07.25.36 YPPH YMML 0975', '2026-11-17T07:25:55Z', 'rpt:YPPH-YMML', 0],
      ['H1', 'WEATHER/POSITION REPORT\r\n\r\nAID:N7907A    DA:17/11\r\nS/N L:802580  S/N R:802701  DEPART:KCVG  DESTIN:KMSP\r\n', T, 'rpt:KCVG-KMSP'],
      ['H1', 'RSI VH-VYC QFA478 0725 17NOV26 YMML YSSY CL 248 0W0713', '2026-11-17T07:25:20Z', 'rpt:YMML-YSSY', 0],
      ['15', 'FST01LSZHEGLLN50945E0007141196  34  26     55232      332  07440725', '2026-11-17T07:26:03Z', 'rpt:LSZH-EGLL', -1],
      ['80', 'FDB156,OMDB,VRMM, ,1039,0392,,', T, 'rpt:OMDB-VRMM'],
      ['33', 'P,E,2026-11-17 07:20:28, 22267297,16NOV,5626,KLAX,KFAT,8340,KFAT,72256,7200,29R,6', '2026-11-17T07:20:40Z', 'rpt:KLAX-KFAT', 0],
      ['33', '331,C,--- --.-,---- --.-,,008.6,17,KAFW,KTOL,KTOL,25/,07/,/,5,5,,0', T, 'rpt:KAFW-KTOL'],
      ['10', 'LDR01,189,D,SWA-2600-019,0,N 21.233,W157.804,6668, 15.2,PHNL,PHOG,PHOG,02/,/,/,0,0', T, 'rpt:PHNL-PHOG'],
      ['44', 'SN2184,EGCC,EBBR,17NOV26,D,308L,Y,N,N,Y,Y,N,N,N,Y ', T, 'rpt:EGCC-EBBR'],
      ['43', 'AML17M17072700KLM618 KBOSEHAM:LN12635588:AT2564:FC :DBN:INN :FN2 PAIRS OF FIRE PROTECTION GLOVES', '2026-11-17T07:27:15Z', 'rpt:KBOS-EHAM', 0],
      ['20', 'RST18A17072547KLM602  KLAXEHAM\r\n', '2026-11-17T07:25:48Z', 'rpt:KLAX-EHAM', 0],
      ['12', 'LDA31M17075642KLC1069 EHAMEGHI76999 LDS EDN01 FINAL. . LOAD SHEET ACCEPTANCE', '2026-11-17T07:56:50Z', 'gate:EHAM-EGHI', 0],
      ['C1', '.NDCULUA 170734\r\nAGM\r\nAN N801UA\r\n-  FINAL WEIGHTS\r\nUA0552/16 KSFO KONT\r\nSENT: 07:34:51Z\r\n************************\r\nZFW      104389  SEQ:01\r\n', '2026-11-17T07:34:59Z', 'gate:KSFO-KONT', 0],
      ['RA', 'QUNDCULUA~1FINAL WEIGHTS\r\nUA0580/16 KSFO KLAX\r\nSENT: 06:22:37Z\r\n****', '2026-11-17T06:23:09Z', 'gate:KSFO-KLAX', -1],
      ['C1', '.NDCULUA 170731 AGM AN N831UA - ---- FINAL DANGEROUS GOODS SUMMARY -- 847-700-3312 UA2332/16 KSFO KAUS SENT: 07:31:19Z ****', '2026-11-17T07:31:30Z', 'gate:KSFO-KAUS', 0],
      ['8D', '0005,89,0033,99,----,---,0038,0746,EGKK,EGAA POSITIONING. FLIGHT PLAN RECTIFICATION', '2026-11-17T07:07:39Z', 'gate:EGKK-EGAA'],
      ['RA', 'SN2730 DEPARTURE AIRPORT LSZH / ARRIVAL AIRPORT EBBR ORIGIN AIRPORT EBBR> PREFLIGHT SECURITY SEARCH', T, 'gate:LSZH-EBBR'],
      ['RB', '/RB~2 OOOI DUMP MSG/ KMLB KDEN 17 074804 QUNDCULUA\r\n/CURRENT FLT\r\n3877 KMLB KDEN 17\r\n/PDOOR 0710 /OUT 0718\r\n/GSI 0718 /OFF 0734\r\n/ON      /IN     \r\n', T, 'oooi:KMLB-KDEN'],
      ['A3', '/SPLCDYA.DC1/CLD 0735 261117 EHAM PDC\r\n 265\r\nCND2Q CLRD TO HEGN OFF 09\r\n VIA REND2N', '2026-11-17T07:35:45Z', 'dcl:EHAM-HEGN', 0],
      ['31', 'DIS01170735\r\nMESSAGE\r\n17-NOV-26 07:35Z\r\nFROM: GDFS\r\nTO: HBAZD\r\nFLIGHT PLAN #D3211,\r\nLSZH-LQSA 1115Z ETD, IS\r\nNOW AVAILABLE FOR RECALL', T, 'fpl:LSZH-LQSA'],
      ['RA', 'PDC\r\nPDC 170725\r\nANZ148 A21N YBBN 0810\r\nCLEARED TO NZAA VIA\r\nSCOTT FOUR DEP', T, 'dcl:YBBN-NZAA'],
      ['QP', 'EGGPEGJB0855', '2026-11-17T08:55:20Z', 'oooi:EGGP-EGJB', 0]
    ];
    const bad = [];
    for (const [lab, text, iso, want, own] of cases) {
      const r = R(lab, text, iso);
      if (od(r) !== want || (own !== undefined && r.own !== own)) bad.push({ lab, text: text.slice(0, 50), got: r, want, own });
    }
    check(`each of ${cases.length} forms aircraft sent read as it was sent: its kind, departure, destination, and its own time where it says one`, bad.length === 0, bad);
    const gate8d = R('8D', '0009,89,----,---,----,---,0009,0815,LFPG,LIMC ', '2026-11-17T07:25:32Z');
    check('... the delay before a flight with its departure time (easyJet\'s): kept with it', gate8d && gate8d.std === '0815' && gate8d.kind === 'gate', gate8d);
    // (not read)
    const nots = [
      ['80', '3A01 OPSCTL 02DP/17 EDHI/LFBO .9H-ZTE\r\nTLSMSG/ ETA0800 PAX71'],          // (operations, before take-off: the leg as scheduled)
      ['80', '3A01 DRRP 0622/17 CYHM/CYHZ .C-FFPA'],                                    // (an ARINC 620 report of a kind not known)
      ['5L', 'JST0740,.VH-VGN,LST,YMLT,MEL,YMML,187 ,17NOV26,0633,0638,0731,0737 ,1,GW 486'],   // (a summary sent after it landed)
      ['30', 'SN2611,EBBR,EDDH,17,Z,Y,SN2104'],                                         // (Brussels' label 30: the flight after)
      ['30', 'SN2184,EGCC,EBBR,17NOV26,D,308L,Y,N'],                                     // (its label 44 form under another label)
      ['H1', '0009,89,----,---,----,---,0009,0815,LFPG,LIMC '],                         // (easyJet's delay form under another label)
      ['5U', ' LGW CDG LFLL LICC-SA'],                                                  // (weather asked for: stations, no route)
      ['27', 'EDDS,LFSB,LSGG,,'],                                                       // (destination and alternates?)
      ['H1', 'CFG 3 17NOV26 0743 C-FLKJ FLE2855 CYVR/CYVR BCG59-U000-08E7']              // (on the ground at home: no route)
    ];
    const got = nots.map(([l, t]) => R(l, t, T));
    check(`... what is not read: an operations message before take-off, a report of a kind not known, a summary sent after landing, the next flight's notice, a form under another label, station lists (${nots.length})`, got.every(r => r === null), got);
    // (an on / in report: of a flight landed - never a plan for the flight after)
    const landed = [R('QQ', 'KORDKSFO0734OS KSFO /ON 0734', '2026-11-17T07:34:44Z'), R('H1', 'ON02,N28261W081196,KMCO,KGGG,1110,1625,1819,014.0', '2026-11-17T18:19:00Z'), R('80', '3501 ONRP 06LW/17 LGAV/EGKK .SX-NAQ /ON 0951'), R('8B', 'V09CA032/INRP/ESSA/ESGG/17/0834/'), R('80', '3A01 OPSCTL 0622/17 CYHM/CYHZ .C-FFPA\r\nOUT0650 OFF0709 ON0858 IN0905')];
    check('an on or in report (or an out / off one that gives its on or in time too): a report of that flight, not out / off - never a plan for the flight after', landed.every(r => r && r.kind === 'rpt') && od(landed[0]) === 'rpt:KORD-KSFO' && R('QR', 'KORDKSFO0734OS KSFO /FUL 138', '2026-11-17T07:34:44Z') === null, landed.map(od));
    const off = R('QQ', 'KDCAKORD00500329', '2026-11-17T00:50:30Z');
    check('... out and off stay as they were', off && off.kind === 'oooi', off);
    // (a message replayed hours later: its own time says so)
    const S0 = DL.createDatalink({ isAirport: isAp }), tFW = at('2026-11-17T09:34:59Z');
    const rFW = S0.take({ reg: 'N801UA', t: tFW, label: 'C1', text: cases.find(c => /FINAL WEIGHTS/.test(c[1]))[1] }, tFW);
    check('... the final weights sent at 07:34 given as heard at 09:34: an old message - not kept', rFW === -1 && S0.get(['N801UA']).length === 0, rFW); }

  // ---- 2. the air traffic services' datalink -------------------------------------------------------------------------
  { const T = Math.floor(Date.now() / 1000) - 600;
    const logon = { vdl2: { t: { sec: T }, avlc: { src: { addr: '4ca9c1', type: 'Aircraft', status: 'Airborne' }, dst: { addr: '1159A4', type: 'Ground station' }, x25: { clnp: { cotp: { atn: { msg_type: 'cm_logon_request', data: { flight_id: 'EIN154', departure_airport: 'EIDW', destination_airport: 'EGLL' } } } } } } } };
    const fans = { timestamp: T, tail: '.N784AN', label: 'AA', text: '/AKLCDYA.AT1.N784AN...', libacars: { arinc622: { cpdlc: { atc_uplink_msg: { msg_data: { msg_elements: [{ msg_element: { data: { route_clearance: { airport_dep: 'KJFK', airport_dst: 'EGLL' } } } }] } } } } } };
    const a = DL.atnOf(logon, isAp), b = DL.atnOf(fans, isAp);
    check('an ATN logon (dumpvdl2): its departure and destination, the aircraft by its address', a && a.hex === '4CA9C1' && !a.reg && a.o === 'EIDW' && a.d === 'EGLL' && a.t === T, a);
    check('... a FANS route clearance (libacars): its two airports, the aircraft by its registration', b && b.reg === 'N784AN' && b.o === 'KJFK' && b.d === 'EGLL', b);
    check('... no airport, an unknown one, or the same at both ends: nothing', DL.atnOf({ vdl2: { t: { sec: T }, avlc: { src: { addr: '4CA9C1', type: 'Aircraft' }, x: { departure_airport: 'EIDW', destination_airport: 'ZZZZ' } } } }, isAp) === null && DL.atnOf({ timestamp: T, tail: 'N1', x: { airport_dep: 'KJFK', airport_dst: 'KJFK' } }, isAp) === null && DL.atnOf(null) === null);
    const S = DL.createDatalink({ isAirport: isAp }), n = S.ingest(JSON.stringify(logon) + '\n' + JSON.stringify(fans) + '\n', T + 60);
    const lh = S.of('', '4CA9C1'), lr = S.of('N784AN', '');
    check('... read from the feeds\' files: kept by address and by registration as kind "atn"', n === 2 && lh && lh[0].kinds[0] === 'atn' && lh[0].d === 'EGLL' && lr && lr[0].o === 'KJFK' && S.stats.atn === 2, { n, lh, lr }); }

  // ---- 3. the store: a callsign database's route kept apart from the aircraft's own -----------------------------------
  { const S = DL.createDatalink({ isAirport: isAp }), T = Math.floor(Date.now() / 1000);
    S.put({ reg: 'G-TEST', t: T - 900, flight: 'BAW123' }, { o: 'EGLL', d: 'OTHH', kind: 'csdb' });
    S.take({ reg: 'G-TEST', t: T - 3000, label: 'H1', text: 'FPN/RI:DA:EGLL:AA:OTHH' }, T);
    let l = S.get(['G-TEST'])[0].routes;
    check('an older message of the aircraft\'s own for the same route as the callsign\'s: kept as its own, not lost in the callsign\'s', l.length === 2 && l.some(e => e.kinds.join() === 'fpn' && e.t === T - 3000) && l.some(e => e.kinds.join() === 'csdb'), l);
    S.put({ reg: 'G-TEST', t: T - 600, flight: 'BAW123' }, { o: 'EGLL', d: 'OTHH', kind: 'csdb' });
    l = S.get(['G-TEST'])[0].routes;
    check('... the callsign\'s put again: brought up to date, the aircraft\'s own left as it was', l.length === 2 && l.find(e => e.kinds[0] === 'csdb').t === T - 600 && l.find(e => e.kinds[0] === 'fpn').t === T - 3000 && l[l.length - 1].kinds[0] === 'csdb', l);
    for (let i = 0; i < 40; i++) { S.put({ reg: 'G-STOP', t: T - 600 + i * 15, flight: 'BAW1' }, { o: 'EGLL', d: 'LLBG', kind: 'csdb' }); S.put({ reg: 'G-STOP', t: T - 600 + i * 15, flight: 'BAW1' }, { o: 'LLBG', d: 'OTHH', kind: 'csdb' }); }
    S.take({ reg: 'G-STOP', t: T - 1200, label: 'H1', text: 'FPN/RI:DA:EGLL:AA:LLBG' }, T);
    const ls = S.get(['G-STOP'])[0].routes;
    check('... a callsign with a stop (two legs) put every quarter of a minute for ten minutes: its two legs once each - the aircraft\'s own still there', ls.length === 3 && ls.filter(e => e.kinds[0] === 'csdb').length === 2 && ls.some(e => e.kinds[0] === 'fpn'), ls);
    check('... the callsign\'s route only where both airports are real and differ', S.put({ reg: 'G-X', t: T }, { o: 'EGLL', d: 'ZZZZ', kind: 'csdb' }) === false && S.put({ reg: 'G-X', t: T }, { o: 'EGLL', d: 'EGLL', kind: 'csdb' }) === false && S.put({ t: T }, { o: 'EGLL', d: 'OTHH', kind: 'csdb' }) === false); }

  // ---- 4. Airframes' whole stream searched ----------------------------------------------------------------------------
  { let clock = Date.parse('2026-11-17T08:00:00Z'); const now = () => clock, T = Math.floor(clock / 1000);
    const S = DL.createDatalink({ isAirport: isAp }), asked = [], routed = [];
    const pages = {};   // query -> messages newest first
    const msg = (id, tail, text, label, t) => ({ id, tail, label: label || 'H1', text, timestamp: new Date((t || T - 60) * 1000).toISOString(), station: { ident: 'ST-' + (id % 7) } });
    pages['labels=1M,1L,8B'] = [msg(5002, '.OH-LWB', '/AY1411/ETA01/171126/EFHK/EDDF/EDFH/2JK0\r\n0813/EDDF25L/9  ', '1M'), msg(5001, 'N1', 'nothing here', '8B')];
    pages['text=DA%3A'] = [msg(5003, '.N386FR', 'FPN/RI:DA:KSFO:AA:KLAS:F:OAK')];
    const fetchFn = async url => {
      const u = url.replace('https://api.airframes.io/v1', ''); asked.push(u);
      const m = /^\/messages\?limit=100&(?:before_id=(\d+)&)?(.+)$/.exec(u); let l = [];
      if (m) { l = (pages[m[2]] || []).filter(x => !m[1] || x.id < +m[1]).slice(0, 100); }
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(l) };
    };
    const AF = createAirframes({ fetch: fetchFn, now, perMin: 40, take: (m, nowS, sure) => S.take(m, nowS, sure), onRoute: reg => routed.push(reg) });
    const n1 = await AF.sweep(2);
    check('a sweep: the two searches due most often asked first (every 2 minutes, every 3), two requests, no more', asked.join(' ') === '/messages?limit=100&labels=1M,1L,8B /messages?limit=100&text=DA%3A', asked);
    const f = S.get(['OH-LWB', 'N386FR']);
    check('... every aircraft\'s messages read: a route for each that sent one (its registration without the dots), the flight worked out again', n1 === 2 && f.length === 2 && f[0].routes[0].d === 'EDDF' && f[1].routes[0].kinds[0] === 'fpn' && routed.join() === 'OH-LWB,N386FR' && AF.stats.sweepRoutes === 2, { n1, f, routed });
    check('... each asked again when due: the 2-minute one in two minutes', AF.sweeps.get('labels=1M,1L,8B').next === clock + 120000 && AF.sweeps.get('text=DA%3A').next === clock + 180000);
    // (three minutes on: more than a page came - the page before asked as well; only what is new read)
    clock += 180000; asked.length = 0;
    const many = []; for (let i = 0; i < 160; i++) many.unshift(msg(6000 + i, 'N' + (100 + i) + 'AF', 'FPN/RI:DA:KVNY:AA:KSAC:F:AVE'));
    pages['text=DA%3A'] = many.concat(pages['text=DA%3A']);
    const m0 = AF.stats.sweepMsgs; await AF.sweep(2);
    check('... more came than one answer holds: the page before it asked (before_id), every new message read once, none read before', asked.includes('/messages?limit=100&text=DA%3A') && asked.includes('/messages?limit=100&before_id=6060&text=DA%3A') && AF.stats.sweepMsgs - m0 === 160 && S.byReg.size >= 162, { asked, msgs: AF.stats.sweepMsgs - m0 });
    clock += 180000; asked.length = 0; const m1 = AF.stats.sweepMsgs; await AF.sweep(1);
    check('... asked again with nothing new: nothing read twice (by its id)', asked.length === 1 && AF.stats.sweepMsgs === m1, { asked, n: AF.stats.sweepMsgs - m1 });
    // (an aircraft's own read after a sweep read the same message: not taken twice)
    const before = AF.stats.msgs;
    const id5003 = pages['text=DA%3A'].find(x => x.id === 5003);
    check('... one message, read in a sweep and again in the aircraft\'s own messages: counted once', AF.stats.msgs === before && id5003 && AF.sweeps.get('text=DA%3A').last === 6159);
    // (the allowance)
    const tight = createAirframes({ fetch: fetchFn, now, perMin: 3, take: () => 0 }); asked.length = 0;
    await tight.sweep(10); await tight.sweep(10);
    check('... within the minute\'s allowance however many are due (three a minute here)', asked.length === 3 && tight.room(clock) === 0, asked.length);
    check('... the searches: forty-odd, about three requests a minute in all', AF.sweeps.size >= 40 && [...AF.sweeps.values()].reduce((a, s) => a + 1 / s.every, 0) < 3.2, AF.sweeps.size); }

  // ---- 5. the callsign databases --------------------------------------------------------------------------------------
  { let clock = Date.parse('2026-11-17T08:00:00Z'); const asked = [];
    const answers = { 'adsbdb/BAW123': [200, { response: { flightroute: { origin: { icao_code: 'EGLL' }, destination: { icao_code: 'OTHH' } } } }], 'adsbdb/FDX5': [200, { response: { flightroute: { origin: { icao_code: 'KMEM' }, midpoint: { icao_code: 'PANC' }, destination: { icao_code: 'RJAA' } } } }],
      'adsbdb/DLH400': [404, { response: 'unknown callsign' }], 'hexdb/DLH400': [200, { route: 'EDDF-KJFK' }], 'adsbdb/XYZ9': [404, {}], 'hexdb/XYZ9': [404, {}], 'adsbdb/RYR1': [429, {}] };
    const fetchFn = async url => { const k = (/adsbdb/.test(url) ? 'adsbdb/' : 'hexdb/') + url.split('/').pop(); asked.push(k); const [st, j] = answers[k] || [404, {}]; return { status: st, ok: st === 200, json: async () => j }; };
    const CS = createCsRoute({ fetch: fetchFn, now: () => clock, gapMs: 3000 });
    const a = await CS.lookup('baw123');
    check('a callsign asked of adsbdb: its route', JSON.stringify(a) === '[["EGLL","OTHH"]]' && asked.join() === 'adsbdb/BAW123', { a, asked });
    clock += 3000; const b = await CS.lookup('DLH400');
    check('... adsbdb not knowing it: hexdb asked', JSON.stringify(b) === '[["EDDF","KJFK"]]' && asked.slice(-2).join() === 'adsbdb/DLH400,hexdb/DLH400', { b, asked });
    clock += 3000; const c = await CS.lookup('FDX5');
    check('... one with a stop: each leg', JSON.stringify(c) === '[["KMEM","PANC"],["PANC","RJAA"]]' && JSON.stringify(legsOf(['EGLL', '', 'EGLL', 'OTHH'])) === '[["EGLL","OTHH"]]', c);
    clock += 1000; const d = await CS.lookup('XYZ9');
    check('... one request every three seconds at most (asked sooner: not now)', d === null && asked.length === 4, asked);
    const n0 = asked.length; const e = await CS.lookup('BAW123');
    check('... known already: from memory, no request; a callsign that is not an airline\'s (a registration): never asked', JSON.stringify(e) === '[["EGLL","OTHH"]]' && asked.length === n0 && JSON.stringify(await CS.lookup('N123AB')) === '[]' && !CS_RE.test('N123AB') && CS_RE.test('DHK45A') && asked.length === n0, asked);
    clock += 3000; await CS.lookup('XYZ9'); clock += 3000; const g = await CS.lookup('RYR1');
    check('... neither knowing it: none, remembered for the day; refused (429): an hour waited, the rest not asked meanwhile', JSON.stringify(CS.cache.get('XYZ9').legs) === '[]' && JSON.stringify(g) === '[]' && CS.stats.pausedTo === clock + 3600000 && !asked.includes('hexdb/RYR1'), { g, st: CS.stats });
    clock += 3600000 + 1000; const noted = []; const asked0 = asked.length;
    const n = await CS.round([{ reg: 'G-A', cs: 'BAW123' }, { reg: 'G-B', cs: 'NEW1' }, { reg: 'G-C', cs: 'NEW2' }, { reg: 'G-D', cs: 'FDX5' }], (fl, o, dd) => { noted.push(fl.reg + ':' + o + '-' + dd); return true; });
    check('... a round: every flight the memory answers noted, one callsign asked at most (of adsbdb, then hexdb)', n === 3 && noted.join() === 'G-A:EGLL-OTHH,G-D:KMEM-PANC,G-D:PANC-RJAA' && asked.slice(asked0).join() === 'adsbdb/NEW1,hexdb/NEW1', { n, noted, asked: asked.slice(asked0) }); }

  // ---- 6. the route code (04-routes, ROUTE-DL): which of the routes is this flight's -----------------------------------
  { const ROUTES = {};
    const ctx = { ENGINE: E, fin: v => typeof v === 'number' && isFinite(v), store: { getHex: () => null }, scheduleReplan: () => {}, datalinkRoutes: reg => ROUTES[reg] || null };
    vm.createContext(ctx);
    vm.runInContext(C.blockOf(path.join(__dirname, '../src/main'), '04-routes.js', 'ROUTE-DL') + '\nthis.datalinkWhy = datalinkWhy;', ctx);
    const B = E.byIcao, T = Math.floor(Date.now() / 1000), legStart = T - 3600;
    const mid = (a, b, f, trkTo) => { const p = { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, t: T }; if (trkTo) p.trk = E.brg(p.lat, p.lon, trkTo.lat, trkTo.lon); return p; };
    const plan = (reg, pos, oAp, ls) => ctx.datalinkPlan(1, { reg }, '', pos, ls || legStart, oAp);
    const r = (o, d, t, kinds, more) => Object.assign({ o, d, t, first: t, kinds }, more);
    // (the avionics' plan, given with its logon at the gate half an hour before take-off)
    ROUTES.EIATN = [r('EIDW', 'EGLL', legStart - 1800, ['atn'])];
    const p1 = plan('EIATN', mid(B('EIDW'), B('EGLL'), 0.5), B('EIDW'));
    check('the flight plan its avionics gave air traffic control at the gate: its plan', p1 && p1.destId === B('EGLL').id && !p1.soft && p1.kinds[0] === 'atn', p1);
    // (the gate's messages: of the flight about to leave)
    ROUTES.N801UA = [r('KSFO', 'KONT', legStart - 2400, ['gate'])]; ROUTES.N802UA = [r('KSFO', 'KONT', legStart - 4 * 3600, ['gate'])];
    const g1 = plan('N801UA', mid(B('KSFO'), B('KONT'), 0.4), B('KSFO')), g2 = plan('N802UA', mid(B('KSFO'), B('KONT'), 0.4), B('KSFO'));
    check('its final weights forty minutes before take-off: its plan; four hours before: an earlier flight\'s', g1 && g1.destId === B('KONT').id && g2 === null, { g1, g2 });
    ROUTES.N1OOI = [r('KVNY', 'KSAC', legStart - 3 * 3600, ['oooi'])]; ROUTES.N2OOI = [r('KVNY', 'KSAC', legStart - 3000, ['oooi'])];
    check('... out of the gate three hours before take-off: not this flight\'s; fifty minutes before: this flight\'s', plan('N1OOI', mid(B('KVNY'), B('KSAC'), 0.5), B('KVNY')) === null && plan('N2OOI', mid(B('KVNY'), B('KSAC'), 0.5), B('KVNY')) !== null);
    // (a plan flown already: Van Nuys to Sacramento, back, then Van Nuys to San Diego)
    const toSan = mid(B('KVNY'), B('KSAN'), 0.05, B('KSAN'));
    ROUTES.N3FLW = [r('KVNY', 'KSAC', legStart - 6 * 3600, ['fpn', 'pos']), r('KSAC', 'KVNY', legStart - 3 * 3600, ['pos'])];
    ROUTES.N4FLW = [r('KVNY', 'KSAC', legStart - 6 * 3600, ['fpn'])];
    const f1 = plan('N3FLW', toSan, B('KVNY')), f2 = plan('N4FLW', toSan, B('KVNY'));
    check('a plan from Van Nuys to Sacramento, the aircraft back from Sacramento since: flown - not taken for its next flight from Van Nuys', f1 === null && f2 && f2.destId === B('KSAC').id, { f1, f2 });
    ROUTES.N5FLW = [r('KVNY', 'KSAN', legStart - 8 * 3600, ['filed']), r('KVNY', 'KSAC', legStart - 6 * 3600, ['pos']), r('KSAC', 'KVNY', legStart - 3 * 3600, ['pos'])];
    const f3 = plan('N5FLW', toSan, B('KVNY'));
    check('... a plan filed early for this flight (to San Diego), the aircraft flying elsewhere and back meanwhile: still this flight\'s', f3 && f3.destId === B('KSAN').id && f3.kinds[0] === 'filed', f3);
    ROUTES.N6RPT = [r('KVNY', 'KSAC', legStart - 1800, ['rpt'])];
    check('... a landing report (on / in) of the flight before: never this flight\'s', plan('N6RPT', mid(B('KVNY'), B('KSAC'), 0.3), B('KVNY')) === null);
    // (the callsign's route)
    const LL = B('EGLL'), QA = B('OTHH'), along = mid(LL, QA, 0.3, QA);
    ROUTES['G-CS1'] = [r('EGLL', 'OTHH', T - 60, ['csdb'], { cs: 'BAW123' })];
    const c1 = plan('G-CS1', along, LL);
    check('the route usually flown under its callsign: taken as likely only - from the airport it took off from, on the way, heading there', c1 && c1.soft === true && c1.destId === QA.id && ctx.datalinkWhy(c1) === 'the route usually flown under its callsign BAW123', { c1, why: c1 && ctx.datalinkWhy(c1) });
    check('... where it took off from not known: never; from another airport: never; heading 90 degrees off it: never',
      plan('G-CS1', along, null) === null && plan('G-CS1', along, B('EGKK')) === null && plan('G-CS1', Object.assign({}, along, { trk: (along.trk + 90) % 360 }), LL) === null && plan('G-CS1', Object.assign({}, along, { trk: undefined }), LL) === null);
    ROUTES['G-CS2'] = [r('EGLL', 'LLBG', T - 1200, ['pos']), r('EGLL', 'OTHH', T - 60, ['csdb'])];
    const c2 = plan('G-CS2', mid(LL, B('LLBG'), 0.3, B('LLBG')), LL);
    check('... the aircraft\'s own message naming another route for this flight: its own taken, never the callsign\'s (newer as it is)', c2 && c2.destId === B('LLBG').id && !c2.soft, c2); }

  // ---- 7. the monitor: who is asked of the callsign databases ----------------------------------------------------------
  { const tn = Math.floor(Date.now() / 1000), pt = o => Object.assign({ t: tn - 20, lat: 50, lon: 5, alt: 35000, gs: 450, trk: 120 }, o), LL = E.byIcao('EGLL');
    M.central.take({ id: 8101, hex: '400001', kind: 'pub', ac: { reg: 'G-CSAA', cs: 'BAW123', type: 'A320' }, pos: pt() });
    M.central.take({ id: 8102, hex: '400002', kind: 'pub', ac: { reg: 'G-CSAB', cs: 'BAW124', type: 'A320' }, pos: pt(), plan: { originId: LL.id, destId: E.byIcao('OTHH').id, fr24: true } });
    M.central.take({ id: 8103, hex: '400003', kind: 'pub', ac: { reg: 'G-CSAC', cs: 'GCSAC', type: 'GLF6' }, pos: pt() });
    M.central.take({ id: 8104, hex: '400004', kind: 'pub', ac: { reg: 'N104CS', cs: 'EJA104', type: 'C68A' }, pos: pt() });
    M.central.take({ id: 8105, hex: '400005', kind: 'pub', ac: { reg: 'G-CSAE', cs: 'BAW125', type: 'A320' }, pos: pt({ gnd: true, alt: 0 }) });
    M.central.take({ id: 8106, hex: '400006', kind: 'pub', ac: { reg: 'G-CSAF', cs: 'BAW126', type: '' }, pos: pt() });
    M.central.take({ id: 8107, hex: '400007', kind: 'pub', ac: { reg: 'G-CSAG', cs: 'BAW127', type: 'A320' }, pos: pt() });
    M.datalink.take({ reg: 'G-CSAG', t: tn - 600, label: 'H1', text: 'FPN/RI:DA:EGLL:AA:LEMD' }, tn);
    const ids = M.csTargets(Date.now()).map(x => x.id).filter(id => id > 8100 && id < 8200).sort();
    check('the callsign databases asked for an airline\'s flight in the air FR24 has no destination for (an airliner, or a type not known) - not one FR24 has, not a business jet\'s, not one on the ground, not one whose own message names its route', ids.join() === '8101,8106', ids);
    const st = M.answer(new URL('http://x/status'), tn);
    check('/status: the callsign databases counted', st.csRoute && st.csRoute.on === true && 'asked' in st.csRoute && 'callsigns' in st.csRoute && st.airframes && 'sweeps' in st.airframes && 'sweepRoutes' in st.airframes, { cs: st.csRoute, af: st.airframes && st.airframes.sweeps }); }

  // ---- 8. a runway from positions without a track or a speed; a landing's while kept open; one found kept -----------------
  { const APT = M.APT, FAB = E.byIcao('EGLF'), T0 = 1794787200;
    // (M-ARNZ, 16 Nov - its real positions every ten seconds or so, the track and speed taken out: [s of the day, lat, lon, ft | G])
    const LAND = [[59763, 51.22525, -0.78041, 4400], [59777, 51.22128, -0.75702, 4175], [59790, 51.21753, -0.73482, 3950], [59804, 51.21368, -0.71211, 3725], [59816, 51.21071, -0.69125, 3525], [59828, 51.21249, -0.67202, 3350], [59843, 51.22022, -0.6501, 3250], [59857, 51.22785, -0.63171, 3225], [59877, 51.23836, -0.60662, 3225], [59902, 51.25328, -0.58027, 3250], [59929, 51.27068, -0.55162, 3250], [59940, 51.27846, -0.5433, 3250], [59953, 51.28953, -0.54306, 3250], [59969, 51.30294, -0.54901, 3100], [59986, 51.31641, -0.55563, 2950], [59998, 51.32538, -0.56342, 2850], [60009, 51.32964, -0.57678, 2775], [60023, 51.33055, -0.59549, 2725], [60034, 51.32895, -0.60967, 2750], [60046, 51.32584, -0.62386, 2725], [60057, 51.32245, -0.63667, 2650], [60069, 51.3186, -0.64916, 2475], [60081, 51.31439, -0.66193, 2250], [60093, 51.30969, -0.67535, 2025], [60105, 51.30578, -0.68672, 1825], [60117, 51.30178, -0.69862, 1650], [60128, 51.29842, -0.70854, 1450], [60144, 51.29414, -0.72144, 1250], [60159, 51.29045, -0.73245, 1100], [60170, 51.28795, -0.7399, 1000], [60180, 51.2856, -0.747, 875], [60191, 51.28317, -0.7542, 750], [60201, 51.28078, -0.76149, 650], [60211, 51.27841, -0.76852, 525], [60236, 51.27403, -0.78165, 'G']];
    const OFF = [[61747, 51.28019, -0.76589, 'G'], [61819, 51.27777, -0.7704, 'G'], [61829, 51.2751, -0.7785, 700], [61839, 51.27203, -0.78751, 1250], [61849, 51.26839, -0.79658, 1825], [61860, 51.26291, -0.8046, 2450], [61871, 51.25671, -0.81421, 2925], [61881, 51.25048, -0.82459, 3225], [61891, 51.24386, -0.83588, 3550], [61903, 51.23648, -0.84691, 3925], [61913, 51.22852, -0.85404, 4150]];
    const P = a => a.map(([t, lat, lon, alt]) => ({ t: T0 + t, lat, lon, alt: alt === 'G' ? null : alt, gnd: alt === 'G', trk: null, gs: null }));
    const off = P(OFF), land = P(LAND), off0 = JSON.stringify(off);
    check('a take-off heard with no track or speed (M-ARNZ out of Farnborough, 16 Nov): its runway, 24, worked out from its positions - which are left as they were', APT.runwayOf(FAB, off, false) === '24' && JSON.stringify(off) === off0, APT.runwayOf(FAB, off, false));
    check('... its landing there the same: 24; one of them every minute only - nothing rather than a guess', APT.runwayOf(FAB, land, true) === '24' && [null, '24'].includes(APT.runwayOf(FAB, off.filter((p, i) => i % 6 === 0), false)), APT.runwayOf(FAB, land, true));
    const fab = { id: FAB.id, code: 'FAB', conf: 'ground' }, BWF = E.byIcao('EGNL');
    const open = { from: { id: BWF.id, code: 'BWF', conf: 'near' }, to: fab, open: true, ended: true, how: 'ground' }; M.legRunways(open, { pts: land });
    const flying = { from: fab, to: fab, open: true, ended: false, how: 'open' }; M.legRunways(flying, { pts: land });
    check('a flight down at its field, kept open while it sits there: its landing\'s runway (it had none); one still flying: none yet', open.rwyOn === '24' && !flying.rwyOn, { open: open.rwyOn, flying: flying.rwyOn });
    const again = { from: fab, to: { id: BWF.id, code: 'BWF', conf: 'low' }, rwyV: 2 }; M.keepRunways(again, { from: fab, rwyOff: '24', rwyOn: '17', to: { id: BWF.id }, rwyV: 2 });
    const other = { from: { id: BWF.id }, rwyV: 2 }; M.keepRunways(other, { from: fab, rwyOff: '24', rwyV: 2 });
    check('... a flight built again with its take-off roll let go: the runway found the time before kept - at the same field only', again.rwyOff === '24' && again.rwyOn === '17' && !other.rwyOff, { again, other }); }

  // ---- 9. (the browser) G-RESH's row of 14 Nov and its playback; G-UBET -------------------------------------------------
  { const NMd = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules');
    let JSDOM = null, FIDB = null; try { ({ JSDOM } = require(path.join(NMd, 'jsdom'))); FIDB = require(path.join(NMd, 'fake-indexeddb')); } catch (e) { console.log('(skipped the browser: no jsdom)'); }
    const DIST = path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js');
    if (JSDOM && fs.existsSync(DIST)) {
      const SRC = fs.readFileSync(DIST, 'utf8'), AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
      const sleep = ms => new Promise(r => setTimeout(r, ms)), until = async (f, ms) => { for (let i = 0; i < ms / 20; i++) { const v = f(); if (v) return v; await sleep(20); } return f(); };
      const GINFO = { search: { NMCF: [{ Mark: 'NMCF', RegistrationStatus: 'D', AircraftID: 71591 }], UBET: [{ Mark: 'UBET', RegistrationStatus: 'R', AircraftID: 71591 }] },
        details: { 71591: { RegistrationDetails: { Mark: 'UBET', Status: 'Registered' }, AircraftDetails: { SerialNumber: '5601', YearBuild: 1996, ICAO24BitAircraftAddress: { Hex: '407D94' } }, AircraftOperatedByAocHolder: { OperatorName: 'KINGMOOR AVIATION LTD' } } } };
      const makeWin = (url, html) => {
        const win = new JSDOM(html || '<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true }).window;
        win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController; win.Blob = Blob;
        win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
        win.caches = { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => false }) };
        win.__asked = [];
        const answer = (u, o) => {
          win.__asked.push(u); let m;
          if (/flightradar24\.com\/mobile\/airports\/format/.test(u)) return [200, AIRPORTS];
          if (/hexdb\.io\/api\/v1\/aircraft\/407D94/i.test(u)) return [200, JSON.stringify({ Registration: 'G-UBET', ICAOTypeCode: 'AS55', Manufacturer: 'Eurocopter', Type: 'AS355N', RegisteredOwners: 'Private' })];
          if (/ginfoapi\.caa\.co\.uk\/api\/aircraft\/search$/.test(u)) return [200, JSON.stringify(GINFO.search[JSON.parse(o.data || o.body || '{}').registration] || [])];
          if ((m = /ginfoapi\.caa\.co\.uk\/api\/aircraft\/details\/(\d+)$/.exec(u))) return [200, JSON.stringify(GINFO.details[m[1]] || null)];
          return [404, ''];
        };
        win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const a = answer(u, {}); return Promise.resolve(new Response(a[1] || '', { status: a[0] })); };
        win.GM_xmlhttpRequest = o => { const a = answer(o.url, o); setTimeout(() => o.onload && o.onload({ status: a[0], responseText: a[1], response: a[1] }), 2); return { abort() {} }; };
        win.unsafeWindow = win; win.GM_notification = () => {};
        win.__logs = []; win.console.debug = (...a) => win.__logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); win.console.log = () => {}; win.console.error = (...a) => win.__logs.push('ERROR ' + a.join(' '));
        win.eval(SRC);
        return win;
      };
      const ready = async w => { const L = w.__tweeksLadd; await until(() => L && L.engine.airports.length > 5000, 60000); await L.store.kvReady; return L; };
      // (G-RESH, 14 Nov: FR24's rows - St. Athan at 16:41, "Landed 17:31", to "-"; Caernarfon at 18:19 - and its log as the
      // monitor kept it: St. Athan to Caernarfon, down at 18:02)
      { const D = 1794614400, T1 = D + 16 * 3600 + 41 * 60, L1 = D + 17 * 3600 + 31 * 60, T2 = D + 18 * 3600 + 19 * 60, L2 = D + 18 * 3600 + 55 * 60;
        const row = (t, from, to, land, fid) => `<tr class="data-row" data-timestamp="${t}"><td></td><td></td><td data-timestamp="${t}">14 Nov</td><td>${from}</td><td>${to}</td><td><a href="/data/flights/srg387">SRG387</a></td><td>0:50</td><td>—</td><td data-timestamp="${t}">${new Date(t * 1000).toISOString().slice(11, 16)}</td><td>—</td><td><div class="state-block green"></div></td><td data-timestamp="${land}" data-prefix="Landed ">Landed ${new Date(land * 1000).toISOString().slice(11, 16)}</td><td><a class="btn btn-sm btn-playback" data-flight="${fid}">Play</a></td></tr>`;
        const html = `<!doctype html><html><head><title>G-RESH</title></head><body><div id="cnt-aircraft-info"><div class="row"><label>MODE S</label> <span class="details" id="txt-mode-s">408162</span></div></div>
          <table id="tbl-datatable"><tbody>${row(T2, 'Caernarfon <a href="/data/airports/qkc">(QKC)</a>', '—', L2, '429a0002')}${row(T1, 'St. Athan <a href="/data/airports/dgx">(DGX)</a>', '—', L1, '429a0001')}</tbody></table></body></html>`;
        const w = makeWin('https://www.flightradar24.com/data/aircraft/g-resh', html), L = await ready(w);
        const QKC = L.engine.byIcao('EGCK'), DGX = L.engine.byIcao('EGSY');
        L.store.mergeHex('408162', { reg: 'G-RESH', type: 'A139' });
        L.store.setHist('408162', { v: 8, savedAt: Date.now(), days: { '2026/11/14': true }, legs: [
          { day: '2026/11/14', tStart: D + 60090, tEnd: D + 64929, tOff: D + 60059, tOn: D + 64929, startedOnGround: false, ended: true, how: 'ground', from: { id: DGX.id, code: 'DGX', conf: 'low' }, to: { id: QKC.id, code: 'QKC', conf: 'ground' }, endLat: 53.1022, endLon: -4.3358, endAlt: 175, cs: 'SRG387', maxAlt: 3775 },
          { day: '2026/11/14', tStart: D + 65962, tEnd: D + 66454, tOff: D + 65962, startedOnGround: true, ended: true, how: 'gap-low', from: { id: QKC.id, code: 'QKC', conf: 'ground' }, to: null, endLat: 53.126, endLon: -4.0175, endAlt: 1875, cs: 'SRG387' }] });
        await sleep(1500);
        const toCell = () => (w.document.querySelector('[data-flight="429a0001"]').closest('tr').children[4] || {}).textContent || '';
        const got = await until(() => /Caernarfon/.test(toCell()) ? toCell() : null, 6000);
        check('(G-RESH, 14 Nov) FR24 lost it over Snowdonia, "Landed 17:31"; its public track down at Caernarfon at 18:02, before its next flight: its row to Caernarfon - not "Caernarfon?" from that next flight', !!got && /Caernarfon/.test(got) && !/\?/.test(got), toCell());
        w.location.hash = '#429a0001'; await sleep(300);
        w.document.body.insertAdjacentHTML('beforeend', '<div class="playback-player"><span id="txt-airport-origin">St. Athan <small>(DGX)</small></span><span id="txt-airport-dest">-</span></div>');
        const pb = await until(() => /Caernarfon/.test(w.document.getElementById('txt-airport-dest').textContent) ? w.document.getElementById('txt-airport-dest').textContent : null, 3000);
        check('... and its playback: to Caernarfon, not "-"', !!pb && !/\?/.test(pb), w.document.getElementById('txt-airport-dest').textContent);
        const errs = w.__logs.filter(l => /^ERROR|TypeError|ReferenceError/.test(l));
        check('... no script errors', !errs.length, errs.slice(0, 5));
        w.close(); }
      // (407D94: G-NMCF to the aggregators, G-UBET to its register)
      { const w = makeWin('https://www.flightradar24.com/51.0,-3.0/8'), L = await ready(w);
        const rec = { id: 0x42991614, hex: '407d94', reg: 'G-NMCF', type: 'AS55', cs: 'HLL01', owner: 'Kingmoor Aviation', countryId: 222, idAt: Date.now(), ownerAskedAt: Date.now(), fr24At: Date.now() };
        L.store.setId(rec.id, rec); L.store.mergeHex('407d94', { reg: 'G-NMCF', type: 'AS55', owner: 'Kingmoor Aviation' });
        await L.enrich(rec);
        const hx = L.store.getHex('407d94') || {};
        check('(407D94) an aircraft under a UK mark: its register asked within the week whatever else is known - de-registered, the airframe G-UBET since: renamed, the old mark kept as its old one', rec.reg === 'G-UBET' && hx.reg === 'G-UBET' && hx.regOld === 'G-NMCF' && w.__asked.some(u => /ginfoapi/.test(u)), { reg: rec.reg, hx: { reg: hx.reg, regOld: hx.regOld }, asked: w.__asked.filter(u => /ginfo|hexdb/.test(u)) });
        const r2 = L.recordFromMatch({ id: 0x42991615, lat: 53.3, lon: -2.9, alt: 900 }, { c: { hex: '407D94', reg: 'G-NMCF', type: 'AS55', cs: 'HLL01', src: 'adsb.lol' }, d: 0.1 }, ['adsb.lol']);
        const r3 = L.srvRec([0x42991616, '407d94', 'G-NMCF', 'AS55', 'HLL01', 1, 'named', Math.floor(Date.now() / 1000)]);
        const r4 = L.recordFromMatch({ id: 0x42991617, lat: 53.3, lon: -2.9, alt: 900 }, { c: { hex: '407D94', reg: 'G-OTHR', type: 'AS55', cs: 'HLL01', src: 'adsb.lol' }, d: 0.1 }, ['adsb.lol']);
        check('... the old mark heard again (a feed, the monitor\'s names): the mark of today; a third mark: taken as heard', r2.reg === 'G-UBET' && r3.reg === 'G-UBET' && r4.reg === 'G-OTHR', { r2: r2.reg, r3: r3.reg, r4: r4.reg });
        const n0 = w.__asked.filter(u => /ginfoapi/.test(u)).length; await L.enrich(rec);
        check('... not asked again within the week', w.__asked.filter(u => /ginfoapi/.test(u)).length === n0);
        w.close(); }
    } else if (JSDOM) console.log('(skipped the browser: no build in dist/)');
  }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
