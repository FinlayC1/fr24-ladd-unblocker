# Development

## Setup

```bash
git clone <repository> && cd fr24-ladd-unblocker
npm install            # dev dependencies only: eslint, jsdom, fake-indexeddb
npm run build          # writes dist/fr24-ladd-unblocker.user.js
```

`build.mjs` assembles the single-file userscript from these parts, in order:

1. `src/header.js` (the userscript header)
2. `src/page.js` (the page-world interceptor)
3. `src/engine.js` (the route engine)
4. `src/registry.js` (the aircraft registers)
5. The aircraft-age table, packed as gzip + base64 (1.1.0: the route tables in `src/*.json` are the monitor's alone - it reads them from its checkout - and are not in the build)
6. Every `src/main/NN-*.js` module, in file-name order

The modules share one scope; they are not separate ES modules.

The same build also writes the **browser extension**:

- `dist/extension/` holds `manifest.json` (its hosts are the header's `@connect` list), `page.js` (in FR24's own world), `data-<n>.js` (the packed data, in parts - one since 1.1.0), `content.js` (`extension/shim.js` plus the whole script, which reads the tables from the data files), `background.js` (the service worker making requests) and the icons from `extension/icons/` (rendered from `docs/assets/icon.svg`).
- `dist/fr24-ladd-unblocker-extension.zip` is the same, zipped. The build is reproducible: the same sources give the same zip, byte for byte.
- `dist/fr24-ladd-unblocker-firefox.zip` is the same files with Firefox's manifest: `background.js` as a background script (Firefox has no extension service workers), the add-on id `ladd-unblocker-fr24@finlayc1.github.io` (fixed for good once on addons.mozilla.org) and what it sends, as addons.mozilla.org asks. Mozilla's check reads no script of 5 MB or more, which is why the tables are in parts; the build stops if any file reaches 4 MB. To run that check yourself: `npx addons-linter dist/fr24-ladd-unblocker-firefox.zip` (0 errors expected; the warnings are the script's `innerHTML` and Firefox lacking `runtime.requestUpdateCheck`).

## Testing

```bash
npm run lint           # eslint over the build and page.js: must report 0 errors (warnings are tolerated)
npm test               # node test/run-suite.cjs: build, then every suite below except e2e
npm run test:all       # also the live end-to-end runs (normal and Tampermonkey-emulation mode)
```

`run-suite.cjs` counts each suite's `PASS` / `FAIL` lines and exits non-zero on any failure.

| Suite | What it checks | Network |
|---|---|---|
| `unit_engine` | Route engine on recorded situations | – |
| `unit_cases` | Flights the user reported (correct destinations) | – |
| `unit_final` | Final-approach confirmation | – |
| `unit_legs` | Leg reconstruction from traces | – |
| `unit_n6012c` | A flight that came down in a hole in coverage and flew on (N6012C, 16-17 Oct): the hole rules, with 315,000 real trace points kept whole; the flight in progress cut at the hole in the userscript and the monitor; the built userscript on it as FR24 and adsb.lol could have shown it; a browser's own route standing over another's; a departure from the flight before dropped from the routes handed out | – |
| `unit_monitor` | Monitor: flights from 30 s reports match the whole track; backfill; quiet aircraft closed; parked; callsigns; areas | – |
| `unit_monitor2` | Monitor: poll order, backups (adsb.fi, ADS-B Exchange, OpenSky), `/live`, rate cap, watch records, `/hist` (format, empty days, retries, unknown days), state on disk, SIGTERM | – |
| `unit_merge` | `merge-store.cjs`: one copy per flight, union of blocked aircraft, running state kept, refuses while running | – |
| `unit_deploy` | `deploy.sh` against a throwaway git origin: update, nothing new, rollback on no answer / parse error, hand edits left alone, secret never printed | – (needs bash and git) |
| `unit_names` | Owner and airfield naming | – |
| `unit_origin` | Origin inference | – |
| `unit_flightmsg` | FR24 protobuf messages (built script in jsdom) | – |
| `unit_mapx` | FR24's locked map options, worked natively (plans table, weather, WAFS, AIRMETs/SIGMETs, METARs, lightning, NAT tracks, category filters, settings), runways in the airport flight history, flight pages and airport boards, KML/CSV downloads, and FR24's player readings (GPS altitude, airspeeds, squawk) answered locally for a stand-in flight id; Last clicked flights kept named (never "N/A" again), one that has landed opening its aircraft's log page (built script in jsdom) | – |
| `unit_pbbuttons` | Playback of a blocked flight (the panel, board cards, kept rows, search results, rebuilt log rows): its aircraft's page at that flight (`/data/aircraft/<reg>#<id>`), where FR24's page script plays it in place; `flight-playback.json` of such a flight answered in FR24's form from its track, the aircraft's pictures beside it; the log rows' FR24 Play with KML/CSV, the flight in the address played (latest, nearest take-off); FR24's own locked playback pages given the track; the userscript's `pbWhere` and `pbFlight` (built script in jsdom) | – |
| `unit_126` | 1.2.6: a board card's departure and arrival runways from the flights' tracks (asked at each end's airport, never FR24's padlock); FR24's own board rows with no other airport filled once found; Playback of a kept row under this script's own flight id never left to FR24 (its list of aircraft types); the log page player's pictures over FR24's side view; on the ground, named at once by the parked rule and provisionally (confirmed or replaced once heard, here and on the monitor); the log page's age as the map's panel works it out, never a padlock; serial numbers and years of any aircraft for the monitor; 1.2.7: an aircraft whose database type its own transponder contradicts (N99MB, a "Cessna 210" sending A2) matched by position, and a wrong name withdrawn when the aircraft is heard parked while FR24 has the flight airborne (built script and page part in jsdom) | – |
| `unit_127` | 1.2.7: the monitor's runway log (`monitor/rwylog.cjs`) - a take-off's runway from the scans the moment it climbs out, a landing's on final, both ends from FR24's whole trail, not a flight going elsewhere or climbing; kept on disk and read back; an airport's all at once. The page: an airport's runways asked once, a blocked flight's row and card by address and time; the runway in use (confirmed by traffic and wind, predicted by the wind, parallels apart) in the map's airport panel and on FR24's airport data page; the data page's "N/A" other ends (page part in jsdom) | – |
| `unit_128` | 1.2.8: a registration sent as the callsign in its own country's form over a database's stale one (G-RVNX, ex G-AWTL; kept under other callsigns); a board card's Playback of a row of this script's own; an airport's runways in one answer (`/rwyap?use=1`: flights' runways, blocked flights' by address, ends, runways, the last day's movements; made once per 20 s; older days on asking); the runway in use at once from the browser's kept copy, "runways" when two are in use; a card's late runway written into it (monitor modules and page part in jsdom) | – |
| `unit_1210` | 1.2.10: which runway - a take-off from Paris CDG's 26R (its start 600 m before 26L's) is 26R, 27L not 27R, a landing on 26L; Los Angeles's 24R (no "longer one" guess from one far position); Atlanta's 26L/26R alike from far out: none; Daytona's circuit never 34. The live log: a T-6 just off Atlanta's 26L is a take-off, not a landing; taxiing marked airborne not a take-off; the last answer on short final taken. FR24's altitude filter (field 3); quarters keep their height; the low scan end to end (every service, airborne, eight regions) logs a Ryanair off Liverpool no one is looking at; world scan every minute; pushback slows every scan; a 1.2.9 runway-log file read for its landings only; writes off the event loop; a landing FR24 split in two (VLZ78K at Oxford) not on the departures board nor counted as a take-off; the runway in use follows an airport turning round (Manchester 05 to 23, Liverpool 09 to 27), the page asking every 30 s; 1.2.11: fresh traffic over the wind (JFK on 22L/22R with 5 kt behind it, not "31L") |
| `unit_1212` | 1.2.12: the runway in use - a second runway only with a share of its own (JFK's one stray 22L take-off); a minor runway (Beauvais's 1.1 km 04/22) never shown while a main one has traffic, nor by the wind, nor as the longest; a main runway shorter than the longest kept (JFK's 22L). The monitor: the runway log never turns a surer answer (trail > scans > a browser's points); ADS-B legs' runways only those of 1.2.10's rule; /rwyap's movements from the runway log, the legs' only where it has none |
| `unit_13` | 1.3: switched off - the page part only reads FR24's LiveFeed and board answers (never changed) and the userscript only sends them to the monitor, taking nothing; the made METAR and weather of an airport with no METAR (`apwx.cjs`) in FR24's panel, data page, current-weather layer and runway in use; the statistics page's runway usage and movements; the vertical speed padlock never shown; the OurAirports airports (`oaap.cjs`) in FR24's list, map, airport answer and boards |
| `unit_131` | 1.3.1: the monitor's two-minute round a step at a time (the same files as in one go, the timers turning meanwhile, never two at once); the day files from one pass over the flights (an old day merged with its file's blocked flights, a day changed while writing written next time); datalink files read in slices, lines with no message text not parsed; `prof.cjs` - a minute's time by function and job, a stall named, in `/status`; a big answer gzipped over HTTP; FR24's advert library asked for nothing while "Hide ads" is on, untouched when off; the statistics and airport pages unlocked before FR24 draws them; OurAirports airports' pins in FR24's own form, their window's four requests, FR24's lookup by every code; their data pages made from the nearest FR24 airport's, nothing of it left; the list refreshed daily by ETag, a bad file refused, the browser's "same" check |
| `unit_132` | 1.3.2: the scores' sweep a slice at a time and its log from memory (the same flights finished as in one go, the timers turning, never two at once); a stall's work and waiting told apart; OurAirports' runways and frequencies of every airport (by ident and other codes, a closed airport's kept, helipads not, the files in the store asked for by ETag and never replaced by something else); the airports file kept in the store, the checkout's never written; an airport answer for an OurAirports airfield and for a heliport the engine does not know; on FR24's map the pins staying when an aircraft or an airport is opened, the open airport kept in FR24's own tables, the window's codes, time zone, sunrise and sunset, FR24's newer airport address, the runway section without FR24's padlocked picture, "More" and FR24's server's detour to its airport search |
| `unit_fr24` | FR24 feed protobuf, the world scan's regions, naming (lists, look-ups, dead reckoning, trails, parked), withdrawing, rough destinations, `/fr24ids`, `/report` | – |
| `unit_store` | The permanent log (old days only added to, boards from disk), `/learn`, flights only FR24 sees, runways used, `/airport`, owners on the monitor, the names table's LADD flag | – |
| `unit_registry` | Every register's answer read (FAA, G-INFO, Isle of Man, FOCA, hexdb, adsbdb), the monitor's owner store (pace, refusals, browsers' findings, kept across restarts) | – |
| `unit_monlive` | Built userscript with a shared monitor: only that monitor asked, `/live` as the list, the names table, positions, `/learn`, owners asked of the monitor first, the LADD flag, fallbacks, `/hist` logs identical to the browser's own | – |
| `unit_panel` | Built userscript on an FR24-shaped airport panel: *Latest events* and the coverage plea removed before they are drawn, movements per day, runway usage, runways in full, frequencies | – |
| `unit_playback` | Built userscript on FR24's playback (M-ARNZ, 9 Oct): the heatmap fetched with the first frame beside a monitor that never answers, names before the track arrives, the file kept on disk, Mach and temperature from the track, the panel's padlocked country, serial number and age | – |
| `unit_waiting` | Monitor: dead reckoning across the holes in a track (`tracks.estimate`), the flights not named yet tried again until one aircraft fits (`waiting.cjs`: playback and live, one aircraft one flight), browsers' routes and learned flights taken, checked and handed out | – |
| `unit_shared` | Two built userscripts with the real monitor between them (1.1.0): the monitor's answer the same in both, nothing sent back; a destination confirmed in one in the other's answer, a guess of an older version not over it, taken back everywhere; TC-AKB's checks on the monitor; learned flights to the monitor, none fetched; playback names worked out later | – |
| `unit_central` | Central calculation: the route code's free names given on the monitor, memory and start, what browsers send, the same answer from what a browser sends as from everything it has, two browsers one answer, the user's confirmation, the monitor off; no tables in the built script | – |
| `unit_centralpool` | Central calculation on worker threads: the same answers as on the main thread, a flight always on one worker, a worker that dies replaced | – |
| `unit_noroute` | The world scan asking FR24 for routes and addresses (and stepping down when refused); FR24's flights with no destination followed and given to central calculation | – |
| `unit_monboards` / `unit_boardsync` | Airport boards on the monitor (rows kept, merged, served with `since`, FR24's schedule read by the monitor, paced and paused) and a built userscript's board filled from it at once, its own FR24 rows sent back | – |
| `unit_fr24raw` | (1.2.4) The monitor's store of every FR24 position as it came (`monitor/fr24raw.cjs`): each second of a flight once with every figure, written in members of 64 flights, read back by FR24's id across days and a restart, a broken member skipped, old days removed, the points let go when the disk is short | – |
| `unit_tel` | (1.2.4) The monitor's last airborne squawk of each aircraft (`monitor/tel.cjs`), kept 16 hours | – |
| `unit_local` | (1.2.4) A light aircraft circling near where it took off read as a local flight returning there (G-POLV, a police P68 out of East Midlands, from adsb.lol's record of 4 Nov) | data dir |
| `unit_scores` | Live accuracy: answers noted and scored at landing or from the log, written as training data, read back after a restart, old days gzipped | – |
| `unit_fleet` | Fleets: an owner's other aircraft and their airports of 60 days, trustees and lessors left out | – |
| `unit_extension` | The built extension in a real Chromium: service worker, both worlds, requests through the worker | – (needs Playwright and Chromium; skipped without them) |
| `unit_native` | The built userscript's LADD Unblock window in a real Chromium, frame by frame, on a Vue 3 page made like FR24's map (`fixtures/fr24mock.html`) in seven layouts: opens in FR24's Widgets window, one bar item open, closes with flights and other options, Bookmarks switched off, the airport panel's empty bar never drawn | – (needs Playwright, Chromium and Vue 3's `vue.global.js` as `VUE_PATH`; skipped without them) |
| `unit_pbnative` | Playback buttons in a real Chromium on the Vue 3 mock (`?pb=1`): the bottom bar's left to FR24, a blocked flight's (panel, board card, search result) opening its aircraft's page at that flight, a middle click that page in a new tab, ordinary flights' FR24's own | – (needs Playwright, Chromium and `VUE_PATH`; skipped without them) |
| `unit_new` | Built userscript: playback, airline/airport lists, boards, sites, routes page | FR24 |
| `panels1`, `panels2` | Reported panels replayed through the built script | FR24, adsb.lol |
| `replay` | Live aircraft replayed through the built script | FR24, adsb.lol, others |
| `e2e`, `e2e_tm` | The built script on the real FR24 site | everything |

Suites that need the network must be reported as **not run**, never as passed, when the network is unavailable. `test/perf.cjs` measures main-thread stalls during map use. Run it, comparing with the previous build (`E2E_SRC=<old build>`), for any change on the map path.

### Fixtures

`test/fixtures/` holds recorded data from real flights:

- adsb.lol day traces (`legs/<hex>/<day>_lol.json.gz`);
- FR24 playback answers;
- a heatmap slice;
- OpenStreetMap answers;
- panel cases;
- a Vue 3 page made like FR24's map, its bottom bar and windows, and (`?pb=1`) a panel, board cards and search results with FR24's Playback actions (`fr24mock.html`, for `unit_native` and `unit_pbnative`).

A bug report from real use should end up as a fixture and a check named after the flight.

### Offline training pipeline

The population tables and model weights in `src/*.json` are produced from adsb.lol's daily archives by `test/pipe_legs.cjs`, `pipe_tables.cjs`, `pipe_examples.cjs`, `fit2.cjs` and `pipe_eval.cjs`. Evaluation always uses held-out aircraft: `test/diag_time.cjs` samples by clock time, as a user's clicks would. See the history notes in [maintainers/notes](maintainers/notes/) for the numbers behind each table version.

## Coding conventions

- **Match the surrounding code.** Comments explain *why*, often naming the flight that exposed the problem.
- **Responsiveness first.** Background work goes through `idleSlice()` / `sliced()`. Nothing heavy runs in a network callback or during map interaction.
- **Never override FR24's own data.** Only fill what FR24 leaves empty.
- **"Confirmed" is reserved for the final-approach rule.** Everything else is a prediction, capped at 99%.
- **Change detection uses `hashStr(JSON.stringify(x))`,** never string length.
- **The monitor stays dependency-free and runs on Node 18.**

## Release checklist

1. Bump `@version` in `src/header.js`, `VERSION` in `src/main/01-core.js`, `version` in `package.json` (and `package-lock.json`), the README's version badge and the website's byline (`site/index.html`) together. The build stops if any of them disagree.
2. `npm run lint` (0 errors) and `npm test`. Run `npm run test:all` and `test/perf.cjs` where the network allows.
3. Run the monitor's tests on Node 18 (the server's version).
4. Add an entry to `CHANGELOG.md`. Start it with an `### In short` list: 4 to 7 plain sentences about what a user will notice, no code names, no figures, no "fixed X". Those sentences are what the update note and the extension's update page show (the bold leads of the items below are only a fallback). Read them as someone who has never seen the changelog: if a line needs the details to make sense, rewrite it.
5. Commit the rebuilt `dist/` (userscript, extension folder and zip) with the change. Now and then, refresh the checkout's OurAirports data (`node monitor/mkdata.cjs`) and commit it after the tests pass; a running monitor keeps its own, newer copies in its store.
6. Server: `bash ~/fr24-ladd/monitor/deploy.sh`.
7. Browser: reload the extension from the new zip, or install the new userscript build in Tampermonkey (a header change needs a reinstall). Keep the previous version as a backup.
8. Nothing to tag: once every test passes on `main` with a version that has no release yet, the release workflow publishes `v<version>` itself, with the zip, the userscript and the changelog entry as its notes. A change merged without a version bump is not released.
