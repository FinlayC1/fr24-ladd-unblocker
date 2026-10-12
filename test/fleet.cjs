// Fleet history for training / testing: every aircraft's completed flights, grouped by (normalised) owner, so that a
// prediction can see where the aircraft's fleet-mates have been in the 60 days before it - as the userscript does from
// the logs it keeps.
const { aircraft } = require('./dataset.cjs');
function buildFleetIndex(dataDir, E, sets) {
  const byOwner = new Map(), legs = new Map(), ownerOf = new Map();
  for (const set of sets) for (const { ac, pts } of aircraft(dataDir, E, { set })) {
    if (legs.has(ac.hex)) continue;
    const key = E.ownerKey(ac.ownOp); if (!key) continue;
    const cls = E.classify(ac);
    const l = E.legsFromPoints(pts, { heli: cls === 'heli' }).map(x => E.summarizeLeg(x, null)).filter(s => s.from && s.to && s.from.id !== s.to.id).map(s => [s.from.id, s.to.id, s.tEnd]);
    legs.set(ac.hex, l); ownerOf.set(ac.hex, key); (byOwner.get(key) || byOwner.set(key, []).get(key)).push(ac.hex);
  }
  // a "fleet" of more than 15 is a programme or a lessor, not one operator's habits
  for (const [k, v] of byOwner) if (v.length < 2 || v.length > 15) byOwner.delete(k);
  return { byOwner, legs, ownerOf };
}
function fleetMap(ix, hex, t0) {
  const key = ix.ownerOf.get(hex), mates = key && ix.byOwner.get(key); if (!mates) return null;
  const m = new Map();
  for (const h of mates) if (h !== hex) for (const [f, t, te] of ix.legs.get(h) || []) if (te < t0 && t0 - te < 60 * 86400) { m.set(f, (m.get(f) || 0) + 1); m.set(t, (m.get(t) || 0) + 1); }
  return m.size ? m : null;
}
module.exports = { buildFleetIndex, fleetMap };
