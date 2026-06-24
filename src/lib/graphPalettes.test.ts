import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PALETTE_ID,
  GRAPH_PALETTES,
  LANE_COUNT,
  applyGraphPalette,
  getPalette,
  loadGraphPaletteId,
  saveGraphPaletteId,
} from "./graphPalettes";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("graph palette persistence", () => {
  it("defaults to the theme palette when nothing (or something unknown) is stored", () => {
    expect(loadGraphPaletteId()).toBe(DEFAULT_PALETTE_ID);
    localStorage.setItem("graphPalette", "does-not-exist");
    expect(loadGraphPaletteId()).toBe(DEFAULT_PALETTE_ID);
  });

  it("round-trips a saved palette id", () => {
    saveGraphPaletteId("bright");
    expect(loadGraphPaletteId()).toBe("bright");
  });
});

describe("getPalette", () => {
  it("falls back to the first (theme) palette for an unknown id", () => {
    expect(getPalette("nope")).toBe(GRAPH_PALETTES[0]);
  });

  it("every non-theme palette defines exactly LANE_COUNT colours", () => {
    for (const p of GRAPH_PALETTES) {
      if (p.colors) expect(p.colors).toHaveLength(LANE_COUNT);
    }
  });
});

describe("applyGraphPalette", () => {
  it("overrides the lane tokens for a colour palette", () => {
    applyGraphPalette("bright");
    const bright = getPalette("bright").colors!;
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--color-lane-0")).toBe(bright[0]);
    expect(root.getPropertyValue("--color-lane-7")).toBe(bright[7]);
  });

  it("clears the overrides for the theme palette so the theme's lanes show", () => {
    applyGraphPalette("bright");
    expect(document.documentElement.style.getPropertyValue("--color-lane-0")).not.toBe("");

    applyGraphPalette("theme");
    expect(document.documentElement.style.getPropertyValue("--color-lane-0")).toBe("");
  });
});
