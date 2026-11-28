  // ---- (1.2.4) FR24's own playback page (/data/playback/<id>) for the flights FR24 plays back to nobody: every blocked
  // (LADD) flight, every flight older than FR24's week of playback, every flight of a log rebuilt here. The page (page.js
  // mxPb*) shows FR24's own player - its map, slider, figures, graph, tracklog, KML and CSV - and this side gives it the
  // flight: which aircraft, its airports, its times, and its track as kept: every FR24 position the monitor has of it
  // (fr24raw, 730 days), and the public ADS-B record of its day (adsb.lol, airplanes.live) - FR24's first (1.3.12), the
  // record only where FR24 has nothing. A flight of FR24's own has its id; one known only here, the aircraft and its take-off:
  // "ff" + address + take-off time (hex) - "ff" + address + "00000000" for the aircraft's latest flight
  const PB_SYN = /^ff([0-9a-f]{6})([0-9a-f]{8})$/;
  const pbSynId = (hex, t) => 'ff' + hex + ('00000000' + Math.max(0, Math.round(t || 0)).toString(16)).slice(-8);
  // (an airport as FR24's player names it: its code and city, where it is, its time zone)
  // (1.4.0) A flight's runways - its take-off's at the field it left, its landing's where it landed: the monitor's log of
  // FR24's tracks by the flight's id, else its blocked flights' by the aircraft's address and the time - for FR24's player
  // (its flight times card had a padlock over them)
  // (1.4.1: both ends in one answer of the monitor's - /rwyof: by FR24's id, else by the aircraft and its times, the
  // blocked flights' log and FR24's flights of the aircraft then, each one's logged as it happened or worked out there
  // from its positions kept. Nothing worked out here: every take-off and landing is on the monitor. A monitor before
  // 1.4.1: asked end by end as before)
  // (1.4.3) A played flight's related flights - the aircraft's flight before and after it, its flight number's, its
  // callsign's - as FR24's player lists them ("Related flights": Previous and Next of each): for a flight played here, where
  // FR24 gives none, and for FR24's own where its Previous is padlocked (a free account). From the monitor: the
  // aircraft's FR24 flights then (/fr24of) and its log, the flight number's flights (/fr24fn), the callsign's (/flights).
  // Each opens in the player - FR24's own within its week, else the one made here (its id, or the aircraft and take-off)
  async function onPbRelated(d) {
    const rid = d && d.rid, dep = Number(d && d.dep) || 0, fid = clean(d && d.fid).toLowerCase(), fn = clean(d && d.fn).toUpperCase(), cs = clean(d && d.cs).toUpperCase(), reg = clean(d && d.reg).toUpperCase();
    let hex = clean(d && d.hex).toLowerCase();
    const out = [];
    if (!(dep > 1e9) || !(await monReady())) { postToPage('pbRelatedGot', { rid, groups: out }); return; }
    // (the aircraft: the page's own, else by its registration here, else FR24's record of the flight)
    if (!/^[0-9a-f]{6}$/.test(hex) && reg) hex = clean((store.byReg(reg) || {}).hex).toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex) && /^[0-9a-f]{1,12}$/.test(fid)) hex = clean(await hexOfFid(fid, dep, reg).catch(() => '')).toLowerCase();
    const href = x => { const fid = /^[0-9a-f]{1,12}$/.test(x.fid || '') ? x.fid : ''; if (fid) return nowS() - x.t > 7 * 86400 ? '/data/flights?tl-pb=' + fid : '/data/playback/' + fid; return /^[0-9a-f]{6}$/.test(x.hex || '') && x.t > 1e9 ? '/data/flights?tl-pb=' + pbSynId(x.hex, x.t) : ''; };
    const item = x => { if (!x) return null; const h = href(x); return { departure: Math.round(x.t), timezone: x.tz || null, flightNumber: x.fn || null, href: h || null, locked: !h }; };
    // (the one before - over five minutes before - and the one after)
    const around = list => { let prev = null, next = null; for (const x of list) { if (!(x.t > 1e9)) continue; if (x.t < dep - 300 && (!prev || x.t > prev.t)) prev = x; if (x.t > dep + 300 && (!next || x.t < next.t)) next = x; } return { prev, next }; };
    const tzOfId = id => { const a = apById(Number(id) || 0); return (a && a.tzName) || null; };
    const add = (relation, identifier, list) => { const r = around(list); if (r.prev || r.next) out.push({ id: relation + ':' + identifier, identifier, relation, previous: item(r.prev), next: item(r.next) }); };
    const jobs = [];
    if (/^[0-9a-f]{6}$/.test(hex)) jobs.push((async () => {
      const list = [];
      try { const j = await monGet(`/fr24of?hex=${hex}&t0=${Math.round(dep - 3 * 86400)}&t1=${Math.round(dep + 3 * 86400)}`, { timeout: 8000 }); for (const x of (j && j.list) || []) if (x && /^[0-9a-f]{1,12}$/.test(x.fid || '') && x.t0 > 1e9) list.push({ fid: x.fid, t: x.t0, hex }); } catch (e) { /* none */ }
      for (const l of knownLegs(hex)) { const t = l.tOff || l.tStart; if (t > 1e9 && !list.some(x => Math.abs(x.t - t) < 900)) list.push({ t, hex, fn: fnKnown(l.cs) || null, tz: l.from ? tzOfId(l.from.id) : null }); }
      add('aircraft', reg || hex.toUpperCase(), list);
    })());
    if (/^[A-Z0-9]{3,8}$/.test(fn)) jobs.push((async () => {
      try { const j = await monGet(`/fr24fn?fn=${encodeURIComponent(fn)}&from=${Math.round(dep - 14 * 86400)}&to=${Math.round(dep + 14 * 86400)}`, { timeout: 10000 }); add('flight_number', fn, ((j && j.list) || []).filter(x => x && x.t0 > 1e9).map(x => ({ fid: x.fid || '', hex: clean(x.hex).toLowerCase(), t: x.t0, fn, tz: tzOfId(x.fromId) }))); } catch (e) { /* none */ }
    })());
    if (/^[A-Z0-9]{3,8}$/.test(cs) && cs !== fn) jobs.push((async () => {
      try { const j = await monGet(`/flights?cs=${encodeURIComponent(cs)}`, { timeout: 8000 }); add('callsign', cs, ((j && j.list) || []).filter(x => x && (x.tOff || x.tStart) > 1e9).map(x => ({ hex: clean(x.hex).toLowerCase(), t: x.tOff || x.tStart, tz: x.from ? tzOfId(x.from.id) : null }))); } catch (e) { /* none */ }
    })());
    await Promise.all(jobs);
    const order = { flight_number: 0, callsign: 1, aircraft: 2 };
    postToPage('pbRelatedGot', { rid, hex: /^[0-9a-f]{6}$/.test(hex) ? hex : '', groups: out.sort((a, b) => order[a.relation] - order[b.relation]) });
  }
  // (1.4.3) a board card's runways the airport's own answer lacks - its other end's above all (the page part's cardRwyMore)
  async function onCardRwy(d) {
    let r = { off: '', on: '' };
    try { r = await pbRunways(clean(d && d.hex).toLowerCase(), clean(d && d.fid).toLowerCase(), apById(Number(d && d.o) || 0), apById(Number(d && d.d) || 0), Number(d && d.atd) || 0, Number(d && d.ata) || 0); } catch (e) { /* none */ }
    postToPage('cardRwyGot', { rid: d && d.rid, off: r.off || '', on: r.on || '' });
  }
  async function pbRunways(hex, fid, from, to, dep, arr) {
    const out = { off: '', on: '' }; if (!(await monReady())) return out;
    hex = /^[0-9a-f]{6}$/.test(hex || '') ? hex : ''; fid = /^[0-9a-f]{1,12}$/.test(fid || '') ? fid : '';
    const offOk = from && Number(from.id) > 0 && dep > 1e9, onOk = to && Number(to.id) > 0 && arr > 1e9;
    if (!offOk && !onOk || (!hex && !fid)) return out;
    const q = (fid ? 'fid=' + fid : '') + (hex ? (fid ? '&' : '') + 'hex=' + hex : '') + (offOk ? `&off=${from.id},${Math.round(dep)}` : '') + (onOk ? `&on=${to.id},${Math.round(arr)}` : '');
    try {
      const j = await monGet('/rwyof?' + q, { timeout: 8000 });
      if (j && j.v) { out.off = typeof j.off === 'string' ? j.off.slice(0, 8) : ''; out.on = typeof j.on === 'string' ? j.on.slice(0, 8) : ''; return out; }
    } catch (e) { if (!/HTTP 404/.test(String(e && e.message || e))) return out; }
    const one = async (ap, end, t) => {
      if (!ap || !(Number(ap.id) > 0) || !(t > 1e9)) return '';
      if (fid) { try { const j = await monGet(`/rwy?f=${fid}:${end}&ap=${ap.id}&ts=${Math.round(t)}`, { timeout: 5000 }); const v = j && j.list && j.list[`${fid}:${end}`]; if (typeof v === 'string' && v) return v.slice(0, 8); } catch (e) { /* by the aircraft */ } }
      if (hex) {
        try {
          const old = t < nowS() - 2 * 86400 ? '&old=1' : '';
          const j = await monGet(`/rwyap?ap=${ap.id}&from=${Math.round(t - 3600)}&to=${Math.round(t + 3600)}${old}`, { timeout: 6000 });
          let best = null; for (const x of (j && Array.isArray(j.h) ? j.h : [])) if (Array.isArray(x) && x[0] === hex && x[1] === end && fin(x[3]) && Math.abs(x[3] - t) <= 1800 && (!best || Math.abs(x[3] - t) < Math.abs(best[3] - t))) best = x;
          if (best && typeof best[2] === 'string') return best[2].slice(0, 8);
        } catch (e) { /* none */ }
      }
      return '';
    };
    [out.off, out.on] = await Promise.all([one(offOk ? from : null, 0, dep), one(onOk ? to : null, 1, arr)]);
    return out;
  }
  function pbAirport(a) {
    if (!a) return null;
    const tz = a.timezone && typeof a.timezone === 'object' ? a.timezone.name : typeof a.timezone === 'string' ? a.timezone : '';
    return { code: a.iata || a.icao || a.code || '', name: a.name || '', city: a.city || a.name || '', lat: fin(a.lat) ? a.lat : null, lon: fin(a.lon) ? a.lon : null, tz: tz || 'UTC' };
  }
  // (the monitor's FR24 positions of a flight, as the engine's points)
  async function pbRaw(fid, t) {
    if (!/^[0-9a-f]{1,12}$/.test(fid) || !(await monReady())) return { pts: [], m: {} };
    try {
      const j = await monGet('/fr24raw?f=' + fid + (t > 1e9 ? '&t=' + Math.round(t) : ''), { timeout: 20000 }), C = (j && j.cols) || [], at = k => C.indexOf(k), pts = [];
      for (const r of Array.isArray(j && j.p) ? j.p : []) {
        if (!Array.isArray(r) || !fin(r[0]) || !fin(r[1]) || !fin(r[2])) continue;
        const v = k => { const x = r[at(k)]; return fin(x) ? x : null; }, gnd = r[at('gnd')] === 1 || v('alt') === 0;
        pts.push({ t: r[0], lat: r[1], lon: r[2], alt: gnd ? 0 : v('alt'), gnd, gs: v('gs'), trk: v('trk'), vr: v('vr'), sq: typeof r[at('sq')] === 'string' ? r[at('sq')] : '', ag: v('altGeom'), ias: v('ias'), tas: v('tas') });
      }
      // (1.4.3: sp - the monitor has only its scans' few points of it, not FR24's whole track)
      return { pts, m: (j && j.m) || {}, sp: !!(j && j.sp) };
    } catch (e) { return { pts: [], m: {} }; }
  }
  // (1.4.3) FR24's own whole track of its flight, where the monitor has only its scans' points of it (or none) and FR24 still
  // plays it (its week): asked of FR24 as its own player asks it, sent to the monitor to keep, and put with the monitor's -
  // each second once, FR24's playback's point first
  const PB_WEEK = 7.5 * 86400;
  async function pbFr24Whole(fid, t, r) {
    r = r || { pts: [], m: {} };
    if (r.pts.length && !r.sp) return r;
    const t0 = r.pts.length ? r.pts[0].t : t;
    if (!(t0 > 0) || nowS() - t0 > PB_WEEK) return r;
    let tr = null; try { tr = fr24PbParse(await fr24PbJson(fid, t0, { priority: true, timeout: 15000 })); } catch (e) { tr = null; }
    if (!tr || tr.pts.length < 2) return r;
    try { fr24TrackSend(fid, tr); } catch (e) { /* not sent */ }
    const by = new Map(); for (const p of r.pts) by.set(p.t, p); for (const p of tr.pts) by.set(p.t, Object.assign({}, by.get(p.t) || {}, p));
    const fl = tr.fl || {}, idn = fl.identification || {}, ac = fl.aircraft || {}, ap = fl.airport || {}, code = x => clean((x && x.code && (x.code.iata || x.code.icao)) || '');
    const m = Object.assign({ cs: clean(idn.callsign || ''), fn: clean((idn.number && idn.number.default) || ''), reg: clean((ac.identification && ac.identification.registration) || ''), hex: clean((ac.identification && ac.identification.modes) || '').toLowerCase(), type: clean((ac.model && ac.model.code) || ''), from: code(ap.origin), to: code(ap.destination) }, r.m || {});
    for (const k of Object.keys(m)) if (!m[k]) delete m[k];
    return { pts: [...by.values()].sort((a, b) => a.t - b.t), m, sp: false, whole: true };
  }
  // (the public ADS-B record of the days from t0 to t1, as the engine's points: adsb.lol's - and airplanes.live's for a
  // day gone, filling adsb.lol's holes)
  async function pbAdsb(hex, t0, t1) {
    if (!/^[0-9a-f]{6}$/.test(hex) || !(t0 > 0)) return [];
    const days = []; for (let t = t0; t <= Math.max(t0, t1) + 1; t += 86400) days.push(t); if (dayStr(t1 * 1000) !== dayStr(days[days.length - 1] * 1000)) days.push(t1);
    let pts = [];
    for (const t of days) { const more = await (pbMore(hex, t) || pbPoints(hex, t)).catch(() => []); pts = pts.concat(more || []); }
    return pts.filter(p => p && fin(p.t) && fin(p.lat) && fin(p.lon)).map(p => { const g = !!(p.gnd0 || p.gnd); return { t: p.t, lat: p.lat, lon: p.lon, alt: g ? 0 : fin(p.alt) ? p.alt : null, gnd: g, gs: fin(p.gs) ? p.gs : null, trk: fin(p.trk) ? p.trk : null, vr: fin(p.vr) ? p.vr : null, sq: p.sq || '', cs: p.cs || '', ag: fin(p.altGeom) ? p.altGeom : null, ias: fin(p.ias) ? p.ias : null, tas: fin(p.tas) ? p.tas : null }; });
  }
  // (1.4.3) FR24's own positions of a flight, whenever it has any - as FR24's own player draws them, straight from point to
  // point: the public ADS-B record only where FR24 has nothing of it - before FR24 picked it up, after it lost it, and a
  // hole in FR24's own of ten minutes and more (it lost it). Until 1.4.3 ADS-B filled every gap of a minute: the scans'
  // positions of an airliner are three minutes apart, so its playback was mostly ADS-B.
  // (1.2.4 took whichever had more points: the track played was mostly adsb.lol's)
  function pbFr24First(fr, adsb) {
    if (!fr || fr.length < 2) return pbMergePts(fr || [], adsb || []);
    const out = fr.slice().sort((p, q) => p.t - q.t), ts = out.map(p => p.t), first = ts[0], last = ts[ts.length - 1];
    const holes = []; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] >= 600) holes.push([ts[i - 1], ts[i]]);
    for (const p of adsb || []) if (p && fin(p.t) && (p.t < first - 30 || p.t > last + 30 || holes.some(h => p.t > h[0] + 60 && p.t < h[1] - 60))) out.push(p);
    return out.sort((p, q) => p.t - q.t);
  }
  // (1.3.12) a flight of a log rebuilt here - no FR24 id of its own: FR24's positions of its aircraft in that time, as the
  // monitor kept them (/fr24of: the aircraft's FR24 flights then; /fr24raw: each one's points) - none from a monitor
  // before 1.3.12, or of a day before it kept them by aircraft
  // (1.4.1: and what FR24 said of the flight with them - its flight number and route, kept by a monitor of 1.4.1 on: the
  // meta of the one FR24 flight with most points then)
  async function pbFr24Of(hex, t0, t1, metaOut) {
    if (!/^[0-9a-f]{6}$/.test(hex) || !(t1 > t0) || !(await monReady())) return [];
    let list = [];
    try { const j = await monGet(`/fr24of?hex=${hex}&t0=${Math.round(t0)}&t1=${Math.round(t1)}`, { timeout: 12000 }); list = Array.isArray(j && j.list) ? j.list : []; } catch (e) { return []; }
    const by = new Map(); let most = 0;
    for (const x of list.filter(x => x && /^[0-9a-f]{1,12}$/.test(String(x.fid || ''))).slice(0, 4)) {
      // (1.4.3: each FR24 flight of it then as FR24's whole track, within FR24's week - the scans' points otherwise)
      const r = await pbFr24Whole(String(x.fid), fin(x.t0) ? x.t0 : t0, await pbRaw(String(x.fid), fin(x.t0) ? x.t0 : t0));
      let n = 0; for (const p of r.pts) if (p.t >= t0 && p.t <= t1 && !by.has(p.t)) { by.set(p.t, p); n++; }
      if (metaOut && n > most && r.m) { most = n; Object.assign(metaOut, r.m, { fid: String(x.fid) }); }
    }
    return [...by.values()].sort((p, q) => p.t - q.t);
  }
  // ---- (1.4.1) what FR24's player names a flight by: its flight number, its airline (or the aircraft's operator / owner)
  // FR24's own flight number of a callsign - the monitor learns every pair FR24's map shows (/csfn) - kept here a day
  const csFnMemo = new Map();
  // (1.4.2) Each callsign's flight number as FR24's own rows showed it here - a log page's flights (FR24's week of them), an
  // airport's board, a played flight: known at once for the rows rebuilt from ADS-B under them, kept 60 days (the latest
  // 5000), and sent to the monitor for every other browser (report csfn - fr24fn.cjs noteCs). The rows rebuilt from
  // ADS-B had a callsign where FR24's own rows beside them had the same flight's number.
  const CSFN_KEY = 'csFnSeen1', CSFN_KEEP = 60 * 864e5, FN_OK = /^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/;
  const csfnSeen = new Map(), csfnOut = [];
  let csfnT = 0;
  store.kvReady.then(() => { const o = store.kvGet(CSFN_KEY), lo = now() - CSFN_KEEP; if (o && typeof o === 'object') for (const k of Object.keys(o)) { const v = o[k]; if (Array.isArray(v) && typeof v[0] === 'string' && FN_OK.test(v[0]) && fin(v[1]) && v[1] > lo && !(csfnSeen.has(k) && csfnSeen.get(k)[1] >= v[1])) csfnSeen.set(k, v); } }).catch(() => {});
  function noteCsFn(cs0, fn0, t, local) {
    const cs = clean(cs0).toUpperCase(), fn = clean(fn0).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z]{3}\d[A-Z0-9]{0,4}$/.test(cs) || !FN_OK.test(fn) || fn === cs) return false;
    const at = fin(t) && t > 1e9 ? Math.min(t * 1000, now()) : now(), o = csfnSeen.get(cs);
    if (o && (o[1] > at || (o[0] === fn && at - o[1] < 3600e3))) return false;
    csfnSeen.delete(cs); csfnSeen.set(cs, [fn, at]); while (csfnSeen.size > 5000) csfnSeen.delete(csfnSeen.keys().next().value);
    const m = csFnMemo.get(cs); if (!m || m.fn !== fn) csFnMemo.set(cs, { fn, at: now() });
    if (!local) { csfnOut.push([cs, fn, Math.round(at / 1000)]); if (csfnOut.length > 500) csfnOut.shift(); }
    if (!csfnT) csfnT = setTimeout(() => { csfnT = 0; store.kvSet(CSFN_KEY, Object.fromEntries(csfnSeen)); }, 1500);
    return true;
  }
  // (a callsign's flight number FR24's rows showed here - within the 60 days kept)
  const csfnOf = cs => { const v = csfnSeen.get(cs); return v && now() - v[1] < CSFN_KEEP ? v[0] : ''; };
  async function csFlightNumber(cs) {
    cs = clean(cs).toUpperCase(); if (!/^[A-Z]{3}\d[A-Z0-9]{0,4}$/.test(cs)) return '';
    const m = csFnMemo.get(cs); if (m && now() - m.at < 864e5) return m.fn;
    let fn = '';
    if (await monReady()) { try { const j = await monGet('/csfn?cs=' + encodeURIComponent(cs), { timeout: 5000 }); const v = j && j.list && j.list[cs]; if (typeof v === 'string' && /^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/.test(v)) fn = v; } catch (e) { /* none */ } }
    if (!fn) fn = csfnOf(cs);
    // (none learnt: an airline's numbered callsign is its flight number with its IATA code - UAL972 is UA972; one with
    // letters in it - EZY327L, U2414 - is not, and has none here)
    if (!fn && /^[A-Z]{3}\d{1,4}$/.test(cs)) { await Promise.race([fr24.loadAirlines().catch(() => null), sleep(3000)]); const id = fr24.byIcao.get(cs.slice(0, 3)), a = id && fr24.airlines ? fr24.airlines.get(id) : null; if (a && /^[A-Z0-9]{2}$/.test(a.iata || '')) fn = a.iata + String(Number(cs.slice(3))); }
    csFnMemo.set(cs, { fn, at: now() }); if (csFnMemo.size > 2000) csFnMemo.delete(csFnMemo.keys().next().value);
    return fn;
  }
  // (1.4.1) many callsigns' flight numbers at once - the log pages' rows: one ask of the monitor for those not known here
  // (100 a time), then the numbered callsigns' IATA form; how many are known now
  const CS_FN_RE = /^[A-Z]{3}\d[A-Z0-9]{0,4}$/, csFnBusy = new Set();
  async function csFlightNumbers(list) {
    const miss = [...new Set((list || []).map(c => clean(c).toUpperCase()))].filter(c => CS_FN_RE.test(c) && !csFnBusy.has(c) && !(csFnMemo.has(c) && now() - csFnMemo.get(c).at < 864e5));
    if (!miss.length) return 0;
    miss.forEach(c => csFnBusy.add(c));
    let got = 0;
    try {
      const learnt = {};
      if (await monReady()) for (let i = 0; i < miss.length; i += 100) { try { const j = await monGet('/csfn?cs=' + miss.slice(i, i + 100).map(encodeURIComponent).join(','), { timeout: 8000 }); Object.assign(learnt, (j && j.list) || {}); } catch (e) { /* none */ } }
      if (miss.some(c => !learnt[c] && /^[A-Z]{3}\d{1,4}$/.test(c))) await Promise.race([fr24.loadAirlines().catch(() => null), sleep(3000)]);
      for (const c of miss) {
        let fn = typeof learnt[c] === 'string' && /^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/.test(learnt[c]) ? learnt[c] : csfnOf(c);
        if (!fn && /^[A-Z]{3}\d{1,4}$/.test(c)) { const id = fr24.byIcao.get(c.slice(0, 3)), a = id && fr24.airlines ? fr24.airlines.get(id) : null; if (a && /^[A-Z0-9]{2}$/.test(a.iata || '')) fn = a.iata + String(Number(c.slice(3))); }
        csFnMemo.set(c, { fn, at: now() }); if (fn) got++;
      }
      while (csFnMemo.size > 2000) csFnMemo.delete(csFnMemo.keys().next().value);
    } finally { miss.forEach(c => csFnBusy.delete(c)); }
    return got;
  }
  // (a callsign's flight number as known here now - '' none, or not asked yet)
  const fnKnown = cs => { const c = clean(cs).toUpperCase(), m = csFnMemo.get(c); return (m && m.fn) || csfnOf(c); };
  // (the rows' callsigns: their flight numbers asked for, the rows drawn again when any came)
  const wantFns = (legs, redraw) => csFlightNumbers((legs || []).map(l => l && l.cs)).then(n => { if (n && redraw) redraw(); }).catch(e => log('flight numbers', String(e && e.message || e)));
  // (an airline's callsign - three letters and a number: FR24's airline of that ICAO code, its id for the logo)
  const csAirlineId = cs => { const c = /^([A-Z]{3})\d/.exec(clean(cs).toUpperCase()); return (c && fr24.byIcao.get(c[1])) || 0; };
  // (the aircraft's operator or owner as the registers have it - asked of them, a few seconds at most: the page may have
  // opened just to play the flight, nothing of the aircraft read yet)
  async function pbOperator(hex, reg, cs) {
    await Promise.race([Promise.all([fr24.loadAirlines().catch(() => null), /^[0-9a-f]{6}$/.test(hex) ? publicIdentity(hex, reg).catch(() => null) : null]), sleep(5000)]);
    const alId = csAirlineId(cs), al = alId ? fr24.airlineName(alId) : '';
    const hx = /^[0-9a-f]{6}$/.test(hex) ? store.getHex(hex) || {} : {};
    return { name: al || shownOwner(hx, cs) || '', alId: al ? alId : operatorIdOf(hx, cs) || 0 };
  }
  // (the aircraft's own log read before it is looked in - the page may have opened just to play it: knownLegs reads only
  // what is in memory. Then the monitor's flights of it for one this browser has not got - JDI01, Cincinnati to
  // Manchester: on a phone, where its log had never been read, no flight was found, no airports, and the track was cut
  // at the Atlantic's hole; whole on the computer, where its log page had it read)
  async function pbLegNear(hex, dep) {
    if (!/^[0-9a-f]{6}$/.test(hex) || !(dep > 0)) return null;
    await Promise.race([Promise.all([store.getHist(hex).catch(() => null), warmToday([hex]).catch(() => null)]), sleep(4000)]);
    const near = legs => { let leg = null, best = 3 * 3600; for (const l of legs || []) { if (!l || !(l.tStart > 0)) continue; const dt = Math.abs((l.tOff || l.tStart) - dep); if (dt < best) { best = dt; leg = l; } } return leg; };
    let leg = near(knownLegs(hex));
    if (!leg && await monReady()) {
      try { const j = await monGet('/legs?hex=' + hex, { timeout: 6000 }); leg = near(Array.isArray(j && j.legs) ? j.legs.filter(l => l && fin(l.tStart) && fin(l.tEnd)) : []); if (leg) leg = Object.assign({ mon: true }, leg); } catch (e) { /* none */ }
    }
    return leg;
  }
  // (no flight of it known anywhere: the flight made of its track here, as its log would make it - its ends, and a hole in
  // the record a flight crosses - an ocean - inside it, not where it was cut)
  function pbLegOfPts(hex, pts, dep) {
    try {
      const ac = acOfHex(hex), cls = ENGINE.classify(ac), heli = cls === 'heli';
      const sums = ENGINE.chainLegs(ENGINE.stitchLegs(summarize(ENGINE.legsFromPoints(pts, { heli, patrol: cls === 'fighter' || cls === 'milheavy', cls, type: ac.type, rangeKm: ENGINE.typeRangeKm(ac), dataEnd: Math.min(nowS(), pts[pts.length - 1].t + 3600) }), hex)), legCtx(hex));
      return sums.find(s => dep >= s.tStart - 600 && dep <= s.tEnd) || sums.find(s => s.tStart > dep && s.tStart - dep < 3 * 3600) || null;
    } catch (e) { log('playback leg', String(e && e.message || e)); return null; }
  }
  // (two records of one flight made one: the fuller first, the other's points where it has none for 30 s and more)
  function pbMergePts(a, b) {
    const [x, y] = a.length >= b.length ? [a, b] : [b, a], out = x.slice().sort((p, q) => p.t - q.t);
    if (!y.length) return out;
    const ts = out.map(p => p.t), near = t => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; } return Math.min(lo < ts.length ? Math.abs(ts[lo] - t) : Infinity, lo > 0 ? Math.abs(ts[lo - 1] - t) : Infinity); };
    for (const p of y) if (near(p.t) >= 30) out.push(p);
    return out.sort((p, q) => p.t - q.t);
  }
  // (as many points as FR24's own records of a flight have: one every 8 s in the air, 20 s on the ground, and every turn,
  // climb or descent between - 3,000 at most)
  function pbThin(pts) {
    let step = 8, out = [];
    for (let k = 0; k < 6; k++) {
      out = []; let last = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], end = i === pts.length - 1;
        if (last && p.t <= last.t) continue;
        const turn = last && fin(p.trk) && fin(last.trk) && Math.abs(((p.trk - last.trk + 540) % 360) - 180) >= 12, climb = last && fin(p.alt) && fin(last.alt) && Math.abs(p.alt - last.alt) >= 300;
        if (!last || end || p.gnd !== last.gnd || p.t - last.t >= (p.gnd ? step * 2.5 : step) || ((turn || climb) && p.t - last.t >= 2)) { out.push(p); last = p; }
      }
      if (out.length <= 3000) break; step *= 2;
    }
    return out;
  }
  // (one flight out of a record of more: from its take-off - the first airborne point from dep on - to its first landing
  // after (down two minutes and more) or a hole of 45 minutes; ten minutes of the stand before and the taxi after)
  function pbCut(pts, dep) {
    let a = pts.findIndex(p => !p.gnd && p.t >= dep - 300); if (a < 0) a = pts.findIndex(p => !p.gnd); if (a < 0) return pts;
    let b = pts.length - 1;
    for (let i = a + 1; i < pts.length; i++) {
      if (pts[i].t - pts[i - 1].t > 2700) { b = i - 1; break; }
      if (pts[i].gnd) { let j = i; while (j + 1 < pts.length && pts[j + 1].gnd) j++; if (pts[j].t - pts[i].t >= 120 || j === pts.length - 1) { b = i; break; } i = j; }
    }
    const t0 = pts[a].t - 600, t1 = pts[b].t + 600;
    return pts.filter(p => p.t >= t0 && p.t <= t1);
  }
  // (the latest flight in a record: its last airborne point, back to where it took off)
  function pbLatestOff(pts) {
    let i = pts.length - 1; while (i >= 0 && pts[i].gnd) i--; if (i < 0) return 0;
    while (i > 0 && !pts[i - 1].gnd && pts[i].t - pts[i - 1].t <= 2700) i--;
    return pts[i].t;
  }
  // Everything FR24's player needs of one flight: { ok, id, hex, reg, cs, flightNumber, model, type, operator, msn,
  // origin, destination, dep, arr, pts, photos } - or { ok: false }
  async function pbFlight(d) {
    const id = clean(d.id).toLowerCase(), syn = PB_SYN.exec(id), fidNum = !syn && /^[0-9a-f]{1,12}$/.test(id) ? parseInt(id, 16) : 0;
    let hex = syn ? syn[1] : clean(d.hex).toLowerCase(), hint = syn ? parseInt(syn[2], 16) : Number(d.dep) || Number(d.at) || 0;
    // (1.4.1: the airports, OurAirports' fields and heliports and the landing sites, read before any end is named - a page
    // opened just to play the flight had none of them yet: every end "N/A" (G-GARE out of Farnborough), and no runway)
    const placesP = Promise.race([Promise.all([loadAirports().catch(() => null), loadOa().catch(() => null), loadSites().catch(() => null)]), sleep(8000)]);
    // (FR24's own flight: the monitor's positions of it - which say which aircraft it was - and its live record here)
    // (1.4.3: FR24's whole track of it, from FR24 itself within its week, where the monitor has only its scans' points)
    const raw = fidNum ? await pbFr24Whole(id, hint, await pbRaw(id, hint)) : { pts: [], m: {} };
    if (!/^[0-9a-f]{6}$/.test(hex) && fidNum && live.get(fidNum)) hex = clean(live.get(fidNum).hex).toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex) && /^[0-9a-f]{6}$/.test(raw.m.hex || '')) hex = raw.m.hex;
    if (!hint && raw.pts.length) hint = raw.pts[0].t;
    // (a flight of FR24's own the monitor has nothing of - one older than FR24's week: its aircraft from FR24's record of
    // the flight, else from its registration - this browser's register, the US one's formula, hexdb.io)
    if (!/^[0-9a-f]{6}$/.test(hex) && fidNum) hex = await hexOfFid(id, hint, d.reg).catch(() => '') || '';
    const reg0 = clean(d.reg).toUpperCase();
    if (!/^[0-9a-f]{6}$/.test(hex) && reg0) hex = clean((store.byReg(reg0) || {}).hex).toLowerCase() || (/^N\d/.test(reg0) ? clean(nNumberHex(reg0)).toLowerCase() : '');
    if (!/^[0-9a-f]{6}$/.test(hex) && /^[A-Z0-9-]{3,10}$/.test(reg0)) { try { hex = clean(await gmRequest(`https://hexdb.io/reg-hex?reg=${encodeURIComponent(reg0)}`, { json: false, accept: 'text/plain', timeout: 6000 })).toLowerCase(); } catch (e) { hex = ''; } }
    // (the flight among the aircraft's: the one nearest the moment known - its take-off; none: the one it is flying, else
    // its latest - 06-playback pbWhere)
    const w = await pbWhere({ id: fidNum, hex, reg: d.reg || raw.m.reg || '', cs: d.cs || raw.m.cs || '', dep: hint, at: Number(d.at) || 0, apId: Number(d.apId) || 0, kind: d.kind || '' }).catch(() => ({}));
    if (/^[0-9a-f]{6}$/.test(w.hex || '')) hex = w.hex;
    if (!/^[0-9a-f]{6}$/.test(hex) && !raw.pts.length) return { ok: false };
    let dep = w.dep > 0 ? w.dep : hint || (raw.pts.length ? raw.pts[0].t : 0);
    // (nothing known of when - the aircraft's latest flight asked for, none in its log: the last day's record says)
    let day = null;
    if (!(dep > 0) && /^[0-9a-f]{6}$/.test(hex)) { day = await pbAdsb(hex, nowS() - 86400, nowS()); dep = pbLatestOff(day); }
    if (!(dep > 0)) return { ok: false };
    // (1.4.1: its log read first, then the monitor's flights of it - pbLegNear)
    let leg = await pbLegNear(hex, dep);
    // (the time it took: its leg's, else what FR24's page or the record says - and for a flight still in the air, until now)
    let t0 = leg ? leg.tStart - 120 : dep - 600, t1 = leg ? (leg.ended ? leg.tEnd + 120 : nowS()) : w.end > dep ? w.end + 600 : Number(d.arr) > dep ? Number(d.arr) + 600 : 0;
    if (!(t1 > t0) && raw.pts.length) t1 = raw.pts[raw.pts.length - 1].t + 60;
    // (1.4.1: nothing known of when it ended: sixteen hours of its record - the longest flights - to find its landing in)
    if (!(t1 > t0)) t1 = Math.min(nowS(), t0 + 16 * 3600);
    // (1.4.0: the public track, FR24's positions of it and its pictures asked for together - each had waited for the one
    // before: some five seconds of FR24's flights page before its player)
    const hx0 = /^[0-9a-f]{6}$/.test(hex) ? store.getHex(hex) || {} : {};
    const photoP = !(hx0.photos || []).some(p => p && (p.large || p.medium)) && hex ? monPhotos(hex).catch(() => null) : Promise.resolve(null);
    // (FR24's positions of it: its own id's - else, a flight of a rebuilt log, its aircraft's then - before ADS-B's)
    const meta = Object.assign({}, raw.m || {});
    const [adsb, fr] = await Promise.all([
      /^[0-9a-f]{6}$/.test(hex) ? (day && t0 >= nowS() - 86400 ? Promise.resolve(day) : pbAdsb(hex, t0, t1).catch(() => [])) : Promise.resolve([]),
      raw.pts.length ? Promise.resolve(raw.pts) : pbFr24Of(hex, t0, t1, meta).catch(() => [])]);
    await placesP;
    let pts = pbFr24First(fr, adsb).filter(p => p.t >= t0 && p.t <= t1);
    // (no leg of it known: the flight made of the record here, its ends as its log would have them (1.4.1); else the
    // flight itself out of the record - not the day's other flights)
    if (!leg && pts.length > 1 && /^[0-9a-f]{6}$/.test(hex)) { const s = pbLegOfPts(hex, pts, dep); if (s && s.tEnd > s.tStart) { leg = s; pts = pts.filter(p => p.t >= s.tStart - 600 && p.t <= (s.ended ? s.tEnd + 600 : t1)); } }
    if (!leg && pts.length) pts = pbCut(pts, dep);
    if (pts.length < 2) return { ok: false };
    pts = pbThin(pts);
    // (its callsign: its leg's, its live record's, what the page or the monitor says - else what the aircraft sent)
    const lv = fidNum ? live.get(fidNum) : null, cs = clean((leg && leg.cs) || (lv && csOfRec(lv)) || d.cs || meta.cs || (pts.find(p => p.cs) || {}).cs || '').toUpperCase();
    // (its airports: its leg's; else where its track begins and ends on the ground - a field within 4 km; else FR24's
    // route of the flight, as kept with its positions)
    // (1.4.3: where its track begins or ends low and slow, the field there as its log names it - FR24's airports, and
    // OurAirports' fields and heliports; FR24's own positions of it begin on the ground, so the field it left is known
    // whatever ADS-B heard. M-PORT's flight of 27 Nov played "N/A - N/A": its leg's ends unknown, and only a field within
    // 4 km of a point marked on the ground was looked at. A leg's own end unknown no longer hides the track's)
    let heli = false; try { heli = ENGINE.classify({ type: clean(d.type || meta.type || hx0.type || '') }) === 'heli'; } catch (e) { heli = false; }
    const apAt = p => {
      if (!p || !fin(p.lat) || !fin(p.lon) || !(p.gnd || (fin(p.alt) && p.alt < 1200 && (!fin(p.gs) || p.gs < 140)))) return null;
      const n = heli ? ENGINE.heliAirportAt(p.lat, p.lon) || ENGINE.heliportAt(p.lat, p.lon, 1.2) : ENGINE.placeAt(p.lat, p.lon, p.gnd ? 4 : 6, 2);
      return n && n.airport ? apById(n.airport.id) || n.airport : null;
    };
    const apIata = c => { c = clean(c).toUpperCase(); return /^[A-Z0-9]{3}$/.test(c) ? airports.byIata.get(c) || null : null; };
    const legDone = !leg || !!leg.ended;
    // (a flight still in the air: where the map's route of it goes, when that is sure - filed, confirmed, or likely)
    const mr = /^[0-9a-f]{6}$/.test(hex) ? mapRoutes.get(hex) : null, pr = !legDone && mr && mr.route && !mr.route.landed && now() - mr.at < 10 * 60000 && goodPrediction(mr.route) ? apById(mr.route.destId) : null;
    const from = (leg && leg.from ? apById(leg.from.id) : null) || (w.depAp && apById(w.depAp)) || apAt(pts[0]) || apIata(meta.from);
    const to = (leg && leg.to ? apById(leg.to.id) : null) || (legDone ? apAt(pts[pts.length - 1]) : null) || apIata(meta.to) || pr;
    // (its landing: its leg's; else, its track ending down at a field, its last moment in the air)
    const lastAir = to && pts[pts.length - 1].gnd ? pts.slice().reverse().find(p => !p.gnd) : null;
    const depT = (leg && (leg.tOff || leg.tStart)) || dep || pts[0].t, arrT = leg && leg.ended ? (leg.tOn || leg.tEnd) : lastAir ? lastAir.t : 0;
    // (its runways, asked at once - ten seconds at most: the flight is not held back for them)
    const rwyP = Promise.race([pbRunways(/^[0-9a-f]{6}$/.test(hex) ? hex : '', fidNum ? id : '', from, to, depT, arrT), sleep(10000).then(() => null)]).then(r => r || { off: '', on: '' }, () => ({ off: '', on: '' }));
    // (1.4.1: who it flew for - the airline its callsign names, else the operator or owner the registers name - and its
    // flight number: the page's, FR24's own of the flight, else FR24's of its callsign - meanwhile)
    const [op, fn] = await Promise.all([pbOperator(hex, clean(d.reg || meta.reg || ''), cs), (async () => clean(d.flightNumber || meta.fn || '').toUpperCase() || csFlightNumber(cs))()]);
    const hx = /^[0-9a-f]{6}$/.test(hex) ? store.getHex(hex) || {} : {};
    let photos = (hx.photos || []).filter(p => p && (p.large || p.medium));
    if (!photos.length && hex) { try { const mp = await photoP; photos = goodPhotos((mp && mp.photos) || []).map(cleanPhoto); } catch (e) { /* none */ } }
    const rwys = await rwyP;
    return {
      ok: true, id: fidNum ? id : syn ? id : pbSynId(hex, (leg && (leg.tOff || leg.tStart)) || dep), hex, reg: clean(hx.reg || meta.reg || d.reg || '').toUpperCase(), cs,
      flightNumber: fn && fn !== cs ? fn : '', model: modelName(hx) || clean(meta.type || ''), type: clean(hx.type || meta.type || ''), operator: op.name, alId: op.alId || 0, msn: clean(hx.msn || ''),
      // (1.4.0: its tag - LADD, PIA, MIL - for FR24's player's header, as everywhere else it is shown)
      badge: badgeOf(hx),
      origin: pbAirport(from), destination: pbAirport(to), rwyOff: rwys.off || '', rwyOn: rwys.on || '',
      dep: depT, arr: arrT,
      pts: pts.map(p => ({ t: p.t, lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5, alt: p.gnd ? 0 : fin(p.alt) ? Math.round(p.alt) : null, gnd: !!p.gnd, gs: fin(p.gs) ? Math.round(p.gs) : null, trk: fin(p.trk) ? Math.round(p.trk) : null, vr: fin(p.vr) ? Math.round(p.vr) : null, sq: /^[0-7]{4}$/.test(p.sq || '') ? p.sq : '', ag: !p.gnd && fin(p.ag) ? Math.round(p.ag) : null, ias: fin(p.ias) && p.ias > 0 ? Math.round(p.ias) : null, tas: fin(p.tas) && p.tas > 0 ? Math.round(p.tas) : null })),
      photos: photos.slice(0, 5).map(p => ({ url: p.large || p.medium, link: p.link || '', copyright: p.credit || '' }))
    };
  }
  async function onPbPage(d) {
    let out = { ok: false };
    try { out = await pbFlight(d || {}); } catch (e) { log('playback page', String(e && e.message || e)); }
    postToPage('pbPageGot', Object.assign({ rid: d && d.rid }, out));
  }
  // ---- (1.4.1) FR24's own player of one of its own flights: what it leaves out - "Private owner" where the registers
  // name the aircraft's operator or owner (G-WAPA), "N/A" for an airport it has none of (a helicopter off a pad FR24 does
  // not list), its flight number - from this script's: the aircraft's log, the monitor's, and where FR24's own track of
  // the flight began and ended, down at a field (the page sends its ends: d.ends [first, last] { t, lat, lon, alt, gs })
  async function pbInfo(d, early) {
    const fid = clean(d && d.fid).toLowerCase(); if (!/^[0-9a-f]{1,12}$/.test(fid)) return { ok: false };
    const placesP = Promise.race([Promise.all([loadAirports().catch(() => null), loadOa().catch(() => null), loadSites().catch(() => null)]), sleep(8000)]);
    const fidNum = parseInt(fid, 16), dep = Number(d.dep) > 1e9 ? Number(d.dep) : 0;
    // (1.4.1: the monitor's positions of it asked for only when wanted, and not waited for where the page's own track says
    // where it began and ended - its N/A replaced at once: on a phone it was waiting for the monitor, then the log)
    let rawP = null; const rawOf = () => rawP || (rawP = pbRaw(fid, dep).catch(() => ({ pts: [], m: {} })));
    const ids = m => {
      const reg = clean(d.reg || m.reg || '').toUpperCase(), cs = clean(d.cs || m.cs || '').toUpperCase();
      let hex = clean(d.hex || (live.get(fidNum) || {}).hex || m.hex || '').toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(hex) && reg) hex = clean((store.byReg(reg) || {}).hex).toLowerCase() || (/^N\d/.test(reg) ? clean(nNumberHex(reg)).toLowerCase() : '');
      return { reg, cs, hex: /^[0-9a-f]{6}$/.test(hex) ? hex : '' };
    };
    const out = { ok: true, fid };
    const jobs = [];
    if (d.wantOwner) jobs.push(rawOf().then(raw => { const x = ids(raw.m || {}); return pbOperator(x.hex, x.reg, x.cs); }).then(op => { if (op.name) { out.operator = op.name; out.alId = op.alId || 0; } }));
    if (d.wantFn) jobs.push((async () => { const raw = await rawOf(), x = ids(raw.m || {}); if (!x.cs) return; const fn = clean((raw.m || {}).fn || '').toUpperCase() || await csFlightNumber(x.cs); if (fn && fn !== x.cs) out.flightNumber = fn; })());
    if (d.wantFrom || d.wantTo || d.wantCheck) jobs.push((async () => {
      await placesP;
      const x0 = ids({}), ac = x0.hex ? acOfHex(x0.hex) : {}, type = clean(d.type || ac.type || '').toUpperCase();
      const heli = ENGINE.classify(Object.assign({}, ac, type ? { type } : null)) === 'heli';
      const at = p => { const x = p && pbFr24Place(p, heli, !!ac.mil); return x && x.id ? apById(x.id) : null; };
      // (where FR24's own track of it - the page's - began and ended, down at a field: as the map's playback names them)
      const P = Array.isArray(d.ends) ? d.ends : [];
      let from = at(P[0]), to = at(P[1]);
      // (1.4.1) FR24's own airport of an end its track never came near - the track down at another field, over 5 km from
      // FR24's: that field (M-SKTO, 19 Nov: FR24's "Blackpool -> Liverpool", its track down in Gillmoss at Axis Business
      // Park's helipad). Its landing only once it is over: the track's end ten minutes old
      const fr24Ap = c => { c = clean(c).toUpperCase(); return /^[A-Z0-9]{3}$/.test(c) ? airports.byIata.get(c) || null : /^[A-Z0-9]{4}$/.test(c) ? ENGINE.byIcao(c) || null : null; };
      if (d.wantCheck) {
        const fa = !d.wantFrom && fr24Ap(d.fr24From), fb = !d.wantTo && fr24Ap(d.fr24To);
        if (fa && from && fa.id !== from.id && beatsAp(fa, from, P[0], heli)) { out.origin = pbAirport(from); out.originOver = true; }
        if (fb && to && fb.id !== to.id && P[1] && fin(P[1].t) && nowS() - P[1].t > 600 && beatsAp(fb, to, P[1], heli)) { out.destination = pbAirport(to); out.destOver = true; }
      }
      if (d.wantFrom && from) out.origin = pbAirport(from); if (d.wantTo && to) out.destination = pbAirport(to);
      if (early && (out.origin || out.destination)) early(Object.assign({}, out));
      if (!((d.wantFrom && !from) || (d.wantTo && !to))) return;
      // (else the aircraft's flight then - its log's, the monitor's - and the monitor's FR24 positions of it)
      const raw = await rawOf(), m = raw.m || {}, x = ids(m);
      const t0 = dep || (raw.pts.length ? raw.pts[0].t : 0), leg = x.hex && t0 ? await pbLegNear(x.hex, t0) : null;
      if (!from && leg && leg.from) from = apById(leg.from.id); if (!to && leg && leg.to && leg.ended) to = apById(leg.to.id);
      if (!from) from = at(raw.pts[0]); if (!to) to = at(raw.pts[raw.pts.length - 1]);
      const apIata = c => { c = clean(c).toUpperCase(); return /^[A-Z0-9]{3}$/.test(c) ? airports.byIata.get(c) || null : null; };
      if (!from) from = apIata(m.from); if (!to) to = apIata(m.to);
      if (d.wantFrom && from) out.origin = pbAirport(from); if (d.wantTo && to) out.destination = pbAirport(to);
    })());
    await Promise.all(jobs.map(j => j.catch(e => log('playback info', String(e && e.message || e)))));
    return out;
  }
  async function onPbInfo(d) {
    let out = { ok: false };
    // (1.4.1: its ends sent as soon as they are known - its operator and flight number after, as they come)
    try { out = await pbInfo(d || {}, part => postToPage('pbInfoGot', Object.assign({ rid: d && d.rid, partial: true }, part))); } catch (e) { log('playback info', String(e && e.message || e)); }
    postToPage('pbInfoGot', Object.assign({ rid: d && d.rid }, out));
  }
