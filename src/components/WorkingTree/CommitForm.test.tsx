import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CommitForm } from "./CommitForm";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useGraphStore } from "../../stores/graphStore";

let createCommit: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;
let amendCommitMessage: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;
let discardAll: ReturnType<typeof vi.fn<() => Promise<void>>>;

beforeEach(() => {
  vi.clearAllMocks();
  createCommit = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
  amendCommitMessage = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
  discardAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  useWorkingTreeStore.setState({
    identity: { name: "A", email: "a@a" },
    headCommit: null,
    loadIdentity: vi.fn(),
    loadHeadCommit: vi.fn().mockResolvedValue(undefined),
    createCommit,
    amendCommitMessage,
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

  it("calls onCommitted after a successful commit", async () => {
    const onCommitted = vi.fn();
    render(<CommitForm stagedCount={1} onCommitted={onCommitted} />);
    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));

    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  });

  it("does not call onCommitted when the commit fails", async () => {
    createCommit.mockRejectedValueOnce(new Error("nope"));
    const onCommitted = vi.fn();
    render(<CommitForm stagedCount={1} onCommitted={onCommitted} />);
    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));

    await waitFor(() => expect(createCommit).toHaveBeenCalled());
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("hides the amend toggle when there is no HEAD commit", () => {
    useWorkingTreeStore.setState({ headCommit: null });
    render(<CommitForm stagedCount={0} />);
    expect(screen.queryByLabelText(/amend last commit/i)).not.toBeInTheDocument();
  });

  it("hides the amend toggle when the HEAD commit is already pushed", () => {
    useWorkingTreeStore.setState({
      headCommit: { oid: "abc", message: "pushed", pushed: true },
    });
    render(<CommitForm stagedCount={0} />);
    expect(screen.queryByLabelText(/amend last commit/i)).not.toBeInTheDocument();
  });

  it("prefills the form from the HEAD message and amends on submit", async () => {
    useWorkingTreeStore.setState({
      headCommit: { oid: "abc", message: "Old subject\n\nOld body", pushed: false },
    });
    render(<CommitForm stagedCount={0} />);

    // Entering amend mode prefills subject + body and allows commit with nothing staged.
    fireEvent.click(screen.getByLabelText(/amend last commit/i));
    expect((screen.getByPlaceholderText(/summary/i) as HTMLInputElement).value).toBe("Old subject");
    expect((screen.getByPlaceholderText(/description/i) as HTMLTextAreaElement).value).toBe("Old body");

    const amendButton = screen.getByRole("button", { name: /^amend/i });
    expect(amendButton).toBeEnabled();

    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "New subject" } });
    fireEvent.click(amendButton);

    await waitFor(() =>
      expect(amendCommitMessage).toHaveBeenCalledWith("New subject\n\nOld body"),
    );
    expect(createCommit).not.toHaveBeenCalled();
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
