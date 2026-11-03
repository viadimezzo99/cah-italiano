// Anteprima della frase: inserisce la carta bianca nello spazio e aggiusta
// articoli e preposizioni articolate in base a genere e numero della risposta.
// Euristica per l'italiano: non è un parser. Dove non è sicura, lascia il testo com'è.

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
  else return { before, consumed: false }; // "di un ..." non si tocca
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
  const twoCaps = words.length > 1 && /^\p{Lu}/u.test(words[0]) && /^\p{Lu}/u.test(words[1]);
  if (twoCaps) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// Per ogni spazio: testo prima, parola inserita, testo dopo.
// whites[i] = testo della risposta per lo spazio i, oppure null se non ancora scelta.
export function fillSentence(blackText, whites) {
  const parts = blackText.split("____");
  const segs = [];
  for (let i = 0; i < parts.length; i++) {
    let before = parts[i];
    if (i === parts.length - 1) {
      segs.push({ t: "text", v: before });
      break;
    }
    const white = whites[i];
    if (white == null) {
      segs.push({ t: "text", v: before }, { t: "slot", i });
      continue;
    }
    const after = parts[i + 1];
    const atEnd = after.trim() === "" && i === parts.length - 2;
    const atStart = before.trim() === "";
    const fixed = fixArticle(before, white);
    let w = white.trim();
    // Se l'articolo è stato riscritto, togli quello della risposta per non averne due.
    if (fixed.consumed && /^(il|lo|la|l'|i|gli|le|un|uno|una|un')\s+/i.test(w)) {
      w = w.replace(/^\S+\s+/, "");
    }
    if (!atEnd) w = w.replace(/[.!?]+$/, "");
    if (!atStart && !fixed.consumed) w = lowerIfMidSentence(w);
    else if (!atStart && fixed.consumed) w = lowerIfMidSentence(w);
    segs.push({ t: "text", v: fixed.before }, { t: "word", v: w, i });
    parts[i + 1] = after;
  }
  return segs;
}

export function sentencePlain(blackText, whites) {
  return fillSentence(blackText, whites).map((s) => (s.t === "slot" ? "____" : s.v)).join("");
}
