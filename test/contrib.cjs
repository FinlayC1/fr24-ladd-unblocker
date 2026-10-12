// What one aircraft adds to the count tables - so the tables are the sum over aircraft (test/pipe_tables.cjs) and an
// aircraft's own share can be taken out again while its flights are being predicted (test/pipe_examples.cjs): a route
// it flew must not count as "a route others fly" when its own next flight on it is the question.
// A flight record (test/pipe_legs.cjs): [tStart, tEnd, fromId, toId, fromConf, toConf, maxAlt, pathKm, cs, how, laps,
//   ended, stats, squawk blocks, FMS levels]; conf 1 ground, 2 low, 3 near, 4 chain.
const GRP = { bizjet: 0, heavybiz: 0, airliner: 1, turboprop: 2, piston: 3, heli: 4, fighter: 5, milheavy: 5, unknown: 1 };
const grpOf = (cls, mil) => mil && cls !== 'bizjet' && cls !== 'heavybiz' ? 5 : (GRP[cls] != null ? GRP[cls] : 1);
const g4 = g => g === 0 || g === 2 ? 0 : g === 1 ? 1 : g === 3 || g === 4 ? 2 : 3;
const SQ_NOINFO = /^(1200|7000|2000|1000|7500|7600|7700|0000|2200|4000|0021|0022)$/;
// acRow: [reg, type, flags, cat, country, year, ownOp, nDays, cls]
function contrib(E, acRow, recs, flow) {
  const [reg, type, flags, , , , , , cls] = acRow, mil = !!(flags & 1);
  const g = grpOf(cls, mil), gg = g4(g), pg = E.pgrpOf(cls, type), milU = mil && cls !== 'bizjet' && cls !== 'heavybiz';
  const ic = id => { const a = E.byId(id); return a && a.icao ? a.icao.toUpperCase() : ''; };
  const tz = id => { const a = E.byId(id); return a && a.tz != null ? a.tz : null; };
  const out = { od2: [], odt: [], apd: [], seq: [], aph: [], apmon: [], pgu: [], csr: [], usage: [], od: [], sq: [], sqBase: [], fms: [], fmsBase: [], flow: [], rwy: [] };
  const known = recs.filter(l => l[2] && l[3] && (l[4] === 1 || l[4] === 2) && (l[5] === 1 || l[5] === 2)).sort((x, y) => x[0] - y[0]);
  const visited = new Map(), pairs = new Map();
  const regCs = String(reg || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  for (let i = 0; i < known.length; i++) {
    const l = known[i], O = l[2], D = l[3], oi = ic(O), di = ic(D);
    for (const x of [oi, di]) if (x) out.pgu.push([pg, x]);
    if (l[1] - l[0] >= 480) for (const id of [O, D]) visited.set(id, (visited.get(id) || 0) + 1);
    if (O === D) continue;
    if (oi && di) {
      out.od2.push([oi + '>' + di, g]);
      if (l[1] - l[0] >= 480) { const k = oi < di ? oi + '|' + di : di + '|' + oi; pairs.set(k, (pairs.get(k) || 0) + 1); }
    }
    const tO = tz(O), tD = tz(D);
    if (oi && di && g !== 1 && tO != null) { const dl = new Date((l[0] + tO) * 1000), dow = dl.getUTCDay(), hb = 7 + Math.floor(dl.getUTCHours() / 4); out.odt.push([oi + '>' + di, dow], [oi + '>' + di, hb]); out.apd.push([oi, dow], [oi, hb]); }
    if (di && tD != null) out.aph.push([di, gg * 6 + Math.floor(((((l[1] + tD) / 3600) % 24) + 24) % 24 / 4)]);
    if (di) out.apmon.push([di, gg * 12 + new Date(l[1] * 1000).getUTCMonth()]);
    const p = known[i - 1];
    if (p && p[3] === O && l[0] - p[1] < 3 * 86400 && p[2] !== O) { const xi = ic(p[2]); if (xi && oi && di) out.seq.push([(g === 1 ? 'a:' : '') + xi + '>' + oi + '>' + di]); }
    const cs = String(l[8] || '').trim().toUpperCase();
    if (cs && oi && di && cs !== regCs && /[0-9]/.test(cs)) out.csr.push([cs, oi + '>' + di]);
    const Da = E.byId(D); if (Da && Da.rwl && type && l[5] === 1) out.rwy.push([type, Da.rwl[0], Da.rwl[3] || 0]);
    // transponder code block / FMS level against the trip length, per origin country (not military)
    const Oa = E.byId(O);
    if (!milU && Oa && Oa.country && Da) {
      const b = E.tripBin(E.dist(Oa.lat, Oa.lon, Da.lat, Da.lon));
      const sqs = l[13] || [], fmss = l[14] || [];
      if (sqs.length) { out.sqBase.push([Oa.country, b]); for (const s of sqs) out.sq.push([Oa.country + '|' + s, b]); }
      if (fmss.length) { out.fmsBase.push([Oa.country, b]); for (const s of fmss) out.fms.push([Oa.country + '|' + s, b]); }
    }
  }
  // airport usage (one aircraft counts log2(1 + visits) at a field, so no single aircraft dominates) and the
  // business-aviation pairs (either direction), as the engine's usage prior and 'od' evidence read them
  const kind = milU ? 'useMil' : (cls === 'piston' || cls === 'heli') ? 'useGA' : 'use';
  const kind2 = milU ? null : cls === 'heavybiz' || cls === 'airliner' ? 'useHB' : cls === 'bizjet' ? 'useLJ' : null;
  for (const [id, n] of visited) { const x = ic(id); if (!x) continue; out.usage.push([kind, x, Math.log2(1 + n)]); if (kind2) out.usage.push([kind2, x, Math.log2(1 + n)]); }
  if (!milU && cls !== 'piston' && cls !== 'heli') for (const [k, n] of pairs) out.od.push([k, Math.log2(1 + n)]);
  // flow-field samples: [key, destination id] -> counted as non-airline (0) or airline (1)
  for (const [k, d] of flow || []) { const x = ic(d); if (x) out.flow.push([k, x, cls === 'airliner' && !mil ? 1 : 0]); }
  return out;
}
module.exports = { contrib, grpOf, g4, SQ_NOINFO };
