#!/bin/bash
# Richtet den Arbeits-Browser für Claude Code ein.
#
#   ./install.sh
#
# Was danach da ist:
#   ~/.superbrowser/chrome    ein eigener Chrome (Chrome for Testing)
#   ~/.superbrowser/profile   dessen Profil — Logins bleiben erhalten
#   ~/.superbrowser/lib       playwright-core, das Herzstück
#   ~/.superbrowser/tools     browser.mjs, start-browser.sh, Overlay
#   ~/.claude/skills/superbrowser/SKILL.md — die Anleitung für Claude
#
# Nochmal ausführen ist gefahrlos: alles wird überschrieben, das Profil nicht.
set -euo pipefail
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASIS="${SUPERBROWSER_HOME:-$HOME/.superbrowser}"
PORT="${SUPERBROWSER_PORT:-9333}"
# Überschreibbar, damit sich das Skript prüfen lässt, ohne eine echte
# Konfiguration anzufassen — und für Setups, die woanders liegen.
SKILLS_DIR="${SKILLS_DIR:-$HOME/.claude/skills}"

sag() { printf "\n\033[1m%s\033[0m\n" "$1"; }
fehler() { printf "\033[31m%s\033[0m\n" "$1" >&2; exit 1; }

command -v node >/dev/null || fehler "node fehlt. Installieren: brew install node"
command -v npm  >/dev/null || fehler "npm fehlt. Installieren: brew install node"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || fehler "node $NODE_MAJOR ist zu alt, mindestens 20 wird gebraucht."

mkdir -p "$BASIS/tools"

sag "1/3  Chrome for Testing holen"
if find "$BASIS/chrome" -type f -name "Google Chrome for Testing" 2>/dev/null | grep -q .; then
  echo "     schon da — übersprungen"
else
  npx --yes @puppeteer/browsers install chrome@stable --path "$BASIS/chrome" >/dev/null \
    || fehler "Download fehlgeschlagen. Läuft die Internetverbindung?"
  echo "     fertig"
fi

sag "2/3  playwright-core installieren"
mkdir -p "$BASIS/lib"
( cd "$BASIS/lib" && npm install --silent --no-fund --no-audit playwright-core ) \
  || fehler "npm install playwright-core fehlgeschlagen."

sag "3/3  Werkzeuge und Skill ablegen"
cp "$HIER/tools/browser.mjs" "$HIER/tools/browser-overlay.js" \
   "$HIER/tools/start-browser.sh" "$BASIS/tools/"
chmod +x "$BASIS/tools/start-browser.sh"
mkdir -p "$SKILLS_DIR/superbrowser"
cp "$HIER/skill/SKILL.md" "$SKILLS_DIR/superbrowser/SKILL.md"
echo "     $SKILLS_DIR/superbrowser/SKILL.md"

sag "Fertig."
cat <<TXT
  Browser starten:   $BASIS/tools/start-browser.sh https://example.com
  In Claude Code:    einfach sagen, was er tun soll — z. B.
                     "öffne example.com und lies mir die Überschrift vor".
                     Er findet den Skill selbst und startet den Browser bei Bedarf.

  Der Agent bedient NUR diesen Browser (Port $PORT, eigenes Profil).
  Dein persönliches Chrome bleibt unangetastet.
TXT
