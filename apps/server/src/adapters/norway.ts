import type { TrainDetail } from "@trainfinder/shared";
import { config } from "../config.js";
import { fetchJson } from "../http-client.js";
import { MotionTracker } from "../motion.js";
import type { AdapterContext, SourceAdapter } from "./types.js";

const URL = "https://api.entur.io/realtime/v2/vehicles/graphql";
const REFRESH_MS = 15_000;

const QUERY = `{
  vehicles(mode: RAIL) {
    vehicleId lastUpdatedEpochSecond expirationEpochSecond
    location { latitude longitude }
    speed bearing delay
    line { publicCode lineName }
    codespace { codespaceId }
    operator { operatorRef }
    originName destinationName
    serviceJourney { id }
  }
}`;

export interface EnturVehicle {
  vehicleId: string;
  lastUpdatedEpochSecond: number;
  expirationEpochSecond?: number | null;
  location: { latitude: number; longitude: number } | null;
  speed: number | null;
  bearing: number | null;
  delay: number | null;
  line: { publicCode: string | null; lineName: string | null } | null;
  codespace: { codespaceId: string } | null;
  operator?: { operatorRef: string | null } | null;
  originName: string | null;
  destinationName: string | null;
  serviceJourney: { id: string } | null;
}

const OPERATORS: Record<string, string> = {
  VYG: "Vy",
  GOA: "Go-Ahead Nordic",
  SJN: "SJ Nord",
  FLT: "Flytoget",
  BNR: "Bane NOR",
};

/** Vy, Go-Ahead e SJ usano "<numero treno>-<data>" come vehicleId; Flytoget usa l'id dell'unita'. */
export function enturTrainNumber(v: EnturVehicle): string {
  const m = /^(\d+)-\d{4}-\d{2}-\d{2}$/.exec(v.vehicleId);
  return m ? m[1]! : v.vehicleId;
}

export function enturTrain(v: EnturVehicle, motion: { bearing?: number; speedKmh?: number }): TrainDetail | undefined {
  if (!v.location) return undefined;
  const cs = v.codespace?.codespaceId ?? "NO";
  const key = v.serviceJourney?.id ?? `${cs}:${v.vehicleId}`;
  return {
    id: `no:${key}`,
    source: "no-entur",
    country: "NO",
    operator: OPERATORS[cs] ?? cs,
    number: enturTrainNumber(v),
    category: v.line?.publicCode ?? undefined,
    lat: v.location.latitude,
    lon: v.location.longitude,
    // Entur da' la velocita' in m/s quando disponibile.
    speedKmh: v.speed != null ? Math.round(v.speed * 3.6) : motion.speedKmh,
    bearing: v.bearing ?? motion.bearing,
    delayMin: v.delay != null ? Math.round(v.delay / 60) : undefined,
    origin: v.originName ?? undefined,
    destination: v.destinationName ?? undefined,
    quality: "reported",
    updatedAt: Math.round(v.lastUpdatedEpochSecond * 1000),
  };
}

export class NorwayAdapter implements SourceAdapter {
  meta = {
    id: "no-entur",
    name: "Entur",
    country: "NO",
    quality: "reported" as const,
    attribution: "Fonte: Entur AS, licenza NLOD",
  };

  private timer?: NodeJS.Timeout;
  private motion = new MotionTracker();

  async start(ctx: AdapterContext): Promise<void> {
    await this.refresh(ctx);
    this.timer = setInterval(() => this.refresh(ctx).catch((e) => ctx.setState("degraded", String(e))), REFRESH_MS);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
  }

  private async refresh(ctx: AdapterContext): Promise<void> {
    const res = await fetchJson<{ data?: { vehicles: EnturVehicle[] } }>(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "ET-Client-Name": `${config.clientName}-web` },
      body: JSON.stringify({ query: QUERY }),
    });
    const now = Date.now() / 1000;
    const trains: TrainDetail[] = [];
    for (const v of res.data?.vehicles ?? []) {
      if (v.expirationEpochSecond && v.expirationEpochSecond < now) continue;
      if (!v.location) continue;
      const id = `no:${v.serviceJourney?.id ?? `${v.codespace?.codespaceId}:${v.vehicleId}`}`;
      const motion = this.motion.update(id, [v.location.longitude, v.location.latitude], v.lastUpdatedEpochSecond * 1000);
      const t = enturTrain(v, motion);
      if (t) trains.push(t);
    }
    // Lo stesso servizio puo' comparire piu' volte (unita' accoppiate): teniamo il dato piu' recente.
    const unique = new Map<string, TrainDetail>();
    for (const t of trains) {
      const prev = unique.get(t.id);
      if (!prev || prev.updatedAt < t.updatedAt) unique.set(t.id, t);
    }
    ctx.replaceAll([...unique.values()]);
    this.motion.prune(new Set(unique.keys()));
    ctx.setState("ok");
  }
}
