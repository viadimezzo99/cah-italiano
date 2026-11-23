// Interfaccia da tavolo: logo, setup, partita locale (più persone e bot), impostazioni, animazioni.
const app = document.getElementById("app");
// Ogni schermata nuova entra con una leggera scorrevole; il tavolo di gioco no (si aggiorna da solo).
const replaceApp = app.replaceChildren.bind(app);
app.replaceChildren = (...nodes) => {
  replaceApp(...nodes);
  const first = app.firstElementChild;
  if (first && !first.classList.contains("game") && !first.classList.contains("home")) first.classList.add("enter");
};
const MAX_HUMANS = 6;

const FONTS = {
  moderno: { label: "Moderno", css: '"Bricolage Grotesque", system-ui, sans-serif' },
  classico: { label: "Classico", css: 'Fraunces, Georgia, serif' },
  tecnico: { label: "Tecnico", css: '"IBM Plex Sans", system-ui, sans-serif' },
  fumetto: { label: "Fumetto", css: '"Permanent Marker", cursive' },
};
const DEFAULT_SETTINGS = { theme: "system", font: "moderno", textScale: 1, cardScale: 1, music: true, musicVol: 0.6, sfx: true, uiSfx: true, sfxVol: 1, vibration: true, motion: true };

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
let cfg = { names: ["Tu"], bots: [], winScore: 5 }; // partita locale: persone e bot, mazzo scelto prima (niente jolly: vale solo online)

// Nomi di fantasia suggeriti per i bot: chi aggiunge il bot può cambiarli.
const BOT_SUGGEST = ["Tana", "Tega", "Tino", "Tone", "Jack"];
function askBotName(n, onOk) {
  const input = el("input", { type: "text", maxlength: "16", value: BOT_SUGGEST[n % BOT_SUGGEST.length], "aria-label": "Nome del bot" });
  const close = () => closeSheet(bg);
  const ok = () => {
    const name = input.value.replace(/\s+/g, " ").trim().slice(0, 16) || BOT_SUGGEST[n % BOT_SUGGEST.length];
    close();
    onOk(name);
  };
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg && downTarget === bg) close(); } },
    el("div", { class: "sheet card-form" },
      el("p", { class: "label" }, "Nome del bot"),
      el("div", { class: "nrow" }, input),
      el("p", { class: "hidden-msg" }, "Scegli un nome di fantasia."),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "ghost", onclick: close }, "Annulla"),
        el("button", { type: "button", class: "primary", onclick: ok }, "Aggiungi bot"))));
  document.body.append(bg);
  input.focus();   // niente select(): la selezione farebbe comparire le maniglie verdi del sistema
}
let viewer = null;      // chi sta guardando lo schermo in questo momento
let lastViewer = null;
let lastActKey = null;
let countedSeq = -1;    // partita locale già contata nelle statistiche   // ultimo turno in cui questo telefono doveva agire (online), per suonare una volta sola
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
let jollyDraft = "";                  // testo scritto a mano sul jolly, mentre lo si compone sulla carta nera
let mem = null;                       // Memory del Re: tessere, carte aperte, round a cui appartiene
const MEMORY_IMGS = /*MEMORY_IMGS*/[];
const PROFILE_IMGS = /*PROFILE_IMGS*/[];   // gli stessi personaggi senza sfondo, per la carta profilo
const JOLLY_IMG = "/*JOLLY_IMG*/";   // carta jolly in mano
const MEMORY_HUE = [0, 30, -25, 45, -40, 20, -15, 60];   // una tonalità diversa per ogni coppia
let wordsShown = 0;                  // quante parole sono già comparse sulla carta nera (non si ripetono)
let scrolledSel = null;
let comboScroll = null;               // posizione della fila combinazioni prima di un aggiornamento              // combinazione già portata in vista nella fila
let stripShown = -1;                 // ultima combinazione già comparsa nella fila
let shrinkGhost = null;             // copia della carta vincente in volo: si toglie se si salta la pausa
let online = null;      // partita online: { code, you, state, offline, winScore } oppure null

// Icona impostazioni: una carta nera con lo spazio da riempire, come nel gioco.
// Un disegno SVG scritto come testo diventa un nodo (el() mette innerHTML come attributo, non come contenuto).
const svgNode = (html) => { if (!html) return null; const t = document.createElement("span"); t.innerHTML = html; return t.firstElementChild; };
const settingsIcon = () => { const t = document.createElement("span"); t.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="4" y="2.5" width="16" height="19" rx="2.5" fill="currentColor"/><path d="M8 14.5h8" stroke="var(--bg)" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="7" r="1.2" fill="var(--bg)"/></svg>'; return t.firstElementChild; };
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
  root.style.setProperty("--ts", "1");   // il testo non si regola a mano: segue la grandezza della carta
  root.style.setProperty("--cs", settings.cardScale);
  root.style.setProperty("--card-font", FONTS[settings.font].css);
  if (settings.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);
  document.body.classList.toggle("no-motion", !settings.motion);
  document.body.classList.toggle("motion-on", settings.motion);
  Sound.setSfx(settings.sfx);
  Sound.setUiSounds(settings.uiSfx);
  Sound.setSfxVolume(settings.sfxVol);
  Sound.setHaptics(settings.vibration);
  Sound.setVolume(settings.musicVol);
  // La musica parte già all'avvio; il browser può bloccarla finché non c'è un tocco, e il primo tocco la riattiva.
  Sound.setMusic(settings.music);
}

// Aggiornamento dal repository: legge l'ultima release e offre la nuova APK.
const APP_VERSION = "0.2.46";
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
  const close = () => { closeSheet(bg); };
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
      toggle("uiSfx", "Suoni d'interfaccia (tocchi e digitazione)"),
      slider("sfxVol", "Volume effetti", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      toggle("vibration", "Vibrazione")),
    el("div", { class: "group" }, el("span", { class: "label" }, "Movimento"),
      toggle("motion", "Animazioni")),
    el("div", { class: "group" }, el("span", { class: "label" }, `Aggiornamenti · versione ${APP_VERSION}`),
      updateBox()),
    el("button", { type: "button", class: "ghost", onclick: () => { settings = { ...DEFAULT_SETTINGS }; saveSettings(); applySettings(); rebuild(); } }, "Ripristina predefiniti"),
  ];

  const sheet = el("div", { class: "sheet", role: "dialog", "aria-label": "Impostazioni" }, buildSheetContent());
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg && downTarget === bg) close(); } }, sheet);
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
  localGameSeq++;
  still("setup:" + homeTab);
  Sound.setTheme("menu");
  document.body.classList.remove("in-game");
  clearTimeout(botTimer); clearTimeout(judgeTimer); clearTimeout(roundTimer); roundTimer = null;
  if (homeTab === "local") return showLocal();
  if (homeTab === "online") return showOnline();
  return showHome();
}

// Nomi lunghi (fino a 16 lettere) nelle schermate a tutta larghezza: il corpo si riduce, così il nome non esce dallo schermo.
/** @param {string} name */
function nameFit(name) {
  return `font-size:${Math.min(1, 10 / Math.max(1, String(name).length)).toFixed(2)}em`;
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

// Movimento delle carte della home. Stesso gesto per entrare e uscire: le carte "si distribuiscono" dal basso.
const motionOn = () => !document.body.classList.contains("no-motion");
let leavingHome = false;
// Tocco su una carta: quella scelta si ingrandisce, le altre scivolano giù e svaniscono, poi cambia schermata.
function leaveHome(tapped, next) {
  if (leavingHome) return;
  if (!motionOn() || !tapped.animate) { next(); return; }
  leavingHome = true;
  tapped.animate([{ transform: "none" }, { transform: "scale(1.05) rotate(-1.2deg)" }],
    { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
  document.querySelectorAll(".hcard").forEach((c) => {
    if (c === tapped) return;
    c.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(60px) scale(.94)" }],
      { duration: 260, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" });
  });
  document.querySelector(".home-top")?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
  setTimeout(() => { leavingHome = false; next(); }, 260);
}
// Carte distribuite una dopo l'altra. Alla prima apertura aspettano che il logo sia arrivato in alto.
function dealHome(cards, delay0) {
  if (!motionOn()) return;
  cards.forEach((c, i) => c.animate([{ opacity: 0, transform: "translateY(54px) scale(.94)" }, { opacity: 1, transform: "none" }],
    { duration: 520, delay: delay0 + i * 110, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }));
}

// Profilo: avatar scelto tra le carte del Memory e statistiche di questo telefono.
const PROFILE_KEY = "cah-profile";
const EMPTY_PROFILE = { name: "", avatar: 0, games: 0, wins: 0, rounds: 0, jolly: 0 };
function loadProfile() {
  try { return { ...EMPTY_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") }; } catch { return { ...EMPTY_PROFILE }; }
}
function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* memoria del browser non disponibile */ }
}
function bumpStat(key) { const p = loadProfile(); p[key] = (p[key] || 0) + 1; saveProfile(p); }
// Colore medio dell'immagine: la carta profilo prende quella tinta, così l'immagine si fonde con lo sfondo.
function tintFrom(img, card) {
  try {
    // Colore più frequente dell'illustrazione: è lo sfondo, il personaggio e la cornice contano poco.
    const N = 64;
    const c = document.createElement("canvas");
    c.width = N; c.height = N;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N).data;
    const bins = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3);
      bins.set(k, (bins.get(k) || 0) + 1);
    }
    let best = 0, key = 0;
    for (const [k, v] of bins) if (v > best) { best = v; key = k; }
    const r = Math.floor(key / 1024) * 8 + 4, g = Math.floor((key % 1024) / 32) * 8 + 4, b = (key % 32) * 8 + 4;
    card.style.setProperty("--tint", `rgb(${r}, ${g}, ${b})`);
  } catch { /* immagine non leggibile: resta il colore di base */ }
}
function statCard(p) {
  const nums = [["Partite", p.games], ["Vittorie", p.wins], ["Round", p.rounds], ["Memory", p.jolly]];
  const img = PROFILE_IMGS[p.avatar] ? el("img", { class: "hc-avatar", src: PROFILE_IMGS[p.avatar], alt: "", draggable: "false" }) : null;
  const card = el("button", { type: "button", class: "hcard hc-stats", "aria-label": "Profilo e statistiche", onclick: openProfile },
    img ? el("span", { class: "hc-art" }, img) : null,
    el("span", { class: "hc-title display" }, p.name || "Il tuo nome"),
    el("span", { class: "hc-nums" }, nums.map(([l, v]) => el("span", { class: "hc-num" }, el("span", { class: "n" }, String(v)), el("span", { class: "l" }, l)))));
  // Il colore della carta viene dallo sfondo dell'illustrazione originale (quella con la cornice, senza ritagli).
  if (MEMORY_IMGS[p.avatar]) {
    const src = new Image();
    src.onload = () => tintFrom(src, card);
    src.src = MEMORY_IMGS[p.avatar];
  }
  return card;
}
function openProfile() {
  let bg;
  const close = () => { closeSheet(bg); setTimeout(() => document.querySelector(".hc-stats")?.replaceWith(statCard(loadProfile())), 180); };
  const p = loadProfile();
  // Nome: si aggiorna mentre si scrive; sulla carta compare alla chiusura del foglio.
  const name = el("input", { type: "text", maxlength: "16", value: p.name || "", placeholder: "Il tuo nome", "aria-label": "Il tuo nome",
    oninput: (e) => saveProfile({ ...loadProfile(), name: e.target.value.replace(/\s+/g, " ").trim() }) });
  // Avatar: si scorrono le carte del Memory con le frecce, senza elenchi.
  const pv = el("img", { class: "prof-img", src: PROFILE_IMGS[p.avatar], alt: "", draggable: "false" });
  const step = (d) => () => {
    const q = loadProfile();
    const n = PROFILE_IMGS.length;
    const a = (q.avatar + d + n) % n;
    saveProfile({ ...q, avatar: a });
    pv.src = PROFILE_IMGS[a];
  };
  const stepper = el("div", { class: "prof-av" },
    el("button", { type: "button", class: "ghost round", "aria-label": "Avatar precedente", onclick: step(-1) }, "‹"),
    pv,
    el("button", { type: "button", class: "ghost round", "aria-label": "Avatar successivo", onclick: step(1) }, "›"));
  const reset = () => askConfirm("Azzerare le statistiche di questo telefono?", () => { saveProfile({ ...loadProfile(), games: 0, wins: 0, rounds: 0, jolly: 0 }); close(); });
  const rows = [["Partite giocate", p.games], ["Partite vinte", p.wins], ["Round vinti", p.rounds], ["Memory vinti", p.jolly]]
    .map(([l, v]) => el("div", { class: "srow" }, el("span", {}, l), el("strong", {}, String(v))));
  bg = openSheet({
    title: "Il tuo profilo",
    body: [
      el("span", { class: "label" }, "Nome"), name,
      el("span", { class: "label" }, "Avatar"), stepper,
      el("span", { class: "label" }, "Statistiche"), el("div", { class: "slist" }, rows),
      el("p", { class: "hidden-msg" }, "Contano solo le partite locali giocate su questo telefono."),
      el("div", { class: "actions" }, el("button", { type: "button", class: "ghost", onclick: reset }, "Azzera statistiche")),
    ],
    actions: [primaryBtn("Chiudi", close)],
  });
}

function showHome() {
  const first = !introDone;
  // Tre carte del gioco: la nera per la modalità principale, le altre due affiancate sotto.
  const card = (kind, title, sub, go) => el("button", { type: "button", class: `hcard ${kind}`,
    onclick: (e) => leaveHome(e.currentTarget, go) },
    el("span", { class: "hc-ico", "aria-hidden": "true" }, svgNode(HOME_ICONS[kind])),
    el("span", { class: "hc-title display" }, title),
    el("span", { class: "hc-sub" }, sub),
    el("span", { class: "hc-arr", "aria-hidden": "true" }, "→"));
  const top = wordmarkNode("hdr-logo");
  app.replaceChildren(el("section", { class: "home" },
    el("div", { class: "home-top" }, top,
      el("button", { type: "button", class: "home-settings", "aria-label": "Impostazioni", title: "Impostazioni", onclick: openSettings }, settingsIcon())),
    el("nav", { class: "hand", "aria-label": "Menu" },
      card("hc-black", "Locale", el("span", {}, "Con amici e bot, ", el("span", { class: "blank" }), " un telefono solo."), () => { homeTab = "local"; setup(); }),
      statCard(loadProfile()),
      card("hc-white", "Online", "Stanza con codice, fino a 10.", () => { homeTab = "online"; setup(); }),
      card("hc-accent", "Le carte", "Carte, categorie e pacchetti.", () => cardsScreen()))));
  dealHome([...app.querySelectorAll(".hcard")], first ? 1950 : 0);
  if (first) requestAnimationFrame(() => playIntro(top));
}

// Disegni delle carte della home (tratto, colore del testo della carta): telefono che passa di mano, mondo, carte in pila.
const HOME_ICON_ATTRS = 'viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
const HOME_ICONS = {
  "hc-black": `<svg ${HOME_ICON_ATTRS}><rect x="15" y="6" width="18" height="32" rx="4"/><path d="M21 11h6"/><circle cx="24" cy="33" r="1.4" fill="currentColor" stroke="none"/><path d="M8 18c-2.4 3.4-2.4 7.6 0 11M40 18c2.4 3.4 2.4 7.6 0 11M4 15c-3.6 5-3.6 12 0 17M44 15c3.6 5 3.6 12 0 17"/></svg>`,
  "hc-white": `<svg ${HOME_ICON_ATTRS}><circle cx="24" cy="24" r="16"/><ellipse cx="24" cy="24" rx="7" ry="16"/><path d="M8 24h32M10 15h28M10 33h28"/></svg>`,
  // Due carte piene, come nel gioco: dietro la nera, davanti la bianca. Colori fissi (le carte sono sempre bianche o nere).
  "hc-accent": `<svg ${HOME_ICON_ATTRS}><g transform="rotate(-13 16 28)"><rect x="4" y="9" width="24" height="33" rx="4.5" fill="#111" stroke="#fbf8f0" stroke-width="1.8"/><path d="M10 33h12" stroke="#fbf8f0" stroke-width="2.4"/></g><g transform="rotate(9 31 25)"><rect x="18" y="7" width="24" height="33" rx="4.5" fill="#fff" stroke="#111" stroke-width="2.4"/><path d="M23.5 16h13M23.5 22h13M23.5 28h7" stroke="#111" stroke-width="2.4"/></g></svg>`,
};

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

  const refresh = () => {
    const total = cfg.names.length + cfg.bots.length;
    const ok = total >= 3;
    startBtn.disabled = !ok || !!deckProblem();
    hint.textContent = ok
      ? `${total} giocatori${cfg.bots.length ? ` (${cfg.bots.length} bot)` : ""} · vittoria a ${cfg.winScore} punti`
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
  const deckBox = deckPicker(() => refresh());

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
    el("span", { class: "label" }, "Carte · quali mazzi entrano"),
    deckBox,
    hint,
    startBtn);
}

function start() {
  unlocked = true;
  applySettings();
  const names = cfg.names.map((n, i) => (n || "").trim().slice(0, 16) || `Giocatore ${i + 1}`);
  const bots = cfg.bots.map((n, i) => ({ id: `b${i}`, name: n.trim() || BOT_SUGGEST[i % BOT_SUGGEST.length], isBot: true }));
  const players = [...names.map((name, i) => ({ id: `h${i}`, name })), ...bots];
  // Mazzo base spento e mazzi personali senza carte nere (o bianche): la partita non può partire.
  const deck = deckFor();
  if (!deck.black.length || !deck.white.length) {
    Sound.play("error");
    toast(!deck.black.length
      ? "I mazzi scelti non hanno carte nere: attiva il mazzo base o aggiungi una carta nera."
      : "I mazzi scelti non hanno carte bianche: attiva il mazzo base o aggiungi delle carte bianche.");
    return;
  }
  localGameSeq++;
  botsScheduled = null;
  game = new Game(players, deck, { winScore: cfg.winScore, pool: localPool, jolly: false });   // il jolly (e il Memory del Re) esiste solo online
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
// Loghi di categoria: stesso tratto per tutti (24 x 24, 2 px, colore del testo). Bianche: persona, luogo, scatola, fulmine, fumetto.
// Nere: una carta con 1, 2 o 3 spazi da riempire.
const CAT_ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const slotsIcon = (lines) => `<rect x="5" y="2.8" width="14" height="18.4" rx="2.6"/><path d="${lines}"/>`;
const CAT_ICONS = {
  "Soggetti": '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.5c.6-4.2 3.4-6.6 7.2-6.6s6.6 2.4 7.2 6.6"/>',
  "Luoghi": '<path d="M12 21.5S5.5 15.8 5.5 10a6.5 6.5 0 0 1 13 0c0 5.8-6.5 11.5-6.5 11.5z"/><circle cx="12" cy="10" r="2.5"/>',
  "Oggetti": '<path d="M12 2.8l8.2 4.3v9.8L12 21.2l-8.2-4.3V7.1z"/><path d="M3.8 7.1L12 11.4l8.2-4.3M12 11.4v9.8"/>',
  "Azioni": '<path d="M13.2 2.5L5 13.3h6.2l-.8 8.2L19 10.4h-6.1z"/>',
  "Situazioni": '<path d="M4 5.5h16v11h-8.8l-4.7 4v-4H4z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" stroke-width="2.6"/>',
  "1 risposta": slotsIcon("M8.5 12h7"),
  "2 risposte": slotsIcon("M8.5 9.5h7M8.5 15h7"),
  "3 risposte": slotsIcon("M8.5 8h7M8.5 12h7M8.5 16h7"),
  "altro": '<path d="M3.5 12.5v-8h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.2"/>',
};
/** Logo di una categoria come nodo SVG. @param {string} name @param {string} [cls] */
function catIcon(name, cls = "cat-ico") {
  const n = svgNode(`<svg ${CAT_ICON_ATTRS}>${CAT_ICONS[name] ?? CAT_ICONS["altro"]}</svg>`);
  n.setAttribute("class", cls);
  return n;
}
// Una carta nera sta nella categoria del suo numero di spazi: non si sceglie a mano.
const blackCatFor = (text) => BLACK_CATS[Math.min(3, Math.max(1, String(text).split("____").length - 1)) - 1];
const ORIG_COLOR = "#9a9186";
let cardsView = { tab: "white", cat: "Tutte", deck: null, q: "" };
const BASE_ID = "base";

const catsOf = (color) => (color === "b" ? BLACK_CATS : WHITE_CATS);
const validCat = (name, color) => catsOf(color).includes(name);
const defaultCat = (color) => (color === "b" ? BLACK_CATS[0] : WHITE_CATS[WHITE_CATS.length - 1]);

// Spazio da riempire: due o più trattini bassi. Nelle carte si scrive sempre "____".
const hasBlank = (t) => /_{2,}/.test(t);
const normBlanks = (t) => t.replace(/_{2,}/g, "____");
function loadCustom() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "null"); } catch { d = null; }
  d = d && typeof d === "object" ? d : {};
  // Mazzi personali. "senza" è il contenitore delle carte che non hanno ancora un mazzo.
  const decks = (Array.isArray(d.decks) ? d.decks : [])
    .filter((x) => x && typeof x.id === "string" && x.id !== BASE_ID && x.id.length <= 40)
    .map((x) => ({ id: x.id, name: String(x.name || "Mazzo").replace(/\s+/g, " ").trim().slice(0, 30) || "Mazzo", use: x.use !== false }));
  if (!decks.some((x) => x.id === "senza")) decks.unshift({ id: "senza", name: "Senza mazzo", use: true });
  const ids = new Set([BASE_ID, ...decks.map((x) => x.id)]);   // anche il mazzo base può avere carte aggiunte a mano
  // Una carta bianca con lo spazio ____ è in realtà una nera (es. scritta o importata nel tipo sbagliato): passa tra le nere.
  const rawWhite = Array.isArray(d.white) ? d.white : [];
  const rawBlack = Array.isArray(d.black) ? d.black : [];
  const misplaced = rawWhite.filter((c) => c && typeof c.text === "string" && hasBlank(c.text));
  if (misplaced.length) {
    const known = new Set(rawBlack.map((c) => c && normBlanks(String(c.text))));
    d.white = rawWhite.filter((c) => !misplaced.includes(c));
    d.black = [...rawBlack, ...misplaced.filter((c) => !known.has(normBlanks(c.text))).map((c) => ({ ...c, text: normBlanks(c.text) }))];
  }
  const fix = (list, color) => (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c.text === "string" && c.text.trim())
    .map((c) => ({
      text: c.text,
      cat: color === "b" ? blackCatFor(c.text) : (validCat(c.cat, color) ? c.cat : defaultCat(color)),
      deck: ids.has(c.deck) ? c.deck : "senza",
    }));
  const catOverride = {};
  if (d.catOverride && typeof d.catOverride === "object") {
    for (const [id, cat] of Object.entries(d.catOverride)) if (!id.startsWith("b") && validCat(cat, "w")) catOverride[id] = cat;
  }
  const textOverride = {};
  if (d.textOverride && typeof d.textOverride === "object") {
    for (const [id, t] of Object.entries(d.textOverride)) {
      if (typeof t !== "string" || !t.trim()) continue;
      if (!id.startsWith("b") && hasBlank(t)) continue;   // una bianca ufficiale non può avere lo spazio ____
      textOverride[id] = t.replace(/\s+/g, " ").trim().slice(0, 200);
    }
  }
  const hidden = {};
  if (d.hidden && typeof d.hidden === "object") for (const [id, v] of Object.entries(d.hidden)) if (v === true) hidden[id] = true;
  const out = {
    hidden,
    textOverride,
    white: fix(d.white, "w"),
    black: fix(d.black, "b"),
    decks,
    baseUse: d.baseUse !== false,   // il mazzo base (carte ufficiali) entra nelle partite
    catOverride,
  };
  if (misplaced.length) saveCustom(out);   // la correzione resta: alla prossima apertura è già a posto
  return out;
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

// Le carte personali dei mazzi attivi (quelli con l'interruttore acceso).
const activeCustom = () => {
  const d = loadCustom();
  const on = new Set(d.decks.filter((x) => x.use).map((x) => x.id));
  if (d.baseUse) on.add(BASE_ID);   // le carte aggiunte al mazzo base seguono il suo interruttore
  return { white: d.white.filter((c) => on.has(c.deck)), black: d.black.filter((c) => on.has(c.deck)) };
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
const deckFor = () => {
  const d = loadCustom();
  const base = d.baseUse ? withOverrides(CARDS) : { white: [], black: [] };
  return mergeCustom(base, activeCustom());
};

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
    ...d.white.map((c, i) => ({ id: `m${i}`, idx: i, text: c.text, color: "w", cat: c.cat, deck: c.deck, mine: true })),
    ...d.black.map((c, i) => ({ id: `mb${i}`, idx: i, text: c.text, color: "b", cat: c.cat, deck: c.deck, mine: true })),
  ];
  return { orig, mine, d };
}

// Un'unica schermata: carte, categorie, interruttori per le proprie carte, pacchetti.
// Griglia delle carte: 2, 4 o 6 colonne. Due dita che si avvicinano aumentano le colonne, che si allontanano le riducono.
// Griglia delle carte: sempre due colonne. Niente zoom né cambio di colonne con le dita.
const GRID_COLS = 2;
function gridNode(children) {
  const node = el("div", { class: "cgrid", style: `--cols:${GRID_COLS};--k:${2 / GRID_COLS}` }, children);
  requestAnimationFrame(() => fitText(node)); // il testo si adatta alla densità scelta
  return node;
}

// Elenco dei mazzi: il mazzo base (carte ufficiali) e quelli personali.
function decksList() {
  const d = loadCustom();
  return [{ id: BASE_ID, name: "Base", official: true, use: d.baseUse }, ...d.decks.map((x) => ({ ...x, official: false }))];
}

// Le carte di un mazzo. Il base ha le ufficiali (con le tue modifiche) e quelle che gli hai aggiunto.
function deckPool(dk, orig, mine) {
  return dk.official ? [...orig, ...mine.filter((c) => c.deck === BASE_ID)] : mine.filter((c) => c.deck === dk.id);
}

// Interruttore di un mazzo: entra o no nelle partite.
function toggleDeck(id, refresh) {
  const x = loadCustom();
  if (id === BASE_ID) x.baseUse = !x.baseUse;
  else { const k = x.decks.find((y) => y.id === id); if (k) k.use = !k.use; }
  saveCustom(x);
  refresh();
}

// Quante carte entrano in partita con i mazzi accesi (conta solo quelle che esistono davvero: niente nascoste).
function deckTotals() {
  const { orig, mine } = allCards();
  const t = { decks: 0, w: 0, b: 0 };
  for (const dk of decksList()) {
    if (!dk.use) continue;
    t.decks++;
    for (const c of deckPool(dk, orig, mine)) c.color === "w" ? t.w++ : t.b++;
  }
  return t;
}
/** Perché con questi mazzi la partita non può partire (oppure null). */
function deckProblem(t = deckTotals()) {
  if (!t.decks) return "Scegli almeno un mazzo.";
  if (!t.b) return "I mazzi scelti non hanno carte nere: accendi il mazzo Base o aggiungi una carta nera.";
  if (!t.w) return "I mazzi scelti non hanno carte bianche: accendi il mazzo Base o aggiungi delle carte bianche.";
  return null;
}

// Scelta dei mazzi della partita, in locale e online: una tessera per mazzo, con la pila di carte, i conteggi e la spunta.
// Un tocco accende o spegne il mazzo; la tessera cambia sul posto, senza ridisegnare la schermata.
/** @param {() => void} [onChange] chiamata dopo ogni tocco, a conteggi aggiornati */
function deckPicker(onChange) {
  const { orig, mine } = allCards();
  const rows = decksList().map((dk) => {
    const cs = deckPool(dk, orig, mine);
    return { id: dk.id, dk, w: cs.filter((c) => c.color === "w").length, b: cs.filter((c) => c.color === "b").length };
  });
  const sum = el("p", { class: "dpk-sum", role: "status" });
  const tiles = rows.map((r) => el("button", { type: "button", class: "dpk" + (r.dk.official ? " base" : ""), "aria-pressed": String(r.dk.use),
    onclick: () => { toggleDeck(r.id, sync); Sound.play("flip"); } },
    el("span", { class: "dpk-stack", "aria-hidden": "true" },
      el("i", { class: "k" }), el("i", { class: "w2" }),
      el("i", { class: "w1" }, el("b", {}, (r.dk.name.trim().charAt(0) || "?").toUpperCase()))),
    el("span", { class: "dpk-tick", "aria-hidden": "true" }, "✓"),
    el("span", { class: "dpk-name display" }, r.dk.name),
    el("span", { class: "dpk-count" }, r.w + r.b ? `${r.w} bianche · ${r.b} nere` : "Mazzo vuoto")));
  function sync() {
    const now = decksList();
    tiles.forEach((btn, i) => {
      const on = !!now.find((x) => x.id === rows[i].id)?.use;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    const t = deckTotals();
    const problem = deckProblem(t);
    sum.classList.toggle("bad", !!problem);
    sum.textContent = problem ?? `In partita: ${t.decks} ${t.decks === 1 ? "mazzo" : "mazzi"} · ${t.w} bianche · ${t.b} nere`;
    if (onChange) onChange();
  }
  const box = el("div", { class: "deckpick", role: "group", "aria-label": "Mazzi della partita" }, el("div", { class: "dpk-grid" }, tiles), sum);
  tiles.forEach((btn, i) => btn.classList.toggle("on", !!rows[i].dk.use));
  const t0 = deckTotals();
  const p0 = deckProblem(t0);
  sum.classList.toggle("bad", !!p0);
  sum.textContent = p0 ?? `In partita: ${t0.decks} ${t0.decks === 1 ? "mazzo" : "mazzi"} · ${t0.w} bianche · ${t0.b} nere`;
  return box;
}

// Nuovo mazzo o rinomina: piccolo foglio con il nome.
function openDeckForm(current, done) {
  const input = el("input", { type: "text", maxlength: "30", placeholder: "Nome del mazzo, es. Politica", "aria-label": "Nome del mazzo" });
  input.value = current ? current.name : "";
  let bg;
  const close = () => closeSheet(bg);
  const save = () => {
    const name = input.value.replace(/\s+/g, " ").trim().slice(0, 30);
    if (!name) { toast("Scrivi un nome"); return; }
    const x = loadCustom();
    let id = current ? current.id : null;
    if (current) { const k = x.decks.find((y) => y.id === current.id); if (k) k.name = name; }
    else { id = `m${Date.now().toString(36)}`; x.decks.push({ id, name, use: true }); }
    saveCustom(x);
    close();
    done(id);
  };
  bg = openSheet({ title: current ? "Rinomina mazzo" : "Nuovo mazzo", body: [input], actions: [cancelBtn(close), primaryBtn("Salva", save)] });
  input.focus({ preventScroll: true });
}

// Menu di un mazzo: tutte le azioni sul mazzo stanno qui, non in fondo alla pagina.
function deckMenu(dk, deckId) {
  const x = loadCustom();
  const hidden = Object.keys(x.hidden).length;
  const removable = !dk.official && dk.id !== "senza";
  openMenu(dk.name, [
    !dk.official ? { label: "Rinomina", run: () => openDeckForm(dk, () => cardsScreen({ keep: true })) } : null,
    { label: "Condividi o importa", run: () => openPackSheet(dk, deckId) },
    dk.official && hidden ? { label: `Ripristina ${hidden} carte eliminate`, run: () => { const y = loadCustom(); y.hidden = {}; saveCustom(y); cardsScreen(); } } : null,
    removable ? { label: "Elimina mazzo", danger: true, run: () => deleteDeck(dk) } : null,
  ]);
}

// ---- Passare un mazzo a un altro telefono con un codice breve: niente file, niente messaggi troppo lunghi.
// Il mazzo si carica su Firebase (decks/<codice>) e dura 14 giorni; l'altro telefono scrive il codice e lo riceve.
const DECK_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DECK_CODE_LEN = 6;
const DECK_SHARE_DAYS = 14;
const DECK_SHARE_MAX = 1500;
const SENT_KEY = "cah-decks-sent";
// Oltre questa lunghezza un messaggio di testo rischia di essere tagliato o rifiutato.
const LONG_TEXT = 3500;

const withTimeout = (p, ms = NET_TIMEOUT_MS) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("La rete non risponde. Riprova.")), ms))]);
const shareError = (e) => /permission|denied/i.test(String(e?.code ?? e?.message ?? ""))
  ? "Il servizio dei codici non è attivo. Copia le frasi qui sotto, oppure riprova più tardi."
  : String(e?.message || "Qualcosa è andato storto. Riprova.");
const sentDecks = () => {
  try { const a = JSON.parse(localStorage.getItem(SENT_KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => x && typeof x.code === "string") : []; } catch { return []; }
};
const saveSent = (a) => { try { localStorage.setItem(SENT_KEY, JSON.stringify(a.slice(-30))); } catch { /* niente storage: si perde solo la pulizia */ } };

/** Le carte di un mazzo come si mandano: testo pulito, e la categoria per le bianche. */
function packOf(dk) {
  const { orig, mine } = allCards();
  const cards = deckPool(dk, orig, mine);
  return {
    name: dk.name,
    white: cards.filter((c) => c.color === "w").map((c) => [c.text, c.cat]),
    black: cards.filter((c) => c.color === "b").map((c) => c.text),
  };
}

/** Carica il mazzo e restituisce il codice. @param {{name: string, white: any[], black: any[]}} pack */
async function sendDeckCode(pack) {
  initNet();
  if (!fbDb) throw new Error("Serve la rete: il servizio non è disponibile su questo telefono.");
  const total = pack.white.length + pack.black.length;
  if (!total) throw new Error("Il mazzo è vuoto.");
  if (total > DECK_SHARE_MAX) throw new Error(`Troppe carte (${total}): ne entrano al massimo ${DECK_SHARE_MAX}.`);
  // I codici miei più vecchi di 14 giorni si tolgono ora: nessun altro li può più usare.
  const keep = [];
  for (const x of sentDecks()) {
    if (Date.now() - x.t > DECK_SHARE_DAYS * 864e5) fbDb.ref(`decks/${x.code}`).remove().catch(() => {});
    else keep.push(x);
  }
  let code = "";
  for (let tries = 0; tries < 8; tries++) {
    code = Array.from({ length: DECK_CODE_LEN }, () => DECK_CODE_CHARS[Math.floor(Math.random() * DECK_CODE_CHARS.length)]).join("");
    const snap = await withTimeout(fbDb.ref(`decks/${code}`).once("value"));
    if (!snap.exists()) break;
  }
  await withTimeout(fbDb.ref(`decks/${code}`).set({ v: 1, created: Date.now(), name: pack.name, white: pack.white, black: pack.black }));
  saveSent([...keep, { code, t: Date.now() }]);
  return code;
}

/** Toglie il mazzo dal servizio: il codice smette di funzionare. */
async function retractDeckCode(code) {
  initNet();
  if (fbDb) await withTimeout(fbDb.ref(`decks/${code}`).remove());
  saveSent(sentDecks().filter((x) => x.code !== code));
}

/** Scarica il mazzo del codice e lo salva come mazzo nuovo. @returns {Promise<{id: string, name: string, w: number, b: number}>} */
async function receiveDeck(raw) {
  const code = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== DECK_CODE_LEN) throw new Error(`Il codice ha ${DECK_CODE_LEN} caratteri.`);
  initNet();
  if (!fbDb) throw new Error("Serve la rete: il servizio non è disponibile su questo telefono.");
  const v = (await withTimeout(fbDb.ref(`decks/${code}`).once("value"))).val();
  if (!v || typeof v !== "object") throw new Error("Codice non trovato. Controlla di averlo scritto giusto.");
  if (Date.now() - Number(v.created || 0) > DECK_SHARE_DAYS * 864e5) throw new Error("Codice scaduto: chiedi di crearne uno nuovo.");
  const list = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);
  const x = loadCustom();
  const name = String(v.name || "").replace(/\s+/g, " ").trim().slice(0, 30) || "Mazzo ricevuto";
  const id = `m${Date.now().toString(36)}`;
  const seen = new Set();
  let w = 0, b = 0;
  const add = (text0, cat0, wantBlack) => {
    const text = normBlanks(String(text0 ?? "").replace(/\s+/g, " ").trim().slice(0, 200));
    if (!text || seen.has(text.toLowerCase()) || w + b >= DECK_SHARE_MAX) return;
    if (wantBlack || hasBlank(text)) {
      const t = text.includes("____") ? text : `${text} ____`;
      if (t.split("____").length - 1 > 3) return;
      seen.add(text.toLowerCase());
      x.black.push({ text: t, cat: blackCatFor(t), deck: id });
      b++;
    } else {
      seen.add(text.toLowerCase());
      x.white.push({ text, cat: validCat(cat0, "w") ? cat0 : defaultCat("w"), deck: id });
      w++;
    }
  };
  for (const c of list(v.white)) add(Array.isArray(c) ? c[0] : c?.text, Array.isArray(c) ? c[1] : c?.cat, false);
  for (const c of list(v.black)) add(Array.isArray(c) ? c[0] : c?.text ?? c, null, true);
  if (!w && !b) throw new Error("Il mazzo ricevuto è vuoto.");
  x.decks.push({ id, name, use: true });
  saveCustom(x);
  return { id, name, w, b };
}

async function copyText(text, okMsg, field = null) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return; } catch { /* ripiego sotto */ }
  const box = field ?? el("textarea", { readonly: "", style: "position:fixed;opacity:0;pointer-events:none" });
  if (!field) { box.value = text; document.body.append(box); }
  box.focus(); box.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  if (!field) box.remove();
  toast(ok ? okMsg : "Tieni premuto sul testo, poi copia");
}

// "Ricevi mazzo": si scrive il codice, il mazzo arriva come mazzo nuovo.
function openReceiveSheet() {
  let bg;
  const close = () => closeSheet(bg);
  const input = el("input", { type: "text", class: "code-input", maxlength: "10", autocapitalize: "characters", autocomplete: "off",
    spellcheck: "false", inputmode: "text", placeholder: "K7M2QX", "aria-label": "Codice del mazzo" });
  const msg = el("p", { class: "hidden-msg", role: "status" }, "Scrivi il codice di 6 caratteri che ti hanno mandato.");
  const go = el("button", { type: "button", class: "primary" }, "Ricevi il mazzo");
  const run = async () => {
    go.disabled = true; go.textContent = "Cerco il mazzo…"; msg.classList.remove("err");
    try {
      const r = await receiveDeck(input.value);
      close();
      cardsView.deck = r.id; cardsView.tab = "white"; cardsView.cat = "Tutte"; cardsView.q = "";
      Sound.play("saved");
      toast(`Mazzo «${r.name}» ricevuto: ${r.w} bianche, ${r.b} nere`);
      cardsScreen();
    } catch (e) {
      msg.textContent = shareError(e); msg.classList.add("err");
      go.disabled = false; go.textContent = "Ricevi il mazzo";
    }
  };
  go.onclick = run;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  bg = openSheet({ title: "Ricevi un mazzo", body: [input, msg], actions: [cancelBtn(close), go] });
  input.focus({ preventScroll: true });
}

// Condividi o importa. Per un altro telefono: un codice. Per il testo: una frase per riga (con ____ per la nera), nei due sensi.
function openPackSheet(dk, deckId) {
  let bg;
  const close = () => closeSheet(bg);
  const packText = () => {
    const p = packOf(dk);
    return [...p.white.map((c) => c[0]), ...p.black].map((t) => String(t).replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  };

  // Codice per un altro telefono.
  const codeArea = el("div", { class: "code-area" });
  const retract = async (code) => {
    try { await retractDeckCode(code); toast("Codice ritirato"); showStart(); } catch (e) { toast(shareError(e)); }
  };
  const showCode = (code) => codeArea.replaceChildren(
    el("div", { class: "code-big", "aria-label": `Codice ${code.split("").join(" ")}` }, code),
    el("p", { class: "hidden-msg" }, "Mandalo con un messaggio. Sull'altro telefono: Mazzi, Ricevi mazzo. Dura 14 giorni."),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "ghost", onclick: () => retract(code) }, "Ritira il codice"),
      el("button", { type: "button", class: "primary", onclick: () => copyText(code, "Codice copiato") }, "Copia il codice")));
  const make = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true; btn.textContent = "Carico il mazzo…";
    try { showCode(await sendDeckCode(packOf(dk))); } catch (e) { showStart(shareError(e)); }
  };
  function showStart(problem = "") {
    codeArea.replaceChildren(...[
      el("p", { class: "hidden-msg" }, "Crea un codice di 6 caratteri e mandalo con un messaggio: l'altro telefono lo scrive e riceve il mazzo."),
      problem ? el("p", { class: "hidden-msg err", role: "alert" }, problem) : null,
      el("button", { type: "button", class: "primary", onclick: make }, "Crea il codice"),
    ].filter(Boolean));
  }
  showStart();

  // Testo.
  const exportBox = el("textarea", { class: "pack-text", rows: "5", readonly: "", "aria-label": "Frasi del mazzo",
    placeholder: "Nessuna carta in questo mazzo" });
  exportBox.value = packText();
  const copy = () => { if (!exportBox.value) { toast("Il mazzo è vuoto"); return; } copyText(exportBox.value, "Frasi copiate", exportBox); };
  const long = exportBox.value.length > LONG_TEXT;
  const pasteIn = el("textarea", { class: "pack-text", rows: "5", placeholder: "Una frase per riga\nCon ____ diventa una nera",
    "aria-label": "Frasi da incollare" });
  bg = openSheet({
    title: `Mazzo ${dk.name}`,
    body: [
      el("span", { class: "label" }, "A un altro telefono"),
      codeArea,
      el("span", { class: "label" }, "Come testo"),
      long ? el("p", { class: "hidden-msg" }, `Sono ${exportBox.value.length.toLocaleString("it-IT")} caratteri: in un messaggio rischiano di essere tagliati. Meglio il codice.`) : null,
      exportBox,
      el("div", { class: "actions" }, el("button", { type: "button", class: "ghost", onclick: copy }, "Copia le frasi")),
      el("span", { class: "label" }, "Incolla"),
      pasteIn,
      el("p", { class: "hidden-msg" }, "Una frase per riga. Con ____ diventa una nera, senza diventa una bianca."),
    ],
    actions: [cancelBtn(close), primaryBtn("Aggiungi le carte", () => { const t = pasteIn.value; close(); importPack(t, deckId); })],
  });
}

// Elimina un mazzo personale: le sue carte passano in "Senza mazzo".
function deleteDeck(dk) {
  askConfirm(`Eliminare il mazzo "${dk.name}"? Le sue carte passano in Senza mazzo.`, () => {
    const x = loadCustom();
    x.decks = x.decks.filter((y) => y.id !== dk.id);
    for (const c of [...x.white, ...x.black]) if (c.deck === dk.id) c.deck = "senza";
    saveCustom(x);
    cardsView.deck = null;
    cardsScreen();
  });
}

// ---- Fogli di gestione: un solo modello per tutti.
// Ogni foglio ha: titolo, contenuto, e in fondo "Annulla" a sinistra e l'azione principale a destra.
// I menu di carte e mazzi usano la stessa lista di azioni, con "Annulla" a tutta larghezza.
function openSheet({ title, body = [], actions = [] }) {
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg && downTarget === bg) closeSheet(bg); } },
    el("div", { class: "sheet card-form" },
      el("p", { class: "label" }, title),
      ...body,
      el("div", { class: "actions" }, ...actions)));
  document.body.append(bg);
  return bg;
}
const cancelBtn = (fn) => el("button", { type: "button", class: "ghost", onclick: fn }, "Annulla");
const primaryBtn = (label, fn) => el("button", { type: "button", class: "primary", onclick: fn }, label);
// Lista di azioni: ogni voce chiude il foglio e poi esegue l'azione.
function actionList(items, close) {
  return el("div", { class: "action-list" }, items.filter(Boolean).map((it) => el("button", {
    type: "button", class: it.danger ? "danger" : "",
    onclick: () => { close(); it.run(); },
  }, it.label)));
}
// Menu: una lista di azioni e "Annulla". Ogni voce chiude il foglio prima di agire.
function openMenu(title, items, extra = []) {
  let bg;
  const close = () => closeSheet(bg);
  bg = openSheet({ title, body: [actionList(items, close), ...extra], actions: [cancelBtn(close)] });
}

// Conferma dentro la pagina: confirm() del browser non funziona nelle anteprime.
function askConfirm(text, yes) {
  let bg;
  const close = () => closeSheet(bg);
  bg = openSheet({ title: text, actions: [cancelBtn(close), primaryBtn("Elimina", () => { close(); yes(); })] });
}

// keep: ridisegno dentro la stessa schermata (ricerca, filtri, tab): la pagina resta dov'è.
// Senza keep (apertura di un mazzo, ritorno indietro) si riparte dall'alto.
function cardsScreen(opts = {}) {
  game = null;
  still("cards");
  document.body.classList.remove("in-game");
  clearTimeout(botTimer); clearTimeout(judgeTimer); clearTimeout(roundTimer); roundTimer = null;
  if (!opts.keep) window.scrollTo(0, 0);
  // Ridisegnando la schermata il browser può spostare la pagina (il cursore nella ricerca lo fa): rimetto la posizione.
  const keepY = window.scrollY;
  const v = cardsView;
  if (!v.deck || !decksList().some((x) => x.id === v.deck)) { v.deck = null; renderDecks(); }
  else renderDeck(v.deck, !!opts.partial);
  if (opts.keep) window.scrollTo(0, keepY);
}

// Schermata dei mazzi: una anteprima per mazzo, con il conteggio e due carte di esempio.
// Una carta bianca vera del mazzo, mostrata mentre esce dalla scatola.
function sampleCard(cards) {
  const whites = cards.filter((c) => c.color === "w");
  return whites.length ? whites[Math.floor(Math.random() * whites.length)].text : "";
}

function renderDecks() {
  const v = cardsView;
  const { orig, mine } = allCards();
  // Ogni mazzo è una carta della stessa famiglia della home: il base in nero, i personali in crema.
  const tile = (dk) => {
    const cards = deckPool(dk, orig, mine);
    const nW = cards.filter((c) => c.color === "w").length;
    const nB = cards.filter((c) => c.color === "b").length;
    const go = () => { v.deck = dk.id; v.tab = "white"; v.cat = "Tutte"; v.q = ""; cardsScreen(); };
    return el("div", { class: `dk${dk.official ? " base" : ""}${dk.use ? "" : " off"}` },
      el("button", { type: "button", class: "dk-main", "aria-label": `Apri il mazzo ${dk.name}`, onclick: go },
        el("span", { class: "dk-mini", "aria-hidden": "true" }),
        el("span", { class: "dk-text" },
          el("span", { class: "dk-eyebrow" }, dk.official ? "Espansione base" : "Mazzo"),
          el("span", { class: "dk-name display" }, dk.name),
          el("span", { class: "dk-count" }, `${nW} bianche · ${nB} nere`))),
      el("button", { type: "button", class: "switch", "aria-pressed": String(dk.use),
        onclick: () => toggleDeck(dk.id, () => cardsScreen()) }, dk.use ? "In partita" : "Escluso"));
  };
  app.replaceChildren(el("section", { class: "cards-screen" },
    el("div", { class: "subhead" },
      el("button", { type: "button", class: "ghost back", onclick: () => { homeTab = "home"; setup(); } }, "← Home"),
      el("div", { class: "head-row" },
        el("h2", { class: "display" }, "Mazzi"),
        el("div", { class: "head-actions" },
          el("button", { type: "button", class: "add", onclick: openReceiveSheet }, "Ricevi mazzo"),
          el("button", { type: "button", class: "add", onclick: () => openDeckForm(null, (id) => { cardsView.deck = id; cardsScreen(); }) }, "+ Nuovo mazzo")))),
    el("p", { class: "hidden-msg" }, "Tocca un mazzo per modificarne le carte. L'interruttore decide se entra nelle partite."),
    el("div", { class: "deck-list" }, decksList().map(tile))));
}

// Dentro un mazzo. Tocco su una carta: la modifica. Tenerla premuta: la elimina (o la nasconde, per le ufficiali).
// Il pulsante + aggiunge una carta. "Opzioni" raccoglie tutto ciò che riguarda il mazzo.
function renderDeck(deckId, partial = false) {
  const v = cardsView;
  const dk = decksList().find((x) => x.id === deckId);
  const { orig, mine } = allCards();
  const pool = deckPool(dk, orig, mine);
  const color = v.tab === "black" ? "b" : "w";
  let list = pool.filter((c) => c.color === color);
  if (v.cat !== "Tutte") list = list.filter((c) => c.cat === v.cat);
  const q = (v.q ?? "").trim().toLowerCase();
  if (q) list = list.filter((c) => c.text.toLowerCase().includes(q));
  const count = (c) => pool.filter((x) => x.color === c).length;
  // Ridisegna solo l'elenco: la barra di ricerca e l'intestazione restano dove sono.
  const refresh = () => cardsScreen({ keep: true, partial: true });

  const tile = (c) => {
    const held = { v: false };
    const node = el("button", { type: "button", class: `pcard ${c.color === "w" ? "w" : "b"}`, style: `--cat:${catColor(c.cat)}`,
      onclick: () => { if (!held.v) openCardForm({ card: c, done: refresh }); } },
      el("span", { class: "cat-mark" }, catIcon(c.cat)),
      el("span", { class: "txt" }, c.text),
      el("span", { class: "tag" }, catIcon(c.cat), el("span", {}, c.cat)));
    attachHold(node, () => { held.v = true; Sound.play("flip"); cardActions(c, () => cardsScreen({ keep: true })); }, held);
    return node;
  };

  const search = el("input", { type: "search", class: "card-search", placeholder: "Cerca una carta", "aria-label": "Cerca tra le carte",
    oninput: (e) => { v.q = e.target.value; refresh(); } });
  search.value = v.q ?? "";
  const tabBtn = (id, label) => el("button", { type: "button", "aria-pressed": String(v.tab === id),
    onclick: () => { v.tab = id; v.cat = "Tutte"; refresh(); } }, label);
  const catBtn = (name) => el("button", { type: "button", class: "chip", "aria-pressed": String(v.cat === name),
    onclick: () => { v.cat = name; refresh(); } }, name === "Tutte" ? null : catIcon(name, "cat-ico chip-ico"), name);

  const shell = el("div", { class: "deck-shell", "data-deck": deckId },
    el("div", { class: "topbar" },
      el("button", { type: "button", class: "ghost", onclick: () => { v.deck = null; cardsScreen(); } }, "← Mazzi"),
      el("button", { type: "button", class: "ghost", "aria-label": "Opzioni del mazzo", onclick: () => deckMenu(dk, deckId) }, "Opzioni")),
    el("div", { class: "deck-title" },
      el("h2", { class: "display" }, dk.name),
      el("span", { class: "label" }, dk.official ? `Carte ufficiali · ${count("w")} bianche · ${count("b")} nere` : `${count("w")} bianche · ${count("b")} nere`)),
    search);

  const body = el("div", { class: "deck-body" },
    el("div", { class: "tabs", role: "group", "aria-label": "Tipo di carta" }, tabBtn("white", `Bianche`), tabBtn("black", `Nere`)),
    el("div", { class: "chips", role: "group", "aria-label": "Categorie" }, ["Tutte", ...catsOf(color)].map(catBtn)),
    list.length
      ? gridNode(list.map(tile))
      : el("p", { class: "hidden-msg" }, pool.length ? "Nessuna carta con questo filtro."
        : dk.official ? "Nessuna carta." : "Il mazzo è vuoto. Premi + per aggiungere una carta."));

  // Pulsante per aggiungere: sempre in basso a destra, come in tutte le schermate di gestione.
  const fab = el("button", { type: "button", class: "fab", "aria-label": "Nuova carta",
    onclick: () => openCardForm({ deckId, done: (c) => { v.tab = c === "b" ? "black" : "white"; v.cat = "Tutte"; v.q = ""; cardsScreen(); } }) }, "+");

  const current = /** @type {HTMLElement|null} */ (app.querySelector(".deck-shell"));
  if (partial && current && current.dataset.deck === deckId) {
    app.querySelector(".deck-body").replaceWith(body);
  } else {
    app.replaceChildren(el("section", { class: "cards-screen" }, shell, body, fab));
  }
}

// Pressione lunga su una carta: la tua si elimina; un'ufficiale si nasconde, o si ripristina se modificata.
function cardActions(c, refresh) {
  const edited = !c.mine && hasOverride(c.id);
  openMenu(c.color === "w" ? "Carta bianca" : "Carta nera", [
    c.mine
      ? { label: "Elimina", danger: true, run: () => deleteCard(c, refresh) }
      : { label: "Nascondi", danger: true, run: () => hideOfficial(c.id, refresh) },
    edited ? { label: "Ripristina l'originale", run: () => { resetOverride(c.id); refresh(); } } : null,
  ]);
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

function applyCat(c, name) {
  if (c.color !== "w" || !validCat(name, "w")) return;
  const d = loadCustom();
  if (c.mine) (c.color === "w" ? d.white : d.black)[c.idx].cat = name;
  else d.catOverride[c.id] = name;
  saveCustom(d);
}

function deleteCard(c, refresh) {
  askConfirm("Eliminare questa carta?", () => deleteCardNow(c, refresh));
}
function deleteCardNow(c, refresh) {
  const d = loadCustom();
  (c.color === "w" ? d.white : d.black).splice(c.idx, 1);
  saveCustom(d);
  refresh();
}

// Una scheda sola per carta: nuova (bianca o nera) o modifica. Nera: la categoria segue gli spazi ____.
// Bianca: si sceglie la categoria.
/** @param {{card?: any, deckId?: string, done?: (color?: string) => void}} [opts] */
function openCardForm({ card = null, deckId = "senza", done = () => {} } = {}) {
  let color = card ? card.color : "w";
  let catVal = card ? card.cat : catsOf("w")[0];
  const txt = el("textarea", { maxlength: "200", rows: "3", placeholder: "Scrivi la carta…", "aria-label": "Testo della carta" });
  if (card) txt.value = card.text;

  const catRow = el("div", { class: "card-cats", role: "group", "aria-label": "Categoria" });
  const paintCats = () => catRow.replaceChildren(...catsOf("w").map((n) => el("button", {
    type: "button", class: "chip", "aria-pressed": String(n === catVal), onclick: () => { catVal = n; paintCats(); },
  }, catIcon(n, "cat-ico chip-ico"), n)));

  // Il tipo si sceglie solo per le carte nuove: in modifica resta quello della carta.
  const colorSeg = el("div", { class: "seg", role: "group", "aria-label": "Tipo di carta", hidden: card ? "" : null });
  const paintColor = () => colorSeg.replaceChildren(...[["w", "Bianca"], ["b", "Nera"]].map(([k, label]) => el("button", {
    type: "button", class: "chip", "aria-pressed": String(color === k), onclick: () => { color = k; paintColor(); update(); },
  }, label)));

  // Suggerimenti in tempo reale (stile T9).
  const hints = el("div", { class: "spell-hints", "aria-live": "polite" });
  const catNote = el("p", { class: "hidden-msg", "aria-live": "polite" });
  const pickHint = (word) => {
    const cur = txt.value;
    const m = cur.match(/[\p{L}'-]+$/u);
    const base = m ? cur.slice(0, cur.length - m[0].length) : cur;
    const cap = m && /^\p{Lu}/u.test(m[0]) ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    txt.value = base + cap + " ";
    update();
    txt.focus({ preventScroll: true });
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
    // Una bianca con lo spazio ____ diventa nera al salvataggio: lo si dice subito, mentre si scrive.
    const black = color === "b" || (hasBlank(txt.value) && !(card && !card.mine));
    catRow.hidden = black;
    catNote.hidden = !black && !hasBlank(txt.value);
    if (!black && hasBlank(txt.value)) catNote.textContent = "Le carte bianche ufficiali non possono avere lo spazio ____.";
    if (black) {
      const text = normBlanks(txt.value.replace(/\s+/g, " ").trim());
      const withBlank = text.includes("____") ? text : `${text} ____`.trim();
      const moved = color === "w" ? "Ha lo spazio ____: sarà salvata come carta nera. " : "";
      catNote.textContent = moved + (text ? `Categoria: ${blackCatFor(withBlank)}` : "Scrivi ____ dove va la risposta, fino a 3 volte.");
    }
  };
  txt.addEventListener("input", (e) => { if (e.inputType !== "deleteContentBackward") Sound.play("key"); update(); });

  const save = () => {
    const d = loadCustom();
    let text = normBlanks(txt.value.replace(/\s+/g, " ").trim());
    if (!text) { toast("Scrivi il testo della carta"); return; }
    // Bianca con lo spazio ____: le personali diventano nere, le ufficiali non si possono salvare così.
    if (color === "w" && hasBlank(text)) {
      if (card && !card.mine) { toast("Le carte bianche non possono avere lo spazio ____: crea una carta nera."); Sound.play("error"); return; }
      color = "b";
      toast("Ha lo spazio ____: salvata come carta nera.");
    }
    if (color === "b") {
      if (!text.includes("____")) text += " ____";
      if (text.split("____").length - 1 > 3) { toast("Una carta nera può avere al massimo 3 spazi"); return; }
    }
    const cat = color === "w" ? catVal : blackCatFor(text);
    if (!card) {
      (color === "w" ? d.white : d.black).push({ text, cat, deck: deckId });
      Sound.play("saved");
    } else if (card.mine && card.color !== color) {
      // Era bianca ed è diventata nera: lascia le bianche e passa tra le nere, nello stesso mazzo.
      const [old] = d.white.splice(card.idx, 1);
      d.black.push({ text, cat, deck: old?.deck ?? deckId });
    } else if (card.mine) {
      Object.assign((card.color === "w" ? d.white : d.black)[card.idx], { text, cat });
    } else {
      // Ufficiale: si salvano solo testo e categoria; l'originale resta intatto e si può ripristinare.
      d.textOverride[card.id] = text;
      if (card.color === "w") d.catOverride[card.id] = cat;
    }
    saveCustom(d);
    closeSheet(bg);
    done(color);
  };
  const close = () => closeSheet(bg);
  paintColor();
  paintCats();
  const bg = openSheet({
    title: !card ? "Nuova carta" : card.mine ? "Modifica carta" : "Modifica carta ufficiale",
    body: [colorSeg, txt, hints, catNote, catRow],
    actions: [cancelBtn(close), primaryBtn("Salva", save)],
  });
  update();
  if (!card) txt.focus({ preventScroll: true });
}

// Testo semplice: una frase per riga. Con ____ è nera, senza è bianca.
function importLines(text, deckId = "senza") {
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
      d.black.push({ text: t, cat: blackCatFor(t), deck: deckId });
    } else {
      d.white.push({ text: t, cat: defaultCat("w"), deck: deckId });
    }
    added++;
  }
  saveCustom(d);
  toast(`Importate ${added} carte`);
  cardsScreen();
}

function importPack(text, deckId = "senza") {
  const trimmed = String(text).trim();
  if (trimmed && !trimmed.startsWith("{")) { importLines(trimmed, deckId); return; }
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
  for (const c of clean(data.white, "w")) if (!same(d.white, c)) { d.white.push({ ...c, deck: deckId }); added++; }
  for (const c of clean(data.black, "b")) {
    if (!c.text.includes("____")) c.text += " ____";
    if (c.text.split("____").length - 1 > 3 || same(d.black, c)) continue;
    d.black.push({ ...c, deck: deckId }); added++;
  }
  saveCustom(d);
  toast(`Importate ${added} carte`);
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
    scheduleLocalBots();
  } else if (game.phase === "judging" && game.judge.isBot) {
    judgeTimer = setTimeout(() => { game.advanceBotJudge(); step(); }, BOT_JUDGE_VIEW_MS);   // il Re bot sfoglia e sceglie a passi: almeno 3 secondi su ogni carta
  }
  render();
}

let botsScheduled = null;   // { round, ids }: bot già programmati per questo turno
let localGameSeq = 0;       // cambia a ogni nuova partita: i timer dei bot della partita precedente non devono più agire
function scheduleLocalBots() {
  const round = game.round;
  const seq = localGameSeq;
  if (!botsScheduled || botsScheduled.round !== round) botsScheduled = { round, ids: new Set() };
  for (const p of game.players) {
    if (!p.isBot || p.id === game.judge.id || game.submissions.has(p.id) || botsScheduled.ids.has(p.id)) continue;
    botsScheduled.ids.add(p.id);
    const delay = 1200 + Math.random() * 1300;
    setTimeout(() => {
      if (seq !== localGameSeq || !game || game.phase !== "playing" || game.round !== round || game.submissions.has(p.id)) return;
      game.autoPlay(p.id);
      step();
    }, delay);
  }
}

// Una volta per turno: la mano viene sostituita con 10 carte nuove. Le carte selezionate spariscono con la mano.

// Campo nascosto che apre la tastiera: il testo si vede direttamente sulla carta nera, mentre si scrive.
let jollyKeys = null;
function jollyKeyboard() {
  if (!jollyKeys) {
    jollyKeys = document.createElement("input");
    jollyKeys.type = "text";
    jollyKeys.maxLength = JOLLY_MAX;
    jollyKeys.autocomplete = "off";
    jollyKeys.autocapitalize = "sentences";
    jollyKeys.setAttribute("aria-label", "Testo del jolly");
    jollyKeys.className = "jolly-keys";
    jollyKeys.addEventListener("input", () => { jollyDraft = jollyKeys.value; updateJollyPreview(); });
    jollyKeys.addEventListener("focus", () => app.classList.add("typing"));
    jollyKeys.addEventListener("blur", () => app.classList.remove("typing"));
    document.body.append(jollyKeys);
  }
  return jollyKeys;
}
// Aggiorna la carta nera a ogni tasto: il testo si adatta alla lunghezza.
function updateJollyPreview() {
  const span = app.querySelector(".jolly-typed");
  if (span) { span.textContent = jollyDraft; span.classList.toggle("empty", !jollyDraft); }
  fitText(app);
  syncJollyReady();
}

// Il V del giocatore si accende solo quando il jolly ha un testo.
function syncJollyReady() {
  const v = /** @type {HTMLButtonElement|null} */ (app.querySelector(".cc-v"));
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
  showJollyWon();
  if (online) { netSend({ type: "memoryDone" }); render(); return; }
  bumpStat("jolly");
  game.awardJolly(viewer);
  step();
}

// Finestra con la carta jolly vinta: si chiude toccandola.
function showJollyWon() {
  const n = el("div", { class: "jolly-won", role: "dialog", "aria-label": "Jolly vinto", onclick: () => n.remove() },
    el("img", { class: "jolly-reveal", src: JOLLY_IMG, alt: "Carta jolly vinta" }));
  document.body.append(n);
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
    el("p", { class: "memory-hint" }, "Trova le coppie prima che gli altri rispondano: vinci il jolly."),
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

/**
 * @param {any} s stato pubblico della partita
 * @param {string[]} whites testi da inserire negli spazi
 * @param {{canPlay?: boolean, label?: string, slam?: boolean, jollyAt?: number}} [opts]
 */
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
        return el("span", { class: "word jolly-word" }, el("span", { class: "jolly-typed" + (jollyDraft ? "" : " empty") }, jollyDraft));
      }
      const fresh = canPlay && k >= wordsShown; k += 1;
      // Il punto (o la virgola) che segue la risposta resta attaccato all'ultima parola: non va mai a capo da solo.
      const next = segs[idx + 1];
      const punct = next && next.t === "text" ? (next.v.match(/^[.,;:!?]+/) || [""])[0] : "";
      if (punct && next.t === "text") { next.v = next.v.slice(punct.length); }
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
      el("div", { class: "foot" }, catIcon(BLACK_CATS[Math.min(3, Math.max(1, s.black.blanks)) - 1], "cat-ico"),
        el("span", {}, label ?? (s.black.blanks > 1 ? `${s.black.blanks} risposte` : "1 risposta")))));
}


const CROWN_SVG = '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M4 34 L8 9 L22 22 L32 3 L42 22 L56 9 L60 34 Z" fill="#ff7a3d"/><rect x="4" y="31" width="56" height="7" rx="2" fill="#ff7a3d"/></svg>';

// Schermata di vittoria per tutti: stesso stile del passaggio di turno, con la corona e un segnaposto per punto.
// Chi gioca con il nome "Tu" vince in seconda persona: "Hai vinto tu, grazie alla tua…", non "Ha vinto Tu… alla sua".
const isYou = (name) => name === "Tu";
const wonLabel = (name) => (isYou(name) ? "Hai vinto" : "Ha vinto");
function toSecondPerson(line) {
  const map = { suo: "tuo", sua: "tua", suoi: "tuoi", sue: "tue" };
  return line.replace(/\b(suo|sua|suoi|sue)\b/g, (w) => map[w]).replace(/\bnon sa\b/g, "non sai");
}
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
  const rest0 = winnerLine.replace(/^Grazie\s+/i, "");
  const rest = isYou(w.name) ? toSecondPerson(rest0) : rest0;
  app.replaceChildren(el("div", { class: "crown-screen" + (again ? " done" : ""), role: "dialog", "aria-label": `${wonLabel(w.name)} ${w.name}` },
    el("div", { class: "iw" },
      crown,
      el("span", { class: "cr-line" }, wonLabel(w.name)),
      el("span", { class: "cr-slot" }, el("span", { class: "cr-gap" }), el("span", { class: "cr-name", style: nameFit(w.name) }, w.name)),
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
  if (s.phase === "over") {
    if (!online && countedSeq !== localGameSeq) {
      countedSeq = localGameSeq;
      bumpStat("games");
      if (!game.player(game.winner).isBot) bumpStat("wins");
    }
    return renderWinner();
  }
  const isJudge = s.judgeId === viewer;
  const me = s.players.find((p) => p.id === viewer);
  const need = s.black ? s.black.blanks : 1;
  const judging = s.phase === "judging" && isJudge;
  if (judging) resetJudgeIfNewRound();
  // Online il telefono non cambia "giocatore di turno": il segnale è il passaggio a "devi agire", una volta per fase.
  const actionable = !!online && (s.phase === "playing" ? (!isJudge && !!me && !me.hasPlayed) : (s.phase === "judging" && isJudge));
  const actKey = actionable ? `${s.round}:${s.phase}` : null;
  if (actKey && actKey !== lastActKey) Sound.play("turn");
  lastActKey = actKey;
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
        class: ["seat", p.id === s.judgeId ? "judge" : "", s.phase === "playing" && p.hasPlayed ? "played" : "", won ? "won" : "",
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
    roundProgress(s),
    el("button", { type: "button", class: "home-settings", "aria-label": "Impostazioni", title: "Impostazioni", onclick: openSettings }, settingsIcon()));

  let mainCard = null;
  let extraRow = null;    // fila delle combinazioni, sotto la carta nera (per chi non è il Re)
  let note = null;
  let actions = null;
  let rail = null;
  let railLabel = "";

  if (s.phase === "over") {
    const w = game.player(game.winner);
    note = el("div", { class: "banner win" },
      el("h2", {}, `${wonLabel(w.name)} ${w.name}`),
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
      if (!online && !last.isBot) bumpStat("rounds");
      Sound.play("win");
    }
    note = null;
    // In locale il round successivo parte da solo; online lo fa il server.
    if (!online && !roundTimer) roundTimer = setTimeout(nextRound, LOCAL_ROUND_PAUSE_MS);
  } else if (isJudge) {
    // Il Memory esiste solo online: in locale il telefono passa di mano, quindi non avrebbe senso.
    note = (online && s.jolly !== false && s.jollyHolder === null && !(mem && mem.won && mem.round === s.round)) ? memoryBoard(s) : el("p", { class: "hidden-msg" }, "Sei il Re: aspetta che gli altri confermino.");
  } else if (s.phase === "playing" && !me.hasPlayed) {
    note = null;   // niente istruzioni in primo piano: la carta nera stessa dice quando è pronta
  } else if (me.hasPlayed) {
    note = el("p", { class: "hidden-msg" }, "Risposta confermata. Aspetta gli altri giocatori.");
  }

  // Carta nera in cima. Nella vista "tutte e tre" del Re compare solo quando ha scelto una risposta,
  // già compilata con quella scelta; le altre restano in elenco.
  // Chi non è il Re vede la stessa schermata del Re (combinazioni affiancate), senza poter scegliere.
  const comparing = (judging && judgeMode === "compare" && showPrivate) || (s.phase === "judging" && !isJudge);
  const memoryUp = !!(note && note.classList && note.classList.contains("memory"));
  if (!comparing && !memoryUp) {
    const canPlay = s.phase === "playing" && !isJudge && !me.hasPlayed && showPrivate;
    const slam = slamPending;
    slamPending = false;
    if (!selected.includes(JOLLY)) { jollyDraft = ""; if (jollyKeys) { jollyKeys.value = ""; if (document.activeElement === jollyKeys) jollyKeys.blur(); } }
    // Chi deve rispondere vede a che punto è: "1 di 2 scelte", poi "Pronta" quando compaiono la X e la V.
    const progress = canPlay && need > 0 && selected.length > 0
      ? (selected.length >= need ? "Pronta" : `${selected.length} di ${need} scelte`)
      : undefined;
    mainCard = blackCard(s, previewWhites(s), { canPlay, slam, jollyAt: canPlay ? selected.indexOf(JOLLY) : -1, label: progress });
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
  if (s.phase !== "over" && !judging && me.hand && showPrivate && !memoryUp) {
    const canSelect = s.phase === "playing" && !isJudge && !me.hasPlayed;
    railLabel = "";
    const deal = dealPending;
    dealPending = false;
    rail = el("div", { class: "rail", role: "group", "aria-label": "La tua mano" },
      handForRail(me.hand).map((c, i) => {
        const idx = selected.indexOf(c.id);
        // Con una sola risposta da dare, toccarne un'altra sostituisce la scelta; con più risposte si deseleziona prima.
        const full = need > 1 && selected.length >= need && idx < 0;
        const node = el("button", {
          class: "card" + (idx >= 0 ? " sel" : "") + (deal ? " deal" : ""),
          type: "button",
          disabled: !canSelect || full,
          "aria-pressed": String(idx >= 0),
          onclick: () => {
            if (c.jolly) { if (idx >= 0) jollyKeyboard().blur(); else { const k = jollyKeyboard(); k.value = jollyDraft; k.focus(); } }
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
        else node.append(el("span", { class: "cat-mark" }, catIcon(c.cat)), el("span", { class: "kind" }, catIcon(c.cat), el("span", {}, KIND[c.cat] ?? c.cat)));
        if (c.jolly) return node;
        return node;
      }));
  }

  const railBlock = rail ? el("div", { class: "col rail-block", style: "gap:6px" },
    railLabel ? el("span", { class: "label" }, railLabel) : null,
    rail) : null;

  // Passaggio di turno: "Passa a" · una barra che si riempie · il nome · "il telefono".
  // Sotto, la frase sulle carte nascoste. Toccando lo schermo si mostrano le carte.
  // Stessa struttura dell'apertura: "Passa a" · la casella che diventa il nome · "il telefono".
  const reveal = () => { curtain = false; Sound.play("deal"); render(); };
  const who = curtain ? el("div", { class: "curtain", role: "dialog", "aria-label": "È il turno di", onclick: reveal },
    el("div", { class: "iw" },
      me.name === "Tu"
        ? el("span", {}, "È il tuo turno")
        : [el("span", {}, "È il turno di"),
           el("span", { class: "cur-slot" }, el("span", { class: "cur-gap" }), el("span", { class: "cur-name", style: nameFit(me.name) }, me.name))],
      el("span", { class: "cur-sub" }, "Le tue carte sono nascoste finché non tocchi."))) : null;

  // Al primo render di pausa la carta resta visibile: sarà shrinkWinner a farla rimpicciolire.
  // Nei render successivi (stesso round) è già finita, quindi resta nascosta.
  if (s.phase === "roundEnd" && !shrinkNow && shrinkRound === s.round && mainCard) mainCard.style.visibility = "hidden";
  // Se il Re ha già scelto, il punto parte dalla combinazione che gli altri vedevano.
  const oldSrc = s.phase === "roundEnd" && s.pickedIndex != null ? app.querySelector(`.combo[data-idx="${s.pickedIndex}"] .black`) : null;
  if (oldSrc && !pendingFrom) pendingFrom = { rect: oldSrc.getBoundingClientRect(), node: oldSrc };
  // Il volo parte dalla combinazione che si vedeva: la carta grande della vincente non compare a parte.
  if (s.phase === "roundEnd" && pendingFrom && mainCard) mainCard.style.visibility = "hidden";
  requestAnimationFrame(() => { fitText(app); refreshFades(app); keepSeatsInView(); });
  const oldRow = app.querySelector(".combo-row");
  comboScroll = oldRow ? oldRow.scrollLeft : null;
  app.replaceChildren(
    el("div", { class: "game" },
      el("header", { class: "hud" }, boardWrap(board), roundline),
      el("main", { class: "stage" }, mainCard, extraRow, note),
      el("footer", { class: "dock" }, actions, railBlock),
      who));
  // La fila ricostruita riprende la posizione in cui la stava guardando chi scorre.
  const row = app.querySelector(".combo-row");
  if (row && comboScroll !== null) row.scrollLeft = comboScroll;
  comboScroll = null;
  // Si scorre alla combinazione scelta solo quando cambia, non a ogni aggiornamento.
  const selNode = /** @type {HTMLElement|null} */ (app.querySelector(".combo.sel"));
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
  const card = /** @type {HTMLElement|null} */ (app.querySelector(".stage .black"));
  const mini = /** @type {HTMLElement|null} */ (app.querySelector(".seat.won .mini-black.fresh"));
  const src = from ? from.node : card;
  if (!src || !mini) return;
  if (!motionOn()) { mini.classList.remove("fresh"); return; }
  keepSeatsInView(true);   // il posto del vincitore deve essere in vista prima di calcolare dove atterra la carta
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
  const b = /** @type {HTMLButtonElement|null} */ (/** @type {Element} */ (e.target).closest?.("button"));
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
// Se l'ospite cade (rete, schermo spento) la stanza resta: i giocatori aspettano il suo ritorno per questo tempo.
const HOST_GRACE_MS = 10 * 60 * 1000;
// Stato dell'ospite dalla stanza: "here" se collegato, "away" se assente da poco, "gone" se oltre il tempo.
function hostState(v) {
  if (!v) return "here";
  return Date.now() - Number(v) > HOST_GRACE_MS ? "gone" : "away";
}
// Avviso fisso in alto, visibile su ogni schermata della stanza. Stringa vuota = niente avviso.
function netBanner(text) {
  let b = document.getElementById("net-banner");
  if (!text) { b?.remove(); return; }
  if (!b) { b = el("div", { id: "net-banner", class: "net-banner", role: "status" }); document.body.append(b); }
  b.textContent = text;
}
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
      if (netConnected) restoreNet();
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
  hostRoom = createRoomHost({ cards: withOverrides(CARDS), turnSeconds: 60, onRoomGone: () => {} });
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
  ref.onDisconnect().update({ hostAway: Date.now() }); // se l'ospite cade, la stanza resta e i giocatori aspettano
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
  base.child("hostAway").on("value", (snap) => {
    if (!online || online.code !== code) return;
    const st = hostState(snap.val());
    netBanner(st === "away" ? "L'ospite si è disconnesso. La partita riprende quando torna."
      : st === "gone" ? "L'ospite non è tornato: la stanza non è più attiva." : "");
  });
}

async function joinRoom(code, name) {
  initNet();
  if (!fbDb) throw new Error("Online non disponibile su questo telefono.");
  const snap = await fbDb.ref(`rooms/${code}`).once("value");
  if (!snap.exists()) throw new Error("Stanza non trovata");
  if (hostState(snap.val().hostAway) === "gone") throw new Error("La stanza non è più attiva");
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
    base.child("hostAway").off();
  }
  netBanner("");
  hostRoom = null; hostSelf = null; hostCode = null; hostConns.clear();
  joinedCode = null;
}

// Quando la rete torna, Firebase ha già tolto i "onDisconnect": va ripristinato tutto ciò che era legato alla connessione.
// Ospite: stanza di nuovo registrata e stato rimandato a tutti. Giocatore: presenza di nuovo segnata e riaggancio con il token.
function restoreNet() {
  if (!fbDb) return;
  try {
    if (hostRoom && hostCode) {
      const ref = fbDb.ref(`rooms/${hostCode}`);
      ref.update({ host: netId(), hostAway: null });
      ref.onDisconnect().update({ hostAway: Date.now() });
      hostRoom.refresh();
    }
    if (joinedCode && !hostRoom) {
      const me = fbDb.ref(`rooms/${joinedCode}/presence/${netId()}`);
      me.onDisconnect().remove();
      me.set(true);
      const s = loadSession();
      if (online?.you && s && s.code === joinedCode) netSend({ type: "resume", code: s.code, token: s.token });
    }
  } catch { /* la prossima connessione riprova */ }
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
    opts: { winScore: s.winScore, jolly: s.jolly !== false },
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
    t = setTimeout(() => { open = true; fn(); }, 650);
  });
  node.addEventListener("pointermove", (e) => {
    if (!open && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clearTimeout(t);
  });
  node.addEventListener("pointerleave", () => { if (!open) clearTimeout(t); });
  node.addEventListener("contextmenu", (e) => e.preventDefault());
}

// File orizzontali che scorrono (giocatori, mano, combinazioni): invece di un taglio netto, il bordo sfuma
// solo dal lato in cui c'è altro da vedere. Le classi si aggiornano allo scorrimento e al cambio di dimensione.
const FADE_ROWS = ".board, .rail, .combo-row, .rv-strip";
/** @param {Element} r */
function updateFade(r) {
  const max = r.scrollWidth - r.clientWidth;
  const scrollsX = max > 2 && getComputedStyle(r).overflowX !== "hidden";
  r.classList.toggle("fade-x", scrollsX);
  r.classList.toggle("more-l", scrollsX && r.scrollLeft > 2);
  r.classList.toggle("more-r", scrollsX && r.scrollLeft < max - 2);
  if (r.classList.contains("board")) updateMoreBadges(r);
}
/** @param {ParentNode} [root] */
function refreshFades(root = document) {
  root.querySelectorAll(FADE_ROWS).forEach(updateFade);
}
window.addEventListener("resize", () => refreshFades());
document.addEventListener("scroll", (e) => {
  const r = e.target;
  if (r instanceof Element && r.matches(FADE_ROWS)) updateFade(r);
}, true);

// Mentre si gioca: un pallino per ogni giocatore che deve rispondere, pieno quando ha risposto, e il conteggio.
// Fuori da quella fase resta uno spazio vuoto che tiene ai lati freccia e impostazioni.
function roundProgress(s) {
  if (s.phase !== "playing") return el("span", { class: "spacer" });
  const answering = s.players.filter((p) => p.id !== s.judgeId);
  const done = answering.filter((p) => p.hasPlayed).length;
  return el("span", { class: "spacer round-progress", role: "status", "aria-label": `${done} risposte su ${answering.length}` },
    el("span", { class: "rp-dots", "aria-hidden": "true" }, answering.map((p) => el("span", { class: "rp-dot" + (p.hasPlayed ? " on" : "") }))),
    el("span", { class: "rp-count", "aria-hidden": "true" }, `${done}/${answering.length}`));
}

// Fila dei giocatori con un contatore per lato: "+2" dice quanti posti restano fuori vista; toccandolo la fila scorre lì.
function boardWrap(board) {
  const badge = (side) => el("button", { type: "button", class: `more-badge ${side}`, hidden: true, "aria-label": side === "l" ? "Giocatori a sinistra" : "Giocatori a destra",
    onclick: () => board.scrollBy({ left: (side === "l" ? -1 : 1) * board.clientWidth * 0.8, behavior: motionOn() ? "smooth" : "auto" }) });
  return el("div", { class: "board-wrap" }, board, badge("l"), badge("r"));
}
/** @param {Element} board */
function updateMoreBadges(board) {
  const wrap = board.parentElement;
  if (!wrap || !wrap.classList.contains("board-wrap")) return;
  const b = board.getBoundingClientRect();
  let left = 0, right = 0;
  for (const seat of board.children) {
    const r = seat.getBoundingClientRect();
    if (r.left + r.width / 2 < b.left) left++;
    else if (r.left + r.width / 2 > b.right) right++;
  }
  for (const [side, n] of [["l", left], ["r", right]]) {
    const el2 = /** @type {HTMLElement|null} */ (wrap.querySelector(`.more-badge.${side}`));
    if (!el2) continue;
    el2.hidden = n === 0;
    el2.textContent = `+${n}`;
  }
}

// Con molti giocatori la fila scorre: chi ha appena vinto il turno, chi deve giocare e il Re restano in vista.
/** @param {boolean} [instant] subito, senza scorrimento animato (serve prima di misurare il volo della carta) */
function keepSeatsInView(instant = false) {
  const board = app.querySelector(".board");
  if (!board || board.scrollWidth <= board.clientWidth) return;
  const target = board.querySelector(".seat.won") || board.querySelector(".seat.turn") || board.querySelector(".seat.judge");
  if (!target) return;
  const b = board.getBoundingClientRect(), t = target.getBoundingClientRect();
  if (t.left < b.left + 24 || t.right > b.right - 24) {
    board.scrollTo({ left: board.scrollLeft + (t.left + t.width / 2) - (b.left + b.width / 2), behavior: instant || !motionOn() ? "auto" : "smooth" });
  }
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
  // Mazzi: li sceglie l'ospite con le stesse tessere del locale. Il Base, se spento, viaggia nel messaggio di avvio.
  const startBtn = el("button", { type: "button", class: "primary", disabled: !ok || !!deckProblem(),
    onclick: () => netSend({ type: "start", winScore: onlineWin, custom: customPayload(), base: !!loadCustom().baseUse }) }, "Avvia partita");
  const deckBox = isHost ? deckPicker(() => { startBtn.disabled = !ok || !!deckProblem(); }) : null;
  const jollyNow = st.jolly !== false;   // scelta dell'ospite: la vedono tutti
  const jollySeg = [["Sì", true], ["No", false]].map(([label, v]) => el("button", {
    type: "button", "aria-pressed": String(jollyNow === v),
    onclick: () => netSend({ type: "setJolly", jolly: v }),
  }, label));
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
        isHost ? el("span", { class: "label", style: "margin-top:6px" }, "Carte · quali mazzi entrano") : null,
        deckBox,
        isHost ? el("span", { class: "label", style: "margin-top:6px" }, "Jolly · il Re lo vince con il Memory") : null,
        isHost ? el("div", { class: "seg" }, jollySeg) : el("p", { class: "hidden-msg" }, `Jolly: ${jollyNow ? "sì" : "no"}`),
        // Dopo una partita la stanza resta aperta: ognuno si dichiara pronto, e quando lo sono tutti si ricomincia.
        me ? el("button", { type: "button", class: me.ready ? "ghost" : "primary", onclick: () => netSend({ type: "ready" }) },
          me.ready ? "Pronto: aspetto gli altri" : "Sono pronto") : null,
        isHost
          ? startBtn
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
.home { height: 100%; display: flex; flex-direction: column; gap: 14px; }
/* Home: tre carte del gioco. La nera è la modalità principale. */
.hand { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 12px; padding-bottom: 8px; }
.hcard { position: relative; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; gap: 6px; min-height: 0; padding: 16px; border: 2px solid #111; border-radius: 18px; text-align: left; cursor: pointer; box-shadow: 0 10px 22px -14px #000a; color: #111; background: #fbf8f0; font-family: inherit; min-height: 44px; }
.hcard:active { transform: scale(.98); }
.hcard .hc-title { font-size: 26px; font-weight: 800; line-height: 1; letter-spacing: -.01em; }
.hcard .hc-sub { font-size: 14px; line-height: 1.3; font-weight: 500; opacity: .85; }
.hc-arr { position: absolute; top: 14px; right: 16px; font-size: 22px; font-weight: 700; }
.hc-black { background: #111; color: #fbf8f0; border-color: #fbf8f0; }
.hc-stats { background: var(--tint, #2a221c); color: #fbf8f0; border-color: var(--tint, #2a221c); justify-content: flex-end; overflow: hidden; }
.hc-stats > * { position: relative; z-index: 1; }
.hc-stats .hc-title, .hc-stats .hc-num { text-shadow: 0 1px 6px #000c; }
.hc-art { position: absolute !important; z-index: 0 !important; top: 10px; left: 10px; width: 78%; }
.hc-avatar { display: block; width: 100%; height: auto; max-width: none; border: 0; }
.hc-nums { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; width: 100%; margin-top: 6px; }
.hc-num { display: flex; flex-direction: column; gap: 2px; }
.hc-num .n { font-size: 22px; font-weight: 800; line-height: 1; }
.hc-num .l { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; opacity: .7; }
.hc-white { background: #fbf8f0; color: #111; }
.hc-accent { background: var(--accent); color: #fff; border-color: #111; }
.hc-accent .hc-sub { color: #fff; }
.prof-av { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.prof-img { width: 150px; height: auto; object-fit: contain; }
.round { width: 46px; flex: 0 0 46px; padding: 0; font-size: 24px; }
.slist { display: flex; flex-direction: column; }
.srow { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); }
.srow strong { font-size: 18px; }
.blank { display: inline-block; width: 4em; border-bottom: 3px solid var(--accent); margin: 0 .15em; vertical-align: baseline; }
.home-top { display: flex; align-items: center; justify-content: flex-end; }
.home-top .label { letter-spacing: .22em; }
.icon { padding: 6px 12px; font-size: 18px; border-radius: 999px; }
.poster { flex: 0 0 33vh; min-height: 0; display: flex; align-items: center; justify-content: center; }
.poster .logo.big { max-width: 100%; gap: 12px; }
.poster .logo.big svg { width: auto; height: 24vh; max-width: 30vw; aspect-ratio: 3 / 4; flex: 0 0 auto; }
.poster .logo.big .wordmark { font-size: clamp(22px, 7vw, 36px); hyphens: none; white-space: nowrap; }
.poster .logo.big .wordmark i { font-size: 12px; }
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
.add { all: unset; box-sizing: border-box; min-height: 40px; display: inline-flex; align-items: center; cursor: pointer; font-weight: 700; color: var(--accent); font-size: 15px; }
.cards-screen .hidden-msg { font-size: 13px; }
/* Bordo per categoria, parole mai spezzate */
.card, .pcard { border-width: 3px; border-style: solid; border-color: var(--cat, #d6d0c2); }
.card, .pcard, .black, .black .text, .rail .card .txt { hyphens: none; -webkit-hyphens: none; }
html, body, p, button, input, textarea, h1, h2 { hyphens: none !important; -webkit-hyphens: none !important; }
.card .txt, .pcard .txt { overflow-wrap: break-word; word-break: normal; } /* a capo solo se una parola non entra proprio */
.legend { display: flex; gap: 12px; flex-wrap: wrap; }
.lg { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--fg); }
.lg::before { content: ""; width: 10px; height: 10px; border-radius: 3px; background: var(--cat); }
.cat-list { display: flex; flex-direction: column; }
.cat-row { display: flex; flex-wrap: wrap; gap: 14px 18px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line); }
.cat-row .bar { width: 6px; height: 36px; border-radius: 3px; background: var(--cat); }
.cat-name { display: flex; flex-direction: column; min-width: 0; }
.cat-name strong { font-family: "Bricolage Grotesque", sans-serif; font-size: 20px; font-weight: 800; }
.newcat { display: flex; gap: 10px; align-items: center; }
.newcat input { flex: 1; min-width: 0; }
.pack-row { display: flex; gap: 10px; }
.pack-text { width: 100%; box-sizing: border-box; min-height: 120px; padding: 12px 14px; font: inherit; font-size: 15px; line-height: 1.45; color: var(--fg); background: var(--paper); border: 1px solid var(--line); border-radius: 14px; resize: vertical; }
.pack-text::placeholder { color: var(--muted); }
.head-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0 16px; }
.head-actions .add { white-space: nowrap; }
.code-area { display: flex; flex-direction: column; gap: 10px; }
.code-big { font-size: 34px; font-weight: 800; letter-spacing: .22em; text-align: center; padding: 14px 10px 14px 20px; border: 2px dashed var(--line); border-radius: 14px; background: var(--paper); user-select: all; -webkit-user-select: all; }
.card-form input.code-input { font-size: 24px; font-weight: 700; letter-spacing: .25em; text-align: center; text-transform: uppercase; padding: 12px; }
.card-form .hidden-msg.err { color: var(--accent-ink, var(--accent)); }
.net-banner { position: fixed; z-index: 90; top: calc(env(safe-area-inset-top, 0px) + 10px); left: max(12px, env(safe-area-inset-left, 0px)); right: max(12px, env(safe-area-inset-right, 0px));
  padding: 10px 14px; border-radius: 14px; background: var(--accent); color: #1a130f; font-size: 14px; font-weight: 700; text-align: center; box-shadow: 0 10px 24px -12px #000c; animation: fade .2s both; }
.pack-text[readonly] { color: var(--fg); }
.pack-row button { flex: 1; }
.cards-screen textarea { font: inherit; color: inherit; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; resize: vertical; width: 100%; }
`));
document.head.append(el("style", {}, `
.cards-btn { align-self: center; border-radius: 999px; padding: 9px 16px; font-size: 14px; }
.cards-screen { display: flex; flex-direction: column; gap: 14px; }
.cards-screen h2 { font-size: 30px; }
/* ===== Controlli: un aspetto per tipo, uguale in tutte le schermate ===== */
/* Scelta tra più opzioni: rettangoli della stessa larghezza, selezionato = pieno. */
.seg > button { flex: 1 1 0; min-width: 0; }
/* Filtri e interruttori: pillole. */
.chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 4px; scrollbar-width: none; }
.chip, .switch { min-height: 38px; padding: 0 14px; border-radius: 999px; font-size: 14px; font-weight: 600; white-space: nowrap; flex: 0 0 auto; }
.switch[aria-pressed="false"] { background: transparent; color: var(--muted); }
/* Linguette con sottolineatura (Bianche / Nere). */
.tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--line); }
.tabs button { min-height: 40px; padding: 0 0 8px; margin-bottom: -1px; border: 0; border-radius: 0; background: none; color: var(--muted); font-size: 15px; }
.tabs button[aria-pressed="true"] { background: none; color: var(--fg); border-bottom: 2px solid var(--accent); }
/* Campo di ricerca: come un campo di testo, ma tondo. */
.card-search { width: 100%; box-sizing: border-box; min-height: 46px; padding: 0 16px; font: inherit; font-size: 15px; color: var(--fg); background: var(--paper); border: 1px solid var(--line); border-radius: 999px; }
.card-search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
/* Mazzi: righe-carta piatte, stessa famiglia della home. Il base in nero, i personali in crema. */
.deck-list { display: flex; flex-direction: column; gap: 12px; }
.dk { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 12px; background: var(--paper); color: var(--fg); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 10px 20px -16px #000a; transition: opacity var(--t-base); }
.dk.base { background: #111; color: #fbf8f0; border-color: #111; }
.dk.off { opacity: .55; }
.dk-main { flex: 1 1 auto; min-width: 0; min-height: 56px; display: flex; align-items: center; gap: 14px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dk-main:active { transform: scale(.98); }
.dk-mini { flex: 0 0 auto; width: 34px; height: 48px; border-radius: 6px; border: 2px solid currentColor; display: grid; place-items: center; }
.dk-mini::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.dk-text { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dk-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; opacity: .6; }
.dk-name { font-size: 20px; font-weight: 800; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dk-count { font-size: 13px; opacity: .7; }
.dk .switch { flex: 0 0 auto; }
.dk.base .switch[aria-pressed="false"] { color: #fbf8f0; border-color: #fbf8f066; }
/* Gestione: schermata semplice. Barra superiore, ricerca, pillole, pulsante + in basso. */
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.topbar .ghost { border: 0; background: none; padding: 6px 0; font-size: 15px; font-weight: 700; color: var(--muted); cursor: pointer; }
.topbar .ghost[aria-label] { color: var(--accent); }
.deck-title { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.deck-shell, .deck-body { display: flex; flex-direction: column; gap: 14px; }
.cards-screen { padding-bottom: 96px; }
.fab { position: fixed; right: max(18px, env(safe-area-inset-right, 0px)); bottom: calc(18px + env(safe-area-inset-bottom, 0px)); z-index: 20;
  width: 60px; height: 60px; padding: 0; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
  background: var(--accent); color: #fff; font-size: 32px; font-weight: 400; line-height: 1; box-shadow: 0 10px 24px -8px var(--accent); }
/* Gestione: una sola disposizione per ogni schermata e ogni foglio. */
.head-title { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.head-title .label { font-size: 12px; }
[hidden] { display: none !important; }
.deck-shell, .deck-body { display: flex; flex-direction: column; gap: 14px; }
.toolbar { display: flex; gap: 8px; align-items: center; }
.toolbar .card-search { flex: 1 1 auto; min-width: 0; }
.action-list { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.action-list button { width: 100%; justify-content: flex-start; text-align: left; font: inherit; font-size: 16px; padding: 14px 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--paper); color: var(--fg); cursor: pointer; }
.action-list button.danger { color: var(--accent); }
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
.danger { color: var(--accent); }
`));

applySettings();
boot();

document.head.append(el("style", {}, `
/* Transizioni e feedback: brevi, con il rispetto dell'impostazione "Movimento". */
.enter { animation: screenIn var(--t-slow) var(--ease-out) both; }
@keyframes screenIn { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
.no-motion .enter, .no-motion .splash .logo { animation: none; }
button { transition: transform var(--t-fast) ease, background-color var(--t-base) ease, opacity var(--t-base) ease, color var(--t-base) ease; }
button:active:not(:disabled) { transform: scale(.96); }
.splash { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: #000; transition: opacity .55s ease, visibility .55s; }
.splash.out { opacity: 0; visibility: hidden; }
.splash .logo { animation: logoIn 1.05s cubic-bezier(.2,.8,.2,1) both; }
@keyframes logoIn { from { opacity: 0; transform: scale(.6) translateY(18px); } to { opacity: 1; transform: none; } }
/* Mano: fila scorrevole di carte piccole, con spazio sopra (numero di scelta) e sotto. */
@media (orientation: portrait) {
  .dock .rail { padding: 22px 6px 30px; align-items: flex-end; }
.rv-wrap { display: flex; flex-direction: column; gap: 6px; }
/* Spazio attorno alle carte: la carta scelta ingrandisce (scala fino a 1,08 e contorno) senza essere tagliata dal contenitore. */
.rv-strip { display: flex; gap: 10px; overflow-x: auto; padding: 16px 18px 20px; scrollbar-width: none; }
.rv-card { flex: 0 0 150px; min-height: 92px; border-radius: 14px; background: var(--paper); color: var(--fg); border: 1px solid var(--line); padding: 10px; font-size: 14px; line-height: 1.2; display: flex; flex-direction: column; justify-content: space-between; gap: 6px; transition: opacity var(--t-base); }
.rv-card.hidden { opacity: .35; }
.rv-card.picked { outline: 3px solid var(--accent); animation: rv-pop .5s ease-out; }
.rv-card.rv-new { animation: rv-in .45s ease-out both; }
.combo-row { width: 100%; min-width: 0; align-self: stretch; box-sizing: border-box; display: flex; align-items: center; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; padding: 20px 16px 24px; scrollbar-width: none; }
.combo-row > .combo { flex: 0 0 86%; scroll-snap-align: center; opacity: .72; transition: opacity var(--t-base); cursor: pointer; }
.combo-row > .combo.sel { opacity: 1; }
/* Le combinazioni hanno la stessa grandezza della carta nera, anche se la riga è in uno spazio con contenitore a misura. */
/* Sulla scena la fila occupa lo spazio rimasto e le carte si misurano su di essa (cqw/cqh):
   entrano sempre intere, con o senza la mano sotto, a qualsiasi grandezza di carte e di schermo. */
.stage > .combo-row { flex: 1 1 auto; min-height: 0; container-type: size; }
.stage .combo-row > .combo { container-type: inline-size; width: auto; min-height: 0; flex: 0 0 min(78cqw, 100cqh * 5 / 7 * .9); }
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
@keyframes rv-pop { 0% { transform: scale(1); } 45% { transform: scale(1.06); } 100% { transform: scale(1); } }
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

// Il testo sta sempre dentro la carta. Si misura quanto il corpo base va ridotto (un rapporto, --fit, da 1 in giù) e il CSS lo applica:
// con un rapporto, e non con pixel fissi, il testo resta proporzionato quando la carta cambia grandezza (carta scelta, rotazione).
// Prima si rimpicciolisce senza spezzare le parole. Se così il corpo scenderebbe sotto FIT_READABLE_PX, si lasciano spezzare le parole
// più lunghe della carta (data-break) e si rimpicciolisce solo quanto serve. Sotto FIT_FLOOR_PX non si scende.
const FIT_READABLE_PX = 9;
const FIT_FLOOR_PX = 5.5;
// Sulle carte piccole (anteprime delle combinazioni) le soglie scalano con la larghezza: a 130 px valgono quelle sopra.
const fitLimit = (px, box) => Math.min(px, box.clientWidth * (px / 130));
/** Le misure sono di layout (offset, scroll), non rettangoli a schermo: non cambiano con rotazione e ingrandimento della carta.
 *  @param {HTMLElement} node */
function textFits(node) {
  const box = /** @type {HTMLElement|null} */ (node.closest(".black, .card, .pcard"));
  if (!box) return true;
  if (node.scrollWidth > node.clientWidth + 1) return false;                 // una parola più larga della carta
  // Il testo resta dentro i margini della carta (il padding), non sul bordo.
  const cs = getComputedStyle(box);
  const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0, padB = parseFloat(cs.paddingBottom) || 0;
  if (node.offsetLeft < padL - 1 || node.offsetLeft + node.offsetWidth > box.clientWidth - padR + 1) return false;
  if (box.matches(".black")) {
    // Carta nera: il testo sta sopra il piede ("2 risposte") e dentro il bordo alto.
    // Con i pulsanti X e V (risposta pronta) il testo si ferma sopra di loro.
    const foot = /** @type {HTMLElement|null} */ (box.querySelector(":scope > .foot"));
    const ctrl = /** @type {HTMLElement|null} */ (box.querySelector(":scope > .combo-ctrl"));
    const limit = Math.min(foot ? foot.offsetTop : box.clientHeight - padB, ctrl ? ctrl.offsetTop : Infinity) - 2;
    return node.offsetTop >= 0 && node.offsetTop + node.offsetHeight <= limit + 0.5;
  }
  // Carta bianca (mano, griglia): il testo parte sotto l'etichetta della categoria e finisce dentro la carta.
  const label = /** @type {HTMLElement|null} */ (box.querySelector(":scope > .kind, :scope > .tag"));
  const top = label ? label.offsetTop + label.offsetHeight + 3 : 0;
  return node.offsetTop >= top - 0.5 && node.offsetTop + node.offsetHeight <= box.clientHeight - padB + 0.5;
}
/** Il rapporto più grande (tra floor e 1) con cui il testo sta nella carta, oppure null se nemmeno al minimo.
 *  @param {HTMLElement} node @param {number} floor */
function bestFit(node, floor) {
  const set = (r) => node.style.setProperty("--fit", String(r));
  set(floor);
  if (!textFits(node)) return null;
  let lo = floor, hi = 1;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    set(mid);
    if (textFits(node)) lo = mid; else hi = mid;
  }
  set(lo);
  return lo;
}
/** @param {HTMLElement} node @returns {number} il rapporto applicato */
function fitNode(node) {
  const box = /** @type {HTMLElement} */ (node.closest(".black, .card, .pcard") || node);
  // Stessa misura e stesso testo di prima: niente da rifare (le rotazioni e i ridimensionamenti la cambiano).
  const sig = `${box.clientWidth}x${box.clientHeight}|${node.textContent}`;
  if (node.dataset.fitSig === sig) return parseFloat(node.style.getPropertyValue("--fit")) || 1;
  node.removeAttribute("data-break");
  node.style.setProperty("--fit", "1");
  let r = 1;
  if (!textFits(node)) {
    const base = parseFloat(getComputedStyle(node).fontSize) || 16;   // corpo con rapporto 1
    const floor = Math.min(1, fitLimit(FIT_FLOOR_PX, box) / base);
    const plain = bestFit(node, floor);
    if (plain !== null && base * plain >= fitLimit(FIT_READABLE_PX, box)) r = plain;
    else {
      node.setAttribute("data-break", "");
      const broken = bestFit(node, floor);
      // Si spezzano le parole solo se il corpo cresce davvero (almeno un quarto): per un testo normale non ne vale la pena.
      if (broken !== null && (plain === null || broken > plain * 1.25)) r = broken;
      else if (plain !== null) { node.removeAttribute("data-break"); r = plain; }
      else r = floor;   // nemmeno al minimo: resta il minimo, la carta taglia il resto
    }
  }
  // Un filo di margine (3%): la misura esatta è al limite e un arrotondamento o un carattere diverso la farebbe uscire di un pixel.
  if (r < 1) r *= 0.97;
  node.style.setProperty("--fit", String(r));
  node.dataset.fitSig = sig;
  return r;
}
/** @param {ParentNode} [root] */
function fitText(root = document) {
  /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(".black .text, .rail .card .txt, .pcard .txt")).forEach(fitNode);
}
let fitTimer = 0;
// Rotazione o finestra che cambia: si ricalcola (solo dove la carta ha cambiato misura).
const refit = () => { clearTimeout(fitTimer); fitTimer = window.setTimeout(() => fitText(app), 120); };
window.addEventListener("resize", refit);
window.addEventListener("orientationchange", refit);
// I caratteri del gioco arrivano dalla rete dopo il primo disegno e cambiano le misure del testo: appena sono pronti si rifà tutto.
if (document.fonts) {
  const refitFonts = () => {
    app.querySelectorAll("[data-fit-sig]").forEach((n) => { delete (/** @type {HTMLElement} */ (n)).dataset.fitSig; });
    refit();
  };
  document.fonts.ready.then(refitFonts);
  document.fonts.addEventListener("loadingdone", refitFonts);
}
document.head.append(el("style", {}, `
/* Testi: niente trattini né parole spezzate, ovunque. */
*, *::before, *::after { hyphens: none !important; -webkit-hyphens: none !important; }
.black .text, .card .txt, .pcard .txt { overflow-wrap: normal !important; word-break: normal !important; }
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
/* La combinazione scelta è la più grande che entra intera nella fila (larghezza e altezza). */
.stage .combo-row > .combo.sel { flex-basis: min(100cqw, 100cqh * 5 / 7); }
.stage .combo-row .combo.sel .black { width: 100%; line-height: 1.2; }
/* Jolly: carta bianca speciale, Memory e corona */
.card.jolly { background: var(--paper, #f3e9dc); color: #1a130f; }
.card.jolly { padding: 0; overflow: hidden; }
.jolly-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.jolly-typed { color: var(--accent); border-bottom: 3px solid var(--accent); padding: 0 3px; min-width: 6ch; display: inline-block; white-space: pre-wrap; }
.jolly-typed.empty { min-width: 8ch; }
.jolly-keys { position: fixed; left: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; border: 0; padding: 0; font-size: 16px; }
.typing .rail-block { display: none; }
.jolly-won { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.65); cursor: pointer; }
.jolly-won img { width: min(72vw, calc((100svh - 80px) * 5 / 7)); aspect-ratio: 5 / 7; border-radius: 14px; }
.jolly-word { display: inline-block; }
.jolly-crown { display: inline-block; width: 1.1em; height: .7em; margin-right: 4px; vertical-align: .15em; }
.jolly-crown svg { width: 100%; height: 100%; display: block; }
.memory { display: flex; flex-direction: column; gap: 8px; width: 100%; min-width: 0; }
.jolly-reveal { display: block; width: min(60vw, calc((100svh - 330px) * 5 / 7)); aspect-ratio: 5 / 7; margin: 0 auto; border-radius: 12px; animation: jollyIn .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes jollyIn { from { transform: scale(.3) rotate(-8deg); opacity: 0; } to { transform: none; opacity: 1; } }
.expired { position: fixed; left: 50%; top: 42%; z-index: 60; padding: 12px 18px; border-radius: 10px; background: var(--accent); color: #1a130f; font-weight: 800; text-align: center; pointer-events: none; transform: translate(-50%, -50%); animation: expiredIn 2.4s ease both; }
@keyframes expiredIn { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.6); } 12% { opacity: 1; transform: translate(-50%, -50%) scale(1.05); } 22% { transform: translate(-50%, -50%) rotate(-4deg); } 32% { transform: translate(-50%, -50%) rotate(4deg); } 42% { transform: translate(-50%, -50%) rotate(0); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(.95); } }
.memory-hint { margin: 0; font-size: 13px; color: var(--muted, #888); text-align: center; }
.memgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; width: min(100%, calc((100svh - 210px) * 5 / 7)); margin: 0 auto; }
.mtile { all: unset; box-sizing: border-box; cursor: pointer; position: relative; aspect-ratio: 5 / 7; perspective: 600px; border-radius: 8px; }
.mtile .mface { position: absolute; inset: 0; border-radius: 8px; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; transition: transform .45s cubic-bezier(.2,.8,.2,1); }
.mtile .mfront { transform: rotateY(180deg); background: hsl(var(--hue, 0deg) 40% 30%); }
.mtile .mfront img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mtile .mback { background: #0f0b08; border: 2px solid #3a2b22; display: flex; align-items: center; justify-content: center; }
.mtile.up .mback, .mtile.done .mback { transform: rotateY(180deg); }
.mtile.up .mfront, .mtile.done .mfront { transform: rotateY(0deg); }
.mtile.done { visibility: hidden; }
.mlogo { display: block; text-align: left; font-weight: 800; line-height: .98; letter-spacing: -.02em; color: #f3e9dc; font-size: clamp(6px, 2vw, 9px); }
.mlogo b, .mlogo em { display: block; }
.mlogo em { color: #e8875a; font-style: normal; }
.combo-ctrl { position: absolute; bottom: 14px; right: 14px; display: flex; gap: 10px; z-index: 5; }
.combo-ctrl button { all: unset; box-sizing: border-box; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #1a1410; font-size: 22px; font-weight: 800; box-shadow: 0 6px 16px -6px rgba(0,0,0,.6); cursor: pointer; }
.combo-ctrl button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

/* Respiro in alto, sotto la cornice dell'app. */
#app > .game { padding-top: 12px; box-sizing: border-box; }
`));
document.head.append(el("style", {}, `.switches { display: flex; gap: 8px; flex-wrap: wrap; }
.switches .switch { flex: 1 1 140px; }`));

// Quando si tocca un campo di testo, la pagina (o il foglio) si sposta in alto: la tastiera si apre sotto.
// Chiudo un foglio solo se il tocco è cominciato e finito sullo sfondo: se il campo di testo si sposta
// sotto il dito quando si apre la tastiera, il rilascio non deve chiudere la schermata.
let downTarget = null;
document.addEventListener("pointerdown", (e) => { downTarget = e.target; }, true);
// Chiusura dei fogli: scendono e sfumano, poi vengono tolti. Un solo passaggio per foglio.
function closeSheet(bg) {
  if (!bg || bg.dataset.closing) return;
  bg.dataset.closing = "1";
  bg.style.pointerEvents = "none";
  if (!motionOn() || !bg.animate) { bg.remove(); return; }
  const sheet = bg.querySelector(".sheet");
  bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" });
  if (sheet) sheet.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(40px)", opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" });
  setTimeout(() => bg.remove(), 210);
}
// Tastiera: il foglio resta in basso e si accorcia dell'altezza della tastiera (--kb), senza saltare in alto.
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty("--kb", kb + "px");
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
trackKeyboard();
// Campi nei fogli: il campo attivo viene portato al centro del foglio, che scorre da solo.
// Fuori dai fogli la pagina non si sposta da sola, salvo un campo finito sotto la metà dello schermo.
document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
  const sheet = t.closest(".sheet-bg");
  if (sheet) {
    // Una sola spostamento, e solo se il campo finisce coperto dalla tastiera.
    setTimeout(() => {
      const vv = window.visualViewport;
      const h = vv ? vv.height : window.innerHeight;
      const r = t.getBoundingClientRect();
      if (r.bottom > h - 12 || r.top < 80) t.scrollIntoView({ block: "nearest" });
    }, 300);
    return;
  }
  if (t.closest(".cards-screen")) return;
  if (t.getBoundingClientRect().bottom > window.innerHeight * 0.5) {
    setTimeout(() => t.scrollIntoView({ block: "center", behavior: "smooth" }), 350);
  }
});
// Il foglio resta in alto finché esiste: se tornasse giù al primo tocco fuori dal campo, il pulsante Salva cambierebbe posto.

// Design v2: strato finale di rifinitura (sorgente: tools/design-v2.css). Deve restare l'ultimo <style> aggiunto al head.
document.head.append(el("style", { id: "design-v2" }, `/*DESIGN_V2*/`));
