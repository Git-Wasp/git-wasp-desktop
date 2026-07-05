import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { StagingPanel } from "./StagingPanel";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
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

  it("routes Discard straight through without a confirmation", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Discard"));
    expect(useWorkingTreeStore.getState().discardFile).toHaveBeenCalledWith("changed.ts");
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
