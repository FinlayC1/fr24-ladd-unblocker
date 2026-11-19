// (1.4.1) The monitor's flights of FR24's map by flight number (monitor/fr24fn.cjs) and FR24's flight number in its feed
// (monitor/fr24.cjs - 'flight' asked for, ExtendedFlightInfo field 1):
//   - a flight with a flight number followed as the scans see it - its callsign, aircraft, FR24's route, first and last
//     seen - and written by its flight number 45 minutes after it was last seen; one seen for under two minutes never
//   - a flight number's flights by time, newest first: written, not written yet, still being followed - each FR24 id once
//   - each airline callsign's flight number as FR24 last showed it (EZY327L -> U2414); a registration's never
//   - kept over a restart; months older than the days kept, gone whole
//   - fr24.cjs: 'flight' asked for first; a record's flight number read
// usage: node test/unit_fr24fn.cjs
const fs = require('fs'), os = require('os'), path = require('path');
const { createFnIndex, bucketOf } = require('../monitor/fr24fn.cjs');
const FR = require('../monitor/fr24.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

(async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-'));
  const IX = createFnIndex({ store, keepDays: 100 });
  // (two days ago, 18:44Z: U2414, EZY327L, Stansted to Glasgow on G-EZFT - seen in the scans for 55 minutes)
  const T = Math.floor(Date.now() / 1000) - 2 * 86400, rec = (o) => Object.assign({ id: 0x3d6e1f2a, fn: 'U2414', cs: 'EZY327L', hex: '4ca9d3', reg: 'G-EZFT', type: 'A319', from: 'STN', to: 'GLA', ts: T }, o);
  for (let k = 0; k <= 55; k += 5) IX.observe([rec({ ts: T + k * 60 })], T + k * 60);
  check('a flight seen: followed, not written yet', IX.open === 1 && IX.stats.written === 0);
  let q = await IX.query('u2414', T - 3600, T + 7200);
  check('... asked for meanwhile (by its number, any case): there, from what is being followed', q.length === 1 && q[0].fid === '3d6e1f2a' && q[0].t0 === T && q[0].t1 === T + 55 * 60 && q[0].from === 'STN' && q[0].to === 'GLA' && q[0].reg === 'G-EZFT', q);
  // (45 minutes after it was last seen: over, written)
  IX.observe([], T + 55 * 60 + 46 * 60); IX.flush();
  check('45 minutes after it was last seen: over - written to its month\'s file of its number', IX.open === 0 && IX.stats.written === 1 && fs.existsSync(path.join(store, 'fr24fn', new Date(T * 1000).toISOString().slice(0, 7), bucketOf('U2414') + '.txt')));
  // (the same number the next day, another aircraft; another number in the same scans)
  const T2 = T + 86400;
  for (let k = 0; k <= 50; k += 10) IX.observe([rec({ id: 0x3d7a0001, hex: '406b11', reg: 'G-EZOA', cs: 'EZY327L', ts: T2 + k * 60 }), rec({ id: 0x3d7a0002, fn: 'FR436', cs: 'RYR33EF', hex: '4d2222', reg: '9H-QAL', type: 'B738', from: 'DUB', to: 'STN', ts: T2 + k * 60 })], T2 + k * 60);
  IX.observe([], T2 + 3 * 3600); IX.flush();
  q = await IX.query('U2414', T - 86400, T2 + 86400);
  check('a flight number\'s flights: both days, newest first, each its own aircraft; another number\'s not among them', q.length === 2 && q[0].fid === '3d7a0001' && q[0].reg === 'G-EZOA' && q[1].fid === '3d6e1f2a', q.map(x => [x.fid, x.reg]));
  q = await IX.query('U2414', T2 - 3600, T2 + 7200);
  check('... by time: only the day asked for', q.length === 1 && q[0].fid === '3d7a0001');
  check('... nothing for a number never seen, or for what is no flight number', (await IX.query('ZZ9999')).length === 0 && (await IX.query('../etc')).length === 0);
  // (seen for under two minutes - a glimpse: never written)
  IX.observe([rec({ id: 0x3d7a0003, fn: 'BA1358', cs: 'SHT2V', ts: T2 })], T2); IX.observe([], T2 + 3 * 3600); IX.flush();
  check('a flight glimpsed in one scan only: never written', (await IX.query('BA1358', T2 - 3600, T2 + 7200)).length === 0);
  // (seen taxiing first - a busy airport's scan sees the ground too: its times those it was seen in the air)
  const T3 = T2 + 6 * 3600;
  for (let k = 0; k < 10; k += 2) IX.observe([rec({ id: 0x3d7a0004, fn: 'U2801', cs: 'EZY318P', ts: T3 + k * 60, gnd: true })], T3 + k * 60);
  for (let k = 10; k <= 60; k += 5) IX.observe([rec({ id: 0x3d7a0004, fn: 'U2801', cs: 'EZY318P', ts: T3 + k * 60, gnd: false })], T3 + k * 60);
  IX.observe([], T3 + 4 * 3600); IX.flush();
  const q3 = await IX.query('U2801', T3 - 3600, T3 + 7200);
  check('a flight seen taxiing before it took off: its times those it was seen in the air - not its taxi', q3.length === 1 && q3[0].t0 === T3 + 600 && q3[0].t1 === T3 + 3600, q3);
  IX.observe([rec({ id: 0x3d7a0005, fn: 'U2702', cs: 'EZY309P', ts: T3, gnd: true })], T3); IX.observe([rec({ id: 0x3d7a0005, fn: 'U2702', cs: 'EZY309P', ts: T3 + 900, gnd: true })], T3 + 900);
  IX.observe([], T3 + 4 * 3600); IX.flush();
  check('... one only ever seen on the ground: never written', (await IX.query('U2702', T3 - 3600, T3 + 7200)).length === 0);
  // ---- callsigns' flight numbers
  const cf = IX.csFn(['EZY327L', 'RYR33EF', 'GEZFT', 'NOPE1']);
  check('each airline callsign\'s flight number as FR24 last showed it; none for one never seen', cf.EZY327L === 'U2414' && cf.RYR33EF === 'FR436' && !('NOPE1' in cf), cf);
  IX.observe([rec({ id: 0x3d7a0009, fn: 'GEZFT', cs: 'GEZFT', ts: T2 })], T2);
  check('... a registration flown as its own callsign: no flight number of it', !('GEZFT' in IX.csFn(['GEZFT'])));
  // ---- a restart: callsigns and the flights being followed kept
  IX.observe([rec({ id: 0x3d7b0001, fn: 'U2701', cs: 'EZY308P', ts: Date.now() / 1000 - 600 })], Date.now() / 1000 - 600);
  IX.observe([rec({ id: 0x3d7b0001, fn: 'U2701', cs: 'EZY308P', ts: Date.now() / 1000 - 300 })], Date.now() / 1000 - 300);
  IX.save(Date.now() / 1000);
  const IX2 = createFnIndex({ store, keepDays: 100 }); IX2.load(Date.now() / 1000);
  const q2 = await IX2.query('U2701');
  check('written and read again (a restart): the callsigns\' numbers and the flight still being followed kept', IX2.csFn(['EZY327L']).EZY327L === 'U2414' && q2.length === 1 && q2[0].fid === '3d7b0001' && (await IX2.query('U2414', T - 86400, T2 + 86400)).length === 2, { q2 });
  // ---- months older than the days kept: gone whole
  const old = path.join(store, 'fr24fn', '2020-01'); fs.mkdirSync(old, { recursive: true }); fs.writeFileSync(path.join(old, '00.txt'), 'X\n');
  IX2.prune(Date.now() / 1000);
  check('a month older than the days kept: gone whole; this one\'s kept', !fs.existsSync(old) && fs.existsSync(path.join(store, 'fr24fn', new Date(T * 1000).toISOString().slice(0, 7))));
  fs.rmSync(store, { recursive: true, force: true });

  // ---- FR24's feed: 'flight' asked for first, a record's flight number read (ExtendedFlightInfo field 1)
  check('fr24.cjs: the flight number asked for first, then each step down as before', FR.MASKS[0].includes('flight') && FR.MASKS[0].includes('route') && FR.MASKS[0].includes('icao_address') && !FR.MASKS[1].includes('flight'));
  const varint = n => { const o = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 0x80; o.push(x); } while (n); return o; };
  const fV = (fn, v) => Buffer.from([...varint(fn * 8), ...varint(v)]), fL = (fn, b) => Buffer.concat([Buffer.from([...varint(fn * 8 + 2), ...varint(b.length)]), b]), fS = (fn, s) => fL(fn, Buffer.from(s));
  const fF = (fn, v) => { const b = Buffer.alloc(5); b[0] = fn * 8 + 5; b.writeFloatLE(v, 1); return b; };
  const ex = Buffer.concat([fS(1, 'U22265'), fS(2, 'G-ZXIF'), fL(3, Buffer.concat([fS(1, 'LPL'), fS(2, 'BFS')])), fS(4, 'A21N'), fV(14, 0x40789a)]);
  const f = FR.flightOf(new Uint8Array(Buffer.concat([fV(1, 0x3d8a0001), fF(2, 53.4), fF(3, -2.9), fV(5, 12000), fV(9, 1795000000), fS(11, 'EZY64HA'), fL(13, ex)])));
  check('fr24.cjs: a record\'s flight number, beside its callsign, registration, route and address', !!f && f.fn === 'U22265' && f.cs === 'EZY64HA' && f.reg === 'G-ZXIF' && f.from === 'LPL' && f.to === 'BFS' && f.hex === '40789a', f);

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
