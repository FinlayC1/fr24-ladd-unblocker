// The monitor as the primary source (22.19): its poll step (LADD, military, PIA lists; adsb.fi's military list while
// adsb.lol rate-limits; the PIA list dropped to hourly when adsb.lol has none), /live, the adsb.lol request cap, the days
// watched throughout, the flight logs rebuilt day by day from adsb.lol's day traces (/hist: the userscript's format, the
// learning fields, empty days, retries while a day is not published, airplanes.live refusing), the state kept on disk,
// and a clean save on systemd's SIGTERM. All offline: adsb.lol's answers are fixtures or made up here.
// usage: node test/unit_monitor2.cjs <dataDir>
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const { spawn } = require('child_process');
process.env.MON_DATA = process.argv[2];
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monstore-'));
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const code = id => { const a = E.byId(id); return a ? a.iata || a.icao : id; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FXL = path.join(__dirname, 'fixtures/legs');
const fx = (hex, day) => { const f = path.join(FXL, hex, day + '_lol.json.gz'); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString() : null; };
const dayS = d => Date.parse(d + 'T00:00:00Z') / 1000;

// adsb.lol / adsb.fi / airplanes.live as this test answers them
const asked = [];
let lists = {}, apliveStatus = 404;
global.fetch = async url => {
  asked.push(url);
  const ok = o => ({ status: 200, text: async () => JSON.stringify(o) });
  if (/api\.adsb\.lol\/v2\/ladd$/.test(url)) return ok({ now: Date.now(), ac: lists.ladd || [] });
  if (/api\.adsb\.lol\/v2\/mil$/.test(url)) return lists.milStatus ? { status: lists.milStatus, text: async () => '' } : ok({ now: Date.now(), ac: lists.mil || [] });
  if (/opendata\.adsb\.fi\/api\/v2\/mil$/.test(url)) return ok({ now: Math.round(Date.now() / 1000), aircraft: lists.fi || [] });
  if (/api\.adsb\.lol\/v2\/pia$/.test(url)) return { status: 404, text: async () => 'Not Found' };
  if (/api\.adsb\.lol\/v2\/(point|hex)\//.test(url)) return ok({ now: Date.now(), ac: lists.area || [] });
  let m;
  if ((m = /adsb\.lol\/globe_history\/(\d{4})\/(\d\d)\/(\d\d)\/traces\/..\/trace_full_([0-9a-f]{6})\.json/.exec(url))) { const t = fx(m[4], `${m[1]}-${m[2]}-${m[3]}`); return t ? { status: 200, text: async () => t } : { status: 404, text: async () => '' }; }
  if (/globe\.airplanes\.live/.test(url)) return { status: apliveStatus, text: async () => '' };
  return { status: 404, text: async () => '' };
};
const rep = (hex, o) => Object.assign({ hex, lat: 53.4, lon: -2.3, alt_baro: 12000, gs: 300, track: 90, seen_pos: 2, flight: 'TEST1 ' }, o);

(async () => {
  // ---- the poll step: LADD list, then military, then PIA; adsb.fi's military list while adsb.lol is paused --------------
  M.CFG.areas = [];
  lists = { ladd: [rep('a00001', { dbFlags: 8, r: 'N1', t: 'GLF6' })], mil: [rep('ae0001', { dbFlags: 1, r: '11-0001', t: 'C17' })], fi: [rep('ae0002', { dbFlags: 1, t: 'K35R' })], area: [rep('400001', { r: 'G-PLAIN', t: 'A320' })] };
  asked.length = 0;
  for (let i = 0; i < 3; i++) await M.step();
  check('poll step: the LADD list first, then the military list, then the PIA list', asked.map(u => u.replace(/^https:\/\//, '')).join(' ') === 'api.adsb.lol/v2/ladd api.adsb.lol/v2/mil api.adsb.lol/v2/pia', asked);
  M.pause['api.adsb.lol'] = Date.now() + 60000; M.P.tM = 0; asked.length = 0;
  await M.step();
  check('... adsb.lol rate-limiting: adsb.fi\'s military list instead (nothing sent to adsb.lol)', asked.length === 1 && /opendata\.adsb\.fi\/api\/v2\/mil$/.test(asked[0]), asked);
  delete M.pause['api.adsb.lol'];
  lists.milStatus = 503; M.P.tM = 0; asked.length = 0;
  await M.step();
  check('... adsb.lol\'s military list failing: adsb.fi\'s asked straight after', asked.length === 2 && /adsb\.lol\/v2\/mil$/.test(asked[0]) && /adsb\.fi/.test(asked[1]), asked);
  delete lists.milStatus;
  for (let i = 0; i < 2; i++) { M.P.tP = 0; await M.step(); }
  check('... the PIA list answering 404 three times: asked hourly after that', M.piaState.off === true && M.piaState.miss >= 3, M.piaState);
  // ---- /live --------------------------------------------------------------------------------------------------------
  M.seed(['b00001'], false, Date.now() / 1000);
  M.ingest(rep('b00001', { r: 'M-SEED', t: 'PC24' }), Date.now() / 1000);       // (a blocked aircraft heard by address)
  M.ingest(rep('400001', { r: 'G-PLAIN', t: 'A320' }), Date.now() / 1000);       // (an ordinary aircraft from an area poll)
  const lv = M.answer(new URL('http://x/live'), Date.now() / 1000), hexes = lv.ac.map(a => a.hex).sort();
  check('/live: LADD, military (both lists) and blocked aircraft heard lately - not the ordinary ones', ['a00001', 'ae0001', 'ae0002', 'b00001'].every(h => hexes.includes(h)) && !hexes.includes('400001'), hexes);
  const a1 = lv.ac.find(a => a.hex === 'a00001');
  check('... as readsb rows the userscript reads as it reads adsb.lol\'s (seen_pos counted to now, flags, type)', !!a1 && a1.dbFlags === 8 && a1.t === 'GLF6' && a1.seen_pos >= 2 && a1.seen_pos < 30 && a1.lat === 53.4, a1);
  check('... and how old each list is (seconds)', lv.age.ladd != null && lv.age.ladd < 30 && lv.age.mil != null && typeof lv.now === 'number', lv.age);
  M.live.get('ae0002').t -= M.CFG.liveMaxAge + 5;
  check('... an aircraft not heard for 5 minutes is no longer in it', !M.answer(new URL('http://x/live'), Date.now() / 1000).ac.some(a => a.hex === 'ae0002'));
  // (a flight under way: where it took off)
  { const t0 = Math.floor(Date.now() / 1000) - 3000, man = E.byIcao('EGCC');
    M.legs.set('a00001', new Map([[1, { hex: 'a00001', open: true, from: { id: man.id, code: 'MAN', conf: 'ground' }, tStart: t0, tOff: t0 + 120, tEnd: t0 + 2900 }]]));
    const r = M.liveList(Date.now()).ac.find(a => a.hex === 'a00001');
    check('... with the take-off of a flight under way (airport id, how sure, time)', !!r && r._from[0] === man.id && r._from[1] === 'ground' && r._off === t0 + 120, r && { from: r._from, off: r._off });
    M.legs.delete('a00001'); }
  // ---- adsb.lol's API: never more than apiPerMin requests in the window ---------------------------------------------
  { M.CFG.apiPerMin = 2; M.CFG.apiWindowMs = 6000; M.gate.sent.length = 0; M.gate.last = 0;
    const t0 = Date.now(), at = [];
    await Promise.all([1, 2, 3].map(i => M.apiGet('https://api.adsb.lol/v2/hex/' + i).then(() => at.push(Date.now() - t0))));
    at.sort((a, b) => a - b);
    check('adsb.lol request cap: two in the window, the third waits for the window (not just the 2 s gap)', at[1] >= 1900 && at[2] >= 5900, at);
    M.CFG.apiPerMin = 20; M.CFG.apiWindowMs = 60000; }
  // ---- days watched throughout -------------------------------------------------------------------------------------
  const D = '2026-10-07', D2 = '2026-10-08';
  for (let t = dayS(D) - 60; t <= dayS(D2) + 86400 + 60; t += t > dayS(D2) + 40000 && t < dayS(D2) + 40500 ? 400 : 150) M.noteWatch('ladd', t);
  check('a day whose LADD list never went quiet for more than 200 s: watched throughout', M.watchedAll(D, 'ladd') === true);
  check('... one with a 400 s silence: not', M.watchedAll(D2, 'ladd') === false, M.watch[D2]);
  check('... a day only part of which was watched: not', (() => { M.noteWatch('hex', dayS('2026-10-05') + 6 * 3600); for (let t = dayS('2026-10-05') + 6 * 3600; t < dayS('2026-10-06') + 100; t += 60) M.noteWatch('hex', t); return M.watchedAll('2026-10-05', 'hex') === false && M.watchedAll('2026-10-06', 'hex') === false; })());
  // ---- days of a blocked aircraft not heard flying: nothing to fetch ----------------------------------------------
  { const now = dayS('2026-10-09') + 12 * 3600;
    // (c00005: on the FAA list as kept, never seen with the flag since; c00006: last seen with it three weeks before the day)
    for (const [h, at, faa, lad] of [['c00001', dayS(D) - 5 * 86400, true, dayS(D) + 9 * 3600], ['c00002', dayS(D) + 3600, true, dayS(D) + 9 * 3600], ['c00003', dayS(D) - 86400, true, dayS(D)], ['c00004', dayS(D) - 86400, false, 0], ['c00005', dayS(D) - 86400, true, 0], ['c00006', dayS(D) - 30 * 86400, true, dayS(D) - 21 * 86400]]) { M.markBlocked(h, null, at); Object.assign(M.blocked.get(h), { at, faa, lad }); }
    M.closed = '';
    M.flew.set(D, new Set(['c00003']));
    M.closeDays(dayS(D) + 86400 + 3 * 3600 - 10);
    check('day close: not before the day is over by closeDelayH hours', M.flew.has(D) && !M.histPend.has('c00003|' + D));
    M.closeDays(now);
    check('... after it: each blocked aircraft heard in the air that day queued to be rebuilt', !M.flew.has(D) && M.histPend.has('c00003|' + D) && M.closed >= D, M.closed);
    const h1 = M.histOf('c00001'), h2 = M.histOf('c00002'), h3 = M.histOf('c00003'), h4 = M.histOf('c00004');
    check('/hist: a day watched throughout and the aircraft never heard in the air = a day with no flights', h1.days['2026/10/07'] === 0, h1.days);
    check('... not for a day it was not yet known as blocked, nor one being rebuilt, nor a day another list was not watched for', !('2026/10/07' in h2.days) && !('2026/10/07' in h3.days) && !('2026/10/07' in h4.days), { h2: h2.days, h3: h3.days, h4: h4.days });
    check('... nor a day with a gap in the watching', !('2026/10/08' in h1.days), h1.days);
    check('... nor, for an aircraft of the FAA list, unless it was seen on that list (with the flag) within two weeks of the day', !('2026/10/07' in M.histOf('c00005').days) && !('2026/10/07' in M.histOf('c00006').days), { c5: M.histOf('c00005').days, c6: M.histOf('c00006').days });
    // a day it flew whose rebuilding failed for good (no file a day and a half on): never a day without flights
    { M.markBlocked('c00007', null, dayS(D) - 86400); Object.assign(M.blocked.get('c00007'), { at: dayS(D) - 86400, faa: true, lad: dayS(D) });
      M.histPend.add('c00007|' + D); await M.histOne({ hex: 'c00007', day: D, tries: 0, at: 0 });
      check('a day it was heard flying whose file never came: marked unknown - not claimed as a day without flights', M.histRead('c00007').days['2026/10/07'] === -1 && !('2026/10/07' in M.histOf('c00007').days), M.histRead('c00007').days); }
    // the flag: seen with it - kept with the time; heard without it - off the FAA list (asked for by address from then on)
    { M.ingest(rep('c00001', { dbFlags: 8 }), now); const lad1 = M.blocked.get('c00001').lad;
      M.ingest(rep('c00001', { r: 'N1' }), now + 30); const keep = M.blocked.get('c00001').faa;
      M.ingest(rep('c00001', { dbFlags: 0 }), now + 60);
      check('LADD flag: last seen with it kept; a report with no database flags at all changes nothing; one without the flag takes it off the FAA list', lad1 >= now - 5 && keep === true && M.blocked.get('c00001').faa === false, { lad1, keep, faa: M.blocked.get('c00001').faa });
      M.blocked.get('c00001').faa = true; }
    M.histQ.length = 0; M.histPend.clear(); }
  // ---- a day rebuilt from adsb.lol's trace: the userscript's own flight-log format ---------------------------------
  { const hex = '424c60'; M.markBlocked(hex, null, dayS('2026-10-01')); M.blocked.get(hex).at = dayS('2026-10-01');
    M.histQ.push({ hex, day: '2026-10-06', tries: 0, at: 0 }); M.histPend.add(hex + '|2026-10-06');
    M.histQ.push({ hex, day: D, tries: 0, at: 0 }); M.histPend.add(hex + '|' + D);
    for (let j; (j = M.nextHist());) await M.histOne(j);
    const h = M.histOf(hex), d7 = h.legs.filter(l => l.day === '2026/10/07');
    // (the same day through the engine as the userscript's loadHistory runs it: to the end of the day, its earlier flights as history)
    const j = JSON.parse(fx(hex, D)), cls = E.classify({ hex, type: j.t, reg: j.r }), raws = E.legsFromPoints(E.parseTrace(j), { heli: false, patrol: false, cls, type: j.t, rangeKm: E.typeRangeKm({ hex, type: j.t }), dataEnd: dayS(D) + 86400 });
    const prior = E.chainLegs(E.stitchLegs(h.legs.filter(l => l.day < '2026/10/07').map(l => Object.assign({}, l)))), hs = E.histStats(prior, Date.now() / 1000);
    const ref = raws.map(l => E.summarizeLeg(l, { visits: hs.visits, base: hs.base, mil: false, grp: E.groupOf(cls), cls, type: j.t }));
    const pair = l => `${l.from ? code(l.from.id) : '?'}-${l.to ? code(l.to.id) : '?'}@${Math.round(l.tStart)}`;
    check('/hist: M-ARNZ\'s 7 Oct rebuilt from adsb.lol\'s trace: the flights the engine makes of it', d7.length === 4 && d7.map(pair).join() === ref.map(pair).join(), { monitor: d7.map(pair), engine: ref.map(pair) });
    check('... in the userscript\'s log format (day key, path, how, maxAlt, take-off and landing times)', d7.every(l => l.day === '2026/10/07' && Array.isArray(l.path) && 'how' in l && l.maxAlt > 0 && 'tOn' in l && 'tOffEst' in l), Object.keys(d7[0] || {}));
    check('... with what the userscript learns from each flight (squawk blocks, FMS levels, where it flew)', d7.filter(l => l.from && l.to).every(l => Array.isArray(l.lx) && l.lx.length === 3 && typeof l.lx[2] === 'string'), d7.map(l => l.lx));
    check('... both days, counted', h.days['2026/10/06'] === 4 && h.days['2026/10/07'] === 4, h.days);
    const two = M.answer(new URL('http://x/hist?hex=424c60,c00001,zz,000000'), Date.now() / 1000);
    check('/hist answers several aircraft at once (bad addresses dropped)', two.hv === 5 && two.list.length === 3 && two.list[0].hex === '424c60' && two.list[1].days['2026/10/07'] === 0, two.list.map(x => x.hex)); }
  // ---- a day adsb.lol has not published yet; a day long gone with no file -----------------------------------------
  { const hex = 'd00001', y = new Date(Date.now() - 86400e3).toISOString().slice(0, 10); M.markBlocked(hex, null, dayS(y) - 86400);
    const job = { hex, day: y, tries: 0, at: 0 }; M.histPend.add(hex + '|' + y);
    await M.histOne(job);
    const q = M.histQ.find(x => x.hex === hex);
    check('a day not published yet (404 within 36 h of its end): asked again in two hours', !!q && q.tries === 1 && q.at > Date.now() + 7000e3 && M.histPend.has(hex + '|' + y), q);
    M.histQ.length = 0;
    const old = { hex, day: '2026-09-20', tries: 0, at: 0 }; M.histPend.add(hex + '|2026-09-20');
    await M.histOne(old);
    check('... long after: given up - left to the userscript (no day claimed)', !M.histQ.length && !M.histPend.has(hex + '|2026-09-20') && !('2026/09/20' in M.histOf(hex).days)); }
  // ---- a day with a flight whose end was not heard: airplanes.live asked; refusing - the userscript reads that day ---
  { const hex = '3cdf15', d = '2026-10-02'; M.markBlocked(hex, null, dayS(d) - 86400); apliveStatus = 403; delete M.pause['globe.airplanes.live'];
    asked.length = 0;
    const n = await M.histDay(hex, d, JSON.parse(fx(hex, d)));
    const h = M.histRead(hex), shown = M.histOf(hex);
    const askedAp = asked.some(u => /globe\.airplanes\.live\/globe_history\/2026\/10\/02\/traces\/15\/trace_full_3cdf15\.json/.test(u));
    check('a day with a flight lost low: airplanes.live\'s trace of that day asked for', askedAp, asked);
    check('... refused (403): left alone six hours, the day marked for the userscript to read itself', h.days['2026/10/02'] === -1 && !('2026/10/02' in shown.days) && M.pause['globe.airplanes.live'] > Date.now() + 5 * 3600e3, { days: h.days, n });
    apliveStatus = 404; delete M.pause['globe.airplanes.live'];
    await M.histDay(hex, d, JSON.parse(fx(hex, d)));
    check('... airplanes.live answering (no trace there either): the day stands as adsb.lol has it', M.histRead(hex).days['2026/10/02'] >= 1, M.histRead(hex).days); }
  // ---- what is kept on disk ---------------------------------------------------------------------------------------
  { M.flew.set('2026-10-13', new Set(['c00001'])); M.histQ.push({ hex: 'c00001', day: '2026-10-12', tries: 1, at: 5 });
    M.saveState();
    const s = JSON.parse(fs.readFileSync(path.join(process.env.MON_STORE, 'state.json'), 'utf8'));
    check('state on disk: the days watched, the last good round of each list, the days still to rebuild, the aircraft heard flying', s.v === 2 && !!s.watch[D] && s.lastW.ladd > 0 && s.histQ.some(x => x[0] === 'c00001' && x[1] === '2026-10-12' && x[2] === 1) && s.flew['2026-10-13'].includes('c00001') && typeof s.closed === 'string', Object.keys(s)); }
  // ---- systemd's stop (SIGTERM): saved, exit 0 ----------------------------------------------------------------------
  { const store = fs.mkdtempSync(path.join(os.tmpdir(), 'monstop-'));
    const ch = spawn(process.execPath, [path.join(__dirname, '../monitor/monitor.cjs')], { env: Object.assign({}, process.env, { MON_STORE: store, MON_PORT: String(40000 + Math.floor(Math.random() * 9000)), MON_DATA: process.env.MON_DATA }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { out += d; });
    for (let i = 0; i < 300 && !/listening/.test(out); i++) await sleep(100);
    ch.kill('SIGTERM');
    const code0 = await new Promise(r => ch.on('exit', c => r(c)));
    check('stopped by SIGTERM (systemctl stop / restart): exits 0 and its state is saved first', /listening/.test(out) && code0 === 0 && fs.existsSync(path.join(store, 'state.json')), { code: code0, out: out.slice(-300) }); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
