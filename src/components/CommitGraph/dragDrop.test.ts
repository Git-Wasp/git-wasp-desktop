import { describe, expect, it, vi } from "vitest";
import { runMerge } from "./dragDrop";

describe("runMerge", () => {
  it("checks out the target before merging when it is not the current branch", async () => {
    const calls: string[] = [];
    const checkoutBranch = vi.fn(async () => {
      calls.push("checkout");
    });
    const startMerge = vi.fn(async () => {
      calls.push("merge");
    });

    await runMerge({
      source: "feature",
      target: "main",
      currentBranch: "feature",
      checkoutBranch,
      startMerge,
    });

    expect(checkoutBranch).toHaveBeenCalledWith("main");
    expect(startMerge).toHaveBeenCalledWith("feature");
    expect(calls).toEqual(["checkout", "merge"]);
  });

  it("skips checkout when the target is already current", async () => {
    const checkoutBranch = vi.fn(async () => {});
    const startMerge = vi.fn(async () => {});

    await runMerge({
      source: "feature",
      target: "main",
      currentBranch: "main",
      checkoutBranch,
      startMerge,
    });

    expect(checkoutBranch).not.toHaveBeenCalled();
    expect(startMerge).toHaveBeenCalledWith("feature");
  });
});
