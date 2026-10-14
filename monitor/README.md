# Monitor

The permanent, server-side half of the FR24 LADD Unblocker: it polls public ADS-B worldwide, rebuilds flights and day logs with the shared route engine, and answers the userscript over an authenticated HTTP API.

| File | Purpose |
|---|---|
| `monitor.cjs` | The service: `node monitor.cjs` (Node 18+, no dependencies) |
| `dash.html` | Dashboard served at `/dash` |
| `deploy.sh` | Update to the newest commit, verify, roll back on failure (server) |
| `vm-setup.sh` | One-time: run the systemd service from this checkout; compressed HTTPS with Caddy |
| `merge-store.cjs` | Merge another monitor's store into this one |
| `start-monitor.vbs` | Start it hidden on a Windows PC (when run locally instead of on a server) |
| `data/` | Airports, runways and airfields the engine needs |

Configuration, the API reference and server operations: [docs/monitor.md](../docs/monitor.md).
