'use strict';
// GRIB2 fields read without a library: NOAA's GFS as its NOMADS server cuts it - a regular latitude/longitude grid
// (grid template 3.0), packed simply (5.0) or with complex packing and spatial differencing (5.3, what the GFS uses).
// Each message -> { discipline, category, number, level: { type, value }, ni, nj, la1, lo1, di, dj, scan, values }.

function bitReader(buf, start) {
  let pos = start * 8;
  return {
    get pos() { return pos; },
    align() { pos = Math.ceil(pos / 8) * 8; },
    read(n) {
      if (n === 0) return 0;
      let v = 0;
      for (let i = 0; i < n; i++) { const b = buf[(pos >> 3)]; v = v * 2 + ((b >> (7 - (pos & 7))) & 1); pos++; }
      return v;
    }
  };
}
const sm16 = v => (v & 0x8000 ? -(v & 0x7fff) : v);
const sm32 = v => (v & 0x80000000 ? -(v & 0x7fffffff) : v);
function smBytes(buf, off, n) { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + buf[off + i]; const top = Math.pow(2, 8 * n - 1); return v >= top ? -(v - top) : v; }

// the field's values from its data section (7), its packing (section 5) given
function unpack(s5, s7, n) {
  const tmpl = s5.readUInt16BE(9), R = s5.readFloatBE(11), E = sm16(s5.readUInt16BE(15)), D = sm16(s5.readUInt16BE(17)), nb = s5[19];
  const bs = Math.pow(2, E), ds = Math.pow(10, -D), out = new Float64Array(n);
  if (tmpl === 0) {
    const br = bitReader(s7, 5);
    for (let i = 0; i < n; i++) out[i] = (R + br.read(nb) * bs) * ds;
    return out;
  }
  if (tmpl !== 3 && tmpl !== 2) throw new Error('GRIB2 packing ' + tmpl + ' not read');
  const missMgmt = s5[22], NG = s5.readUInt32BE(31), refW = s5[35], nbW = s5[36], refL = s5.readUInt32BE(37), incL = s5[41], lastL = s5.readUInt32BE(42), nbL = s5[46];
  const order = tmpl === 3 ? s5[47] : 0, nOct = tmpl === 3 ? s5[48] : 0;
  if (missMgmt !== 0) throw new Error('GRIB2 missing values not read');
  let off = 5; const extra = [];
  for (let i = 0; i < (order ? order + 1 : 0); i++) { extra.push(smBytes(s7, off, nOct)); off += nOct; }
  const br = bitReader(s7, off);
  const ref = new Array(NG), wid = new Array(NG), len = new Array(NG);
  for (let g = 0; g < NG; g++) ref[g] = br.read(nb);
  br.align();
  for (let g = 0; g < NG; g++) wid[g] = refW + br.read(nbW);
  br.align();
  for (let g = 0; g < NG; g++) len[g] = refL + br.read(nbL) * incL;
  len[NG - 1] = lastL;
  br.align();
  const X = new Float64Array(n); let k = 0;
  for (let g = 0; g < NG; g++) { for (let i = 0; i < len[g] && k < n; i++) X[k++] = ref[g] + br.read(wid[g]); }
  if (k !== n) throw new Error('GRIB2 group lengths do not add up (' + k + ' of ' + n + ')');
  // (spatial differencing undone: the first one or two values as given, the rest built back from the differences)
  if (order === 1) { const minsd = extra[1]; X[0] = extra[0]; for (let i = 1; i < n; i++) X[i] = X[i] + minsd + X[i - 1]; }
  else if (order === 2) { const minsd = extra[2]; X[0] = extra[0]; X[1] = extra[1]; for (let i = 2; i < n; i++) X[i] = X[i] + minsd + 2 * X[i - 1] - X[i - 2]; }
  for (let i = 0; i < n; i++) out[i] = (R + X[i] * bs) * ds;
  return out;
}

function decode(buf) {
  const out = [];
  let off = 0;
  while (off + 16 <= buf.length) {
    if (buf.toString('latin1', off, off + 4) !== 'GRIB') { off++; continue; }
    const total = Number(buf.readBigUInt64BE(off + 8)), discipline = buf[off + 6], end = off + total;
    let p = off + 16, s3 = null, s4 = null, s5 = null;
    while (p + 5 <= end) {
      if (buf.toString('latin1', p, p + 4) === '7777') break;
      const len = buf.readUInt32BE(p), num = buf[p + 4], sec = buf.subarray(p, p + len);
      if (num === 3) s3 = sec; else if (num === 4) s4 = sec; else if (num === 5) s5 = sec;
      else if (num === 6 && sec[5] !== 255) throw new Error('GRIB2 bitmaps not read');
      else if (num === 7) {
        if (!s3 || !s4 || !s5) throw new Error('GRIB2 message without its grid or packing');
        if (s3.readUInt16BE(12) !== 0) throw new Error('GRIB2 grid template ' + s3.readUInt16BE(12) + ' not read');
        const ni = s3.readUInt32BE(30), nj = s3.readUInt32BE(34), n = s5.readUInt32BE(5);
        const msg = {
          discipline, category: s4[9], number: s4[10],
          level: { type: s4[22], value: s4.readUInt32BE(24) / Math.pow(10, s4[23] & 0x80 ? -(s4[23] & 0x7f) : s4[23]) },
          hours: s4.readUInt32BE(18),
          ni, nj, la1: sm32(s3.readUInt32BE(46)) / 1e6, lo1: sm32(s3.readUInt32BE(50)) / 1e6, la2: sm32(s3.readUInt32BE(55)) / 1e6, lo2: sm32(s3.readUInt32BE(59)) / 1e6,
          di: s3.readUInt32BE(63) / 1e6, dj: s3.readUInt32BE(67) / 1e6, scan: s3[71],
          values: unpack(s5, sec, n)
        };
        out.push(msg);
      }
      p += len;
    }
    off = end;
  }
  return out;
}

module.exports = { decode };
