import { describe, expect, it } from "vitest";
import { buildPaneDecorations } from "./mergeDecorations";
import type { ConflictBlock } from "../../types/merge";

const block: ConflictBlock = {
  startLine: 2,
  midLine: 4,
  endLine: 6,
  oursText: "current text\n",
  theirsText: "source text\n",
};

function classesIn(content: string, side: "ours" | "theirs"): string[] {
  const set = buildPaneDecorations(content, [block], side);
  const found: string[] = [];
  const cursor = set.iter();
  while (cursor.value) {
    const cls = (cursor.value.spec as { class?: string }).class;
    if (cls) found.push(cls);
    cursor.next();
  }
  return found;
}

describe("buildPaneDecorations", () => {
  it("emits char and line decorations for the current (ours) side", () => {
    const classes = classesIn("shared\ncurrent text\ntrailing", "ours");
    expect(classes).toContain("cm-diff-del");
    expect(classes).toContain("cm-diff-del-line");
  });

  it("emits char and line decorations for the source (theirs) side", () => {
    const classes = classesIn("shared\nsource text\ntrailing", "theirs");
    expect(classes).toContain("cm-diff-add");
    expect(classes).toContain("cm-diff-add-line");
  });

  it("skips a block whose side text is not present in the pane content", () => {
    const set = buildPaneDecorations("unrelated content", [block], "ours");
    expect(set.size).toBe(0);
  });

  it("places the second block's line decoration on its own lines when two blocks share identical side text", () => {
    // Two blocks whose "ours" text is identical ("same\n") back to back — the
    // first-match indexOf bug would place both blocks' line decorations on line 1.
    const dup: ConflictBlock[] = [
      { startLine: 1, midLine: 1, endLine: 1, oursText: "same\n", theirsText: "x\n" },
      { startLine: 2, midLine: 2, endLine: 2, oursText: "same\n", theirsText: "y\n" },
    ];
    const set = buildPaneDecorations("same\nsame\n", dup, "ours");
    const lines: number[] = [];
    const cursor = set.iter();
    while (cursor.value) {
      const cls = (cursor.value.spec as { class?: string }).class;
      if (cls === "cm-diff-del-line") lines.push(cursor.from);
      cursor.next();
    }
    // Line starts at offset 0 (line 1) and offset 5 (line 2) in "same\nsame\n".
    expect(lines).toEqual([0, 5]);
  });
});
