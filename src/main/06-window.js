  // ---- LADD Unblock: its own button on FR24's bottom bar (Settings · Weather · Filters · Widgets · Playback) and the window
  // it opens, drawn like FR24's own windows there (Widgets, Weather): every switch, the data sources and updates ----------
  // The bar is FR24's (Vue): found by its labels, not by class names, and one of its own buttons is copied - so the new one
  // has the bar's look, whatever FR24 calls its classes - with this icon and label. Put back if FR24 draws the bar again.
  const UB_REPO = 'FinlayC1/fr24-ladd-unblocker';
  const UB_LATEST_URL = `https://raw.githubusercontent.com/${UB_REPO}/main/package.json`;
  const UB_USERSCRIPT_URL = `https://raw.githubusercontent.com/${UB_REPO}/main/dist/fr24-ladd-unblocker.user.js`;
  const UB_ZIP_URL = `https://github.com/${UB_REPO}/releases/latest/download/fr24-ladd-unblocker-extension.zip`;
  const UB_CHANGES_URL = `https://github.com/${UB_REPO}/blob/main/CHANGELOG.md`;
  const UB_LABELS = ['Settings', 'Weather', 'Filters', 'Widgets', 'Playback'];
  // (FR24's own window as last seen, in screen pixels: where Widgets sits and its size, the height of a window's title bar,
  // and how one appears and goes - copied, not guessed; until one has been opened, Widgets as measured from screenshots)
  const UB_LOOK_KEY = 'tweeks.fr24.ladd.look2';
  const UB_LOOK0 = { left: 10, top: 70, width: 252, head: 30, anim: { in: null, out: null } };
  // (an aircraft with an open padlock: FR24's outline style - 24 grid, 1.5 stroke in the text colour)
  const UB_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path transform="translate(-1.6 -1.4) scale(.9)" d="M12 2.5c.8 0 1.4.9 1.4 2v4.6l6.6 4v1.8l-6.6-2v4.3l2 1.5v1.5L12 19.3l-3.4.9v-1.5l2-1.5v-4.3l-6.6 2v-1.8l6.6-4V4.5c0-1.1.6-2 1.4-2z"/><rect x="14.75" y="16.25" width="7.5" height="5.75" rx="1.2"/><path d="M16.6 16.25v-1.8a1.9 1.9 0 0 1 3.6-.85"/></svg>';
  const UB_X = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12"/></svg>';
  const UB_STYLE = `
.tl-ub{position:fixed;z-index:2147482000;left:10px;top:70px;width:252px;max-height:calc(100vh - 160px);display:flex;flex-direction:column;background:#f4f4f4;color:#393939;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.35);overflow:hidden;font-family:inherit;font-size:12px;line-height:1.35;text-align:left}
.tl-ub *{box-sizing:border-box}
.tl-ub-head{flex:none;position:relative;height:30px;display:flex;align-items:center;justify-content:center;background:#393939;color:#fff;font-size:13px;font-weight:700}
.tl-ub-x{position:absolute;right:7px;top:5px;width:20px;height:20px;padding:0;border:0;background:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}
.tl-ub-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#f8c023 transparent}
.tl-ub-body::-webkit-scrollbar{width:5px}
.tl-ub-body::-webkit-scrollbar-thumb{background:#f8c023;border-radius:3px}
.tl-ub-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tl-ub-top{padding:12px 7px 6px}
.tl-ub-t{font-size:11px;font-weight:600;color:#6d6d6d;text-transform:uppercase}
.tl-ub-info{display:flex;gap:4px;padding:0 7px 9px;font-size:10px;line-height:1.35;color:#5c5c5c}
.tl-ub-info svg{flex:none;margin-top:1px}
.tl-ub-item{padding:10px 7px 10px;border-top:1px solid #fff}
.tl-ub-item p{margin:3px 0 0;font-size:11px;line-height:1.4;color:#393939}
.tl-ub-off .tl-ub-feat{opacity:.45}
.tl-ub-tg{flex:none;position:relative;width:36px;height:20px;padding:0;border:0;border-radius:10px;background:#c4c4c4;cursor:pointer;transition:background .15s}
.tl-ub-tg[aria-checked="true"]{background:#f8c023}
.tl-ub-tg i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:left .15s}
.tl-ub-tg[aria-checked="true"] i{left:18px}
.tl-ub-reload{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 7px;background:#fff4d1;border-bottom:1px solid #f8c023;font-size:11px;font-weight:600}
.tl-ub-reload[hidden]{display:none}
.tl-ub-b{flex:none;padding:4px 10px;border:0;border-radius:4px;background:#f8c023;color:#1b1b1b;font:inherit;font-size:11px;font-weight:700;cursor:pointer}
.tl-ub-b2{background:#e2e2e2}
.tl-ub-b:disabled{opacity:.5;cursor:default}
.tl-ub-kv{display:flex;justify-content:space-between;gap:6px;margin-top:4px;font-size:11px}
.tl-ub-kv span:first-child{color:#5c5c5c}
.tl-ub-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tl-ub-note{margin-top:6px;font-size:10px;line-height:1.4;color:#5c5c5c}
.tl-ub a{color:#327db6;text-decoration:none}
.tl-ub a:hover{text-decoration:underline}
.tl-ub .tl-muted{opacity:.75}
.tl-ub .tl-warn{color:#b35c00;font-weight:600}
.tl-ub .tl-pop-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 6px;padding:3px 0;border-top:1px solid rgba(0,0,0,.06);font-size:11px}
.tl-ub #tl-ub-sources>.tl-muted{font-size:10px;line-height:1.4}
.tl-ub .tl-in{flex:1 1 100%;min-width:0;margin:1px 0;padding:4px 6px;background:#fff;color:#393939;border:1px solid #c8c8c8;border-radius:4px;font:inherit;font-size:11px}
.tl-ub-going{pointer-events:none}
.tl-ub-btn-on,.tl-ub-btn-on *{color:#f8c023!important}
.tl-ub-btn [data-tl-ub-label]{white-space:nowrap}
html.tl-no-strip .tl-strip{display:none!important}`;
  // the switches, in the order shown; 'reload': takes effect when FR24 is loaded again
  const UB_FEATURES = [
    ['strip', 'Aircraft panel details', 'The strip under the photo: owner, registry and tracking links, the prediction odds, and the confirm, watch, fleet, CSV and scorecard tools.'],
    ['boards', 'Airport boards', "Blocked flights, and FR24's own N/A flights with a good predicted destination, on arrivals, departures and on the ground. From the next board you open."],
    ['search', 'Search', "Identified blocked aircraft listed under Live flights in FR24's search box."],
    ['acPages', 'Aircraft & flight pages', 'Flight logs FR24 hides rebuilt from ADS-B on the /data pages, with the locked MSN and age. The next time one opens.'],
    ['alerts', 'Take-off & landing alerts', 'Notifications for the aircraft on your watchlist.'],
    ['noAds', 'Hide ads & upgrade prompts', "FR24's adverts, the ad sidebar, the free-trial pop-up and upgrade banners. The sidebar and pop-up come back after a reload.", 'reload']
  ];
  let ubBtn = null, ubBar = null, ubItems = new Map(), ubWin = null, ubNeedReload = false, ubLatest = null, ubAsking = null, ubNote = '';

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
    renderUnblockWindow();
  }

  // ---- the version: what is installed, the newest one, and how this kind of install is updated ----------------------
  const verParts = v => String(v || '').split('.').map(x => parseInt(x, 10) || 0);
  const newerThan = (a, b) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
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
  // (main's package.json: a version merged to main is released as soon as its tests pass)
  function checkLatest(force) {
    if (ubAsking) return ubAsking;
    if (!force && ubLatest && now() - ubLatest.at < 30 * 60000) return Promise.resolve(ubLatest);
    ubAsking = gmRequest(UB_LATEST_URL + '?t=' + Math.floor(now() / 60000), { timeout: 15000 })
      .then(j => { const v = j && typeof j.version === 'string' && /^\d+(\.\d+)*$/.test(j.version) ? j.version : ''; ubLatest = v ? { v, at: now() } : { err: 'no version in the answer', at: now() }; })
      .catch(e => { ubLatest = { err: String(e && e.message || e), at: now() }; })
      .then(() => { ubAsking = null; renderUnblockWindow(); return ubLatest; });
    renderUnblockWindow();
    return ubAsking;
  }
  const extMsg = m => new Promise(res => { try { chrome.runtime.sendMessage(m, r => { void chrome.runtime.lastError; res(r); }); } catch (e) { res(null); } });
  function doUpdate(act) {
    const k = installKind().kind;
    if (act === 'update' && k === 'us') { window.open(UB_USERSCRIPT_URL, '_blank', 'noopener'); ubNote = 'Your userscript manager opens the new version in a tab: click Update there, then reload FR24.'; }
    else if (act === 'update' && k === 'ext') { window.open(UB_ZIP_URL, '_blank', 'noopener'); ubNote = 'Downloading the new zip. Unzip it over your extension folder (replace the files), then click Reload extension.'; }
    else if (act === 'update' && k === 'store') { ubNote = 'Asking the browser…'; extMsg({ tlUpdateCheck: true }).then(st => { ubNote = st === 'update_available' ? 'Found it: the extension restarts with it. Reload FR24 when it has.' : st === 'throttled' ? 'The browser checked recently; it installs the update by itself shortly.' : st === 'unsupported' ? 'Your browser installs the update by itself when its add-on store has it (Firefox looks about once a day).' : 'The browser has nothing newer for it yet; it installs updates by itself.'; renderUnblockWindow(); }); }
    else if (act === 'reloadExt' && k === 'ext') { ubNote = 'Reloading the extension…'; extMsg({ tlReload: true }); setTimeout(() => location.reload(), 900); }
    renderUnblockWindow();
  }
  function updatesHtml() {
    const ik = installKind(), L = ubLatest, newer = L && L.v && newerThan(L.v, VERSION);
    const latest = ubAsking && !(L && L.v) ? '<span class="tl-muted">checking…</span>' : L && L.v ? (newer ? `<b>v${esc(L.v)}</b>` : `v${esc(L.v)} <span class="tl-muted">(up to date)</span>`) : L && L.err ? `<span class="tl-warn" title="${esc(L.err)}">couldn't check</span>` : '<span class="tl-muted">not checked</span>';
    const btns = [];
    if (newer) btns.push(`<button class="tl-ub-b" data-ub-act="update">Update to v${esc(L.v)}</button>`);
    else btns.push(`<button class="tl-ub-b tl-ub-b2" data-ub-act="check"${ubAsking ? ' disabled' : ''}>Check for updates</button>`);
    if (ik.kind === 'ext') btns.push('<button class="tl-ub-b tl-ub-b2" data-ub-act="reloadExt" title="Load the extension again from its folder - after replacing its files with a new version">Reload extension</button>');
    const how = ik.kind === 'us' ? 'Update opens the new version in your userscript manager, which offers to update.' : ik.kind === 'ext' ? 'An unpacked extension cannot replace its own files: Update downloads the new zip, you unzip it over the old folder, and Reload extension loads it.' : 'Installed from a store: your browser updates it by itself.';
    return `<div class="tl-ub-kv"><span>Installed</span><span>v${esc(VERSION)}</span></div><div class="tl-ub-kv"><span>Latest</span><span>${latest}</span></div>
      <div class="tl-ub-kv"><span>Type</span><span>${esc(ik.name)}</span></div><div class="tl-ub-btns">${btns.join('')}</div>
      <div class="tl-ub-note">${esc(ubNote || how)} <a href="${UB_CHANGES_URL}" target="_blank" rel="noopener">What's new</a></div>`;
  }

  // ---- the window ------------------------------------------------------------------------------------------------------
  const tgHtml = (k, label) => `<button type="button" class="tl-ub-tg" role="switch" aria-checked="${opt[k] ? 'true' : 'false'}" aria-label="${esc(label)}" data-ub-opt="${k}"><i></i></button>`;
  function ubBodyHtml() {
    const info = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><circle cx="5" cy="5" r="4.4"/><path d="M5 4.4v3M5 2.6v.2" stroke-linecap="round"/></svg>';
    return `<div class="tl-ub-reload"${ubNeedReload ? '' : ' hidden'}><span>Reload FR24 to apply</span><button type="button" class="tl-ub-b" data-ub-act="reload">Reload</button></div>
      <div class="tl-ub-row tl-ub-top"><span class="tl-ub-t">Enable LADD Unblock</span>${tgHtml('on', 'Enable LADD Unblock')}</div>
      <div class="tl-ub-info">${info}<span>Names blocked (LADD) and N/A aircraft from public ADS-B, with routes, predicted destinations and flight history.${opt.on ? '' : ' Switched off: FR24 is left as it is.'}</span></div>
      ${UB_FEATURES.map(([k, t, d]) => `<div class="tl-ub-item tl-ub-feat"><div class="tl-ub-row"><span class="tl-ub-t">${esc(t)}</span>${tgHtml(k, t)}</div><p>${esc(d)}</p></div>`).join('')}
      <div class="tl-ub-item"><span class="tl-ub-t">Updates</span><div id="tl-ub-upd">${updatesHtml()}</div></div>
      <div class="tl-ub-item"><span class="tl-ub-t">Data sources</span><div id="tl-ub-sources">${opt.on ? sourcesHtml() : '<p>Switched off.</p>'}</div></div>`;
  }
  function renderUnblockWindow() {
    if (!ubWin || !ubWin.isConnected) return;
    const body = ubWin.querySelector('.tl-ub-body'), top = body.scrollTop;
    ubWin.classList.toggle('tl-ub-off', !opt.on);
    body.innerHTML = ubBodyHtml(); body.scrollTop = top;
  }
  // (the data sources' own buttons - monitor, keys - are handled with the strip's tools, which redraw this part)
  function refreshSources() { const el = ubWin && ubWin.isConnected ? ubWin.querySelector('#tl-ub-sources') : null; if (el && opt.on) el.innerHTML = sourcesHtml(); }
  function ubLook() {
    let r = null; try { r = JSON.parse(localStorage.getItem(UB_LOOK_KEY) || 'null'); } catch (e) { r = null; }
    return Object.assign({}, UB_LOOK0, r && typeof r === 'object' ? r : {});
  }
  function saveLook(part) { try { localStorage.setItem(UB_LOOK_KEY, JSON.stringify(Object.assign(ubLook(), part))); } catch (e) { /* full */ } }
  // FR24's size and zoom: its title bar as tall as theirs on screen (whatever the page's own zoom does to this one), and
  // then its place, width and bottom edge in screen pixels - turned into this window's CSS pixels (k: screen px per px)
  function placeUnblockWindow() {
    if (!ubWin) return;
    const L = ubLook(), head = ubWin.querySelector('.tl-ub-head');
    ubWin.style.zoom = '';
    const hb = head ? head.getBoundingClientRect().height : 0, ho = head ? head.offsetHeight : 0;
    const s0 = hb > 0 && ho > 0 ? hb / ho : 1;
    let z = hb > 0 && L.head > 0 ? Math.min(2, Math.max(0.6, L.head / hb)) : 1;
    if (Math.abs(z - 1) < 0.03 || !(window.CSS && CSS.supports && CSS.supports('zoom', '1.5'))) z = 1;
    if (z !== 1) ubWin.style.zoom = String(Math.round(z * 1000) / 1000);
    const k = s0 * z, vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
    const width = L.width >= 200 && L.width <= 520 ? L.width : UB_LOOK0.width;
    const left = L.left >= 0 && L.left < vw - 150 ? L.left : UB_LOOK0.left, top = L.top >= 0 && L.top < vh - 200 ? L.top : UB_LOOK0.top;
    const barTop = ubBar && ubBar.isConnected ? ubBar.getBoundingClientRect().top : 0;
    const bottom = L.bottom > top + 240 && L.bottom <= vh ? L.bottom : barTop > top + 240 ? barTop - 10 : vh - 20;
    ubWin.style.left = left / k + 'px'; ubWin.style.top = top / k + 'px'; ubWin.style.width = width / k + 'px';
    ubWin.style.maxHeight = Math.max(240, bottom - top) / k + 'px';
  }
  // how FR24's windows appear and go, replayed: the frames seen on theirs (where it was, its size, how see-through)
  function ubAnimate(el, frames, done) {
    const a = frames && frames.length > 1 && typeof el.animate === 'function' ? frames : null;
    if (!a) { if (done) done(); return; }
    const r = el.getBoundingClientRect(), k = r.width > 0 && el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
    const kf = a.map(f => {
      const o = { offset: f.f, opacity: f.o };
      if (f.m === 's') { o.transformOrigin = '0 0'; o.transform = `translate(${f.x / k}px,${f.y / k}px) scale(${f.sx},${f.sy})`; }
      else { o.transform = `translate(${f.x / k}px,${f.y / k}px)`; if (f.m === 'c') o.clipPath = `inset(${f.ct}% ${f.cr}% ${f.cb}% ${f.cl}%)`; }
      return o;
    });
    let an = null; try { an = el.animate(kf, { duration: a[a.length - 1].t, easing: 'linear', fill: 'none' }); } catch (e) { an = null; }
    if (!an) { if (done) done(); return; }
    if (done) { let fin = false; const end = () => { if (!fin) { fin = true; done(); } }; an.onfinish = end; an.oncancel = end; setTimeout(end, a[a.length - 1].t + 400); }
  }
  function openUnblockWindow() {
    addUnblockStyle();
    if (!ubWin || !ubWin.isConnected) {
      ubWin = document.createElement('div'); ubWin.className = 'tl-ub'; ubWin.setAttribute('role', 'dialog'); ubWin.setAttribute('aria-label', 'LADD Unblock');
      ubWin.innerHTML = `<div class="tl-ub-head"><span>LADD Unblock</span><button type="button" class="tl-ub-x" data-ub-act="close" aria-label="Close" title="Close">${UB_X}</button></div><div class="tl-ub-body"></div>`;
      ubWin.addEventListener('click', ev => {
        const t = ev.target && ev.target.closest ? ev.target.closest('[data-ub-opt],[data-ub-act]') : null; if (!t) return;
        ev.preventDefault(); ev.stopPropagation();
        if (t.dataset.ubOpt) return setOpt(t.dataset.ubOpt, !opt[t.dataset.ubOpt]);
        const act = t.dataset.ubAct;
        if (act === 'close') closeUnblockWindow();
        else if (act === 'reload') location.reload();
        else if (act === 'check') { ubNote = ''; checkLatest(true); }
        else doUpdate(act);
      });
      document.body.appendChild(ubWin);
    }
    const fresh = !ubWin.dataset.shown; ubWin.dataset.shown = '1';
    renderUnblockWindow(); placeUnblockWindow();
    if (fresh) ubAnimate(ubWin, ubLook().anim.in);
    if (ubBtn) ubBtn.classList.add('tl-ub-btn-on');
    checkLatest(false);
  }
  function closeUnblockWindow() {
    if (ubWin) { const w = ubWin; ubWin = null; w.classList.add('tl-ub-going'); ubAnimate(w, ubLook().anim.out, () => w.remove()); }
    if (ubBtn) ubBtn.classList.remove('tl-ub-btn-on');
  }
  const unblockWindowOpen = () => !!(ubWin && ubWin.isConnected);

  // ---- the button on FR24's bar ---------------------------------------------------------------------------------------
  // (the elements holding exactly this text: the bar's labels - and a window's title, which the bar test below leaves out)
  // (one walk over the page's text for all the labels: label -> [elements])
  function labelLeaves(labels) {
    const out = {}; for (const l of labels) out[l] = [];
    if (!document.body) return out;
    const tw = document.createTreeWalker(document.body, 4), seen = new Set();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const t = n.data; if (t.length > 40) continue;
      const k = t.trim(); if (!(k in out)) continue;
      const el = n.parentElement; if (!el || seen.has(el) || el.closest('.tl-ub,.tl-ub-btn,.tl-pop,script,style')) continue;
      seen.add(el); out[k].push(el);
    }
    return out;
  }
  const textLeaves = label => labelLeaves([label])[label];
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
  // the classes of a button and everything in it but its icon: the one most of the bar's buttons share is the resting look
  const classSig = el => [el, ...el.querySelectorAll('*')].filter(x => !x.closest('svg')).map(x => x.getAttribute('class') || '').join('|');
  function makeBarButton(found) {
    const items = [...found.items.values()], sigs = new Map();
    for (const it of items) sigs.set(classSig(it), (sigs.get(classSig(it)) || 0) + 1);
    const common = [...sigs.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const tpl = found.items.get('Widgets') && classSig(found.items.get('Widgets')) === common ? found.items.get('Widgets') : items.find(it => classSig(it) === common) || items[0];
    const label = [...found.items.entries()].find(([, it]) => it === tpl)[0];
    const b = tpl.cloneNode(true);
    for (const el of [b, ...b.querySelectorAll('*')]) {
      for (const at of ['id', 'href', 'aria-pressed', 'aria-expanded', 'aria-current', 'aria-selected', 'data-state']) el.removeAttribute(at);
      if (el.hasAttribute('data-testid')) el.setAttribute('data-testid', 'tl-ladd-unblock');
    }
    const icon = b.querySelector('svg');
    if (icon) {
      const holder = document.createElement('span'); holder.innerHTML = UB_ICON; const mine = holder.firstChild;
      for (const at of ['class', 'width', 'height', 'style']) if (icon.hasAttribute(at)) mine.setAttribute(at, icon.getAttribute(at));
      if (!icon.hasAttribute('width') && !icon.hasAttribute('class')) { mine.setAttribute('width', '24'); mine.setAttribute('height', '24'); }
      icon.replaceWith(mine);
    }
    const leaf = [b, ...b.querySelectorAll('*')].find(el => [...el.childNodes].some(n => n.nodeType === 3 && n.data.trim() === label));
    if (leaf) { for (const n of [...leaf.childNodes]) if (n.nodeType === 3 && n.data.trim() === label) n.data = n.data.replace(label, 'LADD Unblock'); leaf.setAttribute('data-tl-ub-label', ''); }
    b.classList.add('tl-ub-btn'); b.setAttribute('title', 'LADD Unblock'); b.setAttribute('aria-label', 'LADD Unblock');
    if (b.tagName === 'A') b.setAttribute('role', 'button');
    b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); if (unblockWindowOpen()) closeUnblockWindow(); else openUnblockWindow(); });
    if (unblockWindowOpen()) b.classList.add('tl-ub-btn-on');
    return b;
  }
  // ---- FR24's own windows, watched as they open and close: Widgets' place and size, every window's title bar height,
  // and the frames of their appear and disappear, for this window to copy ------------------------------------------------
  // (the window: the nearest fixed or absolute box round its title, sized like a window - its layout size, which an
  // animation's scale does not change; its title bar: the window's child holding the title)
  function nativeWindowOf(label) {
    for (const t of textLeaves(label)) {
      if (ubBar && ubBar.contains(t)) continue;
      for (let a = t.parentElement, d = 0; a && a !== document.body && d < 8; a = a.parentElement, d++) {
        const cs = getComputedStyle(a); if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        if (a.offsetWidth >= 200 && a.offsetWidth <= 520 && a.offsetHeight >= 150) { let h = t; while (h.parentElement && h.parentElement !== a) h = h.parentElement; return { el: a, head: h }; }
        break;
      }
    }
    return null;
  }
  // (what the eye sees of it: where and how big on screen, how see-through - its own and its parents' - and whether a
  // transform is at work on it or them)
  function lookOf(el, t) {
    const r = el.getBoundingClientRect(); let o = 1, tf = '', n = 0;
    for (let a = el; a && a !== document.body && n < 5; a = a.parentElement, n++) { const cs = getComputedStyle(a); o *= parseFloat(cs.opacity) || 0; if (cs.display === 'none' || cs.visibility === 'hidden') o = 0; tf += '|' + (cs.transform || 'none'); }
    return { t, x: r.left, y: r.top, w: r.width, h: r.height, o: el.isConnected ? o : 0, tf };
  }
  const sameLook = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5 && Math.abs(a.o - b.o) < 0.01 && a.tf === b.tf;
  // (the frames, against the window at rest: moved by a transform - its box mapped with a translate and a scale; grown in
  // place - clipped to what showed; otherwise moved; at most 24 frames)
  function framesOf(seen, rest) {
    if (seen.length < 2 || !(rest.w > 0) || !(rest.h > 0) || !(rest.o > 0)) return null;
    const t0 = seen[0].t, dur = seen[seen.length - 1].t - t0; if (!(dur >= 30) || dur > 3000) return null;
    const step = Math.max(1, Math.ceil(seen.length / 24)), pick = seen.filter((f, i) => i % step === 0 || i === seen.length - 1);
    const moved = seen.some(f => f.tf !== rest.tf);
    return pick.map(f => {
      const g = { f: Math.round((f.t - t0) / dur * 1000) / 1000, t: Math.round(dur), o: Math.round(Math.min(1, f.o / rest.o) * 1000) / 1000, x: Math.round(f.x - rest.x), y: Math.round(f.y - rest.y), m: 't' };
      if (moved) { g.m = 's'; g.sx = Math.round(f.w / rest.w * 1000) / 1000; g.sy = Math.round(f.h / rest.h * 1000) / 1000; }
      else if (!moved && (Math.abs(f.w - rest.w) > 1 || Math.abs(f.h - rest.h) > 1)) {
        const pc = (v, of) => Math.round(Math.min(100, Math.max(0, v / of * 100)) * 10) / 10;
        g.m = 'c'; g.x = 0; g.y = 0;
        g.ct = pc(f.y - rest.y, rest.h); g.cl = pc(f.x - rest.x, rest.w); g.cr = pc(rest.x + rest.w - f.x - f.w, rest.w); g.cb = pc(rest.y + rest.h - f.y - f.h, rest.h);
      }
      return g;
    });
  }
  const ubWatched = new Map();   // window element -> its label, while open
  const frame = f => (window.requestAnimationFrame ? requestAnimationFrame(f) : setTimeout(f, 16));
  const clock = () => (window.performance && performance.now ? performance.now() : Date.now());
  // (one opening: looked for every frame until it is there, then followed until it stands still)
  function watchOpen(label) {
    const t0 = clock(), seen = []; let nw = null, still = 0;
    const tick = () => {
      const t = clock(); if (t - t0 > (nw ? 2500 : 1500)) return;
      if (!nw) nw = nativeWindowOf(label);
      if (nw) {
        const f = lookOf(nw.el, t); if (!nw.el.isConnected) return;
        if (seen.length && sameLook(f, seen[seen.length - 1])) still++; else still = 0;
        seen.push(f);
        if (still >= 8) {
          ubWatched.set(nw.el, label);
          const rest = seen[seen.length - 1], moving = seen.slice(0, seen.length - still), hb = nw.head.getBoundingClientRect().height;
          const part = {}, fr = framesOf(moving, rest);
          if (fr) part.anim = Object.assign({}, ubLook().anim, { in: fr });
          if (hb >= 18 && hb <= 80 && nw.head.offsetHeight < nw.el.offsetHeight / 2) part.head = Math.round(hb * 10) / 10;
          if (label === 'Widgets' && rest.w >= 200 && rest.w <= 520) Object.assign(part, { left: Math.round(rest.x), top: Math.round(rest.y), width: Math.round(rest.w), bottom: Math.round(rest.y + rest.h) });
          saveLook(part);
          return;
        }
      }
      frame(tick);
    };
    frame(tick);
  }
  // (one closing: followed from the click until it has gone; nothing learnt if it stayed)
  function watchClose(el) {
    const t0 = clock(), seen = [lookOf(el, t0)];
    const tick = () => {
      const t = clock(), f = lookOf(el, t), gone = !el.isConnected || f.o < 0.01 || f.w < 1;
      if (gone) {
        ubWatched.delete(el);
        const moving = seen.slice(seen.findIndex((g, i) => i === seen.length - 1 || !sameLook(g, seen[i + 1])));
        const fr = moving.length > 1 ? framesOf(moving.concat([Object.assign({}, moving[moving.length - 1], { t, o: 0 })]), seen[0]) : null;
        if (fr) saveLook({ anim: Object.assign({}, ubLook().anim, { out: fr }) });
        return;
      }
      seen.push(f);
      if (t - t0 > 2500 || (t - t0 > 300 && seen.slice(-12).every(g => sameLook(g, seen[0])))) return;
      frame(tick);
    };
    frame(tick);
  }
  // (a click on the bar or in one of FR24's windows, or Escape: the windows open now may be closing, the one asked for opening)
  function watchNative(label) {
    for (const [el] of ubWatched) if (el.isConnected) watchClose(el); else ubWatched.delete(el);
    if (label && label !== 'Playback') {
      const open = nativeWindowOf(label);
      if (!open) watchOpen(label); else if (!ubWatched.has(open.el)) watchClose(open.el);
    }
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
      // (FR24's own buttons: this window makes way for theirs)
      ubBar.addEventListener('click', ev => {
        const it = ev.target && ev.target.closest ? ev.target.closest('.tl-ub-btn') : null; if (it) return;
        if (unblockWindowOpen()) closeUnblockWindow();
        const lbl = [...ubItems.entries()].find(([, el]) => el.contains(ev.target));
        watchNative(lbl ? lbl[0] : '');
      }, true);
    }
    const items = [...found.items.values()], last = items.reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a));
    if (ubBtn) ubBtn.remove();
    ubBtn = makeBarButton(found);
    last.after(ubBtn);
    return true;
  }
  function addUnblockStyle() { if (document.getElementById('tl-ub-style')) return; const s = document.createElement('style'); s.id = 'tl-ub-style'; s.textContent = UB_STYLE; (document.head || document.documentElement).appendChild(s); }
  function startUnblockWindow() {
    const go = () => {
      addUnblockStyle(); if (opt.on) applyOptsLive();
      // (every second while FR24 builds its page; once the bar is there, every second to put the button back if FR24 drew
      // the bar again; a page without the bar is looked at less and less often)
      try { new MutationObserver(() => { ubDirty = true; }).observe(document.body || document.documentElement, { childList: true, characterData: true, subtree: true }); } catch (e) { ubDirty = true; }
      const tick = () => { ensureBarButton(); setTimeout(tick, ubMiss > 60 ? 5000 : 1000); };
      tick();
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { if (unblockWindowOpen()) closeUnblockWindow(); if (ubWatched.size) watchNative(''); } });
      document.addEventListener('click', ev => { if (ubWatched.size && ev.target && [...ubWatched.keys()].some(el => el.contains(ev.target))) watchNative(''); }, true);
      window.addEventListener('resize', () => { if (unblockWindowOpen()) placeUnblockWindow(); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true }); else go();
  }
