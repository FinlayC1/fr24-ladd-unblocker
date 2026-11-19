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
  // (1.4.1: none logged - a flight of an aircraft the monitor does not follow, LOG8NP's - the runway its own track gives:
  // its points within 30 km of the field, the take-off's in its first half hour and the landing's in its last, fitted to
  // the field's runways on the monitor, as a board's FR24 tracks are - /rwyfit)
  async function pbRunways(hex, fid, from, to, dep, arr, pts) {
    const out = { off: '', on: '' }; if (!monUp()) return out;
    const one = async (ap, end, t) => {
      if (!ap || !(Number(ap.id) > 0) || !(t > 1e9)) return '';
      if (fid) { try { const j = await monGet(`/rwy?f=${fid}:${end}&ap=${ap.id}&ts=${Math.round(t)}`, { timeout: 5000 }); const v = j && j.list && j.list[`${fid}:${end}`]; if (typeof v === 'string' && v) return v.slice(0, 8); } catch (e) { /* by the aircraft */ } }
      if (/^[0-9a-f]{6}$/.test(hex || '')) {
        try {
          const old = t < nowS() - 2 * 86400 ? '&old=1' : '';
          const j = await monGet(`/rwyap?ap=${ap.id}&from=${Math.round(t - 3600)}&to=${Math.round(t + 3600)}${old}`, { timeout: 6000 });
          let best = null; for (const x of (j && Array.isArray(j.h) ? j.h : [])) if (Array.isArray(x) && x[0] === hex && x[1] === end && fin(x[3]) && Math.abs(x[3] - t) <= 1800 && (!best || Math.abs(x[3] - t) < Math.abs(best[3] - t))) best = x;
          if (best && typeof best[2] === 'string') return best[2].slice(0, 8);
        } catch (e) { /* none */ }
      }
      return rwyFitPts(ap, end, t, pts, fid);
    };
    [out.off, out.on] = await Promise.all([one(from, 0, dep), one(to, 1, arr)]);
    return out;
  }
  // (a take-off's or landing's runway from a track's points near the field, fitted on the monitor - and kept in its log
  // there under FR24's id, when the flight has one)
  async function rwyFitPts(ap, end, t, pts, fid) {
    if (!ap || !fin(ap.lat) || !fin(ap.lon) || !Array.isArray(pts) || pts.length < 3 || !(t > 1e9) || !monUp()) return '';
    const near = pts.filter(p => p && fin(p.t) && fin(p.lat) && fin(p.lon) && (end ? p.t >= t - 1800 && p.t <= t + 900 : p.t >= t - 900 && p.t <= t + 1800) && ENGINE.dist(p.lat, p.lon, ap.lat, ap.lon) <= 30)
      .map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt: p.gnd ? null : fin(p.alt) ? p.alt : null, gnd: !!p.gnd || p.alt === 0, gs: fin(p.gs) ? p.gs : null, trk: fin(p.trk) ? p.trk : null }));
    for (let i = 1; i < near.length; i++) if (!fin(near[i].trk)) near[i].trk = ENGINE.brg(near[i - 1].lat, near[i - 1].lon, near[i].lat, near[i].lon);
    if (near.length < 3) return '';
    try { const r = await monPost('/rwyfit', { ap: ap.id, fid: /^[0-9a-f]{1,12}$/.test(fid || '') ? fid : '', landing: !!end, pts: near.slice(end ? -600 : 0, end ? undefined : 600) }); return r && typeof r.rwy === 'string' ? r.rwy.slice(0, 8) : ''; } catch (e) { return ''; }
  }
  function pbAirport(a) {
    if (!a) return null;
    const tz = a.timezone && typeof a.timezone === 'object' ? a.timezone.name : typeof a.timezone === 'string' ? a.timezone : '';
    return { code: a.iata || a.icao || a.code || '', name: a.name || '', city: a.city || a.name || '', lat: fin(a.lat) ? a.lat : null, lon: fin(a.lon) ? a.lon : null, tz: tz || 'UTC' };
  }
  // (the monitor's FR24 positions of a flight, as the engine's points)
  async function pbRaw(fid, t) {
    if (!/^[0-9a-f]{1,12}$/.test(fid) || !monUp()) return { pts: [], m: {} };
    try {
      const j = await monGet('/fr24raw?f=' + fid + (t > 1e9 ? '&t=' + Math.round(t) : ''), { timeout: 20000 }), C = (j && j.cols) || [], at = k => C.indexOf(k), pts = [];
      for (const r of Array.isArray(j && j.p) ? j.p : []) {
        if (!Array.isArray(r) || !fin(r[0]) || !fin(r[1]) || !fin(r[2])) continue;
        const v = k => { const x = r[at(k)]; return fin(x) ? x : null; }, gnd = r[at('gnd')] === 1 || v('alt') === 0;
        pts.push({ t: r[0], lat: r[1], lon: r[2], alt: gnd ? 0 : v('alt'), gnd, gs: v('gs'), trk: v('trk'), vr: v('vr'), sq: typeof r[at('sq')] === 'string' ? r[at('sq')] : '', ag: v('altGeom'), ias: v('ias'), tas: v('tas') });
      }
      return { pts, m: (j && j.m) || {} };
    } catch (e) { return { pts: [], m: {} }; }
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
  // (1.3.12) FR24's own positions of a flight first, whenever it has any: the public ADS-B record only where FR24 has
  // nothing for a minute and more - before FR24 picked it up, after it lost it, and its holes. 1.2.4 took whichever had
  // more points, and the track played was mostly adsb.lol's
  function pbFr24First(fr, adsb) {
    if (!fr || fr.length < 2) return pbMergePts(fr || [], adsb || []);
    const out = fr.slice().sort((p, q) => p.t - q.t), ts = out.map(p => p.t);
    const near = t => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; } return Math.min(lo < ts.length ? Math.abs(ts[lo] - t) : Infinity, lo > 0 ? Math.abs(ts[lo - 1] - t) : Infinity); };
    for (const p of adsb || []) if (near(p.t) >= 60) out.push(p);
    return out.sort((p, q) => p.t - q.t);
  }
  // (1.3.12) a flight of a log rebuilt here - no FR24 id of its own: FR24's positions of its aircraft in that time, as the
  // monitor kept them (/fr24of: the aircraft's FR24 flights then; /fr24raw: each one's points) - none from a monitor
  // before 1.3.12, or of a day before it kept them by aircraft
  // (1.4.1: and what FR24 said of the flight with them - its flight number and route, kept by a monitor of 1.4.1 on: the
  // meta of the one FR24 flight with most points then)
  async function pbFr24Of(hex, t0, t1, metaOut) {
    if (!/^[0-9a-f]{6}$/.test(hex) || !monUp() || !(t1 > t0)) return [];
    let list = [];
    try { const j = await monGet(`/fr24of?hex=${hex}&t0=${Math.round(t0)}&t1=${Math.round(t1)}`, { timeout: 12000 }); list = Array.isArray(j && j.list) ? j.list : []; } catch (e) { return []; }
    const by = new Map(); let most = 0;
    for (const x of list.filter(x => x && /^[0-9a-f]{1,12}$/.test(String(x.fid || ''))).slice(0, 4)) {
      const r = await pbRaw(String(x.fid), fin(x.t0) ? x.t0 : t0);
      let n = 0; for (const p of r.pts) if (p.t >= t0 && p.t <= t1 && !by.has(p.t)) { by.set(p.t, p); n++; }
      if (metaOut && n > most && r.m) { most = n; Object.assign(metaOut, r.m, { fid: String(x.fid) }); }
    }
    return [...by.values()].sort((p, q) => p.t - q.t);
  }
  // ---- (1.4.1) what FR24's player names a flight by: its flight number, its airline (or the aircraft's operator / owner)
  // FR24's own flight number of a callsign - the monitor learns every pair FR24's map shows (/csfn) - kept here a day
  const csFnMemo = new Map();
  async function csFlightNumber(cs) {
    cs = clean(cs).toUpperCase(); if (!/^[A-Z]{3}\d[A-Z0-9]{0,4}$/.test(cs)) return '';
    const m = csFnMemo.get(cs); if (m && now() - m.at < 864e5) return m.fn;
    let fn = '';
    if (monUp()) { try { const j = await monGet('/csfn?cs=' + encodeURIComponent(cs), { timeout: 5000 }); const v = j && j.list && j.list[cs]; if (typeof v === 'string' && /^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/.test(v)) fn = v; } catch (e) { /* none */ } }
    // (none learnt: an airline's numbered callsign is its flight number with its IATA code - UAL972 is UA972; one with
    // letters in it - EZY327L, U2414 - is not, and has none here)
    if (!fn && /^[A-Z]{3}\d{1,4}$/.test(cs)) { await Promise.race([fr24.loadAirlines().catch(() => null), sleep(3000)]); const id = fr24.byIcao.get(cs.slice(0, 3)), a = id && fr24.airlines ? fr24.airlines.get(id) : null; if (a && /^[A-Z0-9]{2}$/.test(a.iata || '')) fn = a.iata + String(Number(cs.slice(3))); }
    csFnMemo.set(cs, { fn, at: now() }); if (csFnMemo.size > 2000) csFnMemo.delete(csFnMemo.keys().next().value);
    return fn;
  }
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
    if (!leg && monUp()) {
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
    const raw = fidNum ? await pbRaw(id, hint) : { pts: [], m: {} };
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
    const ptsAll = pts;
    pts = pbThin(pts);
    // (its callsign: its leg's, its live record's, what the page or the monitor says - else what the aircraft sent)
    const lv = fidNum ? live.get(fidNum) : null, cs = clean((leg && leg.cs) || (lv && csOfRec(lv)) || d.cs || meta.cs || (pts.find(p => p.cs) || {}).cs || '').toUpperCase();
    // (its airports: its leg's; else where its track begins and ends on the ground - a field within 4 km; else FR24's
    // route of the flight, as kept with its positions)
    const apAt = p => { if (!p || !p.gnd) return null; const n = ENGINE.airportAt(p.lat, p.lon, 4); return n && n.airport ? apById(n.airport.id) || n.airport : null; };
    const apIata = c => { c = clean(c).toUpperCase(); return /^[A-Z0-9]{3}$/.test(c) ? airports.byIata.get(c) || null : null; };
    const from = (leg && leg.from ? apById(leg.from.id) : (w.depAp && apById(w.depAp)) || apAt(pts[0])) || apIata(meta.from);
    const to = (leg ? (leg.to ? apById(leg.to.id) : null) : apAt(pts[pts.length - 1])) || apIata(meta.to);
    // (its landing: its leg's; else, its track ending down at a field, its last moment in the air)
    const lastAir = to && pts[pts.length - 1].gnd ? pts.slice().reverse().find(p => !p.gnd) : null;
    const depT = (leg && (leg.tOff || leg.tStart)) || dep || pts[0].t, arrT = leg && leg.ended ? (leg.tOn || leg.tEnd) : lastAir ? lastAir.t : 0;
    // (its runways, asked at once - ten seconds at most: the flight is not held back for them)
    const rwyP = Promise.race([pbRunways(/^[0-9a-f]{6}$/.test(hex) ? hex : '', fidNum ? id : '', from, to, depT, arrT, ptsAll), sleep(10000).then(() => null)]).then(r => r || { off: '', on: '' }, () => ({ off: '', on: '' }));
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
  async function pbInfo(d) {
    const fid = clean(d && d.fid).toLowerCase(); if (!/^[0-9a-f]{1,12}$/.test(fid)) return { ok: false };
    const placesP = Promise.race([Promise.all([loadAirports().catch(() => null), loadOa().catch(() => null), loadSites().catch(() => null)]), sleep(8000)]);
    const fidNum = parseInt(fid, 16), dep = Number(d.dep) > 1e9 ? Number(d.dep) : 0;
    const raw = await pbRaw(fid, dep), m = raw.m || {};
    const reg = clean(d.reg || m.reg || '').toUpperCase(), cs = clean(d.cs || m.cs || '').toUpperCase();
    let hex = clean(d.hex || (live.get(fidNum) || {}).hex || m.hex || '').toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex) && reg) hex = clean((store.byReg(reg) || {}).hex).toLowerCase() || (/^N\d/.test(reg) ? clean(nNumberHex(reg)).toLowerCase() : '');
    if (!/^[0-9a-f]{6}$/.test(hex)) hex = '';
    const out = { ok: true, fid };
    const jobs = [];
    if (d.wantOwner) jobs.push(pbOperator(hex, reg, cs).then(op => { if (op.name) { out.operator = op.name; out.alId = op.alId || 0; } }));
    if (d.wantFn && cs) jobs.push((async () => { const fn = clean(m.fn || '').toUpperCase() || await csFlightNumber(cs); if (fn && fn !== cs) out.flightNumber = fn; })());
    if (d.wantFrom || d.wantTo) jobs.push((async () => {
      await placesP;
      const t0 = dep || (raw.pts.length ? raw.pts[0].t : 0), leg = hex && t0 ? await pbLegNear(hex, t0) : null;
      let from = leg && leg.from ? apById(leg.from.id) : null, to = leg && leg.to && leg.ended ? apById(leg.to.id) : null;
      // (else where FR24's own track of it began and ended, down at a field - as the map's playback names them)
      if (!from || !to) {
        const ac = hex ? acOfHex(hex) : {}, cls = ENGINE.classify(ac), heli = cls === 'heli';
        // (the page's track's ends first; where one is not down at a field - the page has part of the track - the
        // monitor's FR24 positions of the flight)
        const P = Array.isArray(d.ends) ? d.ends : [];
        const at = p => { const x = p && pbFr24Place(p, heli, !!ac.mil); return x && x.id ? apById(x.id) : null; };
        if (!from) from = at(P[0]) || at(raw.pts[0]); if (!to) to = at(P[1]) || at(raw.pts[raw.pts.length - 1]);
      }
      const apIata = c => { c = clean(c).toUpperCase(); return /^[A-Z0-9]{3}$/.test(c) ? airports.byIata.get(c) || null : null; };
      if (!from) from = apIata(m.from); if (!to) to = apIata(m.to);
      if (from) out.origin = pbAirport(from); if (to) out.destination = pbAirport(to);
    })());
    await Promise.all(jobs.map(j => j.catch(e => log('playback info', String(e && e.message || e)))));
    return out;
  }
  async function onPbInfo(d) {
    let out = { ok: false };
    try { out = await pbInfo(d || {}); } catch (e) { log('playback info', String(e && e.message || e)); }
    postToPage('pbInfoGot', Object.assign({ rid: d && d.rid }, out));
  }
