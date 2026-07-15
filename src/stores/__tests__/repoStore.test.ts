import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "../repoStore";
import { useGraphStore } from "../graphStore";
import { useWorkingTreeStore } from "../workingTreeStore";
import { useAutoStashStore } from "../autoStashStore";
import { AUTO_STASH_SENTINEL } from "../../lib/autoStash";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({ currentRepo: null, recentRepos: [], branches: [], openRepos: [], activeRepoPath: null });
  // reloadActiveRepo (triggered by openRepo/activateRepo/closeRepo) drives
  // graphStore's fetchViewport, which now caches fetched rows — reset it too
  // so one test's cached (possibly empty) viewport can't mask another's
  // get_graph_viewport call.
  useGraphStore.setState({ viewport: null, lastOffset: null, lastLimit: null, nodesByRow: new Map() });
  useAutoStashStore.setState({ pending: null });
});

const emptyGraphViewport = { nodes: [], totalCount: 0, offset: 0 };

// Resolve invoke by command name so multi-step actions (which fire several
// invokes via the shared reloadActiveRepo routine) don't depend on call order.
// get_graph_viewport defaults to an empty viewport unless overridden, since
// reloadActiveRepo always fetches it and graphStore expects a real shape.
function mockByCommand(map: Record<string, unknown>) {
  const withDefaults: Record<string, unknown> = { get_graph_viewport: emptyGraphViewport, ...map };
  mockInvoke.mockImplementation((cmd: string) =>
    Promise.resolve(cmd in withDefaults ? withDefaults[cmd] : undefined),
  );
}

describe("repoStore", () => {
  it("openRepo calls open_repo and updates currentRepo", async () => {
    const fakeRepo = { name: "myrepo", path: "/tmp/myrepo", headBranch: "main" };
    mockByCommand({ open_repo: fakeRepo });

    await useRepoStore.getState().openRepo("/tmp/myrepo");

    expect(mockInvoke).toHaveBeenCalledWith("open_repo", { path: "/tmp/myrepo" });
    expect(useRepoStore.getState().currentRepo).toEqual(fakeRepo);
  });

  it("loadCurrentRepo updates currentRepo to null when no repo open", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    await useRepoStore.getState().loadCurrentRepo();
    expect(useRepoStore.getState().currentRepo).toBeNull();
  });

  it("syncHead updates currentRepo and reloads branches when HEAD changed externally", async () => {
    useRepoStore.setState({ currentRepo: { name: "r", path: "/p", headBranch: "develop" } });
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

  it("removeRecent drops the entry and stores the returned list", async () => {
    const remaining = [{ path: "/b", name: "b", pinned: false, lastOpened: 0 }];
    mockInvoke.mockResolvedValueOnce(remaining);

    await useRepoStore.getState().removeRecent("/a");

    expect(mockInvoke).toHaveBeenCalledWith("remove_recent_repo", { path: "/a" });
    expect(useRepoStore.getState().recentRepos).toEqual(remaining);
  });

  it("checkoutBranch calls checkout_branch and updates currentRepo", async () => {
    const updatedRepo = { name: "r", path: "/p", headBranch: "feature" };
    mockInvoke.mockResolvedValueOnce(updatedRepo);  // checkout_branch
    mockInvoke.mockResolvedValueOnce([]);            // list_branches (loadBranches)

    await useRepoStore.getState().checkoutBranch("feature");

    expect(mockInvoke).toHaveBeenCalledWith("checkout_branch", {
      branchName: "feature",
      autoStash: false,
    });
    expect(useRepoStore.getState().currentRepo).toEqual(updatedRepo);
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
    const result = await useRepoStore.getState().squashCommits(oids, "combined");

    expect(mockInvoke).toHaveBeenCalledWith("squash_commits", { oids, message: "combined" });
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
    await vi.waitFor(() => expect(useAutoStashStore.getState().pending).not.toBeNull());
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
    await vi.waitFor(() => expect(useAutoStashStore.getState().pending).not.toBeNull());
    useAutoStashStore.getState().respond(false);
    await expect(promise).resolves.toBe(false);

    expect(mockInvoke).toHaveBeenCalledTimes(1); // no retry
    expect(useRepoStore.getState().currentRepo).toBeNull();
  });

  it("checkoutBranch rethrows a non-sentinel error without prompting", async () => {
    mockInvoke.mockRejectedValueOnce("some other git failure");

    await expect(useRepoStore.getState().checkoutBranch("feature")).rejects.toBe(
      "some other git failure",
    );
    expect(useAutoStashStore.getState().pending).toBeNull();
  });

  it("openRepo records the tab list and active path", async () => {
    const repo = { name: "myrepo", path: "/tmp/myrepo", headBranch: "main" };
    mockByCommand({ open_repo: repo, list_open_repos: [repo] });

    await useRepoStore.getState().openRepo("/tmp/myrepo");

    expect(mockInvoke).toHaveBeenCalledWith("open_repo", { path: "/tmp/myrepo" });
    const s = useRepoStore.getState();
    expect(s.openRepos).toEqual([repo]);
    expect(s.activeRepoPath).toBe("/tmp/myrepo");
  });

  it("activateRepo switches the active repo and reloads the graph", async () => {
    const repoB = { name: "b", path: "/b", headBranch: "main" };
    mockByCommand({ activate_repo: repoB });

    await useRepoStore.getState().activateRepo("/b");

    expect(mockInvoke).toHaveBeenCalledWith("activate_repo", { path: "/b" });
    expect(mockInvoke).toHaveBeenCalledWith("get_graph_viewport", { offset: 0, limit: 150 });
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
});
