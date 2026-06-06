import { open } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";

const INITIAL_LIMIT = 150;

export function Sidebar() {
  const { currentRepo, recentRepos, branches, openRepo, loadRecentRepos, loadBranches, checkoutBranch } =
    useRepoStore();
  const { fetchViewport } = useGraphStore();

  useEffect(() => {
    loadRecentRepos();
  }, [loadRecentRepos]);

  useEffect(() => {
    if (currentRepo) loadBranches();
  }, [currentRepo, loadBranches]);

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await openRepo(selected);
      await fetchViewport(0, INITIAL_LIMIT);
      loadBranches();
    }
  };

  const handleRecentClick = async (path: string) => {
    await openRepo(path);
    await fetchViewport(0, INITIAL_LIMIT);
    loadBranches();
  };

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg-panel)",
        borderRight: "1px solid var(--color-border-subtle)",
        overflow: "hidden",
      }}
    >
      {/* Repo name / open button */}
      <div
        style={{
          padding: "var(--space-4)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <div
          style={{
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-text-primary)",
            marginBottom: "var(--space-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentRepo?.name ?? "No repo open"}
        </div>
        {currentRepo && (
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-family-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {currentRepo.headBranch ?? "detached"}
          </div>
        )}
        <button
          onClick={handleOpenFolder}
          style={{
            marginTop: "var(--space-3)",
            width: "100%",
            padding: "var(--space-1) var(--space-2)",
            fontSize: "var(--font-size-sm)",
            background: "var(--color-accent-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          Open Repository…
        </button>
      </div>

      {/* Branch list */}
      {branches.length > 0 && (
        <div
          style={{
            padding: "var(--space-2) 0",
            borderBottom: "1px solid var(--color-border-subtle)",
            overflowY: "auto",
            maxHeight: 180,
          }}
        >
          <div
            style={{
              padding: "0 var(--space-3)",
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "var(--space-1)",
            }}
          >
            Branches
          </div>
          {branches
            .filter((b) => !b.isRemote)
            .map((b) => (
              <div
                key={b.name}
                onClick={() => !b.isHead && checkoutBranch(b.name).then(() => fetchViewport(0, INITIAL_LIMIT))}
                style={{
                  padding: "var(--space-1) var(--space-3)",
                  fontSize: "var(--font-size-sm)",
                  fontFamily: "var(--font-family-mono)",
                  color: b.isHead
                    ? "var(--color-accent-primary)"
                    : "var(--color-text-secondary)",
                  cursor: b.isHead ? "default" : "pointer",
                  background: b.isHead ? "var(--color-bg-elevated)" : "transparent",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {b.isHead ? "▸ " : "  "}{b.name}
              </div>
            ))}
        </div>
      )}

      {/* Recent repos */}
      {recentRepos.length > 0 && (
        <div style={{ padding: "var(--space-2) 0", overflowY: "auto", flex: 1 }}>
          <div
            style={{
              padding: "0 var(--space-3)",
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "var(--space-1)",
            }}
          >
            Recent
          </div>
          {recentRepos.map((r) => (
            <div
              key={r.path}
              onClick={() => handleRecentClick(r.path)}
              style={{
                padding: "var(--space-1) var(--space-3)",
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={r.path}
            >
              {r.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
