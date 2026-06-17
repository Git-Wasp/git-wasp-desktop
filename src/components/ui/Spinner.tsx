import type { CSSProperties } from "react";

/**
 * A small indeterminate spinner that inherits the surrounding text colour
 * (`currentColor`), so it reads correctly inside any button variant. The
 * rotation keyframe lives in globals.css (`@keyframes spin`).
 */
export function Spinner({ size = "1em", style }: { size?: number | string; style?: CSSProperties }) {
  return (
    <span
      data-spinner
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "var(--radius-full)",
        opacity: 0.85,
        animation: "spin 0.6s linear infinite",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
