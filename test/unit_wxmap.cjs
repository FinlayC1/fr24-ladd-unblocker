// (1.2.1) The weather layers built on the monitor: monitor/png.cjs (PNG read and written), monitor/grib2.cjs (NOAA's GFS
// read - a real field, complex packing with spatial differencing), monitor/wxmap.cjs (each job against stand-in sources:
// the cloud tiles, total precipitation, radar kept as asked for, WAFS, winds, the plain files, the NAT tracks; what the
// browsers are answered). All offline.
// usage: node test/unit_wxmap.cjs
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const PNG = require('../monitor/png.cjs'), GRIB = require('../monitor/grib2.cjs'), { createWxMap, natTracks } = require('../monitor/wxmap.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

// ---- PNG -----------------------------------------------------------------------------------------------------------------
{
  const w = 37, h = 23, px = new Uint8Array(w * h * 4); for (let i = 0; i < px.length; i++) px[i] = (i * 7919) % 256;
  const back = PNG.decode(PNG.encode(w, h, px));
  check('PNG: RGBA written and read back the same', Buffer.from(back.data).equals(Buffer.from(px)) && back.width === w && back.height === h);
  const g = PNG.decode(PNG.encode(w, h, px, { grey: true })); let ok = true; for (let i = 0; i < w * h; i++) if (g.data[i * 4] !== px[i * 4] || g.data[i * 4 + 3] !== px[i * 4 + 3]) ok = false;
  check('PNG: grey + alpha (the cloud tiles) the same', ok);
  check('PNG: its CRC as the standard\'s check value', PNG.crc32(Buffer.from('123456789')).toString(16) === 'cbf43926');
  // (a 4-bit palette picture with transparency, as tile servers send)
  const ch = (k, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(k, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(PNG.crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(5, 0); ih.writeUInt32BE(3, 4); ih[8] = 4; ih[9] = 3;
  const rows = Buffer.concat([0, 1, 2].map(() => Buffer.from([0, 0x01, 0x23, 0x40])));
  const p4 = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('PLTE', Buffer.from([...Array(15).keys()])), ch('tRNS', Buffer.from([0, 128])), ch('IDAT', zlib.deflateSync(rows)), ch('IEND', Buffer.alloc(0))]);
  const d4 = PNG.decode(p4);
  check('PNG: a 4-bit palette with transparency read (index 0 clear, 1 half, 2 opaque)', d4.data[3] === 0 && d4.data[7] === 128 && d4.data[11] === 255 && d4.data[4] === 3, Array.from(d4.data.slice(0, 12)));
  let threw = false; try { PNG.decode(p4.subarray(0, p4.length - 30)); } catch (e) { threw = true; }
  check('PNG: one cut short on the way is refused, not drawn half (EUMETSAT\'s sometimes are)', threw);
}

// ---- GRIB2 ---------------------------------------------------------------------------------------------------------------
{
  const m = GRIB.decode(fs.readFileSync(path.join(__dirname, 'fixtures', 'gfs_u250_1p00.grb2')));
  const f = m[0];
  check('GRIB2: GFS u-wind at 250 hPa, 1 degree - the whole world grid, from 90N 0E', m.length === 1 && f.category === 2 && f.number === 2 && f.level.type === 100 && f.level.value === 25000 && f.ni === 360 && f.nj === 181 && f.la1 === 90 && f.lo1 === 0, { cat: f.category, n: f.number, level: f.level, ni: f.ni, nj: f.nj });
  let mn = Infinity, mx = -Infinity; for (const v of f.values) { if (v < mn) mn = v; if (v > mx) mx = v; }
  check('GRIB2: its values as a jet stream has them (complex packing undone: -60 to 100 m/s)', mn > -60 && mx < 100 && mx > 40, { min: mn, max: mx });
  // (checked against Open-Meteo's GFS at the same hour when the fixture was taken: within a few knots at six places)
  const at = (la, lo) => f.values[(90 - la) * 360 + ((lo % 360) + 360) % 360];
  check('GRIB2: the field smooth from one degree to the next (no packing error)', Math.abs(at(51, 0) - at(51, 1)) < 8 && Math.abs(at(40, -74) - at(41, -74)) < 8);
}

// ---- the jobs, with every source stood in for ------------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxmap-'));
const solid = (w, h, f) => { const px = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { const c = f(i % w, Math.floor(i / w)); px.set(c, i * 4); } return PNG.encode(w, h, px); };
const asked = [];
// (a GRIB2 field written here, simply packed: u = 10 m/s, v = -5 everywhere, at the level asked)
function gribField(number, pa, value) {
  const s = []; const sec = (num, body) => { const b = Buffer.alloc(5 + body.length); b.writeUInt32BE(5 + body.length, 0); b[4] = num; body.copy(b, 5); return b; };
  const s3 = Buffer.alloc(67); s3.writeUInt16BE(0, 7); s3.writeUInt32BE(360, 25); s3.writeUInt32BE(181, 29); s3.writeUInt32BE(90e6, 41); s3.writeUInt32BE(0, 45); s3.writeUInt32BE(1e6, 58); s3.writeUInt32BE(1e6, 62); s3[66] = 0;
  const s4 = Buffer.alloc(29); s4[4] = 2; s4[5] = number; s4[17] = 100; s4[18] = 0; s4.writeUInt32BE(pa, 19);
  const s5 = Buffer.alloc(16); s5.writeUInt32BE(65160, 0); s5.writeUInt16BE(0, 4); s5.writeFloatBE(value, 6); s5[14] = 0;
  s.push(sec(3, s3), sec(4, s4), sec(5, s5), sec(6, Buffer.from([255])), sec(7, Buffer.alloc(0)));
  const body = Buffer.concat(s), head = Buffer.alloc(16); head.write('GRIB', 0, 'latin1'); head[6] = 0; head[7] = 2; head.writeBigUInt64BE(BigInt(16 + body.length + 4), 8);
  return Buffer.concat([head, body, Buffer.from('7777', 'latin1')]);
}
const NAT = [{ location_code: 'EGGX', start_datetime: 'a', part_no: 1, condition_message: 'NAT-1/2 TRACKS FLS 310/390\r\nOCT 31/1130Z TO OCT 31/1900Z\r\nA ETIKI 58/20 59/30 59/40 58/50 PRAWN\r\nEAST LVLS NIL\r\nWEST LVLS 310 320' },
  { location_code: 'CZQX', start_datetime: 'b', part_no: 1, condition_message: 'NAT-1/1 TRACKS\r\nOCT 31/0100Z TO OCT 31/0800Z\r\nU ALLRY 51/50 53/40 54/30 55/20 RESNO\r\nEAST LVLS 340 350\r\nWEST LVLS NIL' }];
const fakeFetch = async (url) => {
  asked.push(url);
  const ok = body => ({ ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
  if (/GetCapabilities/.test(url)) return ok(Buffer.from('<Dimension name="time" default="2026-10-31T03:00:00Z" units="ISO8601">'));
  if (/eumetsat/.test(url)) return ok(solid(2048, 1024, (x, y) => [y < 512 ? 200 : 60, 0, 0, 255]));       // (cold tops in each block's top half)
  if (/gibs/.test(url)) return ok(solid(2048, 2048, (x, y) => (x < 100 && y < 100 ? [0, 200, 0, 255] : [0, 0, 0, 0])));
  if (/weather-maps\.json/.test(url)) return ok(Buffer.from(JSON.stringify({ host: 'https://tilecache.rainviewer.com', radar: { past: [{ time: 1, path: '/v2/radar/abc123' }] } })));
  if (/tilecache\.rainviewer/.test(url)) return ok(solid(256, 256, () => [0, 0, 255, 200]));
  if (/mesonet/.test(url)) return ok(solid(256, 256, () => [0, 255, 0, 200]));
  if (/wafs/.test(url)) return ok(solid(9, 6, () => [255, 0, 0, 255]));
  if (/nomads/.test(url)) { const lv = [...url.matchAll(/lev_(\d+)_mb/g)].map(m => +m[1]); return ok(Buffer.concat(lv.flatMap(l => [gribField(2, l * 100, 10), gribField(3, l * 100, -5)]))); }
  if (/metars\.cache/.test(url)) return ok(zlib.gzipSync('raw_text,station_id\nEGLL 311150Z,EGLL\n'));
  if (/airsigmet|isigmet/.test(url)) return ok(Buffer.from('[]'));
  if (/nms\.aim\.faa/.test(url)) return ok(Buffer.from(JSON.stringify(NAT)));
  return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
};
(async () => {
  const t0 = Date.parse('2026-10-31T09:00:00Z');
  const W = createWxMap({ dir, fetch: fakeFetch, now: () => t0, gapMs: 0 });
  for (let i = 0; i < 7; i++) await W.pump();
  const st = W.status(), meta = W.meta();
  check('every job ran once: cloud, precipitation, radar, North American radar, WAFS, winds, the plain files', !!(meta.cloud.ver && meta.precip.ver && meta.radar.ver && meta.naradar.ver && meta.wafs.run && meta.wind.run) && st.fails === 0, { meta, err: st.lastErr });
  check('cloud: 16 blocks of EUMETSAT\'s own grid asked for, at the picture\'s time (one picture, not half of two)', asked.filter(u => /eumetsat.*GetMap/.test(u)).length === 16 && asked.filter(u => /GetMap/.test(u) && /eumetsat/.test(u)).every(u => /time=2026-10-31T03/.test(u)));
  check('cloud: tiles to zoom 5, none kept where it is all clear', st.cloud.tiles > 0 && st.cloud.tiles <= 1365, st.cloud);
  const ct = await W.handle('/wx/t/cloud/' + meta.cloud.ver + '/2/1/1.png'), cd = PNG.decode(ct.body);
  check('cloud: a tile is white cloud on clear (grey + alpha), its cache for ever (the version in its address)', ct.status === 200 && cd.width === 256 && cd.data[0] === 255 && /immutable/.test(ct.cache));
  const pole = PNG.decode((await W.handle('/wx/t/cloud/' + meta.cloud.ver + '/3/0/0.png')).body);
  check('cloud: faded out toward the poles (the satellites\' ragged edge)', pole.width === 1 || pole.data[3] < 40, pole.data[3]);
  check('precipitation: four pictures of the world, tiles to zoom 4 - only where there is rain', asked.filter(u => /gibs/.test(u)).length === 4 && st.precip.tiles > 0 && st.precip.tiles < 50, st.precip);
  const rt = await W.handle('/wx/t/radar/' + meta.radar.ver + '/5/16/10.png');
  check('radar: a tile asked for is fetched once and kept for everyone', rt.status === 200 && asked.filter(u => /tilecache.*\/5\/16\/10\//.test(u)).length === 1 && (await W.handle('/wx/t/radar/' + meta.radar.ver + '/5/16/10.png')).status === 200 && asked.filter(u => /tilecache.*\/5\/16\/10\//.test(u)).length === 1);
  check('North American radar: a tile over Europe answered empty without asking Iowa State', (await W.handle('/wx/t/naradar/' + meta.naradar.ver + '/5/16/10.png')).body.length < 100 && !asked.some(u => /mesonet.*\/5\/16\/10\./.test(u)));
  check('no tile past a layer\'s zoom, nor of a layer not built', (await W.handle('/wx/t/precip/' + meta.precip.ver + '/7/1/1.png')).status === 404 && (await W.handle('/wx/t/radar/x/99/1/1.png')).status === 404);
  check('WAFS: every picture of the newest run kept (16 kinds, 11 forecast hours)', meta.wafs.files === 176, meta.wafs);
  const wf = await W.handle('/wx/wafs/20261031_00_F12_wafs_250_wind_m.png');
  check('WAFS: a picture served from what is kept', wf.status === 200 && PNG.decode(wf.body).width === 9);
  const wg = await W.handle('/wx/wind/' + meta.wind.run + '/9/250', true), g = new Int8Array(zlib.gunzipSync(wg.body));
  check('winds: a level\'s grid - u then v, 360 x 181, m/s - gzipped for the browser', wg.status === 200 && wg.enc === 'gzip' && g.length === 2 * 65160 && g[0] === 10 && g[65160] === -5, { len: g.length, u: g[0], v: g[65160] });
  check('winds: 13 forecast hours, 16 levels', meta.wind.fhrs.length === 13 && meta.wind.levels.length === 16);
  const nat = JSON.parse((await W.handle('/wx/nat')).body.toString());
  check('oceanic tracks: the FAA\'s NAT messages as FR24\'s own form - Shanwick\'s west, Gander\'s east, each its own validity', nat.A && nat.A.d === 'WEST' && nat.A.p[0].lat === 58 && nat.A.p[0].lon === -20 && /1130Z/.test(nat.A.from) && nat.U && nat.U.d === 'EAST' && /0100Z/.test(nat.U.from), nat);
  check('METARs, AIRMETs/SIGMETs: the files kept as they came', (await W.handle('/wx/metars')).status === 200 && (await W.handle('/wx/airsigmet')).status === 200);
  check('something not the weather\'s: not answered here', W.handle('/status') === null && (await W.handle('/wx/nothing')).status === 404);
  // (kept on disk: after a restart - a deploy - the built layers are there at once)
  const W2 = createWxMap({ dir, fetch: async () => { throw new Error('offline'); }, now: () => t0 + 60000 });
  const m2 = W2.meta();
  check('after a restart: the cloud, precipitation, WAFS and winds as built, before any source is asked again', m2.cloud.ver === meta.cloud.ver && m2.precip.ver === meta.precip.ver && m2.wafs.files === 176 && m2.wind.run === meta.wind.run);
  check('natTracks: a message without tracks gives none', Object.keys(natTracks([{ condition_message: 'NIL' }])).length === 0);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exitCode = fails ? 1 : 0;
})();
