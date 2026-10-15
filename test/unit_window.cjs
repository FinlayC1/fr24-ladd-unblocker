// The LADD Unblock button and window, offline: the BUILT userscript in jsdom on a page with a bottom bar shaped like FR24's
// (Settings, Weather, Filters, Widgets, Playback - Vue's scoped attributes, one button in its "open" look) and one of FR24's
// own windows open (titled "Widgets"): the button joins the bar after Playback, copied from a resting button, with its own
// icon and label; it opens the window - every switch, the updates, the data sources; each switch does what it says (the
// strip hidden, the ads stylesheet, the alerts, the search box in the page part, live); FR24's own buttons close it; FR24
// drawing its bar again gets the button back; LADD Unblock switched off leaves FR24 alone but keeps the button.
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
const BAR = `<div data-v-7a1 class="bar-wrap"><nav data-v-7a1 class="bar">${['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'].map(l => BTN(l, l === 'Weather')).join('')}</nav></div>`;
const FR24_WINDOW = '<section class="fr24-win"><header><h2>Widgets</h2><button>x</button></header><div><p>Enable widgets</p><p>Most tracked flights</p></div></section>';
const LATEST = '99.1.0';
const opened = [], notes = [];
function makeWin(opts) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="map"></div>${FR24_WINDOW}${BAR}</body></html>`, { url: 'https://www.flightradar24.com/53.40,-2.60/9', runScripts: 'dangerously', pretendToBeVisual: true });
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

(async () => {
  const win = makeWin(), doc = win.document, T = () => win.__tweeksLadd;
  // ---- the button on the bar
  const btn = await until(() => doc.querySelector('.tl-ub-btn'), 4000);
  const nav = doc.querySelector('nav.bar');
  check('the button joins FR24\'s bar, after Playback', !!btn && btn.parentElement === nav && btn.previousElementSibling && /Playback/.test(btn.previousElementSibling.textContent) && !btn.nextElementSibling, btn && btn.outerHTML.slice(0, 120));
  check('... copied from a resting button: the bar\'s classes and Vue\'s scoped attribute, not the open look, no FR24 test id or state', !!btn && btn.tagName === 'BUTTON' && btn.classList.contains('bar-btn') && !btn.classList.contains('bar-btn--active') && btn.hasAttribute('data-v-7a1') && !btn.hasAttribute('aria-pressed') && btn.getAttribute('data-testid') === 'tl-ladd-unblock');
  const lbl = btn && btn.querySelector('.bar-label'), icon = btn && btn.querySelector('svg');
  check('... labelled "LADD Unblock" in the bar\'s own label element', !!lbl && lbl.textContent.trim() === 'LADD Unblock' && lbl.hasAttribute('data-v-7a1'), lbl && lbl.outerHTML);
  check('... with its own icon (an aircraft with an open padlock), the size and classes of the bar\'s icons', !!icon && icon.getAttribute('class') === 'h-6 w-6' && icon.getAttribute('width') === '24' && /<rect/.test(icon.innerHTML) && icon.getAttribute('stroke') === 'currentColor');
  check('(on: the page part is installed - the switched-off check below means something)', !!(await until(() => win.__tweeksLaddBridge, 3000)));
  check('... only one, and FR24\'s own window titled "Widgets" is not taken for the bar', doc.querySelectorAll('.tl-ub-btn').length === 1 && !doc.querySelector('.fr24-win .tl-ub-btn'));
  // ---- the window
  click(win, btn);
  const w = doc.querySelector('.tl-ub');
  check('clicking it opens the window, titled LADD Unblock, with a close button; the button shows it open', !!w && w.querySelector('.tl-ub-head').textContent.trim() === 'LADD Unblock' && !!w.querySelector('.tl-ub-x') && btn.classList.contains('tl-ub-btn-on'));
  const sw = k => w.querySelector(`[data-ub-opt="${k}"]`);
  check('... a switch for LADD Unblock itself and for every feature, all on by default', ['on', 'strip', 'boards', 'search', 'acPages', 'alerts', 'noAds'].every(k => sw(k) && sw(k).getAttribute('aria-checked') === 'true' && sw(k).getAttribute('role') === 'switch'));
  check('... the data sources moved here: the feeds, the monitor, the ADS-B Exchange and FAA keys', !!w.querySelector('#tl-ub-sources #tl-mon-url') && !!w.querySelector('#tl-adsbx-key') && !!w.querySelector('#tl-faa-id') && /adsb\.lol/.test(w.querySelector('#tl-ub-sources').textContent));
  check('... and nowhere else: the strip\'s "sources" link is gone, its version opens this window', !SRC.includes('data-tl-act="sources"') && SRC.includes('data-tl-act="ladd"'));
  await until(() => /Update to v99\.1\.0/.test(w.textContent), 3000);
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
  // ---- FR24's own buttons, Escape, the bar drawn again
  click(win, nav.querySelector('[data-testid="map-bar__filters"] span'));
  check('FR24\'s own bar button closes this window', !doc.querySelector('.tl-ub') && !btn.classList.contains('tl-ub-btn-on'));
  click(win, btn); doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes it', !doc.querySelector('.tl-ub'));
  click(win, btn); click(win, btn);
  check('the button again closes it', !doc.querySelector('.tl-ub'));
  // (what was learnt of FR24's own windows: Widgets' place and size, in screen pixels - no zoom here, so the same in CSS)
  win.localStorage.setItem('tweeks.fr24.ladd.look2', JSON.stringify({ left: 14, top: 7, width: 260, head: 30, bottom: 700, anim: { in: [{ f: 0, t: 300, o: 0, x: -40, y: 0, m: 't' }, { f: 1, t: 300, o: 1, x: 0, y: 0, m: 't' }], out: null } }));
  click(win, btn); const wl = doc.querySelector('.tl-ub');
  check('the window takes the place and size learnt from FR24\'s Widgets', !!wl && wl.style.left === '14px' && wl.style.top === '7px' && wl.style.width === '260px' && wl.style.maxHeight === '693px', wl && wl.getAttribute('style'));
  click(win, btn);
  check('... and closes at once when no closing movement was learnt', !doc.querySelector('.tl-ub'));
  win.localStorage.setItem('tweeks.fr24.ladd.look2', 'not json');
  click(win, btn); const wd = doc.querySelector('.tl-ub');
  check('... nothing usable learnt: Widgets\' size from the screenshots', !!wd && wd.style.width === '252px' && wd.style.left === '10px');
  click(win, btn);
  doc.querySelector('.bar-wrap').remove(); doc.body.insertAdjacentHTML('beforeend', BAR);
  const btn2 = await until(() => doc.querySelector('nav.bar .tl-ub-btn'), 3000);
  check('FR24 draws its bar again: the button is back, once', !!btn2 && doc.querySelectorAll('.tl-ub-btn').length === 1 && btn2.previousElementSibling && /Playback/.test(btn2.previousElementSibling.textContent));
  // ---- text size, making way, and what is cleaned up (the sizes FR24's boxes would have are stubbed: jsdom has no layout)
  const size = (el, w, h, top) => { Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true }); Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true }); if (top !== undefined) el.getBoundingClientRect = () => ({ top, bottom: top + h, left: 0, right: w, width: w, height: h }); };
  doc.body.insertAdjacentHTML('beforeend', `<div id="col" style="position:fixed;left:10px"><div id="cardA" style="position:static"><div><span>Most tracked flights</span></div><p>1. UAL941</p></div><div id="cardB"><div><span>Bookmarks</span></div><p>your bookmarks</p></div></div>
    <div id="ap"><div id="dis"><div class="hd"><span>Disruptions</span><svg></svg></div><div class="bd" id="band"></div></div><div id="stat"><div><span>Airport statistics</span></div><p>x</p></div></div>`);
  await until(() => doc.getElementById('cardB').classList.contains('tl-ub-gone'), 3000);
  check('FR24\'s Bookmarks widget is gone for good (hidden at once, nothing of it shown), its neighbour stays', doc.getElementById('cardB').classList.contains('tl-ub-gone') && !doc.getElementById('cardA').classList.contains('tl-ub-gone') && !doc.getElementById('cardA').classList.contains('tl-ub-hid'));
  await until(() => doc.getElementById('band').classList.contains('tl-ub-gone'), 3000);
  check('the empty body of the Disruptions dropdown on an airport panel is taken away, its heading stays', doc.getElementById('band').classList.contains('tl-ub-gone') && !doc.querySelector('#dis .hd').classList.contains('tl-ub-gone'));
  doc.getElementById('band').textContent = 'Delays at EGLL'; doc.getElementById('band').insertAdjacentHTML('afterend', '<i></i>');
  await until(() => !doc.getElementById('band').classList.contains('tl-ub-gone'), 3000);
  check('... and comes back once there is something in it', !doc.getElementById('band').classList.contains('tl-ub-gone'));
  // FR24's Widgets window is open: opening this one closes it (by its own bar button) and then FR24's widget panels give way
  const fw = doc.querySelector('.fr24-win'); fw.style.position = 'fixed'; size(fw, 252, 600);
  const barClicks = []; doc.querySelector('nav.bar [data-testid="map-bar__widgets"]').addEventListener('click', () => { barClicks.push(1); fw.remove(); });
  const btn3 = doc.querySelector('nav.bar .tl-ub-btn'); click(win, btn3);
  const w3 = doc.querySelector('.tl-ub');
  await until(() => barClicks.length && doc.getElementById('cardA').classList.contains('tl-ub-hid'), 4000);
  check('opening it closes the Widgets window already open, as that button would, and stays open itself', barClicks.length === 1 && !!doc.querySelector('.tl-ub') && w3 === doc.querySelector('.tl-ub'));
  check('... FR24\'s widget panels on the map give way to it, while it is open', doc.getElementById('cardA').classList.contains('tl-ub-hid'));
  check('... the text size: as large as the bar\'s own text (1.2), the window\'s own scale in the CSS var', w3.style.getPropertyValue('--tl-f') === '1.2' && /--tl-f,1\.2/.test(SRC) && w3.querySelectorAll('[data-ub-size]').length === 4 && w3.querySelector('[data-ub-size="1"]').getAttribute('aria-pressed') === 'true');
  click(win, w3.querySelector('[data-ub-size="3"]'));
  check('... a text size option: XL scales the text up and is kept', w3.style.getPropertyValue('--tl-f') === '1.56' && win.localStorage.getItem('tweeks.fr24.ladd.textsize') === '3' && doc.querySelector('.tl-ub [data-ub-size="3"]').getAttribute('aria-pressed') === 'true');
  click(win, btn3);
  check('closing it brings the widget panels back', !doc.querySelector('.tl-ub') && !doc.getElementById('cardA').classList.contains('tl-ub-hid') && doc.getElementById('cardB').classList.contains('tl-ub-gone'));
  win.close();

  // ---- LADD Unblock switched off: FR24 left alone, the button and window there to switch it on again
  const w2 = makeWin({ on: false }), d2 = w2.document;
  const b2 = await until(() => d2.querySelector('.tl-ub-btn'), 4000);
  await sleep(1500);
  check('switched off: no page part, no ads stylesheet, nothing asked of FR24\'s feeds', !w2.__tweeksLaddBridge && !d2.getElementById('tl-noads') && !w2.__posted.some(m => m.__tweeksLadd === 'hello'), w2.__posted.map(m => m.__tweeksLadd).slice(0, 5));
  check('... the button still on the bar', !!b2);
  click(w2, b2);
  const ww = d2.querySelector('.tl-ub');
  check('... its window: the main switch off, the features dimmed', !!ww && ww.classList.contains('tl-ub-off') && ww.querySelector('[data-ub-opt="on"]').getAttribute('aria-checked') === 'false');
  click(w2, ww.querySelector('[data-ub-opt="on"]'));
  check('... switched on: saved, "Reload FR24 to apply"', JSON.parse(w2.localStorage.getItem('tweeks.fr24.ladd.opts1')).on === true && !ww.querySelector('.tl-ub-reload').hasAttribute('hidden'));
  w2.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
