// monitor/deploy.sh against a throwaway git origin, with sudo / systemctl / curl / journalctl stand-ins: nothing new ->
// no restart; a new commit -> fast-forward, restart, checked with the service's secret (never printed); a new commit that
// does not answer, or does not parse -> back to the commit before. Needs bash and git (skipped on Windows).
// usage: node test/unit_deploy.cjs
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');
if (process.platform === 'win32') { console.log('(skipped on Windows: needs bash)'); process.exit(0); }
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-')), bin = path.join(T, 'bin'), logf = path.join(T, 'calls.log'), okf = path.join(T, 'answers');
fs.mkdirSync(bin);
const sh = (name, body) => { fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\n' + body + '\n'); fs.chmodSync(path.join(bin, name), 0o755); };
sh('sudo', 'exec "$@"');
sh('systemctl', `echo "systemctl $*" >> "${logf}"; if [ "$1" = show ]; then echo "MON_HOST=127.0.0.1 MON_TOKEN=s3cr3t-token MON_RATE=120"; fi; exit 0`);
sh('journalctl', 'echo "journal line"');
sh('curl', `for a in "$@"; do case "$a" in X-Monitor-Token:*) echo "curl $a" >> "${logf}";; esac; done; if [ -f "${okf}" ]; then printf 200; else printf 000; fi`);
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) }).trim();
const root = path.join(__dirname, '..'), work = path.join(T, 'work'), origin = path.join(T, 'origin.git'), vm = path.join(T, 'vm');
// (a repository with the files deploy.sh checks)
fs.mkdirSync(work);
git(work, 'init', '-q', '-b', 'main');
for (const f of ['monitor/monitor.cjs', 'monitor/fr24.cjs', 'monitor/ident.cjs', 'monitor/dest.cjs', 'monitor/owners.cjs', 'monitor/airport.cjs', 'monitor/names.cjs', 'monitor/tel.cjs', 'monitor/tracks.cjs', 'monitor/merge-store.cjs', 'monitor/deploy.sh', 'src/engine.js', 'src/registry.js', 'test/dataset.cjs']) { fs.mkdirSync(path.join(work, path.dirname(f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(work, f)); }
git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'v1');
execFileSync('git', ['clone', '-q', '--bare', work, origin]);
execFileSync('git', ['clone', '-q', origin, vm]);
git(work, 'remote', 'add', 'origin', origin);
const run = (...args) => { fs.writeFileSync(logf, ''); const r = spawnSync('bash', [path.join(vm, 'monitor/deploy.sh'), ...args], { encoding: 'utf8', env: Object.assign({}, process.env, { FR24_JOURNALD_DIR: path.join(T, 'journald.conf.d'), PATH: bin + ':' + process.env.PATH, DEPLOY_WAIT: '8' }), timeout: 300000 }); return { code: r.status, out: r.stdout + r.stderr, calls: fs.readFileSync(logf, 'utf8') }; };
const commit = (msg, edit) => { edit(); git(work, 'commit', '-q', '-am', msg); git(work, 'push', '-q', 'origin', 'main'); return git(work, 'rev-parse', 'HEAD'); };
const head = () => git(vm, 'rev-parse', 'HEAD');
const v1 = head();
fs.writeFileSync(okf, '1');
let r = run();
check('nothing new: no restart', r.code === 0 && /already up to date/.test(r.out) && !/restart/.test(r.calls), r);
const v2 = commit('v2', () => fs.appendFileSync(path.join(work, 'monitor/monitor.cjs'), '\n// v2\n'));
r = run();
check('a new commit: fast-forwarded, restarted, checked with the service\'s secret', r.code === 0 && head() === v2 && /systemctl restart fr24-monitor/.test(r.calls) && /curl X-Monitor-Token: s3cr3t-token/.test(r.calls) && /OK - the monitor answers/.test(r.out), r.out);
check('... the secret never printed', !/s3cr3t/.test(r.out));
check('... the system log limited to 14 days (once)', fs.readFileSync(path.join(T, 'journald.conf.d', 'fr24-retention.conf'), 'utf8').includes('MaxRetentionSec=14day') && /systemctl restart systemd-journald/.test(r.calls));
fs.unlinkSync(okf);
const v3 = commit('v3', () => fs.appendFileSync(path.join(work, 'monitor/monitor.cjs'), '\n// v3\n'));
r = run();
check('a new commit that does not answer: back to the one before, restarted again, exit 1', r.code === 1 && head() === v2 && (r.calls.match(/systemctl restart/g) || []).length === 2 && /back to/.test(r.out) && !/s3cr3t/.test(r.out), { code: r.code, head: head().slice(0, 7), v2: v2.slice(0, 7), v3: v3.slice(0, 7), out: r.out.slice(-400) });
fs.writeFileSync(okf, '1');
commit('v4 broken', () => fs.appendFileSync(path.join(work, 'monitor/monitor.cjs'), '\nfunction (\n'));
r = run();
check('a commit that does not parse: not restarted, back to the one before', r.code === 1 && head() === v2 && !/restart/.test(r.calls) && /does not parse/.test(r.out), r.out.slice(-300));
fs.appendFileSync(path.join(vm, 'monitor/monitor.cjs'), '// edited by hand\n');
r = run();
check('files changed by hand on the server: left alone, not updated', r.code === 1 && /changed by hand/.test(r.out) && head() === v2, r.out);
git(vm, 'checkout', '--', 'monitor/monitor.cjs');
r = run('--restart');
check('--restart with nothing new... (v4 still broken upstream: refused, stays)', r.code === 1 && head() === v2, r.out.slice(-200));
void v1;
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
