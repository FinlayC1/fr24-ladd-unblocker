// The whole test suite, on any OS: builds dist/ first, then runs every unit test and the jsdom replays, and counts their
// PASS / FAIL lines. usage: node test/run-suite.cjs [--e2e] [--no-build] [--only name,name]
//   data:          monitor/data (airports.json, runways.json, runway_len.json, oa_airports.csv) - or DATA=<dir>
//   node_modules:  ./node_modules (npm install) - or NM=<dir>
//   --e2e:         also the live end-to-end runs (real FR24 / adsb.lol over the network, normal and Tampermonkey mode)
// Needs network for unit_new (FR24's own lists), panels and replay (public ADS-B). Exit code 1 on any failure.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const D = process.env.DATA || path.join(root, 'monitor', 'data');
const NM = process.env.NM || path.join(root, 'node_modules');
const oi = args.indexOf('--only'), only = oi >= 0 ? String(args[oi + 1] || '').split(',').filter(Boolean) : [];
for (const f of ['airports.json', 'runways.json', 'runway_len.json']) if (!fs.existsSync(path.join(D, f))) { console.error('missing data file ' + path.join(D, f)); process.exit(2); }
if (!fs.existsSync(path.join(NM, 'jsdom'))) { console.error('jsdom not found in ' + NM + ' - run npm install'); process.exit(2); }
const j = (...p) => path.join(...p);
const runs = [
  ['unit_engine', ['test/unit_engine.cjs', j(D, 'airports.json'), j(D, 'runways.json'), j(D, 'runway_len.json'), 'src/tables.json', 'src/logit.json']],
  ['unit_cases', ['test/unit_cases.cjs', D]], ['unit_heading', ['test/unit_heading.cjs', D]], ['unit_final', ['test/unit_final.cjs', D]], ['unit_legs', ['test/unit_legs.cjs', D]],
  ['unit_monitor', ['test/unit_monitor.cjs', D]], ['unit_monitor2', ['test/unit_monitor2.cjs', D]], ['unit_fr24', ['test/unit_fr24.cjs', D]], ['unit_store', ['test/unit_store.cjs', D]], ['unit_registry', ['test/unit_registry.cjs']], ['unit_merge', ['test/unit_merge.cjs', D]], ['unit_deploy', ['test/unit_deploy.cjs']], ['unit_admin', ['test/unit_admin.cjs', D]], ['unit_installs', ['test/unit_installs.cjs', D]], ['unit_dash', ['test/unit_dash.cjs', NM]], ['unit_names', ['test/unit_names.cjs', D]], ['unit_origin', ['test/unit_origin.cjs', j(D, 'airports.json')]],
  ['unit_flightmsg', ['test/unit_flightmsg.cjs', NM]], ['unit_new', ['test/unit_v2215.cjs', NM, D]], ['unit_monlive', ['test/unit_monlive.cjs', NM, D]], ['unit_panel', ['test/unit_panel.cjs', NM, D]], ['unit_window', ['test/unit_window.cjs', NM]], ['unit_window2', ['test/unit_window2.cjs', NM]], ['unit_hello', ['test/unit_hello.cjs', NM]], ['unit_native', ['test/unit_native.cjs']], ['unit_barlook', ['test/unit_barlook.cjs']], ['unit_mosttracked', ['test/unit_mosttracked.cjs', NM, D]], ['unit_histgap', ['test/unit_histgap.cjs', NM, D]], ['unit_photocache', ['test/unit_photocache.cjs', NM]], ['unit_recentlist', ['test/unit_recentlist.cjs', NM]], ['unit_recentfast', ['test/unit_recentfast.cjs', NM, D]], ['unit_photopage', ['test/unit_photopage.cjs', NM]], ['unit_pbnative', ['test/unit_pbnative.cjs']], ['unit_panelphoto', ['test/unit_panelphoto.cjs']], ['unit_vectoring', ['test/unit_vectoring.cjs', NM, D]], ['unit_boards', ['test/unit_boards.cjs', NM, D]], ['unit_dupes', ['test/unit_dupes.cjs', NM, D]], ['unit_places', ['test/unit_places.cjs', NM, D]], ['unit_padlocks', ['test/unit_padlocks.cjs', NM, D]], ['unit_public', ['test/unit_public.cjs', D]], ['unit_wx', ['test/unit_wx.cjs']], ['unit_extension', ['test/unit_extension.cjs']], ['unit_selfupdate', ['test/unit_selfupdate.cjs']], ['unit_tracks', ['test/unit_tracks.cjs', D]], ['unit_waiting', ['test/unit_waiting.cjs', D]], ['unit_shared', ['test/unit_shared.cjs', NM, D]], ['unit_playback', ['test/unit_playback.cjs', NM, D]], ['unit_pbends', ['test/unit_pbends.cjs', NM, D]], ['unit_pbbuttons', ['test/unit_pbbuttons.cjs', NM, D]], ['unit_logos', ['test/unit_logos.cjs', NM, D]], ['unit_recent', ['test/unit_recent.cjs', NM, D]], ['unit_photos', ['test/unit_photos.cjs', NM]], ['unit_ksk16', ['test/unit_ksk16.cjs', NM, D]], ['unit_gioos', ['test/unit_gioos.cjs', NM, D]], ['unit_n6012c', ['test/unit_n6012c.cjs', NM, D]],
  ['panels1', ['test/case_panel.cjs', NM, 'test/fixtures/panels/oct1.json']], ['panels2', ['test/case_panel.cjs', NM, 'test/fixtures/panels/oct2.json']],
  ['replay', ['test/replay_live.cjs', NM]]
];
if (args.includes('--e2e')) runs.push(['e2e', ['test/e2e.cjs', NM]], ['e2e_tm', ['test/e2e.cjs', NM], { TM_WRAP: '1' }]);
if (!args.includes('--no-build')) {
  const b = spawnSync(process.execPath, ['build.mjs'], { cwd: root, encoding: 'utf8' });
  if (b.status !== 0) { console.error('build failed\n' + b.stdout + b.stderr); process.exit(1); }
  console.log(b.stdout.trim().split('\n').pop());
}
let bad = 0;
for (const [name, argv, env] of runs) {
  if (only.length && !only.includes(name)) continue;
  if (!fs.existsSync(path.join(root, argv[0]))) { console.log(name.padEnd(15) + '(missing)'); continue; }
  const t0 = Date.now(), r = spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 20 * 60000, env: Object.assign({}, process.env, env || {}) });
  const out = (r.stdout || '') + (r.stderr || ''), pass = (out.match(/^\s*PASS/gm) || []).length, fail = (out.match(/^\s*FAIL/gm) || []).length;
  console.log(`${name.padEnd(15)}pass ${String(pass).padStart(4)}  fail ${String(fail).padStart(3)}  exit ${r.status}  ${Math.round((Date.now() - t0) / 1000)}s`);
  if (fail || r.status !== 0) { bad++; for (const l of out.split('\n').filter(x => /^\s*FAIL|Error|HARNESS/.test(x)).slice(0, 8)) console.log('    ' + l.slice(0, 400)); }
}
console.log(bad ? `\n${bad} run(s) with failures` : '\nall passed');
process.exit(bad ? 1 : 0);
