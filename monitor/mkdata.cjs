// Builds the monitor's runway and airport data from OurAirports (public domain: github.com/davidmegginson/ourairports-data)
//   data/runways.json      every end of every open runway of 1,200 ft and more: [lat, lon, true heading]   (the route engine)
//   data/runway_len.json   per airport: [longest runway ft, paved 0/1, lit 0/1 (-1 unknown), width ft]  (the route engine)
//   data/runway_info.json  per FR24 airport, every runway: [ident, other end's ident, length ft, width ft, surface (FR24's
//                          code), surface as the source has it, lit 1/0/-1, closed 1/0, then for each end (this, other):
//                          elevation ft, true heading, displaced threshold ft, lat, lon]  (the airport panel's runway
//                          details; which runway a flight used)
//   data/freqs.json        per FR24 airport: [[type, description, MHz]]  (tower, ground, ATIS...)
// The FR24 airports are those of data/airports.json. Helipads are left out of all of it.
// usage: node monitor/mkdata.cjs [<folder with runways.csv and airport-frequencies.csv>]   (downloaded when not given)
const fs = require('fs'), path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const E = createRouteEngine();
const DATA = process.env.MON_DATA || path.join(__dirname, 'data');
const SRC = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/';
// (the surface as FR24's runway tables code it - the userscript's own mapping, src/main/06-boards.js)
const RWY_SURF = [[/^(ASP|ASF|ASPH|ASPHALT|PEM|AS$)/i, 'ASPH'], [/^(BIT|BITU|BITUMINOUS|MAC|MACADAM|SEALED)/i, 'BITU'], [/^(CON|CONC|CONCRETE|CEM)/i, 'CONC'], [/^(TARM|TAR)/i, 'TARM'], [/^(GRS|GRASS|GRE|GRAS)/i, 'GRAS'], [/^(TURF)/i, 'TURF'], [/^(GVL|GRV|GRAV|GRAVEL)/i, 'GRVL'], [/^(DIRT|EARTH|SOIL|DRT)/i, 'DIRT'], [/^(SAND|SND)/i, 'SAND'], [/^(CLA|CLAY)/i, 'CLAY'], [/^(WAT|WATER)/i, 'WATE'], [/^(SNOW)/i, 'SNOW'], [/^(ICE)/i, 'ICE'], [/^(MAT|PSP|PIERCED|ALUM)/i, 'MATS'], [/^(LAT|LATERITE)/i, 'LATE'], [/^(COR|CORAL)/i, 'CORL'], [/^(UNPAVED|UNP)/i, 'UNPV'], [/^(PAVED|PAV|PER|PERM)/i, 'ASPH']];
const surfCode = s => { s = String(s || '').trim(); for (const [re, c] of RWY_SURF) if (re.test(s)) return c; return 'UNKN'; };

async function text(dir, f) {
  if (dir) return fs.readFileSync(path.join(dir, f), 'utf8');
  const r = await fetch(SRC + f); if (!r.ok) throw new Error(f + ': HTTP ' + r.status);
  return r.text();
}
function rows(csv) {
  const lines = String(csv).split('\n'), head = E.csvLine(lines[0]), out = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i].trim()) continue; const f = E.csvLine(lines[i]), o = {}; head.forEach((h, j) => { o[h] = f[j] == null ? '' : f[j]; }); out.push(o); }
  return out;
}
const num = (v, d) => { const x = parseFloat(v); return isFinite(x) ? (d ? Math.round(x * 10 ** d) / 10 ** d : Math.round(x)) : null; };
function write(f, obj) { const p = path.join(DATA, f); fs.writeFileSync(p + '.tmp', JSON.stringify(obj)); fs.renameSync(p + '.tmp', p); return fs.statSync(p).size; }

(async () => {
  const dir = process.argv[2] || '';
  const [rcsv, fcsv] = await Promise.all([text(dir, 'runways.csv'), text(dir, 'airport-frequencies.csv')]);
  const fr24 = new Set(JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows.map(a => String(a.icao || '').toUpperCase()).filter(Boolean));
  // (the route engine's two, as the userscript reads the same file)
  const ends = E.parseRunwaysCsv(rcsv), lens = E.parseRunwayLengths(rcsv);
  // every runway of the FR24 airports, in full
  const info = {};
  for (const r of rows(rcsv)) {
    const ap = String(r.airport_ident || '').toUpperCase(); if (!fr24.has(ap)) continue;
    const le = String(r.le_ident || '').toUpperCase(), he = String(r.he_ident || '').toUpperCase();
    if (!le || /^H/.test(le)) continue;
    const lit = r.lighted === '1' ? 1 : r.lighted === '0' ? 0 : -1, end = s => [num(r[s + '_elevation_ft']), num(r[s + '_heading_degT']), num(r[s + '_displaced_threshold_ft']), num(r[s + '_latitude_deg'], 5), num(r[s + '_longitude_deg'], 5)];
    (info[ap] = info[ap] || []).push([le, he, num(r.length_ft), num(r.width_ft), surfCode(r.surface), String(r.surface || '').slice(0, 40), lit, r.closed === '1' ? 1 : 0].concat(end('le'), end('he')));
  }
  for (const k of Object.keys(info)) info[k].sort((a, b) => a[7] - b[7] || (b[2] || 0) - (a[2] || 0));
  // their radio frequencies
  const freqs = {};
  for (const r of rows(fcsv)) {
    const ap = String(r.airport_ident || '').toUpperCase(), mhz = num(r.frequency_mhz, 3); if (!fr24.has(ap) || !(mhz > 0)) continue;
    (freqs[ap] = freqs[ap] || []).push([String(r.type || '').toUpperCase().slice(0, 12), String(r.description || '').slice(0, 60), mhz]);
  }
  const order = ['ATIS', 'TWR', 'GND', 'APP', 'DEP', 'CTR', 'UNIC', 'CTAF', 'AFIS', 'A/G', 'RDO'];
  for (const k of Object.keys(freqs)) freqs[k].sort((a, b) => ((order.indexOf(a[0]) + 1) || 99) - ((order.indexOf(b[0]) + 1) || 99) || a[2] - b[2]);
  const sizes = { 'runways.json': write('runways.json', ends), 'runway_len.json': write('runway_len.json', lens), 'runway_info.json': write('runway_info.json', info), 'freqs.json': write('freqs.json', freqs) };
  const nR = Object.values(info).reduce((n, l) => n + l.length, 0);
  console.log(`runway ends of ${Object.keys(ends).length} airports; longest runways of ${Object.keys(lens).length}; ${nR} runways of ${Object.keys(info).length} of FR24's ${fr24.size} airports; frequencies of ${Object.keys(freqs).length}`);
  console.log(Object.entries(sizes).map(([f, n]) => f + ' ' + (n / 1024).toFixed(0) + ' KB').join(', '));
})().catch(e => { console.error(e); process.exit(1); });
