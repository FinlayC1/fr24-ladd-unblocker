// Summary of a V8 .cpuprofile: self and inclusive time per function (name:line), top N.
// usage: node test/profsum.cjs <file.cpuprofile> [N=40] [filter regex on the stack, e.g. quickRouteAll]
const fs = require('fs');
const [file, nArg = '40', filt] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map(n => [n.id, n])), parent = new Map();
for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
const key = n => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}${/user\.js|eval|VM/.test(n.callFrame.url) || !n.callFrame.url ? '' : ' ' + n.callFrame.url.split(/[\\/]/).pop()}`;
const self = new Map(), incl = new Map(); let total = 0, kept = 0;
const re = filt ? new RegExp(filt) : null;
for (let i = 0; i < p.samples.length; i++) {
  const dt = (p.timeDeltas[i + 1] || 0) / 1000; total += dt;
  let n = byId.get(p.samples[i]); const stack = []; while (n) { stack.push(n); n = byId.get(parent.get(n.id)); }
  const keys = stack.map(key);
  if (re && !keys.some(k => re.test(k))) continue;
  kept += dt;
  self.set(keys[0], (self.get(keys[0]) || 0) + dt);
  for (const k of new Set(keys)) incl.set(k, (incl.get(k) || 0) + dt);
}
const N = +nArg, fmt = m => [...m].filter(([k]) => !/^\((root|program|idle|garbage collector)\)/.test(k) || true).sort((a, b) => b[1] - a[1]).slice(0, N).map(([k, v]) => `  ${(v / 1000).toFixed(2).padStart(7)} s  ${k}`).join('\n');
console.log(`total ${(total / 1000).toFixed(1)} s sampled${re ? `, ${(kept / 1000).toFixed(2)} s with ${filt} on the stack` : ''}\n-- self --\n${fmt(self)}\n-- inclusive --\n${fmt(incl)}`);
