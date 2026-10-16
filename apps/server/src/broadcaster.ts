import type { WebSocket } from "ws";
import { inBBox, type BBox, type ClientMessage, type ServerMessage } from "@trainfinder/shared";
import { toPosition, type TrainStore } from "./store.js";

interface Client {
  socket: WebSocket;
  bbox?: BBox;
  /** Treni gia' inviati al client e non ancora rimossi. */
  sent: Set<string>;
}

const WORLD: BBox = [-180, -90, 180, 90];

/** Accetta solo bbox numericamente valide e allarga leggermente l'area per evitare treni che "spuntano" ai bordi. */
export function parseBBox(value: unknown): BBox | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return undefined;
  }
  const [w, s, e, n] = value as BBox;
  if (s > n || s < -90 || n > 90) return undefined;
  const padX = w <= e ? (e - w) * 0.1 : 0;
  const padY = (n - s) * 0.1;
  return [Math.max(-180, w - padX), Math.max(-90, s - padY), Math.min(180, e + padX), Math.min(90, n + padY)];
}

export class Broadcaster {
  private clients = new Set<Client>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly store: TrainStore) {}

  start(intervalMs: number): void {
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    for (const c of this.clients) c.socket.close();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  add(socket: WebSocket): void {
    const client: Client = { socket, sent: new Set() };
    this.clients.add(client);
    socket.on("message", (raw) => this.onMessage(client, raw.toString()));
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => this.clients.delete(client));
  }

  private send(client: Client, msg: ServerMessage): void {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(msg));
  }

  private onMessage(client: Client, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === "ping") {
      this.send(client, { type: "pong" });
    } else if (msg.type === "subscribe") {
      const bbox = parseBBox(msg.bbox);
      if (!bbox) return;
      client.bbox = bbox;
      const trains = this.store.query(bbox);
      // Rimuove dal client i treni ora fuori dall'area.
      const visible = new Set(trains.map((t) => t.id));
      const removals = [...client.sent].filter((id) => !visible.has(id));
      client.sent = visible;
      this.send(client, { type: "snapshot", trains, serverTime: Date.now() });
      if (removals.length) this.send(client, { type: "update", upserts: [], removals, serverTime: Date.now() });
    }
  }

  tick(): void {
    const { changed, removed } = this.store.drainChanges();
    if (!changed.length && !removed.length) return;
    const now = Date.now();
    for (const client of this.clients) {
      const bbox = client.bbox ?? WORLD;
      const upserts = [];
      const removals: string[] = [];
      for (const t of changed) {
        if (inBBox(t.lon, t.lat, bbox)) {
          upserts.push(toPosition(t));
          client.sent.add(t.id);
        } else if (client.sent.delete(t.id)) {
          removals.push(t.id);
        }
      }
      for (const id of removed) if (client.sent.delete(id)) removals.push(id);
      if (upserts.length || removals.length) this.send(client, { type: "update", upserts, removals, serverTime: now });
    }
  }
}
