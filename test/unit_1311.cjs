// 1.3.11 - "FR24 asked for an OurAirports airport's /top-travelers - new to this script, answered empty" on every panel:
//   - FR24's mid-November build asks each airport's window for /api/v2/airports/<id>/top-travelers. For an OurAirports
//     airport 1.3.9 answered it in the shape of FR24's own answer for it - and still counted it as new, so the health line
//     named it on every panel for the rest of the session. A part answered in FR24's shape is not counted now
//   - a part whose shape is not known yet: FR24's own answer asked for once, for the FR24 airport the OurAirports one's
//     pages are made from, at the same address - the answer in its shape, empty, kept (no value of FR24's in it); several
//     asked at once wait for the one answer; FR24's own requests as FR24 made them (a Request kept a Request)
//   - only a part FR24 has no answer for either is answered blind - and counted, named; asked again later
// usage: node test/unit_1311.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'node_modules');

let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let JSDOM = null; try { ({ JSDOM } = require(path.join(NM, 'jsdom'))); } catch (e) { console.log('(skipped: no jsdom)'); }
  const DIST = path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js');
  if (!JSDOM || !fs.existsSync(DIST)) { console.log(JSDOM ? '(skipped: no build - node build.mjs)' : ''); process.exit(JSDOM ? 1 : 0); }
  const SRC = fs.readFileSync(DIST, 'utf8'), PI = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/)[0];
  // (FR24's server, as the page's own fetch: Walney (530) and its top travelers - names and counts that must never show
  // in an OurAirports airport's answer; a part it fails for while `down`; "not found" for anything else)
  const TOP = { data: { travelers: [{ id: 7, name: 'Jane Flyer', avatar: 'https://x/a.png', flights: 42 }], total: 9, period: 'year', updatedAt: 1794960000 } };
  const S = { asked: [], down: false, slow: 0 };
  const fr24 = (u) => {
    S.asked.push(u);
    if (/\/api\/v2\/airports\/530\/top-travelers(?:[?#]|$)/.test(u)) return S.down ? [500, { message: 'error' }] : [200, TOP];
    if (/\/api\/v\d+\/airports\/530\/flaky(?:[?#]|$)/.test(u)) return S.down ? [503, { message: 'busy' }] : [200, { data: { level: 3, notes: ['FR24 NOTE'] } }];
    return [404, { message: 'Not Found' }];
  };
  const page = () => {
    const w = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/54.15,-3.20/10', runScripts: 'dangerously', pretendToBeVisual: true }).window; let H = null;
    w.__tlTestHook = h => { H = h; }; w.Response = Response; w.Headers = Headers; w.Blob = Blob; w.Request = Request;
    // (a Request as FR24's own code may pass one: its address read as it is)
    w.fetch = (u) => { const s = String(u && u.url || u); const [st, j] = fr24(s); S.kinds = (S.kinds || []).concat(u instanceof Request ? 'Request' : typeof u); return sleep(S.slow).then(() => new Response(JSON.stringify(j), { status: st, headers: { 'content-type': 'application/json' } })); };
    w.eval('(' + PI + ')()');
    const Hk = H;
    Hk.acceptOa({ rows: [[17000001, 'EGXX', 'EGXX', 'Walney Strip', 'Barrow-in-Furness', 530, 54.2, -3.2, 50, 'S'], [17000002, 'GB-0999', 'GB-0999', 'Some Heliport', 'Ulverston', 530, 54.19, -3.09, 30, 'H'], [17000003, 'GB-0998', 'GB-0998', 'Lone Field', 'Nowhere', 0, 54.1, -3.0, 20, 'S']], sig: '3.11.1' });
    const ref = { id: 530, iata: 'BWF', icao: 'EGNL', name: 'Barrow', city: 'Barrow', country: 'United Kingdom', countryId: 235, lat: 54.13, lon: -3.26, size: 3000, timezone: { abbr: 'GMT', abbrName: null, isDst: false, name: 'Europe/London', offset: 0, offsetHours: '0:00' } };
    Hk.patchList('airports', { rows: [ref].concat(Array.from({ length: 120 }, (_, i) => ({ id: 1000 + i, iata: 'A' + i, icao: '', name: 'X', lat: 0, lon: 0, timezone: ref.timezone }))) });
    const get = async u => { const r = await w.fetch(u); return { status: r.status, j: await r.json().catch(() => null) }; };
    return { w, H: Hk, get };
  };
  const leak = j => /Jane Flyer|a\.png|"year"|FR24 NOTE|\b42\b|1794960000/.test(JSON.stringify(j));

  // ---- 1. the warning on every panel: a part answered in FR24's shape was counted as new ----------------------------
  {
    const P = page(), n0 = S.asked.length;
    const own = await P.get('https://www.flightradar24.com/api/v2/airports/530/top-travelers'); await sleep(30);
    check('FR24\'s own airport (Walney): its /top-travelers as FR24 answered it, and its shape kept (no value of FR24\'s in it)', own.j.data.travelers[0].name === 'Jane Flyer' && (() => { const k = JSON.parse(P.w.localStorage.getItem('tl.apShape1') || '{}')['/top-travelers']; return k && Array.isArray(k.data.travelers) && !leak(k); })());
    const n1 = S.asked.length, oa = await P.get('https://www.flightradar24.com/api/v2/airports/17000002/top-travelers');
    check('an OurAirports airport\'s /top-travelers (the request behind "new to this script, answered empty" on every panel): answered here in FR24\'s shape, empty - its travelers an empty list, total 0 - FR24\'s server not asked', oa.status === 200 && Array.isArray(oa.j.data.travelers) && oa.j.data.travelers.length === 0 && oa.j.data.total === 0 && oa.j.data.period === '' && !leak(oa.j) && S.asked.length === n1, oa.j);
    check('... and not counted as new: nothing for the health line to name (1.3.10 counted it, every time)', !(P.H.stats.oaApiNew > 0) && P.H.stats.oaApiShaped >= 1, { n: P.H.stats.oaApiNew, shaped: P.H.stats.oaApiShaped });
    check('(FR24\'s server asked only for its own airport)', S.asked.slice(n0).every(u => /airports\/530\//.test(u)), S.asked.slice(n0));
    P.w.close();
  }

  // ---- 2. a part not yet seen: FR24's own answer for the airport its pages are made from, asked for once ------------
  {
    S.slow = 40;
    const P = page(), n0 = S.asked.length;
    const both = await Promise.all([P.get('https://www.flightradar24.com/api/v2/airports/17000001/top-travelers?limit=10'), P.get('https://www.flightradar24.com/api/v2/airports/17000002/top-travelers?limit=10')]);
    const mine = S.asked.slice(n0);
    check('(a new page: no shape kept) two OurAirports airports\' /top-travelers at once: FR24 asked once, for Walney - the airport their pages are made from - at the same address and query', mine.length === 1 && mine[0] === 'https://www.flightradar24.com/api/v2/airports/530/top-travelers?limit=10', mine);
    check('... both answered in its shape, empty - nothing of Walney\'s in them', both.every(x => x.status === 200 && Array.isArray(x.j.data.travelers) && x.j.data.travelers.length === 0 && x.j.data.total === 0 && !leak(x.j)), both.map(x => x.j));
    check('... not counted as new; the shape kept for the next page', !(P.H.stats.oaApiNew > 0) && !!JSON.parse(P.w.localStorage.getItem('tl.apShape1') || '{}')['/top-travelers'], { n: P.H.stats.oaApiNew });
    const n1 = S.asked.length, again = await P.get('https://www.flightradar24.com/api/v2/airports/17000001/top-travelers');
    check('... the next one answered from it, FR24 not asked again', again.j.data.travelers.length === 0 && S.asked.length === n1);
    // (a Request, as FR24's code may pass one: the request for Walney made as a Request too)
    S.kinds = [];
    const rq = await P.w.fetch(new Request('https://www.flightradar24.com/api/v3/airports/17000002/flaky')), rj = await rq.json();
    check('FR24\'s request made as a Request: the one for Walney a Request too, at Walney\'s address; the answer in its shape (notes an empty list, level 0)', S.kinds[0] === 'Request' && S.asked[S.asked.length - 1] === 'https://www.flightradar24.com/api/v3/airports/530/flaky' && rj.data && rj.data.level === 0 && Array.isArray(rj.data.notes) && rj.data.notes.length === 0, { kinds: S.kinds, last: S.asked[S.asked.length - 1], j: rj });
    P.w.close();
    S.slow = 0;
  }

  // ---- 3. FR24 has no answer either: answered blind, counted, named - and asked again later --------------------------
  {
    const P = page();
    P.w.localStorage.removeItem('tl.apShape1');
    const P2 = page(); P.w.close();
    S.down = true;
    const b1 = await P2.get('https://www.flightradar24.com/api/v2/airports/17000002/flaky');
    check('FR24 failing for Walney too: answered here, empty - counted, named (the health line\'s "answered empty")', b1.status === 200 && b1.j.data && Object.keys(b1.j.data).length === 0 && P2.H.stats.oaApiNew === 1 && P2.H.stats.oaApiNewPart === '/flaky', { j: b1.j, n: P2.H.stats.oaApiNew });
    const n0 = S.asked.length, lone = await P2.get('https://www.flightradar24.com/api/v2/airports/17000003/sometopic');
    check('an OurAirports airport with no FR24 airport its pages are made from: answered blind, counted - FR24 not asked', Object.keys(lone.j.data).length === 0 && P2.H.stats.oaApiNew === 2 && S.asked.length === n0);
    S.down = false;
    const n1 = S.asked.length, b2 = await P2.get('https://www.flightradar24.com/api/v2/airports/17000002/flaky');
    check('... FR24 answering again: asked again, and the answer in its shape - not counted', S.asked.length === n1 + 1 && b2.j.data.level === 0 && Array.isArray(b2.j.data.notes) && P2.H.stats.oaApiNew === 2 && !leak(b2.j), { j: b2.j, n: P2.H.stats.oaApiNew });
    P2.w.close();
  }

  // ---- 4. the health line: only a part answered blind ----------------------------------------------------------------
  const tools = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', '06-tools.js'), 'utf8');
  check('the health line names a part only where it was answered blind (S.oaApiNew), not one answered in FR24\'s shape', /if \(S\.oaApiNew > 0\)/.test(tools) && !/oaApiShaped/.test(tools));

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
