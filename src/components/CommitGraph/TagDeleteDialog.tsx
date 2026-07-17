import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

/**
 * Confirms deleting a tag. When the tag is also on the remote, offers a checkbox
 * (default on) to delete it from the remote in the same step.
 */
export function TagDeleteDialog({
  name,
  onRemote,
  onConfirm,
  onCancel,
}: {
  name: string;
  onRemote: boolean;
  onConfirm: (alsoRemote: boolean) => void;
  onCancel: () => void;
}) {
  const [alsoRemote, setAlsoRemote] = useState(onRemote);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Delete tag"
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
        background: "var(--color-overlay)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 400,
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
            marginBottom: "var(--space-3)",
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Delete tag
        </h2>
        <p style={{ margin: 0, marginBottom: "var(--space-3)", fontSize: "var(--font-size-sm)" }}>
          Delete tag <code>{name}</code>?
        </p>

        {onRemote && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              marginBottom: "var(--space-3)",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={alsoRemote}
              onChange={(e) => setAlsoRemote(e.target.checked)}
            />
            Also delete from the remote
          </label>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => onConfirm(onRemote && alsoRemote)}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
