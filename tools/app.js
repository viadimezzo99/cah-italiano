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
const DEFAULT_SETTINGS = { theme: "system", font: "moderno", textScale: 1, cardScale: 1, music: true, musicVol: 0.6, sfx: true, vibration: true, motion: true };

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
  root.style.setProperty("--ts", settings.textScale);
  root.style.setProperty("--cs", settings.cardScale);
  root.style.setProperty("--card-font", FONTS[settings.font].css);
  if (settings.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);
  document.body.classList.toggle("no-motion", !settings.motion);
  document.body.classList.toggle("motion-on", settings.motion);
  Sound.setSfx(settings.sfx);
  Sound.setHaptics(settings.vibration);
  Sound.setVolume(settings.musicVol);
  Sound.setMusic(unlocked && settings.music);
}

// Aggiornamento dal repository: legge l'ultima release e offre la nuova APK.
const APP_VERSION = "0.2.17";
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
      slider("textScale", "Testo sulle carte", 0.8, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`),
      slider("cardScale", "Grandezza delle carte", 0.8, 1.3, 0.05, (v) => `${Math.round(v * 100)}%`)),
    el("div", { class: "group" }, el("span", { class: "label" }, "Audio"),
      toggle("music", "Musica di sottofondo"),
      slider("musicVol", "Volume musica", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      toggle("sfx", "Effetti sonori"),
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
const APP_ICON = "data:image/png;base64,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";
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
// Voce bassa che pronuncia "Against" mentre compare. Usa le voci inglesi del dispositivo.
function announce(word) {
  try {
    if (!settings.sfx || !("speechSynthesis" in window)) return;
    const say = () => {
      const u = new SpeechSynthesisUtterance(word);
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find((v) => /^en[-_]US/i.test(v.lang) && /male|david|mark|daniel|george|guy/i.test(v.name)) ||
        voices.find((v) => /^en/i.test(v.lang)) || null;
      u.lang = "en-US";
      u.pitch = 0.3;
      u.rate = 0.8;
      u.volume = 1;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    };
    whenAudible(say);
  } catch { /* nessuna voce: l'apertura funziona lo stesso */ }
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
      announce("Against");
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

  const botRows = () => cfg.bots.map((n, i) => el("div", { class: "nrow" },
    el("span", { class: "txt" }, `${n} · bot`),
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
  const bots = cfg.bots.map((n, i) => ({ id: `b${i}`, name: n, isBot: true }));
  const players = [...names.map((name, i) => ({ id: `h${i}`, name })), ...bots];
  game = new Game(players, deckFor(), { winScore: cfg.winScore });
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
    isMine ? null : el("div", { class: "chips", role: "group", "aria-label": "Categorie" },
      ["Tutte", ...catsOf(color)].map(catBtn)),
    list.length
      ? el("div", { class: "cgrid" }, list.map(tile))
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

function humanPlay() {
  if (selected.length !== game.currentBlack.blanks) return;
  try {
    game.play(viewer, selected);
    selected = [];
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
      if (interactive) card.onclick = () => { setJudgeSel(judgeSel === r.index ? null : r.index); Sound.play("pick"); render(); };
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
    selected.forEach((id, i) => { out[i] = game.text(id); });
  }
  return out;
}

function blackCard(s, whites, { canPlay, label, slam } = {}) {
  const segs = fillSentence(s.black.text, whites);
  // Solo le parole appena inserite si animano; le altre restano ferme quando si tocca altro.
  let k = 0;
  const nodes = segs.map((x) => {
    if (x.t === "text") return x.v;
    if (x.t === "word") { const fresh = canPlay && k >= wordsShown; k += 1; return el("span", { class: "word" + (fresh ? " fresh" : "") }, x.v); }
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

  // La carta vincente si rimpicciolisce lentamente per tutta la pausa e finisce sotto il nome del vincitore.
  const roundPause = online ? 12000 : LOCAL_ROUND_PAUSE_MS;
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
        el("div", { class: "name" }, p.name),
        el("div", { class: "pts" }, p.score),
        mark);
    }));

  // Freccia e pallino stanno sulla riga del round: non occupano altro spazio in verticale.
  const roundline = el("div", { class: "roundline" },
    el("button", { type: "button", class: "back-arrow", "aria-label": "Indietro", onclick: () => { homeTab = "home"; exitGame(); } }, "←"),
    el("span", { class: "status" }, el("strong", {}, `Round ${s.round}`), `  ·  Re: ${game.judge.name}`),
    el("span", { class: "status" }, `Vittoria a ${game.opts.winScore} punti`),
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
      note = el("p", { class: "hidden-msg" }, "Tutte le combinazioni. Scegli quella che ti ha fatto ridere di più.");
      const enter = enterPending;
      enterPending = false;
      mainCard = comboRow(s, judgeSel, true);
      actions = el("div", { class: "judge-nav" },
        el("button", { type: "button", onclick: () => { judgeMode = "browse"; judgeView = 0; render(); } }, "Rivedi una per una"),
        el("button", { class: "primary", type: "button", disabled: judgeSel === null, onclick: humanConfirmJudge }, "Scegli questa risposta"));
    }
  } else if (s.phase === "judging" && s.compare) {
    // Gli altri vedono le combinazioni affiancate, come il Re, e la scelta che sta facendo.
    note = el("p", { class: "hidden-msg" }, `${s.players.find((p) => p.id === s.judgeId)?.name ?? "Il Re"} sta scegliendo…`);
    extraRow = comboRow(s, s.selected, false);
  } else if (s.phase === "judging") {
    note = el("p", { class: "hidden-msg" }, `${game.judge.name} sta leggendo le risposte…`);
    if (!isJudge) extraRow = comboRow(s, null, false, s.peek ?? -1);
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
    note = el("p", { class: "hidden-msg" }, "Sei il Re: aspetta che gli altri confermino.");
  } else if (s.phase === "playing" && !me.hasPlayed) {
    note = el("p", { class: "turn-line" }, `Tocca a ${me.name}: scegli ${need === 1 ? "una carta" : `${need} carte`}.`);
  } else if (me.hasPlayed) {
    note = el("p", { class: "hidden-msg" }, "Risposta confermata. Aspetta gli altri giocatori.");
  }

  // Carta nera in cima. Nella vista "tutte e tre" del Re compare solo quando ha scelto una risposta,
  // già compilata con quella scelta; le altre restano in elenco.
  const comparing = judging && judgeMode === "compare" && showPrivate;
  if (!comparing) {
    const canPlay = s.phase === "playing" && !isJudge && !me.hasPlayed && showPrivate;
    const slam = slamPending;
    slamPending = false;
    mainCard = blackCard(s, previewWhites(s), { canPlay, slam });
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
        }, el("span", { class: "num" }, idx >= 0 ? String(idx + 1) : ""), el("span", { class: "txt" }, c.text));
        node.style.setProperty("--i", i);
        node.style.setProperty("--cat", catColor(c.cat));
        node.append(el("span", { class: "kind" }, KIND[c.cat] ?? c.cat));
        attachHold(node, () => { held.v = true; Sound.play("paper"); showZoom(c.text); }, held, hideZoom);
        return node;
      }));
    if (canSelect) {
      actions = el("div", { class: "actions" },
        el("button", { class: "primary", type: "button", disabled: selected.length !== need, onclick: humanPlay }, "Conferma e gioca"));
    }
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
    play: (_id, ids) => netSend({ type: "play", cards: ids }),
    pick: (_id, index) => netSend({ type: "pick", index }),
    nextRound: () => netSend({ type: "next" }),
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
.cat-row { display: grid; grid-template-columns: 6px 1fr auto auto; gap: 12px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line); }
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
.stat { background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; }
.stat strong { font-family: "Bricolage Grotesque", sans-serif; font-size: 28px; font-weight: 800; line-height: 1; }
.chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.chip { flex: 0 0 auto; padding: 7px 13px; font-size: 13px; border-radius: 999px; }
.cgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 10px; }
.pcard { position: relative; aspect-ratio: 5 / 7; border-radius: 11px; padding: 9px 9px 10px; text-align: left; display: flex; flex-direction: column; justify-content: flex-end;
  font-family: var(--card-font); font-weight: 600; font-size: 12px; line-height: 1.28; hyphens: auto; -webkit-hyphens: auto; overflow: hidden; border: 1px solid #d6d0c2; box-shadow: 0 8px 16px -12px rgba(0,0,0,.5); }
.pcard.w { background: #fff; color: #111; }
.pcard.b { background: #111; color: #fff; border-color: #111; }
.pcard .txt { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
.pcard .tag { position: absolute; top: 7px; left: 8px; font-size: 9.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
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
.splash { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: var(--bg); transition: opacity .55s ease, visibility .55s; }
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
.combo-row > .combo.sel .black { outline: 3px solid var(--accent); outline-offset: 3px; }
/* Le combinazioni hanno la stessa grandezza della carta nera, anche se la riga è in uno spazio con contenitore a misura. */
.stage .combo-row > .combo { container-type: normal; width: auto; min-height: 0; flex: 0 0 min(72%, calc(44vh * 5 / 7)); }
.stage .combo-row .combo .black { width: 100%; height: auto; aspect-ratio: 5 / 7; }
.stage .combo-row .combo .black { font-size: 15px; line-height: 1.2; }
.stage .combo-row .combo .black .text { font-size: inherit; }
.combo-row > .combo.unseen { opacity: .4; }
.combo-row > .combo.unseen .black { background: color-mix(in srgb, var(--ink) 55%, var(--paper)); }
.combo-row > .combo.rv-new .black .text { animation: rv-focus .6s cubic-bezier(.2,.8,.2,1) backwards; }
@keyframes rv-focus { from { opacity: 0; transform: scale(.85); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes rv-in { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes rv-pop { 0% { transform: scale(1); } 45% { transform: scale(1.08); } 100% { transform: scale(1); } }
.rv-card .foot { font-size: 11px; color: var(--muted); }
  .rail .card { width: calc(var(--ch) * 0.82 * 5 / 7); height: calc(var(--ch) * 0.82); font-size: calc(var(--ch) * 0.074 * var(--ts) * var(--cs)); }
  .rail .card .txt { overflow-wrap: normal; word-break: normal; hyphens: none; }
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
    node.style.fontSize = "";
    let size = parseFloat(getComputedStyle(node).fontSize);
    let guard = 0;
    // Il testo deve stare nella carta in larghezza e in altezza, senza invadere l'etichetta in alto.
    // Carta nera: conta il riquadro intero (testo più etichetta), così il testo non esce né si sovrappone.
    const box = node.closest(".black") || node;
    const fits = () => box.scrollWidth <= box.clientWidth + 1 && box.scrollHeight <= box.clientHeight + 1
      && node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1;
    while (!fits() && size > (box !== node ? 9 : 8) && guard++ < 120) {
      size -= 0.5;
      node.style.fontSize = `${size}px`;
    }
  });
}
document.head.append(el("style", {}, `
/* Testi: niente trattini né parole spezzate, ovunque. */
*, *::before, *::after { hyphens: none !important; -webkit-hyphens: none !important; }
.black .text, .card .txt, .pcard .txt, .zoom .txt { overflow-wrap: normal !important; word-break: normal !important; }
/* Mano: bordo del colore della categoria, etichetta piccola in alto a sinistra. */
.rail .card { border-width: 3px; border-style: solid; border-color: var(--cat, #9a9186); }
.rail .card.sel { border-color: var(--accent); }
.rail .card .kind { position: absolute; top: 7px; left: 8px; right: 26px; white-space: nowrap; font-size: 8px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--cat); line-height: 1; }
.rail .card .num { top: 5px; right: 5px; }
.rail .card .txt { margin-top: 14px; }
/* Carte nere: filetto bianco di rifinitura. */
.black { box-shadow: inset 0 0 0 2px rgba(255,255,255,.92), 0 22px 40px -18px rgba(0,0,0,.6); }
/* Respiro in alto, sotto la cornice dell'app. */
#app > .game { padding-top: 12px; box-sizing: border-box; }
`));
document.head.append(el("style", {}, `.switches { display: flex; gap: 8px; flex-wrap: wrap; }
.switches .switch { flex: 1 1 140px; }`));
