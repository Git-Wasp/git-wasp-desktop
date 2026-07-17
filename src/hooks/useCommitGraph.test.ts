import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommitGraph, GRAPH_PAD_LEFT } from "./useCommitGraph";
import type { GraphNode, GraphViewport } from "../types/graph";

// A canvas 2D context mock that, unlike the ad hoc literals in the tests
// above, also records the fillStyle/strokeStyle *active at the moment* each
// fillRect/fill/stroke call fires — the property itself is reassigned many
// times per draw, so only the value read back at the call site tells us which
// colour a particular shape actually used.
function createCtxMock() {
  const fillCallStyles: string[] = [];
  const strokeCallStyles: string[] = [];
  const ctx = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn<
      (x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean) => void
    >(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    globalAlpha: 1,
    fillCallStyles,
    strokeCallStyles,
  };
  ctx.fillRect = vi.fn(() => fillCallStyles.push(ctx.fillStyle));
  ctx.fill = vi.fn(() => fillCallStyles.push(ctx.fillStyle));
  ctx.stroke = vi.fn(() => strokeCallStyles.push(ctx.strokeStyle));
  return ctx;
}

function asCanvasContext(ctx: ReturnType<typeof createCtxMock>): CanvasRenderingContext2D {
  return ctx as unknown as CanvasRenderingContext2D;
}

function makeNode(overrides: Partial<GraphNode> & Pick<GraphNode, "oid" | "lane">): GraphNode {
  return {
    shortOid: overrides.oid.slice(0, 7),
    summary: "",
    authorName: "A",
    authorEmail: "a@a",
    authorTimestamp: 0,
    row: 0,
    colorIndex: 0,
    parents: [],
    children: [],
    edges: [],
    branchLabels: [],
    isHead: false,
    onHeadLine: true,
    ...overrides,
  };
}

const emptySelection = { anchor: null, focus: null, range: new Set<string>() };

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
    expect(arc).toHaveBeenCalled();
    expect(arc.mock.calls[0]![0]).toBeCloseTo(expectedX);
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
    expect(changeRegistrations().length).toBeGreaterThan(0);
    const [, firstHandler] = changeRegistrations()[0]!;
    firstHandler(); // first DPR change, e.g. 1x -> 2x

    // A fresh "change" listener must have been registered for the next transition.
    expect(changeRegistrations().length).toBeGreaterThan(1);
    const [, secondHandler] = changeRegistrations()[changeRegistrations().length - 1]!;

    const getContextSpy = vi.spyOn(canvasRef.current, "getContext");
    secondHandler(); // second DPR change, e.g. 2x -> 3x — must still redraw
    expect(getContextSpy).toHaveBeenCalled();
  });

  it("positions dots by node.lane and edges by srcLane/dstLane", () => {
    const ctx = createCtxMock();
    const canvasRef = { current: document.createElement("canvas") };
    vi.spyOn(canvasRef.current, "getContext").mockReturnValue(asCanvasContext(ctx));

    const nodeA = makeNode({
      oid: "a".repeat(40),
      lane: 0,
      edges: [{ kind: "Straight", srcLane: 0, dstLane: 1, colorIndex: 0, onHeadLine: true }],
    });
    const nodeB = makeNode({ oid: "b".repeat(40), lane: 1 });
    const viewport: GraphViewport = { nodes: [nodeA, nodeB], totalCount: 2, offset: 0, headRow: null };

    renderHook(() => useCommitGraph(canvasRef, viewport, emptySelection, 200, null, false, 34, 5));

    // laneX(lane) = GRAPH_PAD_LEFT + lane * 24 (fallback laneWidth) + 12.
    const laneAX = GRAPH_PAD_LEFT + 0 * 24 + 12; // 22
    const laneBX = GRAPH_PAD_LEFT + 1 * 24 + 12; // 46
    const arcXs = ctx.arc.mock.calls.map((c) => c[0]);
    expect(arcXs).toContain(laneAX);
    expect(arcXs).toContain(laneBX);

    // The lane-crossing edge is drawn as a bezier between the two lanes' x's.
    expect(ctx.bezierCurveTo).toHaveBeenCalledWith(
      laneAX,
      expect.any(Number),
      laneBX,
      expect.any(Number),
      laneBX,
      expect.any(Number),
    );
  });

  it("mutes commits and edges off HEAD's line in focus mode, leaving on-line ones at full colour", () => {
    const ctx = createCtxMock();
    const canvasRef = { current: document.createElement("canvas") };
    vi.spyOn(canvasRef.current, "getContext").mockReturnValue(asCanvasContext(ctx));

    const offLine = makeNode({
      oid: "a".repeat(40),
      lane: 0,
      onHeadLine: false,
      edges: [{ kind: "Straight", srcLane: 0, dstLane: 0, colorIndex: 0, onHeadLine: false }],
    });
    const onLine = makeNode({ oid: "b".repeat(40), lane: 0, onHeadLine: true });
    const viewport: GraphViewport = { nodes: [offLine, onLine], totalCount: 2, offset: 0, headRow: null };

    renderHook(() => useCommitGraph(canvasRef, viewport, emptySelection, 200, null, true, 34, 5));

    // No --color-graph-muted / --color-lane-0 tokens are set in this test
    // environment, so resolveColors()/resolveLaneColors() fall through to
    // their hardcoded fallbacks: "#5b6270" (muted) and "#4d9de0" (lane 0).
    expect(ctx.fillCallStyles).toContain("#5b6270"); // the off-line dot
    expect(ctx.fillCallStyles).toContain("#4d9de0"); // the on-line dot, unmuted
    expect(ctx.strokeCallStyles).toContain("#5b6270"); // the off-line edge
  });

  it("highlights search matches and dims non-matching commits", () => {
    const ctx = createCtxMock();
    const canvasRef = { current: document.createElement("canvas") };
    vi.spyOn(canvasRef.current, "getContext").mockReturnValue(asCanvasContext(ctx));

    const match = makeNode({ oid: "a".repeat(40), lane: 0 });
    const nonMatch = makeNode({ oid: "b".repeat(40), lane: 0 });
    const viewport: GraphViewport = { nodes: [match, nonMatch], totalCount: 2, offset: 0, headRow: null };

    renderHook(() =>
      useCommitGraph(canvasRef, viewport, emptySelection, 200, null, false, 34, 5, true, new Set([match.oid])),
    );

    // No --color-graph-match token set, so resolveColors() falls back to this.
    expect(ctx.fillCallStyles).toContain("rgba(255, 199, 87, 0.22)"); // matched row's highlight band
    expect(ctx.fillCallStyles).toContain("#5b6270"); // non-match dot, dimmed like focus mode
  });

  it("draws the working-tree connector only when HEAD's row follows the working-tree row", () => {
    const wt = makeNode({ oid: "w".repeat(40), lane: 0, isWorkingTree: true });
    const middle = makeNode({ oid: "m".repeat(40), lane: 0 });
    const head = makeNode({ oid: "h".repeat(40), lane: 0, isHead: true });

    const drawnCtx = createCtxMock();
    const drawnCanvasRef = { current: document.createElement("canvas") };
    vi.spyOn(drawnCanvasRef.current, "getContext").mockReturnValue(asCanvasContext(drawnCtx));
    const viewportWithHeadBelow: GraphViewport = {
      nodes: [wt, middle, head],
      totalCount: 3,
      offset: 0,
      headRow: 2,
    };
    renderHook(() =>
      useCommitGraph(drawnCanvasRef, viewportWithHeadBelow, emptySelection, 200, null, false, 34, 5),
    );
    // No --color-warning token set, so resolveColors() falls back to this.
    expect(drawnCtx.strokeCallStyles).toContain("#ff9f0a");

    const skippedCtx = createCtxMock();
    const skippedCanvasRef = { current: document.createElement("canvas") };
    vi.spyOn(skippedCanvasRef.current, "getContext").mockReturnValue(asCanvasContext(skippedCtx));
    const viewportWithoutHead: GraphViewport = { nodes: [wt], totalCount: 1, offset: 0, headRow: null };
    renderHook(() =>
      useCommitGraph(skippedCanvasRef, viewportWithoutHead, emptySelection, 200, null, false, 34, 5),
    );
    expect(skippedCtx.strokeCallStyles).not.toContain("#ff9f0a");
  });

  it("draws only the HEAD ring, never a stacked selection ring, on a commit that is both", () => {
    const ctx = createCtxMock();
    const canvasRef = { current: document.createElement("canvas") };
    vi.spyOn(canvasRef.current, "getContext").mockReturnValue(asCanvasContext(ctx));

    const headSelected = makeNode({ oid: "h".repeat(40), lane: 0, isHead: true });
    const viewport: GraphViewport = { nodes: [headSelected], totalCount: 1, offset: 0, headRow: 0 };
    const selection = { anchor: headSelected.oid, focus: headSelected.oid, range: new Set([headSelected.oid]) };

    renderHook(() => useCommitGraph(canvasRef, viewport, selection, 200, null, false, 34, 5));

    const radii = ctx.arc.mock.calls.map((c) => c[2]);
    expect(radii).toContain(10); // dotRadius(5) + 5 — the HEAD ring
    expect(radii).not.toContain(9); // dotRadius(5) + 4 — the (suppressed) selection ring
  });
});
