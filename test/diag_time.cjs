// Where do the misses come from? Clock-time sampling, held-out weights; buckets by time to landing and how far the
// top pick is from the real destination (same area / same region / elsewhere).
// usage: node test/diag_time.cjs <dataDir> <tables prefix> <logit prefix> <runways.json> [every]
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require(process.env.ENGINE_SRC || '../src/engine.js');
const { aircraft } = require('./dataset.cjs');
const [dataDir, tbl, lg, rw, everyArg] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows, RW = JSON.parse(fs.readFileSync(rw, 'utf8'));
const engines = [0, 1].map(k => { const E = createRouteEngine(); E.setAirports(rows); require('./dataset.cjs').withFields(E, dataDir); E.setRunways(RW); E.setTables(JSON.parse(fs.readFileSync(`${tbl}_f${k}.json`, 'utf8'))); E.setLogit(JSON.parse(fs.readFileSync(`${lg}_f${k}.json`, 'utf8'))); if (process.env.W) E.setWeights(JSON.parse(process.env.W)); if (process.env.RWLEN) E.setRunwayLengths(JSON.parse(fs.readFileSync(process.env.RWLEN, 'utf8'))); return E; });
const { buildFleetIndex, fleetMap } = require('./fleet.cjs');
const FLEET = process.env.FLEET ? buildFleetIndex(dataDir, engines[0], (process.env.SETS || 'wide,biz').split(',')) : null;
const every = +(everyArg || 4); let lc = 0;
// (which legs are sampled depends on the leg itself - aircraft and take-off time - so two engines that split legs a little
// differently are scored on the same flights)
const legPick = (hex, t) => { let h = 2166136261; for (const ch of hex + ':' + Math.round(t / 600)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const st = {}, add = (k, v) => { const s = st[k] = st[k] || { n: 0, hit: 0, near: 0, reg: 0, far: 0, cand: 0 }; s.n++; for (const [a, b] of Object.entries(v)) s[a] += b; };
const samples = [], dseen = new Set(), DUMP = [];
// ONLYNEW=1: only aircraft outside the earlier sets (sample, wide, biz) - unseen by engines trained on those
const OLD = new Set(['sample.json', 'wide_sample.json', 'biz_sample.json'].flatMap(f => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')).map(a => a.hex); } catch (e) { return []; } }));
for (const set of (process.env.SETS || 'wide,biz').split(',')) for (const { ac, pts } of aircraft(dataDir, engines[0], { set, filter: a => (!process.env.HOLDOUT || parseInt(a.hex, 16) % 5 === 0) && (process.env.FOLD == null || parseInt(a.hex, 16) % 2 === +process.env.FOLD) && (!process.env.ONLYNEW || !OLD.has(a.hex)) })) {
  if (dseen.has(ac.hex)) continue; dseen.add(ac.hex);
  const E = engines[parseInt(ac.hex, 16) % 2], cls = E.classify(ac);
  if (process.env.CLS && !process.env.CLS.split(',').includes(cls)) continue;
  const legs = E.legsFromPoints(pts, { heli: cls === 'heli' }), sums = legs.map(l => E.summarizeLeg(l, null));
  const hist = E.chainLegs(E.stitchLegs(sums.map(s => Object.assign({}, s))));
  let used = 0;
  for (let li = legs.length - 1; li >= 0 && used < 6; li--) {
    const leg = legs[li], s = sums[li];
    if (!s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 480) continue;
    if (process.env.LCOUNT ? (lc++ % every) !== 0 : legPick(ac.hex, s.tStart) % every !== 0) continue; used++;
    const D = E.byId(s.to.id), O = E.byId(s.from.id), hs = E.histStats(hist.filter(h => h.tEnd < s.tStart - 60), s.tStart), all = [leg.start].concat(leg.pts);
    for (let tt = s.tStart + 180 + (parseInt(ac.hex, 16) % 97) / 97 * 720; tt < s.tEnd - 120; tt += 720) {
      let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
      if (idx < 1 || all[idx].gnd) continue;
      // (MIDSEEN=<min>: first seen that many minutes after take-off - coverage starting mid-flight, the origin unknown)
      const seen0 = s.tStart + (+process.env.MIDSEEN || 0) * 60; if (all[idx].t < seen0 + 60) continue;
      const pos = all[idx], thin = []; for (const p of all.slice(0, idx + 1)) if (p.t >= seen0 && (!thin.length || p.t - thin[thin.length - 1].t >= 20)) thin.push(p);
      const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, explain: true, explainIds: [D.id], fleet: FLEET ? fleetMap(FLEET, ac.hex, s.tStart) : null });
      const top = r && r.cands[0] && r.cands[0].airport; if (!top) continue;
      const hit = top.id === D.id || E.dist(top.lat, top.lon, D.lat, D.lon) < 4, dd = E.dist(top.lat, top.lon, D.lat, D.lon);
      if (process.env.DUMP) {
        const off = a => Number.isFinite(pos.trk) ? Math.round(E.angDiff(pos.trk, E.brg(pos.lat, pos.lon, a.lat, a.lon))) : null;
        DUMP.push({ cls, type: ac.type, reg: ac.reg, hex: ac.hex, hit: hit ? 1 : 0, dd: Math.round(dd), dTop: Math.round(E.dist(pos.lat, pos.lon, top.lat, top.lon)), dTruth: Math.round(E.dist(pos.lat, pos.lon, D.lat, D.lon)), offTop: off(top), offTruth: off(D), orig: r.origin && r.origin.airport ? r.origin.airport.code : '', oconf: r.origin ? r.origin.conf : '', trueO: O.code, top: top.code, truth: D.code, p: Math.round(r.cands[0].p * 100), rank: (r.explained[0] || {}).rank, phase: r.phase, alt: pos.alt, gs: Math.round(pos.gs || 0), el: Math.round((pos.t - s.tStart) / 60), togo: Math.round((s.tEnd - tt) / 60), trip: Math.round(E.dist(O.lat, O.lon, D.lat, D.lon)), hsn: hs.n, lat: +pos.lat.toFixed(2), lon: +pos.lon.toFixed(2) });
      }
      const togo = (s.tEnd - tt) / 60, tb = togo < 10 ? 'a <10' : togo < 30 ? 'b 10-30' : togo < 60 ? 'c 30-60' : togo < 120 ? 'd 60-120' : 'e 120+';
      const v = { hit: hit ? 1 : 0, near: !hit && dd < 80 ? 1 : 0, reg: !hit && dd >= 80 && dd < 600 ? 1 : 0, far: !hit && dd >= 600 ? 1 : 0, cand: (r.explained || []).length ? 1 : 0 };
      add('togo ' + tb, v); add('ALL', v); add(D.id >= 1e7 ? 'truth: unlisted field' : 'truth: FR24 airport', v); if (!hit && top.id >= 1e7) add('picked an unlisted field (wrong)', v);
      if (process.env.CALIB) { const pb = Math.min(9, Math.floor(r.cands[0].p * 10)); const hasBase = hs.base && hs.base === top.id; add('calib p' + pb + '0-' + (pb + 1) + '0' + (process.env.CALIB === 'base' ? (hasBase ? ' base' : ' other') : ''), v); st['calib p' + pb + '0-' + (pb + 1) + '0' + (process.env.CALIB === 'base' ? (hasBase ? ' base' : ' other') : '')].sp = (st['calib p' + pb + '0-' + (pb + 1) + '0' + (process.env.CALIB === 'base' ? (hasBase ? ' base' : ' other') : '')].sp || 0) + r.cands[0].p; } if (process.env.CLS) add('cls ' + cls, v);
      const tripKm = E.dist(O.lat, O.lon, D.lat, D.lon); add('trip ' + (tripKm < 300 ? 'a <300' : tripKm < 1000 ? 'b 300-1000' : tripKm < 3000 ? 'c 1000-3000' : 'd 3000+'), v);
      if (!hit && togo >= 60) samples.push({ reg: ac.reg, type: ac.type, route: O.code + '>' + D.code, trip: Math.round(tripKm), togo: Math.round(togo), got: r.cands.slice(0, 3).map(c => c.airport.code + ' ' + Math.round(c.p * 100)).join(' / '), truthRank: (r.explained[0] || {}).rank, dd: Math.round(dd) });
    }
  }
}
const pc = (a, n) => (100 * a / n).toFixed(1).padStart(5) + '%';
console.log('bucket               n    right  wrong<80km  80-600km  600km+  truth-considered');
for (const k of Object.keys(st).sort()) { const s = st[k]; console.log(k.padEnd(22) + (s.sp ? ' mean p ' + (100 * s.sp / s.n).toFixed(1) + '%' : ''), String(s.n).padStart(6), pc(s.hit, s.n), pc(s.near, s.n), '  ', pc(s.reg, s.n), ' ', pc(s.far, s.n), '  ', pc(s.cand, s.n)); }
for (const x of samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / 30)) === 0).slice(0, 30)) console.log(' ', x.reg.padEnd(7), x.type.padEnd(5), x.route.padEnd(10), String(x.trip).padStart(5) + 'km togo', String(x.togo).padStart(4), 'got', x.got.padEnd(28), 'truth rank', x.truthRank, 'top is', x.dd, 'km off');
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(DUMP));
