import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import "@testing-library/jest-dom";
import { Sidebar } from "./Sidebar";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import { useGithubStore } from "../../stores/githubStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useMergeStore } from "../../stores/mergeStore";

const mockInvoke = vi.mocked(invoke);

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
    revealCommit: vi.fn().mockResolvedValue(undefined),
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
});

describe("Sidebar", () => {
  it("no longer renders the view-nav buttons (moved to the top NavBar)", () => {
    render(<Sidebar />);

    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "PRs" })).toBeNull();
    expect(screen.queryByRole("button", { name: /open repository/i })).toBeNull();
  });

  it("groups branches into Local and Remote sections with provenance icons", () => {
    useRepoStore.setState({
      branches: [
        { name: "main", isRemote: false, isHead: true, upstream: null, oid: "a", ahead: null, behind: null },
        { name: "origin/main", isRemote: true, isHead: false, upstream: null, oid: "b", ahead: null, behind: null },
      ],
    });

    const { container } = render(<Sidebar />);

    expect(screen.getByRole("button", { name: "Local" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remote" })).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(container.querySelector('[data-icon="laptop"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="github"]')).not.toBeNull();
  });
});
