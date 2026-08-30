// Das Overlay, das zeigt: hier wird gerade ferngesteuert.
//
// EINE Quelle für drei Verbraucher — vorher stand der Code dreimal leicht
// verschieden herum und driftete auseinander:
//   - src-tauri/src/lib.rs (inject_vignette_on) bindet diese Datei per
//     include_str! ein und schickt sie beim open_window/claim_window per CDP
//     in jeden offenen Tab,
//   - ~/.parallell/tools/browser.mjs liest sie aus ~/.parallell/tools/
//     (dorthin gelegt von install_parallell_browser_skill),
//   - der Skill parallell-browser beschreibt sie.
//
// Warum der Aufbau so kompliziert aussieht: Ein schlichtes
// `document.body.appendChild(div)` überlebt keine echte Seite. Gemessen am
// 30.8.2026:
//   - an document.body gehängt  -> weg nach body.innerHTML = … und nach
//     body.replaceChildren(), also bei JEDEM größeren React-Rerender,
//   - an documentElement gehängt -> überlebt beides, stirbt aber beim
//     Austausch des Wurzelelements,
//   - in beiden Fällen kann die Seite mit eigenem z-index, einem
//     transformierten Elternteil oder einem eigenen Top-Layer-Element
//     drüberlegen.
// Deshalb: Wirt im Top-Layer des Browsers (popover=manual), Innenleben in
// einem GESCHLOSSENEN Shadow Root, und ein MutationObserver auf `document`,
// der den Wirt wieder einhängt, sobald er verschwindet.
(() => {
  if (window.__cd) return;

  const C = "rgba(91,95,199,";
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Inline und !important, weil eine Regel im Shadow Root (:host) vom CSS der
  // Seite geschlagen werden kann — eine Inline-Deklaration mit !important
  // nicht. Sie schlägt zugleich die UA-Regel
  // `[popover]:not(:popover-open){display:none}`: klappt showPopover() nicht,
  // bleibt der Wirt trotzdem sichtbar und wirkt als gewöhnliches
  // fixed-Element mit höchstem z-index. Der Rückfallweg kostet damit keine
  // eigene Zeile Code.
  const HOST = [
    "position:fixed", "inset:0", "margin:0", "border:0", "padding:0",
    "width:auto", "height:auto", "max-width:none", "max-height:none",
    "min-width:0", "min-height:0", "background:transparent", "overflow:visible",
    "pointer-events:none", "opacity:1", "visibility:visible", "display:block",
    "transform:none", "filter:none", "clip-path:none", "contain:none",
    "z-index:2147483647", "color-scheme:normal", "inset-inline:0", "float:none",
  ].map((d) => d + "!important").join(";");

  const SHADOW_CSS = `
    * { box-sizing: border-box; }
    .layer { position: absolute; top: 0; left: 0; pointer-events: none; }
    #vig { position: absolute; inset: 0; pointer-events: none;
           box-shadow: inset 0 0 60px ${C}.75), inset 0 0 170px 40px ${C}.4); }
    #cur { position: absolute; top: 0; left: 0; width: 26px; height: 26px;
           margin: -4px 0 0 -4px; opacity: 0; will-change: transform; }
    #cur > span { display: block; transform-origin: 5px 5px;
                  transition: transform .11s ease-out; }
    #cur svg { display: block; filter: drop-shadow(0 2px 7px rgba(0,0,0,.7)); }
    #say { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%);
           padding: 7px 15px; border-radius: 999px; background: rgba(24,24,34,.9);
           color: #e7e7f5; letter-spacing: .01em; opacity: 0; transition: opacity .2s;
           max-width: 70vw; white-space: nowrap; overflow: hidden;
           text-overflow: ellipsis; box-shadow: 0 4px 20px rgba(0,0,0,.35),
           inset 0 0 0 1px ${C}.55);
           font: 500 12.5px/1.4 ui-sans-serif, -apple-system, system-ui, sans-serif; }
    .ripple { position: absolute; top: 0; left: 0; width: 26px; height: 26px;
              margin: -13px 0 0 -13px; border-radius: 50%;
              border: 2px solid rgba(255,255,255,.8);
              box-shadow: 0 0 0 1px ${C}.55);
              transition: transform .55s cubic-bezier(.22,1,.36,1), opacity .55s ease-out; }
    .outline { position: absolute; border: 1.5px solid rgba(255,255,255,.6);
               background: rgba(255,255,255,.11); opacity: 0;
               transition: opacity .18s ease-out, transform .3s ease-out; }
  `;

  const CURSOR_SVG =
    '<span><svg width="26" height="26" viewBox="0 0 24 24">' +
    '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947' +
    "l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z\" " +
    'fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/>' +
    "</svg></span>";

  let host = null;
  let root = null;
  let vig = null;
  let cur = null;
  let chip = null;

  function build() {
    host = document.createElement("div");
    // Kein sprechender Name im DOM: was die Seite nicht benennen kann, kann
    // sie auch nicht per CSS-Regel ausblenden. Wiedererkannt wird der Wirt
    // über die Variable, nicht über eine id.
    host.setAttribute("popover", "manual");
    host.setAttribute("style", HOST);
    root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = SHADOW_CSS;
    vig = document.createElement("div");
    vig.id = "vig";
    cur = document.createElement("div");
    cur.id = "cur";
    cur.className = "layer";
    cur.innerHTML = CURSOR_SVG;
    chip = document.createElement("div");
    chip.id = "say";
    root.append(style, vig, cur, chip);
  }

  // Wieder einhängen, wenn der Wirt aus dem Dokument geflogen ist — und wieder
  // in den Top-Layer heben, wenn das Popover geschlossen wurde.
  function ensure() {
    const wurzel = document.documentElement;
    if (!wurzel) return false;
    if (!host) build();
    if (!host.isConnected) wurzel.appendChild(host);
    try {
      if (!host.matches(":popover-open")) host.showPopover();
    } catch {
      // Kein Popover-Support oder gerade nicht erlaubt: der Wirt bleibt als
      // gewöhnliches fixed-Element sichtbar, dafür sorgt HOST.
    }
    return true;
  }

  // Ein Durchgang je Mutations-Schub, nicht je Mutation: auf einer lebhaften
  // Seite feuert der Observer sonst hunderte Male in der Sekunde. Die Prüfung
  // selbst ist zwei Feldzugriffe, das Bündeln hält sie trotzdem billig.
  let geplant = false;
  const anstossen = () => {
    if (geplant) return;
    geplant = true;
    queueMicrotask(() => {
      geplant = false;
      if (aktiv) ensure();
    });
  };

  let aktiv = true;
  const beobachter = new MutationObserver(anstossen);
  beobachter.observe(document, { childList: true, subtree: true });
  // Langsamer Wächter für die Fälle, die kein MutationObserver sieht — etwa
  // ein document.write, das den Baum unter uns austauscht. Zwei Sekunden
  // reichen; als alleiniger Schutz wäre das zu träge, als Netz kostet es
  // nichts.
  const wache = setInterval(() => aktiv && ensure(), 2000);

  const api = {
    vig: ensure,

    cursor(x, y, ms) {
      if (!ensure()) return;
      const at = (px, py) => `translate3d(${px}px,${py}px,0)`;
      // Beim ersten Auftauchen von rechts unten heranfahren, aus Richtung des
      // Randes — nicht aus dem Nichts an der Zielposition erscheinen.
      if (cur.dataset.on !== "1") {
        cur.dataset.on = "1";
        cur.style.transition = "none";
        cur.style.transform = at(x + 46, y + 40);
        cur.getBoundingClientRect(); // Layout erzwingen, sonst fällt der Start weg
      }
      if (calm()) {
        cur.style.transition = "opacity .12s";
        cur.style.transform = at(x, y);
        cur.style.opacity = "1";
        return;
      }
      cur.style.transition = `transform ${ms}ms cubic-bezier(.32,.72,0,1), opacity .18s`;
      requestAnimationFrame(() => {
        cur.style.transform = at(x, y);
        cur.style.opacity = "1";
      });
    },

    // Kurze Stauchung im Moment des Klicks — der Zeiger „drückt".
    press() {
      if (!ensure() || calm()) return;
      const s = cur.firstChild;
      if (!s) return;
      s.style.transform = "scale(.84)";
      setTimeout(() => { s.style.transform = "scale(1)"; }, 110);
    },

    // Ring, keine gefüllte Scheibe: eine Fläche legt sich als Schleier über
    // die Beschriftung des Elements.
    ripple(x, y) {
      if (!ensure() || calm()) return;
      const el = document.createElement("div");
      el.className = "ripple";
      el.style.transform = `translate3d(${x}px,${y}px,0) scale(.45)`;
      root.appendChild(el);
      requestAnimationFrame(() => {
        el.style.transform = `translate3d(${x}px,${y}px,0) scale(2.1)`;
        el.style.opacity = "0";
      });
      setTimeout(() => el.remove(), 620);
    },

    // Umriss um das getroffene Element: zeigt, WAS geklickt wurde — nicht nur wo.
    outline(x, y, w, h, r) {
      if (!ensure()) return;
      const el = document.createElement("div");
      el.className = "outline";
      el.style.cssText += `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`
        + `border-radius:${r || 8}px;transform:scale(1)`;
      root.appendChild(el);
      const ruhig = calm();
      requestAnimationFrame(() => {
        el.style.opacity = "1";
        if (!ruhig) el.style.transform = "scale(.965)";
      });
      setTimeout(() => {
        el.style.opacity = "0";
        if (!ruhig) el.style.transform = "scale(1)";
      }, ruhig ? 420 : 190);
      setTimeout(() => el.remove(), ruhig ? 760 : 560);
    },

    say(text) {
      if (!ensure()) return;
      if (!text) { chip.style.opacity = "0"; return; }
      chip.textContent = text;
      chip.style.opacity = "1";
    },

    calm,

    // Ganz am Ende der Bedienung: alles weg, Observer und Wächter aus.
    off() {
      aktiv = false;
      beobachter.disconnect();
      clearInterval(wache);
      try { host?.hidePopover(); } catch {}
      host?.remove();
      host = root = vig = cur = chip = null;
      delete window.__cd;
    },
  };

  window.__cd = api;
  // Beim document-start gibt es noch kein documentElement — dann später.
  if (!ensure()) document.addEventListener("DOMContentLoaded", ensure, { once: true });
})();
