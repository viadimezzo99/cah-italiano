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
      reshuffledRound: null,   // ultimo turno in cui ha rimescolato la mano
    }));
    // Registro delle carte già uscite nella stanza: sopravvive alle partite, si azzera solo quando i mazzi sono finiti.
    this.pool = this.opts.pool ?? { white: new Set(), black: new Set() };
    this.allWhite = cards.white.map((c) => c.id);
    this.allBlack = cards.black.map((c) => c.id);
    this.discard = [];
    this.blackDiscard = [];
    this.deck = [];
    this.blackDeck = [];
    this.refillWhite();
    this.refillBlack();

    this.phase = "lobby"; // lobby | playing | judging | roundEnd | over
    this.round = 0;
    this.judgeIndex = -1;
    this.currentBlack = null;
    this.submissions = new Map(); // playerId -> cardIds
    this.revealOrder = []; // playerIds in ordine mischiato per il giudice
    this.lastWinner = null;
    this.peek = -1;        // quante combinazioni il Re ha già sfogliato: le altre le vedono in fila
    this.compare = false;  // il Re ha premuto "Vedi tutte": tutti vedono le combinazioni affiancate
    this.selected = null;  // la combinazione che il Re sta guardando, vista da tutti
    this.pickedIndex = null;
    this.winner = null;
  }

  // ---------------------------------------------------------------- mazzi

  // Ogni carta esce una volta prima che il mazzo ricominci: a mazzo esaurito si ricomincia dalle carte non ancora uscite.
  draw() {
    if (!this.deck.length) this.refillWhite();
    const id = this.deck.pop() ?? null;
    if (id !== null) this.pool.white.add(id);
    return id;
  }

  drawBlack() {
    if (!this.blackDeck.length) this.refillBlack();
    const id = this.blackDeck.pop() ?? null;
    if (id !== null) this.pool.black.add(id);
    return id;
  }

  // Nuovo mazzo bianco: prima le carte che non sono uscite nella stanza, poi tutte quelle non in gioco.
  refillWhite() {
    const inUse = new Set([...this.discard, ...this.players.flatMap((p) => p.hand)]);
    const fresh = this.allWhite.filter((id) => !inUse.has(id));
    const notRecent = fresh.filter((id) => !this.pool.white.has(id));
    if (!notRecent.length) this.pool.white.clear();
    this.deck = shuffle(notRecent.length ? notRecent : fresh.length ? fresh : this.allWhite, this.rng);
  }

  refillBlack() {
    const inUse = new Set([...this.blackDiscard, this.currentBlack?.id].filter(Boolean));
    const fresh = this.allBlack.filter((id) => !inUse.has(id));
    const notRecent = fresh.filter((id) => !this.pool.black.has(id));
    if (!notRecent.length) this.pool.black.clear();
    this.blackDeck = shuffle(notRecent.length ? notRecent : fresh.length ? fresh : this.allBlack, this.rng);
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
        this.pool.white.add(id);
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
      this.pickedIndex = null;
      this.compare = false;
      this.selected = null;
      // Tutti partono dalla prima combinazione: il Re bot le sfoglia come quello umano.
      this.peek = 0;
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

  /** Durante il giudizio chi non è il Re riceve il testo solo delle combinazioni già sfogliate. */
  revealFor(forPlayerId) {
    const all = this.reveal();
    if (this.phase !== "judging" || forPlayerId === this.judge?.id || this.compare) return all;
    return all.map((r) => (r.index <= this.peek ? r : { index: r.index, cards: null }));
  }

  /** Il Re ha sfogliato fino a questa combinazione: gli altri la vedono comparire. */
  peekTo(judgeId, index) {
    if (this.phase !== "judging" || judgeId !== this.judge.id) return;
    if (!Number.isInteger(index) || index < 0 || index >= this.revealOrder.length) return;
    this.peek = Math.max(this.peek, index);
  }

  /** Il Re ha premuto "Vedi tutte": tutti vedono le combinazioni affiancate. */
  compareAll(judgeId) {
    if (this.phase !== "judging" || judgeId !== this.judge.id) return;
    this.compare = true;
    this.peek = this.revealOrder.length - 1;
  }

  /** La combinazione che il Re sta guardando (o null): la vedono anche gli altri. */
  selectTo(judgeId, index) {
    if (this.phase !== "judging" || judgeId !== this.judge.id) return;
    this.selected = Number.isInteger(index) && index >= 0 && index < this.revealOrder.length ? index : null;
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
    this.pickedIndex = index;
    this.lastWinCards = this.submissions.get(winnerId).map((id) => this.text(id));
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
  /** Una volta per turno il giocatore rimescola la mano: le carte in mano vanno via e ne pesca altrettante nuove. */
  canReshuffle(playerId) {
    const p = this.players.find((x) => x.id === playerId);
    if (!p || this.phase !== "playing") return false;
    if (this.judge && this.judge.id === playerId) return false;
    if (this.submissions.has(playerId)) return false;
    return p.reshuffledRound !== this.round;
  }

  reshuffleHand(playerId) {
    if (!this.canReshuffle(playerId)) throw new Error("Non puoi rimescolare la mano adesso");
    const p = this.player(playerId);
    p.reshuffledRound = this.round;
    this.discard.push(...p.hand.splice(0));
    const events = [];
    this.fill(p, events);
    return events;
  }

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

  /** Il Re bot procede a passi: sfoglia le combinazioni, le affianca, sceglie e assegna il punto. Un passo ogni BOT_JUDGE_STEP_MS. */
  advanceBotJudge() {
    if (this.phase !== "judging" || !this.judge.isBot) return;
    const last = this.revealOrder.length - 1;
    if (this.peek < last) return this.peekTo(this.judge.id, this.peek + 1);
    if (!this.compare) return this.compareAll(this.judge.id);
    if (this.selected === null) return this.selectTo(this.judge.id, Math.floor(this.rng() * this.revealOrder.length));
    return this.pick(this.judge.id, this.selected);
  }

  /** Stato pubblico: nessuna carta coperta visibile a nessun altro giocatore. */
  publicState(forPlayerId) {
    return {
      phase: this.phase,
      round: this.round,
      canReshuffle: forPlayerId ? this.canReshuffle(forPlayerId) : false,
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
      reveal: this.revealFor(forPlayerId),
      peek: this.phase === "judging" ? this.peek : null,
      pickedIndex: this.phase === "roundEnd" ? this.pickedIndex : null,
      compare: this.phase === "judging" ? this.compare : false,
      selected: this.phase === "judging" ? this.selected : null,
      winnerCards: this.phase === "roundEnd" ? this.lastWinCards ?? [] : [],
      // La mia risposta, compilata: la vedo sulla carta nera anche mentre il Re sfoglia.
      mine: forPlayerId && this.submissions.has(forPlayerId) ? this.submissions.get(forPlayerId).map((id) => this.text(id)) : null,
      winner: this.winner,
    };
  }
}

// ------------------------------------------------------------ carte personali

const BLANK = "____";

/** Pulisce le carte personali: testo corto, nere con 1–3 spazi, id nuovi e sicuri. */
// Tetti per le carte personali di una partita: il messaggio di avvio non deve superare il limite dei frame (64 KB).
export const CUSTOM_MAX_WHITE = 1000;
export const CUSTOM_MAX_BLACK = 300;

export function sanitizeCustom(c) {
  const clean = (x) => String(x?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const catOf = (x) => String(x?.cat ?? "").replace(/\s+/g, " ").trim().slice(0, 20) || "Altro";
  const white = (Array.isArray(c?.white) ? c.white : []).slice(0, CUSTOM_MAX_WHITE)
    .map((x) => ({ text: clean(x), cat: catOf(x) })).filter((x) => x.text)
    .map((x, i) => ({ id: `u${i}`, ...x }));
  const black = (Array.isArray(c?.black) ? c.black : []).slice(0, CUSTOM_MAX_BLACK)
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
