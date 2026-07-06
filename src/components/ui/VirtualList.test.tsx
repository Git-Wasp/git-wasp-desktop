import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { VirtualList } from "./VirtualList";

const items = (n: number) => Array.from({ length: n }, (_, i) => `item-${i}`);

function renderList(count: number, maxHeight: number, rowHeight = 20) {
  return render(
    <VirtualList
      ariaLabel="Test list"
      items={items(count)}
      rowHeight={rowHeight}
      maxHeight={maxHeight}
      render={(item) => <span>{item}</span>}
    />,
  );
}

describe("VirtualList", () => {
  it("sizes the list to the content when it fits under the cap", () => {
    // 3 rows × 20px = 60px, under the 200px cap → compact.
    renderList(3, 200);
    const list = screen.getByLabelText("Test list");
    expect(list).toHaveStyle({ height: "60px" });
  });

  it("caps the list height and scrolls when the content exceeds the cap", () => {
    // 1000 rows × 20px would be 20000px; capped at 100px.
    renderList(1000, 100);
    const list = screen.getByLabelText("Test list");
    expect(list).toHaveStyle({ height: "100px" });
  });

  it("renders visible rows via the render prop, not the whole list", () => {
    // A large list must only mount a small windowed slice, never 1000 nodes.
    renderList(1000, 100);
    expect(screen.getByText("item-0")).toBeInTheDocument();
    const rendered = screen.getAllByText(/^item-\d+$/);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(1000);
  });
});
