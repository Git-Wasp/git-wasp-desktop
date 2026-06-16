import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { StagingPanel } from "./StagingPanel";

/**
 * Right-hand sidebar shown in the history view when the working-tree node is
 * active. A header with the change count and current branch sits above the
 * staging + commit column (StagingPanel). Selecting a file loads its diff into
 * the working-tree store, which the history view renders in the centre graph
 * pane.
 */
export function UncommittedPanel({ branch }: { branch: string | null }) {
  const { status } = useWorkingTreeStore();

  const count =
    (status?.staged.length ?? 0) +
    (status?.unstaged.length ?? 0) +
    (status?.untracked.length ?? 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          flexShrink: 0,
          padding: "var(--space-3)",
          borderBottom: "1px solid var(--color-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-secondary)",
        }}
      >
        <span>
          {count} {count === 1 ? "file change" : "file changes"} on
        </span>
        {branch && (
          <span
            style={{
              fontFamily: "var(--font-family-mono)",
              fontSize: "var(--font-size-xs)",
              padding: "1px var(--space-2)",
              background: "var(--color-bg-elevated)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-text-primary)",
            }}
          >
            {branch}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <StagingPanel />
      </div>
    </div>
  );
}
