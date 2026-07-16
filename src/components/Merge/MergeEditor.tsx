import { useState } from "react";
import { useMergeStore } from "../../stores/mergeStore";
import type { ConflictSide } from "../../types/merge";
import { ConflictFileEditor } from "./ConflictFileEditor";
import { NonTextConflictPicker } from "./NonTextConflictPicker";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../common/ConfirmDialog";

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
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [pendingSwitchPath, setPendingSwitchPath] = useState<string | null>(null);

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

  function handleDirtyChange(path: string, dirty: boolean) {
    setDirtyPaths((prev) => {
      const has = prev.has(path);
      if (dirty === has) return prev;
      const next = new Set(prev);
      if (dirty) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  function handleMarkResolved(path: string, content: string) {
    void runAction(async () => {
      await resolveFile(path, content);
      // Only once resolving has actually succeeded does the file leave the
      // conflict list — it can no longer be switched to or
      // aborted-with-unsaved-edits, so only now drop its dirty flag. If
      // `resolveFile` rejects, `runAction`'s catch stops execution before
      // this line, so a still-conflicted, still-edited file stays flagged
      // dirty and Abort/switch still prompt.
      setDirtyPaths((prev) => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    });
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
    if (dirtyPaths.size > 0) {
      setConfirmAbort(true);
      return;
    }
    void runAction(() => abortMerge());
  }

  function selectFile(path: string) {
    if (path === selected?.path) return;
    if (dirtyPaths.has(selected?.path ?? "")) {
      setPendingSwitchPath(path);
      return;
    }
    setSelectedPath(path);
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
        <Button
          variant="primary"
          type="button"
          onClick={handleComplete}
          disabled={isLoading || conflicts.length > 0 || commitMessage.trim() === ""}
        >
          Complete merge
        </Button>
        <Button variant="danger" type="button" onClick={handleAbort} disabled={isLoading}>
          Abort merge
        </Button>
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
              onClick={() => selectFile(file.path)}
              style={fileButtonStyle(file.path === selected?.path)}
            >
              {file.path}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {selected &&
            (selected.kind === "normalEdit" ? (
              <ConflictFileEditor
                file={selected}
                onMarkResolved={handleMarkResolved}
                onDirtyChange={handleDirtyChange}
              />
            ) : (
              <NonTextConflictPicker
                file={selected}
                onResolveWithSide={handleResolveWithSide}
                onResolveWithDeletion={handleResolveWithDeletion}
              />
            ))}
        </div>
      </div>

      {confirmAbort && (
        <ConfirmDialog
          title="Abort merge"
          message={`You have unsaved edits in ${dirtyPaths.size} file${
            dirtyPaths.size === 1 ? "" : "s"
          }. Aborting discards them and reverts to the pre-merge state. This cannot be undone.`}
          confirmLabel="Abort merge"
          onConfirm={() => {
            setConfirmAbort(false);
            void runAction(() => abortMerge());
          }}
          onCancel={() => setConfirmAbort(false)}
        />
      )}
      {pendingSwitchPath && (
        <ConfirmDialog
          title="Unsaved edits"
          message="This file has unsaved edits. Switching files discards them."
          confirmLabel="Discard and switch"
          onConfirm={() => {
            const path = pendingSwitchPath;
            setSelectedPath(path);
            setDirtyPaths((prev) => {
              const current = selected?.path ?? "";
              if (!prev.has(current)) return prev;
              const next = new Set(prev);
              next.delete(current);
              return next;
            });
            setPendingSwitchPath(null);
          }}
          onCancel={() => setPendingSwitchPath(null)}
        />
      )}
    </div>
  );
}
