// Merges another monitor's store (the home PC's: legs-YYYY-MM-DD.json + state.json) into this one's, losing nothing either
// gathered: every flight of both (one copy of a flight both heard - the more complete one), every blocked aircraft of both
// (known since the earlier, last heard the later). This monitor's own running state - when it last ran, the areas, the
// days it watched, the days still to rebuild, its rebuilt logs (hist/) - stays as it is.
// The monitor must be stopped first (it would write its own copy over the merge): this refuses while the port answers.
// usage: node merge-store.cjs <other store dir> <this store dir> [--dry-run]
//   a copy of this store's files as they were is kept first, in <this store dir>/../store-before-merge-<time>
const fs = require('fs');
const path = require('path');
const net = require('net');
const KEEP = 90 * 86400;
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const legKey = l => Math.round((l.tOff || l.tStart) / 600);

function readStore(dir) {
  const legs = [], files = [];
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!/^legs-\d{4}-\d\d-\d\d\.json$/.test(f)) continue;
    files.push(f);
    let list; try { list = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { throw new Error('cannot read ' + path.join(dir, f) + ': ' + e.message); }
    if (Array.isArray(list)) for (const l of list) if (l && l.hex && isFinite(l.tStart)) legs.push(l);
  }
  let state = null; const sf = path.join(dir, 'state.json');
  if (fs.existsSync(sf)) { try { state = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch (e) { throw new Error('cannot read ' + sf + ': ' + e.message); } }
  return { legs, files, state };
}
// (how much a copy of a flight knows: both ends, ended, closed; then the longer stretch of it)
const score = l => (l.from ? 2 : 0) + (l.to ? 2 : 0) + (l.ended ? 1 : 0) + (l.open ? 0 : 1);
// Two copies of one flight: the same take-off slot, or most of the shorter one inside the other
function same(a, b) {
  if (legKey(a) === legKey(b)) return true;
  const lo = Math.max(a.tStart, b.tStart), hi = Math.min(a.tEnd || a.tStart, b.tEnd || b.tStart), short = Math.min((a.tEnd || a.tStart) - a.tStart, (b.tEnd || b.tStart) - b.tStart);
  return hi - lo > Math.max(60, 0.5 * short);
}
const better = (mine, other) => { const s = score(mine) - score(other); if (s) return s > 0 ? mine : other; const d = ((mine.tEnd || 0) - mine.tStart) - ((other.tEnd || 0) - other.tStart); return d < -60 ? other : mine; };
// this store's flights first; the other's added where they are new, or where they know more of the same flight
function mergeLegs(mine, other, nowS) {
  const byHex = new Map(), stats = { mine: mine.length, other: other.length, added: 0, replaced: 0, dupes: 0, old: 0 };
  const add = (l, isMine) => {
    if (nowS - (l.tEnd || l.tStart) > KEEP) { stats.old++; return; }
    let list = byHex.get(l.hex); if (!list) byHex.set(l.hex, list = []);
    const i = list.findIndex(x => same(x, l));
    if (i < 0) { list.push(l); if (!isMine) stats.added++; return; }
    if (isMine) { list[i] = better(list[i], l); return; }   // (two of this store's own: as the monitor keeps them, one per slot)
    const b = better(list[i], l); if (b === l) { list[i] = l; stats.replaced++; } else stats.dupes++;
  };
  for (const l of mine) add(l, true);
  for (const l of other) add(l, false);
  const byDay = new Map();
  for (const list of byHex.values()) for (const l of list) { const d = dayOf(l.tOff || l.tStart); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(l); }
  return { byDay, stats };
}
// blocked aircraft: [reg, type, known since, last heard, on the FAA list, last seen with the LADD flag]
function mergeBlocked(mine, other) {
  const out = Object.assign({}, mine || {}); let added = 0;
  for (const [h, o] of Object.entries(other || {})) {
    const m = out[h]; if (!m) { out[h] = o.slice(); added++; continue; }
    const newer = (o[3] || 0) > (m[3] || 0) ? o : m, older = newer === o ? m : o;
    out[h] = [newer[0] || older[0] || '', newer[1] || older[1] || '', Math.min(...[m[2], o[2]].filter(x => x > 0).concat([m[2] || o[2] || 0])), Math.max(m[3] || 0, o[3] || 0), newer[4] ? 1 : 0, Math.max(m[5] || 0, o[5] || 0)];
  }
  return { blocked: out, added };
}
function portOpen(port) { return new Promise(res => { const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); res(true); }); s.on('error', () => res(false)); s.setTimeout(1500, () => { s.destroy(); res(false); }); }); }

async function main(argv) {
  const args = argv.filter(a => !a.startsWith('--')), dry = argv.includes('--dry-run');
  if (args.length !== 2) { console.log('usage: node merge-store.cjs <other store dir> <this store dir> [--dry-run]'); return 2; }
  const [otherDir, mineDir] = args.map(a => path.resolve(a));
  if (otherDir === mineDir) { console.log('the two stores are the same directory'); return 2; }
  if (!fs.existsSync(otherDir)) { console.log('no such directory: ' + otherDir); return 2; }
  const port = +(process.env.MON_PORT || 47524);
  if (!dry && await portOpen(port)) { console.log(`the monitor is running (port ${port} answers) - stop it first: sudo systemctl stop fr24-monitor`); return 3; }
  const nowS = Date.now() / 1000, other = readStore(otherDir), mine = readStore(mineDir);
  const { byDay, stats } = mergeLegs(mine.legs, other.legs, nowS);
  const sMine = mine.state || { v: 1, lastRun: 0, blocked: {}, areas: [] }, mb = mergeBlocked(sMine.blocked, other.state && other.state.blocked);
  const state = Object.assign({}, sMine, { blocked: mb.blocked });
  const nonFaa = Object.values(mb.blocked).filter(b => !b[4]).length;
  console.log(`flights: this store ${stats.mine}, the other ${stats.other} -> ${[...byDay.values()].reduce((n, l) => n + l.length, 0)} (${stats.added} added, ${stats.replaced} replaced by a more complete copy, ${stats.dupes} already here, ${stats.old} older than 90 days dropped)`);
  console.log(`days: ${[...byDay.keys()].sort().join(' ')}`);
  console.log(`blocked aircraft: this store ${Object.keys(sMine.blocked || {}).length}, the other ${Object.keys((other.state && other.state.blocked) || {}).length} -> ${Object.keys(mb.blocked).length} (${mb.added} new; ${nonFaa} not on the FAA list, asked for by address)`);
  if (dry) { console.log('dry run: nothing written'); return 0; }
  // (a copy of this store as it was, then the merged files - each written whole, then renamed into place)
  const bak = path.join(path.dirname(mineDir), 'store-before-merge-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  fs.mkdirSync(bak, { recursive: true });
  for (const f of mine.files.concat(mine.state ? ['state.json'] : [])) fs.copyFileSync(path.join(mineDir, f), path.join(bak, f));
  fs.mkdirSync(mineDir, { recursive: true });
  const write = (f, o) => { const p = path.join(mineDir, f); fs.writeFileSync(p + '.tmp', JSON.stringify(o)); fs.renameSync(p + '.tmp', p); };
  for (const [d, list] of byDay) write('legs-' + d + '.json', list);
  // (a day file of this store none of whose flights are left in it - all moved to the day they took off - emptied)
  for (const f of mine.files) if (!byDay.has(f.slice(5, 15))) write(f, []);
  write('state.json', state);
  console.log('merged into ' + mineDir + ' (the store as it was: ' + bak + ')');
  return 0;
}
if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c), e => { console.error(e && e.stack || e); process.exit(1); });
module.exports = { main, mergeLegs, mergeBlocked, same, better };
