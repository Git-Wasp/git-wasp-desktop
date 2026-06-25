import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** A small caret that flips when the dropdown is open. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      data-icon="caret"
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{
        flexShrink: 0,
        opacity: 0.7,
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform var(--duration-fast) var(--ease-default)",
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const panelStyle = (align: "left" | "right", minWidth: number): CSSProperties => ({
  position: "absolute",
  top: "100%",
  [align]: 0,
  marginTop: 2,
  minWidth,
  maxHeight: 360,
  overflowY: "auto",
  padding: "var(--space-1)",
  background: "var(--color-bg-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-md)",
  color: "var(--color-text-primary)",
  zIndex: 200,
});

/**
 * A trigger button with an anchored popup panel, used for the repo and branch
 * pickers in the NavBar. Manages its own open state and closes on outside
 * click or Escape. The panel content is a render-prop receiving `close` so an
 * item selection can dismiss the menu.
 */
export function Dropdown({
  trigger,
  ariaLabel,
  disabled = false,
  panelMinWidth = 220,
  align = "left",
  triggerStyle,
  onOpenChange,
  children,
}: {
  trigger: ReactNode;
  ariaLabel: string;
  disabled?: boolean;
  panelMinWidth?: number;
  align?: "left" | "right";
  triggerStyle?: CSSProperties;
  /** Notified whenever the panel opens or closes (e.g. to reset a filter). */
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, rawSetOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    rawSetOpen((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (value !== prev) onOpenChange?.(value);
      return value;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", minWidth: 0 }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--color-bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = open ? "var(--color-bg-hover)" : "transparent";
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          maxWidth: 240,
          minWidth: 0,
          height: "var(--control-height-md)",
          padding: "0 var(--space-2)",
          background: open ? "var(--color-bg-hover)" : "transparent",
          border: "1px solid transparent",
          borderRadius: "var(--radius-sm)",
          color: "var(--color-text-primary)",
          fontSize: "var(--font-size-sm)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
          ...triggerStyle,
        }}
      >
        {trigger}
        <Caret open={open} />
      </button>
      {open && (
        <div role="menu" style={panelStyle(align, panelMinWidth)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A selectable row inside a Dropdown panel. */
export function DropdownItem({
  children,
  onSelect,
  active = false,
  title,
  leading,
}: {
  children: ReactNode;
  onSelect: () => void;
  active?: boolean;
  title?: string;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      onClick={onSelect}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--color-bg-elevated)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? "var(--color-bg-selected)" : "transparent";
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "100%",
        textAlign: "left",
        padding: "var(--space-1) var(--space-2)",
        fontSize: "var(--font-size-sm)",
        background: active ? "var(--color-bg-selected)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text-primary)",
        cursor: "pointer",
      }}
    >
      {leading !== undefined && (
        <span style={{ display: "inline-flex", width: 14, flexShrink: 0, justifyContent: "center" }}>
          {leading}
        </span>
      )}
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children}
      </span>
    </button>
  );
}

/** A small uppercase section label inside a Dropdown panel. */
export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "var(--space-1) var(--space-2)",
        fontSize: "var(--font-size-xs)",
        fontWeight: "var(--font-weight-semibold)",
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </div>
  );
}

/** A thin divider between Dropdown sections. */
export function DropdownDivider() {
  return (
    <div
      style={{ height: 1, margin: "var(--space-1) 0", background: "var(--color-border-subtle)" }}
    />
  );
}
