  // ------------------------------------------------------------------------------------------------------------
  // PART 1 — PAGE-WORLD INTERCEPTOR (injected as a <script>; must be self-contained, no closures over the outside)
  // ------------------------------------------------------------------------------------------------------------
  function pageInterceptor() {
    'use strict';
    var NS = '__tweeksLaddBridge';
    var BRIDGE_V = '__TL_VERSION__';
    if (window[NS]) { try { window[NS].hello(); } catch (e) { /* ignore */ } return; }

    var resolved = new Map();     // fr24 flight id -> identity record (incl. photos)
    // The callsign shown: the one the transponder sends; when none is known yet, the registration the way a transponder
    // sends it - ICAO callsigns have no hyphen (I-ADVD flying on its registration is "IADVD", never "I-ADVD")
    var csOf = function (rec) { if (!rec) return ''; var c = String(rec.cs || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); return c || String(rec.reg || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); };
    var routes = new Map();       // fr24 flight id -> route / schedule / progress
    var telem = new Map();        // fr24 flight id -> live ADS-B telemetry { vr, sq, agps, ias, tas, mach, oat, wd, ws, mcp, at }
    var lastPos = new Map();      // fr24 flight id -> last position of a callsign-less flight seen in any feed
    var pbPos = new Map();        // the same, in FR24's playback (the moment being played)
    // FR24's own flights with no destination ("N/A") whose predicted one is good: on the airport boards like the rest
    var naRecs = new Map(), naRoutes = new Map();
    var recOf = function (id) { return resolved.get(id) || naRecs.get(id); }, routeOf = function (id) { return routes.get(id) || naRoutes.get(id); };
    var curNa = null;             // (while a LiveFeed answer is read: its N/A flights)
    var hist = new Map();         // registration -> { data: [flight list entries], at } for the "Recent <reg> flights" dropdown
    var histWait = new Map();     // registration -> [resolve callbacks] waiting for the userscript to supply history
    var photoCache = new Map();   // HEX -> { photos, at, err, final } - the pictures shown (from the userscript)
    var psCache = new Map();      // HEX -> { photos, at, err } - Planespotters answers (the fallback source)
    var photoJobs = new Map();    // hex -> promise
    var stats = { liveFeed: 0, follow: 0, patched: 0, errors: 0, lastError: '', maskPatched: 0, maskDisabled: false, scans: 0, searchHits: 0, boardHits: 0, details: 0, lists: 0, flightDetails: 0, boardRefreshes: 0, unlocked: 0 };
    var feedHeaders = null;       // request headers of FR24's own LiveFeed requests (device id, platform, ...)
    var enc = new TextEncoder();
    var fr24ImgSent = {};   // flight id -> FR24's own photos already handed to the userscript
    var dec = new TextDecoder();
    var oFetch = window.fetch;

    function post(type, payload) {
      var msg = Object.assign({ __tweeksLadd: type }, payload || {});
      try { window.postMessage(msg, location.origin); } catch (e) { /* ignore */ }
    }

    // ---- protobuf wire helpers -------------------------------------------------------------------------------
    function readVarint(b, p) { var r = 0, mul = 1, x; do { x = b[p++]; r += (x & 0x7f) * mul; mul *= 128; } while (x & 0x80); return [r, p]; }
    function varintBytes(n) { var o = []; n = Math.max(0, Math.floor(n)); do { var x = n % 128; n = Math.floor(n / 128); if (n) x |= 0x80; o.push(x); } while (n); return o; }
    // int32 fields encode negative numbers as 10-byte two's complement varints
    function varintInt32(n) {
      n = Math.round(n); if (n >= 0) return varintBytes(n);
      var v = (BigInt(1) << BigInt(64)) + BigInt(n), o = [];
      while (v >= BigInt(128)) { o.push(Number(v & BigInt(127)) | 0x80); v >>= BigInt(7); }
      o.push(Number(v)); return o;
    }
    function parse(b) {
      var out = [], p = 0;
      while (p < b.length) {
        var kv = readVarint(b, p), key = kv[0], q = kv[1];
        var fn = Math.floor(key / 8), wt = key & 7, end, val;
        if (wt === 0) { var v = readVarint(b, q); val = v[0]; end = v[1]; }
        else if (wt === 1) { end = q + 8; val = b.subarray(q, end); }
        else if (wt === 5) { end = q + 4; val = b.subarray(q, end); }
        else if (wt === 2) { var l = readVarint(b, q); end = l[1] + l[0]; val = b.subarray(l[1], end); }
        else throw new Error('wire type ' + wt);
        if (end > b.length) throw new Error('truncated');
        out.push({ fn: fn, wt: wt, val: val, raw: b.subarray(p, end) });
        p = end;
      }
      return out;
    }
    function concat(parts) { var n = 0, i; for (i = 0; i < parts.length; i++) n += parts[i].length; var o = new Uint8Array(n), p = 0; for (i = 0; i < parts.length; i++) { o.set(parts[i], p); p += parts[i].length; } return o; }
    function fLen(fn, bytes) { return concat([Uint8Array.from(varintBytes(fn * 8 + 2)), Uint8Array.from(varintBytes(bytes.length)), bytes]); }
    function fStr(fn, s) { return fLen(fn, enc.encode(String(s))); }
    function fVar(fn, n) { return Uint8Array.from(varintBytes(fn * 8).concat(varintBytes(n))); }
    function fInt(fn, n) { return Uint8Array.from(varintBytes(fn * 8).concat(varintInt32(n))); }
    // FR24 prints a squawk as the hex digits of its integer, so code 0570 travels as 0x0570 (not octal 0570 = 376)
    function squawkWire(sq) { return parseInt(Number(sq).toString(8), 16); }
    function fF32(fn, v) { var b = new Uint8Array(5); b[0] = fn * 8 + 5; new DataView(b.buffer).setFloat32(1, v, true); return b; }
    function f32(v) { return new DataView(v.buffer, v.byteOffset, 4).getFloat32(0, true); }
    function find(fs, fn) { for (var i = 0; i < fs.length; i++) if (fs[i].fn === fn) return fs[i]; return null; }
    function strOf(fs, fn) { var f = find(fs, fn); return f && f.wt === 2 && f.val.length ? dec.decode(f.val) : ''; }
    function numOf(fs, fn) { var f = find(fs, fn); return f && f.wt === 0 ? f.val : 0; }
    function fltOf(fs, fn) { var f = find(fs, fn); return f && f.wt === 5 ? f32(f.val) : NaN; }
    function has(fs, fn) { var f = find(fs, fn); if (!f) return false; if (f.wt === 2) return f.val.length > 0; if (f.wt === 0) return f.val !== 0; return true; }
    function frameHeader(flag, len) { return Uint8Array.of(flag, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255); }
    var fin = function (v) { return typeof v === 'number' && isFinite(v); };

    // ---- base64 (grpc-web-text: frames are individually padded; must decode in 4-char groups) ---------------
    var B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var B64M = new Int16Array(256); for (var bi = 0; bi < 256; bi++) B64M[bi] = -1; for (bi = 0; bi < 64; bi++) B64M[B64C.charCodeAt(bi)] = bi; B64M[61] = 64;
    function b64DecodeInto(text, out) {
      for (var i = 0; i + 4 <= text.length; i += 4) {
        var a = B64M[text.charCodeAt(i)], b = B64M[text.charCodeAt(i + 1)], c = B64M[text.charCodeAt(i + 2)], d = B64M[text.charCodeAt(i + 3)];
        if (a < 0 || b < 0 || c < 0 || d < 0 || a === 64 || b === 64) throw new Error('bad base64');
        out.push((a << 2) | (b >> 4));
        if (c !== 64) { out.push(((b & 15) << 4) | (c >> 2)); if (d !== 64) out.push(((c & 3) << 6) | d); }
      }
    }
    function b64Encode(bytes) {
      var s = '', n = bytes.length;
      for (var i = 0; i < n; i += 3) {
        var a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0;
        s += B64C[a >> 2] + B64C[((a & 3) << 4) | (b >> 4)] + (i + 1 < n ? B64C[((b & 15) << 2) | (c >> 6)] : '=') + (i + 2 < n ? B64C[c & 63] : '=');
      }
      return s;
    }

    // ---- LiveFeed request: make sure the field mask asks for type + reg ---------------------------------------
    // the map's view (the bounds FR24 asks its feed for): the userscript polls the aggregators for exactly this area
    var lastView = '';
    function noteView(fs) {
      var bf = find(fs, 1); if (!bf || bf.wt !== 2) return;
      var q = parse(bf.val), v = { n: fltOf(q, 1), s: fltOf(q, 2), w: fltOf(q, 3), e: fltOf(q, 4) };
      if (!fin(v.n) || !fin(v.s) || !fin(v.w) || !fin(v.e)) return;
      var key = [v.n, v.s, v.w, v.e].map(function (x) { return x.toFixed(2); }).join(',');
      if (key !== lastView) { lastView = key; post('view', v); }
    }
    function patchLiveFeedRequest(body) {
      var b = body instanceof ArrayBuffer ? new Uint8Array(body) : (ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : null);
      if (!b || b.length < 5 || b[0] !== 0) return body;
      var len = ((b[1] << 24) | (b[2] << 16) | (b[3] << 8) | b[4]) >>> 0;
      if (5 + len > b.length) return body;
      var fs = parse(b.subarray(5, 5 + len)), paths = [], parts = [], i;
      try { noteView(fs); } catch (e) { /* ignore */ }
      if (stats.maskDisabled) return body;
      for (i = 0; i < fs.length; i++) {
        if (fs[i].fn === 10 && fs[i].wt === 2) { var m = parse(fs[i].val); for (var j = 0; j < m.length; j++) if (m[j].fn === 1 && m[j].wt === 2) paths.push(dec.decode(m[j].val)); }
        else parts.push(fs[i].raw);
      }
      var want = ['type', 'reg'], changed = false;
      for (i = 0; i < want.length; i++) if (paths.indexOf(want[i]) < 0) { paths.push(want[i]); changed = true; }
      if (!changed) return body;
      var maskParts = []; for (i = 0; i < paths.length; i++) maskParts.push(fStr(1, paths[i]));
      parts.push(fLen(10, concat(maskParts)));
      var nb = concat(parts), out = concat([frameHeader(0, nb.length), nb, b.subarray(5 + len)]);
      stats.maskPatched++;
      return out;
    }

    // ---- public ADS-B telemetry of every ordinary aircraft in view (from the userscript's view poll) --------------------
    // keyed 'C'+callsign and 'R'+registration; a match must also be where FR24 draws the flight
    var pubTel = new Map(), pubTelPruned = 0;
    // hex (upper case) -> { o: owner / operator name, a: age in years, m: serial number, c: FR24 country id }: what the
    // userscript holds of ordinary aircraft, for their first frame (06 pubIds)
    var pubIds = new Map();
    var PT_NUM = ['vr', 'agps', 'ias', 'tas', 'mach', 'oat', 'wd', 'ws'];
    function acceptPubTel(rows) {
      var t = Date.now();
      for (var i = 0; i < (rows || []).length; i++) {
        var r = rows[i]; if (!r) continue;
        var e = { hex: r[2], lat: r[3], lon: r[4], at: r[5], vr: r[6], sqs: r[7] || '', sq: r[7] ? parseInt(r[7], 8) : 0, agps: r[8], ias: r[9], tas: r[10], mach: r[11], oat: r[12], wd: r[13], ws: r[14], air: r[15] || '', airId: r[16] || '', gnd: !!r[17], pub: true };
        for (var k = 0; k < PT_NUM.length; k++) if (e[PT_NUM[k]] == null) e[PT_NUM[k]] = NaN;
        if (r[0]) { var pc = pubTel.get('C' + r[0]); if (!pc || pc.at <= e.at) pubTel.set('C' + r[0], e); }
        if (r[1]) { var pr = pubTel.get('R' + r[1]); if (!pr || pr.at <= e.at) pubTel.set('R' + r[1], e); }
      }
      if (t - pubTelPruned > 60000) {
        pubTelPruned = t;
        pubTel.forEach(function (v, key) { if (t - v.at > 180000) pubTel.delete(key); });
        telem.forEach(function (v, key) { if (v.pub && t - v.at > 180000) telem.delete(key); });
      }
    }
    // The public figures at the very moment FR24's own data is for (the time its record or frame carries): between the two
    // public reports either side of it, what changes steadily - climb, heights, speeds - in proportion, the squawk, wind and
    // airspace from the nearer; FR24 ahead of everything heard, the latest. So they move with FR24's own figures, frame by frame.
    var telemHist = new Map(), TEL_NUM = ['vr', 'agps', 'ias', 'tas', 'mach', 'oat', 'ws'];
    function noteTelem(id, t) { if (!t || !(t.at > 0)) return; var h = telemHist.get(id) || []; if (!h.length || t.at > h[h.length - 1].at) { h.push(t); if (h.length > 40) h.shift(); } telemHist.set(id, h); if (telemHist.size > 300) telemHist.delete(telemHist.keys().next().value); }
    function telAt(id, tsS) {
      var last = telem.get(id), h = telemHist.get(id); if (!h || h.length < 2 || !(tsS > 0)) return last || null;
      var tms = tsS * 1000, i = 0; while (i < h.length && h[i].at < tms) i++;
      if (i >= h.length) return last || h[h.length - 1];
      if (i === 0) return h[0];
      var a = h[i - 1], b = h[i], f = (tms - a.at) / (b.at - a.at), near = f < 0.5 ? a : b; if (b.at - a.at > 60000) return near;
      var o = Object.assign({}, near); for (var k = 0; k < TEL_NUM.length; k++) { var x = a[TEL_NUM[k]], y = b[TEL_NUM[k]]; if (fin(x) && fin(y)) o[TEL_NUM[k]] = x + (y - x) * f; }
      o.at = b.at; return o;
    }
    function pubTelFor(cs, reg, lat, lon) {
      cs = String(cs || '').toUpperCase(); reg = String(reg || '').toUpperCase();
      var e = (cs && pubTel.get('C' + cs)) || (reg && pubTel.get('R' + reg));
      if (!e || Date.now() - e.at > (e.gnd ? 900000 : 90000)) return null;
      if (fin(lat) && fin(lon) && (lat || lon) && (Math.abs(lat - e.lat) > 0.6 || Math.abs(lon - e.lon) > 0.9)) return null;
      return e;
    }

    // ---- LiveFeed response (Flight message, _common.proto) ----------------------------------------------------
    function patchFlight(fb, report, selected, at, readOnly, pbTs) {
      var fs = parse(fb), idF = find(fs, 1);
      if (!idF || idF.wt !== 0) return fb;
      var id = idF.val, cs = strOf(fs, 11);
      var extraF = find(fs, 13), ex = extraF && extraF.wt === 2 ? parse(extraF.val) : [];
      var type = strOf(ex, 4), reg = strOf(ex, 2);
      if (!cs) {
        var rep = { id: id, lat: fltOf(fs, 2), lon: fltOf(fs, 3), trk: numOf(fs, 4), alt: numOf(fs, 5), spd: numOf(fs, 6), icon: numOf(fs, 7),
          ts: numOf(fs, 9), gnd: !!numOf(fs, 10), src: numOf(fs, 12), type: type, reg: reg, sel: !!selected };
        if (report) report.push(rep);
        (pbTs ? pbPos : lastPos).set(id, { lat: rep.lat, lon: rep.lon, alt: rep.alt, gnd: rep.gnd, at: at });
      } else if (curNa && !resolved.has(id)) {
        // a flight FR24 identifies but has no destination for: reported for the boards' predictions
        var rtF = find(ex, 3), rt = rtF && rtF.wt === 2 ? parse(rtF.val) : [];
        if (!strOf(rt, 2)) {
          var na = { id: id, lat: fltOf(fs, 2), lon: fltOf(fs, 3), trk: numOf(fs, 4), alt: numOf(fs, 5), spd: numOf(fs, 6), ts: numOf(fs, 9), gnd: !!numOf(fs, 10), cs: cs, reg: reg, type: type, hex: numOf(ex, 14), from: strOf(rt, 1) };
          if (fin(na.lat) && fin(na.lon) && (na.lat || na.lon)) { curNa.push(na); lastPos.set(id, { lat: na.lat, lon: na.lon, alt: na.alt, gnd: na.gnd, at: at }); }
        }
      }
      if (readOnly) return fb;        // (a background scan's answer: read for its reports, never drawn)
      if (cs) {
        // An ordinary flight. For free accounts FR24 marks its vertical speed / GPS altitude / airspeeds / wind /
        // temperature / airspace as subscriber-only in THIS record (the panel takes its padlocks from here, not from the
        // follow stream). Every aircraft in view has fresh public ADS-B telemetry (the userscript polls the view), so
        // those flags are dropped and the public values supplied in every record - whichever flight is opened, the
        // panel shows them as ordinary text from its first frame.
        // (in FR24's playback: the figures of that moment, from the flight's own ADS-B track - never today's)
        var fts = numOf(fs, 9), tl0 = pbTs ? pbTelAt(id, fts || pbTs) : telAt(id, fts);
        if (!pbTs && (!tl0 || Date.now() - tl0.at > 90000)) { var pt0 = pubTelFor(cs, reg, fltOf(fs, 2), fltOf(fs, 3)); if (pt0) { tl0 = pt0; telem.set(id, pt0); noteTelem(id, pt0); } }
        if (tl0 && Date.now() - tl0.at < 90000 && extraF && extraF.wt === 2) {
          var exU = [], k0, airU = tl0.air || '';
          // (FR24's flags: 16 squawk, 17 vertical speed, 18 airspace, 13 the rest - set means padlocked)
          var sqU = tl0.sq > 0 && !has(ex, 5) ? tl0.sq : 0;
          for (k0 = 0; k0 < ex.length; k0++) { var fu = ex[k0].fn; if (fu === 6 || fu === 12 || fu === 13 || fu === 17 || (sqU && fu === 16) || (airU && (fu === 11 || fu === 18 || fu === 19))) continue; exU.push(ex[k0].raw); }
          if (fin(tl0.vr)) exU.push(fInt(6, Math.round(tl0.vr)));
          if (sqU) exU.push(fVar(5, squawkWire(sqU)));
          var emsU = emsBytes(tl0); if (emsU) exU.push(fLen(12, emsU));
          if (airU) { exU.push(fStr(11, airU)); if (tl0.airId) exU.push(fStr(19, tl0.airId)); }   // FIR name + its ICAO code (the badge)
          var keepU = []; for (k0 = 0; k0 < fs.length; k0++) if (fs[k0].fn !== 13) keepU.push(fs[k0].raw);
          keepU.push(fLen(13, concat(exU)));
          stats.unlocked++;
          return concat(keepU);
        }
        return fb;
      }
      var rec = resolved.get(id); if (!rec) return fb;
      var label = csOf(rec); if (!label) return fb;
      var route = pbTs ? pbRoutes.get(id) : routes.get(id);
      var keep = [];
      for (var i = 0; i < fs.length; i++) if (fs[i].fn !== 11 && fs[i].fn !== 13) keep.push(fs[i].raw);
      keep.push(fStr(11, label));
      var exKeep = [];
      var tlL = pbTs ? pbTelAt(id, numOf(fs, 9) || pbTs) : telAt(id, numOf(fs, 9)); if (tlL && Date.now() - tlL.at > 90000) tlL = null;
      var airL = tlL && tlL.air || '';
      var sqL = (tlL && tlL.sq > 0 ? tlL.sq : rec.squawk) || 0; if (has(ex, 5)) sqL = 0;
      for (i = 0; i < ex.length; i++) { var f = ex[i]; if ((f.fn === 2 && !f.val.length) || (f.fn === 14 && !f.val)) continue; if (tlL && (f.fn === 6 || f.fn === 12 || f.fn === 13 || f.fn === 17)) continue; if (sqL && f.fn === 16) continue; if (airL && (f.fn === 11 || f.fn === 18 || f.fn === 19)) continue; exKeep.push(f.raw); }
      if (tlL) { if (fin(tlL.vr)) exKeep.push(fInt(6, Math.round(tlL.vr))); var emsL = emsBytes(tlL); if (emsL) exKeep.push(fLen(12, emsL)); if (airL) { exKeep.push(fStr(11, airL)); if (tlL.airId) exKeep.push(fStr(19, tlL.airId)); } }
      if (rec.reg && !has(ex, 2)) exKeep.push(fStr(2, rec.reg));
      if (rec.type && !has(ex, 4)) exKeep.push(fStr(4, rec.type));
      if (rec.hexNum && !has(ex, 14)) exKeep.push(fVar(14, rec.hexNum));
      if (rec.operatorId && !has(ex, 15)) exKeep.push(fVar(15, rec.operatorId));
      if (rec.operatorId && !has(ex, 10)) exKeep.push(fVar(10, rec.operatorId));
      if (rec.countryId && !has(ex, 8)) exKeep.push(fVar(8, rec.countryId));
      if ((rec.ageText || rec.age > 0) && !has(ex, 7)) exKeep.push(fStr(7, rec.ageText || (rec.age + (rec.age === 1 ? ' year' : ' years'))));
      if (sqL > 0) exKeep.push(fVar(5, squawkWire(sqL)));            // (no 16: squawkAvailability set is FR24's padlock)
      if (route && !has(ex, 3) && (route.originIata || route.destIata)) {
        var rp = []; if (route.originIata) rp.push(fStr(1, route.originIata)); if (route.destIata) rp.push(fStr(2, route.destIata));
        exKeep.push(fLen(3, concat(rp)));
      }
      if (exKeep.length) keep.push(fLen(13, concat(exKeep)));
      stats.patched++;
      return concat(keep);
    }
    var lastFeedTotal = 0;
    function patchLiveFeed(body, bg, pbTs) {
      var fs = parse(body), report = [], parts = [], changed = false, serverTime = 0, total = 0, at = Date.now();
      curNa = bg || pbTs ? null : [];
      for (var i = 0; i < fs.length; i++) {
        var f = fs[i];
        if (f.wt === 2 && (f.fn === 1 || f.fn === 3)) {
          total++;
          if (pbTs && f.fn === 3) pbSelOf(f.val, pbTs);
          var nb = patchFlight(f.val, report, f.fn === 3, at, !!bg, pbTs);
          if (nb !== f.val) { changed = true; parts.push(fLen(f.fn, nb)); } else parts.push(f.raw);
        } else { if (f.fn === 4 && f.wt === 0) serverTime = f.val; parts.push(f.raw); }
      }
      // (FR24's playback: the moment's unnamed flights, for the userscript to name as they were then - never as live ones)
      if (pbTs) { post('pbFeed', { ts: pbTs, flights: report, at: at }); curNa = null; return changed ? concat(parts) : body; }
      if (!bg) stats.liveFeed++;
      lastFeedTotal = total;
      post('feed', { flights: report, na: curNa || [], serverTime: serverTime, total: total, at: at, bg: !!bg });
      curNa = null;
      return changed ? concat(parts) : body;
    }
    function patchFrames(buf, patchBody) {
      var b = new Uint8Array(buf), out = [], p = 0;
      while (p + 5 <= b.length) {
        var flag = b[p], len = ((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]) >>> 0, s = p + 5, e = s + len;
        if (e > b.length) break;
        if (flag === 0) { var nb = patchBody(b.subarray(s, e)); out.push(frameHeader(0, nb.length), nb); } else out.push(b.subarray(p, e));
        p = e;
      }
      if (p < b.length) out.push(b.subarray(p));
      return concat(out).buffer;
    }

    // ---- FollowFlight (FollowFlightResponse: 1 AircraftInfo, 3 ScheduleInfo, 4 FlightProgress, 5 ExtendedFlightInfo, 6 trail)
    // Field numbers were read from FR24's generated protobuf code:
    //   AircraftInfo        1 icao 2 reg 3 countryOfReg 4 type 5 icon 6 fullDescription 7 msn 8 service 9 birthDate 10 age
    //                       11 images 12 isTestFlight 13 msnAvailable 14 ageAvailable 15 registeredOwners 16 countryAvailable
    //   ExtendedFlightInfo  1 id 2 lat 3 lon 4 track 5 alt 6 speed 7 status 8 tsMs 9 onGround 10 callsign 11 source
    //                       12 emsAvailability 13 emsInfo 14 squawkAvailability 15 squawk 16 vspeedAvailability 17 vspeed
    //                       18 airspaceAvailability 19 airspace 20 airspaceId 21 serverTimeMs
    //   EmsInfo             1 qnh 2 amcp 3 afms 4 oat 5 ias 6 tas 7 mach(x1000) 8 agps 9 agpsdiff 10 apflags 11 windDir 12 windSpd
    // FR24 draws a padlock (subscription upsell) wherever an "availability" flag is set. For values this script supplies
    // itself from public ADS-B, the flag is cleared, so the panel shows them as ordinary text.
    function emsBytes(t) {
      var e = [];
      if (fin(t.oat)) e.push(fInt(4, Math.round(t.oat)));
      if (fin(t.ias) && t.ias > 0) e.push(fInt(5, Math.round(t.ias)));
      if (fin(t.tas) && t.tas > 0) e.push(fInt(6, Math.round(t.tas)));
      if (fin(t.mach) && t.mach > 0) e.push(fInt(7, Math.round(t.mach * 1000)));
      if (fin(t.agps)) e.push(fInt(8, Math.round(t.agps)));
      if (fin(t.wd)) e.push(fInt(11, Math.round(t.wd)));
      if (fin(t.ws)) e.push(fInt(12, Math.round(t.ws)));
      return e.length ? concat(e) : null;
    }
    // The two messages that describe one flight in full share their parts, under different field numbers:
    //   FollowFlightResponse   1 AircraftInfo, 3 ScheduleInfo, 4 FlightProgress, 5 ExtendedFlightInfo, 6 trail (the panel)
    //   FlightDetailsResponse  1 AircraftInfo, 2 ScheduleInfo, 3 FlightProgress, 4 ExtendedFlightInfo    (the search card)
    var FOLLOW = { ai: 1, sched: 3, prog: 4, efi: 5, trail: 6, follow: true };
    var DETAILS = { ai: 1, sched: 2, prog: 3, efi: 4, trail: 0, follow: false };
    // FR24's map playback: a flight's panel as it was at a moment (PlaybackFlightResponse: 1 AircraftInfo, 2 ScheduleInfo,
    // 3 ExtendedFlightInfo, 4 trail points, 5 FlightProgress) - its route and figures are those of that moment
    var PLAYBACK = { ai: 1, sched: 2, efi: 3, trail: 4, prog: 5, follow: false, pb: true };
    var pbRoutes = new Map(), pbSent = {}, pbTrace = null;   // (the userscript's: each flight as flown; the open flight's track)
    // The figures FR24 padlocks, at the moment being played, from the open flight's ADS-B track: what changes steadily -
    // heights, speeds, climb - in proportion between two reports at most two minutes apart, the squawk and the wind from
    // the nearer. Rows: [t, alt, GPS alt, vertical rate, IAS, TAS, squawk, wind dir, wind speed, sent by the aircraft 1/0]
    function pbTelAt(id, ts) {
      var tr = pbTrace; if (!tr || tr.id !== id || !ts || !tr.pts.length) return null;
      var P = tr.pts, lo = 0, hi = P.length - 1; while (lo < hi) { var m = (lo + hi) >> 1; if (P[m][0] < ts) lo = m + 1; else hi = m; }
      var b = P[lo], a = P[lo - 1] || b; if (Math.abs(b[0] - ts) > 120 && Math.abs(a[0] - ts) > 120) return null;
      var f = b[0] > a[0] && ts > a[0] && ts < b[0] && b[0] - a[0] <= 120 ? (ts - a[0]) / (b[0] - a[0]) : (Math.abs(a[0] - ts) <= Math.abs(b[0] - ts) ? 0 : 1), near = f < 0.5 ? a : b;
      var mix = function (k) { var x = a[k], y = b[k]; return fin(x) && fin(y) ? x + (y - x) * f : fin(near[k]) ? near[k] : NaN; };
      var own = near[9] !== 0, n = function (v) { return fin(v) ? v : NaN; };
      return { vr: own ? mix(3) : NaN, agps: own ? mix(2) : NaN, ias: own ? mix(4) : NaN, tas: own ? mix(5) : NaN, mach: NaN, oat: NaN, wd: n(near[7]), ws: n(near[8]), sq: near[6] ? parseInt(near[6], 8) || 0 : 0, air: near[10] || '', airId: near[11] || '', at: Date.now() };
    }
    // FR24's playback - the map's, an aircraft's, a log's - moves its own figures (altitude, speed, track) along the open
    // flight's trail with its clock; the ones supplied here follow the same clock, set in the panel's own state each time the
    // clock moves - not only when FR24 asks for the panel again
    var pbTickTs = 0;
    function pbPanelTick() {
      if (!pbTrace) return; var pb = pinStore('playback'); if (!pb || !pb.active) return;
      var ac = pinStore('aircraft'), fi = ac && ac.selected && ac.selected.flightInfo, sid = pb.selectedFlightId; if (!fi) return;
      if (fi.flightId !== pbTrace.id && Number(sid) !== pbTrace.id && parseInt(String(sid), 16) !== pbTrace.id) return;
      var ts = pb.timestamp > 1e12 ? Math.round(pb.timestamp / 1000) : Math.round(pb.timestamp || 0); if (!ts || ts === pbTickTs) return; pbTickTs = ts;
      var t = pbTelAt(pbTrace.id, ts); if (!t) return;
      if (fin(t.vr)) fi.vspeed = Math.round(t.vr);
      if (t.sq > 0) fi.squawk = squawkWire(t.sq);
      if (t.air) { fi.airspace = t.air; if (t.airId) fi.airspaceId = t.airId; }
      var e = Object.assign({}, fi.emsInfo || {}), ch = false, set = function (k, v) { if (fin(v)) { e[k] = Math.round(v); ch = true; } };
      set('agps', t.agps); set('ias', t.ias > 0 ? t.ias : NaN); set('tas', t.tas > 0 ? t.tas : NaN); set('windDir', t.wd); set('windSpd', t.ws);
      if (ch) fi.emsInfo = e;
    }
    setInterval(pbPanelTick, 250);
    // (the flight selected in FR24's playback, as its feed names it: its aircraft to the userscript at once, so the track for
    // its figures is in before FR24 asks for its panel)
    var pbSelSent = {};
    function pbSelOf(fb, ts) { try { var fs = parse(fb), id = numOf(fs, 1), exF = find(fs, 13), ex = exF && exF.wt === 2 ? parse(exF.val) : [], hx = numOf(ex, 14); if (!id || pbSelSent[id]) return; pbSelSent[id] = true; post('pbHex', { id: id, ts: ts, hex: hx > 0 ? ('000000' + hx.toString(16)).slice(-6) : '', reg: strOf(ex, 2), type: strOf(ex, 4), o: 0, d: 1, sel: true }); } catch (e) { /* ignore */ } }
    // (FR24's first panel answer of a flight opened in playback waits a moment - 1.5 s at most - for its track, so its
    // padlocked figures are there from the first draw)
    var pbWaiters = [];
    function pbReady(id) { return !!pbTrace && pbTrace.id === id; }
    function whenPbReady(id, ms) { if (pbReady(id)) return Promise.resolve(); return new Promise(function (res) { var w = { id: id, res: res }; pbWaiters.push(w); oSetTimeout(function () { var i = pbWaiters.indexOf(w); if (i >= 0) { pbWaiters.splice(i, 1); res(); } }, ms); }); }
    function pbRelease() { pbWaiters = pbWaiters.filter(function (w) { if (pbReady(w.id)) { w.res(); return false; } return true; }); }
    function tsOf(body) { var b = bodyBytes(body); if (!b || b.length < 5) return 0; try { return numOf(parse(b.subarray(5)), 2); } catch (e) { return 0; } }
    // (FR24's own playback request asks for nothing of the flights but where they are: the aircraft type is asked for too
    // - one field: two or more it refuses - to tell a blocked aircraft's matches apart)
    function patchPlaybackRequest(body) {
      var b = bodyBytes(body); if (!b || b.length < 5 || b[0] !== 0) return body;
      var len = ((b[1] << 24) | (b[2] << 16) | (b[3] << 8) | b[4]) >>> 0; if (5 + len > b.length) return body;
      var fs = parse(b.subarray(5, 5 + len)), parts = [], changed = false;
      for (var i = 0; i < fs.length; i++) {
        var f = fs[i];
        if (f.fn === 1 && f.wt === 2) { var inner = parse(f.val), m = find(inner, 10); if (!m || (m.wt === 2 && !m.val.length)) { var keep = inner.filter(function (x) { return x.fn !== 10; }).map(function (x) { return x.raw; }); keep.push(fLen(10, fStr(1, 'type'))); parts.push(fLen(1, concat(keep))); changed = true; continue; } }
        parts.push(f.raw);
      }
      if (!changed) return body;
      var nb = concat(parts); return concat([frameHeader(0, nb.length), nb, b.subarray(5 + len)]);
    }
    // PlaybackResponse: 1 the LiveFeedResponse of that moment
    function patchPlayback(body, ts) {
      var fs = parse(body), parts = [], changed = false;
      for (var i = 0; i < fs.length; i++) { var f = fs[i]; if (f.fn === 1 && f.wt === 2) { var nb = patchLiveFeed(f.val, false, ts); if (nb !== f.val) { parts.push(fLen(1, nb)); changed = true; continue; } } parts.push(f.raw); }
      return changed ? concat(parts) : body;
    }
    var aiSent = {};   // flight id -> identity of a non-blocked aircraft already reported
    var curFollowId = 0;   // the flight open in the panel (its stream)
    var followSt = null;   // that stream's state: { xhr, id, lastRest (FR24's latest schedule/progress/position), out ... }
    var schedSent = {};   // flight id -> FR24's own departure / arrival airport of an ordinary flight, as last reported
    // airport-data.com pictures (FR24's fallback when it has no JetPhotos one): never shown - JetPhotos / Planespotters
    // instead when there are any, otherwise no picture at all
    var AD_RE = /airport-data/i;
    function adImg(im) { for (var k = 1; k <= 5; k++) if (AD_RE.test(strOf(im, k))) return true; return false; }
    function adJson(o) { if (!o || typeof o !== 'object') return false; for (var k in o) if (typeof o[k] === 'string' && AD_RE.test(o[k])) return true; return false; }
    var aiKeep = {};   // flight id -> { val: FR24's aircraft block of the first frame, sig: the pictures it was sent with, ... }
    var photoSig = function (l) { return (l || []).slice(0, 3).map(function (p) { return p.large || p.medium || p.thumb || ''; }).join('|'); };
    function aiWanted(fid) {
      var k = aiKeep[fid]; if (!k || k.real) return false;
      var want = k.pubHex ? ourPhotosFor(k.pubHex) : (function () { var r = resolved.get(fid); if (!r) return []; var l = goodPhotos(shownPhotos(r)); return l.length ? l : goodPhotos((psCache.get(String(r.hex || '').toUpperCase()) || {}).photos); })();
      return want.length > 0 && photoSig(want) !== k.sig;
    }
    var fileKey = function (u) { return String(u || '').split('/').pop().replace(/\?.*$/, '').replace(/\.[a-z]+$/i, '').replace(/_(?:t|tb|\d{3,4})$/i, ''); };
    var shotKeyP = function (p) { return fileKey(p && (p.large || p.medium || p.thumb)); };
    var imgKeyA = function (im) { return fileKey(strOf(im, 5) || strOf(im, 4) || strOf(im, 3) || strOf(im, 1)); };
    var realImg = function (im) { return !adImg(im) && (has(im, 3) || has(im, 4) || has(im, 5)); };
    function goodPhotos(l) { return (l || []).filter(function (p) { return p && !adJson(p); }); }
    function ourPhotosFor(hexU) { var c = photoCache.get(hexU); var l = goodPhotos(c && c.photos); if (!l.length) l = goodPhotos((psCache.get(hexU) || {}).photos); return l; }
    function photoParts(photos) {
      // url (1), copyright (2), thumbnail (3): FR24 then uses the thumbnail verbatim as the image and url as the link
      var out = [];
      for (var j = 0; j < photos.length && out.length < 3; j++) { var ph = photos[j], img = ph.large || ph.medium || ph.thumb; if (img) out.push(fLen(11, concat([fStr(1, ph.link || img), fStr(2, ph.credit || ''), fStr(3, img)]))); }
      return out;
    }
    function patchFollow(body, st) { return patchFlightMsg(body, st, FOLLOW); }
    var pushT = 0;
    function pushFollowSoon() { if (!pushT) pushT = oSetTimeout(function () { pushT = 0; pushFollow(); }, 40); }
    function pushFollow() {
      var s = followSt; if (!s || !s.xhr || s.broken || !s.lastRest || !s.id || s.xhr.readyState !== 3) return false;
      var k = aiKeep[s.id], body = k && k.val ? concat([fLen(FOLLOW.ai, k.val), s.lastRest]) : s.lastRest, nb;
      s.synth = true;
      try { nb = patchFlightMsg(body, s, FOLLOW); } catch (e) { stats.errors++; stats.lastError = String(e); return false; } finally { s.synth = false; }
      s.out += b64Encode(concat([frameHeader(0, nb.length), nb]));
      stats.pushed = (stats.pushed || 0) + 1;
      try { s.xhr.dispatchEvent(new Event('readystatechange')); } catch (e) { /* ignore */ }
      return true;
    }
    function photosChanged() { var s = followSt; if (s && s.id && aiWanted(s.id)) pushFollowSoon(); }
    function patchFlightMsg(body, st, F) {
      var fs = parse(body);
      if (F.follow && !st.synth && has(fs, F.efi)) { var rest = []; for (var ri = 0; ri < fs.length; ri++) if (fs[ri].fn === F.sched || fs[ri].fn === F.prog || fs[ri].fn === F.efi) rest.push(fs[ri].raw); st.lastRest = concat(rest); }
      // (pictures that arrived after the first frame: the aircraft block goes again, with all of them)
      if (F.follow && st.id && !has(fs, F.ai) && aiWanted(st.id)) return patchFlightMsg(concat([fLen(F.ai, aiKeep[st.id].val), body]), st, F);
      var fiF = find(fs, F.efi);
      var fid = st.id, fi0 = null;
      if (fiF && fiF.wt === 2) {
        fi0 = parse(fiF.val); var idv = numOf(fi0, 1); if (idv) fid = idv;
        if (F.follow && !st.synth) post('pos', { id: fid, lat: fltOf(fi0, 2), lon: fltOf(fi0, 3), trk: numOf(fi0, 4), alt: numOf(fi0, 5), spd: numOf(fi0, 6), gnd: !!numOf(fi0, 9), tsMs: numOf(fi0, 8), serverMs: numOf(fi0, 21), at: Date.now() });
      }
      if (F.follow && fid !== st.id && fid && !st.synth) { st.id = fid; curFollowId = fid; post('follow', { id: fid }); }
      if (F.follow && fid) curFollowId = fid;
      // FR24's own trail of this flight: where it began, how high it has been, and the path so far.
      var pts = [], maxAlt = 0;
      for (var ti = 0; F.trail && !F.pb && ti < fs.length; ti++) {
        if (fs[ti].fn !== F.trail || fs[ti].wt !== 2) continue;
        try {
          var tp = parse(fs[ti].val), talt = numOf(tp, 4);
          if (talt > 2147483647) talt = 0;
          if (talt > maxAlt) maxAlt = talt;
          pts.push({ t: numOf(tp, 1), lat: fltOf(tp, 2), lon: fltOf(tp, 3), alt: talt, gs: numOf(tp, 5), trk: numOf(tp, 6) });
        } catch (e) { /* ignore */ }
      }
      if (pts.length && fid) {
        pts.sort(function (a, b) { return a.t - b.t; });
        // every 15 s for the take-off (first 30 min) and the last hour, every 90 s in between - so a long flight's
        // departure (where it took off from) is never cut off, whatever its length
        var thin = [], t0 = pts[0].t, tN = pts[pts.length - 1].t;
        for (var k = 0; k < pts.length; k++) { var step = pts[k].t - t0 < 1800 || tN - pts[k].t < 3600 ? 15 : 90; if (!thin.length || pts[k].t - thin[thin.length - 1].t >= step || k === pts.length - 1) thin.push(pts[k]); }
        if (thin.length > 1000) { var head = thin.slice(0, 150), tail = thin.slice(-600), mid = thin.slice(150, -600), every = Math.ceil(mid.length / 250); thin = head.concat(mid.filter(function (_, i) { return i % every === 0; }), tail); }
        post('trail', { id: fid, first: pts[0], n: pts.length, maxAlt: maxAlt, pts: thin, at: Date.now() });
      }
      var rec = fid ? resolved.get(fid) : null;
      var route = fid ? (F.pb ? pbRoutes.get(fid) : routes.get(fid)) : null;
      var efiTs = fi0 ? Math.round(numOf(fi0, 8) / 1000) : 0, tl = fid ? (F.pb ? pbTelAt(fid, efiTs || st.ts) : telAt(fid, efiTs)) : null; if (tl && Date.now() - tl.at > 90000) tl = null;
      // (the flight opened in FR24's playback: the userscript is told which aircraft it is, and whether FR24 has its route)
      if (F.pb && fid && !pbSent[fid]) { var aiB = find(fs, F.ai), scB = find(fs, F.sched); if (aiB && aiB.wt === 2) { var a1 = parse(aiB.val), sc1 = scB && scB.wt === 2 ? parse(scB.val) : [], hx1 = numOf(a1, 1); pbSent[fid] = true; post('pbHex', { id: fid, ts: st.ts, hex: hx1 > 0 ? ('000000' + hx1.toString(16)).slice(-6) : '', reg: strOf(a1, 2), type: strOf(a1, 4), o: numOf(sc1, 4), d: numOf(sc1, 5) }); } }
      // an ordinary flight not yet matched in the feed (opened from a link): its view-poll telemetry, by callsign
      if (!F.pb && !tl && !rec && fi0 && fid) { var ptf = pubTelFor(strOf(fi0, 10), '', fltOf(fi0, 2), fltOf(fi0, 3)); if (ptf) { tl = ptf; telem.set(fid, ptf); noteTelem(fid, ptf); } }
      // What FR24 itself knows of an ordinary flight's route (its own departure / arrival airport ids, before anything is
      // added): a flight it shows without a destination gets the userscript's reasoned one, a flight it has a route for
      // is left alone. Read from the full frames (those carrying the aircraft block), whatever the later updates omit.
      if (F.follow && fid && !rec && !st.synth && (has(fs, F.ai) || has(fs, F.sched))) {
        // (with its times and flight number: a schedule with times but no airports is a flight FR24 has not matched yet -
        // a crew already on the next callsign at the gate - not the flight that has just landed)
        var scF = find(fs, F.sched), so = 0, sd = 0, sstd = 0, ssta = 0, satd = 0, sata = 0, snum = '', prevS = String(schedSent[fid] || '0:0').split(':');
        if (scF && scF.wt === 2) { var sc0 = parse(scF.val); so = numOf(sc0, 4); sd = numOf(sc0, 5); sstd = numOf(sc0, 7); ssta = numOf(sc0, 8); satd = numOf(sc0, 9); sata = numOf(sc0, 10); snum = strOf(sc0, 1) || ''; }
        if (!has(fs, F.ai)) { so = so || Number(prevS[0]) || 0; sd = sd || Number(prevS[1]) || 0; sstd = sstd || Number(prevS[2]) || 0; satd = satd || Number(prevS[3]) || 0; }
        var skey = so + ':' + sd + ':' + sstd + ':' + satd;
        if (schedSent[fid] !== skey) { schedSent[fid] = skey; post('sched', { id: fid, o: so, d: sd, std: sstd, sta: ssta, atd: satd, ata: sata, num: snum }); }
      }
      // Any aircraft opened in the panel - blocked or not - is reported with its identity, so the userscript can fetch
      // public ADS-B telemetry and registry data for the fields FR24 keeps behind a padlock.
      if (F.follow && fid && !rec && !aiSent[fid]) {
        var aiF = find(fs, F.ai);
        if (aiF && aiF.wt === 2) {
          var a0 = parse(aiF.val), hx0 = numOf(a0, 1);
          if (hx0 > 0) {
            aiSent[fid] = true;
            var adOnly = a0.some(function (x) { return x.fn === 11 && adImg(parse(x.val)); });
            var realN = a0.filter(function (x) { return x.fn === 11 && realImg(parse(x.val)); }).length;
            post('aircraftInfo', { id: fid, hex: ('000000' + hx0.toString(16)).slice(-6), reg: strOf(a0, 2), type: strOf(a0, 4), cs: fi0 ? strOf(fi0, 10) : '', adPhotos: adOnly });
            if (adOnly || realN < 3) photosFor({ hex: ('000000' + hx0.toString(16)).slice(-6), reg: strOf(a0, 2) }, true);
          }
        }
      }
      var aiX = find(fs, F.ai), aiXf = !rec && aiX && aiX.wt === 2 ? parse(aiX.val) : null;
      var adAI = !!aiXf && (aiXf.some(function (x) { return x.fn === 11 && adImg(parse(x.val)); }) || (F.follow && aiXf.filter(function (x) { return x.fn === 11 && realImg(parse(x.val)); }).length < 3));
      // (an ordinary aircraft whose registered name, serial number, age or country the userscript already holds: in FR24's
      // own aircraft block from the first frame - no "Private owner" or padlock drawn first and replaced a moment later)
      var pubI = aiXf ? pubIds.get(('000000' + numOf(aiXf, 1).toString(16)).slice(-6).toUpperCase()) : null;
      if (pubI) { var o15x = strOf(aiXf, 15); if (!((pubI.c && !has(aiXf, 3)) || (pubI.m && !has(aiXf, 7)) || (pubI.a > 0 && !has(aiXf, 10)) || (pubI.o && (!o15x || /^private owner$/i.test(o15x))))) pubI = null; }
      if (!rec && !route && !tl && !adAI && !pubI) return body;
      var label = rec ? csOf(rec) : '', changed = false, parts = [], i, j;
      var hasSchedule = has(fs, F.sched), hasProgress = has(fs, F.prog), hasAircraft = has(fs, F.ai);
      var schedAdds = function (si) {
        // ScheduleInfo: 1 flight_number, 2 operated_by_id, 3 painted_as_id, 4 origin_id, 5 destination_id, 7 std, 8 sta, 9 atd, 10 ata
        var add = [];
        if (label && !has(si, 1)) add.push(fStr(1, label));
        if (rec && rec.operatorId) { if (!has(si, 2)) add.push(fVar(2, rec.operatorId)); if (!has(si, 3)) add.push(fVar(3, rec.operatorId)); }
        if (route) {
          if (route.originId && !has(si, 4)) add.push(fVar(4, route.originId));
          if (route.destId && !has(si, 5)) add.push(fVar(5, route.destId));
          if (route.std > 0 && !has(si, 7)) add.push(fVar(7, route.std));
          if (route.sta > 0 && !has(si, 8)) add.push(fVar(8, route.sta));
          if (route.atd > 0 && !has(si, 9)) add.push(fVar(9, route.atd));
          if (route.ata > 0 && !has(si, 10)) add.push(fVar(10, route.ata));
        }
        return add;
      };
      var progAdds = function (pg) {
        var pr0 = route && route.progress; if (!pr0) return [];
        var pmap = [[1, pr0.traversed], [2, pr0.remaining], [3, pr0.elapsed], [4, pr0.remainingTime], [5, pr0.eta], [6, pr0.greatCircle], [8, pr0.stage], [10, pr0.pct]], add = [];
        for (var k = 0; k < pmap.length; k++) if (pmap[k][1] > 0 && !has(pg, pmap[k][0])) add.push(fVar(pmap[k][0], pmap[k][1]));
        return add;
      };
      for (i = 0; i < fs.length; i++) {
        var f = fs[i];
        if (f.wt !== 2) { parts.push(f.raw); continue; }
        if (f.fn === F.sched) {
          var si = parse(f.val), sadd = schedAdds(si);
          if (sadd.length) { parts.push(fLen(F.sched, concat([f.val].concat(sadd)))); changed = true; } else parts.push(f.raw);
          continue;
        }
        if (f.fn === F.prog) {
          var pg = parse(f.val), padd = progAdds(pg);
          if (padd.length) { parts.push(fLen(F.prog, concat([f.val].concat(padd)))); changed = true; } else parts.push(f.raw);
          continue;
        }
        if (f.fn === F.efi && (rec || tl)) {
          var fi = parse(f.val), keep = [];
          var sq = tl && tl.sq > 0 ? tl.sq : (rec ? rec.squawk : 0);
          var addCs = label && !has(fi, 10), addSq = sq > 0 && !has(fi, 15);
          var addVs = tl && fin(tl.vr) && !has(fi, 17);
          var ems = tl && !has(fi, 13) ? emsBytes(tl) : null;
          var addAir = tl && tl.air && !has(fi, 19) ? tl.air : '';
          if (!addCs && !addSq && !addVs && !ems && !addAir) { parts.push(f.raw); continue; }
          for (j = 0; j < fi.length; j++) {
            var y = fi[j];
            if (addCs && y.fn === 10) continue;
            if (addSq && (y.fn === 14 || y.fn === 15)) continue;
            if (addVs && (y.fn === 16 || y.fn === 17)) continue;
            if (ems && (y.fn === 12 || y.fn === 13)) continue;
            if (addAir && (y.fn === 18 || y.fn === 19 || y.fn === 20)) continue;
            keep.push(y.raw);
          }
          if (addCs) keep.push(fStr(10, label));
          if (addSq) keep.push(fVar(15, squawkWire(sq)));                       // (no 14: squawkAvailability set is FR24's padlock)
          if (addVs) keep.push(fInt(17, Math.round(tl.vr)));       // no 16: vspeedAvailability=false -> rendered as text
          if (ems) keep.push(fLen(13, ems));                        // no 12: emsAvailability empty -> rendered as text
          if (addAir) { keep.push(fStr(19, addAir)); if (tl.airId) keep.push(fStr(20, tl.airId)); }   // no 18: airspace as text, code in its badge
          parts.push(fLen(F.efi, concat(keep))); changed = true; continue;
        }
        if (f.fn === F.ai && !rec && (adAI || pubI)) {
          // an ordinary aircraft: its airport-data pictures out, and its slideshow filled to three with JetPhotos /
          // Planespotters ones FR24 does not show (asked for when it was opened; the frame after they come goes again);
          // and what the userscript already knows of it - its registered owner / operator over "Private owner", the
          // serial number, age and country FR24 padlocks (no padlock flag left on what is given)
          var aiP = parse(f.val), kP = [], hexP = ('000000' + numOf(aiP, 1).toString(16)).slice(-6).toUpperCase(), seenK = {}, realP = 0;
          var o15p = strOf(aiP, 15), gC = !!pubI && pubI.c > 0 && !has(aiP, 3), gM = !!pubI && !!pubI.m && !has(aiP, 7), gA = !!pubI && pubI.a > 0 && !has(aiP, 10), gO = !!pubI && !!pubI.o && (!o15p || /^private owner$/i.test(o15p));
          for (j = 0; j < aiP.length; j++) {
            var xP = aiP[j];
            if (xP.fn === 11) { var imP = parse(xP.val); if (adAI && adImg(imP)) continue; if (realImg(imP)) { realP++; seenK[imgKeyA(imP)] = true; } }
            if ((gC && (xP.fn === 3 || xP.fn === 16)) || (gM && (xP.fn === 7 || xP.fn === 13)) || (gA && (xP.fn === 10 || xP.fn === 14)) || (gO && xP.fn === 15)) continue;
            kP.push(xP.raw);
          }
          if (gC) kP.push(fVar(3, pubI.c)); if (gM) kP.push(fStr(7, pubI.m)); if (gA) kP.push(fVar(10, pubI.a)); if (gO) kP.push(fStr(15, pubI.o));
          if (gC || gM || gA || gO) stats.pubIds = (stats.pubIds || 0) + 1;
          if (adAI) {
            var ourP = ourPhotosFor(hexP), extraP = ourP.filter(function (p) { return !seenK[shotKeyP(p)]; }).slice(0, Math.max(0, 3 - realP));
            kP = kP.concat(photoParts(extraP));
            if (F.follow && realP < 3) aiKeep[fid] = { val: f.val, sig: photoSig(ourP), pubHex: hexP };
          }
          parts.push(fLen(F.ai, concat(kP))); changed = true; continue;
        }
        if (f.fn === F.ai && rec) {
          // AircraftInfo. FR24 sends a "sideview" image even for blocked aircraft; only a real photo counts.
          var ai = parse(f.val), k2 = [], sideviews = [], hasRealPhoto = false, touched = false;
          var giveCountry = rec.countryId && !has(ai, 3), giveMsn = rec.msn && !has(ai, 7), giveAge = rec.age > 0 && !has(ai, 10);
          for (j = 0; j < ai.length; j++) {
            var x = ai[j];
            if ((x.fn === 1 && !x.val) || (x.fn === 2 && !x.val.length) || (x.fn === 3 && !x.val) || (x.fn === 7 && !x.val.length) || (x.fn === 13 && !x.val) || (x.fn === 14 && !x.val) || (x.fn === 16 && !x.val) || (x.fn === 10 && !x.val) || (x.fn === 15 && !x.val.length)) continue;
            if ((giveCountry && x.fn === 16) || (giveMsn && x.fn === 13) || (giveAge && x.fn === 14)) continue;   // our value: no padlock
            if (x.fn === 11) { var im = parse(x.val); if (adImg(im)) continue; if (has(im, 3) || has(im, 4) || has(im, 5)) hasRealPhoto = true; else { sideviews.push(x.raw); continue; } }
            k2.push(x.raw);
          }
          if (rec.hexNum && !has(ai, 1)) { k2.push(fVar(1, rec.hexNum)); touched = true; }
          if (rec.reg && !has(ai, 2)) { k2.push(fStr(2, rec.reg)); touched = true; }
          if (giveCountry) { k2.push(fVar(3, rec.countryId)); touched = true; }
          if (rec.desc && !has(ai, 6)) { k2.push(fStr(6, rec.desc)); touched = true; }
          if (giveMsn) { k2.push(fStr(7, rec.msn)); touched = true; }
          if (giveAge) { k2.push(fVar(10, rec.age)); touched = true; }
          // (the name shown for it: its operator, else its registered owner - a trust company holding the registration is neither)
          if ((rec.operatorName || rec.owner) && !has(ai, 15)) { k2.push(fStr(15, rec.operatorName || rec.owner)); touched = true; }
          var photos = goodPhotos(shownPhotos(rec)); if (!photos.length) photos = goodPhotos((psCache.get(String(rec.hex || '').toUpperCase()) || {}).photos);
          var realR = ai.filter(function (x) { return x.fn === 11 && realImg(parse(x.val)); }), keysR = {}; realR.forEach(function (x) { keysR[imgKeyA(parse(x.val))] = true; });
          if (F.follow && fid) aiKeep[fid] = { val: f.val, sig: photoSig(photos), real: realR.length >= 3 };
          if (hasRealPhoto && realR.length < 3) { var extraR = photos.filter(function (p) { return !keysR[shotKeyP(p)]; }).slice(0, 3 - realR.length); if (extraR.length) { k2 = k2.concat(photoParts(extraR)); touched = true; } }
          if (photos.length && !hasRealPhoto) {
            // url (1), copyright (2), thumbnail (3): FR24 then uses the thumbnail verbatim as the image and url as the
            // link (its medium/large path runs .replace("cb","") - a JetPhotos CDN quirk that would corrupt other URLs).
            for (j = 0; j < photos.length && j < 3; j++) {
              var ph = photos[j], img = ph.large || ph.medium || ph.thumb;
              if (!img) continue;
              k2.push(fLen(11, concat([fStr(1, ph.link || img), fStr(2, ph.credit || ''), fStr(3, img)])));
            }
            touched = true;
          }
          for (j = 0; j < sideviews.length; j++) k2.push(sideviews[j]);
          // FR24 sometimes has its own pictures of a blocked airframe: kept by the userscript for the log page and boards
          if (hasRealPhoto && rec.hex && !fr24ImgSent[fid]) {
            fr24ImgSent[fid] = true;
            var own = [];
            for (j = 0; j < ai.length; j++) {
              if (ai[j].fn !== 11) continue;
              var im2 = parse(ai[j].val), big = strOf(im2, 5) || strOf(im2, 4) || strOf(im2, 3);
              if (adImg(im2)) continue;
              if (big) own.push({ link: strOf(im2, 1) || big, credit: strOf(im2, 2), large: big, medium: strOf(im2, 4) || big, thumb: strOf(im2, 3) || big, source: 'Flightradar24' });
            }
            if (own.length) post('photos', { hex: rec.hex, reg: rec.reg, photos: own.slice(0, 3), err: '' });
          }
          if (touched || giveCountry || giveMsn || giveAge) { parts.push(fLen(F.ai, concat(k2))); changed = true; } else parts.push(f.raw);
          continue;
        }
        parts.push(f.raw);
      }
      if (hasAircraft || (F.follow && route)) {
        if (!hasSchedule) { var sp = schedAdds([]); if (sp.length) { parts.push(fLen(F.sched, concat(sp))); changed = true; } }
        if (!hasProgress) { var pp = progAdds([]); if (pp.length) { parts.push(fLen(F.prog, concat(pp))); changed = true; } }
      }
      if (changed) stats.patched++;
      return changed ? concat(parts) : body;
    }

    // ---- request parsing -----------------------------------------------------------------------------------
    function bodyBytes(body) {
      try {
        if (!body) return null;
        if (typeof body === 'string') { var o = []; b64DecodeInto(body.slice(0, body.length - body.length % 4), o); return Uint8Array.from(o); }
        if (body instanceof ArrayBuffer) return new Uint8Array(body);
        if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      } catch (e) { /* ignore */ }
      return null;
    }
    function followIdFromBody(body) {
      var b = bodyBytes(body); if (!b || b.length < 5) return 0;
      try { var fs = parse(b.subarray(5)); var f = find(fs, 1); if (f && f.wt === 5) return new DataView(f.val.buffer, f.val.byteOffset, 4).getUint32(0, true); } catch (e) { /* ignore */ }
      return 0;
    }

    // ---- XHR shims -----------------------------------------------------------------------------------------
    var P = XMLHttpRequest.prototype, oOpen = P.open, oSend = P.send, oSetHeader = P.setRequestHeader;
    var respDesc = Object.getOwnPropertyDescriptor(P, 'response'), textDesc = Object.getOwnPropertyDescriptor(P, 'responseText');
    function installBinary(xhr, patchBody) {
      var cache = { done: false, src: null, out: null };
      Object.defineProperty(xhr, 'response', { configurable: true, get: function () {
        var raw; try { raw = respDesc.get.call(this); } catch (e) { return undefined; }
        if (this.readyState !== 4 || !(raw instanceof ArrayBuffer)) return raw;
        if (!cache.done || cache.src !== raw) {
          cache.done = true; cache.src = raw;
          try { cache.out = patchFrames(raw, patchBody); } catch (e) { stats.errors++; stats.lastError = String(e); cache.out = raw; }
        }
        return cache.out;
      } });
    }
    function installText(xhr, patchBody, st) {
      st.xhr = xhr; st.inPos = 0; st.buf = []; st.out = ''; st.frames = 0; st.broken = false;
      function getter() {
        var raw; try { raw = textDesc.get.call(this); } catch (e) { return ''; }
        if (typeof raw !== 'string') return raw;
        if (st.broken) return st.out ? st.out : raw;
        var usable = raw.length - raw.length % 4;
        if (usable > st.inPos) { try { b64DecodeInto(raw.slice(st.inPos, usable), st.buf); st.inPos = usable; } catch (e) { stats.errors++; stats.lastError = String(e); st.broken = true; return st.out ? st.out : raw; } }
        while (st.buf.length >= 5) {
          var len = ((st.buf[1] << 24) | (st.buf[2] << 16) | (st.buf[3] << 8) | st.buf[4]) >>> 0;
          if (st.buf.length < 5 + len) break;
          var frame = Uint8Array.from(st.buf.splice(0, 5 + len)), bytes = frame;
          if (frame[0] === 0) { try { var nb = patchBody(frame.subarray(5), st); if (nb !== frame.subarray(5) && nb.length) bytes = concat([frameHeader(0, nb.length), nb]); } catch (e) { stats.errors++; stats.lastError = String(e); } }
          st.frames++;
          st.out += b64Encode(bytes);
        }
        return st.out;
      }
      Object.defineProperty(xhr, 'responseText', { configurable: true, get: getter });
      Object.defineProperty(xhr, 'response', { configurable: true, get: function () {
        if (this.responseType && this.responseType !== 'text') { try { return respDesc.get.call(this); } catch (e) { return null; } }
        return getter.call(this);
      } });
    }
    P.open = function (method, url) { try { this.__tlUrl = String(url); this.__tlHeaders = {}; } catch (e) { /* ignore */ } return oOpen.apply(this, arguments); };
    P.setRequestHeader = function (k, v) { try { if (this.__tlHeaders) this.__tlHeaders[k] = v; } catch (e) { /* ignore */ } return oSetHeader.apply(this, arguments); };
    P.send = function (body) {
      var url = this.__tlUrl || '', sendBody = body;
      try {
        if (/fr24\.feed\.api\.v1\.Feed\/LiveFeed(?:$|\?)/.test(url)) {
          if (!this.__tlOwn) {
            if (this.__tlHeaders && this.__tlHeaders['fr24-device-id'] && !feedHeaders) { feedHeaders = Object.assign({}, this.__tlHeaders); post('feedReady', { hdr: feedHdrPublic() }); }
            if (this.responseType === 'arraybuffer') {
              installBinary(this, function (b) { return patchLiveFeed(b, false); });
              try { sendBody = patchLiveFeedRequest(body); } catch (e) { sendBody = body; }
              if (sendBody !== body) {
                var x = this;
                x.addEventListener('load', function () { try { var gs = x.getResponseHeader('grpc-status'); if (gs && gs !== '0') { stats.maskDisabled = true; stats.lastError = 'field mask refused: ' + (x.getResponseHeader('grpc-message') || gs); } } catch (e) { /* ignore */ } });
              }
            } else installText(this, function (b) { return patchLiveFeed(b, false); }, {});
          }
        } else if (!this.__tlOwn && /fr24\.feed\.api\.v1\.Feed\/Playback(?:$|\?)/.test(url)) {
          // FR24's map playback: its feed of a moment (the same flights as the live feed, wrapped)
          var pts0 = tsOf(body) || Math.floor(Date.now() / 1000);
          if (!stats.pbMaskOff) {
            try { sendBody = patchPlaybackRequest(body); } catch (e) { sendBody = body; }
            if (sendBody !== body) { var xp = this; xp.addEventListener('load', function () { try { var gs1 = xp.getResponseHeader('grpc-status'); if (gs1 && gs1 !== '0') { stats.pbMaskOff = true; stats.lastError = 'playback field mask refused'; } } catch (e) { /* ignore */ } }); }
          }
          if (this.responseType === 'arraybuffer') installBinary(this, function (b) { return patchPlayback(b, pts0); });
          else installText(this, function (b) { return patchPlayback(b, pts0); }, {});
        } else if (!this.__tlOwn && /fr24\.feed\.api\.v1\.Feed\/PlaybackFlight(?:$|\?)/.test(url)) {
          // ... and the panel of the flight opened in it, at that moment
          var pst = { id: followIdFromBody(body), ts: tsOf(body), pb: true };
          if (pst.id) post('pbFollow', { id: pst.id, ts: pst.ts });
          if (this.responseType === 'arraybuffer') installBinary(this, function (b) { return patchFlightMsg(b, pst, PLAYBACK); });
          else installText(this, function (b) { return patchFlightMsg(b, pst, PLAYBACK); }, pst);
          if (pst.id && !pbReady(pst.id)) { var xpb = this, bpb = sendBody; whenPbReady(pst.id, 1500).then(function () { try { oSend.call(xpb, bpb); } catch (e) { /* aborted meanwhile */ } }); return; }
        } else if (!this.__tlOwn && /fr24\.feed\.api\.v1\.Feed\/(?:FollowFlight|FlightDetails)(?:$|\?)/.test(url)) {
          // FollowFlight feeds the aircraft panel; FlightDetails the expanded card of a live search result
          var isFollow = /FollowFlight/.test(url), FM = isFollow ? FOLLOW : DETAILS, st = { id: followIdFromBody(body) };
          if (isFollow) { stats.follow++; curFollowId = st.id; post('follow', { id: st.id }); } else stats.flightDetails++;
          if (this.responseType === 'arraybuffer') installBinary(this, function (b) { return patchFlightMsg(b, st, FM); });
          else { installText(this, function (b, s) { return patchFlightMsg(b, s, FM); }, st); if (isFollow) followSt = st; }
          var pr = resolved.get(st.id);
          if (pr && pr.hex && !((photoCache.get(String(pr.hex).toUpperCase()) || {}).final)) {
            // The search card is drawn once, from this one answer: it is asked for when the pictures are in (JetPhotos,
            // else Planespotters; at most 2.8 s later), so the card opens complete. (The panel is not held up - its
            // pictures are filled in as they arrive.)
            if (!isFollow && !hasPhotos(pr)) {
              var xhr = this, sb = sendBody;
              photosWithin(pr, 2800).then(function () { try { oSend.call(xhr, sb); } catch (e) { /* aborted meanwhile */ } });
              return;
            }
            photosFor(pr, true);
          }
        }
      } catch (e) { stats.errors++; stats.lastError = String(e); }
      return oSend.call(this, sendBody);
    };

    // (the headers of FR24's feed requests the monitor may use for its own scans of FR24: its device id, platform and
    // grpc-web markers - never an authorization, cookie or anything else)
    function feedHdrPublic() { var o = {}; if (!feedHeaders) return o; for (var k in feedHeaders) if (Object.prototype.hasOwnProperty.call(feedHeaders, k) && /^(fr24-[a-z0-9-]+|x-grpc-web|x-user-agent|content-type)$/i.test(k)) o[k] = String(feedHeaders[k]); return o; }
    // ---- background LiveFeed queries (world scan), same headers as FR24's own requests -------------------------
    function liveFeedQuery(q) {
      return new Promise(function (resolve, reject) {
        if (!feedHeaders) return reject(new Error('no feed headers yet'));
        var bounds = concat([fF32(1, q.n), fF32(2, q.s), fF32(3, q.w), fF32(4, q.e)]);
        var settings = concat([fLen(1, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), fLen(2, Uint8Array.from(q.services || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])), fVar(3, q.traffic || 3)]);
        var body = concat([fLen(1, bounds), fLen(2, settings), fVar(6, 1), fVar(7, q.limit || 1500), fVar(8, q.maxage || 14400), fVar(9, 0), fLen(10, concat([fStr(1, 'type'), fStr(1, 'reg')]))]);
        var frame = concat([frameHeader(0, body.length), body]);
        var x = new XMLHttpRequest(); x.__tlOwn = true;
        x.open('POST', 'https://data-feed.flightradar24.com/fr24.feed.api.v1.Feed/LiveFeed');
        for (var k in feedHeaders) if (Object.prototype.hasOwnProperty.call(feedHeaders, k)) { try { x.setRequestHeader(k, feedHeaders[k]); } catch (e) { /* ignore */ } }
        x.responseType = 'arraybuffer'; x.timeout = 15000;
        x.onload = function () {
          try {
            if (x.status !== 200) return reject(new Error('HTTP ' + x.status));
            var gs = x.getResponseHeader('grpc-status'); if (gs && gs !== '0') return reject(new Error('grpc ' + gs + ' ' + (x.getResponseHeader('grpc-message') || '')));
            var b = new Uint8Array(x.response), p = 0, n = 0, total = 0;
            while (p + 5 <= b.length) {
              var flag = b[p], len = ((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]) >>> 0;
              if (p + 5 + len > b.length) break;
              if (flag === 0) { patchLiveFeed(b.subarray(p + 5, p + 5 + len), true); n++; total += lastFeedTotal; }
              p += 5 + len;
            }
            stats.scans++;
            resolve({ frames: n, total: total });
          } catch (e) { reject(e); }
        };
        x.onerror = function () { reject(new Error('network error')); };
        x.ontimeout = function () { reject(new Error('timeout')); };
        x.send(frame.buffer);
      });
    }
    // ---- background FollowFlight: the trail of a flight nobody opened (its first frame only) --------------------
    // FR24 gives no playback of a blocked flight, but its follow stream gives the whole trail since take-off (a G500 at
    // FL450 mid-Atlantic, 9 Oct: 532 fixes back to the runway at Baltimore). Asked for by the userscript for an unnamed
    // flight out of public coverage; read up to the first frame, then closed - one every 20 s at most.
    var bgFollowAt = 0;
    function bgFollowTrail(id) {
      if (!feedHeaders || !id || Date.now() - bgFollowAt < 20000) return;
      bgFollowAt = Date.now();
      var b = new Uint8Array([0x0d, id & 255, (id >>> 8) & 255, (id >>> 16) & 255, (id >>> 24) & 255]), x = new XMLHttpRequest(), done = false;
      x.__tlOwn = true;
      x.open('POST', 'https://data-feed.flightradar24.com/fr24.feed.api.v1.Feed/FollowFlight');
      for (var k in feedHeaders) if (Object.prototype.hasOwnProperty.call(feedHeaders, k)) { try { x.setRequestHeader(k, feedHeaders[k]); } catch (e) { /* ignore */ } }
      x.overrideMimeType('text/plain; charset=x-user-defined');
      var bytes = function () { var s = x.responseText || '', u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
      var finish = function () {
        if (done) return; done = true;
        try {
          var u = bytes(); try { x.abort(); } catch (e) { /* closed */ }
          if (u.length < 5 || u[0] !== 0) return;
          var len = ((u[1] << 24) | (u[2] << 16) | (u[3] << 8) | u[4]) >>> 0; if (u.length < 5 + len) return;
          var fs = parse(u.subarray(5, 5 + len)), pts = [], maxAlt = 0;
          for (var i = 0; i < fs.length; i++) {
            if (fs[i].fn !== 6 || fs[i].wt !== 2) continue;
            var tp = parse(fs[i].val), talt = numOf(tp, 4); if (talt > 2147483647) talt = 0; if (talt > maxAlt) maxAlt = talt;
            pts.push({ t: numOf(tp, 1), lat: fltOf(tp, 2), lon: fltOf(tp, 3), alt: talt, gs: numOf(tp, 5), trk: numOf(tp, 6) });
          }
          if (pts.length) { pts.sort(function (p, q) { return p.t - q.t; }); post('trail', { id: id, first: pts[0], n: pts.length, maxAlt: maxAlt, pts: pts, at: Date.now(), bg: true }); }
        } catch (e) { stats.errors++; stats.lastError = String(e); }
      };
      x.onprogress = function () { var s = x.responseText || ''; if (s.length >= 5) { var len = (((s.charCodeAt(1) & 255) << 24) | ((s.charCodeAt(2) & 255) << 16) | ((s.charCodeAt(3) & 255) << 8) | (s.charCodeAt(4) & 255)) >>> 0; if (s.length >= 5 + len) finish(); } };
      x.onload = finish; x.onerror = function () { done = true; };
      setTimeout(finish, 12000);
      x.send(concat([frameHeader(0, b.length), b]).buffer);
    }
    // FR24 answers at most 1500 flights per request (more is refused: "Flights limit exceeded"), and a busy region -
    // Europe in the morning, the US by day - holds more than that: the answer is then silently cut short. A full answer
    // therefore splits its box in four and each quarter is asked for (twice at most), so no aircraft is left out when
    // it is busy and nothing extra is asked when it is quiet.
    var scanQueue = Promise.resolve();
    function quarters(r) {
      var mLat = (r.n + r.s) / 2, mLon = (r.w + r.e) / 2;
      return [{ n: r.n, s: mLat, w: r.w, e: mLon }, { n: r.n, s: mLat, w: mLon, e: r.e }, { n: mLat, s: r.s, w: r.w, e: mLon }, { n: mLat, s: r.s, w: mLon, e: r.e }];
    }
    function runScan(regions, opts) {
      opts = opts || {};
      var results = [], limit = opts.limit || 1500, work = regions.map(function (r) { return { r: r, depth: 0 }; });
      function next() {
        var it = work.shift();
        if (!it) { post('scanDone', { results: results }); return null; }
        return liveFeedQuery(Object.assign({}, opts, it.r)).then(function (res) {
          results.push({ ok: true, n: res.frames, total: res.total, depth: it.depth });
          if (res.total >= limit - 10 && it.depth < 2) quarters(it.r).forEach(function (q) { work.push({ r: q, depth: it.depth + 1 }); });
        }, function (e) {
          var msg = String(e.message || e); results.push({ ok: false, err: msg }); stats.lastError = 'scan: ' + msg;
          if (/429|grpc (8|14)\b/.test(msg)) work.length = 0;   // FR24 is pushing back: the rest waits for the next scan
        }).then(function () { return new Promise(function (res) { oSetTimeout(res, opts.gapMs || 400); }); }).then(next);
      }
      scanQueue = scanQueue.then(next, next);
    }

    // ---- photos: Planespotters answers requests that carry the embedding site's Origin, i.e. requests made from here
    // Registrations get reused (N677AA was an American Airlines 737 before it was a Cessna 172): a photo found by
    // registration only is kept when its page does not name a different manufacturer than this aircraft's.
    var MAKERS = ['airbus', 'boeing', 'embraer', 'bombardier', 'canadair', 'cessna', 'textron', 'gulfstream', 'dassault', 'pilatus', 'beech', 'raytheon', 'hawker', 'learjet', 'piper', 'cirrus', 'diamond', 'mooney', 'bell', 'robinson', 'sikorsky', 'eurocopter', 'agusta', 'leonardo', 'honda', 'daher', 'socata', 'lockheed', 'mcdonnell', 'douglas', 'atr', 'fokker', 'saab', 'mitsubishi', 'grumman', 'eclipse', 'tecnam', 'antonov'];
    var SAME = { cessna: ['textron'], textron: ['cessna', 'beech', 'hawker'], beech: ['raytheon', 'hawker', 'textron'], raytheon: ['beech', 'hawker'], hawker: ['raytheon', 'beech', 'textron'], bombardier: ['canadair', 'learjet'], canadair: ['bombardier'], learjet: ['bombardier'], eurocopter: ['airbus'], airbus: ['eurocopter'], agusta: ['leonardo'], leonardo: ['agusta'], mcdonnell: ['douglas', 'boeing'], douglas: ['mcdonnell', 'boeing'], daher: ['socata'], socata: ['daher'] };
    function makerOf(rec) {
      if (!rec) return '';
      var d = String(rec.desc || '').toLowerCase();
      for (var i = 0; i < MAKERS.length; i++) if (d.indexOf(MAKERS[i]) === 0 || d.indexOf(' ' + MAKERS[i]) >= 0) return MAKERS[i];
      var t = String(rec.type || '').toUpperCase();
      return /^C[1-9]\d{1,2}|^C25|^C5|^C6|^C7/.test(t) ? 'cessna' : /^GLF|^GA\d/.test(t) ? 'gulfstream' : /^GL|^CL|^CRJ/.test(t) ? 'bombardier' : /^E\d|^E5|^E1/.test(t) ? 'embraer'
        : /^B7\d|^B3/.test(t) ? 'boeing' : /^A3\d|^A2\d/.test(t) ? 'airbus' : /^PC/.test(t) ? 'pilatus' : /^FA|^F2TH|^F900/.test(t) ? 'dassault' : /^LJ/.test(t) ? 'learjet' : /^B0[5-7]|^B4\d/.test(t) ? 'bell' : /^P28|^PA/.test(t) ? 'piper' : /^SR2/.test(t) ? 'cirrus' : '';
    }
    function photoFits(p, maker) {
      if (!maker) return true;
      var slug = String(p.link || '').toLowerCase().split('/photo/')[1] || ''; if (!slug) return true;
      var ok = [maker].concat(SAME[maker] || []), named = false;
      for (var i = 0; i < MAKERS.length; i++) if (new RegExp('(^|[-/])' + MAKERS[i] + '([-/?]|$)').test(slug)) { if (ok.indexOf(MAKERS[i]) >= 0) return true; named = true; }
      return !named;
    }
    function psPhotos(j) {
      var out = [];
      (j && Array.isArray(j.photos) ? j.photos : []).forEach(function (p) {
        var large = (p.thumbnail_large && p.thumbnail_large.src) || (p.thumbnail && p.thumbnail.src) || '';
        if (!/^https:\/\//.test(large) || out.length >= 3) return;
        out.push({ link: p.link || large, credit: p.photographer || '', thumb: (p.thumbnail && p.thumbnail.src) || large, medium: large, large: large, source: 'Planespotters', date: '' });
      });
      return out;
    }
    // Planespotters rate-limits (403/429) when asked for many airframes at once: requests go out one at a time, spaced,
    // and pause for a while after a refusal instead of hammering it. What the user is looking at right now (the
    // selected aircraft, an expanded search or board card) goes to the front; board-row warming waits its turn.
    var psLast = 0, psBlockedUntil = 0, psQ = [], psBusy = false, psFails = 0;
    var psPri = new Set();   // aircraft being looked at: every step of their lookup (hex, then registration) goes first
    function psGet(u, hex, pri) {
      return new Promise(function (resolve) {
        var job = { u: u, hex: hex, resolve: resolve };
        if (pri || psPri.has(hex)) psQ.unshift(job); else psQ.push(job);
        psPump();
      });
    }
    function psBump(hex) {
      psPri.add(hex);
      for (var i = 1; i < psQ.length; i++) if (psQ[i].hex === hex) { psQ.unshift(psQ.splice(i, 1)[0]); return; }
    }
    function psPump() {
      if (psBusy || !psQ.length) return;
      psBusy = true;
      oSetTimeout(function () {
        var job = psQ.shift(); psBusy = false;
        if (!job) return;
        if (Date.now() < psBlockedUntil) { job.resolve({ ok: false, status: 429 }); psPump(); return; }
        psLast = Date.now();
        // A refusal - or a failure the browser reports as a CORS error: Planespotters' rate limit and its outages (Cloudflare
        // 5xx) come without CORS headers - pauses the queue, longer each time it happens again, instead of hammering it.
        var pause = function () { psFails = Math.min(psFails + 1, 5); psBlockedUntil = Date.now() + 30000 * Math.pow(2, psFails - 1); };
        oFetch.call(window, job.u, { credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' })
          .then(function (r) { if (r.status === 403 || r.status === 429 || r.status >= 500) pause(); else psFails = 0; job.resolve(r); }, function (e) { pause(); job.resolve({ ok: false, status: 0, statusText: String(e && e.message || e) }); });
        psPump();
      }, Math.max(0, psLast + 1200 - Date.now()));
    }
    // Planespotters, asked from here for the userscript (its only use: the fallback when JetPhotos has no picture).
    // Its answers are kept apart from the pictures shown - those come from the userscript, JetPhotos first.
    function fetchPhotos(hex, reg, pri) {
      hex = String(hex || '').toUpperCase();
      var c = psCache.get(hex);
      if (c && (c.photos.length || Date.now() - c.at < (/HTTP (0|4(03|29)|5\d\d)/.test(c.err) ? 90000 : 600000))) return Promise.resolve(c.photos);
      if (photoJobs.has(hex)) { if (pri) psBump(hex); return photoJobs.get(hex); }
      if (pri) psPri.add(hex);
      var urls = [hex ? 'https://api.planespotters.net/pub/photos/hex/' + hex : '', reg ? 'https://api.planespotters.net/pub/photos/reg/' + encodeURIComponent(reg) : ''].filter(Boolean);
      var err = '';
      var job = urls.reduce(function (acc, u) {
        return acc.then(function (got) {
          if (got.length) return got;
          var byReg = u.indexOf('/photos/reg/') > 0;
          return psGet(u, hex, pri).then(function (r) {
            if (!r.ok) { err = 'HTTP ' + r.status; return []; }
            return r.json().then(function (j) {
              var ph = psPhotos(j); if (!byReg) return ph;
              var own = null; resolved.forEach(function (x) { if (!own && String(x.hex || '').toUpperCase() === hex) own = x; });
              var maker = makerOf(own), kept = ph.filter(function (p) { return photoFits(p, maker); });
              if (kept.length < ph.length) err = 'registration photos show another aircraft type';
              return kept;
            });
          }, function (e) { err = String(e.message || e); return []; });
        });
      }, Promise.resolve([])).then(function (photos) {
        psCache.set(hex, { photos: photos, at: Date.now(), err: photos.length ? '' : (err || 'none') }); psPri.delete(hex);
        photoJobs.delete(hex);
        post('photos', { hex: hex.toLowerCase(), reg: reg || '', photos: photos, err: photos.length ? '' : (err || 'none') });
        photosChanged();
        return photos;
      });
      photoJobs.set(hex, job);
      return job;
    }
    // Pictures to show: asked of the userscript (JetPhotos first, then Planespotters); answered by 'photosDone'.
    var photoWait = new Map(), photoAsked = new Map();   // HEX -> [resolve]; HEX -> time asked
    function shownPhotos(rec) {
      if (!rec) return [];
      var c = photoCache.get(String(rec.hex || '').toUpperCase());
      if (c && c.photos && c.photos.length) return c.photos;
      return rec.photos || [];
    }
    function photosFor(rec, pri) {
      if (!rec || !rec.hex) return Promise.resolve([]);
      var hex = String(rec.hex).toUpperCase(), have = shownPhotos(rec), c = photoCache.get(hex);
      if (have.length && c && c.final) return Promise.resolve(have);
      return new Promise(function (resolve) {
        var l = photoWait.get(hex) || []; l.push(resolve); photoWait.set(hex, l);
        // a background ask is repeated as a front-of-queue one when the aircraft is now being looked at
        var asked = photoAsked.get(hex);
        if (!asked || (pri && !asked.pri) || Date.now() - asked.at > 20000) { photoAsked.set(hex, { at: Date.now(), pri: !!pri }); post('needPhotos', { hex: hex.toLowerCase(), reg: rec.reg || '', pri: !!pri }); }
      });
    }
    // a card drawn once (search card, board card): waits for the pictures a short while, then shows what there is
    function photosWithin(rec, ms) {
      return withTimeout(photosFor(rec, true), ms, null).then(function (ph) {
        if (ph && ph.length) return ph;
        var have = shownPhotos(rec); if (have.length) return have;
        return ((psCache.get(String(rec.hex || '').toUpperCase()) || {}).photos) || [];
      });
    }
    // The pictures are fetched into the browser's cache the moment they are known - the first for every identified
    // aircraft, all three for the one being looked at - so the slideshow shows them the instant the panel opens.
    var preloaded = new Set();
    function preloadPhotos(photos, all) {
      for (var i = 0; i < (photos || []).length && i < (all ? 3 : 1); i++) {
        var ph = photos[i], u = ph && (ph.large || ph.medium || ph.thumb); if (!u || preloaded.has(u)) continue;
        if (preloaded.size > 1500) preloaded.clear();
        preloaded.add(u); try { var im = new Image(); im.decoding = 'async'; im.src = u; } catch (e) { /* ignore */ }
      }
    }
    var followedHex = function () { var r = followSt && followSt.id ? resolved.get(followSt.id) : null; return r && r.hex ? String(r.hex).toUpperCase() : ''; };
    function acceptPhotosDone(d) {
      var hex = String(d.hex || '').toUpperCase(); if (!hex) return;
      var photos = Array.isArray(d.photos) ? d.photos : [];
      if (photos.length) { photoCache.set(hex, { photos: photos, at: Date.now(), err: '', final: !d.early }); preloadPhotos(photos, hex === followedHex() || !!d.pri); }
      else if (!d.early) { var c = photoCache.get(hex); if (c) c.final = true; else photoCache.set(hex, { photos: [], at: Date.now(), err: 'none', final: true }); }
      if (!d.early) photoAsked.delete(hex);
      if (d.early && !photos.length) return;
      var w = photoWait.get(hex) || []; photoWait.delete(hex);
      w.forEach(function (fn) { try { fn(photos); } catch (e) { /* ignore */ } });
      photosChanged();
    }
    var hasPhotos = function (rec) { return shownPhotos(rec).length > 0; };
    // warm: ask now, so the card has its pictures when opened (nothing waits on the answer)
    function warmPhotos(rec, pri) { if (rec && rec.hex && !((photoCache.get(String(rec.hex).toUpperCase()) || {}).final)) photosFor(rec, pri); }
    var boardImage = function (ph) { var img = ph.large || ph.medium || ph.thumb; return { copyright: ph.credit || ph.source || '', link: ph.link || img, thumbnail: ph.thumb || img, url: img }; };
    function withTimeout(p, ms, dflt) { return Promise.race([p, new Promise(function (res) { setTimeout(function () { res(dflt); }, ms); })]); }

    // ---- fetch shim: search box, airport boards (list + detail card), "Recent <reg> flights" ---------------------------
    function urlOf(input) { try { return typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) { return ''; } }
    function jsonResponse(res, obj) {
      var headers = new Headers(res ? res.headers : { 'content-type': 'application/json' }); headers.delete('content-length'); headers.delete('content-encoding');
      if (!headers.get('content-type')) headers.set('content-type', 'application/json');
      return new Response(JSON.stringify(obj), { status: res && res.ok ? res.status : 200, statusText: res && res.ok ? res.statusText : 'OK', headers: headers });
    }
    // Live search results: one row per aircraft - the flight it is flying now. FR24 gives every leg its own flight id,
    // and the ids of earlier legs stay known (for boards and logs), so an aircraft that flew AGS-TEB and then TEB-MXP
    // must not be listed twice: only the id seen most recently counts, and only if it was seen in the last half hour.
    // (in FR24's playback: the flights of the moment being played - where its feed last placed them, a couple of minutes)
    function liveEntries(q) {
      var out = [], now = Date.now(), qq = q.replace(/[-\s]/g, ''), best = {}, pb = pbOn();
      resolved.forEach(function (rec, id) {
        var pos = (pb ? pbPos : lastPos).get(id);
        if (!pos || !pos.at || now - pos.at > (pb ? 120000 : 30 * 60000)) return;
        var keys = [rec.cs, rec.reg, rec.hex].filter(Boolean).map(function (s) { return String(s).toUpperCase(); });
        if (!keys.some(function (k) { return k.indexOf(q) === 0 || k.replace(/[-\s]/g, '').indexOf(qq) === 0; })) return;
        var ak = String(rec.hex || rec.reg || id).toUpperCase(), cur = best[ak];
        if (!cur || pos.at > cur.pos.at || (pos.at === cur.pos.at && id > cur.id)) best[ak] = { id: id, rec: rec, pos: pos };
      });
      Object.keys(best).forEach(function (ak) {
        var id = best[ak].id, rec = best[ak].rec, pos = best[ak].pos;
        var route = (pb ? pbRoutes.get(id) : routes.get(id)) || {};
        var from = route.originIata || '', to = route.destIata || '';
        var routeText = from || to ? ((route.originCity || from || '?') + (from ? ' (' + from + ')' : '') + ' ⟶ ' + (route.destCity || to || '?') + (to ? ' (' + to + ')' : '')) : '';
        var label = csOf(rec);
        out.push({ id: id.toString(16), label: label + (rec.reg && csOf(rec) !== String(rec.reg).replace(/[^A-Za-z0-9]/g, '').toUpperCase() ? ' / ' + rec.reg : '') + ' / ' + (rec.type || '') + ' (' + (rec.reg || rec.hex) + ')',
          detail: { lat: pos.lat, lon: pos.lon, schd_from: from, schd_to: to, ac_type: rec.type || '', route: routeText, logo: logoOf(rec.operatorId), reg: rec.reg || '', callsign: label, flight: label, operator: rec.operatorIcao || '', operator_id: rec.operatorId || 0 },
          type: 'live', match: 'begins' });
      });
      return out.slice(0, 20);
    }
    // (the userscript's search answer - the blocked aircraft and callsigns it keeps logs of - asked for as FR24 asks its own;
    // a moment at most, then without it)
    var searchWait = {}, searchSeq = 0;
    function askSearch(q) { var rid = 's' + (++searchSeq); return new Promise(function (res) { searchWait[rid] = res; oSetTimeout(function () { if (searchWait[rid]) { delete searchWait[rid]; res([]); } }, 700); post('needSearch', { q: q, rid: rid }); }); }
    function onSearchAdd(d) { var f = searchWait[d.rid]; if (f) { delete searchWait[d.rid]; f(Array.isArray(d.rows) ? d.rows : []); } }
    // (a logo FR24 has none of - BAE Systems' - on any row of its search: airline, aircraft, flight)
    function logoFix(r) { var id = r && r.detail && r.detail.operator_id; if (!id || !LOGO_ADD[id] || r.detail.logo === LOGO_ADD[id].source) return false; r.detail.logo = LOGO_ADD[id].source; return true; }
    function recByReg(reg) { reg = String(reg || '').toUpperCase(); var hit = null; resolved.forEach(function (rec) { if (!hit && rec.reg && rec.reg.toUpperCase() === reg) hit = rec; }); return hit; }
    function enrichAircraftRow(r) {
      if (!r || r.type !== 'aircraft' || !r.id) return false;
      var hit = recByReg(r.id); if (!hit) return false;
      var d = r.detail = r.detail || {}, changed = false;
      if (!d.equip && hit.type) { d.equip = hit.type; changed = true; }
      if (!d.hex && hit.hex) { d.hex = hit.hex.toUpperCase(); changed = true; }
      if (!d.operator_id && hit.operatorId) { d.operator_id = hit.operatorId; d.logo = logoOf(hit.operatorId); changed = true; }
      if (!d.owner && (hit.operatorIcao || hit.operatorName)) { d.owner = hit.operatorIcao || hit.operatorName; changed = true; }
      return changed;
    }
    // FR24's aircraft category ids, as its own code lists them (8 Oct): 0 passenger, 1 cargo, 2 military and government,
    // 3 business jet, 4 general aviation, 5 helicopter, 6 lighter than air, 7 glider, 8 drone, 9 ground vehicle. (The
    // helicopters were 8 here - M-SKTO's H160 a "Drone" - and military 9, "ground vehicles".) By type, else by the
    // transponder's emitter category. (The userscript's own reading of the type, where it gave one: an airliner is a
    // passenger aircraft - HZ-AR27's 787-10 was a "Business jet")
    function categoryOf(rec) {
      if (typeof rec.fcat === 'number') return rec.fcat;
      var c = String(rec.cat || ''), t = String(rec.type || '').toUpperCase();
      if (c === 'A7' || /^(H\d|EC\d|AS[3-6]|A1[0-6]9|AW\d|S\d{2}|B0[5-7]|B4\d\d|R[246][246]|NH90|EH10|MD[59]|BK17|EXPL)/.test(t)) return 5;
      if (rec.mil) return 2;
      if (c === 'B1' || /^(GLID|ASK|ASW|ASG|ASH|DG\d|LS\d|DISC|DUO|JANU|NIMB|VENT|ARCP)/.test(t)) return 7;
      if (c === 'B2' || /^BALL/.test(t)) return 6;
      if (c === 'B6') return 8;
      if (c === 'A1' || /^(C1[5-9]\d|C2[01]\d|SR2|P28|PA\d|DA[24]|BE3|M20|AA5|DR40|TB[12])/.test(t)) return 4;
      return 3;
    }
    function boardRowFor(id, rec, route, kind, apId) {
      var label = csOf(rec);
      var dep = kind === 'departures';
      var sched = dep ? (route.std || route.atd) : (route.sta || route.eta);
      var est = dep ? (route.atd || route.etd || route.std) : (route.landed ? route.ata : (route.eta || route.sta));
      // green like any scheduled arrival when filed / on approach / landed / likely (72%+); FR24's yellow "ambiguous"
      // style for the less certain reasoned ones
      var sure = route.destConf === 'filed' || route.destConf === 'confirmed' || route.destConf === 'landed' || route.destConf === 'likely';
      var st = dep ? (route.atd ? { name: 'departed', color: 'green', isAmbiguous: false, live: !route.landed } : { name: 'estimated', color: 'green', isAmbiguous: false, live: false })
        : route.landed ? { name: 'landed', color: 'green', isAmbiguous: false, live: false }
        : { name: 'estimated', color: sure ? 'green' : 'yellow', isAmbiguous: !sure, live: true };
      return { aircraftType: rec.type || '', airline: rec.operatorName || rec.owner || (rec.mil ? 'Military' : 'Private owner'), airlineId: rec.operatorId || null, airportId: (dep ? route.destId : route.originId) || null, divertedToId: null,
        estimatedTime: est || sched || null, flight: { callsign: label, id: id.toString(16), number: null }, id: 9000000000 + id, runway: null, scheduledTime: sched || est || null, status: st, __tlAdded: true };
    }
    function boardDetailFor(id, rec, route, kind, apId, photos) {
      var label = csOf(rec), dep = kind === 'departures';
      var row = boardRowFor(id, rec, route, kind, apId);
      return { data: { aircraft: { category: categoryOf(rec), name: rec.desc || rec.type || null, registration: rec.reg || null, type: rec.type || null }, airline: rec.operatorName || rec.owner || (rec.mil ? 'Military' : 'Private owner'), airlineId: rec.operatorId || null,
        destinationId: route.destId || (dep ? null : apId), divertedToId: null, flight: { callsign: label, id: id.toString(16), number: null }, id: 9000000000 + id,
        images: (photos || []).slice(0, 3).map(boardImage), locationInfo: { belt: null, gate: null, terminal: null }, originId: route.originId || (dep ? apId : null),
        runways: { arrival: { name: null, upsell: false }, departure: { name: null, upsell: false } },
        // scheduled times only from a filed plan (route.std/sta); nothing is invented for a private flight
        schedule: { ata: route.ata || null, atd: route.atd || null, eta: route.landed ? (route.ata || null) : (route.eta || route.sta || null), etd: route.etd || route.atd || route.std || null, sta: route.sta || null, std: route.std || null },
        // FR24's info box (status.isAmbiguous) on every card whose destination is the userscript's rather than filed: it
        // becomes the yellow "predicted destination" note, or the green "confirmed destination" one (on final approach)
        status: Object.assign({}, row.status, { isAmbiguous: !!route.destId && !route.landed && route.destConf !== 'filed' && route.destConf !== 'landed' }) }, __tlAdded: true };
    }
    // ---- airport boards: identified traffic appears the moment its route is reasoned -----------------------------
    // FR24 re-reads an open board every 5 minutes (a setTimeout it arms right after each board response). That timer
    // is recognised, and fired early - rate-limited - whenever a newly reasoned flight joins or leaves the board on
    // screen or lands there, so the row shows up within seconds instead of minutes. It is FR24's own reload, nothing more.
    var curBoard = null, boardServedAt = 0, boardTimers = [], lastBoardRefresh = 0, boardRefreshPending = 0;
    function boardMatch(route, apId, kind) {
      if (!route) return false;
      return kind === 'on-grounds' ? route.groundAirportId === apId : kind === 'departures' ? route.originId === apId : route.destId === apId;
    }
    function kmBetween(a1, o1, a2, o2) { var r = Math.PI / 180, x = (o2 - o1) * r * Math.cos((a1 + a2) / 2 * r), y = (a2 - a1) * r; return Math.sqrt(x * x + y * y) * 6371; }
    // A flight gone quiet for three minutes, last heard low beside where it was going, is down there: its board row is a
    // landed one at once, as FR24's own turns - not an "estimated" one burned on for half an hour after (HLL01 into
    // Liverpool, listed both landed and still estimated 40 minutes after)
    function routeNow(id) {
      var route = routeOf(id); if (!route || route.landed || route.destLat == null) return route;
      var lp = lastPos.get(id); if (!lp || Date.now() - lp.at < 180000 || lp.alt == null || lp.alt - (route.destAlt || 0) > 2500) return route;
      var km = kmBetween(lp.lat, lp.lon, route.destLat, route.destLon); if (km > 12) return route;
      return Object.assign({}, route, { landed: true, ata: Math.round(lp.at / 1000 + Math.max(60, km / 4 * 60)), destConf: 'landed' });
    }
    // Whether (and how) an identified flight belongs on a board: '' not listed, 'E' en route / expected, 'L' landed.
    // One rule for both listing it and deciding that the open board needs a reload.
    function boardSig(id, apId, kind) {
      var rec = recOf(id), route = routeNow(id);
      if (!rec || !route || !(csOf(rec)) || !boardMatch(route, apId, kind)) return '';
      if (kind !== 'on-grounds' && ((route.landed && route.originId === route.destId && !((route.ata || 0) - (route.atd || 0) >= 600)) || (!route.landed && route.groundAirportId))) return '';   // (never flew: a transponder on to taxi)
      // (the other end of the row counts too: a departure that becomes known re-reads an arrivals board)
      var other = kind === 'arrivals' ? ':' + (route.originId || 0) : kind === 'departures' ? ':' + (route.destId || 0) : '';
      var nowS = Date.now() / 1000, lp = lastPos.get(id);
      if (kind !== 'on-grounds') {
        if (!route.landed && (!lp || Date.now() - lp.at > 30 * 60000)) return '';               // not seen for half an hour
        if (route.landed && nowS - (route.ata || 0) > 3 * 3600) return '';                       // landed hours ago
        if (kind === 'arrivals' && !route.landed && route.eta && route.eta < nowS - 45 * 60) return '';   // overdue
      }
      return (route.landed ? 'L' : 'E') + other;
    }
    function noteBoard(apId, kind) {
      // sig: what each identified flight looked like when the board was last served; native: flights FR24 lists itself
      if (!curBoard || curBoard.apId !== apId || curBoard.kind !== kind) curBoard = { apId: apId, kind: kind, sig: {}, native: {} };
      return curBoard;
    }
    var oSetTimeout = window.setTimeout, oClearTimeout = window.clearTimeout;
    window.setTimeout = function (fn, ms) {
      var h = oSetTimeout.apply(this, arguments);
      // (only FR24's 5-minute board reloads: it arms other long timers about then - the open panel's 10-minute
      // autorefresh, a clock tick - and firing one of those in their place left a newly listed flight off the board)
      try {
        if (typeof fn === 'function' && ms >= 240000 && ms <= 360000 && Date.now() - boardServedAt < 5000) {
          var src = ''; try { src = Function.prototype.toString.call(fn).slice(0, 400); } catch (e) { /* ignore */ }
          if (!/Autorefresh|updateInfoPanel|\.tick\(/.test(src)) { boardTimers = boardTimers.filter(function (b) { return b.fn !== fn; }); boardTimers.push({ fn: fn, h: h, args: [].slice.call(arguments, 2) }); if (boardTimers.length > 6) boardTimers.shift(); }
        }
      } catch (e) { /* ignore */ }
      return h;
    };
    window.clearTimeout = function (h) { if (boardTimers.length) boardTimers = boardTimers.filter(function (b) { return b.h !== h; }); return oClearTimeout.apply(this, arguments); };
    function boardAffected(ids) {
      if (!curBoard || !boardTimers.length) return false;
      for (var i = 0; i < ids.length; i++) {
        var id = Number(ids[i]); if (curBoard.native[id]) continue;
        if (boardSig(id, curBoard.apId, curBoard.kind) !== (curBoard.sig[id] || '')) return true;   // joins, leaves or lands
      }
      return false;
    }
    function refreshBoardSoon() {
      if (boardRefreshPending || !boardTimers.length) return;
      // (within a second; at most one re-read every 5 s - a destination still settling re-reads again once it has)
      var wait = Math.max(800, lastBoardRefresh + 5000 - Date.now());
      boardRefreshPending = oSetTimeout(function () {
        boardRefreshPending = 0;
        var ts = boardTimers; if (!ts.length || !document.querySelector('li[id^="airport_schedule_"], [data-testid^="airport-panel__tab-"]')) return;
        boardTimers = []; lastBoardRefresh = Date.now();
        ts.forEach(function (t) { try { oClearTimeout(t.h); t.fn.apply(window, t.args); stats.boardRefreshes++; } catch (e) { stats.errors++; stats.lastError = String(e); } });
      }, wait);
    }
    // ---- the board archive (userscript 06-boards): three days back and three ahead, in one list ------------------
    // FR24 serves a free account its page 1 (now onwards) and page -1 (earlier today), a page at a time. Its page 1 is
    // answered with both, and with every flight the userscript keeps for the airport (three days each way), in FR24's row
    // format - its own day headings and cards - and no other page: no "Earlier" / "Later flights" (none twice).
    var boardArch = new Map(), archWait = new Map(), archById = new Map(), archRefreshAt = 0, archRefreshT = 0;
    function hashStr(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
    function needBoardArch(apId) {
      var a = boardArch.get(apId);
      if (a && Date.now() - a.at < 60000) return Promise.resolve(a);
      post('needBoard', { apId: apId });
      // (the first time: a short wait for it - it is read from disk - and FR24's board goes on without it after that)
      return withTimeout(new Promise(function (res) { var l = archWait.get(apId) || []; l.push(res); archWait.set(apId, l); }), 0, a || null);
    }
    function acceptBoardArch(d) {
      var apId = Number(d.apId); if (!apId) return;
      var a = { arr: Array.isArray(d.arr) ? d.arr : [], dep: Array.isArray(d.dep) ? d.dep : [], at: Date.now() }, had = boardArch.get(apId);
      boardArch.set(apId, a);
      var w = archWait.get(apId) || []; archWait.delete(apId); w.forEach(function (fn) { try { fn(a); } catch (e) { /* ignore */ } });
      // (rows added while the board is open: FR24's own re-read shows them)
      // (and the first lot, when FR24's board was served before it came; while an airport fills up, a re-read at most
      // every 15 s - each one redraws the whole list)
      if (curBoard && curBoard.apId === apId && (!had || had.arr.length !== a.arr.length || had.dep.length !== a.dep.length)) {
        var wait = archRefreshAt + 15000 - Date.now();
        if (wait <= 0 || !had) { archRefreshAt = Date.now(); refreshBoardSoon(); }
        else if (!archRefreshT) archRefreshT = oSetTimeout(function () { archRefreshT = 0; archRefreshAt = Date.now(); refreshBoardSoon(); }, wait);
      }
    }
    function archRow(r, kind) {
      // (FR24's own row of the flight, kept as FR24 served it or converted field for field: exactly what its board shows)
      if (r.nat && r.nat.id && r.nat.scheduledTime) { archById.set(r.nat.id, { r: r, kind: kind, fid: r.nat.flight && r.nat.flight.id || ('c' + (hashStr(r.k) % 0x0fffffff).toString(16)) }); if (archById.size > 8000) archById.delete(archById.keys().next().value); return Object.assign({}, r.nat, { __tlAdded: true, __tlArch: true }); }
      // (FR24's own row id where it gave one - its board or its flight-number list: its card is FR24's then)
      var h = hashStr(r.k), id = (r.src === 'fr24' || r.src === 'sched') && r.id ? r.id : 20000000000 + (h % 1000000000);
      var fid = r.fid || ('c' + (h % 0x0fffffff).toString(16));
      archById.set(id, { r: r, kind: kind, fid: fid }); if (archById.size > 8000) archById.delete(archById.keys().next().value);
      return { id: id, flight: { id: fid, number: r.num || null, callsign: r.cs || null }, status: { name: r.st || (kind === 'arrivals' ? 'landed' : 'departed'), color: r.col || 'green', isAmbiguous: false, live: false },
        scheduledTime: r.sch || r.t, estimatedTime: r.est || r.t, airportId: r.ap || null, divertedToId: null, airlineId: r.alId || null, airline: r.al || null, aircraftType: r.ty || null, runway: null, __tlAdded: true, __tlArch: true };
    }
    // Kept rows into FR24's board answer (the whole of it is one page now). Returns rows added.
    function addArch(j, apId, kind) {
      if (kind === 'on-grounds') return 0;
      var a = boardArch.get(apId), rows = a ? (kind === 'arrivals' ? a.arr : a.dep) : null; if (!rows || !rows.length) return 0;
      var nowS = Date.now() / 1000;
      var nat = j.data.filter(function (e) { return e && !e.__tlArch; });
      // (none twice: FR24's own row of the flight - by its flight id, its flight number within 30 minutes, or its callsign
      // within 45)
      // (indexed by callsign and number: an airport's six days are thousands of rows)
      var fids = {}, cst = {}, nmt = {}, add = function (o, k, t, e) { (o[k] || (o[k] = [])).push({ t: t, e: e }); }, near = function (o, k, t, w) { return k ? (o[k] || []).find(function (x) { return Math.abs(x.t - t) < w; }) || null : null; };
      nat.forEach(function (e) { if (e.flight && e.flight.id) fids[String(e.flight.id)] = e; if (e.flight && e.flight.callsign) add(cst, String(e.flight.callsign).toUpperCase(), e.estimatedTime || e.scheduledTime || 0, e); if (e.flight && e.flight.number) add(nmt, String(e.flight.number).toUpperCase(), e.scheduledTime || 0, e); });
      var pick = rows.filter(function (r) {
        var t = r.sch || r.t; if (!(t >= nowS - 3 * 86400 && t <= nowS + 3 * 86400)) return false;
        var hit = (r.fid && fids[r.fid]) || near(nmt, String(r.num || '').toUpperCase(), r.sch || r.t, 1800) || near(cst, String(r.cs || '').toUpperCase(), r.est || r.t, 2700);
        if (!hit) return true;
        // (FR24's own row of it stands - what it leaves out, "N/A" where the flight went or came from, the aircraft of
        // its card, from the kept one: G-PTRK)
        nativeFill(hit.e || hit, r, kind);
        return false;
      });
      pick.forEach(function (r) { j.data.push(archRow(r, kind)); });
      return pick.length;
    }
    // What a native row of FR24's leaves empty - the other airport, the type, the aircraft of its card - from a flight
    // this script knows: a kept row of it, or an N/A flight it follows. Its card is filled from natInfo.
    var natInfo = new Map();
    function nativeFill(e, r, kind, route) {
      if (!e || !r) return;
      if (!e.airportId && r.ap) { e.airportId = r.ap; if (route && !route.landed && kind === 'departures' && ['filed', 'confirmed', 'landed'].indexOf(route.destConf) < 0) e.status = Object.assign({}, e.status, { isAmbiguous: true }); }
      if (!e.aircraftType && r.ty) e.aircraftType = r.ty;
      // (no airline on FR24's own row - G-RVRN's, Ravenair's: the operator the userscript names, and so its logo)
      if (!e.airlineId && r.alId) { e.airlineId = r.alId; if (!e.airline || /private owner/i.test(e.airline)) e.airline = r.al || e.airline; }
      var cur = natInfo.get(e.id) || {};
      natInfo.set(e.id, { reg: cur.reg || r.reg || '', hex: cur.hex || r.hex || '', ty: cur.ty || r.ty || '', dsc: cur.dsc || r.dsc || '', al: cur.al || r.al || '', alId: cur.alId || r.alId || 0, fc: cur.fc != null ? cur.fc : r.fc, ap: cur.ap || r.ap || 0, kind: kind });
      if (natInfo.size > 3000) natInfo.delete(natInfo.keys().next().value);
    }
    // A registration from a callsign that is one - GPTRK, DEABC, FGXYZ, N123AB - checked against FR24's own register
    // lookup (its aircraft list): its model, Mode S address and operator. One lookup per registration.
    var regInfoCache = new Map();
    function regInfo(reg) {
      reg = String(reg || '').toUpperCase(); if (!reg) return Promise.resolve(null);
      if (regInfoCache.has(reg)) return regInfoCache.get(reg);
      var p = oFetch.call(window, 'https://api.flightradar24.com/common/v1/flight/list.json?query=' + encodeURIComponent(reg) + '&fetchBy=reg&page=1&limit=1', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var resp = j && j.result && j.result.response, ai = resp && resp.aircraftInfo; if (!ai || String(ai.registration || '').toUpperCase() !== reg) return null;
        return { reg: reg, hex: String(ai.hex || '').toLowerCase(), ty: (ai.model && ai.model.code) || '', dsc: (ai.model && ai.model.text) || '', al: (ai.airline && ai.airline.name) || (ai.owner && ai.owner.name) || '', blocked: resp.data === null };
      }).catch(function () { return null; });
      regInfoCache.set(reg, p); if (regInfoCache.size > 300) regInfoCache.delete(regInfoCache.keys().next().value);
      return p;
    }
    function regsOfCallsign(cs) {
      cs = String(cs || '').toUpperCase(); if (!/^[A-Z0-9]{4,7}$/.test(cs) || /^[A-Z]{3}\d/.test(cs) && !/^N/.test(cs)) return [];
      if (/^N\d[0-9A-Z]{0,4}$/.test(cs)) return [cs];
      var out = [];
      for (var n = 1; n <= 2; n++) { var p = cs.slice(0, n), rest = cs.slice(n); if (rest.length >= 3 && /^[A-Z0-9]+$/.test(p)) out.push(p + '-' + rest); }
      return out;
    }
    function infoOfCallsign(cs) {
      var c = regsOfCallsign(cs);
      return c.reduce(function (pr, reg) { return pr.then(function (hit) { return hit || regInfo(reg); }); }, Promise.resolve(null));
    }
    // (the registered owner / operator the userscript keeps of an aircraft - asked for, and waited on a moment, when it has
    // none yet: M-SKTO "Private owner" on FR24's own card)
    function ownerOf(hex, reg, ms) {
      var H = String(hex || '').toUpperCase(), have = function () { var p = pubIds.get(H); return p && p.o ? p.o : ''; };
      if (!/^[0-9A-F]{6}$/.test(H) || have()) return Promise.resolve(have());
      post('needPub', { hex: H.toLowerCase(), reg: reg || '' });
      return new Promise(function (res) { var t0 = Date.now(); (function look() { var o = have(); if (o || Date.now() - t0 > ms) return res(o); oSetTimeout(look, 100); })(); });
    }
    // the card of FR24's own row: its aircraft, airline, other airport and pictures where FR24 has none
    function fillNativeCard(d, rowId, kind) {
      var info = natInfo.get(rowId) || null, ac = d.aircraft = d.aircraft || {};
      var need = !ac.registration || !ac.type, priv = !d.airline || /private owner/i.test(d.airline);
      var known = String(ac.hex || ac.icao24 || ac.modeS || '').toLowerCase();
      var got = info && (info.reg || info.hex) ? Promise.resolve(info) : need ? infoOfCallsign(d.flight && d.flight.callsign) : priv && !/^[0-9a-f]{6}$/.test(known) && ac.registration ? regInfo(ac.registration) : Promise.resolve(known ? { hex: known } : null);
      return got.then(function (x) {
        if (x) {
          if (!ac.registration && x.reg) ac.registration = x.reg;
          // (FR24's category goes with the type it had - "Business jet" on an H125 with none)
          if (!ac.type && x.ty) { ac.type = x.ty; ac.category = categoryOf({ type: x.ty, fcat: x.fc }); }
          if (!ac.name && (x.dsc || x.ty)) ac.name = x.dsc || x.ty;
          if (x.ap) { if (kind === 'departures' && !d.destinationId) d.destinationId = x.ap; if (kind === 'arrivals' && !d.originId) d.originId = x.ap; }
        }
        var hex = (x && x.hex) || known, rg = ac.registration || '';
        if (Array.isArray(d.images)) d.images = d.images.filter(function (im) { return !adJson(im); });
        var needPh = !(Array.isArray(d.images) && d.images.length) && /^[0-9a-f]{6}$/.test(hex);
        // (the registered owner - waited on only where a register is read: the UK's, the Isle of Man's, Switzerland's,
        // the FAA's - and the pictures, both at once)
        return Promise.all([priv && hex ? ownerOf(hex, rg, /^(G-|M-|HB-|N\d)/i.test(rg) ? 2500 : 0) : '', needPh ? photosWithin({ hex: hex, reg: rg }, 2800) : null]).then(function (r) {
          if (r[0]) d.airline = r[0]; else if (x && x.al && priv) d.airline = x.al;
          if (r[1]) d.images = goodPhotos(r[1]).slice(0, 3).map(boardImage);
          return d;
        });
      });
    }
    // The list opens at the present, as FR24's own does (it starts three days back now): the first row from a quarter of
    // an hour ago is brought to the top - once per board opened (FR24's own re-reads leave the user's place alone)
    function scrollBoardToNow(rowId, key) {
      var tries = 0;
      (function look() {
        var el = document.querySelector('[data-testid="airport-panel__schedules__flight__' + rowId + '"]'), main = el && el.closest('main');
        if (!el || !main) { if (++tries < 40) oSetTimeout(look, 150); return; }
        var wrap = el.closest('[data-testid="list-wrapper"]') || main;
        if (wrap.__tlScrolled === key && Math.abs(main.scrollTop - (wrap.__tlTop || 0)) > 4) return;      // (moved by the user)
        wrap.__tlScrolled = key;
        main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - 36;
        wrap.__tlTop = main.scrollTop;
      })();
    }
    // the card of a kept row: from what was kept (FR24 has no card for it - or no longer gives a free account one)
    function archDetail(ar, apId, kind) {
      var r = ar.r, dep = kind === 'departures', rec = { hex: r.hex || '', reg: r.reg || '', type: r.ty || '', cat: '', mil: false, fcat: r.fc };
      var own = r.src === 'fr24' || r.src === 'sched';
      return (r.hex ? photosWithin(rec, 2800) : Promise.resolve([])).then(function (ph) {
        return jsonResponse(null, { data: { aircraft: { category: categoryOf(rec), name: r.dsc || r.ty || null, registration: r.reg || null, type: r.ty || null }, airline: r.al || null, airlineId: r.alId || null,
          destinationId: dep ? (r.ap || null) : apId, divertedToId: null, flight: { callsign: r.cs || null, id: ar.fid, number: r.num || null }, id: r.src === 'fr24' && r.id ? r.id : 20000000000 + (hashStr(r.k) % 1000000000),
          images: goodPhotos(ph).slice(0, 3).map(boardImage), locationInfo: { belt: null, gate: null, terminal: null }, originId: dep ? apId : (r.ap || null),
          runways: { arrival: { name: null, upsell: false }, departure: { name: null, upsell: false } },
          // (a scheduled time only where FR24's own schedule had one: nothing is invented for a private flight)
          schedule: { ata: !dep && r.st === 'landed' ? (r.est || r.t) : null, atd: dep && r.st === 'departed' ? (r.est || r.t) : null, eta: !dep && r.st === 'estimated' ? (r.est || null) : null, etd: null, sta: !dep && own ? (r.sch || null) : null, std: dep && own ? (r.sch || null) : null },
          status: { name: r.st || (dep ? 'departed' : 'landed'), color: r.col || 'green', isAmbiguous: false, live: false } }, __tlAdded: true });
      });
    }
    // ---- FR24's own airline and airport lists (its IndexedDB keeps them, read again hourly): what they lack, added -----
    // BAE Systems' three airlines have no logo (the public-domain text logo from Wikimedia Commons is drawn for them);
    // the landing places the userscript has learned - private sites, strips - are no airports of FR24's. Added to every
    // full list FR24 receives, so its boards, cards and panel draw them as their own ("Ormskirk PVT", not "N/A"). When
    // what is added has changed since FR24 last kept its list, that copy is dropped before FR24 opens it, so it reads the
    // list anew - at most once an hour.
    var BAE_LOGO = { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/BAE_Systems_logo.svg/250px-BAE_Systems_logo.svg.png', dimensions: { width: 250, height: 39 } };
    var LOGO_ADD = { 583: BAE_LOGO, 3046: BAE_LOGO, 582: BAE_LOGO };
    var LISTS_V = '1';
    function logoOf(id) { return !id ? '' : LOGO_ADD[id] ? LOGO_ADD[id].source : 'https://cdn.flightradar24.com/assets/airlines/logotypes/' + id + '.png'; }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* full or blocked */ } }
    var siteRows = (function () { try { var l = JSON.parse(lsGet('tl.sites') || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } })();
    function listSig(kind) { return kind === 'airlines' ? LISTS_V : LISTS_V + ':' + hashStr(JSON.stringify(siteRows)); }
    function patchList(kind, j) {
      if (!j || !Array.isArray(j.rows) || j.rows.length < 100) return false;
      if (kind === 'airlines') j.rows.forEach(function (r) { var l = r && LOGO_ADD[r.id]; if (l && !(r.metadata && r.metadata.images)) r.metadata = { images: { logotypes: { default: { file: { dimensions: l.dimensions, name: r.id + '.png', size: 0, source: l.source, type: 'PNG' } } } } }; });
      else { var have = {}; j.rows.forEach(function (r) { if (r) have[r.id] = true; }); siteRows.forEach(function (r) { if (r && r.id && !have[r.id]) j.rows.push(r); }); }
      lsSet('tl.list.' + kind, listSig(kind));
      return true;
    }
    ['airlines', 'airports'].forEach(function (kind) {
      if (lsGet('tl.list.' + kind) === listSig(kind) || Date.now() - (Number(lsGet('tl.listDel.' + kind)) || 0) < 3600e3) return;
      lsSet('tl.listDel.' + kind, String(Date.now()));
      try { indexedDB.deleteDatabase(kind === 'airlines' ? 'Airlines' : 'Airports'); } catch (e) { /* none kept */ }
    });
    function acceptSites(list) { if (!Array.isArray(list)) return; siteRows = list; lsSet('tl.sites', JSON.stringify(list)); }
    // Learned landing places stay in FR24's airport list (its panel and boards look airports up there by id) but never on
    // its map: the airport layer draws the 'airports' store's array - and highlights by IATA code, which every site shares
    // ("PVT"), so one selected flight's site lit them all. Taken out of that array alone, each time FR24 fills it.
    var isSiteRow = function (a) { return !!a && a.id > 9000000 && a.id < 10000000; };
    // (one of FR24's own state stores - the map's: airports, aircraft, playback)
    function pinStore(n) { try { var el = document.getElementById('app'), pin = el && el.__vue_app__ && el.__vue_app__.config.globalProperties.$pinia; return (pin && pin._s && pin._s.get(n)) || null; } catch (e) { return null; } }
    function pbOn() { var st = pinStore('playback'); return !!(st && st.active); }
    function sitesOffMap() {
      try {
        var st = pinStore('airports');
        if (!st || typeof st.$onAction !== 'function') return false;
        var strip = function () { var a = st.airports; if (Array.isArray(a) && a.some(isSiteRow)) st.airports = a.filter(function (x) { return !isSiteRow(x); }); };
        st.$onAction(function (c) { if (c.name === 'setAirports') c.after(strip); }); strip();
        return true;
      } catch (e) { return false; }
    }
    var sitesOffN = 0, sitesOffT = setInterval(function () { if (sitesOffMap() || ++sitesOffN > 480) clearInterval(sitesOffT); }, 250);
    var LIST_RE = /\/mobile\/(?:airlines\?format=2|airports\/format\/4)\b/;
    function listFetch(self, args, url) {
      var kind = /airlines/.test(url) ? 'airlines' : 'airports', a = [].slice.call(args);
      // (a list FR24 takes to be up to date, while what is added to it is not: the whole list asked for)
      if (lsGet('tl.list.' + kind) !== listSig(kind) && /[?&]version=[1-9]/.test(url)) a[0] = url.replace(/([?&]version=)\d+/, '$10');
      return oFetch.apply(self, a).then(function (res) {
        if (!res.ok) return res;
        return res.clone().json().then(function (j) { return patchList(kind, j) ? jsonResponse(res, j) : res; }, function () { return res; });
      });
    }
    // ---- FR24's airport routes page: an Inertia page, its lists (busiest, longest, all routes, the map's) in the page's
    // own state. The routes the userscript counted for its blocked aircraft are added there - FR24's count of a route it
    // has too is raised by theirs; a route it has not is listed beside its own - and FR24 draws them itself.
    var routesAdd = new Map();
    function routeEntry(m, extra) { return Object.assign({ id: (m.from.iata || m.from.icao || m.from.id) + '-' + (m.to.iata || m.to.icao || m.to.id), origin: m.from, destination: m.to, flights: m.n }, extra || {}); }
    function mergeRoutes(arr, mine, key, keep) {
      var base = (arr || []).filter(function (r) { return r && !r.__tlOnly; }).map(function (r) { var o = Object.assign({}, r); if (o.__tlBase != null) { o.flights = o.__tlBase; delete o.__tlBase; } return o; });
      var own = base.length, byId = {}; base.forEach(function (r) { byId[r.id] = r; });
      mine.forEach(function (m) { var r = byId[m.id]; if (r) { r.__tlBase = r.flights; r.flights = (r.flights || 0) + m.flights; } else base.push(Object.assign({ __tlOnly: true }, m)); });
      if (key) base.sort(function (a, b) { return (b[key] || 0) - (a[key] || 0); });
      return keep ? base.slice(0, Math.max(own, Math.min(keep, base.length))) : base;
    }
    function applyRoutes(pg) {
      var p = pg.props, ap = p.airport, add = routesAdd.get(ap.id); if (!add || !add.length) return;
      var sig = hashStr(JSON.stringify(add)) + ':' + add.length;
      var mine = add.filter(function (m) { return p.direction === 'to' ? m.to.id === ap.id : m.from.id === ap.id; });
      var strip = function (o) { var c = Object.assign({}, o); delete c.size; return c; };
      var listed = mine.map(function (m) { return routeEntry({ from: strip(m.from), to: strip(m.to), n: m.n }, { distanceKm: m.km }); });
      if (!(p.busiestRoutes && p.busiestRoutes.__tl === sig)) { var bu = mergeRoutes(p.busiestRoutes, listed, 'flights', 6); bu.__tl = sig; p.busiestRoutes = bu; }
      if (!(p.longestRoutes && p.longestRoutes.__tl === sig)) { var lo = mergeRoutes(p.longestRoutes, listed, 'distanceKm', 6); lo.__tl = sig; p.longestRoutes = lo; }
      if (p.routes && p.routes.current_page === 1 && p.routes.__tl !== sig) {
        var all = mergeRoutes(p.routes.data, mine.map(function (m) { return routeEntry({ from: strip(m.from), to: strip(m.to), n: m.n }, { distanceKm: m.km, averageFlightTimeMinutes: m.min }); }), 'flights', 0);
        var added = all.filter(function (r) { return r.__tlOnly; }).length - (p.routes.data || []).filter(function (r) { return r && r.__tlOnly; }).length;
        p.routes = Object.assign({}, p.routes, { data: all, total: (p.routes.total || 0) + added, to: (p.routes.to || 0) + added, __tl: sig });
      }
      if (!(p.mapRoutes && p.mapRoutes.__tl === sig)) { var mp = mergeRoutes(p.mapRoutes, add.map(function (m) { return routeEntry(m); }), '', 0); mp.__tl = sig; p.mapRoutes = mp; }
    }
    // ---- FR24's other airport data pages: general, arrivals / departures, statistics. What the userscript knows of the
    // airport goes into the page's own state - the flights of its boards (kept, and those the map tab follows now), the
    // week's movements of blocked aircraft in its statistics, its runways where FR24 shows a locked sample table - and the
    // last answer for an airport is kept, so a page opened again has it from its first draw.
    var apData = new Map(), servedMem = {};
    function inertiaPage() { try { var el = document.getElementById('app'), va = el && el.__vue_app__, pg = va && va.config.globalProperties.$page; return pg && pg.props && pg.props.airport ? pg : null; } catch (e) { return null; } }
    function apDataOf(apId) { var d = apData.get(apId); if (!d) { try { d = JSON.parse(lsGet('tl.ap.' + apId) || 'null'); } catch (e) { d = null; } d = d || {}; apData.set(apId, d); if (d.routes && !routesAdd.has(apId)) routesAdd.set(apId, d.routes); } return d; }
    function keepApData(apId) { var d = apDataOf(apId), r = routesAdd.get(apId); lsSet('tl.ap.' + apId, JSON.stringify({ runways: d.runways || null, routes: r || null, at: Date.now() })); }
    // (the airports and countries FR24 itself counts as served: the ends of its own routes of the week, read once)
    function servedOf(pg) {
      var ap = pg.props.airport, code = String(ap.iata || ap.icao || '').toLowerCase(); if (servedMem[code]) return servedMem[code].ids ? servedMem[code] : null;
      servedMem[code] = {};
      oFetch.call(window, '/data/airports/' + code + '/routes', { credentials: 'same-origin', headers: { 'X-Inertia': 'true', 'X-Inertia-Version': pg.version, 'X-Inertia-Partial-Component': 'Data/AirportRoutes', 'X-Inertia-Partial-Data': 'mapRoutes', 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html, application/xhtml+xml' } })
        .then(function (r) { return r.json(); }).then(function (j) { var ids = {}, cs = {}; ((j.props && j.props.mapRoutes) || []).forEach(function (m) { [m.origin, m.destination].forEach(function (a) { if (a && a.id !== ap.id) { ids[a.id] = 1; cs[a.countryId] = 1; } }); }); servedMem[code] = { ids: ids, cs: cs }; })
        .catch(function () { servedMem[code] = { ids: {}, cs: {} }; });
      return null;
    }
    // what the week's blocked flights add: landings, take-offs, airports and countries FR24 does not count
    function weekAdds(pg) {
      var apId = pg.props.airport.id, list = routesAdd.get(apId) || [], sv = servedOf(pg), out = { land: 0, off: 0, aps: {}, cs: {}, top: {} };
      list.forEach(function (m) {
        var other = m.from.id === apId ? m.to : m.from; if (m.to.id === apId) out.land += m.n; if (m.from.id === apId) { out.off += m.n; out.top[other.id] = (out.top[other.id] || 0) + m.n; }
        if (sv && !sv.ids[other.id]) out.aps[other.id] = other; if (sv && !sv.cs[other.countryId]) out.cs[other.countryId] = 1;
      });
      out.ready = !!sv; return out;
    }
    // ---- runways: FR24's own airport answer carries every runway - name, length, surface - for free accounts too (it only
    // shows them to subscribers): kept per airport code (a month in this browser), for the map panel's "Runway details" and
    // the airport pages' runway tables - each end's elevation from the userscript's OurAirports list where it has it
    var rwyByCode = {}, rwyAsked = {};
    function rwyKey(c) { return String(c || '').toUpperCase(); }
    function noteAirportJson(j) {
      var ap = j && j.result && j.result.response && j.result.response.airport, pd = ap && ap.pluginData, c = pd && pd.details && pd.details.code;
      if (!c || !Array.isArray(pd.runways)) return;
      var list = pd.runways.map(function (r) { return { name: String(r.name || ''), ft: r.length && r.length.ft, m: r.length && r.length.m, surf: (r.surface && r.surface.name) || '', code: (r.surface && r.surface.code) || '' }; }).filter(function (r) { return r.name; });
      [c.iata, c.icao].forEach(function (k) { if (k) { rwyByCode[rwyKey(k)] = list; lsSet('tl.rw.' + rwyKey(k), JSON.stringify({ at: Date.now(), list: list })); } });
      rwyPanel();
    }
    function rwyOf(code) { var k = rwyKey(code); if (!k) return null; if (rwyByCode[k]) return rwyByCode[k]; try { var v = JSON.parse(lsGet('tl.rw.' + k) || 'null'); if (v && Array.isArray(v.list) && Date.now() - v.at < 30 * 864e5) return (rwyByCode[k] = v.list); } catch (e) { /* none kept */ } return null; }
    function rwyWant(code) {
      var k = rwyKey(code); if (!k || rwyOf(k) || rwyAsked[k]) return; rwyAsked[k] = true;
      oFetch.call(window, 'https://api.flightradar24.com/common/v1/airport.json?code=' + encodeURIComponent(k.toLowerCase()) + '&plugin[]=details&plugin[]=runways').then(function (r) { return r.json(); }).then(function (j) { noteAirportJson(j); routesTick(); }, function () { rwyAsked[k] = false; });
    }
    // the map's airport panel: FR24's "Runway details" upsell picture gives way to the table of the airport open now - every
    // runway in full where the monitor has it (OurAirports: width, lighting, each end's heading, elevation and displaced
    // threshold) and the airport's radio frequencies, else FR24's own runway list - redrawn when another is opened (the
    // picture stays in its place, hidden, for FR24's own redraws)
    var SURF_NAME = { ASPH: 'Asphalt', BITU: 'Bitumen', CONC: 'Concrete', TARM: 'Tarmac', GRAS: 'Grass', TURF: 'Turf', GRVL: 'Gravel', DIRT: 'Dirt', SAND: 'Sand', CLAY: 'Clay', WATE: 'Water', SNOW: 'Snow', ICE: 'Ice', MATS: 'Mats', LATE: 'Laterite', CORL: 'Coral', UNPV: 'Unpaved', UNKN: 'Unknown' };
    function panelCode() { return rwyKey((location.pathname.match(/^\/airport\/([a-z0-9]{3,4})(?:[/?#]|$)/i) || [])[1]); }
    function tlTable(box, head, rows, title) {
      var cell = 'px-1.5 py-1', tb = document.createElement('table'); tb.className = 'w-full';
      if (title) { var cap = document.createElement('caption'); cap.className = 'px-1.5 pt-2 pb-1 text-left text-xs font-semibold uppercase text-gray-900'; cap.textContent = title; tb.appendChild(cap); }
      var row = function (cls, tag, vals) { var tr = document.createElement('tr'); tr.className = cls; vals.forEach(function (v) { var c = document.createElement(tag); c.className = cell + (tag === 'th' ? ' text-left font-semibold' : ''); c.textContent = v == null || v === '' ? '–' : String(v); tr.appendChild(c); }); tb.appendChild(tr); };
      row('text-xs font-semibold uppercase text-gray-900', 'th', head);
      rows.forEach(function (v) { row('border-t border-gray-500 text-sm font-semibold text-gray-1300', 'td', v); });
      box.appendChild(tb);
    }
    function rwyPanel() {
      var pic = document.querySelector('[data-testid="airport-panel__promo-runway_details"]'), box = pic && (pic.closest('button') || pic);
      var old = document.querySelectorAll('.tl-rwy'); for (var i = 0; i < old.length; i++) if (!box || old[i].previousElementSibling !== box) old[i].remove();
      if (!box) return;
      var code = panelCode(), list = code ? rwyOf(code) : null, pd = code ? panelData[code] : null;
      var ours = pd && pd.runways && pd.runways.length ? pd.runways : null, freqs = pd && pd.freqs && pd.freqs.length ? pd.freqs : null, ends = pd && pd.ends && pd.ends.length ? pd.ends : null;
      var mine = box.nextElementSibling && box.nextElementSibling.classList.contains('tl-rwy') ? box.nextElementSibling : null;
      if (code) panelWant(code);
      if (!ours && !(list && list.length) && !ends) { if (mine) mine.remove(); box.style.display = ''; if (code) rwyWant(code); return; }
      if (!list && code) rwyWant(code);
      var sig = code + ':' + (ours ? 'o' + ours.length + ':' + (freqs ? freqs.length : 0) : list && list.length ? 'f' + list.length : 'e' + ends.length);
      if (mine && mine.getAttribute('data-sig') === sig) return;
      if (!mine) { mine = document.createElement('div'); box.after(mine); }
      mine.className = 'tl-rwy w-full overflow-hidden rounded border border-gray-500 bg-gray-100'; mine.setAttribute('data-code', code); mine.setAttribute('data-sig', sig); mine.textContent = '';
      var n = function (v) { return fin(v) ? Number(v).toLocaleString('en-GB') : '–'; }, m = function (ft) { return fin(ft) ? Math.round(ft * 0.3048) : null; };
      if (ours) {
        // [ident, other end, length ft, width ft, surface code, surface, lit, closed, then each end: elevation, heading, displaced threshold, lat, lon]
        tlTable(mine, ['Runway', 'Length (m/ft)', 'Width (m)', 'Surface', 'Lights'], ours.map(function (r) { return [r[0] + (r[1] ? '/' + r[1] : '') + (r[7] ? ' (closed)' : ''), n(m(r[2])) + '/' + n(r[2]), n(m(r[3])), SURF_NAME[r[4]] || r[5] || 'Unknown', r[6] === 1 ? 'Yes' : r[6] === 0 ? 'No' : '–']; }));
        var er = []; ours.forEach(function (r) { if (r[7]) return; [[r[0], 8], [r[1], 13]].forEach(function (e) { if (!e[0]) return; var b = e[1]; er.push([e[0], fin(r[b + 1]) ? Math.round(r[b + 1]) + '°' : '', fin(r[b]) ? n(r[b]) + ' ft' : '', r[b + 2] > 0 ? n(r[b + 2]) + ' ft' : 'None']); }); });
        if (er.length) tlTable(mine, ['End', 'Heading (true)', 'Elevation', 'Displaced threshold'], er, 'Runway ends');
        if (freqs) tlTable(mine, ['Type', 'Name', 'MHz'], freqs.map(function (f) { return [f[0], f[1], fin(f[2]) ? f[2].toFixed(3) : '']; }), 'Radio frequencies');
      } else if (list && list.length) tlTable(mine, ['Runway', 'Length (m/ft)', 'Surface'], list.map(function (r) { return [r.name, n(r.m) + '/' + n(r.ft), r.surf || 'Unknown']; }));
      else tlTable(mine, ['Runway end', 'Length (m/ft)', 'Elevation', 'Surface'], ends.map(function (e) { return [e.name, n(m(e.lengthFt)) + '/' + n(e.lengthFt), fin(e.elevationFt) ? n(e.elevationFt) + ' ft' : '', SURF_NAME[e.surface] || 'Unknown']; }));
      box.style.display = 'none';
    }
    // ---- the rest of the map's airport panel ------------------------------------------------------------------------
    // FR24's locked pictures "Movements per day" and "Runway usage" give way to the real thing: the airport's take-offs and
    // landings of each of the last days (FR24's own schedule, counted as on its statistics page, the week's blocked flights
    // the userscript knows on top) and the runways the flights the monitor tracked there used (each one's take-off and
    // landing worked out from its track). Its "Latest events" and the plea to help its ground coverage are taken out.
    // Found by what FR24 names them or by what they say - FR24 redraws its panel, so it is done again each time.
    var panelData = {}, panelAskedAt = {}, panelOpen = { code: '', at: 0 }, panelSigs = {};
    var PANEL_TITLES = ['Latest events', 'Airport statistics', 'Airport movements', 'Movements per day', 'Runway usage', 'Airport & runway details', 'Runway details', 'Weather', 'Busiest routes'];
    function panelWant(code) { if (Date.now() - (panelAskedAt[code] || 0) > 120000) { panelAskedAt[code] = Date.now(); post('needAirportPanel', { code: code }); } }
    function textOf(el) { return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }
    // (the innermost elements saying this)
    function saying(root, re) {
      var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), t;
      while ((t = w.nextNode())) { var v = String(t.nodeValue || '').replace(/\s+/g, ' ').trim(); if (v && v.length < 160 && re.test(v)) { var e = t.parentElement; if (e && !e.closest('.tl-panel, .tl-rwy') && out.indexOf(e) < 0) out.push(e); } }
      return out;
    }
    // (the part of the panel a title heads: up from it while the part above holds no other part's title, nor FR24's tabs
    // or boards - and small, an events list or a notice, not half the panel)
    function partOf(el, panel, title, maxLen) {
      var cur = el;
      while (cur.parentElement && cur.parentElement !== panel) {
        var up = cur.parentElement, t = textOf(up), other = false;
        for (var i = 0; i < PANEL_TITLES.length; i++) if (PANEL_TITLES[i] !== title && t.indexOf(PANEL_TITLES[i]) >= 0) { other = true; break; }
        if (other || t.length > maxLen || up.querySelector('[data-testid^="airport-panel__tab"], [data-testid^="airport-panel__schedules"], [data-testid^="airport-panel__promo-"], .tl-panel, .tl-rwy')) break;
        cur = up;
      }
      return cur;
    }
    function tlHide(el) { if (el && el.style.display !== 'none') { el.style.display = 'none'; el.setAttribute('data-tl-hidden', '1'); } }
    function panelHide(panel) {
      saying(panel, /^latest events$/i).forEach(function (e) { tlHide(partOf(e, panel, 'Latest events', 4000)); });
      saying(panel, /help us improve|improve (our |the )?(ground )?coverage/i).forEach(function (e) { tlHide(partOf(e, panel, '', 600)); });
    }
    // (FR24's locked pictures: by their name, else by the title they sit under)
    function kindNear(el, panel) {
      var img = el.matches('img') ? el : el.querySelector('img[alt]'), alt = img ? String(img.getAttribute('alt') || '') : '';
      if (/movements per day/i.test(alt)) return 'moves'; if (/runway usage/i.test(alt)) return 'usage';
      for (var cur = el, i = 0; i < 4 && cur && cur !== panel; i++, cur = cur.parentElement) { var t = textOf(cur), a = /movements per day/i.test(t), b = /runway usage/i.test(t); if (a !== b) return a ? 'moves' : 'usage'; }
      return '';
    }
    function lockedAfter(h, panel) {
      for (var cur = h, up = 0; up < 3 && cur && cur !== panel; up++, cur = cur.parentElement) {
        var sib = cur.nextElementSibling; while (sib && sib.classList.contains('tl-panel')) sib = sib.nextElementSibling;
        if (sib && (sib.matches('picture, img, button') || sib.querySelector('picture, img'))) return sib;
      }
      return null;
    }
    function promoSlots(panel) {
      var out = [], have = {}, ps = panel.querySelectorAll('[data-testid^="airport-panel__promo-"]');
      for (var i = 0; i < ps.length; i++) {
        var id = ps[i].getAttribute('data-testid') || ''; if (/runway[_-]?details/i.test(id)) continue;
        var kind = /movement/i.test(id) ? 'moves' : /usage/i.test(id) ? 'usage' : kindNear(ps[i], panel); if (!kind || have[kind]) continue;
        var box = ps[i].closest('button') || ps[i]; if (!panel.contains(box)) box = ps[i];
        out.push({ kind: kind, box: box }); have[kind] = 1;
      }
      [['moves', /^movements per day$/i], ['usage', /^runway usage$/i]].forEach(function (k) {
        if (have[k[0]]) return;
        var hs = saying(panel, k[1]); for (var j = 0; j < hs.length; j++) { var b = lockedAfter(hs[j], panel); if (b) { out.push({ kind: k[0], box: b }); have[k[0]] = 1; break; } }
      });
      return out;
    }
    // (the movements of each of the last days: FR24's own counts and the blocked flights the userscript knows)
    function panelMoves(code, d) {
      var c = code.toLowerCase(), tz = d.tz || 'UTC', today = dayOf(Date.now() / 1000, tz);
      var days = mvKept(c).days || {}, add = {}, inc = function (t, k) { var x = dayOf(t, tz); (add[x] = add[x] || { off: 0, on: 0 })[k]++; };
      (routesAdd.get(d.apId) || []).forEach(function (m) { if (m.from.id === d.apId) (m.offs || []).forEach(function (t) { inc(t, 'off'); }); if (m.to.id === d.apId) (m.ons || []).forEach(function (t) { inc(t, 'on'); }); });
      return Object.keys(days).sort().reverse().slice(0, 7).map(function (k) { var x = days[k], e = add[k] || { off: 0, on: 0 }; return { day: k, today: k === today, off: x.takeoffs + e.off, on: x.landings + e.on, blocked: e.off + e.on }; });
    }
    var TL_OFF = '#3d7be0', TL_ON = '#f0b429';
    function bar(parts, max) {
      var b = document.createElement('div'); b.style.cssText = 'display:flex;height:10px;border-radius:2px;overflow:hidden;background:rgba(127,127,127,.15);min-width:60px';
      parts.forEach(function (p) { var s = document.createElement('div'); s.style.cssText = 'height:100%;background:' + p[1] + ';width:' + (max > 0 ? (100 * p[0] / max).toFixed(1) : 0) + '%'; b.appendChild(s); });
      return b;
    }
    function legend(box, note) {
      var l = document.createElement('div'); l.className = 'px-1.5 pb-1.5 pt-1 text-xs text-gray-900';
      [['Take-offs', TL_OFF], ['Landings', TL_ON]].forEach(function (x) { var s = document.createElement('span'); s.style.cssText = 'display:inline-flex;align-items:center;margin-right:10px'; var dot = document.createElement('span'); dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;background:' + x[1]; s.appendChild(dot); s.appendChild(document.createTextNode(x[0])); l.appendChild(s); });
      if (note) { var nn = document.createElement('div'); nn.className = 'pt-1'; nn.textContent = note; l.appendChild(nn); }
      box.appendChild(l);
    }
    function grid(box, rows, max) {
      var tb = document.createElement('table'); tb.className = 'w-full';
      rows.forEach(function (r) {
        var tr = document.createElement('tr'); tr.className = 'border-t border-gray-500 text-sm font-semibold text-gray-1300';
        var a = document.createElement('td'); a.className = 'px-1.5 py-1 whitespace-nowrap'; a.textContent = r.label; tr.appendChild(a);
        var b = document.createElement('td'); b.className = 'px-1.5 py-1 w-full'; b.appendChild(bar([[r.off, TL_OFF], [r.on, TL_ON]], max)); tr.appendChild(b);
        var c = document.createElement('td'); c.className = 'px-1.5 py-1 whitespace-nowrap text-right'; c.textContent = r.off + ' / ' + r.on; tr.appendChild(c);
        tb.appendChild(tr);
      });
      box.appendChild(tb);
    }
    function dayLabel(d) { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); } catch (e) { return d; } }
    function movesBlock(box, code, d) {
      var rows = panelMoves(code, d);
      if (!rows.length) { var p = document.createElement('div'); p.className = 'px-1.5 py-2 text-sm text-gray-900'; p.textContent = 'Counting this airport\'s flights of the last days…'; box.appendChild(p); return 'none'; }
      var max = Math.max.apply(null, rows.map(function (r) { return r.off + r.on; }));
      grid(box, rows.map(function (r) { return { label: dayLabel(r.day) + (r.today ? ' (so far)' : ''), off: r.off, on: r.on }; }), max);
      var bl = rows.reduce(function (s, r) { return s + r.blocked; }, 0);
      legend(box, 'Take-offs / landings by the airport\'s local day - FR24\'s own schedule' + (bl ? ', with ' + bl + ' blocked flight' + (bl > 1 ? 's' : '') + ' it does not show' : '') + '.');
      return JSON.stringify(rows);
    }
    function usageBlock(box, d) {
      var p;
      if (!d.monitor) { p = document.createElement('div'); p.className = 'px-1.5 py-2 text-sm text-gray-900'; p.textContent = 'Runway use is worked out by the monitor from the flights it tracks - it is not connected.'; box.appendChild(p); return 'off'; }
      var by = {}; (d.usage || []).forEach(function (u) { by[u[0]] = { off: u[1] || 0, on: u[2] || 0 }; });
      (d.runways || []).forEach(function (r) { if (r[7]) return; [r[0], r[1]].forEach(function (e) { if (e && !by[e]) by[e] = { off: 0, on: 0 }; }); });
      var rows = Object.keys(by).map(function (k) { return { label: k, off: by[k].off, on: by[k].on }; }).sort(function (a, b) { return (b.off + b.on) - (a.off + a.on) || a.label.localeCompare(b.label, 'en', { numeric: true }); });
      if (!rows.length) { p = document.createElement('div'); p.className = 'px-1.5 py-2 text-sm text-gray-900'; p.textContent = 'No runways known for this airport.'; box.appendChild(p); return 'none'; }
      var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.off + r.on; })));
      grid(box, rows, max);
      legend(box, d.moves ? 'Take-offs / landings of the ' + d.moves + ' movement' + (d.moves > 1 ? 's' : '') + ' the monitor tracked here in the last ' + (d.days || 7) + ' days (blocked aircraft worldwide, all traffic in its areas - not every flight); the runway was clear from the track for ' + (d.withRunway || 0) + '.' : 'The monitor tracked no flights here in the last ' + (d.days || 7) + ' days.');
      return JSON.stringify(rows) + d.moves;
    }
    function panelBlock(slot, code, d) {
      var box = slot.box, mine = box.nextElementSibling && box.nextElementSibling.classList.contains('tl-panel') && box.nextElementSibling.getAttribute('data-kind') === slot.kind ? box.nextElementSibling : null;
      var probe = document.createElement('div'), sig = slot.kind === 'moves' ? movesBlock(probe, code, d) : usageBlock(probe, d);
      sig = code + ':' + sig;
      if (mine && mine.getAttribute('data-sig') === sig) { box.style.display = 'none'; return; }
      if (!mine) { mine = document.createElement('div'); box.after(mine); }
      mine.className = 'tl-panel w-full overflow-hidden rounded border border-gray-500 bg-gray-100'; mine.setAttribute('data-kind', slot.kind); mine.setAttribute('data-sig', sig); mine.textContent = '';
      while (probe.firstChild) mine.appendChild(probe.firstChild);
      box.style.display = 'none';
    }
    function panelTick() {
      var panel = document.querySelector('[data-testid="airport-panel"]');
      if (!panel) { var left = document.querySelectorAll('.tl-panel'); for (var i = 0; i < left.length; i++) left[i].remove(); if (document.querySelector('.tl-rwy')) rwyPanel(); panelOpen.code = ''; return; }
      var code = panelCode(); if (!code) return;
      if (panelOpen.code !== code) { panelOpen.code = code; panelOpen.at = Date.now(); }
      panelWant(code); rwyPanel();
      var d = panelData[code];
      // (FR24's own counts of the last days: once the panel has been open a moment - a click through airports asks nothing)
      if (d && Date.now() - panelOpen.at > 2500) mvCount(code.toLowerCase(), d.tz || 'UTC');
      // (the panel as it was last done, unchanged: nothing to do)
      if (panelSigs[code] === panelSig(panel, code, d)) return;
      panelHide(panel);
      if (d) promoSlots(panel).forEach(function (sl) { try { panelBlock(sl, code, d); } catch (e) { stats.errors++; stats.lastError = String(e); } });
      panelSigs[code] = panelSig(panel, code, d);
    }
    function panelSig(panel, code, d) { return [panel.getElementsByTagName('*').length, textOf(panel).length, d ? d.at : 0, (lsGet('tl.mv.' + code.toLowerCase()) || '').length, ((d && routesAdd.get(d.apId)) || []).length, Math.floor(Date.now() / 60000)].join(':'); }
    function acceptAirportPanel(d) {
      var code = rwyKey(d.code); if (!code) return;
      panelData[code] = { at: Date.now(), apId: Number(d.apId) || 0, tz: String(d.tz || ''), days: Number(d.days) || 7, runways: Array.isArray(d.runways) ? d.runways : null, freqs: Array.isArray(d.freqs) ? d.freqs : null, usage: Array.isArray(d.usage) ? d.usage : null, moves: Number(d.moves) || 0, withRunway: Number(d.withRunway) || 0, monitor: !!d.monitor, ends: Array.isArray(d.ends) ? d.ends : null };
      panelSigs[code] = ''; panelTick();
    }
    setInterval(function () { try { panelTick(); } catch (e) { stats.errors++; stats.lastError = String(e); } }, 400);
    // an airport page's runway table: FR24's runways, each end's elevation where the userscript knows it, else the airport's
    function unlockRunways(p, apId) {
      var ap = p.airport || {}, code = ap.iata || ap.icao, fr = rwyOf(code); if (!fr) rwyWant(code);
      var ours = apDataOf(apId).runways || [], el = {}; ours.forEach(function (r) { el[r.name] = r.elevationFt; });
      var rw = fr ? fr.map(function (r) { return { name: r.name, lengthFt: r.ft, elevationFt: fin(el[r.name]) ? el[r.name] : (ap.elevationFt || 0), surface: r.code || 'UNKN' }; }) : ours.slice();
      if (!p.locked || !rw.length || (!p.locked.runways && !(p.runways && p.runways.__tl))) return;   // (a subscriber's own table stands)
      var sig = JSON.stringify(rw); if (p.runways && p.runways.__tl === sig) return;
      rw.__tl = sig; p.runways = rw; if (p.locked.runways) p.locked = Object.assign({}, p.locked, { runways: false });
    }
    // ---- the airport's movements by day (statistics page, "Airport movements"): FR24's own schedule - free accounts page
    // through it back to about yesterday morning - counted by each flight's actual landing and take-off time, by the
    // airport's local day: today so far, and each day the pages reach back past the start of (kept a week, so the table
    // fills as the days go by); the blocked flights the userscript knows on top. A day never seen whole is left out.
    var mvBusy = {};
    function dayOf(t, tz) { try { return new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: tz || 'UTC' }); } catch (e) { return new Date(t * 1000).toISOString().slice(0, 10); } }
    function mvKept(code) { try { return JSON.parse(lsGet('tl.mv.' + code) || 'null') || { days: {}, at: 0 }; } catch (e) { return { days: {}, at: 0 }; } }
    function mvCount(code, tz) {
      if (mvBusy[code] || Date.now() - mvKept(code).at < 600000) return; mvBusy[code] = true;
      var now = Math.floor(Date.now() / 1000), today = dayOf(now, tz);
      var one = function (mode) {
        var cnt = {}, ts = {}, ids = {}, earliest = Infinity, k = mode === 'arrivals' ? 'arrival' : 'departure';
        var page = function (n) {
          return oFetch.call(window, 'https://api.flightradar24.com/common/v1/airport.json?code=' + encodeURIComponent(code) + '&plugin[]=schedule&plugin-setting[schedule][mode]=' + mode + '&plugin-setting[schedule][timestamp]=' + now + '&page=' + n + '&limit=100')
            .then(function (r) { return r.json(); }).then(function (j) {
              var ap = j && j.result && j.result.response && j.result.response.airport, b = ap && ap.pluginData && ap.pluginData.schedule && ap.pluginData.schedule[mode];
              ((b && b.data) || []).forEach(function (x) {
                var f = x && x.flight, tm = f && f.time, id = f && f.identification && (f.identification.row || f.identification.id); if (!tm) return;
                var sch = tm.scheduled && tm.scheduled[k], real = tm.real && tm.real[k]; if (sch && sch < earliest) earliest = sch;
                if (!real || (id && ids[id])) return; if (id) ids[id] = 1;
                var d = dayOf(real, tz); cnt[d] = (cnt[d] || 0) + 1; if (!ts[d]) ts[d] = real;
              });
              return b && b.page ? b.page : null;
            });
        };
        // back from now a page at a time until the day before yesterday is reached (or FR24 gives no more), then the next
        // page ahead (early arrivals)
        var back = function (n) { return page(-n).then(function (pg) { if (pg && n < pg.total && n < 10 && dayOf(earliest, tz) >= dayOf(now - 86400, tz)) return back(n + 1); }); };
        return back(1).then(function () { return page(1); }).catch(function () { /* what came */ }).then(function () { return { cnt: cnt, ts: ts, from: earliest < Infinity ? dayOf(earliest, tz) : today }; });
      };
      Promise.all([one('arrivals'), one('departures')]).then(function (r) {
        var a = r[0], dp = r[1], kept = mvKept(code), days = kept.days || {}, from = a.from > dp.from ? a.from : dp.from, old = dayOf(now - 8 * 86400, tz);
        Object.keys(a.cnt).concat(Object.keys(dp.cnt), [today]).forEach(function (d) { if (d > from || d === today) days[d] = { landings: a.cnt[d] || 0, takeoffs: dp.cnt[d] || 0, ts: a.ts[d] || dp.ts[d] || now }; });
        Object.keys(days).forEach(function (d) { if (d < old) delete days[d]; });
        lsSet('tl.mv.' + code, JSON.stringify({ days: days, at: Date.now() })); mvBusy[code] = false; routesTick();
      }, function () { mvBusy[code] = false; });
    }
    function mvRows(p) {
      var ap = p.airport, code = String(ap.iata || ap.icao || '').toLowerCase(), tz = ap.timezone; if (!code) return null;
      mvCount(code, tz);
      var days = mvKept(code).days || {}, keys = Object.keys(days).sort().reverse().slice(0, 7); if (!keys.length) return null;
      var add = {}, inc = function (t, k) { var d = dayOf(t, tz); (add[d] = add[d] || { off: 0, on: 0 })[k]++; };
      (routesAdd.get(ap.id) || []).forEach(function (m) { if (m.from.id === ap.id) (m.offs || []).forEach(function (t) { inc(t, 'off'); }); if (m.to.id === ap.id) (m.ons || []).forEach(function (t) { inc(t, 'on'); }); });
      return keys.map(function (d) { var x = days[d], e = add[d] || { off: 0, on: 0 }, to = x.takeoffs + e.off, la = x.landings + e.on; return { timestamp: x.ts, total: to + la, takeoffs: to, landings: la }; });
    }
    function applyStats(pg) {
      var p = pg.props, apId = p.airport.id, w = weekAdds(pg), sig = w.ready + ':' + w.land + ':' + w.off + ':' + Object.keys(w.aps).length + ':' + Object.keys(w.cs).length;
      unlockRunways(p, apId);
      var mv = mvRows(p), msig = mv ? JSON.stringify(mv) : '';
      if (mv && mv.length && p.locked && (p.locked.movements || (p.movements && p.movements.__tl)) && !(p.movements && p.movements.__tl === msig)) { mv.__tl = msig; p.movements = mv; if (p.locked.movements) p.locked = Object.assign({}, p.locked, { movements: false }); }
      if (!p.summary || p.summary.__tl === sig || !(w.land || w.off)) return;
      var b = p.summary.__tlBase || p.summary;
      p.summary = { airportsServed: (b.airportsServed || 0) + Object.keys(w.aps).length, countriesServed: (b.countriesServed || 0) + Object.keys(w.cs).length, totalFlights: (b.totalFlights || 0) + w.land + w.off, landingCount: (b.landingCount || 0) + w.land, takeoffCount: (b.takeoffCount || 0) + w.off, __tlBase: b, __tl: sig };
    }
    // ours into one of FR24's lists of flights: none twice (its own row of a flight - by flight id, or callsign within 45
    // minutes - gets what it lacks from ours: "N/A" where it went or came from), only within the span FR24's own list covers
    // (a page of the board, the general page's next few), in time order, as many as FR24 showed where it showed a few
    function mergeFlights(list, mine, kind, span, keepLen) {
      var base = (list || []).filter(function (x) { return x && !x.__tl; }), add = [];
      (mine || []).forEach(function (m) {
        var t = m.scheduledTime || m.estimatedTime || 0; if (span && !(t >= span[0] && t <= span[1])) return;
        var hit = base.find(function (x) { return (m.flightId && x.flightId === m.flightId) || (m.callsign && x.callsign === m.callsign && Math.abs((x.estimatedTime || x.scheduledTime || 0) - t) < 2700); });
        if (hit) { if (!hit.endpoint && m.endpoint) hit.endpoint = m.endpoint; if (!hit.aircraft || !hit.aircraft.type) hit.aircraft = m.aircraft; return; }
        add.push(m);
      });
      // (in the list's own order: boards run earliest first, the on-ground list latest landed first)
      var desc = base.length > 1 && (base[0].scheduledTime || 0) > (base[base.length - 1].scheduledTime || 0);
      var all = base.concat(add).sort(function (a, b) { return desc ? (b.scheduledTime || 0) - (a.scheduledTime || 0) : (a.scheduledTime || 0) - (b.scheduledTime || 0); });
      if (keepLen) { var cut = all.slice(0, Math.max(keepLen, 0)); return cut; }
      return all;
    }
    function spanOf(list, meta) { var ts = (list || []).filter(function (x) { return x && !x.__tl; }).map(function (x) { return x.scheduledTime || 0; }).filter(Boolean); if (ts.length) return [Math.min.apply(null, ts) - 900, Math.max.apply(null, ts) + 900]; return meta && meta.date ? [meta.date - 3600, meta.date + (meta.hoursRange || 12) * 3600] : null; }
    // (FR24 gives the airport's zone by name, "Europe/Dublin": its offset now, from the browser's own zone tables)
    var tzOffS = function (tz) { if (tz && typeof tz.offset === 'number') return tz.offset; try { var d = new Date(); d.setMilliseconds(0); return Math.round((Date.parse(d.toLocaleString('en-US', { timeZone: tz })) - Date.parse(d.toLocaleString('en-US', { timeZone: 'UTC' }))) / 1000) || 0; } catch (e) { return 0; } };
    var dayStartS = function (tz) { var off = tzOffS(tz), n = Date.now() / 1000 + off; return n - n % 86400 - off; };
    function todayCount(items, tz) { var s = dayStartS(tz); return (items || []).filter(function (m) { var t = m.scheduledTime || 0; return t >= s && t < s + 86400; }).length; }
    function applyBoardPage(pg) {
      // (the on-ground page is board "on-ground": every aircraft still there, however long ago it landed)
      var p = pg.props, og = p.board === 'on-ground', apId = p.airport.id, d = apDataOf(apId), mine = d.board && d.board[og ? 'onGround' : p.board]; if (!mine || !Array.isArray(p.flights)) return;
      var sig = hashStr(JSON.stringify(mine)) + ':' + (p.meta && p.meta.currentPage); if (p.flights.__tl === sig) return;
      var fl = mergeFlights(p.flights, mine, p.board, og ? null : spanOf(p.flights, p.meta), 0), added = fl.filter(function (x) { return x.__tl; }).length; fl.__tl = sig; p.flights = fl;
      if (og && p.statistics && typeof p.statistics.onGround === 'number') { var gb = p.statistics.__tlBase || p.statistics; p.statistics = Object.assign({}, gb, { onGround: gb.onGround + added, __tlBase: gb }); }
      else if (p.statistics && p.statistics.today) { var tb = p.statistics.__tlBase || p.statistics; p.statistics = Object.assign({}, tb, { today: Object.assign({}, tb.today, { total: (tb.today.total || 0) + todayCount(mine.filter(function (m) { return !fl.some(function (x) { return !x.__tl && ((m.flightId && x.flightId === m.flightId) || (m.callsign && x.callsign === m.callsign)); }); }), p.airport.timezone) }), __tlBase: tb }); }
      return added;
    }
    function applyAirport(pg) {
      var p = pg.props, apId = p.airport.id, d = apDataOf(apId);
      unlockRunways(p, apId);
      if (d.board && p.boards && p.boards.__tl !== hashStr(JSON.stringify(d.board))) {
        var nb = {}; ['departures', 'arrivals', 'onGround'].forEach(function (k) { var x = p.boards[k]; if (!x || !Array.isArray(x.flights)) { nb[k] = x; return; } nb[k] = Object.assign({}, x, { flights: mergeFlights(x.flights, d.board[k], k, k === 'onGround' ? null : spanOf(x.flights, null), x.flights.length || 5) }); });
        nb.__tl = hashStr(JSON.stringify(d.board)); p.boards = nb;
        if (p.delayStrip) { var db = p.delayStrip.__tlBase || p.delayStrip; p.delayStrip = Object.assign({}, db, { departuresToday: (db.departuresToday || 0) + todayCount(d.board.departures, p.airport.timezone), arrivalsToday: (db.arrivalsToday || 0) + todayCount(d.board.arrivals, p.airport.timezone), __tlBase: db }); }
      }
      // the week's routes: its top routes, and the destinations it counts
      var w = weekAdds(pg), tsig = w.ready + ':' + w.off;
      if (w.off && Array.isArray(p.topRoutes) && p.topRoutes.__tl !== tsig) {
        var tops = (p.topRoutes.__tlBase || p.topRoutes).map(function (x) { return Object.assign({}, x); }), byId = {}; tops.forEach(function (x) { byId[x.id] = x; });
        (routesAdd.get(apId) || []).forEach(function (m) { if (m.from.id !== apId) return; var o = m.to, x = byId[o.id]; if (x) x.flights = (x.flights || 0) + m.n; else { x = byId[o.id] = { id: o.id, name: o.name, city: o.city, iata: o.iata, icao: o.icao, countryId: o.countryId, countryName: o.countryName, url: '/data/airports/' + String(o.iata || o.icao).toLowerCase(), flights: m.n }; tops.push(x); } });
        var nt = tops.sort(function (a, b) { return (b.flights || 0) - (a.flights || 0); }).slice(0, Math.max(5, (p.topRoutes.__tlBase || p.topRoutes).length)); nt.__tl = tsig; nt.__tlBase = p.topRoutes.__tlBase || p.topRoutes; p.topRoutes = nt;
        if (w.ready && p.about && !p.about.__tl) p.about = Object.assign({}, p.about, { destinations: (p.about.destinations || 0) + Object.keys(w.aps).length, __tl: true });
      }
    }
    var dataAsked = {};
    function routesTick() {
      if (!/^\/data\/airports\/[^/]+/.test(location.pathname)) return;
      var pg = inertiaPage(); if (!pg) return;
      var c = pg.component, apId = pg.props.airport.id;
      var kinds = c === 'Data/AirportRoutes' ? ['routes'] : c === 'Data/AirportStatistics' ? ['routes', 'runways'] : c === 'Data/Airport' ? ['board', 'routes', 'runways'] : c === 'Data/AirportBoard' ? ['board'] : [];
      if (!kinds.length) return;
      apDataOf(apId);
      var key = apId + ':' + kinds.join(','); if (!dataAsked[key] || Date.now() - dataAsked[key] > 60000) { dataAsked[key] = Date.now(); post('needAirportData', { apId: apId, kinds: kinds }); }
      try { if (c === 'Data/AirportRoutes') applyRoutes(pg); else if (c === 'Data/AirportStatistics') applyStats(pg); else if (c === 'Data/Airport') applyAirport(pg); else applyBoardPage(pg); } catch (e) { stats.errors++; stats.lastError = String(e); }
    }
    setInterval(routesTick, 300);
    // "Recent <reg> flights": FR24 answers `data: null` for blocked registrations; the userscript supplies the log.
    function needHistory(reg) {
      reg = String(reg || '').toUpperCase();
      // (a list handed over ahead of time is answered at once - a still-growing one too, when it has flights in it)
      var h = hist.get(reg); if (h && Date.now() - h.at < 10 * 60000 && (!h.partial || (h.data && h.data.length > 1))) return Promise.resolve(h);
      return new Promise(function (resolve) {
        var l = histWait.get(reg) || []; l.push(resolve); histWait.set(reg, l);
        post('needHist', { reg: reg });
        setTimeout(function () { var w = histWait.get(reg) || []; var i = w.indexOf(resolve); if (i >= 0) { w.splice(i, 1); resolve(hist.get(reg) || null); } }, 9000);
      });
    }

    window.fetch = function (input, init) {
      var url = urlOf(input), m;
      // the userscript's own lookups (boards for filed plans, registration searches): passed through untouched
      try {
        var hd = init && init.headers;
        if (hd && (hd['X-TL-Internal'] || (typeof hd.get === 'function' && hd.get('X-TL-Internal')))) {
          var h2 = {}; if (typeof hd.forEach === 'function') hd.forEach(function (v, k) { if (!/^x-tl-internal$/i.test(k)) h2[k] = v; }); else for (var hk in hd) if (hk !== 'X-TL-Internal') h2[hk] = hd[hk];
          return oFetch.call(this, input, Object.assign({}, init, { headers: h2 }));
        }
      } catch (e) { /* fall through */ }
      try {
        // board detail card of a kept row (an earlier or later page): from what was kept
        if ((m = url.match(/\/api\/v1\/airports\/(\d+)\/(arrivals|departures)\/(\d+)(?:$|[?#])/)) && Number(m[3]) >= 20000000000 && archById.has(Number(m[3]))) { stats.details++; return archDetail(archById.get(Number(m[3])), Number(m[1]), m[2]); }
        // board detail card of a row this script added: answered locally, instantly (FR24 would say 404)
        if ((m = url.match(/\/api\/v1\/airports\/(\d+)\/(arrivals|departures)\/(\d+)(?:$|[?#])/)) && Number(m[3]) >= 9000000000) {
          var sid = Number(m[3]) - 9000000000, rec0 = recOf(sid), route0 = routeNow(sid) || {};
          if (rec0) { stats.details++; return photosWithin(rec0, 2800).then(function (ph) { return jsonResponse(null, boardDetailFor(sid, rec0, route0, m[2], Number(m[1]), ph)); }); }
        }
        if ((m = url.match(/\/api\/v1\/airports\/(\d+)\/on-grounds\/(\d+)\/aircraft-images/)) && Number(m[2]) >= 9000000000) {
          var gid = Number(m[2]) - 9000000000, grec = resolved.get(gid);
          if (grec) return photosWithin(grec, 2800).then(function (ph) { return jsonResponse(null, { data: { images: ph.slice(0, 3).map(boardImage) } }); });
        }
        if (LIST_RE.test(url)) return listFetch(this, arguments, url);
        // (a landing place the userscript learned is no airport of FR24's: its boards, opened from its marker, answered
        // here - empty - instead of FR24's "not found")
        if ((m = url.match(/\/api\/v1\/airports\/(\d+)\/(?:departures|arrivals|on-grounds)\b/)) && Number(m[1]) > 9000000 && Number(m[1]) < 10000000) return Promise.resolve(jsonResponse(null, { data: [], meta: { currentPage: 1, previousPage: null, nextPage: null, hasMorePreviousData: false, hasMoreNextData: false } }));
      } catch (e) { stats.errors++; stats.lastError = String(e); }
      var p = oFetch.apply(this, arguments);
      try {
        // FR24's own airport answer (its map panel's): its runways kept for the panel's table and the airport pages
        if (/\/common\/v1\/airport\.json\?/.test(url) && /runways/.test(url)) { p.then(function (res) { if (res.ok) res.clone().json().then(noteAirportJson, function () {}); }, function () {}); return p; }
        // FR24's picture list of an aircraft on the ground (board card): its airport-data pictures taken out
        if (/\/aircraft-images(?:$|[?#])/.test(url)) {
          return p.then(function (res) {
            if (!res.ok) return res;
            return res.clone().json().then(function (j) {
              var imgs = j && j.data && j.data.images; if (!Array.isArray(imgs) || !imgs.some(adJson)) return res;
              j.data.images = imgs.filter(function (im) { return !adJson(im); }); return jsonResponse(res, j);
            }, function () { return res; });
          });
        }
        if (/\/v1\/search\/web\/find\?/.test(url)) {
          var qm = url.match(/[?&]query=([^&]*)/); var q = qm ? decodeURIComponent(qm[1].replace(/\+/g, ' ')).trim().toUpperCase() : '';
          if (q.length < 2) return p;
          var mine = askSearch(q);     // (asked of the userscript at once, answered while FR24's own search runs)
          return p.then(function (res) {
            if (!res.ok) return res;
            return Promise.all([res.clone().json(), mine]).then(function (both) {
              var j = both[0], extra = both[1] || [];
              if (!j || !Array.isArray(j.results)) return res;
              var enriched = 0; j.results.forEach(function (r) { if (enrichAircraftRow(r)) enriched++; if (logoFix(r)) enriched++; });
              // (aircraft found by registration: blocked on FR24 or not - its register lookup lists no flights for a blocked
              // one - for the yellow tag in the list: M-CDJC, M-PORT)
              if (q.length >= 4) j.results.filter(function (r) { return r && r.type === 'aircraft' && r.id && !recByReg(r.id); }).slice(0, 3).forEach(function (r) {
                var hx = String((r.detail && r.detail.hex) || '').toLowerCase();
                regInfo(r.id).then(function (x) { if (x) post('searchRows', { rows: [{ reg: x.reg, hex: x.hex || hx, type: x.ty, blocked: !!x.blocked }] }); });
              });
              var add = liveEntries(q);
              // one row per aircraft: none added for a flight - or a registration - FR24's own results already list live
              var have = {}, haveReg = {}, seen = {}; j.results.forEach(function (r) { if (!r) return; seen[r.type + ':' + String(r.id).toUpperCase()] = true; if (r.type === 'live') { have[r.id] = true; if (r.detail && r.detail.reg) haveReg[String(r.detail.reg).toUpperCase()] = true; } });
              add = add.filter(function (a) { return !have[a.id] && !(a.detail.reg && haveReg[String(a.detail.reg).toUpperCase()]); });
              // the blocked aircraft and the callsigns they flew under that the userscript keeps logs of - FR24 lists neither:
              // as its aircraft (to the log page) and flight numbers (to the flight-number page)
              var more = extra.filter(function (r) { return r && r.id && !seen[r.type + ':' + String(r.id).toUpperCase()]; });
              more.forEach(function (r) { r.detail = r.detail || {}; if (!logoFix(r) && r.detail.operator_id && !r.detail.logo) r.detail.logo = logoOf(r.detail.operator_id); });
              // the expanded card (FlightDetails) shows photos: fetch them now, while the list is being read
              // (ahead of any background work; the top result first)
              add.concat(j.results.filter(function (r) { return r && r.type === 'live'; })).slice(0, 8).reverse().forEach(function (a) { var r = resolved.get(parseInt(a.id, 16)); if (r) warmPhotos(r, true); });
              if (!add.length && !more.length) { if (!enriched) return res; stats.searchHits += enriched; return jsonResponse(res, j); }
              j.results = add.concat(j.results, more);
              try { add.concat(more).forEach(function (r) { var t = r.type; j.stats.count[t] = (j.stats.count[t] || 0) + 1; j.stats.total[t] = (j.stats.total[t] || 0) + 1; j.stats.total.all = (j.stats.total.all || 0) + 1; }); } catch (e) { /* ignore */ }
              stats.searchHits += add.length + more.length;
              return jsonResponse(res, j);
            }, function () { return res; });
          });
        }
        // detail card of a real FR24 row for a blocked flight: fill what FR24 left empty
        if ((m = url.match(/\/api\/v1\/airports\/(\d+)\/(arrivals|departures)\/(\d+)(?:$|[?#])/))) {
          // (an FR24 row of an earlier day, kept: its card from what was kept when FR24 no longer gives it)
          var arKept = archById.get(Number(m[3])), arAp = Number(m[1]), arKind = m[2], arRow = Number(m[3]);
          return p.then(function (res) {
            if (!res.ok) return arKept ? archDetail(arKept, arAp, arKind) : res;
            return res.clone().json().then(function (j) {
              var d = j && j.data; if (!d || !d.flight) return res;
              var id = d.flight.id ? parseInt(d.flight.id, 16) : 0, rec = id ? resolved.get(id) : null;
              // (FR24's card with no aircraft - "N/A" all through, G-PTRK's - or one of a flight this script knows more of)
              if (!rec && (natInfo.has(arRow) || !(d.aircraft && d.aircraft.registration && d.aircraft.type) || !d.airline || /private owner/i.test(d.airline))) return fillNativeCard(d, arRow, arKind).then(function () { stats.details++; return jsonResponse(res, j); }, function () { return res; });
              if (!d.flight.id) return res;
              if (!rec) {
                // an ordinary flight's card: only its airport-data pictures are replaced
                if (!Array.isArray(d.images) || !d.images.some(adJson)) return res;
                d.images = d.images.filter(function (im) { return !adJson(im); });
                var ah = String((d.aircraft && (d.aircraft.hex || d.aircraft.icao24 || d.aircraft.modeS)) || '').toLowerCase(), areg = d.aircraft && d.aircraft.registration || '';
                if (d.images.length || !/^[0-9a-f]{6}$/.test(ah)) return jsonResponse(res, j);
                return photosWithin({ hex: ah, reg: areg }, 2800).then(function (ph) { d.images = goodPhotos(ph).slice(0, 3).map(boardImage); return jsonResponse(res, j); });
              }
              var label = csOf(rec);
              if (!d.flight.callsign && label) d.flight.callsign = label;
              d.aircraft = d.aircraft || {};
              if (!d.aircraft.registration && rec.reg) d.aircraft.registration = rec.reg;
              if (!d.aircraft.type && rec.type) d.aircraft.type = rec.type;
              if (!d.aircraft.name && (rec.desc || rec.type)) d.aircraft.name = rec.desc || rec.type;
              if ((!d.airline || /private owner/i.test(d.airline)) && (rec.operatorName || rec.owner)) d.airline = rec.operatorName || rec.owner;
              if (!d.airlineId && rec.operatorId) d.airlineId = rec.operatorId;
              var route = routes.get(id);
              if (route && d.schedule) { if (!d.schedule.atd && route.atd) d.schedule.atd = route.atd; if (!d.schedule.ata && route.ata) d.schedule.ata = route.ata; if (!d.schedule.eta && route.eta) d.schedule.eta = route.eta; }
              stats.details++;
              if (Array.isArray(d.images)) d.images = d.images.filter(function (im) { return !adJson(im); });
              if (Array.isArray(d.images) && d.images.length) return jsonResponse(res, j);
              return photosWithin(rec, 2800).then(function (ph) { d.images = goodPhotos(ph).slice(0, 3).map(boardImage); return jsonResponse(res, j); });
            }, function () { return res; });
          });
        }
        if ((m = url.match(/\/api\/v1\/airports\/(\d+)\/(departures|arrivals|on-grounds)\b/))) {
          var apId = Number(m[1]), kind = m[2];
          var pageM = url.match(/[?&]page=(-?\d+)/), page = pageM ? Number(pageM[1]) : 1;
          var whole = kind !== 'on-grounds' && page === 1;
          // (the airport's kept flights, and FR24's own earlier page, asked for alongside FR24's own answer)
          var archP = kind === 'on-grounds' ? null : needBoardArch(apId), earlier = null;
          var earlierP = whole ? oFetch.call(window, /[?&]page=/.test(url) ? url.replace(/([?&])page=-?\d+/, '$1page=-1') : url + (url.indexOf('?') >= 0 ? '&' : '?') + 'page=-1', init).then(function (r) { return r.ok ? r.json() : null; }).then(function (x) { earlier = x; }, function () { /* FR24's day without it */ }) : null;
          return Promise.all([p, archP, earlierP]).then(function (x) { return x[0]; }).then(function (res) {
            if (!res.ok) return res;
            return res.clone().json().then(function (j) {
              if (!j || !Array.isArray(j.data)) return res;
              var merged = false;
              if (whole && earlier && Array.isArray(earlier.data)) { var have = {}; j.data.forEach(function (e) { if (e && e.id) have[e.id] = true; }); earlier.data.forEach(function (e) { if (e && !have[e.id]) { j.data.push(e); merged = true; } }); }
              var hits = 0, today = new Date().toISOString().slice(0, 10), seenIds = [];
              j.data.forEach(function (e) {
                if (!e || !e.flight || !e.flight.id) return;
                var id = parseInt(e.flight.id, 16), rec = resolved.get(id);
                // (an N/A flight of FR24's own that this script follows: where it is going / came from, as reasoned)
                if (!rec) { var nr = naRecs.get(id); if (nr && kind !== 'on-grounds') { var rt = routeNow(id) || {}; nativeFill(e, { ap: (kind === 'departures' ? rt.destId : rt.originId) || 0, reg: nr.reg, hex: nr.hex, ty: nr.type, dsc: nr.desc, al: nr.operatorName || nr.owner, alId: nr.operatorId || 0, fc: nr.fcat }, kind, rt); } return; }
                var label = csOf(rec);
                if (!e.flight.callsign && label) { e.flight.callsign = label; hits++; }
                if (!e.airlineId && rec.operatorId) e.airlineId = rec.operatorId;
                if ((!e.airline || /private owner/i.test(e.airline)) && (rec.operatorName || rec.owner)) e.airline = rec.operatorName || rec.owner;
                if (!e.aircraftType && rec.type) e.aircraftType = rec.type;
                if (e.aircraft && typeof e.aircraft === 'object') { if (!e.aircraft.registration && rec.reg) e.aircraft.registration = rec.reg; if (!e.aircraft.name && (rec.desc || rec.type)) e.aircraft.name = rec.desc || rec.type; if (!e.aircraft.registeredOwners && (rec.operatorName || rec.owner)) e.aircraft.registeredOwners = rec.operatorName || rec.owner; }
                seenIds.push(id);
              });
              // Every identified flight whose reasoned route touches this airport is listed as traffic, even when the
              // destination is only the most likely one (FR24's own "estimated / ambiguous" styling marks those). A row
              // goes on the board page whose time span holds it - page 1 (from now on) also takes the flights that landed
              // in the last hours - so paging back and forth never duplicates or misorders a row.
              var board = noteBoard(apId, kind);
              if (page === 1) {
                var present = {}; j.data.forEach(function (e) { if (e && e.flight && e.flight.id) present[e.flight.id] = true; });
                // one row per aircraft in flight, under the flight id FR24 has for it now: an aircraft can also be known
                // under an older id (from before a coverage gap, or its last flight) - "Show on map" on that one finds no
                // live flight (C-GTLA into Halifax)
                var newest = {};
                var noteId = function (rec, id) { var hx = rec && rec.hex; if (!hx) return; var lp = lastPos.get(id), t = lp ? lp.at : 0, b = newest[hx]; if (!b || t > b.t) newest[hx] = { id: id, t: t }; };
                resolved.forEach(noteId); naRecs.forEach(function (rec, id) { if (!resolved.has(id)) noteId(rec, id); });
                // (FR24's own row of the same aircraft - by its callsign, or the airframe the userscript matched it to - within an
                // hour and a half: that one stands, none of ours beside it)
                var nativeWho = []; j.data.forEach(function (e) { if (!e || e.__tlAdded || !e.flight) return; var nid = e.flight.id ? parseInt(e.flight.id, 16) : 0, nr = nid ? recOf(nid) : null; nativeWho.push({ cs: String(e.flight.callsign || '').toUpperCase(), hex: nr && nr.hex ? String(nr.hex).toLowerCase() : '', t: e.estimatedTime || e.scheduledTime || 0 }); });
                var addRow = function (rec, id) {
                  var route = routeNow(id); if (!route || present[id.toString(16)] || !boardSig(id, apId, kind)) return;
                  var lbl0 = String(csOf(rec) || '').toUpperCase(), hx0 = String(rec.hex || '').toLowerCase(), t0r = (kind === 'departures' ? (route.atd || route.std) : (route.ata || route.eta || route.sta)) || 0;
                  if (nativeWho.some(function (n) { return ((n.hex && n.hex === hx0) || (n.cs && n.cs === lbl0)) && (!t0r || !n.t || Math.abs(n.t - t0r) < 5400); })) return;
                  if (!route.landed && rec.hex && newest[rec.hex] && newest[rec.hex].id !== id) return;
                  var label = csOf(rec);
                  if (kind === 'on-grounds') {
                    j.data.push({ id: 9000000000 + id, flight: { id: id.toString(16), number: null, callsign: label }, landedTime: route.ata || null, airlineId: rec.operatorId || null, runway: null,
                      aircraft: { category: categoryOf(rec), name: rec.desc || rec.type || '', registeredOwners: rec.operatorName || rec.owner || '', registration: rec.reg || '', type: rec.type || '' }, originId: route.originId || null, activeDay: today, __tlAdded: true });
                    hits++; seenIds.push(id); return;
                  }
                  var row = boardRowFor(id, rec, route, kind, apId);
                  if (!row.scheduledTime) return;
                  j.data.push(row); hits++; seenIds.push(id);
                };
                resolved.forEach(addRow); naRecs.forEach(function (rec, id) { if (!resolved.has(id)) addRow(rec, id); });
                if (hits) j.data.sort(function (a, b) { return (a.scheduledTime || a.landedTime || 0) - (b.scheduledTime || b.landedTime || 0); });
              }
              j.data.forEach(function (e) { if (e && e.flight && e.flight.id && !e.__tlAdded) board.native[parseInt(e.flight.id, 16)] = true; });
              if (page === 1) { resolved.forEach(function (rec, id) { board.sig[id] = boardSig(id, apId, kind); }); naRecs.forEach(function (rec, id) { board.sig[id] = boardSig(id, apId, kind); }); }
              boardServedAt = Date.now();
              // warm the photo cache for every identified row, so an expanded card has its pictures immediately
              seenIds.forEach(function (id) { var r = recOf(id); if (r && r.hex) warmPhotos(r, false); });
              if (seenIds.length) post('boardSeen', { airportId: apId, kind: kind, ids: seenIds });
              // FR24's own rows kept for when they drop off its free day; the kept flights of this page added, and the
              // pages before and after FR24's day opened up
              var metaWas = JSON.stringify(j.meta || null);
              if (kind !== 'on-grounds') {
                var natRows = j.data.filter(function (e) { return e && e.flight && e.flight.id && !e.__tlAdded; });
                if (natRows.length && (page === 1 || page === -1)) post('boardRows', { apId: apId, kind: kind, rows: natRows });
                if (whole) {
                  try { hits += addArch(j, apId, kind); } catch (e) { stats.errors++; stats.lastError = String(e); }
                  j.meta = Object.assign({}, j.meta, { currentPage: 1, previousPage: null, nextPage: null, hasMorePreviousData: false, hasMoreNextData: false });
                  j.data.sort(function (x, y) { return (x.scheduledTime || x.landedTime || 0) - (y.scheduledTime || y.landedTime || 0); });
                  var nowS1 = Date.now() / 1000 - 900, first = j.data.filter(function (e) { return e && (e.scheduledTime || 0) >= nowS1; })[0] || j.data[j.data.length - 1];
                  if (first) scrollBoardToNow(first.id, apId + '/' + kind);
                }
              }
              if (!hits && !merged && JSON.stringify(j.meta || null) === metaWas) return res;
              stats.boardHits += hits;
              return jsonResponse(res, j);
            }, function () { return res; });
          });
        }
        if ((m = url.match(/api\.flightradar24\.com\/common\/v1\/flight\/list\.json\?(.*)$/)) && /fetchBy=reg/.test(url)) {
          var qr = (m[1].match(/(?:^|&)query=([^&]*)/) || [])[1]; var reg = qr ? decodeURIComponent(qr).toUpperCase() : '';
          if (!reg) return p;
          return p.then(function (res) {
            return res.clone().json().then(function (j) {
              var resp = j && j.result && j.result.response; if (!resp) return res;
              // (FR24's own rows of flights that never took off have no flight id, and its dropdown keeps a row open by
              // that id: every such row opened and closed together, stuck open - ZZ504's two "Estimated dep" SCARB54s.
              // Each gets one of its own)
              var noId = Array.isArray(resp.data) ? resp.data.filter(function (x) { return x && x.identification && !x.identification.id; }) : [];
              if (noId.length > 1) noId.forEach(function (x, i) { x.identification.id = 'f' + ((Number(x.identification.row) || i + 1) % 0xfffffff).toString(16); });
              if (Array.isArray(resp.data) && resp.data.length > 1) return noId.length > 1 ? jsonResponse(res, j) : res;
              if (!recByReg(reg) && !hist.has(reg)) return res;
              return needHistory(reg).then(function (h) {
                if (!h || !h.data || !h.data.length) return res;
                resp.data = h.data.slice(0, 1 + Math.max(4, Number((resp.item && resp.item.limit) || 5)));
                resp.item = Object.assign({}, resp.item, { current: resp.data.length });
                resp.page = Object.assign({}, resp.page, { more: h.data.length > resp.data.length });
                stats.lists++;
                return jsonResponse(res, j);
              });
            }, function () { return res; });
          });
        }
      } catch (e) { stats.errors++; stats.lastError = String(e); }
      return p;
    };

    // ---- bridge ---------------------------------------------------------------------------------------------
    function acceptEntries(entries) {
      if (!entries) return;
      for (var i = 0; i < entries.length; i++) {
        var r = entries[i]; if (!r || r.id == null) continue;
        var hexNum = r.hex ? parseInt(String(r.hex), 16) : 0;
        var prev = resolved.get(Number(r.id));
        var photos = Array.isArray(r.photos) && r.photos.length ? r.photos : (prev && prev.photos) || [];
        resolved.set(Number(r.id), { cs: r.cs || '', reg: r.reg || '', hex: r.hex || '', type: r.type || '', desc: r.desc || '', cat: r.cat || '', mil: !!r.mil, hexNum: hexNum > 0 ? hexNum : 0, msn: r.msn || '', owner: r.owner || '', operatorId: r.operatorId > 0 ? Number(r.operatorId) : 0, operatorIcao: r.operatorIcao || '', operatorName: r.operatorName || '', age: r.age > 0 ? Math.round(r.age) : 0, ageText: r.ageText || '', countryId: r.countryId > 0 ? Number(r.countryId) : 0, squawk: r.squawk > 0 ? Number(r.squawk) : 0, photos: photos });
        if (followSt && Number(r.id) === followSt.id) pushFollowSoon();
        if (r.hex && Array.isArray(r.photos) && r.photos.length) preloadPhotos(r.photos, !!(followSt && Number(r.id) === followSt.id));
        if (r.hex && Array.isArray(r.photos) && r.photos.length) { var pc = photoCache.get(String(r.hex).toUpperCase()); photoCache.set(String(r.hex).toUpperCase(), { photos: photos, at: Date.now(), err: '', final: !!r.photoFinal || !!(pc && pc.final && pc.photos === photos) }); }
        if (r.pos && typeof r.pos.lat === 'number') { var lp = lastPos.get(Number(r.id)); if (!lp || (r.pos.at || 0) >= lp.at) lastPos.set(Number(r.id), { lat: r.pos.lat, lon: r.pos.lon, alt: r.pos.alt, gnd: !!r.pos.gnd, at: r.pos.at || Date.now() }); }
      }
    }
    // ---- FR24's adverts --------------------------------------------------------------------------------------
    // Switched off where FR24 itself decides to show them, so the page lays itself out as it does for a subscriber:
    //  - the right-hand sidebar (video advert, 300x250 slot, upgrade promos) is drawn while the 'sidebar' store's
    //    isSidebarVisible is true; pinned to false, the map, header, search and notifications use the full width
    //  - the free-trial pop-up ('freeTrialPromo' store) never becomes eligible
    //  - the JetPhotos promo slide after the photos is the JetphotosCarousel's hidePromo prop, made its default
    // The advert slots inside panels and on the data pages are hidden by the userscript's stylesheet. Nothing is kept
    // from loading: FR24 detects ad blockers by loading adsbygoogle.js, so no "ad blocker" wall appears.
    var adFree = (function () {
      var OFF = { __v_isRef: true, get value() { return false; }, set value(v) { /* stays off */ } };   // a ref Vue unwraps
      var done = new WeakSet(), st = { sidebar: 0, trial: 0, promo: 0, session: 0 };
      function store(s) {
        if (!s || done.has(s)) return;
        try {
          if (s.$id === 'sidebar') { s.isSidebarVisible = OFF; done.add(s); st.sidebar++; }
          // FR24's 30-minute "Your session has timed out" (free accounts: its 'session' store, map.timeout.mins) - set
          // back the moment its timer sets it, before the overlay is drawn
          else if (s.$id === 'session') {
            var keep = function () { try { if (s.sessionSuspended) { s.$patch({ sessionSuspended: false }); st.session++; } } catch (e) { /* ignore */ } };
            s.$subscribe(keep, { flush: 'sync', detached: true }); keep(); done.add(s);
          }
          else if (s.$id === 'freeTrialPromo') { s.hasEligibilityToShowModal = false; s.showFreeTrialModal = OFF; done.add(s); st.trial++; }
        } catch (e) { /* ignore */ }
      }
      function app(a) {
        var p = a && a.config && a.config.globalProperties && a.config.globalProperties.$pinia;
        if (!p || !p._s || done.has(p)) return;
        done.add(p);
        p._s.forEach(store);
        try { p.use(function (c) { store(c.store); }); } catch (e) { /* ignore */ }   // stores made later
      }
      // Vue writes container.__vue_app__ right after the first render and before that render's follow-up tick, which
      // is when the sidebar (inside a client-only wrapper) would first be drawn
      try {
        if (!Object.getOwnPropertyDescriptor(Element.prototype, '__vue_app__')) {
          Object.defineProperty(Element.prototype, '__vue_app__', { configurable: true, get: function () { return undefined; }, set: function (v) { Object.defineProperty(this, '__vue_app__', { value: v, writable: true, configurable: true, enumerable: true }); try { app(v); } catch (e) { /* ignore */ } } });
        }
      } catch (e) { /* ignore */ }
      function scanApps() { document.querySelectorAll('[data-v-app]').forEach(function (el) { if (el.__vue_app__) app(el.__vue_app__); }); }
      // the carousel's props are resolved against options Vue normalises once per component and shares, so its first
      // instance turns the promo off for every later one too
      function promoOff(img) {
        var host = img.closest('[data-v-app]'), root = host && host._vnode; if (!root) return;
        var stack = [root], n = 0, v, c, i;
        while (stack.length && n++ < 200000) {
          v = stack.pop(); if (!v || typeof v !== 'object') continue;
          c = v.component;
          if (c) {
            if (c.type && c.type.__name === 'JetphotosCarousel') {
              try { var o = c.propsOptions && c.propsOptions[0] && c.propsOptions[0].hidePromo; if (o && o.default !== true) { o.default = true; st.promo++; } } catch (e) { /* ignore */ }
              try { if (c.props && c.props.hidePromo !== true) c.props.hidePromo = true; } catch (e) { /* ignore */ }
            }
            if (c.subTree) stack.push(c.subTree);
            continue;
          }
          if (v.suspense) { if (v.suspense.activeBranch) stack.push(v.suspense.activeBranch); continue; }
          if (Array.isArray(v.children)) for (i = 0; i < v.children.length; i++) stack.push(v.children[i]);
        }
      }
      var PROMO = '[data-testid$="__image__promo"]';
      try {
        new MutationObserver(function (recs) {
          for (var i = 0; i < recs.length; i++) {
            var add = recs[i].addedNodes;
            for (var j = 0; j < add.length; j++) {
              var el = add[j], img = el.nodeType === 1 ? (el.matches(PROMO) ? el : el.querySelector(PROMO)) : null;
              if (img) { scanApps(); promoOff(img); return; }
            }
          }
        }).observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* ignore */ }
      scanApps();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanApps, { once: true });
      return st;
    })();
    stats.adFree = adFree;
    // "Playback" on a row of a rebuilt flight log: FR24 never recorded these flights, so its own playback has nothing to
    // show - the leg's ADS-B track is replayed on adsb.lol instead. The list FR24 renders is our data minus its first
    // entry (the flight on screen), so row i is entry i + 1; rows of FR24's own logs have no replay link and are untouched.
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('[data-testid="flight-actions__action-playback"]') : null; if (!a) return;
      var li = a.closest('li'); if (!li || !li.parentElement) return;
      var more = document.querySelector('[data-testid="aircraft-panel__recent-flights__more-flights-button"]');
      var m = more && (more.getAttribute('href') || '').match(/\/data\/aircraft\/([^\/#?]+)/i); if (!m) return;
      var h = hist.get(decodeURIComponent(m[1]).toUpperCase()); if (!h || !Array.isArray(h.data)) return;
      var entry = h.data[[].indexOf.call(li.parentElement.children, li) + 1];
      if (!entry || !entry.__tlTrace) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      window.open(entry.__tlTrace, '_blank', 'noopener');
    }, true);
    // "Playback" of a flight FR24 blocks - in the panel's menu, or on an airport board's card - finds nothing on FR24
    // ("flight was not found"): the flight's ADS-B track is replayed on airplanes.live instead. Other flights keep FR24's.
    var hhmmZ = function (t) { return new Date(t * 1000).toISOString().slice(11, 16); };
    function replayOf(rec, route) {
      var nowS = Math.floor(Date.now() / 1000), t0 = (route && (route.atd || route.departedAt)) || nowS - 3 * 3600, t1 = route && route.landed && route.ata ? route.ata : nowS;
      return 'https://globe.airplanes.live/?icao=' + encodeURIComponent(String(rec.hex).toLowerCase()) + '&showTrace=' + new Date(t0 * 1000).toISOString().slice(0, 10) + '&startTime=' + hhmmZ(t0 - 300) + '&endTime=' + hhmmZ(Math.max(t1, t0 + 600) + 300);
    }
    document.addEventListener('click', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-testid="aircraft__playback"], a, button') : null; if (!el) return;
      var inMenu = el.matches('[data-testid="aircraft__playback"]'), card = el.closest('li[id^="airport_schedule_"]');
      if (!inMenu && !(card && /^\s*playback\s*$/i.test(el.textContent || ''))) return;
      var id = 0, rec = null;
      if (inMenu) { id = curFollowId; rec = resolved.get(id) || null; }
      else {
        var row = Number(String(card.id).split('_').pop()) || 0;
        if (row >= 9000000000) { id = row - 9000000000; rec = resolved.get(id) || null; }
        if (!rec) { var regEl = card.querySelector('[data-testid="airport-flight-details__registration"]'), reg = regEl ? String(regEl.textContent || '').trim().toUpperCase() : ''; if (reg) resolved.forEach(function (r, k) { if (!rec && r.reg && r.reg.toUpperCase() === reg) { rec = r; id = k; } }); }
      }
      if (!rec || !rec.hex) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      window.open(replayOf(rec, routes.get(id)), '_blank', 'noopener');
    }, true);
    window.addEventListener('message', function (ev) {
      if (ev.source !== window || !ev.data || typeof ev.data !== 'object') return;
      var d = ev.data;
      if (d.__tweeksLadd === 'resolve') acceptEntries(d.entries);
      else if (d.__tweeksLadd === 'revoke') { for (var i = 0; i < (d.ids || []).length; i++) { resolved.delete(Number(d.ids[i])); routes.delete(Number(d.ids[i])); telem.delete(Number(d.ids[i])); } }
      else if (d.__tweeksLadd === 'route') { if (d.id != null) { if (d.route) routes.set(Number(d.id), d.route); else routes.delete(Number(d.id)); if (followSt && Number(d.id) === followSt.id) pushFollowSoon(); if (boardAffected([d.id])) refreshBoardSoon(); } }
      else if (d.__tweeksLadd === 'routes') { (d.list || []).forEach(function (x) { if (x && x.id != null) { if (x.route) routes.set(Number(x.id), x.route); else routes.delete(Number(x.id)); if (followSt && Number(x.id) === followSt.id) pushFollowSoon(); } }); if (boardAffected((d.list || []).map(function (x) { return x && x.id; }))) refreshBoardSoon(); }
      // (where flights FR24 is not drawing here were last: the monitor's - the boards of every airport list them)
      else if (d.__tweeksLadd === 'positions') {
        var chp = [];
        (d.list || []).forEach(function (x) { if (x && x.id != null && x.pos && fin(x.pos.lat)) { var k = Number(x.id), lp0 = lastPos.get(k); if (!lp0 || lp0.at < x.pos.at) { lastPos.set(k, x.pos); chp.push(k); } } });
        if (chp.length && boardAffected(chp)) refreshBoardSoon();
      }
      else if (d.__tweeksLadd === 'naBoard') {
        var ch = [];
        (d.list || []).forEach(function (x) { if (x && x.id != null && x.rec && x.route) { var k = Number(x.id); naRecs.set(k, x.rec); naRoutes.set(k, x.route); if (x.pos && (!lastPos.has(k) || lastPos.get(k).at < x.pos.at)) lastPos.set(k, x.pos); ch.push(x.id); } });
        (d.drop || []).forEach(function (id) { naRecs.delete(Number(id)); naRoutes.delete(Number(id)); ch.push(id); });
        if (ch.length && boardAffected(ch)) refreshBoardSoon();
      }
      // (new public telemetry of the flight open in the panel: drawn now, not at FR24's next frame)
      else if (d.__tweeksLadd === 'telem') { if (d.id != null && d.t) { var tt = Object.assign({ at: Date.now() }, d.t); telem.set(Number(d.id), tt); noteTelem(Number(d.id), tt); if (followSt && Number(d.id) === followSt.id) pushFollowSoon(); } }
      else if (d.__tweeksLadd === 'pubTel') acceptPubTel(d.rows);
      else if (d.__tweeksLadd === 'sites') acceptSites(d.list);
      else if (d.__tweeksLadd === 'pbRoute') { if (d.id != null) { if (d.route) pbRoutes.set(Number(d.id), d.route); else pbRoutes.delete(Number(d.id)); if (pbRoutes.size > 3000) pbRoutes.delete(pbRoutes.keys().next().value); } }
      else if (d.__tweeksLadd === 'pbTrace') { if (d.id != null && Array.isArray(d.pts)) { pbTrace = { id: Number(d.id), hex: d.hex || '', pts: d.pts }; pbRelease(); } }
      else if (d.__tweeksLadd === 'routesAdd') { if (d.apId) { routesAdd.set(Number(d.apId), d.list || []); keepApData(Number(d.apId)); routesTick(); } }
      else if (d.__tweeksLadd === 'airportPanel') acceptAirportPanel(d);
      else if (d.__tweeksLadd === 'searchAdd') onSearchAdd(d);
      else if (d.__tweeksLadd === 'airportData') { if (d.apId) { var ad = apDataOf(Number(d.apId)); if (d.runways) ad.runways = d.runways; if (d.board) ad.board = d.board; keepApData(Number(d.apId)); routesTick(); } }
      else if (d.__tweeksLadd === 'hist') {
        var reg = String(d.reg || '').toUpperCase(); if (!reg) return;
        if (d.data) hist.set(reg, { data: d.data, at: Date.now(), partial: !!d.partial });
        // a first answer that is still loading and has nothing to list yet (FR24 hides the first entry, the flight on
        // screen) is not handed over: FR24 draws the list once, so it waits for the full log instead
        if (d.partial && !(d.data && d.data.length > 1)) return;
        var w = histWait.get(reg) || []; histWait.delete(reg); w.forEach(function (fn) { try { fn(hist.get(reg) || null); } catch (e) { /* ignore */ } });
      }
      else if (d.__tweeksLadd === 'boardArch') acceptBoardArch(d);
      else if (d.__tweeksLadd === 'needTrail') bgFollowTrail(Number(d.id) || 0);
      else if (d.__tweeksLadd === 'pubIds') { (d.rows || []).forEach(function (r) { if (r && r[0]) pubIds.set(String(r[0]).toUpperCase(), { o: r[1] || '', a: Number(r[2]) || 0, m: r[3] || '', c: Number(r[4]) || 0 }); }); if (pubIds.size > 30000) { var drop = pubIds.size - 25000; pubIds.forEach(function (v, k) { if (drop-- > 0) pubIds.delete(k); }); } }
      else if (d.__tweeksLadd === 'photoReq') { if (d.hex) fetchPhotos(d.hex, d.reg, !!d.pri); }
      // (OpenStreetMap's Overpass answers a browser's own request; the userscript asks it through here)
      else if (d.__tweeksLadd === 'osmReq') { if (d.key && /^https:\/\/overpass-api\.de\/api\/interpreter\?data=/.test(String(d.url || ''))) oFetch.call(window, d.url).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { post('osmRes', { key: d.key, j: j }); }, function () { post('osmRes', { key: d.key, j: null }); }); }
      else if (d.__tweeksLadd === 'photosDone') acceptPhotosDone(d);
      else if (d.__tweeksLadd === 'scan') runScan(d.regions || [], d.opts || {});
      else if (d.__tweeksLadd === 'hello') post('ready', { stats: stats, feedReady: !!feedHeaders, hdr: feedHdrPublic(), v: BRIDGE_V });
    });
    window[NS] = { resolved: resolved, routes: routes, naRecs: naRecs, naRoutes: naRoutes, telem: telem, hist: hist, lastPos: lastPos, photoCache: photoCache, psCache: psCache, stats: stats, fetchPhotos: fetchPhotos, hello: function () { post('ready', { stats: stats, feedReady: !!feedHeaders, v: BRIDGE_V }); }, v: BRIDGE_V };
    if (window.__tlTestHook) try { window.__tlTestHook({ csOf: csOf, hist: hist, preloaded: function () { return preloaded; }, parse: parse, photoFits: photoFits, makerOf: makerOf, patchFollow: patchFollow, patchFlightMsg: patchFlightMsg, pushFollow: pushFollow, followSt: function () { return followSt; }, setFollowSt: function (s) { followSt = s; }, shownPhotos: shownPhotos, photoCache: photoCache, FOLLOW: FOLLOW, DETAILS: DETAILS, fLen: fLen, fStr: fStr, fVar: fVar, patchFlight: patchFlight, psState: function () { return { q: psQ.length, busy: psBusy, last: psLast, blockedFor: Math.max(0, psBlockedUntil - Date.now()), pri: Array.from(psPri), jobs: photoJobs.size, head: psQ.slice(0, 3).map(function (j) { return j.hex; }) }; }, acceptPubTel: acceptPubTel, pubTelFor: pubTelFor, fillNativeCard: fillNativeCard, regsOfCallsign: regsOfCallsign, categoryOf: categoryOf, nativeFill: nativeFill, natInfo: natInfo, telem: telem, b64Encode: b64Encode, b64DecodeInto: b64DecodeInto, frameHeader: frameHeader, concat: concat, varintInt32: varintInt32, PLAYBACK: PLAYBACK, patchPlayback: patchPlayback, patchPlaybackRequest: patchPlaybackRequest, pbRoutes: pbRoutes, pbTelAt: pbTelAt, setPbTrace: function (t) { pbTrace = t; }, patchList: patchList, acceptSites: acceptSites, listSig: listSig, mergeRoutes: mergeRoutes, applyRoutes: applyRoutes, routesAdd: routesAdd, applyAirport: applyAirport, applyBoardPage: applyBoardPage, applyStats: applyStats, mergeFlights: mergeFlights, apData: apData, telAt: telAt, noteTelem: noteTelem, pbTraceOf: function () { return pbTrace; }, logoOf: logoOf, archDetail: archDetail, tsOf: tsOf, noteAirportJson: noteAirportJson, rwyOf: rwyOf, rwyPanel: rwyPanel, panelTick: panelTick, panelData: panelData, promoSlots: promoSlots, acceptAirportPanel: acceptAirportPanel, unlockRunways: unlockRunways, mvRows: mvRows, mvKept: mvKept, dayOf: dayOf, pbPanelTick: pbPanelTick, logoFix: logoFix, liveEntries: liveEntries, pbPos: pbPos, lastPos: lastPos, resolved: resolved, stats: stats }); } catch (e) { /* ignore */ }
    post('ready', { stats: stats, feedReady: false, v: BRIDGE_V });
  }
