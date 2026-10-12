// How much does what a flight broadcasts early (squawk code, FMS-selected altitude) say about where it is going?
// Held-out log-loss: tables learned on one half of the airframes, scored on the other half.
// usage: node test/infogain.cjs <dataDir> [--sets=narrow,wide,biz]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const args = process.argv.slice(2), dataDir = args.find(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
const NOINFO = /^(1200|7000|2000|1000|7500|7600|7700|0000|2200|4000|0021|0022)$/;
const legs = [];
for (const set of opt('sets', 'narrow,wide,biz').split(',')) {
  for (const { ac, pts } of aircraft(dataDir, E, { set })) {
    const cls = E.classify(ac); if (cls === 'heli' || ac.mil) continue;
    for (const leg of E.legsFromPoints(pts, {})) {
      const s = E.summarizeLeg(leg, null);
      if (!s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 480) continue;
      const O = E.byId(s.from.id), D = E.byId(s.to.id); if (O.id === D.id) continue;
      let sq = '', fms = 0, sqAt = 0;
      for (const p of leg.pts) {
        if (p.t - s.tStart > 1200) break;
        if (!sq && p.sq && !NOINFO.test(p.sq) && p.alt > 1500) { sq = p.sq; sqAt = p.t - s.tStart; }
        if (p.fms > 5000 && p.fms > fms) fms = p.fms;
      }
      const km = E.dist(O.lat, O.lon, D.lat, D.lon);
      legs.push({ fold: parseInt(ac.hex, 16) % 2, oc: O.country, dc: D.country, km, sq, sqAt, fms, maxAlt: s.maxAlt, cls });
    }
  }
}
const tb = km => km < 150 ? 0 : km < 300 ? 1 : km < 600 ? 2 : km < 1000 ? 3 : km < 1800 ? 4 : km < 3000 ? 5 : km < 5000 ? 6 : 7;
console.log('legs', legs.length, 'with squawk', legs.filter(l => l.sq).length, 'with FMS alt', legs.filter(l => l.fms).length);
// held-out log-loss of target given key (Laplace-smoothed, backing off to the origin-country table)
function heldOut(target, key, label) {
  let ll = 0, llBase = 0, n = 0;
  for (const test of [0, 1]) {
    const cnt = new Map(), base = new Map(), vals = new Set(legs.map(target));
    for (const l of legs) { if (l.fold === test) continue; const k = key(l), b = l.oc; if (k != null) { const m = cnt.get(k) || new Map(); m.set(target(l), (m.get(target(l)) || 0) + 1); cnt.set(k, m); } const mb = base.get(b) || new Map(); mb.set(target(l), (mb.get(target(l)) || 0) + 1); base.set(b, mb); }
    const V = vals.size;
    const p = (m, v) => { let tot = 0; for (const x of m.values()) tot += x; return ((m.get(v) || 0) + 0.5) / (tot + 0.5 * V); };
    for (const l of legs) {
      if (l.fold !== test) continue; const k = key(l); if (k == null) continue;
      const mb = base.get(l.oc) || new Map(), m = cnt.get(k);
      const pb = p(mb, target(l));
      // key table blended with the origin-country table by how much data the key has
      let pk = pb; if (m) { let tot = 0; for (const x of m.values()) tot += x; const w = tot / (tot + 5); pk = w * p(m, target(l)) + (1 - w) * pb; }
      ll -= Math.log2(pk); llBase -= Math.log2(pb); n++;
    }
  }
  console.log(`${label.padEnd(46)} n ${String(n).padStart(6)}  base ${(llBase / n).toFixed(3)} bits  with ${(ll / n).toFixed(3)} bits  gain ${((llBase - ll) / n).toFixed(3)} bits`);
}
const sq2 = l => l.sq ? l.oc + '|' + l.sq.slice(0, 2) : null, sq4 = l => l.sq ? l.oc + '|' + l.sq : null;
const fmsB = l => l.fms ? l.oc + '|' + Math.round(l.fms / 2000) : null;
heldOut(l => tb(l.km), sq2, 'trip length | origin country + squawk 2 digits');
heldOut(l => tb(l.km), sq4, 'trip length | origin country + full squawk');
heldOut(l => tb(l.km), fmsB, 'trip length | origin country + early FMS alt');
heldOut(l => l.dc, sq2, 'dest country | origin country + squawk 2 digits');
heldOut(l => l.dc, sq4, 'dest country | origin country + full squawk');
heldOut(l => l.dc, fmsB, 'dest country | origin country + early FMS alt');
// by region: US vs Europe origins
for (const [name, f] of [['US', l => l.oc === 'United States'], ['non-US', l => l.oc !== 'United States']]) {
  const keep = legs.filter(f); const save = legs.splice(0, legs.length, ...keep);
  console.log('--', name, keep.length);
  heldOut(l => tb(l.km), sq2, 'trip length | squawk 2 digits');
  heldOut(l => tb(l.km), sq4, 'trip length | full squawk');
  heldOut(l => tb(l.km), fmsB, 'trip length | early FMS alt');
  heldOut(l => l.dc, sq4, 'dest country | full squawk');
  legs.splice(0, legs.length, ...save);
}
