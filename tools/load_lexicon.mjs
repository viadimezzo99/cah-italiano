// Carica il lessico come nel build (Morph-it più le integrazioni curate). Da importare prima del motore.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
globalThis.LEX = rd("data/lexicon_it/lex.json");
globalThis.REGGENZE = rd("data/reggenze.json");
globalThis.INFLECT = rd("data/lexicon_it/inflect.json");
globalThis.VERBS3 = rd("data/lexicon_it/verbs3.json");
globalThis.UD_NOMI = rd("data/lexicon_it/ud_nomi.json");
for (const [sg, g, pl] of rd("data/lexicon_it/gaps.json").nomi) {
  if (sg in LEX) continue;
  LEX[sg] = [...(LEX[sg] || []), "N" + g + "s"];
  LEX[pl] = [...(LEX[pl] || []), ...((LEX[pl] || []).includes("N" + g + "p") ? [] : ["N" + g + "p"])];
  INFLECT[sg] = { N: { [g + "s"]: [sg], [g + "p"]: [pl] } };
}
