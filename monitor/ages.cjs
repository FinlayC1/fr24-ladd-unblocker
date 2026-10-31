'use strict';
// (1.2.1) Every aircraft's age, worked out here for every browser - FR24 padlocks it, and its own record sent to a
// visitor without a subscription leaves the date out. The build year, best first:
//   1. a register's year (the aircraft database: FAA, Transport Canada, OpenSky, ADS-B Exchange, tar1090-db)
//   2. the airframe's own entry in the age table (src/agetable.json: the FAA register current and deregistered, and
//      OpenSky's dated airframes - by ICAO type and serial number) and every dated airframe of the aircraft database
//   3. the serial numbers either side of it, where they agree to a year (manufacturers number in sequence)
//   4. the six nearest serials within 300 numbers agreeing to two years; then the eight nearest within 2,000 agreeing
//      to four (Boeing gives its numbers to customers in blocks). Checked leave-one-out: Boeing 76% dated, 95.5% within a
//      year, then 11.6% more, 85.5% within two; Airbus 96%, 99.3%; Embraer 93%, 99.2%; Bombardier 95%, 99.0%
//   5. its operator's fleet of the type: the middle year of the others (70% within two years, 89% within five)
//   6. the type's own middle year - an aircraft known by its type alone
// 3 to 6 are estimates: "~" and how it was dated go with them.
const fs = require('fs');

const FAMILIES = [['A318', 'A319', 'A320', 'A321', 'A19N', 'A20N', 'A21N'], ['A332', 'A333', 'A338', 'A339', 'A342', 'A343', 'A345', 'A346'], ['E170', 'E75L', 'E75S', 'E190', 'E195', 'E290', 'E295']];
const familyOf = t => FAMILIES.find(f => f.includes(t)) || null;
const isType = t => /^[A-Z][A-Z0-9]{1,3}$/.test(t);
const normSerial = s => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
const serialKey = s => { const m = s.match(/^(.*?)(\d+)([A-Z]?)$/); return m ? [m[1] + '#' + m[3], +m[2]] : null; };
const normOp = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\b(LTD|LIMITED|INC|LLC|PLC|SA|AG|GMBH|SPA|AB|AS|BV|NV|CO|CORP|CORPORATION|COMPANY|AIRLINES?|AIRWAYS|AVIATION)\b/g, '').replace(/\s+/g, ' ').trim();
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

function createAges(env) {
  env = env || {};
  const cy = () => new Date(env.now ? env.now() : Date.now()).getUTCFullYear();
  // type -> Map(serial -> year); type -> pattern -> [{ n, y }] sorted (rebuilt when added to)
  const byType = new Map(), sorted = new Map(), fleets = new Map(), typeYears = new Map();
  const stats = { airframes: 0, fleets: 0, asked: 0, answered: 0, how: {} };
  function add(type, msn, year) {
    const t = String(type || '').toUpperCase(), sn = normSerial(msn), y = +year;
    if (!isType(t) || !sn || !(y >= 1930 && y <= cy() + 1)) return false;
    let m = byType.get(t); if (!m) { m = new Map(); byType.set(t, m); }
    const y0 = m.get(sn); if (y0 && y0 <= y) return false;
    if (!y0) stats.airframes++;
    m.set(sn, y); sorted.delete(t); for (const f of FAMILIES) if (f.includes(t)) for (const x of f) sorted.delete(x);
    typeYears.delete(t);
    return true;
  }
  function addFleet(op, type, year) {
    const o = normOp(op), t = String(type || '').toUpperCase(), y = +year;
    if (!o || !isType(t) || !(y >= 1930 && y <= cy() + 1)) return;
    const k = o + '|' + t; let a = fleets.get(k); if (!a) { a = []; fleets.set(k, a); stats.fleets = fleets.size; } if (a.length < 400) a.push(y);
  }
  // the table as packed for the build: { type: "serial:yy,serial:yy" } (yy: years after 1900)
  function loadTable(obj) {
    let n = 0;
    for (const t of Object.keys(obj || {})) for (const x of String(obj[t]).split(',')) { const i = x.lastIndexOf(':'); if (i > 0 && add(t, x.slice(0, i), 1900 + Number(x.slice(i + 1)))) n++; }
    return n;
  }
  if (env.file) { try { loadTable(JSON.parse(fs.readFileSync(env.file, 'utf8'))); } catch (e) { if (env.log) env.log('age table not read: ' + (e && e.message)); } }

  // the serials of a type (its family's together), by pattern, in order
  function listOf(t) {
    if (sorted.has(t)) return sorted.get(t);
    const out = new Map();
    for (const x of familyOf(t) || [t]) { const m = byType.get(x); if (!m) continue; for (const [sn, y] of m) { const k = serialKey(sn); if (!k) continue; let a = out.get(k[0]); if (!a) { a = []; out.set(k[0], a); } a.push({ n: k[1], y }); } }
    for (const a of out.values()) a.sort((p, q) => p.n - q.n);
    sorted.set(t, out); return out;
  }
  function typeMiddle(t) {
    if (typeYears.has(t)) return typeYears.get(t);
    const m = byType.get(t), y = m && m.size >= 5 ? median([...m.values()]) : 0;
    typeYears.set(t, y); return y;
  }
  // (k nearest in a sorted list, within W numbers)
  function nearest(a, n, k, W) {
    let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].n < n) lo = mid + 1; else hi = mid; }
    const out = []; let i = lo - 1, j = lo;
    while (out.length < k && (i >= 0 || j < a.length)) {
      const di = i >= 0 ? n - a[i].n : Infinity, dj = j < a.length ? a[j].n - n : Infinity, d = Math.min(di, dj);
      if (d > W) break; if (di <= dj) out.push(a[i--]); else out.push(a[j++]);
    }
    return out;
  }
  const res = (year, est, how) => { stats.answered++; stats.how[how] = (stats.how[how] || 0) + 1; return { year, est, how }; };
  // { year, est, how } - or null: nothing at all known of it
  function of(q) {
    stats.asked++;
    const t = String(q.type || '').toUpperCase(), sn = normSerial(q.msn), reg = +q.year;
    if (reg >= 1930 && reg <= cy() + 1) return res(reg, false, 'the register');
    if (isType(t) && sn) {
      const own = (byType.get(t) || new Map()).get(sn) || ((familyOf(t) || []).map(x => (byType.get(x) || new Map()).get(sn)).find(Boolean));
      if (own) return res(own, false, 'its own record');
      const k = serialKey(sn), a = k ? listOf(t).get(k[0]) : null;
      if (a && a.length) {
        // (the serials either side)
        let l2 = 0, h2 = a.length; while (l2 < h2) { const mid = (l2 + h2) >> 1; if (a[mid].n < k[1]) l2 = mid + 1; else h2 = mid; }
        const L = a[l2 - 1] || null, Hh = a[l2] || null;
        if (L && Hh) { const span = Hh.n - L.n; if (Math.abs(Hh.y - L.y) <= 1 && span <= Math.max(30, k[1] * 0.04)) return res(Math.round(L.y + (Hh.y - L.y) * (span ? (k[1] - L.n) / span : 0)), L.y !== Hh.y, 'its serial number'); }
        const a320 = familyOf(t) === FAMILIES[0];
        const n1 = nearest(a, k[1], 6, a320 ? 3000 : 300).map(x => x.y).sort((p, q2) => p - q2);
        if (n1.length >= 3 && n1[n1.length - 1] - n1[0] <= (a320 ? 3 : 2)) return res(n1[n1.length >> 1], true, 'its serial number');
        const n2 = nearest(a, k[1], 8, 2000).map(x => x.y).sort((p, q2) => p - q2);
        if (n2.length >= 3 && n2[n2.length - 1] - n2[0] <= 4) return res(n2[n2.length >> 1], true, 'serial numbers near its own');
      }
    }
    if (isType(t) && q.op) { const f = fleets.get(normOp(q.op) + '|' + t); if (f && f.length >= 3) return res(median(f), true, 'its operator\'s fleet'); }
    if (isType(t)) { const y = typeMiddle(t); if (y) return res(y, true, 'its type'); }
    return null;
  }
  // (after the aircraft database is read: its airframes dated by a register added, and every operator's fleet years)
  function learn(rec) {
    if (!rec || !rec.type) return;
    if (rec.year && rec.msn) add(rec.type, rec.msn, rec.year);
    const y = rec.year || (rec.msn ? ((byType.get(String(rec.type).toUpperCase()) || new Map()).get(normSerial(rec.msn)) || 0) : 0);
    if (y && rec.op) addFleet(rec.op, rec.type, y);
  }
  function status() { return { airframes: stats.airframes, types: byType.size, fleets: fleets.size, asked: stats.asked, answered: stats.answered, how: stats.how }; }
  return { of, add, addFleet, learn, loadTable, status, stats };
}

module.exports = { createAges, normSerial, normOp };
