'use strict';
// A worker thread of central calculation (1.1.0): an engine set up as the monitor's own (monitor.cjs loadEngine - the
// airports, runways, landing fields, route tables and weights) with the tables, the userscript's route code and the
// landing sites of central calculation (central.cjs createCalc). It works out the flights the main thread hands it, one
// at a time; the weather and closures browsers sent, the surges and the monitor's learning come as they change.
const { parentPort, workerData: W } = require('worker_threads');
const fs = require('fs'), path = require('path');
const { createCalc } = require('./central.cjs');

(async () => {
  try {
    const { createRouteEngine } = require(W.engine);
    const E = createRouteEngine(), rd = f => { const p = path.join(W.dataDir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
    E.setAirports(rd('airports.json').rows);
    const rw = rd('runways.json'); if (rw) E.setRunways(rw);
    const rl = rd('runway_len.json'); if (rl) E.setRunwayLengths(rl);
    if (W.datasetFile && fs.existsSync(path.join(W.dataDir, 'oa_airports.csv'))) E.setFields(require(W.datasetFile).loadFields(W.dataDir));
    const calc = createCalc({ E });
    const st = await calc.load({ srcDir: W.srcDir, mainDir: W.mainDir, sitesCsv: W.sitesCsv || '', learnedOps: W.learnedOps || null });
    parentPort.on('message', m => {
      if (!m) return;
      if (m.job) {
        const t0 = Date.now(); let out;
        try { out = calc.run(m.job); } catch (e) { out = { r: null, err: String(e && e.message || e).slice(0, 200) }; }
        parentPort.postMessage(Object.assign({ jid: m.jid, ms: Date.now() - t0 }, out));
        return;
      }
      if (Array.isArray(m.wx)) for (const [k, v] of m.wx) calc.wxMap.set(k, v);
      if (Array.isArray(m.closed)) for (const [k, v] of m.closed) calc.closedMap.set(k, v);
      if (calc.wxMap.size > 3000) calc.wxMap.delete(calc.wxMap.keys().next().value);
      if (calc.closedMap.size > 3000) calc.closedMap.delete(calc.closedMap.keys().next().value);
      if ('surge' in m) calc.setSurge(Array.isArray(m.surge) ? new Map(m.surge) : null);
      if (Array.isArray(m.ops)) for (const op of m.ops) E.addLearnedOp(op);
    });
    parentPort.postMessage({ ready: true, st });
  } catch (e) { parentPort.postMessage({ ready: false, err: String(e && e.stack || e).slice(0, 400) }); }
})();
