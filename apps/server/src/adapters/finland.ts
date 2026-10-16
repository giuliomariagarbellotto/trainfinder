import mqtt, { type MqttClient } from "mqtt";
import type { StopInfo, TrainDetail } from "@trainfinder/shared";
import { config } from "../config.js";
import { fetchJson } from "../http-client.js";
import { MotionTracker } from "../motion.js";
import type { AdapterContext, SourceAdapter } from "./types.js";

const BASE = "https://rata.digitraffic.fi";
const MQTT_URL = "wss://rata.digitraffic.fi/mqtt";
const META_REFRESH_MS = 60_000;
const POSITIONS_REFRESH_MS = 60_000;

export interface DtLocation {
  trainNumber: number;
  departureDate: string;
  timestamp: string;
  location: { type: "Point"; coordinates: [number, number] };
  speed?: number;
  accuracy?: number;
}

export interface DtStation {
  stationShortCode: string;
  stationName: string;
  latitude: number;
  longitude: number;
}

export interface DtTimetableRow {
  type: "ARRIVAL" | "DEPARTURE";
  scheduledTime: string;
  liveEstimateTime: string | null;
  actualTime: string | null;
  differenceInMinutes: number | null;
  commercialStop: boolean | null;
  station: { shortCode: string; name: string };
}

export interface DtRunningTrain {
  trainNumber: number;
  departureDate: string;
  commuterLineid: string | null;
  trainType: { name: string } | null;
  operator: { shortCode: string } | null;
  timeTableRows: DtTimetableRow[];
}

export interface FinnishTrainMeta {
  category?: string;
  operator?: string;
  origin?: string;
  destination?: string;
  nextStop?: string;
  delayMin?: number;
  stops: StopInfo[];
}

const RUNNING_TRAINS_QUERY = `{
  currentlyRunningTrains {
    trainNumber departureDate commuterLineid
    trainType { name }
    operator { shortCode }
    timeTableRows {
      type scheduledTime liveEstimateTime actualTime differenceInMinutes commercialStop
      station { shortCode name }
    }
  }
}`;

const OPERATOR_NAMES: Record<string, string> = { vr: "VR" };

/** Le stazioni hanno spesso il suffisso " asema" (stazione): lo togliamo per brevita'. */
function cleanStationName(name: string): string {
  return name.replace(/ asema$/i, "");
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : undefined);

export function buildFinnishMeta(train: DtRunningTrain, stations: Map<string, DtStation>, now = Date.now()): FinnishTrainMeta {
  const rows = train.timeTableRows;
  const name = (code: string, fallback: string) => cleanStationName(stations.get(code)?.stationName ?? fallback);

  const stops: StopInfo[] = [];
  for (const row of rows) {
    if (!row.commercialStop) continue;
    const code = row.station.shortCode;
    let stop = stops[stops.length - 1];
    if (!stop || stop.code !== code) {
      const st = stations.get(code);
      stop = { name: name(code, row.station.name), code, lat: st?.latitude, lon: st?.longitude, passed: false };
      stops.push(stop);
    }
    const scheduled = ms(row.scheduledTime);
    const actual = ms(row.actualTime) ?? ms(row.liveEstimateTime);
    if (row.type === "ARRIVAL") {
      stop.scheduledArrival = scheduled;
      stop.actualArrival = actual;
    } else {
      stop.scheduledDeparture = scheduled;
      stop.actualDeparture = actual;
    }
    if (row.differenceInMinutes != null) stop.delayMin = row.differenceInMinutes;
    if (row.actualTime) stop.passed = true;
  }

  // Ritardo attuale: ultima riga con orario effettivo.
  let delayMin: number | undefined;
  for (const row of rows) if (row.actualTime && row.differenceInMinutes != null) delayMin = row.differenceInMinutes;

  const next = stops.find((s) => !s.passed && (s.actualArrival ?? s.scheduledArrival ?? 0) >= now - 60_000);
  const first = rows[0];
  const last = rows[rows.length - 1];

  return {
    category: train.commuterLineid || train.trainType?.name || undefined,
    operator: train.operator ? (OPERATOR_NAMES[train.operator.shortCode] ?? train.operator.shortCode.toUpperCase()) : undefined,
    origin: first ? name(first.station.shortCode, first.station.name) : undefined,
    destination: last ? name(last.station.shortCode, last.station.name) : undefined,
    nextStop: next?.name,
    delayMin,
    stops,
  };
}

export const trainKey = (departureDate: string, trainNumber: number) => `${departureDate}:${trainNumber}`;

export function finnishTrain(
  loc: DtLocation,
  meta: FinnishTrainMeta | undefined,
  motion: { bearing?: number; speedKmh?: number },
): TrainDetail {
  const [lon, lat] = loc.location.coordinates;
  return {
    id: `fi:${trainKey(loc.departureDate, loc.trainNumber)}`,
    source: "fi-digitraffic",
    country: "FI",
    number: String(loc.trainNumber),
    operator: meta?.operator,
    category: meta?.category,
    lat,
    lon,
    speedKmh: loc.speed ?? motion.speedKmh,
    bearing: motion.bearing,
    delayMin: meta?.delayMin,
    origin: meta?.origin,
    destination: meta?.destination,
    nextStop: meta?.nextStop,
    quality: "reported",
    updatedAt: Date.parse(loc.timestamp),
    stops: meta?.stops,
  };
}

export class FinlandAdapter implements SourceAdapter {
  meta = {
    id: "fi-digitraffic",
    name: "Digitraffic (Fintraffic)",
    country: "FI",
    quality: "reported" as const,
    attribution: "Fonte: Fintraffic / digitraffic.fi, licenza CC 4.0 BY",
  };

  private ctx?: AdapterContext;
  private client?: MqttClient;
  private timers: NodeJS.Timeout[] = [];
  private stations = new Map<string, DtStation>();
  private metas = new Map<string, FinnishTrainMeta>();
  private motion = new MotionTracker();
  private headers = { "Digitraffic-User": config.clientName, "Accept-Encoding": "gzip" };

  async start(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    const stations = await fetchJson<DtStation[]>(`${BASE}/api/v1/metadata/stations`, { headers: this.headers });
    for (const s of stations) this.stations.set(s.stationShortCode, s);

    await this.refreshMeta().catch((e) => ctx.log.warn(`metadati non disponibili: ${e}`));
    await this.refreshPositions();
    this.timers.push(
      setInterval(() => this.refreshMeta().catch((e) => ctx.log.warn(`metadati: ${e}`)), META_REFRESH_MS),
      // Il polling resta come rete di sicurezza se MQTT si disconnette.
      setInterval(() => this.refreshPositions().catch((e) => ctx.log.warn(`posizioni: ${e}`)), POSITIONS_REFRESH_MS),
    );
    this.connectMqtt();
  }

  async stop(): Promise<void> {
    this.timers.forEach(clearInterval);
    this.timers = [];
    await this.client?.endAsync().catch(() => undefined);
  }

  private async refreshMeta(): Promise<void> {
    const res = await fetchJson<{ data?: { currentlyRunningTrains: DtRunningTrain[] } }>(`${BASE}/api/v2/graphql/graphql`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ query: RUNNING_TRAINS_QUERY }),
    });
    const metas = new Map<string, FinnishTrainMeta>();
    for (const t of res.data?.currentlyRunningTrains ?? []) {
      metas.set(trainKey(t.departureDate, t.trainNumber), buildFinnishMeta(t, this.stations));
    }
    this.metas = metas;
  }

  private async refreshPositions(): Promise<void> {
    const locs = await fetchJson<DtLocation[]>(`${BASE}/api/v1/train-locations/latest`, { headers: this.headers });
    const trains = locs.map((l) => this.toTrain(l));
    this.ctx!.replaceAll(trains);
    this.motion.prune(new Set(trains.map((t) => t.id)));
    this.ctx!.setState("ok");
  }

  private toTrain(loc: DtLocation): TrainDetail {
    const key = trainKey(loc.departureDate, loc.trainNumber);
    const motion = this.motion.update(`fi:${key}`, loc.location.coordinates, Date.parse(loc.timestamp));
    return finnishTrain(loc, this.metas.get(key), motion);
  }

  private connectMqtt(): void {
    const ctx = this.ctx!;
    this.client = mqtt.connect(MQTT_URL, {
      clientId: `${config.clientName}-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 5_000,
    });
    this.client.on("connect", () => {
      ctx.log.info("MQTT connesso");
      this.client!.subscribe("train-locations/#");
    });
    this.client.on("message", (_topic, payload) => {
      try {
        const loc = JSON.parse(payload.toString()) as DtLocation;
        if (loc.location?.coordinates) ctx.upsert([this.toTrain(loc)]);
      } catch {
        // messaggio non valido: ignorato
      }
    });
    this.client.on("error", (e) => ctx.log.warn(`MQTT: ${e.message}`));
  }
}
