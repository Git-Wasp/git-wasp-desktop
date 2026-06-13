import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { PromptDialog } from "./PromptDialog";

describe("PromptDialog", () => {
  it("renders the title and pre-fills the initial value", () => {
    render(
      <PromptDialog
        title="Rename branch"
        initialValue="old-name"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Rename branch")).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveValue("old-name");
  });

  it("confirms with the entered value", () => {
    const onConfirm = vi.fn();
    render(<PromptDialog title="New branch" onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "feature/x" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onConfirm).toHaveBeenCalledWith("feature/x");
  });

  it("confirms when Enter is pressed", () => {
    const onConfirm = vi.fn();
    render(<PromptDialog title="New branch" onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "feature/y" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onConfirm).toHaveBeenCalledWith("feature/y");
  });

  it("disables confirm when the trimmed value is empty", () => {
    render(<PromptDialog title="New branch" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const confirm = screen.getByRole("button", { name: /^create$/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect(confirm).toBeDisabled();
  });

  it("cancels on the Cancel button and on Escape", () => {
    const onCancel = vi.fn();
    render(<PromptDialog title="New branch" onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("uses a custom confirm label when provided", () => {
    render(
      <PromptDialog
        title="Rename branch"
        confirmLabel="Rename"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /^rename$/i })).toBeTruthy();
  });
});
