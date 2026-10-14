// monitor/merge-store.cjs: the home PC's store merged into the server's - every flight of both, one copy of a flight both
// heard (the more complete one), blocked aircraft of both, the server's running state kept; refuses while the monitor runs.
// usage: node test/unit_merge.cjs
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const MS = require('../monitor/merge-store.cjs');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const tmp = n => fs.mkdtempSync(path.join(os.tmpdir(), n));
const now = Math.floor(Date.now() / 1000), day = t => new Date(t * 1000).toISOString().slice(0, 10);
const T = now - 5 * 86400;   // a flight five days ago
const leg = (hex, t0, dur, o) => Object.assign({ hex, reg: 'X', type: 'GLF6', ladd: true, tStart: t0, tOff: t0 + 60, tEnd: t0 + dur, from: { id: 1, code: 'AAA', conf: 'ground' }, to: { id: 2, code: 'BBB', conf: 'ground' }, ended: true, open: false }, o);
const put = (dir, f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o));
(async () => {
  const home = tmp('home-'), vm = path.join(tmp('vm-'), 'store'); fs.mkdirSync(vm);
  // the home PC: an old day only it has, a flight the server also heard (home: ended, both ends; server: open, no end),
  // a flight the server heard better (home: no destination), and a flight older than 90 days
  put(home, `legs-${day(T - 3 * 86400)}.json`, [leg('aaaaa1', T - 3 * 86400, 3600)]);
  put(home, `legs-${day(T)}.json`, [leg('aaaaa2', T, 5400), leg('aaaaa3', T + 7200, 3000, { to: null, ended: false })]);
  put(home, `legs-${day(now - 100 * 86400)}.json`, [leg('aaaaa4', now - 100 * 86400, 3000)]);
  put(home, 'state.json', { v: 1, lastRun: now - 3 * 86400, blocked: { aaaaa1: ['N1', 'GLF6', T - 9 * 86400, T, 1], aaaaa2: ['N2', '', T - 9 * 86400, T + 5400, 0, T - 86400], h00001: ['M-HOME', 'PC24', T - 8 * 86400, T - 86400, 0] }, areas: [[40, -74, 250, now - 4 * 86400]] });
  // the server: its own day, the copies above (a few minutes off - another take-off slot), its running state
  put(vm, `legs-${day(T)}.json`, [leg('aaaaa2', T + 200, 1200, { to: null, ended: false, open: true, tOff: T + 700 }), leg('aaaaa3', T + 7100, 3200, { tOff: T + 7160 })]);
  put(vm, `legs-${day(now - 86400)}.json`, [leg('bbbbb1', now - 86400, 2000)]);
  const vmState = { v: 2, lastRun: now - 60, blocked: { aaaaa2: ['', 'GLF6', T - 2 * 86400, T + 9000, 1], bbbbb1: ['N3', 'C68A', now - 2 * 86400, now - 86000, 1] }, areas: [[53, -2, 250, now - 100]], watch: { [day(now - 86400)]: { ladd: [1, 2, 3] } }, lastW: { ladd: now - 60 }, closed: day(now - 2 * 86400), flew: {}, histQ: [['bbbbb1', day(now - 86400), 0, 0]] };
  put(vm, 'state.json', vmState);
  fs.mkdirSync(path.join(vm, 'hist')); put(path.join(vm, 'hist'), 'bbbbb1.json', { hv: 5, days: {}, legs: [] });
  const before = fs.readFileSync(path.join(vm, `legs-${day(T)}.json`), 'utf8');
  // (a dry run writes nothing)
  const log0 = console.log; let out = ''; console.log = (...a) => { out += a.join(' ') + '\n'; };
  let rc = await MS.main([home, vm, '--dry-run']);
  console.log = log0;
  check('dry run: counts, nothing written', rc === 0 && /dry run/.test(out) && fs.readFileSync(path.join(vm, `legs-${day(T)}.json`), 'utf8') === before, out);
  // (the monitor running: refused)
  const srv = net.createServer(() => {}); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.MON_PORT = String(srv.address().port);
  console.log = () => {}; rc = await MS.main([home, vm]); console.log = log0;
  check('refused while the monitor answers on its port', rc === 3 && fs.readFileSync(path.join(vm, `legs-${day(T)}.json`), 'utf8') === before);
  srv.close(); process.env.MON_PORT = '1';
  console.log = () => {}; rc = await MS.main([home, vm]); console.log = log0;
  const all = fs.readdirSync(vm).filter(f => /^legs-/.test(f)).flatMap(f => JSON.parse(fs.readFileSync(path.join(vm, f), 'utf8')));
  const of = h => all.filter(l => l.hex === h);
  check('merged: exit 0', rc === 0);
  check('a day only the home PC had: its flight kept', of('aaaaa1').length === 1);
  check('a flight both heard: one copy, the more complete (home: landed, both ends)', of('aaaaa2').length === 1 && !!of('aaaaa2')[0].to && of('aaaaa2')[0].ended === true, of('aaaaa2'));
  check('... and the other way round (the server\'s, with its destination)', of('aaaaa3').length === 1 && !!of('aaaaa3')[0].to && of('aaaaa3')[0].tStart === T + 7100, of('aaaaa3'));
  check('the server\'s own flights all kept', of('bbbbb1').length === 1);
  check('flights older than 90 days not carried over', of('aaaaa4').length === 0);
  check('each flight in the file of the day it took off', fs.readdirSync(vm).filter(f => /^legs-/.test(f)).every(f => JSON.parse(fs.readFileSync(path.join(vm, f), 'utf8')).every(l => day(l.tOff || l.tStart) === f.slice(5, 15))));
  const st = JSON.parse(fs.readFileSync(path.join(vm, 'state.json'), 'utf8'));
  check('blocked aircraft of both', ['aaaaa1', 'aaaaa2', 'bbbbb1', 'h00001'].every(h => st.blocked[h]), Object.keys(st.blocked));
  const b2 = st.blocked.aaaaa2;
  check('... one known to both: known since the earlier, last heard the later, its registration from either, on the FAA list as the later one has it, last seen with the flag the later', b2[0] === 'N2' && b2[1] === 'GLF6' && b2[2] === T - 9 * 86400 && b2[3] === T + 9000 && b2[4] === 1 && b2[5] === T - 86400, b2);
  check('the server\'s running state as it was (last run, areas, days watched, days to rebuild)', st.lastRun === vmState.lastRun && JSON.stringify(st.areas) === JSON.stringify(vmState.areas) && JSON.stringify(st.watch) === JSON.stringify(vmState.watch) && st.closed === vmState.closed && JSON.stringify(st.histQ) === JSON.stringify(vmState.histQ));
  check('its rebuilt logs untouched', fs.existsSync(path.join(vm, 'hist', 'bbbbb1.json')));
  const bak = fs.readdirSync(path.dirname(vm)).find(f => f.startsWith('store-before-merge-'));
  check('a copy of the store as it was kept beside it', !!bak && fs.readFileSync(path.join(path.dirname(vm), bak, `legs-${day(T)}.json`), 'utf8') === before && fs.existsSync(path.join(path.dirname(vm), bak, 'state.json')), bak);
  // (merging the same home store again changes nothing)
  const snap = JSON.stringify(all.map(l => [l.hex, l.tStart]).sort());
  console.log = () => {}; await MS.main([home, vm]); console.log = log0;
  const again = fs.readdirSync(vm).filter(f => /^legs-/.test(f)).flatMap(f => JSON.parse(fs.readFileSync(path.join(vm, f), 'utf8')));
  check('merging the same store twice: nothing doubled', JSON.stringify(again.map(l => [l.hex, l.tStart]).sort()) === snap);
  // (the merged store loads in the monitor as its own)
  process.env.MON_STORE = vm; process.env.MON_DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
  const M = require('../monitor/monitor.cjs');
  const st2 = M.loadState();
  check('the monitor reads the merged state', !!st2 && M.blocked.has('h00001') && M.blocked.get('aaaaa2').faa === true && M.histQ.length === 1);
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed ' + (e && e.stack || e)); process.exit(1); });
