import { describe, expect, it, vi } from "vitest";
import { runMerge } from "./dragDrop";

describe("runMerge", () => {
  it("checks out the target before merging when it is not the current branch", async () => {
    const calls: string[] = [];
    const checkoutBranch = vi.fn(() => {
      calls.push("checkout");
      return Promise.resolve(true);
    });
    const startMerge = vi.fn(() => {
      calls.push("merge");
      return Promise.resolve();
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
    const checkoutBranch = vi.fn(() => Promise.resolve(true));
    const startMerge = vi.fn(() => Promise.resolve());

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

  it("does not start the merge when checkoutBranch reports the auto-stash was cancelled", async () => {
    const checkoutBranch = vi.fn().mockResolvedValue(false); // user cancelled the stash prompt
    const startMerge = vi.fn();

    await runMerge({
      source: "feature",
      target: "main",
      currentBranch: "develop",
      checkoutBranch,
      startMerge,
    });

    expect(startMerge).not.toHaveBeenCalled();
  });

  it("starts the merge once checkoutBranch confirms the switch happened", async () => {
    const checkoutBranch = vi.fn().mockResolvedValue(true);
    const startMerge = vi.fn();

    await runMerge({ source: "feature", target: "main", currentBranch: "develop", checkoutBranch, startMerge });

    expect(startMerge).toHaveBeenCalledWith("feature");
  });
});
