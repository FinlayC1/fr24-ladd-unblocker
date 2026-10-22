// The bottom bar's windows and the LADD Unblock button as FR24's own, in a real browser: the BUILT userscript in Chromium
// on the Vue page made like FR24's map (test/fixtures/fr24mock.html, Google's map under it - ?gm=1 - and the bar's icons
// drawn thicker under the mouse and yellow open - ?look=1).
//   - a click on the map puts away the window open - FR24's own (Weather, Playback) and LADD Unblock - by its X; a drag
//     of the map, a click in the window, and a click picking a flight in playback do not
//   - an FR24 that puts its window away itself on the map's click, and draws its button at rest only a while after
//     (?mapclose=1), its X a button, a picture (?xd=1) or a toggle (?xt=1): the window stays away, click after click, and
//     nothing else opens - not its button, not a picture-only button of the page's beside it (?trap=1: it opens Widgets);
//     an FR24 leaving it open: its X pressed; a close button not known for one (?xn=1): nothing
//   - LADD Unblock's switches slide across as they are turned (the same element, part-way across mid-turn)
//   - its icon drawn as FR24's: lighter under the mouse - its line as at rest - and thicker (2.3) and yellow open
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
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('/__vue.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    if (/^https:\/\/www\.flightradar24\.com\/[0-9.,-]+\/\d+/.test(u)) return route.fulfill({ status: 200, contentType: 'text/html', body: MOCK });
    return route.fulfill({ status: 404, body: '' });
  });
  await ctx.addInitScript(src => { window.__SRC = src; }, SRC);
  await ctx.addInitScript({ content: STUBS + '\n;(function (go) { if (document.documentElement) return go(); const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); go(); } }); mo.observe(document, { childList: true }); })(function () { (0, eval)(window.__SRC); });' });
  try {
    await page.goto('https://www.flightradar24.com/53.40,-2.60/9?mode=keyed&gm=1&look=1&pbl=1');
    await page.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
    const ours = 'nav.bar .tl-ub-btn', bar = l => `nav.bar [data-testid="map-bar__${l.toLowerCase()}"]`;
    const st = () => page.evaluate(() => ({ open: __S.open, pbw: !!__S.pbw }));
    const oursUp = () => page.evaluate(() => [...document.querySelectorAll('.tl-ub-c')].some(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none'));
    const MAP = [900, 300];
    check('(Google\'s map is what is under that point)', await page.evaluate(([x, y]) => document.elementFromPoint(x, y).classList.contains('gm-style'), MAP));

    // ---- a click on the map
    await page.click(bar('Weather')); await sleep(500);
    await page.mouse.click(...MAP); await sleep(1500);
    check('FR24\'s Weather open, a click on the map: put away, as its X does', (await st()).open === null, await st());
    await page.click(bar('Weather')); await sleep(500);
    await page.mouse.move(...MAP); await page.mouse.down(); await page.mouse.move(MAP[0] + 80, MAP[1] + 50, { steps: 6 }); await page.mouse.up(); await sleep(800);
    check('... the map dragged: left open', (await st()).open === 'Weather');
    await page.click('.win .win-body'); await sleep(800);
    check('... a click in the window: left open', (await st()).open === 'Weather');
    await page.click(ours); await sleep(900);
    check('(LADD Unblock open, in FR24\'s window)', await oursUp() && (await st()).open === 'Widgets');
    await page.mouse.click(...MAP); await sleep(1500);
    check('LADD Unblock open, a click on the map: put away as its X does - FR24\'s window gone, the button back at rest', !(await oursUp()) && (await st()).open === null && !(await page.evaluate(s => document.querySelector(s).hasAttribute('data-tl-ub-open'), ours)), await st());
    await page.click(bar('Playback')); await sleep(400);
    await page.mouse.click(...MAP); await page.evaluate(() => { __S.flight = true; }); await sleep(800);
    check('FR24\'s playback open, a click on the map picking a flight in it: left open', (await st()).pbw === true);
    await page.evaluate(() => { __S.flight = false; }); await sleep(400);
    await page.mouse.click(...MAP); await sleep(1500);
    check('... a click on the map otherwise: put away by its X', (await st()).pbw === false, await st());

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
    await page.mouse.click(...MAP); await sleep(1500);

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
    check('... pointed at: lighter as FR24\'s icons are under the mouse (learned from theirs) - its line as at rest, not thicker', hov.w === '1.5px' && hov.c === fHov.c && hov.c !== rest.c, { hov, fHov, rest });
    await page.mouse.move(640, 40); await sleep(400);
    check('... the mouse gone: back as it was', (await ico()).w === '1.5px');
    await page.click(ours); await sleep(900);
    await page.mouse.move(640, 40); await sleep(400);
    const open = await ico();
    check('... open: clearly thicker (2.3) and yellow, as FR24\'s open button\'s icon', open.w === '2.3px' && open.c === 'rgb(248, 192, 35)', open);
    await page.hover(ours); await sleep(400);
    check('... open and pointed at: the same', (await ico()).w === '2.3px', await ico());
    await page.mouse.click(...MAP); await sleep(1500);
    check('... put away: at rest again', (await ico()).w === '1.5px');

    // ---- a tooltip being read
    const tip = await page.evaluate(() => { const h = document.createElement('div'); h.id = 'tiphost'; h.style.cssText = 'position:fixed;left:600px;top:400px;width:200px;height:40px;background:#fff;z-index:9'; h.innerHTML = '<span id="t1" title="61% - reasons A" style="display:block;height:40px">GSP</span>'; document.body.appendChild(h); return true; });
    await page.hover('#t1'); await sleep(100);
    const kept = await page.evaluate(() => { const s = document.getElementById('t1'); window.__tweeksLadd.morphHtml(document.getElementById('tiphost'), '<span id="t1" title="62% - reasons B" style="display:block;height:40px">GSP</span>'); return { same: document.getElementById('t1') === s, title: s.title }; });
    check('a tooltip being read: the element stays, its text left until the mouse leaves', tip && kept.same && kept.title === '61% - reasons A', kept);
    await page.mouse.move(640, 40); await sleep(100);
    const after = await page.evaluate(() => { window.__tweeksLadd.morphHtml(document.getElementById('tiphost'), '<span id="t1" title="63% - reasons C" style="display:block;height:40px">GSP</span>'); return document.getElementById('t1').title; });
    check('... the mouse gone: brought up to date', after === '63% - reasons C', after);
    // ---- an FR24 that puts its window away itself on the map's click, its button drawn at rest a while after - its X a
    // button, one that opens what it closes, a picture: never opened again, nor anything else, click after click
    const opener = pg => pg.evaluate(() => { window.__opens = []; Vue.watch(() => __S.open, v => { if (v) window.__opens.push(v); }); });
    for (const q of ['', '&xt=1', '&xd=1', '&xt=1&xd=1']) {
      const p3 = await ctx.newPage();
      await p3.goto('https://www.flightradar24.com/53.40,-2.60/9?mode=keyed&gm=1&mapclose=1&trap=1' + q);
      await p3.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
      await opener(p3);
      const st3 = () => p3.evaluate(() => ({ open: __S.open, lit: __S.lit, opens: __opens.slice() }));
      let bad = null;
      for (const b of ['Weather', 'Filters', 'Settings']) {
        await p3.click(bar(b)); await sleep(700);
        const o0 = (await st3()).opens.length;
        await p3.mouse.click(...MAP); await sleep(2400);
        const s = await st3(); if (s.open !== null || s.opens.length !== o0) { bad = { b, s }; break; }
      }
      check(`FR24 putting its window away itself on the map's click${q ? ' (' + q.slice(1) + ')' : ''}: away, and nothing opened again - three windows`, !bad, bad);
      await p3.click(ours); await sleep(1400);
      const up = await p3.evaluate(() => [...document.querySelectorAll('.tl-ub-c')].some(e => e.getBoundingClientRect().height > 0));
      const o1 = (await st3()).opens.length;
      await p3.mouse.click(...MAP); await sleep(2600);
      const gone = await p3.evaluate(() => ![...document.querySelectorAll('.tl-ub-c')].some(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none'));
      const s2 = await st3();
      check('... LADD Unblock the same: away, nothing opened again', up && gone && s2.open === null && s2.opens.length === o1, { up, gone, s2 });
      await p3.close();
    }
    // ---- FR24 as it is on the real map: every click on it tries to select a flight that is not there; the window open goes
    // away at once and comes back about 0.9 s later. It is put away again once it is back, and stays away - each window of
    // the bar, and LADD Unblock (whose window is FR24's Widgets, brought back as FR24's own)
    for (const q of ['', '&xd=1']) {
      const p5 = await ctx.newPage();
      await p5.goto('https://www.flightradar24.com/53.40,-2.60/9?mode=keyed&gm=1&fakepick=1' + q);
      await p5.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
      const vis = () => p5.evaluate(() => [...document.querySelectorAll('.win,.tl-ub-c')].filter(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none').length);
      let bad = null;
      for (const b of ['Weather', 'Filters', 'Settings']) {
        await p5.click(bar(b)); await sleep(700);
        await p5.mouse.click(...MAP); await sleep(5500);
        const s = await p5.evaluate(() => __S.open), v = await vis(); if (s !== null || v) { bad = { b, s, v }; break; }
      }
      check(`FR24 selecting a flight that is not there on a map click${q ? ' (' + q.slice(1) + ')' : ''}: its window put away again when it comes back, and kept away - three windows`, !bad, bad);
      await p5.click(ours); await sleep(1400);
      const up = await vis();
      await p5.mouse.click(...MAP); await sleep(6500);
      const s2 = await p5.evaluate(() => __S.open), v2 = await vis();
      check('... LADD Unblock the same: away, and no Widgets window of FR24\'s in its place', up > 0 && s2 === null && v2 === 0, { up, s2, v2 });
      await p5.close();
    }
    // ... and a button pressed on the bar after the click is the person's own choice: left as it is
    { const p6 = await ctx.newPage();
      await p6.goto('https://www.flightradar24.com/53.40,-2.60/9?mode=keyed&gm=1&fakepick=1');
      await p6.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
      await p6.click(bar('Filters')); await sleep(700);
      await p6.mouse.click(...MAP); await sleep(300);
      await p6.click(bar('Weather')); await sleep(5000);
      check('a bar button pressed just after a map click: its window stays (not put away with the one before)', (await p6.evaluate(() => __S.open)) === 'Weather');
      await p6.close(); }
    // ---- an FR24 that leaves its window open on the map's click: its X pressed - a picture, a toggle; not known: nothing
    for (const q of ['&xd=1', '&xt=1', '&xn=1']) {
      const p4 = await ctx.newPage();
      await p4.goto('https://www.flightradar24.com/53.40,-2.60/9?mode=keyed&gm=1&trap=1' + q);
      await p4.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
      await opener(p4);
      await p4.click(bar('Filters')); await sleep(700);
      await p4.mouse.click(...MAP); await sleep(1500);
      const s4 = await p4.evaluate(() => ({ open: __S.open, opens: __opens.slice() }));
      if (q === '&xn=1') check('FR24 leaving its window open, its close button not known for one: nothing pressed - not its button, not another of the page\'s (Widgets not opened)', s4.open === 'Filters' && s4.opens.join() === 'Filters', s4);
      else {
        await p4.click(ours); await sleep(1400);
        await p4.mouse.click(...MAP); await sleep(1500);
        const gone = await p4.evaluate(() => ![...document.querySelectorAll('.tl-ub-c')].some(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none'));
        const s5 = await p4.evaluate(() => ({ open: __S.open, opens: __opens.slice() }));
        check(`FR24 leaving its window open (${q.slice(1)}): put away by its X - Filters, then LADD Unblock; nothing else opened`, s4.open === null && gone && s5.open === null && s5.opens.join() === 'Filters,Widgets', { s4, gone, s5 });
      }
      await p4.close();
    }
    // ---- an FR24 whose icons do not grow under the mouse (or are swapped for another drawing): the same
    { const p2 = await ctx.newPage();
      await p2.goto('https://www.flightradar24.com/53.40,-2.60/9?mode=keyed&gm=1');
      await p2.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
      await p2.evaluate(() => localStorage.removeItem('tweeks.fr24.ladd.barlook')); await p2.reload(); await p2.waitForSelector('nav.bar .tl-ub-btn', { timeout: 15000 });
      await p2.hover('nav.bar [data-testid="map-bar__filters"]'); await sleep(700);
      const w0 = await p2.evaluate(() => getComputedStyle(document.querySelector('nav.bar .tl-ub-btn svg[data-tl-ub-icon] path')).strokeWidth);
      await p2.hover('nav.bar .tl-ub-btn'); await sleep(400);
      const w1 = await p2.evaluate(() => getComputedStyle(document.querySelector('nav.bar .tl-ub-btn svg[data-tl-ub-icon] path')).strokeWidth);
      await p2.click('nav.bar .tl-ub-btn'); await sleep(900); await p2.mouse.move(640, 40); await sleep(400);
      const w2 = await p2.evaluate(() => getComputedStyle(document.querySelector('nav.bar .tl-ub-btn svg[data-tl-ub-icon] path')).strokeWidth);
      check('FR24\'s icons not growing under the mouse: this one as at rest when pointed at, clearly thicker open (1.5, 1.5, 2.3)', w0 === '1.5px' && w1 === '1.5px' && w2 === '2.3px', [w0, w1, w2]);
      await p2.close(); }
    check('no page errors', errors.length === 0, errors);
  } catch (e) { fails++; console.log('FAIL  CRASH ' + (e && e.stack || e)); }
  await browser.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
