// The count of installs and the update banners, offline: the BUILT userscript in jsdom with FR24's bottom bar and a monitor
// answered here. The install id: made once (128 random bits, 32 hex) and kept. The hello: POST /hello to the monitor with
// exactly { id, ver, kind, handler, browser, os } and nothing else; not again within 12 hours, again at once after an
// update; never with "Count this install" off. Its answer: a newer version puts the update banner on the map (Update does
// what the window's Update does; Later hides it for 24 hours, kept; a required update - below minVer - only until the page
// is loaded again), the owner's notice in a banner of its own whose close is kept until the text changes. GitHub's version
// check alone puts the banner up too. Firefox's extension: nothing sent until Firefox allows "technical and interaction
// data".
// usage: node test/unit_hello.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const VERSION = (SRC.match(/@version\s+(\S+)/) || [])[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await sleep(100); } return f(); };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };

const BTN = l => `<button type="button" class="bar-btn"><svg class="h-6 w-6" width="24" height="24" viewBox="0 0 24 24"><path d="M1 1h${l.length}"/></svg><span class="bar-label">${l}</span></button>`;
const BAR = `<header id="fr24-head" style="position:fixed;top:0;left:0;right:0;height:56px;z-index:60">FR24</header><div class="bar-wrap"><nav class="bar">${['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'].map(BTN).join('')}</nav></div>`;
const MON = 'https://143-47-224-210.sslip.io';
const KEYS = { opts: 'tweeks.fr24.ladd.opts1', id: 'tweeks.fr24.ladd.iid', hello: 'tweeks.fr24.ladd.hello1', later: 'tweeks.fr24.ladd.later', notice: 'tweeks.fr24.ladd.noticex' };
const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0';
const UA_FF = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
// (o.latest: GitHub's package.json; o.answer: the monitor's answer to /hello; o.ls: localStorage before the script runs - a
// page loaded again keeps it; o.ext: the extension, with Firefox's answer to "may it send technical data")
function makeWin(o) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="map"></div>${BAR}</body></html>`, { url: 'https://www.flightradar24.com/53.40,-2.60/9', runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window, reqs = [], opened = [];
  for (const [k, v] of Object.entries(o.ls || {})) win.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = () => Promise.resolve(new Response('', { status: 404 }));
  Object.defineProperty(win.navigator, 'userAgent', { configurable: true, get: () => o.ua || UA_EDGE });
  if (o.uaData !== null) Object.defineProperty(win.navigator, 'userAgentData', { configurable: true, get: () => o.uaData || { brands: [{ brand: 'Chromium', version: '129' }, { brand: 'Microsoft Edge', version: '129' }, { brand: 'Not=A?Brand', version: '8' }], mobile: false, platform: 'Windows' } });
  if (!win.crypto || !win.crypto.getRandomValues) win.crypto = require('crypto').webcrypto;
  win.GM_xmlhttpRequest = r => {
    reqs.push({ url: r.url, method: r.method || 'GET', headers: r.headers || {}, data: r.data });
    let st = 404, body = '';
    if (/raw\.githubusercontent\.com\/FinlayC1\/fr24-ladd-unblocker\/main\/package\.json/.test(r.url)) { st = 200; body = JSON.stringify({ version: o.latest || VERSION }); }
    else if (r.url.startsWith(MON + '/status')) { st = 200; body = JSON.stringify({ v: 3, since: Date.now(), ver: VERSION }); }
    else if (r.url === MON + '/hello') { st = 200; body = JSON.stringify(o.answer || { ok: 1 }); }
    setTimeout(() => r.onload && r.onload({ status: st, responseText: body, response: body }), 2);
    return { abort() {} };
  };
  if (o.ext) { win.TL_EXTENSION = true; win.TL_DATA_CONSENT = ask => { o.ext.asked.push(!!ask); return Promise.resolve(o.ext.consent); }; }
  else win.GM_info = { scriptHandler: 'Tampermonkey', version: '5.3', script: { version: VERSION } };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.open = u => { opened.push(u); return null; };
  win.postMessage = data => setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0);
  win.console.debug = () => {}; win.console.log = () => {};
  // (jsdom has no layout: FR24's header, 56 px tall across the top)
  win.document.getElementById('fr24-head').getBoundingClientRect = () => ({ top: 0, bottom: 56, left: 0, right: 1024, width: 1024, height: 56, x: 0, y: 0 });
  win.eval(SRC);
  const hellos = () => reqs.filter(r => r.url === MON + '/hello');
  const ls = () => { const out = {}; for (let i = 0; i < win.localStorage.length; i++) { const k = win.localStorage.key(i); out[k] = win.localStorage.getItem(k); } return out; };
  const st = () => JSON.parse(win.localStorage.getItem(KEYS.hello) || '{}');
  const setSt = f => win.localStorage.setItem(KEYS.hello, JSON.stringify(Object.assign(st(), f)));
  return { win, doc: win.document, T: () => win.__tweeksLadd, reqs, hellos, opened, ls, st, setSt };
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const banner = (doc, k) => doc.querySelector(`.tl-bn-wrap [data-tl-bn="${k}"]`);
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

(async () => {
  const H = 3600e3, NOTICE = 'The shared monitor moves to a new server on Friday.';
  // ---- counting on (the default): the first hello, its answer
  {
    const A = makeWin({ answer: { ok: 1, latest: '99.2.0', notice: NOTICE, minVer: '' } }), { win, doc, T } = A;
    await until(() => doc.querySelector('.tl-ub-btn'), 4000);
    check('(no hello in the first seconds - after FR24 has opened)', A.hellos().length === 0);
    const h = await until(() => A.hellos()[0], 15000);
    const id = win.localStorage.getItem(KEYS.id);
    check('an install id made on the first run: 32 lowercase hex digits (128 random bits), kept in localStorage', /^[0-9a-f]{32}$/.test(id || ''), id);
    let body = null; try { body = JSON.parse(h.data); } catch (e) { /* none */ }
    check('the hello: POST /hello to the monitor, JSON', !!h && h.method === 'POST' && h.url === MON + '/hello' && h.headers['Content-Type'] === 'application/json' && !!body);
    check('... with exactly id, ver, kind, handler, browser, os - nothing else', !!body && JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['browser', 'handler', 'id', 'kind', 'os', 'ver']), body);
    check('... this install\'s id and version, a userscript in Tampermonkey 5.3, Edge on Windows (navigator.userAgentData)', !!body && body.id === id && body.ver === VERSION && body.kind === 'us' && body.handler === 'Tampermonkey 5.3' && body.browser === 'edge' && body.os === 'windows', body);
    check('... with the headers the monitor\'s other requests carry (which script is asking - no secret), nothing about the person', h.headers['X-Monitor-Client'] === 'fr24-ladd/' + VERSION && !h.headers['X-Monitor-Token'] && !/flightradar|cookie/i.test(JSON.stringify(h.headers)));
    check('... noted: when, for which version', Math.abs(A.st().at - Date.now()) < 30000 && A.st().ver === VERSION, A.st());
    // ---- its answer: a newer version - the banner
    const upd = await until(() => banner(doc, 'upd'), 3000);
    check('the monitor\'s latest (99.2.0; GitHub says this one is the newest) puts the update banner on the map', !!upd && text(upd).includes(`LADD Unblocker v99.2.0 is out (you have v${VERSION})`) && !/required/.test(text(upd)), text(upd));
    const wrap = doc.querySelector('.tl-bn-wrap');
    check('... at the top in the middle, below FR24\'s header (56 px), stacked as the header is - under FR24\'s pop-ups (z-index 60, not the window\'s 2147482000)', !!wrap && wrap.parentElement === doc.body && wrap.style.top === '64px' && wrap.style.zIndex === '60' && /\.tl-bn-wrap\{position:fixed;left:50%/.test(SRC), wrap && { top: wrap.style.top, z: wrap.style.zIndex });
    check('... FR24\'s style: its dark grey bar, white text, its yellow button, rounded, a small shadow', /\.tl-bn\{[^}]*background:#393939;color:#fff;border-radius:6px;box-shadow:/.test(SRC) && /\.tl-bn-b\{[^}]*background:#f8c023/.test(SRC));
    const ub = upd && upd.querySelector('[data-bn-act="update"]'), lb = upd && upd.querySelector('[data-bn-act="later"]');
    check('... "Update" and "Later" buttons - real buttons, reached with the keyboard', !!ub && !!lb && ub.tagName === 'BUTTON' && lb.tagName === 'BUTTON' && text(ub) === 'Update' && text(lb) === 'Later' && ub.tabIndex === 0);
    check('... one of each, no more', doc.querySelectorAll('.tl-bn-wrap [data-tl-bn="upd"]').length === 1 && doc.querySelectorAll('.tl-bn-wrap').length === 1);
    const btn = doc.querySelector('.tl-ub-btn');
    check('... and the dot on the bar\'s button, amber, naming the version', !!btn && !!btn.querySelector('.tl-ub-dot') && btn.querySelector('.tl-ub-dot').dataset.k === 'upd' && /99\.2\.0/.test(btn.getAttribute('title')));
    // ---- FR24's dialog up: out of sight
    doc.body.insertAdjacentHTML('beforeend', '<div id="fr24dlg" role="dialog" aria-modal="true">Sign in</div>'); T().ubBanners();
    check('FR24 showing a dialog: the banners are out of sight (never over FR24\'s pop-ups)', wrap.classList.contains('tl-bn-hid'));
    doc.getElementById('fr24dlg').remove(); T().ubBanners();
    check('... and back when it has gone', !wrap.classList.contains('tl-bn-hid'));
    // ---- not again within 12 hours; again after 12; again at once after an update
    await T().sayHello();
    check('not sent again within 12 hours (another look at once)', A.hellos().length === 1, A.hellos().length);
    A.setSt({ at: Date.now() - 11 * H }); await T().sayHello();
    check('... nor 11 hours on', A.hellos().length === 1);
    A.setSt({ at: Date.now() - 13 * H }); await T().sayHello();
    check('13 hours on: sent again, with the same id', A.hellos().length === 2 && JSON.parse(A.hellos()[1].data).id === id && win.localStorage.getItem(KEYS.id) === id);
    A.setSt({ at: Date.now() - 60000, ver: '22.0.0' }); await T().sayHello();
    check('the version changed (an update installed): sent again at once, the same id', A.hellos().length === 3 && JSON.parse(A.hellos()[2].data).id === id && A.st().ver === VERSION);
    // ---- the owner's notice
    const nb = banner(doc, 'notice'), x = nb && nb.querySelector('[data-bn-act="closeNotice"]');
    check('the owner\'s notice in a banner of its own, as plain text, with a close button (x)', !!nb && text(nb) === NOTICE && !nb.querySelector('a,script,img') && !!x && x.tagName === 'BUTTON' && x.getAttribute('aria-label') === 'Close', text(nb));
    click(win, x);
    check('... closed: taken out of the page, the text remembered', !banner(doc, 'notice') && win.localStorage.getItem(KEYS.notice) === NOTICE);
    T().ubBanners();
    check('... and stays closed', !banner(doc, 'notice'));
    A.setSt({ ans: Object.assign({}, A.st().ans, { notice: 'Monitor back: all good.' }) }); T().ubBanners();
    check('... until the owner writes another', text(banner(doc, 'notice')) === 'Monitor back: all good.');
    // ---- Update and Later
    click(win, ub);
    check('Update: does what the window\'s Update does for a userscript - opens the new .user.js for the manager to offer', A.opened.length === 1 && A.opened[0] === 'https://raw.githubusercontent.com/FinlayC1/fr24-ladd-unblocker/main/dist/fr24-ladd-unblocker.user.js' && /click Update there/.test(text(banner(doc, 'upd'))), A.opened);
    click(win, banner(doc, 'upd').querySelector('[data-bn-act="later"]'));
    const later = JSON.parse(win.localStorage.getItem(KEYS.later) || 'null');
    check('Later: the banner is taken out of the page, hidden for 24 hours (kept)', !banner(doc, 'upd') && !!later && later.v === '99.2.0' && Math.abs(later.until - Date.now() - 24 * H) < 60000, later);
    T().ubBanners();
    check('... still hidden at the next look - the dot on the button stays', !banner(doc, 'upd') && !!btn.querySelector('.tl-ub-dot'));
    win.localStorage.setItem(KEYS.later, JSON.stringify({ v: '99.2.0', until: Date.now() - 1000 })); T().ubBanners();
    check('... back once the 24 hours are over', !!banner(doc, 'upd'));
    // ---- the switch in the window
    click(win, btn);
    const w = await until(() => doc.querySelector('.tl-ub'), 4000), sw = w && w.querySelector('[data-ub-opt="count"]');
    const item = sw && sw.closest('.tl-ub-item');
    check('the window: a switch "Count this install (anonymous)", on by default, explained in one line', !!sw && sw.getAttribute('role') === 'switch' && sw.getAttribute('aria-checked') === 'true' && /Count this install \(anonymous\)/.test(text(item)) && text(item).includes('A random number, your version and browser, once a day - no IP kept, nothing about flights. Helps show how many people use it.'), text(item));
    click(win, sw);
    check('... switched off: kept with the other switches', JSON.parse(win.localStorage.getItem(KEYS.opts)).count === false && w.querySelector('[data-ub-opt="count"]').getAttribute('aria-checked') === 'false');
    A.setSt({ at: Date.now() - 13 * H }); await T().sayHello();
    A.setSt({ ver: '1.0.0' }); await T().sayHello();
    check('... then nothing is sent - not after 12 hours, not after an update', A.hellos().length === 3, A.hellos().length);
    click(win, w.querySelector('[data-ub-opt="count"]'));
    await until(() => A.hellos().length === 4, 3000);
    check('... switched on again: sent at once (it was due), the same id', A.hellos().length === 4 && JSON.parse(A.hellos()[3].data).id === id);
    win.close();
  }
  // ---- counting off from the start: nothing sent, no id made
  {
    const B = makeWin({ ls: { [KEYS.opts]: { count: false } }, answer: { ok: 1, latest: '99.2.0' } });
    await until(() => B.doc.querySelector('.tl-ub-btn'), 4000);
    await sleep(12500);
    check('counting off from the start: no hello at all (12 s and more after FR24 opened), no id made', B.hellos().length === 0 && !B.win.localStorage.getItem(KEYS.id), B.reqs.map(r => r.url.replace(/\?.*/, '')));
    await B.T().sayHello();
    check('... nor when asked directly', B.hellos().length === 0);
    B.win.close();
  }
  // ---- a required update (below minVer): Later only until the page is loaded again
  {
    const ls = { [KEYS.id]: 'ab'.repeat(16), [KEYS.hello]: { at: Date.now() - H, ver: VERSION, ans: { latest: '99.3.0', minVer: '99.0.0', notice: '', at: Date.now() - H } } };
    const C = makeWin({ ls });
    const upd = await until(() => banner(C.doc, 'upd'), 4000);
    check('below the lowest supported version (minVer, from the last hello\'s answer): the banner says the update is required', !!upd && text(upd).includes(`LADD Unblocker v99.3.0 is out (you have v${VERSION})`) && /this update is required/.test(text(upd)), text(upd));
    check('... no hello sent for it (one an hour ago)', C.hellos().length === 0);
    click(C.win, upd.querySelector('[data-bn-act="later"]'));
    check('... Later hides it for this page', !banner(C.doc, 'upd'));
    C.T().ubBanners(); await sleep(1200);
    check('... (still hidden on this page)', !banner(C.doc, 'upd'));
    const kept = C.ls(); C.win.close();
    const C2 = makeWin({ ls: kept });
    check('... and only until the page is loaded again: back at once', !!(await until(() => banner(C2.doc, 'upd'), 4000)) && /required/.test(text(banner(C2.doc, 'upd'))));
    C2.win.close();
  }
  // ---- Later kept across a reload (not required); a newer version than the one put off shows again
  {
    const ls = { [KEYS.id]: 'cd'.repeat(16), [KEYS.hello]: { at: Date.now() - H, ver: VERSION, ans: { latest: '99.2.0', minVer: '', notice: '', at: Date.now() - H } }, [KEYS.later]: { v: '99.2.0', until: Date.now() + 20 * H } };
    const D = makeWin({ ls });
    await until(() => D.doc.querySelector('.tl-ub-btn'), 4000); await sleep(1500);
    check('put off with Later, FR24 loaded again within 24 hours: no banner', !banner(D.doc, 'upd'));
    D.setSt({ ans: Object.assign({}, D.st().ans, { latest: '99.4.0' }) }); D.T().ubBanners();
    check('... a newer version than the one put off: shown again', text(banner(D.doc, 'upd')).includes('v99.4.0 is out'));
    D.win.close();
  }
  // ---- GitHub's check alone
  {
    const E = makeWin({ ls: { [KEYS.opts]: { count: false } }, latest: '99.1.0' });
    await until(() => E.doc.querySelector('.tl-ub-btn'), 4000);
    check('(nothing from the monitor: no banner yet)', !banner(E.doc, 'upd'));
    await E.T().checkLatest(true);
    const upd = await until(() => banner(E.doc, 'upd'), 3000);
    check('GitHub\'s version check alone (counting off) puts the update banner up too', !!upd && text(upd).includes(`LADD Unblocker v99.1.0 is out (you have v${VERSION})`) && E.hellos().length === 0, text(upd));
    E.win.close();
  }
  // ---- LADD Unblock switched off: no banner, no hello
  {
    const F = makeWin({ ls: { [KEYS.opts]: { on: false }, [KEYS.hello]: { at: Date.now() - 13 * H, ver: VERSION, ans: { latest: '99.2.0', minVer: '', notice: NOTICE, at: Date.now() - H } } } });
    await until(() => F.doc.querySelector('.tl-ub-btn'), 4000);
    await F.T().sayHello(); await sleep(1200);
    check('LADD Unblock switched off (FR24 left as it is): no banner on the map, no hello', !F.doc.querySelector('.tl-bn-wrap') && F.hellos().length === 0);
    F.win.close();
  }
  // ---- the extension in Firefox: nothing sent until Firefox allows technical data
  {
    const ext = { consent: false, asked: [] };
    const G = makeWin({ ext, ua: UA_FF, uaData: null, answer: { ok: 1 } });
    await until(() => G.doc.querySelector('.tl-ub-btn'), 4000);
    await G.T().sayHello();
    check('Firefox extension, "technical and interaction data" not allowed: nothing sent, no id made', G.hellos().length === 0 && ext.asked.length >= 1 && !G.win.localStorage.getItem(KEYS.id));
    click(G.win, G.doc.querySelector('.tl-ub-btn'));
    const allow = await until(() => G.doc.querySelector('.tl-ub [data-ub-act="ffConsent"]'), 3000);
    check('... the window says so under the switch, with a button that asks Firefox', !!allow && /Firefox has not allowed/.test(text(allow.parentElement)));
    click(G.win, allow);
    check('... which asks (the extension\'s page with Firefox\'s question)', ext.asked.includes(true));
    ext.consent = true; await G.T().sayHello();
    const h = G.hellos()[0], b = h ? JSON.parse(h.data) : {};
    check('... allowed: sent - kind "ext", handler "firefox-ext", Firefox on Linux (from the user agent)', !!h && b.kind === 'ext' && b.handler === 'firefox-ext' && b.browser === 'firefox' && b.os === 'linux' && Object.keys(b).length === 6, b);
    G.win.close();
  }
  // ---- the manifest: Firefox's optional data category
  {
    const ffZip = fs.readFileSync(path.join(__dirname, '..', 'build.mjs'), 'utf8');
    check('Firefox\'s manifest lists "technicalAndInteraction" as optional data collection (it may only be optional)', /data_collection_permissions: \{ required: \['websiteContent'\], optional: \['technicalAndInteraction'\] \}/.test(ffZip));
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
