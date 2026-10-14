# The monitor

`monitor/monitor.cjs` is the always-on half of the project. It polls public ADS-B worldwide, turns positions into flights with the route engine, rebuilds blocked aircraft's day logs, and answers the userscript over a small authenticated HTTP API. How it fits into the whole is described in [architecture.md](architecture.md).

- [Requirements](#requirements)
- [Running it](#running-it)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Server setup (Oracle Cloud)](#server-setup-oracle-cloud)
- [Updating](#updating)
- [Moving another monitor's data in](#moving-another-monitors-data-in)
- [Dashboard](#dashboard)
- [Operations and troubleshooting](#operations-and-troubleshooting)

---

## Requirements

- Node.js **18 or later** (tested on 18.19.1 and 22). The monitor uses only the standard library, so no `npm install` is needed.
- About **300 MB of RAM** with 90 days of history for about 10,000 blocked aircraft, and a few GB of disk.
- Outbound HTTPS to `api.adsb.lol`, `adsb.lol`, `opendata.adsb.fi`, `opensky-network.org` and `globe.airplanes.live` (and `adsbexchange-com1.p.rapidapi.com` if a key is set).

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
| `MON_DATA` | `monitor/data` | Airports, runways and airfields (`airports.json`, `runways.json`, `runway_len.json`, `oa_airports.csv`) |
| `MON_STORE` | `monitor/store` | Where flights, state and day logs are kept |
| `MON_ADSBX_KEY` | *(none)* | Your own ADS-B Exchange RapidAPI key, used only as a last backup. Put it in an `EnvironmentFile` readable only by root, never in the unit itself. |

### `monitor/monitor.json` (optional)

Any of these can be overridden in a `monitor.json` next to `monitor.cjs` (the file is git-ignored):

| Key | Default | Meaning |
|---|---|---|
| `areas` | `[[53.8, -2.6, 250]]` | Areas polled for all traffic: `[lat, lon, radius nm]` |
| `userAreas` | `3` | Extra areas taken from where the userscript looks (kept 3 days) |
| `laddEvery` / `milEvery` / `piaEvery` | `30` / `60` / `120` | Seconds between LADD, military and PIA list polls |
| `areaEvery` / `hexEvery` | `60` / `60` | Seconds between area rounds and address-lookup rounds |
| `hexBatch` | `100` | Addresses per lookup request |
| `apiPerMin` | `20` | Most adsb.lol API requests in any minute (on top of the 2 s gap) |
| `openskyEvery` | `900` | Least seconds between OpenSky snapshots (only while adsb.lol's LADD list is silent) |
| `adsbxDaily` | `150` | Most ADS-B Exchange requests a day (shares your RapidAPI quota with the browser) |
| `liveMaxAge` | `300` | Seconds an aircraft stays in `/live` after its last position |
| `closeDelayH` | `3` | Hours after midnight UTC before a day's logs are rebuilt |
| `fullGap` | `200` | Longest silence (s) of a list for a day to count as watched throughout |
| `backWorkers` | `3` | Parallel workers reading adsb.lol's day traces |

For example, to poll more gently, create `monitor/monitor.json` containing `{ "apiPerMin": 12, "piaEvery": 600 }` and restart the service.

## API reference

All answers are JSON. With `MON_TOKEN` set, send `X-Monitor-Token: <secret>` with every request; without it the monitor answers `401`. Above `MON_RATE` it answers `429` with `Retry-After: 30`.

| Endpoint | Answer |
|---|---|
| `GET /status` | What the monitor has and how its sources are doing: polls, failures, aircraft, blocked aircraft, flights, live list size, age of each list (`listAge`), adsb.lol requests in the last minute, day-log progress (`hist`), paused hosts |
| `GET /live` | `{ v, now, age: {ladd, mil, pia, hex}, ac: [...] }`: every LADD, military, PIA and blocked aircraft with a position in the last 5 minutes. Each entry is a readsb v2 row with `seen_pos` counted to `now`, plus `_from: [airportId, confidence]` and `_off` (take-off time) for a flight under way. |
| `GET /hist?hex=a,b,…` | Up to 20 blocked aircraft's finished days in the userscript's flight-log format: `{ hv, list: [{ hex, days: {'YYYY/MM/DD': flights}, legs: [...] }] }`. `0` flights means watched all day and not heard flying. Days still pending or failed are left out. |
| `GET /legs?hex=a[,b…]` | Aircraft's flights kept here (90 days), joined and chained as logs show them |
| `GET /board?ap=<id>[&from=&to=]` | Flights at an FR24 airport id, three days back by default |
| `GET /flights?cs=<callsign>` | Every kept flight under a callsign, newest first (200 max) |
| `GET /parked?ap=<id>&type=<icao type>` | Aircraft of that type whose last flight in 14 days ended at that airport |
| `GET /last` | Where each blocked jet (and each other business jet cruising) was last heard in 14 hours, used for ocean identification |
| `GET /ladd` | The LADD list as last polled (kept for older userscript versions) |
| `GET /seed?hex=a,b[&front=1]` | Tell the monitor about blocked aircraft the userscript identified. They are tracked from then on and their last three days are rebuilt. |
| `GET /area?lat=&lon=` | A place the userscript is looking at. Its traffic is polled too, for three days. |
| `GET /stats` | The dashboard's numbers: memory, load, requests per endpoint and per client, recent requests |
| `GET /dash` | The dashboard page. It contains no data and asks for the secret in the browser. |

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
