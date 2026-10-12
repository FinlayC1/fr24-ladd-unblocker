// The learned arrival paths (test/pipe_appr.cjs, built with FOLD=0) judged on the aircraft of that fold, which the table
// never saw: at every point below its ceiling of every flight - landing within 45 minutes or not - would a cell's
// dominant airport confirm the right one? Per flight, the first time it fires; per threshold of share and traffic, with
// one point in such a cell ("1pt") or two, 20 s to 3 minutes apart, for the same airport ("2pt" - what the script uses).
// usage: node test/appr_eval.cjs <dataDir> <table.json> [days=7] [shards=05,45,85,c5,25,65,a5,e5]
const fs = require('fs');
const path = require('path');
const A = require('./arch.cjs');
const { binOf, BIN, apprGroup } = require('./pipe_appr.cjs');
const [dataDir, tableFile, nDays = '7', shardArg = '05,45,85,c5,25,65,a5,e5,15,55,95,d5'] = process.argv.slice(2);
const { createRouteEngine } = require('../src/engine.js');
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8')));
const T = JSON.parse(fs.readFileSync(tableFile, 'utf8')).cells;
const days = A.dayPlan(path.join(dataDir, 'arch')).run.slice(-(+nDays));
const hexHash = h => (parseInt(h, 16) * 2654435761 >>> 0) % 1000003;
const TH = (process.env.TH || '0.95:12,0.97:20,0.98:20,0.98:40,0.99:30').split(',').map(s => s.split(':').map(Number));
// ("mix": two fixes, or one alone in a cell this sure and this busy - STRONG=share:traffic)
const MODES = ['1pt', '2pt', 'mix'], [STRONG_S, STRONG_N] = (process.env.STRONG || '0.998:80').split(':').map(Number);
// (HIGH=share:traffic: what a cell above 10,000 ft must meet besides)
const HIGH = process.env.HIGH ? process.env.HIGH.split(':').map(Number) : null;
const mk = () => ({ legs: 0, fired: 0, right: 0, wrongLanded: 0, wrongNoLand: 0, lost: 0, km: [], byCls: {} });
const st = TH.map(() => MODES.map(mk)), ex = [];
let legsLanding = 0;
for (const sh of shardArg.split(',')) for (const { ac, pts } of A.shardAircraft(path.join(dataDir, 'arch'), sh, days, E)) {
  if (hexHash(ac.hex) % 10 !== 0) continue;
  const cls = E.classify(ac), g = apprGroup(cls);
  if (g < 0 || (process.env.GROUPS && !process.env.GROUPS.split(',').includes(String(g)))) continue;
  let legs; try { legs = E.legsFromPoints(pts.map(p => Object.assign({}, p)), { heli: false, patrol: cls === 'fighter' || cls === 'milheavy', cls, type: ac.type, rangeKm: E.typeRangeKm(ac) }); } catch (e) { continue; }
  for (const l of legs) {
    let s; try { s = E.summarizeLeg(l, { cls, type: ac.type, grp: E.groupOf(cls), mil: ac.mil }); } catch (e) { continue; }
    const landed = s.ended && s.to && ['ground', 'low'].includes(s.to.conf), D = landed && s.to.id < 1e7 ? E.byId(s.to.id) : null;
    if (D) legsLanding++;
    TH.forEach(([thr, minN], ti) => MODES.forEach((mode, mi) => {
      const S = st[ti][mi]; let first = null, prev = null;
      let qi = 0;
      for (let pi = 0; pi < l.pts.length; pi++) {
        const p = l.pts[pi];
        while (qi + 1 < pi && p.t - l.pts[qi + 1].t >= 10) qi++;
        if (p.gnd || p.alt == null || p.alt < 0 || p.alt >= BIN.top || p.trk == null) continue;
        const q = qi < pi && p.t - l.pts[qi].t >= 10 && p.t - l.pts[qi].t <= 120 ? l.pts[qi] : null;
        const key = binOf(p, g, q), c = key == null ? null : T[key]; if (!c || c[2] < minN || c[1] / c[2] < thr) continue;
        if (HIGH && p.alt >= 10000 && (c[2] < HIGH[1] || c[1] / c[2] < HIGH[0])) continue;
        if (mode !== '1pt') {
          const ok = prev && prev.ap === c[0] && p.t - prev.t >= 20 && p.t - prev.t <= 180;
          if (!prev || prev.ap !== c[0] || p.t - prev.t > 180) prev = { ap: c[0], t: p.t };
          if (!ok && !(mode === 'mix' && c[2] >= STRONG_N && c[1] / c[2] >= STRONG_S)) continue;
        }
        first = { ap: c[0], p, landsSoon: !!D && l.end.t - p.t <= 2700 }; break;
      }
      if (D) S.legs++;
      if (!first) return;
      S.fired++;
      const B = S.byCls[cls] = S.byCls[cls] || { fired: 0, wrong: 0, lost: 0 }; B.fired++;
      // (the airport it named, landed at more than 45 minutes on - holding, a long descent from FL200: right too)
      const hi = first.p.alt >= 10000 ? 'hi' : 'lo'; S[hi] = S[hi] || { fired: 0, wrong: 0 }; S[hi].fired++;
      if (D && first.ap === D.id) { S.right++; if (!first.landsSoon) S.late = (S.late || 0) + 1; S.km.push(E.dist(first.p.lat, first.p.lon, D.lat, D.lon)); }
      else if (!landed && l.end.t - first.p.t <= 2700) { S.lost++; B.lost++; }
      else { B.wrong++; S[hi].wrong++; if (D) S.wrongLanded++; else S.wrongNoLand++; if (ti === 2 && mi === 1 && ex.length < 25) { const X = E.byId(first.ap); ex.push(`${ac.reg || ac.hex} ${ac.type} ${cls}: said ${X && (X.iata || X.icao)} at ${first.p.alt} ft, ${X ? E.dist(first.p.lat, first.p.lon, X.lat, X.lon).toFixed(0) : '?'} km out - ${D ? 'landed ' + (D.iata || D.icao) + (first.landsSoon ? '' : ' later') : 'no landing at a listed airport'}`); } }
    }));
  }
}
console.log(`held-out flights landing at a listed airport: ${legsLanding}`);
TH.forEach(([thr, minN], ti) => MODES.forEach((mode, mi) => {
  const S = st[ti][mi], km = S.km.sort((a, b) => a - b);
  console.log(`${mode} share >= ${thr}, traffic >= ${minN}: fired on ${S.fired} flights, right ${S.right} (${(100 * S.right / Math.max(1, S.fired)).toFixed(2)}%; ${(100 * S.right / Math.max(1, S.fired - S.lost)).toFixed(2)}% of those whose end was seen), wrong: landed elsewhere ${S.wrongLanded}, flew on / landed off-board ${S.wrongNoLand}, lost from view ${S.lost}; coverage ${(100 * S.right / Math.max(1, S.legs)).toFixed(1)}% of landings; median ${km.length ? km[km.length >> 1].toFixed(1) : '-'} km out`);
  console.log('    ' + Object.entries(S.byCls).map(([c, b]) => `${c} ${b.fired}/${(100 * (1 - b.wrong / Math.max(1, b.fired - b.lost))).toFixed(2)}%`).join('  ') + `  | right later ${S.late || 0} | first fix below 10,000 ft ${S.lo ? S.lo.fired + ' wrong ' + S.lo.wrong : '-'}, above ${S.hi ? S.hi.fired + ' wrong ' + S.hi.wrong : '-'}`);
}));
for (const x of ex) console.log('  ' + x);
