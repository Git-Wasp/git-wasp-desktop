import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { applyTheme, type AppliedTheme } from "../lib/applyTheme";
import type { Appearance } from "../lib/editorTheme";

export interface ThemeInfo {
  id: string;
  name: string;
  author: string | null;
  version: string | null;
  appearance: Appearance;
  css?: string;
  builtin: boolean;
}

interface ThemeManifest {
  id: string;
  name: string;
  author: string | null;
  version: string | null;
  appearance: string;
  css: string;
}

export const BUILT_IN_THEMES: ThemeInfo[] = [
  { id: "dark", name: "Dark", author: null, version: null, appearance: "dark", builtin: true },
  { id: "light", name: "Light", author: null, version: null, appearance: "light", builtin: true },
  { id: "github-dark", name: "GitHub Dark", author: null, version: null, appearance: "dark", builtin: true },
  { id: "github-light", name: "GitHub Light", author: null, version: null, appearance: "light", builtin: true },
  { id: "cobalt2", name: "Cobalt2", author: null, version: null, appearance: "dark", builtin: true },
];

const toThemeInfo = (m: ThemeManifest): ThemeInfo => ({
  id: m.id,
  name: m.name,
  author: m.author,
  version: m.version,
  appearance: m.appearance === "light" ? "light" : "dark",
  css: m.css,
  builtin: false,
});

const toApplied = (t: ThemeInfo): AppliedTheme => ({
  id: t.id,
  appearance: t.appearance,
  builtin: t.builtin,
  css: t.css,
});

interface ThemeStore {
  themes: ThemeInfo[];
  activeThemeId: string;
  loadThemes: () => Promise<void>;
  initTheme: () => Promise<void>;
  setActiveTheme: (id: string) => Promise<void>;
  importTheme: () => Promise<void>;
  deleteTheme: (id: string) => Promise<void>;
  previewTheme: (id: string) => void;
  clearPreview: () => void;
}

const findTheme = (themes: ThemeInfo[], id: string): ThemeInfo =>
  themes.find((t) => t.id === id) ?? BUILT_IN_THEMES[0];

export const useThemeStore = create<ThemeStore>((set, get) => ({
  themes: BUILT_IN_THEMES,
  activeThemeId: "dark",

  loadThemes: async () => {
    const custom = await invoke<ThemeManifest[]>("list_custom_themes");
    set({ themes: [...BUILT_IN_THEMES, ...custom.map(toThemeInfo)] });
  },

  initTheme: async () => {
    await get().loadThemes();
    const activeId = (await invoke<string | null>("get_active_theme")) ?? "dark";
    const theme = findTheme(get().themes, activeId);
    applyTheme(toApplied(theme));
    set({ activeThemeId: theme.id });
  },

  setActiveTheme: async (id: string) => {
    const theme = findTheme(get().themes, id);
    applyTheme(toApplied(theme));
    set({ activeThemeId: theme.id });
    await invoke("set_active_theme", { id: theme.id });
  },

  importTheme: async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "CSS Theme", extensions: ["css"] }],
    });
    if (typeof path !== "string") return;
    await invoke<ThemeManifest>("import_theme", { srcPath: path });
    await get().loadThemes();
  },

  deleteTheme: async (id: string) => {
    await invoke("delete_theme", { id });
    if (get().activeThemeId === id) {
      await get().setActiveTheme("dark");
    }
    await get().loadThemes();
  },

  previewTheme: (id: string) => {
    applyTheme(toApplied(findTheme(get().themes, id)));
  },

  clearPreview: () => {
    applyTheme(toApplied(findTheme(get().themes, get().activeThemeId)));
  },
}));
