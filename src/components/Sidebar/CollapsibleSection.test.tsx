import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CollapsibleSection } from "./CollapsibleSection";

beforeEach(() => {
  localStorage.clear();
});

describe("CollapsibleSection", () => {
  it("renders the title and body expanded by default", () => {
    render(
      <CollapsibleSection id="branches" title="Branches">
        <div>body content</div>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Branches")).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();
  });

  it("hides the body when the header is clicked", () => {
    render(
      <CollapsibleSection id="branches" title="Branches">
        <div>body content</div>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Branches" }));
    expect(screen.queryByText("body content")).toBeNull();
  });

  it("persists the collapsed state under the section id", () => {
    const { unmount } = render(
      <CollapsibleSection id="recent" title="Recent">
        <div>body content</div>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    expect(localStorage.getItem("section-collapsed:recent")).toBe("true");

    unmount();
    render(
      <CollapsibleSection id="recent" title="Recent">
        <div>body content</div>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("body content")).toBeNull(); // restored collapsed
  });

  it("renders an action that does not toggle the section", () => {
    const onAction = vi.fn();
    render(
      <CollapsibleSection
        id="branches"
        title="Branches"
        action={<button onClick={onAction}>+ New</button>}
      >
        <div>body content</div>
      </CollapsibleSection>,
    );

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    expect(onAction).toHaveBeenCalled();
    expect(screen.getByText("body content")).toBeInTheDocument(); // still expanded
  });
});
