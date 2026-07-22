import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import { useGithubStore } from "../../stores/githubStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useMergeStore } from "../../stores/mergeStore";
import { useToastStore } from "../../stores/toastStore";
import { StashPanel } from "./StashPanel";
import { CollapsibleSection } from "./CollapsibleSection";
import { RowMenu } from "./RowMenu";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { BranchIcon, GitHubIcon, LaptopIcon } from "../ui/icons";
import { RemoteActions } from "./RemoteActions";
import { CloneDialog } from "../GitHub/CloneDialog";
import { PruneBranchesDialog } from "./PruneBranchesDialog";
import { PromptDialog } from "../common/PromptDialog";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { VirtualList } from "../ui/VirtualList";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { WorktreePanel } from "./WorktreePanel";
import type { BranchInfo } from "../../types/repo";

// Fixed row height for the virtualised branch lists — sized to fit the ⋮ menu
// button (24px, `control-height-sm`) plus the row's vertical padding (2×4px).
const BRANCH_ROW_HEIGHT = 32;

const branchRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "var(--space-1) var(--space-3)",
  gap: "var(--space-1)",
  height: "100%",
  boxSizing: "border-box",
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

/**
 * One row in the Local branches list. Ahead/behind is fetched on demand for
 * this specific branch (not eagerly for every branch — see
 * `remoteStore.requestAheadBehind`): `VirtualList` only mounts rows currently
 * in view, so this effect firing only for mounted rows is what makes the
 * fetch "per visible row" without any extra viewport-tracking plumbing.
 */
function LocalBranchRow({
  b,
  onReveal,
  onCheckout,
  onFastForward,
  onPush,
  onCreateTag,
  onMerge,
  onDelete,
  canMerge,
}: {
  b: BranchInfo;
  onReveal: (oid: string) => void;
  onCheckout: (name: string) => void;
  onFastForward: (name: string) => void;
  onPush: (name: string) => void;
  onCreateTag: (name: string, oid: string) => void;
  onMerge: (name: string) => void;
  onDelete: (name: string) => void;
  canMerge: boolean;
}) {
  const entry = useRemoteStore((s) => s.aheadBehind.get(b.name));
  const epoch = useRemoteStore((s) => s.aheadBehindEpoch);
  const requestAheadBehind = useRemoteStore((s) => s.requestAheadBehind);

  useEffect(() => {
    requestAheadBehind(b.name);
  }, [b.name, epoch, requestAheadBehind]);

  const ab = entry && entry !== "loading" && entry !== "none" ? entry : null;
  const showAheadBehind = ab && (ab.ahead > 0 || ab.behind > 0);

  return (
    <div className="sidebar-row" style={branchRowStyle}>
      <span style={branchIconStyle} title="Local branch">
        <LaptopIcon />
      </span>
      <div
        onClick={() => onReveal(b.oid)}
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
        {b.isHead ? "▸ " : ""}
        {b.name}
      </div>
      {showAheadBehind && (
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
      )}
      <RowMenu
        label={`${b.name} actions`}
        items={[
          ...(b.isHead
            ? []
            : [
                {
                  label: "Checkout branch",
                  onSelect: () => onCheckout(b.name),
                },
              ]),
          // A clean fast-forward is available: behind the upstream with no local
          // commits ahead. Advances the branch pointer without checking it out.
          ...(ab && ab.behind > 0 && ab.ahead === 0
            ? [
                {
                  label: `Fast-forward to ${b.upstream ?? "upstream"}`,
                  onSelect: () => onFastForward(b.name),
                },
              ]
            : []),
          { label: "Push branch", onSelect: () => onPush(b.name) },
          { label: "Create tag…", onSelect: () => onCreateTag(b.name, b.oid) },
          ...(b.isHead || !canMerge
            ? []
            : [
                {
                  label: "Merge into current branch",
                  onSelect: () => onMerge(b.name),
                },
              ]),
          ...(b.isHead
            ? []
            : [
                {
                  label: "Delete branch",
                  destructive: true,
                  onSelect: () => onDelete(b.name),
                },
              ]),
        ]}
      />
    </div>
  );
}

export function Sidebar({ width = 220 }: { width?: number }) {
  const {
    currentRepo,
    recentRepos,
    branches,
    worktrees,
    openRepos,
    activeRepoPath,
    openRepo,
    activateRepo,
    openParentRepo,
    listWorktrees,
    createWorktree,
    lockWorktree,
    unlockWorktree,
    removeWorktree,
    showCreateWorktreeDialog,
    openCreateWorktreeDialog,
    closeCreateWorktreeDialog,
    loadRecentRepos,
    removeRecent,
    checkoutBranch,
    createBranch,
    deleteBranch,
    createTag,
  } = useRepoStore();
  const { revealCommit, refresh } = useGraphStore();
  const { remoteInfo } = useGithubStore();
  const { push, fastForwardToUpstream } = useRemoteStore();
  const { status: operationStatus, startMerge } = useMergeStore();
  const toastSuccess = useToastStore((s) => s.success);
  const toastError = useToastStore((s) => s.error);
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showPruneDialog, setShowPruneDialog] = useState(false);
  const [selectedRecentPath, setSelectedRecentPath] = useState<string | null>(
    null,
  );
  // The branch being tagged via "Create tag…" (its tip oid), while the name is entered.
  const [tagBranch, setTagBranch] = useState<{
    name: string;
    oid: string;
  } | null>(null);
  // The branch awaiting delete confirmation.
  const [pendingDeleteBranch, setPendingDeleteBranch] = useState<string | null>(
    null,
  );
  const [pendingRemoveWorktree, setPendingRemoveWorktree] = useState<
    string | null
  >(null);

  // GitHub connection is managed in Settings now; the host is still needed for
  // the "Clone from GitHub…" dialog.
  const githubHost = remoteInfo?.host ?? "github.com";

  useEffect(() => {
    void loadRecentRepos();
  }, [loadRecentRepos]);

  useEffect(() => {
    if (!currentRepo?.path) return;
    void listWorktrees();
  }, [currentRepo?.path, listWorktrees]);

  // Branch list, ahead/behind, and remote detection are loaded at the app root
  // (App) on repo change, so they stay correct even when this sidebar is
  // collapsed (and thus unmounted).

  const handleRecentClick = async (path: string) => {
    try {
      await openRepo(path);
    } catch (e) {
      toastError(String(e), { title: "Couldn't open repository" });
    }
  };

  const handleOpenOrActivateWorktree = async (path: string) => {
    try {
      if (path === activeRepoPath) return;
      const isOpen = openRepos.some((repo) => repo.path === path);
      if (isOpen) {
        await activateRepo(path);
      } else {
        await openRepo(path);
      }
    } catch (e) {
      toastError(String(e), { title: "Couldn't open worktree" });
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    try {
      await createBranch(newBranchName.trim());
      setNewBranchName("");
      setShowNewBranch(false);
    } catch (e) {
      toastError(String(e), { title: "Couldn't create branch" });
    }
  };

  const handleLockWorktree = async (path: string) => {
    try {
      await lockWorktree(path);
    } catch (e) {
      toastError(String(e), { title: "Couldn't lock worktree" });
    }
  };

  const handleUnlockWorktree = async (path: string) => {
    try {
      await unlockWorktree(path);
    } catch (e) {
      toastError(String(e), { title: "Couldn't unlock worktree" });
    }
  };

  const handleRemoveWorktree = async (path: string) => {
    try {
      await removeWorktree(path);
    } catch (e) {
      toastError(String(e), { title: "Couldn't remove worktree" });
    }
  };

  const handleDeleteBranch = async (name: string) => {
    try {
      await deleteBranch(name);
    } catch (e) {
      toastError(String(e), { title: "Couldn't delete branch" });
    }
  };

  const handleCheckoutBranch = async (name: string) => {
    try {
      await checkoutBranch(name);
    } catch (e) {
      toastError(String(e), { title: "Couldn't checkout branch" });
    }
  };

  const handleMergeBranch = async (name: string) => {
    try {
      await startMerge(name);
    } catch (e) {
      toastError(String(e), { title: "Merge failed" });
    }
  };

  const handleCreateTag = async (tagName: string) => {
    const target = tagBranch;
    setTagBranch(null);
    if (!target) return;
    try {
      await createTag(tagName, target.oid);
      await refresh();
      toastSuccess(`Created tag ${tagName}`);
    } catch (e) {
      toastError(String(e));
    }
  };

  const handlePushBranch = async (name: string) => {
    try {
      await push(undefined, name);
      toastSuccess(`Pushed ${name}`);
    } catch (e) {
      toastError(String(e), { title: "Push failed" });
    }
  };

  const handleFastForwardToUpstream = async (name: string) => {
    try {
      await fastForwardToUpstream(name);
      toastSuccess(`Fast-forwarded ${name} to its upstream`);
      await refresh();
    } catch (e) {
      toastError(String(e), { title: "Fast-forward failed" });
    }
  };

  const locals = branches.filter((b) => !b.isRemote);
  // Always float the checked-out branch to the top of the local list; keep the
  // rest in their existing order.
  const localBranches = [
    ...locals.filter((b) => b.isHead),
    ...locals.filter((b) => !b.isHead),
  ];
  const remoteBranches = branches.filter((b) => b.isRemote);

  // Row renderers for the virtualised branch lists (see VirtualList). One row per
  // branch; the list only mounts the visible slice, so this is called for those.
  const renderLocalBranch = (b: (typeof localBranches)[number]) => (
    <LocalBranchRow
      b={b}
      onReveal={(oid) => void revealCommit(oid)}
      onCheckout={(name) => void handleCheckoutBranch(name)}
      onFastForward={(name) => void handleFastForwardToUpstream(name)}
      onPush={(name) => void handlePushBranch(name)}
      onCreateTag={(name, oid) => setTagBranch({ name, oid })}
      onMerge={(name) => void handleMergeBranch(name)}
      onDelete={(name) => setPendingDeleteBranch(name)}
      canMerge={operationStatus.kind !== "merge"}
    />
  );

  const renderRemoteBranch = (b: (typeof remoteBranches)[number]) => (
    <div className="sidebar-row" style={branchRowStyle}>
      <span style={branchIconStyle} title="Remote branch">
        <GitHubIcon />
      </span>
      <div
        onClick={() => void revealCommit(b.oid)}
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
  );

  return (
    <div
      className="elevation-right"
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
          <>
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
              {currentRepo.worktreeBranch ??
                currentRepo.headBranch ??
                "detached"}
            </div>
            {currentRepo.repoKind === "worktree" &&
              currentRepo.parentRepoPath && (
                <div
                  style={{
                    marginTop: "var(--space-1)",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {`Linked to ${currentRepo.parentRepoPath}`}
                </div>
              )}
            {currentRepo.worktreeLocked && (
              <div style={{ marginTop: "var(--space-1)" }}>
                <span
                  style={{
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
                  }}
                >
                  Locked
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Scrollable middle region */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <RemoteActions onOpenClone={() => setShowCloneDialog(true)} />

        {showCloneDialog && (
          <CloneDialog
            host={githubHost}
            onClose={() => setShowCloneDialog(false)}
          />
        )}

        {showPruneDialog && (
          <PruneBranchesDialog onClose={() => setShowPruneDialog(false)} />
        )}

        {tagBranch && (
          <PromptDialog
            title="Create tag"
            label="Tag name"
            confirmLabel="Create"
            onConfirm={(tagName) => void handleCreateTag(tagName)}
            onCancel={() => setTagBranch(null)}
          />
        )}

        {pendingDeleteBranch && (
          <ConfirmDialog
            title="Delete branch"
            message={`Delete "${pendingDeleteBranch}"? Git Wasp deletes branches unconditionally (unlike "git branch -d"), so if it has commits not merged or pushed anywhere else, they will be permanently lost.`}
            confirmLabel="Delete"
            onConfirm={() => {
              const name = pendingDeleteBranch;
              setPendingDeleteBranch(null);
              void handleDeleteBranch(name);
            }}
            onCancel={() => setPendingDeleteBranch(null)}
          />
        )}

        {pendingRemoveWorktree && (
          <ConfirmDialog
            title="Remove worktree"
            message={`Remove worktree at "${pendingRemoveWorktree}"?`}
            confirmLabel="Remove"
            onConfirm={() => {
              const path = pendingRemoveWorktree;
              setPendingRemoveWorktree(null);
              void handleRemoveWorktree(path);
            }}
            onCancel={() => setPendingRemoveWorktree(null)}
          />
        )}

        {showCreateWorktreeDialog && (
          <CreateWorktreeDialog
            defaultStartPoint={
              currentRepo?.worktreeBranch ?? currentRepo?.headBranch ?? ""
            }
            onCancel={closeCreateWorktreeDialog}
            onConfirm={(request) => {
              void createWorktree(request);
            }}
          />
        )}

        {/* Branch list */}
        {currentRepo && (
          <WorktreePanel
            currentRepoPath={currentRepo.path}
            worktrees={worktrees}
            onOpenOrActivate={(path) => void handleOpenOrActivateWorktree(path)}
            onRefresh={() => void listWorktrees()}
            onCreate={openCreateWorktreeDialog}
            onOpenParent={(path) => void openParentRepo(path)}
            onLock={(path) => void handleLockWorktree(path)}
            onUnlock={(path) => void handleUnlockWorktree(path)}
            onRemove={setPendingRemoveWorktree}
          />
        )}

        {currentRepo && (
          <CollapsibleSection
            id="branches"
            title="Branches"
            containsSections
            action={
              <div style={{ display: "flex", gap: "var(--space-1)" }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowPruneDialog(true)}
                  title="Delete local branches whose remote branch is gone"
                >
                  Prune
                </Button>
                <Button size="sm" onClick={() => setShowNewBranch((v) => !v)}>
                  <BranchIcon size={12} />
                  New
                </Button>
              </div>
            }
          >
            {showNewBranch && (
              <div
                style={{
                  padding: "0 var(--space-3)",
                  marginBottom: "var(--space-1)",
                  display: "flex",
                  gap: "var(--space-1)",
                }}
              >
                <Input
                  autoFocus
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateBranch();
                    if (e.key === "Escape") {
                      setShowNewBranch(false);
                      setNewBranchName("");
                    }
                  }}
                  placeholder="branch-name"
                  style={{ flex: 1, fontFamily: "var(--font-family-mono)" }}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleCreateBranch()}
                >
                  Create
                </Button>
              </div>
            )}

            <CollapsibleSection
              id="branches-local"
              title="Local"
              resizable
              defaultHeight={180}
            >
              {(maxBodyHeight) =>
                localBranches.length === 0 ? (
                  <div style={branchEmptyHintStyle}>No local branches</div>
                ) : (
                  <VirtualList
                    ariaLabel="Local branches"
                    items={localBranches}
                    rowHeight={BRANCH_ROW_HEIGHT}
                    maxHeight={maxBodyHeight}
                    render={renderLocalBranch}
                  />
                )
              }
            </CollapsibleSection>

            <CollapsibleSection
              id="branches-remote"
              title="Remote"
              resizable
              defaultHeight={140}
            >
              {(maxBodyHeight) =>
                remoteBranches.length === 0 ? (
                  <div style={branchEmptyHintStyle}>No remote branches</div>
                ) : (
                  <VirtualList
                    ariaLabel="Remote branches"
                    items={remoteBranches}
                    rowHeight={BRANCH_ROW_HEIGHT}
                    maxHeight={maxBodyHeight}
                    render={renderRemoteBranch}
                  />
                )
              }
            </CollapsibleSection>
          </CollapsibleSection>
        )}

        {/* Recent repos */}
        {recentRepos.length > 0 && (
          <CollapsibleSection
            id="recent"
            title="Recent"
            resizable
            defaultHeight={160}
          >
            {recentRepos.map((r) => (
              <div
                key={r.path}
                className="sidebar-row"
                data-active={selectedRecentPath === r.path}
                onClick={() =>
                  setSelectedRecentPath((current) =>
                    current === r.path ? null : r.path,
                  )
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-1) var(--space-3)",
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
                  items={[
                    {
                      label: "Open repository",
                      onSelect: () => void handleRecentClick(r.path),
                    },
                    {
                      label: "Remove from recent",
                      destructive: true,
                      onSelect: () => {
                        setSelectedRecentPath((current) =>
                          current === r.path ? null : current,
                        );
                        void removeRecent(r.path);
                      },
                    },
                  ]}
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
