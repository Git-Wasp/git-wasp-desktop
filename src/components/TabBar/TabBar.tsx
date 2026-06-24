import type { CSSProperties } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { IconButton } from "../ui/IconButton";

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  flexShrink: 0,
  height: 34,
  background: "var(--color-bg-panel)",
  borderBottom: "1px solid var(--color-border-subtle)",
  overflowX: "auto",
};

const tabBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "0 var(--space-2) 0 var(--space-3)",
  maxWidth: 220,
  borderRight: "1px solid var(--color-border-subtle)",
  cursor: "pointer",
  fontSize: "var(--font-size-sm)",
  userSelect: "none",
};

export function TabBar() {
  const { openRepos, activeRepoPath, activateRepo, closeRepo, newTab } = useRepoStore();

  if (openRepos.length === 0) return null;

  return (
    <div style={barStyle} role="tablist" aria-label="Open repositories">
      {openRepos.map((repo) => {
        const active = repo.path === activeRepoPath;
        return (
          <div
            key={repo.path}
            role="tab"
            aria-selected={active}
            title={repo.path}
            onClick={() => activateRepo(repo.path)}
            style={{
              ...tabBaseStyle,
              background: active ? "var(--color-bg-elevated)" : "transparent",
              color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
              fontWeight: active ? "var(--font-weight-semibold)" : "var(--font-weight-normal)",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {repo.name}
            </span>
            <IconButton
              aria-label={`Close ${repo.name}`}
              onClick={(e) => {
                e.stopPropagation();
                void closeRepo(repo.path);
              }}
            >
              ✕
            </IconButton>
          </div>
        );
      })}
      <IconButton
        aria-label="New tab"
        title="New tab"
        size="md"
        onClick={newTab}
        style={{ alignSelf: "center", marginLeft: "var(--space-1)", flexShrink: 0 }}
      >
        +
      </IconButton>
    </div>
  );
}
