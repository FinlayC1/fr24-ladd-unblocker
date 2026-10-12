// ICAO aircraft type designators -> engine layout and wake class (ICAO Doc 8643 as published in the tar1090-db project,
// wiedehopf/tar1090-db db/icao_aircraft_types2.js, gzip-compressed JSON). Writes the compact table the engine embeds:
// "TYPE:DESC+WTC,..." e.g. "GA8:L1PL" = landplane, 1 piston engine, light.
// usage: node test/mkactypes.cjs <icao_types2.json> <src/engine.js>
const fs = require('fs');
const [inFile, engineFile] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const parts = [];
for (const [t, v] of Object.entries(j).sort()) {
  const desc = String(v[1] || ''), wtc = String(v[2] || '').slice(0, 1);
  if (!/^[A-Z0-9]{2,4}$/.test(t) || !/^[LSAHGT][1-8C][PTJE]$/.test(desc)) continue;
  parts.push(t + ':' + desc + (wtc || '-'));
}
const line = `  const AC_TYPES = '${parts.join(',')}';`;
let src = fs.readFileSync(engineFile, 'utf8');
const re = /^ {2}const AC_TYPES = '[^']*';$/m;
if (!re.test(src)) throw new Error('AC_TYPES line missing in engine');
src = src.replace(re, line);
fs.writeFileSync(engineFile, src);
console.log('types', parts.length, 'bytes', line.length);
