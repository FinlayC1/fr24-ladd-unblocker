// The unpacked extension updating itself (extension/update.html, update.js, background.js) in a real Chromium:
// Update on FR24's banner opens the update page next to FR24; the page finds the newer version (main's package.json), takes
// the list of its files at its tag (files.json) and every file, checks each one's SHA-256, writes them into the folder,
// deletes the old version's files the new one no longer has (and nothing else), and then "Refresh page" restarts the
// extension from its folder, and the new version, once started, loads FR24 again - running in both worlds.
// GitHub is answered here (a "v99.0.0" made from this build). Chrome's folder picker cannot be clicked in a test: the page
// is handed a folder of the browser's own private file system in its place (the same kind of handle, the same calls), and
// what was written there is then copied to the extension's real folder before the restart.
// Needs Playwright and Chromium (skipped without them).
// usage: node test/unit_selfupdate.cjs
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
let chromium = null;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(x => fs.existsSync(x));
if (!chromium) { console.log('(skipped: Playwright not found - PLAYWRIGHT_PATH=<its module dir>)'); process.exit(0); }
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const root = path.join(__dirname, '..'), src = path.join(root, 'dist', 'extension');
if (!fs.existsSync(path.join(src, 'files.json'))) { console.log('FAIL  dist/extension/files.json missing - npm run build'); process.exit(1); }
const BAR = '<nav class="bar">' + ['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'].map(l => `<button class="bar-btn"><svg class="ic" width="24" height="24" viewBox="0 0 24 24"><path d="M2 2h20"/></svg><span>${l}</span></button>`).join('') + '</nav>';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const walk = (d, pre = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name), pre + e.name + '/') : [pre + e.name]);

(async () => {
  const built = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')), OLDV = built.version, NEWV = '99.0.0';
  const list = JSON.parse(fs.readFileSync(path.join(src, 'files.json'), 'utf8'));
  check('files.json: this version, every file of the folder but itself, each with the SHA-256 of the file as built', list.version === OLDV && walk(src).filter(n => n !== 'files.json').sort().join() === Object.keys(list.files).sort().join() && Object.entries(list.files).every(([n, h]) => sha(fs.readFileSync(path.join(src, n))) === h));
  const zipNames = (() => { const z = fs.readFileSync(path.join(root, 'dist', 'fr24-ladd-unblocker-extension.zip')), out = []; for (let o = z.readUInt32LE(z.length - 6), i = 0; i < z.readUInt16LE(z.length - 12); i++) { const nl = z.readUInt16LE(o + 28); out.push(z.toString('utf8', o + 46, o + 46 + nl)); o += 46 + nl + z.readUInt16LE(o + 30) + z.readUInt16LE(o + 32); } return out; })();
  check('... and the zip has the update page and files.json', ['update.html', 'update.js', 'files.json'].every(n => zipNames.includes(n)), zipNames);

  // the installed one: this build, plus a file only the old version had (listed) and a file of the person's own (not listed)
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'tlself-'));
  fs.cpSync(src, ext, { recursive: true });
  fs.writeFileSync(path.join(ext, 'old-only.js'), '// gone in the next version\n');
  fs.writeFileSync(path.join(ext, 'my-notes.txt'), 'mine\n');
  const oldList = Object.assign({}, list, { files: Object.assign({}, list.files, { 'old-only.js': sha(fs.readFileSync(path.join(ext, 'old-only.js'))) }) });
  fs.writeFileSync(path.join(ext, 'files.json'), JSON.stringify(oldList, null, 2) + '\n');
  // the new one, as GitHub would serve it at v99.0.0
  const nu = fs.mkdtempSync(path.join(os.tmpdir(), 'tlnew-'));
  fs.cpSync(src, nu, { recursive: true });
  const sub = (f, a, b) => { const p = path.join(nu, f), s = fs.readFileSync(p, 'utf8'); if (!s.includes(a)) throw new Error(f + ': ' + a + ' not found'); fs.writeFileSync(p, s.split(a).join(b)); };
  sub('content.js', `const VERSION = '${OLDV}';`, `const VERSION = '${NEWV}';`);
  sub('page.js', `var BRIDGE_V = "${OLDV}";`, `var BRIDGE_V = "${NEWV}";`);
  fs.writeFileSync(path.join(nu, 'manifest.json'), JSON.stringify(Object.assign({}, built, { version: NEWV }), null, 2) + '\n');
  fs.writeFileSync(path.join(nu, 'files.json'), JSON.stringify({ version: NEWV, files: Object.fromEntries(walk(nu).filter(n => n !== 'files.json').map(n => [n, sha(fs.readFileSync(path.join(nu, n)))])) }, null, 2) + '\n');

  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'tlprof-')), { executablePath: exe, headless: true, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
  try {
    const gh = { asked: [], corrupt: '' };
    await ctx.route('https://www.flightradar24.com/**', route => /\/(mobile|api|common|v1|data)\//.test(route.request().url()) ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>FR24</title></head><body><div id="app"></div>' + BAR + '</body></html>' }));
    await ctx.route('https://raw.githubusercontent.com/**', route => {
      const u = new URL(route.request().url()), p = u.pathname; gh.asked.push(p);
      if (p === '/FinlayC1/fr24-ladd-unblocker/main/package.json') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ version: NEWV }) });
      if (p === '/FinlayC1/fr24-ladd-unblocker/main/CHANGELOG.md') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: `# Changelog\n\n## [${NEWV}] - 2026-10-30\n\n### Fixed\n- **The newest fix.** More words.\n\n### Tests\n- **Not a headline.**\n\n## [${OLDV}] - 2026-10-21\n\n### Fixed\n- **What this one already has.**\n` });
      if (p === '/FinlayC1/fr24-ladd-unblocker/v99.0.0/dist/fr24-ladd-unblocker-extension.zip') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(root, 'dist', 'fr24-ladd-unblocker-extension.zip')) });
      const m = p.match(/^\/FinlayC1\/fr24-ladd-unblocker\/v99\.0\.0\/dist\/extension\/(.+)$/), f = m && path.join(nu, m[1]);
      if (f && f.startsWith(nu + path.sep) && fs.existsSync(f)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: m[1] === gh.corrupt ? Buffer.from('not it') : fs.readFileSync(f) });
      return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    });
    const loaded = await (await ctx.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: ext }).catch(e => ({ err: String(e) }));
    check('the extension loads unpacked', !!loaded.id, loaded.err);
    // ---- a browser that lets no extension write to its own folder (Brave as it comes): by hand, the very version's zip
    { const mp = await ctx.newPage();
      await mp.addInitScript(() => { delete window.showDirectoryPicker; try { Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }); } catch (e) { /* gone */ } });
      await mp.goto(`chrome-extension://${loaded.id}/update.html`);
      await mp.waitForSelector('#manual:not([hidden])', { timeout: 10000 }).catch(() => null);
      check('by hand: the steps, and a Download button (no folder asked for)', await mp.isVisible('#manual') && await mp.isVisible('#dl') && !await mp.isVisible('#go'));
      const dl = mp.waitForEvent('download', { timeout: 10000 }).catch(() => null);
      await mp.click('#dl');
      const d = await dl, file = d ? await d.path().catch(() => '') : '';
      check('... Download saves v99.0.0\'s own zip (at its tag), named for the version', !!d && d.suggestedFilename() === 'fr24-ladd-unblocker-extension-v99.0.0.zip' && !!file && fs.readFileSync(file).equals(fs.readFileSync(path.join(root, 'dist', 'fr24-ladd-unblocker-extension.zip'))), d && d.suggestedFilename());
      await mp.waitForSelector('#news:not([hidden])', { timeout: 5000 }).catch(() => null);
      const nl = await mp.$$eval('#newsList li', ls => ls.map(l => l.textContent));
      check('... and what\'s new since this version: v99.0.0\'s headlines only (not its tests, not what this one has)', nl.join('|') === 'The newest fix', nl);
      await mp.close(); }
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    // (the newest version, as the monitor's answer to the daily hello gives it - kept in FR24's storage, src/main/06-hello.js;
    // GitHub's own answer comes through the service worker, which a test cannot answer for)
    await page.addInitScript(v => { try { localStorage.setItem('tweeks.fr24.ladd.hello1', JSON.stringify({ ans: { latest: v, at: Date.now() } })); } catch (e) { /* none */ } }, NEWV);
    await page.goto('https://www.flightradar24.com/53.40,-2.60/9');
    const bn = await page.waitForSelector('[data-tl-bn="upd"]', { timeout: 15000 }).catch(() => null);
    check('FR24: the banner says v99.0.0 is out', !!bn && (await bn.textContent()).includes('v' + NEWV), bn && await bn.textContent());

    // Update on the banner: the update page opens in the next tab, for this FR24 tab
    const opened = ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null);
    if (bn) await page.click('[data-tl-bn="upd"] [data-bn-act="update"]');
    const up = await opened;
    check('Update opens the extension\'s update page, told which tab FR24 is in', !!up && /\/update\.html#tab=\d+$/.test(up.url()), up && up.url());
    if (!up) throw new Error('no update page');
    const upErr = []; up.on('pageerror', e => upErr.push(String(e)));
    await up.waitForSelector('#go:not([hidden])', { timeout: 10000 }).catch(() => null);
    check('... it shows both versions, and asks for the folder the first time', (await up.textContent('#cur')) === 'v' + OLDV && (await up.textContent('#latest')).startsWith('v' + NEWV) && /Choose the extension folder/.test(await up.textContent('#go')) && await up.isVisible('#first'), [await up.textContent('#cur'), await up.textContent('#latest'), await up.textContent('#go')]);
    await page.waitForTimeout(300);
    check('... and the FR24 banner says to finish there', /Finish in the LADD Unblocker tab/.test(await page.textContent('[data-tl-bn="upd"]')));

    // the folder: a private one of the browser's, filled with the installed files that matter here (the same calls as a
    // folder on disk); a wrong one first
    const put = (name, b64) => up.evaluate(async ([dirName, name, b64]) => {
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(dirName, { create: true });
      const parts = name.split('/'), f = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
      const w = await (await d.getFileHandle(f, { create: true })).createWritable(); await w.write(Uint8Array.from(atob(b64), c => c.charCodeAt(0))); await w.close();
    }, ['ext', name, b64]);
    for (const n of ['manifest.json', 'content.js', 'old-only.js', 'my-notes.txt', 'files.json', 'grant.js']) await put(n, fs.readFileSync(path.join(ext, n)).toString('base64'));
    const wrong = await up.evaluate(async () => {
      const root = await navigator.storage.getDirectory(), d = await root.getDirectoryHandle('wrong', { create: true });
      const w = await (await d.getFileHandle('manifest.json', { create: true })).createWritable(); await w.write(JSON.stringify({ name: 'FR24 LADD Unblocker', version: '1.0.0' })); await w.close();
      const e = await root.getDirectoryHandle('empty', { create: true });
      return [await __tlUpdate.checkFolder(d), await __tlUpdate.checkFolder(e), await __tlUpdate.checkFolder(await root.getDirectoryHandle('ext'))];
    });
    check('a folder of another version, or with no manifest, is refused; the extension\'s own is taken', /isn't the folder Chrome loads/.test(wrong[0]) && /doesn't hold FR24 LADD Unblocker/.test(wrong[1]) && wrong[2] === '', wrong);

    gh.corrupt = 'data-2.js';
    const bad = await up.evaluate(() => __tlUpdate.getPlan('99.0.0').then(() => 'no error', e => e.message));
    check('a file that does not match its SHA-256 stops the update before anything is written', /checksum is wrong/.test(bad), bad);
    gh.corrupt = '';
    const notYet = await up.evaluate(() => __tlUpdate.getPlan('99.0.1').then(() => 'no error', e => e.message));
    check('a version whose release is not out yet: said so', /still being published/.test(notYet), notYet);

    // the click: Chrome's picker answered with that folder
    await up.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('ext'); window.showDirectoryPicker = async () => d; });
    await up.click('#go');
    await up.waitForSelector('#restart:not([hidden])', { timeout: 30000 }).catch(() => null);
    const msg = await up.textContent('#msg');
    check('Update: done, says the new version is installed, offers Refresh page', /Done: v99\.0\.0 is installed/.test(msg) && await up.isVisible('#restart') && !await up.isVisible('#go'), msg);
    const out = await up.evaluate(async () => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('ext'), files = {};
      const walk = async (h, pre) => { for await (const [n, e] of h.entries()) { if (e.kind === 'directory') await walk(e, pre + n + '/'); else { const b = new Uint8Array(await (await e.getFile()).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); files[pre + n] = btoa(s); } } };
      await walk(d, ''); return files;
    });
    const got = Object.fromEntries(Object.entries(out).map(([n, b]) => [n, Buffer.from(b, 'base64')]));
    const want = walk(nu);
    check('... the folder holds every file of v99.0.0, byte for byte', want.every(n => got[n] && got[n].equals(fs.readFileSync(path.join(nu, n)))), want.filter(n => !(got[n] && got[n].equals(fs.readFileSync(path.join(nu, n))))));
    check('... the old version\'s file the new one has no more is deleted; the person\'s own file is kept', !('old-only.js' in got) && got['my-notes.txt'] && got['my-notes.txt'].toString() === 'mine\n', Object.keys(got).filter(n => !want.includes(n)));
    check('... only this repository was asked, at the version\'s tag', gh.asked.every(p => p.startsWith('/FinlayC1/fr24-ladd-unblocker/main/package.json') || p.startsWith('/FinlayC1/fr24-ladd-unblocker/main/CHANGELOG.md') || p.startsWith('/FinlayC1/fr24-ladd-unblocker/v99.0.')), gh.asked.filter(p => !/^\/FinlayC1\/fr24-ladd-unblocker\/(main\/package\.json|v99\.0\.)/.test(p)));
    await page.waitForTimeout(300);
    const bnNow = await page.textContent('[data-tl-bn="upd"]').catch(() => '');
    check('FR24\'s banner: v99.0.0 is installed, with Refresh page', /v99\.0\.0 is installed/.test(bnNow) && !!await page.$('[data-tl-bn="upd"] [data-bn-act="restart"]'), bnNow);

    // what Chrome's folder picker would have given: the extension's real folder, written the same
    for (const n of walk(ext)) if (!(n in got)) fs.rmSync(path.join(ext, n));
    for (const [n, b] of Object.entries(got)) { fs.mkdirSync(path.dirname(path.join(ext, n)), { recursive: true }); fs.writeFileSync(path.join(ext, n), b); }

    // Refresh page (on the update page): the extension restarts from its folder, the page closes with it, FR24 loads again
    const nav = page.waitForEvent('framenavigated', { timeout: 15000 }).catch(() => null);
    await up.click('#restart');
    await nav; await page.waitForTimeout(2500);
    check('Refresh page: the update page closes as the extension restarts', up.isClosed());
    const bridge = await page.evaluate(() => window.__tweeksLaddBridge && window.__tweeksLaddBridge.v).catch(() => null);
    const b2 = await page.waitForSelector('nav.bar .tl-ub-btn', { timeout: 8000 }).catch(() => null);
    if (b2 && !await page.$('.tl-ub')) await b2.click();
    const shown = await page.waitForSelector('.tl-ub #tl-ub-upd', { timeout: 4000 }).then(e => e.textContent()).catch(() => '');
    check('... FR24 is loaded again by the new version, which runs in both worlds', bridge === NEWV && shown.includes('v' + NEWV), [bridge, shown.replace(/\s+/g, ' ').slice(0, 160)]);
    check('... no banner about updating any more', !await page.$('[data-tl-bn="upd"]'));
    check('no errors on FR24 or on the update page', !errors.length && !upErr.length, errors.concat(upErr).slice(0, 5));
  } finally { await ctx.close(); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
