import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { Tooltip } from "./Tooltip";

// The tooltip appears via a setTimeout that updates state, so timer advances
// must run inside act() to flush the resulting React render.
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

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
