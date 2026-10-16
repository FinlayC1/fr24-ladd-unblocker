// FR24 LADD Unblocker - browser extension (Manifest V3): the service worker (Firefox: the background script). It makes
// the content script's requests to other sites (see shim.js) - only to the hosts the manifest grants, nothing else - and answers each with its status and
// body (text, or base64 for binary files such as adsb.lol's heatmaps).
const toB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'tl-xhr') return;
  const running = new Map();   // request id -> AbortController
  const send = m => { try { port.postMessage(m); } catch (e) { /* the tab is gone */ } };
  port.onMessage.addListener(async m => {
    if (m.abort) { const c = running.get(m.abort); if (c) c.abort(); return; }
    const ctl = new AbortController(); running.set(m.id, ctl);
    let timedOut = false;
    const t = m.timeout > 0 ? setTimeout(() => { timedOut = true; ctl.abort(); }, m.timeout) : 0;
    try {
      const r = await fetch(m.url, { method: m.method, headers: m.headers, body: m.data == null || /^(GET|HEAD)$/i.test(m.method) ? undefined : m.data, signal: ctl.signal, credentials: 'include', redirect: 'follow' });
      const headers = [...r.headers].map(([k, v]) => k + ': ' + v).join('\r\n');
      if (m.binary) send({ id: m.id, status: r.status, statusText: r.statusText, url: r.url, headers, b64: toB64(new Uint8Array(await r.arrayBuffer())) });
      else send({ id: m.id, status: r.status, statusText: r.statusText, url: r.url, headers, text: await r.text() });
    } catch (e) { send({ id: m.id, error: timedOut ? 'timeout' : String(e && e.message || e), timeout: timedOut }); }
    finally { clearTimeout(t); running.delete(m.id); }
  });
  port.onDisconnect.addListener(() => { for (const c of running.values()) c.abort(); running.clear(); });
});
// A monitor of the user's own (the LADD Unblock window's Data sources) at an address the manifest does not list: the browser asks the user to
// allow it, on the extension's own page (grant.html) - only a click there may grant a host. Answered true when it is
// allowed already.
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || typeof m.tlGrant !== 'string') return;
  let origin = '';
  try { const u = new URL(m.tlGrant); if (u.protocol === 'https:' && u.origin === m.tlGrant) origin = u.origin; } catch (e) { /* not an address */ }
  if (!origin) { reply(false); return; }
  chrome.permissions.contains({ origins: [origin + '/*'] }, has => {
    if (!has) chrome.tabs.create({ url: chrome.runtime.getURL('grant.html') + '#' + encodeURIComponent(origin) });
    reply(!!has);
  });
  return true;
});
// The LADD Unblock window's Updates: "Reload extension" loads it again from its folder (an unpacked one, after its files
// were replaced with a new version); a store install is asked to look for its update now - and restarts with one found.
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || sender.id !== chrome.runtime.id) return;
  // (Firefox 140 and up lists the data an add-on may send, granted by the person: the optional "technicalAndInteraction" is
  // what the count of installs sends - true / false; null in a browser that keeps no such list. 'ask': where it is not
  // allowed, the extension's page with the button that asks Firefox - only a click may ask - is opened)
  if (m.tlConsent === 'check' || m.tlConsent === 'ask') {
    try {
      chrome.permissions.getAll(p => {
        void chrome.runtime.lastError;
        const dc = p && p.data_collection, has = Array.isArray(dc) ? dc.includes('technicalAndInteraction') : null;
        if (has === false && m.tlConsent === 'ask') chrome.tabs.create({ url: chrome.runtime.getURL('grant.html') + '#consent' });
        reply(has);
      });
    } catch (e) { reply(null); }
    return true;
  }
  if (m.tlReload === true) { reply(true); setTimeout(() => chrome.runtime.reload(), 150); return; }
  if (m.tlUpdateCheck === true) {
    // (Firefox has no such call: it looks for updates on addons.mozilla.org by itself)
    if (typeof chrome.runtime.requestUpdateCheck !== 'function') { reply('unsupported'); return; }
    try { chrome.runtime.requestUpdateCheck((status) => { reply(status); if (status === 'update_available') setTimeout(() => chrome.runtime.reload(), 500); }); } catch (e) { reply('unsupported'); }
    return true;
  }
});
