import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Come nell'app: il lessico (Morph-it!) è caricato prima di usare il motore.
const dataJson = (p) => JSON.parse(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
globalThis.LEX = dataJson("data/lexicon_it/lex.json");
globalThis.REGGENZE = dataJson("data/reggenze.json");
globalThis.INFLECT = dataJson("data/lexicon_it/inflect.json");
// Stessa integrazione del build (tools/build_web.py): nomi che Morph-it non ha.
for (const [sg, g, pl] of dataJson("data/lexicon_it/gaps.json").nomi) {
  if (sg in LEX) continue;
  LEX[sg] = [...(LEX[sg] || []), "N" + g + "s"];
  LEX[pl] = [...(LEX[pl] || []), ...(LEX[pl] || []).includes("N" + g + "p") ? [] : ["N" + g + "p"]];
  INFLECT[sg] = { N: { [g + "s"]: [sg], [g + "p"]: [pl] } };
}
globalThis.VERBS3 = dataJson("data/lexicon_it/verbs3.json");
globalThis.UD_NOMI = dataJson("data/lexicon_it/ud_nomi.json");
const { fillSentence, sentencePlain, whiteAgreement } = await import("../src/agreement.js");

test("articolo indeterminativo femminile singolare", () => {
  assert.equal(sentencePlain("Oggi ho visto un ____.", ["Carestia."]), "Oggi ho visto una carestia.");
});

test("articolo indeterminativo maschile singolare", () => {
  assert.equal(sentencePlain("Oggi ho visto un ____.", ["Festival della salsiccia."]), "Oggi ho visto un festival della salsiccia.");
});

test("articolo indeterminativo davanti a s impura", () => {
  assert.equal(sentencePlain("Oggi ho visto un ____.", ["Sexting."]), "Oggi ho visto un sexting.");
  assert.equal(sentencePlain("Oggi ho visto un ____.", ["Zoo abbandonato."]), "Oggi ho visto uno zoo abbandonato.");
});

test("plurale indeterminato", () => {
  assert.equal(sentencePlain("Oggi ho visto un ____.", ["Serpenti volanti."]), "Oggi ho visto dei serpenti volanti.");
  assert.equal(sentencePlain("Oggi ho visto un ____.", ["Caccole."]), "Oggi ho visto delle caccole.");
});

test("articolo definito e preposizione articolata", () => {
  assert.equal(sentencePlain("Ho parlato di il ____.", ["Carestia."]), "Ho parlato della carestia.");
  assert.equal(sentencePlain("Ho pensato a il ____.", ["Carestia."]), "Ho pensato alla carestia.");
  assert.equal(sentencePlain("Ho pensato a il ____.", ["Festival della salsiccia."]), "Ho pensato al festival della salsiccia.");
});

test("definito plurale femminile", () => {
  assert.equal(sentencePlain("Le ____ mi piacciono.", ["Caccole."]), "Le caccole mi piacciono.");
});

test("elisione davanti a vocale", () => {
  assert.equal(sentencePlain("Ho pensato a il ____.", ["Alcolismo."]), "Ho pensato all'alcolismo.");
});

test("senza articolo non cambia nulla", () => {
  assert.equal(sentencePlain("Si, ho ucciso ____ Ti domandi come? ____", ["Tetano.", "Rosso relativo."]), "Si, ho ucciso il tetano Ti domandi come? Un rosso relativo.");
});

test("la risposta con articolo non raddoppia l'articolo", () => {
  assert.equal(sentencePlain("Oggi ho visto un ____.", ["Un festival della salsiccia."]), "Oggi ho visto un festival della salsiccia.");
});

test("nomi propri: niente minuscola", () => {
  assert.equal(sentencePlain("Ho ascoltato ____ per ore.", ["Benny Benassi."]), "Ho ascoltato Benny Benassi per ore.");
});

test("spazio a inizio frase mantiene la maiuscola", () => {
  assert.equal(sentencePlain("____ sarà il nostro denaro.", ["Il Bitcoin."]), "Il Bitcoin sarà il nostro denaro.");
});

test("spazio vuoto: lo slot resta visibile", () => {
  const segs = fillSentence("Ho visto un ____ e ____.", ["Carestia.", null]);
  assert.equal(segs[segs.length - 1].t, "text");
  assert.ok(segs.some((s) => s.t === "slot" && s.i === 1));
});

test("accordo riconosciuto dalla prima parola", () => {
  assert.deepEqual(whiteAgreement("Carestia."), { g: "f", n: "s" });
  assert.deepEqual(whiteAgreement("Le caccole."), { g: "f", n: "p" });
  assert.deepEqual(whiteAgreement("Gli ebrei."), { g: "m", n: "p" });
});

test("preposizione richiesta da domanda + nome plurale: 'ai Ditalini'", () => {
  assert.equal(sentencePlain("A cosa rinuncio per la quaresima? ____.", ["Ditalini."]), "A cosa rinuncio per la quaresima? Ai ditalini.");
  assert.equal(sentencePlain("A cosa rinuncio per la quaresima? ____.", ["Roma."]), "A cosa rinuncio per la quaresima? A Roma.");
});

test("preposizione del nero + nome senza articolo: 'Sapore del pane', 'partecipino ai compiti'", () => {
  assert.equal(sentencePlain("Amaro Montenegro. Sapore di ____.", ["pane."]), "Amaro Montenegro. Sapore del pane.");
  assert.equal(sentencePlain("È un peccato che i ragazzini partecipino a ____.", ["compiti da moglie."]), "È un peccato che i ragazzini partecipino ai compiti da moglie.");
});

test("il verbo plurale della domanda precedente non rende plurale la risposta", () => {
  assert.equal(sentencePlain("Cosa mi stanno nascondendo i miei genitori? ____.", ["Un uomo di mezza età con un paio di pattini in linea."]),
    "Cosa mi stanno nascondendo i miei genitori? Un uomo di mezza età con un paio di pattini in linea.");
});

test("a + nome singolare s+consonante: allo, senza uno", () => {
  assert.equal(sentencePlain("Durante il sesso mi piace pensare a ____.", ["Stupro su appuntamento."]),
    "Durante il sesso mi piace pensare allo stupro su appuntamento.");
});

test("a + un genocidio: l'articolo cade e si contrae (al)", () => {
  assert.equal(sentencePlain("Durante il sesso mi piace pensare a ____.", ["un genocidio dei palestinesi"]),
    "Durante il sesso mi piace pensare al genocidio dei palestinesi.");
});

test("a + infinito che inizia per vocale: ad", () => {
  assert.equal(sentencePlain("Durante il sesso mi piace pensare a ____.", ["Abbuffarsi e vomitare."]),
    "Durante il sesso mi piace pensare ad abbuffarsi e vomitare.");
});

test("di + un ragno: del ragno", () => {
  assert.equal(sentencePlain("Ho paura di ____.", ["un ragno"]), "Ho paura del ragno.");
});

test("carta bianca che è un nome proprio dopo 'a' non crea errori di articolo", () => {
  assert.equal(sentencePlain("Oggi ho visto ____.", ["Carisma."]), "Oggi ho visto un carisma.");
});

test("il cuore resta cuore al singolare (non 'cuor')", () => {
  assert.equal(sentencePlain("Oggi ho visto ____.", ["Il cuore di un bambino."]), "Oggi ho visto il cuore di un bambino.");
});

test("soggetto coordinato con 'e' è plurale", () => {
  assert.equal(sentencePlain("Da oggi, ____ dà un vantaggio ingiusto.", ["Uno stupro e saccheggio."]),
    "Da oggi, uno stupro e saccheggio danno un vantaggio ingiusto.");
});

test("il participio concorda col soggetto plurale: sono vietati", () => {
  assert.equal(sentencePlain("Da oggi, sugli aerei, ____ è vietato.", ["Bambini con il cancro al culo."]),
    "Da oggi, sugli aerei, i bambini con il cancro al culo sono vietati.");
});

test("femminile singolare: è vietata", () => {
  assert.equal(sentencePlain("Da oggi, sugli aerei, ____ è vietato.", ["Una pizza."]), "Da oggi, sugli aerei, una pizza è vietata.");
});

test("ausiliario stato e participio concordano: sono stati accolti", () => {
  assert.equal(sentencePlain("Alla cena di famiglia, ____ è stato accolto con silenzio.", ["I cani."]),
    "Alla cena di famiglia, i cani sono stati accolti con silenzio.");
});

test("va + participio al plurale: vanno inseriti", () => {
  assert.equal(sentencePlain("Nel mio nuovo lavoro: ____ va inserito nel report trimestrale.", ["I cani."]),
    "Nel mio nuovo lavoro: i cani vanno inseriti nel report trimestrale.");
});

test("la risposta che inizia con minuscola diventa maiuscola a inizio frase", () => {
  assert.equal(sentencePlain("____ è il modo in cui voglio morire!", ["il labrador del tuo amico."]),
    "Il labrador del tuo amico è il modo in cui voglio morire!");
});

test("determinante dopo preposizione: 'di quel tipo' non si contrae", () => {
  assert.equal(sentencePlain("Ho parlato di ____.", ["Quel tipo."]), "Ho parlato di quel tipo.");
  assert.equal(sentencePlain("Ho parlato di ____.", ["Due cani."]), "Ho parlato di due cani.");
});

test("domanda 'di cosa' con risposta 'Dei ...': niente 'dei Dei'", () => {
  assert.equal(sentencePlain("Di cosa odorano le persone anziane? ____", ["Dei serpenti volanti."]),
    "Di cosa odorano le persone anziane? Dei serpenti volanti.");
});

test("soggetto plurale senza lemma nel lessico concorda col verbo", () => {
  assert.equal(sentencePlain("Per la mia nonna, ____ è semplice come respirare.", ["Centauri."]),
    "Per la mia nonna, i centauri sono semplici come respirare.");
});

test("nomi integrati a mano: genere e plurale corretti", () => {
  assert.equal(sentencePlain("Oggi ho visto ____.", ["Polaretti."]), "Oggi ho visto dei polaretti.");
  assert.equal(sentencePlain("Oggi ho visto ____.", ["Caccole."]), "Oggi ho visto delle caccole.");
});

test("nome di massa senza articolo prende il determinativo: il tetano", () => {
  assert.equal(sentencePlain("Oggi ho visto ____.", ["Tetano."]), "Oggi ho visto il tetano.");
});

test("infinito sconosciuto come soggetto: resta invariato", () => {
  assert.equal(sentencePlain("Da oggi, sugli aerei, ____ è vietato.", ["Covare un uovo."]), "Da oggi, sugli aerei, covare un uovo è vietato.");
});

test("nomi ambigui risolti dai corpora annotati: 'fine' è femminile, 'potere' maschile", () => {
  assert.equal(sentencePlain("Ho visto ____.", ["Fine."]), "Ho visto una fine.");
  assert.equal(sentencePlain("Ho visto ____.", ["Potere."]), "Ho visto un potere.");
});
