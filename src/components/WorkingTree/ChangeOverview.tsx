import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { overviewMarks, type DiffRow, type OverviewColor, type OverviewLane } from "../../lib/lineDiff";

// A GitKraken-style overview strip mapping the file's changes onto the full
// height. In side-by-side view it splits into two lanes — the left lane carries
// the old side's changes, the right lane the new side's — so a change is visible
// against the pane it belongs to. Deletions are red, additions green, and a
// modified region (a deletion paired with an addition) amber.
//
// The strip doubles as a wide, easy-to-grab scrollbar: a translucent thumb
// tracks the editor's visible viewport (`viewport`, fractions of the content
// height) and can be dragged — or the track clicked — to scroll the diff panes
// via `onScrollTo` (given the desired thumb-top as a fraction of content).

// Per-lane width; the strip is one or two of these. Wide enough to read the
// change marks *and* to grab the thumb comfortably.
const LANE_WIDTH = 14;
// The thumb never shrinks below this fraction of the strip, so it stays grabbable
// on very long files where the viewport is a tiny slice of the content.
const MIN_THUMB_FRACTION = 0.04;

const COLOR_VAR: Record<OverviewColor, string> = {
  del: "var(--color-diff-del)",
  add: "var(--color-diff-add)",
  mod: "var(--color-warning)",
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function ChangeOverview({
  rows,
  split = false,
  viewport,
  onScrollTo,
}: {
  rows: DiffRow[];
  /** Two lanes (side-by-side view); otherwise a single combined lane. */
  split?: boolean;
  /** The editor's visible region as fractions of total content height. Absent
   *  (or covering everything) hides the thumb — nothing to scroll. */
  viewport?: { top: number; height: number };
  /** Scroll the diff to `topFraction` (desired thumb-top as a fraction of the
   *  content height). Called on click and while dragging the thumb. */
  onScrollTo?: (topFraction: number) => void;
}) {
  const total = rows.length || 1;
  const marks = useMemo(() => overviewMarks(rows), [rows]);

  const stripRef = useRef<HTMLDivElement>(null);
  // Offset (in strip fractions) between the grabbed point and the thumb top, so a
  // drag keeps the grabbed point under the cursor. Read by the pointer handlers.
  const grabOffsetRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  const vpTop = viewport ? clamp(viewport.top, 0, 1) : 0;
  const vpHeight = viewport ? clamp(viewport.height, 0, 1) : 1;
  // Only a real scrollbar when there's something to scroll and a handler to do it.
  const showThumb = !!onScrollTo && vpHeight < 1;
  const thumbHeight = Math.max(vpHeight, MIN_THUMB_FRACTION);

  // Latest props for the pointer handlers, which are attached once but must read
  // the current viewport as it changes during a drag.
  const stateRef = useRef({ vpTop, vpHeight, thumbHeight, onScrollTo });
  stateRef.current = { vpTop, vpHeight, thumbHeight, onScrollTo };

  // Scroll so the thumb tracks the cursor. Stable, so the drag listeners below
  // stay attached across the viewport updates a scroll produces (latest state is
  // read from `stateRef`).
  const scrollToClientY = useCallback((clientY: number) => {
    const { thumbHeight: h, onScrollTo: scroll } = stateRef.current;
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0 || !scroll) return;
    const p = clamp((clientY - rect.top) / rect.height, 0, 1);
    // Desired thumb-top, bounded so the thumb stays fully within the strip.
    scroll(clamp(p - grabOffsetRef.current, 0, Math.max(0, 1 - h)));
  }, []);

  // While dragging, follow the cursor anywhere on the page (not just over the
  // strip) and end on release — the standard scrollbar-thumb drag.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => scrollToClientY(e.clientY);
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, scrollToClientY]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onScrollTo || !showThumb) return;
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    const p = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    // Grabbing the thumb keeps the grip point fixed; clicking the track centres
    // the thumb on the cursor before the drag begins.
    const insideThumb = p >= vpTop && p <= vpTop + thumbHeight;
    grabOffsetRef.current = insideThumb ? p - vpTop : thumbHeight / 2;
    setDragging(true);
    scrollToClientY(e.clientY);
    e.preventDefault();
  };

  const marker = (rowIndex: number, color: OverviewColor) => (
    <div
      key={`${rowIndex}-${color}`}
      data-overview-mark
      data-color={color}
      style={{
        position: "absolute",
        left: 1,
        right: 1,
        top: `${(rowIndex / total) * 100}%`,
        height: `max(2px, ${(1 / total) * 100}%)`,
        background: COLOR_VAR[color],
        borderRadius: 1,
      }}
    />
  );

  const lane = (which: OverviewLane | "both") => (
    <div
      data-lane={which}
      style={{ position: "relative", flex: 1, height: "100%" }}
    >
      {marks
        .filter((m) => which === "both" || m.lane === which)
        .map((m) => marker(m.rowIndex, m.color))}
    </div>
  );

  return (
    <div
      ref={stripRef}
      onMouseDown={handleMouseDown}
      data-testid="change-overview"
      title="Changes overview — drag or click to scroll"
      style={{
        position: "relative",
        display: "flex",
        gap: split ? 1 : 0,
        width: split ? LANE_WIDTH * 2 + 1 : LANE_WIDTH,
        flexShrink: 0,
        background: "var(--color-bg-elevated)",
        borderLeft: "1px solid var(--color-border-subtle)",
        cursor: onScrollTo ? "pointer" : "default",
        touchAction: "none",
      }}
    >
      {split ? (
        <>
          {lane("left")}
          {lane("right")}
        </>
      ) : (
        lane("both")
      )}
      {showThumb && (
        <div
          data-testid="overview-thumb"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${vpTop * 100}%`,
            height: `${thumbHeight * 100}%`,
            background: "var(--color-overview-thumb)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: 2,
            // The container owns the pointer interaction; the thumb is visual only.
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
