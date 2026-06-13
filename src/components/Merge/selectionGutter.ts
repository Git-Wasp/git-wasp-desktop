import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { GutterMarker, gutter } from "@codemirror/view";
import type { BlockLineRange } from "../../lib/lineSelection";

// Selected 1-based line numbers for this pane. Controlled from React: the
// parent owns the selection and pushes it in via `setSelectedLines`; the
// checkboxes only report toggles back out via the marker's `onToggle`.
export const setSelectedLines = StateEffect.define<Set<number>>();

export const selectedLinesField = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSelectedLines)) return e.value;
    }
    return value;
  },
});

class CheckboxMarker extends GutterMarker {
  constructor(
    readonly checked: boolean,
    readonly lineNo: number,
    readonly onToggle: (lineNo: number) => void,
  ) {
    super();
  }

  eq(other: CheckboxMarker) {
    return other.checked === this.checked && other.lineNo === this.lineNo;
  }

  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-select-checkbox";
    // Don't let CodeMirror treat the click as an editor interaction.
    box.addEventListener("mousedown", (e) => e.stopPropagation());
    box.addEventListener("change", () => this.onToggle(this.lineNo));
    return box;
  }
}

/**
 * A gutter of checkboxes on the lines that belong to a conflict block, letting
 * the user pick individual source/current lines. Toggles are reported via
 * `onToggle(lineNo)`; the checked state is driven by `selectedLinesField`.
 */
export function selectionGutter(
  ranges: BlockLineRange[],
  onToggle: (lineNo: number) => void,
): Extension {
  const inBlock = (lineNo: number) => ranges.some((r) => lineNo >= r.start && lineNo <= r.end);

  return [
    selectedLinesField,
    gutter({
      class: "cm-select-gutter",
      lineMarker(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        if (!inBlock(lineNo)) return null;
        const checked = view.state.field(selectedLinesField).has(lineNo);
        return new CheckboxMarker(checked, lineNo, onToggle);
      },
      lineMarkerChange: (update) =>
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setSelectedLines))),
    }),
  ];
}
