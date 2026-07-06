import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Room the bubble needs above the trigger (its height + the 6px gap). Below this
// much clearance to the viewport top we flip it under the trigger instead, so a
// tooltip on a control near the top of a panel isn't clipped or hidden behind it.
const FLIP_THRESHOLD = 40;

/**
 * A small hover tooltip. Wraps its children and, after a short hover delay,
 * shows `label` in a token-styled bubble centred above the wrapped element (or
 * below it, when there isn't room above). Used for branch/tag pills — whose text
 * is often truncated — and for icon buttons.
 *
 * The bubble is rendered through a portal to `document.body` and positioned with
 * `position: fixed` from the trigger's bounding rect, so no ancestor's
 * `overflow: hidden`, stacking context, or transformed containing block can clip
 * it or paint over it (e.g. an adjacent panel above the toolbar).
 */
export function Tooltip({
  label,
  delay = 350,
  children,
}: {
  /** Bubble contents. A string renders on one line; pass a node for richer
   *  content (e.g. a vertical list) — such content manages its own layout. */
  label: React.ReactNode;
  delay?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);

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
      if (!rect) return;
      // Flip below the trigger when it sits too close to the viewport top for
      // the bubble to open upward without being clipped.
      const below = rect.top < FLIP_THRESHOLD;
      setPos({
        x: rect.left + rect.width / 2,
        y: below ? rect.bottom : rect.top,
        below,
      });
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
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform: pos.below
                ? "translate(-50%, 6px)"
                : "translate(-50%, calc(-100% - 6px))",
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
          </span>,
          document.body,
        )}
    </span>
  );
}
