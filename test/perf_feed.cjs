// Page-side cost of one LiveFeed answer: patchFlight over every flight of a busy view (ordinary flights with public
// telemetry unlocked, N/A ones reported, LADD ones labelled). usage: node test/perf_feed.cjs <node_modules dir> [flights=1500]
const fs = require('fs');
const path = require('path');
const NM = process.argv[2], N = +(process.argv[3] || 1500);
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.flightradar24.com/52,-1/7', runScripts: 'dangerously' });
const w = dom.window;
w.GM_xmlhttpRequest = o => { setTimeout(() => o.onerror && o.onerror({ error: 'offline' }), 0); return { abort() {} }; };
w.unsafeWindow = w; w.console.debug = () => {}; w.console.log = () => {};
w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;   // (jsdom's own are many times slower than a browser's)
w.fetch = () => Promise.reject(new Error('offline'));
let H = null; w.__tlTestHook = h => { H = h; };
w.eval(SRC);
setTimeout(() => {
  if (!H) { console.log('no test hook'); process.exit(1); }
  const B = w.__tweeksLaddBridge, { fLen, fStr, fVar, patchFlight } = H;
  const enc = (n, v) => { const b = new Uint8Array(5); b[0] = n * 8 + 5; new DataView(b.buffer).setFloat32(1, v, true); return b; };
  const cat = parts => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const msgs = [];
  for (let i = 0; i < N; i++) {
    const id = 0x3b000000 + i, kind = i % 10;   // 7 in 10 airline (route known), 2 N/A, 1 LADD (no callsign)
    const ex = kind === 9 ? cat([fStr(4, 'GLF6'), fVar(14, 0xa00000 + i)]) : cat([fStr(2, 'G-AB' + i), kind < 7 ? fLen(3, cat([fStr(1, 'LHR'), fStr(2, 'JFK')])) : fLen(3, cat([fStr(1, 'BQH')])), fStr(4, kind < 7 ? 'A320' : 'C172'), fVar(6, 0), fVar(14, 0x400000 + i)]);
    msgs.push(cat([fVar(1, id), enc(2, 51 + (i % 100) / 50), enc(3, -2 + (i % 70) / 20), fVar(4, 270), fVar(5, 30000), fVar(6, 420), fVar(7, 0), fVar(9, Math.floor(Date.now() / 1000)), fVar(10, 0), kind === 9 ? new Uint8Array(0) : fStr(11, (kind < 7 ? 'BAW' : 'GABC') + i), fVar(12, 0), fLen(13, ex)]));
    // public telemetry for every ordinary flight in view (the view poll's)
    if (kind !== 9) B.telem.set(id, { at: Date.now(), vr: 640, sqs: '7000', sq: 3584, agps: 30200, ias: 280, tas: 450, mach: 0.78, oat: -40, wd: 270, ws: 40, air: 'London FIR', airId: 'EGTT', pub: true });
  }
  const run = () => { const t = process.hrtime.bigint(), report = []; for (const m of msgs) patchFlight(m, report, false, Date.now()); return Number(process.hrtime.bigint() - t) / 1e6; };
  for (let k = 0; k < 3; k++) run();
  const times = []; for (let k = 0; k < 10; k++) times.push(run());
  times.sort((a, b) => a - b);
  console.log(`patchFlight x${N}: median ${times[5].toFixed(1)} ms, best ${times[0].toFixed(1)} ms, worst ${times[9].toFixed(1)} ms per LiveFeed answer`);
  process.exit(0);
}, 1500);
