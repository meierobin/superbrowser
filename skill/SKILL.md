---
name: superbrowser
description: Einen echten Chrome fernsteuern — Seiten öffnen und bedienen, klicken, tippen, Formulare ausfüllen, Screenshots machen, Konsolenfehler und Netzwerk-Anfragen prüfen, lokale Web-Apps und Dev-Server testen, sich auf Seiten anmelden. Nimm das für ALLES, was einen Browser braucht.
---

# superbrowser

Ein eigener Chrome für Agenten: eigenes Profil, eigener Port (`9333`), getrennt
vom persönlichen Browser des Nutzers. Dessen Chrome NIE ansteuern — dort liegen
echte Logins und offene Arbeit.

Bedient wird er über **ein Node-Skript**, nicht über Werkzeuge:

```sh
node ~/.superbrowser/tools/browser.mjs <<'EOF'
await open('https://example.com')
log(await p.title())
EOF
```

**Du musst den Browser nicht starten.** Läuft er nicht, startet das Skript ihn
selbst und macht weiter. Von Hand ginge es mit
`~/.superbrowser/tools/start-browser.sh [URL]`.

## Warum ein Skript und nicht Schritt für Schritt

Jeder Bash-Aufruf ist eine volle Modellrunde (~1 s), der Browser selbst
braucht 0,25 ms. Was du in EIN Skript packst, kostet einmal; was du auf fünf
Aufrufe verteilst, kostet fünfmal.

Entscheidend ist das Warten: `await p.waitForSelector('.toast')` innerhalb
eines Skripts kostet **nichts**. Zwischen zwei Aufrufen kostet dasselbe Warten
jedes Mal eine Runde.

Also: **Immer alles in einen Aufruf.** Öffnen, klicken, warten, prüfen,
Ergebnis ausgeben — am Stück. Erst wenn du das Ergebnis wirklich gesehen haben
musst, um zu entscheiden, wie es weitergeht, folgt ein zweiter.

## Was vorgeladen ist

`p` (volle Playwright-Page), `ctx`, `browser`, `open`, `click`, `fill`,
`type`, `point`, `snap`, `say`, `log`, `shot`, `errors`, `netz`, `vignette`,
`tab`, `seite`.

- **`open(url)`** — hingehen. **`p`** ist die Playwright-Page, damit geht
  alles Übrige: `p.waitForSelector`, `p.textContent`, `p.locator(…)`, …
- **`click`/`fill`/`type` nehmen als letztes Argument ein Label** („Profil
  speichern"). Es fährt einen sichtbaren Cursor aufs Ziel, setzt beim Klick
  einen Ripple und zeigt unten einen Chip mit dem Text — der Nutzer kann
  mitlesen, was gerade passiert. Bewegt wird die ECHTE Maus, Hover-States
  greifen. Abschalten mit `PB_ANIM=0` (spart ~0,35 s pro Aktion).
- **`snap()`** — kompakte Liste der bedienbaren Elemente mit CSS-Selektoren,
  die auch im NÄCHSTEN Aufruf noch gelten. Der Weg, eine unbekannte Seite
  kennenzulernen, ohne ein Bild anzuschauen (~500 Token).
- **`errors()`** — mitgeschnittene Konsolenfehler. Stehen am Ende ohnehin
  automatisch in der Ausgabe, die Fertig-Prüfung kostet also nichts extra.
- **`netz()`** — was das Netz gemacht hat: standardmäßig nur Auffälliges
  (Fehlschläge und Status ab 400). `netz({ alle: true })` zeigt alles,
  `netz({ filter: '/api/' })` grenzt ein. Das ist die Antwort auf „warum lädt
  das nicht".
- **`shot(name)`** — Screenshot, gibt einen Pfad zurück. Danach auch ANSEHEN;
  ein Bild, das niemand anschaut, ist kein Beleg.
- **`seite()`** — die echte Page. Der Proxy `p` ist bequem, aber
  Playwright-Aufrufe, die den Typ prüfen (`ctx.newCDPSession(…)`), lehnen ihn ab.

## Mehrere Seiten gleichzeitig

`tab(url)` gibt einen eigenen Satz Helfer für einen eigenen Tab. Die laufen
echt parallel — gemessen: drei Tabs gleichzeitig 465 ms statt 1333 ms
nacheinander, sechs Tabs sechsmal schneller. Sobald du dieselbe Sache an
mehreren Seiten tust, ist das der Weg:

```js
const [a, b] = await Promise.all([tab('/preise'), tab('/kontakt')])
await Promise.all([a.click('#kaufen', 'kaufen'), b.fill('#mail', 'x@y.z')])
log(await a.p.title(), await b.p.title())
await Promise.all([a.close(), b.close()])
```

## Ein vollständiges Beispiel

```sh
node ~/.superbrowser/tools/browser.mjs <<'EOF'
await open('http://localhost:3000/login')
await fill('#mail', 'test@example.com', 'Mail eintragen')
await fill('#pass', 'geheim', 'Passwort eintragen')
await click('button[type=submit]', 'Anmelden')
await p.waitForSelector('.dashboard', { timeout: 8000 })
log('angekommen bei:', await p.title())
log('Netz auffällig:', netz())
log('Screenshot:', await shot('dashboard'))
EOF
```

## Was du wissen musst

- **Maus-Events sind das Teure, nicht die Optik.** Ein Input-Event kostet in
  Chrome ~9 ms, ein Skript-Aufruf 0,25 ms. Der gleitende Cursor ist eine
  CSS-Transition in der Seite und damit gratis. Wenn du selbst `mouse.move`
  nimmst: wenige `steps`, nicht zwölf.
- **Hintergrund-Tabs und minimierte Fenster zeichnen weiter.** Jeder Tab
  liefert sein eigenes, aktuelles Bild — es braucht keinen Trick, um ein
  Fenster erst sichtbar zu machen. Wer das Gegenteil misst, hat meist eine
  leere Testseite: Farben wie `#1b1b2e` in einer `data:`-URL schneiden alles
  ab dem `#` weg.
- **`shot()` geht zwei Wege.** Erst `page.screenshot()` (schneidet korrekt auf
  den Viewport zu), bei Zeitüberschreitung roh über CDP. Der bequeme Weg hängt
  gelegentlich, ohne erkennbares Muster; der rohe lief in jeder Messung.
- **Ergebnis nicht zu früh lesen.** Nach einem Klick ist der neue Zustand noch
  nicht da — React hat noch nicht neu gerendert. `await p.waitForSelector(…)`
  oder auf die Änderung warten, statt sofort auszulesen.

## Sichtbarkeit: die Vignette

Solange du den Browser bedienst, liegt ein indigo-lila Schleier an den Kanten
der Seite. Er sagt dem Nutzer: hier steuert gerade jemand anders. Er kommt
automatisch und überlebt jede Navigation. Am Ende der gesamten Bedienung:
`vignette(false)`.

## Wenn es klemmt

- **Element nicht auffindbar, Klick wirkt nicht:** erst `log(await snap())` —
  meist steht der richtige Selektor dort. Hilft das nicht, EINEN Screenshot
  ansehen; ein Blick erklärt Cookie-Banner, Overlays und Ladezustände, die
  kein Selektor zeigt.
- **Seite lädt nicht:** `log(netz())` zeigt Fehlschläge und Status ab 400.
- **Gar keine Verbindung:** Das Skript startet den Browser selbst nach. Kommt
  die Meldung trotzdem, ist die Installation unvollständig — dann `./install.sh`
  im geklonten Ordner noch einmal laufen lassen.
- **Fertig-Meldung bei UI-Arbeit:** Seite laden, Konsole prüfen, einen finalen
  Screenshot ansehen — und den Beleg in einem Satz dazuschreiben.
