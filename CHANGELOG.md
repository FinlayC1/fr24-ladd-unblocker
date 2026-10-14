# Changelog

All notable changes to the FR24 LADD Unblocker. Versions follow `MAJOR.MINOR.PATCH`. The userscript and the monitor are released together.

## [22.23.0] - 2026-10-14

Playback names blocked flights the moment they are shown, and the monitor keeps 90 days of tracks and learns from them.

### Added
- **The monitor keeps every blocked aircraft's track for 90 days** (`trackDays`), thinned to a point a minute in the air and one every five minutes on the ground, in `tracks/YYYY-MM-DD.json.gz`. That covers the 7 days of FR24's default playback many times over.
- **Instant playback names (`POST /pbmatch`).** The browser sends the moment and the unnamed flights it is showing in one request, and the monitor names each one from the names it gave live, or from where each blocked aircraft was heard at that moment. It names a flight from a track only when one aircraft of a fitting type alone fits it. The flight's route comes back with it, so the panel fills at once. A monitor without it falls back to `/names`.
- **Learning over 90 days (`GET /learned`).** The monitor learns the destination engine's tables from its last 90 days of learning rows (`learnDays`) and sends them as one snapshot. The browser keeps it and applies it on the next page load, then learns only the rows the snapshot does not cover.

### Changed
- **The live LADD list stays fresh while days are rebuilt.** The rebuild workers wait while adsb.lol is paused or the LADD list is more than three polls old (`backfillWaits` in `/status`).

## [22.22.1] - 2026-10-14

### Added
- **Airspeeds, Mach, wind and temperature over the US and the oceans.** Public ADS-B has them only where radars ask aircraft for them (Mode S EHS: Europe), so over the US those fields stayed "N/A" (JCO55 over South Dakota). The monitor now works them out (`monitor/wx.cjs`):
  - wind and temperature at the aircraft's height come from NOAA's GFS weather model, via Open-Meteo (CC BY 4.0), for 5-degree cells where such aircraft fly, refreshed every 12 hours;
  - true airspeed is the ground speed less the wind, then Mach, indicated airspeed, wind and temperature follow from it.
  - These are estimates, typically within about 10 kt and 2 °C. An aircraft's own figures always win.
  - The weather requests keep under Open-Meteo's free limits a minute, an hour and a day (450, 4,000 and 7,000 weighted calls; 20 cells a request), so a busy moment no longer earns a refusal and an hour's pause. A cell answered without usable levels is let go for an hour instead of being asked for again at once. Tested in `unit_wx`.
- The browser keeps the monitor's airspeed figures for two minutes when its own newer poll has none, instead of blanking them every other poll.

## [22.22.0] - 2026-10-14

Every copy now shares one monitor, padlocks are gone, and airport boards no longer invent flights.

### Added
- **Every copy connects to the shared monitor by default.** It needs no setup and no secret. The strip's *Sources* menu can point it at your own monitor, or turn it off.
  - A monitor is public unless set otherwise (`"public": false` or `MON_PUBLIC=0`). Reading needs no secret; the owner's secret opens the dashboard's numbers and the full answers. Each address gets 300 requests a minute; the owner is never limited.
  - Reports from strangers are checked before they are used:
    - A name is taken from one browser only when the monitor's own ADS-B data puts that aircraft where FR24 draws the flight. If its own data says otherwise, the name is refused however many browsers send it. Otherwise two browsers must agree.
    - Owners need two browsers sending the very same findings.
    - A stranger's FR24 positions never overwrite the monitor's own scan.
  - The shared monitor names an owner only when the register shows an organisation. Private individuals' names and towns are withheld.
  - The flights it logs are offered under the ODbL (`/export/legs?day=`).
- **No padlocks.** Every padlock FR24 draws for a free account is cleared, on any aircraft: vertical speed, GPS altitude, airspeeds, Mach, wind, temperature, squawk and airspace.
  - The values come from public ADS-B. The monitor keeps the newest report of every aircraft it hears (`monitor/tel.cjs`, `/tel`, and full figures in `/near`).
  - An aircraft clicked is asked of the monitor and of the browser's own source at once, and the first answer is drawn.
  - With no public report, the vertical speed is worked out from FR24's own altitudes (seeded from the panel's trail), and the airspace from the FIR/UIR boundaries. Nothing is made up: a vertical speed nothing tells yet stays FR24's own for a flight's first seconds.
  - On FR24's flight-history pages (`/data/aircraft/…` and now `/data/flights/…`), the playback panel's padlocked figures and serial number are filled in. The padlocked **KML** and **CSV** buttons become working downloads of the flight's public ADS-B track (adsb.lol / airplanes.live, ODbL), in FR24's own CSV columns.
- **Shared polling (50/50).**
  - The map's view is polled from the monitor every other time, halving each browser's own requests to adsb.lol and adsb.fi.
  - What a browser's own polls found goes back to the monitor every 30 s and serves every other browser. Rows are checked: physical values only, fresh, never over the monitor's own report of the last minute, never far from where the monitor heard the aircraft.
  - The monitor's own area polls alternate between adsb.lol and adsb.fi, and it follows 8 of the places browsers look at (was 3).
- **Names found in playback are kept for good.** A browser that names an FR24 flight in playback reports it. The monitor keeps it with the day of the flight (`names/YYYY-MM-DD.jsonl`), and any later playback of it, by anyone, is named from the archive at once. It is taken from one browser when the monitor's own log has the aircraft in the air then, otherwise from two.
- **A standby monitor**, ready for one: the browser uses the first shared monitor that answers, and moves to the next when it stops answering.
- Dashboard rows for public mode, names from browsers, the names archive and the figures held.
- Tests: `unit_boards`, `unit_padlocks`, `unit_public`, `unit_vectoring`.

### Changed
- A monitor that stops answering is looked at again after 30 s, not 5 minutes.
- Browsers send FR24's feed headers (its device id for that browser) only to a monitor of their own, never to the shared one.
- A public monitor's dashboard keeps request paths without their query, so where a map was and which aircraft was opened are not kept against an address. Reporters' addresses are kept in memory for 30 minutes (live names) or 6 hours (playback names, owners) at most.
- `deploy.sh` limits the server's system log, including the web server's access log, to 14 days.
- [PRIVACY.md](PRIVACY.md), [docs/legal.md](docs/legal.md), [LICENSE](LICENSE) §2(b) and [docs/monitor.md](docs/monitor.md) describe the shared monitor.
- **The GitHub page:** a new download-style README with light and dark graphics in FR24's own charcoal and blue, a GitHub Pages site (`site/`, `.github/workflows/pages.yml`) and new extension icons.

### Fixed
- **False "Liverpool → Liverpool, landed" flights on airport boards.** EI-EVN, as RYR8SF at 17:33, an hour before it left for Szczecin, was one of many. FR24's own flights with an origin but no destination yet sat through a long taxi. On the take-off roll FR24's ground flag flickered: "airborne" at 110 kt, then "on the ground" again. The take-off time had been taken from the second report of the taxi, so the roll passed for an approach to the field being left and the flicker for a landing there. The same-field check then let it through because its take-off time was 0. Now:
  - a flight is routed only once it has been seen flying, at least two reports off the ground at flying speed;
  - its take-off is the first of them;
  - an approach or a landing must come in from further out;
  - a flight back where it began needs a seen take-off and a real flight: up long enough, high enough, far enough (`ENGINE.localFlew`; light aircraft, helicopters and fast jets can fly real circuits);
  - rows an older version kept of such flights are removed when the board is read;
  - the monitor's own boards apply the same rule.
- **"Possible destination: RAF Valley" while N99GY was being vectored for Dublin.** The alternatives' odds were scaled up when the shown odds of the destination were capped, which turned a hundredth of a percent into 10%. That scaling is now capped, alternatives under 2% are never offered, and a destination held at 90% or more on the way down is kept while the aircraft is vectored round for its runway.
- The monitor's check of a browser's name used a list of aircraft up to 10 s old, so an aircraft heard in between was not checked at all. Each name is now checked against the aircraft as heard at that moment.
- Owner findings waiting for a second browser were never let go. They are now dropped after 6 hours.

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
