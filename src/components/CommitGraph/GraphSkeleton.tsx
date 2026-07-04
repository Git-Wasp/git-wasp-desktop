import { GRAPH_PAD_LEFT } from "../../hooks/useCommitGraph";
import { ROW_HEIGHT } from "./columnModel";

// Animated placeholder shown in the graph area while a repo's history is
// loading (viewport === null) — an important cue on large repos where the
// first slice takes a moment. Purely decorative: aria-hidden, no interaction.
// Geometry mirrors the real graph (row height, the three columns, a lane-0 dot
// on a vertical lane line) so the swap to real content isn't jarring.

// A cheap deterministic pseudo-random in [0,1) from a row index, so the widths
// look varied but never reflow between renders (and tests stay stable).
function jitter(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const LANE_WIDTH = 20; // matches --graph-lane-width default
const DOT_X = GRAPH_PAD_LEFT + LANE_WIDTH / 2;

export function GraphSkeleton({
  branchWidth,
  graphWidth,
  rowCount,
}: {
  branchWidth: number;
  graphWidth: number;
  rowCount: number;
}) {
  return (
    <div data-testid="graph-skeleton" aria-hidden>
      {Array.from({ length: rowCount }, (_, i) => {
        const messageWidth = 40 + Math.round(jitter(i) * 45); // 40–85%
        const showPill = jitter(i * 7 + 1) > 0.72;
        const pillWidth = 60 + Math.round(jitter(i * 3 + 2) * 60); // 60–120px
        return (
          <div
            key={i}
            className="graph-skeleton-row"
            style={{ display: "flex", alignItems: "center", height: ROW_HEIGHT }}
          >
            {/* Branch / tag column — an occasional pill placeholder. */}
            <div style={{ width: branchWidth, flexShrink: 0, paddingLeft: "var(--space-3)" }}>
              {showPill && (
                <span
                  className="graph-skeleton-shimmer"
                  style={{ display: "block", height: 16, width: pillWidth, borderRadius: 999 }}
                />
              )}
            </div>

            {/* Graph column — a vertical lane line with a dot on lane 0. */}
            <div style={{ width: graphWidth, flexShrink: 0, position: "relative", height: "100%" }}>
              <span
                className="graph-skeleton-lane"
                style={{ left: DOT_X, top: 0, bottom: 0 }}
              />
              <span
                className="graph-skeleton-shimmer graph-skeleton-dot"
                style={{ left: DOT_X - 5, top: ROW_HEIGHT / 2 - 5 }}
              />
            </div>

            {/* Commit message column — a bar of varying width. */}
            <div style={{ flex: 1, minWidth: 0, paddingRight: "var(--space-3)" }}>
              <span
                className="graph-skeleton-shimmer"
                style={{ display: "block", height: 10, width: `${messageWidth}%`, borderRadius: 4 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
