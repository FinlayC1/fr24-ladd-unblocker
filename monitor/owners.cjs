// The owner and operator of every blocked aircraft, looked up once on the server and kept for good - so a browser never
// has to ask the registers about an aircraft any browser (or the server) has already asked about.
//
//   looked up here   every blocked aircraft the monitor knows (the LADD list, FR24's callsign-less flights it names) - the
//                    ones flying now first - from hexdb.io, adsbdb.com and the aircraft's own register (the FAA's for N-,
//                    the UK's G-INFO, the Isle of Man's, the Swiss): src/registry.js, the same code the userscript reads
//                    them with. Gently: one aircraft every few seconds, each site at its own pace, a site that refuses or
//                    rate-limits left alone a while.
//   from browsers    what a browser found itself (its registers, FR24's own operator for the aircraft) comes with its
//                    report (/report "owners") and is kept too.
//   to browsers      /owners?hex=a,b,c - and each name in the names table (/fr24ids) carries its owner and operator.
// Kept: STORE/owners.json. Asked again after 60 days (aircraft change hands); a register that did not answer, in an hour.
// Names only - an owner's address is never read or kept (the FAA owner's city and state, as the userscript shows them).
const fs = require('fs'), path = require('path');

const FIELDS = ['reg', 'type', 'desc', 'owner', 'ownerCity', 'country', 'countryIso', 'msn', 'year', 'opId', 'opIcao', 'opName'];
// (a name that is a company, trust, bank, operator, club or public body - not a private person's)
const ORG = /\b(LLC|L\s?L\s?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP|PLC|GMBH|AG|SA|SAS|SARL|SRL|SPA|BV|NV|AB|AS|ASA|APS|OY|OYJ|KG|KFT|SRO|PTY|PTE|LTDA|BHD|KK|TRUST|TRUSTEES?|BANK|BANCORP|AVIATION|AVIATIONS|AERO|AEROSPACE|AIR|AIRLINES?|AIRWAYS|JETS?|FLIGHT|FLIGHTS|FLYING|HOLDINGS?|LEASING|LEASE|CAPITAL|FINANCE|FINANCIAL|FUND|GROUP|SERVICES?|MANAGEMENT|MGMT|PARTNERS|PARTNERSHIP|INVESTMENTS?|ENTERPRISES?|INDUSTRIES|FOUNDATION|UNIVERSITY|COLLEGE|SCHOOL|ACADEMY|INSTITUTE|COUNTY|STATE|CITY|DEPARTMENT|DEPT|GOVERNMENT|POLICE|SHERIFF|FIRE|RESCUE|AMBULANCE|HOSPITAL|MEDICAL|HEALTH|FORCE|NAVY|ARMY|MINISTRY|AGENCY|AUTHORITY|COUNCIL|COMMISSION|HELICOPTERS?|HELI|CHARTER|CLUB|ASSOCIATION|SOCIETY|CHURCH|MINISTRIES|DEVELOPMENT|PROPERTIES|PROPERTY|VENTURES?|SYSTEMS|TECHNOLOGIES|TECHNOLOGY|INTERNATIONAL|INTL|GLOBAL|SOLUTIONS|ASSETS|EQUIPMENT|MOTORS|ENERGY|OIL|GAS|MINING|CONSTRUCTION|FARMS?|RANCH|AIRCRAFT|OPERATIONS|LOGISTICS|EXPRESS|TRANSPORT|CARGO|FSB|ESTATE|ESTATES|INVEST|ASSOCIATES|CONSULTING|MEDIA|SPORTS|RACING|TEAM|LABS?)\b/i;
const orgName = s => ORG.test(String(s || ''));
const str = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n || 120) : '';

function createOwners(env) {
  const C = Object.assign({ every: 4000, refreshDays: 60, retryMin: 60, queueMax: 60000, timeoutMs: 15000 }, env.cfg || {});
  const db = new Map();          // hex -> { reg, type, desc, owner, ownerCity, country, countryIso, msn, year, opId, opIcao, opName, at, ok, src, failAt, chg }
  const q = [], queued = new Set(), regHint = new Map();
  const stats = { looked: 0, failed: 0, fromClients: 0, asked: {}, refused: {} };
  let dirty = false;
  const nowS = () => Math.round(Date.now() / 1000);
  const PH = () => REG.NAME_PLACEHOLDER;
  const named = o => !!o && !PH().test(o);

  // ---- the requests: each site at its own pace; one that refuses or rate-limits left alone a while --------------------
  const GAP = { 'hexdb.io': 1500, 'api.adsbdb.com': 1500 }, next = new Map(), paused = new Map();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function ask(url, o) {
    o = o || {};
    const host = new URL(url).host, t = Date.now();
    if ((paused.get(host) || 0) > t) throw new Error('host paused');
    const at = Math.max(t, next.get(host) || 0); next.set(host, at + (GAP[host] || 3000));
    if (at > t) await sleep(at - t);
    stats.asked[host] = (stats.asked[host] || 0) + 1;
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), o.timeout || C.timeoutMs);
    let r, text;
    try {
      r = await env.fetch(url, { method: o.method || 'GET', body: o.body == null ? undefined : o.body, signal: ac.signal,
        headers: Object.assign({ Accept: o.accept || 'application/json', 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'fr24-ladd-monitor (aircraft owner names; one request every few seconds)' }, o.headers || {}) });
      if (r.status === 429) { paused.set(host, Date.now() + 10 * 60000); stats.refused[host] = (stats.refused[host] || 0) + 1; }
      if (r.status === 401 || r.status === 403) { paused.set(host, Date.now() + 60 * 60000); stats.refused[host] = (stats.refused[host] || 0) + 1; }
      if (!(r.status >= 200 && r.status < 300)) throw new Error('HTTP ' + r.status);
      text = await r.text();
    } finally { clearTimeout(timer); }
    return o.json === false ? text : JSON.parse(text);
  }
  const REG = env.createRegistry(ask, { memo: false, log: env.log });

  // ---- what is known -----------------------------------------------------------------------------------------------
  function due(hex, t) {
    const r = db.get(hex); t = t || nowS();
    if (!r || !r.at) return true;
    if (!r.ok) return t - (r.failAt || 0) > C.retryMin * 60;
    return t - r.at > C.refreshDays * 86400;
  }
  // (an aircraft to look up: the ones flying now to the front; its registration as known, for its register)
  function want(hex, reg, front) {
    hex = String(hex || '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) return false;
    if (reg) regHint.set(hex, String(reg).toUpperCase());
    if (!due(hex)) return false;
    if (queued.has(hex)) { if (front) { const i = q.indexOf(hex); if (i > 0) { q.splice(i, 1); q.unshift(hex); } } return true; }
    if (q.length >= C.queueMax) return false;
    queued.add(hex); if (front) q.unshift(hex); else q.push(hex);
    return true;
  }
  function changed(hex, r) { r.chg = Date.now(); dirty = true; if (env.onChange) env.onChange(hex, r); }
  // (a lookup's answer: a register's owner over an older one - aircraft change hands - the databases' only where none)
  function fromLookup(hex, idn, t) {
    const r = db.get(hex) || {}; db.set(hex, r);
    for (const k of ['reg', 'type', 'desc', 'ownerCity', 'country', 'countryIso', 'msn']) { const v = str(idn[k]); if (v && !r[k]) r[k] = v; }
    if (idn.year > 1900 && idn.year < 2100 && !r.year) r.year = Math.round(idn.year);
    const o = str(idn.owner); if (named(o) && (idn.ownerReg || !r.regOwner)) { r.owner = o; r.regOwner = !!idn.ownerReg; }
    r.at = t; r.ok = !!idn.regAnswered || !idn.regFailed; r.src = r.src === 'client' ? 'client+server' : 'server';
    if (r.ok) delete r.failAt; else r.failAt = t;
    changed(hex, r);
  }
  // One aircraft looked up (the next in the queue). Returns its hex, or '' when there was none.
  let busy = false;
  async function pumpOne() {
    if (busy) return ''; busy = true;
    try {
      let hex = ''; while (q.length) { const h = q.shift(); queued.delete(h); if (due(h)) { hex = h; break; } }
      if (!hex) return '';
      const r = db.get(hex) || {}, reg = regHint.get(hex) || r.reg || '';
      let idn;
      try { idn = await REG.identity({ hex, reg, faaAt: 0 }, {}); } catch (e) { idn = { regFailed: true }; }
      stats.looked++; if (idn.regFailed && !idn.regAnswered) stats.failed++;
      fromLookup(hex, idn, nowS()); regHint.delete(hex);
      return hex;
    } finally { busy = false; }
  }
  // A browser's own findings: [hex, { reg, type, desc, owner, ownerCity, country, countryIso, msn, year, operatorId,
  // operatorIcao, operatorName, regAnswered, regOwner }] - the gaps filled, FR24's operator taken, its register's owner
  // taken when this side has none from a register
  // From anyone's browser (a public monitor: reporter = the browser's address): taken once `need` different browsers sent
  // the very same findings for the aircraft - two honest ones reading the same registers agree; one alone is held a while.
  const pend = new Map();         // hex -> { at, by: Map(findings key -> Set(reporter)) }
  const keyOf = o => JSON.stringify(['reg', 'type', 'desc', 'owner', 'ownerCity', 'country', 'countryIso', 'msn', 'year', 'operatorId', 'operatorIcao', 'operatorName', 'regOwner'].map(k => o[k] == null ? '' : String(o[k]).trim().toUpperCase()));
  function fromClient(list, reporter, need) {
    let n = 0; const t = Date.now();
    // (findings waiting for a second browser - and the addresses that sent them - kept six hours at most)
    for (const [h, p] of pend) if (t - p.at > 6 * 3600e3) pend.delete(h);
    for (const x of (Array.isArray(list) ? list : []).slice(0, 2000)) {
      if (!Array.isArray(x) || !x[1] || typeof x[1] !== 'object') continue;
      const hex = String(x[0] || '').toLowerCase(), o = x[1]; if (!/^[0-9a-f]{6}$/.test(hex)) continue;
      if (reporter && (need || 2) > 1) {
        let p = pend.get(hex); if (!p) { p = { at: t, by: new Map() }; pend.set(hex, p); if (pend.size > 20000) pend.delete(pend.keys().next().value); }
        p.at = t; const k = keyOf(o); let set = p.by.get(k); if (!set) p.by.set(k, set = new Set()); set.add(String(reporter));
        if (set.size < (need || 2)) { stats.crowdPending = pend.size; continue; }
        pend.delete(hex);
      }
      const r = db.get(hex) || {}, before = JSON.stringify(r);
      for (const k of ['reg', 'type', 'desc', 'ownerCity', 'country', 'countryIso', 'msn']) { const v = str(o[k]); if (v && !r[k]) r[k] = k === 'reg' || k === 'type' ? v.toUpperCase() : v; }
      if (o.year > 1900 && o.year < 2100 && !r.year) r.year = Math.round(o.year);
      const ow = str(o.owner); if (named(ow) && (!named(r.owner) || (o.regOwner && !r.regOwner))) { r.owner = ow; r.regOwner = !!o.regOwner; }
      if (+o.operatorId > 0) r.opId = Math.round(+o.operatorId);
      { const v = str(o.operatorIcao, 4).toUpperCase(); if (/^[A-Z0-9]{2,4}$/.test(v)) r.opIcao = v; }
      { const v = str(o.operatorName); if (v) r.opName = v; }
      if (o.regAnswered && !r.ok) { r.ok = true; r.at = nowS(); delete r.failAt; }
      if (!r.src) r.src = 'client';
      if (JSON.stringify(r) === before) continue;
      db.set(hex, r); changed(hex, r); n++;
    }
    stats.fromClients += n;
    return n;
  }
  // rows: [hex, reg, type, desc, owner, owner's city, country, country ISO, serial number, build year, FR24 operator id,
  //        operator ICAO, operator name, looked up at, registers answered (1/0), owner withheld (1/0)]
  // To anyone but the monitor's owner (opts.public), a private person's name is withheld - and their city with it: a
  // company, trust, bank, operator, club or public body is named, a person is not (each browser can still look a person
  // up in the register itself, for its own use). Personal data served to the public needs a reason a name does not have.
  const row = (hex, r, pub) => { const wh = !!pub && named(r.owner) && !orgName(r.owner); return [hex, r.reg || '', r.type || '', r.desc || '', wh ? '' : r.owner || '', wh ? '' : r.ownerCity || '', r.country || '', r.countryIso || '', r.msn || '', r.year || 0, r.opId || 0, r.opIcao || '', r.opName || '', r.at || 0, r.ok ? 1 : 0, wh ? 1 : 0]; };
  function rows(hexes, opts) { const out = [], pub = !!(opts && opts.public); for (const h of hexes) { const hex = String(h || '').toLowerCase(), r = db.get(hex); if (r) out.push(row(hex, r, pub)); } return out; }
  // (for the names table, which every browser gets: who it is - the owner if not a private person, the operator)
  function short(hex) { const r = db.get(hex); return r ? { owner: named(r.owner) && orgName(r.owner) ? r.owner : '', opName: r.opName || '', opId: r.opId || 0, opIcao: r.opIcao || '' } : null; }

  // ---- kept on disk ---------------------------------------------------------------------------------------------------
  function save(dir) {
    if (!dirty) return false;
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'owners.json'), out = [];
    for (const [hex, r] of db) { const o = {}; for (const k of FIELDS.concat(['at', 'ok', 'src', 'failAt', 'regOwner'])) if (r[k] != null && r[k] !== '' && r[k] !== 0 && r[k] !== false) o[k] = r[k]; out.push([hex, o]); }
    fs.writeFileSync(f + '.tmp', JSON.stringify({ v: 1, list: out })); fs.renameSync(f + '.tmp', f);
    dirty = false; return true;
  }
  function load(dir) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, 'owners.json'), 'utf8')); } catch (e) { return 0; }
    if (!j || j.v !== 1 || !Array.isArray(j.list)) return 0;
    for (const [hex, o] of j.list) if (/^[0-9a-f]{6}$/.test(hex) && o && typeof o === 'object') db.set(hex, Object.assign({ chg: 0 }, o));
    return db.size;
  }
  function status() { let withOwner = 0, withOp = 0; for (const r of db.values()) { if (named(r.owner)) withOwner++; if (r.opId || r.opName) withOp++; } return Object.assign({ known: db.size, withOwner, withOperator: withOp, queue: q.length, paused: Object.fromEntries([...paused].filter(([, t]) => t > Date.now()).map(([h, t]) => [h, Math.round((t - Date.now()) / 1000)])) }, stats); }
  return { C, db, q, want, due, pumpOne, fromLookup, fromClient, rows, short, save, load, status, stats, REG, ask, pend, orgName };
}
module.exports = { createOwners };
