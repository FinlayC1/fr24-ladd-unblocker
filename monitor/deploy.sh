#!/usr/bin/env bash
# Updates the monitor on the server from GitHub and restarts it; back to the version before if the new one does not answer.
#   bash ~/fr24-ladd/monitor/deploy.sh            update to the newest commit of the branch checked out, restart, check
#   bash ~/fr24-ladd/monitor/deploy.sh --restart  restart and check even when there is nothing new
# The secret (MON_TOKEN) is read from the service's own settings for the check and never printed.
set -u
SERVICE=fr24-monitor
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT=47524
cd "$REPO" || exit 1
say() { echo "[deploy] $*"; }
token() { sudo systemctl show "$SERVICE" -p Environment --value | tr ' ' '\n' | sed -n 's/^MON_TOKEN=//p' | head -n1; }
# (the monitor answering /status with the secret, within 240 s of a restart: loading airports and the store takes a while on
# the small server)
check() {
  local t code i; t="$(token)"
  for i in $(seq 1 "${DEPLOY_WAIT:-120}"); do
    sleep 2
    code="$(curl -s -o /dev/null -w '%{http_code}' -H "X-Monitor-Token: $t" "http://127.0.0.1:$PORT/status" || true)"
    [ "$code" = "200" ] && return 0
    systemctl is-active --quiet "$SERVICE" || { [ "$i" -gt 5 ] && return 1; }
  done
  return 1
}
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
PREV="$(git rev-parse HEAD)"
say "branch $BRANCH, now at $(git log -1 --format='%h %s' | cut -c1-80)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then say "files of the checkout were changed by hand - not updating (git status shows them)"; exit 1; fi
git fetch -q origin "$BRANCH" || { say "fetch from GitHub failed"; exit 1; }
if ! git merge -q --ff-only "origin/$BRANCH"; then say "the server's copy has diverged from GitHub - not updating"; exit 1; fi
NEW="$(git rev-parse HEAD)"
if [ "$NEW" = "$PREV" ] && [ "${1:-}" != "--restart" ]; then say "already up to date"; exit 0; fi
[ "$NEW" != "$PREV" ] && say "updated to $(git log -1 --format='%h %s' | cut -c1-80)"
for f in monitor/monitor.cjs monitor/fr24.cjs monitor/ident.cjs monitor/dest.cjs monitor/owners.cjs monitor/airport.cjs monitor/names.cjs monitor/tel.cjs monitor/wx.cjs monitor/tracks.cjs monitor/waiting.cjs monitor/photos.cjs monitor/installs.cjs monitor/merge-store.cjs src/engine.js src/registry.js test/dataset.cjs; do
  node --check "$f" || { say "$f does not parse - back to $PREV"; git reset -q --hard "$PREV"; exit 1; }
done
# (the system log - Caddy's access log among it: addresses and requests - kept 14 days at most, as PRIVACY.md says)
JDIR="${FR24_JOURNALD_DIR:-/etc/systemd/journald.conf.d}"
if [ ! -f "$JDIR/fr24-retention.conf" ]; then
  sudo mkdir -p "$JDIR" && printf '[Journal]\nMaxRetentionSec=14day\n' | sudo tee "$JDIR/fr24-retention.conf" >/dev/null && sudo systemctl restart systemd-journald && say "system log now kept 14 days at most"
fi
# (the unit or a drop-in edited by hand since systemd last read them - the secret, the checkout: read again, so the restart
# runs with what is on disk and the check asks with the secret the monitor will have)
if [ "$(systemctl show "$SERVICE" -p NeedDaemonReload --value 2>/dev/null)" = "yes" ]; then
  sudo systemctl daemon-reload && say "the service's settings had changed on disk - read again"
fi
say "restarting $SERVICE"
sudo systemctl restart "$SERVICE"
if check; then say "OK - the monitor answers ($(git log -1 --format='%h'))"; exit 0; fi
say "the new version does not answer - back to $(git log -1 --format='%h' "$PREV")"
sudo journalctl -u "$SERVICE" -n 25 --no-pager | sed 's/X-Monitor-Token[^ ]*/[secret]/g'
git reset -q --hard "$PREV"
sudo systemctl restart "$SERVICE"
if check; then say "rolled back, the monitor answers again"; else say "rolled back, but it still does not answer: sudo journalctl -u $SERVICE -n 50"; fi
exit 1
