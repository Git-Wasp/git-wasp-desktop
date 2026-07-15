import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useRemoteStore } from "../remoteStore";
import { useRepoStore } from "../repoStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useRemoteStore.setState({
    aheadBehind: [],
    isFetching: false,
    isPulling: false,
    isPushing: false,
    lastError: null,
  });
});

describe("remoteStore", () => {
  it("loadAheadBehind populates aheadBehind from get_ahead_behind", async () => {
    const aheadBehind = [{ branch: "main", upstream: "origin/main", ahead: 1, behind: 2 }];
    mockInvoke.mockResolvedValueOnce(aheadBehind);

    await useRemoteStore.getState().loadAheadBehind();

    expect(mockInvoke).toHaveBeenCalledWith("get_ahead_behind");
    expect(useRemoteStore.getState().aheadBehind).toEqual(aheadBehind);
  });

  it("loadAheadBehind discards a late response from before a repo switch", async () => {
    let resolveA: (v: { branch: string; upstream: string; ahead: number; behind: number }[]) => void;
    const pendingA = new Promise<{ branch: string; upstream: string; ahead: number; behind: number }[]>((r) => {
      resolveA = r;
    });
    mockInvoke.mockImplementationOnce(() => pendingA); // repo A's slow get_ahead_behind

    const loadA = useRemoteStore.getState().loadAheadBehind();
    useRepoStore.setState({ activationEpoch: useRepoStore.getState().activationEpoch + 1 }); // repo switch happens

    const aheadBehindB = [{ branch: "main", upstream: "origin/main", ahead: 5, behind: 0 }];
    mockInvoke.mockResolvedValueOnce(aheadBehindB); // repo B's own (fast) loadAheadBehind call
    await useRemoteStore.getState().loadAheadBehind();

    resolveA!([{ branch: "main", upstream: "origin/main", ahead: 1, behind: 2 }]); // repo A's late response
    await loadA;

    expect(useRemoteStore.getState().aheadBehind).toEqual(aheadBehindB); // not clobbered by A's stale data
  });

  it("loadAheadBehind clears aheadBehind on failure", async () => {
    useRemoteStore.setState({ aheadBehind: [{ branch: "main", upstream: "origin/main", ahead: 1, behind: 2 }] });
    mockInvoke.mockRejectedValueOnce(new Error("offline"));

    await expect(useRemoteStore.getState().loadAheadBehind()).rejects.toThrow("offline");

    expect(useRemoteStore.getState().aheadBehind).toEqual([]);
  });

  it("fetch sets isFetching during the call and reloads ahead/behind", async () => {
    mockInvoke.mockResolvedValueOnce({ updatedRefs: ["refs/heads/main"] }); // fetch_remote
    mockInvoke.mockResolvedValueOnce([]); // get_ahead_behind

    const promise = useRemoteStore.getState().fetch();
    expect(useRemoteStore.getState().isFetching).toBe(true);
    const result = await promise;

    expect(mockInvoke).toHaveBeenCalledWith("fetch_remote", { remoteName: null, prune: false });
    expect(result).toEqual({ updatedRefs: ["refs/heads/main"] });
    expect(useRemoteStore.getState().isFetching).toBe(false);
  });

  it("fetch records lastError and resets isFetching on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("network unreachable"));

    await expect(useRemoteStore.getState().fetch()).rejects.toThrow("network unreachable");

    expect(useRemoteStore.getState().isFetching).toBe(false);
    expect(useRemoteStore.getState().lastError).toContain("network unreachable");
  });

  it("pull sets isPulling, forwards the mode, and reloads ahead/behind on success", async () => {
    mockInvoke.mockResolvedValueOnce({ status: "fastForwarded" }); // pull_branch
    mockInvoke.mockResolvedValueOnce([]); // get_ahead_behind

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
  });

  it("push sets isPushing and reloads ahead/behind on success", async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // push_branch
    mockInvoke.mockResolvedValueOnce([]); // get_ahead_behind

    const promise = useRemoteStore.getState().push();
    expect(useRemoteStore.getState().isPushing).toBe(true);
    await promise;

    expect(mockInvoke).toHaveBeenCalledWith("push_branch", { remoteName: null, branch: null });
    expect(useRemoteStore.getState().isPushing).toBe(false);
  });
});
