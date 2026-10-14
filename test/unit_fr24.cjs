// The monitor reading FR24 itself (22.20): monitor/fr24.cjs (FR24's feed decoded from real recorded answers, the request,
// headers, pushback, the world scan split when full), monitor/ident.cjs (naming every callsign-less FR24 flight: live ADS-B,
// ambiguity, one aircraft per flight, kept over the ocean, withdrawn when it diverges, carried forward, FR24's trail against
// the recorded track, parked, a browser's own names, lookups, kept on disk), monitor/dest.cjs (a rough destination), and the
// monitor's /fr24ids and POST /report. All offline.
// usage: node test/unit_fr24.cjs <dataDir>
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os'), http = require('http');
process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monfr24-'));
process.env.MON_PORT = String(41000 + Math.floor(Math.random() * 8000));
process.env.MON_TOKEN = 'test-secret';
process.env.MON_PUBLIC = '0';   // (a private monitor: everything needs the secret - test/unit_public.cjs has the public one)
const FR = require('../monitor/fr24.cjs'), { createIdent } = require('../monitor/ident.cjs'), { createDest } = require('../monitor/dest.cjs');
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const code = id => { const a = E.byId(id); return a ? a.iata || a.icao : id; };
const trace = (hex, day) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs', hex, day + '_lol.json.gz'))).toString());
const env = () => ({ E, live: new Map(), ac: new Map(), blocked: new Map(), legs: new Map() });
const T = 1792000000, MS = T * 1000;
const fl = (id, o) => Object.assign({ id, lat: 50, lon: 0, alt: 30000, trk: 90, spd: 420, ts: T, gnd: false, src: 0, type: 'GLF6', reg: '', cs: '', icon: 3 }, o);
const liveRow = (hex, o) => ({ a: Object.assign({ hex, lat: 50, lon: 0, alt_baro: 30000, gs: 420, track: 90, dbFlags: 8, r: 'N1', t: 'GLF6' }, o), t: (o && o._t) || T });

(async () => {
  // ================= fr24.cjs =================
  { const j = require('./fixtures/playback_1235.json');
    const fr = FR.frames(Buffer.from(j.feed, 'base64')), lf = FR.parse(fr.msgs[0]).find(f => f.fn === 1), d = FR.decodeLiveFeed(lf.val), m = d.flights.find(f => f.id === j.id);
    check('FR24 feed decoded from a real recorded answer (9 Oct 12:35Z): 68 flights, M-ARNZ among them with no callsign, FL250, ADS-B', d.flights.length === 68 && !!m && m.cs === '' && m.alt === 25000 && Math.abs(m.lat - 53.607) < 0.01 && m.src === 0, m); }
  { const q = { n: 72, s: 24, w: -50, e: -30, services: [2, 3], traffic: 2, limit: 1500, maxage: 14400 };
    const fs0 = FR.parse(FR.liveFeedRequest(q)), b = FR.parse(fs0.find(f => f.fn === 1).val), f32 = v => new DataView(v.buffer, v.byteOffset, 4).getFloat32(0, true);
    const mask = FR.parse(fs0.find(f => f.fn === 10).val).map(f => Buffer.from(f.val).toString());
    check('the world scan\'s request: bounds, limit, max age, type and registration asked for', f32(b[0].val) === 72 && f32(b[3].val) === -30 && fs0.find(f => f.fn === 7).val === 1500 && fs0.find(f => f.fn === 8).val === 14400 && mask.join() === 'type,reg', { mask }); }
  { const t = require('./fixtures/tiger68_follow.json'), pts = FR.decodeTrail(Buffer.from(t.first, 'base64'));
    check('FR24\'s trail decoded from a real FollowFlight answer (TIGER68): points in time order, near Prestwick at the start', pts.length > 50 && pts.every((p, i) => !i || p.t >= pts[i - 1].t) && E.dist(pts[0].lat, pts[0].lon, 55.509, -4.594) < 60, { n: pts.length, first: pts[0] }); }
  // the client: headers, pushback, a stream read to its first frame
  { const calls = []; let mode = 'ok';
    const feedAnswer = flights => { const msg = Buffer.concat(flights.map(f => Buffer.from(FR.frame(Uint8Array.from([0x0a, ...[]]))).subarray(0, 0))); void msg; return null; };
    void feedAnswer;
    const enc = list => { // a LiveFeedResponse with these flights, and the trailers
      const parts = []; for (const f of list) { const b = []; const vi = n => { const o = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 0x80; o.push(x); } while (n); return o; };
        b.push(0x08, ...vi(f.id)); const fb = Buffer.alloc(5); fb[0] = 0x15; fb.writeFloatLE(f.lat, 1); b.push(...fb); const gb = Buffer.alloc(5); gb[0] = 0x1d; gb.writeFloatLE(f.lon, 1); b.push(...gb); b.push(0x28, ...vi(f.alt), 0x30, ...vi(f.spd), 0x48, ...vi(f.ts));
        parts.push(0x0a, ...vi(b.length), ...b); }
      const body = Uint8Array.from(parts), tr = Buffer.from('grpc-status:0\r\ngrpc-message:\r\n');
      return Buffer.concat([Buffer.from(FR.frame(body)), Buffer.from([0x80, 0, 0, 0, tr.length]), tr]); };
    const fetch = async (url, o) => {
      calls.push({ url, headers: o.headers });
      if (mode === '429') return { status: 429, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
      if (mode === 'grpc8') { const tr = Buffer.from('grpc-status:8\r\ngrpc-message:Flights%20limit\r\n'); return { status: 200, headers: { get: () => null }, arrayBuffer: async () => Buffer.concat([Buffer.from([0x80, 0, 0, 0, tr.length]), tr]) }; }
      if (/FollowFlight/.test(url)) { // a stream that never ends: its first frame, then nothing
        const t = require('./fixtures/tiger68_follow.json'), first = Buffer.from(FR.frame(Buffer.from(t.first, 'base64'))); let sent = 0;
        return { status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: () => sent++ < 2 ? Promise.resolve({ value: first.subarray(sent === 1 ? 0 : 7, sent === 1 ? 7 : first.length), done: false }) : new Promise(() => {}) }) } };
      }
      return { status: 200, headers: { get: () => null }, arrayBuffer: async () => enc([{ id: 0x1234, lat: 51.5, lon: -0.1, alt: 41000, spd: 480, ts: T }]) };
    };
    const c = FR.createClient({ fetch, deviceId: 'web-test' });
    const a = await c.liveFeed({ n: 60, s: 40, w: -10, e: 10 });
    const h = calls[0].headers;
    check('client: the LiveFeed answer read (frames, trailers)', a.flights.length === 1 && a.flights[0].id === 0x1234 && a.flights[0].alt === 41000, a.flights[0]);
    check('... asked with FR24\'s kind of headers (grpc-web, device id, origin)', h['content-type'] === 'application/grpc-web+proto' && h['x-grpc-web'] === '1' && h['fr24-device-id'] === 'web-test' && h.origin === 'https://www.flightradar24.com', h);
    const okSet = c.setHeaders({ 'fr24-device-id': 'web-real', 'fr24-platform': 'web-26.41.0', Authorization: 'Bearer SECRET', Cookie: 'x=1', 'x-evil': 'y\r\nz' }, 'Mozilla/5.0 (Windows NT 10.0) Chrome/140');
    calls.length = 0; await c.liveFeed({ n: 1, s: 0, w: 0, e: 1 });
    const h2 = calls[0].headers;
    check('... a browser\'s headers taken - never its authorization, cookies or anything else', okSet && h2['fr24-device-id'] === 'web-real' && h2['fr24-platform'] === 'web-26.41.0' && !Object.keys(h2).some(k => /authorization|cookie|x-evil/i.test(k)) && /Chrome\/140/.test(h2['user-agent']), h2);
    const tr = await c.followTrail(0x41d39a10);
    check('... FollowFlight: the first frame of the stream read, then closed (the trail)', tr.length > 50, tr.length);
    mode = 'grpc8'; let e1 = ''; try { await c.liveFeed({ n: 1, s: 0, w: 0, e: 1 }); } catch (e) { e1 = String(e); }
    check('... FR24 pushing back (gRPC 8 in the trailers): left alone 10 minutes', /grpc 8/.test(e1) && c.st.pauseUntil > Date.now() + 9 * 60000, { e1, pause: Math.round((c.st.pauseUntil - Date.now()) / 1000) });
    mode = 'ok'; calls.length = 0; let e2 = ''; try { await c.liveFeed({ n: 1, s: 0, w: 0, e: 1 }); } catch (e) { e2 = String(e); }
    check('... and nothing asked while paused', /paused/.test(e2) && calls.length === 0);
    c.st.pauseUntil = 0; mode = '429'; try { await c.liveFeed({ n: 1, s: 0, w: 0, e: 1 }); } catch (e) { /* expected */ }
    check('... HTTP 429: paused again, twice as long (20 minutes)', c.st.pauseUntil > Date.now() + 19 * 60000);
  }
  // the world scan: a full answer split in four; FR24 pushing back ends the round
  { const asked = [];
    const client = { liveFeed: async q => { asked.push(q); if (q.n === 72 && q.s === 24 && q.w === -50) return { flights: Array.from({ length: 1500 }, (_, i) => fl(1e6 + i)), serverTime: 1 }; return { flights: [fl(5e6 + asked.length)], serverTime: 1 }; } };
    const r = await FR.scanWorld(client, { gapMs: 0 });
    check('world scan: 7 regions; the full one (1,500 flights) asked again in quarters', r.requests === 11 && asked.filter(q => q.n === 72 && q.s === 48 && q.w === -50).length === 1 && r.flights.length === 1500 + 10, { requests: r.requests, flights: r.flights.length });
    const c2 = { liveFeed: async () => { throw new Error('HTTP 429'); } };
    const r2 = await FR.scanWorld(c2, { gapMs: 0 });
    check('... refused: the round ends at once', r2.requests === 0 && r2.failed === 1); }

  // ================= ident.cjs =================
  // live ADS-B: named; the hook told (a blocked aircraft from now on)
  { const e = env(), hooked = []; e.onIdentified = (hex, info) => hooked.push([hex, info.reg]);
    e.live.set('a00001', liveRow('a00001', { lat: 50.01, lon: 0.02, _t: T - 5 }));
    const I = createIdent(e); I.observe([fl(1)], MS, 'scan'); I.match(MS);
    const R = I.ids.get(1);
    check('ident: a callsign-less FR24 flight named from live ADS-B (position carried to FR24\'s time)', !!R && R.hex === 'a00001' && R.how === 'list' && R.reg === 'N1' && (R.flags & 1), R);
    check('... the monitor told (it follows the aircraft from now on)', hooked.length === 1 && hooked[0][0] === 'a00001');
    // the same flight over the ocean, satellite positions only, nobody hears it: still named
    I.observe([fl(1, { lat: 52, lon: -30, ts: T + 7200, src: 5 })], MS + 7200e3, 'scan'); I.match(MS + 7200e3);
    check('... over the ocean (FR24 satellite positions, no ADS-B): still named', I.ids.get(1) && I.ids.get(1).hex === 'a00001');
    const tb = I.table(0);
    check('... in the browsers\' table: id, address, registration, type, flags, how', tb.rows.length === 1 && tb.rows[0][0] === 1 && tb.rows[0][1] === 'a00001' && tb.rows[0][2] === 'N1' && tb.rows[0][3] === 'GLF6' && tb.rows[0][5] === 1 && tb.rows[0][6] === 'list', tb.rows[0]); }
  // two that could be it: none; a flight with a callsign or registration: not FR24's N/A, left alone
  { const e = env();
    e.live.set('a00001', liveRow('a00001', { lat: 50.01, lon: 0.0 })); e.live.set('a00002', liveRow('a00002', { lat: 50.0, lon: 0.015, r: 'N2' }));
    const I = createIdent(e); I.observe([fl(2), fl(3, { cs: 'BAW1' }), fl(4, { reg: 'G-ABCD', lat: 10 })], MS, 'scan'); I.match(MS);
    check('ident: two aircraft that could be it - none named; flights FR24 names itself not taken in', !I.ids.has(2) && !I.flights.has(3) && !I.flights.has(4)); }
  // one aircraft, one flight
  { const e = env(); e.live.set('a00001', liveRow('a00001', { lat: 50.0, lon: 0.0 }));
    const I = createIdent(e); I.observe([fl(5)], MS, 'scan'); I.match(MS); I.observe([fl(6, { lat: 50.02 })], MS, 'scan'); I.match(MS);
    check('ident: an aircraft already given to a flight FR24 still draws is not given to another', I.ids.get(5) && I.ids.get(5).hex === 'a00001' && !I.ids.has(6)); }
  // divergence: withdrawn after 4 far reports over 3 minutes
  { const e = env(); e.live.set('a00001', liveRow('a00001'));
    const I = createIdent(e); I.observe([fl(7)], MS, 'scan'); I.match(MS);
    for (let k = 1; k <= 5; k++) { const t = T + k * 60; e.live.set('a00001', liveRow('a00001', { lat: 51, _t: t })); I.observe([fl(7, { ts: t })], (t) * 1000, 'scan'); I.match(t * 1000); }
    const tb = I.table(MS + 1);
    check('ident: the aircraft heard 100 km from where FR24 has the flight, again and again for 3+ minutes: withdrawn (and the browsers told)', !I.ids.has(7) && tb.gone.includes(7)); }
  // carried forward over the ocean: last heard cruising west of Ireland, FR24 has a GLF6 an hour on along its track
  { const e = env(), t0 = T - 3600;
    // (an hour at 470 kt on a constant track due west - as jets cross an ocean - FR24's position 4 km off it)
    const [rl, ro] = E.reckon({ lat: 53, lon: -15, gs: 470, trk: 270 }, 3600, 270, 470), la = rl + 0.03, lo = ro + 0.02;
    e.ac.set('b00001', { meta: { type: 'GLF6', reg: 'N500X', lastPos: { t: t0, lat: 53, lon: -15, alt: 41000, gs: 470, trk: 270 } }, rows: [], last: t0 });
    const I = createIdent(e); I.observe([fl(8, { lat: la, lon: lo, trk: 270, spd: 470, alt: 41000, src: 5 })], MS, 'scan'); I.match(MS);
    check('ident: over the ocean, a jet last heard cruising carried forward an hour to where FR24 has it - named', I.ids.get(8) && I.ids.get(8).hex === 'b00001' && I.ids.get(8).how === 'reckon', I.ids.get(8));
    e.ac.set('b00002', { meta: { type: 'GLF6', reg: 'N600X', lastPos: { t: t0, lat: 53.05, lon: -15, alt: 41000, gs: 470, trk: 270 } }, rows: [], last: t0 });
    const I2 = createIdent(e); I2.observe([fl(9, { lat: la, lon: lo, trk: 270, spd: 470, alt: 41000, src: 5 })], MS, 'scan'); I2.match(MS);
    check('... two that fit: none', !I2.ids.has(9)); }
  // FR24's trail against the recorded track: D-CLUB (Phenom 300) Seville -> Toulon, heard for its first 40 minutes, then
  // FR24 alone (satellite) - its trail since take-off lies on what the monitor recorded
  let dclub = null;
  { const j = trace('3cdf15', '2026-10-02'), pts = j.trace.map(p => [j.timestamp + p[0]].concat(p.slice(1, 11)));
    const legs = E.legsFromPoints(E.parseTrace(j), { cls: 'bizjet', type: 'E55P' }), leg = legs[0], tOff = leg.start.t, tEnd = leg.end.t;
    const cut = tOff + 40 * 60, now = Math.round((tOff + tEnd) / 2) + 600;
    const e = env(), rows = pts.filter(r => r[0] >= tOff - 600 && r[0] <= cut);
    const lp = rows[rows.length - 1];
    e.ac.set('3cdf15', { meta: { type: 'E55P', reg: 'D-CLUB', lastPos: { t: lp[0], lat: lp[1], lon: lp[2], alt: lp[3], gs: lp[4], trk: lp[5] } }, rows, last: lp[0], first: rows[0][0] });
    // (a decoy of the same type, heard elsewhere)
    e.ac.set('3c0000', { meta: { type: 'E55P', reg: 'D-OTHR', lastPos: { t: lp[0], lat: 48, lon: 11, alt: 39000, gs: 400, trk: 90 } }, rows: pts.filter(r => r[0] <= cut).map(r => [r[0], r[1] + 3, r[2] + 6].concat(r.slice(3))), last: lp[0] });
    const at = pts.filter(r => r[0] <= now).pop();
    const F = fl(10, { lat: at[1], lon: at[2], alt: at[3], trk: at[5], spd: at[4], ts: at[0], type: 'E55P', src: 5 });
    const I = createIdent(e); I.observe([F], now * 1000, 'scan');
    // (no airport within 150 km? the D-CLUB leg is over the Mediterranean - satellite source marks it out of coverage anyway)
    I.match(now * 1000);
    check('ident: out of coverage and nobody carried forward fits: queued for FR24\'s trail', !I.ids.has(10) && I.trailQ.includes(10), { q: I.trailQ });
    const fr24Trail = pts.filter(r => r[0] >= tOff && r[0] <= now && (r[0] - tOff) % 30 < 8).map(r => ({ t: r[0], lat: r[1], lon: r[2], alt: r[3] === 'ground' ? 0 : r[3], gs: r[4], trk: r[5] }));
    I.setTrail(I.nextTrail().id, fr24Trail, now * 1000); I.match(now * 1000);
    const R = I.ids.get(10);
    check('... FR24\'s trail since take-off lies on the track recorded of D-CLUB: named (not the decoy of the same type)', !!R && R.hex === '3cdf15' && R.how === 'trail', R);
    dclub = { e, I, now, F, tOff, tEnd, j }; }
  // parked: the only one of its type whose last flight ended here
  { const e = env(), ltn = E.byIcao('EGGW');
    e.legs.set('c00001', new Map([[1, { hex: 'c00001', type: 'FA7X', reg: 'OK-FLN', tStart: T - 7200, tEnd: T - 3600, tOff: T - 7100, ended: true, open: false, to: { id: ltn.id, code: 'LTN', conf: 'ground' } }]]));
    const I = createIdent(e); I.observe([fl(11, { lat: ltn.lat + 0.005, lon: ltn.lon, alt: 0, gnd: true, spd: 0, type: 'FA7X' })], MS, 'scan'); I.match(MS);
    check('ident: on the ground where nobody hears it - the only FA7X whose last flight ended at Luton, not heard since: named', I.ids.get(11) && I.ids.get(11).hex === 'c00001' && I.ids.get(11).how === 'parked', I.ids.get(11));
    e.legs.set('c00002', new Map([[1, { hex: 'c00002', type: 'FA7X', tStart: T - 9000, tEnd: T - 5000, ended: true, open: false, to: { id: ltn.id, code: 'LTN', conf: 'ground' } }]]));
    const I2 = createIdent(e); I2.observe([fl(12, { lat: ltn.lat + 0.005, lon: ltn.lon, alt: 0, gnd: true, spd: 0, type: 'FA7X' })], MS, 'scan'); I2.match(MS);
    check('... two such: none', !I2.ids.has(12)); }
  // a browser's own name; lookups
  { const e = env(); e.ac.set('d00001', { meta: { reg: 'N77', type: 'C68A' }, rows: [] });
    const I = createIdent(e); I.observe([fl(13, { lat: 40, lon: -100 })], MS, 'client');
    check('ident: a browser\'s own name taken (where this side has none)', I.clientId(13, 'd00001', 'heatmap', MS) && I.ids.get(13).how === 'client:heatmap' && I.ids.get(13).reg === 'N77');
    check('... but never over another flight\'s aircraft, nor a bad address', !I.clientId(14, 'd00001', 'x', MS) && !I.clientId(13, 'zzz', 'x', MS));
    I.observe([fl(15, { lat: 35, lon: -90 }), fl(16, { lat: 35.5, lon: -90.5 }), fl(17, { lat: 10, lon: 10 })], MS, 'scan');
    const un = I.match(MS), areas = I.lookupAreas(un, MS);
    check('lookups: unnamed flights within coverage grouped by area (two near each other: one lookup)', areas.length === 2 && areas.some(a => a.ids.length === 2), areas.map(a => a.ids));
    I.addLookup([{ hex: 'e00001', lat: 35.01, lon: -90, alt_baro: 30000, gs: 420, track: 90, seen_pos: 1, t: 'GLF6', r: 'N9' }], T);
    I.match(MS);
    check('... a lookup\'s aircraft names the flight', I.ids.get(15) && I.ids.get(15).hex === 'e00001' && I.ids.get(15).how === 'lookup', I.ids.get(15));
    const d = JSON.parse(JSON.stringify(I.dump())), I3 = createIdent(e); const n = I3.restore(d, MS + 60000);
    check('kept on disk and read back: the names and their flights', n === I.ids.size && I3.ids.get(15).hex === 'e00001' && I3.byHex.get('e00001') === 15, { n, size: I.ids.size }); }

  // ================= dest.cjs =================
  { const { e, I, now, j } = dclub, D = createDest({ E, ac: e.ac, legs: e.legs });
    // (D-CLUB's earlier flights: its 1 Oct days if any - here none; its open flight from the recorded track)
    const R = I.ids.get(10), F = I.flights.get(10), r = D.predictFor(R, F, now);
    const svq = E.byIcao('LEZL'), tln = E.byIcao('LFTH');
    check('dest: a rough destination for D-CLUB half way from Seville (recorded track, then FR24\'s): an airport, a chance, where it took off', !!r && !!r.dest && E.byId(r.dest.id) && r.dest.p > 0 && r.dest.p <= 0.99 && !!r.origin && r.origin.id === svq.id, r && { dest: r.dest && code(r.dest.id), p: r.dest && r.dest.p, origin: r.origin && code(r.origin.id) });
    console.log('      (D-CLUB really landed at Toulon: the rough destination says ' + (r && r.dest ? code(r.dest.id) + ' ' + Math.round(r.dest.p * 100) + '%' : '-') + ')');
    void tln; void j;
    const n = D.round(I, now * 1000);
    check('... a round gives every named airborne flight one, marked changed for the browsers', n === 1 && R.dest && R.chg >= now * 1000 - 1, { n, dest: R.dest }); }

  // ================= the monitor: /fr24ids, POST /report =================
  { const srv = M.serve ? M.serve() : null;
    if (!srv) { check('monitor serve exported', false); } else {
      await new Promise(r => setTimeout(r, 300));
      const req = (method, p, body, tok) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port: +process.env.MON_PORT, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok === false ? {} : { 'X-Monitor-Token': 'test-secret' }) }, x => { let s = ''; x.on('data', c => { s += c; }); x.on('end', () => res({ status: x.statusCode, body: s })); }); r.on('error', rej); if (body) r.write(body); r.end(); });
      M.live.set('f00001', liveRow('f00001', { lat: 47, lon: 8, _t: Math.round(Date.now() / 1000) - 3, r: 'HB-JXX', t: 'GL7T' }));
      const nowS = Math.round(Date.now() / 1000);
      const rep = { hdr: { 'fr24-device-id': 'web-abc', 'fr24-platform': 'web-26', authorization: 'Bearer NOPE' }, ua: 'Mozilla/5.0 Chrome/140', flights: [[777001, 47.001, 8.0, 30000, 90, 420, nowS, 0, 0, 'GL7T', '', 3], [777002, 40, -70, 41000, 60, 480, nowS, 0, 5, 'GLF5', '', 3]], ids: [[777002, 'abcdef', 'heatmap']] };
      const r1 = await req('POST', '/report', JSON.stringify(rep));
      const j1 = JSON.parse(r1.body || '{}');
      check('POST /report: a browser\'s headers, its flights and its own names accepted', r1.status === 200 && j1.hdr === true && j1.flights === 2 && j1.named === 1 && M.fr24.st.hdr['fr24-device-id'] === 'web-abc' && !('authorization' in M.fr24.st.hdr), j1);
      const r401 = await req('POST', '/report', '{}', false);
      check('... without the secret: 401', r401.status === 401);
      const rbad = await req('POST', '/report', '{not json');
      check('... a broken body: 400', rbad.status === 400);
      await M.identRound();
      const r2 = await req('GET', '/fr24ids'), j2 = JSON.parse(r2.body);
      const row = id => j2.rows.find(x => x[0] === id);
      check('GET /fr24ids: every name - the reported flight named from live ADS-B, the browser\'s own name too', r2.status === 200 && j2.full === true && row(777001) && row(777001)[1] === 'f00001' && row(777002) && row(777002)[6] === 'client:heatmap', j2.rows.map(x => x.slice(0, 7)));
      const r3 = await req('GET', '/fr24ids?since=' + j2.now), j3 = JSON.parse(r3.body);
      check('... with since: only what changed (nothing)', j3.full === false && j3.rows.length === 0, j3);
      const st = JSON.parse((await req('GET', '/status')).body);
      check('/status: FR24 scanning, the names, how they were made', st.fr24 && st.fr24.headersFrom === 'browser' && st.fr24.named >= 2 && st.fr24.matched.list >= 1, st.fr24);
      M.saveIdent();
      const disk = JSON.parse(fs.readFileSync(path.join(process.env.MON_STORE, 'ident.json'), 'utf8'));
      check('the names kept on disk (ident.json)', disk.v === 1 && disk.ids.some(r => r[0] === 777001));
      srv.close();
    } }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
