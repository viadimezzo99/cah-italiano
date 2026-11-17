// Tempi di turno online: il conto alla rovescia parte all'inizio della fase e non riparte con le azioni.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const root = new URL("../", import.meta.url);
const code = ["src/agreement.js", "src/game.js", "tools/room.js"]
  .map((f) => readFileSync(new URL(f, root), "utf8").replace(/^export /gm, "").replace(/^import .*$/gm, ""))
  .join("\n");
const cards = JSON.parse(readFileSync(new URL("data/cards.json", root), "utf8"));
vm.runInThisContext(code + "\nglobalThis.__createRoomHost = createRoomHost;");

function phone(host, name) {
  const inbox = [];
  const conn = host.connection(name, (raw) => inbox.push(JSON.parse(raw)));
  return { conn, inbox, last: (type) => [...inbox].reverse().find((m) => !type || m.type === type) };
}

// Stanza con tre telefoni, partita avviata con turno da 60 secondi.
function startRoom() {
  const host = __createRoomHost({ cards, turnSeconds: 60 });
  const a = phone(host, "a"), b = phone(host, "b"), c = phone(host, "c");
  host.handle(a.conn, { type: "create", name: "Alice", code: "TIME" });
  host.handle(b.conn, { type: "join", code: "TIME", name: "Bruno" });
  host.handle(c.conn, { type: "join", code: "TIME", name: "Carla" });
  host.handle(a.conn, { type: "start", winScore: 5 });
  const room = host.rooms.get("TIME");
  const seats = [a, b, c].map((ph) => ({ ph, id: ph.last("joined").playerId, token: ph.last("joined").token }));
  const judgeId = room.game.judge.id;
  const players = seats.filter((s) => s.id !== judgeId);
  return { host, room, seats, players };
}

function playOne(host, room, seat) {
  const p = room.game.players.find((x) => x.id === seat.id);
  host.handle(seat.ph.conn, { type: "play", cards: p.hand.slice(0, room.game.currentBlack.blanks) });
  assert.equal(seat.ph.last("error"), undefined, "la giocata deve riuscire");
}

test("il turno scade dopo il tempo previsto, anche se qualcuno ha già giocato", (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const { host, room, players } = startRoom();
  mock.timers.tick(30_000);
  playOne(host, room, players[0]);                  // il primo risponde a metà turno
  mock.timers.tick(29_000);                         // t = 59 s: il secondo non ha ancora risposto
  assert.equal(room.game.phase, "playing", "prima dei 60 secondi il turno non scade");
  mock.timers.tick(2_000);                          // t = 61 s: scade, la risposta mancante è automatica
  assert.equal(room.game.phase, "judging", "allo scadere il turno passa al Re");
});

test("riconnettersi non fa ripartire il conto alla rovescia", (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const { host, room, players } = startRoom();
  mock.timers.tick(40_000);
  host.leave(players[0].ph.conn);
  const again = players[0].ph.conn;
  host.handle(again, { type: "resume", code: "TIME", token: players[0].token });
  mock.timers.tick(21_000);                         // t = 61 s dall'inizio del turno
  assert.equal(room.game.phase, "judging", "il riaggancio non allunga il turno");
});
