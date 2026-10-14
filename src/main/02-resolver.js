
  // ---- ADS-B sources --------------------------------------------------------------------------------------------
  const numOr = v => (v == null || v === '' || !isFinite(Number(v))) ? NaN : Number(v);
  // on the ground: level, and no airspeeds / Mach / wind / temperature (a transponder sends none there; values an
  // aggregator still lists then are left over from the air - a taxiing jet at "410 kts")
  const GROUND_AIRDATA = { vs: 0, agps: NaN, ias: NaN, tas: NaN, mach: NaN, oat: NaN, wd: NaN, ws: NaN };
  function normalizeReadsb(ac, src, receivedAt) {
    if (!ac || typeof ac !== 'object') return null;
    let hex = clean(ac.hex).toLowerCase();
    const nonIcao = hex.startsWith('~'); if (nonIcao) hex = hex.slice(1);
    const lat = Number(ac.lat), lon = Number(ac.lon);
    if (!/^[0-9a-f]{6}$/.test(hex) || !fin(lat) || !fin(lon)) return null;
    const gnd = ac.alt_baro === 'ground';
    const alt = gnd ? 0 : Number(ac.alt_baro);
    const dbFlags = Number(ac.dbFlags) || 0;
    const sq = /^[0-7]{4}$/.test(clean(ac.squawk)) ? clean(ac.squawk) : '';
    return { hex, nonIcao, cs: clean(ac.flight).toUpperCase(), reg: clean(ac.r).toUpperCase(), type: clean(ac.t).toUpperCase(), desc: clean(ac.desc), owner: clean(ac.ownOp), year: Number(ac.year) || 0,
      lat, lon, alt: fin(alt) ? alt : NaN, gnd, gs: Number(ac.gs), trk: Number(ac.track), ageS: (Number(ac.seen_pos) || 0), receivedAt, dbFlags, ladd: !!(dbFlags & 8), pia: !!(dbFlags & 4), mil: !!(dbFlags & 1), src,
      cat: clean(ac.category).toUpperCase(), sq, squawk: sq ? parseInt(sq, 8) : 0, emergency: clean(ac.emergency),
      // everything the panel's own fields can show, straight from the transponder
      vs: fin(numOr(ac.baro_rate)) ? numOr(ac.baro_rate) : numOr(ac.geom_rate), agps: numOr(ac.alt_geom), ias: numOr(ac.ias), tas: numOr(ac.tas), mach: numOr(ac.mach), oat: numOr(ac.oat), wd: numOr(ac.wd), ws: numOr(ac.ws), mcp: numOr(ac.nav_altitude_mcp), fms: numOr(ac.nav_altitude_fms), navHdg: numOr(ac.nav_heading), qnh: numOr(ac.nav_qnh), ...(gnd ? GROUND_AIRDATA : {}) };
  }
  const telemOf = c => c ? { gnd: !!c.gnd, vr: c.vs, sq: c.squawk || 0, sqs: c.sq || '', agps: c.agps, ias: c.ias, tas: c.tas, mach: c.mach, oat: c.oat, wd: c.wd, ws: c.ws, mcp: c.mcp, fms: c.fms, cat: c.cat, emergency: c.emergency, ...firFields(c), at: c.receivedAt - (c.ageS || 0) * 1000 } : null;
  const firFields = c => { const f = firInfo(c.lat, c.lon, c.gnd ? 0 : c.alt); return f ? { air: f.name, airId: f.code } : { air: '', airId: '' }; };
  const readsbList = j => Array.isArray(j && j.ac) ? j.ac : Array.isArray(j && j.aircraft) ? j.aircraft : [];
  // (altFn: an older address of the same query, asked when the first is not found - adsb.fi moved its area query to v3)
  const readsbSource = (name, host, urlFn, hexFn, altFn) => ({
    name, host,
    area: (lat, lon, r) => { const rr = Math.min(250, Math.round(r)); return gmRequest(urlFn(lat, lon, rr)).catch(e => { if (altFn && /HTTP (400|404|410)/.test(String(e))) return gmRequest(altFn(lat, lon, rr)); throw e; }).then(j => { const t = now(); return readsbList(j).map(a => normalizeReadsb(a, name, t)).filter(Boolean); }); },
    hex: hexFn ? hex => gmRequest(hexFn(hex), { timeout: 8000, priority: true }).then(j => { const t = now(); return readsbList(j).map(a => normalizeReadsb(a, name, t)).filter(Boolean)[0] || null; }) : null
  });
  // ADS-B Exchange through its official API (RapidAPI "adsbexchange-com1"): readsb v2 answers like the others, from a
  // feeder network of its own. The key is the user's (the strip's tools: "ADS-B Exchange key", kept in kv 'adsbxKey');
  // without one nothing is sent there. A paid plan has a monthly quota, so it is a fallback: a flight the free
  // aggregators could not identify after two tries, or the selected aircraft when they have nothing for it.
  const ADSBX_HOST = 'adsbexchange-com1.p.rapidapi.com';
  const adsbxKey = () => { try { return String(store.kvGet('adsbxKey') || '').trim(); } catch (e) { return ''; } };
  function adsbxSource() {
    const hdr = () => ({ 'X-RapidAPI-Key': adsbxKey(), 'X-RapidAPI-Host': ADSBX_HOST });
    const list = j => { const t = now(); return readsbList(j).map(a => normalizeReadsb(a, 'ADS-B Exchange', t)).filter(Boolean); };
    return { name: 'ADS-B Exchange', host: ADSBX_HOST, fallback: true, enabled: () => !!adsbxKey(),
      area: (lat, lon, r) => gmRequest(`https://${ADSBX_HOST}/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.min(250, Math.round(r))}/`, { headers: hdr() }).then(list),
      hex: hex => gmRequest(`https://${ADSBX_HOST}/v2/hex/${hex}/`, { headers: hdr(), timeout: 8000, priority: true }).then(j => list(j)[0] || null) };
  }
  const SOURCES = [
    readsbSource('adsb.lol', 'api.adsb.lol', (la, lo, r) => `https://api.adsb.lol/v2/point/${la.toFixed(4)}/${lo.toFixed(4)}/${r}`, hex => `https://api.adsb.lol/v2/hex/${hex}`),
    readsbSource('adsb.fi', 'opendata.adsb.fi', (la, lo, r) => `https://opendata.adsb.fi/api/v3/lat/${la.toFixed(4)}/lon/${lo.toFixed(4)}/dist/${r}`, hex => `https://opendata.adsb.fi/api/v2/hex/${hex}`, (la, lo, r) => `https://opendata.adsb.fi/api/v2/lat/${la.toFixed(4)}/lon/${lo.toFixed(4)}/dist/${r}`),
    // ADS-B Exchange (its own feeder network - it sees aircraft the others miss): the official API, with the user's own
    // key (Settings); without one it is simply not asked
    adsbxSource()
  ].filter(Boolean);
  const usable = s => (!s.enabled || s.enabled()) && (deadHosts.get(s.host) || 0) < now();
  const liveSources = () => { const l = SOURCES.filter(s => !s.fallback && usable(s)); return l.length ? l : SOURCES.slice(0, 1); };
  const fallbackSources = () => SOURCES.filter(s => s.fallback && usable(s));
  // Everything the aggregators have reported around the map (area sweeps, the view poll, the LADD/military lists, hex
  // lookups): live telemetry and database facts for EVERY aircraft on screen, ordinary ones included - so opening any of
  // them shows its padlocked fields at once instead of after a lookup.
  const areaCache = new Map();   // hex -> newest normalized record
  const seenAt = c => c.receivedAt - (c.ageS || 0) * 1000;
  function noteCands(list) {
    for (const c of list || []) { if (!c || !c.hex) continue; const p = areaCache.get(c.hex); if (!p || seenAt(c) >= seenAt(p)) areaCache.set(c.hex, c); noteLastSeen(c); }
    if (areaCache.size > 12000) { const cut = now() - 10 * 60000; for (const [k, v] of areaCache) if (v.receivedAt < cut) areaCache.delete(k); }
    refreshCallsigns(list);
  }
  // ---- out of coverage: where each jet was last seen, reckoned forward --------------------------------------------
  // Over an ocean FR24 has satellite positions the public networks do not (M-BIZZ mid-Atlantic, 1 Oct: FR24 "tracked
  // via satellite", the aggregators' last report from leaving Bermuda an hour before). Every jet seen cruising is
  // remembered for five hours - where, when, its track, speed and height - by type; an unidentified FR24 flight cruising
  // where nobody else hears it is compared with each of them carried forward to now. One clear fit identifies it.
  // (jets of every type - and those whose type no database has yet, kept apart: N88RZ, a 2026 G500 adsb.lol knew nothing
  // of, crossed the Atlantic "unidentified" because only jets of a known type were remembered)
  const lastSeenByType = new Map();   // type ('' not known) -> Map(hex -> { c, t })
  function noteLastSeen(c) {
    if (c.gnd || c.nonIcao || !(c.alt > 15000) || !(c.gs > 200) || !fin(c.trk)) return;
    const ty = clean(c.type).toUpperCase(); let m = lastSeenByType.get(ty); if (!m) { m = new Map(); lastSeenByType.set(ty, m); }
    const t = seenAt(c), p = m.get(c.hex); if (!p || t > p.t) m.set(c.hex, { c, t });
    if (m.size > 400) { const cut = now() - 5 * 3600e3; for (const [k, v] of m) if (v.t < cut) m.delete(k); }
  }
  // Carried forward on a constant track - the mean of its track then and FR24's now - at the mean of the two speeds
  // (engine.reckon: N88RZ 15 km off after 2 h 52 min over the Atlantic; a great circle on the old track, 478 km), and
  // judged along the track (speed, wind) and across it (heading) apart. A jet of another type family is not it. Only
  // where a track does not turn - the whole way over open ocean or empty desert, no airport within 150 km of it
  // (engine.remotePath): over land airways turn, and carried forward there it is wrong more often than right. And only
  // tight and alone: within 15 km + 4% of the distance along the track, 10 km + 2% across it (N88RZ: 13 and 7 km off
  // after 2,290 km), no other jet within three times as close.
  const reckonFit = (c, age, f) => {
    if (!ENGINE.remotePath(c, age, f.trk, f.spd)) return null;
    const [rl, ro, trk] = ENGINE.reckon(c, age, f.trk, f.spd), e = ENGINE.trackErr(rl, ro, f.lat, f.lon, trk), km = c.gs * NM_KM * age / 3600;
    const s = Math.max(Math.abs(e.along) / (15 + 0.04 * km), Math.abs(e.cross) / (10 + 0.02 * km));
    return s <= 1 ? { s, d: Math.hypot(e.along, e.cross) } : null;
  };
  function matchReckoned(f) {
    if (!f || f.gnd || !(f.alt > 15000) || !fin(f.lat)) return null;
    const ft = clean(f.type).toUpperCase(), t = now(), taken = takenHexes(f.id, t), fits = [];
    for (const [ty, m] of lastSeenByType) {
      const rel = typeRelation(ty, ft); if (rel === 'different' || (!ft && ty)) continue;
      for (const { c, t: seen } of m.values()) {
        const age = (t - seen) / 1000;
        if (age < 150 || age > 5 * 3600 || taken.has(c.hex)) continue;            // (heard lately: the ordinary match is for that)
        if (fin(c.alt) && fin(f.alt) && Math.abs(c.alt - f.alt) > 3000) continue;
        if (fin(f.trk) && angDiff(f.trk, c.trk) > 30) continue;
        const gs = c.gs > 200 ? c.gs : f.spd;                                     // (ADS-C reports often carry no speed)
        const r = reckonFit(Object.assign({}, c, { gs }), age, f);
        if (r) fits.push({ c, d: r.d, s: r.s, rel: rel === 'unknown' ? 'unknown' : 'same', age });
      }
    }
    if (!fits.length) return null;
    fits.sort((a, b) => a.s - b.s);
    if (fits[1] && fits[1].s < fits[0].s * 3) return null;                     // two could be it: none is
    return fits[0];
  }
  // ---- out of coverage, never heard here: its track against the day's tracks of the aircraft it could be -----------
  // An unidentified flight cruising where no public receiver hears it - over an ocean - that neither this page nor the
  // monitor heard before it left coverage (FR24 closed, the monitor not running): FR24's own track of it (its playback,
  // from take-off, free) laid against adsb.lol's track of the day of each blocked aircraft of its type not heard anywhere
  // else just now. The one whose positions agree with FR24's - three minutes and more of them, within 3 km - is it. With
  // no FR24 track, the one whose last report of the day, carried forward, ends where FR24 has the flight now. One clear
  // fit only; two that could be it, none. One flight at a time, each at most every ten minutes.
  let traceBusy = false; const traceAsked = new Map(), dayPts = new Map();
  async function dayTrack(hex, since) {
    const days = [''].concat(since < Date.parse(dayStr(now()).replace(/\//g, '-') + 'T00:00:00Z') / 1000 ? [dayStr(since * 1000)] : []), out = [];
    for (const d of days) {
      const k = hex + '|' + d, c = dayPts.get(k);
      let pts = c && now() - c.at < 10 * 60000 ? c.pts : null;
      if (!pts) { try { pts = ENGINE.parseTrace(await fetchTrace(hex, d, { bg: true, back: d ? 1 : 0 })); } catch (e) { pts = []; } dayPts.set(k, { at: now(), pts }); if (dayPts.size > 120) dayPts.delete(dayPts.keys().next().value); }
      for (const p of pts) out.push(p);
    }
    return out.sort((a, b) => a.t - b.t);
  }
  async function fr24Playback(id) {
    try {
      const j = await gmRequest(`https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${id.toString(16)}&timestamp=${Math.round(nowS())}`, { timeout: 15000, bg: true });
      const tr = j && j.result && j.result.response && j.result.response.data && j.result.response.data.flight && j.result.response.data.flight.track;
      return Array.isArray(tr) && tr.length > 10 ? tr.map(p => ({ t: p.timestamp, lat: p.latitude, lon: p.longitude, alt: p.altitude ? p.altitude.feet : null })).filter(p => fin(p.lat) && fin(p.t)).sort((a, b) => a.t - b.t) : null;
    } catch (e) { return null; }
  }
  // adsb.lol's history of every aircraft it heard, every 20 s (its heatmap: a file per half hour, ~27 MB, records of 16
  // bytes - address, lat and lon x1e6, altitude /25 ft, speed x10 kt - after a marker with the time): who was where FR24's
  // track had the flight at that moment. Read only when nothing cheaper named a flight - one file in two minutes for the
  // flight opened, one in fifteen otherwise - and kept until another is needed.
  const heat = { url: '', buf: null, selAt: 0, bgAt: 0 };
  function gmBinary(url, timeout) {
    const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
    return new Promise((res, rej) => { if (!gm) return rej(new Error('GM_xmlhttpRequest unavailable')); gm({ method: 'GET', url, responseType: 'arraybuffer', timeout, onload: r => r.status === 200 && r.response ? res(r.response) : rej(new Error('HTTP ' + r.status)), onerror: () => rej(new Error('network error')), ontimeout: () => rej(new Error('timeout')) }); });
  }
  async function heatNear(t, posAt, altFt, sel) {
    const d = new Date(t * 1000), url = `https://adsb.lol/globe_history/${dayStr(t * 1000)}/heatmap/${String(d.getUTCHours() * 2 + (d.getUTCMinutes() >= 30 ? 1 : 0)).padStart(2, '0')}.bin.ttf`;
    if (heat.url !== url) {
      if (now() - (sel ? heat.selAt : Math.max(heat.selAt, heat.bgAt)) < (sel ? 2 : 15) * 60000) return [];
      if (sel) heat.selAt = now(); else heat.bgAt = now();
      try { heat.buf = await gmBinary(url, 180000); heat.url = url; } catch (e) { log('heatmap', String(e)); return []; }
    }
    return ENGINE.heatNear(heat.buf, t, posAt, altFt);
  }
  async function matchByTraces(f) {
    if (traceBusy || !f || live.has(f.id) || f.gnd || !(f.alt > 10000) || now() - (traceAsked.get(f.id) || 0) < 10 * 60000) return false;
    traceAsked.set(f.id, now()); if (traceAsked.size > 500) traceAsked.delete(traceAsked.keys().next().value);
    traceBusy = true;
    try {
      const type = clean(f.type).toUpperCase(), taken = takenHexes(f.id, now());
      const heardNow = h => { const a = areaCache.get(h); return !!a && now() - seenAt(a) < 180000; };
      // FR24's own track of the flight: the trail its follow stream gives - the flight opened, else asked for in the
      // background (the page reads its first frame) - else its playback (none for a blocked flight)
      let ft = fr24Trail.get(f.id);
      if (!(ft && ft.pts && ft.pts.length >= 10)) { postToPage('needTrail', { id: f.id }); for (let i = 0; i < 60 && !((ft = fr24Trail.get(f.id)) && ft.pts && ft.pts.length >= 10); i++) await sleep(250); }
      const trk = ft && ft.pts && ft.pts.length >= 10 ? ft.pts.filter(p => fin(p.lat) && fin(p.t)) : await fr24Playback(f.id);
      // (where FR24's track had it at time t - between two of its fixes at most two minutes apart)
      const at = t => { if (!trk) return null; let lo = 0, hi = trk.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (trk[m].t < t) lo = m + 1; else hi = m; } const y = trk[lo], x = trk[lo - 1] || y; if (!y || t > y.t || t < x.t || y.t - x.t > 120) return null; const k = y.t > x.t ? (t - x.t) / (y.t - x.t) : 0; return [x.lat + (y.lat - x.lat) * k, x.lon + (y.lon - x.lon) * k]; };
      // The aircraft it could be: every jet last heard cruising (2.5 min - 8 h ago) of its type, or of a type no
      // database has yet - first those last heard right on FR24's track of it - then the blocked aircraft of its type
      const cands = new Map();
      for (const [ty, m] of lastSeenByType) {
        const rel = typeRelation(ty, type); if (rel === 'different' || (!type && ty)) continue;
        for (const { c, t } of m.values()) {
          const age = (now() - t) / 1000; if (age < 150 || age > 8 * 3600 || taken.has(c.hex) || heardNow(c.hex)) continue;
          const q = at(t / 1000), off = q ? dist(q[0], q[1], c.lat, c.lon) : Infinity;
          if (trk && off > 10) continue;                                             // (heard somewhere FR24's flight was not)
          cands.set(c.hex, { hex: c.hex, v: Object.assign({ reg: c.reg, type: c.type, ladd: c.ladd }, store.getHex(c.hex) || {}), rank: off });
        }
      }
      // (with FR24's track the history lookup below decides; without it, the blocked aircraft of its type kept here, the
      // eight seen most lately)
      if (type && !trk) for (const [h, v] of store.allHex()) if (v && v.ladd && !cands.has(h) && !taken.has(h) && !heardNow(h) && typeRelation(v.type, type) === 'same') cands.set(h, { hex: h, v, rank: 1e6 - Math.max(v.idAt || 0, v.pubAt || 0) / 1e9 });
      const list = [...cands.values()].sort((a, b) => a.rank - b.rank).slice(0, 8);
      if (!list.length && !trk) return false;
      const since = trk ? trk[0].t : nowS() - 5 * 3600, fits = [];
      const agree = (hex, v, pts) => { const a = ENGINE.trackAgree(trk, pts); if (a.n >= 6 && a.span >= 180 && a.bad <= Math.max(1, a.n * 0.05)) fits.push({ hex, v, pts, s: a.medKm, why: `its ADS-B track lies on FR24's for ${Math.round(a.span / 60)} min` }); };
      for (const { hex, v } of list) {
        if (live.has(f.id)) return true;
        await idleSlice(); const pts = await dayTrack(hex, since); if (!pts.length) continue;
        // its ADS-B track and FR24's side by side - three minutes and more of reports within 3 km: it
        if (trk) { agree(hex, v, pts); continue; }
        // (no FR24 track: its last report of the day, cruising, carried forward - over open ocean or desert only, tightly)
        const c = [...pts].reverse().find(p => !p.gnd && fin(p.alt) && p.alt > 15000 && p.gs > 200 && fin(p.trk)); if (!c) continue;
        const age = nowS() - c.t; if (age < 150 || age > 5 * 3600 || (fin(f.alt) && Math.abs(c.alt - f.alt) > 3000) || (fin(f.trk) && angDiff(f.trk, c.trk) > 30)) continue;
        const r = reckonFit(c, age, f); if (r) fits.push({ hex, v, pts, s: r.s, why: `last heard ${Math.round(age / 60)} min ago over open water, carried forward to here` });
      }
      // Nobody known could be it: who adsb.lol heard where FR24's track had the flight - climbing out, ten minutes after
      // passing 10,000 ft (over land, in reach of receivers), and half an hour on for a flight opened - each of them
      // then laid against FR24's track as above
      if (!fits.length && trk && !live.has(f.id)) {
        const sel = !!f.sel || currentId() === f.id, tried = new Set(list.map(x => x.hex)), up = trk.find(p => p.alt > 10000);
        for (const t of up ? [up.t + 600].concat(sel ? [up.t + 2400] : []) : []) {
          if (t > trk[trk.length - 1].t || fits.length) break;
          const nearAlt = (trk.find(p => p.t >= t) || {}).alt;
          for (const hex of await heatNear(t, at, nearAlt, sel)) {
            if (tried.has(hex) || taken.has(hex) || live.has(f.id)) continue; tried.add(hex);
            await idleSlice(); const pts = await dayTrack(hex, since), tm = traceMeta.get(hex) || {}, v = Object.assign({ reg: tm.r || '', type: tm.t || '', ladd: !!(tm.flags & 8) }, store.getHex(hex) || {});
            if (pts.length && typeRelation(v.type, type) !== 'different') agree(hex, v, pts);
          }
        }
      }
      fits.sort((a, b) => a.s - b.s);
      // (one, and only one: two that could be it - none is)
      if (!fits.length || fits.length > 1 && fits[1].s < fits[0].s * 3 || live.has(f.id)) { if (fits.length > 1) log('track match: more than one could be it', f.id.toString(16), fits.slice(0, 3).map(x => x.hex)); return false; }
      const m = fits[0], p = m.pts[m.pts.length - 1], reg = m.v.reg || hexNNumber(m.hex);
      const c = { hex: m.hex, reg, type: m.v.type || type, desc: m.v.desc || '', owner: m.v.owner || '', lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs, trk: p.trk, gnd: false, ageS: 0, receivedAt: p.t * 1000, ladd: !!m.v.ladd, mil: !!m.v.mil, src: 'adsb.lol track' };
      // (the type FR24 gives where the databases have none; whether FR24 hides it, from its own list of the aircraft)
      store.mergeHex(m.hex, Object.assign({ reg }, !m.v.type && type ? { type } : {}));
      if (reg && !m.v.ladd) fr24.flightsOf(reg, true).catch(() => {});
      adopt(recordFromMatch(f, { c, rel: 'same', d: 0, s: m.s }, ['adsb.lol (' + m.why + ')']));
      log('identified by its track', f.id.toString(16), m.hex, m.why);
      return true;
    } finally { traceBusy = false; }
  }
  // On the ground where no public receiver hears the ground (Le Bourget's aprons: OE-LYS, transponder on before taxiing,
  // heard by one ADS-B Exchange feeder, by neither adsb.lol nor adsb.fi): the blocked aircraft of its type whose last
  // flight - the monitor's log, or this page's - ended at this airport and that has not flown since (its track of the
  // days since has no flight in it). One such aircraft only; two that could be it, none.
  const parkedAsked = new Map();
  async function matchParked(f) {
    if (!f || live.has(f.id) || !f.type || now() - (parkedAsked.get(f.id) || 0) < 10 * 60000) return false;
    const here = ENGINE.placeAt(f.lat, f.lon, 7, 2), ap = here && here.airport; if (!ap || ap.id >= 1e7) return false;
    parkedAsked.set(f.id, now()); if (parkedAsked.size > 500) parkedAsked.delete(parkedAsked.keys().next().value);
    const type = clean(f.type).toUpperCase(), taken = takenHexes(f.id, now()), cands = new Map();
    const heardNow = h => { const a = areaCache.get(h); return !!a && now() - seenAt(a) < 180000 && !(a.gnd && dist(a.lat, a.lon, f.lat, f.lon) < 3); };
    const consider = (hex, reg, ty, last, ladd) => { if (!last || !last.to || last.to.id !== ap.id || !last.ended || taken.has(hex) || heardNow(hex) || typeRelation(ty, type) !== 'same' || nowS() - (last.tEnd || 0) > 14 * 86400) return; cands.set(hex, { hex, reg, type: ty, last, ladd }); };
    // (the monitor's aircraft of the type whose last flight ended here, two weeks back - one small answer)
    const j = await monGet(`/parked?ap=${ap.id}&type=${encodeURIComponent(type)}`).catch(() => null);
    for (const a of (j && j.list) || []) consider(a.hex, a.reg, a.type, a.last, a.ladd);
    for (const [h, v] of store.allHex()) if (v && v.ladd && !cands.has(h) && typeRelation(v.type, type) === 'same') consider(h, v.reg, v.type, compactToLegs(v.recent || []).filter(l => l.tStart < nowS() - 300).sort((a, b) => a.tStart - b.tStart).pop(), true);
    // (not flown since: nothing airborne in its tracks after that landing)
    const parked = [];
    for (const c of [...cands.values()].slice(0, 8)) {
      if (live.has(f.id)) return true;
      await idleSlice(); const pts = await dayTrack(c.hex, c.last.tEnd);
      if (!pts.some(p => p.t > c.last.tEnd + 300 && !p.gnd0 && fin(p.alt) && p.alt > (ap.alt || 0) + 1500)) parked.push(c);
    }
    if (parked.length !== 1 || live.has(f.id)) { if (parked.length > 1) log('parked match: more than one could be it', f.id.toString(16), parked.map(x => x.hex)); return false; }
    const m = parked[0], from = m.last.from && apById(m.last.from.id), when = new Date(m.last.tEnd * 1000).toISOString().slice(5, 16).replace('T', ' ');
    const c = { hex: m.hex, reg: m.reg || hexNNumber(m.hex), type: m.type || type, lat: f.lat, lon: f.lon, alt: 0, gs: f.spd || 0, trk: f.trk, gnd: true, ageS: 0, receivedAt: now(), ladd: !!m.ladd, src: 'parked here' };
    adopt(recordFromMatch(f, { c, rel: 'same', d: 0, s: 0 }, [`on the ground at ${apCode(ap)} since it landed there${from ? ' from ' + apCode(from) : ''} (${when} UTC) - the only ${type} known to have landed here and not left; the public networks do not hear its ground`]));
    log('identified parked', f.id.toString(16), m.hex, apCode(ap));
    return true;
  }
  // Out of public coverage - an ocean, a desert: FR24's satellite (ADS-C) or estimated positions, or no airport within 150
  // km - every unnamed flight there goes through the lookup above, one at a time, the one opened first (each again after
  // ten minutes at most). Whether the page or the monitor ever heard it makes no difference: adsb.lol's history did.
  const remoteAt = (lat, lon) => { let hit = false; ENGINE.nearby(lat, lon, 150, () => { hit = true; }); return !hit; };
  setInterval(() => {
    if (traceBusy || ENGINE.airports.length < 1000) return;              // (no airports yet: everywhere would look remote)
    const t = now(), sel = currentId();
    const list = [...pending.values()].filter(f => !live.has(f.id) && !f.gnd && f.alt > 10000 && t - f.receivedAt < 120000 && f.type !== 'GRND' && f.icon !== 25 && fin(f.lat) && t - (traceAsked.get(f.id) || 0) >= 10 * 60000 && (f.src === 4 || f.src === 5 || remoteAt(f.lat, f.lon)));
    list.sort((a, b) => (b.id === sel) - (a.id === sel) || b.receivedAt - a.receivedAt);
    if (list[0]) { matchByTraces(list[0]).catch(e => log('track match', e)); return; }
    // (and an unnamed aircraft on the ground at an airport, twice looked for in vain: parked there since a landing?)
    const g = [...pending.values()].find(f => !live.has(f.id) && f.gnd && t - f.receivedAt < 120000 && f.type && f.type !== 'GRND' && f.icon !== 25 && (attempts.get(f.id) || {}).n >= 2 && t - (parkedAsked.get(f.id) || 0) >= 10 * 60000);
    if (g) matchParked(g).catch(e => log('parked match', e));
  }, 30000);
  // (and from the permanent monitor, which heard them while FR24 was closed: every LADD jet of the last 14 hours)
  function monLastSeen() {
    monGet('/last').then(j => { monSeed(); for (const x of (j && j.list) || []) noteLastSeen({ hex: x.hex, cs: x.cs || '', reg: x.reg || '', type: clean(x.type).toUpperCase(), ladd: x.ladd !== false, lat: x.lat, lon: x.lon, alt: x.alt, gs: x.gs, trk: x.trk, gnd: false, ageS: 0, receivedAt: x.t * 1000, src: 'monitor' }); }).catch(() => {});
  }
  setTimeout(monLastSeen, 3000); setTimeout(monLastSeen, 9000); setInterval(monLastSeen, 120000);
  // (every LADD aircraft identified here before, most recently seen first: the monitor rebuilds their last three days -
  // one parked with its transponder off since before the monitor started is never heard by it: M-ARNZ at Barrow)
  // (and every one identified since - the world scan's, a search's - two minutes later: the monitor follows it worldwide)
  const monSent = new Set();
  function monSeed() {
    const list = [...store.allHex()].filter(([h, v]) => v && v.ladd && !monSent.has(h)).sort((a, b) => (b[1].idAt || b[1].pubAt || 0) - (a[1].idAt || a[1].pubAt || 0)).map(([h]) => h);
    if (!list.length) return;
    const first = !monSent.size; for (const h of list) monSent.add(h);
    (async () => { for (let i = 0; i < list.length; i += 300) await monGet('/seed?hex=' + list.slice(i, i + 300).reverse().join(',') + (i || !first ? '' : '&front=1')).catch(() => { for (const h of list.slice(i, i + 300)) monSent.delete(h); }); })();
  }
  // (kept across reloads, compactly: a page opened after the aircraft left coverage still knows where it went)
  store.kvReady.then(() => { const o = store.kvGet('lastSeen1'); if (o && Array.isArray(o.list)) for (const c of o.list) noteLastSeen(c); }).catch(() => {});
  setInterval(() => {
    idleSlice().then(() => {
      const cut = now() - 5 * 3600e3, list = [];
      for (const m of lastSeenByType.values()) for (const { c, t } of m.values()) if (t > cut) list.push({ hex: c.hex, cs: c.cs || '', reg: c.reg || '', type: c.type, ladd: !!c.ladd, pia: !!c.pia, mil: !!c.mil, lat: c.lat, lon: c.lon, alt: c.alt, gs: c.gs, trk: c.trk, gnd: false, ageS: 0, receivedAt: t, src: c.src || '' });
      store.kvSet('lastSeen1', { at: now(), list: list.slice(-4000) });
    }).catch(() => {});
  }, 120000);
  // The callsign can come later than the match - the aggregator that answered first had none (I-ADVD, 30 Sep: matched
  // from adsb.fi without one and shown under its registration for the whole flight while adsb.lol had SIO512) - or
  // change on the ground between legs: the newest report that has one, less than a minute old, wins.
  function refreshCallsigns(list) {
    if (!list || !list.length || !live.size) return;
    let byHex = null;
    for (const c of list) {
      if (!c || !c.cs || c.nonIcao || (c.ageS || 0) > 60) continue;
      if (!byHex) { byHex = new Map(); for (const r of live.values()) if (r.hex) (byHex.get(r.hex) || byHex.set(r.hex, []).get(r.hex)).push(r); }
      for (const r of byHex.get(c.hex) || []) {
        if (r.cs === c.cs || (r.csAt || 0) > seenAt(c)) continue;
        r.cs = c.cs; r.csAt = seenAt(c); store.setId(r.id, r); pushToPage([r]); if (onScreen(r.id)) syncPanelSoon();
      }
    }
  }
  const OPENSKY = { name: 'OpenSky', hex: null, area: (lat, lon, r) => {
    const dLat = r * NM_KM / 111.32, dLon = r * NM_KM / (111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    return gmRequest(`https://opensky-network.org/api/states/all?lamin=${(lat - dLat).toFixed(3)}&lomin=${(lon - dLon).toFixed(3)}&lamax=${(lat + dLat).toFixed(3)}&lomax=${(lon + dLon).toFixed(3)}`, { timeout: 12000 }).then(j => {
      const t = now(), base = Number(j && j.time) || Math.round(t / 1000);
      return (Array.isArray(j && j.states) ? j.states : []).map(s => { const hex = clean(s[0]).toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex) || !fin(s[6]) || !fin(s[5])) return null; return { hex, cs: clean(s[1]).toUpperCase(), reg: '', type: '', desc: '', owner: '', year: 0, lat: s[6], lon: s[5], alt: s[7] == null ? NaN : s[7] * 3.28084, gnd: !!s[8], gs: s[9] == null ? NaN : s[9] * 1.94384, trk: s[10] == null ? NaN : s[10], ageS: Math.max(0, base - (s[3] || base)), receivedAt: t, dbFlags: 0, ladd: false, pia: false, mil: false, src: 'OpenSky', vs: s[11] == null ? NaN : s[11] * 196.85 }; }).filter(Boolean);
    });
  } };
  let sourceRotation = 0;

  // The global LADD and military lists: every such aircraft the aggregator currently tracks, anywhere. Matching
  // against them needs no request at all, and they carry each aircraft's live telemetry.
  // With the monitor answering, its live list (/live: the LADD, military and PIA lists and every other blocked aircraft,
  // polled on the server) is the list: this browser asks adsb.lol / adsb.fi for none of them. Its own requests are the
  // backup - the monitor down, or its LADD list older than 90 s (its military list older than 3 min: that one only).
  const globalList = { items: [], byHex: new Map(), at: 0, loading: null, src: '' };
  const monLive = { at: 0, n: 0, ok: false };   // (the strip's "sources" pop-over: when the monitor's list last came, how big)
  async function takeLive(opts) {
    const j = await monGet('/live', opts);
    const age = j && j.age, ok = !!(j && Array.isArray(j.ac) && age && age.ladd != null && age.ladd < 90);
    monLive.at = now(); monLive.n = j && Array.isArray(j.ac) ? j.ac.length : 0; monLive.ok = ok;
    if (!ok) return null;
    // (each row's seen_pos is counted to the monitor's "now": it came just now)
    const t = now(), got = new Map();
    for (const a of j.ac) { const c = normalizeReadsb(a, 'monitor', t); if (c) got.set(c.hex, c); }
    return { got, milOk: age.mil != null && age.mil < 180 };
  }
  function refreshLists(force) {
    if (globalList.loading) return globalList.loading;
    if (!force && now() - globalList.at < LIST_REFRESH_MS) return Promise.resolve(globalList.items);
    globalList.loading = (async () => {
      const lv = await takeLive().catch(() => null);
      const got = lv ? lv.got : new Map(); let src = lv ? 'monitor' : '';
      for (const [name, url] of [['adsb.lol', 'https://api.adsb.lol/v2/ladd'], ['adsb.lol', 'https://api.adsb.lol/v2/mil'], ['adsb.fi', 'https://opendata.adsb.fi/api/v2/mil']]) {
        if (lv && (url.endsWith('/ladd') || lv.milOk)) continue;                 // (the monitor's list has them)
        if (/mil/.test(url) && name === 'adsb.fi' && [...got.values()].some(c => c.mil && c.src !== 'monitor')) continue;
        for (let attempt = 0; attempt < 2; attempt++) {
          try { const m = url.endsWith('/ladd') ? await monGet('/ladd').catch(() => null) : null, fresh = m && now() - m.at < 90000; const j = fresh ? m : await gmRequest(url, { timeout: 20000 }); const t = fresh ? m.at : now(); for (const a of readsbList(j)) { const c = normalizeReadsb(a, name, t), p = c && got.get(c.hex); if (c && (!p || (p.src === 'monitor' && seenAt(c) > seenAt(p)))) got.set(c.hex, c); } src = src || name; break; }
          catch (e) { log('list', url, String(e.message || e)); if (/429/.test(String(e)) && !attempt) { await sleep(4000); continue; } break; }
        }
      }
      if (got.size || !globalList.items.length) { globalList.items = [...got.values()]; globalList.byHex = got; globalList.at = now(); globalList.src = src || 'adsb.lol'; noteCands(globalList.items); }
      log('LADD/military list', globalList.items.length, 'aircraft', lv ? '(monitor)' : '');
      // (military aircraft FR24 does show get their padlocked fields unlocked from this data too)
      pushPubTel(globalList.items.filter(c => !c.ladd && now() - seenAt(c) < 90000));
      for (const c of globalList.items) if (c.gnd) learnParked(c);
      return globalList.items;
    })().finally(() => { globalList.loading = null; });
    return globalList.loading;
  }
  // (with the monitor answering, its live list every 20 s in between: positions never more than a minute old to match
  // FR24's blocked flights against - N1848T, 517 kt over Montana, went unmatched on a list 2 minutes old. Newer reports
  // replace older ones; aircraft not heard for 10 minutes go. While it covers the military list too, this browser's own
  // list round is not needed: the list counts as fresh)
  // (all of it in idle moments, a couple of hundred aircraft at a time - never while the map is dragged)
  let liveBusy = false;
  setInterval(() => {
    if (!monUp() || globalList.loading || liveBusy) return;
    liveBusy = true;
    takeLive({ idle: true }).then(async lv => {
      if (!lv) return;
      const got = [], cut = now() - 10 * 60000;
      for (const c of lv.got.values()) { const p = globalList.byHex.get(c.hex); if (!p || seenAt(c) > seenAt(p)) { globalList.byHex.set(c.hex, c); got.push(c); } }
      for (const [h, c] of globalList.byHex) if (seenAt(c) < cut) globalList.byHex.delete(h);
      globalList.items = [...globalList.byHex.values()]; globalList.src = 'monitor';
      if (lv.milOk) globalList.at = now();
      const parts = []; for (let i = 0; i < got.length; i += 200) parts.push(got.slice(i, i + 200));
      await sliced(parts, part => { noteCands(part); pushPubTel(part.filter(c => !c.ladd && now() - seenAt(c) < 90000)); for (const c of part) if (c.gnd) learnParked(c); });
      await idleSlice(); verifyAgainstList();
    }).catch(() => {}).finally(() => { liveBusy = false; });
  }, 20000);
  // Parked LADD aircraft show which fields business aviation actually uses: every sighting feeds the usage prior.
  const parkedSeen = new Map();
  function learnParked(c) {
    if (!airportsReady()) return;
    const k = c.hex; if (parkedSeen.has(k)) return;
    const n = ENGINE.airportAt(c.lat, c.lon, 4); if (!n || !n.airport.icao) return;
    parkedSeen.set(k, n.airport.id);
    usageAdd(n.airport.icao, 0.5, c.mil && !c.ladd ? 'useMil' : 'use');
  }

  // ---- matching -------------------------------------------------------------------------------------------------
  function fr24Age(f, t) { const base = f.serverTime && f.ts ? Math.max(0, f.serverTime / 1000 - f.ts) : 0; return base + Math.max(0, (t - f.receivedAt) / 1000); }
  const typeFamily = t => clean(t).toUpperCase().slice(0, 3);
  function typeRelation(a, b) { a = clean(a).toUpperCase(); b = clean(b).toUpperCase(); if (!a || !b) return 'unknown'; if (a === b) return 'same'; return typeFamily(a) === typeFamily(b) ? 'family' : 'different'; }
  function scoreCandidate(f, c, flat, flon, t) {
    const cAge = c.ageS + Math.max(0, (t - c.receivedAt) / 1000);
    if (cAge > 120) return null;
    if (f.reg && c.reg && f.reg.toUpperCase() !== c.reg.toUpperCase()) return null;
    const rel = typeRelation(f.type, c.type);
    if (rel === 'different') return null;
    // (on an apron an untyped transponder beside it - a tug, a fuel truck, an aircraft no database has - is not it when
    // FR24 knows the type: only a blocked one of no known type may be)
    if (f.gnd && f.type && rel === 'unknown' && !(c.ladd || c.pia)) return null;
    const [clat, clon] = project(c.lat, c.lon, c.gs, c.trk, cAge);
    const d = dist(flat, flon, clat, clon);
    if (d > 15) return null;
    let s = d;
    if (fin(f.alt) && fin(c.alt) && !f.gnd && !c.gnd) { const da = Math.abs(f.alt - c.alt); if (da > 3000) return null; s += da / 400; }
    if (!!f.gnd !== !!c.gnd && f.alt > 1500) return null;
    if (!f.gnd && fin(f.trk) && fin(c.trk) && f.spd > 60 && c.gs > 60) { const dt = angDiff(f.trk, c.trk); if (dt > 50) return null; s += dt / 8; }
    if (fin(f.spd) && fin(c.gs) && f.spd > 60) { const ds = Math.abs(f.spd - c.gs); if (ds > 140) return null; s += ds / 25; }
    if (rel === 'same') s -= 2; else if (rel === 'family') s += 1; else if (f.type && !c.type) s += 0.5;
    if (f.reg && c.reg) s -= 3;
    if (c.ladd || c.pia) s -= 0.75;
    if (c.nonIcao) s += 2;
    return { c, d, s, rel };
  }
  // One transponder is one aircraft: an address already worn by another flight FR24 is still drawing cannot be this
  // one (two helicopters over Manhattan must not both become the same registration).
  function takenHexes(exceptId, t) {
    const out = new Set();
    for (const [id, r] of live) { if (id === exceptId || !r.hex) continue; const g = pending.get(id); if (g && t - g.receivedAt < 90000) out.add(r.hex.toLowerCase()); }
    return out;
  }
  function matchFlight(f, cands) {
    const t = now(), scored = [], taken = takenHexes(f.id, t);
    const [flat, flon] = project(f.lat, f.lon, f.spd, f.trk, fr24Age(f, t));
    for (const c of cands) { if (taken.has(String(c.hex).toLowerCase())) continue; const sc = scoreCandidate(f, c, flat, flon, t); if (sc) scored.push(sc); }
    scored.sort((a, b) => a.s - b.s);
    const best = scored[0]; if (!best) return null;
    // (a fast jet moves 4 km in the 15 s the two sources' clocks can disagree by: the distance allowed grows with speed)
    if (best.d > (f.gnd ? 0.6 : 5 + Math.max(0, (f.spd || 0) - 250) / 60)) return null;
    const second = scored[1];
    if (second && second.s - best.s < 2.5 && second.d < 8) return null;
    return best;
  }
  let badWhy = null;   // what the last 'bad' verification was about
  function verifyMatch(f, rec, cands) {
    badWhy = null;
    const c = cands.find(x => x.hex === rec.hex);
    if (!c) return 'unknown';
    if (typeRelation(f.type, c.type) === 'different') { badWhy = { kind: 'type' }; return 'bad'; }
    const t = now();
    const [flat, flon] = project(f.lat, f.lon, f.spd, f.trk, fr24Age(f, t));
    const cAge = c.ageS + Math.max(0, (t - c.receivedAt) / 1000);
    if (cAge > 60 || fr24Age(f, t) > 60) return 'unknown';
    const [clat, clon] = project(c.lat, c.lon, c.gs, c.trk, cAge);
    const d = dist(flat, flon, clat, clon);
    if (d > (f.gnd ? 2 : 8)) { badWhy = { kind: 'dist', d, gnd: !!f.gnd }; return 'bad'; }
    if (!f.gnd && fin(f.alt) && fin(c.alt) && Math.abs(f.alt - c.alt) > 4000) { badWhy = { kind: 'alt', d: Math.abs(f.alt - c.alt) }; return 'bad'; }
    return 'ok';
  }
  // An identification, once made, stays: it is withdrawn only on overwhelming evidence - the aircraft seen with fresh
  // positions far from where FR24 draws the flight (25 km+, or 8,000 ft apart), again and again for 3+ minutes with no
  // agreeing check in between. FR24 extrapolates positions through coverage gaps and the aggregators have MLAT jumps,
  // so a few disagreements are normal; a type-code spelling difference never withdraws a match confirmed by position.
  function strike(id, rec, why) {
    const b = badWhy; if (!b) return;
    if (b.kind === 'type' && rec.verifiedAt) return;
    if (b.kind === 'dist' && b.d < (b.gnd ? 5 : 25)) return;
    if (b.kind === 'alt' && b.d < 8000) return;
    const t = now(), s = strikes.get(id) || { n: 0, first: t };
    s.n++; strikes.set(id, s);
    if (s.n >= 4 && t - s.first >= 180000) revoke(id, why);
  }

  // ---- resolver state ------------------------------------------------------------------------------------------
  const pending = new Map();          // fr24 id -> latest feed snapshot of a callsign-less flight
  const feedTrail = new Map();        // fr24 id -> recent feed positions (a mini track for every flight, not only the selected one)
  const attempts = new Map();         // fr24 id -> { n, last }
  const live = new Map();             // fr24 id -> resolved record (session)
  const strikes = new Map();          // fr24 id -> { n, first } consecutive failed verifications
  const msgCount = {};   // page reports received, by kind (the strip of an ordinary flight shows them)
  let shownId = null;   // the flight id the open panel is showing (worked out from the aircraft on screen)
  let selectedId = null, bridgeReady = false, feedReady = false, sweepTimer = 0, sweepRunning = false, viewCenter = null;

  function pageWindow() { try { return typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window; } catch (_) { return window; } }
  function postToPage(type, payload) { try { window.postMessage(Object.assign({ __tweeksLadd: type }, payload || {}), location.origin); } catch (_) { /* ignore */ } }
  const ageOf = hx => { const b = builtYear(hx); return b ? Math.max(0, new Date().getFullYear() - b.year) : 0; };
  function packRecord(rec) {
    const hx = rec.hex ? store.getHex(rec.hex) : null;
    const m = hx ? withStored(rec) : Object.assign({}, rec);
    const f = pending.get(rec.id);
    const photos = goodPhotos(m.photos).slice(0, 3).map(cleanPhoto);
    return { id: rec.id, hex: m.hex || '', cs: m.cs || '', reg: m.reg || '', type: m.type || '', desc: modelName(m), cat: m.cat || '', fcat: fr24Cat(m), mil: !!m.mil, msn: m.msn || '', owner: ownerName(m.owner), operatorId: operatorIdOf(m, m.cs || rec.cs), operatorIcao: m.operatorIcao || '', operatorName: operatorOf(m, m.cs || rec.cs), age: ageOf(m), ageText: ageText(m), countryId: (regCountry(m.reg) && countryIdOf(regCountry(m.reg).iso, regCountry(m.reg).name)) || m.countryId || 0, squawk: rec.squawk || m.squawk || 0, photos, photoFinal: m.photoV === PHOTO_V && (m.photoLevel || 0) >= 2 && (photos.some(p => /^(JetPhotos|Flightradar24)$/.test(p.source || '')) || now() - (m.photoAt || 0) < 864e5),
      pos: f && fin(f.lat) ? { lat: f.lat, lon: f.lon, alt: f.alt, gnd: !!f.gnd, at: f.receivedAt || now() } : (rec.lastPos && fin(rec.lastPos.lat) ? rec.lastPos : null) };
  }
  function pushToPage(recs) { if (recs.length) postToPage('resolve', { entries: recs.map(packRecord) }); }
  function idFromUrl() { const m = location.pathname.match(/\/([0-9a-f]{6,9})\/?$/i); return m ? parseInt(m[1], 16) : null; }
  function attemptsFor(id) { const a = attempts.get(id); if (a && now() - a.last > 180000) { attempts.delete(id); return null; } return a || null; }
  function currentId() { return selectedId != null ? selectedId : idFromUrl(); }
  const onScreen = id => id != null && (id === currentId() || id === shownId);
  // the aircraft on screen, whichever of its flight ids FR24 is showing it under (it renumbers flights mid-stream)
  const hexOnScreen = hex => !!hex && [currentId(), shownId].some(i => i != null && hexOfId(i) === hex);
  const skipFlight = f => f.src === 4 || f.type === 'GRND' || f.icon === 25 || !fin(f.lat) || !fin(f.lon);

  // ---- lookups --------------------------------------------------------------------------------------------------
  function mergeCands(into, list) { for (const c of list) { const prev = into.get(c.hex); if (!prev || c.ageS < prev.ageS) into.set(c.hex, c); } }
  async function queryArea(sources, lat, lon, radiusNm) {
    const results = await Promise.allSettled(sources.map(s => s.area(lat, lon, radiusNm)));
    const byHex = new Map(); const used = [];
    results.forEach((r, i) => { if (r.status !== 'fulfilled') { log('source failed', sources[i].name, String(r.reason)); return; } used.push(sources[i].name); mergeCands(byHex, r.value); noteCands(r.value); });
    return { cands: [...byHex.values()], used };
  }
  function recordFromMatch(f, m, used) {
    const c = m.c;
    const type = f.type && m.rel === 'family' ? f.type : (c.type || f.type || '');
    const rec = { id: f.id, hex: c.hex.toLowerCase(), cs: c.cs || '', reg: c.reg || f.reg || hexNNumber(c.hex), type, fr24Type: f.type || '', aggType: c.type || '', desc: c.desc || '', owner: c.owner || '', year: c.year || 0, src: c.src, sources: used, dist: Math.round(m.d * 100) / 100, matchedAt: now(), verifiedAt: now(), ladd: c.ladd, pia: c.pia, mil: c.mil, cat: c.cat || '', gnd: c.gnd, squawk: c.squawk || 0 };
    hydrate(rec);
    const rc = regCountry(rec.reg), ctry = rc || countryOfHex(rec.hex); if (ctry) { rec.country = rc ? rc.name : rec.country || ctry.name; rec.countryIso = ctry.iso; if (!rec.countryId || rc) rec.countryId = countryIdOf(ctry.iso, ctry.name) || rec.countryId; }
    telemetry.set(f.id, telemOf(c));
    rec.lastPos = { lat: f.lat, lon: f.lon, alt: f.alt, gnd: !!f.gnd, at: f.receivedAt || now() };
    return rec;
  }
  // Everything already known about the airframe (registry, operator, photos, which lookups were done) carries over to
  // each new flight of it - FR24 gives every leg its own flight id, and none of that is fetched again.
  // The aircraft as known: what is stored for its airframe, with this flight's record on top - but an empty value of the
  // flight record (no owner yet, year 0) never hides a value that is stored (e.g. the owner and build year adsb.lol's
  // database gave when its trace was loaded).
  const isEmptyVal = v => v == null || v === '' || v === 0 || (Array.isArray(v) && !v.length);
  // a model name written in capitals by a database ("GULFSTREAM 5", "BOEING 747-400") as a name is written; FR24's own
  // name when it has given one
  const modelName = hx => { const d = clean((hx && (hx.fr24Model || hx.desc)) || ''); return /[a-z]/.test(d) ? d : d.replace(/\b([A-Z])([A-Z]{2,})\b/g, (m, a, b) => a + b.toLowerCase()); };
  function withStored(rec) {
    const hx = rec && rec.hex ? store.getHex(rec.hex) : null; if (!hx) return Object.assign({}, rec);
    const out = Object.assign({}, hx);
    for (const k of Object.keys(rec)) if (!isEmptyVal(rec[k]) || !(k in out)) out[k] = rec[k];
    return out;
  }
  const HYDRATE = ['reg', 'type', 'desc', 'owner', 'ownerCity', 'msn', 'year', 'operatorId', 'operatorIcao', 'operatorName', 'fr24Equip', 'fr24At', 'faaAt', 'idAt', 'ownerAskedAt', 'ownerFailAt', 'pubAt', 'countryId', 'country', 'cat', 'photos', 'photoAt', 'photoLevel', 'photoV', 'jpFailAt'];
  function hydrate(rec) {
    const hx = rec && rec.hex ? store.getHex(rec.hex) : null; if (!hx) return rec;
    { const a = rec.photos || [], b = hx.photos || [];
      if (b.length && (b.some(isJp) && !a.some(isJp) || (b.some(isJp) === a.some(isJp) && b.length > a.length))) { rec.photos = b; rec.photoAt = hx.photoAt || rec.photoAt; rec.photoV = hx.photoV || rec.photoV; rec.photoLevel = hx.photoLevel || rec.photoLevel; } }
    for (const k of HYDRATE) { const v = hx[k]; if ((rec[k] == null || rec[k] === '' || rec[k] === 0 || (Array.isArray(rec[k]) && !rec[k].length)) && v != null && v !== '' && !(Array.isArray(v) && !v.length)) rec[k] = v; }
    return rec;
  }
  // Where and when a flight was last seen, kept with its identity: after a reload the page still knows which of an
  // aircraft's flight ids is the one in the air (search lists that one only) and which are earlier legs.
  function noteSeen(rec, f, t) {
    if (!rec || !f || !fin(f.lat)) return;
    rec.lastPos = { lat: f.lat, lon: f.lon, alt: f.alt, gnd: !!f.gnd, at: t };
    if (t - (rec.seenSavedAt || 0) > 120000) { rec.seenSavedAt = t; store.setId(rec.id, rec); }
  }
  // (identities found together - a world scan finds hundreds - go to the page in one message)
  let pushQ = [], pushT = 0;
  function pushSoon(rec) { pushQ.push(rec); if (!pushT) pushT = setTimeout(() => { pushT = 0; const q = pushQ; pushQ = []; pushToPage(q); }, 0); }
  function adopt(rec) {
    live.set(rec.id, rec); strikes.delete(rec.id);
    store.setId(rec.id, rec);
    if (rec.hex) store.mergeHex(rec.hex, { hex: rec.hex, reg: rec.reg, type: rec.type, desc: rec.desc, owner: rec.owner, year: rec.year, msn: rec.msn, ladd: rec.ladd, pia: rec.pia, mil: rec.mil, cat: rec.cat, countryId: rec.countryId, country: rec.country });
    const shown = onScreen(rec.id);
    if (shown) pushToPage([rec]); else pushSoon(rec);
    pushTelemetry(rec.id);
    // its route: the aircraft opened, straight away; any other in the next idle moment (newly identified ones come
    // first there), so boards / search list it as traffic within moments - without holding up the map
    if (airportsReady() && shown) {
      try { const r = composeRoute(rec.id, rec.hex, { quick: true }); if (r) { rec.route = r; if (r.originId || r.destId || r.groundAirportId) postToPage('route', { id: rec.id, route: routeForPage(r) }); } } catch (e) { log('first route', e); }
    } else quickSoon();
    syncPanelSoon();
    enrich(rec).catch(e => log('enrich failed', e));
    if (currentId() === rec.id) routeFor(rec).catch(e => log('route failed', e));
    // where it took off: today's track (in view: ahead of any background work; read in an idle moment)
    else if (!rec.origin) { const f = pending.get(rec.id); loadToday(rec.hex, 600000, { bg: !!(f && f.bg), idle: true }).then(() => { if (live.get(rec.id) === rec) publishRoute(rec.id, composeRoute(rec.id, rec.hex)); }).catch(() => {}); }
  }
  const revokedIds = new Set();   // withdrawn this session: not carried over from an older snapshot
  function revoke(id, why) {
    const rec = live.get(id); if (!rec) return;
    revokedIds.add(id);
    log('match withdrawn', id.toString(16), rec.hex, why);
    live.delete(id); store.delId(id); strikes.delete(id); routeState.delete(id); planState.delete(id); telemetry.delete(id);
    attempts.set(id, { n: 0, last: now() - 4000 });
    postToPage('revoke', { ids: [id] });
    syncPanelSoon();
    scheduleSweep(400);
  }
  function listCandidatesNear(f, withArea) {
    const out = [], seen = new Set(); const dl = 0.5, dn = 0.5 / Math.max(0.2, Math.cos(f.lat * Math.PI / 180));
    if (globalList.items.length && now() - globalList.at <= 150000) for (const c of globalList.items) if (Math.abs(c.lat - f.lat) < dl && Math.abs(c.lon - f.lon) < dn) { out.push(c); seen.add(c.hex); }
    // a new FR24 flight id of an aircraft already seen (after a coverage gap, or its next leg): the public positions
    // already on hand from the last two minutes recognise it without another lookup
    if (withArea) { const cut = now() - 120000; for (const c of areaCache.values()) if (c.receivedAt >= cut && !seen.has(c.hex) && Math.abs(c.lat - f.lat) < dl && Math.abs(c.lon - f.lon) < dn) out.push(c); }
    return out;
  }
  function adoptReckoned(f, m) {
    adopt(recordFromMatch(f, m, [(m.c.src || 'public ADS-B') + ' (last heard ' + Math.round(m.age / 60) + ' min ago, carried forward to here)']));
    log('identified out of coverage', f.id.toString(16), m.c.hex, Math.round(m.d) + ' km from where it was reckoned');
  }
  function matchAgainstList(f) {
    const cands = listCandidatesNear(f, true);
    const m = cands.length ? matchFlight(f, cands) : null;
    if (!m) { const r = matchReckoned(f); if (r) { adoptReckoned(f, r); return true; } return false; }
    const fromList = globalList.byHex.get(m.c.hex) === m.c;
    adopt(recordFromMatch(f, m, [fromList ? (m.c.src || globalList.src) + (m.c.mil && !m.c.ladd ? ' (military list)' : ' (LADD list)') : (m.c.src || 'public ADS-B') + ' (seen moments ago)']));
    return true;
  }
  async function resolveTargeted(id, reason) {
    const f = pending.get(id); if (!f || live.has(id) || skipFlight(f)) return;
    if (matchAgainstList(f)) return;
    const a = attemptsFor(id) || { n: 0, last: 0 };
    if (a.n >= MAX_TARGET_ATTEMPTS || now() - a.last < 5000) return;
    a.n++; a.last = now(); attempts.set(id, a);
    // (on the ground the free networks hear least - an apron at Le Bourget: none of them - so there the fallbacks, ADS-B
    // Exchange with the user's own key among them, from the first try)
    const sources = a.n <= 2 && !f.gnd ? liveSources() : [...liveSources(), ...fallbackSources(), OPENSKY];
    log('targeted lookup', reason, id.toString(16), 'attempt', a.n);
    const all = new Map(); const used = []; let adopted = false;
    await Promise.allSettled(sources.map(s => s.area(f.lat, f.lon, TARGET_RADIUS_NM).then(list => {
      used.push(s.name); mergeCands(all, list); noteCands(list);
      if (adopted || live.has(id)) return;
      const fresh = pending.get(id) || f;
      const m = matchFlight(fresh, [...all.values()]);
      if (m && (m.rel === 'same' || (m.rel === 'unknown' && !fresh.type))) { adopted = true; adopt(recordFromMatch(fresh, m, used.slice())); }
    }).catch(e => log('source failed', s.name, String(e)))));
    if (adopted || live.has(id)) return;
    // (no source answered - rate-limited, offline: not an attempt; "no match" is only said of sources that answered)
    if (!used.length) { a.n = Math.max(0, a.n - 1); a.last = now() + 10000; return; }
    const fresh = pending.get(id) || f;
    const m = matchFlight(fresh, [...all.values()]);
    if (m) adopt(recordFromMatch(fresh, m, used));
    else { const r = matchReckoned(fresh); if (r) adoptReckoned(fresh, r); else { log('no match yet', id.toString(16), 'candidates', all.size); syncPanelSoon(); if (a.n >= 2) (fresh.gnd ? matchParked(fresh) : matchByTraces(fresh)).catch(e => log('track match', e)); } }
  }
  function clusterUnresolved() {
    const t = now();
    const list = [...pending.values()].filter(f => !live.has(f.id) && !f.bg && t - f.receivedAt < PENDING_TTL_MS && !skipFlight(f))
      .filter(f => { const a = attemptsFor(f.id); return !a || a.n < 12 && t - a.last > 4000 * Math.min(6, a.n); });
    const clusters = [];
    const rKm = AREA_RADIUS_NM * NM_KM * 0.9;
    const center = viewCenter || (list[0] ? { lat: list[0].lat, lon: list[0].lon } : null);
    list.sort((a, b) => (b.sel ? 1 : 0) - (a.sel ? 1 : 0) || (center ? dist(a.lat, a.lon, center.lat, center.lon) - dist(b.lat, b.lon, center.lat, center.lon) : 0));
    for (const f of list) {
      let c = clusters.find(k => dist(k.lat, k.lon, f.lat, f.lon) < rKm);
      if (!c) { c = { lat: f.lat, lon: f.lon, flights: [] }; clusters.push(c); }
      c.flights.push(f);
    }
    return clusters;
  }
  function verifyAll(cands, t) {
    for (const [id, rec] of live) {
      const f = pending.get(id); if (!f || t - f.receivedAt > PENDING_TTL_MS) continue;
      if (!cands.some(c => c.hex === rec.hex)) continue;
      const v = verifyMatch(f, rec, cands);
      if (v === 'ok') { strikes.delete(id); rec.verifiedAt = t; }
      else if (v === 'bad') strike(id, rec, 'track diverged');
    }
  }
  async function sweep() {
    if (sweepRunning) return;
    for (const f of [...pending.values()]) if (!live.has(f.id) && !skipFlight(f)) matchAgainstList(f);
    const clusters = clusterUnresolved().slice(0, 3);
    if (!clusters.length) return;
    sweepRunning = true;
    try {
      const srcs = liveSources();
      for (const c of clusters) {
        const primary = srcs[sourceRotation % srcs.length], secondary = srcs[(sourceRotation + 1) % srcs.length];
        sourceRotation++;
        const { cands, used } = await queryArea(primary === secondary ? [primary] : [primary, secondary], c.lat, c.lon, AREA_RADIUS_NM);
        pushPubTel(cands);
        const t = now();
        verifyAll(cands, t);
        for (const f of c.flights) {
          const a = attempts.get(f.id) || { n: 0, last: 0 }; a.n++; a.last = t; attempts.set(f.id, a);
          if (live.has(f.id)) continue;
          const fresh = pending.get(f.id) || f;
          const m = matchFlight(fresh, cands);
          if (m) adopt(recordFromMatch(fresh, m, used));
        }
        log('sweep', used.join('+'), 'cands', cands.length, 'flights', c.flights.length, 'resolved total', live.size);
      }
      // (a cruising flight three sweeps unidentified - out of every receiver's reach: its track against the day's tracks)
      const far = clusters.flatMap(c => c.flights).find(f => !live.has(f.id) && (attempts.get(f.id) || {}).n >= 3 && f.alt > 10000);
      if (far) matchByTraces(pending.get(far.id) || far).catch(e => log('track match', e));
    } catch (e) { log('sweep error', e); }
    finally { sweepRunning = false; }
  }
  function scheduleSweep(delay) { clearTimeout(sweepTimer); sweepTimer = setTimeout(() => { sweep().then(() => { if (clusterUnresolved().length) scheduleSweep(SWEEP_INTERVAL_MS); }); }, delay); }
  function verifyAgainstList() {
    const t = now(); const cands = globalList.items;
    for (const [id, rec] of live) {
      const c = globalList.byHex.get(rec.hex); if (c) { const tl = telemOf(c); const cur = telemetry.get(id); if (!cur || (tl.at || 0) > (cur.at || 0)) { telemetry.set(id, tl); if (onScreen(id)) pushTelemetry(id); } }
      const f = pending.get(id); if (!f || t - f.receivedAt > PENDING_TTL_MS || !c) continue;
      const v = verifyMatch(f, rec, cands);
      if (v === 'ok') { strikes.delete(id); rec.verifiedAt = t; }
      else if (v === 'bad') strike(id, rec, 'LADD list diverged');
    }
  }

  // ---- live telemetry of the selected aircraft (vertical speed, squawk, GPS altitude, airspeeds, wind, temperature) ----
  const telemetry = new Map();        // fr24 id -> { vr, sq, agps, ias, tas, mach, oat, wd, ws, mcp, at }
  // Aircraft FR24 does show (not blocked) but whose panel still has padlocked fields: fr24 id -> { id, hex, reg, type, cs }
  const pubRecs = new Map();
  function pushTelemetry(id) { const t = telemetry.get(id); if (t) postToPage('telem', { id, t }); }
  let telemBusy = false, telemLast = 0, telemRot = 0;
  async function pollTelemetry() {
    const id = currentId(), rec = id != null ? (live.get(id) || pubRecs.get(id)) : null;
    if (!rec || !rec.hex || telemBusy || document.hidden || now() - telemLast < TELEMETRY_MS - 200 || pbMode()) return;   // (in FR24's playback: its figures come from the track)
    telemBusy = true; telemLast = now();
    try {
      const srcs = liveSources().filter(s => s.hex);
      // alternate between the aggregators; if the first has nothing for this address, ask the other straight away
      let c = null;
      for (let k = 0; k < Math.min(2, srcs.length) && !c; k++) { const src = srcs[(telemRot + k) % Math.min(2, srcs.length)]; try { c = await src.hex(rec.hex); } catch (e) { /* next */ } }
      telemRot++;
      if ((!c || !c.cs) && now() - (rec.adsbxAt || 0) > 60000) for (const src of fallbackSources()) { rec.adsbxAt = now(); try { const x = await src.hex(rec.hex); if (x) { c = c && !x.cs ? c : x; break; } } catch (e) { /* none */ } }
      // (both refused - a rate limit - or silent: its latest report from the map's view poll or the LADD list, while fresh.
      // N600JM into Dublin had every figure padlocked while adsb.lol answered 429)
      if (!c) { const g = [areaCache.get(rec.hex), globalList.byHex.get(rec.hex)].filter(x => x && now() - seenAt(x) < 30000).sort((a, b) => seenAt(b) - seenAt(a))[0]; if (g) c = g; }
      if (c) {
        noteCands([c]);
        telemetry.set(id, telemOf(c)); pushTelemetry(id);
        const f = pending.get(id);
        if (f) { const v = verifyMatch(f, rec, [c]); if (v === 'ok') { strikes.delete(id); rec.verifiedAt = now(); } else if (v === 'bad') strike(id, rec, 'selected aircraft diverged'); }
        if (c.sq && rec.squawk !== c.squawk) { rec.squawk = c.squawk; }
        syncPanelSoon();
      }
    } catch (e) { log('telemetry', String(e.message || e)); }
    finally { telemBusy = false; }
  }

  // ---- world scan: every callsign-less business / GA / military flight FR24 draws anywhere, then match it ------------
  // (together they cover every longitude from 60 S to 72 N - v22.1 left the North Atlantic between 50 W and 30 W out,
  // so transatlantic business jets vanished from the scan mid-ocean)
  const SCAN_REGIONS = [
    { n: 72, s: 24, w: -170, e: -100 }, { n: 72, s: 24, w: -100, e: -50 }, { n: 72, s: 24, w: -50, e: -30 }, { n: 24, s: -60, w: -170, e: -30 },
    { n: 72, s: -60, w: -30, e: 60 }, { n: 72, s: -10, w: 60, e: 180 }, { n: -10, s: -60, w: 60, e: 180 }
  ];
  let lastScanAt = 0, scanPending = false;
  async function worldScan(reason) {
    if (!bridgeReady || !feedReady || scanPending || isAircraftPage) return;
    if (document.hidden && now() - lastScanAt < 15 * 60000) return;
    scanPending = true; lastScanAt = now();
    try {
      await refreshLists(true);
      log('world scan', reason);
      postToPage('scan', { regions: SCAN_REGIONS, opts: { services: [2, 3, 4, 5, 10, 11], traffic: 2, limit: 1500, gapMs: 350 } });
    } catch (e) { scanPending = false; log('scan failed', String(e)); }
  }
  // The world scan's finds are matched against the lists a slice at a time in idle moments (all at once, hundreds of
  // them froze the map for a second and more)
  const bgMatchQ = new Set(); let bgMatchBusy = false;
  async function drainBgMatches() {
    if (bgMatchBusy) return; bgMatchBusy = true;
    let matched = 0;
    try {
      while (bgMatchQ.size) {
        const ids = [...bgMatchQ]; bgMatchQ.clear();
        await sliced(ids, id => { const f = pending.get(id); if (f && !live.has(id) && !skipFlight(f) && matchAgainstList(f)) matched++; });
      }
    } finally { bgMatchBusy = false; }
    if (matched) log('world scan finds matched', matched, 'resolved total', live.size);
  }
  function onScanDone(d) {
    scanPending = false;
    for (const f of pending.values()) if (f.bg && !live.has(f.id)) bgMatchQ.add(f.id);
    drainBgMatches().catch(e => log('scan matching', e));
    const ok = (d.results || []).filter(r => r.ok).length;
    log('world scan done', ok + '/' + (d.results || []).length, 'regions, resolved total', live.size);
    if ((d.results || []).some(r => !r.ok && /429|grpc/.test(r.err || ''))) lastScanAt = now() + 10 * 60000;
  }

  // ---- the map view: every aircraft in it, every few seconds -----------------------------------------------------------
  // FR24's own feed request says exactly what the map shows. One aggregator query for that area (alternating sources)
  // gives live telemetry and database facts for every aircraft on screen; the page gets them keyed by callsign and
  // registration, and unlocks the padlocked fields of ordinary flights in FR24's own data before anyone clicks.
  let viewBox = null, viewBusy = false, viewRot = 0;
  function onView(d) { if ([d.n, d.s, d.w, d.e].every(fin) && d.n > d.s) { viewBox = { n: d.n, s: d.s, w: d.w, e: d.e, at: now() }; monArea(); } }
  // (where the map is looked at - zoomed in to a region, for a minute - becomes one of the monitor's areas: its traffic
  // recorded while FR24 is closed too, wherever in the world)
  let monAreaT = 0;
  function monArea(lat, lon) {
    if (lat != null) { monGet(`/area?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`).catch(() => {}); return; }
    clearTimeout(monAreaT);
    monAreaT = setTimeout(() => { const c = viewCircle(); if (c && c.r < 400) monArea(c.lat, c.lon); }, 60000);
  }
  function viewCircle() {
    if (!viewBox) return viewCenter ? { lat: viewCenter.lat, lon: viewCenter.lon, r: 150 } : null;
    const lat = (viewBox.n + viewBox.s) / 2; let w = viewBox.w, e = viewBox.e; if (e < w) e += 360; let lon = (w + e) / 2; if (lon > 180) lon -= 360;
    return { lat, lon, r: Math.max(25, Math.min(250, dist(lat, lon, viewBox.n, viewBox.e > viewBox.w ? viewBox.e : viewBox.e + 360) / NM_KM + 10)) };
  }
  const nz = v => (fin(v) ? v : null);
  function pushPubTel(list) {
    const rows = [];
    for (const c of list || []) {
      if (!c || c.nonIcao || !(c.cs || c.reg)) continue;
      rows.push([c.cs || '', c.reg || '', c.hex, Math.round(c.lat * 1000) / 1000, Math.round(c.lon * 1000) / 1000, Math.round(seenAt(c)), nz(c.vs), c.sq || '', nz(c.agps), nz(c.ias), nz(c.tas), nz(c.mach), nz(c.oat), nz(c.wd), nz(c.ws), ...(f => f ? [f.name, f.code] : ['', ''])(firInfo(c.lat, c.lon, c.gnd ? 0 : c.alt)), c.gnd ? 1 : 0]);
    }
    if (rows.length) postToPage('pubTel', { rows });
  }
  async function pollView() {
    if (viewBusy || document.hidden || isAircraftPage || !bridgeReady) return;
    const c = viewCircle(); if (!c) return;
    viewBusy = true;
    try {
      // (adsb.lol already carries the LADD lists, sweeps and telemetry: the view poll goes to the others while they answer)
      // A refusal (rate limit, outage) moves straight on to the next source - adsb.lol last - instead of leaving the
      // map without public data until the next poll.
      const all = liveSources(), others = all.filter(x => x.host !== 'api.adsb.lol'), start = viewRot++;
      const order = others.map((_, i) => others[(start + i) % others.length]).concat(all.filter(x => x.host === 'api.adsb.lol'));
      for (const src of order) {
        try {
          const list = await src.area(c.lat, c.lon, c.r);
          noteCands(list); pushPubTel(list);
          prefetchRegistry(list, c);
          break;
        } catch (e) { log('view poll', src.name, String(e.message || e)); }
      }
    } catch (e) { log('view poll', String(e.message || e)); }
    finally { viewBusy = false; }
  }
  // Registry facts (serial number, build year, owner) for US-registered aircraft on screen, a couple per poll, nearest
  // the middle of the map first - so opening one of them later shows its serial number at once. (Kept for a month.)
  function prefetchRegistry(list, c) {
    if (!store.stats().loaded) return;
    const cands = (list || []).filter(a => a.reg && /^N\d/.test(a.reg) && !a.ladd && !(store.getHex(a.hex) || {}).pubAt && !pubJobs.has(a.hex))
      .sort((a, b) => dist(a.lat, a.lon, c.lat, c.lon) - dist(b.lat, b.lon, c.lat, c.lon)).slice(0, 2);
    for (const a of cands) publicIdentity(a.hex, a.reg, { bg: true }).catch(() => {});
  }
