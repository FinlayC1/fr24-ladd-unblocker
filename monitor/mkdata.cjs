// Builds the monitor's runway and airport data from OurAirports (public domain: github.com/davidmegginson/ourairports-data)
//   data/runways.json      every end of every open runway of 1,200 ft and more: [lat, lon, true heading]   (the route engine)
//   data/runway_len.json   per airport: [longest runway ft, paved 0/1, lit 0/1 (-1 unknown), width ft]  (the route engine)
//   data/runway_info.json  per airport (1.3.2: every one that is not closed, not FR24's alone), every runway: [ident, other end's ident, length ft, width ft, surface (FR24's
//                          code), surface as the source has it, lit 1/0/-1, closed 1/0, then for each end (this, other):
//                          elevation ft, true heading, displaced threshold ft, lat, lon]  (the airport panel's runway
//                          details; which runway a flight used)
//   data/freqs.json        per airport: [[type, description, MHz]]  (tower, ground, ATIS...)
//   data/pads.json         per heliport: its helipads [ident, length ft, width ft, surface code, surface, lit, closed, lat, lon]
//   data/oa_airports.csv   OurAirports' airports themselves, as they are now (oaap.cjs's list, the engine's airfields)
// Helipads are left out of the runways (pads.json has them). The monitor keeps its own, newer copies of these in its store once it runs
// (oaap.cjs, oarwy.cjs: asked for again every hour) - these are what a new checkout starts from.
// usage: node monitor/mkdata.cjs [<folder with airports.csv, runways.csv and airport-frequencies.csv>]   (downloaded when not given)
const fs = require('fs'), path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const E = createRouteEngine();
const DATA = process.env.MON_DATA || path.join(__dirname, 'data');
const SRC = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/';
const { build } = require('./oarwy.cjs');
async function text(dir, f) {
  if (dir) return fs.readFileSync(path.join(dir, f), 'utf8');
  const r = await fetch(SRC + f); if (!r.ok) throw new Error(f + ': HTTP ' + r.status);
  return r.text();
}
function write(f, obj) { const p = path.join(DATA, f); fs.writeFileSync(p + '.tmp', JSON.stringify(obj)); fs.renameSync(p + '.tmp', p); return fs.statSync(p).size; }

(async () => {
  const dir = process.argv[2] || '';
  const [rcsv, fcsv, acsv] = await Promise.all([text(dir, 'runways.csv'), text(dir, 'airport-frequencies.csv'), text(dir, 'airports.csv')]);
  const fr24 = new Set(JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows.map(a => String(a.icao || '').toUpperCase()).filter(Boolean));
  // (the route engine's two, as the userscript reads the same file)
  const ends = E.parseRunwaysCsv(rcsv), lens = E.parseRunwayLengths(rcsv);
  // every runway and frequency of every airport that is not closed (1.3.2: not FR24's alone - oarwy.cjs)
  const { info, freqs, pads } = build(rcsv, fcsv, acsv);
  // (the airports themselves, as OurAirports has them now: oaap.cjs's list, the engine's airfields)
  { const p = path.join(DATA, 'oa_airports.csv'); fs.writeFileSync(p + '.tmp', acsv); fs.renameSync(p + '.tmp', p); }
  const sizes = { 'runways.json': write('runways.json', ends), 'runway_len.json': write('runway_len.json', lens), 'runway_info.json': write('runway_info.json', info), 'freqs.json': write('freqs.json', freqs), 'pads.json': write('pads.json', pads) };
  const nR = Object.values(info).reduce((n, l) => n + l.length, 0);
  console.log(`runway ends of ${Object.keys(ends).length} airports; longest runways of ${Object.keys(lens).length}; ${nR} runways of ${Object.keys(info).length} airports (FR24 lists ${fr24.size}); frequencies of ${Object.keys(freqs).length}`);
  console.log(Object.entries(sizes).map(([f, n]) => f + ' ' + (n / 1024).toFixed(0) + ' KB').join(', '));
})().catch(e => { console.error(e); process.exit(1); });
