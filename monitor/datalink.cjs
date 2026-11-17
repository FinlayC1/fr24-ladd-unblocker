'use strict';
// The routes aircraft send and are sent over their datalinks (ACARS, VDL2, HFDL) - adsb.lol's open data of them
// (github.com/adsblol/aircraft-data-links-<year>, CC0: a release a day, a file an hour per feed, zstd JSON lines). A
// business jet's flight-management system is uplinked its flight plan ("FPN/RI:DA:KCMH:AA:KTEB"), its flight-planning
// service sends "FLIGHT PLAN A0214 (KVNY - KSAC) FOR TAIL N711WK IS AVAILABLE", and in the air it reports where it is
// going ("POS02,N49354W002264,409,KPTK,LFPB,..."). On 22 Oct 2026: 379 LADD aircraft heard on these links, 58 of them
// with their route in a message; 132 other business jets. Checked against the flights flown on 21 Oct (481 messages of
// 172 business jets and LADD aircraft): where the message's origin was the flight's, its destination was the one landed
// at 362 times in 367 (98.6%; LADD aircraft 123 in 128). What a message names is the aircraft's own plan - the
// destination, not a guess at it - an hour or so after it is sent (the files are published hourly).
// Kept: per registration, the latest routes of the last 36 hours. Never stored whole; nothing else of the messages kept.
const zlib = require('zlib');

// ---- the messages: one line of any of the three feeds -> { reg, t, label, text } ----------------------------------
function msgOf(j) {
  if (!j || typeof j !== 'object') return null;
  let a = null, t = 0;
  if (j.vdl2) { a = j.vdl2.avlc && j.vdl2.avlc.acars; t = j.vdl2.t && j.vdl2.t.sec; }
  else if (j.hfdl) { const l = j.hfdl.lpdu; a = l && l.hfnpdu && l.hfnpdu.acars; t = j.hfdl.t && j.hfdl.t.sec; }
  else { a = { reg: j.tail, label: j.label, msg_text: j.text, flight: j.flight }; t = j.timestamp; }
  if (!a) return null;
  const reg = String(a.reg || '').replace(/^[.\s]+/, '').trim().toUpperCase(), text = String(a.msg_text || a.text || '');
  if (!reg || !text || !/^[A-Z0-9-]{2,10}$/.test(reg)) return null;
  if (!(t > 0) && j._adsblol && j._adsblol.received_at) t = Date.parse(j._adsblol.received_at) / 1000;
  return { reg, t: +t || 0, label: String(a.label || ''), text, flight: String(a.flight || '').trim() };
}

// ---- a route in a message: { o, d, kind, std? } (ICAO codes) or null ---------------------------------------------------
// Only forms that say which is which - departure and arrival - are read; two airport codes side by side in any other
// text (a weather request, a maintenance note) are not a route.
const PATTERNS = [
  // flight plan uplinked to the FMS: DA departure, AA arrival (and AL alternate)
  ['fpn', /(?:^|[/:])DA:([A-Z]{4}):AA:([A-Z]{4})\b/],
  // position report with origin and destination (Honeywell/Collins: POS02, SPN02 - "00POS02,N49220E002136,102,LFPB,KBGR,")
  ['pos', /(?:^|[^A-Z])(?:POS|SPN)0\d,[^,]*,[^,]*,([A-Z]{4}),([A-Z]{4}),/],
  // flight-planning service: "FLIGHT PLAN A0214 (KVNY - KSAC) FOR TAIL N711WK IS AVAILABLE"
  ['fpl', /FLIGHT PLAN [A-Z0-9]+ \(([A-Z]{4}) - ([A-Z]{4})\) FOR TAIL/],
  // "FPL# E9024 KBFI-KPHX FOR N86HD HAS BEEN FILED FOR A 1940Z DEPARTURE ON 22 OCTOBER 2026"
  // (1.3.8: the registration with the callsign after it - "FOR 763239/SPAR89", "FOR N212LF/EJM3" - read too)
  ['filed', /FPL# ?[A-Z0-9]+ ([A-Z]{4})-([A-Z]{4}) FOR [A-Z0-9-]+(?:\/[A-Z0-9-]+)? HAS BEEN FILED(?: FOR A (\d{4})Z DEPARTURE)?/],
  // satcom flight-plan alerts: "YOUR FLIGHT PLAN E5520 KDJT-KUGN HAS BEEN EVALUATED"
  ['alert', /YOUR FLIGHT PLAN [A-Z0-9]+ ([A-Z]{4})-([A-Z]{4}) /],
  // pre-departure clearance: "PDC EJA678)\r\nKDJT-KJWN)" - the departure and destination line after it
  ['pdc', /\bPDC\b[\s\S]{0,40}?\b([A-Z]{4})-([A-Z]{4})\b/],
  // estimated time of arrival report: "ETA221759,KMEM,KBRO,"
  // (1.3.8: and with the time alone - "ETA0641,ZSPD,EGKK, 33746")
  ['eta', /^ETA(?:\d{6}|\d{4}),([A-Z]{4}),([A-Z]{4}),/],
  // E-jets and others: "96,E,29.297,-96.379,20994,*****,KCRP,KIAH,"
  ['rep', /^\d{2},[A-Z],-?\d+\.\d+,-?\d+\.\d+,\s*\d+,[^,]*,([A-Z]{4}),([A-Z]{4}),/]
  // (not read: operations messages - "OPSCTL 0321/21 KHVN/KFLL" - name the leg as scheduled; checked against the flights
  // flown on 21 Oct, half were another leg - N805VL flew New Haven - San Juan)
];
// ---- (1.3.1) more of what the links carry, each form checked against a whole day of adsb.lol's files (10 Nov 2026: 800,776
// messages with a registration, 14,948 aircraft): where another message of the same flight named its route, these agreed
// with it every time (departure clearances 72 of 72, oceanic clearances 120 of 120, the reports with a position 19 of 19;
// the label-10 reports' last low position was at the airport they named 24 times in 24). Of the business jets and LADD
// aircraft heard that day, 187 had a route read before; 614 with these.
//   [kind, pattern, form] - 'od' origin then destination; 'do' destination then origin; 'd' the destination alone (said
//   in flight: the aircraft's own, or its controller's); 'atis' an airport whose arrival information it asked for or was sent
const POSF = '[NS] ?\\d[\\d.]* ?,? ?[EW] ?\\d[\\d.]*';
// (1.3.8: the ARINC 620 reports, by what each is: from the air - its position, its estimate, weather asked for, in range,
// maintenance - or of the gate before it (delay, dispatch, weight and balance); its out and off; on and in, of a flight
// landed. One not here is not read)
const MU_KIND = { POSRPT: 'pos', POSWX: 'pos', ETA: 'pos', ETARP: 'pos', WXRQ: 'rpt', INRANG: 'rpt', OPNORM: 'rpt', MTCRP: 'rpt', WXLIDO: 'rpt', MOVERP: 'rpt', RMPSRV: 'rpt',
  ONRP: 'rpt', INRP: 'rpt', OFFRP: 'oooi', OUTRP: 'oooi', DEPDLA: 'gate', DSPTCH: 'gate', WTBAL: 'gate' };
// (KLM's: its load sheet before the flight; the others - its maintenance log, its estimate, weather - from the air)
const KL_KIND = { LDA: 'gate', AML: 'rpt', NML: 'rpt', RST: 'rpt', ETA: 'rpt', WXR: 'rpt', KOI: 'rpt' };
// (an out / off report that also gives the flight's on or in time: of a flight landed - no plan for the one after)
const MORE = [
  // reports with a position, then where from and where to (ETA, TOC, TOD, TWX, ATI, MSG ...: "00ETA03,N31148W082322,390,KAPF,KLZU,1110,1655,1740,004.1")
  ['rpt', new RegExp('(?:^|[^A-Z])(?!POS|SPN)[A-Z]{2,4}0\\d,(' + POSF + '),[^,]*,([A-Z]{4}),([A-Z]{4}),(?:(\\d{4}),(\\d{4}),)?'), 'od-pos'],
  // out of the gate, off, on, in: "OFF02,N28261W081196,KMCO,KGGG,1110,1625,1819,014.0"
  ['oooi', new RegExp('(?:^|[^A-Z])(?:OUT|OFF|ON|IN)0\\d,(' + POSF + '),([A-Z]{4}),([A-Z]{4}),(?:(\\d{4}),(\\d{4}),)?'), 'od-pos'],
  // the flight-planning service's notice (NetJets' GDFS): "FLIGHT PLAN #E5106,\r\nKAUS-KPHX IS NOW\r\nAVAILABLE FOR RECALL"
  // (1.3.8: and with its time of departure, the lines broken anywhere: "FLIGHT PLAN #D3211,\r\nLSZH-LQSA 1115Z ETD, IS\r\nNOW AVAILABLE")
  ['fpl', /FLIGHT PLAN #?[A-Z0-9]+,?\s+([A-Z]{4})-([A-Z]{4})(?:\s+(\d{4})Z ETD,?)?\s+IS\s+NOW\s+AVAILABLE/, 'od-std'],
  // "PDC AVAILABLE FOR:\r\nKAUS - KMKE\r\nETD: 2000Z"
  ['pdc', /PDC AVAILABLE FOR:\s*([A-Z]{4}) - ([A-Z]{4})\s+ETD: ?(\d{4})Z/, 'od-std'],
  // "MSG/RX10-NOV-26 1715Z PDC N914MC/RXKLIT-KSOP/RX-ATC CLEARANCE-"
  ['pdc', /\bPDC [A-Z0-9-]+\/RX([A-Z]{4})-([A-Z]{4})\/RX/, 'od'],
  // departure clearance by datalink (Europe, Canada ...): "/BHXDCXA.DC1/CLD 0556 261110 EGBB PDC 033\r\nRYR97XJ CLRD TO GCRR OFF 15"
  // (1.3.8: its lines broken after "PDC" too - Amsterdam's, Barcelona's: "EHAM PDC\r\n 265\r\nCND2Q CLRD TO HEGN" - none was read)
  ['dcl', /\.DC1\/C[LD][DA] (\d{4}) (\d{6}) ([A-Z]{4})\s+PDC\s+\d+\s+\S+\s+CLRD TO ([A-Z]{4})\b/, 'od-clr'],
  // Australia: "PDC 100120 JST565 A320 YBBN 0205 CLEARED TO YMML VIA"
  // (1.3.8: New Zealand's too, its fields on lines of their own: "PDC PDC 170725 ANZ148 A21N YBBN 0810 CLEARED TO NZAA VIA")
  ['dcl', /\bPDC(?:\s+UPLINK)?\s+(?:\d{6}\s+)?[A-Z0-9]{2,8}\s+[A-Z0-9]{2,4}\s+([A-Z]{4})\s+\d{4}\s+CLEARED TO ([A-Z]{4})\s+VIA/, 'od'],
  // the US clearance sent for reference with a CPDLC one: "AAL2013 KDCA\r\nB738/L P0059 /AN N939NN\r\n673 FL400\r\nCLEARED TO KMIA AIRPORT"
  ['dcl', /\b[A-Z0-9]{2,8} ([A-Z]{4})\s+[A-Z0-9]{2,5}\/[A-Z] P\d{4}[\s\S]{0,60}?CLEARED TO ([A-Z]{4}) AIRPORT/, 'od'],
  // "DA EGNX/DS LEAL/OFF 0627"
  ['rep', /\bDA ([A-Z]{4})\/DS ([A-Z]{4})\b/, 'od'],
  // a position report naming where it is going, when it will be there, the fixes ahead with their times and - on some
  // aircraft - where it came from (NetJets and others, label 10, every ten minutes):
  //   "/N30.336/W098.165/10/0.73/008/230/KDAL/0049/0050/00028/DITSY/CHRLY/0024/FRSTI/0029/KSAT/"
  ['pos', /^\/([NS]\d{2}\.\d{3}\/[EW]\d{3}\.\d{3})\/\d{1,2}\/\d\.\d\d\/\d{3}\/\d{3}\/([A-Z]{4})\/(\d{4})\/[^/]*\/[^/]*\/[^/]*\/[^/]*\/(\d{4}|-{4})\/[^/]*\/(\d{4}|-{4})\/(?:([A-Z]{4})\/)?\s*$/, 'do-pos10'],
  // out of the gate and off (labels QP, QQ - the airlines' form, M-PORT's too): "EGGPEGJB0855", "KDCAKORD00500329" (on and
  // in - QR, QS - not read: a flight landed)
  ['oooi', /^([A-Z]{4})([A-Z]{4})(\d{4})/, 'od-q'],
  // oceanic clearance: "/PIKCLYA.OC1/CLA 0356 261110 EGGX CLRNCE 898\r\nQQE247 CLRD TO KIAD VIA VENER"
  ['ocl', /\.OC1\/CL[AX] (\d{4}) (\d{6}) [A-Z]{4}\s+CLRNCE \d+\s+\S+ CLRD TO ([A-Z]{4}) VIA/, 'd-clr'],
  // the flight-management system asking for (or sent) the winds for its descent: "/DQ470,KFTW,"
  ['dq', /\/D[QD]\d{3},([A-Z]{4}),/, 'd'],
  // the arrival information (ATIS) sent to it: "/HDQGLXH.TI2/KLAS ARR ATIS M" ...
  ['atis', /\.TI\d\/([A-Z]{4}) ARR ATIS /, 'atis'],
  // ... or asked for by it (label B9: "/KTEB.TI2/024KTEBA3FBD" - A: arrival, C: arrival, kept up to date)
  ['atis', /^\/([A-Z]{4})\.TI\d\/\d{3}\1[AC]/, 'atis-b9'],
  // ---- (1.3.8) more of the forms the links carry: each found in a sample of every aircraft's messages Airframes had heard in
  // the hour (17 Nov 2026: 3,800 messages of 40 forms), each one naming the route the flight it came from was flying
  // ARINC 620 reports (labels 80, 83, 5U, 27): "3N01 POSRPT UAE654 /17 OMDB/VCBI .A6-EXI POS N234057E0572516", "3402 ETA
  // 1481/ OMDB/VTSG .A6-FMW", "1101 OFFRP 06LW/17 LGAV/EGKK .SX-NAQ /OUT 0711/OFF 0734", "01 WXRQ 041X/17 EGHH/GCTS .G-JZHH",
  // "SVA3N03 POSRPT 0596/17/17 OERK/OMDB HZ-ASU /POS" - the flight it is on in its first line; what it is says when it was
  // sent (MU_KIND): from the air, at the gate before the flight, on the way out; one not known not read
  ['', /^\s*(?:[A-Z]{3})?[0-9A-Z]{2}\d{0,2}[ \t]+(?<typ>[A-Z]{2,7})(?:[ \t]+|\/)[^.\n]{0,30}?\/\s*\d{0,2}\s*(?<o>[A-Z]{4})\/(?<d>[A-Z]{4})[ \t]*\.{0,2}[A-Z0-9-]{2,10}(?=[\s/]|$)/, 'g', null, MU_KIND],
  // ... and its operations message - only once it has taken off (its OFF time in it: "3A01 OPSCTL 0622/17 CYHM/CYHZ .C-FFPA
  // OUT0650 OFF0709 ETA0858"); one before take-off names the leg as scheduled, not always the one flown
  ['oooi', /^\s*\d[A-Z0-9]\d{2} OPSCTL\s+[A-Z0-9]{0,9}\/\d{2} ([A-Z]{4})\/([A-Z]{4}) \.[A-Z0-9-]{2,10}\b[\s\S]{0,60}?\bOFF ?\d{4}/, 'od'],
  // the engine and performance reports of Airbus aircraft (label H1): "/CCVH-VFD,NOV17,073550,YBBN,YMAV,0635/" - its time to
  // the second, its departure and its destination
  // (and "/C1N579UW,NOV17,072526,KDFW,KSEA,2647/", "/CCN386FR,NOV17,KSFO,KLAS,4156/" - some with no time)
  ['rpt', /\/C[C1][A-Z0-9-]{2,10},[A-Z]{3}\d{2},(?:(\d{4})\d{2},)?([A-Z]{4}),([A-Z]{4}),/, 'od-rep'],
  // reports of several airlines (labels 10 - 13): "EGLL,EBBR,17NOV26,0735,080124 N 51.231,E 1.054", "LSZH,HTKJ,17NOV26,0735"
  ['rpt', /^([A-Z]{4}),([A-Z]{4}),\d{2}[A-Z]{3}\d{2},(\d{4})\b/, 'od-l1x'],
  // "000322072LOWW,EDDH,0735,0805,N 52.715,E 11.766,30" (label 1L)
  ['rpt', /^\d{9}([A-Z]{4}),([A-Z]{4}),\d{4},\d{4},[NS] ?\d/, 'od'],
  // top of descent: "TOD01,ETD596,LLBG,OMAA,17NOV26,0758,OMAA31R", "TOD02 ETD379/17170732VRMMOMAA 0803,OMAA 31R"
  ['rpt', /\bTOD\d\d,[A-Z0-9]+\s*,([A-Z]{4}),([A-Z]{4}),\d{2}[A-Z]{3}\d{2},\d{4}/, 'od'],
  // take-off report: "TOL01,17NOV26,EY,917,OMAA,EHAM,16NOV26,2359"
  ['oooi', /\bTOL0\d,\d{2}[A-Z]{3}\d{2},[A-Z0-9]{2},\s*[A-Z0-9]+,([A-Z]{4}),([A-Z]{4}),\d{2}[A-Z]{3}\d{2},\d{4}/, 'od'],
  ['rpt', /\bTOD0\d [A-Z0-9]+\/\d{6,8}([A-Z]{4})([A-Z]{4}) \d{4},/, 'od'],
  // "/AY1411/ETA01/171126/EFHK/EDDF/EDFH/", "/AY1331/OFF01/171126/EFHK/EGLL/EGKK/" (Finnair and others)
  ['rpt', /\/ETA0\d\/\d{6}\/([A-Z]{4})\/([A-Z]{4}) ?\//, 'od'],
  ['oooi', /\/(?:OUT|OFF|ON|IN)0\d\/\d{6}\/([A-Z]{4})\/([A-Z]{4}) ?\//, 'od'],
  // "ORG VHHH,DES ZSQD,UTC070701,N 25.086,E118.799,ALT 35128" (label 16: Chinese airlines and others) - where it was, when
  ['pos', /\bORG ([A-Z]{4}),DES ([A-Z]{4}),UTC(\d{4})\d{2},([NS] ?\d{1,2}\.\d+),([EW] ?\d{1,3}\.\d+),/, 'od-org'],
  // "V09CA032/OFFRP/ESSA/ESGG/17/0734/ETA0823/", "OFF02 KSFO,KBWI,0647,30.7"
  ['oooi', /\/(?:OFFRP|ONRP|INRP)\/([A-Z]{4})\/([A-Z]{4})\/\d{2}\/\d{4}\//, 'od'],
  ['oooi', /(?:^|[^A-Z])(?:OUT|OFF|ON|IN)0\d ([A-Z]{4}),([A-Z]{4}),\d{4},/, 'od'],
  // JetBlue's reports (labels 43, 44): "/FB 0107/AD KBOS/N4222.1,W07100.9,0000000,ATI03,KIAH,KBOS,," - from and to; "/AD KLAX/"
  // alone: where it is going
  ['rpt', /,(?:ATI|INR|INA)0\d,([A-Z]{4}),([A-Z]{4}),/, 'od'],
  ['rpt', /^\s*\/FB \d{4}\/AD ([A-Z]{4})\//, 'd'],
  // a position, then its destination last (label 21): "POSN 32.729W116.838, 71,073518,5738,24235, 22, 6,074230,KSAN"
  ['pos', /^POSN [NS]?\d{1,2}\.\d+[EW]\d{1,3}\.\d+,[^,]*,\d{6},[^,]*,[^,]*,[^,]*,[^,]*,\d{6},([A-Z]{4})\s*$/, 'd'],
  // Alaska's and others' (label 33): "27,B,17NOV26,073439,+44.810,-122.634,35996,9567,KSNA,KPAE,KPAE,17,16R/-"
  ['rpt', /^\d{2},[A-Z],\d{2}[A-Z]{3}\d{2},(\d{4})\d{2},([+-]\d{1,2}\.\d+),([+-]\d{1,3}\.\d+),\d+,\d+,([A-Z]{4}),([A-Z]{4}),/, 'od-33'],
  // Frontier's (label 4A): "065536,1711,.N386FR,FFT3581,KSNA,KSFO,1,0655,RT0,LT0,"
  ['rpt', /^\d{6},\d{4},\.[A-Z0-9-]{2,10},[A-Z0-9]*,([A-Z]{4}),([A-Z]{4}),/, 'od'],
  // landing data asked for (label 5Z): "/B6 LDG DATA REQ / KSAN KSFO 16 073431 KSFO R28R"
  ['rpt', /^\/[A-Z0-9]{2} [A-Z0-9 ]{2,30}\/ ([A-Z]{4}) ([A-Z]{4}) \d{2} (\d{4})\d{2}\b/, 'od-rep5z'],
  // a whole ICAO flight plan sent to the aircraft (a dispatcher's or a planning service's): "(FPL-N212LF-IG -C25B/L-SDGW/S
  // -KSDL1400 -N0480F450 FTHLS6 ... -KOFP0215 KRIC ..." - read only in that form, every field where it belongs
  ['fpl', /\(FPL-[A-Z0-9]{2,8}-[IVYZ][SNGMX]\s*-(?:\d{0,2})?[A-Z0-9]{2,4}\/[LMHJ]\s*-\S+\s*-([A-Z]{4})\d{4}\s*-[NKM]\d{3,4}[\s\S]{0,2000}?\s-([A-Z]{4})\d{4}\b/, 'od'],
  // ---- (1.3.8) and more again, from a second sample (9,034 messages, 17 Nov): the reports the engines, the maintenance
  // computers and the performance monitors send from the air, each with the flight's two airports in its heading -
  //   Rolls-Royce engines' (H1): "SB0122BA_C-FIUV CYYZEGLL653 51599-", "EB0032AA_ G-ZBJB VOBLEGLL 77", "ABS001DA_ EGSSEFRO 52"
  //   (the registration's letters at times spaced out: "ABS001DA_S   YG  EPWALFPG335")
  ['rpt', /^[A-Z]{2,3}\d{3,4}[A-Z]{2}_[A-Z0-9 -]{0,16}?(?<=[\s_])(?<o>[A-Z]{4})(?<d>[A-Z]{4})\d{0,3}\s/, 'g'],
  //   Boeing's of the same (737s): "ABS026AA_N37318,B737N37-1261117,UA    ,KSFO,KLAX,1795,BCG2E-S200-0009"
  ['rpt', /^(?:#DFB)?[A-Z]{3}\d{3}[A-Z]{2}_[^\n]{0,60}?,(?<o>[A-Z]{4}),(?<d>[A-Z]{4}),\d{4},[A-Z0-9]{5}-/, 'g'],
  //   United's: "EB0116AB_10, 31, N14001,UAL944    ,  96,171126,07:25:20,KORD,EDDF,36526" - with its time
  ['rpt', /^(?:#DFB)?EB\d{4}[A-Z]{2}_[^\n]{0,80}?,\d{6},(?<hh>\d{2}):(?<mm>\d{2}):\d{2},(?<o>[A-Z]{4}),(?<d>[A-Z]{4}),/, 'g'],
  //   Boeing's (Southwest and others): "++86501,N8716B,B7378MAX,261117,WN8517,KPAE,KDEN,1479,"
  ['rpt', /^(?:#DFB)?\+\+\d{5},[A-Z0-9-]{2,8},[A-Z0-9]{2,10},\d{6},[A-Z0-9]{2,8},(?<o>[A-Z]{4}),(?<d>[A-Z]{4}),/, 'g'],
  //   the fault reports: "EFFDE 1 17NOV26 0724 AAN791AN AAL48 KDFW/LFPG", "PLF 1 17NOV26 0753 A6-FNB FDB9RQ OTHH/OMDB", ".HL7637
  //   17NOV26 0725 KAL012 KLAX/RKSI" - with their time
  ['rpt', /^(?:EFFDE|PLF)\s+\d+\s+\d{2}[A-Z]{3}\d{2}\s+(?<hm>\d{4})\s+[A-Z0-9-]{2,9}\s+[A-Z0-9]{2,8}\s+(?<o>[A-Z]{4})\/(?<d>[A-Z]{4})\b/, 'g'],
  ['rpt', /\.[A-Z0-9-]{2,7}\s+\d{2}[A-Z]{3}\d{2}\s+(?<hm>\d{4})\s+[A-Z]{3}\d{1,4}[A-Z]?\s+(?<o>[A-Z]{4})\/(?<d>[A-Z]{4})\b/, 'g'],
  //   the performance monitors': "APM 5VN-A862 HVN51 VVTSEGLL171126000424,", "B03A APM A6-FQG FDB580 VCBIOMDB171126070033,",
  //   "CECB-24614389ZHCCEBLG171126010203"
  ['rpt', /APM\s+(?:\d\s*)?[A-Z0-9-]{2,8}\s+[A-Z0-9]{2,8}\s+(?<o>[A-Z]{4})(?<d>[A-Z]{4})\d{12},/, 'g'],
  ['rpt', /^CECB-\d{8}(?<o>[A-Z]{4})(?<d>[A-Z]{4})\d{12}/, 'g'],
  //   Airbus's own (H1): "C1,.N438DX,26NOV17,07.25.30,KSEA,EHAM,DAL142", "FLIGHT START REPORT ... C1 VH-VWU NOV17 07.25.36 YPPH
  //   YMML 0975"
  ['rpt', /\bC1,\.?[A-Z0-9-]{2,10},\d{2}[A-Z]{3}\d{2},(?<hh>\d{2})\.(?<mm>\d{2})\.\d{2},(?<o>[A-Z]{4}),(?<d>[A-Z]{4}),/, 'g'],
  ['rpt', /\bC1\s+[A-Z0-9-]{2,10}\s+[A-Z]{3}\d{2}\s+(?<hh>\d{2})\.(?<mm>\d{2})\.\d{2}\s+(?<o>[A-Z]{4})\s+(?<d>[A-Z]{4})\b/, 'g'],
  //   Boeing 767s' weather reports: "S/N R:802701 DEPART:KCVG DESTIN:KMSP"; Qantas's "RSI VH-VYC QFA478 0725 17NOV26 YMML
  //   YSSY"; British Airways' (label 15) "FST01LSZHEGLLN50945E0007141196 ... 07440725" - its time last
  ['rpt', /\bDEPART:\s*(?<o>[A-Z]{4})\s+DESTIN:\s*(?<d>[A-Z]{4})\b/, 'g'],
  ['rpt', /^RSI\s+[A-Z0-9-]{2,7}\s+[A-Z0-9]{2,8}\s+(?<hm>\d{4})\s+\d{2}[A-Z]{3}\d{2}\s+(?<o>[A-Z]{4})\s+(?<d>[A-Z]{4})\b/, 'g'],
  ['rpt', /^FST01(?<o>[A-Z]{4})(?<d>[A-Z]{4})[NS]\d[^\n]*?\s\d{4}(?<hm>\d{4})\s*$/, 'g'],
  //   the airlines' own: flydubai's (label 80) "FDB156,OMDB,VRMM, ,1039,0392,,"; Aer Lingus' "EIN118/17NOV26/EI-LRD/KIAD/EIDW/0106";
  //   China's "POS UTC 080220,DEP ZGSZ,DES RCTP,N 24030E120121"; Delta's "P,E,2026-11-17 07:20:28, 22267297,16NOV,5626,KLAX,KFAT,";
  //   the landing data asked for (labels 33, 10): "331,C,... ,17,KAFW,KTOL,KTOL,25/,", "LDR01,189,D,... ,PHNL,PHOG,PHOG,02/"
  ['rpt', /^[A-Z]{3}\d{1,4}[A-Z]?,(?<o>[A-Z]{4}),(?<d>[A-Z]{4}),\s*,\d{4},\d{4},/, 'g'],
  ['rpt', /^\s*[A-Z]{3}[A-Z0-9]{1,5}\/\d{2}[A-Z]{3}\d{2}\/[A-Z0-9-]{2,7}\/(?<o>[A-Z]{4})\/(?<d>[A-Z]{4})\/\d{4}\s*$/, 'g'],
  ['pos', /\bPOS UTC (?<hm>\d{4})\d{2},DEP (?<o>[A-Z]{4}),DES (?<d>[A-Z]{4}),/, 'g'],
  ['rpt', /^P,[A-Z],\d{4}-\d{2}-\d{2}\s(?<hh>\d{2}):(?<mm>\d{2}):\d{2},\s*\d+,\d{2}[A-Z]{3},\d{1,4},(?<o>[A-Z]{4}),(?<d>[A-Z]{4}),/, 'g'],
  ['rpt', /^(?:LDR\d{2}|\d{1,3}),[^\n]{0,120}?,(?<o>[A-Z]{4}),(?<d>[A-Z]{4}),\k<d>,\d{2}[LRC]?\//, 'g', /^(?:33|10)$/],
  //   Brussels Airlines' (label 44): "SN2184,EGCC,EBBR,17NOV26,D," (its label 30 names the flight after - not read)
  ['rpt', /^[A-Z0-9]{2}\d{1,4}[A-Z]?,(?<o>[A-Z]{4}),(?<d>[A-Z]{4}),\d{2}[A-Z]{3}\d{2},[A-Z],/, 'g', /^44$/],
  //   KLM's and Transavia's: the kind, the day and time, the flight, its airports - "AML17M17072700KLM618 KBOSEHAM:",
  //   "RST18A17072547KLM602  KLAXEHAM", "LDA31M17075642KLC1069 EHAMEGHI76999 LDS EDN01 FINAL" (a load sheet: at the gate)
  ['', /^(?<typ>[A-Z]{3})\d{2}[A-Z]\d{2}(?<hh>\d{2})(?<mm>\d{2})\d{2}[A-Z]{3}\d[A-Z0-9]{0,4}\s+(?<o>[A-Z]{4})(?<d>[A-Z]{4})/, 'g', null, KL_KIND],
  // the messages of the gate before a flight (kind 'gate': its load sheet, its final weights, its delay): the flight it is
  // about to fly - United's "FINAL WEIGHTS UA0552/16 KSFO KONT SENT: 07:34:51Z" (and its dangerous goods), easyJet's (label 8D) "0005,89,0033,99,----,---,
  // 0038,0746,EGKK,EGAA" (its departure time, then its airports), Brussels' "DEPARTURE AIRPORT LSZH / ARRIVAL AIRPORT EBBR"
  ['gate', /(?:^|[^A-Z])FINAL (?:WEIGHTS|DANGEROUS GOODS SUMMARY)\b[\s\S]{0,60}?\s[A-Z0-9]{2,8}\/\d{2}\s+(?<o>[A-Z]{4})\s+(?<d>[A-Z]{4})\s+SENT:\s*(?<hh>\d{2}):(?<mm>\d{2})(?::\d{2})?Z/, 'g'],
  ['gate', /^[\d-]{4},[\d-]{2,3},[\d-]{4},[\d-]{2,3},[\d-]{4},[\d-]{2,3},[\d-]{4},(?<std>\d{4}),(?<o>[A-Z]{4}),(?<d>[A-Z]{4})\b/, 'g', /^8D$/],
  ['gate', /\bDEPARTURE AIRPORT (?<o>[A-Z]{4})\s*\/\s*ARRIVAL AIRPORT (?<d>[A-Z]{4})\b/, 'g'],
  // United's out-off-on-in record (label RB): "/CURRENT FLT 3877 KMLB KDEN 17 /PDOOR 0710 /OUT 0718 /GSI 0718 /OFF 0734"
  ['oooi', /\/CURRENT FLT\s+[A-Z0-9]{1,6}\s+(?<o>[A-Z]{4})\s+(?<d>[A-Z]{4})\s+\d{2}\s/, 'g']
];
const LANDED = /(?:^|[^A-Z])(?:ON|IN)(?:0\d|RP)(?=[,/ ]|$)|(?:^|[^A-Z])(?:ON|IN) ?\d{4}\b/;
// (a position as these messages write it -> [lat, lon]: "N28261W081196" (degrees and minutes to a tenth), "N 41.714,W 89.614",
// "N30.336/W098.165" (degrees))
function posIn(p) {
  let m = /^([NS]) ?(\d{2})(\d{2})(\d) ?,? ?([EW]) ?(\d{3})(\d{2})(\d)$/.exec(p);
  if (m) return [(m[1] === 'S' ? -1 : 1) * (+m[2] + (+m[3] + m[4] / 10) / 60), (m[5] === 'W' ? -1 : 1) * (+m[6] + (+m[7] + m[8] / 10) / 60)];
  m = /^([NS]) ?(\d{1,2}\.\d+) ?[,/] ?([EW]) ?(\d{1,3}\.\d+)$/.exec(p);
  return m ? [(m[1] === 'S' ? -1 : 1) * +m[2], (m[3] === 'W' ? -1 : 1) * +m[4]] : null;
}
// (a time of day a message carries - HHMM, UTC - in minutes from the time it was heard: within half a day either way)
function minsFrom(t, hhmm) { const d = new Date(t * 1000), x = +hhmm.slice(0, 2) * 60 + +hhmm.slice(2) - d.getUTCHours() * 60 - d.getUTCMinutes(); return x > 720 ? x - 1440 : x < -720 ? x + 1440 : x; }
// the route in a message: { o, d, kind, std? } - o '' where it names only where it is going; and, where the message says
// them, `at` [lat, lon] (where the aircraft was), `eta` (HHMM), `own` (minutes its own time of day is off the time it was
// heard at: null where it carries none). label: its ACARS label (the B9 form is read only under it); t: when it was heard
function routeOf(text, isAirport, label, t) {
  const s = String(text || '').toUpperCase(), ok = c => !isAirport || isAirport(c);
  for (const [kind, re] of PATTERNS) {
    const m = re.exec(s); if (!m) continue;
    const o = m[1], d = m[2];
    if (o === d || !ok(o) || !ok(d)) continue;
    const r = { o, d, kind }; if (kind === 'filed' && m[3]) r.std = m[3];
    // (the reports with a position: "POS02,N28212 W086269,430,KFXE,KVNY,1110,0106,0514" - the day, the time, the estimate)
    if (kind === 'pos' && t > 0) { const x = /0\d,([NS] ?\d[\d.]* ?,? ?[EW] ?\d[\d.]*),[^,]*,[A-Z]{4},[A-Z]{4},(\d{4}),(\d{4}),(\d{4})?/.exec(s); if (x) { const at = posIn(x[1]); if (at) r.at = at; r.own = minsFrom(t, x[3]); if (x[4]) r.eta = x[4]; } }
    return r;
  }
  for (const [kind, re, form, lab, kinds] of MORE) {
    const m = re.exec(s); if (!m) continue;
    let r = null;
    if (form === 'od') r = { o: m[1], d: m[2], kind };
    else if (form === 'od-std') { r = { o: m[1], d: m[2], kind }; if (m[3]) r.std = m[3]; }
    else if (form === 'od-pos') { r = { o: m[2], d: m[3], kind }; const at = posIn(m[1]); if (at) r.at = at; if (m[5] && t > 0) r.own = minsFrom(t, m[5]); }
    else if (form === 'od-q') { if (!/^Q[PQ]$/.test(label || '')) continue; r = { o: m[1], d: m[2], kind }; if (t > 0) r.own = minsFrom(t, m[3]); }
    // (1.3.8) the time of day it was made, to the minute - its own clock (one replayed later is dropped, as for the others)
    else if (form === 'od-rep') { r = { o: m[2], d: m[3], kind }; if (t > 0 && m[1]) r.own = minsFrom(t, m[1]); }
    else if (form === 'od-l1x') { if (!/^1[0-3]$/.test(label || '')) continue; r = { o: m[1], d: m[2], kind }; if (t > 0) r.own = minsFrom(t, m[3]); }
    else if (form === 'od-33') { r = { o: m[4], d: m[5], kind, at: [+m[2], +m[3]] }; if (t > 0) r.own = minsFrom(t, m[1]); }
    else if (form === 'od-rep5z') { r = { o: m[1], d: m[2], kind }; if (t > 0) r.own = minsFrom(t, m[3]); }
    else if (form === 'od-org') { r = { o: m[1], d: m[2], kind }; const at = posIn(m[4] + ',' + m[5]); if (at) r.at = at; if (t > 0) r.own = minsFrom(t, m[3]); }
    else if (form === 'od-clr') { r = { o: m[3], d: m[4], kind }; if (t > 0) r.own = minsFrom(t, m[1]); }
    else if (form === 'd-clr') { r = { o: '', d: m[3], kind }; if (t > 0) r.own = minsFrom(t, m[1]); }
    else if (form === 'do-pos10') {
      r = { o: m[6] || '', d: m[2], kind, eta: m[3] }; const at = posIn(m[1]); if (at) r.at = at;
      // (its own clock: the time it gives for the next fix - ahead of it, three hours at most; a little behind when just passed)
      const w = /^\d/.test(m[4]) ? m[4] : /^\d/.test(m[5]) ? m[5] : ''; if (w && t > 0) { const x = minsFrom(t, w); r.own = x >= -15 && x <= 180 ? 0 : x; }
    }
    else if (form === 'd') r = { o: '', d: m[1], kind };
    else if (form === 'atis') r = { o: '', d: m[1], kind };
    else if (form === 'atis-b9') { if (label !== 'B9') continue; r = { o: '', d: m[1], kind }; }
    // (1.3.8) the forms by name: o, d - and where they say them, its time (hm, or hh and mm), its departure time (std),
    // what it is (typ: the ARINC 620 and KLM forms)
    else if (form === 'g') {
      const g = m.groups || {}, k = kind || (kinds && g.typ ? kinds[g.typ] : '');
      if (!k || (lab && !lab.test(label || ''))) continue;
      r = { o: g.o, d: g.d, kind: k }; if (g.std) r.std = g.std;
      const hm = g.hm || (g.hh && g.mm ? g.hh + g.mm : ''); if (hm && t > 0) r.own = minsFrom(t, hm);
    }
    if (!r || r.o === r.d || (r.o && !ok(r.o)) || !ok(r.d)) continue;
    // (1.3.8: an out / off report giving the on or in time as well - a flight already landed: a report of that flight, never
    // a plan for the next)
    if (r.kind === 'oooi' && LANDED.test(s)) r.kind = 'rpt';
    return r;
  }
  return null;
}

// ---- (1.3.1) VDL2's own link frames: where the aircraft's data radio says it is going ---------------------------------
// Not a message at all: each time an aircraft's VDL2 radio logs on to a ground station or is handed to the next (an XID
// frame), it gives its 24-bit address, its position, and its destination airport - what its avionics hold for the flight.
// adsb.lol's VDL2 files carry them. On 10 Nov 2026: 99,257 such frames with an airport, from 9,730 aircraft - 626 of them
// LADD (263 had a route from a message; 420 of the 626 had none at all). Checked against the route the same flight's
// messages named: 13,367 the same, 3 another airport (one aircraft, bound where the frame said), and 326 naming the
// airport the flight had just left - the destination of the flight before, not yet replaced. So: never taken for the
// airport a flight took off from (the route code's rule for any message naming only where it is going), and by flight
// 2,394 right to 1.
// A line of the VDL2 feed -> { hex, t, d, at? } or null: from an aircraft in the air, a real airport code
function xidOf(j, isAirport) {
  const a = j && j.vdl2 && j.vdl2.avlc, x = a && a.xid, src = a && a.src;
  if (!x || !src || src.type !== 'Aircraft' || src.status !== 'Airborne' || !Array.isArray(x.vdl_params)) return null;
  const hex = String(src.addr || '').toUpperCase(); if (!/^[0-9A-F]{6}$/.test(hex)) return null;
  let d = '', at = null;
  for (const p of x.vdl_params) {
    if (!p) continue;
    if (p.name === 'dst_airport' && typeof p.value === 'string') d = p.value.toUpperCase();
    else if (p.name === 'ac_location' && p.value && p.value.loc && isFinite(p.value.loc.lat) && isFinite(p.value.loc.lon)) at = [+p.value.loc.lat, +p.value.loc.lon];
  }
  if (!/^[A-Z]{4}$/.test(d) || (isAirport && !isAirport(d))) return null;      // ("....", "LGA.": no airport given)
  const t = +(j.vdl2.t && j.vdl2.t.sec) || 0; if (!(t > 0)) return null;
  return { hex, t, d, at };
}

// ---- (1.3.8) the air traffic services' own datalink: where the aircraft's avionics say it is flying from and to ------------
// Two kinds of message carry both airports as fields, decoded in the feeds' own JSON:
//   - an ATN logon (VDL2 in Europe: every aircraft signing on to a control centre's datalink - its context management
//     logon request - gives its flight's departure and destination airports): dumpvdl2's "departure_airport" and
//     "destination_airport"; a CPDLC route clearance (ATN) the same
//   - a FANS CPDLC message (over ACARS, VDL2, HFDL and satcom: the oceans, the US): a route clearance's "airport_dep" and
//     "airport_dst", decoded by libacars
// A line of a feed -> { reg?, hex?, t, o, d } or null: the aircraft by its registration where the message carries one,
// else by its 24-bit address (the VDL2 link's aircraft end)
const ATN_KEYS = [['departure_airport', 'destination_airport'], ['airport_dep', 'airport_dst']];
function atnOf(j, isAirport) {
  if (!j || typeof j !== 'object') return null;
  let o = '', d = '', n = 0;
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 24 || n++ > 4000 || (o && d)) return;
    if (!Array.isArray(v)) for (const [ko, kd] of ATN_KEYS) {
      if (typeof v[kd] === 'string' && /^[A-Z]{4}$/.test(v[kd].trim().toUpperCase())) { d = v[kd].trim().toUpperCase(); if (typeof v[ko] === 'string' && /^[A-Z]{4}$/.test(v[ko].trim().toUpperCase())) o = v[ko].trim().toUpperCase(); }
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) if (x && typeof x === 'object') walk(x, depth + 1);
  };
  walk(j, 0);
  if (!d || o === d || (isAirport && (!isAirport(d) || (o && !isAirport(o))))) return null;
  let t = 0, hex = '', reg = '';
  const vd = j.vdl2, hf = j.hfdl;
  if (vd) {
    t = +(vd.t && vd.t.sec) || 0;
    const a = vd.avlc || {}, ac = a.src && a.src.type === 'Aircraft' ? a.src : a.dst && a.dst.type === 'Aircraft' ? a.dst : null;
    if (ac && /^[0-9A-F]{6}$/i.test(String(ac.addr || ''))) hex = String(ac.addr).toUpperCase();
    reg = String(a.acars && a.acars.reg || '');
  } else if (hf) { t = +(hf.t && hf.t.sec) || 0; const l = hf.lpdu || {}; reg = String(l.hfnpdu && l.hfnpdu.acars && l.hfnpdu.acars.reg || ''); }
  else { t = +j.timestamp || 0; reg = String(j.tail || ''); }
  reg = reg.replace(/^[.\s]+/, '').trim().toUpperCase(); if (!/^[A-Z0-9-]{2,10}$/.test(reg)) reg = '';
  if (!(t > 0) || (!reg && !hex)) return null;
  return { reg, hex, t, o, d };
}

// ---- the store: per registration, its routes of the last 36 hours, newest last ---------------------------------------
const HAS_TEXT = /"(?:msg_)?text"\s*:\s*"[^"]/;
function createDatalink(env) {
  const byHex = new Map();   // (1.3.1) 24-bit address -> the destinations its data radio gave, the same form
  const byReg = new Map(), stats = { files: 0, lines: 0, routes: 0, kept: 0, lastFile: '', lastAt: 0, err: '', errAt: 0 };
  const KEEP = 36 * 3600;
  function add(m, r) {
    // (1.3.1: a message whose own time of day is not the time it was heard at - one replayed hours later: not kept. A
    // clearance or report says its time to the minute; half an hour either way is allowed)
    if (typeof r.own === 'number' && Math.abs(r.own) > 30) { stats.stale = (stats.stale || 0) + 1; return; }
    const tab = m.hex ? byHex : byReg, key = m.hex || m.reg;
    let l = tab.get(key); if (!l) tab.set(key, l = []);
    // (1.3.8: the route a callsign database gives - put again every quarter of a minute while the flight lasts: kept apart
    // from what the aircraft's own messages say - never merged with one of them, nor one of them with it (its time is
    // now, theirs may be an hour old) - and brought up to date where it is in the list, not added again: a callsign
    // with a stop has two legs, one after the other)
    if (r.kind === 'csdb') {
      const e = l.find(x => x.kinds[0] === 'csdb' && x.o === r.o && x.d === r.d && m.t - x.t < 6 * 3600);
      if (e) { if (m.t > e.t) { e.t = Math.round(m.t); l.sort((a, b) => a.t - b.t); } return; }
    }
    const last = l.filter(x => (x.kinds[0] === 'csdb') === (r.kind === 'csdb')).pop();
    // (the same route sent again - a position report every few minutes: its time moved on, once. 1.3.1: one naming only
    // where it is going is the same route as the one before to there; the origin kept, or learned, either way)
    if (last && last.d === r.d && (last.o === r.o || !last.o || !r.o) && m.t - last.t < 6 * 3600 && (last.kinds[0] === 'atis') === (r.kind === 'atis')) {
      if (!last.o && r.o) last.o = r.o;
      if (m.t > last.t) { last.t = Math.round(m.t); if (!last.kinds.includes(r.kind)) last.kinds.push(r.kind); if (r.at) last.at = [Math.round(r.at[0] * 1000) / 1000, Math.round(r.at[1] * 1000) / 1000]; else delete last.at; if (r.eta) last.eta = r.eta; l.sort((a, b) => a.t - b.t); }
      return;
    }
    const e = { o: r.o, d: r.d, t: Math.round(m.t), first: Math.round(m.t), kinds: [r.kind] }; if (r.std) e.std = r.std; if (m.flight) e.cs = m.flight;
    if (r.at) e.at = [Math.round(r.at[0] * 1000) / 1000, Math.round(r.at[1] * 1000) / 1000]; if (r.eta) e.eta = r.eta;
    l.push(e); l.sort((a, b) => a.t - b.t); if (l.length > 12) l.splice(0, l.length - 12);
    stats.kept++;
  }
  // (1.3.1) one message from another source (Airframes: { reg, t, label, text, flight }), read as a file's lines are.
  // -> 1: a route new or brought up to date; 0: nothing in it (or nothing new); -1: it says its own time of day and that
  // is not the time given for it - an old message sent in as new (never kept). sure: one that says no time is left too
  function take(m, nowS, sure) {
    if (!m || !m.reg || !(m.t > 0) || m.t < nowS - KEEP || m.t > nowS + 900) return 0;
    const r = routeOf(m.text, env.isAirport, m.label, m.t); if (!r) return 0;
    const timed = typeof r.own === 'number';
    if (timed && Math.abs(r.own) > 30) { stats.stale = (stats.stale || 0) + 1; return -1; }
    if (sure && !timed) return 0;
    const n0 = stats.kept, l0 = byReg.get(m.reg), t0 = l0 && l0.length ? l0[l0.length - 1].t : 0;
    stats.routes++; stats.taken = (stats.taken || 0) + 1; add(m, r);
    const l1 = byReg.get(m.reg); return stats.kept > n0 || (!!l1 && l1.length > 0 && l1[l1.length - 1].t > t0) ? 1 : 0;
  }
  // one line of a file -> 1 where it held a route
  function line1(line, nowS) {
    if (!line) return 0; stats.lines++;
    // (1.3.1: a VDL2 link frame naming the aircraft's destination)
    if (line.indexOf('"dst_airport"') >= 0) {
      let jx; try { jx = JSON.parse(line); } catch (e) { return 0; }
      const x = xidOf(jx, env.isAirport); if (!x || x.t < nowS - KEEP) return 0;
      const rx = { o: '', d: x.d, kind: 'xid' }; if (x.at) rx.at = x.at;
      stats.xid = (stats.xid || 0) + 1; add({ hex: x.hex, t: x.t }, rx); return 1;
    }
    // (1.3.8: an ATN logon or route clearance, a FANS CPDLC route clearance - both airports as the avionics have them)
    if (line.indexOf('"destination_airport"') >= 0 || line.indexOf('"airport_dst"') >= 0) {
      let ja; try { ja = JSON.parse(line); } catch (e) { return 0; }
      const a = atnOf(ja, env.isAirport);
      if (a && a.t >= nowS - KEEP) { stats.atn = (stats.atn || 0) + 1; add({ reg: a.reg, hex: a.reg ? '' : a.hex, t: a.t }, { o: a.o, d: a.d, kind: 'atn' }); return 1; }
    }
    // (1.3.1: a line with no message text in it is not even parsed: most lines of the VDL2 and HFDL feeds are link
    // traffic with no message at all)
    if (!HAS_TEXT.test(line)) return 0;
    let j; try { j = JSON.parse(line); } catch (e) { return 0; }
    const m = msgOf(j); if (!m || !m.t || m.t < nowS - KEEP) return 0;
    const r = routeOf(m.text, env.isAirport, m.label, m.t); if (!r) return 0;
    stats.routes++; add(m, r); return 1;
  }
  // one file's lines (JSON lines: any of the three feeds)
  function ingest(text, nowS) {
    let n = 0;
    for (const line of String(text).split('\n')) n += line1(line, nowS);
    return n;
  }
  // (1.3.1) the same, a slice at a time - an hour's file is tens of thousands of lines, half a second and more of reading
  // in one go, every request waiting meanwhile: 12 ms at a time, the server answering in between
  async function ingestSlow(text, nowS) {
    const s = String(text); let n = 0, i = 0, t = Date.now();
    while (i < s.length) {
      let e = s.indexOf('\n', i); if (e < 0) e = s.length;
      if (e > i) n += line1(s.slice(i, e), nowS);
      i = e + 1;
      if (Date.now() - t >= 12) { await new Promise(r => setImmediate(r)); t = Date.now(); }
    }
    return n;
  }
  function prune(nowS) { for (const tab of [byReg, byHex]) for (const [k, l] of tab) { const f = l.filter(e => e.t >= nowS - KEEP); if (f.length) tab.set(k, f); else tab.delete(k); } }
  // (1.3.1) everything known of one aircraft: the routes of its registration's messages and what its data radio gave by its
  // 24-bit address, in time order (null: nothing)
  function of(reg, hex) {
    const a = reg ? byReg.get(String(reg).toUpperCase()) : null, b = hex ? byHex.get(String(hex).replace(/^~/, '').toUpperCase()) : null;
    if (!a || !a.length) return b && b.length ? b : null;
    if (!b || !b.length) return a;
    return a.concat(b).sort((x, y) => x.t - y.t);
  }
  // (what is known of these registrations: [{ reg, routes: [{ o, d, t, first, kinds, std?, cs? }] }])
  function get(regs) { return regs.map(r => String(r || '').toUpperCase()).filter(r => byReg.has(r)).map(reg => ({ reg, routes: byReg.get(reg) })); }
  // (1.3.8) a route from elsewhere - the one usually flown under the flight's callsign (csroute.cjs): kept as a message's
  // is, both airports real ones -> true when it is new
  function put(m, r) {
    if (!m || !(m.t > 0) || (!m.reg && !m.hex) || !r || !r.d || r.o === r.d || (env.isAirport && (!env.isAirport(r.d) || (r.o && !env.isAirport(r.o))))) return false;
    const n0 = stats.kept; add(m, r); return stats.kept > n0;
  }
  return { ingest, ingestSlow, take, put, prune, get, of, stats, byReg, byHex };
}

// ---- reading the open data as it is published --------------------------------------------------------------------------
const repoOf = day => `adsblol/aircraft-data-links-${day.slice(0, 4)}`, tagOf = day => `adsblol-adl-${day}`;
const UA = { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)', Accept: 'application/vnd.github+json' };
// (zstd: Node's own from 22.15/23.8; else the small decoder kept with the monitor - Node 18 has none)
let zstdFn = null;
function zstd(buf) {
  if (!zstdFn) zstdFn = typeof zlib.zstdDecompressSync === 'function' ? b => zlib.zstdDecompressSync(b) : (() => { const f = require('./vendor/fzstd.cjs'); return b => Buffer.from(f.decompress(new Uint8Array(b))); })();
  return zstdFn(buf);
}
// The day's files not read yet: GitHub's API lists a release's files (60 requests an hour without a key: two every ten
// minutes are asked)
async function newFiles(day, seen, get) {
  const j = await get(`https://api.github.com/repos/${repoOf(day)}/releases/tags/${tagOf(day)}`);
  if (!j || !Array.isArray(j.assets)) return [];
  return j.assets.filter(a => /^adsblol-adl-(acars|vdl2|hfdl)_\d{8}-\d{6}_\d{8}-\d{6}\.jsonl\.zst$/.test(a.name) && !seen.has(a.name)).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size }));
}
const netJson = async url => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const netBuf = async url => { const r = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'] }, redirect: 'follow', signal: AbortSignal.timeout(120000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); };

module.exports = { xidOf, atnOf, msgOf, routeOf, PATTERNS, MORE, posIn, minsFrom, createDatalink, newFiles, zstd, netJson, netBuf, repoOf, tagOf };
