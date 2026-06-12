import type { Text } from "@codemirror/state";
import type { ConflictBlock } from "../types/merge";

export interface DocRange {
  from: number;
  to: number;
}

/** Converts a block's 1-based line numbers into CodeMirror document character offsets. */
export function blockRange(doc: Text, block: ConflictBlock): DocRange {
  return {
    from: doc.line(block.startLine).from,
    to: doc.line(block.endLine).to,
  };
}

/** Extracts the original marker-delimited text (markers, ours, theirs) for a block from the seeded result. */
export function extractBlockText(seededResult: string, block: ConflictBlock): string {
  const lines = seededResult.split("\n");
  return lines.slice(block.startLine - 1, block.endLine).join("\n");
}

/**
 * A block is resolved once its original conflict-marker text no longer appears verbatim
 * in the current content — i.e. the user has accepted a side or manually edited it away.
 * Avoids re-parsing the document on every keystroke.
 */
export function isBlockResolved(currentContent: string, seededResult: string, block: ConflictBlock): boolean {
  return !currentContent.includes(extractBlockText(seededResult, block));
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Computes the CodeMirror edit that replaces a block's marker text with one side's
 * content. Locates the block by searching the current content for its original marker
 * text (rather than trusting `block.startLine`/`endLine`, which go stale once an earlier
 * block in the same file has already been resolved and shifted line numbers). Strips the
 * side's trailing newline so the replacement occupies exactly the lines it's replacing,
 * and additionally consumes the line separator when the chosen side is empty so a full
 * deletion doesn't leave a blank line behind. Returns null once the block is already resolved.
 */
export function acceptBlockEdit(
  currentContent: string,
  seededResult: string,
  block: ConflictBlock,
  side: "ours" | "theirs",
): TextEdit | null {
  const original = extractBlockText(seededResult, block);
  const from = currentContent.indexOf(original);
  if (from === -1) return null;

  let to = from + original.length;
  const raw = side === "ours" ? block.oursText : block.theirsText;
  const insert = raw.endsWith("\n") ? raw.slice(0, -1) : raw;

  if (insert === "" && to < currentContent.length && currentContent[to] === "\n") {
    to += 1;
  }

  return { from, to, insert };
}
