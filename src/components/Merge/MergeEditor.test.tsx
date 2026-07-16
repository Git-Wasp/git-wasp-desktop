import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import "@testing-library/jest-dom";
import { MergeEditor } from "./MergeEditor";
import { useMergeStore } from "../../stores/mergeStore";
import type { ConflictedFile, OperationStatus } from "../../types/merge";

const mockInvoke = vi.mocked(invoke);

const textConflict: ConflictedFile = {
  path: "src/lib.rs",
  kind: "normalEdit",
  oursContent: "current\n",
  theirsContent: "source\n",
  baseContent: "base\n",
  seededResult: "<<<<<<< HEAD\ncurrent\n=======\nsource\n>>>>>>> feature\n",
  conflictBlocks: [{ startLine: 1, midLine: 2, endLine: 3, oursText: "current\n", theirsText: "source\n" }],
};

const binaryConflict: ConflictedFile = {
  path: "assets/logo.png",
  kind: "binaryOrUnmergeable",
  oursContent: null,
  theirsContent: null,
  baseContent: null,
  seededResult: null,
  conflictBlocks: [],
};

const mergeStatus: OperationStatus = {
  kind: "merge",
  sourceBranch: "feature",
  conflicts: [textConflict, binaryConflict],
};

// Two normal-edit (text) conflicts, used for the unsaved-edits / dirty-tracking
// tests below, which need a second *text* conflict to switch to (unlike
// `binaryConflict`, which never has an editable result pane).
const conflictA: ConflictedFile = { ...textConflict, path: "a.txt" };
const conflictB: ConflictedFile = {
  path: "b.txt",
  kind: "normalEdit",
  oursContent: "current b\n",
  theirsContent: "source b\n",
  baseContent: "base b\n",
  seededResult: "<<<<<<< HEAD\ncurrent b\n=======\nsource b\n>>>>>>> feature\n",
  conflictBlocks: [{ startLine: 1, midLine: 2, endLine: 3, oursText: "current b\n", theirsText: "source b\n" }],
};

const twoFileMergeStatus: OperationStatus = {
  kind: "merge",
  sourceBranch: "feature",
  conflicts: [conflictA, conflictB],
};

// Produces a *real* unsaved edit: clicks "Accept current", which dispatches an
// actual change into the result pane's live CodeMirror `EditorView` (the same
// code path a real keystroke drives), rather than faking a dirty flag.
async function makeSelectedFileDirty() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Accept current" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Accept current" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useMergeStore.setState({ status: { kind: "none" }, isLoading: false, lastError: null });
});

describe("MergeEditor", () => {
  it("renders nothing when there is no merge in progress", () => {
    const { container } = render(<MergeEditor />);

    expect(container).toBeEmptyDOMElement();
  });

  it("lists conflicted files and shows the three-pane editor for a text conflict", () => {
    useMergeStore.setState({ status: mergeStatus });

    render(<MergeEditor />);

    expect(screen.getByRole("button", { name: "src/lib.rs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "assets/logo.png" })).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("shows the binary picker when a non-text conflict is selected", () => {
    useMergeStore.setState({ status: mergeStatus });

    render(<MergeEditor />);
    fireEvent.click(screen.getByRole("button", { name: "assets/logo.png" }));

    expect(screen.getByRole("button", { name: "Keep current version" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep source version" })).toBeInTheDocument();
  });

  it("disables Complete merge while conflicts remain", () => {
    useMergeStore.setState({ status: mergeStatus });

    render(<MergeEditor />);

    expect(screen.getByRole("button", { name: /complete merge/i })).toBeDisabled();
  });

  it("enables Complete merge once every conflict is resolved and a message is entered", async () => {
    useMergeStore.setState({ status: { kind: "merge", sourceBranch: "feature", conflicts: [] } });
    mockInvoke.mockResolvedValueOnce("abc123"); // merge_complete
    mockInvoke.mockResolvedValueOnce({ kind: "none" }); // operation_status

    render(<MergeEditor />);

    const completeButton = screen.getByRole("button", { name: /complete merge/i });
    expect(completeButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/commit message/i), {
      target: { value: "Merge branch 'feature'" },
    });
    expect(completeButton).not.toBeDisabled();

    fireEvent.click(completeButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("merge_complete", { message: "Merge branch 'feature'" });
    });
  });

  it("aborts the merge when Abort merge is clicked", async () => {
    useMergeStore.setState({ status: mergeStatus });
    mockInvoke.mockResolvedValueOnce(undefined); // merge_abort
    mockInvoke.mockResolvedValueOnce({ kind: "none" }); // operation_status

    render(<MergeEditor />);
    fireEvent.click(screen.getByRole("button", { name: /abort merge/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("merge_abort");
    });
  });

  it("resolves a binary conflict via the picker", async () => {
    useMergeStore.setState({ status: mergeStatus });
    mockInvoke.mockResolvedValueOnce([textConflict]); // merge_resolve_with_side
    mockInvoke.mockResolvedValueOnce({ kind: "merge", sourceBranch: "feature", conflicts: [textConflict] }); // operation_status

    render(<MergeEditor />);
    fireEvent.click(screen.getByRole("button", { name: "assets/logo.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep source version" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("merge_resolve_with_side", { path: "assets/logo.png", side: "theirs" });
    });
  });

  it("Abort asks for confirmation when at least one conflict has unsaved edits", async () => {
    useMergeStore.setState({ status: twoFileMergeStatus });

    render(<MergeEditor />);
    await makeSelectedFileDirty();

    fireEvent.click(screen.getByRole("button", { name: /abort merge/i }));

    expect(screen.getByRole("dialog", { name: /abort/i })).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("merge_abort");
  });

  it("confirming the abort dialog discards the unsaved edits and aborts the merge", async () => {
    useMergeStore.setState({ status: twoFileMergeStatus });
    mockInvoke.mockResolvedValueOnce(undefined); // merge_abort
    mockInvoke.mockResolvedValueOnce({ kind: "none" }); // operation_status

    render(<MergeEditor />);
    await makeSelectedFileDirty();
    fireEvent.click(screen.getByRole("button", { name: /abort merge/i }));

    const dialog = screen.getByRole("dialog", { name: /abort/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Abort merge" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("merge_abort");
    });
    expect(screen.queryByRole("dialog", { name: /abort/i })).not.toBeInTheDocument();
  });

  it("cancelling the abort dialog leaves the merge in progress", async () => {
    useMergeStore.setState({ status: twoFileMergeStatus });

    render(<MergeEditor />);
    await makeSelectedFileDirty();
    fireEvent.click(screen.getByRole("button", { name: /abort merge/i }));

    const dialog = screen.getByRole("dialog", { name: /abort/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: /abort/i })).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("merge_abort");
  });

  it("switching files with unsaved edits prompts before discarding them", async () => {
    useMergeStore.setState({ status: twoFileMergeStatus });

    render(<MergeEditor />);
    await makeSelectedFileDirty(); // a.txt (selected by default) now has an unsaved edit

    fireEvent.click(screen.getByText("b.txt"));

    expect(screen.getByRole("dialog", { name: /unsaved/i })).toBeInTheDocument();
  });

  it("confirming the unsaved-edits dialog switches files and clears the previous file's dirty flag", async () => {
    useMergeStore.setState({ status: twoFileMergeStatus });

    render(<MergeEditor />);
    await makeSelectedFileDirty();
    fireEvent.click(screen.getByText("b.txt"));

    const dialog = screen.getByRole("dialog", { name: /unsaved/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard and switch" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /unsaved/i })).not.toBeInTheDocument();
    });

    // a.txt's edit was discarded, so switching back to it is no longer "dirty".
    fireEvent.click(screen.getByText("a.txt"));
    expect(screen.queryByRole("dialog", { name: /unsaved/i })).not.toBeInTheDocument();
  });

  it("cancelling the unsaved-edits dialog stays on the current file", async () => {
    useMergeStore.setState({ status: twoFileMergeStatus });

    render(<MergeEditor />);
    await makeSelectedFileDirty();
    fireEvent.click(screen.getByText("b.txt"));

    const dialog = screen.getByRole("dialog", { name: /unsaved/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: /unsaved/i })).not.toBeInTheDocument();
    // Still on a.txt: its still-dirty result pane should still show the
    // resolved-via-Accept-current text rather than b.txt's seeded markers.
    expect(screen.getByTestId("result-pane")).not.toHaveTextContent("current b");
  });

  it("switching to a file with no unsaved edits does not prompt", async () => {
    useMergeStore.setState({ status: twoFileMergeStatus });

    render(<MergeEditor />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept current" })).toBeInTheDocument());

    fireEvent.click(screen.getByText("b.txt"));

    expect(screen.queryByRole("dialog", { name: /unsaved/i })).not.toBeInTheDocument();
  });

  it("marking a file resolved clears its dirty flag so aborting afterwards needs no confirmation", async () => {
    useMergeStore.setState({ status: { kind: "merge", sourceBranch: "feature", conflicts: [conflictA] } });
    mockInvoke.mockResolvedValueOnce([]); // merge_resolve
    mockInvoke.mockResolvedValueOnce({ kind: "merge", sourceBranch: "feature", conflicts: [] }); // operation_status
    mockInvoke.mockResolvedValueOnce(undefined); // merge_abort
    mockInvoke.mockResolvedValueOnce({ kind: "none" }); // operation_status

    render(<MergeEditor />);
    await makeSelectedFileDirty();
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "a.txt" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /abort merge/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("merge_abort");
    });
    expect(screen.queryByRole("dialog", { name: /abort/i })).not.toBeInTheDocument();
  });
});
