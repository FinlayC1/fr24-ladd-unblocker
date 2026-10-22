// The monitor's permanent store (22.21): blocked aircraft's flights kept on disk for good - an old day's file only ever
// grows (memory holds 90 days; a day partly let go is merged, never cut), files older than that not deleted on start and
// read back for airport boards asked for those days; every blocked aircraft's completed flights as learning rows (/learn);
// the names table's estimated arrival, departure time and moved positions.
// usage: node test/unit_store.cjs <dataDir>
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
const STORE = process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monstorep-'));
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const day = t => new Date(t * 1000).toISOString().slice(0, 10), nowS = Date.now() / 1000;
const man = E.byIcao('EGCC'), lbg = E.byIcao('LFPB');
const leg = (hex, t, o) => Object.assign({ hex, reg: 'N1', type: 'GLF6', ladd: true, tStart: t, tOff: t + 60, tEnd: t + 5400, tOn: t + 5300, from: { id: man.id, code: 'MAN', conf: 'ground' }, to: { id: lbg.id, code: 'LBG', conf: 'ground' }, ended: true, open: false }, o);
const put = (d, list) => fs.writeFileSync(path.join(STORE, 'legs-' + d + '.json'), JSON.stringify(list));
const read = d => JSON.parse(fs.readFileSync(path.join(STORE, 'legs-' + d + '.json'), 'utf8'));
(async () => {
  // a day 120 days ago (before memory), one 95 days ago (half let go), one 10 days ago (all in memory)
  const t120 = Math.floor((nowS - 120 * 86400) / 86400) * 86400 + 36000, t95 = Math.floor((nowS - 95 * 86400) / 86400) * 86400 + 36000, t10 = Math.floor((nowS - 10 * 86400) / 86400) * 86400 + 36000;
  put(day(t120), [leg('a00001', t120), leg('a00002', t120 + 7200, { ladd: false })]);
  put(day(t95), [leg('a00003', t95), leg('a00004', t95 + 3600)]);
  put(day(t10), [leg('a00005', t10), leg('a00006', t10 + 3600)]);
  M.loadStore(nowS);
  check('on start: a day older than memory not deleted, nor read into memory', fs.existsSync(path.join(STORE, 'legs-' + day(t120) + '.json')) && !M.legs.has('a00001'));
  // (a flight of the 95-day-old file back in memory and changed - its histories arrived late, say - so its day is
  // rewritten; the other flight of that day is not in memory)
  check('... a day just older than memory: not read in either', !M.legs.has('a00003') && !M.legs.has('a00004'));
  const l3 = leg('a00003', t95, { cs: 'CHANGED' });
  M.legs.set('a00003', new Map([[Math.round(l3.tOff / 600), l3]])); M.dirtyDays.add(day(t95));
  M.save();
  M.legs.delete('a00003');
  const f95 = read(day(t95));
  check('an old day rewritten: the flight held in memory updated, the one let go from memory kept - the file only grows', !!l3 && f95.length === 2 && f95.some(l => l.hex === 'a00003' && l.cs === 'CHANGED') && f95.some(l => l.hex === 'a00004'), f95.map(l => [l.hex, l.cs || '']));
  // a recent day: memory is the whole of it (a flight replaced there is replaced in the file too)
  M.legs.delete('a00006'); M.dirtyDays.add(day(t10)); M.save();
  check('a recent day: written from memory (all of it is there)', read(day(t10)).length === 1);
  // boards of those old days: from the files
  const b = M.boardLegs(lbg.id, t120 - 3600, t120 + 86400);
  check('an airport\'s board of four months ago: its blocked flights read from the files on disk (not the others)', b.length === 1 && b[0].hex === 'a00001' && b[0].legs[0].to.id === lbg.id, b.map(x => x.hex));
  const b2 = M.boardLegs(lbg.id, t95 - 3600, nowS);
  check('... a range spanning disk and memory: both, each flight once', ['a00003', 'a00004', 'a00005'].every(h => b2.some(x => x.hex === h)) && b2.every(x => x.legs.length === 1), b2.map(x => [x.hex, x.legs.length]));
  // learning rows: M-ARNZ's 7 Oct rebuilt - its flights as the userscript's learning rows, kept per day
  global.fetch = async url => { const m = /globe_history\/(\d{4})\/(\d\d)\/(\d\d)\/traces\/..\/trace_full_([0-9a-f]{6})\.json/.exec(url), f = m && path.join(__dirname, 'fixtures/legs', m[4], `${m[1]}-${m[2]}-${m[3]}_lol.json.gz`); return f && fs.existsSync(f) ? { status: 200, text: async () => zlib.gunzipSync(fs.readFileSync(f)).toString() } : { status: 404, text: async () => '' }; };
  M.markBlocked('424c60', null, Date.parse('2026-10-01') / 1000);
  await M.histDay('424c60', '2026-10-07', JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/424c60/2026-10-07_lol.json.gz'))).toString()));
  const lr = M.learnSince('2026-10-06', Date.parse('2026-10-14T12:00:00Z') / 1000);
  const code = id => (E.byId(id) || {}).iata;
  check('/learn: M-ARNZ\'s 7 Oct flights as learning rows (from, to, times, class, type, squawk blocks, levels, flow cells)', lr.days.join() === '2026-10-07' && lr.rows.length === 4 && lr.rows.every(r => r.length === 12 && /^424c60\|\d+$/.test(r[0]) && r[6] === 'bizjet' && r[10] === 'PC24') && lr.rows.map(r => code(r[1]) + '-' + code(r[2])).join() === 'BWF-BRS,BRS-BWF,BWF-FAB,FAB-BWF', lr.rows.map(r => [code(r[1]), code(r[2]), r[4], r[5]]));
  await M.histDay('424c60', '2026-10-07', JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/424c60/2026-10-07_lol.json.gz'))).toString()));
  check('... rebuilt again: no flight twice', M.learnSince('2026-10-06', Date.parse('2026-10-14T12:00:00Z') / 1000).rows.length === 4);
  check('... only the days asked for, two weeks back at most, not today', M.learnSince('2026-10-07', Date.parse('2026-10-14T12:00:00Z') / 1000).rows.length === 0 && M.learnSince('', Date.parse('2026-11-30T12:00:00Z') / 1000).rows.length === 0);
  // the names table: estimated arrival and departure time; positions of flights that only moved
  { const I = M.ident, id = 4242;
    I.observe([{ id, lat: 50, lon: -10, alt: 41000, trk: 90, spd: 480, ts: Math.round(nowS) - 10, gnd: false, src: 5, type: 'GLF6', reg: '', cs: '', icon: 3 }], Date.now(), 'scan');
    const F = I.flights.get(id); I.assign(F, 'a0abcd', { reg: 'N2', type: 'GLF6' }, 'list', Date.now());
    const R = I.ids.get(id); R.dest = { id: lbg.id, p: 0.7, at: Math.round(nowS), eta: Math.round(nowS) + 3600 }; R.origin = { id: man.id, conf: 'ground', t: Math.round(nowS) - 1800 };
    const full = I.table(0), row = full.rows.find(r => r[0] === id);
    check('names table: estimated arrival and departure time in each row', row && row[18] === R.dest.eta && row[19] === R.origin.t, row && row.slice(18));
    const since = Date.now(); await new Promise(r => setTimeout(r, 5));
    I.observe([{ id, lat: 50.1, lon: -9, alt: 41000, trk: 90, spd: 480, ts: Math.round(nowS) + 50, gnd: false, src: 5, type: 'GLF6', reg: '', cs: '', icon: 3 }], Date.now(), 'scan');
    const d = I.table(since);
    check('... since: a flight that only moved comes as its new position (not a whole row)', d.rows.length === 0 && d.pos.length === 1 && d.pos[0][0] === id && d.pos[0][2] === -9, d);
    // (named without the LADD flag; the aircraft later seen on the LADD list: its name gets the flag, and goes out again)
    const s2 = Date.now(); await new Promise(r => setTimeout(r, 5));
    M.markBlocked('a0abcd', null, nowS).faa = true; I.match(Date.now());
    const r2 = I.table(s2).rows.find(r => r[0] === id);
    check('names table: an aircraft found to be LADD-listed after it was named gets the LADD flag in its row (sent again)', !!r2 && (r2[5] & 1) === 1 && (I.ids.get(id).flags & 1) === 1, r2 && r2[5]); }
  // a blocked flight only FR24 sees: M-ARNZ's Barrow - Farnborough of 7 Oct, as FR24 would have drawn it under another
  // address nobody's ADS-B hears - its scans every 2 minutes, then its trail asked for once it is down
  { const I = M.ident, id = 5151, hex = '4ccccc';
    const tr = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/424c60/2026-10-07_lol.json.gz'))).toString());
    const pts = E.parseTrace(tr), all = E.legsFromPoints(pts.map(p => Object.assign({}, p)), { cls: 'bizjet', type: 'PC24' });
    const lg = all.find(l => { const sm = E.summarizeLeg(l, { cls: 'bizjet', type: 'PC24' }); return sm.from && sm.to && code(sm.from.id) === 'BWF' && code(sm.to.id) === 'FAB'; });
    const truth = E.summarizeLeg(lg, { cls: 'bizjet', type: 'PC24' });
    const seq = pts.filter(p => p.t >= lg.start.t - 300 && p.t <= lg.end.t + 600);
    const fr = p => ({ id, lat: p.lat, lon: p.lon, alt: p.gnd0 ? 0 : p.alt || 0, trk: p.trk || 0, spd: p.gs || 0, ts: Math.round(p.t), gnd: !!p.gnd0, src: 0, type: 'PC24', reg: '', cs: '', icon: 3 });
    let named = false, queued = false, lastT = 0;
    for (const p of seq) {
      if (p.t - lastT < 30) continue; lastT = p.t;
      I.observe([fr(p)], p.t * 1000, 'scan');
      if (!named && !p.gnd0 && p.alt > 3000) { I.assign(I.flights.get(id), hex, { reg: 'N5', type: 'PC24' }, 'list', p.t * 1000); named = true; }
      if (named && p.gnd0 && I.trailQ[0] === id) queued = true;
    }
    check('FR24-only flight: down on the ground after flying - its whole trail asked for at once (first in the queue)', queued && I.flights.get(id).logTrail === 1 && I.nextTrail() === I.flights.get(id));
    I.setTrail(id, seq.filter((p, i) => i % 3 === 0).map(p => ({ t: Math.round(p.t), lat: p.lat, lon: p.lon, alt: p.gnd0 ? 0 : p.alt || 0, gs: p.gs || 0, trk: p.trk || 0 })), lastT * 1000);
    const end = seq[seq.length - 1].t;
    check('... not logged while FR24 still draws it and it has been down a short while', M.fr24Legs((end + 60) * 1000) === 0);
    const n = M.fr24Legs((end + 1200) * 1000), m = M.legs.get(hex), l = m && [...m.values()].find(x => x.via === 'fr24');
    check('... down 15 minutes: logged, Barrow - Farnborough, take-off and landing times within 3 minutes of the ADS-B record', n === 1 && !!l && code(l.from.id) === 'BWF' && code(l.to.id) === 'FAB' && Math.abs(l.tOff - truth.tOff) < 180 && Math.abs(l.tOn - truth.tOn) < 180 && l.ladd === true && !('cls' in l), l && { from: code(l.from.id), to: code(l.to.id), dOff: l.tOff - truth.tOff, dOn: l.tOn - truth.tOn });
    check('... not logged twice', M.fr24Legs((end + 1300) * 1000) === 0 && [...M.legs.get(hex).values()].length === 1);
    check('... on the airport\'s board', M.boardLegs(E.byIcao('EGLF').id, truth.tStart - 3600, truth.tEnd + 3600).some(x => x.hex === hex));
    const lr = M.learnSince('2026-10-06', Date.parse('2026-10-14T12:00:00Z') / 1000).rows.filter(r => r[0].startsWith(hex + '|'));
    check('... and a learning row of that day (the browsers\' destination engine learns it)', lr.length === 1 && code(lr[0][1]) === 'BWF' && code(lr[0][2]) === 'FAB', lr);
    // ADS-B hears it after all: its own record replaces FR24's
    for (const p of tr.trace.filter(r => tr.timestamp + r[0] >= lg.start.t - 300 && tr.timestamp + r[0] <= lg.end.t + 600)) M.ingest({ hex, r: 'N5', t: 'PC24', lat: p[1], lon: p[2], alt_baro: p[3], gs: p[4], track: p[5], seen_pos: 0 }, tr.timestamp + p[0]);
    M.buildLegs(hex, end + 1400 + 86400);
    const after = [...M.legs.get(hex).values()];
    check('... ADS-B\'s own record of it later: replaces FR24\'s (one flight, not two)', after.length === 1 && after[0].via !== 'fr24' && code(after[0].to.id) === 'FAB', after.map(x => [x.via || 'adsb', x.from && code(x.from.id), x.to && code(x.to.id)]));
    check('... the runways it used: off Walney\'s 35, onto Farnborough\'s 06 (its tracks: 347 then 062)', after[0].rwyOff === '35' && after[0].rwyOn === '06', [after[0].rwyOff, after[0].rwyOn]);
    // (asked as of the day after the flight: the recorded flight of 7 Oct, not today's 14 days, which it falls out of)
    const fab = E.byIcao('EGLF'), ai = M.answer(new URL('http://x/airport?ap=' + fab.id + '&days=14'), truth.tOn + 86400);
    check('/airport: Farnborough\'s runway in full (06/24, 8,005 ft, 148 ft wide, asphalt, lit, each end\'s elevation, heading and displaced threshold), its frequencies, and the runways the tracked flights used', ai.known && ai.icao === 'EGLF' && ai.runways.length === 1 && ai.runways[0][0] === '06' && ai.runways[0][1] === '24' && ai.runways[0][2] === 8005 && ai.runways[0][3] === 148 && ai.runways[0][4] === 'ASPH' && ai.runways[0][6] === 1 && ai.runways[0][8] === 225 && ai.freqs.some(f => f[0] === 'TWR' && f[2] === 122.5) && JSON.stringify(ai.usage) === JSON.stringify([['06', 0, 1]]) && ai.withRunway === 1, { rw: ai.runways, usage: ai.usage, moves: ai.moves, f: ai.freqs.slice(0, 2) });
    check('... an airport it does not know of: said so', M.answer(new URL('http://x/airport?ap=99999999'), nowS).known === false);
    // a finished ADS-B record missing its departure: FR24's track gives it
    after[0].from = null; I.flights.get(id).loggedAir = 0;
    M.fr24Legs((end + 1500) * 1000);
    check('... a finished ADS-B record with no departure: the departure taken from FR24\'s track', code((after[0].from || {}).id) === 'BWF' && after[0].fr24Fill === true && [...M.legs.get(hex).values()].length === 1); }
  // owners: a browser's findings kept on the monitor, sent with the name in the names table and from /owners
  { const I = M.ident, since = Date.now(); await new Promise(r => setTimeout(r, 5));
    const r0 = M.report({ owners: [['4ccccc', { owner: 'Example Jets LLC', regOwner: true, regAnswered: true, operatorId: 5, operatorIcao: 'EXJ', operatorName: 'Example Jets' }], ['bad', {}]] }, Date.now());
    const row = I.table(since).rows.find(r => r[1] === '4ccccc');
    check('a browser\'s report of an owner: kept; the aircraft\'s name in the names table sent again, with its owner and operator', r0.owners === 1 && !!row && row[20] === 'Example Jets LLC' && row[21] === 'Example Jets' && row[22] === 5 && row[23] === 'EXJ', row && row.slice(20));
    const ow = M.answer(new URL('http://x/owners?hex=4ccccc,abc,000001'), nowS);
    check('... and from /owners (only what it knows; bad addresses ignored)', ow.list.length === 1 && ow.list[0][0] === '4ccccc' && ow.list[0][4] === 'Example Jets LLC' && ow.list[0][10] === 5, ow);
    { const st = M.answer(new URL('http://x/status'), nowS); check('... the status counts it', st.owners.known >= 1 && st.owners.fromClients === 1, st.owners); }
    check('a newly blocked aircraft: its owner to be looked up', M.markBlocked('4eeeee', { reg: 'N4E' }, nowS) && M.owners.q.includes('4eeeee')); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
