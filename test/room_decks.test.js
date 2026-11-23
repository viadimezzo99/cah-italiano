// Mazzi online: l'ospite può spegnere il mazzo base e giocare solo con le carte personali.
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
vm.runInThisContext(code + "\nglobalThis.__createRoomHostDecks = createRoomHost;");

function phone(host, name) {
  const inbox = [];
  const conn = host.connection(name, (raw) => inbox.push(JSON.parse(raw)));
  return { conn, inbox, last: (type) => [...inbox].reverse().find((m) => !type || m.type === type) };
}
function lobby(code) {
  const host = __createRoomHostDecks({ cards, turnSeconds: 0 });
  const a = phone(host, "a"), b = phone(host, "b"), c = phone(host, "c");
  host.handle(a.conn, { type: "create", name: "A", code });
  host.handle(b.conn, { type: "join", code, name: "B" });
  host.handle(c.conn, { type: "join", code, name: "C" });
  return { host, a, room: host.rooms.get(code) };
}
const custom = {
  white: Array.from({ length: 40 }, (_, i) => ({ text: `Risposta mmia ${i}`, cat: "Soggetti" })),
  black: Array.from({ length: 6 }, (_, i) => ({ text: `Domanda mia ${i} ____`, cat: "1 risposta" })),
};

test("senza il mazzo base la partita usa solo le carte personali", () => {
  const { host, a, room } = lobby("DKAA");
  host.handle(a.conn, { type: "start", winScore: 3, custom, base: false });
  assert.equal(a.last("error"), undefined);
  assert.equal(room.base, false);
  const ids = [...room.game.players.flatMap((p) => p.hand)];
  assert.ok(ids.length > 0);
  assert.ok(ids.every((id) => String(id).startsWith("u")), "tutte le bianche in mano sono personali");
  assert.match(room.game.currentBlack.text, /^Domanda mia/);
});

test("con il mazzo base acceso (o senza indicazione) entrano le carte ufficiali", () => {
  const { host, a, room } = lobby("DKBB");
  host.handle(a.conn, { type: "start", winScore: 3, custom });
  assert.equal(room.base, true);
  const ids = room.game.players.flatMap((p) => p.hand);
  assert.ok(ids.some((id) => !String(id).startsWith("u")), "ci sono anche carte ufficiali");
});

test("senza base e senza carte personali la partita non parte", () => {
  const { host, a, room } = lobby("DKCC");
  host.handle(a.conn, { type: "start", winScore: 3, custom: { white: [], black: [] }, base: false });
  assert.match(a.last("error")?.message ?? "", /carte nere e bianche/);
  assert.equal(room.game, null, "nessuna partita avviata");
  host.handle(a.conn, { type: "start", winScore: 3, custom: { white: custom.white, black: [] }, base: false });
  assert.match(a.last("error")?.message ?? "", /carte nere e bianche/, "servono anche le nere");
  host.handle(a.conn, { type: "start", winScore: 3, custom, base: false });
  assert.ok(room.game, "con le carte giuste parte");
});
