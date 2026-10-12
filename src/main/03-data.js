
  // ---- FR24's own APIs: airline list, countries, aircraft lookup, airport boards (filed flight plans) ------------
  const fr24 = {
    airlines: null, airlinesLoading: null, byIcao: new Map(), byName: new Map(),
    // airline and country lists: from disk when cached (refreshed weekly), so operator names and country ids are instant
    cached(key, maxAgeMs, fetchRows) {
      return Promise.race([store.kvReady, sleep(900)]).then(() => {
        const c = store.kvGet(key);
        if (c && Array.isArray(c.rows) && c.rows.length) { if (now() - (c.at || 0) > maxAgeMs) setTimeout(() => fetchRows().then(rows => store.kvSet(key, { at: now(), rows })).catch(() => {}), 30000); return c.rows; }
        return fetchRows().then(rows => { if (rows.length) store.kvSet(key, { at: now(), rows }); return rows; });
      });
    },
    loadAirlines() {
      if (this.airlines) return Promise.resolve(this.airlines);
      if (!this.airlinesLoading) this.airlinesLoading = this.cached('airlines', 7 * 864e5, () => fr24Json('/mobile/airlines?format=2&version=0', 30000).then(j => (Array.isArray(j && j.rows) ? j.rows : []).filter(a => a && a.id).map(a => [a.id, clean(a.name), clean(a.icao), clean(a.iata)]))).then(rows => {
        const map = new Map();
        for (const [id, name, icao, iata] of rows) { map.set(id, { id, name, icao, iata }); if (icao) this.byIcao.set(icao.toUpperCase(), id); const nk = nameKey(name); if (nk && !this.byName.has(nk)) this.byName.set(nk, id); }
        this.airlines = map; log('airlines loaded', map.size); return map;
      }).catch(e => { this.airlinesLoading = null; throw e; });
      return this.airlinesLoading;
    },
    airlineName(id) { if (!this.airlines) { this.loadAirlines().catch(() => {}); return ''; } const a = this.airlines.get(Number(id)); return a ? a.name : ''; },
    countries: null, countriesLoading: null,
    loadCountries() {
      if (this.countries) return Promise.resolve(this.countries);
      if (!this.countriesLoading) this.countriesLoading = this.cached('countries', 30 * 864e5, () => fr24Json('/mobile/countries', 20000).then(j => (Array.isArray(j && j.data) ? j.data : []).filter(c => c && c.id).map(c => [c.id, clean(c.code && c.code.alpha2).toUpperCase(), clean(c.name && c.name.default).toUpperCase()]))).then(rows => {
        const map = new Map();
        for (const [id, a2, nm] of rows) { if (a2) map.set(a2, id); if (nm) map.set(nm, id); }
        this.countries = map; log('countries loaded', map.size); return map;
      }).catch(e => { this.countriesLoading = null; throw e; });
      return this.countriesLoading;
    },
    aircraftInfo(reg) {
      return fr24Json(`/v1/search/web/find?query=${encodeURIComponent(reg)}&limit=10`).then(j => {
        const r = (Array.isArray(j && j.results) ? j.results : []).find(x => x && x.type === 'aircraft' && String(x.id).toUpperCase() === reg.toUpperCase()) || null;
        if (!r) return null;
        const d = r.detail || {};
        return { operatorId: Number(d.operator_id) || 0, operatorIcao: clean(d.owner).toUpperCase(), hex: clean(d.hex).toLowerCase(), equip: clean(d.equip).toUpperCase() };
      });
    },
    boards: new Map(),
    board(airportId, kind) {
      const key = airportId + '/' + kind, cur = this.boards.get(key);
      if (cur && now() - cur.at < 120000) return Promise.resolve(cur.data);
      if (cur && cur.loading) return cur.loading;
      const loading = fr24Json(`/api/v1/airports/${airportId}/${kind}?limit=100`, 12000, 800).then(j => { const data = (Array.isArray(j && j.data) ? j.data : []).filter(e => e && !e.__tlAdded); this.boards.set(key, { at: now(), data }); return data; })
        .catch(e => { this.boards.set(key, { at: now() - 60000, data: cur ? cur.data : [] }); throw e; });
      this.boards.set(key, { at: cur ? cur.at : 0, data: cur ? cur.data : [], loading });
      return loading;
    },
    // The filed flight plan of a blocked flight: FR24's airport boards list it (as N/A) with its flight id.
    async plan(id, originId, destIds) {
      const id16 = id.toString(16), found = { originId: 0, destId: 0 };
      const take = (e, kind, apId) => {
        if (kind === 'departures') { found.originId = apId; found.destId = Number(e.airportId) || 0; found.std = Number(e.scheduledTime) || 0; found.etd = Number(e.estimatedTime) || 0; }
        else { found.destId = apId; found.originId = Number(e.airportId) || 0; found.sta = Number(e.scheduledTime) || 0; found.eta = Number(e.estimatedTime) || 0; }
        found.status = e.status && e.status.name || ''; found.live = !!(e.status && e.status.live); found.divertedToId = Number(e.divertedToId) || 0; found.airlineId = Number(e.airlineId) || 0; found.airline = clean(e.airline); found.at = now();
      };
      if (originId) { try { const e = (await this.board(originId, 'departures')).find(x => x.flight && x.flight.id === id16); if (e) take(e, 'departures', originId); } catch (e) { log('board', originId, String(e.message || e)); } }
      const arrivalsAt = async apId => { try { const e = (await this.board(apId, 'arrivals')).find(x => x.flight && x.flight.id === id16); if (e) { take(e, 'arrivals', apId); return true; } } catch (e) { log('board', apId, String(e.message || e)); } return false; };
      if (found.destId) await arrivalsAt(found.destId);
      else for (const apId of (destIds || []).slice(0, 2)) { if (await arrivalsAt(apId)) break; }
      return found.originId || found.destId ? found : null;
    },
    // An aircraft's flights as FR24's own schedule lists them (its registration lookup): callsign, flight number, flight
    // id, airports and times. For an ordinary flight its live panel shows without airports: a crew already on the next
    // callsign at the gate before FR24 has matched it - RYR32AE, just in at Liverpool from Dublin, was FR449 Liverpool ->
    // Dublin at 18:40 in FR24's own schedule while the panel had no airports.
    schedules: new Map(),
    flightsOf(reg, bg) {
      reg = clean(reg).toUpperCase(); if (!reg) return Promise.resolve([]);
      const cur = this.schedules.get(reg);
      if (cur && cur.loading) return cur.loading;
      if (cur && now() - cur.at < 5 * 60000) return Promise.resolve(cur.rows);
      const url = `https://api.flightradar24.com/common/v1/flight/list.json?query=${encodeURIComponent(reg)}&fetchBy=reg&page=1&limit=25`;
      const apOf = a => { const c = a && a.code; const ap = c && ((c.icao && ENGINE.byIcao(c.icao)) || (c.iata && airports.byIata.get(clean(c.iata).toUpperCase()))); return ap ? ap.id : 0; };
      const loading = (async () => {
        let j = null;
        try { j = await gmRequest(url, { timeout: 10000, priority: !bg, bg: !!bg }); } catch (e) { j = null; }
        if (!(j && j.result && j.result.response)) { try { const pw = pageWindow(), pf = typeof pw.fetch === 'function' ? pw.fetch.bind(pw) : fetch; const res = await pf(url, { credentials: 'omit' }); if (res.ok) j = await res.json(); } catch (e) { /* none */ } }
        const data = (j && j.result && j.result.response && Array.isArray(j.result.response.data)) ? j.result.response.data : [];
        const rows = data.map(f => {
          const idn = f.identification || {}, tm = f.time || {}, sc = tm.scheduled || {}, re = tm.real || {}, es = tm.estimated || {};
          return { id: parseInt(idn.id, 16) || 0, cs: clean(idn.callsign).toUpperCase(), num: clean(idn.number && idn.number.default).toUpperCase(), o: apOf(f.airport && f.airport.origin), d: apOf(f.airport && f.airport.destination), std: Number(sc.departure) || 0, sta: Number(sc.arrival) || 0, atd: Number(re.departure) || 0, ata: Number(re.arrival) || 0, eta: Number(es.arrival) || 0 };
        });
        if (j && j.result && j.result.response) try {
          const resp = j.result.response, ai = resp.aircraftInfo, hex = (store.byReg(reg) || {}).hex || clean(ai && ai.hex).toLowerCase();
          if (/^[0-9a-f]{6}$/.test(hex || '')) {
            noteFr24Info(hex, ai);
            // (FR24 knows the aircraft and lists none of its flights: blocked - LADD or the like - if it has flown lately)
            if (resp.data === null && ai && clean(ai.registration).toUpperCase() === reg) noteFr24Blocked(hex, reg);
          }
          boardNoteSched(hex, rows, { reg });
        } catch (e) { log('board schedule', e); }
        this.schedules.set(reg, { at: now(), rows }); if (this.schedules.size > 60) this.schedules.delete(this.schedules.keys().next().value);
        return rows;
      })().catch(() => { const rows = cur ? cur.rows : []; this.schedules.set(reg, { at: now() - 4 * 60000, rows }); return rows; });
      this.schedules.set(reg, { at: cur ? cur.at : 0, rows: cur ? cur.rows : [], loading });
      return loading;
    }
  };
  // An aircraft FR24 knows but lists no flight of: hidden by FR24 (LADD and the like) - only if it has flown in the last
  // six days (FR24 lists a week of flights; one parked longer is listed with none as well: NASA's retired 747SP N747NA).
  // Flown: a flight of it kept here, or a track of it on adsb.lol today or yesterday.
  const blkAsked = new Map();
  function noteFr24Blocked(hex, reg) {
    hex = clean(hex).toLowerCase(); const hx = store.getHex(hex) || {};
    if (!/^[0-9a-f]{6}$/.test(hex) || hx.fr24Blocked || now() - (blkAsked.get(hex) || 0) < 6 * 3600e3) return Promise.resolve();
    blkAsked.set(hex, now()); if (blkAsked.size > 2000) blkAsked.delete(blkAsked.keys().next().value);
    return (async () => {
      let flew = (hx.recent || []).some(x => nowS() - (x[1] || 0) < 6 * 86400);
      for (const d of flew ? [] : ['', dayStr(now() - 864e5)]) { try { const j = await fetchTrace(hex, d, { bg: true, back: d ? 1 : 0 }); if (j && Array.isArray(j.trace) && j.trace.length) { flew = true; break; } } catch (e) { /* not that day */ } }
      if (flew) store.mergeHex(hex, { reg: clean(reg).toUpperCase() || hx.reg, ladd: true, fr24Blocked: true });
    })().catch(() => {});
  }
  // (a flag set by 22.14.0-22.14.1 without that check: let go once, and found again where it holds)
  store.kvReady.then(() => { if (store.kvGet('blkFix1')) return; for (const [h, v] of store.allHex()) if (v && v.fr24Blocked) store.mergeHex(h, { fr24Blocked: false, ladd: !!(traceMeta.get(h) && traceMeta.get(h).flags & 8) }); store.kvSet('blkFix1', 1); }).catch(() => {});
  // FR24 country id: from its own country list, or from the airport list (which carries country + countryId pairs).
  const countryIdByName = new Map();
  function countryIdOf(iso, name) {
    const a = fr24.countries && ((iso && fr24.countries.get(String(iso).toUpperCase())) || (name && fr24.countries.get(String(name).toUpperCase())));
    return a || (name && countryIdByName.get(String(name).toUpperCase())) || 0;
  }

  // ---- airports (FR24's own list: ids are the ScheduleInfo id space) -> the route engine ----------------------------
  // Kept on disk: a refresh has every airport - and so every route - at once; the network copy is re-read in the
  // background every few days.
  const airports = { list: null, loading: null, byId: new Map(), byIata: new Map() };
  const airportsReady = () => !!airports.list;
  const AP_FIELDS = ['id', 'iata', 'icao', 'name', 'city', 'country', 'countryId', 'lat', 'lon', 'alt', 'size', 'tz', 'timezone'];
  // The airport list's spelling of a country ("Czechia", "Isle Of Man", "Bosnia And Herzegovina"): what the engine
  // compares an aircraft's country of registration with. A Czech aircraft ("Czech Republic") was never "going home".
  const COUNTRY_ALIAS = { 'czech republic': 'czechia', 'dr congo': 'democratic republic of the congo', myanmar: 'myanmar (burma)', 'british virgin islands': 'virgin islands british', 'falkland islands': 'falkland islands (malvinas)' };
  let apCountries = null;
  function apCountry(name) {
    if (!name) return '';
    if (!apCountries && airports.list) { apCountries = new Map(); for (const a of airports.list) if (a.country) apCountries.set(String(a.country).toLowerCase(), a.country); }
    const k = String(name).toLowerCase(), m = apCountries && apCountries.get(COUNTRY_ALIAS[k] || k);
    return m || name;
  }
  function buildAirports(list) {
    apCountries = null;
    airports.list = list; airports.byId = new Map(); airports.byIata = new Map();
    for (const a of list) { airports.byId.set(a.id, a); if (a.iata) airports.byIata.set(a.iata, a); if (a.country && a.countryId) countryIdByName.set(a.country.toUpperCase(), a.countryId); }
    ENGINE.setAirports(list);
    applyLearnedUsage();
    return list;
  }
  function fetchAirports() {
    return fr24Json('/mobile/airports/format/4?version=0', 30000).then(j => {
      const rows = Array.isArray(j && j.rows) ? j.rows : [];
      const list = rows.filter(a => fin(a.lat) && fin(a.lon) && a.id).map(a => ({ id: a.id, iata: clean(a.iata), icao: clean(a.icao), name: clean(a.name), city: clean(a.city), country: clean(a.country), countryId: a.countryId || 0, lat: a.lat, lon: a.lon, alt: Number(a.alt) || 0, size: Number(a.size) || 0, tz: a.timezone && fin(a.timezone.offset) ? a.timezone.offset : null, timezone: a.timezone || null }));
      if (list.length > 1000) store.kvSet('airports', { at: now(), rows: list.map(a => AP_FIELDS.map(k => a[k])) });
      return list;
    });
  }
  function loadAirports() {
    if (airports.list) return Promise.resolve(airports.list);
    if (!airports.loading) {
      // the disk copy (a few ms once IndexedDB is open); the network only when there is none
      airports.loading = Promise.race([store.kvReady, sleep(900)]).then(() => {
        const c = store.kvGet('airports');
        if (c && Array.isArray(c.rows) && c.rows.length > 1000) {
          buildAirports(c.rows.map(r => { const a = {}; AP_FIELDS.forEach((k, i) => { a[k] = r[i]; }); return a; }));
          log('airports from cache', airports.list.length);
          if (now() - (c.at || 0) > 3 * 864e5) setTimeout(() => fetchAirports().catch(() => {}), 20000);
          return airports.list;
        }
        return fetchAirports().then(list => { buildAirports(list); log('airports loaded', list.length); return list; });
      }).catch(e => { airports.loading = null; throw e; });
    }
    return airports.loading;
  }
  // Runways of every airport (OurAirports, public domain): an aircraft lined up with a runway is landing there. Fetched
  // once in the background, kept on disk; reasoning works without them until they are in.
  const RWY_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv';
  let runwaysLoading = null;
  function loadRunways() {
    if (runwaysLoading) return runwaysLoading;
    runwaysLoading = loadAirports().then(async () => {
      // (runway ends for approach geometry, and each airport's longest runway / surface: can this aircraft land there)
      const c = store.kvGet('rwy3');   // (rwy3: with lighting and width - asked again once)
      if (c && c.map && Object.keys(c.map).length > 1000) {
        ENGINE.setRunways(c.map); if (c.len) ENGINE.setRunwayLengths(c.len);
        if (now() - (c.at || 0) < 90 * 864e5) return true;
      }
      const csv = await gmRequest(RWY_URL, { timeout: 60000, json: false, accept: 'text/csv,text/plain', bg: true });
      const icaos = new Set(airports.list.map(a => String(a.icao || '').toUpperCase()).filter(Boolean));
      const map = ENGINE.parseRunwaysCsv(csv, k => icaos.has(k)), len = ENGINE.parseRunwayLengths(csv, k => icaos.has(k));
      if (Object.keys(map).length > 1000) { store.kvSet('rwy3', { at: now(), map, len }); store.kvSet('rwy2', null); store.kvSet('rwy1', null); ENGINE.setRunways(map); ENGINE.setRunwayLengths(len); log('runways', Object.keys(map).length, 'airports'); }
      return true;
    }).catch(e => { log('runways', String(e.message || e)); runwaysLoading = null; return false; });
    return runwaysLoading;
  }
  // Landing sites FR24 does not list - heliports (hospitals, companies, estates), private strips, seaplane bases - from
  // OurAirports (public domain): a helicopter or light aircraft down away from every airport is named where it is
  // ("Royal London Hospital Helipad", "Private site near Henley") instead of being left blank. Fetched once, the first
  // time one is needed, and kept on disk for three months (a compact copy, read only when needed).
  const SITES_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
  const SITE_KIND = { heliport: 'H', small_airport: 'S', seaplane_base: 'W', medium_airport: 'M' };
  const sites = { grid: null, loading: null, n: 0 };
  function csvCells(s) {
    const out = []; let cur = '', qt = false;
    for (let i = 0; i < s.length; i++) { const c = s[i]; if (qt) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else qt = false; } else cur += c; } else if (c === '"') qt = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
    out.push(cur); return out;
  }
  async function parseSitesCsv(csv) {
    const lines = String(csv || '').split(/\r?\n/), head = csvCells(lines[0] || ''), ix = k => head.indexOf(k), rows = [];
    const [cT, cN, cLa, cLo, cE, cM, cI, cG, cId] = ['type', 'name', 'latitude_deg', 'longitude_deg', 'elevation_ft', 'municipality', 'icao_code', 'gps_code', 'ident'].map(ix);
    if (cT < 0 || cLa < 0) return rows;
    for (let i = 1; i < lines.length; i++) {
      if (i % 4000 === 0) await sleep(0);                                  // (a big file: the page keeps responding)
      const l = lines[i]; if (!l) continue;
      const r = csvCells(l), kind = SITE_KIND[r[cT]]; if (!kind) continue;
      const lat = +r[cLa], lon = +r[cLo]; if (!fin(lat) || !fin(lon)) continue;
      rows.push([Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, kind, r[cN] || '', r[cI] || r[cG] || r[cId] || '', r[cM] || '', Math.round(+r[cE] || 0)]);
    }
    return rows;
  }
  function buildSites(rows) { const g = new Map(); for (const r of rows) { const k = Math.floor(r[0] * 20) * 10000 + Math.floor(r[1] * 20); let c = g.get(k); if (!c) g.set(k, c = []); c.push(r); } sites.grid = g; sites.n = rows.length;
    // the airfields FR24 does not list, for the route engine: where light aircraft land and take off, fly circuits - and
    // where they may be going (Borkenberge, Slany, a farm strip)
    try { ENGINE.setFields(rows.filter(r => r[2] === 'S' || r[2] === 'M').map(r => ({ lat: r[0], lon: r[1], alt: r[6], ident: r[4], name: r[3], city: r[5] }))); } catch (e) { log('airfields', e); }
  }
  function loadSites() {
    if (sites.grid) return Promise.resolve(true);
    if (sites.loading) return sites.loading;
    sites.loading = (async () => {
      const c = await store.getHist('b:sites1');
      if (c && Array.isArray(c.rows) && c.rows.length > 10000) { buildSites(c.rows); if (now() - (c.at || 0) < 90 * 864e5) return true; }
      const rows = await parseSitesCsv(await gmRequest(SITES_URL, { timeout: 90000, json: false, accept: 'text/csv,text/plain', bg: true }));
      if (rows.length > 10000) { store.setHist('b:sites1', { at: now(), rows }); buildSites(rows); log('landing sites', rows.length); }
      return !!sites.grid;
    })().catch(e => { log('landing sites', String(e.message || e)); sites.loading = null; return false; });
    return sites.loading;
  }
  // the nearest site within km (of the given kinds, and passing ok()); starts the load when the list is not in yet
  function siteNear(lat, lon, km, kinds, ok) {
    if (!sites.grid) { loadSites(); return null; }
    if (!fin(lat) || !fin(lon)) return null;
    let best = null, bd = km; const la = Math.floor(lat * 20), lo = Math.floor(lon * 20), n = Math.ceil(km / 5) + 1;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const c = sites.grid.get((la + i) * 10000 + lo + j); if (!c) continue;
      for (const r of c) { if (kinds && !kinds.includes(r[2])) continue; if (ok && !ok(r)) continue; const d = ENGINE.dist(lat, lon, r[0], r[1]); if (d < bd) { bd = d; best = r; } }
    }
    return best ? { row: best, dist: bd } : null;
  }
  const heliportNear = (lat, lon, km) => { const n = siteNear(lat, lon, km, 'H'); return n ? { lat: n.row[0], lon: n.row[1], dist: n.dist, name: n.row[3] } : null; };
  // ---- places OurAirports does not have, from OpenStreetMap (Overpass): hospital helipads and offshore platforms ------
  // A helicopter down at Southmead Hospital was "a private site near Bristol" - the pad is in OpenStreetMap, not in
  // OurAirports. One small query per spot (0.001°), asked in the background and kept on disk; answers: a named helipad
  // or heliport, a hospital (its pad), an offshore platform.
  const OSM_URL = 'https://overpass-api.de/api/interpreter';
  // (asked through the page - Overpass answers a browser's own request - and directly when the page does not answer)
  const osmPending = new Map(); let osmSeq = 0;
  function osmFetch(url, ms) {
    return new Promise((res, rej) => {
      const key = 'o' + (++osmSeq), timer = setTimeout(() => { osmPending.delete(key); gmRequest(url, { timeout: ms, bg: true }).then(res, rej); }, ms);
      osmPending.set(key, j => { clearTimeout(timer); osmPending.delete(key); if (j) res(j); else gmRequest(url, { timeout: ms, bg: true }).then(res, rej); });
      postToPage('osmReq', { key, url });
    });
  }
  function onOsmRes(d) { const f = d && osmPending.get(d.key); if (f) f(d.j || null); }
  let osmCache = null, osmSaveT = 0; const osmWaiters = new Map();
  const osmKey = (lat, lon) => lat.toFixed(3) + ',' + lon.toFixed(3);
  function osmStore() { if (!osmCache) { const kv = store.kvGet('osm2') || {}; osmCache = new Map(Object.entries(kv)); } return osmCache; }
  function osmSave() { if (osmSaveT) return; osmSaveT = setTimeout(() => { osmSaveT = 0; const m = osmStore(); const e = [...m.entries()].filter(([, v]) => v && !v.pending).slice(-3000); store.kvSet('osm2', Object.fromEntries(e)); }, 4000); }
  // (most platforms carry no name in OpenStreetMap: its seamark name, or the operator's)
  const platName = t => (t && (t.name || t['seamark:name'])) || ('Offshore platform' + (t && t.operator ? ' (' + t.operator + ')' : ''));
  // What OpenStreetMap calls a landing place, anywhere: its pad or strip by name (Greenbank Helipad); a hospital's pad by
  // the hospital; else the named place it lies in - the smallest, never a town, county or the like (Aintree Racecourse);
  // else the named place beside it, within 250 m - a park, a farm, a hall, works (Axis Business Park); an offshore platform.
  // One question for all of it; the answer is kept for the spot (~100 m).
  const osmQuery = (lat, lon) => { const p = `${lat.toFixed(5)},${lon.toFixed(5)}`; return `[out:json][timeout:20];(nwr(around:500,${p})["aeroway"~"^(helipad|heliport|aerodrome|airstrip)$"];nwr(around:600,${p})["amenity"="hospital"]["name"];nwr(around:2500,${p})["man_made"="offshore_platform"];nwr(around:250,${p})["name"][!"highway"][!"boundary"][!"waterway"][!"railway"][!"route"][!"public_transport"][!"power"][!"natural"][!"shop"];);out center tags 80;is_in(${p})->.a;(way(pivot.a)["name"];rel(pivot.a)["name"];);out tags bb 20;`; };
  const OSM_SKIP = /^(boundary|admin_level|natural|waterway|highway|railway|route|public_transport|power|shop)$/;
  const osmSkip = t => !t || !t.name || Object.keys(t).some(k => OSM_SKIP.test(k)) || (t.place && !/^(farm|isolated_dwelling|locality|estate)$/.test(t.place)) || /^(residential|farmland|meadow|grass|forest|orchard|allotments)$/.test(t.landuse || '');
  function osmPick(els, lat, lon) {
    const tg = e => e.tags || {}, at = e => e.lat != null ? { lat: e.lat, lon: e.lon } : e.center ? { lat: e.center.lat, lon: e.center.lon } : e.bounds ? { lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lon: (e.bounds.minlon + e.bounds.maxlon) / 2 } : { lat: NaN, lon: NaN };
    const dist = e => { const p = at(e); return fin(p.lat) ? ENGINE.dist(lat, lon, p.lat, p.lon) : 99; }, byD = arr => arr.slice().sort((a, b) => dist(a) - dist(b));
    const pads = byD(els.filter(e => !e.bounds && /^(helipad|heliport|aerodrome|airstrip)$/.test(tg(e).aeroway || '') && dist(e) <= 0.5));
    const named = pads.find(e => tg(e).name && dist(e) <= 0.4), pad = pads.find(e => dist(e) <= 0.4), pos = pad ? at(pad) : { lat, lon };
    if (named) return Object.assign({ name: tg(named).name, kind: 'pad' }, at(named));
    const hosp = byD(els.filter(e => !e.bounds && tg(e).amenity === 'hospital' && tg(e).name && dist(e) <= 0.6))[0];
    if (hosp) return Object.assign({ name: tg(hosp).name, kind: 'hospital' }, pos);
    const area = els.filter(e => e.bounds && !osmSkip(tg(e))).map(e => ({ e, a: (e.bounds.maxlat - e.bounds.minlat) * (e.bounds.maxlon - e.bounds.minlon) })).filter(x => x.a < 0.004).sort((x, y) => x.a - y.a)[0];
    if (area) return Object.assign({ name: tg(area.e).name, kind: 'area' }, pos);
    const near = byD(els.filter(e => !e.bounds && !osmSkip(tg(e)) && !tg(e).aeroway && tg(e).amenity !== 'hospital' && tg(e).man_made !== 'offshore_platform' && dist(e) <= 0.25))[0];
    if (near) return Object.assign({ name: tg(near).name, kind: 'near' }, pos);
    const plat = byD(els.filter(e => tg(e).man_made === 'offshore_platform'))[0];
    return plat ? Object.assign({ name: platName(tg(plat)), kind: 'platform' }, at(plat)) : null;
  }
  // (the public Overpass server is often too busy: a mirror then - one without the area index, so no "lies in")
  const OSM_MIRROR = 'https://overpass.private.coffee/api/interpreter';
  function osmPlaceAt(lat, lon) { if (!fin(lat) || !fin(lon)) return undefined; const v = osmStore().get(osmKey(lat, lon)); return v && !v.pending ? v.place : undefined; }
  function wantOsmPlace(lat, lon, onNew) {
    if (!fin(lat) || !fin(lon)) return; const k = osmKey(lat, lon), m = osmStore(), v = m.get(k);
    if (onNew) { const w = osmWaiters.get(k) || []; w.push(onNew); osmWaiters.set(k, w); }
    if (v && (!v.pending || now() - v.at < 60000) && !(v.err && now() - v.at > 3600e3)) return;
    m.set(k, { at: now(), pending: true });
    const qs = '?data=' + encodeURIComponent(osmQuery(lat, lon)), ok = j => j && Array.isArray(j.elements) ? j : Promise.reject(new Error('Overpass busy'));
    osmFetch(OSM_URL + qs, 25000).then(ok).catch(() => osmFetch(OSM_MIRROR + qs, 25000).then(ok)).then(j => {
      const place = osmPick(j.elements, lat, lon);
      m.set(k, { at: now(), place }); osmSave();
      const w = osmWaiters.get(k) || []; osmWaiters.delete(k); if (place) for (const fn of w) { try { fn(place); } catch (e) { /* ignore */ } }
    }).catch(e => { m.set(k, { at: now(), place: null, err: true }); log('osm', String(e.message || e)); });
  }
  // offshore platforms ahead of a helicopter (bound out to sea): within 25° of its track, 3-150 km
  const osmAhead = new Map();   // cell -> { at, list }
  function platformsAhead(pos, onNew) {
    if (!pos || !fin(pos.trk)) return null;
    const [cLat, cLon] = ENGINE.destPoint(pos.lat, pos.lon, pos.trk, 70), c = { lat: cLat, lon: cLon }, key = c.lat.toFixed(1) + ',' + c.lon.toFixed(1), v = osmAhead.get(key);
    const pick = list => list.map(p => Object.assign({ d: ENGINE.dist(pos.lat, pos.lon, p.lat, p.lon), off: ENGINE.angDiff(pos.trk, ENGINE.brg(pos.lat, pos.lon, p.lat, p.lon)) }, p)).filter(p => p.d >= 3 && p.d <= 150 && p.off <= 25).sort((a, b) => a.d - b.d);
    if (v && !v.pending) return pick(v.list);
    if (v && now() - v.at < 60000) return null;
    osmAhead.set(key, { at: now(), pending: true, list: [] });
    const q = `[out:json][timeout:20];nwr(around:80000,${c.lat.toFixed(4)},${c.lon.toFixed(4)})["man_made"="offshore_platform"];out center tags 200;`;
    osmFetch(OSM_URL + '?data=' + encodeURIComponent(q), 25000).then(j => {
      const list = ((j && j.elements) || []).map(e => ({ name: platName(e.tags), lat: e.lat != null ? e.lat : e.center && e.center.lat, lon: e.lon != null ? e.lon : e.center && e.center.lon })).filter(p => fin(p.lat));
      osmAhead.set(key, { at: now(), list }); if (osmAhead.size > 200) osmAhead.delete(osmAhead.keys().next().value);
      if (list.length && onNew) onNew();
    }).catch(() => osmAhead.set(key, { at: now(), list: [] }));
    return null;
  }
  // A place away from FR24's airports: a listed pad / strip there, else what OpenStreetMap names there (a hospital's
  // helipad, an offshore platform - asked once, the route worked out again when it answers), else "Private site near
  // <town>". Its code is the site's ICAO code when it has one (London Heliport: EGLW), otherwise PVT; its time zone that
  // of the nearest airport.
  function privatePlace(lat, lon, opts) {
    const heli = !!(opts && opts.heli), generic = !!(opts && opts.generic);
    const near = ENGINE.airportAt(lat, lon, 150), tzId = near ? near.airport.id : 0;
    if (generic) return { code: 'PVT', name: 'Private site', lat: NaN, lon: NaN, alt: near ? near.airport.alt || 0 : 0, tzId, known: '' };
    const k = siteNear(lat, lon, heli ? 0.35 : 1.5, heli ? 'HWSM' : 'SWMH'), s = k && k.row;
    if (!s) { const o = osmPlaceAt(lat, lon); if (o) return { code: 'PVT', name: o.name, lat: o.lat, lon: o.lon, alt: near ? near.airport.alt || 0 : 0, tzId, known: o.kind }; if (o === undefined) wantOsmPlace(lat, lon, opts && opts.onNew); }
    // (the town: the nearest one OurAirports names within 10 km, else 25 km)
    const town = s ? null : siteNear(lat, lon, 10, null, r => !!r[5]) || siteNear(lat, lon, 25, null, r => !!r[5]);
    return { code: s && /^[A-Z]{4}$/.test(s[4]) ? s[4] : 'PVT', name: s ? (s[2] === 'H' ? s[3] : ENGINE.fieldShortName(s[3])) : 'Private site' + (town ? ' near ' + town.row[5] : ''), lat: s ? s[0] : lat, lon: s ? s[1] : lon, alt: s ? s[6] : (near ? near.airport.alt || 0 : 0), tzId, known: s ? s[2] : '' };
  }
  // ---- landing places learned: every spot an aircraft was seen down at away from FR24's airports - a strip FR24 does not
  // list, a pad, a farm field - gets a lasting id (9,000,001 on) and its name (as privatePlace gives it), the same each
  // time anything lands there again, kept for good. The page adds them to FR24's own airport list, so its boards, cards
  // and panel name them ("Ormskirk PVT") where they said "N/A", and the route engine's flights end there by name.
  let siteBook = null, siteSaveT = 0;
  const siteBk = () => siteBook;
  store.kvReady.then(() => { siteBook = store.kvGet('sites2') || { n: 0, list: [] }; }).catch(() => {});
  const genericSite = s => /^Private site( near |$)/.test(s.name) && !s.named;
  function siteNearBook(lat, lon, km) { const bk = siteBk(); if (!bk || !fin(lat) || !fin(lon)) return null; let best = null, bd = km; for (const s of bk.list) { const d = ENGINE.dist(lat, lon, s.lat, s.lon); if (d < bd) { bd = d; best = s; } } return best; }
  function siteIdAt(lat, lon) { const s = siteNearBook(lat, lon, 1.5); return s ? s.id : 0; }
  function learnSite(lat, lon, opts) {
    const bk = siteBk(); if (!bk || !fin(lat) || !fin(lon) || ENGINE.airports.length < 1000) return 0;
    if (!sites.grid) { loadSites(); return 0; }                     // (named once the list of strips and towns is in)
    const heli = !!(opts && opts.heli), p = privatePlace(lat, lon, { heli, onNew: () => learnSite(lat, lon, opts) });
    const ref = ENGINE.airportAt(lat, lon, 300); if (!p || !ref) return 0;
    const town = /^Private site near /.test(p.name) ? p.name.slice(18) : '', named = p.known && p.known !== '';
    let s = siteNearBook(lat, lon, 1.5);
    if (s) {
      s.last = nowS();
      // (a name worked out better since - OpenStreetMap's pad answered, the strip list came in)
      if (genericSite(s) && (named || (town && s.name === 'Private site'))) { Object.assign(s, { name: p.name, city: town || ENGINE.fieldShortName(p.name) || p.name, code: p.code || 'PVT', named }); sitesSoon(); }
      return s.id;
    }
    s = { id: SITE_BASE + (++bk.n), lat: Math.round((fin(p.lat) ? p.lat : lat) * 1e5) / 1e5, lon: Math.round((fin(p.lon) ? p.lon : lon) * 1e5) / 1e5, name: p.name, city: town || ENGINE.fieldShortName(p.name) || p.name, code: p.code || 'PVT', apId: ref.airport.id, alt: Math.round(p.alt || 0), n: 1, first: nowS(), last: nowS(), named };
    bk.list.push(s);
    if (bk.list.length > 1500) bk.list = bk.list.sort((a, b) => b.last - a.last).slice(0, 1500);
    log('landing place learned', s.id, s.name, s.lat, s.lon);
    sitesSoon(); return s.id;
  }
  // (the landing places learned before OpenStreetMap was asked for each, or while it was too busy to answer: one a
  // minute, renamed as it answers - Aintree Racecourse for 'Private site near Liverpool')
  setInterval(() => { const bk = siteBk(); if (!bk || !sites.grid || document.hidden) return; const s = bk.list.find(x => genericSite(x) && !(nowS() - (x.osmTry || 0) < 86400)); if (!s) return; s.osmTry = nowS(); privatePlace(s.lat, s.lon, { onNew: () => learnSite(s.lat, s.lon) }); }, 60000);
  // (as FR24's own airport list has its airports)
  function siteRow(s) {
    const ref = airports.byId.get(s.apId) || {}, icao = /^[A-Z]{4}$/.test(s.code || '') ? s.code : '';
    return { id: s.id, iata: s.code || 'PVT', icao, name: s.name, city: s.city, country: ref.country || '', countryId: ref.countryId || 0, lat: s.lat, lon: s.lon, alt: s.alt || 0, size: 1, timezone: ref.timezone || { abbr: 'UTC', abbrName: null, isDst: false, name: 'UTC', offset: 0, offsetHours: '0:00' }, videoStream: null };
  }
  function siteAp(id) { const bk = siteBk(), s = bk && bk.list.find(x => x.id === id); if (!s) return null; const r = siteRow(s); return Object.assign({}, r, { tz: r.timezone.offset, code: r.iata, site: true }); }
  function pushSites() { const bk = siteBk(); if (bk && bk.list.length) postToPage('sites', { list: bk.list.map(siteRow) }); }
  function sitesSoon() { if (siteSaveT) return; siteSaveT = setTimeout(() => { siteSaveT = 0; store.kvSet('sites2', siteBk()); pushSites(); }, 3000); }
  // (an unlisted airfield - an id from the route engine's field list - answers too; and a learned landing place)
  const apById = id => (id && (airports.byId.get(id) || (id >= 1e7 ? ENGINE.byId(id) : isSiteId(id) ? siteAp(id) : null))) || null;
  // what FR24's own panel and boards can be given: its airports, and the landing places it has been given (a strip of
  // the route engine's, by where it is)
  const fr24Ap = id => !id ? 0 : id < 1e7 ? id : (a => a ? siteIdAt(a.lat, a.lon) : 0)(ENGINE.byId(id));
  const apCode = a => a ? (a.iata || a.icao || String(a.id)) : '';
  // Learned usage: every flight log this script reconstructs, and every parked LADD aircraft it sees, adds to the
  // business-aviation usage prior on top of the shipped table - so the model keeps getting better where it is used.
  let usageLearned = null, usageTimer = 0;
  function applyLearnedUsage() { usageLearned = usageLearned || store.kvGet('usage') || {}; for (const [k, v] of Object.entries(usageLearned)) { const [kind, icao] = k.includes(':') ? k.split(':') : ['use', k]; ENGINE.addUsage(icao, v, kind); } }
  function usageAdd(icao, w, kind) {
    if (!icao) return; usageLearned = usageLearned || store.kvGet('usage') || {};
    kind = kind || 'use'; const key = kind + ':' + icao;
    if ((usageLearned[key] || 0) >= 60) return;
    usageLearned[key] = (usageLearned[key] || 0) + w; ENGINE.addUsage(icao, w, kind);
    if (!usageTimer) usageTimer = setTimeout(() => { usageTimer = 0; store.kvSet('usage', usageLearned); }, 5000);
  }

  // Learning from use: every completed flight in a log this script reconstructs (the selected aircraft's, and the logs
  // it backfills for everything it identifies) teaches the engine where business aviation goes from where, how the
  // transponder's code block / FMS altitude relate to the trip length, and when flights land - once per flight, kept on
  // disk (the latest 100,000) and replayed after start, in idle moments. The shipped tables are the starting point; this
  // is what the user's own corner of the world adds to them - and the destinations the user confirms ("confirm").
  // (kept in chunks of 5,000 in the logs store, read after start: a new flight rewrites only the newest chunk; the oldest
  // chunk goes as a whole when there are more than 100,000. The older single kv copy, learn2, is moved there once.)
  const LEARN_MAX = 100000, LEARN_CHUNK = 5000;
  let learned = [], learnedKeys = new Set(), learnTimer = 0, learnedApplied = false, learnLoaded = false, learnLoading = null;
  let learnMeta = { first: 0, last: 0 }, learnChunks = new Map();   // chunk index -> entries
  // (learn2 adds the take-off time, callsign, type and the flow-field cells passed through: what the 22.10 tables learn)
  function learnLoad() {
    if (learnLoading) return learnLoading;
    learnLoading = (async () => {
      await store.kvReady;
      const meta = await store.getBlob('learn3:meta');
      let all = [];
      if (meta && Number.isFinite(meta.first)) {
        learnMeta = { first: meta.first, last: meta.last };
        for (let i = meta.first; i <= meta.last; i++) { const c = (await store.getBlob('learn3:' + i)) || []; learnChunks.set(i, c); all = all.concat(c); }
      } else {
        const old = (store.kvGet('learn2') || store.kvGet('learn1') || []).filter(x => Array.isArray(x));
        for (let i = 0; i * LEARN_CHUNK < old.length; i++) learnChunks.set(i, old.slice(i * LEARN_CHUNK, (i + 1) * LEARN_CHUNK));
        learnMeta = { first: 0, last: Math.max(0, learnChunks.size - 1) }; if (!learnChunks.size) learnChunks.set(0, []);
        all = old;
        for (const [i, c] of learnChunks) store.setBlob('learn3:' + i, c);
        store.setBlob('learn3:meta', learnMeta); if (old.length) { store.kvSet('learn2', null); store.kvSet('learn1', null); }
      }
      // (what was learned before the store was read joins it)
      const early = learned; learned = all; learnedKeys = new Set(all.map(x => x[0]));
      learnLoaded = true;
      for (const x of early) learnAppend(x);
      return learned;
    })().catch(e => { learnLoaded = true; log('learned store', e); return learned; });
    return learnLoading;
  }
  function learnAppend(x) {
    if (learnedKeys.has(x[0])) return false;
    learned.push(x); learnedKeys.add(x[0]);
    if (!learnLoaded) return true;
    let c = learnChunks.get(learnMeta.last); if (!c) learnChunks.set(learnMeta.last, c = []);
    if (c.length >= LEARN_CHUNK) { learnMeta.last++; learnChunks.set(learnMeta.last, c = []); }
    c.push(x);
    while ((learnMeta.last - learnMeta.first + 1) * LEARN_CHUNK > LEARN_MAX + LEARN_CHUNK) {
      const gone = learnChunks.get(learnMeta.first) || []; learnChunks.delete(learnMeta.first); store.setBlob('learn3:' + learnMeta.first, undefined); learnMeta.first++;
      const g = new Set(gone.map(y => y[0])); learned = learned.filter(y => !g.has(y[0])); for (const k of g) learnedKeys.delete(k);
    }
    if (!learnTimer) learnTimer = setTimeout(() => { learnTimer = 0; store.setBlob('learn3:' + learnMeta.last, learnChunks.get(learnMeta.last) || []); store.setBlob('learn3:meta', learnMeta); }, 8000);
    return true;
  }
  function learnedStore() { if (!learnLoaded) learnLoad(); return learned; }
  function replayLearned(x) {
    const [, fromId, toId, tEnd, sqs, fmss, cls, mil, tStart, cs, type, flow] = x, from = ENGINE.byId(fromId), to = ENGINE.byId(toId); if (!from || !to) return;
    ENGINE.learnLeg({ from, to, tEnd, tStart: tStart || 0, cs: cs || '', type: type || '', flow: flow ? String(flow).split('|') : [], sqs: sqs ? String(sqs).split(',') : [], fmss: fmss ? String(fmss).split(',') : [], cls, mil: !!mil });
    const milK = !!mil && cls !== 'heavybiz' && cls !== 'bizjet';   // (a government business jet counts as a business jet)
    const kind = milK ? 'useMil' : cls === 'piston' || cls === 'heli' ? 'useGA' : 'use', kindC = milK ? '' : cls === 'heavybiz' || cls === 'airliner' ? 'useHB' : cls === 'bizjet' ? 'useLJ' : '';
    for (const a of [from, to]) if (a.icao) { ENGINE.addUsage(a.icao, 0.25, kind); if (kindC) ENGINE.addUsage(a.icao, 0.25, kindC); }
  }
  // (read, then replayed in idle slices: 100,000 flights at once would hold the page for seconds)
  async function applyLearned() {
    if (learnedApplied || !airportsReady()) return; learnedApplied = true;
    try { const l = (await learnLoad()).slice(); await sliced(l, replayLearned, { ms: 8 }); if (l.length) log('learned from use', l.length, 'flights'); } catch (e) { log('learned replay', e); }
  }
  function learnFromLeg(hex, raw, s, cls, mil) {
    if (!s || !s.from || !s.to || s.from.id === s.to.id || !['ground', 'low'].includes(s.from.conf) || !['ground', 'low'].includes(s.to.conf) || s.tEnd - s.tStart < 480) return;
    // (ordinary airliners - cargo, charters FR24 shows without a route - would teach business-jet habits nothing)
    if (cls === 'airliner' && !(store.getHex(hex) || {}).ladd) return;
    learnedStore();
    const key = hex + '|' + Math.round(s.tStart); if (learnedKeys.has(key)) return;
    // (a destination the user confirmed for this flight stands over the one the track was read as)
    const uc = userDestOf(null, hex, s.tOff || s.tStart);
    if (uc && uc.destId && uc.destId !== s.to.id && ENGINE.byId(uc.destId)) s = Object.assign({}, s, { to: { id: uc.destId, code: uc.code, conf: 'ground' } });
    const sq = new Set(), fm = new Set();
    for (const p of (raw && raw.pts) || []) {
      if (p.alt > 1500 && p.sq && /^[0-7]{4}$/.test(p.sq) && !ENGINE.SQ_NOINFO.test(p.sq)) sq.add(p.sq.slice(0, 2));
      if (p.fms > 5000 && !(p.vr < -500)) fm.add(Math.round(p.fms / 2000));
    }
    const flow = ENGINE.flowKeysOf((raw && raw.pts) || [], ENGINE.byId(s.to.id)).slice(0, 16).join('|');
    const x = [key, s.from.id, s.to.id, Math.round(s.tEnd), [...sq].join(','), [...fm].join(','), cls, mil ? 1 : 0, Math.round(s.tStart), s.cs || '', (acOfHex(hex).type || ''), flow];
    if (learnAppend(x) && learnedApplied) replayLearned(x);
  }

  // The operator an aircraft flies for: FR24's own for it (by name, or from its id or ICAO code - its airline list is
  // kept on disk), else - when the register names no one, a trust company or "Private" - the airline whose ICAO code
  // its callsign carries (TWY26, N67WV, registered to "TVPX Aircraft Solutions Inc Trustee": Solairus Aviation)
  function operatorOf(m, cs) {
    m = m || {};
    const n = ownerName(m.operatorName); if (n) return n;
    const viaId = m.operatorId ? ownerName(fr24.airlineName(m.operatorId)) : ''; if (viaId) return viaId;
    const ofIcao = c => { const id = c && fr24.byIcao.get(c); return id ? ownerName(fr24.airlineName(id)) : ''; };
    const viaCode = ofIcao(String(m.operatorIcao || '').toUpperCase()); if (viaCode) return viaCode;
    if (ownerName(m.owner)) return '';
    const c = String(cs || m.cs || '').toUpperCase().match(/^([A-Z]{3})\d/);
    return c ? ofIcao(c[1]) : '';
  }
  // ... and the name to show for it: that operator, else its registered owner
  const shownOwner = (m, cs) => operatorOf(m, cs) || ownerName(m && m.owner);
  // FR24's airline id for it - what its boards and search draw the logo from: its own, its ICAO code's, its callsign's,
  // else the airline FR24 lists under the very name shown (G-RVRN, registered to Ravenair: Ravenair's logo)
  function operatorIdOf(m, cs) {
    m = m || {};
    if (m.operatorId) return m.operatorId;
    const byCode = c => (c && fr24.byIcao.get(String(c).toUpperCase())) || 0;
    const c3 = (String(cs || m.cs || '').toUpperCase().match(/^([A-Z]{3})\d/) || [])[1];
    return byCode(m.operatorIcao) || byCode(c3) || airlineIdByName(shownOwner(m, cs));
  }
  // (the name itself, else the longest of FR24's names - six letters and more - that it begins with: "Ravenair Aviation")
  const nameIdMemo = new Map();
  function airlineIdByName(name) {
    const k = nameKey(name); if (!k || !fr24.airlines) return 0;
    if (fr24.byName.has(k)) return fr24.byName.get(k);
    if (nameIdMemo.has(k)) return nameIdMemo.get(k);
    let best = 0, bl = 0; for (const [n, id] of fr24.byName) if (n.length >= 6 && n.length > bl && k.startsWith(n)) { best = id; bl = n.length; }
    nameIdMemo.set(k, best); if (nameIdMemo.size > 2000) nameIdMemo.delete(nameIdMemo.keys().next().value);
    return best;
  }
  // FR24's category id (its own list: 0 passenger, 1 cargo, 2 military and government, 3 business jet, 4 general
  // aviation, 5 helicopter, 6 lighter than air, 7 glider) from the route engine's reading of the type - HZ-AR27's 787-10
  // was a "Business jet" on the board's card. Turboprops the engine does not take for airliners (ATR, Dash 8 are): "Other",
  // as FR24's own card has a King Air.
  function fr24Cat(m) {
    const ty = String(m && m.type || '').toUpperCase(); if (!ty && !(m && m.cat)) return undefined;
    const td = ENGINE.typeDesc(ty), cls = ENGINE.classify(m);
    if (td && td[0] === 'G') return 7;
    if (/^BALL|^SHIP$/.test(ty)) return 6;
    if (cls === 'heli') return 5;
    if (m.mil || cls === 'fighter' || cls === 'milheavy') return 2;
    return { airliner: 0, heavybiz: 3, bizjet: 3, piston: 4, turboprop: 10 }[cls];
  }

  // ---- enrichment: identity, operator, MSN, age, photos ------------------------------------------------------------
  // Registry data for US aircraft straight from the FAA: serial number, owner, the owner's city/state and the year
  // (or airworthiness date) that gives the age.
  async function fetchFaa(reg, priority) {
    if (!/^N[0-9][0-9A-Z]{0,4}$/i.test(reg)) return null;
    const html = await gmRequest(`https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(reg.toUpperCase())}`, { accept: 'text/html', json: false, timeout: 15000, priority: !!priority });
    const cell = label => { const re = new RegExp('data-label="' + label.replace(/[()/]/g, m => '\\' + m) + '"[^>]*>([\\s\\S]*?)</td>', 'i'); const m = html.match(re); return m ? clean(m[1].replace(/<[^>]*>/g, ' ')) : ''; };
    const out = { msn: cell('Serial Number'), owner: cell('Name'), city: cell('City'), state: cell('State'), country: cell('Country'), mfrYear: Number(cell('Mfr Year')) || 0, awDate: cell('A/W Date'), model: cell('Model'), maker: cell('Manufacturer Name'), hex: cell('Mode S Code (Base 16 / Hex)').toLowerCase() };
    const aw = out.awDate.match(/(\d{4})$/); out.year = out.mfrYear || (aw ? Number(aw[1]) : 0);
    if (/None/i.test(out.msn)) out.msn = '';
    // "REGISTRATION PENDING" / "SALE REPORTED" is a status, not a name: the applicant listed further down is the owner
    if (NAME_PLACEHOLDER.test(out.owner)) {
      const names = [...html.matchAll(/data-label="Name"[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1].replace(/<[^>]*>/g, ' ')));
      out.owner = (names.find(n => /^applicant\s+\S/i.test(n)) || '').replace(/^applicant\s+/i, '');
    }
    return out.msn || out.owner || out.year ? out : null;
  }
  // The Isle of Man register (M-): owner, serial number, type, Mode S - public pages, a search by mark and then the
  // entry (M-WJBA: Ballycastle Aviation, 680A0466). Asked once per mark per session.
  const iomAsked = new Map();
  function fetchIom(reg, priority) {
    const mark = String(reg || '').toUpperCase().replace(/^M-?/, '');
    if (!/^[A-Z0-9]{1,6}$/.test(mark)) return Promise.resolve(null);
    if (iomAsked.has(mark)) return iomAsked.get(mark);
    const base = 'https://ardis.iomaircraftregistry.com/register/', o = { accept: 'text/html', json: false, timeout: 15000, priority: !!priority };
    const p = (async () => {
      const list = String(await gmRequest(`${base}search?prs_rm__tt=1&prs_rm__v1=${encodeURIComponent(mark)}&prs_bg__2__value=Search`, o) || '');
      const m = list.match(new RegExp('/register/(\\d+)/view">M-' + mark + '<')); if (!m) return null;
      const html = String(await gmRequest(`${base}${m[1]}/view`, o) || '');
      const cell = label => { const x = html.match(new RegExp('>' + label + '</label>\\s*<span[^>]*>([^<]*)<')); return x ? clean(decodeEntities(x[1])) : ''; };
      const owners = cell('Registered Owners'), out = { owner: owners.split(',')[0].trim(), msn: cell('Serial Number'), hex: cell('Mode S Number').toLowerCase(), model: cell('Aircraft Type'), status: cell('Aircraft Status') };
      // (registered new - no previous registration anywhere: built the year it was registered)
      const ry = (cell('Registered').match(/(\d{4})\s*$/) || [])[1]; if (/^new$/i.test(cell('Previous International Registration')) && ry) out.year = Number(ry);
      return out.owner || out.msn ? out : null;
    })();
    iomAsked.set(mark, p); p.catch(() => iomAsked.delete(mark));
    return p;
  }
  // The UK register (G-): the CAA's G-INFO, through the public API its own search page uses - a search by mark, then the
  // entry: the AOC operator if it has one, else the registered owner (its trading name when it has one), serial number,
  // build year, Mode S (G-WAPA, an R44 FR24 calls "Private owner"). Names only - an owner's address is never read.
  const ginfoAsked = new Map();
  function fetchGinfo(reg, priority) {
    const mark = String(reg || '').toUpperCase().replace(/^G-?/, '');
    if (!/^[A-Z0-9]{4}$/.test(mark)) return Promise.resolve(null);
    if (ginfoAsked.has(mark)) return ginfoAsked.get(mark);
    const base = 'https://ginfoapi.caa.co.uk/api/aircraft/', o = { timeout: 15000, priority: !!priority };
    const p = (async () => {
      const list = await gmRequest(base + 'search', Object.assign({ method: 'POST', body: JSON.stringify({ registration: mark }), headers: { 'Content-Type': 'application/json' } }, o));
      const rows = (Array.isArray(list) ? list : []).filter(x => x && String(x.Mark || '').toUpperCase() === mark);
      const hit = rows.find(x => x.RegistrationStatus === 'R') || rows[0]; if (!hit || !hit.AircraftID) return null;
      const j = await gmRequest(base + 'details/' + encodeURIComponent(hit.AircraftID), o); if (!j || typeof j !== 'object') return null;
      const ow = (Array.isArray(j.RegisteredAircraftOwners) ? j.RegisteredAircraftOwners : [])[0] || {}, ad = j.AircraftDetails || {}, aoc = j.AircraftOperatedByAocHolder || {};
      const str = v => typeof v === 'string' ? clean(v) : '';
      const out = { owner: str(aoc.OperatorTrandingAs) || str(aoc.OperatorName) || str(ow.TradingAs) || str(ow.RegisteredOwner), msn: str(ad.SerialNumber), year: Number(ad.YearBuild) || 0, hex: str(ad.ICAO24BitAircraftAddress && ad.ICAO24BitAircraftAddress.Hex).toLowerCase(), registered: hit.RegistrationStatus === 'R' };
      return out.owner || out.msn ? out : null;
    })();
    ginfoAsked.set(mark, p); p.catch(() => ginfoAsked.delete(mark));
    return p;
  }
  // The Swiss register (HB-): FOCA's own search API - main operator, else main owner, serial number, build year, Mode S
  // (HB-JNA: Swiss International Air Lines). Names only - the addresses it also lists are never read.
  const bazlAsked = new Map();
  function fetchBazl(reg, priority) {
    const mark = String(reg || '').toUpperCase();
    if (!/^HB-[A-Z0-9]{3}$/.test(mark)) return Promise.resolve(null);
    if (bazlAsked.has(mark)) return bazlAsked.get(mark);
    const p = (async () => {
      const body = { page_result_limit: 10, current_page_number: 1, sort_list: 'registration', language: 'en', queryProperties: { marketing: '', registration: mark, aircraftStatus: ['Registered', 'Reserved', 'Reservation Expired', 'Registration in Progress'] } };
      const list = await gmRequest('https://app02.bazl.admin.ch/web/bazl-backend/lfr', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, timeout: 15000, priority: !!priority });
      const hit = (Array.isArray(list) ? list : []).find(x => x && String(x.registration).toUpperCase() === mark); if (!hit) return null;
      const who = cat => ((hit.ownerOperators || []).find(o => o && o.holderCategory && o.holderCategory.categoryNames && o.holderCategory.categoryNames.en === cat) || {}).ownerOperator;
      const d = hit.details || {}, str = v => typeof v === 'string' && !/^N\/A$/i.test(v) ? clean(v) : '';
      const out = { owner: str(who('Main Operator')) || str(who('Main Owner')), msn: str(d.serialNumber), year: Number(d.yearOfManufacture) || 0, hex: str(d.aircraftAddresses && d.aircraftAddresses.hex).toLowerCase() };
      return out.owner || out.msn ? out : null;
    })();
    bazlAsked.set(mark, p); p.catch(() => bazlAsked.delete(mark));
    return p;
  }
  // hexdb, adsbdb and (for N-numbers) the FAA registry at the same time - the slowest one sets the pace, not the sum
  async function fetchIdentity(rec, priority, bg) {
    const hex = rec.hex.toUpperCase(), out = {}, o = { priority: !!priority, bg: !!bg };
    const hexdb = gmRequest(`https://hexdb.io/api/v1/aircraft/${hex}`, o).then(h => { if (h && typeof h === 'object') { out.reg = clean(h.Registration).toUpperCase(); out.type = clean(h.ICAOTypeCode).toUpperCase(); out.desc = clean(h.Manufacturer && h.Type ? `${h.Manufacturer} ${h.Type}` : h.Type); out.owner = clean(h.RegisteredOwners); } }).catch(() => { /* 404 is normal */ });
    const adsbdb = gmRequest(`https://api.adsbdb.com/v0/aircraft/${hex}`, o).then(j => { const ac = j && j.response && j.response.aircraft; if (ac) { out.reg2 = clean(ac.registration).toUpperCase(); out.type2 = clean(ac.icao_type).toUpperCase(); out.desc2 = clean(ac.manufacturer && ac.type ? `${ac.manufacturer} ${ac.type}` : ac.type); out.owner2 = clean(ac.registered_owner); out.country = clean(ac.registered_owner_country_name); out.countryIso = clean(ac.registered_owner_country_iso_name); } }).catch(() => { /* ignore */ });
    const faaFor = reg => fetchFaa(reg, priority).then(f => { rec.faaAt = now(); out.regAnswered = true; if (f) { out.msn = f.msn; out.year = f.year; out.faaOwner = f.owner; out.ownerCity = [f.city, f.state].filter(Boolean).join(', '); } }).catch(e => { out.regFailed = true; log('faa', reg, String(e.message || e)); });
    const faaNow = rec.reg && /^N\d/i.test(rec.reg) && !rec.faaAt ? faaFor(rec.reg) : null;
    // (the Isle of Man register for M- marks: its current owner over the databases' copies)
    const iomFor = reg => fetchIom(reg, priority).then(f => { out.regAnswered = true; if (f && (!f.hex || f.hex === rec.hex)) { out.iomOwner = f.owner; if (f.msn) out.msn = out.msn || f.msn; if (f.year && !out.year) out.year = f.year; if (f.owner) out.ownerCity = out.ownerCity || 'Isle of Man'; } }).catch(e => { out.regFailed = true; log('iom register', reg, String(e.message || e)); });
    const iomNow = rec.reg && /^M-/i.test(rec.reg) ? iomFor(rec.reg) : null;
    // (and the UK's G-INFO for G- marks: hexdb and adsbdb say only "Private" for most of them)
    const ukFor = reg => fetchGinfo(reg, priority).then(f => { out.regAnswered = true; if (f && (!f.hex || f.hex === rec.hex.toLowerCase())) { out.ukOwner = f.owner; if (f.msn) out.msn = out.msn || f.msn; if (f.year && !out.year) out.year = f.year; } }).catch(e => { out.regFailed = true; log('g-info', reg, String(e.message || e)); });
    const ukNow = rec.reg && /^G-/i.test(rec.reg) ? ukFor(rec.reg) : null;
    // (and the Swiss register for HB- marks)
    const chFor = reg => fetchBazl(reg, priority).then(f => { out.regAnswered = true; if (f && (!f.hex || f.hex === rec.hex.toLowerCase())) { out.chOwner = f.owner; if (f.msn) out.msn = out.msn || f.msn; if (f.year && !out.year) out.year = f.year; } }).catch(e => { out.regFailed = true; log('swiss register', reg, String(e.message || e)); });
    const chNow = rec.reg && /^HB-/i.test(rec.reg) ? chFor(rec.reg) : null;
    await Promise.all([hexdb, adsbdb, faaNow, iomNow, ukNow, chNow]);
    out.reg = out.reg || out.reg2; out.type = out.type || out.type2; out.desc = out.desc || out.desc2; out.owner = out.faaOwner || out.iomOwner || out.ukOwner || out.chOwner || out.owner || out.owner2;
    const reg = out.reg || rec.reg;
    if (!faaNow && reg && /^N\d/i.test(reg) && !rec.faaAt) { await faaFor(reg); out.owner = out.faaOwner || out.owner; }
    if (!iomNow && reg && /^M-/i.test(reg)) { await iomFor(reg); out.owner = out.iomOwner || out.owner; }
    if (!ukNow && reg && /^G-/i.test(reg)) { await ukFor(reg); out.owner = out.ukOwner || out.owner; }
    if (!chNow && reg && /^HB-/i.test(reg)) { await chFor(reg); out.owner = out.chOwner || out.owner; }
    for (const k of ['reg2', 'type2', 'desc2', 'owner2', 'faaOwner', 'iomOwner', 'ukOwner', 'chOwner']) delete out[k];
    const rcy = regCountry(out.reg || rec.reg); if (rcy) { out.countryIso = rcy.iso; out.country = rcy.name; }
    if (!out.countryIso) { const c = countryOfHex(rec.hex); if (c) { out.countryIso = c.iso; out.country = out.country || c.name; } }
    if (out.countryIso || out.country) { try { await fr24.loadCountries(); } catch (e) { /* offline */ } out.countryId = countryIdOf(out.countryIso, out.country); }
    return out;
  }
  // Registry facts for ANY aircraft (FR24 padlocks country, serial number and age for every flight on free accounts):
  // FAA for US registrations, hexdb / adsbdb, the build year from adsb.lol's aircraft database, and the serial number
  // from JetPhotos. Cached per airframe for a month.
  const pubJobs = new Map();
  // What the aggregators' own aircraft database already said about an airframe (every aircraft in view is in the
  // area cache): registration, type, description, owner and build year - no request needed.
  function seedFromArea(hex) {
    const c = areaCache.get(hex); if (!c) return {};
    const s = {}; if (c.reg) s.reg = c.reg; if (c.type) s.type = c.type; if (c.desc) s.desc = c.desc; if (c.owner) s.owner = c.owner; if (c.year > 1930) s.year = c.year; if (c.cat) s.cat = c.cat; if (c.mil) s.mil = true;
    return s;
  }
  // What is known of ordinary aircraft goes to the page, which puts it in FR24's own first frame of them - their name over
  // "Private owner", the padlocked serial number, age and country - so nothing is drawn first and replaced a moment later:
  // all of it at start (in idle slices), then each aircraft as its registers answer.
  function pubIdRow(hex, hx) {
    hx = hx || store.getHex(hex); if (!hx) return null;
    const o = shownOwner(hx, hx.cs) || '', a = ageOf(hx) || 0, m = hx.msn || '', c = hx.countryId || 0;
    return o || a || m || c ? [hex.toUpperCase(), o, a, m, c] : null;
  }
  function pushPubIds(hexes) { const rows = []; for (const h of hexes) { const r = pubIdRow(h); if (r) rows.push(r); } if (rows.length) postToPage('pubIds', { rows }); }
  let pubAllSent = false;
  async function pushAllPubIds() {
    if (pubAllSent) return; pubAllSent = true;
    const t = now(), all = [...store.allHex().entries()].filter(([, v]) => v && t - (v.savedAt || 0) < 45 * 864e5);
    let rows = [];
    await sliced(all, ([h, v]) => { const r = pubIdRow(h, v); if (r) rows.push(r); if (rows.length >= 1500) { postToPage('pubIds', { rows }); rows = []; } }, { ms: 8 });
    if (rows.length) postToPage('pubIds', { rows });
  }
  // `bg`: prefetch for aircraft on screen - registry databases only (the photo site is left alone), low priority
  function publicIdentity(hex, reg, opts) {
    hex = String(hex || '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) return Promise.resolve(null);
    const bg = !!(opts && opts.bg);
    const hx = store.getHex(hex) || {};
    // (an owner known only as "Private" where a register names it - the UK's, the Isle of Man's, the FAA's - is asked
    // for once more, whatever the age of the rest)
    // (asked again a day later when it came to nothing - a register that did not answer then, a first ask before the
    // script was allowed to reach it)
    const regDue = /^(G-|M-|HB-|N\d)/i.test(hx.reg || reg || '') && now() - (hx.ownerFailAt || 0) > 5 * 60000;
    const ownerDue = regDue && !shownOwner(hx, hx.cs) && now() - (hx.ownerAskedAt || 0) > 864e5;
    // (and a register that did not answer last time - its serial number and build year with it - asked again in 5 minutes)
    const msnDue = regDue && !hx.msn && !!hx.ownerFailAt;
    if (hx.pubAt && now() - hx.pubAt < 30 * 864e5 && (bg || hx.msn || hx.pubFull) && !ownerDue && !msnDue) return Promise.resolve(hx);
    if (pubJobs.has(hex)) return pubJobs.get(hex);
    const job = (async () => {
      const seed = seedFromArea(hex);
      if (Object.keys(seed).length) store.mergeHex(hex, Object.assign({}, seed, hx));   // instant part first
      const r = { hex, reg: reg || hx.reg || seed.reg || '', faaAt: ownerDue ? 0 : hx.faaAt || 0 };
      // the serial number of a non-US airframe is only on JetPhotos: asked in parallel, for the aircraft opened
      const jpJob = !bg && r.reg && !/^N\d/i.test(r.reg) && !hx.msn ? fetchJetphotos(r.reg).catch(() => null) : Promise.resolve(null);
      const [idn, jp] = await Promise.all([fetchIdentity(r, !bg, bg).catch(() => ({})), jpJob]);
      const out = { reg: r.reg || idn.reg || '', msn: hx.msn || idn.msn || (jp && jp.msn) || '', year: hx.year || idn.year || seed.year || 0, owner: (ownerName(hx.owner) ? hx.owner : '') || idn.owner || seed.owner || hx.owner || '', ownerCity: hx.ownerCity || idn.ownerCity || '', country: hx.country || idn.country || '', countryId: hx.countryId || idn.countryId || 0, type: hx.type || idn.type || seed.type || '', desc: hx.desc || idn.desc || seed.desc || (jp && jp.typeName) || '' };
      if (!out.year && !bg) { try { await fetchTrace(hex, '', { priority: true }); } catch (e) { /* not flying today */ } const m = traceMeta.get(hex); if (m && m.year) out.year = m.year; }
      out.pubAt = now(); if (idn.regAnswered || !idn.regFailed) { out.ownerAskedAt = now(); out.ownerFailAt = 0; } else out.ownerFailAt = now(); if (!bg) out.pubFull = true; if (r.faaAt) out.faaAt = r.faaAt;
      const merged = store.mergeHex(hex, out); pushPubIds([hex]); return merged;
    })().finally(() => pubJobs.delete(hex));
    pubJobs.set(hex, job);
    return job;
  }
  // An ordinary aircraft opened in the panel: its telemetry and database facts are already in the area cache, so the
  // padlocked fields are filled on the first render; the registry lookups only add what the cache lacks (serial number).
  let bridgeV = '';                // the page bridge's version, from its 'ready'
  const idHex = new Map();         // fr24 flight id -> hex, for every aircraft FR24's stream or panel named
  const hexOfId = id => { const r = live.get(id) || pubRecs.get(id); return (r && r.hex) || idHex.get(id) || ''; };
  function notePublicAircraft(id, hex, reg, type, cs) {
    if (id && /^[0-9a-f]{6}$/.test(hex)) { idHex.set(id, hex); if (idHex.size > 400) idHex.delete(idHex.keys().next().value); }
    if (!id || live.has(id) || !/^[0-9a-f]{6}$/.test(hex)) return null;
    let p = pubRecs.get(id);
    if (!p || p.hex !== hex) {
      p = { id, hex, reg: clean(reg).toUpperCase(), type: clean(type).toUpperCase(), cs: clean(cs).toUpperCase(), public: true };
      const kept = pubKept(id, hex); if (kept) { p.route = kept.route; p.origin = kept.origin; }
      pubRecs.set(id, p); if (pubRecs.size > 50) pubRecs.delete(pubRecs.keys().next().value);
      const c = areaCache.get(hex); if (c && now() - (c.receivedAt - (c.ageS || 0) * 1000) < (c.gnd ? 900000 : 120000)) { telemetry.set(id, telemOf(c)); pushTelemetry(id); }
      const seed = seedFromArea(hex); if (Object.keys(seed).length) store.mergeHex(hex, Object.assign({}, seed, store.getHex(hex) || {}));
      if (currentId() === id) telemLast = 0;                   // live telemetry now, not in three seconds
      store.hexAsync(hex).then(() => publicIdentity(hex, p.reg)).then(() => syncPanelSoon()).catch(e => log('public identity', e));
    } else {
      // (made from the panel before FR24's stream named it: what the stream says now fills the gaps)
      if (!p.reg && reg) p.reg = clean(reg).toUpperCase();
      if (!p.type && type) p.type = clean(type).toUpperCase();
      if (!p.cs && cs) p.cs = clean(cs).toUpperCase();
    }
    if (pubRouted(id)) startPubRoute(p);
    return p;
  }
  function onAircraftInfo(d) {
    const p = notePublicAircraft(Number(d.id), String(d.hex || '').toLowerCase(), d.reg, d.type, d.cs);
    if (p && d.adPhotos) p.adPhotos = true;
    if (p) syncPanelSoon();
  }
  function persist(rec) {
    store.mergeHex(rec.hex, { reg: rec.reg, type: rec.type, desc: rec.desc, owner: rec.owner, ownerCity: rec.ownerCity, country: rec.country, countryId: rec.countryId, msn: rec.msn, year: rec.year, photos: rec.photos, photoAt: rec.photoAt, photoLevel: rec.photoLevel, photoV: rec.photoV, jpFailAt: rec.jpFailAt || 0, operatorId: rec.operatorId, operatorIcao: rec.operatorIcao, operatorName: rec.operatorName, fr24Equip: rec.fr24Equip, fr24At: rec.fr24At, faaAt: rec.faaAt, idAt: rec.idAt, ownerAskedAt: rec.ownerAskedAt, ownerFailAt: rec.ownerFailAt, cat: rec.cat, mil: rec.mil });
    if (rec.id) store.setId(rec.id, rec);
    if (rec.id) pushToPage([rec]);
    syncPanelSoon();
  }
  const fr24InfoQueue = []; let fr24InfoBusy = false;
  function queueFr24Info(rec, front) { if (!rec.reg || rec.fr24At || fr24InfoQueue.includes(rec)) return; if (front) fr24InfoQueue.unshift(rec); else fr24InfoQueue.push(rec); pumpFr24Info(); }
  function pumpFr24Info() {
    if (fr24InfoBusy || !fr24InfoQueue.length) return;
    fr24InfoBusy = true;
    const rec = fr24InfoQueue.shift();
    (async () => {
      try {
        const info = await fr24.aircraftInfo(rec.reg);
        rec.fr24At = now();
        if (info) {
          rec.operatorId = info.operatorId || rec.operatorId || 0; rec.operatorIcao = info.operatorIcao || rec.operatorIcao || ''; rec.fr24Equip = info.equip || '';
          if (rec.operatorId) { try { await fr24.loadAirlines(); rec.operatorName = fr24.airlineName(rec.operatorId) || rec.operatorName || ''; } catch (e) { /* offline */ } }
          persist(rec);
        }
      } catch (e) { log('fr24 aircraft info', rec.reg, String(e.message || e)); }
      finally { fr24InfoBusy = false; setTimeout(pumpFr24Info, 350); }
    })();
  }
  // Photos. Planespotters is asked from the page itself (it now refuses requests without the embedding site's
  // Origin - the "HTTP 403" of v21); JetPhotos (newest photos + serial number) through GM for the selected aircraft.
  const photoWaiters = new Map();   // hex -> [resolve]
  // Without the map-page bridge (the aircraft data pages), the page's own fetch is called directly - same Origin.
  async function directPhotos(hex, reg) {
    const pf = (() => { try { const f = pageWindow().fetch; return typeof f === 'function' ? f.bind(pageWindow()) : fetch; } catch (_) { return fetch; } })();
    let err = 'none';
    for (const url of [`https://api.planespotters.net/pub/photos/hex/${hex.toUpperCase()}`, reg ? `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}` : '']) {
      if (!url) continue;
      try {
        const r = await pf(url, { credentials: 'omit' });
        if (!r.ok) { err = 'HTTP ' + r.status; continue; }
        const j = await r.json(), out = [];
        const byReg = url.includes('/photos/reg/'), hx = store.getHex(hex.toLowerCase()) || {};
        const mine = clean((hx.desc || '').split(/\s+/)[0]).toLowerCase();
        for (const p of (Array.isArray(j && j.photos) ? j.photos : [])) {
          const large = clean(p.thumbnail_large && p.thumbnail_large.src) || clean(p.thumbnail && p.thumbnail.src);
          if (!/^https:\/\//.test(large) || out.length >= 3) continue;
          // a reused registration: the photo page names another manufacturer (a Cessna must not wear a 737's picture)
          if (byReg && mine && /^[a-z]{3,}$/.test(mine)) { const slug = clean(p.link).toLowerCase(); if (/(airbus|boeing|embraer|bombardier|cessna|gulfstream|dassault|pilatus|beech|hawker|learjet|piper|cirrus|bell|robinson|sikorsky|eurocopter|mcdonnell|lockheed)/.test(slug) && !slug.includes(mine)) continue; }
          out.push({ link: clean(p.link) || large, credit: clean(p.photographer), thumb: clean(p.thumbnail && p.thumbnail.src) || large, medium: large, large, source: 'Planespotters', date: '' });
        }
        if (out.length) return { photos: out, err: '' };
      } catch (e) { err = String(e.message || e); }
    }
    return { photos: [], err };
  }
  function pagePhotos(hex, reg, pri) {
    if (!bridgeReady) return directPhotos(hex, reg);
    return new Promise(res => {
      const l = photoWaiters.get(hex) || []; l.push(res); photoWaiters.set(hex, l);
      postToPage('photoReq', { hex, reg, pri: !!pri });
      setTimeout(() => { const w = photoWaiters.get(hex) || []; const i = w.indexOf(res); if (i >= 0) { w.splice(i, 1); res({ photos: [], err: 'timeout' }); } }, 12000);
    });
  }
  function onPagePhotos(d) {
    const hex = String(d.hex || '').toLowerCase(); if (!hex) return;
    const w = photoWaiters.get(hex) || []; photoWaiters.delete(hex);
    d.photos = goodPhotos(d.photos);
    w.forEach(fn => fn({ photos: d.photos, err: d.err || '' }));
    // FR24's own pictures of a blocked airframe are JetPhotos pictures: they go first straight away
    if (d.photos && d.photos.length && isJp(d.photos[0])) {
      const hx = store.getHex(hex);
      if (!hx || !(hx.photos || []).some(isJp)) store.mergeHex(hex, { photos: d.photos, photoAt: now(), photoV: PHOTO_V, photoLevel: 2 });
      for (const rec of live.values()) if (rec.hex === hex && !(rec.photos || []).some(isJp)) { rec.photos = d.photos; persist(rec); }
    }
  }
  // the page wants pictures of an aircraft (a board card, a search card, a board row): the same pipeline, JetPhotos first
  function onNeedPhotos(d) {
    const hex = String(d.hex || '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) return;
    const done = photos => postToPage('photosDone', { hex, photos: goodPhotos(photos).map(cleanPhoto) });
    let rec = null; for (const r of live.values()) if (r.hex === hex) { rec = r; break; }
    if (!rec) { const hx = store.getHex(hex); if (hx && hx.photoV === PHOTO_V && ((hx.photos || []).some(isJp) || now() - (hx.photoAt || 0) < 864e5)) return done(hx.photos); rec = Object.assign({ hex, reg: clean(d.reg).toUpperCase() }, hx || {}); }
    const jpRetry = rec.jpFailAt && now() - rec.jpFailAt > 600000 && !(rec.photos || []).some(isJp);
    const settled = !jpRetry && rec.photoV === PHOTO_V && (rec.photoLevel || 0) >= 2 && ((rec.photos || []).length ? (rec.photos.some(isJp) || now() - (rec.photoAt || 0) < 864e5) : now() - (rec.photoAt || 0) < 6 * 3600e3);
    if (settled) { if (rec.id && (rec.photos || []).length) pushToPage([rec]); return done(rec.photos || []); }
    photoJob(rec, !!d.pri).then(done, () => done(rec.photos));
  }
  function parseJetphotos(html) {
    const photos = []; let msn = '', typeName = '';
    const cards = String(html || '').split(/<div class="result"\s+data-photo="/).slice(1);
    for (const card of cards) {
      const id = (card.match(/^(\d+)/) || [])[1];
      const img = (card.match(/(?:https?:)?\/\/cdn\.jetphotos\.com\/400\/[^"'\s<>]+\.jpe?g/i) || [])[0];
      if (!id || !img) continue;
      const src = 'https:' + img.replace(/^https?:/, '');
      const photographer = clean((card.match(/result__infoListText--photographer[^>]*>\s*<a[^>]*>([^<]+)<\/a>/) || [])[1]);
      const date = clean((card.match(/Photo date:\s*<a[^>]*>([^<]+)<\/a>/) || [])[1]);
      const aircraft = clean((card.match(/Aircraft:\s*<a[^>]*>([^<]+)<\/a>/) || [])[1]);
      const cardMsn = clean((card.match(/Serial #:\s*<a[^>]*>([^<]+)<\/a>/) || [])[1]);
      if (!msn) msn = cardMsn;
      if (!typeName) typeName = aircraft;
      photos.push({ link: `https://www.jetphotos.com/photo/${id}`, credit: photographer, thumb: src, medium: src, large: src.replace('/400/', '/640/'), source: 'JetPhotos', date, aircraft, msn: cardMsn });
      if (photos.length >= 8) break;
    }
    photos.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { photos: photos.slice(0, 3), msn, typeName };
  }
  async function fetchJetphotos(reg, pri) {
    const urls = [`https://www.jetphotos.com/showphotos.php?regsearch=${encodeURIComponent(reg)}`, `https://www.jetphotos.com/registration/${encodeURIComponent(reg)}`];
    let lastErr = '';
    for (const url of urls) {
      let html;
      try { html = await gmRequest(url, { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', json: false, timeout: 15000, priority: !!pri, bg: !pri }); } catch (e) { lastErr = String(e.message || e); continue; }
      if (/<title>\s*(?:Just a moment|Attention Required|Security Verification)/i.test(html) || /cf_chl_opt|challenge-error-text/.test(html)) { lastErr = 'bot check page'; continue; }
      const jp = parseJetphotos(html);
      if (jp.photos.length || /result__|No photos|no results/i.test(html)) return Object.assign(jp, { err: jp.photos.length ? '' : 'no photos listed' });
      lastErr = `unexpected page (${Math.round(html.length / 1024)} KB)`;
    }
    return { photos: [], msn: '', typeName: '', err: lastErr || 'failed' };
  }
  // FR24's own names of an aircraft (its registration lookup's aircraftInfo, LADD or not): "Piper Tomahawk", "Ravenair" -
  // what its own panels say, kept for every board row and card of it (G-LFSA's card said "PIPER PA-38 Tomahawk", "Private
  // owner")
  function noteFr24Info(hex, info) {
    if (!hex || !info) return;
    const model = clean(info.model && info.model.text), op = clean(info.airline && info.airline.name), icao = clean(info.airline && info.airline.code && info.airline.code.icao).toUpperCase();
    const upd = { fr24InfoAt: now() };
    if (model) { upd.fr24Model = model; upd.desc = model; }
    if (op && !/^private( owner)?$/i.test(op)) { upd.operatorName = op; if (icao) upd.operatorIcao = icao; }
    store.mergeHex(hex, upd);
  }
  // JetPhotos first, always (FR24's own pictures are JetPhotos too); Planespotters only when JetPhotos has none. Both are
  // asked at once: if JetPhotos is slow to answer, a Planespotters picture is shown meanwhile (`early`) and replaced
  // the moment JetPhotos answers.
  const JP_SOURCES = /^(?:JetPhotos|Flightradar24)$/;
  const isJp = ph => !!(ph && JP_SOURCES.test(ph.source || '') && !adPhoto(ph));
  // JetPhotos pictures through FR24's own registration lookup (FR24 runs JetPhotos): a few hundred ms, and no bot-check
  // page - jetphotos.com itself answers scripts with a Cloudflare challenge unless the browser has passed one lately.
  async function fetchFr24Photos(reg, pri) {
    const url = `https://api.flightradar24.com/common/v1/flight/list.json?query=${encodeURIComponent(reg)}&fetchBy=reg&page=1&limit=1`;
    let j = null;
    try { j = await gmRequest(url, { timeout: 10000, priority: !!pri, bg: !pri }); } catch (e) { j = null; }
    if (!(j && j.result && j.result.response)) {
      try { const pw = pageWindow(), pf = typeof pw.fetch === 'function' ? pw.fetch.bind(pw) : fetch; const res = await pf(url, { credentials: 'omit' }); if (res.ok) j = await res.json(); } catch (e) { /* none */ }
    }
    const r = j && j.result && j.result.response; if (!r) throw new Error('no answer');
    const sets = Array.isArray(r.aircraftImages) ? r.aircraftImages : [];
    const set = sets.find(x => x && clean(x.registration).toUpperCase() === reg.toUpperCase()) || sets[0];
    const im = (set && set.images) || {}, th = im.thumbnails || [], md = im.medium || [], lg = im.large || [];
    const photos = [];
    for (let i = 0; i < Math.max(th.length, md.length, lg.length) && photos.length < 3; i++) {
      const t = th[i] || {}, m = md[i] || {}, l = lg[i] || {};
      // (FR24's list can hold airport-data.com pictures too: never those)
      if (/airport-data/i.test([l.src, m.src, t.src, l.link, m.link, t.link, l.source, m.source, t.source, l.copyright].map(v => String(v || '')).join(' '))) continue;
      const large = noBar(clean(l.src) || clean(m.src) || clean(t.src)); if (!/^https:\/\//.test(large)) continue;
      photos.push({ link: clean(l.link || m.link || t.link) || large, credit: clean(l.copyright || m.copyright || t.copyright), thumb: noBar(clean(t.src)) || large, medium: noBar(clean(m.src)) || large, large, source: 'JetPhotos', date: '' });
    }
    return { photos, info: r.aircraftInfo || null };
  }
  async function fetchPhotos(rec, pri, early, fill) {
    const hex = rec.hex.toLowerCase(), errs = [];
    const jpJob = rec.reg ? fetchFr24Photos(rec.reg, pri).then(({ photos, info }) => {
      if (info) {
        const sn = clean(info.serialNo), model = clean(info.model && info.model.text), op = clean(info.airline && info.airline.name);
        if (sn && !rec.msn) rec.msn = sn;
        // (FR24's own name for the model - what its panel shows, "Gulfstream G550" - over a database's "GULFSTREAM 5": the
        // board cards and search say the same as the panel)
        if (model && rec.desc !== model) { rec.desc = model; rec.fr24Model = model; }
        // FR24's own operator name ("Johnson & Johnson") goes before the registered owner's legal name
        if (op && !/^private( owner)?$/i.test(op) && !rec.operatorName) rec.operatorName = op;
        noteFr24Info(rec.hex, info);
        // (and its country of registration, in FR24's own ids: T7-AFP's San Marino, which its transponder block does not say)
        const ct = info.country; if (ct && ct.id) { if (!rec.countryId) rec.countryId = Number(ct.id); if (!rec.country && ct.name) rec.country = clean(ct.name); }
        // FR24 keeps the serial number for subscribers: JetPhotos' cards carry it (for the AGE, dated from it, too)
        if (!rec.msn && rec.reg && !/^N\d/i.test(rec.reg) && !rec.jpMsnAt) {
          rec.jpMsnAt = now();
          fetchJetphotos(rec.reg, pri).then(jp => {
            const m = (jp.photos.find(ph => ph.msn) || {}).msn || jp.msn;
            if (m && !rec.msn) { rec.msn = m; store.mergeHex(rec.hex, { msn: m }); syncPanelSoon(); }
          }).catch(() => { /* none */ });
        }
      }
      if (!photos.length) errs.push('JetPhotos: none for ' + rec.reg);
      rec.jpFailAt = 0;
      return photos;
    }, e => { rec.jpFailAt = now(); return fetchJetphotos(rec.reg, pri).then(jp => {
      // a reused registration lists the earlier airframe too: keep the photos of this aircraft's manufacturer only
      const mine = clean((rec.desc || '').split(/\s+/)[0]).toLowerCase();
      const known = /^(airbus|boeing|embraer|bombardier|cessna|gulfstream|dassault|pilatus|beech|hawker|learjet|piper|cirrus|bell|robinson|sikorsky|eurocopter|mcdonnell|lockheed|canadair|raytheon|textron)/i;
      const photos = mine.length >= 3 ? jp.photos.filter(ph => !ph.aircraft || ph.aircraft.toLowerCase().includes(mine) || !known.test(ph.aircraft)) : jp.photos;
      const msn = (photos.find(ph => ph.msn) || {}).msn; if (msn && !rec.msn) rec.msn = msn; if (jp.typeName && !rec.desc) rec.desc = jp.typeName;
      if (jp.err) errs.push('JetPhotos: ' + jp.err);
      if (photos.length) rec.jpFailAt = 0;
      return photos;
    }).catch(e2 => { errs.push('JetPhotos: ' + (e.message || e) + ' / ' + (e2.message || e2)); return []; }); }) : Promise.resolve([]);
    // Planespotters only when it is needed: FR24's JetPhotos lookup answers in a few hundred ms with up to five
    // pictures, while Planespotters is asked one aircraft at a time (its rate limit) - asking it for every aircraft had
    // every slideshow on the map wait in that one queue.
    let psP = null;
    const psJob = () => psP || (psP = pagePhotos(hex, rec.reg, pri).then(r => { if (!r.photos.length) errs.push('Planespotters: ' + (r.err || 'none')); return r.photos; }));
    let jpDone = false;
    if (early) setTimeout(() => { if (!jpDone) psJob().then(ps => { if (!jpDone && ps.length) { try { early(ps); } catch (e) { log('early photos', e); } } }); }, 2500);
    const jp = await jpJob; jpDone = true;
    // JetPhotos first; the rest of the slideshow (three pictures) filled from Planespotters - but JetPhotos' own go on
    // screen at once and the fill follows (fill) instead of holding them back
    const photos = jp.slice(0, 3);
    if (photos.length && photos.length < 3 && fill) { const base = photos.slice(); psJob().then(ps => { const more = base.slice(); for (const p of ps) { if (more.length >= 3) break; if (!more.some(x => shotKey(x) === shotKey(p))) more.push(p); } if (more.length > base.length) fill(more); }).catch(() => {}); }
    else if (photos.length < 3) { for (const p of await psJob()) { if (photos.length >= 3) break; if (!photos.some(x => shotKey(x) === shotKey(p))) photos.push(p); } }
    // (JetPhotos, then Planespotters - nothing else: the airport-data.com pictures other databases point to are small
    // and often years out of date)
    rec.photoErr = photos.length ? '' : errs.join(' · ');
    if (!photos.length) log('no photo for', rec.reg || hex, rec.photoErr);
    return photos;
  }
  const photoQueue = [], photoInFlight = new Map(); let photoBusy = 0;
  async function enrich(rec) {
    if (!rec.hex) return;
    let changed = false;
    // (once every few days per aircraft: a brand-new airframe no registry knows yet is not asked about on every flight)
    // (and no name to show for it yet - nothing, "Private", a trustee - where a register names one: the UK's G-INFO, the
    // Isle of Man's, the FAA's. HLL01, G-NMCF: its registration, type and country all known from the aggregators, so the
    // registers were never asked and the panel had no name - G-INFO has its AOC operator, Kingmoor Aviation. Once a day.)
    const ownerDue = !shownOwner(rec, rec.cs) && /^(G-|M-|HB-|N\d)/i.test(rec.reg || '') && now() - (rec.ownerAskedAt || 0) > 864e5 && now() - (rec.ownerFailAt || 0) > 5 * 60000;
    if (ownerDue || ((!rec.reg || !rec.type || !rec.countryId || (/^N\d/.test(rec.reg || '') && !rec.faaAt)) && (now() - (rec.idAt || 0) > 3 * 864e5 || (!rec.reg && currentId() === rec.id && now() - (rec.idAt || 0) > 600000)))) {
      rec.idAt = now(); changed = true;
      if (ownerDue && /^N\d/i.test(rec.reg)) rec.faaAt = 0;
      const idn = await fetchIdentity(rec, currentId() === rec.id);
      // (asked: done for the day when a register answered - a refused or failed request is tried again in 5 minutes)
      if (ownerDue) { if (idn.regAnswered || !idn.regFailed) { rec.ownerAskedAt = now(); rec.ownerFailAt = 0; } else rec.ownerFailAt = now(); }
      for (const k of ['reg', 'type', 'desc', 'owner', 'ownerCity', 'country', 'countryIso', 'countryId', 'msn', 'year']) if ((!rec[k] || (k === 'owner' && !ownerName(rec.owner))) && idn[k] && idn[k] !== rec[k]) { rec[k] = idn[k]; changed = true; }
      if (rec.faaAt) changed = true;
    }
    // No registration from any database, but private flights usually fly under their tail number: FR24's own aircraft
    // search maps the callsign to a registration, accepted only when it carries this very transponder address.
    if (!rec.reg && rec.cs && /^[A-Z0-9]{3,8}$/.test(rec.cs) && !rec.regTried) {
      rec.regTried = true;
      try {
        const j = await fr24Json(`/v1/search/web/find?query=${encodeURIComponent(rec.cs)}&limit=10`);
        const hit = (Array.isArray(j && j.results) ? j.results : []).find(x => x && x.type === 'aircraft' && x.detail && clean(x.detail.hex).toLowerCase() === rec.hex);
        if (hit) { rec.reg = clean(hit.id).toUpperCase(); if (!rec.type && hit.detail.equip) rec.type = clean(hit.detail.equip).toUpperCase(); if (!rec.operatorId && hit.detail.operator_id) rec.operatorId = Number(hit.detail.operator_id) || 0; changed = true; log('registration from callsign', rec.cs, '->', rec.reg); }
      } catch (e) { log('registration lookup', String(e.message || e)); }
    }
    if (changed) persist(rec);
    const isSelected = currentId() === rec.id;
    if (rec.reg && !rec.operatorId && !rec.fr24At) queueFr24Info(rec, isSelected);
    // photos for what can be looked at (in view, on a board, selected); far-away world-scan finds wait until they are
    const snap = pending.get(rec.id), onBoard = now() - (boardSeenAt.get(rec.id) || 0) < 15 * 60000;
    if (!isSelected && !onBoard && snap && snap.bg) return;
    const hasPhotos = !!(rec.photos && rec.photos.length);
    if (rec.photoV !== PHOTO_V) rec.photoLevel = 0;                // cached by an older pipeline: looked up again
    // (pictures that are not JetPhotos are looked at again once a day: JetPhotos may have one by now)
    const jpRetry = rec.jpFailAt && now() - rec.jpFailAt > 600000 && !(rec.photos || []).some(isJp);
    if ((rec.photoLevel || 0) < 2 || jpRetry || (!hasPhotos && now() - (rec.photoAt || 0) > 1800000) || (hasPhotos && !rec.photos.some(isJp) && now() - (rec.photoAt || 0) > 864e5)) photoJob(rec, isSelected);
  }
  // One lookup per airframe at a time; what the user is looking at goes to the front. Pictures already on screen stay
  // until the lookup has an answer.
  // Returns a promise of the final pictures. A lookup already running in the background for an aircraft that is now
  // being looked at is overtaken by a front-of-queue one (the background one is dropped when it ends).
  function photoJob(rec, pri) {
    if (!rec.hex) return Promise.resolve(rec.photos || []);
    const cur = photoInFlight.get(rec.hex);
    if (cur && (cur.pri || !pri)) return cur.done;
    if (cur && !cur.started) { cur.pri = true; const i = photoQueue.indexOf(cur); if (i > 0) photoQueue.unshift(photoQueue.splice(i, 1)[0]); pumpPhotos(); return cur.done; }
    const entry = { hex: rec.hex, pri: !!pri, started: false };
    entry.done = new Promise(res => {
      entry.run = async () => {
        entry.started = true;
        try {
          const photos = await fetchPhotos(rec, entry.pri, ph => { if (!(rec.photos || []).some(isJp)) { rec.photos = ph; rec.photoAt = now(); persist(rec); postToPage('photosDone', { hex: rec.hex, photos: ph, early: true }); } },
            more => { rec.photos = more; rec.photoAt = now(); persist(rec); postToPage('photosDone', { hex: rec.hex, photos: goodPhotos(more).map(cleanPhoto) }); });
          if (photoInFlight.get(rec.hex) === entry) {
            rec.photoLevel = 2; rec.photoAt = now(); rec.photoV = PHOTO_V; rec.photosStale = false;
            if (photos.length) rec.photos = photos;
            persist(rec);
          }
          res(photos.length ? photos : rec.photos || []);
        } catch (e) { res(rec.photos || []); throw e; } finally { if (photoInFlight.get(rec.hex) === entry) photoInFlight.delete(rec.hex); }
      };
    });
    photoInFlight.set(rec.hex, entry);
    if (pri) photoQueue.unshift(entry); else photoQueue.push(entry);
    pumpPhotos();
    return entry.done;
  }
  function pumpPhotos() {
    // five background lookups at a time (each is one FR24 request now); what is being looked at never waits for them
    while (photoQueue.length && (photoBusy < 5 || photoQueue[0].pri)) {
      photoBusy++;
      photoQueue.shift().run().catch(e => log('photo job', e)).finally(() => { photoBusy--; pumpPhotos(); });
    }
  }

  // ---- flight logs: adsb.lol traces -> legs ---------------------------------------------------------------------------
  // (v21 asked globe.adsb.lol, which now redirects to adsb.lol - a host the script was not allowed to connect to, so
  // every history request failed silently and the destination model ran with no history at all.)
  const traceUrl = (hex, day, back) => day && back > LOL_DAYS ? `https://globe.airplanes.live/globe_history/${day}/traces/${hex.slice(-2)}/trace_full_${hex}.json` : `https://adsb.lol/${day ? `globe_history/${day}` : 'data'}/traces/${hex.slice(-2)}/trace_full_${hex}.json`;
  const traceMeta = new Map();   // hex -> { r, t, desc, ownOp, year, at }
  async function fetchTrace(hex, day, opts) {
    const j = await gmRequest(traceUrl(hex, day, opts && opts.back), { timeout: 20000, priority: !!(opts && opts.priority), bg: !!(opts && opts.bg), idle: !!(opts && opts.idle) });
    if (j && (j.r || j.t || j.year || j.ownOp || j.dbFlags)) {
      const m = { r: clean(j.r).toUpperCase(), t: clean(j.t).toUpperCase(), desc: clean(j.desc), ownOp: clean(j.ownOp), year: Number(j.year) || 0, flags: Number(j.dbFlags) || 0, at: now() };
      traceMeta.set(hex, m);
      const hx = store.getHex(hex) || {};
      const upd = {}; if (m.year && !hx.year) upd.year = m.year; if (m.r && !hx.reg) upd.reg = m.r; if (m.t && !hx.type) upd.type = m.t; if (m.desc && !hx.desc) upd.desc = m.desc; if (m.ownOp && !hx.owner) upd.owner = m.ownOp;
      // readsb database flags: 1 military, 4 PIA, 8 LADD
      if (m.flags & 8 && !hx.ladd) upd.ladd = true; if (m.flags & 4 && !hx.pia) upd.pia = true; if (m.flags & 1 && !hx.mil) upd.mil = true;
      if (Object.keys(upd).length) store.mergeHex(hex, upd);
    }
    return j;
  }
  function acOfHex(hex) {
    const hx = store.getHex(hex) || {}, c = countryOfHex(hex), g = globalList.byHex.get(hex);
    return { hex, type: hx.type || (g && g.type) || '', reg: hx.reg || (g && g.reg) || '', mil: !!(hx.mil || (g && g.mil)), cat: hx.cat || (g && g.cat) || '', country: c ? c.name : '' };
  }
  function summarize(legs, hex) {
    const hs0 = ENGINE.histStats(compactToLegs((store.getHex(hex) || {}).recent || []), nowS());
    const ac = acOfHex(hex), cls = ENGINE.classify(ac), ctx = { visits: hs0.visits, base: hs0.base, mil: ac.mil, grp: ENGINE.groupOf(cls), cls, type: ac.type };
    return legs.map(l => ENGINE.summarizeLeg(l, ctx));
  }
  // compact recent legs kept in the (always loaded) hex record: [tStart, tEnd, fromId, toId, fromConf, toConf, cs, maxAlt]
  const legsToCompact = legs => legs.slice(-60).map(l => [l.tStart, l.tEnd, l.from ? l.from.id : 0, l.to ? l.to.id : 0, l.from ? l.from.conf : '', l.to ? l.to.conf : '', l.cs || '', l.maxAlt || 0, l.ended ? 1 : 0]);
  function compactToLegs(c) {
    const ap = (id, conf) => { if (!id) return null; const a = apById(id); return { id, code: a ? apCode(a) : String(id), conf }; };
    return (c || []).map(x => ({ tStart: x[0], tEnd: x[1], from: ap(x[2], x[4]), to: ap(x[3], x[5]), cs: x[6] || '', maxAlt: x[7] || 0, ended: !!x[8] }));
  }
  // Fleet-mates: aircraft registered to the same owner (a company's jets share their destinations). Their flights come
  // from the logs this script keeps; a 'fleet' of more than 15 is a lessor or a programme and is left out.
  let fleetIx = null;
  function fleetIndex() {
    if (fleetIx && now() - fleetIx.at < 600000) return fleetIx;
    const by = new Map(); for (const [h, v] of store.allHex()) { const k = v && !isTrustee(v.owner) && ENGINE.ownerKey(v.owner); if (k) (by.get(k) || by.set(k, []).get(k)).push(h); }
    fleetIx = { at: now(), by }; return fleetIx;
  }
  function fleetMates(hex) { const ow = (store.getHex(hex) || {}).owner, k = !isTrustee(ow) && ENGINE.ownerKey(ow); const m = k ? fleetIndex().by.get(k) : null; return m && m.length >= 2 && m.length <= 15 ? m.filter(h => h !== hex) : []; }
  function fleetVisits(hex, t0) {
    const m = new Map();
    for (const h of fleetMates(hex)) for (const l of compactToLegs((store.getHex(h) || {}).recent || [])) if (l.from && l.to && l.from.id !== l.to.id && l.tEnd < t0 && t0 - l.tEnd < 60 * 86400) { m.set(l.from.id, (m.get(l.from.id) || 0) + 1); m.set(l.to.id, (m.get(l.to.id) || 0) + 1); }
    return m.size ? m : null;
  }
  const historyJobs = new Map();
  // Loads today's trace and up to `maxDays` of history (newest first, several days in parallel), keeps the full log in
  // IndexedDB and a compact recent summary in memory. onProgress fires as days arrive.
  // opts.bg: background backfill for an aircraft nobody is looking at (never takes the last free request slots)
  function loadHistory(hex, maxDays, onProgress, opts) {
    const bgWork = !!(opts && opts.bg);
    // (the aircraft being looked at - opts.front - jumps the queue, and so does what is left of a load already running for
    // it; a longer load than the running one follows it and asks only for the days that one did not cover)
    const front = !!(opts && opts.front), cur = historyJobs.get(hex);
    if (cur && cur.running) { if (front) cur.front = true; if (cur.maxDays >= maxDays) return cur.promise; return cur.promise.catch(() => null).then(() => loadHistory(hex, maxDays, onProgress, opts)); }
    const st = { running: true, maxDays, front };
    st.promise = (async () => {
      await loadAirports();
      await Promise.race([loadSites(), sleep(8000)]);        // (landings at unlisted fields are read as such)
      let h = (await store.getHist(hex)) || { legs: [], days: {}, savedAt: 0, v: HIST_V };
      if (h.v !== HIST_V) h = { legs: [], days: {}, savedAt: 0, v: HIST_V };   // logs from an older leg reconstruction are rebuilt
      h.days = h.days || {}; h.legs = h.legs || [];
      // (a log kept by an older build: only the days with a flight it could not end or begin - lost low near a strip, a
      // flight cut in two by a hole in coverage - are read again, once; the rest of it stands)
      if ((h.vm || 0) < HIST_VM) {
        const from = dayStr(now() - LOL_DAYS * 864e5), redo = new Set();
        for (const l of h.legs) if (l.day && l.day >= from && ((!l.to && (!l.ended || /^(gap|lost)/.test(l.how || ''))) || (!l.from && !l.startedOnGround))) redo.add(l.day);
        for (const d of redo) delete h.days[d];
        h.vm = HIST_VM;
      }
      const upTo = bgWork ? Math.min(maxDays, LOL_DAYS) : maxDays;
      const todo = [], backOf = {}; for (let back = 1; back <= upTo; back++) { const d = dayStr(now() - back * 864e5); if (!h.days[d]) { todo.push(d); backOf[d] = back; } }
      let done = 0, dirty = false;
      const flush = () => {
        if (!dirty) return; dirty = false;
        h.legs.sort((a, b) => b.tStart - a.tStart); h.legs = h.legs.slice(0, 1500);
        const oldest = dayStr(now() - (HISTORY_DAYS + 3) * 864e5); for (const k of Object.keys(h.days)) if (k < oldest) delete h.days[k];
        h.savedAt = now(); store.setHist(hex, h);
        const chained = ENGINE.chainLegs(ENGINE.stitchLegs(h.legs.slice().reverse()));
        store.mergeHex(hex, { recent: legsToCompact(chained) });
        try { boardNoteLegs(hex, chained.filter(l => l.tStart > nowS() - 3 * 86400)); } catch (e) { log('board legs', e); }
        if (onProgress) { try { onProgress(h, done, todo.length); } catch (e) { log('history progress', e); } }
      };
      const ac0 = acOfHex(hex), cls0 = ENGINE.classify(ac0), heli = cls0 === 'heli', patrol = cls0 === 'fighter' || cls0 === 'milheavy';
      const legsOf = (pts, day) => ENGINE.legsFromPoints(pts, { heli, patrol, cls: cls0, type: ac0.type, rangeKm: ENGINE.typeRangeKm(ac0), dataEnd: dayEndS(day) });
      // A day with a flight whose landing or take-off was not heard (lost low, ended in a hole, only a guess at the
      // field) - or no trace at all while the user is looking: the other network's trace of that day too, merged. Each
      // hears what the other's receivers miss (D-CRUX at Palma: adsb.lol lost it at 1,650 ft, airplanes.live heard it to
      // 250 ft). Flights cut by midnight are not incomplete, the next day has the rest.
      const incomplete = (sums, day) => {
        const e = dayEndS(day), b = e - 86400;
        return sums.some(x => (e - x.tEnd >= 1200 && (!x.ended || !x.to || x.to.conf === 'near' || x.how === 'gap' || x.how === 'gap-low')) || (x.tStart - b >= 600 && !x.startedOnGround && (!x.from || x.from.conf === 'near')));
      };
      const one = async day => {
        let legs = [], answered = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          let pts = null;
          try {
            const j = await fetchTrace(hex, day, { bg: bgWork && !st.front, back: backOf[day], priority: st.front }); answered = true;
            pts = ENGINE.parseTrace(j);
          }
          catch (e) { if (/HTTP 404/.test(String(e))) { answered = true; pts = []; } else if (/HTTP 429/.test(String(e))) { await sleep(4000); continue; } else { log('trace history', hex, day, String(e.message || e)); break; } }
          let raws = legsOf(pts, day);
          legs = summarize(raws, hex);
          if (backOf[day] <= LOL_DAYS && (pts.length ? incomplete(legs, day) : st.front)) {
            try {
              const j2 = await gmRequest(`https://globe.airplanes.live/globe_history/${day}/traces/${hex.slice(-2)}/trace_full_${hex}.json`, { timeout: 20000, priority: st.front, bg: bgWork && !st.front });
              const both = ENGINE.mergePoints(pts, ENGINE.parseTrace(j2));
              if (both.length > pts.length) { pts = both; raws = legsOf(pts, day); legs = summarize(raws, hex); }
            } catch (e) { /* the one network's day stands */ }
          }
          legs = legs.map(l => Object.assign(l, { day }));
          raws.forEach((r, i) => learnFromLeg(hex, r, legs[i], cls0, ac0.mil));
          break;
        }
        // (a day that could not be had - a refused or failed request - is asked again next time, not marked as empty)
        done++;
        if (!answered) return;
        h.days[day] = true; h.legs = h.legs.filter(l => l.day !== day).concat(legs); dirty = true;
      };
      // newest days first, a few at a time; progress is flushed after every batch
      // (a background log's bookkeeping - joining legs, the copy kept on disk - waits for an idle moment too)
      for (let i = 0; i < todo.length; i += 8) { await Promise.all(todo.slice(i, i + 8).map(one)); if (bgWork && !st.front) await idleSlice(); flush(); }
      flush();
      // (the other FR24 tabs - the map, a log page - read it again: one log, one answer, wherever it is shown)
      if (done) { store.flushNow(); setTimeout(() => { try { if (routeChan) routeChan.postMessage({ hist: hex }); } catch (e) { /* closed */ } }, 1500); }
      return h;
    })().finally(() => { st.running = false; });
    historyJobs.set(hex, st);
    return st.promise;
  }
  // Today's live trace (roughly the last 24 h): the current leg from its very first point, and today's earlier legs.
  // Every trace is also kept on disk (the current leg thinned to a point every 20 s, plus the day's leg summaries), so
  // after a refresh each aircraft's take-off airport and track so far are known before any request is made.
  const todayCache = new Map();   // hex -> { at, pts, lastPt, legs (raw), sums, disk? , failAt? }
  const todayWarmed = new Set();
  const thinPts = (pts, gap) => { const o = []; for (const p of pts || []) if (!o.length || p.t - o[o.length - 1].t >= gap) o.push(p); const last = pts && pts[pts.length - 1]; if (last && o[o.length - 1] !== last) o.push(last); return o; };
  function saveToday(hex, out) {
    const leg = out.legs && out.legs.length ? out.legs[out.legs.length - 1] : null;
    store.setToday(hex, { at: out.at, lastPt: out.pts && out.pts.length ? out.pts[out.pts.length - 1] : (out.lastPt || null), sums: out.sums || [],
      legs: leg ? [{ start: leg.start, end: leg.end, ended: leg.ended, pts: thinPts(leg.pts, 20) }] : [] });
  }
  function warmToday(hexes) {
    const need = hexes.filter(h => h && !todayCache.has(h) && !todayWarmed.has(h)); if (!need.length) return Promise.resolve();
    need.forEach(h => todayWarmed.add(h));
    return store.getToday(need).then(m => {
      for (const [k, v] of m) {
        const hex = k.slice(2);
        if (!todayCache.has(hex) && v && v.at && now() - v.at < 20 * 3600e3) todayCache.set(hex, { at: v.at, pts: [], lastPt: v.lastPt || null, legs: v.legs || [], sums: v.sums || [], disk: true });
      }
    }).catch(e => log('today from disk', e));
  }
  // opts.priority: the selected aircraft (first in line, retried within seconds); opts.bg: background prefetch
  async function loadToday(hex, maxAgeMs, opts) {
    opts = opts || {};
    if (!todayCache.has(hex) && !todayWarmed.has(hex)) await warmToday([hex]);
    const c = todayCache.get(hex);
    if (c && !c.loading && c.legs && now() - c.at < (maxAgeMs || 60000)) return c;
    if (c && c.loading) return c.loading;
    if (c && c.failAt && now() - c.failAt < (opts.priority ? 6000 : 45000)) return c;
    const job = (async () => {
      await loadAirports();
      const [j] = await Promise.all([fetchTrace(hex, '', opts), Promise.race([loadSites(), sleep(3000)])]);   // (unlisted fields known)
      const pts = ENGINE.parseTrace(j);
      const cls0 = ENGINE.classify(acOfHex(hex)), heli = cls0 === 'heli', patrol = cls0 === 'fighter' || cls0 === 'milheavy';
      const ac0 = acOfHex(hex), legs = ENGINE.legsFromPoints(pts, { heli, patrol, cls: cls0, type: ac0.type, rangeKm: ENGINE.typeRangeKm(ac0) });   // (no dataEnd: today's file is rewritten now and then - it can end where the aircraft is still flying: HLE81 "landed at Gloucester" passing over it)
      const out = { at: now(), pts, lastPt: pts.length ? pts[pts.length - 1] : null, legs, sums: summarize(legs, hex).map(l => Object.assign(l, { day: dayStr(now()) })) };
      todayCache.set(hex, out); saveToday(hex, out);
      try { boardNoteLegs(hex, out.sums); } catch (e) { log('board legs', e); }
      if (todayCache.size > 400) todayCache.delete(todayCache.keys().next().value);
      return out;
    })();
    todayCache.set(hex, Object.assign({}, c || { at: 0 }, { loading: job }));
    // on failure the last good copy stays in use; a retry waits a little (the selected aircraft only seconds)
    try { return await job; } catch (e) { todayCache.set(hex, Object.assign({ pts: [], legs: [], sums: [] }, c || { at: 0 }, { loading: null, failAt: now() })); throw e; }
  }
  // Parked since `since` (a landing): five minutes at a standstill, or a quarter of an hour unheard, on the ground after
  // it - in today's trace (taxiing in does neither)
  function restedAfter(hex, since) {
    const td = hex ? todayCache.get(hex) : null, pts = td && td.pts; if (!pts || !pts.length || !(since > 0)) return false;
    let s0 = null, prev = null;
    for (const p of pts) {
      if (p.t < since) continue;
      if (prev && p.t - prev.t >= 900 && (prev.gnd || prev.gs < 30)) return true;
      if (fin(p.gs) && p.gs < 2) { if (!s0) s0 = p; else if (p.t - s0.t >= 300) return true; } else if (fin(p.gs) && p.gs >= 4) s0 = null;
      prev = p;
    }
    return false;
  }
  // All legs known for an aircraft (today + history), stitched and chained, oldest first.
  function knownLegs(hex, opts) {
    const h = store.peekHist(hex), t = todayCache.get(hex), excludeOpen = opts && opts.excludeOpen;
    let legs = [];
    if (h && h.v === HIST_V && h.legs && h.legs.length) legs = h.legs.slice();
    else legs = compactToLegs((store.getHex(hex) || {}).recent || []);
    if (t && t.sums) legs = legs.concat(t.sums.filter(l => !(excludeOpen && !l.ended)));
    return ENGINE.chainLegs(ENGINE.stitchLegs(legs));
  }

  // ---- the population tables (22.10): packed into the script at build time (gzip, base64), unpacked once at start ------
  // in the background - the page never waits for them; the engine reasons without them until they are in (a second).
  // (packed: airports as indexes into one list, keys nested by origin / map cell - test/pack_t2.cjs checks this round trip)
  /* ==UNPACKT2== */
  // (a generator: the loader runs it a few milliseconds at a time, so the page never stalls on it; unpackT2 = all at once)
  function* unpackT2Steps(p, t) {
    const A = p.ap; let n = 0;
    Object.assign(t, { v: p.v, built: p.built, days: p.days, from: p.from, to: p.to, aphAll: p.aphAll, tperf: p.tperf, pperf: p.pperf, od2: {}, odt: {}, apd: {}, seq: {}, csr: {}, aph: {}, aps: {}, pgu: {}, flow: {} });
    for (const [a, m] of Object.entries(p.od2 || {})) { for (const [b, v] of Object.entries(m)) t.od2[A[a] + '>' + A[b]] = v; if (++n % 16 === 0) yield; }
    for (const [a, m] of Object.entries(p.odt || {})) { for (const [b, v] of Object.entries(m)) t.odt[A[a] + '>' + A[b]] = v; if (++n % 16 === 0) yield; }
    for (const [a, v] of Object.entries(p.apd || {})) t.apd[A[a]] = v;
    yield;
    for (const [k, m] of Object.entries(p.seq || {})) { const air = k[0] === 'a', [x, o] = (air ? k.slice(1) : k).split('>'); for (const [d, c] of Object.entries(m)) t.seq[(air ? 'a:' : '') + A[x] + '>' + A[o] + '>' + A[d]] = c; if (++n % 64 === 0) yield; }
    for (const [cs, l] of Object.entries(p.csr || {})) { const m = []; for (let i = 0; i + 2 < l.length; i += 3) m.push(A[l[i]], A[l[i + 1]], l[i + 2]); t.csr[cs] = m; if (++n % 256 === 0) yield; }
    for (const [a, v] of Object.entries(p.aph || {})) t.aph[A[a]] = v;
    for (const [a, v] of Object.entries(p.aps || {})) t.aps[A[a]] = v;
    yield;
    for (const [pg, m] of Object.entries(p.pgu || {})) { const o = t.pgu[pg] = {}; for (const [a, c] of Object.entries(m)) o[A[a]] = c; yield; }
    for (const [cell, m] of Object.entries(p.flow || {})) { for (const [hb, v] of Object.entries(m)) { const o = [v[0], v[1]]; for (let i = 2; i + 2 < v.length; i += 3) o.push(A[v[i]], v[i + 1], v[i + 2]); t.flow[cell + ',' + hb[0] + ',' + hb[1]] = o; } if (++n % 32 === 0) yield; }
  }
  // eslint-disable-next-line no-unused-vars -- (all at once: the build tools and tests use it)
  function unpackT2(p) {
    if (!p || p.pk !== 2) return p;
    const t = {}, it = unpackT2Steps(p, t); while (!it.next().done) { /* to the end */ }
    return t;
  }
  /* ==/UNPACKT2== */
  // the build writes the packed tables as lines ("key<TAB>json", each table in parts of ~150 KB) so that no single
  // JSON.parse holds the page either; an older single-JSON build still loads
  function* parseT2Lines(txt, p) {
    for (let i = txt.indexOf('\n') + 1; i > 0 && i < txt.length;) {
      let j = txt.indexOf('\n', i); if (j < 0) j = txt.length;
      const tab = txt.indexOf('\t', i), k = txt.slice(i, tab), v = JSON.parse(txt.slice(tab + 1, j));
      if (k === '_') Object.assign(p, v); else if (Array.isArray(v) || !v || typeof v !== 'object') p[k] = v; else Object.assign(p[k] || (p[k] = {}), v);
      i = j + 1; yield;
    }
  }
  // ---- build year by serial number (AGE, padlocked by FR24) -------------------------------------------------------
  // No open source has a build year for every aircraft (hexdb and adsbdb none, OpenSky's database ~0.1%, airframes.org
  // allows no scripts). The registers that publish one are asked (FAA, UK G-INFO, Isle of Man); for the rest, the FAA
  // register's 82,000 turbine aircraft and helicopters - on it now or gone abroad - by type and serial number, packed in
  // (test/mkagetable.cjs). An airframe once N-registered has its own year there; another is dated from the serials either
  // side of it, which manufacturers issue in sequence (left out where those disagree by more than a year: 98% within a
  // year, 94% exact where they agree - leave-one-out over the register). TF-AKG, 747-400F 33732: 2004.
  let ageTable = null, ageTableLoading = null;
  const ageTypeCache = new Map();
  function loadAgeTable() {
    if (ageTable || ageTableLoading) return ageTableLoading;
    ageTableLoading = (async () => {
      if (typeof AGE_TABLE_GZ !== 'string' || !AGE_TABLE_GZ || typeof DecompressionStream !== 'function') return null;
      const bin = atob(AGE_TABLE_GZ), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      ageTable = JSON.parse(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
      syncPanelSoon();
      return ageTable;
    })().catch(e => { log('age table', e); return null; });
    return ageTableLoading;
  }
  // The learned arrival paths (build.mjs apprPack): unpacked into the engine a slice at a time, a while after start
  let apprLoading = null;
  function loadApprTable() {
    if (apprLoading) return apprLoading;
    apprLoading = (async () => {
      if (typeof APPR_TABLE_GZ !== 'string' || !APPR_TABLE_GZ || typeof DecompressionStream !== 'function') return null;
      const bin = atob(APPR_TABLE_GZ), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const b = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      // (kept as sorted typed arrays - a few MB, where a Map of them would be ~25 - and looked up by halving)
      const nl = b.indexOf(10), head = JSON.parse(new TextDecoder().decode(b.subarray(0, nl))), N = head.n;
      const K = new Float64Array(N), A = new Uint32Array(N), T = new Uint32Array(N), M = new Uint32Array(N);
      let i = nl + 1, key = 0;
      const vint = () => { let v = 0, m = 1, x; do { x = b[i++]; v += (x & 127) * m; m *= 128; } while (x >= 128); return v; };
      for (let k = 0; k < N; k++) {
        key += vint(); K[k] = key; A[k] = vint(); T[k] = vint(); M[k] = vint();
        if (k % 20000 === 19999) await idleSlice();
      }
      const get = k => { let lo = 0, hi = N - 1; while (lo <= hi) { const mid = (lo + hi) >> 1, v = K[mid]; if (v === k) return [head.aps[A[mid]], T[mid] - M[mid], T[mid]]; if (v < k) lo = mid + 1; else hi = mid - 1; } return undefined; };
      ENGINE.setApproach({ bin: head.bin, thr: head.thr, minN: head.minN, cells: { get, size: N } });
      return N;
    })().catch(e => { log('arrival paths', e); return null; });
    return apprLoading;
  }
  const normSerial = s =>String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
  const serialKey = s => { const m = s.match(/^(.*?)(\d+)([A-Z]?)$/); return m ? [m[1] + '#' + m[3], +m[2]] : null; };
  function typeSerials(type) {
    if (!ageTable) { loadAgeTable(); return null; }
    if (ageTypeCache.has(type)) return ageTypeCache.get(type);
    const s = ageTable[type];
    const l = s ? s.split(',').map(x => { const i = x.lastIndexOf(':'), sn = x.slice(0, i); return { sn, y: 1900 + Number(x.slice(i + 1)), k: serialKey(sn) }; }) : null;
    ageTypeCache.set(type, l); if (ageTypeCache.size > 300) ageTypeCache.delete(ageTypeCache.keys().next().value);
    return l;
  }
  // { year, est } - est: dated from neighbouring serials that differ by a year (shown "~")
  function yearBySerial(type, msn) {
    const l = type && msn ? typeSerials(String(type).toUpperCase()) : null; if (!l) return null;
    const sn = normSerial(msn), hit = l.find(x => x.sn === sn); if (hit) return { year: hit.y, est: false, how: 'its own record' };
    const k = serialKey(sn); if (!k) return null;
    let lo = null, hi = null;
    for (const x of l) { if (!x.k || x.k[0] !== k[0]) continue; if (x.k[1] <= k[1] && (!lo || x.k[1] > lo.k[1])) lo = x; if (x.k[1] >= k[1] && (!hi || x.k[1] < hi.k[1])) hi = x; }
    if (!lo || !hi) return null;
    const span = hi.k[1] - lo.k[1];
    if (Math.abs(hi.y - lo.y) > 1 || span > Math.max(30, k[1] * 0.04)) return null;
    return { year: Math.round(lo.y + (hi.y - lo.y) * (span ? (k[1] - lo.k[1]) / span : 0)), est: lo.y !== hi.y, how: 'its serial number' };
  }
  // the build year as known: a register's, else from the serial number; and the AGE text FR24 would show
  function builtYear(hx) {
    const y = Number(hx && hx.year) || 0; if (y > 1930) return { year: y, est: false, how: 'the register' };
    return hx ? yearBySerial(hx.type, hx.msn) : null;
  }
  function ageText(hx) {
    const b = builtYear(hx); if (!b) return '';
    const a = Math.max(0, new Date().getFullYear() - b.year);
    return (b.est ? '~' : '') + (a ? `${a} year${a === 1 ? '' : 's'}` : '< 1 year');
  }
  const ageTitle = hx => { const b = builtYear(hx); return b ? `Built ${b.est ? 'about ' : ''}${b.year} (from ${b.how})` : ''; };
  // runs a generator in slices of ~8 ms, giving the page its turn in between
  async function runSliced(it) { for (;;) { const t0 = Date.now(); while (Date.now() - t0 < 8) if (it.next().done) return; await sleep(0); } }
  let t2Ready = null;
  function loadT2() {
    if (t2Ready) return t2Ready;
    t2Ready = (async () => {
      if (typeof ROUTE_T2_GZ !== 'string' || !ROUTE_T2_GZ || typeof DecompressionStream !== 'function') return false;
      const t0 = now(), bin = atob(ROUTE_T2_GZ), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const txt = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      let p; if (txt.startsWith('T2L1\n')) { p = {}; await runSliced(parseT2Lines(txt, p)); } else p = JSON.parse(txt);
      let t = p; if (p && p.pk === 2) { t = {}; await runSliced(unpackT2Steps(p, t)); }
      ENGINE.setTables2(t);
      log('population tables', Math.round(txt.length / 1e6 * 10) / 10 + ' MB in', now() - t0, 'ms');
      return true;
    })().catch(e => { log('population tables', String(e && e.message || e)); return false; });
    return t2Ready;
  }

  // ---- conditions at the candidate airports: METARs (aviationweather.gov) ------------------------------------------------
  // Below landing minima, IFR for a light aircraft flying VFR, a crosswind beyond what the class lands in on any runway -
  // and which runways are in use, for the approach geometry. Asked for the few likeliest fields of the aircraft being
  // looked at (never the whole map), at most every 10 minutes per field.
  const wxCache = new Map();    // ICAO -> { askedAt, entry }
  const wxMap = new Map();      // ICAO -> { cat, ws, wd, gust, vis (km), ceil (ft), raw, at } - what the engine reads
  let wxBusy = false; const wxQueue = new Set(), wxWaiters = new Set();
  const visKm = v => { const n = parseFloat(String(v == null ? '' : v).replace('+', '')); return fin(n) ? n * 1.609 : NaN; };
  function wxEntry(m) {
    let ceil = Infinity; for (const c of m.clouds || []) if (/BKN|OVC|VV/.test(c.cover || '') && fin(+c.base)) ceil = Math.min(ceil, +c.base);
    const vis = visKm(m.visib);
    const cat = m.fltCat || (ceil < 500 || vis < 1.6 ? 'LIFR' : ceil < 1000 || vis < 4.8 ? 'IFR' : ceil <= 3000 || vis <= 8 ? 'MVFR' : 'VFR');
    return { cat, ws: fin(+m.wspd) ? +m.wspd : NaN, wd: fin(+m.wdir) ? +m.wdir : NaN, gust: fin(+m.wgst) ? +m.wgst : NaN, vis, ceil, raw: m.rawOb || '', at: (+m.obsTime || 0) * 1000 };
  }
  function wantWx(icaos, onNew) {
    for (const i0 of icaos || []) { const i = String(i0 || '').toUpperCase(); if (!/^[A-Z]{4}$/.test(i)) continue; const c = wxCache.get(i); if (c && now() - c.askedAt < 600000) continue; wxQueue.add(i); }
    if (onNew) wxWaiters.add(onNew);
    pumpWx();
  }
  async function pumpWx() {
    if (wxBusy || !wxQueue.size) return;
    wxBusy = true;
    try {
      while (wxQueue.size) {
        const ids = [...wxQueue].slice(0, 20); for (const i of ids) { wxQueue.delete(i); wxCache.set(i, { askedAt: now(), entry: (wxCache.get(i) || {}).entry || null }); }
        let j = null, tj = null;
        [j, tj] = await Promise.all([gmRequest(`https://aviationweather.gov/api/data/metar?ids=${ids.join(',')}&format=json`, { timeout: 10000 }).catch(e => { log('metar', String(e.message || e)); return null; }), gmRequest(`https://aviationweather.gov/api/data/taf?ids=${ids.join(',')}&format=json`, { timeout: 10000 }).catch(e => { log('taf', String(e.message || e)); return null; })]);
        // the forecast: its prevailing periods (from / becoming - not the temporary ones), as the METAR entries are made
        const tafs = new Map();
        for (const t of Array.isArray(tj) ? tj : []) {
          const i = String(t.icaoId || '').toUpperCase(), per = [];
          for (const f of t.fcsts || []) { if (f.fcstChange === 'TEMPO' || f.fcstChange === 'PROB' || f.probability) continue; const e = wxEntry({ wspd: f.wspd, wdir: f.wdir, wgst: f.wgst, visib: f.visib, clouds: f.clouds }); per.push({ from: (f.fcstChange === 'BECMG' && f.timeBec) || f.timeFrom, to: f.timeTo, cat: e.cat, ws: e.ws, wd: e.wd, gust: e.gust }); }
          per.sort((a, b) => a.from - b.from); if (per.length) tafs.set(i, per);
        }
        let got = 0;
        for (const m of Array.isArray(j) ? j : []) { const i = String(m.icaoId || '').toUpperCase(); if (!i) continue; const e = wxEntry(m); if (tafs.has(i)) e.taf = tafs.get(i); wxCache.set(i, { askedAt: now(), entry: e }); if (now() - e.at < 90 * 60000) { wxMap.set(i, e); got++; } }
        if (got) { const w = [...wxWaiters]; wxWaiters.clear(); for (const fn of w) { try { fn(); } catch (e) { /* ignore */ } } }
      }
    } finally { wxBusy = false; }
    for (const [i, e] of wxMap) if (now() - e.at > 90 * 60000) wxMap.delete(i);
  }
  // ---- closures: NOTAMs through the FAA's NOTAM API, with the user's own free key (Settings: sources) ---------------------
  // "AD CLSD" (the whole aerodrome, no exceptions listed) in force at the arrival time takes a field out. Without a key
  // nothing is asked. (The FAA's public NOTAM search is behind a captcha - not used.)
  const notamCache = new Map();  // ICAO -> { askedAt }
  const closedMap = new Map();   // ICAO -> [{ from, to, text }]
  const notamKey = () => { try { const k = store.kvGet('faaNotam') || {}; return k.id && k.secret ? k : null; } catch (e) { return null; } };
  async function wantNotams(icaos, onNew) {
    const key = notamKey(); if (!key) return;
    for (const i0 of (icaos || []).slice(0, 3)) {
      const i = String(i0 || '').toUpperCase(); if (!/^[A-Z]{4}$/.test(i)) continue;
      const c = notamCache.get(i); if (c && now() - c.askedAt < 3 * 3600e3) continue;
      notamCache.set(i, { askedAt: now() });
      try {
        const j = await gmRequest(`https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${i}&pageSize=200`, { headers: { client_id: key.id, client_secret: key.secret }, timeout: 15000 });
        const out = [];
        for (const it of (j && j.items) || []) {
          const n = it && it.properties && it.properties.coreNOTAMData && it.properties.coreNOTAMData.notam; if (!n) continue;
          const text = String(n.text || ''); if (!/\bAD CLSD\b|AERODROME CLOSED|\bAD CLOSED\b/i.test(text) || /\bEXC\b|EXCEPT|\bPPR\b|\bPN\b/i.test(text)) continue;
          const from = Date.parse(n.effectiveStart) / 1000, to = /PERM/i.test(n.effectiveEnd || '') ? 4e9 : Date.parse(n.effectiveEnd) / 1000;
          if (fin(from) && fin(to)) out.push({ from, to, text: text.slice(0, 160) });
        }
        if (out.length) closedMap.set(i, out); else closedMap.delete(i);
        if (onNew) onNew();
      } catch (e) { log('notam', i, String(e.message || e)); }
    }
  }

  // ---- FIR / UIR (the airspace an aircraft is in) ---------------------------------------------------------------------
  // FR24 padlocks it for every flight. Worked out from position AND height against EUROCONTROL's FIR/UIR boundaries (the
  // Network Manager's atlas, AIRAC 524: 324 FIRs, UIRs and oceanic areas worldwide, each with its flight-level band), so
  // an aircraft is in the lower FIR below the split - FL195 in France, FL245 in Germany and the UK - and in the UIR
  // above it. EJU958Q at FL260 near Beauvais is in the France UIR over the Paris FIR; the flight-sim network's sector map
  // used before (VATSpy, CC BY-SA 4.0) has Brest's upper sectors overlapping Paris and said "Brest". That map stays as
  // the fallback when the atlas cannot be had. Fetched once, simplified to ~1 km and kept on disk.
  const FIR_EC_URL = 'https://raw.githubusercontent.com/Overwatch-AI/eurocontrol-atlas/master/data/fir-uir.geojson';
  const FIR_URL = 'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/';
  const fir = { list: null, loading: null };
  const titleCase = s => String(s || '').toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Fir|Uir|Cta|Oca|Acc|Uac)\b/g, m => m.toUpperCase());
  // [lat, lon, lat, lon...] rings from GeoJSON [lon, lat] ones; a shape across the 180th meridian keeps its western
  // longitudes past 180 (the point is tried at lon + 360 too)
  function firShape(polys, tol) {
    let lo = 1e9, hi = -1e9; for (const poly of polys) for (const p of (poly && poly[0]) || []) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
    const wrap = hi - lo > 180, b = [90, 1e9, -90, -1e9], out = [];
    for (const poly of polys) {
      const rings = [];
      for (const ring0 of poly || []) {
        if (!ring0 || ring0.length < 4) continue;
        const flat = [];
        for (const [lon, lat] of simplifyRing(wrap ? ring0.map(p => [p[0] < 0 ? p[0] + 360 : p[0], p[1]]) : ring0, tol)) {
          flat.push(Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000);
          if (!rings.length) { b[0] = Math.min(b[0], lat); b[1] = Math.min(b[1], lon); b[2] = Math.max(b[2], lat); b[3] = Math.max(b[3], lon); }
        }
        rings.push(flat);
      }
      if (rings.length) out.push(rings);
    }
    return { b, p: out };
  }
  // the atlas's names as they are spoken: US centres by name ("Chicago Center"), a few that carry a region or country
  const FIR_NAMES = { RJJJ: 'Fukuoka FIR', DGAC: 'Accra FIR', DNKK: 'Kano FIR', DRRR: 'Niamey FIR', UAAA: 'Almaty FIR', WAAF: 'Ujung Pandang FIR', ENOR: 'Polaris FIR', ULLL: 'St Petersburg FIR', URRV: 'Rostov FIR', GOOO: 'Dakar FIR', CZQX: 'Gander Oceanic', BODO: 'Bodø Oceanic', VVVV: 'Hanoi FIR' };
  function firNameOf(pr, code, type) {
    if (FIR_NAMES[code]) return FIR_NAMES[code];
    let n = String(pr.name || '').replace(/\bFLIGHT INFORMATION REGION\b/i, 'FIR').replace(/^FIR (.+)$/i, '$1 FIR').replace(/^UIR (.+)$/i, '$1 UIR').trim();
    if (!n || n === 'null') return code;
    if (/^K/.test(code) && !/\b(FIR|UIR|OCEANIC)\b/i.test(n)) return titleCase(n) + ' Center';
    if (!/\b(FIR|UIR|OCA|CTA|ACC|UTA|OCEANIC)\b/i.test(n)) n += type === 'UIR' ? ' UIR' : ' FIR';
    return titleCase(n);
  }
  async function loadFirEc() {
    const geo = await gmRequest(FIR_EC_URL, { timeout: 40000, bg: true });
    const list = [];
    for (const f of (geo && geo.features) || []) {
      const pr = (f && f.properties) || {}, code = clean(pr.code).toUpperCase(), type = clean(pr.type).toUpperCase();
      // (not an airspace: "no FIR" filler, and flow-management rerouting extensions over the oceanic areas)
      if (!code || code === 'XXXX' || !f.geometry || /REROUTING/i.test(pr.name || '')) continue;
      const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : [];
      const sh = firShape(polys, 0.01); if (!sh.p.length) continue;
      list.push({ ec: 1, id: code, type, name: firNameOf(pr, code, type), lo: Number(pr.min_fl) || 0, hi: Number(pr.max_fl) || 999, b: sh.b, p: sh.p });
    }
    return list.length > 100 ? list : null;
  }
  function simplifyRing(ring, tol) {
    if (ring.length < 5) return ring;
    const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
    const stack = [[0, ring.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); const [ax, ay] = ring[a], [bx, by] = ring[b]; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      let far = -1, fd = tol;
      // (a closed ring starts and ends on the same point: distances are then taken from that point, not a line)
      for (let i = a + 1; i < b; i++) { const d = L > 1e-9 ? Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / L : Math.hypot(ring[i][0] - ax, ring[i][1] - ay); if (d > fd) { fd = d; far = i; } }
      if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    return ring.filter((_, i) => keep[i]);
  }
  function loadFir() {
    if (fir.list) return Promise.resolve(fir.list);
    if (fir.loading) return fir.loading;
    fir.loading = Promise.race([store.kvReady, sleep(1500)]).then(async () => {
      const c = store.kvGet('fir3');
      if (c && Array.isArray(c.list) && c.list.length > 100 && now() - (c.at || 0) < 60 * 864e5) { fir.list = c.list; return fir.list; }
      try { const ec = await loadFirEc(); if (ec) { store.kvSet('fir3', { at: now(), list: ec }); if (store.kvGet('fir2')) store.kvSet('fir2', null); fir.list = ec; log('FIR/UIR boundaries (EUROCONTROL)', ec.length); return fir.list; } } catch (e) { log('FIR/UIR atlas', String(e.message || e)); }
      const c2 = store.kvGet('fir2');
      if (c2 && Array.isArray(c2.list) && c2.list.length > 100) { fir.list = c2.list; return fir.list; }
      const [geo, dat] =await Promise.all([gmRequest(FIR_URL + 'Boundaries.geojson', { timeout: 40000, bg: true }), gmRequest(FIR_URL + 'VATSpy.dat', { timeout: 40000, json: false, accept: 'text/plain', bg: true })]);
      const names = new Map(); let sec = '';
      for (const line of String(dat || '').split(/\r?\n/)) {
        const l = line.trim(); if (!l || l[0] === ';') continue;
        if (/^\[.*\]$/.test(l)) { sec = l; continue; }
        if (sec !== '[FIRs]') continue;
        const [icao, name, , bnd] = l.split('|').map(x => (x || '').trim());
        for (const k of [bnd, icao]) if (k && name && !names.has(k)) names.set(k, name);
      }
      const list = [];
      for (const f of (geo && geo.features) || []) {
        const id = clean(f && f.properties && f.properties.id); if (!id || !f.geometry) continue;
        const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : [];
        // a boundary across the 180th meridian: its western longitudes continue past 180, so it is one shape again
        let lo = 1e9, hi = -1e9; for (const poly of polys) for (const p of (poly && poly[0]) || []) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
        const wrap = hi - lo > 180;
        const rings = []; const b = [90, 1e9, -90, -1e9];
        for (const poly of polys) {
          const ring = poly && poly[0]; if (!ring || ring.length < 4) continue;
          const flat = [];
          for (const [lon0, lat] of simplifyRing(wrap ? ring.map(p => [p[0] < 0 ? p[0] + 360 : p[0], p[1]]) : ring, 0.02)) { const lon = lon0; flat.push(Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000); b[0] = Math.min(b[0], lat); b[1] = Math.min(b[1], lon); b[2] = Math.max(b[2], lat); b[3] = Math.max(b[3], lon); }
          rings.push(flat);
        }
        const base = id.split('-')[0];
        if (rings.length) list.push({ id, base, sector: id.includes('-'), name: names.get(id) || '', baseName: names.get(base) || '', o: String(f.properties.oceanic) === '1', b, r: rings });
      }
      if (list.length > 100) { store.kvSet('fir2', { at: now(), list }); fir.list = list; log('FIR boundaries', list.length); }
      return fir.list;
    }).catch(e => { log('FIR boundaries', String(e.message || e)); fir.loading = null; return null; });
    return fir.loading;
  }
  function inRing(r, lat, lon) {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const yi = r[i], xi = r[i + 1], yj = r[j], xj = r[j + 1]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside; }
    return inside;
  }
  // The FIR holding the point. The dataset (made for a flight-sim network) also carries controller positions inside
  // FIRs - sectors (ids with a dash), terminal areas ("TMA", "Up to FL..."), military, information-only and combined
  // positions ("&", ids ending XX): those only answer where no real FIR does. Among real FIRs the largest wins.
  // (Boundaries across 180 use longitudes past it, so the point is tried at lon + 360 too.)
  function firRank(f) {
    const n = f.name || '';
    if (f.sector) return -3;
    if (/military|information|\bfis\b|&/i.test(n) || /XX$/.test(f.id)) return -2;
    if (/\bTMA\b|up to FL/i.test(n)) return -1;
    return 0;
  }
  // (inside the outer ring of one of its parts and in none of that part's holes)
  const inShape = (f, lat, lon) => f.p.some(rs => inRing(rs[0], lat, lon) && !rs.slice(1).some(h => inRing(h, lat, lon)));
  // The atlas: of the airspaces holding the point, the one whose flight-level band holds the aircraft's height (the
  // lower FIR when the height is not known); several - sub-areas, an oceanic area over a FIR - the smallest.
  function firAtEc(lat, lon, alt) {
    const fl = fin(alt) ? Math.max(0, alt) / 100 : null;
    let best = null, bestKey = null;
    for (const f of fir.list) {
      for (const L of [lon, lon + 360]) {
        if (lat < f.b[0] || lat > f.b[2] || L < f.b[1] || L > f.b[3]) continue;
        if (!inShape(f, lat, L)) continue;
        const inBand = fl == null ? f.lo === 0 : fl >= f.lo && (fl < f.hi || f.hi >= 999);
        const key = [inBand ? 0 : 1, f.type === 'OTHER' ? 1 : 0, (f.b[2] - f.b[0]) * (f.b[3] - f.b[1])];
        if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) { best = f; bestKey = key; }
        break;
      }
    }
    return best;
  }
  function firAt(lat, lon, alt) {
    if (!fir.list || !fin(lat) || !fin(lon)) return null;
    if (fir.list[0] && fir.list[0].ec) return firAtEc(lat, lon, alt);
    let best = null, bestRank = -9, bestArea = -1;
    for (const f of fir.list) {
      for (const L of [lon, lon + 360]) {
        if (lat < f.b[0] || lat > f.b[2] || L < f.b[1] || L > f.b[3]) continue;
        if (f.r.some(r => inRing(r, lat, L))) {
          const rank = firRank(f), area = (f.b[2] - f.b[0]) * (f.b[3] - f.b[1]);
          if (rank > bestRank || (rank === bestRank && area > bestArea)) { best = f; bestRank = rank; bestArea = area; }
          break;
        }
      }
    }
    return best;
  }
  // "Shannon ACC - Shannon" -> "Shannon", "Melbourne (Bindook) 129.8* (133.15)" -> "Melbourne"
  const firName = n => String(n || '').split(' - ').pop().replace(/\s*\([^)]*\)/g, '').replace(/\s*\d{3}\.\d+\*?/g, '').replace(/\s+/g, ' ').trim();
  // FR24 shows the FIR as its name plus the ICAO code in a small badge ("LONDON [EGTT]")
  function firInfo(lat, lon, alt) {
    const f = firAt(lat, lon, alt); if (!f) return null;
    if (f.ec) return { name: f.name || f.id, code: f.id, type: f.type, lo: f.lo, hi: f.hi };
    const code = f.base || f.id, name = firName((f.sector ? f.baseName : f.name) || f.baseName || f.name);
    return { name: name || code, code };
  }
  function firLabelAt(lat, lon, alt) { const f = firInfo(lat, lon, alt); return f ? (f.name !== f.code ? `${f.name} (${f.code})` : f.code) : ''; }
