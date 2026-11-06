// 1.2.12 - the runway in use, nailed down:
//   - a second runway shown only with a share of its own (JFK: one take-off logged on 22L beside 57 on 22R read "22R / 22L")
//   - common sense about a minor runway: never "the runway in use" while a main one has traffic, nor a guess by the wind
//     (Beauvais's 04/22, 1.1 km beside 12/30's 2.4 km) - a main runway shorter than the longest is still main (JFK's 22L)
//   - the monitor: a runway logged from FR24's own trail or scans never turned by a browser's points; the ADS-B legs'
//     runways only those worked out by 1.2.10's rule; the movements from the runway log, the legs' only where it has none
// usage: node test/unit_1212.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), os = require('os');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), D = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = D;
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon1212-'));
process.env.MON_PORT = String(42000 + Math.floor(Math.random() * 6000));
global.fetch = async () => ({ status: 404, text: async () => '' });
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
const { createRwyLog } = require('../monitor/rwylog.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };

(async () => {
  // ================= the page: the runway in use =================
  { const { JSDOM } = require(path.join(NM, 'jsdom'));
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.flightradar24.com/49.45,2.11/10', runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window; let H = null;
    w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob; w.DecompressionStream = DecompressionStream;
    w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.indexedDB = undefined; w.fetch = () => Promise.reject(new Error('offline')); w.postMessage = () => {};
    const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/); w.eval('(' + m[0] + ')()');
    const now = 1794000000;
    // (JFK, 6 Nov 22:17Z: 57 take-offs on 22R and one logged on 22L; 48 landings on 22L)
    const jfk = { ends: [['13R', 121], ['31L', 301], ['04L', 31], ['22R', 211], ['13L', 121], ['31R', 301], ['04R', 31], ['22L', 211]], runways: [['13R', '31L', 14511, 0], ['04L', '22R', 12079, 0], ['13L', '31R', 10000, 0], ['04R', '22L', 8400, 0]] };
    const mvJ = []; for (let i = 0; i < 57; i++) mvJ.push(['22R', 0, now - 5000 + i * 85]); mvJ.push(['22L', 0, now - 2400]); for (let i = 0; i < 48; i++) mvJ.push(['22L', 1, now - 5000 + i * 100]);
    mvJ.sort((a, b) => a[2] - b[2]);
    const r1 = H.rwyInUse(Object.assign({ mv: mvJ }, jfk), { deg: 240, kts: 3 }, 'Overcast', now);
    check('runway in use: JFK - 57 take-offs on 22R and one logged on 22L - "22R", not "22R / 22L"; landings 22L (8,400 ft, 58% of 13R/31L: still a main runway)', r1.dep.rwys.join() === '22R' && r1.dep.tag === 'conf' && r1.arr.rwys.join() === '22L' && r1.arr.tag === 'conf', r1);
    const mvJ2 = mvJ.concat([['22L', 0, now - 1200], ['22L', 0, now - 900], ['22L', 0, now - 600], ['22L', 0, now - 300], ['22L', 0, now - 200], ['22L', 0, now - 100], ['22L', 0, now - 60], ['22L', 0, now - 30], ['22L', 0, now - 20], ['22L', 0, now - 10], ['22L', 0, now - 5], ['22L', 0, now - 4], ['22L', 0, now - 3], ['22L', 0, now - 2]]).sort((a, b) => a[2] - b[2]);
    const r2 = H.rwyInUse(Object.assign({ mv: mvJ2 }, jfk), { deg: 240, kts: 3 }, 'Overcast', now);
    check('... two really in use (15 take-offs on 22L, a quarter of 22R\'s): both shown', r2.dep.rwys.length === 2 && r2.dep.rwys.includes('22R') && r2.dep.rwys.includes('22L'), r2.dep);
    // (Beauvais: 12/30 2,430 m, 04/22 1,105 m, 13R/31L of no known length; landings on 12; a light aircraft off 04)
    const bva = { ends: [['12', 124], ['30', 304], ['04', 42], ['22', 222], ['13R', 130], ['31L', 310]], runways: [['12', '30', 7972, 0], ['04', '22', 3625, 0], ['13R', '31L', 0, 0]] };
    const r3 = H.rwyInUse(Object.assign({ mv: [['12', 1, now - 3000], ['04', 0, now - 1500], ['12', 1, now - 1200]] }, bva), { deg: 240, kts: 1 }, 'Fog', now);
    check('... Beauvais: landings on 12, a light aircraft off the 1.1 km 04 - take-offs shown on 12, not 04', r3.dep.rwys.join() === '12' && r3.arr.rwys.join() === '12', r3);
    const r4 = H.rwyInUse(Object.assign({ mv: [] }, bva), { deg: 240, kts: 1 }, 'Fog', now);
    check('... no traffic, calm, fog: the main runway - 12/30, never 04 or the unmeasured 13R', /^(12|30)/.test(r4.dep.rwys[0]) && /^(12|30)/.test(r4.arr.rwys[0]), r4);
    const r5 = H.rwyInUse(Object.assign({ mv: [] }, bva), { deg: 40, kts: 15 }, '', now);
    check('... no traffic, 15 kt straight down 04: still the main runway (12 has the most headwind of the two ends), not the 1.1 km 04', r5.dep.rwys.join() === '12' && r5.arr.rwys.join() === '12', r5);
    const r6 = H.rwyInUse(Object.assign({ mv: [['04', 1, now - 900], ['04', 0, now - 600], ['04', 1, now - 300]] }, bva), { deg: 40, kts: 8 }, '', now);
    check('... only the minor runway in use (no traffic on 12/30 at all - closed, say): it, as the traffic says', r6.dep.rwys.join() === '04' && r6.arr.rwys.join() === '04' && r6.arr.tag === 'conf', r6);
    w.close(); }

  // ================= the monitor =================
  { const RL = createRwyLog({ E, APT: M.APT, store: fs.mkdtempSync(path.join(os.tmpdir(), 'rl1212-')) }), jfk = E.byIcao('KJFK').id, t = Math.floor(Date.now() / 1000) - 600;
    RL.put('4276a09c', 0, '22R', jfk, t, 'live'); RL.put('4276a09c', 0, '22L', jfk, t + 5, 'fit');
    RL.put('4276b001', 0, '22L', jfk, t, 'fit'); RL.put('4276b001', 0, '22R', jfk, t + 5, 'live');
    RL.put('4276b002', 0, '22R', jfk, t, 'trail'); RL.put('4276b002', 0, '22L', jfk, t + 5, 'live');
    RL.put('4276b003', 1, '22R', jfk, t, 'live'); RL.put('4276b003', 1, '22L', jfk, t + 30, 'live');
    check('runway log: a take-off logged 22R from FR24\'s scans not turned to 22L by a browser\'s points; the other way round, the scans\' answer taken; FR24\'s whole trail over the scans; the scans\' later answer over their earlier one',
      RL.get('4276a09c:0') === '22R' && RL.get('4276b001:0') === '22R' && RL.get('4276b002:0') === '22R' && RL.get('4276b003:1') === '22L', [RL.get('4276a09c:0'), RL.get('4276b001:0'), RL.get('4276b002:0'), RL.get('4276b003:1')]); }
  { const nowS = Math.floor(Date.now() / 1000), jfk = E.byIcao('KJFK'), lpl = E.byIcao('EGGP');
    // (an ADS-B leg kept from before 1.2.10 - no mark - and one worked out by its rule)
    M.legs.set('a29184', new Map([[1, { hex: 'a29184', from: { id: jfk.id, conf: 'ground' }, to: null, tOff: nowS - 4000, tStart: nowS - 4100, rwyOff: '22L', open: true }]]));
    M.legs.set('ac3477', new Map([[1, { hex: 'ac3477', from: { id: jfk.id, conf: 'ground' }, to: null, tOff: nowS - 3000, tStart: nowS - 3100, rwyOff: '22R', rwyV: 2, open: true }]]));
    const h = M.laddRwys(jfk.id, nowS - 86400, nowS + 60);
    check('ADS-B legs: only runways worked out by 1.2.10\'s rule given out - one kept from before (1.2.9 put 22R take-offs on 22L) left out', h.some(x => x[0] === 'ac3477' && x[2] === '22R') && !h.some(x => x[0] === 'a29184'), h);
    const leg = { from: { id: lpl.id, conf: 'ground' } }; M.legRunways(leg, { pts: [] });
    check('... legRunways marks what it works out (rwyV 2)', leg.rwyV === 2);
    // (/rwyap: the movements from the runway log; the legs' only where it has nothing of the last three hours)
    M.RL.put('4276c001', 0, '22R', jfk.id, nowS - 900, 'live');
    const j = M.answer(new URL(`http://x/rwyap?ap=${jfk.id}&use=1`), nowS);
    check('/rwyap: the movements from the runway log - the ADS-B legs\' not added when it has the last three hours (the same flights counted twice)', j && j.mv.length === 1 && j.mv[0][0] === '22R', j && j.mv);
    M.legs.delete('a29184'); M.legs.delete('ac3477'); }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
