// Riconnessione in partita: se la rete cade, il telefono del giocatore viene "lasciato"
// dall'ospite; quando torna, deve potersi riagganciare con il suo token e giocare di nuovo.
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

test("in partita: dopo un'uscita di rete il giocatore può riagganciarsi e giocare", () => {
  const host = __createRoomHost({ cards, turnSeconds: 0 });
  const a = phone(host, "a"), b = phone(host, "b"), c = phone(host, "c");
  host.handle(a.conn, { type: "create", name: "Alice", code: "QWER" });
  const { code: roomCode } = a.last("joined");
  host.handle(b.conn, { type: "join", code: roomCode, name: "Bruno" });
  host.handle(c.conn, { type: "join", code: roomCode, name: "Carla" });
  host.handle(a.conn, { type: "start", winScore: 5 });

  // Il giocatore non Re prova a giocare, poi perde la rete (l'ospite lo lascia).
  const st0 = b.last("state");
  const who = st0.game.judgeId === b.last("joined").playerId ? c : b;
  const token = who.last("joined").token;
  const playerId = who.last("joined").playerId;
  host.leave(who.conn);

  // Torna la rete: lo stesso canale riprende con il token (come fa l'app al ritorno della connessione).
  host.handle(who.conn, { type: "resume", code: roomCode, token });
  assert.equal(who.last("error"), undefined, "il riaggancio non deve dare errori");

  const st = who.last("state");
  const me = st.game.players.find((p) => p.id === playerId);
  assert.ok(me && me.hand.length > 0, "la mano è di nuovo visibile");
  host.handle(who.conn, { type: "play", cards: me.hand.slice(0, st.game.black.blanks ?? 1).map((c) => c.id) });
  assert.equal(who.last("error"), undefined, "giocare dopo il riaggancio deve funzionare");
});
