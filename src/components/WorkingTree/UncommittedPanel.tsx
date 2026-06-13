import { useEffect } from "react";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import type { StatusEntry } from "../../types/workingTree";

const STATUS_ICONS: Record<string, string> = {
  Added: "A",
  Modified: "M",
  Deleted: "D",
  Renamed: "R",
};

function FileRow({
  entry,
  selected,
  onSelect,
}: {
  entry: StatusEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      title={entry.path}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-1) var(--space-3)",
        cursor: "pointer",
        background: selected ? "var(--color-bg-selected)" : "transparent",
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
    </div>
  );
}

function Section({
  title,
  entries,
  kind,
  selectedPath,
  onSelect,
}: {
  title: string;
  entries: StatusEntry[];
  kind: "staged" | "unstaged";
  selectedPath: string | null;
  onSelect: (path: string, kind: "staged" | "unstaged") => void;
}) {
  if (entries.length === 0) return null;
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
        <span>{entries.length}</span>
      </div>
      {entries.map((entry) => (
        <FileRow
          key={`${kind}-${entry.path}`}
          entry={entry}
          selected={selectedPath === entry.path}
          onSelect={() => onSelect(entry.path, kind)}
        />
      ))}
    </div>
  );
}

/**
 * Right-hand panel listing uncommitted changes (shown in place of the commit
 * detail panel when the working-tree node is active). Selecting a file loads
 * its diff into the working-tree store, which the history view shows in the
 * centre panel.
 */
export function UncommittedPanel({ branch }: { branch: string | null }) {
  const { status, selectedPath, loadStatus, startWatching, selectFile } = useWorkingTreeStore();

  useEffect(() => {
    loadStatus();
    let unlisten: (() => void) | null = null;
    startWatching().then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [loadStatus, startWatching]);

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

      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-2) 0" }}>
        {status && count === 0 && (
          <div
            style={{
              padding: "var(--space-4)",
              textAlign: "center",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            No uncommitted changes
          </div>
        )}
        {status && (
          <>
            <Section title="Staged" entries={status.staged} kind="staged" selectedPath={selectedPath} onSelect={selectFile} />
            <Section title="Unstaged" entries={status.unstaged} kind="unstaged" selectedPath={selectedPath} onSelect={selectFile} />
            <Section title="Untracked" entries={status.untracked} kind="unstaged" selectedPath={selectedPath} onSelect={selectFile} />
          </>
        )}
      </div>
    </div>
  );
}
