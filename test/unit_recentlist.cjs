// "Recent <reg> flights" filled from the log, whatever FR24 answers (the page-world part of the BUILT userscript in jsdom).
// N1876T's list said "No flights available" while its log page had its flights: FR24's answer was only filled when it
// came in its usual shape with a short list. Checked, asked for with fetch and with XHR:
//   - FR24's usual shape with no flights (data null): the log's flights in it, FR24's other fields kept
//   - no list in FR24's answer at all, an error status, an answer that is not JSON: an answer in FR24's shape, filled
//   - FR24's own list of an ordinary aircraft (several flights): left exactly as it is
//   - nothing known of the aircraft: FR24's answer as it is
// usage: node test/unit_recentlist.cjs <node_modules dir>
const fs = require('fs'), path = require('path');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules');
const { JSDOM } = require(path.join(NM, 'jsdom'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dist', 'fr24-ladd-unblocker.user.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };

// what FR24 answers, by registration
const row = (n, cs) => ({ identification: { id: 'a' + n, row: n, callsign: cs }, status: { live: false, text: 'Landed' }, aircraft: {}, airport: { origin: null, destination: null }, time: {} });
const FR24 = {
  N1876T: [200, JSON.stringify({ result: { request: { query: 'N1876T' }, response: { item: { current: 0, total: null, limit: 5 }, page: { current: 1, more: false }, data: null, aircraftInfo: { model: { text: 'Gulfstream G600' } }, aircraftImages: [] } } })],
  TCACN: [200, JSON.stringify({ errors: { message: 'not available' } })],
  MPORT: [403, ''],
  N50JE: [200, '<html>blocked</html>'],
  EIDPR: [200, JSON.stringify({ result: { response: { item: { current: 3, limit: 5 }, page: { current: 1, more: true }, data: [row(1, 'RYR1'), row(2, 'RYR2'), row(3, 'RYR3')] } } })],
  GUNKN: [200, JSON.stringify({ result: { response: { item: { current: 0, limit: 5 }, page: { current: 1, more: false }, data: null } } })]
};
const regOf = u => decodeURIComponent((u.match(/[?&]query=([^&]*)/) || [])[1] || '').toUpperCase().replace(/-/g, '');
const LIST = reg => `https://api.flightradar24.com/common/v1/flight/list.json?query=${reg}&fetchBy=reg&filterBy=historic&limit=5&page=1&timestamp=${Math.floor(Date.now() / 1000)}`;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.flightradar24.com/', runScripts: 'dangerously' });
const w = dom.window;
w.Response = Response; w.Headers = Headers;
w.fetch = input => { const u = typeof input === 'string' ? input : input.url; const a = FR24[regOf(u)] || [404, '']; return Promise.resolve(new Response(a[1], { status: a[0], headers: { 'content-type': 'application/json' } })); };
// (XHR as a browser has it: response / responseText read from the prototype)
function FakeXHR() { this.readyState = 0; this.status = 0; this.responseType = ''; this._body = ''; this.onload = null; this._l = []; }
FakeXHR.prototype.open = function (m, u) { this._u = u; this.readyState = 1; };
FakeXHR.prototype.setRequestHeader = function () {};
FakeXHR.prototype.addEventListener = function (k, f) { if (k === 'load') this._l.push(f); };
FakeXHR.prototype.send = function () { const a = FR24[regOf(this._u)] || [404, '']; setTimeout(() => { this.status = a[0]; this._body = a[1]; this.readyState = 4; if (this.onload) this.onload(); for (const f of this._l) f(); }, 20); };
Object.defineProperty(FakeXHR.prototype, 'responseText', { configurable: true, get() { return this._body; } });
Object.defineProperty(FakeXHR.prototype, 'response', { configurable: true, get() { return this.responseType === 'json' ? (this.readyState === 4 ? (() => { try { return JSON.parse(this._body); } catch (e) { return null; } })() : null) : this._body; } });
w.XMLHttpRequest = FakeXHR;
const posted = []; w.postMessage = d => posted.push(d);
w.unsafeWindow = w; w.GM_xmlhttpRequest = () => {};
const m = SRC.match(/function pageInterceptor\(\) \{[\s\S]*?\n {2}\}\n/);
if (!m) { console.log('FAIL  pageInterceptor not found in the build'); process.exit(1); }
w.eval('(' + m[0] + ')()');
const B = w.__tweeksLaddBridge;
// (the userscript's answer: the logs it keeps - as it hands them to the page)
const ours = n => Array.from({ length: n }, (_, i) => Object.assign(row(100 + i, 'N1876T'), { __tl: true }));
const give = (reg, n) => w.dispatchEvent(new w.MessageEvent('message', { data: { __tweeksLadd: 'hist', reg, data: ours(n) }, source: w }));
for (const r of ['N1876T', 'TCACN', 'MPORT', 'N50JE', 'EIDPR']) give(r, 4);

(async () => {
  await sleep(50);
  const viaFetch = async reg => { const r = await w.fetch(LIST(reg)); let j = null; try { j = await r.json(); } catch (e) { /* not JSON */ } return { st: r.status, j }; };
  const data = j => j && j.result && j.result.response && j.result.response.data;
  let a = await viaFetch('N1876T');
  check('fetch, FR24\'s usual answer with no flights: the log\'s flights in it, FR24\'s other fields kept', (data(a.j) || []).length === 4 && data(a.j)[0].__tl && a.j.result.response.aircraftInfo.model.text === 'Gulfstream G600' && a.j.result.response.item.current === 4, data(a.j) && data(a.j).length);
  a = await viaFetch('TCACN');
  check('fetch, no list in FR24\'s answer: one in FR24\'s shape, filled', (data(a.j) || []).length === 4 && a.st === 200 && a.j.result.request.query === 'TCACN', a);
  a = await viaFetch('MPORT');
  check('fetch, FR24 refusing (403): an answer in its shape, filled', (data(a.j) || []).length === 4 && a.st === 200, a.st);
  a = await viaFetch('N50JE');
  check('fetch, an answer that is not JSON: one in FR24\'s shape, filled', (data(a.j) || []).length === 4, a.st);
  a = await viaFetch('EIDPR');
  check('fetch, FR24\'s own list of an ordinary aircraft: left as it is', (data(a.j) || []).length === 3 && data(a.j).every(x => !x.__tl), (data(a.j) || []).map(x => x.identification.callsign));
  const t0 = Date.now(); a = await viaFetch('GUNKN');
  check('fetch, nothing known of the aircraft: FR24\'s answer as it is (after the userscript says so)', data(a.j) === null, Date.now() - t0);
  check('... the last list asked for noted for diagnosis (FR24\'s rows, ours)', !!B.stats.lastList && B.stats.lastList.reg === 'GUNKN' && B.stats.lastList.fr24 === 0, B.stats.lastList);
  // (with XHR)
  const viaXhr = (reg, type) => new Promise(res => { const x = new w.XMLHttpRequest(); x.responseType = type || ''; x.open('GET', LIST(reg)); x.onload = () => res(x); x.send(); });
  let x = await viaXhr('N1876T');
  let jx = JSON.parse(x.responseText);
  check('XHR, FR24\'s usual answer with no flights: the log\'s flights in it', (data(jx) || []).length === 4 && data(jx)[0].__tl, data(jx) && data(jx).length);
  x = await viaXhr('TCACN', 'json');
  check('XHR (responseType json), no list in FR24\'s answer: one in FR24\'s shape, filled', (data(x.response) || []).length === 4, x.response);
  x = await viaXhr('EIDPR');
  jx = JSON.parse(x.responseText);
  check('XHR, FR24\'s own list: left as it is', (data(jx) || []).length === 3 && data(jx).every(r => !r.__tl));
  check('... and the log asked of the userscript as the request went (FR24\'s list never waits for it)', posted.some(d => d && d.__tweeksLadd === 'needHist'));
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  CRASH ' + (e && e.stack || e)); process.exit(1); });
