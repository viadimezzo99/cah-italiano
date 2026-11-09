// Test delle cornici: per ogni carta nera prova le carte bianche di ogni famiglia
// grammaticale e stampa la frase che ne esce, più i controlli meccanici (spazi rimasti,
// articoli doppi, preposizioni sbagliate). Il giudizio sul senso resta a chi legge.
//
// Uso:
//   node tools/test_cornici.mjs                 # tutte le carte nere
//   node tools/test_cornici.mjs b168 b170       # solo le carte indicate
//   node tools/test_cornici.mjs --n 5           # quante bianche per famiglia (default 4)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { sentencePlain } from "../src/agreement.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(readFileSync(join(HERE, "..", "data", "cards.json"), "utf8"));

const args = process.argv.slice(2);
const nIdx = args.indexOf("--n");
const perFamily = nIdx >= 0 ? Number(args[nIdx + 1]) : 4;
const ids = args.filter((a, i) => a !== "--n" && (nIdx < 0 || i !== nIdx + 1));

const families = {};
for (const w of cards.white) (families[w.family] ??= []).push(w);

// Se la carta ha più spazi, la combinazione è: ogni spazio riceve una bianca della stessa famiglia.
function combos(card, k) {
  const fams = Object.keys(families);
  const out = [];
  for (const fam of fams) {
    const pool = families[fam];
    for (let s = 0; s < k; s++) {
      const picks = [];
      for (let b = 0; b < card.blanks; b++) picks.push(pool[(s * 7 + b * 13) % pool.length].text);
      out.push({ fam, picks });
    }
  }
  return out;
}

// Controlli meccanici sulla frase generata.
function flags(s) {
  const f = [];
  if (s.includes("____")) f.push("spazio-rimasto");
  if (/\b(il|lo|la|un|una|uno|i|gli|le)\s+(il|lo|la|un|una|uno|i|gli|le)\b/i.test(s)) f.push("articolo-doppio");
  if (/\b(di|a|da|in|su)\s+(il|lo|la|i|gli|le)\b/i.test(s)) f.push("prep-senza-articolo");
  if (/\s[,.]/.test(s.replace(/\.\.\./g, ""))) f.push("punteggiatura");
  if (/\b(imparato|rifiutato|cominciato|riuscito)\s+a\s+(un|una|uno|il|lo|la|i|gli|le)\s/i.test(s)) f.push("verbo-a-con-articolo");
  return f;
}

const targets = cards.black.filter((c) => ids.length === 0 || ids.includes(c.id));
let problems = 0;
for (const card of targets) {
  console.log(`\n== ${card.id} (${card.blanks} ${card.blanks === 1 ? "spazio" : "spazi"}): ${card.text}`);
  for (const { fam, picks } of combos(card, perFamily)) {
    const s = sentencePlain(card.text, picks);
    const f = flags(s);
    if (f.length) problems++;
    console.log(`  [${fam}] ${s}${f.length ? "   <-- " + f.join(", ") : ""}`);
  }
}
console.log(`\n${targets.length} carte, ${problems} righe con problemi meccanici.`);
