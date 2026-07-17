import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { TagDeleteDialog } from "./TagDeleteDialog";

describe("TagDeleteDialog", () => {
  it("names the tag being deleted", () => {
    render(<TagDeleteDialog name="v1.0.0" onRemote={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  it("offers a remote-delete checkbox (pre-checked) only when the tag exists on the remote", () => {
    const { rerender } = render(
      <TagDeleteDialog name="v1.0.0" onRemote={true} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByLabelText(/also delete from the remote/i)).toBeChecked();

    rerender(<TagDeleteDialog name="v1.0.0" onRemote={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText(/also delete from the remote/i)).toBeNull();
  });

  it("calls onConfirm with the remote-delete flag from the checkbox", () => {
    const onConfirm = vi.fn();
    render(<TagDeleteDialog name="v1.0.0" onRemote={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/also delete from the remote/i)); // uncheck
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<TagDeleteDialog name="v1.0.0" onRemote={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(<TagDeleteDialog name="v1.0.0" onRemote={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape closes TagDeleteDialog without clicking into it first", async () => {
    const onCancel = vi.fn();
    render(<TagDeleteDialog name="v1.0.0" onRemote={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.keyboard("{Escape}"); // no prior click/focus into the dialog
    expect(onCancel).toHaveBeenCalled();
  });
});
