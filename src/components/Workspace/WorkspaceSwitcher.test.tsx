import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { useWorkspaceStore } from "../../stores/workspaceStore";

const workspaceA = { id: "ws-1", name: "Workspace A", repoPaths: [] };
const workspaceB = { id: "ws-2", name: "Workspace B", repoPaths: [] };

function setStoreState(overrides: Partial<ReturnType<typeof useWorkspaceStore.getState>> = {}) {
  useWorkspaceStore.setState({
    workspaces: [workspaceA, workspaceB],
    activeWorkspace: workspaceA,
    repoStatuses: [],
    searchResults: [],
    operationResults: [],
    isLoadingStatus: false,
    isSearching: false,
    isFetchingAll: false,
    isPullingAll: false,
    lastError: null,
    loadWorkspaces: vi.fn().mockResolvedValue(undefined),
    loadActiveWorkspace: vi.fn().mockResolvedValue(undefined),
    createWorkspace: vi.fn().mockResolvedValue(workspaceA),
    renameWorkspace: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
    addRepoToWorkspace: vi.fn().mockResolvedValue(undefined),
    removeRepoFromWorkspace: vi.fn().mockResolvedValue(undefined),
    setActiveWorkspace: vi.fn().mockResolvedValue(undefined),
    loadStatus: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(undefined),
    fetchAll: vi.fn().mockResolvedValue(undefined),
    pullAll: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setStoreState();
});

describe("WorkspaceSwitcher", () => {
  it("renders all workspaces with the active one indicated", () => {
    render(<WorkspaceSwitcher />);

    expect(screen.getByRole("button", { name: /Workspace A/, current: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace B/ })).toBeInTheDocument();
  });

  it("selecting a different workspace calls setActiveWorkspace", () => {
    render(<WorkspaceSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: /Workspace B/ }));

    expect(useWorkspaceStore.getState().setActiveWorkspace).toHaveBeenCalledWith("ws-2");
  });

  it("creating a new workspace via the inline input", () => {
    render(<WorkspaceSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    const input = screen.getByPlaceholderText(/workspace name/i);
    fireEvent.change(input, { target: { value: "My New Workspace" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useWorkspaceStore.getState().createWorkspace).toHaveBeenCalledWith("My New Workspace");
  });

  it("renaming the active workspace via RowMenu", () => {
    render(<WorkspaceSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: /workspace a actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /rename/i }));
    const input = screen.getByDisplayValue("Workspace A");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useWorkspaceStore.getState().renameWorkspace).toHaveBeenCalledWith("ws-1", "Renamed");
  });

  it("deleting the active workspace via RowMenu", () => {
    render(<WorkspaceSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: /workspace a actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    expect(useWorkspaceStore.getState().deleteWorkspace).toHaveBeenCalledWith("ws-1");
  });

  it("renders an empty state when there are no workspaces", () => {
    setStoreState({ workspaces: [], activeWorkspace: null });

    render(<WorkspaceSwitcher />);

    expect(screen.getByText(/no workspaces/i)).toBeInTheDocument();
  });
});
