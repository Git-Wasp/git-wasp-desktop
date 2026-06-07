import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useMergeStore } from "../mergeStore";
import type { ConflictedFile, OperationStatus } from "../../types/merge";

const mockInvoke = vi.mocked(invoke);

const noneStatus: OperationStatus = { kind: "none" };

const conflictedFile: ConflictedFile = {
  path: "src/lib.rs",
  kind: "normalEdit",
  oursContent: "current\n",
  theirsContent: "source\n",
  baseContent: "base\n",
  seededResult: "<<<<<<< HEAD\ncurrent\n=======\nsource\n>>>>>>> feature\n",
  conflictBlocks: [
    { startLine: 1, midLine: 2, endLine: 3, oursText: "current\n", theirsText: "source\n" },
  ],
};

const mergeStatus: OperationStatus = {
  kind: "merge",
  sourceBranch: "feature",
  conflicts: [conflictedFile],
};

beforeEach(() => {
  vi.clearAllMocks();
  useMergeStore.setState({
    status: { kind: "none" },
    isLoading: false,
    lastError: null,
  });
});

describe("mergeStore", () => {
  it("loadStatus populates status from operation_status", async () => {
    mockInvoke.mockResolvedValueOnce(mergeStatus);

    await useMergeStore.getState().loadStatus();

    expect(mockInvoke).toHaveBeenCalledWith("operation_status");
    expect(useMergeStore.getState().status).toEqual(mergeStatus);
  });

  it("startMerge sets isLoading during the call and reloads status on success", async () => {
    mockInvoke.mockResolvedValueOnce({ status: "conflicts", conflicts: [conflictedFile] }); // merge_start
    mockInvoke.mockResolvedValueOnce(mergeStatus); // operation_status

    const promise = useMergeStore.getState().startMerge("feature");
    expect(useMergeStore.getState().isLoading).toBe(true);
    const result = await promise;

    expect(mockInvoke).toHaveBeenCalledWith("merge_start", { branchName: "feature" });
    expect(result).toEqual({ status: "conflicts", conflicts: [conflictedFile] });
    expect(useMergeStore.getState().status).toEqual(mergeStatus);
    expect(useMergeStore.getState().isLoading).toBe(false);
  });

  it("startMerge records lastError and resets isLoading on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("branch not found"));

    await expect(useMergeStore.getState().startMerge("missing")).rejects.toThrow("branch not found");

    expect(useMergeStore.getState().isLoading).toBe(false);
    expect(useMergeStore.getState().lastError).toContain("branch not found");
  });

  it("resolveFile sets isLoading and reloads status on success", async () => {
    mockInvoke.mockResolvedValueOnce([]); // merge_resolve_file
    mockInvoke.mockResolvedValueOnce(noneStatus); // operation_status

    const promise = useMergeStore.getState().resolveFile("src/lib.rs", "resolved\n");
    expect(useMergeStore.getState().isLoading).toBe(true);
    await promise;

    expect(mockInvoke).toHaveBeenCalledWith("merge_resolve_file", {
      path: "src/lib.rs",
      content: "resolved\n",
    });
    expect(useMergeStore.getState().status).toEqual(noneStatus);
    expect(useMergeStore.getState().isLoading).toBe(false);
  });

  it("completeMerge sets isLoading and reloads status on success", async () => {
    mockInvoke.mockResolvedValueOnce("abc123"); // merge_complete
    mockInvoke.mockResolvedValueOnce(noneStatus); // operation_status

    const promise = useMergeStore.getState().completeMerge("Merge branch 'feature'");
    expect(useMergeStore.getState().isLoading).toBe(true);
    const result = await promise;

    expect(mockInvoke).toHaveBeenCalledWith("merge_complete", { message: "Merge branch 'feature'" });
    expect(result).toBe("abc123");
    expect(useMergeStore.getState().status).toEqual(noneStatus);
    expect(useMergeStore.getState().isLoading).toBe(false);
  });

  it("abortMerge sets isLoading and reloads status on success", async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // merge_abort
    mockInvoke.mockResolvedValueOnce(noneStatus); // operation_status

    const promise = useMergeStore.getState().abortMerge();
    expect(useMergeStore.getState().isLoading).toBe(true);
    await promise;

    expect(mockInvoke).toHaveBeenCalledWith("merge_abort");
    expect(useMergeStore.getState().status).toEqual(noneStatus);
    expect(useMergeStore.getState().isLoading).toBe(false);
  });

  it("abortMerge records lastError and resets isLoading on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("nothing to abort"));

    await expect(useMergeStore.getState().abortMerge()).rejects.toThrow("nothing to abort");

    expect(useMergeStore.getState().isLoading).toBe(false);
    expect(useMergeStore.getState().lastError).toContain("nothing to abort");
  });
});
