import { useState } from "react";
import { useMergeStore } from "../../stores/mergeStore";
import type { ConflictSide } from "../../types/merge";
import { ConflictFileEditor } from "./ConflictFileEditor";
import { NonTextConflictPicker } from "./NonTextConflictPicker";

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "var(--space-3)",
  borderBottom: "1px solid var(--color-border-subtle)",
};

const titleStyle: React.CSSProperties = {
  fontSize: "var(--font-size-sm)",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
};

const messageInputStyle: React.CSSProperties = {
  flex: 1,
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  background: "var(--color-bg-surface)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  background: "var(--color-accent-primary)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  background: "transparent",
  color: "var(--color-danger)",
  border: "1px solid var(--color-danger)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const fileListStyle: React.CSSProperties = {
  width: "240px",
  flexShrink: 0,
  overflowY: "auto",
  borderRight: "1px solid var(--color-border-subtle)",
};

function fileButtonStyle(selected: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "var(--space-2) var(--space-3)",
    fontSize: "var(--font-size-sm)",
    fontFamily: "var(--font-family-mono)",
    background: selected ? "var(--color-bg-elevated)" : "transparent",
    color: "var(--color-text-primary)",
    border: "none",
    borderBottom: "1px solid var(--color-border-subtle)",
    cursor: "pointer",
  };
}

export function MergeEditor() {
  const status = useMergeStore((s) => s.status);
  const isLoading = useMergeStore((s) => s.isLoading);
  const resolveFile = useMergeStore((s) => s.resolveFile);
  const resolveWithSide = useMergeStore((s) => s.resolveWithSide);
  const resolveWithDeletion = useMergeStore((s) => s.resolveWithDeletion);
  const completeMerge = useMergeStore((s) => s.completeMerge);
  const abortMerge = useMergeStore((s) => s.abortMerge);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (status.kind !== "merge") {
    return null;
  }

  const conflicts = status.conflicts;
  const selected = conflicts.find((f) => f.path === selectedPath) ?? conflicts[0] ?? null;

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(String(e));
    }
  }

  function handleMarkResolved(path: string, content: string) {
    void runAction(() => resolveFile(path, content));
  }

  function handleResolveWithSide(path: string, side: ConflictSide) {
    void runAction(() => resolveWithSide(path, side));
  }

  function handleResolveWithDeletion(path: string) {
    void runAction(() => resolveWithDeletion(path));
  }

  function handleComplete() {
    void runAction(() => completeMerge(commitMessage));
  }

  function handleAbort() {
    void runAction(() => abortMerge());
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={titleStyle}>
          Merging{status.sourceBranch ? ` ${status.sourceBranch}` : ""} into current branch
        </span>
        <input
          type="text"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Merge commit message"
          style={messageInputStyle}
        />
        <button
          type="button"
          onClick={handleComplete}
          disabled={isLoading || conflicts.length > 0 || commitMessage.trim() === ""}
          style={primaryButtonStyle}
        >
          Complete merge
        </button>
        <button type="button" onClick={handleAbort} disabled={isLoading} style={dangerButtonStyle}>
          Abort merge
        </button>
      </div>

      {actionError && (
        <div
          style={{
            padding: "var(--space-2) var(--space-3)",
            color: "var(--color-danger)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {actionError}
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={fileListStyle}>
          {conflicts.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => setSelectedPath(file.path)}
              style={fileButtonStyle(file.path === selected?.path)}
            >
              {file.path}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {selected &&
            (selected.kind === "normalEdit" ? (
              <ConflictFileEditor file={selected} onMarkResolved={handleMarkResolved} />
            ) : (
              <NonTextConflictPicker
                file={selected}
                onResolveWithSide={handleResolveWithSide}
                onResolveWithDeletion={handleResolveWithDeletion}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
