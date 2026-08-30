#!/usr/bin/env node
// Code-Modus für den Arbeits-Browser: mehrere Schritte in EINEM Aufruf.
//
//   node ~/.agent-browser/tools/browser.mjs <<'EOF'
//   await open('http://localhost:3001')
//   await click('button[type=submit]', 'Formular absenden')
//   log(await p.textContent('.toast'))
//   EOF
//
// Das Skript von stdin läuft in EINEM Node-Prozess mit einer stehenden
// CDP-Verbindung: navigieren, warten, klicken, prüfen — alles in einem Aufruf,
// statt pro Schritt eine Modellrunde.
//
// Vorgeladen: p (Playwright-Page), ctx, browser, open, snap, click, fill,
//             type, say, log, shot, errors, vignette, point, tab, seite.
//
// MEHRERE TABS GLEICHZEITIG: `tab(url)` gibt einen eigenen Satz Helfer für
// einen eigenen Tab zurück. Die laufen echt parallel — gemessen sind sechs
// Tabs nebeneinander 6× schneller als nacheinander:
//
//   const [a, b] = await Promise.all([tab('/preise'), tab('/kontakt')])
//   await Promise.all([a.click('#kaufen', 'kaufen'), b.fill('#mail', 'x@y.z')])
//   log(await a.p.title(), await b.p.title())

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CDP_URL = process.env.AGENT_BROWSER_URL || "http://127.0.0.1:9333";
const ANIM = process.env.PB_ANIM !== "0"; // Cursor-Animation abschaltbar
const require = createRequire(import.meta.url);

// Playwright liegt global; NODE_PATH ist leer, also selbst auflösen.
function loadPlaywright() {
  const daheim = process.env.HOME || "";
  for (const id of [
    // Zuerst die Kopie, die install.sh mitbringt — dann ist das Skript von
    // einer globalen Installation unabhängig.
    `${daheim}/.agent-browser/lib/node_modules/playwright-core`,
    "playwright-core",
    "/opt/homebrew/lib/node_modules/playwright-core",
    "/usr/local/lib/node_modules/playwright-core",
  ]) {
    try {
      return require(id);
    } catch {}
  }
  throw new Error("playwright-core fehlt — install.sh noch einmal laufen lassen.");
}

// ── Overlay ────────────────────────────────────────────────────────────────
// Zeigt dem User, dass ferngesteuert wird: statische Vignette am Rand (Pflicht
// laut Skill), dazu ein gleitender Cursor, ein Klick-Ripple und ein Label-Chip
// mit dem, was gerade passiert.
//
// Der Code liegt daneben in browser-overlay.js.
const HIER = dirname(fileURLToPath(import.meta.url));
// Notnagel für den Fall, dass die Datei fehlt (App noch nicht neu gebaut):
// nur der Rand, ohne Cursor und Chip. Besser als gar keine Sichtbarkeit.
const OVERLAY_NOTNAGEL = `(() => {
  if (window.__cd) return;
  const halt = () => {
    let el = document.getElementById('__claude_drive');
    if (!el) {
      el = document.createElement('div');
      el.id = '__claude_drive';
      el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
        + 'box-shadow:inset 0 0 60px rgba(91,95,199,.75), inset 0 0 170px 40px rgba(91,95,199,.4)';
    }
    if (!el.isConnected) document.documentElement?.appendChild(el);
  };
  new MutationObserver(halt).observe(document, { childList: true, subtree: true });
  const leer = () => {};
  window.__cd = { vig: halt, cursor: leer, press: leer, ripple: leer,
                  outline: leer, say: leer, calm: () => false,
                  off: () => { document.getElementById('__claude_drive')?.remove(); } };
  halt();
})()`;
const OVERLAY = await readFile(join(HIER, "browser-overlay.js"), "utf8").catch(
  () => OVERLAY_NOTNAGEL,
);

// Kompakte Seitenübersicht: pro Element eine Zeile mit einem Selektor, der auch
// im NÄCHSTEN Aufruf noch gilt — anders als Refs, die pro Prozess sterben.
const SNAP = (limit) => `(() => {
  const sel = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    for (const a of ['data-testid', 'data-test', 'name', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v) {
        const s = el.tagName.toLowerCase() + '[' + a + '=' + JSON.stringify(v) + ']';
        if (document.querySelectorAll(s).length === 1) return s;
      }
    }
    const path = [];
    for (let n = el; n && n.nodeType === 1 && path.length < 4; n = n.parentElement) {
      if (n.id) { path.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const sibs = [...(n.parentElement?.children || [])].filter(c => c.tagName === n.tagName);
      if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')';
      path.unshift(part);
    }
    return path.join(' > ');
  };
  const seen = new Set(), out = [];
  const nodes = document.querySelectorAll('a[href],button,input,select,textarea,'
    + '[role=button],[role=link],[role=tab],[role=checkbox],[onclick],'
    + '[contenteditable=""],[contenteditable=true],h1,h2,h3,label,[role=alert],[role=status]');
  for (const el of nodes) {
    if (out.length >= ${limit}) break;
    if (el.id && el.id.startsWith('__claude_drive')) continue;
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (!r.width && !r.height && el.type !== 'hidden') continue;
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label')
      || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
          ? (el.placeholder || el.value || el.name || '') : el.innerText)
      || '').replace(/\\s+/g, ' ').trim().slice(0, 70);
    const s = sel(el), key = role + '|' + label + '|' + s;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(role + (label ? ' "' + label + '"' : '') + ' -> ' + s
      + (r.bottom < 0 || r.top > innerHeight ? ' [offscreen]' : '')
      + (el.disabled ? ' [disabled]' : ''));
  }
  return { url: location.href, title: document.title, elements: out };
})()`;

// ── stdin lesen ────────────────────────────────────────────────────────────
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const source = Buffer.concat(chunks).toString("utf8").trim();
if (!source) {
  process.stderr.write(
    "Kein Skript auf stdin. Aufruf:\n" +
      "  node ~/.agent-browser/tools/browser.mjs <<'EOF'\n" +
      "  await open('http://localhost:3000')\n  log(await snap())\n  EOF\n",
  );
  process.exit(2);
}

const lines = [];
const log = (...xs) =>
  lines.push(xs.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" "));

// ── verbinden ──────────────────────────────────────────────────────────────
const { chromium } = loadPlaywright();
let browser;
try {
  // Ohne einen einzigen offenen Tab lehnt Playwright die Verbindung ab
  // ("Browser context management is not supported"). Dann selbst einen anlegen.
  const targets = await fetch(`${CDP_URL}/json/list`)
    .then((r) => r.json())
    .catch(() => []);
  if (!targets.some?.((t) => t.type === "page")) {
    await fetch(`${CDP_URL}/json/new?about:blank`, { method: "PUT" }).catch(() => {});
  }
  browser = await chromium.connectOverCDP(CDP_URL, { timeout: 8000 });
} catch (err) {
  process.stderr.write(
    `Keine Verbindung zu ${CDP_URL} — läuft der Browser?\n` +
      `Starten mit: ~/.agent-browser/tools/start-browser.sh\n(${err.message})\n`,
  );
  process.exit(3);
}

const ctx = browser.contexts()[0];
await ctx.addInitScript(OVERLAY); // überlebt jede Navigation

const real = (pg) => !/^(about:|chrome:|devtools:)/.test(pg.url());
const lebt = () => ctx.pages().filter((pg) => !pg.isClosed());
let cur = null;

// Die aktuelle Seite IMMER über P() holen, nie über die Variable. Skripte öffnen
// und schließen laufend eigene Tabs — zeigte `cur` auf einen geschlossenen,
// scheiterte danach alles. P() sucht sich dann einfach eine lebende Seite.
function P() {
  if (cur && !cur.isClosed()) return cur;
  const offen = lebt();
  cur = offen.filter(real).at(-1) || offen.at(-1) || null;
  if (!cur) throw new Error("keine offene Seite mehr — mit open(url) eine neue starten");
  return cur;
}

const consoleErrors = [];
const watch = (pg) => {
  // Bei parallelen Tabs steht sonst nicht dabei, WO der Fehler herkam.
  const woher = () => {
    const u = pg.isClosed() ? "" : pg.url();
    return u && lebt().length > 1 ? `[${u.replace(/^https?:\/\//, "").slice(0, 40)}] ` : "";
  };
  pg.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(woher() + m.text().slice(0, 300));
  });
  pg.on("pageerror", (e) => consoleErrors.push(woher() + String(e).slice(0, 300)));
};
ctx.pages().forEach(watch);
// Neue Tabs nur beobachten, NICHT zur aktuellen Seite machen — sonst zieht ein
// Neben-Tab aus einem Promise.all die Hauptseite unter dem Skript weg.
ctx.on("page", watch);

// ── Helfer, gebunden an EINE Seite ─────────────────────────────────────────
// Alles hängt an `hole()` statt an einer festen Page. Für die globalen Helfer
// ist das P() (die jeweils aktuelle Seite), für tab() die eine Seite dieses
// Tabs — damit laufen mehrere Tabs im selben Skript nebeneinander, ohne sich
// gegenseitig die Seite unter den Füßen wegzuziehen.
function helfer(hole) {
  // Das Overlay wird bei JEDEM paint mitgeschickt, ist aber durch seinen
  // eigenen `window.__cd`-Riegel ein Nulldurchgang, wenn es schon steht. So
  // heilt auch ein Tab, den weder addInitScript noch Parallell erwischt hat.
  // Als Anweisungsblock, nicht als Komma-Ausdruck: die Datei enthält
  // Kommentare und schließt mit einem Semikolon.
  const paint = (js) =>
    hole()
      .evaluate(`(() => { ${OVERLAY}\n; return window.__cd && (${js}) })()`)
      .catch(() => {});

  const say = (text) => paint(`__cd.say(${JSON.stringify(text || "")})`);

  async function open(url, opts = {}) {
    await hole().goto(url, { waitUntil: "domcontentloaded", ...opts });
    await paint("__cd.vig()");
    return hole();
  }

  // Zeigt den Cursor zum Ziel gleiten, bewegt dabei die ECHTE Maus (Hover-States
  // greifen), setzt einen Ripple und klickt dann.
  async function point(sel, label, ms = 260) {
    const loc = typeof sel === "string" ? hole().locator(sel).first() : sel;
    await loc.waitFor({ state: "visible", timeout: 10000 });
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x, y: r.y, w: r.width, h: r.height,
        r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8,
      };
    });
    if (!b.w && !b.h) throw new Error(`kein sichtbares Element für ${sel}`);
    // Etwas links und über der Mitte: die Spitze sitzt dann auf dem Element,
    // statt dass der Zeigerkörper mittig darüber liegt.
    const x = Math.round(b.x + b.w * 0.42);
    const y = Math.round(b.y + b.h * 0.42);
    if (label) say(label);
    if (ANIM) {
      // Der Zeiger gleitet als CSS-Transition IN der Seite — die kostet nichts
      // und läuft von selbst weiter. Teuer sind die ECHTEN Mausschritte: ein
      // Input-Event kostet in Chrome ~41 ms (gemessen 30.8.2026, gegen 0,25 ms
      // für einen Skript-Aufruf). Die früheren zwölf Zwischenschritte waren
      // damit ~500 ms je Aktion, ohne dass man mehr sah. Drei reichen, damit
      // Hover-States unterwegs greifen.
      const start = Date.now();
      paint(`__cd.cursor(${x},${y},${ms})`); // nicht abwarten, ist nur Optik
      await hole().mouse.move(x, y, { steps: 3 });
      // Nur noch die Restzeit der Transition abwarten — die Mausschritte haben
      // den Großteil davon schon verbraucht.
      const rest = ms - (Date.now() - start);
      if (rest > 30) await hole().waitForTimeout(rest);
    } else {
      await hole().mouse.move(x, y);
    }
    return { loc, x, y, box: b };
  }

  async function click(sel, label) {
    const { loc, x, y, box } = await point(sel, label);
    if (ANIM) {
      paint(
        `(__cd.outline(${box.x},${box.y},${box.w},${box.h},${box.r}),` +
          `__cd.press(),__cd.ripple(${x},${y}))`,
      );
      await hole().waitForTimeout(60);
    }
    await loc.click();
    return loc;
  }

  async function fill(sel, value, label) {
    const { loc } = await point(sel, label ?? `„${value}" eintragen`);
    await loc.fill(String(value));
    return loc;
  }

  async function type(sel, value, label) {
    const { loc } = await point(sel, label ?? `„${value}" tippen`);
    await loc.click();
    await loc.pressSequentially(String(value), { delay: 28 });
    return loc;
  }

  async function snap(opts = {}) {
    await paint("__cd.vig()");
    return hole().evaluate(SNAP(opts.limit ?? 60));
  }

  // Jeder Tab liefert sein EIGENES, aktuelles Bild — auch als Hintergrund-Tab
  // und auch bei MINIMIERTEM Fenster (gemessen 30.8.2026: 91 ms, Bild
  // aktualisiert sich, Screencast läuft daneben mit 10 fps weiter). Der
  // frühere Minimier-/Wiederherstell-Tanz war unnötig und ließ das Fenster
  // kurz aufblitzen — genau das, was er verhindern sollte.
  //
  // page.screenshot() statt rohem Page.captureScreenshot, weil letzteres die
  // FENSTERfläche nimmt: liegt der Tab im Hintergrund und hat das Fenster
  // seither seine Größe geändert, behält der Tab sein altes Layout und das
  // Bild bekommt schwarze Ränder. Playwright schneidet auf den Viewport der
  // Seite zu.
  async function shot(name = "shot") {
    const path = `${process.env.TMPDIR || "/tmp"}/${name}-${Date.now()}.png`;
    await hole().screenshot({ path, timeout: 10000 });
    return path;
  }

  const vignette = (on = true) =>
    on ? paint("__cd.vig()") : hole().evaluate(`window.__cd && __cd.off()`).catch(() => {});

  // `p` zeigt immer auf die Seite dieses Helfersatzes, auch wenn zwischendurch
  // ein Tab aufgeht.
  const p = new Proxy({}, {
    get: (_, k) => { const g = hole(); return typeof g[k] === "function" ? g[k].bind(g) : g[k]; },
  });

  return { p, open, snap, click, fill, type, say, shot, point, vignette, paint };
}

const haupt = helfer(P);
const { open: openAuf, snap, click, fill, type, say, shot, point, vignette } = haupt;

// open() legt bei Bedarf erst eine Seite an — das kann nur der globale Satz,
// weil ein tab() seine Seite schon hat.
async function open(url, opts = {}) {
  if (!lebt().length) cur = await ctx.newPage();
  return openAuf(url, opts);
}

// Ein eigener Tab mit eigenem Satz Helfer. Mehrere davon laufen echt parallel.
async function tab(url, opts = {}) {
  const seite = await ctx.newPage();
  const satz = helfer(() => {
    if (seite.isClosed()) throw new Error(`Tab ${url || ""} ist zu`);
    return seite;
  });
  if (url) await satz.open(url, opts);
  return { ...satz, seite, close: () => seite.close().catch(() => {}) };
}

// Die ECHTE Page, nicht der Proxy: Playwright-Aufrufe wie ctx.newCDPSession()
// prüfen den Typ und lehnen den Proxy ab. Bei tab() steht sie als .seite da.
const seite = () => P();

const errors = () => consoleErrors;

// ── Skript ausführen ───────────────────────────────────────────────────────
const p = haupt.p;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
let code = 0;
try {
  const run = new AsyncFunction(
    "p", "ctx", "browser", "open", "snap", "click", "fill", "type",
    "say", "log", "shot", "errors", "vignette", "point", "tab", "seite",
    source,
  );
  await run(p, ctx, browser, open, snap, click, fill, type,
            say, log, shot, errors, vignette, point, tab, seite);
} catch (err) {
  lines.push(`FEHLER: ${err?.message || err}`);
  code = 1;
}

await say("").catch(() => {});
if (consoleErrors.length) {
  lines.push(`\nKonsolenfehler (${consoleErrors.length}):`);
  lines.push(...consoleErrors.slice(0, 10).map((e) => "  " + e));
}

// Nur die Verbindung kappen — der Browser des Users bleibt offen.
process.stdout.write(lines.join("\n") + "\n", () => process.exit(code));
