  // ---- LADD Unblock: its own button on FR24's bottom bar (Settings · Weather · Filters · Widgets · Playback), and its
  // window - every switch, the data sources and updates - shown in FR24's own window ------------------------------------
  // The bar is FR24's (Vue): found by its labels, not by class names, and one of its own buttons is copied - so the new one
  // has the bar's look, whatever FR24 calls its classes - with this icon and label. Put back if FR24 draws the bar again.
  const UB_REPO = 'FinlayC1/fr24-ladd-unblocker';
  const UB_LATEST_URL = `https://raw.githubusercontent.com/${UB_REPO}/main/package.json`;
  const UB_USERSCRIPT_URL = `https://raw.githubusercontent.com/${UB_REPO}/main/dist/fr24-ladd-unblocker.user.js`;
  // (main's own zip - built with the version in main's package.json, the one offered; the release's "latest" lags behind it)
  const UB_ZIP_URL = `https://raw.githubusercontent.com/${UB_REPO}/main/dist/fr24-ladd-unblocker-extension.zip`;
  const UB_CHANGES_URL = `https://github.com/${UB_REPO}/blob/main/CHANGELOG.md`;
  const UB_LABELS = ['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'];
  // (the version whose "what's new" was put away, and the one whose dot on the button the window was opened for)
  const UB_SEEN_KEY = 'tweeks.fr24.ladd.seenver', UB_DOT_KEY = 'tweeks.fr24.ladd.dotver';
  // (the newest CHANGELOG section's headlines, written in by build.mjs: { v, items })
  const UB_WHATS_NEW = '__TL_WHATSNEW__';
  // (an aircraft with an open padlock: FR24's outline style - 24 grid, 1.5 stroke in the text colour)
  const UB_ICON = '<svg data-tl-ub-icon="" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path transform="translate(-1.6 -1.4) scale(.9)" d="M12 2.5c.8 0 1.4.9 1.4 2v4.6l6.6 4v1.8l-6.6-2v4.3l2 1.5v1.5L12 19.3l-3.4.9v-1.5l2-1.5v-4.3l-6.6 2v-1.8l6.6-4V4.5c0-1.1.6-2 1.4-2z"/><rect x="14.75" y="16.25" width="7.5" height="5.75" rx="1.2"/><path d="M16.6 16.25v-1.8a1.9 1.9 0 0 1 3.6-.85"/></svg>';
  const UB_X = '<svg viewBox="0 0 14 14" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" aria-hidden="true"><path d="M1.5 1.5l11 11M12.5 1.5l-11 11"/></svg>';
  // (the size of the window's text: M is FR24's own - the 14 px of its windows' lists - and the others scale it)
  const UB_SIZE_KEY = 'tweeks.fr24.ladd.textsize', UB_SIZES = [['S', 0.9], ['M', 1], ['L', 1.15], ['XL', 1.3]];
  const ubSize = () => { const v = parseInt(lsGet(UB_SIZE_KEY), 10); return v >= 0 && v < UB_SIZES.length ? v : 1; };
  // The content (.tl-ub-c) in FR24's measures: 14 px text on 20 px lines, its section titles bold capitals, 12 px notes, its
  // grey #393939 and yellow #f8c023, 8 px in from the edges. In FR24's window (.tl-ub-in) it scrolls under FR24's title
  // bar; the stand-in window (.tl-ub) is drawn like FR24's: 336 px wide, a 40 px grey title bar.
  const UB_STYLE = `
.tl-ub-c{--tl-f:1;font-size:calc(var(--tl-f)*14px);line-height:1.43;color:#393939;text-align:left;font-weight:400}
.tl-ub-c *{box-sizing:border-box}
.tl-ub-in{display:block;background:#ededed;flex:1 1 auto;min-height:0;width:100%;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#f8c023 transparent}
.tl-ub-in::-webkit-scrollbar,.tl-ub-body::-webkit-scrollbar{width:5px}
.tl-ub-in::-webkit-scrollbar-thumb,.tl-ub-body::-webkit-scrollbar-thumb{background:#f8c023;border-radius:3px}
[data-tl-ub-host]>:not([data-tl-ub-keep]):not(.tl-ub-in){display:none!important}
.tl-ub{position:fixed;z-index:2147482000;left:8px;top:8px;width:336px;max-height:calc(100vh - 96px);display:flex;flex-direction:column;background:#f4f4f4;color:#393939;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.35);overflow:hidden;font-family:inherit;transition:opacity .2s ease,transform .2s ease}
.tl-ub.tl-ub-enter,.tl-ub.tl-ub-going{opacity:0;transform:translateY(12px)}
.tl-ub-going{pointer-events:none}
.tl-ub-head{flex:none;position:relative;height:40px;display:flex;align-items:center;justify-content:center;background:#393939;color:#fff;font-size:16px;font-weight:700}
.tl-ub-head .tl-ub-x{position:absolute;right:10px;top:9px;width:22px;height:22px;padding:0;border:0;background:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}
.tl-ub-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#f8c023 transparent}
.tl-ub-c .tl-ub-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tl-ub-c .tl-ub-top{padding:12px 8px 6px}
.tl-ub-c .tl-ub-t{font-size:calc(var(--tl-f)*14px);line-height:1.43;font-weight:700;color:#393939;text-transform:uppercase}
.tl-ub-c .tl-ub-info{display:flex;gap:6px;padding:0 8px 10px;font-size:calc(var(--tl-f)*12px);line-height:1.34;color:#393939}
.tl-ub-c .tl-ub-info svg{flex:none;margin-top:2px}
.tl-ub-c .tl-ub-item{padding:10px 8px;border-top:1px solid #fff}
.tl-ub-c .tl-ub-item p{margin:4px 0 0;font-size:calc(var(--tl-f)*14px);line-height:1.43;color:#393939}
.tl-ub-off .tl-ub-feat{opacity:.45}
.tl-ub-c .tl-ub-tg{flex:none;position:relative;width:44px;height:24px;margin:0;padding:0;border:0;border-radius:12px;background:#c4c4c4;cursor:pointer;transition:background-color var(--tl-tg-d,.2s) var(--tl-tg-e,cubic-bezier(.4,0,.2,1))}
.tl-ub-c .tl-ub-tg[aria-checked="true"]{background:#f8c023}
.tl-ub-c .tl-ub-tg i{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transform:translateX(0);transition:transform var(--tl-tg-d,.2s) var(--tl-tg-e,cubic-bezier(.4,0,.2,1))}
.tl-ub-c .tl-ub-tg[aria-checked="true"] i{transform:translateX(20px)}
.tl-ub-c .tl-ub-reload{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;background:#fff4d1;border-bottom:1px solid #f8c023;font-size:calc(var(--tl-f)*13px);font-weight:600}
.tl-ub-c .tl-ub-reload[hidden]{display:none}
.tl-ub-c .tl-ub-b{flex:none;margin:0;padding:5px 12px;border:0;border-radius:4px;background:#f8c023;color:#1b1b1b;font:inherit;font-size:calc(var(--tl-f)*13px);line-height:1.4;font-weight:700;cursor:pointer}
.tl-ub-c .tl-ub-b2{background:#e2e2e2}
.tl-ub-c .tl-ub-b:disabled{opacity:.5;cursor:default}
.tl-ub-c .tl-ub-kv{display:flex;justify-content:space-between;gap:8px;margin-top:4px;font-size:calc(var(--tl-f)*14px);line-height:1.43}
.tl-ub-c .tl-ub-kv span:first-child{color:#6d6d6d}
.tl-ub-c .tl-ub-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tl-ub-c .tl-ub-note{margin-top:6px;font-size:calc(var(--tl-f)*12px);line-height:1.34;color:#5c5c5c}
.tl-ub-c a{color:#327db6;text-decoration:none}
.tl-ub-c a:hover{text-decoration:underline}
.tl-ub-c .tl-muted{opacity:.75}
.tl-ub-c .tl-warn{color:#b35c00;font-size:inherit;font-weight:600}
.tl-ub-c .tl-pop-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 6px;padding:4px 0;border-top:1px solid rgba(0,0,0,.06);font-size:calc(var(--tl-f)*13px);line-height:1.4}
.tl-ub-c #tl-ub-sources>.tl-muted{font-size:calc(var(--tl-f)*12px);line-height:1.34}
.tl-ub-c .tl-in{flex:1 1 100%;min-width:0;margin:2px 0;padding:5px 8px;background:#fff;color:#393939;border:1px solid #c8c8c8;border-radius:4px;font:inherit;font-size:calc(var(--tl-f)*13px)}
.tl-ub-btn-on,.tl-ub-btn-on *{color:#f8c023!important}
.tl-ub-btn{position:relative}
.tl-ub-btn [data-tl-ub-label]{white-space:nowrap}
.tl-ub-c .tl-ub-new{position:relative;margin:8px 8px 2px;padding:6px 24px 6px 8px;background:#e8f1fa;border-radius:6px;font-size:calc(var(--tl-f)*13px);line-height:1.4;color:#393939}
.tl-ub-c .tl-ub-new ul{margin:3px 0 2px;padding-left:16px}
.tl-ub-c .tl-ub-new li{margin:1px 0}
.tl-ub-c .tl-ub-new .tl-ub-x{position:absolute;top:4px;right:3px;width:20px;height:20px;padding:0;border:0;background:none;color:#5c5c5c;cursor:pointer;display:flex;align-items:center;justify-content:center}
.tl-ub-c .tl-ub-alert{margin-top:6px;padding:6px 8px;background:#fff4d1;border-left:3px solid #f8c023;border-radius:3px;font-size:calc(var(--tl-f)*13px);line-height:1.4}
.tl-ub-c .tl-ub-grid .tl-ub-kv span:last-child{text-align:right}
.tl-ub-c .tl-ub-log{margin:6px 0 0;max-height:180px;overflow:auto;padding:6px;background:#fff;border:1px solid #dcdcdc;border-radius:4px;font:11px/1.35 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:#393939}
.tl-ub-c .tl-ub-seg{display:flex;gap:4px}
.tl-ub-c .tl-ub-seg button{min-width:34px;margin:0;padding:4px 8px;border:0;border-radius:4px;background:#e2e2e2;color:#393939;font:inherit;font-size:calc(var(--tl-f)*13px);line-height:1.4;font-weight:700;cursor:pointer}
.tl-ub-c .tl-ub-seg button[aria-pressed="true"]{background:#f8c023;color:#1b1b1b}
.tl-ub-gone,.tl-ub-hid{display:none!important}
html.tl-no-strip .tl-strip{display:none!important}`;
  // the switches, in the order shown; 'reload': takes effect when FR24 is loaded again
  const UB_FEATURES = [
    ['strip', 'Aircraft panel details', 'The strip under the photo: owner, registry and tracking links, the prediction odds, and the confirm, watch, fleet, CSV and scorecard tools.'],
    ['boards', 'Airport boards', "Blocked flights, and FR24's own N/A flights with a good predicted destination, on arrivals, departures and on the ground. From the next board you open."],
    ['search', 'Search', "Identified blocked aircraft listed under Live flights in FR24's search box."],
    ['acPages', 'Aircraft & flight pages', 'Flight logs FR24 hides rebuilt from ADS-B on the /data pages, with the locked MSN and age. The next time one opens.'],
    ['alerts', 'Take-off & landing alerts', 'Notifications for the aircraft on your watchlist.'],
    ['noAds', 'Hide ads & upgrade prompts', "FR24's adverts, the ad sidebar, the free-trial pop-up and upgrade banners. The sidebar and pop-up come back after a reload.", 'reload'],
    // (the hello to the monitor, 06-hello.js: exactly what it sends is in PRIVACY.md)
    ['count', 'Count this install (anonymous)', 'A random number, your version and browser, once a day - no IP kept, nothing about flights. Helps show how many people use it.']
  ];
  let ubBtn = null, ubBar = null, ubItems = new Map(), ubNeedReload = false, ubLatest = null, ubAsking = null, ubNote = '', ubInstalled = '';
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* full or blocked */ } };

  function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify(opt)); } catch (e) { log('options', e); } postToPage('opts', { opts: opt }); }
  function applyOptsLive() {
    document.documentElement.classList.toggle('tl-no-strip', !opt.strip);
    if (opt.on && opt.noAds) addAdStyle(); else { const s = document.getElementById('tl-noads'); if (s) s.remove(); }
  }
  function setOpt(k, v) {
    if (!(k in OPT_DEFAULTS)) return;
    opt[k] = !!v; saveOpts();
    if (k === 'on' || UB_FEATURES.some(f => f[0] === k && f[3] === 'reload')) ubNeedReload = true;
    if (opt.on) applyOptsLive();
    renderUnblockWindow(); ubBanners();
    if (k === 'count' && opt.count) sayHello();
  }

  // ---- the version: what is installed, the newest one, and how this kind of install is updated ----------------------
  // (1.0.0 and on are newer than every beta: the versions before it - 22.31.12 and earlier, "B22.31.12" - are numbered
  // 20 and up, so the first number counts only within its own line)
  const verParts = v => { const s = String(v || ''), p = s.replace(/^[vB]/i, '').split('.').map(x => parseInt(x, 10) || 0); return [!/^B/i.test(s) && p[0] >= 1 && p[0] < 20 ? 1 : 0].concat(p); };
  const newerThan = (a, b) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  // (a version as shown: v1.0.0; a beta, B22.31.12)
  const verLabel = v => { const s = String(v || '').replace(/^[vB]/i, ''); return (verParts(v)[0] === 0 && s ? 'B' : 'v') + s; };
  function installKind() {
    if (typeof TL_EXTENSION === 'boolean') {
      let m = null; try { m = chrome.runtime.getManifest(); } catch (e) { /* the extension was reloaded */ }
      // (Firefox: installed from addons.mozilla.org, which updates it - it cannot load an unpacked folder for good)
      let url = ''; try { url = chrome.runtime.getURL(''); } catch (e) { /* the extension was reloaded */ }
      if (/^moz-extension:/.test(url)) return { kind: 'store', name: 'Firefox add-on' };
      return m && m.update_url ? { kind: 'store', name: 'Browser extension (store)' } : { kind: 'ext', name: 'Browser extension (unpacked)' };
    }
    let h = ''; try { h = typeof GM_info !== 'undefined' && GM_info && GM_info.scriptHandler ? String(GM_info.scriptHandler) : ''; } catch (e) { /* none */ }
    return { kind: 'us', name: h ? h + ' userscript' : 'Userscript' };
  }
  // (main's package.json: a version merged to main is released as soon as its tests pass. The answer is kept across page
  // loads - the map's banner says a new version is out from the moment the page opens, not only once this window has
  // asked again - and asked for again every ten minutes, and on coming back to the tab)
  const UB_LATEST_KEY = 'tweeks.fr24.ladd.latest';
  try { const L = JSON.parse(lsGet(UB_LATEST_KEY) || 'null'); if (L && /^\d+(\.\d+)*$/.test(L.v) && now() - L.at < 12 * 3600e3) ubLatest = { v: L.v, at: L.at }; } catch (e) { /* none kept */ }
  function checkLatest(force) {
    if (ubAsking) return ubAsking;
    if (!force && ubLatest && now() - ubLatest.at < 10 * 60000) return Promise.resolve(ubLatest);
    ubAsking = gmRequest(UB_LATEST_URL + '?t=' + Math.floor(now() / 60000), { timeout: 15000 })
      .then(j => { const v = j && typeof j.version === 'string' && /^\d+(\.\d+)*$/.test(j.version) ? j.version : ''; ubLatest = v ? { v, at: now() } : { err: 'no version in the answer', at: now() }; if (v) lsSet(UB_LATEST_KEY, JSON.stringify(ubLatest)); })
      .catch(e => { ubLatest = { err: String(e && e.message || e), at: now() }; })
      .then(() => { ubAsking = null; renderUnblockWindow(); ubBadge(); ubBanners(); return ubLatest; });
    renderUnblockWindow();
    return ubAsking;
  }
  const extMsg = m => new Promise(res => { try { chrome.runtime.sendMessage(m, r => { void chrome.runtime.lastError; res(r); }); } catch (e) { res(null); } });
  function doUpdate(act) {
    const k = installKind().kind;
    // (from a beta - 22.x - to 1.0.0 and on: the manager compares the numbers alone, and calls the newer one a downgrade)
    if (act === 'update' && k === 'us') { window.open(UB_USERSCRIPT_URL, '_blank', 'noopener'); ubNote = verParts(VERSION)[0] === 0 && verParts(latestV())[0] === 1 ? 'Your userscript manager opens the new version in a tab. It may call it a downgrade (it compares 1 with 22), but it is the newer one: confirm it there, then reload FR24.' : 'Your userscript manager opens the new version in a tab: click Update there, then reload FR24.'; }
    // (unpacked: the extension's own update page, in a tab next to this one - it writes the new version into the extension's
    // folder, extension/update.js; the zip by hand only where that page cannot be opened)
    else if (act === 'update' && k === 'ext') {
      ubNote = 'Opening the update…';
      extMsg({ tlSelfUpdate: true }).then(ok => {
        if (ok) ubNote = 'Finish in the LADD Unblocker tab that opened: click Update there.';
        else { window.open(UB_ZIP_URL, '_blank', 'noopener'); ubNote = 'Downloading the new zip. Unzip it over your extension folder (replace the files), then click Reload extension.'; }
        renderUnblockWindow(); ubBanners();
      });
    }
    // (the new version is in the folder: the extension restarts and loads this tab again - or, should it not, the page does)
    else if (act === 'restart') { ubNote = 'Restarting with v' + ubInstalled + '…'; extMsg({ tlRestart: true }); setTimeout(() => location.reload(), 4000); }
    else if (act === 'update' && k === 'store') { ubNote = 'Asking the browser…'; extMsg({ tlUpdateCheck: true }).then(st => { ubNote = st === 'update_available' ? 'Found it: the extension restarts with it. Reload FR24 when it has.' : st === 'throttled' ? 'The browser checked recently; it installs the update by itself shortly.' : st === 'unsupported' ? 'Your browser installs the update by itself when its add-on store has it (Firefox looks about once a day).' : 'The browser has nothing newer for it yet; it installs updates by itself.'; renderUnblockWindow(); ubBanners(); }); }
    else if (act === 'reloadExt' && k === 'ext') { ubNote = 'Reloading the extension…'; extMsg({ tlReload: true }); setTimeout(() => location.reload(), 900); }
    renderUnblockWindow(); ubBanners();
  }
  // (the update page says when the new version is in the extension's folder: Refresh page, here and on the map's banner)
  if (typeof TL_EXTENSION === 'boolean') {
    try {
      chrome.runtime.onMessage.addListener(m => {
        if (!m || typeof m.tlUpdated !== 'string' || !/^\d+(\.\d+)*$/.test(m.tlUpdated)) return;
        ubInstalled = m.tlUpdated; ubNote = ''; renderUnblockWindow(); ubBanners();
      });
    } catch (e) { /* the extension was reloaded */ }
  }
  function updatesHtml() {
    // (the newest version: GitHub's or the monitor's answer to the hello, 06-hello.js)
    const ik = installKind(), L = ubLatest, lv = latestV(), O = ubOffer(), newer = !!O.v;
    const latest = ubAsking && !lv ? '<span class="tl-muted">checking…</span>' : lv || newer ? (newer ? `<b>v${esc(O.v)}</b>` : `v${esc(lv)} <span class="tl-muted">(up to date)</span>`) : L && L.err ? `<span class="tl-warn" title="${esc(L.err)}">couldn't check</span>` : '<span class="tl-muted">not checked</span>';
    const btns = [];
    if (ubInstalled) btns.push('<button class="tl-ub-b" data-ub-act="restart">Refresh page</button>');
    else if (newer) btns.push(`<button class="tl-ub-b" data-ub-act="update">Update to v${esc(O.v)}</button>`);
    else btns.push(`<button class="tl-ub-b tl-ub-b2" data-ub-act="check"${ubAsking ? ' disabled' : ''}>Check for updates</button>`);
    if (ik.kind === 'ext') btns.push('<button class="tl-ub-b tl-ub-b2" data-ub-act="reloadExt" title="Load the extension again from its folder - after replacing its files with a new version">Reload extension</button>');
    const how = ik.kind === 'us' ? 'Update opens the new version in your userscript manager, which offers to update.' : ik.kind === 'ext' ? 'Update puts the new version into the extension\'s folder for you. The first time, Chrome asks you to choose that folder and allow it to be edited.' : 'Installed from a store: your browser updates it by itself.';
    const warn = ubInstalled ? `<div class="tl-ub-alert">v${esc(ubInstalled)} is installed. Refresh the page to start using it.</div>` : newer ? `<div class="tl-ub-alert">This version is out of date: <b>v${esc(O.v)}</b> is out, you have v${esc(VERSION)}.${O.req ? ' <b>This update is required</b>: this version is no longer supported.' : ''}</div>` : '';
    return `${warn}<div class="tl-ub-kv"><span>Installed</span><span>v${esc(VERSION)}</span></div><div class="tl-ub-kv"><span>Latest</span><span>${latest}</span></div>
      <div class="tl-ub-kv"><span>Type</span><span>${esc(ik.name)}</span></div><div class="tl-ub-btns">${btns.join('')}</div>
      <div class="tl-ub-note">${esc(ubNote || how)} <a href="${UB_CHANGES_URL}" target="_blank" rel="noopener">What's new</a></div>`;
  }

  // ---- what's new: once after an update, a small note at the top of the window until it is put away ------------------
  // (a first install has nothing to compare with: noted as seen)
  function whatsNewDue() {
    const seen = lsGet(UB_SEEN_KEY);
    if (!seen) { lsSet(UB_SEEN_KEY, VERSION); return false; }
    return newerThan(VERSION, seen);
  }
  function whatsNewHtml() {
    if (!whatsNewDue()) return '';
    const W = UB_WHATS_NEW && typeof UB_WHATS_NEW === 'object' && UB_WHATS_NEW.v === VERSION ? UB_WHATS_NEW : null, items = W ? (W.items || []).slice(0, 6) : [];
    return `<div class="tl-ub-new"><b>Updated to v${esc(VERSION)}</b>${items.length ? '<ul>' + items.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>' : ' '}<a href="${UB_CHANGES_URL}" target="_blank" rel="noopener">What's new</a>
      <button type="button" class="tl-ub-x" data-ub-act="seenNew" aria-label="Dismiss" title="Dismiss">${UB_X}</button></div>`;
  }
  // ---- the bar's button says, in its tooltip, when a newer version is out, and after an update until the window is opened.
  // Its icon is never drawn over: a dot on it (amber, blue) looked like a new icon - the map's banner says it instead.
  function ubBadge() {
    if (!ubBtn) return;
    const O = ubOffer(), k = O.v ? 'upd' : whatsNewDue() && lsGet(UB_DOT_KEY) !== VERSION ? 'new' : '';
    for (const d of ubBtn.querySelectorAll('.tl-ub-dot')) d.remove();
    ubBtn.setAttribute('title', k === 'upd' ? `LADD Unblock - v${O.v} is out (you have v${VERSION})` : k === 'new' ? `LADD Unblock - updated to v${VERSION}` : 'LADD Unblock');
  }

  // ---- the monitor: what it is doing, and the owner's controls (update, restart, its log) in place of a terminal --------
  // Asked every 20 s while the window is open, and only then: /stats with the owner's secret (it holds /status and the
  // server's own numbers), /status without. Nothing is asked of the data services for it.
  const ubMon = { at: 0, st: null, srv: null, req: null, up: 0, err: '', busy: false, note: '', log: null, logOpen: false, confirm: '', confirmAt: 0, deployUntil: 0, deployAt: 0, timer: 0 };
  const nf = n => n == null || !isFinite(n) ? '-' : Number(n).toLocaleString('en-GB');
  const agoS = s => s == null ? 'never' : s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : s < 172800 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' days';
  const durS = s => s < 3600 ? Math.round(s / 60) + ' min' : s < 172800 ? Math.floor(s / 3600) + ' h ' + Math.round((s % 3600) / 60) + ' min' : Math.floor(s / 86400) + ' days ' + Math.round((s % 86400) / 3600) + ' h';
  const monIsOwner = () => { const r = monRemote(); return !!(r && r.token); };
  function monRefresh() {
    if (ubMon.busy || !opt.on) return;
    const r = monRemote(); if (!r) { ubMon.st = null; ubMon.err = ''; return monPaint(); }
    ubMon.busy = true;
    const owner = monIsOwner();
    monGet(owner ? '/stats' : '/status', { timeout: 8000 })
      .then(j => {
        if (owner && j && j.mon) { ubMon.st = Object.assign({}, j.mon, { ver: j.ver, commit: j.commit, controls: j.controls, since: j.since }); ubMon.srv = j.srv || null; ubMon.req = j.req || null; ubMon.up = j.uptimeS || 0; }
        else if (j && j.v) { ubMon.st = j; ubMon.srv = null; ubMon.req = null; ubMon.up = j.since ? (now() - j.since) / 1000 : 0; }
        else throw new Error('not a monitor');
        ubMon.at = now(); ubMon.err = '';
      })
      .catch(e => { ubMon.err = /HTTP 401/.test(String(e)) ? 'the secret saved here is not this monitor\'s' : String((e && e.message) || e).slice(0, 100); })
      .then(() => (owner && (ubMon.logOpen || now() < ubMon.deployUntil) ? monLog() : null))
      .then(() => { ubMon.busy = false; monPaint(); });
  }
  function monLog() {
    return monGet('/admin/log?n=60', { timeout: 8000 }).then(j => {
      ubMon.log = j || null;
      // (an update under way: its own last line says how it went)
      const d = j && j.deploy; if (d && now() < ubMon.deployUntil && d.at > ubMon.deployAt - 5000) { const last = String(d.text || '').trim().split('\n').filter(l => /^\[deploy\]/.test(l)).pop(); if (last) ubMon.note = last.replace(/^\[deploy\]\s*/, 'Update: '); if (/OK - |already up to date|not updating|back to|rolled back/.test(last || '')) ubMon.deployUntil = 0; }
    }).catch(e => { ubMon.log = { err: String((e && e.message) || e) }; });
  }
  function monControl(act) {
    // (a second click within 5 s does it: nothing on the server happens from one stray click)
    if (ubMon.confirm !== act || now() - ubMon.confirmAt > 5000) { ubMon.confirm = act; ubMon.confirmAt = now(); monPaint(); setTimeout(() => { if (ubMon.confirm === act && now() - ubMon.confirmAt >= 5000) { ubMon.confirm = ''; monPaint(); } }, 5100); return; }
    ubMon.confirm = '';
    if (act === 'log') return;
    ubMon.note = act === 'monUpdate' ? 'Asking the monitor to update…' : act === 'monReset' ? 'Asking the monitor to delete its saved logs…' : 'Asking the monitor to restart…'; monPaint();
    monPost(act === 'monUpdate' ? '/admin/update' : act === 'monReset' ? '/admin/reset-logs' : '/admin/restart', {})
      .then(j => {
        if (!j || !j.ok) { ubMon.note = 'The monitor said no: ' + ((j && j.err) || 'no answer'); return; }
        if (act === 'monReset') { ubMon.note = `Deleted ${nf(j.deleted || 0)} saved logs. They are built again from both networks as aircraft are looked at.`; return; }
        if (act === 'monUpdate') { ubMon.deployAt = now(); ubMon.deployUntil = now() + 8 * 60000; ubMon.note = 'Updating: it fetches the newest version, restarts with it and checks it answers (back to this one if not). The result shows here.'; }
        else ubMon.note = 'Restarting: it saves everything first and answers again in a minute or two.';
        monOk = false; monCheckAt = 0;
      })
      .catch(e => { ubMon.note = /HTTP 401/.test(String(e)) ? 'The monitor refused: the secret saved here is not its own.' : /HTTP 404/.test(String(e)) ? 'This monitor is older than these controls: update it once on the server (deploy.sh).' : 'No answer from the monitor (' + String((e && e.message) || e).slice(0, 80) + ').'; })
      .then(monPaint);
  }
  function monHtml() {
    const r = monRemote();
    if (!r) return '<p>Turned off: this browser works alone (Data sources > Monitor turns it on).</p>';
    const S = ubMon.st, kv = (k, v, t) => `<div class="tl-ub-kv"${t ? ` title="${esc(t)}"` : ''}><span>${esc(k)}</span><span>${v}</span></div>`;
    if (!S) return `<div class="tl-ub-note">${ubMon.err ? `<span class="tl-warn">Not answering</span> (${esc(ubMon.err)})` : '<span class="tl-muted">asking…</span>'}</div>`;
    const L = { v: latestV() }, behind = S.ver && L.v && newerThan(L.v, S.ver);
    const la = S.listAge || {}, f = S.fr24 || {}, w = S.waiting || {}, o = S.owners || {}, t = S.tel || {}, h = S.hist || {}, x = S.wx || {};
    const paused = Object.entries(S.paused || {}).map(([k, v]) => `${esc(k)} ${agoS(v)}`).join(', ');
    const errs = [S.fails ? `polls ${nf(S.fails)}` : '', f.fails ? `FR24 ${nf(f.fails)}` : '', x.fails ? `weather ${nf(x.fails)}` : '', o.fails ? `owners ${nf(o.fails)}` : ''].filter(Boolean).join(' · ');
    const rows = [
      kv('Version', S.ver ? `${esc(verLabel(S.ver))}${S.commit ? ' <span class="tl-muted">' + esc(S.commit) + '</span>' : ''} ${behind ? `<span class="tl-warn">behind v${esc(L.v)}</span>` : L && L.v ? '<span class="tl-muted">(up to date)</span>' : ''}` : '<span class="tl-muted">older than 22.28</span>'),
      kv('Running for', ubMon.up ? durS(ubMon.up) : '-'),
      kv('Live list', `${nf(S.live)} aircraft · LADD list ${agoS(la.ladd)} old`, 'Every blocked, LADD, military and PIA aircraft heard in the last 5 minutes; how long ago the LADD list last answered'),
      kv('Blocked aircraft', nf(S.blocked)),
      kv('Flights kept', nf(S.legs)),
      kv('FR24 scan', f.scanning === false ? 'off' : f.lastOkAgo != null ? `ok ${agoS(f.lastOkAgo)} ago${f.paused ? ' · <span class="tl-warn">paused ' + agoS(f.paused) + '</span>' : ''}` : '<span class="tl-warn">not working</span>'),
      kv('Flights named', `${nf(f.named)} of ${nf(f.flights)}`, 'FR24 flights drawn without a callsign or registration, and how many of them the monitor has named'),
      kv('Waiting to be named', nf(w.flights)),
      kv('Lookups served', `${nf(t.served)}`, 'Padlocked figures (vertical speed, airspeeds, squawk...) the monitor handed to browsers since it started'),
      kv('Owners known', `${nf(o.known)}${o.queue ? ' · ' + nf(o.queue) + ' to look up' : ''}`),
      kv('Queues', `day logs ${nf(h.queue)} · rebuilds ${nf(S.backfillQueue)} · trails ${nf(f.trailQueue)}`, 'Work the monitor has still to do: day logs to close, aircraft whose recent days are being rebuilt, FR24 trails to fetch'),
      kv('Errors', errs || '<span class="tl-muted">none</span>', S.lastErr ? 'Last: ' + S.lastErr : ''),
      paused ? kv('Paused', `<span class="tl-warn">${paused}</span>`, 'Hosts the monitor is leaving alone after they refused or rate-limited it') : ''
    ];
    if (ubMon.srv) rows.push(kv('Memory', `${nf(Math.round(ubMon.srv.rss / 1048576))} MB · load ${esc((ubMon.srv.load || [0])[0].toFixed(2))}`));
    if (ubMon.req) rows.push(kv('Requests', `${nf(ubMon.req.lastMin)} a minute · ${nf(ubMon.req.clients)} browsers`));
    const C = S.controls || null, cf = a => ubMon.confirm === a;
    let ctl = '';
    if (monIsOwner() && C) {
      const b = [];
      if (C.update) b.push(`<button class="tl-ub-b${cf('monUpdate') ? '' : ' tl-ub-b2'}" data-ub-act="monUpdate" title="Fetch the newest version from GitHub, restart with it, and go back to this one if it does not answer">${cf('monUpdate') ? 'Click again to update' : behind ? 'Update to v' + esc(L.v) : 'Update monitor'}</button>`);
      if (C.reset) b.push(`<button class="tl-ub-b tl-ub-b2" data-ub-act="monReset" title="Delete every flight log the monitor has saved (what it learned is kept): built again from both networks as aircraft are looked at">${cf('monReset') ? 'Click again to delete' : 'Delete saved logs'}</button>`);
      if (C.restart) b.push(`<button class="tl-ub-b tl-ub-b2" data-ub-act="monRestart" title="Save everything and start again">${cf('monRestart') ? 'Click again to restart' : 'Restart'}</button>`);
      b.push(`<button class="tl-ub-b tl-ub-b2" data-ub-act="monLog">${ubMon.logOpen ? 'Hide log' : 'Log'}</button>`);
      ctl = `<div class="tl-ub-btns">${b.join('')}</div>`;
    } else if (monIsOwner()) ctl = `<div class="tl-ub-note">Controls (update, restart, log) come with the monitor's next version: update it once on the server with deploy.sh.</div>`;
    else ctl = '<div class="tl-ub-note">The owner\'s secret, saved under Data sources > Monitor, adds controls here: update, restart, and its log.</div>';
    let logBox = '';
    if (ubMon.logOpen) {
      const Lg = ubMon.log, d = Lg && Lg.deploy;
      logBox = !Lg ? '<div class="tl-ub-note tl-muted">loading…</div>' : Lg.err ? `<div class="tl-ub-note tl-warn">${esc(Lg.err)}</div>` : `<pre class="tl-ub-log">${d && d.text ? esc('Last update (' + new Date(d.at).toLocaleString('en-GB') + '):\n' + d.text.trim() + '\n\n') : ''}${esc((Lg.lines || []).slice(-60).join('\n') || 'nothing logged yet')}</pre>`;
    }
    return `<div class="tl-ub-grid">${rows.join('')}</div>${ubMon.err ? `<div class="tl-ub-note"><span class="tl-warn">Last ask failed</span> (${esc(ubMon.err)})</div>` : ''}${ctl}${ubMon.note ? `<div class="tl-ub-note">${esc(ubMon.note)}</div>` : ''}${logBox}<div class="tl-ub-note tl-muted">Updated ${ubMon.at ? agoS((now() - ubMon.at) / 1000) + ' ago' : '-'} · ${esc(r.url.replace(/^https:\/\//, ''))}</div>`;
  }
  // (this browser's saved flight logs deleted - a second click within 5 s does it)
  let ubLogAsk = 0, ubLogNote = '';
  function logResetClick() {
    if (!ubLogAsk || now() - ubLogAsk > 5000) { ubLogAsk = now(); renderUnblockWindow(); setTimeout(() => { if (ubLogAsk && now() - ubLogAsk >= 5000) { ubLogAsk = 0; renderUnblockWindow(); } }, 5100); return; }
    ubLogAsk = 0; ubLogNote = 'Deleting…'; renderUnblockWindow();
    resetLogsNow().then(n => { ubLogNote = `Deleted ${nf(n)} saved logs in this browser. They are built again from both networks as aircraft are looked at.`; }, e => { ubLogNote = 'Could not delete them (' + String((e && e.message) || e).slice(0, 80) + ').'; }).then(renderUnblockWindow);
  }
  // ---- this browser: what it has done since FR24 was opened -----------------------------------------------------------
  function localHtml() {
    let ok = 0, fail = 0; for (const h of hostStat.values()) { ok += h.ok; fail += h.fail; }
    const kv = (k, v, t) => `<div class="tl-ub-kv"${t ? ` title="${esc(t)}"` : ''}><span>${esc(k)}</span><span>${v}</span></div>`;
    return `<div class="tl-ub-grid">${kv('Flights identified', nf(live.size), 'Blocked and N/A flights this tab has named')}${kv('Routes worked out', nf(routeState.size))}${kv('Named by the monitor', nf(srvIds.rows.size), 'FR24 flights the monitor has named, known to this tab')}${kv('Blocked aircraft live', nf(globalList.byHex.size))}${kv('Requests', `${nf(ok)} answered${fail ? ` · <span class="tl-warn">${nf(fail)} failed</span>` : ''}`, "Every data source together; each one's own count is under Data sources")}</div><div class="tl-ub-note tl-muted">Since FR24 was opened in this tab.</div><div class="tl-ub-btns"><button class="tl-ub-b tl-ub-b2" data-ub-act="logReset" title="Delete every flight log saved in this browser (what was learned is kept): built again from both networks as aircraft are looked at">${ubLogAsk && now() - ubLogAsk <= 5000 ? 'Click again to delete' : 'Rebuild flight logs'}</button></div>${ubLogNote ? `<div class="tl-ub-note">${esc(ubLogNote)}</div>` : ''}`;
  }
  function monPaint() {
    if (!ubBody || !ubBody.isConnected) return;
    const m = ubBody.querySelector('#tl-ub-mon'); if (m) morphHtml(m, monHtml());
    const l = ubBody.querySelector('#tl-ub-local'); if (l) morphHtml(l, localHtml());
  }
  function monStart() { monStop(); monRefresh(); ubMon.timer = setInterval(() => { if (!unblockWindowOpen()) return monStop(); monRefresh(); }, 20000); }
  function monStop() { if (ubMon.timer) clearInterval(ubMon.timer); ubMon.timer = 0; }

  // ---- the window's content ------------------------------------------------------------------------------------------
  const tgHtml = (k, label) => `<button type="button" class="tl-ub-tg" role="switch" aria-checked="${opt[k] ? 'true' : 'false'}" aria-label="${esc(label)}" data-ub-opt="${k}"><i></i></button>`;
  function ubBodyHtml() {
    const info = '<svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor"><circle cx="5" cy="5" r="4.4"/><path d="M5 4.4v3M5 2.6v.2" stroke-linecap="round"/></svg>';
    return `<div class="tl-ub-reload"${ubNeedReload ? '' : ' hidden'}><span>Reload FR24 to apply</span><button type="button" class="tl-ub-b" data-ub-act="reload">Reload</button></div>${whatsNewHtml()}
      <div class="tl-ub-row tl-ub-top"><span class="tl-ub-t">Enable LADD Unblock</span>${tgHtml('on', 'Enable LADD Unblock')}</div>
      <div class="tl-ub-info">${info}<span>Names blocked (LADD) and N/A aircraft from public ADS-B, with routes, predicted destinations and flight history.${opt.on ? '' : ' Switched off: FR24 is left as it is.'}</span></div>
      <div class="tl-ub-item"><div class="tl-ub-row"><span class="tl-ub-t">Text size</span><div class="tl-ub-seg">${UB_SIZES.map(([n], i) => `<button type="button" data-ub-size="${i}" aria-pressed="${i === ubSize() ? 'true' : 'false'}" title="Text size ${n}">${n}</button>`).join('')}</div></div></div>
      ${UB_FEATURES.map(([k, t, d]) => `<div class="tl-ub-item tl-ub-feat"><div class="tl-ub-row"><span class="tl-ub-t">${esc(t)}</span>${tgHtml(k, t)}</div><p>${esc(d)}</p>${k === 'count' && opt.count && ffConsent === false ? '<div class="tl-ub-note">Firefox has not allowed this add-on to send technical data, so nothing is sent. <button type="button" class="tl-ub-b tl-ub-b2" data-ub-act="ffConsent">Allow in Firefox</button></div>' : ''}</div>`).join('')}
      <div class="tl-ub-item"><span class="tl-ub-t">Updates</span><div id="tl-ub-upd">${updatesHtml()}</div></div>
      <div class="tl-ub-item"><span class="tl-ub-t">Monitor</span><div id="tl-ub-mon">${opt.on ? monHtml() : '<p>Switched off.</p>'}</div></div>
      <div class="tl-ub-item"><span class="tl-ub-t">This browser</span><div id="tl-ub-local">${opt.on ? localHtml() : '<p>Switched off.</p>'}</div></div>
      <div class="tl-ub-item"><span class="tl-ub-t">Data sources</span><div id="tl-ub-sources">${opt.on ? sourcesHtml() : '<p>Switched off.</p>'}</div></div>`;
  }
  // (the content: in FR24's own window, or in the stand-in - changed where it differs, so a switch slides across as it is
  // turned, as FR24's do; drawn afresh, it only ever appeared in its new place)
  let ubBody = null;
  function renderUnblockWindow() {
    if (!ubBody || !ubBody.isConnected) return;
    const top = ubBody.scrollTop;
    ubBody.classList.toggle('tl-ub-off', !opt.on);
    ubBody.style.setProperty('--tl-f', String(UB_SIZES[ubSize()][1]));
    const L = ubSwitchLook(); if (L) { ubBody.style.setProperty('--tl-tg-d', L.d); ubBody.style.setProperty('--tl-tg-e', L.e); }
    morphHtml(ubBody, ubBodyHtml()); ubBody.scrollTop = top;
  }
  // FR24's own switches move as they are turned: how long they take and how they ease, read off one of them - in its
  // Widgets list, kept in the window out of sight while this content is in it - and kept for the stand-in and next time
  const UB_TG_KEY = 'tweeks.fr24.ladd.switchlook';
  const ubSwitchLook = () => { try { const L = JSON.parse(lsGet(UB_TG_KEY) || 'null'); return L && /^[\d.]+m?s$/.test(L.d) && /^[a-z-]+(\([\d.,\s-]*\))?$/.test(L.e) ? L : null; } catch (e) { return null; } };
  function learnSwitch(root) {
    const sw = root && root.querySelector('[role="switch"]:not(.tl-ub-tg),input[type="checkbox"]'); if (!sw) return;
    const box = sw.matches('input') ? sw.parentElement : sw;
    for (const el of [box, ...box.querySelectorAll('*')].slice(0, 12)) {
      for (const pe of [null, '::before', '::after']) {
        let cs; try { cs = getComputedStyle(el, pe); } catch (e) { continue; }
        if (!/transform|translate|left|margin|inset|all/.test(cs.transitionProperty || '')) continue;
        const d = String(cs.transitionDuration || '').split(',').map(x => x.trim()).find(x => parseFloat(x) > 0);
        const e = (String(cs.transitionTimingFunction || '').match(/^(cubic-bezier\([^)]*\)|steps\([^)]*\)|[a-z-]+)/) || [])[1];
        if (d && e) { lsSet(UB_TG_KEY, JSON.stringify({ d, e })); return; }
      }
    }
  }
  // (the data sources' own buttons - monitor, keys - are handled with the strip's tools, which redraw this part)
  function refreshSources() { const el = ubBody && ubBody.isConnected ? ubBody.querySelector('#tl-ub-sources') : null; if (el && opt.on) el.innerHTML = sourcesHtml(); }
  function onUbClick(ev) {
    const t = ev.target && ev.target.closest ? ev.target.closest('[data-ub-opt],[data-ub-act],[data-ub-size]') : null; if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    if (t.dataset.ubSize) { lsSet(UB_SIZE_KEY, t.dataset.ubSize); return renderUnblockWindow(); }
    if (t.dataset.ubOpt) return setOpt(t.dataset.ubOpt, !opt[t.dataset.ubOpt]);
    const act = t.dataset.ubAct;
    if (act === 'close') closeUnblockWindow();
    else if (act === 'reload') location.reload();
    else if (act === 'check') { ubNote = ''; checkLatest(true); }
    else if (act === 'ffConsent') { if (typeof TL_DATA_CONSENT === 'function') TL_DATA_CONSENT(true); }
    else if (act === 'seenNew') { lsSet(UB_SEEN_KEY, VERSION); renderUnblockWindow(); ubBadge(); }
    else if (act === 'monUpdate' || act === 'monRestart' || act === 'monReset') monControl(act);
    else if (act === 'logReset') logResetClick();
    else if (act === 'monLog') { ubMon.logOpen = !ubMon.logOpen; if (ubMon.logOpen) { ubMon.log = null; monLog().then(monPaint); } monPaint(); }
    else doUpdate(act);
  }
  function newBody(cls) { const b = document.createElement('div'); b.className = 'tl-ub-c ' + cls; b.addEventListener('click', onUbClick); return b; }
  // (shown: its dot seen, the newest version looked up, the monitor asked while it is open)
  function shownNow() {
    if (whatsNewDue()) lsSet(UB_DOT_KEY, VERSION);
    ubBadge(); checkLatest(false);
    if (opt.on) monStart();
    if (typeof TL_DATA_CONSENT === 'function') helloConsent();     // (Firefox: is the count allowed - said under its switch)
  }
  const unblockWindowOpen = () => !!(ubBody && ubBody.isConnected && (HJ.st === 'on' || ubFloat));
  function openUnblockWindow() {
    addUnblockStyle();
    if (unblockWindowOpen() || HJ.st === 'opening') return;
    const it = ubItems.get('Widgets');
    if (ubNoLend || !it || !it.isConnected || !ubBar || !ubBar.contains(it)) return openStandIn();
    lendOpen(it);
  }
  function closeUnblockWindow() {
    if (ubFloat) return closeStandIn();
    if (HJ.st === 'on' && HJ.item && HJ.item.isConnected) progClick(HJ.item);      // (FR24 puts its window away: below)
  }

  // ---- FR24's own window, lent ----------------------------------------------------------------------------------------
  // LADD Unblock opens in the window of FR24's Widgets button: the button is pressed for it, and the window FR24 opens is
  // given this title and this content before the browser draws it - FR24's own list kept in it out of sight, and given back
  // when FR24 puts the window away. So it is FR24's window: its size, its grey title bar and its words, the way it appears
  // and goes. The window open before goes back as it does for any button; a flight or another button closes it as it closes
  // FR24's own; FR24's widget panels make way for it as for Widgets. On the bar, this button is drawn as Widgets is drawn
  // open, and Widgets as it was before it was pressed (a copy in its place, the button itself hidden): one thing open at a
  // time. (Widgets open already: it goes back first, then comes up as this.)
  const HJ = { st: 'off', item: null, host: null, keep: null, title: null, tnode: null, tdata: '', pressed: false, skip: null, before: null, t0: 0, reopen: false, rest: '', restFace: null, act: null, actSig: '', face: null };
  let ubProg = 0, ubNoLend = false, ubRestFace = null, ubCommon = '', barMo = null, hjTimer = 0;
  const lentOut = new Set();          // FR24 windows put away with this content in them, until they have gone
  // (a click by this script on one of FR24's own buttons - not one of the person's - on the button in it, if it is a box)
  const pressable = el => (el.matches('button,a,[role="button"]') ? el : el.querySelector('button,a,[role="button"]') || el);
  function progClick(el) { ubProg++; try { pressable(el).click(); } finally { ubProg--; } }
  // (drawn: in the page, and neither it nor what holds it hidden)
  function shownEl(el) {
    if (!el || !el.isConnected) return false;
    for (let a = el, n = 0; a && a.nodeType === 1 && n < 40; a = a.parentElement, n++) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden') return false; }
    return true;
  }
  const frame = f => (window.requestAnimationFrame ? requestAnimationFrame(f) : setTimeout(f, 16));
  const clock = () => (window.performance && performance.now ? performance.now() : Date.now());
  // (a bar button's look, to tell open from resting: the classes and styles of it and of what is in it, its icon's drawing aside)
  const lookEls = root => [root, ...root.querySelectorAll('*')].filter(x => !(x.classList && x.classList.contains('tl-ub-dot')) && (x.tagName.toLowerCase() === 'svg' || !x.closest('svg')));
  const lookOf = root => lookEls(root).map(x => [x.getAttribute('class'), x.getAttribute('style')]);
  const sigOf = look => (look ? look.map(p => (p[0] || '') + '/' + (p[1] || '')).join('|') : '');
  // (the bar's buttons open now: those not in the look most of them share - only where that is plain)
  function openItems() {
    const its = [...ubItems.values()].filter(x => x.isConnected), odd = its.filter(x => sigOf(lookOf(x)) !== ubCommon);
    return ubCommon && odd.length <= 1 && its.length - odd.length >= 3 ? odd : [];
  }
  // (a copy of one of the bar's buttons as it looks now: made into this one - its icon and label - or, for Widgets' place
  // while this has its window, left as it is)
  function faceOf(src, label, mine) {
    const b = src.cloneNode(true);
    b.removeAttribute('data-tl-ub-under');
    for (const el of [b, ...b.querySelectorAll('*')]) {
      for (const at of ['id', 'href', 'aria-pressed', 'aria-expanded', 'aria-current', 'aria-selected', 'data-state']) el.removeAttribute(at);
      if (el.hasAttribute('data-testid')) { if (mine) el.setAttribute('data-testid', 'tl-ladd-unblock'); else el.removeAttribute('data-testid'); }
    }
    for (const d of b.querySelectorAll('.tl-ub-dot')) d.remove();
    if (!mine) { b.classList.add('tl-ub-face'); return b; }
    const icon = b.querySelector('svg');
    if (icon) {
      const holder = document.createElement('span'); holder.innerHTML = UB_ICON; const own = holder.firstChild;
      for (const at of ['class', 'width', 'height', 'style']) if (icon.hasAttribute(at)) own.setAttribute(at, icon.getAttribute(at));
      for (const at of icon.getAttributeNames()) if (/^data-v-/.test(at)) own.setAttribute(at, '');
      if (!icon.hasAttribute('width') && !icon.hasAttribute('class')) { own.setAttribute('width', '24'); own.setAttribute('height', '24'); }
      icon.replaceWith(own);
    }
    const leaf = [b, ...b.querySelectorAll('*')].find(el => [...el.childNodes].some(n => n.nodeType === 3 && n.data.trim() === label));
    if (leaf) { for (const n of [...leaf.childNodes]) if (n.nodeType === 3 && n.data.trim() === label) n.data = n.data.replace(label, 'LADD Unblock'); leaf.setAttribute('data-tl-ub-label', ''); }
    b.classList.add('tl-ub-btn'); b.setAttribute('title', 'LADD Unblock'); b.setAttribute('aria-label', 'LADD Unblock');
    if (b.tagName === 'A') b.setAttribute('role', 'button');
    return b;
  }
  // (this button given a face's attributes and insides - it stays the same element, with its click)
  function dress(el, face) {
    for (const at of el.getAttributeNames()) if (!face.hasAttribute(at)) el.removeAttribute(at);
    for (const at of face.getAttributeNames()) if (el.getAttribute(at) !== face.getAttribute(at)) el.setAttribute(at, face.getAttribute(at));
    el.replaceChildren(...[...face.childNodes].map(n => n.cloneNode(true)));
  }
  // (this button drawn as Widgets is drawn open - as soon as FR24 draws it so - and Widgets as it was at rest; or both back)
  function swapBar(on) {
    const it = HJ.item;
    if (on && it && it.isConnected) {
      const sig = sigOf(lookOf(it));
      if (ubBtn && HJ.rest && sig !== HJ.rest && sig !== HJ.actSig) { HJ.actSig = sig; learnLook('open', it); HJ.act = faceOf(it, 'Widgets', true); dress(ubBtn, HJ.act); ubBadge(); }
      if (ubBtn && !HJ.act) ubBtn.classList.add('tl-ub-btn-on');
      if (HJ.restFace) {
        if (!HJ.face || !HJ.face.isConnected || HJ.face.previousElementSibling !== it) {
          if (HJ.face) HJ.face.remove();
          HJ.face = HJ.restFace.cloneNode(true);
          HJ.face.addEventListener('click', onFaceClick);
          it.after(HJ.face);
        }
        if (!it.hasAttribute('data-tl-ub-under')) it.setAttribute('data-tl-ub-under', '');
      }
    } else {
      if (ubBtn && ubRestFace) { dress(ubBtn, ubRestFace); ubBadge(); }
      if (ubBtn) ubBtn.classList.remove('tl-ub-btn-on');
      if (HJ.face) { HJ.face.remove(); HJ.face = null; }
      if (it) it.removeAttribute('data-tl-ub-under');
      HJ.act = null; HJ.actSig = '';
    }
    // (open: its icon drawn as FR24 draws an open button's - see ubIconStyle)
    if (ubBtn) ubBtn.toggleAttribute('data-tl-ub-open', !!(on && it && it.isConnected));
    if (barMo) barMo.takeRecords();
  }
  // (Widgets, in its resting look, pressed while this has its window: FR24 puts the window away, then Widgets' own comes up)
  function onFaceClick(ev) {
    ev.preventDefault(); ev.stopPropagation();
    if (HJ.st !== 'on' || !HJ.item || !HJ.item.isConnected) return;
    HJ.reopen = true; progClick(HJ.item);
  }
  // (FR24 drawing Widgets afresh: drawn open - this button takes that look; drawn at rest - FR24 has put the window away)
  function watchBar() {
    if (barMo) barMo.disconnect();
    if (typeof MutationObserver !== 'function' || !ubBar) return;
    barMo = new MutationObserver(recs => {
      try { if (recs.some(r => !(r.target.closest && r.target.closest('.tl-ub-btn,.tl-ub-face')))) ubResync(); } catch (e) { log('LADD Unblock button', e); }
      const it = HJ.item;
      if (HJ.st === 'off' && !ubFloat) { try { learnBarLooks(); } catch (e) { log('LADD Unblock button', e); } }
      if (!it || !(HJ.st === 'on' || (HJ.st === 'opening' && HJ.pressed)) || !HJ.rest || !recs.some(r => it.contains(r.target))) return;
      if (sigOf(lookOf(it)) !== HJ.rest) swapBar(true); else if (HJ.st === 'on') lendDone();
    });
    barMo.observe(ubBar, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true });
  }
  // FR24's Widgets window: its title "Widgets" (not the bar's), drawn, in a title band - the highest box round it no taller
  // than one, a window's width - in a box about as wide (the window) that holds the rest of the window beside it. (that box
  // is where this content goes; what sits in the title band - the title, the close button - stays)
  function titleLeaves(word) {
    const out = [], w = (word || 'widgets').toLowerCase(); if (!document.body) return out;
    const tw = document.createTreeWalker(document.body, 4);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.data.length > 24 || n.data.trim().toLowerCase() !== w) continue;
      const el = n.parentElement;
      if (!el || out.includes(el) || el.closest('.tl-ub,.tl-ub-c,.tl-ub-btn,.tl-ub-face,script,style') || (ubBar && ubBar.contains(el)) || !shownEl(el)) continue;
      out.push(el);
    }
    return out;
  }
  function widgetsWindows() {
    const out = [];
    for (const t of titleLeaves()) {
      let head = null;
      for (let a = t, d = 0; a && a !== document.body && d < 8; a = a.parentElement, d++) { const h = a.offsetHeight; if (h > 96) break; if (h > 0 && a.offsetWidth >= 200 && a.offsetWidth <= 660) head = a; }
      if (!head) continue;
      let keep = head, host = head.parentElement;
      while (host && host !== document.body && host.children.length < 2 && host.offsetWidth <= head.offsetWidth + 48) { keep = host; host = host.parentElement; }
      if (!host || host === document.body || host === document.documentElement || (ubBar && host.contains(ubBar))) continue;
      if (host.offsetWidth < head.offsetWidth - 2 || host.offsetWidth > head.offsetWidth + 48 || host.offsetWidth > 700) continue;
      out.push({ title: t, keep, host });
    }
    return out;
  }
  const widgetsWindow = not => widgetsWindows().find(w => !(not && not.has(w.host))) || null;
  function lendOpen(it) {
    HJ.st = 'opening'; HJ.item = it; HJ.pressed = false; HJ.reopen = false; HJ.skip = null; HJ.before = null;
    const own = widgetsWindow();
    if (!own) return lendPress(it);
    // (FR24's own Widgets open: put away first - its going drawn - then pressed again for this)
    HJ.skip = own.host;
    progClick(it);
    const t0 = clock(), wait = () => {
      if (HJ.st !== 'opening') return;
      const still = HJ.skip && HJ.skip.isConnected && shownEl(HJ.skip);
      if (still && clock() - t0 < 1500) return frame(wait);
      if (!still) HJ.skip = null;
      lendPress(it);
    };
    frame(wait);
  }
  function lendPress(it) {
    // (still open after all - FR24 did not put it away: that window is the one)
    if (HJ.skip) { const w = widgetsWindow(); HJ.skip = null; if (w) { HJ.pressed = true; return lend(w); } }
    // (Widgets as it is before it is pressed: its resting look; the windows titled Widgets there already are not the one)
    HJ.rest = sigOf(lookOf(it)); HJ.restFace = faceOf(it, 'Widgets', false);
    HJ.before = new Set(widgetsWindows().map(w => w.host));
    HJ.pressed = true; HJ.t0 = clock();
    progClick(it);
    // (looked for as FR24 puts it in - its update, then this - and every frame after, two seconds at most)
    Promise.resolve().then(lendScan);
    const tick = () => { if (HJ.st !== 'opening') return; if (lendScan()) return; if (clock() - HJ.t0 > 2000) return lendFail(); frame(tick); };
    frame(tick);
  }
  function lendScan() {
    if (HJ.st !== 'opening' || !HJ.pressed) return HJ.st === 'on';
    const w = widgetsWindow(HJ.before);
    if (w) { lend(w); return true; }
    // (this window, put away a moment ago and still there, brought back by FR24 as it was - Widgets drawn open: kept so)
    if (HJ.rest && HJ.item && sigOf(lookOf(HJ.item)) !== HJ.rest) {
      for (const L of lentOut) if (L.host.isConnected && shownEl(L.host) && L.tnode && L.tnode.data.trim() === 'LADD Unblock') { lentOut.delete(L); readopt(L); return true; }
    }
    return false;
  }
  function readopt(L) {
    HJ.st = 'on'; HJ.pressed = false; HJ.before = null; HJ.reopen = false;
    HJ.host = L.host; HJ.keep = L.keep; HJ.tnode = L.tnode; HJ.tdata = L.tdata; HJ.title = L.tnode && L.tnode.isConnected ? L.tnode.parentElement : null; ubBody = L.body; HJ.item = ubItems.get('Widgets') || HJ.item;
    swapBar(true); shownNow();
    if (!hjTimer) hjTimer = setInterval(() => lendKeep(true), 250);
  }
  // (FR24's window not found: what was pressed undone, and the stand-in opened instead - from now on at once)
  function lendFail() {
    HJ.st = 'off'; HJ.pressed = false; HJ.before = null; ubNoLend = true;
    // (Widgets drawn open: FR24 opened something for it, and put away what was open - that is put away in turn)
    const it = HJ.item, opened = !!(it && it.isConnected && HJ.rest && sigOf(lookOf(it)) !== HJ.rest);
    swapBar(false);
    if (opened) progClick(it);
    log('LADD Unblock window', 'FR24\'s Widgets window not found - the stand-in is used');
    openStandIn(opened);
  }
  function lend(w) {
    HJ.host = w.host; HJ.keep = w.keep; HJ.title = w.title; HJ.before = null;
    // (its title: written into FR24's own words - FR24 leaves a title it has not changed alone)
    const tn = [...w.title.childNodes].find(n => n.nodeType === 3 && n.data.trim().toLowerCase() === 'widgets') || null;
    HJ.tnode = tn; HJ.tdata = tn ? tn.data : ''; if (tn) tn.data = tn.data.replace(/\S.*\S|\S/, 'LADD Unblock');
    const kb = w.keep.getBoundingClientRect();
    for (const c of w.host.children) { const r = c.getBoundingClientRect(); if (c === w.keep || (kb.height > 0 && r.height > 0 && r.top < kb.bottom - 1 && r.height <= kb.height + 2)) c.setAttribute('data-tl-ub-keep', ''); }
    try { learnSwitch(w.host); } catch (e) { /* drawn as before */ }
    w.host.setAttribute('data-tl-ub-host', '');
    ubBody = newBody('tl-ub-in');
    w.host.appendChild(ubBody);
    HJ.st = 'on'; HJ.pressed = false;
    renderUnblockWindow();
    swapBar(true);
    bookmarksSweep(w.host);
    shownNow();
    if (!hjTimer) hjTimer = setInterval(() => lendKeep(true), 250);
  }
  // (FR24 drawing its window afresh while it still shows Widgets open - its data refreshed, its window rebuilt: the new window,
  // as it comes in, is given this title and content in turn, and the old one goes as FR24 sends it)
  function relend() {
    const it = HJ.item;
    if (HJ.st !== 'on' || HJ.reopen || !it || !it.isConnected || !HJ.rest || sigOf(lookOf(it)) === HJ.rest) return false;
    const w = widgetsWindows().find(x => x.host !== HJ.host);
    if (!w) return false;
    lend(w);
    return true;
  }
  const addedTitle = recs => { for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1 && !n.closest('.tl-ub,.tl-ub-c,.tl-ub-btn,.tl-ub-face') && /widgets/i.test(n.textContent || '')) return true; return false; };
  // (while open: this content kept in it, its title kept; FR24 having put the window away, or using it for something else
  // - its title changed - it is given back. Looked at fully four times a second, and cheaply at each change to the page)
  function lendKeep(full) {
    if (HJ.st !== 'on') { if (hjTimer) { clearInterval(hjTimer); hjTimer = 0; } return; }
    const host = HJ.host;
    if (!host || !host.isConnected || (full && !shownEl(host))) { if (relend()) return; return lendDone(); }
    if (HJ.tnode && HJ.tnode.data.trim() !== 'LADD Unblock') { if (HJ.tnode.isConnected && HJ.tnode.data.trim().toLowerCase() === 'widgets') HJ.tnode.data = HJ.tnode.data.replace(/\S.*\S|\S/, 'LADD Unblock'); else return lendDone(); }
    if (!host.hasAttribute('data-tl-ub-host')) host.setAttribute('data-tl-ub-host', '');
    if (HJ.keep && HJ.keep.parentElement === host && !HJ.keep.hasAttribute('data-tl-ub-keep')) HJ.keep.setAttribute('data-tl-ub-keep', '');
    if (ubBody && ubBody.parentElement !== host) host.appendChild(ubBody);
    if (full) { fitBody(); if (HJ.item && HJ.item.isConnected && (!HJ.face || !HJ.face.isConnected)) swapBar(true); }
  }
  // FR24 has put its window away: both buttons as they were, and the window watched until it has gone - its going drawn
  // with this content in it - to give FR24's own back to it if it is only hidden for next time (at once if FR24 uses it for
  // something else). Widgets pressed while this was open: it opens once this has gone, as from any other button.
  function lendDone() {
    if (HJ.st !== 'on') return;
    const L = { host: HJ.host, keep: HJ.keep, tnode: HJ.tnode, tdata: HJ.tdata, body: ubBody, reopen: HJ.reopen, at: clock() };
    swapBar(false);
    HJ.st = 'off'; HJ.host = HJ.keep = HJ.title = HJ.tnode = null; HJ.reopen = false;
    monStop(); ubBody = null;
    if (hjTimer) { clearInterval(hjTimer); hjTimer = 0; }
    if (L.host) { lentOut.add(L); checkLent(); if (lentOut.has(L)) frame(function tick() { checkLent(); if (lentOut.has(L)) frame(tick); }); }
  }
  function checkLent() {
    for (const L of [...lentOut]) {
      const gone = !L.host.isConnected || !shownEl(L.host), reused = !gone && !!L.tnode && (!L.tnode.isConnected || L.tnode.data.trim() !== 'LADD Unblock');
      // (still there, unchanged, well after: FR24 kept it open after all - this content stays in it, and is open again)
      if (!gone && !reused && clock() - L.at < 1500) continue;
      lentOut.delete(L);
      if (L.host.isConnected && (gone || reused)) giveBack(L);
      else if (!gone && HJ.st === 'off' && !ubFloat) { readopt(L); continue; }
      if (L.reopen && HJ.st === 'off') { const it = ubItems.get('Widgets'); if (it && it.isConnected) progClick(it); }
    }
  }
  function giveBack(L) {
    if (L.body && L.body.parentElement === L.host) L.body.remove();
    L.host.removeAttribute('data-tl-ub-host');
    for (const c of [...L.host.children]) c.removeAttribute('data-tl-ub-keep');
    if (L.tnode && L.tnode.isConnected && L.tnode.data.includes('LADD Unblock')) L.tnode.data = L.tdata || 'Widgets';
  }
  // (no taller than the room from its title bar down to FR24's bar - where FR24's own windows end - nor than FR24's window
  // lets it be, where that is fixed)
  const layoutTop = el => { let y = 0; for (let a = el, n = 0; a && n < 40; a = a.offsetParent, n++) y += a.offsetTop || 0; return y; };
  function fitBody() {
    if (!ubBody || !ubBody.isConnected || !HJ.host) return;
    // (FR24's windows reach down beside the bar - it is in the middle - to where the window's own limit puts them: this is
    // let as tall as the page, and the window's limit, found below, cuts it to the same height as FR24's own)
    const vh = window.innerHeight || 800, top = layoutTop(ubBody);
    if (!(top > 0) || !(vh > top)) return;
    let mh = Math.max(160, vh - top - 10);
    ubBody.style.maxHeight = mh + 'px';
    const host = HJ.host, over = host.scrollHeight - host.clientHeight;
    if (over > 1 && getComputedStyle(host).overflowY !== 'visible') { mh = Math.max(120, mh - over); ubBody.style.maxHeight = mh + 'px'; }
  }

  // ---- the stand-in: where FR24's window cannot be had, one drawn like it -------------------------------------------------
  // FR24's size and title bar, on the left above the bar; the window of another bar button is closed as that button would,
  // FR24's widget panels make way while it is open; FR24's buttons, a flight's or an airport's panel, or Escape close it.
  let ubFloat = null;
  function openStandIn(cleared) {
    if (ubFloat && ubFloat.isConnected) return;
    const w = document.createElement('div'); w.className = 'tl-ub tl-ub-enter'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', 'LADD Unblock');
    w.innerHTML = `<div class="tl-ub-head"><span>LADD Unblock</span><button type="button" class="tl-ub-x" aria-label="Close" title="Close">${UB_X}</button></div>`;
    w.querySelector('.tl-ub-x').addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); closeStandIn(); });
    ubBody = newBody('tl-ub-body'); w.appendChild(ubBody);
    document.body.appendChild(w); ubFloat = w;
    renderUnblockWindow(); placeStandIn();
    frame(() => frame(() => w.classList.remove('tl-ub-enter')));
    if (ubBtn) ubBtn.classList.add('tl-ub-btn-on');
    if (!cleared) for (const it of openItems()) progClick(it);
    standInMakeWay();
    shownNow();
  }
  function closeStandIn() {
    const w = ubFloat; if (!w) return;
    ubFloat = null; ubBody = null; monStop(); standInMakeWay();
    if (ubBtn) ubBtn.classList.remove('tl-ub-btn-on');
    w.classList.add('tl-ub-going'); setTimeout(() => w.remove(), 220);
  }
  function placeStandIn() {
    if (!ubFloat) return;
    const vh = window.innerHeight || 800, barTop = ubBar && ubBar.isConnected ? layoutTop(ubBar) : vh - 70;
    ubFloat.style.maxHeight = Math.max(240, Math.min(vh, barTop > 100 ? barTop : vh) - 8 - 10) + 'px';
  }
  // (FR24's widget panels on the map, found by their titles: out of sight while the stand-in is open, back after)
  const UB_WIDGET_TITLES = ['most tracked flights', 'airport disruptions', 'statistics', 'last-clicked flights', 'latest blog posts', 'bookmarks'];
  function standInMakeWay() {
    if (!ubFloat) { for (const e of document.querySelectorAll('[data-tl-ub-hid]')) e.removeAttribute('data-tl-ub-hid'); return; }
    const L = leavesByText(UB_WIDGET_TITLES), all = UB_WIDGET_TITLES.flatMap(t => L.get(t));
    for (const leaf of all) { const b = boxOf(leaf, all); if (b && b !== leaf) b.setAttribute('data-tl-ub-hid', ''); }
  }

  // ---- FR24's Bookmarks widget: off by default, the user's to switch on --------------------------------------------------
  // (1.1.1) Its row is in FR24's Widgets list as FR24 has it. The first time the list is seen with Bookmarks "On", its "On"
  // is pressed once, so FR24 itself keeps it off (and says so, "Off"); from then on it is left to the user - switched on
  // there, FR24 puts it on the map as its own. Until that first time (the list never opened) the widget is hidden wherever
  // FR24 puts it - a mutation observer's answer comes before the browser paints - so off by default is never seen as on.
  // All found by their words, not by FR24's class names (it is a Vue app); never in a menu, a link, a flight's or an
  // airport's panel.
  const UB_BM_KEY = 'tweeks.fr24.ladd.bmdefault';
  let bmDefaulted = lsGet(UB_BM_KEY) === '1';
  let bmPressedAt = 0;
  function leavesByText(wanted, root) {
    const out = new Map(wanted.map(w => [w, []]));
    const r0 = root || document.body; if (!r0) return out;
    const tw = document.createTreeWalker(r0, 4);
    for (let n = r0.nodeType === 3 ? r0 : tw.nextNode(); n; n = tw.nextNode()) {
      const t = n.data; if (t.length > 40) continue;
      const k = t.trim().toLowerCase(), list = out.get(k); if (!list) continue;
      const el = n.parentElement; if (!el || el.closest('.tl-ub,.tl-ub-c,.tl-ub-btn,.tl-ub-face,.tl-pop,script,style') || (ubBar && ubBar.contains(el))) continue;
      list.push(el);
    }
    return out;
  }
  // the whole widget round its title: up until the next box would hold another widget's title (or is wider than a panel),
  // and no further than a box that is placed on the page itself
  function boxOf(leaf, others) {
    let best = null;
    for (let a = leaf.parentElement, d = 0; a && a !== document.body && a !== document.documentElement && d < 8; a = a.parentElement, d++) {
      if (a.offsetWidth > 520 || others.some(o => o !== leaf && a.contains(o))) break;
      best = a;
      const pos = getComputedStyle(a).position; if (pos === 'fixed' || pos === 'absolute') break;
    }
    return best;
  }
  const ownWords = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.data).join('').trim();
  function bookmarksSweep(root) {
    if (!opt.on || bmDefaulted || !root || !/bookmarks/i.test(root.textContent || '')) return;
    const mine = leavesByText(['bookmarks'], root).get('bookmarks');
    if (!mine.length) return;
    const L = leavesByText(UB_WIDGET_TITLES), all = UB_WIDGET_TITLES.flatMap(t => L.get(t));
    for (const leaf of mine) {
      if (leaf.closest('a,nav,aside,header,[role="menu"],[role="menubar"],#aside-main-menu,[data-testid^="aircraft-panel"],[data-testid="airport-panel"],[data-testid^="search"]')) continue;
      const box = boxOf(leaf, all.filter(x => x !== leaf)); if (!box || box === leaf) continue;
      // (its row in the Widgets list - the list says "Enable widgets": switched off there once, if it is on, and shown)
      let list = null; for (let a = box.parentElement, d = 0; a && a !== document.body && d < 6; a = a.parentElement, d++) if (/enable widgets/i.test(a.textContent || '')) { list = a; break; }
      if (!list) { if (!box.hasAttribute('data-tl-gone')) box.setAttribute('data-tl-gone', ''); continue; }
      const sw = [...box.querySelectorAll('*')].find(e => /^(on|off)$/i.test(ownWords(e)));
      if (!sw) continue;
      if (/^on$/i.test(ownWords(sw))) { if (now() - bmPressedAt < 2000) continue; bmPressedAt = now(); const b = sw.closest('button,[role="button"],[role="switch"],label') || sw; if (box.contains(b)) progClick(b); }
      bmDone();
      return;
    }
  }
  // (the default set: FR24 keeps Bookmarks off - nothing hidden from now on, the widget FR24's and the user's)
  function bmDone() {
    bmDefaulted = true; lsSet(UB_BM_KEY, '1');
    for (const e of document.querySelectorAll('[data-tl-gone]')) e.removeAttribute('data-tl-gone');
  }
  // (1.1.2) FR24's Bookmarks widget asks a free account to upgrade for more than one bookmark - "To get more than 1
  // bookmark, please upgrade..." with its trial button - in the widget itself: that box taken out as it is put in, the
  // widget's own tabs, list and "Add bookmark" left as they are. Found by its words; the box is the largest one round
  // them that holds neither the tabs nor "Add bookmark".
  const BEG_RE = /^to get more than \d+ bookmarks?\b/i;
  function begSweep(root) {
    if (!opt.on || !root || root.nodeType !== 1 || !/more than \d+ bookmark/i.test(root.textContent || '')) return;
    const tw = document.createTreeWalker(root, 4);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!BEG_RE.test(n.data.trim())) continue;
      let box = n.parentElement; if (!box || box.closest('[data-tl-beg],.tl-ub,.tl-ub-c')) continue;
      for (let a = box.parentElement, d = 0; a && a !== document.body && d < 6; a = a.parentElement, d++) {
        const t = a.textContent || '';
        if (/add bookmark/i.test(t) || /\baircraft\b[\s\S]*\bflights\b[\s\S]*\bairports\b/i.test(t)) break;
        box = a;
      }
      box.setAttribute('data-tl-beg', '');
    }
  }
  function bookmarksMut(recs) {
    for (const r of recs) {
      if (r.type === 'characterData') { const p = r.target.parentElement; if (p && /more than \d+ bookmark/i.test(r.target.data || '')) begSweep(p.parentElement || p); continue; }
      for (const n of r.addedNodes) if (n.nodeType === 1) begSweep(n); else if (n.nodeType === 3 && n.parentElement) begSweep(n.parentElement.parentElement || n.parentElement);
    }
    for (const r of recs) {
      if (r.type === 'characterData') { const p = r.target.parentElement; if (p && /bookmarks/i.test(r.target.data || '')) bookmarksSweep(p.parentElement || p); continue; }
      for (const n of r.addedNodes) { if (n.nodeType === 1) bookmarksSweep(n); else if (n.nodeType === 3 && /bookmarks/i.test(n.data || '') && n.parentElement) bookmarksSweep(n.parentElement.parentElement || n.parentElement); }
    }
  }

  // ---- the button's icon: drawn as FR24 draws its buttons' icons at rest, under the mouse and open ----------------------
  // FR24's icons are drawn in another colour when a button is pointed at, and thicker and in another colour when it is open:
  // read off its own buttons in each state (at rest, the one under the mouse, the one open) and kept for next time. This
  // icon is a line drawing: it takes their colour - its line as at rest under the mouse, thicker open. (It was copied with
  // FR24's classes on the icon itself, and FR24 draws the change on the drawing inside it: it stayed as it was.)
  const UB_LOOK_KEY = 'tweeks.fr24.ladd.barlook';
  // (a colour as the browser gives it, or the text colour - what is kept goes into a stylesheet: nothing else is let in)
  const lookOk = L => !!L && typeof L === 'object' && (L.col === 'currentColor' || /^(rgba?\([\d.,\s%/]+\)|#[0-9a-f]{3,8})$/i.test(String(L.col))) && typeof L.sw === 'number' && L.sw >= 0 && L.sw < 20;
  let ubLook = (() => { const out = {}; try { const o = JSON.parse(lsGet(UB_LOOK_KEY) || '{}'); for (const k of ['rest', 'hover', 'open']) if (o && lookOk(o[k])) out[k] = o[k]; } catch (e) { /* none kept */ } return out; })();
  // (the colour its drawing is in - the text colour where it is that, so this one follows the text colour as FR24's does,
  // whatever else recolours the page)
  function iconLook(it) {
    const s = it && it.querySelector('svg'); if (!s) return null;
    const sh = s.querySelector('path,rect,circle,ellipse,line,polyline,polygon') || s;
    let cs, text; try { cs = getComputedStyle(sh); text = getComputedStyle(s).color; } catch (e) { return null; }
    const stroke = cs.stroke && cs.stroke !== 'none' ? cs.stroke : '', fill = cs.fill && cs.fill !== 'none' ? cs.fill : '', sw = stroke ? parseFloat(cs.strokeWidth) : NaN;
    const raw = stroke || fill, L = { col: raw && raw === text ? 'currentColor' : raw, sw: isFinite(sw) && sw > 0 ? sw : 0 };
    return lookOk(L) ? L : null;
  }
  function learnLook(state, it) {
    const L = iconLook(it); if (!L) return;
    const was = ubLook[state]; if (was && was.col === L.col && was.sw === L.sw) return;
    ubLook[state] = L; lsSet(UB_LOOK_KEY, JSON.stringify(ubLook)); ubIconStyle();
  }
  // (the lines as at rest under the mouse - only the colour changes there - and clearly thicker open: 2.3 to 1.5, whatever
  // FR24's own grow by - read off FR24's, the change was too slight to see, and none at all where FR24 draws it by swapping
  // its icon; FR24's yellow when open where its look has not been seen)
  const UB_W = { rest: 1.5, open: 2.3 };
  function ubIconStyle() {
    let el = document.getElementById('tl-ub-icon-style');
    if (!el) { el = document.createElement('style'); el.id = 'tl-ub-icon-style'; (document.head || document.documentElement).appendChild(el); }
    const col = st => (ubLook[st] && ubLook[st].col) || (st === 'open' ? '#f8c023' : 'currentColor');
    const I = 'svg[data-tl-ub-icon] *';
    const css = `.tl-ub-btn ${I}{stroke:${col('rest')};stroke-width:${UB_W.rest};transition:stroke .15s,stroke-width .15s}
.tl-ub-btn:hover ${I},.tl-ub-btn:focus-visible ${I}{stroke:${col('hover')};stroke-width:${UB_W.rest}}
.tl-ub-btn[data-tl-ub-open] ${I},.tl-ub-btn.tl-ub-btn-on ${I}{stroke:${col('open')}!important;stroke-width:${UB_W.open}!important}`;
    if (el.textContent !== css) el.textContent = css;
  }
  // (one of FR24's buttons pointed at - not open: its look under the mouse, once FR24 has drawn it so)
  let ubHoverT = 0;
  function onBarOver(ev) {
    const it = [...ubItems.values()].find(x => x.contains(ev.target)); if (!it || it.hasAttribute('data-tl-ub-under')) return;
    if (sigOf(lookOf(it)) !== ubCommon) return;
    clearTimeout(ubHoverT);
    ubHoverT = setTimeout(() => { try { if (it.isConnected && it.matches(':hover')) learnLook('hover', it); } catch (e) { /* no :hover */ } }, 400);
  }
  // (FR24's buttons at rest - one not pointed at - and one of theirs open, as they come)
  function learnBarLooks() {
    const its = [...ubItems.values()].filter(x => x.isConnected && !x.hasAttribute('data-tl-ub-under'));
    const rest = its.find(x => { try { return sigOf(lookOf(x)) === ubCommon && !x.matches(':hover'); } catch (e) { return false; } });
    if (rest) learnLook('rest', rest);
    const open = openItems()[0]; let hov = true; try { hov = !!open && open.matches(':hover'); } catch (e) { /* no :hover */ }
    if (open && !hov && !open.hasAttribute('data-tl-ub-under')) learnLook('open', open);
  }

  // ---- a click on the map puts the bar's open window away, as its X does ----------------------------------------------
  // A click - pressed and let go within a few pixels, not a drag of the map - on the map itself (FR24's map, or a canvas
  // over most of the page), never in a window, on the bar or in a panel: the window open - LADD Unblock's, or that of FR24's
  // own Settings, Weather, Filters, Widgets or Playback - put away by its own X the moment the mouse is let go, before FR24
  // hears of the click. (FR24 answers every map click by trying to select a flight, and draws the open window afresh a
  // quarter of a second later: pressed after that, the window was seen to go and come back before it closed.) Then watched
  // for eight seconds: open again and still for a quarter of a second, its X pressed again (four presses at most). Never a
  // bar button: pressing one opens a window as readily as it closes one. Nothing more is pressed once a bar button has been
  // pressed since the click (the person's own choice). Playback's is put away only a moment after, and not where the click
  // picked a flight on its map.
  const UB_MAP_SEL = '.gm-style,.maplibregl-map,.mapboxgl-map,.leaflet-container,.ol-viewport';
  const UB_PANEL_SEL = '[data-testid^="aircraft-panel"],[data-testid="airport-panel"]';
  let ubDown = null, ubTrack = null, ubBarAt = -1e9;
  // (a window's close button, in its title band: named so - its label, title, class or test id - or drawn as an X; or the
  // one thing there that is only a picture, as small as a button - the rightmost where there are more. Not a button only:
  // FR24 may draw its X as a picture with a click on it. None of these: nothing)
  function closeBtnIn(box, title) {
    if (!box || !box.isConnected) return null;
    const tr = title && title.isConnected ? title.getBoundingClientRect() : null;
    const band = r => !tr || !tr.height || !r.height || (r.top < tr.bottom + 12 && r.bottom > tr.top - 12);
    const els = [...box.querySelectorAll('*')].filter(e => !e.closest('.tl-ub-c,.tl-ub,' + UB_PANEL_SEL) && !(title && (e.contains(title) || title.contains(e))));
    const ok = e => { const r = e.getBoundingClientRect(); return band(r) && r.width <= 64 && r.height <= 64 && shownEl(e); };
    const outer = list => list.filter(e => !list.some(o => o !== e && o.contains(e)));
    const named = outer(els.filter(e => /\b(close|dismiss)\b/i.test((e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')) || /(^|[\s_-])(close|dismiss)([\s_-]|$)/i.test((e.getAttribute('data-testid') || '') + ' ' + (typeof e.className === 'string' ? e.className : '')) || (!e.children.length && /^[×✕✖xX]$/.test(e.textContent.trim())))).filter(ok);
    if (named.length) return named[0];
    const pics = outer(els.filter(e => !e.textContent.trim() && (e.matches('svg,img') || e.querySelector('svg,img')) && !e.closest('svg') && ok(e)));
    if (!pics.length) return null;
    return pics.reduce((m, e) => (e.getBoundingClientRect().right > m.getBoundingClientRect().right ? e : m));
  }
  // (the window of one of the bar's buttons, open: its title - not the bar's, a panel's or a button's words - and its title
  // band, where its close button is: the highest box round the title no taller than a title band and no wider than a
  // window. Nothing beyond it is looked at: a picture-only button of FR24's elsewhere at that height - its header's - was
  // taken for the X, and pressed, opened Widgets)
  // (a bar's words, not a window's: a box round them, as short as a bar, holding four of the bar's labels - whether or not
  // it is the bar this button was put on)
  function inBarLike(t) {
    for (let a = t.parentElement, n = 0; a && a !== document.body && n < 6; a = a.parentElement, n++) {
      const r = a.getBoundingClientRect(), txt = a.textContent || '';
      if (r.height > 0 && r.height < 120 && UB_LABELS.filter(l => txt.includes(l)).length >= 4) return true;
    }
    return false;
  }
  const barTitles = label => (label === 'LADD Unblock' ? (HJ.st === 'on' && HJ.title && HJ.title.isConnected ? [HJ.title] : []) : titleLeaves(label).filter(t => !t.closest(UB_PANEL_SEL + ',.tl-pop,.tl-strip,button,[role="button"],a') && !inBarLike(t)));
  function titleBand(t) {
    let head = t.parentElement;
    for (let a = t.parentElement, d = 0; a && a !== document.body && d < 8; a = a.parentElement, d++) {
      if (ubBar && a.contains(ubBar)) break;
      const r = a.getBoundingClientRect(); if (r.height > 96 || r.width > 720) break;
      head = a;
    }
    return head;
  }
  function barWindow(label) {
    for (const t of barTitles(label)) { const box = titleBand(t); if (box && closeBtnIn(box, t)) return { box, title: t }; }
    return null;
  }
  // (a click "pressed" on an element as the mouse presses it: FR24's X may answer to the press, not only to the click)
  function pressEl(el) {
    const r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    ubProg++;
    try {
      const P = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new P('pointerdown', Object.assign({ pointerId: 1, isPrimary: true }, o))); el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new P('pointerup', Object.assign({ pointerId: 1, isPrimary: true }, o))); el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent('click', o));
    } finally { ubProg--; }
  }
  // (the window open now - at the press on the map, before FR24 hears of it: its title on the page with its close button
  // beside it, as FR24 draws its windows - a header, the title in the middle, a button with only an X at its right. Not
  // by its button on the bar: a window was taken to be open only where exactly one of the bar's buttons looked unlike the
  // rest, and on FR24 that was never so - nothing was ever found open, and nothing was done)
  const BAR_WINDOWS = ['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'];
  function openWindowNow() {
    if (unblockWindowOpen()) return { label: 'LADD Unblock' };
    if (HJ.st !== 'off') return null;
    const l = BAR_WINDOWS.find(windowShown);
    return l ? { label: l } : null;
  }
  const pickSig = () => { const ps = document.querySelectorAll(UB_PANEL_SEL), cs = document.querySelector('[data-testid="aircraft-panel__header__callsign"]'); return ps.length + '|' + (cs ? cs.textContent.trim() : '') + '|' + location.href; };
  // (this window drawn now - its title in the page, shown - and not coming in or going out: Vue's transition classes on it
  // or on a box round it)
  const MOVING_RE = /(?:^|\s)[\w-]*-(?:enter|leave)-(?:active|from|to)(?:\s|$)/;
  function windowShown(label) {
    if (label === 'LADD Unblock') return unblockWindowOpen();
    const bw = barWindow(label); return !!bw && shownEl(bw.title);
  }
  function windowMoving(label) {
    const t = barTitles(label)[0];
    for (let a = t, n = 0; a && a !== document.body && n < 10; a = a.parentElement, n++) if (MOVING_RE.test(a.getAttribute('class') || '')) return true;
    return false;
  }
  // (put away as its X does: its X pressed - or, for the stand-in LADD Unblock draws itself, closed)
  function shutLabel(label) {
    if (label === 'LADD Unblock' && ubFloat) return closeStandIn();
    const bw = barWindow(label), x = bw && closeBtnIn(bw.box, bw.title);
    if (x) pressEl(x);
  }
  const SETTLE_MS = 8000, STABLE_MS = 250, PRESS_GAP_MS = 500, PRESS_MAX = 4;
  function settleTrack(tr) {
    const step = () => {
      try {
        if (ubTrack !== tr) return;
        const t = clock();
        if (t - tr.t0 > SETTLE_MS || ubBarAt > tr.t0) return;
        if (tr.w.label === 'Playback' && pickSig() !== tr.pick) return;
        // (LADD Unblock's window is FR24's Widgets window: put away, FR24 may bring its own Widgets back)
        const open = (tr.w.label === 'LADD Unblock' ? ['LADD Unblock', 'Widgets'] : [tr.w.label]).find(l => windowShown(l));
        if (!open || windowMoving(open)) tr.since = 0;
        else {
          if (!tr.since) tr.since = t;
          if (t - tr.since >= STABLE_MS && t - tr.last >= PRESS_GAP_MS && tr.n < PRESS_MAX) { tr.n++; tr.last = t; tr.since = 0; shutLabel(open); }
        }
      } catch (e) { log('LADD Unblock window', e); }
      if (ubTrack === tr) setTimeout(step, 150);
    };
    setTimeout(step, 150);
  }
  function onTheMap(t) {
    if (!t || t.nodeType !== 1 || !t.isConnected) return false;
    if (t.closest('.tl-ub,.tl-ub-c,.tl-ub-btn,.tl-ub-face,.tl-pop,.tl-strip,[data-tl-ub-host],[role="dialog"]') || (ubBar && ubBar.contains(t))) return false;
    if (t.closest(UB_MAP_SEL)) return true;
    if (t.tagName !== 'CANVAS') return false;
    const r = t.getBoundingClientRect(), W = window.innerWidth || 1, H = window.innerHeight || 1;
    return r.width * r.height >= 0.5 * W * H;
  }
  function onMapDown(ev) {
    const t = ev.target;
    if (t && t.nodeType === 1 && ((ubBar && ubBar.contains(t)) || t.closest('.tl-ub-btn,.tl-ub-face'))) ubBarAt = clock();
    ubDown = null;
    if (ubProg || ev.button !== 0 || ev.isPrimary === false || !onTheMap(t)) return;
    const w = openWindowNow(); if (!w) return;
    ubDown = { x: ev.clientX, y: ev.clientY, t: clock(), w, pick: pickSig() };
  }
  function onMapUp(ev) {
    const d = ubDown; ubDown = null;
    if (!d || ubProg || ev.button !== 0 || clock() - d.t > 800 || Math.abs(ev.clientX - d.x) > 6 || Math.abs(ev.clientY - d.y) > 6 || !onTheMap(ev.target)) return;
    const tr = ubTrack = { w: d.w, t0: clock(), pick: d.pick, since: 0, last: -1e9, n: 0 };
    if (d.w.label !== 'Playback') { tr.n = 1; tr.last = tr.t0; try { shutLabel(d.w.label); } catch (e) { log('LADD Unblock window', e); } }
    settleTrack(tr);
  }

  // ---- the button on FR24's bar ---------------------------------------------------------------------------------------
  // (the elements holding exactly these words - the bar's labels, and a window's title, which the bar test below leaves out -
  // in one walk over the page's text: label -> [elements])
  function labelLeaves(labels) {
    const out = {}; for (const l of labels) out[l] = [];
    if (!document.body) return out;
    const tw = document.createTreeWalker(document.body, 4), seen = new Set();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const t = n.data; if (t.length > 40) continue;
      const k = t.trim(); if (!(k in out)) continue;
      const el = n.parentElement; if (!el || seen.has(el) || el.closest('.tl-ub,.tl-ub-c,.tl-ub-btn,.tl-ub-face,.tl-pop,script,style')) continue;
      seen.add(el); out[k].push(el);
    }
    return out;
  }
  // the bar: the smallest element holding the labels of at least four of its buttons, each in a child of its own
  function findBar() {
    const leaves = labelLeaves(UB_LABELS);
    let best = null;
    for (const w of [...leaves.Widgets, ...leaves.Weather]) {
      for (let a = w.parentElement, d = 0; a && a !== document.body && d < 6; a = a.parentElement, d++) {
        const items = new Map();
        for (const l of UB_LABELS) { const leaf = leaves[l].find(x => a.contains(x)); if (!leaf) continue; let it = leaf; while (it.parentElement !== a) it = it.parentElement; items.set(l, it); }
        if (items.size < 4) continue;
        if (new Set(items.values()).size !== items.size) continue;   // (two labels in one child: not the bar's own row)
        const n = a.getElementsByTagName('*').length;
        if (n < 400 && (!best || n < best.n)) best = { bar: a, items, n };
        break;
      }
    }
    return best;
  }
  // (the look most of the bar's buttons share is the resting one)
  const classSig = el => sigOf(lookOf(el));
  function makeBarButton(found) {
    const items = [...found.items.values()], sigs = new Map();
    for (const it of items) sigs.set(classSig(it), (sigs.get(classSig(it)) || 0) + 1);
    ubCommon = [...sigs.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const wi = found.items.get('Widgets');
    const tpl = wi && classSig(wi) === ubCommon ? wi : items.find(it => classSig(it) === ubCommon) || items[0];
    const label = [...found.items.entries()].find(([, it]) => it === tpl)[0];
    const b = faceOf(tpl, label, true);
    ubRestFace = b.cloneNode(true);
    b.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (HJ.st === 'opening') return;
      if (unblockWindowOpen()) closeUnblockWindow(); else openUnblockWindow();
    });
    return b;
  }
  // (looked for again only when the page has changed since the last look)
  let ubMiss = 0, ubDirty = true;
  function ensureBarButton() {
    if (ubBtn && ubBtn.isConnected && ubBar && ubBar.contains(ubBtn)) return true;
    if (!ubDirty) return false;
    ubDirty = false;
    const found = findBar(); if (!found) { ubMiss++; return false; }
    ubMiss = 0; ubItems = found.items;
    if (found.bar !== ubBar) {
      ubBar = found.bar;
      // (FR24's own buttons, pressed by the person: the stand-in makes way)
      ubBar.addEventListener('click', ev => {
        if (ubProg) return;
        const t = ev.target; if (t && t.closest && t.closest('.tl-ub-btn,.tl-ub-face')) return;
        if (ubFloat) closeStandIn();
      }, true);
      ubBar.addEventListener('mouseover', onBarOver, true);
      watchBar();
    }
    placeBarButton(found);
    return true;
  }
  // (this button made from the bar's buttons as they look now, and put after the last of them)
  function placeBarButton(found) {
    const items = [...found.items.values()], last = items.reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a));
    if (ubBtn) ubBtn.remove();
    ubBtn = makeBarButton(found);
    last.after(ubBtn);
    if (HJ.st === 'on') { HJ.item = found.items.get('Widgets') || HJ.item; HJ.actSig = ''; HJ.act = null; swapBar(true); } else if (ubFloat) ubBtn.classList.add('tl-ub-btn-on');
    ubBadge();
    try { learnBarLooks(); } catch (e) { log('LADD Unblock button', e); }
  }
  // FR24 drawing its buttons another way while this one is there - smaller while its playback is open, larger when that is
  // put away, or its buttons drawn afresh in the same bar: this button made the same way as theirs again, before the
  // browser draws it (it was left as it was made: small beside buttons grown larger)
  let ubSyncing = false;
  function ubResync() {
    if (ubSyncing || !ubBtn || !ubBtn.isConnected || !ubBar || !ubBar.isConnected) return;
    ubSyncing = true;
    try {
      const found = findBar(); if (!found || found.bar !== ubBar) { ubDirty = true; return; }
      const sigs = new Map();
      for (const it of found.items.values()) sigs.set(classSig(it), (sigs.get(classSig(it)) || 0) + 1);
      const common = [...sigs.entries()].sort((a, b) => b[1] - a[1])[0][0];
      ubItems = found.items;
      if (common !== ubCommon) placeBarButton(found);
    } finally { ubSyncing = false; }
  }
  // (the bar drawn - or drawn again - as the page changes: this button put on it in the same turn, before the browser draws
  // the bar without it. Only where an element holding the bar's words came in, and not more than every 30 ms)
  let ubTryAt = 0;
  function ubBarCame(recs) {
    if (ubBtn && ubBtn.isConnected && ubBar && ubBar.contains(ubBtn)) return;
    if (clock() - ubTryAt < 30) return;
    let n = 0;
    for (const r of recs) for (const a of r.addedNodes) {
      if (a.nodeType !== 1 || (a.closest && a.closest('.tl-ub,.tl-ub-c,.tl-ub-btn,.tl-ub-face'))) continue;
      if (++n > 80) return;
      const t = a.textContent || '';
      if (UB_LABELS.some(l => t.includes(l))) { ubTryAt = clock(); ubDirty = true; ensureBarButton(); return; }
    }
  }
  function addUnblockStyle() { if (document.getElementById('tl-ub-style')) return; const s = document.createElement('style'); s.id = 'tl-ub-style'; s.textContent = UB_STYLE + BN_STYLE + '\n[data-tl-gone],[data-tl-beg],[data-tl-ub-hid],[data-tl-ub-under]{display:none!important}'; (document.head || document.documentElement).appendChild(s); ubIconStyle(); }
  function startUnblockWindow() {
    const go = () => {
      addUnblockStyle(); if (opt.on) applyOptsLive();
      try { localStorage.removeItem('tweeks.fr24.ladd.look2'); } catch (e) { /* none */ }
      // (every change to the page, before the browser paints it: FR24's window being opened for this, or kept as this; the
      // Bookmarks widget put in; a flight's or an airport's panel opened while the stand-in is up. Every second while FR24
      // builds its page - and, once the bar is there, to put the button back if FR24 drew the bar again; a page without the
      // bar is looked at less and less often)
      let bmDirty = true, bmAt = 0;
      try {
        new MutationObserver(recs => {
          ubDirty = true; bmDirty = true;
          try { ubBarCame(recs); } catch (e) { log('LADD Unblock button', e); }
          try {
            if (HJ.st === 'opening') lendScan(); else if (HJ.st === 'on') { if (!(addedTitle(recs) && relend())) lendKeep(false); }
            if (lentOut.size) checkLent();
            bookmarksMut(recs);
            if (ubFloat) for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1 && (n.matches('[data-testid^="aircraft-panel"],[data-testid="airport-panel"]') || n.querySelector('[data-testid^="aircraft-panel"],[data-testid="airport-panel"]'))) { closeStandIn(); break; }
          } catch (e) { log('LADD Unblock window', e); }
        }).observe(document.body || document.documentElement, { childList: true, characterData: true, subtree: true });
      } catch (e) { ubDirty = true; }
      const tick = () => {
        ensureBarButton(); ubBanners();
        if (bmDirty && now() - bmAt > 2000) { bmDirty = false; bmAt = now(); try { bookmarksSweep(document.body); begSweep(document.body); } catch (e) { log('bookmarks', e); } }
        setTimeout(tick, ubMiss > 60 ? 5000 : 1000);
      };
      tick();
      // (the newest version: the banner from the last answer the moment FR24 opens, the newest looked up at once - every
      // time FR24 is opened - every ten minutes after, and on coming back to the tab where the last answer is two minutes
      // old: a version merged while the tab was open is shown when it is looked at, not up to half an hour later)
      ubBanners();
      checkLatest(true); setInterval(() => checkLatest(false), 10 * 60000);
      const backToTab = () => { if (document.visibilityState !== 'hidden' && !(ubLatest && ubLatest.v && now() - ubLatest.at < 120000)) checkLatest(true); };
      document.addEventListener('visibilitychange', backToTab); window.addEventListener('focus', backToTab);
      startHello();
      // (Later, a closed notice or a newer answer in another FR24 tab: the same here)
      window.addEventListener('storage', ev => { if ([UB_LATER_KEY, UB_NOTICE_KEY, HELLO_KEY].includes(ev.key)) ubBanners(); });
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && ubFloat) closeStandIn(); });
      document.addEventListener('pointerdown', onMapDown, true);
      document.addEventListener('pointerup', onMapUp, true);
      window.addEventListener('resize', () => { fitBody(); placeStandIn(); bnPlace(); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true }); else go();
  }
