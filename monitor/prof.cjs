'use strict';
// (1.3.1) What the monitor's one main thread is busy with - said by the monitor itself, so a slow answer has a cause that
// can be read rather than guessed: V8's own sampling profiler (the inspector's), always on at a coarse rate (a sample
// every 20 ms - next to nothing), read a minute at a time:
//   - top: the functions the last minute's time went on (their own time), jobs: what started them (the first function of
//     this program on the stack - a loop's round, a request's answer), busyPct: the share of the minute not idle
//   - stalls: each time the event loop did not turn for a second or more (the monitor's own half-second timer coming in
//     late - every request waits that long), what was running then: the job and the functions inside it. The last day's
//     longest and the latest are kept
// GET /status gives them (loop.prof): names of functions and their lines in this program's own files, nothing else.
// monitor.json "prof": false turns it off.
let inspector = null; try { inspector = require('inspector'); } catch (e) { inspector = null; }

const short = u => String(u || '').split(/[\\/]/).pop();
const labelOf = cf => (cf.functionName || '(anonymous)') + (cf.url ? ' ' + short(cf.url) + ':' + (cf.lineNumber + 1) : '');
const own = cf => !!cf.url && !/^node:/.test(cf.url) && !/[\\/]node_modules[\\/]/.test(cf.url);

// a profile (the inspector's Profiler.stop answer) and the stalls of its time ([[from ms, to ms]] - by the wall clock,
// startWall being the wall clock at its start) -> { ms, busyMs, top, jobs, stalls: [{ at, ms, job, hot }] }
function digest(profile, startWall, stallRanges) {
  const byId = new Map(), parent = new Map();
  for (const n of profile.nodes) byId.set(n.id, n);
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  // (each node's job: the first function of this program on its stack, from the root - found once a node)
  const jobOf = new Map();
  const job = id => {
    if (jobOf.has(id)) return jobOf.get(id);
    const chain = []; for (let k = id; k !== undefined; k = parent.get(k)) chain.push(k);
    let j = ''; for (let i = chain.length - 1; i >= 0; i--) { const cf = byId.get(chain[i]).callFrame; if (own(cf)) { j = labelOf(cf); break; } }
    if (!j) { const cf = byId.get(id).callFrame; j = cf.functionName === '(garbage collector)' ? '(garbage collector)' : '(node itself)'; }
    jobOf.set(id, j); return j;
  };
  const self = new Map(), jobs = new Map(), add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  const ranges = (stallRanges || []).map(r => ({ from: r[0], to: r[1], ms: 0, job: new Map(), hot: new Map() }));
  let t = profile.startTime, total = 0, busy = 0;
  const samples = profile.samples || [], deltas = profile.timeDeltas || [];
  for (let i = 0; i < samples.length; i++) {
    // (a sample stands for the time until the next one)
    const dt = (i + 1 < deltas.length ? deltas[i + 1] : 0) / 1000; t += deltas[i] || 0;
    const n = byId.get(samples[i]); if (!n) continue;
    total += dt;
    const fn = n.callFrame.functionName;
    if (fn === '(idle)') continue;
    busy += dt;
    const lab = labelOf(n.callFrame), jb = job(n.id);
    add(self, lab, dt); add(jobs, jb, dt);
    if (ranges.length) { const w = startWall + (t - profile.startTime) / 1000; for (const r of ranges) if (w >= r.from - 30 && w <= r.to + 30) { r.ms += dt; add(r.job, jb, dt); add(r.hot, lab, dt); } }
  }
  const topOf = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(x => [x[0], Math.round(x[1])]);
  return { ms: Math.round(total), busyMs: Math.round(busy), top: topOf(self, 15), jobs: topOf(jobs, 12),
    stalls: ranges.map(r => ({ at: Math.round(r.to), ms: Math.round(r.to - r.from), job: (topOf(r.job, 1)[0] || [''])[0], hot: topOf(r.hot, 4) })) };
}

function createProf(env) {
  env = env || {};
  const windowMs = env.windowMs || 60000, intervalUs = env.intervalUs || 20000, now = env.now || (() => Date.now()), log = env.log || (() => {});
  const S = { on: false, err: '', windows: 0, at: 0, busyPct: 0, top: [], jobs: [], stalls: [] };
  let session = null, timer = null, startWall = 0, pending = [], turning = false;
  const post = (m, p) => new Promise((res, rej) => { try { session.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))); } catch (e) { rej(e); } });
  // (the event loop did not turn from `at - ms` to `at`: said by the monitor's own timer)
  function stall(at, ms) { if (S.on && ms >= 1000) { pending.push([at - ms, at]); if (pending.length > 50) pending.shift(); } }
  function keep(list) {
    const t = now(), all = S.stalls.concat(list.filter(s => s.ms >= 1000)).filter(s => t - s.at < 86400000);
    // (the last day's ten longest, and the five latest)
    const longest = all.slice().sort((a, b) => b.ms - a.ms).slice(0, 10), latest = all.slice().sort((a, b) => b.at - a.at).slice(0, 5);
    S.stalls = [...new Set(longest.concat(latest))].sort((a, b) => b.at - a.at);
  }
  async function turn() {
    if (turning || !session) return; turning = true;
    try {
      const { profile } = await post('Profiler.stop'), sw = startWall, ranges = pending; pending = [];
      startWall = now(); await post('Profiler.start');
      const d = digest(profile, sw, ranges);
      S.windows++; S.at = now(); S.busyPct = d.ms ? Math.round(1000 * d.busyMs / d.ms) / 10 : 0; S.top = d.top; S.jobs = d.jobs; keep(d.stalls);
      for (const s of d.stalls) if (s.ms >= 3000) log('stall', s.ms, 'ms in', s.job, '-', s.hot.map(h => h[0] + ' ' + h[1] + ' ms').join(', '));
    } catch (e) { S.err = String(e && e.message || e).slice(0, 120); }
    turning = false;
  }
  async function start() {
    if (S.on || !inspector) { if (!inspector) S.err = 'no inspector in this Node'; return S; }
    try {
      session = new inspector.Session(); session.connect();
      await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: intervalUs });
      startWall = now(); await post('Profiler.start');
      S.on = true; S.err = '';
      timer = setInterval(() => { turn(); }, windowMs); if (timer.unref) timer.unref();
    } catch (e) { S.err = String(e && e.message || e).slice(0, 120); try { session.disconnect(); } catch (e2) { /* was not connected */ } session = null; }
    return S;
  }
  async function stop() {
    if (timer) clearInterval(timer); timer = null;
    if (session) { try { await post('Profiler.stop'); } catch (e) { /* not running */ } try { session.disconnect(); } catch (e) { /* gone */ } }
    session = null; S.on = false;
  }
  return { start, stop, turn, stall, stats: S };
}
module.exports = { createProf, digest, labelOf };
