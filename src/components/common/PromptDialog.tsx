import { useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface PromptDialogProps {
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  title,
  label,
  initialValue = "",
  confirmLabel = "Create",
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0;

  const confirm = () => {
    if (canConfirm) onConfirm(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      role="dialog"
      aria-label={title}
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
          width: 360,
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
          {title}
        </h2>

        {label && (
          <label
            style={{
              display: "block",
              marginBottom: "var(--space-1)",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-secondary)",
            }}
          >
            {label}
          </label>
        )}

        <Input
          autoFocus
          fullWidth
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ marginBottom: "var(--space-3)" }}
        />

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="secondary" fullWidth onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth disabled={!canConfirm} onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
