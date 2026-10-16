import type { BBox, ServerMessage, TrainPosition } from "@trainfinder/shared";

export interface LiveTrain extends TrainPosition {
  /** Istante (orologio del browser) in cui il dato e' arrivato, per l'estrapolazione. */
  receivedAt: number;
}

export type ConnectionState = "connecting" | "open" | "closed";

/**
 * Mantiene la connessione WebSocket col server e lo stato dei treni visibili.
 * Non usa lo stato di React: la mappa legge i dati direttamente a ogni frame.
 */
export class TrainFeed {
  readonly trains = new Map<string, LiveTrain>();
  state: ConnectionState = "connecting";
  private socket?: WebSocket;
  private bbox?: BBox;
  private listeners = new Set<() => void>();
  private retry = 0;
  private closed = false;
  /** Differenza tra orologio del server e del browser. */
  private clockSkew = 0;

  connect(): void {
    this.closed = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.socket = ws;
    this.setState("connecting");
    ws.onopen = () => {
      this.retry = 0;
      this.setState("open");
      if (this.bbox) this.send({ type: "subscribe", bbox: this.bbox });
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data as string) as ServerMessage);
    ws.onclose = () => {
      this.setState("closed");
      if (this.closed) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  disconnect(): void {
    this.closed = true;
    this.socket?.close();
  }

  setBBox(bbox: BBox): void {
    this.bbox = bbox;
    this.send({ type: "subscribe", bbox });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Ora del server stimata, utile per mostrare "aggiornato N s fa". */
  serverNow(): number {
    return Date.now() + this.clockSkew;
  }

  private send(msg: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private onMessage(msg: ServerMessage): void {
    const now = Date.now();
    if (msg.type === "pong") return;
    this.clockSkew = msg.serverTime - now;
    if (msg.type === "snapshot") {
      this.trains.clear();
      for (const t of msg.trains) this.trains.set(t.id, { ...t, receivedAt: now });
    } else {
      for (const t of msg.upserts) this.trains.set(t.id, { ...t, receivedAt: now });
      for (const id of msg.removals) this.trains.delete(id);
    }
    this.emit();
  }
}

const R = 6_371_008.8;

/**
 * Posizione proiettata in avanti con velocita' e rotta (dead reckoning, come Flightradar24),
 * limitata a 45 secondi per non allontanarsi troppo dal dato reale.
 */
export function extrapolate(t: LiveTrain, now: number): [number, number] {
  if (!t.speedKmh || t.bearing == null || t.speedKmh < 3) return [t.lon, t.lat];
  const dt = Math.min(45, Math.max(0, (now - t.receivedAt) / 1000));
  const d = (t.speedKmh / 3.6) * dt;
  const br = (t.bearing * Math.PI) / 180;
  const dLat = (d * Math.cos(br)) / R;
  const dLon = (d * Math.sin(br)) / (R * Math.cos((t.lat * Math.PI) / 180));
  return [t.lon + (dLon * 180) / Math.PI, t.lat + (dLat * 180) / Math.PI];
}
