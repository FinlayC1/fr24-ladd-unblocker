// In-browser test harness: emulates a userscript manager (GM_xmlhttpRequest via the local relay) and runs the build.
(async function () {
  const RELAY = 'http://127.0.0.1:8765';
  window.__tlGmLog = [];
  window.GM_xmlhttpRequest = function (o) {
    const t0 = Date.now();
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), o.timeout || 20000);
    fetch(RELAY + '/p?u=' + encodeURIComponent(o.url), { signal: ctl.signal }).then(r => r.text().then(t => {
      clearTimeout(timer); window.__tlGmLog.push([o.url.slice(0, 120), r.status, Date.now() - t0]);
      o.onload && o.onload({ status: r.status, responseText: t, response: t });
    })).catch(e => { clearTimeout(timer); window.__tlGmLog.push([o.url.slice(0, 120), 'ERR ' + e, Date.now() - t0]); (e.name === 'AbortError' ? o.ontimeout : o.onerror) && (e.name === 'AbortError' ? o.ontimeout() : o.onerror({ error: String(e) })); });
    return { abort() { ctl.abort(); } };
  };
  window.unsafeWindow = window;
  const src = await fetch(RELAY + '/script').then(r => r.text());
  // eslint-disable-next-line no-new-func
  new Function(src)();
  return 'harness loaded ' + src.length;
})();
