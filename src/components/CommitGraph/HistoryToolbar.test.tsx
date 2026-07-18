import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { HistoryToolbar } from "./HistoryToolbar";
import { useRemoteStore } from "../../stores/remoteStore";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGithubStore } from "../../stores/githubStore";
import { useMergeStore } from "../../stores/mergeStore";
import { useToastStore } from "../../stores/toastStore";
import { useHookStore } from "../../stores/hookStore";

beforeEach(() => {
  vi.clearAllMocks();
  useRemoteStore.setState({
    isFetching: false,
    isPulling: false,
    isPushing: false,
    lastError: null,
    fetch: vi.fn().mockResolvedValue({ updatedRefs: [] }),
    pull: vi.fn().mockResolvedValue({ status: "fastForwarded" }),
    push: vi.fn().mockResolvedValue(undefined),
  });
  useGraphStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
  useRepoStore.setState({
    currentRepo: { name: "repo", path: "/repo", headBranch: "main" },
    createBranch: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
  });
  useGithubStore.setState({
    remoteInfo: { host: "github.com", owner: "mike", repo: "gitclient", protocol: "https" },
  });
  useMergeStore.setState({ loadStatus: vi.fn().mockResolvedValue(undefined) });
  useHookStore.setState({ runs: {} });
});

const openPullMenu = () => fireEvent.click(screen.getByRole("button", { name: /^pull/i }));

describe("HistoryToolbar", () => {
  it("locks only the repository whose pre-push hook is running", () => {
    useHookStore.getState().started({
      repoPath: "/repo",
      runId: "run-1",
      hook: "pre-push",
      operation: "push",
    });
    const { rerender } = render(<HistoryToolbar />);

    expect(screen.getByRole("button", { name: "Running pre-push…" })).toBeDisabled();

    useRepoStore.setState({
      currentRepo: { name: "other", path: "/other", headBranch: "main" },
    });
    rerender(<HistoryToolbar />);
    expect(screen.getByRole("button", { name: /^push$/i })).toBeEnabled();
  });

  it("pushes and refreshes the graph", async () => {
    render(<HistoryToolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^push$/i }));
    await waitFor(() => expect(useRemoteStore.getState().push).toHaveBeenCalled());
    expect(useGraphStore.getState().refresh).toHaveBeenCalled();
  });

  it("offers fetch and the two pull modes", () => {
    render(<HistoryToolbar />);
    openPullMenu();
    expect(screen.getByText("Fetch")).toBeInTheDocument();
    expect(screen.getByText(/fast-forward if possible/i)).toBeInTheDocument();
    expect(screen.getByText(/fast-forward only/i)).toBeInTheDocument();
  });

  it("runs fetch from the pull menu", async () => {
    render(<HistoryToolbar />);
    openPullMenu();
    fireEvent.click(screen.getByText("Fetch"));
    await waitFor(() => expect(useRemoteStore.getState().fetch).toHaveBeenCalled());
  });

  it("runs ff-only and ff-if-possible pulls with the right mode", async () => {
    render(<HistoryToolbar />);

    openPullMenu();
    fireEvent.click(screen.getByText(/fast-forward only/i));
    await waitFor(() => expect(useRemoteStore.getState().pull).toHaveBeenCalledWith("ffOnly"));

    openPullMenu();
    fireEvent.click(screen.getByText(/fast-forward if possible/i));
    await waitFor(() => expect(useRemoteStore.getState().pull).toHaveBeenCalledWith("ffOrMerge"));
  });

  it("opens the merge editor when a pull conflicts", async () => {
    useRemoteStore.setState({ pull: vi.fn().mockResolvedValue({ status: "conflicts" }) });
    render(<HistoryToolbar />);

    openPullMenu();
    fireEvent.click(screen.getByText(/fast-forward if possible/i));

    await waitFor(() => expect(useMergeStore.getState().loadStatus).toHaveBeenCalled());
  });

  it("creates and checks out a new branch", async () => {
    render(<HistoryToolbar />);
    fireEvent.click(screen.getByRole("button", { name: /new branch/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "feat/x" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(useRepoStore.getState().createBranch).toHaveBeenCalledWith("feat/x"));
    expect(useRepoStore.getState().checkoutBranch).toHaveBeenCalledWith("feat/x");
  });

  it("shows a toast instead of throwing when creating a branch fails", async () => {
    useRepoStore.setState({ createBranch: vi.fn().mockRejectedValue(new Error("already exists")) });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<HistoryToolbar />);
    fireEvent.click(screen.getByRole("button", { name: /new branch/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "feat/x" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: already exists", { title: "Couldn't create branch" }),
    );
  });

  it("jumps to the checked-out commit and leaves the uncommitted view", () => {
    const revealHead = vi.fn().mockResolvedValue(undefined);
    useGraphStore.setState({ revealHead });
    const onJumpToHead = vi.fn();

    render(<HistoryToolbar onJumpToHead={onJumpToHead} />);
    fireEvent.click(screen.getByRole("button", { name: /scroll to current head/i }));

    expect(onJumpToHead).toHaveBeenCalled();
    expect(revealHead).toHaveBeenCalled();
  });

  it("toggles focus-current-branch mode via the toolbar button", () => {
    useGraphStore.setState({ focusCurrentBranch: true });
    render(<HistoryToolbar />);
    const btn = screen.getByRole("button", { name: /focus current branch/i });

    // Starts on (pressed).
    expect(btn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(btn);
    expect(useGraphStore.getState().focusCurrentBranch).toBe(false);
    expect(btn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(btn);
    expect(useGraphStore.getState().focusCurrentBranch).toBe(true);
  });

  it("cycles row density Comfortable → Cozy → Compact → Comfortable via the toolbar button", () => {
    useGraphStore.setState({ graphDensity: "comfortable" });
    render(<HistoryToolbar />);
    const btn = screen.getByRole("button", { name: /change row density/i });

    fireEvent.click(btn);
    expect(useGraphStore.getState().graphDensity).toBe("cozy");
    fireEvent.click(btn);
    expect(useGraphStore.getState().graphDensity).toBe("compact");
    fireEvent.click(btn);
    expect(useGraphStore.getState().graphDensity).toBe("comfortable");
  });

  it("disables push and pull when there is no remote", () => {
    useGithubStore.setState({ remoteInfo: null });
    render(<HistoryToolbar />);
    expect(screen.getByRole("button", { name: /^push$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^pull/i })).toBeDisabled();
  });

  it("the search button toggles the graph search open and closed", () => {
    useGraphStore.setState({ searchOpen: false });
    render(<HistoryToolbar />);
    const btn = screen.getByRole("button", { name: "Search commits" });

    fireEvent.click(btn);
    expect(useGraphStore.getState().searchOpen).toBe(true);
    fireEvent.click(btn);
    expect(useGraphStore.getState().searchOpen).toBe(false);
  });
});
