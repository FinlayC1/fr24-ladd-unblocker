// Build years by serial number, for the AGE FR24 padlocks: every turbine aircraft and helicopter the FAA register has
// ever held (MASTER - on it now - and DEREG - gone abroad or retired: a European business jet was often N-registered
// once), keyed by ICAO type and serial number. An airframe found there gets its year exactly; one that is not is dated
// from the serials either side of it (manufacturers number their airframes in sequence) - only where they agree.
// FAA model codes are mapped to ICAO types through tar1090-db (transponder address -> type).
// usage: node test/mkagetable.cjs <dir with MASTER.txt, DEREG.txt, ACFTREF.txt, tar1090.csv.gz> <out.json> [--eval]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const [dir, outFile, evalFlag] = process.argv.slice(2);
const csv = l => l.split(',').map(s => s.trim());
const lines = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/);
// tar1090-db: hex -> ICAO type
const typeOfHex = new Map();
for (const l of zlib.gunzipSync(fs.readFileSync(path.join(dir, 'tar1090.csv.gz'))).toString('utf8').split('\n')) { const p = l.split(';'); if (p[0] && p[2]) typeOfHex.set(p[0].toUpperCase(), p[2].toUpperCase()); }
// ACFTREF: model code -> aircraft / engine kind (keep turbine engines and helicopters)
const ref = new Map(); { const L = lines('ACFTREF.txt'), h = csv(L[0]); const iC = h.indexOf('CODE'), iA = h.indexOf('TYPE-ACFT'), iE = h.indexOf('TYPE-ENG');
  for (const l of L.slice(1)) { const p = csv(l); if (p[iC]) ref.set(p[iC], { acft: p[iA], eng: p[iE] }); } }
const wanted = code => { const r = ref.get(code); return !!r && (['2', '3', '4', '5'].includes(r.eng) || r.acft === '6'); };
const normSerial = s => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
// MASTER: hex -> type gives the model code -> type map (majority vote); rows collected
const vote = new Map(), rows = [];
{ const L = lines('MASTER.txt'), h = csv(L[0]); const iS = h.indexOf('SERIAL NUMBER'), iM = h.indexOf('MFR MDL CODE'), iY = h.indexOf('YEAR MFR'), iX = h.indexOf('MODE S CODE HEX');
  for (const l of L.slice(1)) { const p = csv(l); if (!p[iM]) continue; const hex = (p[iX] || '').toUpperCase(), t = typeOfHex.get(hex);
    if (t) { const v = vote.get(p[iM]) || new Map(); v.set(t, (v.get(t) || 0) + 1); vote.set(p[iM], v); }
    rows.push({ code: p[iM], serial: normSerial(p[iS]), year: +p[iY] || 0, type: t || '', src: 'M' }); } }
{ const L = lines('DEREG.txt'), h = csv(L[0]); const iS = h.indexOf('SERIAL-NUMBER'), iM = h.indexOf('MFR-MDL-CODE'), iY = h.indexOf('YEAR-MFR'), iX = h.indexOf('MODE S CODE HEX');
  for (const l of L.slice(1)) { const p = csv(l); if (!p[iM]) continue; rows.push({ code: p[iM], serial: normSerial(p[iS]), year: +p[iY] || 0, type: typeOfHex.get((p[iX] || '').toUpperCase()) || '', src: 'D' }); } }
const codeType = new Map(); for (const [c, v] of vote) { let best = '', n = 0, all = 0; for (const [t, k] of v) { all += k; if (k > n) { n = k; best = t; } } if (n >= 2 && n / all >= 0.7) codeType.set(c, best); }
// (type, serial) -> year; conflicting years for one airframe: the earliest
const table = new Map();
let kept = 0;
for (const r of rows) {
  if (!wanted(r.code) || !r.serial || r.year < 1940 || r.year > 2027) continue;
  const t = codeType.get(r.code) || r.type; if (!t || !/^[A-Z0-9]{2,4}$/.test(t)) continue;
  const m = table.get(t) || new Map(); const y0 = m.get(r.serial); if (!y0 || r.year < y0) m.set(r.serial, r.year); table.set(t, m); kept++;
}
// serial -> (pattern, number): "525B-0123" -> ["525B-#", 123], "5432" -> ["#", 5432], "RK-12" -> ["RK-#", 12]
const keyOf = s => { const m = s.match(/^(.*?)(\d+)([A-Z]?)$/); return m ? [m[1] + '#' + m[3], +m[2]] : null; };
// dating an airframe that is not in the table: the nearest serials either side, of the same pattern
function dateOf(list, serial) {
  const k = keyOf(serial); if (!k) return null;
  let lo = null, hi = null;
  for (const [s, y] of list) { const q = keyOf(s); if (!q || q[0] !== k[0] || s === serial) continue; if (q[1] <= k[1] && (!lo || q[1] > lo[0])) lo = [q[1], y]; if (q[1] >= k[1] && (!hi || q[1] < hi[0])) hi = [q[1], y]; }
  if (!lo || !hi) return null;
  const span = hi[0] - lo[0];
  if (Math.abs(hi[1] - lo[1]) > 1 || span > Math.max(30, k[1] * 0.04)) return null;      // far apart, or straddling years
  return { year: Math.round(lo[1] + (hi[1] - lo[1]) * (span ? (k[1] - lo[0]) / span : 0)), sure: lo[1] === hi[1] };
}
if (evalFlag) {
  // leave one out, over turbine types: how often the neighbours' year is the airframe's own
  let n = 0, ans = 0, exact = 0, within1 = 0, sureN = 0, sureExact = 0;
  for (const [t, m] of table) { const list = [...m]; if (list.length < 5) continue; for (let i = 0; i < list.length; i += 7) { const [s, y] = list[i]; n++; const d = dateOf(list, s); if (!d) continue; ans++; if (d.year === y) exact++; if (Math.abs(d.year - y) <= 1) within1++; if (d.sure) { sureN++; if (d.year === y) sureExact++; } } }
  console.log(`leave-one-out: ${n} airframes, dated ${ans} (${(100 * ans / n).toFixed(1)}%): exact ${(100 * exact / ans).toFixed(1)}%, within a year ${(100 * within1 / ans).toFixed(1)}%; neighbours agreeing ${sureN}: exact ${(100 * sureExact / sureN).toFixed(1)}%`);
}
// compact: { type: "serial:yy,serial:yy,..." } (yy = year - 1900), sorted by serial
const out = {}; let entries = 0;
for (const [t, m] of [...table].sort()) { if (!m.size) continue; out[t] = [...m].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([s, y]) => s + ':' + (y - 1900)).join(','); entries += m.size; }
const json = JSON.stringify(out);
fs.writeFileSync(outFile, json);
console.log(`rows ${rows.length}, kept ${kept}, types ${Object.keys(out).length}, airframes ${entries}, ${Math.round(json.length / 1024)} KB, gz ${Math.round(zlib.gzipSync(json).length / 1024)} KB`);
for (const [t, s] of [['GLF5', ''], ['B744', '33732'], ['GLF6', '']]) if (out[t]) console.log(t, out[t].split(',').length, 'airframes;', s ? 'serial ' + s + ' -> ' + (table.get(t).get(s) || JSON.stringify(dateOf([...table.get(t)], s))) : '');
