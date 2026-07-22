import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type {
  BranchInfo,
  CreateWorktreeRequest,
  PrunableBranch,
  RemoveWorktreeResult,
  RepoEntry,
  RepoInfo,
  WorktreeEntry,
} from "../types/repo";
import { useGraphStore, GRAPH_INITIAL_LIMIT } from "./graphStore";
import { useMergeStore } from "./mergeStore";
import { useWorkingTreeStore } from "./workingTreeStore";
import { useToastStore } from "./toastStore";
import { withAutoStash } from "../lib/autoStash";
import type { AutoStashPrompt } from "./autoStashStore";
import { useHookStore } from "./hookStore";

// The confirmation shown when a checkout is blocked by uncommitted changes.
// "Park on switch": the changes are stashed and left in the stash panel.
function stashPrompt(action: string): AutoStashPrompt {
  return {
    title: "Uncommitted changes",
    message: `You have uncommitted changes that would be lost by ${action}. Stash them first and continue? Your changes will be saved to the stash panel.`,
    confirmLabel: "Stash & continue",
  };
}

function notifyParked(target: string): void {
  useToastStore
    .getState()
    .info(
      `Stashed your changes before switching to ${target} — find them in the stash panel.`,
    );
}

interface RepoStore {
  currentRepo: RepoInfo | null;
  recentRepos: RepoEntry[];
  branches: BranchInfo[];
  openRepos: RepoInfo[];
  worktrees: WorktreeEntry[];
  worktreesLoadedFor: string | null;
  showCreateWorktreeDialog: boolean;
  activeRepoPath: string | null;
  /** Monotonic counter bumped once per repo-switch (reloadActiveRepo,
   *  closeRepo's no-repos-left branch, newTab). Repo-scoped stores capture
   *  this at the start of an in-flight fetch and discard the result if it has
   *  moved by the time the fetch resolves — the same guard shape as
   *  graphStore's `fetchId`, but shared globally since it must be visible to
   *  other stores rather than a fetch-local counter. */
  activationEpoch: number;
  openRepo: (path: string) => Promise<void>;
  loadCurrentRepo: () => Promise<void>;
  loadOpenRepos: () => Promise<void>;
  activateRepo: (path: string) => Promise<void>;
  closeRepo: (path: string) => Promise<void>;
  newTab: () => void;
  loadRecentRepos: () => Promise<void>;
  /** Forget a repository in the recent list. Only removes our reference — the
   *  repository on disk is untouched. */
  removeRecent: (path: string) => Promise<void>;
  loadBranches: () => Promise<void>;
  /** Re-read HEAD from the backend and, if the checked-out branch changed
   *  (e.g. an external `git checkout` in a terminal), update `currentRepo` and
   *  reload the branch list so the "current branch" marker stays accurate. A
   *  no-op when HEAD is unchanged, so it's cheap to call on focus / on a poll. */
  syncHead: () => Promise<void>;
  checkoutBranch: (name: string) => Promise<boolean>;
  checkoutRemoteBranch: (remoteRef: string) => Promise<void>;
  checkoutCommit: (oid: string) => Promise<void>;
  createTag: (name: string, oid: string, message?: string) => Promise<void>;
  /** Revert a commit. With `autoCommit` it creates the revert commit; otherwise
   *  the inverse is left as unstaged working-tree changes. Returns the new
   *  commit oid (or null when not committed). */
  revertCommit: (oid: string, autoCommit: boolean) => Promise<string | null>;
  /** Squash a contiguous run of unpushed commits — which must include the branch
   *  tip — into a single commit with `message`. Returns the new commit oid. */
  squashCommits: (oids: string[], message: string) => Promise<string>;
  createBranch: (name: string, startPoint?: string) => Promise<void>;
  /** Advance local `branch` to `target` (a commit oid) when it's a fast-forward.
   *  Moves the branch pointer without checking it out unless it's current. */
  fastForwardBranch: (branch: string, target: string) => Promise<void>;
  /** The local branches that can be fast-forwarded to `target` (a commit oid). */
  listFastForwardableBranches: (target: string) => Promise<string[]>;
  renameBranch: (oldName: string, newName: string) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
  listPrunableBranches: () => Promise<PrunableBranch[]>;
  listWorktrees: () => Promise<WorktreeEntry[]>;
  createWorktree: (request: CreateWorktreeRequest) => Promise<void>;
  openParentRepo: (repoPath: string) => Promise<void>;
  lockWorktree: (repoPath: string) => Promise<void>;
  unlockWorktree: (repoPath: string) => Promise<void>;
  removeWorktree: (repoPath: string) => Promise<void>;
  openCreateWorktreeDialog: () => void;
  closeCreateWorktreeDialog: () => void;
}

export const useRepoStore = create<RepoStore>((set, get) => {
  // Reload everything that's scoped to the active repo: graph, branches, and
  // the working-tree / merge status. Called whenever the active tab changes.
  const reloadActiveRepo = async (repo: RepoInfo) => {
    set({
      currentRepo: repo,
      activeRepoPath: repo.path,
      activationEpoch: get().activationEpoch + 1,
    });
    // Clear the previous repo's graph (rows, cache, selection) so it doesn't
    // linger — the graph shows its loading skeleton until the new fetch lands.
    useGraphStore.getState().reset();
    // Likewise the previous repo's working-tree selection/diff/status — otherwise
    // a file selected in the old repo (or its stale diff) could linger into the
    // newly-activated one until the fresh status lands.
    useWorkingTreeStore.getState().reset();
    await Promise.all([
      useGraphStore.getState().fetchViewport(0, GRAPH_INITIAL_LIMIT),
      get().loadBranches(),
      useMergeStore.getState().loadStatus(),
      useWorkingTreeStore.getState().loadStatus(),
    ]);
  };

  return {
    currentRepo: null,
    recentRepos: [],
    branches: [],
    openRepos: [],
    worktrees: [],
    worktreesLoadedFor: null,
    showCreateWorktreeDialog: false,
    activeRepoPath: null,
    activationEpoch: 0,

    openRepo: async (path: string) => {
      const repo = await invoke<RepoInfo>("open_repo", { path });
      await get().loadOpenRepos();
      await reloadActiveRepo(repo);
    },

    loadCurrentRepo: async () => {
      const repo = await invoke<RepoInfo | null>("get_current_repo");
      set({
        currentRepo: repo,
        activeRepoPath: repo?.path ?? null,
      });
    },

    syncHead: async () => {
      const repo = await invoke<RepoInfo | null>("get_current_repo");
      if (!repo) return;
      const cur = get().currentRepo;
      // HEAD unchanged (same repo + same checked-out branch): nothing to do, so
      // we don't churn `currentRepo`'s identity or re-fetch the branch list.
      if (cur && cur.path === repo.path && cur.headBranch === repo.headBranch)
        return;
      set({ currentRepo: repo });
      await get().loadBranches();
    },

    loadOpenRepos: async () => {
      const repos = await invoke<RepoInfo[]>("list_open_repos");
      set({ openRepos: repos });
    },

    activateRepo: async (path: string) => {
      const repo = await invoke<RepoInfo>("activate_repo", { path });
      await reloadActiveRepo(repo);
    },

    closeRepo: async (path: string) => {
      const next = await invoke<RepoInfo | null>("close_repo", { path });
      useHookStore.getState().clearRepo(path);
      await get().loadOpenRepos();
      if (next) {
        await reloadActiveRepo(next);
      } else {
        set({
          currentRepo: null,
          activeRepoPath: null,
          branches: [],
          worktrees: [],
          worktreesLoadedFor: null,
          showCreateWorktreeDialog: false,
          activationEpoch: get().activationEpoch + 1,
        });
        useGraphStore.getState().reset();
        useWorkingTreeStore.getState().reset();
      }
    },

    // A "new tab": deselect the active repo (without closing any) so the app
    // shows the welcome/landing view. Existing tabs stay open; clicking one
    // re-activates it. Frontend-only — the backend's active repo is re-synced on
    // the next activate/open.
    newTab: () => {
      set({
        currentRepo: null,
        activeRepoPath: null,
        branches: [],
        showCreateWorktreeDialog: false,
        activationEpoch: get().activationEpoch + 1,
      });
      useGraphStore.getState().reset();
      useWorkingTreeStore.getState().reset();
    },

    // Called from several independent components (Sidebar, RepoPicker,
    // WelcomeView) on mount — catching here, rather than at each call site,
    // means a single fix covers all of them.
    loadRecentRepos: async () => {
      try {
        const repos = await invoke<RepoEntry[]>("get_recent_repos");
        set({ recentRepos: repos });
      } catch (e) {
        useToastStore
          .getState()
          .error(String(e), { title: "Couldn't load recent repositories" });
      }
    },

    removeRecent: async (path: string) => {
      const repos = await invoke<RepoEntry[]>("remove_recent_repo", { path });
      set({ recentRepos: repos });
    },

    loadBranches: async () => {
      const branches = await invoke<BranchInfo[]>("list_branches");
      set({ branches });
    },

    checkoutBranch: async (name: string) => {
      const repo = await withAutoStash(
        (autoStash) =>
          invoke<RepoInfo>("checkout_branch", { branchName: name, autoStash }),
        stashPrompt(`switching to "${name}"`),
        () => notifyParked(name),
      );
      if (!repo) return false; // user cancelled the auto-stash
      set({ currentRepo: repo });
      await get().loadBranches();
      await useGraphStore.getState().refresh();
      return true;
    },

    // Check out a remote-tracking branch (e.g. "origin/feature"): the backend
    // creates a local tracking branch of the same short name and switches to it.
    checkoutRemoteBranch: async (remoteRef: string) => {
      const repo = await withAutoStash(
        (autoStash) =>
          invoke<RepoInfo>("checkout_remote_branch", { remoteRef, autoStash }),
        stashPrompt(`switching to "${remoteRef}"`),
        () => notifyParked(remoteRef),
      );
      if (!repo) return;
      set({ currentRepo: repo });
      await get().loadBranches();
    },

    // Check out an arbitrary commit (detaches HEAD).
    checkoutCommit: async (oid: string) => {
      const repo = await withAutoStash(
        (autoStash) => invoke<RepoInfo>("checkout_commit", { oid, autoStash }),
        stashPrompt(`checking out ${oid.slice(0, 7)}`),
        () => notifyParked(oid.slice(0, 7)),
      );
      if (!repo) return;
      set({ currentRepo: repo });
      await get().loadBranches();
    },

    createTag: async (name: string, oid: string, message?: string) => {
      await invoke("create_tag", { name, oid, message: message ?? null });
      await get().loadBranches();
    },

    revertCommit: async (oid: string, autoCommit: boolean) => {
      const result = await invoke<string | null>("revert_commit", {
        oid,
        autoCommit,
      });
      // A revert either adds a commit or leaves unstaged changes — one combined
      // refresh updates the working-tree status, the graph's dirty count, and the
      // viewport (a single status scan rather than two).
      await useWorkingTreeStore.getState().refreshAll();
      return result;
    },

    squashCommits: async (oids: string[], message: string) => {
      const newOid = await invoke<string>("squash_commits", { oids, message });
      // HEAD/the branch tip moved; refresh the graph and branch list together.
      // The working tree is untouched by a squash, but refreshAll is the single
      // combined refresh used elsewhere and keeps the dirty count consistent.
      await useWorkingTreeStore.getState().refreshAll();
      await get().loadBranches();
      return newOid;
    },

    createBranch: async (name: string, startPoint?: string) => {
      await invoke("create_branch", { name, startPoint: startPoint ?? null });
      await get().loadBranches();
      await useGraphStore.getState().refresh();
    },

    fastForwardBranch: async (branch: string, target: string) => {
      await invoke("fast_forward_branch", { branch, target });
      // The move may have updated the working tree (if `branch` was current), so
      // refresh the graph and branch list together.
      await useWorkingTreeStore.getState().refreshAll();
      await get().loadBranches();
    },

    listFastForwardableBranches: (target: string) =>
      invoke<string[]>("list_fast_forwardable_branches", { target }),

    renameBranch: async (oldName: string, newName: string) => {
      await invoke("rename_branch", { oldName, newName });
      await get().loadBranches();
    },

    deleteBranch: async (name: string) => {
      await invoke("delete_branch", { name });
      await get().loadBranches();
      await useGraphStore.getState().refresh();
    },

    listPrunableBranches: async () => {
      return invoke<PrunableBranch[]>("list_prunable_branches");
    },

    listWorktrees: async () => {
      const repoPath = get().currentRepo?.path;
      if (!repoPath) {
        set({ worktrees: [], worktreesLoadedFor: null });
        return [];
      }
      const worktrees = await invoke<WorktreeEntry[]>("list_worktrees", {
        repoPath,
      });
      if (get().currentRepo?.path !== repoPath) {
        return [];
      }
      set({ worktrees, worktreesLoadedFor: repoPath });
      return worktrees;
    },

    createWorktree: async (request: CreateWorktreeRequest) => {
      const repo = await invoke<RepoInfo>("create_worktree", {
        repoPath: get().currentRepo?.path ?? null,
        targetPath: request.targetPath,
        mode: request.mode,
        branchName: request.branchName ?? null,
        startPoint: request.startPoint ?? null,
      });
      await get().loadOpenRepos();
      await reloadActiveRepo(repo);
      await get().listWorktrees();
      set({ showCreateWorktreeDialog: false });
    },

    openParentRepo: async (repoPath: string) => {
      const repo = await invoke<RepoInfo>("open_parent_repo", {
        repoPath,
      });
      await get().loadOpenRepos();
      await reloadActiveRepo(repo);
      await get().listWorktrees();
    },

    lockWorktree: async (repoPath: string) => {
      const repo = await invoke<RepoInfo>("lock_worktree", { repoPath });
      if (get().currentRepo?.path === repo.path) {
        set({ currentRepo: repo });
      }
      await get().loadOpenRepos();
      await get().listWorktrees();
    },

    unlockWorktree: async (repoPath: string) => {
      const repo = await invoke<RepoInfo>("unlock_worktree", { repoPath });
      if (get().currentRepo?.path === repo.path) {
        set({ currentRepo: repo });
      }
      await get().loadOpenRepos();
      await get().listWorktrees();
    },

    removeWorktree: async (repoPath: string) => {
      const result = await invoke<RemoveWorktreeResult>("remove_worktree", {
        repoPath,
      });
      await get().loadOpenRepos();
      if (result.activeRepo) {
        await reloadActiveRepo(result.activeRepo);
      } else {
        set({
          currentRepo: null,
          activeRepoPath: null,
          branches: [],
          worktrees: [],
          worktreesLoadedFor: null,
          showCreateWorktreeDialog: false,
          activationEpoch: get().activationEpoch + 1,
        });
        useGraphStore.getState().reset();
        useWorkingTreeStore.getState().reset();
      }
      await get().listWorktrees();
    },

    openCreateWorktreeDialog: () => {
      set({ showCreateWorktreeDialog: true });
    },

    closeCreateWorktreeDialog: () => {
      set({ showCreateWorktreeDialog: false });
    },
  };
});
