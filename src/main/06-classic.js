  // ---- (1.4.1) FR24's log pages as they were --------------------------------------------------------------------------
  // FR24's 19 November site draws an aircraft's log (/data/aircraft/<reg>) and a flight number's (/data/flights/<n>) as
  // pages of its new app (Data/AircraftRegistration, Data/FlightHistory). Every log page is drawn here again as it was:
  // FR24's own header on top (its new app's, the very one its old pages carried), the breadcrumbs, the grey title bar,
  // the aircraft's facts and pictures, the table of flights with KML / CSV / Play on each, and the playback panel over the
  // map - the old pages' own markup, ids and classes, under FR24's own stylesheets of those pages (still on its server,
  // loaded from there in the order its old pages loaded them; nothing of FR24's is copied here), from the very data
  // FR24's new page carries (read as the page opens). So all this script did on those pages is done again: the rows' "—"
  // filled, the ends FR24 guessed replaced by where the flight came down, a blocked aircraft's log rebuilt, the flights
  // before FR24's week under its own, the padlocked figures. FR24's new page stays in the document, all but its header
  // hidden. FR24's playback page of a flight (/data/playback/<id>) goes to its aircraft's page, where it plays, as it did.
  // In the app (1.4.2): its aircraft and flight number pages as well - the phone layout of them (06-phone) is made from the
  // old page's markup, and was gone with it: FR24's new pages shown there since its update. Its playback page stays FR24's
  // own, made for a phone - every Play in the app goes there. The switch "Old-style log pages" turns it all off.
  const CL_PATH = /^\/data\/(aircraft|flights)\/([^/?#]+)\/?$/i;
  const CL_PB_PATH = /^\/data\/playback\/([0-9a-f]{1,16})\/?$/i;
  const clInApp = () => typeof TL_APP === 'object' && !!TL_APP;
  const classicOn = () => opt.on && opt.classic !== false;
  const CL_FR = 'https://www.flightradar24.com';
  // (FR24's old data pages' stylesheets, in the order those pages had them - '' is where their own inline rule stood)
  const CL_CSS = kind => [`${CL_FR}/static/css/jquery.ui.slider.css`, `${CL_FR}/static/css/nouislider.css`,
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css', 'https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.3.7/css/bootstrap.min.css',
    `${CL_FR}/static/css/screen_new.css`, `${CL_FR}/static/css/timeout_modal.css`, `${CL_FR}/static/css/important-banner.css`, `${CL_FR}/static/css/ccpa.css`,
    `${CL_FR}/static/css/pages/nav-top.css`, `${CL_FR}/static/css/pages/view-menu.css`, `${CL_FR}/static/css/fr-components.css`,
    'https://cdnjs.cloudflare.com/ajax/libs/toastr.js/2.1.4/toastr.min.css', `${CL_FR}/static/css/pages/data/${kind === 'flights' ? 'flights.flight' : 'aircraft.aircraft'}.css`,
    '', `${CL_FR}/static/bundle/main.a2cc58f65e7b7a947193.css`];
  const CL_HTML_RULE = 'html{font-size:16px;overflow-y:initial!important;padding-right:0!important}';
  // (what FR24's old page script did that its stylesheets cannot: its header alone shown of FR24's new page, as its old
  // pages showed it (fixed, 3.25rem, #222121); the map drawn here; the toolbar's icons and the settings' menu)
  const CL_STYLE = `
#app{position:fixed!important;top:0!important;left:0!important;right:0!important;height:3.25rem!important;min-height:0!important;z-index:40;background-color:#222121}
#app>div{height:3.25rem!important;min-height:0!important}#app>div>div{overflow:visible!important}#app main{display:none!important}
#content[data-tl-classic]{visibility:visible}#content[data-tl-classic].tl-cl-wait{visibility:hidden}
#cnt-data-map{cursor:url("https://maps.gstatic.com/mapfiles/openhand_8_8.cur"),grab;touch-action:none;user-select:none}
#cnt-data-map.tl-cl-drag{cursor:url("https://maps.gstatic.com/mapfiles/closedhand_8_8.cur"),grabbing}
#cnt-data-map .tl-cl-tiles,#cnt-data-map .tl-cl-over{position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden}
#cnt-data-map .tl-cl-tiles img{position:absolute;width:256px;height:256px;max-width:none;border:0;padding:0;margin:0;user-select:none;-webkit-user-drag:none}
#cnt-data-map .tl-cl-over{pointer-events:none;z-index:2}
#cnt-data-map .tl-cl-attr{position:absolute;right:0;bottom:0;z-index:3;background:rgba(245,245,245,.7);color:#444;font:10px Roboto,Arial,sans-serif;line-height:14px;padding:0 6px;white-space:nowrap}
#fr24_ViewsToolbar #fr24_SettingsDropdown{display:none}#fr24_ViewsToolbar #fr24_SettingsMenu.open #fr24_SettingsDropdown{display:block}
#fr24_mapType .dropdown-menu{display:none}#fr24_mapType.open .dropdown-menu{display:block}
#cnt-chart svg{display:block;width:100%;height:100%}
#tl-cl-sprite{position:absolute;width:0;height:0;overflow:hidden}`;
  // (the icons the old pages drew from their own picture set - not served any more: drawn here, plain shapes of the same
  // size in the same places; FR24's own logo taken from its header on this page)
  const CL_SPRITE = '<svg id="tl-cl-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    + '<symbol id="icon-fr24-lock" viewBox="0 0 24 24"><path d="M6 11V8a6 6 0 0 1 12 0v3h-2.6V8a3.4 3.4 0 0 0-6.8 0v3z"/><rect x="4" y="11" width="16" height="12" rx="2"/></symbol>'
    + '<symbol id="icon-arrow-origin-dest" viewBox="0 0 95 26"><rect x="0" y="11" width="4" height="4"/><rect x="7" y="11" width="4" height="4"/><rect x="14" y="11" width="4" height="4"/><rect x="21" y="11" width="4" height="4"/><rect x="28" y="11" width="4" height="4"/><rect x="35" y="11.5" width="57" height="3"/><path d="M79.5 4.5 95 13l-15.5 8.5-1.6-2.6L89.4 13 77.9 7.1z"/></symbol>'
    + '<symbol id="icon-fr24-follow" viewBox="0 0 16 16"><path d="M1.5 1.5l4 4M14.5 1.5l-4 4M1.5 14.5l4-4M14.5 14.5l-4-4" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M6.8 6.8H2.9l3.9-3.9zM9.2 6.8h3.9L9.2 2.9zM6.8 9.2H2.9l3.9 3.9zM9.2 9.2h3.9l-3.9 3.9z"/></symbol>'
    + '<symbol id="icon-fr24-route" viewBox="0 0 16 16"><circle cx="2.6" cy="13.4" r="2.4"/><circle cx="13.4" cy="2.6" r="2.4"/><path d="M3.6 11.4c1-3.6 3.6-4 5.6-4.6s2.4-1.6 2.9-2.6" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="2 1.5"/></symbol>'
    + '<symbol id="icon-fr24-close" viewBox="0 0 20 20"><path d="M3.4 2 10 8.6 16.6 2 18 3.4 11.4 10 18 16.6 16.6 18 10 11.4 3.4 18 2 16.6 8.6 10 2 3.4z"/></symbol>'
    + '<symbol id="icon-fr24-gear" viewBox="-8 -8 40 40"><path d="M10.3 1h3.4l.5 3a8 8 0 0 1 2 .9l2.5-1.8 2.4 2.4-1.8 2.5c.4.6.7 1.3.9 2l3 .5v3.4l-3 .5a8 8 0 0 1-.9 2l1.8 2.5-2.4 2.4-2.5-1.8a8 8 0 0 1-2 .9l-.5 3h-3.4l-.5-3a8 8 0 0 1-2-.9l-2.5 1.8-2.4-2.4 1.8-2.5a8 8 0 0 1-.9-2l-3-.5v-3.4l3-.5c.2-.7.5-1.4.9-2L3.4 5.5l2.4-2.4 2.5 1.8c.6-.4 1.3-.7 2-.9zM12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z"/></symbol>'
    + '<symbol id="icon-fr24-fullscreen" viewBox="-1 -1 26 26"><path d="M2 2h8v2.5H4.5V10H2zm12 0h8v8h-2.5V4.5H14zM2 14h2.5v5.5H10V22H2zm17.5 0H22v8h-8v-2.5h5.5z"/></symbol>'
    + '<symbol id="icon-fr24-plus" viewBox="0 0 24 24"><path d="M10.6 3h2.8v7.6H21v2.8h-7.6V21h-2.8v-7.6H3v-2.8h7.6z"/></symbol>'
    + '<symbol id="icon-fr24-minus" viewBox="0 0 24 24"><path d="M3 10.6h18v2.8H3z"/></symbol>'
    + '</svg>';
  const clUse = (id, cls) => `<svg${cls ? ` class="${cls}"` : ''}><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#${id}"></use></svg>`;

  // (an airport's time and the offset of its zone at a moment: its own zone name, as FR24's page data gives it)
  const clFmts = new Map();
  function clFmt(tz, o) { const k = tz + JSON.stringify(o); let f = clFmts.get(k); if (!f) { try { f = new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz || 'UTC' }, o)); } catch (e) { f = new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC' }, o)); } clFmts.set(k, f); } return f; }
  const clTime = (ts, tz) => ts > 0 ? clFmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts * 1000)) : '';
  const clDate = (ts, tz) => ts > 0 ? clFmt(tz, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(ts * 1000)).replace(/Sept/, 'Sep') : '';
  function clOffset(ts, tz) {
    if (!(ts > 0)) return 0;
    try { const p = clFmt(tz, { timeZoneName: 'longOffset' }).formatToParts(new Date(ts * 1000)).find(x => x.type === 'timeZoneName'); const m = /GMT([+-])(\d\d):?(\d\d)?/.exec((p && p.value) || ''); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3] || 0) * 60) : 0; } catch (e) { return 0; }
  }
  const clDur = s => s > 0 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}` : '—';
  const clHm = s => fin(s) ? `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 3600)}:${String(Math.floor(Math.abs(s) % 3600 / 60)).padStart(2, '0')}` : '-';
  const clCap = s => String(s || '').replace(/^./, c => c.toUpperCase());
  // (a row's status as FR24's old pages wrote it: "Landed 16:04", "Estimated 21:19", "Estimated departure 22:12", ...)
  function clStatus(f, tzO, tzD) {
    const n = String((f.status && f.status.name) || '').toLowerCase(), col = (f.status && f.status.color) || 'gray', ata = f.estimatedArrival || 0, etd = f.estimatedDeparture || 0;
    if (n === 'landed') return { text: ata ? 'Landed ' + clTime(ata, tzD) : 'Landed', prefix: 'Landed ', ts: ata, tz: tzD, color: col === 'gray' ? 'green' : col };
    if (n === 'diverted') { const dv = f.divertedTo; return { text: 'Diverted' + (dv ? ' to ' + (dv.iata || dv.icao || '') : ''), color: 'red' }; }
    if (/^cancel/.test(n)) return { text: 'Canceled', color: 'red' };
    if (f.live || n === 'live' || n === 'airborne' || n === 'departed' || (n === 'estimated' && f.actualDeparture)) return ata ? { text: 'Estimated ' + clTime(ata, tzD), prefix: 'Estimated ', ts: ata, tz: tzD, color: col === 'gray' ? 'green' : col } : { text: 'Live', color: 'green' };
    if ((n === 'estimated' || n === 'delayed') && etd) return { text: 'Estimated departure  ' + clTime(etd, tzO), prefix: 'Estimated departure  ', ts: etd, tz: tzO, color: n === 'delayed' ? 'red' : 'yellow', pending: true };
    return { text: clCap(n || 'unknown'), color: col, pending: !n || n === 'scheduled' || n === 'unknown' };
  }
  const clApCode = a => String((a && (a.iata || a.icao)) || '');
  const clApCell = (a, cls) => a && clApCode(a) ? ` ${esc(a.city || a.name || '')} <a href="${CL_FR}/data/airports/${esc(clApCode(a).toLowerCase())}" target="_self" class="${cls}">(${esc(clApCode(a))})</a>` : a && (a.city || a.name) ? ` ${esc(a.city || a.name)} ` : ' — ';
  const clApMob = a => a && clApCode(a) ? `  ${esc(a.city || a.name || '')} <a href="${CL_FR}/data/airports/${esc(clApCode(a).toLowerCase())}" target="_self" class="fbold">(${esc(clApCode(a))}) </a>  ` : clApCell(a, 'fbold');
  const clApTitle = a => a ? ` title="${esc((a.name || '') + (a.countryName ? ', ' + a.countryName : ''))}"` : '';
  const clFnLink = fn => `   <a href="${CL_FR}/data/flights/${esc(fn.toLowerCase())}" target="_self" class="fbold">${esc(fn)}</a>   `;
  // One of FR24's flights as a row of its old table - its own markup, so every row this script reads or fills is as it was
  function clRowHtml(f, kind, reg) {
    const o = f.origin || null, d = f.destination || null, tzO = (o && o.timezone) || (d && d.timezone) || 'UTC', tzD = (d && d.timezone) || tzO;
    const std = f.scheduledDeparture || 0, atd = f.actualDeparture || 0, sta = f.scheduledArrival || 0, t0 = std || atd || f.estimatedDeparture || 0;
    const st = clStatus(f, tzO, tzD), oO = clOffset(t0, tzO), oD = clOffset(sta || f.estimatedArrival || t0, tzD);
    const fid = /^[0-9a-f]{1,12}$/i.test(f.flightId || '') ? String(f.flightId).toLowerCase() : '';
    const fn = clean(f.flightNumber || '').toUpperCase(), cs = clean(f.callsign || '').toUpperCase(), ac = f.aircraft || {}, acReg = clean(ac.registration || '').toUpperCase();
    const flightDesk = kind === 'flights'
      ? (acReg ? ` ${esc(ac.type || '')} <a href="${CL_FR}/data/aircraft/${esc(acReg.toLowerCase())}" target="_self" class="fbold fs-10">(${esc(acReg)})</a> ` : ` ${esc(ac.type || '—')} `)
      : (fn ? clFnLink(fn) : cs ? ` (${esc(cs)}) ` : ' — ');
    const flightMob = kind === 'flights' ? (acReg ? ` <a href="${CL_FR}/data/aircraft/${esc(acReg.toLowerCase())}" target="_self" class="fbold">${esc(acReg)}</a> ` : ` ${esc(ac.type || '—')} `) : flightDesk;
    const td = (ts, off) => `data-timestamp="${ts || ''}" data-offset="${ts ? off : ''}"`;
    const pbReg = (kind === 'flights' ? acReg : reg).toLowerCase(), here = `${CL_FR}${location.pathname}`;
    const exp = k => `<a class="btn btn-sm btn-white btn-table-action fs-10 ${k.toLowerCase()}Button notranslate download${k === 'KML' ? 'Kml' : 'Csv'} featureInfo-57 tl-export" href="${esc(here)}#" data-flight="${fid}" data-tl-export="${k}" title="This flight's track as a ${k} file, from public ADS-B data (adsb.lol / airplanes.live, ODbL) - LADD unblocker"> ${k} </a>`;
    const live = !!f.live;
    let btns = '';
    if (fid) btns = `  ${exp('KML')} ${exp('CSV')}    <a class="btn btn-sm btn-playback btn-table-action text-white bkg-blue fs-10 " data-flight-duration="${live ? '' : f.flightTimeSeconds || ''}" data-flight-hex="${fid}" data-live="${live ? 'true' : 'false'}" data-timestamp="${t0}" href="${pbReg ? `${CL_FR}/data/aircraft/${esc(encodeURIComponent(pbReg))}#${fid}` : `${esc(here)}#${fid}`}" id="btn-playback-${fid}" title="Show playback of flight"><i class="fa fa-${live ? 'plane' : 'play'} text-white fs-10"></i> &nbsp;${live ? 'Live' : 'Play'} </a>  `;
    // (a flight not flown yet: the old pages' Share of it - a link to its flight number's page, copied)
    else if (st.pending && /^\d{1,14}$/.test(String(f.id || ''))) btns = `    <a class="btn btn-sm btn-share-schedule btn-table-action text-white bkg-blue fs-10" data-schedule-id="${esc(f.id)}" data-flight-number="${esc((fn || cs).toLowerCase())}" href="${esc(here)}#" id="btn-share-schedule-${esc(f.id)}" title="Copy share link for this scheduled flight"><i class="fa fa-share-square-o text-white fs-10"></i> &nbsp;Share </a>  `;
    const stTd = st.ts ? `data-prefix="${esc(st.prefix)}" data-timestamp="${st.ts}" data-offset="${clOffset(st.ts, st.tz)}"` : '';
    return `<tr class="${live ? 'live ' : ' '}data-row" data-timestamp="${t0}"><td class="visible-xs visible-sm"><div class="row table-row-responsive"><div class="col-xs-3"><div class="row"><i class="fa fa-plane"></i> ${flightMob}</div><div class="row" data-offset="${oO}" data-timestamp="${t0}" data-time-format="DD MMM YYYY" data-prefix="&lt;i class=&quot;fa fa-calendar&quot;&gt;&lt;/i&gt; "><i class="fa fa-calendar"></i> ${esc(clDate(t0, tzO))}</div><div class="row"><i class="fa fa-clock-o"></i> ${f.flightTimeSeconds > 0 ? clDur(f.flightTimeSeconds) : '-'} </div><div class="row" ${stTd}>${esc(st.text)}</div></div><div class="col-xs-1 col-state"><div class="state-block ${esc(st.color)}"></div></div><div class="col-xs-8"><div class="row"><div class="col-xs-4"><p><label>STD</label> <span class="details" ${td(std, oO)}>${std ? clTime(std, tzO) : '  —  '}</span></p></div><div class="col-xs-4"><p><label>ATD</label> <span class="details" ${td(atd, oO)}>${atd ? clTime(atd, tzO) : '  —  '}</span></p></div><div class="col-xs-4"><p><label>STA</label>  <span class="details" ${td(sta, oD)}>${sta ? clTime(sta, tzD) : '  —  '}</span>  </p></div></div><p><label>FROM</label> <span class="details">${clApMob(o)}</span></p><p><label>TO</label> <span class="details">${clApMob(d)}</span></p></div></div></td>`
      + `<td class="w40 hidden-xs hidden-sm">&nbsp;</td><td class="hidden-xs hidden-sm" data-offset="${oO}" data-timestamp="${t0}" data-time-format="DD MMM YYYY">${esc(clDate(t0, tzO))}</td>  `
      + `<td${clApTitle(o)} class="text-center-sm hidden-xs hidden-sm">${clApCell(o, 'fs-10 fbold')}</td>   <td${clApTitle(d)} class="text-center-sm hidden-xs hidden-sm">${clApCell(d, 'fs-10 fbold')}</td>  `
      + `<td class="hidden-xs hidden-sm">${flightDesk}</td><td class="hidden-xs hidden-sm">${clDur(f.flightTimeSeconds)}</td><td class="hidden-xs hidden-sm" ${td(std, oO)}>${std ? clTime(std, tzO) : '  —  '}</td><td class="hidden-xs hidden-sm" ${td(atd, oO)}>${atd ? clTime(atd, tzO) : '  —  '}</td>  <td class="hidden-xs hidden-sm" ${td(sta, oD)}>${sta ? clTime(sta, tzD) : '  —  '}</td>  `
      + `<td class="hidden-xs hidden-sm"><div class="state-block ${esc(st.color)}"></div></td><td class="hidden-xs hidden-sm" ${stTd}>${esc(st.text)}</td><td class="text-right hidden-xs hidden-sm">${btns}</td><td class="w40 hidden-xs hidden-sm">&nbsp;</td></tr>`;
  }
  const clHead = kind => `<thead><tr><th scope="col" class="visible-xs visible-sm" colspan="20">FLIGHTS HISTORY</th><th scope="col" class="w40 hidden-xs hidden-sm">&nbsp;</th><th scope="col" class="hidden-xs hidden-sm">DATE</th><th scope="col" class="hidden-xs hidden-sm">FROM</th><th scope="col" class="hidden-xs hidden-sm">TO</th><th scope="col" class="hidden-xs hidden-sm">${kind === 'flights' ? 'AIRCRAFT' : 'FLIGHT'}</th><th scope="col" class="hidden-xs hidden-sm">FLIGHT TIME</th><th scope="col" class="hidden-xs hidden-sm" title="Scheduled Time Departure">STD</th><th scope="col" class="hidden-xs hidden-sm" title="Actual Time Departure">ATD</th><th scope="col" class="hidden-xs hidden-sm" title="Scheduled Time Arrival">STA</th><th scope="col" class="hidden-xs hidden-sm"></th><th scope="col" class="hidden-xs hidden-sm">STATUS</th><th class="text-right hidden-xs hidden-sm"></th><th scope="col" class="w40 hidden-xs hidden-sm">&nbsp;</th></tr></thead>`;
  const clLock = n => `<a class="disabled premium-content featureInfo-${n}" data-tooltip-maxwidth="250px" data-tooltip-value="" href="${CL_FR}/premium#featureInfo${n}" target="premium">${clUse('icon-fr24-lock', 'icon-fr24-lock')} </a>`;
  const clInfoRow = (label, html, id) => `<div class="row p-l-20 p-t-5"><label>${label}</label> <span class="details"${id ? ` id="${id}"` : ''}>${html}</span></div>`;
  const clAlLink = al => { if (!al || !al.name) return ''; const u = String(al.url || ''); const href = /^\/data\/airlines\//.test(u) ? CL_FR + u : u ? `${CL_FR}/data/airlines/${u.replace(/^\/+/, '')}` : ''; return href ? `<a href="${esc(href)}">${esc(al.name)}</a>` : esc(al.name); };
  const clCodes = al => al ? [al.iata, al.icao].filter(Boolean).join(' / ') : '';
  function clPhotosHtml(photos, reg, model, alName) {
    const alt = `A picture of ${String(reg || '').replace(/-/g, '')} - ${String(model || '').replace(/-/g, '')}${alName ? ' - ' + alName : ''}`;
    // (1.4.3: in the app, a third - FR24's own pages for a phone show three, one after another: the phone layout's
    // (06-phone) pictures; the old page's own two side by side, the third not shown there)
    return (photos || []).slice(0, clInApp() ? 3 : 2).map((p, i) => `<div class="col-xs-6 n-p cnt-picture${i > 1 ? ' tl-pic3" style="display:none' : ''}"><span class="label">© ${esc(p.copyright || '')} | Jetphotos</span><a href="${esc(p.link || p.url || '#')}" target="_blank"><img alt="${esc(alt)}" class="img-responsive" src="${esc(p.url || '')}" title="Open this aircraft picture in new window"></a></div>`).join('');
  }
  // (the old playback panel - its ids, labels and rows as FR24's: this script's figures go where they went; the
  // padlocked ones as the free pages had them, filled at once from public ADS-B - fillPlaybackData)
  const CL_PANEL = `<div class="row hidden" id="cnt-playback"> <div><div class="row"><div class="col-sm-9 playback-header"><div class="row"><div class="col-xs-12"><h1 id="txt-playback-header">Playback of flight</h1></div></div><div class="row playback-player"><div class="col-xs-3"><div class="row p-t-20"><div class="col-xs-12"><label>GREAT CIRCLE DISTANCE</label> <span class="text-open-1" id="txt-great-circle-distance">-</span></div></div><div class="row p-t-10"><div class="col-xs-12"><label>AVERAGE FLIGHT TIME</label> <span class="text-open-1" id="txt-flight-time-average">-</span></div></div><div class="row p-t-10"><div class="col-xs-12"><label>ACTUAL FLIGHT TIME</label> <span class="text-open-1" id="txt-flight-time-actual">-</span></div></div><div class="row p-t-10"><div class="col-xs-12"><label>AVERAGE ARRIVAL DELAY</label> <span class="text-open-1" id="txt-flight-delay-average">-</span></div></div><div class="row p-t-10"><div class="col-xs-12"><svg class="fr-logo-payoff"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#fr-logo-payoff"></use></svg></div></div></div><div class="col-xs-9 playback-control"><div class="row airport-container p-t-20 pos-rel"><div class="airport-block n-p"><label>FROM</label> <label class="airport-city" id="txt-airport-origin">-</label></div><div class="airport-block airport-arrow text-center"><svg id="icon-arrow"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#icon-arrow-origin-dest"></use></svg></div><div class="airport-block n-p m-r-35"><label>TO</label> <label class="airport-city" id="txt-airport-dest">-</label></div></div><div class="row pos-rel"><button id="btn-control-playback" title="Start playback"></button><div id="cnt-fight-progress-slider"><div class="track" title="Click to change flight playback progress"></div><div class="progress" style="width: 0px;"></div><div class="thumb" title="Drag to change flight playback progress" data-max="0" data-value="0" style="left: 0px;"></div></div></div><div class="row"><div class="col-xs-3" style="padding-left:0"><div class="row"><label>TIME</label> <span class="text-open-2" id="txt-track-timestamp" data-suffix=" <small>UTC</small>" data-timestamp="">-</span></div><div class="row"><div id="btn-group-features" class="btn-group" role="group" aria-label="..."><button id="btn-toggle-follow" type="button" class="btn" title="Follow aircraft during playback">${clUse('icon-fr24-follow', 'icon icon-fr24-follow')}</button> <button id="btn-toggle-route" type="button" class="btn" title="Show great circle route">${clUse('icon-fr24-route', 'icon icon-fr24-route')}</button> <button id="btn-toggle-chart" type="button" class="btn" title="Show flight data chart"><i class="fa fa-area-chart"></i></button></div></div></div><div class="col-xs-3" style="padding-left:0"><div class="row"><label class="text-uppercase">Barometric altitude</label> <span class="text-open-2" id="txt-altitude" data-unit="unit_alt">-</span></div><div class="row"><label>GPS ALTITUDE</label> ${clLock(161)}</div></div><div class="col-xs-2" style="padding-left:0"><div class="row"><label>GROUND SPEED</label> <span class="text-open-2" id="txt-speed" data-unit="unit_speed">-</span></div><div class="row"><label>TRUE AIRSPEED</label> ${clLock(162)}</div></div><div class="col-xs-3" style="padding-left:0"><div class="row"><label>VERTICAL SPEED</label> ${clLock(163)}</div><div class="row"><label>INDICATED AIRSPEED</label> ${clLock(164)}</div></div><div class="col-xs-1" style="padding-left:0"><div class="row"><label>TRACK</label> <span class="text-open-2" id="txt-track-heading">-</span></div><div class="row"><label>SQUAWK</label> ${clLock(165)}</div></div></div></div></div></div><div class="col-sm-3 playback-image n-p"><div class="row pos-rel"><div class="pos-rel"><span class="label" id="txt-aircraft-image-copyright"></span> <a id="txt-aircraft-image-url" target="_blank"><img alt="" id="img-aircraft-img" class="img-responsive"></a></div><button class="pos-abs" id="btn-playback-control-close" title="Close this panel">${clUse('icon-fr24-close', 'icon-fr24-close')}</button></div><div class="row"><div class="col-xs-12 p-t-10"><label>AIRCRAFT</label> <span class="text-open-1" id="txt-aircraft-model">-</span></div></div><div class="row"><div class="col-xs-12 p-t-10"><label>REGISTRATION</label> <span class="text-open-1" id="txt-aircraft-reg">-</span></div></div><div class="row"><div class="col-xs-12" style="padding-top:8px"><label>SERIAL NUMBER (MSN)</label> <span class="text-open-1" id="txt-aircraft-serial">-</span></div></div></div></div><div id="cnt-chart" class="row hidden"></div></div> </div>`;
  // (the map's toolbar on the page's right edge, as the old pages had it: settings - the map's style -, full screen, zoom)
  // (1.4.3: and the styles FR24's main map has since - any of them the main map's own)
  const CL_MAPTYPES = [['terrain', 'Terrain'], ['roadmap', 'Roadmap'], ['simple_style', 'Greyscale'], ['radar_style2', 'Radar (dark)'], ['radar_style', 'Radar (blue)'], ['aubergine_style', 'Aubergine'], ['black_white', 'Black/White'], ['satellite', 'Satellite'], ['hybrid', 'Hybrid']];
  const CL_TOOLBAR = () => `<div class="bootstrap map-components-wrapper"><div id="fr24_ViewsToolbar" class="smooth-tab attach-right dark hidden-in-3d"><ul><li id="fr24_SettingsMenu" class="dropdown map-side" data-content="Settings"><a data-toggle="dropdown" class="dropdown-toggle">${clUse('icon-fr24-gear')}</a><ul id="fr24_SettingsDropdown" class="dropdown-menu settings noclose"><li><ul class="smooth-tab-group"><li class="active"><a class="smooth-tab attach-bottom" data-toggle="tab" data-target="#mapsettings"><div class="tab-sweep toleft"></div><div class="tab-content">Map</div><div class="tab-sweep toright"></div></a></li></ul></li><li><div class="tab-content"><div id="mapsettings" class="tab-pane active clearfix"><div class="scroll-wrap"><h5 class="pull-left short-label">Map style</h5><div id="fr24_mapType" class="btn-group pull-right"><button type="button" class="btn btn-default dropdown-toggle pull-right" data-toggle="dropdown" value="${esc(clMapType())}" data-source="map_type">${esc((CL_MAPTYPES.find(x => x[0] === clMapType()) || CL_MAPTYPES[CL_MAPTYPES.length - 1])[1])} <span class="caret"></span></button><ul class="dropdown-menu" role="menu">${CL_MAPTYPES.map(([v, t]) => `<li><a data-value="${v}">${esc(t)}</a></li>`).join('')}</ul></div><div class="clearfix"></div></div></div></div></li></ul></li><li id="fr24_Fullscreen" class="dropdown map-side" data-content="Fullscreen"><a data-toggle="dropdown" class="dropdown-toggle" href="javascript: void(0);">${clUse('icon-fr24-fullscreen', 'icon-fr24-fullscreen')}</a></li><li id="fr24_ZoomIn" class="dropdown" data-content="ZoomIn"><a class="dropdown-toggle">${clUse('icon-fr24-plus', 'nav-icon plus')}</a></li><li id="fr24_ZoomOut" class="dropdown" data-content="ZoomOut"><a class="dropdown-toggle">${clUse('icon-fr24-minus', 'nav-icon minus')}</a></li></ul></div></div>`;
  const CL_FOOT = () => `<footer class="pb-4"><p>© ${new Date().getUTCFullYear()} Flightradar24 AB</p><ul><li><a href="${CL_FR}/contact-us">Contact us</a></li><li><a href="${CL_FR}/faq">FAQ</a></li><li><a href="${CL_FR}/careers">Careers</a></li><li><a href="${CL_FR}/privacy-policy">Privacy</a></li><li><a href="${CL_FR}/terms-of-service">Terms</a></li></ul></footer>`;
  const clCrumbs = list => `<div class="mx-4"><nav class="breadcrumbs pt-2 border-b border-gray-700 border-solid" data-component="breadcrumbs"><ol class="flex flex-wrap justify-start m-auto text-sm list-none breadcrumbs__list" data-testid="breadcrumbs" itemscope itemtype="https://schema.org/BreadcrumbList">${list.map(([name, href], i) => (i ? '<span class="px-2 text-gray-1300">&gt;</span>' : '') + `<li class="pb-2 font-base font-regular" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">${href ? `<a class="breadcrumbs__list-item breadcrumbs__list-item--url text-blue-500 hover:text-blue-500" itemprop="item" itemtype="https://schema.org/WebPage" href="${esc(href)}"><div class="flex breadcrumbs__list-item-name" itemprop="name">${esc(name)}</div></a>` : `<div class="text-gray-1300 font-semibold"><div class="breadcrumbs__list-item-name" itemprop="name">${esc(name)}</div></div>`}<meta itemprop="position" content="${i + 1}"></li>`).join('')}</ol></nav></div>`;

  let clPage = null;
  // (1.4.2) The page shown once, whole - its rows' airports, the aircraft's serial number, age and owner, its older flights and
  // their flight numbers all in it - not filled in before the eyes: held back until the aircraft's and the flight's own work
  // (06-acpage) has them, six seconds at most. Their slow asks begin as FR24's page data is read (clEarly)
  const CL_HOLD_MAX = 6000, clHolds = [];
  let clBootRes = null; const clBootP = new Promise(r => { clBootRes = r; });
  function clHold(p) { clHolds.push(Promise.resolve(p).then(() => null, () => null)); }
  function clHoldsIn() { if (clBootRes) { const r = clBootRes; clBootRes = null; r(); } }
  // (a deferred, for a part that is ready later)
  const clDefer = () => { let res = null; const p = new Promise(r => { res = r; }); return { p, done: () => { if (res) { const r = res; res = null; r(); } } }; };
  // (FR24's page data read: the airports' lists and the rows' track ends asked for at once - before the page is drawn)
  function clEarly(page, kind) {
    try {
      loadAirports().catch(() => null); loadOa().catch(() => null); loadSites().catch(() => null);
      const fl = Array.isArray(page.props && page.props.flights) ? page.props.flights : [];
      const items = fl.filter(f => /^[0-9a-f]{1,12}$/i.test(f.flightId || '')).map(f => ({ fid: String(f.flightId).toLowerCase(), t: f.scheduledDeparture || f.actualDeparture || 0 }));
      if (items.length) fr24EndsEarly(items);
      if (kind === 'aircraft') { const a = page.props.aircraft || {}, hex = clean(a.modeS || '').toLowerCase(), reg = clean(a.registration || '').toUpperCase(); if (/^[0-9a-f]{6}$/.test(hex)) identityEarly(hex, reg); }
    } catch (e) { log('classic early', e); }
  }
  // (FR24's page element, as soon as the browser has read it - before FR24's own script draws anything in it)
  function clAppEl() {
    const now0 = document.getElementById('app'); if (now0 && now0.getAttribute('data-page')) return Promise.resolve(now0);
    // (the page read already - a script started late: what it has)
    if (document.readyState !== 'loading') return Promise.resolve(now0 || null);
    return new Promise(res => {
      const done = el => { try { mo.disconnect(); } catch (e) { /* none */ } res(el || null); };
      const mo = new MutationObserver(() => { const el = document.getElementById('app'); if (el && el.getAttribute('data-page')) done(el); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', () => done(document.getElementById('app')), { once: true });
    });
  }
  // Before anything of FR24's is drawn: its page hidden (a blank moment, not the new page and then the old)
  // -> true when the old page is drawn (the aircraft page's and the flight page's own work then runs on it)
  async function classicBoot() {
    const pb = clInApp() ? null : CL_PB_PATH.exec(location.pathname), m = CL_PATH.exec(location.pathname);
    if ((!m && !pb) || !classicOn()) return false;
    const hide = document.createElement('style'); hide.id = 'tl-classic-hide'; hide.textContent = '#app{visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(hide);
    let page = null;
    try { const el = await clAppEl(); page = el ? JSON.parse(el.getAttribute('data-page') || 'null') : null; } catch (e) { page = null; }
    const comp = page && page.component;
    // (FR24's playback page of a flight: its aircraft's page, where it plays)
    if (pb) {
      const id = pb[1].toLowerCase(), p = (page && page.props) || {};
      let reg = clean((p.aircraft && p.aircraft.registration) || (p.flight && p.flight.aircraft && p.flight.aircraft.registration) || '');
      if (!reg) { const s = PB_SYN.exec(id); if (s) reg = clean((store.getHex(s[1]) || {}).reg || ''); }
      if (/Playback/i.test(comp || '') && reg && /^[A-Z0-9-]{2,10}$/i.test(reg)) { location.replace(`/data/aircraft/${encodeURIComponent(reg.toLowerCase())}#${id}`); return true; }
      hide.remove(); return false;
    }
    if (!page || !page.props || !/^Data\/(AircraftRegistration|FlightHistory)$/.test(comp || '')) { hide.remove(); return false; }
    clEarly(page, m[1].toLowerCase() === 'flights' ? 'flights' : 'aircraft');
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    try { clDraw(page, m[1].toLowerCase() === 'flights' ? 'flights' : 'aircraft'); } catch (e) { log('classic page', e); const c = document.querySelector('#content[data-tl-classic]'); if (c) c.remove(); hide.remove(); return false; }
    return true;
  }
  // The old pages' stylesheets, before FR24's own (FR24's header's, kept, come after them, as on its old pages)
  function clStyles(kind) {
    const head = document.head || document.documentElement, first = head.querySelector('link[rel~="stylesheet"], style');
    const add = el => { el.dataset.tlClassic = '1'; if (first && first.parentNode === head) head.insertBefore(el, first); else head.appendChild(el); return el; };
    const links = [];
    for (const href of CL_CSS(kind)) {
      if (!href) { const s = document.createElement('style'); s.textContent = CL_HTML_RULE; add(s); continue; }
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.type = 'text/css'; l.href = href; links.push(l); add(l);
    }
    const s = document.createElement('style'); s.id = 'tl-classic-style'; s.textContent = CL_STYLE; head.appendChild(s);
    // (the page shown once they are in - or after two and a half seconds, whatever has come)
    return Promise.race([Promise.all(links.map(l => new Promise(r => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); }))), sleep(2500)]);
  }
  // (FR24's own logo - its picture its header on this page shows - as the panel's logo: the old panel had it there)
  function clLogo() {
    if (document.getElementById('fr-logo-payoff')) return;
    const app = document.getElementById('app'), sp = document.getElementById('tl-cl-sprite'); if (!app || !sp) return;
    const img = [...app.querySelectorAll('img')].find(i => { const r = i.getBoundingClientRect(); return r.top < 52 && r.width > 80 && r.height > 15 && (i.currentSrc || i.src); });
    if (!img) return;
    const r = img.getBoundingClientRect(), w = Math.round(r.width), h = Math.round(r.height), NS = 'http://www.w3.org/2000/svg';
    const sym = document.createElementNS(NS, 'symbol'); sym.id = 'fr-logo-payoff'; sym.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const im = document.createElementNS(NS, 'image'); im.setAttribute('href', img.currentSrc || img.src); im.setAttribute('width', String(w)); im.setAttribute('height', String(h)); sym.appendChild(im);
    sp.appendChild(sym);
    for (const use of document.querySelectorAll('svg.fr-logo-payoff')) use.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  function clDraw(page, kind) {
    const p = page.props || {}; clPage = { kind, props: p, path: location.pathname };
    const ready = clStyles(kind);
    const body = document.body; body.id = 'data'; body.classList.add('fr-ui', 'desktop', 'staticPage', 'dataHasSettings', 'fr24-top-navigation');
    const flights = Array.isArray(p.flights) ? p.flights : [];
    const pathId = decodeURIComponent((CL_PATH.exec(location.pathname) || [])[2] || '');
    let head = '', crumbs = [];
    if (kind === 'aircraft') {
      const a = p.aircraft || {}, reg = clean(a.registration || pathId).toUpperCase(), al = p.airline || null, op = p.operator || null, w = p.withheld || {};
      clPage.reg = reg; clPage.hex = clean(a.modeS || '').toLowerCase(); clPage.model = clean(a.model || '');
      const alHtml = al && al.name ? clAlLink(al) : esc(a.owner || '-');
      const msn = a.msn && !w.msn ? esc(a.msn) : clLock(122), age = fin(a.age) && !w.age ? esc(a.age + (a.age === 1 ? ' year' : ' years')) : clLock(123);
      head = `<div class="row section-header"><div class="col-md-6 n-p"><div class="row"><div id="cnt-subpage-info" class="col-xs-12 p-l-20"><h1>Flight history for aircraft - ${esc(reg)}</h1></div></div><div id="cnt-aircraft-info" class="row"><div class="col-xs-5 n-p">${clInfoRow('AIRCRAFT', esc(a.model || a.typeCode || '-'))}${clInfoRow('AIRLINE', alHtml)}${clInfoRow('OPERATOR', esc((op && op.name) || '-'))}</div><div class="col-xs-7"><div class="row"><div class="col-sm-5 n-p">${clInfoRow('TYPE CODE', esc(a.typeCode || '-'))}${clInfoRow('Code', esc(clCodes(al) || '-'))}${clInfoRow('Code', esc(clCodes(op) || '-'))}</div><div class="col-sm-7 n-p">${clInfoRow('MODE S', esc(clean(a.modeS || '-').toUpperCase()), 'txt-mode-s')}${clInfoRow('SERIAL NUMBER (MSN)', msn)}${clInfoRow('AGE', age)}</div></div></div></div></div><div class="col-md-6 n-p"><div class="row">${clPhotosHtml(p.photos, reg, a.model, al && al.name)}</div></div></div>`;
      crumbs = [['Flight tracker map', `${CL_FR}/`], ['Aviation data', `${CL_FR}/data`], ['Aircraft', `${CL_FR}/data/aircraft`], [reg, '']];
    } else {
      const fn = clean(p.flightNumber || p.callsign || pathId).toUpperCase(), al = p.airline || null;
      clPage.fn = fn;
      // (the old flight pages' heading: "Flight history for BAE Systems Marine flight VSB96" - its airline's name where known)
      head = `<div class="row section-header"><div id="cnt-subpage-info" class="col-xs-12 h-60"><h1>Flight history for ${al && al.name ? esc(al.name) + ' flight ' : ''}${esc(fn)}</h1></div></div>`;
      crumbs = [['Flight tracker map', `${CL_FR}/`], ['Aviation data', `${CL_FR}/data`], ['Flights', `${CL_FR}/data/flights`], [fn, '']];
      clPage.about = Array.isArray(p.about) ? p.about : [];
    }
    const rows = flights.map(f => clRowHtml(f, kind, clPage.reg || '')).join('');
    // (FR24's own rows name each callsign's flight number - RYR77DU is FR431: the rows rebuilt here of the same callsign
    // show it at once, blue and linked, as FR24's own do - legRowHtml; 1.4.2: kept, and sent to the monitor - noteCsFn)
    for (const f of flights) noteCsFn(f.callsign, f.flightNumber, f.actualDeparture || f.scheduledDeparture);
    const table = `<table class="" data-text-loading="Please wait. Loading data..." id="tbl-datatable">${clHead(kind)}<tbody>${rows || '<tr><td colspan="20" class="text-center" style="padding:10px 0;font-weight:700">There is currently no data available for your request</td></tr>'}</tbody></table>`;
    // (a flight number FR24 has no flight of: its old page's words, the footer in them - the flight page's own table of
    // it, from public ADS-B and the monitor, takes their place - bootFlightPage)
    const tail = kind === 'flights' && !flights.length
      ? `<div class="row p-t-10 text-center" style="padding:10px 0;font-weight:700">There is currently no data available for your request ${CL_FOOT()}</div>`
      : `<div class="row">${table}${CL_FOOT()}</div>`;
    const spacer = document.createElement('div'); spacer.id = 'tl-cl-spacer'; spacer.style.cssText = 'width:100%;height:3.25rem';
    const wrap = document.createElement('div'); wrap.id = 'content'; wrap.className = `bootstrap data-${kind} tl-cl-wait`; wrap.dataset.tlClassic = '1';
    wrap.innerHTML = CL_TOOLBAR() + `<div class="tl-cl-scope">${clCrumbs(crumbs)}<section id="cnt-data-subpage"><section id="cnt-data-map" style="display:none"><div id="tl-cl-gmap" style="position:absolute;left:0;top:0;width:100%;height:100%;display:none"></div><div class="tl-cl-tiles"></div><svg class="tl-cl-over"></svg><div class="tl-cl-attr">Powered by Esri · Esri, Maxar, Earthstar Geographics, HERE, Garmin, USGS</div></section><section id="cnt-data-content">${head}${CL_PANEL}${tail}</section></section></div>`;
    const app = document.getElementById('app');
    if (app && app.parentNode === body) { app.after(spacer); spacer.after(wrap); } else { body.insertBefore(wrap, body.firstChild); body.insertBefore(spacer, wrap); }
    body.insertAdjacentHTML('beforeend', CL_SPRITE);
    // (FR24's notice that a row's flight is not on the page: the toast box its old pages had)
    if (!document.getElementById('toast-container')) { const t = document.createElement('div'); t.id = 'toast-container'; t.className = 'toast-top-right'; body.appendChild(t); }
    const hide = document.getElementById('tl-classic-hide'); if (hide) hide.remove();
    let shown = false; const reveal = () => { if (shown) return; shown = true; wrap.classList.remove('tl-cl-wait'); clLayout(); };
    Promise.race([ready.then(() => Promise.race([clBootP, sleep(3000)])).then(() => Promise.all(clHolds)), sleep(CL_HOLD_MAX)]).then(reveal, reveal);
    // (the logo once FR24's header is drawn)
    let lt = 0; const logoTry = () => { clLogo(); if (!document.getElementById('fr-logo-payoff') && ++lt < 40) setTimeout(logoTry, 250); }; logoTry();
    clPlayerBind(wrap);
    clToolbarBind(wrap);
    clStayOld();
    // (a flight named in the address - #<FR24 id>, as FR24's map and its playback page open one: played)
    const h = (location.hash || '').replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{6,16}$/.test(h)) setTimeout(() => { const b = document.getElementById('btn-playback-' + h); if (b && !b.classList.contains('active')) clPlay(b); }, 300);
  }
  // (1.4.3) Any other page of FR24's new app - the map, a board, its player - moving to an aircraft's or a flight number's
  // page without loading it (its search box, a board's "Aircraft info"): that page loaded, so it is drawn as it was
  // too. FR4032's page, opened from the map's search in the app, was FR24's new one - and its flights before FR24's week
  // no player of their own. Never twice for one page within half a minute
  function clRouteWatch() {
    if (!classicOn() || clRouteWatch.on) return; clRouteWatch.on = true;
    const norm = s => decodeURIComponent(String(s || '')).toLowerCase().replace(/\/+$/, ''); let path = norm(location.pathname);
    setInterval(() => {
      const now1 = norm(location.pathname); if (now1 === path) return; path = now1;
      if (!classicOn() || !CL_PATH.test(now1)) return;
      let last = null; try { last = JSON.parse(sessionStorage.getItem('tl.classic.reload') || 'null'); } catch (e) { last = null; }
      if (last && last.p === now1 && Date.now() - last.t < 30000) return;
      try { sessionStorage.setItem('tl.classic.reload', JSON.stringify({ p: now1, t: Date.now() })); } catch (e) { /* once anyway */ }
      location.reload();
    }, 400);
  }
  // (FR24's new app moves to another of its pages without loading it - its header's search: that page loaded, so it is
  // drawn as it was too)
  function clStayOld() {
    const norm = s => decodeURIComponent(String(s || '')).toLowerCase().replace(/\/+$/, ''), path = norm(location.pathname);
    document.addEventListener('click', ev => {
      const a = ev.target && ev.target.closest && ev.target.closest('#app a[href]'); if (!a || ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey || a.target === '_blank') return;
      let u = null; try { u = new URL(a.href, location.href); } catch (e) { return; }
      if (u.origin !== location.origin || norm(u.pathname) === path) return;
      ev.preventDefault(); ev.stopImmediatePropagation(); location.assign(u.href);
    }, true);
    // (never twice for the same page within half a minute: a page FR24's app renames as it opens is drawn as it is)
    const iv = setInterval(() => {
      const now1 = norm(location.pathname); if (now1 === path) return;
      clearInterval(iv);
      let last = null; try { last = JSON.parse(sessionStorage.getItem('tl.classic.reload') || 'null'); } catch (e) { last = null; }
      if (last && last.p === now1 && Date.now() - last.t < 30000) return;
      try { sessionStorage.setItem('tl.classic.reload', JSON.stringify({ p: now1, t: Date.now() })); } catch (e) { /* once anyway */ }
      location.reload();
    }, 400);
  }

  // ---- the map: FR24's old pages drew Google's map ("Hybrid": the satellite picture with roads and places); here the
  // same kinds of picture, Esri's, drawn tile by tile (no library: the page takes no outside script)
  const CL_ESRI = n => `https://server.arcgisonline.com/ArcGIS/rest/services/${n}/MapServer/tile/{z}/{y}/{x}`;
  const CL_LAYERS = {
    hybrid: [CL_ESRI('World_Imagery'), CL_ESRI('Reference/World_Transportation'), CL_ESRI('Reference/World_Boundaries_and_Places')],
    satellite: [CL_ESRI('World_Imagery')],
    roadmap: [CL_ESRI('World_Street_Map')],
    terrain: [CL_ESRI('World_Topo_Map')],
    simple_style: [CL_ESRI('Canvas/World_Light_Gray_Base'), CL_ESRI('Canvas/World_Light_Gray_Reference')],
    radar_style2: [CL_ESRI('Canvas/World_Dark_Gray_Base'), CL_ESRI('Canvas/World_Dark_Gray_Reference')]
  };
  CL_LAYERS.radar_style = CL_LAYERS.aubergine_style = CL_LAYERS.black_white = CL_LAYERS.radar_style2;
  // ---- (1.4.3) The map as FR24's main map has it: its settings as FR24 reads them on opening - the page's (the account's
  // own, else FR24's), a browser not signed in its own over them (FR24's "settings" in this site's storage), and over
  // all those this script keeps of the ones FR24 locks (page.js mxSetKept). The map's style, its brightness, its day and
  // night line, the trail's tooltip, the units it tells in. Read again at each Play; the toolbar's choice of style holds
  // for this page only
  const CL_SPEEDS = ['kt', 'kmh', 'mph', 'mach'];
  function clMainSet() {
    const d = (clPage && clPage.props && clPage.props.dispatcher) || {};
    let s = {}; try { s = JSON.parse(JSON.stringify(d.settings || {})) || {}; } catch (e) { s = {}; }
    const over = o => {
      if (!o || typeof o !== 'object') return;
      for (const sec of Object.keys(o)) { const a = s[sec], b = o[sec]; if (!a || typeof a !== 'object' || !b || typeof b !== 'object') continue; for (const k of Object.keys(b)) if (k in a) a[k] = b[k]; }
    };
    const kept = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    if (d.accessToken == null) over(kept('settings'));
    over(kept('tl.mx.settings'));
    const map = s.map || {}, misc = s.misc || {}, u = s.units || {}, b = Number(map.brightness);
    return {
      style: CL_LAYERS[map.style] ? map.style : 'hybrid', brightness: Number.isFinite(b) ? Math.max(0, Math.min(100, b)) : 100,
      night: map.dayNightLine === true, tip: misc.showTrailTooltip !== false,
      alt: u.altitude === 'm' ? 'm' : 'ft', spd: CL_SPEEDS.includes(u.aircraftSpeed) ? u.aircraftSpeed : 'kt'
    };
  }
  function clMapType() { return pl.type && CL_LAYERS[pl.type] ? pl.type : clMainSet().style; }
  const clWX = (lon, z) => (lon + 180) / 360 * 256 * Math.pow(2, z);
  const clWY = (lat, z) => { const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); };
  const clLon = (x, z) => x / (256 * Math.pow(2, z)) * 360 - 180;
  const clLat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / (256 * Math.pow(2, z)); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  function clMap(el) {
    const tiles = el.querySelector('.tl-cl-tiles'), svg = el.querySelector('.tl-cl-over'), have = new Map();
    const m = { lat: 50, lon: 0, z: 4, draw: null, el, type: clMapType() };
    m.size = () => ({ w: el.clientWidth || 800, h: el.clientHeight || 500 });
    m.px = (lat, lon) => { const { w, h } = m.size(); return { x: clWX(lon, m.z) - clWX(m.lon, m.z) + w / 2, y: clWY(lat, m.z) - clWY(m.lat, m.z) + h / 2 }; };
    m.render = () => {
      const { w, h } = m.size(), cx = clWX(m.lon, m.z), cy = clWY(m.lat, m.z), n = Math.pow(2, m.z), x0 = cx - w / 2, y0 = cy - h / 2, want = new Set(), layers = CL_LAYERS[m.type] || CL_LAYERS.hybrid;
      for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + h) / 256); ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + w) / 256); tx++) {
          const wx = ((tx % n) + n) % n;
          layers.forEach((u, li) => {
            const k = `${m.type}/${m.z}/${tx}/${ty}/${li}`; want.add(k);
            let img = have.get(k); if (!img) { img = document.createElement('img'); img.alt = ''; img.draggable = false; img.src = u.replace('{z}', m.z).replace('{x}', wx).replace('{y}', ty); img.style.zIndex = String(li); tiles.appendChild(img); have.set(k, img); }
            img.style.left = Math.round(tx * 256 - x0) + 'px'; img.style.top = Math.round(ty * 256 - y0) + 'px';
          });
        }
      }
      for (const [k, img] of have) if (!want.has(k)) { img.remove(); have.delete(k); }
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      if (m.draw) m.draw();
    };
    m.setType = t => { if (!CL_LAYERS[t]) return; m.type = t; m.render(); };
    // (the main map's brightness, as FR24 sets it on its map's tiles)
    m.bright = b => { tiles.style.filter = Number.isFinite(b) && b < 100 ? `brightness(${Math.max(0, b)}%)` : ''; };
    m.bright(clMainSet().brightness);
    // (the track fitted to the part of the map the panel leaves: the old panel covers its foot)
    m.fit = pts => {
      if (!pts.length) return; let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (const p of pts) { a = Math.min(a, p.lat); b = Math.max(b, p.lat); c = Math.min(c, p.lon); d = Math.max(d, p.lon); }
      const { w, h } = m.size(), cover = clCover(), hh = Math.max(120, h - cover);
      for (m.z = 15; m.z > 1; m.z--) if (clWX(d, m.z) - clWX(c, m.z) < w * 0.8 && clWY(a, m.z) - clWY(b, m.z) < hh * 0.8) break;
      m.lon = (c + d) / 2; m.lat = clLat((clWY(a, m.z) + clWY(b, m.z)) / 2 + cover / 2, m.z);
      m.render();
    };
    m.zoom = (dz, ax, ay) => {
      const z = Math.max(2, Math.min(17, m.z + dz)); if (z === m.z) return;
      const { w, h } = m.size(); ax = fin(ax) ? ax : w / 2; ay = fin(ay) ? ay : (h - clCover()) / 2;
      const lat = clLat(clWY(m.lat, m.z) + ay - h / 2, m.z), lon = clLon(clWX(m.lon, m.z) + ax - w / 2, m.z);
      m.z = z; m.lat = clLat(clWY(lat, z) - (ay - h / 2), z); m.lon = clLon(clWX(lon, z) - (ax - w / 2), z); m.render();
    };
    let drag = null;
    el.addEventListener('pointerdown', ev => { if (ev.button) return; drag = { x: ev.clientX, y: ev.clientY, cx: clWX(m.lon, m.z), cy: clWY(m.lat, m.z) }; try { el.setPointerCapture(ev.pointerId); } catch (e) { /* none */ } el.classList.add('tl-cl-drag'); });
    el.addEventListener('pointermove', ev => { if (!drag) return; if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) > 3 && pl.follow) clFollow(false); m.lon = clLon(drag.cx - (ev.clientX - drag.x), m.z); m.lat = clLat(drag.cy - (ev.clientY - drag.y), m.z); m.render(); });
    const up = () => { drag = null; el.classList.remove('tl-cl-drag'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', ev => { ev.preventDefault(); const r = el.getBoundingClientRect(); m.zoom(ev.deltaY < 0 ? 1 : -1, ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
    el.addEventListener('dblclick', ev => { const r = el.getBoundingClientRect(); m.zoom(1, ev.clientX - r.left, ev.clientY - r.top); });
    window.addEventListener('resize', () => { if (el.style.display !== 'none') m.render(); clLayout(); });
    return m;
  }
  // (how much of the map's foot the panel covers: the map's height less where the page's content begins)
  function clCover() { const map = document.getElementById('cnt-data-map'), c = document.getElementById('cnt-data-content'); if (!map || !c) return 0; const mr = map.getBoundingClientRect(), cr = c.getBoundingClientRect(); return Math.max(0, Math.min(mr.height, mr.bottom - cr.top)); }
  // (a track's colour by its height, as FR24 colours its trails - by metres: white on the ground, yellow low, through
  // green, cyan and blue, to violet and red at the top; the same scale as Google's map here draws where FR24's own is
  // not to be had, page.js clmCol)
  const CL_HUES = [[100, 52], [300, 62], [600, 78], [1000, 105], [1500, 125], [2500, 150], [3500, 175], [4500, 190], [5500, 200], [6500, 210], [7500, 225], [8500, 240], [9500, 255], [10500, 268], [11500, 280], [12500, 300], [13000, 330]];
  const clAltCol = alt => {
    const m = (alt || 0) * 0.3048; if (!(m > 100)) return '#ffffff';
    let h = CL_HUES[CL_HUES.length - 1][1];
    for (let i = 1; i < CL_HUES.length; i++) if (m <= CL_HUES[i][0]) { const a = CL_HUES[i - 1], b = CL_HUES[i]; h = a[1] + (b[1] - a[1]) * (m - a[0]) / (b[0] - a[0]); break; }
    return `hsl(${Math.round(h)},100%,50%)`;
  };
  // (the toolbar: settings - the map's style -, full screen, zoom in and out)
  // (FR24's stylesheet leaves the buttons' links to the pointer of their items - the old page script listened there)
  function clToolbarBind(wrap) {
    const tb = wrap.querySelector('#fr24_ViewsToolbar'); if (!tb) return;
    const set = tb.querySelector('#fr24_SettingsMenu'), dd = set.querySelector('#fr24_SettingsDropdown'), mt = tb.querySelector('#fr24_mapType');
    set.addEventListener('click', ev => { if (dd.contains(ev.target)) return; ev.preventDefault(); set.classList.toggle('open'); if (!set.classList.contains('open')) mt.classList.remove('open'); });
    mt.querySelector('button').addEventListener('click', ev => { ev.preventDefault(); mt.classList.toggle('open'); });
    mt.querySelectorAll('a[data-value]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault(); const v = a.dataset.value; mt.classList.remove('open');
      const b = mt.querySelector('button'); b.value = v; b.innerHTML = `${esc(a.textContent)} <span class="caret"></span>`;
      pl.type = v;
      if (pl.gm) clGm('type', { type: v }); else if (pl.map) pl.map.setType(v);
    }));
    document.addEventListener('click', ev => { if (!set.contains(ev.target)) { set.classList.remove('open'); mt.classList.remove('open'); } });
    tb.querySelector('#fr24_Fullscreen').addEventListener('click', ev => {
      ev.preventDefault();
      try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { /* not allowed here */ }
    });
    const zoom = dz => { if (!pl.on) return; if (pl.gm) clGm('zoom', { dz }); else if (pl.map) pl.map.zoom(dz); };
    tb.querySelector('#fr24_ZoomIn').addEventListener('click', ev => { ev.preventDefault(); zoom(1); });
    tb.querySelector('#fr24_ZoomOut').addEventListener('click', ev => { ev.preventDefault(); zoom(-1); });
  }

  // ---- the player: a row's Play, as FR24's old panel played it - the map over the page, the flight drawn, the aircraft
  // moved along it, its figures each moment (and those FR24 padlocked, from public ADS-B - fillPlaybackData)
  const pl = { map: null, pts: [], t: 0, t0: 0, t1: 0, playing: false, raf: 0, last: 0, seq: 0, follow: false, route: false, chart: false, fid: '', o: null, d: null, on: false, type: '' };
  // ---- (1.4.2) the map as the old pages had it: Google's, FR24's own - drawn in the page by its part there (page.js
  // clmOp), the flight on it as FR24's map draws one. Asked once; the map drawn here (Esri's) only where Google's cannot be
  let clGmWait = null;
  function onClMapSt(d) {
    if (d && d.ok === true && d.follow === false && pl.follow) { pl.follow = false; const b = document.getElementById('btn-toggle-follow'); if (b) b.classList.remove('active'); }
    if (clGmWait && d && typeof d.ok === 'boolean' && d.follow === undefined) { const r = clGmWait; clGmWait = null; r(d.ok); }
  }
  function clMapReady() {
    if (pl.gm !== undefined) return Promise.resolve(pl.gm);
    if (pl.gmP) return pl.gmP;
    pl.gmP = new Promise(res => {
      const done = ok => { pl.gm = !!ok; res(pl.gm); };
      clGmWait = done; postToPage('clMap', { op: 'init', type: clMapType(), set: clMainSet() });
      // (Google's map not up in 18 s: the one drawn here)
      setTimeout(() => { if (clGmWait === done) { clGmWait = null; done(false); } }, 18000);
    });
    return pl.gmP;
  }
  const clGm = (op, o) => postToPage('clMap', Object.assign({ op }, o || {}));
  // (the old page script's layout of the playback: the map 600 px high, the page's content over its foot)
  function clLayout() {
    const map = document.getElementById('cnt-data-map'), c = document.getElementById('cnt-data-content'), sh = c && c.querySelector('.section-header'), cp = document.getElementById('cnt-playback');
    if (!map || !c) return;
    if (pl.on) {
      map.style.display = ''; map.style.overflow = 'hidden'; map.style.height = '600px';
      c.classList.add('map-init'); c.style.marginTop = '548px'; c.style.position = 'absolute';
      if (sh) sh.classList.add('hidden'); if (cp) cp.classList.remove('hidden');
    } else {
      map.style.display = 'none'; c.classList.remove('map-init'); c.style.marginTop = ''; c.style.position = '';
      if (sh) sh.classList.remove('hidden'); if (cp) cp.classList.add('hidden');
    }
    clSlider();
  }
  function clPlayerBind(wrap) {
    pl.wrap = wrap;
    document.addEventListener('click', ev => {
      const a = ev.target && ev.target.closest && ev.target.closest('#content[data-tl-classic] #tbl-datatable a.btn-playback'); if (!a || ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      ev.preventDefault(); ev.stopImmediatePropagation(); clPlay(a);
    }, true);
    document.addEventListener('click', ev => {
      const a = ev.target && ev.target.closest && ev.target.closest('#content[data-tl-classic] a.btn-share-schedule'); if (!a) return;
      ev.preventDefault(); const n = a.dataset.flightNumber || '';
      const url = n ? `${CL_FR}/data/flights/${n}` : `${CL_FR}${location.pathname}`;
      const toast = ok => { const box = document.getElementById('toast-container'); if (!box) return; box.style.display = ''; const t = document.createElement('div'); t.className = `toast toast-${ok ? 'success' : 'error'}`; t.setAttribute('aria-live', 'polite'); t.innerHTML = `<div class="toast-message">${ok ? 'Link copied to clipboard' : esc(url)}</div>`; box.appendChild(t); setTimeout(() => t.remove(), 3500); };
      try { navigator.clipboard.writeText(url).then(() => toast(true), () => toast(false)); } catch (e) { toast(false); }
    }, true);
    const btn = wrap.querySelector('#btn-control-playback');
    btn.addEventListener('click', () => clToggle());
    wrap.querySelector('#btn-playback-control-close').addEventListener('click', () => clClose());
    const sl = wrap.querySelector('#cnt-fight-progress-slider');
    const seek = ev => { const r = sl.getBoundingClientRect(), span = Math.max(1, r.width - 50); const f = Math.max(0, Math.min(1, (ev.clientX - r.left - 25) / span)); clSeek(pl.t0 + f * (pl.t1 - pl.t0)); };
    let sd = false;
    sl.addEventListener('pointerdown', ev => { if (!pl.pts.length) return; sd = true; try { sl.setPointerCapture(ev.pointerId); } catch (e) { /* none */ } seek(ev); });
    sl.addEventListener('pointermove', ev => { if (sd) seek(ev); });
    sl.addEventListener('pointerup', () => { sd = false; }); sl.addEventListener('pointercancel', () => { sd = false; });
    wrap.querySelector('#btn-toggle-follow').addEventListener('click', () => clFollow(!pl.follow));
    wrap.querySelector('#btn-toggle-route').addEventListener('click', ev => { pl.route = !pl.route; ev.currentTarget.classList.toggle('active', pl.route); if (pl.gm) clGm('route', { on: pl.route }); else if (pl.map) pl.map.render(); });
    wrap.querySelector('#btn-toggle-chart').addEventListener('click', ev => { pl.chart = !pl.chart; ev.currentTarget.classList.toggle('active', pl.chart); const c = wrap.querySelector('#cnt-chart'); c.classList.toggle('hidden', !pl.chart); if (pl.chart) clChart(); });
  }
  function clFollow(on) {
    pl.follow = !!on; const b = document.getElementById('btn-toggle-follow'); if (b) b.classList.toggle('active', pl.follow);
    const c = pl.pts.length ? clAt(pl.t) : null; if (!c) return;
    if (pl.gm) clGm('pos', { lat: c.lat, lon: c.lon, trk: fin(c.trk) ? c.trk : 0, follow: pl.follow, cover: clCover(), t: Math.round(pl.t) });
    else if (pl.follow && pl.map) clCentre(c);
  }
  // (the aircraft in the middle of the part of the map the panel leaves)
  function clCentre(c) { const m = pl.map; m.lon = c.lon; m.lat = clLat(clWY(c.lat, m.z) + clCover() / 2, m.z); m.render(); }
  // (a flight's track: FR24's own of its flight, as its old panel asked for it; the monitor's FR24 positions of it where
  // FR24 has none to give; a flight of a log rebuilt here: its public ADS-B track - pbFlight)
  async function clTrack(id, ts) {
    if (PB_SYN.test(id) || !/^[0-9a-f]{1,12}$/.test(id)) { const f = await pbFlight({ id, dep: ts }); return f && f.ok ? { pts: f.pts, cs: f.cs || '', fn: f.flightNumber || '', o: f.origin, d: f.destination, fr24: false, hex: clean(f.hex || '').toLowerCase(), type: clean(f.type || '') } : null; }
    try {
      const j = await fr24PbJson(id, ts || nowS(), { priority: true, timeout: 20000 });
      try { fr24TrackSend(id, fr24PbParse(j)); } catch (e) { /* not sent */ }
      const fl = j && j.result && j.result.response && j.result.response.data && j.result.response.data.flight, tr = fl && fl.track;
      if (Array.isArray(tr) && tr.length > 1) {
        const pts = tr.filter(p => p && fin(p.latitude) && fin(p.longitude) && fin(p.timestamp)).map(p => ({ t: p.timestamp, lat: p.latitude, lon: p.longitude, alt: p.altitude && fin(p.altitude.feet) ? p.altitude.feet : null, gs: p.speed && fin(p.speed.kts) ? p.speed.kts : null, trk: fin(p.heading) ? p.heading : null, vr: p.verticalSpeed && fin(p.verticalSpeed.fpm) ? p.verticalSpeed.fpm : null })).sort((a, b) => a.t - b.t);
        const idn = fl.identification || {}, ap = fl.airport || {}, apOf = x => x && x.code ? { code: x.code.iata || x.code.icao || '', name: x.name || '', city: (x.position && x.position.region && x.position.region.city) || x.name || '', lat: x.position && x.position.latitude, lon: x.position && x.position.longitude } : null;
        const im = fl.aircraftImages || {}, ph = (im.large || im.medium || im.thumbnails || [])[0] || null, idf = (fl.aircraft && fl.aircraft.identification) || {};
        noteCsFn(idn.callsign, idn.number && idn.number.default, pts.length ? pts[0].t : 0);
        return { pts, cs: clean(idn.callsign || ''), fn: clean((idn.number && idn.number.default) || ''), o: apOf(ap.origin), d: apOf(ap.destination), fr24: true, median: fl.median || null, photo: ph, msn: clean(idf.serialNo || ''), model: clean((fl.aircraft && fl.aircraft.model && fl.aircraft.model.text) || ''), type: clean((fl.aircraft && fl.aircraft.model && fl.aircraft.model.code) || ''), hex: clean(idf.modes || '').toLowerCase() };
      }
    } catch (e) { /* FR24's not had: the monitor's */ }
    const r = await pbRaw(id, ts).catch(() => ({ pts: [], m: {} }));
    return r.pts.length > 1 ? { pts: r.pts, cs: clean(r.m.cs || ''), fn: clean(r.m.fn || ''), o: null, d: null, fr24: true, hex: clean(r.m.hex || '').toLowerCase() } : null;
  }
  // (the airport a row names - its desk cell's words and link; the panel shows "Liverpool <small>(LPL)</small>")
  function clRowAp(td) {
    const a = td && td.querySelector('a[href*="/data/airports/"], a[href*="ourairports.com"]'), href = a ? a.getAttribute('href') || '' : '';
    const code = (href.match(/airports\/([a-z0-9-]+)/i) || [])[1] || '';
    // (1.4.2: an OurAirports field - Axis Business Park's helipad, GB-1368 - by its code in that list)
    const oid = code && oa.byCode ? oa.byCode.get(code.toUpperCase()) : 0;
    const ap = code ? airports.byIata.get(code.toUpperCase()) || ENGINE.byIcao(code) || (oid ? oaAp(oid) : null) || null : null;
    const html = td ? td.innerHTML.replace(/<a\b[^>]*>\s*(\([^()<]*\))\s*<\/a>/, '<small>$1</small>').trim() : '';
    return { html: html && !/^(?:—|-|–)$/.test(clean(td.textContent)) ? html : '-', title: (ap && ap.name) || (td && td.title ? td.title.replace(/,[^,]*$/, '') : ''), ap };
  }
  async function clPlay(btn) {
    const id = String(btn.dataset.flightHex || '').toLowerCase(), tr = btn.closest('tr'); if (!id || !tr) return;
    const seq = ++pl.seq, wrap = pl.wrap, ts = Number(btn.dataset.timestamp) || Number(tr.dataset.timestamp) || 0;
    clPause();
    document.querySelectorAll('#tbl-datatable tr.active, #tbl-datatable a.btn-playback.active').forEach(e => e.classList.remove('active'));
    tr.classList.add('active'); btn.classList.add('active');
    try { history.replaceState(history.state, '', location.pathname + location.search + '#' + id); } catch (e) { /* the address as it was */ }
    pl.on = true; clLayout();
    window.scrollTo(0, 0);
    // (Google's map made at its full size - its box shown before it is asked for: a map made hidden fits nothing)
    const mapEl = wrap.querySelector('#cnt-data-map');
    if (pl.gm !== false) { mapEl.querySelector('#tl-cl-gmap').style.display = ''; for (const el of mapEl.querySelectorAll('.tl-cl-tiles, .tl-cl-over, .tl-cl-attr')) el.style.display = 'none'; }
    const gmP = clMapReady().then(gm => {
      mapEl.querySelector('#tl-cl-gmap').style.display = gm ? '' : 'none';
      for (const el of mapEl.querySelectorAll('.tl-cl-tiles, .tl-cl-over, .tl-cl-attr')) el.style.display = gm ? 'none' : '';
      if (!gm && !pl.map) pl.map = clMap(mapEl);
      // (the main map's style and brightness, as they are now)
      if (!gm && pl.map) { const ms = clMainSet(); pl.map.bright(ms.brightness); if (!pl.type && pl.map.type !== ms.style) pl.map.setType(ms.style); }
      return gm;
    });
    // (the panel at once, from the row: its airports, its flight, the aircraft)
    const c = tr.children, fromC = clRowAp(c[3]), toC = clRowAp(c[4]), flightCell = c[5], flight = clean(flightCell && flightCell.textContent).replace(/[()]/g, '');
    const set = (sel, html, title) => { const el = wrap.querySelector(sel); if (el) { el.innerHTML = html; if (title !== undefined) el.title = title; } };
    set('#txt-airport-origin', fromC.html, fromC.title); set('#txt-airport-dest', toC.html, toC.title);
    const fnRow = clPage.kind === 'flights' ? clPage.fn : flight;
    set('#txt-playback-header', `Playback of flight ${esc(fnRow || '')}`);
    const dur = (clean(c[6] && c[6].textContent).match(/\d+:\d\d/) || [''])[0]; set('#txt-flight-time-actual', esc(dur || '-'));
    set('#txt-flight-time-average', '-'); set('#txt-flight-delay-average', '-');
    const o = fromC.ap, d = toC.ap;
    clDistance(o, d);
    const p = (clPage && clPage.props) || {}, a = p.aircraft || {};
    const rowRegA = flightCell && flightCell.querySelector('a[href*="/data/aircraft/"]'), rowReg = clPage.kind === 'flights' ? clean((rowRegA && rowRegA.textContent) || '').replace(/[()]/g, '') : clPage.reg;
    set('#txt-aircraft-model', esc((clPage.kind === 'aircraft' ? a.model : '') || clean(flightCell && flightCell.textContent).replace(/\(.*\)/, '').trim() || '-'));
    set('#txt-aircraft-reg', esc(rowReg || '-'));
    set('#txt-aircraft-serial', esc((clPage.kind === 'aircraft' && a.msn && !(p.withheld || {}).msn) ? a.msn : clHeadMsn() || '-'));
    clPhoto(clPage.kind === 'aircraft' ? (p.photos || [])[0] || clHeadPhoto() : null);
    pl.o = o; pl.d = d; pl.fid = id; pl.hex = ''; pl.pts = []; clSlider(); clFigures(null);
    if (pl.gm) clGm('clear'); else if (pl.map) { pl.map.draw = null; pl.map.render(); }
    const [tk, gm] = await Promise.all([clTrack(id, ts), gmP]);
    if (seq !== pl.seq) return;
    if (!tk || tk.pts.length < 2) { set('#txt-playback-header', `Playback of flight ${esc(fnRow || '')} <small>/ no track of this flight could be had</small>`); return; }
    const fnTk = clPage.kind === 'flights' ? clPage.fn || tk.fn : tk.fn || (flight && !/^[A-Z]{3}\d/.test(flight) ? flight : '');
    const head = fnTk || tk.cs || flight;
    set('#txt-playback-header', `Playback of flight ${esc(head)}${tk.cs && tk.cs !== head ? ` <small>/ ${esc(tk.cs)}</small>` : ''}`);
    if (tk.median) { set('#txt-flight-time-average', esc(fin(tk.median.time) && tk.median.time > 0 ? clHm(tk.median.time) : '-')); set('#txt-flight-delay-average', esc(fin(tk.median.delay) ? clHm(tk.median.delay) : '-')); }
    if (clPage.kind === 'flights') { if (tk.model) set('#txt-aircraft-model', esc(tk.model)); if (tk.photo) clPhoto({ url: tk.photo.src, link: tk.photo.link, copyright: tk.photo.copyright }); }
    { const m = tk.msn || clHeadMsn(); if (m && /^\s*-?\s*$/.test((wrap.querySelector('#txt-aircraft-serial') || {}).textContent || '')) set('#txt-aircraft-serial', esc(m)); }
    if (clPage.kind === 'aircraft' && !(wrap.querySelector('#img-aircraft-img') || {}).src) clPhoto(clHeadPhoto());
    if (/^[0-9a-f]{6}$/.test(tk.hex || '')) pl.hex = tk.hex;
    if (!o && tk.o && fin(tk.o.lat)) pl.o = tk.o; if (!d && tk.d && fin(tk.d.lat)) pl.d = tk.d;
    // (an end at a field FR24 does not list: the distance from where the track itself began and ended)
    clDistance(pl.o && fin(pl.o.lat) ? pl.o : tk.pts[0], pl.d && fin(pl.d.lat) ? pl.d : tk.pts[tk.pts.length - 1]);
    // (one across the date line: its longitudes made continuous)
    const pts = tk.pts.map(q => Object.assign({}, q)); for (let i = 1; i < pts.length; i++) { while (pts[i].lon - pts[i - 1].lon > 180) pts[i].lon -= 360; while (pts[i].lon - pts[i - 1].lon < -180) pts[i].lon += 360; }
    pl.pts = pts; pl.t0 = pts[0].t; pl.t1 = pts[pts.length - 1].t; pl.t = pl.t0;
    if (gm) {
      // (the flight to Google's map: each position [time, lat, lon, ft, kts, track], its airports, the aircraft - its
      // address, type and kind, for FR24's picture of it)
      const ac = { hex: pl.hex || (clPage.kind === 'aircraft' ? clPage.hex : '') || '', type: tk.type || (clPage.kind === 'aircraft' ? clean((clPage.props.aircraft || {}).typeCode || '') : '') || '' };
      ac.cls = ENGINE.classify({ hex: ac.hex, type: ac.type });
      const r5 = v => Math.round(v * 1e5) / 1e5, ends = a => a && fin(a.lat) && fin(a.lon) ? [r5(a.lat), r5(a.lon)] : null;
      clGm('track', { pts: pts.map(q => [q.t, r5(q.lat), r5(q.lon), fin(q.alt) ? Math.round(q.alt) : null, fin(q.gs) ? Math.round(q.gs) : null, fin(q.trk) ? Math.round(q.trk) : null]), o: ends(pl.o), d: ends(pl.d), cover: clCover(), ac, set: clMainSet(), type: clMapType() });
      clGm('route', { on: pl.route });
    } else { pl.map.draw = clDrawTrack; pl.map.fit(pts.concat([pl.o, pl.d].filter(x => x && fin(x.lat) && fin(x.lon)))); }
    clSeek(pl.t0);
    // (the padlocked figures and the airports' "-" - the aircraft's page's own work: its address)
    try { fillPlayback(); } catch (e) { /* none */ }
    if (pl.chart) clChart();
  }
  function clDistance(A, B) {
    const el = pl.wrap && pl.wrap.querySelector('#txt-great-circle-distance'); if (!el) return;
    if (!A || !B || !fin(A.lat) || !fin(B.lat)) { el.textContent = '-'; return; }
    const km = ENGINE.dist(A.lat, A.lon, B.lat, B.lon);
    el.dataset.km = String(Math.round(km)); el.dataset.miles = String(Math.round(km / 1.609344)); el.dataset.nm = String(Math.round(km / 1.852));
    el.innerHTML = `${Math.round(km).toLocaleString('en-GB')} <small>KM</small>`;
  }
  // (an aircraft FR24 shows no picture or serial number of: those its header has by now - this script's, from the
  // public registers and JetPhotos - as the old panel showed the header's)
  function clHeadPhoto() {
    const c = document.querySelector('.section-header .cnt-picture'), img = c && c.querySelector('img'), a = c && c.querySelector('a');
    if (!img || !(img.currentSrc || img.src)) return null;
    const cap = clean((c.querySelector('.label') || {}).textContent || '').replace(/^©\s*/, '').replace(/\s*\|.*$/, '');
    return { url: img.currentSrc || img.src, link: a ? a.href : '', copyright: cap };
  }
  function clHeadMsn() {
    const lb = [...document.querySelectorAll('#cnt-aircraft-info label')].find(l => /^\s*SERIAL NUMBER/i.test(l.textContent || '')), sp = lb && lb.nextElementSibling;
    const v = sp && !sp.querySelector('svg') ? clean(sp.textContent) : ''; return v && !/^(?:-|N\/A)$/i.test(v) ? v : '';
  }
  function clPhoto(ph) {
    const w = pl.wrap, img = w.querySelector('#img-aircraft-img'), a = w.querySelector('#txt-aircraft-image-url'), cap = w.querySelector('#txt-aircraft-image-copyright');
    if (ph && ph.url) { img.referrerPolicy = 'no-referrer'; img.src = ph.url; img.style.display = ''; a.href = ph.link || ph.url; cap.textContent = ` © ${ph.copyright || ''} | Jetphotos`; }
    else { img.removeAttribute('src'); img.style.display = 'none'; a.removeAttribute('href'); cap.textContent = ''; }
  }
  // (the flight at moment t: between the two positions about it)
  function clAt(t) {
    const P = pl.pts; if (!P.length) return null;
    let lo = 0, hi = P.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].t < t) lo = m + 1; else hi = m; }
    const b = P[lo], a = P[lo - 1] || b; if (a === b || b.t === a.t) return Object.assign({}, b);
    const f = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))), lin = (x, y) => fin(x) && fin(y) ? x + (y - x) * f : fin(x) ? x : y;
    let trk = fin(b.trk) ? b.trk : null; if (trk == null) trk = ENGINE.brg(a.lat, a.lon, b.lat, b.lon);
    const vr = fin(b.vr) ? b.vr : fin(a.alt) && fin(b.alt) && b.t > a.t ? (b.alt - a.alt) / ((b.t - a.t) / 60) : null;
    return { t, lat: lin(a.lat, b.lat), lon: lin(a.lon, b.lon), alt: lin(a.alt, b.alt), gs: lin(a.gs, b.gs), trk, vr, sq: b.sq || a.sq || '' };
  }
  // (FR24's own pin of an airport - its picture, still on its server - and an aircraft drawn as FR24's map draws one)
  const CL_PIN = `${CL_FR}/static/images/airport_pin_40_blue.png`;
  const CL_PLANE = 'M0,-14 C1.2,-14 1.8,-12.6 1.8,-10.6 L1.8,-4.2 L13,2.6 L13,5 L1.8,1.4 L1.6,8.4 L5,11.2 L5,13 L0,11.8 L-5,13 L-5,11.2 L-1.6,8.4 L-1.8,1.4 L-13,5 L-13,2.6 L-1.8,-4.2 L-1.8,-10.6 C-1.8,-12.6 -1.2,-14 0,-14 Z';
  function clDrawTrack() {
    const m = pl.map, svg = m.el.querySelector('.tl-cl-over'), P = pl.pts; if (!P.length) { svg.innerHTML = ''; return; }
    let html = '';
    // (the great circle between its airports: FR24's thin dark dashed line)
    if (pl.route && pl.o && pl.d && fin(pl.o.lat) && fin(pl.d.lat)) {
      let d = ''; for (let i = 0; i <= 64; i++) { const g = clGc(pl.o, pl.d, i / 64), q = m.px(g.lat, g.lon); d += (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); }
      html += `<path d="${d}" fill="none" stroke="#000" stroke-opacity="${(100 / 255).toFixed(3)}" stroke-width="2" stroke-dasharray="3 5"/>`;
    }
    // (1.4.3: the track as FR24's map draws a trail - 3 px, by height, laid on see-through as one (FR24's 100 of 255); a
    // dot at each position, its own colour)
    const xy = P.map(p => m.px(p.lat, p.lon)), f1 = v => v.toFixed(1);
    let line = '', dots = '', last = null;
    for (let i = 1; i < P.length; i++) {
      const a = xy[i - 1], q = xy[i]; if (Math.abs(q.x - a.x) + Math.abs(q.y - a.y) < 0.6 && i < P.length - 1) continue;
      if (P[i].t - P[i - 1].t >= 300) { html += `<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(q.x)}" y2="${f1(q.y)}" stroke="#000" stroke-opacity="${(100 / 255).toFixed(3)}" stroke-width="1" stroke-dasharray="1 3"/>`; continue; }
      line += `<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(q.x)}" y2="${f1(q.y)}" stroke="${clAltCol(P[i].alt)}" stroke-width="3" stroke-linecap="round"/>`;
    }
    for (let i = 0; i < P.length; i++) { const q = xy[i]; if (last && Math.abs(q.x - last.x) + Math.abs(q.y - last.y) < 1) continue; dots += `<circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="1.5" fill="${clAltCol(P[i].alt)}"/>`; last = q; }
    html += `<g opacity="${(100 / 255).toFixed(3)}">${line}</g>${dots}`;
    for (const ap of [pl.o, pl.d]) if (ap && fin(ap.lat)) { const q = m.px(ap.lat, ap.lon); html += `<image href="${CL_PIN}" x="${(q.x - 10).toFixed(1)}" y="${(q.y - 20).toFixed(1)}" width="20" height="20"/>`; }
    const c = clAt(pl.t);
    if (c) { const q = m.px(c.lat, c.lon); html += `<g transform="translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) rotate(${Math.round(c.trk || 0)})"><path d="${CL_PLANE}" fill="#fcc419" stroke="#3b3b3b" stroke-width="1.1" stroke-linejoin="round"/></g>`; }
    svg.innerHTML = html;
  }
  function clGc(a, b, f) {
    const r = Math.PI / 180, la1 = a.lat * r, lo1 = a.lon * r, la2 = b.lat * r, lo2 = b.lon * r;
    const dd = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((la2 - la1) / 2), 2) + Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((lo2 - lo1) / 2), 2))); if (!(dd > 0)) return a;
    const A = Math.sin((1 - f) * dd) / Math.sin(dd), B = Math.sin(f * dd) / Math.sin(dd);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2), y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2), z = A * Math.sin(la1) + B * Math.sin(la2);
    return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / r, lon: Math.atan2(y, x) / r };
  }
  // (the slider as the old page script set it: the thumb's left and the yellow progress in pixels, its range data-max)
  function clSlider() {
    const sl = document.getElementById('cnt-fight-progress-slider'); if (!sl) return;
    const max = Math.max(0, sl.clientWidth - 50), f = pl.t1 > pl.t0 ? (pl.t - pl.t0) / (pl.t1 - pl.t0) : 0, x = Math.round(Math.max(0, Math.min(1, f)) * max);
    const th = sl.querySelector('.thumb'), pr = sl.querySelector('.progress');
    th.dataset.max = String(max); th.dataset.value = String(x); th.style.left = x + 'px'; pr.style.width = x + 'px';
  }
  function clFigures(c) {
    const w = pl.wrap, n = v => Math.round(v).toLocaleString('en-GB');
    const ts = w.querySelector('#txt-track-timestamp'), alt = w.querySelector('#txt-altitude'), sp = w.querySelector('#txt-speed'), hd = w.querySelector('#txt-track-heading');
    if (!c) { ts.dataset.timestamp = ''; ts.textContent = '-'; alt.textContent = '-'; sp.textContent = '-'; hd.textContent = '-'; return; }
    ts.dataset.timestamp = String(Math.round(c.t)); ts.innerHTML = `${new Date(c.t * 1000).toISOString().slice(11, 16)} <small>UTC</small>`; ts.title = new Date(c.t * 1000).toISOString().slice(0, 10);
    if (fin(c.alt)) { alt.dataset.ft = String(Math.round(c.alt)); alt.dataset.m = String(Math.round(c.alt * 0.3048)); alt.innerHTML = `${n(c.alt)} <small>FT</small>`; } else alt.textContent = '-';
    if (fin(c.gs)) { sp.dataset.kt = String(Math.round(c.gs)); sp.dataset.kmh = String(Math.round(c.gs * 1.852)); sp.dataset.mph = String(Math.round(c.gs * 1.15078)); sp.innerHTML = `${n(c.gs)} <small>KTS</small>`; } else sp.textContent = '-';
    hd.textContent = fin(c.trk) ? Math.round((c.trk + 360) % 360) + '°' : '-';
  }
  function clSeek(t) {
    pl.t = Math.max(pl.t0, Math.min(pl.t1, t)); const c = clAt(pl.t); if (!c) return;
    clSlider(); clFigures(c);
    if (pl.gm) clGm('pos', { lat: c.lat, lon: c.lon, trk: fin(c.trk) ? c.trk : 0, follow: pl.follow, cover: clCover(), t: Math.round(pl.t) });
    else if (pl.map) { if (pl.follow) clCentre(c); else clDrawTrack(); }
    if (pl.chart) clChartMark();
    // (the moment's padlocked figures - GPS altitude, airspeeds, vertical speed, squawk - from public ADS-B, as on FR24's
    // own panel: the aircraft's address; FR24's own vertical speed where it gives one and public data has none)
    // (a flight number's page: the aircraft of the flight played - its address from its track's answer)
    const hex = (clPage && clPage.kind === 'aircraft' && clPage.hex) || pl.hex || clean(((document.getElementById('txt-mode-s') || {}).textContent) || '').toLowerCase();
    if (/^[0-9a-f]{6}$/.test(hex) && (!pl.playing || Date.now() - (pl.filled || 0) > 300)) { pl.filled = Date.now(); fillPlaybackData(hex).catch(() => {}); }
  }
  function clToggle() { if (pl.playing) clPause(); else clStart(); }
  function clStart() {
    if (pl.pts.length < 2) return; if (pl.t >= pl.t1) pl.t = pl.t0;
    pl.playing = true; pl.last = 0; const b = pl.wrap.querySelector('#btn-control-playback'); b.classList.add('active'); b.title = 'Pause playback';
    // (the whole flight in about a minute and a half, never slower than a minute a second)
    const rate = Math.max(60, (pl.t1 - pl.t0) / 90);
    const step = ms => { if (!pl.playing) return; if (pl.last) clSeek(pl.t + (ms - pl.last) / 1000 * rate); pl.last = ms; if (pl.t >= pl.t1) { clPause(); return; } pl.raf = requestAnimationFrame(step); };
    pl.raf = requestAnimationFrame(step);
  }
  function clPause() { pl.playing = false; cancelAnimationFrame(pl.raf); const b = pl.wrap && pl.wrap.querySelector('#btn-control-playback'); if (b) { b.classList.remove('active'); b.title = 'Start playback'; } }
  function clClose() {
    clPause(); pl.seq++; pl.on = false; pl.pts = []; clLayout(); if (pl.gm) clGm('clear');
    document.querySelectorAll('#tbl-datatable tr.active, #tbl-datatable a.btn-playback.active').forEach(e => e.classList.remove('active'));
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* none */ }
  }
  // (the old panel's chart: the flight's height and ground speed over its time, the moment played marked)
  function clChart() {
    const box = pl.wrap.querySelector('#cnt-chart'), P = pl.pts; if (!P.length) { box.innerHTML = ''; return; }
    const W = Math.max(400, box.clientWidth - 40 || 1000), H = 325, L = 56, R = 56, T = 30, B = 34, t0 = pl.t0, span = Math.max(1, pl.t1 - pl.t0);
    const maxA = Math.max(1000, ...P.map(p => p.alt || 0)) * 1.1, maxS = Math.max(100, ...P.map(p => p.gs || 0)) * 1.1;
    const X = t => L + (t - t0) / span * (W - L - R), YA = v => T + (1 - v / maxA) * (H - T - B), YS = v => T + (1 - v / maxS) * (H - T - B);
    const line = (k, Y) => P.filter(p => fin(p[k])).map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p[k]).toFixed(1)}`).join('');
    let grid = '';
    for (let i = 0; i <= 4; i++) { const y = T + i * (H - T - B) / 4; grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#444" stroke-width="1"/><text x="${L - 6}" y="${y + 4}" fill="#f7c121" font-size="11" text-anchor="end">${Math.round(maxA * (1 - i / 4) / 100) * 100}</text><text x="${W - R + 6}" y="${y + 4}" fill="#5ab4f0" font-size="11">${Math.round(maxS * (1 - i / 4))}</text>`; }
    for (let i = 0; i <= 6; i++) { const t = t0 + span * i / 6, x = X(t); grid += `<text x="${x}" y="${H - B + 18}" fill="#bbb" font-size="11" text-anchor="middle">${new Date(t * 1000).toISOString().slice(11, 16)}</text>`; }
    const area = line('alt', YA); const firstA = P.find(p => fin(p.alt)), lastA = [...P].reverse().find(p => fin(p.alt));
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${firstA ? `<path d="${area}L${X(lastA.t).toFixed(1)} ${H - B}L${X(firstA.t).toFixed(1)} ${H - B}Z" fill="#f7c121" fill-opacity=".18"/>` : ''}<path d="${area}" fill="none" stroke="#f7c121" stroke-width="2"/><path d="${line('gs', YS)}" fill="none" stroke="#5ab4f0" stroke-width="2"/><text x="${L}" y="18" fill="#f7c121" font-size="12">Altitude (ft)</text><text x="${W - R}" y="18" fill="#5ab4f0" font-size="12" text-anchor="end">Ground speed (kts)</text><line class="tl-cl-mark" x1="0" y1="${T}" x2="0" y2="${H - B}" stroke="#fff" stroke-width="1" stroke-dasharray="3 3"/></svg>`;
    box.dataset.w = String(W); clChartMark();
  }
  function clChartMark() {
    const box = pl.wrap && pl.wrap.querySelector('#cnt-chart'), mk = box && box.querySelector('.tl-cl-mark'); if (!mk) return;
    const W = Number(box.dataset.w) || 1000, x = 56 + (pl.t - pl.t0) / Math.max(1, pl.t1 - pl.t0) * (W - 112);
    mk.setAttribute('x1', x.toFixed(1)); mk.setAttribute('x2', x.toFixed(1));
  }
