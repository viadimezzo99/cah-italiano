// Anteprima della frase: inserisce la carta bianca nello spazio e aggiusta
// articoli e preposizioni articolate in base a genere e numero della risposta.
// Euristica per l'italiano: non è un parser. Dove non è sicura, lascia il testo com'è.


// Lessico (Morph-it!, LGPL) e tabella delle reggenze dei verbi (data/reggenze.json).
// In pagina sono variabili globali; nei test vengono caricate da file.
const LEX_DB = typeof LEX !== "undefined" ? LEX : (globalThis.LEX || {});
const REGGENZE_DB = typeof REGGENZE !== "undefined" ? REGGENZE : (globalThis.REGGENZE || {});
// Nomi propri che il lessico conosce come parole comuni: non prendono articolo.
// Verbi all'indicativo, terza persona: forma -> [lemma, modo, tempo, numero] (Morph-it!).
const VERBS3_DB = typeof VERBS3 !== "undefined" ? VERBS3 : (globalThis.VERBS3 || {});
let VERB_INV = null;
// Stessa forma verbale (lemma, tempo) con il numero richiesto dal soggetto.
function verbAgree(word, num) {
  if (!VERB_INV) {
    VERB_INV = new Map();
    for (const [form, list] of Object.entries(VERBS3_DB)) {
      for (const [lemma, mood, tense, n] of list) VERB_INV.set(`${lemma}|${tense}|${n}`, form);
    }
  }
  const low = word.toLowerCase();
  const e = (VERBS3_DB[low] || [])[0];
  if (!e) return null;
  const [lemma, , tense, cur] = e;
  if (cur === num) return null;
  const f = VERB_INV.get(`${lemma}|${tense}|${num}`);
  if (!f) return null;
  return /^\p{Lu}/u.test(word) ? f.charAt(0).toUpperCase() + f.slice(1) : f;
}

// Flessione: lemma -> forme di nomi e aggettivi per genere e numero (Morph-it!).
const INFLECT_DB = typeof INFLECT !== "undefined" ? INFLECT : (globalThis.INFLECT || {});
let FORM_INDEX = null;
function formIndex() {
  if (FORM_INDEX) return FORM_INDEX;
  FORM_INDEX = new Map();
  for (const [lemma, cats] of Object.entries(INFLECT_DB)) {
    for (const cat of ["N", "A"]) {
      const forms = cats[cat];
      if (!forms) continue;
      for (const [gn, list] of Object.entries(forms)) {
        for (const f of list) {
          if (!FORM_INDEX.has(f)) FORM_INDEX.set(f, []);
          FORM_INDEX.get(f).push({ lemma, cat, g: gn[0], n: gn[1] });
        }
      }
    }
  }
  return FORM_INDEX;
}
// Forma di un lemma per genere e numero, senza superlativi (-issimo/-issima).
function pickForm(lemma, cat, g, n) {
  const list = INFLECT_DB[lemma] && INFLECT_DB[lemma][cat] && INFLECT_DB[lemma][cat][g + n];
  if (!list || !list.length) return null;
  return list.find((f) => !/issim/.test(f)) ?? list[0];
}
const PROPER_OVERRIDE = new Set(["babbo", "dio", "hitler", "maometto", "gandhi", "skeletor", "robocop", "scientology", "nickelback", "gengis", "obama", "reagan", "sean", "keanu", "tom", "lady", "natalie", "kim", "sarah", "michael", "barack", "shaquille", "britney", "stephen", "christopher", "nicolas", "martin", "arnold", "hulk", "darth", "mr", "totò", "dario", "gigi", "benny", "justin", "giorgio", "christian", "giuliano", "bruno", "diego", "winx", "batman", "platinette", "kitekat", "mosè", "messico", "francia", "spagna", "italia", "russia", "america", "cina", "giappone", "germania", "inghilterra", "egitto", "brasile", "india", "canada", "londra", "parigi", "roma"]);

const VOWEL = /^[aeiouàèéìòù]/i;
// Parole che richiedono "lo/uno/gli" davanti (s+consonante, z, gn, ps, x, y, i+vocale).
const IMPURE = /^(s[^aeiouàèéìòù\s]|z|gn|ps|x|y|i[aeouàèéìòù])/i;
const SINGULAR_IN_I = new Set(["analisi", "crisi", "tesi", "ipotesi", "sintesi", "noi"]);
const INFINITIVE = /(are|ere|ire|arsi|ersi|irsi)$/i;
// Parole in -are/-ere/-ire che sono nomi, non verbi.
const NOUN_IN_ERE = new Set(["padre", "madre", "mare", "cenere", "sere"]);
// Una risposta che inizia con un infinito ("Essere ricco", "Covare un uovo") è un'azione, non un sintagma nominale.
function isInfinitivePhrase(words) {
  const w = words[0].toLowerCase();
  return INFINITIVE.test(w) && !NOUN_IN_ERE.has(w);
}

const ART = {
  il: { g: "m", n: "s" }, lo: { g: "m", n: "s" }, "l'": { g: "m", n: "s" }, la: { g: "f", n: "s" },
  i: { g: "m", n: "p" }, gli: { g: "m", n: "p" }, le: { g: "f", n: "p" },
  un: { g: "m", n: "s" }, uno: { g: "m", n: "s" }, "un'": { g: "f", n: "s" }, una: { g: "f", n: "s" },
};

// Preposizioni articolate: [preposizione, articolo] -> forma unita.
const CONTRACT = {
  di: { il: "del", lo: "dello", "l'": "dell'", la: "della", i: "dei", gli: "degli", le: "delle" },
  a: { il: "al", lo: "allo", "l'": "all'", la: "alla", i: "ai", gli: "agli", le: "alle" },
  da: { il: "dal", lo: "dallo", "l'": "dall'", la: "dalla", i: "dai", gli: "dagli", le: "dalle" },
  in: { il: "nel", lo: "nello", "l'": "nell'", la: "nella", i: "nei", gli: "negli", le: "nelle" },
  su: { il: "sul", lo: "sullo", "l'": "sull'", la: "sulla", i: "sui", gli: "sugli", le: "sulle" },
};
const UNCONTRACT = {};
for (const [prep, forms] of Object.entries(CONTRACT)) {
  for (const [art, joined] of Object.entries(forms)) UNCONTRACT[joined] = { prep, art };
}

// Genere e numero della risposta, dalla prima parola (articolo o nome).
export function whiteAgreement(text) {
  const words = text.replace(/[^\p{L}'\s-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const first = words[0].toLowerCase();
  if (isInfinitivePhrase(words)) return null;
  // "l'" non dice il genere: lo prendo dal nome che segue; "un'" è sempre femminile singolare.
  if (/^l'/.test(first)) { const info = nounOf(words[0].slice(2)); return info ? { g: info.g, n: info.n } : { g: "m", n: "s" }; }
  if (/^un'/.test(first)) return { g: "f", n: "s" };
  if (ART[first]) return { ...ART[first] };
  // Il lessico conosce numero e genere della parola: più affidabile di qualunque regola sulla desinenza.
  const lexN = (LEX_DB[first] || []).filter((c) => c.startsWith("N"));
  if (lexN.length) {
    const pool = lexN.filter((c) => c.endsWith("s")).length ? lexN.filter((c) => c.endsWith("s")) : lexN;
    const pick = pool.find((c) => c[1] === "m") && first.endsWith("a") ? pool.find((c) => c[1] === "f") : pool[0];
    return { g: pick[1], n: pick[2] };
  }
  if (SINGULAR_IN_I.has(first)) return { g: null, n: "s" };
  if (/(zione|sione|tà|ù)$/.test(first) || /a$/.test(first)) return { g: "f", n: "s" };
  if (/o$/.test(first)) return { g: "m", n: "s" };
  if (/i$/.test(first)) return { g: null, n: "p" };
  if (/[^aeiouàèéìòù]$/.test(first)) return { g: "m", n: "s" }; // festival, sport, bar: quasi tutti maschili
  return null;
}

function defForm(g, n, next, prep) {
  const gender = g ?? "m";
  let form;
  if (n === "s" && gender === "m") form = VOWEL.test(next) ? "l'" : IMPURE.test(next) ? "lo" : "il";
  else if (n === "s") form = VOWEL.test(next) ? "l'" : "la";
  else if (gender === "f") form = "le";
  else form = VOWEL.test(next) || IMPURE.test(next) ? "gli" : "i";
  return prep ? CONTRACT[prep][form] : form;
}

function indefForm(g, n, next) {
  const gender = g ?? "m";
  if (n === "s") {
    if (gender === "f") return VOWEL.test(next) ? "un'" : "una";
    return IMPURE.test(next) ? "uno" : "un";
  }
  if (gender === "f") return "delle";
  return VOWEL.test(next) || IMPURE.test(next) ? "degli" : "dei";
}

function matchMirror(s, c) {
  return s[0] === s[0].toUpperCase() && s[0] !== s[0].toLowerCase() ? c[0].toUpperCase() + c.slice(1) : c;
}

// Nome proprio: "Lady Gaga", "Pac-Man", "Bruno Vespa". Non prende articolo.
function isProperName(text) {
  const words = text.trim().replace(/[.!?]+$/, "").split(/\s+/);
  const w0 = words[0] || "";
  if (ART[w0.toLowerCase()] || /^(l'|un')/i.test(w0)) return false;
  if (words.length > 1 && /^\p{Lu}/u.test(w0) && /^\p{Lu}/u.test(words[1])) return true;
  if (/-/.test(w0) && /^\p{Lu}/u.test(w0)) return true;
  return PROPER_OVERRIDE.has(w0.replace(/[^\p{L}]/gu, "").toLowerCase());
}

// Riscrive l'articolo che precede lo spazio, in base alla risposta scelta.
export function fixArticle(before, white) {
  const agr = whiteAgreement(white);
  const proper = isProperName(white);
  if (!agr && !proper) {
    // Risposta di cui non so il numero: un articolo indeterminativo sarebbe quasi sempre sbagliato, lo tolgo.
    const bare = before.match(/(^|[\s(])((?:di|a|da|in|su)\s+)?(un'|un|uno|una)(\s*)$/i);
    if (!bare) return { before, consumed: false };
    return { before: before.slice(0, before.length - bare[0].length) + bare[1] + (bare[2] ? bare[2].trim() + " " : ""), consumed: true };
  }
  const m = before.match(/(^|[\s(])((?:di|a|da|in|su)\s+)?(il|lo|la|l'|i|gli|le|un'|un|uno|una|del|dello|della|dell'|dei|degli|delle|al|allo|alla|all'|ai|agli|alle|dal|dallo|dalla|dall'|dai|dagli|dalle|nel|nello|nella|nell'|nei|negli|nelle|sul|sullo|sulla|sull'|sui|sugli|sulle)(\s*)$/i);
  if (!m) return { before, consumed: false };
  const head = before.slice(0, before.length - m[0].length);
  const lead = m[1];
  let prep = m[2] ? m[2].trim().toLowerCase() : null;
  let art = m[3].toLowerCase();
  if (UNCONTRACT[art]) { prep = UNCONTRACT[art].prep; art = UNCONTRACT[art].art; }
  const trail = m[4];
  if (proper) return { before: head + lead + (prep ? prep + " " : ""), consumed: true };
  // La parola che conta per l'articolo è quella dopo un eventuale articolo già presente nella risposta.
  const next = firstWord(white.replace(/^((?:il|lo|la|i|gli|le|uno|una|un)\s+|l'|un')/i, ""));
  const isDef = ["il", "lo", "l'", "la", "i", "gli", "le"].includes(art);
  let form;
  if (isDef) form = defForm(agr.g, agr.n, next, prep);
  else if (!prep) form = indefForm(agr.g, agr.n, next);
  else return { before: head + lead + prep + " ", consumed: false }; // "dei" + "un'antilope" -> "di un'antilope"
  // La preposizione (se c'era) è già dentro la forma: "a" + "il" diventa "al".
  form = matchMirror(m[3], form);
  // Dopo l'elisione ("all'") non c'è spazio: "all'alcolismo".
  const sep = form.endsWith("'") ? "" : trail;
  return { before: head + lead + form + sep, consumed: true };
}

function firstWord(text) {
  const w = text.replace(/[^\p{L}'\s-]/gu, " ").trim().split(/\s+/)[0] ?? "";
  return w;
}

// Togliere la maiuscola se la risposta va in mezzo alla frase, salvo i nomi propri.
function lowerIfMidSentence(text) {
  const words = text.trim().split(/\s+/);
  // Sigle e acronimi in maiuscolo (BATMAN!!!) restano così come sono.
  if (/^\p{Lu}{2,}[\p{Lu}\p{P}\d]*$/u.test(words[0].replace(/[.,!?]+$/, ""))) return text;
  // Un articolo all'inizio non è un nome proprio: va in minuscolo anche se la parola dopo è maiuscola.
  const article = /^(Una|Un|Uno|Il|Lo|La|Gli|Le|I)$/.test(words[0]) || /^L'/.test(words[0]);
  const twoCaps = !article && words.length > 1 && /^\p{Lu}/u.test(words[0]) && /^\p{Lu}/u.test(words[1]);
  if (twoCaps) return text;
  // Nomi propri riconosciuti anche a una parola, o con trattino ("Pac-Man"): restano con la maiuscola.
  if (PROPER_OVERRIDE.has(words[0].replace(/[^\p{L}]/gu, "").toLowerCase())) return text;
  if (/-/.test(words[0]) && /^\p{Lu}/u.test(words[0])) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// "una" davanti a vocale diventa "un'" anche dopo la minuscola.
function elideUna(text) {
  return text.replace(/^una (?=[aeiouàèéìòùAEIOUÀÈÉÌÒÙ])/i, "un'");
}

// Per ogni spazio: testo prima, parola inserita, testo dopo.
// whites[i] = testo della risposta per lo spazio i, oppure null se non ancora scelta.
// Preposizione richiesta dal verbo che precede lo spazio, se la tabella la conosce.
export function governedPrep(before) {
  const words = before.replace(/[^\p{L}'\s-]/gu, " ").trim().split(/\s+/);
  const last = (words[words.length - 1] || "").toLowerCase();
  const codes = LEX_DB[last] || [];
  const verb = codes.find((c) => c.startsWith("V:"));
  if (!verb) return null;
  const preps = REGGENZE_DB[verb.slice(2)];
  return preps && preps.length ? preps[0] : null;
}

// Domande con preposizione: "A cosa ...?" vuole una risposta che comincia con "a" ("Ai ...", "Alle ...", "A Mazzini").
const QUESTION_PREP = /^\s*(a|di|da|in|con|su|per)\s+(cosa|chi|quale|quali)\b/i;

// "di" / "a" / "in"... prima dello spazio e "il/i/l'..." all'inizio della risposta: si uniscono.
function contractFromWhite(before, white) {
  const m = before.match(/(^|[\s(])(di|a|da|in|su)\s+$/i);
  if (!m) return null;
  // Articolo con spazio ("la Lady") o con apostrofo ("l'odore"): mai la sillaba iniziale di una parola ("Lady").
  const a = white.trim().match(/^((?:il|lo|la|i|gli|le)\s+|l')/iu);
  if (!a) return null;
  const art = a[1].trim().toLowerCase();
  const joined = CONTRACT[m[2].toLowerCase()][art];
  if (!joined) return null;
  const rest = white.trim().slice(a[0].length);
  const sep = joined.endsWith("'") ? "" : " ";
  return { before: before.slice(0, before.length - m[0].length) + m[1] + joined + sep, white: rest };
}

// Codici del lessico per il primo nome della risposta: { g, n } oppure null.
function nounOf(text) {
  const clean = text.trim().replace(/^\d+\s+/, "");
  // Parte da un articolo o da un'elisione: ha già la sua forma, la gestisce fixArticle.
  if (/^(il|lo|la|l'|i|gli|le|un|uno|una|un'|del|della|dell'|dei|degli|delle|al|alla|all'|ai|agli|alle)\b/i.test(clean)) return null;
  const words = clean.replace(/[^\p{L}'\s-]/gu, " ").trim().split(/\s+/);
  if (isInfinitivePhrase(words)) return null;
  const hi = headIndex(words);
  if (hi < 0) return null;
  const head = (words[hi] || "").toLowerCase();
  if (!head) return null;
  // Due parole maiuscole di fila, o una parola maiuscola che il lessico non conosce: nome proprio.
  const twoCaps = words.length > 1 && /^\p{Lu}/u.test(words[0]) && /^\p{Lu}/u.test(words[1]);
  if (twoCaps || PROPER_OVERRIDE.has(head)) return null;
  const codes = (LEX_DB[head] || []).filter((c) => c.startsWith("N"));
  if (!codes.length) return null;
  if (/^\p{Lu}/u.test(words[0]) && !LEX_DB[head]) return null;
  // Tra più possibilità: singolare prima del plurale, maschile prima del femminile salvo le parole in -a.
  const sing = codes.filter((c) => c.endsWith("s"));
  const pool = sing.length ? sing : codes;
  // Parole in -a e in -e (voce, chiave...) con entrambi i generi: preferisco il femminile.
  const preferF = (head.endsWith("a") || head.endsWith("e")) && pool.some((c) => c[1] === "f");
  const pick = pool.find((c) => (preferF ? c[1] === "f" : c[1] === "m")) || pool[0];
  return { g: pick[1], n: pick[2] };
}

// Il sintagma nominale (nome + aggettivi che lo seguono) va al numero richiesto dalla frase.
// Restituisce il testo flesso, oppure null se il primo nome non è nel lessico.
const normTok = (w) => w.toLowerCase().replace(/[^\p{L}'-]/gu, "");
// Posizione del nome nel sintagma: il primo nome, anche dopo un aggettivo prenominale.
function headIndex(tokens) {
  for (let k = 0; k < Math.min(2, tokens.length); k++) {
    const c = formIndex().get(normTok(tokens[k])) || [];
    if (c.some((x) => x.cat === "N")) return k;
    if (!c.some((x) => x.cat === "A")) return -1;
  }
  return -1;
}
function inflectPhrase(text, nNeeded) {
  const endPunct = (text.match(/[.!?]+$/) || [""])[0];
  const tokens = text.trim().replace(/[.!?]+$/, "").split(/\s+/);
  const norm = normTok;
  const hi = headIndex(tokens);
  if (hi < 0) return null;
  const cands = (formIndex().get(norm(tokens[hi])) || []).filter((c) => c.cat === "N");
  const gs = [...new Set(cands.map((c) => c.g))];
  const headLower = norm(tokens[hi]);
  const g = gs.length === 1 ? gs[0] : headLower.endsWith("a") && gs.includes("f") ? "f" : gs.includes("m") ? "m" : gs[0];
  const lemma = cands.find((c) => c.g === g).lemma;
  const n = nNeeded || cands.find((c) => c.g === g).n;
  const head = pickForm(lemma, "N", g, n) ?? tokens[hi];
  const out = [];
  for (let k = 0; k < hi; k++) {
    const ac = (formIndex().get(norm(tokens[k])) || []).filter((c) => c.cat === "A");
    const adj = ac.find((c) => c.g === g) || ac[0];
    const f = adj && pickForm(adj.lemma, "A", g, n);
    out.push(f ?? tokens[k]);
  }
  out.push(head);
  let i = hi + 1;
  for (; i < tokens.length; i++) {
    const ac = (formIndex().get(norm(tokens[i])) || []).filter((c) => c.cat === "A");
    if (!ac.length) break;
    const adj = ac.find((c) => c.g === g) || ac[0];
    const f = pickForm(adj.lemma, "A", g, n);
    if (!f) break;
    out.push(/^\p{Lu}/u.test(tokens[i]) ? f.charAt(0).toUpperCase() + f.slice(1) : f);
  }
  out.push(...tokens.slice(i));
  return out.join(" ") + endPunct;
}

// Il verbo subito dopo lo spazio (saltando un pronome come "si") prende il numero del soggetto.
function agreeVerbAfter(text, num) {
  const m = text.match(/^(\s*)((?:(?:si|ci|mi|ti|vi|ne|lo|la|li|le)\s+)?)(\S+)/i);
  if (!m) return text;
  const verb = m[3].replace(/[^\p{L}']/gu, "");
  const punct = m[3].match(/[^\p{L}']+$/u)?.[0] ?? "";
  const repl = verbAgree(verb, num);
  if (!repl) return text;
  return m[1] + m[2] + repl + punct + text.slice(m[0].length);
}

// Numero richiesto dalla frase nera nello spazio i: plurale o singolare, oppure null (resta quello della carta).
function numberCue(blackText, before) {
  const tail = (before.trim().split(/\s+/).pop() || "").toLowerCase();
  if (/^(i|gli|le|dei|degli|delle|tutti|tutte|alcuni|alcune|quali)$/.test(tail)) return "p";
  // "un/una" non dice il numero: lo decide la risposta, poi l'articolo si corregge da solo.
  if (/^(il|lo|la|l'|del|dello|della|dell'|nel|nello|nella|nell')$/.test(tail)) return "s";
  // Il verbo plurale conta solo se sta nella stessa frase dello spazio ("Noi siamo ____"), non se è nella domanda precedente ("Cosa mi stanno nascondendo…? ____").
  const clause = before.split(/[.?!,;:]/).pop() || "";
  if (/\b(quali|siamo|tutti|tutte|quanti|quante|usano|mangiano|stanno|ci sono|quali sono)\b/i.test(clause)) return "p";
  return null;
}

// Soggetto comune senza articolo: l'articolo lo sceglie la frase.
// Singolare: indeterminativo (un/una). Plurale: determinativo (i/gli/le).
// Determinanti che cambiano con genere e numero della risposta: "questa" + "calze" -> "queste".
const DET_FAMILIES = [["questo", "questa", "questi", "queste"], ["quel", "quella", "quei", "quelle"], ["mio", "mia", "miei", "mie"],
  ["tuo", "tua", "tuoi", "tue"], ["suo", "sua", "suoi", "sue"], ["nostro", "nostra", "nostri", "nostre"], ["vostro", "vostra", "vostri", "vostre"]];
function fixDeterminer(before, g, n) {
  const m = before.match(/(\p{L}+)(\s*)$/u);
  if (!m) return before;
  const low = m[1].toLowerCase();
  for (const fam of DET_FAMILIES) {
    const idx = fam.indexOf(low);
    if (idx < 0) continue;
    const pick = g === "f" ? (n === "p" ? fam[3] : fam[1]) : (n === "p" ? fam[2] : fam[0]);
    const cased = /^\p{Lu}/u.test(m[1]) ? pick.charAt(0).toUpperCase() + pick.slice(1) : pick;
    return before.slice(0, m.index) + cased + m[2];
  }
  return before;
}

// Aggettivo nella forma giusta per il numero richiesto, dal suo genere ("noioso" -> "noiosi").
function adjustAdj(word, n) {
  const c = (formIndex().get(word.toLowerCase()) || []).find((x) => x.cat === "A");
  if (!c) return null;
  return pickForm(c.lemma, "A", c.g, n);
}

function nounPhrase(text, atStart, opts = {}) {
  const info0 = nounOf(text);
  const info = info0 && opts.g ? { ...info0, g: opts.g } : info0;
  if (!info) return null;
  const n = opts.n || info.n;
  // Il punto finale è della carta, non del sintagma: lo riattacco alla fine.
  const endPunct = (text.match(/[.!?]+$/) || [""])[0];
  let noun = text.trim().replace(/[.!?]+$/, "");
  noun = noun.charAt(0).toLowerCase() + noun.slice(1);
  let out;
  if (opts.noArt) {
    out = noun;
  } else {
    const next = firstWord(noun.replace(/^\d+\s+/, ""));
    const kind = opts.kind || (n === "s" ? "indef" : "def");
    let art;
    if (kind === "def") art = defForm(info.g, n, next, null);
    else art = indefForm(info.g, n, next);
    out = (art.endsWith("'") ? art : art + " ") + noun;
  }
  if (atStart) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out + endPunct;
}

// Copula prima dello spazio con un soggetto "neutro" ("la cosa più importante è ____"):
// il verbo concorda con la risposta, che è il predicato. Esempio: "sono i bambini", non "è i bambini".
const COPULA = /^(è|sono|era|erano|sarà|saranno|resta|restano|rimane|rimangono|diventa|diventano)$/i;
const NEUTRAL_SUBJECT = /\b(cosa|cose|problema|problemi|segreto|segreti|differenza|motivo|ragione|risultato|sogno|sogni|regalo|regali|verità)\b[^,.;:!?]*$/i;
function agreeCopula(text, white) {
  const m = text.match(/(\p{L}+)(\s*)$/u);
  if (!m || !COPULA.test(m[1]) || !NEUTRAL_SUBJECT.test(text.slice(0, m.index))) return null;
  const n = whiteAgreement(white.trim())?.n;
  if (!n) return null;
  const repl = verbAgree(m[1], n);
  if (!repl) return null;
  return text.slice(0, m.index) + repl + m[2];
}

export function fillSentence(blackText, whites) {
  const parts = blackText.split("____");
  const segs = [];
  let prevKept = false, keptPunct = false;
  for (let i = 0; i < parts.length; i++) {
    let before = parts[i];
    if (i === parts.length - 1) {
      segs.push({ t: "text", v: before });
      break;
    }
    let white = whites[i];
    if (white != null) {
      const cop = agreeCopula(before, white);
      if (cop !== null) { parts[i] = cop; before = cop; }
    }
    // Lo spazio è il soggetto della frase: il verbo che segue deve concordare con la risposta.
    const isSubj = /(^\s*$|^\s*(questo|questa|questi|queste|quel|quella|quei|quelle|mio|mia|miei|mie|tuo|tua|tuoi|tue|suo|sua|suoi|sue|nostro|nostra|nostri|nostre|vostro|vostra|vostri|vostre|ogni|tutto|tutta|tutti|tutte)\s+$|[,;:(]\s*$|\b(che|quando|mentre|se|e|ma|perché|poiché|dove)\s*$)/i.test(parts[i]);
    let subjNum = null;
    if (white == null) {
      segs.push({ t: "text", v: before }, { t: "slot", i });
      continue;
    }
    const after = parts[i + 1];
    const atEnd = after.trim() === "" && i === parts.length - 2;
    // Inizio di frase: solo all'inizio della carta o dopo un punto, non dopo un altro spazio nel mezzo.
    const atStart = (before.trim() === "" && (i === 0 || prevKept || /[.!?]\s*$/.test(parts[i - 1] ?? ""))) || /[.!?]\s*$/.test(before);
    // Carta bianca con nome comune: la porto al numero della frase, poi metto l'articolo.
    const cue = numberCue(blackText, parts[i] ?? "");
    const artRe = /^((?:il|lo|la|i|gli|le|uno|una|un)\s+|l'|un')/i;
    const stripped = artRe.test(white.trim()) && !/\s\p{Lu}/u.test(white.trim().replace(artRe, "")) ? white.trim().replace(artRe, "") : white.trim();
    const hasArt = stripped !== white.trim();
    const noCapsInside = !/\s\p{Lu}/u.test(white.trim());
    // Risposta con preposizione e nome senza articolo ("di pane"): la preposizione si unisce all'articolo giusto ("del pane").
    let fusedPrep = false;
    const pp = white.trim().match(/^(di|a|da|in|su)\s+(\p{L}[\p{L}\s'-]*?)([.!?]*)$/iu);
    if (pp && !hasArt) {
      const info = whiteAgreement(pp[2]);
      const artF = info ? defForm(info.g, info.n, firstWord(pp[2]), null) : null;
      const joined = artF ? CONTRACT[pp[1].toLowerCase()][artF] : null;
      if (joined) {
        before = before.replace(/\s*$/, " ") + joined + (joined.endsWith("'") ? "" : " ");
        parts[i] = before;
        white = pp[2] + pp[3];
        fusedPrep = true;
      }
    }
    const firstW = (white.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^\p{L}']/gu, "");
    // Verbo di apertura ("balla il tango"): se la parola seguente è un articolo o un pronome, è un verbo anche se il lessico conosce un nome uguale.
    const second = (white.trim().split(/\s+/)[1] || "").toLowerCase();
    const verbFirst = !!VERBS3_DB[firstW] && (/^(il|lo|la|i|gli|le|un|una|uno|di|a|da|in|con|su|per|tra|fra|sempre|troppo|molto|tanto|poco|ogni|mai)$/.test(second) || !(LEX_DB[firstW] || []).some((c) => c.startsWith("N")));
    // Aggettivo dopo una copula ("è noioso"): niente articolo.
    const adjAfterCopula = /(^|\s)(è|sono|era|erano|sarà|saranno|sembra|sembrano|diventa|diventano|resta|restano|rimane|rimangono)\s*$/i.test(before) && (LEX_DB[firstW] || []).some((c) => c.startsWith("A"));
    if (adjAfterCopula) {
      const cop = (before.trim().split(/\s+/).pop() || "").toLowerCase();
      const plural = /^(sono|erano|saranno|sembrano|diventano|restano|rimangono)$/.test(cop);
      const core = white.trim().replace(/[.!?]+$/, "");
      const adjN = adjustAdj(core, plural ? "p" : "s");
      if (adjN) white = adjN + white.trim().slice(core.length);
    }
    if ((!hasArt || noCapsInside) && !verbFirst && !fusedPrep && !adjAfterCopula) {
      // Il numero lo dice la risposta ("calze" è plurale), non la sola desinenza.
      const own0 = nounOf(stripped);
      const wa = whiteAgreement(stripped);
      const own = own0 && wa ? { ...own0, n: wa.n, g: wa.g } : own0;
      if (own) {
        const flexed = inflectPhrase(stripped, cue ?? own.n) ?? stripped;
        const artWord = hasArt ? white.trim().match(artRe)[1].trim().toLowerCase() : "";
        const kind = hasArt ? (/^(il|lo|la|l'|i|gli|le)$/.test(artWord) ? "def" : "indef") : null;
        const det = /(^|\s)(quante|quanti|quanta|quanto|tante|tanti|tanta|tanto|poche|pochi|poca|poco|troppe|troppi|troppa|troppo|parecchi|parecchie|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|questo|questa|quest'|quel|quella|ogni|mio|mia|tuo|tua|suo|sua|nostro|nostra|vostro|vostra|loro|alcuni|alcune|qualche|nessun|nessuna|molto|molti|molte|poco|tanto|troppo|ogni)\s*$/i.test(before);
        if (det) before = fixDeterminer(before, own.g, cue ?? own.n);
        const afterPrep = /(^|\s)(di|a|da|in|su|con|per|tra|fra)\s*$/i.test(before);
        const blackArt = /(^|\s)(un|uno|una|un'|il|lo|la|l'|i|gli|le)\s*$/i.test(before);
        const kindNow = kind ?? ((cue ?? own.n) === "p" && !afterPrep && !blackArt ? "indef" : undefined);
        const bare = nounPhrase(flexed, atStart, { n: cue ?? own.n, kind: kindNow, noArt: det, g: artWord === "un'" ? "f" : undefined });
        if (bare) white = bare;
        // Due risposte nella stessa carta: se la prima chiude con "con il ...", la seconda, se è un nome nudo e la domanda è "come?", riprende "con" ("ti domandi come? con dei fantasmi").
        const rawW = (whites[i] ?? "").trim();
        if (i > 0 && /\bcome\?/i.test(blackText) && /\bcon\s+(il|lo|la|l'|i|gli|le)\b[^,;:!?]*\.?\s*$/i.test(whites[i - 1] ?? "") && !hasArt && !/^(il|lo|la|l'|i|gli|le|un|una|uno|un'|dei|degli|delle|con|di|a|da|in|su|per)\s/i.test(rawW)) {
          const wb = isProperName(flexed) ? flexed : flexed.charAt(0).toLowerCase() + flexed.slice(1);
          const artC = indefForm(own.g, cue ?? own.n, firstWord(flexed));
          before = before.replace(/\s*$/, " ") + ((/\.\s*$/.test(before) || /\.\s*$/.test(whites[i - 1] ?? "")) && !/\?/.test(parts[i] ?? "") ? "Con " : "con ");
          white = artC + " " + wb;
        }
        subjNum = cue ?? own.n;
      }
    }
    if (isSubj && white != null && parts[i + 1] !== undefined) {
      const sn = subjNum ?? (nounOf(white.trim())?.n ?? null);
      if (sn) parts[i + 1] = agreeVerbAfter(parts[i + 1], sn);
    }
    const gov = /sogn\p{L}*\s*$/iu.test(before) && whiteAgreement(white.trim()) !== null ? null : governedPrep(before);
    let prefixed = false;
    let pre = null;
    // Preposizione (richiesta dal verbo, oppure già nel nero: "partecipino a ____") + nome senza articolo: si unisce all'articolo giusto ("ai Ditalini", "alle caccole").
    const govWord = (white.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^\p{L}']/gu, "");
    const trailPrep = !gov ? before.match(/(^|\s)(a|di|da|in|su)\s*$/i) : null;
    const prepKey = gov ?? (trailPrep ? trailPrep[2].toLowerCase() : null);
    const barePlain = !hasArt && !verbFirst && !adjAfterCopula && !fusedPrep && !isProperName(white) && !ART[govWord] && !/^(l'|un')/i.test(white.trim()) && !(LEX_DB[govWord] || []).some((c) => c.startsWith("A"));
    // Il sostantivo in -e (pane, latte) non ha desinenza che dica il genere: lo tratto come singolare maschile.
    const barInfo = barePlain ? (whiteAgreement(white.trim()) ?? nounOf(white.trim()) ?? (/^\p{Ll}+e[.!?]*$/u.test(white.trim()) && !/(ole|ile|ule|ate|ose)[.!?]*$/.test(white.trim()) ? { g: "m", n: "s" } : null)) : null;
    const govBare = !!prepKey && !!CONTRACT[prepKey] && !!barInfo;
    if (govBare) {
      const info = barInfo;
      const joined = CONTRACT[prepKey][defForm(info.g, info.n, govWord, null)];
      const sep = joined.endsWith("'") ? "" : " ";
      if (trailPrep) before = before.replace(/(^|\s)(a|di|da|in|su)\s*$/i, (m, sp) => sp + joined + sep);
      else before = before.replace(/\s*$/, " ") + joined + sep;
    } else if (gov) before = before.replace(/\s*$/, " ") + gov + " ";
    else if (i === 0 && QUESTION_PREP.test(blackText)) {
      // La risposta alla domanda prende la preposizione della domanda, unita all'articolo se c'è.
      const prep = blackText.match(QUESTION_PREP)[1].toLowerCase();
      pre = contractFromWhite(prep + " ", white);
      // Nome comune senza articolo ("A cosa ...? Ditalini"): la preposizione si unisce all'articolo giusto ("Ai Ditalini").
      const qWord = (white.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^\p{L}']/gu, "");
      const qInfo = !pre && CONTRACT[prep] && !hasArt && !verbFirst && !isProperName(white) && !ART[qWord] && !/^(l'|un')/i.test(white.trim()) ? whiteAgreement(white.trim()) : null;
      const qJoined = qInfo ? CONTRACT[prep][defForm(qInfo.g, qInfo.n, qWord, null)] : null;
      if (qJoined) pre = { before: qJoined + " ", white };
      prefixed = true;
      before = before.replace(/\s*$/, " ") + (pre ? pre.before : prep + " ");
    }
    const contracted = pre ? { before: "", white: pre.white } : contractFromWhite(before, white);
    const fixed = contracted && !pre ? { before: contracted.before, consumed: true }
      : prefixed ? { before, consumed: false }
      : fixArticle(before, white);
    let w = contracted ? contracted.white.trim() : white.trim();
    // Se l'articolo è stato riscritto, togli quello della risposta per non averne due.
    if (fixed.consumed && /^(il|lo|la|i|gli|le|un|uno|una)\s+/i.test(w)) {
      w = w.replace(/^\S+\s+/, "");
    } else if (fixed.consumed && /^(l'|un')(?=\p{L})/iu.test(w)) {
      w = w.replace(/^\S+?'/u, "");
    }
    // Il punto della risposta si toglie, a meno che la prossima cosa sia un altro spazio: allora chiude una frase.
    const nextIsBlank = i + 2 < parts.length && parts[i + 1].trim() === "";
    keptPunct = !atEnd && nextIsBlank && /[.!?]+$/.test(w);
    if (!atEnd && !keptPunct) w = w.replace(/[.!?]+$/, "");
    // Nome proprio dopo l'articolo ("il Messico"): mantiene la maiuscola.
    // Con l'opzione "i" \p{Lu} accetta anche le minuscole: l'articolo si toglie prima di controllare la maiuscola.
  const wTrim = white.trim();
  const artMatch = wTrim.match(artRe);
  // La maiuscola dopo l'articolo resta solo per i nomi propri ("il Messico"), non per "il Papa".
  const restW = artMatch ? wTrim.slice(artMatch[0].length) : wTrim;
  const keepCase = isProperName(restW);
    if (!atStart) w = keepCase ? w : elideUna(lowerIfMidSentence(w));
    segs.push({ t: "text", v: fixed.before }, { t: "word", v: w, i });
    prevKept = keptPunct;
    // il testo dopo lo spazio può essere stato già concordato (verbo): non lo riscrivo
  }
  // Anche nel testo fisso della carta nera: "una" davanti a vocale diventa "un'".
  return segs.map((x) => (x.t === "text" ? { ...x, v: x.v.replace(/ +([.,;:!?])/g, "$1").replace(/\buna (?=[aeiouàèéìòùAEIOUÀÈÉÌÒÙ])/gi, (m) => (m[0] === "U" ? "Un'" : "un'")) } : x));
}

export function sentencePlain(blackText, whites) {
  return fillSentence(blackText, whites).map((s) => (s.t === "slot" ? "____" : s.v)).join("");
}
