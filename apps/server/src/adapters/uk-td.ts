import fs from "node:fs";
import type { TrainDetail } from "@trainfinder/shared";
import { config } from "../config.js";
import { MotionTracker } from "../motion.js";
import { StompClient } from "../stomp.js";
import type { AdapterContext, SourceAdapter } from "./types.js";

/** Messaggi TD "C-class": spostamento (CA), cancellazione (CB), inserimento (CC) di un codice treno in un berth. */
export interface TdBerthMessage {
  time: string;
  area_id: string;
  msg_type: "CA" | "CB" | "CC" | "CT";
  from?: string;
  to?: string;
  descr?: string;
}

export type TdEnvelope = Partial<Record<"CA_MSG" | "CB_MSG" | "CC_MSG" | "CT_MSG", TdBerthMessage>>;

export type BerthMap = Map<string, [number, number]>;

/**
 * Carica la corrispondenza berth -> coordinate da CSV con intestazione
 * "area_id,berth,lat,lon" (vedi data/README.md per come ricavarla).
 */
export function parseBerthCsv(text: string): BerthMap {
  const map: BerthMap = new Map();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift()?.split(",").map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const [ia, ib, ilat, ilon] = [col("area_id"), col("berth"), col("lat"), col("lon")];
  if ([ia, ib, ilat, ilon].some((i) => i < 0)) throw new Error("CSV berth: servono le colonne area_id,berth,lat,lon");
  for (const line of lines) {
    const c = line.split(",");
    const lat = Number(c[ilat]);
    const lon = Number(c[ilon]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) map.set(`${c[ia]!.trim()}:${c[ib]!.trim()}`, [lon, lat]);
  }
  return map;
}

/** Codici treno che non sono servizi reali (berth di test, blocchi, ecc.). */
const isHeadcode = (descr?: string) => !!descr && /^\d[A-Z]\d{2}$/.test(descr);

export interface TdEvent {
  kind: "move" | "cancel";
  id: string;
  descr: string;
  area: string;
  time: number;
  position?: [number, number];
}

export function tdEvents(envelopes: TdEnvelope[], berths: BerthMap): TdEvent[] {
  const out: TdEvent[] = [];
  for (const env of envelopes) {
    const msg = env.CA_MSG ?? env.CC_MSG ?? env.CB_MSG;
    if (!msg || !isHeadcode(msg.descr)) continue;
    const id = `gb:${msg.area_id}:${msg.descr}`;
    const time = Number(msg.time) || Date.now();
    if (msg.msg_type === "CB") {
      out.push({ kind: "cancel", id, descr: msg.descr!, area: msg.area_id, time });
      continue;
    }
    const position = msg.to ? berths.get(`${msg.area_id}:${msg.to}`) : undefined;
    if (position) out.push({ kind: "move", id, descr: msg.descr!, area: msg.area_id, time, position });
  }
  return out;
}

export class UkTdAdapter implements SourceAdapter {
  meta = {
    id: "gb-networkrail-td",
    name: "Network Rail Train Describer",
    country: "GB",
    quality: "estimated" as const,
    attribution: "Contiene informazioni di Network Rail Infrastructure Limited, Open Government Licence",
  };

  private client?: StompClient;
  private berths: BerthMap = new Map();
  private motion = new MotionTracker();

  disabledReason(): string | undefined {
    if (!config.nrod.user || !config.nrod.password) return "Imposta NROD_USER e NROD_PASSWORD (account gratuito Network Rail Open Data)";
    if (!config.nrod.berthsFile) return "Imposta UK_BERTHS_FILE con il CSV berth -> coordinate";
    return undefined;
  }

  async start(ctx: AdapterContext): Promise<void> {
    this.berths = parseBerthCsv(fs.readFileSync(config.nrod.berthsFile!, "utf8"));
    ctx.log.info(`${this.berths.size} berth georeferenziati`);
    const client = new StompClient({
      host: config.nrod.host,
      port: config.nrod.port,
      login: config.nrod.user!,
      passcode: config.nrod.password!,
    });
    this.client = client;
    client.on("connected", () => ctx.setState("ok"));
    client.on("error", (e: Error) => ctx.setState("degraded", e.message));
    client.on("message", (_dest: string, body: string) => {
      try {
        this.handle(ctx, JSON.parse(body) as TdEnvelope[]);
      } catch {
        // payload non valido
      }
    });
    client.subscribe("/topic/TD_ALL_SIG_AREA");
    client.connect();
  }

  async stop(): Promise<void> {
    this.client?.disconnect();
  }

  private handle(ctx: AdapterContext, envelopes: TdEnvelope[]): void {
    const upserts: TrainDetail[] = [];
    const removals: string[] = [];
    for (const ev of tdEvents(envelopes, this.berths)) {
      if (ev.kind === "cancel") {
        removals.push(ev.id);
        this.motion.forget(ev.id);
        continue;
      }
      const motion = this.motion.update(ev.id, ev.position!, ev.time);
      upserts.push({
        id: ev.id,
        source: this.meta.id,
        country: "GB",
        number: ev.descr,
        lon: ev.position![0],
        lat: ev.position![1],
        ...motion,
        quality: "estimated",
        updatedAt: ev.time,
      });
    }
    if (upserts.length) ctx.upsert(upserts);
    if (removals.length) ctx.remove(removals);
  }
}
