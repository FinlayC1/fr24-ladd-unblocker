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
const askedH = [];
global.fetch = async (url, init) => {
  asked.push(url); askedH.push({ url, headers: (init && init.headers) || {} });
  if (/opendata\.adsb\.fi\/api\/v3\/lat\//.test(url)) return lists.fiStatus ? { status: lists.fiStatus, text: async () => '' } : { status: 200, text: async () => JSON.stringify({ now: Date.now(), aircraft: lists.fiArea || [] }) };
  if (/adsbexchange-com1\.p\.rapidapi\.com/.test(url)) return { status: 200, text: async () => JSON.stringify({ now: Date.now(), ac: [] }) };
  if (/opensky-network\.org\/api\/states\/all/.test(url)) return lists.oskyStatus ? { status: lists.oskyStatus, text: async () => '' } : { status: 200, text: async () => JSON.stringify({ time: Math.floor(Date.now() / 1000), states: lists.osky || [] }) };
  const ok = o => ({ status: 200, text: async () => JSON.stringify(o) });
  if (/api\.adsb\.lol\/v2\/ladd$/.test(url)) return ok({ now: Date.now(), ac: lists.ladd || [] });
  if (/api\.adsb\.lol\/v2\/mil$/.test(url)) return lists.milStatus ? { status: lists.milStatus, text: async () => '' } : ok({ now: Date.now(), ac: lists.mil || [] });
  if (/opendata\.adsb\.fi\/api\/v2\/mil$/.test(url)) return lists.fiStatus ? { status: lists.fiStatus, text: async () => '' } : ok({ now: Math.round(Date.now() / 1000), aircraft: lists.fi || [] });
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
  M.CFG.areas = []; M.CFG.lolKeepDays = 100000;   // (the fixtures' days within what adsb.lol keeps, whatever the date)
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
  // ---- by address: the ones heard lately first and often, the parked rest every 10 minutes --------------------------
  { const nS = Date.now() / 1000;
    M.markBlocked('f0a001', { reg: 'M-HOT1' }, nS); Object.assign(M.blocked.get('f0a001'), { faa: false, heard: Math.round(nS - 300) });
    M.markBlocked('f0a002', { reg: 'M-COLD' }, nS); Object.assign(M.blocked.get('f0a002'), { faa: false, heard: Math.round(nS - 7200) });
    const t = Date.now(); Object.assign(M.P, { tL: t, tM: t, tP: t, tA: t, tO: t, tH: 0, tC: 0, hexQ: [], coldQ: [], areaQ: [[1, 1, 1]] }); asked.length = 0;
    await M.step();
    const hot = asked.find(u => /\/v2\/hex\//.test(u)) || '';
    check('by address: those heard in the last 45 minutes asked first (before the areas), the parked ones not with them', /f0a001/.test(hot) && !/f0a002/.test(hot) && asked.length === 1, asked);
    asked.length = 0; await M.step(); await M.step();
    check('... the areas next, then the parked ones (their slow round)', /\/v2\/point\//.test(asked[0] || '') && /f0a002/.test(asked[1] || '') && !/f0a001/.test(asked[1] || ''), asked);
    M.P.areaQ = []; M.P.hexQ = []; M.P.coldQ = []; }
  // ---- /live: only what was heard again since the last answer ---------------------------------------------------
  { const t0 = Date.now(); await new Promise(r => setTimeout(r, 5));
    M.ingest(rep('a0f001', { dbFlags: 8, r: 'N-DELTA', seen_pos: 0 }), Date.now() / 1000 + 1);
    const full = M.answer(new URL('http://x/live'), Date.now() / 1000), d = M.answer(new URL('http://x/live?since=' + t0), Date.now() / 1000);
    check('/live?since: only the aircraft heard again since (the full list without it)', d.full === false && d.ac.length === 1 && d.ac[0].hex === 'a0f001' && full.full === true && full.ac.length > 1, { delta: d.ac.map(a => a.hex), full: full.ac.length });
    const old = M.answer(new URL('http://x/live?since=' + (Date.now() - 120000)), Date.now() / 1000);
    check('... a "since" a minute old or more: everything', old.full === true && old.ac.length === full.ac.length); }
  // ---- the backups -----------------------------------------------------------------------------------------------
  { const quiet = () => { const t = Date.now(); Object.assign(M.P, { tL: t, tM: t, tP: t, tA: t, tH: t, tO: t, hexQ: [] }); };
    quiet(); M.P.areaQ = [[50, 0, 100]]; M.pause['api.adsb.lol'] = Date.now() + 60000; asked.length = 0; lists.fiArea = [rep('400777', { r: 'G-AREA', t: 'C172' })];
    await M.step();
    check('backup: adsb.lol paused - an area asked of adsb.fi (its v3 area query), not of adsb.lol', asked.length === 1 && /opendata\.adsb\.fi\/api\/v3\/lat\/50\/lon\/0\/dist\/100$/.test(asked[0]) && M.ac.has('400777'), asked);
    quiet(); M.P.areaQ = [[50, 0, 100]]; lists.fiStatus = 503; asked.length = 0; M.CFG.adsbxKey = '';
    await M.step();
    check('... adsb.fi failing too, no ADS-B Exchange key: nothing more asked', asked.length === 1, asked);
    M.CFG.adsbxKey = 'user-key'; M.CFG.adsbxDaily = 1; M.adsbxUse.n = 0; M.adsbxUse.day = '';
    quiet(); M.P.areaQ = [[50, 0, 100]]; askedH.length = 0;
    await M.step();
    const ax = askedH.find(a => /rapidapi/.test(a.url));
    check('... with the user\'s key: ADS-B Exchange asked, with the key and host headers', !!ax && /\/v2\/lat\/50\/lon\/0\/dist\/100\/$/.test(ax.url) && ax.headers['X-RapidAPI-Key'] === 'user-key' && ax.headers['X-RapidAPI-Host'] === 'adsbexchange-com1.p.rapidapi.com', ax);
    quiet(); M.P.tM = 0; askedH.length = 0;
    await M.step();
    check('... its daily cap reached: not asked again that day (the military list, adsb.lol and adsb.fi both failing, neither)', !askedH.some(a => /rapidapi/.test(a.url)) && askedH.some(a => /adsb\.fi\/api\/v2\/mil/.test(a.url)), askedH.map(a => a.url));
    M.CFG.adsbxDaily = 5; quiet(); M.P.tM = 0; askedH.length = 0;
    await M.step();
    check('... under the cap: the military list from ADS-B Exchange when adsb.lol and adsb.fi both fail', askedH.some(a => /rapidapi\.com\/v2\/mil\/$/.test(a.url)), askedH.map(a => a.url));
    M.CFG.adsbxKey = ''; delete lists.fiStatus; delete M.pause['api.adsb.lol'];
    // OpenSky: only while adsb.lol's LADD list has been silent 3 minutes; the blocked aircraft in it kept, the others not
    M.markBlocked('e00001', { reg: 'N77OS', type: 'GLF5' }, Date.now() / 1000); Object.assign(M.blocked.get('e00001'), { faa: true, lad: 1234 });
    const t = Math.floor(Date.now() / 1000);
    lists.osky = [['e00001', 'N77OS   ', 'United States', t - 4, t - 1, -40.5, 45.2, 12500, false, 240, 75, -2.5, null, 12700, '2201', false, 0], ['abcdef', 'BAW1', 'UK', t, t, 0, 51, 10000, false, 230, 90, 0, null, 10100, null, false, 0]];
    quiet(); M.P.tO = 0; M.lastOk.ladd = Date.now() - 60000; asked.length = 0;
    await M.step();
    check('OpenSky: not asked while adsb.lol\'s LADD list answers', !asked.some(u => /opensky/.test(u)), asked);
    quiet(); M.P.tO = 0; M.lastOk.ladd = Date.now() - 200000; const since0 = M.stats.since; M.stats.since = Date.now() - 400000; asked.length = 0;
    await M.step();
    const o = M.live.get('e00001'), oa = o && o.a;
    check('... silent 3 minutes: OpenSky asked; the blocked aircraft in its answer in the live list, in readsb units, marked as of the FAA list', asked.some(u => /opensky-network\.org\/api\/states\/all/.test(u)) && !!oa && oa.alt_baro === 41011 && oa.gs === 467 && oa.baro_rate === -492 && oa.flight === 'N77OS   ' && oa.dbFlags === 8 && Math.abs(o.t - (t - 4)) <= 1, oa);
    check('... the aircraft not known as blocked left out; "seen with the LADD flag" not set from it', !M.live.has('abcdef') && M.blocked.get('e00001').lad === 1234);
    quiet(); M.P.tO = Date.now() - 1000; asked.length = 0; await M.step();
    check('... not asked again before openskyEvery (15 min)', !asked.some(u => /opensky/.test(u)));
    lists.oskyStatus = 429; quiet(); M.P.tO = 0; await M.step();
    check('... OpenSky refusing (429): left alone six hours', M.pause['opensky-network.org'] > Date.now() + 5 * 3600e3);
    delete lists.oskyStatus; M.stats.since = since0; M.lastOk.ladd = Date.now(); }
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
    check('/hist answers several aircraft at once (bad addresses dropped)', two.hv === 6 && two.list.length === 3 && two.list[0].hex === '424c60' && two.list[1].hex === 'c00001', two.list.map(x => x.hex));
    // (c00001's 7 Oct was "without flights" only because it was watched all day and not heard: adsb.lol can miss what
    // airplanes.live heard, so asking for it has that day built from the traces - and not served as a day without flights meanwhile)
    check('... a day without flights only from watching: built from the traces when asked for, not served as one without flights meanwhile', !('2026/10/07' in two.list[1].days) && M.histPend.has('c00001|2026-10-07'), { days: two.list[1].days, pend: [...M.histPend].filter(k => k.startsWith('c00001')) });
    M.histQ.length = 0; M.histPend.clear(); }
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
  // ---- every day from both networks: airplanes.live asked as well as adsb.lol; refusing - the day kept from adsb.lol,
  // marked part of it (a browser looking at the aircraft reads it again, both networks)
  { const hex = '3cdf15', d = '2026-10-02'; M.markBlocked(hex, null, dayS(d) - 86400); apliveStatus = 403; delete M.pause['globe.airplanes.live'];
    asked.length = 0; M.histPend.add(hex + '|' + d);
    await M.histOne({ hex, day: d, tries: 0, at: 0, fill: true });
    const h = M.histRead(hex), shown = M.histOf(hex);
    const askedAp = asked.some(u => /globe\.airplanes\.live\/globe_history\/2026\/10\/02\/traces\/15\/trace_full_3cdf15\.json/.test(u));
    const askedLol = asked.some(u => /adsb\.lol\/globe_history\/2026\/10\/02\/traces\/15\/trace_full_3cdf15\.json/.test(u));
    check('a day built here: adsb.lol\'s file and airplanes.live\'s both asked for', askedAp && askedLol, asked);
    check('... airplanes.live refusing (403): left alone six hours; the day\'s flights kept from adsb.lol, marked part of it', h.days['2026/10/02'] >= 1 && h.part['2026/10/02'] === 1 && shown.days['2026/10/02'] >= 1 && shown.part.includes('2026/10/02') && M.pause['globe.airplanes.live'] > Date.now() + 5 * 3600e3, { days: h.days, part: h.part });
    apliveStatus = 404; delete M.pause['globe.airplanes.live']; M.histPend.add(hex + '|' + d);
    await M.histOne({ hex, day: d, tries: 0, at: 0, fill: true });
    check('... airplanes.live answering (no file there): the day complete as adsb.lol has it - no longer part of it', M.histRead(hex).days['2026/10/02'] >= 1 && !M.histRead(hex).part['2026/10/02'] && !M.histOf(hex).part.includes('2026/10/02'), M.histRead(hex)); }
  // ---- a day adsb.lol has no file of: no flights only when airplanes.live has none either -------------------------------
  // (N527P: its last 40 days taken for days without flights - adsb.lol's files stopped coming - though airplanes.live has
  // its flights)
  { const hex = 'a6a434', d = '2026-09-25'; M.markBlocked(hex, null, dayS(d) - 86400); apliveStatus = 404; delete M.pause['globe.airplanes.live'];
    M.histPend.add(hex + '|' + d); asked.length = 0;
    await M.histOne({ hex, day: d, tries: 0, at: 0, fill: true });
    check('a day asked for to fill a log, no file at adsb.lol: airplanes.live asked; none there either - a day without flights', asked.some(u => /globe\.airplanes\.live\/globe_history\/2026\/09\/25\/traces\/34\/trace_full_a6a434\.json/.test(u)) && M.histRead(hex).days['2026/09/25'] === 0 && M.histOf(hex).days['2026/09/25'] === 0, M.histRead(hex).days);
    const d2 = '2026-09-26'; apliveStatus = 403; M.histPend.add(hex + '|' + d2);
    await M.histOne({ hex, day: d2, tries: 0, at: 0, fill: true });
    check('... airplanes.live refusing: the day not known (the userscript reads it), never one without flights', M.histRead(hex).days['2026/09/26'] === -1 && !('2026/09/26' in M.histOf(hex).days), M.histRead(hex).days);
    apliveStatus = 404; delete M.pause['globe.airplanes.live'];
    // (a log kept by an older build - from adsb.lol alone: not used; built again, both networks)
    fs.writeFileSync(M.histFile('a6a435'), JSON.stringify({ hv: 5, days: { '2026/09/20': 0, '2026/09/21': 2 }, legs: [{ day: '2026/09/21', tStart: 1 }, { day: '2026/09/21', tStart: 2 }] }));
    check('a log kept by an older build: not used - none of its days served, built again', M.histRead('a6a435').hv === 6 && !Object.keys(M.histRead('a6a435').days).length && !Object.keys(M.histOf('a6a435').days).length, M.histRead('a6a435'));
    // (someone looking at an aircraft: the finished days of its last 40 with no answer yet, queued once)
    M.markBlocked('a6a436', null, Date.now() / 1000 - 30 * 86400); const was = M.closed; M.closed = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    M.histQ.length = 0; M.fillAsked.clear();
    M.answer(new URL('http://x/hist?hex=a6a436'), Date.now() / 1000);
    const q1 = M.histQ.filter(j => j.hex === 'a6a436');
    check('/hist: the aircraft\'s finished days of the last 220 - its whole log - with no answer queued to be built here (asked of both networks)', q1.length >= 215 && q1.length <= 220 && q1.every(j => j.fill && j.day <= M.closed), [q1.length, M.closed]);
    M.answer(new URL('http://x/hist?hex=a6a436'), Date.now() / 1000);
    check('... once: asked again at once, nothing more queued', M.histQ.filter(j => j.hex === 'a6a436').length === q1.length);
    M.histQ.length = 0; for (const j of q1) M.histPend.delete(j.hex + '|' + j.day); M.closed = was; }
  // ---- every saved flight log deleted, once, on the first start of this version (and when asked): learned data kept ---------
  { const store = fs.mkdtempSync(path.join(os.tmpdir(), 'monreset-'));
    fs.mkdirSync(path.join(store, 'hist'), { recursive: true }); fs.mkdirSync(path.join(store, 'learn'), { recursive: true });
    fs.writeFileSync(path.join(store, 'hist', '4b15ca.json'), JSON.stringify({ hv: 5, days: { '2026/10/01': 1 }, legs: [{ day: '2026/10/01', tStart: 1 }] }));
    fs.writeFileSync(path.join(store, 'hist', '4b15cb.json'), '{}');
    fs.writeFileSync(path.join(store, 'learn', '2026-10-01.json'), JSON.stringify([['4b15ca|1', 1, 2, 3]]));
    const run = async () => {
      const ch = spawn(process.execPath, [path.join(__dirname, '../monitor/monitor.cjs')], { env: Object.assign({}, process.env, { MON_STORE: store, MON_PORT: String(40000 + Math.floor(Math.random() * 9000)), MON_DATA: process.env.MON_DATA }), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { out += d; });
      for (let i = 0; i < 300 && !/listening/.test(out); i++) await sleep(100);
      ch.kill('SIGTERM'); await new Promise(r => ch.on('exit', r)); return out;
    };
    const out1 = await run();
    check('first start of this version: every saved flight log deleted (files of hist/), the reset said in its log', !fs.readdirSync(path.join(store, 'hist')).length && /every saved log deleted/.test(out1), { hist: fs.readdirSync(path.join(store, 'hist')), log: out1.slice(0, 300) });
    check('... what it learned kept (learn/), the reset noted so it is not done again', fs.existsSync(path.join(store, 'learn', '2026-10-01.json')) && fs.readFileSync(path.join(store, 'hist-reset.txt'), 'utf8') === M.HIST_RESET);
    fs.writeFileSync(path.join(store, 'hist', '4b15ca.json'), JSON.stringify({ hv: M.HIST_V, days: { '2026/10/02': 1 }, legs: [{ day: '2026/10/02', tStart: 2 }] }));
    await run();
    check('... the next start: the logs built since are kept', fs.existsSync(path.join(store, 'hist', '4b15ca.json')));
    fs.writeFileSync(path.join(process.env.MON_STORE, 'hist-x.tmp'), '1');
    fs.mkdirSync(path.join(process.env.MON_STORE, 'hist'), { recursive: true }); fs.writeFileSync(path.join(process.env.MON_STORE, 'hist', 'a00001.json'), '{}');
    check('asked for by its owner (/admin/reset-logs): every log file deleted', M.resetHistLogs() >= 1 && !fs.existsSync(path.join(process.env.MON_STORE, 'hist', 'a00001.json'))); }
  // ---- the pictures browsers found: kept, handed to every browser (photos.cjs) ----------------------------------------
  { const ph = { link: 'https://www.jetphotos.com/photo/9', credit: 'X', large: 'https://cdn.jetphotos.com/640/5/9_1.jpg', source: 'JetPhotos' };
    const r = M.report({ photos: [['a63864', [ph]], ['zz', [ph]]] }, Date.now(), { admin: false, ip: '192.0.2.7' });
    const g = M.answer(new URL('http://x/photos?hex=a63864,a00000'), Date.now() / 1000, { admin: false, ip: '192.0.2.8' });
    check('/report: a browser\'s pictures of a blocked aircraft taken; /photos: handed to any browser', r.ok && r.photos === 1 && g.list.length === 1 && g.list[0].hex === 'a63864' && g.list[0].photos[0].large === ph.large, { r, g }); }
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
