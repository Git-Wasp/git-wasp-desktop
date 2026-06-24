import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import { useGithubStore } from "../../stores/githubStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useMergeStore } from "../../stores/mergeStore";
import { StashPanel } from "./StashPanel";
import { CollapsibleSection } from "./CollapsibleSection";
import { RowMenu } from "./RowMenu";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { BranchIcon, GitHubIcon, LaptopIcon } from "../ui/icons";
import { RemoteActions } from "./RemoteActions";
import { CloneDialog } from "../GitHub/CloneDialog";

const INITIAL_LIMIT = 150;

const branchRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "var(--space-1) var(--space-3)",
  gap: "var(--space-1)",
};

const branchIconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  color: "var(--color-text-muted)",
  flexShrink: 0,
};

const branchEmptyHintStyle: CSSProperties = {
  padding: "var(--space-1) var(--space-3)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

export function Sidebar({ width = 220 }: { width?: number }) {
  const { currentRepo, recentRepos, branches, openRepo, loadRecentRepos, loadBranches, checkoutBranch, createBranch, deleteBranch } =
    useRepoStore();
  const { fetchViewport, revealCommit } = useGraphStore();
  const { remoteInfo, detectRemote } = useGithubStore();
  const { aheadBehind, loadAheadBehind } = useRemoteStore();
  const { status: operationStatus, startMerge } = useMergeStore();
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [selectedRecentPath, setSelectedRecentPath] = useState<string | null>(null);

  // GitHub connection is managed in Settings now; the host is still needed for
  // the "Clone from GitHub…" dialog.
  const githubHost = remoteInfo?.host ?? "github.com";

  useEffect(() => {
    loadRecentRepos();
  }, [loadRecentRepos]);

  useEffect(() => {
    if (currentRepo) {
      loadBranches();
      loadAheadBehind();
      // remoteInfo is detected once at startup; re-detect whenever the open
      // repo changes so switching to a repo with a different (or no) GitHub
      // remote is reflected in the PR panel and clone/connect flows.
      detectRemote();
    }
  }, [currentRepo, loadBranches, loadAheadBehind, detectRemote]);

  const handleRecentClick = async (path: string) => {
    await openRepo(path);
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

  const handleCheckoutBranch = async (name: string) => {
    await checkoutBranch(name);
    await fetchViewport(0, INITIAL_LIMIT);
  };

  const handleMergeBranch = async (name: string) => {
    await startMerge(name);
  };

  const localBranches = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote);

  return (
    <div
      style={{
        width,
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
          flexShrink: 0,
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
      </div>

      {/* Scrollable middle region */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <RemoteActions onOpenClone={() => setShowCloneDialog(true)} />

      {showCloneDialog && (
        <CloneDialog host={githubHost} onClose={() => setShowCloneDialog(false)} />
      )}

      {/* Branch list */}
      {currentRepo && (
        <CollapsibleSection
          id="branches"
          title="Branches"
          action={
            <Button size="sm" onClick={() => setShowNewBranch((v) => !v)}>
              <BranchIcon size={12} />
              New
            </Button>
          }
        >
          {showNewBranch && (
            <div style={{ padding: "0 var(--space-3)", marginBottom: "var(--space-1)", display: "flex", gap: "var(--space-1)" }}>
              <Input
                autoFocus
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBranch();
                  if (e.key === "Escape") {
                    setShowNewBranch(false);
                    setNewBranchName("");
                  }
                }}
                placeholder="branch-name"
                style={{ flex: 1, fontFamily: "var(--font-family-mono)" }}
              />
              <Button variant="primary" size="sm" onClick={handleCreateBranch}>
                Create
              </Button>
            </div>
          )}

          <CollapsibleSection id="branches-local" title="Local" bodyStyle={{ overflowY: "auto", maxHeight: 200 }}>
            {localBranches.length === 0 ? (
              <div style={branchEmptyHintStyle}>No local branches</div>
            ) : (
              localBranches.map((b) => (
                <div key={b.name} style={branchRowStyle}>
                  <span style={branchIconStyle} title="Local branch">
                    <LaptopIcon />
                  </span>
                  <div
                    onClick={() => revealCommit(b.oid)}
                    title={`Show ${b.name} in the commit graph`}
                    style={{
                      flex: 1,
                      fontSize: "var(--font-size-sm)",
                      fontFamily: "var(--font-family-mono)",
                      color: b.isHead
                        ? "var(--color-accent-primary)"
                        : "var(--color-text-secondary)",
                      cursor: "pointer",
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
                  <RowMenu
                    label={`${b.name} actions`}
                    items={[
                      ...(b.isHead
                        ? []
                        : [{ label: "Checkout branch", onSelect: () => handleCheckoutBranch(b.name) }]),
                      ...(b.isHead || operationStatus.kind === "merge"
                        ? []
                        : [{ label: "Merge into current branch", onSelect: () => handleMergeBranch(b.name) }]),
                      ...(b.isHead
                        ? []
                        : [{ label: "Delete branch", destructive: true, onSelect: () => handleDeleteBranch(b.name) }]),
                    ]}
                  />
                </div>
              ))
            )}
          </CollapsibleSection>

          <CollapsibleSection id="branches-remote" title="Remote" bodyStyle={{ overflowY: "auto", maxHeight: 200 }}>
            {remoteBranches.length === 0 ? (
              <div style={branchEmptyHintStyle}>No remote branches</div>
            ) : (
              remoteBranches.map((b) => (
                <div key={b.name} style={branchRowStyle}>
                  <span style={branchIconStyle} title="Remote branch">
                    <GitHubIcon />
                  </span>
                  <div
                    onClick={() => revealCommit(b.oid)}
                    title={`Show ${b.name} in the commit graph`}
                    style={{
                      flex: 1,
                      fontSize: "var(--font-size-sm)",
                      fontFamily: "var(--font-family-mono)",
                      color: "var(--color-text-secondary)",
                      cursor: "pointer",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      padding: "1px var(--space-2)",
                    }}
                  >
                    {b.name}
                  </div>
                </div>
              ))
            )}
          </CollapsibleSection>
        </CollapsibleSection>
      )}

      {/* Recent repos */}
      {recentRepos.length > 0 && (
        <CollapsibleSection id="recent" title="Recent" bodyStyle={{ overflowY: "auto" }}>
          {recentRepos.map((r) => (
            <div
              key={r.path}
              onClick={() => setSelectedRecentPath((current) => (current === r.path ? null : r.path))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding: "var(--space-1) var(--space-3)",
                background: selectedRecentPath === r.path ? "var(--color-bg-elevated)" : "transparent",
                cursor: "pointer",
              }}
              title={r.path}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: "var(--font-size-sm)",
                  color: "var(--color-text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.name}
              </span>
              <RowMenu
                label={`${r.name} actions`}
                items={[{ label: "Open repository", onSelect: () => handleRecentClick(r.path) }]}
              />
            </div>
          ))}
        </CollapsibleSection>
      )}

      <StashPanel />
      </div>
    </div>
  );
}
