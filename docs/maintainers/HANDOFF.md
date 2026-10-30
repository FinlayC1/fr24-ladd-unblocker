# HANDOFF - FR24 LADD unblocker (written 14 Oct 2026 for the cloud session)

Read this file, then `docs/maintainers/notes/user-preferences.md` (the user's standing requirements) and
`docs/maintainers/notes/fr24-internals-and-history.md` (what earlier sessions learned about FR24's internals, version by version).

## 1. What this is

- **Userscript** "Flightradar24 LADD / N-A Unblocker" (Tampermonkey). Source in `src/`, built into
  `dist/fr24-ladd-unblocker.user.js` by `build.mjs`. It identifies blocked (FAA LADD, FR24-hidden, PIA, military) and
  "N/A" flights on flightradar24.com from public ADS-B and writes identity, routes, predicted destinations, boards,
  logs and search results straight into FR24's own UI so they look native.
- **Permanent monitor** `monitor/monitor.cjs` (Node, no dependencies; uses `src/engine.js`). Polls adsb.lol all the
  time, rebuilds flight legs, keeps them (90 days blocked aircraft, 4 days others) and answers the userscript over HTTP.

## 2. Layout

| Path | What |
|---|---|
| `build.mjs` | header + `src/page.js` + `src/engine.js` + tables + `src/main/NN-*.js` (sorted) -> dist |
| `src/header.js` | userscript header: `@version`, `@connect` hosts (Tampermonkey blocks any host not listed) |
| `src/page.js` | page-world interceptor: gRPC feed patches (LiveFeed, FollowFlight, Playback), fetch shims (search, boards, airport data pages, runways, movements), Pinia hooks |
| `src/engine.js` | route engine, shared by userscript and monitor |
| `src/main/01-core.js` | store, host lanes/`gmRequest`, monitor client (`monCheck`, `monGet`, shared monitor `monRemote`), `VERSION` |
| `src/main/02-resolver.js` | identification: candidate lists, LADD/mil lists, area polls, ocean ID, monitor `/seed` `/last` `/parked` |
| `src/main/03-data.js` | airports/airlines, `loadHistory` (aircraft logs from adsb.lol day traces), sites + OSM naming, registers |
| `src/main/04-routes.js` | routes, "Recent flights" |
| `src/main/05-ui.js`, `06-*.js`, `07-boot.js` | strip, pop-overs/tools, boards, log/flight pages, playback, boot + message routing + test exports (`window.__tweeksLadd`) |
| `monitor/monitor.cjs`, `monitor/dash.html` | monitor + its dashboard page |
| `monitor/data/` | airports.json, runways.json, runway_len.json, oa_airports.csv (monitor default data dir; tests use it too) |
| `test/` | `unit_*.cjs`, `case_panel.cjs`, `replay_live.cjs`, `e2e.cjs`, `perf.cjs`, fixtures, `run-suite.cjs` |

## 3. Build, lint, test

```
npm install
npm run build          # dist/fr24-ladd-unblocker.user.js
npm run lint           # must report 0 errors (warnings are fine)
npm test               # test/run-suite.cjs: build + all unit tests + jsdom replays
npm run test:all       # + e2e against live FR24 / adsb.lol, normal and Tampermonkey mode (TM_WRAP=1)
node test/perf.cjs node_modules 120     # stalls over 50 ms in 2 min of map use; E2E_SRC=<other build> for an A/B
```

State at handoff (14 Oct, Windows): every unit test passes (unit_new 41/41, unit_monitor 12/12, ...), replay 26/26,
e2e 129/129. Live-data flakes seen before (not script bugs): e2e "LADD + military list loaded" and "permanent monitor:
its LADD list is fresh" when adsb.lol answers 429; e2e "reload: the panel has the departure airport at once" depends on
the live aircraft picked; replay "METARs ..." when aviationweather.gov times out.
`unit_new`, `panels*`, `replay` and e2e need outbound network (flightradar24.com, api.flightradar24.com, api.adsb.lol,
adsb.lol, opendata.adsb.fi, globe.airplanes.live, overpass-api.de, aviationweather.gov). If the cloud environment
blocks them, say so plainly - never report a skipped test as passed.

## 4. Deployment state (14 Oct 2026)

**Userscript** v22.18.3, installed by the user in Tampermonkey on Windows (file `C:\Users\finla\OneDrive\Documents\==UserScript==.txt`;
previous versions kept as `==UserScript==.vX.Y.Z.backup.txt`). `dist/` is git-ignored. The cloud session cannot install
it - the user does. The strip's "Data sources" pop-over has a **Shared monitor** box (kv `monRemote` = {url, token});
it is set to the Oracle monitor and shows "in use".

**Oracle Cloud VM** (Always Free, user's account), the shared monitor:
- `VM.Standard.E2.1.Micro`: **1 GB RAM** (+2 GB swap file), small burstable CPU, 46 GB disk. Ubuntu 24.04, Node 18.19.1, git, Caddy 2.6. London AD-1.
- Public IP `143.47.224.210`. HTTPS by Caddy at **https://143-47-224-210.sslip.io** -> `127.0.0.1:47524`. `/etc/caddy/Caddyfile`:
  ```
  143-47-224-210.sslip.io {
      log
      reverse_proxy 127.0.0.1:47524
  }
  ```
- systemd `/etc/systemd/system/fr24-monitor.service`: `User=ubuntu`, `WorkingDirectory=/home/ubuntu/monitor`,
  `Environment=MON_HOST=127.0.0.1 MON_PORT=47524 MON_TOKEN=<secret> MON_RATE=120 MON_DATA=/home/ubuntu/monitor/data MON_STORE=/home/ubuntu/monitor/store`,
  `ExecStart=/usr/bin/node monitor.cjs`, `Restart=always`.
- `/home/ubuntu/monitor/` holds monitor.cjs (the 22.18 version with token + rate limit, **without** /dash), engine.js,
  dataset.cjs, data/. It is **not** a git checkout yet.
- Ports 22/80/443 open (Oracle security list + iptables saved with netfilter-persistent).
- **The secret (MON_TOKEN) is not in the repo. Never commit it, log it or put it in a URL** (Caddy logs URIs). The user can
  read it on the VM: `sudo grep MON_TOKEN /etc/systemd/system/fr24-monitor.service`.
- Verified 12 Oct: `/status` 200 with `X-Monitor-Token`, 401 without, 429 over MON_RATE; adsb.lol polling from the VM had 0 failures.

**Access:** the user runs all VM commands. The cloud session has no SSH key and must not ask for the private key. Give
exact single-line commands, one step at a time, and wait for the pasted output. The user is on Windows PowerShell
(paste = right-click):
**The live monitor is the Ampere A1 VM `fr24-monitor-a1` (79.72.69.41).** Log in there:
`ssh -o ServerAliveInterval=30 -i "$env:USERPROFILE\Downloads\ssh-key-2026-10-12.key" ubuntu@79.72.69.41`
(The old 1 GB micro VM `fr24-monitor`, 143.47.224.210, is not the live monitor - do not deploy to it.)

**Home PC monitor** `C:\Users\finla\OneDrive\Documents\FR24LaddMonitor\` (monitor.cjs now the /dash version, dash.html,
engine.js, dataset.cjs, data/, `store/` = `legs-2026-10-03.json` ... `legs-2026-10-11.json` + `state.json` with ~7,199
known blocked aircraft, start-monitor.vbs). **Not running and not auto-started** (the user never approved a startup task).
Its store and state should move to the VM.

## 4b. 22.19.0 (14 Oct, cloud session) - built and tested offline, NOT yet deployed or installed

- Monitor: polls adsb.lol `/v2/mil` (60 s) and `/v2/pia` (120 s; hourly after three 404s), adsb.fi `/api/v2/mil` while
  adsb.lol is paused or failing; blocked non-FAA aircraft by address every 60 s; hard cap `apiPerMin` 20 adsb.lol API
  requests/min (plus the 2 s gate). `/live` = every LADD/mil/PIA/blocked aircraft heard in 5 min (readsb rows,
  seen_pos counted to now, `_from`/`_off` of a flight under way, `age` of each list). SIGTERM saves (systemd stop).
- Monitor `/hist?hex=a,b` (20 max): blocked aircraft's finished days in the userscript's log format (summarizeLeg +
  `day` + `lx` learn fields), rebuilt from adsb.lol day traces (airplanes.live merged for incomplete days, as the
  browser does; refused -> day -1 = the browser reads it itself), one file per aircraft in `<store>/hist/`. Days the
  lists were watched throughout (no gap > 200 s) and the aircraft not heard airborne = 0 flights (FAA-list aircraft only
  if seen with the LADD flag within 14 days). Days close 3 h after midnight UTC; 404 retried 2-hourly for 36 h.
- Userscript: with a shared monitor set, 127.0.0.1 is never asked; `/live` every 20 s (idle slices) is the LADD/mil
  list - own adsb.lol/adsb.fi list requests only when the monitor's LADD list is > 90 s old (mil > 180 s: mil only);
  `loadHistory` takes the monitor's days for blocked aircraft first (batched, HIST_V must match).
- New: `monitor/merge-store.cjs`, `monitor/deploy.sh` (ff-only pull, node --check, restart, /status check, rollback),
  `monitor/vm-setup.sh` (systemd drop-in to run from the checkout, 700 MB heap, Caddy `encode zstd gzip`).
- Tests (offline, all pass, also on Node 18.19.1 for the monitor): unit_monitor2 33, unit_merge 16, unit_deploy 7,
  unit_monlive 24 (built userscript in jsdom: /live, fallbacks, /hist parity with the browser's own logs).
  NOT run here (network blocked in the cloud sandbox): unit_new, panels1/2, replay, e2e, perf.
- 22.19.1 backups (monitor): adsb.fi military list + v3 area query while adsb.lol is paused/failing; ADS-B Exchange
  (RapidAPI, only with MON_ADSBX_KEY in an EnvironmentFile, cap adsbxDaily 150/day) when adsb.fi fails too; OpenSky
  anonymous world snapshot (blocked hexes only, every 15 min max) while the LADD list is silent > 3 min. Not used:
  airplanes.live API (approval), ADSB One (dead), ADSBHub/TheAirTraffic (feed-only), avioadsb.org / ADSB IQ (unverified).
  Userscript: adsb.fi area v3 first, v2 fallback.
- Deployed 14 Oct ~18:05 UTC: VM runs ~/fr24-ladd (main-8o0480) via drop-in; home store merged (119,212 flights, 10,151
  blocked; backup store-before-merge-2026-10-14T18-03-07). Updates: bash ~/fr24-ladd/monitor/deploy.sh
- Optional rough destination on the monitor (plan step 9) NOT done.

## 4c. 22.20.0 and 22.21.0 (14 Oct, cloud session) - built and tested offline; deploy with deploy.sh

- 22.20.0: the monitor scans FR24's whole map (fr24.cjs, 7 regions quartered at the 1,500 limit, every 120 s), names every
  callsign-less flight (ident.cjs), gives each a rough destination (dest.cjs); `/fr24ids` (full on connect, then deltas
  every 20 s), `POST /report` (browser's feed headers, callsign-less flights, own names). 127.0.0.1 removed from the
  userscript. MV3 extension built into dist/extension + zip. LADD list every 10 s, hot blocked hexes every 30 s,
  `/live?since` deltas every 5 s.
- 22.21.0: permanent log (legs-*.json only ever added to; boards read old days from disk), `/learn` rows fed to the
  browser's engine, flights only FR24 sees logged (fr24Legs, trail fetched on landing), runway used per take-off and
  landing (airport.cjs), `/airport` (runway_info.json + freqs.json from monitor/mkdata.cjs), owners looked up once on
  the server (owners.cjs, src/registry.js shared with the browser, `/owners`, browsers report theirs), the map's airport
  panel filled (movements per day, runway usage, runway details + frequencies; Latest events and the coverage plea
  hidden), LADD/PIA/MIL flags sticky and learned from every source (the OK-VOS "ADS-B" tag).
- Repository: banner/icon (docs/assets), download-style README, LICENSE (personal use), NOTICE, PRIVACY, docs/legal.md,
  GitHub workflows (tests on push; release of each new version once the tests pass on main), issue templates. `dist/` (userscript, extension, zip) is
  committed - the zip is reproducible.
- NOT verified here: FR24's live DOM for the airport panel (the jsdom test uses a panel shaped like the user's
  screenshot; the promo test ids other than `airport-panel__promo-runway_details` are guessed, with a fallback by title),
  the registers' live answers (their formats as the browser's code already read them), FR24's acceptance of the
  server's scan.

## 4h. 22.25.0 (15 Oct, cloud session) - built and tested offline; deploy with deploy.sh

- **Waiting list.** `monitor/waiting.cjs` (`createWaiting`): FR24 ids not named yet, `src` 'pb' (from /pbmatch) or
  'live' (`waitLive`: ident flights unnamed 5 min+). `note` keeps up to 60 points a flight (one per 30 s), 10,000
  flights (the oldest tenth dropped when full), three days. `tryOne` samples 10 points, candidates from `tracks.atAll`
  on a 2-degree grid (one per minute, cached per round), fits each by `tracks.estimate` (x = distance / (R + tol); 9 on a
  height or ground/air mismatch), needs 80% fitting and no slip (one in six+), carried-only needs two points 2 min apart
  or one very close of the same type; unique (`c.nF < 0.6 b.nF` or clearly worse) and no `rival` (another waiting
  flight where that aircraft could be). `round` every 15 s (`waitLoop`, `CFG.waitMs` 400 ms); backoff 1-60 min (10 max
  while recent; 6 h after three tries with no candidate); `kick` on `tracks.onChange` of past days. Named: live ->
  `ident.assign(..., 'path')`; else `names.add(id, {..., how})` (row `[7]`). Saved as STORE/waiting.json.
- **Dead reckoning.** `tracks.estimate(hex, t, o)` over the window's day maps: interpolation (gap <= 900 s), edges
  (120 s), parked (both ends on the ground within 2 km), great circle across a hole (airborne both ends, 120 kt+), one
  side (10,000 ft+, 150 kt+; 15 min, or 3 h where `o.remote` says open water: `E.remotePath`). Returns `tol` (km) and
  `how` ('track', 'reckon', 'parked').
- **/pbmatch** notes every unnamed flight first, then tries them (`CFG.pbReckonMs` 400 ms a request, at most 1 s of
  every 5 s over all requests: `pbSpend`). The browser re-asks every 45 s (`PB_REASK_MS`, `pb.monAsked` is a Map).
- **Crowd routes.** Browser `noteRouteOut` (from `publishRoute`): only for a flight in `srvIds.rows` with the same hex,
  not quick, not from the crowd, and only with `legCount > 0`, `originConf === 'ground'` or `destConf === 'confirmed'`;
  `crowdO`/`crowdD` parts and a 'landed' destination left out. Monitor `ident.crowdRoute` keeps each end on its own
  (`ot`/`oOwn`, `dt`/`dOwn`): an end from the owner (no IP) stands 20 min; a confirmed destination stands; another
  airport 10+ points less sure is refused for 20 min; destinations behind the flight refused. `ident.prune` drops a
  destination (not confirmed) the flight is no nearer to an hour on (`km`/`kmAt`) and marks the row changed; the origin
  lasts as long as the name. `table()` cols 24-26. Browser `crowdOf`, `srvRoute`
  labels, `composeRoute` uses it when better by 10 points or confirmed; `pullSrvIds` replans a live flight whose
  crowd route changed.
- **Crowd learning.** Browser `learnFromLeg` queues rows without monitor `lx` (`learnOut`); `/report` `learn` ->
  `learnFromCrowd` (checks in `learnCheck`, dups of a monitor leg skipped, per-IP cap) into STORE/learn-crowd/<day>.json
  with the report's number `learnSeq` at [12]; the reply's `learnNot` lists the rows not taken. `learnedBuild` saves
  first, takes rows numbered up to `builtSeq` (`crowdRows`), and publishes `builtSeq`. The browser marks a taken row
  with `learnSeq` and leaves it out of its tables when `x[12] <= builtSeq` (`srvCovers`). No clocks compared.
- Tests: `unit_waiting` (monitor), `unit_shared` (two browsers in jsdom with the real monitor between them).

## 4g. 22.24.1 (15 Oct, cloud session) - userscript only, tested offline

- **"Recent <reg> flights".** `onNeedHist` (`04-routes.js`) now asks `flyingNow(hex, rec)` whether the aircraft is
  flying. It checks our route, else a fresh position (`currentPos`, under 20 min old: in the air, or on the ground, which
  decides), else FR24's plan (`fr24Sched`: `atd`, no `ata`). Before, only our route counted, so a flight FR24 routes
  itself was listed under its own (hidden) head. Only legs ending after the current flight's start (less 300 s) are
  left out, and an older open leg stays. Test: `unit_recent`.
- **Photos.** `onPagePhotos` no longer resolves the Planespotters waiters (`photoWaiters`) with FR24's own pictures (JetPhotos
  640cb, sent by the page when a blocked airframe's panel opens); the early pictures are cleaned (`cleanPhoto`) like the
  final ones; page.js `goodPhotos` and `boardImage` strip `cb` too. Tests: `unit_photos`, `unit_flightmsg` 2f.

## 4f. 22.24.0 (15 Oct, cloud session) - built and tested offline; deploy with deploy.sh

- **Playback.** Heatmap race beside `/pbmatch` (`06-playback.js`), `heatMatch` indexed by cell, Mach/OAT derived, the
  registers' cells filled as they answer (`pbPanelTick`).
- **Climb-outs are not landings.** Engine `climbingAt`/`descendingAt`: no `finalTo`, `endpoint` or "airport ahead" end
  for a leg last heard climbing; no take-off field for an airliner first heard descending. `summarizeLeg` marks its
  result `endRules: 2`. `climbedOut(leg, cls)` flags a kept leg made before (with `endAlt`: lost within 15 min of the
  take-off at its highest; monitor form without `endAlt`: not LADD, within 10 min, 2,000 ft up). Applied in
  `boardNoteLegs` (the `to` dropped, a drop row at the old field). The monitor's legs now carry `endAlt`, `how`,
  `endRules` - until deploy.sh runs, its non-LADD legs are caught by the monitor-form rule in the browser.
- **Board rows.** `fakeRow` in `06-boards.js` (`boardMerge`, `boardScrub`): an airline-callsign airliner's `log`/`live`
  row with no other end (`log`), the same field, or a field within 80 km without `gc` (seen on the ground). `naRouteOf`
  never routes such a jet within 80 km of where it left. `boardNoteLegs` learns no site for an unknown end unless the
  jet was heard low.
- **Remove ads.** `hideAd` in page.js, by the button's text ("Remove ads"), climbing while the box holds nothing else,
  plus an advert slot beside it; in the mutation observer, so before paint. FR24's markup was not available here.
- **FR24-named flights.** `patchFlight`: a flight with a registration is never reported as blocked; `named` ids go to
  the userscript (`noteFr24Named`: let go, `revokedIds`, never re-adopted from the store). Same rule as `ident.cjs`.

## 4e. 22.23.0 (14 Oct, cloud session) - built and tested offline; deploy after the move to the Ampere VM

- **Tracks.** `monitor/tracks.cjs` (`createTracks`): `put` from `buildLegs` (blocked rows past `x.trkAt`), `histDay`,
  `backfillOne` and `fr24Leg`; saved every 600 s and on stop, pruned daily. `at(t)` interpolates (gap <= 900 s).
- **`/pbmatch`.** `pbMatch(t, flights)`: live names first, then tracks within a 1-degree grid, type fit (`typeFits`),
  one-to-one only. Browser: `pbFromMonitor` in `06-playback.js`, `/names` on 404 (`pb.monOld`).
- **`/learned`.** `engine.learnCollector()` swaps the tables while `learnRow` runs and emits ops; browser
  `applyLearned` applies the kept blob first, `replayLearned` skips rows it covers (`srvCovers`). The fetched snapshot
  is used from the next page load only, because tables are rebuilt on load.
- **Backfill waits** on `liveBusy()`.
- A 24 GB Ampere VM: run node with `--max-old-space-size=12288`. Not verified here: memory and build time of
  `/learned` over 90 real days (estimated 10-25 MB raw).

## 4d. 22.22.0 (14 Oct, cloud session) - built and tested offline; deploy with deploy.sh

- **Public monitor, default for every copy.**
  - `PUBLIC` comes from `"public"` or `MON_PUBLIC`; `RATE` is 300 by default when public.
  - `admin` means the secret, or no secret set. `/stats` is admin-only.
  - Crowd rules:
    - `ident.clientId`: a name is checked against `candOf(hex)` as heard at that moment, else needs `crowdNeed` browsers;
    - `owners.fromClient`: `pend` entries are dropped after 6 h;
    - `pbNames`: confirmed by the monitor's own legs, else two browsers;
    - `tel.addCrowd`: plausibility checks, and never over its own report of the last minute.
  - Private owners are withheld (`owners.row(pub)` col 15).
  - Browsers send `hdr` only to a monitor with a token.
- **No padlocks.**
  - `page.js` `unlockFeed` (feed record flags 13/16/17/18) and the follow-stream EFI branch (12/14/16/18).
  - Values come from `pubTel` (keyed H/C/R) or `telem`; otherwise the vertical speed is derived (`altHist`, seeded from the trail) and the airspace comes from `airAsk`→`airRows` (the userscript's `onAirAsk`, `firInfo`).
  - The VS flag is kept only while no VS is known.
  - Monitor `tel.cjs`: `/tel`, and `/near` returns full rows. The userscript's view poll alternates between the monitor and its own sources. `pollTelemetry` races the monitor's `/tel` against its own source on first open. `reportTel` runs every 30 s.
- **Data pages.**
  - `flightPagePlayback` (`/data/flights/…` when FR24 lists rows) gets the hex from `flight-playback.json` → `fillPlaybackData`.
  - `unlockExports` turns locked KML/CSV buttons into downloads of the public ADS-B track (`exportFile`).
  - Selectors are defensive; FR24's real markup for the lock buttons was not available here.
- **Boards.** `naRouteOf` requires two flying reports. Take-off is the first of them. `cameFrom` is required for an approach or landing. `ENGINE.localFlew` covers same-field flights. `boardScrub` removes old rows. `boardSig` in page.js has the same `atd>0` rule. The monitor's `boardLegs`/`fr24Leg` filter by `localFlew`, and its legs carry `maxAlt`/`pathKm`.
- **Names archive.** `names.cjs` (STORE/names/*.jsonl, kept for good), `/names`. `pbFromMonitor` runs first in `pbMatch`; heatmap names go to `pbOut` → `pbIds`.
- **Failover.** `MON_DEFAULTS` (one entry today). A standby needs its URL there, in header.js @connect and in build.mjs hosts.
- **NOT verified here:** FR24 and adsb.lol are blocked by this environment's network policy (403). Not verified:
  - FR24's rendering of a cleared flag with no value (expected "N/A", as for a subscriber);
  - the data pages' lock-button markup;
  - the live behaviour of `/near` with real traffic.
- **Server recommendation given to the user:** no extra scanning servers to multiply rate limits. Move the monitor to an Always Free Ampere A1 VM (up to 4 OCPU / 24 GB); keep the micro VM as a warm standby (`MON_DEFAULTS`).

## 5. The user's request (14 Oct, verbatim)

> remember the monitor is running by itself now, it doesn't need my computer anymore and can therefore have as much
> resources as it needs to identify the whole world of ladd flights and rough destination calculation data, most
> destination calculation then done in browser and only ladd identification as backup. move the script fully off a
> computer monitor and onto the oracle one. deepthink, deepsearch and test. dont make any mistakes or bugs.

Earlier the same day they asked for a dashboard of everything the monitor does and who calls it: built (`/dash` +
`/stats`, committed, tested locally), **not yet deployed**.

Be honest about "as much resources as it needs": the free VM has 1 GB RAM. The real limits are that and adsb.lol's rate
limits, not the user's PC. The free ARM shape (A1.Flex, up to 24 GB) had no capacity in London when the VM was made.

## 6. How it works today (relevant parts)

- **Browser identification** (`02-resolver.js`): `refreshLists()` takes the LADD list from monitor `/ladd` when fresh
  (< 90 s) else `api.adsb.lol/v2/ladd`, and also fetches `api.adsb.lol/v2/mil` and `opendata.adsb.fi/api/v2/mil`
  directly; every 30 s it refreshes from monitor `/ladd`. Plus area polls of the map view, a world scan, per-flight
  matching (`noteCands`, `resolveTargeted`), ocean ID (monitor `/last`, `matchByTraces`, heatmaps), parked aircraft
  (monitor `/parked`). `monSeed()` sends every LADD hex the browser knows to monitor `/seed`.
- **Destination data**: `loadHistory(hex, days)` (`03-data.js`) rebuilds an aircraft's log from adsb.lol
  `globe_history/.../trace_full_<hex>.json` day files, one request per day (21 days, more in the background), cached in
  IndexedDB. This is the browser's heaviest adsb.lol load. **The monitor's `/legs` (90 days, same engine, same leg
  format) is not used by the browser yet.**
- Boards use monitor `/board`; flight-number pages `/flights`; `/area` tells the monitor where the user looks.
- **Monitor loop**: one adsb.lol API request at a time, at least 2 s apart (`pumpGate`): `/v2/ladd` every 30 s; areas
  (`CFG.areas` default `[[53.8,-2.6,250]]` + up to `CFG.userAreas` = 3 from `/area`) every 60 s via `/v2/point`;
  non-FAA blocked aircraft by hex in batches of 100 every 120 s; 3 backfill workers read adsb.lol day traces (gapFill
  3 days). A 429 pauses that host for 120 s. Store: `legs-YYYY-MM-DD.json` per day + `state.json` (blocked list, user areas).

## 7. Proposed plan (research and verify each step first; change it where evidence says so)

**A. Move fully onto Oracle**
1. Make the VM a git checkout so updates are one command: read-only deploy key on the VM
   (`ssh-keygen -t ed25519 -f ~/.ssh/fr24_deploy -N ""`; the user adds the `.pub` as a read-only Deploy key in the
   GitHub repo settings), clone to `~/fr24-ladd`, point the service at `~/fr24-ladd/monitor` (data comes with the repo;
   keep `MON_STORE=/home/ubuntu/monitor/store`). Add `monitor/deploy.sh`: `git pull --ff-only`, `node --check`,
   restart, `/status` check with the token from the unit file, roll back to the previous commit on failure.
2. Migrate the home store + state without losing what the VM gathered since 12 Oct: write `monitor/merge-store.cjs`
   (union legs per day by the monitor's own leg key; union blocked lists keeping the newest `heard`) **with a unit
   test**. The user scp's `FR24LaddMonitor\store` to `~/store-home`, stops the service, runs the merge, starts it.
3. Userscript: once a shared monitor answers, don't use `127.0.0.1` for data at all; the local monitor only when no
   shared one is set.
4. Caddyfile: add `encode zstd gzip`.

**B. Monitor = primary worldwide identification (browser = backup)**
5. Add worldwide lists to the monitor loop: adsb.lol `/v2/mil` and `/v2/pia` (every 60-120 s); adsb.fi `/api/v2/mil` as
   fallback while adsb.lol is paused. Check the real endpoints, shapes and limits first (adsb.lol API docs; adsb.fi
   opendata README). **Do not use the airplanes.live REST API** (needs approval; links to its globe are fine). Keep the
   2 s gate and the 429 pause; stay well under ~25 adsb.lol requests/min in total.
6. New endpoint `/live`: every blocked/LADD/PIA/mil aircraft heard in the last few minutes: hex, reg, type, cs, lat,
   lon, alt, gs, trk, gnd, seen time, flags, current leg origin (id/code/conf) and take-off time. Compact rows.
7. Userscript: with the monitor up, take `/live` every 15-20 s as the candidate list (feed `noteCands` exactly as
   `refreshLists` does) and skip its own `/v2/ladd`, `/v2/mil` and adsb.fi mil requests; use them only when the monitor
   is down or its data is older than ~90 s. Keep the browser's own area polls for ordinary N/A flights (the monitor does
   not see the whole world's ordinary traffic).

**C. Destination data from the monitor**
8. `loadHistory`: for blocked aircraft ask monitor `/legs` first (instant; add a batched `/legs?hex=a,b,c`), merge into
   the IndexedDB log in the existing format, and fetch adsb.lol day traces only for days the monitor lacks.
9. Optional: a rough destination on the monitor for airborne blocked aircraft (own-history likeliest destination from
   this origin + heading agreement), in `/live` and `/board` so airport boards anywhere list inbound LADD flights as
   "Predicted". The browser engine still does the full prediction. Keep it cheap: 1 GB RAM.

**D. Dashboard**
10. Deploy `/dash`: https://143-47-224-210.sslip.io/dash asks for the secret and polls `/stats` every 5 s.

Ship in small, tested steps: bump `@version` in `src/header.js` and `VERSION` in `src/main/01-core.js` together, run
`npm run lint` and `npm test` before every push, A/B perf for anything on the map path, and tell the user exactly what
to install/run. The user has to reinstall the script in Tampermonkey for header changes (new `@connect` hosts).

## 8. Constraints (always)

- The user's standing requirements: `docs/maintainers/notes/user-preferences.md` (responsiveness first, FR24-native look, never
  override FR24's own routes, "Confirmed" only when sure, heavy testing, honest reporting).
- Be gentle with adsb.lol and airplanes.live; respect robots.txt; ADS-B Exchange only through the user's own RapidAPI
  key, never its globe; API keys only ever entered by the user.
- Registers: owner names only, never addresses. Never send the user's email address anywhere.
- No persistent changes on the user's PC (startup tasks etc.) without explicit permission.
- Never commit or log the monitor secret.

## 9. Gotchas

- jsdom does not apply FR24's CSS: a table built with class `is-user` was invisible on FR24's real page while tests
  passed. Check visible results in a real browser where possible.
- Tampermonkey reads `@connect` only when the script is (re)installed.
- Old data pages (`/data/flights`, `/data/aircraft`) are jQuery pages; the map and airport pages are Vue/Inertia with
  Pinia stores (`app.config.globalProperties.$pinia._s`): see the notes.
- Change detection by `JSON.stringify(x).length` collides (7,497 vs 7,500 ft): use `hashStr(JSON.stringify(x))`.
- Caddyfile blocks need the braces on their own lines.
- `test/replay_live.cjs` and e2e pick live aircraft, so conditional checks vary from run to run.
