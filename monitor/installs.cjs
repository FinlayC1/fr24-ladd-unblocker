// Installs counted, anonymously (POST /hello). Each copy of the script or extension makes up a random id once (32 hex
// characters, kept in that browser only) and sends it with its version, its kind (extension or userscript), the userscript
// manager running it and the browser and system families - at most every 12 hours and when its version changes. Nothing
// about flights or what it looked at, and never its address: the address is only used to tell networks apart, as a salted
// hash (HMAC-SHA256 with a random 32-byte key made once on this server, STORE/hello-salt, the first 16 hex characters).
// No double counting: installs are the distinct ids; people are the ids joined by any network they share (union-find) -
// a reinstall (a new id from the same network) or one id seen from home and from work counts once.
// Kept in STORE/installs.json: per id { first, last (ms), ver, kind, handler, browser, os, nets: the last 8 networks (newest
// first), n: hellos }, for 400 days after it was last seen, 200,000 ids at most (the longest unseen dropped first); the ids
// seen today (for the day's active count) and each finished day's active people and installs.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DAY = 86400e3;
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const KEYS = ['id', 'ver', 'kind', 'handler', 'browser', 'os'];
const KINDS = ['ext', 'us'], BROWSERS = ['chrome', 'edge', 'brave', 'opera', 'firefox', 'safari', 'other'], OSES = ['windows', 'mac', 'linux', 'android', 'ios', 'other'];
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
// (a version "x.y.z" against another: -1, 0, 1; '' is older than any)
const cmpVer = (a, b) => { const x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; };
// (a hello as sent, checked strictly: these six fields and no other, each as the contract has it - null: refused)
function valid(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const ks = Object.keys(d); if (ks.length !== KEYS.length || !KEYS.every(k => ks.includes(k))) return null;
  if (typeof d.id !== 'string' || !/^[0-9a-f]{32}$/.test(d.id)) return null;
  if (typeof d.ver !== 'string' || !VER_RE.test(d.ver)) return null;
  if (!KINDS.includes(d.kind) || !BROWSERS.includes(d.browser) || !OSES.includes(d.os)) return null;
  if (typeof d.handler !== 'string' || !/^[\x20-\x7e]{0,24}$/.test(d.handler)) return null;
  return { id: d.id, ver: d.ver, kind: d.kind, handler: d.handler.trim(), browser: d.browser, os: d.os };
}
// (an address as its network: IPv4 whole; IPv6 by its first 64 bits - the part a home or a phone keeps while the rest
// changes every day)
function netOf(ip) {
  let s = String(ip || '').trim().toLowerCase().replace(/%.*$/, '');
  if (s.startsWith('::ffff:') && s.includes('.')) s = s.slice(7);
  if (!s.includes(':')) return s;
  const [h, t] = s.split('::'), head = h ? h.split(':') : [], tail = t ? t.split(':') : [];
  const all = s.includes('::') ? head.concat(Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail) : head;
  return all.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

function createInstalls(env) {
  const file = path.join(env.store, 'installs.json'), saltFile = path.join(env.store, 'hello-salt');
  const max = env.max || 200000, keep = (env.keepDays || 400) * DAY;
  const ids = new Map();                    // id -> { first, last, ver, kind, handler, browser, os, nets, n }
  let today = { day: '', ids: new Set() }; // the ids seen today
  const hist = {};                          // 'YYYY-MM-DD' -> [active people, active installs] of a finished day
  let salt = null, dirty = false, savedAt = 0;
  const stats = { hellos: 0, refused: 0 };
  function key() {
    if (salt) return salt;
    fs.mkdirSync(env.store, { recursive: true });
    try { fs.writeFileSync(saltFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    try { fs.chmodSync(saltFile, 0o600); } catch (e) { /* not this system */ }
    salt = Buffer.from(fs.readFileSync(saltFile, 'utf8').trim(), 'hex');
    if (salt.length < 16) throw new Error('hello-salt unreadable');
    return salt;
  }
  const netHash = ip => crypto.createHmac('sha256', key()).update(netOf(ip)).digest('hex').slice(0, 16);
  // (each id's group: ids sharing a network joined - Map id -> its group's first id)
  function groups() {
    const list = [...ids.keys()], par = list.map((_, i) => i), byNet = new Map();
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    list.forEach((id, i) => { for (const h of ids.get(id).nets) { const j = byNet.get(h); if (j == null) byNet.set(h, i); else { const a = find(i), b = find(j); if (a !== b) par[a] = b; } } });
    const out = new Map(); list.forEach((id, i) => out.set(id, list[find(i)])); return out;
  }
  // (a new day: the one before kept as its active people and installs)
  function roll(now) {
    const d = dayOf(now); if (today.day === d) return;
    if (today.day && today.ids.size) { const g = groups(); hist[today.day] = [new Set([...today.ids].filter(id => g.has(id)).map(id => g.get(id))).size, today.ids.size]; }
    today = { day: d, ids: new Set() }; dirty = true;
  }
  function prune(now) {
    for (const [id, r] of ids) if (now - r.last > keep) { ids.delete(id); today.ids.delete(id); }
    if (ids.size > max) { const old = [...ids].sort((a, b) => a[1].last - b[1].last).slice(0, ids.size - Math.floor(max * 0.95)); for (const [id] of old) { ids.delete(id); today.ids.delete(id); } }
    for (const d of Object.keys(hist)) if (now - Date.parse(d) > keep) delete hist[d];
  }
  // one hello, already checked (valid()), from address ip: kept
  function hello(h, ip, now) {
    now = now || Date.now(); roll(now); stats.hellos++;
    const net = netHash(ip); let r = ids.get(h.id);
    if (!r) { ids.set(h.id, r = { first: now, last: now, ver: h.ver, kind: h.kind, handler: h.handler, browser: h.browser, os: h.os, nets: [], n: 0 }); if (ids.size > max) prune(now); }
    Object.assign(r, { last: now, ver: h.ver, kind: h.kind, handler: h.handler, browser: h.browser, os: h.os }); r.n++;
    r.nets = [net].concat(r.nets.filter(x => x !== net)).slice(0, 8);
    today.ids.add(h.id); dirty = true;
  }
  function save(final) {
    if (!dirty || (!final && Date.now() - savedAt < 60000)) return false;
    const now = Date.now(); prune(now);
    fs.mkdirSync(env.store, { recursive: true });
    const rows = {}; for (const [id, r] of ids) rows[id] = [r.first, r.last, r.ver, r.kind, r.handler, r.browser, r.os, r.n, r.nets];
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, saved: now, fields: ['first', 'last', 'ver', 'kind', 'handler', 'browser', 'os', 'n', 'nets'], ids: rows, today: { day: today.day, ids: [...today.ids] }, hist }));
    fs.renameSync(tmp, file); dirty = false; savedAt = now;
    return true;
  }
  function load() {
    let s; try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return 0; }
    for (const [id, a] of Object.entries(s.ids || {})) if (/^[0-9a-f]{32}$/.test(id) && Array.isArray(a)) ids.set(id, { first: +a[0] || 0, last: +a[1] || 0, ver: String(a[2] || ''), kind: String(a[3] || ''), handler: String(a[4] || ''), browser: String(a[5] || ''), os: String(a[6] || ''), n: +a[7] || 0, nets: Array.isArray(a[8]) ? a[8].map(String).slice(0, 8) : [] });
    if (s.today && s.today.day) today = { day: s.today.day, ids: new Set((s.today.ids || []).filter(id => ids.has(id))) };
    Object.assign(hist, s.hist || {});
    return ids.size;
  }
  // the counts: everyone kept, those active in the last day / week / 30 days, new installs and active people by day (60
  // days), and the installs of the last 30 days by version, kind, browser, system and manager - with how many run a
  // version older than `latest`
  function summary(now, latest) {
    now = now || Date.now(); roll(now);
    const g = groups(), people = new Set(g.values()).size;
    const act = ms => { const sel = [...ids].filter(([, r]) => now - r.last <= ms); return { people: new Set(sel.map(([id]) => g.get(id))).size, installs: sel.length }; };
    const days = []; for (let i = 59; i >= 0; i--) days.push(dayOf(now - i * DAY));
    const newBy = {}; for (const r of ids.values()) { const d = dayOf(r.first); newBy[d] = (newBy[d] || 0) + 1; }
    const todayPeople = new Set([...today.ids].map(id => g.get(id))).size;
    const recent = [...ids.values()].filter(r => now - r.last <= 30 * DAY);
    const by = {}; for (const k of ['ver', 'kind', 'browser', 'os', 'handler']) { const c = {}; for (const r of recent) { const v = r[k] || '-'; c[v] = (c[v] || 0) + 1; } by[k] = Object.entries(c).sort((a, b) => k === 'ver' ? cmpVer(b[0], a[0]) : b[1] - a[1]); }
    const old = latest ? recent.filter(r => cmpVer(r.ver, latest) < 0) : [];
    return { installs: ids.size, people, active: { d1: act(DAY), d7: act(7 * DAY), d30: act(30 * DAY) },
      newPerDay: days.map(d => [d, newBy[d] || 0]), activePerDay: days.map(d => d === today.day ? [d, todayPeople, today.ids.size] : [d].concat(hist[d] || [null, null])),
      by, outdated: { installs: old.length, of: recent.length, latest: latest || '' }, hellos: stats.hellos };
  }
  // the most recently seen installs, the id cut to 8 characters, with their group's number (1: the group of the most
  // recently seen) and size - never an address, never a network
  function recent(limit, g) {
    g = g || groups();
    const size = new Map(); for (const r of g.values()) size.set(r, (size.get(r) || 0) + 1);
    const num = new Map();
    return [...ids].sort((a, b) => b[1].last - a[1].last).slice(0, limit || 500).map(([id, r]) => {
      const root = g.get(id); if (!num.has(root)) num.set(root, num.size + 1);
      return { id: id.slice(0, 8), ver: r.ver, kind: r.kind, handler: r.handler, browser: r.browser, os: r.os, first: r.first, last: r.last, n: r.n, cluster: num.get(root), size: size.get(root) };
    });
  }
  return { hello, save, load, summary, recent, groups, stats, get size() { return ids.size; }, get dirty() { return dirty; } };
}
module.exports = { createInstalls, valid, netOf, cmpVer };
