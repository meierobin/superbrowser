#!/usr/bin/env node
/**
 * Macht die Wartezeiten von chrome-devtools-mcp über Umgebungsvariablen
 * einstellbar. Ohne diesen Eingriff hängt der Server nach JEDER verändernden
 * Aktion (evaluate_script, click, fill, navigate, hover, type_text, press_key,
 * drag, select_page) einen MutationObserver an document.body und wartet auf
 * 100 ms DOM-Ruhe, mit hartem Deckel bei 3000 ms.
 *
 * Auf animierten Seiten wird diese Ruhe nie erreicht — gemessen: 207 Mutations-Schübe in 3 s, längste Pause 17 ms.
 * Der Deckel läuft dann bei jedem einzelnen Aufruf voll aus:
 *
 *   ohne Patch          3111 ms   (n=8, Median)
 *   150/30 ms           261 ms
 *   0/0 ms              108 ms
 *   roher CDP-Aufruf      0,22 ms
 *
 * Nach jedem Update des Pakets neu ausführen — der Eingriff ist idempotent
 * und meldet, wenn schon gepatcht ist.
 *
 *   node ~/.superbrowser/tools/patch-mcp.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASIS = process.env.SUPERBROWSER_HOME || join(homedir(), ".superbrowser");
const PAKET = join(BASIS, "mcp/node_modules/chrome-devtools-mcp/build/src");
const ZIEL = join(PAKET, "WaitForHelper.js");

// [Suchtext, Ersatz mit env-Lookup] — die Voreinstellungen bleiben exakt die
// des Pakets, ohne gesetzte Variablen ändert der Patch also nichts.
const ERSETZUNGEN = [
  [
    "this.#stableDomTimeout = 3000 * cpuTimeoutMultiplier;",
    "this.#stableDomTimeout = Number(process.env.CDM_STABLE_DOM_TIMEOUT ?? 3000) * cpuTimeoutMultiplier;",
  ],
  [
    "this.#stableDomFor = 100 * cpuTimeoutMultiplier;",
    "this.#stableDomFor = Number(process.env.CDM_STABLE_DOM_FOR ?? 100) * cpuTimeoutMultiplier;",
  ],
];

if (!existsSync(ZIEL)) {
  console.error(`Nicht gefunden: ${ZIEL}`);
  console.error(
    "Das Paket fehlt — install.sh noch einmal laufen lassen.",
  );
  process.exit(1);
}

let quelle = readFileSync(ZIEL, "utf8");

// Kein früher Programmabbruch mehr: darunter folgt ein ZWEITER Eingriff, und
// der muss auch dann laufen, wenn dieser hier längst sitzt.
if (quelle.includes("CDM_STABLE_DOM_TIMEOUT")) {
  console.log("Wartezeiten: schon gepatcht — nichts zu tun.");
} else {
  for (const [suche, ersatz] of ERSETZUNGEN) {
    if (!quelle.includes(suche)) {
      console.error(
        `Stelle nicht gefunden, das Paket hat sich geändert:\n  ${suche}\n` +
          "Bitte WaitForHelper.js von Hand anschauen.",
      );
      process.exit(1);
    }
    quelle = quelle.replace(suche, ersatz);
  }

  writeFileSync(ZIEL, quelle);
  console.log("Gepatcht. Wirksam über CDM_STABLE_DOM_TIMEOUT und CDM_STABLE_DOM_FOR.");
}

/* --------------------------------------------------------------------------
 * Zweiter Eingriff: neue Seiten gehen im HINTERGRUND auf.
 *
 * `new_page` hat einen Schalter `background`, der laut eigener Beschreibung
 * auf "false (foreground)" steht. Jede Seite, die eine Session aufmacht, reißt
 * damit den Fokus an sich — mitten in der Arbeit des Users, oft nur für einen
 * Moment, weil sie gleich wieder minimiert oder geschlossen wird. Genau dieses
 * Aufblitzen ist gemeint, wenn "Chrome nimmt mir dauernd den Fokus".
 *
 * Der Weg über `isolatedContext` reichte den Schalter überhaupt nicht durch —
 * dort kam die Seite IMMER nach vorne, und weil ein eigener Kontext ein
 * eigenes Fenster bedeutet, war es dort am auffälligsten.
 *
 * Beides zeigt auf dieselbe Stelle: `Target.createTarget {background}`. Der
 * Patch dreht die Voreinstellung um und reicht sie auch im Kontext-Weg durch.
 * Wer die alte Fassung braucht, setzt CDM_BACKGROUND_PAGES=0; ein
 * ausdrückliches `background: false` im Aufruf gewinnt weiterhin.
 * ------------------------------------------------------------------------ */

const ZIEL2 = join(PAKET, "McpContext.js");

const ERSETZUNGEN2 = [
  [
    `    async newPage(background, isolatedContextName) {
        let page;`,
    `    async newPage(background, isolatedContextName) {
        background = background ?? (process.env.CDM_BACKGROUND_PAGES !== "0");
        let page;`,
  ],
  [`            page = await ctx.newPage();`, `            page = await ctx.newPage({ background });`],
];

if (!existsSync(ZIEL2)) {
  console.error(`Nicht gefunden: ${ZIEL2}`);
  process.exit(1);
}

let quelle2 = readFileSync(ZIEL2, "utf8");

if (quelle2.includes("CDM_BACKGROUND_PAGES")) {
  console.log("Hintergrund-Seiten: schon gepatcht — nichts zu tun.");
} else {
  for (const [suche, ersatz] of ERSETZUNGEN2) {
    if (!quelle2.includes(suche)) {
      console.error(
        `Stelle nicht gefunden, das Paket hat sich geändert:\n  ${suche}\n` +
          "Bitte McpContext.js von Hand anschauen.",
      );
      process.exit(1);
    }
    quelle2 = quelle2.replace(suche, ersatz);
  }
  writeFileSync(ZIEL2, quelle2);
  console.log("Gepatcht: neue Seiten gehen im Hintergrund auf (CDM_BACKGROUND_PAGES=0 kehrt das um).");
}

/* --------------------------------------------------------------------------
 * Dritter Eingriff: das FENSTER bleibt unten.
 *
 * Der zweite Eingriff oben reicht nicht. `Target.createTarget {background}`
 * entscheidet nur, ob der neue TAB nach vorne kommt — über das FENSTER sagt
 * er nichts. Legt eine Session eine Seite an, während der Browser noch gar
 * kein Fenster hat (oder über `isolatedContext`, das immer ein eigenes
 * Fenster bedeutet), fährt macOS es trotzdem mit voller Animation auf den
 * Schirm. Genau das ist das Aufblitzen, das übrig geblieben ist.
 *
 * Der Handgriff dagegen: Fenster anlegen, dann sofort
 * `Browser.setWindowBounds {windowState: "minimized"}`.
 *
 * Warum das nichts kaputt macht: Ein minimiertes Fenster rendert weiter —
 * dafür sorgen die Startschalter des Arbeits-Browsers
 * (--disable-backgrounding-occluded-windows und die zwei anderen). CDP,
 * Screenshots und Playwright arbeiten darin normal weiter.
 *
 * Wer die Seite sofort sehen will, klappt ihr Fenster von Hand auf oder
 * setzt CDM_MINIMIZE_NEW=0.
 * ------------------------------------------------------------------------ */

const EINFUEGESTELLE = `        const mcpPage = await this.#createMcpPage(page);`;

const UNTEN_HALTEN = `        if (process.env.CDM_MINIMIZE_NEW !== "0") {
            try {
                const sitzung = await page.createCDPSession();
                const { windowId } = await sitzung.send("Browser.getWindowForTarget", {});
                await sitzung.send("Browser.setWindowBounds", {
                    windowId,
                    bounds: { windowState: "minimized" },
                });
                await sitzung.detach();
            } catch {
                // Kein Fensterzustand zu holen (headless, fremder Browser):
                // dann bleibt eben alles wie vorher.
            }
        }
${EINFUEGESTELLE}`;

let quelle3 = readFileSync(ZIEL2, "utf8");

if (quelle3.includes("CDM_MINIMIZE_NEW")) {
  console.log("Fenster unten halten: schon gepatcht — nichts zu tun.");
} else if (!quelle3.includes(EINFUEGESTELLE)) {
  console.error(
    `Stelle nicht gefunden, das Paket hat sich geändert:\n  ${EINFUEGESTELLE}\n` +
      "Bitte McpContext.js von Hand anschauen.",
  );
  process.exit(1);
} else {
  writeFileSync(ZIEL2, quelle3.replace(EINFUEGESTELLE, UNTEN_HALTEN));
  console.log("Gepatcht: neue Fenster starten minimiert (CDM_MINIMIZE_NEW=0 kehrt das um).");
}
