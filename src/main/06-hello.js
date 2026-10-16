  // ---- counting installs: an anonymous id and a hello to the monitor, at most twice a day -------------------------------
  // One random id per install (128 bits, made here - nothing about the person or the browser in it), with the version, the
  // kind of install and the browser and system by name, POSTed to the monitor's /hello: every 12 hours at most, and at once
  // after an update. Nothing else is sent. The LADD Unblock window's "Count this install" switch off - or LADD Unblock off,
  // or the monitor off - nothing at all is sent. Kept in localStorage (FR24's site storage, as the switches are): the
  // script's own updates leave it alone, in the userscript and the extension alike - one install, one id.
  // The answer: the newest version the monitor knows (beside GitHub's package.json, checkLatest), the lowest version still
  // supported and the owner's notice - kept with the time it came, for the page loads between two hellos.
  const HELLO_ID_KEY = 'tweeks.fr24.ladd.iid', HELLO_KEY = 'tweeks.fr24.ladd.hello1', HELLO_EVERY = 12 * 3600e3, HELLO_ANS_DAYS = 3;
  const helloSt = () => { try { const o = JSON.parse(localStorage.getItem(HELLO_KEY) || 'null'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
  const helloPut = o => { try { localStorage.setItem(HELLO_KEY, JSON.stringify(o)); } catch (e) { /* full or blocked */ } };
  // (the answer, while it is recent: one kept from before counting was switched off fades out in a few days)
  const helloAns = () => { const a = helloSt().ans; return a && typeof a === 'object' && now() - (a.at || 0) < HELLO_ANS_DAYS * 864e5 && (a.at || 0) <= now() + 60000 ? a : {}; };
  const verOk = v => typeof v === 'string' && v.length <= 20 && /^\d+(\.\d+){0,3}$/.test(v) ? v : '';
  // (the newest version known: GitHub's or the monitor's, whichever is newer)
  function latestV() { const a = (ubLatest && ubLatest.v) || '', b = verOk(helloAns().latest); return a && b ? (newerThan(b, a) ? b : a) : a || b; }
  // (what to offer: the newest version, when it is newer than this one; required - below the lowest one supported)
  function ubOffer() {
    const lv = latestV(), mv = verOk(helloAns().minVer), req = !!(mv && newerThan(mv, VERSION));
    const v = lv && newerThan(lv, VERSION) ? (req && newerThan(mv, lv) ? mv : lv) : req ? mv : '';
    return { v, req };
  }
  function installId() {
    let id = ''; try { id = localStorage.getItem(HELLO_ID_KEY) || ''; } catch (e) { return ''; }
    if (/^[0-9a-f]{32}$/.test(id)) return id;
    const c = typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function' ? crypto : null;
    if (!c) return '';                              // (no good random numbers: no id - and no hello - rather than a weak one)
    const b = new Uint8Array(16); c.getRandomValues(b);
    id = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(HELLO_ID_KEY, id); } catch (e) { return ''; }
    // (kept? - storage that does not keep would make a new install of every page load)
    try { return localStorage.getItem(HELLO_ID_KEY) === id ? id : ''; } catch (e) { return ''; }
  }
  // (the browser and system by name only: navigator.userAgentData where the browser has it, its user agent where not)
  function uaBrowser() {
    const n = navigator, d = n.userAgentData, ua = String(n.userAgent || '');
    const brands = d && Array.isArray(d.brands) ? d.brands.map(b => String((b && b.brand) || '')).join('|') : '';
    if (/Microsoft Edge/.test(brands) || /\bEdg(e|A|iOS)?\//.test(ua)) return 'edge';
    if (/\bOpera\b/.test(brands) || /\bOPR\/|\bOPT\/|\bOpera\b/.test(ua)) return 'opera';
    if (/\bBrave\b/.test(brands) || (n.brave && typeof n.brave.isBrave === 'function')) return 'brave';
    if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
    if (/Google Chrome|Chromium/.test(brands) || /Chrome\/|CriOS\/|Chromium\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'safari';
    return 'other';
  }
  function uaOs() {
    const n = navigator, p = String((n.userAgentData && n.userAgentData.platform) || ''), ua = String(n.userAgent || '');
    if (p) return /^Windows/i.test(p) ? 'windows' : /^mac/i.test(p) ? 'mac' : /^Android/i.test(p) ? 'android' : /^i(Pad)?OS$/i.test(p) ? 'ios' : /^Linux/i.test(p) ? 'linux' : 'other';
    if (/Android/.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    // (an iPad asks for the desktop site as a Mac: one with a touch screen)
    if (/Macintosh|Mac OS X/.test(ua)) return n.maxTouchPoints > 1 ? 'ios' : 'mac';
    if (/Windows/.test(ua)) return 'windows';
    if (/CrOS/.test(ua)) return 'other';
    return /Linux|X11/.test(ua) ? 'linux' : 'other';
  }
  // (exactly these fields: the userscript's manager and its version, or which extension build)
  function helloBody(id) {
    const ext = typeof TL_EXTENSION === 'boolean';
    let handler = '';
    if (ext) { let u = ''; try { u = chrome.runtime.getURL(''); } catch (e) { /* the extension was reloaded */ } handler = /^moz-extension:/.test(u) || uaBrowser() === 'firefox' ? 'firefox-ext' : 'chrome-ext'; }
    else { try { if (typeof GM_info !== 'undefined' && GM_info) handler = [GM_info.scriptHandler, GM_info.version].filter(x => typeof x === 'string' && x).join(' '); } catch (e) { /* none */ } }
    return { id, ver: VERSION, kind: ext ? 'ext' : 'us', handler: clean(handler || 'userscript').slice(0, 24), browser: uaBrowser(), os: uaOs() };
  }
  // Firefox asks the person before an add-on sends "technical and interaction data" (the manifest lists it as optional,
  // build.mjs): not allowed there - nothing is sent. (null: no such question in this browser - Chrome, the userscript)
  let ffConsent = null;
  function helloConsent() {
    if (typeof TL_DATA_CONSENT !== 'function') return Promise.resolve(true);
    return TL_DATA_CONSENT(false).then(r => { const was = ffConsent; ffConsent = r; if (was !== r) renderUnblockWindow(); return r !== false; }, () => false);
  }
  const helloDue = () => { const s = helloSt(); return !s.at || s.ver !== VERSION || now() - s.at >= HELLO_EVERY || s.at > now() + 60000; };
  let helloBusy = null, helloRetry = 0;
  function sayHello() {
    if (helloBusy) return helloBusy;
    if (!opt.on || !opt.count || now() < helloRetry || !helloDue()) return Promise.resolve(false);
    helloBusy = helloConsent().then(ok => {
      if (!ok || !opt.on || !opt.count || !helloDue()) return false;
      const id = installId(); if (!id) return false;
      const prev = helloSt(), body = helloBody(id);
      // (noted as sent before it goes: another FR24 tab opening at the same moment does not send it too; put back if it fails)
      helloPut(Object.assign({}, prev, { at: now(), ver: VERSION }));
      return monPost('/hello', body).then(j => {
        if (j && j.ok) {
          const ans = { latest: verOk(j.latest), minVer: verOk(j.minVer), notice: typeof j.notice === 'string' ? clean(j.notice).slice(0, 500) : '', at: now() };
          helloPut(Object.assign(helloSt(), { ans }));
        }
        renderUnblockWindow(); ubBadge(); ubBanners();
        return true;
      }, e => {
        helloPut(Object.assign(helloSt(), { at: prev.at || 0, ver: prev.ver || '' }));
        helloRetry = now() + 30 * 60000; log('hello', e);
        return false;
      });
    }).catch(e => { log('hello', e); return false; }).then(r => { helloBusy = null; return r; });
    return helloBusy;
  }
  // (a little after FR24 opens - the monitor checked by then - and looked at again every hour: a tab left open for days)
  function startHello() { setTimeout(() => { sayHello(); setInterval(sayHello, 3600e3); }, 10000); }

  // ---- on FR24's map: a banner when this version is out of date, and the owner's notice ----------------------------------
  // At the top of the map, in the middle, below FR24's header: FR24's dark grey bar with its yellow button. Stacked as FR24's
  // header is (its z-index, after it in the page) - under FR24's own windows and pop-ups - and hidden while one of FR24's
  // dialogs is up. One of each at most; a closed one is taken out of the page. "Later": out of sight for 24 hours (kept, for
  // that version); a required update ("below minVer") only until the page is loaded again. The notice: closed until the
  // owner writes another.
  const UB_LATER_KEY = 'tweeks.fr24.ladd.later', UB_NOTICE_KEY = 'tweeks.fr24.ladd.noticex';
  const BN_STYLE = `
.tl-bn-wrap{position:fixed;left:50%;top:64px;z-index:40;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;width:max-content;max-width:calc(100vw - 32px);pointer-events:none}
.tl-bn{pointer-events:auto;display:flex;align-items:center;gap:8px;max-width:100%;min-height:36px;padding:4px 4px 4px 12px;background:#393939;color:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.35);font:600 13px/1.4 "Open Sans",Roboto,Arial,sans-serif;text-align:left}
.tl-bn-t{min-width:0;overflow-wrap:anywhere;padding:2px 0}
.tl-bn-t b{color:#f8c023;font-weight:700}
.tl-bn-b{flex:none;margin:0;padding:5px 12px;border:0;border-radius:4px;background:#f8c023;color:#1b1b1b;font:inherit;font-weight:700;cursor:pointer}
.tl-bn-b2{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.45)}
.tl-bn-x{flex:none;width:28px;height:28px;margin:0;padding:0;border:0;border-radius:4px;background:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}
.tl-bn-b:focus-visible,.tl-bn-x:focus-visible{outline:2px solid #fff;outline-offset:2px}
.tl-bn-hid{visibility:hidden!important}`;
  const onMapPage = !isDataPage && !isAircraftPage && !isFlightPage;
  let bnWrap = null, bnReqLater = false, bnNote = false;
  const bnLater = () => { try { const o = JSON.parse(localStorage.getItem(UB_LATER_KEY) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } };
  function bnSet(k, html, label) {
    let el = bnWrap ? bnWrap.querySelector(`[data-tl-bn="${k}"]`) : null;
    if (!html) { if (el) el.remove(); return; }
    if (!bnWrap || !bnWrap.isConnected) {
      bnWrap = document.createElement('div'); bnWrap.className = 'tl-bn-wrap';
      bnWrap.addEventListener('click', onBnClick);
      document.body.appendChild(bnWrap);
    }
    if (!el) { el = document.createElement('div'); el.className = 'tl-bn'; el.dataset.tlBn = k; el.setAttribute('role', 'group'); el.setAttribute('aria-label', label); if (k === 'upd') bnWrap.prepend(el); else bnWrap.appendChild(el); }
    // (written again only when it changes: a button reached with the keyboard keeps its focus)
    if (el.__tlHtml !== html) { el.__tlHtml = html; el.innerHTML = html; }
  }
  function ubBanners() {
    if (!onMapPage || !document.body) return;
    if (!opt.on) { bnSet('upd', ''); bnSet('notice', ''); }
    else {
      const o = ubOffer(), L = bnLater();
      const later = !o.v || (o.req ? bnReqLater : !!(L && L.until > now() && L.until < now() + 25 * 3600e3 && !newerThan(o.v, String(L.v || ''))));
      const text = bnNote && ubNote ? esc(ubNote) : `LADD Unblocker v${esc(o.v)} is out (you have v${esc(VERSION)})${o.req ? ' - <b>this update is required</b>' : ''}`;
      bnSet('upd', later ? '' : `<span class="tl-bn-t">${text}</span><button type="button" class="tl-bn-b" data-bn-act="update">Update</button><button type="button" class="tl-bn-b tl-bn-b2" data-bn-act="later"${o.req ? ' title="Until FR24 is loaded again"' : ' title="Hide for 24 hours"'}>Later</button>`, 'LADD Unblocker update');
      const nt = String(helloAns().notice || '');
      let closed = ''; try { closed = localStorage.getItem(UB_NOTICE_KEY) || ''; } catch (e) { /* blocked */ }
      bnSet('notice', nt && closed !== nt ? `<span class="tl-bn-t">${esc(nt)}</span><button type="button" class="tl-bn-x" data-bn-act="closeNotice" aria-label="Close" title="Close">${UB_X}</button>` : '', 'LADD Unblocker notice');
    }
    if (bnWrap && !bnWrap.children.length) { bnWrap.remove(); bnWrap = null; }
    bnPlace();
  }
  function onBnClick(ev) {
    const t = ev.target && ev.target.closest ? ev.target.closest('[data-bn-act]') : null; if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    const act = t.dataset.bnAct;
    // (Update: what the window's own Update does for this kind of install - its instructions then shown here)
    if (act === 'update') { bnNote = true; doUpdate('update'); }
    else if (act === 'later') { const o = ubOffer(); if (o.req) bnReqLater = true; else { try { localStorage.setItem(UB_LATER_KEY, JSON.stringify({ v: o.v, until: now() + 24 * 3600e3 })); } catch (e) { bnReqLater = true; } } }
    else if (act === 'closeNotice') { const nt = String(helloAns().notice || ''); try { localStorage.setItem(UB_NOTICE_KEY, nt); } catch (e) { /* blocked: closed for this page */ } if (!bnWrap) return; const el = bnWrap.querySelector('[data-tl-bn="notice"]'); if (el) el.remove(); }
    ubBanners();
  }
  // (below FR24's header - the widest bar at the very top - and stacked as it is; out of sight while FR24 shows a dialog)
  function bnPlace() {
    if (!bnWrap || !bnWrap.isConnected) return;
    let y = 0, z = 0;
    const vw = window.innerWidth || 1000;
    for (const h of document.querySelectorAll('header,[role="banner"]')) {
      if (h.closest('.tl-bn-wrap,.tl-ub,.tl-ub-c')) continue;
      const r = h.getBoundingClientRect();
      if (!(r.height > 0 && r.height < 160 && r.top <= 4 && r.width > vw / 2)) continue;
      y = Math.max(y, r.bottom); const zi = parseInt(getComputedStyle(h).zIndex, 10); if (zi > z) z = zi;
    }
    bnWrap.style.top = Math.round((y || 56) + 8) + 'px';
    bnWrap.style.zIndex = String(z > 0 ? z : 40);
    const dlg = [...document.querySelectorAll('[aria-modal="true"],[role="dialog"],[role="alertdialog"]')].some(d => !d.closest('.tl-bn-wrap,.tl-ub,.tl-ub-c,[data-tl-ub-host]') && shownEl(d));
    bnWrap.classList.toggle('tl-bn-hid', dlg);
  }
