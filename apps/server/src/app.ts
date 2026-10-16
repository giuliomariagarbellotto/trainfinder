import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { Broadcaster, parseBBox } from "./broadcaster.js";
import type { SourceRegistry } from "./registry.js";
import type { TrainStore } from "./store.js";

export async function buildApp(store: TrainStore, registry: SourceRegistry, broadcaster: Broadcaster): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, disableRequestLogging: true });
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

  // Se presente, il server pubblica anche il frontend compilato: un solo servizio da distribuire.
  if (fs.existsSync(config.webDir)) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      setHeaders: (res, file) => {
        if (file.includes("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "non trovato" });
    });
  }

  return app;
}
