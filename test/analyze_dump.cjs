// What the misses in a diag_time DUMP look like: "going where it's pointing" - an airport far ahead on its track
// picked while the real destination was much nearer - against the other kinds of miss.
// usage: node test/analyze_dump.cjs <dump.json> [cls filter]
const fs = require('fs');
const [file, clsF] = process.argv.slice(2);
let D = JSON.parse(fs.readFileSync(file, 'utf8'));
if (clsF) D = D.filter(x => clsF.split(',').includes(x.cls));
const pc = (a, n) => n ? (100 * a / n).toFixed(1) + '%' : '-';
const n = D.length, hit = D.filter(x => x.hit).length;
console.log(`moments ${n}, right ${pc(hit, n)}`);
const miss = D.filter(x => !x.hit);
const kind = x => {
  if (x.hit) return 'right';
  if (x.dd < 30) return 'next door (<30 km off)';
  if (x.offTop != null && x.offTop < 25 && x.dTop > x.dTruth + 100) return 'POINTING: far ahead on its track, truth nearer';
  if (x.dTop + 100 < x.dTruth) return 'too near: truth further on';
  if (x.top === x.orig) return 'said back home / origin';
  return 'other airport';
};
const by = {}; for (const x of D) { const k = kind(x); by[k] = (by[k] || 0) + 1; }
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log('  ', k.padEnd(48), String(v).padStart(6), pc(v, n));
const point = miss.filter(x => kind(x).startsWith('POINTING'));
const grp = (arr, f) => { const g = {}; for (const x of arr) { const k = f(x); g[k] = (g[k] || 0) + 1; } return Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${pc(v, arr.length)})`).join(', '); };
console.log('pointing misses by: origin known?', grp(point, x => x.orig ? (x.orig === x.trueO ? 'right origin' : 'wrong origin') : 'no origin'));
console.log('  history legs', grp(point, x => x.hsn === 0 ? '0' : x.hsn < 5 ? '1-4' : x.hsn < 20 ? '5-19' : '20+'));
console.log('  phase', grp(point, x => x.phase), ' | minutes flown', grp(point, x => x.el < 15 ? '<15' : x.el < 45 ? '15-45' : '45+'));
console.log('  truth distance', grp(point, x => x.dTruth < 50 ? '<50 km' : x.dTruth < 150 ? '50-150' : '150+'), ' | pick distance', grp(point, x => x.dTop < 200 ? '<200 km' : x.dTop < 500 ? '200-500' : '500+'));
console.log('  truth is its origin (a local flight)', pc(point.filter(x => x.truth === x.trueO).length, point.length));
console.log('all moments: truth is the origin', pc(D.filter(x => x.truth === x.trueO).length, n), '| right when it was', pc(D.filter(x => x.truth === x.trueO && x.hit).length, D.filter(x => x.truth === x.trueO).length));
for (const x of point.filter((_, i) => i % Math.max(1, Math.floor(point.length / 25)) === 0).slice(0, 25)) console.log(`   ${x.reg.padEnd(8)} ${x.type.padEnd(5)} ${x.trueO}>${x.truth} (trip ${x.trip} km) at ${x.alt} ft ${x.phase} ${x.el} min in: picked ${x.top} ${x.p}% ${x.dTop} km ahead (off ${x.offTop}°), truth ${x.dTruth} km (off ${x.offTruth}°) rank ${x.rank}, origin ${x.orig || '-'}`);
