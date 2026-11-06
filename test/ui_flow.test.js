import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, seededRng } from "../src/game.js";

const cards = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));

// Replica il flusso dell'interfaccia: il giocatore umano sceglie a caso, i bot giocano da soli.
test("flusso interfaccia: umano + 3 bot fino alla fine", () => {
  const players = [
    { id: "me", name: "Tu" },
    { id: "bot1", name: "Bot 1", isBot: true },
    { id: "bot2", name: "Bot 2", isBot: true },
    { id: "bot3", name: "Bot 3", isBot: true },
  ];
  const g = new Game(players, cards, { winScore: 3, rng: seededRng(11) });
  g.start();
  for (let i = 0; i < 3000 && g.phase !== "over"; i++) {
    if (g.phase === "playing") {
      g.playBots();
      if (g.judge.id !== "me" && !g.submissions.has("me")) {
        const me = g.player("me");
        g.play("me", me.hand.slice(0, g.currentBlack.blanks));
      }
    } else if (g.phase === "judging") {
      if (g.judge.id === "me") g.pick("me", 0);
      else g.advanceBotJudge();
    } else if (g.phase === "roundEnd") {
      g.nextRound();
    }
  }
  assert.equal(g.phase, "over");
  const s = g.publicState("me");
  assert.ok(s.players.find((p) => p.id === "me").hand.length <= 10);
  assert.ok(g.winner);
});
