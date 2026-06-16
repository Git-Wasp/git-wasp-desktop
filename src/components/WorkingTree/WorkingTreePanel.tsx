import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { HunkDiffViewer } from "./HunkDiffViewer";
import { StagingPanel } from "./StagingPanel";
import { EmptyState } from "../ui/EmptyState";

/**
 * Standalone "Changes" view (reached from the sidebar nav): the staging +
 * commit column on the left, the selected file's diff on the right.
 */
export function WorkingTreePanel() {
  const { status, selectedPath, selectedDiff, discardFile } = useWorkingTreeStore();
  const staged = status?.staged ?? [];

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          width: 300,
          flexShrink: 0,
          borderRight: "1px solid var(--color-border-subtle)",
          overflow: "hidden",
        }}
      >
        <StagingPanel />
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        {selectedDiff ? (
          <HunkDiffViewer
            diffHunks={selectedDiff}
            kind={staged.some((e) => e.path === selectedPath) ? "staged" : "unstaged"}
            onDiscardFile={() => selectedPath && discardFile(selectedPath)}
          />
        ) : (
          <EmptyState message="Select a file to view its diff" />
        )}
      </div>
    </div>
  );
}
