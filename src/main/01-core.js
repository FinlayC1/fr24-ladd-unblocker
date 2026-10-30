  // ------------------------------------------------------------------------------------------------------------
  // PART 2 â€” RESOLVER, ROUTE ENGINE, ENRICHMENT, PANEL (runs in the userscript context)
  // ------------------------------------------------------------------------------------------------------------
  const VERSION = '1.1.2';
  // The switches of the LADD Unblock window (FR24's bottom bar): in localStorage, so both this script and the page-world
  // part read them synchronously at document start; the page part is told of a change at once ('opts')
  const OPT_KEY = 'tweeks.fr24.ladd.opts1';
  const OPT_DEFAULTS = { on: true, strip: true, boards: true, search: true, acPages: true, alerts: true, noAds: true, count: true };
  const opt = (() => { let o = null; try { o = JSON.parse(localStorage.getItem(OPT_KEY) || 'null'); } catch (_) { o = null; } return Object.assign({}, OPT_DEFAULTS, o && typeof o === 'object' ? o : {}); })();
  const NM_KM = 1.852;
  const AREA_RADIUS_NM = 220;           // aggregator "point" radius for viewport sweeps (APIs cap at 250)
  const TARGET_RADIUS_NM = 40;          // radius for the immediate lookup of the selected aircraft
  const SWEEP_INTERVAL_MS = 7000;       // how often to sweep the viewport while unresolved flights remain
  const PENDING_TTL_MS = 90000;         // forget feed flights not seen for this long
  const ID_TTL_MS = 48 * 3600e3;        // cache lifetime for flight-id -> aircraft resolutions (longer than any flight)
  const HEX_TTL_MS = 45 * 864e5;        // cache lifetime for hex -> registration/type/photo data
  const HISTORY_DAYS = 220;             // how far back the aircraft's own flight log is rebuilt (7 months)
  // adsb.lol keeps each aircraft's daily traces for about six weeks (30 Sep 2026: back to 19 Aug); older days come from
  // airplanes.live's history (a year of it) - only for the aircraft being looked at, never for background logs
  const LOL_DAYS = 40;
  // an aircraft FR24 lists itself shows a free account one week of its log: this much more is rebuilt under FR24's rows
  const OLDER_DAYS = 90;
  // the part of the log the destination engine reasons over (22.10: all of it - its history evidence counts older flights
  // for less, so a long log sharpens the picture without its old routine outweighing what the aircraft does now)
  const ENGINE_HIST_DAYS = 220;
  const MAX_TARGET_ATTEMPTS = 8;
  const LIST_REFRESH_MS = 75000;        // global LADD / military list refresh
  const WORLD_SCAN_INTERVAL_MS = 180000; // background world scan for new callsign-less flights
  const TELEMETRY_MS = 2000;            // live ADS-B telemetry poll for the selected aircraft (each aggregator every 4 s)
  const PHOTO_V = 10;                   // photo-pipeline version; a bump re-ranks photos cached by an older one (5: JetPhotos through FR24's own lookup; 10: FR24's aircraft page and JetPhotos itself where FR24's lookup holds none back)
  // Every saved flight log deleted, once, the first time a version with this reset id runs in a browser (and when asked from
  // the LADD Unblock window): the logs, today's tracks and each aircraft's compact recent flights - nothing else; what was
  // learned (the self-learning tables), boards and identities stay. They are built again as aircraft are looked at.
  const LOG_RESET = '22.31.9', LOG_RESET_KEY = 'tweeks.fr24.ladd.logreset';
  const HIST_V = 8;                     // flight-log reconstruction version; a bump rebuilds cached logs from scratch (5: each flight's path, for matching its own routes; 6: every day from both networks, a day done only once each network asked has answered; 7: each network's answer read for what it is - a verification page never a day without flights - and the monitor's days from adsb.lol's archives; 8: the monitor's days with the flights it heard live that the archive lacks, and each flight's ends' climb / descent)
  const PRECOMPUTE_MAX = 8;
  // landing places learned away from FR24's airports (03-data): their ids, below the route engine's unlisted fields (1e7 on)
  const SITE_BASE = 9000000, isSiteId = id => id > SITE_BASE && id < 1e7;             // in-view aircraft whose full route (trace + plan) is prepared before a click

  const SEL = {
    panel: '[data-testid="aircraft-panel"]',
    header: '[data-testid="aircraft-panel__header"]',
    callsign: '[data-testid="aircraft-panel__header__callsign"]',
    model: '[data-testid="aircraft-panel__header__model"]',
    airline: '[data-testid="aircraft-panel__header__airline-name"]',
    registration: '[data-testid="aircraft-panel__registration"]',
    hex: '[data-testid="aircraft-panel__hex"]',
    squawk: '[data-testid="aircraft-panel__squawk"]',
    msn: '[data-testid="aircraft-panel__msn"]',
    age: '[data-testid="aircraft-panel__age"]',
    lat: '[data-testid="aircraft-panel__lat"]',
    lon: '[data-testid="aircraft-panel__lng"]',
    alt: '[data-testid="aircraft-panel__calibrated-altitude"]',
    vs: '[data-testid="aircraft-panel__vertical-speed"]',
    track: '[data-testid="aircraft-panel__track"]',
    gs: '[data-testid="aircraft-panel__ground-speed"]',
    image: '[data-testid="aircraft-panel__image"]',
    fallbackImg: '[data-testid="aircraft-panel__image__fallback__image"]',
    depIata: '[data-testid="aircraft-panel__airport-departure-iata"]',
    arrIata: '[data-testid="aircraft-panel__airport-arrival-iata"]'
  };
  const NA = /^(?:N\/?A|--|-|NOT AVAILABLE|UNKNOWN)?$/i;

  const log = (...a) => { try { console.debug('[LADD]', ...a); } catch (_) { /* ignore */ } };
  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  // JetPhotos' "â€¦cb" sizes carry a copyright bar burnt into the bottom of the picture; the same size without "cb" is the
  // clean photo - what FR24 itself shows (its code strips the "cb"), with the photographer credited as text instead.
  const noBar = u => typeof u === 'string' ? u.replace(/(\/\/cdn\.jetphotos\.com\/\d+)cb\//i, '$1/') : u;
  // airport-data.com pictures (what FR24 and other databases fall back to): never kept or shown, whatever they are labelled
  // (nor FR24's stock picture of the type, credited to Flightradar24 itself with no JetPhotos page - a picture of another
  // aircraft; kept before as a blocked aircraft's own and shown, it is dropped wherever it was kept)
  const adPhoto = p => !!p && (/^(airport-data|hexdb\.io)$/.test(p.source || '') || [p.large, p.medium, p.thumb, p.link, p.credit].some(v => typeof v === 'string' && /airport-data/i.test(v)) ||
    (/^\W*flightradar\s*24\W*$/i.test(p.credit || '') && ![p.large, p.medium, p.thumb, p.link].some(v => typeof v === 'string' && /jetphotos/i.test(v))));
  // the same picture in another size or from another list: its file name without the size suffix
  const shotKey = p => String((p && (p.large || p.medium || p.thumb)) || '').split('/').pop().replace(/\?.*$/, '').replace(/\.[a-z]+$/i, '').replace(/_(?:t|tb|\d{3,4})$/i, '');
  const goodPhotos = l => (Array.isArray(l) ? l : []).filter(p => p && !adPhoto(p));
  const cleanPhoto = p => p && typeof p === 'object' ? Object.assign({}, p, { large: noBar(p.large), medium: noBar(p.medium), thumb: noBar(p.thumb) }) : p;
  // Registry names as a person would write them: HTML entities decoded ("&amp;" -> "&"), registry placeholders dropped
  // ("REGISTRATION PENDING", "SALE REPORTED"...), and ALL-CAPS turned into normal capitalisation with company forms
  // and acronyms kept right: "JOHNSON &amp; JOHNSON FINANCE CORP" -> "Johnson & Johnson Finance Corp",
  // "SMR-AIR LLC" -> "SMR-Air LLC", "BANK OF UTAH TRUSTEE" -> "Bank of Utah Trustee". Mixed-case input is kept as is.
  const decodeEntities = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return isFinite(n) && n > 0 ? String.fromCodePoint(n) : m; }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[k] || m;
  });
  // (the aircraft registers, read as the monitor reads them - src/registry.js - through this script's requests)
  const REG = createRegistry((url, o) => gmRequest(url, o), { log: (...a) => log(...a) });
  const NAME_PLACEHOLDER = REG.NAME_PLACEHOLDER;
  const STICKY_FLAGS = new Set(['ladd', 'pia', 'mil', 'fr24Blocked']);
  const NAME_UPPER = new Set(['LLC', 'LLP', 'LP', 'PLC', 'USA', 'US', 'UK', 'UAE', 'AG', 'SA', 'NV', 'BV', 'SPA', 'SRL', 'SARL', 'SAS', 'AB', 'AS', 'ASA', 'OY', 'KG', 'II', 'III', 'IV', 'VI', 'DBA', 'FBO', 'MRO', 'NA', 'JSC', 'PJSC', 'LTDA', 'CV', 'SE', 'PC', 'PA', 'NJ', 'NY', 'FL', 'TX', 'CA', 'DC', 'IBM', 'FAA', 'RAF', 'NASA']);
  const NAME_FIXED = { INC: 'Inc', CORP: 'Corp', LTD: 'Ltd', CO: 'Co', GMBH: 'GmbH', INTL: 'Intl', MGMT: 'Mgmt', SVCS: 'Svcs', SVC: 'Svc', ASSN: 'Assn', BROS: 'Bros', DEPT: 'Dept', HLDGS: 'Hldgs', HOLDINGS: 'Holdings', TR: 'Tr', TRS: 'Trs', TRUSTEE: 'Trustee', MC: 'Mc', ST: 'St', MR: 'Mr', MRS: 'Mrs', DR: 'Dr', JR: 'Jr', SR: 'Sr', MT: 'Mt', FT: 'Ft', MFG: 'Mfg', PTY: 'Pty', PTE: 'Pte', CTR: 'Ctr' };
  const NAME_SMALL = new Set(['of', 'and', 'the', 'for', 'in', 'on', 'at', 'by', 'to', 'de', 'la', 'le', 'du', 'des', 'von', 'van', 'der', 'den', 'del', 'da', 'di', 'y', 'e']);
  function nameWord(w, first) {
    if (!/[A-Z]/.test(w)) return w;
    if (/\d/.test(w)) return /^\d+(ST|ND|RD|TH)$/.test(w) ? w.toLowerCase() : w;               // "3RD" -> "3rd"; "N472R" kept
    if (NAME_UPPER.has(w)) return w;
    if (NAME_FIXED[w]) return NAME_FIXED[w];
    const lw = w.toLowerCase();
    if (!first && NAME_SMALL.has(lw)) return lw;
    if (w.length <= 4 && !/[AEIOUY]/.test(w)) return w;                                         // an acronym: SMR, JPM, BRK
    if (/^MC[A-Z]{2,}/.test(w)) return 'Mc' + w[2] + w.slice(3).toLowerCase();                 // McDonald
    if (/^O'[A-Z]/.test(w)) return "O'" + w[2] + w.slice(3).toLowerCase();                     // O'Neil
    return w[0] + w.slice(1).toLowerCase();
  }
  // The legal form is not part of the name people know: "BALLYCASTLE AVIATION LIMITED PARTNERSHIP INCORPORATED" is
  // Ballycastle Aviation, "Pad Aviation Service GmbH" is Pad Aviation Service, "756J LLC" is 756J (taken off the end,
  // repeatedly; a name that would be nothing without it - "LLC" alone - is kept whole). A company of one of Dubai's free
  // zones carries the zone in its form: "MAPA AVIATION DWC-LLC" is Mapa Aviation (Dubai World Central), as are FZE, FZCO,
  // FZ-LLC and DMCC ones.
  const LEGAL_FORM = /[\s,]+(dwc(\s*-\s*|\s+)?l\.?\s?l\.?\s?c\.?|dwc|fz\s*-?\s*l\.?\s?l\.?\s?c\.?|fz\s*-?\s*co|fz\s*-?\s*e|fzc|dmcc|limited\s+liability\s+(company|partnership)|limited\s+partnership|l\.?\s?l\.?\s?[cp]\.?|l\.?\s?p\.?|ltd\.?|limited|unlimited|inc\.?|incorporated|corp\.?|corporation|co\.?|company|plc|ulc|dac|gmbh(\s*(&|and)\s*co\.?\s*kg)?|(&|and)\s*co\.?\s*kg|kg|ag|s\.?\s?a\.?\s?(de\s+c\.?\s?v\.?|s\.?|r\.?\s?l\.?)?|s\.?\s?r\.?\s?[lo]\.?|s\.?\s?p\.?\s?a\.?|b\.?\s?v\.?|n\.?\s?v\.?|oy|ab|asa|aps|a\/s|pty\.?(\s+ltd\.?)?|pte\.?(\s+ltd\.?)?|sdn\.?\s+bhd\.?|bhd\.?|jsc|pjsc|ojsc|cjsc|ltda\.?|lda\.?|kft\.?|zrt\.?|sp\.?\s*z\s*o\.?\s*o\.?|d\.?\s?o\.?\s?o\.?|ehf\.?|e\.?\s?v\.?|m\.?\s?b\.?\s?h\.?)\s*[.,]?\s*$/i;
  function withoutLegalForm(s) {
    // (a name in brackets after the legal form is a trading or former name: "PAL Aerospace Ltd (Provincial Aerospace)"
    // is PAL Aerospace - while "Gama Aviation (UK) Limited" keeps its own brackets)
    const alias = s.match(/^(.*\S)\s*\([^()]*\)\s*\.?$/);
    if (alias && LEGAL_FORM.test(alias[1])) s = alias[1];
    for (let i = 0; i < 4; i++) { const t = s.replace(LEGAL_FORM, '').replace(/[\s,&-]+$/, ''); if (t === s || !/[A-Za-z0-9]{2}/.test(t)) break; s = t; }
    return s;
  }
  // A trust company holding the registration for an owner who stays unnamed (the FAA register's "TVPX AIRCRAFT SOLUTIONS
  // INC TRUSTEE", "WELLS FARGO TRUST CO NA TRUSTEE", "BANK OF UTAH TRUSTEE"...): no one's name - the operator it flies for
  // is shown instead (N67WV: Solairus Aviation)
  const TRUSTEE = /\b(owner\s+)?(trustees?|trste|trst)\s*\.?$|^(tvpx|wells\s+fargo\s+(trust|bank\s+northwest)|bank\s+of\s+utah|wilmington\s+trust|umb\s+bank|aircraft\s+guaranty|u\.?\s?s\.?\s+bank\s+trust|delaware\s+trust|first\s+security\s+bank|bny\s+mellon\s+trust)\b/i;
  const isTrustee = raw => TRUSTEE.test(clean(decodeEntities(raw)));
  // (two capitals that are no word - "AC EXECUTIVE AIRCRAFT" is AC Executive Aircraft, not "Ac")
  const NAME_TWO = new Set(['AL', 'ED', 'JO', 'BO', 'LI', 'LU', 'MA', 'WU', 'DE', 'LA', 'LE', 'DA', 'DI', 'DU', 'DO', 'EL', 'OF', 'TO', 'IN', 'ON', 'AT', 'BY', 'OR', 'AN', 'AS', 'IS', 'IT', 'NO', 'SO', 'UP', 'WE', 'GO', 'MY', 'HE', 'ME', 'BE', 'IF', 'OX', 'OK', 'YE', 'YO', 'NE', 'SI', 'OU', 'ET', 'EN', 'IL']);
  function ownerName(raw) {
    let s = clean(decodeEntities(raw)).replace(/^applicant\s+/i, '');
    if (!s || NAME_PLACEHOLDER.test(s) || TRUSTEE.test(s)) return '';
    // (what is in brackets - a jurisdiction, a year telling successor companies apart, a trading or former name - is not
    // the name people know: "Arthur J Gallagher (Illinois)", "AC Executive Aircraft (2025)", "Gama Aviation (UK)"; a name
    // that would be nothing without it keeps it)
    s = withoutLegalForm(s);
    { const unb = s.replace(/\s*\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim(); if (/[A-Za-z]{2}/.test(withoutLegalForm(unb))) s = withoutLegalForm(unb); }
    if (/[a-z]/.test(s)) return s;                                                               // already written properly
    let first = true;
    const words = s.split(/\s+/).length;
    // (a short compound like AT&T or B&H stays as written)
    return s.split(/(\s+)/).map(chunk => /^[A-Z]{1,3}&[A-Z]{1,3}$/.test(chunk) ? (first = false, chunk) : chunk.split(/([\-\/&,.()]+)/).map(part => { if (!/[A-Z0-9]/.test(part)) return part; const out = words > 1 && /^[A-Z]{2}$/.test(part) && !NAME_TWO.has(part) && !NAME_FIXED[part] ? part : nameWord(part, first); first = false; return out; }).join('')).join('');
  }
  // "LIBERTYVILLE, ILLINOIS" -> "Libertyville, Illinois" (state / country abbreviations kept)
  const placeName = raw => { const s = clean(decodeEntities(raw)); return /[a-z]/.test(s) ? s : s.split(/([\s\-,.()]+)/).map(p => NAME_FIXED[p] ? NAME_FIXED[p] : /^[A-Z]{2,3}$/.test(p) && (NAME_UPPER.has(p) || p.length === 2) ? p : p ? nameWord(p, true) : p).join(''); };
  // (a name as a key: "BAE SYSTEMS (OPERATIONS) LIMITED", "BAe Systems" alike)
  const nameKey = n => String(ownerName(n) || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isNA = v => NA.test(clean(v));
  const num = v => { const m = clean(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
  const fin = v => typeof v === 'number' && isFinite(v);
  const now = () => Date.now();
  const nowS = () => Math.floor(Date.now() / 1000);
  // (the end of a UTC day 'YYYY/MM/DD', seconds - or now, for today: what that day's trace can have heard up to)
  const dayEndS = day => Math.min(Date.now() / 1000, Date.parse(String(day).replace(/\//g, '-') + 'T00:00:00Z') / 1000 + 86400);
  const dayStr = t => { const d = new Date(t); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };
  const hhmmZ = t => t > 0 ? new Date(t * 1000).toISOString().slice(11, 16) + 'Z' : '';
  const isAircraftPage = /^\/data\/aircraft\/[^/]+/i.test(location.pathname);
  const isFlightPage = /^\/data\/flights\/[^/]+/i.test(location.pathname);
  // (FR24's other data pages - an airport's, its boards, routes, statistics: no map, so none of the map's work)
  const isDataPage = /^\/data\//i.test(location.pathname) && !isAircraftPage && !isFlightPage;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // A part of the page brought up to new HTML by changing only what differs, not drawn afresh: its elements stay, so a
  // switch moves as it is turned (a new one would just appear turned), a spinner keeps turning, a field keeps what is
  // being typed in it, and a tooltip being read stays up - the title of an element under the mouse is left as it is
  // until the mouse leaves (the destination's reasons went every time the panel was updated, a few times a second).
  function morphHtml(el, html) {
    const t = document.createElement('template'); t.innerHTML = html;
    morphKids(el, t.content);
  }
  function morphKids(a, b) {
    const an = [...a.childNodes], bn = [...b.childNodes];
    for (let i = 0; i < bn.length; i++) {
      const x = an[i], y = bn[i];
      if (!x) { a.appendChild(y); continue; }
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.nodeType === 1 && x.id !== y.id)) { a.replaceChild(y, x); continue; }
      if (x.nodeType !== 1) { if (x.data !== y.data) x.data = y.data; continue; }
      let hover = false; try { hover = x.matches(':hover'); } catch (e) { /* no :hover here */ }
      for (const n of x.getAttributeNames()) if (!y.hasAttribute(n) && !(hover && n === 'title')) x.removeAttribute(n);
      for (const n of y.getAttributeNames()) { const v = y.getAttribute(n); if (x.getAttribute(n) !== v && !(hover && n === 'title')) x.setAttribute(n, v); }
      morphKids(x, y);
    }
    for (let i = an.length - 1; i >= bn.length; i--) an[i].remove();
  }

  // ---- staying out of the map's way ----------------------------------------------------------------------------------
  // Background work - routes for every identified aircraft, the boards' predictions, other aircraft's logs and tracks -
  // runs in slices of a few milliseconds in the browser's idle time, and not at all while the map is being dragged,
  // zoomed or scrolled: FR24 needs every frame then. (22.10.3 worked through hundreds of aircraft in one go: the map
  // froze for a second and a half when the world scan came in, and stuttered every three seconds after.) What the user
  // has open - the selected aircraft, its panel - never waits for this.
  let lastInteract = 0, pointerIsDown = false;
  {
    const opt = { capture: true, passive: true }, mark = () => { lastInteract = Date.now(); };
    try {
      for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown']) document.addEventListener(ev, mark, opt);
      document.addEventListener('pointerdown', () => { pointerIsDown = true; mark(); }, opt);
      for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { pointerIsDown = false; mark(); }, opt);
      document.addEventListener('pointermove', e => { if (e.buttons) mark(); }, opt);
      window.addEventListener('blur', () => { pointerIsDown = false; }, opt);
    } catch (e) { /* no document yet: nothing to stay out of the way of */ }
  }
  const userBusy = () => (pointerIsDown && Date.now() - lastInteract < 10000) || Date.now() - lastInteract < 700;
  const onIdle = typeof requestIdleCallback === 'function' ? cb => requestIdleCallback(cb, { timeout: 1000 }) : cb => setTimeout(cb, 25);
  const perfNow = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();
  // waits for an idle moment with the map left alone; returns over() - true once `ms` of this slice are used
  async function idleSlice(ms = 8) {
    for (let n = 0; ; n++) {
      while (userBusy()) await sleep(200);
      await new Promise(r => onIdle(r));
      if (!userBusy()) break;
    }
    const end = perfNow() + ms; return () => perfNow() > end;
  }
  // a run of small jobs, a slice at a time: work(item) for each, until done or `maxMs` of slices have been spent
  async function sliced(items, work, { ms = 8, maxMs = Infinity } = {}) {
    let over = await idleSlice(ms), spent = 0, t = perfNow(), k = 0;
    for (; k < items.length; k++) {
      if (over()) { spent += perfNow() - t; if (spent >= maxMs) break; over = await idleSlice(ms); t = perfNow(); }
      try { await work(items[k], k); } catch (e) { log('background', e); }
    }
    return k;
  }

  const ENGINE = createRouteEngine();
  const dist = ENGINE.dist, angDiff = ENGINE.angDiff;
  function project(lat, lon, gsKt, trk, seconds) {
    if (!(seconds > 0) || !(gsKt > 0) || !fin(trk)) return [lat, lon];
    return ENGINE.destPoint(lat, lon, trk, gsKt * NM_KM * seconds / 3600);
  }

  // ---- country of registration from the ICAO 24-bit address block (ICAO Annex 10 allocation) -------------------
  // Instant and offline: every aircraft gets its country without a single request.
  const HEX_BLOCKS = [
    [0x004000, 0x0043FF, 'Zimbabwe', 'ZW'], [0x006000, 0x006FFF, 'Mozambique', 'MZ'], [0x008000, 0x00FFFF, 'South Africa', 'ZA'], [0x010000, 0x017FFF, 'Egypt', 'EG'], [0x018000, 0x01FFFF, 'Libya', 'LY'], [0x020000, 0x027FFF, 'Morocco', 'MA'], [0x028000, 0x02FFFF, 'Tunisia', 'TN'], [0x030000, 0x0303FF, 'Botswana', 'BW'], [0x032000, 0x032FFF, 'Burundi', 'BI'], [0x034000, 0x034FFF, 'Cameroon', 'CM'], [0x038000, 0x038FFF, 'Congo', 'CG'], [0x03E000, 0x03EFFF, 'Gabon', 'GA'], [0x040000, 0x040FFF, 'Ethiopia', 'ET'], [0x044000, 0x044FFF, 'Ghana', 'GH'], [0x04C000, 0x04CFFF, 'Kenya', 'KE'], [0x050000, 0x050FFF, 'Liberia', 'LR'], [0x054000, 0x054FFF, 'Madagascar', 'MG'], [0x058000, 0x058FFF, 'Malawi', 'MW'], [0x05C000, 0x05CFFF, 'Mali', 'ML'], [0x060000, 0x0603FF, 'Mauritania', 'MR'], [0x062000, 0x062FFF, 'Niger', 'NE'], [0x064000, 0x064FFF, 'Nigeria', 'NG'], [0x068000, 0x068FFF, 'Uganda', 'UG'], [0x06A000, 0x06A3FF, 'Qatar', 'QA'], [0x06C000, 0x06CFFF, 'Central African Republic', 'CF'], [0x06E000, 0x06EFFF, 'Rwanda', 'RW'], [0x070000, 0x070FFF, 'Senegal', 'SN'], [0x074000, 0x0743FF, 'Seychelles', 'SC'], [0x078000, 0x078FFF, 'Somalia', 'SO'], [0x07C000, 0x07CFFF, 'Sudan', 'SD'], [0x080000, 0x080FFF, 'Tanzania', 'TZ'], [0x084000, 0x084FFF, 'Chad', 'TD'], [0x088000, 0x088FFF, 'Togo', 'TG'], [0x08A000, 0x08AFFF, 'Zambia', 'ZM'], [0x08C000, 0x08CFFF, 'DR Congo', 'CD'], [0x090000, 0x090FFF, 'Angola', 'AO'], [0x094000, 0x0943FF, 'Benin', 'BJ'], [0x096000, 0x0963FF, 'Cape Verde', 'CV'], [0x098000, 0x0983FF, 'Djibouti', 'DJ'], [0x09A000, 0x09AFFF, 'Gambia', 'GM'], [0x09C000, 0x09CFFF, 'Burkina Faso', 'BF'], [0x0A0000, 0x0A7FFF, 'Algeria', 'DZ'], [0x0A8000, 0x0A8FFF, 'Bahamas', 'BS'], [0x0AA000, 0x0AA3FF, 'Barbados', 'BB'], [0x0AB000, 0x0AB3FF, 'Belize', 'BZ'], [0x0AC000, 0x0ACFFF, 'Colombia', 'CO'], [0x0AE000, 0x0AEFFF, 'Costa Rica', 'CR'], [0x0B0000, 0x0B0FFF, 'Cuba', 'CU'], [0x0B2000, 0x0B2FFF, 'El Salvador', 'SV'], [0x0B4000, 0x0B4FFF, 'Guatemala', 'GT'], [0x0B6000, 0x0B6FFF, 'Guyana', 'GY'], [0x0B8000, 0x0B8FFF, 'Haiti', 'HT'], [0x0BA000, 0x0BAFFF, 'Honduras', 'HN'], [0x0BE000, 0x0BEFFF, 'Jamaica', 'JM'], [0x0C0000, 0x0C0FFF, 'Nicaragua', 'NI'], [0x0C2000, 0x0C2FFF, 'Panama', 'PA'], [0x0C4000, 0x0C4FFF, 'Dominican Republic', 'DO'], [0x0C6000, 0x0C6FFF, 'Trinidad and Tobago', 'TT'], [0x0C8000, 0x0C8FFF, 'Suriname', 'SR'], [0x0CA000, 0x0CA3FF, 'Antigua and Barbuda', 'AG'], [0x0CC000, 0x0CC3FF, 'Grenada', 'GD'], [0x0D0000, 0x0D7FFF, 'Mexico', 'MX'], [0x0D8000, 0x0DFFFF, 'Venezuela', 'VE'],
    [0x100000, 0x1FFFFF, 'Russia', 'RU'], [0x201000, 0x2013FF, 'Namibia', 'NA'], [0x202000, 0x2023FF, 'Eritrea', 'ER'], [0x300000, 0x33FFFF, 'Italy', 'IT'], [0x340000, 0x37FFFF, 'Spain', 'ES'], [0x380000, 0x3BFFFF, 'France', 'FR'], [0x3C0000, 0x3FFFFF, 'Germany', 'DE'], [0x400000, 0x43FFFF, 'United Kingdom', 'GB'], [0x440000, 0x447FFF, 'Austria', 'AT'], [0x448000, 0x44FFFF, 'Belgium', 'BE'], [0x450000, 0x457FFF, 'Bulgaria', 'BG'], [0x458000, 0x45FFFF, 'Denmark', 'DK'], [0x460000, 0x467FFF, 'Finland', 'FI'], [0x468000, 0x46FFFF, 'Greece', 'GR'], [0x470000, 0x477FFF, 'Hungary', 'HU'], [0x478000, 0x47FFFF, 'Norway', 'NO'], [0x480000, 0x487FFF, 'Netherlands', 'NL'], [0x488000, 0x48FFFF, 'Poland', 'PL'], [0x490000, 0x497FFF, 'Portugal', 'PT'], [0x498000, 0x49FFFF, 'Czech Republic', 'CZ'], [0x4A0000, 0x4A7FFF, 'Romania', 'RO'], [0x4A8000, 0x4AFFFF, 'Sweden', 'SE'], [0x4B0000, 0x4B7FFF, 'Switzerland', 'CH'], [0x4B8000, 0x4BFFFF, 'Turkey', 'TR'], [0x4C0000, 0x4C7FFF, 'Serbia', 'RS'], [0x4C8000, 0x4C83FF, 'Cyprus', 'CY'], [0x4CA000, 0x4CAFFF, 'Ireland', 'IE'], [0x4CC000, 0x4CCFFF, 'Iceland', 'IS'], [0x4D0000, 0x4D03FF, 'Luxembourg', 'LU'], [0x4D2000, 0x4D23FF, 'Malta', 'MT'], [0x4D4000, 0x4D43FF, 'Monaco', 'MC'], [0x500000, 0x5003FF, 'San Marino', 'SM'], [0x501000, 0x5013FF, 'Albania', 'AL'], [0x501C00, 0x501FFF, 'Croatia', 'HR'], [0x502C00, 0x502FFF, 'Latvia', 'LV'], [0x503C00, 0x503FFF, 'Lithuania', 'LT'], [0x504C00, 0x504FFF, 'Moldova', 'MD'], [0x505C00, 0x505FFF, 'Slovakia', 'SK'], [0x506C00, 0x506FFF, 'Slovenia', 'SI'], [0x507C00, 0x507FFF, 'Uzbekistan', 'UZ'], [0x508000, 0x50FFFF, 'Ukraine', 'UA'], [0x510000, 0x5103FF, 'Belarus', 'BY'], [0x511000, 0x5113FF, 'Estonia', 'EE'], [0x512000, 0x5123FF, 'North Macedonia', 'MK'], [0x513000, 0x5133FF, 'Bosnia and Herzegovina', 'BA'], [0x514000, 0x5143FF, 'Georgia', 'GE'], [0x515000, 0x5153FF, 'Tajikistan', 'TJ'], [0x516000, 0x5163FF, 'Montenegro', 'ME'],
    [0x600000, 0x6003FF, 'Armenia', 'AM'], [0x600800, 0x600BFF, 'Azerbaijan', 'AZ'], [0x601000, 0x6013FF, 'Kyrgyzstan', 'KG'], [0x601800, 0x601BFF, 'Turkmenistan', 'TM'], [0x680000, 0x6803FF, 'Bhutan', 'BT'], [0x681000, 0x6813FF, 'Micronesia', 'FM'], [0x682000, 0x6823FF, 'Mongolia', 'MN'], [0x683000, 0x6833FF, 'Kazakhstan', 'KZ'], [0x684000, 0x6843FF, 'Palau', 'PW'], [0x700000, 0x700FFF, 'Afghanistan', 'AF'], [0x702000, 0x702FFF, 'Bangladesh', 'BD'], [0x704000, 0x704FFF, 'Myanmar', 'MM'], [0x706000, 0x706FFF, 'Kuwait', 'KW'], [0x708000, 0x708FFF, 'Laos', 'LA'], [0x70A000, 0x70AFFF, 'Nepal', 'NP'], [0x70C000, 0x70C3FF, 'Oman', 'OM'], [0x70E000, 0x70EFFF, 'Cambodia', 'KH'], [0x710000, 0x717FFF, 'Saudi Arabia', 'SA'], [0x718000, 0x71FFFF, 'South Korea', 'KR'], [0x720000, 0x727FFF, 'North Korea', 'KP'], [0x728000, 0x72FFFF, 'Iraq', 'IQ'], [0x730000, 0x737FFF, 'Iran', 'IR'], [0x738000, 0x73FFFF, 'Israel', 'IL'], [0x740000, 0x747FFF, 'Jordan', 'JO'], [0x748000, 0x74FFFF, 'Lebanon', 'LB'], [0x750000, 0x757FFF, 'Malaysia', 'MY'], [0x758000, 0x75FFFF, 'Philippines', 'PH'], [0x760000, 0x767FFF, 'Pakistan', 'PK'], [0x768000, 0x76FFFF, 'Singapore', 'SG'], [0x770000, 0x777FFF, 'Sri Lanka', 'LK'], [0x778000, 0x77FFFF, 'Syria', 'SY'], [0x780000, 0x7BFFFF, 'China', 'CN'], [0x7C0000, 0x7FFFFF, 'Australia', 'AU'], [0x800000, 0x83FFFF, 'India', 'IN'], [0x840000, 0x87FFFF, 'Japan', 'JP'], [0x880000, 0x887FFF, 'Thailand', 'TH'], [0x888000, 0x88FFFF, 'Vietnam', 'VN'], [0x890000, 0x890FFF, 'Yemen', 'YE'], [0x894000, 0x894FFF, 'Bahrain', 'BH'], [0x895000, 0x8953FF, 'Brunei', 'BN'], [0x896000, 0x896FFF, 'United Arab Emirates', 'AE'], [0x897000, 0x8973FF, 'Solomon Islands', 'SB'], [0x898000, 0x898FFF, 'Papua New Guinea', 'PG'], [0x899000, 0x8993FF, 'Taiwan', 'TW'], [0x8A0000, 0x8A7FFF, 'Indonesia', 'ID'],
    [0x900000, 0x9003FF, 'Marshall Islands', 'MH'], [0x901000, 0x9013FF, 'Cook Islands', 'CK'], [0x902000, 0x9023FF, 'Samoa', 'WS'], [0xA00000, 0xAFFFFF, 'United States', 'US'], [0xC00000, 0xC3FFFF, 'Canada', 'CA'], [0xC80000, 0xC87FFF, 'New Zealand', 'NZ'], [0xC88000, 0xC88FFF, 'Fiji', 'FJ'], [0xC8A000, 0xC8A3FF, 'Nauru', 'NR'], [0xC8C000, 0xC8C3FF, 'Saint Lucia', 'LC'], [0xC8D000, 0xC8D3FF, 'Tonga', 'TO'], [0xC8E000, 0xC8E3FF, 'Kiribati', 'KI'], [0xC90000, 0xC903FF, 'Vanuatu', 'VU'], [0xE00000, 0xE3FFFF, 'Argentina', 'AR'], [0xE40000, 0xE7FFFF, 'Brazil', 'BR'], [0xE80000, 0xE80FFF, 'Chile', 'CL'], [0xE84000, 0xE84FFF, 'Ecuador', 'EC'], [0xE88000, 0xE88FFF, 'Paraguay', 'PY'], [0xE8C000, 0xE8CFFF, 'Peru', 'PE'], [0xE90000, 0xE90FFF, 'Uruguay', 'UY'], [0xE94000, 0xE94FFF, 'Bolivia', 'BO'], [0xF00000, 0xF07FFF, 'ICAO (temporary)', ''], [0xF09000, 0xF093FF, 'ICAO (special)', '']
  ];
  // Territories register aircraft under their own prefix but take transponder addresses from the parent state's block:
  // an Isle of Man "M-" aircraft (M-ARNZ, 424C60) is not UK-registered. The registration decides when it says.
  const REG_COUNTRY = [['M-', 'Isle of Man', 'IM'], ['2-', 'Guernsey', 'GG'], ['ZJ-', 'Jersey', 'JE'], ['VP-B', 'Bermuda', 'BM'], ['VQ-B', 'Bermuda', 'BM'], ['VP-C', 'Cayman Islands', 'KY'], ['VP-A', 'Anguilla', 'AI'], ['VP-L', 'British Virgin Islands', 'VG'], ['VP-M', 'Montserrat', 'MS'], ['VP-F', 'Falkland Islands', 'FK'], ['VQ-T', 'Turks and Caicos Islands', 'TC'], ['VQ-H', 'Saint Helena', 'SH'], ['VP-G', 'Gibraltar', 'GI']];
  // Every state's nationality mark (ICAO Annex 7) - the registration says the country where the transponder block does
  // not (T7-AFP, San Marino, wears 50043E, just past San Marino's block). China's "B-" is left to the address: Taiwan
  // registers under B- too (Hong Kong B-H, Macau B-M are certain).
  const REG_NATIONAL = ('C-:Canada:CA,CF-:Canada:CA,XA-:Mexico:MX,XB-:Mexico:MX,XC-:Mexico:MX,G-:United Kingdom:GB,EI-:Ireland:IE,EJ-:Ireland:IE,' +
    'F-:France:FR,D-:Germany:DE,OE-:Austria:AT,HB-:Switzerland:CH,I-:Italy:IT,EC-:Spain:ES,EM-:Spain:ES,CS-:Portugal:PT,CR-:Portugal:PT,PH-:Netherlands:NL,' +
    'OO-:Belgium:BE,LX-:Luxembourg:LU,OY-:Denmark:DK,LN-:Norway:NO,SE-:Sweden:SE,OH-:Finland:FI,TF-:Iceland:IS,SP-:Poland:PL,SN-:Poland:PL,OK-:Czechia:CZ,' +
    'OM-:Slovakia:SK,HA-:Hungary:HU,YR-:Romania:RO,LZ-:Bulgaria:BG,SX-:Greece:GR,9H-:Malta:MT,5B-:Cyprus:CY,TC-:Turkey:TR,S5-:Slovenia:SI,9A-:Croatia:HR,' +
    'YU-:Serbia:RS,E7-:Bosnia And Herzegovina:BA,4O-:Montenegro:ME,Z3-:North Macedonia:MK,ZA-:Albania:AL,Z6-:Kosovo:XK,ER-:Moldova:MD,UR-:Ukraine:UA,' +
    'EW-:Belarus:BY,RA-:Russia:RU,RF-:Russia:RU,LY-:Lithuania:LT,YL-:Latvia:LV,ES-:Estonia:EE,4L-:Georgia:GE,EK-:Armenia:AM,4K-:Azerbaijan:AZ,' +
    'UP-:Kazakhstan:KZ,UK-:Uzbekistan:UZ,EX-:Kyrgyzstan:KG,EY-:Tajikistan:TJ,EZ-:Turkmenistan:TM,T7-:San Marino:SM,3A-:Monaco:MC,C3-:Andorra:AD,' +
    '4X-:Israel:IL,JY-:Jordan:JO,OD-:Lebanon:LB,YK-:Syria:SY,YI-:Iraq:IQ,EP-:Iran:IR,HZ-:Saudi Arabia:SA,A6-:United Arab Emirates:AE,A7-:Qatar:QA,' +
    'A9C-:Bahrain:BH,A4O-:Oman:OM,9K-:Kuwait:KW,7O-:Yemen:YE,SU-:Egypt:EG,5A-:Libya:LY,TS-:Tunisia:TN,7T-:Algeria:DZ,CN-:Morocco:MA,ST-:Sudan:SD,' +
    'ET-:Ethiopia:ET,5Y-:Kenya:KE,5H-:Tanzania:TZ,5X-:Uganda:UG,9XR-:Rwanda:RW,5N-:Nigeria:NG,9G-:Ghana:GH,6V-:Senegal:SN,TU-:Ivory Coast:CI,' +
    'TJ-:Cameroon:CM,TR-:Gabon:GA,D2-:Angola:AO,ZS-:South Africa:ZA,ZT-:South Africa:ZA,ZU-:South Africa:ZA,V5-:Namibia:NA,A2-:Botswana:BW,' +
    'Z-:Zimbabwe:ZW,9J-:Zambia:ZM,C9-:Mozambique:MZ,5R-:Madagascar:MG,3B-:Mauritius:MU,S7-:Seychelles:SC,D4-:Cape Verde:CV,9S-:Democratic Republic Of The Congo:CD,' +
    '9Q-:Democratic Republic Of The Congo:CD,TN-:Congo:CG,TZ-:Mali:ML,5U-:Niger:NE,TT-:Chad:TD,XT-:Burkina Faso:BF,TY-:Benin:BJ,5V-:Togo:TG,3X-:Guinea:GN,9L-:Sierra Leone:SL,' +
    'A8-:Liberia:LR,5T-:Mauritania:MR,J2-:Djibouti:DJ,6O-:Somalia:SO,E3-:Eritrea:ER,7Q-:Malawi:MW,7P-:Lesotho:LS,3D-:Eswatini:SZ,3C-:Equatorial Guinea:GQ,' +
    'C5-:Gambia:GM,VT-:India:IN,AP-:Pakistan:PK,S2-:Bangladesh:BD,4R-:Sri Lanka:LK,9N-:Nepal:NP,A5-:Bhutan:BT,8Q-:Maldives:MV,YA-:Afghanistan:AF,' +
    'B-H:Hong Kong:HK,B-M:Macau:MO,JA:Japan:JP,HL:South Korea:KR,JU-:Mongolia:MN,RP-:Philippines:PH,VN-:Vietnam:VN,HS-:Thailand:TH,9M-:Malaysia:MY,' +
    '9V-:Singapore:SG,PK-:Indonesia:ID,V8-:Brunei:BN,XU-:Cambodia:KH,RDPL-:Laos:LA,XY-:Myanmar (Burma):MM,XZ-:Myanmar (Burma):MM,VH-:Australia:AU,ZK-:New Zealand:NZ,' +
    'ZL-:New Zealand:NZ,ZM-:New Zealand:NZ,P2-:Papua New Guinea:PG,DQ-:Fiji:FJ,PP-:Brazil:BR,PR-:Brazil:BR,PS-:Brazil:BR,PT-:Brazil:BR,PU-:Brazil:BR,' +
    'LV-:Argentina:AR,LQ-:Argentina:AR,CC-:Chile:CL,CX-:Uruguay:UY,ZP-:Paraguay:PY,CP-:Bolivia:BO,OB-:Peru:PE,HC-:Ecuador:EC,HK-:Colombia:CO,HJ-:Colombia:CO,' +
    'YV-:Venezuela:VE,HP-:Panama:PA,TI-:Costa Rica:CR,YN-:Nicaragua:NI,HR-:Honduras:HN,YS-:El Salvador:SV,TG-:Guatemala:GT,V3-:Belize:BZ,CU-:Cuba:CU,' +
    'HI-:Dominican Republic:DO,HH-:Haiti:HT,6Y-:Jamaica:JM,C6-:Bahamas:BS,8P-:Barbados:BB,9Y-:Trinidad And Tobago:TT,8R-:Guyana:GY,PZ-:Suriname:SR,' +
    'P4-:Aruba:AW,PJ-:Curacao:CW,VR-B:Bermuda:BM,V2-:Antigua And Barbuda:AG,V4-:Saint Kitts And Nevis:KN,J6-:Saint Lucia:LC,J8-:Saint Vincent And The Grenadines:VC,' +
    'J3-:Grenada:GD,J7-:Dominica:DM,V7-:Marshall Islands:MH,V6-:Micronesia:FM,T8A-:Palau:PW,C2-:Nauru:NR,A3-:Tonga:TO,5W-:Samoa:WS,H4-:Solomon Islands:SB,' +
    'YJ-:Vanuatu:VU,T3-:Kiribati:KI,T2-:Tuvalu:TV,4W-:Timor-Leste (East Timor):TL').split(',').map(x => x.split(':')).sort((a, b) => b[0].length - a[0].length);
  function regCountry(reg) {
    const r = String(reg || '').toUpperCase();
    const m = REG_COUNTRY.find(x => r.startsWith(x[0]) && r.length > x[0].length + 1) || (/^N[1-9]/.test(r) ? ['N', 'United States', 'US'] : REG_NATIONAL.find(x => r.startsWith(x[0]) && r.length > x[0].length + 1 && (x[0].includes('-') || !r.includes('-'))));
    return m ? { name: m[1], iso: m[2] } : null;
  }
  const countryOf = (hex, reg) => regCountry(reg) || countryOfHex(hex);
  function countryOfHex(hex) {
    const n = parseInt(hex, 16); if (!(n >= 0)) return null;
    let lo = 0, hi = HEX_BLOCKS.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1, b = HEX_BLOCKS[m]; if (n < b[0]) hi = m - 1; else if (n > b[1]) lo = m + 1; else return b[3] ? { name: b[2], iso: b[3] } : null; }
    return null;
  }

  // ---- persistent store ---------------------------------------------------------------------------------------------
  // Nothing may wait for the disk. A refresh starts from the "boot snapshot" - every flight that was on screen or being
  // tracked, with its identity, photos, route, departure airport and last position - read synchronously from
  // localStorage at the very first line of the script, so the map, the panel, boards and search are complete before
  // FR24's first data arrives. IndexedDB holds everything else (aircraft records, 3-month logs, today's tracks, the
  // airport list) and is read in the background, the small records first. If IndexedDB is unavailable in the userscript
  // sandbox, the snapshot alone still carries a refresh.
  const BOOT_KEY = 'tweeks.fr24.ladd.boot';
  const store = (() => {
    const mem = { id: new Map(), hex: new Map(), kv: new Map() }, dirty = { id: new Set(), hex: new Set(), kv: new Set(), hist: new Map() };
    let db = null, timer = 0, mode = 'memory';
    // the snapshot, synchronously - before anything else runs
    let boot = null;
    try { const raw = localStorage.getItem(BOOT_KEY); if (raw) { boot = JSON.parse(raw); mode = 'local'; } } catch (_) { boot = null; }
    if (boot && boot.v === 1) {
      for (const [k, v] of Object.entries(boot.hex || {})) mem.hex.set(k, v);
      for (const f of boot.flights || []) if (f && f.id != null) mem.id.set(Number(f.id), f);
    } else boot = null;
    const open = () => new Promise(res => {
      let settled = false; const done = v => { if (!settled) { settled = true; res(v); } };
      // a sandbox without IndexedDB, or an upgrade held up by another tab, must not hold anything up
      setTimeout(() => done(null), 2500);
      try {
        const r = indexedDB.open('tweeks-ladd', 2);
        r.onupgradeneeded = () => { const d = r.result; for (const s of ['id', 'hex', 'kv', 'hist']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
        r.onsuccess = () => {
          const d = r.result;
          d.onversionchange = () => { try { d.close(); } catch (_) { /* ignore */ } db = null; };
          // (flight logs, identities and photos kept for good: asked to be spared when the browser frees space. Chromium
          // decides without asking; Firefox would put up a prompt, so it is not asked there)
          try { const ns = navigator.storage; if (ns && ns.persist && ns.persisted && !/Firefox\//.test(navigator.userAgent)) ns.persisted().then(p => p || ns.persist()).catch(() => {}); } catch (_) { /* ignore */ }
          if (settled) { db = d; mode = 'idb'; lateOpen(); } else done(d);
        };
        r.onerror = () => done(null);
      } catch (_) { done(null); }
    });
    // records already in memory (from the snapshot, or updated since) win over older copies on disk
    // (a snapshot's trimmed aircraft record gives way to the full one on disk unless the snapshot is newer)
    const keep = (name, k, v) => { const cur = mem[name].get(k); if (!cur || (v && ((v.savedAt || 0) > (cur.savedAt || 0) || (cur.slim && !v.slim && (v.savedAt || 0) >= (cur.savedAt || 0))))) mem[name].set(k, v); };
    const loadAll = name => new Promise(res => {
      try {
        const req = db.transaction(name, 'readonly').objectStore(name).openCursor();
        req.onsuccess = () => { const c = req.result; if (c) { if (name === 'kv') mem.kv.set(c.key, c.value); else keep(name, c.key, c.value); c.continue(); } else res(); };
        req.onerror = () => res();
      } catch (_) { res(); }
    });
    const getMany = (name, keys) => new Promise(res => {
      const out = new Map(); if (!db || !keys.length) return res(out);
      try {
        const st = db.transaction(name, 'readonly').objectStore(name); let left = keys.length;
        for (const k of keys) { const r = st.get(k); r.onsuccess = () => { if (r.result !== undefined) out.set(k, r.result); if (!--left) res(out); }; r.onerror = () => { if (!--left) res(out); }; }
      } catch (_) { res(out); }
    });
    // writes what changed - all of it, or (over given) until that slice is used up; true when nothing is left
    function writeSome(over) {
      const tx = db.transaction(['id', 'hex', 'kv', 'hist'], 'readwrite');
      for (const name of ['id', 'hex', 'kv']) { const st = tx.objectStore(name), d = dirty[name]; for (const k of d) { if (over && over()) return false; const v = mem[name].get(k); if (v === undefined) st.delete(k); else st.put(v, k); d.delete(k); } }
      const hs = tx.objectStore('hist'); for (const [k, v] of dirty.hist) { if (over && over()) return false; if (v === undefined) hs.delete(k); else hs.put(v, k); dirty.hist.delete(k); }
      return true;
    }
    function flush() { timer = 0; if (!db) return; try { writeSome(null); } catch (e) { log('store flush', e); } }
    // (the regular writes go in idle slices: a flight log or the snapshot takes a while to copy, and never while the map
    // is moved; leaving the page writes everything at once)
    async function idleFlush() {
      try { while (db && !writeSome(await idleSlice(10))) { /* the rest in the next slice */ } } catch (e) { log('store flush', e); }
      timer = 0;
      if (dirty.id.size || dirty.hex.size || dirty.kv.size || dirty.hist.size) timer = setTimeout(idleFlush, 700);
    }
    const touch = (name, k) => { dirty[name].add(k); if (!timer) timer = setTimeout(idleFlush, 700); };
    function prune() {
      const t = now();
      for (const [k, v] of mem.id) if (!v || t - v.savedAt > ID_TTL_MS) { mem.id.delete(k); touch('id', k); }
      for (const [k, v] of mem.hex) if (!v || t - v.savedAt > HEX_TTL_MS) { mem.hex.delete(k); touch('hex', k); }
      if (mem.id.size > 15000) [...mem.id.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt).slice(0, mem.id.size - 15000).forEach(([k]) => { mem.id.delete(k); touch('id', k); });
      // (ordinary aircraft are kept too - their registry facts make the padlocked fields instant next time)
      if (mem.hex.size > 20000) [...mem.hex.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt).slice(0, mem.hex.size - 20000).forEach(([k]) => { mem.hex.delete(k); touch('hex', k); });
    }
    let fullyLoaded = false;
    function adoptBoot(b) {
      for (const [k, v] of Object.entries(b.hex || {})) keep('hex', k, v);
      for (const f of b.flights || []) if (f && f.id != null) keep('id', Number(f.id), f);
      if (!boot || (b.at || 0) > (boot.at || 0)) boot = b;
    }
    function lateOpen() { loadAll('kv').then(() => loadAll('hex')).then(() => loadAll('id')).then(() => { fullyLoaded = true; prune(); }).catch(() => {}); }
    // One-time import of the v20/v21 localStorage cache, then free that space.
    function migrate() {
      try {
        const raw = JSON.parse(localStorage.getItem('tweeks.fr24.ladd.v20') || 'null'); if (!raw) return;
        for (const [k, v] of Object.entries(raw.byId || {})) if (v && v.hex && !mem.id.has(Number(k))) { mem.id.set(Number(k), v); touch('id', Number(k)); }
        for (const [k, v] of Object.entries(raw.byHex || {})) {
          if (!v || mem.hex.has(k)) continue;
          const { hist, ...info } = v; mem.hex.set(k, info); touch('hex', k);
          if (hist && Array.isArray(hist.legs) && hist.legs.length) dirty.hist.set(k, { legs: hist.legs, days: hist.days || {}, savedAt: hist.savedAt || now() });
        }
        localStorage.removeItem('tweeks.fr24.ladd.v20');
        log('migrated the v21 cache into IndexedDB');
      } catch (e) { log('migrate', e); }
    }
    // Stage 1 (a few ms): the small key-value records - the airport list, learned usage, airspace boundaries, the
    // IndexedDB copy of the snapshot. Stage 2, in the background: every aircraft and flight record.
    const kvReady = open().then(async d => {
      if (d) { db = d; mode = 'idb'; await loadAll('kv'); const kb = mem.kv.get('boot'); if (kb && kb.v === 1) adoptBoot(kb); }
    }).catch(e => log('store', e));
    const ready = kvReady.then(async () => { if (db) { await loadAll('hex'); await loadAll('id'); } fullyLoaded = !!db; prune(); migrate(); }).catch(e => log('store', e));
    const histMem = new Map();
    return {
      ready, kvReady,
      boot: () => boot,
      mode: () => mode,
      stats: () => ({ mode, flights: mem.id.size, aircraft: mem.hex.size, loaded: fullyLoaded }),
      // The snapshot for the next page load: IndexedDB, and a synchronous localStorage copy (the one read first). The
      // caller keeps it small; if localStorage is full anyway, the copy is dropped rather than breaking FR24's own use.
      saveBoot: snap => {
        snap.v = 1; snap.at = now();
        if (db) { mem.kv.set('boot', snap); touch('kv', 'boot'); }
        try { localStorage.setItem(BOOT_KEY, JSON.stringify(snap)); if (!db) mode = 'local'; } catch (e) { try { localStorage.removeItem(BOOT_KEY); } catch (_) { /* ignore */ } }
      },
      // the snapshot as it is on disk now (another FR24 tab may have written it since this one started)
      readBoot: () => { try { const raw = localStorage.getItem(BOOT_KEY); const b = raw ? JSON.parse(raw) : null; return b && b.v === 1 ? b : null; } catch (_) { return null; } },
      flushNow: () => { if (timer) { clearTimeout(timer); } flush(); },
      // today's track per aircraft (kept with the logs, so a refresh knows at once where every flight took off)
      getToday: hexes => getMany('hist', hexes.map(h => 't:' + h)),
      setToday: (hex, v) => { dirty.hist.set('t:' + hex, v); if (!timer) timer = setTimeout(idleFlush, 700); },
      // a large record read only when wanted, never at start (the self-learning store: up to 100,000 flights)
      getBlob: key => dirty.hist.has('x:' + key) ? Promise.resolve(dirty.hist.get('x:' + key)) : getMany('hist', ['x:' + key]).then(m => m.get('x:' + key) || null),
      setBlob: (key, v) => { dirty.hist.set('x:' + key, v); if (!timer) timer = setTimeout(idleFlush, 700); },
      // an airport's board archive (06-boards): read when that board is opened or added to
      getBoard: apId => dirty.hist.has('b:' + apId) ? Promise.resolve(dirty.hist.get('b:' + apId)) : getMany('hist', ['b:' + apId]).then(m => m.get('b:' + apId) || null),
      setBoard: (apId, v) => { dirty.hist.set('b:' + apId, v); if (!timer) timer = setTimeout(idleFlush, 700); },
      // a single aircraft record, from disk if the background load has not reached it yet
      hexAsync: hex => mem.hex.has(hex) || fullyLoaded || !db ? Promise.resolve(mem.hex.get(hex) || null) : getMany('hex', [hex]).then(m => { const v = m.get(hex); if (v) keep('hex', hex, v); return mem.hex.get(hex) || null; }),
      getId: id => mem.id.get(Number(id)) || null,
      allIds: () => [...mem.id.values()].filter(r => r && r.hex && r.id != null),
      setId: (id, rec) => { const { photos, injected, ...slim } = rec; mem.id.set(Number(id), Object.assign(slim, { savedAt: now() })); touch('id', Number(id)); },
      delId: id => { mem.id.delete(Number(id)); touch('id', Number(id)); },
      getHex: hex => mem.hex.get(hex) || null,
      allHex: () => mem.hex,
      byReg: reg => { reg = String(reg || '').toUpperCase(); for (const h of mem.hex.values()) if (h && h.reg === reg) return h; return null; },
      // (what an aircraft is - LADD-listed or hidden by FR24, PIA, military - once known stays known: a source without the
      // database flags, an area query or a trail, says false where it simply does not know)
      mergeHex: (hex, info) => { const cur = mem.hex.get(hex) || { hex }; for (const k of Object.keys(info)) { const v = info[k]; if (v == null || v === '' || (Array.isArray(v) && !v.length && k !== 'recent') || (v === false && STICKY_FLAGS.has(k) && cur[k])) continue; cur[k] = v; } cur.savedAt = now(); mem.hex.set(hex, cur); touch('hex', hex); return cur; },
      kvGet: k => mem.kv.get(k),
      kvSet: (k, v) => { mem.kv.set(k, v); touch('kv', k); },
      // full logs: { legs:[summaries], days:{'YYYY/MM/DD':true}, savedAt }
      getHist: hex => {
        if (histMem.has(hex)) return Promise.resolve(histMem.get(hex));
        if (dirty.hist.has(hex)) { const v = dirty.hist.get(hex); histMem.set(hex, v); return Promise.resolve(v); }
        if (!db) return Promise.resolve(null);
        return new Promise(res => { try { const r = db.transaction('hist', 'readonly').objectStore('hist').get(hex); r.onsuccess = () => { const v = r.result || null; if (v) histMem.set(hex, v); res(v); }; r.onerror = () => res(null); } catch (_) { res(null); } });
      },
      peekHist: hex => histMem.get(hex) || dirty.hist.get(hex) || null,
      // (another FR24 tab has kept a newer log of it: read again from disk - unless this one has changes of its own unsaved)
      reloadHist: hex => { if (!dirty.hist.has(hex)) histMem.delete(hex); return store.getHist(hex); },
      // every flight log - the full ones (key: the address), today's tracks (t:<address>), and the compact recent flights
      // of every aircraft's record - deleted; the learned tables (x:), boards (b:) and everything else kept. memOnly: this
      // tab's copies only (another tab has done the deleting on disk)
      clearLogs: async memOnly => {
        await ready;
        const isLog = k => /^(t:)?[0-9a-f]{6}$/.test(String(k));
        histMem.clear();
        for (const k of [...dirty.hist.keys()]) if (isLog(k)) dirty.hist.delete(k);
        for (const [h, v] of mem.hex) if (v && v.recent && v.recent.length) { v.recent = []; if (!memOnly) touch('hex', h); }
        if (memOnly || !db) return 0;
        return new Promise(res => {
          let n = 0;
          try {
            const tx = db.transaction('hist', 'readwrite'), st = tx.objectStore('hist'), rq = st.openKeyCursor();
            rq.onsuccess = () => { const c = rq.result; if (c) { if (isLog(c.key)) { st.delete(c.key); n++; } c.continue(); } };
            tx.oncomplete = () => res(n); tx.onerror = tx.onabort = () => res(n);
          } catch (e) { res(0); }
        });
      },
      setHist: (hex, v) => { histMem.set(hex, v); dirty.hist.set(hex, v); if (histMem.size > 150) histMem.delete(histMem.keys().next().value); if (!timer) timer = setTimeout(idleFlush, 700); }
    };
  })();

  // ---- HTTP: per-host concurrency + spacing ------------------------------------------------------------------------------
  // Aggregator APIs answer 429 to more than ~1 request/second; adsb.lol's static trace files take a few in parallel.
  // (the two networks' trace files: three at a time from adsb.lol, a quarter of a second apart, two from airplanes.live -
  // eight at a time, 30 ms apart, is what a scraper does, and both now put a verification page in front of one; the
  // background never takes more than one)
  const HOSTS = { 'opendata.adsb.fi': [1, 1100], 'adsbexchange-com1.p.rapidapi.com': [1, 1200], 'api.adsb.lol': [1, 1500], 'adsb.lol': [3, 250], 'globe.adsb.lol': [3, 250], 'globe.airplanes.live': [2, 400], 'globe.theairtraffic.com': [2, 400], 'aviationweather.gov': [2, 300], 'www.jetphotos.com': [1, 1500], 'hexdb.io': [2, 250], 'api.adsbdb.com': [2, 250], 'opensky-network.org': [1, 3000], 'registry.faa.gov': [1, 800], 'api.planespotters.net': [2, 250], 'api.flightradar24.com': [3, 350], 'api.flightradar24.com#bg': [1, 2000], 'www.airport-data.com': [1, 500], 'ardis.iomaircraftregistry.com': [1, 800], 'ginfoapi.caa.co.uk': [1, 1500], 'overpass-api.de': [1, 1500] };
  const lanes = new Map();
  // `front`: what the user is looking at right now (the selected aircraft) jumps the queue. `bg`: background work (logs
  // of other aircraft, prefetching) never takes the last two slots of a host, so a click is never stuck behind it.
  function acquire(host, front, bg) {
    const [conc, gap] = HOSTS[host] || [2, 300];
    const bgMax = conc >= 3 ? conc - 2 : conc;
    let L = lanes.get(host); if (!L) { L = { busy: 0, bgBusy: 0, q: [], last: 0 }; lanes.set(host, L); }
    const pump = () => {
      while (L.busy < conc) {
        const i = L.q.findIndex(j => !j.bg || L.bgBusy < bgMax); if (i < 0) return;
        L.q.splice(i, 1)[0].go();
      }
    };
    return new Promise(res => {
      const job = { bg: !!bg, go: () => {
        L.busy++; if (bg) L.bgBusy++;
        const wait = Math.max(0, L.last + gap - now()); L.last = now() + wait;
        setTimeout(() => res(() => { L.busy--; if (bg) L.bgBusy--; pump(); }), wait);
      } };
      if (front) L.q.unshift(job); else L.q.push(job);
      pump();
    });
  }
  // the callsign shown when the transponder's is not known: the registration as a transponder sends it (no hyphen)
  const csOfRec = r => { const c = String((r && r.cs) || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); return c || String((r && r.reg) || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); };
  const deadHosts = new Map();    // host -> until (a host answering 403 to everything is left alone for a while)
  const hostStat = new Map();     // host -> { ok, fail, lastOk, lastErr, err } (the strip's "sources" pop-over)
  const noteHost = (host, ok, err) => { const h = hostStat.get(host) || { ok: 0, fail: 0, lastOk: 0, lastErr: 0, err: '' }; if (ok) { h.ok++; h.lastOk = now(); } else { h.fail++; h.lastErr = now(); h.err = err || ''; } hostStat.set(host, h); };
  // The monitor (monitor/monitor.cjs) on a server. It watches FR24's whole map and public ADS-B all the time; this browser
  // asks it first for everything it has. Every copy of the script uses the project's own public monitor from the start -
  // nothing to set up; the LADD Unblock window (FR24's bottom bar) > Data sources > "Monitor" sets another one, the owner's secret (the full answers), or turns it
  // off. Only a monitor on a server: none on this computer is ever asked (127.0.0.1 is not among the hosts this script may
  // reach). Used once it has answered a quick check - one missing never holds anything up - and checked again every 5 minutes.
  const MON_DEFAULT_URL = 'https://143-47-224-210.sslip.io';
  // (the shared monitors in order: the first that answers is used, the next when it stops answering - a standby server
  // goes here, and in the hosts this script may reach: header.js @connect, build.mjs's extension hosts)
  const MON_DEFAULTS = [MON_DEFAULT_URL];
  const monAddr = u => { u = String(u || '').trim(); while (u.endsWith('/')) u = u.slice(0, -1); return u.startsWith('https://') && u.length > 9 && !/[/\s]/.test(u.slice(8)) ? u : ''; };
  // (kv monRemote: { url, token } set here, { off: true } turned off; nothing set - the public monitor, no secret)
  const monRemote = () => { try { const r = store.kvGet('monRemote') || {}; if (r.off) return null; const url = monAddr(r.url) || MON_DEFAULT_URL; return { url, token: url === monAddr(r.url) ? String(r.token || '') : '', dflt: !monAddr(r.url) }; } catch (_) { return { url: MON_DEFAULT_URL, token: '', dflt: true }; } };
  // (with the owner's secret: it; without: which script is asking - not a secret, the monitor's request counts by version)
  const monAuth = r => r && r.token ? { 'X-Monitor-Token': r.token } : { 'X-Monitor-Client': 'fr24-ladd/' + VERSION };
  let monBase = '', monErr = '';   // (monErr: why the monitor was not used at the last check - shown beside it)
  const monUrl = () => monBase;
  const monHdr = () => { const r = monRemote(); return r && (monBase === r.url || (r.dflt && MON_DEFAULTS.includes(monBase))) ? monAuth(r) : null; };
  let monOk = false, monCheckAt = 0;
  // (the monitor busy - an answer late - is not the monitor gone: given up on after three requests in a row went
  // unanswered and none was answered for two minutes. One slow answer used to take it for gone at once, for everything -
  // logs, live figures, today's track - while it read adsb.lol's archives, 23 Oct)
  let monGoodAt = 0, monFails = 0;
  const monGood = () => { monGoodAt = now(); monFails = 0; };
  function monNoAnswer() { monFails++; if (monFails >= 3 && now() - monGoodAt > 120000) { monOk = false; monErr = 'no answer for over two minutes'; monCheckAt = Math.min(monCheckAt, now() - 5 * 60000 + 30000); } }
  let monStat = null;   // (the monitor's last /status: its version, the daily archives it has read - the log page says them)
  const monUp = () => monOk;
  let monChecking = null;
  function monCheck(force) {
    if (!force && now() - monCheckAt < 5 * 60000) return monChecking; monCheckAt = now();
    monChecking = store.kvReady.then(() => {
      const r = monRemote(); monErr = '';
      if (!r) { monBase = ''; throw new Error('turned off'); }
      // (the shared one: each of them in turn, the one in use first; one set here: that one)
      const urls = r.dflt ? [monBase].filter(u => MON_DEFAULTS.includes(u)).concat(MON_DEFAULTS.filter(u => u !== monBase)) : [r.url];
      const ask = i => { const u = urls[i]; HOSTS[new URL(u).host] = [4, 50]; return gmRequest(u + '/status', { timeout: 10000, headers: monAuth(r) }).then(j => { if (!(j && j.v)) throw new Error('not a monitor'); monBase = u; return j; }).catch(e => { if (i + 1 < urls.length) return ask(i + 1); throw e; }); };
      return ask(0).catch(e => { monErr = String((e && e.message) || e).slice(0, 120); throw e; });
    }).then(j => { monOk = !!(j && j.v); monStat = j && j.v ? j : null; if (monOk) monGood(); return j; }, e => {
      // (no answer from the one in use: busy, as above - kept while it answered lately; refused, or turned off: not used)
      if (monOk && !/HTTP [45]|not a monitor|turned off/.test(String(e && e.message || e))) monNoAnswer(); else monOk = false;
      monCheckAt = now() - 5 * 60000 + 30000; throw e;
    });
    monChecking.catch(() => {});
    return monChecking;
  }
  // (the first ask after the page opens waits for the monitor's check - it was refused while that was still on its way,
  // so the first board, parked lookup and routes page of every page load went without the monitor)
  // (opts.idle: a background answer - read in an idle moment with the map left alone)
  function monGet(path, opts) {
    // (no answer at all - not a refusal: looked at again in 30 s, the next shared monitor if this one is gone)
    const go = () => monOk && monBase ? gmRequest(monUrl() + path, Object.assign({ timeout: 8000 }, opts || {}, { headers: monHdr() })).then(v => { monGood(); return v; }, e => { if (!/HTTP [45]|paused|skipped/.test(String(e))) monNoAnswer(); throw e; }) : Promise.reject(new Error('monitor not running'));
    const c = monCheck();
    return c ? c.then(go, go) : go();
  }
  // (a report to the monitor: JSON in the body)
  function monPost(path, obj) {
    const go = () => monOk && monBase ? gmRequest(monUrl() + path, { method: 'POST', body: JSON.stringify(obj), timeout: 15000, headers: Object.assign({ 'Content-Type': 'application/json' }, monHdr() || {}) }) : Promise.reject(new Error('monitor not running'));
    const c = monCheck();
    return c ? c.then(go, go) : go();
  }
  // raw: answered with { status, text } whatever the status - the caller reads it (the flight logs' trace files: a 404, a
  // verification page and a refusal are told apart there) - and never held back by a host paused for others. skip(): asked
  // when the request's turn comes - true: not sent after all (the answer that came meanwhile does for it; 'skipped')
  function gmRequest(url, { timeout = 12000, accept = 'application/json', json = true, headers = null, priority = false, bg = false, idle = false, method = 'GET', body = null, raw = false, skip = null } = {}) {
    const gm =typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
    const host = (() => { try { return new URL(url).host; } catch (_) { return url; } })();
    if (!raw && (deadHosts.get(host) || 0) > now()) return Promise.reject(new Error('host paused (refused or rate-limited)'));
    // (FR24's own API counts every request from this browser against one limit - the user's own panels and dropdowns
    // included: background lookups there - pictures of aircraft nobody has opened - go one every two seconds)
    const lane = bg && !priority && host === 'api.flightradar24.com' ? host + '#bg' : host;
    return acquire(lane, priority, bg && !priority).then(release => new Promise((resolve, reject) => {
      if (!gm) { release(); return reject(new Error('GM_xmlhttpRequest unavailable')); }
      if (skip && skip()) { release(); return reject(new Error('skipped')); }
      let settled = false, freed = false;
      const free = () => { if (!freed) { freed = true; release(); } };
      const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(guard); free(); fn(v); } };
      // Some userscript managers never call back for a request they dropped (no onload/onerror/ontimeout): without this
      // deadline the host's lane would stay taken for good and every later request to it - telemetry included - would stall.
      const guard = setTimeout(() => done(reject, new Error('no response (timeout)')), timeout + 3000);
      try {
        gm({ method, url, timeout, responseType: 'text', data: body == null ? undefined : body, headers: Object.assign({ Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' }, headers || {}),
          onload: r => {
            const text = r.responseText != null ? r.responseText : (typeof r.response === 'string' ? r.response : '');
            if (raw) {
              const st = Number(r.status) || 0, res = { status: st, text: String(text || '') };
              noteHost(host, (st >= 200 && st < 300) || st === 404, 'HTTP ' + st);
              if ((bg || idle) && !priority && st >= 200 && st < 300) { clearTimeout(guard); free(); idleSlice().then(() => done(resolve, res)); return; }
              return done(resolve, res);
            }
            // (background work: the host's slot is free at once; reading the answer - a day's track can be megabytes -
            // and what follows from it wait for an idle moment with the map left alone)
            if ((bg || idle) && !priority && r.status >= 200 && r.status < 300) {
              noteHost(host, true); clearTimeout(guard); free();
              idleSlice().then(() => { try { done(resolve, json ? JSON.parse(text) : text); } catch (e) { done(reject, e); } });
              return;
            }
            if (r.status >= 200 && r.status < 300) { noteHost(host, true); try { done(resolve, json ? JSON.parse(text) : text); } catch (e) { done(reject, e); } }
            else {
              noteHost(host, r.status === 404, 'HTTP ' + r.status);     // (404: "nothing that day" - an answer)
              // a key the API refuses, or a site refusing scripts: left alone for half an hour
              if ((r.status === 401 || r.status === 403) && /rapidapi\.com$|^globe\.airplanes\.live$|^external-api\.faa\.gov$/.test(host)) deadHosts.set(host, now() + 30 * 60000);
              if (r.status === 429) deadHosts.set(host, now() + 20000);   // rate-limited: leave that host alone briefly
              done(reject, new Error('HTTP ' + r.status));
            }
          },
          onerror: r => { noteHost(host, false, 'network error'); done(reject, new Error('network error' + (r && r.status ? ' (HTTP ' + r.status + ')' : '') + (r && r.error ? ': ' + r.error : ''))); }, ontimeout: () => { noteHost(host, false, 'timeout'); done(reject, new Error('timeout')); }, onabort: () => done(reject, new Error('aborted')) });
      } catch (e) { done(reject, e); }
    }));
  }
  // Same-origin FR24 JSON. FR24 rate-limits /api/v1/* (60/min) and a 429 there breaks the user's own boards, so every
  // call of ours is spaced out and backs off for a minute after any 429.
  let fr24Gate = Promise.resolve(), fr24BlockedUntil = 0;
  function fr24Slot(gapMs) { const prev = fr24Gate; fr24Gate = prev.then(() => sleep(gapMs)); fr24Gate.catch(() => {}); return prev; }
  const fr24Json = (path, timeout = 12000, gapMs = 0) => {
    const go = () => {
      if (now() < fr24BlockedUntil) return Promise.reject(new Error('rate-limited, backing off'));
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
      // (marked as ours: where the userscript shares the page's fetch, the page interceptor passes it straight through -
      // an internal board or search lookup must not look like the user opening a board or searching)
      return fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-TL-Internal': '1' }, signal: ctl ? ctl.signal : undefined })
        .then(r => { if (r.status === 429) { fr24BlockedUntil = now() + 60000; log('FR24 API rate-limited, pausing 60 s'); throw new Error('HTTP 429'); } if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .finally(() => clearTimeout(t));
    };
    return gapMs ? fr24Slot(gapMs).then(go) : go();
  };
