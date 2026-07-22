import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";

describe("CreateWorktreeDialog", () => {
  it("defaults to new branch from base mode", () => {
    render(
      <CreateWorktreeDialog
        defaultStartPoint="main"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("New branch from base")).toBeChecked();
    expect(screen.getByLabelText("Base branch or commit")).toHaveValue("main");
  });

  it("submits the new-branch payload when the form is complete", () => {
    const onConfirm = vi.fn();

    render(
      <CreateWorktreeDialog
        defaultStartPoint="main"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText("Branch name"), {
      target: { value: "feature/worktree" },
    });
    fireEvent.change(screen.getByLabelText("Target path"), {
      target: { value: "/repos/main-feature" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create worktree" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "newBranchFromBase",
      branchName: "feature/worktree",
      startPoint: "main",
      targetPath: "/repos/main-feature",
    });
  });
});
