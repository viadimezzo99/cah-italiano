// Server online: stanze con codice (max 10 giocatori), stato privato per giocatore.
// Avvio: node server/index.js   (poi apri http://localhost:8080)
import { randomBytes, randomInt } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Game } from "../src/game.js";
import { handshake } from "./ws.js";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
const WIN_SCORES = [3, 5, 8];
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // niente I, L, O, 0, 1
const ROUND_PAUSE_MS = 12000;

export function createApp({ cards, pageHtml, turnSeconds = 60, reconnectMs = 10 * 60 * 1000 }) {
  const rooms = new Map();

  function newCode() {
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function cleanName(name) {
    const n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
    if (!n) throw new Error("Inserisci un nome");
    return n;
  }

  function send(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* connessione chiusa */
    }
  }

  function stateFor(room, player) {
    const g = room.game;
    return {
      type: "state",
      code: room.code,
      you: player.id,
      hostId: room.hostId,
      turnSeconds,
      players: room.players.map((p) => ({ id: p.id, name: p.name, connected: !!p.ws })),
      game: g
        ? { ...g.publicState(player.id), winScore: g.opts.winScore, lastWinner: g.lastWinner }
        : null,
    };
  }

  function broadcast(room) {
    for (const p of room.players) if (p.ws) send(p.ws, stateFor(room, p));
  }

  function scheduleTurn(room) {
    clearTimeout(room.timer);
    room.timer = null;
    const g = room.game;
    if (!g || !turnSeconds) return;
    const ms = { playing: turnSeconds * 1000, judging: turnSeconds * 1000, roundEnd: ROUND_PAUSE_MS }[g.phase];
    if (!ms) return;
    const { phase, round } = g;
    room.timer = setTimeout(() => {
      room.timer = null;
      if (g.phase !== phase || g.round !== round) return;
      try {
        // Tempo scaduto: il server gioca per chi non ha risposto, o sceglie per il Re.
        if (phase === "playing") {
          for (const p of g.players) {
            if (p.id !== g.judge.id && !g.submissions.has(p.id)) g.autoPlay(p.id);
          }
        } else if (phase === "judging") {
          g.autoPick();
        } else if (phase === "roundEnd") {
          g.nextRound();
        }
      } catch {
        /* stato già cambiato */
      }
      scheduleTurn(room);
      broadcast(room);
    }, ms);
    room.timer.unref?.();
  }

  function afterChange(room) {
    scheduleTurn(room);
    broadcast(room);
  }

  function addPlayer(room, ws, name) {
    const player = {
      id: randomBytes(8).toString("hex"),
      name,
      token: randomBytes(16).toString("hex"),
      ws: null,
    };
    room.players.push(player);
    if (!room.hostId) room.hostId = player.id;
    attachPlayer(room, player, ws);
    send(ws, { type: "joined", code: room.code, playerId: player.id, token: player.token });
    return player;
  }

  function attachPlayer(room, player, ws) {
    player.ws = ws;
    ws.room = room;
    ws.playerId = player.id;
    clearTimeout(room.cleanup);
    room.cleanup = null;
  }

  function removeFromRoom(room, player) {
    room.players = room.players.filter((p) => p !== player);
    if (room.hostId === player.id) room.hostId = room.players[0]?.id ?? null;
    if (!room.players.length) {
      clearTimeout(room.timer);
      clearTimeout(room.cleanup);
      rooms.delete(room.code);
      return;
    }
    broadcast(room);
  }

  function leave(ws) {
    const room = ws.room;
    if (!room) return;
    const player = room.players.find((p) => p.id === ws.playerId);
    ws.room = null;
    if (!player || player.ws !== ws) return;
    player.ws = null;
    if (!room.game) {
      // In lobby chi esce lascia il posto; in partita resta, può riprendere col token.
      removeFromRoom(room, player);
      return;
    }
    if (room.players.every((p) => !p.ws)) {
      room.cleanup = setTimeout(() => {
        clearTimeout(room.timer);
        rooms.delete(room.code);
      }, reconnectMs);
      room.cleanup.unref?.();
    }
    broadcast(room);
  }

  function requireRoom(ws) {
    if (!ws.room) throw new Error("Non sei in nessuna stanza");
    const player = ws.room.players.find((p) => p.id === ws.playerId);
    if (!player) throw new Error("Giocatore non trovato");
    return { room: ws.room, player };
  }

  function handle(ws, msg) {
    switch (msg.type) {
      case "create": {
        if (ws.room) throw new Error("Sei già in una stanza");
        const name = cleanName(msg.name);
        const code = newCode();
        const room = { code, hostId: null, players: [], game: null, timer: null, cleanup: null };
        rooms.set(code, room);
        addPlayer(room, ws, name);
        broadcast(room);
        return;
      }
      case "join": {
        if (ws.room) throw new Error("Sei già in una stanza");
        const code = String(msg.code ?? "").toUpperCase().replace(/\s+/g, "");
        const room = rooms.get(code);
        if (!room) throw new Error("Stanza non trovata");
        if (room.game) throw new Error("La partita è già iniziata");
        if (room.players.length >= MAX_PLAYERS) throw new Error("Stanza piena (massimo 10 giocatori)");
        addPlayer(room, ws, cleanName(msg.name));
        broadcast(room);
        return;
      }
      case "resume": {
        if (ws.room) throw new Error("Sei già in una stanza");
        const room = rooms.get(String(msg.code ?? "").toUpperCase());
        const player = room?.players.find((p) => p.token === msg.token);
        if (!room || !player) throw new Error("Sessione non valida");
        if (player.ws && player.ws !== ws) player.ws.close();
        attachPlayer(room, player, ws);
        send(ws, { type: "joined", code: room.code, playerId: player.id, token: player.token });
        afterChange(room);
        return;
      }
      case "start": {
        const { room, player } = requireRoom(ws);
        if (room.hostId !== player.id) throw new Error("Solo chi ha creato la stanza può avviare");
        if (room.game) throw new Error("La partita è già iniziata");
        if (room.players.length < MIN_PLAYERS) throw new Error(`Servono almeno ${MIN_PLAYERS} giocatori`);
        const winScore = WIN_SCORES.includes(msg.winScore) ? msg.winScore : 5;
        room.game = new Game(
          room.players.map((p) => ({ id: p.id, name: p.name, isBot: false })),
          cards,
          { winScore },
        );
        room.game.start();
        afterChange(room);
        return;
      }
      case "play": {
        const { room, player } = requireRoom(ws);
        if (!room.game) throw new Error("La partita non è iniziata");
        if (!Array.isArray(msg.cards)) throw new Error("Carte non valide");
        room.game.play(player.id, msg.cards.map(String));
        afterChange(room);
        return;
      }
      case "pick": {
        const { room, player } = requireRoom(ws);
        if (!room.game) throw new Error("La partita non è iniziata");
        room.game.pick(player.id, msg.index);
        afterChange(room);
        return;
      }
      case "next": {
        const { room } = requireRoom(ws);
        if (!room.game) throw new Error("La partita non è iniziata");
        room.game.nextRound();
        afterChange(room);
        return;
      }
      case "leave": {
        leave(ws);
        return;
      }
      default:
        throw new Error("Messaggio sconosciuto");
    }
  }

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(pageHtml);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Non trovato");
  });

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://localhost").pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const ws = handshake(req, socket, head);
    if (!ws) return;
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        send(ws, { type: "error", message: "Messaggio non valido" });
        return;
      }
      try {
        handle(ws, msg && typeof msg === "object" ? msg : {});
      } catch (err) {
        send(ws, { type: "error", message: err.message });
      }
    });
    ws.on("close", () => leave(ws));
  });

  return {
    server,
    rooms,
    close() {
      for (const r of rooms.values()) {
        clearTimeout(r.timer);
        clearTimeout(r.cleanup);
      }
      server.close();
    },
  };
}

// Avvio diretto: legge carte e pagina e ascolta sulla porta indicata.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL("../", import.meta.url);
  const cards = JSON.parse(readFileSync(new URL("data/cards.json", root), "utf8"));
  const pageHtml = readFileSync(new URL("web/index.html", root), "utf8");
  const port = Number(process.env.PORT || 8080);
  const app = createApp({ cards, pageHtml });
  app.server.listen(port, () => console.log(`Cards Against Umanità online su http://localhost:${port}`));
}
