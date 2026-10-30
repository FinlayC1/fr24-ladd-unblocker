// The population tables as the monitor loads them (1.1.0: the userscript carries none): src/tables2.json unpacked a slice
// at a time by the userscript's own unpackT2Steps (the UNPACKT2 block of src/main/03-data.js, as monitor/central.cjs reads
// it) must give exactly the tables unpackT2 gives at once, and no slice may hold the monitor's main thread for long (a
// quarter of a second: it is done once, at start - the browsers' requests answered in between).
// usage: node test/t2_load.cjs
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const C = require(path.join(root, 'monitor', 'central.cjs'));
const src = fs.readFileSync(path.join(root, 'src', 'main', '03-data.js'), 'utf8');
const i0 = src.indexOf('/* ==UNPACKT2== */'), i1 = src.indexOf('/* ==/UNPACKT2== */');
if (i0 < 0 || i1 < i0) throw new Error('03-data.js: UNPACKT2 marks missing');
const F = new Function(src.slice(i0 + 18, i1) + '; return { unpackT2, unpackT2Steps };')();
const packed = JSON.parse(fs.readFileSync(path.join(root, 'src', 'tables2.json'), 'utf8'));
if (packed.pk !== 2) throw new Error('src/tables2.json is not packed (pk 2)');
let worst = 0, slices = 0;
const sliced = it => { for (;;) { const t0 = process.hrtime.bigint(); let done = false; while (Number(process.hrtime.bigint() - t0) / 1e6 < 8) if (it.next().done) { done = true; break; } const ms = Number(process.hrtime.bigint() - t0) / 1e6; slices++; if (ms > worst) worst = ms; if (done) return; } };
const t0 = Date.now();
const t = {}; sliced(F.unpackT2Steps(JSON.parse(JSON.stringify(packed)), t));
const total = Date.now() - t0;
const ref = F.unpackT2(JSON.parse(JSON.stringify(packed)));
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const bad = Object.keys(ref).filter(k => JSON.stringify(canon(ref[k])) !== JSON.stringify(canon(t[k])));
// (and the monitor's own loader - central.cjs - the very function it starts with: the tables in an engine)
const { createRouteEngine } = require(path.join(root, 'src', 'engine.js'));
const E = createRouteEngine();
C.loadTables(E, path.join(root, 'src'), path.join(root, 'src', 'main')).then(() => {
  const same = !!E.T2 && Object.keys(ref).every(k => JSON.stringify(canon(ref[k])) === JSON.stringify(canon(E.T2[k])));
  console.log(bad.length ? 'MISMATCH: ' + bad.join(', ') : 'sliced load = unpackT2: ok', '|', slices, 'slices, longest', worst.toFixed(1), 'ms, total', total, 'ms |', same ? 'the monitor\'s loader: the same tables' : 'the monitor\'s loader: DIFFERENT');
  process.exitCode = bad.length || worst > 250 || !same ? 1 : 0;
});
