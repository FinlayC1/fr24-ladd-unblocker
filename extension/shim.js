// FR24 LADD Unblocker - browser extension (Chrome / Edge / Firefox, Manifest V3): the content script's preamble.
// The script itself is the same as the Tampermonkey userscript; it was written against a userscript manager's API, so
// the two things it needs from one are given here:
//   GM_xmlhttpRequest  requests to the other sites (adsb.lol, adsb.fi, the monitor, registers...) - a content script is
//                      bound by the page's cross-origin rules, so they go through the extension's service worker
//                      (background.js), which may reach exactly the hosts the manifest lists
//   TL_EXTENSION       tells the script the page-world part (page.js) is already in the page - the manifest puts it there
//                      at document start, in the page's own world, before FR24's code runs
/* eslint-disable no-unused-vars */
const TL_EXTENSION = true;
const GM_xmlhttpRequest = (() => {
  let port = null, seq = 0;
  const pending = new Map();   // request id -> the caller's options (its callbacks)
  const fail = (o, err) => { try { if (o.onerror) o.onerror({ status: 0, error: err }); } catch (e) { /* the caller's */ } };
  function onMessage(m) {
    const o = pending.get(m.id); if (!o) return;
    pending.delete(m.id);
    try {
      if (m.error) { if (m.timeout && o.ontimeout) o.ontimeout({}); else fail(o, m.error); return; }
      let response = m.text;
      if (m.b64 != null) { const bin = atob(m.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); response = u.buffer; }
      if (o.onload) o.onload({ status: m.status, statusText: m.statusText || '', responseText: m.b64 != null ? '' : m.text, response, finalUrl: m.url || o.url, responseHeaders: m.headers || '', readyState: 4 });
    } catch (e) { /* the caller's */ }
  }
  function connect() {
    port = chrome.runtime.connect({ name: 'tl-xhr' });
    port.onMessage.addListener(onMessage);
    // (the service worker stopped - the browser ends idle ones - with requests on the way: they failed, the next reconnects)
    port.onDisconnect.addListener(() => { port = null; const l = [...pending.values()]; pending.clear(); for (const o of l) fail(o, 'extension restarted'); });
  }
  return function (o) {
    const id = ++seq; pending.set(id, o);
    try {
      if (!port) connect();
      port.postMessage({ id, url: String(o.url), method: o.method || 'GET', headers: o.headers || {}, data: o.data == null ? null : String(o.data), timeout: o.timeout || 0, binary: o.responseType === 'arraybuffer' });
    } catch (e) { pending.delete(id); setTimeout(() => fail(o, String(e && e.message || e)), 0); }
    return { abort() { if (pending.delete(id)) { try { if (port) port.postMessage({ abort: id }); } catch (e) { /* closed */ } try { if (o.onabort) o.onabort({}); } catch (e) { /* the caller's */ } } } };
  };
})();
// (a monitor of the user's own at an address the manifest does not list: may the extension reach it? - asked of the
// service worker, which opens the page where the user allows it when not; resolves true when it is allowed already)
const TL_HOST_ACCESS = origin => new Promise(res => { try { chrome.runtime.sendMessage({ tlGrant: origin }, ok => { void chrome.runtime.lastError; res(!!ok); }); } catch (e) { res(false); } });
