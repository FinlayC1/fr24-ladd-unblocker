// Loader for the daily open-data archives (data/fetch_archive.mjs): <archDir>/<YYYY-MM-DD>/<xx>.jsonl.gz, one line per
// aircraft-day {h, r, t, f, d, o, y, ts, tr} - tr is a thinned readsb trace_full, so engine.parseTrace reads it as is.
// Aircraft are sharded by the last two hex digits (256 shards); within a shard, `part`/`parts` split further by a hash
// of the address so a worker never holds more than a slice of a shard in memory.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { countryOfHex } = require('./dataset.cjs');
const REG_PREFIX = require('./dataset.cjs').REG_PREFIX || null;
const listDays = archDir => fs.readdirSync(archDir).filter(d => /^\d{4}-\d\d-\d\d$/.test(d) && fs.existsSync(path.join(archDir, d, 'index.json'))).sort();
// The consecutive run of days ending at the newest one (the history window: every day, no holes) and the rest (sampled
// older days - whole-population statistics only)
function dayPlan(archDir) {
  const all = listDays(archDir); if (!all.length) return { run: [], sampled: [], all };
  const run = [all[all.length - 1]];
  for (let i = all.length - 2; i >= 0; i--) { const a = Date.parse(all[i] + 'T00:00:00Z'), b = Date.parse(run[0] + 'T00:00:00Z'); if (b - a === 864e5) run.unshift(all[i]); else break; }
  return { run, sampled: all.filter(d => !run.includes(d)), all };
}
const hexPart = (hex, parts) => parts <= 1 ? 0 : (parseInt(hex.slice(0, 4), 16) * 2654435761 >>> 0) % parts;
const SHARDS = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const COUNTRY = [['D-', 'Germany'], ['G-', 'United Kingdom'], ['F-', 'France'], ['EI-', 'Ireland'], ['OO-', 'Belgium'], ['PH-', 'Netherlands'], ['OE-', 'Austria'], ['HB-', 'Switzerland'], ['OK-', 'Czechia'], ['SP-', 'Poland'], ['SE-', 'Sweden'], ['OY-', 'Denmark'], ['LN-', 'Norway'], ['OH-', 'Finland'], ['EC-', 'Spain'], ['CS-', 'Portugal'], ['I-', 'Italy'], ['HA-', 'Hungary'], ['S5-', 'Slovenia'], ['9A-', 'Croatia'], ['YR-', 'Romania'], ['LY-', 'Lithuania'], ['YL-', 'Latvia'], ['ES-', 'Estonia'], ['OM-', 'Slovakia'], ['LX-', 'Luxembourg'], ['9H-', 'Malta'], ['SX-', 'Greece'], ['TC-', 'Turkey'], ['M-', 'Isle Of Man'], ['C-', 'Canada'], ['LZ-', 'Bulgaria'], ['TF-', 'Iceland'], ['UR-', 'Ukraine'], ['4X-', 'Israel'], ['5B-', 'Cyprus'], ['VH-', 'Australia'], ['ZK-', 'New Zealand'], ['ZS-', 'South Africa'], ['PR-', 'Brazil'], ['PT-', 'Brazil'], ['PP-', 'Brazil'], ['XA-', 'Mexico'], ['XB-', 'Mexico'], ['LV-', 'Argentina'], ['CC-', 'Chile'], ['A6-', 'United Arab Emirates'], ['A7-', 'Qatar'], ['HZ-', 'Saudi Arabia'], ['JA', 'Japan'], ['HL', 'South Korea'], ['B-', 'China'], ['VT-', 'India'], ['9V-', 'Singapore'], ['9M-', 'Malaysia'], ['HS-', 'Thailand'], ['PK-', 'Indonesia'], ['RP-', 'Philippines'], ['SU-', 'Egypt'], ['CN-', 'Morocco'], ['5Y-', 'Kenya'], ['ET-', 'Ethiopia'], ['VP-B', 'Bermuda'], ['VP-C', 'Cayman Islands'], ['2-', 'Guernsey'], ['RA-', 'Russia']];
const countryOfReg = r => { r = String(r || '').toUpperCase(); let best = null; for (const [p, c] of COUNTRY) if (r.startsWith(p) && (!best || p.length > best[0].length)) best = [p, c]; return best ? best[1] : (/^N[0-9]/.test(r) ? 'United States' : ''); };
// Every aircraft of a shard (slice `part` of `parts`), over the given days: { ac, pts, nDays }
function* shardAircraft(archDir, shard, days, E, opts = {}) {
  const parts = opts.parts || 1, part = opts.part || 0, want = opts.want || null;
  const byHex = new Map();
  for (const d of days) {
    const f = path.join(archDir, d, shard + '.jsonl.gz'); if (!fs.existsSync(f)) continue;
    let txt; try { txt = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'); } catch (e) { continue; }
    let i = 0;
    while (i < txt.length) {
      let j = txt.indexOf('\n', i); if (j < 0) j = txt.length;
      if (j > i + 10) {
        const hex = txt.slice(i + 6, i + 12);     // {"h":"xxxxxx"
        if ((!want || want.has(hex)) && hexPart(hex, parts) === part) (byHex.get(hex) || byHex.set(hex, []).get(hex)).push(txt.slice(i, j));
      }
      i = j + 1;
    }
  }
  for (const [hex, lines] of byHex) {
    let meta = null, pts = [];
    for (const l of lines) {
      let o; try { o = JSON.parse(l); } catch (e) { continue; }
      meta = { r: o.r || (meta && meta.r) || '', t: o.t || (meta && meta.t) || '', f: o.f || (meta && meta.f) || 0, d: o.d || (meta && meta.d) || '', o: o.o || (meta && meta.o) || '', y: o.y || (meta && meta.y) || '' };
      const p = E.parseTrace({ timestamp: o.ts, trace: o.tr });
      for (const x of p) pts.push(x);
    }
    if (!meta || !pts.length) continue;
    pts.sort((a, b) => a.t - b.t); pts = pts.filter((p, i) => !i || p.t > pts[i - 1].t);
    const cat = (pts.find(p => p.cat) || {}).cat || '';
    // its usual callsign (a private jet of an airliner type flies under its registration)
    const csN = new Map(); for (let i = 0; i < pts.length; i += 20) if (pts[i].cs) csN.set(pts[i].cs, (csN.get(pts[i].cs) || 0) + 1);
    let cs = ''; for (const [k, n] of csN) if (!cs || n > csN.get(cs)) cs = k;
    const ac = { hex, type: String(meta.t || '').toUpperCase(), reg: String(meta.r || '').toUpperCase(), mil: !!(meta.f & 1), ladd: !!(meta.f & 8), pia: !!(meta.f & 4), cat, country: countryOfReg(meta.r) || countryOfHex(hex), year: +meta.y || 0, ownOp: meta.o || '', desc: meta.d || '', cs };
    yield { ac, pts, nDays: lines.length };
  }
}
module.exports = { listDays, dayPlan, shardAircraft, SHARDS, hexPart, countryOfReg };
