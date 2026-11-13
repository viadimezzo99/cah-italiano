// Il segnaposto {P} indica una preposizione da scegliere in base alla carta bianca.
// Non deve mai arrivare a schermo: dopo il riempimento la frase non ne contiene più traccia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sentencePlain } from "../src/agreement.js";

const cards = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
const PLACEHOLDER = "{P}";

test("nessuna carta nera mostra il segnaposto {P} dopo il riempimento", () => {
  const whites = cards.white.map((w) => w.text);
  for (const c of cards.black) {
    const picks = Array.from({ length: c.blanks }, (_, i) => whites[(i * 7) % whites.length]);
    const out = sentencePlain(c.text, picks);
    assert.ok(!out.includes(PLACEHOLDER), `${c.id} mostra ${PLACEHOLDER}: ${out}`);
  }
});

test("il segnaposto non compare nei testi delle carte bianche", () => {
  for (const w of cards.white) assert.ok(!w.text.includes(PLACEHOLDER), `${w.id} contiene ${PLACEHOLDER}`);
});
