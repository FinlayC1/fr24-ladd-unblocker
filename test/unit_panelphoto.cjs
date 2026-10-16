// A LADD aircraft's picture in FR24's panel, in a real browser: the BUILT userscript in Chromium (Playwright's) on a page
// made with Vue as FR24's is (test/fixtures/fr24mock.html?panel=photo: the panel's image box, FR24's slideshow - its
// pages, each slide's picture and copyright, its dots - and, with no picture, its fallback: a sideview in a wide, short
// frame). JNY5 (A793B2, a GLF5) and T7OKS (50049C) opened with a short picture - the sideview's frame, about 270 x 110
// where FR24's own pictures are about 270 x 150 - and a second credit of ours ("© Pablo Romero · JetPhotos ↗") at its
// bottom right beside FR24's own. Watched frame by frame, against an ordinary aircraft's picture as FR24 draws it:
//   - the pictures drawn by the userscript while FR24 still shows its fallback: FR24's photo size exactly, one credit, its
//     dots working, FR24's fallback hidden; nothing of FR24's own elements changed
//   - the pictures then handed to FR24 (its slideshow): ours gone, FR24's alone - its size, one credit, its dots
//   - FR24's slideshow coming within a moment of the pictures, or before them: nothing of ours drawn, not for one frame
//   - in no frame a picture shorter than FR24's own, or two credits
// Needs Playwright and Vue 3's browser build (skipped without): PLAYWRIGHT_PATH=<its module dir> CHROMIUM=<binary>
// VUE_PATH=<vue.global.js>. SHOTS=<dir> keeps screenshots.
// usage: node test/unit_panelphoto.cjs
const fs = require('fs'), path = require('path');
let chromium = null;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(x => fs.existsSync(x));
const vuePath = [process.env.VUE_PATH, path.join(__dirname, '..', 'node_modules', 'vue', 'dist', 'vue.global.js')].filter(Boolean).find(x => fs.existsSync(x));
if (!chromium) { console.log('(skipped: Playwright not found - PLAYWRIGHT_PATH=<its module dir>)'); process.exit(0); }
if (!vuePath) { console.log('(skipped: Vue 3 not found - VUE_PATH=<vue.global.js>)'); process.exit(0); }
const REPO = path.join(__dirname, '..');
const OUT = process.env.SHOTS || ''; if (OUT) fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => (OUT ? page.screenshot({ path: path.join(OUT, name + '.png') }) : Promise.resolve());
const SRC = fs.readFileSync(path.join(REPO, 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const VUE = fs.readFileSync(vuePath, 'utf8');
const MOCK = fs.readFileSync(path.join(__dirname, 'fixtures', 'fr24mock.html'), 'utf8');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// (the pictures: a JetPhotos one 640 x 427, a Planespotters one 280 x 187; the sideview 600 x 244)
const svg = (w, h, fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`;
const JP = 'https://cdn.jetphotos.com/640/6/710001_1790000001.jpg', PS = 'https://t.plnspttrs.net/72/1234567_9fcb21aa0e_280.jpg', JP0 = 'https://cdn.jetphotos.com/640/6/700000_1790000000.jpg';
const PHOTOS = [
  { link: 'https://www.jetphotos.com/photo/71', credit: 'Pablo Romero', thumb: JP, medium: JP, large: JP, source: 'JetPhotos' },
  { link: 'https://www.planespotters.net/photo/72', credit: 'yh0403_WSSS', thumb: PS, medium: PS, large: PS, source: 'Planespotters' }
];
// (FR24's imagesList as its stream gives it, the pictures handed over: what its slideshow draws)
const NATIVE = PHOTOS.map(p => ({ src: p.large, url: p.link, copyright: p.credit }));

const STUBS = `
window.GM_info = { scriptHandler: 'Tampermonkey', version: '5.3' };
window.unsafeWindow = window; window.GM_notification = () => {};
window.GM_xmlhttpRequest = o => { setTimeout(() => o.onload && o.onload({ status: 404, responseText: '', response: '' }), 2); return { abort() {} }; };
// (each frame: the picture drawn in the panel - its height - and the credits drawn)
window.__F = null;
(function probe() {
  const vis = el => { if (!el.isConnected) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let a = el; a && a.nodeType === 1; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } return true; };
  window.__look = () => {
    const panel = document.querySelector('[data-testid="aircraft-panel"]'); if (!panel) return null;
    const imgs = [...panel.querySelectorAll('img')].filter(vis), ph = imgs.find(i => /jetphotos|plnspttrs/.test(i.getAttribute('src') || '')), fb = imgs.find(i => /sideview/.test(i.getAttribute('src') || ''));
    const credits = [...panel.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && /©/.test(n.data)) && vis(e)).map(e => e.textContent.trim());
    // (the picture as seen: its box cut by every frame around it that clips - a sideview's frame is 110 px high)
    const seen = el => { const r = el.getBoundingClientRect(); let t = r.top, b = r.bottom, l = r.left, rt = r.right; for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).overflow === 'visible') continue; const c = a.getBoundingClientRect(); t = Math.max(t, c.top); b = Math.min(b, c.bottom); l = Math.max(l, c.left); rt = Math.min(rt, c.right); } return { h: Math.round(Math.max(0, b - t) * 10) / 10, w: Math.round(Math.max(0, rt - l)) }; };
    return { photo: ph ? Object.assign({ src: ph.getAttribute('src'), ours: !!ph.closest('.tl-photo') }, seen(ph)) : null, fb: !!fb, credits, ours: panel.querySelectorAll('.tl-photo').length, caps: panel.querySelectorAll('.tl-cap').length, swapped: panel.querySelectorAll('img[data-tl-val],img[data-tl-orig]').length };
  };
  const tick = () => { if (window.__F) { const l = window.__look(); if (l) window.__F.push(l); } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})();
`;

(async () => {
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u.includes('/__vue.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      if (/^https:\/\/www\.flightradar24\.com\/[0-9.,-]+\/\d+/.test(u)) return route.fulfill({ status: 200, contentType: 'text/html', body: MOCK });
      if (/cdn\.jetphotos\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(640, 427, '#3a6ea5') });
      if (/plnspttrs\.net/.test(u)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(280, 187, '#6a8f3a') });
      if (/sideviews/.test(u)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(600, 244, '#dddddd') });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript(src => { window.__SRC = src; }, SRC);
    await page.addInitScript({ content: STUBS + '\n;(function (go) { if (document.documentElement) return go(); const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); go(); } }); mo.observe(document, { childList: true }); })(function () { (0, eval)(window.__SRC); });' });
    await page.goto('https://www.flightradar24.com/52.83,-1.33/9?panel=photo');
    await page.waitForFunction(() => window.__tweeksLadd && window.__tweeksLadd.live && window.__P, null, { timeout: 15000 });
    const look = () => page.evaluate(() => window.__look());
    const rec = async (act, ms) => { await page.evaluate(() => { window.__F = []; }); await act(); await sleep(ms); return page.evaluate(() => { const f = window.__F; window.__F = null; return f; }); };
    // a LADD flight opened: the userscript's record of it (named, its pictures in), FR24's stream naming the flight
    const open = (id, hex, cs) => page.evaluate(([id, hex, cs, photos]) => {
      window.__tweeksLadd.live.set(id, { id, hex, cs, reg: '', type: 'GLF5', ladd: true, photos, photoV: 99, photoLevel: 2, photoAt: Date.now() });
      window.postMessage({ __tweeksLadd: 'follow', id }, '*');
    }, [id, hex, cs, PHOTOS]);

    // ---- an ordinary aircraft's picture as FR24 draws it: the size every picture must have
    await page.evaluate(([n]) => { window.__P.images = [n[0]]; window.__P.hex = '4CA7B1'; window.__P.cs = 'RYR8SF'; }, [NATIVE]);
    await sleep(400);
    const normal = await look();
    check('an ordinary aircraft\'s picture as FR24 draws it: its slideshow\'s size (16:9 of the panel), its one credit', !!normal.photo && Math.abs(normal.photo.h - normal.photo.w * 9 / 16) <= 1 && normal.credits.length === 1, normal);
    const H0 = normal.photo ? normal.photo.h : 0;
    await shot(page, 'normal');
    await page.evaluate(() => { window.__P.images = []; window.__P.n = 0; window.__P.hex = 'N/A'; window.__P.cs = 'N/A'; });
    await sleep(200);
    const fbOnly = await look();
    check('FR24 with no picture of the aircraft: its fallback, a sideview in a wide, short frame', fbOnly.fb && !fbOnly.photo && fbOnly.credits.length === 0, fbOnly);

    // ---- JNY5, the page unable to hand the pictures to FR24: drawn by the userscript in FR24's photo size
    let f = await rec(() => open(0x3c7b0001, 'a793b2', 'JNY5'), 2600);
    let L = await look();
    const shown = f.filter(x => x.photo);
    check('JNY5\'s pictures, FR24 still drawing its fallback: drawn in the panel', !!L.photo && L.photo.ours && L.photo.src === JP && L.ours === 1, L);
    check('... at FR24\'s own photo size, never the sideview\'s frame (every frame with a picture)', shown.length > 0 && shown.every(x => Math.abs(x.photo.h - H0) <= 1 && Math.abs(x.photo.w - normal.photo.w) <= 1), { H0, hs: [...new Set(shown.map(x => x.photo.h))] });
    check('... one credit, at no frame two: "© Pablo Romero"', f.every(x => x.credits.length <= 1) && L.credits.length === 1 && L.credits[0] === '© Pablo Romero', { L: L.credits, most: Math.max(...f.map(x => x.credits.length)) });
    check('... FR24\'s fallback hidden while it shows; none of FR24\'s own elements changed (no picture swapped, no caption added)', shown.every(x => !x.fb) && f.every(x => x.caps === 0 && x.swapped === 0), L);
    const before = await page.evaluate(() => { const a = document.querySelector('.tl-photo'), b = a && a.nextElementSibling; return { next: b && b.getAttribute('data-testid'), dots: document.querySelectorAll('.tl-photo-dots button').length }; });
    check('... in place of FR24\'s image box, with a dot for each picture', before.next === 'aircraft-panel__image' && before.dots === 2, before);
    await shot(page, 'ladd-ours');
    if (await page.$('.tl-photo-dots button[data-n="1"]')) await page.click('.tl-photo-dots button[data-n="1"]'); await sleep(150);
    L = await look();
    check('... its dots: the second picture, Planespotters\', at the same size, its credit alone', !!L.photo && L.photo.src === PS && Math.abs(L.photo.h - H0) <= 1 && L.credits.length === 1 && L.credits[0] === '© yh0403_WSSS', L);

    // ---- the pictures then reach FR24's slideshow: ours goes, FR24's alone
    f = await rec(() => page.evaluate(([n]) => { window.__P.images = n; }, [NATIVE]), 600);
    L = await look();
    check('FR24 then draws them itself: ours gone, FR24\'s slideshow alone', !!L.photo && !L.photo.ours && L.ours === 0 && L.photo.src === JP, L);
    check('... at the same size and with one credit, in every frame of the change', f.filter(x => x.photo).every(x => Math.abs(x.photo.h - H0) <= 1) && f.every(x => x.credits.length <= 1) && L.credits.length === 1 && L.credits[0] === '© Pablo Romero', { hs: [...new Set(f.filter(x => x.photo).map(x => x.photo.h))], credits: f.map(x => x.credits.length) });
    await page.click('[data-testid="carousel__dot__1"]'); await sleep(150);
    L = await look();
    check('... its dots working: the second picture, same size, one credit', !!L.photo && L.photo.src === PS && Math.abs(L.photo.h - H0) <= 1 && L.credits.length === 1 && L.ours === 0, L);
    await shot(page, 'ladd-fr24');

    // ---- T7OKS: FR24's slideshow with the pictures a moment after the record (the page handing them over): nothing of ours
    await page.evaluate(() => { window.__P.images = []; window.__P.n = 0; });
    f = await rec(async () => { await open(0x3c7b0002, '50049c', 'T7OKS'); await sleep(400); await page.evaluate(([n]) => { window.__P.images = n.slice().reverse(); }, [NATIVE]); }, 2500);
    L = await look();
    check('T7OKS: FR24\'s slideshow a moment after the pictures - nothing of ours drawn, not for one frame', f.every(x => x.ours === 0) && !!L.photo && !L.photo.ours && L.photo.src === PS, { ours: Math.max(...f.map(x => x.ours)), L });
    check('... its first slide at FR24\'s size, one credit: "© yh0403_WSSS"', f.filter(x => x.photo).every(x => Math.abs(x.photo.h - H0) <= 1) && L.credits.length === 1 && L.credits[0] === '© yh0403_WSSS', L);

    // ---- FR24's slideshow before the record (FR24's own pictures in its first answer): nothing of ours
    await page.evaluate(([src]) => { window.__P.images = [{ src, url: 'https://www.jetphotos.com/photo/70', copyright: 'FR24 own' }]; window.__P.n = 0; }, [JP0]);
    f = await rec(() => open(0x3c7b0003, 'a793b2', 'JNY5'), 2500);
    L = await look();
    check('FR24\'s own picture of the airframe first: it stands, nothing of ours over or beside it', f.every(x => x.ours === 0 && x.credits.length <= 1) && !!L.photo && L.photo.src === JP0 && Math.abs(L.photo.h - H0) <= 1, L);

    // ---- and FR24's slideshow emptied again (another stream, no pictures): ours back, at FR24's size
    f = await rec(() => page.evaluate(() => { window.__P.images = []; }), 2500);
    L = await look();
    check('FR24\'s slideshow gone again: the pictures back at FR24\'s size, one credit', !!L.photo && L.photo.ours && f.filter(x => x.photo).every(x => Math.abs(x.photo.h - H0) <= 1) && f.every(x => x.credits.length <= 1), L);
    check('no page errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) { fails++; console.log('FAIL  CRASH ' + (e && e.stack || e)); }
  await browser.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
