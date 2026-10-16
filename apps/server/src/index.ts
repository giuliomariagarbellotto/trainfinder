import fs from "node:fs";
import { config } from "./config.js";
import { buildApp } from "./app.js";
import { Broadcaster } from "./broadcaster.js";
import { SourceRegistry } from "./registry.js";
import { TrainStore } from "./store.js";
import { straightRouter, type RailRouter } from "./estimator/estimate.js";
import { RailNetwork } from "./estimator/rail-network.js";
import { FinlandAdapter } from "./adapters/finland.js";
import { NorwayAdapter } from "./adapters/norway.js";
import { IrelandAdapter } from "./adapters/ireland.js";
import { ItalyAdapter } from "./adapters/italy.js";
import { UkTdAdapter } from "./adapters/uk-td.js";

const store = new TrainStore();
const broadcaster = new Broadcaster(store);
// Il logger di Fastify esiste solo dopo buildApp: le closure lo leggono al momento dell'uso.
const registry = new SourceRegistry(store, {
  info: (m) => app.log.info(m),
  warn: (m) => app.log.warn(m),
  error: (m) => app.log.error(m),
});
const app = await buildApp(store, registry, broadcaster);

let router: RailRouter = straightRouter;
if (config.railNetworkFile && fs.existsSync(config.railNetworkFile)) {
  const net = RailNetwork.fromFile(config.railNetworkFile);
  app.log.info(`rete ferroviaria caricata: ${net.nodeCount} nodi`);
  router = net;
} else {
  app.log.info("nessuna rete ferroviaria: le posizioni stimate seguono la linea retta tra le stazioni");
}

registry.register(new FinlandAdapter());
registry.register(new NorwayAdapter());
registry.register(new IrelandAdapter());
registry.register(new ItalyAdapter(router));
registry.register(new UkTdAdapter());

await app.listen({ port: config.port, host: config.host });
broadcaster.start(config.broadcastIntervalMs);
void registry.startAll(config.enabledSources);
const sweeper = setInterval(() => store.removeStale(), 60_000);

async function shutdown() {
  clearInterval(sweeper);
  broadcaster.stop();
  await registry.stopAll();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
