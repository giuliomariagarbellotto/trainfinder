/**
 * Qualita' della posizione:
 * - "reported": posizione comunicata dalla fonte (GPS di bordo o segnalamento);
 * - "estimated": calcolata da orario + ritardo o da eventi di circolazione.
 */
export type PositionQuality = "reported" | "estimated";

export interface TrainPosition {
  /** Identificativo univoco globale, es. "fi:2026-10-16:7". */
  id: string;
  /** Id dell'adapter che ha prodotto il dato, es. "fi-digitraffic". */
  source: string;
  /** Codice paese ISO 3166-1 alpha-2. */
  country: string;
  operator?: string;
  /** Numero o codice commerciale del treno. */
  number: string;
  /** Categoria commerciale (IC, R, Pendolino, linea suburbana, ...). */
  category?: string;
  lat: number;
  lon: number;
  speedKmh?: number;
  /** Direzione di marcia in gradi, 0 = nord, senso orario. */
  bearing?: number;
  /** Ritardo in minuti (negativo = in anticipo). */
  delayMin?: number;
  origin?: string;
  destination?: string;
  nextStop?: string;
  quality: PositionQuality;
  /** Istante del dato di posizione, ms epoch. */
  updatedAt: number;
}

export interface StopInfo {
  name: string;
  code?: string;
  lat?: number;
  lon?: number;
  scheduledArrival?: number;
  scheduledDeparture?: number;
  actualArrival?: number;
  actualDeparture?: number;
  delayMin?: number;
  passed: boolean;
}

export interface TrainDetail extends TrainPosition {
  stops?: StopInfo[];
  /** Ultime posizioni note, [lon, lat, ms]. */
  trail?: [number, number, number][];
}

export type SourceState = "starting" | "ok" | "degraded" | "error" | "disabled";

export interface SourceHealth {
  id: string;
  name: string;
  country: string;
  quality: PositionQuality;
  state: SourceState;
  trains: number;
  lastUpdate?: number;
  message?: string;
  attribution: string;
}

/** [ovest, sud, est, nord] in gradi WGS84. */
export type BBox = [number, number, number, number];

export type ClientMessage =
  | { type: "subscribe"; bbox: BBox }
  | { type: "ping" };

export type ServerMessage =
  | { type: "snapshot"; trains: TrainPosition[]; serverTime: number }
  | { type: "update"; upserts: TrainPosition[]; removals: string[]; serverTime: number }
  | { type: "pong" };
