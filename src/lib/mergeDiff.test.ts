import { describe, expect, it } from "vitest";
import { changedLineNumbers, diffSides } from "./mergeDiff";

describe("diffSides", () => {
  it("returns no ranges for identical text", () => {
    expect(diffSides("abc", "abc")).toEqual({ oursChars: [], theirsChars: [] });
  });

  it("marks the changed word on each side", () => {
    expect(diffSides("foo bar baz", "foo qux baz")).toEqual({
      oursChars: [{ from: 4, to: 7 }],
      theirsChars: [{ from: 4, to: 7 }],
    });
  });

  it("marks a pure insertion only on the side that gained text", () => {
    // theirs adds a whole line; ours has nothing there (zero-width on ours).
    expect(diffSides("", "added line\n")).toEqual({
      oursChars: [],
      theirsChars: [{ from: 0, to: 11 }],
    });
  });
});

describe("changedLineNumbers", () => {
  it("returns nothing when there are no ranges", () => {
    expect(changedLineNumbers("a\nb\nc", [])).toEqual([]);
  });

  it("maps a range to the 0-based line it sits on", () => {
    expect(changedLineNumbers("line1\nCHANGED\n", [{ from: 6, to: 13 }])).toEqual([1]);
  });

  it("includes every line a multi-line range overlaps", () => {
    expect(changedLineNumbers("a\nbb\nccc", [{ from: 0, to: 5 }])).toEqual([0, 1]);
  });
});
