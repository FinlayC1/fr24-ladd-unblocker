// 1.3.8 - the OpenSky Network as a registered user (the owner's API client), offline, against a stand-in for OpenSky:
//   - its client (monitor/opensky.cjs): a token by the client-credentials grant, asked for once and kept until it runs out,
//     asked again on a 401; the id and secret only ever in the token request's body - never in an address, an error, the
//     status; each kind's credits read off the answers, a kind out of them (429) left alone, the others not
//   - the monitor's poll: OpenSky's whole-world view, the blocked aircraft in it into their tracks; its counts in /status,
//     no credential there
//   - the ends of flights not heard here, from OpenSky's flights of the day before: asked for once the night's work is
//     done, those with most to fill first, within the credits; taken only where OpenSky heard the aircraft close to the
//     airport, for the same flight, never over an end heard here; in the logs the monitor serves; kept across a restart
// usage: node test/unit_opensky.cjs [node_modules dir] [data dir]
const fs = require('fs'), path = require('path'), os = require('os');
const DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const ID = 'test-api-client', SECRET = 'S3cr3t-Of-The-Owner-0123456789';
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon139-'));
process.env.MON_OPENSKY_CLIENT_ID = ID; process.env.MON_OPENSKY_CLIENT_SECRET = SECRET;
const { createOpenSky, createOskyEnds, TOKEN_URL } = require('../monitor/opensky.cjs');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const hdrs = h => ({ get: k => (k.toLowerCase() in h ? String(h[k.toLowerCase()]) : null) });

// (OpenSky as a stand-in: its token address and its API)
function fakeOpenSky(opts) {
  const S = { asked: [], tokenBodies: [], tokens: 0, api: opts.api || (() => [404, null, {}]), tokenStatus: 200 };
  S.fetch = async (url, o) => {
    o = o || {};
    S.asked.push({ url, auth: (o.headers || {}).Authorization || '', method: o.method || 'GET' });
    if (url === TOKEN_URL) {
      S.tokenBodies.push(String(o.body || ''));
      if (S.tokenStatus !== 200) return { status: S.tokenStatus, headers: hdrs({}), json: async () => ({ error: 'invalid_client', error_description: 'client ' + ID + ' not allowed' }) };
      S.tokens++;
      return { status: 200, headers: hdrs({}), json: async () => ({ access_token: 'tok-' + S.tokens, expires_in: 1800, token_type: 'Bearer' }) };
    }
    const [st, body, h] = S.api(url, o);
    return { status: st, headers: hdrs(h || {}), text: async () => body == null ? '' : JSON.stringify(body) };
  };
  return S;
}

(async () => {
  // ---- 1. the client ---------------------------------------------------------------------------------------------------
  { const off = createOpenSky({ fetch: async () => { throw new Error('asked'); }, clientId: '', clientSecret: '' });
    check('no API client set: off, nothing asked', off.on === false && (await off.get('/states/all')) === null); }
  { let clock = 1_800_000_000_000; const now = () => clock;
    let tokNeeded = null;
    const S = fakeOpenSky({ api: (url, o) => {
      if (tokNeeded && o.headers.Authorization !== 'Bearer ' + tokNeeded) return [401, null, {}];
      if (/\/states\/all$/.test(url)) return [200, { time: 1, states: [] }, { 'x-rate-limit-remaining': 3996 }];
      if (/\/flights\/aircraft/.test(url)) return [429, null, { 'x-rate-limit-retry-after-seconds': 7200, 'x-rate-limit-remaining': 0 }];
      return [404, null, {}];
    } });
    const C = createOpenSky({ fetch: S.fetch, now, clientId: ID, clientSecret: SECRET });
    const a = await C.get('/states/all'), b = await C.get('/states/all');
    const tokReq = S.asked.filter(x => x.url === TOKEN_URL), body = new URLSearchParams(S.tokenBodies[0] || '');
    check('a token by the client-credentials grant - the id and secret in the request\'s body, nowhere else - asked for once for two requests, each request with it', a.status === 200 && b.status === 200 && tokReq.length === 1 && tokReq[0].method === 'POST' && body.get('grant_type') === 'client_credentials' && body.get('client_id') === ID && body.get('client_secret') === SECRET && S.asked.filter(x => /\/api\//.test(x.url)).every(x => x.auth === 'Bearer tok-1'), { tokReq: tokReq.length });
    check('... never in an address', !S.asked.some(x => x.url.includes(SECRET) || x.url.includes(ID)));
    check('... the credits left of that kind read off the answer', C.left('states') === 3996 && C.left('flights') === null);
    clock += 31 * 60000; await C.get('/states/all');
    check('... a token about to run out: a new one', S.asked.filter(x => x.url === TOKEN_URL).length === 2 && S.asked[S.asked.length - 1].auth === 'Bearer tok-2');
    tokNeeded = 'tok-3'; await C.get('/states/all');
    check('... refused (401) before its time: a new token, the request again - once', S.tokens === 3 && S.asked.slice(-3).map(x => x.url === TOKEN_URL ? 'T' : x.auth).join() === 'Bearer tok-2,T,Bearer tok-3');
    let err = ''; try { await C.get('/flights/aircraft?icao24=abcdef&begin=1&end=2'); } catch (e) { err = String(e.message); }
    const n0 = S.asked.length, st = await C.get('/flights/aircraft?icao24=abcdef&begin=1&end=2');
    check('a kind out of credits (429): left alone as long as OpenSky says (two hours) - nothing asked meanwhile; the other kinds still asked', /429/.test(err) && st === null && S.asked.length === n0 && C.stats.pausedTo.flights === clock + 7200000 && (await C.get('/states/all')).status === 200, { err });
    S.tokenStatus = 401; tokNeeded = 'never'; let e2 = '';
    try { await C.get('/states/all'); } catch (e) { e2 = String(e.message); }
    const shown = JSON.stringify(C.stats) + e2;
    check('a token refused (the id or secret wrong): said so, the secret (or a token) in no error and nowhere in its status', /token/.test(e2) && !shown.includes(SECRET) && !/tok-\d/.test(shown) && C.stats.tokenFails >= 1, { e2, stats: C.stats }); }

  // ---- 2. the monitor's poll: OpenSky's view, the blocked aircraft in it -----------------------------------------------
  { const T = Math.floor(Date.now() / 1000);
    const S = fakeOpenSky({ api: url => /\/states\/all$/.test(url) ? [200, { time: T, states: [['4ca9c1', 'EIN154  ', 'Ireland', T - 5, T - 4, -6.25, 53.42, 120, false, 70, 280, 6, null, 150, '2201', false, 0], ['abc123', 'X', 'Y', T, T, 1, 2, 3, false, 4, 5, 6, null, 7, null, false, 0]] }, { 'x-rate-limit-remaining': 3990 }] : [404, null, {}] });
    global.fetch = S.fetch;
    const M = require('../monitor/monitor.cjs');
    M.loadEngine();
    M.markBlocked('4ca9c1', { reg: 'EI-TST', type: 'C68A' }, T);
    const ok = await M.pollOpenSky(), x = M.ac.get('4ca9c1'), last = x && x.rows[x.rows.length - 1];
    check('the monitor with the owner\'s client: OpenSky\'s whole-world view asked as a registered user, a blocked aircraft in it taken into its track (its time, height in feet); one not blocked left out', ok === true && M.OS.on && S.asked.some(a => /\/states\/all$/.test(a.url) && /^Bearer tok-/.test(a.auth)) && last && last[0] === T - 5 && last[3] === 394 && !M.ac.get('abc123'), { last, asked: S.asked.map(a => a.url) });
    const st = M.answer(new URL('http://x/status'), T), txt = JSON.stringify(st);
    check('/status: OpenSky counted - polls, aircraft taken, credits left; no credential in it', st.opensky && st.opensky.on === true && st.opensky.polls === 1 && st.opensky.taken === 1 && st.opensky.left.states === 3990 && st.opensky.ends && !txt.includes(SECRET) && !/tok-\d/.test(txt), st.opensky);

    // ---- 3. the ends of flights not heard here, from OpenSky's flights of the day before -------------------------------
    const E = M.E, FAB = E.byIcao('EGLF'), BWF = E.byIcao('EGNL'), D = '2026-11-16', D0 = Date.parse(D + 'T00:00:00Z') / 1000;
    let clock = (D0 + 86400 + 5 * 3600) * 1000; const now = () => clock, fl = [];
    const F = fakeOpenSky({ api: url => { fl.push(url); return /icao24=424c60/.test(url) ? [200, [
      { icao24: '424c60', firstSeen: D0 + 57624, lastSeen: D0 + 60220, estDepartureAirport: 'EGNL', estArrivalAirport: 'EGLF', callsign: 'VSB96   ', estDepartureAirportHorizDistance: 1450, estDepartureAirportVertDistance: 96, estArrivalAirportHorizDistance: 880, estArrivalAirportVertDistance: 38 },
      { icao24: '424c60', firstSeen: D0 + 61819, lastSeen: D0 + 64777, estDepartureAirport: 'EGLF', estArrivalAirport: 'EGNL', callsign: 'VSB96', estDepartureAirportHorizDistance: 700, estDepartureAirportVertDistance: 20, estArrivalAirportHorizDistance: 9800, estArrivalAirportVertDistance: 900 }],
      { 'x-rate-limit-remaining': 3970 }] : [404, null, { 'x-rate-limit-remaining': 3940 }]; } });
    const C = createOpenSky({ fetch: F.fetch, now, clientId: ID, clientSecret: SECRET });
    const O = createOskyEnds({ os: C, now, byIcao: c => E.byIcao(c), perDay: 3 });
    O.want([{ hex: '400001', day: D, n: 1 }, { hex: '424c60', day: D, n: 3 }, { hex: '424c60', day: D, n: 3 }]);
    check('the days to ask for: once each, the one with most to fill first', O.queue.length === 2 && O.queue[0].hex === '424c60', O.queue);
    const r0 = await O.round();
    check('... not before OpenSky\'s night\'s work on the day is done (06:00 UTC the day after)', r0 === false && !fl.length);
    clock += 2 * 3600e3; await O.round();
    check('... then asked: that aircraft, the day and the night after (two days\' credits)', fl.length === 1 && fl[0].endsWith(`/flights/aircraft?icao24=424c60&begin=${D0}&end=${D0 + 30 * 3600}`) && O.days.get('424c60').get(D).length === 2, fl);
    // (its flights as heard here: in from Walney first heard at 3,850 ft, its end at Farnborough lost in the air - and out of
    // Farnborough, down at Walney)
    const legs = [
      { day: '2026/11/16', tStart: D0 + 57722, tEnd: D0 + 60100, from: null, to: null, startedOnGround: false, ended: false, how: 'open' },
      { day: '2026/11/16', tStart: D0 + 61819, tEnd: D0 + 64736, tOff: D0 + 61819, from: { id: FAB.id, code: 'FAB', conf: 'ground' }, to: null, startedOnGround: true, ended: true, how: 'open' }];
    const out = O.fill('424c60', legs);
    check('a flight first heard in the air, lost before it landed: OpenSky heard it leave Walney (1.5 km off, 96 m up) and come down at Farnborough (900 m off) - both ends, marked as OpenSky\'s, their times as estimates', out[0].from && out[0].from.id === BWF.id && out[0].from.conf === 'low' && out[0].from.src === 'osky' && out[0].to && out[0].to.id === FAB.id && out[0].tOff === D0 + 57624 && out[0].tOffEst === true && out[0].tOn === D0 + 60220, out[0]);
    check('... its end OpenSky heard nowhere near an airport (last heard 9.8 km out, 900 m up): left as it was; the end heard here at Farnborough not touched; the legs given not changed', out[1].to === null && out[1].from.conf === 'ground' && legs[0].from === null, out[1]);
    const other = O.fill('424c60', [{ tStart: D0 + 40000, tEnd: D0 + 43000, from: null, to: null }]), late = O.fill('424c60', [{ tStart: D0 + 57000, tEnd: D0 + 60100, from: null, to: null, startedOnGround: false }]);
    check('... never another flight\'s (no OpenSky flight over most of it); a take-off OpenSky heard only after this one was first heard here: not that end', other[0].from === null && other[0].to === null && late[0].from === null && late[0].to && late[0].to.id === FAB.id, { other: other[0], late: late[0] });
    const guessed = O.fill('424c60', [{ tStart: D0 + 57722, tEnd: D0 + 60100, from: { id: 1, code: 'XXX', conf: 'near' }, to: { id: 2, code: 'YYY', conf: 'chain' } }]);
    check('... an end only guessed here (near, from the next flight): OpenSky\'s, which heard it there, taken over it', guessed[0].from.id === BWF.id && guessed[0].to.id === FAB.id);
    // (the allowance)
    const asked0 = fl.length; O.want([{ hex: '400002', day: D, n: 1 }, { hex: '400003', day: D, n: 1 }, { hex: '400004', day: D, n: 1 }]);
    for (let i = 0; i < 6; i++) await O.round();
    check('... no more than the day\'s share (3 here, 120 on the server); none at all with fewer than 60 credits left', fl.length - asked0 === 2 && O.stats.used === 3, { n: fl.length - asked0, used: O.stats.used });
    const O2 = createOskyEnds({ os: { on: true, left: () => 30, get: async () => { throw new Error('asked'); } }, now, byIcao: c => E.byIcao(c) }); O2.want([{ hex: '400009', day: D, n: 1 }]);
    check('... (and with 30 credits left: nothing asked)', (await O2.round()) === false);
    // (kept across a restart; let go after 200 days)
    const O3 = createOskyEnds({ os: C, now, byIcao: c => E.byIcao(c) }); O3.fromJSON(JSON.parse(JSON.stringify(O.toJSON())));
    const again = O3.fill('424c60', legs);
    O3.want([{ hex: '424c60', day: D, n: 3 }]);
    check('kept across a restart: the same ends; a day asked before not asked again', again[0].to && again[0].to.id === FAB.id && O3.queue.length === 0);
    O3.prune(D0 + 201 * 86400);
    check('... let go after 200 days', !O3.days.size && !O3.asked.size);
    // (the monitor: the days to ask for, and its logs served with OpenSky's ends in)
    M.markBlocked('424c60', { reg: 'M-ARNZ', type: 'PC24' }, T);
    const nowS = D0 + 86400 + 8 * 3600; M.flew.set(D, new Set(['424c60']));
    M.legs.set('424c60', new Map([[1, Object.assign({ hex: '424c60', open: false }, legs[0])], [2, Object.assign({ hex: '424c60', open: false }, legs[1])]]));
    const w = M.oskyWants(nowS).filter(x => x.hex === '424c60');
    check('the monitor\'s days to ask OpenSky for: a blocked aircraft that flew yesterday, its flights with ends missing (three here)', w.length === 1 && w[0].day === D && w[0].n === 3, w);
    for (const [k, v] of O.days) M.OSE.days.set(k, v);
    M.histWrite('424c60', { hv: M.HIST_V, days: { '2026/11/16': 2 }, legs: legs.map(l => Object.assign({}, l)), part: {}, lo: {}, fr: {} });
    const h = M.histOf('424c60', '2026-11-16'), l0 = (h.legs || []).find(l => l.tStart === D0 + 57722);
    check('... the log the monitor serves browsers: that flight from Walney to Farnborough, OpenSky\'s ends in it', l0 && l0.from && l0.from.code === 'BWF' && l0.to && l0.to.code === 'FAB' && l0.to.src === 'osky', l0);
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
