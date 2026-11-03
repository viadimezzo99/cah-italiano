// Interfaccia da tavolo: logo, setup, partita locale (più persone e bot), impostazioni, animazioni.
const app = document.getElementById("app");
const MAX_HUMANS = 6;

const FONTS = {
  moderno: { label: "Moderno", css: '"Bricolage Grotesque", system-ui, sans-serif' },
  classico: { label: "Classico", css: 'Fraunces, Georgia, serif' },
  tecnico: { label: "Tecnico", css: '"IBM Plex Sans", system-ui, sans-serif' },
  fumetto: { label: "Fumetto", css: '"Permanent Marker", cursive' },
};
const DEFAULT_SETTINGS = { theme: "system", font: "moderno", textScale: 1, cardScale: 1, music: false, musicVol: 0.6, sfx: true, motion: true };

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
let cfg = { names: ["Tu"], bots: 2, winScore: 5 };
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
    el("button", { type: "button", class: "ghost", onclick: () => { settings = { ...DEFAULT_SETTINGS }; saveSettings(); applySettings(); rebuild(); } }, "Ripristina predefiniti"),
  ];

  const sheet = el("div", { class: "sheet", role: "dialog", "aria-label": "Impostazioni" }, buildSheetContent());
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } }, sheet);
  document.body.append(bg);
}

// ------------------------------------------------------------------ logo

function logoNode(big = false) {
  const svg = `<svg viewBox="0 0 120 96" aria-hidden="true">
    <rect x="10" y="14" width="56" height="76" rx="9" fill="#111" transform="rotate(-10 38 52)"/>
    <rect x="50" y="10" width="56" height="76" rx="9" fill="#fff" stroke="#111" stroke-width="3" transform="rotate(8 78 48)"/>
    <circle cx="30" cy="36" r="5" fill="#c4502a" transform="rotate(-10 38 52)"/>
    <text x="78" y="62" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="30" fill="#111" text-anchor="middle" transform="rotate(8 78 48)">?</text>
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
  clearTimeout(botTimer); clearTimeout(judgeTimer);
  const modeBtn = (mode, title, sub) => el("button", {
    type: "button", class: "mode", "aria-pressed": String(homeTab === mode),
    onclick: () => { homeTab = mode; setup(); },
  }, el("strong", {}, title), el("span", { class: "sub" }, sub));
  app.replaceChildren(
    el("section", { class: "setup" },
      el("div", { class: "hero" },
        logoNode(true),
        el("p", { class: "tagline" }, "Carte italiane. Gioca sullo stesso telefono, o con gli amici in una stanza.")),
      el("div", { class: "modes", role: "group", "aria-label": "Modalità" },
        modeBtn("local", "Stesso telefono", "Con amici e bot"),
        modeBtn("online", "Online", "Stanza con codice")),
      homeTab === "online" ? onlinePanel() : localPanel(),
      el("button", { type: "button", class: "ghost settings-btn", onclick: openSettings }, "⚙ Impostazioni")));
}

function localPanel() {
  const total = () => cfg.names.length + cfg.bots;
  const hint = el("p", { class: "hidden-msg" });
  const startBtn = el("button", { class: "primary", type: "button", onclick: start }, "Inizia la partita");

  const refresh = () => {
    const ok = total() >= 3;
    startBtn.disabled = !ok;
    hint.textContent = ok ? `${total()} giocatori in tutto (${cfg.names.length} ${cfg.names.length === 1 ? "persona" : "persone"}, ${cfg.bots} bot).`
      : "Servono almeno 3 giocatori: aggiungi una persona o un bot.";
  };

  const nameRows = () => cfg.names.map((n, i) => el("div", { class: "nrow" },
    el("input", { type: "text", value: n, maxlength: "16", placeholder: `Giocatore ${i + 1}`, "aria-label": `Nome giocatore ${i + 1}`,
      oninput: (e) => { cfg.names[i] = e.target.value; refresh(); } }),
    cfg.names.length > 1 ? el("button", { type: "button", class: "ghost", "aria-label": "Rimuovi", onclick: () => { cfg.names.splice(i, 1); setup(); } }, "✕") : null));

  const botBtns = [0, 1, 2, 3].map((n) => el("button", {
    type: "button", "aria-pressed": String(cfg.bots === n),
    onclick: () => { cfg.bots = n; setup(); },
  }, n === 0 ? "Nessuno" : `${n} bot`));
  const winBtns = [3, 5, 8].map((n) => el("button", {
    type: "button", "aria-pressed": String(cfg.winScore === n),
    onclick: () => { cfg.winScore = n; setup(); },
  }, `${n} punti`));

  refresh();
  return el("div", { class: "panel" },
    el("span", { class: "label" }, `Giocatori (${cfg.names.length}/${MAX_HUMANS})`),
    el("div", { class: "names" }, nameRows()),
    cfg.names.length < MAX_HUMANS ? el("button", { type: "button", class: "ghost", onclick: () => { cfg.names.push(""); setup(); } }, "+ Aggiungi persona") : null,
    el("span", { class: "label" }, "Bot"),
    el("div", { class: "seg" }, botBtns),
    el("span", { class: "label" }, "Vittoria"),
    el("div", { class: "seg" }, winBtns),
    hint,
    startBtn);
}

function start() {
  unlocked = true;
  applySettings();
  const names = cfg.names.map((n, i) => (n || "").trim().slice(0, 16) || `Giocatore ${i + 1}`);
  const players = names.map((name, i) => ({ id: `h${i}`, name }));
  for (let i = 1; i <= cfg.bots; i++) players.push({ id: `bot${i}`, name: `Bot ${i}`, isBot: true });
  game = new Game(players, CARDS, { winScore: cfg.winScore });
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

// ------------------------------------------------------------------ partita

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
          : el("button", { class: "primary", type: "button", onclick: () => { judgeMode = "compare"; enterPending = true; Sound.play("flip"); render(); } }, "Vedi tutte e tre"));
    } else {
      note = el("p", { class: "hidden-msg" }, "Tutte le combinazioni. Scegli quella che ti ha fatto ridere di più.");
      const enter = enterPending;
      enterPending = false;
      rail = el("div", { class: "minis", role: "group", "aria-label": "Combinazioni" },
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
    railLabel = `La tua mano · ${me.hand.length} carte`;
    const deal = dealPending;
    dealPending = false;
    rail = el("div", { class: "rail", role: "group", "aria-label": "La tua mano" },
      me.hand.map((c, i) => {
        const idx = selected.indexOf(c.id);
        const full = selected.length >= need && idx < 0;
        const held = { v: false };
        const node = el("button", {
          class: "card" + (idx >= 0 ? " sel" : "") + (deal ? " deal" : ""),
          type: "button",
          disabled: !canSelect || full,
          "aria-pressed": String(idx >= 0),
          onclick: () => {
            if (held.v) { held.v = false; return; }
            if (idx >= 0) selected.splice(idx, 1);
            else selected.push(c.id);
            Sound.play("pick");
            render();
          },
        }, el("span", { class: "num" }, idx >= 0 ? String(idx + 1) : ""), el("span", { class: "txt" }, c.text));
        node.style.setProperty("--i", i);
        attachHold(node, () => { held.v = true; Sound.play("flip"); showZoom(c.text); });
        return node;
      }));
    if (canSelect) {
      actions = el("div", { class: "actions" },
        el("span", { class: "status" }, need > 1 ? `${selected.length}/${need} · nell'ordine di lettura` : `${selected.length}/${need}`),
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

  app.replaceChildren(
    el("div", { class: "game" },
      el("header", { class: "hud" }, topbar, board, roundline),
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
let homeTab = "local";   // "local" | "online" nella schermata iniziale
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
const loadServer = () => {
  try { return localStorage.getItem(SERVER_KEY) || ""; } catch { return ""; }
};
const saveServer = (v) => {
  try { localStorage.setItem(SERVER_KEY, v); } catch { /* nessuno storage */ }
};

// Indirizzo del WebSocket: stesso server se la pagina è servita da lì, altrimenti quello scelto (app).
function socketUrl() {
  if (ONLINE_OK) return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
  let base = loadServer().trim().replace(/\/+$/, "");
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
  const serverIn = el("input", { type: "url", placeholder: "https://… indirizzo del server", "aria-label": "Indirizzo del server",
    value: loadServer(), oninput: (e) => {
      saveServer(e.target.value.trim());
      // cambiato server: chiudo la connessione vecchia, la prossima azione apre quella nuova
      const old = onlineSock;
      onlineSock = null;
      if (old) old.close();
    } });
  return el("div", { class: "panel" },
    el("span", { class: "label" }, "Il tuo nome"),
    nameIn,
    !ONLINE_OK ? el("span", { class: "label" }, "Server online") : null,
    !ONLINE_OK ? serverIn : null,
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
function attachHold(node, fn) {
  let t = null;
  const cancel = () => clearTimeout(t);
  node.addEventListener("pointerdown", () => { t = setTimeout(fn, 380); });
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
          ? el("button", { type: "button", class: "primary", disabled: !ok, onclick: () => netSend({ type: "start", winScore: onlineWin }) }, "Avvia partita")
          : el("p", { class: "hidden-msg" }, ok ? "In attesa che l'host avvii la partita." : "Servono almeno 3 giocatori per iniziare."),
        isHost && !ok ? el("p", { class: "hidden-msg" }, "Servono almeno 3 giocatori.") : null,
        el("button", { type: "button", class: "ghost", onclick: exitGame }, "Esci dalla stanza"))));
}

function boot() {
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

applySettings();
boot();
