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
const registrySrc = rd('src/registry.js');
const r0 = registrySrc.indexOf('/* ==REGISTRY=='), r1 = registrySrc.indexOf('/* ==/REGISTRY== */');
if (r0 < 0 || r1 < 0) throw new Error('registry markers missing');
const registry = registrySrc.slice(r0, r1 + '/* ==/REGISTRY== */'.length).split('\n').map(l => l ? '  ' + l : l).join('\n');
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
  registry,
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

// ---- the browser extension (Chrome / Edge, Manifest V3): the same script, without a userscript manager ---------------
//   dist/extension/manifest.json  hosts = the userscript's @connect list (each as https://host/*; sslip.io with its subdomains)
//   dist/extension/page.js        the page-world part (src/page.js), in FR24's own world at document start
//   dist/extension/content.js     extension/shim.js (GM_xmlhttpRequest through the service worker) + the whole script
//   dist/extension/background.js  the service worker that makes those requests
//   dist/fr24-ladd-unblocker-extension.zip   the same, packed
const header = rd('src/header.js'), meta = k => (header.match(new RegExp('@' + k + '\\s+(.+)')) || [])[1] || '';
const version = meta('version').trim();
const hosts = [...header.matchAll(/@connect\s+(\S+)/g)].map(m => m[1]).filter(h => /\./.test(h));
const hostPerm = h => h === 'sslip.io' ? ['https://*.sslip.io/*'] : ['https://' + h + '/*'];
const manifest = {
  manifest_version: 3,
  name: 'FR24 LADD Unblocker',
  version,
  description: 'Names blocked (LADD) and N/A aircraft on Flightradar24 from public ADS-B, with routes, predicted destinations and flight history.',
  author: meta('author').trim(),
  icons: { 16: 'icons/16.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  background: { service_worker: 'background.js' },
  host_permissions: [...new Set(hosts.flatMap(hostPerm))],
  content_scripts: [
    { matches: ['https://www.flightradar24.com/*', 'https://flightradar24.com/*'], js: ['page.js'], run_at: 'document_start', world: 'MAIN', all_frames: false },
    { matches: ['https://www.flightradar24.com/*', 'https://flightradar24.com/*'], js: ['content.js'], run_at: 'document_start', all_frames: false }
  ],
  minimum_chrome_version: '111'
};
// the icons: extension/icons/<size>.png (rendered from docs/assets/icon.svg); without them, a small one drawn pixel by
// pixel - an aircraft in FR24's yellow on its dark purple
function pngIcon(size) {
  const px = Buffer.alloc(size * size * 4), set = (x, y, c) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const i = (y * size + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  const bg = [43, 26, 77], fg = [255, 205, 0], u = size / 16, r = size * 0.18;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y), out = cx < r && cy < r && Math.hypot(r - cx, r - cy) > r;
    if (out) { px[(y * size + x) * 4 + 3] = 0; continue; }
    const X = x / u, Y = y / u, plane = (Math.abs(X - 8) < 1.1 && Y > 2 && Y < 14) || (Y > 6.5 && Y < 9 && Math.abs(X - 8) < 6.5 - (Y - 6.5) * 0.6) || (Y > 12 && Y < 13.6 && Math.abs(X - 8) < 3);
    set(x, y, plane ? fg : bg);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size); for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
// (a zip of the folder, for installing or sending - deflated, with a central directory; no tool needed)
// (every file dated the build day, 00:00 - DOS time in the low half, date in the high half)
const DOS_DATE = (() => { const d = new Date(); return (((d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate()) << 16) >>> 0; })();
function zip(files) {
  const locals = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name), comp = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(DOS_DATE, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(DOS_DATE, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(0, 30); ch.writeUInt32LE(0, 34); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); central.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const pagePart = '// FR24 LADD Unblocker ' + version + ' - the page-world part (see src/page.js)\n(function () {\n  \'use strict\';\n' + rd('src/page.js').replace("'__TL_VERSION__'", JSON.stringify(version)) + '\n  pageInterceptor();\n})();\n';
const extFiles = [
  ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')],
  ['page.js', Buffer.from(pagePart)],
  ['content.js', Buffer.from(rd('extension/shim.js') + '\n' + out)],
  ['background.js', Buffer.from(rd('extension/background.js'))],
  ...[16, 48, 128].map(n => { const f = path.join(root, 'extension', 'icons', n + '.png'); return ['icons/' + n + '.png', fs.existsSync(f) ? fs.readFileSync(f) : pngIcon(n)]; })
];
const extDir = path.join(root, 'dist', 'extension');
fs.rmSync(extDir, { recursive: true, force: true });
for (const [name, data] of extFiles) { fs.mkdirSync(path.dirname(path.join(extDir, name)), { recursive: true }); fs.writeFileSync(path.join(extDir, name), data); }
fs.writeFileSync(path.join(root, 'dist', 'fr24-ladd-unblocker-extension.zip'), zip(extFiles));
console.log('built', extDir, '(+ zip),', manifest.host_permissions.length, 'hosts');
