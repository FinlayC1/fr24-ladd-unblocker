// The population tables trimmed and packed for the userscript (src/tables2.json, gzip+base64 by build.mjs; unpacked
// at start by unpackT2 in src/main/03-data.js - the same code is checked here, round trip). What carries evidence stays,
// the long tail of one-off entries goes; airports are indexes into one list, keys nested by origin / map cell.
// usage: node test/pack_t2.cjs <in _t2.json> <out.json> [--flowMin=40] [--flowTop=8] [--csMin=3] [--pguMin=3] [--airMin=10]
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const args = process.argv.slice(2);
const [inFile, outFile] = args.filter(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? +a.slice(k.length + 3) : d; };
const FLOW_MIN = opt('flowMin', 40), FLOW_TOP = opt('flowTop', 8), CS_MIN = opt('csMin', 3), PGU_MIN = opt('pguMin', 3), AIR_MIN = opt('airMin', 10);
const t = JSON.parse(fs.readFileSync(inFile, 'utf8'));
// ---- trim (canonical form) -------------------------------------------------------------------------------------------------
const c = { v: t.v, built: t.built, days: t.days, from: t.from, to: t.to };
c.od2 = {}; for (const [k, v] of Object.entries(t.od2 || {})) { const nonAir = v[0] + v[2] + v[3] + v[4] + v[5]; if (nonAir >= 2 || v[1] >= AIR_MIN) c.od2[k] = v; }
c.odt = t.odt || {}; c.apd = t.apd || {};
c.seq = {}; for (const [k, n] of Object.entries(t.seq || {})) if (n >= (k.startsWith('a:') ? 6 : 2)) c.seq[k] = n;
c.csr = {}; for (const [cs, l] of Object.entries(t.csr || {})) { const m = []; for (let i = 0; i + 2 < l.length; i += 3) if (l[i + 2] >= CS_MIN) m.push(l[i], l[i + 1], l[i + 2]); if (m.length) c.csr[cs] = m; }
c.aph = t.aph || {}; c.aphAll = t.aphAll; c.aps = t.aps || {};
c.pgu = {}; for (const [pg, m] of Object.entries(t.pgu || {})) { const x = {}; for (const [k, n] of Object.entries(m)) if (n >= PGU_MIN) x[k] = n; if (Object.keys(x).length) c.pgu[pg] = x; }
const r2 = v => typeof v === 'number' ? Math.round(v * 100) / 100 : v;
const slimPerf = p => { const q = {}; for (const [k, v] of Object.entries(p)) q[k] = k === 'cz' ? Object.fromEntries(Object.entries(v).map(([b, a]) => [b, a.map(Math.round)])) : Array.isArray(v) ? v.map(r2) : r2(v); return q; };
c.tperf = Object.fromEntries(Object.entries(t.tperf || {}).map(([k, p]) => [k, slimPerf(p)]));
c.pperf = Object.fromEntries(Object.entries(t.pperf || {}).map(([k, p]) => [k, slimPerf(p)]));
c.flow = {}; for (const [k, v] of Object.entries(t.flow || {})) { if (v[0] + v[1] < FLOW_MIN) continue; c.flow[k] = v.slice(0, 2 + 3 * FLOW_TOP); }
// ---- pack ------------------------------------------------------------------------------------------------------------------
const AP = [], AX = new Map(); const ix = code => { let i = AX.get(code); if (i == null) { i = AP.length; AP.push(code); AX.set(code, i); } return i; };
const p = { pk: 2, v: c.v, built: c.built, days: c.days, from: c.from, to: c.to, aphAll: c.aphAll, tperf: c.tperf, pperf: c.pperf };
const nest = (obj, split, val) => { const o = {}; for (const [k, v] of Object.entries(obj)) { const [a, b] = split(k); (o[a] = o[a] || {})[b] = val(v); } return o; };
p.od2 = nest(c.od2, k => { const [a, b] = k.split('>'); return [ix(a), ix(b)]; }, v => v);
p.odt = nest(c.odt, k => { const [a, b] = k.split('>'); return [ix(a), ix(b)]; }, v => v);
p.apd = Object.fromEntries(Object.entries(c.apd).map(([k, v]) => [ix(k), v]));
p.seq = {}; for (const [k, n] of Object.entries(c.seq)) { const air = k.startsWith('a:'), [x, o, d] = (air ? k.slice(2) : k).split('>'); const key = (air ? 'a' : '') + ix(x) + '>' + ix(o); (p.seq[key] = p.seq[key] || {})[ix(d)] = n; }
p.csr = Object.fromEntries(Object.entries(c.csr).map(([cs, l]) => { const m = []; for (let i = 0; i + 2 < l.length; i += 3) m.push(ix(l[i]), ix(l[i + 1]), l[i + 2]); return [cs, m]; }));
p.aph = Object.fromEntries(Object.entries(c.aph).map(([k, v]) => [ix(k), v]));
p.aps = Object.fromEntries(Object.entries(c.aps).map(([k, v]) => [ix(k), v]));
p.pgu = Object.fromEntries(Object.entries(c.pgu).map(([pg, m]) => [pg, Object.fromEntries(Object.entries(m).map(([k, n]) => [ix(k), n]))]));
p.flow = {}; for (const [k, v] of Object.entries(c.flow)) { const [cell, h, b] = k.split(','); const o = [v[0], v[1]]; for (let i = 2; i + 2 < v.length; i += 3) o.push(ix(v[i]), v[i + 1], v[i + 2]); (p.flow[cell] = p.flow[cell] || {})[h + b] = o; }
p.ap = AP;
const all = JSON.stringify(p);
fs.writeFileSync(outFile, all);
// ---- round trip through the userscript's own unpacker ---------------------------------------------------------------------------
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '03-data.js'), 'utf8');
const m = src.match(/\/\* ==UNPACKT2== \*\/([\s\S]*?)\/\* ==\/UNPACKT2== \*\//); if (!m) throw new Error('unpackT2 not found in 03-data.js');
const unpackT2 = new Function(m[1] + '; return unpackT2;')();
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const u = unpackT2(JSON.parse(all)), same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const bad = ['od2', 'odt', 'apd', 'seq', 'csr', 'aph', 'aps', 'pgu', 'flow'].filter(k => { const A = c[k], B = u[k]; if (Object.keys(A).length !== Object.keys(B).length) return true; for (const key of Object.keys(A)) if (!same(A[key], B[key])) return true; return false; });
console.log(bad.length ? 'ROUND TRIP MISMATCH: ' + bad.join(', ') : 'round trip ok');
const kb = s => (s.length / 1024).toFixed(0).padStart(6) + ' KB', gz = s => (zlib.gzipSync(s, { level: 9 }).length / 1024).toFixed(0).padStart(6) + ' KB gz';
for (const k of Object.keys(p)) if (p[k] && typeof p[k] === 'object') { const s = JSON.stringify(p[k]); console.log(k.padEnd(8), String(Object.keys(p[k]).length).padStart(7), kb(s), gz(s)); }
console.log('total   ', kb(all), gz(all), '-> base64', ((zlib.gzipSync(all, { level: 9 }).length * 4 / 3) / 1024).toFixed(0), 'KB in the script');
