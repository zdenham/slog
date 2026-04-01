import type { Database } from "bun:sqlite";
import { ingestLogs } from "./ingest.ts";
import type { LogInput } from "./types.ts";

export function createServer(db: Database, port: number, host = "127.0.0.1") {
  const server = Bun.serve({
    port,
    hostname: host,
    routes: {
      "/health": {
        GET: () => Response.json({ ok: true }),
      },
      "/log": {
        POST: async (req) => {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return Response.json({ error: "Invalid JSON" }, { status: 400 });
          }

          if (!body || typeof body !== "object") {
            return Response.json({ error: "Request body must be JSON" }, { status: 400 });
          }

          const entries = Array.isArray(body) ? body : [body];

          for (const entry of entries) {
            if (!entry || typeof entry !== "object" || !("message" in entry) || typeof entry.message !== "string") {
              return Response.json(
                { error: "Each log entry must have a 'message' string field" },
                { status: 400 }
              );
            }
          }

          try {
            const count = ingestLogs(db, body as LogInput | LogInput[]);
            return Response.json({ ingested: count });
          } catch {
            return Response.json({ error: "Database error" }, { status: 500 });
          }
        },
      },
    },
  });

  return server;
}
