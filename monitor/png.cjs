'use strict';
// PNG pictures read and written with Node's own zlib - the weather sources' tiles in, the monitor's prebuilt map tiles
// out. Reads every colour type at 8 bits (and the 1/2/4-bit palette and grey ones, 16-bit cut to 8), not interlaced;
// writes 8-bit RGBA or grey+alpha.
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
function crc32(buf, crc) { let c = (crc === undefined ? 0 : crc) ^ -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

// -> { width, height, data: Uint8Array (RGBA, 4 bytes a pixel) }
function decode(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0, pal = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), kind = buf.toString('latin1', off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; inter = d[12]; }
    else if (kind === 'PLTE') pal = d;
    else if (kind === 'tRNS') trns = d;
    else if (kind === 'IDAT') idat.push(d);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  if (!w || !h || !(type in CHANNELS)) throw new Error('bad PNG header');
  if (inter) throw new Error('interlaced PNG');
  const ch = CHANNELS[type], bitsPx = ch * depth, bpp = Math.max(1, bitsPx >> 3), stride = Math.ceil(w * bitsPx / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < h * (stride + 1)) throw new Error('short PNG data');
  const rows = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= bpp ? rows[dst + i - bpp] : 0, b = y ? rows[up + i] : 0, c = y && i >= bpp ? rows[up + i - bpp] : 0;
      rows[dst + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 0xff;
    }
  }
  const out = new Uint8Array(w * h * 4);
  // (a sample of `depth` bits at index i of a row, as 0-255 for grey or as the index itself for a palette)
  const sample = (row, i) => {
    if (depth === 8) return rows[row + i];
    if (depth === 16) return rows[row + i * 2];
    const per = 8 / depth, byte = rows[row + Math.floor(i / per)], shift = 8 - depth * (i % per + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  const tGrey = trns && type === 0 ? trns.readUInt16BE(0) : -1, tRgb = trns && type === 2 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (type === 3) {
        const k = sample(row, x);
        out[o] = pal ? pal[k * 3] : 0; out[o + 1] = pal ? pal[k * 3 + 1] : 0; out[o + 2] = pal ? pal[k * 3 + 2] : 0;
        out[o + 3] = trns && k < trns.length ? trns[k] : 255;
      } else if (type === 0) {
        const s = sample(row, x), v = Math.round(s * scale);
        out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = (depth === 16 ? (rows[row + x * 2] << 8 | rows[row + x * 2 + 1]) : s) === tGrey ? 0 : 255;
      } else if (type === 4) {
        const v = sample(row, x * 2); out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = sample(row, x * 2 + 1);
      } else if (type === 2) {
        const r = sample(row, x * 3), g = sample(row, x * 3 + 1), b = sample(row, x * 3 + 2);
        out[o] = r; out[o + 1] = g; out[o + 2] = b;
        out[o + 3] = tRgb && depth === 8 && r === tRgb[0] && g === tRgb[1] && b === tRgb[2] ? 0 : 255;
      } else {
        out[o] = sample(row, x * 4); out[o + 1] = sample(row, x * 4 + 1); out[o + 2] = sample(row, x * 4 + 2); out[o + 3] = sample(row, x * 4 + 3);
      }
    }
  }
  return { width: w, height: h, data: out };
}

function chunk(kind, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(kind, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(data, crc32(head.subarray(4, 8))), 0);
  return Buffer.concat([head, data, tail]);
}
// pixels (RGBA) -> PNG; grey: true keeps only the grey and alpha (white clouds: half the bytes)
function encode(width, height, rgba, opt) {
  const grey = !!(opt && opt.grey), ch = grey ? 2 : 4, stride = width * ch;
  const line = new Uint8Array(stride), prev = new Uint8Array(stride), raw = Buffer.alloc(height * (stride + 1)), cand = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = x * ch;
      if (grey) { line[d] = rgba[s]; line[d + 1] = rgba[s + 3]; } else { line[d] = rgba[s]; line[d + 1] = rgba[s + 1]; line[d + 2] = rgba[s + 2]; line[d + 3] = rgba[s + 3]; }
    }
    // (each row's filter the one leaving the smallest sum - the usual choice)
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? line[i - ch] : 0, b = y ? prev[i] : 0, c = y && i >= ch ? prev[i - ch] : 0;
        const v = (line[i] - (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
        cand[i] = v; sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    const o = y * (stride + 1); raw[o] = best;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = y ? prev[i] : 0, c = y && i >= ch ? prev[i - ch] : 0;
      raw[o + 1 + i] = (line[i] - (best === 0 ? 0 : best === 1 ? a : best === 2 ? b : best === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
    }
    prev.set(line);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = grey ? 4 : 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { decode, encode, crc32 };
