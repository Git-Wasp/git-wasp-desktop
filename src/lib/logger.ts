import { invoke } from "@tauri-apps/api/core";

type Level = "error" | "warn" | "info" | "debug";

// Bridge frontend logs into the backend log pipeline (file + stdout) so the
// unified log captures both sides. Best-effort: logging must never throw into
// the caller, and never carry PII.
function send(level: Level, message: string) {
  // Best-effort and fully defensive: never let a logging failure (a rejected
  // promise, or invoke being unavailable) surface to the caller.
  try {
    void Promise.resolve(invoke("frontend_log", { level, message })).catch(() => {});
  } catch {
    /* logging is best-effort */
  }
}

export const logger = {
  error: (message: string) => send("error", message),
  warn: (message: string) => send("warn", message),
  info: (message: string) => send("info", message),
  debug: (message: string) => send("debug", message),
};

/**
 * Log a failed operation and return its message (so callers can also surface it
 * to the user). Centralises the `unknown`→string normalisation we'd otherwise
 * repeat at every catch site.
 */
export function logOperationError(operation: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`${operation} failed: ${message}`);
  return message;
}
