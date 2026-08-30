#!/bin/bash
# Startet den Arbeits-Browser: ein eigener Chrome mit eigenem Profil, den ein
# Agent fernsteuern darf. Das persönliche Chrome bleibt unangetastet — es ist
# eine andere Installation mit einem anderen Profil.
#
#   ~/.agent-browser/tools/start-browser.sh [URL]
#
# Läuft er schon, passiert nichts. Beenden: einfach das Fenster schließen.
set -euo pipefail
BASIS="${AGENT_BROWSER_HOME:-$HOME/.agent-browser}"
PORT="${AGENT_BROWSER_PORT:-9333}"

if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "Läuft bereits auf Port $PORT."
  [ $# -gt 0 ] && curl -s -X PUT "http://127.0.0.1:$PORT/json/new?$1" >/dev/null && echo "Tab geöffnet: $1"
  exit 0
fi

BIN=$(find "$BASIS/chrome" -type f -name "Google Chrome for Testing" 2>/dev/null | head -1)
[ -z "$BIN" ] && BIN=$(find "$BASIS/chrome" -type f -name "chrome" -perm +111 2>/dev/null | head -1)
if [ -z "$BIN" ]; then
  echo "Chrome for Testing nicht gefunden. install.sh noch einmal laufen lassen." >&2
  exit 1
fi

# Die drei --disable-*-Schalter halten Tabs am Zeichnen, auch wenn das Fenster
# im Hintergrund liegt oder minimiert ist. Ohne sie liefern Screenshots und
# Screencasts eingefrorene Bilder.
"$BIN" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$BASIS/profile" \
  --no-first-run \
  --no-default-browser-check \
  --disable-infobars \
  --hide-crash-restore-bubble \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling \
  ${1:+"$1"} >/dev/null 2>&1 &

for _ in $(seq 1 30); do
  sleep 0.4
  if curl -s --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "Arbeits-Browser läuft auf Port $PORT."
    exit 0
  fi
done
echo "Der Browser ist gestartet, antwortet aber nicht auf Port $PORT." >&2
exit 1
