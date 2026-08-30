# superbrowser

Ein eigener Chrome, den ein Agent fernsteuern darf — mit eigenem Profil,
getrennt vom persönlichen Browser. Claude öffnet Seiten darin, klickt, tippt,
liest die Konsole und macht Screenshots, ohne dir zwischen die Finger zu
greifen.

```sh
git clone <dieses-repo> browser-kit
cd browser-kit
./install.sh
```

Danach Claude Code einmal neu starten. Ab dann versteht er Sätze wie
„öffne localhost:3000 und sag mir, ob die Konsole sauber ist".

## Was installiert wird

| Wohin | Was |
|---|---|
| `~/.superbrowser/chrome` | Chrome for Testing (eigener Download) |
| `~/.superbrowser/profile` | dessen Profil — Logins bleiben erhalten |
| `~/.superbrowser/mcp` | `chrome-devtools-mcp`, auf kurze Wartezeiten gepatcht |
| `~/.superbrowser/lib` | `playwright-core` für den Code-Modus |
| `~/.superbrowser/tools` | `browser.mjs`, `start-browser.sh`, Overlay |
| `~/.claude/skills/superbrowser/` | die Anleitung, die Claude selbst liest |
| `~/.claude.json` | MCP-Eintrag `custom-chrome` (Sicherungskopie wird angelegt) |

Voraussetzungen: macOS, Node 20 oder neuer, Claude Code.
Nichts davon fasst dein normales Chrome an.

## Browser starten

```sh
~/.superbrowser/tools/start-browser.sh              # leer
~/.superbrowser/tools/start-browser.sh https://…    # gleich mit einer Seite
```

Läuft er schon, öffnet der zweite Aufruf nur einen Tab. Beenden: Fenster zu.

## Zwei Wege, ihn zu bedienen

**Der MCP** — für Einzelgriffe. „Lies mir den Preis von der Seite", „ist die
Konsole sauber". Ein Aufruf, eine Antwort.

**Der Code-Modus** — für Abläufe. Ein Node-Skript mit stehender Verbindung,
alle Schritte am Stück, statt pro Klick eine Modellrunde:

```sh
node ~/.superbrowser/tools/browser.mjs <<'EOF'
await open('http://localhost:3000/login')
await fill('#mail', 'test@example.com', 'Mail eintragen')
await click('button[type=submit]', 'Anmelden')
await p.waitForSelector('.dashboard')
log(await p.title(), errors().length + ' Konsolenfehler')
EOF
```

Beim Klicken und Tippen fährt ein sichtbarer Cursor übers Bild und unten steht
ein Chip mit dem, was gerade passiert — man kann zusehen, statt zu raten.
Mehrere Tabs gleichzeitig gehen mit `tab(url)`; gemessen sind sechs Tabs
parallel sechsmal schneller als nacheinander.

## Warum nicht einfach `npx chrome-devtools-mcp@latest`

Das Paket wartet nach jeder verändernden Aktion auf 100 ms DOM-Ruhe, mit einem
Deckel von 3 Sekunden. Auf animierten Seiten wird diese Ruhe nie erreicht, und
der Deckel läuft bei jedem einzelnen Aufruf voll aus:

| | pro Aufruf |
|---|---|
| ohne Patch | 3.111 ms |
| gepatcht (150/30 ms) | 261 ms |
| roher CDP-Aufruf | 0,25 ms |

`install.sh` legt deshalb eine eigene Kopie an und patcht sie. Nach einem
Update des Pakets einmal `node ~/.superbrowser/tools/patch-mcp.mjs` nachziehen.

Zwei weitere Eingriffe stecken im selben Patch: neue Seiten gehen im
Hintergrund auf und ihr Fenster startet minimiert — sonst reißt jede Seite,
die ein Agent öffnet, den Fokus an sich, mitten in deiner Arbeit.

## Was der Agent NICHT tut

- Dein persönliches Chrome anfassen. Er kennt nur Port 9333.
- Fenster ungefragt nach vorn holen. Alles läuft im Hintergrund weiter,
  Screenshots funktionieren auch bei minimiertem Fenster.

## Wieder loswerden

```sh
rm -rf ~/.superbrowser ~/.claude/skills/superbrowser
# und den Eintrag "custom-chrome" aus ~/.claude.json löschen
```
