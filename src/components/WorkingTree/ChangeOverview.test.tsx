import { render } from "@testing-library/react";
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

  it("seeks to the clicked vertical fraction", () => {
    const onSeek = vi.fn();
    const { getByTestId } = render(<ChangeOverview rows={modifiedRows} onSeek={onSeek} />);
    const strip = getByTestId("change-overview");
    vi.spyOn(strip, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 100,
    } as DOMRect);
    strip.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 50 }));
    expect(onSeek).toHaveBeenCalledWith(0.5);
  });
});
