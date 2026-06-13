import { setEditorAppearance, type Appearance } from "./editorTheme";

export const CUSTOM_STYLE_ID = "app-custom-theme";
export const THEME_CHANGE_EVENT = "app-theme-change";

export interface AppliedTheme {
  id: string;
  appearance: Appearance;
  builtin: boolean;
  /** Required for custom (non-builtin) themes. */
  css?: string;
}

function customStyleElement(): HTMLStyleElement {
  let el = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = CUSTOM_STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
}

/**
 * Applies a theme to the document. Built-in themes toggle the `data-theme`
 * attribute (which the bundled token layer keys off); custom themes inject their
 * CSS into a single `<style>` element appended after the token layer so the
 * later cascade wins. Editor syntax appearance is updated to match.
 */
export function applyTheme(theme: AppliedTheme): void {
  const root = document.documentElement;

  if (theme.builtin) {
    document.getElementById(CUSTOM_STYLE_ID)?.remove();
    if (theme.id === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
  } else {
    root.removeAttribute("data-theme");
    customStyleElement().textContent = theme.css ?? "";
  }

  setEditorAppearance(theme.appearance);

  // Canvas-rendered surfaces (the commit graph) read their colours from CSS
  // tokens, so they need a nudge to re-resolve and redraw on a theme change.
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
