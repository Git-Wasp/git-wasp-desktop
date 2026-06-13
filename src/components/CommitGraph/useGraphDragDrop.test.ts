import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGraphDragDrop } from "./useGraphDragDrop";
import type { BranchLabelHit } from "./dragDrop";

const pill = (over: Partial<BranchLabelHit>): BranchLabelHit => ({
  name: "main",
  isRemote: false,
  isTag: false,
  x: 0,
  y: 0,
  w: 50,
  h: 16,
  ...over,
});

function setup(hits: BranchLabelHit[]) {
  const onMerge = vi.fn();
  const onStartPullRequest = vi.fn();
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  const canvasRef = { current: canvas };
  const labelHitsRef = { current: hits };

  const view = renderHook(() =>
    useGraphDragDrop({ canvasRef, labelHitsRef, onMerge, onStartPullRequest }),
  );
  return { ...view, onMerge, onStartPullRequest };
}

const evt = (clientX: number, clientY: number) => ({
  clientX,
  clientY,
  preventDefault: vi.fn(),
});

// main pill on row 0, feat pill on row 1.
const localHits = (): BranchLabelHit[] => [
  pill({ name: "main", x: 0, y: 0, w: 50, h: 16 }),
  pill({ name: "feat", x: 0, y: 30, w: 50, h: 16 }),
];

describe("useGraphDragDrop", () => {
  it("starts dragging once the pointer moves past the threshold", () => {
    const { result } = setup(localHits());

    act(() => result.current.onPointerDown(evt(10, 8)));
    expect(result.current.dragging).toBe(false);

    act(() => result.current.onPointerMove(evt(10, 20)));
    expect(result.current.dragging).toBe(true);
  });

  it("highlights a different local pill as the drop target", () => {
    const { result } = setup(localHits());

    act(() => result.current.onPointerDown(evt(10, 8)));
    act(() => result.current.onPointerMove(evt(10, 38)));

    expect(result.current.dropTarget?.name).toBe("feat");
  });

  it("opens the drop menu with source and target on release", () => {
    const { result } = setup(localHits());

    act(() => result.current.onPointerDown(evt(10, 8)));
    act(() => result.current.onPointerMove(evt(10, 38)));
    act(() => result.current.onPointerUp(evt(10, 38)));

    expect(result.current.menu).toMatchObject({ source: "main", target: "feat" });
  });

  it("confirmMerge invokes onMerge with source and target", () => {
    const { result, onMerge } = setup(localHits());

    act(() => result.current.onPointerDown(evt(10, 8)));
    act(() => result.current.onPointerMove(evt(10, 38)));
    act(() => result.current.onPointerUp(evt(10, 38)));
    act(() => result.current.confirmMerge());

    expect(onMerge).toHaveBeenCalledWith("main", "feat");
    expect(result.current.menu).toBeNull();
  });

  it("confirmStartPullRequest invokes onStartPullRequest with source and target", () => {
    const { result, onStartPullRequest } = setup(localHits());

    act(() => result.current.onPointerDown(evt(10, 8)));
    act(() => result.current.onPointerMove(evt(10, 38)));
    act(() => result.current.onPointerUp(evt(10, 38)));
    act(() => result.current.confirmStartPullRequest());

    expect(onStartPullRequest).toHaveBeenCalledWith("main", "feat");
  });

  it("does not open a menu when dropped on the same branch", () => {
    const { result } = setup(localHits());

    act(() => result.current.onPointerDown(evt(10, 8)));
    act(() => result.current.onPointerMove(evt(40, 10))); // moved, still over main
    act(() => result.current.onPointerUp(evt(40, 10)));

    expect(result.current.menu).toBeNull();
  });

  it("does not start a drag from a remote or tag pill", () => {
    const { result } = setup([
      pill({ name: "origin/main", isRemote: true, x: 0, y: 0, w: 80, h: 16 }),
      pill({ name: "feat", x: 0, y: 30, w: 50, h: 16 }),
    ]);

    act(() => result.current.onPointerDown(evt(10, 8)));
    act(() => result.current.onPointerMove(evt(10, 38)));
    act(() => result.current.onPointerUp(evt(10, 38)));

    expect(result.current.dragging).toBe(false);
    expect(result.current.menu).toBeNull();
  });

  it("consumeClick reports and clears a completed drag", () => {
    const { result } = setup(localHits());

    act(() => result.current.onPointerDown(evt(10, 8)));
    act(() => result.current.onPointerMove(evt(10, 38)));
    act(() => result.current.onPointerUp(evt(10, 38)));

    expect(result.current.consumeClick()).toBe(true);
    // Second read is cleared.
    expect(result.current.consumeClick()).toBe(false);
  });

  it("consumeClick is false for a plain press without movement", () => {
    const { result } = setup(localHits());

    act(() => result.current.onPointerDown(evt(10, 8)));
    act(() => result.current.onPointerUp(evt(10, 8)));

    expect(result.current.consumeClick()).toBe(false);
  });
});
