import { describe, expect, it } from "vitest";
import { BACKSTOP_EVERY, shouldScanWorkingTree } from "./workingTreeSync";

describe("shouldScanWorkingTree", () => {
  it("scans when the watcher marked the tree dirty", () => {
    // Even on a tick that would otherwise be skipped.
    expect(shouldScanWorkingTree(true, 3)).toBe(true);
  });

  it("skips the scan on a clean, non-backstop tick", () => {
    expect(shouldScanWorkingTree(false, 1)).toBe(false);
    expect(shouldScanWorkingTree(false, 7)).toBe(false);
  });

  it("forces a backstop scan every BACKSTOP_EVERY ticks even when clean", () => {
    expect(shouldScanWorkingTree(false, 0)).toBe(true);
    expect(shouldScanWorkingTree(false, BACKSTOP_EVERY)).toBe(true);
    expect(shouldScanWorkingTree(false, BACKSTOP_EVERY * 2)).toBe(true);
  });

  it("honours a custom backstop interval", () => {
    expect(shouldScanWorkingTree(false, 3, 3)).toBe(true);
    expect(shouldScanWorkingTree(false, 2, 3)).toBe(false);
  });
});
