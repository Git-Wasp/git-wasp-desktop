import { useEffect } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import { RowMenu } from "../Sidebar/RowMenu";

const INITIAL_LIMIT = 150;

export function WorkspaceSidebarSection() {
  const { activeWorkspace, repoStatuses, loadStatus, addRepoToWorkspace, removeRepoFromWorkspace } =
    useWorkspaceStore();
  const { currentRepo, openRepo, loadBranches } = useRepoStore();
  const { fetchViewport } = useGraphStore();

  useEffect(() => {
    if (activeWorkspace) {
      loadStatus(activeWorkspace.id);
    }
  }, [activeWorkspace, loadStatus]);

  if (!activeWorkspace) {
    return null;
  }

  const handleRowClick = async (path: string) => {
    await openRepo(path);
    await fetchViewport(0, INITIAL_LIMIT);
    loadBranches();
  };

  const showAddCurrentRepo =
    currentRepo && !activeWorkspace.repoPaths.includes(currentRepo.path);

  return (
    <div
      style={{
        padding: "var(--space-2) 0",
        borderBottom: "1px solid var(--color-border-subtle)",
        overflowY: "auto",
        maxHeight: 220,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-3)",
          marginBottom: "var(--space-1)",
        }}
      >
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Workspace Repos
        </span>
        {showAddCurrentRepo && (
          <button
            onClick={() => addRepoToWorkspace(activeWorkspace.id, currentRepo.path)}
            style={{
              fontSize: "var(--font-size-xs)",
              padding: "1px var(--space-2)",
              background: "transparent",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            + Add current repo
          </button>
        )}
      </div>

      {repoStatuses.map((status) => (
        <div
          key={status.path}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "var(--space-1) var(--space-3)",
            gap: "var(--space-1)",
          }}
        >
          <div
            onClick={() => handleRowClick(status.path)}
            title={status.path}
            style={{
              flex: 1,
              minWidth: 0,
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-secondary)",
              }}
            >
              {status.name}
            </span>
            {status.error ? (
              <span
                title={status.error}
                style={{
                  marginLeft: "var(--space-1)",
                  color: "var(--color-danger)",
                  fontSize: "var(--font-size-xs)",
                }}
              >
                ⚠
              </span>
            ) : (
              <span
                style={{
                  marginLeft: "var(--space-1)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-family-mono)",
                  color: "var(--color-text-muted)",
                }}
              >
                {status.headBranch ?? "detached"}
              </span>
            )}
          </div>

          {(status.ahead > 0 || status.behind > 0) && (
            <span
              title="Ahead/behind upstream"
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-family-mono)",
                flexShrink: 0,
              }}
            >
              {status.ahead > 0 && `↑${status.ahead}`}
              {status.ahead > 0 && status.behind > 0 && " "}
              {status.behind > 0 && `↓${status.behind}`}
            </span>
          )}

          {status.uncommittedCount > 0 && (
            <span
              title="Uncommitted changes"
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-primary)",
                background: "var(--color-bg-elevated)",
                borderRadius: "var(--radius-sm)",
                padding: "0 var(--space-1)",
                flexShrink: 0,
              }}
            >
              {status.uncommittedCount}
            </span>
          )}

          <RowMenu
            label={`${status.name} actions`}
            items={[
              {
                label: "Remove from workspace",
                destructive: true,
                onSelect: () => removeRepoFromWorkspace(activeWorkspace.id, status.path),
              },
            ]}
          />
        </div>
      ))}
    </div>
  );
}
