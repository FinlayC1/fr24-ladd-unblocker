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

// ---- updating an unpacked extension in place (update.html) -------------------------------------------------------------
// Update on Flightradar24 opens the extension's update page next to the tab it was clicked in. When the new files are in
// the folder, "Refresh page" (there or on FR24's banner) restarts the extension from its folder; the new version, when it
// starts, loads that FR24 tab again. Had the version not changed, the files went to a folder Chrome does not load it from:
// the update page is opened again to say so.
function kv(mode, fn) {
  return new Promise((res, rej) => {
    const o = indexedDB.open('tl-update', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('kv');
    o.onerror = () => rej(o.error);
    o.onsuccess = () => {
      const db = o.result, tx = db.transaction('kv', mode), r = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { db.close(); res(r && r.result); };
      tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); };
    };
  });
}
const kvGet = k => kv('readonly', s => s.get(k)), kvSet = (k, v) => kv('readwrite', s => s.put(v, k)), kvDel = k => kv('readwrite', s => s.delete(k));
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || sender.id !== chrome.runtime.id) return;
  if (m.tlSelfUpdate === true) {
    const t = sender.tab;
    chrome.tabs.create({ url: chrome.runtime.getURL('update.html') + (t && t.id >= 0 ? '#tab=' + t.id : ''), index: t ? t.index + 1 : undefined, openerTabId: t ? t.id : undefined }, tab => { void chrome.runtime.lastError; reply(!!tab); });
    return true;
  }
  if (m.tlRestart === true) {
    const tab = m.tab > 0 ? m.tab : sender.tab && sender.tab.id >= 0 ? sender.tab.id : 0;
    kvGet('pending').catch(() => null).then(p => kvSet('pending', Object.assign({ expect: '', at: Date.now() }, p || {}, { tab: tab || (p && p.tab) || 0, restart: true })))
      .catch(() => {}).then(() => { reply(true); setTimeout(() => chrome.runtime.reload(), 150); });
    return true;
  }
});
// (looked at each time the extension starts: after a restart for an update, once)
chrome.runtime.onInstalled.addListener(() => {});
(async () => {
  let p = null; try { p = await kvGet('pending'); } catch (e) { return; }
  if (!p) return;
  const v = chrome.runtime.getManifest().version, fresh = Date.now() - (p.at || 0) < 6 * 3600e3;
  if (!p.restart || !fresh) { if (!fresh || !p.expect || v === p.expect) await kvDel('pending').catch(() => {}); return; }
  await kvDel('pending').catch(() => {});
  const tab = p.tab > 0 ? p.tab : 0;
  if (!p.expect || v === p.expect) { if (tab) { chrome.tabs.update(tab, { active: true }, () => void chrome.runtime.lastError); chrome.tabs.reload(tab, () => void chrome.runtime.lastError); } }
  else chrome.tabs.create({ url: chrome.runtime.getURL('update.html') + '#wrong' + (tab ? '&tab=' + tab : '') }, () => void chrome.runtime.lastError);
})();
