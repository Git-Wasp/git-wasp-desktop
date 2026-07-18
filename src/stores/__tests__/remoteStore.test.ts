import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useRemoteStore } from "../remoteStore";
import { useRepoStore } from "../repoStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useRemoteStore.setState({
    aheadBehind: new Map(),
    aheadBehindEpoch: 0,
    isFetching: false,
    isPulling: false,
    isPushing: false,
    lastError: null,
  });
  useRepoStore.setState({
    currentRepo: { name: "repo", path: "/repo", headBranch: "main" },
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("remoteStore ahead/behind (per-branch, on demand)", () => {
  it("requestAheadBehind fetches and stores ahead/behind for one branch", async () => {
    mockInvoke.mockResolvedValueOnce([1, 2]);

    useRemoteStore.getState().requestAheadBehind("main");
    expect(mockInvoke).toHaveBeenCalledWith("branch_ahead_behind", { name: "main" });
    expect(useRemoteStore.getState().aheadBehind.get("main")).toBe("loading");

    await flush();

    expect(useRemoteStore.getState().aheadBehind.get("main")).toEqual({ ahead: 1, behind: 2 });
  });

  it("requestAheadBehind does not re-request an already-requested branch", async () => {
    mockInvoke.mockResolvedValue([0, 0]);

    useRemoteStore.getState().requestAheadBehind("main");
    useRemoteStore.getState().requestAheadBehind("main");
    await flush();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("requestAheadBehind marks a branch as none when the invoke rejects (e.g. no upstream)", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("branch 'main' has no upstream"));

    useRemoteStore.getState().requestAheadBehind("main");
    await flush();

    expect(useRemoteStore.getState().aheadBehind.get("main")).toBe("none");
  });

  it("invalidateAheadBehind clears cached entries and bumps the epoch", () => {
    useRemoteStore.setState({ aheadBehind: new Map([["main", { ahead: 1, behind: 0 }]]) });

    useRemoteStore.getState().invalidateAheadBehind();

    expect(useRemoteStore.getState().aheadBehind.size).toBe(0);
    expect(useRemoteStore.getState().aheadBehindEpoch).toBe(1);
  });

  it("a stale in-flight response from before an invalidation does not clobber post-invalidation state", async () => {
    let resolveStale: (v: [number, number]) => void;
    const pending = new Promise<[number, number]>((r) => {
      resolveStale = r;
    });
    mockInvoke.mockImplementationOnce(() => pending);

    useRemoteStore.getState().requestAheadBehind("main"); // starts in epoch 0
    useRemoteStore.getState().invalidateAheadBehind(); // epoch -> 1, map cleared

    mockInvoke.mockResolvedValueOnce([9, 9]);
    useRemoteStore.getState().requestAheadBehind("main"); // fresh request in epoch 1
    await flush();
    expect(useRemoteStore.getState().aheadBehind.get("main")).toEqual({ ahead: 9, behind: 9 });

    resolveStale!([1, 2]); // epoch 0's late response
    await flush();

    // Must not overwrite the epoch-1 result with epoch 0's stale data.
    expect(useRemoteStore.getState().aheadBehind.get("main")).toEqual({ ahead: 9, behind: 9 });
  });
});

describe("remoteStore remote operations", () => {
  it("fetch sets isFetching during the call and invalidates ahead/behind on success", async () => {
    mockInvoke.mockResolvedValueOnce({ updatedRefs: ["refs/heads/main"] }); // fetch_remote

    const promise = useRemoteStore.getState().fetch();
    expect(useRemoteStore.getState().isFetching).toBe(true);
    const result = await promise;

    expect(mockInvoke).toHaveBeenCalledWith("fetch_remote", { remoteName: null, prune: false });
    expect(result).toEqual({ updatedRefs: ["refs/heads/main"] });
    expect(useRemoteStore.getState().isFetching).toBe(false);
    expect(useRemoteStore.getState().aheadBehindEpoch).toBe(1);
  });

  it("fetch records lastError and resets isFetching on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("network unreachable"));

    await expect(useRemoteStore.getState().fetch()).rejects.toThrow("network unreachable");

    expect(useRemoteStore.getState().isFetching).toBe(false);
    expect(useRemoteStore.getState().lastError).toContain("network unreachable");
  });

  it("pull sets isPulling, forwards the mode, and invalidates ahead/behind on success", async () => {
    mockInvoke.mockResolvedValueOnce({ status: "fastForwarded" }); // pull_branch

    const promise = useRemoteStore.getState().pull("ffOrMerge", "origin", "main");
    expect(useRemoteStore.getState().isPulling).toBe(true);
    const result = await promise;

    expect(mockInvoke).toHaveBeenCalledWith("pull_branch", {
      remoteName: "origin",
      branch: "main",
      mode: "ffOrMerge",
      autoStash: false,
    });
    expect(result).toEqual({ status: "fastForwarded" });
    expect(useRemoteStore.getState().isPulling).toBe(false);
    expect(useRemoteStore.getState().aheadBehindEpoch).toBe(1);
  });

  it("push sets isPushing and invalidates ahead/behind on success", async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // push_branch

    const promise = useRemoteStore.getState().push();
    expect(useRemoteStore.getState().isPushing).toBe(true);
    await promise;

    expect(mockInvoke).toHaveBeenCalledWith("push_branch", {
      repoPath: "/repo",
      remoteName: null,
      branch: null,
    });
    expect(useRemoteStore.getState().isPushing).toBe(false);
    expect(useRemoteStore.getState().aheadBehindEpoch).toBe(1);
  });

  it("push rejects before invoking when no repository is open", async () => {
    useRepoStore.setState({ currentRepo: null });

    await expect(useRemoteStore.getState().push()).rejects.toThrow("No repository is open");

    expect(mockInvoke).not.toHaveBeenCalledWith("push_branch", expect.anything());
    expect(useRemoteStore.getState().isPushing).toBe(false);
    expect(useRemoteStore.getState().lastError).toContain("No repository is open");
  });

  it("fastForwardToUpstream invalidates ahead/behind on success", async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // fast_forward_to_upstream

    await useRemoteStore.getState().fastForwardToUpstream("main");

    expect(mockInvoke).toHaveBeenCalledWith("fast_forward_to_upstream", { branch: "main" });
    expect(useRemoteStore.getState().aheadBehindEpoch).toBe(1);
  });
});
