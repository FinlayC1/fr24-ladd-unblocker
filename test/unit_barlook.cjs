// The bottom bar's windows and the LADD Unblock button as FR24's own, in a real browser: the BUILT userscript in Chromium
// on the Vue page made like FR24's map (test/fixtures/fr24mock.html, Google's map under it - ?gm=1 - and the bar's icons
// drawn thicker under the mouse and yellow open - ?look=1).
//   - a click on the map puts away the window open - FR24's own (Weather) and LADD Unblock - as its X does; a drag of the
//     map, a click in the window, and FR24's playback do not
//   - LADD Unblock's switches slide across as they are turned (the same element, part-way across mid-turn)
//   - its icon drawn as FR24's: thicker and lighter under the mouse, thicker and yellow open, as FR24's icons are
//   - a tooltip being read stays up while the part of the page it is in is updated
// Needs Playwright and Vue 3's browser build (skipped without): PLAYWRIGHT_PATH=<its module dir> CHROMIUM=<binary>
// VUE_PATH=<vue.global.js>.
// usage: node test/unit_barlook.cjs
const fs = require('fs'), path = require('path');
let chromium = null;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(x => fs.existsSync(x));
const vuePath = [process.env.VUE_PATH, path.join(__dirname, '..', 'node_modules', 'vue', 'dist', 'vue.global.js')].filter(Boolean).find(x => fs.existsSync(x));
if (!chromium) { console.log('(skipped: Playwright not found - PLAYWRIGHT_PATH=<its module dir>)'); process.exit(0); }
if (!vuePath) { console.log('(skipped: Vue 3 not found - VUE_PATH=<vue.global.js>)'); process.exit(0); }
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const VUE = fs.readFileSync(vuePath, 'utf8');
const MOCK = fs.readFileSync(path.join(__dirname, 'fixtures', 'fr24mock.html'), 'utf8');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STUBS = `
window.GM_info = { scriptHandler: 'Tampermonkey', version: '5.3' };
window.unsafeWindow = window; window.GM_notification = () => {};
window.GM_xmlhttpRequest = o => { setTimeout(() => o.onload && o.onload({ status: 404, responseText: '', response: '' }), 2); return { abort() {} }; };
`;

(async () => {
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('/__vue.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    if (/^https:\/\/www\.flightradar24\.com\/[0-9.,-]+\/\d+/.test(u)) return route.fulfill({ status: 200, contentType: 'text/html', body: MOCK });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(src => { window.__SRC = src; }, SRC);
  await page.addInitScript({ content: STUBS + '\n;(function (go) { if (document.documentElement) return go(); const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); go(); } }); mo.observe(document, { childList: true }); })(function () { (0, eval)(window.__SRC); });' });
  try {
    await page.goto('https://www.flightradar24.com/53.40,-2.60/9?mode=keyed&gm=1&look=1');
    await page.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
    const ours = 'nav.bar .tl-ub-btn', bar = l => `nav.bar [data-testid="map-bar__${l.toLowerCase()}"]`;
    const st = () => page.evaluate(() => ({ open: __S.open, pbw: !!__S.pbw }));
    const oursUp = () => page.evaluate(() => [...document.querySelectorAll('.tl-ub-c')].some(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none'));
    const MAP = [900, 300];
    check('(Google\'s map is what is under that point)', await page.evaluate(([x, y]) => document.elementFromPoint(x, y).classList.contains('gm-style'), MAP));

    // ---- a click on the map
    await page.click(bar('Weather')); await sleep(500);
    await page.mouse.click(...MAP); await sleep(800);
    check('FR24\'s Weather open, a click on the map: put away, as its X does', (await st()).open === null, await st());
    await page.click(bar('Weather')); await sleep(500);
    await page.mouse.move(...MAP); await page.mouse.down(); await page.mouse.move(MAP[0] + 80, MAP[1] + 50, { steps: 6 }); await page.mouse.up(); await sleep(800);
    check('... the map dragged: left open', (await st()).open === 'Weather');
    await page.click('.win .win-body'); await sleep(800);
    check('... a click in the window: left open', (await st()).open === 'Weather');
    await page.click(ours); await sleep(900);
    check('(LADD Unblock open, in FR24\'s window)', await oursUp() && (await st()).open === 'Widgets');
    await page.mouse.click(...MAP); await sleep(900);
    check('LADD Unblock open, a click on the map: put away as its X does - FR24\'s window gone, the button back at rest', !(await oursUp()) && (await st()).open === null && !(await page.evaluate(s => document.querySelector(s).hasAttribute('data-tl-ub-open'), ours)), await st());
    await page.click(bar('Playback')); await sleep(400);
    await page.mouse.click(...MAP); await sleep(800);
    check('FR24\'s playback open, a click on the map: left as it is', (await st()).pbw === true);
    await page.click(bar('Playback')); await sleep(400);

    // ---- the switches slide
    await page.click(ours); await sleep(900);
    const slide = () => page.evaluate(() => new Promise(res => {
      const b = document.querySelector('.tl-ub-c [data-ub-opt="alerts"]'), knob = () => new DOMMatrix(getComputedStyle(b.querySelector('i')).transform).m41;
      const x0 = knob(), xs = [], t0 = performance.now(); let same = true;
      b.click();
      (function f() { same = same && document.querySelector('.tl-ub-c [data-ub-opt="alerts"]') === b; xs.push(+knob().toFixed(1)); if (performance.now() - t0 < 450) requestAnimationFrame(f); else res({ x0, xs, same, on: b.getAttribute('aria-checked') }); })();
    }));
    let s1 = await slide();
    check('a switch turned off: the same switch slides across - part-way in between, not jumping', s1.same && s1.x0 === 20 && s1.xs[s1.xs.length - 1] === 0 && s1.xs.some(x => x > 1 && x < 19) && s1.on === 'false', s1);
    s1 = await slide();
    check('... and back on, the same way', s1.same && s1.x0 === 0 && s1.xs[s1.xs.length - 1] === 20 && s1.xs.some(x => x > 1 && x < 19) && s1.on === 'true', s1);
    await page.mouse.click(...MAP); await sleep(900);

    // ---- the icon
    const ico = () => page.evaluate(s => { const p = document.querySelector(s + ' svg[data-tl-ub-icon] path'), cs = getComputedStyle(p); return { w: cs.strokeWidth, c: cs.stroke }; }, ours);
    const theirs = l => page.evaluate(s => { const cs = getComputedStyle(document.querySelector(s + ' svg circle')); return { w: cs.strokeWidth, c: cs.stroke }; }, bar(l));
    await page.mouse.move(640, 40); await sleep(300);
    const rest = await ico(), fRest = await theirs('Filters');
    check('the icon at rest: FR24\'s line width at rest (1.5)', rest.w === '1.5px', { rest, fRest });
    await page.hover(bar('Filters')); await sleep(700);
    const fHov = await theirs('Filters');
    await page.hover(ours); await sleep(400);
    const hov = await ico();
    check('... pointed at: thicker and lighter, as FR24\'s icons are under the mouse (learned from theirs)', hov.w === '2.5px' && hov.c === fHov.c && fHov.w === '2.5px', { hov, fHov });
    await page.mouse.move(640, 40); await sleep(400);
    check('... the mouse gone: back as it was', (await ico()).w === '1.5px');
    await page.click(ours); await sleep(900);
    await page.mouse.move(640, 40); await sleep(400);
    const open = await ico();
    check('... open: thicker and yellow, as FR24\'s open button\'s icon', open.w === '2.5px' && open.c === 'rgb(248, 192, 35)', open);
    await page.mouse.click(...MAP); await sleep(900);
    check('... put away: at rest again', (await ico()).w === '1.5px');

    // ---- a tooltip being read
    const tip = await page.evaluate(() => { const h = document.createElement('div'); h.id = 'tiphost'; h.style.cssText = 'position:fixed;left:600px;top:400px;width:200px;height:40px;background:#fff;z-index:9'; h.innerHTML = '<span id="t1" title="61% - reasons A" style="display:block;height:40px">GSP</span>'; document.body.appendChild(h); return true; });
    await page.hover('#t1'); await sleep(100);
    const kept = await page.evaluate(() => { const s = document.getElementById('t1'); window.__tweeksLadd.morphHtml(document.getElementById('tiphost'), '<span id="t1" title="62% - reasons B" style="display:block;height:40px">GSP</span>'); return { same: document.getElementById('t1') === s, title: s.title }; });
    check('a tooltip being read: the element stays, its text left until the mouse leaves', tip && kept.same && kept.title === '61% - reasons A', kept);
    await page.mouse.move(640, 40); await sleep(100);
    const after = await page.evaluate(() => { window.__tweeksLadd.morphHtml(document.getElementById('tiphost'), '<span id="t1" title="63% - reasons C" style="display:block;height:40px">GSP</span>'); return document.getElementById('t1').title; });
    check('... the mouse gone: brought up to date', after === '63% - reasons C', after);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { fails++; console.log('FAIL  CRASH ' + (e && e.stack || e)); }
  await browser.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
