import type { Database } from "bun:sqlite";
import { ingestLogs } from "./ingest.ts";
import type { LogInput } from "./types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(corsHeaders)) {
    res.headers.set(k, v);
  }
  return res;
}

export function createServer(db: Database, port: number, host = "127.0.0.1") {
  const server = Bun.serve({
    port,
    hostname: host,
    routes: {
      "/health": {
        GET: () => withCors(Response.json({ ok: true })),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders }),
      },
      "/log": {
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders }),
        POST: async (req) => {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return withCors(Response.json({ error: "Invalid JSON" }, { status: 400 }));
          }

          if (!body || typeof body !== "object") {
            return withCors(Response.json({ error: "Request body must be JSON" }, { status: 400 }));
          }

          const entries = Array.isArray(body) ? body : [body];

          for (const entry of entries) {
            if (!entry || typeof entry !== "object" || !("message" in entry) || typeof entry.message !== "string") {
              return withCors(Response.json(
                { error: "Each log entry must have a 'message' string field" },
                { status: 400 }
              ));
            }
          }

          try {
            const count = ingestLogs(db, body as LogInput | LogInput[]);
            return withCors(Response.json({ ingested: count }));
          } catch {
            return withCors(Response.json({ error: "Database error" }, { status: 500 }));
          }
        },
      },
    },
  });

  return server;
}
