# Monitor

The permanent, server-side half of the FR24 LADD Unblocker: it polls public ADS-B worldwide, rebuilds flights and day logs with the shared route engine, and answers the userscript over an authenticated HTTP API.

| File | Purpose |
|---|---|
| `monitor.cjs` | The service: `node monitor.cjs` (Node 18+, no dependencies) |
| `installs.cjs` | The anonymous installs counter behind `POST /hello`, `/badge` and `/admin/installs` |
| `dash.html` | The admin panel served at `/dash`: Overview, Users, Traffic, Logs, Options |
| `deploy.sh` | Update to the newest commit, verify, roll back on failure (server) |
| `vm-setup.sh` | One-time: run the systemd service from this checkout; compressed HTTPS with Caddy |
| `merge-store.cjs` | Merge another monitor's store into this one |
| `start-monitor.vbs` | Start it hidden on a Windows PC (when run locally instead of on a server) |
| `data/` | Airports, runways and airfields the engine needs |

## Installs counter

Each copy of the script sends `POST /hello` at most every 12 hours and when its version changes. It sends a random id made in that browser, its version, its kind (extension or userscript), its script manager, and its browser and system family. It sends nothing about flights or what it looked at. The monitor keeps that, plus up to 8 salted hashes of the networks it came from (`store/hello-salt`). It never keeps or logs the address. Installs are distinct ids. People are ids joined by a network they share, so a reinstall or one install on several networks counts once. The answer gives the newest version, the owner's notice and the minimum version.

| Endpoint | Who | What |
|---|---|---|
| `POST /hello` | anyone (public monitor), rate-limited | `{id, ver, kind, handler, browser, os}`, answered `{ok, latest, notice, minVer}` |
| `GET /badge` | anyone, CORS `*` | shields.io endpoint JSON with the people counted |
| `GET /admin/installs` | owner | the counts, charts' data, breakdowns, the 500 installs seen last |
| `GET` / `POST /admin/options` | owner | `notice`, `minVer`, `counting`, `public`, `rate` |

To switch counting off: **Options → Count installs** in the admin panel (`/dash`), or `POST /admin/options {"counting": false}`. `/hello` is still answered and nothing new is kept.

## Admin panel

`https://<your host>/dash`: sign in once with the secret (kept on that device until **Sign out**). It has five pages:

- **Overview:** headline numbers, the monitor's version against the newest, **Update** and **Restart**, and every figure the monitor keeps.
- **Users:** the installs counter, with charts and breakdowns.
- **Traffic:** requests per endpoint and per client.
- **Logs:** the log and the last update's output.
- **Options:** the settings above.

Configuration, the API reference and server operations: [docs/monitor.md](../docs/monitor.md).
