import { useEffect, useRef } from "react";

/**
 * A thin draggable vertical divider. Reports the horizontal pointer delta while
 * dragging via `onResize`; the parent applies it to a panel width. Uses window
 * listeners so the drag continues even when the pointer leaves the handle.
 */
export function ResizeHandle({
  onResize,
  ariaLabel,
}: {
  onResize: (deltaX: number) => void;
  ariaLabel?: string;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      if (dx !== 0) onResizeRef.current(dx);
    };
    const stop = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        dragging.current = true;
        lastX.current = e.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
      }}
      style={{
        flexShrink: 0,
        width: 5,
        cursor: "col-resize",
        background: "var(--color-border-subtle)",
      }}
    />
  );
}
