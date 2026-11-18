// Copertura del lessico sui corpora Universal Dependencies importati (data/corpora/ud_it).
// Conta i nomi (NOUN) e i nomi propri (PROPN) delle frasi annotate che non compaiono nel lessico.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEX = JSON.parse(readFileSync(join(root, "data/lexicon_it/lex.json"), "utf8"));
const INFL = JSON.parse(readFileSync(join(root, "data/lexicon_it/inflect.json"), "utf8"));
const GAPS = JSON.parse(readFileSync(join(root, "data/lexicon_it/gaps.json"), "utf8")).nomi;
const known = new Set([...Object.keys(LEX), ...Object.keys(INFL), ...GAPS.flatMap((x) => [x[0], x[2]])]);
const corp = join(root, "data/corpora/ud_it");
let total = 0, covered = 0;
const missing = new Map();
for (const dir of readdirSync(corp).filter((d) => d.startsWith("UD_"))) {
  for (const f of readdirSync(join(corp, dir)).filter((f) => f.endsWith(".conllu"))) {
    for (const line of readFileSync(join(corp, dir, f), "utf8").split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const c = line.split("\t");
      if (c.length < 4 || c[0].includes("-") || c[0].includes(".")) continue;
      if (c[3] !== "NOUN" && c[3] !== "PROPN") continue;
      total++;
      const form = c[1].toLowerCase(), lemma = c[2].toLowerCase();
      if (known.has(form) || known.has(lemma)) covered++;
      else missing.set(lemma, (missing.get(lemma) || 0) + 1);
    }
  }
}
const top = [...missing].sort((a, b) => b[1] - a[1]).slice(0, 40);
console.log(JSON.stringify({ nomi: total, coperti: covered, percentuale: ((100 * covered) / total).toFixed(1) + "%", non_coperti: missing.size }, null, 1));
console.log("più frequenti non coperti:", top.map((x) => x.join(":")).join("  "));
