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

// Il Re bot guarda ogni carta almeno 3 secondi: un solo passo (sfogliare, confrontare, scegliere) ogni 3000 ms.
test("il Re bot online aspetta almeno 3 secondi a ogni passo", (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let found = null;
  for (let i = 0; i < 40 && !found; i++) {
    const host = __createRoomHost({ cards, turnSeconds: 0 });
    const a = phone(host, "a");
    const letters = "ABCDEFGHJKMNPQRSTUVWXYZ";
    const code = `BJ${letters[i % letters.length]}${letters[Math.floor(i / letters.length)]}`;   // solo caratteri validi per un codice stanza
    host.handle(a.conn, { type: "create", name: "Alice", code });
    host.handle(a.conn, { type: "addBot", name: "Tana" });
    host.handle(a.conn, { type: "addBot", name: "Tega" });
    host.handle(a.conn, { type: "start", winScore: 5 });
    const room = host.rooms.get(code);
    if (room.game.judge.isBot) found = { host, room, a };
  }
  assert.ok(found, "prima o poi il Re è un bot");
  const { host, room, a } = found;
  const aId = a.last("joined").playerId;
  mock.timers.tick(2000);                           // i bot rispondono
  const me = room.game.players.find((p) => p.id === aId);
  host.handle(a.conn, { type: "play", cards: me.hand.slice(0, room.game.currentBlack.blanks) });
  const g = room.game;
  assert.equal(g.phase, "judging", "risposte di tutti: tocca al Re bot");
  const n = g.revealOrder.length;
  assert.equal(g.peek, 0);
  // Ogni passo avviene solo dopo 3 secondi pieni.
  for (let step = 1; step < n; step++) {
    mock.timers.tick(2999);
    assert.equal(g.peek, step - 1, "prima dei 3 secondi la carta resta quella");
    mock.timers.tick(1);
    assert.equal(g.peek, step, "dopo 3 secondi passa alla successiva");
  }
  mock.timers.tick(2999);
  assert.equal(g.compare, false, "dopo l'ultima carta aspetta ancora 3 secondi");
  mock.timers.tick(1);
  assert.equal(g.compare, true);
  mock.timers.tick(2999);
  assert.equal(g.selected, null, "anche prima di scegliere");
  mock.timers.tick(1);
  assert.notEqual(g.selected, null);
  mock.timers.tick(2999);
  assert.equal(g.phase, "judging", "e prima di assegnare il punto");
  mock.timers.tick(1);
  assert.equal(g.phase, "roundEnd");
});

test("BOT_JUDGE_VIEW_MS è almeno 3 secondi e lo usano locale e online", () => {
  const src = (f) => readFileSync(new URL(f, root), "utf8");
  assert.ok(globalThis.BOT_JUDGE_VIEW_MS >= 3000 || /BOT_JUDGE_VIEW_MS = (\d+)/.exec(src("src/game.js"))[1] >= 3000);
  assert.match(src("tools/app.js"), /BOT_JUDGE_VIEW_MS\);/, "il Re bot locale usa la costante");
  assert.match(src("tools/room.js"), /BOT_JUDGE_VIEW_MS : 2000/, "il Re bot online usa la costante");
});
