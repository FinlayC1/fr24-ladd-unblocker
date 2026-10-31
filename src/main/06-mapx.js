  // ---- (1.2.0) FR24's locked map options: what the page part fetches through here ------------------------------------
  // The page part draws FR24's weather layers, current weather, AIRMETs/SIGMETs and oceanic tracks from free sources it
  // cannot reach itself (other sites; pictures): each asked for here - only from those sources, six at a time per site -
  // and handed back as it came (a picture as its bytes).
  const MX_SOURCES = /^https:\/\/(view\.eumetsat\.int|gibs\.earthdata\.nasa\.gov|api\.rainviewer\.com|tilecache\.rainviewer\.com|mesonet\.agron\.iastate\.edu|api\.open-meteo\.com|aviationweather\.gov|www\.notams\.faa\.gov)\//;
  const mxLanes = new Map();
  function mxRun(host) {
    const l = mxLanes.get(host); if (!l) return;
    while (l.busy < 6 && l.q.length) { const job = l.q.shift(); l.busy++; job(() => { l.busy--; mxRun(host); }); }
  }
  function onMxGet(d) {
    const url = String((d && d.url) || ''), rid = d && d.rid;
    if (!rid) return;
    const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
    if (!MX_SOURCES.test(url) || !gm) { postToPage('mxGot', { rid, status: 0 }); return; }
    const host = new URL(url).host;
    if (!mxLanes.has(host)) mxLanes.set(host, { busy: 0, q: [] });
    mxLanes.get(host).q.push(done => {
      let fin = false;
      const end = (status, body) => { if (fin) return; fin = true; clearTimeout(guard); done(); postToPage('mxGot', { rid, status, body }); };
      // (a request the userscript manager drops without a word: given up after half a minute, so its lane is free again)
      const guard = setTimeout(() => end(0), 30000);
      try {
        gm({ method: 'GET', url, timeout: 25000, responseType: d.bin ? 'arraybuffer' : 'text', headers: { Accept: d.bin ? 'image/png,image/*;q=0.9,*/*;q=0.5' : 'application/json,text/plain;q=0.9,*/*;q=0.5' },
          onload: r => end(Number(r.status) || 0, d.bin ? r.response : (r.responseText != null ? r.responseText : r.response)),
          onerror: () => end(0), ontimeout: () => end(0), onabort: () => end(0) });
      } catch (e) { end(0); }
    });
    mxRun(host);
  }
  // FR24's "show personalised ads" box in Settings > Misc > Privacy: never shown
  function mxHidePrivacyAds() {
    if (document.getElementById('tl-privacy-ads')) return;
    const st = document.createElement('style'); st.id = 'tl-privacy-ads';
    st.textContent = '.text-gray-900.text-sm.pb-4.px-2.border-white.border-b-2.space-y-2.mt-4{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  }
