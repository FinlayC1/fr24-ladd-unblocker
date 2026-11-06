// 1.2.10 - runways right, and in for every airport before anyone looks:
//   - which runway: a take-off measured from the far end of its runway (Paris CDG's 26R, 4.2 km long and its start 600 m
//     before 26L's, was never "close": its take-offs given to 26L); parallels told apart over the same positions; no
//     "the longer one" guess (Los Angeles lands on 24R, the shorter); the straight run only (a circuit's legs, a
//     straight-in turned away from, never a runway)
//   - the live log: a take-off only climbing, a landing only coming down (a T-6 just off Atlanta's 26L, heading across the
//     field, was "landing"); taxiing marked airborne is taxiing; the last answer on short final always taken
//   - the low scan: every flight low over the world, all of FR24's services, FR24's own altitude filter, every 30 s, into
//     the runway log; quarters keep their region's height; FR24 pushing back slows every scan
//   - the world scan every minute; the runway log's old files read for their landings only; its writes off the loop
//   - the page: the runway in use follows an airport turning round (Manchester 05 -> 23, Liverpool 09 -> 27) - the kind
//     not yet turned shown the new way, predicted; asked every 30 s
// usage: node test/unit_1210.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), D = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = D;
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon1210-'));
process.env.MON_PORT = String(42000 + Math.floor(Math.random() * 6000));
global.fetch = async () => ({ status: 404, text: async () => '' });
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E, APT = M.APT, FR = require('../monitor/fr24.cjs');
const { createRwyLog } = require('../monitor/rwylog.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// (a position on an end's centreline, km past its threshold its way (negative: short of it), xt km to its right)
const on = (icao, id, km, alt, t, gs, xt, trk) => {
  const e = APT.endsOf(icao).find(x => x.id === id), [la, lo] = E.destPoint(e.lat, e.lon, e.hdg, km), [la2, lo2] = xt ? E.destPoint(la, lo, (e.hdg + 90) % 360, xt) : [la, lo];
  return { t, lat: la2, lon: lo2, alt, gnd: false, gs: gs || 150, trk: trk != null ? trk : e.hdg };
};
const ap = icao => E.byIcao(icao);

(async () => {
  // ================= which runway =================
  { // (CDG 26R: its first position in the air 4.4 km from its start at 825 ft - every 30 s after, on its centreline)
    const T = 1.79e9, el = ap('LFPG').alt || 392, dep = [];
    for (let i = 0; i < 5; i++) dep.push(on('LFPG', '26R', 4.4 + i * 2.6, el + 430 + i * 600, T + i * 30, 170, 0.006));
    check('runway: a take-off from Paris CDG\'s 26R - its start 600 m before 26L\'s, its first position in the air 4.4 km along - is 26R (was 26L, 380 m off to the side)', APT.runwayOf(ap('LFPG'), dep, false) === '26R', APT.runwayOf(ap('LFPG'), dep, false));
    const dep27 = []; for (let i = 0; i < 4; i++) dep27.push(on('LFPG', '27L', 3.1 + i * 2.5, el + 300 + i * 550, T + i * 30, 160, -0.011));
    check('... and from 27L, beside 27R (was 27R)', APT.runwayOf(ap('LFPG'), dep27, false) === '27L', APT.runwayOf(ap('LFPG'), dep27, false));
    const arr = []; for (let i = 0; i < 6; i++) arr.push(on('LFPG', '26L', -11 + i * 2, el + (11 - i * 2) * 330, T + i * 30, 150, 0.004));
    check('... a landing on 26L, seen every 30 s down the final - 26L, not its neighbour 26R', APT.runwayOf(ap('LFPG'), arr, true) === '26L', APT.runwayOf(ap('LFPG'), arr, true));
    // (Los Angeles: a United on 24R's centreline, 215 m from 24L's - the longer)
    const lax = ap('KLAX'), elx = lax.alt || 128, f24 = [[-10, 1775], [-7.4, 1325], [-5, 900], [-2.8, 575], [-0.3, 125]].map(([km, alt], i) => on('KLAX', '24R', km, alt, T + i * 30, 150, 0.005));
    check('runway: a landing on Los Angeles\'s 24R, 215 m from 24L, the longer - 24R', APT.runwayOf(lax, f24, true) === '24R', APT.runwayOf(lax, f24, true));
    check('... seen only 10 km out, the two alike: no answer - not "the longer one", 24L (1.2.9)', APT.runwayOf(lax, f24.slice(0, 1), true) === null, APT.runwayOf(lax, f24.slice(0, 1), true));
    void elx;
    // (Atlanta: 26L/26R, 300 m apart, both in use - one far position alike for both: no guess)
    const atl = [on('KATL', '26R', -8, 2350 + 1026 - 1026, T, 175, 0.003)];
    check('... Atlanta\'s 26L/26R, 300 m apart and both in use, alike from one position 8 km out: no answer', APT.runwayOf(ap('KATL'), atl, true) === null, APT.runwayOf(ap('KATL'), atl, true));
    // (a circuit: a straight-in towards one runway, turned away from, landed on another)
    const dab = ap('KDAB'), e25 = APT.endsOf('KDAB').find(e => /^25/.test(e.id)), e34 = APT.endsOf('KDAB').find(e => e.id === '34');
    if (dab && e25 && e34) {
      const eld = dab.alt || 34, c = [on('KDAB', '34', -5, eld + 1300, T, 90, 0.01), on('KDAB', '34', -3.5, eld + 1075, T + 30, 90, 0.01), { ...on('KDAB', e25.id, -3.4, eld + 900, T + 60, 85, 0.6), trk: 60 }, { ...on('KDAB', e25.id, -2.6, eld + 700, T + 90, 80, 0.3), trk: 10 }, on('KDAB', e25.id, -1.8, eld + 275, T + 120, 75, 0.01)];
      const r = APT.runwayOf(dab, c, true);
      check('runway: a Cessna\'s straight-in towards Daytona\'s 34, turned off, landed on ' + e25.id + ' - never 34', r !== '34', r);
    } else check('runway: Daytona\'s runways known (test data)', false, !!dab);
  }

  // ================= the live log =================
  { const RL = createRwyLog({ E, APT, store: fs.mkdtempSync(path.join(os.tmpdir(), 'rl1210-')) });
    const T = Math.floor(Date.now() / 1000) - 600, atl = ap('KATL'), el = atl.alt || 1026;
    // (a T-6 off Atlanta's 26L, no destination: first seen just off the east end heading west across the field, then climbing)
    const fl = (p, t) => ({ id: 0x42765c89, lat: p.lat, lon: p.lon, alt: p.alt, spd: p.gs, trk: p.trk, ts: t, gnd: false, from: 'ATL', to: '', cs: 'N214MB', type: 'T6' });
    RL.observe([fl(on('KATL', '26L', 0.6, el - 50, T, 86), T)], T);
    RL.observe([fl(on('KATL', '26L', 3.4, el + 330, T + 30, 100), T + 30)], T + 30);
    RL.observe([fl(on('KATL', '26L', 5.6, el + 730, T + 60, 107, 0, 231), T + 60)], T + 60);
    check('live log: a T-6 just off Atlanta\'s 26L, heading west across the field, no destination - a take-off from 26L, not a landing', RL.get('42765c89:0') === '26L' && RL.get('42765c89:1') === '', [RL.get('42765c89:0'), RL.get('42765c89:1')]);
    // (taxiing along a runway, marked in the air: 20 kt, level with the field)
    const gp = ap('EGGP'), elg = gp.alt || 80;
    for (let i = 0; i < 4; i++) { const p = on('EGGP', '27', 0.1 + i * 0.15, elg + 30, T + i * 30, 20); RL.observe([{ id: 0x42760001, lat: p.lat, lon: p.lon, alt: p.alt, spd: 20, trk: p.trk, ts: T + i * 30, gnd: false, from: 'LPL', to: 'BHD' }], T + i * 30); }
    check('... a light aircraft taxiing along Liverpool\'s 27 at 20 kt, marked in the air - no take-off logged', RL.get('42760001:0') === '', RL.get('42760001:0'));
    // (Los Angeles: on 24R's final - the last position, 200 m short of the threshold, 46 degrees off the way to the field's middle)
    const lax = ap('KLAX'), path24 = [[-10, 1775], [-7.4, 1325], [-5, 900], [-2.8, 575], [-0.3, 125]];
    path24.forEach(([km, alt], i) => { const p = on('KLAX', '24R', km, alt, T + i * 30, 150, 0.005); RL.observe([{ id: 0x42763762, lat: p.lat, lon: p.lon, alt, spd: 150, trk: p.trk, ts: T + i * 30, gnd: false, from: 'MRY', to: 'LAX', cs: 'UAL2740' }], T + i * 30); });
    check('... a United down Los Angeles\'s final to 24R - 24R, its last answer taken on short final (was 24L)', RL.get('42763762:1') === '24R', RL.get('42763762:1'));
    void lax;
  }

  // ================= FR24's altitude filter; the low scan =================
  { const msg = FR.liveFeedRequest({ n: 1, s: 0, w: 0, e: 1, alt: [0, 6000], services: [0, 1], traffic: 2 });
    const fs3 = FR.parse(msg).filter(f => f.fn === 3), rng = fs3.length ? FR.parse(fs3[0].val).filter(f => f.fn === 1) : [], mm = rng.length ? FR.parse(rng[0].val) : [];
    const v = fn => (mm.find(f => f.fn === fn) || {}).val;
    check('fr24: the altitude filter sent as FR24\'s own (filters, field 3: an altitude range 0 - 6,000 ft)', fs3.length === 1 && v(1) === 0 && v(2) === 6000, { n: fs3.length, min: v(1), max: v(2) });
    check('... and none without one', FR.parse(FR.liveFeedRequest({ n: 1, s: 0, w: 0, e: 1 })).every(f => f.fn !== 3));
    const asked = [];
    const fake = { liveFeed: async q => { asked.push(q.alt ? q.alt.join('-') : 'none'); return { flights: asked.length === 1 ? Array.from({ length: 1500 }, (_, i) => ({ id: i + 1 })) : [{ id: 99999 }], serverTime: 0 }; } };
    await FR.scanWorld(fake, { regions: [{ n: 60, s: 40, w: -10, e: 10, alt: [0, 9000] }], gapMs: 0 });
    check('... a region full (1,500) asked again in quarters, each with its region\'s height', asked.length === 5 && asked.every(a => a === '0-9000'), asked);
    check('... the low scan\'s regions: one request each at the US afternoon peak; high airports\' regions higher (Mexico City, La Paz; Denver)', FR.LOW_REGIONS.length === 8 && FR.LOW_REGIONS.find(r => r.n === 24 && r.w === -170).alt[1] >= 14000 && FR.LOW_REGIONS.find(r => r.w === -115).alt[1] >= 10000);

    const c = M.fr24Client(), was = c.liveFeed, wasScan = M.CFG.fr24Scan, qs = [];
    const e27 = APT.endsOf('EGGP').find(e => e.id === '27'), el = ap('EGGP').alt || 80, now0 = Math.floor(Date.now() / 1000);
    let k = 0;
    c.liveFeed = async q => { qs.push(q); const r = Math.floor(k++ / 8), [la, lo] = E.destPoint(e27.lat, e27.lon, e27.hdg, 3 + r * 2.5); return { flights: [{ id: 0x3e0c0001, lat: la, lon: lo, alt: el + 400 + r * 700, gnd: false, spd: 170, trk: e27.hdg, ts: now0 + r * 30, from: 'LPL', to: 'DUB', cs: 'RYR4FH', reg: 'EI-ABC', type: 'B738', hex: '4ca001' }], serverTime: 0 }; };
    M.CFG.fr24Scan = true;
    await M.rwyLowRound(); await M.rwyLowRound();
    c.liveFeed = was; M.CFG.fr24Scan = wasScan;
    check('monitor: the low scan - every service (airliners too), in the air only, FR24\'s altitude filter, its eight regions', qs.length === 16 && qs.every(q => q.services.includes(0) && q.services.includes(1) && q.traffic === 2 && Array.isArray(q.alt)) && M.LOW.requests === 8, { n: qs.length, low: M.LOW });
    check('... a Ryanair climbing out of Liverpool\'s 27 logged by it, no one looking at Liverpool', M.RL.get('3e0c0001:0') === '27', M.RL.get('3e0c0001:0'));
    check('... the world scan every minute, the low scan every 30 s', M.CFG.fr24Every === 60 && M.CFG.rwyLowEvery === 30, [M.CFG.fr24Every, M.CFG.rwyLowEvery]);
    // (FR24 pushing back: every scan slowed)
    const st = c.st, pu = st.pauseUntil;
    st.pauseUntil = Date.now() + 1000; const p1 = M.pace();
    st.pauseUntil = Date.now() + 2000; const p2 = M.pace();
    st.pauseUntil = Date.now() + 3000; const p3 = M.pace();
    check('... FR24 pushing back slows every scan: twice as slow, four times after another, no slower', p1 === 2 && p2 === 4 && p3 === 4, [p1, p2, p3]);
    st.pauseUntil = pu; M.PACE.factor = 1; M.PACE.until = 0;
    check('... /status shows it', !!(M.answer(new URL('http://x/status'), Date.now() / 1000) || {}).runways);
  }

  // ================= the runway log on disk =================
  { const store = fs.mkdtempSync(path.join(os.tmpdir(), 'rlv-')), dir = path.join(store, 'rwylog'), now = Math.floor(Date.now() / 1000), day = new Date(now * 1000).toISOString().slice(0, 10);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, day + '.json.gz'), zlib.gzipSync(JSON.stringify({ v: 1, day, ap: { 598: { '4275aaaa:0': ['26L', now - 100, 'live'], '4275bbbb:1': ['26L', now - 50, 'live'] } } })));
    const R1 = createRwyLog({ E, APT, store }); R1.load(now);
    check('runway log: a 1.2.9 file read for its landings only - its take-offs (CDG 26R read as 26L) dropped', R1.get('4275bbbb:1') === '26L' && R1.get('4275aaaa:0') === '', [R1.get('4275bbbb:1'), R1.get('4275aaaa:0')]);
    R1.put('4275cccc', 0, '26R', 598, now - 20, 'live');
    R1.save(now);
    for (let i = 0; i < 50 && !R1.stats.written; i++) await sleep(20);
    const R2 = createRwyLog({ E, APT, store }); R2.load(now);
    check('... written away from the event loop, read back as version 2: the new take-off and the old landing', R1.stats.written === 1 && R2.get('4275cccc:0') === '26R' && R2.get('4275bbbb:1') === '26L', { w: R1.stats.written, a: R2.get('4275cccc:0'), b: R2.get('4275bbbb:1') });
  }

  // ================= a landing FR24 split in two: no "departure" =================
  { const BD = require('../monitor/boards.cjs').createBoards({ store: fs.mkdtempSync(path.join(os.tmpdir(), 'bd1210-')), E }), oxf = ap('EGTK').id, t = Math.floor(Date.now() / 1000) - 1800;
    BD.put(oxf, 'arrivals', [{ k: 'f4274e2ca', src: 'sched', t, sch: t - 14000, est: t, fid: '4274e2ca', cs: 'VLZ78K', st: 'landed', col: 'green', ap: 914, reg: '2-PUBS', hex: '43f86e' }], 'crowd', t + 1800);
    BD.put(oxf, 'departures', [{ k: 'f42766247', src: 'sched', t: t + 24, sch: t + 24, est: t + 24, fid: '42766247', cs: 'VLZ78K', st: 'departed', col: 'green', reg: '2-PUBS', hex: '43f86e' },
      { k: 'f42760001', src: 'sched', t: t + 900, sch: t + 900, est: t + 900, fid: '42760001', cs: 'GNLLY', st: 'departed', col: 'green', reg: 'G-NLLY', hex: '400aaa' }], 'crowd', t + 1800);
    const r = BD.rows(oxf, t - 3600, t + 3600);
    check('board: VLZ78K landed at Oxford and FR24\'s new flight of it begun on the runway 24 s later, "from Oxford" to nowhere - no departure on the board; another aircraft\'s departure kept', r.arrivals.length === 1 && r.departures.length === 1 && r.departures[0].cs === 'GNLLY', r.departures.map(x => x.cs));
    const c = [...BD.counts(oxf).values()][0] || [0, 0];
    check('... nor counted as a take-off in the day\'s movements', c[0] === 1 && c[1] === 1, c);
  }

  // ================= the page: the runway in use as an airport turns round =================
  { const { JSDOM } = require(path.join(NM, 'jsdom'));
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.flightradar24.com/53.35,-2.27/10', runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window; let H = null;
    w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob; w.DecompressionStream = DecompressionStream;
    w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.indexedDB = undefined; w.fetch = () => Promise.reject(new Error('offline')); w.postMessage = () => {};
    const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/); w.eval('(' + m[0] + ')()');
    const now = 1794000000, man = { ends: [['05R', 50], ['23L', 230], ['05L', 50], ['23R', 230]], runways: [['05R', '23L', 10007, 0], ['05L', '23R', 10000, 0]] };
    // (Manchester, 6 Nov: 05 until 19:29 - landings 05R, take-offs 05L - then take-offs on 23R from 19:37; earlier in the day landings on 23R)
    const mvM = [['23R', 1, now - 30000], ['05R', 1, now - 2400], ['05L', 0, now - 2340], ['05R', 1, now - 1860], ['05L', 0, now - 1200], ['23R', 0, now - 720], ['23R', 0, now - 600]];
    const r1 = H.rwyInUse(Object.assign({ mv: mvM }, man), { deg: 90, kts: 2 }, 'Clear', now);
    check('runway in use: Manchester turned round to 23 (take-offs on 23R since 19:37) - landings shown 23R, as they were earlier, predicted - not "05R confirmed" from 19:19', r1.dep.rwys.join() === '23R' && r1.dep.tag === 'conf' && r1.arr.rwys.join() === '23R' && r1.arr.tag === 'pred', r1);
    const r2 = H.rwyInUse(Object.assign({ mv: mvM.slice(1) }, man), { deg: 90, kts: 2 }, 'Clear', now);
    check('... with no landing that way earlier: the far end of the runway it used, 23L', r2.arr.rwys.join() === '23L' && r2.arr.tag === 'pred', r2.arr);
    const r3 = H.rwyInUse(Object.assign({ mv: mvM.concat([['23R', 1, now - 60]]) }, man), { deg: 90, kts: 2 }, 'Clear', now);
    check('... the first landing on 23R in: confirmed', r3.arr.rwys.join() === '23R' && r3.arr.tag === 'conf', r3.arr);
    // (Liverpool, one runway: landings on 09 to 19:19, then one on 27 at 19:48; take-offs last on 09 at 19:03)
    const lpl = { ends: [['09', 87], ['27', 267]], runways: [['09', '27', 7500, 0]] }, mvL = [['09', 0, now - 2760], ['09', 1, now - 1800], ['27', 1, now - 20]];
    const r4 = H.rwyInUse(Object.assign({ mv: mvL }, lpl), { deg: 140, kts: 2 }, 'Rain', now);
    check('... Liverpool switched to 27 (a landing on 27 a moment ago): landings 27 confirmed, take-offs 27 predicted - not 09', r4.arr.rwys.join() === '27' && r4.arr.tag === 'conf' && r4.dep.rwys.join() === '27' && r4.dep.tag === 'pred', r4);
    const r5 = H.rwyInUse(Object.assign({ mv: [['27', 1, now - 300]] }, lpl), { deg: 90, kts: 12 }, 'Rain', now);
    check('... no take-off in the last 90 minutes, landings on 27: take-offs 27 - the traffic, not the wind (an easterly 12 kt says 09)', r5.dep.rwys.join() === '27' && r5.dep.tag === 'pred', r5.dep);
    // (1.2.11) (JFK, 6 Nov 20:45Z: landings on 22L, take-offs from 22R, minutes ago - the wind 340 degrees 8 kt, 5 kt behind them)
    const jfk = { ends: [['13R', 121], ['31L', 301], ['04L', 31], ['22R', 211], ['13L', 121], ['31R', 301], ['04R', 31], ['22L', 211]], runways: [['04L', '22R', 12079, 0], ['04R', '22L', 8400, 0], ['13L', '31R', 10000, 0], ['13R', '31L', 14511, 0]] };
    const mvJ = [['22L', 1, now - 2460], ['22R', 0, now - 420], ['22L', 1, now - 419], ['22R', 0, now - 380], ['22L', 1, now - 360], ['22R', 0, now - 255], ['22R', 0, now - 170], ['22L', 1, now - 169], ['22R', 0, now - 110], ['22L', 1, now - 40]];
    const r6 = H.rwyInUse(Object.assign({ mv: mvJ }, jfk), { deg: 340, kts: 8 }, 'Overcast', now);
    check('... JFK landing on 22L and taking off from 22R minutes ago, the wind 340 degrees 8 kt (5 kt behind them): 22L and 22R confirmed - not "31L, predicted" by the wind', r6.arr.rwys.join() === '22L' && r6.arr.tag === 'conf' && r6.dep.rwys.join() === '22R' && r6.dep.tag === 'conf', r6);
    const r7 = H.rwyInUse(Object.assign({ mv: mvJ.map(m => [m[0], m[1], m[2] - 3000]) }, jfk), { deg: 40, kts: 18 }, 'Overcast', now);
    check('... the same traffic an hour old and the wind now 18 kt from the north-east, behind 22 by 14 kt: the wind says 04', r7.arr.rwys[0].startsWith('04') && r7.arr.tag === 'pred', r7.arr);
    check('... the page asks every 30 s', /c\.asked > 30000/.test(SRC) && /c\.done && Date\.now\(\) - c\.at > 30000/.test(SRC));
    w.close();
    // (1.2.11) the panel opens with its runway in use: built as FR24 draws its weather - before the browser paints - and
    // filled the moment the airport's answer comes, never "N/A" while it comes
    { const dom2 = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.flightradar24.com/airport/1257/lpl', runScripts: 'dangerously', pretendToBeVisual: true });
      const w2 = dom2.window, posts = []; let H2 = null;
      w2.__tlTestHook = h => { H2 = h; }; w2.Response = Response; w2.Headers = Headers; w2.Blob = Blob; w2.DecompressionStream = DecompressionStream;
      w2.unsafeWindow = w2; w2.GM_xmlhttpRequest = () => {}; w2.indexedDB = undefined; w2.fetch = () => Promise.reject(new Error('offline'));
      w2.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
      w2.eval('(' + m[0] + ')()');
      await sleep(100);
      const doc = w2.document, panel = doc.createElement('div'); panel.setAttribute('data-testid', 'airport-panel'); doc.body.appendChild(panel);
      await sleep(0);
      // (FR24 draws its weather into the open panel)
      panel.innerHTML = '<section><dl class="grid grid-cols-3"><div data-testid="airport-panel__weather__conditions"><dd>Rain</dd></div><div data-testid="airport-panel__weather__temperature"><dd>9 °C</dd></div><div data-testid="airport-panel__weather__wind"><dd>140° 2 kts</dd></div></dl></section>';
      await Promise.resolve(); await Promise.resolve();
      const tiles = () => [...panel.querySelectorAll('.tl-rwyuse > div')].map(d => d.textContent.replace(/\s+/g, ' ').trim());
      const t0 = tiles(), ask = posts.filter(p => p.__tweeksLadd === 'rwyAp' && p.ap === 1257);
      check('panel: the runway in use built in as FR24 draws the weather - in the same turn, before the browser paints, not at the next 0.4 s look; the airport asked for', t0.length === 2 && ask.length === 1, { t0, asks: ask.length });
      check('... while the answer comes: the tiles there, empty - not "N/A"', t0.every(x => !/N\/A/.test(x)) && /Departures runway/i.test(t0[0] || ''), t0);
      const send = data => w2.dispatchEvent(new w2.MessageEvent('message', { data, source: w2, origin: 'https://www.flightradar24.com' }));
      send({ __tweeksLadd: 'rwyApGot', rid: ask[0] && ask[0].rid, ap: 1257, ok: true, f: {}, h: [], use: { ends: [['09', 87], ['27', 267]], runways: [['09', '27', 7500, 0]], mv: [['27', 1, Math.floor(Date.now() / 1000) - 60], ['27', 0, Math.floor(Date.now() / 1000) - 30]], at: Math.floor(Date.now() / 1000) } });
      const t1 = tiles();
      check('... the answer in: written into the panel at once - departures 27, arrivals 27, confirmed', /Departures runway\s*27\s*Confirmed/i.test(t1[0] || '') && /Arrivals runway\s*27\s*Confirmed/i.test(t1[1] || ''), t1);
      void H2; w2.close(); }
  }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
