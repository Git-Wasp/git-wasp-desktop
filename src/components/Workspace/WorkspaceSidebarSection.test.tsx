import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { WorkspaceSidebarSection } from "./WorkspaceSidebarSection";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";

const workspaceA = { id: "ws-1", name: "Workspace A", repoPaths: ["/repos/a", "/repos/b"] };

const statusA = {
  path: "/repos/a",
  name: "repo-a",
  headBranch: "main",
  ahead: 2,
  behind: 1,
  uncommittedCount: 3,
  error: null,
};

const statusB = {
  path: "/repos/b",
  name: "repo-b",
  headBranch: "feature",
  ahead: 0,
  behind: 0,
  uncommittedCount: 0,
  error: null,
};

function setWorkspaceState(overrides: Partial<ReturnType<typeof useWorkspaceStore.getState>> = {}) {
  useWorkspaceStore.setState({
    workspaces: [workspaceA],
    activeWorkspace: workspaceA,
    repoStatuses: [statusA, statusB],
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
  setWorkspaceState();
  useRepoStore.setState({
    currentRepo: { name: "repo-c", path: "/repos/c", headBranch: "main" },
    recentRepos: [],
    branches: [],
    openRepo: vi.fn().mockResolvedValue(undefined),
    loadBranches: vi.fn().mockResolvedValue(undefined),
  });
  useGraphStore.setState({
    fetchViewport: vi.fn().mockResolvedValue(undefined),
  });
});

describe("WorkspaceSidebarSection", () => {
  it("renders nothing when there is no active workspace", () => {
    setWorkspaceState({ activeWorkspace: null, repoStatuses: [] });

    const { container } = render(<WorkspaceSidebarSection />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders a row per repo with its name and head branch", () => {
    render(<WorkspaceSidebarSection />);

    expect(screen.getByText("repo-a")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("repo-b")).toBeInTheDocument();
    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("shows ahead/behind arrows only when nonzero", () => {
    render(<WorkspaceSidebarSection />);

    const aheadBehind = screen.getByTitle(/ahead.*behind/i);
    expect(aheadBehind).toHaveTextContent("↑2");
    expect(aheadBehind).toHaveTextContent("↓1");
    expect(screen.queryAllByTitle(/ahead.*behind/i)).toHaveLength(1);
  });

  it("shows an uncommitted-count badge when greater than zero", () => {
    render(<WorkspaceSidebarSection />);

    expect(screen.getByTitle(/uncommitted/i)).toHaveTextContent("3");
  });

  it("shows an error indicator without breaking other rows", () => {
    setWorkspaceState({
      repoStatuses: [{ ...statusA, error: "repository not found" }, statusB],
    });

    render(<WorkspaceSidebarSection />);

    expect(screen.getByTitle(/repository not found/i)).toBeInTheDocument();
    expect(screen.getByText("repo-b")).toBeInTheDocument();
  });

  it("clicking a row opens that repo and refreshes the graph and branches", async () => {
    render(<WorkspaceSidebarSection />);

    fireEvent.click(screen.getByText("repo-a"));

    await vi.waitFor(() => {
      expect(useRepoStore.getState().openRepo).toHaveBeenCalledWith("/repos/a");
      expect(useGraphStore.getState().fetchViewport).toHaveBeenCalledWith(0, 150);
      expect(useRepoStore.getState().loadBranches).toHaveBeenCalled();
    });
  });

  it("shows an Add current repo button when the current repo isn't already in the workspace", () => {
    render(<WorkspaceSidebarSection />);

    fireEvent.click(screen.getByRole("button", { name: /add current repo/i }));

    expect(useWorkspaceStore.getState().addRepoToWorkspace).toHaveBeenCalledWith("ws-1", "/repos/c");
  });

  it("does not show the Add current repo button when it's already in the workspace", () => {
    useRepoStore.setState({ currentRepo: { name: "repo-a", path: "/repos/a", headBranch: "main" } });

    render(<WorkspaceSidebarSection />);

    expect(screen.queryByRole("button", { name: /add current repo/i })).not.toBeInTheDocument();
  });

  it("removing a repo from the workspace via RowMenu", () => {
    render(<WorkspaceSidebarSection />);

    fireEvent.click(screen.getByRole("button", { name: /repo-a actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /remove/i }));

    expect(useWorkspaceStore.getState().removeRepoFromWorkspace).toHaveBeenCalledWith("ws-1", "/repos/a");
  });

  it("loads workspace status on mount when there is an active workspace", () => {
    render(<WorkspaceSidebarSection />);

    expect(useWorkspaceStore.getState().loadStatus).toHaveBeenCalledWith("ws-1");
  });
});
