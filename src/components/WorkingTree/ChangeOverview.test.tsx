import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ChangeOverview } from "./ChangeOverview";
import { diffLines } from "../../lib/lineDiff";

// "b" -> "B" is a modification: a removed row (left) and an added row (right).
const modifiedRows = diffLines("a\nb\nc\n", "a\nB\nc\n");

describe("ChangeOverview", () => {
  it("renders two lanes in split view, routing removed to left and added to right", () => {
    const { container } = render(<ChangeOverview rows={modifiedRows} split />);
    const lanes = container.querySelectorAll("[data-lane]");
    expect(lanes.length).toBe(2);

    const left = container.querySelector('[data-lane="left"]')!;
    const right = container.querySelector('[data-lane="right"]')!;
    expect(left.querySelectorAll("[data-overview-mark]").length).toBe(1);
    expect(right.querySelectorAll("[data-overview-mark]").length).toBe(1);
    // A modification is amber on both sides.
    expect(left.querySelector("[data-overview-mark]")!.getAttribute("data-color")).toBe("mod");
    expect(right.querySelector("[data-overview-mark]")!.getAttribute("data-color")).toBe("mod");
  });

  it("renders a single combined lane when not split", () => {
    const { container } = render(<ChangeOverview rows={modifiedRows} />);
    expect(container.querySelectorAll("[data-lane]").length).toBe(1);
    expect(container.querySelectorAll("[data-overview-mark]").length).toBe(2);
  });

  it("shows a viewport thumb sized and positioned from the viewport prop", () => {
    const { getByTestId, rerender, queryByTestId } = render(
      <ChangeOverview rows={modifiedRows} viewport={{ top: 0.25, height: 0.5 }} onScrollTo={vi.fn()} />,
    );
    const thumb = getByTestId("overview-thumb");
    expect(thumb.style.top).toBe("25%");
    expect(thumb.style.height).toBe("50%");

    // No thumb when the whole file fits (nothing to scroll).
    rerender(<ChangeOverview rows={modifiedRows} viewport={{ top: 0, height: 1 }} onScrollTo={vi.fn()} />);
    expect(queryByTestId("overview-thumb")).toBeNull();
  });

  it("clicking the track scrolls so the thumb centres on the cursor", () => {
    const onScrollTo = vi.fn();
    const { getByTestId } = render(
      <ChangeOverview rows={modifiedRows} viewport={{ top: 0, height: 0.5 }} onScrollTo={onScrollTo} />,
    );
    const strip = getByTestId("change-overview");
    vi.spyOn(strip, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100 } as DOMRect);
    // Click at 60% (outside the [0,0.5] thumb): centre it there → top 0.6 - 0.25.
    fireEvent.mouseDown(strip, { clientY: 60 });
    expect(onScrollTo).toHaveBeenLastCalledWith(0.35);
  });

  it("dragging the thumb keeps the grip point under the cursor", () => {
    const onScrollTo = vi.fn();
    const { getByTestId } = render(
      <ChangeOverview rows={modifiedRows} viewport={{ top: 0, height: 0.5 }} onScrollTo={onScrollTo} />,
    );
    const strip = getByTestId("change-overview");
    vi.spyOn(strip, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100 } as DOMRect);
    // Grab the thumb near its top (10%), then drag down to 30%: thumb-top → 0.2.
    fireEvent.mouseDown(strip, { clientY: 10 });
    fireEvent.mouseMove(window, { clientY: 30 });
    expect(onScrollTo.mock.lastCall![0]).toBeCloseTo(0.2, 5);
  });
});
