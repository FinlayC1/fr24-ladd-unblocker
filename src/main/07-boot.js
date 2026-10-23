
  // ---- bridge messages -----------------------------------------------------------------------------------------
  function noteGroundState(id, f, t) {
    // landing detection for every tracked flight: airborne earlier in this flight id, on the ground now
    let st = routeState.get(id);
    if (fin(f.alt) && !f.gnd) { if (!st && f.alt > 1500) { st = { hex: '', working: false, maxAlt: 0, landedAt: 0 }; routeState.set(id, st); } if (st && f.alt > st.maxAlt) st.maxAlt = f.alt; }
    if (f.gnd && st && st.maxAlt > 1500 && !st.landedAt) { st.landedAt = Math.round(t / 1000); log('landed', id.toString(16)); const rec = live.get(id); if (rec && rec.hex) publishRoute(id, composeRoute(id, rec.hex)); }
  }
  function noteFeedTrail(f, t) {
    const a = feedTrail.get(f.id) || [];
    const p = { t: Math.floor(t / 1000), lat: f.lat, lon: f.lon, alt: f.alt, gs: f.spd, trk: f.trk, gnd: !!f.gnd };
    const last = a[a.length - 1];
    if (!last || p.t - last.t >= 20) { a.push(p); if (a.length > 90) a.shift(); feedTrail.set(f.id, a); }
  }
  function onFeed(d) {
    const t = now();
    if (d.named && d.named.length) noteFr24Named(d.named);
    if (d.na && d.na.length) noteNa(d.na, d.at || t);
    let fresh = 0; const cachedHits = [];
    for (const f of d.flights || []) {
      if (!fin(f.lat) || !fin(f.lon) || fr24Named.has(f.id)) continue;
      const prev = pending.get(f.id);
      pending.set(f.id, Object.assign({}, f, { receivedAt: d.at || t, serverTime: d.serverTime || 0, type: f.type || (prev && prev.type) || '', reg: f.reg || (prev && prev.reg) || '', bg: d.bg ? (prev ? !!prev.bg : true) : false }));
      noteGroundState(f.id, f, d.at || t);
      noteFeedTrail(f, d.at || t);
      if (live.has(f.id)) { noteSeen(live.get(f.id), f, d.at || t); continue; }
      const c = store.getId(f.id);
      if (c && c.hex) { hydrate(c); noteSeen(c, f, d.at || t); live.set(f.id, c); cachedHits.push(c); continue; }
      // (named by the monitor: in view, a full identification at once; a world-scan find stays light - the page has its name)
      if (srvIds.rows.has(f.id)) { if (!d.bg) srvAdopt(f.id); continue; }
      if (d.bg) { bgMatchQ.add(f.id); continue; }       // (world scan finds: matched in idle slices)
      if (!skipFlight(f) && matchAgainstList(pending.get(f.id))) continue;
      if (!prev) fresh++;
    }
    if (bgMatchQ.size) drainBgMatches().catch(e => log('scan matching', e));
    if (cachedHits.length) {
      pushToPage(cachedHits); syncPanelSoon();
      const rl = cachedHits.filter(c => c.route && (c.route.originId || c.route.destId)).map(c => ({ id: c.id, route: routeForPage(c.route) }));
      if (rl.length) postToPage('routes', { list: rl });
    }
    for (const [id, f] of pending) if (t - f.receivedAt > (f.bg ? 15 * 60000 : PENDING_TTL_MS)) { pending.delete(id); attempts.delete(id); strikes.delete(id); if (!live.has(id)) feedTrail.delete(id); }
    if (d.bg) return;
    if (d.flights && d.flights.length) { let la = 0, lo = 0; for (const f of d.flights) { la += f.lat; lo += f.lon; } viewCenter = { lat: la / d.flights.length, lon: lo / d.flights.length }; }
    const sel = currentId();
    if (sel != null && pending.has(sel) && !live.has(sel)) resolveTargeted(sel, 'feed').catch(e => log(e));
    if (fresh || clusterUnresolved().length) scheduleSweep(fresh ? 350 : SWEEP_INTERVAL_MS);
  }
  const posStats = { n: 0 };
  function onPos(d) {
    const id = Number(d.id) || null; if (!id || !fin(d.lat)) return;
    if (!d.panel) posStats.n++;
    const h = posHistory.get(id) || []; h.push({ lat: d.lat, lon: d.lon, alt: d.alt, trk: d.trk, spd: d.spd, gnd: !!d.gnd, at: d.at || now(), panel: !!d.panel }); if (h.length > 60) h.shift(); posHistory.set(id, h);
    const f = pending.get(id);
    const wasGnd = f && f.gnd;
    if (f) Object.assign(f, { lat: d.lat, lon: d.lon, alt: d.alt, trk: d.trk, spd: d.spd, gnd: !!d.gnd, receivedAt: d.at || now(), ts: d.tsMs ? d.tsMs / 1000 : f.ts, serverTime: d.serverMs || f.serverTime });
    noteGroundState(id, { alt: d.alt, gnd: isHeliId(id) ? !!d.gnd && !(d.spd > 5) : !!d.gnd || (fin(d.alt) && d.alt < 50 && d.spd < 50) }, d.at || now());
    const rec = live.get(id) || pubRouted(id), cur = shownId != null && shownId !== id && pubRouted(shownId) ? shownId : currentId();
    if (id === cur && rec && rec.hex) { const st = routeState.get(id); if (!st || !st.route || wasGnd !== !!d.gnd || now() - st.route.computedAt > 15000) scheduleReplan(id); }
    else if (cur != null && cur !== id) { const cr = live.get(cur) || pubRouted(cur); if (cr && cr.hex && cr.hex === hexOfId(id)) { const st = routeState.get(cur); if (!st || !st.route || now() - st.route.computedAt > 15000 || !!d.gnd !== !!(st.route && st.route.onGround)) scheduleReplan(cur, 300); } }
  }
  function onFollow(d) {
    // Posted synchronously from XMLHttpRequest.send(), i.e. before the first stream frame (~80 ms later) arrives - so
    // identity, telemetry and a route pushed here are in place for the panel's very first render.
    const id = Number(d.id) || null;
    if (id && id !== selectedId) { selectedId = id; selectedAt = now(); telemLast = 0; syncPanelSoon(); }
    if (id && !live.has(id) && !fr24Named.has(id)) { const c = store.getId(id); if (c && c.hex) live.set(id, hydrate(c)); }
    if (id && !live.has(id)) srvAdopt(id);       // (named by the monitor)
    if (id && !live.has(id)) pubPrime(id);   // an ordinary flight reopened: its reasoned route, before the first frame
    if (id && live.has(id)) {
      const rec = live.get(id);
      // (its latest public data: the LADD list, or whatever was seen of it lately - restored from before a refresh too)
      const g = rec.hex && (globalList.byHex.get(rec.hex) || areaCache.get(rec.hex)); if (g && !telemetry.get(id) && now() - seenAt(g) < 150000) telemetry.set(id, telemOf(g));
      pushToPage([rec]); pushTelemetry(id);
      if (airportsReady() && rec.hex) { const r = composeRoute(id, rec.hex); if (r) publishRoute(id, r); }
      else if (rec.route && (rec.route.originId || rec.route.destId)) postToPage('route', { id, route: routeForPage(rec.route) });
      routeFor(rec).catch(e => log('route failed', e)); enrich(rec).catch(() => {});
      pollTelemetry().catch(() => {});
    } else if (id && pending.has(id)) resolveTargeted(id, 'follow').catch(e => log(e));
  }
  function onTrail(d) {
    const id = Number(d.id) || null; if (!id || !d.first) return;
    const prev = fr24Trail.get(id);
    // keep the longest trail seen for this flight (FR24 may send a shorter one on stream restarts)
    if (!prev || (d.pts || []).length >= (prev.pts || []).length || d.first.t < prev.first.t) fr24Trail.set(id, { first: d.first, pts: d.pts || [], maxAlt: Math.max(d.maxAlt || 0, prev ? prev.maxAlt : 0), at: d.at || now() });
    const st = routeState.get(id); if (st && d.maxAlt > (st.maxAlt || 0)) st.maxAlt = d.maxAlt;
    if (live.get(id) || pubRouted(id)) scheduleReplan(id, 100);
    if (naWanted.has(id)) naWantedTick();
  }
  function onBoardSeen(d) {
    // an airport board just listed these flights: make sure their photos and a proper route are ready before a click
    for (const id of (d.ids || []).slice(0, 40)) {
      const rec = live.get(Number(id)); if (!rec || !rec.hex) continue;
      boardSeenAt.set(Number(id), now());
      enrich(rec).catch(() => {});
      const td = todayCache.get(rec.hex); if (!td || now() - td.at > 600000) routeFor(rec, true, { board: true }).catch(() => {});
    }
  }
  // (a message from this very page - the interceptor's: Tampermonkey hands the script a wrapped window, so the source of
  // the page's own events is the page's window object rather than the script's - compared with both; Tweeks gives the
  // window itself)
  const fromThisPage = src => !!src && (src === window || src === pageWindow() || (() => { try { return src.self === pageWindow().self; } catch (_) { return false; } })());
  window.addEventListener('message', ev => {
    if (!fromThisPage(ev.source) || !ev.data || typeof ev.data !== 'object') return;
    const d = ev.data;
    if (typeof d.__tweeksLadd === 'string') msgCount[d.__tweeksLadd] = (msgCount[d.__tweeksLadd] || 0) + 1;
    switch (d.__tweeksLadd) {
      case 'feed': onFeed(d); break;
      case 'pos': onPos(d); break;
      case 'follow': onFollow(d); break;
      case 'trail': onTrail(d); break;
      case 'photos': onPagePhotos(d); break;
      case 'needPhotos': onNeedPhotos(d); break;
      case 'needHist': onNeedHist(d.reg).catch(e => { log('needHist', e); postToPage('hist', { reg: d.reg, data: null }); }); break;
      case 'boardSeen': onBoardSeen(d); break;
      case 'needBoard': onNeedBoard(d).catch(e => log('board archive', e)); break;
      case 'boardRows': onBoardRows(d); break;
      case 'needRoutes': onNeedRoutes(d).catch(e => log('routes page', e)); break;
      case 'needAirportData': onNeedAirportData(d).catch(e => log('airport page', e)); break;
      case 'needAirportPanel': onNeedAirportPanel(d).catch(e => log('airport panel', e)); break;
      case 'pbFeed': onPbFeed(d); break;
      case 'pbFollow': onPbFollow(d); break;
      case 'pbHex': onPbHex(d); break;
      case 'pbWhere': onPbWhere(d).catch(e => { log('playback where', e); postToPage('pbWhereRes', { rid: d.rid }); }); break;
      case 'searchRows': onSearchRows(d); break;
      case 'needNaRoutes': onNeedNaRoutes(d); break;
      case 'needSearch': onNeedSearch(d).catch(e => { log('search', e); postToPage('searchAdd', { rid: d.rid, rows: [] }); }); break;
      case 'needPub': publicIdentity(d.hex, d.reg).then(() => pushPubIds([String(d.hex || '').toLowerCase()])).catch(() => {}); break;
      case 'osmRes': onOsmRes(d); break;
      case 'aircraftInfo': onAircraftInfo(d); break;
      case 'sched': onSched(d); break;
      case 'airAsk': onAirAsk(d).catch(e => log('airspace', e)); break;
      case 'feedReady': noteFeedHdr(d.hdr); if (!feedReady) { feedReady = true; log('feed headers captured'); worldScan('startup').catch(() => {}); } break;
      case 'scanDone': onScanDone(d); break;
      case 'view': { const first = !viewBox; onView(d); if (first) pollView().catch(() => {}); break; }
      case 'stats': bridgeStats = d.stats || bridgeStats; break;
      case 'ready': {
        if (!bridgeReady) log('bridge ready', d.v || '(no version)');
        bridgeV = d.v || '?'; if (bridgeV !== VERSION) log('page bridge is another version:', bridgeV);
        bridgeReady = true; bridgeStats = d.stats || bridgeStats; noteFeedHdr(d.hdr); if (d.feedReady && !feedReady) { feedReady = true; worldScan('startup').catch(() => {}); }
        // everything known right now - the last session's snapshot included - at once, so the map, a flight opened
        // straight from the URL, boards and search are patched from FR24's very first answer; the rest of the store
        // (flight ids of the last 12 hours) once it has been read
        if (isDataPage || isAircraftPage || isFlightPage) break;
        pushKnown(false);
        if (srvIds.rows.size) srvPush([...srvIds.rows.values()]);     // (the monitor's names, before FR24's first answer)
        if (bootArea.length) { pushPubTel(bootArea.filter(c => now() - seenAt(c) < 90000)); bootArea = []; }
        store.ready.then(() => { pushKnown(true); return pushAllPubIds(); }).catch(e => log('pubIds', e));
        store.kvReady.then(pushSites).catch(() => {});          // (the landing places learned, for FR24's airport list)
        break;
      }
      default: break;
    }
  });
  function pushKnown(all) {
    const known = new Map(live);
    if (all) for (const c of store.allIds()) if (!known.has(c.id)) known.set(c.id, c);
    if (!known.size && !pubLoaded) return;
    pushToPage([...known.values()]);
    const rl = [];
    for (const c of known.values()) { const r = (routeState.get(c.id) || {}).route || c.route; if (r && (r.originId || r.destId || r.groundAirportId)) rl.push({ id: c.id, route: routeForPage(r) }); }
    for (const x of pubRoutesForPage(6 * 3600e3)) rl.push(x);   // ordinary flights' reasoned routes (last hours)
    if (rl.length) postToPage('routes', { list: rl });
  }

  // ---- instant start: the last session, from the snapshot ---------------------------------------------------------------
  let bootArea = [];
  function restoreBoot() {
    const b = store.boot(); if (!b) return [];
    if (Array.isArray(b.area)) { bootArea = b.area.filter(c => c && c.hex && fin(c.lat) && now() - seenAt(c) < 150000); noteCands(bootArea); }
    const hexes = [];
    for (const f of b.flights || []) {
      if (!f || f.id == null || !f.hex || live.has(Number(f.id))) continue;
      const rec = Object.assign({}, f, { id: Number(f.id) });
      live.set(rec.id, rec);
      if (rec.maxAlt || rec.landedAt) routeState.set(rec.id, { hex: rec.hex, working: false, maxAlt: rec.maxAlt || 0, landedAt: rec.landedAt || 0 });
      if (rec.route) bootHold.add(rec.hex);
      hexes.push(rec.hex);
    }
    return hexes;
  }
  const SNAP_MAX = 600000;    // characters (~1.2 MB): localStorage is ~5 MB per site and FR24 keeps its own settings there too
  const FLIGHT_KEYS = ['hex', 'cs', 'reg', 'type', 'fr24Type', 'aggType', 'desc', 'cat', 'mil', 'ladd', 'pia', 'owner', 'ownerCity', 'msn', 'year', 'operatorId', 'operatorIcao', 'operatorName', 'fr24Equip', 'countryId', 'country', 'countryIso', 'squawk', 'src', 'matchedAt', 'verifiedAt', 'origin', 'faaAt', 'fr24At', 'pubAt', 'photoAt', 'photoLevel', 'photoV', 'regTried'];
  const AREA_KEYS = ['hex', 'cs', 'reg', 'type', 'desc', 'owner', 'year', 'lat', 'lon', 'alt', 'gnd', 'gs', 'trk', 'ageS', 'receivedAt', 'dbFlags', 'ladd', 'pia', 'mil', 'src', 'cat', 'sq', 'squawk', 'emergency', 'vs', 'agps', 'ias', 'tas', 'mach', 'oat', 'wd', 'ws', 'mcp', 'fms'];
  const HEX_KEYS = ['reg', 'type', 'desc', 'owner', 'ownerCity', 'msn', 'year', 'operatorId', 'operatorIcao', 'operatorName', 'fr24Equip', 'countryId', 'country', 'cat', 'mil', 'ladd', 'pia', 'photoAt', 'photoLevel', 'photoV', 'faaAt', 'fr24At', 'idAt', 'ownerAskedAt', 'ownerFailAt', 'pubAt', 'pubFull', 'savedAt'];
  const pick = (src, keys, out) => { for (const k of keys) { const v = src[k]; if (v != null && v !== '' && v !== 0 && v !== false) out[k] = v; } return out; };
  function buildSnapshot() {
    const t = now(), vc = viewCenter, cands = [];
    for (const [id, rec] of live) {
      if (!rec || !rec.hex || id < 0) continue;
      const f = pending.get(id);
      const lp = f && fin(f.lat) ? { lat: f.lat, lon: f.lon, alt: f.alt, gnd: !!f.gnd, at: f.receivedAt || t } : rec.lastPos;
      const st = routeState.get(id) || {}, r = st.route || rec.route;
      const recent = lp && t - lp.at < 2 * 3600e3, landed = r && r.landed && nowS() - (r.ata || 0) < 3 * 3600;
      if (!recent && !landed) continue;
      cands.push({ rec, lp, r, st, d: vc && lp ? dist(lp.lat, lp.lon, vc.lat, vc.lon) : 1e5 });
    }
    cands.sort((a, b) => a.d - b.d);   // what is on screen first: if the snapshot has to be trimmed, the far side goes
    const out = { flights: [], hex: {} };
    let size = 0;
    for (const { rec, lp, r, st } of cands) {
      const e = pick(rec, FLIGHT_KEYS, { id: rec.id, savedAt: t });
      if (lp) e.lastPos = lp;
      if (r) e.route = Object.assign({}, r, { progress: null });
      if (st.maxAlt) e.maxAlt = st.maxAlt; if (st.landedAt) e.landedAt = st.landedAt;
      if (rec.photos && rec.photos.length) e.photos = rec.photos.slice(0, 3);
      if (rec.injected && rec.injected.length) e.injected = rec.injected.slice(-12);
      const hx = !out.hex[rec.hex] && store.getHex(rec.hex);
      const he = hx ? pick(hx, HEX_KEYS, { hex: rec.hex, slim: true }) : null;
      if (he && hx.photos && hx.photos.length) he.photos = hx.photos.slice(0, 3);
      if (he && hx.recent && hx.recent.length) he.recent = hx.recent.slice(-30);
      const add = JSON.stringify(e).length + (he ? JSON.stringify(he).length : 0);
      if (size + add > SNAP_MAX) break;
      size += add; out.flights.push(e); if (he) out.hex[rec.hex] = he;
    }
    // the live public data of the aircraft around the map (last two minutes): a refresh shows their padlocked fields at
    // once instead of after the first new poll
    { const vc2 = viewCenter, keep = []; for (const c of areaCache.values()) if (c && fin(c.lat) && now() - seenAt(c) < 120000) keep.push(c);
      if (vc2) keep.sort((a, b) => dist(a.lat, a.lon, vc2.lat, vc2.lon) - dist(b.lat, b.lon, vc2.lat, vc2.lon));
      out.area = keep.slice(0, 400).map(c => { const o = {}; for (const k of AREA_KEYS) { const v = c[k]; if (v != null && v !== '' && !(typeof v === 'number' && !isFinite(v))) o[k] = v; } return o; }); }
    // what another FR24 tab (or this page before a reload) saved and this one has not seen: kept, not overwritten
    const prev = store.readBoot();
    if (prev) {
      const mine = new Set(out.flights.map(e => Number(e.id)));
      for (const e of prev.flights || []) {
        if (!e || e.id == null || mine.has(Number(e.id)) || live.has(Number(e.id)) || revokedIds.has(Number(e.id))) continue;
        const at = (e.lastPos && e.lastPos.at) || 0, landed = e.route && e.route.landed && nowS() - (e.route.ata || 0) < 3 * 3600;
        if (t - at > 2 * 3600e3 && !landed) continue;
        const he = !out.hex[e.hex] && prev.hex && prev.hex[e.hex];
        const add = JSON.stringify(e).length + (he ? JSON.stringify(he).length : 0);
        if (size + add > SNAP_MAX) break;
        size += add; out.flights.push(e); if (he) out.hex[e.hex] = he;
      }
    }
    return out;
  }
  function saveSnapshot() { try { store.saveBoot(buildSnapshot()); } catch (e) { log('snapshot', e); } }

  // ---- install the interceptor into the page's main world -----------------------------------------------------
  function installBridge() {
    // (the browser extension: its manifest put the page part in the page's own world at document start - it only has to
    // be greeted, and greeted again until it answers)
    if (typeof TL_EXTENSION === 'boolean') {
      postToPage('hello');
      const again = n => setTimeout(() => { if (!bridgeReady && n < 20) { postToPage('hello'); again(n + 1); } }, 250);
      again(0);
      return;
    }
    const src = '(' + pageInterceptor.toString() + ')();';
    const pw = pageWindow();
    try { if (pw.__tweeksLaddBridge) { pw.__tweeksLaddBridge.hello(); return; } } catch (_) { /* ignore */ }
    try {
      const s = document.createElement('script');
      s.textContent = src + '\n//# sourceURL=tweeks-ladd-bridge.js';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) { log('script injection failed', e); }
    setTimeout(() => {
      if (bridgeReady) return;
      try { if (pw !== window && typeof pw.eval === 'function') pw.eval(src); } catch (e) { log('unsafeWindow eval failed', e); }
      postToPage('hello');
      setTimeout(() => { if (!bridgeReady) { try { pageInterceptor(); } catch (e) { log('direct install failed', e); } postToPage('hello'); } }, 1500);
    }, 800);
  }

  // ---- boot -----------------------------------------------------------------------------------------------------
  // (LADD Unblock switched off in its window: only its button and window, to switch it back on - nothing else runs)
  if (opt.on) bootAll(); else log('switched off in the LADD Unblock window');
  startUnblockWindow();
  function bootAll() {
  if (opt.noAds) addAdStyle();
  // (the population tables unpack once FR24 has drawn the page - a few hundred ms of work that must not hold up its own
  // start - and the routes on screen are worked out again with them)
  if (!isDataPage && !isFlightPage) {
    setTimeout(() => loadT2().then(ok => { if (ok && typeof quickRouteAll === 'function') quickRouteAll(); }), 900);
    setTimeout(() => { idleSlice().then(() => loadAgeTable()).then(() => loadApprTable()).catch(() => {}); }, 1500);   // (build years by serial number: AGE; arrival paths)
  }
  // (log and flight-number pages: the page bridge too - FR24's search box there lists what this script knows)
  if (isAircraftPage) {
    installBridge();
    if (opt.acPages) bootAircraftPage().catch(e => log('aircraft page', e));
  } else if (isFlightPage) {
    installBridge();
    if (opt.acPages) bootFlightPage().catch(e => log('flight page', e));
  } else if (isDataPage) {
    // FR24's airport pages - general, boards, routes, statistics: only the bridge for their lists and what they ask for (the
    // airports, airlines, kept boards) - none of the map's work, so what they show is there at once
    installBridge();
    const startData = () => { addStyle(); loadAirports().catch(e => log('airports', e)); setTimeout(() => { fr24.loadAirlines().catch(() => {}); fr24.loadCountries().catch(() => {}); }, 200); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startData, { once: true }); else startData();
  } else {
    // the last session first (synchronous), then the page bridge - whose first 'ready' pushes all of it to the page
    const bootHexes = restoreBoot();
    if (bootHexes.length) log('restored', bootHexes.length, 'flights from the snapshot (' + store.mode() + ')');
    installBridge();
    // stored routes stand until each aircraft's history summary and today's track are back from disk (a few ms), then
    // everything is recomputed from the same inputs as before the refresh plus whatever is new
    const releaseBoot = () => { const sel = currentId(), selHex = sel != null && live.get(sel) ? live.get(sel).hex : ''; for (const h of [...bootHold]) if (h !== selHex || routeState.get(sel) === undefined) bootHold.delete(h); quickRouteAll(); };
    store.kvReady.then(() => warmToday(bootHexes)).then(() => loadAirports()).then(releaseBoot).catch(e => { log('boot', e); releaseBoot(); });
    setTimeout(() => { bootHold.clear(); quickRouteAll(); }, 8000);   // whatever happens, nothing stays frozen
    const start = () => {
      addStyle(); syncPanel(); setInterval(syncPanel, 400); watchForTags();
      loadAirports().then(() => quickRouteAll()).catch(e => log('airports', e));
      Promise.all([store.kvReady, loadAirports()]).then(() => { applyLearned(); quickRouteAll(); }).catch(e => log('learned', e));
      store.kvReady.then(() => loadFir()).catch(() => {});
      loadAirports().then(() => loadSites()).catch(() => {});                // (the unlisted airfields, for the route engine)
      store.kvReady.then(() => loadRunways()).then(ok => { if (ok) quickRouteAll(); }).catch(() => {});
      setInterval(() => { if (clusterUnresolved().length) scheduleSweep(200); }, SWEEP_INTERVAL_MS * 2);
      refreshLists(true).catch(() => {});
      setInterval(() => { refreshLists().then(() => verifyAgainstList()).catch(() => {}); }, LIST_REFRESH_MS);
      setInterval(() => worldScan('periodic').catch(() => {}), WORLD_SCAN_INTERVAL_MS);
      setInterval(() => { precomputeRoutes().catch(e => log('precompute', e)); }, 4000);
      setInterval(quickRouteAll, 3000);
      setInterval(() => { historyPump().catch(e => log('history pump', e)); }, 1500);
      setInterval(() => { pollTelemetry().catch(() => {}); }, 1000);
      setInterval(() => { pollView().catch(() => {}); }, 5000);
      setInterval(() => { pollWatch().catch(e => log('watch', e)); }, 60000); setTimeout(() => pollWatch(true).catch(() => {}), 8000);
      setInterval(checkHealth, 30000);
      setTimeout(() => fr24.loadCountries().catch(() => {}), 300);
      setTimeout(() => fr24.loadAirlines().catch(() => {}), 600);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && now() - lastScanAt > WORLD_SCAN_INTERVAL_MS) worldScan('visible').catch(() => {}); });
      // the snapshot for the next page load: every 15 s, and whenever the page is left, hidden or refreshed
      setInterval(() => { if (!document.hidden) idleSlice(12).then(() => saveSnapshot()); }, 15000);
      setTimeout(saveSnapshot, 6000);
      window.addEventListener('pagehide', () => { saveSnapshot(); store.flushNow(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) { saveSnapshot(); store.flushNow(); } });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
  }
  try { (pageWindow()).__tweeksLadd = { version: VERSION, msgCount, datalinkPlan, datalinkRoutes, surgeNow, morphHtml, photoJob, photosOut, monPhotos, routeSearch, onNeedNaRoutes, naFromTrail, naWanted, fr24Trail, schedOf, trailFor, get shownId() { return shownId; }, posStats, get bridgeV() { return bridgeV; }, hexOfId, currentPos, idHex, engine: ENGINE, live, pending, telemetry, store, routeState, planState, globalList, fr24, todayCache, sweep, resolveTargeted, routeFor, composeRoute, centralOf, calcGot, calcSent, calcAsk, calcFlush, calcEvidence, altsOf, holdTerminal, termHold, worldScan, refreshLists, quickRouteAll, historyPump, histPumped, learnedStore, regCountry, fr24Sched, pubRouted, pubRecs, privatePlace, loadSites, siteNear, sites, onSched, pubMem: () => pubMem, publishRoute, syncPanel, normalizeReadsb, telemOf, noteCands, csOfRec, warmHist, hostStat, loadT2, wantWx, wxMap, wantNotams, closedMap, estimateEta, nNumberHex, watchList, pollWatch, accStore, accNote, statsHtml, fleetList, checkHealth, health, exportCsv, predictForHex, verifyAgainstList, strikes, revokedIds, fr24Named, noteFr24Named, loadHistory, loadToday, readTrace, classifyTrace, fetchTrace, netState, NETS, sourcesHtml, logGaps, fetchJetphotos, loadRunways, knownLegs, areaCache, pollView, saveSnapshot, boardNoteLegs, boardNoteFlight, boardNoteSched, boardScrub, boardLoad, boardList, naRouteOf, pbWhere, noteNa, naFeed, matchParked, matchByTraces, boardDrain, boardMem, onNeedBoard, operatorOf, shownOwner, enrich, userConfirm, userDestOf, loadApprTable, monGet, monPost, monCheck, monLive, monUp, MON_DEFAULTS, get monBase() { return monBase; }, liveSources, tatSource: TAT_SOURCE, telOut, noteTelOut, reportTel, pbOut, srvIds, pullSrvIds, srvAdopt, reportToMonitor, syncSrvLearn, applyLearned, srvRoute, srvRec, crowdOf, routesOut, routesSent, noteRouteOut, learnFromLeg, learnOutTake, learnOutBack, get learnOutN() { return learnOut.length; }, srvCovers, get srvLearned() { return srvLearned; }, set srvLearned(v) { srvLearned = v; }, addSrvLearned, get feedHdr() { return feedHdr; }, boardMonFill, natRowOf, fnRows, buildSnapshot, bootHold, firAt, loadFir, onAirAsk, pb, onPbFeed, onPbFollow, onPbHex, pbRouteFor, pbMatch, pbFromMonitor, onNeedRoutes, onNeedAirportData, onNeedAirportPanel, liveBoardRows, runwaysOf, parseRunwayEnds, flightsOfCallsign, bootFlightPage, unlockExports, exportFile, rowWindow, hexOfFid, onNeedSearch, osmPick, wantOsmPlace, osmPlaceAt, learnSite, siteIdAt, siteBk, siteRow, apById, operatorIdOf, airlineIdByName, fr24Cat, onHistElsewhere, get viewBox() { return viewBox; }, get selectedId() { return currentId(); }, opt, setOpt, notify, openUnblockWindow, closeUnblockWindow, ensureBarButton, findBar, checkLatest, installKind, sayHello, helloSt, ubBanners, ubOffer, installId }; } catch (_) { /* ignore */ }
  log('loaded v' + VERSION);
