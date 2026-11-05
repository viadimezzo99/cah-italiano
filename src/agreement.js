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
const PROPER_OVERRIDE = new Set(["babbo", "dio", "hitler", "maometto", "gandhi", "skeletor", "robocop", "scientology", "nickelback", "gengis", "obama", "reagan", "sean", "keanu", "tom", "lady", "natalie", "kim", "sarah", "michael", "barack", "shaquille", "britney", "stephen", "christopher", "nicolas", "martin", "arnold", "hulk", "darth", "mr", "totò", "dario", "gigi", "benny", "justin", "giorgio", "christian", "giuliano", "bruno", "diego", "winx", "batman"]);

const VOWEL = /^[aeiouàèéìòù]/i;
// Parole che richiedono "lo/uno/gli" davanti (s+consonante, z, gn, ps, x, y, i+vocale).
const IMPURE = /^(s[^aeiouàèéìòù\s]|z|gn|ps|x|y|i[aeouàèéìòù])/i;
const SINGULAR_IN_I = new Set(["analisi", "crisi", "tesi", "ipotesi", "sintesi", "noi"]);

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
  // "l'" non dice il genere: lo prendo dal nome che segue; "un'" è sempre femminile singolare.
  if (/^l'/.test(first)) { const info = nounOf(words[0].slice(2)); return info ? { g: info.g, n: info.n } : { g: "m", n: "s" }; }
  if (/^un'/.test(first)) return { g: "f", n: "s" };
  if (ART[first]) return { ...ART[first] };
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

// Riscrive l'articolo che precede lo spazio, in base alla risposta scelta.
export function fixArticle(before, white) {
  const agr = whiteAgreement(white);
  if (!agr) return { before, consumed: false };
  const m = before.match(/(^|[\s(])((?:di|a|da|in|su)\s+)?(il|lo|la|l'|i|gli|le|un'|un|uno|una|del|dello|della|dell'|dei|degli|delle|al|allo|alla|all'|ai|agli|alle|dal|dallo|dalla|dall'|dai|dagli|dalle|nel|nello|nella|nell'|nei|negli|nelle|sul|sullo|sulla|sull'|sui|sugli|sulle)(\s*)$/i);
  if (!m) return { before, consumed: false };
  const head = before.slice(0, before.length - m[0].length);
  const lead = m[1];
  let prep = m[2] ? m[2].trim().toLowerCase() : null;
  let art = m[3].toLowerCase();
  if (UNCONTRACT[art]) { prep = UNCONTRACT[art].prep; art = UNCONTRACT[art].art; }
  const trail = m[4];
  const next = firstWord(white);
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
  // Una parola maiuscola dopo l'articolo è un nome proprio: "il Messico".
  if (words.length > 1 && words.slice(1).some((w) => /^\p{Lu}/u.test(w) && w.length > 1 && !/^(I|II|III)$/.test(w))) {
    // Il nome proprio dentro la frase resta maiuscolo; la prima parola si abbassa se è comune.
    const firstProper = /^\p{Lu}/u.test(words[0]) && !article;
    return firstProper ? text : text.charAt(0).toLowerCase() + text.slice(1);
  }
  // Nomi propri riconosciuti anche a una parola: restano con la maiuscola.
  if (PROPER_OVERRIDE.has(words[0].replace(/[^\p{L}]/gu, "").toLowerCase())) return text;
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
  const a = white.trim().match(/^(il|lo|la|l'|i|gli|le)(\s+|(?=\p{Lu}|\p{Ll}))/iu);
  if (!a) return null;
  const art = a[1].toLowerCase();
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
  const preferF = head.endsWith("a") && pool.some((c) => c[1] === "f");
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
  const repl = verbAgree(verb, num);
  if (!repl) return text;
  return m[1] + m[2] + repl + text.slice(m[0].length);
}

// Numero richiesto dalla frase nera nello spazio i: plurale o singolare, oppure null (resta quello della carta).
function numberCue(blackText, before) {
  const tail = (before.trim().split(/\s+/).pop() || "").toLowerCase();
  if (/^(i|gli|le|dei|degli|delle|tutti|tutte|alcuni|alcune|quali)$/.test(tail)) return "p";
  if (/^(il|lo|la|l'|un|uno|una|un'|del|dello|della|dell'|questo|questa|quel|quella|nel|nello|nella|nell')$/.test(tail)) return "s";
  if (/\b(quali|siamo|tutti|tutte|quanti|quante|usano|mangiano|stanno|ci sono|quali sono)\b/i.test(blackText)) return "p";
  return null;
}

// Soggetto comune senza articolo: l'articolo lo sceglie la frase.
// Singolare: indeterminativo (un/una). Plurale: determinativo (i/gli/le).
function nounPhrase(text, atStart, opts = {}) {
  const info = nounOf(text);
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
    else art = n === "s" ? indefForm(info.g, n, next) : defForm(info.g, n, next, null);
    out = (art.endsWith("'") ? art : art + " ") + noun;
  }
  if (atStart) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out + endPunct;
}

export function fillSentence(blackText, whites) {
  const parts = blackText.split("____");
  const segs = [];
  for (let i = 0; i < parts.length; i++) {
    let before = parts[i];
    if (i === parts.length - 1) {
      segs.push({ t: "text", v: before });
      break;
    }
    let white = whites[i];
    // Lo spazio è il soggetto della frase: il verbo che segue deve concordare con la risposta.
    const isSubj = /(^\s*$|[,;:(]\s*$|\b(che|quando|mentre|se|e|ma|perché|poiché|dove)\s*$)/i.test(parts[i]);
    let subjNum = null;
    if (white == null) {
      segs.push({ t: "text", v: before }, { t: "slot", i });
      continue;
    }
    const after = parts[i + 1];
    const atEnd = after.trim() === "" && i === parts.length - 2;
    const atStart = before.trim() === "";
    // Carta bianca con nome comune: la porto al numero della frase, poi metto l'articolo.
    const cue = numberCue(blackText, parts[i] ?? "");
    const artRe = /^(il|lo|la|l'|i|gli|le|un|uno|una|un')\s*/i;
    const stripped = artRe.test(white.trim()) && !/\s\p{Lu}/u.test(white.trim().replace(artRe, "")) ? white.trim().replace(artRe, "") : white.trim();
    const hasArt = stripped !== white.trim();
    const noCapsInside = !/\s\p{Lu}/u.test(white.trim());
    if (!hasArt || noCapsInside) {
      const own = nounOf(stripped);
      if (own) {
        const flexed = inflectPhrase(stripped, cue ?? own.n) ?? stripped;
        const artWord = hasArt ? white.trim().match(artRe)[1].toLowerCase() : "";
        const kind = hasArt ? (/^(il|lo|la|l'|i|gli|le)$/.test(artWord) ? "def" : "indef") : null;
        const det = /(^|\s)(questo|questa|quest'|quel|quella|ogni|mio|mia|tuo|tua|suo|sua|nostro|nostra|vostro|vostra|loro|alcuni|alcune|qualche|nessun|nessuna|molto|molti|molte|poco|tanto|troppo|ogni)\s*$/i.test(before);
        const bare = nounPhrase(flexed, atStart, { n: cue ?? own.n, kind, noArt: det });
        if (bare) white = bare;
        subjNum = cue ?? own.n;
      }
    }
    if (isSubj && white != null && parts[i + 1] !== undefined) {
      const sn = subjNum ?? (nounOf(white.trim())?.n ?? null);
      if (sn) parts[i + 1] = agreeVerbAfter(parts[i + 1], sn);
    }
    const gov = governedPrep(before);
    let prefixed = false;
    let pre = null;
    if (gov) before = before.replace(/\s*$/, " ") + gov + " ";
    else if (i === 0 && QUESTION_PREP.test(blackText)) {
      // La risposta alla domanda prende la preposizione della domanda, unita all'articolo se c'è.
      const prep = blackText.match(QUESTION_PREP)[1].toLowerCase();
      pre = contractFromWhite(prep + " ", white);
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
    if (!atEnd) w = w.replace(/[.!?]+$/, "");
    // Nome proprio dopo l'articolo ("il Messico"): mantiene la maiuscola.
    // Con l'opzione "i" \p{Lu} accetta anche le minuscole: l'articolo si toglie prima di controllare la maiuscola.
  const wTrim = white.trim();
  const artMatch = wTrim.match(/^(il|lo|la|l'|i|gli|le|un|uno|una|un')\s*/i);
  const keepCase = !!artMatch && /^\p{Lu}/u.test(wTrim.slice(artMatch[0].length));
    if (!atStart) w = keepCase ? w : elideUna(lowerIfMidSentence(w));
    segs.push({ t: "text", v: fixed.before }, { t: "word", v: w, i });
    // il testo dopo lo spazio può essere stato già concordato (verbo): non lo riscrivo
  }
  // Anche nel testo fisso della carta nera: "una" davanti a vocale diventa "un'".
  return segs.map((x) => (x.t === "text" ? { ...x, v: x.v.replace(/\buna (?=[aeiouàèéìòùAEIOUÀÈÉÌÒÙ])/gi, (m) => (m[0] === "U" ? "Un'" : "un'")) } : x));
}

export function sentencePlain(blackText, whites) {
  return fillSentence(blackText, whites).map((s) => (s.t === "slot" ? "____" : s.v)).join("");
}
