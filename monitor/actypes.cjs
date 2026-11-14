'use strict';
// (1.3.5) FR24's aircraft directory (flightradar24.com/data/aircraft) lists its families and types of aircraft and each
// one's production list - the airliners, and few others: no Bombardier Global, no Gulfstream. This builds the same from the
// monitor's aircraft database (acdb.cjs): every type of aircraft it knows, how many there are, and each one's aircraft -
// registration, serial number, age and owner or operator - in families as FR24 keeps them (Bombardier Global: Global
// Express, 5000, 6000, 7500...). The browser adds to FR24's directory only what FR24 does not list itself.
//
// Built again with the aircraft database (weekly), in steps, into STORE/actypes:
//   index.json      { v, at, n, families: [{ code, name, slug, count, types: [{ code, name, slug, count }] }] }
//   t/<CODE>.json   [[registration, serial number, year built, owner or operator, ICAO address], ...] in production order
const fs = require('fs');
const path = require('path');

const V = 1, MIN_TYPE = 3, PER_PAGE = 50;
// (ICAO's designators that are not a type of aircraft: gliders, balloons, microlights, drones, ground vehicles...)
const NOT_TYPES = new Set(['ZZZZ', 'GND', 'GLID', 'BALL', 'ULAC', 'GYRO', 'UHEL', 'SHIP', 'PARA', 'DRON', 'UAV', 'TWR', 'SERV', 'EMER', 'GLIM', 'PRCH', 'SONX', 'ECHO', 'FOX', 'GLAS', 'MT', 'ZZZ', 'TEST']);
// FR24's families for the types it leaves out - by maker and line, its own way ("Bombardier Global", the types in it):
// [code, name, types]. A type in none of them goes with its maker's others.
const FAMILIES = [
  ['GLOBAL', 'Bombardier Global', ['GLEX', 'GL5T', 'GL6T', 'GL7T', 'GL8T', 'GLXS']],
  ['CHALLENGER', 'Bombardier Challenger', ['CL30', 'CL35', 'CL60', 'CL64', 'CL65']],
  ['LEARJET', 'Bombardier Learjet', ['LJ23', 'LJ24', 'LJ25', 'LJ28', 'LJ31', 'LJ35', 'LJ40', 'LJ45', 'LJ55', 'LJ60', 'LJ70', 'LJ75', 'LJ85']],
  ['GULFSTREAM', 'Gulfstream', ['GLF2', 'GLF3', 'GLF4', 'GLF5', 'GLF6', 'GA5C', 'GA6C', 'GA7C', 'GA8C', 'G150', 'G280', 'GALX', 'ASTR', 'G159', 'GA4C', 'GLF7']],
  ['FALCON', 'Dassault Falcon', ['FA10', 'FA20', 'FA50', 'FA5X', 'FA6X', 'FA7X', 'FA8X', 'F900', 'F2TH', 'FA9X']],
  ['CITATION', 'Cessna Citation', ['C500', 'C501', 'C510', 'C525', 'C25A', 'C25B', 'C25C', 'C25M', 'C526', 'C550', 'C551', 'C560', 'C56X', 'C650', 'C680', 'C68A', 'C700', 'C750']],
  ['PHENOM', 'Embraer Phenom and Praetor', ['E50P', 'E55P', 'E545', 'E550']],
  ['LEGACY', 'Embraer Legacy and Lineage', ['E35L', 'E135L', 'E190L', 'E500', 'E600']],
  ['HAWKER', 'Hawker and Beechjet', ['H25A', 'H25B', 'H25C', 'HA4T', 'BE40', 'PRM1', 'H125']],
  ['KINGAIR', 'Beechcraft King Air', ['BE9L', 'BE9T', 'BE10', 'BE20', 'BE30', 'B350', 'BE99', 'B190']],
  ['BONANZA', 'Beechcraft Bonanza and Baron', ['BE33', 'BE35', 'BE36', 'BT36', 'BE55', 'BE58', 'BE95', 'BE60', 'BE76']],
  ['PILATUS', 'Pilatus', ['PC6T', 'PC7', 'PC9', 'PC12', 'PC21', 'PC24']],
  ['TBM', 'Daher TBM', ['TBM7', 'TBM8', 'TBM9']],
  ['HONDAJET', 'Honda HondaJet', ['HDJT']],
  ['CIRRUS', 'Cirrus', ['SR20', 'SR22', 'S22T', 'SF50']],
  ['AIRBUSHELI', 'Airbus Helicopters', ['EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'AS50', 'AS55', 'AS65', 'AS32', 'AS3B', 'H160', 'BK17', 'GAZL', 'ALO3', 'ALO2', 'S330', 'PUMA']],
  ['LEONARDOHELI', 'Leonardo Helicopters', ['A109', 'A119', 'A129', 'A139', 'A149', 'A169', 'A189', 'EH10', 'LYNX']],
  ['BELLHELI', 'Bell Helicopters', ['B06', 'B06T', 'B47G', 'B105', 'B204', 'B205', 'B212', 'B222', 'B230', 'B407', 'B412', 'B427', 'B429', 'B430', 'B505', 'B525', 'UH1', 'UH1Y', 'H1']],
  ['SIKORSKY', 'Sikorsky', ['S61', 'S64', 'S70', 'S76', 'S92', 'H60', 'H53', 'H53S']],
  ['ROBINSON', 'Robinson', ['R22', 'R44', 'R66']],
];
const TYPE_FAMILY = new Map(); FAMILIES.forEach(f => f[2].forEach(t => TYPE_FAMILY.set(t, f[0])));
// (a maker's name as the databases give it: a word in capitals as a name - "BOMBARDIER" Bombardier; a word with digits or
// a dash, or already mixed, as it is - "BD-700", "Global")
function tidy(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().split(' ').map(w => /^[A-Z]{2,}$/.test(w) && !/^(II|III|IV|VI|VII|VIII|IX|XL|XLS|XR|SP|ER|LR|RG|STOL|CJ|CJ\d|TT|JR|NG|SE)$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w).join(' ').slice(0, 60);
}
// (the maker, from a type's name: its first word - or two, where the first is only part of it: North American, Air Tractor,
// De Havilland - not where the second is the model: "American AA-5")
const TWO_WORD = new Set(['NORTH', 'AIR', 'DE', 'BRITISH', 'GENERAL', 'GREAT', 'CUB', 'AIRPLANE', 'BEST', 'JUST', 'LOCKHEED', 'MCDONNELL', 'AMERICAN', 'AERO', 'PROGRESSIVE', 'FLIGHT', 'EPIC', 'TL', 'BRM', 'SCHEIBE', 'HAWKER']);
function makerOf(name) {
  const w = String(name || '').split(' ').filter(Boolean), a = (w[0] || '').replace(/[^A-Za-z]/g, '');
  if (!a) return '';
  return TWO_WORD.has(a.toUpperCase()) && /^[A-Za-z]{2,}$/.test(w[1] || '') ? a + ' ' + w[1] : a;
}
const slugOf = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const typeOk = t => /^[A-Z0-9]{2,4}$/.test(t) && !NOT_TYPES.has(t);
// (serial numbers in production order: "9868" after "987", "5001" after "5000")
const byMsn = (a, b) => (a[1] && b[1] ? String(a[1]).localeCompare(String(b[1]), 'en', { numeric: true }) : a[1] ? -1 : b[1] ? 1 : 0) || String(a[0]).localeCompare(String(b[0]));

function createAcTypes(env) {
  const dir = path.join(env.store, 'actypes'), log = env.log || (() => {});
  const S = { at: 0, n: 0, types: 0, families: 0, building: false, builtFrom: 0, ms: 0, err: '' };
  let index = null, body = null;
  const cache = new Map();   // type code -> its rows (the last few looked at)
  function load() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      if (!j || j.v !== V || !Array.isArray(j.families)) return false;
      index = j; body = null; cache.clear(); S.at = j.at; S.n = j.n; S.families = j.families.length; S.types = j.families.reduce((n, f) => n + f.types.length, 0); S.builtFrom = j.from || 0;
      return true;
    } catch (e) { return false; }
  }
  // Every aircraft of the database, through each(fn, pause) (acdb.each); from = the database's own build time. ageOf(o):
  // a year built worked out for one the database has none for (ages.cjs), or none
  async function build(each, from, ageOf) {
    if (S.building) return false;
    S.building = true; S.err = ''; const t0 = Date.now();
    try {
      const types = new Map();   // code -> { n, names: Map(name -> n), rows: [] }
      const n = await each(o => {
        const t = String(o.type || '').toUpperCase(), reg = String(o.reg || '').toUpperCase();
        if (!typeOk(t) || !/^[A-Z0-9-]{2,10}$/.test(reg)) return;
        let e = types.get(t); if (!e) types.set(t, e = { n: 0, names: new Map(), rows: [] });
        e.n++;
        if (o.model) { const m = tidy(o.model); e.names.set(m, (e.names.get(m) || 0) + 1); }
        let year = +o.year || 0; if (!(year > 1900) && ageOf) { const a = ageOf(o); if (a && a.year > 1900) year = a.year; }
        // (one line of text each while building - a fraction of the memory of an array each: 760,000 aircraft)
        e.rows.push(reg + '\t' + String(o.msn || '').replace(/[\t\n]/g, ' ').slice(0, 20) + '\t' + (year > 1900 ? year : 0) + '\t' + String(o.op || o.owner || '').replace(/[\t\n]/g, ' ').slice(0, 60) + '\t' + (o.hex || ''));
      }, env.pause);
      // (the families: FR24's way where it has one for the type, else the type's maker - from the name most of them give)
      const fams = new Map();
      FAMILIES.forEach(f => fams.set(f[0], { code: f[0], name: f[1], slug: slugOf(f[1]), count: 0, types: [] }));
      fs.mkdirSync(path.join(dir, 't'), { recursive: true });
      let k = 0;
      for (const [t, e] of types) {
        if (e.n < MIN_TYPE) continue;
        let name = '', best = 0; e.names.forEach((c, m) => { if (c > best) { best = c; name = m; } });
        let fc = TYPE_FAMILY.get(t);
        if (!fc) {
          const maker = makerOf(name);
          if (!maker) continue;   // (no name given at all: nothing to list it by)
          fc = maker.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12);
          if (!fams.has(fc)) fams.set(fc, { code: fc, name: maker, slug: slugOf(maker), count: 0, types: [] });
        }
        const fam = fams.get(fc);
        fam.types.push({ code: t, name: name || t, slug: t.toLowerCase(), count: e.n });
        fam.count += e.n;
        const rows = e.rows.map(l => { const f = l.split('\t'); return [f[0], f[1], +f[2] || 0, f[3], f[4]]; }); e.rows = null;
        rows.sort(byMsn);
        fs.writeFileSync(path.join(dir, 't', t + '.json.tmp'), JSON.stringify(rows));
        fs.renameSync(path.join(dir, 't', t + '.json.tmp'), path.join(dir, 't', t + '.json'));
        if (++k % 50 === 0 && env.pause) await env.pause();
      }
      const families = [...fams.values()].filter(f => f.types.length).sort((a, b) => b.count - a.count);
      families.forEach(f => f.types.sort((a, b) => b.count - a.count));
      const j = { v: V, at: Math.floor(Date.now() / 1000), from: from || 0, n, families };
      fs.writeFileSync(path.join(dir, 'index.json.tmp'), JSON.stringify(j));
      fs.renameSync(path.join(dir, 'index.json.tmp'), path.join(dir, 'index.json'));
      load(); S.ms = Date.now() - t0;
      log('aircraft types', `${S.types} types in ${S.families} families, from ${n} aircraft, in ${Math.round(S.ms / 1000)} s`);
      return true;
    } catch (e) { S.err = String(e && e.message || e).slice(0, 160); log('aircraft types', S.err); return false; }
    finally { S.building = false; }
  }
  // (its rows, from the file - the last 40 looked at kept)
  function rowsOf(t) {
    t = String(t || '').toUpperCase(); if (!typeOk(t)) return null;
    if (cache.has(t)) { const r = cache.get(t); cache.delete(t); cache.set(t, r); return r; }
    try { const r = JSON.parse(fs.readFileSync(path.join(dir, 't', t + '.json'), 'utf8')); cache.set(t, r); if (cache.size > 40) cache.delete(cache.keys().next().value); return r; } catch (e) { return null; }
  }
  const familyOf = code => (index && index.families.find(f => f.code === String(code || '').toUpperCase())) || null;
  // One page of a type's aircraft, or of a family's (its types' together, in production order): { code, total,
  // averageAge, page, lastPage, perPage, rows }. Age in years from the year built - an aircraft with none, no age
  function page(q) {
    if (!index) return null;
    const per = Math.max(10, Math.min(100, +q.per || PER_PAGE)), nowY = new Date().getUTCFullYear();
    let rows = null, code = '';
    if (q.type) { code = String(q.type).toUpperCase(); rows = rowsOf(code); }
    else if (q.family) {
      const f = familyOf(q.family); if (!f) return null; code = f.code;
      rows = []; f.types.forEach(t => { const r = rowsOf(t.code); if (r) r.forEach(x => rows.push(x.concat([t.code]))); });
      rows.sort(byMsn);
    }
    if (!rows) return null;
    let ages = 0, aged = 0; rows.forEach(r => { if (r[2] > 1900) { ages += nowY - r[2]; aged++; } });
    const last = Math.max(1, Math.ceil(rows.length / per)), pg = Math.max(1, Math.min(last, Math.floor(+q.page) || 1));
    return { code, total: rows.length, averageAge: aged ? Math.round(ages / aged * 10) / 10 : null, page: pg, lastPage: last, perPage: per, rows: rows.slice((pg - 1) * per, pg * per) };
  }
  // (the index as sent - gzipped once)
  function indexBody() {
    if (!index) return null;
    if (!body) body = require('zlib').gzipSync(JSON.stringify({ v: V, at: index.at, families: index.families }));
    return body;
  }
  const due = from => !S.building && !!from && from !== S.builtFrom;
  load();
  return { build, load, page, indexBody, due, familyOf, status: () => Object.assign({}, S), stats: S, dir };
}

module.exports = { createAcTypes, FAMILIES, tidy, makerOf, slugOf, typeOk, byMsn, PER_PAGE };
