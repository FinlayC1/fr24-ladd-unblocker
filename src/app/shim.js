// FR24 LADD Unblocker - the Android app (android/app): the script's preamble there.
// The app shows FR24's own site, full-screen, in a WebView of its own, and puts this - then the page part (src/page.js),
// then the script itself - into each FR24 page at document start, before FR24's code runs (dist/app/app.js, build.mjs;
// FR24's top frame only, as the userscript's @noframes). What a userscript manager would give the script comes from the
// app's Java side, over TLNative: a bridge the app gives FR24's own pages only (MainActivity.java), taken here and then
// taken out of the page's globals - nothing FR24 or anything else in its page loads after this can reach it; what is
// below is in the closure build.mjs puts it in, not the page's either. Each message is a JSON string, its ids this
// page's own (page id + count: no answer of a page before a reload is taken for this one's):
//   GM_xmlhttpRequest   { t: 'req', id, url, method, headers, data, timeout, binary } -> { t: 'res', id, status ... } -
//                       requests to the other sites (adsb.lol, adsb.fi, the monitor ...), made by the app: https only,
//                       to the hosts the script's header lists (@connect) and those allowed below, with the app's own
//                       cookies for them - as the browser extension's are made. { t: 'abort', id }
//   GM_notification     { t: 'notify', id, title, text } - the phone's own notification; { t: 'click', id } back when
//                       it is tapped
//   TL_HOST_ACCESS      { t: 'grant', id, origin } -> { t: 'granted', id, ok } - a monitor of the user's own, at an
//                       address the header does not list: the app asks the user, as the browser extension does
//   saving a file       { t: 'save', name, mime, b64 } - a CSV of an aircraft's flights, or anything else the page saves
//                       from a blob: or data: address (which a WebView cannot download by itself) - into Downloads
//   GM_info, TL_APP     which "manager" this is, and that it is the app; TL_APP.update(): { t: 'update' } - the app looks
//                       for its new version and installs it (1.3.12)
//   the location        { t: 'geo', id, high, timeout, maxAge } -> { t: 'geo', id, ok, lat, lon, ... | code, message } -
//                       the page's navigator.geolocation (FR24's "my location"), asked of Android by the app (1.3.12);
//                       { t: 'geoState', id } -> { t: 'geoState', id, state } for navigator.permissions
//   FR24's "open in app" pill and banner are not shown: this is the app (1.3.12)
/* eslint-disable no-unused-vars, no-var, no-redeclare */
/* global TLNative */
// (1.3.12: the iPhone app - ios/ - puts the same script in with the same bridge; its preamble says which it is)
var TL_APP = { v: 2, platform: typeof window.__tlAppPlatform === 'string' && window.__tlAppPlatform === 'ios' ? 'ios' : 'android', update: function () { try { TL_BRIDGE.send({ t: 'update' }); return true; } catch (e) { return false; } } };
var GM_info = { scriptHandler: TL_APP.platform === 'ios' ? 'ios-app' : 'android-app', version: '1', script: { name: 'FR24 LADD Unblocker' } };
var TL_BRIDGE = (function () {
  var b = null; try { b = typeof TLNative !== 'undefined' && TLNative && typeof TLNative.postMessage === 'function' ? TLNative : null; } catch (e) { b = null; }
  try { delete window.TLNative; } catch (e) { /* kept: the app still answers this page only, and only for the hosts above */ }
  var handlers = {}, page = Math.random().toString(36).slice(2, 10);
  function onMessage(ev) {
    var m = null; try { m = JSON.parse(ev && ev.data); } catch (e) { return; }
    var h = m && typeof m.t === 'string' && handlers[m.t]; if (!h) return;
    try { h(m); } catch (e) { /* the handler's own */ }
  }
  if (b) { if (typeof b.addEventListener === 'function') b.addEventListener('message', onMessage); else b.onmessage = onMessage; }
  return {
    ok: !!b,
    send: function (o) { if (!b) throw new Error('the app\'s bridge is not here'); b.postMessage(JSON.stringify(o)); },
    on: function (t, f) { handlers[t] = f; },
    id: function (n) { return page + '.' + n; }
  };
})();
var GM_xmlhttpRequest = (function () {
  var seq = 0, pending = new Map();
  function b64ToBuf(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  TL_BRIDGE.on('res', function (m) {
    var o = pending.get(m.id); if (!o) return;
    pending.delete(m.id);
    try {
      if (m.error) { if (m.timeout && o.ontimeout) o.ontimeout({}); else if (o.onerror) o.onerror({ status: 0, error: m.error }); return; }
      var response = m.b64 != null ? b64ToBuf(m.b64) : m.text;
      if (o.onload) o.onload({ status: m.status, statusText: m.statusText || '', responseText: m.b64 != null ? '' : m.text, response: response, finalUrl: m.url || o.url, responseHeaders: m.headers || '', readyState: 4 });
    } catch (e) { /* the caller's */ }
  });
  return function (o) {
    var id = TL_BRIDGE.id(++seq); pending.set(id, o);
    try {
      TL_BRIDGE.send({ t: 'req', id: id, url: String(o.url), method: o.method || 'GET', headers: o.headers || {}, data: o.data == null ? null : String(o.data), timeout: o.timeout || 0, binary: o.responseType === 'arraybuffer' });
    } catch (e) { pending.delete(id); setTimeout(function () { if (o.onerror) o.onerror({ status: 0, error: String(e && e.message || e) }); }, 0); }
    return { abort: function () { if (pending.delete(id)) { try { TL_BRIDGE.send({ t: 'abort', id: id }); } catch (e) { /* gone */ } try { if (o.onabort) o.onabort({}); } catch (e) { /* the caller's */ } } } };
  };
})();
var GM_notification = (function () {
  var seq = 0, clicks = new Map();
  TL_BRIDGE.on('click', function (m) { var f = clicks.get(m.id); if (f) { clicks.delete(m.id); try { f(); } catch (e) { /* the caller's */ } } });
  // (either form a manager takes: GM_notification({ title, text, onclick }) or GM_notification(text, title, image, onclick))
  return function (a, b, c, d) {
    var o = a && typeof a === 'object' ? a : { text: a, title: b, image: c, onclick: d };
    var id = TL_BRIDGE.id(++seq); if (typeof o.onclick === 'function') { clicks.set(id, o.onclick); if (clicks.size > 50) clicks.delete(clicks.keys().next().value); }
    try { TL_BRIDGE.send({ t: 'notify', id: id, title: String(o.title || 'FR24 LADD Unblocker').slice(0, 200), text: String(o.text || '').slice(0, 1000) }); } catch (e) { /* no bridge */ }
  };
})();
var TL_HOST_ACCESS = (function () {
  var seq = 0, waiting = new Map();
  TL_BRIDGE.on('granted', function (m) { var f = waiting.get(m.id); if (f) { waiting.delete(m.id); f(m.ok === true); } });
  return function (origin) {
    return new Promise(function (res) {
      var id = TL_BRIDGE.id(++seq); waiting.set(id, res);
      try { TL_BRIDGE.send({ t: 'grant', id: id, origin: String(origin) }); } catch (e) { waiting.delete(id); res(false); }
    });
  };
})();
// (a file the page saves from a blob: or data: address - the script's CSV of an aircraft's flights: a link with a download
// name, clicked - read here and handed to the app, which puts it in Downloads. Both ways a page clicks one: by script,
// a.click() - on a link in the page or not - and by the user's own tap)
(function () {
  var MAX = 25 * 1024 * 1024;
  function wanted(a) { try { return !!(a && a.hasAttribute && a.hasAttribute('download') && /^(blob|data):/i.test(String(a.href || ''))); } catch (e) { return false; } }
  function save(a) {
    var name = String(a.getAttribute('download') || '') || 'download';
    fetch(a.href).then(function (r) { return r.blob(); }).then(function (blob) {
      if (blob.size > MAX) return;
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result)); }; fr.onerror = rej; fr.readAsDataURL(blob); }).then(function (url) {
        var i = url.indexOf(','); TL_BRIDGE.send({ t: 'save', name: name, mime: blob.type || 'application/octet-stream', b64: i >= 0 ? url.slice(i + 1) : '' });
      });
    }).catch(function () { /* nothing saved */ });
  }
  if (!TL_BRIDGE.ok) return;
  try {
    var oClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (wanted(this)) { save(this); return; } return oClick.apply(this, arguments); };
  } catch (e) { /* the page's own clicks only */ }
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (wanted(a)) { ev.preventDefault(); save(a); }
  }, true);
})();
// (1.3.12) the phone's location - FR24's "my location" on its map, the airports nearest you in its search: asked of
// Android by the app (android/app Geo.java), not of the WebView's own, which waited for good on some phones (FR24's
// button spun and never moved the map). The page's navigator.geolocation answers from it, as the browser's does
(function () {
  if (!TL_BRIDGE.ok) return;
  var geo = null; try { geo = navigator.geolocation; } catch (e) { geo = null; }
  if (!geo) return;
  var seq = 0, waiting = new Map(), watches = new Map(), wseq = 0;
  TL_BRIDGE.on('geo', function (m) { var f = waiting.get(m.id); if (f) { waiting.delete(m.id); f(m); } });
  TL_BRIDGE.on('geoState', function (m) { var f = waiting.get(m.id); if (f) { waiting.delete(m.id); f(m); } });
  var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };
  function position(m) {
    var c = { latitude: m.lat, longitude: m.lon, accuracy: num(m.acc) == null ? 1000 : m.acc, altitude: num(m.alt), altitudeAccuracy: num(m.altAcc), heading: num(m.heading), speed: num(m.speed) };
    c.toJSON = function () { return { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy, altitude: c.altitude, altitudeAccuracy: c.altitudeAccuracy, heading: c.heading, speed: c.speed }; };
    var p = { coords: c, timestamp: num(m.ts) || Date.now() };
    p.toJSON = function () { return { coords: c.toJSON(), timestamp: p.timestamp }; };
    return p;
  }
  function failure(code, message) { return { code: code, message: String(message || ''), PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }; }
  function ask(opts, ok, fail) {
    var o = opts && typeof opts === 'object' ? opts : {}, id = TL_BRIDGE.id(++seq);
    var to = typeof o.timeout === 'number' && isFinite(o.timeout) && o.timeout >= 0 ? o.timeout : 0;
    var age = typeof o.maximumAge === 'number' && isFinite(o.maximumAge) && o.maximumAge > 0 ? o.maximumAge : 0;
    waiting.set(id, function (m) {
      try { if (m.ok && num(m.lat) != null && num(m.lon) != null) { if (typeof ok === 'function') ok(position(m)); } else if (typeof fail === 'function') fail(failure(m.code === 1 || m.code === 3 ? m.code : 2, m.message)); } catch (e) { /* the page's own */ }
    });
    try { TL_BRIDGE.send({ t: 'geo', id: id, high: !!o.enableHighAccuracy, timeout: to, maxAge: age }); }
    catch (e) { waiting.delete(id); setTimeout(function () { if (typeof fail === 'function') fail(failure(2, 'no location')); }, 0); }
  }
  try {
    geo.getCurrentPosition = function (ok, fail, opts) { ask(opts, ok, fail); };
    // (watched: asked again five seconds after each answer - a quarter of a minute after a failure - until cleared)
    geo.watchPosition = function (ok, fail, opts) {
      var w = ++wseq, live = { on: true, t: 0 };
      watches.set(w, live);
      var tick = function () {
        if (!live.on) return;
        ask(opts, function (p) { if (!live.on) return; if (typeof ok === 'function') ok(p); live.t = setTimeout(tick, 5000); },
          function (e) { if (!live.on) return; if (typeof fail === 'function') fail(e); live.t = setTimeout(tick, 15000); });
      };
      tick();
      return w;
    };
    geo.clearWatch = function (w) { var l = watches.get(w); if (l) { l.on = false; clearTimeout(l.t); watches.delete(w); } };
  } catch (e) { /* the WebView's own, as before */ }
  // (FR24 asks whether it may before it asks where - its nearest airports: "granted" once the app may)
  try {
    var perms = navigator.permissions, oQuery = perms && perms.query;
    if (typeof oQuery === 'function') {
      perms.query = function (d) {
        if (!(d && d.name === 'geolocation')) return oQuery.apply(perms, arguments);
        return new Promise(function (res) {
          var id = TL_BRIDGE.id(++seq), done = false;
          var give = function (state) { if (done) return; done = true; res({ name: 'geolocation', state: state, onchange: null, addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; } }); };
          waiting.set(id, function (m) { give(m.state === 'granted' ? 'granted' : 'prompt'); });
          try { TL_BRIDGE.send({ t: 'geoState', id: id }); } catch (e) { waiting.delete(id); give('prompt'); }
          setTimeout(function () { waiting.delete(id); give('prompt'); }, 3000);
        });
      };
    }
  } catch (e) { /* the WebView's own */ }
})();
// (1.4.0) "Map drawing: compatible mode" (the LADD Unblock window, the app only; off by default): FR24's map drawn in
// WebGL - its aircraft, airport pins and their shadows (deck.gl, luma.gl) - asked for without keeping its last picture
// (preserveDrawingBuffer) and without smoothing its edges (antialias): both a phone's graphics can get wrong, pieces of
// the pictures before left on screen as the map zooms. Read from the window's switches as this page starts
(function () {
  var on = false; try { var o = JSON.parse(localStorage.getItem('tweeks.fr24.ladd.opts1') || 'null'); on = !!(o && o.on !== false && o.mapCompat === true); } catch (e) { on = false; }
  if (!on) return;
  try {
    var C = window.HTMLCanvasElement && HTMLCanvasElement.prototype, oGet = C && C.getContext;
    if (typeof oGet !== 'function') return;
    C.getContext = function (kind) {
      if (kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl') {
        var a = arguments[1] && typeof arguments[1] === 'object' ? arguments[1] : {}, b = {}; for (var k in a) b[k] = a[k];
        b.preserveDrawingBuffer = false; b.antialias = false;
        return oGet.call(this, kind, b);
      }
      return oGet.apply(this, arguments);
    };
  } catch (e) { /* the WebView's own */ }
})();
// (1.3.12) FR24's "Open in app" pill on its map and its "Get the best flight tracking experience using our app" banner on
// its data pages: this is the app - neither is shown
(function () {
  var css = '#open-in-app-banner{display:none!important}' +
    '.rounded-full.bg-yellow-500:has(> button.whitespace-nowrap + .w-px + button){display:none!important}';
  var put = function () {
    if (document.getElementById('tl-app-style')) return true;
    var host = document.head || document.documentElement; if (!host) return false;
    var st = document.createElement('style'); st.id = 'tl-app-style'; st.textContent = css; host.appendChild(st);
    return true;
  };
  if (!put()) document.addEventListener('DOMContentLoaded', put, { once: true });
  // (moved into the page's head once it has one - kept when FR24 writes its head)
  document.addEventListener('DOMContentLoaded', function () { var st = document.getElementById('tl-app-style'); if (st && document.head && st.parentNode !== document.head) document.head.appendChild(st); }, { once: true });
})();
