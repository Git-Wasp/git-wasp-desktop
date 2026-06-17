import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "../repoStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({ currentRepo: null, recentRepos: [], branches: [], openRepos: [], activeRepoPath: null });
});

// Resolve invoke by command name so multi-step actions (which fire several
// invokes via the shared reloadActiveRepo routine) don't depend on call order.
function mockByCommand(map: Record<string, unknown>) {
  mockInvoke.mockImplementation((cmd: string) =>
    Promise.resolve(cmd in map ? map[cmd] : undefined),
  );
}

describe("repoStore", () => {
  it("openRepo calls open_repo and updates currentRepo", async () => {
    const fakeRepo = { name: "myrepo", path: "/tmp/myrepo", headBranch: "main" };
    mockInvoke.mockResolvedValueOnce(fakeRepo);

    await useRepoStore.getState().openRepo("/tmp/myrepo");

    expect(mockInvoke).toHaveBeenCalledWith("open_repo", { path: "/tmp/myrepo" });
    expect(useRepoStore.getState().currentRepo).toEqual(fakeRepo);
  });

  it("loadCurrentRepo updates currentRepo to null when no repo open", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    await useRepoStore.getState().loadCurrentRepo();
    expect(useRepoStore.getState().currentRepo).toBeNull();
  });

  it("loadRecentRepos populates recentRepos", async () => {
    const repos = [{ path: "/a", name: "a", pinned: false, lastOpened: 0 }];
    mockInvoke.mockResolvedValueOnce(repos);
    await useRepoStore.getState().loadRecentRepos();
    expect(useRepoStore.getState().recentRepos).toEqual(repos);
  });

  it("checkoutBranch calls checkout_branch and updates currentRepo", async () => {
    const updatedRepo = { name: "r", path: "/p", headBranch: "feature" };
    mockInvoke.mockResolvedValueOnce(updatedRepo);  // checkout_branch
    mockInvoke.mockResolvedValueOnce([]);            // list_branches (loadBranches)

    await useRepoStore.getState().checkoutBranch("feature");

    expect(mockInvoke).toHaveBeenCalledWith("checkout_branch", { branchName: "feature" });
    expect(useRepoStore.getState().currentRepo).toEqual(updatedRepo);
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
