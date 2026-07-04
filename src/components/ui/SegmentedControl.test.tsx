import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl", () => {
  const options = [
    { value: "write", label: "Write" },
    { value: "preview", label: "Preview" },
  ] as const;

  it("renders each option as a button and marks the active one pressed", () => {
    render(
      <SegmentedControl
        ariaLabel="Description mode"
        options={options}
        value="write"
        onChange={() => {}}
      />,
    );
    const group = screen.getByRole("group", { name: "Description mode" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "false");
  });

  it("fires onChange with the option's value when clicked", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Description mode"
        options={options}
        value="write"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onChange).toHaveBeenCalledWith("preview");
  });

  it("uses ariaLabel as the accessible name for icon-only segments", () => {
    render(
      <SegmentedControl
        ariaLabel="Diff view mode"
        iconOnly
        value="split"
        onChange={() => {}}
        options={[
          { value: "split", label: <svg data-testid="split-icon" />, ariaLabel: "Side-by-side view" },
          { value: "inline", label: <svg data-testid="inline-icon" />, ariaLabel: "Inline view" },
        ]}
      />,
    );
    const btn = screen.getByRole("button", { name: "Side-by-side view" });
    expect(btn).toHaveAttribute("title", "Side-by-side view");
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a hover background on an inactive segment and clears it on leave", () => {
    render(
      <SegmentedControl
        ariaLabel="Description mode"
        options={options}
        value="write"
        onChange={() => {}}
      />,
    );
    const preview = screen.getByRole("button", { name: "Preview" });
    fireEvent.mouseEnter(preview);
    expect(preview.style.background).toContain("--color-bg-hover");
    fireEvent.mouseLeave(preview);
    expect(preview.style.background).not.toContain("--color-bg-hover");
  });
});
