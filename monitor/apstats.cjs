// Every airport's movements and runway use, day by day (1.0.2) - the map's airport panel ("Movements per day", "Runway
// usage") answered at once, for any airport, from what is kept here. Counted as the world log builds each day (every
// aircraft adsb.lol heard): a flight's take-off and landing seen at an airport - on its runway, or low over it - each one's
// runway worked out from its track (airport.cjs runwayOf). Kept for good, one small file a day:
// STORE/apstats/YYYY-MM-DD.json.gz - { v, day, at, rw: 1 runways worked out | 0 not, ap: { id: [take-offs, landings,
// { runway: [take-offs, landings] }] } }. A world day built before 1.0.2 is counted from its file (no runways: its tracks
// are not kept).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const AS_V = 1;
const sure = e => !!e && (e.conf === 'ground' || e.conf === 'low');

function createApStats(env) {
  const dir = path.join(env.store, 'apstats'), cache = new Map(), cacheDays = env.cacheDays || 40;
  const stats = { days: 0, written: 0, read: 0, counted: 0, err: '' };
  const file = d => path.join(dir, d + '.json.gz');
  let have = new Set();
  function scan() {
    have = new Set();
    let names = []; try { names = fs.readdirSync(dir); } catch (e) { names = []; }
    for (const f of names) { const m = /^(\d{4}-\d\d-\d\d)\.json\.gz$/.exec(f); if (m) have.add(m[1]); }
    stats.days = have.size;
    return have.size;
  }
  // (a day's counts as they are added: airport id -> [take-offs, landings, Map(runway -> [take-offs, landings])])
  function acc() {
    const ap = new Map();
    const at = id => { let x = ap.get(id); if (!x) ap.set(id, x = [0, 0, new Map()]); return x; };
    return {
      ap,
      // one flight (summarizeLeg's): its sure ends counted, with the runway each used where it is known
      add(s, rwyOff, rwyOn) {
        if (sure(s.from)) { const x = at(s.from.id); x[0]++; if (rwyOff) { const r = x[2].get(rwyOff) || x[2].set(rwyOff, [0, 0]).get(rwyOff); r[0]++; } }
        if (sure(s.to)) { const x = at(s.to.id); x[1]++; if (rwyOn) { const r = x[2].get(rwyOn) || x[2].set(rwyOn, [0, 0]).get(rwyOn); r[1]++; } }
      }
    };
  }
  function write(day, a, rw) {
    fs.mkdirSync(dir, { recursive: true });
    const ap = {}; for (const [id, x] of a.ap) ap[id] = x[2].size ? [x[0], x[1], Object.fromEntries(x[2])] : [x[0], x[1]];
    const o = { v: AS_V, day, at: Date.now(), rw: rw ? 1 : 0, ap }, tmp = file(day) + '.tmp';
    fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(o), { level: 6 })); fs.renameSync(tmp, file(day));
    have.add(day); stats.days = have.size; stats.written++;
    cache.set(day, o); trim();
    return Object.keys(ap).length;
  }
  function trim() { while (cache.size > cacheDays) cache.delete(cache.keys().next().value); }
  // (a day's counts: null none kept)
  function read(day) {
    if (cache.has(day)) { const o = cache.get(day); cache.delete(day); cache.set(day, o); return o; }
    if (!have.has(day)) return null;
    let o = null;
    try { o = JSON.parse(zlib.gunzipSync(fs.readFileSync(file(day))).toString('utf8')); stats.read++; } catch (e) { stats.err = String(e.message || e).slice(0, 120); have.delete(day); return null; }
    if (!o || o.v !== AS_V || !o.ap) return null;
    cache.set(day, o); trim();
    return o;
  }
  const has = day => have.has(day);
  // A day's whole world log counted (a day built before runways were worked out): async, the server answering meanwhile
  async function countWorld(world, day, breath) {
    const a = acc();
    await world.each(day, (hex, legs) => { for (const s of legs) a.add(s, null, null); }, breath);
    stats.counted++;
    return write(day, a, false);
  }
  scan();
  return { acc, write, read, has, scan, countWorld, stats, get days() { return have; } };
}

module.exports = { createApStats, AS_V };
