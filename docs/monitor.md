# The monitor

`monitor/monitor.cjs` is the always-on half of the project. It does the work that has to be continuous and worldwide, so that a browser opening FR24 anywhere has it all at once:

- **Public ADS-B, worldwide.** It polls the LADD, military and PIA lists and every known blocked aircraft by address, and turns positions into flights with the route engine.
- **FR24 itself.** It scans FR24's whole map every two minutes and names every flight FR24 draws without a callsign or registration (`ident.cjs`), over oceans and deserts too. Each named flight gets a rough destination (`dest.cjs`).
- **A permanent log.** Every blocked aircraft's take-offs and landings are kept for good, including flights only FR24 sees. The log feeds airport boards anywhere in the world and the browsers' destination engine (`/learn`).
- **Owners and operators.** Each blocked aircraft's owner is looked up once and kept (`owners.cjs`).
- **Airports.** It serves every runway in full, the radio frequencies, and which runways the flights it tracked used (`airport.cjs`).
- **Airspeeds where no radar asks for them.** Over most of the US and the oceans no receiver hears an aircraft's airspeeds, Mach, wind or temperature (Mode S EHS is asked for by European radars, not American ones). The monitor works them out from NOAA's GFS weather model (`wx.cjs`, via Open-Meteo) and the aircraft's own ground speed, track and height, as estimates marked `wx: 1`; real figures always win.
- **The figures FR24 padlocks, for any aircraft.** It keeps the newest public ADS-B report of every aircraft it hears (`tel.cjs`): vertical speed, GPS altitude, airspeeds, Mach, wind, temperature, squawk. A browser asks it for the aircraft just clicked (`/tel`) and for its map every other time (`/near`). It then asks the networks itself only half as often, and what each browser fetched is shared with the rest.
- **Shared by every copy.** A monitor is public by default: every copy of the script connects to the project's shared monitor unless its user points it elsewhere or turns it off. Reading needs no secret. Reports from strangers are checked (see [Public mode](#public-mode)), and the owner's secret still opens everything.

It answers the browsers over a small HTTP API. How it fits into the whole is described in [architecture.md](architecture.md).

- [Requirements](#requirements)
- [Running it](#running-it)
- [Configuration](#configuration)
- [What it keeps](#what-it-keeps)
- [API reference](#api-reference)
- [Public mode](#public-mode)
- [Airport and runway data](#airport-and-runway-data)
- [Server setup (Oracle Cloud)](#server-setup-oracle-cloud)
- [Updating](#updating)
- [Moving another monitor's data in](#moving-another-monitors-data-in)
- [Dashboard](#dashboard)
- [Operations and troubleshooting](#operations-and-troubleshooting)

---

## Requirements

- Node.js **18 or later** (tested on 18.19.1 and 22). The monitor uses only the standard library, so no `npm install` is needed.
- About **300–400 MB of RAM** with 90 days of history for about 10,000 blocked aircraft and FR24's names, and a few GB of disk. The log on disk grows by a few MB a month.
- Outbound HTTPS to:
  - ADS-B: `api.adsb.lol`, `adsb.lol`, `opendata.adsb.fi`, `opensky-network.org`, `globe.airplanes.live` (and `adsbexchange-com1.p.rapidapi.com` if a key is set);
  - FR24: `data-feed.flightradar24.com`;
  - owner lookups: `hexdb.io`, `api.adsbdb.com`, `registry.faa.gov`, `ginfoapi.caa.co.uk`, `ardis.iomaircraftregistry.com`, `app02.bazl.admin.ch`;
  - weather aloft: `api.open-meteo.com`.

## Running it

```bash
node monitor/monitor.cjs
```

By default it listens on `127.0.0.1:47524`, keeps its data in `monitor/store/` and reads airports from `monitor/data/`. On its own computer, with no secret set, it answers anyone on that computer. On a server, always set `MON_TOKEN` and put an HTTPS proxy in front of it (see [Server setup](#server-setup-oracle-cloud)). For a monitor only your own browsers use, also set `MON_PUBLIC=0` (see [Public mode](#public-mode)).

Stopping it with Ctrl+C or `systemctl stop` (SIGINT/SIGTERM) saves everything first.

## Configuration

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `MON_HOST` | `127.0.0.1` | Address to listen on. Keep it local and put a proxy in front. |
| `MON_PORT` (or `PORT`) | `47524` | Port |
| `MON_TOKEN` | *(none)* | The owner's secret, sent as the header `X-Monitor-Token`. It opens the dashboard's numbers (`/stats`) and the owner's full answers. It is never subject to the rate limit. On a private monitor, every request except `/dash` needs it. |
| `MON_PUBLIC` | *(the `public` setting: on)* | `0`: a private monitor that answers only requests carrying the secret. `1`: public, readable by every copy of the script. |
| `MON_RATE` | `300` on a public monitor, `0` (off) on a private one | Requests per minute allowed per client address (the owner's never limited) |
| `MON_DATA` | `monitor/data` | Airports, runways, frequencies and airfields (`airports.json`, `runways.json`, `runway_len.json`, `runway_info.json`, `freqs.json`, `oa_airports.csv`) |
| `MON_STORE` | `monitor/store` | Where flights, state and day logs are kept |
| `MON_ADSBX_KEY` | *(none)* | Your own ADS-B Exchange RapidAPI key, used only as a last backup. Put it in an `EnvironmentFile` readable only by root, never in the unit itself. |

### `monitor/monitor.json` (optional)

Any of these can be overridden in a `monitor.json` next to `monitor.cjs` (the file is git-ignored):

| Key | Default | Meaning |
|---|---|---|
| `areas` | `[[53.8, -2.6, 250]]` | Areas polled for all traffic: `[lat, lon, radius nm]` |
| `userAreas` | `8` | Extra areas taken from where the browsers look (kept 3 days). Every other area round is asked of adsb.fi first, so each network is asked half as often. |
| `laddEvery` / `milEvery` / `piaEvery` | `10` / `30` / `120` | Seconds between LADD, military and PIA list polls |
| `areaEvery` | `120` | Seconds between area rounds |
| `hexEvery` / `coldEvery` / `hotWindow` | `30` / `600` / `2700` | Address lookups: aircraft heard in the last `hotWindow` seconds every `hexEvery` s, the rest every `coldEvery` s |
| `hexBatch` | `100` | Addresses per lookup request |
| `apiPerMin` | `20` | Most adsb.lol API requests in any minute (on top of the 2 s gap) |
| `openskyEvery` | `900` | Least seconds between OpenSky snapshots (only while adsb.lol's LADD list is silent) |
| `adsbxDaily` | `150` | Most ADS-B Exchange requests a day (shares your RapidAPI quota with the browser) |
| `liveMaxAge` | `300` | Seconds an aircraft stays in `/live` after its last position |
| `closeDelayH` | `3` | Hours after midnight UTC before a day's logs are rebuilt |
| `fullGap` | `200` | Longest silence (s) of a list for a day to count as watched throughout |
| `backWorkers` | `3` | Parallel workers reading adsb.lol's day traces |
| `fr24Scan` | `true` | Scan FR24's map from the server. Set to `false` to leave the world scan to the browsers. |
| `fr24Every` / `fr24Gap` | `120` / `400` | Seconds between FR24 world scans; milliseconds between the requests of one scan |
| `lookupRadius` | `220` | Nautical miles of each adsb.fi area lookup around unnamed FR24 flights |
| `owners` | `{}` | Owner lookups: `every` (ms between aircraft, `4000`), `refreshDays` (`60`), `retryMin` (`60`) |
| `ident` / `dest` | `{}` | Fine-tuning of the naming (`keepFlightH`, `trailEvery`…) and of the rough destinations (`every`, `perRound`, `budgetMs`) |
| `public` | `true` | Answer every copy of the script (see [Public mode](#public-mode)); `MON_PUBLIC` overrides it |
| `rate` | `300` | A public monitor's requests per minute per client address; `MON_RATE` overrides it |
| `areaPerHour` | `4` | On a public monitor, new places one address other than the owner's may add with `/area` in an hour; beyond it the request is answered and nothing is added |
| `seedPerHour` | `300` | On a public monitor, aircraft not yet followed that one address other than the owner's may add with `/seed` in an hour |
| `crowdNeed` | `2` | How many different browsers must send the same name or owner before a public monitor takes it, when it cannot check it itself |
| `nearPerMin` | `30` | adsb.fi lookups a minute for places the monitor has heard little of, for all browsers together (one per 1-degree cell a minute) |
| `telMax` | `30000` | Aircraft whose newest report is held for the padlocked figures |
| `trackDays` | `90` | Days each blocked aircraft's track is kept (see [What it keeps](#what-it-keeps)) |
| `learnDays` | `90` | Days of learning rows the monitor learns from itself for `/learned` |
| `routesPerHour` / `learnPerHour` | `600` / `600` | On a public monitor, routes and learned flights one address other than the owner's may send in an hour (`/report`); beyond it they are answered and not taken |
| `waiting` | `{}` | The flights not named yet (`waiting.cjs`): `keepDays` (`3`), `max` (`10000`), `maxPts` (points kept a flight, `60`), `sample` (points tried, `10`), `recentH` (hours a flight counts as recent, `6`) |
| `waitMs` / `pbReckonMs` | `400` / `400` | Milliseconds the background spends on the waiting flights every 15 s; that one `/pbmatch` request may spend on them (all requests together at most one second in five) |
| `wx` | `{}` | The weather model for estimated airspeeds (`wx.cjs`): `cellDeg` (`5`), `everyS` (seconds between refreshes of a cell, `43200`), `batch` (cells a request, `20`), `gapMs` (`6000`), `minCap` / `hourCap` / `dayCap` (weighted calls a minute, an hour, a day: `450`, `4000`, `7000`; Open-Meteo allows 600, 5,000 and 10,000), `badS` (seconds a cell answered without usable levels is let go, `3600`) |

For example, to poll more gently, create `monitor/monitor.json` containing `{ "apiPerMin": 12, "piaEvery": 600 }` and restart the service.

## What it keeps

Everything is in `MON_STORE` (default `monitor/store/`):

| File | Contents | Kept |
|---|---|---|
| `legs-YYYY-MM-DD.json` | Every flight of that day: take-off and landing airports and times, runways used, whether the aircraft is blocked | **For good** for blocked aircraft (the file is only ever added to); 4 days for the rest |
| `hist/<hex>.json` | A blocked aircraft's finished days, in the browser's own flight-log format | For good |
| `learn/YYYY-MM-DD.json` | Learning rows: every blocked aircraft's completed airport-to-airport flights of that day | For good |
| `learn-crowd/YYYY-MM-DD.json` | Learning rows the browsers sent (flights each rebuilt itself), with the number of the report that brought each | For good |
| `waiting.json` | The flights not named yet: FR24 id, type, the positions known of it | 3 days after its last position |
| `ident.json` | FR24's callsign-less flights and the names given to them | Life of the flight (6 h after FR24 stops drawing it) |
| `names/YYYY-MM-DD.jsonl` | Every name given to an FR24 flight (live, found by a browser in a playback, or worked out later from its path): `[FR24 id, hex, reg, type, callsign, flags, named at]` and, for one worked out later, how (`track`, `reckon`); a withdrawn one again with no hex | For good. The last two weeks are also held in memory; an older day is read when a playback of it asks. |
| `tracks/YYYY-MM-DD.json.gz` | Every blocked aircraft's track that day, thinned to a point a minute in the air and one every five minutes on the ground (both points of every take-off and landing kept) | 90 days (`trackDays`) |
| `learned.json` | The destination engine's tables learnt from the last 90 days of learning rows (`learnDays`), rebuilt every 6 hours and after each day's logs | Replaced on each rebuild |
| `owners.json` | Each looked-up aircraft's owner, operator, serial number, build year | For good; asked again after 60 days |
| `state.json` | Blocked aircraft, watch records, pending day logs, areas, FR24 request headers | Running state |

Day rebuilds give way to the live lists: while adsb.lol is paused or the LADD list is more than three polls old, the rebuild workers wait (up to 10 minutes at a time), so the live list stays fresh.

Flights of the last 90 days are held in memory as well. Older ones are read from disk when a board for those days is asked for.

**In memory only.** The newest public ADS-B report of each aircraft, its own or a browser's, is held for 2 minutes (15 for one on the ground). The places browsers look at are held for 3 days, rounded to a degree. For counting agreeing browsers, the addresses that reported a name or an owner are held for 30 minutes (live names) or 6 hours (playback names, owners). The dashboard holds the last 2,000 requests: address, time and path, without the query on a public monitor. Nothing of this is written to disk.

**Flights only FR24 sees.** A blocked flight FR24 draws that no public receiver hears (FR24's own receivers, satellites, multilateration) is logged too. Once FR24 has stopped drawing it for 15 minutes, or has had it on the ground for 15 minutes, its FR24 track is read by the same engine as an ADS-B trace. The trail is fetched as the aircraft lands. Only a flight that reads as a landing at an airport is kept. An ADS-B record of the same flight replaces it when one comes.

**Runways.** For each take-off and landing at an airport the monitor works out which runway was used. It looks at the end whose extended centreline the aircraft was on, going that way: down the final approach for a landing, climbing out from the threshold for a take-off. Every position near the field counts, weighed by how close to the centreline it was and how well its track agreed. It gives one clear answer or none, so parallel runways are told apart or left unsaid.

## API reference

All answers are JSON. On a public monitor every endpoint answers without the secret except `/stats` (`401`). With the secret, `/status` and `/area` add the areas being polled, and `/owners` adds private owners' names. On a private monitor every request needs `X-Monitor-Token: <secret>`, or the answer is `401`. Above the rate limit the answer is `429` with `Retry-After: 30` (never for the owner).

| Endpoint | Answer |
|---|---|
| `GET /status` | What the monitor has and how its sources are doing: its version and commit (`ver`, `commit`), polls, failures, aircraft, blocked aircraft, flights, live list size, age of each list (`listAge`), adsb.lol requests in the last minute, day-log progress (`hist`), paused hosts, `tracks`, `playback` (names given from `/pbmatch`), `learned` (its version and days, `fromBrowsers`), `waiting` (flights not named yet, from playbacks and live; named later, by track or carried across a gap; tries), `shared` (routes and learned flights taken from browsers, refused; `destsDropped`, browsers' destinations dropped when the flight came no nearer), `backfillWaits` (times the day rebuilds waited for the live LADD list) |
| `GET /live[?since=<ms>]` | `{ v, now, full, age: {ladd, mil, pia, hex}, ac: [...] }`: every LADD, military, PIA and blocked aircraft with a position in the last 5 minutes. Each entry is a readsb v2 row with `seen_pos` counted to `now`, plus `_from: [airportId, confidence]` and `_off` (take-off time) for a flight under way. With `since` (the `now` of the last answer, under a minute old) only the aircraft heard again since then; browsers ask every 5 s. |
| `GET /fr24ids[?since=<ms>]` | `{ v, now, full, scanOk, rows, pos, gone }`: every FR24 flight without a callsign the monitor has named. Each row is `[FR24 id, hex, reg, type, callsign, flags (1 LADD, 2 military, 4 PIA), how named, named at, origin id, origin confidence, destination id, its chance %, worked out at, lat, lon, alt, on ground, FR24 position time, estimated arrival, departure time, owner, operator, FR24 operator id, operator ICAO, whose route (0 the monitor's, 1 a browser's, 2 a destination confirmed in a browser), the destination's word when it is a browser's (`likely`, `confirmed`…), 1 when the origin is a browser's]`. A browser's origin is used for as long as the flight is named. Its destination is used until, an hour on, the flight has come no nearer to it; a confirmed one stays. With `since`, only rows that changed, `pos` (`[id, lat, lon, alt, on ground, time]`) for flights that only moved, and `gone` (ids withdrawn). `scanOk` says the monitor's own FR24 scan is working. |
| `POST /report` | A browser's report, up to 4 MB of JSON. It can contain:<br>• `hdr`: FR24's feed headers, sent only to a monitor of the user's own, never an authorization;<br>• `flights`: the callsign-less flights it sees;<br>• `ids`: `[id, hex, how]`, flights it named itself;<br>• `owners`: `[hex, {owner, operator…, regAnswered, regOwner}]`, owners it looked up itself;<br>• `pbIds`: `[id, hex, reg, type, callsign, flags, moment]`, names it found in a playback;<br>• `tel`: compact rows of its own polls of adsb.lol / adsb.fi;<br>• `routes`: `[id, hex, origin id, its word, destination id, its chance %, its word, ETA, departed]`, routes it worked out for flights named here (with the aircraft's log, its take-off seen, or a destination confirmed). Refused for another aircraft than the one named, or a destination behind the flight. Each end is taken on its own: an origin alone leaves the destination another browser sent. An end from the owner's browser stands 20 minutes, a confirmed destination stands, and for 20 minutes a destination is not replaced by another airport more than 10 points less sure;<br>• `learn`: learning rows of flights it rebuilt itself. Taken when a row reads as a real flight and the monitor has no flight of that aircraft then.<br>The answer counts what was taken (`routes`, `learned`) and gives `learnNot` (the places in `learn` of the rows not taken) and `learnSeq` (the report's number). On a public monitor all of it is checked first: see [Public mode](#public-mode). |
| `GET /near?lat=&lon=&r=<km>` | Every aircraft heard within `r` km in the last two minutes, as readsb v2 rows with the padlocked figures. A place heard little of is looked up on adsb.fi first. |
| `GET /tel?hex=a,b,…[&lat=&lon=]` | The newest report of up to 100 aircraft. One with nothing fresh, given where FR24 draws it, is looked up there first. |
| `GET /names?ids=a,b,…&t=<s>` | The names given to these FR24 flights, for a playback at moment `t`: rows `[id, hex, reg, type, callsign, flags, named at]` (up to 2,000 ids) |
| `GET /export/legs?day=YYYY-MM-DD` | That day's logged flights, under the ODbL (the licence named in the answer) |
| `GET /owners?hex=a,b,…` | Up to 500 aircraft's owners and operators: rows `[hex, reg, type, description, owner, owner's city, country, country ISO, serial number, build year, FR24 operator id, operator ICAO, operator name, looked up at, registers answered]`. Only aircraft it knows are listed. |
| `GET /airport?ap=<id>[&days=7]` | An FR24 airport's runways in full (`runway_info.json` rows), radio frequencies, and `usage` (`[runway, take-offs, landings]`) of the flights it tracked there in the last `days` (1–14), with `moves` and `withRunway` counts |
| `POST /pbmatch` | Names for a playback at moment `t`, from where the monitor heard each blocked aircraft at that moment. Body `{ t, f: [[FR24 id, lat, lon, alt ft, ICAO type, on ground 0/1], ...] }` (up to 1,500 flights). Answer `{ v, t, list }`, rows `[id, hex, reg, type, callsign, flags, how ('live' if named live, 'track' if matched by its track, 'reckon' if carried across a hole in it), its flight]`. A flight is named from its track only when exactly one kept aircraft of a fitting type was within a few miles and that aircraft fits no other flight. One not named stays on the waiting list: each moment asked about adds to its path, which is tried against the tracks as they grow; a name found later is in the answer to the next ask. |
| `GET /learned[?have=<ver>]` | The engine's tables learnt from the last 90 days (its own flights and the browsers'), as table operations the browser applies on its next page load, with `builtSeq` (the number of the last browser report it has). `{ v, ver, same: true }` when `have` is current; `{ v, ver: '', none: true }` before the first build. |
| `GET /learn?from=YYYY-MM-DD` | Learning rows of the finished days after `from` (two weeks at most, not today), for the browsers' destination engine |
| `GET /hist?hex=a,b,…` | Up to 20 blocked aircraft's finished days in the userscript's flight-log format: `{ hv, list: [{ hex, days: {'YYYY/MM/DD': flights}, legs: [...] }] }`. `0` flights means watched all day and not heard flying. Days still pending or failed are left out. |
| `GET /legs?hex=a[,b…]` | Aircraft's flights kept here (90 days), joined and chained as logs show them |
| `GET /board?ap=<id>[&from=&to=]` | Flights at an FR24 airport id, three days back by default. Any range can be asked for: days older than 90 are read from the log on disk. |
| `GET /flights?cs=<callsign>` | Every kept flight under a callsign, newest first (200 max) |
| `GET /parked?ap=<id>&type=<icao type>` | Aircraft of that type whose last flight in 14 days ended at that airport |
| `GET /last` | Where each blocked jet (and each other business jet cruising) was last heard in 14 hours, used for ocean identification |
| `GET /ladd` | The LADD list as last polled (kept for older userscript versions) |
| `GET /seed?hex=a,b[&front=1]` | Tell the monitor about blocked aircraft the userscript identified. They are tracked from then on and their last three days are rebuilt. On a public monitor, other people's browsers add at most `seedPerHour` new aircraft an hour each. |
| `GET /area?lat=&lon=` | A place the userscript is looking at. Its traffic is polled too, for three days. On a public monitor, other people's browsers add at most `areaPerHour` new places an hour each. |
| `GET /stats` | The dashboard's numbers: memory, load, requests per endpoint and per client, recent requests. Only with the secret. |
| `GET /dash` | The dashboard page. It contains no data and asks for the secret in the browser. |
| `GET /admin/log[?n=80]` | Owner only (the secret; never on a monitor without one). The latest log lines (300 kept in memory, the secret blanked out), the last update's output (`deploy`) and which controls work here (`controls`: `update`, `restart`). |
| `POST /admin/update` | Owner only. Runs `deploy.sh` as a unit of its own (`sudo -n systemd-run`), so restarting the service does not stop it; its output goes to `<store>/deploy-last.log`. Only on a git checkout run by systemd; one at a time. |
| `POST /admin/restart` | Owner only. Saves everything and exits, and systemd starts it again. Only under systemd. |

## Public mode

A public monitor answers every copy of the script, so its owner is not the only one sending it reports. What a stranger's browser sends is used only when it can be trusted:

- **Names** (`ids`). A name the monitor can check against its own ADS-B data is taken from one browser, but only if that aircraft was heard within 15 km and 3,000 ft of where FR24 draws the flight. If its own data says otherwise, the name is refused, however many browsers send it. A name it cannot check is taken when two different browsers send it, and no other aircraft has as many for that flight.
- **Playback names** (`pbIds`). Taken from one browser when the monitor's own log has that aircraft in the air at that moment, otherwise when two agree. Kept for good with the day of the flight.
- **Owners** (`owners`). Taken when two browsers send the very same findings.
- **ADS-B reports** (`tel`). Only physically possible values and a fresh position time. Never over the monitor's own report of the last minute, and never far from where the monitor itself last heard the aircraft. Served for two minutes.
- **FR24 positions** (`flights`). Never over a flight the monitor's own scan has.
- **FR24's feed headers** (`hdr`). Taken only from the owner, or while the monitor's own FR24 scan is not working; only printable, header-like values. Browsers send them only to a monitor of their own.
- **Routes** (`routes`). Only for a flight the monitor names, for that same aircraft, between airports it knows, and never to a destination behind the flight. Each end is taken on its own. An end from the owner's browser stands for 20 minutes, a destination confirmed in a browser stands over guesses, and a destination is not replaced within 20 minutes by another airport more than 10 points less sure. At most `routesPerHour` an hour from one address.
- **Learned flights** (`learn`). Only rows that read as a real flight: two different airports it knows, eight minutes to 20 hours, no faster than a jet, within the days it learns from, plain codes. Not when the monitor has a flight of that aircraft at that time itself (its own is used). At most `learnPerHour` an hour from one address.

What it gives out is limited too:

- private owners' names and towns are withheld (only organisations are named);
- the areas being polled and the dashboard's numbers are for the owner only;
- the flights it logs are offered under the ODbL at `/export/legs`.

[PRIVACY.md](../PRIVACY.md) lists what it receives from browsers and how long it keeps it.

## Airport and runway data

`monitor/data/` is part of the repository. `runways.json`, `runway_len.json`, `runway_info.json` and `freqs.json` are built from [OurAirports](https://ourairports.com) (public domain) by:

```bash
node monitor/mkdata.cjs              # downloads OurAirports' runways.csv and airport-frequencies.csv
node monitor/mkdata.cjs <folder>     # or from copies already downloaded
```

- `runways.json`: every end of every open runway of 1,200 ft or more (position, true heading), for the route engine.
- `runway_len.json`: each airport's longest runway (length, paved, lit, width), for the route engine.
- `runway_info.json`: every runway of FR24's airports in full. That is both idents, length, width, surface, lighting, closed, and for each end its elevation, true heading, displaced threshold and position.
- `freqs.json`: FR24's airports' radio frequencies.

Rebuild them now and then (OurAirports changes daily), run the tests, and commit the result.

## Server setup (Oracle Cloud)

The reference deployment is an Oracle Cloud "Always Free" `VM.Standard.E2.1.Micro` (1 GB RAM plus a 2 GB swap file, Ubuntu 24.04, Node 18). Caddy provides HTTPS at an `sslip.io` hostname. Any small Linux server works the same way.

**1. Service.** A systemd unit `fr24-monitor.service` with `User=ubuntu`, `Restart=always` and the environment (`MON_TOKEN`, `MON_RATE`, `MON_STORE`). The secret stays in this unit, which is not part of the repository.

**2. HTTPS.** `/etc/caddy/Caddyfile`:

```
your-host.example {
    encode zstd gzip
    log
    reverse_proxy 127.0.0.1:47524
}
```

**3. Code from git.** On the server, create a read-only deploy key and add its `.pub` as a deploy key on the repository (leave write access off):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/fr24_deploy -N "" -C server-fr24 && cat ~/.ssh/fr24_deploy.pub
printf 'Host github-fr24\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/fr24_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git clone -b <branch> git@github-fr24:<owner>/fr24-ladd-unblocker.git ~/fr24-ladd
```

**4. Run the service from the checkout:**

```bash
bash ~/fr24-ladd/monitor/vm-setup.sh
```

This writes the systemd drop-in `fr24-monitor.service.d/checkout.conf`, which sets:

- the working directory and program to the checkout;
- `MON_DATA` to the checkout's `monitor/data`;
- a 700 MB heap limit;
- `SIGTERM` with 30 s to save on stop.

It then restarts the service and checks that it answers. If it doesn't, the old setup is put back. Finally it adds `encode zstd gzip` to Caddy (checked with `caddy validate`, restored if rejected).

**5. Optional ADS-B Exchange backup.** Keep the key out of the unit, in a root-only file:

```bash
sudo install -m 600 /dev/null /etc/fr24-monitor.env && sudo nano /etc/fr24-monitor.env    # add: MON_ADSBX_KEY=your-key
printf '[Service]\nEnvironmentFile=/etc/fr24-monitor.env\n' | sudo tee /etc/systemd/system/fr24-monitor.service.d/adsbx.conf && sudo systemctl daemon-reload && sudo systemctl restart fr24-monitor
```

## Updating

```bash
bash ~/fr24-ladd/monitor/deploy.sh             # newest commit of the branch checked out
bash ~/fr24-ladd/monitor/deploy.sh --restart   # restart and check even with nothing new
```

`deploy.sh` does the following, in order:

1. Refuses to touch a checkout with files edited by hand.
2. Fast-forwards to the branch's newest commit.
3. Checks that the monitor's files parse (`node --check`).
4. Restarts the service.
5. Waits up to 4 minutes for `/status` to answer, using the secret read from the service's own settings (never printed).
6. If the new version does not answer, shows the last log lines, resets to the previous commit and restarts that.

## Moving another monitor's data in

`merge-store.cjs` merges another monitor's store (for example one that ran on a home PC) into this one's, without losing what either gathered:

```bash
node monitor/merge-store.cjs <other store> <this store> --dry-run   # counts only
sudo systemctl stop fr24-monitor
node monitor/merge-store.cjs <other store> <this store>
sudo systemctl start fr24-monitor
```

- **Flights:** a flight both monitors heard is kept once, choosing the more complete copy (both ends, landed, the longer).
- **Blocked aircraft:** combined, with the earliest "known since" and the latest "last heard".
- **Running state:** this monitor's own (last run, areas, watch records, pending day logs) is kept as it was.
- **Safety:** a copy of the store as it was is written next to it first (`store-before-merge-<time>`). The merge refuses to run while the monitor's port answers.

## Dashboard

Open `https://<your host>/dash` and enter the secret. It is kept for that browser tab only. Every 5 seconds it shows:

- **Polling:** each list's age, the backups used, adsb.lol requests in the last minute, paused hosts, areas.
- **FR24:** world scans, the headers in use, pauses and errors, callsign-less flights, names given and how, withdrawn names, area lookups, trails, destinations worked out, flights logged from FR24 only, owners known and still to look up.
- **Data:** aircraft in view, blocked aircraft, flights kept, live list size, day logs rebuilt / pending / left to the browser.
- **Server:** memory, heap, free memory, load.
- **Requests:** totals, `401`/`429`/`5xx` counts, per endpoint, per client, and the last 80 requests.

## Operations and troubleshooting

The LADD Unblock window on FR24's bottom bar shows the monitor's figures (**Monitor**), and, with the owner's secret saved under **Data sources**, does the everyday operations without a terminal: **Update monitor** (what `deploy.sh` does), **Restart**, and **Log** (the latest log lines and how the last update went). Update needs the service user to have passwordless `sudo`, as `deploy.sh` already does.


| Check | Command (on the server) |
|---|---|
| Is it running? | `systemctl status fr24-monitor` |
| Recent log | `sudo journalctl -u fr24-monitor -n 50 --no-pager` (a status line every 10 minutes) |
| Status without printing the secret | `curl -s -H "X-Monitor-Token: $(sudo systemctl show fr24-monitor -p Environment --value \| tr ' ' '\n' \| sed -n 's/^MON_TOKEN=//p')" http://127.0.0.1:47524/status` |

| Symptom | Meaning / action |
|---|---|
| `"paused": {"api.adsb.lol": N}` | adsb.lol answered `429`, and the monitor waits N seconds. Occasional pauses are normal. If they repeat every few minutes, lower `apiPerMin` in `monitor.json`. |
| `listAge.ladd` above 90 | Browsers fall back to their own lists until it recovers. Check `lastErr` and the log. |
| `hist.queue` large after midnight | Normal: yesterday's flights are rebuilt from 03:00 UTC, three at a time. |
| `hist.fails` growing | Days whose trace never appeared. Those days are read by the browser instead, so no data is lost. |
| Service restarting in a loop | `journalctl` shows why. `deploy.sh` already rolls back a version that does not start. |
| `fr24.paused` above 0, `lastErr` HTTP 403/429 or grpc 7/8/14/16 | FR24 refused the server's requests. The monitor waits 10 minutes, doubling up to 2 hours. Browsers notice that `scanOk` is false and run their own world scan meanwhile. A browser's report with fresh headers ends a 401/403 pause. |
| `fr24.headersFrom` is `default` | No browser has reported FR24's headers yet. Open FR24 once with the extension or userscript and the monitor connected. |
| `owners.paused` lists a host | That register or database refused or rate-limited. It is left alone 10 minutes (`429`) or an hour (`401`/`403`); its aircraft are asked again later. |
