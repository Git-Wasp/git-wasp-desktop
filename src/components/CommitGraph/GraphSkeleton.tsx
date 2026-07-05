import { GRAPH_PAD_LEFT } from "../../hooks/useCommitGraph";
import { ROW_HEIGHT } from "./columnModel";

// Animated placeholder shown in the graph area while a repo's history is
// loading (viewport === null) — an important cue on large repos where the
// first slice takes a moment. Purely decorative: aria-hidden, no interaction.
// Geometry mirrors the real graph (row height, a graph lane column, and a
// couple of content bars) so the swap to real content isn't jarring.

// A cheap deterministic pseudo-random in [0,1) from a row index, so the widths
// look varied but never reflow between renders (and tests stay stable).
function jitter(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const LANE_WIDTH = 24; // matches --graph-lane-width default
const DOT_INSET = GRAPH_PAD_LEFT + LANE_WIDTH / 2;

export function GraphSkeleton({
  graphWidth,
  graphOnRight,
  rowCount,
}: {
  graphWidth: number;
  /** Split Rail anchors the graph (and its lane placeholder) to the right. */
  graphOnRight: boolean;
  rowCount: number;
}) {
  const graphCol = (
    <div style={{ width: graphWidth, flexShrink: 0, position: "relative", height: "100%" }}>
      <span
        className="graph-skeleton-lane"
        style={{ [graphOnRight ? "right" : "left"]: DOT_INSET, top: 0, bottom: 0 }}
      />
      <span
        className="graph-skeleton-shimmer graph-skeleton-dot"
        style={{ [graphOnRight ? "right" : "left"]: DOT_INSET - 5, top: ROW_HEIGHT / 2 - 5 }}
      />
    </div>
  );

  return (
    <div data-testid="graph-skeleton" aria-hidden>
      {Array.from({ length: rowCount }, (_, i) => {
        const messageWidth = 40 + Math.round(jitter(i) * 45); // 40–85%
        const content = (
          <div style={{ flex: 1, minWidth: 0, padding: "0 var(--space-3)" }}>
            <span
              className="graph-skeleton-shimmer"
              style={{ display: "block", height: 10, width: `${messageWidth}%`, borderRadius: 4 }}
            />
          </div>
        );
        return (
          <div
            key={i}
            className="graph-skeleton-row"
            style={{ display: "flex", alignItems: "center", height: ROW_HEIGHT }}
          >
            {graphOnRight ? (
              <>
                {content}
                {graphCol}
              </>
            ) : (
              <>
                {graphCol}
                {content}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
