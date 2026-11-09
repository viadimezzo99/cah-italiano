// Interfaccia da tavolo: logo, setup, partita locale (più persone e bot), impostazioni, animazioni.
const app = document.getElementById("app");
// Ogni schermata nuova entra con una leggera scorrevole; il tavolo di gioco no (si aggiorna da solo).
const replaceApp = app.replaceChildren.bind(app);
app.replaceChildren = (...nodes) => {
  replaceApp(...nodes);
  const first = app.firstElementChild;
  if (first && !first.classList.contains("game")) first.classList.add("enter");
};
const MAX_HUMANS = 6;

const FONTS = {
  moderno: { label: "Moderno", css: '"Bricolage Grotesque", system-ui, sans-serif' },
  classico: { label: "Classico", css: 'Fraunces, Georgia, serif' },
  tecnico: { label: "Tecnico", css: '"IBM Plex Sans", system-ui, sans-serif' },
  fumetto: { label: "Fumetto", css: '"Permanent Marker", cursive' },
};
const DEFAULT_SETTINGS = { theme: "system", font: "moderno", textScale: 1, cardScale: 1, music: true, musicVol: 0.6, sfx: true, sfxVol: 1, vibration: true, motion: true };

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("cah-settings") || "{}") }; }
  catch (e) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings() {
  try { localStorage.setItem("cah-settings", JSON.stringify(settings)); } catch (e) { /* memoria del browser non disponibile */ }
}

let settings = loadSettings();
let unlocked = false;   // l'audio parte solo dopo un gesto dell'utente
let game = null;
let cfg = { names: ["Tu"], bots: [], winScore: 5, deck: "full" }; // partita locale: persone e bot, mazzo scelto prima

// Nomi di fantasia suggeriti per i bot: chi aggiunge il bot può cambiarli.
const BOT_SUGGEST = ["Bot Gigi", "Bot Nina", "Bot Remo", "Bot Sara", "Bot Tito", "Bot Ugo", "Bot Vera", "Bot Zeno"];
function askBotName(n, onOk) {
  const input = el("input", { type: "text", maxlength: "16", value: BOT_SUGGEST[n % BOT_SUGGEST.length], "aria-label": "Nome del bot" });
  const close = () => bg.remove();
  const ok = () => {
    const name = input.value.replace(/\s+/g, " ").trim().slice(0, 16) || BOT_SUGGEST[n % BOT_SUGGEST.length];
    close();
    onOk(name);
  };
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet card-form" },
      el("p", { class: "label" }, "Nome del bot"),
      el("div", { class: "nrow" }, input),
      el("p", { class: "hidden-msg" }, "Scegli un nome di fantasia."),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "ghost", onclick: close }, "Annulla"),
        el("button", { type: "button", class: "primary", onclick: ok }, "Aggiungi bot"))));
  document.body.append(bg);
  input.focus();
  input.select();
}
let viewer = null;      // chi sta guardando lo schermo in questo momento
let lastViewer = null;
let curtain = false;    // schermata "passa il telefono" da chiudere prima di vedere le carte
let selected = [];      // ids delle carte scelte da chi guarda, in ordine di click
let judgeSel = null;    // combinazione scelta dal Re, prima della conferma
let judgeView = 0;
let judgeMode = "browse";
let judgeRound = -1;
let dealPending = false;
let slamPending = false;
let enterPending = false;
let wonRound = -1;
let shrinkRound = -1;  // round in cui la carta vincente è già diventata il segnaposto
let botTimer = null;
let judgeTimer = null;
let roundTimer = null;     // passaggio automatico al round successivo (solo locale)
const LOCAL_ROUND_PAUSE_MS = 1900;   // dopo il volo della carta scelta (600 ms) e il punto (1050 ms)
const BOT_JUDGE_STEP_MS = 2500;      // tempo tra un passo e l'altro del Re bot (sfogliare, confrontare, scegliere)
let jollyDraft = "";                  // testo scritto a mano sul jolly, mentre lo si compone sulla carta nera
let mem = null;                       // Memory del Re: tessere, carte aperte, round a cui appartiene
const MEMORY_IMGS = /*MEMORY_IMGS*/[];
const JOLLY_IMG = "/*JOLLY_IMG*/";   // carta jolly in mano
const MEMORY_HUE = [0, 30, -25, 45, -40, 20, -15, 60];   // una tonalità diversa per ogni coppia
let wordsShown = 0;                  // quante parole sono già comparse sulla carta nera (non si ripetono)
let scrolledSel = null;
let comboScroll = null;               // posizione della fila combinazioni prima di un aggiornamento              // combinazione già portata in vista nella fila
let stripShown = -1;                 // ultima combinazione già comparsa nella fila
let shrinkGhost = null;             // copia della carta vincente in volo: si toglie se si salta la pausa
let online = null;      // partita online: { code, you, state, offline, winScore } oppure null

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};

// ------------------------------------------------------------------ impostazioni

function applySettings() {
  const root = document.documentElement;
  root.style.setProperty("--ts", 1);   // il testo non si regola a mano: segue la grandezza della carta
  root.style.setProperty("--cs", settings.cardScale);
  root.style.setProperty("--card-font", FONTS[settings.font].css);
  if (settings.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);
  document.body.classList.toggle("no-motion", !settings.motion);
  document.body.classList.toggle("motion-on", settings.motion);
  Sound.setSfx(settings.sfx);
  Sound.setSfxVolume(settings.sfxVol);
  Sound.setHaptics(settings.vibration);
  Sound.setVolume(settings.musicVol);
  // La musica parte già all'avvio; il browser può bloccarla finché non c'è un tocco, e il primo tocco la riattiva.
  Sound.setMusic(settings.music);
}

// Aggiornamento dal repository: legge l'ultima release e offre la nuova APK.
const APP_VERSION = "0.2.25";
const UPDATE_API = "https://api.github.com/repos/viadimezzo99/cah-italiano/releases/latest";
const isNewer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
};
function updateBox() {
  const out = el("div", { class: "status", role: "status", "aria-live": "polite" }, "Non ancora controllato");
  const check = async () => {
    out.textContent = "Controllo in corso…";
    try {
      const r = await fetch(UPDATE_API, { headers: { accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rel = await r.json();
      const latest = String(rel.tag_name || "").replace(/^v/, "");
      const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
      if (!latest || !apk) { out.textContent = "Nessuna versione scaricabile al momento."; return; }
      if (!isNewer(latest, APP_VERSION)) { out.textContent = `Sei aggiornato (${APP_VERSION}).`; return; }
      // Dentro l'app il file APK lo apre il telefono (browser/gestore download), non la pagina interna.
      // Dentro l'app il telefono scarica l'APK da solo e poi chiede di installarlo: nessuna pagina web.
      const openApk = () => {
        if (window.AndroidBridge?.installUpdate) window.AndroidBridge.installUpdate(apk.browser_download_url);
        else if (window.AndroidBridge?.openUrl) window.AndroidBridge.openUrl(apk.browser_download_url);
        else window.open(apk.browser_download_url, "_blank", "noopener");
      };
      // Niente link: la barra si riempie nella schermata, poi il telefono prende il file da solo.
      const start = () => {
        out.replaceChildren(el("span", {}, `Scarico la versione ${latest}…`),
          el("span", { class: "upd-bar", "aria-hidden": "true" }, el("span", { class: "upd-fill" })),
          el("p", { class: "hidden-msg" }, "Quando il file è pronto il telefono ti chiede di installarlo."));
        setTimeout(openApk, 2600);
      };
      out.replaceChildren(el("span", {}, `Versione ${latest} disponibile. `),
        el("button", { type: "button", class: "primary", onclick: start }, "Scarica aggiornamento"));
    } catch {
      out.textContent = "Non riesco a controllare. Serve la connessione e un repository pubblico.";
    }
  };
  return el("div", { class: "col", style: "gap:8px" }, out,
    el("button", { type: "button", class: "ghost", onclick: check }, "Controlla aggiornamenti"));
}

function openSettings() {
  const close = () => { bg.remove(); };
  const set = (key, value) => { settings[key] = value; saveSettings(); applySettings(); rebuild(); };
  const seg = (key, options) => el("div", { class: "seg" }, options.map(([v, label]) =>
    el("button", { type: "button", "aria-pressed": String(settings[key] === v), onclick: () => set(key, v) }, label)));
  const toggle = (key, label) => el("div", { class: "row" },
    el("span", {}, label),
    el("button", { class: "toggle", type: "button", "aria-pressed": String(!!settings[key]), onclick: () => set(key, !settings[key]) }, settings[key] ? "Attivo" : "Spento"));
  const slider = (key, label, min, max, step, fmt) => el("div", { class: "row", style: "flex-direction:column;align-items:stretch" },
    el("div", { class: "row" }, el("span", {}, label), el("span", { class: "status" }, fmt(settings[key]))),
    el("input", { type: "range", min, max, step, value: settings[key], "aria-label": label,
      oninput: (e) => { settings[key] = Number(e.target.value); applySettings(); saveSettings(); e.target.parentElement.querySelector(".status").textContent = fmt(settings[key]); } }));

  const rebuild = () => {
    sheet.replaceChildren(...buildSheetContent());
  };
  const buildSheetContent = () => [
    el("div", { class: "row" }, el("h2", { style: "font-size:22px" }, "Impostazioni"),
      el("button", { type: "button", class: "ghost", onclick: close }, "Chiudi")),
    el("div", { class: "group" }, el("span", { class: "label" }, "Tema"),
      seg("theme", [["system", "Sistema"], ["light", "Chiaro"], ["dark", "Scuro"]])),
    el("div", { class: "group" }, el("span", { class: "label" }, "Font delle carte"),
      el("div", { class: "fonts" }, Object.entries(FONTS).map(([k, f]) =>
        el("button", { type: "button", style: `font-family:${f.css}`, "aria-pressed": String(settings.font === k), onclick: () => set("font", k) }, f.label)))),
    el("div", { class: "group" }, el("span", { class: "label" }, "Dimensioni"),
      slider("cardScale", "Grandezza delle carte", 0.8, 1.3, 0.05, (v) => `${Math.round(v * 100)}%`)),
    el("div", { class: "group" }, el("span", { class: "label" }, "Audio"),
      toggle("music", "Musica di sottofondo"),
      slider("musicVol", "Volume musica", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      toggle("sfx", "Effetti sonori"),
      slider("sfxVol", "Volume effetti", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      toggle("vibration", "Vibrazione")),
    el("div", { class: "group" }, el("span", { class: "label" }, "Movimento"),
      toggle("motion", "Animazioni")),
    el("div", { class: "group" }, el("span", { class: "label" }, `Aggiornamenti · versione ${APP_VERSION}`),
      updateBox()),
    el("button", { type: "button", class: "ghost", onclick: () => { settings = { ...DEFAULT_SETTINGS }; saveSettings(); applySettings(); rebuild(); } }, "Ripristina predefiniti"),
  ];

  const sheet = el("div", { class: "sheet", role: "dialog", "aria-label": "Impostazioni" }, buildSheetContent());
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } }, sheet);
  document.body.append(bg);
}

// ------------------------------------------------------------------ logo

// Icona del gioco (la stessa dell'app): carta nera con "Cards / Against / Humanity".
const APP_ICON = "data:image/png;base64,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ZPznvDSwoVDIL2vIkCHccccdzJkzJ0/uKyoq4rvf/S6nnXYas2fP5s4772T8+PF5iamj0SgzZszg7rvvpr6+Htd1fe76mc98hoceeojzzjuP8vJyQqEQ4XCYUCiErusUFhYyZswYfvKTn3DHHXdQWVnpL1+mafopaXOzwP/4xz/m8ssvJxaL+ZzHMAyGDh3Kr371K66//nps284zsXgpZb3s8d6SG4vF/Lr2leFisRiRSATDMFi7di0bN26koKDA77tp06b5GURz5fOZM2cye/Zsv62xWIyNGzfy2GOP+avIe74Eex01Z84c2tvb/eSFubJLPB7njDPOyFtyDwdETdP8NAdv9VxfOdRbArwlx7ZtvvKVr/idmZs80MtzfN111xGLxaiqqgIgFovlfSudTlNfX8/nP/95brzxRjKZDGeddRb/+Z//SXFxMfF43B/spqYm0uk0o0aN8nMm27bNBRdcQFNTE9/85jfzlJ1cZewLX/gCs2fPBiAUCuWle0in04TDYa699lqeffZZVq1aha7r/nLslef9ndsf/fWh9z9vrO677z6mTZvm5zgJh8OccMIJrFy5Mk8ZmjlzJpWVlZimSSgUwnEcHn/8cV95Otrl95gA0MtAfuWVV3LllVceFWiPJBMe6ZkjPZfroopEItTV1bF69WoeeeQRysrK+MxnPkNVVZWv+Z133nm+DPbAAw9QVFTE5ZdfTm1tbR7HO/300/nVr35FPB7n5JNPpqyszOekIsIPf/hDHn30UVKpFCeffDLf//73GTRokK84nH/++fz2t79l165dvuznceRoNMrs2bM5ePAgixYtorW1lRNOOIF58+b5gHQch2HDhnHGGWewatWqvPwoudpoaWkpDzzwALt37+acc85hwYIFPkdXVZV77rmHp556Ck3T2LhxIwDPPvssnZ2dfhYqXdc555xzuPPOOzFN03f3TZ8+PY8rtrS0sGjRoiOatd4zJcSb7YcTRDVN88H6XpA3Kzdv3syXvvQlVq9eDcCaNWu48847CYVCfsqtXbt28fWvf53nn38egBUrVnDfffcRCoX8wauoqPA10TvuuIPHH3+csrIy6uvraW9v55577vG/vXnzZk4++WQuu+wynyMZhsHAgQPZtWtXvzbDtrY2Pve5z/HEE08AUFlZyR//+EfOP/98f0KJCEOGDDnsRHZdl2g0SkND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dIjnc920aVO/bhnv7wEDBjBu3DhfjgqHw+zcuZOGhoa8gEuAESNGMHXqVAYOHEh3dzcrV66ksbER27YZNmwY9fX1vokmk8mwceNG2tvbqaysZMKECX5Z0WiU7du3s2XLFn82e/F2hYWFmKbpL6uNjY1+e8LhMJMmTaKkpMSf/T09PaxatcoXG1RVpb6+nrlz51JTU4OI0NDQwIsvvsiBAweora3luOOO832rlmWxZs0auru7qa6uZvz48XnBBG+88QabNm3K67Py8nImTJjgT/BYLMbu3bvZsGEDABMmTGDIkCGk02lfTNi4cSNtbW158mA0GuUTn/gEEydOJBKJICI0NzezbNky36PjjZnXT3/729+YP3++Lyrous6NN97ID3/4Q0Kh0GEZzj91UxLvwYYbL/av76Vpmh+P+H5fiqIcMfbtcG14P663G6MXCoWkqKhIABk6dKisXLlSRETS6bQ4jiO7d++WE088sd+NZ7zXm5L67p3wQp+OpBX1tw+i794DjwN55eduIPJcaf3t2/AE/FyZz6tX3zD73P0suc/03ffRd+9Dbl09paKvf9ezqXkyUt/2ekrD2+mL3D7zOGLf9hypL3L/zpUX+9vC4Loup5xyCv/6r//Ktm3bmDJlCtOmTcvzCr344ousXLnymG98l+D6+F5edLeu63LLLbfkRU67riumaYqIyL59+44598tNnhtcfHz3GAMyfPhwaWxsFBER0zTFcRwfiPv375eLL77YB9+x3E/8wYmdCuh9JW8jVUdHB+FwGNM0aW1t5YUXXuC2227jtdde8+1+xzKS6UOUUSKg9yLYoq88eyy3YAYADOhdBZkEAAzoo8d1gy4IKABgQAEAAwooAGBAAQADCigAYEABAAMKKABgQAEAAwooAGBAAQADCigAYEABAAMKKABgQAEAAwooAGBAAQADCigAYEABAAMKKABgQAEAAwooAGBAAQADCigAYEABAAMKKABgQAEAAwooAGBAAQADCigAYEABAAMKKABgQAEAAwoAGFBAAQADCgAYUEABAAP6eNH/D2sRb903BWs8AAAAAElFTkSuQmCC";
function logoNode(big = false) {
  const wrap = el("div", { class: "logo" + (big ? " big" : "") });
  wrap.append(el("img", { class: "logo-icon", src: APP_ICON, alt: "", "aria-hidden": "true" }));
  wrap.append(el("div", { class: "wordmark" },
    el("span", {}, "Cards"),
    el("span", { class: "acc" }, "Against"),
    el("span", {}, "Humanity"),
    el("i", {}, "EDIZIONE ITALIANA")));
  return wrap;
}

// ------------------------------------------------------------------ setup

// Le schermate che si ridisegnano da sole (aggiungi persona, cambio categoria) non rifanno le animazioni.
let paintKey = "";
function still(key) {
  app.classList.toggle("still", key === paintKey);
  paintKey = key;
}

function setup() {
  game = null;
  still("setup:" + homeTab);
  Sound.setTheme("menu");
  document.body.classList.remove("in-game");
  clearTimeout(botTimer); clearTimeout(judgeTimer); clearTimeout(roundTimer); roundTimer = null;
  if (homeTab === "local") return showLocal();
  if (homeTab === "online") return showOnline();
  return showHome();
}

// Home: un titolo forte e tre voci di menu. Nessuna scatola, nessuno scorrimento.
// Marchio testuale: tre righe, "Against" in arancio. Usato in home e nell'animazione d'apertura.
function wordmarkNode(cls) {
  return el("div", { class: cls + " wm", role: "img", "aria-label": "Cards Against Humanity, edizione italiana" },
    el("span", {}, "Cards"), el("span", { class: "acc" }, "Against"), el("span", {}, "Humanity"));
}

let introDone = false;
// Il browser non lascia parlare né suonare prima di un tocco dell'utente: le voci in attesa partono al primo tocco.
const introWaiting = [];
function gestureReady() {
  return !navigator.userActivation || navigator.userActivation.hasBeenActive;
}
function whenAudible(fn) {
  if (gestureReady()) { fn(); return; }
  introWaiting.push(fn);
  const flush = () => {
    if (!gestureReady()) return;
    ["pointerdown", "keydown", "touchend"].forEach((ev) => document.removeEventListener(ev, flush, true));
    while (introWaiting.length) introWaiting.shift()();
  };
  ["pointerdown", "keydown", "touchend"].forEach((ev) => document.addEventListener(ev, flush, true));
}
// Apertura: fondo nero, "Cards" e "Humanity" con lo spazio vuoto in mezzo; poi "Against" in arancio,
// pronunciato mentre compare. Infine il titolo scende in alto a sinistra.
function playIntro(target) {
  introDone = true;
  const ov = el("div", { class: "intro", "aria-hidden": "true" },
    el("div", { class: "iw" }, el("span", {}, "Cards"), el("span", { class: "gap" }), el("span", {}, "Humanity")));
  document.body.append(ov);
  const iw = ov.querySelector(".iw");
  setTimeout(() => {
    const gap = ov.querySelector(".gap");
    if (gap) {
      const acc = el("span", { class: "acc" }, "Against");
      gap.replaceWith(acc);
      acc.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "ease-out" });
    }
  }, 900);
  setTimeout(() => {
    target.style.visibility = "hidden";
    const from = iw.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const k = to.width / from.width;
    const dx = to.left - from.left, dy = to.top - from.top;
    iw.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${k})` }],
      { duration: 800, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    const fade = ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, delay: 200, fill: "forwards" });
    fade.onfinish = () => { ov.remove(); target.style.visibility = ""; };
  }, 2000);
}

function showHome() {
  const row = (n, title, sub, go) => el("button", { type: "button", class: "menu-row", onclick: go },
    el("span", { class: "n" }, n),
    el("span", { class: "t" }, el("strong", {}, title), el("span", { class: "sub" }, sub)),
    el("span", { class: "arr", "aria-hidden": "true" }, "→"));
  const top = wordmarkNode("hdr-logo");
  app.replaceChildren(el("section", { class: "home" },
    el("div", { class: "home-top" }, top,
      el("button", { type: "button", class: "home-settings", "aria-label": "Impostazioni", onclick: openSettings })),
    el("nav", { class: "menu", "aria-label": "Menu" },
      row("01", "Locale", "Con amici e bot, un telefono solo", () => { homeTab = "local"; setup(); }),
      row("02", "Online", "Stanza con codice, fino a 10 giocatori", () => { homeTab = "online"; setup(); }),
      row("03", "Le carte", "Carte, categorie e pacchetti", () => cardsScreen()))));
  if (!introDone) requestAnimationFrame(() => playIntro(top));
}

function subHead(title) {
  return el("div", { class: "subhead" },
    el("button", { type: "button", class: "ghost back", onclick: () => { homeTab = "home"; setup(); } }, "← Home"),
    el("h2", { class: "display" }, title));
}

function showLocal() {
  app.replaceChildren(el("section", { class: "subscreen" }, subHead("Locale"), localPanel()));
}

function showOnline() {
  app.replaceChildren(el("section", { class: "subscreen" }, subHead("Online"), onlinePanel()));
}

function localPanel() {
  const hint = el("p", { class: "hidden-msg" });
  const startBtn = el("button", { class: "primary", type: "button", onclick: start }, "Inizia la partita");
  const nCards = (() => { const a = activeCustom(); return a.white.length + a.black.length; })();

  const refresh = () => {
    const total = cfg.names.length + cfg.bots.length;
    const ok = total >= 3;
    startBtn.disabled = !ok;
    hint.textContent = ok
      ? `${total} giocatori${cfg.bots.length ? ` (${cfg.bots.length} bot)` : ""} · vittoria a ${cfg.winScore} punti · ${cfg.deck === "base" ? "solo carte ufficiali" : `carte ufficiali + ${nCards} mie`}`
      : "Servono almeno 3 giocatori: aggiungi dei bot se siete meno.";
  };

  // I bot si gestiscono come i giocatori: il nome si modifica direttamente nella riga.
  const botRows = () => cfg.bots.map((n, i) => el("div", { class: "nrow" },
    el("input", { type: "text", value: n, maxlength: "16", placeholder: BOT_SUGGEST[i % BOT_SUGGEST.length], "aria-label": `Nome bot ${i + 1}`,
      oninput: (e) => { cfg.bots[i] = e.target.value; refresh(); } }),
    el("button", { type: "button", class: "ghost", "aria-label": "Togli bot", onclick: () => { cfg.bots.splice(i, 1); setup(); } }, "✕")));

  const nameRows = () => cfg.names.map((n, i) => el("div", { class: "nrow" },
    el("input", { type: "text", value: n, maxlength: "16", placeholder: `Giocatore ${i + 1}`, "aria-label": `Nome giocatore ${i + 1}`,
      oninput: (e) => { cfg.names[i] = e.target.value; refresh(); } }),
    cfg.names.length > 1 ? el("button", { type: "button", class: "ghost", "aria-label": "Rimuovi", onclick: () => { cfg.names.splice(i, 1); setup(); } }, "✕") : null));

  const winBtns = [3, 5, 8].map((n) => el("button", {
    type: "button", "aria-pressed": String(cfg.winScore === n),
    onclick: () => { cfg.winScore = n; setup(); },
  }, `${n} punti`));
  const deckBtns = [["base", "Solo ufficiali"], ["full", "Ufficiali + mie"]].map(([v, label]) => el("button", {
    type: "button", "aria-pressed": String(cfg.deck === v),
    onclick: () => { cfg.deck = v; setup(); },
  }, label));

  refresh();
  return el("div", { class: "panel" },
    el("span", { class: "label" }, `Giocatori (${cfg.names.length}/${MAX_HUMANS})`),
    el("div", { class: "names" }, nameRows()),
    cfg.names.length < MAX_HUMANS ? el("button", { type: "button", class: "ghost", onclick: () => { cfg.names.push(""); setup(); } }, "+ Aggiungi persona") : null,
    cfg.bots.length ? el("span", { class: "label" }, "Bot") : null,
    cfg.bots.length ? el("div", { class: "names" }, botRows()) : null,
    cfg.names.length + cfg.bots.length < 10 ? el("button", { type: "button", class: "ghost", onclick: () => askBotName(cfg.bots.length, (name) => { cfg.bots.push(name); setup(); }) }, "+ Aggiungi bot") : null,
    el("span", { class: "label" }, "Vittoria · decidetela prima di iniziare"),
    el("div", { class: "seg" }, winBtns),
    el("span", { class: "label" }, "Carte · quale mazzo"),
    el("div", { class: "seg" }, deckBtns),
    hint,
    startBtn);
}

function start() {
  unlocked = true;
  applySettings();
  const names = cfg.names.map((n, i) => (n || "").trim().slice(0, 16) || `Giocatore ${i + 1}`);
  const bots = cfg.bots.map((n, i) => ({ id: `b${i}`, name: n.trim() || BOT_SUGGEST[i % BOT_SUGGEST.length], isBot: true }));
  const players = [...names.map((name, i) => ({ id: `h${i}`, name })), ...bots];
  game = new Game(players, deckFor(), { winScore: cfg.winScore, pool: localPool });
  selected = [];
  judgeSel = null;
  viewer = null;
  lastViewer = null;
  dealPending = true;
  slamPending = true;
  game.start();
  Sound.play("shuffle");
  step();
}

// ------------------------------------------------------------------ carte e categorie

const CUSTOM_KEY = "cah-custom";
// Categorie fisse. Bianche: soggetti, luoghi, oggetti, azioni, situazioni. Nere: divise per numero di risposte.
const WHITE_CATS = ["Soggetti", "Luoghi", "Oggetti", "Azioni", "Situazioni"];
const BLACK_CATS = ["1 risposta", "2 risposte", "3 risposte"];
const CAT_COLOR = {
  "Soggetti": "#c4502a", "Luoghi": "#2f6fa3", "Oggetti": "#b8862b", "Azioni": "#7a4fb0", "Situazioni": "#2f8f7f",
  "1 risposta": "#5f7d2e", "2 risposte": "#b04a7a", "3 risposte": "#3d5a80",
};
const KIND = { "Soggetti": "Soggetto", "Luoghi": "Luogo", "Oggetti": "Oggetto", "Azioni": "Azione", "Situazioni": "Situazione" };
// Una carta nera sta nella categoria del suo numero di spazi: non si sceglie a mano.
const blackCatFor = (text) => BLACK_CATS[Math.min(3, Math.max(1, String(text).split("____").length - 1)) - 1];
const ORIG_COLOR = "#9a9186";
let cardsView = { tab: "white", cat: "Tutte" };

const catsOf = (color) => (color === "b" ? BLACK_CATS : WHITE_CATS);
const validCat = (name, color) => catsOf(color).includes(name);
const defaultCat = (color) => (color === "b" ? BLACK_CATS[0] : WHITE_CATS[WHITE_CATS.length - 1]);

function loadCustom() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "null"); } catch { d = null; }
  d = d && typeof d === "object" ? d : {};
  const fix = (list, color) => (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c.text === "string" && c.text.trim())
    .map((c) => ({ text: c.text, cat: color === "b" ? blackCatFor(c.text) : (validCat(c.cat, color) ? c.cat : defaultCat(color)) }));
  const catOverride = {};
  if (d.catOverride && typeof d.catOverride === "object") {
    for (const [id, cat] of Object.entries(d.catOverride)) if (!id.startsWith("b") && validCat(cat, "w")) catOverride[id] = cat;
  }
  const textOverride = {};
  if (d.textOverride && typeof d.textOverride === "object") {
    for (const [id, t] of Object.entries(d.textOverride)) if (typeof t === "string" && t.trim()) textOverride[id] = t.replace(/\s+/g, " ").trim().slice(0, 200);
  }
  const hidden = {};
  if (d.hidden && typeof d.hidden === "object") for (const [id, v] of Object.entries(d.hidden)) if (v === true) hidden[id] = true;
  return {
    hidden,
    textOverride,
    white: fix(d.white, "w"),
    black: fix(d.black, "b"),
    useWhite: d.useWhite !== false,   // le mie bianche entrano nelle partite
    useBlack: d.useBlack !== false,   // le mie nere entrano nelle partite
    catOverride,
  };
}

function saveCustom(d) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(d)); }
  catch { toast("Non riesco a salvare sul telefono"); }
}

const catColor = (name) => CAT_COLOR[name] ?? ORIG_COLOR;
// Ordine in mano: Soggetti, Luoghi, Oggetti, Azioni, Situazioni; le nere non finiscono in mano.
const catRank = (name) => {
  const i = WHITE_CATS.indexOf(name);
  return i >= 0 ? i : 500;
};
const handSorted = (hand) => [...hand].sort((a, b) => catRank(a.cat) - catRank(b.cat));
// Le carte scelte passano in testa alla mano, nell'ordine in cui sono state selezionate.
const handForRail = (hand) => {
  const picked = selected.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
  return [...picked, ...handSorted(hand).filter((c) => !selected.includes(c.id))];
};

// Le mie carte attive per le partite (se l'interruttore è acceso).
const activeCustom = () => {
  const d = loadCustom();
  return { white: d.useWhite ? d.white : [], black: d.useBlack ? d.black : [] };
};
// Categorie scelte dall'utente per le carte ufficiali.
const withOverrides = (cards) => {
  const { catOverride: o, textOverride: t, hidden } = loadCustom();
  const tag = (color) => (c) => {
    const text = t[c.id] ?? c.text;
    return { ...c, text, cat: color === "b" ? blackCatFor(text) : (o[c.id] ?? c.cat) };
  };
  const keep = (c) => !hidden[c.id];
  return { white: cards.white.filter(keep).map(tag("w")), black: cards.black.filter(keep).map(tag("b")) };
};
const deckFor = () => mergeCustom(withOverrides(CARDS), cfg.deck === "base" ? { white: [], black: [] } : activeCustom());

// Solo testi e categorie: il server li ripulisce di nuovo prima di usarli.
// Il messaggio di avvio sta in un frame da 64 KB: se le carte sono troppe, se ne tengono meno.
const CUSTOM_BUDGET = 56 * 1024;
function customPayload() {
  const a = activeCustom();
  const p = {
    white: a.white.map((c) => ({ text: c.text, cat: c.cat })),
    black: a.black.map((c) => ({ text: c.text, cat: c.cat })),
  };
  const size = () => new TextEncoder().encode(JSON.stringify(p)).length;
  let cut = false;
  while (size() > CUSTOM_BUDGET && (p.white.length || p.black.length)) {
    cut = true;
    if (p.white.length > p.black.length) p.white.pop(); else p.black.pop();
  }
  if (cut) toast("Troppe carte personali: per la partita ne entrano solo alcune");
  return p;
}

function allCards() {
  const d = loadCustom();
  const cat = (c) => d.catOverride[c.id] ?? c.cat;
  const txt = (c) => d.textOverride[c.id] ?? c.text;
  const shown = (c) => !d.hidden[c.id];
  const orig = [
    ...CARDS.white.filter(shown).map((c) => ({ id: c.id, text: txt(c), color: "w", cat: cat(c), mine: false })),
    ...CARDS.black.filter(shown).map((c) => ({ id: c.id, text: txt(c), color: "b", cat: blackCatFor(txt(c)), mine: false })),
  ];
  const mine = [
    ...d.white.map((c, i) => ({ id: `m${i}`, idx: i, text: c.text, color: "w", cat: c.cat, mine: true })),
    ...d.black.map((c, i) => ({ id: `mb${i}`, idx: i, text: c.text, color: "b", cat: c.cat, mine: true })),
  ];
  return { orig, mine, d };
}

// Un'unica schermata: carte, categorie, interruttori per le proprie carte, pacchetti.
// Griglia delle carte: 2, 4 o 6 colonne. Due dita che si avvicinano aumentano le colonne, che si allontanano le riducono.
const GRID_STEPS = [2, 4, 6];
let gridCols = (() => { try { const v = Number(localStorage.getItem("cah-grid-cols")); return GRID_STEPS.includes(v) ? v : 2; } catch (e) { return 2; } })();
function setGridCols(n) {
  gridCols = n;
  try { localStorage.setItem("cah-grid-cols", String(n)); } catch (e) { /* memoria del browser non disponibile */ }
}
// Cambio di colonne animato: ogni carta parte dalla vecchia posizione e scorre nella nuova.
function regrid(node, next) {
  const tiles = [...node.children];
  const before = tiles.map((t) => t.getBoundingClientRect());
  setGridCols(next);
  node.style.setProperty("--cols", String(next));
  node.style.setProperty("--k", String(2 / next));
  fitText(node);
  if (document.body.classList.contains("no-motion") || !node.animate) return;
  tiles.forEach((t, i) => {
    const a = before[i], b = t.getBoundingClientRect();
    if (!a.width || !b.width || !b.height) return;
    t.animate([
      { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, transformOrigin: "0 0" },
      { transform: "none", transformOrigin: "0 0" },
    ], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}
function gridNode(children) {
  const node = el("div", { class: "cgrid", style: `--cols:${gridCols};--k:${2 / gridCols}` }, children);
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  let d0 = 0;
  node.addEventListener("touchstart", (e) => { if (e.touches.length === 2) d0 = dist(e.touches); }, { passive: true });
  node.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !d0) return;
    const d = dist(e.touches);
    const i = GRID_STEPS.indexOf(gridCols);
    let next = null;
    if (d < d0 * 0.8 && i < GRID_STEPS.length - 1) next = GRID_STEPS[i + 1];      // si avvicinano: più carte
    else if (d > d0 * 1.25 && i > 0) next = GRID_STEPS[i - 1];                   // si allontanano: carte più grandi
    if (next !== null) { regrid(node, next); d0 = d; }
  }, { passive: true });
  node.addEventListener("touchend", (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  requestAnimationFrame(() => fitText(node)); // il testo si adatta alla densità scelta
  return node;
}

function cardsScreen() {
  game = null;
  still("cards");
  document.body.classList.remove("in-game");
  clearTimeout(botTimer); clearTimeout(judgeTimer); clearTimeout(roundTimer); roundTimer = null;
  window.scrollTo(0, 0);
  const { orig, mine, d } = allCards();
  const all = [...orig, ...mine];
  const v = cardsView;
  const color = v.tab === "black" ? "b" : "w";
  const isMine = v.tab === "mine-w" || v.tab === "mine-b";
  let list = isMine ? mine.filter((c) => c.color === (v.tab === "mine-b" ? "b" : "w")) : all.filter((c) => c.color === color);
  if (!isMine && v.cat !== "Tutte") list = list.filter((c) => c.cat === v.cat);

  const count = (c) => all.filter((x) => x.color === c).length;
  const tabBtn = (id, label) => el("button", { type: "button", "aria-pressed": String(v.tab === id),
    onclick: () => { v.tab = id; v.cat = "Tutte"; cardsScreen(); } }, label);
  const catBtn = (name) => el("button", { type: "button", class: "chip", "aria-pressed": String(v.cat === name),
    style: `--cat:${catColor(name)}`, onclick: () => { v.cat = name; cardsScreen(); } }, name);
  const tile = (c) => {
    const held = { v: false };
    const node = el("button", { type: "button", class: `pcard ${c.color === "w" ? "w" : "b"}`,
      style: `--cat:${catColor(c.cat)}`,
      onclick: () => { if (held.v) return; showCardDetail(c, () => cardsScreen(), list); } },
      el("span", { class: "txt" }, c.text),
      el("span", { class: "tag" }, c.mine ? `${c.cat} · tua` : c.cat));
    attachHold(node, () => { held.v = true; Sound.play("flip"); cardActions(c, () => cardsScreen()); }, held);
    return node;
  };
  const toggle = (key, label) => el("button", { type: "button", class: "switch", "aria-pressed": String(d[key]),
    onclick: () => { const x = loadCustom(); x[key] = !x[key]; saveCustom(x); cardsScreen(); } },
    `${label}: ${d[key] ? "sì" : "no"}`);
  // Equilibrio: quante carte per categoria, per aiutare a bilanciare quelle nuove.
  const balance = (c, pool) => {
    const counts = catsOf(c).map((n) => ({ n, k: pool.filter((x) => x.color === c && x.cat === n).length }));
    const max = Math.max(1, ...counts.map((x) => x.k));
    const min = Math.min(...counts.map((x) => x.k));
    return el("div", { class: "balance" },
      el("span", { class: "label" }, `Equilibrio ${c === "b" ? "nere" : "bianche"} per categoria`),
      ...counts.map(({ n, k }) => el("div", { class: "bal-row", style: `--cat:${catColor(n)}` },
        el("span", { class: "bal-name" }, n),
        el("span", { class: "bal-bar" }, el("span", { class: "bal-fill", style: `width:${Math.round((k / max) * 100)}%` })),
        el("span", { class: k === min && k !== max ? "bal-n low" : "bal-n" }, String(k)))));
  };
  const stat = (n, label) => el("div", { class: "stat" }, el("strong", {}, String(n)), el("span", { class: "label" }, label));

  // Pacchetti: esporta le proprie carte, importa quelle ricevute.
  const packData = () => ({ formato: "cah-pacchetto", versione: 2, white: d.white, black: d.black });
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(packData(), null, 2)], { type: "application/json" }));
    const a = el("a", { href: url, download: "cah-pacchetto.json" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = () => {
    selectAll();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    toast(ok ? "Testo copiato" : "Premi Seleziona tutto, poi copia");
  };
  const pasteIn = el("textarea", { rows: "6", placeholder: "Una frase per riga\nFrase bianca\nFrase con ____ nera", "aria-label": "Frasi da importare" });
  const exportBox = el("textarea", { rows: "4", readonly: "", "aria-label": "Le tue carte in testo", onfocus: (e) => e.target.select() });
  exportBox.value = JSON.stringify(packData());
  const selectAll = () => { exportBox.focus(); exportBox.select(); exportBox.setSelectionRange(0, exportBox.value.length); };

  app.replaceChildren(el("section", { class: "cards-screen" },
    el("div", { class: "subhead" },
      el("button", { type: "button", class: "ghost back", onclick: () => { homeTab = "home"; setup(); } }, "← Home"),
      el("div", { class: "head-row" },
        el("h2", { class: "display" }, "Le carte"),
        el("button", { type: "button", class: "add", onclick: () => openCardForm((c) => { v.tab = c === "b" ? "mine-b" : "mine-w"; cardsScreen(); }) }, "+ Aggiungi"))),
    el("div", { class: "cstats" },
      stat(count("w"), "Bianche"), stat(count("b"), "Nere"), stat(mine.length, "Mie")),
    el("div", { class: "tabs", role: "group", "aria-label": "Tipo di carta" },
      tabBtn("white", "Bianche"), tabBtn("black", "Nere"), tabBtn("mine-w", "Mie bianche"), tabBtn("mine-b", "Mie nere")),
    balance(v.tab === "black" || v.tab === "mine-b" ? "b" : "w", all),
    isMine ? null : el("div", { class: "chips", role: "group", "aria-label": "Categorie" },
      ["Tutte", ...catsOf(color)].map(catBtn)),
    list.length
      ? gridNode(list.map(tile))
      : el("p", { class: "hidden-msg" }, isMine ? `Non hai ancora carte ${v.tab === "mine-b" ? "nere" : "bianche"} tue: tocca + per aggiungerne.` : "Nessuna carta con questo filtro."),
    Object.keys(d.hidden).length
      ? el("button", { type: "button", class: "ghost", onclick: () => { const x = loadCustom(); x.hidden = {}; saveCustom(x); cardsScreen(); } },
        `Ripristina ${Object.keys(d.hidden).length} carte eliminate`)
      : null,
    el("span", { class: "label", style: "margin-top:10px" }, "Nelle partite"),
    el("div", { class: "switches" }, toggle("useWhite", "Mie bianche"), toggle("useBlack", "Mie nere")),
    el("span", { class: "label", style: "margin-top:10px" }, "Condividi le tue carte"),
    el("p", { class: "hidden-msg" }, "Qui sotto c'è il testo con le tue carte. Premi \"Seleziona tutto\", copia e mandalo a chi vuoi."),
    exportBox,
    el("div", { class: "pack-row" },
      el("button", { type: "button", onclick: selectAll }, "Seleziona tutto"),
      el("button", { type: "button", onclick: copy }, "Copia")),
    el("span", { class: "label", style: "margin-top:10px" }, "Ricevi carte"),
    el("p", { class: "hidden-msg" }, "Incolla le frasi, una per riga: con ____ diventa una nera, senza diventa una bianca. Poi premi Aggiungi."),
    pasteIn,
    el("button", { type: "button", class: "primary", onclick: () => importPack(pasteIn.value) }, "Aggiungi le carte")));
}

function showCardDetail(c, refresh, list = [c]) {
  let idx = Math.max(0, list.findIndex((x) => x.id === c.id));
  let cur = list[idx] ?? c;
  const card = el("div", { class: "zoom" });
  const counter = el("p", { class: "hidden-msg" });
  const catRow = el("div", { class: "chips", role: "group", "aria-label": "Categoria" });
  const close = () => bg.remove();
  const paint = () => {
    cur = list[idx] ?? cur;
    card.className = `zoom ${cur.color === "w" ? "w" : "b"}`;
    card.style.setProperty("--cat", catColor(cur.cat));
    card.replaceChildren(el("div", { class: "txt" }, cur.text));
    counter.textContent = `${idx + 1} / ${list.length} · ${cur.color === "w" ? "bianca" : "nera"} · ${cur.mine ? "tua" : "ufficiale"}`;
    catRow.replaceChildren(...catsOf(cur.color).map((name) => el("button", {
      type: "button", class: "chip", style: `--cat:${catColor(name)}`,
      "aria-pressed": String(cur.cat === name),
      onclick: () => { applyCat(cur, name); paint(); },
    }, name)));
  };
  const step = (k) => { if (list.length > 1) { idx = (idx + k + list.length) % list.length; paint(); } };
  let x0 = null;
  card.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
  card.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  });
  const bg = el("div", { class: "zoom-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "detail" },
      el("div", { class: "sheet-nav" },
        el("button", { type: "button", class: "ghost icon", "aria-label": "Carta precedente", onclick: () => step(-1) }, "‹"),
        counter,
        el("button", { type: "button", class: "ghost icon", "aria-label": "Carta successiva", onclick: () => step(1) }, "›")),
      card,
      catRow,
      el("div", { class: "actions" },
        cur.mine ? el("button", { type: "button", class: "ghost danger", onclick: () => { close(); deleteCard(cur, refresh); } }, "Elimina") : null,
        el("button", { type: "button", class: "ghost", onclick: () => shareText(cur) }, "Condividi"),
        el("button", { type: "button", class: "primary", onclick: () => { close(); refresh(); } }, "Chiudi"))));
  paint();
  document.body.append(bg);
}

// Pressione lunga: categoria, copia, elimina.
function cardActions(c, refresh) {
  const close = () => bg.remove();
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet card-form" },
      el("p", { class: "label" }, c.cat),
      el("p", { class: "action-text" }, c.text),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "ghost", onclick: () => { close(); openCardEditor(c, refresh); } }, "Modifica"),
        el("button", { type: "button", class: "ghost danger", onclick: () => { close(); c.mine ? deleteCard(c, refresh) : hideOfficial(c.id, refresh); } }, "Elimina"),
        !c.mine && hasOverride(c.id) ? el("button", { type: "button", class: "ghost", onclick: () => { resetOverride(c.id); close(); refresh(); } }, "Ripristina") : null,
        el("button", { type: "button", class: "ghost", onclick: () => shareText(c) }, "Condividi"),
        el("button", { type: "button", class: "primary", onclick: close }, "Annulla"))));
  document.body.append(bg);
}

const hasOverride = (id) => { const d = loadCustom(); return id in d.textOverride || id in d.catOverride || id in d.hidden; };
function resetOverride(id) {
  const d = loadCustom();
  delete d.textOverride[id];
  delete d.catOverride[id];
  delete d.hidden[id];
  saveCustom(d);
}
// Una carta ufficiale eliminata sparisce dalle liste e dalle partite locali; si può ripristinare.
function hideOfficial(id, refresh) {
  const d = loadCustom();
  d.hidden[id] = true;
  saveCustom(d);
  toast("Carta eliminata");
  refresh();
}

// Modifica testo e categoria di una carta, sia ufficiale sia tua (bianca o nera).
function openCardEditor(c, refresh) {
  let cat = c.cat;
  const txt = el("textarea", { maxlength: "200", rows: "4", "aria-label": "Testo della carta" });
  txt.value = c.text;
  const chips = el("div", { class: "chips", role: "group", "aria-label": "Categoria" });
  const paint = () => chips.replaceChildren(...catsOf(c.color).map((name) => el("button", {
    type: "button", class: "chip", style: `--cat:${catColor(name)}`, "aria-pressed": String(cat === name),
    onclick: () => { cat = name; paint(); },
  }, name)));
  paint();
  const close = () => bg.remove();
  const save = () => {
    let text = txt.value.replace(/\s+/g, " ").trim();
    if (!text) { toast("Scrivi il testo della carta"); return; }
    if (c.color === "b") {
      if (!text.includes("____")) text += " ____";
      const n = text.split("____").length - 1;
      if (n > 3) { toast("Una carta nera può avere al massimo 3 spazi"); return; }
      if (BLACK_CATS[n - 1] !== cat) { toast(`Questa carta ha ${n} ${n === 1 ? "spazio" : "spazi"}: scegli "${BLACK_CATS[n - 1]}"`); return; }
    }
    const d = loadCustom();
    if (c.mine) {
      (c.color === "w" ? d.white : d.black)[c.idx] = { text, cat };
    } else {
      d.textOverride[c.id] = text;
      if (c.color === "w") d.catOverride[c.id] = cat;
    }
    saveCustom(d);
    close();
    refresh();
  };
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet card-form" },
      el("p", { class: "label" }, c.mine ? "Modifica la tua carta" : "Modifica la carta ufficiale"),
      txt,
      el("span", { class: "label" }, "Categoria"),
      chips,
      el("div", { class: "actions" },
        el("button", { type: "button", class: "ghost", onclick: close }, "Annulla"),
        el("button", { type: "button", class: "primary", onclick: save }, "Salva"))));
  document.body.append(bg);
}

function applyCat(c, name) {
  if (c.color !== "w" || !validCat(name, "w")) return;
  const d = loadCustom();
  if (c.mine) (c.color === "w" ? d.white : d.black)[c.idx].cat = name;
  else d.catOverride[c.id] = name;
  saveCustom(d);
}

function deleteCard(c, refresh) {
  if (!confirm("Eliminare questa carta?")) return;
  const d = loadCustom();
  (c.color === "w" ? d.white : d.black).splice(c.idx, 1);
  saveCustom(d);
  refresh();
}

function shareText(c) {
  const text = `"${c.text}" · ${c.cat}`;
  if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
  navigator.clipboard?.writeText(text).then(() => toast("Carta copiata"), () => toast("Non riesco a copiare"));
}

// Nuova carta: bianca o nera, con una delle categorie fisse di quel tipo.
function openCardForm(done) {
  let color = "w";
  const txt = el("textarea", { maxlength: "200", rows: "4", placeholder: "Scrivi la carta…", "aria-label": "Testo della carta" });
  // Categoria: pulsantini in riga invece del menu a tendina del telefono.
  let catVal = catsOf("w")[0];
  const catRow = el("div", { class: "cat-row", role: "group", "aria-label": "Categoria" });
  const fillCats = () => {
    catRow.hidden = color === "b";
    catRow.replaceChildren(...catsOf("w").map((n) => el("button", {
      type: "button", class: "chip", "aria-pressed": String(n === catVal),
      onclick: () => { catVal = n; fillCats(); },
    }, n)));
  };
  const wBtn = el("button", { type: "button", "aria-pressed": "true", onclick: () => setColor("w") }, "Bianca");
  const bBtn = el("button", { type: "button", "aria-pressed": "false", onclick: () => setColor("b") }, "Nera");
  const setColor = (c) => {
    color = c;
    wBtn.setAttribute("aria-pressed", String(c === "w"));
    bBtn.setAttribute("aria-pressed", String(c === "b"));
    fillCats();
    update();
  };
  fillCats();
  // Suggerimenti in tempo reale (stile T9) e anteprima della carta nera.
  const hints = el("div", { class: "spell-hints", "aria-live": "polite" });
  const prev = el("div", { class: "card-preview", "aria-live": "polite" });
  const pickHint = (word) => {
    const cur = txt.value;
    const m = cur.match(/[\p{L}'-]+$/u);
    const base = m ? cur.slice(0, cur.length - m[0].length) : cur;
    const cap = m && /^\p{Lu}/u.test(m[0]) ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    txt.value = base + cap + " ";
    update();
    txt.focus();
  };
  const update = () => {
    const word = currentWord(txt.value);
    if (SPELL) {
      const h = spellHints(SPELL, word);
      hints.replaceChildren(...h.items.map((w) =>
        el("button", { type: "button", class: h.exact ? "chip" : "chip fix", onclick: () => pickHint(w) }, h.exact ? w : `${w} ?`)));
    } else {
      hints.replaceChildren();
      loadSpell().then(() => update());
    }
    if (color === "b") {
      const text = txt.value.replace(/\s+/g, " ").trim();
      prev.hidden = false;
      prev.textContent = text ? text.replace(/_{4,}|____/g, "_____") : "Anteprima della carta nera";
    } else {
      prev.hidden = true;
    }
  };
  txt.addEventListener("input", (e) => { if (e.inputType !== "deleteContentBackward") Sound.play("key"); update(); });
  loadSpell().then(update);
  const save = () => {
    const d = loadCustom();
    let text = txt.value.replace(/\s+/g, " ").trim();
    if (!text) { toast("Scrivi il testo della carta"); return; }
    if (color === "b") {
      if (!text.includes("____")) text += " ____";
      if (text.split("____").length - 1 > 3) { toast("Una carta nera può avere al massimo 3 spazi"); return; }
    }
    (color === "w" ? d.white : d.black).push({ text, cat: color === "w" ? catVal : blackCatFor(text) });
    saveCustom(d);
    bg.remove();
    Sound.play("saved");
    done(color);
  };
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) bg.remove(); } },
    el("div", { class: "sheet card-form" },
      el("div", { class: "seg" }, wBtn, bBtn),
      txt,
      hints,
      prev,
      el("p", { class: "hidden-msg" }, "Bianca: una frase o un oggetto. Nera: scrivi ____ dove va la risposta."),
      catRow,
      el("div", { class: "actions" },
        el("button", { type: "button", class: "ghost", onclick: () => bg.remove() }, "Annulla"),
        el("button", { type: "button", class: "primary", onclick: save }, "Salva carta"))));
  document.body.append(bg);
}

// Testo semplice: una frase per riga. Con ____ è nera, senza è bianca.
function importLines(text) {
  const d = loadCustom();
  const seen = new Set([...d.white, ...d.black].map((c) => c.text.toLowerCase()));
  let added = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    let t = raw.replace(/\s+/g, " ").trim();
    if (!t || t.startsWith("#")) continue;
    t = t.slice(0, 200);
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    if (t.includes("____")) {
      if (t.split("____").length - 1 > 3) continue;
      d.black.push({ text: t, cat: blackCatFor(t) });
    } else {
      d.white.push({ text: t, cat: defaultCat("w") });
    }
    added++;
  }
  saveCustom(d);
  toast(`Importate ${added} carte`);
  cardsView.tab = "mine-w";
  cardsScreen();
}

function importPack(text) {
  const trimmed = String(text).trim();
  if (trimmed && !trimmed.startsWith("{")) { importLines(trimmed); return; }
  let data;
  try { data = JSON.parse(text); } catch { toast("Pacchetto non valido"); return; }
  if (!data || data.formato !== "cah-pacchetto") { toast("Non è un pacchetto di CAH"); return; }
  const clean = (list, color) => (Array.isArray(list) ? list : []).slice(0, 300).map((c) => ({
    text: String(c?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    cat: color === "b" ? blackCatFor(String(c?.text ?? "")) : (validCat(c?.cat, color) ? c.cat : defaultCat(color)),
  })).filter((c) => c.text);
  const d = loadCustom();
  const same = (list, x) => list.some((y) => y.text === x.text && y.cat === x.cat);
  let added = 0;
  for (const c of clean(data.white, "w")) if (!same(d.white, c)) { d.white.push(c); added++; }
  for (const c of clean(data.black, "b")) {
    if (!c.text.includes("____")) c.text += " ____";
    if (c.text.split("____").length - 1 > 3 || same(d.black, c)) continue;
    d.black.push(c); added++;
  }
  saveCustom(d);
  toast(`Importate ${added} carte`);
  cardsView.tab = "mine-w";
  cardsScreen();
}

const readingMs = (n) => Math.min(60000, 15000 + 8000 * n);
const humanIds = () => game.players.filter((p) => !p.isBot).map((p) => p.id);
// Carte già uscite nelle partite locali di questa pagina: non si ripetono finché i mazzi non finiscono.
const localPool = { white: new Set(), black: new Set() };

// Chi deve guardare lo schermo adesso: chi deve giocare, o il Re.
function viewerFor() {
  if (online) return online.you;
  const humans = humanIds();
  if (game.phase === "playing") {
    return humans.find((id) => id !== game.judge.id && !game.submissions.has(id)) ?? humans[0];
  }
  return game.judge.isBot ? humans[0] : game.judge.id;
}

function step() {
  clearTimeout(botTimer); clearTimeout(judgeTimer); clearTimeout(roundTimer); roundTimer = null;
  if (online) return render();   // online: il server decide tutto, la UI segue lo stato
  if (!game) return;
  if (game.phase === "playing") {
    const botsPending = game.players.some((p) => p.isBot && p.id !== game.judge.id && !game.submissions.has(p.id));
    if (botsPending) botTimer = setTimeout(() => { game.playBots(); step(); }, 2000);
  } else if (game.phase === "judging" && game.judge.isBot) {
    judgeTimer = setTimeout(() => { game.advanceBotJudge(); step(); }, BOT_JUDGE_STEP_MS);   // il Re bot sfoglia e sceglie a passi
  }
  render();
}

// Una volta per turno: la mano viene sostituita con 10 carte nuove. Le carte selezionate spariscono con la mano.

// Il V del giocatore si accende solo quando il jolly ha un testo.
function syncJollyReady() {
  const v = app.querySelector(".cc-v");
  if (v && selected.includes(JOLLY)) v.disabled = !jollyDraft.trim();
}

// Memory del Re, mentre gli altri scelgono: 8 coppie, 16 tessere. Finito in tempo, vince il jolly.
function newMemory(round) {
  const tiles = [];
  for (let pair = 0; pair < MEMORY_IMGS.length; pair++) { tiles.push({ pair }, { pair }); }
  for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
  return { round, tiles: tiles.map((t) => ({ ...t, up: false, done: false })), open: [], busy: false, won: false };
}

function memoryTap(i) {
  if (!mem || mem.busy || mem.won) return;
  const t = mem.tiles[i];
  if (t.up || t.done) return;
  t.up = true;
  mem.open.push(i);
  Sound.play("flip");
  if (mem.open.length === 2) {
    mem.busy = true;
    const [a, b] = mem.open.map((k) => mem.tiles[k]);
    setTimeout(() => {
      if (a.pair === b.pair) { a.done = true; b.done = true; Sound.play("pair"); }
      else { a.up = false; b.up = false; }
      mem.open = [];
      mem.busy = false;
      if (mem.tiles.every((x) => x.done)) { mem.won = true; memoryWon(); }
      render();
    }, 700);
  }
  render();
}

// Tempo scaduto: tutti hanno scelto e il Memory non è finito. Scritta che sfuma, senza suoni.
function expiredFlash() {
  const n = el("div", { class: "expired", role: "status" }, "Tempo scaduto: il jolly resta in gioco");
  document.body.append(n);
  setTimeout(() => n.remove(), 2400);
}

// Il Re ha finito il Memory: il server decide se è in tempo per il jolly.
function memoryWon() {
  Sound.play("trumpet");   // tromba e vibrazione: il jolly è vinto
  if (online) { netSend({ type: "memoryDone" }); render(); return; }
  game.awardJolly(viewer);
  step();
}

function memoryBoard(s) {
  if (!mem || mem.round !== s.round) mem = newMemory(s.round);
  const tile = (t, i) => el("button", {
    type: "button",
    class: "mtile" + (t.up || t.done ? " up" : "") + (t.done ? " done" : ""),
    "aria-label": t.up || t.done ? "Carta girata" : "Carta coperta",
    style: `--hue:${MEMORY_HUE[t.pair]}deg`,
    onclick: () => memoryTap(i),
  },
    el("span", { class: "mface mfront" }, el("img", { src: MEMORY_IMGS[t.pair], alt: "", draggable: "false" })),
    el("span", { class: "mface mback" }, el("span", { class: "mlogo" }, el("b", {}, "Cards"), el("em", {}, "Against"), el("b", {}, "Humanity"))));
  if (mem.won) {
    // Jolly vinto: compare al centro, grande, con una leggera animazione.
    return el("div", { class: "memory jolly-won", role: "status" },
      el("p", { class: "memory-hint" }, "Hai vinto il jolly!"),
      el("img", { class: "jolly-reveal", src: JOLLY_IMG, alt: "Carta jolly vinta" }));
  }
  return el("div", { class: "memory", role: "group", "aria-label": "Memory per il jolly" },
    el("p", { class: "memory-hint" }, "Trova le coppie prima che rispondano: chi finisce vince il jolly."),
    el("div", { class: "memgrid" }, mem.tiles.map(tile)));
}

function humanPlay() {
  if (selected.length !== game.currentBlack.blanks) return;
  if (selected.includes(JOLLY) && !jollyDraft.trim()) return;
  try {
    game.play(viewer, selected, jollyDraft.trim());
    selected = [];
    jollyDraft = "";
    Sound.play("confirm");
  } catch (err) {
    Sound.play("error");
    render();
    return;
  }
  step();
}

let pendingFrom = null;   // carta scelta dal Re: da dove parte il volo verso il punto
function humanConfirmJudge() {
  if (judgeSel === null) return;
  const src = app.querySelector(`.combo[data-idx="${judgeSel}"] .black`);
  pendingFrom = src ? { rect: src.getBoundingClientRect(), node: src } : null;
  game.pick(viewer, judgeSel);
  judgeSel = null;
  Sound.play("confirm");
  step();
}

function nextRound() {
  clearTimeout(roundTimer); roundTimer = null;
  if (shrinkGhost) { shrinkGhost.remove(); shrinkGhost = null; }
  game.nextRound();
  selected = [];
  judgeSel = null;
  dealPending = true;
  slamPending = true;
  Sound.play("slam");
  step();
}

// Il Re cambia combinazione: la vista va agli altri (online al server, in locale direttamente alla partita).
function setJudgeView(i) {
  judgeView = i;
  if (online) netSend({ type: "peek", index: i });
  else if (game) game.peekTo(game.judge.id, i);
}

// Le risposte in fila: le altre persone le vedono comparire mentre il Re le sfoglia, e poi quella scelta si evidenzia.
// Combinazioni a grandezza di carta, affiancate: le vede il Re e, dopo "Vedi tutte", anche gli altri.
function comboRow(s, selectedIdx, interactive, peekIdx = null) {
  const total = s.reveal.length;
  let k = 0;
  const row = el("div", { class: "combo-row", role: "group", "aria-label": "Combinazioni" },
    s.reveal.map((r) => {
      // peekIdx: fino a quale combinazione il Re ha sfogliato. Le altre restano coperte per chi non è il Re.
      const unseen = peekIdx !== null && r.index > peekIdx;
      const fresh = peekIdx !== null && !unseen && r.index > stripShown;
      let card;
      if (unseen || !r.cards) {
        card = el("div", { class: "black-wrap", role: "img", "aria-label": `Combinazione ${r.index + 1} di ${total}, ancora coperta` },
          el("div", { class: "black hidden-black" },
            el("div", { class: "text" }, "…"),
            el("div", { class: "foot" }, `Combinazione ${r.index + 1}`)));
      } else {
        card = blackCard(s, r.cards.map((c) => c.text), { label: `Combinazione ${r.index + 1} di ${total}` });
      }
      card.className = "black-wrap combo" + (selectedIdx === r.index ? " sel" : "") + (unseen ? " unseen" : "") + (fresh ? " rv-new" : "");
      card.dataset.idx = String(r.index);
      if (fresh) { const txt = card.querySelector(".text"); if (txt) txt.style.animationDelay = `${k * 220}ms`; k += 1; }
      if (interactive && selectedIdx === r.index) {
        // Sulla carta scelta: X arancione per tornare alle combinazioni, V arancione per confermare.
        const ctrl = el("div", { class: "combo-ctrl" },
          el("button", { type: "button", class: "cc-x", "aria-label": "Torna alle combinazioni", onclick: (e) => { e.stopPropagation(); setJudgeSel(null); Sound.play("pick"); render(); } }, "✕"),
          el("button", { type: "button", class: "cc-v", "aria-label": "Conferma questa risposta", onclick: (e) => { e.stopPropagation(); humanConfirmJudge(); } }, "✓"));
        card.append(ctrl);
      }
      if (interactive) card.onclick = () => { if (selectedIdx === r.index) return; setJudgeSel(r.index); Sound.play("pick"); render(); };
      return card;
    }));
  if (peekIdx !== null) stripShown = Math.max(stripShown, peekIdx);
  return row;
}

function markCompare() {
  if (online) netSend({ type: "compare" });
  else if (game) game.compareAll(game.judge.id);
}

function setJudgeSel(i) {
  judgeSel = i;
  if (online) netSend({ type: "select", index: i });
  else if (game) game.selectTo(game.judge.id, i);
}

function resetJudgeIfNewRound() {
  if (judgeRound !== game.round) {
    judgeRound = game.round;
    judgeView = 0;
    judgeMode = "browse";
    judgeSel = null;
  }
}

// Il pulsante dice quante combinazioni ci sono davvero.
function vediTutteLabel(total) {
  const n = { 2: "due", 3: "tre", 4: "quattro", 5: "cinque", 6: "sei" }[total];
  return n ? `Vedi tutte e ${n}` : `Vedi tutte (${total})`;
}

function previewWhites(s) {
  // Dopo la scelta del Re la carta nera mostra la risposta vincente, compilata.
  if (s.phase === "roundEnd" && s.winnerCards?.length) return [...s.winnerCards];
  const out = new Array(s.black.blanks).fill(null);
  if (s.phase === "judging" && s.judgeId !== viewer && s.mine) return s.mine.slice(0, out.length);
  if (s.phase === "judging" && s.judgeId === viewer) {
    const r = s.reveal[judgeView];
    if (r) r.cards.forEach((c, i) => { out[i] = c.text; });
  } else if (s.phase === "playing") {
    selected.forEach((id, i) => { out[i] = id === JOLLY ? (jollyDraft || "Jolly") : game.text(id); });
  }
  return out;
}

function blackCard(s, whites, { canPlay, label, slam, jollyAt = -1 } = {}) {
  const segs = fillSentence(s.black.text, whites);
  // Solo le parole appena inserite si animano; le altre restano ferme quando si tocca altro.
  let k = 0;
  let wi = -1;
  const nodes = segs.map((x, idx) => {
    if (x.t === "text") return x.v;
    if (x.t === "word") {
      wi += 1;
      // Il jolly non passa dalla grammatica: quello che scrivi resta com'è.
      if (wi === jollyAt) {
        return el("span", { class: "word jolly-word" }, el("input", {
          class: "jolly-in", type: "text", maxlength: String(JOLLY_MAX), placeholder: "scrivi qui", "aria-label": "Testo del jolly",
          value: jollyDraft, autocomplete: "off", autocapitalize: "sentences",
          oninput: (e) => { jollyDraft = e.target.value; syncJollyReady(); },
        }));
      }
      const fresh = canPlay && k >= wordsShown; k += 1;
      // Il punto (o la virgola) che segue la risposta resta attaccato all'ultima parola: non va mai a capo da solo.
      const next = segs[idx + 1];
      const punct = next && next.t === "text" ? (next.v.match(/^[.,;:!?]+/) || [""])[0] : "";
      if (punct) { next.v = next.v.slice(punct.length); }
      const m = x.v.match(/^(.*?)(\S+)$/s);
      const body = m ? m[1] : "";
      const last = (m ? m[2] : x.v) + punct;
      return el("span", { class: "word" + (fresh ? " fresh" : "") }, body, el("span", { class: "nw" }, last));
    }
    return el("span", { class: canPlay ? "slot lit" : "slot" }, "_____");
  });
  wordsShown = k;
  return el("div", { class: "black-wrap" },
    el("div", { class: "black" + (slam ? " slam" : ""), role: "region", "aria-label": "Carta nera" },
      el("div", { class: "text" }, ...nodes),
      el("div", { class: "foot" }, label ?? (s.black.blanks > 1 ? `${s.black.blanks} risposte` : "1 risposta"))));
}


const CROWN_SVG = '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M4 34 L8 9 L22 22 L32 3 L42 22 L56 9 L60 34 Z" fill="#ff7a3d"/><rect x="4" y="31" width="56" height="7" rx="2" fill="#ff7a3d"/></svg>';

// Schermata di vittoria per tutti: stesso stile del passaggio di turno, con la corona e un segnaposto per punto.
const WINNER_LINES = [
  "Grazie al suo talento nel parlare con i piccioni.",
  "Grazie alla sua collezione di pantofole che parlano.",
  "Grazie ai suoi occhi a forma di tegola.",
  "Grazie alla sua passione per le patate lessate.",
  "Grazie al suo gatto che sa leggere il futuro.",
  "Grazie alle sue sopracciglia, che hanno un lavoro part-time.",
  "Grazie al suo cugino che vende aria in scatola.",
  "Grazie alla sua zia che ha sposato un frigorifero.",
  "Grazie al suo naso, che ha una pensione.",
  "Grazie alla sua dieta a base di cuscini.",
  "Grazie al suo grande segreto: non sa nuotare.",
  "Grazie alle sue ginocchia, che cantano nelle riunioni.",
  "Grazie al suo sogno di diventare un ombrello.",
  "Grazie alla sua abitudine di salutare le sedie.",
  "Grazie al suo pappagallo che insulta i vicini.",
  "Grazie alla sua barba, che ha vinto due medaglie.",
  "Grazie al suo vestito fatto di carta da forno.",
  "Grazie alla sua mania di contare le nuvole.",
  "Grazie al suo maestro di yoga, un tostapane.",
  "Grazie alla sua ricetta della torta al sapone.",
  "Grazie alla sua capacità di piangere per le lasagne.",
  "Grazie alle sue scarpe che parlano in dialetto.",
  "Grazie al suo vicino di casa, un antico pinguino.",
  "Grazie alla sua lezione sulla pazienza delle lumache.",
  "Grazie alla sua playlist dedicata ai sanpietrini.",
  "Grazie al suo cane che ha paura dei gelati.",
  "Grazie alla sua faccia da gelatina scaduta.",
  "Grazie al suo primo amore: una lampada da comodino.",
  "Grazie alla sua abitudine di dormire in piedi.",
  "Grazie alla sua sorella, che fa la maga delle olive.",
  "Grazie alla sua scoperta: il formaggio è un cappello.",
  "Grazie alla sua collezione di tappi di bottiglia parlanti.",
  "Grazie al suo orologio che va all'indietro.",
  "Grazie alla sua nonna, che ha inventato il ping pong a mano.",
  "Grazie alla sua mania di parlare con le porte.",
  "Grazie alla sua voce da trombone arrabbiato.",
  "Grazie al suo libro preferito: il manuale delle spugne.",
  "Grazie alla sua tecnica per scaldare il ghiaccio.",
  "Grazie al suo esame di guida con il cavallo.",
  "Grazie alla sua bici a forma di cetriolo.",
  "Grazie al suo talento nel fare nodi alle nuvole.",
  "Grazie alla sua fotografia di un cucchiaio triste.",
  "Grazie alla sua sete di gelatina alla menta.",
  "Grazie al suo ombrello che piove dentro.",
  "Grazie alla sua coppa di cristallo per i cani.",
  "Grazie alla sua abilità nel mangiare le nuvole a cucchiaiate.",
  "Grazie alla sua tesi sulla vita segreta dei calzini.",
  "Grazie al suo viaggio su Marte in pantofole.",
  "Grazie alla sua faccia che sembra un cassetto.",
  "Grazie al suo amico immaginario, un tergicristallo.",
  "Grazie alla sua crema per il viso al gusto di pizza.",
  "Grazie alle sue ciabatte, che hanno la patente.",
  "Grazie al suo spazzolino da denti da cantante lirico.",
  "Grazie alla sua nuova casa sull'albero di un bidone.",
  "Grazie alla sua carriera da mimo in metropolitana.",
  "Grazie alla sua collezione di sassi con la faccia.",
  "Grazie alla sua abitudine di abbracciare i lampioni.",
  "Grazie alla sua pizza con sopra un ombrello.",
  "Grazie alla sua gara di sbadigli contro il gatto.",
  "Grazie al suo cappello a forma di piccione.",
  "Grazie alla sua paura dei cucchiai di legno.",
  "Grazie alla sua lezione di salto con la corda invisibile.",
  "Grazie al suo gelato al sapore di scarpa.",
  "Grazie alla sua fede nei vampiri vegetariani.",
  "Grazie alla sua vacanza in un armadio.",
  "Grazie alla sua maschera da polpo per l'esame.",
  "Grazie alla sua canzone sul divano che piange.",
  "Grazie al suo tatuaggio di una patata sorridente.",
  "Grazie alla sua pasta cotta con il pettine.",
  "Grazie alla sua nuova dieta fatta di sassolini.",
  "Grazie alla sua collezione di fischietti per gatti.",
  "Grazie al suo laboratorio di colla per cuscini.",
  "Grazie alla sua lettera d'amore al semaforo.",
  "Grazie alla sua vittoria contro un pomodoro.",
  "Grazie alla sua invenzione: il cucchiaio con le ruote.",
  "Grazie al suo corso di equitazione sui gabbiani.",
  "Grazie alla sua fama tra i pesci rossi.",
  "Grazie alla sua faccia da stufa accesa.",
  "Grazie al suo castello di sabbia con il Wi-Fi.",
  "Grazie alla sua ansia per i tergicristalli.",
  "Grazie alla sua tenda da campeggio in un bicchiere.",
  "Grazie alla sua fidanzata di gomma piuma.",
  "Grazie alla sua tazza che canta ogni mattina.",
  "Grazie alla sua gita in barca con un pinguino.",
  "Grazie al suo maglione di lana di cactus.",
  "Grazie alla sua fissazione per i pettini.",
  "Grazie alla sua passione per le lumache in smoking.",
  "Grazie alla sua macchina da scrivere che russa.",
  "Grazie alla sua zuppa di mattoni tiepidi.",
  "Grazie alla sua ombra che ha preso la patente.",
  "Grazie alla sua collezione di pesci di carta.",
  "Grazie alle sue gambe, che fanno il bagno nel latte.",
  "Grazie al suo sogno di lavorare come sedia.",
  "Grazie alla sua abilità nel parlare con le zanzare.",
  "Grazie al suo aeroplano di carta da pane.",
  "Grazie alla sua faccia da orologio svizzero.",
  "Grazie alla sua tesi su come sbucciare le nuvole.",
  "Grazie alla sua nonna, che guida un trattore a pois.",
  "Grazie al suo fan club di calzini spaiati.",
  "Grazie alla sua coda di cometa per il bucato.",
];

let winnerLine = "", winnerKey = "";

function renderWinner() {
  const w = game.player(game.winner);
  // Una frase a caso per partita, scelta una volta sola (i render successivi non la cambiano).
  const key = `${game.round}:${game.winner}`;
  const again = winnerKey === key; // già mostrata: niente animazione da capo a ogni aggiornamento
  if (!again) { winnerKey = key; winnerLine = WINNER_LINES[Math.floor(Math.random() * WINNER_LINES.length)]; }
  const crown = el("span", { class: "cr-crown" });
  crown.innerHTML = CROWN_SVG;
  // Come l'apertura: corona e "Ha vinto", una casella per il nome, "grazie" in bianco,
  // poi una casella sotto per la frase. Le caselle si riempiono dall'alto in basso.
  const rest = winnerLine.replace(/^Grazie\s+/i, "");
  app.replaceChildren(el("div", { class: "crown-screen" + (again ? " done" : ""), role: "dialog", "aria-label": `Ha vinto ${w.name}` },
    el("div", { class: "iw" },
      crown,
      el("span", { class: "cr-line" }, "Ha vinto"),
      el("span", { class: "cr-slot" }, el("span", { class: "cr-gap" }), el("span", { class: "cr-name" }, w.name)),
      el("span", { class: "cr-line" }, "grazie"),
      el("span", { class: "cr-pslot" }, el("span", { class: "cr-pgap" }), el("span", { class: "cr-phrase" }, rest))),
    el("button", { class: "primary cr-btn", type: "button", onclick: online ? () => netSend({ type: "back" }) : () => { homeTab = "local"; exitGame(); } },
      online ? "Torna alla stanza" : "Torna al locale")));
  Sound.setTheme("menu");
}

function render() {
  if (online && !online.state?.game) { Sound.setTheme("menu"); return renderLobby(); }
  if (!game) return setup();
  app.classList.remove("still"); paintKey = "game"; // in partita le animazioni restano sempre attive
  Sound.setTheme("game");
  document.body.classList.add("in-game");
  const next = viewerFor();
  if (next !== lastViewer) {
    lastViewer = next;
    viewer = next;
    selected = [];
    judgeSel = null;
    curtain = !online && humanIds().length > 1;
    if (curtain) Sound.play("turn");
  }
  viewer = next;
  const s = game.publicState(viewer);
  // Il Memory del Re non è finito prima che tutti rispondessero: il jolly sfuma via con un'animazione.
  if (mem && mem.round === s.round && !mem.won && !mem.expired && s.phase !== "playing") { mem.expired = true; expiredFlash(); }
  // Le copie della carta in volo non devono sopravvivere fuori dalla pausa di fine round.
  if (s.phase !== "roundEnd") document.querySelectorAll(".shrink-ghost").forEach((n) => n.remove());
  if (s.phase === "playing" && selected.length === 0) wordsShown = 0;
  if (s.phase === "playing") stripShown = -1;   // nuovo giro: le combinazioni ripartono coperte
  if (s.phase === "over") return renderWinner();
  const isJudge = s.judgeId === viewer;
  const me = s.players.find((p) => p.id === viewer);
  const need = s.black ? s.black.blanks : 1;
  const judging = s.phase === "judging" && isJudge;
  if (judging) resetJudgeIfNewRound();
  const showPrivate = !curtain;

  // La carta vincente vola sotto il nome del vincitore all'inizio della pausa, poi il turno successivo parte.
  const roundPause = online ? 4000 : LOCAL_ROUND_PAUSE_MS;
  const shrinkNow = s.phase === "roundEnd" && shrinkRound !== s.round;
  if (shrinkNow) shrinkRound = s.round;

  // Un rettangolino nero per ogni punto preso: quello nuovo (solo nel primo render della pausa) compare con l'animazione.
  const board = el("div", { class: "board", role: "list" },
    s.players.map((p) => {
      const won = s.phase === "roundEnd" && game.lastWinner === p.id;
      const mark = el("div", { class: "marks", "aria-hidden": "true" },
        Array.from({ length: p.score }, (_, i) => el("span", {
          class: "mini-black" + (shrinkNow && won && i === p.score - 1 ? " fresh" : ""),
        })));
      return el("div", {
        class: ["seat", p.id === s.judgeId ? "judge" : "", p.hasPlayed ? "played" : "", won ? "won" : "",
          p.id === viewer && p.id !== s.judgeId ? "turn" : ""].join(" "),
        role: "listitem",
      },
        el("div", { class: "name" }, s.jollyHolder === p.id ? el("span", { class: "jolly-crown", title: "Ha il jolly", innerHTML: CROWN_SVG }) : null, p.name),
        el("div", { class: "pts" }, p.score),
        mark);
    }));

  // Freccia e pallino stanno sulla riga del round: non occupano altro spazio in verticale.
  const roundline = el("div", { class: "roundline" },
    el("button", { type: "button", class: "back-arrow", "aria-label": "Indietro", onclick: () => { homeTab = "home"; exitGame(); } }, "←"),
    el("span", { class: "spacer" }),
    el("button", { type: "button", class: "home-settings", "aria-label": "Impostazioni", onclick: openSettings }));

  let mainCard = null;
  let extraRow = null;    // fila delle combinazioni, sotto la carta nera (per chi non è il Re)
  let note = null;
  let actions = null;
  let rail = null;
  let railLabel = "";

  if (s.phase === "over") {
    const w = game.player(game.winner);
    note = el("div", { class: "banner win" },
      el("h2", {}, `Ha vinto ${w.name}`),
      el("p", { class: "hidden-msg" }, `Punteggio finale: ${w.score} punti.`),
      el("button", { class: "primary", type: "button", onclick: exitGame }, "Nuova partita"));
  } else if (judging && showPrivate) {
    const total = s.reveal.length;
    if (judgeMode === "browse") {
      const r = s.reveal[judgeView];
      mainCard = blackCard(s, r.cards.map((c) => c.text), { label: `Combinazione ${judgeView + 1} di ${total}` });
      note = el("p", { class: "hidden-msg" }, "Leggi tutte le combinazioni. Non sai chi le ha giocate.");
      actions = el("div", { class: "judge-nav" },
        el("button", { type: "button", disabled: judgeView === 0, onclick: () => { setJudgeView(judgeView - 1); render(); } }, "← Precedente"),
        judgeView < total - 1
          ? el("button", { class: "primary", type: "button", onclick: () => { setJudgeView(judgeView + 1); Sound.play("flip"); render(); } }, "Successiva →")
          : el("button", { class: "primary", type: "button", onclick: () => { setJudgeView(total - 1); markCompare(); judgeMode = "compare"; enterPending = true; Sound.play("flip"); render(); } }, vediTutteLabel(total)));
    } else {
      // Solo le carte: un tocco seleziona, poi sulla carta compaiono la X (torna) e la V (conferma).
      note = null;
      const enter = enterPending;
      enterPending = false;
      mainCard = comboRow(s, judgeSel, true);
    }
  } else if (s.phase === "judging" && s.compare) {
    // Gli altri vedono le combinazioni affiancate, come il Re, e la scelta che sta facendo.
    note = el("p", { class: "hidden-msg" }, `${s.players.find((p) => p.id === s.judgeId)?.name ?? "Il Re"} sta scegliendo…`);
    mainCard = comboRow(s, s.selected, false);
  } else if (s.phase === "judging") {
    note = el("p", { class: "hidden-msg" }, `${game.judge.name} sta leggendo le risposte…`);
    if (!isJudge) { mainCard = comboRow(s, null, false, s.peek ?? -1); }
  } else if (s.phase === "roundEnd") {
    const last = game.lastWinner ? game.player(game.lastWinner) : null;
    if (wonRound !== s.round && last) {
      wonRound = s.round;
      Sound.play("win");
    }
    note = null;
    // In locale il round successivo parte da solo; online lo fa il server.
    if (!online && !roundTimer) roundTimer = setTimeout(nextRound, LOCAL_ROUND_PAUSE_MS);
  } else if (isJudge) {
    // Il Memory esiste solo online: in locale il telefono passa di mano, quindi non avrebbe senso.
    note = (online && (s.jollyHolder === null || (mem && mem.won && mem.round === s.round))) ? memoryBoard(s) : el("p", { class: "hidden-msg" }, "Sei il Re: aspetta che gli altri confermino.");
  } else if (s.phase === "playing" && !me.hasPlayed) {
    note = null;   // niente istruzioni in primo piano: la carta nera stessa dice quando è pronta
  } else if (me.hasPlayed) {
    note = el("p", { class: "hidden-msg" }, "Risposta confermata. Aspetta gli altri giocatori.");
  }

  // Carta nera in cima. Nella vista "tutte e tre" del Re compare solo quando ha scelto una risposta,
  // già compilata con quella scelta; le altre restano in elenco.
  // Chi non è il Re vede la stessa schermata del Re (combinazioni affiancate), senza poter scegliere.
  const comparing = (judging && judgeMode === "compare" && showPrivate) || (s.phase === "judging" && !isJudge);
  if (!comparing) {
    const canPlay = s.phase === "playing" && !isJudge && !me.hasPlayed && showPrivate;
    const slam = slamPending;
    slamPending = false;
    if (!selected.includes(JOLLY)) jollyDraft = "";
    mainCard = blackCard(s, previewWhites(s), { canPlay, slam, jollyAt: canPlay ? selected.indexOf(JOLLY) : -1 });
    // Risposte complete: sulla carta nera compaiono X (annulla la scelta) e V (conferma), come per il Re.
    if (canPlay && need > 0 && selected.length === need) {
      const blk = mainCard.querySelector(".black");
      if (blk) {
        blk.classList.add("ready");
        const ctrl = el("div", { class: "combo-ctrl" },
          el("button", { type: "button", class: "cc-x", "aria-label": "Annulla la scelta", onclick: (e) => { e.stopPropagation(); selected = []; wordsShown = 0; Sound.play("pick"); render(); } }, "✕"),
          el("button", { type: "button", class: "cc-v", "aria-label": "Conferma la risposta", disabled: selected.includes(JOLLY) && !jollyDraft.trim(), onclick: (e) => { e.stopPropagation(); humanPlay(); } }, "✓"));
        blk.append(ctrl);
      }
    }
  }

  // Mano: fila di default quando non stai giudicando e lo schermo è tuo.
  if (s.phase !== "over" && !judging && me.hand && showPrivate) {
    const canSelect = s.phase === "playing" && !isJudge && !me.hasPlayed;
    railLabel = "";
    const deal = dealPending;
    dealPending = false;
    rail = el("div", { class: "rail", role: "group", "aria-label": "La tua mano" },
      handForRail(me.hand).map((c, i) => {
        const idx = selected.indexOf(c.id);
        // Con una sola risposta da dare, toccarne un'altra sostituisce la scelta; con più risposte si deseleziona prima.
        const full = need > 1 && selected.length >= need && idx < 0;
        const held = { v: false };
        const node = el("button", {
          class: "card" + (idx >= 0 ? " sel" : "") + (deal ? " deal" : ""),
          type: "button",
          disabled: !canSelect || full,
          "aria-pressed": String(idx >= 0),
          onclick: () => {
            if (held.v) return;
            // Scelte in ordine: deselezionando la prima, la seconda diventa la prima.
            if (idx >= 0) selected.splice(idx, 1);
            else if (need === 1) { selected = [c.id]; wordsShown = 0; }   // la parola nuova deve comparire con l'animazione
            else selected.push(c.id);
            Sound.play("pick");
            render();
          },
        }, el("span", { class: "num" }, idx >= 0 ? String(idx + 1) : ""),
          c.jolly ? el("img", { class: "jolly-img", src: JOLLY_IMG, alt: "Carta jolly", draggable: "false" }) : el("span", { class: "txt" }, c.text));
        node.style.setProperty("--i", i);
        node.style.setProperty("--cat", catColor(c.cat));
        if (c.jolly) node.classList.add("jolly");
        else node.append(el("span", { class: "kind" }, KIND[c.cat] ?? c.cat));
        if (c.jolly) return node;
        attachHold(node, () => { held.v = true; Sound.play("paper"); showZoom(c.text); }, held, hideZoom);
        return node;
      }));
  }

  const railBlock = rail ? el("div", { class: "col", style: "gap:6px" },
    railLabel ? el("span", { class: "label" }, railLabel) : null,
    rail) : null;

  // Passaggio di turno: "Passa a" · una barra che si riempie · il nome · "il telefono".
  // Sotto, la frase sulle carte nascoste. Toccando lo schermo si mostrano le carte.
  // Stessa struttura dell'apertura: "Passa a" · la casella che diventa il nome · "il telefono".
  const reveal = () => { curtain = false; Sound.play("deal"); render(); };
  const who = curtain ? el("div", { class: "curtain", role: "dialog", "aria-label": "È il turno di", onclick: reveal },
    el("div", { class: "iw" },
      el("span", {}, "È il turno di"),
      el("span", { class: "cur-slot" }, el("span", { class: "cur-gap" }), el("span", { class: "cur-name" }, me.name)),
      el("span", { class: "cur-sub" }, "Le tue carte sono nascoste finché non tocchi."))) : null;

  // Al primo render di pausa la carta resta visibile: sarà shrinkWinner a farla rimpicciolire.
  // Nei render successivi (stesso round) è già finita, quindi resta nascosta.
  if (s.phase === "roundEnd" && !shrinkNow && shrinkRound === s.round && mainCard) mainCard.style.visibility = "hidden";
  // Se il Re ha già scelto, il punto parte dalla combinazione che gli altri vedevano.
  const oldSrc = s.phase === "roundEnd" && s.pickedIndex != null ? app.querySelector(`.combo[data-idx="${s.pickedIndex}"] .black`) : null;
  if (oldSrc && !pendingFrom) pendingFrom = { rect: oldSrc.getBoundingClientRect(), node: oldSrc };
  // Il volo parte dalla combinazione che si vedeva: la carta grande della vincente non compare a parte.
  if (s.phase === "roundEnd" && pendingFrom && mainCard) mainCard.style.visibility = "hidden";
  requestAnimationFrame(() => fitText(app));
  const oldRow = app.querySelector(".combo-row");
  comboScroll = oldRow ? oldRow.scrollLeft : null;
  app.replaceChildren(
    el("div", { class: "game" },
      el("header", { class: "hud" }, board, roundline),
      el("main", { class: "stage" }, mainCard, extraRow, note),
      el("footer", { class: "dock" }, actions, railBlock),
      who));
  // La fila ricostruita riprende la posizione in cui la stava guardando chi scorre.
  const row = app.querySelector(".combo-row");
  if (row && comboScroll !== null) row.scrollLeft = comboScroll;
  comboScroll = null;
  // Si scorre alla combinazione scelta solo quando cambia, non a ogni aggiornamento.
  const selNode = app.querySelector(".combo.sel");
  const selKey = selNode ? selNode.dataset.idx : null;
  if (selKey !== scrolledSel) { scrolledSel = selKey; selNode?.scrollIntoView({ inline: "center", block: "nearest" }); }
  if (shrinkNow) {
    const from = pendingFrom;
    pendingFrom = null;
    setTimeout(() => shrinkWinner(roundPause, from), 0);
  }
  // Offline: toccando lo schermo durante la pausa si passa subito al turno dopo.
  if (!online && s.phase === "roundEnd") {
    app.querySelector(".game")?.addEventListener("click", () => { if (game && game.phase === "roundEnd") nextRound(); }, { once: true });
  }
}

// Animazione della carta vincente: una copia fissa sopra tutto scende fino al segnaposto sotto il vincitore.
// La copia sta fuori dalla scena (che taglia ciò che esce), così passa sopra le informazioni e non sparisce.
function shrinkWinner(total, from = null) {
  const card = app.querySelector(".stage .black");
  const mini = app.querySelector(".seat.won .mini-black.fresh");
  const src = from ? from.node : card;
  if (!src || !mini) return;
  const wait = 150, run = 900; // il volo dura poco; il segnaposto resta dopo
  const a = from ? from.rect : card.getBoundingClientRect(), t = mini.getBoundingClientRect();
  const k = Math.min(t.width / a.width, 0.2);
  const dx = t.left + t.width / 2 - (a.left + a.width / 2);
  const dy = t.top + t.height / 2 - (a.top + a.height / 2);
  const ghost = src.cloneNode(true);
  ghost.classList.add("shrink-ghost");
  ghost.removeAttribute("style");
  Object.assign(ghost.style, {
    position: "fixed", left: a.left + "px", top: a.top + "px",
    width: a.width + "px", height: a.height + "px", margin: "0",
    zIndex: "200", pointerEvents: "none", transform: "none",
  });
  app.append(ghost);   // dentro la schermata: la prossima aggiornamento della partita la toglie, senza copie vaganti
  if (card) card.style.visibility = "hidden";
  ghost.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${k})` }],
    { duration: run, delay: wait, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" });
  mini.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: wait + run, fill: "forwards" });
  shrinkGhost = ghost;
  setTimeout(() => { ghost.remove(); if (shrinkGhost === ghost) shrinkGhost = null; }, wait + run);
}

// Ogni pulsante suona e vibra un poco (i pulsanti disattivati no).
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("button");
  if (b && !b.disabled && !b.classList.contains("chip")) Sound.play("tap");
  else if (b && b.classList.contains("chip")) Sound.play("pick");
}, true);

// Primo gesto dell'utente: sblocca l'audio e applica le impostazioni sonore.
document.addEventListener("pointerdown", () => {
  if (unlocked) return;
  unlocked = true;
  Sound.unlock();
  applySettings();
}, { once: false });

// ------------------------------------------------------------------ online
// Il server tiene stanze, mani e turni. Qui c'è solo la connessione e una "partita"
// che legge lo stato ricevuto, con gli stessi metodi del motore locale.

const SESSION_KEY = "cah-online";
// Online con Firebase Realtime Database. Il telefono di chi crea la stanza la fa girare (tools/room.js);
// gli altri scrivono nella casella "inbox" della stanza e leggono le risposte in "out/<loro id>".
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBPB0vXofcHsCCB6SpBY2RzxxnvBBdQZRE",
  authDomain: "cah-italiano.firebaseapp.com",
  databaseURL: "https://cah-italiano-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cah-italiano",
  storageBucket: "cah-italiano.firebasestorage.app",
  messagingSenderId: "68861634686",
  appId: "1:68861634686:web:fbc0c14a031dfef91cd02f",
};
const NET_TIMEOUT_MS = 15000;
let fbDb = null;           // database Firebase, null se l'SDK non si è caricato
let netConnected = false;
let myNetId = null;        // identità di questo telefono nella rete
let hostRoom = null;       // stanza ospitata da questo telefono
let hostCode = null;
let hostSelf = null;       // connessione del padrone di casa verso la propria stanza
const hostConns = new Map();
let joinedCode = null;     // stanza a cui sono collegato come giocatore
let onlineWin = 5;
let homeTab = "home";   // "local" | "online" nella schermata iniziale
let onlineName = "";
let onlineError = "";

const loadSession = () => {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
};
const saveSession = (v) => {
  try {
    if (v) sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* nessuno storage: si perde solo la riconnessione */ }
};

// Il telefono avvisa così di un problema nativo (per esempio nell'aggiornamento), senza chiudere l'app.
window.onNativeError = (msg) => toast(msg);

function toast(msg) {
  const t = el("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3000);
}

function netId() {
  if (myNetId) return myNetId;
  try { myNetId = sessionStorage.getItem("cah-net-id"); } catch { /* nessuno storage */ }
  if (!myNetId) {
    myNetId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { sessionStorage.setItem("cah-net-id", myNetId); } catch { /* nessuno storage */ }
  }
  return myNetId;
}

function initNet() {
  if (fbDb || !window.firebase) return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    fbDb = firebase.database();
    fbDb.ref(".info/connected").on("value", (s) => {
      netConnected = !!s.val();
      if (online) { online.offline = !netConnected; render(); }
    });
  } catch { fbDb = null; }
}

// Il telefono dell'ospite: una connessione per ogni telefono degli altri giocatori.
function hostConn(id) {
  let c = hostConns.get(id);
  if (!c) {
    c = hostRoom.connection(id, (raw) => { fbDb.ref(`rooms/${hostCode}/out/${id}`).push(raw); });
    hostConns.set(id, c);
  }
  return c;
}

function startHosting(code) {
  hostCode = code;
  hostRoom = createRoomHost({ cards: CARDS, turnSeconds: 60, onRoomGone: () => {} });
  hostSelf = hostRoom.connection(netId(), (raw) => { try { onMessage(JSON.parse(raw)); } catch { /* ignorato */ } });
  const base = fbDb.ref(`rooms/${code}`);
  base.child("inbox").on("child_added", (snap) => {
    const d = snap.val();
    snap.ref.remove();
    if (d && d.from && d.msg && hostRoom) hostRoom.handle(hostConn(d.from), d.msg);
  });
  base.child("presence").on("child_removed", (snap) => {
    const c = hostConns.get(snap.key);
    if (c && hostRoom) hostRoom.leave(c);
  });
}

async function createRoom(name) {
  initNet();
  if (!fbDb) throw new Error("Online non disponibile su questo telefono.");
  let code = "";
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (let tries = 0; tries < 8; tries++) {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const snap = await fbDb.ref(`rooms/${code}`).once("value");
    if (!snap.exists()) break;
  }
  const ref = fbDb.ref(`rooms/${code}`);
  ref.onDisconnect().remove(); // se l'ospite chiude l'app, la stanza sparisce
  await ref.set({ host: netId(), created: Date.now() });
  startHosting(code);
  hostRoom.handle(hostSelf, { type: "create", name, code });
  joinedCode = null;
  if (online) online.code = code;
}

// Collega questo telefono alla stanza: ascolta le risposte e segnala la presenza.
function connectTo(code) {
  initNet();
  if (!fbDb) throw new Error("Online non disponibile su questo telefono.");
  joinedCode = code;
  const base = fbDb.ref(`rooms/${code}`);
  const me = base.child(`presence/${netId()}`);
  me.onDisconnect().remove();
  me.set(true);
  base.child(`out/${netId()}`).on("child_added", (snap) => {
    const raw = snap.val();
    snap.ref.remove();
    try { onMessage(JSON.parse(raw)); } catch { /* messaggio non valido: ignorato */ }
  });
}

async function joinRoom(code, name) {
  initNet();
  if (!fbDb) throw new Error("Online non disponibile su questo telefono.");
  const snap = await fbDb.ref(`rooms/${code}`).once("value");
  if (!snap.exists()) throw new Error("Stanza non trovata");
  connectTo(code);
  online = { code, you: null, state: null, offline: false, winScore: onlineWin };
  netSend({ type: "join", code, name });
  setTimeout(() => {
    if (online && !online.you && joinedCode === code) {
      onlineError = "La stanza non risponde: l'ospite potrebbe avere chiuso l'app.";
      leaveNet();
      online = null;
      onlineMenu();
    }
  }, NET_TIMEOUT_MS);
}

function netSend(obj) {
  if (hostRoom && hostSelf) { hostRoom.handle(hostSelf, obj); return; }
  if (joinedCode && fbDb) fbDb.ref(`rooms/${joinedCode}/inbox`).push({ from: netId(), msg: obj });
}

// Esce dalla stanza: chi ospita la chiude per tutti; gli altri lasciano il proprio posto.
function leaveNet() {
  if (hostCode && fbDb) {
    const ref = fbDb.ref(`rooms/${hostCode}`);
    ref.onDisconnect().cancel();
    ref.off();
    ref.remove();
  }
  if (joinedCode && fbDb) {
    const base = fbDb.ref(`rooms/${joinedCode}`);
    base.child(`out/${netId()}`).off();
    base.child(`presence/${netId()}`).remove();
  }
  hostRoom = null; hostSelf = null; hostCode = null; hostConns.clear();
  joinedCode = null;
}

function resumeSaved() {
  const s = loadSession();
  if (!s) return;
  connectTo(s.code);
  netSend({ type: "resume", code: s.code, token: s.token });
}

function onMessage(m) {
  if (m.type === "error") {
    Sound.play("error");
    if (m.message === "Sessione non valida") {
      saveSession(null);
      online = null;
      game = null;
      onlineError = "";
      setup();
      return;
    }
    if (online) toast(m.message);
    else { onlineError = m.message; onlineMenu(); }
    return;
  }
  if (m.type === "joined") {
    online = { ...(online || {}), code: m.code, you: m.playerId, state: online?.state ?? null, offline: false, winScore: onlineWin };
    saveSession({ code: m.code, token: m.token });
    onlineError = "";
    return;
  }
  if (m.type === "state") {
    const prev = online?.state?.game ?? null;
    online = { ...(online || {}), code: m.code, you: m.you, state: m, offline: false, winScore: onlineWin };
    if (m.game) {
      if (!prev || prev.round !== m.game.round) {
        dealPending = true;
        slamPending = true;
        selected = [];
        judgeSel = null;
      }
      game = makeAdapter(m);
    } else {
      game = null;
    }
    render();
  }
}

// Stesso contratto del motore locale, ma i dati arrivano dal server e le azioni vanno via rete.
function makeAdapter(m) {
  const s = m.game;
  const handOf = () => s.players.find((p) => p.id === m.you)?.hand ?? [];
  return {
    phase: s.phase,
    round: s.round,
    judge: s.players.find((p) => p.id === s.judgeId) ?? { id: s.judgeId, name: "?" },
    players: s.players.map((p) => ({ ...p, isBot: false })),
    currentBlack: s.black,
    winner: s.winner,
    lastWinner: s.lastWinner,
    opts: { winScore: s.winScore },
    publicState: () => s,
    player: (id) => s.players.find((p) => p.id === id),
    text: (id) => [...handOf(), ...(s.reveal || []).flatMap((r) => r.cards)].find((c) => c.id === id)?.text ?? "",
    play: (_id, ids, jolly) => netSend({ type: "play", cards: ids, jolly }),
    pick: (_id, index) => netSend({ type: "pick", index }),
    nextRound: () => netSend({ type: "next" }),
    reshuffleHand: () => netSend({ type: "reshuffle" }),
  };
}

function exitGame() {
  if (online) {
    netSend({ type: "leave" });
    leaveNet();
    saveSession(null);
    online = null;
  }
  clearTimeout(botTimer); clearTimeout(judgeTimer); clearTimeout(roundTimer); roundTimer = null;
  game = null;
  setup();
}

function onlinePanel() {
  const nameIn = el("input", { type: "text", maxlength: "20", placeholder: "Il tuo nome", "aria-label": "Il tuo nome", value: onlineName,
    oninput: (e) => { onlineName = e.target.value; } });
  const codeIn = el("input", { type: "text", maxlength: "4", placeholder: "Codice", "aria-label": "Codice stanza",
    style: "text-transform:uppercase", oninput: (e) => { e.target.value = e.target.value.toUpperCase(); } });
  return el("div", { class: "panel" },
    el("span", { class: "label" }, "Il tuo nome"),
    nameIn,
    el("button", { type: "button", class: "primary", onclick: () => {
      onlineError = ""; onlineName = nameIn.value.trim();
      toast("Mi collego al server…");
      createRoom(onlineName).catch((err) => { onlineError = err.message; onlineMenu(); });
    } }, "Crea una stanza"),
    el("span", { class: "label" }, "Entra con un codice"),
    el("div", { class: "nrow" }, codeIn,
      el("button", { type: "button", onclick: () => {
        onlineError = ""; onlineName = nameIn.value.trim();
        toast("Mi collego al server…");
        joinRoom(codeIn.value.trim().toUpperCase(), onlineName).catch((err) => { onlineError = err.message; onlineMenu(); });
      } }, "Entra")),
    onlineError ? el("p", { class: "hidden-msg err" }, onlineError) : null);
}

function onlineMenu() {
  homeTab = "online";
  setup();
}

// Tenere premuta una carta della mano: la mostra ingrandita, con il testo intero.
// Pressione prolungata: dopo 380 ms apre "fn". Si annulla se il dito si muove (scorrimento) prima.
// Alla fine della pressione, ovunque si rilasci, chiama "release" (per chiudere l'ingrandimento).
function attachHold(node, fn, flag = null, release = null) {
  let t = null, sx = 0, sy = 0, open = false;
  const end = () => {
    clearTimeout(t);
    document.removeEventListener("pointerup", end, true);
    document.removeEventListener("pointercancel", end, true);
    if (open) { open = false; release?.(); }
  };
  node.addEventListener("pointerdown", (e) => {
    if (flag) flag.v = false;
    sx = e.clientX; sy = e.clientY;
    clearTimeout(t);
    document.addEventListener("pointerup", end, true);
    document.addEventListener("pointercancel", end, true);
    t = setTimeout(() => { open = true; fn(); }, 380);
  });
  node.addEventListener("pointermove", (e) => {
    if (!open && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clearTimeout(t);
  });
  node.addEventListener("pointerleave", () => { if (!open) clearTimeout(t); });
  node.addEventListener("contextmenu", (e) => e.preventDefault());
}

// Un solo ingrandimento alla volta: la carta resta grande finché tieni premuto.
let zoomNode = null;
function hideZoom() {
  zoomNode?.remove();
  zoomNode = null;
}
function showZoom(text) {
  hideZoom();
  const card = el("div", { class: "zoom", role: "dialog", "aria-label": "Carta ingrandita" }, el("div", { class: "txt" }, text));
  zoomNode = el("div", { class: "zoom-bg", "aria-hidden": "true" }, card);
  document.body.append(zoomNode);
}

// Scatto a ogni carta che scorre nelle file orizzontali (mano, tavolo, elenchi).
const railStep = new WeakMap();
document.addEventListener("scroll", (e) => {
  const r = e.target;
  if (!(r instanceof Element) || !(r.classList.contains("rail") || r.classList.contains("board"))) return;
  const kids = r.children;
  if (kids.length < 2) return;
  const unit = kids[1].getBoundingClientRect().left - kids[0].getBoundingClientRect().left;
  if (unit <= 0) return;
  const idx = Math.round(r.scrollLeft / unit);
  const prev = railStep.get(r);
  if (prev !== undefined && prev !== idx) Sound.play("tick");
  railStep.set(r, idx);
}, true);

// Intestazione della stanza: "← Home" come nelle altre schermate (esce dalla stanza).
function lobbyHead() {
  return el("div", { class: "subhead" },
    el("button", { type: "button", class: "ghost back", onclick: () => { homeTab = "home"; exitGame(); } }, "← Home"),
    el("h2", { class: "display" }, "Stanza"));
}

function renderLobby() {
  still("lobby");
  const st = online.state;
  if (!st) {
    app.replaceChildren(el("section", { class: "setup" }, lobbyHead(),
      el("p", { class: "hidden-msg" }, online.offline ? "Riconnessione in corso…" : "Mi collego alla stanza…")));
    return;
  }
  const isHost = st.hostId === online.you;
  const me = st.players.find((p) => p.id === online.you);
  const total = st.players.length;
  const ok = total >= 3;
  const seg = [3, 5, 8].map((n) => el("button", {
    type: "button", "aria-pressed": String(onlineWin === n),
    onclick: () => { onlineWin = n; render(); },
  }, `${n} punti`));
  app.replaceChildren(
    el("section", { class: "setup" },
      lobbyHead(),
      el("div", { class: "panel" },
        el("span", { class: "label" }, "Codice della stanza"),
        el("div", { class: "code" }, st.code),
        el("button", { type: "button", class: "ghost", onclick: () => {
          navigator.clipboard?.writeText(st.code).catch(() => {});
          toast("Codice copiato");
        } }, "Copia codice"),
        el("span", { class: "label", style: "margin-top:6px" }, `Giocatori (${total}/10)`),
        el("ul", { class: "plist" }, st.players.map((p) => el("li", {},
          el("span", { class: "dot" + (p.connected ? " on" : "") }),
          `${p.name}${p.id === st.hostId ? " · host" : ""}${p.id === online.you ? " (tu)" : ""}${p.ready ? " · pronto" : ""}`))),
        isHost ? el("span", { class: "label", style: "margin-top:6px" }, "Vittoria") : null,
        isHost ? el("div", { class: "seg" }, seg) : null,
        // Dopo una partita la stanza resta aperta: ognuno si dichiara pronto, e quando lo sono tutti si ricomincia.
        me ? el("button", { type: "button", class: me.ready ? "ghost" : "primary", onclick: () => netSend({ type: "ready" }) },
          me.ready ? "Pronto: aspetto gli altri" : "Sono pronto") : null,
        isHost
          ? el("button", { type: "button", class: "primary", disabled: !ok, onclick: () => netSend({ type: "start", winScore: onlineWin, custom: customPayload() }) }, "Avvia partita")
          : el("p", { class: "hidden-msg" }, ok ? "In attesa che l'host avvii la partita." : "Servono almeno 3 giocatori per iniziare."),
        isHost && !ok ? el("p", { class: "hidden-msg" }, "Servono almeno 3 giocatori: aggiungi dei bot se siete meno.") : null,
        // Con pochi amici: l'ospite aggiunge dei bot (con il nome che sceglie), che giocano sul suo telefono.
        isHost ? el("div", { class: "pack-row" },
          el("button", { type: "button", disabled: total >= 10, onclick: () => askBotName(st.players.filter((p) => p.isBot).length, (name) => netSend({ type: "addBot", name })) }, "Aggiungi bot"),
          el("button", { type: "button", disabled: !st.players.some((p) => p.isBot), onclick: () => netSend({ type: "removeBot" }) }, "Togli bot")) : null,
        el("button", { type: "button", class: "ghost", onclick: exitGame }, "Esci dalla stanza"))));
}

// Apertura: il logo entra e lascia spazio alla home.
function splash() {
  if (!settings.motion) return;
  const s = el("div", { class: "splash", "aria-hidden": "true" }, logoNode(true));
  document.body.append(s);
  setTimeout(() => s.classList.add("out"), 1250);
  setTimeout(() => s.remove(), 1800);
}

function boot() {
  splash();
  const s = loadSession();
  initNet();
  if (s && fbDb) {
    online = { code: s.code, you: null, state: null, offline: true, winScore: onlineWin };
    render();
    resumeSaved();
    return;
  }
  setup();
}

document.head.append(el("style", {}, `
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:10px 16px;border-radius:999px;font-weight:600;z-index:50}
.code{font-family:var(--card-font,inherit);font-size:44px;letter-spacing:.2em;font-weight:800;text-align:center;padding:8px 0}
.plist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.plist li{display:flex;align-items:center;gap:8px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--muted);display:inline-block}
.dot.on{background:var(--ok)}
.err{color:var(--accent)}
`));

document.head.append(el("style", {}, `
#app:has(.home), #app:has(.subscreen) { max-width: 560px; }
#app:has(.home) { height: calc(100dvh - 44px); }
body:has(.home) { overflow: hidden; }
.home { height: 100%; display: flex; flex-direction: column; gap: 8px; }
.home-top { display: flex; align-items: center; justify-content: flex-end; }
.home-top .label { letter-spacing: .22em; }
.icon { padding: 6px 12px; font-size: 18px; border-radius: 999px; }
.poster { flex: 0 0 33vh; min-height: 0; display: flex; align-items: center; justify-content: center; }
.poster .logo.big { max-width: 100%; gap: 12px; }
.poster .logo.big svg { width: auto; height: 24vh; max-width: 30vw; aspect-ratio: 3 / 4; flex: 0 0 auto; }
.poster .logo.big .wordmark { font-size: clamp(22px, 7vw, 36px); hyphens: none; white-space: nowrap; }
.poster .logo.big .wordmark i { font-size: 12px; }
.menu { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--line); margin-top: 18px; }
.menu-row { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: grid; grid-template-columns: 44px 1fr auto; align-items: center; gap: 8px;
  padding: 16px 2px; border-top: 1px solid var(--line); font-family: "IBM Plex Sans", sans-serif; transition: padding .2s; }
.menu-row { flex: 1 1 0; align-items: center; border-top: 1px solid var(--line); }
.menu-row:active { padding-left: 12px; }
.menu-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.menu-row .n { font-family: "IBM Plex Sans", sans-serif; font-size: 12px; font-weight: 600; letter-spacing: .12em; color: var(--muted); }
.menu-row .t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.menu-row .t strong { font-family: "Bricolage Grotesque", sans-serif; font-size: 27px; font-weight: 800; line-height: 1.05; letter-spacing: -.01em; }
.menu-row .sub { font-size: 13px; color: var(--muted); }
.menu-row .arr { font-size: 26px; color: var(--accent); font-weight: 700; }
.subscreen { display: flex; flex-direction: column; gap: 16px; }
.subhead { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.subhead .back { padding: 6px 0; border: 0; background: none; color: var(--muted); font-weight: 600; }
.subhead h2 { font-size: 34px; }
.subscreen input[type="url"] { font: inherit; color: inherit; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; width: 100%; }
button { hyphens: none; -webkit-hyphens: none; }
.subscreen .nrow button { white-space: nowrap; }
.subscreen .panel { background: none; border: 0; padding: 0; box-shadow: none; display: flex; flex-direction: column; gap: 12px; width: 100%; text-align: left; }
.subscreen .names { display: flex; flex-direction: column; gap: 8px; }
.subscreen .nrow { display: flex; gap: 8px; }
.subscreen .seg { display: flex; gap: 8px; flex-wrap: wrap; }
`));
document.head.append(el("style", {}, `
#app:has(.cards-screen) { max-width: 600px; }
.head-row { display: flex; align-items: flex-end; justify-content: space-between; width: 100%; gap: 12px; }
.add { all: unset; cursor: pointer; font-weight: 700; color: var(--accent); font-size: 15px; padding: 6px 0; }
.cstats { display: flex; gap: 22px; padding: 14px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.stat { display: flex; flex-direction: column; gap: 2px; background: none; border: 0; padding: 0; }
.stat strong { font-family: "Bricolage Grotesque", sans-serif; font-size: 34px; font-weight: 800; line-height: 1; }
.stat .label { letter-spacing: .14em; }
.tabs { display: flex; gap: 18px; }
.tabs button { all: unset; cursor: pointer; font-size: 15px; font-weight: 600; color: var(--muted); padding: 4px 0; border-bottom: 2px solid transparent; }
.tabs button[aria-pressed="true"] { background: none; color: var(--fg); border-bottom-color: var(--accent); }
.chips { gap: 14px; }
.chip { all: unset; box-sizing: border-box; cursor: pointer; flex: 0 0 auto; font-size: 13px; color: var(--muted); padding: 4px 0; }
.chip[aria-pressed="true"] { background: none; border: 0; box-shadow: none; color: var(--fg); font-weight: 700; text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 6px; text-decoration-thickness: 2px; }
.cards-screen .hidden-msg { font-size: 13px; }
/* Bordo per categoria, parole mai spezzate */
.card, .pcard, .zoom { border-width: 3px; border-style: solid; border-color: var(--cat, #d6d0c2); }
.card, .pcard, .zoom, .black, .black .text, .zoom .txt, .rail .card .txt { hyphens: none; -webkit-hyphens: none; }
html, body, p, button, input, textarea, h1, h2 { hyphens: none !important; -webkit-hyphens: none !important; }
.card .txt, .pcard .txt, .zoom .txt { overflow-wrap: break-word; word-break: normal; } /* a capo solo se una parola non entra proprio */
.legend { display: flex; gap: 12px; flex-wrap: wrap; }
.lg { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--fg); }
.lg::before { content: ""; width: 10px; height: 10px; border-radius: 3px; background: var(--cat); }
.cat-list { display: flex; flex-direction: column; }
.cat-row { display: flex; flex-wrap: wrap; gap: 14px 18px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line); }
.cat-row .bar { width: 6px; height: 36px; border-radius: 3px; background: var(--cat); }
.cat-name { display: flex; flex-direction: column; min-width: 0; }
.cat-name strong { font-family: "Bricolage Grotesque", sans-serif; font-size: 20px; font-weight: 800; }
.switch { font-size: 13px; padding: 6px 12px; border-radius: 999px; }
.switch[aria-pressed="false"] { color: var(--muted); background: transparent; }
.newcat { display: flex; gap: 10px; align-items: center; }
.newcat input { flex: 1; min-width: 0; }
.pack-row { display: flex; gap: 10px; }
.pack-row button { flex: 1; }
.cards-screen textarea { font: inherit; color: inherit; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; resize: vertical; width: 100%; }
.chip[style] { border-left: 4px solid var(--cat); padding-left: 10px; }
.chip[aria-pressed="true"] { border-left-width: 4px; }
`));
document.head.append(el("style", {}, `
.cards-btn { align-self: center; border-radius: 999px; padding: 9px 16px; font-size: 14px; }
.cards-screen { display: flex; flex-direction: column; gap: 14px; }
.cards-screen h2 { font-size: 30px; }
.cstats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.balance { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--paper); border: 1px solid var(--line); border-radius: 16px; }
.bal-row { display: grid; grid-template-columns: 96px 1fr 36px; gap: 10px; align-items: center; font-size: 13px; }
.bal-name { font-weight: 600; color: var(--fg); }
.bal-bar { height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; }
.bal-fill { display: block; height: 100%; background: var(--cat); border-radius: 999px; }
.bal-n { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
.bal-n.low { color: var(--accent); font-weight: 700; }
.stat { background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; }
.stat strong { font-family: "Bricolage Grotesque", sans-serif; font-size: 28px; font-weight: 800; line-height: 1; }
.chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.chip { flex: 0 0 auto; padding: 7px 13px; font-size: 13px; border-radius: 999px; }
.cgrid { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 10px; touch-action: pan-y; background: var(--bg); } /* niente puntini del fondo tra le carte */
.pcard { position: relative; aspect-ratio: 5 / 7; border-radius: calc(11px * var(--k, 1)); padding: calc(9px * var(--k, 1)) calc(9px * var(--k, 1)) calc(10px * var(--k, 1)); text-align: left; display: flex; flex-direction: column; justify-content: flex-end;
  font-family: var(--card-font); font-weight: 600; font-size: calc(12px * var(--k, 1)); line-height: 1.28; hyphens: auto; -webkit-hyphens: auto; overflow: hidden; border: 1px solid #d6d0c2; box-shadow: 0 8px 16px -12px rgba(0,0,0,.5); }
.pcard.w { background: #fff; color: #111; }
.pcard.b { background: #111; color: #fff; border-color: #111; }
.pcard .txt { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
.cgrid .pcard { border-width: calc(3px * var(--k, 1)); }
.pcard .txt { font-size: calc(12px * var(--k, 1) * var(--fit, 1)); }
.pcard .tag { position: absolute; top: calc(7px * var(--k, 1)); left: calc(8px * var(--k, 1)); font-size: calc(9.5px * var(--k, 1)); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
.pcard:active { transform: scale(.97); }
.card-form { display: flex; flex-direction: column; gap: 12px; }
.card-form textarea { font: inherit; color: inherit; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; resize: vertical; width: 100%; }
.card-form input { width: 100%; }
.detail { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.zoom.b { background: #111; color: #fff; }
.danger { color: var(--accent); }
`));

applySettings();
boot();

document.head.append(el("style", {}, `
/* Transizioni e feedback: brevi, con il rispetto dell'impostazione "Movimento". */
.enter { animation: screenIn .36s cubic-bezier(.2,.7,.2,1) both; }
@keyframes screenIn { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
.no-motion .enter, .no-motion .splash .logo { animation: none; }
button { transition: transform .12s ease, background-color .18s ease, opacity .18s ease, color .18s ease; }
button:active:not(:disabled) { transform: scale(.96); }
.splash { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: #000; transition: opacity .55s ease, visibility .55s; }
.splash.out { opacity: 0; visibility: hidden; }
.splash .logo { animation: logoIn 1.05s cubic-bezier(.2,.8,.2,1) both; }
@keyframes logoIn { from { opacity: 0; transform: scale(.6) translateY(18px); } to { opacity: 1; transform: none; } }
/* Mano: fila scorrevole di carte piccole, con spazio sopra (numero di scelta) e sotto. */
@media (orientation: portrait) {
  .dock .rail { padding: 22px 6px 30px; align-items: flex-end; }
.rv-wrap { display: flex; flex-direction: column; gap: 6px; }
.rv-strip { display: flex; gap: 10px; overflow-x: auto; padding: 4px 2px 10px; scrollbar-width: none; }
.rv-card { flex: 0 0 150px; min-height: 92px; border-radius: 14px; background: var(--paper); color: var(--fg); border: 1px solid var(--line); padding: 10px; font-size: 14px; line-height: 1.2; display: flex; flex-direction: column; justify-content: space-between; gap: 6px; transition: opacity .25s; }
.rv-card.hidden { opacity: .35; }
.rv-card.picked { outline: 3px solid var(--accent); animation: rv-pop .5s ease-out; }
.rv-card.rv-new { animation: rv-in .45s ease-out both; }
.combo-row { width: 100%; min-width: 0; align-self: stretch; box-sizing: border-box; display: flex; align-items: center; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; padding: 14px 10px 18px; scrollbar-width: none; }
.combo-row > .combo { flex: 0 0 86%; scroll-snap-align: center; opacity: .72; transition: opacity .2s, transform .2s; cursor: pointer; }
.combo-row > .combo.sel { opacity: 1; transform: scale(1.03); }
/* Le combinazioni hanno la stessa grandezza della carta nera, anche se la riga è in uno spazio con contenitore a misura. */
.stage .combo-row > .combo { container-type: normal; width: auto; min-height: 0; flex: 0 0 min(72%, calc(44vh * 5 / 7)); }
.stage .combo-row .combo .black { width: 100%; height: auto; aspect-ratio: 5 / 7; }
.stage .combo-row .combo .black { line-height: 1.2; }
/* Con la fila sotto, la carta nera mantiene la sua grandezza: non si restringe per far posto. */
.stage:has(.combo-row) > .black-wrap { flex: 0 0 auto; container-type: normal; }
.stage:has(.combo-row) > .black-wrap .black { width: min(64vw, calc(34vh * 5 / 7)); height: auto; aspect-ratio: 5 / 7; }
.combo-row > .combo.unseen { opacity: .4; }
.combo-row > .combo.unseen .black { background: color-mix(in srgb, var(--ink) 55%, var(--paper)); }
.combo-row > .combo.rv-new .black .text { animation: rv-focus .6s cubic-bezier(.2,.8,.2,1) backwards; }
@keyframes rv-focus { from { opacity: 0; transform: scale(.85); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes rv-in { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes rv-pop { 0% { transform: scale(1); } 45% { transform: scale(1.08); } 100% { transform: scale(1); } }
.rv-card .foot { font-size: 11px; color: var(--muted); }
  .rail .card { width: calc(var(--ch) * 0.82 * 5 / 7); height: calc(var(--ch) * 0.82); container-type: inline-size; }
  .rail .card .txt { overflow-wrap: normal; word-break: normal; hyphens: none; font-size: 12.6cqi; }
}
.sheet-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: min(90vw, 420px); }
.sheet-nav .hidden-msg { margin: 0; }
.sheet-nav .icon { font-size: 26px; line-height: 1; padding: 4px 14px; }
.action-text { font-family: var(--card-font); font-size: 18px; line-height: 1.3; margin: 0; }
`));
document.head.append(el("style", {}, `
/* Scheda carta: pannello con sfondo, carta proporzionata, categorie e azioni sotto. */
.detail { display: flex; flex-direction: column; align-items: center; gap: 12px; width: min(92vw, 420px); max-height: 94dvh; overflow-y: auto;
  padding: 14px; border-radius: 22px; background: var(--bg); box-shadow: 0 30px 60px -20px rgba(0,0,0,.6); }
.detail .zoom { height: min(56dvh, calc((min(92vw, 420px) - 60px) * 7 / 5)); aspect-ratio: 5 / 7; animation: none; }
.detail .chips { justify-content: center; flex-wrap: wrap; }
.detail .actions { width: 100%; justify-content: space-between; }
.detail .sheet-nav { justify-content: space-between; }
`));
document.head.append(el("style", {}, `.detail .sheet-nav { width: 100%; } .detail .sheet-nav .icon { padding: 2px 10px; }`));

// Sfondo di partita: simboli appena visibili (violenza, ignoranza, sesso, volgarità).
{
  const SIMBOLI = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="#111" font-family="Bricolage Grotesque, sans-serif" font-weight="800">
    <text x="18" y="62" font-size="34" transform="rotate(-14 40 50)">☠</text>
    <text x="142" y="78" font-size="38">?</text>
    <text x="30" y="186" font-size="34" transform="rotate(10 40 180)">♥</text>
    <text x="150" y="200" font-size="30" transform="rotate(-8 160 190)">✖</text>
    <text x="96" y="128" font-size="22">@#!</text></g></svg>`;
  document.head.append(el("style", {}, `
body.in-game::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: .06;
  background-image: url("data:image/svg+xml,${encodeURIComponent(SIMBOLI)}"); background-size: 240px 240px; }
`));
}

// Nessuna parola spezzata: se una parola è più larga della carta, il testo si rimpicciolisce.
function fitText(root = document) {
  root.querySelectorAll(".black .text, .rail .card .txt, .zoom .txt, .pcard .txt").forEach((node) => {
    // Le combinazioni affiancate hanno una grandezza unica (CSS): non si ridimensionano a ogni aggiornamento.
    if (node.closest(".combo-row")) return;
    const tileEl = node.closest(".pcard");
    if (tileEl && node.closest(".cgrid")) tileEl.style.setProperty("--fit", "1");
    node.style.fontSize = "";
    let size = parseFloat(getComputedStyle(node).fontSize);
    let guard = 0;
    // Il testo deve stare nella carta in larghezza e in altezza, senza invadere l'etichetta in alto.
    // Carta nera: conta il riquadro intero (testo più etichetta), così il testo non esce né si sovrappone.
    const box = node.closest(".black") || node;
    const fits = () => box.scrollWidth <= box.clientWidth + 1 && box.scrollHeight <= box.clientHeight + 1
      && node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1;
    const floor = node.closest(".cgrid") ? 2 : (box !== node ? 9 : 8); // nella griglia a 6 colonne il testo scende in proporzione alla carta
    while (!fits() && size > floor && guard++ < 120) {
      size -= 0.5;
      node.style.fontSize = `${size}px`;
    }
    if (tileEl && node.closest(".cgrid")) {
      // Nella griglia il testo è una frazione della carta: si salva il rapporto, così resta proporzionale.
      const k = parseFloat(getComputedStyle(tileEl).getPropertyValue("--k")) || 1;
      tileEl.style.setProperty("--fit", String(size / (12 * k)));
      node.style.fontSize = "";
    }
  });
}
document.head.append(el("style", {}, `
/* Testi: niente trattini né parole spezzate, ovunque. */
*, *::before, *::after { hyphens: none !important; -webkit-hyphens: none !important; }
.black .text, .card .txt, .pcard .txt, .zoom .txt { overflow-wrap: normal !important; word-break: normal !important; }
.nw { white-space: nowrap; }
/* Mano: bordo del colore della categoria, etichetta piccola in alto a sinistra. */
.rail .card { border-width: 3px; border-style: solid; border-color: var(--cat, #9a9186); }
.rail .card.sel { border-color: var(--accent); }
.rail .card .kind { position: absolute; top: 7px; left: 8px; right: 26px; white-space: nowrap; font-size: 8px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--cat); line-height: 1; }
.rail .card .num { top: 5px; right: 5px; }
.rail .card .txt { margin-top: 14px; }
/* Carte nere: filetto bianco di rifinitura. */
.black { box-shadow: inset 0 0 0 2px rgba(255,255,255,.92), 0 22px 40px -18px rgba(0,0,0,.6); }
.black.ready { position: relative; }
.combo.sel { position: relative; }
.combo.sel { flex: 0 0 min(94vw, calc((100svh - 230px) * 5 / 7)) !important; }
.stage .combo-row .combo.sel .black { width: 100%; line-height: 1.2; }
/* Jolly: carta bianca speciale, Memory e corona */
.card.jolly { background: var(--paper, #f3e9dc); color: #1a130f; }
.card.jolly { padding: 0; overflow: hidden; }
.jolly-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.jolly-in { font: inherit; color: inherit; background: transparent; border: 0; border-bottom: 2px dashed var(--accent); width: 9ch; min-width: 6ch; max-width: 100%; padding: 0 2px; outline: none; text-align: inherit; }
.jolly-word { display: inline-block; }
.jolly-crown { display: inline-block; width: 1.1em; height: .7em; margin-right: 4px; vertical-align: .15em; }
.jolly-crown svg { width: 100%; height: 100%; display: block; }
.memory { display: flex; flex-direction: column; gap: 8px; width: 100%; min-width: 0; }
.jolly-reveal { display: block; width: min(60vw, calc((100svh - 330px) * 5 / 7)); aspect-ratio: 5 / 7; margin: 0 auto; border-radius: 12px; animation: jollyIn .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes jollyIn { from { transform: scale(.3) rotate(-8deg); opacity: 0; } to { transform: none; opacity: 1; } }
.expired { position: fixed; left: 50%; top: 42%; z-index: 60; padding: 12px 18px; border-radius: 10px; background: var(--accent); color: #1a130f; font-weight: 800; text-align: center; pointer-events: none; transform: translate(-50%, -50%); animation: expiredIn 2.4s ease both; }
@keyframes expiredIn { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.6); } 12% { opacity: 1; transform: translate(-50%, -50%) scale(1.05); } 22% { transform: translate(-50%, -50%) rotate(-4deg); } 32% { transform: translate(-50%, -50%) rotate(4deg); } 42% { transform: translate(-50%, -50%) rotate(0); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(.95); } }
.memory-hint { margin: 0; font-size: 13px; color: var(--muted, #888); text-align: center; }
.memgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; width: min(100%, calc((100svh - 360px) * 5 / 7)); margin: 0 auto; }
.mtile { all: unset; box-sizing: border-box; cursor: pointer; position: relative; aspect-ratio: 5 / 7; perspective: 600px; border-radius: 8px; }
.mtile .mface { position: absolute; inset: 0; border-radius: 8px; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; transition: transform .45s cubic-bezier(.2,.8,.2,1); }
.mtile .mfront { transform: rotateY(180deg); background: hsl(var(--hue, 0deg) 40% 30%); }
.mtile .mfront img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mtile .mback { background: hsl(var(--hue, 0deg) 35% 22%); border: 2px solid hsl(var(--hue, 0deg) 60% 55%); display: flex; align-items: center; justify-content: center; }
.mtile.up .mback, .mtile.done .mback { transform: rotateY(180deg); }
.mtile.up .mfront, .mtile.done .mfront { transform: rotateY(0deg); }
.mtile.done { visibility: hidden; }
.mlogo { display: flex; flex-direction: column; align-items: center; font-size: 9px; line-height: 1.05; color: #f3e9dc; }
.mlogo em { color: #e8875a; font-style: normal; }
.combo-ctrl { position: absolute; bottom: 14px; right: 14px; display: flex; gap: 10px; z-index: 5; }
.combo-ctrl button { all: unset; box-sizing: border-box; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #1a1410; font-size: 22px; font-weight: 800; box-shadow: 0 6px 16px -6px rgba(0,0,0,.6); cursor: pointer; }
.combo-ctrl button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

/* Respiro in alto, sotto la cornice dell'app. */
#app > .game { padding-top: 12px; box-sizing: border-box; }
`));
document.head.append(el("style", {}, `.switches { display: flex; gap: 8px; flex-wrap: wrap; }
.switches .switch { flex: 1 1 140px; }`));
