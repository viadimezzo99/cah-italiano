// Classifica le carte bianche per forma grammaticale e scrive il campo "family" in data/cards.json.
// Serve solo al motore e allo sviluppo: il giocatore non vede la famiglia.
//
//   node tools/classify_cards.mjs [lexicon_dir] [cards.json]
//
// lexicon_dir: cartella con lex.json (default data/lexicon_it). Senza lessico il comando si ferma.
// Le famiglie sono in ordine di priorità: la prima regola che combacia vince.
// Una carta che nessuna regola riconosce resta "SCONOSCIUTA" e va rivista a mano.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const lexDir = process.argv[2] || join(HERE, "..", "data", "lexicon_it");
const cardsPath = process.argv[3] || join(HERE, "..", "data", "cards.json");

const lexFile = join(lexDir, "lex.json");
if (!existsSync(lexFile)) {
  console.error(`Lessico non trovato: ${lexFile}. Passa la cartella come primo argomento.`);
  process.exit(1);
}
const LEX = JSON.parse(readFileSync(lexFile, "utf8"));

const DET = /^(il|lo|la|l'|i|gli|le|un|uno|una|un'|dei|degli|delle|questo|questa|quel|quella|mio|mia|tuo|tua|suo|sua|nostro|nostra|molti|molte|tanti|tante|alcuni|alcune|ogni|nessun|nessuna|qualche)\b/i;
const NUM = /^(\d+|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|cento|mille|tutti|tutte|venti|trenta|quaranta|cinquanta|sessanta|settanta|ottanta|novanta)\b/i;
const PREP = /^(di|a|da|in|su|con|per|tra|fra)\s/i;
const CLAUSE = /\b(che|quando|mentre|dove|perché|perche)\b/i;
const PARTICIPLE = /(ato|uto|ito|oso|ile|ante|ente)$/;

const low = (s) => s.toLowerCase().replace(/[^\p{L}'\d]/gu, "");
const codes = (w) => LEX[low(w)] || [];
const isN = (w) => codes(w).some((c) => c.startsWith("N"));
const isV = (w) => codes(w).some((c) => c.startsWith("V"));
const isA = (w) => codes(w).some((c) => c.startsWith("A"));
const isInfEnding = (w) => /(are|ere|ire)(rsi)?$/.test(low(w)) && low(w).length > 3;

export function familyOf(text) {
  const w = text.trim().replace(/[.!?]+$/, "");
  const ws = w.split(/\s+/);
  const f = ws[0];
  if (ws.length >= 6 || (/,/.test(w) && ws.length >= 5) || CLAUSE.test(w)) return "FRASE";
  if (NUM.test(w) && ws.length >= 2) return "NUMERO_NOME";
  if (DET.test(w)) return "NOME_DETERMINATO";
  if (PREP.test(w)) return "PREPOSIZIONALE";
  if (isInfEnding(f) && !DET.test(w) && !isN(f)) return "INFINITO";
  if (/^(far|avere|essere|andare|fare|dare|dire|stare|mettere)$/i.test(f) && ws.length > 1) return "INFINITO";
  if (ws.length > 1 && PARTICIPLE.test(low(f)) && !isN(f)) return "PARTICIPIO_AGGETTIVO";
  if (isN(f)) return "NOME_NUDO";
  if (isA(f) && ws.length === 1) return "AGGETTIVO";
  if (isA(f)) return "PARTICIPIO_AGGETTIVO";
  if (ws.length >= 2 && /^\p{Lu}/u.test(f)) return "NOME_NUDO";
  if (/^[\p{L}\d-]+$/u.test(w)) return "NOME_NUDO";
  return "SCONOSCIUTA";
}

const cards = JSON.parse(readFileSync(cardsPath, "utf8"));
const counts = {};
for (const c of cards.white) {
  c.family = familyOf(c.text);
  counts[c.family] = (counts[c.family] || 0) + 1;
}
writeFileSync(cardsPath, JSON.stringify(cards, null, 1) + "\n", "utf8");
console.log(`carte bianche: ${cards.white.length}`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
