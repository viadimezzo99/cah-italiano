// Controllo ortografico e completamento in tempo reale, stile T9, con il lessico Morph-it!.
// Il file completo (web/spell/words.txt) si carica quando si scrive una carta; se manca, si usa il lessico della pagina.
let SPELL = null;
let SPELL_PROMISE = null;

function loadSpell() {
  if (SPELL) return Promise.resolve(SPELL);
  if (!SPELL_PROMISE) {
    SPELL_PROMISE = fetch("spell/words.txt")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("no words"))))
      .then((t) => setSpell(t.split("\n")))
      .catch(() => setSpell(fallbackWords()));
  }
  return SPELL_PROMISE;
}

function setSpell(list) {
  list.sort();
  SPELL = { list, set: new Set(list) };
  return SPELL;
}

// Parole della pagina: forme dei nomi, degli aggettivi e dei verbi del motore grammaticale.
function fallbackWords() {
  const words = new Set([...Object.keys(LEX), ...Object.keys(INFLECT), ...Object.keys(VERBS3)]);
  return [...words].filter((w) => /^[\p{L}'-]+$/u.test(w));
}

// Primo indice in cui la parola può comparire (ricerca binaria sull'elenco ordinato).
function lowerBound(list, prefix) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < prefix) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function commonWord(w) {
  return (typeof LEX !== "undefined" && Object.prototype.hasOwnProperty.call(LEX, w)) ||
    (typeof INFLECT !== "undefined" && Object.prototype.hasOwnProperty.call(INFLECT, w));
}

function completions(sp, prefix, max = 5) {
  const out = [];
  for (let i = lowerBound(sp.list, prefix); i < sp.list.length && out.length < 200; i++) {
    const w = sp.list[i];
    if (!w.startsWith(prefix)) break;
    out.push(w);
  }
  // Prima le forme usate dal motore grammaticale (più comuni), poi le più corte.
  const rank = (w) => (commonWord(w) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.length - b.length || (a < b ? -1 : 1)).slice(0, max);
}

// Correzioni con una modifica (cancella, sostituisci, inserisci, scambia due lettere).
function editsOne(word) {
  const L = "abcdefghijklmnopqrstuvwxyzàèéìòùî'-";
  const out = new Set();
  for (let i = 0; i <= word.length; i++) {
    for (const c of L) {
      out.add(word.slice(0, i) + c + word.slice(i));
      if (i < word.length) out.add(word.slice(0, i) + c + word.slice(i + 1));
    }
    if (i < word.length) out.add(word.slice(0, i) + word.slice(i + 1));
    if (i < word.length - 1) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }
  out.delete(word);
  return out;
}

function corrections(sp, word, max = 4) {
  const found = [...editsOne(word)].filter((w) => sp.set.has(w));
  return found
    .sort((a, b) => (commonWord(a) ? 0 : 1) - (commonWord(b) ? 0 : 1) || Math.abs(a.length - word.length) - Math.abs(b.length - word.length) || (a < b ? -1 : 1))
    .slice(0, max);
}

// Ultima parola che si sta scrivendo (lettere, apostrofo, trattino).
function currentWord(text) {
  const m = text.match(/([\p{L}'-]+)$/u);
  return m ? m[1] : "";
}

// Suggerimenti per la parola in scrittura: completamenti se è incompleta, correzioni se non esiste.
function spellHints(sp, word) {
  const low = word.toLowerCase();
  if (low.length < 2) return { exact: true, items: [] };
  const exact = sp.set.has(low) || /^(l'|un'|dell'|all'|dall'|nell'|sull')/.test(low);
  if (exact) return { exact: true, items: completions(sp, low).filter((w) => w !== low).slice(0, 4) };
  const done = completions(sp, low);
  if (done.length) return { exact: true, items: done.slice(0, 4) };
  return { exact: false, items: low.length >= 3 ? corrections(sp, low) : [] };
}
