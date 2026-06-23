import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  type DecorationSet,
} from "@codemirror/view";
import { editorThemeExtension, registerEditorView } from "../../lib/editorTheme";
import type { StageFileContents } from "../../types/workingTree";
import {
  changedRowIndices,
  composeStagedResult,
  diffLines,
  headChangedLines,
  headPaneText,
  worktreeChangedLines,
  worktreePaneText,
} from "../../lib/lineDiff";
import { stageGutter, setStagedLines } from "./stageGutter";
import { stageResultExtensions, setResultLines } from "./stageResultPane";
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

// Whole-line background decoration on the given 1-based pane line numbers.
function buildLineDecorations(content: string, lineNos: number[], className: string): DecorationSet {
  if (lineNos.length === 0) return Decoration.none;
  const starts = lineStartOffsets(content);
  const ranges = [...lineNos]
    .sort((a, b) => a - b)
    .map((n) => Decoration.line({ class: className }).range(starts[n - 1]));
  return Decoration.set(ranges);
}

function ReadOnlyStagePane({
  label,
  content,
  changedLines,
  stagedLines,
  onToggle,
  decorations,
  onView,
  onScroll,
}: {
  label: string;
  content: string;
  changedLines: Set<number>;
  stagedLines: Set<number>;
  onToggle: (lineNo: number) => void;
  decorations: DecorationSet;
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
          lineNumbers(),
          ...activeLineExtensions,
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
  }, [content, changedLines, onToggle, decorations, onView, onScroll]);

  // Push the controlled staged-line set into the gutter markers.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setStagedLines.of(stagedLines) });
  }, [stagedLines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
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

  const rows = useMemo(
    () => diffLines(contents.headContent, contents.worktreeContent),
    [contents.headContent, contents.worktreeContent],
  );
  const headText = useMemo(() => headPaneText(rows), [rows]);
  const worktreeText = useMemo(() => worktreePaneText(rows), [rows]);
  const headChanged = useMemo(() => headChangedLines(rows), [rows]);
  const worktreeChanged = useMemo(() => worktreeChangedLines(rows), [rows]);

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
  const headDecorations = useMemo(
    () => buildLineDecorations(headText, headChanged.map((l) => l.lineNo), "cm-diff-del-line"),
    [headText, headChanged],
  );
  const worktreeDecorations = useMemo(
    () => buildLineDecorations(worktreeText, worktreeChanged.map((l) => l.lineNo), "cm-diff-add-line"),
    [worktreeText, worktreeChanged],
  );

  // Row indices whose change is staged. Seeded to "everything staged" (result ==
  // working tree), so the panes open with every change marked "−".
  const [stagedRows, setStagedRows] = useState<Set<number>>(() => new Set(changedRowIndices(rows)));
  const stagedRowsRef = useRef(stagedRows);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const resultViewRef = useRef<EditorView | null>(null);
  const headViewRef = useRef<EditorView | null>(null);
  const worktreeViewRef = useRef<EditorView | null>(null);

  // Recompose the result buffer from a staged set, pushing both the new text and
  // the per-line metadata (drives the result gutter + change decoration).
  const applyStaged = useCallback(
    (next: Set<number>) => {
      stagedRowsRef.current = next;
      setStagedRows(next);
      const view = resultViewRef.current;
      if (view) {
        const { text, lines } = composeStagedResult(rows, next);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          effects: setResultLines.of(lines),
        });
      }
    },
    [rows],
  );

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

  // The editable result pane, seeded to the working tree (all changes staged).
  // Rebuilt when the file changes; seeds the line metadata on creation.
  useEffect(() => {
    if (!lineEditable || !resultContainerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: worktreeText,
        extensions: [
          lineNumbers(),
          ...activeLineExtensions,
          editorThemeExtension(),
          paneTheme,
          EditorView.lineWrapping,
          stageResultExtensions(toggleRow),
        ],
      }),
      parent: resultContainerRef.current,
    });
    resultViewRef.current = view;
    const { lines } = composeStagedResult(rows, stagedRowsRef.current);
    view.dispatch({ effects: setResultLines.of(lines) });
    const unregister = registerEditorView(view);
    return () => {
      unregister();
      view.destroy();
      resultViewRef.current = null;
    };
  }, [worktreeText, lineEditable, rows, toggleRow]);

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

  // Scroll every pane to a fraction of its scrollable height (overview click).
  const seek = useCallback((fraction: number) => {
    for (const view of [headViewRef.current, worktreeViewRef.current, resultViewRef.current]) {
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

  const handleStage = () => onStage(path, resultViewRef.current?.state.doc.toString() ?? worktreeText);
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
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {/* Top: HEAD / Working tree, side by side */}
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
              content={headText}
              changedLines={headChangedLineNos}
              stagedLines={headStagedLineNos}
              onToggle={onToggleHead}
              decorations={headDecorations}
              onView={registerHeadView}
              onScroll={onScrollHead}
            />
            <ReadOnlyStagePane
              label="Working Tree"
              content={worktreeText}
              changedLines={worktreeChangedLineNos}
              stagedLines={worktreeStagedLineNos}
              onToggle={onToggleWorktree}
              decorations={worktreeDecorations}
              onView={registerWorktreeView}
              onScroll={onScrollWorktree}
            />
          </div>

          {/* Bottom: editable staged result */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "var(--space-1) var(--space-2)",
                borderTop: "1px solid var(--color-border-subtle)",
                borderBottom: "1px solid var(--color-border-subtle)",
              }}
            >
              <span style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-secondary)" }}>
                Staged result
              </span>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button size="sm" type="button" onClick={handleReset}>
                  Reset
                </Button>
                <Button variant="primary" size="sm" type="button" onClick={handleStage}>
                  Stage
                </Button>
              </div>
            </div>
            <div ref={resultContainerRef} data-testid="result-pane" style={{ flex: 1, minHeight: 0, overflow: "hidden" }} />
          </div>
          </div>
          <ChangeOverview rows={rows} onSeek={seek} />
        </div>
      )}
    </div>
  );
}
