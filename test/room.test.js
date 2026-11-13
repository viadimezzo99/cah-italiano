// Stanza online sul telefono dell'ospite: crea, entra, avvia, gioca.
import { test } from "node:test";
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

test("dopo la vittoria: torna alla stanza, tutti pronti, nuova partita con lo stesso punteggio", () => {
  const host = __createRoomHost({ cards, turnSeconds: 0 });
  const a = phone(host, "a"), b = phone(host, "b"), c = phone(host, "c");
  host.handle(a.conn, { type: "create", name: "Alice" });
  const { code } = a.last("joined");
  host.handle(b.conn, { type: "join", code, name: "Bruno" });
  host.handle(c.conn, { type: "join", code, name: "Carla" });
  host.handle(a.conn, { type: "start", winScore: 3 });
  const room = host.rooms.get(code);
  room.game.phase = "over";
  host.handle(b.conn, { type: "back" });
  assert.equal(room.game, null, "la partita finita torna in stanza");
  host.handle(a.conn, { type: "ready" });
  host.handle(b.conn, { type: "ready" });
  assert.equal(room.game, null, "manca ancora Carla");
  host.handle(c.conn, { type: "ready" });
  assert.equal(room.game.phase, "playing", "tutti pronti: si ricomincia");
  assert.equal(room.game.opts.winScore, 3, "stesso punteggio");
});

test("bot online: l'ospite aggiunge un bot e la partita va avanti senza di loro", async () => {
  const host = __createRoomHost({ cards, turnSeconds: 0 });
  const a = phone(host, "a"), b = phone(host, "b");
  host.handle(a.conn, { type: "create", name: "Alice" });
  const { code } = a.last("joined");
  host.handle(b.conn, { type: "join", code, name: "Bruno" });
  host.handle(a.conn, { type: "addBot", name: "Gianni" });
  host.handle(b.conn, { type: "addBot" });
  assert.equal(b.last("error")?.message, "Solo chi ha creato la stanza può aggiungere bot");
  assert.equal(host.rooms.get(code).players.length, 3, "due umani e un bot");
  assert.equal(host.rooms.get(code).players.find((p) => p.isBot).name, "Gianni", "il nome lo sceglie l'ospite");
  host.handle(a.conn, { type: "start", winScore: 3 });
  const room = host.rooms.get(code);
  assert.equal(room.game.phase, "playing");
  await new Promise((r) => setTimeout(r, 900));   // il bot gioca da solo
  const g = room.game;
  for (const human of ["a", "b"]) {
    const id = a.last("joined").playerId;
    const pid = human === "a" ? id : b.last("joined").playerId;
    if (pid === g.judge.id || g.submissions.has(pid)) continue;
    const p = g.players.find((x) => x.id === pid);
    host.handle(human === "a" ? a.conn : b.conn, { type: "play", cards: p.hand.slice(0, g.currentBlack.blanks) });
  }
  await new Promise((r) => setTimeout(r, 2600));  // il Re bot sceglie da solo
  assert.notEqual(g.phase, "playing", "la partita va avanti anche con il bot");
  host.handle(a.conn, { type: "removeBot" });
  assert.equal(a.last("error")?.message, "La partita è già in corso", "con la partita in corso i bot restano");
});
