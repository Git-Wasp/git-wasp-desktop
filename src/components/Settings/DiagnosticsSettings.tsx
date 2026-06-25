import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import {
  getDiagnosticsInfo,
  openLogDir,
  setDiagnostics,
  type DiagnosticsInfo,
} from "../../lib/diagnostics";

const descriptionStyle: React.CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
  marginBottom: "var(--space-3)",
  maxWidth: 560,
};

const pathStyle: React.CSSProperties = {
  fontFamily: "var(--font-family-mono)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2)",
  wordBreak: "break-all",
  userSelect: "text",
};

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        cursor: "pointer",
        fontSize: "var(--font-size-sm)",
        color: "var(--color-text-primary)",
      }}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/**
 * Settings → Diagnostics. Toggles diagnostic (verbose) logging and shows where
 * the log file lives, with a button to reveal it in the file manager. Diagnostic
 * logging is on by default in dev builds and off in release; the toggle persists
 * the user's choice across restarts.
 */
export function DiagnosticsSettings() {
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDiagnosticsInfo().then(setInfo, (e) => setError(String(e)));
  }, []);

  const handleToggle = async (next: boolean) => {
    await setDiagnostics(next);
    setInfo((prev) => (prev ? { ...prev, enabled: next } : prev));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <p style={descriptionStyle}>
        Diagnostic logging records detailed information about git operations to
        help track down problems. It never stores personal data such as file
        contents or credentials. Enable it before reproducing an issue, then
        share the log file.
      </p>

      <Toggle
        checked={info?.enabled ?? false}
        onChange={handleToggle}
        label="Enable diagnostic logging"
      />

      {info && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
            Log file
          </span>
          <code style={pathStyle}>{info.logFile}</code>
          <div>
            <Button type="button" onClick={() => openLogDir()}>
              Open log folder
            </Button>
          </div>
        </div>
      )}

      {error && (
        <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-danger)" }}>
          Couldn’t read diagnostics info: {error}
        </span>
      )}
    </div>
  );
}
