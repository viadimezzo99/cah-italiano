import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, JOLLY, seededRng } from "../src/game.js";

function setup(seed = 7) {
  const white = Array.from({ length: 80 }, (_, i) => ({ id: "w" + i, text: "Carta " + i }));
  const black = Array.from({ length: 20 }, (_, i) => ({ id: "b" + i, text: "Nera ____ " + i, blanks: 1 }));
  const players = ["A", "B", "C", "D"].map((n, i) => ({ id: "p" + i, name: n }));
  const g = new Game(players, { white, black }, { rng: seededRng(seed), winScore: null });
  g.start();
  return g;
}

test("il Re che finisce il Memory in tempo vince il jolly, una sola volta", () => {
  const g = setup();
  const judge = g.judge.id;
  const ev = g.awardJolly(judge);
  assert.equal(ev[0].type, "jolly");
  assert.equal(g.jollyHolder, judge);
  assert.ok(g.player(judge).hand.includes(JOLLY));
  assert.deepEqual(g.awardJolly(judge), [], "non si rivince finché è in mano");
});

test("il jolly è un'undicesima carta: dopo la pesca restano 10 normali più il jolly", () => {
  const g = setup();
  const judge = g.judge.id;
  g.awardJolly(judge);
  for (const p of g.players.filter((x) => x.id !== judge)) g.play(p.id, [p.hand[0]]);
  g.pick(judge, 0);
  g.nextRound();
  const holder = g.player(judge);
  assert.equal(holder.hand.filter((x) => x !== JOLLY).length, 10);
  assert.ok(holder.hand.includes(JOLLY));
});

test("il Re non vince il jolly se il turno è già completo", () => {
  const g = setup();
  const others = g.players.filter((p) => p.id !== g.judge.id);
  for (const p of others) g.play(p.id, [p.hand[0]]);
  assert.equal(g.phase, "judging");
  assert.deepEqual(g.awardJolly(g.judge.id), []);
});

test("giocare il jolly richiede il testo e lo mette nella combinazione", () => {
  const g = setup();
  const judge = g.judge.id;
  const holder = g.players.find((p) => p.id !== judge);
  holder.hand.push(JOLLY);
  g.jollyHolder = holder.id;
  assert.throws(() => g.play(holder.id, [JOLLY], ""), /testo/);
  assert.throws(() => g.play(holder.id, [JOLLY], "x".repeat(81)), /caratteri/);
  g.play(holder.id, [JOLLY], "  Vince   il   tostapane  ");
  assert.equal(g.jollyHolder, null, "dopo l'uso il jolly torna libero");
  assert.ok(!holder.hand.includes(JOLLY));
  assert.ok(!g.discard.includes(JOLLY));
  assert.equal(g.cardTextFor(holder.id, JOLLY), "Vince il tostapane");
});

test("il jolly non si gioca se non è tuo", () => {
  const g = setup();
  const judge = g.judge.id;
  g.awardJolly(judge);
  const other = g.players.find((p) => p.id !== judge);
  other.hand.push(JOLLY);
  assert.throws(() => g.play(other.id, [JOLLY], "ciao"), /non è tuo/);
});

test("il bot non gioca mai il jolly per conto di un giocatore", () => {
  const g = setup();
  const judge = g.judge.id;
  const other = g.players.find((p) => p.id !== judge);
  other.hand.push(JOLLY);
  g.jollyHolder = other.id;
  for (let k = 0; k < 20; k++) {
    const g2 = setup(k + 1);
    const o = g2.players.find((p) => p.id !== g2.judge.id);
    o.hand.push(JOLLY);
    g2.jollyHolder = o.id;
    const picks = g2.autoPlay(o.id);
    assert.ok(!picks.includes(JOLLY));
  }
});

test("rimescolare la mano conserva il jolly", () => {
  const g = setup();
  const judge = g.judge.id;
  g.awardJolly(judge);
  const other = g.players.find((p) => p.id !== judge);
  g.reshuffleHand(other.id);
  g.awardJolly(judge); // no-op, già assegnato
  assert.equal(g.jollyHolder, judge);
});
