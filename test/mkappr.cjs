// The arrival-path table the script carries (src/approach.json, packed by build.mjs): the cells of a full
// test/pipe_appr.cjs table at the share and traffic test/appr_eval.cjs chose on held-out aircraft.
// usage: node test/mkappr.cjs <full table.json> <out.json> <share> <traffic> [highShare:highTraffic]
//   (v3 tables: a cell above 10,000 ft kept only at the stricter high share and traffic - far out, one airport's
//   descent can still be another's: CDG and Orly at FL220)
const fs = require('fs');
const [inF, outF, thr, minN, high] = process.argv.slice(2);
const t = JSON.parse(fs.readFileSync(inF, 'utf8')), cells = {}, H = high ? high.split(':').map(Number) : null;
const bandOf = k => Math.floor(k / 144) % 32;      // (engine apprKey, v3: ((((pos * 32 + band) * 16 + sector) * 3 + vs) * 3 + group)
let kept = 0;
for (const [k, c] of Object.entries(t.cells)) {
  if (!(c[2] >= +minN && c[1] / c[2] >= +thr)) continue;
  if (H && t.bin && t.bin.v >= 3 && bandOf(+k) >= 10 && !(c[2] >= H[1] && c[1] / c[2] >= H[0])) continue;
  cells[k] = c; kept++;
}
fs.writeFileSync(outF, JSON.stringify(Object.assign({}, t, { thr: +thr, minN: +minN, high: H, cells })));
console.log(`kept ${kept} of ${Object.keys(t.cells).length} cells (share >= ${thr}, traffic >= ${minN}${H ? `, above 10,000 ft ${H[0]} / ${H[1]}` : ''}) -> ${outF}, ${Math.round(fs.statSync(outF).size / 1024)} KB`);
