// Every name the monitor gives an FR24 flight, kept for good - so a flight is named in FR24's playback as it was live,
// any day the monitor was running, without a heatmap or a guess. One line per name, one file per day (the day it was
// given): STORE/names/YYYY-MM-DD.jsonl - [FR24 id, hex, reg, type, callsign, flags (1 LADD 2 mil 4 PIA), named at (s)].
// A name withdrawn (the aircraft turned out elsewhere) is written again with an empty hex: the last line of an id wins.
// The last two weeks are held in memory; an older day is read when a playback of it asks (the last few kept).
const fs = require('fs'), path = require('path');
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);

function createNames(env) {
  const dir = path.join(env.store, 'names'), keepDays = env.keepDays || 14;
  const mem = new Map();          // id -> row (the last two weeks)
  const old = new Map();          // 'YYYY-MM-DD' -> Map(id -> row), read on demand
  const stats = { added: 0, dropped: 0, served: 0 };
  const fin = v => typeof v === 'number' && isFinite(v);
  function write(row) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, dayOf(row[6]) + '.jsonl'), JSON.stringify(row) + '\n'); }
    catch (e) { if (env.log) env.log('names', String(e)); }
  }
  // a name given (or confirmed again with other details) - t: when it was given, or for a name found in a playback, the
  // moment played (kept with that day, where a playback of it looks)
  function add(id, rec, t) {
    id = Number(id); const hex = String(rec.hex || '').toLowerCase();
    if (!(id > 0) || !/^[0-9a-f]{6}$/.test(hex)) return false;
    const row = [id, hex, String(rec.reg || ''), String(rec.type || ''), String(rec.cs || ''), rec.flags | 0, Math.round(fin(t) ? t : Date.now() / 1000)];
    const cur = mem.get(id); if (cur && cur[1] === row[1] && cur[2] === row[2] && cur[5] === row[5]) return false;
    mem.set(id, row); write(row); stats.added++;
    { const d = dayOf(row[6]); if (old.has(d)) old.get(d).set(id, row); }   // (a day already read: as it is now)
    return true;
  }
  // a name withdrawn: not served again
  function drop(id, t) {
    id = Number(id); const cur = mem.get(id); if (!cur || !cur[1]) return false;
    const row = [id, '', '', '', '', 0, Math.round(fin(t) ? t : Date.now() / 1000)];
    mem.set(id, row); write(row); stats.dropped++;
    { const d = dayOf(row[6]); if (old.has(d)) old.get(d).set(id, row); }
    return true;
  }
  function readDay(d) {
    if (old.has(d)) return old.get(d);
    const m = new Map();
    try { for (const line of fs.readFileSync(path.join(dir, d + '.jsonl'), 'utf8').split('\n')) { if (!line) continue; try { const r = JSON.parse(line); if (Array.isArray(r) && r[0] > 0) m.set(r[0], r); } catch (e) { /* a line being written */ } } } catch (e) { /* no such day */ }
    old.set(d, m); if (old.size > 12) old.delete(old.keys().next().value);
    return m;
  }
  // the names of these FR24 flights; t: the moment a playback shows (its day and the one before are read for a name
  // given before midnight)
  function get(ids, t) {
    const out = [], nowS = Date.now() / 1000;
    const days = fin(t) && t < nowS - keepDays * 86400 ? [dayOf(t), dayOf(t - 86400)] : [];
    for (const raw of ids) {
      const id = Number(raw); if (!(id > 0)) continue;
      let r = mem.get(id);
      if (!r) for (const d of days) { const x = readDay(d).get(id); if (x) { r = x; break; } }
      if (r && r[1]) out.push(r);
    }
    stats.served += out.length;
    return out;
  }
  // (the name a flight has now, without counting it as served: what a report is checked against)
  function peek(id, t) {
    id = Number(id); let r = mem.get(id);
    if (!r && fin(t) && t < Date.now() / 1000 - keepDays * 86400) for (const d of [dayOf(t), dayOf(t - 86400)]) { r = readDay(d).get(id); if (r) break; }
    return r && r[1] ? r : null;
  }
  // on start: the last two weeks back in memory
  function load(nowS) {
    let n = 0;
    for (let i = keepDays; i >= 0; i--) for (const [id, r] of readDay(dayOf(nowS - i * 86400))) { mem.set(id, r); n++; }
    old.clear();
    return n;
  }
  function prune(nowS) { const cut = nowS - keepDays * 86400; for (const [id, r] of mem) if (r[6] < cut) mem.delete(id); }
  return { add, drop, get, peek, load, prune, stats, get size() { return mem.size; } };
}
module.exports = { createNames };
