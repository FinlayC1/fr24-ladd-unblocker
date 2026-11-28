// 1.4.3, the old log pages' playback map drawn as FR24's main map draws a trail, in a real browser: the BUILT page part
// (dist, its pageInterceptor alone) in Chromium (Playwright's) with a stand-in for Google's map (the few calls the page
// part makes: a Mercator map, its panes, its projection), on a page as FR24's: its build files listed by its loader.
//   - the trail: its line see-through (FR24's 100 of 255), never darker where its pieces meet; its dots its own colour,
//     opaque - none black; the colours FR24's own function gives (from FR24's build file, here a stand-in of that shape)
//   - the dot under the pointer white; FR24's tooltip - white, rounded, its tip, "Time: UTC hh:mm:ss", "Ground speed",
//     "Altitude" in the main map's units - only where the main map has "Show trail tooltip" on; gone a moment after
//   - the main map's style: FR24's own styled map type of it, from its build file (its literal read as JSON), the style's
//     colour behind the tiles; Google's own types as they are; an unknown style hybrid
//   - the main map's brightness: a black sheet over the tiles in the lowest pane, 1 - brightness; none at 100
//   - the day and night line: the night's four shades where it is night at the moment played, none where it is day;
//     off: no shade
//   - a hole of two minutes and more in FR24's own track (five where the track is sparse): a thin dotted line
// Needs Playwright (skipped without): PLAYWRIGHT_PATH=<its module dir> CHROMIUM=<binary>. SHOTS=<dir> keeps screenshots.
// usage: node test/unit_trailmap.cjs
const fs = require('fs'), path = require('path');
let chromium = null;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find(x => fs.existsSync(x) && fs.statSync(x).isFile());
if (!chromium) { console.log('(skipped: Playwright not found - PLAYWRIGHT_PATH=<its module dir>)'); process.exit(0); }
const REPO = path.join(__dirname, '..');
const OUT = process.env.SHOTS || ''; if (OUT) fs.mkdirSync(OUT, { recursive: true });
const DIST = fs.readFileSync(path.join(REPO, 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8').split('\n');
const at = DIST.indexOf('  function pageInterceptor() {'), end = DIST.findIndex((l, i) => i > at && l === '  }');
if (at < 0 || end < 0) { console.log('FAIL  the page part not found in dist'); process.exit(1); }
const PAGE = DIST.slice(at, end + 1).join('\n');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// (a stand-in for Google's map: what the page part asks of it)
const FAKE_GM = `
(function () {
  const wx = (lon, z) => (lon + 180) / 360 * 256 * Math.pow(2, z);
  const wy = (lat, z) => { const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); };
  const lonOf = (x, z) => x / (256 * Math.pow(2, z)) * 360 - 180;
  const latOf = (y, z) => { const n = Math.PI - 2 * Math.PI * y / (256 * Math.pow(2, z)); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  function LatLng(lat, lng) { if (lat && typeof lat === 'object') { lng = lat.lng; lat = lat.lat; } this._a = lat; this._o = lng; }
  LatLng.prototype.lat = function () { return this._a; }; LatLng.prototype.lng = function () { return this._o; };
  function Point(x, y) { this.x = x; this.y = y; }
  function LatLngBounds() { this.s = 90; this.n = -90; this.w = 1e9; this.e = -1e9; }
  LatLngBounds.prototype.extend = function (ll) { this.s = Math.min(this.s, ll.lat()); this.n = Math.max(this.n, ll.lat()); this.w = Math.min(this.w, ll.lng()); this.e = Math.max(this.e, ll.lng()); return this; };
  function Registry() { this.m = {}; } Registry.prototype.get = function (k) { return this.m[k]; }; Registry.prototype.set = function (k, v) { this.m[k] = v; };
  function StyledMapType(styles, o) { this.styles = styles; this.name = o && o.name; }
  function Map(host, o) {
    this.host = host; this.o = Object.assign({}, o); this.z = o.zoom; this.c = { lat: o.center.lat, lng: o.center.lng }; this.ls = {}; this.mapTypes = new Registry(); this.ovs = [];
    host.style.position = 'relative'; host.style.overflow = 'hidden';
    const gs = document.createElement('div'); gs.className = 'gm-style'; gs.style.cssText = 'position:absolute;z-index:0;left:0;top:0;right:0;bottom:0;background:' + (o.backgroundColor || '#eaeaea'); host.appendChild(gs);
    this.cont = document.createElement('div'); this.cont.style.cssText = 'position:absolute;left:0;top:0'; gs.appendChild(this.cont);
    // (the map's own picture: a mid grey, under the panes)
    this.tiles = document.createElement('div'); this.tiles.style.cssText = 'position:absolute;left:-5000px;top:-5000px;width:20000px;height:20000px;background:#808080'; this.cont.appendChild(this.tiles);
    this.panes = {}; ['mapPane', 'overlayLayer', 'markerLayer', 'overlayMouseTarget', 'floatPane'].forEach((n, i) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;top:0;z-index:' + (100 + i); this.cont.appendChild(d); this.panes[n] = d; });
    window.__gmap = this; this.place();
  }
  Map.prototype.place = function () { const w = this.host.clientWidth, h = this.host.clientHeight; this.tiles.style.left = (wx(this.c.lng, this.z) - 10000) + 'px'; this.tiles.style.top = (wy(this.c.lat, this.z) - 10000) + 'px'; this.cont.style.left = (w / 2 - wx(this.c.lng, this.z)) + 'px'; this.cont.style.top = (h / 2 - wy(this.c.lat, this.z)) + 'px'; };
  Map.prototype.fire = function (ev, a) { (this.ls[ev] || []).forEach(f => f(a)); };
  Map.prototype.changed = function () { this.place(); this.fire('bounds_changed'); this.ovs.forEach(o => o.draw()); };
  Map.prototype.getZoom = function () { return this.z; };
  Map.prototype.setZoom = function (z) { this.z = z; this.changed(); };
  Map.prototype.getCenter = function () { return new LatLng(this.c.lat, this.c.lng); };
  Map.prototype.setCenter = function (ll) { this.c = { lat: ll.lat(), lng: ll.lng() }; this.changed(); };
  Map.prototype.setOptions = function (o) { Object.assign(this.o, o); (window.__gmOpts = window.__gmOpts || []).push(JSON.parse(JSON.stringify(o))); };
  Map.prototype.addListener = function (ev, f) { (this.ls[ev] = this.ls[ev] || []).push(f); return { remove() {} }; };
  Map.prototype.getDiv = function () { return this.host; };
  Map.prototype.fitBounds = function (b) { const w = this.host.clientWidth, h = this.host.clientHeight; let z = 15; for (; z > 1; z--) if (wx(b.e, z) - wx(b.w, z) < w * 0.8 && wy(b.s, z) - wy(b.n, z) < h * 0.8) break; this.z = z; this.c = { lat: latOf((wy(b.s, z) + wy(b.n, z)) / 2, z), lng: (b.w + b.e) / 2 }; this.changed(); };
  Map.prototype.getProjection = function () { return { fromLatLngToPoint: ll => new Point(wx(ll.lng(), 0), wy(ll.lat(), 0)), fromPointToLatLng: p => new LatLng(latOf(p.y, 0), lonOf(p.x, 0)) }; };
  function OverlayView() {}
  OverlayView.prototype.setMap = function (m) { this.map = m; m.ovs.push(this); this.onAdd(); this.draw(); };
  OverlayView.prototype.getPanes = function () { return this.map.panes; };
  OverlayView.prototype.getProjection = function () { const m = this.map; return { fromLatLngToDivPixel: ll => new Point(wx(ll.lng(), m.z), wy(ll.lat(), m.z)), getWorldWidth: () => 256 * Math.pow(2, m.z) }; };
  window.google = { maps: { Map, OverlayView, LatLng, LatLngBounds, Point, StyledMapType, MapTypeId: { HYBRID: 'hybrid', ROADMAP: 'roadmap', SATELLITE: 'satellite', TERRAIN: 'terrain' } } };
})();`;

// (FR24's build as this page lists it - stand-ins of the shapes the page part reads, written for this test: the loader
// naming its files, its map's file with its styles and their colours as literals, its trail colour function)
const LOADER = 'export const deps = ["assets/googleMapsProvider-Tst2.js", "assets/aircraftLayerHelpers-Tst3.js"];';
const PROVIDER = 'const g={GRAYSCALE:"simple_style"};const x=1,Ce={[g.GRAYSCALE]:[{featureType:"landscape",elementType:"all",stylers:[{saturation:-100},{lightness:-20}]},{featureType:"road",elementType:"all",stylers:[{visibility:"off"},{weight:.5}]}],[g.RADAR_DARK]:[{elementType:"geometry",stylers:[{color:"#828e97"},{invert_lightness:!1}]}]},ue={[g.GRAYSCALE]:{name:"Grayscale",backgroundColor:"#ededed"},[g.RADAR_DARK]:{name:"Radar (dark)",backgroundColor:"#828e97"},[g.HYBRID]:{name:"Hybrid",backgroundColor:"#4f5f96"}};export{Ce,ue};';
const HELPERS = 'function d(f){return f<=100?"#ffffff":f>12000?"#ff0000":f>5000?"#0000ff":"#00ff00"}const s=(a,b)=>a+b;export{d as m,s};';
const HTML = '<!doctype html><html><head><meta charset="utf-8"><link rel="modulepreload" href="https://www.flightradar24.com/build/assets/__modulepreload__-Tst1.js"></head><body style="margin:0"><div id="wrap" style="position:relative;width:800px;height:500px"><div id="tl-cl-gmap" style="width:800px;height:500px"></div></div></body></html>';

(async () => {
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
    await page.route('**/*', route => {
      const u = route.request().url();
      const js = b => route.fulfill({ status: 200, contentType: 'text/javascript', body: b });
      if (/\/data\/aircraft\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
      if (/__modulepreload__-Tst1\.js/.test(u)) return js(LOADER);
      if (/googleMapsProvider-Tst2\.js/.test(u)) return js(PROVIDER);
      if (/aircraftLayerHelpers-Tst3\.js/.test(u)) return js(HELPERS);
      if (/airport_pin_40_blue\.png/.test(u)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 404, body: '' });
    });
    // (the page part as the userscript puts it in: once the page has its elements)
    await page.addInitScript({ content: 'window.__tlTestHook = o => { window.__T = o; };\n' + FAKE_GM + '\n;document.addEventListener("DOMContentLoaded", function () { (' + PAGE + ')(); });' });
    await page.goto('https://www.flightradar24.com/data/aircraft/g-test');
    await page.waitForFunction(() => window.__T && window.__T.clmOp, null, { timeout: 15000 });
    const post = d => page.evaluate(d => window.postMessage(Object.assign({ __tweeksLadd: 'clMap' }, d), location.origin), d);

    // ---- the pieces, as they are read --------------------------------------------------------------------------------
    {
      const r = await page.evaluate(() => {
        const T = window.__T;
        const lit = 'x={[g.GRAYSCALE]:[{a:1,b:"x,y:z",c:.5,d:-.25,e:!0,f:!1,g:1.2}]},y=2';
        const j = T.clmLitJson(T.clmLitAt(lit, 2));
        return { j, n1: T.clmNum(24000, 0), n2: T.clmNum(1234567.891, 3), n3: T.clmNum(0.5811, 3) };
      });
      check('FR24\'s literal read as JSON: its enum key named, plain names quoted, .5 and -.25, !0 and !1, a string kept as it is', JSON.stringify(r.j) === JSON.stringify({ GRAYSCALE: [{ a: 1, b: 'x,y:z', c: 0.5, d: -0.25, e: true, f: false, g: 1.2 }] }), r.j);
      check('numbers as FR24 writes them: thousands with commas, its places', r.n1 === '24,000' && r.n2 === '1,234,567.891' && r.n3 === '0.581', r);
      const sun = await page.evaluate(() => [Date.UTC(2026, 2, 20, 12, 0), Date.UTC(2026, 5, 21, 12, 0), Date.UTC(2026, 11, 21, 0, 0)].map(t => window.__T.clmSun(t)));
      check('the sun overhead: at the March equinox noon UTC on the equator near Greenwich', Math.abs(sun[0].lat) < 0.6 && Math.abs(sun[0].lon) < 3, sun[0]);
      check('... at the June solstice noon 23.4 N near Greenwich; at the December one midnight 23.4 S near the date line', Math.abs(sun[1].lat - 23.44) < 0.1 && Math.abs(sun[1].lon) < 3 && Math.abs(sun[2].lat + 23.44) < 0.1 && Math.abs(Math.abs(sun[2].lon) - 180) < 3, sun.slice(1));
      const ring = await page.evaluate(() => { const T = window.__T, a = T.clmRing({ lat: 0, lon: 170 }, 72), b = T.clmRing({ lat: -23.4, lon: 0 }, 89.433334); let step = 0; for (let i = 0; i < a.length; i++) { const p = a[i], q = a[(i + 1) % a.length]; step = Math.max(step, Math.abs(q[0] - p[0])); } return { aN: a.length, aSpan: Math.max(...a.map(p => p[0])) - Math.min(...a.map(p => p[0])), step, east: Math.max(...a.map(p => p[0])), b0: b[0], bEnd: b.slice(-3), bMaxLat: Math.max(...b.map(p => p[1])) }; });
      check('a ring clear of the poles: its longitudes one run - on past the date line (to 242 E), no jump - and closed', ring.aN === 360 && Math.abs(ring.aSpan - 144) < 0.5 && Math.abs(ring.east - 242) < 0.5 && ring.step < 10, ring);
      check('a ring about a pole: from -180 to 180 and closed along the map\'s foot (85.05 S)', ring.b0[0] === -180 && ring.bEnd[0][0] === 180 && ring.bEnd[1][1] === -85.051129 && ring.bEnd[2][0] === -180, ring);
    }

    // ---- the map, as the main map has it: radar (dark), 80 % bright, the day and night line, the tooltip on -------
    // (a flight over the sea west of Ireland at 06:00 UTC on 21 Dec: night there; its points a minute apart, one hole of
    // three minutes - two of FR24's minutes - and the first point low)
    const T0 = Date.UTC(2026, 11, 21, 6, 0) / 1000;
    const pts = []; for (let i = 0; i <= 40; i++) { const t = T0 + i * 60 + (i > 20 ? 180 : 0); pts.push([t, 53 + i * 0.02, -15 + i * 0.1, i === 0 ? 0 : 3000 + i * 1000, 300 + i, 90]); }
    await post({ op: 'init', type: 'radar_style2', set: { style: 'radar_style2', brightness: 80, night: true, tip: true, alt: 'ft', spd: 'kt' } });
    await page.waitForFunction(() => window.__T.clm.map && window.__T.clm.fs && window.__T.clm.col, null, { timeout: 15000 });
    await post({ op: 'track', pts, o: null, d: null, cover: 0, set: { style: 'radar_style2', brightness: 80, night: false, tip: true, alt: 'ft', spd: 'kt' } });
    await post({ op: 'pos', lat: pts[10][1], lon: pts[10][2], trk: 90, follow: false, cover: 0, t: pts[10][0] });
    await sleep(400);
    const st = await page.evaluate(() => { const c = window.__T.clm, m = window.__gmap; return { type: c.type, mt: m.o.mapTypeId, reg: m.mapTypes.get('radar_style2') ? { name: m.mapTypes.get('radar_style2').name, n: m.mapTypes.get('radar_style2').styles.length } : null, bg: m.host.firstElementChild.style.backgroundColor, dim: c.dim && c.dim.parentNode === m.panes.mapPane ? c.dim.style.opacity : null, gap: c.gap, cols: [c.cols[0], c.cols[1], c.cols[20]] }; });
    check('the main map\'s style: FR24\'s own styled map of it, from its build (its name, its rules)', st.type === 'radar_style2' && st.mt === 'radar_style2' && st.reg && st.reg.name === 'Radar (dark)' && st.reg.n === 1, st);
    check('... the style\'s own colour behind the tiles', st.bg === 'rgb(130, 142, 151)', st.bg);
    check('the main map\'s brightness (80): a black sheet in the lowest pane at 0.2', st.dim !== null && Math.abs(Number(st.dim) - 0.2) < 1e-9, st.dim);
    check('the trail\'s colours FR24\'s own function gives (from its build): white on the ground, by height (4,000 ft green, 23,000 ft blue)', st.cols[0] === '#ffffff' && st.cols[1] === '#00ff00' && st.cols[2] === '#0000ff', st.cols);
    check('a hole: FR24\'s two minutes where the track is a point a minute', st.gap === 120, st.gap);
    if (OUT) await page.screenshot({ path: path.join(OUT, 'trail.png') });
    // (the trail's pixels on its canvas: the line's see-through, the dots opaque and their own colour)
    const px = await page.evaluate(() => {
      const c = window.__T.clm, g = c.cv.getContext('2d'), W = c.cv.width, H = c.cv.height, d = g.getImageData(0, 0, W, H).data, sp = c.sp;
      const at = (x, y) => { x = Math.round(x); y = Math.round(y); const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
      // (half way between two points a minute apart: the line alone; a point: its dot)
      const mids = [], dots = [];
      for (let i = 3; i < 19; i++) { const a = sp[i], b = sp[i + 1]; mids.push(at((a.x + b.x) / 2, (a.y + b.y) / 2).concat([c.cols[i], c.cols[i + 1]])); dots.push(at(a.x, a.y).concat([c.cols[i]])); }
      let black = 0, opaque = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200) { opaque++; if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) black++; } }
      // (the hole: a dotted line - some of its pixels drawn, faint)
      const a = sp[20], b = sp[21], hole = []; for (let k = 1; k < 20; k++) hole.push(at(a.x + (b.x - a.x) * k / 20, a.y + (b.y - a.y) * k / 20)[3]);
      // (far from the trail: the night's shade only)
      return { mids, dots, black, opaque, hole, far: at(20, 480) };
    });
    // (the line: blue, laid at 100 of 255 over the night's shade - a pixel's alpha between the line's own and with the
    // night's darkest under it)
    const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
    check('the line see-through: FR24\'s 100 of 255, its colour (green low, blue higher)', px.mids.every(p => Math.abs(p[3] - 100) <= 2 && (p[4] !== p[5] || hex(p[4]).every((v, k) => Math.abs(v - p[k]) <= 3))), px.mids.slice(0, 4));
    check('... the same all along: never darker where two pieces meet', Math.max(...px.mids.map(p => p[3])) - Math.min(...px.mids.map(p => p[3])) <= 6, px.mids.map(p => p[3]));
    check('the dots opaque (their edges smoothed), their own colour - none black', px.dots.every(p => p[3] >= 230 && hex(p[4]).every((v, k) => Math.abs(v - p[k]) <= 3)) && px.black === 0, { dots: px.dots.slice(0, 3), black: px.black });
    check('the hole: a thin dotted line, faint (FR24\'s 100 of 255 at most), along its way', px.hole.slice(3, -3).some(x => x > 20) && px.hole.slice(3, -3).some(x => x < 20) && Math.max(...px.hole.slice(3, -3)) <= 101, px.hole);
    check('the day and night line off: no shade', px.far[3] === 0, px.far);
    await post({ op: 'track', pts, cover: 0, set: { night: true } }); await sleep(250);
    const night = await page.evaluate(() => Array.from(window.__T.clm.cv.getContext('2d').getImageData(20, 480, 1, 1).data));
    // (four rings of 25 of 255 each: 1 - (230/255)^4 of black, 85 of 255)
    check('the day and night line: night there at 06:00 UTC - the shade of its four rings (85 of 255)', Math.abs(night[3] - 85) <= 2 && night[0] === 0, night);

    // ---- the pointer over a point: white dot; FR24's tooltip ------------------------------------------------------------
    const hov = async i => page.evaluate(i => { const c = window.__T.clm, s = c.sp[i], r = c.host.getBoundingClientRect(); window.__gmap.fire('mousemove', { domEvent: { clientX: r.left + s.x + 3, clientY: r.top + s.y - 2 } }); }, i);
    await hov(10); await sleep(120);
    const tip = await page.evaluate(() => {
      const c = window.__T.clm, t = c.tip, sec = t.querySelector('section'), cs = getComputedStyle(sec), s = c.sp[10], g = c.cv.getContext('2d'), p = g.getImageData(Math.round(s.x), Math.round(s.y), 1, 1).data;
      const r = t.getBoundingClientRect(), hr = c.host.getBoundingClientRect(), arrow = sec.lastElementChild, ar = arrow.getBoundingClientRect();
      // (what is drawn on top there: the tooltip asked as if it took the pointer - it does not, as FR24's)
      t.style.pointerEvents = 'auto'; const top = document.elementFromPoint((r.left + r.right) / 2, r.top + 12); t.style.pointerEvents = 'none';
      return { onTop: !!top && t.contains(top), shown: getComputedStyle(t).display, text: t.innerText.split('\n').map(x => x.trim()).filter(Boolean), bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, pad: cs.paddingTop, shadow: cs.boxShadow, font: getComputedStyle(sec.firstElementChild).fontSize, bold: getComputedStyle(sec.querySelector('strong')).fontWeight, dot: [p[0], p[1], p[2], p[3]], bottom: hr.top + s.y - r.bottom, cx: (r.left + r.right) / 2 - (hr.left + s.x), arrowTop: getComputedStyle(arrow).borderTopColor, arrowW: Math.round(ar.width) };
    });
    check('the dot under the pointer white', tip.dot[0] === 255 && tip.dot[1] === 255 && tip.dot[2] === 255 && tip.dot[3] === 255, tip.dot);
    check('FR24\'s tooltip: "Time: UTC hh:mm:ss", "Ground speed: 310 kts", "Altitude: 13,000 ft"', tip.shown === 'block' && tip.text[0] === 'Time: UTC 06:10:00' && tip.text[1] === 'Ground speed: 310 kts' && tip.text[2] === 'Altitude: 13,000 ft', tip.text);
    check('... made as FR24\'s: white, its text dark grey, rounded 8 px, 8 px in, its shadow, 14 px, the names semi-bold', tip.bg === 'rgb(255, 255, 255)' && tip.color === 'rgb(57, 57, 57)' && tip.radius === '8px' && tip.pad === '8px' && /rgba\(0, 0, 0, 0\.2\)/.test(tip.shadow) && tip.font === '14px' && tip.bold === '600', tip);
    check('... over the dot, 5 px above it, its tip (white, 12 px across) under it; over the map', tip.onTop && Math.abs(tip.bottom - 5) <= 1 && Math.abs(tip.cx) <= 1 && tip.arrowTop === 'rgb(255, 255, 255)' && tip.arrowW === 12, { bottom: tip.bottom, cx: tip.cx, arrow: tip.arrowTop, w: tip.arrowW });
    // (the pointer away: gone a moment after, as FR24's)
    await page.evaluate(() => window.__gmap.fire('mousemove', { domEvent: { clientX: 5, clientY: 5 } }));
    const soon = await page.evaluate(() => getComputedStyle(window.__T.clm.tip).display); await sleep(300);
    const later = await page.evaluate(() => getComputedStyle(window.__T.clm.tip).display);
    check('the pointer away: the tooltip gone a moment after (FR24\'s 200 ms)', soon === 'block' && later === 'none', { soon, later });
    // (units of the main map: km/h and metres)
    await post({ op: 'track', pts, cover: 0, set: { tip: true, alt: 'm', spd: 'kmh' } }); await sleep(200);
    await hov(10); await sleep(120);
    const tipU = await page.evaluate(() => window.__T.clm.tip.innerText.split('\n').map(x => x.trim()).filter(Boolean));
    check('... in the main map\'s units: km/h, metres', tipU[1] === 'Ground speed: 574 km/h' && tipU[2] === 'Altitude: 3,962 m', tipU);
    // (the trail tooltip off on the main map: none - the dot still white)
    await post({ op: 'track', pts, cover: 0, set: { tip: false, alt: 'ft', spd: 'kt' } }); await sleep(200);
    await hov(12); await sleep(120);
    const off = await page.evaluate(() => { const c = window.__T.clm, s = c.sp[12], p = c.cv.getContext('2d').getImageData(Math.round(s.x), Math.round(s.y), 1, 1).data; return { shown: getComputedStyle(c.tip).display, dot: p[0] + p[1] + p[2] }; });
    check('"Show trail tooltip" off on the main map: no tooltip (the dot under the pointer white still)', off.shown === 'none' && off.dot === 765, off);

    // ---- other settings ----------------------------------------------------------------------------------------------
    await post({ op: 'track', pts, cover: 0, set: { brightness: 100, night: false } }); await sleep(250);
    const s2 = await page.evaluate(() => { const c = window.__T.clm, g = c.cv.getContext('2d'); return { dim: c.dim.style.opacity, far: Array.from(g.getImageData(20, 480, 1, 1).data) }; });
    check('brightness 100: no sheet; the day and night line off: no shade', s2.dim === '0' && s2.far[3] === 0, s2);
    // (the moment played in the day: no shade where the flight is)
    await post({ op: 'track', pts: pts.map(p => [p[0] + 6 * 3600].concat(p.slice(1))), cover: 0, set: { night: true } }); await sleep(250);
    const day = await page.evaluate(() => Array.from(window.__T.clm.cv.getContext('2d').getImageData(20, 480, 1, 1).data));
    check('the day and night line: noon there - no shade', day[3] === 0, day);
    // (the main map's style changed meanwhile: taken at the next track)
    await post({ op: 'track', pts, cover: 0, type: 'terrain' }); await sleep(50);
    check('the main map\'s style as it is at the next Play', await page.evaluate(() => window.__T.clm.type === 'terrain' && window.__gmap.o.mapTypeId === 'terrain'));
    await post({ op: 'type', type: 'satellite' }); await sleep(50);
    await post({ op: 'type', type: 'simple_style' }); await sleep(50);
    await post({ op: 'type', type: 'no_such' }); await sleep(50);
    const types = await page.evaluate(() => (window.__gmOpts || []).filter(o => o.mapTypeId).slice(-3).map(o => o.mapTypeId));
    check('Google\'s own types as they are; FR24\'s greyscale its own; an unknown style hybrid', JSON.stringify(types) === JSON.stringify(['satellite', 'simple_style', 'hybrid']), types);
    // (a sparse track - the monitor's few positions, three minutes apart: its holes five minutes)
    await post({ op: 'track', pts: pts.filter((p, i) => i % 3 === 0), cover: 0 }); await sleep(100);
    check('a sparse track (three minutes apart): a hole five minutes', await page.evaluate(() => window.__T.clm.gap) === 300);
  } finally { await browser.close(); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
