// (1.1.3) The dashboard's console and file browser (monitor/console.cjs, /admin/cmd, /admin/files): the monitor's own
// commands, PowerShell's names for them too; the store and data folders read, nothing outside them - not by "..", not by
// a link out of them; a gzipped file shown unpacked, a binary one as hex; and /status's figure of aircraft in view a
// number again (1.1.1 put the aircraft database's state over it: "[object Object]" on the dashboard).
// usage: node test/unit_console.cjs [data dir]
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
process.env.MON_DATA = DATA;
const STORE = process.env.MON_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'moncon-'));
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 500) : '')); };

(async () => {
  fs.mkdirSync(path.join(STORE, 'boards'), { recursive: true });
  fs.writeFileSync(path.join(STORE, 'note.json'), JSON.stringify({ a: 1, b: [2, 3] }));
  fs.writeFileSync(path.join(STORE, 'boards', 'day.json.gz'), zlib.gzipSync('{"hello":"board"}\n'));
  fs.writeFileSync(path.join(STORE, 'bin.dat'), Buffer.from([0, 1, 2, 3, 255]));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'monout-')); fs.writeFileSync(path.join(outside, 'secret.txt'), 'not yours');
  try { fs.symlinkSync(outside, path.join(STORE, 'link')); } catch (e) { /* no links here */ }
  const M = require('../monitor/monitor.cjs');
  const A = (p, method, q, body) => Promise.resolve(M.adminAnswer(p, method, k => (q || {})[k] || null, body));
  const top = await A('/admin/files', 'GET', {});
  check('Files: the two folders at the top - the store and the data', JSON.stringify((top.dir || []).map(d => d[0])) === '["store","data"]', top);
  const st = await A('/admin/files', 'GET', { path: 'store' });
  check('... the store\'s entries: folders first, each with its size and time', (st.dir || [])[0] && st.dir[0][1] === true && st.dir.some(d => d[0] === 'note.json' && d[2] > 0 && d[3] > 0), st.dir);
  const js = await A('/admin/files', 'GET', { path: 'store/note.json' });
  check('... a JSON file laid out', js.file && js.file.kind === 'json' && /"b": \[/.test(js.file.text), js.file);
  const gz = await A('/admin/files', 'GET', { path: 'store/boards/day.json.gz' });
  check('... a gzipped one unpacked', gz.file && /hello/.test(gz.file.text) && gz.file.kind !== 'binary', gz.file);
  const bin = await A('/admin/files', 'GET', { path: 'store/bin.dat' });
  check('... a binary one as hex', bin.file && bin.file.kind === 'binary' && /00 01 02 03 ff/.test(bin.file.text), bin.file);
  for (const bad of ['store/../../etc/passwd', '../etc', 'store/link/secret.txt', '/etc/passwd', 'etc']) {
    const r = await A('/admin/files', 'GET', { path: bad });
    check(`... nothing outside them: "${bad}"`, !!r.err && !r.file && !r.dir, r);
  }
  const run = async line => (await A('/admin/cmd', 'POST', {}, JSON.stringify({ line }))) || {};
  const help = await run('help');
  check('Console: "help" lists the commands', /status/.test(help.out) && /get-childitem/.test(help.out) && !help.err, help.out && help.out.slice(0, 200));
  const ls = await run('Get-ChildItem store');
  check('... PowerShell\'s Get-ChildItem lists a folder', /note\.json/.test(ls.out) && /boards\//.test(ls.out), ls.out);
  const cat = await run('gc store/note.json');
  check('... gc (Get-Content) shows a file', /"a": 1/.test(cat.out), cat.out);
  const esc = await run('cat store/../../etc/passwd');
  check('... and never one outside', /not inside/.test(esc.out) && !/root:/.test(esc.out), esc.out);
  const stat = await run('status owners');
  check('... "status owners": one part of /status', /"known"/.test(stat.out), stat.out && stat.out.slice(0, 120));
  const ps = await run('Get-Process');
  check('... Get-Process: memory and version', /"rss"/.test(ps.out) && /"version"/.test(ps.out), ps.out);
  const unk = await run('rm -rf /');
  check('... anything else refused - never a shell', unk.err && /not a command/.test(unk.out), unk);
  const cls = await run('cls');
  check('... cls clears the screen', cls.clear === true);
  const lag = await run('lag');
  check('... "lag": the main loop\'s lag over the last minute', /"maxMs"/.test(lag.out) && /"p95Ms"/.test(lag.out), lag.out);
  const pr = await run('profile 5'), pf = fs.existsSync(path.join(STORE, 'profiles')) ? fs.readdirSync(path.join(STORE, 'profiles')) : [];
  check('... "profile 5": what it spends its time on, the whole profile kept in store/profiles/', /5 s profiled - busy/.test(pr.out) && /its own time:/.test(pr.out) && pf.some(f => /\.cpuprofile$/.test(f)) && JSON.parse(fs.readFileSync(path.join(STORE, 'profiles', pf[0]), 'utf8')).nodes.length > 0, { out: pr.out && pr.out.slice(0, 200), pf });
  const s = M.answer(new URL('http://x/status'), Date.now() / 1000, { admin: true });
  check('/status: aircraft in view a number again; the aircraft database under "acdb"', typeof s.aircraft === 'number' && !!s.acdb && 'builtAt' in s.acdb && !!s.loop && 'maxMs' in s.loop, { aircraft: s.aircraft, acdb: s.acdb && Object.keys(s.acdb) });
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed', e && e.stack || e); process.exit(1); });
