import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_PREFS,
  MONO_FONTS,
  UI_FONTS,
  applyFontPrefs,
  loadFontPrefs,
  monoFont,
  saveFontPrefs,
  uiFont,
  uiSize,
} from "./fonts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("font prefs persistence", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadFontPrefs()).toEqual(DEFAULT_FONT_PREFS);
  });

  it("round-trips saved prefs", () => {
    saveFontPrefs({ uiFontId: "inter", monoFontId: "menlo", sizeId: "large" });
    expect(loadFontPrefs()).toEqual({ uiFontId: "inter", monoFontId: "menlo", sizeId: "large" });
  });

  it("fills missing fields from defaults and survives bad JSON", () => {
    localStorage.setItem("fontPrefs", '{"uiFontId":"inter"}');
    expect(loadFontPrefs()).toEqual({
      uiFontId: "inter",
      monoFontId: DEFAULT_FONT_PREFS.monoFontId,
      sizeId: DEFAULT_FONT_PREFS.sizeId,
    });

    localStorage.setItem("fontPrefs", "not json");
    expect(loadFontPrefs()).toEqual(DEFAULT_FONT_PREFS);
  });
});

describe("lookups fall back to the default option for unknown ids", () => {
  it("uiFont / monoFont / uiSize", () => {
    const prefs = { uiFontId: "nope", monoFontId: "nope", sizeId: "nope" };
    expect(uiFont(prefs)).toBe(UI_FONTS[0]);
    expect(monoFont(prefs)).toBe(MONO_FONTS[0]);
    expect(uiSize(prefs).id).toBe("default");
  });
});

describe("applyFontPrefs", () => {
  it("writes the chosen fonts and scale onto the document root", () => {
    applyFontPrefs({ uiFontId: "inter", monoFontId: "menlo", sizeId: "large" });
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--font-family-sans")).toBe(uiFont({ uiFontId: "inter" } as never).stack);
    expect(root.getPropertyValue("--font-family-mono")).toContain("Menlo");
    expect(root.getPropertyValue("--font-scale")).toBe("1.12");
  });
});
