#!/usr/bin/env bun
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { homedir } from "os";
import { initDb, DEFAULT_DB_PATH, DEFAULT_PID_PATH, DEFAULT_PORT } from "./db.ts";
import { createServer } from "./server.ts";
import { queryLogs } from "./query.ts";
import type { PidfileInfo } from "./types.ts";

const args = process.argv.slice(2);
const command = args[0];

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function getDbPath(): string {
  return parseFlag("--db") ?? DEFAULT_DB_PATH;
}

function getPort(): number {
  const p = parseFlag("--port");
  return p ? parseInt(p, 10) : DEFAULT_PORT;
}

function getPidPath(): string {
  return parseFlag("--pidfile") ?? DEFAULT_PID_PATH;
}

function readPidfile(pidPath: string): PidfileInfo | null {
  try {
    const content = readFileSync(pidPath, "utf-8");
    return JSON.parse(content) as PidfileInfo;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writePidfile(pidPath: string, info: PidfileInfo): void {
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, JSON.stringify(info, null, 2));
}

function removePidfile(pidPath: string): void {
  try {
    unlinkSync(pidPath);
  } catch {}
}

async function cmdServe() {
  const port = getPort();
  const dbPath = getDbPath();
  const pidPath = getPidPath();

  // Check if already running
  const existing = readPidfile(pidPath);
  if (existing && isProcessAlive(existing.pid)) {
    console.log(`slog server already running (pid=${existing.pid}, port=${existing.port}, db=${existing.db})`);
    process.exit(0);
  }

  // If --daemon flag, we're the child process — run the server
  if (hasFlag("--daemon")) {
    const db = initDb(dbPath);
    const server = createServer(db, port);

    const cleanup = () => {
      removePidfile(pidPath);
      server.stop();
      db.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    writePidfile(pidPath, { pid: process.pid, port, db: dbPath });
    console.log(`slog server started (pid=${process.pid}, port=${port}, db=${dbPath})`);
    return;
  }

  // Parent process: spawn daemonized child
  // Compiled binaries: process.argv[0] is "bun" and argv[1] is /$bunfs/... (virtual),
  // so use process.execPath (the real binary path) + the CLI args.
  // Dev mode (bun src/cli.ts): process.execPath is the bun binary, argv[1] is the script.
  const isCompiled = process.argv[1]?.startsWith("/$bunfs/");
  const cmd = isCompiled
    ? [process.execPath, ...args, "--daemon"]
    : [...process.argv, "--daemon"];
  const child = Bun.spawn(cmd, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  // Unref so parent can exit
  child.unref();

  // Wait briefly for the child to start and write pidfile
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await Bun.sleep(100);
    const info = readPidfile(pidPath);
    if (info && isProcessAlive(info.pid)) {
      console.log(`slog server started (pid=${info.pid}, port=${info.port}, db=${info.db})`);
      process.exit(0);
    }
  }

  // Check stderr for errors
  const stderrText = await new Response(child.stderr).text();
  if (stderrText) {
    console.error(`Failed to start slog server: ${stderrText}`);
  } else {
    console.error("Failed to start slog server: timed out waiting for pidfile");
  }
  process.exit(1);
}

function cmdQuery() {
  const dbPath = getDbPath();
  const pidPath = getPidPath();

  // Try pidfile for db path if no --db specified
  let resolvedDb = dbPath;
  if (!hasFlag("--db")) {
    const info = readPidfile(pidPath);
    if (info) {
      resolvedDb = info.db;
    }
  }

  if (!existsSync(resolvedDb)) {
    console.error(`Database not found: ${resolvedDb}`);
    console.error("Is the slog server running? Try: slog serve");
    process.exit(1);
  }

  const db = initDb(resolvedDb);

  // Collect SQL from remaining args (skip command name and flags)
  const sqlParts: string[] = [];
  let skipNext = false;
  for (let i = 1; i < args.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (args[i] === "--db" || args[i] === "--pidfile") {
      skipNext = true;
      continue;
    }
    sqlParts.push(args[i]!);
  }
  const sql = sqlParts.join(" ").trim() || undefined;

  try {
    const result = queryLogs(db, sql);
    console.log(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  } finally {
    db.close();
  }
}

function cmdTail() {
  const dbPath = getDbPath();
  const pidPath = getPidPath();
  const follow = hasFlag("--follow") || hasFlag("-f");

  let resolvedDb = dbPath;
  if (!hasFlag("--db")) {
    const info = readPidfile(pidPath);
    if (info) resolvedDb = info.db;
  }

  if (!existsSync(resolvedDb)) {
    console.error(`Database not found: ${resolvedDb}`);
    process.exit(1);
  }

  const db = initDb(resolvedDb);

  const tailQuery = `
    SELECT
      e.event_id,
      e.event,
      e.timestamp,
      group_concat(p.key || '=' || coalesce(p.value_string, cast(p.value_number as text), case when p.value_bool is not null then case p.value_bool when 1 then 'true' else 'false' end end, 'null'), ', ') as properties
    FROM log_events e
    LEFT JOIN log_props p ON e.event_id = p.event_id
    GROUP BY e.event_id
    ORDER BY e.timestamp DESC
    LIMIT 20
  `;

  let lastSeenId: string | null = null;

  const printRows = (rows: Record<string, unknown>[]) => {
    for (const row of rows.reverse()) {
      const ts = new Date(row.timestamp as number).toISOString();
      const props = row.properties ? ` [${row.properties}]` : "";
      console.log(`${ts}  ${row.event}${props}`);
    }
  };

  // Initial fetch
  const rows = db.prepare(tailQuery).all() as Record<string, unknown>[];
  printRows(rows);
  if (rows.length > 0) {
    lastSeenId = rows[0]!.event_id as string;
  }

  if (!follow) {
    db.close();
    return;
  }

  // Follow mode: poll every 1s
  const followQuery = `
    SELECT
      e.event_id,
      e.event,
      e.timestamp,
      group_concat(p.key || '=' || coalesce(p.value_string, cast(p.value_number as text), case when p.value_bool is not null then case p.value_bool when 1 then 'true' else 'false' end end, 'null'), ', ') as properties
    FROM log_events e
    LEFT JOIN log_props p ON e.event_id = p.event_id
    WHERE e.event_id > ?
    GROUP BY e.event_id
    ORDER BY e.timestamp ASC
  `;

  const interval = setInterval(() => {
    try {
      const newRows = db.prepare(followQuery).all(lastSeenId ?? "") as Record<string, unknown>[];
      if (newRows.length > 0) {
        for (const row of newRows) {
          const ts = new Date(row.timestamp as number).toISOString();
          const props = row.properties ? ` [${row.properties}]` : "";
          console.log(`${ts}  ${row.event}${props}`);
        }
        lastSeenId = newRows[newRows.length - 1]!.event_id as string;
      }
    } catch {
      // db might be busy, skip this tick
    }
  }, 1000);

  const cleanup = () => {
    clearInterval(interval);
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function cmdClear() {
  const dbPath = getDbPath();
  const yes = hasFlag("--yes") || hasFlag("-y");

  if (!existsSync(dbPath)) {
    console.log("No database found. Nothing to clear.");
    process.exit(0);
  }

  if (!yes) {
    console.log("This will delete all logs. Pass --yes to confirm.");
    process.exit(1);
  }

  const db = initDb(dbPath);
  db.exec("DELETE FROM log_props");
  db.exec("DELETE FROM log_events");
  db.exec("VACUUM");
  db.close();
  console.log("All logs cleared.");
}

function cmdStatus() {
  const pidPath = getPidPath();
  const info = readPidfile(pidPath);

  if (!info) {
    console.error("slog server is not running (no pidfile found)");
    process.exit(1);
  }

  if (!isProcessAlive(info.pid)) {
    removePidfile(pidPath);
    console.error("slog server is not running (stale pidfile removed)");
    process.exit(1);
  }

  if (hasFlag("--port")) {
    console.log(info.port);
    process.exit(0);
  }

  console.log(`slog server running:`);
  console.log(`  pid:  ${info.pid}`);
  console.log(`  port: ${info.port}`);
  console.log(`  db:   ${info.db}`);
}

function printUsage() {
  console.log(`Usage: slog <command> [options]

Commands:
  serve   Start the HTTP log ingestion server
  query   Run a SQL query against the log database
  tail    Show recent logs (--follow to watch)
  clear   Delete all logs (--yes to confirm)
  status  Show server info

Options:
  --port <port>    Server port (default: ${DEFAULT_PORT})
  --db <path>      Database path (default: ${DEFAULT_DB_PATH})
  --pidfile <path> Pidfile path (default: ${DEFAULT_PID_PATH})`);
}

switch (command) {
  case "serve":
    await cmdServe();
    break;
  case "query":
    cmdQuery();
    break;
  case "tail":
    cmdTail();
    break;
  case "clear":
    cmdClear();
    break;
  case "status":
    cmdStatus();
    break;
  default:
    printUsage();
    process.exit(command ? 1 : 0);
}
