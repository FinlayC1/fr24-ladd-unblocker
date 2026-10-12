// The packed population tables as the userscript loads them: the build's line format, parsed and unpacked in slices
// (parseT2Lines + unpackT2Steps from src/main/03-data.js) must give exactly the tables unpackT2 gives at once, and no
// slice may hold the page for long. usage: node test/t2_load.cjs [dist build]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const root = path.join(__dirname, '..');
const dist = process.argv[2] || path.join(root, 'dist', 'fr24-ladd-unblocker.user.js');
const src = fs.readFileSync(path.join(root, 'src', 'main', '03-data.js'), 'utf8');
const i0 = src.indexOf('/* ==UNPACKT2== */'), i1 = src.indexOf('let t2Ready');
const F = new Function(src.slice(i0, i1) + '; return { unpackT2, unpackT2Steps, parseT2Lines };')();
const b = fs.readFileSync(dist, 'utf8'), m = b.indexOf('const ROUTE_T2_GZ = "'), e = b.indexOf('";', m);
const txt = zlib.gunzipSync(Buffer.from(b.slice(m + 21, e), 'base64')).toString();
let worst = 0, slices = 0;
const sliced = it => { for (;;) { const t0 = process.hrtime.bigint(); let done = false; while (Number(process.hrtime.bigint() - t0) / 1e6 < 8) if (it.next().done) { done = true; break; } const ms = Number(process.hrtime.bigint() - t0) / 1e6; worst = Math.max(worst, ms); slices++; if (done) return; } };
const t0 = Date.now();
const p = {}; if (!txt.startsWith('T2L1\n')) throw new Error('build is not in the line format'); sliced(F.parseT2Lines(txt, p));
const t = {}; sliced(F.unpackT2Steps(p, t));
const total = Date.now() - t0;
const ref = F.unpackT2(JSON.parse(fs.readFileSync(path.join(root, 'src', 'tables2.json'), 'utf8')));
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const bad = Object.keys(ref).filter(k => JSON.stringify(canon(ref[k])) !== JSON.stringify(canon(t[k])));
console.log(bad.length ? 'MISMATCH: ' + bad.join(', ') : 'sliced load = unpackT2: ok', '|', (txt.length / 1e6).toFixed(1), 'MB,', slices, 'slices, longest', worst.toFixed(1), 'ms, total', total, 'ms');
process.exitCode = bad.length || worst > 40 ? 1 : 0;
