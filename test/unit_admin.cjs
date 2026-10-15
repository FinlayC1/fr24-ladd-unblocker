// The monitor's owner controls (/admin/*) over real HTTP: refused without the secret, with a wrong one, and on a monitor
// with none set; /admin/log gives the latest log lines with the secret blanked out; update and restart only by POST, and
// only where they can work (under systemd, a git checkout): update starts deploy.sh as a unit of its own through
// `sudo -n systemd-run`, its output to the store; restart saves and exits for systemd to start it again. /status and /stats
// give the monitor's version and commit, and the controls only to the owner.
// usage: node test/unit_admin.cjs [dataDir]
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawnSync } = require('child_process');
const DATA = process.argv[2] || path.join(__dirname, '../monitor/data');
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); };

// (each case in a process of its own: the monitor reads its settings once, when it is loaded)
if (process.env.ADMIN_CASE) {
  const M = require('../monitor/monitor.cjs');
  const port = +process.env.MON_PORT, out = [];
  const req = (p, { method = 'GET', token } = {}) => new Promise(res => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: token ? { 'X-Monitor-Token': token } : {} }, x => { let b = ''; x.on('data', c => { b += c; }); x.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* none */ } res({ s: x.statusCode, j }); }); });
    r.on('error', e => res({ s: 0, e: String(e) })); r.end();
  });
  let stopped = 0; M.ctl.stop = () => { stopped++; };
  M.serve();
  setTimeout(async () => {
    const T = process.env.MON_TOKEN;
    out.push(['noToken', await req('/admin/log')], ['wrong', await req('/admin/log', { token: 'nope' })]);
    M.log('a line with the secret', T || 'none', 'in it');
    out.push(['log', await req('/admin/log?n=5', { token: T })]);
    out.push(['getRestart', await req('/admin/restart', { token: T })]);
    out.push(['update', await req('/admin/update', { method: 'POST', token: T })]);
    out.push(['update2', await req('/admin/update', { method: 'POST', token: T })]);
    out.push(['restart', await req('/admin/restart', { method: 'POST', token: T })]);
    out.push(['status', await req('/status')], ['statusOwner', await req('/status', { token: T })]);
    await new Promise(r => setTimeout(r, 800));
    out.push(['stopped', stopped]);
    process.stdout.write('\nRESULT ' + JSON.stringify(Object.fromEntries(out)) + '\n');
    process.exit(0);
  }, 300);
  return;
}
function run(env) {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'monadm-'));
  const e = Object.assign({}, process.env, { ADMIN_CASE: '1', MON_DATA: DATA, MON_STORE: store, MON_PORT: String(43000 + Math.floor(Math.random() * 5000)), MON_RATE: '0' }, env);
  for (const k of Object.keys(e)) if (e[k] === null) delete e[k];
  const r = spawnSync(process.execPath, [__filename], { env: e, encoding: 'utf8', timeout: 60000 });
  const m = (r.stdout || '').match(/RESULT (.+)/);
  if (!m) { console.log('FAIL  case crashed', (r.stderr || r.stdout || '').slice(-800)); fails++; return {}; }
  return Object.assign(JSON.parse(m[1]), { store });
}
// a stand-in for sudo: writes what it was asked to do (and fails when told to)
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'monadm-bin-')), argsFile = path.join(bin, 'args');
fs.writeFileSync(path.join(bin, 'sudo'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n[ -n "$SUDO_FAIL" ] && { echo "sudo: a password is required" >&2; exit 1; }\nexit 0\n`, { mode: 0o755 });

// ---- not under systemd: the log, no update or restart
{
  const R = run({ MON_TOKEN: 'sekrit-1', INVOCATION_ID: null });
  check('/admin/* refused without the secret and with a wrong one', R.noToken && R.noToken.s === 401 && R.wrong.s === 401);
  const lines = (R.log && R.log.j && R.log.j.lines) || [];
  check('/admin/log: the latest log lines, at most n, the secret blanked out', R.log.s === 200 && lines.length >= 1 && lines.length <= 5 && lines.some(l => /a line with the secret \[secret\] in it/.test(l)) && !JSON.stringify(R.log.j).includes('sekrit-1'), lines);
  check('... and which controls work here: none, not under systemd', R.log.j.controls && R.log.j.controls.update === false && R.log.j.controls.restart === false);
  check('a GET of /admin/restart does nothing (404)', R.getRestart.s === 404 && R.stopped === 0);
  check('update and restart refused, saying why, and nothing stopped', R.update.j && R.update.j.ok === false && /systemd/.test(R.update.j.err) && R.restart.j && R.restart.j.ok === false && R.stopped === 0, [R.update.j, R.restart.j]);
  const ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  check('/status gives the monitor\'s version and commit; the controls only to the owner', R.status.j.ver === ver && /^[0-9a-f]{7,}$/.test(R.status.j.commit || '') && !('controls' in R.status.j) && R.statusOwner.j.controls && 'update' in R.statusOwner.j.controls, [R.status.j.ver, R.status.j.commit]);
}
// ---- under systemd, a git checkout: update through sudo -n systemd-run, restart saves and exits
{
  const R = run({ MON_TOKEN: 'sekrit-2', INVOCATION_ID: 'abc', PATH: bin + path.delimiter + process.env.PATH });
  const a = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim().split('\n') : [];
  check('update: started, as a unit of its own (sudo -n systemd-run --collect), deploy.sh, its output to the store', R.update.j && R.update.j.ok === true && a[0] === '-n' && a[1] === 'systemd-run' && a.includes('--collect') && a.some(x => /^StandardOutput=truncate:.*deploy-last\.log$/.test(x)) && /monitor\/deploy\.sh$/.test(a[a.length - 1]) && a.includes('--uid'), a);
  check('... the secret is not among its arguments', !a.join(' ').includes('sekrit-2'));
  check('... a second update while the first runs is refused', R.update2.j && R.update2.j.ok === false && /already/.test(R.update2.j.err));
  check('restart: answered, then saved and stopped once (systemd starts it again)', R.restart.j && R.restart.j.ok === true && R.stopped === 1);
  check('/admin/log offers both controls here', R.log.j.controls.update === true && R.log.j.controls.restart === true);
}
// ---- sudo refusing: the update says so, and can be asked again
{
  fs.rmSync(argsFile, { force: true });
  const R = run({ MON_TOKEN: 'sekrit-3', INVOCATION_ID: 'abc', SUDO_FAIL: '1', PATH: bin + path.delimiter + process.env.PATH });
  check('sudo refused: the update answers ok:false with sudo\'s reason, and a second ask tries again', R.update.j && R.update.j.ok === false && /password is required/.test(R.update.j.err) && R.update2.j && /password is required/.test(R.update2.j.err), [R.update.j, R.update2.j]);
}
// ---- no secret set: no controls at all
{
  const R = run({ MON_TOKEN: null, INVOCATION_ID: 'abc', PATH: bin + path.delimiter + process.env.PATH });
  check('a monitor with no secret set offers no controls (401), even to its own computer', R.noToken.s === 401 && R.log.s === 401 && R.update.s === 401 && R.restart.s === 401 && R.stopped === 0);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
