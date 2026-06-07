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
