import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, seededRng, segments } from "../src/game.js";

const cards = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));

function newGame(n = 4, opts = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `G${i}`, isBot: false }));
  return new Game(players, { white: cards.white, black: cards.black }, { rng: seededRng(42), ...opts });
}

test("servono almeno 3 giocatori", () => {
  assert.throws(() => newGame(2), /almeno 3/);
});

test("start: ogni giocatore ha 10 carte e un Re viene scelto", () => {
  const g = newGame(4);
  g.start();
  for (const p of g.players) assert.equal(p.hand.length, 10);
  assert.ok(g.judge);
  assert.equal(g.phase, "playing");
  assert.equal(g.round, 1);
});

test("nessuna carta duplicata tra mani e mazzi", () => {
  const g = newGame(5);
  g.start();
  const all = [...g.players.flatMap((p) => p.hand), ...g.deck, ...g.discard];
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, cards.white.length);
});

test("il Re non può giocare carte bianche", () => {
  const g = newGame(4);
  g.start();
  assert.throws(() => g.play(g.judge.id, [g.judge.hand[0]]), /Re delle Carte/);
});

test("il numero di carte deve corrispondere agli spazi della nera", () => {
  const g = newGame(4);
  g.start();
  const p = g.players.find((x) => x.id !== g.judge.id);
  assert.equal(g.currentBlack.blanks, 1);
  assert.throws(() => g.play(p.id, [p.hand[0], p.hand[1]]), /Servono 1/);
});

test("non si può giocare due volte nello stesso round", () => {
  const g = newGame(4);
  g.start();
  const p = g.players.find((x) => x.id !== g.judge.id);
  g.play(p.id, [p.hand[0]]);
  assert.throws(() => g.play(p.id, [p.hand[0]]), /Hai già giocato/);
});

test("le carte giocate escono dalla mano e la fase passa a judging", () => {
  const g = newGame(4);
  g.start();
  const others = g.players.filter((x) => x.id !== g.judge.id);
  for (const p of others) {
    const before = p.hand.length;
    g.play(p.id, [p.hand[0]]);
    assert.equal(p.hand.length, before - 1);
  }
  assert.equal(g.phase, "judging");
  assert.equal(g.reveal().length, others.length);
});

test("le risposte rivelate non espongono chi le ha giocate", () => {
  const g = newGame(4);
  g.start();
  for (const p of g.players.filter((x) => x.id !== g.judge.id)) g.play(p.id, [p.hand[0]]);
  const reveal = g.reveal();
  for (const r of reveal) assert.equal("playerId" in r, false);
});

test("il giudice sceglie: il vincitore prende un punto e il Re ruota", () => {
  const g = newGame(4);
  g.start();
  const firstJudge = g.judge.id;
  for (const p of g.players.filter((x) => x.id !== g.judge.id)) g.play(p.id, [p.hand[0]]);
  const winnerId = g.revealOrder[0];
  g.pick(firstJudge, 0);
  assert.equal(g.player(winnerId).score, 1);
  assert.equal(g.phase, "roundEnd");
  g.nextRound();
  assert.notEqual(g.judge.id, firstJudge);
  assert.equal(g.round, 2);
});

test("solo il Re può scegliere", () => {
  const g = newGame(4);
  g.start();
  for (const p of g.players.filter((x) => x.id !== g.judge.id)) g.play(p.id, [p.hand[0]]);
  const notJudge = g.players.find((x) => x.id !== g.judge.id);
  assert.throws(() => g.pick(notJudge.id, 0), /Solo il Re/);
});

test("dopo ogni round tutti tornano a 10 carte", () => {
  const g = newGame(4);
  g.start();
  for (let round = 0; round < 5; round++) {
    const others = g.players.filter((x) => x.id !== g.judge.id);
    for (const p of others) {
      const k = g.currentBlack.blanks;
      g.play(p.id, p.hand.slice(0, k));
    }
    g.pick(g.judge.id, 0);
    g.nextRound();
    for (const p of g.players) assert.equal(p.hand.length, 10);
  }
});

test("carte a due spazi: l'ordine giocato è quello conservato", () => {
  const g = newGame(4, { winScore: null });
  g.start();
  // Forza una nera a due spazi.
  g.currentBlack = cards.black.find((b) => b.blanks === 2);
  const p = g.players.find((x) => x.id !== g.judge.id);
  const [a, b] = [p.hand[0], p.hand[1]];
  g.play(p.id, [b, a]);
  assert.deepEqual(g.submissions.get(p.id), [b, a]);
});

test("timeout: autoPlay sceglie carte casuali valide", () => {
  const g = newGame(4);
  g.start();
  const p = g.players.find((x) => x.id !== g.judge.id);
  const before = p.hand.length;
  g.autoPlay(p.id);
  assert.equal(p.hand.length, before - g.currentBlack.blanks);
  assert.ok(g.submissions.has(p.id));
});

test("timeout: autoPick sceglie una risposta valida", () => {
  const g = newGame(3);
  g.start();
  for (const p of g.players.filter((x) => x.id !== g.judge.id)) g.autoPlay(p.id);
  g.autoPick();
  assert.equal(g.phase, "roundEnd");
  assert.equal(g.players.reduce((s, p) => s + p.score, 0), 1);
});

test("fine partita quando qualcuno raggiunge winScore", () => {
  const players = [
    { id: "a", name: "A", isBot: true },
    { id: "b", name: "B", isBot: true },
    { id: "c", name: "C", isBot: true },
  ];
  const g = new Game(players, { white: cards.white, black: cards.black }, { rng: seededRng(3), winScore: 2 });
  g.start();
  for (let i = 0; i < 500 && g.phase !== "over"; i++) {
    if (g.phase === "playing") g.playBots();
    else if (g.phase === "judging") g.advanceBotJudge();
    else if (g.phase === "roundEnd") g.nextRound();
  }
  assert.equal(g.phase, "over");
  assert.ok(g.winner);
});

test("partita completa con soli bot termina", () => {
  const players = [
    { id: "a", name: "A", isBot: true },
    { id: "b", name: "B", isBot: true },
    { id: "c", name: "C", isBot: true },
    { id: "d", name: "D", isBot: true },
  ];
  const g = new Game(players, { white: cards.white, black: cards.black }, { rng: seededRng(7), winScore: 5 });
  g.start();
  for (let i = 0; i < 2000 && g.phase !== "over"; i++) {
    if (g.phase === "playing") g.playBots();
    else if (g.phase === "judging") g.advanceBotJudge();
    else if (g.phase === "roundEnd") g.nextRound();
  }
  assert.equal(g.phase, "over");
  assert.ok(Math.max(...g.players.map((p) => p.score)) >= 5);
});

test("publicState non mostra la mano degli altri", () => {
  const g = newGame(4);
  g.start();
  const s = g.publicState("p0");
  for (const p of s.players) {
    if (p.id === "p0") assert.equal(p.hand.length, 10);
    else assert.equal(p.hand, undefined);
  }
});

test("segments: spazi come segmenti separati", () => {
  const seg = segments("Si, ho ucciso ____ Ti domandi come? ____");
  const blanks = seg.filter((s) => s.type === "blank");
  assert.equal(blanks.length, 2);
  assert.deepEqual(blanks.map((b) => b.index), [0, 1]);
});

import { sanitizeCustom, mergeCustom } from "../src/game.js";

test("carte personali: nere con spazi corretti, limiti e id separati", () => {
  const c = sanitizeCustom({
    white: [{ text: "  Un   gatto " }, { text: "" }, null],
    black: [{ text: "Ieri ____ e oggi ____" }, { text: "Senza spazi" }, { text: "____ ____ ____ ____" }],
  });
  assert.deepEqual(c.white, [{ id: "u0", text: "Un gatto", cat: "Altro" }]);
  assert.equal(c.black.length, 2, "quattro spazi scartati");
  assert.equal(c.black[0].blanks, 2);
  assert.equal(c.black[1].text, "Senza spazi ____");
  assert.equal(c.black[1].blanks, 1);
});

test("mazzo unito: originali più personali, senza collisioni di id", () => {
  const base = { white: [{ id: "w001", text: "a" }], black: [{ id: "b001", text: "x ____", blanks: 1 }] };
  const m = mergeCustom(base, { white: [{ text: "nuova" }], black: [] });
  assert.equal(m.white.length, 2);
  assert.equal(new Set(m.white.map((c) => c.id)).size, 2);
  assert.equal(mergeCustom(base, undefined).white.length, 1);
});

test("categorie: ogni carta personale porta la sua categoria fino in mano", () => {
  const c = sanitizeCustom({ white: [{ text: "Un gatto", cat: "Soggetti" }], black: [{ text: "Qui ____", cat: "Luoghi" }] });
  assert.equal(c.white[0].cat, "Soggetti");
  assert.equal(c.black[0].cat, "Luoghi");
  const g = new Game(
    [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    mergeCustom({ white: [{ id: "w1", text: "x" }], black: [{ id: "b1", text: "y ____", blanks: 1 }] }, { white: [{ text: "Un gatto", cat: "Soggetti" }] }),
    { rng: () => 0.5 },
  );
  g.start();
  const hand = g.publicState("a").players.find((p) => p.id === "a").hand;
  assert.ok(hand.every((card) => typeof card.cat === "string"));
});

test("durante il giudizio chi non è il Re vede solo le combinazioni già sfogliate", () => {
  const g = newGame(4);
  g.start();
  for (const p of g.players.filter((x) => x.id !== g.judge.id)) g.play(p.id, [p.hand[0]]);
  assert.equal(g.phase, "judging");
  g.peekTo(g.judge.id, 1);
  const other = g.players.find((x) => x.id !== g.judge.id).id;
  const seen = g.publicState(other).reveal;
  assert.ok(seen[0].cards && seen[1].cards);
  assert.equal(seen[2].cards, null);
  assert.ok(g.publicState(g.judge.id).reveal.every((r) => r.cards));
  g.compareAll(g.judge.id);
  assert.ok(g.publicState(other).reveal.every((r) => r.cards));
});
