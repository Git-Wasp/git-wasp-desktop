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
});
