// Cambia mano: quanti cambi a testa si possono fare (0 mai, 3 a testa, 99 a ogni turno), uno per turno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Game } from "../src/game.js";

const white = Array.from({ length: 120 }, (_, i) => ({ id: `w${i}`, text: `Carta ${i}.` }));
const black = Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, text: `Nera ${i} ____.`, blanks: 1 }));
const players = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
let seed = 11;
const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Gioca fino al turno successivo: tutti rispondono, il Re sceglie, si passa oltre. */
function nextRound(game) {
  for (const p of game.players) if (p.id !== game.judge.id && !game.submissions.has(p.id)) game.play(p.id, [p.hand[0]]);
  game.pick(game.judge.id, 0);
  game.nextRound();
}
const nonJudge = (game) => game.players.find((p) => p.id !== game.judge.id);

test("di default: tre cambi a testa, uno per turno", () => {
  const game = new Game(players, { white, black }, { rng, winScore: 99 });
  game.start();
  const me = game.player("a");
  let used = 0, rounds = 0;
  while (rounds < 12 && used < 5) {
    rounds += 1;
    if (game.judge.id !== me.id) {
      if (used < 3) {
        assert.equal(game.canReshuffle(me.id), true, `turno ${game.round}: il cambio è disponibile`);
        game.reshuffleHand(me.id);
        used += 1;
        assert.equal(game.canReshuffle(me.id), false, "una volta sola per turno");
        assert.equal(game.publicState(me.id).reshuffledNow, true);
      } else {
        assert.equal(game.canReshuffle(me.id), false, "dopo tre cambi non ce ne sono più");
        assert.throws(() => game.reshuffleHand(me.id));
        assert.equal(game.publicState(me.id).reshufflesLeft, 0);
        used += 1;
      }
    }
    nextRound(game);
  }
  assert.ok(used >= 5, "il test ha attraversato i tre cambi e almeno due turni senza");
});

test("il contatore scende a ogni cambio e lo vede solo chi lo fa", () => {
  const game = new Game(players, { white, black }, { rng, winScore: 9 });
  game.start();
  const me = nonJudge(game), other = game.players.find((p) => p.id !== game.judge.id && p.id !== me.id);
  assert.equal(game.publicState(me.id).reshufflesLeft, 3);
  assert.equal(game.publicState(me.id).reshuffleRule, 3);
  game.reshuffleHand(me.id);
  assert.equal(game.publicState(me.id).reshufflesLeft, 2);
  assert.equal(game.publicState(other.id).reshufflesLeft, 3, "gli altri hanno ancora tutti i loro cambi");
});

test("regola 0: il cambio non esiste", () => {
  const game = new Game(players, { white, black }, { rng, winScore: 9, reshuffles: 0 });
  game.start();
  const me = nonJudge(game);
  assert.equal(game.canReshuffle(me.id), false);
  assert.equal(game.publicState(me.id).reshuffleRule, 0);
  assert.throws(() => game.reshuffleHand(me.id));
});

test("regola 99: un cambio a ogni turno, senza fine", () => {
  const game = new Game(players, { white, black }, { rng, winScore: 99, reshuffles: 99 });
  game.start();
  for (let round = 0; round < 8; round++) {
    const me = nonJudge(game);
    assert.equal(game.canReshuffle(me.id), true, `turno ${round + 1}`);
    game.reshuffleHand(me.id);
    assert.equal(me.hand.length, 10);
    nextRound(game);
  }
});

test("il Re e chi ha già risposto non possono cambiare mano", () => {
  const game = new Game(players, { white, black }, { rng, winScore: 9 });
  game.start();
  assert.equal(game.canReshuffle(game.judge.id), false);
  const me = nonJudge(game);
  game.play(me.id, [me.hand[0]]);
  assert.equal(game.canReshuffle(me.id), false);
});

// --- Stanza online: l'ospite sceglie la regola nella lobby, la vedono tutti e vale per la partita.
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const root = new URL("../", import.meta.url);
const code = ["src/agreement.js", "src/game.js", "tools/room.js"]
  .map((f) => readFileSync(new URL(f, root), "utf8").replace(/^export /gm, "").replace(/^import .*$/gm, ""))
  .join("\n");
const cards = JSON.parse(readFileSync(new URL("data/cards.json", root), "utf8"));
vm.runInThisContext(code + "\nglobalThis.__createRoomHostReshuffle = createRoomHost;");

function phone(host, name) {
  const inbox = [];
  const conn = host.connection(name, (raw) => inbox.push(JSON.parse(raw)));
  return { conn, inbox, last: (type) => [...inbox].reverse().find((m) => !type || m.type === type) };
}
function lobby(codeName) {
  const host = __createRoomHostReshuffle({ cards, turnSeconds: 0 });
  const a = phone(host, "a"), b = phone(host, "b"), c = phone(host, "c");
  host.handle(a.conn, { type: "create", name: "A", code: codeName });
  host.handle(b.conn, { type: "join", code: codeName, name: "B" });
  host.handle(c.conn, { type: "join", code: codeName, name: "C" });
  return { host, a, b, room: host.rooms.get(codeName) };
}

test("online: di default 3 a testa; l'ospite cambia la regola e tutti la vedono", () => {
  const { host, a, b } = lobby("RSAA");
  assert.equal(b.last("state").reshuffles, 3);
  host.handle(a.conn, { type: "setReshuffles", reshuffles: 99 });
  assert.equal(b.last("state").reshuffles, 99, "l'ospite l'ha cambiata e l'altro telefono la vede");
  host.handle(a.conn, { type: "setReshuffles", reshuffles: 7 });
  assert.equal(b.last("state").reshuffles, 3, "un valore non previsto torna al predefinito");
});

test("online: solo l'ospite sceglie la regola, e non a partita iniziata", () => {
  const { host, a, b, room } = lobby("RSBB");
  host.handle(b.conn, { type: "setReshuffles", reshuffles: 0 });
  assert.match(b.last("error")?.message ?? "", /Solo chi ha creato/);
  assert.equal(room.reshufflesChoice, undefined);
  host.handle(a.conn, { type: "setReshuffles", reshuffles: 0 });
  host.handle(a.conn, { type: "start", winScore: 3, custom: { white: [], black: [] } });
  assert.equal(room.game.opts.reshuffles, 0, "la partita parte con la regola scelta");
  host.handle(a.conn, { type: "setReshuffles", reshuffles: 99 });
  assert.match(a.last("error")?.message ?? "", /già in corso/);
});

test("online: il messaggio reshuffle rispetta il limite della regola", () => {
  const { host, a, b, room } = lobby("RSCC");
  host.handle(a.conn, { type: "setReshuffles", reshuffles: 3 });
  host.handle(a.conn, { type: "start", winScore: 3, custom: { white: [], black: [] } });
  const g = room.game;
  const pid = (ph) => ph.last("state").you;
  const player = [a, b].find((ph) => pid(ph) !== g.judge.id);
  host.handle(player.conn, { type: "reshuffle" });
  assert.equal(player.last("state").game.reshufflesLeft, 2);
  host.handle(player.conn, { type: "reshuffle" });
  assert.match(player.last("error")?.message ?? "", /Non puoi rimescolare/, "un secondo cambio nello stesso turno non è permesso");
});
