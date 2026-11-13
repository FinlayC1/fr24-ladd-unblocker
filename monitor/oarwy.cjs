'use strict';
// (1.3.2) Every airport's runways and radio frequencies, from OurAirports (public domain) - not only those of FR24's own
// airports (1.3.1: an OurAirports airport's window said "No runways known" and kept FR24's padlocked picture - RAF
// Woodvale's three runways were never in the file), and as OurAirports has them now, not as they were when the monitor's
// data was last made by hand:
//   - build(): OurAirports' runways.csv and airport-frequencies.csv into what airport.cjs answers with - per airport,
//     every runway [ident, other end's ident, length ft, width ft, surface (FR24's code), surface as the source has it,
//     lit 1/0/-1, closed 1/0, then for each end (this, other): elevation ft, true heading, displaced threshold ft, lat,
//     lon], and [[type, description, MHz]]. An airport is found by OurAirports' own ident and by its ICAO and GPS codes
//     (airports.csv, when given: "US-0009" is also "48ID"); helipads are left out
//   - createOaRunways(): the two files kept in the monitor's store (never in the checkout: a file of the checkout changed
//     stops the next deploy), asked for again every hour - only what changed is sent (ETag) - and never replaced by
//     something that is not that file
// mkdata.cjs makes the checkout's own copies (data/runway_info.json, data/freqs.json) with the same code.
const fs = require('fs'), path = require('path');
const SRC = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/';
// (the surface as FR24's runway tables code it - the userscript's own mapping, src/main/06-boards.js)
const RWY_SURF = [[/^(ASP|ASF|ASPH|ASPHALT|PEM|AS$)/i, 'ASPH'], [/^(BIT|BITU|BITUMINOUS|MAC|MACADAM|SEALED)/i, 'BITU'], [/^(CON|CONC|CONCRETE|CEM)/i, 'CONC'], [/^(TARM|TAR)/i, 'TARM'], [/^(GRS|GRASS|GRE|GRAS)/i, 'GRAS'], [/^(TURF)/i, 'TURF'], [/^(GVL|GRV|GRAV|GRAVEL)/i, 'GRVL'], [/^(DIRT|EARTH|SOIL|DRT)/i, 'DIRT'], [/^(SAND|SND)/i, 'SAND'], [/^(CLA|CLAY)/i, 'CLAY'], [/^(WAT|WATER)/i, 'WATE'], [/^(SNOW)/i, 'SNOW'], [/^(ICE)/i, 'ICE'], [/^(MAT|PSP|PIERCED|ALUM)/i, 'MATS'], [/^(LAT|LATERITE)/i, 'LATE'], [/^(COR|CORAL)/i, 'CORL'], [/^(UNPAVED|UNP)/i, 'UNPV'], [/^(PAVED|PAV|PER|PERM)/i, 'ASPH']];
const surfCode = s => { s = String(s || '').trim(); for (const [re, c] of RWY_SURF) if (re.test(s)) return c; return 'UNKN'; };
const num = (v, d) => { const x = parseFloat(v); return isFinite(x) ? (d ? Math.round(x * 10 ** d) / 10 ** d : Math.round(x)) : null; };

function cells(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
// (a file's rows as objects of the columns asked for, one at a time)
function* rowsOf(csv, cols) {
  const lines = String(csv || '').split(/\r?\n/), head = cells(lines[0] || ''), ix = cols.map(c => head.indexOf(c));
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = cells(lines[i]), o = {}; for (let k = 0; k < cols.length; k++) o[cols[k]] = ix[k] < 0 || f[ix[k]] == null ? '' : f[ix[k]];
    yield o;
  }
}
const order = ['ATIS', 'TWR', 'GND', 'APP', 'DEP', 'CTR', 'UNIC', 'CTAF', 'AFIS', 'A/G', 'RDO'];
// the work, a row at a time (a generator: run through in one go, or a slice at a time with the server answering between)
function* steps(rcsv, fcsv, acsv) {
  const info = {}, freqs = {}, alias = [];
  let n = 0;
  if (acsv) for (const r of rowsOf(acsv, ['ident', 'type', 'icao_code', 'gps_code'])) {
    const id = r.ident.toUpperCase().trim(); if (!id) continue;
    // (a closed airport's other codes are not its own any more - they may be another's now; its runways stay under its
    // ident: FR24 still lists Coventry and Galway)
    if (r.type !== 'closed') for (const k of [r.icao_code, r.gps_code]) { const a = String(k || '').toUpperCase().trim(); if (a && a !== id) alias.push([a, id]); }
    if (++n % 2000 === 0) yield;
  }
  for (const r of rowsOf(rcsv, ['airport_ident', 'length_ft', 'width_ft', 'surface', 'lighted', 'closed', 'le_ident', 'le_latitude_deg', 'le_longitude_deg', 'le_elevation_ft', 'le_heading_degT', 'le_displaced_threshold_ft', 'he_ident', 'he_latitude_deg', 'he_longitude_deg', 'he_elevation_ft', 'he_heading_degT', 'he_displaced_threshold_ft'])) {
    if (++n % 2000 === 0) yield;
    const ap = r.airport_ident.toUpperCase().trim(); if (!ap) continue;
    const le = r.le_ident.toUpperCase().trim(), he = r.he_ident.toUpperCase().trim();
    if (!le || /^H/.test(le)) continue;
    const lit = r.lighted === '1' ? 1 : r.lighted === '0' ? 0 : -1, end = s => [num(r[s + '_elevation_ft']), num(r[s + '_heading_degT']), num(r[s + '_displaced_threshold_ft']), num(r[s + '_latitude_deg'], 5), num(r[s + '_longitude_deg'], 5)];
    (info[ap] = info[ap] || []).push([le, he, num(r.length_ft), num(r.width_ft), surfCode(r.surface), String(r.surface || '').slice(0, 40), lit, r.closed === '1' ? 1 : 0].concat(end('le'), end('he')));
  }
  let runways = 0;
  for (const k of Object.keys(info)) { info[k].sort((a, b) => a[7] - b[7] || (b[2] || 0) - (a[2] || 0)); runways += info[k].length; }
  yield;
  if (fcsv) for (const r of rowsOf(fcsv, ['airport_ident', 'type', 'description', 'frequency_mhz'])) {
    if (++n % 2000 === 0) yield;
    const ap = r.airport_ident.toUpperCase().trim(), mhz = num(r.frequency_mhz, 3); if (!ap || !(mhz > 0)) continue;
    (freqs[ap] = freqs[ap] || []).push([String(r.type || '').toUpperCase().slice(0, 12), String(r.description || '').slice(0, 60), mhz]);
  }
  for (const k of Object.keys(freqs)) freqs[k].sort((a, b) => ((order.indexOf(a[0]) + 1) || 99) - ((order.indexOf(b[0]) + 1) || 99) || a[2] - b[2]);
  const airports = Object.keys(info).length;
  // (its other codes: never over an airport that has that code as its own ident)
  for (const [a, id] of alias) { if (info[id] && !info[a]) info[a] = info[id]; if (freqs[id] && !freqs[a]) freqs[a] = freqs[id]; }
  return { info, freqs, airports, runways };
}
function build(rcsv, fcsv, acsv) { const g = steps(rcsv, fcsv, acsv); let x; while (!(x = g.next()).done) { /* in one go */ } return x.value; }
async function buildSlow(rcsv, fcsv, acsv) {
  const g = steps(rcsv, fcsv, acsv); let x, t = Date.now();
  while (!(x = g.next()).done) if (Date.now() - t >= 12) { await new Promise(r => setImmediate(r)); t = Date.now(); }
  return x.value;
}

const FILES = {
  runways: { name: 'runways.csv', min: 30000, head: /^"?id"?,"?airport_ref"?,"?airport_ident"?,"?length_ft"?/ },
  freqs: { name: 'airport-frequencies.csv', min: 15000, head: /^"?id"?,"?airport_ref"?,"?airport_ident"?,"?type"?,"?description"?,"?frequency_mhz"?/ }
};
// a file of OurAirports asked for again: -> its text when it is another than the one kept (written in its place), null
// when it is the same (the server says so by its ETag, or the text is the same). Throws for anything that is not it.
// meta: { <name>: etag } - kept by the caller
async function fetchFile(fetchFn, url, file, meta, key, check) {
  const h = { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)' }; if (meta[key] && fs.existsSync(file)) h['If-None-Match'] = meta[key];
  const r = await fetchFn(url, { headers: h, signal: AbortSignal.timeout(120000) });
  if (r.status === 304) return null;
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const text = await r.text(), why = check(text); if (why) throw new Error(why);
  meta[key] = (r.headers && typeof r.headers.get === 'function' && r.headers.get('etag')) || '';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file);
  return text;
}
const linesOf = t => { let n = 0; for (let i = t.indexOf('\n'); i >= 0; i = t.indexOf('\n', i + 1)) n++; return n; };
const readMeta = dir => { try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } };
const writeMeta = (dir, meta) => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'meta.json.tmp'), JSON.stringify(meta)); fs.renameSync(path.join(dir, 'meta.json.tmp'), path.join(dir, 'meta.json')); } catch (e) { /* asked for whole next time */ } };

function createOaRunways(env) {
  const dir = env.storeDir, now = env.now || (() => Date.now());
  const stats = { airports: 0, runways: 0, builtAt: 0, buildMs: 0, checkedAt: 0, fetched: 0, unchanged: 0, fails: 0, lastErr: '', fileAt: 0 };
  const fileOf = k => path.join(dir, FILES[k].name);
  const have = () => fs.existsSync(fileOf('runways'));
  const read = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const texts = airportsFile => [read(fileOf('runways')), read(fileOf('freqs')), airportsFile ? read(airportsFile) : ''];
  const done = (d, t0) => { stats.airports = d.airports; stats.runways = d.runways; stats.builtAt = now(); stats.buildMs = Date.now() - t0; return d; };
  // what the store's files give - null when it has none yet (the checkout's own data stands)
  function buildSync(airportsFile) { if (!have()) return null; const t0 = Date.now(); return done(build(...texts(airportsFile)), t0); }
  async function buildNow(airportsFile) { if (!have()) return null; const t0 = Date.now(); return done(await buildSlow(...texts(airportsFile)), t0); }
  // -> true when either file is another than the one kept
  async function refresh(fetchFn, o) {
    o = o || {};
    if (typeof fetchFn !== 'function') return false;
    if (!o.force && now() - stats.checkedAt < (o.everyMs || 3600e3)) return false;
    stats.checkedAt = now();
    const meta = readMeta(dir); let changed = false;
    for (const k of Object.keys(FILES)) {
      const F = FILES[k];
      try {
        const t = await fetchFile(fetchFn, (o.src || SRC) + F.name, fileOf(k), meta, F.name, text => (linesOf(text) < (o.min != null ? o.min : F.min) || !F.head.test(text) ? 'not the ' + F.name + ' file' : ''));
        if (t === null) stats.unchanged++; else { stats.fetched++; stats.fileAt = now(); changed = true; }
      } catch (e) { stats.fails++; stats.lastErr = (F.name + ': ' + String(e && e.message || e)).slice(0, 120); }
    }
    writeMeta(dir, meta);
    return changed;
  }
  return { have, buildSync, build: buildNow, refresh, stats, fileOf };
}
module.exports = { createOaRunways, build, buildSlow, surfCode, fetchFile, readMeta, writeMeta, linesOf, SRC };
