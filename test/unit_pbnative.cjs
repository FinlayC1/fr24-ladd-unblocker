// "Playback" in a real browser: the BUILT userscript in Chromium (Playwright's) on the Vue 3 page made like FR24's map
// (test/fixtures/fr24mock.html ?pb=1), whose own Playback actions - the panel's, a board card's, a search result's -
// go to the flight's log page, as FR24's do for a flight it has no record of, and whose bottom bar's Playback opens its
// playback window. Clicked with the mouse:
//   - the bar's Playback with a LADD flight open in the panel: FR24's playback window, nothing else
//   - the panel's Playback, a board card's (a flight followed here, N600EB's kept row from two days back), a search
//     result's of a blocked flight: the flight's track on airplanes.live, in a new tab; this tab left as it was
//   - a board card's and a search result's of an ordinary flight: FR24's own (the log page)
//   - a middle click: the same track in a new tab
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
const ymd = t => new Date(t * 1000).toISOString().slice(0, 10), hm = t => new Date(t * 1000).toISOString().slice(11, 16);
// (airplanes.live's track address: five minutes before t0 to five minutes after t1, ten minutes at least; the end minute may be a minute out)
const okT = (u, hex, t0, t1) => { try { const x = new URL(u), q = x.searchParams, from = t0 - 300, to = Math.max(t1, t0 + 600) + 300; return x.host === 'globe.airplanes.live' && q.get('icao') === hex && q.get('showTrace') === ymd(from) && q.get('startTime') === hm(from) && [0, -60, 60].some(d => q.get('endTime') === hm(to + d) || (ymd(to + d) !== ymd(from) && q.get('endTime') === '23:59')); } catch (e) { return false; } };

(async () => {
  const browser = await chromium.launch({ executablePath: exe || undefined, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const errors = [], tabs = [];
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('/__vue.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    if (/^https:\/\/www\.flightradar24\.com\/([0-9.,-]+\/\d+|\d{4}-\d\d-\d\d\/)/.test(u)) return route.fulfill({ status: 200, contentType: 'text/html', body: MOCK });
    if (/^https:\/\/globe\.airplanes\.live\//.test(u)) { if (/[?&]icao=/.test(u)) tabs.push(u); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>airplanes.live</title>' }); }
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
  const went = () => page.evaluate(() => window.__S.went.slice());
  // a click, and the address the tab is at once it has settled
  async function clickAndWhere(sel, opts) { await page.click(sel, opts); await sleep(700); return page.url(); }
  // a click that opens a new tab: the address it opens, and where this one is
  async function clickForTab(sel, opts) {
    tabs.length = 0;
    const popP = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
    await page.click(sel, opts);
    const pop = await popP; if (pop) await pop.waitForLoadState().catch(() => {});
    await sleep(300);
    const r = { tab: tabs.length === 1 ? tabs[0] : '', n: tabs.length, here: page.url() }; if (pop) await pop.close();
    return r;
  }

  let ids = await fresh();
  // ---- the bar's Playback: FR24's playback window
  { const at = await clickAndWhere('nav.bar [data-testid="map-bar__playback"]');
    const st = await page.evaluate(() => ({ pbw: window.__S.pbw, went: window.__S.went.slice() }));
    check('the bottom bar\'s Playback with a LADD flight open: FR24\'s playback window opens, the map stays where it was', st.pbw && !st.went.length && at === MAP, { st, at }); }
  // ---- the panel's Playback
  ids = await fresh();
  { const r = await clickForTab('#pPanel span'), w = await went();
    check('the panel\'s Playback of the blocked flight: its track on airplanes.live in a new tab, this one left as it was', okT(r.tab, '424c60', T, nowS) && r.here === MAP && !w.length, { r, w }); }
  // ---- board cards
  ids = await fresh();
  { const r = await clickForTab(`#pRow${9000000000 + pid}`);
    check('a board card\'s Playback of the flight followed here: the same track', okT(r.tab, '424c60', T, nowS) && r.here === MAP, r); }
  ids = await fresh();
  { const r = await clickForTab(`#pRow${ids[0]} svg`);
    check('N600EB\'s kept row from two days back (Aircraft info / Bookmark aircraft / Playback): its track from take-off to landing', okT(r.tab, 'a80b2e', t0, t0 + 3600) && r.here === MAP, r); }
  ids = await fresh();
  { const at = await clickAndWhere(`#pRow${ids[1]}`), w = await went();
    check('an ordinary flight\'s kept row: FR24\'s own Playback (its log page), not ours', at === MAP && w.join() === 'log:' + ids[1], { at, w }); }
  // ---- search results
  { const at = await clickAndWhere('#pSr1'), w = await went();
    check('a search result of an ordinary aircraft: FR24\'s own', at === MAP && w[w.length - 1] === 'log:aircraft:g-ezbx', { at, w }); }
  { const r = await clickForTab('#pSr0 span');
    check('a search result of the blocked flight: its track', okT(r.tab, '424c60', T, nowS) && r.here === MAP, r); }
  // ---- a middle click: a new tab
  ids = await fresh();
  { const r = await clickForTab(`#pRow${ids[0]}`, { button: 'middle' });
    check('a middle click: the same track in a new tab, this one left as it was', okT(r.tab, 'a80b2e', t0, t0 + 3600) && r.here === MAP, r); }
  check('no page errors', !errors.length, errors);
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
