// A monitor for the browser tests (1.1.0: every route is worked out on the monitor - the script has no tables): the real
// central calculation (monitor/central.cjs), on this thread, with an engine set up as the monitor's own and the tables,
// answering /status (central calculation on) and POST /calc as the monitor does. Its aircraft logs: logOf(hex) - a test
// gives it the logs the browser has, as the monitor would have them.
//   const fake = await createFakeMonitor({ data, logOf, base: 'https://mon.test' });
//   in the window's request router: const a = fake.answer(url, o); if (a) return a;   // [status, text] or null
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { createRouteEngine } = require(path.join(ROOT, 'src', 'engine.js'));
const C = require(path.join(ROOT, 'monitor', 'central.cjs'));

async function createFakeMonitor(o) {
  o = o || {};
  const data = o.data || path.join(ROOT, 'monitor', 'data'), base = o.base || 'https://mon.test';
  const E = createRouteEngine(), rd = f => { const p = path.join(data, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  E.setAirports(rd('airports.json').rows);
  const rw = rd('runways.json'); if (rw) E.setRunways(rw);
  const rl = rd('runway_len.json'); if (rl) E.setRunwayLengths(rl);
  if (fs.existsSync(path.join(data, 'oa_airports.csv'))) E.setFields(require('./dataset.cjs').loadFields(data));
  const central = C.createCentral({ E, logOf: hex => (o.logOf ? o.logOf(hex) : []) || [], cfg: { msPerMin: 1e9, every: 0, histMin: 0 } });
  const st = await central.start({ free: 8e9, srcDir: path.join(ROOT, 'src'), mainDir: path.join(ROOT, 'src', 'main'), sitesCsv: o.sites === false ? '' : path.join(data, 'oa_airports.csv') });
  if (!st.on) throw new Error('central calculation did not start: ' + st.why);
  const fake = {
    E, central, on: true, posts: [], extra: o.extra || null,
    // (a request to the monitor: its answer - null for anything else)
    answer(url, req) {
      if (!String(url).startsWith(base + '/')) return null;
      const u = new URL(url);
      if (u.pathname === '/status') return [200, JSON.stringify(Object.assign({ v: 3, since: Date.now() - 3600e3, public: true, ver: '1.1.0', central: { on: fake.on } }, o.status || {}))];
      if (u.pathname === '/calc') {
        const b = JSON.parse((req && (req.data || req.body)) || '{}'); fake.posts.push(b);
        if (!fake.on) return [200, JSON.stringify({ v: 1, on: false, routes: {}, full: [] })];
        return [200, JSON.stringify(central.answer(b))];
      }
      if (fake.extra) { const a = fake.extra(u, req); if (a) return a; }
      return [404, ''];
    }
  };
  return fake;
}
// (the tables the monitor works routes out with, into an engine - the browser's own, in a test of the route code the monitor
// runs: the same code, the tables as the monitor loads them from src/)
const tablesInto = E => C.loadTables(E, path.join(ROOT, 'src'), path.join(ROOT, 'src', 'main'));
module.exports = { createFakeMonitor, tablesInto };
