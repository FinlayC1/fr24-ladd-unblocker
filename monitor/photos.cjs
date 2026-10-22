// The pictures of blocked aircraft the browsers found (JetPhotos', Planespotters', FR24's own JetPhotos ones), kept here
// and handed to every browser at once - a LADD aircraft's panel opens with its pictures, never waiting for a lookup the
// browser before already made. Only pictures on those sites' own addresses are taken (nothing else is ever drawn from
// here), three an aircraft, the browser's newest list replacing the one kept. A stranger's browser on a public monitor is
// held to a budget (the allowance it is given). Kept on disk (photos.json), the aircraft longest unasked-for let go
// first past 30,000.
const fs = require('fs'), path = require('path');
const HOSTS = /^https:\/\/(cdn\.jetphotos\.com|www\.jetphotos\.com|t\.plnspttrs\.net|cdn\.planespotters\.net|www\.planespotters\.net)\//;
const SOURCES = new Set(['JetPhotos', 'Planespotters', 'Flightradar24']);
const text = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n) : '';
const url = v => typeof v === 'string' && v.length <= 300 && HOSTS.test(v) ? v : '';

function createPhotos(cfg) {
  const C = Object.assign({ max: 30000, per: 3, keepDays: 120 }, cfg || {});
  const P = new Map();   // hex -> { photos: [{ link, credit, large, medium, thumb, source }], at, asked }
  const stats = { put: 0, refused: 0, served: 0 };
  let dirty = false;
  // (a picture as a browser sent it - every address one of those sites', its credit plain text; null: not taken)
  function clean(p) {
    if (!p || typeof p !== 'object') return null;
    const large = url(p.large), medium = url(p.medium) || large, thumb = url(p.thumb) || medium, link = url(p.link) || large;
    const source = SOURCES.has(p.source) ? p.source : '', credit = text(p.credit, 80);
    if (!large || !source) return null;
    // (FR24's stock picture of a type is "Flightradar24" with no JetPhotos page: no picture of the aircraft)
    if (/^\W*flightradar\s*24\W*$/i.test(credit) && !/jetphotos/i.test(link + large)) return null;
    return { link, credit, large, medium, thumb, source };
  }
  // rows: [[hex, [photo...]]] from one browser; allow(): may one more be taken from it
  function put(rows, nowMs, allow) {
    let n = 0;
    for (const r of Array.isArray(rows) ? rows.slice(0, 200) : []) {
      if (!Array.isArray(r)) continue;
      const hex = String(r[0] || '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) continue;
      const list = (Array.isArray(r[1]) ? r[1] : []).map(clean).filter(Boolean).slice(0, C.per);
      if (!list.length) { stats.refused++; continue; }
      const cur = P.get(hex);
      if (cur && JSON.stringify(cur.photos) === JSON.stringify(list)) { cur.at = nowMs; continue; }
      if (allow && !allow()) break;
      P.set(hex, { photos: list, at: nowMs, asked: cur ? cur.asked : 0 }); n++; stats.put++; dirty = true;
    }
    if (P.size > C.max) { dirty = true; const by = [...P].sort((a, b) => Math.max(a[1].at, a[1].asked) - Math.max(b[1].at, b[1].asked)); for (const [h] of by.slice(0, P.size - C.max)) P.delete(h); }
    return n;
  }
  function get(hexes, nowMs) {
    const out = [];
    for (const h of hexes) { const x = P.get(h); if (!x) continue; x.asked = nowMs; out.push({ hex: h, photos: x.photos, at: x.at }); }
    stats.served += out.length;
    return out;
  }
  // (written when something new came - not on every round: it is a few MB)
  function save(dir) {
    if (!dirty) return; dirty = false;
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'photos.json'); fs.writeFileSync(f + '.tmp', JSON.stringify({ v: 1, list: [...P] })); fs.renameSync(f + '.tmp', f);
  }
  function load(dir, nowMs) {
    let j = null; try { j = JSON.parse(fs.readFileSync(path.join(dir, 'photos.json'), 'utf8')); } catch (e) { return 0; }
    const old = nowMs - C.keepDays * 86400e3;
    for (const [h, x] of (j && Array.isArray(j.list) ? j.list : [])) {
      if (!/^[0-9a-f]{6}$/.test(h) || !x || !Array.isArray(x.photos) || Math.max(x.at || 0, x.asked || 0) < old) continue;
      const list = x.photos.map(clean).filter(Boolean); if (list.length) P.set(h, { photos: list, at: x.at || 0, asked: x.asked || 0 });
    }
    return P.size;
  }
  return { put, get, save, load, clean, stats, size: () => P.size };
}
module.exports = { createPhotos };
