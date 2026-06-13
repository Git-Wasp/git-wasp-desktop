import { describe, expect, it, vi } from "vitest";
import {
  hitTestLabel,
  isLocalBranch,
  runMerge,
  type BranchLabelHit,
} from "./dragDrop";

const hit = (over: Partial<BranchLabelHit>): BranchLabelHit => ({
  name: "main",
  isRemote: false,
  isTag: false,
  x: 0,
  y: 0,
  w: 50,
  h: 16,
  ...over,
});

describe("hitTestLabel", () => {
  it("returns the rect containing the point", () => {
    const hits = [hit({ name: "main", x: 10, y: 10, w: 40, h: 16 })];
    expect(hitTestLabel(hits, 20, 18)?.name).toBe("main");
  });

  it("returns undefined when the point is outside every rect", () => {
    const hits = [hit({ x: 10, y: 10, w: 40, h: 16 })];
    expect(hitTestLabel(hits, 100, 100)).toBeUndefined();
  });

  it("returns the topmost (last drawn) rect when rects overlap", () => {
    const hits = [
      hit({ name: "first", x: 0, y: 0, w: 50, h: 16 }),
      hit({ name: "second", x: 0, y: 0, w: 50, h: 16 }),
    ];
    expect(hitTestLabel(hits, 10, 8)?.name).toBe("second");
  });
});

describe("isLocalBranch", () => {
  it("is true only for non-remote, non-tag labels", () => {
    expect(isLocalBranch(hit({ isRemote: false, isTag: false }))).toBe(true);
    expect(isLocalBranch(hit({ isRemote: true, isTag: false }))).toBe(false);
    expect(isLocalBranch(hit({ isRemote: false, isTag: true }))).toBe(false);
  });
});

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
