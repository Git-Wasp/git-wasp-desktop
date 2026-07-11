import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
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
  hunkLines,
  inlineText as buildInlineText,
} from "../../lib/lineDiff";
import { stageGutter, setStagedLines } from "./stageGutter";
import { ChangeOverview } from "./ChangeOverview";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Tooltip } from "../ui/Tooltip";
import {
  HunkViewIcon,
  InlineViewIcon,
  SplitViewIcon,
  WhitespaceIcon,
  WrapLinesIcon,
} from "../ui/icons";

type ViewMode = "split" | "inline" | "hunk";
const VIEW_MODES: ViewMode[] = ["split", "inline", "hunk"];
const VIEW_MODE_KEY = "stageFileEditor.viewMode";

function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return VIEW_MODES.includes(stored as ViewMode) ? (stored as ViewMode) : "split";
  } catch {
    return "split";
  }
}

// Soft line-wrapping in the diff panes. Defaults on (the historical behaviour);
// turning it off lets long lines overflow horizontally with a scrollbar.
const WRAP_KEY = "stageFileEditor.wrap";
// Hide changes that differ only in leading/trailing whitespace. Defaults off.
const IGNORE_WS_KEY = "stageFileEditor.ignoreWhitespace";

// A localStorage-backed boolean with a default for the first run / storage errors.
function loadBool(storageKey: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

interface StageFileEditorProps {
  path: string;
  contents: StageFileContents;
  /** Which panel opened the file: "unstaged" (Changes — clicking `+` stages the
   *  line) or "staged" (Staged — clicking `−` unstages it). Omitted in read-only
   *  mode, which has no staging affordances. */
  stageMode?: "staged" | "unstaged";
  /** Write the file's new index blob — the mechanism behind an immediate
   *  per-line stage/unstage. The editor composes the blob for the toggled line. */
  onApplyIndex?: (path: string, content: string) => void;
  /** Stage a binary / deleted file wholesale (line-level staging N/A). */
  onStageWholeFile?: (path: string) => void;
  onDiscardFile?: (path: string) => void;
  onClose?: () => void;
  /** Read-only mode: same diff surface (split/inline, red/green, syntax) but
   *  with no staging affordances — used to view a file's changes in a committed
   *  commit. Hides the stage gutters and Stage/Reset/Discard actions. */
  readOnly?: boolean;
  /** Pane labels for the two sides (defaults suit staging). */
  leftLabel?: string;
  rightLabel?: string;
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
  // Hunk-view range header (`@@ … @@`): a muted band separating each hunk.
  ".cm-diff-hunk-header": {
    backgroundColor: "var(--color-bg-elevated)",
    color: "var(--color-text-muted)",
  },
  // The absent side of an aligned change: a neutral diagonal hatch (à la
  // GitKraken), so only the side that holds the changed text reads green/red.
  ".cm-diff-placeholder-line": {
    backgroundColor: "var(--color-bg-surface)",
    backgroundImage:
      "repeating-linear-gradient(45deg, var(--color-border-default) 0, var(--color-border-default) 1px, transparent 1px, transparent 7px)",
  },
  // Inline view: a single gutter showing both the old (HEAD) and new
  // (working-tree) line numbers; either side is blank on a row that side lacks.
  ".cm-dual-old, .cm-dual-new": {
    display: "inline-block",
    minWidth: "2.5ch",
    padding: "0 var(--space-1)",
    textAlign: "right",
    color: "var(--color-text-muted)",
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

// A checkerboard so transparent regions of the image read as transparent (not a
// flat fill that could be mistaken for the image's own background).
const checkerBackground: React.CSSProperties = {
  backgroundColor: "var(--color-bg-elevated)",
  backgroundImage:
    "linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.18) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.18) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.18) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

/** One side of the image diff: the labelled version, or a muted placeholder when
 *  that side is absent (an added / deleted image). */
function ImagePane({
  label,
  src,
  emptyText,
}: {
  label?: string;
  src: string | null | undefined;
  emptyText: string;
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--color-bg-surface)" }}
    >
      {label && <div style={paneLabelStyle}>{label}</div>}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-3)",
        }}
      >
        {src ? (
          <img
            src={src}
            alt={label ? `${label} preview` : "image preview"}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", ...checkerBackground }}
          />
        ) : (
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
            {emptyText}
          </span>
        )}
      </div>
    </div>
  );
}

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

// One gutter element rendering an old + new line number side by side (either may
// be blank). Used by the inline/unified view in place of the single-column
// line-number gutter the split panes use.
class DualLineNumberMarker extends GutterMarker {
  constructor(
    readonly oldNo: string,
    readonly newNo: string,
  ) {
    super();
  }

  eq(other: DualLineNumberMarker) {
    return other.oldNo === this.oldNo && other.newNo === this.newNo;
  }

  toDOM() {
    const wrap = document.createElement("span");
    const old = wrap.appendChild(document.createElement("span"));
    old.className = "cm-dual-old";
    old.textContent = this.oldNo;
    const next = wrap.appendChild(document.createElement("span"));
    next.className = "cm-dual-new";
    next.textContent = this.newNo;
    return wrap;
  }
}

function dualNumberGutter(oldMap: (number | null)[], newMap: (number | null)[]): Extension {
  const label = (v: number | null) => (v == null ? "" : String(v));
  return gutter({
    class: "cm-dual-gutter",
    lineMarker(view, line) {
      const n = view.state.doc.lineAt(line.from).number;
      return new DualLineNumberMarker(label(oldMap[n - 1]), label(newMap[n - 1]));
    },
  });
}


function ReadOnlyStagePane({
  label,
  content,
  changedLines,
  stagedLines,
  onToggle,
  decorations,
  lineNumberMap,
  oldLineNumberMap,
  language,
  testId,
  onView,
  onScroll,
  showStageGutter = true,
  wrap = true,
}: {
  label?: string;
  content: string;
  changedLines: Set<number>;
  stagedLines: Set<number>;
  onToggle: (lineNo: number) => void;
  decorations: DecorationSet;
  /** Real file line number per 1-based pane line; `null` renders a blank gutter. */
  lineNumberMap: (number | null)[];
  /** When set, shows a dual old/new number gutter (inline view); `lineNumberMap`
   *  is then the *new* column and this the *old* column. */
  oldLineNumberMap?: (number | null)[];
  language: Extension | null;
  testId?: string;
  onView?: (view: EditorView | null) => void;
  onScroll?: () => void;
  /** Render the per-line `+`/`−` stage toggles. False for the read-only commit
   *  diff viewer, which has no staging. */
  showStageGutter?: boolean;
  /** Soft-wrap long lines; when false they overflow horizontally (scrollbar). */
  wrap?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Line wrapping lives in a compartment so toggling it reconfigures the live
  // editor rather than rebuilding it — preserving scroll, cursor, and the staged
  // gutter state (which is only re-pushed when the staged set itself changes).
  // `wrap` is read through a ref in the build effect so it seeds the initial
  // config without making the effect rebuild on every toggle.
  const wrapCompartment = useRef(new Compartment());
  const wrapRef = useRef(wrap);
  wrapRef.current = wrap;

  useEffect(() => {
    if (!containerRef.current) return;
    const numberGutter = oldLineNumberMap
      ? dualNumberGutter(oldLineNumberMap, lineNumberMap)
      : lineNumbers({
          // Aligned panes pad the opposite side with blank rows; those carry no
          // real file line, so leave their gutter empty.
          formatNumber: (n) => {
            const real = lineNumberMap[n - 1];
            return real == null ? "" : String(real);
          },
        });
    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          numberGutter,
          ...activeLineExtensions,
          ...(language ? [language] : []),
          editorThemeExtension(),
          paneTheme,
          EditorState.readOnly.of(true),
          wrapCompartment.current.of(wrapRef.current ? EditorView.lineWrapping : []),
          EditorView.decorations.of(decorations),
          ...(showStageGutter ? [stageGutter(changedLines, onToggle)] : []),
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
  }, [
    content,
    changedLines,
    onToggle,
    decorations,
    lineNumberMap,
    oldLineNumberMap,
    language,
    onView,
    onScroll,
    showStageGutter,
  ]);

  // Toggle wrapping on the live editor via the compartment (no rebuild).
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  // Push the controlled staged-line set into the gutter markers.
  useEffect(() => {
    if (!showStageGutter) return;
    viewRef.current?.dispatch({ effects: setStagedLines.of(stagedLines) });
  }, [stagedLines, showStageGutter]);

  return (
    <div
      data-testid={testId}
      // `minWidth: 0` lets this pane shrink below its content width inside the
      // split grid / row flex, so CodeMirror's `.cm-scroller` scrolls long lines
      // horizontally instead of the pane overflowing (only visible with wrap off).
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0 }}
    >
      {label !== undefined && <div style={paneLabelStyle}>{label}</div>}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }} />
    </div>
  );
}

export function StageFileEditor({
  path,
  contents,
  stageMode,
  onApplyIndex,
  onStageWholeFile,
  onDiscardFile,
  onClose,
  readOnly = false,
  leftLabel = "HEAD",
  rightLabel = "Working Tree",
}: StageFileEditorProps) {
  // In read-only mode a deletion (no "worktree" side) is still a perfectly good
  // diff to render (all-removed); only a binary file can't be shown line by line.
  // A recognised image (either side has a data-URI) previews as an image rather
  // than a text diff, taking priority over the line editor.
  const isImage = !!(contents.headImage || contents.worktreeImage);
  const lineEditable =
    !isImage && !contents.isBinary && (readOnly || contents.worktreeExists);

  const language = useMemo(() => languageForPath(path), [path]);

  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const changeViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }, []);

  // Persisted diff-view options: soft-wrap (default on) and hide whitespace-only
  // changes (default off).
  const [wrap, setWrap] = useState<boolean>(() => loadBool(WRAP_KEY, true));
  const [ignoreWhitespace, setIgnoreWhitespace] = useState<boolean>(() =>
    loadBool(IGNORE_WS_KEY, false),
  );
  const persistBool = (storageKey: string, value: boolean) => {
    try {
      localStorage.setItem(storageKey, String(value));
    } catch {
      // Best-effort persistence; ignore storage failures.
    }
  };
  const toggleWrap = useCallback(() => {
    setWrap((w) => {
      const next = !w;
      persistBool(WRAP_KEY, next);
      return next;
    });
  }, []);
  const toggleIgnoreWhitespace = useCallback(() => {
    setIgnoreWhitespace((v) => {
      const next = !v;
      persistBool(IGNORE_WS_KEY, next);
      return next;
    });
  }, []);

  const rows = useMemo(
    () => diffLines(contents.headContent, contents.worktreeContent, { ignoreWhitespace }),
    [contents.headContent, contents.worktreeContent, ignoreWhitespace],
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

  // Inline (unified) view: one editor, every row on its own line. Removed reads
  // red, added green; a change carries a single toggle (line i+1 ⇔ row i).
  const inlineText = useMemo(() => buildInlineText(rows), [rows]);
  const inlineDecorationEntries = useMemo(
    () =>
      rows.flatMap((r, i) =>
        r.kind === "added"
          ? [{ lineNo: i + 1, className: "cm-diff-add-line" }]
          : r.kind === "removed"
            ? [{ lineNo: i + 1, className: "cm-diff-del-line" }]
            : [],
      ),
    [rows],
  );
  const inlineDecorations = useMemo(
    () => buildLineDecorations(inlineText, inlineDecorationEntries),
    [inlineText, inlineDecorationEntries],
  );
  const inlineChangedLineNos = useMemo(
    () => new Set(rows.flatMap((r, i) => (r.kind === "context" ? [] : [i + 1]))),
    [rows],
  );

  // Hunk view: only the changed regions, each under an `@@ … @@` header, distant
  // context dropped. A header line is not a source row, so toggles map through
  // hunkLineToRow (hunk-doc line → source row index) rather than line ⇔ row.
  const hunkModel = useMemo(() => hunkLines(rows, 3), [rows]);
  const hunkTextValue = useMemo(() => hunkModel.map((l) => l.text).join("\n"), [hunkModel]);
  const hunkOldNumbers = useMemo(() => hunkModel.map((l) => l.oldNo), [hunkModel]);
  const hunkNewNumbers = useMemo(() => hunkModel.map((l) => l.newNo), [hunkModel]);
  const hunkChangedLineNos = useMemo(
    () =>
      new Set(hunkModel.flatMap((l, i) => (l.kind === "added" || l.kind === "removed" ? [i + 1] : []))),
    [hunkModel],
  );
  const hunkLineToRow = useMemo(
    () =>
      new Map(
        hunkModel.flatMap((l, i) =>
          l.rowIndex != null && (l.kind === "added" || l.kind === "removed")
            ? [[i + 1, l.rowIndex] as const]
            : [],
        ),
      ),
    [hunkModel],
  );
  const hunkDecorationEntries = useMemo(
    () =>
      hunkModel.flatMap((l, i) => {
        if (l.kind === "added") return [{ lineNo: i + 1, className: "cm-diff-add-line" }];
        if (l.kind === "removed") return [{ lineNo: i + 1, className: "cm-diff-del-line" }];
        if (l.kind === "header") return [{ lineNo: i + 1, className: "cm-diff-hunk-header" }];
        return [];
      }),
    [hunkModel],
  );
  const hunkDecorations = useMemo(
    () => buildLineDecorations(hunkTextValue, hunkDecorationEntries),
    [hunkTextValue, hunkDecorationEntries],
  );

  // Row indices whose change reads as staged, driving the gutter symbols (`−`
  // staged / `+` not). The two panels show a single git-native direction, so the
  // whole view is one state: the unstaged (Changes) view opens with nothing
  // staged (all `+`), the staged view with everything staged (all `−`). A toggle
  // applies to the index immediately and the refetched diff re-seeds this.
  const seedStaged = useCallback(
    () => (stageMode === "unstaged" ? new Set<number>() : new Set(changedRowIndices(rows))),
    [stageMode, rows],
  );
  const [stagedRows, setStagedRows] = useState<Set<number>>(seedStaged);
  const stagedRowsRef = useRef(stagedRows);
  const headViewRef = useRef<EditorView | null>(null);
  const worktreeViewRef = useRef<EditorView | null>(null);
  const inlineViewRef = useRef<EditorView | null>(null);
  const hunkViewRef = useRef<EditorView | null>(null);

  const applyStaged = useCallback((next: Set<number>) => {
    stagedRowsRef.current = next;
    setStagedRows(next);
  }, []);

  const toggleRow = useCallback(
    (rowIndex: number) => {
      // Live per-line staging: recompose this file's index blob and write it
      // immediately. Unstaged view (index → worktree) stages just this line;
      // staged view (HEAD → index) unstages it (keep every other staged line).
      if (stageMode && onApplyIndex) {
        let indexSelection: Set<number>;
        if (stageMode === "unstaged") {
          indexSelection = new Set([rowIndex]);
        } else {
          indexSelection = new Set(changedRowIndices(rows));
          indexSelection.delete(rowIndex);
        }
        onApplyIndex(path, composeStagedText(rows, indexSelection));
        return;
      }
      const next = new Set(stagedRowsRef.current);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      applyStaged(next);
    },
    [stageMode, onApplyIndex, rows, path, applyStaged],
  );

  // Re-seed the staged set whenever the file (its diff) or mode changes.
  useEffect(() => {
    const initial = seedStaged();
    stagedRowsRef.current = initial;
    setStagedRows(initial);
  }, [seedStaged]);

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
  const registerInlineView = useCallback((v: EditorView | null) => {
    inlineViewRef.current = v;
  }, []);
  const registerHunkView = useCallback((v: EditorView | null) => {
    hunkViewRef.current = v;
  }, []);
  const onScrollHead = useCallback(() => syncScroll("head"), [syncScroll]);
  const onScrollWorktree = useCallback(() => syncScroll("worktree"), [syncScroll]);

  // Scroll the live pane(s) to a fraction of their scrollable height (overview
  // click). Only the current view mode's editors are mounted.
  const seek = useCallback((fraction: number) => {
    for (const view of [
      headViewRef.current,
      worktreeViewRef.current,
      inlineViewRef.current,
      hunkViewRef.current,
    ]) {
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

  // Inline view: line i+1 maps straight back to row i.
  const onToggleInline = useCallback((lineNo: number) => toggleRow(lineNo - 1), [toggleRow]);

  // Hunk view: a doc line maps to a source row only for changed (non-header) lines.
  const onToggleHunk = useCallback(
    (lineNo: number) => {
      const row = hunkLineToRow.get(lineNo);
      if (row !== undefined) toggleRow(row);
    },
    [hunkLineToRow, toggleRow],
  );

  const headStagedLineNos = useMemo(
    () => new Set(headChanged.filter((l) => stagedRows.has(l.rowIndex)).map((l) => l.lineNo)),
    [headChanged, stagedRows],
  );
  const worktreeStagedLineNos = useMemo(
    () => new Set(worktreeChanged.filter((l) => stagedRows.has(l.rowIndex)).map((l) => l.lineNo)),
    [worktreeChanged, stagedRows],
  );
  const inlineStagedLineNos = useMemo(
    () => new Set([...stagedRows].map((rowIndex) => rowIndex + 1)),
    [stagedRows],
  );
  const hunkStagedLineNos = useMemo(
    () =>
      new Set(
        [...hunkChangedLineNos].filter((lineNo) => {
          const row = hunkLineToRow.get(lineNo);
          return row !== undefined && stagedRows.has(row);
        }),
      ),
    [hunkChangedLineNos, hunkLineToRow, stagedRows],
  );

  // File-level convenience: stage every remaining line (compose = working-tree
  // side) or unstage every line (compose = HEAD side), applied to the index now.
  const handleStageAll = () =>
    onApplyIndex?.(path, composeStagedText(rows, new Set(changedRowIndices(rows))));
  const handleUnstageAll = () => onApplyIndex?.(path, composeStagedText(rows, new Set()));

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
              <SegmentedControl
                ariaLabel="Diff view mode"
                iconOnly
                value={viewMode}
                onChange={changeViewMode}
                options={[
                  { value: "split", label: <SplitViewIcon />, ariaLabel: "Side-by-side view" },
                  { value: "inline", label: <InlineViewIcon />, ariaLabel: "Inline view" },
                  { value: "hunk", label: <HunkViewIcon />, ariaLabel: "Hunk view" },
                ]}
              />
              <Tooltip label={wrap ? "Wrapping long lines — click to overflow" : "Wrap long lines"}>
                <IconButton
                  aria-label="Wrap long lines"
                  aria-pressed={wrap}
                  onClick={toggleWrap}
                  style={{ color: wrap ? "var(--color-accent-primary)" : undefined }}
                >
                  <WrapLinesIcon />
                </IconButton>
              </Tooltip>
              <Tooltip
                label={
                  ignoreWhitespace
                    ? "Hiding whitespace-only changes — click to show"
                    : "Hide whitespace-only changes"
                }
              >
                <IconButton
                  aria-label="Hide whitespace-only changes"
                  aria-pressed={ignoreWhitespace}
                  onClick={toggleIgnoreWhitespace}
                  style={{ color: ignoreWhitespace ? "var(--color-accent-primary)" : undefined }}
                >
                  <WhitespaceIcon />
                </IconButton>
              </Tooltip>
              {!readOnly && stageMode === "unstaged" && (
                <Button variant="primary" size="sm" type="button" onClick={handleStageAll}>
                  Stage all
                </Button>
              )}
              {!readOnly && stageMode === "staged" && (
                <Button size="sm" type="button" onClick={handleUnstageAll}>
                  Unstage all
                </Button>
              )}
            </>
          )}
          {!readOnly && onDiscardFile && (
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
        isImage ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div
              data-testid="image-diff"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                flex: 1,
                minHeight: 0,
                gap: "1px",
                background: "var(--color-border-subtle)",
              }}
            >
              <ImagePane label={leftLabel} src={contents.headImage} emptyText="No previous version" />
              <ImagePane
                label={rightLabel}
                src={contents.worktreeImage}
                emptyText={contents.worktreeExists ? "—" : "Deleted"}
              />
            </div>
            {!readOnly && onStageWholeFile && (
              <div
                style={{
                  padding: "var(--space-2) var(--space-3)",
                  borderTop: "1px solid var(--color-border-subtle)",
                  display: "flex",
                  justifyContent: "flex-end",
                  flexShrink: 0,
                }}
              >
                <Button variant="primary" size="sm" onClick={() => onStageWholeFile(path)}>
                  Stage whole file
                </Button>
              </div>
            )}
          </div>
        ) : (
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
                ? readOnly
                  ? "Binary file — no preview available."
                  : "Binary file — can't be staged line by line."
                : "File deleted — can't be staged line by line."}
            </span>
            {!readOnly && onStageWholeFile && (
              <Button variant="primary" size="sm" onClick={() => onStageWholeFile(path)}>
                Stage whole file
              </Button>
            )}
          </div>
        )
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {viewMode === "split" ? (
            /* HEAD / Working tree, side by side and row-for-row aligned */
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                flex: 1,
                minHeight: 0,
                // Allow the grid to shrink below its content width (long, unwrapped
                // lines) within the row flex so the panes scroll rather than overflow.
                minWidth: 0,
                gap: "1px",
                background: "var(--color-border-subtle)",
              }}
            >
              <ReadOnlyStagePane
                label={leftLabel}
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
                showStageGutter={!readOnly}
                wrap={wrap}
              />
              <ReadOnlyStagePane
                label={rightLabel}
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
                showStageGutter={!readOnly}
                wrap={wrap}
              />
            </div>
          ) : viewMode === "inline" ? (
            /* Unified inline diff: one editor with old/new number columns */
            <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              <ReadOnlyStagePane
                testId="inline-pane"
                content={inlineText}
                changedLines={inlineChangedLineNos}
                stagedLines={inlineStagedLineNos}
                onToggle={onToggleInline}
                decorations={inlineDecorations}
                lineNumberMap={worktreeLineNumbers}
                oldLineNumberMap={headLineNumbers}
                language={language}
                onView={registerInlineView}
                showStageGutter={!readOnly}
                wrap={wrap}
              />
            </div>
          ) : (
            /* Hunk diff: changed regions only, each under an `@@ … @@` header */
            <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              <ReadOnlyStagePane
                testId="hunk-pane"
                content={hunkTextValue}
                changedLines={hunkChangedLineNos}
                stagedLines={hunkStagedLineNos}
                onToggle={onToggleHunk}
                decorations={hunkDecorations}
                lineNumberMap={hunkNewNumbers}
                oldLineNumberMap={hunkOldNumbers}
                language={language}
                onView={registerHunkView}
                showStageGutter={!readOnly}
                wrap={wrap}
              />
            </div>
          )}
          <ChangeOverview rows={rows} split={viewMode === "split"} onSeek={seek} />
        </div>
      )}
    </div>
  );
}
