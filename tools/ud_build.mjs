// Costruisce la tabella genere/numero dei nomi dai corpora UD, usando SOLO i file di train.
// Output: data/lexicon_it/ud_nomi.json  { forma: { "ms": n, "fp": n, ... } }
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const corp = join(root, "data/corpora/ud_it");
const GEN = { Masc: "m", Fem: "f" }, NUM = { Sing: "s", Plur: "p" };
const table = {};
for (const dir of readdirSync(corp).filter((d) => d.startsWith("UD_"))) {
  for (const f of readdirSync(join(corp, dir)).filter((f) => f.endsWith("-train.conllu"))) {
    for (const line of readFileSync(join(corp, dir, f), "utf8").split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const c = line.split("\t");
      if (c.length < 6 || c[0].includes("-") || c[0].includes(".") || c[3] !== "NOUN") continue;
      const feats = Object.fromEntries((c[5] || "_").split("|").filter(Boolean).map((x) => x.split("=")));
      const g = GEN[feats.Gender], n = NUM[feats.Number];
      if (!g || !n) continue;
      const form = c[1].toLowerCase();
      table[form] ??= {};
      table[form][g + n] = (table[form][g + n] || 0) + 1;
    }
  }
}
writeFileSync(join(root, "data/lexicon_it/ud_nomi.json"), JSON.stringify(table));
console.log("forme nel train:", Object.keys(table).length);
