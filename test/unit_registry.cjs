// The aircraft registers (src/registry.js - the code the userscript and the monitor share) and the monitor's owner store
// (monitor/owners.cjs), offline: each register's answer as its parser expects it (the FAA's page, G-INFO's and FOCA's
// JSON, the Isle of Man's pages, hexdb and adsbdb) - the owner, serial number and build year read from each; a register's
// owner over the databases'; a status where a name would be ("REGISTRATION PENDING": the applicant); an entry of another
// airframe not taken. Then the store: looked up once and kept (also across a restart), asked again only when due, a site
// that rate-limits left alone, a browser's findings merged (FR24's operator, a register's owner), rows as /owners sends them.
// usage: node test/unit_registry.cjs
const fs = require('fs'), os = require('os'), path = require('path');
const { createRegistry } = require('../src/registry.js');
const { createOwners } = require('../monitor/owners.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

// ---- what each site answers (made up here, in each one's format)
const FAA = {
  N1848T: '<table><tr><td data-label="Serial Number">680A-0123</td><td data-label="Mfr Year">2015</td></tr><tr><td data-label="Name">BLUE SKY HOLDINGS LLC</td><td data-label="Street">1 SECRET ROAD</td><td data-label="City">WILMINGTON</td><td data-label="State">DELAWARE</td><td data-label="Country">US</td></tr><tr><td data-label="Mode S Code (Base 16 / Hex)">A1B2C3</td></tr></table>',
  N77PX: '<table><tr><td data-label="Serial Number">None</td><td data-label="A/W Date">03/14/2009</td></tr><tr><td data-label="Name">REGISTRATION PENDING</td></tr><tr><td data-label="Name"><b>APPLICANT</b> OSPREY JET LEASING LLC</td></tr></table>'
};
const GINFO = { search: { WAPA: [{ Mark: 'WAPA', RegistrationStatus: 'D', AircraftID: 1 }, { Mark: 'WAPA', RegistrationStatus: 'R', AircraftID: 2 }], NMCF: [{ Mark: 'NMCF', RegistrationStatus: 'R', AircraftID: 3 }] },
  details: { 2: { RegisteredAircraftOwners: [{ RegisteredOwner: 'JOHN SMITH', TradingAs: '' }], AircraftDetails: { SerialNumber: '13001', YearBuild: 2004, ICAO24BitAircraftAddress: { Hex: '40624A' } }, AircraftOperatedByAocHolder: null },
    3: { RegisteredAircraftOwners: [{ RegisteredOwner: 'SOMEONE ELSE LTD' }], AircraftDetails: { SerialNumber: '9', YearBuild: 2010, ICAO24BitAircraftAddress: { Hex: '43C0FF' } }, AircraftOperatedByAocHolder: { OperatorName: 'KINGMOOR AVIATION LTD' } } } };
const IOM = { list: '<tr><td><a href="/register/77/view">M-WJBA</a></td></tr>', view: '<div><label class="l">Registered Owners</label>\n <span class="v">Ballycastle Aviation Limited, A N Other</span></div><div><label>Serial Number</label><span>680A0466</span></div><div><label>Mode S Number</label><span>43EAC1</span></div><div><label>Registered</label><span>01/02/2016</span></div><div><label>Previous International Registration</label><span>New</span></div>' };
const BAZL = [{ registration: 'HB-JNA', ownerOperators: [{ holderCategory: { categoryNames: { en: 'Main Owner' } }, ownerOperator: 'Some Bank AG' }, { holderCategory: { categoryNames: { en: 'Main Operator' } }, ownerOperator: 'Swiss International Air Lines Ltd.' }], details: { serialNumber: '62701', yearOfManufacture: 2016, aircraftAddresses: { hex: '4B1801' } } }];
const HEXDB = { A1B2C3: { Registration: 'N1848T', ICAOTypeCode: 'C68A', Manufacturer: 'Cessna', Type: 'Citation Latitude', RegisteredOwners: 'Private' }, '40624A': { Registration: 'G-WAPA', ICAOTypeCode: 'R44', Manufacturer: 'Robinson', Type: 'R44', RegisteredOwners: 'Private' }, ABCDEF: { Registration: '', ICAOTypeCode: 'GLF6', RegisteredOwners: 'Gulfstream Owner Trust' }, A0B0C0: { Registration: 'N77PX', ICAOTypeCode: 'GLF5' } };
const ADSBDB = { '43EAC1': { registration: 'M-WJBA', icao_type: 'C68A', manufacturer: 'Cessna', type: '680A', registered_owner: 'Private', registered_owner_country_name: 'Isle of Man', registered_owner_country_iso_name: 'IM' }, '4B1801': { registration: 'HB-JNA', icao_type: 'B77W', registered_owner: 'Swiss' } };
const asked = [];
function answer(url, o) {
  asked.push(url); let m;
  if ((m = /hexdb\.io\/api\/v1\/aircraft\/([0-9A-F]{6})$/.exec(url))) return HEXDB[m[1]] ? [200, HEXDB[m[1]]] : [404, ''];
  if ((m = /api\.adsbdb\.com\/v0\/aircraft\/([0-9A-F]{6})$/.exec(url))) return ADSBDB[m[1]] ? [200, { response: { aircraft: ADSBDB[m[1]] } }] : [404, { response: 'unknown aircraft' }];
  if ((m = /NNumberResult\?nNumberTxt=(N[0-9A-Z]+)$/.exec(url))) return answer.faaDown ? [answer.faaDown, ''] : [200, FAA[m[1]] || '<table></table>'];
  if (/ginfoapi\.caa\.co\.uk\/api\/aircraft\/search$/.test(url)) return [200, GINFO.search[JSON.parse(o.body).registration] || []];
  if ((m = /ginfoapi\.caa\.co\.uk\/api\/aircraft\/details\/(\d+)$/.exec(url))) return [200, GINFO.details[m[1]] || null];
  if (/iomaircraftregistry\.com\/register\/search\?.*prs_rm__v1=WJBA/.test(url)) return [200, IOM.list];
  if (/iomaircraftregistry\.com\/register\/77\/view$/.test(url)) return [200, IOM.view];
  if (/bazl\.admin\.ch/.test(url)) return [200, BAZL];
  return [404, ''];
}
// (the userscript's request: JSON parsed unless json is false, an HTTP error a rejection)
const ask = async (url, o) => { const [st, body] = answer(url, o || {}); if (st < 200 || st >= 300) throw new Error('HTTP ' + st); return o && o.json === false ? String(body) : (typeof body === 'string' ? JSON.parse(body || 'null') : body); };

(async () => {
  const R = createRegistry(ask);
  // ---- the registers -----------------------------------------------------------------------------------------------
  const us = await R.identity({ hex: 'a1b2c3', reg: 'N1848T' });
  check('FAA (N-): the owner over hexdb\'s "Private", city and state (not the street), serial number, build year', us.owner === 'BLUE SKY HOLDINGS LLC' && us.ownerCity === 'WILMINGTON, DELAWARE' && us.msn === '680A-0123' && us.year === 2015 && us.type === 'C68A' && us.regAnswered === true && us.faaAsked === true && !JSON.stringify(us).includes('SECRET'), us);
  const pend = await R.identity({ hex: 'a0b0c0', reg: '' });
  check('... registration pending: the applicant is the owner; "None" no serial number; the year from the airworthiness date; the FAA asked for a registration only hexdb knew', pend.owner === 'OSPREY JET LEASING LLC' && !pend.msn && pend.year === 2009 && pend.reg === 'N77PX', pend);
  asked.length = 0; const again = await R.identity({ hex: 'a1b2c3', reg: 'N1848T', faaAt: 1 });
  check('... the FAA already asked (faaAt): not asked again', !asked.some(u => /faa\.gov/.test(u)) && again.owner === 'Private', asked);
  const uk = await R.identity({ hex: '40624a', reg: 'G-WAPA' });
  check('G-INFO (G-): the registered entry (not the deregistered one), its owner over "Private", serial number, build year', uk.owner === 'JOHN SMITH' && uk.msn === '13001' && uk.year === 2004 && uk.regAnswered === true, uk);
  const uk2 = await R.identity({ hex: '400001', reg: 'G-NMCF' });
  check('... an entry with another airframe\'s Mode S: its owner not taken (the register still answered)', !uk2.owner && uk2.regAnswered === true, uk2);
  const uk3 = R.parse.ginfo(GINFO.details[3], GINFO.search.NMCF[0]);
  check('... an AOC holder: the operator over the owner', uk3.owner === 'KINGMOOR AVIATION LTD' && uk3.registered === true, uk3);
  const im = await R.identity({ hex: '43eac1', reg: 'M-WJBA' });
  check('Isle of Man (M-): the first registered owner, serial number, registered new = built that year, "Isle of Man"', im.owner === 'Ballycastle Aviation Limited' && im.msn === '680A0466' && im.year === 2016 && im.ownerCity === 'Isle of Man' && im.countryIso === 'IM', im);
  const ch = await R.identity({ hex: '4b1801', reg: 'HB-JNA' });
  check('FOCA (HB-): the main operator over the main owner, serial number, build year', ch.owner === 'Swiss International Air Lines Ltd.' && ch.msn === '62701' && ch.year === 2016, ch);
  const db = await R.identity({ hex: 'abcdef', reg: '' });
  check('no register: the databases\' owner; nothing marked answered', db.owner === 'Gulfstream Owner Trust' && db.type === 'GLF6' && !db.regAnswered && !db.regFailed, db);
  answer.faaDown = 503; const down = await R.identity({ hex: 'a1b2c3', reg: 'N1848T' }); answer.faaDown = 0;
  check('a register down: marked failed, the databases\' answer kept', down.regFailed === true && !down.regAnswered && down.owner === 'Private' && down.reg === 'N1848T', down);
  // (asked once per mark while a page is open - a failed request again)
  asked.length = 0; await R.identity({ hex: '43eac1', reg: 'M-WJBA' });
  check('the userscript: a register asked once per mark while the page is open', !asked.some(u => /iomaircraft/.test(u)), asked);

  // ---- the monitor's store -----------------------------------------------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owners-'));
  const res = (st, body) => ({ status: st, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
  const fetchLog = [];
  const fetchFn = async (url, o) => { fetchLog.push({ url, ua: o.headers['User-Agent'] }); if (fetchFn.limit && /hexdb/.test(url)) return res(429, ''); const [st, body] = answer(url, { body: o.body }); return res(st, body); };
  const changes = [];
  const mk = () => createOwners({ createRegistry, fetch: fetchFn, cfg: { every: 1 }, onChange: hex => changes.push(hex) });
  const O = mk();
  O.want('a1b2c3', 'N1848T'); O.want('43eac1', 'M-WJBA'); O.want('abcdef', '', true);
  check('to look up: the ones flying now first', O.q[0] === 'abcdef' && O.q.length === 3);
  const t0 = Date.now(); for (let i = 0; i < 3; i++) await O.pumpOne();
  const rows = O.rows(['a1b2c3', '43eac1', 'abcdef', '000001']);
  const byHex = Object.fromEntries(rows.map(r => [r[0], r]));
  check('looked up on the monitor through the same registers: owners, serial numbers, years; rows as /owners sends them', rows.length === 3 && byHex.a1b2c3[4] === 'BLUE SKY HOLDINGS LLC' && byHex.a1b2c3[8] === '680A-0123' && byHex.a1b2c3[9] === 2015 && byHex.a1b2c3[14] === 1 && byHex['43eac1'][4] === 'Ballycastle Aviation Limited' && byHex.abcdef[4] === 'Gulfstream Owner Trust' && byHex.abcdef[14] === 1, rows);
  check('... each site at its own pace (hexdb and adsbdb 1.5 s apart), and saying who asks', Date.now() - t0 >= 2900 && fetchLog.every(x => /fr24-ladd-monitor/.test(x.ua)), Date.now() - t0);
  check('... each one\'s change announced (its name in the names table sent again)', ['a1b2c3', '43eac1', 'abcdef'].every(h => changes.includes(h)));
  check('... not asked again (known, for 60 days)', !O.want('a1b2c3', 'N1848T') && !O.due('a1b2c3'));
  // a browser's findings: FR24's operator; a register's owner where the monitor has only the databases'
  const n = O.fromClient([['abcdef', { owner: 'Real Name Holdings LLC', regAnswered: true, regOwner: true, operatorId: 77, operatorIcao: 'xyz', operatorName: 'XYZ Jets' }], ['a1b2c3', { owner: 'Someone Else', regAnswered: true, regOwner: true, operatorId: 12, operatorName: 'Blue Sky' }], ['zzzzzz', { owner: 'x' }], ['400000', 'no']]);
  const r1 = O.rows(['abcdef'])[0], r2 = O.rows(['a1b2c3'])[0];
  check('a browser\'s findings: FR24\'s operator kept; its register\'s owner over the monitor\'s databases\' one, not over a register\'s; bad rows ignored', n === 2 && r1[4] === 'Real Name Holdings LLC' && r1[10] === 77 && r1[11] === 'XYZ' && r1[12] === 'XYZ Jets' && r2[4] === 'BLUE SKY HOLDINGS LLC' && r2[10] === 12, { r1, r2 });
  const fresh = O.fromClient([['5c0001', { reg: 'D-ABCD', owner: 'Private' }]]);
  check('... a browser\'s "Private": not an owner (looked up here in time)', fresh === 1 && O.rows(['5c0001'])[0][4] === '' && O.want('5c0001') === true);
  check('the names table\'s short form: owner and operator', JSON.stringify(O.short('abcdef')) === JSON.stringify({ owner: 'Real Name Holdings LLC', opName: 'XYZ Jets', opId: 77, opIcao: 'XYZ' }) && O.short('000001') === null);
  // a site that rate-limits: left alone, the aircraft tried again in an hour
  fetchFn.limit = true; const O3 = mk(); O3.want('a0b0c0', 'N77PX'); await O3.pumpOne(); fetchLog.length = 0; O3.want('400aaa'); await O3.pumpOne(); fetchFn.limit = false;
  check('a site that rate-limits: left alone ten minutes (the others still asked)', !fetchLog.some(x => /hexdb/.test(x.url)) && fetchLog.some(x => /adsbdb/.test(x.url)) && O3.status().paused['hexdb.io'] > 500, O3.status().paused);
  answer.faaDown = 503; const O4 = mk(); O4.want('a1b2c3', 'N1848T'); await O4.pumpOne(); answer.faaDown = 0;
  check('... a register that did not answer: tried again in an hour, not before', O4.rows(['a1b2c3'])[0][14] === 0 && !O4.due('a1b2c3') && O4.due('a1b2c3', Math.round(Date.now() / 1000) + 3601));
  // kept on disk
  O.save(dir); const O2 = mk(), k = O2.load(dir);
  check('kept on disk: the same rows after a restart, nothing looked up again', k === O.db.size && JSON.stringify(O2.rows(['a1b2c3', 'abcdef'])) === JSON.stringify(O.rows(['a1b2c3', 'abcdef'])) && !O2.due('a1b2c3'), k);
  check('... the file holds names only (no street, no address)', !fs.readFileSync(path.join(dir, 'owners.json'), 'utf8').includes('SECRET'));
  const st = O.status();
  check('status: known, with owner, with operator, looked up, from browsers', st.known === 4 && st.withOwner === 3 && st.withOperator === 2 && st.looked === 3 && st.fromClients === 3, st);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
