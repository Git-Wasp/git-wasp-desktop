import { describe, expect, it } from "vitest";
import {
  alignedHeadLineNumbers,
  alignedHeadText,
  alignedWorktreeLineNumbers,
  alignedWorktreeText,
  changedRowIndices,
  composeStagedResult,
  composeStagedText,
  diffLines,
  headChangedLines,
  headPaneText,
  hunkLines,
  inlineText,
  worktreeChangedLines,
  worktreePaneText,
} from "./lineDiff";

describe("diffLines", () => {
  it("marks every line as context when the two sides are identical", () => {
    const rows = diffLines("a\nb\nc\n", "a\nb\nc\n");
    expect(rows.every((r) => r.kind === "context")).toBe(true);
  });

  it("classifies a single changed line as removed then added", () => {
    const rows = diffLines("a\nb\nc\n", "a\nB\nc\n");
    expect(rows).toEqual([
      { kind: "context", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "context", text: "c" },
      { kind: "context", text: "" },
    ]);
  });

  it("classifies pure insertions as added", () => {
    const rows = diffLines("a\nc\n", "a\nb\nc\n");
    expect(rows.filter((r) => r.kind === "added").map((r) => r.text)).toEqual(["b"]);
    expect(rows.some((r) => r.kind === "removed")).toBe(false);
  });

  it("round-trips each side by joining the appropriate rows", () => {
    const head = "a\nb\nc"; // no trailing newline
    const worktree = "a\nX\nc\n";
    const rows = diffLines(head, worktree);
    expect(headPaneText(rows)).toBe(head);
    expect(worktreePaneText(rows)).toBe(worktree);
  });
});

describe("composeStagedText", () => {
  const head = "a\nb\nc\n";
  const worktree = "A\nb\nC\n";
  const rows = diffLines(head, worktree);
  const allChanged = new Set(changedRowIndices(rows));

  it("equals the working tree when every change is staged", () => {
    expect(composeStagedText(rows, allChanged)).toBe(worktree);
  });

  it("equals HEAD when nothing is staged", () => {
    expect(composeStagedText(rows, new Set())).toBe(head);
  });

  it("stages an independent deletion without the unrelated insertion", () => {
    // head removes "b", worktree adds "d": two independent changes.
    const rs = diffLines("a\nb\nc\n", "a\nc\nd\n");
    const removedB = rs.findIndex((r) => r.kind === "removed" && r.text === "b");
    // Stage only the deletion of "b".
    expect(composeStagedText(rs, new Set([removedB]))).toBe("a\nc\n");
  });

  it("treats a modified line as a removed+added pair (both needed to stage it)", () => {
    // Only staging the added "A" (not the removal of "a") keeps both lines —
    // matching git's line-level staging semantics.
    const addedA = rows.findIndex((r) => r.kind === "added" && r.text === "A");
    expect(composeStagedText(rows, new Set([addedA]))).toBe("a\nA\nb\nc\n");
  });
});

describe("composeStagedResult", () => {
  it("returns one line entry per output line, matching composeStagedText", () => {
    const rows = diffLines("a\nb\nc\n", "a\nB\nc\nd\n");
    const staged = new Set(changedRowIndices(rows));
    const { text, lines } = composeStagedResult(rows, staged);
    expect(text).toBe(composeStagedText(rows, staged));
    expect(lines.length).toBe(text.split("\n").length);
  });

  it("marks staged additions as added and kept (unstaged) removals as removed", () => {
    // head removes "b", worktree adds "d"; stage only the deletion of "b".
    const rows = diffLines("a\nb\nc\n", "a\nc\nd\n");
    const removedB = rows.findIndex((r) => r.kind === "removed" && r.text === "b");
    const { lines } = composeStagedResult(rows, new Set([removedB]));
    // "d" is an unstaged addition → omitted entirely; a kept removal would show
    // as `removed`. Here nothing is kept-removed, so only context lines remain.
    expect(lines.every((l) => l.kind === "context")).toBe(true);

    // Now stage nothing: the removal of "b" is kept (pending) and "d" omitted.
    const none = composeStagedResult(rows, new Set());
    const removed = none.lines.filter((l) => l.kind === "removed");
    expect(removed.length).toBe(1);
    expect(none.lines.find((l) => l.kind === "added")).toBeUndefined();
  });
});

describe("pane changed-line maps", () => {
  // head:     a  b  c        worktree: a  B  c  d
  const rows = diffLines("a\nb\nc\n", "a\nB\nc\nd\n");

  it("maps removed lines to their 1-based line number in the HEAD pane", () => {
    const head = headChangedLines(rows);
    // "b" is removed; in the HEAD pane (a,b,c,"") it is line 2.
    expect(head).toContainEqual({ lineNo: 2, rowIndex: rows.findIndex((r) => r.text === "b") });
  });

  it("maps added lines to their 1-based line number in the worktree pane", () => {
    const wt = worktreeChangedLines(rows);
    const lineNos = wt.map((l) => l.lineNo).sort((a, b) => a - b);
    // "B" (line 2) and "d" (line 4) are the added lines in the worktree pane.
    expect(lineNos).toEqual([2, 4]);
  });
});

describe("aligned panes", () => {
  it("pads the HEAD side with a blank placeholder opposite an insertion", () => {
    // worktree inserts "b": rows = [ctx a, added b, ctx c, ctx ""].
    const rows = diffLines("a\nc\n", "a\nb\nc\n");
    expect(alignedHeadText(rows)).toBe("a\n\nc\n");
    expect(alignedWorktreeText(rows)).toBe("a\nb\nc\n");
  });

  it("pads the working-tree side with a blank placeholder opposite a deletion", () => {
    // worktree removes "b": rows = [ctx a, removed b, ctx c, ctx ""].
    const rows = diffLines("a\nb\nc\n", "a\nc\n");
    expect(alignedHeadText(rows)).toBe("a\nb\nc\n");
    expect(alignedWorktreeText(rows)).toBe("a\n\nc\n");
  });

  it("gives both aligned panes the same line count (row-for-row alignment)", () => {
    const rows = diffLines("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(alignedHeadText(rows).split("\n").length).toBe(rows.length);
    expect(alignedWorktreeText(rows).split("\n").length).toBe(rows.length);
  });

  it("lays out a unified inline text with one line per row", () => {
    // A modification: "b" → "B". Removed sits directly above added.
    const rows = diffLines("a\nb\nc\n", "a\nB\nc\n");
    expect(inlineText(rows)).toBe("a\nb\nB\nc\n");
    expect(inlineText(rows).split("\n").length).toBe(rows.length);
  });

  it("numbers real lines and leaves placeholders blank (null)", () => {
    const inserted = diffLines("a\nc\n", "a\nb\nc\n");
    // HEAD has no line opposite the inserted "b" → null at that row.
    expect(alignedHeadLineNumbers(inserted)).toEqual([1, null, 2, 3]);
    expect(alignedWorktreeLineNumbers(inserted)).toEqual([1, 2, 3, 4]);

    const removed = diffLines("a\nb\nc\n", "a\nc\n");
    // Working tree has no line opposite the removed "b" → null at that row.
    expect(alignedHeadLineNumbers(removed)).toEqual([1, 2, 3, 4]);
    expect(alignedWorktreeLineNumbers(removed)).toEqual([1, null, 2, 3]);
  });
});

describe("hunkLines", () => {
  it("returns nothing when the sides are identical", () => {
    expect(hunkLines(diffLines("a\nb\nc", "a\nb\nc"))).toEqual([]);
  });

  it("shows one hunk around a change, dropping distant unchanged lines", () => {
    const head = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10";
    const worktree = "l1\nl2\nl3\nl4\nL5\nl6\nl7\nl8\nl9\nl10";
    const out = hunkLines(diffLines(head, worktree), 1);

    // A single hunk: header + [l4, l5(removed), L5(added), l6].
    const headers = out.filter((l) => l.kind === "header");
    expect(headers).toHaveLength(1);
    expect(headers[0].text).toBe("@@ -4,3 +4,3 @@");

    expect(out.map((l) => `${l.kind}:${l.text}`)).toEqual([
      "header:@@ -4,3 +4,3 @@",
      "context:l4",
      "removed:l5",
      "added:L5",
      "context:l6",
    ]);
    // l1–l3 and l7–l10 are far from the change and dropped.
    expect(out.some((l) => l.text === "l1")).toBe(false);
    expect(out.some((l) => l.text === "l10")).toBe(false);
  });

  it("emits a separate hunk per distant change", () => {
    const out = hunkLines(diffLines("a\nb\nc\nd\ne\nf\ng", "a\nB\nc\nd\ne\nF\ng"), 1);
    expect(out.filter((l) => l.kind === "header")).toHaveLength(2);
  });

  it("carries real old/new line numbers and null on the absent side", () => {
    const out = hunkLines(diffLines("l1\nl2\nl3\nl4\nl5", "l1\nl2\nl3\nl4\nL5"), 1);
    const removed = out.find((l) => l.kind === "removed")!;
    const added = out.find((l) => l.kind === "added")!;
    expect(removed).toMatchObject({ text: "l5", oldNo: 5, newNo: null });
    expect(added).toMatchObject({ text: "L5", oldNo: null, newNo: 5 });
    // Headers carry no source row or line numbers.
    expect(out[0]).toMatchObject({ kind: "header", rowIndex: null, oldNo: null, newNo: null });
  });
});
