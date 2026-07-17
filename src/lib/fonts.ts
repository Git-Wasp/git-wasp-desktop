// Font preferences: the UI font, the code-editor (monospace) font, and a global
// UI size multiplier. Applied by overriding the `--font-family-sans`,
// `--font-family-mono`, and `--font-scale` CSS tokens on the document root, so
// the whole token layer (and the CodeMirror panes that read `--font-family-mono`)
// follow. Persisted to localStorage so the choice survives reloads.

import { THEME_CHANGE_EVENT } from "./applyTheme";

export interface FontOption {
  id: string;
  label: string;
  stack: string;
}

export interface SizeOption {
  id: string;
  label: string;
  scale: number;
}

// The first entry of each list is the default (matches the token defaults).
export const UI_FONTS: FontOption[] = [
  { id: "system", label: "System default", stack: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif' },
  { id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif' },
  { id: "helvetica", label: "Helvetica / Arial", stack: "Helvetica, Arial, sans-serif" },
  { id: "system-ui", label: "System UI", stack: "system-ui, sans-serif" },
  { id: "georgia", label: "Georgia (serif)", stack: 'Georgia, "Times New Roman", serif' },
];

export const MONO_FONTS: FontOption[] = [
  { id: "jetbrains", label: "JetBrains Mono", stack: '"JetBrains Mono", "Menlo", "Fira Code", monospace' },
  { id: "menlo", label: "Menlo", stack: "Menlo, monospace" },
  { id: "fira", label: "Fira Code", stack: '"Fira Code", Menlo, monospace' },
  { id: "sf-mono", label: "SF Mono", stack: '"SF Mono", Menlo, monospace' },
  { id: "consolas", label: "Consolas", stack: 'Consolas, "Courier New", monospace' },
  { id: "courier", label: "Courier New", stack: '"Courier New", monospace' },
];

export const UI_SIZES: SizeOption[] = [
  { id: "small", label: "Small", scale: 0.9 },
  { id: "default", label: "Default", scale: 1 },
  { id: "large", label: "Large", scale: 1.12 },
  { id: "xlarge", label: "Extra large", scale: 1.25 },
];

export interface FontPrefs {
  uiFontId: string;
  monoFontId: string;
  sizeId: string;
}

export const DEFAULT_FONT_PREFS: FontPrefs = {
  // Non-empty literal arrays declared above — index 0 always exists.
  uiFontId: UI_FONTS[0]!.id,
  monoFontId: MONO_FONTS[0]!.id,
  sizeId: "default",
};

const STORAGE_KEY = "fontPrefs";

const byId = <T extends { id: string }>(list: T[], id: string, fallback: T): T =>
  list.find((o) => o.id === id) ?? fallback;

export function uiFont(prefs: FontPrefs): FontOption {
  return byId(UI_FONTS, prefs.uiFontId, UI_FONTS[0]!);
}
export function monoFont(prefs: FontPrefs): FontOption {
  return byId(MONO_FONTS, prefs.monoFontId, MONO_FONTS[0]!);
}
export function uiSize(prefs: FontPrefs): SizeOption {
  return byId(UI_SIZES, prefs.sizeId, UI_SIZES[1]!);
}

export function loadFontPrefs(): FontPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FONT_PREFS;
    const parsed = JSON.parse(raw) as Partial<FontPrefs>;
    return {
      uiFontId: parsed.uiFontId ?? DEFAULT_FONT_PREFS.uiFontId,
      monoFontId: parsed.monoFontId ?? DEFAULT_FONT_PREFS.monoFontId,
      sizeId: parsed.sizeId ?? DEFAULT_FONT_PREFS.sizeId,
    };
  } catch {
    return DEFAULT_FONT_PREFS;
  }
}

export function saveFontPrefs(prefs: FontPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore storage failures */
  }
}

/** Push the chosen fonts/size onto the document root token layer. */
export function applyFontPrefs(prefs: FontPrefs): void {
  const root = document.documentElement.style;
  root.setProperty("--font-family-sans", uiFont(prefs).stack);
  root.setProperty("--font-family-mono", monoFont(prefs).stack);
  root.setProperty("--font-scale", String(uiSize(prefs).scale));
  // The commit graph canvas re-resolves CSS-derived metrics on this event.
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
