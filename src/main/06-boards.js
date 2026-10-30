
  // ---- airport boards beyond FR24's free day ---------------------------------------------------------------------------
  // FR24 shows a free account a little over a day of an airport's arrivals and departures, a page at a time. The page
  // answers a board with all of three days back and three ahead in one list (FR24's own day headings, cards and all; no
  // "Earlier" / "Later flights"), from every flight this script learns of, kept against the airports it used:
  //  - FR24's own schedule of the airport (its older airport API: a day and a half each way, free) and, for every flight
  //    number on it, FR24's list of that number (a week each way)
  //  - the permanent monitor's flights (monitor/monitor.cjs on this computer: every LADD aircraft, worldwide, and every
  //    aircraft around the UK - seen while FR24 was closed too)
  //  - a blocked (LADD) or N/A flight it follows, as it departs and when it lands - opened or not
  //  - the flights of every aircraft log it rebuilds (LADD or not, those it keeps in the background too)
  //  - FR24's own flown and scheduled flights of the aircraft whose FR24 schedule or log page it reads
  //  - FR24's own rows of that board from earlier visits
  // Kept per airport on disk (the 'hist' store, 'b:<airport id>'), so a board keeps them across refreshes.
  // (1.1.0: seven days each way - the monitor keeps every airport's FR24 rows of them, so a board opens whole)
  const BOARD_BACK = 7 * 86400, BOARD_AHEAD = 7 * 86400, BOARD_V = 2, BOARD_MAX = 12000;
  // (a flight rebuilt from its whole track beats what was guessed while it flew: M-ARNZ "from Woking" - first heard in
  // the air near Fairoaks - when its track shows it taking off at Farnborough)
  const BOARD_RANK = { fr24: 4, sched: 4, log: 3, live: 2 };
  const boardMem = new Map();     // apId -> { arr: {k: row}, dep: {k: row}, loading, dirty }
  const boardPend = new Map();    // apId -> [[kind, row]] not merged yet
  const boardAsked = new Map();   // apId -> when the page last asked (its board is open)
  let boardTimer = 0, boardTimerAt = 0;
  const boardOk = id => fin(id) && id > 0 && id < SITE_BASE;   // (FR24's own airports have boards; a strip or landing place has none)
  function boardPut(apId, kind, row) {
    if (!boardOk(apId) || !row || !fin(row.t) || Math.abs(row.t - nowS()) > Math.max(BOARD_BACK, BOARD_AHEAD)) return;
    // (1.1.0) FR24's own rows read here - its map board's, its schedule's, its flight numbers' lists - go to the monitor for
    // every other browser; those that came from it do not go back
    if (row.fromMon) { row = Object.assign({}, row); delete row.fromMon; delete row.u; }
    else if (row.src === 'fr24' || row.src === 'sched') boardUp(apId, kind, row);
    (boardPend.get(apId) || boardPend.set(apId, []).get(apId)).push([kind, row]);
    // (kept in a while, in one go - within a second or two for a board that is open)
    const wait = boardAsked.has(apId) ? 1500 : 20000;
    if (boardTimer && boardTimerAt <= now() + wait) return;
    if (boardTimer) clearTimeout(boardTimer);
    boardTimerAt = now() + wait;
    boardTimer = setTimeout(() => { boardTimer = 0; boardDrain().catch(e => log('board archive', e)); }, wait);
  }
  // (sent on in one request every eight seconds at most - sooner with a few hundred waiting; up to 2,000 rows a time)
  const upQ = new Map(); let upT = 0;
  function boardUp(apId, kind, row) {
    const q = upQ.get(apId) || upQ.set(apId, { arrivals: new Map(), departures: new Map() }).get(apId);
    q[kind].set(row.src + '|' + row.k, row);
    let n = 0; for (const x of upQ.values()) n += x.arrivals.size + x.departures.size;
    if (!upT) upT = setTimeout(boardUpFlush, n > 400 ? 500 : 8000);
  }
  function boardUpFlush() {
    upT = 0; const list = []; let n = 0;
    for (const [ap, q] of upQ) for (const kind of ['arrivals', 'departures']) {
      if (!q[kind].size || n >= 2000) continue;
      const rows = [...q[kind].values()].slice(0, 2000 - n); for (const r of rows) q[kind].delete(r.src + '|' + r.k);
      n += rows.length; list.push({ ap, kind, rows });
    }
    for (const [ap, q] of upQ) if (!q.arrivals.size && !q.departures.size) upQ.delete(ap);
    if (list.length) monPost('/boardrows', { list }).catch(() => {});
    if (upQ.size && !upT) upT = setTimeout(boardUpFlush, 3000);
  }
  function boardLoad(apId) {
    let b = boardMem.get(apId);
    if (b) return b.loading || Promise.resolve(b);
    b = { arr: {}, dep: {}, dirty: false }; boardMem.set(apId, b);
    // (only once the store is open: read before that, an airport's kept rows would look empty - and be written over)
    b.loading = Promise.resolve(store.kvReady).then(() => { b.noDisk = store.mode() !== 'idb'; return store.getBoard(apId); }).then(v => { if (v && (v.v === BOARD_V || v.v === 1)) { Object.assign(b.arr, v.arr || {}); Object.assign(b.dep, v.dep || {}); if (fin(v.monSync)) b.monSync = v.monSync; boardScrub(apId, b); } }).catch(() => { /* none kept */ }).then(() => { b.loading = null; return b; });
    if (boardMem.size > 120) for (const [k, x] of boardMem) { if (boardMem.size <= 100) break; if (!x.loading && !x.dirty && !boardAsked.has(k)) boardMem.delete(k); }
    return b.loading;
  }
  // (rows an older build kept of a "flight" back where it began that never flew - an airliner taxiing with its transponder
  // saying "airborne", its take-off never seen: Liverpool's arrivals were full of "Liverpool -> Liverpool, landed")
  function boardScrub(apId, b) {
    let n = 0;
    for (const [m, kind] of [[b.arr, 'arrivals'], [b.dep, 'departures']]) for (const k of Object.keys(m)) if (fakeRow(m[k], apId, kind)) { delete m[k]; n++; }
    for (const k of Object.keys(b.arr)) {
      const r = b.arr[k]; if (!r || r.drop || r.ap !== apId || !(r.src === 'live' || r.src === 'log')) continue;
      const d = b.dep[k], light = /^(piston|heli|fighter)$/.test(ENGINE.classify({ hex: r.hex || '', type: r.ty || '', reg: r.reg || '', cs: r.cs || '' }));
      if (d ? !d.drop && r.t - d.t >= (light ? 300 : 900) : r.src === 'log') continue;
      delete b.arr[k]; if (d && d.ap === apId && d.src === r.src) delete b.dep[k]; n++;
    }
    if (n) b.dirty = true;
    return n;
  }
  // A row of our own ('log': rebuilt from a flight log; 'live': a flight followed as it flew) of an aircraft that is not
  // blocked - a flight FR24 shows itself, with what it knows of its route - is kept only when both its ends were seen:
  // where it took off and where it came down. An end only guessed - where the aircraft was first or last heard - is no
  // flight: the monitor polls the air around a board that is opened, and jets passing over the field low are heard
  // there first or last. Gatwick's arrivals over Biggin Hill were "departed Biggin Hill -> Gatwick"; Luton's arrivals
  // had easyJets and Wizz jets "from Stansted" (the hold the two share) and Ryanairs "from Liverpool"; Manchester's
  // departures Ryanairs "to Liverpool". And one end unknown ("N/A") says nothing FR24's own row does not: Luton's
  // departures had NetJets, VistaJets, Wizz and registration-only jets "-> N/A", callsign only, beside FR24's own rows.
  // Followed live, a departure is noted only once its take-off was seen, and an arrival's origin is FR24's own; a
  // departure needs its landing seen on the ground (gc). Blocked and military aircraft (what FR24 does not show), light
  // aircraft (often seen only low beside their strip) and an aircraft of unknown type flying under its registration are
  // left as they are.
  // (gliders by their model where the type is not known: FR24's code for them is GLID - G-RDGE, a DG-1000S, was a
  // "Business jet" on Liverpool's board)
  const GLIDER = /\b(glider|segelflug|DG[- ]?\d{3,4}|AS[KWGH][- ]?\d|Discus|Duo Discus|Janus|Nimbus|Ventus|Arcus|Twin Astir|Astir|LS[- ]?\d|Schleicher|Schempp|Grob G ?10[23]|Pilatus B4|Puchacz|Jantar|SZD)/i;
  const airlineCs = cs => /^[A-Z]{3}\d/.test(String(cs || '').toUpperCase());
  function fakeRow(r, apId, kind) {
    if (!r || !(r.src === 'log' || r.src === 'live') || r.drop) return false;
    const hx = (r.hex && store.getHex(r.hex)) || {};
    if (!r.hex) return false;
    const cls = ENGINE.classify({ hex: r.hex, type: r.ty || hx.type || '', reg: r.reg || '', cs: r.cs || '' });
    const light = /^(piston|heli|fighter|glider)$/.test(cls) || (cls === 'unknown' && !airlineCs(r.cs)) || GLIDER.test(r.dsc || '');
    // (a light aircraft - blocked or not - is on this airport's board only when it was seen there: on the ground, or low
    // beside it. G-RDGE, a glider out of Chester, was "departed Liverpool": first heard soaring 25 km away. Rows kept
    // before this was noted are left; they are judged again as the monitor and the logs send them)
    if (light && r.src === 'log' && (r.oc != null || r.dc != null)) { const here = kind === 'arrivals' ? r.dc : r.oc; if (here !== 'ground' && here !== 'low') return true; }
    if (light || hx.ladd || hx.fr24Blocked || hx.pia || hx.mil) return false;
    // (back where it left: an airline's number never - a registration's, a test or training flight, when seen at both ends)
    if (!r.ap || (r.ap === apId && airlineCs(r.cs))) return true;
    if (r.src === 'live') return kind === 'arrivals' ? false : !r.gc;
    // (how each end was seen - oc where it left, dc where it came down: 'ground', or 'low' - heard below 3,000 ft within
    // 15 km of the field. An airliner's ends must be seen on the ground; a business jet's or turboprop's low beside the
    // field will do, as their fields are often out of hearing on the ground. Rows kept before these were noted: not seen)
    const ok = c => c === 'ground' || (c === 'low' && cls !== 'airliner' && cls !== 'unknown');
    const oc = r.oc || (r.og ? 'ground' : ''), dc = r.dc || (r.gc ? 'ground' : '');
    return !(ok(oc) && ok(dc));
  }
  // one flight's row: what a better source says wins, what it lacks is kept from the other
  function boardMerge(b, kind, row, apId) {
    const m = kind === 'arrivals' ? b.arr : b.dep, cur = m[row.k];
    // (one of those: not kept - and an older build's row of the same flight goes)
    if (fakeRow(row, apId, kind)) { if (cur && cur.src === row.src) { delete m[row.k]; b.dirty = true; } return; }
    if (cur && (BOARD_RANK[cur.src] || 0) > (BOARD_RANK[row.src] || 0)) { for (const f of ['reg', 'hex', 'ty', 'dsc', 'al', 'alId', 'ap', 'cs', 'fid']) if (!cur[f] && row[f]) cur[f] = row[f]; }
    else {
      m[row.k] = cur ? Object.assign({}, cur, Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== ''))) : row;
      // (two of FR24's own lists of one flight - the airport's schedule, the number's list - each lack something: the
      // airline far ahead, the ICAO type, the other airport. What either had stays)
      if (cur && cur.nat && row.nat) {
        const n = Object.assign({}, cur.nat, Object.fromEntries(Object.entries(row.nat).filter(([, v]) => v != null && v !== '')));
        if (/^[A-Z][A-Z0-9]{3}$/.test(cur.nat.aircraftType || '') && !/^[A-Z][A-Z0-9]{3}$/.test(row.nat.aircraftType || '')) n.aircraftType = cur.nat.aircraftType;
        m[row.k].nat = n;
      }
    }
    b.dirty = true;
  }
  function boardPrune(b) {
    const lo = nowS() - BOARD_BACK, hi = nowS() + BOARD_AHEAD;
    for (const m of [b.arr, b.dep]) {
      for (const k of Object.keys(m)) if (!(m[k].t >= lo && m[k].t <= hi)) delete m[k];
      const ks = Object.keys(m); if (ks.length > BOARD_MAX) ks.sort((x, y) => m[x].t - m[y].t).slice(0, ks.length - BOARD_MAX).forEach(k => delete m[k]);
    }
  }
  // (a board read while the store had not opened yet: read again now that it has, what was added since kept - and never
  // written to disk before that, or it would write over what is there)
  async function boardFresh(apId) {
    let b = await boardLoad(apId);
    if (b.noDisk && store.mode() === 'idb') { const old = b; boardMem.delete(apId); b = await boardLoad(apId); for (const r of Object.values(old.arr)) boardMerge(b, 'arrivals', r, apId); for (const r of Object.values(old.dep)) boardMerge(b, 'departures', r, apId); }
    return b;
  }
  function boardSave(apId, b) { boardPrune(b); b.savedAt = now(); if (!b.noDisk) { store.setBoard(apId, { v: BOARD_V, at: now(), arr: b.arr, dep: b.dep, monSync: b.monSync || 0 }); b.dirty = false; } }
  // (while an airport fills up - Manchester has some 600 flight numbers - its board is written at most every 20 s and
  // sent to the page at most every 4 s, not every time a few rows come in)
  function boardSoon(apId, b) {
    const t = now();
    if (!b.saveT) b.saveT = setTimeout(() => { b.saveT = 0; boardSave(apId, b); }, Math.max(0, (b.savedAt || 0) + 20000 - t));
    if (boardAsked.has(apId) && t - boardAsked.get(apId) < 20 * 60000 && !b.sendT) b.sendT = setTimeout(() => { b.sendT = 0; b.sentAt = now(); boardSend(apId, b); }, Math.max(0, (b.sentAt || 0) + 4000 - t));
  }
  async function boardDrain() {
    const ids = [...boardPend.keys()];
    for (const apId of ids) {
      const rows = boardPend.get(apId); boardPend.delete(apId); if (!rows || !rows.length) continue;
      const b = await boardFresh(apId);
      for (const [kind, row] of rows) boardMerge(b, kind, row, apId);
      boardSoon(apId, b);
      await idleSlice();
    }
  }
  // (what goes to the page: one row per flight - FR24's own over a log's, matched by flight id, else by callsign or
  // registration and time)
  // (the airline of a flight number's prefix - U2 easyJet, FR Ryanair - as the board's own rows of it have it)
  const numPre = n => (/^([A-Z0-9]{2})\d{1,4}[A-Z]?$/.exec(String(n || '').toUpperCase()) || [])[1] || '';
  function boardPrefixes(rows) {
    const n = new Map();
    for (const r of rows) { const p = numPre(r.num), id = (r.nat && r.nat.airlineId) || r.alId; if (!p || !id || !(r.src === 'fr24' || r.src === 'sched')) continue; const c = n.get(p) || new Map(); c.set(id, (c.get(id) || 0) + 1); n.set(p, c); }
    const out = new Map(); for (const [p, c] of n) out.set(p, [...c].sort((a, b) => b[1] - a[1])[0][0]);
    return out;
  }
  // (what a flight seen flying adds to FR24's own row of it: the aircraft that flew it - its type over the one planned,
  // "A320" for the A319 G-EZBX that flew U281 - and, for a row still "Scheduled" or "Estimated", that it went: when)
  function takeActual(o, r) {
    for (const f of ['reg', 'hex', 'dsc', 'cs', 't2']) if (!o[f] && r[f]) o[f] = r[f];
    const ty = /^[A-Z][A-Z0-9]{2,3}$/.test(r.ty || '') && (r.src === 'log' || r.src === 'live') ? r.ty : '';
    if (ty) o.ty = ty;
    const went = /^(landed|departed)$/.test(r.st || '') && /^(scheduled|estimated|delayed|)$/.test(o.st || '') ? r.st : '';
    if (went) Object.assign(o, { st: went, est: r.t, t: r.t, col: delayCol(r.t, o.sch || r.t) });
    if (o.nat) {
      const n = Object.assign({}, o.nat);
      if (ty) n.aircraftType = ty;
      if (r.cs && n.flight && !n.flight.callsign) n.flight = Object.assign({}, n.flight, { callsign: r.cs });
      if (went && /^(scheduled|estimated|delayed)$/.test((n.status && n.status.name) || 'scheduled')) Object.assign(n, { estimatedTime: r.t, status: Object.assign({}, n.status, { name: went, color: delayCol(r.t, n.scheduledTime || r.t) }) });
      o.nat = n;
    }
  }
  // (a row that says the flight went: its status, or what FR24's own row of it says)
  const rowActual = r => /^(departed|landed)$/.test(r.st || (r.nat && r.nat.status && r.nat.status.name) || '');
  // (the airline FR24 lists under an id is the airline a row names - "Ryanair" and "Ryanair UK" are, "Ryanair" and
  // "Cranwell FTU" are not; no name, a private owner or military, or no list yet: nothing to contradict it)
  function alOk(id, name) {
    const k = nameKey(name); if (!id || !k || /^(privateowner|military)$/.test(k)) return true;
    const n = nameKey(fr24.airlineName(id)); return !n || n.startsWith(k) || k.startsWith(n);
  }
  // (one callsign to the same airport, one of the two not flown yet: within two hours by any of their times)
  const sameCsFlight = (x, r) => {
    const ap = (r.nat && r.nat.airportId) || r.ap || 0;
    if (x.act && rowActual(r)) return Math.abs(x.t - r.t) < 2700;
    if (!x.ap || !ap || x.ap !== ap) return false;
    return x.ts.some(a => [r.est, r.sch, r.t].some(b => b > 0 && Math.abs(a - b) < 7200));
  };
  function boardList(m, pre) {
    const rows = Object.values(m).sort((a, b) => (BOARD_RANK[b.src] || 0) - (BOARD_RANK[a.src] || 0) || (b.src === 'fr24') - (a.src === 'fr24')), out = [], byFid = new Map(), byWho = new Map(), byRoute = new Map(), byCs = new Map();
    const airlineOf = cs => { const c = /^([A-Z]{3})\d/.exec(String(cs || '').toUpperCase()); return (c && fr24.byIcao.get(c[1])) || 0; };
    for (let r of rows) {
      if (r.drop) continue;
      const who = [r.cs, r.reg && r.reg.replace(/-/g, ''), r.hex, r.num && 'N:' + r.num].filter(Boolean).map(s => String(s).toUpperCase());
      // (the same flight from a lesser source: what the row shown lacks - the other airport, FR24's flight id, the
      // aircraft - taken from it. G-PTRK's own FR24 row "N/A", its rebuilt track landed somewhere)
      let dup = (r.fid && byFid.get(r.fid)) || who.map(w => (byWho.get(w) || []).find(x => Math.abs(x.t - r.t) < 2700)).find(Boolean);
      // (or the same callsign to the same airport with its time moved: a flight not flown yet is planned again - FR24's own
      // row of CWL52 to Glasgow at 15:30 (estimated 15:40) and its schedule's at 16:15 (16:25), exactly 45 minutes apart,
      // were two rows. Two flights already flown are two flights, so those keep the 45 minutes)
      if (!dup && r.cs) dup = (byCs.get(String(r.cs).toUpperCase()) || []).find(x => sameCsFlight(x, r)) || null;
      // (or FR24's own row of an airline's flight that has no callsign - a number's list read before it flew: U281
      // Belfast -> Liverpool "Scheduled 14:40" beside the easyJet EZY89VK seen landing from Belfast at 14:42. The same
      // airline, from or to the same airport, within 45 minutes: the nearest one)
      if (!dup && (r.src === 'log' || r.src === 'live') && r.ap) {
        const al = airlineOf(r.cs), c = al ? byRoute.get(al + ':' + r.ap) : null;
        if (c) dup = c.filter(x => !x.took && Math.abs(x.t - r.t) < 2700).sort((x, y) => Math.abs(x.t - r.t) - Math.abs(y.t - r.t))[0] || null;
      }
      if (dup) {
        const o = out[dup.i];
        if (r.src === 'log' || r.src === 'live') { takeActual(o, r); dup.took = true; }
        for (const f of ['ap', 'fid', 'reg', 'hex', 'ty', 'dsc', 'al', 't2']) if (!o[f] && r[f]) o[f] = r[f];
        if (!o.alId && r.alId && alOk(r.alId, r.al)) o.alId = r.alId;
        if (o.nat && !o.nat.airportId && r.ap) o.nat = Object.assign({}, o.nat, { airportId: r.ap });
        // (and the operator - and its logo - FR24's own row of a club aircraft leaves out: G-RVRN, Ravenair)
        const rid = (alOk(r.alId, r.al) && r.alId) || airlineIdByName(r.al);
        if (o.nat && !o.nat.airlineId && rid) o.nat = Object.assign({}, o.nat, { airlineId: rid, airline: !o.nat.airline || /private owner/i.test(o.nat.airline) ? fr24.airlineName(rid) || r.al || o.nat.airline : o.nat.airline });
        continue;
      }
      r = Object.assign({}, r);
      // (a row of FR24's schedule with no airline of its own: an airline an older build gave it from the first airline's
      // flight on the airport's schedule - Jet2's logo on N358V's row - goes, and the type with it. A flight with no
      // number has no airline - a private or business flight, as FR24 draws it: no logo; a number keeps it only where the
      // board's own rows of that number's prefix have it)
      if (r.src === 'sched' && r.nat && !r.alId) {
        const pid = r.num ? (pre && pre.get(numPre(r.num))) || 0 : 0;
        if (r.nat.airlineId && (!r.num || !numPre(r.num) || (pid && pid !== r.nat.airlineId))) { r.nat = Object.assign({}, r.nat, { airlineId: null, airline: r.al || null }); r.alIcao = ''; }
        const ty = clean(r.ty).toUpperCase();
        if (!r.num && (r.nat.aircraftType || '') !== ty) r.nat = Object.assign({}, r.nat, { aircraftType: ty || null });
      }
      // (a row of a rebuilt flight - or of an aircraft's FR24 list - says what is known of the aircraft now: FR24's own
      // model and operator names, once read. Its operator for this flight: by this flight's callsign, never the one the
      // aircraft's record last had - G-NBCA, a PC-12 flying as GNBCA, came out with easyJet's logo)
      if (r.hex && (r.src === 'log' || r.src === 'live' || (r.src === 'sched' && !r.nat))) {
        const w = boardWho(r.hex, { reg: r.reg, type: r.ty, cs: r.cs || String(r.reg || '').replace(/-/g, '') });
        Object.assign(r, { dsc: w.dsc || r.dsc, ty: r.ty || w.ty, al: /^private owner$/i.test(w.al) ? r.al || w.al : w.al, alId: w.alId || 0 });
      }
      // (a flight's airline is its callsign's - EZY... easyJet - whatever the aircraft's record says: FR24's way. Rows
      // rebuilt from an aircraft's log took the aircraft's, and easyJet flights came out with Jet2's logo)
      const caId = r.src !== 'fr24' ? airlineOf(r.cs) : 0;
      if (caId) Object.assign(r, { alId: caId, al: fr24.airlineName(caId) || r.al });
      // (no airline id - FR24 gives none days ahead, or its airline list was not in yet when the row was read: no logo.
      // From the airline's ICAO code, else the number's prefix as the board's own rows have it - for a flight number only)
      if (!(r.nat ? r.nat.airlineId : r.alId)) {
        const id = (r.alIcao && fr24.byIcao.get(r.alIcao)) || (pre && r.num && r.num !== String(r.reg || '').replace(/-/g, '') && pre.get(numPre(r.num))) || (!r.nat && airlineIdByName(r.al)) || 0;
        if (id && r.nat) r.nat = Object.assign({}, r.nat, { airlineId: id, airline: r.nat.airline || fr24.airlineName(id) || null });
        else if (id) Object.assign(r, { alId: id, al: r.al || fr24.airlineName(id) });
      }
      // (an airline id that is not the airline named on the row - Cranwell FTU's flight with Ryanair's logo: the name
      // stands, and the logo is the one FR24 lists under it, or none. FR24's own board rows are as FR24 gave them)
      if (r.src !== 'fr24') {
        if (r.alId && !alOk(r.alId, r.al)) Object.assign(r, { alId: airlineIdByName(r.al) || 0 });
        if (r.nat && r.nat.airlineId && !alOk(r.nat.airlineId, r.al)) r.nat = Object.assign({}, r.nat, { airlineId: airlineIdByName(r.al) || null, airline: r.al || null });
      }
      if (r.nat && !r.nat.airportId && r.ap) r.nat = Object.assign({}, r.nat, { airportId: r.ap });
      if (!r.ty && !(r.nat && r.nat.aircraftType) && GLIDER.test(r.dsc || '')) r.ty = 'GLID';
      { const fc = fr24Cat({ type: r.ty || (r.nat && r.nat.aircraftType) || '', mil: !!(r.hex && (store.getHex(r.hex) || {}).mil) }); if (fc != null) r.fc = fc; }
      out.push(r);
      const ent = { t: r.t, i: out.length - 1, ts: [r.est, r.sch, r.t].filter(v => v > 0), act: rowActual(r), ap: (r.nat && r.nat.airportId) || r.ap || 0 }; if (r.fid) byFid.set(r.fid, ent); for (const w of who) (byWho.get(w) || byWho.set(w, []).get(w)).push(ent);
      if (r.cs) (byCs.get(String(r.cs).toUpperCase()) || byCs.set(String(r.cs).toUpperCase(), []).get(String(r.cs).toUpperCase())).push(ent);
      if (r.src === 'fr24' || r.src === 'sched') { const al = (r.nat && r.nat.airlineId) || r.alId, ap = (r.nat && r.nat.airportId) || r.ap; if (al && ap) (byRoute.get(al + ':' + ap) || byRoute.set(al + ':' + ap, []).get(al + ':' + ap)).push({ t: r.sch || r.t, i: out.length - 1 }); }
    }
    return out;
  }
  const boardTags = new Map();     // callsign / registration of a remembered row -> its aircraft's flags (the board tags)
  function boardSend(apId, b) {
    const pre = boardPrefixes(Object.values(b.arr).concat(Object.values(b.dep))), arr = boardList(b.arr, pre), dep = boardList(b.dep, pre);
    // (and a blocked aircraft's rows say so to the page: their Playback is the ADS-B track's - FR24 has none)
    for (const r of arr.concat(dep)) { const hx = r.hex && store.getHex(r.hex); if (!hx || !(hx.ladd || hx.fr24Blocked || hx.pia || hx.mil)) continue; const t = { hex: r.hex, ladd: !!(hx.ladd || hx.fr24Blocked), pia: !!hx.pia, mil: !!hx.mil }; if (t.ladd) r.blk = 1; for (const k of [r.cs, r.reg]) if (k) boardTags.set(String(k).toUpperCase(), t); }
    if (boardTags.size > 5000) for (const k of [...boardTags.keys()].slice(0, 1000)) boardTags.delete(k);
    postToPage('boardArch', { apId, arr, dep });
    if (now() - (boardAsked.get(apId) || 0) < 20 * 60000) { boardNaFill(arr); boardNaFill(dep); }
  }
  // Rows of an open board with no other airport ("N/A": a flight followed live that never said where it was going, FR24's
  // own row of a VFR flight) once it is over: the aircraft's day rebuilt from its ADS-B track - where it landed, where it
  // came from - in the background, one aircraft at a time; the rebuilt flight then stands in the row (GOGLP, GBOIL at
  // Blackpool). The aircraft: the row's own, FR24's flight id as its stream named it, or a callsign that is a registration.
  const naFillAsked = new Map(), naFillQ = []; let naFillBusy = false;
  const regsOfCs = cs => { cs = clean(cs).toUpperCase(); if (!/^[A-Z0-9]{4,7}$/.test(cs) || (/^[A-Z]{3}\d/.test(cs) && !/^N/.test(cs))) return []; if (/^N\d[0-9A-Z]{0,4}$/.test(cs)) return [cs]; return [1, 2].map(n => cs.slice(0, n) + '-' + cs.slice(n)).filter(r => r.length >= 5); };
  function hexOfRow(r) {
    if (r.hex) return r.hex;
    const fid = r.fid || (r.nat && r.nat.flight && r.nat.flight.id); if (fid && idHex.get(parseInt(fid, 16))) return idHex.get(parseInt(fid, 16));
    for (const reg of regsOfCs(r.cs || (r.nat && r.nat.flight && r.nat.flight.callsign))) { const hx = store.byReg(reg); if (hx && hx.hex) return hx.hex; }
    return '';
  }
  function boardNaFill(rows) {
    const t = nowS();
    for (const r of rows) {
      if ((r.nat ? r.nat.airportId : r.ap) || !(r.t < t - 1200) || t - r.t > BOARD_BACK) continue;
      const st = (r.nat && r.nat.status && r.nat.status.name) || r.st || ''; if (!/departed|landed/.test(st)) continue;
      const hex = hexOfRow(r), day = dayStr(r.t * 1000), k = hex + ':' + day;
      if (!/^[0-9a-f]{6}$/.test(hex) || now() - (naFillAsked.get(k) || 0) < 30 * 60000) continue;
      naFillAsked.set(k, now()); if (naFillAsked.size > 3000) naFillAsked.delete(naFillAsked.keys().next().value);
      const hx = store.getHex(hex) || {};
      naFillQ.push({ hex, today: day === dayStr(now()), reg: !hx.ladd ? (r.reg || hx.reg || regsOfCs(r.cs)[0] || '') : '' });
    }
    if (naFillBusy || !naFillQ.length) return;
    naFillBusy = true;
    (async () => {
      // (FR24's own list of the aircraft first, for one that is not blocked - it often knows: G-BOIL Blackpool - Barton;
      // then the track itself)
      try { while (naFillQ.length) { const j = naFillQ.shift(); if (j.reg) await fr24.flightsOf(j.reg, true).catch(() => null); await (j.today ? loadToday(j.hex, 120000) : loadHistory(j.hex, 3, null, { bg: true })).catch(() => null); } }
      finally { naFillBusy = false; }
    })();
  }
  // the page opened this airport's board: everything kept for it, now - with the monitor's flights of it in the same
  // answer (its logs of every blocked aircraft, from memory: a fraction of a second). Its blocked aircraft's rows were
  // "N/A" where they went or came from until a later answer brought them, and the list jumped as they came in.
  async function onNeedBoard(d) {
    const apId = Number(d.apId); if (!boardOk(apId)) return;
    boardAsked.set(apId, now());
    const monP = boardMonFill(apId).catch(e => log('board monitor', e));
    const b = await boardFresh(apId);
    await Promise.race([monP, sleep(1200)]);
    const rows = boardPend.get(apId); if (rows) { boardPend.delete(apId); for (const [kind, row] of rows) boardMerge(b, kind, row, apId); boardSave(apId, b); }
    boardSend(apId, b);
    // (the airline of each row is its callsign's: once FR24's airline list is in, the rows again)
    if (!fr24.airlines) fr24.loadAirlines().then(() => boardSend(apId, b)).catch(() => {});
    boardSchedFill(apId, b);
    { const ap = apById(apId); if (ap) monArea(ap.lat, ap.lon); }
    monP.then(() => boardInfoFill(apId)).catch(e => log('board monitor', e));
    // (FR24's schedule of the airport read here only when the monitor's is older than a quarter of an hour - its read, or
    // another browser's, is what every board has)
    monP.then(at => { if (!(at > nowS() - 900)) return boardFr24Fill(apId); }).catch(e => log('board schedule', e));
  }
  // FR24's own rows of a board as it served them (kept for when they have dropped off its free day)
  function onBoardRows(d) {
    const apId = Number(d.apId), kind = d.kind === 'departures' ? 'departures' : d.kind === 'arrivals' ? 'arrivals' : ''; if (!kind || !boardOk(apId)) return;
    for (const e of d.rows || []) {
      if (!e || !e.flight || !e.flight.id) continue;
      const t = Number(e.estimatedTime) || Number(e.scheduledTime) || 0;
      boardPut(apId, kind, { nat: Object.fromEntries(Object.entries(e).filter(([key]) => !/^__tl/.test(key))), k: 'f' + e.flight.id, src: 'fr24', id: Number(e.id) || 0, fid: String(e.flight.id), cs: clean(e.flight.callsign), num: clean(e.flight.number), t, sch: Number(e.scheduledTime) || 0, est: Number(e.estimatedTime) || 0, st: clean(e.status && e.status.name), col: clean(e.status && e.status.color), ap: Number(e.airportId) || 0, al: clean(e.airline), alId: Number(e.airlineId) || 0, ty: clean(e.aircraftType) });
    }
  }
  const boardWho = (hex, rec) => { const hx = Object.assign({}, hex ? store.getHex(hex) : null, rec || {}); return { reg: hx.reg || '', hex: hex || hx.hex || '', ty: hx.type || '', dsc: modelName(hx), al: shownOwner(hx, hx.cs) || (hx.mil ? 'Military' : 'Private owner'), alId: operatorIdOf(hx, hx.cs) }; };
  // A followed flight (blocked, or FR24's N/A): its departure once it is off, its arrival once it is down
  function boardNoteFlight(id, rec, route) {
    if (!rec || !route || !id) return;
    const fid = Number(id).toString(16), who = boardWho(rec.hex, rec), cs = csOfRec(rec) || rec.cs || '';
    const dep = route.atd || route.departedAt || 0, from = route.originId, to = route.destId;
    // (down where it took off: a flight only when its take-off was seen and it was up long enough - an airliner's taxi with
    // its transponder saying "airborne" is not one: EI-EVN "Liverpool -> Liverpool, landed 17:33")
    const light = /^(piston|heli|fighter)$/.test(ENGINE.classify({ hex: rec.hex || '', type: who.ty, reg: who.reg, cs }));
    if (route.landed && from && from === to && !(dep > 0 && route.ata - dep >= (light ? 300 : 900))) { for (const [ap, kind] of [[from, 'departures'], [to, 'arrivals']]) if (boardOk(ap)) boardPut(ap, kind, { k: 'f' + fid, src: 'live', t: route.ata || dep || nowS(), drop: true }); return; }
    if (!route.landed && route.groundAirportId) return;              // (on the ground, not off yet)
    // (down away from FR24's airports - a strip, a private site: the landing place learned there)
    const ds = route.landed && !boardOk(to) ? (to && apById(to)) || route.destSite : null;
    const site = ds && fin(ds.lat) ? learnSite(ds.lat, ds.lon, { heli: ENGINE.classify({ type: who.ty }) === 'heli' }) : 0;
    if (boardOk(from) && dep > 0 && route.originConf !== 'history') boardPut(from, 'departures', Object.assign({ k: 'f' + fid, src: 'live', drop: false, fid, cs, t: dep, sch: route.std || dep, est: dep, st: 'departed', col: 'green', ap: boardOk(to) && (route.landed || ['filed', 'confirmed', 'landed'].includes(route.destConf)) ? to : site, gc: route.landed ? 1 : 0, t2: route.landed && route.ata > dep ? route.ata : 0 }, who));
    if (boardOk(to) && route.landed && route.ata > 0) boardPut(to, 'arrivals', Object.assign({ k: 'f' + fid, src: 'live', drop: false, fid, cs, t: route.ata, sch: route.sta || route.ata, est: route.ata, st: 'landed', col: 'green', ap: boardOk(from) ? from : 0, gc: 1, t2: dep > 0 && dep < route.ata ? dep : 0 }, who));
  }
  // How a leg's end was seen, for fakeRow: 'ground' (on the ground there), 'low' (heard there below 3,000 ft, within
  // 15 km - not a landing guessed inside a hole in coverage, which is also 'low'), else how it was guessed
  function endSeen(e, gnd, la, lo, alt) {
    if (gnd || (e && e.conf === 'ground')) return 'ground';
    if (!e) return '';
    if (e.conf !== 'low') return e.conf || '';
    const a = apById(e.id);
    return a && fin(la) && fin(alt) && alt < 3000 && ENGINE.dist(la, lo, a.lat, a.lon) <= 15 ? 'low' : 'gap';
  }
  // An aircraft's rebuilt log: its flights of the last three days, at both ends
  function boardNoteLegs(hex, legs, rec) {
    if (!hex || !legs || !legs.length) return;
    const lo = nowS() - BOARD_BACK, who = boardWho(hex, rec || null), cls = ENGINE.classify({ hex, type: who.ty, reg: who.reg }), heli = cls === 'heli';
    // (the other end when it is no airport of FR24's - a strip it does not list, a field, a pad - and the aircraft was
    // seen down there: the landing place learned there, by name, not "N/A")
    const placeOf = (id, la, lo2) => { const a = id ? apById(id) : null; return a ? learnSite(a.lat, a.lon, { heli }) : learnSite(la, lo2, { heli }); };
    for (const l0 of legs) {
      if (!l0 || !(l0.tStart > lo)) continue;
      const off = l0.tOff || l0.tStart, k = 'h' + hex + ':' + Math.round(off / 600);
      // (a climb-out an older build - or the monitor's - gave a landing at the field below or ahead of it: no landing, and
      // the row it made there goes)
      let l = l0;
      if (ENGINE.climbedOut(l0, cls)) { const on0 = l0.tOn || l0.tEnd; if (boardOk(l0.to.id) && on0) boardPut(l0.to.id, 'arrivals', { k, src: 'log', t: on0, drop: true }); l = Object.assign({}, l0, { to: null, tOn: null, ended: false }); }
      const to = l.to && l.to.id;
      let from = l.from && l.from.id;
      // (no take-off seen, first heard within 10 km of where it landed: a local flight from there - not "N/A")
      const local = !from && !!to && fin(l.startLat) && (a => !!a && ENGINE.dist(l.startLat, l.startLon, a.lat, a.lon) < 10)(apById(to));
      if (local) from = to;
      // (back where it began without having flown - a taxi with the transponder saying "airborne", a take-off seen in two
      // pieces: no flight, and a row an older build kept of it goes)
      if (from && from === to && !ENGINE.localFlew(Object.assign({}, l, { from: { id: from }, to: { id: to } }), cls)) { if (boardOk(from)) { boardPut(from, 'departures', { k, src: 'log', t: off, drop: true }); boardPut(to, 'arrivals', { k, src: 'log', t: l.tOn || l.tEnd || off, drop: true }); } continue; }
      // (lost from view on the ground or low beside a field, and silent for 20 minutes since: down there - a light aircraft
      // landing below coverage, G-BOIL at -125 ft, 49 kt beside its strip, was "N/A" all evening)
      const quietLow = !l.ended && !!to && /^(ground|low)$/.test(l.to.conf || '') && nowS() - (l.tEnd || 0) > 1200;
      const landed = !!to && (!!l.ended || quietLow), on = landed ? (l.tOn || l.tEnd) : 0;
      // (an end not known at all: a landing place where it was last heard only when that was down low - a jet lost climbing
      // away or at cruise came down somewhere else, not at a "private site" under where it was lost)
      const downLow = /^(piston|heli|unknown)$/.test(cls) || l.how === 'ground' || l.how === 'touch' || (fin(l.endAlt) && l.endAlt < 1500);
      const toSite = !boardOk(to) && (to ? landed : !!l.ended && downLow) ? placeOf(to, l.endLat, l.endLon) : 0;
      const fromSite = !boardOk(from) && l.startedOnGround ? placeOf(from, l.startLat, l.startLon) : 0;
      // (an end only guessed from the climb or the descent - "near" - is a board's row only when the aircraft was heard
      // within 30 km of that airport: HZ-AR27, first heard at FL170 80 km out on Manchester's departure, was put on
      // Liverpool's board)
      const nearOk = (e, la, lo2) => !e || e.conf !== 'near' || (a => !!a && fin(la) && ENGINE.dist(la, lo2, a.lat, a.lon) <= 30)(apById(e.id));
      const fromOk = local || l.startedOnGround || (!!l.from && l.from.conf !== 'history' && nearOk(l.from, l.startLat, l.startLon));
      const toOk = (landed || !!toSite) && nearOk(l.to, l.endLat, l.endLon);
      if (boardOk(from) && fromOk) boardPut(from, 'departures', Object.assign({ k, src: 'log', drop: false, cs: l.cs || '', t: off, sch: off, est: off, st: 'departed', col: 'green', ap: toOk ? (boardOk(to) ? to : toSite) : 0, gc: toOk && landed && l.to.conf === 'ground' ? 1 : 0, t2: on > off ? on : l.tEnd > off ? l.tEnd : 0, oc: endSeen(local ? { id: to, conf: 'low' } : l.from, l.startedOnGround, l.startLat, l.startLon, l.startAlt), dc: endSeen(l.to, false, l.endLat, l.endLon, l.endAlt) }, who));
      // (a row an older build kept from such a guess goes: HZ-AR27's on Liverpool's board)
      else if (boardOk(from) && l.from && l.from.conf === 'near') boardPut(from, 'departures', { k, src: 'log', t: off, drop: true });
      if (boardOk(to) && toOk && on) boardPut(to, 'arrivals', Object.assign({ k, src: 'log', drop: false, cs: l.cs || '', t: on, sch: on, est: on, st: 'landed', col: 'green', ap: fromOk ? (boardOk(from) ? from : fromSite) : 0, gc: l.to.conf === 'ground' ? 1 : 0, t2: off < on ? off : 0, oc: endSeen(local ? { id: to, conf: 'low' } : l.from, l.startedOnGround, l.startLat, l.startLon, l.startAlt), dc: endSeen(l.to, false, l.endLat, l.endLon, l.endAlt) }, who));
      else if (boardOk(to) && landed && on && l.to.conf === 'near') boardPut(to, 'arrivals', { k, src: 'log', t: on, drop: true });
    }
  }
  // Scheduled flights: every flight number on an airport's board, as FR24's own list of that number gives it - a week
  // back with its actual times and aircraft, a week ahead as scheduled - both of its ends kept. That fills the days
  // before and after FR24's free day on every board the number touches. Asked once in six hours per number, in the
  // background lane (one every two seconds), while a board is open.
  // (which numbers were read when: kept across reloads, so a board opened again does not ask them all again)
  const fnAsked = new Map(), fnQueue = []; let fnBusy = 0, fnSaveT = 0;
  store.kvReady.then(() => { const o = store.kvGet('fnAsked1') || {}; for (const k of Object.keys(o)) if (now() - o[k] < 6 * 3600e3 && !fnAsked.has(k)) fnAsked.set(k, o[k]); }).catch(() => {});
  const fnSave = () => { if (!fnSaveT) fnSaveT = setTimeout(() => { fnSaveT = 0; const o = {}; for (const [k, t] of fnAsked) if (now() - t < 6 * 3600e3) o[k] = t; store.kvSet('fnAsked1', o); }, 5000); };
  const apOfCode = c => { c = c && c.code; const a = c && ((c.icao && ENGINE.byIcao(c.icao)) || (c.iata && airports.byIata.get(clean(c.iata).toUpperCase()))); return a && boardOk(a.id) ? a.id : 0; };
  // FR24's own board row (as its map board serves it) of a flight in its schedule / flight-number format - the two agree
  // field for field: row id, flight id, status, colour (on time to 16 minutes late green, to 45 yellow, later red), the
  // time it happened or is expected, the other airport, airline, type
  const delayCol = (a, s) => !(a && s) || a - s <= 960 ? 'green' : a - s <= 2700 ? 'yellow' : 'red';
  function natRowOf(x, kind, ref) {
    const idn = x.identification || {}, tm = x.time || {}, sc = tm.scheduled || {}, re = tm.real || {}, es = tm.estimated || {};
    const gen = (x.status && x.status.generic) || {}, gs = gen.status || {}, ev = gen.eventTime || {}, arr = kind === 'arrivals';
    const sch = arr ? sc.arrival : sc.departure; if (!sch) return null;
    let name, color, est;
    if (/cancel/.test(gs.text || '')) { name = 'canceled'; color = 'red'; est = sch; }
    else if (arr && /divert/.test(gs.text || '')) { name = 'diverted'; color = 'red'; est = ev.utc || sch; }
    // (an arrival in the air with no estimate of its own: its departure's delay carried over, as FR24 does)
    else if (arr) { const dd = sc.departure && re.departure ? re.departure - sc.departure : 0, r = re.arrival, e = r || es.arrival || (gs.type === 'arrival' ? ev.utc : 0) || (dd > 0 ? sch + dd : 0); est = e || sch; name = r ? 'landed' : !e ? 'scheduled' : delayCol(e, sch) === 'green' ? 'estimated' : 'delayed'; color = name === 'scheduled' ? 'gray' : delayCol(e, sch); }
    else { const r = re.departure, e = r || es.departure; est = e || sch; name = r ? 'departed' : e ? 'estimated' : 'scheduled'; color = name === 'scheduled' ? 'gray' : delayCol(e, sch); }
    const icao = clean(x.airline && x.airline.code && x.airline.code.icao).toUpperCase() || (ref && ref.icao) || '';
    let ty = clean(x.aircraft && x.aircraft.model && x.aircraft.model.code).toUpperCase();
    if (ref && ref.ty && (!ty || /^\d/.test(ty) || ty.length === 3)) ty = ref.ty;
    return { id: Number(idn.row) || 0, flight: { id: idn.id || null, number: (idn.number && idn.number.default) || null, callsign: idn.callsign || null }, status: { name, color, isAmbiguous: false, live: !!(x.status && x.status.live) },
      scheduledTime: sch, estimatedTime: est, airportId: apOfCode(x.airport && (arr ? x.airport.origin : x.airport.destination)) || null, divertedToId: null,
      airlineId: (icao && fr24.byIcao.get(icao)) || null, airline: (icao && fr24.byIcao.get(icao) && fr24.airlineName(fr24.byIcao.get(icao))) || (x.airline && (x.airline.short || x.airline.name)) || (ref && ref.al) || null, aircraftType: ty || null, runway: null };
  }
  function fnRows(data, info, apId, kind) {
    // (the number's airline and its ICAO type from its flights flown - or from the board's own rows of it. A flight
    // number's own list only: an airport's schedule (apId given) is every airline's flights and the private ones, each
    // with its own airline or none - read with the first airline's as theirs, every flight on East Midlands' schedule
    // with no airline had Jet2's logo: N358V, a Gulfstream in from Dusseldorf)
    const flown = apId ? null : (data || []).find(y => y && y.identification && y.identification.id && y.airline && y.airline.code && y.airline.code.icao);
    const fty = apId ? '' : (data || []).map(y => y && y.identification && y.identification.id && clean(y.aircraft && y.aircraft.model && y.aircraft.model.code).toUpperCase()).find(c => c && /^[A-Z]/.test(c) && c.length === 4);
    const ref = apId ? null : { icao: flown ? clean(flown.airline.code.icao).toUpperCase() : (info && info.alId && fr24.airlines && (fr24.airlines.get(info.alId) || {}).icao) || '', al: (flown && (flown.airline.short || flown.airline.name)) || (info && info.al) || '', ty: fty || (info && /^[A-Z]/.test(info.ty || '') && info.ty.length === 4 ? info.ty : '') };
    for (const x of data || []) {
      if (!x) continue;
      const idn = x.identification || {}, tm = x.time || {}, sc = tm.scheduled || {}, re = tm.real || {}, es = tm.estimated || {};
      // (an airport's own schedule leaves its own end out)
      const o = apOfCode(x.airport && x.airport.origin) || (kind === 'departures' ? apId : 0), d = apOfCode(x.airport && x.airport.destination) || (kind === 'arrivals' ? apId : 0);
      const fid = idn.id ? String(idn.id) : '', num = clean(idn.number && idn.number.default).toUpperCase(), cs = clean(idn.callsign).toUpperCase();
      const k = fid ? 'f' + fid : 'n' + num + ':' + (sc.departure || sc.arrival || 0);
      const stx = clean(((x.status || {}).generic || {}).status && x.status.generic.status.text).toLowerCase(), cx = /cancel/.test(stx), dv = /divert/.test(stx);
      const icao = clean(x.airline && x.airline.code && x.airline.code.icao).toUpperCase(), alId = (icao && fr24.byIcao.get(icao)) || (info && info.alId) || (ref && ref.icao && fr24.byIcao.get(ref.icao)) || 0;
      const base = { src: 'sched', fid, id: Number(idn.row) || 0, cs, num, al: clean(x.airline && x.airline.name) || (info && info.al) || '', alId, alIcao: icao || (ref && ref.icao) || '', ty: clean(x.aircraft && x.aircraft.model && x.aircraft.model.code) || (info && info.ty) || '', reg: clean(x.aircraft && x.aircraft.registration), hex: clean(x.aircraft && x.aircraft.hex).toLowerCase() };
      const dep = re.departure || es.departure || sc.departure, arr = re.arrival || es.arrival || sc.arrival;
      if (o && dep) boardPut(o, 'departures', Object.assign({ nat: natRowOf(x, 'departures', ref), k, t: dep, sch: sc.departure || dep, est: dep, st: cx ? 'canceled' : re.departure ? 'departed' : 'scheduled', col: cx ? 'red' : re.departure ? 'green' : 'gray', ap: d }, base));
      if (d && arr) boardPut(d, 'arrivals', Object.assign({ nat: natRowOf(x, 'arrivals', ref), k, t: arr, sch: sc.arrival || arr, est: arr, st: cx ? 'canceled' : dv ? 'diverted' : re.arrival ? 'landed' : es.arrival ? 'estimated' : 'scheduled', col: cx || dv ? 'red' : re.arrival || es.arrival ? 'green' : 'gray', ap: o }, base));
    }
  }
  // (two at a time: an airport like Manchester has some 600 numbers - its three days in about five minutes)
  async function pumpFn() {
    if (fnBusy >= 2) return; fnBusy++;
    if (fnBusy < 2 && fnQueue.length > 1) pumpFn().catch(() => {});
    try {
      while (fnQueue.length) {
        const job = fnQueue.shift(); if (!job || now() - (boardAsked.get(job.apId) || 0) > 30 * 60000) continue;   // (its board closed a while ago)
        fnAsked.set(job.num, now()); if (fnAsked.size > 5000) fnAsked.delete(fnAsked.keys().next().value); fnSave();
        try {
          const j = await fr24Api(`https://api.flightradar24.com/common/v1/flight/list.json?query=${encodeURIComponent(job.num)}&fetchBy=flight&page=1&limit=25`);
          fnRows(j && j.result && j.result.response && j.result.response.data, job.info);
        } catch (e) { fnAsked.set(job.num, now() - 5.5 * 3600e3); if (/429/.test(String(e))) await sleep(30000); }
      }
    } finally { fnBusy--; }
  }
  function boardSchedFill(apId, b) {
    const info = new Map();
    for (const m of [b.arr, b.dep, (boardPend.get(apId) || []).map(x => x[1])]) for (const r of Object.values(m)) if (r.num && /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(r.num) && (r.src === 'fr24' || r.src === 'sched')) { const i = info.get(r.num) || {}; if (r.al && !i.al) i.al = r.al; if (r.alId && !i.alId) i.alId = r.alId; if (r.ty && !i.ty) i.ty = r.ty; info.set(r.num, i); }
    for (const [num, i] of info) if (now() - (fnAsked.get(num) || 0) > 6 * 3600e3 && !fnQueue.some(q => q.num === num)) fnQueue.push({ num, apId, info: i });
    pumpFn().catch(e => log('board schedules', e));
  }
  // FR24's public API asked the way its own pages ask it: a plain request from this page, no cookies (the extension's
  // own requests can meet Cloudflare's check instead), one every 1.5 s; the extension's as the fallback
  let fr24ApiGate = Promise.resolve();
  function fr24Api(url) {
    const go = () => fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(e => /HTTP 4/.test(String(e)) ? Promise.reject(e) : gmRequest(url, { timeout: 12000, bg: true }));
    // (requests started 0.7 s apart, two may be in flight)
    const p = fr24ApiGate.then(go); fr24ApiGate = fr24ApiGate.then(() => sleep(700)); return p;
  }
  // FR24's own schedule of the airport: every page each way, both boards - once in ten minutes an airport
  const schedAsked = new Map();
  async function boardFr24Fill(apId) {
    const ap = apById(apId), code = ap && (ap.iata || ap.icao); if (!code || now() - (schedAsked.get(apId) || 0) < 10 * 60000) return;
    schedAsked.set(apId, now());
    for (const kind of ['arrivals', 'departures']) for (const dir of [1, -1]) for (let page = dir; Math.abs(page) <= 6; page += dir) {
      let s; try { const j = await fr24Api(`https://api.flightradar24.com/common/v1/airport.json?code=${encodeURIComponent(code.toLowerCase())}&plugin[]=schedule&plugin-setting[schedule][mode]=${kind}&page=${page}&limit=100`); s = j.result.response.airport.pluginData.schedule[kind]; } catch (e) { break; }
      fnRows((s && s.data || []).map(x => x && x.flight), null, apId, kind);
      if (!s || !s.page || Math.abs(page) >= s.page.total) break;
    }
    boardSchedFill(apId, await boardFresh(apId));   // (and the lists of the flight numbers just read, for the days beyond)
  }
  // FR24's own names (and FR24's own flights) of the aircraft of rebuilt rows not read yet: up to 40 a board, in the
  // background, once a week an aircraft
  let infoBusy = false;
  async function boardInfoFill(apId) {
    if (infoBusy) return; infoBusy = true;
    try {
      const b = await boardFresh(apId), regs = new Set();
      for (const r of Object.values(b.arr).concat(Object.values(b.dep))) { if (!r.reg || !r.hex || !(r.src === 'log' || r.src === 'live')) continue; const hx = store.getHex(r.hex) || {}; if (!hx.fr24Model && now() - (hx.fr24InfoAt || 0) > 7 * 86400e3) regs.add(r.reg); }
      for (const reg of [...regs].slice(0, 40)) {
        if (now() - (boardAsked.get(apId) || 0) > 15 * 60000) break;
        await fr24.flightsOf(reg, true).catch(() => null);
        const hx = store.byReg(reg); if (hx && hx.hex && !hx.fr24InfoAt) store.mergeHex(hx.hex, { fr24InfoAt: now() });
      }
      if (regs.size && boardAsked.has(apId)) boardSend(apId, await boardFresh(apId));
    } finally { infoBusy = false; }
  }
  // ---- FR24's airport routes page (/data/airports/<code>/routes) ---------------------------------------------------------
  // FR24 counts only the flights it can name: a blocked (LADD) aircraft's never appear ("No routes found" at Barrow, whose
  // BAE shuttles fly every day). Their flights of the last seven days - the monitor's, and this airport's kept rows -
  // counted by route, both ends FR24 airports, each flight once; the page adds them to FR24's own lists and map.
  const routesMem = new Map();   // apId -> { at, list } (the week's routes, worked out at most every two minutes)
  async function onNeedRoutes(d) {
    const apId = Number(d.apId); if (!boardOk(apId)) return;
    postToPage('routesAdd', { apId, list: await routesOf(apId) });
  }
  async function routesOf(apId) {
    const m = routesMem.get(apId); if (m && now() - m.at < 120000) return m.list;
    await loadAirports();
    const t1 = nowS(), t0 = t1 - 7 * 86400, seen = new Set(), pairs = new Map();
    const blocked = (hex, flag) => { const hx = store.getHex(hex) || {}; return !!(flag || hx.ladd || hx.fr24Blocked); };
    const nearOk = (e, la, lo) => !e || e.conf !== 'near' || (a => !!a && fin(la) && ENGINE.dist(la, lo, a.lat, a.lon) <= 30)(apById(e.id));
    const add = (hex, from, to, off, on) => {
      if (!boardOk(from) || !boardOk(to) || from === to || !((off || on) >= t0 && (off || on) <= t1)) return;
      const kd = off ? 'd' + hex + from + ':' + Math.round(off / 900) : '', ka = on ? 'a' + hex + to + ':' + Math.round(on / 900) : '';
      if ((kd && seen.has(kd)) || (ka && seen.has(ka))) return; if (kd) seen.add(kd); if (ka) seen.add(ka);
      const key = from + '-' + to, p = pairs.get(key) || { from, to, n: 0, mins: [], offs: [], ons: [] }; p.n++; if (off && on > off) p.mins.push((on - off) / 60); if (off) p.offs.push(off); if (on) p.ons.push(on); pairs.set(key, p);
    };
    const j = await monGet(`/board?ap=${apId}&from=${t0}&to=${t1}`).catch(() => null);
    for (const a of (j && j.aircraft) || []) {
      if (!blocked(a.hex, a.ladd)) continue;
      for (const l of a.legs || []) if (l.from && l.to && l.ended && (l.startedOnGround || nearOk(l.from, l.startLat, l.startLon)) && nearOk(l.to, l.endLat, l.endLon)) add(a.hex, l.from.id, l.to.id, l.tOff || l.tStart, l.tOn || l.tEnd);
    }
    const b = await boardFresh(apId);
    for (const r of Object.values(b.dep)) if (r.hex && (r.src === 'log' || r.src === 'live') && r.ap && blocked(r.hex)) add(r.hex, apId, r.ap, r.t, 0);
    for (const r of Object.values(b.arr)) if (r.hex && (r.src === 'log' || r.src === 'live') && r.ap && blocked(r.hex)) add(r.hex, r.ap, apId, 0, r.t);
    const apObj = id => { const a = apById(id); return a ? { id: a.id, name: a.name, city: a.city, iata: a.iata || null, icao: a.icao || null, countryId: a.countryId || 0, countryName: a.country || '', latitude: a.lat, longitude: a.lon, size: a.size || 0 } : null; };
    const list = [...pairs.values()].map(p => { const o = apObj(p.from), dd = apObj(p.to); return o && dd ? { from: o, to: dd, n: p.n, offs: p.offs, ons: p.ons, km: Math.round(ENGINE.dist(o.latitude, o.longitude, dd.latitude, dd.longitude)), min: p.mins.length ? Math.round(p.mins.reduce((s, x) => s + x, 0) / p.mins.length) : null } : null; }).filter(Boolean);
    routesMem.set(apId, { at: now(), list }); if (routesMem.size > 50) routesMem.delete(routesMem.keys().next().value);
    return list;
  }
  // The permanent monitor's flights at the airport, the last three days
  // (1.1.0) and every FR24 row of the board kept there - seven days each way: those changed since this browser's last answer
  // of it once it has had one - put in at once (the rows are merged and the board sent as soon as they are in). Returns when
  // FR24's data of the airport last came in there (0: never)
  async function boardMonFill(apId) {
    const b0 = await boardFresh(apId), t = Math.round(nowS()), since = b0.monSync || 0;
    const j = await monGet(`/board?ap=${apId}&from=${t - BOARD_BACK}&to=${t + BOARD_AHEAD}&rows=1${since ? '&since=' + (since - 120) : ''}`, { timeout: 30000 }).catch(() => null);
    for (const a of (j && j.aircraft) || []) { if (a.reg && !store.getHex(a.hex)) store.mergeHex(a.hex, { reg: a.reg, type: a.type, ladd: !!a.ladd }); boardNoteLegs(a.hex, a.legs, { reg: a.reg, type: a.type }); }
    const rows = j && j.rows;
    if (rows && typeof rows === 'object') {
      for (const kind of ['arrivals', 'departures']) for (const r of Array.isArray(rows[kind]) ? rows[kind] : []) if (r && (r.src === 'fr24' || r.src === 'sched')) boardPut(apId, kind, Object.assign({}, r, { fromMon: true }));
      // (the time of the monitor's answer: the next asks for what changed since - kept with the board; once its rows are in)
      if (fin(j.now)) { const at = j.now; boardDrain().then(() => boardFresh(apId)).then(b => { b.monSync = at; b.dirty = true; boardSoon(apId, b); }).catch(() => {}); }
    }
    return j && fin(j.fr24At) ? j.fr24At : 0;
  }
  // FR24's own schedule of an aircraft (its list.json, or the rows of its log page): flown and still to fly
  function boardNoteSched(hex, rows, rec) {
    if (!rows || !rows.length) return;
    const who = boardWho(hex, rec);
    for (const r of rows) {
      if (!r || !r.id) continue;
      const fid = Number(r.id).toString(16), cs = r.cs || '', num = r.num || '';
      if (boardOk(r.o) && (r.atd || r.std)) boardPut(r.o, 'departures', Object.assign({ k: 'f' + fid, src: 'sched', fid, cs, num, t: r.atd || r.std, sch: r.std || r.atd, est: r.atd || r.std, st: r.atd ? 'departed' : 'scheduled', col: r.atd ? 'green' : 'gray', ap: boardOk(r.d) ? r.d : 0 }, who));
      const arr = r.ata || r.eta || r.sta;
      if (boardOk(r.d) && arr) boardPut(r.d, 'arrivals', Object.assign({ k: 'f' + fid, src: 'sched', fid, cs, num, t: arr, sch: r.sta || arr, est: r.ata || r.eta || r.sta, st: r.ata ? 'landed' : r.eta ? 'estimated' : 'scheduled', col: r.ata || r.eta ? 'green' : 'gray', ap: boardOk(r.o) ? r.o : 0 }, who));
    }
  }
  // ---- FR24's airport data pages (/data/airports/<code>: general, arrivals, departures, routes, statistics) -------------
  // What this script knows of the airport goes into FR24's own page as its own: the flights of its boards (kept here, and
  // those the map tab follows right now - asked of it over the tabs' channel), the week's routes and movements of
  // blocked aircraft, and its runways (OurAirports: each end's length, elevation and surface - what FR24 shows its
  // subscribers). Sent as each part is ready: runways and kept rows at once, the live ones and the monitor's after.
  // (the flights this tab follows at an airport, as board rows - for another tab's airport page)
  function liveBoardRows(apId) {
    const out = [], t = nowS();
    const one = (id, rec) => {
      const st = routeState.get(id), r = (st && st.route) || rec.route; if (!r || !rec.hex) return;
      const f = pending.get(id), seen = f ? f.receivedAt : (rec.lastPos && rec.lastPos.at) || 0;
      if (!r.landed && now() - seen > 30 * 60000) return;
      if (r.landed && t - (r.ata || 0) > 6 * 3600) return;
      const fid = id.toString(16), base = Object.assign({ fid, cs: csOfRec(rec) || rec.cs || '', src: 'live', k: 'f' + fid }, boardWho(rec.hex, rec));
      const dep = r.atd || r.departedAt || 0, sure = ['filed', 'confirmed', 'landed'].includes(r.destConf) || r.landed;
      if (r.originId === apId && dep) out.push(Object.assign({ kind: 'departures', t: dep, sch: r.std || dep, est: dep, st: 'departed', col: 'green', ap: r.destId || 0, pred: !sure }, base));
      const arr = r.landed ? r.ata : r.eta;
      if (r.destId === apId && arr) out.push(Object.assign({ kind: 'arrivals', t: arr, sch: r.sta || arr, est: arr, st: r.landed ? 'landed' : 'estimated', col: sure ? 'green' : 'yellow', ap: r.originId || 0, pred: !sure }, base));
      if (r.groundAirportId === apId) out.push(Object.assign({ kind: 'onGround', t: r.ata || dep || t, ap: r.originId || 0 }, base));
    };
    for (const [id, rec] of live) if (id > 0) one(id, rec);
    for (const [id, p] of pubRecs) if (pubRouted(id)) one(id, p);
    return out;
  }
  // (asked of the other tabs: each with flights in hand answers at once)
  const askWait = new Map();
  function askLiveBoard(apId, ms) {
    if (!routeChan) return Promise.resolve([]);
    const rid = Math.random().toString(36).slice(2), got = [];
    return new Promise(res => { askWait.set(rid, rows => { for (const r of rows || []) got.push(r); }); routeChan.postMessage({ askBoard: apId, rid }); setTimeout(() => { askWait.delete(rid); res(got); }, ms); });
  }
  function onBoardChannel(d) {
    if (d.askBoard && live.size) { try { routeChan.postMessage({ boardRows: d.askBoard, rid: d.rid, rows: liveBoardRows(Number(d.askBoard)) }); } catch (e) { log('board rows', e); } }
    if (d.boardRows && askWait.has(d.rid)) askWait.get(d.rid)(d.rows);
  }
  // a board row as FR24's airport pages list a flight
  const airlineUrl = a => [a.iata, a.icao].filter(Boolean).join('-').toLowerCase();
  function dataItem(r, kind) {
    const o = r.ap ? apById(r.ap) : null, al = r.alId && fr24.airlines ? fr24.airlines.get(Number(r.alId)) : null;
    return { id: 'tl-' + (r.fid || r.k), scheduledTime: r.sch || r.t, estimatedTime: kind === 'onGround' || r.st === 'scheduled' ? null : (r.est || r.t), flightNumber: r.num || (r.cs && r.cs !== String(r.reg || '').replace(/-/g, '') ? r.cs : null), callsign: r.cs || null, flightId: r.fid && /^[0-9a-f]+$/i.test(r.fid) ? r.fid : null,
      status: kind === 'onGround' ? null : { name: r.st || (kind === 'arrivals' ? 'landed' : 'departed'), color: r.col || 'green', divertedTo: null },
      endpoint: o ? { name: o.name, city: o.city || o.name, iata: o.iata || null, icao: o.icao || null, countryId: o.countryId || 0, countryName: o.country || '' } : null,
      // (always an object: FR24's board reads airline.name / .id unguarded - null there takes the whole page down)
      airline: al ? { id: al.id, name: al.name, url: airlineUrl(al), iata: al.iata || null } : { id: null, name: r.al && !/^private owner$/i.test(r.al) ? r.al : null, url: null, iata: null },
      aircraft: { type: r.ty || null, registration: r.reg || null, typeUrl: r.ty ? r.ty.toLowerCase() : null }, gate: null, runway: null, locked: { runway: false }, codeshares: [], __tl: true, __tlPred: !!r.pred };
  }
  // ---- runways (OurAirports runways.csv, public domain): every end of every open runway of FR24's airports - name, length,
  // the end's elevation, the surface as FR24's codes have it. Read once and kept (three months).
  const RWY_SURF = [[/^(ASP|ASF|ASPH|ASPHALT|PEM|AS$)/i, 'ASPH'], [/^(BIT|BITU|BITUMINOUS|MAC|MACADAM|SEALED)/i, 'BITU'], [/^(CON|CONC|CONCRETE|CEM)/i, 'CONC'], [/^(TARM|TAR)/i, 'TARM'], [/^(GRS|GRASS|GRE|GRAS)/i, 'GRAS'], [/^(TURF)/i, 'TURF'], [/^(GVL|GRV|GRAV|GRAVEL)/i, 'GRVL'], [/^(DIRT|EARTH|SOIL|DRT)/i, 'DIRT'], [/^(SAND|SND)/i, 'SAND'], [/^(CLA|CLAY)/i, 'CLAY'], [/^(WAT|WATER)/i, 'WATE'], [/^(SNOW)/i, 'SNOW'], [/^(ICE)/i, 'ICE'], [/^(MAT|PSP|PIERCED|ALUM)/i, 'MATS'], [/^(LAT|LATERITE)/i, 'LATE'], [/^(COR|CORAL)/i, 'CORL'], [/^(UNPAVED|UNP)/i, 'UNPV'], [/^(PAVED|PAV|PER|PERM)/i, 'ASPH']];
  const surfCode = s => { s = clean(s); for (const [re, c] of RWY_SURF) if (re.test(s)) return c; return 'UNKN'; };
  let rwyInfo = null, rwyInfoLoading = null;
  function parseRunwayEnds(csv, keep) {
    const out = {}, lines = String(csv || '').split('\n'), col = {}; (lines[0] || '').split(',').forEach((h, i) => { col[h.replace(/"/g, '').trim()] = i; });
    const num = v => { const x = parseFloat(v); return isFinite(x) ? Math.round(x) : null; };
    for (let i = 1; i < lines.length; i++) {
      const f = ENGINE.csvLine(lines[i]); if (f.length < 19) continue;
      const icao = (f[col.airport_ident] || '').toUpperCase(); if (!icao || (keep && !keep(icao)) || f[col.closed] === '1') continue;
      const len = num(f[col.length_ft]), surf = surfCode(f[col.surface]);
      for (const [id, el] of [[f[col.le_ident], f[col.le_elevation_ft]], [f[col.he_ident], f[col.he_elevation_ft]]]) if (id && !/^H/i.test(id)) (out[icao] = out[icao] || []).push([id.toUpperCase(), len, num(el), surf]);
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => (parseInt(a[0], 10) || 99) - (parseInt(b[0], 10) || 99) || a[0].localeCompare(b[0]));
    return out;
  }
  function loadRunwayEnds() {
    if (rwyInfo) return Promise.resolve(rwyInfo);
    if (!rwyInfoLoading) rwyInfoLoading = (async () => {
      const c = await store.getHist('b:rwyends1');
      if (c && c.map && now() - (c.at || 0) < 90 * 864e5) { rwyInfo = c.map; return rwyInfo; }
      await loadAirports();
      const csv = await gmRequest(RWY_URL, { timeout: 60000, json: false, accept: 'text/csv,text/plain' });
      const icaos = new Set(airports.list.map(a => String(a.icao || '').toUpperCase()).filter(Boolean));
      const map = parseRunwayEnds(csv, k => icaos.has(k));
      if (Object.keys(map).length > 1000) { store.setHist('b:rwyends1', { at: now(), map }); rwyInfo = map; }
      return rwyInfo || (c && c.map) || {};
    })().catch(e => { log('runway details', String(e.message || e)); rwyInfoLoading = null; return {}; });
    return rwyInfoLoading;
  }
  // an airport's runway ends as FR24's pages list them: { name, lengthFt, elevationFt, surface } (the end's own elevation,
  // else the airport's)
  async function runwaysOf(ap) {
    if (!ap || !ap.icao) return [];
    const m = await loadRunwayEnds(), ends = m[String(ap.icao).toUpperCase()] || [];
    return ends.filter(e => e[1] > 0).map(e => ({ name: e[0], lengthFt: e[1], elevationFt: e[2] != null ? e[2] : Math.round(ap.alt || 0), surface: e[3] }));
  }
  // The map's airport panel - what FR24 locks or leaves out there: from the monitor, the airport's runways in full (each
  // end's heading, elevation, displaced threshold; width, lighting) and radio frequencies, and the runways the flights it
  // tracked there used; from this browser, the week's blocked flights for the movements per day (FR24's own counts are
  // the page's). Without the monitor: the runway ends this browser reads from OurAirports itself.
  const panelAsked = new Map();
  async function onNeedAirportPanel(d) {
    const code = clean(d.code).toUpperCase(); if (!/^[A-Z0-9]{3,4}$/.test(code)) return;
    if (now() - (panelAsked.get(code) || 0) < 60000) return; panelAsked.set(code, now());
    await loadAirports();
    const ap = (code.length === 4 && ENGINE.byIcao(code)) || airports.byIata.get(code); if (!ap || !boardOk(ap.id)) return;
    const full = apById(ap.id) || ap, out = { code, apId: ap.id, tz: (full.timezone && full.timezone.name) || '', days: 7, runways: null, freqs: null, usage: null, moves: 0, withRunway: 0, monitor: false, daily: null, allDays: 0 };
    routesOf(ap.id).then(list => postToPage('routesAdd', { apId: ap.id, list })).catch(e => log('routes', e));
    // (1.0.2) and every one of the last two weeks' take-offs and landings there - every aircraft public ADS-B heard, counted
    // by the monitor as each day's world log is built (daily)
    // (asked whether or not the monitor's check has answered yet - monGet waits for it: an airport opened as the page
    // loaded said "the monitor is not connected"; and asked again once should the first not answer)
    const ask = () => monGet(`/airport?ap=${ap.id}&days=7&hist=14`, { timeout: 15000 }).catch(() => null);
    let j = await ask(); if (!(j && j.known) && monUp()) j = await sleep(1500).then(ask);
    if (!(j && j.known)) panelAsked.set(code, now() - 45000);   // (another try within a quarter of a minute)
    if (j && j.known) Object.assign(out, { runways: Array.isArray(j.runways) ? j.runways : [], freqs: Array.isArray(j.freqs) ? j.freqs : [], usage: Array.isArray(j.usage) ? j.usage : [], moves: j.moves || 0, withRunway: j.withRunway || 0, monitor: true, daily: Array.isArray(j.daily) ? j.daily : null, allDays: j.allDays || 0 });
    else out.ends = await runwaysOf(ap).catch(() => []);
    postToPage('airportPanel', out);
  }
  async function onNeedAirportData(d) {
    const apId = Number(d.apId); if (!boardOk(apId)) return;
    await loadAirports();
    const ap = apById(apId), kinds = d.kinds || [];
    if (kinds.includes('runways')) runwaysOf(ap).then(rw => postToPage('airportData', { apId, runways: rw })).catch(() => {});
    if (kinds.includes('routes')) routesOf(apId).then(list => postToPage('routesAdd', { apId, list })).catch(e => log('routes', e));
    if (!kinds.includes('board')) return;
    // the airport's kept rows (three days each way), then the flights the map tab follows now
    if (!fr24.airlines) await fr24.loadAirlines().catch(() => {});
    const b = await boardFresh(apId), pre = boardPrefixes(Object.values(b.arr).concat(Object.values(b.dep)));
    const send = liveRows => {
      const kept = m => boardList(m, pre).filter(r => r.src !== 'fr24' && r.src !== 'sched');
      const merge = (list, kind) => { const out = new Map(list.map(r => [r.fid || r.k, r])); for (const r of liveRows) if (r.kind === kind) out.set(r.fid || r.k, r); return [...out.values()]; };
      postToPage('airportData', { apId, board: { arrivals: merge(kept(b.arr), 'arrivals').map(r => dataItem(r, 'arrivals')), departures: merge(kept(b.dep), 'departures').map(r => dataItem(r, 'departures')), onGround: liveRows.filter(r => r.kind === 'onGround').map(r => dataItem(r, 'onGround')) } });
    };
    send(liveBoardRows(apId));
    send(liveBoardRows(apId).concat(await askLiveBoard(apId, 400)));
  }
