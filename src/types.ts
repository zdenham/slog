/** What the API accepts — message + arbitrary properties */
export interface LogInput {
  message: string;
  timestamp?: number;
  [key: string]: unknown;
}

/** Row shape for log_events table */
export interface LogEvent {
  event_id: string;
  event: string;
  timestamp: number;
}

/** Row shape for log_props table */
export interface LogProp {
  event_id: string;
  timestamp: number;
  key: string;
  value_string: string | null;
  value_number: number | null;
  value_bool: number | null;
}

/** Pidfile JSON shape */
export interface PidfileInfo {
  pid: number;
  port: number;
  db: string;
}
