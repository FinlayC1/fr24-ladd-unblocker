// Names as shown: owners without their legal form (src/main/01-core.js ownerName), airfields FR24 does not list by
// their own short name (engine fieldShortName via setFields). (The registers' pages: test/unit_registry.cjs.)
// usage: node test/unit_names.cjs <dataDir>
const fs = require('fs');
const path = require('path');
const { createRouteEngine } = require('../src/engine.js');
const dataDir = process.argv[2];
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const core = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '01-core.js'), 'utf8');
const a = core.indexOf('  const NAME_PLACEHOLDER'), b = core.indexOf('  // "LIBERTYVILLE');
const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const { createRegistry } = require('../src/registry.js');
const ownerName = new Function('clean', 'decodeEntities', 'REG', core.slice(a, b) + '; return ownerName;')(clean, x => x, createRegistry(() => Promise.reject(new Error('offline'))));
for (const [raw, want] of [['BALLYCASTLE AVIATION LIMITED PARTNERSHIP INCORPORATED', 'Ballycastle Aviation'], ['Pad Aviation Service GmbH', 'Pad Aviation Service'], ['CTB INC', 'CTB'], ['FLEXJET LLC', 'Flexjet'],
  ['GLOBAL JET LUXEMBOURG S.A.', 'Global Jet Luxembourg'], ['Executive Jet Management, Inc.', 'Executive Jet Management'], ['GAMA AVIATION (UK) LIMITED', 'Gama Aviation'], ['AIR HAMBURG LUFTVERKEHRSGESELLSCHAFT MBH', 'Air Hamburg Luftverkehrsgesellschaft'],
  ['SKYBIRD AVIATION PTY LTD', 'Skybird Aviation'], ['LLC', 'LLC'], ['756J LLC', '756J'], ['756J, L.L.C.', '756J'], ['3M COMPANY', '3M'], ['MAPA AVIATION DWC-LLC', 'Mapa Aviation'], ['MAPA Aviation DWC LLC', 'MAPA Aviation'], ['Mapa Aviation DWC-LLC', 'Mapa Aviation'], ['ACME JETS FZE', 'Acme Jets'], ['ACME JETS FZ-LLC', 'Acme Jets'], ['ACME JETS FZCO', 'Acme Jets'], ['ACME JETS DMCC', 'Acme Jets'], ['DWC LLC', 'DWC'], ['DWC AVIATION LLC', 'DWC Aviation'], ['PAL Aerospace Ltd (Provincial Aerospace)', 'PAL Aerospace'], ['GAMA AVIATION (UK) LIMITED', 'Gama Aviation'], ['Acme Air Inc. (formerly Foo Jets)', 'Acme Air'], ['Private', ''], ['PRIVATE OWNER', ''], ['DEREK NEIL WATSON', 'Derek Neil Watson'], ['WELLS FARGO TRUST CO NA TRUSTEE', ''], ['TVPX AIRCRAFT SOLUTIONS INC TRUSTEE', ''], ['BANK OF UTAH TRUSTEE', ''], ['AC EXECUTIVE AIRCRAFT (2025) LIMITED', 'AC Executive Aircraft'], ['GS AVIATION (EUROPE) LTD', 'GS Aviation'], ['ARTHUR J GALLAGHER & CO (ILLINOIS)', 'Arthur J Gallagher'], ['ARTHUR J GALLAGHER (ILLINOIS)', 'Arthur J Gallagher'], ['AC EXECUTIVE AIRCRAFT (2025)', 'AC Executive Aircraft'], ['HAWKWIND HELICOPTERS LTD', 'Hawkwind Helicopters'], ['MR JOHN SMITH', 'Mr John Smith'], ['AL JABER AVIATION', 'Al Jaber Aviation'], ['ACME LEASING (NO. 2) LIMITED', 'Acme Leasing'], ['JO SMITH', 'Jo Smith']]) check(`owner "${raw}" -> "${want}"`, ownerName(raw) === want, ownerName(raw));
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows); require('./dataset.cjs').withFields(E, dataDir);
E.setRunways(JSON.parse(fs.readFileSync(path.join(dataDir, 'runways.json'), 'utf8')));
const w = E.byIcao('EGOW');
check('RAF Woodvale (no FR24 pin) is "Woodvale"', !!w && w.field && w.city === 'Woodvale', w && w.city);
const sp = E.heliAirportAt(53.5862, -3.0485);
check('a helicopter down by the Woodvale hangars landed at Woodvale, not a private site', !!sp && sp.airport.icao === 'EGOW', sp && sp.airport.icao);
const p = E.byIcao('EGHP'); check('Popham Airfield is "Popham"', !!p && p.city === 'Popham', p && p.city);
const k = E.byIcao('PHNG'); check('Kaneohe Bay MCAS (Marion E. Carl Field) is "Kaneohe Bay"', !!k && k.city === 'Kaneohe Bay', k && k.city);
// (a helicopter 13 minutes down 3 km beyond Heathrow's western runway ends - a private site, not Heathrow; one by the
// terminals is at Heathrow)
const lx = E.heliAirportAt(51.4988, -0.5228); check('a helicopter down 3 km off Heathrow\'s runways is not at Heathrow', !lx || lx.airport.icao !== 'EGLL', lx && lx.airport.icao);
const lt = E.heliAirportAt(51.4710, -0.4540); check('a helicopter down by Heathrow\'s terminals is at Heathrow', !!lt && lt.airport.icao === 'EGLL', lt && lt.airport.icao);
// country of registration from the registration's nationality mark (T7-AFP wears 50043E, just past San Marino's block)
{
  const a2 = core.indexOf('  const REG_COUNTRY = '), b2 = core.indexOf('  const countryOf = ');
  const regCountry = new Function(core.slice(a2, b2) + '; return regCountry;')();
  for (const [r, want] of [['T7-AFP', 'SM'], ['TF-AKG', 'IS'], ['M-WJBA', 'IM'], ['N523CB', 'US'], ['JA123A', 'JP'], ['B-HPB', 'HK'], ['C-GTLA', 'CA'], ['9H-VJA', 'MT'], ['VP-CAB', 'KY'], ['Z-WPA', 'ZW'], ['ZS-ABC', 'ZA']])
    check(`registration ${r} -> ${want}`, (regCountry(r) || {}).iso === want, regCountry(r));
  check('China\'s B- (Taiwan registers under B- too) is left to the transponder address', regCountry('B-1234') === null, regCountry('B-1234'));
}
// AGE (1.2.1): worked out on the monitor (monitor/ages.cjs) from the age table; the browser asks it
(async () => {
  const { createAges } = require('../monitor/ages.cjs');
  const AG = createAges({ file: path.join(__dirname, '..', 'src', 'agetable.json') }), thisYear = new Date().getFullYear();
  const of = q => AG.of(q) || {};
  check('B-223P (757-23N(PCF), serial 30887 - once N-registered): built 2000, its own record', of({ type: 'B752', msn: '30887' }).year === 2000 && of({ type: 'B752', msn: '30887' }).est === false, of({ type: 'B752', msn: '30887' }));
  check('TF-AKG (747-400F, serial 33732): 2004, dated from its serial number', of({ type: 'B744', msn: '33732' }).year === 2004, of({ type: 'B744', msn: '33732' }));
  const tbl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'agetable.json'), 'utf8'));
  const [s0, y0] = tbl.GLF6.split(',')[10].split(':');
  check('an airframe the table holds: its own year', of({ type: 'GLF6', msn: s0 }).year === 1900 + Number(y0), { serial: s0, got: of({ type: 'GLF6', msn: s0 }) });
  const aibd = of({ type: 'A319', msn: '4455' });
  check('D-AIBD (A319, serial 4455, built 2010 - never on the FAA\'s register): dated from the A320 family\'s serials, within a year', Math.abs(aibd.year - 2010) <= 1, aibd);
  check('... the A321neo the same way (one sequence)', of({ type: 'A21N', msn: '7000' }).year > 2010, of({ type: 'A21N', msn: '7000' }));
  check('a register\'s year wins', of({ type: 'B744', msn: '33732', year: 2003 }).year === 2003 && of({ type: 'B744', msn: '33732', year: 2003 }).how === 'the register');
  // (an operator's fleet: the middle year of its others of the type)
  AG.addFleet('Acme Air', 'B738', 2007); AG.addFleet('ACME AIR LTD', 'B738', 2008); AG.addFleet('Acme Air', 'B738', 2008);
  const fl = of({ type: 'B738', msn: 'X1', op: 'Acme Air' });
  check('no dated serial near it: its operator\'s fleet of the type, as an estimate ("Acme Air" and "ACME AIR LTD" the same)', fl.year === 2008 && fl.est && /fleet/.test(fl.how), fl);
  const ty = of({ type: 'B738' });
  check('known by its type alone: the type\'s middle year, as an estimate - every aircraft with a type has an age', ty.year > 1995 && ty.year < 2020 && ty.est && ty.how === 'its type', ty);
  check('no type at all: none made up', AG.of({ msn: '5432' }) === null);
  AG.learn({ type: 'H25B', msn: '258777', year: 2006, op: 'Jet Story' });
  check('the aircraft database\'s own dated airframes join the table', of({ type: 'H25B', msn: '258777' }).year === 2006 && of({ type: 'H25B', msn: '258777' }).how === 'its own record');
  // the browser: its build-year code with the monitor stood in for
  const d = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '03-data.js'), 'utf8');
  const a3 = d.indexOf('  // ---- build year (AGE'), b3 = d.indexOf('  const ageTitle = hx =>');
  const asked = [], kv = {};
  const B = new Function('monGet', 'store', 'syncPanelSoon', 'log', d.slice(a3, b3) + '; return { builtYear, ageText, fr24BuiltYear };')(
    async p => { asked.push(p); const q = decodeURIComponent(p.split('q=')[1] || ''); return { v: 1, list: q.split(';').map(x => { const f = x.split('~'); const r = AG.of({ type: f[0], msn: f[1], op: f[2] }); return r ? [r.year, r.est ? 1 : 0, r.how] : null; }) }; },
    { getHex: h => kv[h] || null }, () => {}, () => {});
  check('B-223P in the browser: nothing at first (asked of the monitor)...', B.ageText({ type: 'B752', msn: '30887' }) === '');
  await new Promise(r => setTimeout(r, 300));
  check('... then its age as FR24 would show it, from the monitor', B.ageText({ type: 'B752', msn: '30887' }) === `${thisYear - 2000} years` && asked.length === 1, { text: B.ageText({ type: 'B752', msn: '30887' }), asked });
  kv.abcdef = { type: 'B752' };
  check('the model\'s name as the type ("BOEING 757-23N(PCF)"): the type code kept for the aircraft used instead', (() => { B.ageText({ hex: 'abcdef', type: 'BOEING 757-23N(PCF)', msn: '30887' }); return true; })() && B.ageText({ hex: 'abcdef', type: 'BOEING 757-23N(PCF)', msn: '30887' }) === `${thisYear - 2000} years`);
  check('an estimated year from the monitor shows "~"', B.ageText({ year: 2010, yearEst: true, yearHow: 'its type' }) === `~${thisYear - 2010} years`);
  check('FR24\'s own date of manufacture read as a date, a time or an age', B.fr24BuiltYear('2001-03-15', null) === 2001 && B.fr24BuiltYear(986601600, null) === 2001 && B.fr24BuiltYear('', 24) === new Date().getUTCFullYear() - 24 && B.fr24BuiltYear('', 0) === 0);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exitCode = fails ? 1 : 0;
})();
