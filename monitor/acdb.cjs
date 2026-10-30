'use strict';
// Every aircraft in the world (1.1.1): its registration, type, model, serial number, build year, owner and operator - from
// the open aircraft databases, merged and kept on disk, so any aircraft opened in any browser has them at once (/owners).
//
//   tar1090-db       wiedehopf's database (github.com/wiedehopf/tar1090-db): every address seen worldwide - registration,
//                    type, description, build year, owner or operator
//   ADS-B Exchange   its basic aircraft database (downloads.adsbexchange.com): registration, type, model, build year,
//                    owner or operator
//   OpenSky          its aircraft database (the newest "complete" one in its public bucket): serial number, build date,
//                    owner, operator - months old: only what the others leave out, and only where the registration and type agree
//   Transport Canada its civil aircraft register (CCARCS, every C- aircraft): serial number, date built, owner and their city
//   FAA              its aircraft registry (ReleasableAircraft.zip, every N- aircraft): serial number, year built, owner and
//                    their city and state - where the server can reach it
// The registers last, over the databases: what a register says of its own aircraft stands. Names only - an owner's street,
// postcode or any other part of an address is never read into what is kept (a city and state at most, as the FAA's
// register and the userscript's own lookups give them). Rebuilt once a week (each source as it is then), atomically: the old file serves until
// the new one is whole.
//
// The file (STORE/acdb/acdb.bin): [4 bytes: header length][header JSON: { v, at, n, nb, src }][nb records of 12 bytes: uint32
// first address of the block, uint32 where the block begins, uint32 its length][the blocks]: 64 aircraft each, by address,
// gzipped lines "<hex>\t<JSON [reg, type, model, serial, year, owner, owner's city, operator]>". In memory: the records only.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable, pipeline } = require('stream');
const pipe = require('util').promisify(pipeline);

const ACDB_V = 1, PER_BLOCK = 64, REC = 12;
const FIELDS = ['reg', 'type', 'model', 'msn', 'year', 'owner', 'ownerCity', 'op'];
const SOURCES = ['tar1090', 'adsbx', 'opensky', 'ccar', 'faa'];

// ---- reading the sources' lines -------------------------------------------------------------------------------------------
// (one line of a comma-separated file, quoted with q - '"' or "'" - a quote doubled inside one standing for itself)
function csvLine(line, q, sep) {
  q = q || '"'; sep = sep || ',';
  const out = []; let cur = '', inq = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inq) { if (ch === q) { if (line[i + 1] === q) { cur += q; i++; } else inq = false; } else cur += ch; }
    else if (ch === q && cur.trim() === '') { inq = true; cur = ''; }
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const clean = (v, n) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return !s || /^(null|none|n\/a|unknown|unknow|-)$/i.test(s) ? '' : s.slice(0, n || 80); };
const yearOf = v => { const m = /\b(19[0-9]{2}|20[0-9]{2})\b/.exec(String(v || '')); const y = m ? +m[1] : 0; return y >= 1903 && y <= new Date().getUTCFullYear() + 1 ? y : 0; };
const hexOk = h => { h = String(h || '').trim().toLowerCase(); return /^[0-9a-f]{6}$/.test(h) && h !== '000000' ? h : ''; };
// (an "owner" that is no one - a placeholder, a miscoded transponder's note)
const noOwner = s => !s || /^(private|privat|unknown|n\/?a|none|-|not available|owner)$/i.test(s);
const tidyOwner = s => { s = clean(s, 120).replace(/\s*\(miscode[^)]*\)\s*$/i, '').trim(); return noOwner(s) ? '' : s; };

// tar1090-db: hex;reg;type;flags;description;year;owner or operator;
function tar1090(line) {
  const f = line.split(';'); const hex = hexOk(f[0]); if (!hex) return null;
  return { hex, reg: clean(f[1], 12).toUpperCase(), type: clean(f[2], 8).toUpperCase(), model: clean(f[4], 60), year: yearOf(f[5]), owner: tidyOwner(f[6]) };
}
// ADS-B Exchange: a JSON object a line
function adsbx(line) {
  let o; try { o = JSON.parse(line); } catch (e) { return null; }
  const hex = hexOk(o && o.icao); if (!hex) return null;
  const model = clean([o.manufacturer, o.model].filter(Boolean).join(' '), 60);
  return { hex, reg: clean(o.reg, 12).toUpperCase(), type: clean(o.icaotype, 8).toUpperCase(), model, year: yearOf(o.year), owner: tidyOwner(o.ownop) };
}
// OpenSky: a header line names the columns (its "complete" files quote with ', the older ones with ")
function openskyParser(header) {
  const q = header.indexOf("'") >= 0 && header.indexOf("'") < (header.indexOf('"') >= 0 ? header.indexOf('"') : Infinity) ? "'" : '"';
  const cols = csvLine(header, q).map(c => c.trim().toLowerCase());
  const at = name => cols.indexOf(name);
  const I = { hex: at('icao24'), reg: at('registration'), type: at('typecode'), man: at('manufacturername'), model: at('model'), msn: at('serialnumber'), built: at('built'), owner: at('owner'), op: at('operator') };
  if (I.hex < 0) return null;
  return line => {
    const f = csvLine(line, q); const hex = hexOk(f[I.hex]); if (!hex) return null;
    const g = k => I[k] >= 0 ? f[I[k]] : '';
    return { hex, reg: clean(g('reg'), 12).toUpperCase(), type: clean(g('type'), 8).toUpperCase(), model: clean([g('man'), g('model')].filter(Boolean).join(' '), 60), msn: clean(g('msn'), 30), year: yearOf(g('built')), owner: tidyOwner(g('owner')), op: tidyOwner(g('op')) };
  };
}
// FAA MASTER.txt: a header line; N-number, serial, year, the registrant's name, city and state, the Mode S address in hex
function faaParser(header) {
  const cols = csvLine(header.replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, '')).map(c => c.trim().toUpperCase());   // (its byte-order mark, read as UTF-8 or as Latin-1)
  const at = name => cols.indexOf(name);
  const I = { n: at('N-NUMBER'), msn: at('SERIAL NUMBER'), year: at('YEAR MFR'), name: at('NAME'), city: at('CITY'), state: at('STATE'), hex: at('MODE S CODE HEX') };
  if (I.n < 0 || I.hex < 0) return null;
  return line => {
    const f = csvLine(line); const hex = hexOk(f[I.hex]); if (!hex) return null;
    const city = clean(f[I.city], 40), st = clean(f[I.state], 4);
    return { hex, reg: 'N' + clean(f[I.n], 6).toUpperCase(), msn: clean(f[I.msn], 30), year: yearOf(f[I.year]), owner: tidyOwner(f[I.name]), ownerCity: [city, st].filter(Boolean).join(', ') };
  };
}
// Transport Canada: carscurr.txt (mark, serial, date built, the Mode S address in binary) and carsownr.txt (mark, owner,
// city, province) - joined by mark
const CC = { mark: 0, msn: 5, built: 31, modes: 42 }, CO = { mark: 0, name: 1, city: 5, prov: 6 };
// (an owner's line: [mark, { owner, city }] - or null)
function ccarOwner(line) {
  const f = csvLine(line); const m = clean(f[CO.mark], 4).toUpperCase(); if (!m) return null;
  return [m, { owner: tidyOwner(f[CO.name]), city: [clean(f[CO.city], 40), clean(f[CO.prov], 40)].filter(Boolean).join(', ') }];
}
// (an aircraft's line, with the owners by mark)
function ccarAircraft(line, owners) {
  const f = csvLine(line); const bin = clean(f[CC.modes], 24); if (!/^[01]{24}$/.test(bin)) return null;
  const hex = hexOk(parseInt(bin, 2).toString(16).padStart(6, '0')); if (!hex) return null;
  const mark = clean(f[CC.mark], 4).toUpperCase(), o = owners.get(mark) || {};
  return { hex, reg: mark ? 'C-' + mark : '', msn: clean(f[CC.msn], 30), year: yearOf(f[CC.built]), owner: o.owner || '', ownerCity: o.city || '' };
}
function ccarRows(curr, ownr) {
  const owners = new Map();
  for (const line of ownr.split('\n')) { const r = ccarOwner(line); if (r && !owners.has(r[0])) owners.set(r[0], r[1]); }
  const out = [];
  for (const line of curr.split('\n')) { const o = ccarAircraft(line, owners); if (o) out.push(o); }
  return out;
}

// ---- a zip file's members, without a library (the stored and deflated ones - what the registers send) ------------------
// (where its members are: their places in the file, read off its central directory)
function zipEntries(buf) {
  const out = new Map();
  let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip file');
  return { n: buf.readUInt16LE(e + 10), size: buf.readUInt32LE(e + 12), at: buf.readUInt32LE(e + 16), out };
}
function zipDir(cd, n, out) {
  let p = 0;
  for (let k = 0; k < n && p + 46 <= cd.length; k++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32), lo = cd.readUInt32LE(p + 42);
    const base = cd.slice(p + 46, p + 46 + nl).toString('utf8').split('/').pop().toLowerCase();
    p += 46 + nl + xl + cl;
    if (!out.has(base)) out.set(base, { method, csize, lo });
  }
  return out;
}
// (one in memory: its wanted members, whole)
function unzip(buf, wanted) {
  const z = zipEntries(buf), dir = zipDir(buf.slice(z.at, z.at + z.size), z.n, z.out), out = new Map();
  for (const [base, m] of dir) {
    if (!wanted.includes(base)) continue;
    const data = m.lo + 30 + buf.readUInt16LE(m.lo + 26) + buf.readUInt16LE(m.lo + 28), raw = buf.slice(data, data + m.csize);
    out.set(base, m.method === 0 ? raw : m.method === 8 ? zlib.inflateRawSync(raw) : null);
  }
  return out;
}
// (one on disk: its members by name, each read as a stream when wanted - never the whole file in memory)
function zipFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, tl = Math.min(size, 70000), tail = Buffer.alloc(tl);
    fs.readSync(fd, tail, 0, tl, size - tl);
    const z = zipEntries(tail), cd = Buffer.alloc(z.size); fs.readSync(fd, cd, 0, z.size, z.at);
    const dir = zipDir(cd, z.n, z.out);
    for (const m of dir.values()) { const lh = Buffer.alloc(30); fs.readSync(fd, lh, 0, 30, m.lo); m.start = m.lo + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28); }
    return {
      has: base => dir.has(base),
      stream(base) {
        const m = dir.get(base); if (!m || (m.method !== 0 && m.method !== 8)) return null;
        if (!m.csize) return Readable.from([]);
        const s = fs.createReadStream(file, { start: m.start, end: m.start + m.csize - 1 });
        return m.method === 0 ? s : s.pipe(zlib.createInflateRaw());
      }
    };
  } finally { fs.closeSync(fd); }
}

// ---- building it ----------------------------------------------------------------------------------------------------------
const breath = () => new Promise(r => setImmediate(r));
// (a stream's lines, one at a time as they come; a failing stream - the download cut off, a damaged file - fails this)
async function linesOf(stream, enc, cb) {
  stream.setEncoding(enc);
  let rest = '', n = 0;
  for await (const chunk of stream) {
    const t = rest + chunk; let i = 0, j;
    while ((j = t.indexOf('\n', i)) >= 0) {
      const line = t.charCodeAt(j - 1) === 13 ? t.slice(i, j - 1) : t.slice(i, j);
      if (line) cb(line, n);
      i = j + 1; if (++n % 20000 === 0) await breath();
    }
    rest = t.slice(i);
  }
  if (rest) { const line = rest.replace(/\r$/, ''); if (line) cb(line, n); n++; }
  return n;
}
const UA = 'fr24-ladd-monitor (aircraft database, once a week)';
const URLS = {
  tar1090: 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/csv/aircraft.csv.gz',
  adsbx: 'https://downloads.adsbexchange.com/downloads/basic-ac-db.json.gz',
  faa: 'https://registry.faa.gov/database/ReleasableAircraft.zip',
  ccar: 'https://wwwapps.tc.gc.ca/saf-sec-sur/2/ccarcs-riacc/download/ccarcsdb.zip'
};
// The file built from every source: { n, src } - each source's count, or why it failed. o: { dir, file, fetch, ua, urls,
// log, minAircraft }. Each aircraft is held as one string while it is built (its fields joined), by its address as a
// number; the registers' zip files are written to disk as they come and read from there - so the whole world fits in
// about 250 MB in a worker thread (760,000 aircraft in 2026), given back after.
async function buildFile(o) {
  const t0 = Date.now(), all = new Map(), src = {}, log = o.log || (() => {}), urls = o.urls || {};
  const SEP = '\x1f', EMPTY = FIELDS.map(() => '').join(SEP);
  const get = async url => {
    const r = await o.fetch(url, { headers: { 'User-Agent': o.ua || UA, Accept: '*/*' } });
    if (!r || !(r.status >= 200 && r.status < 300)) throw new Error('HTTP ' + (r && r.status));
    return r;
  };
  const bodyOf = r => { if (!r.body) throw new Error('no body'); return typeof r.body.getReader === 'function' ? Readable.fromWeb(r.body) : r.body; };
  // (a source's lines as it downloads - gunzipped where it is gzipped)
  const eachLine = async (url, gz, cb) => { const b = bodyOf(await get(url)); return linesOf(gz ? pipeline(b, zlib.createGunzip(), () => {}) : b, 'utf8', cb); };
  // (a zip file to disk as it downloads, then its members read from there)
  const zipTo = async (url, name) => {
    const r = await get(url), f = path.join(o.dir, name + '.zip.tmp');
    if (r.body) await pipe(bodyOf(r), fs.createWriteStream(f)); else fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    return f;
  };
  const member = (z, base, enc, cb) => { const st = z.stream(base); if (!st) throw new Error('no ' + base); return linesOf(st, enc, cb); };
  // (a source's word on an aircraft over what came before - a register's last of all; an empty field never over a full one.
  // fill: an older database - OpenSky's newest is months old, and an address follows its registration to a new airframe
  // (A15A72, N1868M: a G650 now, a Global in OpenSky's - the same registration) - only what nothing else said, and only of
  // the same registration and the same type)
  const put = (x, fill) => {
    if (!x || !x.hex) return;
    const k = parseInt(x.hex, 16), cur = all.get(k), a = (cur === undefined ? EMPTY : cur).split(SEP);
    if (fill && cur !== undefined && ((a[0] && x.reg && a[0] !== x.reg) || (a[1] && x.type && a[1] !== x.type))) return;
    let ch = cur === undefined;
    FIELDS.forEach((f, i) => { const v = x[f] ? String(x[f]).replace(/[\x00-\x1f]/g, ' ') : ''; if (v && (!fill || !a[i]) && v !== a[i]) { a[i] = v; ch = true; } });
    if (ch) all.set(k, a.join(SEP));
  };
  const take = async (k, fn) => { const t = Date.now(); try { const n = await fn(); src[k] = { n, at: Math.round(t / 1000), ms: Date.now() - t }; } catch (e) { src[k] = { n: 0, err: String(e && e.message || e).slice(0, 100) }; log('aircraft database', k, src[k].err); } };
  const tmps = [];
  try {
    fs.mkdirSync(o.dir, { recursive: true });
    await take('tar1090', async () => { let n = 0; await eachLine(urls.tar1090 || URLS.tar1090, true, l => { const x = tar1090(l); if (x) { put(x); n++; } }); return n; });
    await take('adsbx', async () => { let n = 0; await eachLine(urls.adsbx || URLS.adsbx, true, l => { const x = adsbx(l); if (x) { put(x); n++; } }); return n; });
    await take('opensky', async () => { let n = 0, parse = null; await eachLine(urls.opensky || await openskyUrl(o), false, (l, i) => { if (!parse) { if (i === 0) parse = openskyParser(l); return; } const x = parse(l); if (x) { put(x, true); n++; } }); return n; });
    await take('ccar', async () => {
      const f = await zipTo(urls.ccar || URLS.ccar, 'ccar'); tmps.push(f); const z = zipFile(f);
      if (!z.has('carscurr.txt')) throw new Error('no carscurr.txt');
      const owners = new Map(); if (z.has('carsownr.txt')) await member(z, 'carsownr.txt', 'latin1', l => { const r = ccarOwner(l); if (r && !owners.has(r[0])) owners.set(r[0], r[1]); });
      let n = 0; await member(z, 'carscurr.txt', 'latin1', l => { const x = ccarAircraft(l, owners); if (x) { put(x); n++; } }); return n;
    });
    await take('faa', async () => {
      const f = await zipTo(urls.faa || URLS.faa, 'faa'); tmps.push(f); const z = zipFile(f);
      let n = 0, parse = null, bad = false;
      await member(z, 'master.txt', 'latin1', l => { if (!parse && !bad) { if (!(parse = faaParser(l))) bad = true; return; } if (parse) { const x = parse(l); if (x) { put(x); n++; } } });
      if (!parse) throw new Error('MASTER.txt: columns not found'); return n;
    });
    if (all.size < (o.minAircraft || 1000)) throw new Error(`only ${all.size} aircraft from all sources - not kept`);
    // (sorted by address, cut into blocks, gzipped and written one by one beside the file - its index after them, in the
    // room left for it - and put in its place whole)
    const keys = [...all.keys()].sort((x, y) => x - y), n = keys.length, nb = Math.ceil(n / PER_BLOCK);
    const head = Buffer.from(JSON.stringify({ v: ACDB_V, at: Math.round(Date.now() / 1000), n, nb, src }), 'utf8');
    const len = Buffer.alloc(4); len.writeUInt32LE(head.length, 0);
    const rb = Buffer.alloc(nb * REC), row = a => JSON.stringify(a.map((v, i) => FIELDS[i] === 'year' ? +v || 0 : v));
    const tmp = o.file + '.tmp', wfd = fs.openSync(tmp, 'w');
    try {
      const base = 4 + head.length + rb.length; let off = 0;
      fs.writeSync(wfd, Buffer.concat([len, head]), 0, 4 + head.length, 0);
      for (let i = 0, k = 0; i < n; i += PER_BLOCK, k++) {
        const part = keys.slice(i, i + PER_BLOCK), txt = part.map(h => h.toString(16).padStart(6, '0') + '\t' + row(all.get(h).split(SEP))).join('\n');
        const z = zlib.gzipSync(Buffer.from(txt, 'utf8'), { level: 6 });
        fs.writeSync(wfd, z, 0, z.length, base + off);
        rb.writeUInt32LE(part[0], k * REC); rb.writeUInt32LE(off, k * REC + 4); rb.writeUInt32LE(z.length, k * REC + 8); off += z.length;
        if (k % 500 === 499) await breath();
      }
      fs.writeSync(wfd, rb, 0, rb.length, 4 + head.length);
    } finally { fs.closeSync(wfd); }
    all.clear(); fs.renameSync(tmp, o.file);
    log('aircraft database', `${n} aircraft in ${Math.round((Date.now() - t0) / 1000)} s`, Object.entries(src).map(([k, v]) => k + ' ' + (v.err ? 'failed: ' + v.err : v.n)).join(', '));
    return { n, src };
  } finally {
    all.clear();
    for (const f of tmps) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } }
  }
}
// (the newest of OpenSky's "complete" databases in its public bucket)
async function openskyUrl(o) {
  const base = 'https://s3.opensky-network.org/data-samples/';
  try {
    const r = await o.fetch(base + '?list-type=2&prefix=metadata/aircraft-database-complete-', { headers: { Accept: 'application/xml' } });
    if (r && r.status === 200) { const keys = [...(await r.text()).matchAll(/<Key>(metadata\/aircraft-database-complete-\d{4}-\d{2}\.csv)<\/Key>/g)].map(m => m[1]).sort(); if (keys.length) return base + keys[keys.length - 1]; }
  } catch (e) { /* the older name below */ }
  return base + 'metadata/aircraftDatabase.csv';
}

function createAcdb(env) {
  const C = Object.assign({ everyDays: 7, cacheBlocks: 128, heapMb: 400, maxMin: 60 }, env.cfg || {});
  const dir = path.join(env.store, 'acdb'), file = path.join(dir, 'acdb.bin'), log = env.log || (() => {});
  const S = { n: 0, at: 0, building: false, built: 0, err: '', src: {}, lookups: 0, found: 0, ms: 0 };
  let H = null, recs = null, fd = null;
  const cache = new Map();   // block index -> Map(hex -> row)
  // ---- the file as built ------------------------------------------------------------------------------------------------
  function open() {
    try {
      if (fd != null) { try { fs.closeSync(fd); } catch (e) { /* closed */ } fd = null; }
      if (!fs.existsSync(file)) { H = null; recs = null; return false; }
      fd = fs.openSync(file, 'r');
      const b4 = Buffer.alloc(4); fs.readSync(fd, b4, 0, 4, 0); const len = b4.readUInt32LE(0);
      const hb = Buffer.alloc(len); fs.readSync(fd, hb, 0, len, 4);
      const h = JSON.parse(hb.toString('utf8')); if (!h || h.v !== ACDB_V || !(h.nb > 0)) throw new Error('not this version');
      const rb = Buffer.alloc(h.nb * REC); fs.readSync(fd, rb, 0, rb.length, 4 + len);
      H = Object.assign({ len }, h); recs = rb; cache.clear();
      S.n = h.n; S.at = h.at; S.src = h.src || {};
      return true;
    } catch (e) { S.err = String(e && e.message || e).slice(0, 120); H = null; recs = null; if (fd != null) { try { fs.closeSync(fd); } catch (x) { /* closed */ } fd = null; } return false; }
  }
  // One aircraft: { reg, type, model, msn, year, owner, ownerCity, op } - or null, not in any database
  function lookup(hex) {
    hex = hexOk(hex); if (!hex || !H || !recs) return null;
    const t0 = Date.now(); S.lookups++;
    try {
      const want = parseInt(hex, 16);
      let lo = 0, hi = H.nb - 1, at = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (recs.readUInt32LE(mid * REC) <= want) { at = mid; lo = mid + 1; } else hi = mid - 1; }
      if (at < 0) return null;
      let blk = cache.get(at);
      if (!blk) {
        const off = recs.readUInt32LE(at * REC + 4), len = recs.readUInt32LE(at * REC + 8), z = Buffer.alloc(len);
        fs.readSync(fd, z, 0, len, 4 + H.len + H.nb * REC + off);
        blk = new Map(); for (const line of zlib.gunzipSync(z).toString('utf8').split('\n')) { const i = line.indexOf('\t'); if (i > 0) blk.set(line.slice(0, i), line.slice(i + 1)); }
        cache.set(at, blk); if (cache.size > C.cacheBlocks) cache.delete(cache.keys().next().value);
      }
      const line = blk.get(hex); if (!line) return null;
      const a = JSON.parse(line), o = {}; FIELDS.forEach((k, i) => { if (a[i]) o[k] = a[i]; });
      S.found++; return o;
    } catch (e) { S.err = String(e && e.message || e).slice(0, 120); return null; }
    finally { S.ms += Date.now() - t0; }
  }
  // (built in a worker thread of its own where the monitor asks for one - env.worker: its own memory, capped, and given back
  // whole when it ends; one that runs out of it, or takes over an hour, ends alone - the monitor and the file it has go on.
  // Otherwise here, with env.fetch)
  function inWorker() {
    const { Worker } = require('worker_threads');
    return new Promise(resolve => {
      let done = false;
      const w = new Worker(__filename, { workerData: { acdbBuild: true, dir, file, ua: env.ua, urls: env.urls || {}, minAircraft: env.minAircraft }, resourceLimits: { maxOldGenerationSizeMb: C.heapMb, maxYoungGenerationSizeMb: 16 } });
      const end = r => { if (done) return; done = true; clearTimeout(tm); resolve(r); };
      const tm = setTimeout(() => { end({ err: `over ${C.maxMin} minutes - stopped` }); w.terminate(); }, C.maxMin * 60000);
      w.on('message', m => { if (m && m.log) log(...m.log); else if (m && 'done' in m) end(m.done ? { n: m.n, src: m.src } : { err: m.err }); });
      w.on('error', e => end({ err: String(e && (e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'out of memory (' + C.heapMb + ' MB)' : e.message) || e) }));
      w.on('exit', c => end({ err: 'the worker ended (' + c + ')' }));
    });
  }
  async function build() {
    if (S.building) return false;
    S.building = true; S.err = '';
    try {
      let r;
      if (env.worker) r = await inWorker();
      else { try { r = await buildFile({ dir, file, fetch: env.fetch, ua: env.ua, urls: env.urls, log, minAircraft: env.minAircraft }); } catch (e) { r = { err: String(e && e.message || e) }; } }
      if (r.err) { S.err = String(r.err).slice(0, 160); log('aircraft database', S.err); try { fs.unlinkSync(file + '.tmp'); } catch (e) { /* none */ } return false; }
      open(); S.built++;
      return true;
    } finally { S.building = false; }
  }
  // (built again when the one kept is a week old - or none)
  const due = nowS => !H || (nowS || Date.now() / 1000) - (H.at || 0) > C.everyDays * 86400;
  function status() { return { aircraft: S.n, builtAt: S.at, building: S.building, sources: S.src, lookups: S.lookups, found: S.found, ms: S.ms, err: S.err }; }
  open();
  return { open, lookup, build, due, status, stats: S, file };
}

// (this file as the build's worker thread)
{
  const WT = require('worker_threads');
  if (!WT.isMainThread && WT.workerData && WT.workerData.acdbBuild) {
    const W = WT.workerData, post = m => WT.parentPort.postMessage(m);
    buildFile({ dir: W.dir, file: W.file, fetch: (u, x) => fetch(u, x), ua: W.ua, urls: W.urls, minAircraft: W.minAircraft, log: (...a) => post({ log: a.map(String) }) })
      .then(r => post({ done: true, n: r.n, src: r.src }), e => post({ done: false, err: String(e && e.message || e).slice(0, 200) }));
  }
}

module.exports = { createAcdb, buildFile, csvLine, tar1090, adsbx, openskyParser, faaParser, ccarRows, unzip, zipFile, linesOf, FIELDS, SOURCES };
