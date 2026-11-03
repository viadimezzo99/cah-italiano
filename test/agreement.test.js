import { test } from "node:test";
import assert from "node:assert/strict";
import { fillSentence, sentencePlain, whiteAgreement } from "../src/agreement.js";

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
  assert.equal(sentencePlain("Oggi ho visto un ____.", ["Caccole."]), "Oggi ho visto un caccole.");
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
  assert.equal(sentencePlain("Si, ho ucciso ____ Ti domandi come? ____", ["Tetano.", "Rosso relativo."]), "Si, ho ucciso tetano Ti domandi come? rosso relativo.");
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
