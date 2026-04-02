# slog — Local Log Drain

HTTP log drain backed by SQLite. Apps post logs; agents and humans query them.

## Before You Start

1. **Start the server:** `slog serve` (idempotent)
2. **Add a logger helper** to the project if one doesn't exist. Pick the language that matches. The helper must:
   - **Set `timestamp` at log time** (epoch ms). The server falls back to receive time if omitted, which is wrong for batched logs.
   - **Batch logs.** Buffer entries, flush periodically or at a size threshold. `/log` accepts arrays.
   - **Be best-effort.** Swallow network errors silently.
   - **Gate on `SLOG=1`.** No-op when unset. Keeps slog out of production.

## Logger Helpers

### TypeScript / JavaScript

```typescript
const SLOG_ENABLED = process.env.SLOG === "1";
const SLOG_URL = "http://127.0.0.1:4526/log";

type LogEntry = { message: string; timestamp: number; [key: string]: unknown };
let buffer: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    await fetch(SLOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
  } catch {}
}

export function slog(message: string, props: Record<string, unknown> = {}) {
  if (!SLOG_ENABLED) return;
  buffer.push({ message, timestamp: Date.now(), ...props });
  if (buffer.length >= 50) flush();
  else if (!timer) timer = setTimeout(flush, 1000);
}

// SLOG=1 bun run app.ts
slog("Request handled", { source: "api", level: "info", status: 200 });
```

### Python

```python
import os, time, threading, requests

SLOG_ENABLED = os.environ.get("SLOG") == "1"
SLOG_URL = "http://127.0.0.1:4526/log"

_buffer, _lock, _timer = [], threading.Lock(), None

def _flush():
    global _timer
    with _lock:
        if not _buffer:
            _timer = None
            return
        batch, _buffer[:] = list(_buffer), []
        _timer = None
    try:
        requests.post(SLOG_URL, json=batch, timeout=2)
    except Exception:
        pass

def _schedule():
    global _timer
    if _timer is None:
        _timer = threading.Timer(1.0, _flush)
        _timer.daemon = True
        _timer.start()

def slog(message: str, **props):
    if not SLOG_ENABLED: return
    with _lock:
        _buffer.append({"message": message, "timestamp": int(time.time() * 1000), **props})
        if len(_buffer) >= 50: threading.Thread(target=_flush, daemon=True).start()
        else: _schedule()

# SLOG=1 python app.py
slog("Request handled", source="api", level="info", status=200)
```

### Go

```go
package slog

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"
)

var enabled = os.Getenv("SLOG") == "1"

type entry = map[string]any

var (
	mu     sync.Mutex
	buf    []entry
	tmr    *time.Timer
)

func flush() {
	mu.Lock()
	if len(buf) == 0 { mu.Unlock(); return }
	batch := buf; buf = nil; tmr = nil
	mu.Unlock()
	data, _ := json.Marshal(batch)
	http.Post("http://127.0.0.1:4526/log", "application/json", bytes.NewReader(data)) //nolint:errcheck
}

func Log(message string, props map[string]any) {
	if !enabled { return }
	e := entry{"message": message, "timestamp": time.Now().UnixMilli()}
	for k, v := range props { e[k] = v }
	mu.Lock()
	buf = append(buf, e)
	if len(buf) >= 50 { mu.Unlock(); go flush(); return }
	if tmr == nil { tmr = time.AfterFunc(time.Second, flush) }
	mu.Unlock()
}

// SLOG=1 go run .
```

### Shell (no batching)

```bash
slog_log() {
  [ "$SLOG" = "1" ] || return 0
  local msg="$1"; shift
  local ts=$(($(date +%s) * 1000))
  local json="{\"message\":\"$msg\",\"timestamp\":$ts"
  while [ $# -gt 0 ]; do json="$json,\"$1\":\"$2\""; shift 2; done
  curl -sf -X POST http://127.0.0.1:4526/log \
    -H "Content-Type: application/json" -d "$json}" >/dev/null 2>&1 &
}
# SLOG=1 ./deploy.sh
slog_log "deploy started" env production version v1.2.3
```

## Log Format

`POST /log` — single object or array. Must have a `message` string. All other fields become queryable properties. Nested objects are flattened with dot notation (`http.status`). Timestamps are epoch ms — set at creation time, not flush time.

```json
{"message": "Request handled", "timestamp": 1711929600000, "source": "api", "level": "info", "status": 200}
```

## Querying

```bash
slog query                    # last 50 logs with properties
slog tail                     # recent logs
slog tail --follow            # live tail
```

Custom SQL — `log_events` (event_id, event, timestamp) joined to `log_props` (event_id, key, value_string, value_number, value_bool):

```bash
slog query "SELECT e.event, e.timestamp, p.value_string as level FROM log_events e JOIN log_props p ON e.event_id = p.event_id WHERE p.key = 'level' AND p.value_string = 'error' ORDER BY e.timestamp DESC LIMIT 20"
```

## Management

```bash
slog serve          # start server (idempotent)
slog status         # pid, port, db path
slog status --port  # just the port
slog clear --yes    # delete all logs
```

Errors print to stderr as plain text. Server pidfile: `~/.slog/slog.pid`.
