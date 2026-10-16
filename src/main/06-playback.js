
  // ---- FR24's map playback: the whole map at any moment of FR24's week -------------------------------------------------
  // FR24 replays its feed as it was (Feed/Playback) and the panel of a flight opened in it (Feed/PlaybackFlight); the page
  // reports the moment and the flights it shows with no callsign. Each is named as it was then - from what this script
  // already knew of that very flight (identified while it was live), from the monitor, and - at the same time, not after
  // it, so a monitor that is slow, down or has no answer costs nothing - from adsb.lol's heatmap of that half hour: the
  // one aircraft heard where FR24 had it, at its height, of the type FR24 gives (M-ARNZ's PC-24 off Blackpool, 9 Oct
  // 12:35). The heatmap is read the moment a playback opens and kept (02 heatLoad), so the names are there as the map
  // is. A named flight - and an ordinary one FR24 has no destination for - gets the flight as flown, from its ADS-B
  // track of that day: where it took off and where it landed, the strip's tag "Playback" in red. The flight open in the
  // panel gets its padlocked figures from that track, moment by moment (the page reads them from it as FR24 plays).
  const pbOut = new Map();   // FR24 flight id -> a name found here in a playback, for the monitor (02 reportToMonitor)
  const pb = { ts: 0, at: 0, flights: new Map(), named: new Map(), routes: new Map(), sel: 0, selTs: 0, hexOf: new Map(), naming: new Set(), heatBusy: false, heatAgain: false, tried: new Map(), routing: new Set(), traceKey: '', matchT: 0, monAsked: new Map(), noDest: new Set(), fr24Dest: new Set(), ensured: '', selTrace: null };
  function pbMode() { return /^\/\d{4}-\d\d-\d\d\/\d\d:\d\d\//.test(location.pathname); }
  // (a flight is tried against its half hour's file once a two-minute step of it: tried again further on - one that has
  // since taken off, or come out of a hole in coverage)
  const pbTryKey = ts => heatUrlOf(ts) + '|' + Math.floor(ts / 120);
  function onPbFeed(d) {
    const ts = Number(d.ts) || 0; if (!ts) return;
    pb.ts = ts; pb.at = now();
    for (const f of d.flights || []) {
      if (!fin(f.lat) || !fin(f.lon) || f.type === 'GRND' || f.icon === 25) continue;
      pb.flights.set(f.id, Object.assign({}, f, { ts }));
      if (!pb.named.has(f.id)) { const c = store.getId(f.id); if (c && c.hex) pbAdopt(f.id, Object.assign({}, c), ts); }
    }
    if (pb.flights.size > 3000) for (const k of [...pb.flights.keys()].slice(0, 1000)) pb.flights.delete(k);
    pbHeatWarm(ts);
    pbMatchSoon(50);
  }
  function pbMatchSoon(ms) { if (!pb.matchT) pb.matchT = setTimeout(() => { pb.matchT = 0; pbMatch().catch(e => log('playback match', e)); }, ms); }
  // The heatmap of the moment shown read at once - and, in the last ten minutes of a half hour, the next one's too, as
  // the playback runs into it (two files at most on the way at a time: a quick scrub through the day asks for no more)
  function pbHeatWarm(ts) {
    const want = [ts], next = Math.floor(ts / 1800) * 1800 + 1800;
    if (ts - (next - 1800) >= 1200 && next + 1800 < nowS() - 300) want.push(next);
    for (const t of want) {
      const u = heatUrlOf(t); if (heatHave(u) || heatJobs.has(u) || now() - (heatFail.get(u) || 0) < 60000) continue;
      if (heatJobs.size >= 2) break;
      const back = () => { if (heatUrlOf(pb.ts) === u) pbMatchSoon(0); };
      heatLoad(t).then(back, back);
    }
  }
  // a flight named: the page labels it as FR24 would, and its route as flown follows
  function pbAdopt(id, rec, ts) {
    rec.id = id; pb.named.set(id, rec); pushToPage([rec]);
    if (rec.hex) pbRouteFor(id, rec.hex, ts).catch(e => log('playback route', e));
    if (id === pb.sel) { pbSendTrace(id, rec.hex, pb.selTs || ts).catch(() => {}); pbPhotos(rec, true); syncPanelSoon(); }
    else if (rec.ladd || rec.pia) pbPhotos(rec, false);
  }
  // (one aircraft, one flight: an aircraft already named for another flight of about that moment is not this one too)
  const pbTaken = (hex, id, ts) => { for (const r of pb.named.values()) if (r.hex === hex && r.id !== id && Math.abs((pb.flights.get(r.id) || {}).ts - ts) < 600) return true; return false; };
  // The monitor (22.23, /pbmatch): every FR24 flight it named while it was live, and every other from the tracks it
  // keeps of the blocked aircraft (90 days) - the whole map's unnamed flights in one request, named at once, each with its
  // flight as the monitor logged it. An older monitor: the names it gave live only (/names). (22.25) One it has no name
  // for is asked about again every 45 s while the playback is open, at the moment shown then: the monitor keeps working
  // on it meanwhile - each moment adds to its path, carried across the holes in the tracks - until one aircraft fits.
  const PB_REASK_MS = 45000;
  async function pbFromMonitor(ts) {
    if (!monUp()) return 0;
    const t = now(), fl = [...pb.flights.values()].filter(f => f.ts === ts && !pb.named.has(f.id) && t - (pb.monAsked.get(f.id) || 0) >= PB_REASK_MS).slice(0, 1500);
    if (!fl.length) return 0;
    for (const f of fl) pb.monAsked.set(f.id, t);
    if (pb.monAsked.size > 20000) pb.monAsked.clear();
    const forget = e => { for (const f of fl) pb.monAsked.delete(f.id); log('playback names', String(e && e.message || e)); return null; };
    let j = null;
    if (!pb.monOld) j = await monPost('/pbmatch', { t: Math.round(ts), f: fl.map(f => [f.id, Math.round(f.lat * 1e4) / 1e4, Math.round(f.lon * 1e4) / 1e4, fin(f.alt) ? Math.round(f.alt) : 0, String(f.type || ''), f.gnd ? 1 : 0]) }).catch(e => { if (/HTTP 404/.test(String(e && e.message || e))) { pb.monOld = true; return null; } return forget(e); });
    if (pb.monOld) j = await monGet('/names?ids=' + fl.slice(0, 400).map(f => f.id).join(',') + '&t=' + Math.round(ts), { timeout: 10000 }).catch(forget);
    let n = 0;
    for (const r of (j && Array.isArray(j.list) ? j.list : [])) {
      const [id, hex, reg, type, cs, flags, how, leg] = r;
      if (!pb.flights.has(id) || pb.named.has(id) || !/^[0-9a-f]{6}$/.test(String(hex || '')) || pbTaken(hex, id, ts)) continue;
      const hx = store.getHex(hex) || {}, rec = { hex, cs: /^[A-Z0-9]{2,8}$/.test(String(cs || '')) ? cs : '', reg: reg || hx.reg || hexNNumber(hex), type: String(type || hx.type || '').toUpperCase(), desc: hx.desc || '', ladd: !!(flags & 1 || hx.ladd), mil: !!(flags & 2 || hx.mil), pia: !!(flags & 4 || hx.pia), src: PB_HOW[how] || 'monitor (named live)', matchedAt: now() };
      store.mergeHex(hex, { reg: rec.reg, type: rec.type, ladd: rec.ladd || undefined, pia: rec.pia || undefined, mil: rec.mil || undefined });
      store.setId(id, Object.assign({ id }, rec));
      if (leg && typeof leg === 'object') pbRouteFromLeg(id, hex, leg);
      pbAdopt(id, rec, ts); n++;
      // (named from its track: kept on the monitor with that day, as a browser's playback name is - checked there)
      if (how === 'track') pbOutSet(id, rec, ts);
      if (id === pb.sel) publicIdentity(hex, rec.reg).then(() => { pushToPage([rec]); syncPanelSoon(); }).catch(() => {});
    }
    if (n) log('playback: named from the monitor', n, 'of', fl.length);
    return n;
  }
  const PB_HOW = { track: 'monitor (its track)', reckon: 'monitor (its track, carried across a gap)', path: 'monitor (worked out from its path)', live: 'monitor (named live)' };
  // (a playback left open, paused or not: the monitor asked again about the flights still unnamed - adsb.lol's heatmap
  // not again, it has nothing new for them)
  setInterval(() => { if (pb.ts && now() - pb.at < 15 * 60000 && !document.hidden && pbMode()) pbFromMonitor(pb.ts).catch(e => log('playback names', e)); }, PB_REASK_MS);
  function pbOutSet(id, rec, ts) { pbOut.set(id, [id, rec.hex, rec.reg, rec.type, rec.cs, (rec.ladd ? 1 : 0) | (rec.mil ? 2 : 0) | (rec.pia ? 4 : 0), Math.round(ts)]); if (pbOut.size > 2000) pbOut.delete(pbOut.keys().next().value); }
  // the monitor and the heatmap side by side: whichever answers first names a flight
  async function pbMatch() {
    const ts = pb.ts; if (!ts) return;
    pbHeatWarm(ts);
    await Promise.all([pbFromMonitor(ts).catch(e => log('playback names', e)), pbFromHeat(ts).catch(e => log('playback heatmap', e))]);
  }
  // Every unnamed flight of the moment against adsb.lol's heatmap of its half hour, in one pass
  async function pbFromHeat(ts) {
    const url = heatUrlOf(ts), key = pbTryKey(ts);
    const want = () => [...pb.flights.values()].filter(f => f.ts === ts && !pb.named.has(f.id) && pb.tried.get(f.id) !== key && f.src !== 4 && (f.gnd || f.spd > 40 || f.alt > 1500));
    if (!want().length) return;
    // (on its way: pbHeatWarm comes back here the moment it is in; refused - none for that half hour yet - the flights
    // are said not to be in it, and it is asked for again a minute on)
    const buf = heatHave(url);
    if (!buf) { if (heatFail.has(url) && !heatJobs.has(url) && now() - heatFail.get(url) < 60000) for (const f of want()) pb.tried.set(f.id, key); return; }
    if (pb.heatBusy) { pb.heatAgain = true; return; }
    pb.heatBusy = true;
    try {
      await idleSlice();
      if (pb.ts !== ts) { pb.heatAgain = true; return; }
      const list = want(); if (!list.length) return;
      const res = ENGINE.heatMatch(buf, ts, list.map(f => ({ lat: f.lat, lon: f.lon, trk: f.trk, gs: f.spd, alt: f.alt, gnd: !!f.gnd, r: f.gnd ? 0.3 : 3 })));
      const count = new Map(); res.forEach(h => { if (h) count.set(h, (count.get(h) || 0) + 1); });
      for (let i = 0; i < list.length; i++) {
        const f = list[i], hex = res[i]; pb.tried.set(f.id, key);
        if (!hex || count.get(hex) > 1 || pbTaken(hex, f.id, ts)) continue;
        // (each named on its own - one whose track is still to come holds up neither the others nor the next moment)
        pb.naming.add(f.id); pbHeatName(f, hex, ts).catch(e => log('playback name', e)).then(() => { pb.naming.delete(f.id); if (f.id === pb.sel) syncPanelSoon(); });
      }
      if (pb.tried.size > 20000) for (const k of [...pb.tried.keys()].slice(0, 5000)) pb.tried.delete(k);
    } finally { pb.heatBusy = false; if (pb.heatAgain) { pb.heatAgain = false; pbMatchSoon(0); } }
  }
  // (its callsign at that moment, from its track of the day)
  function pbCsAt(pts, ts) { let cs = '', best = 1e9; for (const p of pts || []) { const dt = Math.abs(p.t - ts); if (dt < best && p.cs) { best = dt; cs = p.cs; } if (p.t > ts + 3600) break; } return /^[A-Z0-9]{2,8}$/.test(cs) ? cs : ''; }
  // A heatmap match named: at once from what is known of the aircraft here already (its registration and type - kept
  // from the lists, earlier flights, its address for a US one), its type against FR24's; what is not known yet - an
  // aircraft never seen here - from its track of that day first, the one request then. Its callsign then follows.
  async function pbHeatName(f, hex, ts) {
    const known = () => { const tm = traceMeta.get(hex) || {}, hx = store.getHex(hex) || {}; return { tm, hx, type: clean(tm.t || hx.type).toUpperCase(), reg: tm.r || hx.reg || hexNNumber(hex) }; };
    const fType = clean(f.type).toUpperCase();
    let k = known(), pts = null;
    if ((fType && !k.type) || !k.reg) { pts = await pbPoints(hex, ts); k = known(); }
    if (fType && k.type && typeRelation(k.type, fType) === 'different') { log('playback match: types differ', f.id.toString(16), hex, k.type, fType); return; }
    if (pb.named.has(f.id) || pbTaken(hex, f.id, ts)) return;
    const flagsOf = k => ({ ladd: !!(k.tm.flags & 8 || k.hx.ladd), pia: !!(k.tm.flags & 4 || k.hx.pia), mil: !!(k.tm.flags & 1 || k.hx.mil) });
    const rec = Object.assign({ hex, cs: pts ? pbCsAt(pts, ts) : '', reg: k.reg, type: k.type || fType, desc: k.tm.desc || k.hx.desc || '' }, flagsOf(k), { src: 'adsb.lol (playback)', matchedAt: now() });
    store.mergeHex(hex, { reg: rec.reg, type: rec.type, ladd: rec.ladd || undefined, pia: rec.pia || undefined, mil: rec.mil || undefined });
    store.setId(f.id, Object.assign({ id: f.id }, rec));
    log('playback: named', f.id.toString(16), hex, rec.reg, 'at', new Date(ts * 1000).toISOString().slice(11, 16));
    pbAdopt(f.id, rec, ts);
    // (and to the monitor: kept there for good with the day of the flight - any later playback of it, anyone's, named)
    pbOutSet(f.id, rec, ts);
    if (f.id === pb.sel) publicIdentity(hex, rec.reg).then(() => { pushToPage([rec]); syncPanelSoon(); }).catch(() => {});
    if (pts) return;
    // (named before its track was read: its callsign then - and anything the track's own record adds - once it is in)
    const p2 = await pbPoints(hex, ts); if (pb.named.get(f.id) !== rec) return;
    const k2 = known(), fl = flagsOf(k2), cs = pbCsAt(p2, ts), add = {};
    if (cs && !rec.cs) add.cs = cs;
    if (!rec.reg && k2.reg) add.reg = k2.reg;
    if (!rec.desc && (k2.tm.desc || k2.hx.desc)) add.desc = k2.tm.desc || k2.hx.desc;
    for (const x of ['ladd', 'pia', 'mil']) if (fl[x] && !rec[x]) add[x] = true;
    if (!Object.keys(add).length) return;
    Object.assign(rec, add);
    store.mergeHex(hex, { reg: rec.reg || undefined, ladd: rec.ladd || undefined, pia: rec.pia || undefined, mil: rec.mil || undefined });
    store.setId(f.id, Object.assign({ id: f.id }, rec)); pbOutSet(f.id, rec, ts);
    pushToPage([rec]); if (f.id === pb.sel) syncPanelSoon();
  }
  // The flight as flown: its ADS-B track of that day (and of the next or the day before, across midnight) in legs - the
  // one it was flying at that moment, or about to fly from where it stood - with both its ends; an end away from FR24's
  // airports, where it was seen down, is the landing place learned there.
  async function pbRouteFor(id, hex, ts) {
    // (worked out before without an end, and now the flight open in the panel: FR24's own track asked as well, below)
    const have = pb.routes.get(id); if (have && have.hex === hex && (have.destIata || have.fr24Tried || id !== pb.sel)) return have;
    const k = id + ':' + hex; if (pb.routing.has(k)) return null; pb.routing.add(k);
    let out = null;
    try {
      // (the flight open in the panel: FR24's own track of it asked for at once, beside the public one - used only for an
      // end the public track does not have)
      let fr24 = id === pb.sel ? pbFr24Ends(id, ts) : null;
      await loadAirports();
      const ac = acOfHex(hex), cls = ENGINE.classify(ac), heli = cls === 'heli', day0 = dayEndS(dayStr(ts * 1000)) - 86400;
      let pts = await pbPoints(hex, ts);
      const legsOf = (p, end) => summarize(ENGINE.legsFromPoints(p, { heli, patrol: cls === 'fighter' || cls === 'milheavy', cls, type: ac.type, rangeKm: ENGINE.typeRangeKm(ac), dataEnd: end }), hex);
      const pick = sums => sums.find(s => ts >= s.tStart - 300 && ts <= s.tEnd + 300) || sums.find(s => s.tStart > ts && s.tStart - ts < 3 * 3600) || sums.slice().reverse().find(s => s.tEnd < ts && ts - s.tEnd < 3600) || null;
      let end = Math.min(nowS(), day0 + 86400), s = pick(legsOf(pts, end));
      // (still flying at midnight: the next day has its landing; first heard in the air just after midnight: the day before
      // has its take-off)
      if (s && !s.ended && s.tEnd > end - 900 && end < nowS() - 60) { pts = ENGINE.mergePoints(pts, await pbPoints(hex, end + 60)).sort((a, b) => a.t - b.t); end = Math.min(nowS(), end + 86400); s = pick(legsOf(pts, end)); }
      if (s && !s.startedOnGround && !s.from && s.tStart < day0 + 900) { pts = ENGINE.mergePoints(await pbPoints(hex, day0 - 60), pts).sort((a, b) => a.t - b.t); s = pick(legsOf(pts, end)); }
      // An end the public track has not got - a military jet heard only by multilateration and lost out over the sea
      // (CAPTR33's Hawk out of Leeming, 15 Oct: "N/A" in playback), a flight with no public track at all: where FR24's
      // own track of the flight began and ended, when that was down at a field
      let tried = false;
      if (id === pb.sel && (!s || !(s.to && s.ended) || !(s.from || s.startedOnGround))) { tried = true; s = pbWithFr24Ends(s, await (fr24 || pbFr24Ends(id, ts)), heli, !!ac.mil, heli || cls === 'piston' || cls === 'glider'); }
      if (!s) return null;
      const r = pbRouteOf(hex, s, heli); if (tried) r.fr24Tried = true;
      out = pbRouteSet(id, r);
      return out;
    } finally {
      pb.routing.delete(k);
      // (the page holds FR24's panel answer until this is known: told there is none, so it waits no longer)
      if (!out && !pb.routes.has(id)) postToPage('pbRoute', { id, none: true });
    }
  }
  // FR24's own track of a flight (its flight-playback answer - what its free playback shows): its first and last point,
  // asked once per flight
  const pbFr24Asked = new Map();
  function pbFr24Ends(id, ts) {
    const fid = Number(id).toString(16);
    if (!pbFr24Asked.has(fid)) { pbFr24Asked.set(fid, fr24TrackEnds(fid, Math.round(ts || nowS())).catch(() => null)); if (pbFr24Asked.size > 300) pbFr24Asked.delete(pbFr24Asked.keys().next().value); }
    return pbFr24Asked.get(fid);
  }
  // (an end of FR24's track down at a field - low and slow, as an aircraft landing or taking off is: an airport within
  // 7 km, a strip within 2; a helicopter's or light aircraft's anywhere else, a landing site. One high or fast there is
  // where FR24 lost it, not where it landed.)
  function pbFr24Place(p, heli, mil) {
    if (!p || !fin(p.lat) || !fin(p.lon)) return null;
    const alt = fin(p.alt) ? p.alt : 0, gs = fin(p.gs) ? p.gs : 0;
    if (alt > 2000 || gs > (heli ? 80 : 220)) return null;
    const n = heli ? ENGINE.heliAirportAt(p.lat, p.lon) || ENGINE.fieldAt(p.lat, p.lon, 2, { alt: p.alt, maxAgl: 600 }) : ENGINE.placeAt(p.lat, p.lon, 7, 2, { mil });
    if (n && n.airport) return { id: n.airport.id, site: false };
    return alt < 1000 && gs < 120 ? { id: 0, site: true } : null;
  }
  function pbWithFr24Ends(s, e, heli, mil, light) {
    if (!e || !e.start || !e.end) return s;
    // (FR24's flight and the public leg must be the same flight: one that does not overlap it is left aside)
    if (s && fin(e.start.t) && fin(e.end.t) && (e.start.t > s.tEnd + 1800 || e.end.t < s.tStart - 1800)) s = null;
    const a = pbFr24Place(e.start, heli, mil), b = pbFr24Place(e.end, heli, mil);
    if (!a && !b) return s;
    const o = s ? Object.assign({}, s) : { tStart: e.start.t, tEnd: e.end.t, from: null, to: null, startLat: e.start.lat, startLon: e.start.lon, endLat: e.end.lat, endLon: e.end.lon, startedOnGround: false, ended: false };
    // (a site is taken only for an aircraft that lands at one - a helicopter, a piston, a glider: a jet "away from every
    // field" was lost there)
    if (b && !(o.to && o.ended) && (b.id || (b.site && light))) { o.to = b.id ? { id: b.id, conf: 'fr24' } : null; o.ended = true; o.endLat = e.end.lat; o.endLon = e.end.lon; if (fin(e.end.t)) { o.tOn = e.end.t; o.tEnd = Math.max(o.tEnd || 0, e.end.t); } }
    if (a && !o.from && !o.startedOnGround && (a.id || (a.site && light))) { o.from = a.id ? { id: a.id, conf: 'fr24' } : null; o.startedOnGround = true; o.startLat = e.start.lat; o.startLon = e.start.lon; if (fin(e.start.t)) { o.tOff = e.start.t; o.tStart = Math.min(o.tStart || e.start.t, e.start.t); } }
    return o;
  }
  // (a flight - its summary, the engine's or the monitor's log's - as the strip and FR24's panel show a flight flown: an end
  // away from FR24's airports, where it was seen down, is the landing place learned there)
  function pbRouteOf(hex, s, heli) {
    const end1 = (e, la, lo, down) => { const a = e ? apById(e.id) : null; const sid = (!a || a.id >= 1e7) && down && fin(a ? a.lat : la) ? learnSite(a ? a.lat : la, a ? a.lon : lo, { heli }) : 0; const b = sid ? apById(sid) : a; return b ? { id: fr24Ap(b.id) || 0, iata: apCode(b), city: b.city || b.name || '' } : null; };
    const o = end1(s.from, s.startLat, s.startLon, s.startedOnGround), d = end1(s.to, s.endLat, s.endLon, s.ended);
    return { hex, t0: s.tStart, t1: s.tEnd, originId: o ? o.id : 0, originIata: o ? o.iata : '', originCity: o ? o.city : '', destId: d ? d.id : 0, destIata: d ? d.iata : '', destCity: d ? d.city : '',
      atd: s.tOff || (s.startedOnGround ? s.tStart : 0), ata: s.ended && d ? (s.tOn || s.tEnd) : 0, std: 0, sta: 0, eta: 0, landed: false, destConf: 'playback', destP: 0, progress: null, groundAirportId: 0, pb: true };
  }
  function pbRouteSet(id, route) {
    pb.routes.set(id, route); if (pb.routes.size > 3000) pb.routes.delete(pb.routes.keys().next().value);
    postToPage('pbRoute', { id, route });
    if (id === pb.sel) syncPanelSoon();
    return route;
  }
  // (the flight as the monitor logged it: no day trace to read - with airports loaded; otherwise read as before)
  function pbRouteFromLeg(id, hex, leg) {
    if (!airportsReady() || !fin(leg.tStart)) return null;
    try { return pbRouteSet(id, pbRouteOf(hex, leg, ENGINE.classify(acOfHex(hex)) === 'heli')); } catch (e) { log('playback route', e); return null; }
  }
  // Mach and the outside air temperature of a report: the aircraft's own (readsb's record of its air data), else worked
  // out from its other figures - Mach from the indicated airspeed at its pressure altitude (compressible flow, the
  // indicated airspeed taken for the calibrated), the temperature from the true airspeed against the speed of sound at
  // that Mach, as readsb works it out (from Mach 0.395: below, the rounding of the figures sent makes it too inexact)
  function machOf(ias, altFt) {
    if (!(ias > 30) || !fin(altFt) || altFt > 60000) return NaN;
    const p = altFt <= 36089 ? 101325 * Math.pow(1 - 6.8755856e-6 * altFt, 5.2558797) : 22632.06 * Math.exp(-4.806346e-5 * (altFt - 36089));
    const qc = 101325 * (Math.pow(1 + 0.2 * Math.pow(ias / 661.4786, 2), 3.5) - 1), m = Math.sqrt(5 * (Math.pow(qc / p + 1, 2 / 7) - 1));
    return m > 0.05 && m < 1 ? m : NaN;
  }
  // (one worked out is kept only where it makes sense: a temperature within 35 °C of the standard atmosphere's at that
  // height - the figures of one report do not always belong together. Against the aircraft's own in the day tracks of
  // test/fixtures/legs: Mach from the airspeed a median 0.001 off, the temperature 0.3 °C off from its own Mach, 0.8 °C
  // from the worked-out one.)
  const isaC = ft => 15 - 1.98 * Math.min(Math.max(ft, 0), 36089) / 1000;
  const tempOf = (tas, mach, ft) => { const c = Math.pow(tas / (38.967854 * mach), 2) - 273.15; return Math.abs(c - isaC(ft)) <= 35 ? c : NaN; };
  function pbAir(p) {
    if (p.own === false || p.gnd0 || !fin(p.alt)) return [null, null];
    let mach = p.mach > 0 && p.mach < 1 ? p.mach : NaN, oat = fin(p.oat) ? p.oat : NaN;
    if (!fin(mach)) { const m = machOf(p.ias, p.alt); if (fin(m) && (!(p.tas > 0) || fin(tempOf(p.tas, m, p.alt)))) mach = m; }
    if (!fin(oat) && mach >= 0.395 && p.tas > 0) oat = tempOf(p.tas, mach, p.alt);
    return [fin(mach) ? Math.round(mach * 1000) / 1000 : null, fin(oat) ? Math.round(oat) : null];
  }
  // the open flight's track, for its padlocked figures as FR24 plays it: the flight's span, every report
  async function pbSendTrace(id, hex, ts) {
    if (!hex || !ts) return;
    const key = id + '|' + hex + '|' + dayStr(ts * 1000); if (pb.traceKey === key) return; pb.traceKey = key;
    const pts = await pbPoints(hex, ts), r = pb.routes.get(id);
    const lo = (r ? r.t0 : ts - 3 * 3600) - 600, hi = (r ? r.t1 : ts + 3 * 3600) + 600, nz = v => fin(v) ? Math.round(v) : null;
    // (and the airspace it was in - FIR / UIR by position and height - worked out once a minute along the way)
    let firT = -1e9, fir = null;
    const rows = pts.filter(p => p.t >= lo && p.t <= hi).map(p => { if (p.t - firT >= 60) { firT = p.t; fir = firInfo(p.lat, p.lon, p.gnd0 ? 0 : p.alt); } const [mach, oat] = pbAir(p); return [Math.round(p.t), nz(p.alt), nz(p.altGeom), nz(p.vr), nz(p.ias), nz(p.tas), p.sq || '', nz(p.wd), nz(p.ws), p.own === false ? 0 : 1, fir ? fir.name : '', fir ? fir.code : '', mach, oat]; });
    postToPage('pbTrace', { id, hex, pts: rows }); pb.selTrace = { id, rows };
    // (the other network's reports of that day, once in: the holes filled)
    const m = pbMore(hex, ts); if (m) m.then(all => { if (pb.traceKey !== key || all.length <= pts.length) return; pb.traceKey = ''; pbSendTrace(id, hex, ts).catch(() => {}); }).catch(() => {});
  }
  function onPbFollow(d) {
    const id = Number(d.id) || 0; if (!id) return;
    const first = pb.sel !== id; pb.sel = id; pb.selTs = Number(d.ts) || pb.ts; pb.at = now();
    const rec = pb.named.get(id) || (c => c && c.hex ? c : null)(store.getId(id));
    if (rec && !pb.named.has(id)) pbAdopt(id, Object.assign({}, rec), pb.selTs);
    else if (rec && first) { pbSendTrace(id, rec.hex, pb.selTs).catch(() => {}); pbRouteFor(id, rec.hex, pb.selTs).catch(e => log('playback route', e)); }
    // (its pictures first, at the front of the queue - not after the registers, as they were (a LADD aircraft's slideshow
    // took tens of seconds); its register facts - serial number, build year, country, owner - for the panel's own fields)
    if (rec && first) { const r = pb.named.get(id) || rec; pbPhotos(r, true); publicIdentity(r.hex, r.reg).then(() => { pushToPage([r]); syncPanelSoon(); }).catch(() => {}); enrich(r).catch(() => {}); }
    else if (!rec && pb.flights.has(id)) pbMatchSoon(50);
    syncPanelSoon();
  }
  // The pictures of a playback flight's aircraft, through the pipeline every card uses (JetPhotos first): asked the moment
  // it is named or opened - the one opened at the front of the queue. Blocked aircraft named on the map are asked for in
  // the background as well, a few dozen at most, so the one clicked usually has them already.
  let pbPhotoWarm = 0;
  function pbPhotos(rec, pri) {
    if (!rec || !/^[0-9a-f]{6}$/.test(rec.hex || '')) return;
    if (!pri) { if (pbPhotoWarm >= 40) return; pbPhotoWarm++; }
    try { onNeedPhotos({ hex: rec.hex, reg: rec.reg || '', pri: !!pri }); } catch (e) { log('playback photos', e); }
  }
  // the aircraft of the flight opened (FR24's own, for one it names): its track for the figures, and - FR24 having no
  // destination for it, or the page not knowing yet (the flight as the feed selects it) - its route as flown
  function onPbHex(d) {
    const id = Number(d.id) || 0, hex = clean(d.hex).toLowerCase(); if (!id) return;
    if (/^[0-9a-f]{6}$/.test(hex)) {
      const t = Number(d.ts) || pb.selTs;
      pb.hexOf.set(id, hex); if (pb.hexOf.size > 500) pb.hexOf.delete(pb.hexOf.keys().next().value);
      if (!d.sel) { if (Number(d.d)) pb.fr24Dest.add(id); else pb.noDest.add(id); if (pb.noDest.size > 2000) pb.noDest.clear(); if (pb.fr24Dest.size > 2000) pb.fr24Dest.clear(); }
      // (both at once: the route no longer holds up the track - the page waits for both, 1.5 s at most)
      if (d.sel || !Number(d.d)) pbRouteFor(id, hex, t).catch(e => log('playback route', e));
      pbSendTrace(id, hex, t).catch(() => {});
      if (id === pb.sel || d.sel) syncPanelSoon();
    }
  }
  // ---- "Playback" of a blocked flight: where and when FR24's own map playback opens it (the page asks) ---------------
  // The page knows the flights of this session and the rows it was given. For the rest - a search result of an aircraft
  // not flying now or of a callsign it flew under, a board row with only one of its ends, a leg with no place - the
  // aircraft's flight is found here: the one it is flying, else the leg of its log nearest the moment the page has (the
  // row's time), else its latest. Its take-off, and the field it left - or where it was first heard; and the places of
  // the airports the page names. (The page's pbPlan makes the playback's moment and place of them.)
  async function onPbWhere(d) {
    let out = {};
    try { out = await pbWhere(d || {}); } catch (e) { log('playback where', e); }
    postToPage('pbWhereRes', Object.assign({ rid: d && d.rid }, out));
  }
  async function pbWhere(d) {
    const ll = {}, llOf = a => a && fin(a.lat) && fin(a.lon) ? [a.lat, a.lon] : null, isHx = h => /^[0-9a-f]{6}$/.test(h || '');
    for (const a of [d.depAp, d.atAp]) { const p = Number(a) ? llOf(apById(Number(a))) : null; if (p) ll[a] = p; }
    const id = Number(d.id) || 0, hint = Number(d.dep) || Number(d.at) || 0, reg = clean(d.reg).toUpperCase(), cs = csKey(d.cs);
    let hex = clean(d.hex).toLowerCase();
    if (!isHx(hex) && id && live.get(id)) hex = clean(live.get(id).hex).toLowerCase();
    if (!isHx(hex) && reg) hex = clean((store.byReg(reg) || {}).hex).toLowerCase() || (/^N\d/.test(reg) ? clean(nNumberHex(reg)).toLowerCase() : '');
    if (!isHx(hex) && cs) {
      let best = -1;
      for (const [, rec] of live) if (rec && isHx(rec.hex) && csKey(csOfRec(rec)) === cs) { hex = rec.hex; best = nowS(); }
      if (best < 0) for (const [h, v] of store.allHex()) for (const x of (v && v.recent) || []) if (csKey(x[6]) === cs && (x[0] || 0) > best && (!hint || Math.abs(x[0] - hint) < 86400)) { best = x[0] || 0; hex = h; }
    }
    if (!isHx(hex)) return { ll };
    // its flights: the one it is flying (FR24's id for it, its route as worked out here) and the legs of its log
    const cands = [];
    for (const [fid, rec] of live) {
      if (!rec || rec.hex !== hex) continue;
      const r = (routeState.get(fid) || {}).route || {}, dep = r.departedAt || r.atd || 0, oa = (r.originId && apById(r.originId)) || (r.originSite && fin(r.originSite.lat) ? r.originSite : null);
      const ph = posHistory.get(fid) || [], p0 = dep ? ph.find(p => p.at / 1000 >= dep - 60 && fin(p.lat)) : null, cur = currentPos(fid);
      cands.push({ fid, t: dep, ll: llOf(oa) || (p0 ? [p0.lat, p0.lon] : null), z: oa ? 10 : 9, now: cur && fin(cur.lat) && fin(cur.lon) ? [cur.lat, cur.lon] : null, live: true });
    }
    const legs = compactToLegs((store.getHex(hex) || {}).recent || []);
    const full = legs.some(l => !(l.from && apById(l.from.id))) ? await store.getHist(hex).catch(() => null) : null;
    for (const l of legs) {
      if (!(l.tStart > 0)) continue;
      const a = l.from ? apById(l.from.id) : null; let p = llOf(a);
      if (!p && full && Array.isArray(full.legs)) { const f = full.legs.find(x => x && Math.abs(x.tStart - l.tStart) < 120 && fin(x.startLat) && fin(x.startLon)); if (f) p = [f.startLat, f.startLon]; }
      cands.push({ t: l.tStart, t1: l.tEnd, ll: p, z: a ? 10 : 9, from: l.from ? l.from.id : 0, to: l.to ? l.to.id : 0 });
    }
    // (the page's moment: the flight nearest it, six hours at most - one touching the row's airport by half an hour
    // sooner; no moment: the flight it is flying, else its latest)
    let pick = null;
    if (hint) {
      let best = 6 * 3600;
      for (const c of cands) {
        if (!(c.t > 0)) continue;
        const ref = d.kind === 'arrivals' && !Number(d.dep) && c.t1 ? c.t1 : c.t, ap = Number(d.apId) || 0;
        const dt = Math.abs(ref - hint) - (ap && (c.from === ap || c.to === ap) ? 1800 : 0);
        if (dt < best) { best = dt; pick = c; }
      }
    } else pick = cands.find(c => c.live) || cands.filter(c => c.t > 0).sort((a, b) => b.t - a.t)[0] || null;
    if (!pick) return { ll, hex };
    return { ll, hex, fid: pick.fid || 0, dep: pick.t || 0, depLL: pick.ll || null, z: pick.z, posLL: pick.now || null };
  }
  // (the flight open in the panel, whichever way its aircraft became known - the page's message, a name found here, or
  // the address on the panel itself: its route, its track and its register facts, once)
  function pbEnsure(id, hex) {
    const k = id + ':' + hex; if (pb.ensured === k) return; pb.ensured = k;
    const ts = pb.selTs || pb.ts, r = pb.named.get(id);
    pbRouteFor(id, hex, ts).catch(e => log('playback route', e));
    pbSendTrace(id, hex, ts).catch(() => {});
    publicIdentity(hex, (r && r.reg) || '').then(() => syncPanelSoon()).catch(() => {});
  }
  // (the squawk at the moment shown, from the open flight's track: the nearest report with one, ten minutes at most)
  function pbSqAt(id, ts) {
    const tr = pb.selTrace; if (!tr || tr.id !== id || !ts) return '';
    let best = 601, sq = '';
    for (const r of tr.rows) { const dt = Math.abs(r[0] - ts); if (r[6] && dt < best) { best = dt; sq = r[6]; } if (r[0] > ts + 600) break; }
    return /^[0-7]{4}$/.test(sq) ? sq : '';
  }
  // The panel's padlocked - or "N/A" - country of registration, serial number, age and squawk in playback, as on a live
  // flight: FR24 answers a playback panel once, before the registers have answered for an aircraft just named - so written
  // in its cells as they come (never the live airspeeds and the like: those of the moment played come from its track, 06
  // pbSendTrace; the squawk too, and here as well should FR24 keep its padlock). Only into a panel showing that very
  // aircraft; anything of ours taken out again for another.
  const PB_LOCKED = new Set(['country', 'msn', 'age', 'sq']);
  function pbLocked(panel, hx) {
    const shown = panelHex(panel); if (hx && shown && hx.hex && shown !== hx.hex) hx = null;
    let vals = null;
    for (const cell of panel.querySelectorAll('[class*="col-span"]')) {
      const label = cell.firstElementChild; if (!label || label.tagName !== 'P') continue;
      const hit = LOCKED_FIELDS.find(x => x[0].test(clean(label.textContent))); if (!hit || !PB_LOCKED.has(hit[1])) continue;
      const lock = lockOf(cell), mine = cell.querySelector('.tl-filled');
      const naEl = lock || mine ? null : [...cell.children].find(c => c !== label && c.tagName === 'P' && ('tlVal' in c.dataset || (!!clean(textOf(c)) && isNA(textOf(c)))));
      if (!lock && !mine && !naEl) continue;
      if (!vals) { const c = hx && hx.hex ? countryOf(hx.hex, hx.reg) : null; vals = hx ? { country: (regCountry(hx.reg) || {}).name || hx.country || (c && c.name) || '', msn: hx.msn || '', age: ageText(hx), sq: pbSqAt(pb.sel, pb.ts || pb.selTs) } : {}; }
      const v = vals[hit[1]] || '';
      if (!naEl) { fillLockedCell(cell, v, hit[1]); continue; }
      // (a cell FR24 shows as "N/A": the value written into it, and FR24's "N/A" put back when there is none any more)
      if (v) setText(naEl, v, hit[1] === 'age' ? ageTitle(hx) || 'From public data (LADD unblocker)' : 'From public data (LADD unblocker)');
      else if ('tlVal' in naEl.dataset) { if (clean(textOf(naEl)) === naEl.dataset.tlVal) writeOwn(naEl, naEl.dataset.tlOrig); delete naEl.dataset.tlVal; delete naEl.dataset.tlOrig; naEl.removeAttribute('title'); }
    }
  }
  // (the airport boxes: a value of ours FR24 has since written over is FR24's own again)
  const pbBoxOrig = el => { if (!el) return ''; if (el.dataset.tlVal && clean(textOf(el)).replace(/\?$/, '') !== el.dataset.tlVal) { delete el.dataset.tlVal; delete el.dataset.tlOrig; } return clean(el.dataset.tlVal ? el.dataset.tlOrig : textOf(el)); };
  // The strip in playback: who it was (a flight FR24 does not name) and the flight as flown, tagged "Playback" in red -
  // never a prediction: by then it was over
  function pbStrip(panel) {
    const id = pb.sel, shown = panelHex(panel);
    // (another flight opened: what was written into the panel for the one before taken out - FR24 does not redraw a
    // value of its own that has not changed)
    if (panel.__tlPbId !== id) { restore(panel); panel.__tlPbId = id; panel.__tlPbAt = now(); panel.__tlPbPrev = panel.__tlPbShown || ''; }
    panel.__tlPbShown = shown;
    const rec = id ? pb.named.get(id) || null : null, f = id ? pb.flights.get(id) : null;
    // Which aircraft: the record of one named here, what the page said, else - for a flight FR24 names whose answer was
    // not seen (CAPTR33's Hawk, 15 Oct: N/A to, padlocks left) - the ICAO address on the panel itself, once it is the new
    // flight's (FR24 shows the one before for a moment)
    let hex = (rec && rec.hex) || (id && pb.hexOf.get(id)) || '';
    if (!hex && id && shown && (shown !== panel.__tlPbPrev || now() - panel.__tlPbAt > 3000)) { hex = shown; pb.hexOf.set(id, hex); }
    if (id && hex) pbEnsure(id, hex);
    const route = id ? pb.routes.get(id) || null : null;
    const hx = rec ? withStored(rec) : hex ? Object.assign({ hex }, store.getHex(hex) || {}) : null;
    pbLocked(panel, hx);
    // (its pictures in the panel as they come: FR24 drew it once, before they were in)
    if (rec && (!shown || shown === rec.hex)) applyPhoto(panel, hx);
    // FR24 has no destination for it: the route as flown into its own boxes, wherever they say "N/A" - the panel's answer
    // is given it when the route is in before FR24 draws (the page holds it a moment); this is for one that comes after
    const arr = q(panel, SEL.arrIata), dep = q(panel, SEL.depIata);
    const noDest = !!id && !pb.fr24Dest.has(id) && (pb.noDest.has(id) || !!rec || (isNA(pbBoxOrig(arr)) && now() - panel.__tlPbAt > 1500));
    if (route && noDest && (!shown || shown === route.hex)) {
      const ttl = 'Playback - the flight as flown (LADD unblocker)';
      if (route.destIata) applyAirportBox(arr, route.destIata, route.destCity, ttl + (route.ata ? ', landed ' + hhmmZ(route.ata) : ''), '', undefined, apById(route.destId));
      if (route.originIata) applyAirportBox(dep, route.originIata, route.originCity, ttl + (route.atd ? ', took off ' + hhmmZ(route.atd) : ''), '', undefined, apById(route.originId));
    }
    if (!rec && (!route || !noDest)) {
      if (!f || !panelLooksBlocked(panel)) { panel.querySelectorAll('.tl-strip').forEach(e => e.remove()); return; }
      const el = strip(panel); el.dataset.state = 'playback';
      const html = rowHtml('plane', gridHtml([cellHtml('Blocked aircraft' + tagHtml('LADD', 'ladd'), pb.tried.get(id) === pbTryKey(f.ts) && !pb.naming.has(id) ? '<span class="tl-muted">not in the public ADS-B record of that moment</span>' : '<span class="tl-spin"></span> identifying from the public ADS-B record of that moment…', '', true)]));
      if (el.__tlHtml !== html) { el.innerHTML = html; el.__tlHtml = html; }
      return;
    }
    const el = strip(panel); el.dataset.state = 'playback';
    const badge = rec ? (hx.ladd ? 'LADD' : hx.pia ? 'PIA' : hx.mil ? 'MIL' : 'ADS-B') : '';
    const idCell = rec ? cellHtml('Identified from public ADS-B' + tagHtml(badge, 'ladd'), `${esc((hx.hex || '?').toUpperCase())}`, '', true) : '';
    const tag = tagHtml('Playback', 'pb');
    const rc = !route ? gridHtml([cellHtml('Destination' + tag, '<span class="tl-spin"></span> <span class="tl-muted">reading its track of that day…</span>', '', true)])
      : gridHtml([route.destIata ? cellHtml((route.ata ? 'Landed at' : 'Destination') + tag, apHtml(route.destIata, route.destCity), route.ata ? 'landed ' + esc(hhmmZ(route.ata)) : 'its landing not heard', true) : cellHtml('Destination' + tag, '<span class="tl-muted">not in its public track</span>', '', true),
        route.originIata ? cellHtml('Departure', apHtml(route.originIata, route.originCity), route.atd ? 'took off ' + esc(hhmmZ(route.atd)) : '') : cellHtml('Departure', '<span class="tl-muted">unknown</span>', '')]);
    const links = rec ? aircraftLinks(hx) : '';
    const html = rowHtml(rec ? 'plane' : 'pin', `${idCell ? gridHtml([idCell]) + '<hr class="border border-white">' : ''}${rc}${links ? `<div class="tl-links">${links}</div>` : ''}`);
    if (el.__tlHtml !== html) { el.innerHTML = html; el.__tlHtml = html; }
  }
