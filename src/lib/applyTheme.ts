import { setEditorAppearance, type Appearance } from "./editorTheme";

export const CUSTOM_STYLE_ID = "app-custom-theme";
export const THEME_CHANGE_EVENT = "app-theme-change";
const THEME_CACHE_KEY = "activeTheme";

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
 * Applies a theme to the document. Built-in themes select a `data-theme` block
 * in the bundled token layer by id (e.g. "light", "github-dark"); "dark" is the
 * `:root` default, so it clears the attribute instead. Custom themes inject their
 * CSS into a single `<style>` element appended after the token layer so the later
 * cascade wins. Editor syntax appearance is updated to match.
 */
export function applyTheme(theme: AppliedTheme): void {
  const root = document.documentElement;

  if (theme.builtin) {
    document.getElementById(CUSTOM_STYLE_ID)?.remove();
    if (theme.id === "dark") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme.id);
  } else {
    root.removeAttribute("data-theme");
    customStyleElement().textContent = theme.css ?? "";
  }

  setEditorAppearance(theme.appearance);

  // Canvas-rendered surfaces (the commit graph) read their colours from CSS
  // tokens, so they need a nudge to re-resolve and redraw on a theme change.
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/**
 * Remember the active theme locally so it can be applied synchronously on the
 * next launch (see [`applyCachedTheme`]). The authoritative value still lives in
 * the backend; this is only a fast-path cache to avoid the default-theme flash
 * while that async load completes. Custom themes cache their CSS too.
 */
export function cacheActiveTheme(theme: AppliedTheme): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme));
  } catch {
    /* caching is best-effort */
  }
}

/**
 * Apply the cached theme (if any) immediately — call this before the first React
 * render so the app paints in the user's theme rather than flashing the default
 * and switching once the backend load resolves. A no-op when nothing is cached.
 */
export function applyCachedTheme(): void {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return;
    const theme = JSON.parse(raw) as AppliedTheme;
    if (theme && typeof theme.id === "string" && typeof theme.appearance === "string") {
      applyTheme(theme);
    }
  } catch {
    /* ignore a malformed cache — the backend load will set the real theme */
  }
}
