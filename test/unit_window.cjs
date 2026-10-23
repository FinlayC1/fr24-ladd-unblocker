// The LADD Unblock button and window, offline: the BUILT userscript in jsdom on a page with a bottom bar shaped like FR24's
// (Settings, Weather, Filters, Widgets, Playback - Vue's scoped attributes, one button in its "open" look). The button joins
// the bar after Playback, copied from a resting button, with its own icon and label. Where FR24 opens no window for it
// (here, at first), the stand-in comes up: FR24's size and title bar, every switch, the updates, the data sources; each
// switch does what it says; FR24's own buttons close it; FR24 drawing its bar again gets the button back; LADD Unblock
// switched off leaves FR24 alone but keeps the button. Then FR24's own windows, acted out (jsdom has no layout: the sizes
// FR24's boxes would have are given): the window opens in FR24's Widgets window - titled LADD Unblock, FR24's list hidden,
// this button drawn open and Widgets at rest; another button, Widgets itself, and its own button put it away as FR24's;
// FR24's Bookmarks widget switched off in FR24's own list and never shown. (The same, frame by frame in a real browser on
// a page made with Vue: test/unit_native.cjs)
// usage: node test/unit_window.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const VERSION = (SRC.match(/@version\s+(\S+)/) || [])[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };

const ICON = l => `<svg data-v-7a1 class="h-6 w-6" width="24" height="24" viewBox="0 0 24 24"><path d="M1 1h${l.length}"/></svg>`;
const BTN = (l, on) => `<button data-v-7a1 type="button" class="bar-btn${on ? ' bar-btn--active' : ''}" data-testid="map-bar__${l.toLowerCase()}" aria-pressed="${on ? 'true' : 'false'}">${ICON(l)}<span data-v-7a1 class="bar-label">\n  <!---->${l}</span></button>`;
const BAR = open => `<div data-v-7a1 class="bar-wrap"><nav data-v-7a1 class="bar">${['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'].map(l => BTN(l, l === open)).join('')}</nav></div>`;
const LATEST = '9.1.0';
const opened = [], notes = [];
function makeWin(opts, body) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="map"></div>${body || BAR('Weather')}</body></html>`, { url: 'https://www.flightradar24.com/53.40,-2.60/9', runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window;
  if (opts) win.localStorage.setItem('tweeks.fr24.ladd.opts1', JSON.stringify(opts));
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = () => Promise.resolve(new Response('', { status: 404 }));
  win.GM_xmlhttpRequest = o => { const raw = /raw\.githubusercontent\.com\/FinlayC1\/fr24-ladd-unblocker\/main\/package\.json/.test(o.url); const t = raw ? JSON.stringify({ version: LATEST }) : ''; setTimeout(() => o.onload && o.onload({ status: raw ? 200 : 404, responseText: t, response: t }), 2); return { abort() {} }; };
  win.GM_info = { scriptHandler: 'Tampermonkey', version: '5.3' };
  win.unsafeWindow = win; win.GM_notification = n => notes.push(n.title);
  win.open = u => { opened.push(u); return null; };
  win.__posted = []; win.postMessage = data => { win.__posted.push(data); setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0); };
  win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return win;
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const shown = (win, el) => { for (let a = el; a && a.nodeType === 1; a = a.parentElement) if (win.getComputedStyle(a).display === 'none') return false; return !!el && el.isConnected; };

// FR24, acted out: its bar's buttons open and close their windows - one at a time, as a Vue update (a microtask later),
// the open one drawn in its open look; a window is its grey title bar and a list, on the left; the Widgets window lists
// the widgets, each with its On / Off; the widgets switched on are panels on the map while no window is open. The sizes
// a browser would give each box: data-g="width,height,top".
function actFR24(win) {
  const doc = win.document, S = { open: null, bm: true, flight: false };
  const geo = el => { const g = el.getAttribute && el.getAttribute('data-g'); return g ? g.split(',').map(Number) : null; };
  const vis = el => { for (let a = el; a && a.nodeType === 1; a = a.parentElement) if (win.getComputedStyle(a).display === 'none') return false; return el.isConnected; };
  Object.defineProperty(win.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { const g = geo(this); return g && vis(this) ? g[0] : 0; } });
  Object.defineProperty(win.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { const g = geo(this); return g && vis(this) ? g[1] : 0; } });
  win.HTMLElement.prototype.getBoundingClientRect = function () { const g = geo(this); return g && vis(this) ? { top: g[2], bottom: g[2] + g[1], left: 8, right: 8 + g[0], width: g[0], height: g[1], x: 8, y: g[2] } : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }; };
  const col = doc.createElement('div'); col.id = 'left'; doc.body.prepend(col);
  const items = () => [...doc.querySelectorAll('nav.bar [data-testid^="map-bar__"]')];
  const render = () => {
    for (const b of items()) { const l = b.dataset.testid.slice(9), c = 'bar-btn' + (S.open === l ? ' bar-btn--active' : ''); if (b.dataset.last !== c) { b.className = c; b.dataset.last = c; } }
    const cur = col.querySelector('.fr24-win'), want = S.open && S.open !== 'playback' ? S.open : null;
    if (cur && cur.dataset.k !== want) cur.remove();
    if (want && !col.querySelector('.fr24-win')) {
      const title = want[0].toUpperCase() + want.slice(1);
      const list = want === 'widgets' ? `<p>Enable widgets</p><div class="row" data-g="320,120,0"><b>Most tracked flights</b><span class="sw">On</span></div><div class="row" id="bmrow" data-g="320,120,0"><b>Bookmarks</b><span class="sw">${S.bm ? 'On' : 'Off'}</span></div>` : `<p>${title} options</p>`;
      col.insertAdjacentHTML('beforeend', `<section class="fr24-win" data-k="${want}" data-g="336,600,8"><header data-g="336,40,8"><h2 data-g="120,20,18">${title}</h2><button class="x" data-g="20,20,18">x</button></header><div class="list" data-g="336,560,48">${list}</div></section>`);
      const w = col.querySelector('.fr24-win');
      w.querySelector('.x').addEventListener('click', () => { S.open = null; queueMicrotask(render); });
      for (const sw of w.querySelectorAll('.sw')) sw.addEventListener('click', () => { if (sw.parentElement.id === 'bmrow') S.bm = !S.bm; sw.textContent = sw.textContent === 'On' ? 'Off' : 'On'; });
    }
    const panels = col.querySelector('.panels');
    if (!want && !S.flight) { if (!panels) col.insertAdjacentHTML('beforeend', `<div class="panels" data-g="336,400,8"><div class="card" data-g="336,150,8"><h3>Most tracked flights</h3><p>UAL941</p></div>${S.bm ? '<div class="card" id="bmcard" data-g="336,150,166"><h3>Bookmarks</h3><p>yours</p></div>' : ''}</div>`); } else if (panels) panels.remove();
  };
  for (const b of items()) b.addEventListener('click', () => { const l = b.dataset.testid.slice(9); S.flight = false; S.open = S.open === l ? null : l; queueMicrotask(render); });
  S.openFlight = () => { S.open = null; S.flight = true; queueMicrotask(render); };
  render();
  return S;
}

(async () => {
  const win = makeWin(), doc = win.document, T = () => win.__tweeksLadd;
  const weatherClicks = []; doc.querySelector('[data-testid="map-bar__weather"]').addEventListener('click', () => weatherClicks.push(1));
  // ---- the button on the bar
  const btn = await until(() => doc.querySelector('.tl-ub-btn'), 4000);
  const nav = doc.querySelector('nav.bar');
  check('the button joins FR24\'s bar, after Playback', !!btn && btn.parentElement === nav && btn.previousElementSibling && /Playback/.test(btn.previousElementSibling.textContent) && !btn.nextElementSibling, btn && btn.outerHTML.slice(0, 120));
  check('... copied from a resting button: the bar\'s classes and Vue\'s scoped attribute, not the open look, no FR24 test id or state', !!btn && btn.tagName === 'BUTTON' && btn.classList.contains('bar-btn') && !btn.classList.contains('bar-btn--active') && btn.hasAttribute('data-v-7a1') && !btn.hasAttribute('aria-pressed') && btn.getAttribute('data-testid') === 'tl-ladd-unblock');
  const lbl = btn && btn.querySelector('.bar-label'), icon = btn && btn.querySelector('svg');
  check('... labelled "LADD Unblock" in the bar\'s own label element', !!lbl && lbl.textContent.trim() === 'LADD Unblock' && lbl.hasAttribute('data-v-7a1'), lbl && lbl.outerHTML);
  check('... with its own icon (an aircraft with an open padlock), the size, classes and scoped attribute of the bar\'s icons', !!icon && icon.getAttribute('class') === 'h-6 w-6' && icon.getAttribute('width') === '24' && /<rect/.test(icon.innerHTML) && icon.getAttribute('stroke') === 'currentColor' && icon.hasAttribute('data-v-7a1'));
  check('(on: the page part is installed - the switched-off check below means something)', !!(await until(() => win.__tweeksLaddBridge, 3000)));
  check('... only one', doc.querySelectorAll('.tl-ub-btn').length === 1);
  // ---- no FR24 window opens for it: the stand-in
  click(win, btn);
  const w = await until(() => doc.querySelector('.tl-ub'), 4000);
  check('FR24 opening no window for it: the stand-in comes up, titled LADD Unblock, with a close button; the button shows it open', !!w && w.querySelector('.tl-ub-head').textContent.trim() === 'LADD Unblock' && !!w.querySelector('.tl-ub-x') && btn.classList.contains('tl-ub-btn-on'));
  check('... FR24\'s open window put away by its own button (Weather pressed once)', weatherClicks.length === 1, weatherClicks.length);
  check('... drawn as FR24\'s windows are: 336 px wide, a 40 px grey title bar with 16 px bold lettering, 14 px text', /\.tl-ub\{position:fixed;[^}]*width:336px/.test(SRC) && /\.tl-ub-head\{[^}]*height:40px[^}]*background:#393939[^}]*font-size:16px;font-weight:700/.test(SRC) && /\.tl-ub-c\{--tl-f:1;font-size:calc\(var\(--tl-f\)\*14px\)/.test(SRC));
  const sw = k => w.querySelector(`[data-ub-opt="${k}"]`);
  check('... a switch for LADD Unblock itself and for every feature, all on by default', ['on', 'strip', 'boards', 'search', 'acPages', 'alerts', 'noAds'].every(k => sw(k) && sw(k).getAttribute('aria-checked') === 'true' && sw(k).getAttribute('role') === 'switch'));
  check('... the data sources moved here: the feeds, the monitor, the ADS-B Exchange and FAA keys', !!w.querySelector('#tl-ub-sources #tl-mon-url') && !!w.querySelector('#tl-adsbx-key') && !!w.querySelector('#tl-faa-id') && /adsb\.lol/.test(w.querySelector('#tl-ub-sources').textContent));
  check('... and nowhere else: the strip\'s "sources" link is gone, its version opens this window', !SRC.includes('data-tl-act="sources"') && SRC.includes('data-tl-act="ladd"'));
  await until(() => /Update to v9\.1\.0/.test(w.textContent), 3000);
  const upd = w.querySelector('#tl-ub-upd');
  check('updates: the version installed, the latest (main\'s package.json), the kind of install', upd.textContent.includes('v' + VERSION) && upd.textContent.includes('Update to v' + LATEST) && /Tampermonkey userscript/.test(upd.textContent), upd.textContent.replace(/\s+/g, ' '));
  click(win, w.querySelector('[data-ub-act="update"]'));
  check('... Update (userscript): opens the new .user.js, which the userscript manager offers to update', opened.length === 1 && opened[0] === 'https://raw.githubusercontent.com/FinlayC1/fr24-ladd-unblocker/main/dist/fr24-ladd-unblocker.user.js' && /click Update there/.test(w.querySelector('#tl-ub-upd').textContent), opened);
  check('... no "Reload extension" for a userscript', !w.querySelector('[data-ub-act="reloadExt"]'));
  // ---- the switches
  win.__posted.length = 0;
  click(win, w.querySelector('[data-ub-opt="strip"]'));
  const saved = () => JSON.parse(win.localStorage.getItem('tweeks.fr24.ladd.opts1') || '{}');
  check('panel details off: the strip is hidden at once, kept in localStorage, the page part told', doc.documentElement.classList.contains('tl-no-strip') && saved().strip === false && win.__posted.some(m => m.__tweeksLadd === 'opts' && m.opts.strip === false) && w.querySelector('[data-ub-opt="strip"]').getAttribute('aria-checked') === 'false' && w.querySelector('.tl-ub-reload').hasAttribute('hidden'));
  click(win, w.querySelector('[data-ub-opt="strip"]'));
  check('... and back on', !doc.documentElement.classList.contains('tl-no-strip') && saved().strip === true);
  check('ads hidden by default (the stylesheet in place)', !!doc.getElementById('tl-noads'));
  click(win, w.querySelector('[data-ub-opt="noAds"]'));
  check('... switched off: the stylesheet goes at once, and "Reload FR24 to apply" (the sidebar is the page\'s own)', !doc.getElementById('tl-noads') && !w.querySelector('.tl-ub-reload').hasAttribute('hidden'));
  click(win, w.querySelector('[data-ub-opt="noAds"]'));
  check('... and back on', !!doc.getElementById('tl-noads'));
  T().notify('G-TEST took off', 'From QKC'); const n0 = notes.length;
  click(win, w.querySelector('[data-ub-opt="alerts"]'));
  T().notify('G-TEST landed', 'At HAW');
  check('alerts off: no notification', n0 === 1 && notes.length === 1, notes);
  click(win, w.querySelector('[data-ub-opt="alerts"]'));
  // (the page part: FR24's search box asks the script for its aircraft only while Search is on - switched live)
  await until(() => T().bridgeV, 3000);
  win.__posted.length = 0; await win.fetch('https://www.flightradar24.com/v1/search/web/find?query=GTEST&limit=10'); await sleep(50);
  const askedOn = win.__posted.some(m => m.__tweeksLadd === 'needSearch');
  click(win, w.querySelector('[data-ub-opt="search"]')); await sleep(50);
  win.__posted.length = 0; await win.fetch('https://www.flightradar24.com/v1/search/web/find?query=GTEST&limit=10'); await sleep(50);
  const askedOff = win.__posted.some(m => m.__tweeksLadd === 'needSearch');
  check('search: the page part adds to FR24\'s search while on, and leaves it alone once switched off (no reload)', askedOn && !askedOff, { askedOn, askedOff });
  click(win, w.querySelector('[data-ub-opt="search"]'));
  // (a data source's button inside the window: handled, and only this part redrawn)
  w.querySelector('#tl-adsbx-key').value = 'k123'; click(win, w.querySelector('[data-tl-act="adsbxSave"]'));
  check('data sources: a key saved from the window, the section redrawn ("remove" offered)', T().store.kvGet('adsbxKey') === 'k123' && !!doc.querySelector('.tl-ub [data-tl-act="adsbxClear"]'));
  // ---- the text size
  const body = w.querySelector('.tl-ub-c');
  check('text size: FR24\'s own (M, 14 px) to start with, four sizes offered', body.style.getPropertyValue('--tl-f') === '1' && w.querySelectorAll('[data-ub-size]').length === 4 && w.querySelector('[data-ub-size="1"]').getAttribute('aria-pressed') === 'true');
  click(win, w.querySelector('[data-ub-size="3"]'));
  check('... XL scales the text up and is kept', body.style.getPropertyValue('--tl-f') === '1.3' && win.localStorage.getItem('tweeks.fr24.ladd.textsize') === '3' && w.querySelector('[data-ub-size="3"]').getAttribute('aria-pressed') === 'true');
  click(win, w.querySelector('[data-ub-size="1"]'));
  // ---- FR24's own buttons, Escape, the bar drawn again
  click(win, nav.querySelector('[data-testid="map-bar__filters"] span'));
  await sleep(300);
  check('FR24\'s own bar button closes the stand-in', !doc.querySelector('.tl-ub') && !btn.classList.contains('tl-ub-btn-on'));
  click(win, btn);
  check('... next time the stand-in comes up at once', !!doc.querySelector('.tl-ub'));
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
  check('Escape closes it', !doc.querySelector('.tl-ub'));
  click(win, btn); click(win, btn); await sleep(300);
  check('the button again closes it', !doc.querySelector('.tl-ub'));
  doc.querySelector('.bar-wrap').remove(); doc.body.insertAdjacentHTML('beforeend', BAR(''));
  const btn2 = await until(() => doc.querySelector('nav.bar .tl-ub-btn'), 3000);
  check('FR24 draws its bar again: the button is back, once', !!btn2 && doc.querySelectorAll('.tl-ub-btn').length === 1 && btn2.previousElementSibling && /Playback/.test(btn2.previousElementSibling.textContent));
  win.close();

  // ---- LADD Unblock switched off: FR24 left alone, the button and window there to switch it on again
  {
    const w2 = makeWin({ on: false }), d2 = w2.document;
    const b2 = await until(() => d2.querySelector('.tl-ub-btn'), 4000);
    await sleep(1500);
    check('switched off: no page part, no ads stylesheet, nothing asked of FR24\'s feeds', !w2.__tweeksLaddBridge && !d2.getElementById('tl-noads') && !w2.__posted.some(m => m.__tweeksLadd === 'hello'), w2.__posted.map(m => m.__tweeksLadd).slice(0, 5));
    check('... the button still on the bar', !!b2);
    click(w2, b2);
    const ww = await until(() => d2.querySelector('.tl-ub'), 4000);
    check('... its window: the main switch off, the features dimmed', !!ww && ww.querySelector('.tl-ub-c').classList.contains('tl-ub-off') && ww.querySelector('[data-ub-opt="on"]').getAttribute('aria-checked') === 'false');
    click(w2, ww.querySelector('[data-ub-opt="on"]'));
    check('... switched on: saved, "Reload FR24 to apply"', JSON.parse(w2.localStorage.getItem('tweeks.fr24.ladd.opts1')).on === true && !ww.querySelector('.tl-ub-reload').hasAttribute('hidden'));
    w2.close();
  }

  // ---- FR24's own windows: this one in FR24's Widgets window
  {
    const w3 = makeWin(null, BAR('')), d3 = w3.document, S = actFR24(w3);
    const q = s => d3.querySelector(s), card = () => q('#bmcard');
    await sleep(50);
    check('FR24\'s Bookmarks widget on the map: hidden as it is put in', !!card() && card().hasAttribute('data-tl-gone') && !shown(w3, card()) && shown(w3, q('.card')));
    const b3 = await until(() => q('nav.bar .tl-ub-btn'), 4000);
    click(w3, q('[data-testid="map-bar__weather"]')); await sleep(20);
    check('(Weather open)', q('.fr24-win h2').textContent === 'Weather');
    click(w3, b3); await sleep(30);
    const fw = q('.fr24-win'), h2 = fw && fw.querySelector('h2');
    check('pressed: FR24 opens its Widgets window for it (Weather put away by FR24), titled LADD Unblock in FR24\'s own title', S.open === 'widgets' && !!h2 && h2.textContent === 'LADD Unblock' && fw.dataset.k === 'widgets');
    check('... FR24\'s title bar kept, its list hidden, this content in its place', fw.hasAttribute('data-tl-ub-host') && fw.querySelector('header').hasAttribute('data-tl-ub-keep') && shown(w3, fw.querySelector('header')) && !shown(w3, fw.querySelector('.list')) && shown(w3, fw.querySelector('.tl-ub-c.tl-ub-in')) && !!fw.querySelector('.tl-ub-in [data-ub-opt="on"]') && !q('.tl-ub'));
    check('... FR24\'s Bookmarks switched off in FR24\'s own list ("On" pressed)', S.bm === false && q('#bmrow .sw').textContent === 'Off');
    const real = q('[data-testid="map-bar__widgets"]'), face = q('nav.bar .tl-ub-face');
    check('... the bar: this button in Widgets\' open look; Widgets hidden, a copy of it at rest in its place', b3.classList.contains('bar-btn--active') && b3.classList.contains('tl-ub-btn') && b3.textContent.trim() === 'LADD Unblock' && !shown(w3, real) && !!face && face.previousElementSibling === real && !face.classList.contains('bar-btn--active') && face.textContent.trim() === 'Widgets');
    check('... one button drawn open', [...d3.querySelectorAll('nav.bar > *')].filter(e => shown(w3, e) && e.classList.contains('bar-btn--active')).length === 1);
    click(w3, b3); await sleep(30);
    check('its own button puts it away (FR24 closes its window); both buttons as they were', S.open === null && !q('.fr24-win') && !b3.classList.contains('bar-btn--active') && shown(w3, real) && !q('.tl-ub-face'));
    click(w3, b3); await sleep(30);
    click(w3, q('[data-testid="map-bar__filters"]')); await sleep(30);
    check('another button (Filters): this goes as FR24\'s windows go, Filters opens; Widgets back, nothing left marked', S.open === 'filters' && q('.fr24-win h2').textContent === 'Filters' && !q('[data-tl-ub-host]') && !q('[data-tl-ub-under]') && !q('.tl-ub-face') && !b3.classList.contains('bar-btn--active'));
    click(w3, b3); await sleep(30);
    click(w3, q('nav.bar .tl-ub-face')); await sleep(200);
    const fw2 = q('.fr24-win');
    check('Widgets (its copy) pressed while this is open: this goes, then FR24\'s own Widgets opens - its title, its list, no Bookmarks row', S.open === 'widgets' && !!fw2 && fw2.querySelector('h2').textContent === 'Widgets' && !fw2.hasAttribute('data-tl-ub-host') && shown(w3, fw2.querySelector('.list')) && !shown(w3, q('#bmrow')) && real.classList.contains('bar-btn--active') && shown(w3, real) && !b3.classList.contains('bar-btn--active'));
    click(w3, b3); await sleep(300);
    const fw3 = q('.fr24-win');
    check('this pressed while Widgets is open: Widgets goes first, then it opens again for this', S.open === 'widgets' && !!fw3 && fw3 !== fw2 && fw3.querySelector('h2').textContent === 'LADD Unblock' && b3.classList.contains('bar-btn--active'));
    S.openFlight(); await sleep(30);
    check('a flight opened: it goes as FR24\'s windows go', !q('.fr24-win') && !b3.classList.contains('bar-btn--active') && !q('.tl-ub-face'));
    click(w3, b3); await sleep(30);
    click(w3, q('.fr24-win .x')); await sleep(30);
    check('FR24\'s close button in its title bar puts it away', !q('.fr24-win') && !b3.classList.contains('bar-btn--active'));
    check('FR24 itself no longer puts the Bookmarks widget on the map', !card());
    w3.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
