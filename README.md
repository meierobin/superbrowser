# superbrowser

Ein eigener Chrome, den ein Agent fernsteuern darf — mit eigenem Profil,
getrennt vom persönlichen Browser. Claude öffnet Seiten darin, klickt, tippt,
liest die Konsole und macht Screenshots, ohne dir zwischen die Finger zu
greifen.

```sh
git clone https://github.com/meierobin/superbrowser
cd superbrowser
./install.sh
```

Danach versteht Claude Sätze wie „öffne localhost:3000 und sag mir, ob die
Konsole sauber ist". Er findet die Anleitung selbst und startet den Browser
bei Bedarf — kein Neustart, keine Konfiguration.

## Was installiert wird

| Wohin | Was |
|---|---|
| `~/.superbrowser/chrome` | Chrome for Testing (eigener Download) |
| `~/.superbrowser/profile` | dessen Profil — Logins bleiben erhalten |
| `~/.superbrowser/lib` | `playwright-core`, das Herzstück |
| `~/.superbrowser/tools` | `browser.mjs`, `start-browser.sh`, Overlay |
| `~/.claude/skills/superbrowser/` | die Anleitung, die Claude selbst liest |

Voraussetzungen: macOS, Node 20 oder neuer, Claude Code.
Nichts davon fasst dein normales Chrome an.

## Browser starten

Meistens gar nicht nötig: Läuft er nicht, startet der Code-Modus ihn selbst.
Von Hand geht es so:

```sh
~/.superbrowser/tools/start-browser.sh              # leer
~/.superbrowser/tools/start-browser.sh https://…    # gleich mit einer Seite
```

Läuft er schon, öffnet der zweite Aufruf nur einen Tab. Beenden: Fenster zu.

## Wie es bedient wird

Über ein Node-Skript mit stehender Verbindung — alle Schritte am Stück, statt
pro Klick eine Modellrunde:

```sh
node ~/.superbrowser/tools/browser.mjs <<'EOF'
await open('http://localhost:3000/login')
await fill('#mail', 'test@example.com', 'Mail eintragen')
await click('button[type=submit]', 'Anmelden')
await p.waitForSelector('.dashboard')
log(await p.title(), errors().length + ' Konsolenfehler', netz())
EOF
```

Das Warten ist der Grund für diese Bauform: `waitForSelector` innerhalb eines
Skripts kostet nichts. Über einzelne Werkzeugaufrufe verteilt kostet dasselbe
Warten jedes Mal eine volle Modellrunde.

Beim Klicken und Tippen fährt ein sichtbarer Cursor übers Bild und unten steht
ein Chip mit dem, was gerade passiert — man kann zusehen, statt zu raten.
Mehrere Tabs gleichzeitig gehen mit `tab(url)`; gemessen sind sechs Tabs
parallel sechsmal schneller als nacheinander.

Mitgeliefert: `snap()` für eine kompakte Elementliste, `errors()` für
Konsolenfehler, `netz()` für auffällige Netzwerk-Anfragen, `shot()` für
Screenshots.

## Was der Agent NICHT tut

- Dein persönliches Chrome anfassen. Er kennt nur Port 9333.
- An deiner Claude-Konfiguration drehen. Es wird nichts registriert — nur ein
  Ordner angelegt und eine Anleitung für Claude abgelegt.
- Fenster ungefragt nach vorn holen. Alles läuft im Hintergrund weiter,
  Screenshots funktionieren auch bei minimiertem Fenster.

## Wieder loswerden

```sh
rm -rf ~/.superbrowser ~/.claude/skills/superbrowser
```

Mehr nicht — es gibt nichts anderes zu entfernen.
