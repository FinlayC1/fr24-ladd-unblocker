
  // ---- aircraft page (/data/aircraft/<reg>): the flight log FR24 hides, rebuilt in FR24's own markup ------------------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtLocal(ts, offset, withDate) {
    if (!(ts > 0)) return '—';
    const d = new Date((ts + (fin(offset) ? offset : 0)) * 1000);
    if (withDate) return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;   // (FR24's "02 Oct 2026")
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  const durStr = s => s > 0 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : '—';
  const tzOf = a => a && fin(a.tz) ? a.tz : 0;
  // (a landing or take-off away from any airfield - a helicopter's pad, a farm strip FR24 and OurAirports do not list)
  const SITE_CELLS = { mob: ' Private Site ', desk: ' Private Site', title: 'Away from any listed airfield' };
  // landed away from every airfield: seen down on the ground there (or as good as)
  const landedOff = l => !!l && !l.to && l.ended && (l.how === 'ground' || l.how === 'touch' || l.how === 'final' || (l.how === 'gap-low' && l.endAlt != null && l.endAlt < 1500));
  // a live flight's destination good enough to show where FR24 has none: confirmed / filed, or 60% and more
  const goodPrediction = lv => !!lv && !!lv.destId && (['confirmed', 'filed', 'landed'].includes(lv.destConf) || (lv.destP || 0) >= 60);
  function apCells(a, conf, pct) {
    if (!a) return { mob: ' <span class="text-gray">—</span> ', desk: ' —', title: '' };
    const code = esc((a.iata || a.icao).toLowerCase()), CODE = esc(a.iata || a.icao), city = esc(a.city || a.name);
    const q = conf === 'pred' ? `<span class="tl-inf" title="predicted destination${pct ? ' (' + pct + '%)' : ''}">?</span>` : conf === 'near' || conf === 'chain' ? `<span class="tl-inf" title="${conf === 'chain' ? 'inferred from the neighbouring flight (no coverage at this end)' : 'inferred from a nearby low pass'}">?</span>` : '';
    // (an airfield FR24 does not list has no page there: its OurAirports page)
    const link = a.field ? `href="https://ourairports.com/airports/${encodeURIComponent(a.icao)}/" target="_blank" rel="noopener noreferrer"` : `href="/data/airports/${code}" target="_self"`;
    return { mob: ` ${city} <a ${link} class="fbold">(${CODE}) </a>${q} `, desk: ` ${city} <a ${link} class="fs-10 fbold">(${CODE})</a>${q}`, title: esc(`${a.name}${a.field ? ' (airfield not in FR24\'s list)' : ''}, ${a.country}`) };
  }
  // one row, exactly as FR24 renders its own (responsive block for phones + the desktop cells)
  function logRowHtml(o) {
    const { t0, tz, tzTo, flight, dur, stdTs, atdTs, staTs, color, statusPrefix, statusTs, statusText, from, to, btn } = o;
    const estT = o.estTitle ? ` title="${esc(o.estTitle)}"` : '';
    const td = (ts, off) => `data-timestamp="${ts || ''}" data-offset="${ts ? off : ''}"`;
    return `<tr class=" data-row tl-adsb-row${o.cls ? ' ' + o.cls : ''}" data-timestamp="${t0}"><td class="visible-xs visible-sm"><div class="row table-row-responsive"><div class="col-xs-3"><div class="row"><i class="fa fa-plane"></i> ${o.flightMob || flight} </div><div class="row" data-offset="${tz}" data-timestamp="${t0}" data-time-format="DD MMM YYYY" data-prefix="&lt;i class=&quot;fa fa-calendar&quot;&gt;&lt;/i&gt; "><i class="fa fa-calendar"></i> ${fmtLocal(t0, tz, true)}</div><div class="row"><i class="fa fa-clock-o"></i> ${dur} </div><div class="row" ${td(statusTs, tzTo)} data-prefix="${esc(statusPrefix)}">${esc(statusText)}</div></div><div class="col-xs-1 col-state"><div class="state-block ${color}"></div></div><div class="col-xs-8"><div class="row"><div class="col-xs-4"><p><label>STD</label> <span class="details" ${td(stdTs, tz)}>${stdTs ? fmtLocal(stdTs, tz) : ' — '}</span></p></div><div class="col-xs-4"><p><label>ATD</label> <span class="details" ${td(atdTs, tz)}>${atdTs ? fmtLocal(atdTs, tz) : ' — '}</span></p></div><div class="col-xs-4"><p><label>STA</label> <span class="details" ${td(staTs, tzTo)}>${staTs ? fmtLocal(staTs, tzTo) : ' — '}</span> </p></div></div><p><label>FROM</label> <span class="details">${from.mob}</span></p><p><label>TO</label> <span class="details">${to.mob}</span></p></div></div></td><td class="w40 hidden-xs hidden-sm">&nbsp;</td><td class="hidden-xs hidden-sm" data-offset="${tz}" data-timestamp="${t0}" data-time-format="DD MMM YYYY">${fmtLocal(t0, tz, true)}</td> <td title="${from.title}" class="text-center-sm hidden-xs hidden-sm">${from.desk}</td> <td title="${to.title}" class="text-center-sm hidden-xs hidden-sm">${to.desk}</td> <td class="hidden-xs hidden-sm"> ${flight} </td><td class="hidden-xs hidden-sm">${dur}</td><td class="hidden-xs hidden-sm" ${td(stdTs, tz)}>${stdTs ? fmtLocal(stdTs, tz) : ' — '}</td><td class="hidden-xs hidden-sm" ${td(atdTs, tz)}${o.atdEst ? estT : ''}>${atdTs ? (o.atdEst ? '~' : '') + fmtLocal(atdTs, tz) : ' — '}</td> <td class="hidden-xs hidden-sm" ${td(staTs, tzTo)}>${staTs ? fmtLocal(staTs, tzTo) : ' — '}</td> <td class="hidden-xs hidden-sm"><div class="state-block ${color}"></div></td><td class="hidden-xs hidden-sm" data-prefix="${esc(statusPrefix)}" ${td(statusTs, tzTo)}${o.onEst ? estT : ''}>${esc(statusText)}</td><td class="text-right hidden-xs hidden-sm"> ${btn} </td><td class="w40 hidden-xs hidden-sm">&nbsp;</td></tr>`;
  }
  // replay of one leg's ADS-B track on airplanes.live (FR24's playback has no data for these flights): the day of its
  // take-off, whole - no startTime / endTime, which airplanes.live keeps for every other day it is moved to (page.js
  // pbTraceUrl)
  function replayUrl(hex, l) {
    return `https://globe.airplanes.live/?icao=${encodeURIComponent(hex)}&showTrace=${new Date(l.tStart * 1000).toISOString().slice(0, 10)}`;
  }
  // (ac: the aircraft, for a flight number's page - its column there is the aircraft, not the flight)
  function legRowHtml(l, hex, reg, ac) {
    const from = l.from ? apById(l.from.id) : null, to = l.to ? apById(l.to.id) : null;
    const tz = tzOf(from) || tzOf(to), tzTo = to ? tzOf(to) : tz;
    // (landed: seen down, or a field known and not heard of for an hour since. Times: take-off and touchdown - heard,
    // or reckoned from the nearest point heard and shown "~" when more than three minutes of it were not)
    const siteTo = pageLight && !to && landedOff(l), siteFrom = pageLight && !from && !!l.startedOnGround;
    const landed = (!!to && (l.ended || nowS() - l.tEnd > 3600)) || siteTo;
    const tOn = landed ? (l.tOn || (l.ended ? l.tEnd : 0)) : 0, onEst = !!tOn && (l.tOn ? !!l.tOnEst : !l.ended);
    const tOff = l.tOff || l.tStart, offEst = !!l.tOff && !!l.tOffEst, flown = tOn && tOff && tOn > tOff ? tOn - tOff : 0;
    const trace = esc(replayUrl(hex, l));
    const cs = l.cs && l.cs !== reg ? l.cs : (l.cs || '');
    const acDesk = ac && ac.reg ? ` ${esc(ac.type || '')} <a class="fbold fs-10" href="/data/aircraft/${esc(ac.reg.toLowerCase())}" title="${esc(ac.desc || ac.type || '')}">(${esc(ac.reg)})</a> ` : '';
    const acMob = ac && ac.reg ? `<a class="fbold" href="/data/aircraft/${esc(ac.reg.toLowerCase())}" title="${esc(ac.desc || ac.type || '')}">${esc(ac.reg)}</a>` : '';
    return logRowHtml({ t0: l.tStart, tz, tzTo, flight: ac ? acDesk || '—' : cs ? `(${esc(cs)})` : '—', flightMob: ac ? acMob || '—' : '', dur: (flown ? (onEst || offEst ? '~' : '') + durStr(flown) : '—') + (l.laps > 1 ? ` · ${l.laps} laps` : ''),
      stdTs: 0, atdTs: tOff, staTs: 0, color: landed ? 'green' : 'gray', atdEst: offEst, onEst, estTitle: 'reckoned from the nearest position heard (no receiver heard this part)',
      statusPrefix: landed && tOn ? (onEst ? 'Landed ~' : 'Landed ') : '', statusTs: tOn || 0, statusText: landed ? (tOn ? `Landed ${onEst ? '~' : ''}${fmtLocal(tOn, tzTo)}` : 'Landed · time unknown') : (l.ended ? 'Landed (airport unknown)' : 'Unknown'),
      from: siteFrom ? SITE_CELLS : apCells(from, l.from && l.from.conf), to: siteTo ? SITE_CELLS : apCells(to, l.to && l.to.conf),
      // not FR24's "btn-playback" class: its page script hijacks those buttons to open its own (empty) playback
      btn: `<a class="btn btn-sm tl-play btn-table-action text-white bkg-blue fs-10" href="${trace}" target="_blank" rel="noopener noreferrer" title="Replay this flight's ADS-B track (airplanes.live)"><i class="fa fa-play text-white fs-10"></i> &nbsp;Play </a>` });
  }
  function liveRowHtml(lv, hex, reg) {
    const from = apById(lv.originId), to = apById(lv.destId);
    const tz = tzOf(from) || tzOf(to), tzTo = to ? tzOf(to) : tz;
    const sure = ['filed', 'confirmed', 'likely'].includes(lv.destConf);
    const toCells = apCells(to, sure ? '' : 'near'); if (to && !sure) toCells.desk = toCells.desk.replace(/<span class="tl-inf"[^>]*>\?<\/span>/, `<span class="tl-inf" title="predicted destination (${lv.destP || '?'}%)">?</span>`);
    const href = lv.fr24Id ? `/${esc(lv.cs || reg)}/${lv.fr24Id.toString(16)}` : `https://globe.airplanes.live/?icao=${esc(hex)}`;
    return logRowHtml({ cls: 'tl-live-row', t0: lv.departedAt || nowS(), tz, tzTo, flight: lv.cs ? `(${esc(lv.cs)})` : '—', dur: lv.departedAt ? durStr(nowS() - lv.departedAt) : '—',
      stdTs: 0, atdTs: lv.departedAt || 0, staTs: lv.eta || 0, color: 'green',
      statusPrefix: 'Estimated arrival ', statusTs: lv.eta || 0, statusText: lv.eta ? `Estimated arrival ${fmtLocal(lv.eta, tzTo)}` : 'Live',
      from: apCells(from, lv.originConf === 'climb' || lv.originConf === 'history' ? 'near' : ''), to: toCells,
      btn: `<a class="btn btn-sm tl-live btn-table-action text-white bkg-blue fs-10" href="${href}" ${lv.fr24Id ? '' : 'target="_blank" rel="noopener noreferrer"'} title="Show the live flight"><i class="fa fa-plane text-white fs-10"></i> &nbsp;Live </a>` });
  }
  // FR24 lists this aircraft's flights itself, but has no airport where it used a field FR24 does not know ("—": N87VS
  // into Woodvale, 1 Oct): those ends are filled in from its ADS-B track, in FR24's own markup - matched by take-off time
  // (FR24's ATD), never over an airport FR24 does show - and a flight FR24 still calls "Scheduled" or "Unknown" that has
  // landed gets its landing time and duration.
  const fr24Flights = new Map();   // FR24 flight id (hex) -> { from, to } cells as filled, for its playback panel
  // Where FR24's own track of a flight began and ended (its playback - what a free account can open): for a row it
  // marks "Landed" whose ends ADS-B could not name. M-SKTO into a field in Wales, 1 Oct: adsb.lol lost it at 1,875 ft,
  // FR24 has it down to the ground. Asked once per flight, while the page is open.
  const fr24EndCells = new Map(), fr24EndAsked = new Set();
  let fr24Refill = null, pageHeli = false, pageLight = false;   // (light: a helicopter or a piston - the only ones that land away from airports)
  function fr24TrackEnds(fid, ts) {
    return gmRequest(`https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${encodeURIComponent(fid)}&timestamp=${ts}`, { timeout: 15000 }).then(j => {
      const d = j && j.result && j.result.response && j.result.response.data && j.result.response.data.flight, tr = d && d.track;
      if (!Array.isArray(tr) || !tr.length) return null;
      const pt = p => ({ lat: p.latitude, lon: p.longitude, alt: p.altitude ? p.altitude.feet : null, gs: p.speed ? p.speed.kts : null, t: p.timestamp });
      return { start: pt(tr[0]), end: pt(tr[tr.length - 1]) };
    }).catch(() => null);
  }
  // a point of a track: the airport or field it is at, or - on the ground away from all of them - a private site
  function placeCells(p) {
    if (!p || !fin(p.lat) || !fin(p.lon)) return null;
    // (a helicopter FR24 has down - or lifting off - at field level within 2 km of a strip is at that strip: G-DGFD's
    // track ends 1.4 km from Enstone's reference point, by its hangars)
    const n = pageHeli ? ENGINE.heliAirportAt(p.lat, p.lon) || ENGINE.fieldAt(p.lat, p.lon, 2, { alt: p.alt, maxAgl: 600 }) : ENGINE.placeAt(p.lat, p.lon, 7, 2);
    if (n && n.airport) return Object.assign(apCells(n.airport, ''), { a: n.airport });
    // (FR24 itself says the flight landed: its track ending - or beginning - low, away from every field, is a site)
    return pageLight && (p.alt == null || p.alt < 1000) && (p.gs == null || p.gs < 120) ? SITE_CELLS : null;
  }
  function fillFr24Rows(tbody, hex, lv) {
    const legs = knownLegs(hex).filter(l => l.from || l.to || l.startedOnGround || landedOff(l));
    if (!legs.length && !lv) return 0;
    const dash = el => !!el && /^\s*(—|-|N\/A)?\s*$/.test(el.textContent || '');
    // (one of ours that a better answer may still replace: a private site, an inferred airport)
    const weak = el => !!el && el.classList.contains('tl-filled') && Number(el.dataset.tlRank || 0) < 3;
    let n = 0;
    for (const tr of tbody.querySelectorAll('tr.data-row:not(.tl-adsb-row):not(.tl-live-row)')) {
      const c = tr.children; if (c.length < 12) continue;
      const fromTd = c[3], toTd = c[4], durTd = c[6], atdTd = c[8], stateTd = c[10], statusTd = c[11];
      if (!dash(fromTd) && !dash(toTd) && !weak(fromTd) && !weak(toTd) && !/^\s*(Scheduled|Unknown)\b/i.test(statusTd.textContent || '')) continue;
      const atd = Number(atdTd.dataset.timestamp) || Number(tr.dataset.timestamp) || 0; if (!atd) continue;
      let l = null, bd = 900; for (const x of legs) { const d = Math.abs((x.tOff || x.tStart) - atd); if (d < bd) { bd = d; l = x; } }
      // (the flight in the air now: its row is FR24's latest, taking off when the live state says it did)
      const isLive = !!lv && (!l || !l.ended) && (!lv.departedAt || Math.abs(lv.departedAt - atd) < 1800) && nowS() - atd < 24 * 3600 && tr === tbody.querySelector('tr.data-row:not(.tl-adsb-row):not(.tl-live-row)');
      const mob = tr.querySelectorAll('td.visible-xs p');
      const fid = (tr.querySelector('[data-flight]') || { dataset: {} }).dataset.flight || '';
      const landedRow = /Landed/i.test(statusTd.textContent || '');
      if (!l && !isLive && !(fid && landedRow)) continue;
      const rec = fr24Flights.get(fid) || {}; if (fid) fr24Flights.set(fid, rec);
      // (a better answer replaces one of ours shown earlier - an airport over a private site, a sure one over a guess: the
      // history day that names the strip can come in after FR24's track was read)
      const rankOf = c => c === SITE_CELLS ? 1 : /tl-inf/.test(c.desk) ? 2 : 3;
      const putCells = (td, label, cells, key) => {
        if (!cells || !(dash(td) || (td.classList.contains('tl-filled') && rankOf(cells) > Number(td.dataset.tlRank || 0)))) return false;
        td.innerHTML = cells.desk; td.title = cells.title; td.classList.add('tl-filled'); td.dataset.tlRank = String(rankOf(cells)); rec[key] = cells;
        for (const p of mob) { const lb = p.querySelector('label'); if (lb && lb.textContent.trim() === label) { const sp = p.querySelector('span.details'); if (sp) sp.innerHTML = cells.mob; } }
        return true;
      };
      const cellsOf = (end, site) => { const a = end ? apById(end.id) : null; return a ? Object.assign(apCells(a, end.conf), { a }) : site && pageLight ? SITE_CELLS : null; };
      // (FR24's own landing time decides which ADS-B end is this flight's: a helicopter 13 minutes at a site out of
      // coverage is one ADS-B leg "Liverpool -> Blackpool" but two FR24 flights, the first landing at 16:42). Only an
      // ADS-B end after FR24's landing is another flight's: FR24 calls it landed well after touchdown (N87VS down at
      // Woodvale 10:30, its track ending 10:33, "Landed 10:44").
      const frLanded = landedRow ? Number(statusTd.dataset.timestamp) || 0 : 0, legEnd = l ? (l.tOn || l.tEnd) : 0;
      const endAgrees = !frLanded || !legEnd || legEnd <= frLanded + 600;
      if (l && putCells(fromTd, 'FROM', cellsOf(l.from, l.startedOnGround), 'from')) n++;
      if (l && endAgrees && putCells(toTd, 'TO', cellsOf(l.to, landedOff(l)), 'to')) n++;
      if (isLive && goodPrediction(lv)) {
        const pa = apById(lv.destId);
        if (pa && putCells(toTd, 'TO', Object.assign(apCells(pa, ['confirmed', 'filed'].includes(lv.destConf) ? '' : 'pred', lv.destP), { a: pa }), 'to')) n++;
        if (lv.eta && /^\s*(Scheduled|Unknown|Live|Estimated|—|-)/i.test(statusTd.textContent || '') && !/Landed/i.test(statusTd.textContent || '')) {
          const tzTo = tzOf(pa), txt = 'Estimated arrival ' + fmtLocal(lv.eta, tzTo);
          statusTd.dataset.prefix = 'Estimated arrival '; statusTd.dataset.timestamp = String(lv.eta); statusTd.dataset.offset = String(tzTo); statusTd.textContent = ' ' + txt + ' ';
          const sb = stateTd.querySelector('.state-block'); if (sb) { sb.classList.remove('gray', 'red'); sb.classList.add('green'); }
        }
      }
      // (still "—" on a flight FR24 says landed: where its own track began / ended)
      if (fid && landedRow && (dash(fromTd) || dash(toTd) || weak(fromTd) || weak(toTd))) {
        const fe = fr24EndCells.get(fid);
        if (fe) { if (putCells(fromTd, 'FROM', fe.from, 'from')) n++; if (putCells(toTd, 'TO', fe.to, 'to')) n++; }
        else if (!fr24EndAsked.has(fid)) {
          fr24EndAsked.add(fid);
          fr24TrackEnds(fid, Number(tr.dataset.timestamp) || atd).then(e => { fr24EndCells.set(fid, { from: e && placeCells(e.start), to: e && placeCells(e.end) }); if (fr24Refill) fr24Refill(); });
        }
      }
      if (!l) continue;
      const to = l.to ? apById(l.to.id) : null;
      if (/^\s*(Scheduled|Unknown)\b/i.test(statusTd.textContent || '') && endAgrees && l.ended && to && l.tOn && l.tOn > atd) {
        const tzTo = tzOf(to), txt = (l.tOnEst ? 'Landed ~' : 'Landed ') + fmtLocal(l.tOn, tzTo);
        statusTd.dataset.prefix = l.tOnEst ? 'Landed ~' : 'Landed '; statusTd.dataset.timestamp = String(l.tOn); statusTd.dataset.offset = String(tzTo); statusTd.textContent = ' ' + txt + ' ';
        const sb = stateTd.querySelector('.state-block'); if (sb) { sb.classList.remove('gray', 'red', 'yellow'); sb.classList.add('green'); }
        if (dash(durTd)) durTd.textContent = durStr(l.tOn - atd);
        for (const r of tr.querySelectorAll('td.visible-xs .row[data-prefix]')) if (/Scheduled|Unknown/i.test(r.textContent)) { r.textContent = ' ' + txt + ' '; r.dataset.prefix = statusTd.dataset.prefix; r.dataset.timestamp = String(l.tOn); r.dataset.offset = String(tzTo); }
        n++;
      }
    }
    // (an end still "—" between two flights that are known: where the one before landed is where this one took off -
    // within twelve hours; marked as inferred)
    const rows = [...tbody.querySelectorAll('tr.data-row:not(.tl-adsb-row):not(.tl-live-row)')].filter(r => r.children.length >= 12);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], older = rows[i + 1], newer = rows[i - 1], atdOf = x => Number(x.children[8].dataset.timestamp) || Number(x.dataset.timestamp) || 0, landOf = x => /Landed/i.test(x.children[11].textContent || '') ? Number(x.children[11].dataset.timestamp) || 0 : 0;
      const copy = (fromRow, fromIdx, toIdx, label) => {
        const src = fromRow.children[fromIdx], dst = r.children[toIdx]; if (!src || dash(src) || !dash(dst)) return;
        const chained = /Private Site/.test(src.textContent) ? src.innerHTML : src.innerHTML.replace(/<span class="tl-inf"[^>]*>\?<\/span>/, '') + '<span class="tl-inf" title="inferred from the neighbouring flight">?</span>';
        dst.innerHTML = chained; dst.title = src.title || ''; dst.classList.add('tl-filled'); n++;
        for (const p of r.querySelectorAll('td.visible-xs p')) { const lb = p.querySelector('label'); if (lb && lb.textContent.trim() === label) { const sp = p.querySelector('span.details'); if (sp) sp.innerHTML = chained; } }
        const fid = (r.querySelector('[data-flight]') || { dataset: {} }).dataset.flight; if (fid) { const rec = fr24Flights.get(fid) || {}; rec[label === 'FROM' ? 'from' : 'to'] = { desk: chained, mob: chained, title: dst.title, a: null }; fr24Flights.set(fid, rec); }
      };
      if (older && dash(r.children[3])) { const lo = landOf(older), a = atdOf(r); if (lo && a && a >= lo - 300 && a - lo < 12 * 3600) copy(older, 4, 3, 'FROM'); }
      if (newer && dash(r.children[4])) { const lo = landOf(r), a = atdOf(newer); if (lo && a && a >= lo - 300 && a - lo < 12 * 3600) copy(newer, 3, 4, 'TO'); }
    }
    return n;
  }
  // FR24's own rows of the log as its schedule (for its airports' boards, 06-boards): flight id, callsign / number,
  // airports, scheduled and actual times
  function fr24LogRows(tbody) {
    const ts = td => (td && Number(td.dataset.timestamp)) || 0;
    const apOfCell = td => { const a = td && td.querySelector('a[href*="/data/airports/"]'), code = a ? ((a.getAttribute('href') || '').match(/airports\/([a-z0-9]{3,4})/i) || [])[1] : ''; const ap = code ? (airports.byIata.get(code.toUpperCase()) || ENGINE.byIcao(code)) : null; return ap && ap.id < 1e7 ? ap.id : 0; };
    const out = [];
    for (const tr of tbody.querySelectorAll('tr.data-row:not(.tl-adsb-row):not(.tl-live-row)')) {
      const c = tr.children; if (c.length < 12) continue;
      const fid = (tr.querySelector('[data-flight]') || { dataset: {} }).dataset.flight; if (!fid || !/^[0-9a-f]+$/i.test(fid)) continue;
      const fl = clean(c[5].textContent).replace(/[()]/g, '').toUpperCase(), status = clean(c[11].textContent);
      out.push({ id: parseInt(fid, 16), cs: fl, num: /^\(/.test(clean(c[5].textContent)) ? '' : fl, o: apOfCell(c[3]), d: apOfCell(c[4]), std: ts(c[7]), atd: ts(c[8]), sta: ts(c[9]), ata: /Landed/i.test(status) ? ts(c[11]) : 0, eta: /Estimated/i.test(status) ? ts(c[11]) : 0 });
    }
    return out;
  }
  // FR24's playback panel (the flight in the URL's #hash): its "-" ends as the row's, in its own markup - the code small,
  // as FR24 writes "Blackpool (BLK)", ICAO or IATA alike (N87VS's "Woodvale (EGOW)" was all in large letters) - and its
  // padlocked "-" serial number as the header's
  let pageMsn = '';
  function fillPlayback() {
    const sn = document.getElementById('txt-aircraft-serial');
    if (sn && pageMsn && /^\s*-?\s*$/.test(sn.textContent || '')) { sn.textContent = pageMsn; sn.title = 'From the public register / JetPhotos (LADD unblocker)'; }
    const id = (location.hash || '').replace(/^#/, '').toLowerCase(); if (!id) return;
    // (the row's own cells as filled, should the flight not be among those kept - a "Private Site" end, an inferred one)
    const rec = fr24Flights.get(id) || rowEnds(id); if (!rec) return;
    for (const [sel, key] of [['#txt-airport-origin', 'from'], ['#txt-airport-dest', 'to']]) {
      const el = document.querySelector(sel), c = rec[key]; if (!el || !c || !/^\s*(?:-|—|–|N\/A)?\s*$/i.test(el.textContent || '')) continue;
      const a = c.a, q = /tl-inf/.test(c.desk) ? (c.desk.match(/<span class="tl-inf"[^>]*>\?<\/span>/) || [''])[0] : '';
      el.innerHTML = a ? `${esc(a.city || a.name)} <small>(${esc(a.iata || a.icao)})</small>${q}` : /Private Site/.test(c.desk) ? 'Private Site' : c.desk.replace(/<a\b[^>]*>\s*(\([^()<]*\))\s*<\/a>/, '<small>$1</small>');
      el.title = a ? `${a.name}${a.field ? ' (airfield not in FR24\'s list)' : ''}` : c.title || 'Away from any listed airfield';
    }
  }
  function rowEnds(fid) {
    if (!/^[0-9a-f]{4,12}$/.test(fid)) return null;
    const btn = document.querySelector(`#tbl-datatable [data-flight="${fid}"]`), tr = btn && btn.closest('tr'); if (!tr || tr.children.length < 12) return null;
    const cell = td => td && td.classList.contains('tl-filled') ? { desk: td.innerHTML, mob: td.innerHTML, title: td.title || '', a: null } : null;
    const o = { from: cell(tr.children[3]), to: cell(tr.children[4]) };
    return o.from || o.to ? o : null;
  }
  // FR24's playback panel padlocks GPS altitude, true and indicated airspeed, vertical speed and squawk: those of the
  // moment being played, from the public ADS-B track (that day's, read once while the page is open)
  const pbDays = new Map(), pbApl = new Map();
  function pbPoints(hex, t) {
    const day = dayStr(t * 1000), today = day === dayStr(now()), k = hex + '|' + day;
    if (!pbDays.has(k)) pbDays.set(k, fetchTrace(hex, today ? '' : day, { back: Math.max(1, Math.round((nowS() - t) / 86400)), priority: true }).then(j => ENGINE.parseTrace(j).sort((a, b) => a.t - b.t)).catch(() => []));
    return pbDays.get(k);
  }
  // (a moment in a hole in adsb.lol's track: airplanes.live's of that day as well, read once - its receivers are
  // elsewhere; G-DGFD's 1 Oct flight from Chester had nothing from adsb.lol for twenty minutes over the Midlands)
  function pbMore(hex, t) {
    const day = dayStr(t * 1000), k = hex + '|' + day; if (day === dayStr(now())) return null;
    if (!pbApl.has(k)) pbApl.set(k, Promise.all([pbPoints(hex, t), gmRequest(`https://globe.airplanes.live/globe_history/${day}/traces/${hex.slice(-2)}/trace_full_${hex}.json`, { timeout: 20000, priority: true }).then(j => ENGINE.parseTrace(j)).catch(() => [])])
      .then(([a, b]) => { const m = b.length ? ENGINE.mergePoints(a, b).sort((x, y) => x.t - y.t) : a; if (m.length > a.length) pbDays.set(k, Promise.resolve(m)); return m; }));
    return pbApl.get(k);
  }
  const pbNear = (pts, t) => { let lo = 0, hi = pts.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m].t < t) lo = m + 1; else hi = m; } return [pts[lo - 1], pts[lo]].filter(Boolean).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0]; };
  // (the moment itself, not the nearest report: between two reports at most two minutes apart, what changes steadily -
  // heights, speeds, climb - taken in proportion; the squawk and the rest from the nearer of the two)
  function pbAt(pts, t) {
    let lo = 0, hi = pts.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m].t < t) lo = m + 1; else hi = m; }
    const b = pts[lo], a = pts[lo - 1] || (b && b.t <= t ? b : null);
    if (!a || !b || b === a || b.t < t || a.t > t || b.t - a.t > 120) return pbNear(pts, t);
    const f = (t - a.t) / (b.t - a.t), near = f < 0.5 ? a : b, out = Object.assign({}, near, { t });
    for (const k of ['alt', 'altGeom', 'tas', 'ias', 'vr']) if (fin(a[k]) && fin(b[k])) out[k] = a[k] + (b[k] - a[k]) * f;
    if (a.own === false || b.own === false) out.own = near.own;
    return out;
  }
  // (read before it is played: the row under the pointer, and the latest flights as the page opens)
  function pbWarm(hex, t) { if (/^[0-9a-f]{6}$/.test(hex || '') && t > 0) { pbPoints(hex, t); pbMore(hex, t); } }
  let pbSeq = 0, pbLast = '';
  async function fillPlaybackData(hex) {
    const tsEl = document.getElementById('txt-track-timestamp'), t = tsEl ? Number(tsEl.dataset.timestamp) : 0;
    if (!t) return;
    // (both networks' tracks of that day asked for at once - merged as soon as the second is in, and shown again then)
    pbMore(hex, t);
    const seq = ++pbSeq, pts = await pbPoints(hex, t); if (seq !== pbSeq) return;
    const key = t + ':' + pts.length; if (key === pbLast) return; pbLast = key;
    const near = pbNear(pts, t);
    const p = near && Math.abs(near.t - t) <= 60 ? pbAt(pts, t) : null;
    // (in a hole in the public coverage, or a multilateration fix with no GPS height: what changes slowly from the
    // nearest points within ten minutes - the squawk, and the GPS altitude as the barometric one now, this fix's or
    // FR24's, plus the difference between the two at the nearest report that had both)
    const far = near && Math.abs(near.t - t) <= 600 ? near : null;
    let gRef = null;
    if (!(p && fin(p.altGeom))) for (const q of pts) { if (q.t < t - 600) continue; if (q.t > t + 600) break; if (fin(q.altGeom) && fin(q.alt) && (!gRef || Math.abs(q.t - t) < Math.abs(gRef.t - t))) gRef = q; }
    const baro0 = num(((document.getElementById('txt-altitude') || {}).textContent || '').replace(/,/g, '')), baro = p && fin(p.alt) ? p.alt : baro0;
    const geom = p && fin(p.altGeom) ? p.altGeom : gRef && fin(baro) ? baro + (gRef.altGeom - gRef.alt) : NaN;
    const sq = (p && p.sq) || (far && far.sq) || '';
    const n = v => Math.round(v).toLocaleString('en-GB');
    // (a figure left as "–" says why on hover: not sent by this aircraft, or no public data at this moment)
    const why0 = !p ? 'No public ADS-B data within a minute of this moment' : p.own === false ? 'Not sent by this aircraft here - its position is from multilateration (worked out by the receivers)' : 'Not sent by this aircraft';
    const put = (re, html) => {
      const lb = [...document.querySelectorAll('.playback-control label, .playback-player label')].find(l => re.test(clean(l.textContent))); if (!lb) return;
      const row = lb.parentElement; let span = row.querySelector('span.tl-pb');
      if (!span) { const lock = row.querySelector('a.premium-content'); span = document.createElement('span'); span.className = 'text-open-2 tl-pb'; if (lock) lock.replaceWith(span); else row.appendChild(span); }
      if (span.innerHTML !== html) span.innerHTML = html;
      span.title = html === '–' ? why0 + ' (LADD unblocker)' : 'From public ADS-B data (LADD unblocker)';
    };
    put(/^GPS ALTITUDE$/i, fin(geom) ? n(geom) + ' <small>FT</small>' : '–');
    put(/^TRUE AIRSPEED$/i, p && fin(p.tas) ? n(p.tas) + ' <small>KTS</small>' : '–');
    put(/^INDICATED AIRSPEED$/i, p && fin(p.ias) ? n(p.ias) + ' <small>KTS</small>' : '–');
    put(/^VERTICAL SPEED$/i, p && p.own !== false && fin(p.vr) ? (p.vr > 0 ? '+' : '') + n(p.vr) + ' <small>FPM</small>' : '–');
    put(/^SQUAWK$/i, sq ? esc(sq) : '–');
  }
  // ---- the padlocked KML / CSV of each of FR24's own rows (an aircraft's log, a flight number's): the flight's public
  // ADS-B track (adsb.lol / airplanes.live, under the ODbL - the files say so) made into those files here, in FR24's own
  // two formats. Only where FR24 padlocks them: a subscriber's working buttons are left alone.
  const lockedBtn = el => !!(el.querySelector('[class*="lock"]') || /premium|locked|disabled/i.test(el.className || '') || /upgrade|subscri|pricing|premium/i.test(el.getAttribute('href') || ''));
  function unlockExports(tbody) {
    let n = 0;
    for (const tr of tbody.querySelectorAll('tr.data-row:not(.tl-adsb-row):not(.tl-live-row)')) {
      for (const el of [...tr.querySelectorAll('a, button')]) {
        const kind = clean(el.textContent).toUpperCase(); if ((kind !== 'KML' && kind !== 'CSV') || el.dataset.tlExport || !lockedBtn(el)) continue;
        const a = document.createElement('a');
        a.className = String(el.className || '').replace(/\b(premium-content|premium|locked|disabled)\b/gi, ' ').replace(/\s+/g, ' ').trim() + ' tl-export';
        a.href = '#'; a.dataset.tlExport = kind; a.textContent = ' ' + kind + ' ';
        a.title = `This flight's track as a ${kind} file, from public ADS-B data (adsb.lol / airplanes.live, ODbL) - LADD unblocker`;
        el.replaceWith(a); n++;
      }
    }
    return n;
  }
  const tsOfTd = td => (td && Number(td.dataset.timestamp)) || 0;
  // (the flight's time: from its take-off - or its departure as scheduled, or the row's day - to its landing, else its
  // arrival as scheduled and two hours, else twelve hours on)
  function rowWindow(tr) {
    const c = tr.children, off = tsOfTd(c[8]) || tsOfTd(c[7]) || Number(tr.dataset.timestamp) || 0, st = clean(c[11] && c[11].textContent);
    const on = /Landed/i.test(st) && tsOfTd(c[11]) > off ? tsOfTd(c[11]) : tsOfTd(c[9]) > off ? tsOfTd(c[9]) + 7200 : off + 12 * 3600;
    return { off, on: Math.min(on, Math.max(off, nowS())) };
  }
  // the files themselves: FR24's CSV columns, a KML trail (altitudes in metres above sea level)
  function exportFile(kind, pts, cs, fid) {
    const rows = (pts || []).filter(p => p && fin(p.t) && fin(p.lat) && fin(p.lon)).sort((a, b) => a.t - b.t);
    const altFt = p => p.gnd || p.alt === 'ground' ? 0 : fin(p.alt) ? Math.round(p.alt) : '';
    if (kind === 'CSV') {
      const lines = ['Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction'];
      for (const p of rows) lines.push([p.t, new Date(p.t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'), cs || '', '"' + p.lat.toFixed(6) + ',' + p.lon.toFixed(6) + '"', altFt(p), fin(p.gs) ? Math.round(p.gs) : '', fin(p.trk) ? Math.round(p.trk) : ''].join(','));
      return { name: `${cs || 'flight'}_${fid}.csv`, type: 'text/csv', text: lines.join('\n') + '\n' };
    }
    const coords = rows.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},${Math.round((Number(altFt(p)) || 0) * 0.3048)}`).join(' ');
    const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(cs || 'Flight')} ${x(fid)}</name><description>Track from public ADS-B data: adsb.lol / airplanes.live (Open Database License). Made by the LADD unblocker.</description><Style id="trail"><LineStyle><color>ff00b4ff</color><width>3</width></LineStyle></Style><Placemark><name>Trail</name><styleUrl>#trail</styleUrl><LineString><tessellate>1</tessellate><altitudeMode>absolute</altitudeMode><coordinates>${coords}</coordinates></LineString></Placemark></Document></kml>\n`;
    return { name: `${cs || 'flight'}_${fid}.kml`, type: 'application/vnd.google-earth.kml+xml', text };
  }
  function saveFile(f) { const url = URL.createObjectURL(new Blob([f.text], { type: f.type })), a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  // (one click handler for every such button of the page: the row's aircraft, its day's track, the file)
  function exportClicks(hexOfRow, csOfRow) {
    document.addEventListener('click', ev => {
      const a = ev.target && ev.target.closest && ev.target.closest('a.tl-export'); if (!a) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      const tr = a.closest('tr'), fid = (tr && tr.querySelector('[data-flight]') || { dataset: {} }).dataset.flight || ''; if (!tr) return;
      const kind = a.dataset.tlExport, w = rowWindow(tr), was = a.textContent; a.textContent = ' … ';
      (async () => {
        const hex = await hexOfRow(tr, fid, w.off); if (!/^[0-9a-f]{6}$/.test(hex || '')) throw new Error('aircraft not known');
        // (its day's track - and the next day's, for a flight over midnight UTC)
        const ts = dayStr(w.on * 1000) !== dayStr(w.off * 1000) ? [w.off, Math.min(w.on, nowS())] : [w.off];
        let pts = [];
        for (const t of ts) { const more = await (pbMore(hex, t) || pbPoints(hex, t)); pts = pts.concat(more || []); }
        pts = pts.filter(p => p.t >= w.off - 600 && p.t <= w.on + 900);
        if (!pts.length) throw new Error('no public ADS-B track of this flight');
        saveFile(exportFile(kind, pts, csOfRow(tr), fid || hex));
      })().catch(e => { a.title = String(e.message || e) + ' (LADD unblocker)'; log('export', e); }).finally(() => { a.textContent = was; });
    }, true);
  }
  // FR24's playback of a flight on a flight number's page (the flight in the URL's #hash): its padlocked figures as on an
  // aircraft's page. The aircraft: FR24's own playback answer of that flight names it (its Mode S address), else its
  // registration as the row links it, from what this script holds.
  const fidHex = new Map();
  function hexOfFid(fid, ts, reg) {
    const k = String(fid || '').toLowerCase();
    if (!fidHex.has(k)) fidHex.set(k, (k ? gmRequest(`https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${encodeURIComponent(k)}&timestamp=${Math.round(ts || nowS())}`, { timeout: 15000 }) : Promise.resolve(null)).then(j => {
      const f = j && j.result && j.result.response && j.result.response.data && j.result.response.data.flight, idn = f && f.aircraft && f.aircraft.identification;
      const hx = clean(idn && (idn.modes || idn.modeS || idn.hex)).toLowerCase(); if (/^[0-9a-f]{6}$/.test(hx)) return hx;
      const r = clean((idn && idn.registration) || reg).toUpperCase(), h = r && store.byReg(r); return h && h.hex ? h.hex : '';
    }).catch(() => { const h = reg && store.byReg(clean(reg).toUpperCase()); return h && h.hex ? h.hex : ''; }));
    return fidHex.get(k);
  }
  const regOfRow = tr => { const a = tr && tr.querySelector('a[href*="/data/aircraft/"]'); return a ? decodeURIComponent(((a.getAttribute('href') || '').match(/\/data\/aircraft\/([^/?#]+)/i) || [])[1] || '').toUpperCase() : ''; };
  function flightPagePlayback(tbody, cs) {
    let cur = '';
    const tick = async () => {
      const fid = (location.hash || '').replace(/^#/, '').toLowerCase(); if (!/^[0-9a-f]{6,10}$/.test(fid)) return;
      const tr = tbody.querySelector(`[data-flight="${fid}"]`), row = tr && tr.closest('tr');
      const hex = await hexOfFid(fid, row ? rowWindow(row).off : 0, regOfRow(row)); if (!hex) return;
      if (hex !== cur) {
        cur = hex; if (row) pbWarm(hex, rowWindow(row).off);
        // (its padlocked serial number, from the public register / JetPhotos, as on an aircraft's page)
        pageMsn = ''; publicIdentity(hex, regOfRow(row)).then(hx => { if (hx && hx.msn && cur === hex) { pageMsn = hx.msn; fillPlayback(); } }).catch(() => {});
      }
      await fillPlaybackData(hex);
    };
    setInterval(() => { tick().catch(e => log('playback data', e)); }, 400);
    unlockExports(tbody); new MutationObserver(() => unlockExports(tbody)).observe(tbody, { childList: true, subtree: true });
    exportClicks((tr, fid, ts) => hexOfFid(fid, ts, regOfRow(tr)), () => cs);
  }
  // The aircraft page's own header: MSN, AGE and OPERATOR filled in, pictures on the right as FR24 shows them.
  function fillAircraftHeader(hx, reg) {
    try {
      const rows = [...document.querySelectorAll('#cnt-aircraft-info .row')];
      const setField = (labelText, value, title, force) => {
        if (!value) return;
        const row = rows.find(r => { const l = r.querySelector('label'); return l && clean(l.textContent).toUpperCase() === labelText; });
        const span = row && row.querySelector('span.details'); if (!span || span.dataset.tlVal === String(value)) return;
        if (!force && !span.dataset.tlVal && !span.querySelector('.icon-fr24-lock') && clean(span.textContent) && clean(span.textContent) !== '-') return;
        span.textContent = ' ' + value + ' '; span.dataset.tlVal = String(value); span.title = title || 'From public registry / ADS-B data (LADD unblocker)';
      };
      // the log is of another airframe than FR24's register names for this registration: its type, address and serial
      // number replace the other aircraft's (T7-BGD: FR24's CRJ-100SE, MSN 7008 - the one flying is a Gulfstream V)
      if (hx.otherAirframe) {
        const why = `The aircraft flying as ${reg} (FR24's register lists another airframe)`;
        setField('AIRCRAFT', hx.desc || hx.type, why, true); setField('TYPE CODE', hx.type, why, true);
        setField('MODE S', String(hx.hex || '').toUpperCase(), why, true); setField('SERIAL NUMBER (MSN)', hx.msn || '-', why, true);
      }
      const h1 = document.querySelector('#cnt-subpage-info h1'), badge = badgeOf(hx);
      if (h1 && badge) {
        let c = h1.querySelector('.tl-ladd-chip');
        if (!c) { c = document.createElement('a'); c.className = 'tl-ladd-chip'; c.target = '_blank'; c.rel = 'noopener noreferrer'; c.title = 'Blocked on FR24 - flight log rebuilt from public ADS-B by the LADD unblocker. Opens the FAA page on the programme.'; h1.appendChild(c); }
        if (c.tagName === 'A' && c.getAttribute('href') !== tagLink(hx)) c.setAttribute('href', tagLink(hx));
        if (c.textContent !== badge) c.textContent = badge;
      }
      setField('SERIAL NUMBER (MSN)', hx.msn);
      setField('AGE', ageText(hx), ageTitle(hx));
      setField('OPERATOR', shownOwner(hx, hx.cs) || '', hx.ownerCity && ownerName(hx.owner) ? 'Registered to ' + (ownerName(hx.owner) || '') + ', ' + placeName(ENGINE.placeShort(hx.ownerCity)) : '');
      // (an aircraft FR24 lists under "Private owner": its registered owner / operator there instead - a real airline
      // FR24 names stays)
      {
        const nm = shownOwner(hx, hx.cs) || '';
        const row = rows.find(r => { const l = r.querySelector('label'); return l && clean(l.textContent).toUpperCase() === 'AIRLINE'; }), sp = row && row.querySelector('span.details');
        if (nm && sp && (sp.dataset.tlVal || /^private owner$/i.test(clean(sp.textContent)))) setField('AIRLINE', nm, 'Registered owner / operator (LADD unblocker)', true);
      }
      const sh = document.querySelector('.section-header'), right = sh && sh.children[1] && sh.children[1].querySelector('.row');
      const photos = (hx.photos || []).slice(0, 2);
      if (right && photos.length && (right.dataset.tlPhotos || '') !== photos.map(p => p.large).join('|') && !right.querySelector('.cnt-picture:not(.tl-ac-photo)')) {
        right.innerHTML = photos.map(cleanPhoto).map(p => `<div class="col-xs-6 n-p cnt-picture tl-ac-photo"><span class="label">${p.credit ? '© ' + esc(p.credit) + ' | ' : ''}${esc(p.source || '')} </span><a href="${esc(p.link || p.large)}" target="_blank" rel="noopener noreferrer"><img alt="A picture of ${esc(reg)}" class="img-responsive" referrerpolicy="no-referrer" src="${esc(p.large || p.medium)}" title="Open this aircraft picture in new window"></a></div>`).join(' ');
        right.dataset.tlPhotos = photos.map(p => p.large).join('|');
      }
    } catch (e) { log('aircraft header', e); }
  }
  // Is it flying right now? Its current ADS-B position plus today's trace, run through the same engine as the map.
  async function pageLiveState(hex, reg) {
    let cur = null;
    for (const s of liveSources().filter(x => x.hex).slice(0, 2)) { try { cur = await s.hex(hex); if (cur) break; } catch (e) { /* next */ } }
    let td = null; try { td = await loadToday(hex, 60000); } catch (e) { /* no trace */ }
    const lastPt = td ? (td.lastPt || (td.pts && td.pts.length ? td.pts[td.pts.length - 1] : null)) : null;
    const pos = cur && now() - cur.receivedAt + cur.ageS * 1000 < 10 * 60000 ? { t: Math.floor((cur.receivedAt - cur.ageS * 1000) / 1000), lat: cur.lat, lon: cur.lon, alt: cur.gnd ? 0 : cur.alt, gnd: cur.gnd, gs: cur.gs, trk: cur.trk, vr: cur.vs, mcp: cur.mcp, sq: cur.sq }
      : lastPt && nowS() - lastPt.t < 10 * 60 ? { t: lastPt.t, lat: lastPt.lat, lon: lastPt.lon, alt: lastPt.alt, gnd: lastPt.gnd0 || lastPt.gnd, gs: lastPt.gs, trk: lastPt.trk, vr: lastPt.vr, mcp: lastPt.mcp, sq: lastPt.sq } : null;
    if (!pos || pos.gnd) return null;
    const leg = td && td.legs && td.legs.length ? td.legs[td.legs.length - 1] : null;
    const trail = leg && !leg.ended ? [leg.start].concat(leg.pts) : [];
    const cached = store.allIds().filter(r => r.hex === hex).sort((a, b) => b.savedAt - a.savedAt)[0];
    const fakeId = -1;
    live.set(fakeId, { id: fakeId, hex, reg, type: (store.getHex(hex) || {}).type || (cur && cur.type) || '', cat: cur && cur.cat, mil: cur && cur.mil });
    try {
      const r = composeRoute(fakeId, hex, { pos, trail });
      if (!r) return null;
      return Object.assign(r, { cs: (cur && cur.cs) || (leg && leg.cs) || '', fr24Id: cached && now() - cached.savedAt < 6 * 3600e3 ? cached.id : 0 });
    } finally { live.delete(fakeId); }
  }
  async function bootAircraftPage() {
    const reg = decodeURIComponent((location.pathname.match(/^\/data\/aircraft\/([^/?#]+)/i) || [])[1] || '').toUpperCase();
    if (!reg) return;
    addStyle();
    await store.kvReady;          // (the airport list and small records; the aircraft's own records are read by key)
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    const table = document.getElementById('tbl-datatable'); if (!table) return;
    // our Play / Live buttons open their own link; FR24's table handlers never see the click
    document.addEventListener('click', ev => {
      const a = ev.target && ev.target.closest && ev.target.closest('#tbl-datatable a.tl-play, #tbl-datatable a.tl-live'); if (!a) return;
      ev.stopImmediatePropagation();
      if (a.target === '_blank') { ev.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
    }, true);
    const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
    // (any row of its own - G-DGFD had two: FR24 lists this aircraft; the whole log rebuilt as well under them doubled
    // its flights, two "Live" rows among them)
    const fr24Rows = () => [...tbody.querySelectorAll('tr.data-row[data-timestamp]:not(.tl-adsb-row):not(.tl-live-row)')];
    if (fr24Rows().length >= 1) {
      // FR24 shows this aircraft's history itself: only its padlocked serial number and age are filled in
      const hex0 = clean((document.getElementById('txt-mode-s') || {}).textContent).toLowerCase();
      if (/^[0-9a-f]{6}$/.test(hex0)) {
        const titleMsn0 = clean((document.title.match(/\[([^\]]+)\]/) || [])[1]);
        if (titleMsn0) pageMsn = titleMsn0;
        publicIdentity(hex0, reg).then(hx => { if (hx) { if (hx.msn) pageMsn = hx.msn; fillAircraftHeader(Object.assign({ hex: hex0, reg }, hx), reg); fillPlayback(); } }).catch(e => log('aircraft page identity', e));
        // (the playback panel's padlocked figures, as it plays - from the start, not once the airport lists are in; the
        // tracks of the two latest flights read now, any other's as the pointer reaches its row)
        // (and its "-" ends: FR24 builds that panel when a flight is played - after this page's observers were set up -
        // and fills it from its own request, later than the address changes: G-FRGP's "To: -" beside its row's Private Site)
        setInterval(() => { try { fillPlayback(); } catch (e) { log('playback ends', e); } fillPlaybackData(hex0).catch(e => log('playback data', e)); }, 400);
        // (and its rows' padlocked KML / CSV: the flight's public track as those files)
        unlockExports(tbody); new MutationObserver(() => unlockExports(tbody)).observe(tbody, { childList: true, subtree: true });
        exportClicks(() => Promise.resolve(hex0), tr => clean(tr.children[5] && tr.children[5].textContent).replace(/[()]/g, '').toUpperCase() || reg.replace(/-/g, ''));
        // (the days of the latest eight rows read ahead - one file a day - so their playback fills from its first moment)
        [...tbody.querySelectorAll('tr[data-timestamp]')].slice(0, 8).forEach(tr => pbWarm(hex0, Number(tr.dataset.timestamp)));
        tbody.addEventListener('pointerover', ev => { const tr = ev.target && ev.target.closest && ev.target.closest('tr[data-timestamp]'); if (tr) pbWarm(hex0, Number(tr.dataset.timestamp)); });
        // ... and the airports it shows as "—", from the ADS-B track (today first, then back as far as its rows go)
        (async () => {
          // (the rows filled as soon as the airports are known; the list of strips, when in, fills them again)
          await loadAirports();
          let lv = null;
          { const tc = ((document.getElementById('cnt-aircraft-info') || {}).textContent || '').match(/TYPE CODE\s+([A-Z0-9]{2,4})\b/); const pc = ENGINE.classify({ type: (store.getHex(hex0) || {}).type || (tc ? tc[1] : '') }); pageHeli = pc === 'heli'; pageLight = pageHeli || pc === 'piston' || pc === 'glider'; }
          const fill = () => { try { fillFr24Rows(tbody, hex0, lv); fillPlayback(); } catch (e) { log('aircraft page rows', e); } };
          fr24Refill = fill;
          loadSites().then(() => fill()).catch(() => {});
          new MutationObserver(fill).observe(tbody, { childList: true });
          // (the playback panel: FR24 rewrites its ends when another flight is played)
          window.addEventListener('hashchange', () => setTimeout(fillPlayback, 300));
          for (const pid of ['txt-airport-dest', 'txt-aircraft-serial']) { const pb = document.getElementById(pid); if (pb) new MutationObserver(() => setTimeout(fillPlayback, 50)).observe(pb, { childList: true, characterData: true, subtree: true }); }
          // (its flights - flown and still to fly - kept for their airports' boards)
          try { boardNoteSched(hex0, fr24LogRows(tbody), { reg }); boardDrain().catch(() => {}); } catch (e) { log('board schedule', e); }
          // the flight in the air now: the map tab's route of it when the map has one (the same answer, the moment it
          // changes there), else worked out here from its track - every minute while the page is open
          const fromMap0 = () => { const m = mapRoutes.get(hex0); return m && now() - m.at < 5 * 60000 && !m.route.landed ? m.route : null; };
          mapRouteHook = h => { if (h === hex0 && fromMap0()) { lv = fromMap0(); fill(); } };
          if (routeChan) routeChan.postMessage({ ask: hex0 });
          if (fromMap0()) { lv = fromMap0(); fill(); }
          await loadToday(hex0, 60000, { priority: true }).catch(() => null); fill();
          const liveTick = async () => { if (routeChan) routeChan.postMessage({ ask: hex0 }); let own = null; try { own = await pageLiveState(hex0, reg); } catch (e) { own = null; } lv = fromMap0() || own; fill(); };
          liveTick(); setInterval(liveTick, 60000);
          // FR24 gives a free account a week of the log ("more than 7 days ... with an upgrade"): three months more under
          // its rows, rebuilt from public ADS-B in its own markup - FR24's rows keep their own playback, these replay their
          // track on adsb.lol (airplanes.live beyond six weeks). Every day is kept once read, as for the blocked aircraft.
          const oldest = Math.min(...fr24Rows().map(tr => Number(tr.dataset.timestamp) || Infinity));
          const cut = fin(oldest) ? oldest : nowS();
          const days = Math.min(HISTORY_DAYS, Math.max(2, Math.ceil((nowS() - cut) / 86400) + OLDER_DAYS));
          const tail = document.createElement('tr'); tail.className = 'tl-foot tl-older-foot'; tail.innerHTML = '<td colspan="20"></td>';
          const renderOlder = (h, done, total) => {
            const legs = knownLegs(hex0).filter(l => (l.from || l.to || l.tEnd - l.tStart > 600) && (l.tOff || l.tStart) < cut - 1800 && (l.tOff || l.tStart) > nowS() - days * 86400).sort((a, b) => b.tStart - a.tStart);
            const html = legs.map(l => legRowHtml(l, hex0, reg)).join('');
            if (html !== tail.dataset.html) {
              tbody.querySelectorAll('tr.tl-adsb-row').forEach(r => r.remove());
              if (!tail.parentNode) tbody.appendChild(tail);
              tail.insertAdjacentHTML('beforebegin', html); tail.dataset.html = html;
            }
            const busy = total > 0 && done < total;
            tail.firstChild.innerHTML = `${busy ? '<span class="tl-spin"></span>&nbsp; ' : ''}${legs.length} earlier flight${legs.length === 1 ? '' : 's'} rebuilt from public ADS-B data (adsb.lol, <a href="https://globe.airplanes.live/?icao=${esc(hex0)}" target="_blank" rel="noopener noreferrer">airplanes.live</a>) · ${Math.round(OLDER_DAYS / 30)} months before FR24's week${busy ? ` · loading… (${done} of ${total} days)` : ''}`;
          };
          renderOlder(null, 0, 1);
          histHook = Object.assign(h => { if (h === hex0) { fill(); renderOlder(null, 1, 1); } }, { hex: hex0 });
          await loadHistory(hex0, days, (h, done, total) => { fill(); renderOlder(h, done, total); }, { front: true });
          fill(); renderOlder(null, 1, 1);
        })().catch(e => log('aircraft page rows', e));
      }
      return;
    }
    tbody.querySelectorAll('tr').forEach(tr => { if (!tr.querySelector('[data-timestamp]') && /could not find|no data/i.test(tr.textContent)) tr.remove(); });
    const loading = document.createElement('tr'); loading.className = 'tl-loading';
    loading.innerHTML = '<td colspan="20"><span class="tl-spin"></span>&nbsp; Loading flight history from public ADS-B…</td>';
    tbody.appendChild(loading);
    const foot = document.createElement('tr'); foot.className = 'tl-foot'; foot.innerHTML = '<td colspan="20"></td>';
    // Which airframe is this registration today? FR24's register can be out of date when a registration has moved to
    // another aircraft: T7-BGD is a CRJ-100SE on Mode S 50014B there, while the T7-BGD flying - a Gulfstream V, NUM611 -
    // transmits 5002E6 ("0 flights in the last 90 days"). The address the script has seen flying under this registration
    // comes first, then hexdb's (the register ADS-B sites keep current), then FR24's, then the other registries'; one
    // with no flights in 90 days gives way to the next.
    const pageHex = clean((document.getElementById('txt-mode-s') || {}).textContent).toLowerCase();
    const titleMsn = clean((document.title.match(/\[([^\]]+)\]/) || [])[1]);
    const cands = [], addCand = h => { h = clean(h).toLowerCase(); if (/^[0-9a-f]{6}$/.test(h) && !cands.includes(h)) cands.push(h); };
    await Promise.race([store.ready, sleep(2500)]);
    addCand((store.byReg(reg) || {}).hex);
    try { const h = await Promise.race([gmRequest(`https://hexdb.io/reg-hex?reg=${encodeURIComponent(reg)}`, { json: false, accept: 'text/plain', timeout: 6000 }), sleep(4000).then(() => '')]); addCand(String(h || '').trim()); } catch (e) { /* ignore */ }
    addCand(pageHex);
    const moreCands = async () => {
      try { const info = await fr24.aircraftInfo(reg); if (info && info.hex) addCand(info.hex); } catch (e) { /* ignore */ }
      try { const a = (await gmRequest(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(reg)}`)).response; addCand(a && a.aircraft && a.aircraft.mode_s); } catch (e) { /* ignore */ }
      try { const h = await gmRequest(`https://hexdb.io/reg-hex?reg=${encodeURIComponent(reg)}`, { json: false, accept: 'text/plain' }); addCand(String(h || '').trim()); } catch (e) { /* ignore */ }
    };
    if (!cands.length) await moreCands();
    if (!cands.length) { loading.innerHTML = '<td colspan="20">The ICAO address of this registration is unknown, so its flight log cannot be rebuilt.</td>'; return; }
    await loadAirports();
    let current = null, liveState = null;
    // the log of one address: header, pictures, rows; returns the number of flights found (a later run replaces it)
    const showFor = async hex => {
      const run = {}; current = run; liveState = null;
      tbody.querySelectorAll('tr.tl-adsb-row').forEach(r => r.remove());
      if (!loading.parentNode) tbody.insertBefore(loading, foot.parentNode ? foot : null);
      loading.innerHTML = '<td colspan="20"><span class="tl-spin"></span>&nbsp; Loading flight history from public ADS-B…</td>';
      // identity, age, MSN, photos - cache first, then fresh
      const other = !!(pageHex && pageHex !== hex);
      let hx = Object.assign({ hex, reg }, (await store.hexAsync(hex)) || {}, { otherAirframe: other });
      if (!hx.msn && titleMsn && !other) hx.msn = titleMsn;   // (FR24's title names its register's airframe)
      fillAircraftHeader(hx, reg);
      const shell = Object.assign({ id: 0 }, hx, { hex, reg, photoLevel: 0, photoV: 0 });
      // photos in parallel with the identity lookups; each fills its part of the header as soon as it arrives
      fetchPhotos(shell, true).then(ph => {
        if (!ph.length || current !== run) return;
        store.mergeHex(hex, { photos: ph, photoAt: now(), photoV: PHOTO_V, photoLevel: 2 });
        hx = Object.assign(hx, store.getHex(hex)); fillAircraftHeader(hx, reg);
      }).catch(e => log('aircraft page photos', e));
      (async () => {
        const idn = await fetchIdentity(shell).catch(() => ({}));
        for (const k of ['msn', 'year', 'owner', 'ownerCity', 'type', 'desc', 'countryId']) if (!shell[k] && idn[k]) shell[k] = idn[k];
        store.mergeHex(hex, { reg, msn: shell.msn, year: shell.year, owner: shell.owner, ownerCity: shell.ownerCity, faaAt: shell.faaAt });
        if (current === run) { hx = Object.assign(hx, store.getHex(hex)); fillAircraftHeader(hx, reg); }
        if (!shell.operatorId) { try { const info = await fr24.aircraftInfo(reg); if (info && info.operatorId) { shell.operatorId = info.operatorId; await fr24.loadAirlines(); shell.operatorName = fr24.airlineName(info.operatorId); } } catch (e) { /* ignore */ } }
        store.mergeHex(hex, { operatorId: shell.operatorId, operatorName: shell.operatorName });
        if (current === run) { hx = Object.assign(hx, store.getHex(hex)); fillAircraftHeader(hx, reg); }
      })().catch(e => log('aircraft page identity', e));
      const legsOf = () => knownLegs(hex).filter(l => l.from || l.to || l.tEnd - l.tStart > 600).sort((a, b) => b.tStart - a.tStart);
      const render = () => {
        if (current !== run) return;
        tbody.querySelectorAll('tr.tl-adsb-row').forEach(r => r.remove());
        hx = Object.assign(hx, store.getHex(hex) || {}); fillAircraftHeader(hx, reg);
        const legs = legsOf();
        const shown = liveState ? legs.filter(l => l.ended || l.tEnd < (liveState.departedAt || 0) - 60) : legs;
        const html = (liveState ? liveRowHtml(liveState, hex, reg) : '') + shown.map(l => legRowHtml(l, hex, reg)).join('');
        if (!foot.parentNode) tbody.appendChild(foot);
        (loading.parentNode ? loading : foot).insertAdjacentHTML('beforebegin', html);
        const days = Object.keys((store.peekHist(hex) || {}).days || {}).length;
        const inferred = shown.filter(l => (l.from && l.from.conf === 'chain') || (l.to && l.to.conf === 'chain')).length;
        const other = pageHex && pageHex !== hex ? ` · FR24's register lists Mode S ${esc(pageHex.toUpperCase())} for ${esc(reg)}; the ${esc(reg)} seen flying uses ${esc(hex.toUpperCase())}` : '';
        foot.firstChild.innerHTML = `Flight history rebuilt from public ADS-B data (adsb.lol, <a href="https://globe.airplanes.live/?icao=${esc(hex)}" target="_blank" rel="noopener noreferrer">airplanes.live</a>, Mode S ${esc(hex.toUpperCase())}) · ${shown.length + (liveState ? 1 : 0)} flights in the last ${Math.min(HISTORY_DAYS, days + 1)} days · times are local to each airport${inferred ? ` · ${inferred} airport${inferred > 1 ? 's' : ''} marked ? inferred where coverage was missing` : ''}${other}`;
        // (done when every day is in - or when the load has finished and a source did not answer for some of them: they
        // are asked again next time, the spinner does not wait for them)
        if ((days >= HISTORY_DAYS - 1 || run.loaded) && (legs.length || liveState || run.last || run.loaded)) loading.remove();
        else loading.firstChild.innerHTML = `<span class="tl-spin"></span>&nbsp; Loading older flights… (${days} of ${HISTORY_DAYS} days)`;
      };
      run.render = render;
      // the flight in progress as the map tab has it (asked; it answers at once) - before anything is worked out here
      const fromMap = () => { const m = mapRoutes.get(hex); return m && now() - m.at < 5 * 60000 && !m.route.landed ? m.route : null; };
      const own = ls => fromMap() || ls;
      mapRouteHook = h => { if (h === hex && current === run && fromMap()) { liveState = fromMap(); render(); } };
      histHook = Object.assign(h => { if (h === hex && current === run) render(); }, { hex });
      if (routeChan) routeChan.postMessage({ ask: hex });
      // the stored log at once; the live row (a network check) joins it when it is known
      await Promise.all([store.getHist(hex), warmToday([hex])]);
      liveState = fromMap(); render();
      pageLiveState(hex, reg).then(ls => { if (ls && current === run) { liveState = own(ls); render(); } }).catch(e => log('live state', e));
      await loadHistory(hex, HISTORY_DAYS, () => render(), { front: true });
      run.loaded = true;
      try { const ls = await pageLiveState(hex, reg); if (current === run) liveState = own(ls); } catch (e) { /* keep */ }
      render();
      return legsOf().length + (liveState ? 1 : 0);
    };
    let hex = cands[0], n = await showFor(hex);
    // nothing flown under that address in 90 days: the next one (asking the registries too, once)
    for (let i = 1, asked = false; !n; i++) {
      if (i >= cands.length && !asked) { asked = true; await moreCands(); }
      if (i >= cands.length) break;
      hex = cands[i]; n = await showFor(hex);
    }
    if (current) { current.last = true; current.render(); } loading.remove();
    // keep the live row current while the page is open
    setInterval(async () => { if (document.hidden || !current || !current.render) return; if (routeChan) routeChan.postMessage({ ask: hex }); const m = mapRoutes.get(hex); if (m && now() - m.at < 120000) return; try { const ls = await pageLiveState(hex, reg); liveState = (m && now() - m.at < 5 * 60000 && !m.route.landed ? m.route : null) || ls; current.render(); } catch (e) { /* ignore */ } }, 60000);
  }

  // ---- flight-number page (/data/flights/<callsign>): a blocked aircraft's flights under a callsign FR24 has no history
  // of ("There is currently no data available for your request": VSB96, BAE Systems' PC-24 shuttles Barrow - Farnborough),
  // rebuilt in FR24's own markup as its flight pages have it - date, from, to, the aircraft, times, status, playback - from
  // the logs kept here (each aircraft's flights carry their callsigns) and the permanent monitor's flights.
  const FLIGHT_HEAD = '<thead><tr><th scope="col" class="visible-xs visible-sm" colspan="20">FLIGHTS HISTORY</th><th scope="col" class="w40 hidden-xs hidden-sm">&nbsp;</th><th scope="col" class="hidden-xs hidden-sm">DATE</th><th scope="col" class="hidden-xs hidden-sm">FROM</th><th scope="col" class="hidden-xs hidden-sm">TO</th><th scope="col" class="hidden-xs hidden-sm">AIRCRAFT</th><th scope="col" class="hidden-xs hidden-sm">FLIGHT TIME</th><th scope="col" class="hidden-xs hidden-sm" title="Scheduled Time Departure">STD</th><th scope="col" class="hidden-xs hidden-sm" title="Actual Time Departure">ATD</th><th scope="col" class="hidden-xs hidden-sm" title="Scheduled Time Arrival">STA</th><th scope="col" class="hidden-xs hidden-sm"></th><th scope="col" class="hidden-xs hidden-sm">STATUS</th><th class="text-right hidden-xs hidden-sm"></th><th scope="col" class="w40 hidden-xs hidden-sm">&nbsp;</th></tr></thead>';
  const csKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // every flight known under the callsign: [{ leg, hex }] - the logs kept here first (instant), the monitor's as it answers
  async function flightsOfCallsign(cs, onMore) {
    const out = new Map(), add = (hex, l) => { if (!l || csKey(l.cs) !== cs) return; const k = hex + ':' + Math.round((l.tOff || l.tStart) / 600); if (!out.has(k)) out.set(k, { hex, leg: l }); };
    await Promise.race([store.ready, sleep(2500)]);
    const hexes = [...store.allHex()].filter(([, v]) => v && Array.isArray(v.recent) && v.recent.some(x => csKey(x[6]) === cs)).map(([h]) => h);
    for (const h of hexes) { const hi = await store.getHist(h); for (const l of (hi && hi.legs) || []) add(h, l); for (const l of compactToLegs((store.getHex(h) || {}).recent || [])) add(h, l); }
    if (onMore) onMore([...out.values()]);
    const j = await monGet('/flights?cs=' + encodeURIComponent(cs)).catch(() => null);
    for (const l of (j && j.list) || []) { add(l.hex, l); if (l.reg && !store.getHex(l.hex)) store.mergeHex(l.hex, { reg: l.reg, type: l.type, ladd: !!l.ladd || undefined }); }
    return [...out.values()];
  }
  // ---- FR24's search box, on every page (map, playback, boards, logs): the blocked aircraft this script keeps logs of, as
  // FR24 lists aircraft (to the log page built here), and the callsigns they flew under, as FR24 lists flight numbers (to
  // the flight-number page built here) - FR24's own results stand, none listed twice (the page merges them)
  // A route searched for - "LPL-EIS", "EGGP-TUPJ": every flight on it this browser has worked out, blocked or one FR24
  // shows without a destination (M-PORT, worked out as Liverpool to EIS) - as FR24 lists its own flights on a route: the
  // flight (its card, and its panel when clicked), then its callsign (to the flight-number page).
  const apForCode = c => airports.byIata.get(c) || (c.length === 4 ? ENGINE.byIcao(c) : null) || null;
  function routeSearch(q) {
    const m = String(q || '').toUpperCase().match(/^\s*([A-Z0-9]{3,4})\s*[-–—>/]\s*([A-Z0-9]{3,4})\s*$/); if (!m || !airportsReady()) return null;
    const A = apForCode(m[1]), B = apForCode(m[2]);
    const at = (id, code, ap, c) => (ap ? id === ap.id : false) || String(code || '').toUpperCase() === c;
    const on = r => !!r && !r.landed && at(r.originId, r.originIata, A, m[1]) && at(r.destId, r.destIata, B, m[2]);
    const out = [], seen = new Set();
    const add = (id, rec, route, fb) => {
      if (seen.has(id) || !on(route)) return; const c = currentPos(id) || fb; if (!c) return;
      seen.add(id); out.push({ id, cs: rec.cs, rec, route: routeForPage(route), pos: { lat: c.lat, lon: c.lon, alt: c.alt, gnd: !!c.gnd, at: c.t * 1000 } });
    };
    for (const [id, rec] of live) { const st = routeState.get(id); add(id, { cs: csOfRec(rec), reg: rec.reg || '', type: rec.type || '', hex: rec.hex || '', operatorId: operatorIdOf(store.getHex(rec.hex) || {}, rec.cs) || 0 }, (st && st.route) || rec.route); }
    for (const [id, p] of pubRecs) if (pubRouted(id)) { const st = routeState.get(id); add(id, { cs: p.cs || '', reg: p.reg || '', type: p.type || '', hex: p.hex || '', operatorId: operatorIdOf({}, p.cs) || 0 }, (st && st.route) || p.route); }
    for (const [id, e] of naFeed) if (e.pub) add(id, { cs: e.f.cs || '', reg: e.f.reg || '', type: e.f.type || '', hex: e.f.hex ? Number(e.f.hex).toString(16).padStart(6, '0') : '', operatorId: operatorIdOf({}, e.f.cs) || 0 }, e.pub, { t: Math.floor(e.at / 1000), lat: e.f.lat, lon: e.f.lon, alt: e.f.alt, gnd: !!e.f.gnd });
    return out.slice(0, 20);
  }
  async function onNeedSearch(d) {
    const q = csKey(d.q), rows = [], cs = new Map();
    const onRoute = routeSearch(d.q);
    if (onRoute) {
      for (const x of onRoute) { const c = csKey(x.cs || x.rec.reg); if (c && !rows.some(r => r.id === c)) rows.push({ type: 'schedule', id: c, label: c + ' / ' + c, match: 'begins', detail: { callsign: c, flight: c, operator: (c.match(/^[A-Z]{3}(?=\d)/) || [''])[0], operator_id: x.rec.operatorId || 0 } }); }
      return postToPage('searchAdd', { rid: d.rid, rows, live: onRoute });
    }
    if (q.length >= 2) {
      await Promise.race([store.ready, sleep(400)]);
      if (!fr24.airlines) await Promise.race([fr24.loadAirlines().catch(() => {}), sleep(300)]);
      const note = (c, hx, v, t) => { const o = cs.get(c); if (!o || t > o.t) cs.set(c, { hex: hx, v, t }); };
      for (const [hex, v] of store.allHex()) {
        if (!v || !(v.ladd || v.fr24Blocked || v.pia)) continue;
        const reg = String(v.reg || '').toUpperCase(), rk = csKey(reg);
        if (rk && rk.startsWith(q) && rows.length < 8) { const op = operatorIdOf(v), icao = op && fr24.airlines && fr24.airlines.get(op) ? fr24.airlines.get(op).icao || '' : '';
          rows.push({ type: 'aircraft', id: reg, label: `${reg}${v.type ? ' (' + v.type + ')' : ''}${icao ? ' - ' + icao : ''}`, match: 'begins', detail: { equip: v.type || '', hex: hex.toUpperCase(), operator_id: op || 0, owner: icao } }); }
        for (const x of v.recent || []) { const c = csKey(x[6]); if (c && c !== rk && c.startsWith(q)) note(c, hex, v, x[0] || 0); }
      }
      for (const [, rec] of live) { const c = csKey(csOfRec(rec)), v = rec.hex ? store.getHex(rec.hex) : null; if (c && v && (v.ladd || v.fr24Blocked || v.pia) && c !== csKey(v.reg) && c.startsWith(q)) note(c, rec.hex, v, nowS()); }
      for (const [c, o] of [...cs].sort((a, b) => b[1].t - a[1].t).slice(0, 8)) {
        const op = operatorIdOf(o.v, c);
        rows.push({ type: 'schedule', id: c, label: c + ' / ' + c, match: 'begins', detail: { callsign: c, flight: c, operator: (c.match(/^[A-Z]{3}(?=\d)/) || [''])[0], operator_id: op || 0 } });
      }
    }
    postToPage('searchAdd', { rid: d.rid, rows });
  }
  async function bootFlightPage() {
    const cs = csKey(decodeURIComponent((location.pathname.match(/^\/data\/flights\/([^/?#]+)/i) || [])[1] || ''));
    if (!cs) return;
    addStyle();
    await store.kvReady;
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    const sec = document.getElementById('cnt-data-content'); if (!sec) return;
    // (FR24 lists this number itself: its rows stand, ours are not merged in - its playback's padlocked figures and its
    // rows' padlocked files filled)
    if (document.querySelector('#tbl-datatable tbody tr.data-row')) { flightPagePlayback(document.querySelector('#tbl-datatable tbody'), cs); return; }
    const note = [...sec.querySelectorAll('div.row')].find(d => /no data available for your request/i.test(d.textContent || ''));
    await loadAirports();
    // (no "is-user" class: FR24's stylesheet hides that table's rows until its own script takes it off - never, on ours)
    const wrap = document.createElement('div'); wrap.className = 'row';
    wrap.innerHTML = `<table class="" id="tbl-datatable">${FLIGHT_HEAD}<tbody><tr class="tl-loading"><td colspan="20"><span class="tl-spin"></span>&nbsp; Loading the flights of ${esc(cs)} from public ADS-B…</td></tr></tbody></table>`;
    if (note) { note.before(wrap); for (const n of [...note.childNodes]) if (n.nodeType === 3 && /no data available/i.test(n.textContent)) n.remove(); note.classList.remove('p-t-10', 'text-center'); note.style.padding = '0'; }
    else sec.appendChild(wrap);
    // (FR24's own title names the airline: its heading as on the flight pages it has)
    const h1 = sec.querySelector('#cnt-subpage-info h1'); if (h1 && /^Flight history for /.test(document.title)) h1.textContent = document.title.replace(/\s*[|-]\s*Flightradar24.*$/i, '') + ' ';
    const tbody = wrap.querySelector('tbody');
    const render = list => {
      const rows = list.slice().sort((a, b) => b.leg.tStart - a.leg.tStart).map(({ hex, leg }) => { const hx = store.getHex(hex) || {}; return legRowHtml(leg, hex, hx.reg || leg.reg || '', { reg: hx.reg || leg.reg || hexNNumber(hex), type: hx.type || leg.type || '', desc: modelName(hx) }); });
      tbody.innerHTML = rows.join('') + `<tr class="tl-foot"><td colspan="20">Flights of ${esc(cs)} rebuilt from public ADS-B data (adsb.lol, airplanes.live) · ${list.length} flight${list.length === 1 ? '' : 's'} · times are local to each airport</td></tr>`;
    };
    const list = await flightsOfCallsign(cs, l => { if (l.length) render(l); });
    if (list.length) render(list); else tbody.innerHTML = '<tr><td colspan="20" class="text-center" style="padding:10px 0;font-weight:700">There is currently no data available for your request</td></tr>';
  }
