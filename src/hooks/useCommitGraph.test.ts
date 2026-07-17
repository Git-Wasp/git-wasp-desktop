import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommitGraph, GRAPH_PAD_LEFT } from "./useCommitGraph";
import type { GraphNode, GraphViewport } from "../types/graph";

describe("useCommitGraph", () => {
  it("falls back to 24px lane width (matching GraphSkeleton's hardcoded fallback), not 20px", () => {
    // No --graph-lane-width token is set on document.documentElement in this
    // test environment, so resolveConfig() must fall through to its hardcoded
    // fallback. GraphSkeleton (the loading placeholder shown before the real
    // graph mounts) hardcodes 24px; the real graph's own fallback must match it,
    // otherwise the skeleton-to-real-graph handoff visibly jumps lane x-positions
    // whenever the CSS token happens to be unset.
    const arc = vi.fn();
    const canvasRef = { current: document.createElement("canvas") };
    vi.spyOn(canvasRef.current, "getContext").mockReturnValue({
      clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      bezierCurveTo: vi.fn(), stroke: vi.fn(), arc, fill: vi.fn(), fillText: vi.fn(),
      setLineDash: vi.fn(), save: vi.fn(), restore: vi.fn(), clip: vi.fn(), drawImage: vi.fn(),
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    const graphNode: GraphNode = {
      oid: "a".repeat(40),
      shortOid: "aaaaaaa",
      summary: "first commit",
      body: "",
      authorName: "A",
      authorEmail: "a@a",
      authorTimestamp: 0,
      lane: 0,
      row: 0,
      colorIndex: 0,
      parents: [],
      children: [],
      edges: [],
      branchLabels: [],
      isHead: false,
      onHeadLine: true,
    };
    const viewport: GraphViewport = { nodes: [graphNode], totalCount: 1, offset: 0, headRow: null };
    const selection = { anchor: null, focus: null, range: new Set<string>() };
    renderHook(() => useCommitGraph(canvasRef, viewport, selection, 200, null, false, 34, 5));

    // GRAPH_PAD_LEFT + lane 0 * laneWidth + laneWidth / 2 — with a 24px
    // fallback this is 22; with the old 20px fallback it would be 20.
    const expectedX = GRAPH_PAD_LEFT + 0 * 24 + 24 / 2;
    expect(arc.mock.calls[0][0]).toBeCloseTo(expectedX);
  });

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

  it("keeps redrawing on a second DPR change, not just the first (re-subscribes rather than going stale)", () => {
    // A bare `(resolution: Xdppx)` query only fires `change` when the live DPR
    // crosses exactly the `X` it was created with. A listener subscribed once at
    // mount for the mount-time DPR would catch a 1x->2x move but then go silent
    // on a subsequent 2x->3x move. window.matchMedia is stubbed to always return
    // this same `mql`, so a second "change" registration on it is direct proof
    // the effect re-subscribed a fresh query after the first firing.
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

    const changeRegistrations = () => mql.addEventListener.mock.calls.filter(([type]) => type === "change");
    const [, firstHandler] = changeRegistrations()[0];
    firstHandler(); // first DPR change, e.g. 1x -> 2x

    // A fresh "change" listener must have been registered for the next transition.
    expect(changeRegistrations().length).toBeGreaterThan(1);
    const [, secondHandler] = changeRegistrations()[changeRegistrations().length - 1];

    const getContextSpy = vi.spyOn(canvasRef.current, "getContext");
    secondHandler(); // second DPR change, e.g. 2x -> 3x — must still redraw
    expect(getContextSpy).toHaveBeenCalled();
  });
});
