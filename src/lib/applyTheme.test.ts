import { describe, expect, it, beforeEach } from "vitest";
import { applyCachedTheme, applyTheme, cacheActiveTheme, CUSTOM_STYLE_ID } from "./applyTheme";
import { getEditorAppearance } from "./editorTheme";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.getElementById(CUSTOM_STYLE_ID)?.remove();
  localStorage.clear();
});

describe("applyTheme", () => {
  it("sets data-theme=light for the built-in light theme", () => {
    applyTheme({ id: "light", appearance: "light", builtin: true });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.getElementById(CUSTOM_STYLE_ID)).toBeNull();
    expect(getEditorAppearance()).toBe("light");
  });

  it("clears data-theme for the built-in dark theme", () => {
    applyTheme({ id: "light", appearance: "light", builtin: true });
    applyTheme({ id: "dark", appearance: "dark", builtin: true });
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(getEditorAppearance()).toBe("dark");
  });

  it("sets data-theme to the id for other built-in themes", () => {
    applyTheme({ id: "github-dark", appearance: "dark", builtin: true });
    expect(document.documentElement.getAttribute("data-theme")).toBe("github-dark");
    expect(getEditorAppearance()).toBe("dark");

    applyTheme({ id: "github-light", appearance: "light", builtin: true });
    expect(document.documentElement.getAttribute("data-theme")).toBe("github-light");
    expect(getEditorAppearance()).toBe("light");
  });

  it("injects custom CSS into a style element and clears data-theme", () => {
    applyTheme({ id: "light", appearance: "light", builtin: true });
    applyTheme({
      id: "solar",
      appearance: "dark",
      builtin: false,
      css: ":root { --color-bg-app: #112233; }",
    });

    const style = document.getElementById(CUSTOM_STYLE_ID);
    expect(style?.textContent).toContain("--color-bg-app: #112233");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("replaces previously injected custom CSS", () => {
    applyTheme({ id: "a", appearance: "dark", builtin: false, css: ":root { --color-bg-app: #aaa; }" });
    applyTheme({ id: "b", appearance: "dark", builtin: false, css: ":root { --color-bg-app: #bbb; }" });

    const style = document.getElementById(CUSTOM_STYLE_ID);
    expect(style?.textContent).toContain("#bbb");
    expect(style?.textContent).not.toContain("#aaa");
  });

  describe("cached theme", () => {
    it("applyCachedTheme is a no-op with nothing cached", () => {
      applyCachedTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    });

    it("re-applies a cached built-in theme synchronously", () => {
      cacheActiveTheme({ id: "github-dark", appearance: "dark", builtin: true });
      applyCachedTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe("github-dark");
      expect(getEditorAppearance()).toBe("dark");
    });

    it("re-applies a cached custom theme's CSS", () => {
      cacheActiveTheme({
        id: "solar",
        appearance: "dark",
        builtin: false,
        css: ":root { --color-bg-app: #424242; }",
      });
      applyCachedTheme();
      expect(document.getElementById(CUSTOM_STYLE_ID)?.textContent).toContain("#424242");
    });

    it("ignores a malformed cache", () => {
      localStorage.setItem("activeTheme", "not json");
      expect(() => applyCachedTheme()).not.toThrow();
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    });
  });
});
