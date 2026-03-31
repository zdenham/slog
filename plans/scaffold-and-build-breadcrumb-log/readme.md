# slog — Scaffold and Build

## Objective

Implement the full `slog` project: a local log drain that accepts logs over HTTP, stores them in SQLite (raw + EAV properties), and ships as a single Bun-compiled binary with `slog serve` and `slog query` CLI modes.

## Source Plan

See `plans/scaffold-and-build.md` for full architecture, schema, API specs, and phase details.

## Phases

1. Project scaffolding (package.json, tsconfig, bun setup, directory structure, deps)
2. Types and database layer (types.ts, db.ts — schema, connection, WAL mode)
3. Ingestion logic (ingest.ts — parse log input, insert events + typed properties, transactions)
4. HTTP server (server.ts — Fastify, POST /log, GET /health)
5. Query engine (query.ts — raw SQL passthrough, default query, plain-text errors)
6. CLI (cli.ts — serve/query/tail/clear/status commands, pidfile management, daemonization)
7. E2E CLI tests (full test suite — every command exercised against isolated server/db instances)
8. Build and binary (bun build --compile, package.json scripts)
9. [skill.md](http://skill.md) (agent instructions for reading/querying logs)

## Acceptance Criteria

- `slog serve` starts a daemon, writes pidfile, is idempotent
- `POST /log` accepts single/array JSON, stores events + typed EAV properties in SQLite
- `slog query` runs raw SQL or default recent-50 query against the db
- `slog tail` shows recent logs with optional `--follow`
- `slog clear --yes` wipes the db
- `slog status` reports server info
- All E2E tests pass via `bun test`
- `bun build --compile` produces a working standalone binary
- [skill.md](http://skill.md) provides clear agent instructions for log consumption

## Context

- Runtime: Bun (bun:sqlite, bun build --compile)
- HTTP: Fastify
- IDs: ULID
- DB: SQLite with WAL mode
- Default paths: \~/.slog/slog.db, \~/.slog/slog.pid
- Server binds 127.0.0.1 only