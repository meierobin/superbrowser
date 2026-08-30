---
name: agent-browser
description: Steuert einen eigenen Arbeits-Browser (Chrome for Testing) über den custom-chrome MCP. Für Seiten öffnen, klicken, tippen, Screenshots, Konsole und Netzwerk prüfen, lokale Web-Apps testen.
---

# Arbeits-Browser

Es gibt genau EINEN Browser für Agenten: ein eigener Chrome for Testing mit
eigenem Profil auf Port `9333`, gestartet über
`~/.agent-browser/tools/start-browser.sh`. Das persönliche Chrome des Nutzers
NIE ansteuern — es ist eine andere Installation, und darin liegen echte
Logins und offene Arbeit.

Bedient wird er über den **`custom-chrome`**-MCP; der hängt fest an diesem
Browser. Sind seine Tools deferred, einmal via ToolSearch danach suchen. Keine
konkurrierenden Browser-Plugins parallel verwenden.

## Sparsam arbeiten

Jeder MCP-Aufruf ist eine volle Modellrunde (~1 s und mehr), der Browser
selbst braucht 0,25 ms. Und alles, was du liest, bleibt bis zum Sessionende im
Kontext und wird bei JEDEM weiteren Request neu bezahlt.

- **Ein Aufruf statt fünf (Pflicht):** Sobald zwei Schritte absehbar sind,
  ALLES in EIN `evaluate_script` packen — lesen, klicken, warten, wieder
  lesen. Die Funktion darf async sein und ein Objekt zurückgeben.
- **Gezielt lesen:** Einzelne Werte mit `evaluate_script` (~50 Token), NICHT
  mit `take_snapshot` (~6.100 Token) oder `take_screenshot` (~2.000 Token,
  plus er steht danach dauerhaft im Kontext). Screenshot nur, wenn Pixel die
  Frage beantworten — dann genau EINER, am Ende.
- **Ergebnis nicht im selben Aufruf lesen:** `el.click()` und direkt danach
  den neuen Zustand auslesen liefert den ALTEN — React hat noch nicht neu
  gerendert. Im selben `evaluate_script` auf die Änderung warten
  (MutationObserver oder
  `await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`).

## Code-Modus: mehrere Schritte in EINEM Aufruf

Sobald ein Ablauf **navigiert** oder mehr als zwei Schritte hat, hört
`evaluate_script` auf zu reichen: sein Code lebt in der Seite und stirbt mit
ihr. Dann den Code-Modus nehmen — ein Node-Skript auf stdin, eine stehende
CDP-Verbindung, alle Schritte am Stück. Darunter liegt `playwright-core` mit
`chromium.connectOverCDP(...)`; Logins im Profil bleiben dabei erhalten.

```sh
node ~/.agent-browser/tools/browser.mjs <<'EOF'
await open('http://localhost:3000/settings')
await fill('#name', 'Robin', 'Namen eintragen')
await click('button[type=submit]', 'Profil speichern')
await p.waitForSelector('.toast')          // Warten kostet keine Modellrunde
log(await p.textContent('.toast'), errors().length + ' Konsolenfehler')
EOF
```

Vorgeladen: `p` (volle Playwright-Page, zeigt immer auf den aktuellen Tab),
`ctx`, `browser`, `open`, `click`, `fill`, `type`, `point`, `snap`, `say`,
`log`, `shot`, `errors`, `vignette`, `tab`, `seite`.

- **`click`/`fill`/`type` nehmen als letztes Argument ein Label** („Profil
  speichern"). Es fährt einen sichtbaren Cursor aufs Ziel, setzt beim Klick
  einen Ripple und zeigt unten einen Chip mit dem Text — der Nutzer kann
  mitlesen, was gerade passiert. Bewegt wird die ECHTE Maus, Hover-States
  greifen. Abschalten mit `PB_ANIM=0` (spart ~0,35 s pro Aktion).
- **Mehrere Tabs GLEICHZEITIG mit `tab(url)`.** Das gibt einen eigenen Satz
  Helfer für einen eigenen Tab zurück, und die laufen echt parallel — jeder
  Tab rendert, streamt und empfängt Mausereignisse für sich. Gemessen: drei
  Tabs parallel 465 ms statt 1333 ms nacheinander, sechs Tabs 6× schneller:

```js
const [a, b] = await Promise.all([tab('/preise'), tab('/kontakt')])
await Promise.all([a.click('#kaufen', 'kaufen'), b.fill('#mail', 'x@y.z')])
log(await a.p.title(), await b.p.title())
await Promise.all([a.close(), b.close()])
```

- **Die echte Page holst du mit `seite()`** (bei `tab()`: `.seite`). Der
  Proxy `p` ist bequem, aber Playwright-Aufrufe, die den Typ prüfen — etwa
  `ctx.newCDPSession(...)` — lehnen ihn ab.
- **Maus-Events sind das Teure, nicht die Optik.** Ein Input-Event kostet in
  Chrome ~9 ms, ein Skript-Aufruf 0,25 ms. Der gleitende Cursor ist eine
  CSS-Transition in der Seite und damit gratis; teuer sind die
  Zwischenschritte der echten Maus. Wenn du selbst `mouse.move` nimmst:
  wenige `steps`, nicht zwölf.
- **`snap()`** liefert eine kompakte Elementliste mit CSS-Selektoren, die auch
  im NÄCHSTEN Aufruf noch gelten (~500 Token statt 6.100 für `take_snapshot`).
- **Konsolenfehler** werden mitgeschnitten und am Ende ausgegeben — die
  Fertig-Prüfung kostet nichts extra.
- **`shot(name)`** gibt einen Pfad zurück; den Screenshot danach auch ANSEHEN.
- Der MCP bleibt für Einzelgriffe („lies mir einen Wert") das billigere Werkzeug.

## Screenshots

- **Hintergrund-Tabs und minimierte Fenster zeichnen weiter.** Jeder Tab
  liefert sein EIGENES, aktuelles Bild, auch wenn er nicht der aktive Tab ist
  und auch wenn sein Fenster minimiert ist: `page.screenshot()` ~91 ms,
  daneben laufender Screencast 10 fps. Es braucht also keinen Trick, um ein
  Fenster erst sichtbar zu machen.
  Wer das Gegenteil misst, hat meist eine leere Testseite: Farben wie
  `#1b1b2e` in einer `data:`-URL schneiden dort alles ab dem `#` weg — die
  Seite ist weiß und das Bild sieht „eingefroren" aus.
- **Rohes `Page.captureScreenshot` nimmt die FENSTERfläche, nicht den
  Viewport.** Liegt der Tab im Hintergrund und hat sein Fenster seither die
  Größe geändert, behält der Tab sein altes Layout und das Bild bekommt
  schwarze Ränder. `page.screenshot()` schneidet korrekt zu — `shot()` im
  Code-Modus nimmt deshalb diesen Weg.

## Sichtbarkeit: die Vignette

Solange du den Browser bedienst, soll die indigo-lila Vignette sichtbar sein —
kräftiger Schleier an den Kanten, nach innen weich auslaufend. Sie sagt dem
Nutzer: hier steuert gerade jemand anders. Der Code steht in
`~/.agent-browser/tools/browser-overlay.js`; im Code-Modus kommt er
automatisch über `addInitScript` und überlebt jede Navigation.

Warum er so gebaut ist — gemessen an einer echten Seite:

| Aufhängung | überlebt `body.innerHTML=…` | überlebt Wurzel-Austausch |
|---|---|---|
| an `document.body` | ✗ weg | ✗ weg |
| an `document.documentElement` | ✓ | ✗ weg |
| Top-Layer + MutationObserver | ✓ | ✓ |

Ein an `body` gehängtes Overlay stirbt bei JEDEM größeren React-Rerender.
Deshalb: Wirt im Top-Layer (`popover="manual"` + `showPopover()`), Innenleben
in einem geschlossenen Shadow Root, dazu ein `MutationObserver` auf
`document`, der den Wirt wieder einhängt.

Entfernt wird sie am Ende der Bedienung: `vignette(false)` bzw. `__cd.off()`.

**Zwei Fallstricke, wenn du selbst per CDP injizierst:**

- **`Page.enable` MUSS vorher kommen.** Ohne den Aufruf nimmt Chrome
  `Page.addScriptToEvaluateOnNewDocument` klaglos entgegen und führt das
  Skript trotzdem nie aus — selbst ein `window.__marker = 1` ist nach dem
  nächsten Reload spurlos weg. Das kostet keine Fehlermeldung, nur die Wirkung.
- **Die Registrierung stirbt mit der CDP-Sitzung.** Wer sich gleich wieder
  trennt, hat nur das gerade offene Dokument bemalt.

## Wenn es klemmt

- **Element nicht auffindbar, Klick wirkt nicht, Seite sieht anders aus:**
  EINEN Screenshot machen und ansehen — ein Blick erklärt oft, was der
  a11y-Baum nicht zeigt (Cookie-Banner, Overlays, Canvas, Ladezustände).
  Danach zurück zu gezielten Aktionen, nicht dauerhaft auf Pixel umsteigen.
- **„Could not connect" / „ECONNREFUSED":** Der Browser läuft nicht:

```sh
~/.agent-browser/tools/start-browser.sh
```

- **Fertig-Meldung bei UI-Arbeit:** geänderte Seite laden, Konsole prüfen,
  einen finalen Screenshot ansehen.

## Warum der MCP schnell ist (nicht zurückdrehen)

`custom-chrome` läuft aus `~/.agent-browser/mcp` statt aus `npx …@latest`,
weil das Paket nach jeder verändernden Aktion auf 100 ms DOM-Ruhe wartet, mit
3-Sekunden-Deckel — auf animierten Seiten läuft der Deckel immer voll aus
(gemessen 3.111 ms pro Aufruf statt 261 ms). Einstellbar über
`CDM_STABLE_DOM_TIMEOUT`/`CDM_STABLE_DOM_FOR`, beide sind im MCP-Eintrag
gesetzt. Nach einem Paket-Update einmal
`node ~/.agent-browser/tools/patch-mcp.mjs` laufen lassen.
