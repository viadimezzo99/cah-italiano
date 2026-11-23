// Controllo meccanico su tutte le combinazioni: nessuna frase costruita dal motore deve avere errori di articolo, di preposizione
// articolata, di apostrofo, di maiuscole dentro la parola o di copula con predicato plurale (vedi tools/grammar_lint.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../tools/load_lexicon.mjs";
import { lint } from "../tools/grammar_lint.mjs";
const { sentencePlain } = await import("../src/agreement.js");
const cards = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));

test("nessun errore meccanico in tutte le frasi con uno spazio", () => {
  /** @type {string[]} */
  const bad = [];
  let n = 0;
  for (const b of cards.black.filter((x) => x.blanks === 1)) {
    for (const w of cards.white) {
      const s = sentencePlain(b.text, [w.text]);
      n++;
      const issues = lint(s);
      if (issues.length) bad.push(`${issues[0].rule}: ${issues[0].text}  <-  ${s}`);
    }
  }
  assert.ok(n > 50000, "tutte le combinazioni");
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} frasi con problemi`);
});

test("nessun errore meccanico in un campione di frasi con due e tre spazi", () => {
  let seed = 424242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  /** @type {string[]} */
  const bad = [];
  for (const b of cards.black.filter((x) => x.blanks > 1)) {
    for (let k = 0; k < 150; k++) {
      const ws = Array.from({ length: b.blanks }, () => cards.white[Math.floor(rnd() * cards.white.length)].text);
      const s = sentencePlain(b.text, ws);
      const issues = lint(s);
      if (issues.length) bad.push(`${issues[0].rule}: ${issues[0].text}  <-  ${s}`);
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} frasi con problemi`);
});

test("il controllo riconosce gli errori noti", () => {
  const rules = (s) => lint(s).map((i) => i.rule);
  assert.ok(rules("Ho visto il herpes.").includes("forma dell'articolo davanti alla parola"), "la h è muta: l'herpes");
  assert.ok(rules("Ho visto un'amico.").includes("articolo e nome: genere"));
  assert.ok(rules("Ho visto uno gatto.").includes("forma dell'articolo davanti alla parola"));
  assert.ok(rules("Ho parlato di il gatto.").includes("preposizione e articolo non uniti"));
  assert.ok(rules("Il gatto è i cani.").includes("verbo singolare con predicato plurale"));
  assert.ok(rules("Ho visto l' amico.").includes("spazio dopo l'apostrofo"));
  assert.ok(rules("Ho visto aIDS.").includes("maiuscole dentro la parola"));
  assert.ok(rules("Ho visto la cane.").includes("articolo e nome: genere"));
  assert.ok(rules("Ho visto i cane.").includes("articolo e nome: numero"));
  assert.deepEqual(rules("Ho visto il cane e lo gnomo, l'amico e un'amica."), []);
});
