import path from "node:path";

const env = process.env;

function list(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? "0.0.0.0",
  /** Nome applicazione inviato alle API che chiedono di identificarsi (Digitraffic, Entur). */
  clientName: env.CLIENT_NAME ?? "trainfinder",
  /** Se valorizzato, abilita solo questi adapter (id separati da virgola). */
  enabledSources: list(env.ENABLED_SOURCES),
  dataDir: path.resolve(env.DATA_DIR ?? "data"),
  /** GeoJSON con le linee ferroviarie, usato per far seguire i binari alle posizioni stimate. */
  railNetworkFile: env.RAIL_NETWORK_FILE,
  nrod: {
    user: env.NROD_USER,
    password: env.NROD_PASSWORD,
    host: env.NROD_HOST ?? "publicdatafeeds.networkrail.co.uk",
    port: Number(env.NROD_PORT ?? 61618),
    berthsFile: env.UK_BERTHS_FILE,
  },
  /** Ogni quanto i client WebSocket ricevono gli aggiornamenti. */
  broadcastIntervalMs: Number(env.BROADCAST_INTERVAL_MS ?? 2000),
};

export type Config = typeof config;
