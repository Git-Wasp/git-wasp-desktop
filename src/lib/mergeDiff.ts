import { presentableDiff } from "@codemirror/merge";

export interface Range {
  from: number;
  to: number;
}

/**
 * Char-level diff between the two sides of a conflict. `ours` is the A side,
 * `theirs` the B side. Returns the non-empty changed ranges for each, in their
 * own coordinate space (offsets within the given text). Zero-width changes
 * (e.g. a pure insertion on the other side) are dropped — there is nothing to
 * mark where text only exists on one side.
 */
export function diffSides(
  ours: string,
  theirs: string,
): { oursChars: Range[]; theirsChars: Range[] } {
  const oursChars: Range[] = [];
  const theirsChars: Range[] = [];
  for (const c of presentableDiff(ours, theirs)) {
    if (c.toA > c.fromA) oursChars.push({ from: c.fromA, to: c.toA });
    if (c.toB > c.fromB) theirsChars.push({ from: c.fromB, to: c.toB });
  }
  return { oursChars, theirsChars };
}

/** 0-based line indices that any of the given char ranges overlaps. */
export function changedLineNumbers(text: string, ranges: Range[]): number[] {
  if (ranges.length === 0) return [];

  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }

  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      // Binary search over [0, lineStarts.length - 1] — mid always in range.
      if (lineStarts[mid]! <= offset) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  };

  const lines = new Set<number>();
  for (const r of ranges) {
    const start = lineOf(r.from);
    // to is exclusive; step back one char so an end-of-line boundary does not
    // bleed onto the next line.
    const end = lineOf(Math.max(r.from, r.to - 1));
    for (let l = start; l <= end; l++) lines.add(l);
  }
  return [...lines].sort((a, b) => a - b);
}
