// "Playback" in a real browser: the BUILT userscript in Chromium (Playwright's) on the Vue 3 page made like FR24's map
// (test/fixtures/fr24mock.html ?pb=1), whose own Playback actions - the panel's, a board card's, a search result's -
// go to the flight's log page, as FR24's do for a flight it has no record of, and whose bottom bar's Playback opens its
// playback window. Clicked with the mouse:
//   - the bar's Playback with a LADD flight open in the panel: FR24's playback window, nothing else
//   - the panel's Playback, a board card's (a flight followed here, N600EB's kept row from two days back), a search
//     result's of a blocked flight: FR24's map playback of the flight, in the same tab, three minutes before its
//     take-off over the field it left; and on that page the flight selected in FR24's playback once it is on the map
//   - a board card's and a search result's of an ordinary flight: FR24's own (the log page)
//   - a middle click: the same playback in a new tab
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
const STUBS = `
window.GM_info = { scriptHandler: 'Tampermonkey', version: '5.3' };
window.unsafeWindow = window; window.GM_notification = () => {};
window.GM_xmlhttpRequest = o => { setTimeout(() => o.onload && o.onload({ status: 404, responseText: '', response: '' }), 2); return { abort() {} }; };
window.__tlTestHook = h => { window.__H = h; };
`;
const MAP = 'https://www.flightradar24.com/40.70,-73.90/9?mode=keyed&pb=1';
const PBURL = /^https:\/\/www\.flightradar24\.com\/\d{4}-\d\d-\d\d\/\d\d:\d\d\/1x\/[-0-9.]+,[-0-9.]+\/\d+$/;
const ymd = t => new Date(t * 1000).toISOString().slice(0, 10), hm = t => new Date(t * 1000).toISOString().slice(11, 16);
const pbu = (t, lat, lon, z) => `https://www.flightradar24.com/${ymd(t)}/${hm(t)}/1x/${lat.toFixed(2)},${lon.toFixed(2)}/${z}`;

(async () => {
  const browser = await chromium.launch({ executablePath: exe || undefined, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('/__vue.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    if (/^https:\/\/www\.flightradar24\.com\/([0-9.,-]+\/\d+|\d{4}-\d\d-\d\d\/)/.test(u)) return route.fulfill({ status: 200, contentType: 'text/html', body: MOCK });
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
  const U_PID = pbu(T - 180, 26.0726, -80.1527, 10), U_N600 = pbu(t0 - 180, 40.7772, -73.8726, 10);
  const went = () => page.evaluate(() => window.__S.went.slice());
  // a click, and the address the tab is at once it has settled
  async function clickAndWhere(sel, opts) { await page.click(sel, opts); await sleep(700); return page.url(); }

  let ids = await fresh();
  // ---- the bar's Playback: FR24's playback window
  { const at = await clickAndWhere('nav.bar [data-testid="map-bar__playback"]');
    const st = await page.evaluate(() => ({ pbw: window.__S.pbw, went: window.__S.went.slice() }));
    check('the bottom bar\'s Playback with a LADD flight open: FR24\'s playback window opens, the map stays where it was', st.pbw && !st.went.length && at === MAP, { st, at }); }
  // ---- the panel's Playback
  { const at = await clickAndWhere('#pPanel span');
    check('the panel\'s Playback of the blocked flight: FR24\'s map playback in this tab, three minutes before its take-off, over Fort Lauderdale', at === U_PID, { at, U_PID });
    await page.waitForFunction(() => !!window.__H, null, { timeout: 15000 });
    const sel = await page.evaluate(() => ({ pend: window.__H.pbPend(), kept: localStorage.getItem('tl.pbSel'), active: window.__PB.active }));
    check('... that page takes the flight to select (and it is not kept for another)', !!sel.pend && sel.pend.id === pid && sel.pend.hex === '424c60' && sel.kept === null && sel.active, sel);
    // (the flight comes onto the playback map: selected as a click on it would)
    await page.evaluate(pid => { window.__tweeksLaddBridge.resolved.set(pid, { cs: 'VSB82', reg: 'M-ARNZ', hex: '424c60' }); window.__H.pbPos.set(pid, { lat: 26.1, lon: -80.1, at: Date.now() }); }, pid);
    await sleep(1200);
    const calls = await page.evaluate(() => window.__PB.calls.slice());
    check('... and once it is on the playback map, it is selected there', calls.length === 1 && calls[0] === pid, calls); }
  // ---- board cards
  ids = await fresh();
  { const at = await clickAndWhere(`#pRow${9000000000 + pid}`);
    check('a board card\'s Playback of the flight followed here: the same playback', at === U_PID, at); }
  ids = await fresh();
  { const at = await clickAndWhere(`#pRow${ids[0]} svg`);
    check('N600EB\'s kept row from two days back (Aircraft info / Bookmark aircraft / Playback): its take-off from LaGuardia', at === U_N600, { at, U_N600 }); }
  ids = await fresh();
  { const at = await clickAndWhere(`#pRow${ids[1]}`), w = await went();
    check('an ordinary flight\'s kept row: FR24\'s own Playback (its log page), not ours', at === MAP && w.join() === 'log:' + ids[1], { at, w }); }
  // ---- search results
  { const at = await clickAndWhere('#pSr1'), w = await went();
    check('a search result of an ordinary aircraft: FR24\'s own', at === MAP && w[w.length - 1] === 'log:aircraft:g-ezbx', { at, w }); }
  { const at = await clickAndWhere('#pSr0 span');
    check('a search result of the blocked flight: its playback', at === U_PID, at); }
  // ---- a middle click: a new tab
  ids = await fresh();
  { const popP = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await page.click(`#pRow${ids[0]}`, { button: 'middle' });
    const pop = await popP; if (pop) await pop.waitForLoadState().catch(() => {});
    await sleep(300);
    check('a middle click: the same playback in a new tab, this one left as it was', !!pop && pop.url() === U_N600 && page.url() === MAP, { pop: pop && pop.url(), at: page.url() });
    if (pop) await pop.close(); }
  check('no page errors', !errors.length, errors);
  check('all the addresses are FR24\'s map playback\'s', PBURL.test(U_PID) && PBURL.test(U_N600));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
