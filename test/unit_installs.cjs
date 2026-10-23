// The installs counter and the owner's options, on the real monitor (monitor.cjs run as it runs on the server, a temp
// store, offline - every request out answered here): POST /hello checked strictly (anything else 400); no double counting
// (the same id twice is one install, two ids from one network one person, one id from two networks one person, two ids
// from two networks two people, an IPv6 /64 one network); no address ever kept or logged; counting off keeps nothing;
// /badge open to anyone with CORS *; /admin/installs and /admin/options only with the secret; the options kept across a
// restart, public / rate taking effect at once; /hello giving the notice, minVer and the newest version - this monitor's
// own while GitHub cannot be read. And installs.cjs on its own: networks, versions, days, the 400-day and size limits.
// usage: node test/unit_installs.cjs [dataDir]
// (run as a preload of the monitor - node -r this monitor.cjs - it only stands in for the network)
if (process.env.INSTALLS_PRELOAD) {
  global.fetch = async url => {
    if (/raw\.githubusercontent\.com\/FinlayC1\/fr24-ladd-unblocker\/main\/package\.json/.test(String(url)) && process.env.MOCK_GH !== 'fail') return { status: 200, ok: true, text: async () => JSON.stringify({ name: 'fr24-ladd-unblocker', version: process.env.MOCK_GH }) };
    throw new Error('offline (test)');
  };
  return;
}
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
const I = require('../monitor/installs.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VER = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'moninst-')), TOKEN = 'inst-secret-' + Math.random().toString(36).slice(2);
const port = 43000 + Math.floor(Math.random() * 5000);
const IPS = ['198.51.100.23', '198.51.100.47', '203.0.113.91', '203.0.113.92', '192.0.2.150', '192.0.2.151', '2001:db8:77:88::5', '2001:db8:77:88:aaaa::9', '198.51.100.200', '192.0.2.222'];
const id = c => c.repeat(32);
const hello = (o, ip) => Object.assign({ id: id('a'), ver: VER, kind: 'ext', handler: 'chrome-ext', browser: 'chrome', os: 'windows' }, o);
const req = (method, p, o) => new Promise(res => {
  o = o || {};
  const headers = Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': o.ip || '198.51.100.1' }, o.token ? { 'X-Monitor-Token': o.token } : {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers, agent: false }, x => { let s = ''; x.on('data', c => { s += c; }); x.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) { /* not json */ } res({ status: x.statusCode, body: j, raw: s, headers: x.headers }); }); });
  r.on('error', e => res({ status: 0, err: String(e) }));
  if (o.raw != null) r.write(o.raw); else if (o.body !== undefined) r.write(JSON.stringify(o.body)); r.end();
});
const own = { token: TOKEN };
const post = (p, body, o) => req('POST', p, Object.assign({ body }, o || {}));
async function start(gh) {
  const env = Object.assign({}, process.env, { INSTALLS_PRELOAD: '1', MOCK_GH: gh, MON_DATA: DATA, MON_STORE: STORE, MON_PORT: String(port), MON_HOST: '127.0.0.1', MON_TOKEN: TOKEN, MON_RATE: '0' });
  delete env.MON_PUBLIC; delete env.INVOCATION_ID;
  const child = spawn(process.execPath, ['-r', __filename, path.join(__dirname, '../monitor/monitor.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; });
  child.done = new Promise(r => child.on('exit', code => r(code)));
  child.out = () => out;
  for (let i = 0; i < 240; i++) { await sleep(250); const s = await req('GET', '/status', own); if (s.status === 200) return child; }
  throw new Error('the monitor did not start: ' + out.slice(-1500));
}
async function stop(child) { child.kill('SIGTERM'); const t = setTimeout(() => child.kill('SIGKILL'), 30000); const code = await child.done; clearTimeout(t); return code; }
const counts = async () => (await req('GET', '/admin/installs', own)).body || {};
// (every file of the store - but the compressed ones - as text)
const storeText = () => { let s = ''; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!/\.gz$/.test(e.name)) s += fs.readFileSync(p, 'latin1') + '\n'; } }; walk(STORE); return s; };

(async () => {
  // ---- installs.cjs on its own ---------------------------------------------------------------------------------------
  check('a network: IPv4 as it is (a mapped one too), IPv6 by its /64', I.netOf('::ffff:198.51.100.7') === '198.51.100.7' && I.netOf('2001:db8:77:88::5') === I.netOf('2001:DB8:77:88:aaaa:0:0:9') && I.netOf('2001:db8:77:88::5') !== I.netOf('2001:db8:77:89::5'), [I.netOf('2001:db8:77:88::5')]);
  check('versions compared as numbers', I.cmpVer('22.28.9', '22.28.10') < 0 && I.cmpVer('22.3.0', '22.28.0') < 0 && I.cmpVer('23.0.0', '22.99.99') > 0 && I.cmpVer('1.2.3', '1.2.3') === 0);
  check('1.0.0 and on newer than every beta (22.x, "B22.x")', I.cmpVer('1.0.0', '22.31.12') > 0 && I.cmpVer('22.31.12', '1.0.0') < 0 && I.cmpVer('B22.31.11', '22.31.10') > 0 && I.cmpVer('B22.31.11', '1.0.0') < 0 && I.cmpVer('1.0.1', '1.0.0') > 0 && I.cmpVer('1.10.0', '1.9.9') > 0 && I.cmpVer('2.0.0', '1.99.99') > 0 && I.cmpVer('', '1.0.0') < 0 && I.cmpVer('', '22.0.0') < 0 && I.cmpVer('v1.0.0', '1.0.0') === 0);
  { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moninst-u-')), D = 86400e3, now = Date.now();
    const A = I.createInstalls({ store: dir, max: 10 });
    A.hello(I.valid(hello({ id: id('1') })), '198.51.100.1', now - 401 * D);
    A.hello(I.valid(hello({ id: id('2') })), '198.51.100.2', now - 2 * D); A.hello(I.valid(hello({ id: id('3') })), '198.51.100.2', now - 2 * D);
    A.hello(I.valid(hello({ id: id('4') })), '198.51.100.4', now - D - 1000);
    A.hello(I.valid(hello({ id: id('5'), ver: '22.0.0' })), '198.51.100.5', now);
    const s = A.summary(now, VER), dd = new Date(now - 2 * D).toISOString().slice(0, 10), d1 = new Date(now - D).toISOString().slice(0, 10);
    const day2 = s.activePerDay.find(r => r[0] === dd), day1 = s.activePerDay.find(r => r[0] === d1);
    check('installs.cjs: each finished day kept as its active people and installs (two ids, one network: 1 person)', day2 && day2[1] === 1 && day2[2] === 2 && day1 && day1[1] === 1 && day1[2] === 1, { day2, day1 });
    check('... the last 1 / 7 / 30 days, new installs by day, breakdowns, the outdated', s.active.d1.installs === 1 && s.active.d7.installs === 4 && s.active.d7.people === 3 && s.newPerDay.length === 60 && s.by.ver.length === 2 && s.outdated.installs === 1 && s.outdated.of === 4, s.active);
    A.save(true);
    const B = I.createInstalls({ store: dir, max: 10 }); B.load();
    check('... an id unseen for 400 days dropped when saved; the rest read back', B.size === 4 && B.summary(now, VER).installs === 4, B.size);
    for (let i = 0; i < 12; i++) B.hello(I.valid(hello({ id: (i.toString(16) + 'b').repeat(16).slice(0, 32) })), '192.0.2.' + i, now + i);
    check('... at most `max` ids: the longest unseen dropped first', B.size <= 10 && B.recent(500)[0].id === ('bb'.repeat(4)) && B.recent(500).every(r => r.id !== '55555555'), B.size); }

  // ---- the monitor, GitHub out of reach ------------------------------------------------------------------------------
  let M = await start('fail');
  { const bad = [['an id of 31 characters', hello({ id: 'a'.repeat(31) })], ['an id in capitals', hello({ id: 'A'.repeat(32) })], ['a kind not ext / us', hello({ kind: 'xx' })],
      ['a version not x.y.z', hello({ ver: '22.28' })], ['a browser not listed', hello({ browser: 'netscape' })], ['a system not listed', hello({ os: 'beos' })], ['a manager name over 24 characters', hello({ handler: 'x'.repeat(25) })],
      ['a field missing', (() => { const h = hello(); delete h.handler; return h; })()], ['a field more', hello({ lat: 51.5 })], ['a number for a string', hello({ ver: 22 })], ['an array', [hello()]]];
    const got = []; for (const [, b] of bad) got.push((await post('/hello', b)).status);
    got.push((await post('/hello', null, { raw: 'not json' })).status);
    check('/hello refuses (400): ' + bad.map(b => b[0]).join(', ') + ', not JSON', got.every(s => s === 400), got);
    const big = await post('/hello', null, { raw: JSON.stringify(Object.assign(hello(), { pad: 'x'.repeat(5000) })) });
    check('... a body over 4 KB: 413', big.status === 413, big.status);
    check('... and nothing of them counted', ((await counts()).installs) === 0); }
  { const r = await post('/hello', hello(), { ip: IPS[0] });
    check('/hello: { ok: 1, latest, notice, minVer } - GitHub out of reach: latest is this monitor\'s own version', r.status === 200 && r.body && r.body.ok === 1 && r.body.latest === VER && r.body.notice === '' && r.body.minVer === '' && Object.keys(r.body).sort().join() === 'latest,minVer,notice,ok', r.body); }
  await post('/hello', hello(), { ip: IPS[0] });
  let c = await counts();
  check('the same id twice: 1 install, 1 person (seen twice)', c.installs === 1 && c.people === 1 && c.recent && c.recent[0].n === 2 && c.recent[0].id === 'aaaaaaaa', [c.installs, c.people]);
  await post('/hello', hello({ id: id('b'), kind: 'us', handler: 'Tampermonkey', browser: 'firefox', os: 'linux' }), { ip: IPS[0] });
  c = await counts();
  check('two ids from one address (a reinstall): 2 installs, 1 person', c.installs === 2 && c.people === 1, [c.installs, c.people]);
  await post('/hello', hello({ id: id('c') }), { ip: IPS[1] }); await post('/hello', hello({ id: id('c') }), { ip: IPS[2] });
  c = await counts();
  check('one id from two addresses (home, then work): 1 more person', c.installs === 3 && c.people === 2, [c.installs, c.people]);
  await post('/hello', hello({ id: id('d') }), { ip: IPS[4] }); await post('/hello', hello({ id: id('e') }), { ip: IPS[5] });
  c = await counts();
  check('two ids from two addresses: 2 more people', c.installs === 5 && c.people === 4, [c.installs, c.people]);
  await post('/hello', hello({ id: id('f') }), { ip: IPS[6] }); await post('/hello', hello({ id: id('0') }), { ip: IPS[7] });
  c = await counts();
  check('two ids from one IPv6 /64 (the device\'s own part changing): 1 more person', c.installs === 7 && c.people === 5, [c.installs, c.people]);
  check('/admin/installs: active today, new by day (60), by version / kind / browser / system / manager, the recent ones', c.active.d1.people === 5 && c.active.d30.installs === 7 && c.newPerDay.length === 60 && c.newPerDay[59][1] === 7 && c.activePerDay[59][1] === 5 && c.by.kind.find(k => k[0] === 'us')[1] === 1 && c.by.handler.some(h => h[0] === 'Tampermonkey') && c.by.browser.length === 2 && c.by.os.length === 2 && c.recent.length === 7, c.active);
  check('... each recent install: its id cut to 8, its group\'s number - no address, no network', c.recent.every(r => r.id.length === 8 && r.cluster >= 1 && !('nets' in r) && !('ip' in r)) && new Set(c.recent.map(r => r.cluster)).size === 5 && !IPS.some(ip => JSON.stringify(c).includes(ip)), c.recent[0]);
  check('... the versions (the monitor not behind), the store on disk', c.versions && c.versions.monitor === VER && c.versions.latest === VER && c.versions.monitorBehind === false && /offline/.test(c.versions.err) && c.outdated.installs === 0, c.versions);
  { const a = await req('GET', '/admin/installs'), b = await req('GET', '/admin/options'), w = await req('GET', '/admin/installs', { token: 'wrong' }), p = await post('/admin/options', { notice: 'x' });
    check('/admin/installs and /admin/options: 401 without the secret or with a wrong one', a.status === 401 && b.status === 401 && w.status === 401 && p.status === 401, [a.status, b.status, w.status, p.status]); }
  { const b = await req('GET', '/badge');
    check('/badge: open to anyone, shields.io\'s format, the people counted, CORS * on it alone', b.status === 200 && b.headers['access-control-allow-origin'] === '*' && /max-age=600/.test(b.headers['cache-control'] || '') && JSON.stringify(b.body) === JSON.stringify({ schemaVersion: 1, label: 'users', message: '5', color: '1f6feb' }), [b.status, b.body]);
    const s = await req('GET', '/status');
    check('... no other answer gets CORS *', s.headers['access-control-allow-origin'] !== '*'); }
  { const s = (await req('GET', '/stats', own)).body || {};
    check('/stats: the installs in short, the versions, the options', s.installs && s.installs.people === 5 && s.installs.installs === 7 && s.versions && s.versions.monitorBehind === false && s.options && s.options.public === true && 'disk' in s, s.installs); }
  // ---- the options
  { const o = (await req('GET', '/admin/options', own)).body || {};
    check('/admin/options: notice, minVer, counting, public, rate - as started (rate: monitor.json\'s 300)', o.notice === '' && o.minVer === '' && o.counting === true && o.public === true && o.rate === 300, o);
    const bad = []; for (const b of [{ rate: -1 }, { rate: 10001 }, { rate: 1.5 }, { minVer: '22' }, { notice: 'x'.repeat(501) }, { counting: 'no' }, { public: 1 }, { colour: 'red' }, [1]]) bad.push((await post('/admin/options', b, own)).status);
    bad.push((await post('/admin/options', null, Object.assign({ raw: '{' }, own))).status);
    check('... a wrong value, an unknown option, not JSON: 400 and nothing changed', bad.every(s => s === 400) && ((await req('GET', '/admin/options', own)).body || {}).rate === 300, bad);
    const big = await post('/admin/options', null, Object.assign({ raw: JSON.stringify({ notice: 'x'.repeat(70000) }) }, own));
    check('... a body over 64 KB: 413', big.status === 413, big.status);
    const r = await post('/admin/options', { notice: 'New version out - please update.', minVer: '22.20.0' }, own);
    check('... set: answered with the options as they now are', r.status === 200 && r.body.ok === true && r.body.notice === 'New version out - please update.' && r.body.minVer === '22.20.0', r.body);
    const h = await post('/hello', hello(), { ip: IPS[0] });
    check('/hello gives the owner\'s notice and minVer', h.body && h.body.notice === 'New version out - please update.' && h.body.minVer === '22.20.0', h.body); }
  { await post('/admin/options', { counting: false }, own);
    const h = await post('/hello', hello({ id: id('9') }), { ip: IPS[8] });
    c = await counts();
    check('counting off: /hello still answers, nothing is counted', h.status === 200 && h.body.ok === 1 && c.installs === 7 && c.counting === false && !c.recent.some(r => r.id === '99999999'), [h.status, c.installs]); }
  { await post('/admin/options', { public: false, rate: 7 }, own);
    const l = await req('GET', '/live'), b = await req('GET', '/badge', { ip: '192.0.2.99' }), h = await post('/hello', hello(), { ip: IPS[0] });
    check('public off at once: nothing without the secret (a hello neither) - but the badge', l.status === 401 && h.status === 401 && b.status === 200, [l.status, h.status, b.status]); }
  const logLines = ((await req('GET', '/admin/log?n=300', own)).body || {}).lines || [];
  check('no address in the log', logLines.length > 0 && !IPS.some(ip => logLines.join('\n').includes(ip)));
  check('the monitor stopped cleanly (SIGTERM)', await stop(M) === 0);
  { const f = path.join(STORE, 'installs.json'), txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '', j = txt ? JSON.parse(txt) : {};
    check('installs.json written on stop: the 7 ids, the one sent with counting off not among them', Object.keys(j.ids || {}).length === 7 && !(id('9') in j.ids) && id('a') in j.ids, Object.keys(j.ids || {}).length);
    check('... networks as 16-hex hashes, at most 8 an id', Object.values(j.ids || {}).every(r => Array.isArray(r[8]) && r[8].length >= 1 && r[8].length <= 8 && r[8].every(n => /^[0-9a-f]{16}$/.test(n))) && j.ids[id('c')][8].length === 2);
    check('... and no address in it - nor anywhere in the store', !IPS.some(ip => txt.includes(ip)) && !IPS.some(ip => storeText().includes(ip)));
    const salt = path.join(STORE, 'hello-salt'), st = fs.existsSync(salt) ? fs.statSync(salt) : null;
    check('the key the networks are hashed with: made once, 32 random bytes, readable by the owner only (600)', st && fs.readFileSync(salt, 'utf8').trim().length === 64 && (process.platform === 'win32' || (st.mode & 0o777) === 0o600), st && (st.mode & 0o777).toString(8)); }

  // ---- restarted - and GitHub answering --------------------------------------------------------------------------
  M = await start('99.1.0');
  { const o = (await req('GET', '/admin/options', own)).body || {};
    check('the options kept across a restart', o.notice === 'New version out - please update.' && o.minVer === '22.20.0' && o.counting === false && o.public === false && o.rate === 7 && o.overridden.public === true, o);
    const l = await req('GET', '/live');
    check('... public off still', l.status === 401, l.status);
    c = await counts();
    check('the installs read back: 7 installs, 5 people', c.installs === 7 && c.people === 5, [c.installs, c.people]);
    check('latest from GitHub: the monitor is behind; every install runs an older version', c.versions.latest === '99.1.0' && c.versions.monitorBehind === true && c.outdated.installs === 7 && c.outdated.of === 7, [c.versions, c.outdated]);
    await post('/admin/options', { public: true, rate: 3, counting: true }, own);
    const h = await post('/hello', hello({ id: id('8') }), { ip: IPS[9] });
    check('/hello gives the newest version from GitHub', h.status === 200 && h.body.latest === '99.1.0', h.body);
    const got = []; for (let i = 0; i < 6; i++) got.push((await req('GET', '/live', { ip: IPS[9] })).status);
    const h2 = await post('/hello', hello({ id: id('8') }), { ip: IPS[9] });
    check('public on and rate 3 at once: past 3 a minute an address gets 429 - /hello too; the owner never', got[0] === 200 && got.includes(429) && h2.status === 429 && (await req('GET', '/live', Object.assign({ ip: IPS[9] }, own))).status === 200, got.concat(h2.status));
    const back = (await post('/admin/options', { public: null, rate: null }, own)).body || {};
    check('... public / rate null: back to the startup settings', back.public === true && back.rate === 300 && back.overridden.public === false && back.overridden.rate === false, back);
    check('... counting on again: counted', (await counts()).installs === 8); }
  await stop(M);
  fs.rmSync(STORE, { recursive: true, force: true });
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
