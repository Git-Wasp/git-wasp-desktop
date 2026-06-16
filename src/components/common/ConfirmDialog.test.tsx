import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders the title and message", () => {
    render(
      <ConfirmDialog
        title="Discard all changes?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Discard all changes?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="Discard everything"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard everything" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="t" message="m" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="t" message="m" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
