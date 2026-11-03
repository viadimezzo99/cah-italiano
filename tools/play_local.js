// Partita locale da terminale: 4 bot, stampa ogni round con la frase completata.
// Uso: node tools/play_local.js [seme] [punteggioVittoria]
import { readFileSync } from "node:fs";
import { Game, seededRng } from "../src/game.js";

const seed = Number(process.argv[2] ?? 1);
const winScore = Number(process.argv[3] ?? 5);
const cards = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));

const names = ["Ada", "Bruno", "Chiara", "Dario"];
const players = names.map((name, i) => ({ id: `bot${i}`, name, isBot: true }));
const game = new Game(players, { white: cards.white, black: cards.black }, { rng: seededRng(seed), winScore });

// Riempie gli spazi della nera con le carte giocate, nell'ordine di gioco.
function fill(blackText, texts) {
  let i = 0;
  return blackText.replace(/____/g, () => `[${texts[i++] ?? "?"}]`);
}

game.start();
let guard = 0;
while (game.phase !== "over" && guard++ < 1000) {
  if (game.phase === "playing") {
    game.playBots();
  } else if (game.phase === "judging") {
    const reveal = game.reveal();
    const black = game.currentBlack.text;
    const picked = game.revealOrder.length ? game.revealOrder[0] : null;
    game.judgeIfBot();
    const winner = game.lastWinner;
    console.log(`\nRound ${game.round}  Re: ${game.judge.name}`);
    console.log(`  ${black}`);
    for (const r of reveal) {
      const filled = fill(black, r.cards.map((c) => c.text));
      console.log(`  - ${filled}`);
    }
    console.log(`  Vince: ${game.player(winner).name}`);
  } else if (game.phase === "roundEnd") {
    game.nextRound();
  }
}

console.log("\nPunteggi finali:");
for (const p of [...game.players].sort((a, b) => b.score - a.score)) {
  console.log(`  ${p.name.padEnd(8)} ${p.score}`);
}
console.log(`\nVincitore: ${game.player(game.winner).name}`);
