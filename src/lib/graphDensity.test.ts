import { describe, expect, it } from "vitest";
import {
  DENSITY_ORDER,
  GRAPH_DENSITY,
  isGraphDensity,
  nextDensity,
} from "./graphDensity";

describe("graphDensity", () => {
  it("cycles Comfortable → Cozy → Compact → Comfortable", () => {
    expect(nextDensity("comfortable")).toBe("cozy");
    expect(nextDensity("cozy")).toBe("compact");
    expect(nextDensity("compact")).toBe("comfortable");
  });

  it("orders presets from tallest to shortest row", () => {
    const heights = DENSITY_ORDER.map((d) => GRAPH_DENSITY[d].rowHeight);
    expect(heights).toEqual([...heights].sort((a, b) => b - a));
    // heights.length === DENSITY_ORDER.length, a non-empty literal array.
    expect(heights[0]).toBeGreaterThan(heights[heights.length - 1]!);
  });

  it("scales the dot radius down with the row height", () => {
    const radii = DENSITY_ORDER.map((d) => GRAPH_DENSITY[d].dotRadius);
    expect(radii).toEqual([...radii].sort((a, b) => b - a));
  });

  it("places the body below at Comfortable, beside at Cozy, and hides it at Compact", () => {
    expect(GRAPH_DENSITY.comfortable.bodyPlacement).toBe("below");
    expect(GRAPH_DENSITY.cozy.bodyPlacement).toBe("beside");
    expect(GRAPH_DENSITY.compact.bodyPlacement).toBe("none");
  });

  it("validates persisted values", () => {
    expect(isGraphDensity("cozy")).toBe(true);
    expect(isGraphDensity("huge")).toBe(false);
    expect(isGraphDensity(null)).toBe(false);
  });
});
