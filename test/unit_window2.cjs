// The LADD Unblock window's 22.28 additions, offline: the BUILT userscript in jsdom with FR24's bottom bar and a monitor
// answered here. An out-of-date version: an amber dot on the button and a line in Updates. After an update: a blue dot
// until the window is opened, a "what's new" note with this version's headlines until it is dismissed (a first install
// shows none). The Monitor section: the monitor's figures from /status (public) or /stats (owner), its version against the
// latest; the controls only with the owner's secret, each acting on a second click (POST /admin/update, /admin/restart,
// the secret sent only to the monitor), the log; the secret never in the page. This browser's own figures.
// usage: node test/unit_window2.cjs <node_modules dir>
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

const BTN = l => `<button data-v-7a1 type="button" class="bar-btn"><svg data-v-7a1 class="h-6 w-6" width="24" height="24" viewBox="0 0 24 24"><path d="M1 1h${l.length}"/></svg><span data-v-7a1 class="bar-label">${l}</span></button>`;
const BAR = `<div data-v-7a1 class="bar-wrap"><nav data-v-7a1 class="bar">${['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'].map(BTN).join('')}</nav></div>`;
const MON = 'https://143-47-224-210.sslip.io', SECRET = 'owner-secret-xyz';
const STATUS = { v: 3, since: Date.now() - 3 * 3600e3, public: true, ver: '22.27.2', commit: 'abc1234', fails: 3, lastErr: 'HTTP 429', blocked: 10151, legs: 119212, live: 412, backfillQueue: 2,
  listAge: { ladd: 6 }, hist: { queue: 0 }, fr24: { scanning: true, lastOkAgo: 40, paused: 0, named: 2310, flights: 2400, trailQueue: 1, fails: 0 }, waiting: { flights: 86 }, owners: { known: 9000, queue: 12 }, tel: { served: 12345 }, wx: { fails: 1 }, paused: { 'api.adsb.lol': 30 } };
function makeWin({ latest, seen, store }) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="map"></div>${BAR}</body></html>`, { url: 'https://www.flightradar24.com/53.40,-2.60/9', runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window, reqs = [];
  if (seen) win.localStorage.setItem('tweeks.fr24.ladd.seenver', seen);
  win.indexedDB = store || new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  win.fetch = () => Promise.resolve(new Response('', { status: 404 }));
  win.GM_xmlhttpRequest = o => {
    reqs.push({ url: o.url, method: o.method || 'GET', headers: o.headers || {} });
    let st = 404, body = '';
    const owner = (o.headers || {})['X-Monitor-Token'] === SECRET;
    if (/raw\.githubusercontent\.com\/FinlayC1\/fr24-ladd-unblocker\/main\/package\.json/.test(o.url)) { st = 200; body = JSON.stringify({ version: latest }); }
    else if (o.url.startsWith(MON + '/status')) { st = 200; body = JSON.stringify(Object.assign({}, STATUS, owner ? { controls: { update: true, restart: true } } : {})); }
    else if (o.url.startsWith(MON + '/stats')) { st = owner ? 200 : 401; body = owner ? JSON.stringify({ uptimeS: 7200, ver: '22.27.2', commit: 'abc1234', controls: { update: true, restart: true }, mon: STATUS, srv: { rss: 320 * 1048576, load: [0.42] }, req: { lastMin: 52, clients: 14 } }) : ''; }
    else if (o.url.startsWith(MON + '/admin/')) { st = owner ? 200 : 401; body = owner ? JSON.stringify(/log/.test(o.url) ? { lines: ['2026-10-15T15:00:00 status {"polls":1}'], deploy: { at: Date.now(), text: '[deploy] branch main\n[deploy] OK - the monitor answers (def5678)' } } : { ok: true }) : ''; }
    else if (o.url.startsWith(MON)) { st = 200; body = '{}'; }
    setTimeout(() => o.onload && o.onload({ status: st, responseText: body, response: body }), 2);
    return { abort() {} };
  };
  win.GM_info = { scriptHandler: 'Tampermonkey', version: '5.3' };
  win.unsafeWindow = win; win.GM_notification = () => {};
  win.open = () => null;
  win.postMessage = data => setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, origin: 'https://www.flightradar24.com', source: win })), 0);
  win.console.debug = () => {}; win.console.log = () => {};
  win.eval(SRC);
  return { win, doc: win.document, reqs };
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

(async () => {
  // ---- a first install, up to date: no dot, no note
  {
    const { win, doc } = makeWin({ latest: VERSION });
    const btn = await until(() => doc.querySelector('.tl-ub-btn'), 4000);
    click(win, btn); const w = await until(() => doc.querySelector('.tl-ub'), 4000);
    await until(() => /up to date/.test(w.querySelector('#tl-ub-upd').textContent), 3000);
    check('first install, up to date: no dot on the button, no "what\'s new", no out-of-date line', !btn.querySelector('.tl-ub-dot') && !w.querySelector('.tl-ub-new') && !w.querySelector('.tl-ub-alert'));
    check('... the version is noted as seen (a first install is not an update)', win.localStorage.getItem('tweeks.fr24.ladd.seenver') === VERSION);
    win.close();
  }
  // ---- updated from an older version, and a newer one out
  {
    const { win, doc, reqs } = makeWin({ latest: '9.1.0', seen: '22.20.0' });
    const btn = await until(() => doc.querySelector('.tl-ub-btn'), 4000);
    check('after an update, a newer one out: the button\'s tooltip says so before the window is opened - nothing drawn over its icon', (await until(() => /9\.1\.0 is out/.test(btn.getAttribute('title') || ''), 2000)) && !btn.querySelector('.tl-ub-dot'));
    click(win, btn); const w = await until(() => doc.querySelector('.tl-ub'), 4000);
    const note = w.querySelector('.tl-ub-new');
    check('... the window opens with "Updated to v' + VERSION + '" and this version\'s "in short" sentences (at most 6), a link to all of them', !!note && note.textContent.includes('Updated to v' + VERSION) && note.querySelectorAll('li').length >= 1 && note.querySelectorAll('li').length <= 6 && !!note.querySelector('a[href*="CHANGELOG"]'), note && note.textContent.replace(/\s+/g, ' ').slice(0, 300));
    await until(() => w.querySelector('.tl-ub-alert'), 3000);
    const alert = w.querySelector('.tl-ub-alert');
    check('a newer version out: a line in Updates says this one is out of date, with both versions', !!alert && alert.textContent.includes('9.1.0') && alert.textContent.includes(VERSION) && alert.closest('#tl-ub-upd'), alert && alert.textContent);
    check('... and the button\'s tooltip names the new version (no dot on its icon)', !btn.querySelector('.tl-ub-dot') && /9\.1\.0/.test(btn.getAttribute('title')));
    click(win, w.querySelector('[data-ub-act="seenNew"]'));
    check('dismissing the note takes it away for good', !doc.querySelector('.tl-ub .tl-ub-new') && win.localStorage.getItem('tweeks.fr24.ladd.seenver') === VERSION);
    // ---- the monitor, public: its figures, no controls
    const mon = await until(() => { const m = doc.querySelector('#tl-ub-mon'); return m && /Blocked aircraft/.test(m.textContent) ? m : null; }, 6000);
    const mt = mon ? mon.textContent.replace(/\s+/g, ' ') : '';
    check('Monitor section: its version (a beta: B22.27.2) and commit, behind the latest, how long it has run', /B22\.27\.2/.test(mt) && /abc1234/.test(mt) && /behind v9\.1\.0/.test(mt) && /Running for ?3 h/.test(mt), mt.slice(0, 200));
    check('... the live list, LADD list age, blocked aircraft, flights kept, FR24 scan, named, waiting, lookups served, owners, queues', /412 aircraft · LADD list 6 s old/.test(mt) && /10,151/.test(mt) && /119,212/.test(mt) && /ok 40 s ago/.test(mt) && /2,310 of 2,400/.test(mt) && /Waiting to be named ?86/.test(mt) && /12,345/.test(mt) && /9,000 · 12 to look up/.test(mt) && /rebuilds 2/.test(mt), mt);
    check('... errors by source and the paused hosts', /polls 3/.test(mt) && /weather 1/.test(mt) && /api\.adsb\.lol 30 s/.test(mt));
    check('... without the secret: no controls, a line saying the owner\'s secret adds them', !mon.querySelector('[data-ub-act="monUpdate"]') && /owner's secret/.test(mt));
    check('... asked with /status (public), not /stats, and no /admin request', reqs.some(r => r.url.startsWith(MON + '/status')) && !reqs.some(r => /\/stats|\/admin\//.test(r.url)));
    const loc = doc.querySelector('#tl-ub-local');
    check('This browser: flights identified, routes, named by the monitor, requests answered', !!loc && /Flights identified/.test(loc.textContent) && /Requests\s*\d/.test(loc.textContent.replace(/\s+/g, ' ')), loc && loc.textContent.replace(/\s+/g, ' '));
    check('Data sources: each source counts its answers', /\d+ ok/.test(doc.querySelector('#tl-ub-sources').textContent));
    // ---- the owner's secret saved: /stats, the controls
    doc.getElementById('tl-mon-token').value = SECRET;
    click(win, doc.querySelector('[data-tl-act="monSave"]'));
    await sleep(400);
    // (reopened: asked again at once)
    click(win, doc.querySelector('.tl-ub .tl-ub-x')); await sleep(300); check('(closed by its close button)', !doc.querySelector('.tl-ub')); click(win, btn);
    const upd = await until(() => doc.querySelector('#tl-ub-mon [data-ub-act="monUpdate"]'), 6000);
    const mt2 = doc.querySelector('#tl-ub-mon').textContent.replace(/\s+/g, ' ');
    check('with the secret: Update, Restart and Log buttons; the update button names the newer version', !!upd && /Update to v9\.1\.0/.test(upd.textContent) && !!doc.querySelector('#tl-ub-mon [data-ub-act="monRestart"]') && !!doc.querySelector('#tl-ub-mon [data-ub-act="monLog"]'), mt2.slice(-300));
    check('... and the server\'s numbers: memory, load, requests a minute, browsers', /320 MB · load 0\.42/.test(mt2) && /52 a minute · 14 browsers/.test(mt2), mt2);
    const n0 = reqs.filter(r => /\/admin\/update/.test(r.url)).length;
    click(win, upd);
    await sleep(200);
    check('one click on Update does nothing on the server, it asks for a second', reqs.filter(r => /\/admin\/update/.test(r.url)).length === n0 && /Click again/.test(doc.querySelector('#tl-ub-mon [data-ub-act="monUpdate"]').textContent));
    click(win, doc.querySelector('#tl-ub-mon [data-ub-act="monUpdate"]'));
    const post = await until(() => reqs.find(r => /\/admin\/update/.test(r.url)), 3000);
    check('the second click POSTs /admin/update to the monitor, with the secret in its header (not the address)', !!post && post.method === 'POST' && post.headers['X-Monitor-Token'] === SECRET && !post.url.includes(SECRET));
    check('... then says it is updating', await until(() => /Updating|Update: /.test(doc.querySelector('#tl-ub-mon').textContent), 3000));
    click(win, doc.querySelector('#tl-ub-mon [data-ub-act="monLog"]'));
    const logBox = await until(() => { const p = doc.querySelector('#tl-ub-mon .tl-ub-log'); return p && /status/.test(p.textContent) ? p : null; }, 3000);
    check('Log shows the last update\'s output and the latest log lines', !!logBox && /OK - the monitor answers/.test(logBox.textContent));
    click(win, doc.querySelector('#tl-ub-mon [data-ub-act="monRestart"]')); click(win, doc.querySelector('#tl-ub-mon [data-ub-act="monRestart"]'));
    check('Restart, clicked twice, POSTs /admin/restart', !!(await until(() => reqs.find(r => /\/admin\/restart/.test(r.url) && r.method === 'POST'), 3000)));
    check('the secret is nowhere in the page', !doc.documentElement.outerHTML.includes(SECRET));
    check('no request carried the secret to anything but the monitor', reqs.every(r => r.headers['X-Monitor-Token'] !== SECRET || r.url.startsWith(MON)));
    win.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
