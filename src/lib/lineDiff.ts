// Pure helpers for the line-level staging editor: a line diff between the HEAD
// and working-tree versions of a file, plus composition of the staged result
// from a per-line selection. Kept framework-free so it is cheap to unit test.

export type DiffRowKind = "context" | "added" | "removed";

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
}

/** A changed line within one pane: its 1-based pane line number + source row. */
export interface PaneLine {
  lineNo: number;
  rowIndex: number;
}

/** Metadata for one line of the composed staged result, in document order. */
export interface ResultLine {
  /** `context` lines are unchanged; `added`/`removed` lines carry a toggle. */
  kind: DiffRowKind;
  /** The source row this line came from. */
  rowIndex: number;
  /** Whether this line's change is staged (always false for context). */
  staged: boolean;
}

/**
 * Line-level diff between two texts, as an ordered list of rows. `context` lines
 * appear in both sides; `removed` only in `head`; `added` only in `worktree`.
 * Texts are split on "\n" (so a trailing newline yields a final empty line);
 * joining the rows belonging to a side with "\n" reproduces that side exactly.
 *
 * Uses a standard LCS (O(n·m)) — fine for the file sizes a staging review
 * involves.
 */
export function diffLines(head: string, worktree: string): DiffRow[] {
  const a = head.split("\n");
  const b = worktree.split("\n");
  const m = a.length;
  const n = b.length;

  // dp[i][j] = LCS length of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ kind: "context", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "removed", text: a[i] });
      i++;
    } else {
      rows.push({ kind: "added", text: b[j] });
      j++;
    }
  }
  while (i < m) rows.push({ kind: "removed", text: a[i++] });
  while (j < n) rows.push({ kind: "added", text: b[j++] });
  return rows;
}

/** Row indices that represent a change (added or removed). */
export function changedRowIndices(rows: DiffRow[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (r.kind !== "context") out.push(i);
  });
  return out;
}

/** The HEAD-pane text: context + removed lines. */
export function headPaneText(rows: DiffRow[]): string {
  return rows
    .filter((r) => r.kind !== "added")
    .map((r) => r.text)
    .join("\n");
}

/** The working-tree-pane text: context + added lines. */
export function worktreePaneText(rows: DiffRow[]): string {
  return rows
    .filter((r) => r.kind !== "removed")
    .map((r) => r.text)
    .join("\n");
}

/**
 * Composes the staged result text. `staged` holds the row indices whose change
 * is staged: a staged `added` line is included, a staged `removed` line is
 * dropped (its deletion takes effect). Unstaged changes revert to HEAD — an
 * unstaged `added` line is omitted, an unstaged `removed` line is kept. Context
 * lines are always present. With every changed row staged the result equals the
 * working tree; with none staged it equals HEAD.
 */
export function composeStagedText(rows: DiffRow[], staged: ReadonlySet<number>): string {
  return composeStagedResult(rows, staged).text;
}

/**
 * Like {@link composeStagedText}, but also returns per-line metadata in document
 * order — used to decorate and place toggle controls on the result pane. The
 * `lines` array has one entry per line of `text` (so `lines.length` equals
 * `text.split("\n").length`). A line is present when: it is context; an `added`
 * line that is staged; or a `removed` line whose deletion is *not* staged (still
 * kept). Each non-context line's `staged` flag mirrors whether its change is in
 * `staged`.
 */
export function composeStagedResult(
  rows: DiffRow[],
  staged: ReadonlySet<number>,
): { text: string; lines: ResultLine[] } {
  const text: string[] = [];
  const lines: ResultLine[] = [];
  rows.forEach((row, idx) => {
    if (row.kind === "context") {
      text.push(row.text);
      lines.push({ kind: "context", rowIndex: idx, staged: false });
    } else if (row.kind === "added") {
      if (staged.has(idx)) {
        text.push(row.text);
        lines.push({ kind: "added", rowIndex: idx, staged: true });
      }
    } else if (!staged.has(idx)) {
      // removed line, deletion not staged → keep it (pending removal)
      text.push(row.text);
      lines.push({ kind: "removed", rowIndex: idx, staged: false });
    }
  });
  return { text: text.join("\n"), lines };
}

// Walks rows building one pane, recording the 1-based line number of each
// changed line of the requested kind alongside its row index.
function paneChangedLines(rows: DiffRow[], include: DiffRowKind, changed: DiffRowKind): PaneLine[] {
  const out: PaneLine[] = [];
  let lineNo = 0;
  rows.forEach((row, rowIndex) => {
    if (row.kind === "context" || row.kind === include) {
      lineNo++;
      if (row.kind === changed) out.push({ lineNo, rowIndex });
    }
  });
  return out;
}

/** Removed lines in the HEAD pane, with their pane line numbers. */
export function headChangedLines(rows: DiffRow[]): PaneLine[] {
  return paneChangedLines(rows, "removed", "removed");
}

/** Added lines in the working-tree pane, with their pane line numbers. */
export function worktreeChangedLines(rows: DiffRow[]): PaneLine[] {
  return paneChangedLines(rows, "added", "added");
}
