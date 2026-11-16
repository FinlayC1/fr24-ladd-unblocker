  // ---- (1.2.0) FR24's locked map options: what the page part fetches through here ------------------------------------
  // The page part draws FR24's weather layers, current weather, AIRMETs/SIGMETs and oceanic tracks from free sources it
  // cannot reach itself (other sites; pictures): each asked for here - only from those sources, six at a time per site -
  // and handed back as it came (a picture as its bytes).
  // (1.3.7: and FAA PilotWeb's page of the Pacific tracks - the FAA's own link to them)
  const MX_SOURCES = /^https:\/\/(view\.eumetsat\.int|gibs\.earthdata\.nasa\.gov|api\.rainviewer\.com|tilecache\.rainviewer\.com|mesonet\.agron\.iastate\.edu|api\.open-meteo\.com|aviationweather\.gov|nms\.aim\.faa\.gov|pilotweb\.nas\.faa\.gov\/PilotWeb\/noticesAction\.do\?queryType=PACIFICTRACKS)/;
  const mxLanes = new Map();
  // (1.2.1: the monitor, where every layer is built ready - "mon:/wx/..." asked of the monitor in use, with its secret if
  // one is set; a dozen at a time, one server answering from what it keeps)
  function mxRun(host) {
    const l = mxLanes.get(host); if (!l) return;
    while (l.busy < (host === 'mon' ? 12 : 6) && l.q.length) { const job = l.q.shift(); l.busy++; job(() => { l.busy--; mxRun(host); }); }
  }
  function onMxGet(d) {
    const rid = d && d.rid;
    if (!rid) return;
    let url = String((d && d.url) || '');
    const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
    if (url.startsWith('mon:')) {
      if (!gm || !/^\/wx\/[A-Za-z0-9/._-]+$/.test(url.slice(4))) { postToPage('mxGot', { rid, status: 0 }); return; }
      const go = () => { if (!monOk || !monBase) { postToPage('mxGot', { rid, status: 0 }); return; } mxSend(gm, rid, monUrl() + url.slice(4), 'mon', d.bin, monHdr()); };
      const c = monCheck(); if (c) c.then(go, go); else go();
      return;
    }
    // (1.3.7) the FAA's NOTAM Search, its messages of one of the three Pacific oceanic centres - the day's Pacific tracks
    // where the monitor has none (NOTAM Search refuses servers in data centres; this browser it answers). Only that
    // question, of only those three: the page names the centre and nothing else
    // (a page of 30 at a time, as the monitor asks: its offset a multiple of 30, 600 at most)
    const nm = url.match(/^notams:(KZAK|RJJJ|PAZA)(?::(\d{1,3}))?$/), off = nm ? Number(nm[2] || 0) : 0;
    if (nm) {
      if (!gm || off % 30 || off > 600) { postToPage('mxGot', { rid, status: 0 }); return; }
      mxSend(gm, rid, 'https://notams.aim.faa.gov/notamSearch/search', 'notams.aim.faa.gov', false, { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' },
        'searchType=0&designatorsForLocation=' + nm[1] + '&offset=' + off + '&notamsOnly=false');
      return;
    }
    if (!MX_SOURCES.test(url) || !gm) { postToPage('mxGot', { rid, status: 0 }); return; }
    mxSend(gm, rid, url, new URL(url).host, d.bin, null);
  }
  function mxSend(gm, rid, url, host, bin, extra, body) {
    const d = { bin };
    if (!mxLanes.has(host)) mxLanes.set(host, { busy: 0, q: [] });
    mxLanes.get(host).q.push(done => {
      let fin = false;
      const end = (status, body) => { if (fin) return; fin = true; clearTimeout(guard); done(); postToPage('mxGot', { rid, status, body }); };
      // (a request the userscript manager drops without a word: given up after half a minute, so its lane is free again)
      const guard = setTimeout(() => end(0), 30000);
      try {
        gm({ method: body != null ? 'POST' : 'GET', url, data: body != null ? body : undefined, timeout: 25000, responseType: d.bin ? 'arraybuffer' : 'text', headers: Object.assign({ Accept: d.bin ? 'image/png,image/*;q=0.9,*/*;q=0.5' : 'application/json,text/plain;q=0.9,*/*;q=0.5' }, extra || {}),
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
