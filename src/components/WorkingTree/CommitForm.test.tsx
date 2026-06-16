import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CommitForm } from "./CommitForm";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useGraphStore } from "../../stores/graphStore";

let createCommit: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;
let discardAll: ReturnType<typeof vi.fn<() => Promise<void>>>;

beforeEach(() => {
  vi.clearAllMocks();
  createCommit = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
  discardAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  useWorkingTreeStore.setState({
    identity: { name: "A", email: "a@a" },
    loadIdentity: vi.fn(),
    createCommit,
    discardAll,
  });
  useGraphStore.setState({ fetchViewport: vi.fn().mockResolvedValue(undefined) });
});

describe("CommitForm", () => {
  it("disables Commit until there is a staged file and a subject", () => {
    const { rerender } = render(<CommitForm stagedCount={0} />);
    expect(screen.getByRole("button", { name: /^commit/i })).toBeDisabled();

    rerender(<CommitForm stagedCount={2} />);
    expect(screen.getByRole("button", { name: /^commit/i })).toBeDisabled(); // no subject yet

    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "My change" } });
    expect(screen.getByRole("button", { name: /^commit/i })).toBeEnabled();
  });

  it("composes subject and body into one message", async () => {
    render(<CommitForm stagedCount={1} />);
    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "Add feature" } });
    fireEvent.change(screen.getByPlaceholderText(/description/i), {
      target: { value: "Some **details**." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));

    await waitFor(() =>
      expect(createCommit).toHaveBeenCalledWith("Add feature\n\nSome **details**."),
    );
  });

  it("renders a markdown preview of the body", () => {
    render(<CommitForm stagedCount={1} />);
    fireEvent.change(screen.getByPlaceholderText(/description/i), {
      target: { value: "**bold**" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("Reset opens a confirm dialog and discards all on confirm", async () => {
    render(<CommitForm stagedCount={1} />);
    fireEvent.click(screen.getByRole("button", { name: /^reset/i }));

    // Dialog appears; confirm the destructive action.
    expect(screen.getByRole("dialog", { name: /discard all changes/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /discard everything/i }));

    await waitFor(() => expect(discardAll).toHaveBeenCalledTimes(1));
  });
});
