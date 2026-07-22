import type { CSSProperties } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { useToastStore } from "../../stores/toastStore";
import { IconButton } from "../ui/IconButton";
import { TreeIcon } from "../ui/icons";

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
  const { openRepos, activeRepoPath, activateRepo, closeRepo, newTab } =
    useRepoStore();

  // Always render — even with no repos open — so the "New tab" button is always
  // reachable (the bar then shows just that button, with the welcome view below).

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
            onClick={() =>
              void activateRepo(repo.path).catch((e: unknown) =>
                useToastStore
                  .getState()
                  .error(String(e), { title: "Couldn't switch repository" }),
              )
            }
            onMouseEnter={(e) => {
              if (!active)
                e.currentTarget.style.background = "var(--color-bg-hover)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
            style={{
              ...tabBaseStyle,
              background: active ? "var(--color-bg-elevated)" : "transparent",
              color: active
                ? "var(--color-text-primary)"
                : "var(--color-text-muted)",
              fontWeight: active
                ? "var(--font-weight-semibold)"
                : "var(--font-weight-normal)",
              transition: "background var(--duration-fast) var(--ease-default)",
            }}
          >
            {repo.repoKind === "worktree" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  color: active
                    ? "var(--color-text-primary)"
                    : "var(--color-text-muted)",
                  flexShrink: 0,
                }}
                title="Linked worktree"
              >
                <TreeIcon size={12} />
              </span>
            )}
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
                closeRepo(repo.path).catch((err: unknown) =>
                  useToastStore
                    .getState()
                    .error(String(err), { title: "Couldn't close repository" }),
                );
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
        style={{
          alignSelf: "center",
          marginLeft: "var(--space-1)",
          flexShrink: 0,
        }}
      >
        +
      </IconButton>
    </div>
  );
}
