import { useEffect } from "react";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { HunkDiffViewer } from "./HunkDiffViewer";
import { CommitForm } from "./CommitForm";
import type { StatusEntry } from "../../types/workingTree";

const STATUS_ICONS: Record<string, string> = {
  Added: "A",
  Modified: "M",
  Deleted: "D",
  Renamed: "R",
};

function FileRow({
  entry,
  action,
  actionLabel,
  onSelect,
  isSelected,
}: {
  entry: StatusEntry;
  action: () => void;
  actionLabel: string;
  onSelect: () => void;
  isSelected: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-1) var(--space-3)",
        cursor: "pointer",
        background: isSelected ? "var(--color-bg-selected)" : "transparent",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-family-mono)",
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
          width: 14,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {STATUS_ICONS[entry.status] ?? "?"}
      </span>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "var(--font-size-sm)",
        }}
      >
        {entry.path}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); action(); }}
        style={{
          fontSize: "var(--font-size-xs)",
          padding: "2px var(--space-2)",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-sm)",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "var(--space-2)" }}>
      <div
        style={{
          padding: "var(--space-1) var(--space-3)",
          fontSize: "var(--font-size-xs)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{title}</span>
        <span>{count}</span>
      </div>
      {children}
    </div>
  );
}

export function WorkingTreePanel() {
  const {
    status,
    selectedPath,
    selectedDiff,
    loadStatus,
    startWatching,
    selectFile,
    stageFile,
    unstageFile,
    discardFile,
  } = useWorkingTreeStore();

  useEffect(() => {
    loadStatus();
    let unlisten: (() => void) | null = null;
    startWatching().then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [loadStatus, startWatching]);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left: file list + commit form */}
      <div
        style={{
          width: 280,
          flexShrink: 0,
          borderRight: "1px solid var(--color-border-subtle)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-2) 0" }}>
          {status && (
            <>
              <Section title="Staged" count={status.staged.length}>
                {status.staged.map((entry) => (
                  <FileRow
                    key={`staged-${entry.path}`}
                    entry={entry}
                    actionLabel="Unstage"
                    action={() => unstageFile(entry.path)}
                    onSelect={() => selectFile(entry.path, "staged")}
                    isSelected={selectedPath === entry.path}
                  />
                ))}
              </Section>

              <Section title="Unstaged" count={status.unstaged.length}>
                {status.unstaged.map((entry) => (
                  <FileRow
                    key={`unstaged-${entry.path}`}
                    entry={entry}
                    actionLabel="Stage"
                    action={() => stageFile(entry.path)}
                    onSelect={() => selectFile(entry.path, "unstaged")}
                    isSelected={selectedPath === entry.path}
                  />
                ))}
              </Section>

              <Section title="Untracked" count={status.untracked.length}>
                {status.untracked.map((entry) => (
                  <FileRow
                    key={`untracked-${entry.path}`}
                    entry={entry}
                    actionLabel="Stage"
                    action={() => stageFile(entry.path)}
                    onSelect={() => selectFile(entry.path, "unstaged")}
                    isSelected={selectedPath === entry.path}
                  />
                ))}
              </Section>
            </>
          )}
        </div>

        <CommitForm stagedCount={status?.staged.length ?? 0} />
      </div>

      {/* Right: diff viewer */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {selectedDiff ? (
          <HunkDiffViewer
            diffHunks={selectedDiff}
            kind={
              status?.staged.some((e) => e.path === selectedPath)
                ? "staged"
                : "unstaged"
            }
            onDiscardFile={() => selectedPath && discardFile(selectedPath)}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            Select a file to view its diff
          </div>
        )}
      </div>
    </div>
  );
}
