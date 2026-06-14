import type { ReactNode } from "react";

/** A centred, muted placeholder for empty panels, with an optional action. */
export function EmptyState({
  message,
  icon,
  action,
}: {
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        height: "100%",
        padding: "var(--space-5)",
        textAlign: "center",
        color: "var(--color-text-muted)",
        fontSize: "var(--font-size-sm)",
      }}
    >
      {icon && <div style={{ fontSize: "var(--font-size-2xl)", opacity: 0.7 }}>{icon}</div>}
      <div>{message}</div>
      {action}
    </div>
  );
}
