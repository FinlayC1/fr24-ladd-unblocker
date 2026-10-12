// The odds shown, made honest: from held-out moments (pipe_eval DUMP=<file>: [hex, type, cls, t, O, D, top, p%, hit, ...])
// per class, the top choice's p -> how often it was right; isotonic (pool adjacent violators) over 5% bins, each bin pulled
// toward its own p by 30 pseudo-moments (sparse classes stay near what the engine says). Written into the logit file as
// `calib` (engine.calibrated). --check: fit on half the aircraft, report on the other half (stated vs right).
// usage: node test/mkcalib.cjs <dump.json> <logit.json> [--check] [--out=<file>]
const fs = require('fs');
const args = process.argv.slice(2), [dumpFile, logitFile] = args.filter(a => !a.startsWith('--'));
const CHECK = args.includes('--check'), OUT = (args.find(a => a.startsWith('--out=')) || '').slice(6) || logitFile;
const hexHash = hex => (parseInt(hex, 16) * 2654435761 >>> 0) % 1000003;
const rows = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
const NB = 20, M = 30;
function fit(rs) {
  const by = {};
  for (const r of rs) { const c = r[2], p = r[7] / 100, b = Math.min(NB - 1, Math.floor(p * NB)); const B = by[c] = by[c] || Array.from({ length: NB }, () => [0, 0, 0]); B[b][0]++; B[b][1] += r[8]; B[b][2] += p; }
  const out = {};
  for (const [c, B] of Object.entries(by)) {
    const n = B.reduce((s, x) => s + x[0], 0); if (n < 200) continue;
    // per bin: (hits + M * centre) / (k + M), weight k + M; then pool adjacent violators
    let blocks = B.map(([k, h], i) => { const ctr = (i + 0.5) / NB; return { w: k + M, v: (h + M * ctr) / (k + M), n: 1 }; });
    for (let changed = true; changed;) { changed = false; for (let i = 0; i + 1 < blocks.length; i++) if (blocks[i].v > blocks[i + 1].v) { const a = blocks[i], b = blocks[i + 1]; blocks.splice(i, 2, { w: a.w + b.w, v: (a.v * a.w + b.v * b.w) / (a.w + b.w), n: a.n + b.n }); changed = true; break; } }
    const vals = []; for (const bl of blocks) for (let j = 0; j < bl.n; j++) vals.push(Math.round(bl.v * 1000) / 1000);
    out[c] = vals;
  }
  return out;
}
const calOf = (cal, p, c) => { const v = cal[c]; if (!v) return p; const x = Math.max(0, Math.min(v.length - 1, (p - 0.025) / 0.05)), i = Math.floor(x), f = x - i; return i + 1 < v.length ? v[i] * (1 - f) + v[i + 1] * f : v[i]; };
function report(cal, rs, label) {
  const groups = { ALL: rs }; for (const r of rs) (groups[r[2]] = groups[r[2]] || []).push(r);
  console.log(`\n${label}: stated -> right (moments)   raw p | shown p   (Brier raw / shown)`);
  for (const [g, list] of Object.entries(groups)) {
    const bins = (f) => { const B = Array.from({ length: 10 }, () => [0, 0, 0]); for (const r of list) { const p = f(r), b = Math.min(9, Math.floor(p * 10)); B[b][0]++; B[b][1] += r[8]; B[b][2] += p; } return B; };
    const raw = bins(r => r[7] / 100), sh = bins(r => calOf(cal, r[7] / 100, r[2]));
    const brier = f => list.reduce((s, r) => s + (f(r) - r[8]) ** 2, 0) / list.length;
    const ece = B => B.reduce((s, [k, h, sp]) => s + (k ? Math.abs(h - sp) : 0), 0) / list.length;
    console.log(g.padEnd(10), String(list.length).padStart(7), ' gap raw', (100 * ece(raw)).toFixed(1).padStart(5) + '%', ' shown', (100 * ece(sh)).toFixed(1).padStart(5) + '%', '  Brier', brier(r => r[7] / 100).toFixed(4), '/', brier(r => calOf(cal, r[7] / 100, r[2])).toFixed(4));
    if (g === 'ALL' || list.length > 3000) console.log('   ', sh.map(([k, h, sp], i) => k ? `${i * 10}s:${Math.round(100 * sp / k)}->${Math.round(100 * h / k)}` : '').filter(Boolean).join('  '));
  }
}
if (CHECK) {
  const A = rows.filter(r => (hexHash(r[0]) >> 4) % 2 === 0), B = rows.filter(r => (hexHash(r[0]) >> 4) % 2 === 1);
  const cal = fit(A); report(cal, B, `fitted on ${A.length} moments, checked on the other ${B.length} (other aircraft)`);
} else {
  const cal = fit(rows); report(cal, rows, `fitted on all ${rows.length} moments`);
  const L = JSON.parse(fs.readFileSync(logitFile, 'utf8')); L.calib = cal; fs.writeFileSync(OUT, JSON.stringify(L));
  console.log('\ncalib written to', OUT, Object.keys(cal).join(' '));
}
