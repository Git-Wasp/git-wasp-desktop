import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
