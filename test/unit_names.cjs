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
// AGE by serial number, from the packed table (the script's own code, the build's own table)
(async () => {
  const d = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '03-data.js'), 'utf8');
  const a3 = d.indexOf('  let ageTable = null'), b3 = d.indexOf('  // runs a generator in slices');
  const gz = require('zlib').gzipSync(fs.readFileSync(path.join(__dirname, '..', 'src', 'agetable.json'))).toString('base64');
  const A = new Function('AGE_TABLE_GZ', 'syncPanelSoon', 'log', d.slice(a3, b3) + '; return { loadAgeTable, yearBySerial, ageText, ageTitle };')(gz, () => {}, () => {});
  await A.loadAgeTable();
  const thisYear = new Date().getFullYear();
  const t = A.yearBySerial('B744', '33732');
  check('TF-AKG (747-400F, serial 33732): built 2004, dated from its serial number', !!t && t.year === 2004, t);
  check('its AGE as FR24 would show it', A.ageText({ type: 'B744', msn: '33732' }) === `${thisYear - 2004} years`, A.ageText({ type: 'B744', msn: '33732' }));
  check('a register\'s year wins over the serial number', A.ageText({ type: 'B744', msn: '33732', year: 2003 }) === `${thisYear - 2003} years`);
  check('no type or serial: no age (never made up)', A.ageText({ type: 'GLF5' }) === '' && A.ageText({ msn: '5432' }) === '');
  // every airframe the table holds is dated as its own record says
  const tbl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'agetable.json'), 'utf8'));
  const [s0, y0] = tbl.GLF6.split(',')[10].split(':');
  check('an airframe the FAA register has held: its own year', (A.yearBySerial('GLF6', s0) || {}).year === 1900 + Number(y0), { serial: s0, got: A.yearBySerial('GLF6', s0) });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exitCode = fails ? 1 : 0;
})();
