import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore, WORKING_TREE_OID } from "./stores/graphStore";
import { useGithubStore } from "./stores/githubStore";
import { useRemoteStore } from "./stores/remoteStore";
import { useMergeStore } from "./stores/mergeStore";
import { useTagStore } from "./stores/tagStore";
import { useThemeStore } from "./stores/themeStore";
import { useWorkingTreeStore } from "./stores/workingTreeStore";
import { useToastStore } from "./stores/toastStore";
import type { GraphNode } from "./types/graph";
import type { StageFileContents } from "./types/workingTree";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const mockListen = vi.mocked(listen);

const repo = { name: "gitclient", path: "/repo", headBranch: "main" };

beforeEach(() => {
  vi.clearAllMocks();
  // Collapse the sidebar so App's tree doesn't also have to drive Sidebar's
  // own (unrelated) branch/stash data — this test is only about the
  // repo-scoped effect at the App root.
  localStorage.setItem("sidebarCollapsed", "true");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  mockListen.mockResolvedValue(() => {});

  useThemeStore.setState({ initTheme: vi.fn().mockResolvedValue(undefined) });

  useRepoStore.setState({
    currentRepo: repo,
    openRepos: [repo],
    activeRepoPath: repo.path,
    recentRepos: [],
    branches: [],
    activationEpoch: 0,
    loadCurrentRepo: vi.fn().mockResolvedValue(undefined),
    loadOpenRepos: vi.fn().mockResolvedValue(undefined),
    loadRecentRepos: vi.fn().mockResolvedValue(undefined),
    loadBranches: vi.fn().mockResolvedValue(undefined),
    syncHead: vi.fn().mockResolvedValue(undefined),
    openRepo: vi.fn().mockResolvedValue(undefined),
    activateRepo: vi.fn().mockResolvedValue(undefined),
    closeRepo: vi.fn().mockResolvedValue(undefined),
    newTab: vi.fn(),
    checkoutBranch: vi.fn().mockResolvedValue(true),
    checkoutRemoteBranch: vi.fn().mockResolvedValue(undefined),
  });

  useGraphStore.setState({
    viewport: null,
    selectedOid: null,
    fetchViewport: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    revealHead: vi.fn().mockResolvedValue(undefined),
  });

  useGithubStore.setState({
    remoteInfo: null,
    pullRequests: [],
    init: vi.fn().mockResolvedValue(undefined),
    detectRemote: vi.fn().mockResolvedValue(undefined),
    setPrDraft: vi.fn(),
  });

  useRemoteStore.setState({
    aheadBehind: [],
    isFetching: false,
    isPulling: false,
    isPushing: false,
    loadAheadBehind: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue({ updatedRefs: [] }),
    pull: vi.fn().mockResolvedValue({ status: "fastForwarded" }),
    push: vi.fn().mockResolvedValue(undefined),
  });

  useMergeStore.setState({
    status: { kind: "none" },
    loadStatus: vi.fn().mockResolvedValue(undefined),
  });

  useTagStore.setState({ loadRemoteTags: vi.fn().mockResolvedValue(undefined) });

  useWorkingTreeStore.setState({
    refreshAll: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  localStorage.removeItem("sidebarCollapsed");
});

describe("App repo-scoped effect", () => {
  it("shows a toast instead of throwing when loading repo-scoped state fails", async () => {
    useRepoStore.setState({ loadBranches: vi.fn().mockRejectedValue(new Error("backend unavailable")) });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<App />);
    // Boot completes asynchronously (splash screen) before the repo-scoped
    // effect's promises settle.
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: backend unavailable", {
        title: "Couldn't load repository state",
      }),
    );
  });
});

// The synthetic working-tree row the graph renders for uncommitted changes —
// clicking it (via CommitGraph's handleRowClick) is App's real, user-driven
// path into the uncommitted-diff view (App.tsx's `enterUncommitted`, wired as
// CommitGraph's `onViewChanges` prop).
const workingTreeNode: GraphNode = {
  oid: WORKING_TREE_OID,
  shortOid: "",
  summary: "Uncommitted changes",
  authorName: "",
  authorEmail: "",
  authorTimestamp: 0,
  lane: 0,
  row: 0,
  colorIndex: 0,
  parents: [],
  children: [],
  edges: [],
  branchLabels: [],
  isHead: false,
  onHeadLine: true,
  isWorkingTree: true,
  changeCount: 2,
};

// Two independent line modifications, so the rendered per-line diff carries
// (at least) two distinct stage toggles to click — mirrors
// StageFileEditor.test.tsx's `twoChanges` fixture.
const twoChanges: StageFileContents = {
  headContent: "a\nb\nc\nd\ne\n",
  worktreeContent: "a\nB\nc\nD\ne\n",
  isBinary: false,
  worktreeExists: true,
};

describe("App per-line staging guard", () => {
  it("ignores a second per-line stage toggle fired through App's real onApplyIndex wiring while the first is still applying", async () => {
    let resolveFirst!: () => void;
    // A real (not fire-and-forget) promise, so this proves the guard is fed by
    // App.tsx's actual `onApplyIndex` wiring — not a mock standing in for it,
    // the way StageFileEditor.test.tsx's isolated version of this test does.
    const applyIndexContent = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveFirst = r;
        }),
    );

    useGraphStore.setState({
      viewport: { nodes: [workingTreeNode], totalCount: 1, offset: 0, headRow: null },
    });

    useWorkingTreeStore.setState({
      selectedPath: "f.txt",
      stageMode: "unstaged",
      stageDiff: twoChanges,
      // enterUncommitted() (App.tsx) calls clearSelectedFile() on entering the
      // uncommitted view. Stubbed as a no-op so the pre-seeded selection/diff
      // above survive the working-tree row click below and StageFileEditor
      // renders immediately — without also having to drive the separate
      // file-list-selection flow just to reach the same state.
      clearSelectedFile: vi.fn(),
      discardFile: vi.fn().mockResolvedValue(undefined),
      stageFile: vi.fn().mockResolvedValue(undefined),
      applyIndexContent,
    });

    const { container } = render(<App />);
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());

    // Drive into the uncommitted-diff view the same way a user would: click
    // the working-tree row in the graph.
    const workingTreeRow = await waitFor(() => {
      const row = container.querySelector<HTMLElement>(`[data-oid="${WORKING_TREE_OID}"]`);
      expect(row).not.toBeNull();
      return row!;
    });
    fireEvent.click(workingTreeRow);

    const toggles = await waitFor(() => {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle"));
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      return buttons;
    });

    // toggles.length >= 2, asserted in the waitFor above.
    fireEvent.click(toggles[0]!);
    // Flush one microtask turn before the second click — mirroring two real,
    // separate click events (each its own browser task, with the microtask
    // queue drained in between). This is what makes the regression this test
    // guards against observable: if App.tsx's onApplyIndex fire-and-forgets
    // instead of returning applyIndexContent's promise, StageFileEditor's
    // guard wraps the returned `undefined` in `Promise.resolve(...)`, whose
    // `.finally` fires on the very next microtask turn — well before the real
    // `applyIndexContent` promise (still pending on `resolveFirst`) settles —
    // so the guard would already be re-armed by the time the second click
    // lands, and this assertion would see two calls instead of one. A
    // same-tick pair of `fireEvent.click`s (no await between them) can't
    // distinguish this, since the guard's synchronous flag-set blocks the
    // second click regardless of the returned-promise timing.
    await Promise.resolve();
    fireEvent.click(toggles[1]!); // fired before the first apply resolves

    expect(applyIndexContent).toHaveBeenCalledTimes(1);

    resolveFirst();
    await new Promise((r) => setTimeout(r, 0)); // let the in-flight promise's `.finally` settle

    // The guard re-arms once the first apply resolves.
    fireEvent.click(toggles[1]!);
    expect(applyIndexContent).toHaveBeenCalledTimes(2);
  });
});
