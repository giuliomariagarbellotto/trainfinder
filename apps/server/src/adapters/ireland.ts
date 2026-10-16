import { XMLParser } from "fast-xml-parser";
import type { TrainDetail } from "@trainfinder/shared";
import { fetchText } from "../http-client.js";
import { MotionTracker } from "../motion.js";
import type { AdapterContext, SourceAdapter } from "./types.js";

const URL = "https://api.irishrail.ie/realtime/realtime.asmx/getCurrentTrainsXML";
const REFRESH_MS = 30_000;

export interface IrishTrainRaw {
  TrainStatus: string;
  TrainLatitude: number;
  TrainLongitude: number;
  TrainCode: string;
  TrainDate: string;
  PublicMessage: string;
  Direction: string;
}

export interface ParsedMessage {
  origin?: string;
  destination?: string;
  delayMin?: number;
  nextStop?: string;
}

/**
 * Esempi di PublicMessage:
 *  "E216\n14:33 - Bray to Howth (2 mins late)\nArrived Dun Laoghaire next stop Salthill and Monkstown"
 *  "P521\nCobh to Cork\nExpected Departure 14:30"
 * Nell'XML il ritorno a capo arriva come sequenza letterale "\n".
 */
export function parseIrishMessage(msg: string): ParsedMessage {
  const lines = msg.split(/\\n|\n/).map((l) => l.trim());
  const out: ParsedMessage = {};
  const route = lines[1]?.replace(/^\d{1,2}:\d{2}\s*-\s*/, "");
  if (route) {
    const m = /^(.*?) to (.*?)(?:\s*\((-?\d+) mins? (late|early)\))?$/.exec(route);
    if (m) {
      out.origin = m[1]?.trim();
      out.destination = m[2]?.trim();
      if (m[3]) out.delayMin = Number(m[3]) * (m[4] === "early" ? -1 : 1);
    }
  }
  const next = /next stop (.+)$/i.exec(lines[2] ?? "");
  if (next) out.nextStop = next[1]!.trim();
  return out;
}

export function parseIrishXml(xml: string): IrishTrainRaw[] {
  const parser = new XMLParser({ parseTagValue: false });
  const doc = parser.parse(xml) as { ArrayOfObjTrainPositions?: { objTrainPositions?: unknown } };
  const raw = doc.ArrayOfObjTrainPositions?.objTrainPositions;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, string>[];
  return items.map((i) => ({
    TrainStatus: i.TrainStatus ?? "",
    TrainLatitude: Number(i.TrainLatitude),
    TrainLongitude: Number(i.TrainLongitude),
    TrainCode: (i.TrainCode ?? "").trim(),
    TrainDate: i.TrainDate ?? "",
    PublicMessage: i.PublicMessage ?? "",
    Direction: i.Direction ?? "",
  }));
}

export class IrelandAdapter implements SourceAdapter {
  meta = {
    id: "ie-irishrail",
    name: "Irish Rail Realtime",
    country: "IE",
    quality: "reported" as const,
    attribution: "Fonte: Iarnród Éireann / Irish Rail Realtime API",
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
    const now = Date.now();
    const trains: TrainDetail[] = [];
    for (const r of parseIrishXml(await fetchText(URL))) {
      // "N" = non ancora partito: la posizione e' quella della stazione di origine.
      if (r.TrainStatus !== "R") continue;
      if (!r.TrainLatitude || !r.TrainLongitude) continue;
      const id = `ie:${r.TrainDate}:${r.TrainCode}`;
      const motion = this.motion.update(id, [r.TrainLongitude, r.TrainLatitude], now);
      const msg = parseIrishMessage(r.PublicMessage);
      trains.push({
        id,
        source: this.meta.id,
        country: "IE",
        operator: "Iarnród Éireann",
        number: r.TrainCode,
        category: r.TrainCode.startsWith("E") ? "DART" : undefined,
        lat: r.TrainLatitude,
        lon: r.TrainLongitude,
        ...motion,
        ...msg,
        quality: "reported",
        updatedAt: now,
      });
    }
    ctx.replaceAll(trains);
    this.motion.prune(new Set(trains.map((t) => t.id)));
    ctx.setState("ok");
  }
}
