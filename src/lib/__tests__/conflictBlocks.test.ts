import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { blockRange, extractBlockText, isBlockResolved } from "../conflictBlocks";
import type { ConflictBlock } from "../../types/merge";

const seededResult = [
  "line one",
  "<<<<<<< HEAD",
  "current text",
  "=======",
  "source text",
  ">>>>>>> feature",
  "line seven",
].join("\n");

const block: ConflictBlock = {
  startLine: 2,
  midLine: 4,
  endLine: 6,
  oursText: "current text\n",
  theirsText: "source text\n",
};

describe("blockRange", () => {
  it("converts a block's line numbers into document character offsets", () => {
    const doc = Text.of(seededResult.split("\n"));

    const range = blockRange(doc, block);

    expect(range).toEqual({
      from: doc.line(2).from,
      to: doc.line(6).to,
    });
  });

  it("collapses to a single line's range when start and end are the same line", () => {
    const doc = Text.of(["only one line"]);
    const singleLineBlock: ConflictBlock = { ...block, startLine: 1, midLine: 1, endLine: 1 };

    const range = blockRange(doc, singleLineBlock);

    expect(range).toEqual({ from: doc.line(1).from, to: doc.line(1).to });
  });
});

describe("extractBlockText", () => {
  it("extracts the original marker-delimited text for a block from the seeded result", () => {
    const text = extractBlockText(seededResult, block);

    expect(text).toBe(["<<<<<<< HEAD", "current text", "=======", "source text", ">>>>>>> feature"].join("\n"));
  });
});

describe("isBlockResolved", () => {
  it("returns false when the block's original marker text is still present in the current content", () => {
    expect(isBlockResolved(seededResult, seededResult, block)).toBe(false);
  });

  it("returns true once the block's marker text has been replaced (e.g. accept current)", () => {
    const resolved = ["line one", "current text", "line seven"].join("\n");

    expect(isBlockResolved(resolved, seededResult, block)).toBe(true);
  });

  it("returns true once the block's marker text has been replaced (e.g. accept source)", () => {
    const resolved = ["line one", "source text", "line seven"].join("\n");

    expect(isBlockResolved(resolved, seededResult, block)).toBe(true);
  });

  it("returns false when other content changes but this block's markers remain untouched", () => {
    const editedElsewhere = ["line one (edited)", "<<<<<<< HEAD", "current text", "=======", "source text", ">>>>>>> feature", "line seven"].join("\n");

    expect(isBlockResolved(editedElsewhere, seededResult, block)).toBe(false);
  });
});
