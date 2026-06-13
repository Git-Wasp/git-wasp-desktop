import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import "@testing-library/jest-dom";
import { Sidebar } from "./Sidebar";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import { useGithubStore } from "../../stores/githubStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useMergeStore } from "../../stores/mergeStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

const mockInvoke = vi.mocked(invoke);

const workspaceA = { id: "ws-1", name: "Workspace A", repoPaths: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((cmd: string) =>
    cmd === "stash_list_cmd" ? Promise.resolve([]) : Promise.resolve(undefined),
  );

  useRepoStore.setState({
    currentRepo: { name: "gitclient", path: "/repo", headBranch: "main" },
    recentRepos: [],
    branches: [],
    openRepo: vi.fn().mockResolvedValue(undefined),
    loadCurrentRepo: vi.fn().mockResolvedValue(undefined),
    loadRecentRepos: vi.fn().mockResolvedValue(undefined),
    loadBranches: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    renameBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
  });

  useGraphStore.setState({
    viewport: null,
    selection: { anchor: null, focus: null, range: new Set() },
    selectedOid: null,
    fetchViewport: vi.fn().mockResolvedValue(undefined),
    selectCommit: vi.fn(),
    clearSelection: vi.fn(),
  });

  useGithubStore.setState({
    authStatus: {},
    remoteInfo: null,
    pullRequests: [],
    githubRepos: [],
    deviceFlowInit: null,
    isAuthenticating: false,
    init: vi.fn().mockResolvedValue(undefined),
    detectRemote: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  });

  useRemoteStore.setState({
    aheadBehind: [],
    isFetching: false,
    isPulling: false,
    isPushing: false,
    lastError: null,
    loadAheadBehind: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue({ updatedRefs: [] }),
    pull: vi.fn().mockResolvedValue({ status: "AlreadyUpToDate" }),
    push: vi.fn().mockResolvedValue(undefined),
  });

  useMergeStore.setState({
    status: { kind: "none" },
    startMerge: vi.fn().mockResolvedValue({ kind: "none" }),
  });

  useWorkspaceStore.setState({
    workspaces: [workspaceA],
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
  });
});

describe("Sidebar", () => {
  it("renders a Workspace nav button that switches the view", () => {
    const onViewChange = vi.fn();
    render(<Sidebar view="history" onViewChange={onViewChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    expect(onViewChange).toHaveBeenCalledWith("workspace");
  });

  it("renders the WorkspaceSwitcher", () => {
    render(<Sidebar view="history" onViewChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Workspace A/, current: true })).toBeInTheDocument();
  });

  it("renders the WorkspaceSidebarSection", () => {
    render(<Sidebar view="history" onViewChange={vi.fn()} />);

    expect(screen.getByText("Workspace Repos")).toBeInTheDocument();
  });
});
