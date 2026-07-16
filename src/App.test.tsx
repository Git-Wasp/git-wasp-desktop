import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore } from "./stores/graphStore";
import { useGithubStore } from "./stores/githubStore";
import { useRemoteStore } from "./stores/remoteStore";
import { useMergeStore } from "./stores/mergeStore";
import { useTagStore } from "./stores/tagStore";
import { useThemeStore } from "./stores/themeStore";
import { useWorkingTreeStore } from "./stores/workingTreeStore";
import { useToastStore } from "./stores/toastStore";

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
