// "Playback" in a real browser: the BUILT userscript in Chromium (Playwright's) on the Vue 3 page made like FR24's map
// (test/fixtures/fr24mock.html ?pb=1), whose own Playback actions - the panel's, a board card's, a search result's -
// go to the flight's log page, as FR24's do for a flight it has no record of, and whose bottom bar's Playback opens its
// playback window. FR24's router (its Inertia app's $inertia) stood in for, recording any page it is given. Clicked
// with the mouse:
//   - the bar's Playback with a LADD flight open in the panel: FR24's playback window, nothing else
//   - the panel's Playback, a board card's (a flight followed here, N600EB's kept row from two days back), a search
//     result's of a blocked flight: the aircraft's own page at that flight (/data/aircraft/<reg>#<flight>) - where FR24
//     plays a flight, in place, in its own player (1.2.4) - in this tab; nothing on airplanes.live, no playback page
//   - a board card's and a search result's of an ordinary flight: FR24's own (the log page)
//   - a middle click: the aircraft's page at that flight in a new tab
// Needs Playwright and Vue 3's browser build (skipped without): PLAYWRIGHT_PATH=<its module dir> CHROMIUM=<binary>
// VUE_PATH=<vue.global.js>.
// usage: node test/unit_pbnative.cjs
const fs = require('fs'), path = require('path');
let chromium = null;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(x => fs.existsSync(x));
const vuePath = [process.env.VUE_PATH, path.join(__dirname, '..', 'node_modules', 'vue', 'dist', 'vue.global.js')].filter(Boolean).find(x => fs.existsSync(x));
if (!chromium) { console.log('(skipped: Playwright not found - PLAYWRIGHT_PATH=<its module dir>)'); process.exit(0); }
if (!vuePath) { console.log('(skipped: Vue 3 not found - VUE_PATH=<vue.global.js>)'); process.exit(0); }
const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const VUE = fs.readFileSync(vuePath, 'utf8');
const MOCK = fs.readFileSync(path.join(__dirname, 'fixtures', 'fr24mock.html'), 'utf8');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// (the userscript's requests through the page - so the test's network answers them)
const STUBS = `
window.GM_info = { scriptHandler: 'Tampermonkey', version: '5.3' };
window.unsafeWindow = window; window.GM_notification = () => {};
window.GM_xmlhttpRequest = o => { fetch(o.url).then(r => r.text().then(t => o.onload && o.onload({ status: r.status, responseText: t, response: t }))).catch(() => o.onerror && o.onerror({})); return { abort() {} }; };
window.__tlTestHook = h => { window.__H = h; };
`;
const MAP = 'https://www.flightradar24.com/40.70,-73.90/9?mode=keyed&pb=1';
const ymd = t => new Date(t * 1000).toISOString().slice(0, 10);
const syn = (hex, t) => 'ff' + hex + ('00000000' + Math.round(t).toString(16)).slice(-8);
const NOW = Math.floor(Date.now() / 1000);
// (adsb.lol's record of a day of an aircraft: on the stand, off at t, up and along for an hour, down)
function trace(hex, dayStart, t, from, to) {
  const tr = [];
  for (let s = t - 600; s <= t + 4200 && s <= NOW; s += 20) {
    const k = Math.min(1, Math.max(0, (s - t) / 3600)), gnd = s < t || s > t + 3600;
    tr.push([s - dayStart, from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, gnd ? 'ground' : Math.round(30000 * Math.min(1, Math.min(k, 1 - k) * 6)), gnd ? 6 : 320, 10, 0, gnd ? null : 900, s === t ? { flight: hex === '424c60' ? 'VSB82   ' : 'N600EB  ', squawk: '2231' } : null, 'adsb_icao']);
  }
  return JSON.stringify({ icao: hex, timestamp: dayStart, trace: tr });
}
(async () => {
  const browser = await chromium.launch({ executablePath: exe || undefined, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const errors = [], tabs = [];
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('/__vue.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    if (/^https:\/\/www\.flightradar24\.com\/([0-9.,-]+\/\d+|\d{4}-\d\d-\d\d\/)/.test(u)) return route.fulfill({ status: 200, contentType: 'text/html', body: MOCK });
    // (airplanes.live opened as a page - never now; its history files read for a hole in adsb.lol's record are data)
    if (/^https:\/\/globe\.airplanes\.live\//.test(u)) { if (route.request().resourceType() === 'document') tabs.push(u); return route.fulfill({ status: 404, body: '', headers: { 'access-control-allow-origin': '*' } }); }
    // adsb.lol's records: M-ARNZ today (off Fort Lauderdale half an hour ago), N600EB two days back (off LaGuardia)
    const tm = /adsb\.lol\/(?:globe_history\/(\d{4})\/(\d\d)\/(\d\d)|data)\/traces\/[0-9a-f]{2}\/trace_full_([0-9a-f]{6})\.json/.exec(u);
    if (tm) {
      const day = tm[1] ? Date.UTC(+tm[1], +tm[2] - 1, +tm[3]) / 1000 : Math.floor(NOW / 86400) * 86400, hex = tm[4];
      const body = hex === '424c60' && !tm[1] ? trace(hex, day, NOW - 1800, [26.0726, -80.1527], [33.1, -78.2]) : hex === 'a80b2e' && tm[1] && ymd(day) === ymd(NOW - 2 * 86400) ? trace(hex, day, NOW - 2 * 86400, [40.7772, -73.8726], [26.0726, -80.1527]) : null;
      return route.fulfill(body ? { status: 200, contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } } : { status: 404, body: '', headers: { 'access-control-allow-origin': '*' } });
    }
    if (/^https:\/\/www\.flightradar24\.com\/data\/(flights|playback|aircraft)/.test(u)) { tabs.push(u); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>FR24</title>' }); }
    return route.fulfill({ status: 404, body: '' });
  });
  await ctx.addInitScript(src => { window.__SRC = src; }, SRC);
  await ctx.addInitScript({ content: STUBS + '\n;(function (go) { if (document.documentElement) return go(); const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); go(); } }); mo.observe(document, { childList: true }); })(function () { (0, eval)(window.__SRC); });' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  const nowS = Math.floor(Date.now() / 1000), pid = 0x41cd0a3d, T = nowS - 1800, t0 = nowS - 2 * 86400;
  // the map, with what the script knows: M-ARNZ (VSB82, blocked, off Fort Lauderdale half an hour ago) open in the
  // panel; LaGuardia's board with its row, N600EB's kept departure and an ordinary kept row; the search's results
  async function fresh() {
    await page.goto(MAP);
    await page.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
    return page.evaluate(({ pid, T, t0 }) => {
      const B = window.__tweeksLaddBridge, H = window.__H;
      // (FR24's router, as its Inertia app has it: the pages it is given recorded)
      const gp = document.getElementById('app').__vue_app__.config.globalProperties; window.__visits = [];
      gp.$page = { component: 'MapPage', url: location.pathname, props: { errors: {}, name: 'Flightradar24', route: { name: 'web.map', params: {}, query: [] }, host: 'www.flightradar24.com', locale: 'en', dispatcher: {}, features: {} } };
      gp.$inertia = { push: v => window.__visits.push({ how: 'push', url: v.url, comp: v.component, n: (v.props.trail || []).length, cs: v.props.callsign, reg: v.props.aircraft && v.props.aircraft.registration, lock: v.props.playbackLock, src: v.props.trailSource }), replace: v => window.__visits.push({ how: 'replace', url: v.url, comp: v.component }) };
      B.resolved.set(pid, { cs: 'VSB82', reg: 'M-ARNZ', hex: '424c60', hexNum: 0x424c60, type: 'PC24', photos: [] });
      B.routes.set(pid, { originId: 3500, originIata: 'FLL', atd: T, destId: 3901 });
      B.lastPos.set(pid, { lat: 33.1, lon: -78.2, alt: 41000, at: Date.now() });
      H.setCurFollow(pid);
      H.acceptBoardArch({ apId: 3901, arr: [], dep: [
        { k: 'n600eb-13', t: t0, t2: t0 + 3600, hex: 'a80b2e', reg: 'N600EB', cs: 'N600EB', src: 'log', blk: 1, ap: 3500 },
        { k: 'fr898-13', t: t0 + 600, hex: '4ca7b5', reg: 'EI-DAC', cs: 'RYR898', num: 'FR898', src: 'fr24', id: 5869000001, fid: '3c000001', ap: 3501 }] });
      const j = { data: [] }; H.addArch(j, 3901, 'departures');
      const ids = j.data.map(e => e.id);
      window.__S.rows = [{ id: 9000000000 + pid, cs: 'VSB82', reg: 'M-ARNZ' }, { id: ids[0], cs: 'N600EB', reg: 'N600EB' }, { id: ids[1], cs: 'RYR898', reg: 'EI-DAC' }];
      window.__S.search = [{ k: 'live:' + pid.toString(16), l: 'VSB82' }, { k: 'aircraft:g-ezbx', l: 'G-EZBX' }];
      return ids;
    }, { pid, T, t0 });
  }
  const went = () => page.evaluate(() => window.__S.went.slice());
  const visits = () => page.evaluate(() => window.__visits.slice());
  // a click, and - once the userscript has answered - FR24's router's pages, where the tab is, any other tab opened
  async function clickPb(sel, opts) {
    tabs.length = 0;
    const popP = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
    await page.click(sel, opts);
    let v = []; for (let i = 0; i < 40; i++) { await sleep(250); if (page.url() !== MAP) break; v = await visits().catch(() => []); if (v.length || (await went().catch(() => [])).length) break; }
    const pop = await popP.then(x => x).catch(() => null); let popUrl = ''; if (pop) { await pop.waitForLoadState().catch(() => {}); popUrl = pop.url(); await pop.close(); }
    const here = page.url();
    return { v, here, w: here === MAP ? await went() : [], pop: popUrl, apl: tabs.filter(u => /airplanes\.live/.test(u)).length };
  }
  const logAt = (reg, id) => 'https://www.flightradar24.com/data/aircraft/' + reg + '#' + id;

  let ids = await fresh();
  // ---- the bar's Playback: FR24's playback window
  { await page.click('nav.bar [data-testid="map-bar__playback"]'); await sleep(700);
    const st = await page.evaluate(() => ({ pbw: window.__S.pbw, went: window.__S.went.slice(), v: window.__visits.length }));
    check('the bottom bar\'s Playback with a LADD flight open: FR24\'s playback window opens, nothing else', st.pbw && !st.went.length && !st.v && page.url() === MAP, st); }
  // ---- the panel's Playback
  ids = await fresh();
  { const r = await clickPb('#pPanel span');
    check('the panel\'s Playback of the blocked flight: its aircraft\'s page at that flight, in this tab - where FR24 plays it in place; no playback page, nothing opened elsewhere', r.here === logAt('m-arnz', syn('424c60', T)) && !r.v.length && !r.pop && !r.apl, r); }
  // ---- board cards
  ids = await fresh();
  { const r = await clickPb(`#pRow${9000000000 + pid}`);
    check('a board card\'s Playback of the flight followed here: the same flight', r.here === logAt('m-arnz', syn('424c60', T)), r); }
  ids = await fresh();
  { const r = await clickPb(`#pRow${ids[0]} svg`);
    check('N600EB\'s kept row from two days back (Aircraft info / Bookmark aircraft / Playback): that flight on its aircraft\'s page', r.here === logAt('n600eb', syn('a80b2e', t0)) && !r.apl, r); }
  ids = await fresh();
  { const r = await clickPb(`#pRow${ids[1]}`);
    check('an ordinary flight\'s kept row: FR24\'s own Playback (its log page), not ours', !r.v.length && r.w.join() === 'log:' + ids[1], r); }
  // ---- search results
  { const r = await clickPb('#pSr1');
    check('a search result of an ordinary aircraft: FR24\'s own', !r.v.length && r.w[r.w.length - 1] === 'log:aircraft:g-ezbx', r); }
  ids = await fresh();
  { const r = await clickPb('#pSr0 span');
    check('a search result of the blocked flight: that flight', r.here === logAt('m-arnz', syn('424c60', T)), r); }
  // ---- a middle click: a new tab
  ids = await fresh();
  { const r = await clickPb(`#pRow${ids[0]}`, { button: 'middle' });
    check('a middle click: the aircraft\'s page at that flight in a new tab, this one left as it was', r.pop === logAt('n600eb', syn('a80b2e', t0)) && r.here === MAP && !r.v.length, r); }
  check('no page errors', !errors.length, errors);
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
