import type { PositionQuality, SourceHealth, SourceState, TrainDetail } from "@trainfinder/shared";

export interface AdapterMeta {
  id: string;
  name: string;
  country: string;
  quality: PositionQuality;
  attribution: string;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface AdapterContext {
  /** Sostituisce l'intero insieme di treni della fonte (i mancanti vengono rimossi). */
  replaceAll(trains: TrainDetail[]): void;
  /** Aggiunge o aggiorna alcuni treni senza toccare gli altri. */
  upsert(trains: TrainDetail[]): void;
  remove(ids: string[]): void;
  setState(state: SourceState, message?: string): void;
  log: Logger;
}

export interface SourceAdapter {
  meta: AdapterMeta;
  /** Motivo per cui l'adapter non puo' partire (es. credenziali mancanti), oppure undefined. */
  disabledReason?(): string | undefined;
  start(ctx: AdapterContext): Promise<void>;
  stop(): Promise<void>;
}

export type { SourceHealth };
