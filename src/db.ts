import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { homedir } from "os";

export const DEFAULT_DB_PATH = `${homedir()}/.slog/slog.db`;
export const DEFAULT_PID_PATH = `${homedir()}/.slog/slog.pid`;
export const DEFAULT_PORT = 4526;

export function initDb(dbPath: string = DEFAULT_DB_PATH): Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, { create: true });

  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS log_events (
      event_id    TEXT PRIMARY KEY NOT NULL,
      event       TEXT NOT NULL,
      timestamp   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS log_props (
      event_id      TEXT NOT NULL,
      timestamp     INTEGER NOT NULL,
      key           TEXT NOT NULL,
      value_string  TEXT,
      value_number  REAL,
      value_bool    INTEGER,
      FOREIGN KEY (event_id) REFERENCES log_events(event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON log_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_props_event_id ON log_props(event_id);
    CREATE INDEX IF NOT EXISTS idx_props_key ON log_props(key);
    CREATE INDEX IF NOT EXISTS idx_props_event_key ON log_props(event_id, key);
  `);

  return db;
}
