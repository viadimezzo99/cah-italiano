// Registro carte della stanza e rimescolo della mano.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game.js";

const white = Array.from({ length: 40 }, (_, i) => ({ id: `w${i}`, text: `Carta ${i}.` }));
const black = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, text: `Nera ${i} ____.`, blanks: 1 }));
const players = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
let seed = 3;
const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("le bianche non si ripetono nella stanza finché il mazzo non è finito", () => {
  const pool = { white: new Set(), black: new Set() };
  const seen = [];
  for (let g = 0; g < 3; g++) {
    const game = new Game(players, { white, black }, { pool, rng, winScore: 1 });
    game.start();
    for (const p of game.players) seen.push(...p.hand);
  }
  // 3 partite x 3 giocatori x 10 carte = 90 carte pescate su 40 bianche: la prima metà non deve ripetersi.
  const firstLap = seen.slice(0, 40);
  assert.equal(new Set(firstLap).size, 40);
});

test("le nere non si ripetono nella stanza finché non finiscono", () => {
  const pool = { white: new Set(), black: new Set() };
  const used = [];
  for (let g = 0; g < 2; g++) {
    const game = new Game(players, { white, black }, { pool, rng, winScore: 1 });
    game.start();
    used.push(game.currentBlack.id);
    for (let r = 0; r < 5; r++) used.push(game.drawBlack());
  }
  assert.equal(new Set(used).size, 12);
});

test("il rimescolo: una volta per turno, dieci carte nuove", () => {
  const game = new Game(players, { white, black }, { rng, winScore: 1 });
  game.start();
  const me = game.players.find((p) => p.id !== game.judge.id);
  assert.equal(game.canReshuffle(me.id), true);
  const before = [...me.hand];
  game.reshuffleHand(me.id);
  assert.equal(me.hand.length, 10);
  assert.equal(me.hand.filter((id) => before.includes(id)).length, 0);
  assert.equal(game.canReshuffle(me.id), false);
  assert.throws(() => game.reshuffleHand(me.id));
  assert.equal(game.canReshuffle(game.judge.id), false);
});
