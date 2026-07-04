import type { CSSProperties, ReactNode } from "react";
import type { ButtonSize } from "./Button";

export interface SegmentOption<T extends string> {
  value: T;
  /** Segment content — text or an icon. */
  label: ReactNode;
  /** Accessible name for icon-only segments; also used as the title tooltip. */
  ariaLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible label for the whole group. */
  ariaLabel: string;
  size?: ButtonSize;
  /** Square, padding-free segments for icon-only toggles. */
  iconOnly?: boolean;
}

const groupStyle: CSSProperties = {
  display: "inline-flex",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  overflow: "hidden",
};

/**
 * A bordered "pick exactly one" toggle group — the single source of truth for the
 * segmented-control pattern that was previously hand-rolled across the app (Write/
 * Preview tabs, identity scope, notification placement, diff view mode). The active
 * segment reads with the accent fill; inactive segments get a clear hover state.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "sm",
  iconOnly = false,
}: SegmentedControlProps<T>) {
  const height = size === "md" ? "var(--control-height-md)" : "var(--control-height-sm)";
  const fontSize = size === "md" ? "var(--font-size-sm)" : "var(--font-size-xs)";

  return (
    <div role="group" aria-label={ariaLabel} style={groupStyle}>
      {options.map((opt, i) => {
        const active = opt.value === value;
        const base = active ? "var(--color-accent-primary)" : "transparent";
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            aria-label={opt.ariaLabel}
            title={opt.ariaLabel}
            onClick={() => onChange(opt.value)}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--color-bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = base;
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height,
              width: iconOnly ? height : undefined,
              padding: iconOnly ? 0 : "0 var(--space-3)",
              fontSize,
              fontFamily: "inherit",
              fontWeight: "var(--font-weight-medium)",
              whiteSpace: "nowrap",
              border: "none",
              borderLeft: i > 0 ? "1px solid var(--color-border-subtle)" : "none",
              background: base,
              color: active ? "var(--color-text-on-accent)" : "var(--color-text-secondary)",
              cursor: active ? "default" : "pointer",
              transition: "background var(--duration-fast) var(--ease-default)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
