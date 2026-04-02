Use Bun exclusively — no Node.js, npm, vite, or third-party server frameworks.

## Commands

- `bun run dev serve` — run server in dev mode
- `bun run build` — compile to standalone binary
- `bun test` — run tests
- `bun run deploy` — build and deploy to R2

## Architecture

slog is a local log drain: HTTP server ingests structured logs into SQLite, CLI queries them directly.

- `src/cli.ts` — entry point, CLI argument parsing
- `src/server.ts` — `Bun.serve()` HTTP server (POST /log, GET /health)
- `src/db.ts` — SQLite via `bun:sqlite`, EAV schema (log_events + log_props)
- `src/ingest.ts` — log ingestion, flattens nested objects with dot notation
- `src/query.ts` — query/tail/clear commands, reads db directly
- `src/types.ts` — shared types

## Key conventions

- SQLite only (`bun:sqlite`), no other databases
- `Bun.serve()` for HTTP, no express/fastify
- `Bun.file` over `node:fs` where possible
- Server daemonizes and writes PID/port to `~/.slog/slog.pid`
- Single dependency: `ulid` for event IDs
