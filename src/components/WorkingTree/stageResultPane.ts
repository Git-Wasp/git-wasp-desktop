import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";
import type { ResultLine } from "../../lib/lineDiff";

// Per-document-line metadata for the staged result pane, pushed in alongside
// each recompose. Drives both the gutter toggles and the red/green decoration.
export const setResultLines = StateEffect.define<ResultLine[]>();

export const resultLinesField = StateField.define<ResultLine[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setResultLines)) return e.value;
    }
    return value;
  },
});

class ResultToggleMarker extends GutterMarker {
  constructor(
    readonly staged: boolean,
    readonly rowIndex: number,
    readonly onToggleRow: (rowIndex: number) => void,
  ) {
    super();
  }

  eq(other: ResultToggleMarker) {
    return other.staged === this.staged && other.rowIndex === this.rowIndex;
  }

  toDOM() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-stage-toggle";
    btn.textContent = this.staged ? "−" : "+";
    const label = this.staged ? "Unstage line" : "Stage line";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      this.onToggleRow(this.rowIndex);
    });
    return btn;
  }
}

// Red/green line decoration derived from the result-line metadata: staged
// additions read green, kept (pending) removals read red.
const resultDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (!tr.docChanged && !tr.effects.some((e) => e.is(setResultLines))) return value;
    const lines = tr.state.field(resultLinesField);
    const doc = tr.state.doc;
    const builder = new RangeSetBuilder<Decoration>();
    for (let i = 0; i < lines.length && i < doc.lines; i++) {
      const info = lines[i];
      if (info.kind === "added" || info.kind === "removed") {
        const from = doc.line(i + 1).from;
        const cls = info.kind === "added" ? "cm-diff-add-line" : "cm-diff-del-line";
        builder.add(from, from, Decoration.line({ class: cls }));
      }
    }
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Extensions for the editable staged-result pane: a `+`/`−` gutter on its
 * changed lines (toggling the source row via `onToggleRow`) plus red/green
 * change decoration. Both are driven by `resultLinesField`, which the host
 * updates via `setResultLines` on every recompose.
 */
export function stageResultExtensions(onToggleRow: (rowIndex: number) => void): Extension {
  return [
    resultLinesField,
    resultDecorationsField,
    gutter({
      class: "cm-stage-gutter",
      lineMarker(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        const info = view.state.field(resultLinesField)[lineNo - 1];
        if (!info || info.kind === "context") return null;
        return new ResultToggleMarker(info.staged, info.rowIndex, onToggleRow);
      },
      lineMarkerChange: (update) =>
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setResultLines))),
    }),
  ];
}
