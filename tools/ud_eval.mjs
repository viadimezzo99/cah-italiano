// Valutazione del motore sui nomi annotati (Universal Dependencies, data/corpora/ud_it).
// Confronta genere e numero che il motore assegna alla forma del nome con quelli annotati a mano.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./load_lexicon.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { whiteAgreement } = await import(join(root, "src/agreement.js"));
const UD = JSON.parse(readFileSync(join(root, "data/lexicon_it/ud_nomi.json"), "utf8"));
const corp = join(root, "data/corpora/ud_it");
const GEN = { Masc: "m", Fem: "f" }, NUM = { Sing: "s", Plur: "p" };
let n = 0, gOk = 0, nOk = 0, gDone = 0, nDone = 0;
const errs = new Map();
for (const dir of readdirSync(corp).filter((d) => d.startsWith("UD_"))) {
  for (const f of readdirSync(join(corp, dir)).filter((f) => /-(dev|test)\.conllu$/.test(f))) {
    for (const line of readFileSync(join(corp, dir, f), "utf8").split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const c = line.split("\t");
      if (c.length < 6 || c[0].includes("-") || c[0].includes(".") || c[3] !== "NOUN") continue;
      const feats = Object.fromEntries((c[5] || "_").split("|").filter(Boolean).map((x) => x.split("=")));
      const g = GEN[feats.Gender], num = NUM[feats.Number];
      if (!g && !num) continue;
      let info = whiteAgreement(c[1]);
      const fr = UD[c[1].toLowerCase()];
      if (process.env.USE_UD && fr) { const best = Object.entries(fr).sort((a, b) => b[1] - a[1])[0][0]; info = { g: best[0], n: best[1] }; }
      n++;
      if (g) { gDone++; if (info && info.g === g) gOk++; else errs.set(c[1] + " " + g, (errs.get(c[1] + " " + g) || 0) + 1); }
      if (num) { nDone++; if (info && info.n === num) nOk++; }
    }
  }
}
console.log(JSON.stringify({ nomi_annotati: n, genere_valutati: gDone, genere_corretto: (100 * gOk / gDone).toFixed(1) + "%", numero_valutati: nDone, numero_corretto: (100 * nOk / nDone).toFixed(1) + "%" }, null, 1));
console.log("errori di genere più frequenti:", [...errs].sort((a, b) => b[1] - a[1]).slice(0, 30).map((x) => x.join("=")).join("  "));
