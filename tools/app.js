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
const DEFAULT_SETTINGS = { theme: "system", font: "moderno", textScale: 1, cardScale: 1, music: true, musicVol: 0.6, sfx: true, motion: true };

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
let cfg = { names: ["Tu"], winScore: 5, deck: "full" }; // partita locale: niente bot, mazzo scelto prima
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
let botTimer = null;
let judgeTimer = null;
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
  Sound.setVolume(settings.musicVol);
  Sound.setMusic(unlocked && settings.music);
}

// Aggiornamento dal repository: legge l'ultima release e offre la nuova APK.
const APP_VERSION = "0.2.0";
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
      out.replaceChildren(el("span", {}, `Versione ${latest} disponibile. `),
        el("a", { class: "primary", href: apk.browser_download_url, target: "_blank", rel: "noopener" }, "Scarica aggiornamento"),
        el("p", { class: "hidden-msg" }, "Il telefono scarica il file APK e ti chiede di installarlo."));
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
      toggle("sfx", "Effetti sonori")),
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

function logoNode(big = false) {
  // Pittogramma: una sola carta nera con due spazi arancio da riempire, come nel gioco.
  const svg = `<svg viewBox="0 0 72 96" aria-hidden="true">
    <rect x="6" y="6" width="60" height="84" rx="9" fill="#111"/>
    <rect x="16" y="36" width="40" height="7" rx="3" fill="#c4502a"/>
    <rect x="16" y="54" width="40" height="7" rx="3" fill="#c4502a"/>
  </svg>`;
  const wrap = el("div", { class: "logo" + (big ? " big" : "") });
  wrap.innerHTML = svg;
  wrap.append(el("div", { class: "wordmark" },
    el("span", {}, "Cards"),
    el("span", { class: "acc" }, "Against"),
    el("span", {}, "Humanity"),
    el("i", {}, "EDIZIONE ITALIANA")));
  return wrap;
}

// ------------------------------------------------------------------ setup

function setup() {
  game = null;
  document.body.classList.remove("in-game");
  clearTimeout(botTimer); clearTimeout(judgeTimer);
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
// Apertura: fondo nero, la scritta a sinistra con lo spazio vuoto, poi "Against" in arancio; infine la scritta scende in alto a sinistra.
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
    el("div", { class: "home-top" }, top),
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
    const ok = cfg.names.length >= 3;
    startBtn.disabled = !ok;
    hint.textContent = ok
      ? `${cfg.names.length} giocatori · vittoria a ${cfg.winScore} punti · ${cfg.deck === "base" ? "solo carte ufficiali" : `carte ufficiali + ${nCards} mie`}`
      : "Servono almeno 3 giocatori. Niente bot: passate il telefono a turno.";
  };

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
  const players = names.map((name, i) => ({ id: `h${i}`, name }));
  game = new Game(players, deckFor(), { winScore: cfg.winScore });
  selected = [];
  judgeSel = null;
  viewer = null;
  lastViewer = null;
  dealPending = true;
  slamPending = true;
  game.start();
  Sound.play("deal");
  step();
}

// ------------------------------------------------------------------ carte e categorie

const CUSTOM_KEY = "cah-custom";
// Categorie fisse. Bianche: chi, dove, cosa, azione, concetto. Nere: quattro temi.
const WHITE_CATS = ["Soggetti", "Luoghi", "Oggetti", "Azioni", "Concetti"];
const BLACK_CATS = ["Quotidiano", "Vita personale", "Cultura e spettacolo", "Società"];
const CAT_COLOR = {
  "Soggetti": "#c4502a", "Luoghi": "#2f6fa3", "Oggetti": "#b8862b", "Azioni": "#7a4fb0", "Concetti": "#2f8f7f",
  "Quotidiano": "#5f7d2e", "Vita personale": "#b04a7a", "Cultura e spettacolo": "#3d5a80", "Società": "#8a5a2b",
};
const KIND = { "Soggetti": "Soggetto", "Luoghi": "Luogo", "Oggetti": "Oggetto", "Azioni": "Azione", "Concetti": "Concetto" };
const ORIG_COLOR = "#9a9186";
let cardsView = { tab: "white", cat: "Tutte" };

const catsOf = (color) => (color === "b" ? BLACK_CATS : WHITE_CATS);
const validCat = (name, color) => catsOf(color).includes(name);
const defaultCat = (color) => catsOf(color)[color === "b" ? 0 : WHITE_CATS.length - 1];

function loadCustom() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "null"); } catch { d = null; }
  d = d && typeof d === "object" ? d : {};
  const fix = (list, color) => (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c.text === "string" && c.text.trim())
    .map((c) => ({ text: c.text, cat: validCat(c.cat, color) ? c.cat : defaultCat(color) }));
  const catOverride = {};
  if (d.catOverride && typeof d.catOverride === "object") {
    for (const [id, cat] of Object.entries(d.catOverride)) if (validCat(cat, id.startsWith("b") ? "b" : "w")) catOverride[id] = cat;
  }
  return {
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
// Ordine in mano: Soggetti, Luoghi, Oggetti, Azioni, Concetti; le nere non finiscono in mano.
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
  const o = loadCustom().catOverride;
  const tag = (c) => (o[c.id] ? { ...c, cat: o[c.id] } : c);
  return { white: cards.white.map(tag), black: cards.black.map(tag) };
};
const deckFor = () => mergeCustom(withOverrides(CARDS), cfg.deck === "base" ? { white: [], black: [] } : activeCustom());

// Solo testi e categorie: il server li ripulisce di nuovo prima di usarli.
function customPayload() {
  const a = activeCustom();
  return {
    white: a.white.map((c) => ({ text: c.text, cat: c.cat })),
    black: a.black.map((c) => ({ text: c.text, cat: c.cat })),
  };
}

function allCards() {
  const d = loadCustom();
  const cat = (c) => d.catOverride[c.id] ?? c.cat;
  const orig = [
    ...CARDS.white.map((c) => ({ id: c.id, text: c.text, color: "w", cat: cat(c), mine: false })),
    ...CARDS.black.map((c) => ({ id: c.id, text: c.text, color: "b", cat: cat(c), mine: false })),
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
  document.body.classList.remove("in-game");
  clearTimeout(botTimer); clearTimeout(judgeTimer);
  window.scrollTo(0, 0);
  const { orig, mine, d } = allCards();
  const all = [...orig, ...mine];
  const v = cardsView;
  const color = v.tab === "black" ? "b" : "w";
  let list = v.tab === "mine" ? mine : all.filter((c) => c.color === color);
  if (v.tab !== "mine" && v.cat !== "Tutte") list = list.filter((c) => c.cat === v.cat);

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
    if (!navigator.clipboard) { toast("Copia non disponibile qui"); return; }
    navigator.clipboard.writeText(JSON.stringify(packData())).then(() => toast("Pacchetto copiato"), () => toast("Copia non riuscita"));
  };
  const pasteIn = el("textarea", { rows: "3", placeholder: "Incolla qui un pacchetto ricevuto", "aria-label": "Pacchetto da importare" });

  app.replaceChildren(el("section", { class: "cards-screen" },
    el("div", { class: "subhead" },
      el("button", { type: "button", class: "ghost back", onclick: () => { homeTab = "home"; setup(); } }, "← Home"),
      el("div", { class: "head-row" },
        el("h2", { class: "display" }, "Le carte"),
        el("button", { type: "button", class: "add", onclick: () => openCardForm(() => { v.tab = "mine"; cardsScreen(); }) }, "+ Aggiungi"))),
    el("div", { class: "cstats" },
      stat(count("w"), "Bianche"), stat(count("b"), "Nere"), stat(mine.length, "Mie")),
    el("div", { class: "tabs", role: "group", "aria-label": "Tipo di carta" },
      tabBtn("white", "Bianche"), tabBtn("black", "Nere"), tabBtn("mine", "Mie")),
    v.tab === "mine" ? null : el("div", { class: "chips", role: "group", "aria-label": "Categorie" },
      ["Tutte", ...catsOf(color)].map(catBtn)),
    list.length
      ? el("div", { class: "cgrid" }, list.map(tile))
      : el("p", { class: "hidden-msg" }, v.tab === "mine" ? "Non hai ancora carte tue: tocca + per aggiungerne." : "Nessuna carta con questo filtro."),
    el("span", { class: "label", style: "margin-top:10px" }, "Nelle partite"),
    el("div", { class: "switches" }, toggle("useWhite", "Mie bianche"), toggle("useBlack", "Mie nere")),
    el("span", { class: "label", style: "margin-top:10px" }, "Pacchetti"),
    el("p", { class: "hidden-msg" }, "Scarica o copia le tue carte per condividerle. Incolla un pacchetto per aggiungerlo."),
    el("div", { class: "pack-row" },
      el("button", { type: "button", onclick: download }, "Scarica file"),
      el("button", { type: "button", onclick: copy }, "Copia")),
    pasteIn,
    el("button", { type: "button", class: "primary", onclick: () => importPack(pasteIn.value) }, "Importa pacchetto")));
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
      el("span", { class: "label" }, "Sposta in categoria"),
      el("div", { class: "chips", role: "group", "aria-label": "Categoria" }, catsOf(c.color === "w" ? "w" : "b").map((name) => el("button", {
        type: "button", class: "chip", style: `--cat:${catColor(name)}`, "aria-pressed": String(c.cat === name),
        onclick: () => { applyCat(c, name); close(); refresh(); },
      }, name))),
      el("div", { class: "actions" },
        c.mine ? el("button", { type: "button", class: "ghost danger", onclick: () => { close(); deleteCard(c, refresh); } }, "Elimina") : null,
        el("button", { type: "button", class: "ghost", onclick: () => shareText(c) }, "Condividi"),
        el("button", { type: "button", class: "primary", onclick: close }, "Annulla"))));
  document.body.append(bg);
}

function applyCat(c, name) {
  if (!validCat(name, c.color)) return;
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
  const catSel = el("select", { "aria-label": "Categoria" });
  const fillCats = () => catSel.replaceChildren(...catsOf(color).map((n) => el("option", { value: n }, n)));
  const wBtn = el("button", { type: "button", "aria-pressed": "true", onclick: () => setColor("w") }, "Bianca");
  const bBtn = el("button", { type: "button", "aria-pressed": "false", onclick: () => setColor("b") }, "Nera");
  const setColor = (c) => {
    color = c;
    wBtn.setAttribute("aria-pressed", String(c === "w"));
    bBtn.setAttribute("aria-pressed", String(c === "b"));
    fillCats();
  };
  fillCats();
  const save = () => {
    const d = loadCustom();
    let text = txt.value.replace(/\s+/g, " ").trim();
    if (!text) { toast("Scrivi il testo della carta"); return; }
    if (color === "b") {
      if (!text.includes("____")) text += " ____";
      if (text.split("____").length - 1 > 3) { toast("Una carta nera può avere al massimo 3 spazi"); return; }
    }
    (color === "w" ? d.white : d.black).push({ text, cat: catSel.value });
    saveCustom(d);
    bg.remove();
    done();
  };
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) bg.remove(); } },
    el("div", { class: "sheet card-form" },
      el("div", { class: "seg" }, wBtn, bBtn),
      txt,
      el("p", { class: "hidden-msg" }, "Bianca: una frase o un oggetto. Nera: scrivi ____ dove va la risposta."),
      catSel,
      el("div", { class: "actions" },
        el("button", { type: "button", class: "ghost", onclick: () => bg.remove() }, "Annulla"),
        el("button", { type: "button", class: "primary", onclick: save }, "Salva carta"))));
  document.body.append(bg);
}

function importPack(text) {
  let data;
  try { data = JSON.parse(text); } catch { toast("Pacchetto non valido"); return; }
  if (!data || data.formato !== "cah-pacchetto") { toast("Non è un pacchetto di CAH"); return; }
  const clean = (list, color) => (Array.isArray(list) ? list : []).slice(0, 300).map((c) => ({
    text: String(c?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    cat: validCat(c?.cat, color) ? c.cat : defaultCat(color),
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
  cardsView.tab = "mine";
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
  clearTimeout(botTimer); clearTimeout(judgeTimer);
  if (online) return render();   // online: il server decide tutto, la UI segue lo stato
  if (!game) return;
  if (game.phase === "playing") {
    const botsPending = game.players.some((p) => p.isBot && p.id !== game.judge.id && !game.submissions.has(p.id));
    if (botsPending) botTimer = setTimeout(() => { game.playBots(); step(); }, 650);
  } else if (game.phase === "judging" && game.judge.isBot) {
    judgeTimer = setTimeout(() => { game.judgeIfBot(); step(); }, readingMs(game.revealOrder.length));
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

function humanConfirmJudge() {
  if (judgeSel === null) return;
  game.pick(viewer, judgeSel);
  judgeSel = null;
  Sound.play("confirm");
  step();
}

function nextRound() {
  game.nextRound();
  selected = [];
  judgeSel = null;
  dealPending = true;
  slamPending = true;
  Sound.play("slam");
  step();
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
  const out = new Array(s.black.blanks).fill(null);
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
  const nodes = segs.map((x) => {
    if (x.t === "text") return x.v;
    if (x.t === "word") return el("span", { class: "word" }, x.v);
    return el("span", { class: canPlay ? "slot lit" : "slot" }, "_____");
  });
  return el("div", { class: "black-wrap" },
    el("div", { class: "black" + (slam ? " slam" : ""), role: "region", "aria-label": "Carta nera" },
      el("div", { class: "text" }, ...nodes),
      el("div", { class: "foot" }, label ?? (s.black.blanks > 1 ? `${s.black.blanks} risposte` : "1 risposta"))));
}

function confetti() {
  const box = el("div", { class: "confetti", "aria-hidden": "true" });
  const colors = ["#c4502a", "#2f7a4d", "#f6c445", "#3b7dd8", "#e95b8a", "#ffffff"];
  for (let k = 0; k < 70; k++) {
    const piece = el("i", {});
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[k % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.setProperty("--dx", `${(Math.random() - 0.5) * 180}px`);
    piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    box.append(piece);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3300);
}

function render() {
  if (online && !online.state?.game) return renderLobby();
  if (!game) return setup();
  document.body.classList.add("in-game");
  const next = viewerFor();
  if (next !== lastViewer) {
    lastViewer = next;
    viewer = next;
    selected = [];
    judgeSel = null;
    curtain = !online && humanIds().length > 1;
  }
  viewer = next;
  const s = game.publicState(viewer);
  const isJudge = s.judgeId === viewer;
  const me = s.players.find((p) => p.id === viewer);
  const need = s.black ? s.black.blanks : 1;
  const judging = s.phase === "judging" && isJudge;
  if (judging) resetJudgeIfNewRound();
  const showPrivate = !curtain;

  const board = el("div", { class: "board", role: "list" },
    s.players.map((p) => {
      const won = s.phase === "roundEnd" && game.lastWinner === p.id && wonRound === s.round;
      return el("div", {
        class: ["seat", p.id === s.judgeId ? "judge" : "", p.hasPlayed ? "played" : "", won ? "won" : ""].join(" "),
        role: "listitem",
      },
        el("div", { class: "name" }, p.name),
        el("div", { class: "pts" }, p.score),
        el("div", { class: "tag" }, p.id === s.judgeId ? "Re" : `${p.handSize} carte`));
    }));

  const topbar = el("div", { class: "topbar" },
    logoNode(false),
    el("div", { class: "tools" },
      el("button", { type: "button", class: "ghost", "aria-label": "Impostazioni", onclick: openSettings }, "⚙"),
      el("button", { type: "button", class: "ghost", onclick: exitGame }, "Esci")));

  const roundline = el("div", { class: "roundline" },
    el("span", { class: "status" }, el("strong", {}, `Round ${s.round}`), `  ·  Re: ${game.judge.name}`),
    el("span", { class: "status" }, `Vittoria a ${game.opts.winScore} punti`));

  let mainCard = null;
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
        el("button", { type: "button", disabled: judgeView === 0, onclick: () => { judgeView -= 1; render(); } }, "← Precedente"),
        judgeView < total - 1
          ? el("button", { class: "primary", type: "button", onclick: () => { judgeView += 1; Sound.play("flip"); render(); } }, "Successiva →")
          : el("button", { class: "primary", type: "button", onclick: () => { judgeMode = "compare"; enterPending = true; Sound.play("flip"); render(); } }, vediTutteLabel(total)));
    } else {
      note = el("p", { class: "hidden-msg" }, "Tutte le combinazioni. Scegli quella che ti ha fatto ridere di più.");
      const enter = enterPending;
      enterPending = false;
      mainCard = el("div", { class: "minis", role: "group", "aria-label": "Combinazioni" },
        s.reveal.map((r) => {
          const text = fillSentence(s.black.text, r.cards.map((c) => c.text)).map((x) => (x.t === "slot" ? "_____" : x.v)).join("");
          const node = el("button", {
            class: "mini" + (judgeSel === r.index ? " sel" : "") + (enter ? " enter" : ""),
            type: "button",
            "aria-pressed": String(judgeSel === r.index),
            onclick: () => { judgeSel = judgeSel === r.index ? null : r.index; Sound.play("pick"); render(); },
          }, el("span", {}, text), el("span", { class: "foot" }, `Combinazione ${r.index + 1}`));
          node.style.setProperty("--i", r.index);
          return node;
        }));
      actions = el("div", { class: "judge-nav" },
        el("button", { type: "button", onclick: () => { judgeMode = "browse"; judgeView = 0; render(); } }, "Rivedi una per una"),
        el("button", { class: "primary", type: "button", disabled: judgeSel === null, onclick: humanConfirmJudge }, "Scegli questa risposta"));
    }
  } else if (s.phase === "judging") {
    note = el("p", { class: "hidden-msg" }, `${game.judge.name} sta leggendo le risposte…`);
  } else if (s.phase === "roundEnd") {
    const last = game.lastWinner ? game.player(game.lastWinner) : null;
    if (wonRound !== s.round && last) {
      wonRound = s.round;
      confetti();
      Sound.play("win");
    }
    note = el("div", { class: "banner" },
      el("p", { style: "margin:0" }, last ? `Round vinto da ${last.name}.` : ""),
      el("button", { class: "primary", type: "button", onclick: nextRound }, "Prossimo round"));
  } else if (isJudge) {
    note = el("p", { class: "hidden-msg" }, "Sei il Re: aspetta che gli altri confermino.");
  } else if (me.hasPlayed) {
    note = el("p", { class: "hidden-msg" }, "Risposta confermata. Aspetta gli altri giocatori.");
  }

  // Carta nera in cima, tranne nella vista "tutte e tre" del Re.
  if (!(judging && judgeMode === "compare" && showPrivate)) {
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
        const full = selected.length >= need && idx < 0;
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
            else selected.push(c.id);
            Sound.play("pick");
            render();
          },
        }, el("span", { class: "num" }, idx >= 0 ? String(idx + 1) : ""), el("span", { class: "txt" }, c.text));
        node.style.setProperty("--i", i);
        node.style.setProperty("--cat", catColor(c.cat));
        node.append(el("span", { class: "kind" }, KIND[c.cat] ?? c.cat));
        attachHold(node, () => { held.v = true; Sound.play("flip"); showZoom(c.text); }, held);
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

  const who = curtain ? el("div", { class: "curtain", role: "dialog", "aria-label": "Passa il telefono" },
    el("div", { class: "box" },
      el("span", { class: "label" }, "Passa il telefono"),
      el("div", { class: "big" }, `Tocca per ${me.name}`),
      el("p", { class: "hidden-msg" }, "Le tue carte sono nascoste finché non tocchi."),
      el("button", { class: "primary", type: "button", onclick: () => { curtain = false; Sound.play("deal"); render(); } }, `Sono ${me.name}, mostra le carte`))) : null;

  requestAnimationFrame(() => fitText(app));
  app.replaceChildren(
    el("div", { class: "game" },
      el("header", { class: "hud" }, board, roundline),
      el("main", { class: "stage" }, mainCard, note),
      el("footer", { class: "dock" }, actions, railBlock),
      who));
}

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

const ONLINE_OK = /^https?:$/.test(location.protocol);
const SESSION_KEY = "cah-online";
let onlineSock = null;
let onlineQueue = [];   // azioni in attesa che la connessione sia aperta
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

function toast(msg) {
  const t = el("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3000);
}

function netSend(obj) {
  if (onlineSock && onlineSock.readyState === 1) onlineSock.send(JSON.stringify(obj));
}

function withSocket(fn) {
  if (onlineSock && onlineSock.readyState === 1) return fn();
  onlineQueue.push(fn);
  if (!onlineSock || onlineSock.readyState > 1) openSocket();
}

const SERVER_KEY = "cah-server";
const DEFAULT_SERVER = "https://cah-italiano.onrender.com";
const loadServer = () => {
  try { return localStorage.getItem(SERVER_KEY) || ""; } catch { return ""; }
};
const saveServer = (v) => {
  try { localStorage.setItem(SERVER_KEY, v); } catch { /* nessuno storage */ }
};

// Indirizzo del WebSocket: stesso server se la pagina è servita da lì, altrimenti quello scelto (app).
function socketUrl() {
  if (ONLINE_OK) return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
  let base = (loadServer() || DEFAULT_SERVER).trim().replace(/\/+$/, "");
  if (!base) return null;
  if (!/^(https?|wss?):\/\//.test(base)) base = `https://${base}`;
  return base.replace(/^http/, "ws") + "/ws";
}

function openSocket() {
  const url = socketUrl();
  if (!url) {
    onlineError = "Inserisci l'indirizzo del server qui sotto.";
    onlineQueue = [];
    return;
  }
  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    onlineError = "Connessione online non disponibile qui.";
    onlineQueue = [];
    return;
  }
  onlineSock = ws;
  ws.onopen = () => {
    const q = onlineQueue;
    onlineQueue = [];
    q.forEach((f) => f());
  };
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* messaggio non valido: ignorato */ }
  };
  ws.onclose = () => {
    if (onlineSock !== ws) return;
    onlineSock = null;
    const hadQueue = onlineQueue.length > 0;
    onlineQueue = [];
    if (online) {
      online.offline = true;
      render();
      if (loadSession()) setTimeout(() => withSocket(resumeSaved), 2000);
      return;
    }
    if (hadQueue) {
      onlineError = "Non riesco a collegarmi al server. Il gioco online va aperto dal server (npm start).";
      onlineMenu();
    }
  };
}

function resumeSaved() {
  const s = loadSession();
  if (s) netSend({ type: "resume", code: s.code, token: s.token });
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
    saveSession(null);
    online = null;
  }
  clearTimeout(botTimer); clearTimeout(judgeTimer);
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
      withSocket(() => netSend({ type: "create", name: onlineName }));
    } }, "Crea una stanza"),
    el("span", { class: "label" }, "Entra con un codice"),
    el("div", { class: "nrow" }, codeIn,
      el("button", { type: "button", onclick: () => {
        onlineError = ""; onlineName = nameIn.value.trim();
        withSocket(() => netSend({ type: "join", code: codeIn.value.trim(), name: onlineName }));
      } }, "Entra")),
    onlineError ? el("p", { class: "hidden-msg err" }, onlineError) : null);
}

function onlineMenu() {
  homeTab = "online";
  setup();
}

// Tenere premuta una carta della mano: la mostra ingrandita, con il testo intero.
function attachHold(node, fn, flag = null) {
  let t = null;
  const cancel = () => clearTimeout(t);
  node.addEventListener("pointerdown", () => { if (flag) flag.v = false; t = setTimeout(fn, 380); });
  node.addEventListener("pointerup", cancel);
  node.addEventListener("pointerleave", cancel);
  node.addEventListener("pointercancel", cancel);
  node.addEventListener("contextmenu", (e) => e.preventDefault());
}

function showZoom(text) {
  const card = el("div", { class: "zoom", role: "dialog", "aria-label": "Carta ingrandita" }, el("div", { class: "txt" }, text));
  const bg = el("div", { class: "zoom-bg", onclick: () => bg.remove() }, card);
  document.body.append(bg);
}

function renderLobby() {
  const st = online.state;
  if (!st) {
    app.replaceChildren(el("section", { class: "setup" }, logoNode(true),
      el("p", { class: "hidden-msg" }, online.offline ? "Riconnessione in corso…" : "Mi collego alla stanza…")));
    return;
  }
  const isHost = st.hostId === online.you;
  const total = st.players.length;
  const ok = total >= 3;
  const seg = [3, 5, 8].map((n) => el("button", {
    type: "button", "aria-pressed": String(onlineWin === n),
    onclick: () => { onlineWin = n; render(); },
  }, `${n} punti`));
  app.replaceChildren(
    el("section", { class: "setup" },
      logoNode(true),
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
          `${p.name}${p.id === st.hostId ? " · host" : ""}${p.id === online.you ? " (tu)" : ""}`))),
        isHost ? el("span", { class: "label", style: "margin-top:6px" }, "Vittoria") : null,
        isHost ? el("div", { class: "seg" }, seg) : null,
        isHost
          ? el("button", { type: "button", class: "primary", disabled: !ok, onclick: () => netSend({ type: "start", winScore: onlineWin, custom: customPayload() }) }, "Avvia partita")
          : el("p", { class: "hidden-msg" }, ok ? "In attesa che l'host avvii la partita." : "Servono almeno 3 giocatori per iniziare."),
        isHost && !ok ? el("p", { class: "hidden-msg" }, "Servono almeno 3 giocatori.") : null,
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
  if (s && socketUrl()) {
    online = { code: s.code, you: null, state: null, offline: true, winScore: onlineWin };
    render();
    withSocket(resumeSaved);
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
