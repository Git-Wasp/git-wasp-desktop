import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    aheadBehind: [],
    isFetching: false,
    isPulling: false,
    isPushing: false,
    lastError: null,
    loadAheadBehind: vi.fn().mockResolvedValue(undefined),
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

  it("floats the checked-out branch to the top of the local list", () => {
    useRepoStore.setState({
      branches: [
        { name: "alpha", isRemote: false, isHead: false, upstream: null, oid: "1", ahead: null, behind: null },
        { name: "beta", isRemote: false, isHead: false, upstream: null, oid: "2", ahead: null, behind: null },
        { name: "current", isRemote: false, isHead: true, upstream: null, oid: "3", ahead: null, behind: null },
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
        { name: "feature", isRemote: false, isHead: false, upstream: null, oid: "a", ahead: null, behind: null },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Push branch"));

    await waitFor(() => expect(push).toHaveBeenCalledWith(undefined, "feature"));
  });

  it("offers fast-forward-to-upstream only when behind with nothing ahead", async () => {
    const fastForwardToUpstream = vi.fn().mockResolvedValue(undefined);
    useRemoteStore.setState({
      fastForwardToUpstream,
      aheadBehind: [{ branch: "feature", ahead: 0, behind: 2, upstream: "origin/feature" }],
    });
    useRepoStore.setState({
      branches: [
        { name: "feature", isRemote: false, isHead: false, upstream: "origin/feature", oid: "a", ahead: null, behind: null },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Fast-forward to origin/feature"));

    await waitFor(() => expect(fastForwardToUpstream).toHaveBeenCalledWith("feature"));
  });

  it("hides fast-forward-to-upstream when the branch is also ahead (diverged)", () => {
    useRemoteStore.setState({
      aheadBehind: [{ branch: "feature", ahead: 1, behind: 2, upstream: "origin/feature" }],
    });
    useRepoStore.setState({
      branches: [
        { name: "feature", isRemote: false, isHead: false, upstream: "origin/feature", oid: "a", ahead: null, behind: null },
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
        { name: "feature", isRemote: false, isHead: false, upstream: null, oid: "a", ahead: null, behind: null },
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
        { name: "feature", isRemote: false, isHead: false, upstream: null, oid: "a", ahead: null, behind: null },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Delete branch"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(deleteBranch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates a tag at a branch tip from its row menu", async () => {
    useRepoStore.setState({
      branches: [
        { name: "feature", isRemote: false, isHead: false, upstream: null, oid: "abc123", ahead: null, behind: null },
      ],
    });

    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "feature actions" }));
    fireEvent.click(screen.getByText("Create tag…"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "v1.0" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(useRepoStore.getState().createTag).toHaveBeenCalledWith("v1.0", "abc123"),
    );
  });
});
