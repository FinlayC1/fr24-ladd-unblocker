// The browser extension (dist/extension) in a real Chromium: the service worker registers; on an FR24 page (served here)
// the page-world part is in FR24's own world and the script in the extension's isolated world, the two greet each other;
// requests to other sites go through the service worker (text, binary, POST bodies and headers, a timeout, an abort) -
// against a local server, with a copy of the extension that may also reach it. Needs Playwright and Chromium (skipped
// without them).
// usage: node test/unit_extension.cjs
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
let chromium = null;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(x => fs.existsSync(x));
if (!chromium) { console.log('(skipped: Playwright not found - PLAYWRIGHT_PATH=<its module dir>)'); process.exit(0); }
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const root = path.join(__dirname, '..'), src = path.join(root, 'dist', 'extension');
if (!fs.existsSync(path.join(src, 'manifest.json'))) { console.log('FAIL  dist/extension missing - npm run build'); process.exit(1); }
// (FR24's bottom bar, roughly: the LADD Unblock button joins it)
const BAR = '<nav class="bar">' + ['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'].map(l => `<button class="bar-btn"><svg class="ic" width="24" height="24" viewBox="0 0 24 24"><path d="M2 2h20"/></svg><span>${l}</span></button>`).join('') + '</nav>';
(async () => {
  // (a local server: a text answer that echoes the request, a binary file, a slow answer)
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url.startsWith('/echo')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ method: req.method, token: req.headers['x-monitor-token'] || '', body })); }
      else if (req.url.startsWith('/bin')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(Buffer.from([0, 1, 2, 253, 254, 255, 0x0e, 0x7f, 0x7c, 0x9d])); }
      else if (req.url.startsWith('/slow')) setTimeout(() => { try { res.writeHead(200); res.end('late'); } catch (e) { /* gone */ } }, 4000);
      else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  // (the extension as built, plus this server among its hosts)
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'tlext-'));
  fs.cpSync(src, ext, { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  const built = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  check('manifest: MV3, the page part in the page\'s own world at document start, then the script; no 127.0.0.1 or localhost among its hosts', built.manifest_version === 3 && built.content_scripts[0].world === 'MAIN' && built.content_scripts[0].run_at === 'document_start' && built.content_scripts[1].js[built.content_scripts[1].js.length - 1] === 'content.js' && built.content_scripts[1].js.slice(0, -1).every(f => /^data-\d+\.js$/.test(f)) && !built.host_permissions.some(h => /127\.0\.0\.1|localhost/.test(h)) && built.host_permissions.includes('https://*.sslip.io/*'), built.host_permissions.length);
  // (the Firefox zip: what addons.mozilla.org's check asks - a background script, the add-on's id - the rest as Chrome's,
  // and no file it reads over 5 MB)
  {
    const zlib = require('zlib'), z = fs.readFileSync(path.join(root, 'dist', 'fr24-ladd-unblocker-firefox.zip')), files = {};
    for (let o = z.readUInt32LE(z.length - 6), i = 0; i < z.readUInt16LE(z.length - 12); i++) {
      const nl = z.readUInt16LE(o + 28), el = z.readUInt16LE(o + 30), cl = z.readUInt16LE(o + 32), lo = z.readUInt32LE(o + 42), name = z.toString('utf8', o + 46, o + 46 + nl);
      const start = lo + 30 + z.readUInt16LE(lo + 26) + z.readUInt16LE(lo + 28);
      files[name] = zlib.inflateRawSync(z.subarray(start, start + z.readUInt32LE(o + 20)));
      o += 46 + nl + el + cl;
    }
    const ff = JSON.parse(files['manifest.json']), g = ff.browser_specific_settings && ff.browser_specific_settings.gecko;
    const same = k => JSON.stringify(ff[k]) === JSON.stringify(built[k]);
    check('the Firefox zip: a background script, no service worker; its add-on id and data collection said; the same version, hosts and scripts as Chrome\'s', ff.background && ff.background.scripts && ff.background.scripts[0] === 'background.js' && !ff.background.service_worker && g && g.id === 'ladd-unblocker-fr24@finlayc1.github.io' && g.data_collection_permissions && Array.isArray(g.data_collection_permissions.required) && ['version', 'host_permissions', 'optional_host_permissions', 'content_scripts'].every(same) && !('minimum_chrome_version' in ff), ff.background);
    const big = Object.entries(files).filter(([n, b]) => !/\.png$/.test(n) && b.length >= 5 * 1024 * 1024).map(([n]) => n);
    check('... every file in it as built, none of its scripts 5 MB or more', Object.keys(files).filter(n => n !== 'manifest.json').every(n => fs.existsSync(path.join(src, n)) && fs.readFileSync(path.join(src, n)).equals(files[n])) && !big.length, big);
  }
  man.host_permissions.push('http://127.0.0.1/*');
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(man));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'tlprof-')), { executablePath: exe, headless: true, args: ['--disable-extensions-except=' + ext, '--load-extension=' + ext] });
  try {
    await ctx.route('https://www.flightradar24.com/**', route => { const u = route.request().url(); if (/\/(mobile|api|common|v1|data)\//.test(u)) return route.fulfill({ status: 404, body: '' }); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>FR24</title></head><body><div id="app"></div>' + BAR + '</body></html>' }); });
    let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
    check('the service worker runs', !!sw && /background\.js$/.test(sw.url()), sw && sw.url());
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && /content\.js|page\.js|background\.js/.test(m.location().url || '')) errors.push(m.text()); });
    await page.goto('https://www.flightradar24.com/53.40,-2.60/9');
    await page.waitForTimeout(3000);
    check('on FR24: the page-world part is in FR24\'s own world', await page.evaluate(() => !!(window.__tweeksLaddBridge && window.__tweeksLaddBridge.stats)));
    const cdp = await ctx.newCDPSession(page), ctxs = [];
    cdp.on('Runtime.executionContextCreated', e => ctxs.push(e.context));
    await cdp.send('Runtime.enable'); await page.waitForTimeout(400);
    const iso = ctxs.find(c => c.auxData && c.auxData.type === 'isolated' && /LADD/.test(c.name));
    const ev = async expr => { const r = await cdp.send('Runtime.evaluate', { expression: expr, contextId: iso.id, awaitPromise: true, returnByValue: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value; };
    check('... the script in the extension\'s isolated world, the same version as the page part, the two greeting each other', !!iso && await ev('__tweeksLadd.version') === man.version && await ev('__tweeksLadd.bridgeV') === man.version && await ev('__tweeksLadd.msgCount.ready >= 1'), iso && { v: await ev('__tweeksLadd.version'), bridge: await ev('__tweeksLadd.bridgeV') });
    // (the health check: the page part's counters reach the script's world - it cannot read the page's objects)
    await page.evaluate(() => { window.__tweeksLaddBridge.stats.maskDisabled = true; });
    await ev('__tweeksLadd.checkHealth()'); await page.waitForTimeout(400); await ev('__tweeksLadd.checkHealth()');
    const issues = await ev('__tweeksLadd.health.issues');
    check('... the health check sees the page part\'s counters (FR24 refusing the unlocked fields)', Array.isArray(issues) && issues.some(x => /refused the request for the unlocked fields/.test(x)), issues);
    await page.evaluate(() => { window.__tweeksLaddBridge.stats.maskDisabled = false; });
    check('... the page part injected once (not again by the script)', await page.evaluate(() => document.querySelectorAll('script').length) === 0);
    const gm = o => ev(`new Promise(r => { const t0 = Date.now(); const h = GM_xmlhttpRequest(Object.assign(${JSON.stringify(o)}, { onload: x => r({ status: x.status, text: x.responseText, bin: x.response instanceof ArrayBuffer ? Array.from(new Uint8Array(x.response)) : null, ms: Date.now() - t0 }), onerror: e => r({ error: e.error }), ontimeout: () => r({ timeout: true, ms: Date.now() - t0 }), onabort: () => r({ aborted: true }) })); ${o.abortAfter ? `setTimeout(() => h.abort(), ${o.abortAfter});` : ''} })`);
    const a = await gm({ url: base + '/echo?x=1', headers: { 'X-Monitor-Token': 'abc', Accept: 'application/json' } });
    check('requests through the service worker: a text answer, with the request\'s headers', a.status === 200 && JSON.parse(a.text).token === 'abc' && JSON.parse(a.text).method === 'GET', a);
    const p = await gm({ url: base + '/echo', method: 'POST', data: JSON.stringify({ flights: [[1, 2]] }), headers: { 'Content-Type': 'application/json' } });
    check('... a POST with its body (the report to the monitor)', p.status === 200 && JSON.parse(JSON.parse(p.text).body).flights[0][1] === 2, p);
    const b = await gm({ url: base + '/bin', responseType: 'arraybuffer' });
    check('... a binary answer, byte for byte (adsb.lol\'s heatmaps)', JSON.stringify(b.bin) === JSON.stringify([0, 1, 2, 253, 254, 255, 14, 127, 124, 157]), b);
    const t = await gm({ url: base + '/slow', timeout: 800 });
    check('... a timeout', t.timeout === true && t.ms < 3000, t);
    const ab = await gm({ url: base + '/slow', abortAfter: 300 });
    check('... an abort', ab.aborted === true, ab);
    const n = await gm({ url: base + '/nothing' });
    check('... an HTTP error answered as such (404)', n.status === 404, n);
    // (the same local server under another name - localhost, which the manifest does not grant: the browser's cross-origin
    // rules apply, and the server sends no permission for them)
    const before = seen.length, off = await gm({ url: base.replace('127.0.0.1', 'localhost') + '/echo' });
    check('... a host the manifest does not grant: its answer withheld from the script (the same server under another name)', !!off.error && !off.status, { off, served: seen.length - before });
    // (a monitor of the user's own at an address the manifest does not list: the browser's page to allow it opens; one it
    // lists needs nothing)
    const listed = await ev('TL_HOST_ACCESS("https://api.adsb.lol")');
    const tabP = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), other = await ev('TL_HOST_ACCESS("https://monitor.example.org")'), tab = await tabP;
    if (tab) await tab.waitForLoadState().catch(() => {});
    const shown = tab ? await tab.evaluate(() => ({ origin: document.getElementById('origin').textContent, button: !document.getElementById('allow').disabled })).catch(e => String(e)) : null;
    check('own monitor: an address the manifest lists is reachable as it is; another opens the extension\'s page asking the user to allow it', listed === true && other === false && !!tab && /grant\.html#/.test(tab.url()) && shown && shown.origin === 'https://monitor.example.org' && shown.button === true, { listed, other, url: tab && tab.url(), shown });
    const bad = await ev('TL_HOST_ACCESS("http://monitor.example.org")');
    check('... nothing asked for an address that is not https', bad === false && ctx.pages().filter(x => /grant\.html/.test(x.url())).length === 1);
    check('manifest: any https address only as an optional host (asked for, never granted at install)', JSON.stringify(built.optional_host_permissions) === '["https://*/*"]' && !built.host_permissions.includes('https://*/*'));
    // (the LADD Unblock button on FR24's bar, its window, and "Reload extension" - after the folder's files were replaced
    // with a new version, as an update by hand does: the new one is what runs afterwards)
    const ubBtn = await page.waitForSelector('nav.bar .tl-ub-btn', { timeout: 5000 }).catch(() => null);
    check('LADD Unblock: its button on FR24\'s bar', !!ubBtn && await page.evaluate(() => document.querySelector('nav.bar').lastElementChild.textContent) === 'LADD Unblock');
    if (ubBtn) await ubBtn.click();
    const updTxt = await page.waitForSelector('.tl-ub #tl-ub-upd', { timeout: 3000 }).then(e => e.textContent()).catch(() => '');
    check('... its window: this version, an unpacked extension, with Reload extension', updTxt.includes('v' + man.version) && /Browser extension \(unpacked\)/.test(updTxt) && !!await page.$('.tl-ub [data-ub-act="reloadExt"]'), updTxt.replace(/\s+/g, ' '));
    check('no errors from the extension on the page', errors.length === 0, errors.slice(0, 5));
  } finally { await ctx.close(); srv.close(); }
  // "Reload extension" in the window, as an update by hand uses it: the folder's files replaced with a new version, then the
  // button - the extension restarts from its folder and FR24 reloads with the new one. (Loaded the way "Load unpacked" loads
  // it: an extension given on the command line is dropped by a reload instead.)
  {
    const ext2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tlext-'));
    fs.cpSync(src, ext2, { recursive: true });
    const ctx2 = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'tlprof-')), { executablePath: exe, headless: true, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
    try {
      await ctx2.route('https://www.flightradar24.com/**', route => /\/(mobile|api|common|v1|data)\//.test(route.request().url()) ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>FR24</title></head><body><div id="app"></div>' + BAR + '</body></html>' }));
      const loaded = await (await ctx2.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: ext2 }).catch(e => ({ err: String(e) }));
      const page = await ctx2.newPage(), errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto('https://www.flightradar24.com/53.40,-2.60/9');
      const verShown = async () => { const b = await page.waitForSelector('nav.bar .tl-ub-btn', { timeout: 8000 }).catch(() => null); if (!b) return ''; if (!await page.$('.tl-ub')) await b.click(); return page.waitForSelector('.tl-ub #tl-ub-upd', { timeout: 3000 }).then(e => e.textContent()).catch(() => ''); };
      const before = await verShown();
      check('Reload extension (loaded unpacked): offered in the window of this version', !!loaded.id && before.includes('v' + built.version) && !!await page.$('.tl-ub [data-ub-act="reloadExt"]'), loaded.err || before.replace(/\s+/g, ' '));
      const NEWV = '99.0.0';
      fs.writeFileSync(path.join(ext2, 'content.js'), fs.readFileSync(path.join(ext2, 'content.js'), 'utf8').replace(`const VERSION = '${built.version}';`, `const VERSION = '${NEWV}';`));
      fs.writeFileSync(path.join(ext2, 'page.js'), fs.readFileSync(path.join(ext2, 'page.js'), 'utf8').replace(`var BRIDGE_V = "${built.version}";`, `var BRIDGE_V = "${NEWV}";`));
      fs.writeFileSync(path.join(ext2, 'manifest.json'), JSON.stringify(Object.assign({}, built, { version: NEWV }), null, 2));
      const nav = page.waitForEvent('framenavigated', { timeout: 10000 }).catch(() => null);
      if (await page.$('.tl-ub [data-ub-act="reloadExt"]')) await page.click('.tl-ub [data-ub-act="reloadExt"]');
      await nav; await page.waitForTimeout(1500);
      const after = await verShown();
      check('... after the files are replaced: the extension restarts, FR24 reloads, the new version runs in both worlds', after.includes('v' + NEWV) && await page.evaluate(() => window.__tweeksLaddBridge && window.__tweeksLaddBridge.v) === NEWV, after.replace(/\s+/g, ' '));
      check('... no errors on the page', errors.length === 0, errors.slice(0, 5));
    } finally { await ctx2.close(); }
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
