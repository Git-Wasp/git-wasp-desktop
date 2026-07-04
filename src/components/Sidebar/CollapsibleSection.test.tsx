import { act, fireEvent, render, screen } from "@testing-library/react";
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

  it("shows no resize divider by default", () => {
    render(
      <CollapsibleSection id="branches" title="Branches">
        <div>body content</div>
      </CollapsibleSection>,
    );
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("caps a resizable body at the default height and shows a drag divider", () => {
    render(
      <CollapsibleSection id="recent" title="Recent" resizable defaultHeight={160}>
        <div>body content</div>
      </CollapsibleSection>,
    );
    const body = screen.getByText("body content").parentElement!;
    expect(body.style.maxHeight).toBe("160px");
    expect(screen.getByRole("separator", { name: "Resize Recent section" })).toBeInTheDocument();
  });

  it("resizes and persists the section height when the divider is dragged", () => {
    const { unmount } = render(
      <CollapsibleSection id="recent" title="Recent" resizable defaultHeight={160}>
        <div>body content</div>
      </CollapsibleSection>,
    );
    const handle = screen.getByRole("separator", { name: "Resize Recent section" });
    // jsdom ignores clientY on synthetic PointerEvents; dispatch MouseEvents by
    // the pointer event-type name (matches ResizeHandle's own test approach). The
    // drag updates state from a raw window listener, so flush it inside act().
    act(() => {
      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }));
      window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 140 }));
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: 140 }));
    });

    expect(screen.getByText("body content").parentElement!.style.maxHeight).toBe("200px");
    expect(localStorage.getItem("section-height:recent")).toBe("200");

    // Restored from storage on remount.
    unmount();
    render(
      <CollapsibleSection id="recent" title="Recent" resizable defaultHeight={160}>
        <div>body content</div>
      </CollapsibleSection>,
    );
    expect(screen.getByText("body content").parentElement!.style.maxHeight).toBe("200px");
  });

  it("suppresses its own border while expanded as a section group, keeps it when collapsed", () => {
    const { container } = render(
      <CollapsibleSection id="branches" title="Branches" containsSections>
        <div>body content</div>
      </CollapsibleSection>,
    );
    const root = container.firstChild as HTMLElement;
    // Expanded: nested subsections provide the divider, so no doubled border.
    expect(root.style.borderBottom).toBe("");
    // Collapsed: the lone header needs a divider from the next section.
    fireEvent.click(screen.getByRole("button", { name: "Branches" }));
    expect(root.style.borderBottom).toContain("1px solid");
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
