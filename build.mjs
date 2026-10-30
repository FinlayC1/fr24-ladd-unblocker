// Assembles the single-file userscript: header + page interceptor + route engine + learned tables + userscript modules.
// usage: node build.mjs
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
// (1.1.0) The route tables, the weights, the population tables and the arrival paths are not in the script: every route is
// worked out on the monitor (monitor/central.cjs reads them from src/). What the script carries of what was learned: the
// build years of aircraft, for the panel's age.
// build years by type and serial number (test/mkagetable.cjs: the FAA register, current and deregistered), packed
const ageFile = path.join(root, 'src', 'agetable.json');
const ageGz = fs.existsSync(ageFile) ? zlib.gzipSync(fs.readFileSync(ageFile), { level: 9 }).toString('base64') : '';
const engineSrc = rd('src/engine.js');
const e0 = engineSrc.indexOf('/* ==ENGINE=='), e1 = engineSrc.indexOf('/* ==/ENGINE== */');
if (e0 < 0 || e1 < 0) throw new Error('engine markers missing');
const engine = engineSrc.slice(e0, e1 + '/* ==/ENGINE== */'.length).split('\n').map(l => l ? '  ' + l : l).join('\n');
const registrySrc = rd('src/registry.js');
const r0 = registrySrc.indexOf('/* ==REGISTRY=='), r1 = registrySrc.indexOf('/* ==/REGISTRY== */');
if (r0 < 0 || r1 < 0) throw new Error('registry markers missing');
const registry = registrySrc.slice(r0, r1 + '/* ==/REGISTRY== */'.length).split('\n').map(l => l ? '  ' + l : l).join('\n');
// (the newest CHANGELOG section's headlines - its bold lead of each item - for the window's "what's new" note after an update)
const whatsNew = (() => {
  const sec = rd('CHANGELOG.md').split(/^## /m)[1] || '', v = (sec.match(/^\[([^\]]+)\]/) || [])[1] || '';
  // (the section's "In short" sentences, written for the people using it; failing that, the bold lead of each item)
  const short = (sec.match(/^### In short\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/m) || [])[1] || '';
  const lead = [...short.matchAll(/^- (.+)$/gm)].map(m => m[1].replace(/`/g, '').trim());
  const items = (lead.length ? lead : [...sec.matchAll(/^- \*\*(.+?)\*\*/gm)].map(m => m[1].replace(/`/g, '').trim())).filter(Boolean).slice(0, 6);
  return { v, items };
})();
const mods = fs.readdirSync(path.join(root, 'src', 'main')).filter(f => /^\d\d-.*\.js$/.test(f)).sort().map(f => rd('src/main/' + f).replace("'__TL_WHATSNEW__'", () => JSON.stringify(whatsNew)));
// the learned data: [the name the script knows it by, what it is, its JSON]
const DATA = [
  ['AGE_TABLE_GZ', 'Build years of turbine aircraft and helicopters by type and serial number (test/mkagetable.cjs), packed', JSON.stringify(ageGz)]
];
const DATA_MARK = '\u0000TL_DATA\u0000';
const outWith = data => outParts.replace(DATA_MARK, () => data);
const outParts = [
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
  DATA_MARK,
  ...mods,
  '})();',
  ''
].join('\n');
// the userscript: the data written in where it is used; the extension (below): each read from its data files
const out = outWith(DATA.map(([name, note, json]) => '  // ' + note + '\n  const ' + name + ' = ' + json + ';').join('\n'));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const dest = path.join(root, 'dist', 'fr24-ladd-unblocker.user.js');
fs.writeFileSync(dest, out);
console.log('built', dest, (out.length / 1024).toFixed(0) + ' KB', out.split('\n').length, 'lines');

// ---- the browser extension (Chrome / Edge, Manifest V3): the same script, without a userscript manager ---------------
//   dist/extension/manifest.json  hosts = the userscript's @connect list (each as https://host/*; sslip.io with its subdomains)
//   dist/extension/page.js        the page-world part (src/page.js), in FR24's own world at document start
//   dist/extension/data-<n>.js    the learned data (the tables), in parts under Firefox's 5 MB limit on a file it checks
//   dist/extension/content.js     extension/shim.js (GM_xmlhttpRequest through the service worker) + the whole script
//   dist/extension/background.js  the service worker that makes those requests
//   dist/fr24-ladd-unblocker-extension.zip   the same, packed
//   dist/fr24-ladd-unblocker-firefox.zip     the same for Firefox: its manifest has a background script in place of the
//                                            service worker, and the add-on's id (for addons.mozilla.org)
const header = rd('src/header.js'), meta = k => (header.match(new RegExp('@' + k + '\\s+(.+)')) || [])[1] || '';
const version = meta('version').trim();
// (the version typed by hand elsewhere - package.json, the README's badge, the website's byline - must be this one)
for (const [f, re] of [['package.json', /"version": "([^"]+)"/], ['README.md', /badge\/version-([0-9.]+)-/], ['site/index.html', /Version ([0-9.]+) ·/]]) {
  const got = (rd(f).match(re) || [])[1];
  if (got !== version) { console.error(`build: ${f} says version ${got}, src/header.js says ${version} - bring them in line`); process.exit(1); }
}
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
  // (a monitor of the user's own, at any https address: asked for when it is set, on grant.html)
  optional_host_permissions: ['https://*/*'],
  content_scripts: [
    { matches: ['https://www.flightradar24.com/*', 'https://flightradar24.com/*'], js: ['page.js'], run_at: 'document_start', world: 'MAIN', all_frames: false },
    { matches: ['https://www.flightradar24.com/*', 'https://flightradar24.com/*'], js: ['content.js'], run_at: 'document_start', all_frames: false }
  ],
  minimum_chrome_version: '111'
};
// Firefox (140 and up: the first that reads what an add-on says it sends, below): the same, but its background is an event
// page (a script), not a service worker, and an add-on is known by its id - never changed once on addons.mozilla.org
const GECKO_ID = 'ladd-unblocker@finlayc1.github.io';
const { minimum_chrome_version: _chromeOnly, ...common } = manifest;
const firefoxManifest = {
  ...common,
  background: { scripts: ['background.js'] },
  browser_specific_settings: {
    gecko: {
      id: GECKO_ID,
      strict_min_version: '140.0',
      // (what leaves the browser, as addons.mozilla.org asks: what FR24's page shows, sent to the shared monitor - see
      // PRIVACY.md; it is on unless switched off, so it is required, not optional. The count of installs - an id, the
      // version, browser and system, src/main/06-hello.js - is "technical and interaction data", which can only be optional:
      // the add-on asks Firefox whether it was allowed before it sends it)
      data_collection_permissions: { required: ['websiteContent'], optional: ['technicalAndInteraction'] }
    },
    // (made for desktop Firefox; this only says from which Android version the key above is understood)
    gecko_android: { strict_min_version: '142.0' }
  }
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
// the learned data in files of its own, each well under 5 MB (Firefox's add-on check reads no bigger script): its long
// strings cut in parts, each file adding to globalThis.__tlData - content scripts of one extension share their globals -
// and the script reading each from there
const DATA_PART = 2 * 1024 * 1024, dataFiles = [];
{
  let cur = [], len = 0;
  const flush = () => { if (cur.length) dataFiles.push(cur); cur = []; len = 0; };
  for (const [name, note, json] of DATA) {
    const parts = [];
    if (json[0] === '"' && json.length > DATA_PART) { const str = JSON.parse(json); for (let i = 0; i < str.length; i += DATA_PART) parts.push(JSON.stringify(str.slice(i, i + DATA_PART))); }
    else parts.push(json);
    parts.forEach((p, i) => {
      if (len && len + p.length > DATA_PART * 1.5) flush();
      cur.push(`// ${note}${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ''}\nD.${name} = ${i ? 'D.' + name + ' + ' : ''}${p};`); len += p.length;
    });
  }
  flush();
}
const dataJs = dataFiles.map((lines, i) => `// FR24 LADD Unblocker ${version} - learned data, part ${i + 1} of ${dataFiles.length} (built by build.mjs from src/*.json)\n(function (D) {\n${lines.join('\n')}\n})(globalThis.__tlData = globalThis.__tlData || {});\n`);
const dataNames = dataJs.map((_, i) => `data-${i + 1}.js`);
const contentJs = rd('extension/shim.js') + '\n' + outWith(DATA.map(([name]) => '  const ' + name + ' = globalThis.__tlData.' + name + ';').join('\n'));
manifest.content_scripts[1].js = firefoxManifest.content_scripts[1].js = [...dataNames, 'content.js'];
const MAX_FILE = 4 * 1024 * 1024;
for (const [name, text] of [...dataJs.map((t, i) => [dataNames[i], t]), ['content.js', contentJs], ['page.js', pagePart]]) {
  if (Buffer.byteLength(text) > MAX_FILE) { console.error(`build: ${name} is ${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB - Firefox's add-on check stops at 5 MB a file; cut it smaller`); process.exit(1); }
}
const extFiles = [
  ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')],
  ['page.js', Buffer.from(pagePart)],
  ...dataJs.map((t, i) => [dataNames[i], Buffer.from(t)]),
  ['content.js', Buffer.from(contentJs)],
  ['background.js', Buffer.from(rd('extension/background.js'))],
  ['grant.html', Buffer.from(rd('extension/grant.html'))],
  ['grant.js', Buffer.from(rd('extension/grant.js'))],
  ['update.html', Buffer.from(rd('extension/update.html'))],
  ['update.js', Buffer.from(rd('extension/update.js'))],
  ...[16, 48, 128].map(n => { const f = path.join(root, 'extension', 'icons', n + '.png'); return ['icons/' + n + '.png', fs.existsSync(f) ? fs.readFileSync(f) : pngIcon(n)]; })
];
// (files.json: every file of the version and its SHA-256 - what the update page (extension/update.js) fetches at the
// version's tag, checks each new file against, and deletes the old version's files by; Chrome's manifest is the one listed)
const fileList = { version, files: Object.fromEntries(extFiles.map(([name, data]) => [name, crypto.createHash('sha256').update(data).digest('hex')])) };
extFiles.push(['files.json', Buffer.from(JSON.stringify(fileList, null, 2) + '\n')]);
const extDir = path.join(root, 'dist', 'extension');
fs.rmSync(extDir, { recursive: true, force: true });
for (const [name, data] of extFiles) { fs.mkdirSync(path.dirname(path.join(extDir, name)), { recursive: true }); fs.writeFileSync(path.join(extDir, name), data); }
fs.writeFileSync(path.join(root, 'dist', 'fr24-ladd-unblocker-extension.zip'), zip(extFiles));
console.log('built', extDir, '(+ zip),', manifest.host_permissions.length, 'hosts');
const ffFiles = extFiles.map(([name, data]) => name === 'manifest.json' ? [name, Buffer.from(JSON.stringify(firefoxManifest, null, 2) + '\n')] : [name, data]);
fs.writeFileSync(path.join(root, 'dist', 'fr24-ladd-unblocker-firefox.zip'), zip(ffFiles));
console.log('built', path.join(root, 'dist', 'fr24-ladd-unblocker-firefox.zip'), '(Firefox, id ' + GECKO_ID + ')');
