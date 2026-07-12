import { useState } from "react";
import { Button } from "../ui/Button";

interface SquashDialogProps {
  /** How many commits are being squashed together. */
  count: number;
  /** Pre-filled message — the selected commits' messages joined, oldest first. */
  initialMessage: string;
  /** Perform the squash. Rejects with an error to surface (dialog stays open). */
  onConfirm: (message: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Collects the commit message for squashing a run of unpushed commits into one.
 * Floats over the app (the graph stays mounted behind it). The message textarea
 * is pre-seeded with the selected commits' messages joined oldest-first, matching
 * git's default squash message, and is freely editable before confirming.
 */
export function SquashDialog({ count, initialMessage, onConfirm, onCancel }: SquashDialogProps) {
  const [message, setMessage] = useState(initialMessage);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canConfirm = message.trim() !== "" && !busy;

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(message.trim());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Squash commits"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 460,
          padding: "var(--space-5)",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-md)",
          color: "var(--color-text-primary)",
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: "var(--space-2)",
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Squash {count} commits
        </h2>
        <p
          style={{
            margin: 0,
            marginBottom: "var(--space-3)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            lineHeight: "var(--line-height-normal)",
          }}
        >
          The selected commits will be combined into a single commit. Edit the message below.
        </p>

        <textarea
          aria-label="Squash commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={8}
          autoFocus
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void confirm();
            }
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "vertical",
            padding: "var(--space-2)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-family-mono)",
            background: "var(--color-bg-input)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-text-primary)",
            outline: "none",
          }}
        />

        {error && (
          <div
            role="alert"
            style={{
              marginTop: "var(--space-2)",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            justifyContent: "flex-end",
            marginTop: "var(--space-4)",
          }}
        >
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void confirm()} loading={busy} disabled={!canConfirm}>
            Squash
          </Button>
        </div>
      </div>
    </div>
  );
}
