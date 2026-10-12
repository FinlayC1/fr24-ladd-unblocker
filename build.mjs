// Assembles the single-file userscript: header + page interceptor + route engine + learned tables + userscript modules.
// usage: node build.mjs [tables.json] [logit.json]
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const tablesFile = process.argv[2] || path.join(root, 'src', 'tables.json');
const tables = JSON.parse(fs.readFileSync(tablesFile, 'utf8'));
const logitFile = process.argv[3] || path.join(root, 'src', 'logit.json');
const logit = fs.existsSync(logitFile) ? JSON.parse(fs.readFileSync(logitFile, 'utf8')) : null;
// compact: 3 significant decimals, drop sample counts the engine does not need
const round = v => typeof v === 'number' ? +v.toFixed(3) : v;
for (const key of ['hdg', 'xt', 'desc', 'lvl', 'clm', 'stp', 'rall', 'cruise', 'trip', 'tripc', 'loc', 'clb', 'cls']) for (const g of Object.values(tables[key] || {})) for (const b of Object.values(g)) { b.q = b.q.map(round); delete b.n; }
delete tables.qs; delete tables.n;
// airport pairs packed by first airport: { EGGW: 'KBUR:1.6,LFPB:3,...' } (the engine unpacks them)
if (tables.od) { const g = {}; for (const [k, v] of Object.entries(tables.od)) { const [a, b] = k.split('|'); (g[a] = g[a] || []).push(b + ':' + (+(+v).toFixed(1))); } tables.odG = Object.fromEntries(Object.entries(g).map(([a, l]) => [a, l.join(',')])); delete tables.od; }
// the population tables (22.10): gzip + base64 - a few MB of JSON as a fraction of it, unpacked at start (loadT2)
const t2File = process.argv[4] || path.join(root, 'src', 'tables2.json');
// written as lines "key<TAB>json" (the big tables in parts of ~150 KB) so the script parses them a slice at a time
function t2Lines(t2) {
  if (t2.pk !== 2) return JSON.stringify(t2);
  const BIG = ['ap', 'od2', 'odt', 'apd', 'seq', 'csr', 'aph', 'aps', 'pgu', 'flow'];
  const lines = ['T2L1', '_\t' + JSON.stringify(Object.fromEntries(Object.entries(t2).filter(([k]) => !BIG.includes(k)))), 'ap\t' + JSON.stringify(t2.ap)];
  for (const k of BIG.slice(1)) {
    let part = {}, len = 0;
    const flush = () => { if (len) lines.push(k + '\t' + JSON.stringify(part)); part = {}; len = 0; };
    for (const [key, v] of Object.entries(t2[k] || {})) { part[key] = v; len += JSON.stringify(v).length + key.length + 4; if (len > 150000) flush(); }
    flush();
  }
  return lines.join('\n');
}
// build years by type and serial number (test/mkagetable.cjs: the FAA register, current and deregistered), packed
const ageFile = path.join(root, 'src', 'agetable.json');
const ageGz = fs.existsSync(ageFile) ? zlib.gzipSync(fs.readFileSync(ageFile), { level: 9 }).toString('base64') : '';
// learned arrival paths (test/pipe_appr.cjs, kept at the threshold test/appr_eval.cjs chose): a header line, then per
// cell - sorted by cell number - varints of the step from the last cell, the airport's place in the header's list, the
// traffic through it and those of it that did not land there
const apprFile = path.join(root, 'src', 'approach.json');
function apprPack(t) {
  const keys = Object.keys(t.cells).map(Number).sort((a, b) => a - b), aps = [...new Set(keys.map(k => t.cells[k][0]))].sort((a, b) => a - b), apIx = new Map(aps.map((a, i) => [a, i]));
  const head = Buffer.from(JSON.stringify({ v: t.v, bin: t.bin, days: t.days, from: t.from, to: t.to, thr: t.thr, minN: t.minN, aps, n: keys.length }) + '\n'), body = [];
  const vint = v => { while (v >= 128) { body.push(v % 128 + 128); v = Math.floor(v / 128); } body.push(v); };
  let last = 0;
  for (const k of keys) { const c = t.cells[k]; vint(k - last); last = k; vint(apIx.get(c[0])); vint(c[2]); vint(c[2] - c[1]); }
  return Buffer.concat([head, Buffer.from(body)]);
}
const apprGz = fs.existsSync(apprFile) ? zlib.gzipSync(apprPack(JSON.parse(fs.readFileSync(apprFile, 'utf8'))), { level: 9 }).toString('base64') : '';
const t2gz = fs.existsSync(t2File) ? zlib.gzipSync(t2Lines(JSON.parse(fs.readFileSync(t2File, 'utf8'))), { level: 9 }).toString('base64') : '';
const engineSrc = rd('src/engine.js');
const e0 = engineSrc.indexOf('/* ==ENGINE=='), e1 = engineSrc.indexOf('/* ==/ENGINE== */');
if (e0 < 0 || e1 < 0) throw new Error('engine markers missing');
const engine = engineSrc.slice(e0, e1 + '/* ==/ENGINE== */'.length).split('\n').map(l => l ? '  ' + l : l).join('\n');
const mods = fs.readdirSync(path.join(root, 'src', 'main')).filter(f => /^\d\d-.*\.js$/.test(f)).sort().map(f => rd('src/main/' + f));
const out = [
  rd('src/header.js'),
  '(function () {',
  "  'use strict';",
  '',
  rd('src/page.js').replace("'__TL_VERSION__'", JSON.stringify((rd('src/header.js').match(/@version\s+(\S+)/) || [])[1] || '')),
  '',
  engine,
  '',
  '  // Learned likelihood tables + business/military aviation airport usage (test/mktables.cjs, ~11,000 real legs)',
  '  const ROUTE_TABLES = ' + JSON.stringify(tables) + ';',
  '  // How much each piece of evidence counts, per situation (conditional logit fitted on real flights, test/fitlogit.cjs)',
  '  const ROUTE_LOGIT = ' + JSON.stringify(logit) + ';',
  '  // The whole population habits (test/pipe_tables.cjs, 63 days of every aircraft adsb.lol saw), packed',
  '  const ROUTE_T2_GZ = ' + JSON.stringify(t2gz) + ';',
  '  // Build years of turbine aircraft and helicopters by type and serial number (test/mkagetable.cjs), packed',
  '  const AGE_TABLE_GZ = ' + JSON.stringify(ageGz) + ';',
  '  // Arrival paths: the cells of the sky where nearly all the traffic goes on to land at one airport (test/pipe_appr.cjs), packed',
  '  const APPR_TABLE_GZ = ' + JSON.stringify(apprGz) + ';',
  ...mods,
  '})();',
  ''
].join('\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const dest = path.join(root, 'dist', 'fr24-ladd-unblocker.user.js');
fs.writeFileSync(dest, out);
console.log('built', dest, (out.length / 1024).toFixed(0) + ' KB', out.split('\n').length, 'lines');
