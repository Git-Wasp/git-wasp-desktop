import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { GutterMarker, gutter } from "@codemirror/view";

// The 1-based line numbers whose change is currently staged, for this pane.
// Controlled from React: the parent owns the staged set and pushes it in via
// `setStagedLines`; the markers report toggles back out via `onToggle`.
export const setStagedLines = StateEffect.define<Set<number>>();

export const stagedLinesField = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setStagedLines)) return e.value;
    }
    return value;
  },
});

class StageToggleMarker extends GutterMarker {
  constructor(
    readonly staged: boolean,
    readonly lineNo: number,
    readonly onToggle: (lineNo: number) => void,
  ) {
    super();
  }

  eq(other: StageToggleMarker) {
    return other.staged === this.staged && other.lineNo === this.lineNo;
  }

  toDOM() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-stage-toggle";
    // "−" means the line's change is staged (click to unstage); "+" means it is
    // not yet staged (click to stage).
    btn.textContent = this.staged ? "−" : "+";
    const label = this.staged ? "Unstage line" : "Stage line";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    // Don't let CodeMirror treat the click as an editor interaction.
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      this.onToggle(this.lineNo);
    });
    return btn;
  }
}

/**
 * A gutter of `+`/`−` toggle buttons on the changed lines of a staging diff
 * pane. `changedLines` are the 1-based line numbers that carry a control; which
 * of them currently read as staged (`−`) is driven by `stagedLinesField` (pushed
 * via `setStagedLines`). Toggles are reported through `onToggle(lineNo)`.
 */
export function stageGutter(
  changedLines: Set<number>,
  onToggle: (lineNo: number) => void,
): Extension {
  return [
    stagedLinesField,
    gutter({
      class: "cm-stage-gutter",
      lineMarker(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        if (!changedLines.has(lineNo)) return null;
        const staged = view.state.field(stagedLinesField).has(lineNo);
        return new StageToggleMarker(staged, lineNo, onToggle);
      },
      lineMarkerChange: (update) =>
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setStagedLines))),
    }),
  ];
}
