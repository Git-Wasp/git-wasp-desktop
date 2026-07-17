import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useThemeStore, BUILT_IN_THEMES } from "../themeStore";
import { CUSTOM_STYLE_ID } from "../../lib/applyTheme";

const mockInvoke = vi.mocked(invoke);
const mockOpen = vi.mocked(open);

const customManifest = {
  id: "solar",
  name: "Solar",
  author: "Jane",
  version: "1.0.0",
  appearance: "dark",
  css: ":root { --color-bg-app: #002b36; }",
};

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-theme");
  document.getElementById(CUSTOM_STYLE_ID)?.remove();
  useThemeStore.setState({ themes: BUILT_IN_THEMES, activeThemeId: "dark" });
});

describe("themeStore", () => {
  it("initTheme loads themes, reads the active id, and applies it", async () => {
    mockInvoke.mockResolvedValueOnce([]); // list_custom_themes
    mockInvoke.mockResolvedValueOnce("light"); // get_active_theme

    await useThemeStore.getState().initTheme();

    expect(useThemeStore.getState().activeThemeId).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("initTheme falls back to dark when no active theme is stored", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce(null);

    await useThemeStore.getState().initTheme();

    expect(useThemeStore.getState().activeThemeId).toBe("dark");
  });

  it("loadThemes merges built-ins with custom themes", async () => {
    mockInvoke.mockResolvedValueOnce([customManifest]);

    await useThemeStore.getState().loadThemes();

    const ids = useThemeStore.getState().themes.map((t) => t.id);
    expect(ids).toEqual(["dark", "light", "github-dark", "github-light", "cobalt2", "solar"]);
  });

  it("setActiveTheme applies and persists", async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // set_active_theme

    await useThemeStore.getState().setActiveTheme("light");

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(useThemeStore.getState().activeThemeId).toBe("light");
    expect(mockInvoke).toHaveBeenCalledWith("set_active_theme", { id: "light" });
  });

  it("does not apply or persist the theme locally if the backend persist fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("disk full")); // set_active_theme

    await expect(useThemeStore.getState().setActiveTheme("light")).rejects.toThrow("disk full");

    // Still showing "dark" — a failed persist must not have applied "light" first.
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(useThemeStore.getState().activeThemeId).toBe("dark");
  });

  it("setActiveTheme injects custom CSS for a custom theme", async () => {
    useThemeStore.setState({
      themes: [
        ...BUILT_IN_THEMES,
        { id: "solar", name: "Solar", author: "Jane", version: "1.0.0", appearance: "dark", css: customManifest.css, builtin: false },
      ],
    });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useThemeStore.getState().setActiveTheme("solar");

    expect(document.getElementById(CUSTOM_STYLE_ID)?.textContent).toContain("#002b36");
  });

  it("importTheme opens a css picker and imports the chosen file", async () => {
    mockOpen.mockResolvedValueOnce("/themes/solar.css");
    mockInvoke.mockResolvedValueOnce(customManifest); // import_theme
    mockInvoke.mockResolvedValueOnce([customManifest]); // loadThemes

    await useThemeStore.getState().importTheme();

    expect(mockOpen).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "CSS Theme", extensions: ["css"] }],
    });
    expect(mockInvoke).toHaveBeenCalledWith("import_theme", { srcPath: "/themes/solar.css" });
  });

  it("importTheme does nothing when the picker is cancelled", async () => {
    mockOpen.mockResolvedValueOnce(null);

    await useThemeStore.getState().importTheme();

    expect(mockInvoke).not.toHaveBeenCalledWith("import_theme", expect.anything());
  });

  it("deleteTheme removes the theme and reverts to dark if it was active", async () => {
    useThemeStore.setState({ activeThemeId: "solar" });
    mockInvoke.mockResolvedValueOnce(undefined); // delete_theme
    mockInvoke.mockResolvedValueOnce(undefined); // set_active_theme (revert)
    mockInvoke.mockResolvedValueOnce([]); // loadThemes

    await useThemeStore.getState().deleteTheme("solar");

    expect(mockInvoke).toHaveBeenCalledWith("delete_theme", { id: "solar" });
    expect(useThemeStore.getState().activeThemeId).toBe("dark");
  });

  it("previewTheme applies without persisting", () => {
    useThemeStore.getState().previewTheme("light");

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(useThemeStore.getState().activeThemeId).toBe("dark"); // unchanged
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
