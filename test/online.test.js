import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../server/index.js";

const cards = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));

let app;
let url;

before(async () => {
  app = createApp({ cards, pageHtml: "<!doctype html><title>t</title>", turnSeconds: 0 });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  url = `ws://127.0.0.1:${app.server.address().port}/ws`;
});

after(() => app.close());

/** Client minimale: accumula i messaggi e permette di attendere uno stato. */
class Client {
  constructor() {
    this.ws = new WebSocket(url);
    this.state = null;
    this.errors = [];
    this.joined = null;
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "state") this.state = m;
      else if (m.type === "error") this.errors.push(m.message);
      else if (m.type === "joined") this.joined = m;
    };
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  async until(fn, label = "condizione", ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (this.state && fn(this.state)) return this.state;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`Timeout: ${label}`);
  }
  async error(ms = 2000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (this.errors.length) return this.errors.shift();
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("Nessun errore ricevuto");
  }
  close() {
    this.ws.close();
  }
}

async function connect() {
  const c = new Client();
  await c.ready;
  return c;
}

test("creazione stanza e codice a 4 caratteri", async () => {
  const host = await connect();
  host.send({ type: "create", name: "Ada" });
  await host.until((s) => s.code && s.players.length === 1, "stanza creata");
  assert.match(host.state.code, /^[A-Z2-9]{4}$/);
  assert.equal(host.state.hostId, host.state.you);
  assert.ok(host.joined.token.length >= 16);
  host.close();
});

test("start rifiutato con meno di 3 giocatori e solo dall'host", async () => {
  const host = await connect();
  host.send({ type: "create", name: "Ada" });
  const s = await host.until((st) => st.code, "creata");
  const guest = await connect();
  guest.send({ type: "join", code: s.code, name: "Bruno" });
  await guest.until((st) => st.players.length === 2, "bruno entra");

  host.send({ type: "start", winScore: 3 });
  assert.match(await host.error(), /almeno 3/);

  guest.send({ type: "start", winScore: 3 });
  assert.match(await guest.error(), /Solo chi ha creato/);
  host.close();
  guest.close();
});

test("partita: mani private, risposte anonime, nuovo round con 10 carte", async () => {
  const host = await connect();
  host.send({ type: "create", name: "Ada" });
  const { code } = await host.until((st) => st.code, "creata");
  const guests = [await connect(), await connect()];
  for (const [i, g] of guests.entries()) {
    g.send({ type: "join", code, name: `P${i}` });
    await g.until((st) => st.players.length === i + 2, "entra");
  }
  const all = [host, ...guests];

  host.send({ type: "start", winScore: 3 });
  await host.until((st) => st.game?.phase === "playing", "partita avviata");

  // Ogni giocatore vede solo la propria mano.
  for (const c of all) {
    const st = c.state;
    const mine = st.game.players.find((p) => p.id === st.you);
    assert.equal(mine.hand.length, 10, "mano di 10 carte");
    for (const p of st.game.players) {
      if (p.id !== st.you) assert.equal("hand" in p, false, "mani altrui nascoste");
    }
  }

  const judgeId = host.state.game.judgeId;
  const judge = all.find((c) => c.state.you === judgeId);
  const players = all.filter((c) => c !== judge);
  const blanks = host.state.game.black.blanks;

  for (const p of players) {
    const st = p.state;
    const me = st.game.players.find((x) => x.id === st.you);
    p.send({ type: "play", cards: me.hand.slice(0, blanks).map((c) => c.id) });
  }

  const judging = await judge.until((st) => st.game.phase === "judging", "giudizio");
  assert.equal(judging.game.reveal.length, players.length);
  for (const r of judging.game.reveal) {
    assert.equal("playerId" in r, false, "risposte anonime");
  }

  // Solo il Re può scegliere.
  const notJudge = players[0];
  notJudge.send({ type: "pick", index: 0 });
  assert.match(await notJudge.error(), /Solo il Re/);

  judge.send({ type: "pick", index: 0 });
  const ended = await judge.until((st) => st.game.phase === "roundEnd", "fine round");
  assert.equal(ended.game.players.filter((p) => p.score === 1).length, 1);

  judge.send({ type: "next" });
  const next = await judge.until((st) => st.game.round === 2 && st.game.phase === "playing", "round 2");
  const me = next.game.players.find((p) => p.id === next.you);
  assert.equal(me.hand.length, 10, "mano rifornita a 10");

  all.forEach((c) => c.close());
});

test("stanza piena a 10 giocatori", async () => {
  const host = await connect();
  host.send({ type: "create", name: "Host" });
  const { code } = await host.until((st) => st.code, "creata");
  const clients = [host];
  for (let i = 1; i < 10; i++) {
    const c = await connect();
    c.send({ type: "join", code, name: `G${i}` });
    await c.until((st) => st.players.length === i + 1, `G${i}`);
    clients.push(c);
  }
  const extra = await connect();
  extra.send({ type: "join", code, name: "Undicesimo" });
  assert.match(await extra.error(), /piena/);
  clients.forEach((c) => c.close());
  extra.close();
});

test("riconnessione con il token nella stessa partita", async () => {
  const host = await connect();
  host.send({ type: "create", name: "Ada" });
  const { code } = await host.until((st) => st.code, "creata");
  const b = await connect();
  b.send({ type: "join", code, name: "Bruno" });
  await b.until((st) => st.players.length === 2, "bruno");
  const c = await connect();
  c.send({ type: "join", code, name: "Chiara" });
  await c.until((st) => st.players.length === 3, "chiara");

  host.send({ type: "start", winScore: 3 });
  await b.until((st) => st.game?.phase === "playing", "avviata");
  const { playerId, token } = b.joined;
  b.close();
  await new Promise((r) => setTimeout(r, 30));

  const b2 = await connect();
  b2.send({ type: "resume", code, token });
  const st = await b2.until((s) => s.game && s.you === playerId, "riconnesso");
  assert.equal(st.you, playerId);
  assert.equal(st.game.players.find((p) => p.id === playerId).hand.length, 10);
  [host, c, b2].forEach((x) => x.close());
});
