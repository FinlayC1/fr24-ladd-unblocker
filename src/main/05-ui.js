
  // ---- panel DOM layer ------------------------------------------------------------------------------------------
  const STYLE = `
.tl-strip{margin:0}
.tl-strip .tl-body{min-width:0}
.tl-strip .tl-cell{min-width:0;overflow-wrap:anywhere}
.tl-strip .tl-v{font-size:15px;line-height:1.3;font-weight:600}
.tl-strip .tl-v b{font-weight:700}
.tl-strip .tl-sub{margin-top:1px;font-size:12px;line-height:1.35;font-weight:400}
.tl-strip .tl-links{display:flex;flex-wrap:wrap;gap:2px 10px;margin-top:6px;font-size:12px;line-height:1.4;font-weight:600}
.tl-strip .tl-links+.tl-links{margin-top:2px}
.tl-strip hr{margin:6px 0}
.tl-strip a{color:#327db6;text-decoration:none}
.tl-strip a:hover{text-decoration:underline}
.tl-strip .tl-muted{opacity:.8;font-weight:400}
.tl-tag{display:inline-block;margin-left:6px;padding:0 5px;border-radius:3px;font:700 10px/15px "Open Sans",Roboto,Arial,sans-serif;letter-spacing:.3px;text-transform:uppercase;vertical-align:1px;white-space:nowrap}
.tl-tag-pred{background:#327db6;color:#fff}
.tl-tag-conf{background:#2e8540;color:#fff}
.tl-tag-ladd{background:#e3b021;color:#1b1b1b}
.tl-tag-wait{background:#8a8a8a;color:#fff}
.tl-tag-pb{background:#d0021b;color:#fff}
.tl-p{display:inline-block;min-width:28px;margin-left:4px;padding:0 4px;border-radius:3px;background:rgba(0,0,0,.08);font-size:11px;line-height:16px;font-weight:700;text-align:center;vertical-align:1px}
.tl-p.hi{background:rgba(46,133,64,.22)}
.tl-p.mid{background:rgba(227,176,33,.35)}
.tl-cap{position:absolute;left:0;right:0;bottom:0;padding:3px 8px;background:linear-gradient(transparent,rgba(0,0,0,.65));color:#fff;font:10px/1.3 Roboto,Arial,sans-serif;text-align:right;pointer-events:auto}
.tl-cap a{color:#fff;text-decoration:none}
.tl-spin{display:inline-block;width:9px;height:9px;border:2px solid rgba(50,125,182,.35);border-top-color:#327db6;border-radius:50%;vertical-align:-1px;animation:tl-spin .8s linear infinite}
.tl-inf{font-size:60%;vertical-align:super;opacity:.6;margin-left:2px}
.tl-ladd{display:inline-block;margin-left:6px;padding:0 5px;border-radius:3px;background:#e3b021;color:#1b1b1b!important;font:700 10px/16px Roboto,Arial,sans-serif;letter-spacing:.3px;text-decoration:none!important;vertical-align:middle;cursor:pointer}
.tl-ladd:hover{background:#f0c341}
.tl-ladd-chip{display:inline-flex;align-items:center;margin-left:4px;padding:0 4px;border-radius:3px;background:#e3b021;color:#1b1b1b;font:700 10px/14px Roboto,Arial,sans-serif;letter-spacing:.3px;flex:none}
.tl-airline{color:#fff;font-size:14px;line-height:16px}
.tl-filled-lock{display:none!important}
@keyframes tl-spin{to{transform:rotate(360deg)}}
/* aircraft data page */
#tbl-datatable tr.tl-live-row td{background:rgba(227,176,33,.08)}
#tbl-datatable .tl-inf{font-size:70%;vertical-align:super;opacity:.65;margin-left:1px}
#tbl-datatable tr.tl-foot td{padding:10px 8px;font-size:11px;color:#8c8c8c;text-align:center;background:#fff}
#tbl-datatable tr.tl-foot a{color:#8c8c8c;text-decoration:underline}
#tbl-datatable tr.tl-loading td{padding:14px;text-align:center;color:#8c8c8c;font-size:12px}
#tbl-datatable a.tl-play,#tbl-datatable a.tl-live{display:inline-flex!important;align-items:center;justify-content:center;line-height:1!important;padding-top:0!important;padding-bottom:0!important;min-height:24px;vertical-align:middle;text-decoration:none!important}
#tbl-datatable a.tl-play i,#tbl-datatable a.tl-live i{line-height:1}
#cnt-subpage-info h1 a.tl-ladd-chip{text-decoration:none!important;color:#1b1b1b!important;cursor:pointer}
.space-x-1>.tl-ladd-chip{margin-left:.25rem;padding:0 3px;font-size:9px;line-height:13px;vertical-align:middle}
.tl-board-line{display:flex;align-items:center;min-width:0;white-space:nowrap}
.tl-board-line>:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}
.tl-board-line>:not(:first-child){flex:none}
#cnt-subpage-info h1 .tl-ladd-chip{margin-left:10px;padding:1px 6px;font-size:12px;line-height:18px;vertical-align:middle}
.tl-ac-photo img{width:100%;height:auto;display:block}
.tl-ac-photo .tl-cap{text-align:left}
aside.tl-pred{background:#e3b021!important;color:#1b1b1b!important;border:1px solid #a67c00!important}
aside.tl-pred.tl-conf{background:#2e8540!important;color:#fff!important;border-color:#1f6b31!important}
aside.tl-pred.tl-conf svg{color:#fff!important}
aside.tl-pred>div:not(.tl-pred-text){display:none!important}
aside.tl-pred svg{color:#1b1b1b!important;fill:currentColor}
aside.tl-pred .tl-pred-text{line-height:1.4}
aside.tl-pred .tl-pred-text b{font-weight:700}
/* FR24 letterboxes every picture that is not a JetPhotos one (object-contain, bars at the sides): each photo fills its 16:9 frame, cropped */
[data-testid="carousel__pages"] img[data-testid*="__image__"]:not([src*="sideview"]):not([data-testid$="promo"]):not([data-testid*="fallback"]),img[data-testid^="aircraft-panel__image__image__"]:not([src*="sideview"]):not([data-testid$="promo"]),img[data-testid^="aircraft-or-airport-carousel__image__"]:not([src*="sideview"]):not([data-testid$="promo"]){width:100%!important;aspect-ratio:16/9!important;height:auto!important;object-fit:cover!important;object-position:center!important}
/* a picture drawn while FR24's own panel still shows its fallback: FR24's photo frame (the panel's width, 16:9, cropped), its credit, its dots; FR24's fallback hidden meanwhile */
.tl-photo{position:relative;display:block;width:100%;aspect-ratio:16/9;overflow:hidden;background:#1b1b1b}
.tl-photo+:not(.tl-strip){display:none!important}
.tl-photo .tl-photo-img,.tl-photo .tl-photo-img img{display:block;width:100%;height:100%}
.tl-photo .tl-photo-img img{object-fit:cover;object-position:center}
.tl-photo .tl-photo-cr{position:absolute;left:0;bottom:0;max-width:70%;padding:2px 8px;color:#fff;font:11px/1.4 Roboto,Arial,sans-serif;text-decoration:none;text-shadow:0 0 3px rgba(0,0,0,.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl-photo .tl-photo-dots{position:absolute;left:0;right:0;bottom:6px;display:flex;justify-content:center;gap:6px;pointer-events:none}
.tl-photo .tl-photo-dots button{width:7px;height:7px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.5);cursor:pointer;pointer-events:auto}
.tl-photo .tl-photo-dots button.on{background:#fff}
.tl-warn{color:#b35c00;font-size:12px;font-weight:600}
.tl-pop{position:fixed;z-index:2147483000;max-height:60vh;overflow:auto;background:#fff;color:#393939;border:1px solid #dcdcdc;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.25);font:12px/1.5 "Open Sans",Roboto,Arial,sans-serif;padding:8px 10px}
.tl-pop-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.tl-pop a{color:#327db6;text-decoration:none}
.tl-pop a:hover{text-decoration:underline}
.tl-pop .tl-muted{opacity:.7}
.tl-pop-row{display:flex;flex-wrap:wrap;gap:0 6px;padding:2px 0;border-top:1px solid rgba(0,0,0,.08)}
.tl-pop .tl-spin{display:inline-block;width:9px;height:9px;border:2px solid #327db6;border-right-color:transparent;border-radius:50%;animation:tl-spin .8s linear infinite}`;
  function addStyle() { if (document.getElementById('tl-style')) return; const s = document.createElement('style'); s.id = 'tl-style'; s.textContent = STYLE; (document.head || document.documentElement).appendChild(s); }
  // FR24's adverts and upsell banners (the sidebar, the carousel promo and the free-trial pop-up are switched off in
  // the page itself, see the bridge). In place from the first paint, on every FR24 page. The advert slots are hidden,
  // not removed: their scripts still run, so FR24's ad-blocker check has nothing to find. (:has() rules stand alone -
  // a browser without it drops only that rule.)
  const AD_STYLE = `
[id^="pb-slot-fr24-"],[id^="div-gpt-ad-"],[data-pb-ad-wrapper],ins.adsbygoogle,#primisPlayerContainerDiv,[id^="primis_container_div"],#subscription-promo,aside[data-testid="sidebar__container"],#tbl-datatable tfoot tr.row-upgrade,[data-testid="floating-button-wrapper__upgrade"]{display:none!important}
.ad-manager-wrapper{height:0!important;min-height:0!important;margin:10px 0 0!important;padding:0!important;border:0!important;overflow:hidden!important;visibility:hidden!important}
div:has(>[id^="pb-slot-fr24-"]:only-child){display:none!important}
div:has(>[id^="div-gpt-ad-"]:only-child){display:none!important}
#aside-main-menu div:has(>[data-testid="aside-main-menu__try-for-free-btn"]){display:none!important}
div:has(>[data-testid="floating-button-wrapper__upgrade"]:only-child){display:none!important}
[data-testid="airport-panel"] div:has(>button[data-testid^="airport-panel__schedules__"][data-testid$="-flights"]:disabled){display:none!important}`;
  function addAdStyle() { if (document.getElementById('tl-noads')) return; const s = document.createElement('style'); s.id = 'tl-noads'; s.textContent = AD_STYLE; (document.head || document.documentElement).appendChild(s); }

  const q = (root, sel) => root.querySelector(sel);
  // `ours`: values this script injected into FR24's feed earlier (they render natively, so they must stay
  // replaceable when the inference changes); anything else that is not "N/A" is real FR24 data and is kept.
  // FR24's page is a Vue app: the text node inside one of its elements belongs to Vue, which keeps updating that very
  // node when another flight is opened. So a value is always written INTO that node (never by replacing the element's
  // content - Vue would then update a detached node and the old value would stay on screen for the next flight), and
  // our own marks (the '?' of a predicted airport) sit beside it without being counted as its text.
  const ownText = el => { for (const n of el.childNodes) if (n.nodeType === 3) return n; return null; };
  const textOf = el => { let s = ''; for (const n of el.childNodes) if (n.nodeType === 3) s += n.data; else if (!(n.classList && n.classList.contains('tl-inf'))) s += n.textContent; return s; };
  function writeOwn(el, value) { const t = ownText(el); if (t) t.data = value; else el.insertBefore(document.createTextNode(value), el.firstChild); }
  function setText(el, value, title, ours) {
    if (!el || !value) return;
    const cur = clean(textOf(el)), bare = cur.replace(/\?$/, '');
    if (!isNA(cur) && cur !== el.dataset.tlVal && !(ours === true || (ours && ours.includes(bare)))) return;
    if (bare === value) return;
    if (!('tlOrig' in el.dataset)) el.dataset.tlOrig = textOf(el);
    writeOwn(el, value);
    el.dataset.tlVal = value;
    el.title = title || 'From public ADS-B data (LADD unblocker)';
  }
  function restore(panel) {
    // our marks first, so what is left is FR24's own text
    panel.querySelectorAll('.tl-strip,.tl-cap,.tl-photo,.tl-inf,.tl-ladd,.tl-airline,.tl-filled').forEach(e => e.remove());
    panel.querySelectorAll('[data-tl-orig]').forEach(el => {
      if (el.tagName === 'IMG') { if (el.getAttribute('src') === el.dataset.tlVal) el.setAttribute('src', el.dataset.tlOrig); }
      else if (clean(textOf(el)) === el.dataset.tlVal) writeOwn(el, el.dataset.tlOrig);
      delete el.dataset.tlOrig; delete el.dataset.tlVal; el.removeAttribute('title');
    });
    panel.querySelectorAll('.tl-filled-lock').forEach(e => e.classList.remove('tl-filled-lock'));
  }
  const panelHex = panel => { const e = q(panel, SEL.hex); const h = e ? clean(textOf(e)).toLowerCase() : ''; return /^[0-9a-f]{6}$/.test(h) ? h : ''; };
  function panelLooksBlocked(panel) {
    const cs = clean(q(panel, SEL.callsign) && q(panel, SEL.callsign).textContent);
    const hex = q(panel, SEL.hex);
    const img = q(panel, SEL.fallbackImg);
    return isNA(cs) && ((hex && isNA(hex.dataset.tlVal ? hex.dataset.tlOrig : hex.textContent)) || (img && /blocked/i.test(img.getAttribute('src') || '')));
  }
  function panelSnapshot(panel, id) {
    const lat = num(q(panel, SEL.lat) && q(panel, SEL.lat).textContent), lon = num(q(panel, SEL.lon) && q(panel, SEL.lon).textContent);
    if (!fin(lat) || !fin(lon)) return null;
    const altRaw = clean(q(panel, SEL.alt) && q(panel, SEL.alt).textContent), alt = num(altRaw);
    const altFt = /\bm\b/.test(altRaw) && fin(alt) ? alt * 3.28084 : alt;
    const gsRaw = clean(q(panel, SEL.gs) && q(panel, SEL.gs).textContent), gs = num(gsRaw);
    const gsKt = /km\/h/i.test(gsRaw) ? gs / 1.852 : /mph/i.test(gsRaw) ? gs / 1.15078 : gs;
    return { id, lat, lon, alt: fin(altFt) ? altFt : NaN, spd: fin(gsKt) ? gsKt : NaN, trk: num(q(panel, SEL.track) && q(panel, SEL.track).textContent), ts: 0, serverTime: 0, receivedAt: now(), gnd: false, src: 0, sel: true, type: clean(q(panel, SEL.model) && q(panel, SEL.model).textContent).toUpperCase().replace(/[^A-Z0-9]/g, ''), reg: '', fromPanel: true };
  }
  // The strip's place: one of the blocks of the panel's scrolling body, right under the photo - just above the route
  // boxes - so it scrolls with the rest and covers nothing. Checked on every update: FR24 draws the photo and the route
  // a moment apart, and a popular flight's panel has its "#9 Worldwide / tracked by" bar laid over the top of the body
  // (put after whatever came first, the strip could end up above the photo, under that bar).
  // (on a wide screen FR24's panel keeps the photo in a fixed block of its own, and only the body below it - route boxes
  // first - scrolls; on a narrow one the photo scrolls with the rest. The strip goes into the body that scrolls, right
  // above the route boxes, in both: put after the first block it sat in the fixed photo area, covering the route - CFNAP)
  const scrolls = el => { try { return /auto|scroll/.test(getComputedStyle(el).overflowY); } catch (e) { return false; } };
  function stripSpot(panel) {
    const main = panel.querySelector('main'); if (!main) return null;
    const anchor = q(panel, SEL.depIata) || q(panel, SEL.arrIata);
    if (anchor && main.contains(anchor)) {
      let blk = anchor;
      while (blk.parentElement && blk.parentElement !== main && !scrolls(blk.parentElement)) blk = blk.parentElement;
      if (blk.parentElement) return { scroll: blk.parentElement, before: blk };
    }
    const body = [...main.children].find(scrolls) || main.querySelector('main > div');
    if (!body) return null;
    const photo = [...body.children].find(c => !c.classList.contains('tl-strip') && !c.classList.contains('tl-photo') && c.querySelector('img'));
    return { scroll: body, after: photo || null };
  }
  function strip(panel) {
    let el = panel.querySelector('.tl-strip');
    if (!el) { el = document.createElement('div'); el.className = 'tl-strip flex border-b-2 border-white bg-gray-400 font-semibold text-gray-1300'; }
    const s = stripSpot(panel);
    if (s && s.before) { if (el.parentElement !== s.scroll || el.nextElementSibling !== s.before) s.before.before(el); }
    else if (s && s.after) { if (el.parentElement !== s.scroll || s.after.nextElementSibling !== el) s.after.after(el); }
    else if (!el.parentElement) { const anchor = s && s.scroll.firstElementChild; if (anchor) anchor.after(el); else (panel.querySelector('main') || panel).prepend(el); }
    return el;
  }
  const CONF_WORD = { filed: 'filed flight plan', confirmed: 'confirmed', landed: 'landed', likely: 'likely', probable: 'probable', possible: 'possible' };
  const pBadge = p => p ? `<span class="tl-p ${p >= 70 ? 'hi' : p >= 40 ? 'mid' : ''}">${p}%</span>` : '';
  const tagHtml = (text, kind) => `<span class="tl-tag tl-tag-${kind}">${esc(text)}</span>`;
  // FR24's own panel markup: an icon column, then label (small caps, grey) over value
  const ICON = {
    pin: '<svg viewBox="0 0 24 24" class="fill-current size-6 text-gray-1300" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>',
    plane: '<svg viewBox="0 0 24 24" class="fill-current size-6 text-gray-1300" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>'
  };
  const cellHtml = (label, value, sub, wide) => `<div class="tl-cell ${wide ? 'col-span-2' : 'col-span-1'} text-sm leading-tight"><p class="text-xs uppercase leading-tight text-gray-900">${label}</p><div class="tl-v text-gray-1300">${value}</div>${sub ? `<div class="tl-sub text-gray-900">${sub}</div>` : ''}</div>`;
  const rowHtml = (icon, body) => `<div class="flex w-10 shrink-0 justify-center border-r-2 border-white bg-gray-600 pt-2">${ICON[icon] || ''}</div><div class="tl-body flex flex-1 flex-col px-2 py-1.5">${body}</div>`;
  const gridHtml = cells => { const c = cells.filter(Boolean); return c.length ? `<div class="grid grid-cols-2 gap-x-2 gap-y-2">${c.join('')}</div>` : ''; };
  const apHtml = (iata, city) => `<b>${esc(iata)}</b>${city ? ' ' + esc(city) : ''}`;
  // 100% means confirmed - on final approach, landed, or no other airport left: labelled so, never "predicted 100%"
  const isConfirmed = r => !!r && (r.landed || r.destConf === 'confirmed');
  // the route in cells: the destination (predicted / confirmed / landed / flight plan) first, then the departure, then
  // what else it could be. what = 'departure airport' when FR24 has the destination and only the departure is ours.
  // the weather at the destination now (its METAR, when asked for): category and wind, as the strip shows it
  const wxTxt = id => { const a = id ? apById(id) : null, w = a && a.icao ? wxMap.get(a.icao.toUpperCase()) : null; if (!w) return ''; const wind = fin(w.ws) ? (w.ws < 3 ? 'calm' : (fin(w.wd) ? String(Math.round(w.wd / 10) * 10).padStart(3, '0') + '°' : 'variable') + ' ' + Math.round(w.ws) + (fin(w.gust) ? 'G' + Math.round(w.gust) : '') + ' kt') : ''; return [w.cat, wind].filter(Boolean).join(', ') + ' there now'; };
  // (an ETA more than five minutes gone, the aircraft not down: not one - a route kept from before, not shown as if it
  // were still the plan)
  const etaTxt = route => route.eta > 0 && route.eta >= nowS() - 300 ? 'ETA ' + hhmmZ(route.eta) : '';
  // (the why - ETA, reasons, the weather there, how it was worked out - is the destination's tooltip, not more lines in
  // the panel: `tip` is added to it)
  function routeCells(route, what, tip) {
    if (!route) return '';
    if (route.phase === 'parked' && !route.destIata) {
      const arr = route.arrivedFrom ? `arrived from ${esc(route.arrivedFrom)} at ${esc(hhmmZ(route.arrivedAt))}` : '';
      return gridHtml([cellHtml('On the ground at', apHtml(route.originIata, route.originCity), arr, true), route.nextIata ? cellHtml('Usually flies next to', apHtml(route.nextIata, route.nextCity) + pBadge(route.nextP), 'from its own flight log', true) : '']);
    }
    const conf = isConfirmed(route);
    const oCell = route.originIata ? cellHtml(what === 'departure airport' ? 'Departure' + tagHtml('Predicted', 'pred') : 'Departure', apHtml(route.originIata, route.originCity), esc((route.originNote || 'from the track') + (route.departedAt > 0 ? ', ' + hhmmZ(route.departedAt) : ''))) : cellHtml('Departure', '<span class="tl-muted">unknown</span>', esc(route.originNote || ''));
    let dLabel, dVal, dSub = '', why = [];
    if (!route.destIata) { dLabel = 'Destination' + tagHtml('Predicted', 'pred'); dVal = '<span class="tl-muted">not known yet</span>'; }
    else if (route.landed) { dLabel = 'Landed at' + tagHtml('Confirmed', 'conf'); dVal = apHtml(route.destIata, route.destCity); dSub = route.ata ? 'landed ' + esc(hhmmZ(route.ata)) : ''; }
    else if (conf) { dLabel = 'Destination' + tagHtml('Confirmed', 'conf'); dVal = apHtml(route.destIata, route.destCity); why = [etaTxt(route), 'confirmed: ' + (route.destReason || 'on final approach'), wxTxt(route.destId)]; }
    else if (route.destConf === 'filed') { dLabel = 'Destination (flight plan)'; dVal = apHtml(route.destIata, route.destCity); why = [etaTxt(route), route.destReason]; }
    else { dLabel = 'Destination' + tagHtml('Predicted', 'pred'); dVal = apHtml(route.destIata, route.destCity) + pBadge(route.destP); why = [etaTxt(route), route.destReason, wxTxt(route.destId)]; }
    const tipTxt = why.concat([tip]).filter(Boolean).join(' · ');
    if (tipTxt) dVal = `<span title="${esc(tipTxt)}">${dVal}</span>`;
    const dCell = cellHtml(dLabel, dVal, dSub, true);
    const alts = !route.landed && !conf && route.destConf !== 'filed' && route.alternatives && route.alternatives.length ? cellHtml('Also possible', route.alternatives.map(a => `<b>${esc(a.iata)}</b>${pBadge(a.p)}`).join(' &nbsp;')) : '';
    return gridHtml([dCell, oCell, alts]);
  }
  function renderStrip(panel, state, rec, note) {
    const el = strip(panel); el.dataset.state = state;
    let html;
    if (state !== 'resolved') html = rowHtml('plane', gridHtml([cellHtml('Blocked aircraft' + tagHtml('LADD', 'ladd'), state === 'pending' ? '<span class="tl-spin"></span> identifying via public ADS-B…' + (note ? ` <span class="tl-muted">· ${esc(note)}</span>` : '') : esc(note || 'No public ADS-B match yet.'), bridgeWarnHtml(), true)]));
    else {
      const hx = rec.hex ? withStored(rec) : rec;
      const hexU = (hx.hex || '').toUpperCase(), links = aircraftLinks(hx);
      const badge = hx.ladd ? 'LADD' : hx.pia ? 'PIA' : hx.mil ? 'MIL' : 'ADS-B';
      const st = routeState.get(rec.id);
      const route = (st && st.route) || rec.route;
      const nLog = route && route.legCount || 0, basis = route && (route.destIata || route.originIata) && !route.landed ? `${isConfirmed(route) ? 'confirmed' : 'worked out'} from its track, ${nLog ? `its own flight log (${nLog} earlier flight${nLog === 1 ? '' : 's'}${route.base ? ', based at ' + route.base : ''})` : 'no earlier flights of its own on record'}${popTxt()} and public ADS-B` : '';
      const routeHtml = route ? routeCells(route, '', basis) : (st && st.working ? gridHtml([cellHtml('Destination' + tagHtml('Predicted', 'pred'), '<span class="tl-spin"></span> <span class="tl-muted">working out the route…</span>', '', true)]) : '');
      // (no data-source credit: the hex, then whether it was just verified and the owner's town)
      const tail = [rec.verifiedAt && now() - rec.verifiedAt < 120000 ? 'verified' : '', hx.ownerCity ? esc(placeName(ENGINE.placeShort(hx.ownerCity))) : ''].filter(Boolean).join(' · ');
      const idCell = cellHtml('Identified from public ADS-B' + tagHtml(badge, 'ladd'), `${esc(hexU || '?')}${tail ? ` <span class="tl-muted">· ${tail}</span>` : ''}`, '', true);
      html = rowHtml('plane', `${gridHtml([idCell])}${routeHtml ? '<hr class="border border-white">' + routeHtml : ''}${links ? `<div class="tl-links">${links}</div>` : ''}<div class="tl-links">${toolLinks(rec)}</div>${healthHtml()}${bridgeWarnHtml()}`);
    }
    if (el.__tlHtml !== html) { el.innerHTML = html; el.__tlHtml = html; }
  }
  // flight log · trace · photos · registry: the aircraft's pages elsewhere (every aircraft's strip, LADD or not)
  function aircraftLinks(hx) {
    const hexL = (hx.hex || '').toLowerCase(), reg = hx.reg || '';
    return [
      reg && `<a href="/data/aircraft/${encodeURIComponent(reg.toLowerCase())}" target="_blank" rel="noopener">flight log</a>`,
      hexL && `<a href="https://globe.airplanes.live/?icao=${esc(hexL)}&showTrace=${new Date().toISOString().slice(0, 10)}" target="_blank" rel="noopener noreferrer">trace</a>`,
      reg && `<a href="https://www.jetphotos.com/showphotos.php?regsearch=${encodeURIComponent(reg)}" target="_blank" rel="noopener noreferrer">photos</a>`,
      (u => u && `<a href="${esc(u[0])}" target="_blank" rel="noopener noreferrer" title="${esc(u[1])}: ${esc(reg)}">registry</a>`)(registryUrl(reg))
    ].filter(Boolean).join(' · ');
  }
  // the national register's own page (or search) for a registration - opened by the user, never read by the script where
  // the register asks robots not to (Transport Canada)
  function registryUrl(reg) {
    const r = String(reg || '').toUpperCase(), e = encodeURIComponent(r);
    if (/^N\d/.test(r)) return [`https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${e}`, 'FAA register'];
    if (/^G-/.test(r)) return ['https://siteapps.caa.co.uk/g-info/', 'G-INFO - search'];
    if (/^M-/.test(r)) return [`https://ardis.iomaircraftregistry.com/register/search?prs_rm__tt=1&prs_rm__v1=${encodeURIComponent(r.slice(2))}&prs_bg__2__value=Search`, 'Isle of Man register'];
    if (/^HB-/.test(r)) return ['https://app02.bazl.admin.ch/web/bazl/en/#/lfr/search', 'Swiss register - search'];
    if (/^C-[FGI]/.test(r)) return ['https://wwwapps.tc.gc.ca/saf-sec-sur/2/ccarcs-riacc/RchSimp.aspx', 'Canadian register (CCARCS) - search'];
    if (/^VH-/.test(r)) return ['https://www.casa.gov.au/search-centre/aircraft-register', 'Australian register (CASA) - search'];
    if (/^ZK-/.test(r)) return ['https://www.aviation.govt.nz/aircraft/aircraft-registration/aircraft-register-search/', 'New Zealand register - search'];
    if (/^EI-/.test(r)) return ['https://www.iaa.ie/commercial-aviation/aircraft-registration-2/latest-register-and-monthly-changes-1', 'Irish register (IAA)'];
    return null;
  }
  const linksHtml = rec => { const hx = withStored(rec), a = aircraftLinks(hx); return `${a ? `<div class="tl-links">${a}</div>` : ''}<div class="tl-links">${toolLinks(rec)}</div>`; };
  // An aircraft's pictures are FR24's own slideshow's: the page puts them into FR24's panel stream (page.js, the aircraft
  // block), so they are drawn exactly as FR24 draws its own - its size and crop, its credit, its dots. Only while FR24
  // still draws no picture of the aircraft (its fallback: the "blocked" drawing, a sideview) are they drawn here, and
  // only once the page has had a moment to hand them over: a frame of FR24's own photo size (the panel's width, 16:9)
  // in place of FR24's fallback, which is hidden meanwhile (a stylesheet rule on the element after ours - nothing of
  // FR24's own is changed), the credit at its bottom left as FR24's, dots for more than one. It goes the moment FR24
  // draws a picture itself. (The picture used to be written into FR24's fallback picture: a sideview's frame, wide and
  // short - 270 x 110 - with a second credit of ours at its bottom right, beside FR24's own, and FR24 kept drawing into
  // those same elements: JNY5's and T7OKS's first slide, short, with two credits)
  const PHOTO_WAIT = 1500;
  const notPhoto = /sideview|blocked|jp-promo|airport-data|placeholder/i;
  const fr24Photo = panel => [...panel.querySelectorAll('img[data-testid*="__image__"]:not([data-testid*="fallback"]):not([data-testid$="promo"])')].some(i => !i.closest('.tl-photo') && !notPhoto.test(i.getAttribute('src') || ''));
  // (where FR24 draws its picture: the panel's image box - else the block its fallback picture sits in)
  function photoSlot(panel) {
    const box = q(panel, SEL.image), fb = q(panel, SEL.fallbackImg);
    if (box && (!fb || box.contains(fb))) return box;
    return fb && fb.parentElement !== panel ? fb.parentElement : null;
  }
  function dropPhoto(panel) { panel.querySelectorAll('.tl-photo').forEach(e => e.remove()); }
  function photoHtml(list, n) {
    const ph = list[n], url = noBar(ph.large || ph.medium || ph.thumb), link = ph.link || url;
    const dots = list.length > 1 ? `<div class="tl-photo-dots">${list.map((_, i) => `<button type="button" data-n="${i}"${i === n ? ' class="on"' : ''} aria-label="Photo ${i + 1}"></button>`).join('')}</div>` : '';
    return `<a class="tl-photo-img" href="${esc(link)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="" referrerpolicy="no-referrer"></a><a class="tl-photo-cr" href="${esc(link)}" target="_blank" rel="noopener noreferrer">© ${esc(ph.credit || ph.source || 'Photo')}</a>${dots}`;
  }
  function applyPhoto(panel, rec) {
    const list = goodPhotos(rec.photos).filter(p => p.large || p.medium || p.thumb).slice(0, 3);
    // (FR24 draws a picture itself - ours, handed over, or its own: nothing of ours beside it)
    if (!list.length || fr24Photo(panel)) { panel.__tlPhWait = null; return dropPhoto(panel); }
    const key = (rec.hex || '') + '|' + list.map(p => noBar(p.large || p.medium || p.thumb)).join('|');
    let el = panel.querySelector('.tl-photo');
    if (!el || el.dataset.key !== key) {
      // (the page hands the pictures to FR24 within a moment of their coming: FR24's own slideshow then, not this)
      const w = panel.__tlPhWait;
      if (!el && (!w || w.key !== rec.hex)) { panel.__tlPhWait = { key: rec.hex, at: now() }; setTimeout(syncPanelSoon, PHOTO_WAIT + 50); return; }
      if (!el && now() - w.at < PHOTO_WAIT) return;
      if (!el) {
        el = document.createElement('div'); el.className = 'tl-photo';
        el.addEventListener('click', e => { const b = e.target.closest('button[data-n]'); if (!b) return; e.preventDefault(); e.stopPropagation(); el.innerHTML = photoHtml(el.__tlList, Number(b.dataset.n)); });
      }
      el.__tlList = list; el.dataset.key = key; el.innerHTML = photoHtml(list, 0);
    }
    // (right before FR24's frame - the stylesheet hides the element after ours - wherever FR24 has put it now)
    const slot = photoSlot(panel); if (!slot || !slot.parentElement) return dropPhoto(panel);
    if (el.nextElementSibling !== slot) slot.parentElement.insertBefore(el, slot);
    panel.querySelectorAll('.tl-photo').forEach(e => { if (e !== el) e.remove(); });
  }
  // FR24's time-zone line under an airport: "CEST (UTC +02:00)"
  function tzLabel(ap) {
    const tz = ap && ap.timezone, off = tz && fin(tz.offset) ? tz.offset : ap && fin(ap.tz) ? ap.tz : null; if (off == null) return '';
    const m = Math.round(Math.abs(off) / 60), s = `UTC ${off < 0 ? '-' : '+'}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return tz && tz.abbr ? `${tz.abbr} (${s})` : s;
  }
  function applyAirportBox(p, iata, city, title, inferred, ours, ap) {
    if (!p) return;
    setText(p, iata, title, ours);
    // the city and time-zone lines of the same airport follow the code whenever the code shown is ours (a better
    // destination found later changes all three together; FR24's own airports are never touched)
    const side = /departure/.test(p.getAttribute('data-testid') || '') ? 'departure' : 'arrival', panel = p.closest(SEL.panel);
    if (panel && clean(textOf(p)).replace(/\?$/, '') === iata) {
      const cityEl = panel.querySelector(`[data-testid="aircraft-panel__airport-${side}-city"]`), tzEl = panel.querySelector(`[data-testid="aircraft-panel__airport-${side}-timezone"]`);
      if (cityEl && (city || iata)) setText(cityEl, city || iata, title, true);
      const tzt = tzLabel(ap); if (tzEl && tzt) setText(tzEl, tzt, title, true);
    }
    const cell = p.closest('[class*="col-span"]'); const sub = cell && cell.children[1];
    if (sub && sub.tagName === 'DIV' && !sub.querySelector('[data-testid]')) {
      const cur = clean(sub.textContent), want = city || iata;
      const replaceable = /^not available$/i.test(cur) || sub.dataset.tlVal || ours === true || (ours && ours.some(v => v && cur.toUpperCase().startsWith(v.toUpperCase())));
      if (replaceable && cur.toUpperCase() !== want.toUpperCase()) { if (!('tlOrig' in sub.dataset)) sub.dataset.tlOrig = textOf(sub); writeOwn(sub, want); sub.dataset.tlVal = want; sub.title = title; }
    }
    const mark = p.querySelector('.tl-inf');
    if (inferred && !mark) { const s = document.createElement('span'); s.className = 'tl-inf'; s.textContent = inferred; s.title = title; p.appendChild(s); }
    else if (!inferred && mark) mark.remove();
  }
  function applyRoute(panel, rec) {
    const st = routeState.get(rec.id), r = (st && st.route) || rec.route; if (!r) return;
    const ours = rec.injected || [];
    // (a private site has no FR24 airport: its time zone is that of the nearest one)
    if (r.originIata) applyAirportBox(q(panel, SEL.depIata), r.originIata, r.originCity, `Origin: ${r.originNote}`, '', ours, apById(r.originId) || (r.originSite && apById(r.originSite.tzId)));
    if (r.destIata && (r.landed || !r.onGround || r.phase === 'taxi' || r.destConf === 'filed')) applyAirportBox(q(panel, SEL.arrIata), r.destIata, r.destCity, `Destination – ${CONF_WORD[r.destConf] || r.destConf}${r.destP ? ' ' + r.destP + '%' : ''}: ${r.destReason}`, ['filed', 'confirmed', 'landed', 'likely'].includes(r.destConf) ? '' : '?', ours, apById(r.destId) || (r.destSite && apById(r.destSite.tzId)));
  }
  // FR24's own panel shows where the aircraft is. When FR24's stream has given this script no position for this flight
  // lately (F-BOZO on short final at Dinard sat at "waiting for its position"), that is taken instead - so a flight on
  // screen is never without one, and a landing is seen.
  function notePanelPos(panel, id) {
    const h = posHistory.get(id), last = h && h[h.length - 1];
    if (last && !last.panel && now() - last.at < 8000) return;
    const s = panelSnapshot(panel, id); if (!s) return;
    if (last && last.panel && Math.abs(last.lat - s.lat) < 1e-5 && Math.abs(last.lon - s.lon) < 1e-5 && now() - last.at < 15000) return;
    const onGnd = /ground/i.test(clean(q(panel, SEL.alt) && q(panel, SEL.alt).textContent));
    const alt = onGnd ? 0 : s.alt;
    onPos({ id, lat: s.lat, lon: s.lon, alt: fin(alt) ? alt : null, trk: fin(s.trk) ? s.trk : null, spd: fin(s.spd) ? s.spd : null, gnd: fin(alt) && alt <= 25 && (!fin(s.spd) || s.spd < 45), at: now(), panel: true });
  }
  // FR24 has named the route itself (often only once the aircraft has landed): its own airports go back into the cells
  // this script had written into - Vue does not redraw a value that did not change on its side
  function fr24RouteBack(panel, s) {
    for (const [side, apId] of [['arrival', s.d], ['departure', s.o]]) {
      const ap = apById(apId), el = q(panel, side === 'arrival' ? SEL.arrIata : SEL.depIata); if (!ap || !el || !('tlVal' in el.dataset)) continue;
      const put = (e, v) => { if (!e || !('tlVal' in e.dataset)) return; if (v) writeOwn(e, v); delete e.dataset.tlVal; delete e.dataset.tlOrig; e.removeAttribute('title'); };
      put(el, apCode(ap)); const m = el.querySelector('.tl-inf'); if (m) m.remove();
      put(panel.querySelector(`[data-testid="aircraft-panel__airport-${side}-city"]`), ap.city || ap.name);
      put(panel.querySelector(`[data-testid="aircraft-panel__airport-${side}-timezone"]`), tzLabel(ap));
      const cell = el.closest('[class*="col-span"]'); put(cell && cell.children[1], ap.city || ap.name);
    }
  }
  // an older copy of this script is also installed (its page bridge answered): say so - the two would fight
  const bridgeWarnHtml = () => bridgeV && bridgeV !== VERSION ? `<div class="tl-warn">⚠ another copy of this script (${esc(bridgeV === '?' ? 'an older version' : 'v' + bridgeV)}) is also running - remove it from your userscript manager</div>` : '';
  // An ordinary flight FR24 shows without a destination: what was reasoned, and why, above FR24's own details
  function renderPubStrip(panel, pub) {
    const st = routeState.get(pub.id), route = (st && st.route) || pub.route;
    const s = schedOf(pub.id), what = s && s.d && !s.o ? 'departure airport' : 'destination';
    const el = strip(panel);
    const sch = schedOf(pub.id), diag = `stream ${msgCount.follow || 0}/${msgCount.sched || 0}/${msgCount.pos || 0} · ${sch ? 'fr24 ' + (sch.o ? 'o' : '-') + (sch.d ? 'd' : '-') : pub.naDest ? 'panel N/A' : '?'}`;
    const fromSchedule = !!(route && route.destConf === 'filed' && /FR24's own schedule/.test(route.destReason || ''));
    // (the same engine as for a blocked aircraft, with the aircraft's own log: how much of it there was is said)
    const nLog = route && route.legCount || 0, logTxt = nLog ? `its own flight log (${nLog} earlier flight${nLog === 1 ? '' : 's'}${route.base ? ', based at ' + esc(route.base) : ''})` : 'no earlier flights of its own on record';
    const how = fromSchedule ? `FR24's panel has no airports for this flight - these are from FR24's own schedule` : `FR24 has no ${what} for this flight - ${isConfirmed(route) ? 'confirmed' : 'worked out'} from its track, ${logTxt}${popTxt()} and public ADS-B`;
    const foot = bridgeWarnHtml(), tip = `${how.replace(/<[^>]+>/g, '')} · v${VERSION} · ${diag}`;
    let html;
    if (route && (route.destIata || route.originIata)) {
      el.dataset.state = 'resolved';
      html = rowHtml('pin', routeCells(route, what, tip) + linksHtml(pub) + foot);
    } else {
      // (still being worked out - or why it could not be: shown, never a silent blank)
      el.dataset.state = 'pending';
      const pos = currentPos(pub.id);
      const why = pub.routeErr ? 'could not work it out: ' + pub.routeErr : !pub.routeStarted ? 'waiting for FR24\'s flight data' : !pos ? 'waiting for its position' : now() - (pub.routeAt || 0) > 8000 ? 'no airport fits its track yet' : 'working out the ' + what;
      const diag = !pos ? `live positions: ${posStats.n ? posStats.n + ' received, none for this flight id' : 'none received yet'}` : '';
      html = rowHtml('pin', gridHtml([cellHtml((what === 'departure airport' ? 'Departure' : 'Destination') + tagHtml('Predicted', 'pred'), `${/^working/.test(why) ? '<span class="tl-spin"></span> ' : ''}<span class="tl-muted" title="${esc(diag)}">${esc(why)}…</span>`, '', true)]) + linksHtml(pub) + foot);
    }
    if (el.__tlHtml !== html) { el.innerHTML = html; el.__tlHtml = html; }
  }
  // the LADD tag: the FAA's LADD programme page; PIA: its ADS-B privacy page; a military aircraft: its rebuilt log
  const tagLink = hx => hx.ladd || !hx.mil ? (hx.pia && !hx.ladd ? 'https://www.faa.gov/air_traffic/technology/equipadsb/privacy' : 'https://www.faa.gov/pilots/ladd') : (hx.reg ? `/data/aircraft/${encodeURIComponent(hx.reg.toLowerCase())}` : 'https://www.faa.gov/pilots/ladd');
  function applyHeader(panel, hx) {
    const cs = q(panel, SEL.callsign); if (!cs) return;
    const name = shownOwner(hx, hx.cs) || '';
    const air = q(panel, SEL.airline);
    if (name) {
      if (air) setText(air, name, 'Operator (LADD unblocker)', panel.__tlNoAirline ? true : undefined);
      else {
        const model = q(panel, SEL.model); const col = model && model.parentElement && model.parentElement.parentElement;
        let mine = panel.querySelector('.tl-airline');
        if (!mine && col) { mine = document.createElement('div'); mine.className = 'tl-airline'; mine.title = 'Operator (LADD unblocker)'; col.appendChild(mine); }
        if (mine && mine.textContent !== name) mine.textContent = name;
      }
    }
    // (the tag says what the aircraft is - LADD-listed or hidden by FR24, PIA, military - and nothing for one that is
    // none of them: EZY54VT, an easyJet A320neo FR24 sent for a moment without its identity, was tagged "LADD")
    const badge = badgeOf(hx), cur = panel.querySelector('.tl-ladd');
    if (cur && cur.textContent !== badge) cur.remove();
    if (badge && !panel.querySelector('.tl-ladd')) {
      const a = document.createElement('a'); a.className = 'tl-ladd'; a.textContent = badge;
      a.href = tagLink(hx); a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.title = badge === 'LADD' ? 'On the FAA Limiting Aircraft Data Displayed (LADD) programme or hidden by FR24 - what it is' : 'Identified from public ADS-B - opens the aircraft page with its rebuilt flight log';
      const model = q(panel, SEL.model); (model || cs).after(a);
    }
  }
  // FR24's panel padlocks country of registration, MSN, age, vertical speed, GPS altitude, squawk and the other
  // subscription fields for every flight whatever the data says (its lock wrapper defaults to "locked" when the
  // availability flag is absent, and protobuf cannot send an explicit false). For an aircraft this script identified,
  // the value it holds from public sources (FAA registry, ICAO address block, ADS-B) is written in place of the
  // padlock. Cells FR24 renders itself are never touched.
  const LOCKED_FIELDS = [
    [/^country of reg/i, 'country'], [/^serial number|^msn\b/i, 'msn'], [/^age\b/i, 'age'], [/^vertical speed/i, 'vs'],
    [/^gps alt/i, 'agps'], [/^squawk/i, 'sq'], [/^indicated air ?speed|^ias\b/i, 'ias'], [/^true air ?speed|^tas\b/i, 'tas'],
    [/^mach/i, 'mach'], [/^temperature|^oat\b/i, 'oat'], [/^wind/i, 'wind'], [/^fir\/uir|^airspace/i, 'fir']
  ];
  // the padlock: a wrapper holding only an icon (a real value always has text)
  const lockOf = cell => [...cell.children].find(c => c.tagName !== 'P' && !c.classList.contains('tl-filled') && c.querySelector('svg') && !c.querySelector('p') && !clean(c.textContent));
  const WX_KEYS = ['ias', 'tas', 'mach', 'oat', 'wind'];
  function fillLockedCell(cell, text, key, est) {
    let mine = cell.querySelector('.tl-filled[data-k="' + key + '"]');
    const lock = lockOf(cell);
    if (!text || !lock) { if (mine) mine.remove(); if (lock) lock.classList.remove('tl-filled-lock'); return; }
    if (!mine) { mine = document.createElement('p'); mine.className = 'tl-filled text-md leading-tight text-gray-1300'; mine.dataset.k = key; mine.title = 'From public data (LADD unblocker)'; lock.after(mine); }
    lock.classList.add('tl-filled-lock');
    // (an estimate - the monitor's, from a weather model and the aircraft's ground speed - marked as one)
    if (est) text = '≈ ' + text;
    const title = est ? 'Estimated from NOAA\'s GFS weather model and the ground speed, typically within 10 kt and 2 °C (LADD unblocker)' : 'From public data (LADD unblocker)';
    if (mine.title !== title) mine.title = title;
    if (mine.textContent !== text) mine.textContent = text;
  }
  // the newest telemetry for an aircraft: its own feed, or the area cache (every aircraft on screen, refreshed every few s)
  function freshTelem(rec) {
    let tl = telemetry.get(rec.id);
    const c = rec.hex ? areaCache.get(rec.hex) : null;
    if (c && (!tl || seenAt(c) > (tl.at || 0) + 1000)) { tl = telemOf(c); telemetry.set(rec.id, tl); }
    return tl && now() - (tl.at || 0) < (tl.gnd ? 900000 : 120000) ? tl : null;
  }
  function lockedValues(panel, rec, hx) {
    const fresh = freshTelem(rec);
    const where = (rec.hex && areaCache.get(rec.hex)) || pending.get(rec.id);
    const altRaw = clean(q(panel, SEL.alt) && q(panel, SEL.alt).textContent), metric = /\d\s*m$/i.test(altRaw);
    const gsRaw = clean(q(panel, SEL.gs) && q(panel, SEL.gs).textContent), kmh = /km\/h/i.test(gsRaw), mph = /mph/i.test(gsRaw);
    const n0 = v => Math.round(v).toLocaleString('en-US');
    const alt = ft => metric ? n0(ft * 0.3048) + ' m' : n0(ft) + ' ft';
    const spd = kt => kmh ? n0(kt * 1.852) + ' km/h' : mph ? n0(kt * 1.15078) + ' mph' : n0(kt) + ' kts';
    const c = hx.hex ? countryOf(hx.hex, hx.reg) : null;
    const age = ageOf(hx);
    const sq = fresh && fresh.sqs ? fresh.sqs : (rec.squawk > 0 ? rec.squawk.toString(8).padStart(4, '0') : '');
    return {
      country: (regCountry(hx.reg) || {}).name || hx.country || (c && c.name) || '', msn: hx.msn || '', age: ageText(hx), sq,
      vs: fresh && fin(fresh.vr) ? (metric ? (fresh.vr * 0.00508).toFixed(1) + ' m/s' : n0(fresh.vr) + ' fpm') : '',
      agps: fresh && fin(fresh.agps) ? alt(fresh.agps) : '',
      ias: fresh && fresh.ias > 0 ? spd(fresh.ias) : '', tas: fresh && fresh.tas > 0 ? spd(fresh.tas) : '',
      mach: fresh && fresh.mach > 0 ? fresh.mach.toFixed(3) : '', oat: fresh && fin(fresh.oat) ? `${Math.round(fresh.oat)} °C` : '',
      wind: fresh && fin(fresh.wd) && fin(fresh.ws) ? `${Math.round(fresh.wd)}° / ${spd(fresh.ws)}` : '',
      est: !!(fresh && fresh.wx),
      fir: fresh && fresh.air ? (fresh.airId && fresh.airId !== fresh.air ? `${fresh.air} (${fresh.airId})` : fresh.air) : (where && fin(where.lat) ? firLabelAt(where.lat, where.lon, where.gnd ? 0 : where.alt) : '')
    };
  }
  function applyLocked(panel, rec, hx) {
    let vals = null;
    for (const cell of panel.querySelectorAll('[class*="col-span"]')) {
      const label = cell.firstElementChild; if (!label || label.tagName !== 'P') continue;
      const hit = LOCKED_FIELDS.find(f => f[0].test(clean(label.textContent))); if (!hit) continue;
      if (!cell.querySelector('.tl-filled') && !lockOf(cell)) continue;
      vals = vals || lockedValues(panel, rec, hx);
      fillLockedCell(cell, vals[hit[1]], hit[1], vals.est && WX_KEYS.includes(hit[1]));
    }
  }
  // An ordinary flight FR24 lists as "Private owner": the registered owner / operator from the registries (FAA, the Isle
  // of Man, hexdb, adsbdb) in its place, legal form left off, as for a blocked aircraft - a real airline name FR24 shows
  // is never touched
  // A serial number FR24 itself shows (it often does while padlocking the AGE - TF-AKG, 33732): kept, so the age can be
  // dated from it
  function notePanelMsn(panel, rec) {
    const el = q(panel, SEL.msn); if (!el || !rec || !rec.hex || 'tlVal' in el.dataset) return;
    const v = clean(textOf(el)); if (!v || isNA(v) || !/^[A-Z0-9][A-Z0-9 ./-]{0,14}$/i.test(v)) return;
    const hx = store.getHex(rec.hex) || {}; if (hx.msn) return;
    store.mergeHex(rec.hex, { msn: v }); if (!rec.msn) rec.msn = v;
  }
  function applyOwner(panel, hx) {
    const air = q(panel, SEL.airline); if (!air) return;
    const fr24Says = clean('tlOrig' in air.dataset ? air.dataset.tlOrig : textOf(air));
    if (!/^private owner$/i.test(fr24Says)) return;
    const name = shownOwner(hx, hx.cs);
    if (name) setText(air, name, 'Registered owner / operator (LADD unblocker)', true);
  }
  function applyRecord(panel, rec) {
    const hx = rec.hex ? withStored(rec) : rec;
    setText(q(panel, SEL.callsign), csOfRec(hx));
    setText(q(panel, SEL.registration), hx.reg);
    setText(q(panel, SEL.hex), (hx.hex || '').toUpperCase());
    if (hx.msn) setText(q(panel, SEL.msn), hx.msn, 'Serial number');
    const at = ageText(hx); if (at) setText(q(panel, SEL.age), at, ageTitle(hx));
    applyHeader(panel, hx);
    applyPhoto(panel, hx);
    applyRoute(panel, rec);
    applyLocked(panel, rec, hx);
    renderStrip(panel, 'resolved', hx);
  }

  // ---- LADD badge in the search dropdown --------------------------------------------------------------------------
  // (an aircraft found by registration that this script has never seen fly: the page asks FR24's register lookup, which
  // lists no flights for a blocked one - M-CDJC, M-PORT, M-WJBA - and it is kept as blocked from then on)
  const searchHex = new Map();     // registration -> Mode S address, of search results
  function onSearchRows(d) {
    for (const x of (d && d.rows) || []) {
      const hex = clean(x.hex).toLowerCase(), reg = clean(x.reg).toUpperCase(); if (!/^[0-9a-f]{6}$/.test(hex) || !reg) continue;
      const hx = store.getHex(hex) || {}, upd = {};
      if (!hx.reg) upd.reg = reg; if (!hx.type && x.type && /^[A-Z][A-Z0-9]{1,3}$/.test(clean(x.type).toUpperCase())) upd.type = clean(x.type).toUpperCase();
      if (Object.keys(upd).length) store.mergeHex(hex, upd);
      if (x.blocked) noteFr24Blocked(hex, reg).then(tagSearchResults);
      searchHex.set(reg, hex); if (searchHex.size > 500) searchHex.delete(searchHex.keys().next().value);
    }
    tagSearchResults();
  }
  function tagSearchResults() {
    const box = document.querySelector('[data-testid="search__results"]'); if (!box) return;
    for (const row of box.querySelectorAll('[data-testid="search__result-row"]')) {
      if (row.querySelector('.tl-ladd-chip')) continue;
      const link = row.querySelector('[data-search-result]');
      const key = link && (link.dataset.searchResult || '');
      const live1 = row.querySelector('[data-testid^="search__result-live"]');
      let rec = null;
      const m = /^([a-z]+):(.+)$/.exec(key || '');
      if (m && m[1] === 'aircraft') { const reg = m[2].toUpperCase(); for (const r of live.values()) if (r.reg && r.reg.toUpperCase() === reg) { rec = r; break; } if (!rec) { const hx = (searchHex.has(reg) && store.getHex(searchHex.get(reg))) || store.byReg(reg); if (hx && (hx.ladd || hx.mil)) rec = hx; } }
      else if (m && m[1] === 'live') rec = live.get(parseInt(m[2], 16)) || null;
      else if (live1) { const t = clean(row.textContent).toUpperCase(); for (const r of live.values()) if (r.cs && t.startsWith(r.cs.toUpperCase())) { rec = r; break; } }
      if (!rec || !(rec.ladd || rec.pia || rec.mil)) continue;
      const anchor = row.querySelector('[data-testid$="__type"]') || row.querySelector('[data-testid$="__name"]');
      if (!anchor) continue;
      const chip = document.createElement('span');
      chip.className = 'tl-ladd-chip'; chip.textContent = rec.ladd ? 'LADD' : rec.pia ? 'PIA' : 'MIL';
      chip.title = 'Identified from public ADS-B by the LADD unblocker';
      anchor.after(chip);
    }
  }

  // ---- the yellow LADD / PIA / MIL tag wherever an identified aircraft appears ------------------------------------------
  // (panel header and search results above; here the airport boards, their expanded cards and "Recent <reg> flights")
  const badgeOf = r => r ? (r.ladd ? 'LADD' : r.pia ? 'PIA' : r.mil ? 'MIL' : '') : '';
  const flagsOf = rec => rec && rec.hex ? withStored(rec) : rec;
  function addChip(after, rec) {
    const b = badgeOf(flagsOf(rec)); if (!b || !after || !after.parentNode) return;
    const nx = after.nextElementSibling;
    if (nx && nx.classList.contains('tl-ladd-chip')) { if (nx.textContent !== b) nx.textContent = b; return; }
    const c = document.createElement('span'); c.className = 'tl-ladd-chip'; c.textContent = b; c.title = 'Identified from public ADS-B by the LADD unblocker';
    after.after(c);
  }
  const labelIndex = { at: 0, size: -1, map: new Map() };
  function recByLabel(label) {
    label = clean(label).toUpperCase(); if (!label || isNA(label)) return null;
    if (labelIndex.size !== live.size || now() - labelIndex.at > 3000) {
      labelIndex.map = new Map();
      for (const r of live.values()) { if (r.reg) labelIndex.map.set(r.reg.toUpperCase(), r); if (r.cs) labelIndex.map.set(r.cs.toUpperCase(), r); }
      labelIndex.size = live.size; labelIndex.at = now();
    }
    return labelIndex.map.get(label) || null;
  }
  function tagBoards() {
    for (const li of document.querySelectorAll('li[id^="airport_schedule_"]')) {
      const head = li.querySelector('[data-testid^="airport-panel__schedules__flight__"]') || li;
      const line = head.querySelector('.space-x-1'), card = li.querySelector('[data-testid="airport-flight-details__registration"]');
      if (line && line.querySelector('.tl-ladd-chip') && !card) continue;          // already tagged, nothing expanded
      const n = Number(li.id.slice(17)), cs = line && line.firstElementChild;
      const rec = (n >= 9e9 && live.get(n - 9e9)) || (cs ? recByLabel(cs.textContent) || boardTags.get(clean(cs.textContent).toUpperCase()) : null);
      if (!rec) continue;
      if (line && !line.querySelector('.tl-ladd-chip')) { line.classList.add('tl-board-line'); addChip(line.lastElementChild, rec); }   // one line, as FR24 lays its rows out
      addChip(card, rec);
      if (card && n >= 9e9) predictedNote(li, rec);
    }
  }
  // The expanded card of a flight this script put on the board: FR24's info box (asked for with status.isAmbiguous)
  // becomes a yellow note saying the destination is a prediction, how sure it is, why, and what else it could be.
  // FR24's own text is hidden, not replaced, so its re-renders never fight the note.
  function predictedNote(li, rec) {
    const box = li.querySelector('aside'); if (!box) return;
    const route = (routeState.get(rec.id) || {}).route || rec.route;
    if (!route || !route.destId || route.landed) { box.classList.remove('tl-pred'); const x = box.querySelector('.tl-pred-text'); if (x) x.remove(); return; }
    const ap = apById(route.destId), where = `${(ap && (ap.city || ap.name)) || route.destCity || ''} (${route.destIata || apCode(ap)})`.trim();
    const alts = (route.alternatives || []).filter(a => a && a.iata && a.p >= 4).slice(0, 3).map(a => `${a.iata} ${a.p}%`);
    const badge = badgeOf(flagsOf(rec));
    const conf = isConfirmed(route);
    const title = conf ? `Confirmed destination: ${where}` : `Predicted destination: ${where}${route.destP ? ` · ${route.destP}% likely` : ''}`;
    const intro = badge === 'LADD' ? 'This aircraft is LADD-blocked, so its flight plan is not public.' : 'This flight\'s plan is not public.';
    const body = conf ? `${intro} Its destination is confirmed by the LADD unblocker from its track: ${route.destReason || 'on final approach'}.`
      : `${intro} Its destination and arrival time are predicted by the LADD unblocker from its track, height, speed and the aircraft's own history${route.destReason ? ` (${route.destReason})` : ''}.${alts.length ? ` Also possible: ${alts.join(', ')}.` : ''} It may still land elsewhere.`;
    let note = box.querySelector('.tl-pred-text');
    if (note && note.dataset.sig === title + body) return;
    if (!note) { note = document.createElement('div'); note.className = 'tl-pred-text'; box.appendChild(note); }
    box.classList.add('tl-pred'); box.classList.toggle('tl-conf', conf);
    note.dataset.sig = title + body;
    note.innerHTML = `<b>${esc(title)}</b><br>${esc(body)}`;
  }
  function tagRecent(panel, rec) {
    if (!panel || !rec || !histShown.has(String(rec.reg || '').toUpperCase())) return;
    for (const el of panel.querySelectorAll('[data-testid="aircraft-panel__recent-flights__callsign"]')) addChip(el, rec);
  }
  function tagEverything() {
    try { tagSearchResults(); tagBoards(); const panel = document.querySelector(SEL.panel); if (panel) tagRecent(panel, live.get(currentId())); } catch (e) { log('tags', e); }
  }
  // Run straight from the observer: its callback comes after the DOM change and before the next paint, so a new row
  // never shows up untagged (an animation-frame hop is not reliable - some embedded/background views never fire it).
  // The tagging is idempotent, so the observer seeing our own chips just finds nothing more to do.
  function watchForTags() {
    if (!document.body) return void document.addEventListener('DOMContentLoaded', watchForTags, { once: true });
    // (a panel that opens is filled in the same pass, not at the next 400 ms tick)
    new MutationObserver(() => { tagEverything(); const p = document.querySelector(SEL.panel); if (p && p !== observedPanel) syncPanel(); }).observe(document.body, { childList: true, subtree: true });
  }

  let syncTimer = 0, observer = null, observedPanel = null;
  function syncPanelSoon() { if (syncTimer) return; syncTimer = setTimeout(() => { syncTimer = 0; syncPanel(); }, 40); }
  // (an error while filling the panel is shown in it - with the version - instead of leaving it silently unfilled)
  function syncPanel() {
    try { syncPanel0(); } catch (e) {
      log('panel sync failed', e);
      const panel = document.querySelector(SEL.panel); if (!panel) return;
      try { const el = strip(panel); el.dataset.state = 'failed'; const html = rowHtml('pin', gridHtml([cellHtml('LADD unblocker', '<span class="tl-warn">script error</span>', esc(String((e && e.message) || e).slice(0, 160)) + ' · v' + VERSION, true)])); if (el.__tlHtml !== html) { el.innerHTML = html; el.__tlHtml = html; } } catch (_) { /* ignore */ }
    }
  }
  function syncPanel0() {
    tagSearchResults();
    const panel = document.querySelector(SEL.panel);
    if (!panel) { shownId = null; if (observedPanel) { observer && observer.disconnect(); observedPanel = null; } if (idFromUrl() == null) selectedId = null; return; }
    if (observedPanel !== panel) {
      observer && observer.disconnect();
      observer = new MutationObserver(syncPanelSoon);
      observer.observe(panel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
      observedPanel = panel;
    }
    // (FR24's map playback: the flight as it was then - 06-playback)
    if (pbMode()) { pbStrip(panel); return; }
    let id = currentId();
    // The aircraft on screen decides which flight this is. An id whose aircraft is another one (a stale selection, the
    // previous flight of the same stream) is never used for it: the page's address, else the id FR24's stream gave
    // this aircraft, is. (UGD111, Uganda Airlines LGW -> EBB, was "predicted Yaounde" under an old record.) Not while
    // FR24 is still redrawing the panel for a newly selected flight (it shows the previous aircraft for a moment).
    { const shown0 = panelHex(panel), map = panel.__tlMap;
      // (a match made earlier stands while the selection is the same and the panel still shows that aircraft)
      if (map && map.cur === id && (!shown0 || !hexOfId(map.id) || hexOfId(map.id) === shown0)) id = map.id;
      else {
        panel.__tlMap = null;
        const hx0 = id != null ? hexOfId(id) : '', u = idFromUrl();
        // (the same aircraft's current flight: the one FR24's stream reported last - when FR24 renumbers a flight mid-stream
        // the page's address keeps the old id, while after a stale selection it has the new one)
        const streamAt = x => { const h = posHistory.get(x) || []; let t = 0; for (let i = h.length - 1; i >= 0; i--) if (!h[i].panel) { t = h[i].at; break; } const sc = fr24Sched.get(x); return Math.max(t, (sc && sc.at) || 0); };
        const sameAcNewer = u != null && u !== id && hexOfId(u) === shown0 && hx0 === shown0 && streamAt(u) > streamAt(id);
        const redrawing = shown0 === panel.__tlPrevHex && now() - (panel.__tlSwitchAt || 0) < 1500;
        if (shown0 && ((hx0 && hx0 !== shown0) || sameAcNewer) && !redrawing) {
          let alt = u != null && u !== id && (!hexOfId(u) || hexOfId(u) === shown0) ? u : null;
          if (alt == null) for (const [k, h] of idHex) if (h === shown0 && !live.has(k)) alt = k;
          if (alt != null) { panel.__tlMap = { cur: id, id: alt }; id = alt; }
        }
      } }
    // A new flight selected: FR24 asks for its data first and redraws the panel ~80 ms later, so for a moment the panel
    // still shows the previous aircraft. What it showed then is remembered, and never taken for the new flight.
    if (panel.__tlId !== id) { const prev = panel.__tlId != null ? (pubRecs.get(panel.__tlId) || live.get(panel.__tlId)) : null; panel.__tlPrevHex = prev && prev.hex ? prev.hex : ''; panel.__tlSwitchAt = now(); restore(panel); panel.__tlId = id; panel.__tlNA = false; panel.__tlNoAirline = !q(panel, SEL.airline); }
    if (id == null) return;
    shownId = id;
    if (!panel.__tlNA) { const dep = q(panel, SEL.depIata), arr = q(panel, SEL.arrIata); if (dep && arr && isNA(dep.dataset.tlVal ? dep.dataset.tlOrig : dep.textContent) && isNA(arr.dataset.tlVal ? arr.dataset.tlOrig : arr.textContent)) panel.__tlNA = true; }
    const rec = live.get(id) || (() => { const c = !fr24Named.has(id) && store.getId(id); if (c && c.hex) { live.set(id, c); pushToPage([c]); return c; } return null; })();
    // (a record let go - FR24 names the aircraft itself, or a match withdrawn: what was drawn from it goes)
    if (!rec && panel.__tlLive === id) restore(panel);
    panel.__tlLive = rec ? id : null;
    if (rec) { applyRecord(panel, rec); if (!routeState.get(id) && rec.hex) routeFor(rec).catch(e => log('route failed', e)); return; }
    let pub = pubRecs.get(id);
    if (!panelLooksBlocked(panel) || fr24Named.has(id)) {
      // an ordinary aircraft is recognised from the panel itself (its ICAO address is on screen) - no need to wait
      const shown = panelHex(panel);
      if (!pub) { const hx0 = shown; if (/^[0-9a-f]{6}$/.test(hx0) && hx0 !== panel.__tlPrevHex) pub = notePublicAircraft(id, hx0, clean(q(panel, SEL.registration) && q(panel, SEL.registration).textContent), clean(q(panel, SEL.model) && q(panel, SEL.model).textContent), clean(q(panel, SEL.callsign) && q(panel, SEL.callsign).textContent)); }
      // an ordinary flight: FR24 shows it, but padlocks these fields - filled from public ADS-B / registry data
      // (and nothing is filled into a panel that shows another aircraft than the record: it is still being redrawn)
      if (pub && shown && shown !== pub.hex) { restore(panel); return; }
      if (pub) {
        notePanelMsn(panel, pub); applyLocked(panel, pub, withStored(pub)); applyOwner(panel, withStored(pub));
        // FR24 had only airport-data pictures of it: JetPhotos / Planespotters ones in their place, once fetched
        if (pub.adPhotos) applyPhoto(panel, withStored(pub));
        // no destination from FR24 (N/A): the reasoned one - FR24's own frame says so first, its panel otherwise
        if (!schedOf(pub.id)) {
          const cellOf = e => e ? clean(e.dataset.tlVal ? e.dataset.tlOrig : textOf(e)).replace(/\?$/, '') : '';
          const arrC = cellOf(q(panel, SEL.arrIata)), depC = cellOf(q(panel, SEL.depIata)), inj = pub.injected || [];
          const fr24Own = c => c && !isNA(c) && !inj.includes(c);
          // FR24 draws a newly opened panel with both airports "N/A" and fills them in ~10 ms later (seen live): an N/A
          // counts once it has stood for 1.5 s, and an empty cell is still loading - so a flight FR24 has a route for
          // (RYR86GY Edinburgh -> Dublin, EXS66ED Fuerteventura -> Manchester) is never taken for one without
          const naNow = (arrC && isNA(arrC)) || (depC && isNA(depC));
          if (!pub.naDest) {
            if (!naNow) pub.naSince = 0;
            else if (!pub.naSince) { pub.naSince = now(); setTimeout(syncPanelSoon, 1600); }
            else if (now() - pub.naSince >= 1500) { pub.naDest = true; startPubRoute(pub); }
          } else if (fr24Own(arrC) && fr24Own(depC)) {
            // FR24's panel shows a route of its own (its frame not seen here): ours goes
            pub.naDest = false; if (pub.route) { pub.route = null; const st0 = routeState.get(pub.id); if (st0) st0.route = null; postToPage('route', { id: pub.id, route: null }); pubForget(pub.id); }
            restore(panel);
          }
        }
        if (pubRouted(pub.id)) { notePanelPos(panel, pub.id); applyRoute(panel, pub); renderPubStrip(panel, pub); return; }
        const s0 = schedOf(pub.id); if (s0 && s0.d && s0.o) fr24RouteBack(panel, s0);
        const na = e => e && isNA(e.dataset.tlVal ? e.dataset.tlOrig : textOf(e));
        if (na(q(panel, SEL.arrIata)) || na(q(panel, SEL.depIata))) {
          const s = schedOf(pub.id), hx = store.getHex(pub.hex) || {};
          const why = s && s.d && s.o ? '' : noDestCraft(pub.type || hx.type, hx.cat) ? '' : 'waiting for FR24\'s flight data';
          if (why) { const el = strip(panel); el.dataset.state = 'pending'; const html = rowHtml('pin', gridHtml([cellHtml('Destination' + tagHtml('Predicted', 'pred'), `<span class="tl-muted">${esc(why)}…</span>`, '', true)]) + `<div class="tl-links"><span class="tl-muted">v${VERSION}</span></div>${bridgeWarnHtml()}`); if (el.__tlHtml !== html) { el.innerHTML = html; el.__tlHtml = html; } return; }
        }
      } else if ((e => e && isNA(e.dataset.tlVal ? e.dataset.tlOrig : textOf(e)))(q(panel, SEL.arrIata))) {
        // no record of this flight yet (its identity comes with FR24's first data)
        const el = strip(panel); el.dataset.state = 'pending';
        const html = rowHtml('pin', gridHtml([cellHtml('Destination' + tagHtml('Predicted', 'pred'), `<span class="tl-muted">waiting for the aircraft's identity${shown ? '' : ' (no ICAO address on screen)'}…</span>`, '', true)]) + `<div class="tl-links"><span class="tl-muted">v${VERSION}</span></div>`);
        if (el.__tlHtml !== html) { el.innerHTML = html; el.__tlHtml = html; }
        return;
      }
      panel.querySelectorAll('.tl-strip').forEach(e => e.remove());
      return;
    }
    if (!pending.has(id)) { const snap = panelSnapshot(panel, id); if (snap) pending.set(id, snap); }
    const a = attemptsFor(id);
    if (a && a.n >= MAX_TARGET_ATTEMPTS) { renderStrip(panel, 'failed', null, 'No public ADS-B match found for this aircraft' + (a.said ? ` (${a.said})` : ' (no aggregator coverage here?)') + '.'); return; }
    renderStrip(panel, 'pending', null, a && a.said ? a.said : '');
    if (pending.has(id)) resolveTargeted(id, 'panel').catch(e => log(e));
  }
