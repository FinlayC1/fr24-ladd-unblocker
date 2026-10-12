// Step a fixture trace (test/fixtures/legs/<hex>/<day>_lol|apl) through the learned arrival paths: at each fix, the
// cell's airport, its share and traffic, and whether approachPath (two fixes on it) fires.
// usage: node test/appr_step.cjs <dataDir> <table.json> <hex> <day> <from HH:MM> <to HH:MM>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { createRouteEngine } = require('../src/engine.js');
const [dataDir, tableFile, hex, day, from, to] = process.argv.slice(2);
const E = createRouteEngine();
E.setAirports(JSON.parse(fs.readFileSync(path.join(dataDir, 'airports.json'), 'utf8')).rows);
const t = JSON.parse(fs.readFileSync(tableFile, 'utf8'));
E.setApproach({ bin: t.bin, cells: new Map(Object.entries(t.cells).map(([k, v]) => [+k, v])) });
const rd = s => { const f = path.join(__dirname, 'fixtures/legs', hex, `${day}_${s}.json.gz`); return fs.existsSync(f) ? E.parseTrace(JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()) || {}) : []; };
const pts = E.mergePoints(rd('lol'), rd('apl')), cls = process.env.CLS || 'heavybiz';
const t0 = Date.parse(day + 'T' + from + 'Z') / 1000, t1 = Date.parse(day + 'T' + to + 'Z') / 1000;
let last = 0;
for (let i = 0; i < pts.length; i++) {
  const p = pts[i]; if (p.t < t0 || p.t > t1 || p.t - last < 15) continue; last = p.t;
  const c = E.approachCell(p, cls), ap = E.approachPath(p, pts.slice(Math.max(0, i - 40), i), cls);
  const code = a => a.iata || a.icao;
  console.log(new Date(p.t * 1000).toISOString().slice(11, 19), p.alt, 'trk', Math.round(p.trk || 0), '| cell', c ? `${code(c.airport)} ${(c.share * 100).toFixed(0)}% of ${c.n}` : '-', '| path', ap ? `${code(ap.airport)} ${ap.dist.toFixed(0)} km` : '-');
}
