import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "../repoStore";
import { useGraphStore } from "../graphStore";
import { useWorkingTreeStore } from "../workingTreeStore";
import { useAutoStashStore } from "../autoStashStore";
import { useToastStore } from "../toastStore";
import { useHookStore } from "../hookStore";
import { AUTO_STASH_SENTINEL } from "../../lib/autoStash";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({
    currentRepo: null,
    recentRepos: [],
    branches: [],
    openRepos: [],
    activeRepoPath: null,
    activationEpoch: 0,
  });
  // reloadActiveRepo (triggered by openRepo/activateRepo/closeRepo) drives
  // graphStore's fetchViewport, which now caches fetched rows — reset it too
  // so one test's cached (possibly empty) viewport can't mask another's
  // get_graph_viewport call.
  useGraphStore.setState({
    viewport: null,
    lastOffset: null,
    lastLimit: null,
    nodesByRow: new Map(),
  });
  useAutoStashStore.setState({ pending: null });
  useHookStore.setState({ runs: {} });
});

const emptyGraphViewport = { nodes: [], totalCount: 0, offset: 0 };

// Resolve invoke by command name so multi-step actions (which fire several
// invokes via the shared reloadActiveRepo routine) don't depend on call order.
// get_graph_viewport defaults to an empty viewport unless overridden, since
// reloadActiveRepo always fetches it and graphStore expects a real shape.
function mockByCommand(map: Record<string, unknown>) {
  const withDefaults: Record<string, unknown> = {
    get_graph_viewport: emptyGraphViewport,
    ...map,
  };
  mockInvoke.mockImplementation((cmd: string) =>
    Promise.resolve(cmd in withDefaults ? withDefaults[cmd] : undefined),
  );
}

describe("repoStore", () => {
  it("openRepo calls open_repo and updates currentRepo", async () => {
    const fakeRepo = {
      name: "myrepo",
      path: "/tmp/myrepo",
      headBranch: "main",
    };
    mockByCommand({ open_repo: fakeRepo });

    await useRepoStore.getState().openRepo("/tmp/myrepo");

    expect(mockInvoke).toHaveBeenCalledWith("open_repo", {
      path: "/tmp/myrepo",
    });
    expect(useRepoStore.getState().currentRepo).toEqual(fakeRepo);
  });

  it("loadCurrentRepo updates currentRepo to null when no repo open", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    await useRepoStore.getState().loadCurrentRepo();
    expect(useRepoStore.getState().currentRepo).toBeNull();
  });

  it("syncHead updates currentRepo and reloads branches when HEAD changed externally", async () => {
    useRepoStore.setState({
      currentRepo: { name: "r", path: "/p", headBranch: "develop" },
    });
    const branches = [{ name: "feature", isHead: true }];
    mockByCommand({
      get_current_repo: { name: "r", path: "/p", headBranch: "feature" },
      list_branches: branches,
    });

    await useRepoStore.getState().syncHead();

    expect(useRepoStore.getState().currentRepo?.headBranch).toBe("feature");
    expect(useRepoStore.getState().branches).toEqual(branches);
  });

  it("syncHead is a no-op when HEAD is unchanged (no branch reload)", async () => {
    const current = { name: "r", path: "/p", headBranch: "develop" };
    useRepoStore.setState({ currentRepo: current });
    mockByCommand({ get_current_repo: { ...current } });

    await useRepoStore.getState().syncHead();

    // Same branch → currentRepo identity preserved and list_branches not called.
    expect(useRepoStore.getState().currentRepo).toBe(current);
    expect(mockInvoke).not.toHaveBeenCalledWith("list_branches");
  });

  it("loadRecentRepos populates recentRepos", async () => {
    const repos = [{ path: "/a", name: "a", pinned: false, lastOpened: 0 }];
    mockInvoke.mockResolvedValueOnce(repos);
    await useRepoStore.getState().loadRecentRepos();
    expect(useRepoStore.getState().recentRepos).toEqual(repos);
  });

  it("shows a toast instead of throwing when loadRecentRepos fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    const error = vi.fn();
    useToastStore.setState({ error });

    await useRepoStore.getState().loadRecentRepos();

    expect(error).toHaveBeenCalledWith("Error: boom", {
      title: "Couldn't load recent repositories",
    });
  });

  it("removeRecent drops the entry and stores the returned list", async () => {
    const remaining = [{ path: "/b", name: "b", pinned: false, lastOpened: 0 }];
    mockInvoke.mockResolvedValueOnce(remaining);

    await useRepoStore.getState().removeRecent("/a");

    expect(mockInvoke).toHaveBeenCalledWith("remove_recent_repo", {
      path: "/a",
    });
    expect(useRepoStore.getState().recentRepos).toEqual(remaining);
  });

  it("listWorktrees stores the returned family for the active repo", async () => {
    const repo = {
      name: "main",
      path: "/repos/main",
      headBranch: "main",
      repoKind: "main",
      parentRepoPath: null,
      commonDirPath: "/repos/main/.git",
      worktreeBranch: "main",
      worktreeLocked: false,
      worktreePrunable: false,
    };
    const family = [
      {
        path: "/repos/main",
        name: "main",
        repoKind: "main",
        branch: "main",
        isCurrent: true,
        isOpen: true,
        isLocked: false,
        hasUncommittedChanges: false,
        parentRepoPath: null,
      },
    ];
    useRepoStore.setState({ currentRepo: repo });
    mockByCommand({ list_worktrees: family });

    await useRepoStore.getState().listWorktrees();

    expect(mockInvoke).toHaveBeenCalledWith("list_worktrees", {
      repoPath: "/repos/main",
    });
    expect(useRepoStore.getState().worktrees).toEqual(family);
  });

  it("openParentRepo activates the returned parent tab for the selected row path", async () => {
    const parent = {
      name: "main",
      path: "/repos/main",
      headBranch: "main",
      repoKind: "main",
      parentRepoPath: null,
      commonDirPath: "/repos/main/.git",
      worktreeBranch: "main",
      worktreeLocked: false,
      worktreePrunable: false,
    };
    mockByCommand({ open_parent_repo: parent, list_branches: [] });

    await useRepoStore.getState().openParentRepo("/repos/main-feature");

    expect(mockInvoke).toHaveBeenCalledWith("open_parent_repo", {
      repoPath: "/repos/main-feature",
    });
    expect(useRepoStore.getState().currentRepo?.path).toBe("/repos/main");
  });

  it("loadCurrentRepo followed by listWorktrees stores the family for a linked worktree tab", async () => {
    const repo = {
      name: "main-feature",
      path: "/repos/main-feature",
      headBranch: "feature/worktree",
      repoKind: "worktree",
      parentRepoPath: "/repos/main",
      commonDirPath: "/repos/main/.git",
      worktreeBranch: "feature/worktree",
      worktreeLocked: false,
      worktreePrunable: false,
    };
    mockByCommand({
      get_current_repo: repo,
      list_worktrees: [
        {
          path: "/repos/main",
          name: "main",
          repoKind: "main",
          branch: "main",
          isCurrent: false,
          isOpen: false,
          isLocked: false,
          hasUncommittedChanges: false,
          parentRepoPath: null,
        },
        {
          path: "/repos/main-feature",
          name: "main-feature",
          repoKind: "worktree",
          branch: "feature/worktree",
          isCurrent: true,
          isOpen: true,
          isLocked: false,
          hasUncommittedChanges: false,
          parentRepoPath: "/repos/main",
        },
      ],
    });

    await useRepoStore.getState().loadCurrentRepo();
    await useRepoStore.getState().listWorktrees();

    expect(useRepoStore.getState().worktrees).toHaveLength(2);
  });

  it("removeWorktree closes the removed active tab and switches to the returned active repo", async () => {
    useRepoStore.setState({
      currentRepo: {
        name: "main-feature",
        path: "/repos/main-feature",
        headBranch: "feature/worktree",
        repoKind: "worktree",
        parentRepoPath: "/repos/main",
        commonDirPath: "/repos/main/.git",
        worktreeBranch: "feature/worktree",
        worktreeLocked: false,
        worktreePrunable: false,
      },
    });
    mockByCommand({
      remove_worktree: {
        removedPath: "/repos/main-feature",
        closedTab: true,
        activeRepo: {
          name: "main",
          path: "/repos/main",
          headBranch: "main",
          repoKind: "main",
          parentRepoPath: null,
          commonDirPath: "/repos/main/.git",
          worktreeBranch: "main",
          worktreeLocked: false,
          worktreePrunable: false,
        },
      },
      list_open_repos: [
        {
          name: "main",
          path: "/repos/main",
          headBranch: "main",
          repoKind: "main",
          parentRepoPath: null,
          commonDirPath: "/repos/main/.git",
          worktreeBranch: "main",
          worktreeLocked: false,
          worktreePrunable: false,
        },
      ],
      list_worktrees: [],
    });

    await useRepoStore.getState().removeWorktree("/repos/main-feature");

    expect(useRepoStore.getState().currentRepo?.path).toBe("/repos/main");
  });

  it("checkoutBranch calls checkout_branch and updates currentRepo", async () => {
    const updatedRepo = { name: "r", path: "/p", headBranch: "feature" };
    mockInvoke.mockResolvedValueOnce(updatedRepo); // checkout_branch
    mockInvoke.mockResolvedValueOnce([]); // list_branches (loadBranches)

    await useRepoStore.getState().checkoutBranch("feature");

    expect(mockInvoke).toHaveBeenCalledWith("checkout_branch", {
      branchName: "feature",
      autoStash: false,
    });
    expect(useRepoStore.getState().currentRepo).toEqual(updatedRepo);
  });

  it("checkoutBranch refreshes the graph so the new HEAD's rows aren't served from a stale cache", async () => {
    const updatedRepo = { name: "r", path: "/p", headBranch: "feature" };
    const refreshSpy = vi
      .spyOn(useGraphStore.getState(), "refresh")
      .mockResolvedValue();
    mockInvoke.mockResolvedValueOnce(updatedRepo).mockResolvedValueOnce([]); // checkout_branch, list_branches

    await useRepoStore.getState().checkoutBranch("feature");

    expect(refreshSpy).toHaveBeenCalled();
  });

  it("createBranch refreshes the graph so the new branch's rows aren't served from a stale cache", async () => {
    const refreshSpy = vi
      .spyOn(useGraphStore.getState(), "refresh")
      .mockResolvedValue();
    mockInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]); // create_branch, list_branches

    await useRepoStore.getState().createBranch("feature");

    expect(refreshSpy).toHaveBeenCalled();
  });

  it("deleteBranch refreshes the graph so the deleted branch's rows aren't served from a stale cache", async () => {
    const refreshSpy = vi
      .spyOn(useGraphStore.getState(), "refresh")
      .mockResolvedValue();
    mockInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]); // delete_branch, list_branches

    await useRepoStore.getState().deleteBranch("feature");

    expect(refreshSpy).toHaveBeenCalled();
  });

  it("checkoutRemoteBranch calls checkout_remote_branch and updates currentRepo", async () => {
    const updatedRepo = { name: "r", path: "/p", headBranch: "release" };
    mockInvoke.mockResolvedValueOnce(updatedRepo); // checkout_remote_branch
    mockInvoke.mockResolvedValueOnce([]); // list_branches (loadBranches)

    await useRepoStore.getState().checkoutRemoteBranch("origin/release");

    expect(mockInvoke).toHaveBeenCalledWith("checkout_remote_branch", {
      remoteRef: "origin/release",
      autoStash: false,
    });
    expect(useRepoStore.getState().currentRepo).toEqual(updatedRepo);
  });

  it("squashCommits invokes squash_commits then refreshes the tree and branches", async () => {
    const newOid = "c".repeat(40);
    mockByCommand({
      squash_commits: newOid,
      refresh_working_tree: { staged: [], unstaged: [], untracked: [] },
      list_branches: [],
    });

    const oids = ["a".repeat(40), "b".repeat(40)];
    const result = await useRepoStore
      .getState()
      .squashCommits(oids, "combined");

    expect(mockInvoke).toHaveBeenCalledWith("squash_commits", {
      oids,
      message: "combined",
    });
    expect(mockInvoke).toHaveBeenCalledWith("refresh_working_tree");
    expect(mockInvoke).toHaveBeenCalledWith("list_branches");
    expect(result).toBe(newOid);
  });

  it("checkoutBranch offers auto-stash on the sentinel and retries with autoStash on confirm", async () => {
    const updatedRepo = { name: "r", path: "/p", headBranch: "feature" };
    mockInvoke.mockRejectedValueOnce(AUTO_STASH_SENTINEL); // first attempt blocked
    mockInvoke.mockResolvedValueOnce(updatedRepo); // retry with autoStash
    mockInvoke.mockResolvedValueOnce([]); // list_branches (loadBranches)

    const promise = useRepoStore.getState().checkoutBranch("feature");
    // The prompt opens; approve it.
    await vi.waitFor(() =>
      expect(useAutoStashStore.getState().pending).not.toBeNull(),
    );
    useAutoStashStore.getState().respond(true);
    await promise;

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "checkout_branch", {
      branchName: "feature",
      autoStash: false,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "checkout_branch", {
      branchName: "feature",
      autoStash: true,
    });
    expect(useRepoStore.getState().currentRepo).toEqual(updatedRepo);
  });

  it("checkoutBranch aborts quietly (no retry, no error) when the prompt is cancelled", async () => {
    mockInvoke.mockRejectedValueOnce(AUTO_STASH_SENTINEL);

    const promise = useRepoStore.getState().checkoutBranch("feature");
    await vi.waitFor(() =>
      expect(useAutoStashStore.getState().pending).not.toBeNull(),
    );
    useAutoStashStore.getState().respond(false);
    await expect(promise).resolves.toBe(false);

    expect(mockInvoke).toHaveBeenCalledTimes(1); // no retry
    expect(useRepoStore.getState().currentRepo).toBeNull();
  });

  it("checkoutBranch rethrows a non-sentinel error without prompting", async () => {
    mockInvoke.mockRejectedValueOnce("some other git failure");

    await expect(
      useRepoStore.getState().checkoutBranch("feature"),
    ).rejects.toBe("some other git failure");
    expect(useAutoStashStore.getState().pending).toBeNull();
  });

  it("openRepo records the tab list and active path", async () => {
    const repo = { name: "myrepo", path: "/tmp/myrepo", headBranch: "main" };
    mockByCommand({ open_repo: repo, list_open_repos: [repo] });

    await useRepoStore.getState().openRepo("/tmp/myrepo");

    expect(mockInvoke).toHaveBeenCalledWith("open_repo", {
      path: "/tmp/myrepo",
    });
    const s = useRepoStore.getState();
    expect(s.openRepos).toEqual([repo]);
    expect(s.activeRepoPath).toBe("/tmp/myrepo");
  });

  it("activateRepo switches the active repo and reloads the graph", async () => {
    const repoB = { name: "b", path: "/b", headBranch: "main" };
    mockByCommand({ activate_repo: repoB });

    await useRepoStore.getState().activateRepo("/b");

    expect(mockInvoke).toHaveBeenCalledWith("activate_repo", { path: "/b" });
    expect(mockInvoke).toHaveBeenCalledWith("get_graph_viewport", {
      offset: 0,
      limit: 150,
    });
    const s = useRepoStore.getState();
    expect(s.currentRepo).toEqual(repoB);
    expect(s.activeRepoPath).toBe("/b");
  });

  it("activateRepo resets workingTreeStore before reloading the new repo's status", async () => {
    const repoB = { name: "b", path: "/b", headBranch: "main" };
    mockByCommand({ activate_repo: repoB });
    const resetSpy = vi.spyOn(useWorkingTreeStore.getState(), "reset");

    await useRepoStore.getState().activateRepo(repoB.path);

    expect(resetSpy).toHaveBeenCalled();
  });

  it("closeRepo falls back to the remaining active repo", async () => {
    const repoA = { name: "a", path: "/a", headBranch: "main" };
    mockByCommand({ close_repo: repoA, list_open_repos: [repoA] });

    await useRepoStore.getState().closeRepo("/b");

    expect(mockInvoke).toHaveBeenCalledWith("close_repo", { path: "/b" });
    const s = useRepoStore.getState();
    expect(s.openRepos).toEqual([repoA]);
    expect(s.activeRepoPath).toBe("/a");
  });

  it("closeRepo clears hook state only for the closed repository", async () => {
    const repoA = { name: "a", path: "/a", headBranch: "main" };
    useHookStore.getState().started({
      repoPath: "/a",
      runId: "a",
      hook: "pre-commit",
      operation: "commit",
    });
    useHookStore.getState().started({
      repoPath: "/b",
      runId: "b",
      hook: "pre-push",
      operation: "push",
    });
    mockByCommand({ close_repo: repoA, list_open_repos: [repoA] });

    await useRepoStore.getState().closeRepo("/b");

    expect(useHookStore.getState().runs["/b"]).toBeUndefined();
    expect(useHookStore.getState().runs["/a"]).toBeDefined();
  });

  it("closeRepo clears state when the last tab is closed", async () => {
    useRepoStore.setState({
      currentRepo: { name: "a", path: "/a", headBranch: "main" },
      activeRepoPath: "/a",
    });
    mockByCommand({ close_repo: null, list_open_repos: [] });

    await useRepoStore.getState().closeRepo("/a");

    const s = useRepoStore.getState();
    expect(s.currentRepo).toBeNull();
    expect(s.activeRepoPath).toBeNull();
    expect(s.openRepos).toEqual([]);
  });

  it("activationEpoch bumps exactly once per repo-switch path", async () => {
    expect(useRepoStore.getState().activationEpoch).toBe(0);

    // openRepo (routes through reloadActiveRepo) — one bump.
    const repoA = { name: "a", path: "/a", headBranch: "main" };
    mockByCommand({ open_repo: repoA, list_open_repos: [repoA] });
    await useRepoStore.getState().openRepo("/a");
    expect(useRepoStore.getState().activationEpoch).toBe(1);

    // activateRepo (routes through reloadActiveRepo) — one bump.
    const repoB = { name: "b", path: "/b", headBranch: "main" };
    mockByCommand({ activate_repo: repoB });
    await useRepoStore.getState().activateRepo("/b");
    expect(useRepoStore.getState().activationEpoch).toBe(2);

    // closeRepo falling back to a remaining repo (routes through
    // reloadActiveRepo internally) — one bump, not two.
    mockByCommand({ close_repo: repoA, list_open_repos: [repoA] });
    await useRepoStore.getState().closeRepo("/b");
    expect(useRepoStore.getState().activationEpoch).toBe(3);

    // closeRepo's no-repos-left branch — one bump.
    mockByCommand({ close_repo: null, list_open_repos: [] });
    await useRepoStore.getState().closeRepo("/a");
    expect(useRepoStore.getState().activationEpoch).toBe(4);

    // newTab — one bump.
    useRepoStore.getState().newTab();
    expect(useRepoStore.getState().activationEpoch).toBe(5);
  });
});
