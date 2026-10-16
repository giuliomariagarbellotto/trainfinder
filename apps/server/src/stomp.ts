import net from "node:net";
import { EventEmitter } from "node:events";

export interface StompFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

/** Estrae i frame STOMP completi dal buffer e restituisce il resto non ancora completo. */
export function parseFrames(buffer: string): { frames: StompFrame[]; rest: string } {
  const frames: StompFrame[] = [];
  let rest = buffer;
  for (;;) {
    const end = rest.indexOf("\0");
    if (end === -1) break;
    const raw = rest.slice(0, end).replace(/^[\r\n]+/, "");
    rest = rest.slice(end + 1);
    if (!raw) continue;
    const sep = raw.search(/\r?\n\r?\n/);
    const head = sep === -1 ? raw : raw.slice(0, sep);
    const body = sep === -1 ? "" : raw.slice(sep).replace(/^\r?\n\r?\n/, "");
    const [command = "", ...lines] = head.split(/\r?\n/);
    const headers: Record<string, string> = {};
    for (const line of lines) {
      const i = line.indexOf(":");
      if (i > 0 && !(line.slice(0, i) in headers)) headers[line.slice(0, i)] = line.slice(i + 1);
    }
    frames.push({ command, headers, body });
  }
  // I heartbeat sono semplici "\n" tra un frame e l'altro.
  return { frames, rest: rest.replace(/^[\r\n]+$/, "") };
}

export function serializeFrame(command: string, headers: Record<string, string>, body = ""): string {
  const head = Object.entries(headers)
    .map(([k, v]) => `${k}:${v}`)
    .join("\n");
  return `${command}\n${head}\n\n${body}\0`;
}

export interface StompOptions {
  host: string;
  port: number;
  login: string;
  passcode: string;
  /** Usato da Network Rail per le sottoscrizioni durevoli. */
  clientId?: string;
}

/**
 * Client STOMP 1.2 minimale su TCP, sufficiente per i feed Network Rail Open Data.
 * Emette "message" (destination, body), "connected", "error", "close".
 */
export class StompClient extends EventEmitter {
  private socket?: net.Socket;
  private buffer = "";
  private heartbeat?: NodeJS.Timeout;
  private subscriptions: string[] = [];
  private closed = false;

  constructor(private readonly opts: StompOptions) {
    super();
  }

  connect(): void {
    this.closed = false;
    const socket = net.connect(this.opts.port, this.opts.host);
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const headers: Record<string, string> = {
        "accept-version": "1.2",
        host: this.opts.host,
        login: this.opts.login,
        passcode: this.opts.passcode,
        "heart-beat": "15000,15000",
      };
      if (this.opts.clientId) headers["client-id"] = this.opts.clientId;
      socket.write(serializeFrame("CONNECT", headers));
    });
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", (err) => this.emit("error", err));
    socket.on("close", () => {
      clearInterval(this.heartbeat);
      this.emit("close");
      if (!this.closed) setTimeout(() => this.connect(), 10_000);
    });
  }

  subscribe(destination: string): void {
    this.subscriptions.push(destination);
    this.sendSubscribe(destination, this.subscriptions.length);
  }

  disconnect(): void {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.socket?.end(serializeFrame("DISCONNECT", {}));
  }

  private sendSubscribe(destination: string, id: number): void {
    this.socket?.write(serializeFrame("SUBSCRIBE", { destination, id: String(id), ack: "auto" }));
  }

  private onData(chunk: string): void {
    const { frames, rest } = parseFrames(this.buffer + chunk);
    this.buffer = rest;
    for (const f of frames) {
      if (f.command === "CONNECTED") {
        this.heartbeat = setInterval(() => this.socket?.write("\n"), 15_000);
        this.subscriptions.forEach((d, i) => this.sendSubscribe(d, i + 1));
        this.emit("connected");
      } else if (f.command === "MESSAGE") {
        this.emit("message", f.headers.destination ?? "", f.body);
      } else if (f.command === "ERROR") {
        this.emit("error", new Error(f.headers.message ?? f.body));
      }
    }
  }
}
