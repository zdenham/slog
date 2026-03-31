import type { Database } from "bun:sqlite";

const DEFAULT_QUERY = `
SELECT
  e.event_id,
  e.event,
  e.timestamp,
  group_concat(p.key || '=' || coalesce(p.value_string, cast(p.value_number as text), case when p.value_bool is not null then case p.value_bool when 1 then 'true' else 'false' end end, 'null'), ', ') as properties
FROM log_events e
LEFT JOIN log_props p ON e.event_id = p.event_id
GROUP BY e.event_id
ORDER BY e.timestamp DESC
LIMIT 50
`;

export function queryLogs(db: Database, sql?: string): string {
  const query = sql?.trim() || DEFAULT_QUERY;

  try {
    const stmt = db.prepare(query);
    const rows = stmt.all();

    if (rows.length === 0) {
      return "No results.";
    }

    return formatTable(rows as Record<string, unknown>[]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}

function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  const columns = Object.keys(rows[0]!);

  // Calculate column widths
  const widths = columns.map((col) => {
    const maxDataWidth = rows.reduce((max, row) => {
      const val = String(row[col] ?? "");
      return Math.max(max, val.length);
    }, 0);
    return Math.max(col.length, Math.min(maxDataWidth, 60));
  });

  // Header
  const header = columns.map((col, i) => col.padEnd(widths[i]!)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  // Rows
  const dataRows = rows.map((row) =>
    columns
      .map((col, i) => {
        const val = String(row[col] ?? "");
        return val.length > 60
          ? val.slice(0, 57) + "..."
          : val.padEnd(widths[i]!);
      })
      .join("  ")
  );

  return [header, separator, ...dataRows].join("\n");
}
