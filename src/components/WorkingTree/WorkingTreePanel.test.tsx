import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { WorkingTreePanel } from "./WorkingTreePanel";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useGraphStore } from "../../stores/graphStore";
import type { WorkingTreeStatus } from "../../types/workingTree";

let stageFile: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
let unstageFile: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
let selectFile: ReturnType<typeof vi.fn<(path: string, kind: "staged" | "unstaged") => Promise<void>>>;

const status: WorkingTreeStatus = {
  staged: [{ path: "staged.ts", originalPath: null, status: "Modified" }],
  unstaged: [{ path: "changed.ts", originalPath: null, status: "Modified" }],
  untracked: [{ path: "new.ts", originalPath: null, status: "Added" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  stageFile = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
  unstageFile = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
  selectFile = vi
    .fn<(path: string, kind: "staged" | "unstaged") => Promise<void>>()
    .mockResolvedValue(undefined);
  useWorkingTreeStore.setState({
    status,
    selectedPath: null,
    selectedDiff: null,
    loadStatus: vi.fn().mockResolvedValue(undefined),
    startWatching: vi.fn().mockResolvedValue(() => {}),
    selectFile,
    stageFile,
    unstageFile,
    discardFile: vi.fn(),
    discardAll: vi.fn(),
    createCommit: vi.fn(),
    loadIdentity: vi.fn(),
    identity: { name: "A", email: "a@a" },
  });
  useGraphStore.setState({ fetchViewport: vi.fn().mockResolvedValue(undefined) });
});

describe("WorkingTreePanel", () => {
  it("shows a Changes panel (top) and a Staged panel", () => {
    render(<WorkingTreePanel />);
    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(screen.getByText("Staged")).toBeInTheDocument();
  });

  it("lists unstaged and untracked files under Changes, staged under Staged", () => {
    render(<WorkingTreePanel />);
    expect(screen.getByText("changed.ts")).toBeInTheDocument();
    expect(screen.getByText("new.ts")).toBeInTheDocument();
    expect(screen.getByText("staged.ts")).toBeInTheDocument();
  });

  it("stages a changed file via its Stage action", () => {
    render(<WorkingTreePanel />);
    const row = screen.getByText("changed.ts").closest("[data-file-row]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Stage" }));
    expect(stageFile).toHaveBeenCalledWith("changed.ts");
  });

  it("unstages a staged file via its Unstage action", () => {
    render(<WorkingTreePanel />);
    const row = screen.getByText("staged.ts").closest("[data-file-row]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Unstage" }));
    expect(unstageFile).toHaveBeenCalledWith("staged.ts");
  });

  it("selects a file when its row is clicked", () => {
    render(<WorkingTreePanel />);
    fireEvent.click(screen.getByText("changed.ts"));
    expect(selectFile).toHaveBeenCalledWith("changed.ts", "unstaged");
  });

  it("shows an empty state in the diff area until a file is chosen", () => {
    render(<WorkingTreePanel />);
    expect(screen.getByText("Select a file to view its diff")).toBeInTheDocument();
  });
});
