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

export interface DiffOptions {
  /**
   * Treat two lines that differ only in leading/trailing whitespace as equal, so
   * such changes collapse to `context` instead of a removed/added pair. Internal
   * whitespace differences remain a real change. When a line matches this way its
   * `context` text is the `worktree` (new) version, so the pane shows the file's
   * current content.
   */
  ignoreWhitespace?: boolean;
}

/**
 * Line-level diff between two texts, as an ordered list of rows. `context` lines
 * appear in both sides; `removed` only in `head`; `added` only in `worktree`.
 * Texts are split on "\n" (so a trailing newline yields a final empty line);
 * joining the rows belonging to a side with "\n" reproduces that side exactly
 * (unless `ignoreWhitespace` folds a whitespace-only change into context).
 *
 * Uses a standard LCS (O(n·m)) — fine for the file sizes a staging review
 * involves.
 */
export function diffLines(head: string, worktree: string, options: DiffOptions = {}): DiffRow[] {
  const a = head.split("\n");
  const b = worktree.split("\n");
  const m = a.length;
  const n = b.length;

  // Comparison key: identity, or the whitespace-trimmed line when ignoring
  // leading/trailing whitespace. Lines equal under this key become context.
  const key = options.ignoreWhitespace ? (s: string) => s.trim() : (s: string) => s;
  const ka = a.map(key);
  const kb = b.map(key);

  // dp[i][j] = LCS length of a[i..] and b[j..], compared by key.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (ka[i] === kb[j]) {
      // Prefer the worktree text for context (identical to head unless a
      // whitespace-only difference was folded away).
      rows.push({ kind: "context", text: b[j] });
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

/**
 * Aligned pane text for the HEAD side: one output line per diff row so the HEAD
 * and working-tree panes line up row-for-row. An `added` row (no line on the
 * HEAD side) becomes a blank placeholder, rendered as a coloured gap. The result
 * always has exactly `rows.length` lines.
 */
export function alignedHeadText(rows: DiffRow[]): string {
  return rows.map((r) => (r.kind === "added" ? "" : r.text)).join("\n");
}

/**
 * Aligned pane text for the working-tree side: one output line per diff row. A
 * `removed` row (no line on the working-tree side) becomes a blank placeholder.
 * Always has exactly `rows.length` lines, matching {@link alignedHeadText}.
 */
export function alignedWorktreeText(rows: DiffRow[]): string {
  return rows.map((r) => (r.kind === "removed" ? "" : r.text)).join("\n");
}

/**
 * Real 1-based file line numbers for each aligned HEAD row, or `null` for a
 * placeholder row (an `added` row has no line on the HEAD side). Used to label
 * the line-number gutter so it tracks the real file, not the padded pane.
 */
export function alignedHeadLineNumbers(rows: DiffRow[]): (number | null)[] {
  let n = 0;
  return rows.map((r) => (r.kind === "added" ? null : ++n));
}

/** Like {@link alignedHeadLineNumbers} for the working-tree side (`removed` → null). */
export function alignedWorktreeLineNumbers(rows: DiffRow[]): (number | null)[] {
  let n = 0;
  return rows.map((r) => (r.kind === "removed" ? null : ++n));
}

/**
 * Unified (inline) diff text: every row on its own line, in order, so a removal
 * sits directly above the addition that replaced it. One line per row, so line
 * `i + 1` is `rows[i]` — paired with {@link alignedHeadLineNumbers} /
 * {@link alignedWorktreeLineNumbers} for the old/new gutter columns.
 */
export function inlineText(rows: DiffRow[]): string {
  return rows.map((r) => r.text).join("\n");
}

/** One line of the hunk (unified-with-context) view. A `header` line carries the
 *  `@@ … @@` range text and no source row; the other kinds mirror {@link DiffRow}. */
export interface HunkLine {
  kind: "header" | DiffRowKind;
  text: string;
  /** Source row index for a context/added/removed line; `null` for a header. */
  rowIndex: number | null;
  /** Real 1-based old (HEAD) file line number, or `null` (added / header). */
  oldNo: number | null;
  /** Real 1-based new (working-tree) file line number, or `null` (removed / header). */
  newNo: number | null;
}

/**
 * The "hunk" view: only the changed regions of the diff, each preceded by an
 * `@@ -old,len +new,len @@` header and padded with up to `context` unchanged
 * lines on each side. Large unchanged gaps are dropped, so the reviewer sees just
 * the changes with a little surrounding code — the standard unified-diff shape.
 * Returns one entry per rendered line (headers included), so line `i + 1` of the
 * joined text is `hunkLines(...)[i]`. Empty when there are no changes.
 */
export function hunkLines(rows: DiffRow[], context = 3): HunkLine[] {
  // Real old/new file line number for each row (null on the side it's absent).
  const oldNos: (number | null)[] = [];
  const newNos: (number | null)[] = [];
  let o = 0;
  let n = 0;
  for (const r of rows) {
    if (r.kind === "context") {
      oldNos.push(++o);
      newNos.push(++n);
    } else if (r.kind === "removed") {
      oldNos.push(++o);
      newNos.push(null);
    } else {
      oldNos.push(null);
      newNos.push(++n);
    }
  }

  // Merge each changed row's ±context window into contiguous hunks.
  const hunks: { start: number; end: number }[] = [];
  rows.forEach((r, i) => {
    if (r.kind === "context") return;
    const start = Math.max(0, i - context);
    const end = Math.min(rows.length - 1, i + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  });

  const out: HunkLine[] = [];
  for (const h of hunks) {
    let oldStart: number | null = null;
    let newStart: number | null = null;
    let oldLen = 0;
    let newLen = 0;
    for (let i = h.start; i <= h.end; i++) {
      if (rows[i].kind !== "added") {
        oldLen++;
        if (oldStart == null) oldStart = oldNos[i];
      }
      if (rows[i].kind !== "removed") {
        newLen++;
        if (newStart == null) newStart = newNos[i];
      }
    }
    out.push({
      kind: "header",
      text: `@@ -${oldStart ?? 0},${oldLen} +${newStart ?? 0},${newLen} @@`,
      rowIndex: null,
      oldNo: null,
      newNo: null,
    });
    for (let i = h.start; i <= h.end; i++) {
      out.push({ kind: rows[i].kind, text: rows[i].text, rowIndex: i, oldNo: oldNos[i], newNo: newNos[i] });
    }
  }
  return out;
}
