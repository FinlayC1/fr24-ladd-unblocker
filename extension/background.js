// FR24 LADD Unblocker - browser extension (Manifest V3): the service worker. It makes the content script's requests to
// other sites (see shim.js) - only to the hosts the manifest grants, nothing else - and answers each with its status and
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
