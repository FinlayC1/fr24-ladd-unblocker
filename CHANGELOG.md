# Changelog

All notable changes to the FR24 LADD Unblocker. Versions follow `MAJOR.MINOR.PATCH`. The userscript and the monitor are released together.

## [22.21.0] - 2026-10-14

### Added
- **A permanent log of every blocked aircraft's departures and arrivals.**
  - Flights are kept on disk for good. A day's file is only ever added to, and the last 90 days are also held in memory.
  - Airport boards for any range of days, anywhere in the world, read older days from disk.
  - Flights that only FR24 sees, with no public ADS-B receiver hearing them, are logged from FR24's own track. FR24's trail is fetched as the aircraft lands. An ADS-B record of the same flight replaces the FR24 one when it comes.
  - Every blocked aircraft's completed flights feed the browsers' destination engine as learning rows (`/learn`).
- **Owners and operators looked up once, on the server** (`monitor/owners.cjs`).
  - Sources: hexdb, adsbdb and each aircraft's own register (FAA, UK G-INFO, Isle of Man, Swiss FOCA). The aircraft flying now are looked up first, gently.
  - Results are kept for good and refreshed after 60 days.
  - Browsers ask the monitor before any register (`/owners`). What a browser finds itself, including FR24's operator, goes back with its next report.
  - The names table carries each aircraft's owner and operator.
- `src/registry.js`: the register code, shared verbatim by the userscript and the monitor.
- **The map's airport panel, filled in:**
  - *Movements per day*: FR24's own schedule counted by local day, plus the blocked flights it does not show.
  - *Runway usage*: the runways the tracked flights used, worked out from each take-off and landing's track.
  - *Airport & runway details*: every runway in full (width, lighting, each end's heading, elevation and displaced threshold) and the airport's radio frequencies.
  - The *Latest events* part and the plea to help FR24's ground coverage are taken out.
- **Runway data:** `monitor/mkdata.cjs` builds `runway_info.json` (9,446 runways at 6,352 of FR24's 6,944 airports) and `freqs.json` (5,138 airports) from OurAirports, and refreshes `runways.json` / `runway_len.json`.
- Monitor endpoints `/owners` and `/airport`. Dashboard rows for owners and for flights logged from FR24 only.
- Tests: `unit_store`, `unit_registry`, `unit_panel`.

### Changed
- Every take-off and landing in the log records the runway used.

### Fixed
- **The LADD tag is always shown on an LADD aircraft.** A record made from a source without adsb.lol's database flags said "not LADD". It overrode the flag known from elsewhere when the tag was drawn, and overwrote it when saved: OK-VOS, a Gulfstream G600 on the LADD list, showed "ADS-B". Now:
  - LADD, PIA and military flags are sticky;
  - they are learned from every answer that carries them;
  - an aircraft named before its flag was known gets it at once, in the browser and in the monitor's names.
- OurAirports rows with commas inside quoted fields (10 runways) were split wrongly by the engine's CSV reader.

## [22.20.0] - 2026-10-14

The monitor names every blocked flight FR24 draws, anywhere in the world, and hands every name to a browser the moment FR24 opens.

### Added
- **FR24 world scan on the server** (`monitor/fr24.cjs`): FR24's whole map every two minutes, with a back-off when FR24 refuses.
- **Naming on the server** (`monitor/ident.cjs`). Every flight FR24 draws without a callsign or registration is matched against public ADS-B: the lists, address lookups, targeted area lookups, dead reckoning, FR24's trail and parked aircraft. Names are withdrawn on disagreement.
- **Rough destinations on the server** (`monitor/dest.cjs`): every named airborne flight, with an estimated arrival, using the same engine and learned weights as the browser.
- `/fr24ids`: the whole names table on connect, then every 20 s what changed (new names, moved positions, withdrawn names). The browser hands names straight to the page, so FR24's first frame of any of those flights is drawn named.
- `POST /report`: browsers pass on FR24's feed headers, the callsign-less flights they see, and the names they found themselves.
- **Browser extension** for Chrome and Edge (Manifest V3), built from the same script into `dist/extension/` and a zip.

### Changed
- Faster public ADS-B:
  - the LADD list every 10 s and the military list every 30 s;
  - recently heard blocked aircraft by address every 30 s (the rest every 10 minutes);
  - browsers take the live list's changes every 5 s.
- The browser's own world scan runs only while the monitor's FR24 scan is not working.

### Removed
- The local `127.0.0.1` monitor: the userscript uses the shared monitor only (no `@connect 127.0.0.1` / `localhost`).

## [22.19.1] - 2026-10-14

### Added
- **Backup data sources for the monitor**, each used only when the one before it fails:
  - adsb.fi's military list and area query while adsb.lol rate-limits;
  - ADS-B Exchange, with the user's own key only and at most 150 requests a day;
  - an OpenSky Network world snapshot, keeping the blocked aircraft in it, while adsb.lol's LADD list has been silent for 3 minutes (at most every 15 minutes).
- Dashboard rows for the backups.

### Changed
- Area queries to adsb.fi use its current `v3` endpoint, falling back to the deprecated `v2` one.

## [22.19.0] - 2026-10-14

The monitor becomes the primary worldwide identifier and the source of flight history.

### Added
- Monitor polls adsb.lol's worldwide **military** and **PIA** lists, as well as the LADD list.
- `/live`: every LADD, military, PIA and blocked aircraft heard in the last 5 minutes, with each list's age.
- `/hist`: each blocked aircraft's finished days, rebuilt from adsb.lol's full day traces in the userscript's own log format. Days watched without a gap and not heard flying are reported as having no flights.
- Hard cap of 20 adsb.lol API requests a minute.
- `monitor/deploy.sh`: update, verify and automatic rollback on the server.
- `monitor/vm-setup.sh`: run the service from a git checkout, with compressed HTTPS.
- `monitor/merge-store.cjs`: merge another monitor's flights and blocked aircraft without duplicates.
- Dashboard: list ages, request rate, live list size, day-log progress.

### Changed
- With a shared monitor configured, the userscript never asks a monitor on `127.0.0.1`.
- The userscript takes the monitor's live list (every 20 s, in idle slices) instead of polling the LADD and military lists itself. It falls back to its own requests when the monitor is down or stale.
- Flight logs of blocked aircraft take the monitor's days first, asked for in batches. Only the remaining days are fetched from adsb.lol.

### Fixed
- The monitor saves its state on `SIGTERM`. Previously a `systemctl restart` could lose up to 2 minutes of data.
- An aircraft that leaves the LADD programme moves to address lookups instead of going unwatched.

## [22.18.3] - 2026-10-13
### Added
- Shared monitor on a server: an HTTPS address and a secret in the strip's *sources* pop-over.
- Monitor secret (`X-Monitor-Token`) and per-client rate limit.
- `/dash` dashboard and `/stats`.

## [22.17.0] - 2026-10-11
### Added
- Free runway data on airport pages.
- Search results for blocked aircraft and their callsigns.
- Movements tables.
- Naming of private landing sites from OpenStreetMap.

### Fixed
- Tables built by the script were hidden by FR24's stylesheet on old data pages.

## [22.16.0] - 2026-10-10
### Added
- Airport data pages: boards, statistics and routes include blocked flights.
- Playback telemetry synchronised to FR24's frame time.
- Flight-number pages answered from the monitor.

### Changed
- Learned private landing sites are never drawn as map pins (22.16.2).
- No data-source credit on the strip (22.16.1).

## [22.15.0] - 2026-10-10
### Added
- Identification in FR24's map **playback**, from adsb.lol's heatmaps.
- Logos for operators FR24 lacks.
- Learned landing places on boards.

### Changed
- Playback links go to airplanes.live's globe.

## [22.14.0] - 2026-10-08
### Added
- **Ocean identification**: FR24's trail laid against adsb.lol traces and heatmaps (22.14.2–22.14.3).
- Identification of parked aircraft from the monitor's `/parked` (22.14.4).
- Approach-path table v3 (99.85% right on held-out jets).
- Swiss register.

## [22.13.0] - 2026-10-07
### Added
- **Permanent monitor** (`monitor/monitor.cjs`): adsb.lol polling, flights per day, `/board`, `/legs`, `/last`.
- Airport boards merged into one ±3-day list.
- Links strip for N/A flights.

## [22.12.0] - 2026-10-02
### Added
- Split flights rejoined.
- Trustee owners replaced by operators.
- 90-day log rows and airport-board archive.
- Learned arrival paths (22.12.2).

## [22.10.0] - 2026-10-01
### Changed
- Route engine retrained on 63 days of worldwide traffic. Accuracy on held-out aircraft rose from 60.4% to 67.6%; for LADD aircraft from 52.2% to 56.3%.

### Added
- Weather and NOTAM evidence.
- Odds calibration.

## [22.9.0] - 2026-09-27
### Added
- Advertisements and the advert sidebar removed seamlessly.

## [22.8.0] - 2026-09-25
### Added
- Destination prediction for every N/A flight (military, private, GA, helicopters), with private landing sites.

Earlier versions: see [docs/maintainers/notes](docs/maintainers/notes/).
