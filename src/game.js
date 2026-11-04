// Motore delle regole di Cards Against Humanity (versione italiana).
// Nessuna dipendenza esterna: gira identico nel server Node e nel client.
// Ogni mutazione restituisce una lista di eventi, utile per animare la UI.

export const DEFAULTS = {
  handSize: 10,
  winScore: 8, // le regole non fissano una fine: è un'opzione della stanza
};

// Generatore pseudo-casuale deterministico (mulberry32) per test ripetibili.
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, rng = Math.random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Divide il testo di una carta nera in segmenti, per disegnare gli spazi.
export function segments(text) {
  return text.split("____").flatMap((part, i, arr) => {
    const out = [{ type: "text", value: part }];
    if (i < arr.length - 1) out.push({ type: "blank", index: i });
    return out;
  });
}

export class Game {
  /**
   * @param {{id:string,name:string,isBot?:boolean}[]} players
   * @param {{white:{id:string,text:string}[], black:{id:string,text:string,blanks:number}[]}} cards
   * @param {{handSize?:number, winScore?:number|null, rng?:() => number}} options
   */
  constructor(players, cards, options = {}) {
    if (players.length < 3) throw new Error("Servono almeno 3 giocatori");
    const ids = new Set(players.map((p) => p.id));
    if (ids.size !== players.length) throw new Error("ID giocatori duplicati");

    this.opts = { ...DEFAULTS, ...options };
    this.rng = this.opts.rng ?? Math.random;
    this.cardText = new Map([...cards.white, ...cards.black].map((c) => [c.id, c.text]));
    this.catById = new Map([...cards.white, ...cards.black].map((c) => [c.id, c.cat ?? "Originali"]));
    this.whiteById = new Map(cards.white.map((c) => [c.id, c]));
    this.blackById = new Map(cards.black.map((c) => [c.id, c]));

    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: !!p.isBot,
      hand: [],
      score: 0,
    }));
    this.deck = shuffle(cards.white.map((c) => c.id), this.rng);
    this.discard = [];
    this.blackDeck = shuffle(cards.black.map((c) => c.id), this.rng);
    this.blackDiscard = [];

    this.phase = "lobby"; // lobby | playing | judging | roundEnd | over
    this.round = 0;
    this.judgeIndex = -1;
    this.currentBlack = null;
    this.submissions = new Map(); // playerId -> cardIds
    this.revealOrder = []; // playerIds in ordine mischiato per il giudice
    this.lastWinner = null;
    this.winner = null;
  }

  // ---------------------------------------------------------------- mazzi

  // Le carte già giocate non tornano nel mazzo: a mazzo esaurito la pesca si ferma.
  draw() {
    return this.deck.pop() ?? null;
  }

  drawBlack() {
    return this.blackDeck.pop() ?? null;
  }

  text(cardId) {
    return this.cardText.get(cardId);
  }

  get judge() {
    return this.judgeIndex >= 0 ? this.players[this.judgeIndex] : null;
  }

  player(id) {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new Error(`Giocatore sconosciuto: ${id}`);
    return p;
  }

  // ---------------------------------------------------------------- partita

  start() {
    if (this.phase !== "lobby") throw new Error("La partita è già iniziata");
    const events = [];
    this.dealOpening(events);
    for (const p of this.players) {
      this.fill(p, events);
    }
    this.judgeIndex = Math.floor(this.rng() * this.players.length);
    this.beginRound(events);
    return events;
  }

  // Pescata iniziale: per ogni giocatore almeno 4 Soggetti e 4 Azioni,
  // le altre carte a caso in categorie diverse. Nessuna carta è data a due giocatori.
  dealOpening(events) {
    const cat = (id) => this.catById.get(id);
    const pool = this.deck.slice();
    const takeOne = (pred) => {
      const i = pool.findIndex(pred);
      return i < 0 ? null : pool.splice(i, 1)[0];
    };
    for (const p of this.players) {
      const picks = [];
      for (let k = 0; k < 4; k++) {
        const id = takeOne((x) => cat(x) === "Soggetti");
        if (id !== null) picks.push(id);
      }
      for (let k = 0; k < 4; k++) {
        const id = takeOne((x) => cat(x) === "Azioni");
        if (id !== null) picks.push(id);
      }
      const usedCats = new Set();
      const others = Math.max(0, this.opts.handSize - picks.length);
      for (let k = 0; k < others; k++) {
        const id = takeOne((x) => !usedCats.has(cat(x)) && cat(x) !== "Soggetti" && cat(x) !== "Azioni")
          ?? takeOne(() => true);
        if (id === null) break;
        usedCats.add(cat(id));
        picks.push(id);
      }
      for (const id of picks) {
        p.hand.push(id);
        events.push({ type: "draw", playerId: p.id, cardId: id });
      }
    }
    this.deck = pool;
  }

  fill(player, events) {
    while (player.hand.length < this.opts.handSize) {
      const id = this.draw();
      if (id === null) break;
      player.hand.push(id);
      events.push({ type: "draw", playerId: player.id, cardId: id });
    }
  }

  beginRound(events) {
    if (this.currentBlack) this.blackDiscard.push(this.currentBlack.id);
    this.currentBlack = this.blackById.get(this.drawBlack());
    this.round += 1;
    this.submissions = new Map();
    this.revealOrder = [];
    this.phase = "playing";
    events.push({ type: "round", round: this.round, judgeId: this.judge.id, blackId: this.currentBlack.id });
  }

  /** Il giocatore invia le carte bianche per completare la nera. */
  play(playerId, cardIds) {
    if (this.phase !== "playing") throw new Error("Non è il momento di giocare");
    const p = this.player(playerId);
    if (p.id === this.judge.id) throw new Error("Il Re delle Carte non gioca carte bianche");
    if (this.submissions.has(playerId)) throw new Error("Hai già giocato");
    const need = this.currentBlack.blanks;
    if (cardIds.length !== need) throw new Error(`Servono ${need} carte`);
    if (new Set(cardIds).size !== cardIds.length) throw new Error("Carte duplicate");
    for (const id of cardIds) {
      if (!p.hand.includes(id)) throw new Error("Carta non in mano");
    }

    const events = [];
    for (const id of cardIds) {
      p.hand.splice(p.hand.indexOf(id), 1);
      this.discard.push(id);
    }
    this.submissions.set(playerId, cardIds.slice());
    events.push({ type: "played", playerId, cardIds: cardIds.slice() });

    const expected = this.players.length - 1;
    if (this.submissions.size === expected) {
      this.phase = "judging";
      this.revealOrder = shuffle([...this.submissions.keys()], this.rng);
      events.push({ type: "judging", count: this.revealOrder.length });
    }
    return events;
  }

  /** Versione per il giudice: le risposte senza nome. */
  reveal() {
    if (this.phase !== "judging") return [];
    return this.revealOrder.map((playerId, index) => ({
      index,
      cards: this.submissions.get(playerId).map((id) => ({ id, text: this.text(id) })),
    }));
  }

  /** Il Re sceglie la risposta preferita. */
  pick(judgeId, index) {
    if (this.phase !== "judging") throw new Error("Non ci sono risposte da giudicare");
    if (judgeId !== this.judge.id) throw new Error("Solo il Re può scegliere");
    if (!Number.isInteger(index) || index < 0 || index >= this.revealOrder.length) {
      throw new Error("Scelta non valida");
    }
    const winnerId = this.revealOrder[index];
    const winner = this.player(winnerId);
    winner.score += 1;
    this.lastWinner = winnerId;
    this.phase = "roundEnd";

    const events = [{ type: "picked", winnerId, index, blackId: this.currentBlack.id }];
    const turnEnd = this.checkWinner();
    if (turnEnd) events.push(turnEnd);
    return events;
  }

  checkWinner() {
    if (this.opts.winScore == null) return null;
    const top = this.players.reduce((a, b) => (b.score > a.score ? b : a));
    if (top.score >= this.opts.winScore) {
      this.winner = top.id;
      this.phase = "over";
      return { type: "gameOver", winnerId: top.id, score: top.score };
    }
    return null;
  }

  /** Dopo la scelta: rimette in mano le carte, passa il Re, apre la nuova nera. */
  nextRound() {
    if (this.phase !== "roundEnd") throw new Error("Il round non è ancora concluso");
    const events = [];
    this.judgeIndex = (this.judgeIndex + 1) % this.players.length;
    for (const p of this.players) this.fill(p, events);
    this.beginRound(events);
    return events;
  }

  // ------------------------------------------------ fallback per timeout / bot

  /** Gioca per conto di un giocatore: carte casuali, nell'ordine di pesca. */
  autoPlay(playerId) {
    const p = this.player(playerId);
    const n = this.currentBlack.blanks;
    const picks = shuffle(p.hand, this.rng).slice(0, n);
    return this.play(playerId, picks);
  }

  /** Il giudice non sceglie in tempo: viene scelta una risposta a caso. */
  autoPick() {
    const index = Math.floor(this.rng() * this.revealOrder.length);
    return this.pick(this.judge.id, index);
  }

  /** Gioca per tutti i bot che devono ancora rispondere. */
  playBots() {
    const events = [];
    if (this.phase !== "playing") return events;
    for (const p of this.players) {
      if (!p.isBot || p.id === this.judge.id || this.submissions.has(p.id)) continue;
      events.push(...this.autoPlay(p.id));
      if (this.phase !== "playing") break;
    }
    return events;
  }

  /** Se il giudice è un bot, sceglie per lui. */
  judgeIfBot() {
    if (this.phase === "judging" && this.judge.isBot) return this.autoPick();
    return [];
  }

  /** Stato pubblico: nessuna carta coperta visibile a nessun altro giocatore. */
  publicState(forPlayerId) {
    return {
      phase: this.phase,
      round: this.round,
      judgeId: this.judge?.id ?? null,
      black: this.currentBlack ? { id: this.currentBlack.id, text: this.currentBlack.text, blanks: this.currentBlack.blanks } : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        isBot: p.isBot,
        handSize: p.hand.length,
        hasPlayed: this.submissions.has(p.id),
        hand: p.id === forPlayerId ? p.hand.map((id) => ({ id, text: this.text(id), cat: this.catById.get(id) })) : undefined,
      })),
      reveal: this.reveal(),
      winner: this.winner,
    };
  }
}

// ------------------------------------------------------------ carte personali

const BLANK = "____";

/** Pulisce le carte personali: testo corto, nere con 1–3 spazi, id nuovi e sicuri. */
export function sanitizeCustom(c) {
  const clean = (x) => String(x?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const catOf = (x) => String(x?.cat ?? "").replace(/\s+/g, " ").trim().slice(0, 20) || "Altro";
  const white = (Array.isArray(c?.white) ? c.white : []).slice(0, 300)
    .map((x) => ({ text: clean(x), cat: catOf(x) })).filter((x) => x.text)
    .map((x, i) => ({ id: `u${i}`, ...x }));
  const black = (Array.isArray(c?.black) ? c.black : []).slice(0, 150)
    .map((x) => {
      let text = clean(x);
      if (!text) return null;
      if (!text.includes(BLANK)) text += ` ${BLANK}`;
      const blanks = text.split(BLANK).length - 1;
      return blanks <= 3 ? { text, blanks, cat: catOf(x) } : null;
    })
    .filter(Boolean)
    .map((x, i) => ({ id: `ub${i}`, ...x }));
  return { white, black };
}

/** Mazzo completo: carte originali più quelle personali. */
export function mergeCustom(cards, custom) {
  const extra = sanitizeCustom(custom);
  return { white: [...cards.white, ...extra.white], black: [...cards.black, ...extra.black] };
}

/** Carte personali attive: solo le categorie abilitate (default: tutte). */
export function enabledCustom(custom) {
  const enabled = custom?.enabled ?? {};
  const on = (c) => enabled[c.cat] !== false;
  return { white: (custom?.white ?? []).filter(on), black: (custom?.black ?? []).filter(on) };
}
