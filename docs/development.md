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
5. The learned tables in `src/*.json`, packed as gzip + base64
6. Every `src/main/NN-*.js` module, in file-name order

The modules share one scope; they are not separate ES modules.

The same build also writes the **browser extension**:

- `dist/extension/` holds `manifest.json` (its hosts are the header's `@connect` list), `page.js` (in FR24's own world), `data-<n>.js` (the learned tables, in parts), `content.js` (`extension/shim.js` plus the whole script, which reads the tables from the data files), `background.js` (the service worker making requests) and the icons from `extension/icons/` (rendered from `docs/assets/icon.svg`).
- `dist/fr24-ladd-unblocker-extension.zip` is the same, zipped. The build is reproducible: the same sources give the same zip, byte for byte.
- `dist/fr24-ladd-unblocker-firefox.zip` is the same files with Firefox's manifest: `background.js` as a background script (Firefox has no extension service workers), the add-on id `ladd-unblocker@finlayc1.github.io` (fixed for good once on addons.mozilla.org) and what it sends, as addons.mozilla.org asks. Mozilla's check reads no script of 5 MB or more, which is why the tables are in parts; the build stops if any file reaches 4 MB. To run that check yourself: `npx addons-linter dist/fr24-ladd-unblocker-firefox.zip` (0 errors expected; the warnings are the script's `innerHTML` and Firefox lacking `runtime.requestUpdateCheck`).

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
| `unit_monitor` | Monitor: flights from 30 s reports match the whole track; backfill; quiet aircraft closed; parked; callsigns; areas | – |
| `unit_monitor2` | Monitor: poll order, backups (adsb.fi, ADS-B Exchange, OpenSky), `/live`, rate cap, watch records, `/hist` (format, empty days, retries, unknown days), state on disk, SIGTERM | – |
| `unit_merge` | `merge-store.cjs`: one copy per flight, union of blocked aircraft, running state kept, refuses while running | – |
| `unit_deploy` | `deploy.sh` against a throwaway git origin: update, nothing new, rollback on no answer / parse error, hand edits left alone, secret never printed | – (needs bash and git) |
| `unit_names` | Owner and airfield naming | – |
| `unit_origin` | Origin inference | – |
| `unit_flightmsg` | FR24 protobuf messages (built script in jsdom) | – |
| `unit_pbbuttons` | Playback of a blocked flight (board cards, kept rows, the panel, search results, rebuilt log rows) to FR24's map playback at its take-off; the bar's and ordinary flights' left to FR24; the selection in playback; the userscript's `pbWhere` (built script in jsdom) | – |
| `unit_fr24` | FR24 feed protobuf, the world scan's regions, naming (lists, look-ups, dead reckoning, trails, parked), withdrawing, rough destinations, `/fr24ids`, `/report` | – |
| `unit_store` | The permanent log (old days only added to, boards from disk), `/learn`, flights only FR24 sees, runways used, `/airport`, owners on the monitor, the names table's LADD flag | – |
| `unit_registry` | Every register's answer read (FAA, G-INFO, Isle of Man, FOCA, hexdb, adsbdb), the monitor's owner store (pace, refusals, browsers' findings, kept across restarts) | – |
| `unit_monlive` | Built userscript with a shared monitor: only that monitor asked, `/live` as the list, the names table, positions, `/learn`, owners asked of the monitor first, the LADD flag, fallbacks, `/hist` logs identical to the browser's own | – |
| `unit_panel` | Built userscript on an FR24-shaped airport panel: *Latest events* and the coverage plea removed before they are drawn, movements per day, runway usage, runways in full, frequencies | – |
| `unit_playback` | Built userscript on FR24's playback (M-ARNZ, 9 Oct): the heatmap fetched with the first frame beside a monitor that never answers, names before the track arrives, the file kept on disk, Mach and temperature from the track, the panel's padlocked country, serial number and age | – |
| `unit_waiting` | Monitor: dead reckoning across the holes in a track (`tracks.estimate`), the flights not named yet tried again until one aircraft fits (`waiting.cjs`: playback and live, one aircraft one flight), browsers' routes and learned flights taken, checked and handed out | – |
| `unit_shared` | Two built userscripts with the real monitor between them: a route worked out in one shown in the other (map and panel, confirmed destinations, never sent back), learned flights in every engine counted once, a playback flight asked about again and named once the monitor has worked it out | – |
| `unit_extension` | The built extension in a real Chromium: service worker, both worlds, requests through the worker | – (needs Playwright and Chromium; skipped without them) |
| `unit_native` | The built userscript's LADD Unblock window in a real Chromium, frame by frame, on a Vue 3 page made like FR24's map (`fixtures/fr24mock.html`) in seven layouts: opens in FR24's Widgets window, one bar item open, closes with flights and other options, Bookmarks switched off, the airport panel's empty bar never drawn | – (needs Playwright, Chromium and Vue 3's `vue.global.js` as `VUE_PATH`; skipped without them) |
| `unit_pbnative` | Playback buttons in a real Chromium on the Vue 3 mock (`?pb=1`): the bottom bar's left to FR24, a blocked flight's (panel, board card, search result, middle click) opening FR24's map playback at its take-off, the flight selected there | – (needs Playwright, Chromium and `VUE_PATH`; skipped without them) |
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
4. Add an entry to `CHANGELOG.md`.
5. Commit the rebuilt `dist/` (userscript, extension folder and zip) with the change. Now and then, refresh the runway data (`node monitor/mkdata.cjs`) and commit it after the tests pass.
6. Server: `bash ~/fr24-ladd/monitor/deploy.sh`.
7. Browser: reload the extension from the new zip, or install the new userscript build in Tampermonkey (a header change needs a reinstall). Keep the previous version as a backup.
8. Nothing to tag: once every test passes on `main` with a version that has no release yet, the release workflow publishes `v<version>` itself, with the zip, the userscript and the changelog entry as its notes. A change merged without a version bump is not released.
