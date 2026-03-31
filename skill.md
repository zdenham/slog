# slog — Local Log Drain

slog is a local log drain that accepts logs over HTTP and stores them in SQLite. Applications post logs to the server; agents and humans query them.

## Quick Start

```bash
# Ensure the server is running (idempotent — safe to call repeatedly)
slog serve

# Check server status
slog status

# View recent logs
slog query

# Tail logs (live)
slog tail --follow
```

## Reading Logs

### Default query (last 50 logs with properties)

```bash
slog query
```

### Custom SQL queries

```bash
# Recent errors
slog query "SELECT e.event, e.timestamp, p.value_string as level FROM log_events e JOIN log_props p ON e.event_id = p.event_id WHERE p.key = 'level' AND p.value_string = 'error' ORDER BY e.timestamp DESC LIMIT 20"

# Filter by source
slog query "SELECT e.event FROM log_events e JOIN log_props p ON e.event_id = p.event_id WHERE p.key = 'source' AND p.value_string = 'api' ORDER BY e.timestamp DESC LIMIT 20"

# Correlate by request_id
slog query "SELECT e.event, e.timestamp FROM log_events e JOIN log_props p ON e.event_id = p.event_id WHERE p.key = 'request_id' AND p.value_string = 'abc123' ORDER BY e.timestamp ASC"

# Time range (last hour)
slog query "SELECT * FROM log_events WHERE timestamp > (strftime('%s','now') * 1000 - 3600000) ORDER BY timestamp DESC"

# Count by level
slog query "SELECT p.value_string as level, count(*) as count FROM log_props p WHERE p.key = 'level' GROUP BY p.value_string"
```

### Schema reference

```sql
-- log_events: one row per log entry
--   event_id (TEXT, ULID), event (TEXT, message), timestamp (INTEGER, epoch ms)

-- log_props: EAV properties for each event
--   event_id (TEXT), key (TEXT), value_string (TEXT), value_number (REAL), value_bool (INTEGER)
```

## Managing Logs

```bash
# Clear all logs
slog clear --yes

# Check if server is running
slog status

# Get just the port (for scripting)
slog status --port
```

## How Applications Post Logs

Applications instrument their own code with an HTTP POST to the slog server. The agent's role is to help instrument app code, not to post logs directly.

### Minimal HTTP helper example

```typescript
const SLOG_PORT = 4526; // default port

async function slog(message: string, props: Record<string, unknown> = {}) {
  try {
    await fetch(`http://127.0.0.1:${SLOG_PORT}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, ...props }),
    });
  } catch {
    // slog is best-effort — don't crash the app if logging fails
  }
}

// Usage
await slog("Request handled", { source: "api", level: "info", http: { status: 200, method: "GET" } });
```

Nested objects are flattened with dot notation (e.g., `http.status`). Property types are preserved: strings, numbers, and booleans are stored in typed columns for correct querying.

## Error Handling

Query errors are returned as plain text on stderr — no JSON parsing needed. If a SQL query has a syntax error, slog prints the SQLite error message directly.

## Port & Pidfile

The server writes its info to `~/.slog/slog.pid`:

```json
{ "pid": 12345, "port": 4526, "db": "/Users/you/.slog/slog.db" }
```

Check this file before starting a new server. `slog serve` is idempotent — it checks the pidfile and exits cleanly if a server is already running.
