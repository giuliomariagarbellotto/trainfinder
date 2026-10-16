import fs from "node:fs/promises";
import path from "node:path";
import type { StopInfo, TrainDetail } from "@trainfinder/shared";
import { config } from "../config.js";
import { fetchJson, HttpError, mapLimit } from "../http-client.js";
import { estimatePosition, straightRouter, type RailRouter, type TimedStop } from "../estimator/estimate.js";
import type { AdapterContext, SourceAdapter } from "./types.js";

const BASE = "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno";
const REGIONS = Array.from({ length: 23 }, (_, i) => i);
const STATIONS_CACHE_MAX_AGE = 7 * 24 * 3600_000;

const DEPARTURES_REFRESH_MS = 5 * 60_000;
const TRAIN_REFRESH_MS = Number(process.env.IT_TRAIN_REFRESH_MS ?? 4 * 60_000);
const MAX_TRAINS = Number(process.env.IT_MAX_TRAINS ?? 1500);
const CONCURRENCY = Number(process.env.IT_CONCURRENCY ?? 3);
const ESTIMATE_INTERVAL_MS = 5_000;

/**
 * Stazioni da cui leggere i tabelloni partenze. Il tabellone include anche i treni in transito,
 * quindi i nodi principali coprono gran parte della rete. Configurabile con IT_HUB_STATIONS.
 */
const DEFAULT_HUBS = [
  "MILANO CENTRALE", "MILANO PORTA GARIBALDI", "MILANO ROGOREDO", "TORINO PORTA NUOVA", "TORINO PORTA SUSA",
  "GENOVA PIAZZA PRINCIPE", "GENOVA BRIGNOLE", "VENEZIA SANTA LUCIA", "VENEZIA MESTRE", "VERONA PORTA NUOVA",
  "PADOVA", "BRESCIA", "BERGAMO", "TRENTO", "BOLZANO", "TRIESTE CENTRALE", "UDINE", "BOLOGNA CENTRALE",
  "PARMA", "RIMINI", "FIRENZE SANTA MARIA NOVELLA", "PISA CENTRALE", "ANCONA", "ROMA TERMINI", "ROMA TIBURTINA",
  "PESCARA CENTRALE", "NAPOLI CENTRALE", "SALERNO", "FOGGIA", "BARI CENTRALE", "LECCE", "TARANTO",
  "REGGIO DI CALABRIA CENTRALE", "PALERMO CENTRALE", "CATANIA CENTRALE", "MESSINA CENTRALE", "CAGLIARI",
  "ALESSANDRIA", "NOVARA", "PIACENZA", "LIVORNO CENTRALE", "PERUGIA", "CASERTA", "POTENZA CENTRALE",
];

export interface VtStation {
  codiceStazione: string;
  codReg: number;
  lat: number;
  lon: number;
  localita?: { nomeLungo?: string; nomeBreve?: string };
}

export interface VtDeparture {
  numeroTreno: number;
  codOrigine: string;
  dataPartenzaTreno: number;
  compNumeroTreno?: string;
  categoriaDescrizione?: string;
  destinazione?: string;
}

export interface VtStop {
  id: string;
  stazione: string;
  arrivo_teorico: number | null;
  partenza_teorica: number | null;
  arrivoReale: number | null;
  partenzaReale: number | null;
  ritardo?: number;
  tipoFermata?: string;
}

export interface VtTrainStatus {
  numeroTreno: number;
  compNumeroTreno?: string;
  categoria?: string;
  categoriaDescrizione?: string;
  origine?: string;
  destinazione?: string;
  ritardo?: number;
  provvedimento?: number;
  arrivato?: boolean;
  nonPartito?: boolean;
  oraUltimoRilevamento?: number | null;
  stazioneUltimoRilevamento?: string;
  fermate?: VtStop[];
}

interface Tracked {
  key: string;
  dep: VtDeparture;
  status?: VtTrainStatus;
  lastFetch: number;
  failures: number;
}

/** Normalizza i nomi stazione per il confronto ("Firenze S. M. N." -> "FIRENZESMN"). */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/SANTA MARIA NOVELLA/g, "SMN")
    .replace(/SANTA /g, "S")
    .replace(/[^A-Z0-9]/g, "");
}

/** ViaggiaTreno vuole date come "Fri Oct 16 2026 14:00:00 GMT+0200", nel fuso di Roma. */
export function viaggiaTrenoDate(at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Rome",
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const offset = (parts.timeZoneName ?? "GMT+01:00").replace(":", "");
  return `${parts.weekday} ${parts.month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} ${offset}`;
}

const titleCase = (s?: string) =>
  s ? s.toLowerCase().replace(/(^|[\s'./-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase()) : undefined;

/** Converte le fermate ViaggiaTreno in orari stimati (effettivi se noti, altrimenti teorici + ritardo attuale). */
export function timedStops(status: VtTrainStatus, stations: Map<string, VtStation>): { timed: TimedStop[]; info: StopInfo[] } {
  const delayMs = (status.ritardo ?? 0) * 60_000;
  const timed: TimedStop[] = [];
  const info: StopInfo[] = [];
  for (const f of status.fermate ?? []) {
    const st = stations.get(f.id);
    const arrival = f.arrivoReale ?? (f.arrivo_teorico != null ? f.arrivo_teorico + delayMs : undefined);
    const departure = f.partenzaReale ?? (f.partenza_teorica != null ? f.partenza_teorica + delayMs : undefined);
    const name = titleCase(f.stazione) ?? f.id;
    timed.push({ name, lon: st?.lon, lat: st?.lat, arrival: arrival ?? undefined, departure: departure ?? undefined });
    info.push({
      name,
      code: f.id,
      lat: st?.lat,
      lon: st?.lon,
      scheduledArrival: f.arrivo_teorico ?? undefined,
      scheduledDeparture: f.partenza_teorica ?? undefined,
      actualArrival: f.arrivoReale ?? undefined,
      actualDeparture: f.partenzaReale ?? undefined,
      delayMin: f.ritardo,
      passed: f.arrivoReale != null || f.partenzaReale != null,
    });
  }
  return { timed, info };
}

/** Vero se l'arrivo previsto a destinazione e' passato da oltre mezz'ora. */
export function isFinished(status: VtTrainStatus, now: number): boolean {
  const last = status.fermate?.[status.fermate.length - 1];
  if (!last) return false;
  const arrival = last.arrivoReale ?? (last.arrivo_teorico != null ? last.arrivo_teorico + (status.ritardo ?? 0) * 60_000 : null);
  return arrival != null && now - arrival > 30 * 60_000;
}

export function italianTrain(
  key: string,
  status: VtTrainStatus,
  stations: Map<string, VtStation>,
  now: number,
  router: RailRouter = straightRouter,
): TrainDetail | undefined {
  if (status.provvedimento === 1 || status.arrivato) return undefined;
  const { timed, info } = timedStops(status, stations);
  const est = estimatePosition(timed, now, router);
  if (!est) return undefined;
  const label = status.compNumeroTreno?.trim() ?? "";
  const category = status.categoriaDescrizione?.trim() || label.replace(/\s*\d+$/, "") || status.categoria;
  return {
    id: `it:${key}`,
    source: "it-viaggiatreno",
    country: "IT",
    operator: "Trenitalia",
    number: String(status.numeroTreno),
    category: category || undefined,
    lat: est.lat,
    lon: est.lon,
    speedKmh: est.speedKmh,
    bearing: est.bearing,
    delayMin: status.ritardo,
    origin: titleCase(status.origine),
    destination: titleCase(status.destinazione),
    nextStop: timed[est.nextIndex]?.name,
    quality: "estimated",
    updatedAt: now,
    stops: info,
  };
}

export class ItalyAdapter implements SourceAdapter {
  meta = {
    id: "it-viaggiatreno",
    name: "ViaggiaTreno (non ufficiale)",
    country: "IT",
    quality: "estimated" as const,
    attribution: "Dati: ViaggiaTreno (Trenitalia/RFI), interfaccia non ufficiale",
  };

  private stations = new Map<string, VtStation>();
  private tracked = new Map<string, Tracked>();
  private timers: NodeJS.Timeout[] = [];
  private busy = false;

  constructor(private readonly router: RailRouter = straightRouter) {}

  async start(ctx: AdapterContext): Promise<void> {
    await this.loadStations(ctx);
    const hubs = this.resolveHubs(ctx);
    ctx.log.info(`${this.stations.size} stazioni, ${hubs.length} tabelloni monitorati`);

    // All'avvio si leggono anche i tabelloni delle ultime due ore per trovare i treni gia' in viaggio.
    const pollDepartures = (offsetsMin: number[]) =>
      this.pollDepartures(hubs, offsetsMin).catch((e) => ctx.log.warn(`partenze: ${e}`));
    void pollDepartures([-120, -60, 0]).then(() => this.refreshTrains(ctx));

    this.timers.push(
      setInterval(() => void pollDepartures([0]), DEPARTURES_REFRESH_MS),
      setInterval(() => void this.refreshTrains(ctx), 30_000),
      setInterval(() => this.publish(ctx), ESTIMATE_INTERVAL_MS),
    );
  }

  async stop(): Promise<void> {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  private async loadStations(ctx: AdapterContext): Promise<void> {
    const file = path.join(config.dataDir, "cache", "it-stations.json");
    let list: VtStation[] | undefined;
    try {
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs < STATIONS_CACHE_MAX_AGE) list = JSON.parse(await fs.readFile(file, "utf8")) as VtStation[];
    } catch {
      // cache assente
    }
    if (!list) {
      ctx.log.info("scarico anagrafica stazioni");
      const perRegion = await mapLimit(REGIONS, 3, (r) =>
        fetchJson<VtStation[]>(`${BASE}/elencoStazioni/${r}`).catch(() => [] as VtStation[]),
      );
      list = perRegion.flat().filter((s) => s.codiceStazione && Number.isFinite(s.lat) && s.lat !== 0);
      if (list.length === 0) throw new Error("ViaggiaTreno non raggiungibile (anagrafica stazioni vuota)");
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(list));
      } catch (e) {
        ctx.log.warn(`impossibile salvare la cache stazioni: ${e}`);
      }
    }
    for (const s of list) this.stations.set(s.codiceStazione, s);
  }

  private resolveHubs(ctx: AdapterContext): string[] {
    const wanted = (process.env.IT_HUB_STATIONS?.split(",") ?? DEFAULT_HUBS).map((s) => s.trim()).filter(Boolean);
    const byName = new Map<string, string>();
    for (const s of this.stations.values()) {
      const name = s.localita?.nomeLungo ?? s.localita?.nomeBreve;
      if (name) byName.set(normalizeName(name), s.codiceStazione);
    }
    const codes: string[] = [];
    for (const w of wanted) {
      const code = /^S\d{5}$/.test(w) ? w : byName.get(normalizeName(w));
      if (code) codes.push(code);
      else ctx.log.warn(`stazione hub non trovata: ${w}`);
    }
    return [...new Set(codes)];
  }

  private async pollDepartures(hubs: string[], offsetsMin: number[]): Promise<void> {
    const jobs = hubs.flatMap((code) => offsetsMin.map((off) => ({ code, off })));
    await mapLimit(jobs, CONCURRENCY, async ({ code, off }) => {
      const when = viaggiaTrenoDate(new Date(Date.now() + off * 60_000));
      const deps = await fetchJson<VtDeparture[]>(`${BASE}/partenze/${code}/${encodeURIComponent(when)}`).catch(() => []);
      for (const d of deps ?? []) {
        if (!d.codOrigine || !d.numeroTreno) continue;
        const key = `${d.codOrigine}/${d.numeroTreno}/${d.dataPartenzaTreno}`;
        if (!this.tracked.has(key) && this.tracked.size < MAX_TRAINS) {
          this.tracked.set(key, { key, dep: d, lastFetch: 0, failures: 0 });
        }
      }
    });
  }

  private async refreshTrains(ctx: AdapterContext): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      const due = [...this.tracked.values()].filter((t) => now - t.lastFetch > TRAIN_REFRESH_MS);
      let blocked = 0;
      await mapLimit(due, CONCURRENCY, async (t) => {
        try {
          const status = await fetchJson<VtTrainStatus>(`${BASE}/andamentoTreno/${t.key}`);
          t.status = status;
          t.lastFetch = Date.now();
          t.failures = 0;
          if (status.arrivato || status.provvedimento === 1) this.tracked.delete(t.key);
        } catch (e) {
          if (e instanceof HttpError && e.status === 403) blocked++;
          t.lastFetch = Date.now();
          if (++t.failures >= 3) this.tracked.delete(t.key);
        }
      });
      if (blocked > 0 && blocked === due.length) {
        ctx.setState("error", "ViaggiaTreno risponde 403: l'IP del server e' probabilmente bloccato");
      }
    } finally {
      this.busy = false;
    }
  }

  private publish(ctx: AdapterContext): void {
    const now = Date.now();
    const trains: TrainDetail[] = [];
    for (const t of this.tracked.values()) {
      if (!t.status) continue;
      const train = italianTrain(t.key, t.status, this.stations, now, this.router);
      if (train) trains.push(train);
      else if (isFinished(t.status, now)) this.tracked.delete(t.key);
    }
    ctx.replaceAll(trains);
  }
}
