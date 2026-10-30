
  // ---- tools: watchlist & alerts, prediction scorecard, the owner's fleet, flight-log CSV, health check ---------------

  // Notifications: the userscript manager's own (no page permission needed), else the browser's.
  function notify(title, text, url) {
    if (!opt.alerts) return;   // (switched off in the LADD Unblock window)
    try {
      const gmN = typeof GM_notification === 'function' ? GM_notification : (typeof GM !== 'undefined' && GM && typeof GM.notification === 'function' ? GM.notification.bind(GM) : null);
      const open = () => { try { window.focus(); if (url) location.href = url; } catch (_) { /* ignore */ } };
      if (gmN) { gmN({ title, text, silent: false, timeout: 15000, onclick: open }); return; }
      if (typeof Notification === 'function' && Notification.permission === 'granted') { const n = new Notification(title, { body: text, tag: 'tl-' + title }); n.onclick = open; }
    } catch (e) { log('notify', e); }
  }
  function askNotify() { try { const gm = typeof GM_notification === 'function' || (typeof GM !== 'undefined' && GM && typeof GM.notification === 'function'); if (!gm && typeof Notification === 'function' && Notification.permission === 'default') Notification.requestPermission(); } catch (_) { /* ignore */ } }

  // ---- the US register: an N-number's transponder address is fixed by the registration itself ----------------------
  const N_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ', N_SUF = 1 + N_CH.length * (1 + N_CH.length), N_B4 = 1 + N_CH.length + 10, N_B3 = 10 * N_B4 + N_SUF, N_B2 = 10 * N_B3 + N_SUF, N_B1 = 10 * N_B2 + N_SUF;
  function nNumberHex(reg) {
    const n = String(reg || '').toUpperCase().replace(/^N/, ''); if (!/^[1-9][0-9A-Z]{0,4}$/.test(n) || /[IO]/.test(n)) return '';
    const sufOff = s => (N_CH.length + 1) * N_CH.indexOf(s[0]) + 1 + (s.length > 1 ? N_CH.indexOf(s[1]) + 1 : 0);
    let out = 0xa00001 + (+n[0] - 1) * N_B1; const steps = [N_B2, N_B3, N_B4];
    for (let i = 1; i < n.length; i++) {
      const c = n[i];
      if (i === 4) { out += N_CH.includes(c) ? 1 + N_CH.indexOf(c) : 1 + N_CH.length + +c; break; }
      if (N_CH.includes(c)) { out += sufOff(n.slice(i, i + 2)); break; }
      out += N_SUF + +c * steps[i - 1];
    }
    return out.toString(16).padStart(6, '0');
  }
  // ... and back: the N-number of a US address (ac1d0b: N88RZ, a 2026 G500 no aircraft database had yet)
  function hexNNumber(hex) {
    let o = parseInt(hex, 16) - 0xa00001; if (!(o >= 0 && o < 9 * N_B1)) return '';
    let s = 'N' + (Math.floor(o / N_B1) + 1); o %= N_B1;
    const steps = [N_B2, N_B3, N_B4];
    for (let i = 1; i <= 4; i++) {
      if (o === 0) return s;
      if (i === 4) { o -= 1; return s + (o < N_CH.length ? N_CH[o] : String(o - N_CH.length)); }
      if (o < N_SUF) { o -= 1; const a = Math.floor(o / (N_CH.length + 1)), b = o % (N_CH.length + 1); return s + N_CH[a] + (b ? N_CH[b - 1] : ''); }
      o -= N_SUF; s += Math.floor(o / steps[i - 1]); o %= steps[i - 1];
    }
    return s;
  }

  // ---- watchlist: take-off and landing alerts for chosen aircraft, LADD ones included, wherever they are ------------
  const WATCH_MAX = 30;
  let watchL = null, watchBusy = false, watchSaveT = 0;
  const watchList = () => watchL || (watchL = store.kvGet('watch1') || {});
  const saveWatch = () => { if (!watchSaveT) watchSaveT = setTimeout(() => { watchSaveT = 0; store.kvSet('watch1', watchL); }, 1500); };
  const isWatched = hex => !!(hex && watchList()[hex]);
  const wLabel = w => w.reg || w.cs || w.hex.toUpperCase();
  function toggleWatch(rec) {
    if (!rec || !rec.hex) return;
    const l = watchList();
    if (l[rec.hex]) delete l[rec.hex];
    else {
      if (Object.keys(l).length >= WATCH_MAX) return;
      const hx = withStored(rec);
      l[rec.hex] = { hex: rec.hex, reg: hx.reg || '', cs: hx.cs || '', type: hx.type || '', added: now(), state: '', stateAt: 0, seenAt: 0 };
      askNotify();
    }
    saveWatch(); syncPanelSoon(); pollWatch(true).catch(() => {});
  }
  function watchSighting(hex) {
    let best = null; for (const c of [globalList.byHex.get(hex), areaCache.get(hex)]) if (c && fin(c.lat) && (!best || seenAt(c) > seenAt(best))) best = c;
    return best && now() - seenAt(best) < 180000 ? best : null;
  }
  // where a watched aircraft is going, a few minutes after it took off (its trace and log, even if it is not on the map)
  async function predictForHex(hex) {
    try { await loadToday(hex, 60000, { priority: true }); } catch (e) { return null; }
    const td = todayCache.get(hex); if (!td || !td.legs || !td.legs.length) return null;
    const leg = td.legs[td.legs.length - 1]; if (leg.ended) return null;
    const pts = [leg.start].concat(leg.pts), pos = pts[pts.length - 1]; if (!pos || pos.gnd || pos.gnd0) return null;
    const trail = []; for (const p of pts) if (!trail.length || p.t - trail[trail.length - 1].t >= 20) trail.push(p);
    // (1.1.0) worked out on the monitor: its candidates, the likeliest first
    const ac = acOfHex(hex), hx = store.getHex(hex) || {}, sums = td.sums ? td.sums.filter(l => l.ended) : [];
    const r = await calcNow({ id: hexCalcId(hex), hex, kind: hx.ladd || hx.fr24Blocked || hx.pia || hx.mil ? 'live' : 'pub', ac, pos: ptOut(pos), trail: { full: true, pts: trail.map(ptOut) }, today: sums, lastLeg: sums.filter(l => l.to).pop() || null });
    if (!r) return null;
    return { cands: (Array.isArray(r.cands) ? r.cands : []).map(c => ({ airport: apById(c[0]), p: (+c[1] || 0) / 100 })).filter(c => c.airport) };
  }
  async function pollWatch(force) {
    const l = watchList(), hexes = Object.keys(l); if (!hexes.length || watchBusy || !airportsReady()) return;
    watchBusy = true;
    try {
      for (const hex of hexes) {
        const w = l[hex]; if (!w) continue;
        let c = watchSighting(hex);
        if (!c && (force || now() - (w.askedAt || 0) > 120000)) {
          w.askedAt = now();
          for (const s of liveSources().filter(x => x.hex).slice(0, 2)) { try { c = await s.hex(hex); if (c) { noteCands([c]); break; } } catch (e) { /* next source */ } }
        }
        if (c) { w.seenAt = seenAt(c); w.lat = c.lat; w.lon = c.lon; w.alt = c.gnd ? 0 : c.alt; }
        const ground = c && (c.gnd || (ENGINE.classify({ type: c.type || w.type || '', cat: c.cat || '' }) !== 'heli' && fin(c.alt) && c.alt < 400 && !(c.gs > 60)));
        const state = c ? (ground ? 'gnd' : 'air') : (w.state === 'air' && now() - (w.seenAt || 0) > 20 * 60000 ? 'lost' : w.state);
        const here = c && ground ? ENGINE.airportAt(c.lat, c.lon, 8, {}) : null, ap = here && here.airport;
        const mapUrl = c ? `https://www.flightradar24.com/${c.lat.toFixed(2)},${c.lon.toFixed(2)}/10` : '';
        if (state && state !== w.state) {
          const prev = w.state; w.state = state; w.stateAt = now();
          if (prev === 'gnd' && state === 'air') {
            const from = w.apId ? ENGINE.byId(w.apId) : null;
            notify(`${wLabel(w)} took off`, `${from ? `From ${apCode(from)} ${from.city || from.name}` : 'Now airborne'}${w.type ? ' · ' + w.type : ''}`, mapUrl);
            w.predictAt = now() + 4 * 60000; w.predicted = '';
          } else if (state === 'gnd' && (prev === 'air' || prev === 'lost')) {
            notify(`${wLabel(w)} landed`, ap ? `At ${apCode(ap)} ${ap.city || ap.name}${w.predicted && w.predicted !== '-' ? (w.predicted === apCode(ap) ? ' (as predicted)' : ` (predicted ${w.predicted})`) : ''}` : 'On the ground', mapUrl);
          }
        }
        if (ap) w.apId = ap.id;
        if (w.state === 'air' && w.predictAt && now() > w.predictAt && !w.predicted) {
          w.predicted = '…';
          predictForHex(hex).then(p => {
            const top = p && p.cands && p.cands[0];
            if (top) { const a = top.airport; w.predicted = apCode(a); notify(`${wLabel(w)} → ${apCode(a)}?`, `Predicted destination: ${a.city || a.name} (${apCode(a)}), ${Math.round(top.p * 100)}%${p.cands[1] ? ` · or ${apCode(p.cands[1].airport)} ${Math.round(p.cands[1].p * 100)}%` : ''}`, mapUrl); }
            else w.predicted = '-';
            saveWatch();
          }).catch(() => { w.predicted = '-'; });
        }
      }
      saveWatch();
    } finally { watchBusy = false; }
  }
  function watchListHtml() {
    const l = Object.values(watchList()); if (!l.length) return '<div class="tl-muted">Nothing watched yet - "☆ watch" on an aircraft adds it.</div>';
    const hm = t => t ? new Date(t).toISOString().slice(11, 16) + 'Z' : '';
    return l.sort((a, b) => (b.stateAt || 0) - (a.stateAt || 0)).map(w => {
      const ap = w.apId ? ENGINE.byId(w.apId) : null;
      const st = w.state === 'air' ? `airborne${fin(w.alt) ? ' · ' + Math.round(w.alt / 100) * 100 + ' ft' : ''}${w.predicted && w.predicted.length > 1 ? ' · → ' + esc(w.predicted) + '?' : ''}` : w.state === 'gnd' ? `on the ground${ap ? ' at ' + esc(apCode(ap)) : ''}` : w.state === 'lost' ? 'out of coverage' : 'not seen yet';
      return `<div class="tl-pop-row"><a href="${w.reg ? '/data/aircraft/' + encodeURIComponent(w.reg.toLowerCase()) : '#'}" target="_blank" rel="noopener">${esc(wLabel(w))}</a> <span class="tl-muted">${esc(w.type || '')}</span> <span>${st}</span> <span class="tl-muted">${hm(w.stateAt)}</span> <a href="#" data-tl-act="unwatch" data-hex="${esc(w.hex)}" title="Stop watching">✕</a></div>`;
    }).join('');
  }

  // ---- prediction scorecard: what was predicted for each flight, against where it really landed ---------------------
  let accS = null, accSaveT = 0;
  const accStore = () => accS || (accS = store.kvGet('acc1') || { open: {}, done: [] });
  const saveAcc = () => { if (!accSaveT) accSaveT = setTimeout(() => { accSaveT = 0; store.kvSet('acc1', accS); }, 10000); };
  function accNote(id, route) {
    if (!route || !route.destId || route.quick) return;
    const A = accStore(), k = String(id), o = A.open[k];
    if (route.landed) {
      if (o && o.s.length) {
        const ata = route.ata || nowS();
        A.done.push({ reg: o.reg, from: o.from, to: route.destIata || '', ata, s: o.s.map(x => [Math.round((ata - x[0]) / 60), x[1] === route.destId ? 1 : 0, x[2] || 0]) });
        calibAt = 0;
        if (A.done.length > 500) A.done.splice(0, A.done.length - 500);
        delete A.open[k]; saveAcc();
      }
      return;
    }
    if (route.onGround || route.destConf === 'filed' || route.destConf === 'confirmed') return;
    const cur = o || (A.open[k] = { reg: (live.get(id) || pubRecs.get(id) || {}).reg || '', from: route.originIata || '', t0: nowS(), s: [] });
    const last = cur.s[cur.s.length - 1];
    if (!last || nowS() - last[0] >= 300 || last[1] !== route.destId) { cur.s.push([nowS(), route.destId, route.destP || 0]); if (cur.s.length > 150) cur.s.shift(); saveAcc(); }
    // flights that were never seen landing (flew out of view) are dropped after a day
    if (Math.random() < 0.02) { for (const [kk, v] of Object.entries(A.open)) if (nowS() - (v.t0 || 0) > 86400) delete A.open[kk]; }
  }
  // Learning from its own record: the odds shown, against how often an answer given at those odds turned out right
  // in this browser (every predicted flight seen landing is scored). With 100+ scored moments, each 10% band moves
  // towards what was observed (a band of 30 moments counts as much as the engine's own figure). Only the odds shown
  // change - never which airport is picked.
  let calib = null, calibAt = 0;
  function calibP(p) {
    if (!(p > 0)) return p;
    if (now() - calibAt > 600000) {
      calibAt = now(); calib = null;
      const bins = Array.from({ length: 10 }, () => [0, 0, 0]); let n = 0;
      for (const f of accStore().done) for (const x of f.s) { if (!(x[2] > 0)) continue; const b = Math.min(9, Math.floor(x[2] / 10)); bins[b][0]++; bins[b][1] += x[1]; bins[b][2] += x[2] / 100; n++; }
      if (n >= 100) calib = bins.map(([k, h, sp]) => k ? { k, rate: h / k, mean: sp / k } : null);
    }
    if (!calib) return p;
    const c = calib[Math.min(9, Math.floor(p * 10))]; if (!c) return p;
    const w = c.k / (c.k + 30), adj = w * (c.rate - c.mean);
    return Math.max(0.01, Math.min(0.99, p + adj));
  }
  function statsHtml() {
    const A = accStore(), bands = [['last 10 min', 0, 10], ['10-30 min out', 10, 30], ['30-60 min out', 30, 60], ['1-2 h out', 60, 120], ['2 h+ out', 120, 1e9]];
    if (!A.done.length) return '<div class="tl-muted">No finished flights yet: every flight the script predicts is scored when it lands while FR24 is open.</div>';
    const rows = bands.map(([name, lo, hi]) => { let n = 0, h = 0; for (const f of A.done) for (const [m, ok] of f.s) if (m >= lo && m < hi) { n++; h += ok; } return n ? `<div class="tl-pop-row"><span>${name}</span> <b>${Math.round(100 * h / n)}%</b> <span class="tl-muted">(${n})</span></div>` : ''; }).join('');
    const early = A.done.map(f => { let first = null; for (let i = f.s.length - 1; i >= 0; i--) { if (!f.s[i][1]) break; first = f.s[i][0]; } return first; }).filter(v => v != null).sort((a, b) => a - b);
    const med = early.length ? early[early.length >> 1] : null;
    return `<div class="tl-muted">${A.done.length} flights scored when they landed (share of predictions that named the right airport):</div>${rows}${med != null ? `<div class="tl-pop-row tl-muted">Typically right from ${med} min before landing onwards.</div>` : ''}`;
  }

  // ---- the owner's fleet: other aircraft registered to the same owner (FAA register by name, and the logs kept) -------
  const fleetCache = new Map();   // owner key -> { at, list }
  async function fleetList(rec) {
    const hx = withStored(rec), key = ENGINE.ownerKey(hx.owner) || ENGINE.ownerKey(hx.operatorName); if (!key) return [];
    const c = fleetCache.get(key); if (c && now() - c.at < 30 * 60000) return c.list;
    const list = new Map();
    for (const h of fleetMates(rec.hex)) { const x = store.getHex(h) || {}; list.set(h, { hex: h, reg: x.reg || '', type: x.type || '', model: x.desc || '' }); }
    if (/^N\d/.test(hx.reg || '') && hx.owner) {
      try {
        const html = await gmRequest(`https://registry.faa.gov/AircraftInquiry/Search/NameResult?Nametxt=${encodeURIComponent(decodeEntities(hx.owner))}&sort_option=1&PageNo=1`, { json: false, accept: 'text/html', timeout: 15000, priority: true });
        for (const m of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
          const cell = l => { const x = m[1].match(new RegExp('data-label="' + l + '"[^>]*>([\\s\\S]*?)</td>', 'i')); return x ? clean(x[1].replace(/<[^>]*>/g, ' ')) : ''; };
          const num = cell('N-Number'), serial = cell('Serial Number'); if (!num || !serial) continue;   // (reserved numbers have no aircraft)
          const reg = 'N' + num.replace(/^N/i, '').toUpperCase(), hex = nNumberHex(reg); if (!hex) continue;
          const model = cell('Manufacturer Name / Model');
          if (!list.has(hex)) list.set(hex, { hex, reg, type: '', model });
          // remembered with its owner, so the fleet's flights inform the destination (see fleetVisits) once its log is in
          const cur = store.getHex(hex) || {}; if (!cur.owner) store.mergeHex(hex, { hex, reg, owner: hx.owner });
        }
      } catch (e) { log('fleet', String(e.message || e)); }
    }
    const out = [...list.values()].filter(x => x.hex !== rec.hex).slice(0, 40);
    fleetCache.set(key, { at: now(), list: out });
    // their logs, in the background (a few at a time; the history pump does the rest)
    out.slice(0, 8).forEach(x => loadHistory(x.hex, 21, null, { bg: true }).catch(() => {}));
    return out;
  }
  async function fleetHtml(rec) {
    const hx = withStored(rec), owner = ownerName(hx.owner) || ownerName(hx.operatorName);
    const list = await fleetList(rec);
    if (!list.length) return `<div class="tl-muted">No other aircraft known for ${esc(owner || 'this owner')}${/^N\d/.test(hx.reg || '') ? '' : ' (the owner search covers US registrations; others are found as the script sees them)'}.</div>`;
    return `<div class="tl-muted">${esc(owner)}: ${list.length} other aircraft</div>` + list.map(x => {
      const c = watchSighting(x.hex), g = globalList.byHex.get(x.hex);
      const st = c ? (c.gnd ? 'on the ground' + (() => { const h = ENGINE.airportAt(c.lat, c.lon, 8, {}); return h ? ' at ' + apCode(h.airport) : ''; })() : `airborne · ${Math.round((c.alt || 0) / 100) * 100} ft`) : 'not seen now';
      return `<div class="tl-pop-row"><a href="/data/aircraft/${encodeURIComponent((x.reg || x.hex).toLowerCase())}" target="_blank" rel="noopener">${esc(x.reg || x.hex.toUpperCase())}</a> <span class="tl-muted">${esc(x.type || (g && g.type) || x.model || '')}</span> <span>${esc(st)}</span></div>`;
    }).join('');
  }

  // ---- flight log as CSV --------------------------------------------------------------------------------------------
  async function exportCsv(rec) {
    // (a month of log if it is not in yet - but no long wait behind a full rebuild already running: what is known goes)
    try { await Promise.race([loadHistory(rec.hex, 30, null), sleep(2500)]); } catch (e) { /* what is kept */ }
    const legs = knownLegs(rec.hex).filter(l => l.from || l.to).sort((a, b) => a.tStart - b.tStart);
    const iso = t => t ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) : '';
    const ap = e => { const a = e && apById(e.id); return a ? [apCode(a), a.icao || '', a.name || ''] : ['', '', '']; };
    const cell = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [['date_utc', 'callsign', 'from', 'from_icao', 'from_name', 'to', 'to_icao', 'to_name', 'takeoff_utc', 'landing_utc', 'minutes', 'max_alt_ft', 'completed'].join(',')];
    for (const l of legs) { const f = ap(l.from), t = ap(l.to); lines.push([iso(l.tStart).slice(0, 10), l.cs || '', ...f, ...t, iso(l.tStart), l.ended ? iso(l.tEnd) : '', l.ended ? Math.round((l.tEnd - l.tStart) / 60) : '', l.maxAlt || '', l.ended ? 'yes' : 'no'].map(cell).join(',')); }
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${(rec.reg || rec.hex).toUpperCase()}-flights.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---- health: notices when FR24 changes something this script relies on ---------------------------------------------
  const health = { issues: [], at: 0, t0: now() };
  function checkHealth() {
    const issues = [];
    // (the page part's counters: read directly where the script shares its world, otherwise - the browser extension - as
    // the page part last sent them, and asked for again for the next check)
    let S = null; try { const B = pageWindow().__tweeksLaddBridge; S = B && B.stats; } catch (_) { /* ignore */ }
    if (!S) { S = bridgeStats; if (bridgeReady) postToPage('stats?'); }
    if (!bridgeReady && now() - health.t0 > 20000) issues.push('the page part of the script is not answering');
    if (S) {
      if (S.maskDisabled) issues.push('FR24 refused the request for the unlocked fields');
      if (S.errors > 25) issues.push(`FR24's data format may have changed (${S.errors} patch errors)`);
      if (now() - health.t0 > 90000 && !S.liveFeed && !isAircraftPage) issues.push("FR24's live feed was not recognised");
    }
    const panel = document.querySelector(SEL.panel);
    if (panel && currentId() != null) { const missing = ['callsign', 'registration', 'depIata', 'arrIata'].filter(k => !q(panel, SEL[k])); if (missing.length >= 2) issues.push("FR24's aircraft panel changed layout"); }
    if (issues.join() !== health.issues.join()) { if (issues.length) log('health', issues.join('; ')); syncPanelSoon(); }
    health.issues = issues; health.at = now();
  }

  // ---- confirm: the user sets a flight's destination - heard on the radio, seen on final, known to be elsewhere -------
  // Shown at 100% ("confirmed by you") for the rest of that flight, and learned from at once (where it left -> there) and
  // again when its log has the flight. Kept two days: { [FR24 flight id]: { destId, code, hex, t0, at, prev } }
  let userConf = null;
  const userConfStore = () => { if (!userConf) userConf = store.kvGet('userConf1') || {}; return userConf; };
  function userDestOf(id, hex, t0) {
    const m = userConfStore();
    if (id != null && m[id]) return m[id];
    if (!hex) return null;
    for (const k of Object.keys(m)) { const u = m[k]; if (u && u.hex === hex && t0 && u.t0 && Math.abs(u.t0 - t0) < 2 * 3600) return u; }
    return null;
  }
  function userConfirm(id, rec, apId) {
    const m = userConfStore(), r = (routeState.get(id) || {}).route || rec.route || {}, a = apId ? apById(apId) : null;
    if (m[id] && m[id].destId && (!a || a.id !== m[id].destId)) noteRouteWithdrawn(id, m[id].destId);
    if (!a) delete m[id];
    else m[id] = { destId: a.id, code: apCode(a), hex: rec.hex || '', t0: r.departedAt || r.atd || nowS(), at: now(), prev: r.userConfirmed ? ((m[id] && m[id].prev) || '') : (r.destIata || '') };
    for (const k of Object.keys(m)) if (!m[k] || now() - (m[k].at || 0) > 2 * 864e5) delete m[k];
    store.kvSet('userConf1', m);
    // (1.1.0: to the monitor with the next report - every browser's answer has it - and the flight, once down, learned
    // there as one that ended where you said: 03 learnFromLeg)
    scheduleReplan(id, 10); syncPanelSoon();
  }
  // airports by code, name or city (exact codes first, then the busiest); a strip FR24 does not list by its own code
  function airportSearch(q) {
    q = String(q || '').trim().toUpperCase(); if (q.length < 2) return [];
    const out = [];
    for (const a of airports.list || []) {
      const code = String(a.iata || '').toUpperCase(), icao = String(a.icao || '').toUpperCase(), nm = (String(a.name || '') + ' ' + String(a.city || '')).toUpperCase();
      const s = code === q || icao === q ? 3 : code.startsWith(q) || icao.startsWith(q) ? 2 : nm.includes(q) ? 1 : 0;
      if (s) out.push([s, a.size || 0, a]);
    }
    const f = ENGINE.byIcao(q); if (f && f.field) out.push([3, 0, f]);
    out.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
    return out.slice(0, 12).map(x => x[2]);
  }
  function confirmListHtml(id, rec, q) {
    const r = (routeState.get(id) || {}).route || rec.route || {};
    const list = q && String(q).trim().length >= 2 ? airportSearch(q).map(a => [a.id, null]) : (r.cands || []).slice(0, 10);
    return list.map(([apId, p]) => { const a = apById(apId); if (!a) return ''; return `<div class="tl-pop-row"><a href="#" data-tl-act="confirmPick" data-ap="${a.id}"><b>${esc(apCode(a))}</b> ${esc(a.city || a.name)}</a>${p != null ? ` <span class="tl-muted">${p}%</span>` : ''}</div>`; }).join('') || '<div class="tl-muted">no airport found</div>';
  }
  function confirmHtml(id, rec) {
    const r = (routeState.get(id) || {}).route || rec.route || {}, uc = userDestOf(id, rec.hex, r.departedAt);
    return `<div class="tl-pop-row"><input id="tl-conf-q" type="text" autocomplete="off" placeholder="search an airport: code, name or city" style="flex:1;min-width:0;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:3px 6px"></div>
      <div id="tl-conf-list">${confirmListHtml(id, rec, '')}</div>
      ${uc ? `<div class="tl-pop-row" style="margin-top:6px"><span class="tl-muted">confirmed by you: ${esc(uc.code)}</span> <a href="#" data-tl-act="confirmClear">clear</a></div>` : ''}
      <div class="tl-muted" style="margin-top:4px">Locks this flight's destination in at 100% - heard on the radio, seen on final, or known to be wrong - and the engine learns from it.</div>`;
  }
  document.addEventListener('input', ev => {
    if (!ev.target || ev.target.id !== 'tl-conf-q' || !popEl) return;
    const id = Number(popEl.dataset.id), rec = live.get(id) || pubRecs.get(id); if (!rec) return;
    const l = popEl.querySelector('#tl-conf-list'); if (l) l.innerHTML = confirmListHtml(id, rec, ev.target.value);
  }, true);
  // ---- the strip's tool links and their pop-over -------------------------------------------------------------------
  function toolLinks(rec) {
    const hx = withStored(rec), n = Object.keys(watchList()).length;
    return [
      '<a href="#" data-tl-act="confirm" title="Set the destination yourself - heard on the radio, seen on final, or known to be wrong: locked in, and learned from">confirm</a>',
      `<a href="#" data-tl-act="watch" title="Alerts when it takes off and lands">${isWatched(rec.hex) ? '★ watching' : '☆ watch'}</a>`,
      n ? `<a href="#" data-tl-act="watchlist">watchlist (${n})</a>` : '',
      (hx.owner || hx.operatorName) ? '<a href="#" data-tl-act="fleet" title="Other aircraft of the same owner">fleet</a>' : '',
      '<a href="#" data-tl-act="csv" title="Download the flight log">CSV</a>',
      '<a href="#" data-tl-act="stats" title="How the predictions have done">scorecard</a>',
      `<a href="#" data-tl-act="ladd" class="tl-muted" title="LADD Unblock: its switches, data sources and updates (also on FR24's bottom bar)">v${VERSION}</a>`
    ].filter(Boolean).join(' · ');
  }
  // ---- sources: which data feeds answer, and the user's own ADS-B Exchange key --------------------------------------
  const SOURCE_ROWS = [['ginfoapi.caa.co.uk', 'UK register (G-INFO: owners, serials, years)'], ['registry.faa.gov', 'FAA register'], ['ardis.iomaircraftregistry.com', 'Isle of Man register'], ['hexdb.io', 'hexdb (registrations, owners)'], ['api.adsb.lol', 'adsb.lol (live)'], ['adsb.lol', 'adsb.lol (flight logs, 6 weeks)'], ['opendata.adsb.fi', 'adsb.fi'], ['globe.airplanes.live', 'airplanes.live (flight logs)'], ['globe.theairtraffic.com', 'TheAirTraffic (live, last days)'], ['opensky-network.org', 'OpenSky'], ['adsbexchange-com1.p.rapidapi.com', 'ADS-B Exchange (your key)'], ['api.flightradar24.com', 'FR24 (photos, schedules)'], ['api.planespotters.net', 'Planespotters'], ['aviationweather.gov', 'aviationweather.gov (METARs)'], ['external-api.faa.gov', 'FAA NOTAMs (your key)']];
  function sourcesHtml() {
    const ago = t => t ? (s => s < 90 ? s + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago')(Math.round((now() - t) / 1000)) : 'not asked yet';
    const rows = SOURCE_ROWS.map(([host, name]) => {
      const h = hostStat.get(host), dead = (deadHosts.get(host) || 0) > now();
      const n = h ? ` <span class="tl-muted">· ${h.ok} ok${h.fail ? ', ' + h.fail + ' failed' : ''}</span>` : '';
      // (a network's verification page in front of the flight logs: said, with the way through - the site itself)
      const nid = host === 'adsb.lol' ? 'lol' : host === 'globe.airplanes.live' ? 'apl' : '', ns = nid && netState[nid];
      if (ns && ns.wallAt && now() - ns.wallAt < 30 * 60000) return `<div class="tl-pop-row"><span>${esc(name)}</span> <span style="color:#e05252">verification page</span> <span class="tl-muted">${ago(ns.wallAt)} - <a href="${NETS[nid].site}" target="_blank" rel="noopener">open ${esc(NETS[nid].name)}</a> once in a tab, then reload FR24</span>${n}</div>`;
      const st = dead ? '<span style="color:#e05252">paused (refused)</span>' : !h ? '<span class="tl-muted">not asked yet</span>' : h.lastOk >= h.lastErr ? `<span style="color:#3fb950">ok</span> <span class="tl-muted">${ago(h.lastOk)}</span>` : `<span style="color:#e0a852">${esc(h.err || 'failing')}</span> <span class="tl-muted">${ago(h.lastErr)}</span>`;
      return `<div class="tl-pop-row"><span>${esc(name)}</span> ${st}${n}</div>`;
    }).join('');
    const has = !!String(store.kvGet('adsbxKey') || '').trim();
    const mr = monRemote(), monRow = `<div class="tl-pop-row" style="margin-top:8px"><span>Monitor</span> ${mr ? '<span class="tl-muted">' + esc(mr.url) + (mr.dflt ? ' (the public monitor)' : mr.token ? ' (with your secret)' : '') + (monBase === mr.url && monOk ? ' - in use' : ' - not answering' + (monErr ? ' (' + esc(monErr) + ')' : '') + ', checked again within 5 min') + (monBase === mr.url && monLive.at ? ' · live list ' + monLive.n + ' aircraft, ' + ago(monLive.at) + (monLive.ok ? '' : ' (stale - own lists used)') : '') + (monBase === mr.url && srvIds.at ? ' · names ' + srvIds.rows.size + ' FR24 flights, ' + ago(srvIds.at) + (srvIds.scanOk ? '' : ' (its FR24 scan not working - this browser\'s reports keep it going)') : '') + '</span>' : '<span class="tl-muted">turned off - this browser works alone</span>'}</div>
      <div class="tl-pop-row"><input id="tl-mon-url" autocomplete="off" placeholder="${MON_DEFAULT_URL}" value="${mr && !mr.dflt ? esc(mr.url) : ''}" class="tl-in"> <input id="tl-mon-token" type="password" autocomplete="off" placeholder="owner's secret (optional)" class="tl-in"> <a href="#" data-tl-act="monSave">save</a>${mr && !mr.dflt ? ' · <a href="#" data-tl-act="monClear">public monitor</a>' : ''}${mr ? ' · <a href="#" data-tl-act="monOff">turn off</a>' : ' · <a href="#" data-tl-act="monClear">turn on</a>'}</div>
      <div class="tl-muted" style="margin-top:4px">The monitor is a server that watches FR24's whole map and public ADS-B all the time: it names every blocked flight, works out a rough destination, keeps every blocked aircraft's flights and owners - and this browser gets all of it the moment FR24 opens. Every copy of the script uses the project's public monitor; nothing to set up. Another address here uses your own monitor instead (monitor/monitor.cjs), and its secret gives you its full answers. Turned off, this browser identifies what it sees itself. All of it is kept in this browser only.</div>`;
    return rows + monRow + `<div class="tl-pop-row" style="margin-top:8px"><span>ADS-B Exchange key</span></div>
      <div class="tl-pop-row"><input id="tl-adsbx-key" type="password" autocomplete="off" placeholder="${has ? 'saved - paste a new one to replace it' : 'paste your RapidAPI key'}" class="tl-in"> <a href="#" data-tl-act="adsbxSave">save</a>${has ? ' · <a href="#" data-tl-act="adsbxClear">remove</a>' : ''}</div>
      <div class="tl-muted" style="margin-top:4px">Optional. Your own key for the ADS-B Exchange API (rapidapi.com), which sees aircraft the free feeds miss. Used only when adsb.lol and adsb.fi cannot identify a flight or give no callsign, so a small plan lasts. Kept in this browser only.</div>
      <div class="tl-pop-row" style="margin-top:8px"><span>FAA NOTAM API key</span>${notamKey() ? ' <span class="tl-muted">saved</span>' : ''}</div>
      <div class="tl-pop-row"><input id="tl-faa-id" type="password" autocomplete="off" placeholder="client_id" class="tl-in"> <input id="tl-faa-secret" type="password" autocomplete="off" placeholder="client_secret" class="tl-in"> <a href="#" data-tl-act="faaSave">save</a>${notamKey() ? ' · <a href="#" data-tl-act="faaClear">remove</a>' : ''}</div>
      <div class="tl-muted" style="margin-top:4px">Optional, free from api.faa.gov. With it, an airport closed by NOTAM at the arrival time is taken out of the predictions (the three likeliest fields of the aircraft you are looking at, every few hours). Weather (METARs) needs no key.</div>`;
  }
  // (22.10) the population behind every prediction: what the tables were learned from
  // (1.1.0: the population tables are the monitor's - how many days they were learned from, as its /status says)
  const popTxt = () => { const d = monStat && monStat.central && +monStat.central.popDays; return d > 0 ? `, the habits of every aircraft seen over ${d} days` : ''; };
  function healthHtml() { return health.issues.length ? `<div class="tl-warn">⚠ ${esc(health.issues[0])} - some fields may not fill until the script is updated.</div>` : ''; }
  let popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  function showPop(anchor, title, html) {
    closePop();
    popEl = document.createElement('div'); popEl.className = 'tl-pop';
    popEl.innerHTML = `<div class="tl-pop-head"><b>${esc(title)}</b><a href="#" data-tl-act="close" title="Close">✕</a></div><div class="tl-pop-body">${html}</div>`;
    document.body.appendChild(popEl);
    const r = anchor.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 16);
    popEl.style.width = w + 'px'; popEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    popEl.style.top = Math.min(window.innerHeight - 60, r.bottom + 6) + 'px';
    return popEl;
  }
  document.addEventListener('click', ev => {
    const a = ev.target && ev.target.closest ? ev.target.closest('[data-tl-act]') : null;
    if (!a) { if (popEl && !(ev.target.closest && ev.target.closest('.tl-pop'))) closePop(); return; }
    ev.preventDefault(); ev.stopPropagation();
    const act = a.dataset.tlAct, rec = live.get(currentId()) || pubRecs.get(currentId());
    if (act === 'close') return closePop();
    if (act === 'unwatch') { const l = watchList(); delete l[a.dataset.hex]; saveWatch(); syncPanelSoon(); const b = popEl && popEl.querySelector('.tl-pop-body'); if (b) b.innerHTML = watchListHtml(); return; }
    if (act === 'watchlist') { showPop(a, 'Watchlist', watchListHtml()); return; }
    if (act === 'stats') { showPop(a, 'Prediction scorecard', statsHtml()); return; }
    if (act === 'ladd') { closePop(); openUnblockWindow(); return; }
    if (act === 'faaSave' || act === 'faaClear') {
      const id = String((document.getElementById('tl-faa-id') || {}).value || '').trim(), sec = String((document.getElementById('tl-faa-secret') || {}).value || '').trim();
      if (act === 'faaSave' && !(id && sec)) return;
      store.kvSet('faaNotam', act === 'faaClear' ? {} : { id, secret: sec }); deadHosts.delete('external-api.faa.gov'); notamCache.clear();
      refreshSources();
      return;
    }
    if (act === 'monSave' || act === 'monClear' || act === 'monOff') {
      // (save: an address - the public monitor's when left empty - and the secret, if any; public monitor: back to it;
      // turn off: no monitor at all)
      const url = monAddr((document.getElementById('tl-mon-url') || {}).value) || MON_DEFAULT_URL, token = String((document.getElementById('tl-mon-token') || {}).value || '').trim();
      store.kvSet('monRemote', act === 'monClear' ? {} : act === 'monOff' ? { off: true } : url === MON_DEFAULT_URL && !token ? {} : { url, token }); monBase = ''; monOk = false;
      // (the browser extension reaches only the hosts its manifest lists: a monitor elsewhere is asked for - the browser
      // opens a page where the user allows it - and looked at again once allowed)
      const asked = act === 'monSave' && typeof TL_HOST_ACCESS === 'function' && !MON_DEFAULTS.includes(url) && !/\.sslip\.io$/.test(new URL(url).host) ? TL_HOST_ACCESS(new URL(url).origin) : Promise.resolve(true);
      asked.then(has => monCheck(true).catch(() => {}).then(() => { if (!has && !monOk) monErr = 'allow the extension to reach it, on the page the browser opened'; refreshSources(); }));
      return;
    }
    if (act === 'adsbxSave' || act === 'adsbxClear') {
      const inp = document.getElementById('tl-adsbx-key'), v = act === 'adsbxClear' ? '' : String(inp && inp.value || '').trim();
      if (act === 'adsbxSave' && !v) return;
      store.kvSet('adsbxKey', v); deadHosts.delete('adsbexchange-com1.p.rapidapi.com');
      refreshSources();
      return;
    }
    if (act === 'confirm' || act === 'confirmPick' || act === 'confirmClear') {
      const id = act === 'confirm' ? currentId() : Number(popEl && popEl.dataset.id), crec = id != null ? (live.get(id) || pubRecs.get(id)) : null; if (!crec) return;
      if (act === 'confirm') { const p = showPop(a, 'Confirm the destination', confirmHtml(id, crec)); p.dataset.id = String(id); const inp = p.querySelector('#tl-conf-q'); if (inp) inp.focus(); return; }
      userConfirm(id, crec, act === 'confirmPick' ? Number(a.dataset.ap) : 0); closePop(); return;
    }
    if (!rec || !rec.hex) return;
    if (act === 'watch') { toggleWatch(rec); return; }
    if (act === 'csv') { exportCsv(rec).catch(e => log('csv', e)); return; }
    if (act === 'fleet') { const p = showPop(a, 'Fleet', '<div class="tl-muted"><span class="tl-spin"></span> looking up the register…</div>'); fleetHtml(rec).then(h => { if (popEl === p) p.querySelector('.tl-pop-body').innerHTML = h; }).catch(e => log('fleet', e)); }
  }, true);
