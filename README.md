# slog

A local log drain that accepts logs over HTTP, stores them in SQLite, and lets you query them from the CLI. Ships as a single Bun-compiled binary.

## Quick Start

```bash
# Start the server (daemonizes, idempotent — safe to call repeatedly)
slog serve

# Post a log from your app
curl -X POST http://localhost:4526/log \
  -H 'Content-Type: application/json' \
  -d '{"message": "request failed", "level": "error", "http.status": 500}'

# Query recent logs
slog query

# Query with SQL
slog query "SELECT e.*, p.key, p.value_string FROM log_events e JOIN log_props p ON e.event_id = p.event_id WHERE p.key = 'level' AND p.value_string = 'error' ORDER BY e.timestamp DESC LIMIT 20"

# Tail logs
slog tail --follow

# Clear all logs
slog clear --yes
```

## How It Works

```
                                    ┌──────────────┐
┌──────────────┐   POST /log       │   slog.db    │
│  Application │ ──────────→ slog  │──────────────│
│  (your code) │          :4526    │  log_events  │
└──────────────┘                   │  log_props   │
                                   └──────┬───────┘
┌──────────────┐                          │
│ Terminal or  │  slog query          ────┘
│ Coding Agent │  (reads db directly)
└──────────────┘
```

Applications POST structured logs to the slog server. The server stores each log as an event with typed properties in SQLite. Querying reads the database directly — no server needed.

### Storage Model

Logs are stored in an EAV (entity-attribute-value) format. A log like:

```json
{"message": "Request failed", "level": "error", "source": "api", "http.status": 500}
```

Becomes one row in `log_events` (the message + a ULID + timestamp) and three rows in `log_props` — one per property, with typed columns (`value_string`, `value_number`, `value_bool`) so numeric queries work correctly.

Nested objects are flattened with dot notation: `{ http: { status: 500 } }` becomes key `http.status`.

## CLI Commands

| Command | Description |
|---------|-------------|
| `slog serve [--port 4526] [--db PATH]` | Start the HTTP server as a background daemon |
| `slog query [--db PATH] [SQL]` | Run a SQL query against the log database (default: recent 50 logs) |
| `slog tail [--db PATH] [--follow]` | Show recent logs, optionally following new entries |
| `slog clear [--db PATH] [--yes]` | Delete all logs |
| `slog status [--port]` | Print server info (port, pid, db path) |

## HTTP API

**POST /log** — Ingest logs (single object or array)

```json
{"message": "something happened", "level": "info", "source": "agent"}
```

**GET /health** — Returns `{"ok": true}`

## Development

```bash
bun install
bun run dev serve          # run the server in dev mode
bun test                   # run tests
bun run build              # compile to standalone binary
```

## Port Discovery

The server writes its port to `~/.slog/slog.pid`:

```json
{"pid": 12345, "port": 4526, "db": "/Users/you/.slog/slog.db"}
```

The CLI reads this file to locate the database. You can also pass `--db` directly.
