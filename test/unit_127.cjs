// 1.2.7 - runways everywhere, from FR24's own tracks:
//   - the monitor's runway log (monitor/rwylog.cjs): a take-off's runway logged from the scans the moment the flight is
//     seen climbing out along it, a landing's the moment it is seen on the final approach; both ends from FR24's whole
//     trail of a flight; kept on disk by day and airport, read back after a restart, an airport's given all at once
//   - the page: an airport's runways asked for once and kept (FR24's ids, a blocked flight's by its address and time);
//     a board row and a card filled from them - a blocked flight's (a row of this script's, M-PORT's) too
//   - the runway in use: confirmed by the traffic of the last hour and a half with the wind, predicted from the wind
//     alone (or traffic the wind has turned against), the longest runway on a calm day with no traffic; parallels apart
//   - FR24's airport data pages: their rows' "N/A" other ends filled; the runway in use under FR24's weather card
// usage: node test/unit_127.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), os = require('os');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), D = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const { createRouteEngine } = require('../src/engine.js');
const { createAirportInfo } = require('../monitor/airport.cjs');
const { createRwyLog } = require('../monitor/rwylog.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };

function open(url) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: url || 'https://www.flightradar24.com/53.33,-2.85/10', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, posts = []; let H = null;
  w.__tlTestHook = h => { H = h; };
  w.Response = Response; w.Headers = Headers; w.Blob = Blob; w.DecompressionStream = DecompressionStream;
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.indexedDB = undefined; w.fetch = () => Promise.reject(new Error('offline'));
  w.postMessage = d => { if (d && d.__tweeksLadd) posts.push(d); };
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) throw new Error('pageInterceptor not found in the build');
  w.eval('(' + m[0] + ')()');
  const send = data => w.dispatchEvent(new w.MessageEvent('message', { data, source: w, origin: 'https://www.flightradar24.com' }));
  return { w, H: () => H, posts, send };
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  // ================= the monitor's runway log =================
  { const E = createRouteEngine(); E.setAirports(JSON.parse(fs.readFileSync(path.join(D, 'airports.json'), 'utf8')).rows);
    const APT = createAirportInfo({ E }); APT.load(D);
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'rl127-'));
    const RL = createRwyLog({ E, APT, store });
    const lpl = E.byIcao('EGGP'), man = E.byIcao('EGCC'), ends = APT.endsOf('EGGP').filter(e => Number.isFinite(e.lat));
    const e1 = ends[0], e2 = ends.find(e => e.id !== e1.id) || ends[0];
    const T = now - 600;
    // a take-off: on the ground at the threshold, then (the next scan, two minutes on) climbing out along the runway
    const [la1, lo1] = E.destPoint(e1.lat, e1.lon, e1.hdg, 5);
    const kept = [];
    RL.observe([{ id: 0x3e000001, lat: e1.lat, lon: e1.lon, alt: 0, gnd: true, trk: e1.hdg, spd: 5, ts: T, from: lpl.iata, to: 'DUB' }], T, (f, p) => kept.push(p));
    RL.observe([{ id: 0x3e000001, lat: la1, lon: lo1, alt: 1900, gnd: false, trk: e1.hdg, spd: 165, ts: T + 120, from: lpl.iata, to: 'DUB' }], T + 120, (f, p) => kept.push(p));
    check('monitor: a take-off\'s runway logged the moment it is seen climbing out along it (and FR24\'s positions there kept)', RL.get('3e000001:0') === e1.id && kept.length === 1 && kept[0].alt === 1900, { got: RL.get('3e000001:0'), want: e1.id, kept: kept.length });
    // a landing: on the final approach, 8 km out, 2,300 ft above the field
    const [la2, lo2] = E.destPoint(e2.lat, e2.lon, (e2.hdg + 180) % 360, 8);
    RL.observe([{ id: 0x3e000002, lat: la2, lon: lo2, alt: (lpl.alt || 0) + 2300, gnd: false, trk: e2.hdg, spd: 140, ts: T + 60, from: 'BHD', to: lpl.iata }], T + 60);
    check('... a landing\'s the moment it is seen on the final approach - before it is down', RL.get('3e000002:1') === e2.id, { got: RL.get('3e000002:1'), want: e2.id });
    // (one going elsewhere, passing on the same line: not a landing here; one with no route of FR24's, climbing - 1,500 ft
    // 20 km out, then 2,600 ft at 8 km: going away, whatever its heading says - not either)
    RL.observe([{ id: 0x3e000003, lat: la2, lon: lo2, alt: (lpl.alt || 0) + 2300, gnd: false, trk: e2.hdg, spd: 140, ts: T + 60, from: 'BHD', to: 'MAN' }], T + 60);
    const [la3, lo3] = E.destPoint(e2.lat, e2.lon, (e2.hdg + 180) % 360, 20);
    RL.observe([{ id: 0x3e000004, lat: la3, lon: lo3, alt: 1500, gnd: false, trk: e2.hdg, spd: 140, ts: T }, { id: 0x3e000005, lat: 0, lon: 0, alt: 0, ts: T }], T);
    RL.observe([{ id: 0x3e000004, lat: la2, lon: lo2, alt: 2600, gnd: false, trk: e2.hdg, spd: 140, ts: T + 120 }], T + 120);
    check('... not a flight going elsewhere along the same line, nor one with no route that is climbing', !RL.get('3e000003:1') && !RL.get('3e000004:1'), { other: RL.get('3e000003:1'), climb: RL.get('3e000004:1') });
    // FR24's whole trail of a flight: both ends - off Liverpool, down at Manchester
    const mends = APT.endsOf('EGCC').filter(e => Number.isFinite(e.lat)), me = mends[0];
    const tr = []; let t = T - 4000;
    for (let k = 0; k <= 8; k++) tr.push({ t: t += 5, lat: e1.lat + (la1 - e1.lat) * k / 40, lon: e1.lon + (lo1 - e1.lon) * k / 40, alt: 0, gs: k * 18, trk: e1.hdg });
    for (let k = 1; k <= 10; k++) { const [a, b] = E.destPoint(e1.lat, e1.lon, e1.hdg, k * 0.6); tr.push({ t: t += 10, lat: a, lon: b, alt: k * 250, gs: 150, trk: e1.hdg }); }
    for (let k = 12; k >= 1; k--) { const [a, b] = E.destPoint(me.lat, me.lon, (me.hdg + 180) % 360, k * 1.2); tr.push({ t: t += 20, lat: a, lon: b, alt: Math.round(k * 1.2 * 320), gs: 140, trk: me.hdg }); }
    for (let k = 0; k <= 5; k++) { const [a, b] = E.destPoint(me.lat, me.lon, me.hdg, k * 0.3); tr.push({ t: t += 6, lat: a, lon: b, alt: 0, gs: 120 - k * 20, trk: me.hdg }); }
    const nT = RL.fromTrack('3e0000aa', tr, 'trail');
    check('... both ends from FR24\'s whole trail of a flight (off Liverpool, down at Manchester)', nT === 2 && RL.get('3e0000aa:0') === e1.id && RL.get('3e0000aa:1') === me.id, { nT, off: RL.get('3e0000aa:0'), on: RL.get('3e0000aa:1'), want: [e1.id, me.id] });
    const apA = RL.airport(lpl.id, T - 86400, now);
    check('... an airport\'s all at once', apA['3e000001:0'] === e1.id && apA['3e000002:1'] === e2.id && !('3e0000aa:1' in apA) && RL.airport(man.id, T - 86400, now)['3e0000aa:1'] === me.id, apA);
    const mv = RL.movements(lpl.id, T - 86400, now);
    check('... its movements by runway (for the runway in use), each once', mv.length === 3 && mv.some(m => m[0] === e1.id && m[1] === 0) && mv.some(m => m[0] === e2.id && m[1] === 1), mv);
    RL.save(now);
    const RL2 = createRwyLog({ E, APT, store }); RL2.load(now);
    check('... kept on disk, read back after a restart', RL2.get('3e000001:0') === e1.id && RL2.get('3e0000aa:1') === me.id, { a: RL2.get('3e000001:0'), b: RL2.get('3e0000aa:1') });
    fs.rmSync(store, { recursive: true, force: true });
  }

  // ================= the page: an airport's runways, at once =================
  { const P = open(); await sleep(200); const H = P.H(), ap = 2002, t = now - 3000;
    const pr = H.mxRwyAirport(ap, 3000); await sleep(20);
    const ask = P.posts.find(p => p.__tweeksLadd === 'rwyAp');
    P.send({ __tweeksLadd: 'rwyApGot', rid: ask && ask.rid, ap, ok: true, f: { '3d4e0001:1': '27', '3d4e0002:0': '09' }, h: [['424b68', 1, '27', t], ['424b68', 0, '09', t - 7200]] });
    const ok = await pr;
    check('page: an airport\'s runways asked for once - FR24\'s flights by id, a blocked one\'s by address and time', ok === true && !!ask && H.mxRwy.get('3d4e0001:1') === '27' && H.mxRwyByHex(ap, '424b68', 1, t + 600) === '27' && H.mxRwyByHex(ap, '424b68', 1, t + 4000) === '' && H.mxRwyByHex(ap, '424b68', 0, t - 7000) === '09', { ask: !!ask });
    P.posts.length = 0; await H.mxRwyAirport(ap, 100);
    check('... kept: asked again only after a minute', !P.posts.some(p => p.__tweeksLadd === 'rwyAp'));
    // a board row of a blocked flight (M-PORT's: a row of this script's, no id of FR24's) - its runway by its address
    const rows = [{ id: 1, flightId: null, status: { name: 'landed' }, landedTime: t + 120, runway: null, locked: { runway: true }, __tlHex: '424b68' }];
    H.mxBoardRwy(rows, 'arrivals', ap);
    check('... a blocked flight\'s board row: no padlock, no runway in the row itself (1.2.8: only its card shows one) - its runway known by its address for the card', rows[0].runway === null && rows[0].locked.runway === false && H.mxRwyByHex(ap, '424b68', 1, t + 120) === '27', rows[0]);
    // its card (M-PORT's: an id made up here) - the landing here, the take-off at Helsinki asked for by that airport
    P.posts.length = 0;
    const cr = H.cardRwy(new Response(JSON.stringify({ data: { flight: { id: 'c1a2b3c4' }, runways: { arrival: { name: null, upsell: false }, departure: { name: null, upsell: false } }, schedule: { atd: t - 9000, ata: t + 60 }, originId: 1190, destinationId: ap } }), { status: 200 }), ap, 'arrivals', true, '424B68');
    await sleep(30);
    const askHel = P.posts.find(p => p.__tweeksLadd === 'rwyAp' && p.ap === 1190);
    P.send({ __tweeksLadd: 'rwyApGot', rid: askHel && askHel.rid, ap: 1190, ok: true, f: {}, h: [['424b68', 0, '04R', t - 9100]] });
    const cj = await (await cr).json();
    check('... a blocked flight\'s card: the landing here and the take-off at the other end, by its address - nothing asked by a made-up id', cj.data.runways.arrival.name === '27' && cj.data.runways.departure.name === '04R' && !P.posts.some(p => p.__tweeksLadd === 'rwyWant'), cj.data.runways);
    P.w.close(); }

  // ================= the runway in use =================
  { const P = open(); await sleep(200); const H = P.H();
    const U = mv => ({ ends: [['09', 87], ['27', 267]], runways: [['09', '27', 7500, 0]], mv });
    const W = { deg: 270, kts: 12 };
    let r = H.rwyInUse(U([]), W, 'Overcast', now);
    check('runway in use: no traffic in 24 hours - by the wind: 27, predicted', r.dep.rwys[0] === '27' && r.dep.tag === 'pred' && r.arr.rwys[0] === '27' && r.arr.tag === 'pred' && /no take-offs/.test(r.dep.why), r);
    r = H.rwyInUse(U([['27', 0, now - 1500], ['27', 0, now - 600], ['27', 1, now - 2000]]), W, '', now);
    check('... take-offs on 27 in the last half hour with the wind: confirmed; a landing 33 min ago alone: predicted', r.dep.rwys[0] === '27' && r.dep.tag === 'conf' && r.arr.rwys[0] === '27' && r.arr.tag === 'pred', r);
    r = H.rwyInUse(U([['09', 0, now - 1200], ['09', 0, now - 900]]), W, '', now);
    check('... traffic on 09 with a 12 kt tailwind now: the wind\'s 27, predicted (the wind has turned)', r.dep.rwys[0] === '27' && r.dep.tag === 'pred' && /turned/.test(r.dep.why), r);
    r = H.rwyInUse(U([]), { deg: 0, kts: 2 }, '', now);
    check('... calm, no traffic: the longest runway, predicted', /^(09\/27|27\/09)$/.test(r.dep.rwys[0]) && r.dep.tag === 'pred', r);
    r = H.rwyInUse(U([['09', 1, now - 20000]]), null, '', now);
    check('... no wind known, a landing on 09 earlier today: 09, predicted', r.arr.rwys[0] === '09' && r.arr.tag === 'pred', r);
    const LHR = { ends: [['09L', 90], ['09R', 90], ['27L', 270], ['27R', 270]], runways: [['09L', '27R', 12800, 0], ['09R', '27L', 12000, 0]], mv: [['27L', 1, now - 1800], ['27L', 1, now - 900], ['27L', 1, now - 300], ['27R', 0, now - 1200], ['27R', 0, now - 400]] };
    r = H.rwyInUse(LHR, { deg: 250, kts: 9 }, '', now);
    check('... parallels told apart: arrivals 27L, departures 27R - both confirmed', r.arr.rwys.join() === '27L' && r.arr.tag === 'conf' && r.dep.rwys.join() === '27R' && r.dep.tag === 'conf', r);
    check('... FR24\'s wind as its panel writes it', JSON.stringify(H.windOfText('50° 5 kts')) === '{"deg":50,"kts":5}' && H.windOfText('—') === null);
    // the map's airport panel: two tiles under its Conditions / Temperature / Wind
    const doc = P.w.document, panel = doc.createElement('div'); panel.setAttribute('data-testid', 'airport-panel');
    panel.innerHTML = '<section><dl class="grid grid-cols-3"><div data-testid="airport-panel__weather__conditions"><dd>Overcast</dd></div><div data-testid="airport-panel__weather__temperature"><dd>9 °C</dd></div><div data-testid="airport-panel__weather__wind"><dt>Wind</dt><dd><span>270°</span><span>12</span><span>kts</span></dd></div></dl><details>More weather &amp; METAR</details></section>';
    doc.body.appendChild(panel);
    H.rwyUsePanel(panel, 2002);
    // (1.2.8: asked with the airport's runways, in one answer)
    const askU = P.posts.find(p => p.__tweeksLadd === 'rwyAp' && p.ap === 2002);
    P.send({ __tweeksLadd: 'rwyApGot', rid: askU && askU.rid, ap: 2002, ok: true, f: {}, h: [], use: { ends: [['09', 87], ['27', 267]], runways: [['09', '27', 7500, 0]], mv: [['27', 0, now - 600], ['27', 0, now - 300]], at: now } });
    H.rwyUsePanel(panel, 2002);
    const tiles = [...panel.querySelectorAll('.tl-rwyuse > div')].map(d => d.textContent.replace(/\s+/g, ' ').trim());
    check('airport panel: departures and arrivals runway under the weather - 27 confirmed, 27 predicted', tiles.length === 2 && /Departures runway\s*27\s*Confirmed/i.test(tiles[0]) && /Arrivals runway\s*27\s*Predicted/i.test(tiles[1]) && panel.querySelector('section > dl + .tl-rwyuse + details') !== null, tiles);
    P.w.close(); }

  // ================= FR24's airport data pages =================
  { const P = open('https://www.flightradar24.com/data/airports/lpl'); await sleep(200); const H = P.H();
    const rows = [{ id: '1', flightId: '3d5a0001', status: { name: 'landed' }, estimatedTime: now - 3600, endpoint: null }, { id: '2', flightId: null, status: { name: 'scheduled' }, scheduledTime: now + 3600, endpoint: null }];
    H.mxDataEnds(rows, 'arrivals', 2002);
    const ask = P.posts.filter(p => p.__tweeksLadd === 'needEnds');
    P.send({ __tweeksLadd: 'endsGot', list: [{ k: '3d5a0001:0', ap: 1234, fin: 1, a: { id: 1234, name: 'Belfast City', city: 'Belfast', iata: 'BHD', icao: 'EGAC', countryId: 235, countryName: 'United Kingdom' } }] }); await sleep(20);
    H.mxDataEnds(rows, 'arrivals', 2002);
    check('data page: FR24\'s landed row with no origin - asked for once, then in its own form', ask.length === 1 && ask[0].list.length === 1 && rows[0].endpoint && rows[0].endpoint.iata === 'BHD' && rows[0].endpoint.city === 'Belfast' && !rows[1].endpoint, rows[0].endpoint);
    // the runway in use: a card of its own under FR24's weather card
    const doc = P.w.document, wrap = doc.createElement('div');
    wrap.innerHTML = '<div class="rounded-radius-s wxcard"><dl class="grid md:flex grid-cols-3"><div class="flex item"><dt><span class="text-caps-4">Conditions</span></dt><dd><span><span><span class="text-h7">Overcast</span></span></span></dd></div><div class="flex item"><dt><span class="text-caps-4">Wind</span></dt><dd><span><span><span class="text-h7">270° 12 kts</span></span></span></dd></div></dl></div><div class="delays">delays</div>';
    doc.body.appendChild(wrap);
    const p = { airport: { id: 2002 }, weather: { windDirection: 270, windSpeedKts: 12, condition: 'overcast' } };
    H.rwyUseData(p, 2002);
    const askU = P.posts.find(x => x.__tweeksLadd === 'rwyAp' && x.ap === 2002);
    P.send({ __tweeksLadd: 'rwyApGot', rid: askU && askU.rid, ap: 2002, ok: true, f: {}, h: [], use: { ends: [['09', 87], ['27', 267]], runways: [['09', '27', 7500, 0]], mv: [], at: now } });
    H.rwyUseData(p, 2002);
    const card = wrap.querySelector('.wxcard + .tl-rwyuse'), cells = card ? [...card.querySelectorAll('dl > div')].map(d => d.textContent.replace(/\s+/g, ' ').trim()) : [];
    check('data page: the runway in use, a card under FR24\'s weather card in its markup - 27 predicted both ways', !!card && /\bwxcard\b/.test(card.className) && cells.length === 2 && /Departures runway\s*27\s*Predicted/i.test(cells[0]) && /Arrivals runway\s*27\s*Predicted/i.test(cells[1]), cells);
    H.rwyUseData(p, 2002);
    check('... drawn once: not again when nothing changed', wrap.querySelectorAll('.tl-rwyuse').length === 1);
    P.w.close(); }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
