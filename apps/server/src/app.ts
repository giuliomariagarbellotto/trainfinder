import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { Broadcaster, parseBBox } from "./broadcaster.js";
import type { SourceRegistry } from "./registry.js";
import type { TrainStore } from "./store.js";

export async function buildApp(store: TrainStore, registry: SourceRegistry, broadcaster: Broadcaster): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(websocket);

  app.get("/api/health", async () => ({ ok: true, trains: store.size, clients: broadcaster.clientCount }));

  app.get("/api/sources", async () => registry.health());

  app.get<{ Querystring: { bbox?: string } }>("/api/trains", async (req, reply) => {
    if (!req.query.bbox) return store.query();
    const bbox = parseBBox(req.query.bbox.split(",").map(Number));
    if (!bbox) return reply.code(400).send({ error: "bbox non valida, formato: ovest,sud,est,nord" });
    return store.query(bbox);
  });

  app.get<{ Params: { id: string } }>("/api/trains/:id", async (req, reply) => {
    const train = store.get(req.params.id);
    if (!train) return reply.code(404).send({ error: "treno non trovato" });
    return train;
  });

  app.get<{ Querystring: { q?: string } }>("/api/search", async (req) => store.search(req.query.q ?? ""));

  app.get("/ws", { websocket: true }, (socket) => broadcaster.add(socket));

  return app;
}
