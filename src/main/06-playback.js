
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
  const pb = { ts: 0, at: 0, flights: new Map(), named: new Map(), routes: new Map(), sel: 0, selTs: 0, hexOf: new Map(), naming: new Set(), heatBusy: false, heatAgain: false, tried: new Map(), routing: new Set(), traceKey: '', matchT: 0, monAsked: new Map() };
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
    if (id === pb.sel) { pbSendTrace(id, rec.hex, pb.selTs || ts).catch(() => {}); syncPanelSoon(); }
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
    const have = pb.routes.get(id); if (have && have.hex === hex) return have;
    const k = id + ':' + hex; if (pb.routing.has(k)) return null; pb.routing.add(k);
    try {
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
      if (!s) return null;
      return pbRouteSet(id, pbRouteOf(hex, s, heli));
    } finally { pb.routing.delete(k); }
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
    postToPage('pbTrace', { id, hex, pts: rows });
    // (the other network's reports of that day, once in: the holes filled)
    const m = pbMore(hex, ts); if (m) m.then(all => { if (pb.traceKey !== key || all.length <= pts.length) return; pb.traceKey = ''; pbSendTrace(id, hex, ts).catch(() => {}); }).catch(() => {});
  }
  function onPbFollow(d) {
    const id = Number(d.id) || 0; if (!id) return;
    const first = pb.sel !== id; pb.sel = id; pb.selTs = Number(d.ts) || pb.ts; pb.at = now();
    const rec = pb.named.get(id) || (c => c && c.hex ? c : null)(store.getId(id));
    if (rec && !pb.named.has(id)) pbAdopt(id, Object.assign({}, rec), pb.selTs);
    else if (rec && first) pbSendTrace(id, rec.hex, pb.selTs).catch(() => {});
    // (its register facts - serial number, build year, country, owner - for the panel's own fields, and its pictures)
    if (rec && first) { const r = pb.named.get(id) || rec; publicIdentity(r.hex, r.reg).then(() => { pushToPage([r]); syncPanelSoon(); }).catch(() => {}); enrich(r).catch(() => {}); }
    else if (!rec && pb.flights.has(id)) pbMatchSoon(50);
    syncPanelSoon();
  }
  // the aircraft of the flight opened (FR24's own, for one it names): its track for the figures, and - FR24 having no
  // destination for it - its route as flown
  function onPbHex(d) {
    const id = Number(d.id) || 0, hex = clean(d.hex).toLowerCase(); if (!id) return;
    if (/^[0-9a-f]{6}$/.test(hex)) {
      pb.hexOf.set(id, hex); if (pb.hexOf.size > 500) pb.hexOf.delete(pb.hexOf.keys().next().value);
      if (!Number(d.d)) pbRouteFor(id, hex, Number(d.ts) || pb.selTs).then(() => pbSendTrace(id, hex, Number(d.ts) || pb.selTs)).catch(e => log('playback route', e));
      else pbSendTrace(id, hex, Number(d.ts) || pb.selTs).catch(() => {});
    }
  }
  // The panel's padlocked country of registration, serial number and age in playback, as on a live flight: FR24 answers a
  // playback panel once, before the registers have answered for an aircraft just named - so written in its cells as they
  // come (never the live airspeeds and the like: those of the moment played come from its track, 06 pbSendTrace). Only
  // into a panel showing that very aircraft; anything of ours taken out again for another.
  const PB_LOCKED = new Set(['country', 'msn', 'age']);
  function pbLocked(panel, hx) {
    const shown = panelHex(panel); if (hx && shown && hx.hex && shown !== hx.hex) hx = null;
    let vals = null;
    for (const cell of panel.querySelectorAll('[class*="col-span"]')) {
      const label = cell.firstElementChild; if (!label || label.tagName !== 'P') continue;
      const hit = LOCKED_FIELDS.find(x => x[0].test(clean(label.textContent))); if (!hit || !PB_LOCKED.has(hit[1])) continue;
      if (!cell.querySelector('.tl-filled') && !lockOf(cell)) continue;
      if (!vals) { const c = hx && hx.hex ? countryOf(hx.hex, hx.reg) : null; vals = hx ? { country: (regCountry(hx.reg) || {}).name || hx.country || (c && c.name) || '', msn: hx.msn || '', age: ageText(hx) } : {}; }
      fillLockedCell(cell, vals[hit[1]] || '', hit[1]);
    }
  }
  // The strip in playback: who it was (a flight FR24 does not name) and the flight as flown, tagged "Playback" in red -
  // never a prediction: by then it was over
  function pbStrip(panel) {
    const id = pb.sel, rec = id ? pb.named.get(id) || null : null, route = id ? pb.routes.get(id) || null : null, f = id ? pb.flights.get(id) : null;
    pbLocked(panel, rec ? withStored(rec) : (id && pb.hexOf.get(id) ? Object.assign({ hex: pb.hexOf.get(id) }, store.getHex(pb.hexOf.get(id)) || {}) : null));
    if (!rec && !route) {
      if (!f || !panelLooksBlocked(panel)) { panel.querySelectorAll('.tl-strip').forEach(e => e.remove()); return; }
      const el = strip(panel); el.dataset.state = 'playback';
      const html = rowHtml('plane', gridHtml([cellHtml('Blocked aircraft' + tagHtml('LADD', 'ladd'), pb.tried.get(id) === pbTryKey(f.ts) && !pb.naming.has(id) ? '<span class="tl-muted">not in the public ADS-B record of that moment</span>' : '<span class="tl-spin"></span> identifying from the public ADS-B record of that moment…', '', true)]));
      if (el.__tlHtml !== html) { el.innerHTML = html; el.__tlHtml = html; }
      return;
    }
    const el = strip(panel); el.dataset.state = 'playback';
    const hx = rec ? withStored(rec) : null, badge = hx ? (hx.ladd ? 'LADD' : hx.pia ? 'PIA' : hx.mil ? 'MIL' : 'ADS-B') : '';
    const idCell = hx ? cellHtml('Identified from public ADS-B' + tagHtml(badge, 'ladd'), `${esc((hx.hex || '?').toUpperCase())}`, '', true) : '';
    const tag = tagHtml('Playback', 'pb');
    const rc = !route ? gridHtml([cellHtml('Destination' + tag, '<span class="tl-spin"></span> <span class="tl-muted">reading its track of that day…</span>', '', true)])
      : gridHtml([route.destIata ? cellHtml((route.ata ? 'Landed at' : 'Destination') + tag, apHtml(route.destIata, route.destCity), route.ata ? 'landed ' + esc(hhmmZ(route.ata)) : 'its landing not heard', true) : cellHtml('Destination' + tag, '<span class="tl-muted">not in its public track</span>', '', true),
        route.originIata ? cellHtml('Departure', apHtml(route.originIata, route.originCity), route.atd ? 'took off ' + esc(hhmmZ(route.atd)) : '') : cellHtml('Departure', '<span class="tl-muted">unknown</span>', '')]);
    const links = hx ? aircraftLinks(hx) : '';
    const html = rowHtml(hx ? 'plane' : 'pin', `${idCell ? gridHtml([idCell]) + '<hr class="border border-white">' : ''}${rc}${links ? `<div class="tl-links">${links}</div>` : ''}`);
    if (el.__tlHtml !== html) { el.innerHTML = html; el.__tlHtml = html; }
  }
