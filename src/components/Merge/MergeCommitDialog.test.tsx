import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import "@testing-library/jest-dom";
import { MergeCommitDialog } from "./MergeCommitDialog";
import { useMergeStore } from "../../stores/mergeStore";
import { useRepoStore } from "../../stores/repoStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  // After completing/aborting, the store reloads operation_status — return a
  // valid "none" status so the dialog unmounts cleanly instead of crashing on
  // an undefined status.
  mockInvoke.mockImplementation(async (cmd: string) =>
    cmd === "operation_status" ? { kind: "none" } : undefined,
  );
  useMergeStore.setState({ status: { kind: "none" }, isLoading: false, lastError: null });
  useRepoStore.setState({
    currentRepo: { name: "repo", path: "/repo", headBranch: "main" },
  });
});

function startCleanMerge(sourceBranch: string | null = "feat/x") {
  useMergeStore.setState({ status: { kind: "merge", sourceBranch, conflicts: [] } });
}

describe("MergeCommitDialog", () => {
  it("renders nothing when there is no merge in progress", () => {
    const { container } = render(<MergeCommitDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("prefills a default merge commit message from the source and current branch", () => {
    startCleanMerge("feat/x");
    render(<MergeCommitDialog />);
    expect(screen.getByLabelText("Merge commit message")).toHaveValue("Merge branch 'feat/x' into main");
  });

  it("completes the merge with the edited message", async () => {
    startCleanMerge("feat/x");
    render(<MergeCommitDialog />);

    fireEvent.change(screen.getByLabelText("Merge commit message"), {
      target: { value: "Merge feature work" },
    });
    fireEvent.click(screen.getByRole("button", { name: /complete merge/i }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("merge_complete", { message: "Merge feature work" }),
    );
  });

  it("aborts the merge", async () => {
    startCleanMerge("feat/x");
    render(<MergeCommitDialog />);

    fireEvent.click(screen.getByRole("button", { name: /abort merge/i }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("merge_abort"));
  });

  it("disables Complete merge when the message is empty", () => {
    startCleanMerge("feat/x");
    render(<MergeCommitDialog />);

    fireEvent.change(screen.getByLabelText("Merge commit message"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: /complete merge/i })).toBeDisabled();
  });
});
