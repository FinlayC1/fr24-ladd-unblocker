// (1.1.4) The map's airport panel on FR24's own markup (test/fixtures/fr24_airport_panel_lpl.html - Liverpool's panel as
// FR24 drew it on 30 Oct 2026), the page part of the BUILT userscript in jsdom:
//   - FR24's address is /airport/<id>/<code> now (/airport/2002/lpl): the airport is LPL, not "2002" - read as the code,
//     its data was asked for an airport that does not exist, and the runway details and usage stayed locked
//   - the old address (/airport/lpl) the same; an id alone (/airport/2002) no airport
//   - the monitor's answer for it: the runway table in place of FR24's locked one, the runway usage filled in
// usage: node test/unit_appanel.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '../node_modules');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(__dirname, 'fixtures', 'fr24_airport_panel_lpl.html'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); };
// (the monitor's answer for Liverpool, 30 Oct 2026: /airport?ap=2002&days=7&hist=14)
const MON = { ap: 2002, icao: 'EGGP', known: true, days: 7, runways: [['09', '27', 7497, 150, 'ASPH', 'ASP', 1, 0, 59, 86, 200, 53.33285, -2.86688, 77, 266, null, 53.33442, -2.83265]], freqs: [['ATIS', 'ATIS', 124.33], ['TWR', 'TWR', 126.35], ['GND', 'GND', 121.95], ['APP', 'APP', 119.85]], usage: [['27', 126, 171], ['09', 62, 99]], moves: 1075, withRunway: 458, daily: [['2026-10-29', 91, 89, 'all', 1], ['2026-10-28', 94, 93, 'all']], allDays: 6 };

async function open(url) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app" data-v-app="">' + PANEL + '</div></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, posted = [], post0 = w.postMessage.bind(w);
  w.postMessage = (d, o) => { posted.push(d); return post0(d, o); };
  w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {}; w.fetch = () => Promise.reject(new Error('offline')); w.indexedDB = undefined;
  // (jsdom draws nothing: every box has the size FR24's would)
  w.HTMLElement.prototype.getBoundingClientRect = function () { return { top: 0, bottom: 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: 0 }; };
  const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
  if (!m) throw new Error('pageInterceptor not found in the build');
  w.eval('(' + m[0] + ')()');
  return { w, d: w.document, posted };
}
const asked = P => P.posted.filter(x => x && x.__tweeksLadd === 'needAirportPanel').map(x => x.code);

(async () => {
  // ---- FR24's address now: /airport/<id>/<code>
  const P = await open('https://www.flightradar24.com/airport/2002/lpl');
  await sleep(1300);
  check('/airport/2002/lpl: the panel\'s data asked for LPL - not "2002"', asked(P).includes('LPL') && !asked(P).includes('2002'), asked(P));
  const btn = P.d.querySelector('[data-testid="airport-panel__promo-runway_details"]').closest('button');
  check('(FR24\'s own panel: its locked runway details, runway usage and movements)', !!btn && !!P.d.querySelector('[data-testid="airport-panel__promo-runway_usage"]'));
  P.w.dispatchEvent(new P.w.MessageEvent('message', { data: Object.assign({ __tweeksLadd: 'airportPanel', code: 'LPL', apId: 2002, tz: 'Europe/London', monitor: true }, MON), source: P.w, origin: 'https://www.flightradar24.com' }));
  await sleep(900);
  const rwy = P.d.querySelector('.tl-rwy');
  check('the monitor\'s answer: the runway table in place of FR24\'s locked one (09/27, 7,497 ft, the frequencies)', !!rwy && rwy.previousElementSibling === btn && btn.style.display === 'none' && /09\/27/.test(rwy.textContent) && /7,497/.test(rwy.textContent) && /124\.330/.test(rwy.textContent), rwy && rwy.textContent.slice(0, 160));
  const blocks = [...P.d.querySelectorAll('.tl-panel')].map(b => b.textContent.replace(/\s+/g, ' ').slice(0, 80));
  check('... the runway usage filled in (27 and 09, the week\'s take-offs and landings)', blocks.some(t => /27/.test(t) && /09/.test(t)), blocks);
  P.w.close();
  // ---- the old address, and an id alone
  const Q = await open('https://www.flightradar24.com/airport/lpl');
  await sleep(1300);
  check('/airport/lpl (the address before): LPL as well', asked(Q).includes('LPL'), asked(Q));
  Q.w.close();
  const R = await open('https://www.flightradar24.com/airport/2002');
  await sleep(1300);
  check('/airport/2002 (an id alone): no airport asked for', asked(R).length === 0, asked(R));
  R.w.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
