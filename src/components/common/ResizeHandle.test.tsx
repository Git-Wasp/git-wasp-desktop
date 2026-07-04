import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ResizeHandle } from "./ResizeHandle";

// jsdom's PointerEvent ignores clientX; MouseEvent honors it and dispatch is
// by event-type name, so this drives both the React handler and window listeners.
function fire(target: EventTarget, type: string, clientX: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));
}
function fireY(target: EventTarget, type: string, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY }));
}

describe("ResizeHandle", () => {
  it("reports the horizontal delta while dragging", () => {
    const onResize = vi.fn();
    render(<ResizeHandle onResize={onResize} ariaLabel="Resize sidebar" />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    fire(handle, "pointerdown", 100);
    fire(window, "pointermove", 130);
    expect(onResize).toHaveBeenCalledWith(30);

    fire(window, "pointermove", 120);
    expect(onResize).toHaveBeenCalledWith(-10);

    fire(window, "pointerup", 120);
  });

  it("reports the vertical delta for a horizontal handle", () => {
    const onResize = vi.fn();
    render(<ResizeHandle orientation="horizontal" onResize={onResize} ariaLabel="Resize section" />);
    const handle = screen.getByRole("separator", { name: "Resize section" });
    expect(handle).toHaveAttribute("aria-orientation", "horizontal");

    fireY(handle, "pointerdown", 100);
    fireY(window, "pointermove", 140);
    expect(onResize).toHaveBeenCalledWith(40);

    fireY(window, "pointerup", 140);
  });

  it("does not report movement before a drag starts", () => {
    const onResize = vi.fn();
    render(<ResizeHandle onResize={onResize} ariaLabel="Resize" />);

    fire(window, "pointermove", 200);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("stops reporting after pointer up", () => {
    const onResize = vi.fn();
    render(<ResizeHandle onResize={onResize} ariaLabel="Resize" />);
    const handle = screen.getByRole("separator", { name: "Resize" });

    fire(handle, "pointerdown", 100);
    fire(window, "pointerup", 100);
    onResize.mockClear();

    fire(window, "pointermove", 300);
    expect(onResize).not.toHaveBeenCalled();
  });
});
