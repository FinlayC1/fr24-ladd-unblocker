'use strict';
// (1.2.1) FR24's locked weather layers, built here once for every user instead of in each browser: the pictures and
// figures the browser's map layers are drawn from, made ready on a schedule and kept, so that a layer turned on, or the
// map moved, has them at once - from one server, not a dozen slow ones.
//   cloud            EUMETSAT's geostationary ring at 10.8 µm (every three hours): fetched as 16 blocks of its own
//                    latitude/longitude grid (fast - its map-projected pictures take EUMETSAT half a minute each), drawn
//                    into map tiles to zoom 5, white cloud on clear
//   total precip.    NASA's IMERG (every half hour): four pictures of the world, cut into map tiles to zoom 4
//   radar            RainViewer's newest frame and Iowa State's NEXRAD mosaic: tiles kept as the first user asks for
//                    them (the zoomed-out ones fetched ahead), shared by everyone after
//   icing, turb., SIGWX  the Aviation Weather Center's WAFS pictures of the newest run, every forecast hour, kept
//   winds            NOAA's GFS (1 degree, 16 pressure levels, 0 to 36 hours): read from its GRIB2 files, kept as a
//                    small grid per level and hour
//   METARs, AIRMETs/SIGMETs, oceanic tracks  aviationweather.gov's files and the FAA's NAT message, kept fresh
// Nothing here is asked of a source more than its schedule needs; each job runs alone, one after another.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PNG = require('./png.cjs');
const GRIB = require('./grib2.cjs');

const UA = { 'User-Agent': 'fr24-ladd-unblocker-monitor (personal use)' };
const EUMETSAT = 'https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&layers=mumi:worldcloudmap_ir108&styles=&format=image/png';
const EUMETSAT_CAPS = 'https://view.eumetsat.int/geoserver/mumi/worldcloudmap_ir108/ows?service=WMS&version=1.3.0&request=GetCapabilities';
const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=IMERG_Precipitation_Rate_30min&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=2048&HEIGHT=2048';
const RAINVIEWER = 'https://api.rainviewer.com/public/weather-maps.json';
const NEXRAD = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/';
const AWC = 'https://aviationweather.gov';
const NAT = 'https://nms.aim.faa.gov/datanat/nat.json';
const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl';
// pressure levels (hPa) the browser's wind layer reads between, and the WAFS pictures it draws from
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100];
const WIND_FHRS = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
const WAFS_PARAMS = ['812_icsev', '697_icsev', '595_icsev', '506_icsev', '393_icsev', '301_icsev', '595_edr', '506_edr', '393_edr', '344_edr', '301_edr', '250_edr', '197_edr', '148_edr', 'whole_cbhe', '250_wind'];
const WAFS_FHRS = [6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
const H = 20037508.342789244;
const EMPTY = PNG.encode(1, 1, new Uint8Array(4));
const tick = () => new Promise(r => setImmediate(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- map tiles: web mercator ----------------------------------------------------------------------------------------
const tileLat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(Math.sinh(n)); };
const tileLon = (x, z) => x / Math.pow(2, z) * 360 - 180;
// (a tile cut from a bigger RGBA picture that is itself a block of map tiles - top left at (ox, oy) pixels)
function cut(img, ox, oy) {
  const out = new Uint8Array(256 * 256 * 4); let any = false;
  for (let y = 0; y < 256; y++) {
    const s = ((oy + y) * img.width + ox) * 4;
    out.set(img.data.subarray(s, s + 1024), y * 1024);
  }
  for (let i = 3; i < out.length; i += 4) if (out[i]) { any = true; break; }
  return any ? out : null;
}
// (half the size: each 2x2 of pixels into one, colours weighted by their opacity)
function half(img) {
  const w = img.width >> 1, h = img.height >> 1, out = new Uint8Array(w * h * 4), d = img.data, W = img.width;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < 4; k++) { const s = ((2 * y + (k >> 1)) * W + 2 * x + (k & 1)) * 4, al = d[s + 3]; r += d[s] * al; g += d[s + 1] * al; b += d[s + 2] * al; a += al; }
    const o = (y * w + x) * 4;
    if (a) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round(a / 4); }
  }
  return { width: w, height: h, data: out };
}

// ---- the oceanic tracks: the day's NAT messages -> FR24's own form ---------------------------------------------------
function natParse(text, out) {
  const t = String(text || ''), valid = t.match(/([A-Z]{3}\s+\d{2}\/\d{4}Z)\s+TO\s+([A-Z]{3}\s+\d{2}\/\d{4}Z)/) || [];
  let cur = null;
  t.split(/\r?\n/).map(l => l.trim()).forEach(l => {
    const m = l.match(/^([A-Z])\s+([A-Z0-9/]+(?:\s+[A-Z0-9/]+)*)$/);
    if (m && /\d{2}(?:\d{2})?\/\d{2,3}/.test(m[2])) {
      const pts = {}; let n = 0;
      m[2].split(/\s+/).forEach(w => { const c = w.match(/^(\d{2})(\d{2})?\/(\d{2,3})(\d{2})?$/); if (c) pts[n++] = { lat: +c[1] + (+c[2] || 0) / 60, lon: -(+c[3] + (+c[4] || 0) / 60), name: w }; });
      if (n >= 2) { cur = out[m[1]] = { n: m[1], d: 'WEST', p: pts, from: valid[1] || '', until: valid[2] || '' }; return; }
    }
    if (cur && /^EAST LVLS/.test(l) && !/NIL/.test(l)) cur.d = 'EAST';
  });
  return out;
}
// (the FAA's list: one message per part, each with its own validity; the parts of one message joined first)
function natTracks(list) {
  const out = {}, byMsg = new Map();
  (Array.isArray(list) ? list : []).forEach(m => {
    if (!m || typeof m.condition_message !== 'string') return;
    const k = (m.location_code || '') + '|' + (m.start_datetime || '');
    if (!byMsg.has(k)) byMsg.set(k, []);
    byMsg.get(k).push([+m.part_no || 0, m.condition_message]);
  });
  for (const parts of byMsg.values()) natParse(parts.sort((a, b) => a[0] - b[0]).map(p => p[1]).join('\n'), out);
  return out;
}

function createWxMap(env) {
  env = env || {};
  const fetchFn = env.fetch || ((u, o) => fetch(u, o)), log = env.log || (() => {}), now = env.now || Date.now;
  const dir = env.dir || null, gapMs = env.gapMs == null ? 250 : env.gapMs;
  const stats = { jobs: 0, fails: 0, lastErr: '', served: 0, upstream: 0, built: {} };
  const P = {
    cloud: { ver: '', maxZ: 5, tiles: new Map(), at: 0, src: '' },
    precip: { ver: '', maxZ: 4, tiles: new Map(), at: 0 },
    radar: { ver: '', maxZ: 7, tiles: new Map(), at: 0, base: '', asked: new Map(), ahead: '' },
    naradar: { ver: '', maxZ: 9, tiles: new Map(), at: 0, asked: new Map(), ahead: '' }
  };
  const mirrors = { metars: null, airsigmet: null, isigmet: null, nat: null };
  const wafs = { run: 0, files: new Map(), at: 0, asked: new Map() };
  const wind = { run: 0, fhrs: [], grids: new Map(), at: 0 };
  const due = { mirrors: 0, radar: 0, naradar: 0, wafs: 0, wind: 0, precip: 0, cloud: 0 };

  async function get(url, opt) {
    const o = opt || {}, tries = o.tries || 2;
    let last = null;
    for (let i = 0; i < tries; i++) {
      try {
        stats.upstream++;
        const r = await fetchFn(url, { headers: UA, signal: AbortSignal.timeout(o.timeout || 60000) });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + new URL(url).host);
        return Buffer.from(await r.arrayBuffer());
      } catch (e) { last = e; if (/HTTP 4\d\d/.test(String(e && e.message))) break; if (i + 1 < tries) await sleep(gapMs * 8 * (i + 1)); }
    }
    throw last;
  }
  const fail = (what, e) => { stats.fails++; stats.lastErr = (what + ': ' + String(e && e.message || e)).slice(0, 200); log('wxmap', stats.lastErr); };

  // ---- kept on disk: a built product survives a restart (a deploy) ----------------------------------------------------
  function save(name, head, map) {
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const keys = [...map.keys()], bufs = keys.map(k => map.get(k));
      const h = Buffer.from(JSON.stringify(Object.assign({}, head, { keys: keys.map((k, i) => [k, bufs[i].length]) })));
      const len = Buffer.alloc(4); len.writeUInt32BE(h.length, 0);
      fs.writeFileSync(path.join(dir, name + '.tmp'), Buffer.concat([len, h].concat(bufs)));
      fs.renameSync(path.join(dir, name + '.tmp'), path.join(dir, name + '.bin'));
    } catch (e) { fail('save ' + name, e); }
  }
  function load(name) {
    if (!dir) return null;
    try {
      const b = fs.readFileSync(path.join(dir, name + '.bin')), hl = b.readUInt32BE(0), head = JSON.parse(b.subarray(4, 4 + hl).toString('utf8'));
      const map = new Map(); let off = 4 + hl;
      for (const [k, n] of head.keys) { map.set(k, b.subarray(off, off + n)); off += n; }
      delete head.keys; return { head, map };
    } catch (e) { return null; }
  }
  (function restore() {
    for (const k of ['cloud', 'precip']) { const s = load(k); if (s && s.head.ver) Object.assign(P[k], { ver: s.head.ver, at: s.head.at || 0, src: s.head.src || '', tiles: s.map }); }
    const w = load('wind'); if (w && w.head.run) Object.assign(wind, { run: w.head.run, fhrs: w.head.fhrs || [], at: w.head.at || 0, grids: w.map });
    const f = load('wafs'); if (f && f.head.run) Object.assign(wafs, { run: f.head.run, at: f.head.at || 0, files: f.map });
    if (P.cloud.ver) due.cloud = (P.cloud.at || 0) + 20 * 60000;
    if (P.precip.ver) due.precip = (P.precip.at || 0) + 30 * 60000;
    if (wind.run) due.wind = (wind.at || 0) + 30 * 60000;
    if (wafs.run) due.wafs = (wafs.at || 0) + 20 * 60000;
  })();

  // ---- cloud ------------------------------------------------------------------------------------------------------------
  // (which picture EUMETSAT has now: its time, from the layer's description - rebuilt only when that changes)
  async function cloudTime() {
    const x = (await get(EUMETSAT_CAPS, { timeout: 60000 })).toString('utf8');
    const m = x.match(/<Dimension[^>]*name="time"[^>]*default="([^"]+)"/); if (!m) throw new Error('no time in EUMETSAT capabilities');
    return m[1];
  }
  async function buildCloud() {
    const time = await cloudTime();
    if (time === P.cloud.src && P.cloud.ver) { P.cloud.at = now(); return; }
    const W = 8192, Hh = 4096, A = new Uint8Array(W * Hh);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const la1 = 90 - r * 45, la0 = la1 - 45, lo0 = -180 + c * 90, lo1 = lo0 + 90;
      const url = EUMETSAT + '&crs=EPSG:4326&width=2048&height=1024&time=' + encodeURIComponent(time) + '&bbox=' + [la0, lo0, la1, lo1].join(',');
      let img = null;
      // (a picture cut short on the way - EUMETSAT's sometimes are - asked for again)
      for (let i = 0; i < 3 && !img; i++) { try { const d = PNG.decode(await get(url, { timeout: 120000 })); if (d.width === 2048 && d.height === 1024) img = d; } catch (e) { if (i === 2) throw e; await sleep(gapMs * 8); } }
      if (!img) throw new Error('cloud block ' + r + ',' + c + ' not had');
      const px = img.data;
      for (let y = 0; y < 1024; y++) {
        const row = (r * 1024 + y) * W + c * 2048;
        for (let x = 0; x < 2048; x++) { const s = (y * 2048 + x) * 4, v = (px[s] - 92) / 80; A[row + x] = v <= 0 ? 0 : Math.round(Math.pow(v >= 1 ? 1 : v, 0.85) * 235 * px[s + 3] / 255); }
        if (y % 256 === 255) await tick();
      }
      await tick(); await sleep(gapMs);
    }
    // (the world at each size - each tile drawn from the one nearest its own scale)
    const mips = [{ w: W, h: Hh, a: A }];
    while (mips.length < 6) {
      const p = mips[mips.length - 1], w = p.w >> 1, h = p.h >> 1, a = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { const s = 2 * y * p.w + 2 * x; a[y * w + x] = (p.a[s] + p.a[s + 1] + p.a[s + p.w] + p.a[s + p.w + 1] + 2) >> 2; } if (y % 256 === 255) await tick(); }
      mips.push({ w, h, a });
    }
    const tiles = new Map(), rgba = new Uint8Array(256 * 256 * 4), lonPx = new Float64Array(256), latPx = new Float64Array(256), fade = new Float64Array(256);
    for (let i = 0; i < rgba.length; i += 4) rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
    let n = 0;
    for (let z = 0; z <= 5; z++) {
      const m = mips[5 - z], N = Math.pow(2, z), Wz = 256 * N;
      for (let ty = 0; ty < N; ty++) {
        // (the satellites' ring ends near the poles in a ragged edge: faded out from 70 to 78 degrees)
        for (let j = 0; j < 256; j++) { const yy = (ty * 256 + j + 0.5) / Wz; latPx[j] = 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))); fade[j] = Math.max(0, Math.min(1, (78 - Math.abs(latPx[j])) / 8)); }
        for (let tx = 0; tx < N; tx++) {
          for (let i = 0; i < 256; i++) lonPx[i] = (tx * 256 + i + 0.5) / Wz * 360 - 180;
          let any = false;
          for (let j = 0; j < 256; j++) {
            const fy = (90 - latPx[j]) / 180 * m.h - 0.5, y0 = Math.max(0, Math.min(m.h - 1, Math.floor(fy))), y1 = Math.min(m.h - 1, y0 + 1), wy = Math.max(0, Math.min(1, fy - y0));
            for (let i = 0; i < 256; i++) {
              const fx = (lonPx[i] + 180) / 360 * m.w - 0.5, xf = Math.floor(fx), wx = fx - xf, x0 = (xf % m.w + m.w) % m.w, x1 = (x0 + 1) % m.w;
              const a = (m.a[y0 * m.w + x0] * (1 - wx) + m.a[y0 * m.w + x1] * wx) * (1 - wy) + (m.a[y1 * m.w + x0] * (1 - wx) + m.a[y1 * m.w + x1] * wx) * wy;
              const v = Math.round(a * fade[j]); rgba[(j * 256 + i) * 4 + 3] = v; if (v) any = true;
            }
          }
          if (any) tiles.set(z + '/' + tx + '/' + ty, PNG.encode(256, 256, rgba, { grey: true }));
          if (++n % 2 === 0) await tick();
        }
      }
    }
    Object.assign(P.cloud, { ver: 'c' + Math.floor(now() / 1000).toString(36), tiles, at: now(), src: time });
    save('cloud', { ver: P.cloud.ver, at: P.cloud.at, src: time }, tiles);
    stats.built.cloud = { at: now(), tiles: tiles.size, src: time };
  }

  // ---- total precipitation ----------------------------------------------------------------------------------------------
  async function buildPrecip() {
    const tiles = new Map(), z1 = [];
    for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
      const bbox = [-H + qx * H, H - (qy + 1) * H, -H + (qx + 1) * H, H - qy * H].map(v => v.toFixed(2)).join(',');
      let img = null;
      for (let i = 0; i < 3 && !img; i++) { try { const d = PNG.decode(await get(GIBS + '&BBOX=' + bbox, { timeout: 90000 })); if (d.width === 2048 && d.height === 2048) img = d; } catch (e) { if (i === 2) throw e; await sleep(gapMs * 8); } }
      if (!img) throw new Error('precipitation quarter not had');
      // (zoom 4 cut from it; each smaller zoom from its half-size copy)
      let cur = img;
      for (let z = 4; z >= 1; z--) {
        const n = cur.width / 256;
        for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) { const t = cut(cur, tx * 256, ty * 256); if (t) tiles.set(z + '/' + (qx * n + tx) + '/' + (qy * n + ty), PNG.encode(256, 256, t)); }
        if (z > 1) cur = half(cur);
        await tick();
      }
      z1[qy * 2 + qx] = half(cur);
      await sleep(gapMs);
    }
    const all = new Uint8Array(256 * 256 * 4);
    z1.forEach((q, k) => { const ox = (k & 1) * 128, oy = (k >> 1) * 128; for (let y = 0; y < 128; y++) all.set(q.data.subarray(y * 512, y * 512 + 512), ((oy + y) * 256 + ox) * 4); });
    if (all.some((v, i) => i % 4 === 3 && v)) tiles.set('0/0/0', PNG.encode(256, 256, all));
    Object.assign(P.precip, { ver: 'p' + Math.floor(now() / 1000).toString(36), tiles, at: now() });
    save('precip', { ver: P.precip.ver, at: P.precip.at }, tiles);
    stats.built.precip = { at: now(), tiles: tiles.size };
  }

  // ---- radar: tiles as asked for, kept for everyone ----------------------------------------------------------------------
  const radarUrl = (z, x, y) => P.radar.base + '/256/' + z + '/' + x + '/' + y + '/2/1_1.png';
  const US = { w: -170, s: 14, e: -50, n: 72 };
  const inUS = (z, x, y) => !(tileLon(x + 1, z) < US.w || tileLon(x, z) > US.e || tileLat(y, z) < US.s || tileLat(y + 1, z) > US.n);
  const naradarUrl = (z, x, y) => NEXRAD + z + '/' + x + '/' + y + '.png?tl=' + P.naradar.ver;
  function onDemand(name, z, x, y) {
    const p = P[name], key = z + '/' + x + '/' + y;
    if (p.tiles.has(key)) return Promise.resolve(p.tiles.get(key));
    if (name === 'naradar' && !inUS(z, x, y)) return Promise.resolve(null);
    if (p.asked.has(key)) return p.asked.get(key);
    const ver = p.ver, url = name === 'radar' ? radarUrl(z, x, y) : naradarUrl(z, x, y);
    const pr = get(url, { timeout: 20000 }).then(b => {
      let keep = b;
      try { const d = PNG.decode(b); let any = false; for (let i = 3; i < d.data.length; i += 4) if (d.data[i]) { any = true; break; } if (!any) keep = null; } catch (e) { keep = null; }
      if (p.ver === ver) { p.tiles.set(key, keep); if (p.tiles.size > 8000) p.tiles.delete(p.tiles.keys().next().value); }
      return keep;
    }).finally(() => p.asked.delete(key));
    p.asked.set(key, pr);
    return pr;
  }
  // (the zoomed-out tiles fetched as soon as a frame is new: a whole-world view drawn at once)
  async function ahead(name, zs) {
    const p = P[name], ver = p.ver; if (p.ahead === ver) return; p.ahead = ver;
    for (const z of zs) { const N = Math.pow(2, z); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (p.ver !== ver) return; if (name === 'naradar' && !inUS(z, x, y)) continue; try { await onDemand(name, z, x, y); } catch (e) { /* asked for again by whoever needs it */ } await sleep(gapMs); } }
  }
  async function refreshRadar() {
    const j = JSON.parse((await get(RAINVIEWER, { timeout: 20000 })).toString('utf8')), past = j && j.radar && j.radar.past, last = past && past[past.length - 1];
    if (!last || !last.path) throw new Error('no RainViewer frame');
    const base = String(j.host || 'https://tilecache.rainviewer.com') + last.path;
    if (base !== P.radar.base) Object.assign(P.radar, { base, ver: 'r' + String(last.path).split('/').pop(), tiles: new Map(), at: now(), time: last.time });
    ahead('radar', [0, 1, 2, 3]).catch(() => {});
  }
  function refreshNaradar() {
    const ver = 'n' + Math.floor(now() / 300000);
    if (ver !== P.naradar.ver) Object.assign(P.naradar, { ver, tiles: new Map(), at: now() });
    ahead('naradar', [2, 3, 4]).catch(() => {});
  }

  // ---- WAFS: the newest run's pictures ------------------------------------------------------------------------------------
  const ymd = t => { const d = new Date(t); return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0'); };
  const wafsName = (run, fhr, param) => { const hh = String(new Date(run).getUTCHours()).padStart(2, '0'); return ymd(run) + '_' + hh + '_F' + String(fhr).padStart(2, '0') + '_wafs_' + param + '_m.png'; };
  const wafsUrl = name => AWC + '/data/products/wafs/' + name.slice(0, 8) + '/' + name.slice(9, 11) + '/' + name;
  async function refreshWafs() {
    const t0 = Math.floor((now() - 4 * 3600e3) / 21600e3) * 21600e3;
    let run = 0;
    for (let i = 0; i < 4 && !run; i++) { const r = t0 - i * 21600e3; if (r === wafs.run) { run = r; break; } try { const b = await get(wafsUrl(wafsName(r, 6, '301_edr')), { timeout: 30000, tries: 1 }); wafs.files.set(wafsName(r, 6, '301_edr'), b); run = r; } catch (e) { /* not out yet */ } }
    if (!run) throw new Error('no WAFS run found');
    const files = run === wafs.run ? wafs.files : new Map([[wafsName(run, 6, '301_edr'), wafs.files.get(wafsName(run, 6, '301_edr'))]].filter(e => e[1]));
    for (const f of WAFS_FHRS) for (const pm of WAFS_PARAMS) {
      const name = wafsName(run, f, pm); if (files.has(name)) continue;
      try { files.set(name, await get(wafsUrl(name), { timeout: 30000 })); } catch (e) { /* asked for again next time */ }
      await sleep(gapMs);
    }
    Object.assign(wafs, { run, files, at: now() });
    save('wafs', { run, at: wafs.at }, files);
    stats.built.wafs = { at: now(), run: new Date(run).toISOString(), files: files.size };
  }

  // ---- winds: GFS u/v on 16 levels, every three hours to 36 --------------------------------------------------------------
  async function refreshWind() {
    const newest = Math.floor((now() - 3.5 * 3600e3) / 21600e3) * 21600e3;
    for (const run of [newest, newest - 21600e3]) {
      if (run === wind.run && wind.fhrs.length === WIND_FHRS.length) return;
      if (run < wind.run) return;
      const d = ymd(run), hh = String(new Date(run).getUTCHours()).padStart(2, '0'), grids = new Map(), fhrs = [];
      let ok = true;
      for (const f of WIND_FHRS) {
        const url = NOMADS + '?dir=%2Fgfs.' + d + '%2F' + hh + '%2Fatmos&file=gfs.t' + hh + 'z.pgrb2.1p00.f' + String(f).padStart(3, '0') + '&var_UGRD=on&var_VGRD=on' + LEVELS.map(l => '&lev_' + l + '_mb=on').join('');
        let msgs;
        try { msgs = GRIB.decode(await get(url, { timeout: 90000 })); } catch (e) { ok = false; break; }
        const uv = {};
        for (const m of msgs) {
          if (m.discipline !== 0 || m.category !== 2 || (m.number !== 2 && m.number !== 3) || m.level.type !== 100 || m.ni !== 360 || m.nj !== 181 || m.la1 !== 90 || m.lo1 !== 0 || (m.scan & 0xe0)) continue;
          const hpa = Math.round(m.level.value / 100); (uv[hpa] = uv[hpa] || {})[m.number === 2 ? 'u' : 'v'] = m.values;
        }
        for (const l of LEVELS) {
          const e = uv[l]; if (!e || !e.u || !e.v) continue;
          const g = new Int8Array(2 * 360 * 181);
          for (let i = 0; i < 360 * 181; i++) { g[i] = Math.max(-127, Math.min(127, Math.round(e.u[i]))); g[360 * 181 + i] = Math.max(-127, Math.min(127, Math.round(e.v[i]))); }
          grids.set(f + '/' + l, zlib.gzipSync(Buffer.from(g.buffer)));
        }
        fhrs.push(f); await sleep(gapMs * 4);
      }
      // (a run is taken whole - or, published in part so far, from the hours it has: the previous run kept till then)
      if (ok && fhrs.length === WIND_FHRS.length) {
        Object.assign(wind, { run, fhrs, grids, at: now() });
        save('wind', { run, fhrs, at: wind.at }, grids);
        stats.built.wind = { at: now(), run: new Date(run).toISOString(), grids: grids.size };
        return;
      }
    }
    if (!wind.run) throw new Error('no GFS run read');
  }

  // ---- the plain files: kept as they came ---------------------------------------------------------------------------------
  async function refreshMirrors() {
    const jobs = [
      ['metars', AWC + '/data/cache/metars.cache.csv.gz', 'application/gzip'],
      ['airsigmet', AWC + '/api/data/airsigmet?format=json', 'application/json'],
      ['isigmet', AWC + '/api/data/isigmet?format=json', 'application/json'],
      ['nat', NAT, 'application/json']
    ];
    for (const [k, url, type] of jobs) {
      try {
        let body = await get(url, { timeout: 60000 });
        if (k === 'nat') { const t = natTracks(JSON.parse(body.toString('utf8'))); if (!Object.keys(t).length) throw new Error('no tracks in the NAT message'); body = Buffer.from(JSON.stringify(t)); }
        else if (type === 'application/json') JSON.parse(body.toString('utf8'));
        mirrors[k] = { at: now(), type, body, gz: type === 'application/json' ? zlib.gzipSync(body) : null };
      } catch (e) { fail(k, e); }
      await sleep(gapMs);
    }
  }

  // ---- the schedule: one job at a time -------------------------------------------------------------------------------------
  const JOBS = [
    ['mirrors', refreshMirrors, 10 * 60000, 2 * 60000],
    ['radar', refreshRadar, 5 * 60000, 60000],
    ['naradar', refreshNaradar, 5 * 60000, 60000],
    ['wind', refreshWind, 30 * 60000, 10 * 60000],
    ['wafs', refreshWafs, 20 * 60000, 5 * 60000],
    ['precip', buildPrecip, 30 * 60000, 5 * 60000],
    ['cloud', buildCloud, 20 * 60000, 10 * 60000]
  ];
  let running = null;
  function pump() {
    if (running) return running;
    const t = now(), job = JOBS.find(j => due[j[0]] <= t);
    if (!job) return Promise.resolve(false);
    stats.jobs++;
    running = Promise.resolve().then(job[1]).then(() => { due[job[0]] = now() + job[2]; }, e => { fail(job[0], e); due[job[0]] = now() + job[3]; }).then(() => { running = null; return true; });
    return running;
  }

  // ---- what the browsers ask for ------------------------------------------------------------------------------------------
  function meta() {
    const p = k => ({ ver: P[k].ver, maxZ: P[k].maxZ });
    return { v: 1, at: now(), cloud: p('cloud'), precip: p('precip'), radar: p('radar'), naradar: p('naradar'), wafs: { run: wafs.run, files: wafs.files.size }, wind: { run: wind.run, fhrs: wind.fhrs, levels: LEVELS, ni: 360, nj: 181, la1: 90, lo1: 0, d: 1 } };
  }
  const png = b => ({ status: 200, type: 'image/png', body: b || EMPTY, cache: 'public, max-age=86400, immutable' });
  // -> null (not ours), or a promise of { status, type, body, cache, enc }
  function handle(pathname, acceptGzip) {
    if (!pathname.startsWith('/wx/')) return null;
    stats.served++;
    let m;
    if (pathname === '/wx/meta') { const b = Buffer.from(JSON.stringify(meta())); return Promise.resolve({ status: 200, type: 'application/json', body: b, cache: 'no-store' }); }
    if ((m = pathname.match(/^\/wx\/t\/(cloud|precip|radar|naradar)\/([a-z0-9]+)\/(\d{1,2})\/(\d+)\/(\d+)\.png$/))) {
      const name = m[1], p = P[name], z = +m[3], x = +m[4], y = +m[5], N = Math.pow(2, z);
      if (!p.ver || z > p.maxZ || x >= N || y >= N) return Promise.resolve({ status: 404, type: 'text/plain', body: Buffer.from('no such tile') });
      if (name === 'cloud' || name === 'precip') return Promise.resolve(png(p.tiles.get(z + '/' + x + '/' + y)));
      return onDemand(name, z, x, y).then(png, () => ({ status: 502, type: 'text/plain', body: Buffer.from('source did not answer') }));
    }
    if ((m = pathname.match(/^\/wx\/wafs\/(\d{8}_\d{2}_F\d{2}_wafs_[a-z0-9_]+_m\.png)$/))) {
      const name = m[1];
      if (wafs.files.has(name)) return Promise.resolve(png(wafs.files.get(name)));
      if (!wafs.asked.has(name)) wafs.asked.set(name, get(wafsUrl(name), { timeout: 30000, tries: 1 }).then(b => { if (name.startsWith(wafsName(wafs.run, 6, '').slice(0, 11))) wafs.files.set(name, b); return b; }).finally(() => wafs.asked.delete(name)));
      return wafs.asked.get(name).then(png, e => ({ status: /HTTP 404/.test(String(e)) ? 404 : 502, type: 'text/plain', body: Buffer.from('not had') }));
    }
    if ((m = pathname.match(/^\/wx\/wind\/(\d+)\/(\d+)\/(\d+)$/))) {
      const g = +m[1] === wind.run ? wind.grids.get(+m[2] + '/' + +m[3]) : null;
      if (!g) return Promise.resolve({ status: 404, type: 'text/plain', body: Buffer.from('no such grid') });
      return Promise.resolve(acceptGzip ? { status: 200, type: 'application/octet-stream', body: g, enc: 'gzip', cache: 'public, max-age=86400, immutable' } : { status: 200, type: 'application/octet-stream', body: zlib.gunzipSync(g), cache: 'public, max-age=86400, immutable' });
    }
    if ((m = pathname.match(/^\/wx\/(metars|airsigmet|isigmet|nat)$/))) {
      const f = mirrors[m[1]];
      if (!f) return Promise.resolve({ status: 503, type: 'text/plain', body: Buffer.from('not ready') });
      return Promise.resolve(f.gz && acceptGzip ? { status: 200, type: f.type, body: f.gz, enc: 'gzip', cache: 'public, max-age=120' } : { status: 200, type: f.type, body: f.body, cache: 'public, max-age=120' });
    }
    return Promise.resolve({ status: 404, type: 'text/plain', body: Buffer.from('unknown') });
  }
  function status() {
    const age = t => (t ? Math.round((now() - t) / 60000) : null);
    return { cloud: { ver: P.cloud.ver, tiles: P.cloud.tiles.size, ageMin: age(P.cloud.at), src: P.cloud.src }, precip: { ver: P.precip.ver, tiles: P.precip.tiles.size, ageMin: age(P.precip.at) }, radar: { ver: P.radar.ver, kept: P.radar.tiles.size }, naradar: { ver: P.naradar.ver, kept: P.naradar.tiles.size }, wafs: { run: wafs.run ? new Date(wafs.run).toISOString() : null, files: wafs.files.size }, wind: { run: wind.run ? new Date(wind.run).toISOString() : null, grids: wind.grids.size }, mirrors: Object.fromEntries(Object.entries(mirrors).map(([k, v]) => [k, v ? age(v.at) : null])), jobs: stats.jobs, served: stats.served, upstream: stats.upstream, fails: stats.fails, lastErr: stats.lastErr };
  }
  return { pump, handle, meta, status, stats, P, wind, wafs, mirrors, due };
}

module.exports = { createWxMap, natTracks, natParse, LEVELS };
