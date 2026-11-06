// 1.2.8 - G-RVNX, and runways at once:
//   - a registration the aircraft sends as its callsign, in its own country's form, over a database's stale one: G-AWTL,
//     re-registered G-RVNX in 2021 with the same Mode S address (4017CD), sends "GRVNX" - the monitor and the page name it
//     G-RVNX; kept when it later flies under another callsign; given back once the database has it
//   - a board card's Playback of a row of this script's own (an id made up here, "ff" + address + take-off) never handed
//     to FR24, whose card has no registration - its list of aircraft types, /data/aircraft/#ff...
//   - an airport's runways in one answer (/rwyap&use=1): every flight's of the boards' window and the runways in use
//     (ends, runways, the last day's movements), from the days in memory, made once for everyone asking; the blocked
//     flights' by airport
//   - the page: the runway in use from that same answer, and from the one this browser kept of the airport while it
//     comes; "runways" when two are in use; a card's runway written into it when it comes after the card was drawn
// usage: node test/unit_128.cjs <node_modules dir> <data dir>
const fs = require('fs'), path = require('path'), os = require('os');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), D = process.argv[3] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = D;
process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'mon128-'));
process.env.MON_PORT = String(42000 + Math.floor(Math.random() * 6000));
global.fetch = async () => ({ status: 404, text: async () => '' });
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const M = require('../monitor/monitor.cjs');
M.loadEngine();
const E = M.E;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };

function open(url, store) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: url || 'https://www.flightradar24.com/53.33,-2.85/10', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, posts = []; let H = null;
  if (store) for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
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
  // ================= G-RVNX =================
  check('engine: the callsign in its own country\'s registration form over the database\'s - GRVNX for 4017CD (G-AWTL) is G-RVNX',
    E.regOfCs('G-AWTL', 'GRVNX', '4017cd') === 'G-RVNX' && E.regOfCs('', 'HBJFN', '4b1234') === 'HB-JFN' && E.regOfCs('C-FABC', 'CGXYZ', 'c01234') === 'C-GXYZ',
    [E.regOfCs('G-AWTL', 'GRVNX', '4017cd'), E.regOfCs('', 'HBJFN', '4b1234')]);
  check('... an airline\'s callsign (its flight number), another country\'s form, or an American (its address is its N-number\'s): the database\'s kept',
    E.regOfCs('G-EZWX', 'EZY47FH', '406c72') === 'G-EZWX' && E.regOfCs('G-ABCD', 'GABCD', '3c0001') === 'G-ABCD' && E.regOfCs('N676BA', 'NXYZAB', 'a8f21c') === 'N676BA' && E.regOfCs('D-AIXA', 'RVR12', '3c6444') === 'D-AIXA');
  { const a = (o, t) => M.ingest(Object.assign({ hex: '4017cd', r: 'G-AWTL', t: 'P28A', lat: 53.33, lon: -2.83, alt_baro: 900, gs: 101, track: 100, seen_pos: 0, dbFlags: 0 }, o), t);
    a({ flight: 'GRVNX   ' }, now - 300); const r1 = M.ac.get('4017cd').meta.reg;
    a({ flight: 'RVR12   ' }, now - 200); const r2 = M.ac.get('4017cd').meta.reg;
    a({ flight: '' }, now - 100); const r3 = M.ac.get('4017cd').meta.reg;
    a({ flight: 'GRVNX', r: 'G-RVNX' }, now - 50); const x = M.ac.get('4017cd').meta;
    check('monitor: heard as GRVNX - named G-RVNX; later under another callsign or none, still G-RVNX; the database put right, as it says', r1 === 'G-RVNX' && r2 === 'G-RVNX' && r3 === 'G-RVNX' && x.reg === 'G-RVNX' && !x.regCs, { r1, r2, r3, x }); }

  // ================= a board card's Playback of a row of this script's own =================
  { const P = open(); await sleep(200); const H = P.H(), row = 20000000777, fid = 'ff4017cd6aece003', dep = parseInt('6aece003', 16);
    let went = ''; H.setNav(u => { went = u; });
    H.archById.set(row, { own: true, fid, kind: 'arrivals', apId: 1257, r: { fid, hex: '4017cd', reg: 'G-RVNX', cs: 'GRVNX', t: dep + 1800, ap: 0 } });
    const doc = P.w.document, card = doc.createElement('div'); card.id = 'airport_schedule_' + row;
    card.innerHTML = '<div><a href="/data/aircraft/#' + fid + '"><span>Playback</span></a></div>'; doc.body.appendChild(card);
    let fr24 = false; doc.addEventListener('click', () => { fr24 = true; });
    card.querySelector('span').dispatchEvent(new P.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(50);
    check('board card: Playback of a row of this script\'s own (G-RVNX, an ordinary Piper) - its log page\'s player, not FR24\'s list of aircraft types', went === '/data/aircraft/g-rvnx#' + fid && !fr24, { went, fr24 });
    P.w.close(); }

  // ================= the monitor: an airport's runways in one answer =================
  { const lpl = E.byIcao('EGGP'), t = now - 1200;
    M.RL.put('3e0a0001', 1, '27', lpl.id, t, 'live'); M.RL.put('3e0a0002', 0, '27', lpl.id, t + 300, 'live'); M.RL.put('3e0a0003', 0, '09', lpl.id, now - 3 * 86400, 'live');
    M.legs.set('424b68', new Map([[1, { hex: '424b68', from: { id: 1190 }, to: { id: lpl.id }, tOn: t - 600, tEnd: t - 500, rwyOn: '27', ended: true, open: false }]]));
    const j = M.answer(new URL(`http://x/rwyap?ap=${lpl.id}&use=1`), now);
    check('monitor /rwyap&use=1: the boards\' runways by flight, the blocked flights\' by address, and the runway in use\'s own - ends, runways, the last day\'s movements',
      j && j.f['3e0a0001:1'] === '27' && j.f['3e0a0002:0'] === '27' && !('3e0a0003:0' in j.f) && j.h.some(x => x[0] === '424b68' && x[2] === '27') && j.ends.some(e => e[0] === '27') && j.runways.length > 0 && j.mv.filter(m => m[0] === '27').length >= 3,
      j && { f: j.f, h: j.h, ends: j.ends, mv: j.mv });
    const j2 = M.answer(new URL(`http://x/rwyap?ap=${lpl.id}&use=1`), now);
    check('... made once for all asking within 20 s (the same answer)', j2 === j);
    const jo = M.answer(new URL(`http://x/rwyap?ap=${lpl.id}&from=${now - 4 * 86400}&to=${now}&old=1`), now);
    check('... an older window when asked for: the days kept on disk too', jo && jo.f['3e0a0003:0'] === '09' && !('ends' in jo), jo && jo.f); }

  // ================= the page: the runway in use, at once =================
  { const ap = 1257, use = { ends: [['09L', 90], ['09R', 90], ['27L', 270], ['27R', 270]], runways: [['09L', '27R', 12800, 0], ['09R', '27L', 12000, 0]],
      mv: [['27L', 0, now - 1500], ['27R', 0, now - 900], ['27L', 0, now - 400], ['27L', 1, now - 1800], ['27L', 1, now - 700]], at: now };
    const kept = JSON.stringify({ [ap]: { e: use.ends, r: use.runways, m: use.mv, t: now - 120 } });
    const P = open(undefined, { 'tl.ladd.rwyuse.v1': kept }); await sleep(200); const H = P.H(), doc = P.w.document;
    const panel = doc.createElement('div'); panel.setAttribute('data-testid', 'airport-panel');
    panel.innerHTML = '<section><dl class="grid grid-cols-3"><div data-testid="airport-panel__weather__conditions"><dd>Overcast</dd></div><div data-testid="airport-panel__weather__temperature"><dd>9 °C</dd></div><div data-testid="airport-panel__weather__wind"><dt>Wind</dt><dd><span>260°</span><span>10</span><span>kts</span></dd></div></dl></section>';
    doc.body.appendChild(panel);
    H.rwyUsePanel(panel, ap);
    const tiles = () => [...panel.querySelectorAll('.tl-rwyuse > div')].map(d => d.textContent.replace(/\s+/g, ' ').trim());
    const t0 = tiles(), ask = P.posts.filter(p => p.__tweeksLadd === 'rwyAp' && p.ap === ap);
    check('airport panel: the runway in use at once from what this browser kept of the airport - and asked for afresh, the airport\'s runways in the same request',
      /Departures runways\s*27L \/ 27R\s*Confirmed/i.test(t0[0] || '') && /Arrivals runway\s*27L\s*Confirmed/i.test(t0[1] || '') && ask.length === 1 && !P.posts.some(p => p.__tweeksLadd === 'rwyUse'), { t0, asks: ask.length });
    P.send({ __tweeksLadd: 'rwyApGot', rid: ask[0] && ask[0].rid, ap, ok: true, f: { '3e0a0010:0': '27R' }, h: [], use: Object.assign({}, use, { mv: [['27R', 0, now - 200], ['27R', 0, now - 100]] }) });
    H.rwyUsePanel(panel, ap);
    const t1 = tiles();
    check('... the answer in: one runway now - "runway" again (27R, the last minutes\' take-offs with the wind: confirmed)', /Departures runway\s*27R\s*Confirmed/i.test(t1[0] || '') && !/runways/i.test(t1[0] || ''), t1);
    const k2 = JSON.parse(P.w.localStorage.getItem('tl.ladd.rwyuse.v1') || '{}')[ap];
    check('... kept for the next time: its runways and the last three hours\' movements', k2 && k2.e.length === 4 && k2.m.length === 2, k2);
    // a card drawn before its runways were in: written into FR24's own cell as they come
    const row = 1234567, card = doc.createElement('div'); card.id = 'airport_schedule_' + row;
    card.innerHTML = '<dl><dt>Departure runway</dt><dd><div>N/A</div></dd></dl><dl><dt>Arrival runway</dt><dd><div>N/A</div></dd></dl>';
    doc.body.appendChild(card); H.cardInfo.set(row, { fid: '3e0a0020' });
    P.send({ __tweeksLadd: 'rwyGot', rid: 'x', list: [{ k: '3e0a0020:0', rwy: '05' }], done: true });
    const cells = [...card.querySelectorAll('dd')].map(d => d.textContent.trim());
    check('board card: the take-off\'s runway, in after the card was drawn, written into it; the landing\'s not known yet left "N/A"', cells[0] === '05' && cells[1] === 'N/A', cells);
    P.w.close(); }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
