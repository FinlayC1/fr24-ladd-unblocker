// The public monitor - every copy of the script connected by default - over real HTTP:
//   - read without the secret; the dashboard's numbers, and the places browsers looked at, only with it; each address
//     held to its rate (the owner never);
//   - from anyone's browser: FR24's headers not taken while the monitor's own scan works; a flight's position never over
//     the scan's; a name taken when this side can check it (and refused when its own positions contradict it) or when two
//     different browsers give the same one; an owner when two browsers send the same findings;
//   - owners: a company named to everyone, a private person's name (and city) only to the owner - in /owners and in the
//     names table every browser gets;
//   - /near: every aircraft heard around a point, one adsb.fi lookup of the area at most a minute;
//   - the names archive: every name given kept on disk by day, served to a playback (a day weeks old read from its file),
//     a withdrawn one not;
//   - /export/legs: a day's flights, under the ODbL;
//   - a private monitor (MON_PUBLIC=0): nothing without the secret.
// usage: node test/unit_public.cjs [dataDir]
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawn } = require('child_process');
process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
const STORE = process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monpub-'));
process.env.MON_PORT = String(42000 + Math.floor(Math.random() * 6000));
process.env.MON_TOKEN = 'owner-secret';
process.env.MON_RATE = '40';
delete process.env.MON_PUBLIC;
// (adsb.fi's area answers, made up here: counted)
let fiAsked = 0, wxAsked = 0;
global.fetch = async url => {
  if (/opendata\.adsb\.fi\/api\/v3\/lat\//.test(url)) { fiAsked++; return { status: 200, text: async () => JSON.stringify({ now: Date.now(), aircraft: [{ hex: '4ca9e1', r: 'EI-NEAR', t: 'C56X', lat: 53.5, lon: -6.3, alt_baro: 5000, gs: 200, track: 270, seen_pos: 1 }, { hex: '424b5e', r: 'M-HERI', t: 'GLF5', dbFlags: 8, lat: 50.12, lon: 0.70, alt_baro: 31500, alt_geom: 32150, gs: 504, track: 150.6, baro_rate: -64, squawk: '4521', ias: 281, tas: 452, mach: 0.784, oat: -47, wd: 268, ws: 61, nav_altitude_mcp: 31008, seen_pos: 0 }] }) }; }
  // (Open-Meteo's GFS, made up: a 100 kt westerly at every level, the standard atmosphere's temperatures)
  if (/api\.open-meteo\.com\/v1\/gfs/.test(url)) {
    wxAsked++; const q = new URL(url), n = q.searchParams.get('latitude').split(',').length, t0 = Math.floor(Date.now() / 3600e3) * 3600, time = Array.from({ length: 48 }, (_, i) => t0 - 3600 + i * 3600), h = { time };
    for (const [p, T] of [[850, 5], [700, -5], [600, -12], [500, -21], [400, -32], [300, -45], [250, -52], [200, -56.5], [150, -56.5]]) { h[`temperature_${p}hPa`] = time.map(() => T); h[`wind_speed_${p}hPa`] = time.map(() => 100); h[`wind_direction_${p}hPa`] = time.map(() => 270); }
    const one = { latitude: 0, longitude: 0, hourly: h };
    return { status: 200, text: async () => JSON.stringify(n > 1 ? Array.from({ length: n }, () => one) : one) };
  }
  return { status: 404, text: async () => '' };
};
const M = require('../monitor/monitor.cjs');
M.loadEngine();
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const port = +process.env.MON_PORT;
const req = (method, p, o) => new Promise((res, rej) => {
  o = o || {};
  const headers = Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': o.ip || '203.0.113.1' }, o.token ? { 'X-Monitor-Token': o.token } : {});
  const r = http.request({ host: '127.0.0.1', port: o.port || port, path: p, method, headers }, x => { let s = ''; x.on('data', c => { s += c; }); x.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) { /* not json */ } res({ status: x.statusCode, body: j }); }); });
  r.on('error', rej); if (o.body) r.write(JSON.stringify(o.body)); r.end();
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = M.serve(); await sleep(200);
  const owner = { token: 'owner-secret' };
  // ---- reading, and what is the owner's
  const st = await req('GET', '/status'), stO = await req('GET', '/status', owner);
  check('public by default: /status answers without the secret - but not the places browsers looked at (the owner sees them)', M.PUBLIC === true && st.status === 200 && st.body.public === true && !('areas' in st.body) && Array.isArray(stO.body.areas), { status: st.status });
  const s1 = await req('GET', '/stats'), s2 = await req('GET', '/stats', owner);
  check('... the dashboard\'s numbers (client addresses among them): only with the secret', s1.status === 401 && s2.status === 200);
  const l1 = await req('GET', '/live?since=0'), f1 = await req('GET', '/fr24ids');
  check('... the live list and the names table: open to every copy of the script', l1.status === 200 && Array.isArray(l1.body.ac) && f1.status === 200 && Array.isArray(f1.body.rows));
  const a1 = await req('GET', '/area?lat=50&lon=1');
  check('... /area from anyone: taken, without the list of everyone\'s places', a1.status === 200 && !('areas' in a1.body));
  // (what one stranger's address may add to the monitor's own work: a few places an hour, a few hundred aircraft)
  { const ip = '198.51.100.20', got = [];
    for (const [la, lo] of [[10, 10], [20, 20], [30, 30], [40, 40], [-10, -10]]) got.push((await req('GET', `/area?lat=${la}&lon=${lo}`, { ip })).body.added);
    const own = await req('GET', '/area?lat=-20&lon=-20', Object.assign({ ip }, owner));
    check('... one address adds at most 4 places an hour (the 5th answered, not taken); the owner always', got.join() === 'true,true,true,true,false' && own.body.added === true, got);
    const hx = n => Array.from({ length: n }, (_, i) => 'e' + (i + 0x10000).toString(16).slice(-5)).join(',');
    const s1 = await req('GET', '/seed?hex=' + hx(250), { ip: '198.51.100.21' }), s2 = await req('GET', '/seed?hex=' + hx(450), { ip: '198.51.100.21' });
    const s3 = await req('GET', '/seed?hex=' + hx(450), { ip: '198.51.100.22' });
    check('... and at most 300 aircraft not yet followed an hour (those it follows already cost nothing)', s1.body.queued === 250 && s2.body.queued === 50 && s3.body.queued === 150 && M.blocked.size >= 450, [s1.body.queued, s2.body.queued, s3.body.queued]); }
  // ---- rate per address
  // (the rate is counted per calendar minute: 45 requests across a minute's turn would be counted in two)
  { const intoMin = Date.now() % 60000; if (intoMin > 50000) await new Promise(r => setTimeout(r, 60500 - intoMin));
    let n429 = 0; for (let i = 0; i < 45; i++) { const r = await req('GET', '/status', { ip: '198.51.100.7' }); if (r.status === 429) n429++; }
    const other = await req('GET', '/status', { ip: '198.51.100.8' }), own = await req('GET', '/status', Object.assign({ ip: '198.51.100.7' }, owner));
    check('an address over its rate (40 a minute here): 429, other addresses and the owner unaffected', n429 >= 4 && other.status === 200 && own.status === 200, { n429 }); }
  // ---- reports from anyone
  { const fr = M.fr24, nowMs = Date.now();
    fr.setHeaders({ 'fr24-device-id': 'web-owner', 'fr24-platform': 'web-1' }); fr.st.lastOkAt = nowMs;
    await req('POST', '/report', { ip: '192.0.2.10', body: { hdr: { 'fr24-device-id': 'web-stranger', 'fr24-platform': 'web-9' } } });
    check('a stranger\'s FR24 headers: not taken while the monitor\'s own scan works', fr.st.hdr['fr24-device-id'] === 'web-owner', fr.st.hdr);
    fr.st.lastOkAt = 0;
    await req('POST', '/report', { ip: '192.0.2.10', body: { hdr: { 'fr24-device-id': 'web-stranger', 'fr24-platform': 'web-9', evil: '\u0000x' } } });
    check('... taken while it does not (only printable, header-like values)', fr.st.hdr['fr24-device-id'] === 'web-stranger' && !('evil' in fr.st.hdr), fr.st.hdr); }
  { const I = M.ident, nowMs = Date.now(), nS = Math.round(nowMs / 1000);
    I.observe([{ id: 777001, lat: 50.2, lon: 0.6, alt: 31000, trk: 150, spd: 500, ts: nS, gnd: false, src: 0, type: 'GLF5', reg: '', cs: '', icon: 3 }], nowMs, 'scan');
    await req('POST', '/report', { ip: '192.0.2.20', body: { flights: [[777001, 10, 10, 1000, 0, 100, nS + 5, 0, 0, 'C172', '', 1]] } });
    check('a stranger\'s position for a flight the scan has: not taken over the scan\'s', Math.abs(I.flights.get(777001).lat - 50.2) < 1e-6);
    // (an aircraft this side has heard nowhere: needs two browsers)
    I.observe([{ id: 777002, lat: 40, lon: -30, alt: 41000, trk: 90, spd: 480, ts: nS, gnd: false, src: 5, type: 'GLF6', reg: '', cs: '', icon: 3 }], nowMs, 'scan');
    await req('POST', '/report', { ip: '192.0.2.21', body: { ids: [[777002, 'a0c0e0', 'trail']] } });
    const one = I.ids.get(777002);
    await req('POST', '/report', { ip: '192.0.2.21', body: { ids: [[777002, 'a0c0e0', 'trail']] } });
    const sameTwice = I.ids.get(777002);
    await req('POST', '/report', { ip: '192.0.2.22', body: { ids: [[777002, 'a0c0e0', 'heatmap']] } });
    const two = I.ids.get(777002);
    check('a name from one browser, for an aircraft this side cannot check: held; the same browser again: still held; a second browser agreeing: taken', !one && !sameTwice && !!two && two.hex === 'a0c0e0' && /^client/.test(two.how), two && two.how);
    // (one this side has heard elsewhere: refused at once)
    M.ingest({ hex: 'a0c0e1', r: 'N1FAR', t: 'GLF6', lat: 35, lon: -100, alt_baro: 41000, gs: 480, track: 90, seen_pos: 0 }, nS); M.markBlocked('a0c0e1', null, nS);
    M.ingest({ hex: 'a0c0e1', r: 'N1FAR', t: 'GLF6', lat: 35, lon: -100, alt_baro: 41000, gs: 480, track: 90, seen_pos: 0 }, nS);
    I.observe([{ id: 777003, lat: 41, lon: -31, alt: 41000, trk: 90, spd: 480, ts: nS, gnd: false, src: 5, type: 'GLF6', reg: '', cs: '', icon: 3 }], nowMs, 'scan');
    for (const ip of ['192.0.2.31', '192.0.2.32', '192.0.2.33']) await req('POST', '/report', { ip, body: { ids: [[777003, 'a0c0e1', 'x']] } });
    check('... a name this side\'s own positions contradict (heard over Texas, the flight over the Atlantic): refused, however many browsers send it', !I.ids.get(777003));
    // (one it heard right there: taken from a single browser)
    M.ingest({ hex: 'a0c0e2', r: 'N2NEAR', t: 'GLF6', lat: 42.001, lon: -32.001, alt_baro: 41000, gs: 480, track: 90, seen_pos: 0 }, nS); M.markBlocked('a0c0e2', null, nS);
    M.ingest({ hex: 'a0c0e2', r: 'N2NEAR', t: 'GLF6', lat: 42.001, lon: -32.001, alt_baro: 41000, gs: 480, track: 90, seen_pos: 0 }, nS);
    I.observe([{ id: 777004, lat: 42, lon: -32, alt: 41000, trk: 90, spd: 480, ts: nS, gnd: false, src: 0, type: 'GLF6', reg: '', cs: '', icon: 3 }], nowMs, 'scan');
    await req('POST', '/report', { ip: '192.0.2.41', body: { ids: [[777004, 'a0c0e2', 'x']] } });
    check('... a name it can check (heard right there, at that height): taken from one browser', !!I.ids.get(777004) && I.ids.get(777004).hex === 'a0c0e2');
    check('... the owner\'s own browser (the secret): taken as before', await req('POST', '/report', Object.assign({ body: { ids: [] } }, owner)).then(r => r.status === 200)); }
  // ---- owners
  { const O = M.owners, hexA = '4ca001', hexB = '4ca002';
    await req('POST', '/report', { ip: '192.0.2.51', body: { owners: [[hexA, { owner: 'Northwind Aviation Ltd', regOwner: true, regAnswered: true }]] } });
    const held = !O.db.has(hexA);
    await req('POST', '/report', { ip: '192.0.2.52', body: { owners: [[hexA, { owner: 'Someone Else Ltd', regOwner: true, regAnswered: true }]] } });
    const differ = !O.db.has(hexA);
    await req('POST', '/report', { ip: '192.0.2.53', body: { owners: [[hexA, { owner: 'Northwind Aviation Ltd', regOwner: true, regAnswered: true }]] } });
    check('an owner from one browser: held; another browser saying otherwise: still held; a second browser agreeing: taken', held && differ && O.db.get(hexA) && O.db.get(hexA).owner === 'Northwind Aviation Ltd');
    O.fromClient([[hexB, { owner: 'JOHN Q CITIZEN', ownerCity: 'SMALLTOWN, KANSAS', regOwner: true, regAnswered: true }]]);
    const pubRows = (await req('GET', `/owners?hex=${hexA},${hexB}`)).body.list, ownRows = (await req('GET', `/owners?hex=${hexA},${hexB}`, owner)).body.list;
    const pa = pubRows.find(r => r[0] === hexA), pb = pubRows.find(r => r[0] === hexB), ob = ownRows.find(r => r[0] === hexB);
    check('/owners to anyone: a company named; a private person\'s name and city withheld (marked so the browser asks the register itself); the owner sees both', pa[4] === 'Northwind Aviation Ltd' && pa[15] === 0 && pb[4] === '' && pb[5] === '' && pb[15] === 1 && ob[4] === 'JOHN Q CITIZEN' && ob[5] === 'SMALLTOWN, KANSAS', { pb, ob });
    check('... the names table every browser gets: the same (a person\'s name never in it)', O.short(hexB).owner === '' && O.short(hexA).owner === 'Northwind Aviation Ltd'); }
  // ---- /near
  { fiAsked = 0;
    const n1 = await req('GET', '/near?lat=50.15&lon=0.68&r=60'), n2 = await req('GET', '/near?lat=50.2&lon=0.6&r=60');
    const heri = n1.body.ac.find(a => a.hex === '424b5e');
    check('/near: M-HERI over the Channel found by the monitor\'s own lookup of the area (LADD flag, type, position), the next ask within the minute from what it has', !!heri && heri.dbFlags === 8 && heri.t === 'GLF5' && heri.seen_pos <= 120 && n1.body.looked === true && n2.body.looked === false && fiAsked === 1 && n2.body.ac.some(a => a.hex === '424b5e'), { fiAsked, n: n1.body.ac.length });
    const far = await req('GET', '/near?lat=-33&lon=151&r=50');
    check('... somewhere else: its own lookup (and nothing from the Channel)', far.status === 200 && !far.body.ac.some(a => a.hex === '424b5e') && fiAsked === 2);
    check('/near: with the figures FR24 padlocks (vertical speed, squawk, GPS altitude, airspeeds, Mach, wind, temperature, selected altitude)', !!heri && heri.baro_rate === -64 && heri.squawk === '4521' && heri.alt_geom === 32150 && heri.ias === 281 && heri.tas === 452 && heri.mach === 0.784 && heri.oat === -47 && heri.wd === 268 && heri.ws === 61 && heri.nav_altitude_mcp === 31008, heri); }
  // ---- /tel: an aircraft just clicked, by address
  { const before = fiAsked;
    const t1 = await req('GET', '/tel?hex=424b5e,4ca9e1,zzzzzz');
    check('/tel: the newest report of each address asked (any aircraft - an ordinary one too), junk ignored', t1.status === 200 && t1.body.ac.length === 2 && t1.body.ac.some(a => a.hex === '424b5e' && a.ias === 281 && a.squawk === '4521') && t1.body.ac.some(a => a.hex === '4ca9e1' && a.r === 'EI-NEAR') && fiAsked === before, t1.body);
    const t2 = await req('GET', '/tel?hex=4ca9ff&lat=40.4&lon=-3.6');
    check('... one it has nothing fresh of, with where FR24 draws it: looked up there first (one lookup, the shared budget)', t2.status === 200 && Array.isArray(t2.body.ac) && fiAsked === before + 1, { fiAsked: fiAsked - before, n: t2.body.ac.length });
    const t3 = await req('GET', '/tel?hex=4ca9ff&lat=40.4&lon=-3.6');
    check('... asked again within the minute: not looked up again', t3.status === 200 && fiAsked === before + 1);
    check('/status: the store of reports counted', (await req('GET', '/status')).body.tel.aircraft >= 2); }
  // ---- the names archive
  { const N = M.names, nS = Math.round(Date.now() / 1000), I = M.ident;
    const two = I.ids.get(777002);
    const got = await req('GET', '/names?ids=777002,777004,999&t=' + nS);
    check('the names archive: every name given served to a playback (one request for many flights; unknown ones not listed)', got.body.list.length === 2 && got.body.list.some(r => r[0] === 777002 && r[1] === 'a0c0e0') && got.body.list.some(r => r[0] === 777004 && r[1] === 'a0c0e2') && !!two);
    I.unassign(777004, Date.now(), 'diverged');
    const after = await req('GET', '/names?ids=777004&t=' + nS);
    check('... a name withdrawn (the aircraft turned out elsewhere): no longer served', after.body.list.length === 0);
    const day20 = new Date((nS - 20 * 86400) * 1000).toISOString().slice(0, 10);
    fs.mkdirSync(path.join(STORE, 'names'), { recursive: true });
    fs.writeFileSync(path.join(STORE, 'names', day20 + '.jsonl'), JSON.stringify([555001, '400abc', 'G-OLDN', 'C25A', 'OLDN1', 1, nS - 20 * 86400]) + '\n');
    const old = await req('GET', '/names?ids=555001&t=' + (nS - 20 * 86400 + 600));
    check('... a playback of a day three weeks ago: read from that day\'s file', old.body.list.length === 1 && old.body.list[0][2] === 'G-OLDN');
    const { createNames } = require('../monitor/names.cjs'), N2 = createNames({ store: STORE });
    check('... kept on disk: a restart has the last two weeks again (and the withdrawn one stays withdrawn)', N2.load(nS) >= 2 && N2.get([777002], nS).length === 1 && N2.get([777004], nS).length === 0, N2.size); }
  // ---- /export/legs
  { const d = new Date().toISOString().slice(0, 10); fs.writeFileSync(path.join(STORE, 'legs-' + d + '.json'), JSON.stringify([{ hex: 'abcdef', ladd: true, tStart: 1 }]));
    const ex = await req('GET', '/export/legs?day=' + d), bad = await req('GET', '/export/legs?day=../../etc');
    check('/export/legs: a day\'s flights, offered under the ODbL; anything but a day refused', ex.status === 200 && ex.body.legs.length === 1 && /ODbL/.test(ex.body.licence) && bad.status === 404); }
  // ---- what browsers found, shared: their own polls' reports (telemetry), the names they found in playback
  { const nS = Math.round(Date.now() / 1000), row = (hex, lat, lon, o) => Object.assign([hex, lat, lon, 12000, 250, 90, 1500, '1234', 12300, 240, 300, 0.5, -10, 270, 30, nS - 5, 'G-CRWD', 'C25A', 'CRWD1', 0], o || {});
    const r1 = await req('POST', '/report', { ip: '192.0.2.61', body: { tel: [row('4cc001', 52.1, -1.2), row('4cc002', 91, 0), row('4cc003', 52, -1, { 15: nS - 900 }), row('zzz', 52, -1)] } });
    const t1 = await req('GET', '/tel?hex=4cc001');
    check('a browser\'s own poll, reported: served to every browser at once (with its figures); impossible or stale rows refused', r1.body.tel === 1 && t1.body.ac.length === 1 && t1.body.ac[0].baro_rate === 1500 && t1.body.ac[0].squawk === '1234' && t1.body.ac[0].ias === 240 && t1.body.ac[0].r === 'G-CRWD', { r: r1.body, t: t1.body.ac[0] });
    // (never over this side's own report of the last minute; never far from where this side last heard it)
    const own = M.tel.get(['424b5e'], nS)[0];
    await req('POST', '/report', { ip: '192.0.2.62', body: { tel: [row('424b5e', own.lat + 0.01, own.lon, { 15: nS + 2, 6: 9999 })] } });
    check('... never over the monitor\'s own report of the last minute', M.tel.get(['424b5e'], nS + 3)[0].baro_rate === own.baro_rate);
    check('... (and the monitor\'s own report of an aircraft still wins over a browser\'s afterwards)', (() => { M.tel.add([{ hex: '4cc001', lat: 52.2, lon: -1.1, alt_baro: 12500, gs: 250, track: 90, baro_rate: 0, seen_pos: 0 }], nS + 1); return M.tel.get(['4cc001'], nS + 1)[0].baro_rate === 0; })());
    const st = (await req('GET', '/status')).body.tel;
    check('/status: reports from browsers and those refused counted', st.fromBrowsers >= 1 && st.refused >= 3, st); }
  { const nS = Math.round(Date.now() / 1000), hexL = '4cd001', t0 = nS - 30 * 86400;
    // (this side's own log has the aircraft in the air then: one browser is enough)
    const m = new Map(); m.set(1, { hex: hexL, reg: 'G-LOGD', type: 'C56X', from: null, to: null, tStart: t0, tOff: t0 + 60, tOn: t0 + 3600, tEnd: t0 + 3700, ended: true }); M.legs.set(hexL, m);
    const a = await req('POST', '/report', { ip: '192.0.2.71', body: { pbIds: [[880001, hexL, 'G-LOGD', 'C56X', 'LOGD1', 1, t0 + 1800]] } });
    const g1 = await req('GET', '/names?ids=880001&t=' + (t0 + 1800));
    check('a name found in a playback a month back, the aircraft in the air then by this side\'s own log: kept for good, with that day', a.body.pbNamed === 1 && g1.body.list.length === 1 && g1.body.list[0][1] === hexL && fs.existsSync(path.join(STORE, 'names', new Date((t0 + 1800) * 1000).toISOString().slice(0, 10) + '.jsonl')), g1.body);
    // (nothing of it here: two browsers needed)
    const b1 = await req('POST', '/report', { ip: '192.0.2.72', body: { pbIds: [[880002, '4cd002', 'G-NEWW', 'PA28', '', 0, t0 + 1800]] } });
    const held = (await req('GET', '/names?ids=880002&t=' + (t0 + 1800))).body.list.length;
    const b2 = await req('POST', '/report', { ip: '192.0.2.73', body: { pbIds: [[880002, '4cd002', 'G-NEWW', 'PA28', '', 0, t0 + 1800]] } });
    const taken = (await req('GET', '/names?ids=880002&t=' + (t0 + 1800))).body.list.length;
    check('... one this side cannot check: held from one browser, taken when a second agrees', b1.body.pbNamed === 0 && held === 0 && b2.body.pbNamed === 1 && taken === 1);
    // (a flight the monitor named otherwise - live, itself: a browser's playback name never replaces it)
    M.names.add(880005, { hex: '4cd005', reg: 'G-OWNN', type: 'C56X', cs: '', flags: 1 }, t0 + 1800);
    const m5 = new Map(); m5.set(1, { hex: '4cd006', tStart: t0, tOff: t0 + 60, tOn: t0 + 3600, tEnd: t0 + 3700, ended: true }); M.legs.set('4cd006', m5);
    const c1 = await req('POST', '/report', { ip: '192.0.2.75', body: { pbIds: [[880005, '4cd006', 'G-OTHR', 'C56X', '', 0, t0 + 1800]] } });
    const kept = (await req('GET', '/names?ids=880005&t=' + (t0 + 1800))).body.list[0];
    check('... a flight already named otherwise: a browser\'s playback name does not replace it', c1.body.pbNamed === 0 && kept && kept[1] === '4cd005', kept);
    M.legs.delete('4cd006');
    const bad = await req('POST', '/report', { ip: '192.0.2.74', body: { pbIds: [[0, hexL, '', '', '', 0, t0], [880003, 'nothex', '', '', '', 0, t0], [880004, hexL, '', '', '', 0, nS + 86400]] } });
    check('... nonsense refused (no flight id, no address, a moment in the future)', bad.body.pbNamed === 0);
    M.legs.delete(hexL); }
  // ---- what public ADS-B lacks over the US: airspeeds, Mach, wind and temperature from the weather model
  { const nS = Date.now() / 1000;
    M.tel.add([{ hex: '407c02', flight: 'JCO55', r: 'G-VTLY', t: 'GLEX', lat: 44.04, lon: -98.04, alt_baro: 41000, alt_geom: 42575, gs: 595.6, track: 57.27, geom_rate: -64, squawk: '2027', seen_pos: 1 },
      { hex: '4ca0e5', lat: 53.4, lon: -6.2, alt_baro: 37000, gs: 450, track: 90, ias: 260, tas: 455, mach: 0.79, oat: -50, wd: 250, ws: 40, seen_pos: 1 },
      { hex: '4ca0e6', lat: 53.4, lon: -6.3, alt_baro: 2500, gs: 140, track: 280, seen_pos: 1 }], nS);
    const before = (await req('GET', '/tel?hex=407c02')).body.ac[0];
    check('an aircraft over the US with no airspeeds from any receiver: its weather cell asked for, nothing made up meanwhile', !('tas' in before) && M.wx.want.size >= 1 && before.gs === 595.6, before);
    const got = await M.wx.pump(Date.now());
    const a = (await req('GET', '/tel?hex=407c02,4ca0e5,4ca0e6')).body.ac, us = a.find(r => r.hex === '407c02'), eu = a.find(r => r.hex === '4ca0e5'), low = a.find(r => r.hex === '4ca0e6');
    // (ground 595.6 kt on 057, wind 100 kt from 270: through the air 514 kt; -56.5 C at FL410: Mach 0.896)
    check('... once the model is in: true airspeed (ground speed less the wind), Mach, indicated airspeed, wind and temperature, marked estimated', got >= 1 && wxAsked === 1 && Math.abs(us.tas - 514) <= 2 && Math.abs(us.mach - 0.896) <= 0.004 && us.ias > 230 && us.ias < 280 && us.oat === -56 && us.wd === 270 && us.ws === 100 && us.wx === 1, us);
    check('... an aircraft\'s own figures (Europe) never replaced; nothing worked out low down', eu.tas === 455 && eu.ias === 260 && !eu.wx && !('tas' in low), { eu, low });
    check('/status: the weather cells and the figures worked out counted', (await req('GET', '/status')).body.wx.cells >= 1 && M.wx.stats.estimated >= 1); }
  // ---- the boards: no "flight" back where it took off that never flew (a taxi with the transponder saying "airborne")
  { const lpl = M.E.byIcao('EGGP'), blk = M.E.byIcao('EGNH'), t = Math.round(Date.now() / 1000) - 7200, put = (hex, type, legs) => { const m = new Map(); for (const l of legs) m.set(Math.round(l.tStart / 600), Object.assign({ hex, type, reg: '', cs: '', ended: true, open: false }, l)); M.legs.set(hex, m); };
    put('4ca7b1', 'B738', [{ from: { id: lpl.id, conf: 'ground' }, to: { id: lpl.id, conf: 'ground' }, tStart: t, tOff: t + 60, tOn: t + 200, tEnd: t + 260, maxAlt: 300, pathKm: 3 }]);
    put('400f01', 'C172', [{ from: { id: blk.id, conf: 'ground' }, to: { id: lpl.id, conf: 'ground' }, tStart: t, tOff: t + 60, tOn: t + 1800, tEnd: t + 1900, maxAlt: 2000, pathKm: 45 }]);
    put('400f02', 'PA38', [{ from: { id: lpl.id, conf: 'ground' }, to: { id: lpl.id, conf: 'ground' }, tStart: t, tOff: t + 60, tOn: t + 2400, tEnd: t + 2500, maxAlt: 1200, pathKm: 40, laps: 4 }]);
    const b = M.boardLegs(lpl.id, t - 3600, t + 7200), hexes = b.map(x => x.hex).sort();
    check('the monitor\'s board of an airport: a jet\'s same-field "flight" of two minutes left out; an arrival and real circuits kept', !hexes.includes('4ca7b1') && hexes.includes('400f01') && hexes.includes('400f02'), hexes);
    for (const h of ['4ca7b1', '400f01', '400f02']) M.legs.delete(h); }
  srv.close();
  // ---- a private monitor
  { const port2 = port + 1, env = Object.assign({}, process.env, { MON_PUBLIC: '0', MON_PORT: String(port2), MON_STORE: fs.mkdtempSync(path.join(os.tmpdir(), 'monpriv-')) });
    const child = spawn(process.execPath, [path.join(__dirname, '../monitor/monitor.cjs')], { env, stdio: 'ignore' });
    let ok = null; for (let i = 0; i < 60 && !ok; i++) { await sleep(250); try { ok = await req('GET', '/status', Object.assign({ port: port2 }, owner)); } catch (e) { ok = null; } }
    const anon = await req('GET', '/live', { port: port2 }).catch(() => ({ status: 0 }));
    check('a private monitor (MON_PUBLIC=0): nothing without the secret, everything with it', !!ok && ok.status === 200 && ok.body.public === false && anon.status === 401, { owner: ok && ok.status, anon: anon.status });
    child.kill('SIGTERM'); await sleep(300); }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
