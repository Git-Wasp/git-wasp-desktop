// Pure helpers for per-line conflict resolution: choosing individual lines from
// the current (ours) and source (theirs) sides to compose a resolved block.
import type { ConflictBlock } from "../types/merge";

export interface BlockLineRange {
  blockIndex: number;
  start: number; // 1-based line number in the pane content
  end: number;
}

/**
 * For each conflict block, the 1-based line range its side text occupies within
 * the given pane content. Blocks whose side text can't be located are skipped.
 */
export function blockLineRanges(
  content: string,
  blocks: ConflictBlock[],
  side: "ours" | "theirs",
): BlockLineRange[] {
  const result: BlockLineRange[] = [];
  // Byte offset in `content` to resume searching from. Blocks appear in order in
  // the reconstructed pane text, so each search starts where the previous block's
  // match ended — this makes a duplicate-content match resolve to the NEXT
  // occurrence rather than always the first (see content.indexOf below).
  let searchFrom = 0;
  blocks.forEach((block, blockIndex) => {
    const sideText = side === "ours" ? block.oursText : block.theirsText;
    if (!sideText) return;
    const base = content.indexOf(sideText, searchFrom);
    if (base === -1) return;
    const lineCount = splitBlockLines(sideText).length;
    if (lineCount === 0) return;
    const start = content.slice(0, base).split("\n").length; // newlines-before + 1
    result.push({ blockIndex, start, end: start + lineCount - 1 });
    searchFrom = base + sideText.length;
  });
  return result;
}

/** Splits a block's side text into lines, dropping a single trailing newline. */
export function splitBlockLines(text: string): string[] {
  if (text === "") return [];
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n");
}

/**
 * Composes the resolved block text from the chosen lines: selected current lines
 * in their original order, followed by selected source lines in their original
 * order. Returns text without a trailing newline (the caller places it in the
 * document where the block's lines were).
 */
export function composeBlockText(
  currentLines: string[],
  sourceLines: string[],
  selectedCurrent: Set<number>,
  selectedSource: Set<number>,
): string {
  const chosen: string[] = [];
  currentLines.forEach((line, i) => {
    if (selectedCurrent.has(i)) chosen.push(line);
  });
  sourceLines.forEach((line, i) => {
    if (selectedSource.has(i)) chosen.push(line);
  });
  return chosen.join("\n");
}
