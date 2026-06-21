import type { CSSProperties } from "react";
import {
  useToastStore,
  type Toast,
  type ToastPlacement,
  type ToastVariant,
} from "../../stores/toastStore";
import { IconButton } from "./IconButton";

const VARIANT_COLOR: Record<ToastVariant, string> = {
  success: "var(--color-success)",
  error: "var(--color-danger)",
  warning: "var(--color-warning)",
  info: "var(--color-accent-primary)",
};

/**
 * Fixed-position styles for the stack, derived from the chosen placement. The
 * stack hugs the chosen corner/edge; for a bottom placement it grows upward
 * (column-reverse) so the newest toast sits nearest the edge.
 */
function containerStyle(placement: ToastPlacement): CSSProperties {
  const { vertical, horizontal } = placement;
  const base: CSSProperties = {
    position: "fixed",
    zIndex: 200,
    display: "flex",
    flexDirection: vertical === "bottom" ? "column-reverse" : "column",
    gap: "var(--space-2)",
    maxWidth: "min(360px, calc(100vw - var(--space-6)))",
    // The container itself shouldn't swallow clicks — only the toasts do.
    pointerEvents: "none",
  };

  if (horizontal === "left") base.left = "var(--space-4)";
  else base.right = "var(--space-4)";

  if (vertical === "top") {
    base.top = "var(--space-4)";
  } else if (vertical === "bottom") {
    base.bottom = "var(--space-4)";
  } else {
    base.top = "50%";
    base.transform = "translateY(-50%)";
  }
  return base;
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const accent = VARIANT_COLOR[toast.variant];
  return (
    <div
      // Errors interrupt; the rest are polite status updates.
      role={toast.variant === "error" ? "alert" : "status"}
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-2)",
        padding: "var(--space-3)",
        background: "var(--color-bg-panel)",
        border: "1px solid var(--color-border-subtle)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-lg)",
        color: "var(--color-text-primary)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title && (
          <div
            style={{
              fontSize: "var(--font-size-sm)",
              fontWeight: "var(--font-weight-semibold)",
              marginBottom: "2px",
            }}
          >
            {toast.title}
          </div>
        )}
        <div
          style={{
            fontSize: "var(--font-size-sm)",
            color: toast.title ? "var(--color-text-secondary)" : "var(--color-text-primary)",
            overflowWrap: "anywhere",
          }}
        >
          {toast.message}
        </div>
      </div>
      <IconButton
        aria-label="Dismiss notification"
        title="Dismiss"
        onClick={() => onDismiss(toast.id)}
        style={{ flexShrink: 0 }}
      >
        ✕
      </IconButton>
    </div>
  );
}

/**
 * Renders the active toasts in the user's chosen corner. Mounted once at the app
 * root; everything else just calls the toast store.
 */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const placement = useToastStore((s) => s.placement);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div style={containerStyle(placement)} aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}
