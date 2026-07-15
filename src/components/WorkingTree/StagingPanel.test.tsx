import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { StagingPanel } from "./StagingPanel";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useStashStore } from "../../stores/stashStore";
import { useToastStore } from "../../stores/toastStore";
import type { WorkingTreeStatus } from "../../types/workingTree";

const status: WorkingTreeStatus = {
  staged: [{ path: "staged.ts", originalPath: null, status: "Modified" }],
  unstaged: [{ path: "changed.ts", originalPath: null, status: "Modified" }],
  untracked: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkingTreeStore.setState({
    status,
    selectedPath: null,
    stageDiff: null,
    loadStatus: vi.fn().mockResolvedValue(undefined),
    startWatching: vi.fn().mockResolvedValue(() => {}),
    selectFile: vi.fn().mockResolvedValue(undefined),
    stageFile: vi.fn().mockResolvedValue(undefined),
    unstageFile: vi.fn().mockResolvedValue(undefined),
    discardFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  });
});

function menu() {
  return screen.getByRole("menu");
}

describe("StagingPanel row menu", () => {
  it("offers Stage, Discard and Delete on an unstaged file", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    const m = within(menu());
    expect(m.getByText("Stage")).toBeInTheDocument();
    expect(m.getByText("Discard")).toBeInTheDocument();
    expect(m.getByText("Delete file")).toBeInTheDocument();
    expect(m.queryByText("Unstage")).not.toBeInTheDocument();
  });

  it("offers Unstage and Delete (not Stage/Discard) on a staged file", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("staged.ts"));
    const m = within(menu());
    expect(m.getByText("Unstage")).toBeInTheDocument();
    expect(m.getByText("Delete file")).toBeInTheDocument();
    expect(m.queryByText("Stage")).not.toBeInTheDocument();
    expect(m.queryByText("Discard")).not.toBeInTheDocument();
  });

  it("requires confirmation before discarding a file's changes", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Discard"));

    // The discard does not fire until the modal is confirmed.
    expect(useWorkingTreeStore.getState().discardFile).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Discard changes" });
    expect(within(dialog).getByText(/changed\.ts/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Discard"));
    expect(useWorkingTreeStore.getState().discardFile).toHaveBeenCalledWith("changed.ts");
  });

  it("does not discard when the confirmation is cancelled", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Discard"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(useWorkingTreeStore.getState().discardFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires confirmation before deleting a file", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Delete file"));

    // The delete does not fire until the modal is confirmed.
    expect(useWorkingTreeStore.getState().deleteFile).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete file" });
    expect(within(dialog).getByText(/changed\.ts/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Delete"));
    expect(useWorkingTreeStore.getState().deleteFile).toHaveBeenCalledWith("changed.ts");
  });

  it("does not delete when the confirmation is cancelled", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Delete file"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(useWorkingTreeStore.getState().deleteFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("StagingPanel stash changes", () => {
  it("stashes all changes and toasts on success", async () => {
    const stashCreate = vi.fn().mockResolvedValue(undefined);
    const success = vi.fn();
    useStashStore.setState({ create: stashCreate });
    useToastStore.setState({ success });

    render(<StagingPanel />);
    // The button sits before "Stage all" in the Changes header.
    fireEvent.click(screen.getByText("Stash changes"));

    expect(stashCreate).toHaveBeenCalledWith();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith("Stashed changes"));
  });

  it("surfaces a stash failure as an error toast", async () => {
    useStashStore.setState({ create: vi.fn().mockRejectedValue("nothing to stash") });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<StagingPanel />);
    fireEvent.click(screen.getByText("Stash changes"));

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });

  it("hides the stash button when only untracked files are present (nothing git will stash)", () => {
    useWorkingTreeStore.setState({
      status: {
        staged: [],
        unstaged: [],
        untracked: [{ path: "new.ts", originalPath: null, status: "Added" }],
      },
    });
    render(<StagingPanel />);
    expect(screen.queryByText("Stash changes")).not.toBeInTheDocument();
    // Stage all still shows for the untracked file.
    expect(screen.getByText("Stage all")).toBeInTheDocument();
  });
});
