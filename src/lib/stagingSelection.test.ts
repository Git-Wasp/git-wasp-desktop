import { describe, expect, it } from "vitest";
import { nextSelectionAfterStaging, unstagedPaths } from "./stagingSelection";
import type { WorkingTreeStatus } from "../types/workingTree";

function status(unstaged: string[], untracked: string[] = []): WorkingTreeStatus {
  const entry = (path: string) => ({ path, originalPath: null, status: "Modified" as const });
  return { staged: [], unstaged: unstaged.map(entry), untracked: untracked.map(entry) };
}

describe("unstagedPaths", () => {
  it("lists unstaged then untracked, like the staging panel", () => {
    expect(unstagedPaths(status(["a", "b"], ["c"]))).toEqual(["a", "b", "c"]);
  });

  it("tolerates a null status", () => {
    expect(unstagedPaths(null)).toEqual([]);
  });
});

describe("nextSelectionAfterStaging", () => {
  it("advances to the file that took the staged file's slot", () => {
    // Was [a,b,c], staged b → [a,c]; the next file (c) slides into b's slot.
    expect(nextSelectionAfterStaging(["a", "b", "c"], ["a", "c"], "b")).toBe("c");
  });

  it("falls back to the new last file when the staged file was last", () => {
    // Was [a,b,c], staged c → [a,b]; clamp to the last remaining (b).
    expect(nextSelectionAfterStaging(["a", "b", "c"], ["a", "b"], "c")).toBe("b");
  });

  it("advances to the first remaining when the staged file was first", () => {
    expect(nextSelectionAfterStaging(["a", "b", "c"], ["b", "c"], "a")).toBe("b");
  });

  it("keeps the file selected when it still has unstaged changes (partial stage)", () => {
    expect(nextSelectionAfterStaging(["a", "b", "c"], ["a", "b", "c"], "b")).toBe("b");
  });

  it("keeps the file selected when nothing is left to stage", () => {
    expect(nextSelectionAfterStaging(["b"], [], "b")).toBe("b");
  });
});
