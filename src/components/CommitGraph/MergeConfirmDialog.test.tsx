import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { MergeConfirmDialog } from "./MergeConfirmDialog";

describe("MergeConfirmDialog", () => {
  it("names the source and target branches", () => {
    render(
      <MergeConfirmDialog source="feat" target="main" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("feat")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("calls onConfirm when Merge is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <MergeConfirmDialog source="feat" target="main" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <MergeConfirmDialog source="feat" target="main" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(
      <MergeConfirmDialog source="feat" target="main" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape closes MergeConfirmDialog without clicking into it first", async () => {
    const onCancel = vi.fn();
    render(
      <MergeConfirmDialog source="feat" target="main" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    await userEvent.keyboard("{Escape}"); // no prior click/focus into the dialog
    expect(onCancel).toHaveBeenCalled();
  });

  it("offers a Start pull request action only when the handler is provided", () => {
    const onStartPullRequest = vi.fn();
    const { rerender } = render(
      <MergeConfirmDialog
        source="feat"
        target="main"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onStartPullRequest={onStartPullRequest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start pull request/i }));
    expect(onStartPullRequest).toHaveBeenCalledTimes(1);

    rerender(
      <MergeConfirmDialog source="feat" target="main" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /start pull request/i })).toBeNull();
  });
});
