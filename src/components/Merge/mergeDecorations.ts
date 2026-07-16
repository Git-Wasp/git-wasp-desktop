import { Decoration, type DecorationSet } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import type { ConflictBlock } from "../../types/merge";
import { changedLineNumbers, diffSides, type Range as CharRange } from "../../lib/mergeDiff";

type Side = "ours" | "theirs";

// Current (ours) reads as the "removed" side, Source (theirs) as the "added" side.
const CHAR_CLASS: Record<Side, string> = { ours: "cm-diff-del", theirs: "cm-diff-add" };
const LINE_CLASS: Record<Side, string> = { ours: "cm-diff-del-line", theirs: "cm-diff-add-line" };

function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/**
 * Builds the red/green line + char-level diff decorations for one pane. Each
 * conflict block's side text is located within the (read-only) pane content,
 * and the char-level diff between the two sides is mapped onto it. Blocks whose
 * side text can't be located are skipped.
 */
export function buildPaneDecorations(
  content: string,
  blocks: ConflictBlock[],
  side: Side,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  // Byte offset in `content` to resume searching from. Blocks appear in order in
  // the reconstructed pane text, so each search starts where the previous block's
  // match ended — this makes a duplicate-content match resolve to the NEXT
  // occurrence rather than always the first (see content.indexOf below).
  let searchFrom = 0;

  for (const block of blocks) {
    const sideText = side === "ours" ? block.oursText : block.theirsText;
    if (!sideText) continue;
    const base = content.indexOf(sideText, searchFrom);
    if (base === -1) continue;
    searchFrom = base + sideText.length;

    const diff = diffSides(block.oursText, block.theirsText);
    const charRanges: CharRange[] = side === "ours" ? diff.oursChars : diff.theirsChars;
    if (charRanges.length === 0) continue;

    const starts = lineStartOffsets(sideText);
    for (const localLine of changedLineNumbers(sideText, charRanges)) {
      ranges.push(Decoration.line({ class: LINE_CLASS[side] }).range(base + starts[localLine]));
    }
    for (const r of charRanges) {
      ranges.push(Decoration.mark({ class: CHAR_CLASS[side] }).range(base + r.from, base + r.to));
    }
  }

  if (ranges.length === 0) return Decoration.none;
  // sort=true lets Decoration.set order line (point) and mark ranges correctly.
  return Decoration.set(ranges, true);
}
