import { describe, expect, it, beforeEach } from "vitest";
import { applyTheme, CUSTOM_STYLE_ID } from "./applyTheme";
import { getEditorAppearance } from "./editorTheme";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.getElementById(CUSTOM_STYLE_ID)?.remove();
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
});
