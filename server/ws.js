// Minimo server WebSocket (RFC 6455) senza dipendenze: solo testo, niente estensioni.
// Usato al posto della libreria "ws" perché il registro npm non è raggiungibile da questo ambiente.
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_FRAME = 64 * 1024;

export function acceptKey(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

export class Socket {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frags = null;
    this.closed = false;
    this.handlers = { message: [], close: [] };
    sock.on("data", (d) => this.onData(d));
    sock.on("close", () => this.finish());
    sock.on("error", () => this.finish());
  }

  on(event, fn) {
    this.handlers[event].push(fn);
    return this;
  }

  emit(event, ...args) {
    for (const fn of this.handlers[event]) fn(...args);
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (!this.closed) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return this.fail(1009);
        len = Number(big);
        off = 10;
      }
      if (len > MAX_FRAME) return this.fail(1009);
      if (!masked) return this.fail(1002); // i client devono mascherare i frame
      if (this.buf.length < off + 4 + len) return; // frame incompleto
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) payload[i] = this.buf[off + 4 + i] ^ mask[i % 4];
      this.buf = this.buf.subarray(off + 4 + len);
      this.handleFrame(fin, op, payload);
    }
  }

  handleFrame(fin, op, payload) {
    if (op >= 0x8) {
      // frame di controllo: devono stare in un frame solo
      if (op === 0x8) {
        this.sendFrame(0x8, Buffer.alloc(0));
        this.sock.end();
        this.finish();
      } else if (op === 0x9) {
        this.sendFrame(0xa, payload);
      }
      return;
    }
    let text;
    if (op === 0x0) {
      if (!this.frags) return this.fail(1002);
      this.frags.push(payload);
      if (!fin) return;
      text = Buffer.concat(this.frags);
      this.frags = null;
    } else {
      if (this.frags) return this.fail(1002);
      if (!fin) {
        this.frags = [payload];
        return;
      }
      text = payload;
    }
    this.emit("message", text.toString("utf8"));
  }

  sendFrame(op, payload) {
    if (this.closed) return;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.sock.write(Buffer.concat([head, payload]));
  }

  send(text) {
    this.sendFrame(0x1, Buffer.from(text, "utf8"));
  }

  close() {
    if (this.closed) return;
    try {
      this.sendFrame(0x8, Buffer.alloc(0));
    } catch {
      /* già chiuso */
    }
    this.sock.end();
    this.finish();
  }

  fail(code) {
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code);
    try {
      this.sendFrame(0x8, p);
    } catch {
      /* socket già chiuso */
    }
    this.sock.destroy();
    this.finish();
  }
}

/** Completa l'handshake HTTP → WebSocket. Restituisce null se la richiesta non è valida. */
export function handshake(req, socket, head = Buffer.alloc(0)) {
  const key = req.headers["sec-websocket-key"];
  const ok =
    String(req.headers.upgrade || "").toLowerCase() === "websocket" &&
    typeof key === "string" &&
    req.headers["sec-websocket-version"] === "13";
  if (!ok) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      "",
      "",
    ].join("\r\n"),
  );
  const ws = new Socket(socket);
  if (head.length) ws.onData(head);
  return ws;
}
