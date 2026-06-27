import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGraphDragDrop } from "./useGraphDragDrop";
import type { BranchLabel } from "../../types/graph";

const label = (name: string, over: Partial<BranchLabel> = {}): BranchLabel => ({
  name,
  isRemote: false,
  isTag: false,
  ...over,
});

// jsdom PointerEvent ignores clientX; MouseEvent honors it and dispatch is by
// type name, so window listeners receive coordinates.
function fireWindow(type: string, clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
}

const down = (clientX: number, clientY: number) =>
  ({ clientX, clientY, preventDefault: vi.fn() }) as unknown as React.PointerEvent;

function setup() {
  const onMerge = vi.fn();
  const onStartPullRequest = vi.fn();
  const view = renderHook(() => useGraphDragDrop({ onMerge, onStartPullRequest }));
  return { ...view, onMerge, onStartPullRequest };
}

describe("useGraphDragDrop (DOM pills)", () => {
  it("starts dragging once the pointer moves past the threshold", () => {
    const { result } = setup();
    act(() => result.current.onPillPointerDown(down(10, 8), label("main")));
    expect(result.current.dragging).toBe(false);

    act(() => fireWindow("pointermove", 10, 20));
    expect(result.current.dragging).toBe(true);
    expect(result.current.dragSource).toBe("main");
  });

  it("marks a different local pill as the drop target on enter", () => {
    const { result } = setup();
    act(() => result.current.onPillPointerDown(down(10, 8), label("main")));
    act(() => fireWindow("pointermove", 10, 20));
    act(() => result.current.onPillPointerEnter(label("feat")));
    expect(result.current.dropTarget).toBe("feat");
  });

  it("opens the drop menu with source and target on release over a target", () => {
    const { result } = setup();
    act(() => result.current.onPillPointerDown(down(10, 8), label("main")));
    act(() => fireWindow("pointermove", 10, 20));
    act(() => result.current.onPillPointerEnter(label("feat")));
    act(() => fireWindow("pointerup", 30, 40));

    expect(result.current.menu).toMatchObject({ source: "main", target: "feat" });
  });

  it("does not open a menu without a drop target", () => {
    const { result } = setup();
    act(() => result.current.onPillPointerDown(down(10, 8), label("main")));
    act(() => fireWindow("pointermove", 10, 20));
    act(() => fireWindow("pointerup", 30, 40));
    expect(result.current.menu).toBeNull();
  });

  it("ignores the source pill and remote/tag pills as targets", () => {
    const { result } = setup();
    act(() => result.current.onPillPointerDown(down(10, 8), label("main")));
    act(() => fireWindow("pointermove", 10, 20));
    act(() => result.current.onPillPointerEnter(label("main"))); // same as source
    expect(result.current.dropTarget).toBeNull();
    act(() => result.current.onPillPointerEnter(label("origin/main", { isRemote: true })));
    expect(result.current.dropTarget).toBeNull();
  });

  it("confirm actions call the injected handlers", () => {
    const { result, onMerge, onStartPullRequest } = setup();
    act(() => result.current.onPillPointerDown(down(10, 8), label("main")));
    act(() => fireWindow("pointermove", 10, 20));
    act(() => result.current.onPillPointerEnter(label("feat")));
    act(() => fireWindow("pointerup", 30, 40));

    act(() => result.current.confirmMerge());
    expect(onMerge).toHaveBeenCalledWith("main", "feat");

    act(() => result.current.onPillPointerDown(down(10, 8), label("main")));
    act(() => fireWindow("pointermove", 10, 20));
    act(() => result.current.onPillPointerEnter(label("feat")));
    act(() => fireWindow("pointerup", 30, 40));
    act(() => result.current.confirmStartPullRequest());
    expect(onStartPullRequest).toHaveBeenCalledWith("main", "feat");
  });

  it("adds a body class while dragging and removes it on release (to suppress text selection)", () => {
    const { result } = setup();
    expect(document.body.classList.contains("dragging-branch-pill")).toBe(false);

    act(() => result.current.onPillPointerDown(down(10, 8), label("main")));
    act(() => fireWindow("pointermove", 10, 20));
    expect(document.body.classList.contains("dragging-branch-pill")).toBe(true);

    act(() => fireWindow("pointerup", 10, 20));
    expect(document.body.classList.contains("dragging-branch-pill")).toBe(false);
  });

  it("consumeClick reports and clears a completed drag", () => {
    const { result } = setup();
    act(() => result.current.onPillPointerDown(down(10, 8), label("main")));
    act(() => fireWindow("pointermove", 10, 20));
    act(() => fireWindow("pointerup", 10, 20));
    expect(result.current.consumeClick()).toBe(true);
    expect(result.current.consumeClick()).toBe(false);
  });
});
