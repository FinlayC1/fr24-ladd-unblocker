// (1.1.0) Live accuracy (monitor/scores.cjs): every answer of central calculation noted - one each five minutes, and every
// time its destination changes - and scored once the flight is down:
//   - its answer says it landed: each noted answer against where; the flight's own answer the last given half an hour or
//     more before the landing; the figures by kind of aircraft and time to go;
//   - a flight not heard of for three quarters of an hour: where the monitor's log has it ending at an airport; none there
//     after eight hours: given up;
//   - each finished flight written to the day's file with its track and its answers (training data); the week's figures
//     read back after a restart; a day older than two gzipped.
// usage: node test/unit_scores.cjs [dataDir]
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
const { createRouteEngine } = require('../src/engine.js');
const { createScores } = require('../monitor/scores.cjs');
const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8')).rows);
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);
const ltn = E.byIcao('EGGW').id, lgw = E.byIcao('EGKK').id, nce = E.byIcao('LFMN').id, cdg = E.byIcao('LFPG').id;
const store = fs.mkdtempSync(path.join(os.tmpdir(), 'scores-'));
const logs = new Map();
const SC = createScores({ store, E, logOf: hex => logs.get(hex) || [] });
const T = Math.floor(Date.now() / 1000) - 4 * 3600;
const F = (id, hex, type) => ({ id, hex, kind: 'live', rec: { reg: 'N' + id, type }, trail: Array.from({ length: 200 }, (_, i) => ({ t: T + i * 30, lat: 51 - i * 0.02, lon: 0.2 + i * 0.03, alt: 30000 })) });

// ---- a flight to Nice: answers every minute for two hours - CDG first, then Nice
const f1 = F(101, 'a00001', 'GLF6');
for (let m = 0; m <= 120; m++) SC.note(f1, { originId: ltn, destId: m < 30 ? cdg : nce, destP: m < 30 ? 40 : 80, destConf: 'probable', phase: 'level' }, T + m * 60);
const x1 = SC.open.get(101);
check('a flight\'s answers noted: one each five minutes, and when the destination changed (CDG to Nice) - not every minute', x1 && x1.preds.length === 25 && x1.preds[6][1] === nce && x1.preds[5][1] === cdg, x1 && x1.preds.length);
SC.note(f1, { originId: ltn, destId: nce, destConf: 'landed', landed: true, ata: T + 7300 }, T + 7320);
const s1 = SC.summary(T + 7400), d1 = s1.week;
check('... down at Nice: each noted answer scored (19 of 25 right), the flight\'s own - half an hour before - right; jets, by time to go', !SC.open.has(101) && d1.moments === 25 && d1.rightPct === Math.round(1000 * 19 / 25) / 10 && d1.flights === 1 && d1.flightRightPct === 100 && d1.byKind.jet.n === 25 && d1.byTimeToGo['2h+'] && d1.byTimeToGo['<15m'].rightPct === 100, d1);
const file = path.join(store, 'scores', dayOf(T + 7300) + '.jsonl'), rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
check('... written to the day\'s file: the aircraft, origin, where it went, every answer, its track a point a minute', rows.length === 1 && rows[0].hex === 'a00001' && rows[0].origin === ltn && rows[0].actual === nce && rows[0].how === 'landed' && rows[0].preds.length === 25 && rows[0].trail.length === 100, { n: rows.length, trail: rows[0] && rows[0].trail.length });
// ---- a flight not heard of again: found in the monitor's log
const f2 = F(102, 'a00002', 'C25A');
for (let m = 0; m <= 40; m += 5) SC.note(f2, { originId: ltn, destId: lgw, destP: 55, destConf: 'probable', phase: 'level' }, T + m * 60);
SC.sweep(T + 40 * 60 + 600);
check('a flight gone quiet ten minutes: still followed', SC.open.has(102));
logs.set('a00002', [{ tStart: T, tEnd: T + 3500, tOn: T + 3480, from: { id: ltn, conf: 'ground' }, to: { id: cdg, conf: 'ground' } }]);
SC.sweep(T + 40 * 60 + 3000);
const s2 = SC.summary(T + 9000);
check('... three quarters of an hour quiet: where the monitor\'s log has it down (Paris CDG, not Gatwick) - scored wrong, written', !SC.open.has(102) && s2.week.flights === 2 && s2.week.flightRightPct === 50 && s2.scored === 2, s2.week);
// ---- one never found
const f3 = F(103, 'a00003', 'PC12'); SC.note(f3, { destId: lgw, destP: 50, destConf: 'possible', phase: 'level' }, T);
SC.sweep(T + 9 * 3600);
check('... none in the log after eight hours: given up, not scored', !SC.open.has(103) && SC.stats.unresolved === 1 && SC.summary(T + 9 * 3600).scored === 2);
// ---- after a restart; an old day packed
const SC2 = createScores({ store, E, logOf: () => [] }), n = SC2.load(T + 9000), s3 = SC2.summary(T + 9000);
check('after a restart: the week\'s figures read back from the files', n === 2 && s3.week.flights === 2 && s3.week.moments === s1.week.moments + 9, { n, week: s3.week });
const old = path.join(store, 'scores', dayOf(T - 5 * 86400) + '.jsonl'); fs.writeFileSync(old, JSON.stringify({ preds: [[T - 5 * 86400, nce, 50, '', '']], actual: nce, grp: 'jet', t1: T - 5 * 86400 + 600 }) + '\n');
SC2.sweep(T + 9000);
check('... a day older than two gzipped, and read the same way', !fs.existsSync(old) && fs.existsSync(old + '.gz') && JSON.parse(zlib.gunzipSync(fs.readFileSync(old + '.gz')).toString().trim()).actual === nce && createScores({ store, E }).load(T + 9000) === 3);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
