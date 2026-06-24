import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { FileStatusIcon } from "./FileStatusIcon";

describe("FileStatusIcon", () => {
  it("uses a green plus for added/new files", () => {
    const { container } = render(<FileStatusIcon status="Added" />);
    const wrap = container.querySelector('[data-status="Added"]');
    expect(wrap).toHaveStyle({ color: "var(--color-success)" });
    expect(wrap!.querySelector('[data-icon="plus"]')).not.toBeNull();
    // Untracked (new but unstaged) reads the same.
    const { container: c2 } = render(<FileStatusIcon status="Untracked" />);
    expect(c2.querySelector('[data-icon="plus"]')).not.toBeNull();
  });

  it("uses an amber pencil for modified files", () => {
    const { container } = render(<FileStatusIcon status="Modified" />);
    expect(container.querySelector('[data-status="Modified"]')).toHaveStyle({
      color: "var(--color-warning)",
    });
    expect(container.querySelector('[data-icon="pencil"]')).not.toBeNull();
  });

  it("uses a red minus for deleted files", () => {
    const { container } = render(<FileStatusIcon status="Deleted" />);
    expect(container.querySelector('[data-status="Deleted"]')).toHaveStyle({
      color: "var(--color-danger)",
    });
    expect(container.querySelector('[data-icon="minus"]')).not.toBeNull();
  });

  it("exposes an accessible label and falls back to Modified for unknown statuses", () => {
    expect(screen.queryByLabelText).toBeDefined();
    render(<FileStatusIcon status="Added" />);
    expect(screen.getByLabelText("Added")).toBeInTheDocument();

    const { container } = render(<FileStatusIcon status="weird" />);
    expect(container.querySelector('[data-icon="pencil"]')).not.toBeNull();
  });
});
