// (1.4.0) The monitor's "On ground" of every airport (monitor/onground.cjs): an aircraft from its landing - its approach
// seen, then no report of it in the air - or from being seen on the ground at a field, until it is seen in the air again;
// FR24's airports and OurAirports' fields alike; kept over a restart; a week at most.
// usage: node test/unit_onground.cjs
const fs = require('fs'), os = require('os'), path = require('path');
const { createOnGround } = require('../monitor/onground.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const R = 6371, rad = x => x * Math.PI / 180;
const dist = (a, b, c, d) => { const dLat = rad(c - a), dLon = rad(d - b), h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
// (FR24's airports, and OurAirports' fields the engine knows: Liverpool, Hawarden 30 km off, a heliport by the Mersey)
const APS = [{ id: 2002, iata: 'LPL', lat: 53.3336, lon: -2.8497, alt: 80 }, { id: 2400, iata: 'CEG', lat: 53.1781, lon: -2.9778, alt: 45 }];
const FIELDS = [{ id: 17000002, code: 'GB-0123', lat: 53.405, lon: -2.99, alt: 20 }];
const near = list => (lat, lon, km, fn) => { for (const a of list) { const d = dist(lat, lon, a.lat, a.lon); if (d <= km) fn(a, d); } };
const E = { nearby: near(APS), nearbyFields: near(FIELDS) };
const store = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'));
const OG = createOnGround({ E, store });
const T0 = 1795000000;
// (a scan's report: FR24's LiveFeed record as the monitor reads it)
const rep = (o) => Object.assign({ id: 0x3d000001, lat: 0, lon: 0, alt: 0, spd: 140, trk: 270, gnd: false, ts: T0, hex: '406a1b', reg: 'G-LFSA', type: 'PA38', cs: 'GLFSA', from: '', to: '' }, o);

// ---- a landing: coming down to Liverpool, then no report of it in the air
OG.observe([rep({ lat: 53.31, lon: -2.70, alt: 2400, ts: T0 })], T0);
OG.observe([rep({ lat: 53.32, lon: -2.75, alt: 1700, ts: T0 + 30 })], T0 + 30);
OG.observe([rep({ lat: 53.33, lon: -2.80, alt: 900, ts: T0 + 60 })], T0 + 60);
check('coming in to Liverpool, a minute on: not on the ground yet', OG.list(2002, T0 + 120).length === 0);
const l1 = OG.list(2002, T0 + 60 + 300);
check('... no report of it in the air four minutes and more on: on the ground at Liverpool, landed when last seen coming in', l1.length === 1 && l1[0].reg === 'G-LFSA' && l1[0].hex === '406a1b' && l1[0].land === T0 + 60 && !l1[0].est && l1[0].type === 'PA38' && l1[0].cs === 'GLFSA', l1);
// ---- seen on the ground there (a scan of an airport being looked at): still there
OG.observe([rep({ lat: 53.334, lon: -2.851, alt: 0, spd: 0, gnd: true, ts: T0 + 3600 })], T0 + 3600);
const l2 = OG.list(2002, T0 + 3700);
check('... seen on the ground there an hour on: still there, its landing as it was', l2.length === 1 && l2[0].land === T0 + 60 && l2[0].gnd, l2);
// ---- it takes off: off the list
OG.observe([rep({ lat: 53.34, lon: -2.90, alt: 1200, ts: T0 + 7200 })], T0 + 7200);
OG.observe([rep({ lat: 53.36, lon: -2.98, alt: 2300, ts: T0 + 7260 })], T0 + 7260);
check('... seen climbing away: no longer on the ground anywhere', OG.list(2002, T0 + 7600).length === 0 && OG.list(2400, T0 + 7600).length === 0);

// ---- a touch-and-go: coming in, then climbing away - never on the list
const tg = (o) => rep(Object.assign({ id: 0x3d000002, hex: '407777', reg: 'G-RVNA', cs: 'GRVNA' }, o));
OG.observe([tg({ lat: 53.32, lon: -2.76, alt: 1500, ts: T0 })], T0);
OG.observe([tg({ lat: 53.33, lon: -2.82, alt: 600, ts: T0 + 30 })], T0 + 30);
OG.observe([tg({ lat: 53.34, lon: -2.89, alt: 1100, ts: T0 + 90 })], T0 + 90);
check('a touch-and-go (down, then climbing away): not on the ground', !OG.list(2002, T0 + 600).some(x => x.reg === 'G-RVNA'));
// ---- an aircraft passing over high: never
const ov = (o) => rep(Object.assign({ id: 0x3d000003, hex: '4ca1b2', reg: 'EI-ABC', type: 'A320', cs: 'EIN12' }, o));
OG.observe([ov({ lat: 53.33, lon: -2.80, alt: 9000, ts: T0 })], T0);
OG.observe([ov({ lat: 53.33, lon: -2.90, alt: 8000, ts: T0 + 30 })], T0 + 30);
check('passing over at 8,000 ft, then out of sight: not on the ground', !OG.list(2002, T0 + 900).some(x => x.reg === 'EI-ABC'));

// ---- FR24's route saying where it goes: that field, not the nearest
const rt = (o) => rep(Object.assign({ id: 0x3d000004, hex: '400001', reg: 'G-HAWK', type: 'C172', cs: 'GHAWK', to: 'CEG' }, o));
// (between the two: 1.6 km nearer Liverpool's reach line than Hawarden's - FR24 says Hawarden)
OG.observe([rt({ lat: 53.22, lon: -2.95, alt: 1400, ts: T0 })], T0);
OG.observe([rt({ lat: 53.20, lon: -2.96, alt: 900, ts: T0 + 30 })], T0 + 30);
check('coming in where FR24\'s route says it goes (Hawarden): on the ground there, not at the nearest other field', OG.list(2400, T0 + 600).some(x => x.reg === 'G-HAWK') && !OG.list(2002, T0 + 600).some(x => x.reg === 'G-HAWK'));

// ---- an OurAirports heliport: a helicopter seen on the ground there
const he = (o) => rep(Object.assign({ id: 0x3d000005, hex: '43c111', reg: 'G-HELI', type: 'EC35', cs: 'HELI1' }, o));
OG.observe([he({ lat: 53.41, lon: -2.95, alt: 600, ts: T0 })], T0);
OG.observe([he({ lat: 53.405, lon: -2.989, alt: 0, spd: 0, gnd: true, ts: T0 + 60 })], T0 + 60);
const lh = OG.list(17000002, T0 + 120);
check('a helicopter seen on the ground at an OurAirports heliport: on that field\'s list', lh.length === 1 && lh[0].reg === 'G-HELI' && lh[0].gnd, lh);

// ---- first seen without its address, then with it: one aircraft
const na = (o) => rep(Object.assign({ id: 0x3d000006, reg: 'M-PORT', type: 'C68A', cs: 'MPORT' }, o));
OG.observe([na({ hex: '', lat: 53.32, lon: -2.76, alt: 1500, ts: T0 })], T0);
OG.observe([na({ hex: '43edb1', lat: 53.33, lon: -2.82, alt: 700, ts: T0 + 30 })], T0 + 30);
const lm = OG.list(2002, T0 + 600).filter(x => x.reg === 'M-PORT');
check('first seen without its address, then with it: one aircraft on the list, by its address', lm.length === 1 && lm[0].hex === '43edb1', lm);
// ---- a ground vehicle (FR24's marker): never
OG.observe([rep({ id: 0x3d000007, hex: '', reg: '', type: 'GRND', cs: 'FOLLOWME', lat: 53.334, lon: -2.85, alt: 0, gnd: true, ts: T0 + 60 })], T0 + 60);
check('FR24\'s ground vehicles: never on the list', !OG.list(2002, T0 + 600).some(x => x.cs === 'FOLLOWME'));

// ---- a restart: the list as it was
OG.save(T0 + 700);
const OG2 = createOnGround({ E, store });
const n2 = OG2.load(T0 + 800);
const a1 = OG.list(2002, T0 + 800).map(x => x.reg).sort(), a2 = OG2.list(2002, T0 + 800).map(x => x.reg).sort();
check('written and read again (a restart): the same aircraft on the ground, the same landings', n2 > 0 && JSON.stringify(a1) === JSON.stringify(a2) && a2.includes('M-PORT') && OG2.list(17000002, T0 + 800).length === 1, { a1, a2 });
// ---- a week on: forgotten
OG2.prune(T0 + 8 * 86400);
check('a week and more with no report: off the list', OG2.list(2002, T0 + 8 * 86400).length === 0 && OG2.list(17000002, T0 + 8 * 86400).length === 0);

fs.rmSync(store, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
