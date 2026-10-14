# The monitor

`monitor/monitor.cjs` is the always-on half of the project. It does the work that has to be continuous and worldwide, so that a browser opening FR24 anywhere has it all at once:

- **Public ADS-B, worldwide.** It polls the LADD, military and PIA lists and every known blocked aircraft by address, and turns positions into flights with the route engine.
- **FR24 itself.** It scans FR24's whole map every two minutes and names every flight FR24 draws without a callsign or registration (`ident.cjs`), over oceans and deserts too. Each named flight gets a rough destination (`dest.cjs`).
- **A permanent log.** Every blocked aircraft's take-offs and landings are kept for good, including flights only FR24 sees. The log feeds airport boards anywhere in the world and the browsers' destination engine (`/learn`).
- **Owners and operators.** Each blocked aircraft's owner is looked up once and kept (`owners.cjs`).
- **Airports.** It serves every runway in full, the radio frequencies, and which runways the flights it tracked used (`airport.cjs`).

It answers the browsers over a small authenticated HTTP API. How it fits into the whole is described in [architecture.md](architecture.md).

- [Requirements](#requirements)
- [Running it](#running-it)
- [Configuration](#configuration)
- [What it keeps](#what-it-keeps)
- [API reference](#api-reference)
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
  - owner lookups: `hexdb.io`, `api.adsbdb.com`, `registry.faa.gov`, `ginfoapi.caa.co.uk`, `ardis.iomaircraftregistry.com`, `app02.bazl.admin.ch`.

## Running it

```bash
node monitor/monitor.cjs
```

By default it listens on `127.0.0.1:47524`, keeps its data in `monitor/store/` and reads airports from `monitor/data/`. On its own computer, with no secret set, it answers anyone on that computer. On a server, always set `MON_TOKEN` and put an HTTPS proxy in front of it (see [Server setup](#server-setup-oracle-cloud)).

Stopping it with Ctrl+C or `systemctl stop` (SIGINT/SIGTERM) saves everything first.

## Configuration

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `MON_HOST` | `127.0.0.1` | Address to listen on. Keep it local and put a proxy in front. |
| `MON_PORT` (or `PORT`) | `47524` | Port |
| `MON_TOKEN` | *(none)* | Shared secret. When set, every request except `/dash` must carry the header `X-Monitor-Token`. |
| `MON_RATE` | `0` (off) | Requests per minute allowed per client address |
| `MON_DATA` | `monitor/data` | Airports, runways, frequencies and airfields (`airports.json`, `runways.json`, `runway_len.json`, `runway_info.json`, `freqs.json`, `oa_airports.csv`) |
| `MON_STORE` | `monitor/store` | Where flights, state and day logs are kept |
| `MON_ADSBX_KEY` | *(none)* | Your own ADS-B Exchange RapidAPI key, used only as a last backup. Put it in an `EnvironmentFile` readable only by root, never in the unit itself. |

### `monitor/monitor.json` (optional)

Any of these can be overridden in a `monitor.json` next to `monitor.cjs` (the file is git-ignored):

| Key | Default | Meaning |
|---|---|---|
| `areas` | `[[53.8, -2.6, 250]]` | Areas polled for all traffic: `[lat, lon, radius nm]` |
| `userAreas` | `3` | Extra areas taken from where the userscript looks (kept 3 days) |
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

For example, to poll more gently, create `monitor/monitor.json` containing `{ "apiPerMin": 12, "piaEvery": 600 }` and restart the service.

## What it keeps

Everything is in `MON_STORE` (default `monitor/store/`):

| File | Contents | Kept |
|---|---|---|
| `legs-YYYY-MM-DD.json` | Every flight of that day: take-off and landing airports and times, runways used, whether the aircraft is blocked | **For good** for blocked aircraft (the file is only ever added to); 4 days for the rest |
| `hist/<hex>.json` | A blocked aircraft's finished days, in the browser's own flight-log format | For good |
| `learn/YYYY-MM-DD.json` | Learning rows: every blocked aircraft's completed airport-to-airport flights of that day | For good |
| `ident.json` | FR24's callsign-less flights and the names given to them | Life of the flight (6 h after FR24 stops drawing it) |
| `owners.json` | Each looked-up aircraft's owner, operator, serial number, build year | For good; asked again after 60 days |
| `state.json` | Blocked aircraft, watch records, pending day logs, areas, FR24 request headers | Running state |

Flights of the last 90 days are held in memory as well. Older ones are read from disk when a board for those days is asked for.

**Flights only FR24 sees.** A blocked flight FR24 draws that no public receiver hears (FR24's own receivers, satellites, multilateration) is logged too. Once FR24 has stopped drawing it for 15 minutes, or has had it on the ground for 15 minutes, its FR24 track is read by the same engine as an ADS-B trace. The trail is fetched as the aircraft lands. Only a flight that reads as a landing at an airport is kept. An ADS-B record of the same flight replaces it when one comes.

**Runways.** For each take-off and landing at an airport the monitor works out which runway was used. It looks at the end whose extended centreline the aircraft was on, going that way: down the final approach for a landing, climbing out from the threshold for a take-off. Every position near the field counts, weighed by how close to the centreline it was and how well its track agreed. It gives one clear answer or none, so parallel runways are told apart or left unsaid.

## API reference

All answers are JSON. With `MON_TOKEN` set, send `X-Monitor-Token: <secret>` with every request; without it the monitor answers `401`. Above `MON_RATE` it answers `429` with `Retry-After: 30`.

| Endpoint | Answer |
|---|---|
| `GET /status` | What the monitor has and how its sources are doing: polls, failures, aircraft, blocked aircraft, flights, live list size, age of each list (`listAge`), adsb.lol requests in the last minute, day-log progress (`hist`), paused hosts |
| `GET /live[?since=<ms>]` | `{ v, now, full, age: {ladd, mil, pia, hex}, ac: [...] }`: every LADD, military, PIA and blocked aircraft with a position in the last 5 minutes. Each entry is a readsb v2 row with `seen_pos` counted to `now`, plus `_from: [airportId, confidence]` and `_off` (take-off time) for a flight under way. With `since` (the `now` of the last answer, under a minute old) only the aircraft heard again since then; browsers ask every 5 s. |
| `GET /fr24ids[?since=<ms>]` | `{ v, now, full, scanOk, rows, pos, gone }`: every FR24 flight without a callsign the monitor has named. Each row is `[FR24 id, hex, reg, type, callsign, flags (1 LADD, 2 military, 4 PIA), how named, named at, origin id, origin confidence, destination id, its chance %, worked out at, lat, lon, alt, on ground, FR24 position time, estimated arrival, departure time, owner, operator, FR24 operator id, operator ICAO]`. With `since`, only rows that changed, `pos` (`[id, lat, lon, alt, on ground, time]`) for flights that only moved, and `gone` (ids withdrawn). `scanOk` says the monitor's own FR24 scan is working. |
| `POST /report` | A browser's report, up to 4 MB of JSON: `hdr` (FR24's feed headers as its page sends them, never an authorization), `flights` (the callsign-less flights it sees), `ids` (`[id, hex, how]` it named itself), `owners` (`[hex, {owner, operator…, regAnswered, regOwner}]` it looked up itself) |
| `GET /owners?hex=a,b,…` | Up to 500 aircraft's owners and operators: rows `[hex, reg, type, description, owner, owner's city, country, country ISO, serial number, build year, FR24 operator id, operator ICAO, operator name, looked up at, registers answered]`. Only aircraft it knows are listed. |
| `GET /airport?ap=<id>[&days=7]` | An FR24 airport's runways in full (`runway_info.json` rows), radio frequencies, and `usage` (`[runway, take-offs, landings]`) of the flights it tracked there in the last `days` (1–14), with `moves` and `withRunway` counts |
| `GET /learn?from=YYYY-MM-DD` | Learning rows of the finished days after `from` (two weeks at most, not today), for the browsers' destination engine |
| `GET /hist?hex=a,b,…` | Up to 20 blocked aircraft's finished days in the userscript's flight-log format: `{ hv, list: [{ hex, days: {'YYYY/MM/DD': flights}, legs: [...] }] }`. `0` flights means watched all day and not heard flying. Days still pending or failed are left out. |
| `GET /legs?hex=a[,b…]` | Aircraft's flights kept here (90 days), joined and chained as logs show them |
| `GET /board?ap=<id>[&from=&to=]` | Flights at an FR24 airport id, three days back by default. Any range can be asked for: days older than 90 are read from the log on disk. |
| `GET /flights?cs=<callsign>` | Every kept flight under a callsign, newest first (200 max) |
| `GET /parked?ap=<id>&type=<icao type>` | Aircraft of that type whose last flight in 14 days ended at that airport |
| `GET /last` | Where each blocked jet (and each other business jet cruising) was last heard in 14 hours, used for ocean identification |
| `GET /ladd` | The LADD list as last polled (kept for older userscript versions) |
| `GET /seed?hex=a,b[&front=1]` | Tell the monitor about blocked aircraft the userscript identified. They are tracked from then on and their last three days are rebuilt. |
| `GET /area?lat=&lon=` | A place the userscript is looking at. Its traffic is polled too, for three days. |
| `GET /stats` | The dashboard's numbers: memory, load, requests per endpoint and per client, recent requests |
| `GET /dash` | The dashboard page. It contains no data and asks for the secret in the browser. |

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
