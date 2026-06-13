import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";

export type Appearance = "light" | "dark";

// The editors are created imperatively and scattered across components. Rather
// than rebuild them on a theme change, each editor includes a shared compartment
// and registers itself here; switching appearance reconfigures every live view.
const themeCompartment = new Compartment();
const views = new Set<EditorView>();
let currentAppearance: Appearance = "dark";

function themeFor(appearance: Appearance): Extension {
  // oneDark supplies a dark background + syntax colours; the light variant keeps
  // the token-driven pane background and only adds light syntax highlighting.
  return appearance === "dark"
    ? oneDark
    : syntaxHighlighting(defaultHighlightStyle);
}

/** Extension every CodeMirror editor should include so it follows the theme. */
export function editorThemeExtension(): Extension {
  return themeCompartment.of(themeFor(currentAppearance));
}

/** Registers a view for theme updates; returns an unregister fn for cleanup. */
export function registerEditorView(view: EditorView): () => void {
  views.add(view);
  return () => {
    views.delete(view);
  };
}

export function getEditorAppearance(): Appearance {
  return currentAppearance;
}

/** Switches the editor appearance and reconfigures every registered view. */
export function setEditorAppearance(appearance: Appearance): void {
  currentAppearance = appearance;
  for (const view of views) {
    view.dispatch({ effects: themeCompartment.reconfigure(themeFor(appearance)) });
  }
}
