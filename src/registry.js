/* ==REGISTRY== -------------------------------------------------------------------------------------------------
 * Aircraft registers and databases: where to ask about an airframe and how to read each answer - the same code in the
 * userscript (src/main/03-data.js) and in the monitor (monitor/owners.cjs), so both read every register alike.
 *
 *   hexdb.io, adsbdb.com   registration, type, owner, country - any aircraft, by transponder address
 *   FAA registry (N-)      serial number, owner (and their city and state), build year
 *   G-INFO (G-)            the UK CAA's: its AOC operator, else the registered owner; serial number, build year
 *   Isle of Man (M-)       owner, serial number, build year when registered new
 *   FOCA (HB-)             the Swiss register: main operator, else main owner; serial number, build year
 *
 * Names only - an owner's address is never read. `ask(url, opts)` makes the request (the userscript's GM request, the
 * monitor's fetch): JSON parsed unless opts.json === false, rejected on an HTTP error; opts.priority / opts.bg are the
 * userscript's queue hints, passed through.
 * ------------------------------------------------------------------------------------------------------------ */
function createRegistry(ask, opts) {
  'use strict';
  const log = (opts && opts.log) || (() => {});
  // (each register asked once per mark while the page is open - a failed request again; off on the monitor, which keeps
  // its own record of what it asked)
  const memoOn = !(opts && opts.memo === false);
  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const decodeEntities = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return isFinite(n) && n > 0 ? String.fromCodePoint(n) : m; }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[k] || m;
  });
  // (what registers put where a name would be: a status, or "private")
  const NAME_PLACEHOLDER = /^(registration pending|sale reported|not assigned|in question|expired|deregistered|unknown|none|n\/?a|reserved|to be determined|tbd|registered owner|private|private owner|privately owned|private individual|individual|owner)$/i;
  function memo(m, k, make) {
    if (memoOn && m.has(k)) return m.get(k);
    const p = make(); if (!memoOn) return p;
    m.set(k, p); if (m.size > 2000) m.delete(m.keys().next().value);
    p.catch(() => m.delete(k));
    return p;
  }

  // Registry data for US aircraft straight from the FAA: serial number, owner, the owner's city/state and the year
  // (or airworthiness date) that gives the age.
  function faaParse(html) {
    html = String(html || '');
    const cell = label => { const re = new RegExp('data-label="' + label.replace(/[()/]/g, m => '\\' + m) + '"[^>]*>([\\s\\S]*?)</td>', 'i'); const m = html.match(re); return m ? clean(m[1].replace(/<[^>]*>/g, ' ')) : ''; };
    const out = { msn: cell('Serial Number'), owner: cell('Name'), city: cell('City'), state: cell('State'), country: cell('Country'), mfrYear: Number(cell('Mfr Year')) || 0, awDate: cell('A/W Date'), model: cell('Model'), maker: cell('Manufacturer Name'), hex: cell('Mode S Code (Base 16 / Hex)').toLowerCase() };
    const aw = out.awDate.match(/(\d{4})$/); out.year = out.mfrYear || (aw ? Number(aw[1]) : 0);
    if (/None/i.test(out.msn)) out.msn = '';
    // "REGISTRATION PENDING" / "SALE REPORTED" is a status, not a name: the applicant listed further down is the owner
    if (NAME_PLACEHOLDER.test(out.owner)) {
      const names = [...html.matchAll(/data-label="Name"[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1].replace(/<[^>]*>/g, ' ')));
      out.owner = (names.find(n => /^applicant\s+\S/i.test(n)) || '').replace(/^applicant\s+/i, '');
    }
    return out.msn || out.owner || out.year ? out : null;
  }
  async function faa(reg, o) {
    if (!/^N[0-9][0-9A-Z]{0,4}$/i.test(reg)) return null;
    const html = await ask(`https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(reg.toUpperCase())}`, { accept: 'text/html', json: false, timeout: 15000, priority: !!(o && o.priority) });
    return faaParse(html);
  }
  // The Isle of Man register (M-): owner, serial number, type, Mode S - public pages, a search by mark and then the
  // entry (M-WJBA: Ballycastle Aviation, 680A0466)
  const iomAsked = new Map();
  const iomEntryId = (list, mark) => { const m = String(list || '').match(new RegExp('/register/(\\d+)/view">M-' + mark + '<')); return m ? m[1] : ''; };
  function iomParse(html) {
    html = String(html || '');
    const cell = label => { const x = html.match(new RegExp('>' + label + '</label>\\s*<span[^>]*>([^<]*)<')); return x ? clean(decodeEntities(x[1])) : ''; };
    const owners = cell('Registered Owners'), out = { owner: owners.split(',')[0].trim(), msn: cell('Serial Number'), hex: cell('Mode S Number').toLowerCase(), model: cell('Aircraft Type'), status: cell('Aircraft Status') };
    // (registered new - no previous registration anywhere: built the year it was registered)
    const ry = (cell('Registered').match(/(\d{4})\s*$/) || [])[1]; if (/^new$/i.test(cell('Previous International Registration')) && ry) out.year = Number(ry);
    return out.owner || out.msn ? out : null;
  }
  function iom(reg, o) {
    const mark = String(reg || '').toUpperCase().replace(/^M-?/, '');
    if (!/^[A-Z0-9]{1,6}$/.test(mark)) return Promise.resolve(null);
    return memo(iomAsked, mark, () => (async () => {
      const base = 'https://ardis.iomaircraftregistry.com/register/', q = { accept: 'text/html', json: false, timeout: 15000, priority: !!(o && o.priority) };
      const id = iomEntryId(await ask(`${base}search?prs_rm__tt=1&prs_rm__v1=${encodeURIComponent(mark)}&prs_bg__2__value=Search`, q), mark); if (!id) return null;
      return iomParse(await ask(`${base}${id}/view`, q));
    })());
  }
  // The UK register (G-): the CAA's G-INFO, through the public API its own search page uses - a search by mark, then the
  // entry: the AOC operator if it has one, else the registered owner (its trading name when it has one), serial number,
  // build year, Mode S (G-WAPA, an R44 FR24 calls "Private owner")
  const ginfoAsked = new Map();
  function ginfoPick(list, mark) { const rows = (Array.isArray(list) ? list : []).filter(x => x && String(x.Mark || '').toUpperCase() === mark); return rows.find(x => x.RegistrationStatus === 'R') || rows[0] || null; }
  function ginfoParse(j, hit) {
    if (!j || typeof j !== 'object') return null;
    const ow = (Array.isArray(j.RegisteredAircraftOwners) ? j.RegisteredAircraftOwners : [])[0] || {}, ad = j.AircraftDetails || {}, aoc = j.AircraftOperatedByAocHolder || {};
    const str = v => typeof v === 'string' ? clean(v) : '';
    const out = { owner: str(aoc.OperatorTrandingAs) || str(aoc.OperatorName) || str(ow.TradingAs) || str(ow.RegisteredOwner), msn: str(ad.SerialNumber), year: Number(ad.YearBuild) || 0, hex: str(ad.ICAO24BitAircraftAddress && ad.ICAO24BitAircraftAddress.Hex).toLowerCase(), registered: !!hit && hit.RegistrationStatus === 'R' };
    return out.owner || out.msn ? out : null;
  }
  function ginfo(reg, o) {
    const mark = String(reg || '').toUpperCase().replace(/^G-?/, '');
    if (!/^[A-Z0-9]{4}$/.test(mark)) return Promise.resolve(null);
    return memo(ginfoAsked, mark, () => (async () => {
      const base = 'https://ginfoapi.caa.co.uk/api/aircraft/', q = { timeout: 15000, priority: !!(o && o.priority) };
      const hit = ginfoPick(await ask(base + 'search', Object.assign({ method: 'POST', body: JSON.stringify({ registration: mark }), headers: { 'Content-Type': 'application/json' } }, q)), mark);
      if (!hit || !hit.AircraftID) return null;
      return ginfoParse(await ask(base + 'details/' + encodeURIComponent(hit.AircraftID), q), hit);
    })());
  }
  // The Swiss register (HB-): FOCA's own search API - main operator, else main owner, serial number, build year, Mode S
  // (HB-JNA: Swiss International Air Lines)
  const bazlAsked = new Map();
  function bazlParse(list, mark) {
    const hit = (Array.isArray(list) ? list : []).find(x => x && String(x.registration).toUpperCase() === mark); if (!hit) return null;
    const who = cat => ((hit.ownerOperators || []).find(o => o && o.holderCategory && o.holderCategory.categoryNames && o.holderCategory.categoryNames.en === cat) || {}).ownerOperator;
    const d = hit.details || {}, str = v => typeof v === 'string' && !/^N\/A$/i.test(v) ? clean(v) : '';
    const out = { owner: str(who('Main Operator')) || str(who('Main Owner')), msn: str(d.serialNumber), year: Number(d.yearOfManufacture) || 0, hex: str(d.aircraftAddresses && d.aircraftAddresses.hex).toLowerCase() };
    return out.owner || out.msn ? out : null;
  }
  function bazl(reg, o) {
    const mark = String(reg || '').toUpperCase();
    if (!/^HB-[A-Z0-9]{3}$/.test(mark)) return Promise.resolve(null);
    return memo(bazlAsked, mark, () => (async () => {
      const body = { page_result_limit: 10, current_page_number: 1, sort_list: 'registration', language: 'en', queryProperties: { marketing: '', registration: mark, aircraftStatus: ['Registered', 'Reserved', 'Reservation Expired', 'Registration in Progress'] } };
      return bazlParse(await ask('https://app02.bazl.admin.ch/web/bazl-backend/lfr', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, timeout: 15000, priority: !!(o && o.priority) }), mark);
    })());
  }
  // (the aggregators' databases: what each says of the airframe)
  function hexdbParse(h) { if (!h || typeof h !== 'object') return null; return { reg: clean(h.Registration).toUpperCase(), type: clean(h.ICAOTypeCode).toUpperCase(), desc: clean(h.Manufacturer && h.Type ? `${h.Manufacturer} ${h.Type}` : h.Type), owner: clean(h.RegisteredOwners) }; }
  function adsbdbParse(j) { const ac = j && j.response && j.response.aircraft; if (!ac) return null; return { reg: clean(ac.registration).toUpperCase(), type: clean(ac.icao_type).toUpperCase(), desc: clean(ac.manufacturer && ac.type ? `${ac.manufacturer} ${ac.type}` : ac.type), owner: clean(ac.registered_owner), country: clean(ac.registered_owner_country_name), countryIso: clean(ac.registered_owner_country_iso_name) }; }

  // Everything about one airframe: hexdb, adsbdb and its register at the same time - the slowest one sets the pace, not
  // the sum. A register's owner over the databases' copies. rec: { hex, reg, faaAt } (faaAt: the FAA already asked).
  // The answer: { reg, type, desc, owner, ownerCity, country, countryIso, msn, year, regAnswered, regFailed, faaAsked,
  // ownerReg (the owner is a register's) }
  async function identity(rec, o) {
    const hex = rec.hex.toUpperCase(), lc = rec.hex.toLowerCase(), out = {}, q = { priority: !!(o && o.priority), bg: !!(o && o.bg) };
    let faaDone = !!rec.faaAt;
    const hexdb = ask(`https://hexdb.io/api/v1/aircraft/${hex}`, q).then(h => { const x = hexdbParse(h); if (x) { out.reg = x.reg; out.type = x.type; out.desc = x.desc; out.owner = x.owner; } }).catch(() => { /* 404 is normal */ });
    const adsbdb = ask(`https://api.adsbdb.com/v0/aircraft/${hex}`, q).then(j => { const x = adsbdbParse(j); if (x) { out.reg2 = x.reg; out.type2 = x.type; out.desc2 = x.desc; out.owner2 = x.owner; out.country = x.country; out.countryIso = x.countryIso; } }).catch(() => { /* ignore */ });
    const faaFor = reg => faa(reg, q).then(f => { faaDone = true; out.faaAsked = true; out.regAnswered = true; if (f) { out.msn = f.msn; out.year = f.year; out.faaOwner = f.owner; out.ownerCity = [f.city, f.state].filter(Boolean).join(', '); } }).catch(e => { out.regFailed = true; log('faa', reg, String(e.message || e)); });
    const faaNow = rec.reg && /^N\d/i.test(rec.reg) && !faaDone ? faaFor(rec.reg) : null;
    // (the Isle of Man register for M- marks: its current owner over the databases' copies)
    const iomFor = reg => iom(reg, q).then(f => { out.regAnswered = true; if (f && (!f.hex || f.hex === lc)) { out.iomOwner = f.owner; if (f.msn) out.msn = out.msn || f.msn; if (f.year && !out.year) out.year = f.year; if (f.owner) out.ownerCity = out.ownerCity || 'Isle of Man'; } }).catch(e => { out.regFailed = true; log('iom register', reg, String(e.message || e)); });
    const iomNow = rec.reg && /^M-/i.test(rec.reg) ? iomFor(rec.reg) : null;
    // (and the UK's G-INFO for G- marks: hexdb and adsbdb say only "Private" for most of them)
    const ukFor = reg => ginfo(reg, q).then(f => { out.regAnswered = true; if (f && (!f.hex || f.hex === lc)) { out.ukOwner = f.owner; if (f.msn) out.msn = out.msn || f.msn; if (f.year && !out.year) out.year = f.year; } }).catch(e => { out.regFailed = true; log('g-info', reg, String(e.message || e)); });
    const ukNow = rec.reg && /^G-/i.test(rec.reg) ? ukFor(rec.reg) : null;
    // (and the Swiss register for HB- marks)
    const chFor = reg => bazl(reg, q).then(f => { out.regAnswered = true; if (f && (!f.hex || f.hex === lc)) { out.chOwner = f.owner; if (f.msn) out.msn = out.msn || f.msn; if (f.year && !out.year) out.year = f.year; } }).catch(e => { out.regFailed = true; log('swiss register', reg, String(e.message || e)); });
    const chNow = rec.reg && /^HB-/i.test(rec.reg) ? chFor(rec.reg) : null;
    await Promise.all([hexdb, adsbdb, faaNow, iomNow, ukNow, chNow]);
    out.reg = out.reg || out.reg2; out.type = out.type || out.type2; out.desc = out.desc || out.desc2; out.owner = out.faaOwner || out.iomOwner || out.ukOwner || out.chOwner || out.owner || out.owner2;
    // (a registration only the databases knew: its register asked now)
    const reg = out.reg || rec.reg;
    if (!faaNow && reg && /^N\d/i.test(reg) && !faaDone) { await faaFor(reg); out.owner = out.faaOwner || out.owner; }
    if (!iomNow && reg && /^M-/i.test(reg)) { await iomFor(reg); out.owner = out.iomOwner || out.owner; }
    if (!ukNow && reg && /^G-/i.test(reg)) { await ukFor(reg); out.owner = out.ukOwner || out.owner; }
    if (!chNow && reg && /^HB-/i.test(reg)) { await chFor(reg); out.owner = out.chOwner || out.owner; }
    // (the owner as a register has it - not a database's copy)
    if (out.faaOwner || out.iomOwner || out.ukOwner || out.chOwner) out.ownerReg = true;
    for (const k of ['reg2', 'type2', 'desc2', 'owner2', 'faaOwner', 'iomOwner', 'ukOwner', 'chOwner']) delete out[k];
    return out;
  }
  return { NAME_PLACEHOLDER, clean, decodeEntities, identity, faa, iom, ginfo, bazl, parse: { faa: faaParse, iomEntryId, iom: iomParse, ginfoPick, ginfo: ginfoParse, bazl: bazlParse, hexdb: hexdbParse, adsbdb: adsbdbParse } };
}
/* ==/REGISTRY== */
if (typeof module !== 'undefined') module.exports = { createRegistry };
