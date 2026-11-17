// FR24 LADD Unblocker - FR24's Android app (the LSPosed module, android/): the hidden page's preamble.
// The module runs the very script the browser extension runs, in a page of its own inside FR24's app process (a WebView
// FR24 never shows), with FR24's address as the page's - so the script does there what it does on FR24's website, and the
// module hands it FR24's own gRPC messages (src/page.js window.__tlApp). What a userscript manager would give it, given here
// by the module's Java side (TLNative, android/module .../Runtime.java):
//   TL_MOBILE           the module's settings and FR24's version: { v, app, mon: { url, token } | { off } | null }
//   GM_xmlhttpRequest   requests to the other sites (adsb.lol, adsb.fi, the monitor, registers...) - made by the app's
//                       process, so no page's cross-origin rules apply
//   GM_info             which "manager" this is, for the script's own count of installs
//   __tlAppRun(id)      the module's call for one message: read it (TLNative.take), patch it, give it back (TLNative.done)
// A page nobody sees gets no frames and no idle time from the browser, and says it is hidden: the timers the script
// relies on for those are given here, and the page says it is in view.
/* eslint-disable no-unused-vars, no-var, no-redeclare */
/* global TLNative */
var TL_MOBILE = (function () {
  try { var c = JSON.parse(TLNative.config()); return c && typeof c === 'object' ? c : { v: 1 }; } catch (e) { return { v: 1 }; }
})();
var GM_info = { scriptHandler: 'FR24 app module', version: String(TL_MOBILE.module || ''), script: { name: 'FR24 LADD Unblocker', version: String(TL_MOBILE.module || '') } };
var GM_xmlhttpRequest = (function () {
  var seq = 0, pending = new Map();
  function b64ToBuf(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  // (the Java side says an answer is in; it is read from there - an answer can be megabytes, never written into a script:
  // { status, statusText, url, headers, text } or { b64 } for bytes, or { error, timeout })
  window.__tlNet = function (id) {
    var o = pending.get(id); if (!o) { try { TLNative.result(id); } catch (e) { /* gone */ } return; }
    pending.delete(id);
    var m; try { m = JSON.parse(TLNative.result(id) || 'null') || { error: 'no answer' }; } catch (e) { m = { error: 'bad answer' }; }
    try {
      if (m.error) { if (m.timeout && o.ontimeout) o.ontimeout({}); else if (o.onerror) o.onerror({ status: 0, error: m.error }); return; }
      var response = m.b64 != null ? b64ToBuf(m.b64) : m.text;
      if (o.onload) o.onload({ status: m.status, statusText: m.statusText || '', responseText: m.b64 != null ? '' : m.text, response: response, finalUrl: m.url || o.url, responseHeaders: m.headers || '', readyState: 4 });
    } catch (e) { /* the caller's */ }
  };
  return function (o) {
    var id = ++seq; pending.set(id, o);
    try {
      TLNative.request(id, JSON.stringify({ url: String(o.url), method: o.method || 'GET', headers: o.headers || {}, data: o.data == null ? null : String(o.data), timeout: o.timeout || 0, binary: o.responseType === 'arraybuffer' }));
    } catch (e) { pending.delete(id); setTimeout(function () { if (o.onerror) o.onerror({ status: 0, error: String(e && e.message || e) }); }, 0); }
    return { abort: function () { if (pending.delete(id)) { try { TLNative.abort(id); } catch (e) { /* gone */ } try { if (o.onabort) o.onabort({}); } catch (e) { /* the caller's */ } } } };
  };
})();
// (a page nobody sees: in view, as far as the script can tell - it slows or stops what it does in a hidden tab)
(function () {
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } }); } catch (e) { /* kept */ }
  try { Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } }); } catch (e) { /* kept */ }
  // (no frames and no idle time for a page that is not drawn: both on a timer)
  var ric = function (cb) { return setTimeout(function () { var t0 = Date.now(); cb({ didTimeout: false, timeRemaining: function () { return Math.max(0, 12 - (Date.now() - t0)); } }); }, 1); };
  window.requestIdleCallback = ric; window.cancelIdleCallback = function (h) { clearTimeout(h); };
  window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
  window.cancelAnimationFrame = function (h) { clearTimeout(h); };
})();
// (the module's call for one message: TLNative.take(id) -> { d: 'req' | 'resp', m: the gRPC method, b: base64 }; the bytes
// given back by TLNative.done(id, base64) - '' when they are as they came, or nothing could be done with them)
window.__tlAppRun = function (id) {
  var out = '';
  try {
    var j = JSON.parse(TLNative.take(id) || 'null'), app = window.__tlApp;
    if (j && app && (j.d === 'req' || j.d === 'resp')) {
      var bin = atob(j.b), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var r = app[j.d](j.m, u);
      if (r && r !== u && r.length) { var s = '', CH = 0x8000; for (var k = 0; k < r.length; k += CH) s += String.fromCharCode.apply(null, r.subarray(k, k + CH)); out = btoa(s); }
    }
  } catch (e) { out = ''; }
  try { TLNative.done(id, out); } catch (e) { /* gone */ }
};
// (the page part (src/page.js) is put in by the script itself, a moment after it starts: the module is told once it is
// there - until then FR24's messages pass as they come)
(function () {
  var n = 0, t = setInterval(function () {
    if (window.__tlApp && window.__tlApp.v) { clearInterval(t); try { TLNative.ready(String(window.__tlApp.v)); } catch (e) { /* gone */ } }
    else if (++n > 600) clearInterval(t);
  }, 100);
})();
