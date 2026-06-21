import { useEffect, useRef, useState } from "react";

/**
 * A small hover tooltip. Wraps its children and, after a short hover delay,
 * shows `label` in a token-styled bubble centred above the wrapped element.
 * Used for branch/tag pills, whose text is often truncated, so the full ref name
 * is still readable.
 *
 * Positioned with `position: fixed` from the element's bounding rect (the same
 * approach as ContextMenu) — no transformed ancestors in the graph, so it
 * escapes the rows' `overflow: hidden` and isn't clipped.
 */
export function Tooltip({
  label,
  delay = 350,
  children,
}: {
  label: string;
  delay?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const show = () => {
    clear();
    timer.current = setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setPos({ x: rect.left + rect.width / 2, y: rect.top });
    }, delay);
  };

  const hide = () => {
    clear();
    setPos(null);
  };

  // Don't leave a pending timer running if we unmount mid-hover.
  useEffect(() => clear, []);

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={hide}
      style={{ display: "inline-flex", maxWidth: "100%", minWidth: 0 }}
    >
      {children}
      {pos && (
        <span
          role="tooltip"
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            transform: "translate(-50%, calc(-100% - 6px))",
            padding: "2px var(--space-2)",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "var(--shadow-md)",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-family-mono)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 250,
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
