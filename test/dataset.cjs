// Shared loader for the replay datasets.
//   <dataDir>/traces/<hex>/<YYYY-MM-DD|live>.json      (narrow set, 28 days, plain JSON; sample.json)
//   <dataDir>/wide/<hex>/<YYYY-MM-DD>.json.gz          (wide set, all LADD + military, 14 days; wide_sample.json)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const HEX_COUNTRY = [[0xA00000, 0xAFFFFF, 'United States'], [0x400000, 0x43FFFF, 'United Kingdom'], [0x3C0000, 0x3FFFFF, 'Germany'], [0x380000, 0x3BFFFF, 'France'], [0x300000, 0x33FFFF, 'Italy'], [0x340000, 0x37FFFF, 'Spain'], [0xC00000, 0xC3FFFF, 'Canada'], [0x7C0000, 0x7FFFFF, 'Australia'], [0x480000, 0x487FFF, 'Netherlands'], [0x4B0000, 0x4B7FFF, 'Switzerland'], [0x440000, 0x447FFF, 'Austria'], [0x448000, 0x44FFFF, 'Belgium'], [0x4CA000, 0x4CAFFF, 'Ireland'], [0x0D0000, 0x0D7FFF, 'Mexico'], [0xE40000, 0xE7FFFF, 'Brazil'], [0x710000, 0x717FFF, 'Saudi Arabia'], [0x896000, 0x896FFF, 'United Arab Emirates'], [0x4B8000, 0x4BFFFF, 'Turkey'], [0x468000, 0x46FFFF, 'Greece'], [0x478000, 0x47FFFF, 'Norway'], [0x4A8000, 0x4AFFFF, 'Sweden'], [0x458000, 0x45FFFF, 'Denmark'], [0x460000, 0x467FFF, 'Finland'], [0x490000, 0x497FFF, 'Portugal'], [0x488000, 0x48FFFF, 'Poland'], [0x498000, 0x49FFFF, 'Czechia'], [0x0A8000, 0x0A8FFF, 'Bahamas'], [0x738000, 0x73FFFF, 'Israel']];
// (the registration prefix first - the airport list's spelling: Czechia, Isle Of Man)
const REG_PREFIX = [['D-', 'Germany'], ['G-', 'United Kingdom'], ['F-', 'France'], ['EI-', 'Ireland'], ['OO-', 'Belgium'], ['PH-', 'Netherlands'], ['OE-', 'Austria'], ['HB-', 'Switzerland'], ['OK-', 'Czechia'], ['SP-', 'Poland'], ['SE-', 'Sweden'], ['OY-', 'Denmark'], ['LN-', 'Norway'], ['OH-', 'Finland'], ['EC-', 'Spain'], ['CS-', 'Portugal'], ['I-', 'Italy'], ['HA-', 'Hungary'], ['S5-', 'Slovenia'], ['9A-', 'Croatia'], ['YR-', 'Romania'], ['LY-', 'Lithuania'], ['YL-', 'Latvia'], ['ES-', 'Estonia'], ['OM-', 'Slovakia'], ['LX-', 'Luxembourg'], ['9H-', 'Malta'], ['SX-', 'Greece'], ['TC-', 'Turkey'], ['M-', 'Isle Of Man'], ['C-', 'Canada'], ['LZ-', 'Bulgaria'], ['TF-', 'Iceland'], ['UR-', 'Ukraine'], ['4X-', 'Israel'], ['5B-', 'Cyprus']];
const countryOfReg = r => { r = String(r || '').toUpperCase(); const m = REG_PREFIX.filter(([p]) => r.startsWith(p)).sort((x, y) => y[0].length - x[0].length)[0]; return m ? m[1] : (/^N[0-9]/.test(r) ? 'United States' : ''); };
const countryOfHex = hex => { const n = parseInt(hex, 16); const r = HEX_COUNTRY.find(([a, b]) => n >= a && n <= b); return r ? r[2] : ''; };
function* aircraft(dataDir, E, opts = {}) {
  // sets: 'narrow' (traces/, sample.json), 'wide' (all LADD + military), 'biz' (business jets worldwide, fetch_biz.mjs)
  const set = opts.set || (opts.wide ? 'wide' : 'narrow'), wide = set !== 'narrow';
  const list = JSON.parse(fs.readFileSync(path.join(dataDir, set === 'eu' ? 'eu_sample.json' : set === 'big' ? 'big_sample.json' : set === 'biz' ? 'biz_sample.json' : wide ? 'wide_sample.json' : 'sample.json'), 'utf8'));
  for (const a0 of list) {
    if (opts.filter && !opts.filter(a0)) continue;
    const dir = path.join(dataDir, set === 'eu' ? 'eu' : set === 'big' ? 'big' : set === 'biz' ? 'biz' : wide ? 'wide' : 'traces', a0.hex);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => wide ? f.endsWith('.json.gz') : f.endsWith('.json')).sort((a, b) => (a.startsWith('live') - b.startsWith('live')) || a.localeCompare(b));
    if (!files.length) continue;
    let pts = [], meta = null;
    for (const f of files) {
      let txt = fs.readFileSync(path.join(dir, f)); if (wide) txt = zlib.gunzipSync(txt);
      let j; try { j = JSON.parse(txt.toString('utf8')); } catch (e) { continue; }
      meta = meta || j; pts = pts.concat(E.parseTrace(j));
    }
    if (!meta || !pts.length) continue;
    pts.sort((a, b) => a.t - b.t); pts = pts.filter((p, i) => !i || p.t > pts[i - 1].t);
    const cat = (pts.find(p => p.cat) || {}).cat || '';
    const ac = { hex: a0.hex, type: meta.t || a0.t || '', reg: meta.r || a0.r || '', mil: !!((meta.dbFlags || a0.dbFlags) & 1), ladd: !!((meta.dbFlags || a0.dbFlags) & 8), cat, country: countryOfReg(meta.r || a0.r) || countryOfHex(a0.hex), year: +meta.year || 0, ownOp: meta.ownOp || '' };
    yield { ac, pts };
  }
}
// OurAirports small and medium airports - the airfields FR24 does not list - under the identifier the userscript uses
// (ICAO code, else GPS code, else OurAirports ident). withFields(E, dataDir) hands them to an engine (FIELDS=0: not).
let fieldCache = null;
function loadFields(dataDir) {
  if (fieldCache) return fieldCache;
  const file = path.join(dataDir, 'oa_airports.csv'); if (!fs.existsSync(file)) return (fieldCache = []);
  const cells = line => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/), head = cells(lines[0]), ix = k => head.indexOf(k);
  const [cT, cN, cLa, cLo, cE, cM, cI, cG, cId] = ['type', 'name', 'latitude_deg', 'longitude_deg', 'elevation_ft', 'municipality', 'icao_code', 'gps_code', 'ident'].map(ix);
  const rows = [];
  for (const l of lines.slice(1)) {
    if (!l) continue; const r = cells(l); if (r[cT] !== 'small_airport' && r[cT] !== 'medium_airport') continue;
    const lat = +r[cLa], lon = +r[cLo]; if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    rows.push({ lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, alt: Math.round(+r[cE] || 0), ident: r[cI] || r[cG] || r[cId] || '', name: r[cN] || '', city: r[cM] || '' });
  }
  return (fieldCache = rows);
}
const withFields = (E, dataDir) => process.env.FIELDS === '0' || typeof E.setFields !== 'function' ? 0 : E.setFields(loadFields(dataDir));
module.exports = { aircraft, countryOfHex, HEX_COUNTRY, loadFields, withFields };
