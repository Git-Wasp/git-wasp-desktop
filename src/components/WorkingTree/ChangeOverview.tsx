import type { DiffRow } from "../../lib/lineDiff";

/**
 * A thin GitKraken-style overview strip: maps the file's unified diff rows onto
 * the full height, marking additions green and removals red so all changes are
 * visible at a glance. Clicking seeks the panes to that fraction of the file.
 */
export function ChangeOverview({
  rows,
  onSeek,
}: {
  rows: DiffRow[];
  onSeek?: (fraction: number) => void;
}) {
  const total = rows.length || 1;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientY - rect.top) / rect.height;
    onSeek(Math.min(1, Math.max(0, fraction)));
  };

  return (
    <div
      onClick={handleClick}
      data-testid="change-overview"
      title="Changes overview"
      style={{
        position: "relative",
        width: 10,
        flexShrink: 0,
        background: "var(--color-bg-elevated)",
        borderLeft: "1px solid var(--color-border-subtle)",
        cursor: onSeek ? "pointer" : "default",
      }}
    >
      {rows.map((row, i) =>
        row.kind === "context" ? null : (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 1,
              right: 1,
              top: `${(i / total) * 100}%`,
              height: `max(2px, ${(1 / total) * 100}%)`,
              background:
                row.kind === "added" ? "var(--color-diff-add)" : "var(--color-diff-del)",
            }}
          />
        ),
      )}
    </div>
  );
}
