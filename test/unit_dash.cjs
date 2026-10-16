// The owner's panel (monitor/dash.html) in jsdom, against the monitor's own answers (made in this process by monitor.cjs
// - /stats, /admin/installs, /admin/log, /admin/options - so the page is read against what the server really sends): the
// sign-in shows first; a wrong secret goes back to it; the secret is kept on the device (localStorage) and every request
// carries it; each page (#overview #users #traffic #logs #options) renders without an error; the charts are drawn; the
// options are saved; update / restart ask first; Sign out forgets the secret.
// usage: node test/unit_dash.cjs <node_modules>
const fs = require('fs'), os = require('os'), path = require('path');
const NM = path.resolve(process.argv[2] || path.join(__dirname, '../node_modules'));
const { JSDOM, VirtualConsole } = require(path.join(NM, 'jsdom'));
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mondash-'));
process.env.MON_TOKEN = 'dash-secret';
// (not under systemd, whatever runs the test: GitHub's runners are started by it and pass INVOCATION_ID on)
delete process.env.INVOCATION_ID;
const M = require('../monitor/monitor.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HTML = fs.readFileSync(path.join(__dirname, '../monitor/dash.html'), 'utf8');

// (some installs, so the users page has something to draw - a handler name with markup in it: shown as text)
const ver = M.MON_VER;
for (const [c, ip, o] of [['a', '198.51.100.1', {}], ['b', '198.51.100.1', { kind: 'us', handler: '<b>x</b>Tampermonkey' }], ['c', '203.0.113.5', { ver: '1.0.0', browser: 'firefox', os: 'linux' }]])
  M.helloAnswer(Object.assign({ id: c.repeat(32), ver, kind: 'ext', handler: 'chrome-ext', browser: 'chrome', os: 'windows' }, o), ip);
M.log('a log line for the panel');
const adminGet = p => Promise.resolve(M.adminAnswer(p.split('?')[0], 'GET', k => new URL('http://x' + p).searchParams.get(k)));

async function open(stored) {
  const asked = [], errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  let confirmSays = true, secret = 'dash-secret';
  const dom = new JSDOM(HTML, { url: 'https://monitor.example/dash', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (stored) w.localStorage.setItem('monTok', stored);
      w.confirm = () => confirmSays;
      w.fetch = async (url, o) => {
        o = o || {}; const p = String(url), tokOk = o.headers && o.headers['X-Monitor-Token'] === secret;
        asked.push({ p, method: o.method || 'GET', token: o.headers && o.headers['X-Monitor-Token'], body: o.body });
        const reply = (status, j) => ({ status, ok: status < 400, json: async () => j });
        if (!tokOk) return reply(401, null);
        if (p === '/stats') return reply(200, JSON.parse(JSON.stringify(M.answer(new URL('http://x/stats'), Date.now() / 1000))));
        if (o.method === 'POST' && p === '/admin/options') { const r = M.optionsSet(JSON.parse(o.body), false); return r ? reply(400, { ok: false, err: r }) : reply(200, Object.assign({ ok: true }, await adminGet('/admin/options'))); }
        if (o.method === 'POST') return reply(200, { ok: false, err: 'not under systemd here' });
        const j = await adminGet(p); return j ? reply(200, JSON.parse(JSON.stringify(j))) : reply(404, null);
      };
    } });
  dom.window.addEventListener('error', e => errors.push(String(e.message)));
  return { dom, w: dom.window, d: dom.window.document, asked, errors, setConfirm: v => { confirmSays = v; } };
}
const shown = (d, id) => !d.getElementById(id).classList.contains('hidden');
const nav = async (P, h) => { P.w.location.hash = h; await sleep(120); };

(async () => {
  // ---- signing in
  { const P = await open(); await sleep(100);
    check('first visit: the sign-in, nothing asked', shown(P.d, 'gate') && !shown(P.d, 'app') && P.asked.length === 0);
    P.d.getElementById('tok').value = 'wrong'; P.d.getElementById('login').dispatchEvent(new P.w.Event('submit', { cancelable: true })); await sleep(150);
    check('a wrong secret: back to the sign-in, saying so, nothing kept', shown(P.d, 'gate') && /Wrong secret/.test(P.d.getElementById('msg').textContent) && P.w.localStorage.getItem('monTok') === null);
    P.d.getElementById('tok').value = 'dash-secret'; P.d.getElementById('login').dispatchEvent(new P.w.Event('submit', { cancelable: true })); await sleep(200);
    check('the right one: the panel, the overview, the secret kept on this device', shown(P.d, 'app') && !shown(P.d, 'gate') && shown(P.d, 'p-overview') && P.w.localStorage.getItem('monTok') === 'dash-secret');
    const k = P.d.getElementById('o-kpis').textContent;
    check('overview: people, installs, active today, outdated, the monitor\'s version, the store', /People/.test(k) && /Installs/.test(k) && /Active today/.test(k) && /Outdated/.test(k) && k.includes(ver) && /Store on disk/.test(k), k.slice(0, 200));
    check('... and every card the old page had', ['c-fr24', 'c-poll', 'c-data', 'c-srv', 'c-req'].every(id => P.d.getElementById(id).children.length > 2));
    check('... controls offered only where they work (not under systemd here: off)', P.d.getElementById('b-update').disabled && P.d.getElementById('b-restart').disabled);
    P.dom.window.close(); }
  // ---- kept on the device: every page, no sign-in
  const P = await open('dash-secret'); await sleep(200);
  check('the secret kept: straight in, every request carrying it', shown(P.d, 'app') && P.asked.length > 0 && P.asked.every(a => a.token === 'dash-secret'));
  await nav(P, '#users');
  { const bars = P.d.querySelectorAll('#ch-new rect.mark').length, line = P.d.querySelectorAll('#ch-act path.line').length + P.d.querySelectorAll('#ch-act circle.dot').length;
    const rows = P.d.querySelectorAll('#t-inst tbody tr').length, ver2 = P.d.getElementById('t-ver').textContent;
    check('users: the cards, 60 days of new installs (bars), active people (line), breakdowns, the recent installs', shown(P.d, 'p-users') && !shown(P.d, 'p-overview') && bars === 60 && line > 0 && rows === 3 && ver2.includes('1.0.0') && /People/.test(P.d.getElementById('u-kpis').textContent), { bars, line, rows });
    check('... a manager name with markup in it shown as text, not HTML', P.d.getElementById('t-handler').textContent.includes('<b>x</b>Tampermonkey') && !P.d.querySelector('#t-handler b'));
    const hit = P.d.querySelectorAll('#ch-new rect.hit')[10]; hit.dispatchEvent(new P.w.MouseEvent('mouseenter'));
    check('... hovering a day: its figure in the readout', /new install/.test(P.d.getElementById('rd-new').textContent), P.d.getElementById('rd-new').textContent); }
  await nav(P, '#traffic');
  check('traffic: requests, endpoints, clients, recent requests', shown(P.d, 'p-traffic') && P.d.querySelectorAll('#t-ep thead th').length === 5 && P.d.querySelectorAll('#t-cl thead th').length === 7 && P.d.querySelectorAll('#t-rec thead th').length === 5 && P.d.getElementById('c-req2').children.length === 6);
  await nav(P, '#logs');
  check('logs: the latest lines and the last update', shown(P.d, 'p-logs') && /a log line for the panel/.test(P.d.getElementById('log-lines').textContent) && /No update run/.test(P.d.getElementById('dep-log').textContent));
  { const n0 = P.asked.filter(a => /admin\/log/.test(a.p)).length; await sleep(5600); const n1 = P.asked.filter(a => /admin\/log/.test(a.p)).length;
    P.d.getElementById('log-auto').checked = false; await sleep(5600); const n2 = P.asked.filter(a => /admin\/log/.test(a.p)).length;
    check('... refreshed every 5 s while asked to, not after', n1 > n0 && n2 === n1, [n0, n1, n2]); }
  await nav(P, '#options');
  { check('options: the form filled in', shown(P.d, 'p-options') && P.d.getElementById('o-counting').checked === true && P.d.getElementById('o-public').value === '' && P.d.getElementById('o-rate-def').checked && /img\.shields\.io\/endpoint\?url=https%3A%2F%2Fmonitor\.example%2Fbadge/.test(P.d.getElementById('o-badge').textContent));
    P.d.getElementById('o-notice').value = 'Please update'; P.d.getElementById('o-minver').value = '22.1.0'; P.d.getElementById('o-public').value = 'false';
    P.d.getElementById('o-rate-def').checked = false; P.d.getElementById('o-rate').disabled = false; P.d.getElementById('o-rate').value = '120';
    P.d.getElementById('opt-form').dispatchEvent(new P.w.Event('submit', { cancelable: true })); await sleep(150);
    const sent = P.asked.filter(a => a.method === 'POST' && a.p === '/admin/options').pop();
    check('... saved: notice, minVer, counting, public, rate sent - and shown as now set', sent && JSON.stringify(JSON.parse(sent.body)) === JSON.stringify({ notice: 'Please update', minVer: '22.1.0', counting: true, public: false, rate: 120 }) && /Saved/.test(P.d.getElementById('o-msg').textContent) && M.PUBLIC === false && M.RATE === 120, sent && sent.body);
    P.d.getElementById('o-minver').value = 'abc'; P.d.getElementById('opt-form').dispatchEvent(new P.w.Event('submit', { cancelable: true })); await sleep(100);
    check('... a wrong version refused in the page, nothing sent', /x\.y\.z/.test(P.d.getElementById('o-msg').textContent) && P.asked.filter(a => a.method === 'POST').length === 1); }
  await nav(P, '#overview');
  { const b = P.d.getElementById('b-update'); b.disabled = false; P.setConfirm(false); b.click(); await sleep(100);
    const none = P.asked.filter(a => a.p === '/admin/update').length;
    P.setConfirm(true); b.click(); await sleep(150);
    check('update: asked first (no: nothing sent; yes: POST /admin/update), the answer shown', none === 0 && P.asked.some(a => a.p === '/admin/update' && a.method === 'POST') && /Refused: not under systemd/.test(P.d.getElementById('ctl-msg').textContent), P.d.getElementById('ctl-msg').textContent); }
  P.d.getElementById('out').click(); await sleep(50);
  check('Sign out: the secret forgotten, the sign-in shown', shown(P.d, 'gate') && !shown(P.d, 'app') && P.w.localStorage.getItem('monTok') === null);
  check('no error on any page', P.errors.length === 0, P.errors.slice(0, 3));
  P.dom.window.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
