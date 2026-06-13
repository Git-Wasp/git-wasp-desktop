import type { ReactNode, CSSProperties } from "react";
import { usePersistedBoolean } from "../../lib/usePersistedBoolean";

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 var(--space-3)",
};

const toggleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
  flex: 1,
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
  textAlign: "left",
};

const titleStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

/**
 * A sidebar section with a collapsible body. The header (chevron + title)
 * toggles visibility; an optional `action` renders at the right of the header
 * and is not part of the toggle. Collapsed state persists per `id`.
 */
export function CollapsibleSection({
  id,
  title,
  action,
  children,
  bodyStyle,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  bodyStyle?: CSSProperties;
}) {
  const [collapsed, setCollapsed] = usePersistedBoolean(`section-collapsed:${id}`, false);

  return (
    <div
      style={{
        borderBottom: "1px solid var(--color-border-subtle)",
        padding: "var(--space-2) 0",
      }}
    >
      <div style={{ ...headerRowStyle, marginBottom: collapsed ? 0 : "var(--space-1)" }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={title}
          style={toggleStyle}
        >
          <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", width: 10 }}>
            {collapsed ? "▸" : "▾"}
          </span>
          <span style={titleStyle}>{title}</span>
        </button>
        {action}
      </div>
      {!collapsed && <div style={bodyStyle}>{children}</div>}
    </div>
  );
}
