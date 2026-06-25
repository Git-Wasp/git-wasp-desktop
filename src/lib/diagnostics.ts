import { invoke } from "@tauri-apps/api/core";

const PREF_KEY = "diagnostics";

export interface DiagnosticsInfo {
  /** Whether diagnostic (debug-level) logging is currently active. */
  enabled: boolean;
  /** Directory holding the log file. */
  logDir: string;
  /** The log file itself. */
  logFile: string;
}

/**
 * The user's persisted diagnostics override, or `null` to follow the build
 * default (on for dev builds, off for release). We only store a value once the
 * user explicitly chooses one, so a fresh install honours the build default.
 */
export function loadDiagnosticsPref(): boolean | null {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === "on") return true;
    if (v === "off") return false;
    return null;
  } catch {
    return null;
  }
}

function saveDiagnosticsPref(enabled: boolean) {
  try {
    localStorage.setItem(PREF_KEY, enabled ? "on" : "off");
  } catch {
    /* persistence is best-effort */
  }
}

/**
 * On startup, re-apply the user's persisted override (if any) to the backend.
 * With no stored preference this is a no-op, leaving the build default in place.
 */
export async function applyDiagnosticsPref(): Promise<void> {
  const pref = loadDiagnosticsPref();
  if (pref !== null) {
    await invoke("set_diagnostics", { enabled: pref });
  }
}

/** Toggle diagnostics and persist the choice. */
export async function setDiagnostics(enabled: boolean): Promise<void> {
  saveDiagnosticsPref(enabled);
  await invoke("set_diagnostics", { enabled });
}

export function getDiagnosticsInfo(): Promise<DiagnosticsInfo> {
  return invoke<DiagnosticsInfo>("get_diagnostics_info");
}

export function openLogDir(): Promise<void> {
  return invoke("open_log_dir");
}
