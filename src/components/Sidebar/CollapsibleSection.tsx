import type { ReactNode, CSSProperties } from "react";
import { usePersistedBoolean } from "../../lib/usePersistedBoolean";
import { usePersistedSize } from "../../lib/usePersistedSize";
import { ResizeHandle } from "../common/ResizeHandle";

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

// Bounds for a resizable section body (px). The outer sidebar scrolls, so the
// max is generous; the min keeps a couple of rows visible.
const RESIZE_MIN_HEIGHT = 60;
const RESIZE_MAX_HEIGHT = 800;

/**
 * A sidebar section with a collapsible body. The header (chevron + title)
 * toggles visibility; an optional `action` renders at the right of the header
 * and is not part of the toggle. Collapsed state persists per `id`.
 *
 * When `resizable` is set the (expanded) body is capped at a drag-resizable
 * max-height with its own scroll, and a draggable divider replaces the bottom
 * border — drag it up/down to size the section. Using max-height (not a fixed
 * height) means a short list stays compact instead of leaving an empty gap,
 * while a long list scrolls within the chosen cap. The cap persists per `id`.
 */
export function CollapsibleSection({
  id,
  title,
  action,
  children,
  bodyStyle,
  resizable = false,
  defaultHeight = 180,
  containsSections = false,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  /** Static content, or a render function receiving the section's current
   *  (resizable) body-height cap — used by virtualised lists that own their own
   *  scroll and need to size themselves to that cap instead of the section's
   *  `max-height` + `overflow` wrapper. */
  children: ReactNode | ((maxBodyHeight: number) => ReactNode);
  bodyStyle?: CSSProperties;
  resizable?: boolean;
  defaultHeight?: number;
  /** This section groups nested sections that draw their own dividers, so its
   *  own bottom border is suppressed while expanded (it would read doubled) but
   *  kept while collapsed (to separate the lone header from the next section). */
  containsSections?: boolean;
}) {
  const [collapsed, setCollapsed] = usePersistedBoolean(`section-collapsed:${id}`, false);
  const [height, setHeight] = usePersistedSize(
    `section-height:${id}`,
    defaultHeight,
    RESIZE_MIN_HEIGHT,
    RESIZE_MAX_HEIGHT,
  );

  // Expanded + resizable: the drag handle is the section's divider, so drop the
  // bottom border (otherwise the divider reads doubled).
  const showResizer = resizable && !collapsed;
  // Suppress the bottom border when the divider is otherwise provided: by the
  // resize handle, or (for a group) by the last nested subsection.
  const hideBorder = showResizer || (containsSections && !collapsed);

  return (
    <div
      style={{
        borderBottom: hideBorder ? "none" : "1px solid var(--color-border-default)",
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
      {!collapsed &&
        (typeof children === "function" ? (
          // The child owns its own (virtualised) scroll; hand it the resizable
          // cap and skip the max-height/overflow wrapper so scroll isn't doubled.
          <div style={bodyStyle}>{children(height)}</div>
        ) : (
          <div style={resizable ? { ...bodyStyle, maxHeight: height, overflowY: "auto" } : bodyStyle}>
            {children}
          </div>
        ))}
      {showResizer && (
        <ResizeHandle
          orientation="horizontal"
          ariaLabel={`Resize ${title} section`}
          onResize={(dy) => setHeight((h) => h + dy)}
          style={{ marginTop: "var(--space-2)" }}
        />
      )}
    </div>
  );
}
