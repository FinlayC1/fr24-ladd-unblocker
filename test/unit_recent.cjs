// (1.1.2) "Recent <reg> flights" in a blocked aircraft's panel: the log page's flights. G-OUEG (a Global 6000, LADD): its
// log page had Dubai -> Liverpool, Liverpool -> Dubai, Luton -> Liverpool - FR24's own rows of the aircraft's page, their
// ends filled - while the panel's list had "N/A -> Dubai" and no Luton -> Liverpool (only the ADS-B log, which missed
// both ends of one flight and all of the other). Now the panel's list is built as the page is: FR24's rows of
// /data/aircraft/<reg>, the ADS-B flight that took off with each, else where FR24's own track of it began and ended, else
// the flight before's landing. The BUILT userscript in jsdom, FR24's airport list from monitor/data.
// usage: node test/unit_recent.cjs <node_modules dir> [data dir]
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '../node_modules'), DATA = process.argv[3] || path.join(__dirname, '../monitor/data');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const FIDB = require(path.join(NM, 'fake-indexeddb'));
const BUNDLE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const AIRPORTS = fs.readFileSync(path.join(DATA, 'airports.json'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms) => { for (let i = 0; i < ms / 50; i++) { const v = await f(); if (v) return v; await sleep(50); } return f(); };
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 700) : '')); };

const HEX = '407757', REG = 'G-OUEG', T = Math.floor(Date.now() / 1000);
// FR24's rows (newest first): Dubai -> Liverpool this morning, Liverpool -> Dubai five days ago, Luton -> Liverpool the
// evening before - airports "—", as FR24 serves a blocked aircraft's page
const ROWS = [
  { fid: 'a1b2c301', cs: 'VCG1UG', atd: T - 10 * 3600, ata: T - 10 * 3600 + 8 * 3600 + 180 },
  { fid: 'a1b2c302', cs: 'VCG2UG', atd: T - 5 * 86400, ata: T - 5 * 86400 + 6 * 3600 + 45 * 60 },
  { fid: 'a1b2c303', cs: 'VCG1UG', atd: T - 5 * 86400 - 6 * 3600 - 47 * 60, ata: T - 5 * 86400 - 6 * 3600 - 12 * 60 }
];
const td = (txt, ts) => `<td${ts ? ` data-timestamp="${ts}"` : ''}>${txt}</td>`;
const rowHtml = r => `<tr class="data-row" data-timestamp="${r.atd}">${td('')}${td('')}${td('date', r.atd)}${td('—')}${td('—')}${td(`(${r.cs})`)}${td('8:03')}${td('—')}${td('06:55', r.atd)}${td('—')}<td><div class="state-block green"></div></td><td data-timestamp="${r.ata}">Landed 10:58</td><td><a data-flight="${r.fid}">Play</a></td></tr>`;
const PAGE = `<!doctype html><html><body><table id="tbl-datatable"><tbody>${ROWS.map(rowHtml).join('')}</tbody></table></body></html>`;
// FR24's own tracks: Dubai -> Liverpool, Luton -> Liverpool; none for the flight to Dubai (its start comes from the flight before)
const AP = JSON.parse(AIRPORTS).rows, ap = icao => AP.find(a => a.icao === icao);
const DWC = ap('OMDW'), LPL = ap('EGGP'), LTN = ap('EGGW');
const trk = (a, b, t0, t1) => ({ result: { response: { data: { flight: { track: [{ latitude: a.lat, longitude: a.lon, altitude: { feet: 0 }, speed: { kts: 10 }, timestamp: t0 }, { latitude: b.lat, longitude: b.lon, altitude: { feet: 0 }, speed: { kts: 12 }, timestamp: t1 }] } } } } });
const TRACKS = { a1b2c301: trk(DWC, LPL, ROWS[0].atd, ROWS[0].ata), a1b2c303: trk(LTN, LPL, ROWS[2].atd, ROWS[2].ata), a1b2c302: { result: { response: { data: { flight: { track: [] } } } } } };

(async () => {
  const win = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'https://www.flightradar24.com/53.33,-2.85/9', runScripts: 'dangerously', pretendToBeVisual: true }).window;
  win.indexedDB = new FIDB.IDBFactory(); win.IDBKeyRange = FIDB.IDBKeyRange; win.Response = Response; win.Headers = Headers; win.AbortController = AbortController;
  win.DecompressionStream = DecompressionStream; win.Blob = Blob; win.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {}, set onmessage(f) {} }; };
  const asked = [];
  const answer = url => {
    if (/flightradar24\.com\/mobile\/airports\/format/.test(url)) return [200, AIRPORTS];
    if (/\/data\/aircraft\/g-oueg\b/.test(url)) { asked.push('page'); return [200, PAGE]; }
    const m = url.match(/flight-playback\.json\?flightId=([0-9a-f]+)/); if (m) { asked.push('track ' + m[1]); return TRACKS[m[1]] ? [200, JSON.stringify(TRACKS[m[1]])] : [404, '']; }
    return [404, ''];
  };
  win.fetch = input => { let u = typeof input === 'string' ? input : input.url; if (u.startsWith('/')) u = 'https://www.flightradar24.com' + u; const [st, text] = answer(u); return Promise.resolve(new Response(text, { status: st })); };
  win.GM_xmlhttpRequest = o => { const [st, text] = answer(o.url); setTimeout(() => o.onload && o.onload({ status: st, responseText: text, response: text }), 2); return { abort() {} }; };
  win.unsafeWindow = win; win.GM_notification = () => {}; win.console.debug = () => {}; win.console.log = () => {};
  const posted = [], post0 = win.postMessage.bind(win);
  win.postMessage = (d, o) => { if (d && d.__tweeksLadd === 'hist') posted.push(d); return post0(d, o); };
  win.eval(BUNDLE);
  const L = win.__tweeksLadd;
  await until(() => L && L.engine.airports.length > 5000, 60000);
  await L.store.kvReady;
  L.store.mergeHex(HEX, { reg: REG, type: 'GLEX', ladd: true, fr24Blocked: true });
  // (the ADS-B log: the flight to Dubai only, its take-off not heard - "N/A -> Dubai")
  const b = ROWS[1];
  const days = {}; for (let i = 0; i < 21; i++) days[new Date((T - i * 86400) * 1000).toISOString().slice(0, 10).replace(/-/g, '/')] = true;
  const HISTV = { v: 8, days, savedAt: Date.now(), legs: [{ day: new Date(b.atd * 1000).toISOString().slice(0, 10).replace(/-/g, '/'), tStart: b.atd + 1500, tEnd: b.ata - 300, from: null, to: { id: DWC.id, conf: 'ground' }, ended: true, how: 'ground' }] };
  // (after the script's own start - it clears logs kept from an older version then)
  await sleep(2000); L.store.setHist(HEX, HISTV);
  const t0 = Date.now();
  win.dispatchEvent(new win.MessageEvent('message', { data: { __tweeksLadd: 'needHist', reg: REG }, source: win, origin: 'https://www.flightradar24.com' }));
  const first = await until(() => posted.find(p => p.reg === REG && Array.isArray(p.data)), 12000), dt = Date.now() - t0;
  const show = d => (d || []).slice(1).map(e => [(e.airport.origin && e.airport.origin.code.iata) || 'N/A', (e.airport.destination && e.airport.destination.code.iata) || 'N/A', e.identification.callsign].join(' '));
  check('FR24\'s list drawn from its first answer: the aircraft\'s page and its tracks\' ends read first (within 4 s)', !!first && dt < 4500, { dt, asked });
  const want = ['DWC LPL VCG1UG', 'LPL DWC VCG2UG', 'LTN LPL VCG1UG'];
  check('"Recent G-OUEG flights" = its log page: Dubai -> Liverpool, Liverpool -> Dubai, Luton -> Liverpool (not "N/A -> Dubai", none missing)', JSON.stringify(show(first && first.data).slice(0, 3)) === JSON.stringify(want), show(first && first.data));
  const e1 = first && first.data[1];
  check('... each flight\'s take-off and landing as FR24 has them (its own row\'s times)', !!e1 && e1.time.real.departure === ROWS[0].atd && e1.time.real.arrival === ROWS[0].ata && /^Landed/.test(e1.status.text), e1 && { t: e1.time.real, s: e1.status.text });
  win.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed', e && e.stack || e); process.exit(1); });
