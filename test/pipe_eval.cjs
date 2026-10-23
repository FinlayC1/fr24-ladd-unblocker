// The honest yardstick at scale: aircraft of the evaluation fold (hash % 10 == 0 - in no table, no weight), every flight
// of the last 22 days with both ends known, observed every 12 minutes of clock time (as random clicks on the map
// would), the full engine with every candidate. Buckets as test/diag_time.cjs; DUMP=<file> writes every moment.
// usage: node test/pipe_eval.cjs <dataDir> <tables: prefix of _tb/_t2 json, or 'old:<tb.json>'> <logit.json> [workers] [shards]
//   env: ENGINE_SRC (another engine), DAYS (22), PER_AC (6), AIRLINER (2), EVERY (12 min), CLS=piston,.. (only these),
//        HISTDAYS (history window, days), APL=<dir> (only the aircraft of <dir>/../apl_sample.json, with their older
//        days from <dir>/<hex>/<day>.json.gz added before the archive's - 7 months of history), DROP=csr,flow (those
//        population tables left out: what each is worth), T2FILE (another _t2 file, e.g. the trimmed one that ships),
//        LONGHIST=<dir> (the history of the aircraft with a file <dir>/<hex>.json - the monitor's /hist answer of it, up to
//        220 days of its log - in place of the archive's three weeks: what a browser has for a LADD aircraft; only those
//        aircraft evaluated), LONGONLY=1 (with LONGHIST: only the aircraft that have such a file), LONGSEL=1 (those aircraft
//        only, with the archive's history - the same moments, to compare)
//   the dump's rows: [hex, type, class, t, origin, truth, top, top p %, hit, minutes to go, trip km, flights of origin ->
//        truth before, landings at truth before, destinations flown to from origin before, truth's rank (0: not among the
//        candidates), truth's p %, landings at top before, flights before]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const A = require('./arch.cjs');
const hexHash = hex => (parseInt(hex, 16) * 2654435761 >>> 0) % 1000003;
// (SURGE=<daily.json> from test/mksurge.cjs: the event-surge evidence each moment's day would have had - engine.surgeOf)
function surgeAt(W, E, t) {
  if (!process.env.SURGE || !E.surgeOf) return null;
  if (!W.SG) W.SG = { daily: JSON.parse(fs.readFileSync(process.env.SURGE, 'utf8')), by: new Map() };
  const d = new Date(t * 1000).toISOString().slice(0, 10); let m = W.SG.by.get(d);
  if (!m) { m = E.surgeOf(W.SG.daily, d); W.SG.by.set(d, m); }
  return m;
}

// where an aircraft's fleet-mates (same owner) went in the 60 days before t0: airport id -> visits
function fleetMapOf(F, E, hex, ownOp, t0) { if (!F) return null; const k = E.ownerKey(ownOp), mates = k && F.owners[k]; if (!mates) return null; const m = new Map(); for (const h of mates) if (h !== hex) for (const [f, t, te] of F.legs[h] || []) if (te < t0 && t0 - te < 60 * 86400) { m.set(f, (m.get(f) || 0) + 1); m.set(t, (m.get(t) || 0) + 1); } return m.size ? m : null; }
function doShard(shard, W) {
  const { createRouteEngine } = require(W.engine || '../src/engine.js');
  const E = W.E || (W.E = (() => {
    const e = createRouteEngine();
    e.setAirports(JSON.parse(fs.readFileSync(path.join(W.dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(e, W.dataDir);
    e.setRunways(JSON.parse(fs.readFileSync(path.join(W.dataDir, 'runways.json'), 'utf8'))); e.setRunwayLengths(JSON.parse(fs.readFileSync(path.join(W.dataDir, 'runway_len.json'), 'utf8')));
    if (W.tables.startsWith('old:')) e.setTables(JSON.parse(fs.readFileSync(W.tables.slice(4), 'utf8')));
    else { e.setTables(JSON.parse(fs.readFileSync(W.tables + '_tb.json', 'utf8'))); if (e.setTables2) { let t2 = JSON.parse(fs.readFileSync(process.env.T2FILE || (W.tables + '_t2.json'), 'utf8')); if (t2.pk === 2) { const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '03-data.js'), 'utf8'), i0 = src.indexOf('/* ==UNPACKT2== */') + 18, i1 = src.indexOf('/* ==/UNPACKT2== */'); t2 = new Function(src.slice(i0, i1) + '; return unpackT2;')()(t2); } for (const k of (process.env.DROP || '').split(',').filter(Boolean)) delete t2[k]; e.setTables2(t2); } }
    W.FLEET = !W.tables.startsWith('old:') && fs.existsSync(W.tables + '_fleet.json') ? JSON.parse(fs.readFileSync(W.tables + '_fleet.json', 'utf8')) : null;
    e.setLogit(JSON.parse(fs.readFileSync(W.logit, 'utf8')));
    return e;
  })());
  const PER_AC = +(process.env.PER_AC || 6), AIRL = +(process.env.AIRLINER || 2), DAYS = +(process.env.DAYS || 22), EVERY = +(process.env.EVERY || 12) * 60, HD = +(process.env.HISTDAYS || 0);
  const ONLY = process.env.CLS ? new Set(process.env.CLS.split(',')) : null;
  const archDir = path.join(W.dataDir, 'arch'), runDays = A.dayPlan(archDir).run;
  const tFrom = Date.parse(runDays[runDays.length - 1] + 'T00:00:00Z') / 1000 - (DAYS - 1) * 86400;
  const st = {}, dump = [];
  const add = (k, v) => { const s = st[k] = st[k] || { n: 0, hit: 0, near: 0, reg: 0, far: 0, top3: 0, sp: 0 }; s.n++; for (const [a, b] of Object.entries(v)) s[a] += b; };
  for (let part = 0; part < 2; part++) {
    for (const { ac, pts: pts0 } of A.shardAircraft(archDir, shard, runDays, E, { parts: 2, part, want: W.aplSet })) {
      if (hexHash(ac.hex) % 10 !== 0) continue;
      let pts = pts0;
      if (W.apl) { const dir = path.join(W.apl, ac.hex), older = []; if (fs.existsSync(dir)) for (const fn of fs.readdirSync(dir).filter(x => x.endsWith('.json.gz')).sort()) { try { older.push(...E.parseTrace(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, fn))).toString('utf8')))); } catch (e) { /* none */ } } const t0 = pts0.length ? pts0[0].t : Infinity; pts = older.filter(p => p.t < t0 - 60).concat(pts0); }
      // (MILBIZ=1: only military aircraft of business-jet types - C-37, C-21, UC-35, EA-37B)
      if (process.env.MILBIZ && !(ac.mil && /^(heavybiz|bizjet)$/.test(E.classify(Object.assign({}, ac, { mil: false }))))) continue;
      const cls = E.classify(ac); if (ONLY && !ONLY.has(cls)) continue;
      const legs = E.legsFromPoints(pts, { heli: cls === 'heli', patrol: cls === 'fighter' || cls === 'milheavy' }), sums = legs.map(l => E.summarizeLeg(l, null));
      // (LONGHIST: the monitor's log of it - its days rebuilt from adsb.lol's archives - for the history)
      let longLegs = null;
      if (W.longHist) { try { const j = JSON.parse(fs.readFileSync(path.join(W.longHist, ac.hex + '.json'), 'utf8')); longLegs = (j && Array.isArray(j.legs)) ? j.legs : null; } catch (e) { longLegs = null; } }
      if (W.longOnly && !longLegs) continue;
      const chained = E.chainLegs(E.stitchLegs((W.longSel ? sums : longLegs || sums).map(x => Object.assign({}, x))));
      let used = 0;
      for (let li = legs.length - 1; li >= 0 && used < (cls === 'airliner' ? AIRL : PER_AC); li--) {
        const leg = legs[li], s = sums[li];
        if (s.tStart < tFrom || !s.from || !s.to || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 480) continue;
        used++;
        const D = E.byId(s.to.id), O = E.byId(s.from.id);
        const hs = E.histStats(chained.filter(h => h.tEnd < s.tStart - 60 && (!HD || h.tEnd > s.tStart - HD * 86400)), s.tStart), all = [leg.start].concat(leg.pts);
        for (let tt = s.tStart + 180 + (parseInt(ac.hex, 16) % 97) / 97 * EVERY; tt < s.tEnd - 120; tt += EVERY) {
          let idx = -1; for (let i = 0; i < all.length; i++) { if (all[i].t <= tt) idx = i; else break; }
          if (idx < 1 || all[idx].gnd) continue;
          const pos = all[idx], thin = []; for (const p of all.slice(0, idx + 1)) if (!thin.length || p.t - thin[thin.length - 1].t >= 20) thin.push(p);
          const r = E.predict({ ac, pos, trail: thin, hs, now: pos.t, surge: surgeAt(W, E, pos.t), fleet: fleetMapOf(W.FLEET, E, ac.hex, ac.ownOp, s.tStart) });
          const top = r && r.cands[0] && r.cands[0].airport; if (!top) continue;
          const near = a => a.id === D.id || E.dist(a.lat, a.lon, D.lat, D.lon) < 4;
          const hit = near(top), dd = E.dist(top.lat, top.lon, D.lat, D.lon), t3 = r.cands.slice(0, 3).some(c => near(c.airport)) ? 1 : 0;
          const togo = (s.tEnd - tt) / 60, tripKm = E.dist(O.lat, O.lon, D.lat, D.lon);
          const v = { hit: hit ? 1 : 0, near: !hit && dd < 80 ? 1 : 0, reg: !hit && dd >= 80 && dd < 600 ? 1 : 0, far: !hit && dd >= 600 ? 1 : 0, top3: t3, sp: r.cands[0].p };
          add('ALL', v); add('cls ' + cls, v);
          // (fixed type groups - the same moments whichever engine classifies them)
          { const t = String(ac.type || ''); const g = /^(GLF[456]|GL[578]T|GLEX|GA[5-8]C|FA7X|FA8X|FA6X|F900|CL6[045]|E35L|E550|ACJ|BBJ\d?)$/.test(t) ? 'large-cabin private' : /^(C25[ABCM]|C5[1-6]\w|C68A|C700|C750|E5[05]P|E545|LJ\d\d|H25[ABC]|HA4T|HDJT|F2TH|FA[125]0|ASTR|G150|G280|PRM1|PC24|SF50|EA50|CL30|CL35|BE40)$/.test(t) ? 'small-mid bizjet' : ''; if (g) add('types: ' + g, v); } if (ac.mil) add('military', v); if (ac.ladd) add('LADD', v);
          add('togo ' + (togo < 10 ? 'a <10' : togo < 30 ? 'b 10-30' : togo < 60 ? 'c 30-60' : togo < 120 ? 'd 60-120' : 'e 120+'), v);
          add('trip ' + (tripKm < 300 ? 'a <300' : tripKm < 1000 ? 'b 300-1000' : tripKm < 3000 ? 'c 1000-3000' : 'd 3000+'), v);
          add(D.id >= 1e7 ? 'truth: unlisted field' : 'truth: FR24 airport', v);
          add('history ' + (hs.n === 0 ? 'a none' : hs.n < 10 ? 'b 1-9' : hs.n < 40 ? 'c 10-39' : 'd 40+'), v);
          { const pb = Math.min(9, Math.floor(r.cands[0].p * 10)); add('calib p' + pb + '0', v); }
          if (E.calibrated) { const pc = E.calibrated(r.cands[0].p, cls); if (pc !== r.cands[0].p) add('shown p' + Math.min(9, Math.floor(pc * 10)) + '0', Object.assign({}, v, { sp: pc })); }
          if (W.dump) {
            const prior = chained.filter(h => h.tEnd < s.tStart - 60 && (!HD || h.tEnd > s.tStart - HD * 86400) && h.from && h.to);
            const nRoute = prior.filter(h => h.from.id === O.id && h.to.id === D.id).length, nDest = prior.filter(h => h.to.id === D.id).length, nOut = new Set(prior.filter(h => h.from.id === O.id).map(h => h.to.id)).size;
            const ti = r.cands.findIndex(c => near(c.airport)), nTop = prior.filter(h => h.to.id === top.id).length;
            dump.push([ac.hex, ac.type, cls, Math.round(pos.t), O.code, D.code, top.code, Math.round(r.cands[0].p * 100), hit ? 1 : 0, Math.round(togo), Math.round(tripKm), nRoute, nDest, nOut, ti + 1, ti >= 0 ? Math.round(r.cands[ti].p * 100) : 0, nTop, prior.length]);
          }
        }
      }
    }
  }
  return { st, dump };
}

if (isMainThread) {
  const [dataDir, tables, logit, nw = '12', shardArg = 'all'] = process.argv.slice(2);
  const todo = shardArg === 'all' ? A.SHARDS.slice() : shardArg.split(',');
  const total = {}, dumps = []; let done = 0; const t0 = Date.now();
  const run = () => new Promise(res => {
    const w = new Worker(__filename, { workerData: { dataDir, tables, logit, engine: process.env.ENGINE_SRC ? path.resolve(process.env.ENGINE_SRC) : null, dump: !!process.env.DUMP, apl: process.env.APL || null, longHist: process.env.LONGHIST || null, longOnly: !!process.env.LONGONLY, longSel: !!process.env.LONGSEL }, resourceLimits: { maxOldGenerationSizeMb: 3500 } });
    const next = () => { const s = todo.shift(); if (!s) { w.terminate(); return res(); } w.postMessage(s); };
    w.on('message', m => { done++; for (const [k, s] of Object.entries(m.st)) { const t = total[k] = total[k] || { n: 0, hit: 0, near: 0, reg: 0, far: 0, top3: 0, sp: 0 }; for (const a of Object.keys(t)) t[a] += s[a]; } if (m.dump) dumps.push(...m.dump); if (done % 32 === 0) console.error(new Date().toISOString().slice(11, 19), 'shards', done, 'moments', (total.ALL || {}).n, Math.round((Date.now() - t0) / 1000) + ' s'); next(); });
    w.on('error', e => { console.error('worker error', e); res(); });
    next();
  });
  Promise.all(Array.from({ length: Math.min(+nw, os.cpus().length) }, run)).then(() => {
    const pc = (a, n) => (100 * a / n).toFixed(1).padStart(5) + '%';
    console.log('bucket                    n    right  top3   wrong<80km  80-600km  600km+  mean p');
    for (const k of Object.keys(total).sort()) { const s = total[k]; console.log(k.padEnd(22), String(s.n).padStart(7), pc(s.hit, s.n), pc(s.top3, s.n), '  ', pc(s.near, s.n), '  ', pc(s.reg, s.n), ' ', pc(s.far, s.n), ' ', pc(s.sp, s.n)); }
    if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(dumps));
  });
} else {
  const W = Object.assign({}, workerData);
  if (W.apl) W.aplSet = new Set(JSON.parse(fs.readFileSync(path.join(W.apl, '..', 'apl_sample.json'), 'utf8')).map(a => a.hex));
  parentPort.on('message', s => { try { parentPort.postMessage(doShard(s, W)); } catch (e) { console.error('shard', s, e.stack); parentPort.postMessage({ st: {}, dump: [] }); } });
}
