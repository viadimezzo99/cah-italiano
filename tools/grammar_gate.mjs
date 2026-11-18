// Controllo grammaticale di sviluppo: genera tutte le frasi carta nera × carta bianca
// e le fa verificare da un correttore locale. Non entra nell'app (il correttore è troppo grande per il telefono).
//
// Backend:
//   lt   LanguageTool in locale (pacchetto standalone da languagetool.org, Java 17+):
//        java -cp languagetool-server.jar org.languagetool.server.HTTPServer --port 8010
//        poi:  node tools/grammar_gate.mjs --backend lt --url http://localhost:8010
//   slm  modello compatto quantizzato con endpoint compatibile OpenAI (es. llama.cpp server):
//        node tools/grammar_gate.mjs --backend slm --url http://localhost:8080 --model NOME
//
// Output: scratchpad o cartella indicata con --out (report.json + riepilogo a schermo).
// Esce con codice 1 se trova errori non presenti nella lista di regole ignorate (--strict).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
  return acc;
}, []));

const backend = args.backend || "lt";
const url = args.url || (backend === "lt" ? "http://localhost:8010" : "http://localhost:8080");
const out = args.out || join(root, "build", "grammar");
const limit = Number(args.limit || 0);
const concurrency = Number(args.concurrency || 4);
const strict = args.strict === "true";

// Regole di LanguageTool che nelle carte danno falsi allarmi (nomi propri, maiuscole, testo volutamente scorretto).
const IGNORE_LT = new Set(["UPPERCASE_SENTENCE_START", "COMMA_PARENTHESIS_WHITESPACE", "WHITESPACE_RULE", "MORFOLOGIK_RULE_IT_IT"]);

const rd = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
// Lessico come nel build: Morph-it + integrazioni curate (genere e plurale).
globalThis.LEX = rd("data/lexicon_it/lex.json");
globalThis.REGGENZE = rd("data/reggenze.json");
globalThis.INFLECT = rd("data/lexicon_it/inflect.json");
globalThis.VERBS3 = rd("data/lexicon_it/verbs3.json");
for (const [sg, g, pl] of rd("data/lexicon_it/gaps.json").nomi) {
  if (sg in LEX) continue;
  LEX[sg] = [...(LEX[sg] || []), "N" + g + "s"];
  LEX[pl] = [...(LEX[pl] || []), ...((LEX[pl] || []).includes("N" + g + "p") ? [] : ["N" + g + "p"])];
  INFLECT[sg] = { N: { [g + "s"]: [sg], [g + "p"]: [pl] } };
}
const { sentencePlain } = await import(join(root, "src/agreement.js"));

const cards = rd("data/cards.json");
const blacks = cards.black.filter((b) => b.blanks === 1 && b.text.split("____").length === 2);
const whites = cards.white.map((w) => w.text);
let pairs = [];
for (const b of blacks) for (const w of whites) pairs.push({ b: b.text, w, s: sentencePlain(b.text, [w]) });
if (limit) pairs = pairs.slice(0, limit);

async function checkLT(text) {
  const body = new URLSearchParams({ language: "it", text });
  const res = await fetch(url + "/v2/check", { method: "POST", body });
  if (!res.ok) throw new Error("LanguageTool HTTP " + res.status);
  const json = await res.json();
  return json.matches
    .filter((m) => !IGNORE_LT.has(m.rule.id))
    .map((m) => ({ rule: m.rule.id, message: m.message, context: m.context?.text ?? "", replacements: (m.replacements || []).slice(0, 3).map((r) => r.value) }));
}

async function checkSLM(text) {
  const prompt = "Sei un correttore di italiano. Rispondi solo con OK se la frase è grammaticalmente corretta, altrimenti ERRORE seguito dalla spiegazione in una riga.\nFrase: " + text;
  const res = await fetch(url + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: args.model || "local", temperature: 0, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error("SLM HTTP " + res.status);
  const answer = (await res.json()).choices[0].message.content.trim();
  if (/^OK\b/i.test(answer)) return [];
  return [{ rule: "SLM", message: answer.slice(0, 200), context: text, replacements: [] }];
}

const check = backend === "slm" ? checkSLM : checkLT;
const findings = [];
let next = 0, done = 0;
async function worker() {
  while (next < pairs.length) {
    const p = pairs[next++];
    try {
      const errs = await check(p.s);
      if (errs.length) findings.push({ ...p, errors: errs });
    } catch (e) {
      console.error("errore su frase:", p.s, e.message);
      process.exitCode = 2;
      return;
    }
    done++;
    if (done % 500 === 0) console.error(`controllate ${done}/${pairs.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const byRule = {};
for (const f of findings) for (const e of f.errors) byRule[e.rule] = (byRule[e.rule] || 0) + 1;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "report.json"), JSON.stringify({ backend, url, total: pairs.length, flagged: findings.length, byRule, findings }, null, 1));
console.log(JSON.stringify({ backend, total: pairs.length, flagged: findings.length, byRule }, null, 1));
console.log("report:", join(out, "report.json"));
if (strict && findings.length && !process.exitCode) process.exitCode = 1;
