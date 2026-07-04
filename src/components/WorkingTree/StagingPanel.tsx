import { useEffect } from "react";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { CommitForm } from "./CommitForm";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { FileStatusIcon } from "../ui/FileStatusIcon";
import type { StatusEntry } from "../../types/workingTree";

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
      data-file-row
      onClick={onSelect}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = "var(--color-bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }}
      title={entry.path}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-1) var(--space-3)",
        cursor: "pointer",
        background: isSelected ? "var(--color-bg-selected)" : "transparent",
        borderRadius: "var(--radius-sm)",
        transition: "background var(--duration-fast) var(--ease-default)",
      }}
    >
      <span style={{ width: 14, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>
        <FileStatusIcon status={entry.status} />
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
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          action();
        }}
        style={{ flexShrink: 0 }}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

function PanelHeader({
  title,
  count,
  action,
}: {
  title: string;
  count: number;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "var(--space-2) var(--space-3)",
        fontSize: "var(--font-size-xs)",
        fontWeight: "var(--font-weight-semibold)",
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-2)",
        flexShrink: 0,
      }}
    >
      <span>
        {title} <span style={{ color: "var(--color-text-secondary)" }}>{count}</span>
      </span>
      {action}
    </div>
  );
}

/**
 * The staging + commit column: a "Changes" panel (unstaged + untracked) over a
 * "Staged" panel, with the commit form beneath. Selecting a file loads its diff
 * into the working-tree store; the host decides where that diff renders (the
 * history view shows it in the centre graph pane, the standalone Changes view in
 * its own pane). Designed to fill a narrow sidebar column.
 */
export function StagingPanel({ onCommitted }: { onCommitted?: () => void } = {}) {
  const {
    status,
    selectedPath,
    loadStatus,
    startWatching,
    selectFile,
    stageFile,
    unstageFile,
  } = useWorkingTreeStore();

  useEffect(() => {
    loadStatus();
    let unlisten: (() => void) | null = null;
    startWatching().then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [loadStatus, startWatching]);

  // "Changes" = everything not yet staged (modified/deleted + untracked).
  const changes = [...(status?.unstaged ?? []), ...(status?.untracked ?? [])];
  const staged = status?.staged ?? [];
  const stagedCount = staged.length;

  const stageAll = () => changes.forEach((e) => stageFile(e.path));
  const unstageAll = () => staged.forEach((e) => unstageFile(e.path));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Changes panel */}
      <div
        style={{
          flex: 2,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <PanelHeader
          title="Changes"
          count={changes.length}
          action={
            changes.length > 0 ? (
              <Button size="sm" onClick={stageAll}>
                Stage all
              </Button>
            ) : undefined
          }
        />
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: "var(--space-2)" }}>
          {changes.length === 0 ? (
            <EmptyState message="No changes" />
          ) : (
            changes.map((entry) => (
              <FileRow
                key={`change-${entry.path}`}
                entry={entry}
                actionLabel="Stage"
                action={() => stageFile(entry.path)}
                onSelect={() => selectFile(entry.path)}
                isSelected={selectedPath === entry.path}
              />
            ))
          )}
        </div>
      </div>

      {/* Staged panel */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderTop: "1px solid var(--color-border-subtle)",
        }}
      >
        <PanelHeader
          title="Staged"
          count={stagedCount}
          action={
            stagedCount > 0 ? (
              <Button size="sm" onClick={unstageAll}>
                Unstage all
              </Button>
            ) : undefined
          }
        />
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: "var(--space-2)" }}>
          {stagedCount === 0 ? (
            <EmptyState message="Stage files to commit them" />
          ) : (
            staged.map((entry) => (
              <FileRow
                key={`staged-${entry.path}`}
                entry={entry}
                actionLabel="Unstage"
                action={() => unstageFile(entry.path)}
                onSelect={() => selectFile(entry.path)}
                isSelected={selectedPath === entry.path}
              />
            ))
          )}
        </div>
      </div>

      <CommitForm stagedCount={stagedCount} onCommitted={onCommitted} />
    </div>
  );
}
