// Stanza online gestita dal telefono di chi l'ha creata (l'ospite).
// Stessa logica del vecchio server: codici, giocatori, token di riconnessione, turni a tempo.
// I messaggi arrivano da "connessioni" (un telefono = una connessione) e le risposte tornano con conn.send.
// Usa Game e mergeCustom del motore già presente nella pagina.

const ROOM_MIN_PLAYERS = 3;
const ROOM_MAX_PLAYERS = 10;
const ROOM_WIN_SCORES = [3, 5, 8];
const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // niente I, L, O, 0, 1
const ROOM_PAUSE_MS = 12000;

function randomHex(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function randomCode() {
  let code = "";
  const b = new Uint32Array(4);
  crypto.getRandomValues(b);
  for (let i = 0; i < 4; i++) code += ROOM_CODE_CHARS[b[i] % ROOM_CODE_CHARS.length];
  return code;
}

// cards: il mazzo ufficiale. turnSeconds: 0 = nessun tempo. reconnectMs: quanto resta la stanza senza nessuno.
function createRoomHost({ cards, turnSeconds = 60, reconnectMs = 10 * 60 * 1000, onRoomGone }) {
  const rooms = new Map();

  function cleanName(name) {
    const n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
    if (!n) throw new Error("Inserisci un nome");
    return n;
  }

  function send(conn, obj) {
    try { conn.send(JSON.stringify(obj)); } catch { /* connessione chiusa */ }
  }

  function stateFor(room, player) {
    const g = room.game;
    return {
      type: "state",
      code: room.code,
      you: player.id,
      hostId: room.hostId,
      turnSeconds,
      players: room.players.map((p) => ({ id: p.id, name: p.name, connected: !!p.conn, ready: !!p.ready })),
      game: g ? { ...g.publicState(player.id), winScore: g.opts.winScore, lastWinner: g.lastWinner } : null,
    };
  }

  function broadcast(room) {
    for (const p of room.players) if (p.conn) send(p.conn, stateFor(room, p));
  }

  function scheduleTurn(room) {
    clearTimeout(room.timer);
    room.timer = null;
    const g = room.game;
    if (!g || !turnSeconds) return;
    const ms = { playing: turnSeconds * 1000, judging: turnSeconds * 1000, roundEnd: ROOM_PAUSE_MS }[g.phase];
    if (!ms) return;
    const { phase, round } = g;
    room.timer = setTimeout(() => {
      room.timer = null;
      if (g.phase !== phase || g.round !== round) return;
      try {
        // Tempo scaduto: l'ospite gioca per chi non ha risposto, o sceglie per il Re.
        if (phase === "playing") {
          for (const p of g.players) {
            if (p.id !== g.judge.id && !g.submissions.has(p.id)) g.autoPlay(p.id);
          }
        } else if (phase === "judging") {
          g.autoPick();
        } else if (phase === "roundEnd") {
          g.nextRound();
        }
      } catch { /* stato già cambiato */ }
      scheduleTurn(room);
      broadcast(room);
    }, ms);
  }

  function afterChange(room) {
    scheduleTurn(room);
    broadcast(room);
  }

  function attachPlayer(room, player, conn) {
    player.conn = conn;
    conn.room = room;
    conn.playerId = player.id;
    clearTimeout(room.cleanup);
    room.cleanup = null;
  }

  // Avvia una partita: la stessa per il primo giro (host) e per i giri successivi (tutti pronti).
  function startGame(room, winScore, custom) {
    room.winScore = winScore;
    room.custom = custom;
    for (const p of room.players) p.ready = false;
    room.game = new Game(
      room.players.map((p) => ({ id: p.id, name: p.name, isBot: false })),
      mergeCustom(cards, custom),
      { winScore },
    );
    room.game.start();
    afterChange(room);
  }

  // Dopo la vittoria la stanza resta aperta: quando tutti i telefoni connessi sono pronti, si ricomincia.
  function maybeAutoStart(room) {
    if (room.game || !room.winScore) return;
    const connected = room.players.filter((p) => p.conn);
    if (connected.length >= ROOM_MIN_PLAYERS && connected.every((p) => p.ready)) startGame(room, room.winScore, room.custom);
  }

  function addPlayer(room, conn, name) {
    const player = { id: randomHex(8), name, token: randomHex(16), conn: null, ready: false };
    room.players.push(player);
    if (!room.hostId) room.hostId = player.id;
    attachPlayer(room, player, conn);
    send(conn, { type: "joined", code: room.code, playerId: player.id, token: player.token });
    return player;
  }

  function removeFromRoom(room, player) {
    room.players = room.players.filter((p) => p !== player);
    if (room.hostId === player.id) room.hostId = room.players[0]?.id ?? null;
    if (!room.players.length) {
      clearTimeout(room.timer);
      clearTimeout(room.cleanup);
      rooms.delete(room.code);
      onRoomGone?.(room.code);
      return;
    }
    broadcast(room);
  }

  function leave(conn) {
    const room = conn.room;
    if (!room) return;
    const player = room.players.find((p) => p.id === conn.playerId);
    conn.room = null;
    if (!player || player.conn !== conn) return;
    player.conn = null;
    if (!room.game) {
      removeFromRoom(room, player);
      return;
    }
    if (room.players.every((p) => !p.conn)) {
      room.cleanup = setTimeout(() => {
        clearTimeout(room.timer);
        rooms.delete(room.code);
        onRoomGone?.(room.code);
      }, reconnectMs);
    }
    broadcast(room);
  }

  function requireRoom(conn) {
    if (!conn.room) throw new Error("Non sei in nessuna stanza");
    const player = conn.room.players.find((p) => p.id === conn.playerId);
    if (!player) throw new Error("Giocatore non trovato");
    return { room: conn.room, player };
  }

  // Gestisce un messaggio di una connessione. Gli errori tornano al mittente.
  function handle(conn, msg) {
    try {
      dispatch(conn, msg && typeof msg === "object" ? msg : {});
    } catch (err) {
      send(conn, { type: "error", message: err.message });
    }
  }

  function dispatch(conn, msg) {
    switch (msg.type) {
      case "create": {
        if (conn.room) throw new Error("Sei già in una stanza");
        const name = cleanName(msg.name);
        // Il codice lo sceglie il telefono che crea la stanza (serve anche nel database).
        const proposed = String(msg.code ?? "").toUpperCase();
        let code = /^[A-Z2-9]{4}$/.test(proposed) ? proposed : randomCode();
        if (rooms.has(code)) throw new Error("Codice già usato, riprova");
        const room = { code, hostId: null, players: [], game: null, timer: null, cleanup: null };
        rooms.set(code, room);
        addPlayer(room, conn, name);
        broadcast(room);
        return;
      }
      case "join": {
        if (conn.room) throw new Error("Sei già in una stanza");
        const code = String(msg.code ?? "").toUpperCase().replace(/\s+/g, "");
        const room = rooms.get(code);
        if (!room) throw new Error("Stanza non trovata");
        if (room.game) throw new Error("La partita è già iniziata");
        if (room.players.length >= ROOM_MAX_PLAYERS) throw new Error("Stanza piena (massimo 10 giocatori)");
        addPlayer(room, conn, cleanName(msg.name));
        broadcast(room);
        return;
      }
      case "resume": {
        if (conn.room) throw new Error("Sei già in una stanza");
        const room = rooms.get(String(msg.code ?? "").toUpperCase());
        const player = room?.players.find((p) => p.token === msg.token);
        if (!room || !player) throw new Error("Sessione non valida");
        if (player.conn && player.conn !== conn) player.conn.onClose?.();
        attachPlayer(room, player, conn);
        send(conn, { type: "joined", code: room.code, playerId: player.id, token: player.token });
        afterChange(room);
        return;
      }
      case "start": {
        const { room, player } = requireRoom(conn);
        if (room.hostId !== player.id) throw new Error("Solo chi ha creato la stanza può avviare");
        if (room.game) throw new Error("La partita è già iniziata");
        if (room.players.length < ROOM_MIN_PLAYERS) throw new Error(`Servono almeno ${ROOM_MIN_PLAYERS} giocatori`);
        const winScore = ROOM_WIN_SCORES.includes(msg.winScore) ? msg.winScore : 5;
        startGame(room, winScore, msg.custom);
        return;
      }
      case "play": {
        const { room, player } = requireRoom(conn);
        if (!room.game) throw new Error("La partita non è iniziata");
        if (!Array.isArray(msg.cards)) throw new Error("Carte non valide");
        room.game.play(player.id, msg.cards.map(String));
        afterChange(room);
        return;
      }
      case "pick": {
        const { room, player } = requireRoom(conn);
        if (!room.game) throw new Error("La partita non è iniziata");
        room.game.pick(player.id, msg.index);
        afterChange(room);
        return;
      }
      case "next": {
        const { room } = requireRoom(conn);
        if (!room.game) throw new Error("La partita non è iniziata");
        room.game.nextRound();
        afterChange(room);
        return;
      }
      case "ready": {
        const { room, player } = requireRoom(conn);
        if (room.game) throw new Error("La partita è già in corso");
        player.ready = !player.ready;
        maybeAutoStart(room);
        if (!room.game) broadcast(room);
        return;
      }
      case "back": {
        // Dalla schermata di vittoria si torna alla stanza: la partita finisce, tutti devono confermare di nuovo.
        const { room } = requireRoom(conn);
        if (!room.game || room.game.phase !== "over") throw new Error("La partita non è finita");
        clearTimeout(room.timer);
        room.timer = null;
        room.game = null;
        for (const p of room.players) p.ready = false;
        broadcast(room);
        return;
      }
      case "leave":
        leave(conn);
        return;
      default:
        throw new Error("Messaggio sconosciuto");
    }
  }

  return {
    rooms,
    handle,
    leave,
    // Connessione per un telefono. send riceve la stringa JSON da inviargli.
    connection(id, sendRaw) {
      return { id, send: sendRaw, room: null, playerId: null, onClose: null };
    },
  };
}
