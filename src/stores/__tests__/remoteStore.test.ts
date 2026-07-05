import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useRemoteStore } from "../remoteStore";

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
