import { useMemo } from "react";
import { overviewMarks, type DiffRow, type OverviewColor, type OverviewLane } from "../../lib/lineDiff";

// A GitKraken-style overview strip mapping the file's changes onto the full
// height. In side-by-side view it splits into two lanes — the left lane carries
// the old side's changes, the right lane the new side's — so a change is visible
// against the pane it belongs to. Deletions are red, additions green, and a
// modified region (a deletion paired with an addition) amber. Clicking seeks the
// panes to that fraction of the file.

const LANE_WIDTH = 11; // per-lane width; the strip is one or two of these

const COLOR_VAR: Record<OverviewColor, string> = {
  del: "var(--color-diff-del)",
  add: "var(--color-diff-add)",
  mod: "var(--color-warning)",
};

export function ChangeOverview({
  rows,
  split = false,
  onSeek,
}: {
  rows: DiffRow[];
  /** Two lanes (side-by-side view); otherwise a single combined lane. */
  split?: boolean;
  onSeek?: (fraction: number) => void;
}) {
  const total = rows.length || 1;
  const marks = useMemo(() => overviewMarks(rows), [rows]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientY - rect.top) / rect.height;
    onSeek(Math.min(1, Math.max(0, fraction)));
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
      onClick={handleClick}
      data-testid="change-overview"
      title="Changes overview"
      style={{
        display: "flex",
        gap: split ? 1 : 0,
        width: split ? LANE_WIDTH * 2 + 1 : LANE_WIDTH,
        flexShrink: 0,
        background: "var(--color-bg-elevated)",
        borderLeft: "1px solid var(--color-border-subtle)",
        cursor: onSeek ? "pointer" : "default",
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
    </div>
  );
}
