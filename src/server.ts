import Fastify from "fastify";
import type { Database } from "bun:sqlite";
import { ingestLogs } from "./ingest.ts";
import type { LogInput } from "./types.ts";

export function createServer(db: Database) {
  const app = Fastify({ logger: false });

  app.post("/log", async (request, reply) => {
    const body = request.body;

    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "Request body must be JSON" });
    }

    const entries = Array.isArray(body) ? body : [body];

    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || !("message" in entry) || typeof entry.message !== "string") {
        return reply.status(400).send({ error: "Each log entry must have a 'message' string field" });
      }
    }

    try {
      const count = ingestLogs(db, body as LogInput | LogInput[]);
      return reply.send({ ingested: count });
    } catch (err) {
      return reply.status(500).send({ error: "Database error" });
    }
  });

  app.get("/health", async (_request, reply) => {
    return reply.send({ ok: true });
  });

  return app;
}
