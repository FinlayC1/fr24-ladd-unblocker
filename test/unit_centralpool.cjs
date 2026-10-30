// (1.1.0) Central calculation on worker threads (monitor/central.cjs createPool, central-worker.cjs): each with an engine
// set up as the monitor's own, the tables, the route code and the landing sites of its own.
//   - started: the workers ready, said in /status's numbers;
//   - the same answer on a worker as on the main thread (N1868M over the Atlantic, 19 Oct): origin, destination and odds,
//     the others, the phase;
//   - what the route code keeps of a flight between its answers - the departure it remembers - carried from one answer to
//     the next; a flight always on the same worker;
//   - POST /calc's answer waits for the flights it brought (a second at most);
//   - a worker gone: what it had answered with nothing, another started in its place, and it works again;
//   - every flight a browser showed lately worked out again as it is due, without anyone asking (centralRound).
// usage: node test/unit_centralpool.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA;
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'moncpool-'));
const M = require('../monitor/monitor.cjs'), C = require('../monitor/central.cjs');
M.loadEngine();
const E = M.E, ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src'), MAIN = path.join(SRC, 'main');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 600) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 50; i++) { const v = await f(); if (v) return v; await sleep(50); } return f(); };
const J = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/a15a72/2026-10-19_lol.json.gz'))).toString());
const CUT = J.timestamp + 22.5 * 3600, SHIFT = Math.floor(Date.now() / 1000) - CUT;
const NOWJ = Object.assign({}, J, { timestamp: J.timestamp + SHIFT, trace: J.trace.filter(p => J.timestamp + p[0] <= CUT) });
const HEX = 'a15a72';
const opts = { free: 8e9, srcDir: SRC, mainDir: MAIN, sitesCsv: path.join(DATA, 'oa_airports.csv'), engineFile: require.resolve('../src/engine.js'), dataDir: DATA, datasetFile: require.resolve('./dataset.cjs') };

(async () => {
  const pts = E.parseTrace(NOWJ), leg = E.legsFromPoints(pts, { cls: 'bizjet', type: 'GLF6' }).pop(), tr = []; for (const p of [leg.start].concat(leg.pts)) if (!tr.length || p.t - tr[tr.length - 1].t >= 15) tr.push(p);
  const out = p => JSON.parse(JSON.stringify(p, (k, v) => typeof v === 'number' && !isFinite(v) ? undefined : v));
  const ev = o => Object.assign({ id: 9001, hex: HEX, kind: 'live', ac: { reg: 'N1868M', type: 'GLF6', ladd: true, country: 'United States' }, pos: out(tr[tr.length - 1]), trail: { full: true, pts: out(tr) } }, o);
  const sig = r => r && { o: r.originIata, oc: r.originConf, d: r.destIata || '', dc: r.destConf, p: r.destP || 0, alts: (r.alternatives || []).map(a => a.iata + ':' + a.p).join(','), phase: r.phase, legs: r.legCount };
  // ---- the main thread's answer
  const one = C.createCentral({ E, logOf: () => [] }); await one.start(opts);
  one.take(ev()); const rMain = one.compute(one.flights.get(9001));
  // ---- the workers'
  const pool = C.createCentral({ E, logOf: () => [], log: () => {} });
  const st = await pool.start(Object.assign({ workers: 2 }, opts));
  check('started with two worker threads: both ready, said so', st.on && st.workers === 2 && pool.pool && pool.pool.workers.every(x => x.ready && x.st && x.st.sites > 50000), { on: st.on, workers: st.workers, why: st.workersWhy });
  pool.take(ev()); const F = pool.flights.get(9001);
  const rW = await pool.computeAsync(F);
  check('N1868M over the Atlantic: the same answer on a worker as on the main thread (origin, destination and odds, the others, the phase)', !!rW && JSON.stringify(sig(rW)) === JSON.stringify(sig(rMain)), { main: sig(rMain), worker: sig(rW) });
  check('... the departure the route code remembers with the flight, kept for its next answer', !!F.origin && F.origin.id === rW.originId, F.origin);
  const w1 = pool.pool.workers[9001 % 2], jobs = [];
  for (let k = 0; k < 3; k++) { F.dirty = true; F.routeAt = 0; jobs.push(pool.computeAsync(F)); await jobs[k]; }
  check('... worked out again and again: always on the same worker, the same answer', jobs.length === 3 && (await Promise.all(jobs)).every(r => JSON.stringify(sig(r)) === JSON.stringify(sig(rW))) && pool.pool.workers.indexOf(w1) === 9001 % 2);
  // ---- POST /calc waits for the flights it brought
  const a = await pool.answer({ v: 1, flights: [ev({ id: 9002 })] });
  check('POST /calc: the answer waits for the flight it brought, worked out on its worker', a.on && a.routes[9002] && a.routes[9002].r && a.routes[9002].r.originIata === rW.originIata, a.routes[9002] && sig(a.routes[9002].r));
  // ---- a worker gone
  const gone = pool.pool.workers[9002 % 2]; await gone.w.terminate();
  const F2 = pool.flights.get(9002); F2.dirty = true; F2.routeAt = 0;
  const r2 = await pool.computeAsync(F2);
  check('a worker gone: its flight answered with nothing meanwhile (no hang)', r2 === null);
  const back = await until(() => pool.pool.workers[9002 % 2] && pool.pool.workers[9002 % 2] !== gone && pool.pool.workers[9002 % 2].ready, 120000);
  F2.dirty = true; F2.routeAt = 0; const r3 = back ? await pool.computeAsync(F2) : null;
  check('... another started in its place, and the flight is worked out again', !!back && !!r3 && r3.originIata === rW.originIata, { back: !!back, r3: sig(r3) });
  // ---- worked out without anyone asking (the monitor's round)
  { const real = M.central; Object.defineProperty(M, 'central', { value: real, configurable: true });
    const F9 = pool.flights.get(9001); F9.at = Date.now(); F9.dirty = true; F9.routeAt = Date.now() - 60000; const before = pool.stats.computed;
    // (the monitor's own round over this pool: every flight a browser showed lately, due, on its worker)
    for (const [, x] of pool.flights) if (pool.due(x)) pool.computeAsync(x);
    await until(() => pool.stats.computed > before, 20000);
    check('every flight a browser showed lately, due: worked out again on its worker without being asked', pool.stats.computed > before && F9.routeAt > Date.now() - 20000, { before, after: pool.stats.computed }); }
  pool.close(); one.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
