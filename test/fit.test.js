// Ogni giocatore che deve rispondere ha almeno due carte che entrano in ogni spazio della nera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, seededRng } from "../src/game.js";
import { blankAccepts } from "../src/agreement.js";

const cards = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
const fam = new Map(cards.white.map((w) => [w.id, w.family]));

test("il Re sceglie le sue carte; gli altri hanno sempre almeno due carte per ogni spazio", () => {
  const players = ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id }));
  const game = new Game(players, cards, { rng: seededRng(42) });
  game.start();
  let checked = 0;
  for (let round = 0; round < 120; round++) {
    const accepts = blankAccepts(game.currentBlack.text);
    for (const p of game.players) {
      if (p.id === game.judge.id) continue;
      for (const acc of accepts) {
        const n = p.hand.filter((id) => acc.includes(fam.get(id))).length;
        // Con poche carte rimaste nel mazzo il minimo può non bastare: conta solo se il mazzo ne ha abbastanza.
        const avail = game.deck.filter((id) => acc.includes(fam.get(id))).length + n;
        if (avail >= 2) {
          assert.ok(n >= 2, `round ${round}, ${p.id}: solo ${n} carte per "${game.currentBlack.text}"`);
          checked++;
        }
      }
    }
    // passa al turno successivo: il Re ruota e la nera cambia
    game.judgeIndex = (game.judgeIndex + 1) % game.players.length;
    game.beginRound([]);
  }
  assert.ok(checked > 100, "il controllo deve coprire molti turni");
});
