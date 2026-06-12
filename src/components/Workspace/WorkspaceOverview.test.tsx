import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { WorkspaceOverview } from "./WorkspaceOverview";
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
  error: "repository not found",
};

const branchResult = {
  repoPath: "/repos/a",
  repoName: "repo-a",
  kind: "Branch" as const,
  label: "feature/x",
  oid: null,
};

const commitResult = {
  repoPath: "/repos/b",
  repoName: "repo-b",
  kind: "Commit" as const,
  label: "fix: bug",
  oid: "abc123",
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
    selectCommit: vi.fn(),
  });
});

describe("WorkspaceOverview", () => {
  it("renders a placeholder when there is no active workspace", () => {
    setWorkspaceState({ activeWorkspace: null, repoStatuses: [] });

    render(<WorkspaceOverview />);

    expect(screen.getByText(/no workspace/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a table row per repo with name, branch, ahead/behind, and uncommitted count", () => {
    render(<WorkspaceOverview />);

    expect(screen.getByText("repo-a")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("↑2")).toBeInTheDocument();
    expect(screen.getByText("↓1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("repo-b")).toBeInTheDocument();
    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("shows an error message for a repo with an error", () => {
    render(<WorkspaceOverview />);

    expect(screen.getByText(/repository not found/i)).toBeInTheDocument();
  });

  it("Fetch all button calls fetchAll with the active workspace id", () => {
    render(<WorkspaceOverview />);

    fireEvent.click(screen.getByRole("button", { name: /fetch all/i }));

    expect(useWorkspaceStore.getState().fetchAll).toHaveBeenCalledWith("ws-1");
  });

  it("Pull all button calls pullAll with the active workspace id", () => {
    render(<WorkspaceOverview />);

    fireEvent.click(screen.getByRole("button", { name: /pull all/i }));

    expect(useWorkspaceStore.getState().pullAll).toHaveBeenCalledWith("ws-1");
  });

  it("disables Fetch all and Pull all while a bulk operation is in progress", () => {
    setWorkspaceState({ isFetchingAll: true, isPullingAll: true });

    render(<WorkspaceOverview />);

    expect(screen.getByRole("button", { name: /fetch/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /pull/i })).toBeDisabled();
  });

  it("renders operation results with their messages", () => {
    setWorkspaceState({
      operationResults: [
        { path: "/repos/a", name: "repo-a", success: true, message: "fetched (1 ref(s) updated)" },
        { path: "/repos/b", name: "repo-b", success: false, message: "could not connect" },
      ],
    });

    render(<WorkspaceOverview />);

    expect(screen.getByText(/fetched \(1 ref\(s\) updated\)/i)).toBeInTheDocument();
    expect(screen.getByText(/could not connect/i)).toBeInTheDocument();
  });

  it("search box submits on Enter and calls search with the workspace id and query", () => {
    render(<WorkspaceOverview />);

    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "feature" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useWorkspaceStore.getState().search).toHaveBeenCalledWith("ws-1", "feature");
  });

  it("renders search results with repo name, kind, and label", () => {
    setWorkspaceState({ searchResults: [branchResult, commitResult] });

    render(<WorkspaceOverview />);

    expect(screen.getByText(/repo-a/)).toBeInTheDocument();
    expect(screen.getByText(/feature\/x/)).toBeInTheDocument();
    expect(screen.getByText(/repo-b/)).toBeInTheDocument();
    expect(screen.getByText(/fix: bug/)).toBeInTheDocument();
  });

  it("clicking a branch search result switches to that repo", async () => {
    setWorkspaceState({ searchResults: [branchResult] });

    render(<WorkspaceOverview />);

    fireEvent.click(screen.getByRole("button", { name: /feature\/x/ }));

    await vi.waitFor(() => {
      expect(useRepoStore.getState().openRepo).toHaveBeenCalledWith("/repos/a");
      expect(useGraphStore.getState().fetchViewport).toHaveBeenCalledWith(0, 150);
      expect(useRepoStore.getState().loadBranches).toHaveBeenCalled();
    });
    expect(useGraphStore.getState().selectCommit).not.toHaveBeenCalled();
  });

  it("clicking a commit search result switches repo and selects the commit", async () => {
    setWorkspaceState({ searchResults: [commitResult] });

    render(<WorkspaceOverview />);

    fireEvent.click(screen.getByRole("button", { name: /fix: bug/ }));

    await vi.waitFor(() => {
      expect(useRepoStore.getState().openRepo).toHaveBeenCalledWith("/repos/b");
      expect(useGraphStore.getState().fetchViewport).toHaveBeenCalledWith(0, 150);
      expect(useRepoStore.getState().loadBranches).toHaveBeenCalled();
      expect(useGraphStore.getState().selectCommit).toHaveBeenCalledWith("abc123", false);
    });
  });
});
