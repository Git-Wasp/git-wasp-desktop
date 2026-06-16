import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { UncommittedPanel } from "./UncommittedPanel";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useGraphStore } from "../../stores/graphStore";
import type { WorkingTreeStatus } from "../../types/workingTree";

const status: WorkingTreeStatus = {
  staged: [{ path: "src/a.ts", originalPath: null, status: "Modified" }],
  unstaged: [{ path: "src/b.ts", originalPath: null, status: "Modified" }],
  untracked: [{ path: "src/c.ts", originalPath: null, status: "Added" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkingTreeStore.setState({
    status,
    selectedPath: null,
    selectedDiff: null,
    identity: { name: "A", email: "a@a" },
    loadStatus: vi.fn().mockResolvedValue(undefined),
    startWatching: vi.fn().mockResolvedValue(() => {}),
    selectFile: vi.fn().mockResolvedValue(undefined),
    stageFile: vi.fn().mockResolvedValue(undefined),
    unstageFile: vi.fn().mockResolvedValue(undefined),
    createCommit: vi.fn().mockResolvedValue(undefined),
    discardAll: vi.fn().mockResolvedValue(undefined),
    loadIdentity: vi.fn(),
  });
  useGraphStore.setState({ fetchViewport: vi.fn().mockResolvedValue(undefined) });
});

describe("UncommittedPanel", () => {
  it("shows a header with the file count and current branch", () => {
    render(<UncommittedPanel branch="main" />);
    expect(screen.getByText(/3 file changes on/i)).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("lists staged, unstaged, and untracked files", () => {
    render(<UncommittedPanel branch="main" />);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
    expect(screen.getByText("src/c.ts")).toBeInTheDocument();
  });

  it("selects a staged file with the staged kind", async () => {
    render(<UncommittedPanel branch="main" />);
    fireEvent.click(screen.getByText("src/a.ts"));
    await waitFor(() =>
      expect(useWorkingTreeStore.getState().selectFile).toHaveBeenCalledWith("src/a.ts", "staged"),
    );
  });

  it("selects an unstaged file with the unstaged kind", async () => {
    render(<UncommittedPanel branch="main" />);
    fireEvent.click(screen.getByText("src/b.ts"));
    await waitFor(() =>
      expect(useWorkingTreeStore.getState().selectFile).toHaveBeenCalledWith("src/b.ts", "unstaged"),
    );
  });

  it("loads status and starts watching on mount", () => {
    render(<UncommittedPanel branch="main" />);
    expect(useWorkingTreeStore.getState().loadStatus).toHaveBeenCalled();
    expect(useWorkingTreeStore.getState().startWatching).toHaveBeenCalled();
  });
});
