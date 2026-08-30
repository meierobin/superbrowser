#!/bin/bash
# Richtet den Arbeits-Browser samt MCP für Claude Code ein.
#
#   ./install.sh
#
# Was danach da ist:
#   ~/.superbrowser/chrome    ein eigener Chrome (Chrome for Testing)
#   ~/.superbrowser/profile   dessen Profil — Logins bleiben erhalten
#   ~/.superbrowser/mcp       chrome-devtools-mcp, gepatcht auf kurze Wartezeiten
#   ~/.superbrowser/lib       playwright-core für den Code-Modus
#   ~/.superbrowser/tools     browser.mjs, start-browser.sh, Overlay
#   ~/.claude/skills/superbrowser/SKILL.md
#   Eintrag "custom-chrome" in ~/.claude.json
#
# Nochmal ausführen ist gefahrlos: alles wird überschrieben, das Profil nicht.
set -euo pipefail
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASIS="${SUPERBROWSER_HOME:-$HOME/.superbrowser}"
PORT="${SUPERBROWSER_PORT:-9333}"
# Feste Version: der Patch unten greift an zwei benannten Stellen im Paket an.
# Bei "@latest" verschiebt sich das früher oder später und der Patch bricht ab.
MCP_VERSION="${MCP_VERSION:-1.6.0}"
# Überschreibbar, damit sich das Skript prüfen lässt, ohne eine echte
# Konfiguration anzufassen — und für Setups, die woanders liegen.
CLAUDE_JSON="${CLAUDE_JSON:-$HOME/.claude.json}"
SKILLS_DIR="${SKILLS_DIR:-$HOME/.claude/skills}"

sag() { printf "\n\033[1m%s\033[0m\n" "$1"; }
fehler() { printf "\033[31m%s\033[0m\n" "$1" >&2; exit 1; }

command -v node >/dev/null || fehler "node fehlt. Installieren: brew install node"
command -v npm  >/dev/null || fehler "npm fehlt. Installieren: brew install node"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || fehler "node $NODE_MAJOR ist zu alt, mindestens 20 wird gebraucht."

mkdir -p "$BASIS/tools"

sag "1/6  Chrome for Testing holen"
if find "$BASIS/chrome" -type f -name "Google Chrome for Testing" 2>/dev/null | grep -q .; then
  echo "     schon da — übersprungen"
else
  npx --yes @puppeteer/browsers install chrome@stable --path "$BASIS/chrome" >/dev/null \
    || fehler "Download fehlgeschlagen. Läuft die Internetverbindung?"
  echo "     fertig"
fi

sag "2/6  chrome-devtools-mcp $MCP_VERSION installieren"
mkdir -p "$BASIS/mcp"
( cd "$BASIS/mcp" && npm install --silent --no-fund --no-audit "chrome-devtools-mcp@$MCP_VERSION" ) \
  || fehler "npm install fehlgeschlagen."

sag "3/6  Wartezeiten patchen"
# Ohne diesen Eingriff wartet der MCP nach JEDER verändernden Aktion auf
# DOM-Ruhe, mit einem Deckel von 3 Sekunden. Auf animierten Seiten läuft der
# Deckel jedes Mal voll aus — gemessen 3.111 ms je Aufruf statt 261 ms.
SUPERBROWSER_HOME="$BASIS" node "$HIER/tools/patch-mcp.mjs"

sag "4/6  playwright-core für den Code-Modus"
mkdir -p "$BASIS/lib"
( cd "$BASIS/lib" && npm install --silent --no-fund --no-audit playwright-core ) \
  || fehler "npm install playwright-core fehlgeschlagen."

sag "5/6  Werkzeuge und Skill ablegen"
cp "$HIER/tools/browser.mjs" "$HIER/tools/browser-overlay.js" \
   "$HIER/tools/patch-mcp.mjs" "$HIER/tools/start-browser.sh" "$BASIS/tools/"
chmod +x "$BASIS/tools/start-browser.sh"
mkdir -p "$SKILLS_DIR/superbrowser"
cp "$HIER/skill/SKILL.md" "$SKILLS_DIR/superbrowser/SKILL.md"
echo "     $SKILLS_DIR/superbrowser/SKILL.md"

sag "6/6  MCP in Claude Code eintragen"
BASIS="$BASIS" PORT="$PORT" CLAUDE_JSON="$CLAUDE_JSON" node - <<'NODE'
const fs = require("node:fs");
const pfad = process.env.CLAUDE_JSON;
let doc = {};
if (fs.existsSync(pfad)) {
  try { doc = JSON.parse(fs.readFileSync(pfad, "utf8")); }
  catch { console.error(`${pfad} ist kein gültiges JSON — bitte selbst nachsehen.`); process.exit(1); }
  // Sicherheitskopie, bevor an einer Datei gedreht wird, die dem Nutzer gehört.
  fs.copyFileSync(pfad, `${pfad}.bak-vor-agent-browser`);
}
doc.mcpServers = doc.mcpServers || {};
doc.mcpServers["custom-chrome"] = {
  type: "stdio",
  command: "sh",
  args: ["-c",
    `exec node ${process.env.BASIS}/mcp/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js` +
    ` --browserUrl=\${SUPERBROWSER_URL:-http://127.0.0.1:${process.env.PORT}}`],
  // Die gepatchten Wartezeiten. 150/30 ms statt 3000/100 — gemessen 261 ms
  // je Aufruf statt 3.111 ms, ohne dass etwas unzuverlässiger wird.
  env: { CDM_STABLE_DOM_TIMEOUT: "150", CDM_STABLE_DOM_FOR: "30" },
};
fs.writeFileSync(pfad, JSON.stringify(doc, null, 2) + "\n");
console.log(`     Eintrag "custom-chrome" in ${pfad}`);
NODE

sag "Fertig."
cat <<TXT
  Browser starten:   $BASIS/tools/start-browser.sh https://example.com
  In Claude Code:    einmal neu starten, damit der MCP geladen wird.
                     Dann z. B. "öffne example.com und lies mir die Überschrift vor".

  Der Agent bedient NUR diesen Browser (Port $PORT, eigenes Profil).
  Dein persönliches Chrome bleibt unangetastet.
TXT
