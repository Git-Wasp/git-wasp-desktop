import { describe, expect, it } from "vitest";
import { blockLineRanges, composeBlockText, splitBlockLines } from "./lineSelection";
import type { ConflictBlock } from "../types/merge";

const mkBlock = (oursText: string, theirsText: string): ConflictBlock => ({
  startLine: 0,
  midLine: 0,
  endLine: 0,
  oursText,
  theirsText,
});

describe("splitBlockLines", () => {
  it("drops a single trailing newline", () => {
    expect(splitBlockLines("current text\n")).toEqual(["current text"]);
    expect(splitBlockLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("handles text without a trailing newline", () => {
    expect(splitBlockLines("a\nb")).toEqual(["a", "b"]);
  });

  it("returns an empty array for empty text", () => {
    expect(splitBlockLines("")).toEqual([]);
  });
});

describe("composeBlockText", () => {
  const current = ["c0", "c1"];
  const source = ["s0", "s1"];

  it("emits selected current lines, then selected source lines, in order", () => {
    expect(composeBlockText(current, source, new Set([0, 1]), new Set([1]))).toBe("c0\nc1\ns1");
  });

  it("keeps original order regardless of selection insertion order", () => {
    expect(composeBlockText(current, source, new Set([1, 0]), new Set())).toBe("c0\nc1");
  });

  it("returns an empty string when nothing is selected", () => {
    expect(composeBlockText(current, source, new Set(), new Set())).toBe("");
  });

  it("can take only source lines", () => {
    expect(composeBlockText(current, source, new Set(), new Set([0, 1]))).toBe("s0\ns1");
  });
});

describe("blockLineRanges", () => {
  it("locates a single-line block's line number in the pane content", () => {
    const ranges = blockLineRanges(
      "shared\ncurrent text\ntrailing",
      [mkBlock("current text\n", "source text\n")],
      "ours",
    );
    expect(ranges).toEqual([{ blockIndex: 0, start: 2, end: 2 }]);
  });

  it("spans every line of a multi-line block", () => {
    const ranges = blockLineRanges("x\na\nb\nc", [mkBlock("a\nb\n", "z\n")], "ours");
    expect(ranges).toEqual([{ blockIndex: 0, start: 2, end: 3 }]);
  });

  it("skips blocks whose side text is absent", () => {
    expect(blockLineRanges("nothing here", [mkBlock("a\n", "b\n")], "ours")).toEqual([]);
  });
});
