// Controllo grammaticale di sviluppo, senza rete e senza correttori esterni: guarda la frase finita e segnala gli errori
// che il motore di concordanza (src/agreement.js) non deve fare. Non entra nell'app.
//
//   node tools/grammar_lint.mjs                 tutte le frasi con un solo spazio (carta nera x carta bianca) + campione a 2 e 3 spazi
//   node tools/grammar_lint.mjs --examples 5    quanti esempi mostrare per ogni regola
//
// Non sostituisce la lettura delle frasi: trova gli errori meccanici (articolo e nome che non concordano, forma sbagliata davanti
// a vocale, preposizione e articolo non uniti, "è" con un predicato plurale, maiuscole fuori posto, spazi). Dove il lessico non
// conosce la parola, tace. LanguageTool in italiano non serve qui: su frasi con errori di concordanza noti ne segnala quasi nessuno.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./load_lexicon.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEXG = /** @type {Record<string, string[]>} */ (globalThis.LEX);
const INFL = /** @type {Record<string, any>} */ (globalThis.INFLECT);

/** @type {Map<string, Set<string>>|null} */
let NOUN_FORMS = null;
function nounForms() {
  if (NOUN_FORMS) return NOUN_FORMS;
  NOUN_FORMS = new Map();
  for (const cats of Object.values(INFL)) {
    for (const [gn, forms] of Object.entries(cats.N || {})) {
      for (const f of /** @type {string[]} */ (forms)) {
        if (!NOUN_FORMS.has(f)) NOUN_FORMS.set(f, new Set());
        /** @type {Set<string>} */ (NOUN_FORMS.get(f)).add(gn);
      }
    }
  }
  return NOUN_FORMS;
}
/** Genere e numero possibili di una parola come nome (insieme di "ms", "fp"...), oppure null se non è un nome noto. */
function nounGN(w) {
  const set = new Set(nounForms().get(w) || []);
  for (const c of LEXG[w] || []) if (c[0] === "N" && c.length === 3) set.add(c[1] + c[2]);
  return set.size ? set : null;
}
const isAdj = (/** @type {string} */ w) => (LEXG[w] || []).some((c) => c[0] === "A");

// Articoli e le loro caratteristiche. "l'" non dice il genere.
const ARTICLES = {
  il: { g: "m", n: "s", kind: "il" }, lo: { g: "m", n: "s", kind: "lo" }, "l'": { g: null, n: "s", kind: "l'" }, la: { g: "f", n: "s", kind: "la" },
  i: { g: "m", n: "p", kind: "i" }, gli: { g: "m", n: "p", kind: "gli" }, le: { g: "f", n: "p", kind: "le" },
  un: { g: "m", n: "s", kind: "un" }, uno: { g: "m", n: "s", kind: "uno" }, "un'": { g: "f", n: "s", kind: "un'" }, una: { g: "f", n: "s", kind: "una" },
};
const VOWEL = /^[aeiouàèéìòùh]/i;
const IMPURE = /^(s[^aeiouàèéìòù\s]|z|gn|ps|x|y|i[aeouàèéìòù]|sh|chef)/i;
/** Forma attesa dell'articolo davanti a `next`. */
function expectedForm(g, n, def, next) {
  const v = VOWEL.test(next), imp = IMPURE.test(next);
  if (def) {
    if (n === "s") return g === "f" ? (v ? "l'" : "la") : v ? "l'" : imp ? "lo" : "il";
    return g === "f" ? "le" : v || imp ? "gli" : "i";
  }
  if (n === "s") return g === "f" ? (v ? "un'" : "una") : imp ? "uno" : "un";
  return null;
}

/** @typedef {{rule: string, text: string}} Issue */
/** @param {string} sentence @returns {Issue[]} */
export function lint(sentence) {
  /** @type {Issue[]} */
  const out = [];
  const add = (rule, text) => out.push({ rule, text });
  // Testo fisso delle carte nere che non è grammatica da giudicare: "Serie A lo ha vietato", "che la uccida", "Kim Jong-il".
  const s = sentence.replace(/Serie A\b/g, "Serie_A").replace(/\bche la uccida\b/g, "che_x").replace(/-il\b/g, "_il");
  if (/\s{2,}/.test(s)) add("spazio doppio", s);
  if (/\s[,;:.!?](?!\.)/.test(s)) add("spazio prima della punteggiatura", s);
  if (/[a-zà-ù]'\s+\p{L}/u.test(s) && !/\b(po|mo)'\s/.test(s)) add("spazio dopo l'apostrofo", (s.match(/\S*'\s+\p{L}+/u) || [""])[0]);
  if (/\p{Ll}\p{Lu}{2,}/u.test(s)) add("maiuscole dentro la parola", (s.match(/\S*\p{Ll}\p{Lu}{2,}\S*/u) || [""])[0]);
  // "a il", "di la"...: la preposizione e l'articolo devono essere uniti ("al", "della"). Una frase che ricomincia ("A lo...") non c'è.
  const sepPrep = s.match(/(?<![\p{L}'_-])(di|a|da|in|su) (il|lo|la|i|gli|le)(?![\p{L}'])/iu);
  if (sepPrep && !/[.!?] (A|Da|In|Su|Di) /.test(s.slice(Math.max(0, sepPrep.index - 2), sepPrep.index + 3))) add("preposizione e articolo non uniti", sepPrep[0]);
  if (/(?<![\p{L}'_-])(il|lo|la|i|gli|le|un|uno|una) (il|lo|la|i|gli|le|un|uno|una)(?![\p{L}'])/iu.test(s)) add("due articoli di fila", (s.match(/(?<![\p{L}'_-])(il|lo|la|i|gli|le|un|uno|una) (il|lo|la|i|gli|le|un|uno|una)(?![\p{L}'])/iu) || [""])[0]);
  if (/(?<![\p{L}'])(è|era|sarà) (i|gli|le|dei|degli|delle) \p{L}/iu.test(s)) add("verbo singolare con predicato plurale", (s.match(/(?<![\p{L}'])(è|era|sarà) (i|gli|le|dei|degli|delle) \p{L}+/iu) || [""])[0]);
  // Articolo + parola: forma, genere e numero.
  const re = /(?<![\p{L}'_-])(il|lo|la|i|gli|le|un|uno|una)\s+(\p{L}+)|(?<![\p{L}'_-])(l'|un')(\p{L}+)/giu;
  let m;
  while ((m = re.exec(s))) {
    const art = (m[1] ?? m[3]).toLowerCase();
    const w = m[2] ?? m[4];
    if (/^\p{Lu}/u.test(w)) continue;   // nome proprio o titolo: niente giudizio
    const lw = w.toLowerCase();
    // "la uccida", "lo ha": un pronome davanti a un verbo, non un articolo.
    if (((globalThis.VERBS3 || {})[lw] || (LEXG[lw] || []).some((c) => c.startsWith("V:"))) && !nounGN(lw)) continue;
    const info = ARTICLES[art];
    if (!info) continue;
    // Il nome dopo l'articolo può avere un aggettivo davanti ("un bel ragazzo"): in quel caso non giudico.
    if (isAdj(lw) && !nounGN(lw)) continue;
    const gn = nounGN(lw);
    const def = /^(il|lo|l'|la|i|gli|le)$/.test(art);
    // Il singolare dell'articolo davanti a una parola che comincia per vocale o consonante impura: forma giusta.
    if (info.n === "s" && info.g) {
      const want = expectedForm(info.g, "s", def, lw);
      if (want && want !== art && !(art === "un'" && want === "un'")) add("forma dell'articolo davanti alla parola", `${art} ${w}`);
    }
    if (info.n === "p" && info.g === "m" && def) {
      const want = expectedForm("m", "p", true, lw);
      if (want && want !== art) add("forma dell'articolo davanti alla parola", `${art} ${w}`);
    }
    if (gn && info.n && !(art === "un'" && /^[aeiou]/.test(lw) && false)) {
      const okNum = [...gn].some((x) => x[1] === info.n);
      const okGen = [...gn].some((x) => (!info.g || x[0] === info.g) && x[1] === info.n);
      if (!okNum) add("articolo e nome: numero", `${art} ${w}`);
      else if (!okGen && info.g) add("articolo e nome: genere", `${art} ${w}`);
    }
  }
  return out;
}

// --- Esecuzione da riga di comando --------------------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith("grammar_lint.mjs")) {
  const args = process.argv.slice(2);
  const exN = Number(args[args.indexOf("--examples") + 1]) || 4;
  const { sentencePlain } = await import(join(root, "src/agreement.js"));
  const cards = JSON.parse(readFileSync(join(root, "data/cards.json"), "utf8"));
  /** @type {{b:string, w:string[], s:string}[]} */
  const items = [];
  for (const b of cards.black.filter((x) => x.blanks === 1)) for (const w of cards.white) items.push({ b: b.text, w: [w.text], s: sentencePlain(b.text, [w.text]) });
  let seed = 20260101;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (const b of cards.black.filter((x) => x.blanks > 1)) {
    for (let k = 0; k < 200; k++) {
      const ws = Array.from({ length: b.blanks }, () => cards.white[Math.floor(rnd() * cards.white.length)].text);
      items.push({ b: b.text, w: ws, s: sentencePlain(b.text, ws) });
    }
  }
  /** @type {Map<string, {n:number, ex:string[]}>} */
  const byRule = new Map();
  let flagged = 0;
  for (const it of items) {
    const issues = lint(it.s);
    if (issues.length) flagged++;
    const seen = new Set();
    for (const is of issues) {
      if (seen.has(is.rule)) continue;
      seen.add(is.rule);
      const r = byRule.get(is.rule) ?? { n: 0, ex: [] };
      r.n++;
      if (r.ex.length < exN) r.ex.push(`${is.text}  <-  ${it.s}`);
      byRule.set(is.rule, r);
    }
  }
  console.log(JSON.stringify({ frasi: items.length, con_problemi: flagged, percentuale: (100 * flagged / items.length).toFixed(2) + "%" }));
  for (const [rule, r] of [...byRule].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`\n${rule}: ${r.n}`);
    for (const e of r.ex) console.log("   " + e.slice(0, 220));
  }
}
