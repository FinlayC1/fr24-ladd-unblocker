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
function routeOf(text, isAirport) {
  const s = String(text || '').toUpperCase();
  for (const [kind, re] of PATTERNS) {
    const m = re.exec(s); if (!m) continue;
    const o = m[1], d = m[2];
    if (o === d || (isAirport && (!isAirport(o) || !isAirport(d)))) continue;
    const r = { o, d, kind }; if (kind === 'filed' && m[3]) r.std = m[3];
    return r;
  }
  return null;
}

// ---- the store: per registration, its routes of the last 36 hours, newest last ---------------------------------------
function createDatalink(env) {
  const byReg = new Map(), stats = { files: 0, lines: 0, routes: 0, kept: 0, lastFile: '', lastAt: 0, err: '', errAt: 0 };
  const KEEP = 36 * 3600;
  function add(m, r) {
    let l = byReg.get(m.reg); if (!l) byReg.set(m.reg, l = []);
    const last = l[l.length - 1];
    // (the same route sent again - a position report every few minutes: its time moved on, once)
    if (last && last.o === r.o && last.d === r.d && m.t - last.t < 6 * 3600) { if (m.t > last.t) { last.t = m.t; if (!last.kinds.includes(r.kind)) last.kinds.push(r.kind); } return; }
    const e = { o: r.o, d: r.d, t: Math.round(m.t), first: Math.round(m.t), kinds: [r.kind] }; if (r.std) e.std = r.std; if (m.flight) e.cs = m.flight;
    l.push(e); l.sort((a, b) => a.t - b.t); if (l.length > 8) l.splice(0, l.length - 8);
    stats.kept++;
  }
  // one file's lines (JSON lines: any of the three feeds)
  function ingest(text, nowS) {
    let n = 0;
    for (const line of String(text).split('\n')) {
      if (!line) continue; stats.lines++;
      let j; try { j = JSON.parse(line); } catch (e) { continue; }
      const m = msgOf(j); if (!m || !m.t || m.t < nowS - KEEP) continue;
      const r = routeOf(m.text, env.isAirport); if (!r) continue;
      stats.routes++; n++; add(m, r);
    }
    return n;
  }
  function prune(nowS) { for (const [k, l] of byReg) { const f = l.filter(e => e.t >= nowS - KEEP); if (f.length) byReg.set(k, f); else byReg.delete(k); } }
  // (what is known of these registrations: [{ reg, routes: [{ o, d, t, first, kinds, std?, cs? }] }])
  function get(regs) { return regs.map(r => String(r || '').toUpperCase()).filter(r => byReg.has(r)).map(reg => ({ reg, routes: byReg.get(reg) })); }
  return { ingest, prune, get, stats, byReg };
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

module.exports = { msgOf, routeOf, PATTERNS, createDatalink, newFiles, zstd, netJson, netBuf, repoOf, tagOf };
