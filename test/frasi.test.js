// Categoria "Frasi": esclamazioni, meme e battute famose. Entrano solo negli spazi tra virgolette («____»), e restano com'erano scritte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dataJson = (p) => JSON.parse(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
globalThis.LEX = dataJson("data/lexicon_it/lex.json");
globalThis.REGGENZE = dataJson("data/reggenze.json");
globalThis.INFLECT = dataJson("data/lexicon_it/inflect.json");
globalThis.VERBS3 = dataJson("data/lexicon_it/verbs3.json");
globalThis.UD_NOMI = dataJson("data/lexicon_it/ud_nomi.json");
const { sentencePlain, blankAccepts, isQuoteSlot } = await import("../src/agreement.js");
const { Game, sanitizeCustom, seededRng } = await import("../src/game.js");
const cards = dataJson("data/cards.json");

test("lo spazio tra virgolette accetta solo Frasi e infiniti", () => {
  assert.deepEqual(blankAccepts("Il mio motto di vita: «____»"), [["CITAZIONE", "INFINITO"]]);
  assert.deepEqual(blankAccepts("«____» disse il medico. «____» rispose il paziente."), [["CITAZIONE", "INFINITO"], ["CITAZIONE", "INFINITO"]]);
  assert.equal(isQuoteSlot("Sulla mia lapide ci sarà scritto: «"), true);
  assert.equal(isQuoteSlot("Da oggi, sugli aerei, "), false);
});

test("le Frasi non entrano negli spazi normali", () => {
  for (const black of ["Da oggi, sugli aerei, ____ è vietato.", "Nel mio nuovo libro: ____ e ____.", "Il mio ex mi ha lasciato per colpa di ____."]) {
    for (const acc of blankAccepts(black)) assert.ok(!acc.includes("CITAZIONE"), black);
  }
});

test("la citazione resta com'è scritta: maiuscole, punteggiatura, niente accordi", () => {
  assert.equal(sentencePlain("Le ultime parole di mio nonno: «____»", ["DEVI COSTRUIRE ALTRI PILONI."]), "Le ultime parole di mio nonno: «DEVI COSTRUIRE ALTRI PILONI.»");
  assert.equal(sentencePlain("Il mio motto di vita: «____»", ["Bere da solo."]), "Il mio motto di vita: «Bere da solo.»");
  assert.equal(sentencePlain("Il mio motto di vita: «____»", ["ciao bella."]), "Il mio motto di vita: «Ciao bella.»");
  assert.equal(sentencePlain("«____» disse il medico. «____» rispose il paziente.", ["Api?", "Dolce, dolce vendetta."]), "«Api?» disse il medico. «Dolce, dolce vendetta.» rispose il paziente.");
});

test("i dati: le Frasi hanno la famiglia CITAZIONE e le nere con citazione sono abbastanza", () => {
  const frasi = cards.white.filter((w) => w.cat === "Frasi");
  assert.ok(frasi.length >= 8, `${frasi.length} Frasi`);
  assert.ok(frasi.every((w) => w.family === "CITAZIONE"));
  assert.ok(cards.white.filter((w) => w.family === "CITAZIONE").every((w) => w.cat === "Frasi"));
  const quote = cards.black.filter((b) => /«____»/.test(b.text));
  assert.ok(quote.length >= 12, `${quote.length} nere con citazione`);
  for (const b of quote) assert.equal(b.blanks, b.text.split("____").length - 1, b.text);
});

test("in un turno con citazione ogni giocatore ha almeno una Frase e due carte che ci entrano", () => {
  const players = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
  let checked = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const game = new Game(players, cards, { rng: seededRng(seed), jolly: false });
    game.start();
    const quote = cards.black.filter((b) => /«____»/.test(b.text))[seed % 12];
    game.currentBlack = quote;
    game.ensureFit();
    for (const p of game.players) {
      if (p.id === game.judge.id) continue;
      const fam = p.hand.map((id) => game.whiteById.get(id)?.family);
      assert.ok(fam.includes("CITAZIONE"), `seme ${seed}, ${p.id}: nessuna Frase per "${quote.text}"`);
      assert.ok(fam.filter((f) => f === "CITAZIONE" || f === "INFINITO").length >= 2);
      checked++;
    }
  }
  assert.ok(checked >= 30);
});

test("i bot scelgono una carta che entra nello spazio", () => {
  const players = [{ id: "a", name: "A" }, { id: "b", name: "B", isBot: true }, { id: "c", name: "C", isBot: true }];
  for (let seed = 1; seed <= 15; seed++) {
    const game = new Game(players, cards, { rng: seededRng(seed), jolly: false });
    game.start();
    const quote = cards.black.filter((b) => /«____»/.test(b.text) && b.blanks === 1)[seed % 10];
    game.currentBlack = quote;
    game.ensureFit();
    for (const bot of game.players.filter((p) => p.isBot && p.id !== game.judge.id)) {
      game.autoPlay(bot.id);
      const played = game.submissions.get(bot.id) ?? [];
      assert.ok(["CITAZIONE", "INFINITO"].includes(game.whiteById.get(played[0])?.family), `seme ${seed}: il bot ha giocato ${game.cardText.get(played[0])}`);
    }
  }
});

test("carte personali: la categoria Frasi dà la famiglia CITAZIONE", () => {
  const c = sanitizeCustom({ white: [{ text: "Hasta la vista!", cat: "Frasi" }, { text: "Un gatto", cat: "Soggetti" }], black: [] });
  assert.equal(c.white[0].family, "CITAZIONE");
  assert.equal(c.white[1].family, undefined);
});
