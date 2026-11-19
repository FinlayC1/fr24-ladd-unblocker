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
  async function pbRunways(hex, fid, from, to, dep, arr) {
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
      return '';
    };
    [out.off, out.on] = await Promise.all([one(from, 0, dep), one(to, 1, arr)]);
    return out;
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
  async function pbFr24Of(hex, t0, t1) {
    if (!/^[0-9a-f]{6}$/.test(hex) || !monUp() || !(t1 > t0)) return [];
    let list = [];
    try { const j = await monGet(`/fr24of?hex=${hex}&t0=${Math.round(t0)}&t1=${Math.round(t1)}`, { timeout: 12000 }); list = Array.isArray(j && j.list) ? j.list : []; } catch (e) { return []; }
    const by = new Map();
    for (const x of list.filter(x => x && /^[0-9a-f]{1,12}$/.test(String(x.fid || ''))).slice(0, 4)) {
      const r = await pbRaw(String(x.fid), fin(x.t0) ? x.t0 : t0);
      for (const p of r.pts) if (p.t >= t0 && p.t <= t1 && !by.has(p.t)) by.set(p.t, p);
    }
    return [...by.values()].sort((p, q) => p.t - q.t);
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
    const legs = /^[0-9a-f]{6}$/.test(hex) ? knownLegs(hex) : [];
    let leg = null, best = 3 * 3600;
    for (const l of legs) { const dt = Math.abs((l.tOff || l.tStart) - dep); if (l.tStart > 0 && dt < best) { best = dt; leg = l; } }
    // (the time it took: its leg's, else what FR24's page or the record says - and for a flight still in the air, until now)
    let t0 = leg ? leg.tStart - 120 : dep - 600, t1 = leg ? (leg.ended ? leg.tEnd + 120 : nowS()) : w.end > dep ? w.end + 600 : Number(d.arr) > dep ? Number(d.arr) + 600 : 0;
    if (!(t1 > t0) && raw.pts.length) t1 = raw.pts[raw.pts.length - 1].t + 60;
    if (!(t1 > t0)) t1 = Math.min(nowS(), t0 + 12 * 3600);
    // (1.4.0: the public track, FR24's positions of it and its pictures asked for together - each had waited for the one
    // before: some five seconds of FR24's flights page before its player)
    const hx0 = /^[0-9a-f]{6}$/.test(hex) ? store.getHex(hex) || {} : {};
    const photoP = !(hx0.photos || []).some(p => p && (p.large || p.medium)) && hex ? monPhotos(hex).catch(() => null) : Promise.resolve(null);
    // (FR24's positions of it: its own id's - else, a flight of a rebuilt log, its aircraft's then - before ADS-B's)
    const [adsb, fr] = await Promise.all([
      /^[0-9a-f]{6}$/.test(hex) ? (day && t0 >= nowS() - 86400 ? Promise.resolve(day) : pbAdsb(hex, t0, t1).catch(() => [])) : Promise.resolve([]),
      raw.pts.length ? Promise.resolve(raw.pts) : pbFr24Of(hex, t0, t1).catch(() => [])]);
    let pts = pbFr24First(fr, adsb).filter(p => p.t >= t0 && p.t <= t1);
    // (no leg of it known: the flight itself out of the record - not the day's other flights)
    if (!leg && pts.length) pts = pbCut(pts, dep);
    if (pts.length < 2) return { ok: false };
    pts = pbThin(pts);
    const hx = /^[0-9a-f]{6}$/.test(hex) ? store.getHex(hex) || {} : {};
    // (its callsign: its leg's, its live record's, what the page or the monitor says - else what the aircraft sent)
    const lv = fidNum ? live.get(fidNum) : null, cs = clean((leg && leg.cs) || (lv && csOfRec(lv)) || d.cs || raw.m.cs || (pts.find(p => p.cs) || {}).cs || '').toUpperCase();
    // (its airports: its leg's; else where its track begins and ends on the ground - a field within 4 km)
    const apAt = p => { if (!p || !p.gnd) return null; const n = ENGINE.airportAt(p.lat, p.lon, 4); return n && n.airport ? apById(n.airport.id) || n.airport : null; };
    const from = leg && leg.from ? apById(leg.from.id) : (w.depAp && apById(w.depAp)) || apAt(pts[0]), to = leg && leg.to ? apById(leg.to.id) : leg ? null : apAt(pts[pts.length - 1]);
    let photos = (hx.photos || []).filter(p => p && (p.large || p.medium));
    const depT = (leg && (leg.tOff || leg.tStart)) || dep || pts[0].t, arrT = leg && leg.ended ? (leg.tOn || leg.tEnd) : 0;
    const rwyP = pbRunways(/^[0-9a-f]{6}$/.test(hex) ? hex : '', fidNum ? id : '', from, to, depT, arrT).catch(() => ({ off: '', on: '' }));
    if (!photos.length && hex) { try { const mp = await photoP; photos = goodPhotos((mp && mp.photos) || []).map(cleanPhoto); } catch (e) { /* none */ } }
    const rwys = await rwyP;
    return {
      ok: true, id: fidNum ? id : syn ? id : pbSynId(hex, (leg && (leg.tOff || leg.tStart)) || dep), hex, reg: clean(hx.reg || raw.m.reg || d.reg || '').toUpperCase(), cs,
      flightNumber: clean(d.flightNumber || ''), model: modelName(hx) || clean(raw.m.type || ''), type: clean(hx.type || raw.m.type || ''), operator: shownOwner(hx, cs) || '', msn: clean(hx.msn || ''),
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
