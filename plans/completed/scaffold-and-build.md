# slog — SQL Log Drain with Agent Skill

## Overview

A local log drain that accepts logs over HTTP, stores them in SQLite in both raw and structured event-property format (modeled after anvil's `drain.db`). Ships as a single Bun-compiled binary with two modes: `slog serve` (HTTP ingestion server) and `slog query` (CLI-based log querying directly against the db).

## Architecture

```
                                        ┌──────────────┐
┌──────────────┐   POST /log            │   slog.db    │
│  Application │ ──────────→ slog serve │──────────────│
│  (your code) │             :4526      │  log_events  │
└──────────────┘                        │  log_props   │
                                        └──────┬───────┘
┌──────────────┐                               │
│ Coding Agent │  slog query --since 1h    ────┘
│  or Terminal │  (reads db directly, no server needed)
└──────────────┘
```

**Usage model**: Applications instrument their own code with an HTTP logging helper that POSTs to the slog server. Coding agents and humans use `slog query` / `slog tail` to read and search logs — they don't write to the server directly.

### Port Discovery Convention

The server writes its port to a well-known pidfile at `~/.slog/slog.pid` containing JSON:

```json
{ "pid": 12345, "port": 4526, "db": "/Users/you/.slog/slog.db" }
```

The CLI `query` command reads this file to find the db path (or accepts `--db` directly). The [skill.md](http://skill.md) instructs agents to check this file before starting a new server.

### SQLite Schema (modeled after anvil drain.db)

```sql
-- Log events (append-only, raw log storage)
CREATE TABLE log_events (
    event_id    TEXT PRIMARY KEY NOT NULL,   -- ULID (time-ordered)
    event       TEXT NOT NULL,               -- raw log message text
    timestamp   INTEGER NOT NULL             -- Unix epoch ms
);

-- Event properties (EAV-style flexible metadata)
CREATE TABLE log_props (
    event_id      TEXT NOT NULL,
    timestamp     INTEGER NOT NULL,          -- same as parent event
    key           TEXT NOT NULL,
    value_string  TEXT,
    value_number  REAL,
    value_bool    INTEGER,
    FOREIGN KEY (event_id) REFERENCES log_events(event_id)
);

CREATE INDEX idx_events_timestamp ON log_events(timestamp);
CREATE INDEX idx_props_event_id ON log_props(event_id);
CREATE INDEX idx_props_key ON log_props(key);
CREATE INDEX idx_props_event_key ON log_props(event_id, key);
```

This mirrors anvil's `drain_events` / `event_properties` pattern exactly. The key insight: instead of fixed columns for `level`, `source`, etc., **everything is a property**. A log entry like:

```json
{
  "message": "Request failed",
  "level": "error",
  "source": "api",
  "http.status": 500
}
```

Becomes:

- 1 row in `log_events`: `{ event_id: "01HX...", event: "Request failed", timestamp: 1711843200000 }`
- 3 rows in `log_props`:
  - `{ key: "level", value_string: "error" }`
  - `{ key: "source", value_string: "api" }`
  - `{ key: "http.status", value_number: 500 }`

The typed value columns (`value_string`, `value_number`, `value_bool`) preserve type information so numeric queries work correctly.

### HTTP API

**POST /log** — Ingest one or many log entries

Accepts either a single object or an array:

```json
// Single
{ "message": "something happened", "level": "info", "source": "agent" }

// Batch
[
  { "message": "first", "level": "info" },
  { "message": "second", "level": "error", "http.status": 500 }
]
```

All fields except `message` are stored as properties. `timestamp` is auto-added (Unix epoch ms) if not provided.

**GET /health** — Returns `{ "ok": true }`

### CLI Commands

```
slog serve [--port 4526] [--db ~/.slog/slog.db]
    Start the HTTP log ingestion server as a background daemon.
    If a server is already running (pidfile exists, process alive), prints
    its info and exits 0 — safe to call repeatedly.
    Writes pidfile to ~/.slog/slog.pid on startup, removes on shutdown.
    The child process detaches from the terminal (daemonizes).

slog query [--db ~/.slog/slog.db] [sql]
    Run a SQL query directly against the log database.
    No args = show recent 50 logs with properties.
    Errors are returned as plain text (never JSON), so agents and
    humans can read them without parsing.

    Examples:
      slog query "SELECT * FROM log_events ORDER BY timestamp DESC LIMIT 10"
      slog query "SELECT e.*, p.key, p.value_string FROM log_events e JOIN log_props p ON e.event_id = p.event_id WHERE p.key = 'level' AND p.value_string = 'error'"

slog tail [--db ~/.slog/slog.db] [--follow]
    Show recent logs, optionally following new entries (polls db).

slog clear [--db ~/.slog/slog.db]
    Delete all rows from log_events and log_props. Prompts for confirmation
    unless --yes is passed.

slog status
    Print server info from pidfile (port, pid, db path).
    Exits 0 if server is running, 1 if not.
    With --port: prints just the port number (for scripting/skill use).
```

### Project Structure

```
slog/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts            # CLI entrypoint — arg parsing, command dispatch
│   ├── server.ts         # Fastify HTTP server (POST /log, GET /health)
│   ├── db.ts             # SQLite init, schema, connection management
│   ├── ingest.ts         # Log ingestion: parse input → log_events + log_props
│   ├── query.ts          # Query builder: filters → SQL → formatted output
│   └── types.ts          # Shared TypeScript types
├── skill.md              # Agent skill instructions
└── plans/
```

### Tech Choices

- **Runtime**: Bun — built-in SQLite (`bun:sqlite`), fast startup, compiles to standalone binary
- **HTTP**: Fastify — mature, fast, good TypeScript support, schema validation
- **SQLite**: `bun:sqlite` — built-in, no native deps, synchronous API, zero bundle overhead
- **IDs**: ULID — time-ordered, sortable, monotonic
- **Build**: `bun build --compile` — single binary output, no runtime deps

## Phases

- [x] Phase 1: Project scaffolding (package.json, tsconfig, bun setup, directory structure, deps)

- [x] Phase 2: Types and database layer (types.ts, db.ts — schema, connection, WAL mode)

- [x] Phase 3: Ingestion logic (ingest.ts — parse log input, insert events + typed properties, transactions)

- [x] Phase 4: HTTP server (server.ts — Fastify, POST /log accepting single/array, GET /health)

- [x] Phase 5: Query engine (query.ts — raw SQL passthrough, default query, plain-text errors)

- [x] Phase 6: CLI (cli.ts — serve/query/tail commands, pidfile management, arg parsing)

- [x] Phase 7: E2E CLI tests (full CLI test suite — every command exercised against isolated server/db instances)

- [x] Phase 8: Build and binary (bun build --compile, package.json scripts)

- [x] Phase 9: [skill.md](http://skill.md) (agent instructions: start server, log to it, query, debug patterns)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase Details

### Phase 1: Project Scaffolding

- `bun init` with appropriate fields
- Install deps: `fastify`, `ulid`
- Install dev deps: `typescript`, `@types/bun`
- `tsconfig.json` targeting ES2022, types includes `bun-types`
- Create `src/` directory

### Phase 2: Types and Database Layer

- `src/types.ts`:
  - `LogInput` — what the API accepts (`message` + arbitrary properties)
  - `LogEvent` — row shape for `log_events`
  - `LogProp` — row shape for `log_props`
  - (no QueryParams needed — queries are raw SQL)
- `src/db.ts`:
  - `initDb(dbPath)` — open `bun:sqlite`, create tables/indexes if not exist
  - WAL mode for concurrent reads (server writing while CLI queries)
  - Default db path: `~/.slog/slog.db`
  - Ensure `~/.slog/` directory exists on init

### Phase 3: Ingestion Logic

- `src/ingest.ts`:
  - `ingestLogs(db, input)` — accepts single object or array
  - For each log: generate ULID, extract `message` as event text, auto-add `timestamp`
  - All remaining fields become `log_props` rows with appropriate typed columns
  - Type detection: `typeof value === 'number'` → `value_number`, `boolean` → `value_bool`, else `value_string`
  - Flatten nested objects with dot notation: `{ http: { status: 500 } }` → key=`http.status`
  - Wrap batch in single transaction for performance

### Phase 4: HTTP Server

- `src/server.ts`:
  - Fastify instance with JSON body parsing
  - `POST /log` — accepts single object or array, calls `ingestLogs`, returns `{ ingested: N }`
  - `GET /health` — returns `{ ok: true }`
  - Bind to `127.0.0.1` only (local use)
  - Error handling: 400 for malformed input, 500 for db errors

### Phase 5: Query Engine

- `src/query.ts`:
  - `queryLogs(db, sql?)` — if SQL provided, execute it directly; otherwise run default query (recent 50 logs with props)
  - Default query: JOIN events + props, ORDER BY timestamp DESC, LIMIT 50
  - Output: human-readable table format to stdout
  - **All errors returned as plain text to stderr** — no JSON error wrappers. If a query has a syntax error or fails, just print the SQLite error message as-is so agents and humans can read it directly.

### Phase 6: CLI

- `src/cli.ts`:
  - Parse `process.argv` (or use a lightweight parser)
  - `slog serve`: check pidfile first — if server already running (process alive), print info and exit 0. Otherwise, fork/spawn a detached child process that runs the Fastify server, write pidfile, and exit the parent immediately. The child handles SIGINT/SIGTERM (cleanup pidfile). This makes `slog serve` safe to call from app startup scripts or agent skills without blocking.
  - `slog query`: read pidfile for db path (or use `--db`), run query, print results
  - `slog tail`: like query with `--since 5m --limit 20`, optionally `--follow` (poll every 1s)
  - `slog clear`: open db, DELETE FROM log_events + log_props in a transaction, VACUUM. Prompt for confirmation unless `--yes`.
  - `slog status`: read pidfile, verify process is alive (kill -0), print port/pid/db. `--port` flag for just the port number
  - Pidfile at `~/.slog/slog.pid` — JSON with `{ pid, port, db }`

### Phase 7: E2E CLI Tests

Full end-to-end test suite using `bun:test`. Every test spawns an isolated slog instance with a temp db and random port — no shared state, no cleanup conflicts.

**Test infrastructure** (`test/helpers.ts`):

- `spawnSlog(...args)` — runs `bun src/cli.ts` with given args, returns `{ stdout, stderr, exitCode }`
- `startIsolatedServer()` — picks a random port, creates a temp db file, starts `slog serve --port <random> --db <tmpfile>`, waits for health check, returns `{ port, dbPath, cleanup() }`
- `postLog(port, body)` — HTTP POST helper for ingesting logs during tests
- All temp files cleaned up in `afterEach`/`afterAll`

**Test cases** (`test/cli.test.ts`):

1. `slog serve`

   - Starts server on specified port, pidfile written with correct JSON
   - Health endpoint returns `{ ok: true }`
   - Second `slog serve` with same pidfile is idempotent (exits 0, prints info)
   - Server shuts down cleanly on SIGTERM, pidfile removed

2. `slog status`

   - With running server: exits 0, prints port/pid/db
   - `--port` flag: prints only the port number
   - With no server running: exits 1

3. `POST /log` **ingestion**

   - Single log object → 1 event + N props in db
   - Batch array → correct count of events
   - Properties typed correctly: string → `value_string`, number → `value_number`, boolean → `value_bool`
   - Nested objects flattened with dot notation (`http.status`)
   - Missing `message` field → 400
   - Malformed JSON → 400

4. `slog query`

   - No args: returns recent logs (default 50)
   - Custom SQL: `SELECT * FROM log_events` works
   - SQL syntax error → plain text error on stderr, non-zero exit
   - Query with property JOIN filters correctly

5. `slog tail`

   - Shows recent logs
   - `--follow`: new logs appear after posting (test with short timeout)

6. `slog clear`

   - `--yes`: deletes all events and props, exits 0
   - Verify db is empty after clear
   - Without `--yes`: prompts (test that it doesn't silently delete)

### Phase 8: Build and Binary

- `bun build --compile src/cli.ts --outfile slog`
- Package.json scripts: `build`, `dev`, `start`
- Test the binary works standalone

### Phase 9: [skill.md](http://skill.md)

Instructions for coding agents on **reading and querying logs** (agents are consumers, not producers):

- Ensure server is running: `slog serve` (idempotent — starts daemon if not already running, no-ops if already up)
- Check server status: `slog status` (or `slog status --port` for just the port)
- Query logs: `slog query "SELECT * FROM log_events e JOIN log_props p ON e.event_id = p.event_id WHERE p.key = 'level' AND p.value_string = 'error' ORDER BY e.timestamp DESC LIMIT 20"`
- Quick recent logs: `slog query` (no args = last 50)
- Tail logs: `slog tail --follow`
- Clear logs: `slog clear --yes`
- **Applications post logs, not agents.** The skill should explain that the app's code is responsible for POSTing to the slog server via an HTTP helper. The agent's role is to help instrument app code with that helper, and to query/read logs for debugging.
- How to instrument app code: show a minimal example of an HTTP POST helper the app would use
- Common query patterns: include example SQL for filtering by property, correlating by `request_id`, time-range searches
- Errors come back as plain text — no need to parse JSON error responses