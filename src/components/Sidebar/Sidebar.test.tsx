import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import "@testing-library/jest-dom";
import { Sidebar } from "./Sidebar";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import { useGithubStore } from "../../stores/githubStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useMergeStore } from "../../stores/mergeStore";
import { useToastStore } from "../../stores/toastStore";

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
    worktrees: [],
    worktreesLoadedFor: null,
    openRepo: vi.fn().mockResolvedValue(undefined),
    loadCurrentRepo: vi.fn().mockResolvedValue(undefined),
    loadRecentRepos: vi.fn().mockResolvedValue(undefined),
    loadBranches: vi.fn().mockResolvedValue(undefined),
    listWorktrees: vi.fn().mockResolvedValue([]),
    openParentRepo: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    renameBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    createTag: vi.fn().mockResolvedValue(undefined),
  });

  useGraphStore.setState({
    viewport: null,
    selection: { anchor: null, focus: null, range: new Set() },
    selectedOid: null,
    fetchViewport: vi.fn().mockResolvedValue(undefined),
    selectCommit: vi.fn(),
    revealCommit: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    clearSelection: vi.fn(),
  });

  useGithubStore.setState({
    connections: {},
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
    aheadBehind: new Map(),
    aheadBehindEpoch: 0,
    isFetching: false,
    isPulling: false,
    isPushing: false,
    lastError: null,
    requestAheadBehind: vi.fn(),
    invalidateAheadBehind: vi.fn(),
    fetch: vi.fn().mockResolvedValue({ updatedRefs: [] }),
    pull: vi.fn().mockResolvedValue({ status: "AlreadyUpToDate" }),
    push: vi.fn().mockResolvedValue(undefined),
    fastForwardToUpstream: vi.fn().mockResolvedValue(undefined),
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
    expect(
      screen.queryByRole("button", { name: /open repository/i }),
    ).toBeNull();
  });

  it("groups branches into Local and Remote sections with provenance icons", () => {
    useRepoStore.setState({
      branches: [
        {
          name: "main",
          isRemote: false,
          isHead: true,
          upstream: null,
          oid: "a",
        },
        {
          name: "origin/main",
          isRemote: true,
          isHead: false,
          upstream: null,
          oid: "b",
        },
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

  it("floats the checked-out branch to the top of the local list", () => {
    useRepoStore.setState({
      branches: [
        {
          name: "alpha",
          isRemote: false,
          isHead: false,
          upstream: null,
          oid: "1",
        },
        {
          name: "beta",
          isRemote: false,
          isHead: false,
          upstream: null,
          oid: "2",
        },
        {
          name: "current",
          isRemote: false,
          isHead: true,
          upstream: null,
          oid: "3",
        },
      ],
    });

    render(<Sidebar />);

    const rows = screen.getAllByTitle(/in the commit graph$/);
    expect(rows[0]).toHaveTextContent("current"); // head first
    // Remaining branches keep their original order.
    expect(rows[1]).toHaveTextContent("alpha");
    expect(rows[2]).toHaveTextContent("beta");
  });

  it("removes a repo from the recent list via its row menu", () => {
    const removeRecent = vi.fn().mockResolvedValue(undefined);
    useRepoStore.setState({
      recentRepos: [{ path: "/x", name: "x", pinned: false, lastOpened: 0 }],
      removeRecent,
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "x actions" }));
    fireEvent.click(screen.getByText("Remove from recent"));

    expect(removeRecent).toHaveBeenCalledWith("/x");
  });

  it("pushes a branch from its row menu", async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    useRemoteStore.setState({ push });
    useRepoStore.setState({
      branches: [
        {
          name: "feature",
          isRemote: false,
          isHead: false,
          upstream: null,
          oid: "a",
        },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Push branch"));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(undefined, "feature"),
    );
  });

  it("offers fast-forward-to-upstream only when behind with nothing ahead", async () => {
    const fastForwardToUpstream = vi.fn().mockResolvedValue(undefined);
    useRemoteStore.setState({
      fastForwardToUpstream,
      aheadBehind: new Map([["feature", { ahead: 0, behind: 2 }]]),
    });
    useRepoStore.setState({
      branches: [
        {
          name: "feature",
          isRemote: false,
          isHead: false,
          upstream: "origin/feature",
          oid: "a",
        },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Fast-forward to origin/feature"));

    await waitFor(() =>
      expect(fastForwardToUpstream).toHaveBeenCalledWith("feature"),
    );
  });

  it("hides fast-forward-to-upstream when the branch is also ahead (diverged)", () => {
    useRemoteStore.setState({
      aheadBehind: new Map([["feature", { ahead: 1, behind: 2 }]]),
    });
    useRepoStore.setState({
      branches: [
        {
          name: "feature",
          isRemote: false,
          isHead: false,
          upstream: "origin/feature",
          oid: "a",
        },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    expect(screen.queryByText(/Fast-forward to/)).not.toBeInTheDocument();
  });

  it("requires confirmation before deleting a branch (not a native window.confirm)", async () => {
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => {
      throw new Error("window.confirm should not be used");
    });
    useRepoStore.setState({
      deleteBranch,
      branches: [
        {
          name: "feature",
          isRemote: false,
          isHead: false,
          upstream: null,
          oid: "a",
        },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Delete branch"));

    // The delete does not fire until the modal is confirmed.
    expect(deleteBranch).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete branch" });
    expect(within(dialog).getByText(/feature/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Delete"));
    await waitFor(() => expect(deleteBranch).toHaveBeenCalledWith("feature"));

    confirmSpy.mockRestore();
  });

  it("does not delete a branch when the confirmation is cancelled", () => {
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    useRepoStore.setState({
      deleteBranch,
      branches: [
        {
          name: "feature",
          isRemote: false,
          isHead: false,
          upstream: null,
          oid: "a",
        },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Delete branch"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(deleteBranch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a toast instead of throwing when checking out a branch fails", async () => {
    const checkoutBranch = vi
      .fn()
      .mockRejectedValue(new Error("uncommitted changes"));
    const error = vi.fn();
    useToastStore.setState({ error });
    useRepoStore.setState({
      checkoutBranch,
      branches: [
        {
          name: "feature",
          isRemote: false,
          isHead: false,
          upstream: null,
          oid: "a",
        },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Checkout branch"));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: uncommitted changes", {
        title: "Couldn't checkout branch",
      }),
    );
  });

  it("shows a toast instead of throwing when deleting a branch fails", async () => {
    const deleteBranch = vi.fn().mockRejectedValue(new Error("locked"));
    const error = vi.fn();
    useToastStore.setState({ error });
    useRepoStore.setState({
      deleteBranch,
      branches: [
        {
          name: "feature",
          isRemote: false,
          isHead: false,
          upstream: null,
          oid: "a",
        },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Delete branch"));
    const dialog = screen.getByRole("dialog", { name: "Delete branch" });
    fireEvent.click(within(dialog).getByText("Delete"));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: locked", {
        title: "Couldn't delete branch",
      }),
    );
  });

  it("shows a toast instead of throwing when creating a branch fails", async () => {
    const createBranch = vi.fn().mockRejectedValue(new Error("already exists"));
    const error = vi.fn();
    useToastStore.setState({ error });
    useRepoStore.setState({ createBranch });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByPlaceholderText("branch-name"), {
      target: { value: "feature" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: already exists", {
        title: "Couldn't create branch",
      }),
    );
  });

  it("creates a tag at a branch tip from its row menu", async () => {
    useRepoStore.setState({
      branches: [
        {
          name: "feature",
          isRemote: false,
          isHead: false,
          upstream: null,
          oid: "abc123",
        },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Create tag…"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "v1.0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(useRepoStore.getState().createTag).toHaveBeenCalledWith(
        "v1.0",
        "abc123",
      ),
    );
  });

  it("shows parent metadata when the active repo is a linked worktree", () => {
    useRepoStore.setState({
      currentRepo: {
        name: "main-feature",
        path: "/repos/main-feature",
        headBranch: "feature/worktree",
        repoKind: "worktree",
        parentRepoPath: "/repos/main",
        commonDirPath: "/repos/main/.git",
        worktreeBranch: "feature/worktree",
        worktreeLocked: true,
        worktreePrunable: false,
      },
      branches: [],
      recentRepos: [],
    });

    render(<Sidebar width={240} />);

    expect(screen.getByText("feature/worktree")).toBeInTheDocument();
    expect(screen.getByText(/Linked to \/repos\/main/)).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("shows the Worktrees panel and refreshes worktrees for the active repo family", async () => {
    const listWorktrees = vi.fn().mockResolvedValue([]);
    useRepoStore.setState({
      currentRepo: {
        name: "main-feature",
        path: "/repos/main-feature",
        headBranch: "feature/worktree",
        repoKind: "worktree",
        parentRepoPath: "/repos/main",
        commonDirPath: "/repos/main/.git",
        worktreeBranch: "feature/worktree",
        worktreeLocked: false,
        worktreePrunable: false,
      },
      worktrees: [
        {
          path: "/repos/main",
          name: "main",
          repoKind: "main",
          branch: "main",
          isCurrent: false,
          isOpen: false,
          isLocked: false,
          hasUncommittedChanges: false,
          parentRepoPath: null,
        },
      ],
      listWorktrees,
    });

    render(<Sidebar width={240} />);

    expect(
      screen.getByRole("button", { name: "Worktrees" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("/repos/main")).toBeInTheDocument();
    await waitFor(() => expect(listWorktrees).toHaveBeenCalled());
  });
});
