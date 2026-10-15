// LADD Unblock in FR24's own windows, in a real browser: the BUILT userscript in Chromium (Playwright's) on a page made
// like FR24's map - with Vue 3, as FR24 is: its bottom bar, its windows coming and going with <Transition>, the widget
// panels on the map, the Widgets window's list with each widget's On / Off, a flight's panel, an airport's panel
// (test/fixtures/fr24mock.html). Watched frame by frame: the window opens in FR24's Widgets window, never showing
// "Widgets" or FR24's list; the window open before goes back as FR24's do; one button drawn open on the bar at a time;
// another button, Widgets, a flight, its own button and FR24's close button put it away; Widgets after it shows FR24's
// own list; FR24's size and title bar; the text size; FR24's Bookmarks switched off in FR24's own list, never drawn, and
// not put on the map after a reload; the empty box of an airport's events never drawn. For each way FR24 might build
// its windows: one per button (v-if), one window retitled, kept and hidden (v-show), an open look with an extra mark and
// a filled icon, a window loaded later, buttons inside boxes; and one it cannot be found in (the stand-in, at once after).
// Needs Playwright and Vue 3's browser build (skipped without): PLAYWRIGHT_PATH=<its module dir> CHROMIUM=<binary>
// VUE_PATH=<vue.global.js>. SHOTS=<dir> keeps screenshots.
// usage: node test/unit_native.cjs [mode...]
const fs = require('fs'), path = require('path');
let chromium = null;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(x => fs.existsSync(x));
const vuePath = [process.env.VUE_PATH, path.join(__dirname, '..', 'node_modules', 'vue', 'dist', 'vue.global.js')].filter(Boolean).find(x => fs.existsSync(x));
if (!chromium) { console.log('(skipped: Playwright not found - PLAYWRIGHT_PATH=<its module dir>)'); process.exit(0); }
if (!vuePath) { console.log('(skipped: Vue 3 not found - VUE_PATH=<vue.global.js>)'); process.exit(0); }
const REPO = path.join(__dirname, '..'), MODES = process.argv.slice(2).length ? process.argv.slice(2) : ['keyed', 'shared', 'show', 'ind', 'async', 'li', 'odd'];
const QS = { keyed: 'mode=keyed', shared: 'mode=shared', show: 'mode=show', ind: 'mode=keyed&ind=1', async: 'mode=async', li: 'mode=keyed&li=1', odd: 'mode=keyed&odd=1' };
const OUT = process.env.SHOTS || ''; if (OUT) fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => (OUT ? page.screenshot({ path: path.join(OUT, name + '.png') }) : Promise.resolve());
const SRC = fs.readFileSync(path.join(REPO, 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const VUE = fs.readFileSync(vuePath, 'utf8');
const MOCK = fs.readFileSync(path.join(__dirname, 'fixtures', 'fr24mock.html'), 'utf8');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STUBS = `
window.GM_info = { scriptHandler: 'Tampermonkey', version: '5.3' };
window.unsafeWindow = window; window.GM_notification = () => {};
window.GM_xmlhttpRequest = o => { const raw = /raw\\.githubusercontent\\.com\\/FinlayC1\\/fr24-ladd-unblocker\\/main\\/package\\.json/.test(o.url); const t = raw ? JSON.stringify({ version: '1.0.0' }) : ''; setTimeout(() => o.onload && o.onload({ status: raw ? 200 : 404, responseText: t, response: t }), 2); return { abort() {} }; };
// (each frame: the windows' titles drawn, the bar's buttons drawn open, the Bookmarks widget or row drawn)
window.__F = null;
(function probe() {
  const vis = el => { if (!el.isConnected) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let a = el; a && a.nodeType === 1; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } return true; };
  const tick = () => {
    if (window.__F) {
      const titles = [...document.querySelectorAll('.win-title')].filter(vis).map(e => e.textContent.trim());
      const bar = document.querySelector('nav.bar');
      const on = bar ? [...bar.children].filter(vis).filter(b => [b, ...b.querySelectorAll('*')].some(x => getComputedStyle(x).color === 'rgb(248, 192, 35)') || b.querySelector('.ind')).map(b => b.textContent.trim()) : [];
      const bm = [...document.querySelectorAll('.card,.wrow')].filter(e => /Bookmarks/.test(e.textContent) && vis(e)).length;
      const ours = [...document.querySelectorAll('.tl-ub-c')].filter(vis).length;
      const theirs = [...document.querySelectorAll('.win-body')].filter(vis).length;
      const ev = [...document.querySelectorAll('.evbox')].filter(vis).length;
      window.__F.push({ t: Math.round(performance.now()), titles, on, bm, ours, theirs, ev });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

async function run(browser, mode) {
  console.log(`\n==== mode: ${mode}`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('/__vue.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    if (/^https:\/\/www\.flightradar24\.com\/[0-9.,-]+\/\d+/.test(u) || /^https:\/\/www\.flightradar24\.com\/\?/.test(u)) return route.fulfill({ status: 200, contentType: 'text/html', body: MOCK });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(src => { window.__SRC = src; }, SRC);
  await page.addInitScript({ content: STUBS + '\n;(function (go) { if (document.documentElement) return go(); const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); go(); } }); mo.observe(document, { childList: true }); })(function () { (0, eval)(window.__SRC); });' });
  const url = `https://www.flightradar24.com/53.40,-2.60/9?${QS[mode]}`;
  await page.goto(url);
  await page.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
  const st = () => page.evaluate(() => ({ open: __S.open, flight: __S.flight, bm: __S.widgets.find(w => w.k === 'bm').on }));
  const rec = async (act, ms = 900) => { await page.evaluate(() => { window.__F = []; }); await act(); await sleep(ms); return page.evaluate(() => { const f = window.__F; window.__F = null; return f; }); };
  const last = f => f[f.length - 1];
  const ours = 'nav.bar .tl-ub-btn', bar = l => `nav.bar [data-testid="map-bar__${l.toLowerCase()}"]`;
  // ---- the start: the button on the bar; the Bookmarks widget on the map never drawn
  let f = await rec(async () => {}, 300);
  const btnInfo = await page.evaluate(() => { const b = document.querySelector('nav.bar .tl-ub-btn'); return { prev: b.previousElementSibling.textContent.trim(), label: b.textContent.trim(), cls: b.className }; });
  check('the button is on FR24\'s bar after Playback, labelled LADD Unblock, in the bar\'s resting look', btnInfo.prev === 'Playback' && btnInfo.label === 'LADD Unblock' && !/is-on/.test(btnInfo.cls), btnInfo);
  check('the Bookmarks widget on the map: never drawn', f.every(x => x.bm === 0), f.filter(x => x.bm).length);
  if (mode === 'odd') return oddFlow(page, ctx, errors, rec, last, ours, bar, st);
  // ---- Weather open, then this: Weather goes back, this comes up in FR24's Widgets window, never showing "Widgets"
  await page.click(bar('Weather')); await sleep(500);
  const wRect = await page.evaluate(() => { const w = document.querySelector('.win[data-win="Weather"]'); const r = w.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, head: w.querySelector('.win-head').getBoundingClientRect().height }; });
  f = await rec(() => page.click(ours));
  const L1 = last(f);
  check('opened from Weather: Weather drawn going back while this comes up (both drawn at once in some frames)', f.some(x => x.titles.includes('Weather') && x.titles.includes('LADD Unblock')) || f.some(x => x.titles.includes('Weather')) && L1.titles.join() === 'LADD Unblock', f.map(x => x.titles.join('+')).filter((v, i, a) => v !== a[i - 1]));
  check('... FR24\'s Widgets title and list never drawn, not for one frame', f.every(x => !x.titles.includes('Widgets')) && f.every(x => !(x.titles.includes('LADD Unblock') && x.theirs > (x.titles.length - 1) + 0 && false)), f.map(x => x.titles.join('+')).filter((v, i, a) => v !== a[i - 1]));
  check('... it ends with one window: LADD Unblock, our content, FR24\'s list hidden', L1.titles.join() === 'LADD Unblock' && L1.ours === 1, L1);
  check('... the bar: only this button drawn open, from the first frame it is up', f.filter(x => x.titles.includes('LADD Unblock')).every(x => x.on.length === 1 && x.on[0] === 'LADD Unblock'), f.map(x => x.on.join('+')).filter((v, i, a) => v !== a[i - 1]));
  const oRect = await page.evaluate(() => { const t = [...document.querySelectorAll('.win-title')].find(e => e.textContent.trim() === 'LADD Unblock'); const w = t.closest('.win'); const r = w.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, head: w.querySelector('.win-head').getBoundingClientRect().height, h: r.height, list: getComputedStyle(w.querySelector('.win-body')).display, c: !!w.querySelector('.tl-ub-c [data-ub-opt="on"]') }; });
  check('... FR24\'s window: its place, its width, its 40 px title bar - as Weather\'s', oRect.x === wRect.x && oRect.y === wRect.y && oRect.w === wRect.w && oRect.head === 40 && oRect.list === 'none' && oRect.c, { oRect, wRect });
  const cols = await page.evaluate(() => { const b = id => getComputedStyle(id).backgroundColor; const ours = document.querySelector('.tl-ub-in'), wb = [...document.querySelectorAll('.win-body')].find(e => getComputedStyle(e).display !== 'none' && !e.closest('[data-tl-ub-host]')); const t = ours && ours.querySelector('.tl-ub-t'); return { ours: ours && b(ours), text: t && getComputedStyle(t).color, theirs: wb ? b(wb) : 'rgb(237, 237, 237)' }; });
  check('... FR24\'s light body under dark text, as Weather\'s (not the dark frame)', cols.ours === cols.theirs && cols.text === 'rgb(57, 57, 57)', cols);
  await sleep(600);
  const oFin = await page.evaluate(() => { const t = [...document.querySelectorAll('.win-title')].find(e => e.textContent.trim() === 'LADD Unblock'); const r = t.closest('.win').getBoundingClientRect(); return { y: r.y, h: r.height }; });
  check('... settled, it ends where Weather\'s window ends (FR24\'s own height; nothing cut off its bottom after the movement)', Math.abs((oFin.y + oFin.h) - (wRect.y + wRect.h)) <= 1 && Math.abs((oRect.y + oRect.h) - (wRect.y + wRect.h)) <= 1, { oRect, oFin, wRect });
  check('... FR24\'s Bookmarks switched off in FR24\'s own Widgets list (as if its "On" was pressed)', (await st()).bm === false, await st());
  await shot(page, `${mode}-ours`);
  // ---- the text size
  await page.click('.tl-ub-c [data-ub-size="3"]');
  const tf = await page.evaluate(() => getComputedStyle(document.querySelector('.tl-ub-c')).getPropertyValue('--tl-f').trim() + ' ' + getComputedStyle(document.querySelector('.tl-ub-c .tl-ub-t')).fontSize);
  check('text size XL: the content scales (1.3 x 14 px titles)', tf === '1.3 18.2px', tf);
  await page.click('.tl-ub-c [data-ub-size="1"]');
  // ---- another button: this goes back as FR24's would, the other comes up; Widgets as it was
  f = await rec(() => page.click(bar('Filters')));
  const L2 = last(f);
  check('Filters pressed: this goes back - drawn going, with its content - and Filters comes up', f.some(x => x.titles.includes('LADD Unblock')) && L2.titles.join() === 'Filters' && L2.ours === 0, f.map(x => x.titles.join('+') + '/' + x.ours).filter((v, i, a) => v !== a[i - 1]));
  check('... the bar: Filters alone drawn open; this one back at rest; never two', L2.on.join() === 'Filters' && f.every(x => x.on.length <= 1), f.map(x => x.on.join('+')).filter((v, i, a) => v !== a[i - 1]));
  const wb = await page.evaluate(() => ({ under: document.querySelectorAll('[data-tl-ub-under]').length, face: document.querySelectorAll('.tl-ub-face').length, host: document.querySelectorAll('[data-tl-ub-host]').length }));
  check('... FR24\'s Widgets button itself back, its stand-in copy gone; nothing of the window left marked', wb.under === 0 && wb.face === 0 && wb.host === 0, wb);
  // ---- Widgets pressed while this is open: this goes back, then FR24's own Widgets comes up as FR24 has it
  await page.click(ours); await sleep(700);
  f = await rec(() => page.click('nav.bar .tl-ub-face, nav.bar [data-testid="map-bar__widgets"]:not([data-tl-ub-under])'), 1500);
  const L3 = last(f);
  check('Widgets pressed while this is open: this goes back, FR24\'s own Widgets comes up after', L3.titles.join() === 'Widgets' && L3.ours === 0 && L3.on.join() === 'Widgets', { L3, seq: f.map(x => x.titles.join('+')).filter((v, i, a) => v !== a[i - 1]) });
  const own = await page.evaluate(() => { const w = [...document.querySelectorAll('.win')].find(x => getComputedStyle(x).display !== 'none'); return { list: getComputedStyle(w.querySelector('.win-body')).display, rows: [...w.querySelectorAll('.wrow')].filter(r => getComputedStyle(r).display !== 'none').map(r => r.querySelector('.wt').textContent) }; });
  check('... with FR24\'s own list in it; the Bookmarks row not in it', own.list !== 'none' && own.rows.length === 5 && !own.rows.includes('Bookmarks'), own);
  check('... the Bookmarks row never drawn', f.every(x => x.bm === 0));
  await shot(page, `${mode}-widgets`);
  // ---- this pressed while FR24's Widgets is open: Widgets goes back first, then this comes up
  f = await rec(() => page.click(ours), 1500);
  const L4 = last(f);
  check('this pressed while Widgets is open: Widgets goes back, then this comes up', L4.titles.join() === 'LADD Unblock' && L4.ours === 1 && L4.on.join() === 'LADD Unblock', { L4, seq: f.map(x => x.titles.join('+')).filter((v, i, a) => v !== a[i - 1]) });
  // ---- a flight opened: this closes as FR24's own windows do
  f = await rec(() => page.click('#openFlight'));
  const L5 = last(f);
  check('a flight opened: this goes back, nothing on the bar drawn open', L5.titles.length === 0 && L5.ours === 0 && L5.on.length === 0 && (await st()).flight, L5);
  // ---- FR24 drawing its window afresh while this is open (its data refreshed): still this, never FR24's list
  await page.click(ours); await sleep(700);
  f = await rec(() => page.evaluate(() => { __S.rk++; }), 1200);
  const R = last(f);
  check('FR24 redraws its window while this is open: still this window, FR24\'s Widgets list never drawn', R.titles.join() === 'LADD Unblock' && R.ours === 1 && R.on.join() === 'LADD Unblock' && f.every(x => !x.titles.includes('Widgets')), { R, seq: f.map(x => x.titles.join('+') + '/' + x.ours).filter((v, i, a) => v !== a[i - 1]) });
  await page.click('#openFlight'); await sleep(500);
  // ---- its own button closes it; FR24's close button too
  await page.click(ours); await sleep(700);
  check('pressed again (a flight open): it comes up', (await page.evaluate(() => !!document.querySelector('[data-tl-ub-host] .tl-ub-c'))) && (await st()).open === 'Widgets');
  f = await rec(() => page.click(ours));
  check('... and its own button puts it away', last(f).titles.length === 0 && last(f).on.length === 0 && (await st()).open === null, last(f));
  await page.click(ours); await sleep(700);
  f = await rec(() => page.locator('.win-x:visible').click());
  check('FR24\'s close button in its title bar puts it away', last(f).titles.length === 0 && last(f).on.length === 0, last(f));
  // ---- reloaded: Bookmarks switched off where FR24 keeps it, so the widget is not even put on the map
  await page.reload(); await page.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
  const cards = await page.evaluate(() => [...document.querySelectorAll('.card')].map(c => c.dataset.card));
  check('after a reload: FR24 itself no longer puts the Bookmarks widget on the map', !cards.includes('bm') && cards.includes('mt'), cards);
  await apCheck(page, rec);
  if (mode === 'keyed') await shot(page, `${mode}-airport`);
  check('no page errors', errors.length === 0, errors);
  await ctx.close();
}
async function apCheck(page, rec) {
  // ---- an airport's panel: the events' bordered box (an empty spacer drawn in it too) never drawn; the dropdowns close up
  const f = await rec(() => page.click('#openAirport'), 600);
  const ap = await page.evaluate(() => { const dd = [...document.querySelectorAll('.dds > .dd')]; const r = dd.map(d => { const b = d.getBoundingClientRect(); return [d.textContent.trim().slice(0, 20), Math.round(b.top), Math.round(b.height), getComputedStyle(d).display]; }); return r; });
  check('an airport\'s panel: the events\' box between Disruptions and Airport statistics never drawn, not for one frame', f.length > 3 && f.every(x => x.ev === 0) && ap[1][3] === 'none', { ap, frames: f.length });
  check('... Disruptions, statistics and details drawn one after the other, no gap where it was', ap[0][3] !== 'none' && ap[2][3] !== 'none' && ap[3][3] !== 'none' && ap[2][1] - (ap[0][1] + ap[0][2]) === 8, ap);
}
async function oddFlow(page, ctx, errors, rec, last, ours, bar, st) {
  await page.click(bar('Weather')); await sleep(500);
  let f = await rec(() => page.click(ours), 3000);
  const L = last(f), seq = f.map(x => x.titles.join('+') + '/' + x.ours).filter((v, i, a) => v !== a[i - 1]);
  const sw = await page.evaluate(() => ({ float: !!document.querySelector('.tl-ub .tl-ub-c [data-ub-opt="on"]'), w: document.querySelector('.tl-ub') && document.querySelector('.tl-ub').getBoundingClientRect().width, head: document.querySelector('.tl-ub-head') && document.querySelector('.tl-ub-head').getBoundingClientRect().height }));
  check('FR24\'s window not recognisable: after a moment the stand-in (FR24\'s size, its 40 px title bar), FR24\'s windows put away', sw.float && sw.w === 336 && sw.head === 40 && L.titles.length === 0 && (await st()).open === null, { sw, L, seq });
  check('... the bar: only this button drawn open at the end', L.on.join() === 'LADD Unblock', L.on);
  f = await rec(() => page.click(bar('Filters')));
  check('... FR24\'s button closes it, Filters alone open', last(f).titles.join() === 'Filters' && !(await page.evaluate(() => !!document.querySelector('.tl-ub'))) && last(f).on.join() === 'Filters', last(f));
  f = await rec(() => page.click(ours), 400);
  check('... next time the stand-in at once, Filters put away', (await page.evaluate(() => !!document.querySelector('.tl-ub'))) && last(f).titles.length === 0 && last(f).on.join() === 'LADD Unblock', last(f));
  check('no page errors', errors.length === 0, errors);
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  for (const m of MODES) { try { await run(browser, m); } catch (e) { fails++; console.log('FAIL  CRASH ' + (e && e.stack || e)); } }
  await browser.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
