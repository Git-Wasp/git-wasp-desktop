import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  type DecorationSet,
} from "@codemirror/view";
import { editorThemeExtension, registerEditorView } from "../../lib/editorTheme";
import { languageForPath } from "../../lib/editorLanguage";
import type { StageFileContents } from "../../types/workingTree";
import {
  alignedHeadLineNumbers,
  alignedHeadText,
  alignedWorktreeLineNumbers,
  alignedWorktreeText,
  changedRowIndices,
  composeStagedText,
  diffLines,
} from "../../lib/lineDiff";
import { stageGutter, setStagedLines } from "./stageGutter";
import { ChangeOverview } from "./ChangeOverview";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

interface StageFileEditorProps {
  path: string;
  contents: StageFileContents;
  /** Persist the staged result buffer (line-level staging). */
  onStage: (path: string, content: string) => void;
  /** Stage a binary / deleted file wholesale (line-level staging N/A). */
  onStageWholeFile?: (path: string) => void;
  onDiscardFile?: (path: string) => void;
  onClose?: () => void;
}

const paneTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-bg-surface)",
    fontFamily: "var(--font-family-mono)",
    fontSize: "var(--font-size-sm)",
    height: "100%",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": { backgroundColor: "var(--color-bg-elevated)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--color-bg-elevated)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--color-bg-elevated)" },
  ".cm-diff-add-line": { backgroundColor: "var(--color-diff-add-bg)" },
  ".cm-diff-del-line": { backgroundColor: "var(--color-diff-del-bg)" },
  // The absent side of an aligned change: a neutral diagonal hatch (à la
  // GitKraken), so only the side that holds the changed text reads green/red.
  ".cm-diff-placeholder-line": {
    backgroundColor: "var(--color-bg-surface)",
    backgroundImage:
      "repeating-linear-gradient(45deg, var(--color-border-default) 0, var(--color-border-default) 1px, transparent 1px, transparent 7px)",
  },
  ".cm-stage-gutter": { paddingLeft: "var(--space-1)", paddingRight: "var(--space-1)" },
  ".cm-stage-toggle": {
    cursor: "pointer",
    border: "none",
    background: "transparent",
    color: "var(--color-text-secondary)",
    fontFamily: "var(--font-family-mono)",
    fontWeight: "var(--font-weight-semibold)",
    lineHeight: "1",
    padding: "0 2px",
  },
  ".cm-stage-toggle:hover": { color: "var(--color-text-primary)" },
});

// Read-only panes still track a cursor, so clicking a line highlights it.
const activeLineExtensions = [highlightActiveLine(), highlightActiveLineGutter()];

const paneLabelStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border-subtle)",
};

function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** A whole-line background class to apply at a given 1-based pane line number. */
interface LineDecoration {
  lineNo: number;
  className: string;
}

// Whole-line background decorations at the given 1-based pane line numbers. The
// offsets are resolved against `content`, so each pane builds its own set even
// though both panes share the same row→class mapping (their texts differ).
function buildLineDecorations(content: string, entries: LineDecoration[]): DecorationSet {
  if (entries.length === 0) return Decoration.none;
  const starts = lineStartOffsets(content);
  const ranges = [...entries]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((e) => Decoration.line({ class: e.className }).range(starts[e.lineNo - 1]));
  return Decoration.set(ranges);
}

function ReadOnlyStagePane({
  label,
  content,
  changedLines,
  stagedLines,
  onToggle,
  decorations,
  lineNumberMap,
  language,
  testId,
  onView,
  onScroll,
}: {
  label: string;
  content: string;
  changedLines: Set<number>;
  stagedLines: Set<number>;
  onToggle: (lineNo: number) => void;
  decorations: DecorationSet;
  /** Real file line number per 1-based pane line; `null` renders a blank gutter. */
  lineNumberMap: (number | null)[];
  language: Extension | null;
  testId?: string;
  onView?: (view: EditorView | null) => void;
  onScroll?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers({
            // Aligned panes pad the opposite side with blank rows; those carry no
            // real file line, so leave their gutter empty.
            formatNumber: (n) => {
              const real = lineNumberMap[n - 1];
              return real == null ? "" : String(real);
            },
          }),
          ...activeLineExtensions,
          ...(language ? [language] : []),
          editorThemeExtension(),
          paneTheme,
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          EditorView.decorations.of(decorations),
          stageGutter(changedLines, onToggle),
          EditorView.domEventHandlers({
            scroll() {
              onScroll?.();
              return false;
            },
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    onView?.(view);
    const unregister = registerEditorView(view);
    return () => {
      unregister();
      view.destroy();
      viewRef.current = null;
      onView?.(null);
    };
  }, [content, changedLines, onToggle, decorations, lineNumberMap, language, onView, onScroll]);

  // Push the controlled staged-line set into the gutter markers.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setStagedLines.of(stagedLines) });
  }, [stagedLines]);

  return (
    <div
      data-testid={testId}
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    >
      <div style={paneLabelStyle}>{label}</div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }} />
    </div>
  );
}

export function StageFileEditor({
  path,
  contents,
  onStage,
  onStageWholeFile,
  onDiscardFile,
  onClose,
}: StageFileEditorProps) {
  const lineEditable = !contents.isBinary && contents.worktreeExists;

  const language = useMemo(() => languageForPath(path), [path]);

  const rows = useMemo(
    () => diffLines(contents.headContent, contents.worktreeContent),
    [contents.headContent, contents.worktreeContent],
  );
  // Aligned pane texts + real line-number maps: every diff row is one line in
  // both panes, with the absent side padded by a blank (coloured) placeholder so
  // HEAD and Working Tree line up row-for-row.
  const headText = useMemo(() => alignedHeadText(rows), [rows]);
  const worktreeText = useMemo(() => alignedWorktreeText(rows), [rows]);
  const headLineNumbers = useMemo(() => alignedHeadLineNumbers(rows), [rows]);
  const worktreeLineNumbers = useMemo(() => alignedWorktreeLineNumbers(rows), [rows]);

  // With aligned panes a row's line number is simply its row index + 1. Removed
  // rows carry their toggle in the HEAD pane (where the text lives), added rows
  // in the Working Tree pane; placeholder rows get neither.
  const headChanged = useMemo(
    () => rows.flatMap((r, i) => (r.kind === "removed" ? [{ lineNo: i + 1, rowIndex: i }] : [])),
    [rows],
  );
  const worktreeChanged = useMemo(
    () => rows.flatMap((r, i) => (r.kind === "added" ? [{ lineNo: i + 1, rowIndex: i }] : [])),
    [rows],
  );

  const headChangedLineNos = useMemo(() => new Set(headChanged.map((l) => l.lineNo)), [headChanged]);
  const worktreeChangedLineNos = useMemo(
    () => new Set(worktreeChanged.map((l) => l.lineNo)),
    [worktreeChanged],
  );
  const headLineToRow = useMemo(
    () => new Map(headChanged.map((l) => [l.lineNo, l.rowIndex])),
    [headChanged],
  );
  const worktreeLineToRow = useMemo(
    () => new Map(worktreeChanged.map((l) => [l.lineNo, l.rowIndex])),
    [worktreeChanged],
  );

  // Each pane shows the changed text solid (red for a removal in HEAD, green for
  // an addition in Working Tree) and the opposite side's change as a neutral
  // hatched placeholder gap. Offsets resolve against each pane's own text.
  const headDecorationEntries = useMemo(
    () =>
      rows.flatMap((r, i) =>
        r.kind === "removed"
          ? [{ lineNo: i + 1, className: "cm-diff-del-line" }]
          : r.kind === "added"
            ? [{ lineNo: i + 1, className: "cm-diff-placeholder-line" }]
            : [],
      ),
    [rows],
  );
  const worktreeDecorationEntries = useMemo(
    () =>
      rows.flatMap((r, i) =>
        r.kind === "added"
          ? [{ lineNo: i + 1, className: "cm-diff-add-line" }]
          : r.kind === "removed"
            ? [{ lineNo: i + 1, className: "cm-diff-placeholder-line" }]
            : [],
      ),
    [rows],
  );
  const headDecorations = useMemo(
    () => buildLineDecorations(headText, headDecorationEntries),
    [headText, headDecorationEntries],
  );
  const worktreeDecorations = useMemo(
    () => buildLineDecorations(worktreeText, worktreeDecorationEntries),
    [worktreeText, worktreeDecorationEntries],
  );

  // Row indices whose change is staged. Seeded to "everything staged", so the
  // panes open with every change marked "−" (Stage commits the whole file).
  const [stagedRows, setStagedRows] = useState<Set<number>>(() => new Set(changedRowIndices(rows)));
  const stagedRowsRef = useRef(stagedRows);
  const headViewRef = useRef<EditorView | null>(null);
  const worktreeViewRef = useRef<EditorView | null>(null);

  const applyStaged = useCallback((next: Set<number>) => {
    stagedRowsRef.current = next;
    setStagedRows(next);
  }, []);

  const toggleRow = useCallback(
    (rowIndex: number) => {
      const next = new Set(stagedRowsRef.current);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      applyStaged(next);
    },
    [applyStaged],
  );

  // Reset the staged set whenever the file (its diff) changes.
  useEffect(() => {
    const initial = new Set(changedRowIndices(rows));
    stagedRowsRef.current = initial;
    setStagedRows(initial);
  }, [rows]);

  // Keep the two top panes vertically (and horizontally) in sync as you scroll.
  const syncingRef = useRef(false);
  const syncScroll = useCallback((from: "head" | "worktree") => {
    if (syncingRef.current) return;
    const src = from === "head" ? headViewRef.current : worktreeViewRef.current;
    const dst = from === "head" ? worktreeViewRef.current : headViewRef.current;
    if (!src || !dst) return;
    if (
      dst.scrollDOM.scrollTop === src.scrollDOM.scrollTop &&
      dst.scrollDOM.scrollLeft === src.scrollDOM.scrollLeft
    ) {
      return;
    }
    syncingRef.current = true;
    dst.scrollDOM.scrollTop = src.scrollDOM.scrollTop;
    dst.scrollDOM.scrollLeft = src.scrollDOM.scrollLeft;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  const registerHeadView = useCallback((v: EditorView | null) => {
    headViewRef.current = v;
  }, []);
  const registerWorktreeView = useCallback((v: EditorView | null) => {
    worktreeViewRef.current = v;
  }, []);
  const onScrollHead = useCallback(() => syncScroll("head"), [syncScroll]);
  const onScrollWorktree = useCallback(() => syncScroll("worktree"), [syncScroll]);

  // Scroll both panes to a fraction of their scrollable height (overview click).
  const seek = useCallback((fraction: number) => {
    for (const view of [headViewRef.current, worktreeViewRef.current]) {
      if (!view) continue;
      const max = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
      view.scrollDOM.scrollTop = fraction * max;
    }
  }, []);

  const onToggleHead = useCallback(
    (lineNo: number) => {
      const row = headLineToRow.get(lineNo);
      if (row !== undefined) toggleRow(row);
    },
    [headLineToRow, toggleRow],
  );
  const onToggleWorktree = useCallback(
    (lineNo: number) => {
      const row = worktreeLineToRow.get(lineNo);
      if (row !== undefined) toggleRow(row);
    },
    [worktreeLineToRow, toggleRow],
  );

  const headStagedLineNos = useMemo(
    () => new Set(headChanged.filter((l) => stagedRows.has(l.rowIndex)).map((l) => l.lineNo)),
    [headChanged, stagedRows],
  );
  const worktreeStagedLineNos = useMemo(
    () => new Set(worktreeChanged.filter((l) => stagedRows.has(l.rowIndex)).map((l) => l.lineNo)),
    [worktreeChanged, stagedRows],
  );

  // The staged result is composed directly from the line selection (no separate
  // result buffer): every change staged ⇒ the working tree; none ⇒ HEAD.
  const handleStage = () => onStage(path, composeStagedText(rows, stagedRows));
  const handleReset = () => applyStaged(new Set(changedRowIndices(rows)));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header: path + file-level actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-2) var(--space-3)",
          borderBottom: "1px solid var(--color-border-subtle)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-family-mono)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {path}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
          {lineEditable && (
            <>
              <Button size="sm" type="button" onClick={handleReset}>
                Reset
              </Button>
              <Button variant="primary" size="sm" type="button" onClick={handleStage}>
                Stage
              </Button>
            </>
          )}
          {onDiscardFile && (
            <Button variant="danger" size="sm" onClick={() => onDiscardFile(path)}>
              Discard file
            </Button>
          )}
          {onClose && (
            <IconButton aria-label="Close diff" title="Close diff" onClick={onClose}>
              ✕
            </IconButton>
          )}
        </div>
      </div>

      {!lineEditable ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-3)",
            padding: "var(--space-4)",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-sm)",
            textAlign: "center",
          }}
        >
          <span>
            {contents.isBinary
              ? "Binary file — can't be staged line by line."
              : "File deleted — can't be staged line by line."}
          </span>
          {onStageWholeFile && (
            <Button variant="primary" size="sm" onClick={() => onStageWholeFile(path)}>
              Stage whole file
            </Button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* HEAD / Working tree, side by side and row-for-row aligned */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              flex: 1,
              minHeight: 0,
              gap: "1px",
              background: "var(--color-border-subtle)",
            }}
          >
            <ReadOnlyStagePane
              label="HEAD"
              testId="head-pane"
              content={headText}
              changedLines={headChangedLineNos}
              stagedLines={headStagedLineNos}
              onToggle={onToggleHead}
              decorations={headDecorations}
              lineNumberMap={headLineNumbers}
              language={language}
              onView={registerHeadView}
              onScroll={onScrollHead}
            />
            <ReadOnlyStagePane
              label="Working Tree"
              testId="worktree-pane"
              content={worktreeText}
              changedLines={worktreeChangedLineNos}
              stagedLines={worktreeStagedLineNos}
              onToggle={onToggleWorktree}
              decorations={worktreeDecorations}
              lineNumberMap={worktreeLineNumbers}
              language={language}
              onView={registerWorktreeView}
              onScroll={onScrollWorktree}
            />
          </div>
          <ChangeOverview rows={rows} onSeek={seek} />
        </div>
      )}
    </div>
  );
}
