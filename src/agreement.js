// Anteprima della frase: inserisce la carta bianca nello spazio e aggiusta
// articoli e preposizioni articolate in base a genere e numero della risposta.
// Euristica per l'italiano: non è un parser. Dove non è sicura, lascia il testo com'è.


// Lessico (Morph-it!, LGPL) e tabella delle reggenze dei verbi (data/reggenze.json).
// In pagina sono variabili globali; nei test vengono caricate da file.
const LEX_DB = typeof LEX !== "undefined" ? LEX : (globalThis.LEX || {});
const UD_NOMI_DB = typeof UD_NOMI !== "undefined" ? UD_NOMI : (globalThis.UD_NOMI || {});
const REGGENZE_DB = typeof REGGENZE !== "undefined" ? REGGENZE : (globalThis.REGGENZE || {});
// Nomi propri che il lessico conosce come parole comuni: non prendono articolo.
// Verbi all'indicativo, terza persona: forma -> [lemma, modo, tempo, numero] (Morph-it!).
const VERBS3_DB = typeof VERBS3 !== "undefined" ? VERBS3 : (globalThis.VERBS3 || {});
/** @type {Map<string, string>|null} */
let VERB_INV = null;
// Stessa forma verbale (lemma, tempo) con il numero richiesto dal soggetto.
function verbAgree(word, num) {
  if (!VERB_INV) {
    const inv = new Map();
    for (const [form, list] of Object.entries(VERBS3_DB)) {
      for (const [lemma, , tense, n] of list) inv.set(`${lemma}|${tense}|${n}`, form);
    }
    VERB_INV = inv;
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
/** Una forma del lessico: lemma, categoria (N/A), genere (m/f), numero (s/p). */
/** @typedef {{lemma:string, cat:string, g:string, n:string}} FormEntry */
/** @type {Map<string, FormEntry[]>|null} */
let FORM_INDEX = null;
/** @returns {Map<string, FormEntry[]>} */
function formIndex() {
  if (FORM_INDEX) return FORM_INDEX;
  /** @type {Map<string, FormEntry[]>} */
  const index = new Map();
  for (const [lemma, cats] of Object.entries(INFLECT_DB)) {
    for (const cat of ["N", "A"]) {
      const forms = cats[cat];
      if (!forms) continue;
      for (const [gn, list] of Object.entries(forms)) {
        for (const f of list) {
          let list2 = index.get(f);
          if (!list2) index.set(f, (list2 = []));
          list2.push({ lemma, cat, g: gn[0], n: gn[1] });
        }
      }
    }
  }
  FORM_INDEX = index;
  return index;
}
// Forma di un lemma per genere e numero, senza superlativi (-issimo/-issima).
function pickForm(lemma, cat, g, n) {
  const list = INFLECT_DB[lemma] && INFLECT_DB[lemma][cat] && INFLECT_DB[lemma][cat][g + n];
  if (!list || !list.length) return null;
  return list.find((f) => !/issim/.test(f)) ?? list[0];
}
const PROPER_OVERRIDE = new Set(["babbo", "dio", "hitler", "maometto", "gandhi", "skeletor", "robocop", "scientology", "nickelback", "gengis", "obama", "reagan", "sean", "keanu", "tom", "lady", "natalie", "kim", "sarah", "michael", "barack", "shaquille", "britney", "stephen", "christopher", "nicolas", "martin", "arnold", "hulk", "darth", "mr", "totò", "dario", "gigi", "benny", "justin", "giorgio", "christian", "giuliano", "bruno", "diego", "winx", "batman", "platinette", "kitekat", "mosè", "messico", "francia", "spagna", "italia", "russia", "america", "cina", "giappone", "germania", "inghilterra", "egitto", "brasile", "india", "canada", "londra", "parigi", "roma",
  // Nomi propri che iniziano una carta e il lessico non conosce (le carte del gioco), più qualche nome noto per le carte personali.
  "auschwitz", "mac", "psyco", "schiaccianoci", "pacman", "oompaloompa", "makeawish", "euphoria", "hustle", "rufis", "trump", "biden", "putin", "zelensky", "meloni", "salvini", "renzi", "draghi", "mussolini", "napoleone",
  "garibaldi", "beyoncé", "rihanna", "eminem", "shakira", "ligabue", "jovanotti", "pausini", "fedez", "ferragni", "belen", "cristo", "allah", "buddha", "zeus", "satana", "lucifero",
  "topolino", "paperino", "pluto", "superman", "spiderman", "wolverine", "goku", "pikachu", "sonic", "zelda", "yoda", "chewbacca", "gandalf", "frodo", "voldemort", "dumbledore",
  "shrek", "simba", "lunchables", "eminflex", "world", "nutella", "kellogg's", "warcraft", "vodafone", "netflix", "google", "facebook", "instagram", "tiktok", "amazon", "ikea", "nokia", "samsung", "apple", "microsoft", "starbucks", "coca-cola", "pepsi"]);

// La h iniziale è muta in italiano: "l'herpes", "l'hotel", "un hobby".
// Nomi invariabili che, soli su una carta ("Gay."), sono plurali: "ai gay", non "al gay".
const PLURAL_BY_DEFAULT = new Set(["gay", "hutu", "tutsi", "amish", "hipster", "nerd", "boomer", "zoomer", "millennial", "scout", "vip"]);
const VOWEL = /^[aeiouàèéìòùh]/i;
// Parole che richiedono "lo/uno/gli" davanti (s+consonante, z, gn, ps, x, y, i+vocale).
const IMPURE = /^(s[^aeiouàèéìòù\s]|z|gn|ps|x|y|i[aeouàèéìòù])/i;
const SINGULAR_IN_I = new Set(["analisi", "crisi", "tesi", "ipotesi", "sintesi", "noi"]);
const INFINITIVE = /(are|ere|ire|arsi|ersi|irsi)$/i;
// Parole in -are/-ere/-ire che sono nomi, non verbi.
const NOUN_IN_ERE = new Set(["padre", "madre", "mare", "cenere", "sere"]);
// Una risposta che inizia con un infinito ("Essere ricco", "Covare un uovo") è un'azione, non un sintagma nominale.
// Infinito con i pronomi attaccati: "farsela" (far + sela), "spassarsela", "tirarlo", "pulirle", "cagarsene".
const CLITIC_TAIL = /^(.*?(?:ar|er|ir|or|ur))(sela|selo|seli|sele|sene|cela|celo|cele|celi|mela|melo|mele|meli|tela|telo|tele|teli|vela|velo|si|ci|mi|ti|vi|ne|lo|la|li|le|gli)$/;
// Infiniti troncati: "Far cadere", "Aver paura", "Dar fastidio".
const APOCOPATED = new Set(["far", "dar", "star", "dir", "por", "trar", "aver", "esser", "poter", "voler", "saper", "dover", "veder", "andar", "venir", "tener", "sentir", "dormir", "uscir", "morir"]);
/** @type {Set<string>|null} */
let VERB_LEMMAS = null;
const verbLemmas = () => {
  if (!VERB_LEMMAS) {
    VERB_LEMMAS = new Set();
    for (const list of Object.values(VERBS3_DB)) for (const e of list) VERB_LEMMAS.add(e[0]);
  }
  return VERB_LEMMAS;
};
/** Vero se la parola è un infinito, anche con i pronomi attaccati. @param {string} word */
export function isInfinitiveWord(word) {
  const w = word.toLowerCase().replace(/[^\p{L}']/gu, "");
  if (!w || NOUN_IN_ERE.has(w)) return false;
  if (INFINITIVE.test(w) || APOCOPATED.has(w)) return true;
  const m = w.match(CLITIC_TAIL);
  if (!m) return false;
  // "parti" non è "pare" + "ti": la base (con la -e) deve essere un verbo del lessico.
  const base = m[1] + "e";
  return verbLemmas().has(base) || /^(far|dar|star|dir|por|trar)$/.test(m[1]);
}
function isInfinitivePhrase(words) {
  return isInfinitiveWord(words[0]);
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

// Genere e numero possibili di una forma come nome (cat "N") o aggettivo ("A"), dal lessico: insieme di "ms", "fp"...
/** @param {string} tok @param {"N"|"A"} cat */
function readings(tok, cat) {
  const key = normTok(tok);
  const set = baseReadings(key, cat);
  // Plurale di un nome che il lessico non ha, ma di cui conosce il singolare: "capre" (capra), "amiche" (amica).
  if (cat === "N" && !set.size && !(LEX_DB[key] || []).length && key.length >= 4) {
    const cands = [];
    if (key.endsWith("e")) cands.push([key.slice(0, -1) + "a", "f"]);
    if (key.endsWith("i")) cands.push([key.slice(0, -1) + "o", "m"], [key.slice(0, -1) + "e", ""]);
    if (key.endsWith("chi")) cands.push([key.slice(0, -3) + "co", "m"]);
    if (key.endsWith("ghi")) cands.push([key.slice(0, -3) + "go", "m"]);
    for (const [sg, g] of cands) {
      const hit = [...baseReadings(sg, "N")].find((c) => c[1] === "s" && (!g || c[0] === g));
      if (hit) { set.add(hit[0] + "p"); break; }
    }
  }
  // Participio regolare che il lessico non ha ("attorcigliate"): la desinenza dice genere e numero.
  if (cat === "A" && !set.size && !(LEX_DB[key] || []).length && /^\p{L}{3,}(at|it|ut)[aeio]$/u.test(key)) set.add(({ a: "fs", e: "fp", i: "mp", o: "ms" })[key.slice(-1)]);
  return set;
}
const NP_STOP = /^(di|a|da|in|su|con|per|tra|fra|che|e|ed|o|ma|come|se|quando|mentre|del|dello|della|dell'|dei|degli|delle|al|allo|alla|all'|ai|agli|alle|nel|nella|nello|nei|negli|nelle)$/;
/** Letture di una forma nel lessico (INFLECT e LEX), senza indovinare. @param {string} key @param {"N"|"A"} cat */
function baseReadings(key, cat) {
  const set = new Set((formIndex().get(key) || []).filter((x) => x.cat === cat).map((x) => x.g + x.n));
  for (const c of LEX_DB[key] || []) if (c[0] === cat && c.length === 3) set.add(c[1] + c[2]);
  return set;
}
/** Genere e numero del sintagma nominale: il nome dà le possibilità, gli aggettivi che lo accompagnano le restringono
 *  ("molle ... attorcigliate": il nome è plurale femminile, non l'aggettivo singolare "molle").
 *  @param {string[]} tokens @returns {{g:string, n:string, hi:number}|null} */
function solveNounPhrase(tokens) {
  const hi = headIndex(tokens);
  if (hi < 0) return null;
  let cands = [...readings(tokens[hi], "N")];
  if (!cands.length) return null;
  for (let k = 0; k < tokens.length; k++) {
    if (k === hi) continue;
    const t = normTok(tokens[k]);
    if (!t) continue;
    if (k > hi && NP_STOP.test(t)) break;
    const ar = readings(t, "A");
    if (!ar.size || readings(t, "N").size) continue;   // vincolano solo gli aggettivi puri
    const inter = cands.filter((c) => ar.has(c));
    if (inter.length) cands = inter;
  }
  const sing = cands.filter((c) => c[1] === "s");
  const pool = sing.length ? sing : cands;
  const headLower = normTok(tokens[hi]);
  // Parole in -a e in -e con entrambi i generi (voce, chiave...): il femminile, salvo che un aggettivo dica maschile.
  const preferF = (headLower.endsWith("a") || headLower.endsWith("e")) && pool.some((c) => c[0] === "f");
  const pick = pool.find((c) => (preferF ? c[0] === "f" : c[0] === "m")) || pool[0];
  return { g: pick[0], n: pick[1], hi };
}

// Quantificatori, numerali e determinanti: dicono numero (e genere) della risposta prima ancora del nome.
const NUM_WORDS = /^(due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quindici|venti|trenta|quaranta|cinquanta|sessanta|settanta|ottanta|novanta|cento|duecento|mille)$/i;
const QUANT_MP = /^(alcuni|molti|tanti|pochi|troppi|parecchi|tutti|diversi|numerosi|vari|altri|certi|quanti)$/i;
const QUANT_FP = /^(alcune|molte|tante|poche|troppe|parecchie|tutte|diverse|numerose|varie|altre|certe|quante)$/i;
const QUANT_SG = /^(troppo|troppa|molto|molta|poco|poca|tanto|tanta|parecchio|parecchia|abbastanza)$/i;
const DET_FORMS = (() => {
  /** @type {Record<string, {g:string, n:string}>} */
  const t = {};
  const fams = [["questo", "questa", "questi", "queste"], ["quel", "quella", "quei", "quelle"], ["mio", "mia", "miei", "mie"], ["tuo", "tua", "tuoi", "tue"],
    ["suo", "sua", "suoi", "sue"], ["nostro", "nostra", "nostri", "nostre"], ["vostro", "vostra", "vostri", "vostre"]];
  for (const f of fams) { t[f[0]] = { g: "m", n: "s" }; t[f[1]] = { g: "f", n: "s" }; t[f[2]] = { g: "m", n: "p" }; t[f[3]] = { g: "f", n: "p" }; }
  Object.assign(t, { quello: { g: "m", n: "s" }, quegli: { g: "m", n: "p" }, nessuno: { g: "m", n: "s" }, nessun: { g: "m", n: "s" }, nessuna: { g: "f", n: "s" } });
  return t;
})();

// Genere e numero della risposta, dalla prima parola (articolo o nome).
export function whiteAgreement(text) {
  const words = text.replace(/[^\p{L}'\s-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const first = words[0].toLowerCase();
  // Parola singola nota come nome nei corpora annotati (solo train): la forma più frequente vince, anche se assomiglia a un infinito ("potere").
  if (words.length === 1 && PLURAL_BY_DEFAULT.has(first)) return { g: "m", n: "p" };
  if (words.length === 1 && UD_NOMI_DB[first]) {
    const best = Object.entries(UD_NOMI_DB[first]).sort((a, b) => b[1] - a[1])[0][0];
    return { g: best[0], n: best[1] };
  }
  if (isInfinitivePhrase(words)) return null;
  // "l'" non dice il genere: lo prendo dal nome che segue; "un'" è sempre femminile singolare.
  if (/^l'/.test(first)) { const info = nounOf(words[0].slice(2)); return info ? { g: info.g, n: info.n } : { g: "m", n: "s" }; }
  if (/^un'/.test(first)) return { g: "f", n: "s" };
  if (ART[first]) return { ...ART[first] };
  if (words.length > 1) {
    // Partitivo e determinanti: dicono genere e numero senza guardare il nome ("delle api", "due nani", "questi sandali").
    const rest = words.slice(1).join(" ");
    if (first === "dei" || first === "degli") return { g: "m", n: "p" };
    if (first === "delle") return { g: "f", n: "p" };
    if (first === "del" || first === "dello") return { g: "m", n: "s" };
    if (first === "della") return { g: "f", n: "s" };
    if (/^dell'/.test(first)) { const i2 = nounOf(first.slice(5)); return { g: i2?.g ?? "m", n: "s" }; }
    if (DET_FORMS[first]) return { ...DET_FORMS[first] };
    if (QUANT_MP.test(first)) return { g: "m", n: "p" };
    if (QUANT_FP.test(first)) return { g: "f", n: "p" };
    if (NUM_WORDS.test(first) || (/^\d+$/.test(first) && Number(first) > 1)) return { g: nounOf(rest)?.g ?? "m", n: "p" };
    if (/^(ogni|qualche)$/.test(first)) return { g: nounOf(rest)?.g ?? "m", n: "s" };
    if (QUANT_SG.test(first)) return { g: /a$/i.test(first) ? "f" : (nounOf(rest)?.g ?? "m"), n: "s" };
    // Il nome e i suoi aggettivi, insieme.
    const np = nounOf(text);
    if (np) return { g: np.g, n: np.n };
  }
  // Il lessico conosce numero e genere della parola: più affidabile di qualunque regola sulla desinenza.
  const lexN = (LEX_DB[first] || []).filter((c) => c.startsWith("N"));
  if (lexN.length) {
    const pool = lexN.filter((c) => c.endsWith("s")).length ? lexN.filter((c) => c.endsWith("s")) : lexN;
    const pick = (first.endsWith("a") && pool.find((c) => c[1] === "f")) || pool.find((c) => c[1] === "m") || pool[0];
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
  if (isInfinitiveWord(w0)) return false;
  if (words.length > 1 && /^\p{Lu}/u.test(w0) && /^\p{Lu}/u.test(words[1])) {
    const low0 = w0.replace(/[^\p{L}]/gu, "").toLowerCase();
    return PROPER_OVERRIDE.has(low0) || !readings(low0, "N").size;
  }
  if (/-/.test(w0) && /^\p{Lu}/u.test(w0)) return !isCommonHyphenated(w0);
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
// "Popolo delle Libertà", "Corte dei Conti": nome proprio fatto da un nome comune, una preposizione e un altro nome comune in maiuscolo.
// Con un nome di persona al posto del terzo ("Voce di Morgan Freeman") è invece un nome comune con un complemento.
const isInstitution = (/** @type {string[]} */ words) => words.length >= 3 && /^\p{Lu}/u.test(words[0]) && /^(di|del|della|dello|dei|degli|delle|dell')$/i.test(words[1]) && /^\p{Lu}/u.test(words[2])
  && readings(words[2], "N").size > 0 && !PROPER_OVERRIDE.has(words[2].toLowerCase()) && !FEMALE_NAMES.test(words[2]) && !(words[3] && /^\p{Lu}/u.test(words[3]));
/** Maiuscole da titolo sulla carta ("Scuole Superiori", "Stupro e Saccheggio", "eroina Messicana"): fuori dall'inizio della carta
 *  un aggettivo che accompagna un nome comune, o un nome dopo "e", torna minuscolo. I nomi propri restano com'erano. @param {string} text */
function lowerTitleCase(text) {
  const parts = text.split(/(\s+)/);
  let prev = -1;
  for (let k = 0; k < parts.length; k += 2) {
    const core = parts[k].replace(/[^\p{L}'-]/gu, "");
    if (!core) continue;
    const nextCap = /^\p{Lu}/u.test((parts[k + 2] || "").replace(/[^\p{L}'-]/gu, ""));
    if (prev >= 0 && core.length > 2 && /^\p{Lu}/u.test(core) && !/^\p{Lu}+$/u.test(core) && !core.includes("-") && !nextCap && /[aeio]$/i.test(core)) {
      const low = core.toLowerCase();
      const pCore = parts[prev].replace(/[^\p{L}'-]/gu, "").toLowerCase();
      const pNoun = readings(pCore, "N");
      const pCommon = pNoun.size > 0 && (prev === 0 || /^\p{Ll}/u.test(parts[prev]));
      const ar = readings(low, "A"), nr = readings(low, "N");
      let lower = false;
      if (pCommon && ar.size && !nr.size && !VERBS3_DB[low]) lower = true;
      else if (pCommon && ar.size && nr.size) lower = [...ar].some((c) => pNoun.has(c));
      else if (/^(e|ed)$/.test(pCore) && prev >= 2 && nr.size && !PROPER_OVERRIDE.has(low)) {
        const lc = parts[prev - 2].replace(/[^\p{L}'-]/gu, "").toLowerCase();
        lower = readings(lc, "N").size > 0 && (prev - 2 === 0 || /^\p{Ll}/u.test(parts[prev - 2]));
      }
      if (lower) parts[k] = parts[k].replace(core, low);
    }
    prev = k;
  }
  return parts.join("");
}
/** "Lecca-Lecca": tutte le parti sono parole del lessico, quindi è un nome comune scritto con le maiuscole della carta. @param {string} w */
function isCommonHyphenated(w) {
  const parts = w.replace(/[^\p{L}'-]/gu, "").toLowerCase().split("-");
  return parts.length > 1 && parts.every((p) => p.length > 1 && ((LEX_DB[p] || []).length > 0 || formIndex().has(p) || !!VERBS3_DB[p]));
}
function lowerIfMidSentence(text) {
  const words = text.trim().split(/\s+/);
  // Sigle e acronimi in maiuscolo (BATMAN!!!) restano così come sono.
  if (/^\p{Lu}{2,}[\p{Lu}\p{P}\d]*$/u.test(words[0].replace(/[.,!?]+$/, ""))) return text;
  // Infinito seguito da un nome proprio ("Imboccare Platinette"): è un verbo, non due maiuscole di un nome.
  if (isInfinitiveWord(words[0])) return text.charAt(0).toLowerCase() + text.slice(1);
  if (isInstitution(words)) return text;
  // Un articolo all'inizio non è un nome proprio: va in minuscolo anche se la parola dopo è maiuscola.
  const article = /^(Una|Un|Uno|Il|Lo|La|Gli|Le|I)$/.test(words[0]) || /^L'/.test(words[0]);
  const twoCaps = !article && words.length > 1 && /^\p{Lu}/u.test(words[0]) && /^\p{Lu}/u.test(words[1]);
  if (twoCaps) return text;
  // Nomi propri riconosciuti anche a una parola, o con trattino ("Pac-Man"): restano con la maiuscola.
  if (PROPER_OVERRIDE.has(words[0].replace(/[^\p{L}]/gu, "").toLowerCase())) return text;
  if (/-/.test(words[0]) && /^\p{Lu}/u.test(words[0]) && !isCommonHyphenated(words[0])) return text;
  const lowered = text.charAt(0).toLowerCase() + text.slice(1);
  // "Lecca-Lecca" -> "lecca-lecca": anche la parte dopo il trattino torna minuscola.
  return isCommonHyphenated(words[0]) ? lowered.replace(/^[^\s]+/, (w) => w.toLowerCase()) : lowered;
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
  if (PROPER_OVERRIDE.has(words[0].toLowerCase()) && /^\p{Lu}/u.test(words[0])) return null;   // "Dio", "Hulk": nomi propri
  // Parola singola annotata come nome nei corpora ("potere"): è un nome anche se ha l'aspetto di un infinito.
  if (words.length === 1 && UD_NOMI_DB[words[0].toLowerCase()]) {
    const best = Object.entries(UD_NOMI_DB[words[0].toLowerCase()]).sort((a, b) => b[1] - a[1])[0][0];
    return { g: best[0], n: best[1] };
  }
  if (isInfinitivePhrase(words)) return null;
  const hi = headIndex(words);
  if (hi < 0) return null;
  const head = (words[hi] || "").toLowerCase();
  if (!head) return null;
  // Due parole maiuscole di fila, o una parola maiuscola che il lessico non conosce: nome proprio.
  // Ma se la prima parola è un nome comune del lessico ("Batteri Mangia-Carne") non è un nome proprio.
  const firstIsNoun = (LEX_DB[(words[0] || "").toLowerCase()] || []).some((c) => c.startsWith("N"));
  const twoCaps = words.length > 1 && /^\p{Lu}/u.test(words[0]) && /^\p{Lu}/u.test(words[1]) && !firstIsNoun;
  if (twoCaps || PROPER_OVERRIDE.has(head)) return null;
  const codes = (LEX_DB[head] || []).filter((c) => c.startsWith("N"));
  const guessed = !codes.length && !LEX_DB[head] && readings(head, "N").size > 0;
  if (!codes.length && !guessed) return null;
  if (/^\p{Lu}/u.test(words[0]) && !LEX_DB[head] && !guessed) return null;
  // Il nome e gli aggettivi che lo accompagnano decidono insieme genere e numero.
  const solved = solveNounPhrase(words);
  if (solved) return { g: solved.g, n: solved.n };
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
    if (readings(tokens[k], "N").size) return k;
    if (!readings(tokens[k], "A").size) return -1;
  }
  return -1;
}
function inflectPhrase(text, nNeeded, gForced) {
  const endPunct = (text.match(/[.!?]+$/) || [""])[0];
  const tokens = text.trim().replace(/[.!?]+$/, "").split(/\s+/);
  const norm = normTok;
  const hi = headIndex(tokens);
  if (hi < 0) return null;
  const cands = (formIndex().get(norm(tokens[hi])) || []).filter((c) => c.cat === "N");
  const gs = [...new Set(cands.map((c) => c.g))];
  const headLower = norm(tokens[hi]);
  const g = gForced && gs.includes(gForced) ? gForced : gs.length === 1 ? gs[0] : headLower.endsWith("a") && gs.includes("f") ? "f" : gs.includes("m") ? "m" : gs[0];
  const base = cands.find((c) => c.g === g) ?? cands[0];
  if (!base) return null;
  const lemma = base.lemma;
  const n = nNeeded || base.n;
  // La parola già al numero giusto resta com'è ("cuore" non diventa la forma poetica "cuor").
  const sameForm = cands.some((c) => c.g === g && c.n === n);
  const head = (sameForm ? tokens[hi] : pickForm(lemma, "N", g, n)) ?? tokens[hi];
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

// ---------------------------------------------------------------------------------------------------------------
// Tutto ciò che segue lo spazio e concorda con la risposta: verbo (anche composto), participio, aggettivo predicativo.
// Participi e aggettivi predicativi che concordano col soggetto: "vietato", "accolto", "scolpito", "sconsigliato".
// Parole che il lessico conosce anche come aggettivi ma qui sono avverbi, preposizioni o determinanti: non concordano ("fino all'ultima goccia").
// Parole che Morph-it ha solo come aggettivi ma sulle carte sono nomi ("Preadolescente.").
const FORCE_NOUN = new Map(/** @type {[string, string][]} */ ([
  ["preadolescente", "Nms"], ["adolescente", "Nms"], ["mutilato", "Nms"], ["mutilata", "Nfs"], ["mutilati", "Nmp"], ["mutilate", "Nfp"],
  ["ubriaco", "Nms"], ["sconosciuto", "Nms"], ["colpevole", "Nms"], ["innocente", "Nms"],
]));
// Il lessico ha queste parole solo come aggettivi: per le carte valgono anche come nomi.
for (const [w, code] of FORCE_NOUN) {
  const codes = LEX_DB[w] || (LEX_DB[w] = []);
  if (!codes.some((c) => c.startsWith("N"))) codes.push(code);
}
const NOT_PREDICATE = new Set(["fino", "tanto", "quanto", "tutto", "altro", "mezzo", "stesso", "primo", "ultimo", "secondo", "terzo", "dietro", "dentro", "fuori", "sopra", "sotto", "lungo", "contro", "oltre", "vicino", "lontano", "dopo", "prima", "circa", "meno", "tale", "certo", "vario", "diverso", "ogni", "quasi", "alto", "basso", "pari", "buono", "bello", "grande", "piccolo", "nuovo", "vecchio", "giusto", "solo", "unico", "intero", "medio"]);
// Aggettivi che davvero seguono un nome e lo qualificano senza verbo: "ripieno di", "con ____ incluso".
const POSTNOMINAL = new Set(["ripieno", "pieno", "incluso", "compreso", "escluso", "annesso", "allegato", "obbligatorio", "vietato", "gratuito", "incorporato", "integrato", "abbinato", "collegato", "farcito", "condito", "decorato", "firmato", "assicurato"]);
const AGR_SKIP = new Set(["non", "mai", "già", "ancora", "più", "sempre", "poi", "anche", "spesso", "proprio", "davvero", "quasi", "forse", "subito", "solo", "soltanto", "solamente", "soprattutto", "pure", "addirittura", "perfino", "persino", "ormai", "magari", "molto", "tanto", "troppo", "poco"]);
const CL_SKIP = new Set(["si", "ci", "mi", "ti", "vi", "ne", "lo", "la", "li", "le", "gli"]);
// Verbi che reggono un participio o un aggettivo concordato con il soggetto (passivo con essere, andare, venire; copulativi).
const PRED_LEMMAS = new Set(["essere", "andare", "venire", "stare", "restare", "rimanere", "diventare", "sembrare", "apparire", "risultare", "divenire"]);
const caseLike = (orig, f) => (/^\p{Lu}/u.test(orig) ? f.charAt(0).toUpperCase() + f.slice(1) : f);
// Participi regolari che il lessico non ha come aggettivi ("accolto", "scolpito", "ritirato"): la desinenza si accorda.
const PART_END = /(at|it|ut|lt|ost|tt|rt|nt|st|ss|rs)[oaie]$/iu;
/** @param {string} w @param {string} g @param {string} n */
function agreeEnding(w, g, n) {
  const v = n === "p" ? (g === "f" ? "e" : "i") : (g === "f" ? "a" : "o");
  return w.slice(0, -1) + v;
}
/** Forma di un aggettivo o participio per genere e numero ("vietato" + f,p = "vietate"); null se non è un aggettivo né un participio. */
function adjForm(word, g, n, strict = false) {
  const low = word.toLowerCase();
  const es = (formIndex().get(low) || []).filter((x) => x.cat === "A");
  // La stessa parola può appartenere a più lemmi: prendo il primo che ha la forma richiesta.
  for (const e of es) {
    const f = pickForm(e.lemma, "A", g, n);
    if (f) return caseLike(word, f);
  }
  if (!es.length && !readings(low, "N").size) {
    // Dopo essere/andare/venire basta la desinenza di un participio; subito dopo lo spazio solo -ato/-ito/-uto ("abbinato").
    if (!strict && PART_END.test(low)) return agreeEnding(word, g, n);
    if (strict && low.length >= 6 && /(at|it|ut)[oaie]$/.test(low)) return agreeEnding(word, g, n);
  }
  if (!es.length && strict && POSTNOMINAL.has(low) && /(at|it|ut)o$/.test(low)) {
    return agreeEnding(word, g, n);
  }
  return null;
}
// Il participio passato di "essere": "stato" ("è stata accolta").
const STATO = { ms: "stato", fs: "stata", mp: "stati", fp: "state" };
/** Porta al genere e numero `feat` il verbo, il participio o l'aggettivo che segue lo spazio. Il testo senza verbo (ellissi) resta com'è.
 *  @param {string} text testo fisso dopo lo spazio @param {{g:string|null, n:string}} feat */
function agreeFollowing(text, feat, directOnly = false) {
  const g = feat.g === "f" ? "f" : "m", n = feat.n === "p" ? "p" : "s";
  const lead = /** @type {RegExpMatchArray} */ (text.match(/^(\s*)(,\s*)?/));
  let out = lead[0];
  let rest = text.slice(lead[0].length);
  const next = () => rest.match(/^([\p{L}'’]+)(\s*)/u);
  // Aggettivo o participio subito dopo lo spazio, senza verbo: "____, abbinato a ____", "____ ripieno di ____", "____ obbligatorio".
  const direct = (/** @type {RegExpMatchArray} */ m) => {
    const lw = m[1].toLowerCase();
    if (VERBS3_DB[lw] || AGR_SKIP.has(lw) || CL_SKIP.has(lw) || ART[lw] || NP_STOP.test(lw) || NOT_PREDICATE.has(lw)) return false;
    // Se lo spazio non è il soggetto basta meno: solo participi in -ato/-ito/-uto e gli aggettivi della lista.
    if (/^\p{Lu}/u.test(m[1]) && !POSTNOMINAL.has(lw)) return false;   // "Passo 2:", un titolo, un nome
    if (directOnly && !POSTNOMINAL.has(lw) && !/^\p{L}{4,}(at|it|ut)[oaie]$/u.test(lw)) return false;
    if (!directOnly && !POSTNOMINAL.has(lw) && readings(lw, "N").size) return false;   // "passo" è anche un nome
    const af = adjForm(m[1], g, n, true);
    if (!af) return false;
    out += af + m[2];
    rest = rest.slice(m[0].length);
    return true;
  };
  let m = next();
  if (!m) return text;
  if (directOnly) return direct(m) ? out + rest : text;
  // Prefisso: negazione, avverbi, pronomi che precedono il verbo.
  let guard = 0;
  while (m && guard++ < 4) {
    const lw = m[1].toLowerCase();
    const isPre = AGR_SKIP.has(lw) || (CL_SKIP.has(lw) && !VERBS3_DB[lw]);
    if (!isPre) break;
    out += m[1] + m[2];
    rest = rest.slice(m[0].length);
    m = next();
  }
  if (!m) return out + rest;
  const lw = m[1].toLowerCase();
  const ventry = VERBS3_DB[lw];
  if (!ventry) {
    // Nessun verbo: forse un aggettivo o un participio che si riferisce alla risposta.
    if (direct(m)) return out + rest;
    return out + rest;
  }
  // Verbo finito: il numero della risposta.
  const lemma = ventry[0][0];
  const repl = verbAgree(m[1], n);
  out += (repl ?? m[1]) + m[2];
  rest = rest.slice(m[0].length);
  if (!PRED_LEMMAS.has(lemma)) return out + rest;
  // Dopo essere/andare/venire: "stato" e i participi o gli aggettivi concordano col soggetto ("è stata accolta", "vanno ritirati").
  let k = 0;
  while (k++ < 4) {
    const t = next();
    if (!t) break;
    const tl = t[1].toLowerCase();
    if (AGR_SKIP.has(tl)) { out += t[1] + t[2]; rest = rest.slice(t[0].length); continue; }
    if (tl === "stato" || tl === "stata" || tl === "stati" || tl === "state") {
      out += caseLike(t[1], STATO[g + n]) + t[2];
      rest = rest.slice(t[0].length);
      continue;
    }
    if (VERBS3_DB[tl] || ART[tl] || NP_STOP.test(tl) || CL_SKIP.has(tl)) break;
    const af = adjForm(t[1], g, n);
    if (!af) break;
    out += af + t[2];
    rest = rest.slice(t[0].length);
  }
  // "La lezione di oggi: ____ non è ____, è un'opinione": la seconda copula è ancora del soggetto.
  if (lemma === "essere" && n === "p") {
    const c2 = rest.match(/^(,\s*)(è|era|sarà)(?=\s)/i);
    if (c2) rest = c2[1] + caseLike(c2[2], verbAgree(c2[2], "p") ?? c2[2]) + rest.slice(c2[0].length);
  }
  return out + rest;
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
// Nomi di massa o astratti (niente "un" davanti): "il tetano", "lo smegma".
const MASS_NOUNS = new Set(["tetano", "smegma", "alcolismo", "allattamento", "creazionismo", "autocannibalismo", "petting",
  "eugenetica", "necrofilia", "scientology", "herpes", "flato", "invidia", "sexting", "viagra", "bukkake", "aids", "seppuku",
  "sovracompensazione", "razzismo", "sesso", "carisma", "violenza", "pubertà", "obesità", "scienza", "agricoltura", "lebbra",
  "incesto", "masturbazione", "repressione", "speranza", "seduzione", "lievito", "stupidità", "nudità", "selezione",
  "riscaldamento", "suffragio", "musica", "pulizia", "distruzione", "fuoco", "disgusto", "ascolto", "carne", "tensione", "sessismo",
  "nazismo", "fascismo", "bullismo", "odio", "rabbia", "violenza"]);
// Nomi propri o rituali che con il partitivo suonano male ("della Scientology"): restano con il determinativo.
const MASS_DEFINITE_ONLY = new Set(["scientology", "seppuku", "aids", "herpes", "viagra"]);
// Risposta che inizia con un determinante ("quel tipo", "questa pizza", "due cani"): la preposizione non si contrae ("di quel tipo").
const DET_START = /^(questo|questa|questi|queste|quest'|quel|quello|quella|quei|quegli|quelle|mio|mia|miei|mie|tuo|tua|tuoi|tue|suo|sua|suoi|sue|nostro|nostra|nostri|nostre|vostro|vostra|vostri|vostre|loro|ogni|alcuni|alcune|qualche|nessun|nessuno|nessuna|molto|molti|molte|poco|pochi|poche|tanto|tanti|tante|troppo|troppi|troppe|parecchi|parecchie|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s/iu;
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
  const info0 = nounOf(text) ?? (opts.group ? { g: opts.g ?? "m", n: "p" } : null);
  const info = info0 && opts.g ? { ...info0, g: opts.g } : info0;
  if (!info) return null;
  const n = opts.n || info.n;
  // Il punto finale è della carta, non del sintagma: lo riattacco alla fine.
  const endPunct = (text.match(/[.!?]+$/) || [""])[0];
  let noun = text.trim().replace(/[.!?]+$/, "");
  // Le sigle ("AIDS", "NASA") e le istituzioni restano com'erano; le altre carte vanno in minuscolo dentro la frase.
  if (!isInstitution(noun.split(/\s+/)) && !/^\p{Lu}{2,}\b/u.test(noun)) {
    noun = noun.charAt(0).toLowerCase() + noun.slice(1);
    if (isCommonHyphenated(noun.split(/\s+/)[0])) noun = noun.replace(/^[^\s]+/, (w) => w.toLowerCase());
  }
  let out;
  if (opts.noArt) {
    out = noun;
  } else {
    const next = firstWord(noun.replace(/^\d+\s+/, ""));
    const kind = opts.kind || (n === "s" ? "indef" : "def");
    let art;
    if (kind === "def") art = defForm(info.g, n, next, null);
    else if (kind === "part" && n === "s") art = CONTRACT.di[defForm(info.g, "s", next, null)];
    else art = indefForm(info.g, n, next);
    out = (art.endsWith("'") ? art : art + " ") + noun;
  }
  if (atStart) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out + endPunct;
}

// Genere del nome proprio di persona: dal nome ("Michelle", "Lady", i nomi in -a), altrimenti maschile.
const FEMALE_NAMES = /^(lady|michelle|natalie|sarah|britney|hannah|barbara|oriana|elisabetta|katrina|maria|anna|giulia|chiara|laura|sofia|emma|marta|sara|elena|francesca|paola|silvia|monica|valentina|alessandra|martina)$/i;
const MALE_IN_A = /^(luca|nicola|andrea|mosè|giosuè|elia|enea|gesù|totò)$/i;
function properGender(text) {
  const w = (text.trim().split(/\s+/)[0] || "").replace(/[^\p{L}]/gu, "");
  if (/-/.test(text.trim().split(/\s+/)[0])) return "m";
  if (FEMALE_NAMES.test(w)) return "f";
  if (MALE_IN_A.test(w)) return "m";
  return /a$/i.test(w) && !/^(dio|dalla)$/i.test(w) ? "f" : "m";
}
const CLAUSE_WORDS = /^(che|mentre|quando|perch[ée]|se|dove|cui)$/i;
const PREPS = /^(di|a|da|in|su|con|per|tra|fra)$/i;
/** Due o più nomi senza preposizione né frase in mezzo ("Stupro e Saccheggio", "il gatto e la volpe"): una coordinazione al plurale.
 *  Restituisce i due pezzi, oppure null. @param {string} text @returns {[string, string]|null} */
function nominalCoordination(text) {
  const t = text.trim().replace(/[.!?]+$/, "");
  const m = t.match(/^(.+?)\s+(e|ed)\s+(.+)$/);
  if (!m) return null;
  const left = m[1].split(/\s+/);
  if (left.some((w) => PREPS.test(w) || CLAUSE_WORDS.test(w)) || isInfinitiveWord(left[0]) || isInfinitiveWord(m[3].split(/\s+/)[0])) return null;
  // Entrambi i lati devono essere sintagmi nominali: un articolo, un nome del lessico, un nome proprio.
  const nominal = (/** @type {string} */ x) => {
    const w0 = x.split(/\s+/)[0].toLowerCase();
    return !!ART[w0] || /^l'|^un'/.test(w0) || !!whiteAgreement(x) || isProperName(x);
  };
  return nominal(m[1]) && nominal(m[3]) ? [m[1], m[3]] : null;
}
/** Genere e numero con cui la risposta si comporta come soggetto (verbo, participio, pronome che la riprendono): sempre un valore.
 *  Un infinito o una frase è maschile singolare; due nomi coordinati sono plurali. @param {string} text @returns {{g:string, n:string}} */
export function subjectFeatures(text) {
  // "Lo Schiaccianoci: la danza della Fata Confetto": il soggetto è quello che sta dopo i due punti.
  const t = text.trim().replace(/[.!?]+$/, "").replace(/^.*:\s+(?=\S)/, "");
  const words = t.replace(/[^\p{L}'\s-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { g: "m", n: "s" };
  if (isInfinitivePhrase(words)) return { g: "m", n: "s" };
  const co = nominalCoordination(t);
  if (co) {
    const a = subjectFeatures(co[0]), b = subjectFeatures(co[1]);
    return { g: a.g === "f" && b.g === "f" ? "f" : "m", n: "p" };
  }
  if (words.length === 1 && PLURAL_BY_DEFAULT.has(words[0].toLowerCase())) return { g: "m", n: "p" };
  // Un nome proprio, a meno che il lessico riconosca un nome comune con i suoi aggettivi ("Post-it passivi aggressivi").
  if (isProperName(t) && !nounOf(t)) return { g: properGender(t), n: "s" };
  const a = whiteAgreement(t);
  if (a) return { g: a.g ?? "m", n: a.n };
  return { g: "m", n: "s" };
}

// Copula prima dello spazio: se la risposta è plurale il verbo è plurale, anche con un soggetto singolare
// ("la mia unica richiesta sono i miei demoni", non "è i miei demoni").
const COPULA = /^(è|sono|era|erano|sarà|saranno|fu|furono|sarebbe|sarebbero|resta|restano|rimane|rimangono|diventa|diventano|sembra|sembrano)$/i;
/** @param {string} text @param {string} white @param {{g:string, n:string}} [feat] */
function agreeCopula(text, white, feat) {
  const m = text.match(/(\p{L}+)(\s*)$/u);
  if (!m || !COPULA.test(m[1]) || /^\d/.test(white.trim())) return null;
  const n = (feat ?? subjectFeatures(white)).n;
  if (n !== "p") return null;
  const repl = verbAgree(m[1], "p");
  if (!repl) return null;
  return text.slice(0, m.index) + caseLike(m[1], repl) + m[2];
}

// Pronomi, participi e dimostrativi del testo fisso che riprendono la risposta ("lo ha vietato", "soltanto uno", "Testato, approvato").
const THIS = { ms: "questo", fs: "questa", mp: "questi", fp: "queste" };
const ANAPHORA = [
  { re: /\bne desideri soltanto uno\b/g, make: (/** @type {{g:string,n:string}} */ f) => `ne desideri soltanto ${f.g === "f" ? "una" : "uno"}` },
  { re: /\bsoltanto questo\b/g, make: (f) => `soltanto ${THIS[f.g + f.n]}` },
  { re: /\bTestato dai bambini, approvato dalle madri\b/g, make: (f) => `${adjForm("Testato", f.g, f.n) ?? "Testato"} dai bambini, ${adjForm("approvato", f.g, f.n) ?? "approvato"} dalle madri` },
  { re: /\bla Serie A lo ha vietato\b/g, make: (f) => {
    const part = adjForm("vietato", f.g, f.n) ?? "vietato";
    if (f.n === "p") return `la Serie A ${f.g === "f" ? "le" : "li"} ha ${part}`;
    return f.g === "f" ? `la Serie A l'ha ${part}` : "la Serie A lo ha vietato";
  } },
  // "se l'è portato via": con più soggetti si portano via in tanti.
  { re: /\bse l'è portato via\b/g, make: (f) => (f.n === "p" ? "se lo sono portato via" : "se l'è portato via") },
];
/** @param {string} text @param {{g:string, n:string}} feat */
function adaptAnaphora(text, feat) {
  let out = text;
  for (const r of ANAPHORA) out = out.replace(r.re, () => r.make(feat));
  return out;
}

// Una carta nera con uno o più spazi: ogni spazio attraversa le stesse fasi, nello stesso ordine.
export function fillSentence(blackText, whitesIn) {
  const whites = whitesIn.map((w) => (w == null ? w : lowerTitleCase(w)));
  const parts = blackText.split("____");
  /** Segmenti della frase: testo fisso, spazio vuoto o parola inserita. */
  /** @type {({t:"text", v:string} | {t:"slot", i:number} | {t:"word", v:string, i:number})[]} */
  const segs = [];
  const st = { blackText, whites, parts, segs, prevKept: false, keptPunct: false, chain: /** @type {{g:string, n:string}[]} */ ([]), chainOpen: false, subjFeat: /** @type {{g:string, n:string}|null} */ (null) };
  for (let i = 0; i < parts.length; i++) {
    if (i === parts.length - 1) {
      st.segs.push({ t: "text", v: parts[i] });
      break;
    }
    fillSlot(st, i);
  }
  // Anche nel testo fisso della carta nera: "una" davanti a vocale diventa "un'".
  return st.segs.map((x) => (x.t === "text" ? { ...x, v: x.v.replace(/ +([.,;:!?])/g, "$1").replace(/\buna (?=[aeiouàèéìòùAEIOUÀÈÉÌÒÙ])/gi, (m) => (m[0] === "U" ? "Un'" : "un'")) } : x));
}

// Uno spazio: le fasi in ordine. Lo stato dello spazio è in `sl`, quello della frase in `st`.
function fillSlot(st, i) {
  const orig = st.whites[i];
  // Genere e numero si leggono dalla carta com'è, prima che le fasi la trasformino (articolo, partitivo, preposizione).
  const sl = { i, before: st.parts[i], white: orig, fusedPrep: false, subjNum: null, feat: orig == null ? null : subjectFeatures(orig), isSubj: false };
  phasePrepareWhite(st, sl);
  // Lo spazio è il soggetto della frase: il verbo che segue deve concordare con la risposta.
  // Due spazi uniti da "," o "e" sono un soggetto solo, plurale ("____ e ____ vanno ritirati").
  const connector = /^\s*(,|e|ed)\s*$/.test(st.parts[i]);
  sl.isSubj = connector ? st.chainOpen : /(^\s*$|^\s*(questo|questa|questi|queste|quel|quella|quei|quelle|mio|mia|miei|mie|tuo|tua|tuoi|tue|suo|sua|suoi|sue|nostro|nostra|nostri|nostre|vostro|vostra|vostri|vostre|ogni|tutto|tutta|tutti|tutte)\s+$|[,;:(]\s*$|\b(che|quando|mentre|se|e|ma|perché|poiché|dove)\s*$)/i.test(st.parts[i]);
  if (sl.white == null) {
    st.chain = []; st.chainOpen = false;
    st.segs.push({ t: "text", v: sl.before }, { t: "slot", i });
    return;
  }
  if (sl.isSubj) { st.chain = connector && st.chainOpen ? [...st.chain, sl.feat] : [sl.feat]; st.chainOpen = true; }
  else { st.chain = []; st.chainOpen = false; }
  phaseStructure(st, sl);
  phaseFusePreposition(st, sl);
  phaseArticleAndAdjective(st, sl);
  phaseNounAgreement(st, sl);
  if (sl.isSubj) phaseSubjectVerb(st, sl);
  phaseAnaphora(st, sl);
  phaseGovernPreposition(st, sl);
  phaseEmit(st, sl);
}

/** Il testo dopo lo spazio comincia con un verbo finito (saltando negazione, avverbi, pronomi)? @param {string} text */
function startsWithVerb(text) {
  let rest = text.replace(/^(\s*)(,\s*)?/, "");
  for (let k = 0; k < 4; k++) {
    const m = rest.match(/^([\p{L}'’]+)\s*/u);
    if (!m) return false;
    const lw = m[1].toLowerCase();
    if (AGR_SKIP.has(lw) || (CL_SKIP.has(lw) && !VERBS3_DB[lw])) { rest = rest.slice(m[0].length); continue; }
    return !!VERBS3_DB[lw];
  }
  return false;
}

// Il testo fisso dopo lo spazio che riprende la risposta ("lo ha vietato", "soltanto questo") ne prende genere e numero.
// Se lo spazio non è il soggetto, concorda solo un aggettivo o participio che lo segue subito ("ripieno di", "incluso").
function phaseAnaphora(st, sl) {
  if (!sl.feat || st.parts[sl.i + 1] === undefined) return;
  st.parts[sl.i + 1] = adaptAnaphora(st.parts[sl.i + 1], sl.feat);
  if (sl.isSubj) { st.subjFeat = sl.feat; return; }
  st.parts[sl.i + 1] = agreeFollowing(st.parts[sl.i + 1], sl.feat, true);
  // "____ non è ____, è un'opinione": la copula dopo la virgola ha ancora il soggetto di prima.
  const c2 = st.subjFeat && st.parts[sl.i + 1].match(/^(\s*,\s*)(è|era|sarà|sono|erano|saranno)(?=\s)/i);
  if (c2 && st.subjFeat) {
    const v = verbAgree(c2[2], st.subjFeat.n);
    if (v) st.parts[sl.i + 1] = c2[1] + caseLike(c2[2], v) + st.parts[sl.i + 1].slice(c2[0].length);
  }
}

// Risposta che comincia con l'articolo contratto ("Dei serpenti") e la preposizione prima dello spazio lo fornisce già: l'articolo si toglie.
function phasePrepareWhite(st, sl) {
  const { blackText, parts } = st;
  const i = sl.i;
  if (sl.white == null) return;
  const cPrep = (sl.before.match(/(^|\s)(di|a|da|in|su)\s*$/i) ?? [])[2] ?? (i === 0 && QUESTION_PREP.test(blackText) ? blackText.match(QUESTION_PREP)[1] : null);
  const cm = sl.white.trim().match(/^(dei|degli|delle|del|della|dello|dell'|dal|dalla|dallo|dai|dagli|dalle|al|allo|alla|ai|agli|alle|nel|nella|nei|negli|nelle|sul|sulla|sui|sugli|sulle|sullo)(?=\s)/i);
  const contrBase = cm ? ({ dei: "di", degli: "di", delle: "di", del: "di", della: "di", dello: "di", dal: "da", dalla: "da", dallo: "da", dai: "da", dagli: "da", dalle: "da", al: "a", allo: "a", alla: "a", ai: "a", agli: "a", alle: "a", nel: "in", nella: "in", nei: "in", negli: "in", nelle: "in", sul: "su", sulla: "su", sui: "su", sugli: "su", sulle: "su", sullo: "su" })[cm[1].toLowerCase()] : null;
  if (cPrep && contrBase && cPrep.toLowerCase() === contrBase) sl.white = sl.white.trim().slice(cm[0].length).trimStart();
  const cop = agreeCopula(sl.before, sl.white, sl.feat ?? undefined);
  if (cop !== null) { parts[i] = cop; sl.before = cop; }
}

// Dati della risposta che servono alle fasi successive: inizio di frase, numero richiesto, articolo, nome senza articolo.
function phaseStructure(st, sl) {
  const { parts } = st;
  const i = sl.i;
  const { before, white } = sl;
  sl.atEnd = parts[i + 1].trim() === "" && i === parts.length - 2;
  // Inizio di frase: solo all'inizio della carta o dopo un punto, non dopo un altro spazio nel mezzo.
  sl.atStart = (before.trim() === "" && (i === 0 || st.prevKept || /[.!?]\s*$/.test(parts[i - 1] ?? ""))) || /[.!?]\s*$/.test(before);
  // Carta bianca con nome comune: la porto al numero della frase, poi metto l'articolo.
  sl.cue = numberCue(st.blackText, parts[i] ?? "");
  sl.artRe = /^((?:il|lo|la|i|gli|le|uno|una|un)\s+|l'|un')/i;
  sl.stripped = sl.artRe.test(white.trim()) && !/\s\p{Lu}/u.test(white.trim().replace(sl.artRe, "")) ? white.trim().replace(sl.artRe, "") : white.trim();
  sl.hasArt = sl.stripped !== white.trim();
  // Due nomi coordinati senza articolo ("Sole e arcobaleni"): restano nudi, senza articolo davanti al primo soltanto.
  sl.coord = !sl.hasArt && !!nominalCoordination(white);
  sl.noCapsInside = !/\s\p{Lu}/u.test(white.trim());
}

// Preposizione unita al nome: "di pane" → "del pane"; "pensare a un genocidio" → "pensare al genocidio"; "ad abbuffarsi" davanti a vocale.
function phaseFusePreposition(st, sl) {
  const { parts } = st;
  const i = sl.i;
  const pp = sl.white.trim().match(/^(di|a|da|in|su)\s+(\p{L}[\p{L}\s'-]*?)([.!?]*)$/iu);
  if (pp && !sl.hasArt) {
    const info = whiteAgreement(pp[2]);
    const artF = info ? defForm(info.g, info.n, firstWord(pp[2]), null) : null;
    const joined = artF ? CONTRACT[pp[1].toLowerCase()][artF] : null;
    if (joined) {
      sl.before = sl.before.replace(/\s*$/, " ") + joined + (joined.endsWith("'") ? "" : " ");
      parts[i] = sl.before;
      sl.white = pp[2] + pp[3];
      sl.fusedPrep = true;
    }
  }
  if (sl.fusedPrep) return;
  const tp = sl.before.match(/(^|\s)(a|di|da|in|su)\s*$/i);
  const wt = sl.white.trim();
  const ind = wt.match(/^(un|uno|una)\s+(\p{L}[\p{L}\s'-]*?)([.!?]*)$/iu);
  const preWord = ((sl.before.replace(/\s*(a|di|da|in|su)\s*$/i, "").match(/[\p{L}']+\s*$/u) || [""])[0] ?? "").trim();
  if (tp && ind && tp[2].toLowerCase() === "in" && TRANSFORM_VERB.test(preWord)) {
    // "si è trasformato in un metodo": l'articolo indeterminativo resta com'è.
  } else if (tp && ind && CONTRACT[tp[2].toLowerCase()]) {
    const prep = tp[2].toLowerCase();
    const info = whiteAgreement(ind[2]);
    const artF = info ? defForm(info.g, info.n, firstWord(ind[2]), null) : null;
    const joined = artF ? CONTRACT[prep][artF] : null;
    if (joined) {
      sl.before = sl.before.replace(/(^|\s)(a|di|da|in|su)\s*$/i, (m, sp) => sp + joined + (joined.endsWith("'") ? "" : " "));
      parts[i] = sl.before;
      sl.white = ind[2] + ind[3];
      sl.fusedPrep = true;
    }
  } else if (tp && tp[2].toLowerCase() === "a" && /^[aeiouàèéìòù]/i.test(wt) && !/^(uno|una|un|l'|il|i)\b/i.test(wt)) {
    sl.before = sl.before.replace(/(^|\s)a\s*$/i, (m, sp) => sp + "ad ");
    parts[i] = sl.before;
    if (!isProperName(wt) && !/^\p{Lu}{2,}\b/u.test(wt)) sl.white = wt.charAt(0).toLowerCase() + wt.slice(1);
    sl.fusedPrep = true;
  }
}

// Verbo di apertura, aggettivo dopo una copula: niente articolo, e l'aggettivo si accorda.
function phaseArticleAndAdjective(st, sl) {
  const { before } = sl;
  sl.firstW = (sl.white.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^\p{L}']/gu, "");
  // Verbo di apertura ("balla il tango"): se la parola seguente è un articolo o un pronome, è un verbo anche se il lessico conosce un nome uguale.
  const second = (sl.white.trim().split(/\s+/)[1] || "").toLowerCase();
  sl.verbFirst = !!VERBS3_DB[sl.firstW] && (/^(il|lo|la|i|gli|le|un|una|uno|sempre|troppo|molto|tanto|poco|ogni|mai)$/.test(second) || !(LEX_DB[sl.firstW] || []).some((c) => c.startsWith("N")));
  // Aggettivo dopo una copula ("è noioso"): niente articolo.
  sl.adjAfterCopula = /(^|\s)(è|sono|era|erano|sarà|saranno|sembra|sembrano|diventa|diventano|resta|restano|rimane|rimangono)\s*$/i.test(before) && (LEX_DB[sl.firstW] || []).some((c) => c.startsWith("A")) && !(LEX_DB[sl.firstW] || []).some((c) => c.startsWith("N")) && !FORCE_NOUN.has(sl.firstW);
  if (sl.adjAfterCopula) {
    const cop = (before.trim().split(/\s+/).pop() || "").toLowerCase();
    const plural = /^(sono|erano|saranno|sembrano|diventano|restano|rimangono)$/.test(cop);
    const core = sl.white.trim().replace(/[.!?]+$/, "");
    const adjN = adjustAdj(core, plural ? "p" : "s");
    if (adjN) sl.white = adjN + sl.white.trim().slice(core.length);
  }
}

// Nome comune nella risposta: numero, articolo e determinante. Le risposte con verbo o aggettivo restano come sono.
function phaseNounAgreement(st, sl) {
  const { parts, blackText, whites } = st;
  const i = sl.i;
  if (sl.coord) return;
  if (!((!sl.hasArt || sl.noCapsInside) && !sl.verbFirst && !sl.fusedPrep && !sl.adjAfterCopula)) return;
  // Il numero lo dice la risposta ("calze" è plurale), non la sola desinenza.
  const own0 = nounOf(sl.stripped);
  const wa = whiteAgreement(sl.stripped);
  // "Gay", "Amish", "Nerd": la risposta è già al plurale anche se il lessico non li conosce come nomi ("i gay sono stati...").
  const groupWord = wa && PLURAL_BY_DEFAULT.has(sl.stripped.trim().replace(/[.!?]+$/, "").toLowerCase());
  const own = own0 && wa ? { ...own0, n: wa.n, g: wa.g } : groupWord ? { g: wa.g, n: wa.n } : own0;
  if (!own) return;
  const { cue, stripped, hasArt, artRe } = sl;
  const flexed = inflectPhrase(stripped, cue ?? own.n, own.g ?? undefined) ?? stripped;
  const artWord = hasArt ? sl.white.trim().match(artRe)[1].trim().toLowerCase() : "";
  const kind = hasArt ? (/^(il|lo|la|l'|i|gli|le)$/.test(artWord) ? "def" : "indef") : null;
  const det = /(^|\s)(quante|quanti|quanta|quanto|tante|tanti|tanta|tanto|poche|pochi|poca|poco|troppe|troppi|troppa|troppo|parecchi|parecchie|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|questo|questa|quest'|quel|quella|ogni|mio|mia|tuo|tua|suo|sua|nostro|nostra|vostro|vostra|loro|alcuni|alcune|qualche|nessun|nessuna|molto|molti|molte|poco|tanto|troppo|ogni)\s*$/i.test(sl.before);
  if (det) sl.before = fixDeterminer(sl.before, own.g, cue ?? own.n);
  const afterPrep = /(^|\s)(di|a|da|in|su|con|per|tra|fra|senza|contro|dopo|verso|sotto|sopra|oltre|durante|presso|lungo|entro)\s*$/i.test(sl.before) || (i === 0 && QUESTION_PREP.test(blackText));
  const blackArt = /(^|\s)(un|uno|una|un'|il|lo|la|l'|i|gli|le)\s*$/i.test(sl.before);
  // Nomi di massa o astratti: senza articolo nella carta prendono il determinativo ("il tetano"), non "un tetano".
  const massNoun = !hasArt && !det && MASS_NOUNS.has(firstWord(stripped).toLowerCase());
  // Soggetto plurale davanti al verbo ("i batteri sono vietati"): articolo determinativo, non il partitivo ("dei batteri sono vietati").
  // Anche con più soggetti uniti da "e" / virgola prima del verbo: "____ e ____ sono vietati".
  const subjectBeforeVerb = () => {
    for (let j = i + 1; j < parts.length; j++) {
      if (startsWithVerb(parts[j] ?? "")) return true;
      if (!/^\s*[,;]?\s*(e|ed|o|oppure)?\s*$/i.test(parts[j] ?? "")) return false;
    }
    return false;
  };
  const preverbal = sl.isSubj && subjectBeforeVerb();
  // Risposta a "Qual è ...?", "Chi è ...?": dopo la copula la risposta ha il determinativo ("I mutilati", "Il razzismo"), non il partitivo.
  const answerDef = /(^|[.!?]\s+)(qual[ei]?|chi|che cos['’]è|cos['’]è)\b[^?]*\?\s*$/i.test(sl.before);
  // Nomi di massa: partitivo ("del razzismo", come "dei mutilati" al plurale); determinativo per soggetto, dopo preposizione e nelle risposte.
  // Dopo la copula ("è la speranza", non "è della speranza": quello vorrebbe dire "appartiene") e davanti a "contro" ("il sexting contro lo sniffare colla").
  const afterCopula = /(^|\s)(è|era|fu|sarà|sarebbe|sembra|diventa|resta|rimane)\s*$/i.test(sl.before);
  const versus = /^\s*(contro|vs\.?)\s/i.test(parts[i + 1] ?? "");
  const massDef = preverbal || afterPrep || blackArt || afterCopula || versus || answerDef || /^\s*,?\s*(soltanto|solo|proprio)\s+quest[oa]\b/i.test(parts[i + 1] ?? "") || MASS_DEFINITE_ONLY.has(firstWord(stripped).toLowerCase());
  const kindNow = massNoun ? (massDef ? "def" : "part") : (kind ?? ((cue ?? own.n) === "p" && !afterPrep && !blackArt ? (preverbal || answerDef ? "def" : "indef") : undefined));
  // Dopo una preposizione semplice il nome nudo non prende "uno/un": ci pensa la contrazione ("allo stupro").
  const bareAfterPrep = !hasArt && (/(^|\s)(a|di|da|in|su)\s*$/i.test(sl.before) || (i === 0 && QUESTION_PREP.test(blackText)));
  // Con la domanda prima ("Di cosa ...? ") la risposta resta minuscola: la preposizione della domanda la introduce.
  const bare = nounPhrase(flexed, sl.atStart && !(i === 0 && QUESTION_PREP.test(blackText)), { n: cue ?? own.n, kind: kindNow, noArt: det || bareAfterPrep || QUANT_SG.test(firstWord(stripped)), g: artWord === "un'" ? "f" : (own.g ?? undefined), group: !!groupWord });
  if (bare) sl.white = bare;
  // Due risposte nella stessa carta: se la prima chiude con "con il ...", la seconda, se è un nome nudo e la domanda è "come?", riprende "con" ("ti domandi come? con dei fantasmi").
  const rawW = (whites[i] ?? "").trim();
  if (i > 0 && /\bcome\?/i.test(blackText) && /\bcon\s+(il|lo|la|l'|i|gli|le)\b[^,;:!?]*\.?\s*$/i.test(whites[i - 1] ?? "") && !hasArt && !/^(il|lo|la|l'|i|gli|le|un|una|uno|un'|dei|degli|delle|con|di|a|da|in|su|per)\s/i.test(rawW)) {
    const wb = isProperName(flexed) ? flexed : flexed.charAt(0).toLowerCase() + flexed.slice(1);
    const artC = indefForm(own.g, cue ?? own.n, firstWord(flexed));
    sl.before = sl.before.replace(/\s*$/, " ") + ((/\.\s*$/.test(sl.before) || /\.\s*$/.test(whites[i - 1] ?? "")) && !/\?/.test(parts[i] ?? "") ? "Con " : "con ");
    sl.white = artC + " " + wb;
  }
  sl.subjNum = cue ?? own.n;
  // I tratti della risposta come appare nella frase: gli stessi li vedranno il verbo, i participi e i pronomi che la riprendono.
  if (!nominalCoordination(whites[i] ?? "")) {
    sl.feat = { g: own.g ?? own0?.g ?? sl.feat?.g ?? "m", n: cue ?? own.n };
    if (sl.isSubj && st.chain.length) st.chain[st.chain.length - 1] = sl.feat;
  }
}

// Il verbo (o il participio, l'aggettivo) dopo lo spazio concorda con il soggetto: la risposta, o tutte le risposte unite da "e".
function phaseSubjectVerb(st, sl) {
  const i = sl.i;
  if (sl.white == null || st.parts[i + 1] === undefined || !st.chain.length) return;
  const chain = st.chain;
  const plural = chain.length > 1 || chain.some((f) => f.n === "p");
  const gender = chain.length > 1 ? (chain.every((f) => f.g === "f") ? "f" : "m") : chain[0].g;
  st.parts[i + 1] = agreeFollowing(st.parts[i + 1], { g: gender, n: plural ? "p" : "s" });
}

// Preposizione richiesta dal verbo o già nel nero ("partecipino a ____"), o preposizione della domanda ("A cosa ...?").
const TRANSFORM_VERB = /(trasform|cambi|convert|divent|riduc|sciogli|trasfigur)\p{L}*$/iu;
// Nomi e aggettivi dopo i quali "di" introduce il contenuto o la quantità, senza articolo: "pieno di", "un pizzico di".
const BARE_DI_HEAD = /^(ripien[oaie]|pien[oaie]|pizzico|po'|poco|mare|sacco|mucchio|tipo|genere|specie|tanto|troppo|abbastanza|colm[oaie]|caric[oaie]|ricc[oaie]|priv[oaie]|vuot[oaie]|pezzo|fetta|bicchiere|tazza|cumulo|montagna|valanga|gocci[ao]|goccia|strato|nuvola|dose|spruzzat[ae]|manciata|spolverata|filo|fiotto|rivolo|pugno|cucchiaio|cucchiaino|litro|chilo|etto|grammo|porzione|boccata|sorso|goccio)$/iu;
// Misure e porzioni: "un pizzico di", "una manciata di", "un sorso di" + contenuto senza articolo.
const MEASURE_DI_HEAD = /^(pizzico|spruzzat[ae]|manciata|spolverata|goccia|gocci[ao]|goccio|sorso|filo|fiotto|rivolo|cucchiaio|cucchiaino|litro|chilo|etto|grammo|porzione|boccata|dose|strato|bicchiere|tazza|mucchio|sacco|cumulo|montagna|valanga|nuvola)$/iu;
const POSSESSIVE_OR_DEMONSTRATIVE = /^(mi[oa]|mie|miei|tu[oa]|tue|tuoi|su[oa]|sue|suoi|nostr[oaie]|vostr[oaie]|loro|quest[oaie]|quell[oaie]|quegli|quei|quel|quello|codest[oaie])$/iu;
function phaseGovernPreposition(st, sl) {
  const { blackText } = st;
  const i = sl.i;
  const { white } = sl;
  let before = sl.before;
  const gov = /sogn\p{L}*\s*$/iu.test(before) && whiteAgreement(white.trim()) !== null ? null : governedPrep(before);
  sl.prefixed = false;
  sl.pre = null;
  // Preposizione (richiesta dal verbo, oppure già nel nero: "partecipino a ____") + nome senza articolo: si unisce all'articolo giusto ("ai Ditalini", "alle caccole").
  const govWord = (white.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^\p{L}']/gu, "");
  const trailPrep = !gov ? before.match(/(^|\s)(a|di|da|in|su)\s*$/i) : null;
  const prepKey = gov ?? (trailPrep ? trailPrep[2].toLowerCase() : null);
  const barePlain = !sl.hasArt && !sl.verbFirst && !sl.adjAfterCopula && !sl.fusedPrep && !DET_START.test(white.trim()) && !isProperName(white) && !ART[govWord] && !/^(l'|un')/i.test(white.trim()) && !((LEX_DB[govWord] || []).some((c) => c.startsWith("A")) && !(LEX_DB[govWord] || []).some((c) => c.startsWith("N")));
  // Il sostantivo in -e (pane, latte) non ha desinenza che dica il genere: lo tratto come singolare maschile.
  const barInfo = barePlain ? (whiteAgreement(white.trim()) ?? nounOf(white.trim()) ?? (/^\p{Ll}+e[.!?]*$/u.test(white.trim()) && !/(ole|ile|ule|ate|ose)[.!?]*$/.test(white.trim()) ? { g: "m", n: "s" } : null)) : null;
  // "ripiena di caccole", "un pizzico di sale", "si è trasformata in caccole": qui il nome resta nudo.
  const wordBefore = ((before.replace(/\s*(a|di|da|in|su)\s*$/i, "").match(/[\p{L}']+\s*$/u) || [])[0] ?? "").trim().toLowerCase();
  // "una spruzzata di selezione naturale", non "della selezione naturale": dopo una misura il contenuto non ha l'articolo
  // (resta con possessivi e dimostrativi: "un pizzico del mio rispetto", "una dose di questa roba").
  if (prepKey === "di" && !sl.coord && MEASURE_DI_HEAD.test(wordBefore)) {
    const t = sl.white.trim();
    const art = t.match(/^(?:(?:il|lo|la|i|gli|le)\s+|l')(?=\p{L})/iu);
    if (art && !POSSESSIVE_OR_DEMONSTRATIVE.test(t.slice(art[0].length).split(/\s+/)[0])) sl.white = t.slice(art[0].length);
  }
  const keepBare = sl.coord || (prepKey === "di" && BARE_DI_HEAD.test(wordBefore)) || (prepKey === "in" && TRANSFORM_VERB.test(wordBefore));
  const govBare = !!prepKey && !!CONTRACT[prepKey] && !!barInfo && !keepBare;
  if (keepBare && !sl.coord && prepKey === "in" && trailPrep && barInfo && barInfo.n === "s") {
    // "si è trasformato in un metodo": l'articolo va nella risposta, perché dopo la preposizione fixArticle lo toglierebbe.
    const art = indefForm(barInfo.g, "s", govWord);
    sl.white = art + (art.endsWith("'") ? "" : " ") + sl.white;
  } else if (govBare) {
    const info = barInfo;
    const joined = CONTRACT[prepKey][defForm(info.g, info.n, govWord, null)];
    const sep = joined.endsWith("'") ? "" : " ";
    if (trailPrep) before = before.replace(/(^|\s)(a|di|da|in|su)\s*$/i, (m, sp) => sp + joined + sep);
    else before = before.replace(/\s*$/, " ") + joined + sep;
  } else if (gov) before = before.replace(/\s*$/, " ") + gov + " ";
  else if (i === 0 && QUESTION_PREP.test(blackText)) {
    // La risposta alla domanda prende la preposizione della domanda, unita all'articolo se c'è.
    const prep = blackText.match(QUESTION_PREP)[1].toLowerCase();
    sl.pre = contractFromWhite(prep + " ", white);
    // Nome comune senza articolo ("A cosa ...? Ditalini"): la preposizione si unisce all'articolo giusto ("Ai Ditalini").
    const qWord = (white.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^\p{L}']/gu, "");
    const qInfo = !sl.pre && CONTRACT[prep] && !sl.hasArt && !sl.verbFirst && !isProperName(white) && !ART[qWord] && !/^(l'|un')/i.test(white.trim()) ? whiteAgreement(white.trim()) : null;
    const qJoined = qInfo ? CONTRACT[prep][defForm(qInfo.g, qInfo.n, qWord, null)] : null;
    if (qJoined) sl.pre = { before: qJoined.endsWith("'") ? qJoined : qJoined + " ", white };
    sl.prefixed = true;
    before = before.replace(/\s*$/, " ") + (sl.pre ? sl.pre.before : prep + " ");
  }
  sl.before = before;
}

// Il pezzo finale: contrazione, articolo da togliere, punteggiatura, maiuscole, e il segmento della risposta.
function phaseEmit(st, sl) {
  const { parts } = st;
  const i = sl.i;
  const { white, atStart, atEnd } = sl;
  let before = sl.before;
  const contracted = sl.pre ? { before: "", white: sl.pre.white } : contractFromWhite(before, white);
  const fixed = contracted && !sl.pre ? { before: contracted.before, consumed: true }
    : sl.prefixed ? { before, consumed: false }
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
  st.keptPunct = !atEnd && nextIsBlank && /[.!?]+$/.test(w);
  if (!atEnd && !st.keptPunct) w = w.replace(/[.!?]+$/, "");
  // Nome proprio dopo l'articolo ("il Messico"): mantiene la maiuscola. La maiuscola dopo l'articolo resta solo per i nomi propri, non per "il Papa".
  const wTrim = white.trim();
  const artMatch = wTrim.match(sl.artRe);
  const restW = artMatch ? wTrim.slice(artMatch[0].length) : wTrim;
  const keepCase = isProperName(restW);
  // L'articolo rimasto davanti al nome ("Lo Schiaccianoci: ...") va comunque in minuscolo in mezzo alla frase.
  if (!atStart) w = keepCase && !sl.artRe.test(w) ? w : elideUna(lowerIfMidSentence(w));
  else if (w && /^\p{Ll}/u.test(w) && /(^\s*|[.!?]\s*)$/.test(fixed.before)) w = w.charAt(0).toUpperCase() + w.slice(1);
  // Il prefisso aggiunto prima della risposta ("dei ", "di ") apre la frase: anche lui vuole la maiuscola dopo il punto, l'esclamativo e l'interrogativo.
  const fbCap = atStart ? fixed.before.replace(/([.!?]\s+)(\p{Ll})([^.!?]*)$/u, (m, p, c, t) => p + c.toUpperCase() + t) : fixed.before;
  // Un infinito dopo "su", "in", "con", "contro", "da", "tra", "fra" vuole l'articolo: "sul fare", "contro il bere", "sull'essere".
  let fb2 = fbCap;
  if (!sl.hasArt && isInfinitiveWord(w.split(/\s+/)[0] || "")) {
    const np = fb2.match(/(^|\s)(su|in|con|contro|da|tra|fra)\s*$/i);
    if (np) {
      const prep = np[2].toLowerCase();
      const form = defForm("m", "s", firstWord(w), null);
      const joined = CONTRACT[prep] ? CONTRACT[prep][form] : `${prep} ${form}`;
      fb2 = fb2.slice(0, fb2.length - np[0].length) + np[1] + joined + (joined.endsWith("'") ? "" : " ");
    }
  }
  st.segs.push({ t: "text", v: fb2 }, { t: "word", v: w, i });
  st.prevKept = st.keptPunct;
}

export function sentencePlain(blackText, whites) {
  const out = fillSentence(blackText, whites).map((s) => (s.t === "slot" ? "____" : s.v)).join("");
  // Una frase che inizia con la risposta è una frase: la maiuscola va alla prima lettera (come "il labrador" → "Il labrador").
  return out.replace(/^(\s*)(\p{Ll})/u, (m, sp, c) => sp + c.toUpperCase());
}

// Spazi e carte bianche: quale tipo di risposta entra in ogni spazio della carta nera.
// Dopo "che" entrano solo frasi; in inizio frase, dopo due punti o nelle liste entrano nomi, infiniti e frasi;
// dopo una preposizione, un verbo o una congiunzione entrano quasi tutti; dopo un nome solo nomi.
export const ALL_FAMILIES = ["NOME_NUDO", "NOME_DETERMINATO", "INFINITO", "FRASE"];
export const NOUN_FAMILIES = ["NOME_NUDO", "NOME_DETERMINATO"];
const SLOT_PREP = new Set("a da di in con su per tra fra nel nella nei sul sulla dopo prima senza contro verso sotto sopra".split(" "));
const SLOT_VERB = new Set("è sono ho ha hanno vorrei cerco regalo prevede consiglia chiede compaiono promesso votato bevuto usare sa parla dice".split(" "));
const SLOT_LIST = new Set(["e", "o", "ma", "oppure"]);

/** Famiglie di carta bianca accettate dallo spazio che segue il testo `before`. */
export function acceptsAt(before) {
  const raw = before.replace(/\s+$/, "");
  if (raw === "" || /[:.,;!?"]$/.test(raw)) return ALL_FAMILIES;
  if (/\bche$/i.test(raw)) return ["FRASE"];
  const last = (raw.toLowerCase().match(/[a-zàèéìòù']+$/) || [""])[0];
  if (SLOT_PREP.has(last) || SLOT_VERB.has(last) || SLOT_LIST.has(last)) return ALL_FAMILIES;
  return NOUN_FAMILIES;
}

/** Per ogni spazio della carta nera, le famiglie di carta bianca che ci possono stare. */
export function blankAccepts(blackText) {
  const parts = blackText.split("____");
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) out.push(acceptsAt(parts[i]));
  return out;
}
