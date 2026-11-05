// (1.2.4) A local sortie with nothing on record of the aircraft: G-POLV, a police Partenavia P68 out of East Midlands on
// 4 Nov (adsb.lol's trace), orbiting 25-65 km north of it from 21:19. FR24 gives its origin; the monitor's calculation (the
// userscript's own route code, as central runs it) has no history of it. Before 1.2.4: East Midlands 22-39%, behind a
// private strip and Retford Gamston. Now: back to East Midlands from the first quarter of an hour - an aircraft orbiting
// near where it took off is on a local flight.
// usage: node test/unit_local.cjs [data dir]
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const DATA = process.argv[2] || path.join(__dirname, '../monitor/data'), ROOT = path.join(__dirname, '..');
process.env.MON_DATA = DATA; process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'monlocal-'));
const M = require('../monitor/monitor.cjs'), C = require('../monitor/central.cjs');
M.loadEngine();
const E = M.E;
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const J = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/legs/4078a3/2026-11-04_lol.json.gz'))).toString());
const ema = E.byIcao('EGNX'), at = s => Date.parse('2026-11-04T' + s + 'Z') / 1000;
const out = p => JSON.parse(JSON.stringify(p, (k, v) => typeof v === 'number' && !isFinite(v) ? undefined : v));
(async () => {
  const cen = C.createCentral({ E, now: () => Date.now(), logOf: () => [] });
  await cen.start({ free: 4e9, srcDir: path.join(ROOT, 'src'), mainDir: path.join(ROOT, 'src/main'), sitesCsv: path.join(DATA, 'oa_airports.csv') });
  const got = [];
  for (const [k, s] of ['21:30:00', '21:45:00', '22:06:57', '22:30:00'].entries()) {
    const cut = at(s), shift = Math.floor(Date.now() / 1000) - cut;
    const j = Object.assign({}, J, { timestamp: J.timestamp + shift, trace: J.trace.filter(p => J.timestamp + p[0] <= cut) });
    const tr = []; for (const p of E.parseTrace(j)) if (!tr.length || p.t - tr[tr.length - 1].t >= 15) tr.push(p);
    cen.take({ id: 7100 + k, hex: '4078a3', kind: 'pub', ac: { reg: 'G-POLV', type: 'P68', cs: 'UKP155', country: 'United Kingdom' }, pos: out(tr[tr.length - 1]), trail: { full: true, pts: out(tr) }, plan: { originId: ema.id, fr24: true } });
    const r = cen.compute(cen.flights.get(7100 + k));
    got.push([s, r && r.destIata, r && r.destP]);
  }
  check('G-POLV orbiting north of East Midlands, nothing on record of it: back to East Midlands at 21:30, 21:45, 22:07 and 22:30, 65% and more', got.every(g => g[1] === 'EMA' && g[2] >= 65), got);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
