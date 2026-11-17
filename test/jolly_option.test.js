// Opzione "regola del jolly" a inizio partita: se è spenta, il Memory del Re non assegna il jolly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Game, seededRng } from "../src/game.js";

const cards = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
const players = ["a", "b", "c"].map((id) => ({ id, name: id }));

test("con il jolly acceso il Re vince il jolly col Memory", () => {
  const g = new Game(players, cards, { rng: seededRng(7), jolly: true });
  g.start();
  const ev = g.awardJolly(g.judge.id);
  assert.equal(ev.length, 1);
  assert.equal(g.jollyHolder, g.judge.id);
});

test("con il jolly spento il Memory non assegna nulla", () => {
  const g = new Game(players, cards, { rng: seededRng(7), jolly: false });
  g.start();
  assert.deepEqual(g.awardJolly(g.judge.id), []);
  assert.equal(g.jollyHolder, null);
  assert.equal(g.publicState(g.judge.id).jolly, false);
});

test("di default il jolly è acceso", () => {
  const g = new Game(players, cards, { rng: seededRng(7) });
  g.start();
  assert.equal(g.publicState(g.judge.id).jolly, true);
});

// Stanza online: l'ospite sceglie il jolly e la partita lo riceve (anche nei giri successivi).
import { webcrypto } from "node:crypto";
import vm from "node:vm";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const roomCode = ["src/agreement.js", "src/game.js", "tools/room.js"]
  .map((f) => readFileSync(new URL("../" + f, import.meta.url), "utf8").replace(/^export /gm, "").replace(/^import .*$/gm, ""))
  .join("\n");
vm.runInThisContext(roomCode + "\nglobalThis.__createRoomHost2 = createRoomHost;");

test("stanza online: il jolly spento arriva alla partita", () => {
  const host = __createRoomHost2({ cards, turnSeconds: 0 });
  const mk = () => { const inbox = []; return { conn: host.connection("x", (r) => inbox.push(JSON.parse(r))), last: (t) => [...inbox].reverse().find((m) => m.type === t) }; };
  const a = mk(), b = mk(), c = mk();
  host.handle(a.conn, { type: "create", name: "A", code: "JOLY" });
  host.handle(b.conn, { type: "join", code: "JOLY", name: "B" });
  host.handle(c.conn, { type: "join", code: "JOLY", name: "C" });
  host.handle(a.conn, { type: "start", winScore: 3, jolly: false });
  const room = host.rooms.get("JOLY");
  assert.equal(room.game.opts.jolly, false);
  assert.equal(room.game.publicState(null).jolly, false);
});
