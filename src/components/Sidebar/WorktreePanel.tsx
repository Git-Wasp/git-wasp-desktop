import type { CSSProperties } from "react";
import type { WorktreeEntry } from "../../types/repo";
import { Button } from "../ui/Button";
import { TreeIcon } from "../ui/icons";
import { CollapsibleSection } from "./CollapsibleSection";
import { RowMenu } from "./RowMenu";

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-1) var(--space-3)",
  cursor: "pointer",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0 var(--space-1)",
  minHeight: "18px",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-medium)",
};

export function WorktreePanel({
  currentRepoPath,
  worktrees,
  onOpenOrActivate,
  onRefresh,
  onCreate,
  onOpenParent,
  onLock,
  onUnlock,
  onRemove,
}: {
  currentRepoPath: string;
  worktrees: WorktreeEntry[];
  onOpenOrActivate: (path: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onOpenParent: (path: string) => void;
  onLock: (path: string) => void;
  onUnlock: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  return (
    <CollapsibleSection
      id="worktrees"
      title="Worktrees"
      action={
        <div style={{ display: "flex", gap: "var(--space-1)" }}>
          <Button size="sm" variant="secondary" onClick={onCreate}>
            New worktree
          </Button>
          <Button size="sm" variant="secondary" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      }
    >
      {worktrees.map((entry) => {
        const isCurrent = entry.isCurrent || entry.path === currentRepoPath;
        const isPrunable = entry.isPrunable === true;

        return (
          <div
            key={entry.path}
            className="sidebar-row"
            onClick={() => {
              if (isPrunable) return;
              onOpenOrActivate(entry.path);
            }}
            style={{
              ...rowStyle,
              background: isCurrent
                ? "var(--color-bg-elevated)"
                : "transparent",
              cursor: isPrunable ? "default" : rowStyle.cursor,
              opacity: isPrunable ? 0.72 : 1,
            }}
            title={entry.path}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                color: "var(--color-text-muted)",
                flexShrink: 0,
              }}
            >
              <TreeIcon size={12} />
            </span>
            <div
              style={{
                minWidth: 0,
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              <span
                style={{
                  fontSize: "var(--font-size-sm)",
                  color: "var(--color-text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.name}
              </span>
              {entry.branch && (
                <span
                  style={{
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-text-muted)",
                    fontFamily: "var(--font-family-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.branch}
                </span>
              )}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              {entry.isLocked && <span style={badgeStyle}>Locked</span>}
              {isPrunable && <span style={badgeStyle}>Prunable</span>}
              {entry.hasUncommittedChanges && (
                <span style={badgeStyle}>Dirty</span>
              )}
              {isCurrent && <span style={badgeStyle}>Current</span>}
              <RowMenu
                label={`${entry.name} actions`}
                items={[
                  ...(!isPrunable
                    ? [
                        {
                          label: entry.isOpen
                            ? "Activate tab"
                            : "Open worktree",
                          onSelect: () => onOpenOrActivate(entry.path),
                        },
                      ]
                    : []),
                  ...(entry.repoKind === "worktree"
                    ? [
                        {
                          label: "Open parent repo",
                          onSelect: () => onOpenParent(entry.path),
                        },
                      ]
                    : []),
                  ...(entry.repoKind === "worktree" &&
                  !entry.isLocked &&
                  !isPrunable
                    ? [
                        {
                          label: "Lock worktree",
                          onSelect: () => onLock(entry.path),
                        },
                      ]
                    : []),
                  ...(entry.repoKind === "worktree" &&
                  entry.isLocked &&
                  !isPrunable
                    ? [
                        {
                          label: "Unlock worktree",
                          onSelect: () => onUnlock(entry.path),
                        },
                      ]
                    : []),
                  ...(entry.repoKind === "worktree" &&
                  !entry.isLocked &&
                  !isPrunable &&
                  !entry.hasUncommittedChanges
                    ? [
                        {
                          label: "Remove worktree",
                          destructive: true,
                          onSelect: () => onRemove(entry.path),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </div>
        );
      })}
    </CollapsibleSection>
  );
}
