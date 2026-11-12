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
  ['filed', /FPL# ?[A-Z0-9]+ ([A-Z]{4})-([A-Z]{4}) FOR [A-Z0-9-]+ HAS BEEN FILED(?: FOR A (\d{4})Z DEPARTURE)?/],
  // satcom flight-plan alerts: "YOUR FLIGHT PLAN E5520 KDJT-KUGN HAS BEEN EVALUATED"
  ['alert', /YOUR FLIGHT PLAN [A-Z0-9]+ ([A-Z]{4})-([A-Z]{4}) /],
  // pre-departure clearance: "PDC EJA678)\r\nKDJT-KJWN)" - the departure and destination line after it
  ['pdc', /\bPDC\b[\s\S]{0,40}?\b([A-Z]{4})-([A-Z]{4})\b/],
  // estimated time of arrival report: "ETA221759,KMEM,KBRO,"
  ['eta', /^ETA\d{6},([A-Z]{4}),([A-Z]{4}),/],
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
const MORE = [
  // reports with a position, then where from and where to (ETA, TOC, TOD, TWX, ATI, MSG ...: "00ETA03,N31148W082322,390,KAPF,KLZU,1110,1655,1740,004.1")
  ['rpt', new RegExp('(?:^|[^A-Z])(?!POS|SPN)[A-Z]{2,4}0\\d,(' + POSF + '),[^,]*,([A-Z]{4}),([A-Z]{4}),(?:(\\d{4}),(\\d{4}),)?'), 'od-pos'],
  // out of the gate, off, on, in: "OFF02,N28261W081196,KMCO,KGGG,1110,1625,1819,014.0"
  ['oooi', new RegExp('(?:^|[^A-Z])(?:OUT|OFF|ON|IN)0\\d,(' + POSF + '),([A-Z]{4}),([A-Z]{4}),(?:(\\d{4}),(\\d{4}),)?'), 'od-pos'],
  // the flight-planning service's notice (NetJets' GDFS): "FLIGHT PLAN #E5106,\r\nKAUS-KPHX IS NOW\r\nAVAILABLE FOR RECALL"
  ['fpl', /FLIGHT PLAN #?[A-Z0-9]+,?\s+([A-Z]{4})-([A-Z]{4}) IS NOW\s+AVAILABLE/, 'od'],
  // "PDC AVAILABLE FOR:\r\nKAUS - KMKE\r\nETD: 2000Z"
  ['pdc', /PDC AVAILABLE FOR:\s*([A-Z]{4}) - ([A-Z]{4})\s+ETD: ?(\d{4})Z/, 'od-std'],
  // "MSG/RX10-NOV-26 1715Z PDC N914MC/RXKLIT-KSOP/RX-ATC CLEARANCE-"
  ['pdc', /\bPDC [A-Z0-9-]+\/RX([A-Z]{4})-([A-Z]{4})\/RX/, 'od'],
  // departure clearance by datalink (Europe, Canada ...): "/BHXDCXA.DC1/CLD 0556 261110 EGBB PDC 033\r\nRYR97XJ CLRD TO GCRR OFF 15"
  ['dcl', /\.DC1\/C[LD][DA] (\d{4}) (\d{6}) ([A-Z]{4})\s+PDC \d+\s+\S+ CLRD TO ([A-Z]{4})\b/, 'od-clr'],
  // Australia: "PDC 100120 JST565 A320 YBBN 0205 CLEARED TO YMML VIA"
  ['dcl', /\bPDC(?: UPLINK)? (?:\d{6} )?[A-Z0-9]{2,8} [A-Z0-9]{2,4} ([A-Z]{4}) \d{4}\s+CLEARED TO ([A-Z]{4}) VIA/, 'od'],
  // the US clearance sent for reference with a CPDLC one: "AAL2013 KDCA\r\nB738/L P0059 /AN N939NN\r\n673 FL400\r\nCLEARED TO KMIA AIRPORT"
  ['dcl', /\b[A-Z0-9]{2,8} ([A-Z]{4})\s+[A-Z0-9]{2,5}\/[A-Z] P\d{4}[\s\S]{0,60}?CLEARED TO ([A-Z]{4}) AIRPORT/, 'od'],
  // "DA EGNX/DS LEAL/OFF 0627"
  ['rep', /\bDA ([A-Z]{4})\/DS ([A-Z]{4})\b/, 'od'],
  // a position report naming where it is going, when it will be there, the fixes ahead with their times and - on some
  // aircraft - where it came from (NetJets and others, label 10, every ten minutes):
  //   "/N30.336/W098.165/10/0.73/008/230/KDAL/0049/0050/00028/DITSY/CHRLY/0024/FRSTI/0029/KSAT/"
  ['pos', /^\/([NS]\d{2}\.\d{3}\/[EW]\d{3}\.\d{3})\/\d{1,2}\/\d\.\d\d\/\d{3}\/\d{3}\/([A-Z]{4})\/(\d{4})\/[^/]*\/[^/]*\/[^/]*\/[^/]*\/(\d{4}|-{4})\/[^/]*\/(\d{4}|-{4})\/(?:([A-Z]{4})\/)?\s*$/, 'do-pos10'],
  // out of the gate and off (labels QP, QQ - the airlines' form, M-PORT's too): "EGGPEGJB0855", "KDCAKORD00500329"
  ['oooi', /^([A-Z]{4})([A-Z]{4})(\d{4})/, 'od-q'],
  // oceanic clearance: "/PIKCLYA.OC1/CLA 0356 261110 EGGX CLRNCE 898\r\nQQE247 CLRD TO KIAD VIA VENER"
  ['ocl', /\.OC1\/CL[AX] (\d{4}) (\d{6}) [A-Z]{4}\s+CLRNCE \d+\s+\S+ CLRD TO ([A-Z]{4}) VIA/, 'd-clr'],
  // the flight-management system asking for (or sent) the winds for its descent: "/DQ470,KFTW,"
  ['dq', /\/D[QD]\d{3},([A-Z]{4}),/, 'd'],
  // the arrival information (ATIS) sent to it: "/HDQGLXH.TI2/KLAS ARR ATIS M" ...
  ['atis', /\.TI\d\/([A-Z]{4}) ARR ATIS /, 'atis'],
  // ... or asked for by it (label B9: "/KTEB.TI2/024KTEBA3FBD" - A: arrival, C: arrival, kept up to date)
  ['atis', /^\/([A-Z]{4})\.TI\d\/\d{3}\1[AC]/, 'atis-b9']
];
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
  for (const [kind, re, form] of MORE) {
    const m = re.exec(s); if (!m) continue;
    let r = null;
    if (form === 'od') r = { o: m[1], d: m[2], kind };
    else if (form === 'od-std') r = { o: m[1], d: m[2], kind, std: m[3] };
    else if (form === 'od-pos') { r = { o: m[2], d: m[3], kind }; const at = posIn(m[1]); if (at) r.at = at; if (m[5] && t > 0) r.own = minsFrom(t, m[5]); }
    else if (form === 'od-q') { if (label !== 'QP' && label !== 'QQ') continue; r = { o: m[1], d: m[2], kind }; if (t > 0) r.own = minsFrom(t, m[3]); }
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
    if (!r || r.o === r.d || (r.o && !ok(r.o)) || !ok(r.d)) continue;
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
    const last = l[l.length - 1];
    // (the same route sent again - a position report every few minutes: its time moved on, once. 1.3.1: one naming only
    // where it is going is the same route as the one before to there; the origin kept, or learned, either way)
    if (last && last.d === r.d && (last.o === r.o || !last.o || !r.o) && m.t - last.t < 6 * 3600 && (last.kinds[0] === 'atis') === (r.kind === 'atis')) {
      if (!last.o && r.o) last.o = r.o;
      if (m.t > last.t) { last.t = Math.round(m.t); if (!last.kinds.includes(r.kind)) last.kinds.push(r.kind); if (r.at) last.at = [Math.round(r.at[0] * 1000) / 1000, Math.round(r.at[1] * 1000) / 1000]; else delete last.at; if (r.eta) last.eta = r.eta; }
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
  return { ingest, ingestSlow, take, prune, get, of, stats, byReg, byHex };
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

module.exports = { xidOf, msgOf, routeOf, PATTERNS, MORE, posIn, minsFrom, createDatalink, newFiles, zstd, netJson, netBuf, repoOf, tagOf };
