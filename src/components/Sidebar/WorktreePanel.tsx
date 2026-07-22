import type { CSSProperties } from "react";
import type { WorktreeEntry } from "../../types/repo";
import { Button } from "../ui/Button";
import { TreeIcon } from "../ui/icons";
import { CollapsibleSection } from "./CollapsibleSection";

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
}: {
  currentRepoPath: string;
  worktrees: WorktreeEntry[];
  onOpenOrActivate: (path: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onOpenParent: (path: string) => void;
}) {
  void onOpenParent;

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

        return (
          <div
            key={entry.path}
            className="sidebar-row"
            onClick={() => onOpenOrActivate(entry.path)}
            style={{
              ...rowStyle,
              background: isCurrent
                ? "var(--color-bg-elevated)"
                : "transparent",
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
              {entry.hasUncommittedChanges && (
                <span style={badgeStyle}>Dirty</span>
              )}
              {isCurrent && <span style={badgeStyle}>Current</span>}
            </div>
          </div>
        );
      })}
    </CollapsibleSection>
  );
}
