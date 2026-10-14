# Architecture

This document explains how the FR24 LADD Unblocker is put together, how data flows through it, and why it is designed the way it is.

- [1. Goals and constraints](#1-goals-and-constraints)
- [2. Components](#2-components)
- [3. The userscript](#3-the-userscript)
- [4. The monitor](#4-the-monitor)
- [5. Data flows](#5-data-flows)
- [6. Design decisions](#6-design-decisions)
- [7. Failure modes and fallbacks](#7-failure-modes-and-fallbacks)

---

## 1. Goals and constraints

| Goal | Consequence for the design |
|---|---|
| Blocked and N/A aircraft should look **native** in FR24 | Data is written into FR24's own feed and API answers before FR24 renders them. No overlays. |
| **Responsiveness first**: the map must never stutter | All background work runs in short idle slices and pauses while the map is dragged or zoomed. Heavy jobs are moved to the server. |
| Predictions must be **honest and explainable** | No black-box model: weighted evidence terms with reasons. "Confirmed" only on a runway's final approach (99.8% on held-out data), otherwise at most 99%. |
| Never override FR24's own data | FR24's filed routes and airports always win. The script only fills what FR24 leaves empty. |
| Be **gentle** with free community networks | One centralised poller with a hard rate cap. Browsers stop polling lists once the monitor answers. Approval-gated APIs are not used. |
| Run for free | The monitor fits a 1 GB "Always Free" cloud VM and has no dependencies beyond Node.js. |

## 2. Components

```mermaid
flowchart TB
  subgraph browser["Browser tab (flightradar24.com)"]
    direction TB
    page["page.js<br/>page-world interceptor"]
    core["01-core<br/>store · HTTP lanes · monitor client"]
    res["02-resolver<br/>identification"]
    data["03-data<br/>airports · flight logs · registers"]
    routes["04-routes<br/>routes · recent flights"]
    ui["05/06-*<br/>strip · boards · log pages · playback · tools"]
    boot["07-boot<br/>start-up · message routing"]
    eng["engine.js<br/>route engine"]
  end
  subgraph server["Server"]
    mon["monitor.cjs"]
    eng2["engine.js (same file)"]
    store[("store/<br/>legs-YYYY-MM-DD.json<br/>state.json · hist/<hex>.json")]
  end
  page <-- "window.postMessage" --> boot
  res --> eng
  routes --> eng
  core -- "HTTPS + X-Monitor-Token" --> mon
  mon --> eng2
  mon <--> store
```

| Path | Role |
|---|---|
| `src/header.js` | Userscript header: version, permitted hosts (`@connect`), grants |
| `src/page.js` | Runs in FR24's page context. Patches `XMLHttpRequest` (FR24's gRPC-web feed) and `fetch` (its JSON APIs), and hooks FR24's Vue/Pinia stores |
| `src/engine.js` | The route engine: trace parsing, leg reconstruction, airport inference, destination scoring. Shared verbatim by the userscript and the monitor |
| `src/main/01-core.js` | Local store (IndexedDB), per-host request lanes and rate limits, idle-slice scheduler, monitor client |
| `src/main/02-resolver.js` | Matching anonymous FR24 flights to ADS-B transponders |
| `src/main/03-data.js` | Airports, OurAirports fields, flight logs (`loadHistory`), registers, photos |
| `src/main/04-routes.js` | Composing each flight's route; FR24's "Recent flights" |
| `src/main/05-ui.js`, `06-*.js` | The strip under the photo, pop-overs and tools, airport boards, aircraft/flight pages, playback |
| `src/main/07-boot.js` | Start-up, message routing between page and userscript, test exports |
| `build.mjs` | Concatenates everything into one file and packs the learned tables (gzip + base64) |
| `monitor/monitor.cjs` | The permanent server-side poller and API |

## 3. The userscript

### 3.1 Two worlds

Tampermonkey runs userscripts in an isolated context. FR24's own code runs in the page context. The script works in both:

- **Page world** (`page.js`, injected at `document-start`, before FR24's own code). It wraps FR24's network calls. Each feed frame (protobuf over gRPC-web) and API answer is read, then rewritten with identities, routes and telemetry *before FR24 decodes it*. FR24 then renders the result itself, so everything looks native. The same layer also:
  - hooks FR24's Pinia stores (playback state, the airport list, the sidebar), to hide adverts and keep learned private sites off the map;
  - pushes extra synthetic frames, so photos and routes appear without reopening a panel.
- **Userscript world** (`main/*`). It has cross-origin requests (`GM_xmlhttpRequest`), IndexedDB and all the logic. It talks to the page world with `window.postMessage`. Every message carries a type key, and messages from other origins are ignored.

### 3.2 Identification (resolver)

FR24 reports blocked flights without callsign or registration, but with position, altitude, speed, track and usually the aircraft type. The resolver matches them against public ADS-B:

1. **Candidate list.** The monitor's live list (`/live`, every 20 s) holds every LADD, military, PIA and known blocked aircraft heard worldwide in the last 5 minutes. When the monitor is unavailable or stale, the userscript fetches adsb.lol's LADD and military lists and adsb.fi's military list itself.
2. **Scoring.** Each candidate is projected to the moment of FR24's report (dead reckoning on its own speed and track), then scored on:
   - distance;
   - altitude, track and speed differences;
   - type relation (same / same family / unknown / different, and different rejects it);
   - registration agreement;
   - list flags.

   A match is accepted only when it is clearly the best: the second candidate must score at least 2.5 worse or be more than 8 km away. The distance allowed grows with speed, since fast jets move several kilometres while two sources' clocks disagree.
3. **Area lookups.** Flights not in any list (ordinary N/A traffic) are matched against area queries of the map view, alternating sources.
4. **Out of coverage.** Over oceans or deserts the resolver compares FR24's own trail of the flight with:
   - candidates carried forward from where they were last heard;
   - the day's traces of blocked aircraft of the same type;
   - adsb.lol's heatmap ("who was where FR24's track was, at that time").

   One unambiguous agreement is required.
5. **Parked aircraft.** On an apron no public network hears, the resolver uses the monitor's `/parked`: the only blocked aircraft of that type whose last flight ended at this airport and which has not flown since.
6. **Verification.** Every identified flight keeps being checked against new reports. A match is withdrawn only on overwhelming disagreement: far apart, repeatedly, for more than 3 minutes.

### 3.3 Flight logs

`loadHistory(hex, days)` builds an aircraft's log, one day at a time:

1. **Monitor first.** For a blocked aircraft, the days the monitor has already rebuilt (`/hist`) are taken as they are. The same goes for days it watched without a gap and never heard the aircraft fly, which are known to have no flights.
2. **adsb.lol for the rest.** Missing days come from adsb.lol's day traces (`globe_history/YYYY/MM/DD/traces/xx/trace_full_<hex>.json`, about 40 days available). Older days come from airplanes.live's public history files.
3. **Second network for gaps.** A day with a flight whose take-off or landing was not heard is merged with the other network's trace of that day.
4. **Learning.** Each flight also feeds the self-learning store, where the engine learns this user's aircraft. The monitor ships the learning fields (squawk blocks, FMS levels, flow keys) with each flight it rebuilt, because those need the raw positions.

Logs are stored in IndexedDB and shared across FR24 tabs (`BroadcastChannel`).

**Parity guarantee:** the monitor rebuilds a day with the *same engine file*, the same options (`legsFromPoints` to the end of the day, `summarizeLeg` with the aircraft's earlier flights as context) and the same output format. `test/unit_monlive.cjs` checks that a log taken from the monitor is identical to the one the browser builds from adsb.lol itself.

### 3.4 Route engine

`engine.js` has three layers:

- **Trace to legs.** It parses readsb traces (positions, altitude, speed, flags, callsign changes) and splits them into legs at landings. Ground reports count, and so do slow gaps, final approaches and "lost low beside a field". It joins legs split by coverage holes and merges circuits.
- **Legs to airports.** Take-off and landing are placed at:
  - airports;
  - the OurAirports fields FR24 does not list;
  - learned private sites, for helicopters.

  Each end gets a confidence: `ground`, `low` or `near`.
- **Prediction.** Every candidate airport is scored with a conditional-logit model over transparent evidence terms. Weights are learned per flight situation (time since take-off, kind of aircraft, height, distance). The population tables and weights are produced offline by the `test/pipe_*.cjs` pipeline from 63 days of worldwide traffic, and evaluated on held-out aircraft.

Prediction is cheap (a few milliseconds per aircraft) and runs in idle slices.

### 3.5 Staying responsive

FR24 must stay smooth, so the userscript treats CPU time as scarce:

- **Idle slices.** `idleSlice()` / `sliced()` run background work 8 ms at a time, only when the browser is idle, and not at all while the user drags or zooms the map.
- **Large answers.** Day traces, the live list and other large answers are parsed in an idle moment, never inside the network callback.
- **Request lanes.** Each host has its own lane (concurrency and spacing). Background work never takes the last free slots, so the aircraft you click is never stuck behind it.
- **Measurement.** `test/perf.cjs` measures main-thread stalls over 50 ms during two minutes of map use. Every change on the map path is compared with the previous version.

## 4. The monitor

### 4.1 Polling loop

A single loop sends **one request at a time**, at least 2 s apart, and never more than `apiPerMin` (default 20) adsb.lol API requests in any minute. Priority order:

| Every | What | Fallback when adsb.lol is paused or failing |
|---|---|---|
| 30 s | adsb.lol `/v2/ladd`: every FAA-LADD aircraft heard worldwide | OpenSky snapshot (below) |
| 60 s | adsb.lol `/v2/mil`: military aircraft worldwide | adsb.fi `/api/v2/mil`, then ADS-B Exchange (own key) |
| 120 s | adsb.lol `/v2/pia`: privacy (PIA) addresses | none; asked hourly if the endpoint 404s |
| 15 min max | OpenSky `/api/states/all`, keeping only known blocked aircraft | only while the LADD list has been silent for 3 minutes |
| 60 s | adsb.lol `/v2/point` for each area (home + up to 3 the user looked at) | adsb.fi `/api/v3/lat/…`, then ADS-B Exchange |
| 60 s | adsb.lol `/v2/hex/<100 hexes>` for blocked aircraft not on the LADD list | none |

A `429` pauses that host for 2 minutes. Refusals from OpenSky or airplanes.live pause them for 6 hours.

### 4.2 From positions to flights

Each report is appended to the aircraft's position rows. Every 2 minutes the rows go through the engine's `legsFromPoints` / `summarizeLeg`:

- Finished flights are stored and their positions released.
- A flight still under way stays open.
- A quiet aircraft (transponder off at the stand) is looked at again after 20 minutes, so its last flight is closed as landed.

Flights are written as one file per day (`legs-YYYY-MM-DD.json`) and kept for 90 days (blocked aircraft) or 4 days (all others).

### 4.3 Day logs (`/hist`)

Live polling samples every 30–60 s, which is coarser than adsb.lol's full traces, so it is not used for the browser's logs. Instead, 3 hours after each day ends (UTC), every blocked aircraft **heard in the air** that day is rebuilt from adsb.lol's full day trace. For a day with a flight whose take-off or landing was not heard, airplanes.live's file of the day is merged in. Each aircraft has one file (`hist/<hex>.json`, 90 days), read on request and never all held in memory.

A day can also be served as **"no flights"**, so the browser skips it entirely. The monitor claims that only when all of these hold:

- the day is over, and has been sent for rebuilding;
- the aircraft was known as blocked before the day began;
- the list that covers it watched it **without any gap over 200 s, all day**:
  - for an FAA-LADD aircraft that is the LADD list, and only if the aircraft was seen on that list with the LADD flag within 14 days of the day (an owner who left LADD is on no list);
  - for other blocked aircraft it is the address lookups;
- it was never heard airborne that day;
- no rebuild is pending or has failed for that day.

A day whose file never appears (retried every 2 hours for 36 hours), or whose rebuild fails, is marked unknown (`-1`). It is never claimed empty, and the browser reads it itself.

### 4.4 State and persistence

`state.json` holds:

- the blocked aircraft (registration, type, known since, last heard, FAA flag, last seen with the LADD flag);
- the areas;
- the watch record per day;
- the days still to rebuild;
- the time of the last run.

It is written atomically (temp file + rename) every 2 minutes and on `SIGTERM`/`SIGINT`, so a `systemctl restart` loses nothing. After downtime of more than 10 minutes, the days missed are read back from adsb.lol for every blocked aircraft.

### 4.5 API and security

Every endpoint except `/dash` requires the header `X-Monitor-Token` when `MON_TOKEN` is set. The secret is never put in a URL, because reverse proxies log URLs. Each address is limited to `MON_RATE` requests a minute. The monitor listens on `127.0.0.1` only. HTTPS (Caddy) terminates in front of it. The endpoints are listed in [monitor.md](monitor.md#api-reference).

## 5. Data flows

### Identifying a blocked flight

```mermaid
sequenceDiagram
  participant FR as FR24 feed
  participant P as page.js
  participant R as resolver
  participant M as monitor /live
  FR->>P: LiveFeed frame (flight without callsign)
  P->>R: pending flight (id, position, type, ...)
  M-->>R: live list (every 20 s)
  R->>R: score candidates, accept a clear best match
  R->>P: identity + route
  P->>FR: next frames rewritten (callsign, reg, type, route)
  Note over FR: FR24 renders it as ordinary traffic
```

### Building an aircraft's log

```mermaid
sequenceDiagram
  participant U as userscript
  participant M as monitor /hist
  participant L as adsb.lol
  U->>M: /hist?hex=a,b,c (batched)
  M-->>U: days rebuilt + days without flights
  U->>L: day traces only for the days still missing
  L-->>U: traces
  U->>U: engine: legs per day, store in IndexedDB
```

## 6. Design decisions

**Server for continuity, browser for interaction.** The monitor listens all the time and worldwide, which a browser tab cannot do. The browser reacts instantly to what is on screen, which the server cannot. Prediction stays in the browser. History and identification candidates come from the server.

**One engine, two places.** `engine.js` is the same file in both. This removes a whole class of disagreement between what the map, the boards and the logs say, and lets the monitor build logs the browser can use unchanged.

**Full-resolution traces for logs.** Live 30-second samples are good enough to place airports for boards, but not to reproduce the browser's logs exactly: take-off and touchdown times, circuits, and paths at fixed minutes. So day logs come from the same full traces the browser would fetch, fetched once on the server instead of once per viewer.

**Conservative empty days.** Telling the browser "no flights that day" saves many requests. Wrongly claiming it would silently delete flights from a log. Every condition in 4.3 exists to make a wrong claim impossible in the cases that can be foreseen. When in doubt, the day is left for the browser to fetch.

**Explicit fallbacks.** Every external dependency has a defined degraded mode (section 7), and a failing source never blocks the others.

**No dependencies on the server.** Only Node's standard library: nothing to audit, nothing to update, and it fits a 1 GB VM (about 280 MB at 90 days of history).

**Tests on real data.** Fixtures are recorded traces and FR24 answers from real flights the user reported (M-ARNZ, G-BOIL, OK-FLN, …). Fixes are proven against the case that exposed the bug.

## 7. Failure modes and fallbacks

| What fails | What happens |
|---|---|
| Monitor unreachable | The userscript polls adsb.lol / adsb.fi lists itself and fetches all log days from adsb.lol. The `127.0.0.1` monitor is not asked when a shared one is configured. |
| Monitor's LADD list > 90 s old | The userscript uses its own LADD and military lists |
| Monitor's military list > 3 min old | The userscript fetches the military list only |
| adsb.lol rate-limits the monitor | 2-minute pause. Military list and areas go to adsb.fi (then ADS-B Exchange with a key). After 3 silent minutes, OpenSky supplies blocked aircraft positions. |
| A day's trace is not published | Retried every 2 hours for 36 hours, then marked unknown for the browser |
| airplanes.live refuses the server | 6-hour pause. Affected days are marked for the browser to complete. |
| Monitor restarts | State saved on `SIGTERM`. Gap days re-read on start. `deploy.sh` rolls back a version that does not answer. |
| FR24 changes its internals | The interceptor only rewrites what it recognises. Unknown data passes through untouched. |
