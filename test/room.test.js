// Stanza online sul telefono dell'ospite: crea, entra, avvia, gioca.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const root = new URL("../", import.meta.url);
const code = ["src/agreement.js", "src/game.js", "tools/room.js"]
  .map((f) => readFileSync(new URL(f, root), "utf8").replace(/^export /gm, ""))
  .join("\n");
const cards = JSON.parse(readFileSync(new URL("data/cards.json", root), "utf8"));
vm.runInThisContext(code + "\nglobalThis.__createRoomHost = createRoomHost;");

function phone(host, name) {
  const inbox = [];
  const conn = host.connection(name, (raw) => inbox.push(JSON.parse(raw)));
  return { conn, inbox, last: (type) => [...inbox].reverse().find((m) => !type || m.type === type) };
}

test("stanza: creazione, ingresso, avvio e prima risposta", () => {
  const host = __createRoomHost({ cards, turnSeconds: 0 });
  const a = phone(host, "a"), b = phone(host, "b"), c = phone(host, "c");
  host.handle(a.conn, { type: "create", name: "Alice", code: "KDRT" });
  const joined = a.last("joined");
  assert.equal(joined.code, "KDRT");
  host.handle(b.conn, { type: "join", code: joined.code, name: "Bruno" });
  host.handle(c.conn, { type: "join", code: joined.code, name: "Carla" });
  assert.equal(host.rooms.get(joined.code).players.length, 3);
  host.handle(a.conn, { type: "start", winScore: 5 });
  const st = a.last("state");
  assert.equal(st.game.phase, "playing");
  // Ogni giocatore vede la propria mano, ma non quella degli altri.
  assert.ok(st.game.players.find((p) => p.id === st.you).hand.length > 0);
  assert.equal(b.last("state").game.players.find((p) => p.id === a.last("joined").playerId).hand, undefined);
});

test("errori: codice sbagliato e avvio con pochi giocatori", () => {
  const host = __createRoomHost({ cards, turnSeconds: 0 });
  const a = phone(host, "a"), x = phone(host, "x");
  host.handle(x.conn, { type: "join", code: "ZZZZ", name: "X" });
  assert.equal(x.last("error").message, "Stanza non trovata");
  host.handle(a.conn, { type: "create", name: "Alice" });
  host.handle(a.conn, { type: "start" });
  assert.match(a.last("error").message, /almeno 3/);
});

test("riconnessione con il token e uscita dalla lobby", () => {
  const host = __createRoomHost({ cards, turnSeconds: 0 });
  const a = phone(host, "a"), b = phone(host, "b");
  host.handle(a.conn, { type: "create", name: "Alice" });
  const { code } = a.last("joined");
  host.handle(b.conn, { type: "join", code, name: "Bruno" });
  const token = b.last("joined").token;
  host.leave(b.conn);
  assert.equal(host.rooms.get(code).players.length, 1, "in lobby chi esce lascia il posto");
  const b2 = phone(host, "b2");
  host.handle(b2.conn, { type: "resume", code, token });
  assert.equal(b2.last("error")?.message, "Sessione non valida");
});
