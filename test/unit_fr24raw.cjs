// (1.2.4) The monitor's store of every FR24 position as it came (monitor/fr24raw.cjs): each second of a flight once, with
// every figure; written a member at a time, read back by FR24's id of the flight, across days and a restart; old days gone
// usage: node test/unit_fr24raw.cjs
const fs = require('fs'), os = require('os'), path = require('path');
const { createFr24Raw, COLS } = require('../monitor/fr24raw.cjs');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };
const store = fs.mkdtempSync(path.join(os.tmpdir(), 'fr24raw-'));
const T = Date.UTC(2026, 10, 4, 12) / 1000, id = 0x3d1f6a2b;
const raw = createFr24Raw({ store });
// (a trail: speeds and headings with it; then the scans' positions - two of them seconds the trail has too)
const trail = []; for (let i = 0; i < 40; i++) trail.push({ t: T + i * 15, lat: 52 + i * 0.01, lon: -1.3 + i * 0.012, alt: i ? 1000 + i * 250 : 0, gs: i ? 140 + i : 12, trk: 71, gnd: !i });
check('a trail taken whole', raw.put(id, { hex: '4078a3', reg: 'G-POLV', cs: 'UKP155', type: 'P68' }, trail) === 40 && raw.pending === 40);
check('... the same points again: nothing new', raw.put(id, {}, trail.slice(0, 10)) === 0);
check('... one second again with more figures: that one kept', raw.put(id, {}, [Object.assign({}, trail[5], { vr: 640, sq: '7000' })]) === 0 && raw.of(id, T).p.find(r => r[0] === T + 75)[COLS.indexOf('sq')] === '7000');
raw.put(id, {}, [{ t: T + 600, lat: 52.5, lon: -0.8, alt: 11000, gs: 180, trk: 75 }, { t: T + 15, lat: 52.01, lon: -1.288, alt: 1250, gs: 141, trk: 71 }]);
check('... a scan position after: added; one of a second it has: not', raw.pending === 41, raw.pending);
check('written: one member, the flight in it', raw.flush(T + 900) === 1 && raw.pending === 0 && raw.stats.members === 1);
const day = new Date(T * 1000).toISOString().slice(0, 10), dir = path.join(store, 'fr24raw');
check('... the day\'s files and its index line', fs.existsSync(path.join(dir, day + '.gzl')) && fs.readFileSync(path.join(dir, day + '.idx'), 'utf8').trim() === '3d1f6a2b 0 ' + fs.statSync(path.join(dir, day + '.gzl')).size);
let got = raw.of(id, T);
check('read back: every point in time order, figures as given, what it is', got && got.p.length === 41 && got.p[0][0] === T && got.p[1][COLS.indexOf('gs')] === 141 && got.p[0][COLS.indexOf('gnd')] === 1 && got.m.reg === 'G-POLV' && got.m.cs === 'UKP155', got && { n: got.p.length, m: got.m });
check('... by its id in hex too', raw.of('3d1f6a2b', T).p.length === 41);
// (written already: sent again within the day and a half held - not written twice)
raw.put(id, {}, trail); check('... the trail sent again after it was written: nothing to write', raw.pending === 0 && raw.flush(T + 1800) === 0);
// (another flight in the next member, and more of the first)
raw.put(0x3d1f6a2c, { cs: 'EZY86NE' }, [{ t: T + 3600, lat: 55.9, lon: -3.3, alt: 4000, gs: 220, trk: 256 }]);
raw.put(id, {}, [{ t: T + 1200, lat: 52.7, lon: -0.6, alt: 12000, gs: 185, trk: 80 }]);
check('a second member: both flights', raw.flush(T + 3700) === 2 && raw.stats.members === 2);
got = raw.of(id, T);
check('... the first flight from both members', got.p.length === 42 && got.p[got.p.length - 1][0] === T + 1200);
// (a fresh start - nothing held: read from the files)
const raw2 = createFr24Raw({ store });
check('after a restart: read from the files', raw2.of(id, T).p.length === 42 && raw2.of(0x3d1f6a2c, T).m.cs === 'EZY86NE');
raw2.put(id, {}, trail.slice(0, 3)); raw2.flush(T + 4000);
check('... points sent again after a restart: in a member twice, read once', raw2.of(id, T).p.length === 42);
check('a flight not kept: none', raw2.of(0x1234, T) === null && raw2.of('nothex', T) === null);
check('points without a position: refused', raw2.put(id, {}, [{ t: T, lat: 'x', lon: 0 }, { t: NaN, lat: 1, lon: 1 }, null]) === 0);
// (a member cut short - a stop part way through a write: the rest still read)
fs.appendFileSync(path.join(dir, day + '.gzl'), Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
fs.appendFileSync(path.join(dir, day + '.idx'), '3d1f6a2b ' + (fs.statSync(path.join(dir, day + '.gzl')).size - 4) + ' 4\n');
check('... a broken member: the others still read', createFr24Raw({ store }).of(id, T).p.length === 42);
// (the days kept: 730 - an older day's files removed)
fs.writeFileSync(path.join(dir, '2020-01-01.gzl'), ''); fs.writeFileSync(path.join(dir, '2020-01-01.idx'), '');
check('old days removed, the kept ones not', raw2.prune(T) === 2 && fs.existsSync(path.join(dir, day + '.gzl')));
// (the disk short of room: the points gathered let go)
raw2.put(0x3d1f6a2d, {}, [{ t: T, lat: 1, lon: 1 }]); check('dropped, counted', raw2.drop() === 1 && raw2.pending === 0 && raw2.stats.skipped === 1);
fs.rmSync(store, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
