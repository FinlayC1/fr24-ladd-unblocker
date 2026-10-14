# Security

## Secrets

| Secret | Where it lives | Never |
|---|---|---|
| Monitor secret (`MON_TOKEN`) | The server's systemd unit, and the owner's own browser (*sources* > *Monitor*; other users need none) | In the repository, in a URL (proxies log URLs), in logs or screenshots |
| ADS-B Exchange key | The browser's userscript storage. On a server, a root-only `EnvironmentFile` (`MON_ADSBX_KEY`) | In the repository or the systemd unit itself |
| FAA NOTAM API credentials | The browser's userscript storage | In the repository |
| Server SSH key | The administrator's own computer | Shared with anyone |
| Server deploy key | `~/.ssh/fr24_deploy` on the server, registered as a **read-only** deploy key | Given write access |

The scripts are written so the secret never appears in their output:

- `deploy.sh` reads it from the service's own settings for its health check and never prints it.
- The commands in [docs/monitor.md](docs/monitor.md) do the same.

## Monitor exposure

- The monitor listens on `127.0.0.1` only. Caddy terminates HTTPS in front of it.
- **The shared monitor is public:**
  - every copy of the script reads it without a secret;
  - the secret opens the dashboard's numbers (`/stats`) and the full answers;
  - reports from strangers are checked before use (see [docs/monitor.md](docs/monitor.md#public-mode)).
- **A private monitor** (`"public": false` or `MON_PUBLIC=0`) answers only requests that carry the secret, except the static `/dash` page, which contains no data.
- Each client address is rate-limited (`MON_RATE`, 300 requests a minute on a public monitor). The owner is never limited.
- Browsers never send the shared monitor anything of their Flightradar24 session. FR24's feed headers go only to a monitor of their own.
- The monitor makes outbound requests only to the data sources listed in [docs/data-sources.md](docs/data-sources.md).

## If a secret leaks

1. **Monitor secret:** set a new `MON_TOKEN` in the unit, then `sudo systemctl daemon-reload && sudo systemctl restart fr24-monitor`. Enter the new secret in each browser.
2. **API keys:** revoke them with the provider (RapidAPI, api.faa.gov) and enter new ones.
3. **Deploy key:** delete it in the repository's *Settings > Deploy keys* and create a new one on the server.

## Reporting

Please report problems privately to the author, Finlay Clarke, rather than in a public issue.
