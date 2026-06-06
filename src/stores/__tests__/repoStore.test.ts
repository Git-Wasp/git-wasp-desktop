import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "../repoStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({ currentRepo: null, recentRepos: [], branches: [] });
});

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
});
