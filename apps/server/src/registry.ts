import type { SourceHealth, SourceState } from "@trainfinder/shared";
import type { AdapterContext, Logger, SourceAdapter } from "./adapters/types.js";
import type { TrainStore } from "./store.js";

interface Entry {
  adapter: SourceAdapter;
  state: SourceState;
  message?: string;
  lastUpdate?: number;
  retry?: NodeJS.Timeout;
}

const RETRY_MS = 5 * 60_000;

export class SourceRegistry {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly store: TrainStore,
    private readonly log: Logger,
  ) {}

  register(adapter: SourceAdapter): void {
    this.entries.set(adapter.meta.id, { adapter, state: "starting" });
  }

  async startAll(enabled?: string[]): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        const { meta } = entry.adapter;
        if (enabled && !enabled.includes(meta.id)) {
          entry.state = "disabled";
          entry.message = "Non incluso in ENABLED_SOURCES";
          return;
        }
        const reason = entry.adapter.disabledReason?.();
        if (reason) {
          entry.state = "disabled";
          entry.message = reason;
          this.log.warn(`[${meta.id}] disattivato: ${reason}`);
          return;
        }
        await this.tryStart(entry);
      }),
    );
  }

  /** Se l'avvio fallisce (fonte irraggiungibile) si riprova periodicamente. */
  private async tryStart(entry: Entry): Promise<void> {
    const { meta } = entry.adapter;
    try {
      await entry.adapter.start(this.contextFor(entry));
      this.log.info(`[${meta.id}] avviato`);
    } catch (err) {
      entry.state = "error";
      entry.message = String(err);
      this.log.error(`[${meta.id}] avvio fallito, nuovo tentativo tra ${RETRY_MS / 60_000} minuti: ${err}`);
      await entry.adapter.stop().catch(() => undefined);
      entry.retry = setTimeout(() => void this.tryStart(entry), RETRY_MS);
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map((e) => {
        clearTimeout(e.retry);
        return e.adapter.stop().catch(() => undefined);
      }),
    );
  }

  health(): SourceHealth[] {
    return [...this.entries.values()].map(({ adapter, state, message, lastUpdate }) => ({
      ...adapter.meta,
      state,
      message,
      lastUpdate,
      trains: this.store.countBySource(adapter.meta.id),
    }));
  }

  private contextFor(entry: Entry): AdapterContext {
    const id = entry.adapter.meta.id;
    const prefix = (m: string) => `[${id}] ${m}`;
    const touched = () => {
      entry.lastUpdate = Date.now();
      if (entry.state === "starting" || entry.state === "error") {
        entry.state = "ok";
        entry.message = undefined;
      }
    };
    return {
      replaceAll: (trains) => {
        this.store.replaceAll(id, trains);
        touched();
      },
      upsert: (trains) => {
        this.store.upsert(trains);
        touched();
      },
      remove: (ids) => this.store.remove(ids),
      setState: (state, message) => {
        entry.state = state;
        entry.message = message;
      },
      log: {
        info: (m) => this.log.info(prefix(m)),
        warn: (m) => this.log.warn(prefix(m)),
        error: (m) => this.log.error(prefix(m)),
      },
    };
  }
}
