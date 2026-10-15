
  // ---- FR24's map playback: the whole map at any moment of FR24's week -------------------------------------------------
  // FR24 replays its feed as it was (Feed/Playback) and the panel of a flight opened in it (Feed/PlaybackFlight); the page
  // reports the moment and the flights it shows with no callsign. Each is named as it was then - from what this script
  // already knew of that very flight (identified while it was live), else from adsb.lol's heatmap of that half hour: the
  // one aircraft heard where FR24 had it, at its height, of the type FR24 gives (M-ARNZ's PC-24 off Blackpool, 9 Oct
  // 12:35). A named flight - and an ordinary one FR24 has no destination for - gets the flight as flown, from its ADS-B
  // track of that day: where it took off and where it landed, the strip's tag "Playback" in red. The flight open in the
  // panel gets its padlocked figures from that track, moment by moment (the page reads them from it as FR24 plays).
  const pbOut = new Map();   // FR24 flight id -> a name found here in a playback, for the monitor (02 reportToMonitor)
  const pb = { ts: 0, at: 0, flights: new Map(), named: new Map(), routes: new Map(), sel: 0, selTs: 0, hexOf: new Map(), busy: false, heatAt: 0, tried: new Map(), routing: new Set(), traceKey: '', matchT: 0, monAsked: new Set() };
  function pbMode() { return /^\/\d{4}-\d\d-\d\d\/\d\d:\d\d\//.test(location.pathname); }
  const heatUrlOf = t => { const d = new Date(t * 1000); return `https://adsb.lol/globe_history/${dayStr(t * 1000)}/heatmap/${String(d.getUTCHours() * 2 + (d.getUTCMinutes() >= 30 ? 1 : 0)).padStart(2, '0')}.bin.ttf`; };
  function onPbFeed(d) {
    const ts = Number(d.ts) || 0; if (!ts) return;
    pb.ts = ts; pb.at = now();
    for (const f of d.flights || []) {
      if (!fin(f.lat) || !fin(f.lon) || f.type === 'GRND' || f.icon === 25) continue;
      pb.flights.set(f.id, Object.assign({}, f, { ts }));
      if (!pb.named.has(f.id)) { const c = store.getId(f.id); if (c && c.hex) pbAdopt(f.id, Object.assign({}, c), ts); }
    }
    if (pb.flights.size > 3000) for (const k of [...pb.flights.keys()].slice(0, 1000)) pb.flights.delete(k);
    // (the monitor names the whole moment in one answer: asked as soon as the frame is in; without it, the heatmap's
    // wait as before)
    pbMatchSoon(monUp() ? 100 : 1500);
  }
  function pbMatchSoon(ms) { if (!pb.matchT) pb.matchT = setTimeout(() => { pb.matchT = 0; pbMatch().catch(e => log('playback match', e)); }, ms); }
  // a flight named: the page labels it as FR24 would, and its route as flown follows
  function pbAdopt(id, rec, ts) {
    rec.id = id; pb.named.set(id, rec); pushToPage([rec]);
    if (rec.hex) pbRouteFor(id, rec.hex, ts).catch(e => log('playback route', e));
    if (id === pb.sel) { pbSendTrace(id, rec.hex, pb.selTs || ts).catch(() => {}); syncPanelSoon(); }
  }
  // Every unnamed flight of the moment against adsb.lol's heatmap of its half hour, in one pass. A file is read at most
  // every two minutes (one is ~25 MB) - at once for the flight opened in the panel - and each flight tried once a file.
  // The monitor first (22.23, /pbmatch): every FR24 flight it named while it was live, and every other from the tracks it
  // keeps of the blocked aircraft (90 days) - the whole map's unnamed flights in one request, named at once, each with its
  // flight as the monitor logged it. An older monitor: the names it gave live only (/names).
  async function pbFromMonitor(ts) {
    if (!monUp()) return 0;
    const fl = [...pb.flights.values()].filter(f => f.ts === ts && !pb.named.has(f.id) && !pb.monAsked.has(f.id)).slice(0, 1500);
    if (!fl.length) return 0;
    for (const f of fl) pb.monAsked.add(f.id);
    if (pb.monAsked.size > 20000) pb.monAsked.clear();
    const forget = e => { for (const f of fl) pb.monAsked.delete(f.id); log('playback names', String(e && e.message || e)); return null; };
    let j = null;
    if (!pb.monOld) j = await monPost('/pbmatch', { t: Math.round(ts), f: fl.map(f => [f.id, Math.round(f.lat * 1e4) / 1e4, Math.round(f.lon * 1e4) / 1e4, fin(f.alt) ? Math.round(f.alt) : 0, String(f.type || ''), f.gnd ? 1 : 0]) }).catch(e => { if (/HTTP 404/.test(String(e && e.message || e))) { pb.monOld = true; return null; } return forget(e); });
    if (pb.monOld) j = await monGet('/names?ids=' + fl.slice(0, 400).map(f => f.id).join(',') + '&t=' + Math.round(ts), { timeout: 10000 }).catch(forget);
    let n = 0;
    for (const r of (j && Array.isArray(j.list) ? j.list : [])) {
      const [id, hex, reg, type, cs, flags, how, leg] = r;
      if (!pb.flights.has(id) || pb.named.has(id) || !/^[0-9a-f]{6}$/.test(String(hex || ''))) continue;
      const hx = store.getHex(hex) || {}, rec = { hex, cs: /^[A-Z0-9]{2,8}$/.test(String(cs || '')) ? cs : '', reg: reg || hx.reg || hexNNumber(hex), type: String(type || hx.type || '').toUpperCase(), desc: hx.desc || '', ladd: !!(flags & 1 || hx.ladd), mil: !!(flags & 2 || hx.mil), pia: !!(flags & 4 || hx.pia), src: how === 'track' ? 'monitor (its track)' : 'monitor (named live)', matchedAt: now() };
      store.mergeHex(hex, { reg: rec.reg, type: rec.type, ladd: rec.ladd || undefined, pia: rec.pia || undefined, mil: rec.mil || undefined });
      store.setId(id, Object.assign({ id }, rec));
      if (leg && typeof leg === 'object') pbRouteFromLeg(id, hex, leg);
      pbAdopt(id, rec, ts); n++;
      // (named from its track: kept on the monitor with that day, as a browser's playback name is - checked there)
      if (how === 'track') { pbOut.set(id, [id, hex, rec.reg, rec.type, rec.cs, (rec.ladd ? 1 : 0) | (rec.mil ? 2 : 0) | (rec.pia ? 4 : 0), Math.round(ts)]); if (pbOut.size > 2000) pbOut.delete(pbOut.keys().next().value); }
      if (id === pb.sel) publicIdentity(hex, rec.reg).then(() => { pushToPage([rec]); syncPanelSoon(); }).catch(() => {});
    }
    if (n) log('playback: named from the monitor', n, 'of', fl.length);
    return n;
  }
  async function pbMatch() {
    if (pb.busy || !pb.ts) return;
    const ts = pb.ts, url = heatUrlOf(ts);
    await pbFromMonitor(ts).catch(e => log('playback names', e));
    if (pb.ts !== ts) { pbMatchSoon(500); return; }
    const list = [...pb.flights.values()].filter(f => f.ts === ts && !pb.named.has(f.id) && pb.tried.get(f.id) !== url && f.src !== 4 && (f.gnd || f.spd > 40 || f.alt > 1500));
    if (!list.length) return;
    const selWaiting = list.some(f => f.id === pb.sel);
    if (heat.url !== url && now() - pb.heatAt < 2 * 60000 && !selWaiting) { pbMatchSoon(30000); return; }
    pb.busy = true;
    try {
      if (heat.url !== url) { pb.heatAt = now(); try { heat.buf = await gmBinary(url, 180000); heat.url = url; } catch (e) { log('playback heatmap', String(e)); return; } }
      await idleSlice();
      const res = ENGINE.heatMatch(heat.buf, ts, list.map(f => ({ lat: f.lat, lon: f.lon, trk: f.trk, gs: f.spd, alt: f.alt, gnd: !!f.gnd, r: f.gnd ? 0.3 : 3 })));
      const count = new Map(); res.forEach(h => { if (h) count.set(h, (count.get(h) || 0) + 1); });
      for (let i = 0; i < list.length; i++) {
        const f = list[i], hex = res[i]; pb.tried.set(f.id, url);
        if (!hex || count.get(hex) > 1 || [...pb.named.values()].some(r => r.hex === hex && r.id !== f.id && Math.abs((pb.flights.get(r.id) || {}).ts - ts) < 600)) continue;   // (one aircraft, one flight)
        // its own track of that day: who it is (adsb.lol's database), its callsign then - and the type agreeing with FR24's
        const pts = await pbPoints(hex, ts), tm = traceMeta.get(hex) || {}, hx = store.getHex(hex) || {};
        const type = clean(tm.t || hx.type).toUpperCase();
        if (f.type && type && typeRelation(type, f.type) === 'different') { log('playback match: types differ', f.id.toString(16), hex, type, f.type); continue; }
        let cs = ''; { let best = 1e9; for (const p of pts) { const dt = Math.abs(p.t - ts); if (dt < best && p.cs) { best = dt; cs = p.cs; } if (p.t > ts + 3600) break; } }
        const rec = { hex, cs: /^[A-Z0-9]{2,8}$/.test(cs) ? cs : '', reg: tm.r || hx.reg || hexNNumber(hex), type: type || clean(f.type).toUpperCase(), desc: tm.desc || hx.desc || '', ladd: !!(tm.flags & 8 || hx.ladd), pia: !!(tm.flags & 4 || hx.pia), mil: !!(tm.flags & 1 || hx.mil), src: 'adsb.lol (playback)', matchedAt: now() };
        store.mergeHex(hex, { reg: rec.reg, type: rec.type, ladd: rec.ladd || undefined, pia: rec.pia || undefined, mil: rec.mil || undefined });
        store.setId(f.id, Object.assign({ id: f.id }, rec));
        log('playback: named', f.id.toString(16), hex, rec.reg, 'at', new Date(ts * 1000).toISOString().slice(11, 16));
        pbAdopt(f.id, rec, ts);
        // (and to the monitor: kept there for good with the day of the flight - any later playback of it, anyone's, named)
        pbOut.set(f.id, [f.id, hex, rec.reg, rec.type, rec.cs, (rec.ladd ? 1 : 0) | (rec.mil ? 2 : 0) | (rec.pia ? 4 : 0), Math.round(ts)]); if (pbOut.size > 2000) pbOut.delete(pbOut.keys().next().value);
        if (f.id === pb.sel) publicIdentity(hex, rec.reg).then(() => { pushToPage([rec]); syncPanelSoon(); }).catch(() => {});
      }
    } finally { pb.busy = false; }
    if ([...pb.flights.values()].some(f => f.ts === pb.ts && !pb.named.has(f.id) && pb.tried.get(f.id) !== heatUrlOf(pb.ts))) pbMatchSoon(5000);
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
  // the open flight's track, for its padlocked figures as FR24 plays it: the flight's span, every report
  async function pbSendTrace(id, hex, ts) {
    if (!hex || !ts) return;
    const key = id + '|' + hex + '|' + dayStr(ts * 1000); if (pb.traceKey === key) return; pb.traceKey = key;
    const pts = await pbPoints(hex, ts), r = pb.routes.get(id);
    const lo = (r ? r.t0 : ts - 3 * 3600) - 600, hi = (r ? r.t1 : ts + 3 * 3600) + 600, nz = v => fin(v) ? Math.round(v) : null;
    // (and the airspace it was in - FIR / UIR by position and height - worked out once a minute along the way)
    let firT = -1e9, fir = null;
    const rows = pts.filter(p => p.t >= lo && p.t <= hi).map(p => { if (p.t - firT >= 60) { firT = p.t; fir = firInfo(p.lat, p.lon, p.gnd0 ? 0 : p.alt); } return [Math.round(p.t), nz(p.alt), nz(p.altGeom), nz(p.vr), nz(p.ias), nz(p.tas), p.sq || '', nz(p.wd), nz(p.ws), p.own === false ? 0 : 1, fir ? fir.name : '', fir ? fir.code : '']; });
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
  // The strip in playback: who it was (a flight FR24 does not name) and the flight as flown, tagged "Playback" in red -
  // never a prediction: by then it was over
  function pbStrip(panel) {
    const id = pb.sel, rec = id ? pb.named.get(id) || null : null, route = id ? pb.routes.get(id) || null : null, f = id ? pb.flights.get(id) : null;
    if (!rec && !route) {
      if (!f || !panelLooksBlocked(panel)) { panel.querySelectorAll('.tl-strip').forEach(e => e.remove()); return; }
      const el = strip(panel); el.dataset.state = 'playback';
      const html = rowHtml('plane', gridHtml([cellHtml('Blocked aircraft' + tagHtml('LADD', 'ladd'), pb.tried.get(id) === heatUrlOf(f.ts) ? '<span class="tl-muted">not in the public ADS-B record of that moment</span>' : '<span class="tl-spin"></span> identifying from the public ADS-B record of that moment…', '', true)]));
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
