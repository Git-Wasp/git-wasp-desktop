import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import { useGithubStore } from "../../stores/githubStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { StashPanel } from "./StashPanel";
import { RemoteActions } from "./RemoteActions";
import { CloneDialog } from "../GitHub/CloneDialog";
import { DeviceFlowModal } from "../GitHub/DeviceFlowModal";

const INITIAL_LIMIT = 150;

type View = "history" | "working-tree" | "prs";

export function Sidebar({
  view,
  onViewChange,
}: {
  view: View;
  onViewChange: (v: View) => void;
}) {
  const { currentRepo, recentRepos, branches, openRepo, loadRecentRepos, loadBranches, checkoutBranch, createBranch, deleteBranch } =
    useRepoStore();
  const { fetchViewport } = useGraphStore();
  const { remoteInfo, authStatus, logout } = useGithubStore();
  const { aheadBehind, loadAheadBehind } = useRemoteStore();
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showConnectFlow, setShowConnectFlow] = useState(false);

  const githubHost = remoteInfo?.host ?? "github.com";
  const isConnected = authStatus[githubHost] ?? false;

  useEffect(() => {
    loadRecentRepos();
  }, [loadRecentRepos]);

  useEffect(() => {
    if (currentRepo) {
      loadBranches();
      loadAheadBehind();
    }
  }, [currentRepo, loadBranches, loadAheadBehind]);

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

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    await createBranch(newBranchName.trim());
    setNewBranchName("");
    setShowNewBranch(false);
    await fetchViewport(0, INITIAL_LIMIT);
  };

  const handleDeleteBranch = async (name: string) => {
    await deleteBranch(name);
    await fetchViewport(0, INITIAL_LIMIT);
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

        {/* View toggle */}
        {currentRepo && (
          <div
            style={{
              marginTop: "var(--space-3)",
              display: "flex",
              gap: "var(--space-1)",
            }}
          >
            {(["history", "working-tree", "prs"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                style={{
                  flex: 1,
                  padding: "var(--space-1) var(--space-2)",
                  fontSize: "var(--font-size-xs)",
                  background:
                    view === v
                      ? "var(--color-bg-elevated)"
                      : "transparent",
                  color:
                    view === v
                      ? "var(--color-text-primary)"
                      : "var(--color-text-muted)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  fontWeight:
                    view === v
                      ? "var(--font-weight-semibold)"
                      : "var(--font-weight-normal)",
                }}
              >
                {v === "history" ? "History" : v === "working-tree" ? "Changes" : "PRs"}
              </button>
            ))}
          </div>
        )}

        {/* GitHub connection status */}
        <div
          style={{
            marginTop: "var(--space-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-2)",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-1)",
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isConnected ? "var(--color-success)" : "var(--color-text-muted)",
                flexShrink: 0,
              }}
            />
            {isConnected ? `Connected · ${githubHost}` : `Not connected · ${githubHost}`}
          </span>
          {isConnected ? (
            <button
              onClick={() => logout(githubHost)}
              style={{
                fontSize: "var(--font-size-xs)",
                padding: "1px var(--space-2)",
                background: "transparent",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text-muted)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => setShowConnectFlow(true)}
              style={{
                fontSize: "var(--font-size-xs)",
                padding: "1px var(--space-2)",
                background: "transparent",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Connect
            </button>
          )}
        </div>
      </div>

      <RemoteActions onOpenClone={() => setShowCloneDialog(true)} />

      {showConnectFlow && (
        <DeviceFlowModal host={githubHost} onClose={() => setShowConnectFlow(false)} />
      )}
      {showCloneDialog && (
        <CloneDialog host={githubHost} onClose={() => setShowCloneDialog(false)} />
      )}

      {/* Branch list */}
      {currentRepo && (
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
              Branches
            </span>
            <button
              onClick={() => setShowNewBranch((v) => !v)}
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
              + New
            </button>
          </div>

          {showNewBranch && (
            <div style={{ padding: "0 var(--space-3)", marginBottom: "var(--space-1)", display: "flex", gap: "var(--space-1)" }}>
              <input
                autoFocus
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBranch();
                  if (e.key === "Escape") { setShowNewBranch(false); setNewBranchName(""); }
                }}
                placeholder="branch-name"
                style={{
                  flex: 1,
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-family-mono)",
                  background: "var(--color-bg-input)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--color-text-primary)",
                  padding: "2px var(--space-2)",
                  outline: "none",
                }}
              />
              <button
                onClick={handleCreateBranch}
                style={{
                  fontSize: "var(--font-size-xs)",
                  padding: "2px var(--space-2)",
                  background: "var(--color-accent-primary)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Create
              </button>
            </div>
          )}

          {branches
            .filter((b) => !b.isRemote)
            .map((b) => (
              <div
                key={b.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "var(--space-1) var(--space-3)",
                  gap: "var(--space-1)",
                }}
              >
                <div
                  onClick={() => !b.isHead && checkoutBranch(b.name).then(() => fetchViewport(0, INITIAL_LIMIT))}
                  style={{
                    flex: 1,
                    fontSize: "var(--font-size-sm)",
                    fontFamily: "var(--font-family-mono)",
                    color: b.isHead
                      ? "var(--color-accent-primary)"
                      : "var(--color-text-secondary)",
                    cursor: b.isHead ? "default" : "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    background: b.isHead ? "var(--color-bg-elevated)" : "transparent",
                    borderRadius: "var(--radius-sm)",
                    padding: "1px var(--space-2)",
                  }}
                >
                  {b.isHead ? "▸ " : ""}{b.name}
                </div>
                {(() => {
                  const ab = aheadBehind.find((x) => x.branch === b.name);
                  if (!ab || (ab.ahead === 0 && ab.behind === 0)) return null;
                  return (
                    <span
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--color-text-muted)",
                        fontFamily: "var(--font-family-mono)",
                        flexShrink: 0,
                      }}
                    >
                      {ab.ahead > 0 && `↑${ab.ahead}`}
                      {ab.ahead > 0 && ab.behind > 0 && " "}
                      {ab.behind > 0 && `↓${ab.behind}`}
                    </span>
                  );
                })()}
                {!b.isHead && (
                  <button
                    onClick={() => handleDeleteBranch(b.name)}
                    title="Delete branch"
                    style={{
                      fontSize: "var(--font-size-xs)",
                      padding: "1px 4px",
                      background: "transparent",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--color-text-muted)",
                      cursor: "pointer",
                      flexShrink: 0,
                      opacity: 0.6,
                    }}
                  >
                    ×
                  </button>
                )}
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

      <StashPanel />
    </div>
  );
}
