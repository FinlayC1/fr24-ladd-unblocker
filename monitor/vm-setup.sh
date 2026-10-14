#!/usr/bin/env bash
# One-time: runs the monitor service from this git checkout instead of /home/ubuntu/monitor, and has Caddy compress its
# answers. Safe to run again. If the monitor from the checkout does not answer, the old setup is put back.
#   bash ~/fr24-ladd/monitor/vm-setup.sh
# What it changes:
#   /etc/systemd/system/fr24-monitor.service.d/checkout.conf   (a drop-in: the main unit, with the secret, is not touched)
#       WorkingDirectory and ExecStart -> this checkout, MON_DATA -> its data/, a 700 MB heap limit, 30 s to save on stop
#       (MON_STORE stays as the unit has it: /home/ubuntu/monitor/store)
#   /etc/caddy/Caddyfile: "encode zstd gzip" in the site block (a copy is kept as Caddyfile.bak-before-encode)
set -u
SERVICE=fr24-monitor
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DROPIN_DIR=/etc/systemd/system/$SERVICE.service.d
DROPIN=$DROPIN_DIR/checkout.conf
say() { echo "[setup] $*"; }
[ -f "$REPO/monitor/monitor.cjs" ] || { say "run this from the git checkout"; exit 1; }
NODE="$(command -v node)"; [ -n "$NODE" ] || { say "node not found"; exit 1; }
for f in monitor/monitor.cjs monitor/fr24.cjs monitor/ident.cjs monitor/dest.cjs monitor/owners.cjs monitor/airport.cjs monitor/names.cjs monitor/tel.cjs monitor/tracks.cjs src/engine.js src/registry.js test/dataset.cjs; do node --check "$REPO/$f" || { say "$f does not parse"; exit 1; }; done
[ -f "$REPO/monitor/data/airports.json" ] || { say "monitor/data/airports.json missing in the checkout"; exit 1; }
sudo mkdir -p "$DROPIN_DIR"
had_dropin=0; [ -f "$DROPIN" ] && had_dropin=1 && sudo cp "$DROPIN" "$DROPIN.prev"
sudo tee "$DROPIN" >/dev/null <<EOF
[Service]
WorkingDirectory=$REPO/monitor
ExecStart=
ExecStart=$NODE --max-old-space-size=700 $REPO/monitor/monitor.cjs
Environment=MON_DATA=$REPO/monitor/data
KillSignal=SIGTERM
TimeoutStopSec=30
EOF
sudo systemctl daemon-reload
say "service now runs from $REPO/monitor - restarting"
if bash "$REPO/monitor/deploy.sh" --restart; then
  say "monitor OK from the checkout"
else
  say "the monitor from the checkout does not answer - putting the old setup back"
  if [ "$had_dropin" = 1 ]; then sudo mv "$DROPIN.prev" "$DROPIN"; else sudo rm -f "$DROPIN"; fi
  sudo systemctl daemon-reload; sudo systemctl restart "$SERVICE"; exit 1
fi
# Caddy: compressed answers (the /live list and flight logs are JSON: a tenth of the size)
CF=/etc/caddy/Caddyfile
if sudo grep -q 'encode' "$CF"; then say "Caddy already compresses"; else
  sudo cp "$CF" "$CF.bak-before-encode"
  sudo sed -i 's/^\([[:space:]]*\)reverse_proxy /\1encode zstd gzip\n\1reverse_proxy /' "$CF"
  if sudo caddy validate --adapter caddyfile --config "$CF" >/dev/null 2>&1; then sudo systemctl reload caddy && say "Caddy compresses now"
  else say "Caddy did not accept the change - put back"; sudo cp "$CF.bak-before-encode" "$CF"; fi
fi
say "done. Status: curl -s -H \"X-Monitor-Token: <secret>\" https://143-47-224-210.sslip.io/status  - or open https://143-47-224-210.sslip.io/dash"
