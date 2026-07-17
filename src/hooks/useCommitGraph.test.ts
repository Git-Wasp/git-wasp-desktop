import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommitGraph } from "./useCommitGraph";

describe("useCommitGraph", () => {
  it("resolves CSS custom properties once per theme/density change, not once per draw", () => {
    const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle");
    const canvasRef = { current: document.createElement("canvas") };
    vi.spyOn(canvasRef.current, "getContext").mockReturnValue({
      clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      bezierCurveTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillText: vi.fn(),
      setLineDash: vi.fn(), save: vi.fn(), restore: vi.fn(), clip: vi.fn(), drawImage: vi.fn(),
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    const viewport = { nodes: [], totalCount: 0, offset: 0, headRow: null };
    const selection = { anchor: null, focus: null, range: new Set<string>() };
    const { rerender } = renderHook(
      ({ hoveredOid }) => useCommitGraph(canvasRef, viewport, selection, 200, hoveredOid, false, 34, 5),
      { initialProps: { hoveredOid: null as string | null } },
    );
    const callsAfterMount = getComputedStyleSpy.mock.calls.length;

    rerender({ hoveredOid: "abc" }); // simulate a hover-sweep re-draw
    rerender({ hoveredOid: "def" });

    // Token resolution must not scale with the number of draws/hover changes.
    expect(getComputedStyleSpy.mock.calls.length).toBe(callsAfterMount);
  });

  it("redraws when devicePixelRatio changes (window moved to a different-DPI monitor)", () => {
    const mql = {
      matches: false,
      addEventListener: vi.fn<(type: string, cb: () => void) => void>(),
      removeEventListener: vi.fn<(type: string, cb: () => void) => void>(),
    };
    vi.spyOn(window, "matchMedia").mockReturnValue(mql as unknown as MediaQueryList);
    const canvasRef = { current: document.createElement("canvas") };
    vi.spyOn(canvasRef.current, "getContext").mockReturnValue({
      clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      bezierCurveTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillText: vi.fn(),
      setLineDash: vi.fn(), save: vi.fn(), restore: vi.fn(), clip: vi.fn(), drawImage: vi.fn(),
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    const viewport = { nodes: [], totalCount: 0, offset: 0, headRow: null };
    const selection = { anchor: null, focus: null, range: new Set<string>() };
    renderHook(() => useCommitGraph(canvasRef, viewport, selection, 200, null, false, 34, 5));

    const [, handler] = mql.addEventListener.mock.calls.find(([type]) => type === "change")!;
    const getContextSpy = vi.spyOn(canvasRef.current, "getContext");
    handler();
    expect(getContextSpy).toHaveBeenCalled(); // a redraw happened
  });
});
