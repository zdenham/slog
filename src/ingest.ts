import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import type { LogInput } from "./types.ts";

/** Flatten nested objects with dot notation keys */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = ""
): Array<{ key: string; value: unknown }> {
  const result: Array<{ key: string; value: unknown }> = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      result.push(...flattenObject(v as Record<string, unknown>, fullKey));
    } else {
      result.push({ key: fullKey, value: v });
    }
  }
  return result;
}

/** Ingest one or many log entries into the database */
export function ingestLogs(
  db: Database,
  input: LogInput | LogInput[]
): number {
  const entries = Array.isArray(input) ? input : [input];

  const insertEvent = db.prepare(
    "INSERT INTO log_events (event_id, event, timestamp) VALUES (?, ?, ?)"
  );
  const insertProp = db.prepare(
    "INSERT INTO log_props (event_id, timestamp, key, value_string, value_number, value_bool) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const tx = db.transaction(() => {
    for (const entry of entries) {
      const eventId = ulid();
      const timestamp = entry.timestamp ?? Date.now();
      const message = entry.message;

      insertEvent.run(eventId, message, timestamp);

      // Extract properties (everything except message and timestamp)
      const { message: _, timestamp: __, ...props } = entry;
      const flattened = flattenObject(props as Record<string, unknown>);

      for (const { key, value } of flattened) {
        let valueString: string | null = null;
        let valueNumber: number | null = null;
        let valueBool: number | null = null;

        if (typeof value === "boolean") {
          valueBool = value ? 1 : 0;
        } else if (typeof value === "number") {
          valueNumber = value;
        } else if (value != null) {
          valueString = String(value);
        }

        insertProp.run(
          eventId,
          timestamp,
          key,
          valueString,
          valueNumber,
          valueBool
        );
      }
    }
  });

  tx();
  return entries.length;
}
