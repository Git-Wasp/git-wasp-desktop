import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { SquashDialog } from "./SquashDialog";

describe("SquashDialog", () => {
  it("pre-fills the message and confirms with the edited value", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <SquashDialog count={3} initialMessage="first\n\nsecond" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );

    expect(screen.getByText("Squash 3 commits")).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: "Squash commit message" });
    fireEvent.change(textarea, { target: { value: "one commit" } });
    fireEvent.click(screen.getByRole("button", { name: /^squash$/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("one commit"));
  });

  it("confirms on Cmd/Ctrl+Enter", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<SquashDialog count={2} initialMessage="msg" onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Squash commit message" }), {
      key: "Enter",
      metaKey: true,
    });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("msg"));
  });

  it("keeps the dialog open and shows the error when the squash fails", async () => {
    const onConfirm = vi.fn().mockRejectedValue("cannot squash pushed commits");
    const onCancel = vi.fn();
    render(<SquashDialog count={2} initialMessage="msg" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /^squash$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("cannot squash pushed commits");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(<SquashDialog count={2} initialMessage="msg" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
