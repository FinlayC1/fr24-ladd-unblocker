'use strict';
// (1.3) Every airport in OurAirports that is not closed - airports, airfields and strips, heliports, seaplane and balloon
// bases - that FR24 does not list, as airports of their own: its ICAO code (else its GPS code, else OurAirports' own
// ident) and name, where it is, its height, the nearest FR24 airport (whose country and time zone it takes). Each with
// the id the route engine gives it (engine.js fieldId - the airfields the engine already knows keep theirs), so a flight
// the engine sends to one ends at that same airport everywhere: FR24's airport list in the browser, its boards and panel,
// the monitor's boards, logs and weather (apwx.cjs).
// "FR24 lists it" as the engine reads it: its code is an FR24 airport's, or it lies within that airport's own reach.
// GET /oaap gives the list once a browser starts (kept a week there): { v, at, n, rows: [[id, code, ident, name, city,
// ref (nearest FR24 airport id), lat, lon, ft, kind (L large, M medium, S small, H heliport, W seaplane base, B balloon),
// icao (1.3.4: 1 when OurAirports gives it an ICAO code of its own - not a GPS or local code), region (1.3.4: its ISO
// region, "GB-ENG", "US-ID" - its country and state in FR24's airport lists)]] }
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { fetchFile, readMeta, writeMeta, linesOf, SRC } = require('./oarwy.cjs');
const KIND = { large_airport: 'L', medium_airport: 'M', small_airport: 'S', heliport: 'H', seaplane_base: 'W', balloonport: 'B' };

function cells(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}

function createOaAirports(env) {
  const { E } = env, now = env.now || (() => Date.now());
  // (1.3.2: OurAirports' file as last fetched is kept in the monitor's store - env.storeDir - and read from there; the
  // checkout's own copy is what a new monitor starts from, and is never written: 1.3.1 wrote the new file over it, and a
  // file of the checkout changed stops the next deploy ("files of the checkout were changed by hand"))
  const repoFile = path.join(env.dataDir, 'oa_airports.csv'), storeFile = env.storeDir ? path.join(env.storeDir, 'oa_airports.csv') : repoFile;
  const fileNow = () => (storeFile !== repoFile && fs.existsSync(storeFile) ? storeFile : repoFile);
  let list = null, byId = new Map(), gz = null, at = 0, building = null;
  const stats = { rows: 0, builtAt: 0, buildMs: 0, fileAt: 0, checkedAt: 0, fetched: 0, unchanged: 0, fails: 0, lastErr: '', etag: '' };
  const pause = () => new Promise(r => setImmediate(r));
  // the airports, worked out from the file (the engine's FR24 airports and fields loaded first): the file read, then a
  // row at a time (step) - in one go (makeSync), or a slice at a time with the server answering in between (make: 1.3.1 -
  // 1.2 s in one go, the first time a browser asked)
  function prepare() {
    const c = { lines: [], out: [], ids: new Map(), taken: new Set(), fr24Iata: new Set(), fr24Code: new Set(), col: null };
    const file = fileNow();
    if (!fs.existsSync(file) || typeof E.fieldId !== 'function') return c;
    c.lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const head = cells(c.lines[0] || ''), ix = k => head.indexOf(k);
    c.col = ['type', 'name', 'latitude_deg', 'longitude_deg', 'elevation_ft', 'municipality', 'icao_code', 'gps_code', 'ident', 'iata_code', 'iso_region'].map(ix);
    for (const a of E.airports) if (a.id < 1e7) { if (a.iata) { c.fr24Iata.add(String(a.iata).toUpperCase()); c.fr24Code.add(String(a.iata).toUpperCase()); } if (a.icao) c.fr24Code.add(String(a.icao).toUpperCase()); }
    return c;
  }
  function step(c, i) {
    const l = c.lines[i]; if (!l) return;
    const [cT, cN, cLa, cLo, cE, cM, cI, cG, cId, cA, cR] = c.col;
    const r = cells(l), kind = KIND[r[cT]]; if (!kind) return;                 // (closed ones, and anything else, left out)
    const lat = +r[cLa], lon = +r[cLo]; if (!Number.isFinite(lat) || !Number.isFinite(lon) || r[cLa] === '' || r[cLo] === '') return;
    // (its code: its ICAO code, else its GPS code, else OurAirports' own ident - "GB-0674", a field with neither)
    const ident = String(r[cI] || r[cG] || r[cId] || '').toUpperCase().trim(); if (!ident) return;
    const own = E.byIcao(ident); if (own && own.id < 1e7) return;             // (FR24 lists it by its code)
    const iata = String(r[cA] || '').toUpperCase().trim(); if (iata && c.fr24Iata.has(iata)) return;
    // (inside an FR24 airport's own reach - 2.5 km, more for a big one: part of that airport, as the engine has it)
    let listed = false;
    E.nearby(lat, lon, 5.5, (a, d) => { if (a.id < 1e7 && d <= Math.max(2.5, 1.5 + Math.min(3.5, Math.log10(1 + (a.size || 0)) * 0.7) + 0.5)) listed = true; });
    if (listed) return;
    const id = E.fieldId(ident); if (c.ids.has(id)) return;
    const ref = E.airportAt(lat, lon, 300), refId = ref && ref.airport && ref.airport.id < 1e7 ? ref.airport.id : 0;
    // (its code as shown and in its address: never one of FR24's own airports' codes, never another of these)
    const oaId = String(r[cId] || '').toUpperCase().trim(), code = [/^[A-Z]{3}$/.test(iata) ? iata : '', ident, oaId].find(k => k && !c.fr24Code.has(k) && !c.taken.has(k)) || ('OA' + id);
    c.taken.add(code);
    const row = [id, code, ident, String(r[cN] || ident), String(r[cM] || ''), refId, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, Math.round(+r[cE] || 0), kind, /^[A-Z0-9]{4}$/.test(String(r[cI] || '').trim().toUpperCase()) ? 1 : 0, String(cR >= 0 && r[cR] || '').toUpperCase().slice(0, 8)];
    c.out.push(row); c.ids.set(id, row);
  }
  function makeSync() { const c = prepare(); for (let i = 1; i < c.lines.length; i++) step(c, i); return c; }
  async function make() {
    const c = prepare(); let t = Date.now();
    for (let i = 1; i < c.lines.length; i++) { step(c, i); if (Date.now() - t >= 12) { await pause(); t = Date.now(); } }
    return c;
  }
  function put(c) { list = c.out; byId = c.ids; at = now(); gz = null; stats.rows = list.length; stats.builtAt = at; }
  // (the list as it is now - worked out in one go only when asked for before any has been)
  function rows() {
    if (!list) { const t0 = Date.now(); put(makeSync()); stats.buildMs = Date.now() - t0; }
    return list;
  }
  // a slow build, kept to one at a time; its gzip made off the main thread, then the new list put in its place whole
  function rebuild() {
    if (building) return building;
    const t0 = Date.now();
    building = make().then(c => new Promise(res => {
      const t1 = now(), body = Buffer.from(JSON.stringify({ v: 1, at: t1, n: c.out.length, rows: c.out }));
      zlib.gzip(body, (err, z) => { put(c); at = t1; gz = err ? null : z; stats.buildMs = Date.now() - t0; res(list.length); });
    })).finally(() => { building = null; });
    return building;
  }
  const get = id => { const r = (rows(), byId.get(id)); if (!r) return null;
    return { id: r[0], iata: r[1] === r[2] ? '' : r[1], icao: r[2], code: r[1], name: r[3], city: r[4], lat: r[6], lon: r[7], alt: r[8], kind: r[9], ref: r[5], hasIcao: r[10] === 1 }; };
  function body() { if (!gz) gz = zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, at, n: rows().length, rows: rows() }))); return gz; }
  // (1.3.1) GET /oaap?have=<at>: the browser's list is this one - a few bytes back, not the 2 MB
  function same(have) { return !!list && +have === at; }
  // (1.3.1) OurAirports' own file, asked for again (1.3.2: every hour): only for what changed (its ETag), written whole when it has, and the
  // list worked out again from it. A file that is not one (too short, another header) is never put in its place
  async function refresh(fetchFn, o) {
    o = o || {};
    if (typeof fetchFn !== 'function') return false;
    if (!o.force && now() - stats.checkedAt < (o.everyMs || 24 * 3600e3)) return false;
    stats.checkedAt = now();
    try {
      // (its ETag kept with the file in the store, so a monitor started again asks only for what changed)
      const meta = env.storeDir ? readMeta(env.storeDir) : { 'oa_airports.csv': stats.etag };
      const text = await fetchFile(fetchFn, o.url || SRC + 'airports.csv', storeFile, meta, 'oa_airports.csv',
        t => (linesOf(t) < 50000 || !/^"?id"?,"?ident"?,"?type"?,"?name"?,"?latitude_deg"?/.test(t) ? 'not the airports file (' + linesOf(t) + ' lines)' : ''));
      stats.etag = meta['oa_airports.csv'] || ''; if (env.storeDir) writeMeta(env.storeDir, meta);
      if (text === null) { stats.unchanged++; return false; }
      stats.fetched++; stats.fileAt = now();
      await rebuild();
      return true;
    } catch (e) { stats.fails++; stats.lastErr = String(e && e.message || e).slice(0, 120); return false; }
  }
  return { rows, get, body, same, rebuild, refresh, stats, get file() { return fileNow(); }, get at() { return at; }, get size() { return rows().length; } };
}
module.exports = { createOaAirports };
