// The training pipeline's archive (test/arch.cjs reads it) made from adsb.lol's daily archives on GitHub
// (monitor/archive.cjs: read as they download, never stored whole): <archDir>/<YYYY-MM-DD>/<xx>.jsonl.gz, one line per
// aircraft-day {h, r, t, f, d, o, y, ts, tr} sharded by the address's last two hex digits, and index.json once the day is
// complete. tr is the day's readsb trace_full thinned: a point every 15 s in the air and every 60 s on the ground, every
// change between the two, every point carrying the transponder's details (callsign, squawk, selected levels) and the last.
// Which aircraft: business jets (bizjet, heavybiz) and every aircraft flagged LADD - CLASSES=all for every aircraft.
// usage: node test/mkarch.cjs <archDir> <fromDay> <toDay> [jobs=3]      (days YYYY-MM-DD, inclusive; a day done is skipped)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const A = require('../monitor/archive.cjs');
const { createRouteEngine } = require('../src/engine.js');
const E = createRouteEngine();
const ALL = process.env.CLASSES === 'all';

function thin(tr) {
  const out = []; let last = null;
  for (let i = 0; i < tr.length; i++) {
    const p = tr[i]; if (!Array.isArray(p)) continue;
    const g = p[3] === 'ground', lg = last && last[3] === 'ground', end = i === tr.length - 1;
    if (!last || end || g !== lg || (p[8] && typeof p[8] === 'object') || p[0] - last[0] >= (g ? 60 : 15)) { out.push(p); last = p; }
  }
  return out;
}
async function day(archDir, d) {
  const dir = path.join(archDir, d);
  if (fs.existsSync(path.join(dir, 'index.json'))) return { d, skipped: true };
  fs.mkdirSync(dir, { recursive: true });
  const outs = new Map(); let n = 0;
  const shard = x => { let s = outs.get(x); if (!s) { const gz = zlib.createGzip({ level: 6 }), f = fs.createWriteStream(path.join(dir, x + '.jsonl.gz')); gz.pipe(f); s = { gz, f }; outs.set(x, s); } return s; };
  const st = await A.importDay(d, (hex, hd) => {
    if (ALL || (hd.flags & 8)) return true;
    const c = E.classify({ hex, type: hd.type, reg: hd.reg }); return c === 'bizjet' || c === 'heavybiz';
  }, async (hex, j) => {
    const line = JSON.stringify({ h: hex, r: j.r || '', t: j.t || '', f: j.dbFlags || 0, d: j.desc || '', o: j.ownOp || '', y: j.year || '', ts: j.timestamp, tr: thin(j.trace) }) + '\n';
    const s = shard(hex.slice(-2)); n++;
    if (!s.gz.write(line)) await new Promise(r => s.gz.once('drain', r));
  }, { get: A.netGet, open: A.netOpen });
  await Promise.all([...outs.values()].map(s => new Promise(r => { s.f.on('finish', r); s.gz.end(); })));
  if (!st.published) return { d, published: false };
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ day: d, aircraft: n, traces: st.traces, ms: st.ms, made: new Date().toISOString(), classes: ALL ? 'all' : 'bizjet,heavybiz,ladd' }));
  return { d, aircraft: n, traces: st.traces, s: Math.round(st.ms / 1000) };
}
if (require.main === module) {
  const [archDir, from, to, jobs = '3'] = process.argv.slice(2);
  if (!archDir || !/^\d{4}-\d\d-\d\d$/.test(from || '') || !/^\d{4}-\d\d-\d\d$/.test(to || '')) { console.log('usage: node test/mkarch.cjs <archDir> <fromDay> <toDay> [jobs=3]'); process.exit(2); }
  const days = []; for (let t = Date.parse(to + 'T00:00:00Z'); t >= Date.parse(from + 'T00:00:00Z'); t -= 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const work = async () => { for (let d; (d = days.shift());) { try { console.log(new Date().toISOString().slice(11, 19), JSON.stringify(await day(archDir, d))); } catch (e) { console.log(new Date().toISOString().slice(11, 19), d, 'ERROR', String(e && e.message || e)); } } };
  Promise.all(Array.from({ length: Math.max(1, +jobs) }, work)).then(() => console.log('all done'));
}
module.exports = { thin, day };
