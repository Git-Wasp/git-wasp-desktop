import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { Tooltip } from "./Tooltip";

// The tooltip appears via a setTimeout that updates state, so timer advances
// must run inside act() to flush the resulting React render.
const advance = (ms: number) => {
  void act(() => vi.advanceTimersByTime(ms));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Tooltip", () => {
  it("always renders its children", () => {
    render(
      <Tooltip label="origin/feature/very-long-branch-name">
        <button>pill</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "pill" })).toBeInTheDocument();
  });

  it("shows the label after the hover delay and hides on leave", () => {
    render(
      <Tooltip label="origin/feature/x" delay={300}>
        <span>pill</span>
      </Tooltip>,
    );
    const wrapper = screen.getByText("pill").parentElement!;

    fireEvent.mouseEnter(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull(); // not yet — delayed

    advance(300);
    expect(screen.getByRole("tooltip")).toHaveTextContent("origin/feature/x");

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not show if the hover ends before the delay elapses", () => {
    render(
      <Tooltip label="main" delay={300}>
        <span>pill</span>
      </Tooltip>,
    );
    const wrapper = screen.getByText("pill").parentElement!;

    fireEvent.mouseEnter(wrapper);
    advance(150);
    fireEvent.mouseLeave(wrapper);
    advance(300);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  const rectAt = (top: number, bottom: number): DOMRect =>
    ({ top, bottom, left: 100, right: 120, width: 20, height: bottom - top, x: 100, y: top, toJSON: () => ({}) });

  it("opens above the trigger when there is room", () => {
    render(
      <Tooltip label="main" delay={100}>
        <span>pill</span>
      </Tooltip>,
    );
    const wrapper = screen.getByText("pill").parentElement!;
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(rectAt(500, 522));

    fireEvent.mouseEnter(wrapper);
    advance(100);

    const tip = screen.getByRole("tooltip");
    expect(tip.style.transform).toContain("-100%"); // positioned above
  });

  it("flips below the trigger when it sits too close to the viewport top", () => {
    render(
      <Tooltip label="main" delay={100}>
        <span>pill</span>
      </Tooltip>,
    );
    const wrapper = screen.getByText("pill").parentElement!;
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(rectAt(8, 30));

    fireEvent.mouseEnter(wrapper);
    advance(100);

    const tip = screen.getByRole("tooltip");
    expect(tip.style.transform).toBe("translate(-50%, 6px)"); // flipped below
    expect(tip.style.top).toBe("30px"); // anchored to the trigger's bottom
  });

  it("hides on pointer down (e.g. when a drag starts)", () => {
    render(
      <Tooltip label="main" delay={100}>
        <span>pill</span>
      </Tooltip>,
    );
    const wrapper = screen.getByText("pill").parentElement!;

    fireEvent.mouseEnter(wrapper);
    advance(100);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.pointerDown(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
